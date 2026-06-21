# Breathing-Detection Cache — Storage Specification (IndexedDB v4)

**Status:** Implementation-ready design. Implements ADR
[0023 — Persisted Per-Night Breathing-Detection Cache](../decisions/0023-persisted-per-night-breathing-detection-cache.md),
which builds on [0017](../decisions/0017-app-computed-breathing-pattern-detection.md)
(the detector and its "candidate, never diagnosis" contract) and
[0005](../decisions/0005-dual-storage-indexeddb-opfs.md) (IndexedDB/OPFS split).

**Audience:** `frontend` and `data-science` specialists implementing the
read-through cache, and the `database` specialist implementing the store +
migration. This document is the binding contract for the storage layer; the
detector math and WorkerPool scheduling are out of scope (see ADR 0023 parts 3–4).

**Scope of this doc:** the new IndexedDB object store, its record type, keyPath
and indexes, the v4 migration, cache-invalidation (`algoVersion` + `paramHash`),
cascade-delete integration, the new `IndexedDBService` methods, storage-growth
estimates, and back-compat behaviour. **No runtime source is changed by this
document** — it specifies what the implementers will build.

> **Naming note.** ADR 0023 §Decision Outcome fixes the store's working name as
> `breathing_detections` (a per-`PeriodicBreathingResult` store), not
> `breathing_episodes`. Each record holds one whole `PeriodicBreathingResult`
> (the full per-night result: episodes + `recordHours` + `sessionCriterionMet`),
> not one row per episode. The prompt's suggested `breathing_episodes` would
> wrongly imply an episode-grained store. **We adopt `breathing_detections`** to
> stay consistent with the accepted ADR. Justification for result-grained (not
> episode-grained) appears in §1.

---

## 1. Object store: `breathing_detections`

### 1.1 Dedicated store vs. reusing `analysis_results` — decision

**Use a dedicated store.** ADR 0023 considered and rejected reusing
`analysis_results` (Option C) and embedding in `nightly_aggregates` (Option D) /
`events` (Option E). The storage-level reasons, restated concretely:

- **Lifecycle / cascade correctness.** `analysis_results` rows are keyed by
  `[analysisType, dateRangeHash]` and carry **no `sessionId`**, so
  `deleteSessionCascade` cannot reach them. Deleting or re-importing a night
  would orphan its cached episodes. A `sessionId`-indexed dedicated store joins
  the existing cascade transaction cleanly (§5).
- **Multi-session-per-night reality.** A calendar day legitimately has multiple
  sessions ([ADR 0016](../decisions/0016-session-identity-non-unique-machine-date-index.md));
  the `sessions`/`nightly_aggregates` `machineId_date` indexes are non-unique for
  this reason. A per-night result therefore cannot be keyed by `date` alone — it
  must key on `sessionId`. `analysis_results`' unique `[type, dateRangeHash]`
  contract cannot express "many results per date".
- **Per-night volume vs. a range-scoped contract.** `analysis_results` is built
  for a handful of _range-scoped_ analyses (one row per `[type, range]`). The
  breathing cache is **one row per session** — potentially thousands of rows over
  a multi-year history (§7). Pouring thousands of degenerate "single-day range"
  rows into a store other analyses share abuses its `type_dateRangeHash` unique
  index and pollutes a hot shared store.
- **Independent invalidation.** A detector-version bump must invalidate **only**
  breathing rows, not unrelated `analysis_results` rows. A separate
  `algoVersion`/`paramHash` keying scheme on a dedicated store keeps the blast
  radius of an eviction sweep to this feature (§4, §6).

### 1.2 Result-grained, not episode-grained

One record stores the **entire** `PeriodicBreathingResult` for one session, with
the episode array embedded as a structured field. Rationale:

- The catalog and viewer both consume `PeriodicBreathingResult` as a unit
  (`episodes`, `recordHours`, `sessionCriterionMet`); they never query _across_
  episodes by an episode-level key. Episode-grained rows would force a
  re-aggregation join on every read for zero query benefit.
- `recordHours` and `sessionCriterionMet` are session-level, not per-episode;
  an episode-grained store would have to duplicate them on every episode row.
- IndexedDB stores structured-cloneable objects; an array of plain
  `BreathingEpisode` objects clones cheaply. Per-night episode counts are small
  (typically 0–50; see §7), so the embedded array is a small payload.
- Atomic write/replace of a night's result is a single `put` (§6) rather than a
  delete-all-then-bulk-add over episode rows.

### 1.3 Record type (TypeScript)

Add to `src/types/storage.ts` (domain type) and re-export the storage alias from
`IndexedDBService.ts` exactly as the existing `Stored*` aliases do.

```ts
// src/types/storage.ts

import type { PeriodicBreathingResult } from '@/analysis/breathing';

/**
 * Persisted per-night periodic-breathing / Cheyne–Stokes detection result.
 *
 * One record per (sessionId, algoVersion, paramHash): the full
 * {@link PeriodicBreathingResult} the detector produced for that session under a
 * specific detector version + parameter set. Read cheaply across a date range by
 * the Breathing-Patterns catalog (no OPFS I/O on a hit); recomputed from OPFS
 * only on a miss or when the version/param hash no longer matches current.
 *
 * Cache, not source of truth: OPFS signals remain canonical (ADR 0005). A
 * stale/cold record is simply never read and is reclaimed by version eviction.
 */
export interface BreathingDetectionRecord {
  /**
   * Primary key. Composite string `${sessionId}::${algoVersion}::${paramHash}`.
   * Encodes the full cache identity so a `get(id)` is an exact validity check
   * and a re-detect under the same version overwrites in place (idempotent put).
   * `::` is a safe separator — sessionId is a UUID v4, algoVersion an integer,
   * paramHash a hex/base36 digest, none of which contain `::`.
   */
  readonly id: string;

  /** Foreign key to `sessions.id`. Indexed; drives cascade delete + bulk get. */
  readonly sessionId: string;

  /**
   * Night date (YYYY-MM-DD), denormalised from the session for range reads.
   * Matches `Session.date` / `NightlyAggregate.date` (local calendar date).
   * Indexed for the catalog's date-range query.
   */
  readonly date: string;

  /**
   * Detector algorithm version (integer). Bumped whenever
   * `detectPeriodicBreathing` changes in a result-affecting way. Part of the
   * cache identity; see §4.
   */
  readonly algoVersion: number;

  /**
   * Stable hash of the EFFECTIVE `PeriodicBreathingParams` actually applied
   * (defaults merged with any overrides). Part of the cache identity; see §4.
   */
  readonly paramHash: string;

  /** Detected candidate episodes (the result's `episodes`, frozen at compute). */
  readonly episodes: PeriodicBreathingResult['episodes'];

  /** Total analyzed record length in hours (the result's `recordHours`). */
  readonly recordHours: number;

  /** Session-level CSR ≥5/h-over-≥2 h gate outcome (the result's flag). */
  readonly sessionCriterionMet: boolean;

  /**
   * ISO 8601 timestamp when this detection was computed and cached. Used for
   * provenance, debugging, and (optionally) age-based eviction. Indexed so a
   * future "purge cache older than X" sweep mirrors
   * `deleteAnalysisResultsBefore`.
   */
  readonly computedAt: string;
}
```

```ts
// src/services/storage/IndexedDBService.ts — alongside the other Stored* aliases
import type { BreathingDetectionRecord } from '@/types';

/** BreathingDetectionRecord stored in IndexedDB (cache-identity compound index). */
export type StoredBreathingDetection = BreathingDetectionRecord;
```

**Field-choice justification.**

| Field                                            | Why it is here                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` (composite)                                 | A single `get(id)` is the O(1) cache-validity check (§2/§4). Re-detecting the same night under the same version overwrites in place — no dangling duplicate. Composite (not random UUID) so the key is _derivable_ from `(sessionId, algoVersion, paramHash)` without a secondary lookup. |
| `sessionId`                                      | Foreign key. Non-unique index → cascade delete sweeps every version of a session in one cursor pass (§5); also backs the catalog's bulk-by-sessionId read (§6).                                                                                                                           |
| `date`                                           | Denormalised from the session so the catalog can range-query without joining `sessions`. Mirrors the `date` index already on `sessions`/`nightly_aggregates`.                                                                                                                             |
| `algoVersion` + `paramHash`                      | The invalidation key (§4). Stored explicitly (not only encoded in `id`) so a version-eviction sweep can target one `algoVersion` via an index without string-parsing the key.                                                                                                             |
| `episodes`, `recordHours`, `sessionCriterionMet` | The full `PeriodicBreathingResult` payload the consumers need verbatim.                                                                                                                                                                                                                   |
| `computedAt`                                     | Provenance + age-based eviction option, mirroring `analysis_results.computedAt`.                                                                                                                                                                                                          |

---

## 2. keyPath & indexes

`keyPath: 'id'` (out-of-line composite string key, matching every other store —
all current stores use `keyPath: 'id'` except `settings` which uses `'key'`).

| Index name    | keyPath         | unique | Serves                                                                                                                                           |
| ------------- | --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sessionId`   | `'sessionId'`   | **no** | Cascade delete (§5); `getBreathingDetectionsBySessionId`; bulk get for the catalog. Non-unique because a session can have multiple version rows. |
| `date`        | `'date'`        | **no** | `getBreathingDetectionsByDateRange` — the catalog's primary read. Non-unique (multiple sessions/day, multiple versions).                         |
| `algoVersion` | `'algoVersion'` | **no** | Bulk eviction of a superseded algorithm version (§6 `deleteBreathingDetectionsByAlgoVersionBelow` / `…NotMatching`).                             |
| `computedAt`  | `'computedAt'`  | **no** | Optional age-based purge mirroring `deleteAnalysisResultsBefore`.                                                                                |

**Why no compound `[sessionId, algoVersion, paramHash]` index.** The composite
**primary key** `id` already provides the exact-identity O(1) lookup that a
compound unique index would (cf. `analysis_results.type_dateRangeHash`). Adding a
second unique compound index would be redundant write cost. The cache-validity
check is therefore a plain `store.get(id)` where
`id = makeBreathingDetectionId(sessionId, algoVersion, paramHash)` (§4). This is
a deliberate departure from the `integration_*` pattern (which uses a compound
unique index _because_ its primary key is a random UUID, not derivable from the
business key). Here the key **is** derivable, so we fold identity into it.

> Implementer note: keep `algoVersion` and `paramHash` as their own fields even
> though they are also encoded in `id`, so the `algoVersion` index works and so
> eviction does not have to parse keys.

---

## 3. Schema version bump (v3 → v4) + migration

Two coordinated edits, mirroring exactly how v2→v3 was done (schema applied in
`IndexedDBService.upgradeSchema`; a `Migration` record maintains the settings
ledger and verifies). No existing data is touched — the migration is purely
**additive** (`createObjectStore`).

### 3.1 `IndexedDBService.ts`

1. Bump the constant:

```ts
const DB_VERSION = 4;
```

2. Extend the `StoreName` union:

```ts
type StoreName =
  | 'sessions'
  | 'nightly_aggregates'
  | 'events'
  | 'analysis_results'
  | 'settings'
  | 'import_history'
  | 'integration_data'
  | 'integration_timeseries'
  | 'integration_import_history'
  | 'breathing_detections'; // v4
```

3. Update the `DB_VERSION` doc comment with a `- v4:` bullet describing the new
   store.

4. Add a dispatch step in `upgradeSchema` (after the `oldVersion < 3` block):

```ts
// v3 -> v4: add the breathing_detections per-night detection cache store.
if (oldVersion < 4) {
  this.migrateV3ToV4(db);
}
```

5. Add the migration method (no `tx` needed — pure store creation):

```ts
/**
 * v3 -> v4 migration: add the `breathing_detections` per-night PB/CSR detection
 * cache store. Additive only — creates one new object store with four indexes;
 * touches no existing data. See docs/analysis/breathing-detection-cache-storage.md.
 */
private migrateV3ToV4(db: IDBDatabase): void {
  const store = db.createObjectStore('breathing_detections', { keyPath: 'id' });
  store.createIndex('sessionId', 'sessionId', { unique: false });
  store.createIndex('date', 'date', { unique: false });
  store.createIndex('algoVersion', 'algoVersion', { unique: false });
  store.createIndex('computedAt', 'computedAt', { unique: false });
}
```

6. Add the identical store creation to `createSchema(db)` (the fresh-install path)
   so **new installs and upgrades converge on the same schema** — exactly the
   dual-handling the existing `createSchema` provides for the integration stores:

```ts
// breathing_detections (v4) — per-night PB/CSR detection cache.
const breathing = db.createObjectStore('breathing_detections', { keyPath: 'id' });
breathing.createIndex('sessionId', 'sessionId', { unique: false });
breathing.createIndex('date', 'date', { unique: false });
breathing.createIndex('algoVersion', 'algoVersion', { unique: false });
breathing.createIndex('computedAt', 'computedAt', { unique: false });
```

> **Critical:** the `createSchema` path runs only when `oldVersion < 1`. Both
> paths (fresh `createSchema`, and the `migrateV3ToV4` step for existing DBs)
> must create the store identically. A user on v0 goes through `createSchema`; a
> user on v1/v2/v3 goes through the numbered ladder including `migrateV3ToV4`.

### 3.2 `MigrationService.ts` + `getDB.ts`

Mirror `MIGRATION_003_INTEGRATION_STORES`:

```ts
export const MIGRATION_004_BREATHING_DETECTIONS: Migration = {
  version: 4,
  description: 'Add breathing_detections per-night PB/CSR detection cache store',
  estimatedDurationMs: 50,
  dependencies: [3],

  async up(context: MigrationContext): Promise<void> {
    context.progress.setMessage('Recording breathing-detection cache store…');
    // Store creation is applied by IndexedDBService.upgradeSchema() during
    // onupgradeneeded. Nothing to do here beyond advancing the version record.
  },

  async down(): Promise<void> {
    // Cannot drop object stores outside a versionchange transaction. No-op.
  },

  async verify(context: MigrationContext): Promise<MigrationVerificationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!context.db.objectStoreNames.contains('breathing_detections')) {
      errors.push('Missing object store: breathing_detections');
    } else {
      try {
        const tx = context.db.transaction('breathing_detections', 'readonly');
        const store = tx.objectStore('breathing_detections');
        for (const idx of ['sessionId', 'date', 'algoVersion', 'computedAt']) {
          if (!store.indexNames.contains(idx)) {
            errors.push(`Missing index ${idx} on breathing_detections`);
          }
        }
      } catch (error) {
        errors.push(
          `Failed to inspect breathing_detections indexes: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return { success: errors.length === 0, errors, warnings };
  },
};
```

In `getDB.ts`:

- `const TARGET_SCHEMA_VERSION = 4;`
- register `MIGRATION_004_BREATHING_DETECTIONS` in `registerAll([...])`.

> `TARGET_SCHEMA_VERSION` in `getDB.ts` and `DB_VERSION` in `IndexedDBService.ts`
> MUST stay equal (there is a comment to that effect on both). Bump both to 4.

---

## 4. Cache invalidation: `algoVersion` + `paramHash`

A cached record is **valid iff both** `algoVersion` **and** `paramHash` equal the
current values. Because both are folded into the primary key `id`, a stale record
is _never read_ — a `get(currentId)` for a session whose stored row has a
different version/params simply misses, so the consumer recomputes. There is no
risk of serving a stale clinical result (the Correctness driver in ADR 0023).

### 4.1 Where the constants live

Create `src/analysis/breathing/cacheVersion.ts` (co-located with the detector so
a contributor changing the algorithm sees the version constant next to it):

```ts
import { DEFAULT_PERIODIC_BREATHING_PARAMS, type PeriodicBreathingParams } from './types';

/**
 * Detector algorithm version. BUMP THIS (and only this) whenever
 * `detectPeriodicBreathing` changes in a way that can change its output for the
 * same input + params — new morphology rule, changed confidence formula,
 * envelope-builder change, classification-threshold logic, etc.
 *
 * A bump auto-invalidates every persisted breathing-detection record at the old
 * version (they are never read again and are swept by version eviction, §6).
 * A MISSED bump serves stale clinical candidates — this is the load-bearing
 * correctness invariant of ADR 0023. Guard with the test in §4.4.
 */
export const BREATHING_ALGO_VERSION = 1 as const;

/**
 * Stable, order-independent hash of the EFFECTIVE parameter set actually applied
 * by the detector (defaults merged with overrides). Pure, deterministic, no I/O,
 * safe to call in a worker.
 *
 * Stability requirements (so an equivalent param set never produces two hashes):
 *  - Serialize keys in SORTED order.
 *  - Normalise number formatting (e.g. via JSON.stringify of a sorted-key object;
 *    numbers serialise canonically). Tuples like cycleLenTypicalRange serialise
 *    positionally.
 *  - Include EVERY field of PeriodicBreathingParams so any tuning change is caught.
 */
export function hashBreathingParams(params: PeriodicBreathingParams): string {
  const sorted = Object.keys(params)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = (params as Record<string, unknown>)[k];
      return acc;
    }, {});
  return djb2Hex(JSON.stringify(sorted));
}

/** Hash for the app's default params — the only set used by v1 surfaces. */
export const DEFAULT_BREATHING_PARAM_HASH = hashBreathingParams(DEFAULT_PERIODIC_BREATHING_PARAMS);

/**
 * Build the composite primary key for a breathing-detection record.
 * `id = `${sessionId}::${algoVersion}::${paramHash}``.
 */
export function makeBreathingDetectionId(
  sessionId: string,
  algoVersion: number,
  paramHash: string,
): string {
  return `${sessionId}::${String(algoVersion)}::${paramHash}`;
}

/** Small dependency-free string hash (djb2) rendered as hex. */
function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
```

> Implementer choice: if a stronger digest is wanted, reuse the project's
> existing hashing util rather than djb2 — but it **must be synchronous and
> worker-safe** (the detector runs in a worker). Collision risk is irrelevant
> for correctness here: a false _match_ across two genuinely different param sets
> is the only hazard, and djb2 over a tiny sorted-key JSON string is more than
> adequate; if paranoid, prefix the hash with a short canonical encoding of the
> two pressure-affecting numeric params. Whatever is chosen, freeze it — changing
> the hash _function_ silently invalidates the whole cache (acceptable but
> wasteful; treat a hash-function change as equivalent to an `algoVersion` bump).

### 4.2 How reads check validity

The read-through layer (in `useBreathingEpisodeCatalog` / `useBreathingEpisodes`,
or a shared helper) does:

```ts
const id = makeBreathingDetectionId(
  sessionId,
  BREATHING_ALGO_VERSION,
  DEFAULT_BREATHING_PARAM_HASH, // or hashBreathingParams(effectiveParams)
);
const cached = await db.getBreathingDetectionById(id);
if (cached) {
  // Valid by construction: id encodes the current version + params.
  return {
    episodes: cached.episodes,
    recordHours: cached.recordHours,
    sessionCriterionMet: cached.sessionCriterionMet,
  };
}
// Miss → compute from OPFS via the worker, then persist (§6 putBreathingDetection).
```

Validity is **structural**: the only way to read a record is by an `id` that
embeds the current version + param hash, so a hit is always valid. No per-field
comparison at read time is needed (the version/param fields exist only for the
eviction index and provenance).

### 4.3 How stale records get cleaned up — lazy overwrite + version sweep

Two complementary mechanisms:

1. **Lazy / structural (primary).** Stale records are never _read_ (their `id`
   no longer matches), so they are harmless functionally. When a night is
   recomputed under the same `(algoVersion, paramHash)` — e.g. params unchanged
   but a re-detect was triggered — the write is a `put` on the same `id`, which
   **overwrites in place** (no duplicate). So same-identity recompute self-cleans.

2. **Version eviction sweep (reclaims space).** On `algoVersion` bump the old
   rows linger until swept. Run a one-shot sweep on DB open (in `getDB` after the
   migration ledger, or lazily on first catalog mount):
   `deleteBreathingDetectionsByAlgoVersionNotMatching(BREATHING_ALGO_VERSION)`
   (§6) — a single cursor pass over the `algoVersion` index deleting every row
   whose `algoVersion !== current`. This is bounded (one row per stale session)
   and idempotent. A `paramHash`-only change (without an algo bump) is rarer in
   v1 — the app uses defaults only — so a param-hash sweep is **not required for
   v1**; if user-tunable params land later, add a sweep keyed on
   `(algoVersion === current AND paramHash !== current)` analogous to the version
   sweep. Document but do not implement the param sweep until tunable params ship.

### 4.4 Guarding the version discipline (test contract)

ADR 0023 calls the version bump "load-bearing." Add unit tests (`unit-tester`):

- A snapshot test that fails if `DEFAULT_BREATHING_PARAM_HASH` changes
  unexpectedly (forces a conscious decision when defaults are tuned).
- A test asserting `hashBreathingParams` is order-independent and
  identical for two `{...DEFAULT}` clones.
- A reminder test (comment-documented) that any change to
  `DEFAULT_PERIODIC_BREATHING_PARAMS` must be paired with either an accepted hash
  snapshot update (param change) or a `BREATHING_ALGO_VERSION` bump (algo change).

---

## 5. Cascade delete + full reset

### 5.1 Per-session delete — extend `deleteSessionCascade`

The new store joins the **existing** cascade transaction. Add
`'breathing_detections'` to the transaction's store list and one
`deleteByIndexCursor` call on the `sessionId` index — sweeping **all** version
rows for the session in the same atomic transaction as the session/aggregate/event
deletes:

```ts
async deleteSessionCascade(sessionId: string): Promise<void> {
  try {
    const tx = this.createWriteTransaction(
      'sessions',
      'nightly_aggregates',
      'events',
      'breathing_detections', // v4
    );

    tx.objectStore('sessions').delete(sessionId);
    await this.deleteByIndexCursor(tx.objectStore('nightly_aggregates'), 'sessionId', sessionId);
    await this.deleteByIndexCursor(tx.objectStore('events'), 'sessionId', sessionId);
    // v4: remove every cached detection (all versions) for this session.
    await this.deleteByIndexCursor(
      tx.objectStore('breathing_detections'),
      'sessionId',
      sessionId,
    );

    await this.awaitTransaction(tx);
  } catch (error) {
    throw this.wrapError(
      'STORAGE_DELETE_FAILED', 'cascade-delete session', 'sessions', sessionId, error,
    );
  }
}
```

This preserves the existing atomicity guarantee: session deletion either fully
succeeds (including the cache rows) or fully rolls back. **No orphaned cache rows**
after a delete or a re-import-driven delete.

> The `deleteByIndexCursor` helper already exists and is private; reuse it. Grab
> all four store handles before the first `await` is not required here because
> `deleteByIndexCursor` opens its cursor synchronously on each call, but follow
> the existing ordering (it already works for the three-store version).

### 5.2 Full data reset — already covered

`clearAllUserData` calls `IndexedDBService.destroy()` →
`indexedDB.deleteDatabase('cpap-analyzer')`, which drops the **entire** database
including `breathing_detections`. **No change needed** in `clearAllUserData.ts`.
(Verify with the e2e/unit reset test that the store is gone after reset; it will
be, since the whole DB is deleted and reopened empty.)

---

## 6. New `IndexedDBService` methods

All follow the existing try/catch + `wrapError` + helper conventions. Add a
`// Breathing Detections` section after `Analysis Results`. Add the
`StoredBreathingDetection` alias (§1.3).

```ts
/** Insert or update a breathing-detection record (upsert by composite id). */
async putBreathingDetection(record: StoredBreathingDetection): Promise<void>;
```

Behaviour: single-store `put` on `breathing_detections`. Upsert is intentional —
re-detecting the same `(sessionId, algoVersion, paramHash)` overwrites in place,
keeping the cache self-cleaning (§4.3). Use `put`, not `add`.

```ts
/** Retrieve a breathing-detection record by composite id, or null. */
async getBreathingDetectionById(id: string): Promise<StoredBreathingDetection | null>;
```

Behaviour: single-store `store.get(id)`. This is the **cache-validity check**
(§4.2): callers build `id` from the current version + param hash.

```ts
/** Retrieve all breathing-detection records for a session (all versions). */
async getBreathingDetectionsBySessionId(
  sessionId: string,
): Promise<StoredBreathingDetection[]>;
```

Behaviour: `cursorQuery('breathing_detections', 'sessionId', IDBKeyRange.only(sessionId))`.
Used by the per-session viewer warm-up and diagnostics.

```ts
/** Retrieve breathing-detection records within a date range (inclusive, YYYY-MM-DD). */
async getBreathingDetectionsByDateRange(
  start: string,
  end: string,
): Promise<StoredBreathingDetection[]>;
```

Behaviour: `cursorQuery('breathing_detections', 'date', IDBKeyRange.bound(start, end))`.
The catalog's primary read. Returns rows across **all** versions in range; the
caller filters to the current `id`/version (or use the bulk-by-id helper below).
Performance target: < 100 ms for any range (indexed cursor; rows are small).

```ts
/**
 * Bulk fetch current-version detections for a set of sessions in ONE read
 * transaction. Returns a Map keyed by sessionId for O(1) join in the catalog.
 * Misses (no current-version row) are simply absent from the map.
 */
async getBreathingDetectionsByIds(
  ids: readonly string[],
): Promise<Map<string, StoredBreathingDetection>>;
```

Behaviour: open ONE `readonly` transaction on `breathing_detections`, issue
`store.get(id)` for each id (all on the same transaction — do not await between
issuing requests; collect with `wrapRequest`/Promise.all), map results by
`record.sessionId`. This lets the catalog resolve "which of my N in-scope
sessions are cached at the current version" in a single transaction rather than N
transactions. Preferred over `getBreathingDetectionsByDateRange` when the caller
already has the session list (the common catalog path): it returns only
current-version hits and skips client-side version filtering.

```ts
/**
 * Atomically persist a session's detection alongside import (optional precompute).
 * Single-store put; named for symmetry with addSessionWithRelated's intent.
 */
// (No separate method needed — putBreathingDetection suffices. Listed here only
//  to note the ImportService precompute hook, §8, calls putBreathingDetection.)
```

```ts
/**
 * Evict every breathing-detection row whose algoVersion !== current. One cursor
 * pass over the `algoVersion` index. Returns the count removed. Idempotent.
 */
async deleteBreathingDetectionsByAlgoVersionNotMatching(
  currentAlgoVersion: number,
): Promise<number>;
```

Behaviour: single-store `readwrite` transaction; open a cursor over the
`algoVersion` index across the full range; `cursor.delete()` every record whose
`algoVersion !== currentAlgoVersion`; count and await the transaction. (Cannot use
a single key range to express "not equal", so iterate all and skip matches — the
row count is bounded by session count, one per session per stale version.)
Mirrors `deleteAnalysisResultsBefore`'s cursor-delete shape.

```ts
/** Delete all detections for a session (all versions). Standalone (non-cascade). */
async deleteBreathingDetectionsBySessionId(sessionId: string): Promise<number>;
```

Behaviour: single-store `readwrite`; `deleteByIndexRangeCounting` on the
`sessionId` index with `IDBKeyRange.only(sessionId)`. Useful for re-import
"recompute this night" flows that are not full session deletes.

**Atomicity / transaction notes.**

- `putBreathingDetection` is a single-store write; it does **not** need to share a
  transaction with the import's `addSessionWithRelated` (the precompute is a
  separate, optional, post-import step — ADR 0023 part 4 — and must not be able to
  fail the import). Persist it in its own transaction after the session commit.
- The cascade delete (§5.1) is the **only** path that must share a transaction
  with other stores; it reuses the existing multi-store cascade transaction.
- `getBreathingDetectionsByIds` must issue all `get`s on one transaction without
  awaiting between them (same discipline as `deleteIntegrationDataBySource`), so
  the transaction stays continuously active and cannot auto-commit early.

---

## 7. Storage growth estimate & quota

**Per-record size (rough, structured-clone in IndexedDB):**

- Fixed fields (`id`, `sessionId`, `date`, `algoVersion`, `paramHash`,
  `recordHours`, `sessionCriterionMet`, `computedAt`): ~250–350 bytes incl. index
  entries and IDB overhead.
- `BreathingEpisode` is ~10 numeric/short-string fields → ~250–400 bytes each
  serialised.
- **Episodes per night:** typically **0–20** for normal therapy; **20–60** on
  heavy periodic-breathing / CSR nights. Take a conservative mean of ~15
  episodes/night for an affected user, ~2 for a typical user.

**Per-night payload:**

- Typical user (~2 episodes): ~0.35 KB header + ~0.8 KB = **~1.2 KB/night**.
- Heavy PB/CSR user (~15 episodes): ~0.35 KB + ~5 KB = **~5.4 KB/night**.
- Pathological cap (60 episodes): ~24 KB/night.

**5-year totals (1 record per night, current version):**

- Typical: 1,825 nights × ~1.2 KB ≈ **~2.2 MB**.
- Heavy: 1,825 × ~5.4 KB ≈ **~9.9 MB**.
- Pathological: 1,825 × 24 KB ≈ ~44 MB.

**Conclusion:** even the heavy case is **single-digit-to-low-tens of MB over five
years** — negligible next to OPFS signal storage (years of 25–50 Hz flow/pressure
is GBs; ADR 0005). The cache comfortably meets the "5 years without exceeding
typical quota" target on its own.

**Quota considerations.**

- This store shares the origin's `navigator.storage.estimate()` budget with OPFS
  and the rest of IndexedDB. Its footprint is a rounding error against OPFS, so it
  does not move the existing quota-warning thresholds. No new quota UI is required
  for this store specifically.
- A `QuotaExceededError` on `putBreathingDetection` must be **non-fatal**: the
  cache is an accelerator, not source of truth (ADR 0023 "Neutral"). On quota
  failure, **swallow-and-degrade** — log, skip the cache write, and let the
  consumer use the freshly-computed in-memory result. Do **not** propagate a
  storage error up into the detection result. (This differs from import writes,
  which must fail loud; here a failed cache write is recoverable by definition.)
  Implement this as a `try/catch` around the `put` in the read-through layer, not
  inside `putBreathingDetection` itself (keep the service method honest; the
  caller decides the degrade policy).
- Transient doubling: an `algoVersion` bump transiently doubles a session's rows
  (old + new) until the eviction sweep (§6) runs. At ~5.4 KB/night heavy, a full
  doubling is still < 20 MB transient — acceptable; the sweep on next open
  reclaims it.

---

## 8. Migration / back-compat behaviour

### 8.1 No cached record → fall back to live compute

The read-through contract: **a miss is not an error.** When
`getBreathingDetectionById(currentId)` returns `null` (fresh install, new night,
post-version-bump, or quota-skipped write), the consumer computes live from OPFS
exactly as today (the existing `detectForSession` / `detectOne` path), then
persists via `putBreathingDetection` (best-effort, §7). Behaviour is identical to
the current live-only path on a cold cache — there is **no schema dependency that
can break detection**; the cache only ever accelerates.

### 8.2 Existing DBs before v4

Users on v1/v2/v3 get the additive `migrateV3ToV4` store creation on next open
(empty store). Their first catalog/viewer visit is a full cold compute that then
warms the cache. No data loss, no detection-behaviour change, no user-visible
migration beyond the (sub-second) store creation.

### 8.3 The module-level `catalogCache` / `episodeCache`

Per ADR 0023 part 3, the two ephemeral module-level `Map`s become **read-through
layers in front of the persistent store**, not independent caches:

- **`catalogCache` (in `useBreathingEpisodeCatalog`)** and **`episodeCache` (in
  `useBreathingEpisodes`)** remain as in-tab L1 memo caches keyed by `sessionId`
  (cheap de-dupe within a surface for the life of the tab). Their lookup order
  becomes: **L1 memory (Map) → L2 IndexedDB (`getBreathingDetectionById`) →
  compute from OPFS → write L2 + L1.**
- Because both surfaces resolve the same persistent `id` (same
  `BREATHING_ALGO_VERSION` + `DEFAULT_BREATHING_PARAM_HASH`), they now **share** a
  warm cache: a night computed by the viewer is an IndexedDB hit for the catalog
  and vice-versa — ending the "two caches do not warm each other" divergence the
  current `useBreathingEpisodeCatalog` docstring laments.
- The L1 `Map`s still must key on `sessionId` **plus** the current version/param
  identity if tunable params ever ship; for v1 (defaults only) `sessionId` alone
  remains a safe L1 key, but implementers should key the L1 entry by the same
  composite `id` as L2 to be future-proof and avoid a stale L1 entry surviving an
  algo bump within a single tab session. **Recommendation: key both L1 Maps by the
  composite `id`, not bare `sessionId`.**
- The `_clearCatalogCacheForTesting` / `_clearBreathingCacheForTesting` /
  `_set*WorkerFactoryForTesting` seams stay; tests additionally get a fresh
  IndexedDB (existing `resetDB` seam) so L2 starts empty.

### 8.4 What does NOT change

- The detector (`detectPeriodicBreathing`), its inputs, `PeriodicBreathingResult`,
  and the `belowDeviceThreshold` candidate semantics are carried verbatim into the
  cache. Persistence changes _when_ detection runs, never _what_ it asserts.
- `analysis_results` and its `type_dateRangeHash` / `cacheVersion` machinery are
  untouched; range-scoped analyses keep their store.
- OPFS remains the signal source of truth; the cache is derived and disposable.

---

## 9. Implementation checklist (for the implementing agents)

**database** (this store + migration):

- [ ] `src/types/storage.ts`: add `BreathingDetectionRecord`; export from `src/types/index.ts`.
- [ ] `IndexedDBService.ts`: `DB_VERSION = 4`; extend `StoreName`; add
      `StoredBreathingDetection` alias; add `migrateV3ToV4`; wire `oldVersion < 4`;
      add store to `createSchema`; add the six methods (§6); extend
      `deleteSessionCascade` (§5.1).
- [ ] `MigrationService.ts`: add `MIGRATION_004_BREATHING_DETECTIONS`.
- [ ] `getDB.ts`: `TARGET_SCHEMA_VERSION = 4`; register migration 004.
- [ ] Trigger `deleteBreathingDetectionsByAlgoVersionNotMatching` once on open
      (in `getDB` after the ledger run) for version eviction.

**data-science** (version + hash):

- [ ] `src/analysis/breathing/cacheVersion.ts`: `BREATHING_ALGO_VERSION`,
      `hashBreathingParams`, `DEFAULT_BREATHING_PARAM_HASH`,
      `makeBreathingDetectionId` (§4.1). Export from `breathing/index.ts`.

**frontend** (read-through):

- [ ] `useBreathingEpisodes` / `useBreathingEpisodeCatalog`: L1→L2→compute→persist
      flow (§8.3); best-effort persist with quota swallow (§7); key L1 by composite id.

**unit-tester / qa / security:**

- [ ] Migration test (v3→v4 additive, fresh-install parity, indexes present).
- [ ] Cache hit/miss/stale, cascade-delete sweeps all versions, full-reset wipes store.
- [ ] Version-discipline guards (§4.4).
- [ ] `security`: confirm the cache participates in delete-everything (it does, via
      `destroy()`) and carries no new PII surface beyond what `sessions` already holds.

```

```
