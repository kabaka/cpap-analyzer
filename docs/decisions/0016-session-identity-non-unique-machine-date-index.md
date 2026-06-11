# 0016 — Sessions Identified by `id`, Not `(machineId, date)`; Multiple Sessions Per Day Are a Domain Invariant

## Status

Accepted

## Context

The CPAP Analyzer stores structured therapy data in IndexedDB via `IndexedDBService`
(`src/services/storage/IndexedDBService.ts`). The original v1 schema declared the
compound index `machineId_date` on `['machineId', 'date']` as `unique: true` on **both**
the `sessions` and `nightly_aggregates` object stores, on the implicit assumption that a
machine produces at most one session per calendar day.

That assumption is false for this domain. Two facts collide:

- **`session.date` is day-granularity** (a `YYYY-MM-DD` grouping key). It is deliberately
  a calendar-day bucket used by range and cursor queries — `getSessionsByDateRange`,
  `getNightlyAggregatesByDateRange`, `countSessionsByDateRange` — all of which scan the
  `date` / `machineId_date` indexes over `IDBKeyRange.bound(start, end)`.
- **`SessionBuilder` legitimately produces multiple sessions per machine per calendar
  day.** It splits a night's data on gaps longer than 30 minutes (naps, mask-off wake
  interruptions, multi-segment nights). One physical day routinely maps to several
  session records.

A `unique` constraint on `[machineId, date]` therefore rejects every 2nd-and-later session
of any day. In a real user import this surfaced as a `ConstraintError` that dropped roughly
**100 sessions** — silent data loss on the second write of each multi-session day. The
constraint also interacts badly with re-imports: a re-import that produces a same-day
session collides with the previously stored one.

Several constraints shaped the fix:

- **IndexedDB index options are immutable after creation.** You cannot toggle a `unique`
  flag in place; the index must be deleted and recreated. That is only permitted inside an
  `onupgradeneeded` versionchange transaction.
- **Existing users already have v1 databases on disk** with the unique indexes baked in.
  The fix must upgrade them losslessly, not wipe and rebuild.
- **Correctness is the #2 core principle** (after Privacy) and this is a clinical-accuracy
  data-loss bug; a partial or fragile fix is unacceptable.
- A `MigrationService` (`src/services/storage/MigrationService.ts`) already existed as a
  full framework (versioned up/down/verify, savepoints, checkpoints) but was **never wired
  into startup** — there was no real migration ledger.

This decision concerns schema correctness and the storage migration path. It builds on
[0001](0001-client-side-architecture.md) (client-side only) and
[0005](0005-dual-storage-indexeddb-opfs.md) (IndexedDB for structured/queryable data).

## Decision

**1. A session's unique identity is its `id` (a UUID); `(machineId, date)` is not unique.**
Multiple sessions per machine per calendar day are a domain invariant, not an anomaly. The
`machineId_date` compound indexes on both `sessions` and `nightly_aggregates` are made
**non-unique**. They remain valuable as ordinary (non-constraining) indexes for
per-machine/per-day range and cursor queries. A session's _natural_ identity for
deduplication is `(machineId, startTime)` / a content `sourceHash` — not the day bucket —
so re-import dedup is handled at the content level, not by a storage uniqueness constraint.

This is encoded in `createSchema()`, which now creates both indexes with `{ unique: false }`
and documents the reasoning inline:

```ts
sessions.createIndex('machineId_date', ['machineId', 'date'], { unique: false });
// ... nightly_aggregates likewise
aggregates.createIndex('machineId_date', ['machineId', 'date'], { unique: false });
```

**2. Ship a versioned, data-preserving migration (v1 → v2).** Because index options are
immutable, `DB_VERSION` is bumped from `1` to `2`. `IndexedDBService.open()` routes
`onupgradeneeded` to `upgradeSchema(db, tx, event.oldVersion)`, which branches on
`oldVersion`:

- `oldVersion < 1` (fresh database): build the full schema with the corrected non-unique
  indexes via `createSchema()`.
- `oldVersion < 2` (existing v1 user): run `migrateV1ToV2()`, which for each of `sessions`
  and `nightly_aggregates` calls `deleteIndex('machineId_date')` then
  `createIndex('machineId_date', ['machineId', 'date'], { unique: false })`.

Recreating only the index preserves every existing row — IndexedDB rebuilds the index from
data already in the store. No object store is dropped and no record is touched. The
operation is idempotent and runs inside the single versionchange transaction.

**3. Wire the dormant `MigrationService` into startup and establish a real ledger.**
`getDB()` (`src/services/storage/getDB.ts`) now, after `open()`, runs a `MigrationService`
seeded with `MIGRATION_001_INITIAL_SCHEMA` and `MIGRATION_002_NONUNIQUE_MACHINE_DATE`
against `TARGET_SCHEMA_VERSION = 2`. The structural index change is still performed by
`onupgradeneeded` (the only place IndexedDB permits it); the migration records' `up`
functions are intentional no-ops. Their job is to maintain the **ledger** — the
`schema_version` key in the `settings` store — as an ordered, auditable history, and to
**verify** each version landed. `MIGRATION_002`'s `verify` opens a read-only transaction
and asserts that `machineId_date` exists and is non-unique on both stores, failing loudly
if a database is left in an inconsistent state. `IndexedDBService.getRawDatabase()` was
added so the ledger can read the raw handle.

This was chosen over the alternatives below because it both fixes the immediate data-loss
bug for all existing users and lays down a real, verifiable migration path for every future
schema change.

## Consequences

### Positive

- **The data-loss bug is fixed.** Multi-session days (naps, interrupted nights) now persist
  every session instead of silently dropping all but the first.
- **Existing v1 databases auto-upgrade losslessly** on the next open — no user action, no
  data wiped, all rows preserved while the indexes are rebuilt non-unique.
- **The domain model is now correct and self-documenting.** `id` is the sole unique
  identity; `(machineId, date)` is explicitly a grouping key, with inline comments at the
  index definitions explaining why uniqueness would be wrong.
- **A real migration ledger now exists.** `schema_version` in the `settings` store is an
  auditable, ordered history, and every registered migration ships a `verify` check.
  Future schema changes have a first-class, tested path instead of a dormant framework.
- **Re-imports are safe and idempotent** because dedup is content-based (`sourceHash` /
  `(machineId, startTime)`) rather than relying on a day-bucket uniqueness constraint.

### Negative

- **Sessions dropped before the fix are not recovered automatically.** Those records were
  never written to disk; the migration only fixes the schema, not history. Affected users
  must re-import the source data. (Content-hash dedup makes re-import safe and idempotent.)
- **The `machineId_date` indexes no longer enforce any uniqueness guarantee.** Duplicate
  protection now depends entirely on application-level dedup (`sourceHash`); a bug there can
  no longer be backstopped by the database. This is the correct trade-off given the domain,
  but it moves a guarantee from the storage layer into application code.
- **Two sources of truth for the target version.** `DB_VERSION` in `IndexedDBService` and
  `TARGET_SCHEMA_VERSION` in `getDB.ts` both encode `2` and must be kept in lockstep; they
  can drift. A follow-up should unify them (single exported constant) so the
  `onupgradeneeded` schema version and the ledger target version cannot diverge.

### Neutral

- The structural change lives in `onupgradeneeded` while the ledger/verification lives in
  `MigrationService`. This split is inherent to IndexedDB (index DDL is only legal in a
  versionchange transaction), so migration records will routinely have no-op `up` functions
  whose real value is the `verify` assertion. This is an accepted pattern, not a smell.
- `MIGRATION_002.down()` is a deliberate no-op: re-introducing the unique constraint would
  re-break multi-session days and cannot run outside a versionchange transaction anyway.
- The `MigrationService` framework retains capabilities (savepoints, checkpoints,
  background/batch migrations, `BackgroundMigrationHandle`) that this migration does not
  exercise; they remain available for future data-transforming migrations.

## Implementation References

- `src/services/storage/IndexedDBService.ts` — `DB_VERSION = 2`; `open()` →
  `onupgradeneeded`; `upgradeSchema()` (oldVersion branching); `migrateV1ToV2()`
  (`deleteIndex` + non-unique `createIndex`); `createSchema()` (non-unique
  `machineId_date` with rationale comments); `getRawDatabase()`.
- `src/services/storage/MigrationService.ts` — `MIGRATION_001_INITIAL_SCHEMA`,
  `MIGRATION_002_NONUNIQUE_MACHINE_DATE` (no-op `up`/`down`, read-only `verify` asserting
  non-unique indexes); `schema_version` ledger via `getCurrentVersion` / `setSchemaVersion`.
- `src/services/storage/getDB.ts` — `TARGET_SCHEMA_VERSION = 2`; `buildMigrationService()`;
  ledger run after `open()` in `getDB()`.

## Related Decisions

- [0001 — Client-Side Architecture](0001-client-side-architecture.md)
- [0005 — Dual Storage Strategy with IndexedDB and OPFS](0005-dual-storage-indexeddb-opfs.md)
