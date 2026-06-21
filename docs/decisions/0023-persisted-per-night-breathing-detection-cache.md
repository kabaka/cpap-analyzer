# 0023 — Persisted Per-Night Breathing-Detection Cache with Parallel Streaming Compute

## Status

Proposed

## Context

The Explore → Breathing Patterns **Episode Catalog** aggregates per-night
periodic-breathing / Cheyne-Stokes (PB/CSR) candidate detections across a
selected date range. It is the cross-night surface for the per-session detector
introduced in [0017](0017-app-computed-breathing-pattern-detection.md): for each
night in scope it reads the full-resolution ventilation/flow signal from OPFS and
runs `detectPeriodicBreathing` to surface `BreathingEpisode` candidates, sorted by
confidence.

Today that catalog computes **live on every visit**, with several structural
limits (`src/hooks/useBreathingEpisodeCatalog.ts`):

- **Sequential, per-mount computation.** Nights are processed one at a time in a
  single dedicated worker so a long range cannot saturate the machine
  (`detectOne` → one `breathing-catalog` worker). Each night costs roughly
  **150–300 ms** (OPFS read of the 25 Hz envelope + detector). A multi-year range
  is therefore minutes of serial work.
- **A hard night cap.** `DEFAULT_CATALOG_NIGHT_CAP = 60` (line 39) bounds the work
  per mount; the date-range result is `slice(0, maxNights)` (line 247) and the UI
  shows a "truncated to keep the page responsive" notice. Users frequently view
  **"all time"** (several years), so the cap silently discards the bulk of the
  range — directly at odds with the catalog's purpose.
- **Ephemeral, surface-local caching only.** A module-level `Map`
  (`catalogCache`) de-dupes within the catalog for the life of the tab, and a
  _separate_ `episodeCache` serves the per-session viewer
  (`src/hooks/useBreathingEpisodes.ts`). Neither survives a reload, neither warms
  the other, and nothing is persisted. Every fresh visit recomputes from OPFS.

The cost is intrinsic to where the work happens, not to the algorithm: PB/CSR
detection is **per-session and deterministic** given a fixed signal and a fixed
parameter set ([0017](0017-app-computed-breathing-pattern-detection.md) specifies
a pure, worker-safe detector). Re-deriving the same episodes from the same OPFS
bytes on every visit is pure waste, and the 60-night cap exists only to keep that
waste from locking the tab.

What the existing architecture already provides:

- **OPFS for full-resolution signals; IndexedDB for structured/queryable data**
  ([0005](0005-dual-storage-indexeddb-opfs.md)). The IndexedDB service
  (`src/services/storage/IndexedDBService.ts`, database `cpap-analyzer`,
  `DB_VERSION = 3`) already hosts `sessions`, `nightly_aggregates`, `events`, and
  `analysis_results`, with a numbered `upgradeSchema()` migration ladder
  (`oldVersion < N` steps) that alters stores **in place without dropping rows**.
- A **date-range-keyed analysis cache** pattern: `analysis_results` keyed by a
  compound unique `type_dateRangeHash` index, with a `cacheVersion` field for
  invalidation (`AnalysisResult` in `src/types/analysis.ts`). This is built for
  _range-scoped_ analyses, not _per-session_ results.
- An **atomic import pipeline**: `ImportService` persists session + nightly
  aggregate + events in one transaction via
  `IndexedDBService.addSessionWithRelated`, and `deleteSessionCascade` tears down
  all per-session metadata atomically (signals in OPFS are deleted separately).
- A **priority WorkerPool** (`src/services/workers/WorkerPool.ts`) with
  min/max workers (`navigator.hardwareConcurrency`), a priority queue,
  `AbortSignal` cancellation, and progress callbacks — already the project's
  mechanism for heavy compute ([0008](0008-web-workers-heavy-computation.md)). The
  catalog does **not** currently use it; it spins up its own single worker.

The product owner has decided the catalog must serve full "all time" ranges
without truncation, responsively. This ADR records the architecture for doing so.
It builds on [0017](0017-app-computed-breathing-pattern-detection.md) (the
detector and its "candidate, never diagnosis" contract),
[0005](0005-dual-storage-indexeddb-opfs.md) (storage split),
[0008](0008-web-workers-heavy-computation.md) (workers), and
[0001](0001-client-side-architecture.md) (everything in-browser).

## Decision Drivers

Resolved against the project priority order (Privacy > Correctness > Performance >
UX > Features):

- **Privacy.** Caching is local-only. Detection results are derived from data
  already on the device and persisted to the same origin-private IndexedDB; nothing
  new leaves the browser. This is satisfied by construction and is non-negotiable.
- **Correctness (decisive constraint on the cache, not the math).** A persisted
  result must **never** be served once it no longer matches what the current
  detector would produce. The detector's algorithm and default parameters
  ([0017](0017-app-computed-breathing-pattern-detection.md)) will evolve; stale
  cached episodes would silently misrepresent clinical candidates — exactly the
  failure mode Correctness forbids. The cache key must therefore bind the result to
  the **algorithm/parameter version** that produced it. We must also preserve
  **full detection** (sub-threshold candidates included); no "fast scan" shortcut
  that would drop `belowDeviceThreshold` episodes.
- **Performance.** The cached read path must serve a multi-year range cheaply
  (indexed per-session lookups, no OPFS I/O on a hit). The uncached compute path
  must use all available cores via the WorkerPool and stream, never block the tab.
- **UX.** Removing the cap means showing honest progress and offering cancellation
  while uncached nights compute; cached nights should appear effectively instantly.
- **Features.** Optional background precompute after import is a welcome capability
  but must never compete with interactive work or violate the above.

## Considered Options

### A. Live-only with the 60-night cap (status quo)

Keep computing every visit, sequentially, capped at 60 nights.

- **Pro:** Zero new storage, zero migration, zero invalidation surface; no risk of
  serving stale results.
- **Con:** **Loses data on the ranges users care about most** ("all time" is
  silently truncated). Recomputes identical results forever. The cap is a UX
  apology for an architectural gap, not a fix. Rejected by the product owner.

### B. Parallelize compute via WorkerPool, but do not persist

Drop the cap and fan nights out across the WorkerPool with streaming + progress +
cancellation, but keep results ephemeral (in-memory only).

- **Pro:** Removes the cap; full range computes; large UX win on first view of a
  range; no migration, no invalidation problem.
- **Con:** **Every reload and every cold range still pays full OPFS + detector
  cost.** For multi-year histories the first paint of "all time" is still tens of
  seconds to minutes of compute, repeated indefinitely. Parallelism reduces the
  constant but not the recurrence. Necessary but insufficient — this is **half** of
  the chosen solution, not an alternative to it.

### C. Persist per-night results in the existing `analysis_results` store

Reuse the `analysis_results` store and its `type_dateRangeHash` cache machinery,
encoding each night as a one-day "range."

- **Pro:** No schema migration; reuses an established cache type and the
  `cacheVersion` invalidation field.
- **Con:** **Semantic and operational mismatch.** `analysis_results` is designed
  for _range-scoped_ analyses keyed by `[analysisType, dateRangeHash]` with a
  **unique** index; modelling thousands of per-night rows as degenerate single-day
  ranges abuses that contract and pollutes a store other analyses share. Crucially,
  these rows are **not linked to `sessionId`**, so `deleteSessionCascade` would not
  remove them — re-importing or deleting a night would orphan its cached episodes,
  and a night with multiple sessions
  ([0016](0016-session-identity-non-unique-machine-date-index.md)) cannot be keyed
  by date alone. Lifecycle correctness would have to be bolted on. Rejected.

### D. Extend `nightly_aggregates` with embedded episode data

Store detected episodes as a field on each night's existing aggregate row.

- **Pro:** Already per-session, already cascade-deleted, already range-queryable by
  date; no new store.
- **Con:** **Couples a tunable, versioned detector output to the import-time
  aggregate.** Aggregates are written once at import by `addSessionWithRelated`;
  embedding episodes there recreates the **import-time-metric trap** that
  [0017](0017-app-computed-breathing-pattern-detection.md) explicitly avoided —
  the data would be frozen at import-parameter values and a detector change would
  force rewriting every aggregate (or leave them inconsistent). It also bloats a
  hot row read on every Dashboard/Trends query with payload most of those reads do
  not need. Rejected.

### E. Store detections as `events`

Materialize cached episodes as `Event` records alongside device events.

- **Pro:** Per-session, cascade-deleted, time-indexed.
- **Con:** [0017](0017-app-computed-breathing-pattern-detection.md) deliberately
  keeps **computed detections separate from device `Event`s** so provenance is
  unambiguous and so the confidence/morphology fields have a home. Folding cached
  candidates into `events` reintroduces exactly the conflation that ADR forbids and
  lacks fields for confidence/cycle-length/`belowDeviceThreshold`. Rejected.

### F. A dedicated per-night breathing-detection store (chosen)

Add a new IndexedDB object store (working name `breathing_detections`) holding one
record per `(sessionId, detectorVersionHash)`, carrying the
`PeriodicBreathingResult` (`episodes`, `recordHours`, `sessionCriterionMet`) plus
the keying metadata. Read it cheaply for the whole range; compute only the misses.

- **Pro:** Purpose-built. Keyed by `sessionId` so it participates in
  `deleteSessionCascade` and survives the multi-session-per-night reality. Keyed
  _also_ by a **detector version hash** so a detector change auto-invalidates
  without touching unrelated caches. Independent of the import-time aggregate
  (no frozen-at-import trap) and isolated from the range-scoped `analysis_results`
  contract. Indexable by `date` for range reads and by version for bulk eviction.
- **Con:** Requires a **v4 schema migration** and new service methods (carrying
  surface area and tests). Storage grows with night count (bounded; see
  Consequences). This is the recommended shape; the database specialist finalizes
  the exact keyPath, indexes, and record schema.

## Decision Outcome

Adopt a **two-part** solution: persist per-night detection results, and make the
uncached path parallel and streaming with no cap.

**1. Persist per-night breathing-detection results in IndexedDB.** Add a
**dedicated per-night store** (Option F, working name `breathing_detections`) via a
**v4 migration** of the `cpap-analyzer` database. Each record holds the
`PeriodicBreathingResult` for one session — `episodes: BreathingEpisode[]`,
`recordHours`, `sessionCriterionMet` — plus keying metadata. The catalog reads this
store across the full date range (indexed, no OPFS I/O on a hit) and computes
**only** the sessions that are missing or stale. **Recommended shape (the database
specialist owns the final schema):**

- `keyPath` an `id` of the form `${sessionId}:${detectorVersionHash}`, or a
  compound `[sessionId, detectorVersionHash]` primary key.
- A non-unique `sessionId` index so `deleteSessionCascade` can sweep all versions
  for a session (the new store joins the existing
  `('sessions','nightly_aggregates','events')` cascade transaction).
- A `date` index for efficient range reads in the catalog.
- A `detectorVersionHash` index for bulk eviction of an entire superseded version.
- Records are written with the same per-session-atomicity discipline used
  elsewhere in `IndexedDBService`.

**2. Auto-invalidate via a detector version hash.** The cache key includes a
**`detectorVersionHash`** derived from (a) a detector **algorithm version**
constant bumped whenever `detectPeriodicBreathing` changes in a result-affecting
way, and (b) a stable hash of the **effective parameter set** used (the
`PeriodicBreathingParams` actually applied, defaulted from
`DEFAULT_PERIODIC_BREATHING_PARAMS`). A read is a **hit only if the stored hash
equals the current hash**; any algorithm or parameter change yields a new hash, so
old records are simply never read and are reclaimed by version-based eviction. This
mirrors the `cacheVersion` discipline already established for `analysis_results`,
applied per-session rather than per-range. **Full detection is always run** — the
detector continues to surface sub-threshold (`belowDeviceThreshold`) candidates;
**there is no device-flag "fast scan" shortcut**, preserving the candidate-episode
correctness contract of
[0017](0017-app-computed-breathing-pattern-detection.md).

**3. Parallel, streaming, uncapped uncached compute.** Replace the single
dedicated `breathing-catalog` worker and the sequential loop with the existing
**WorkerPool** (`src/services/workers/WorkerPool.ts`): uncached nights are
dispatched at **low/background priority** and fanned across available cores.
Results **stream** into the catalog as each night completes (preserving the current
"earliest matches first" ordering and the progress counter), and the whole run is
**cancellable** via `AbortSignal` when the range changes or the view unmounts. The
**`DEFAULT_CATALOG_NIGHT_CAP` hard cap and the `slice(0, maxNights)` truncation are
removed**; "all time" computes its uncached remainder progressively while cached
nights appear immediately. The two ephemeral surface caches (`catalogCache`,
`episodeCache`) become read-through layers in front of the persistent store, so the
viewer and the catalog now warm a **shared** persistent cache rather than diverging.

**4. Optional background precompute after import.** After
`ImportService` persists a session, the app **may** enqueue a low-priority
WorkerPool job to precompute and persist that night's detection at default
parameters, so the catalog is warm on first visit. This is an **optimization, not a
requirement**: it must run strictly below interactive work, must be cancellable,
and must never block import completion or the UI. The on-demand compute path
remains the source of truth; precompute only pre-warms it.

The **clinical contract is unchanged.** Persistence is a performance and lifecycle
concern only: the same detector, the same parameters, the same "candidate, never
diagnosis" framing
([0017](0017-app-computed-breathing-pattern-detection.md)). Caching changes _when_
detection runs, never _what_ it asserts.

## Consequences

### Positive

- **"All time" works.** The 60-night cap is gone; users see the full range —
  cached nights instantly, uncached nights streaming in — instead of a silent
  truncation that loses years of candidates.
- **Reloads and revisits are cheap.** A warm range is indexed IndexedDB reads with
  **no OPFS I/O and no detector runs**, collapsing the dominant recurring cost.
- **Parallelism removes the tab-lock pressure that justified the cap.** Fanning
  uncached nights across cores at low priority, with streaming and cancellation,
  keeps the UI responsive even on a cold multi-year range.
- **Stale results cannot be served.** Binding every cached record to a
  `detectorVersionHash` means an algorithm or parameter change auto-invalidates —
  honoring the Correctness principle without manual cache busting.
- **Lifecycle is correct by construction.** A per-session, `sessionId`-indexed
  store joins `deleteSessionCascade`, so deleting or re-importing a night cleans up
  its cached detections atomically — no orphans, and the multi-session-per-night
  case ([0016](0016-session-identity-non-unique-machine-date-index.md)) is handled.
- **Surfaces converge.** Viewer and catalog share one persistent cache, ending the
  duplicate-compute divergence between `episodeCache` and `catalogCache`.

### Negative

- **Schema migration cost.** A **v4 migration** of `cpap-analyzer` is required
  (new store + indexes). The migration is additive (a `createObjectStore` in the
  `oldVersion < 4` step) and touches no existing data, but it adds a versioned
  step, new `IndexedDBService` methods, and migration tests, and must be exercised
  across the supported browsers.
- **Storage growth.** One record per `(session, detectorVersion)`. Episodes are
  small structured objects (not signals), so per-night payload is modest, but a
  multi-year history is thousands of rows, and a detector-version change transiently
  doubles a session's rows until old versions are evicted. Requires a bounded
  retention/eviction policy (e.g. keep only the current version; sweep superseded
  versions via the `detectorVersionHash` index) and counts against the shared
  origin quota alongside OPFS signals
  ([0005](0005-dual-storage-indexeddb-opfs.md)).
- **Version-hash discipline becomes load-bearing.** Correctness now depends on the
  algorithm-version constant being bumped whenever `detectPeriodicBreathing`
  changes in a result-affecting way, and on the parameter hash being stable and
  complete. A missed bump serves stale clinical candidates; an over-eager or
  unstable hash needlessly discards a valid cache. This must be guarded by tests
  and a clear contributor convention.
- **Background precompute trade-offs.** Precompute spends CPU/battery and storage
  on nights the user may never open in the catalog, and adds scheduling complexity
  (it must yield to interactive work and be cancellable). It is therefore optional
  and conservatively prioritized.
- **More moving parts.** A persistent store, a read-through cache layer, a
  WorkerPool integration, and an eviction policy replace a simple capped loop —
  more surface to test (cache hit/miss/stale, cascade delete, cancellation,
  migration, eviction).

### Neutral

- **OPFS remains the signal source of truth.** The new store caches _derived_
  episode results only; the full-resolution signals stay in OPFS
  ([0005](0005-dual-storage-indexeddb-opfs.md)). A cold/stale cache simply re-reads
  OPFS and recomputes — the cache is an accelerator, never the canonical data.
- **`analysis_results` keeps its range-scoped role.** Per-night detection lives in
  its own store; the existing range-keyed cache (`type_dateRangeHash`,
  `cacheVersion`) is unchanged and continues to serve genuinely range-scoped
  analyses.
- **The detector and its inputs are unchanged.** `PeriodicBreathingResult` and the
  `belowDeviceThreshold` candidate semantics are carried verbatim into the cache;
  this ADR adds persistence and scheduling around the detector, not new clinical
  behavior.
- **Final storage shape is the database specialist's call.** This ADR recommends
  the dedicated per-night store with the keying/indexing above and rejects the
  alternatives; the exact record schema, keyPath, index set, and eviction policy
  are finalized by the `database` specialist during implementation.

## Implementation References

- `src/hooks/useBreathingEpisodeCatalog.ts` — the capped, sequential, ephemeral
  catalog hook (`DEFAULT_CATALOG_NIGHT_CAP` line 39, `slice(0, maxNights)` line
  247, module-level `catalogCache`); becomes a read-through over the persistent
  store with WorkerPool-backed streaming compute.
- `src/hooks/useBreathingEpisodes.ts` — per-session viewer with its own
  `episodeCache`; shares the persistent cache after this change.
- `src/analysis/breathing/detectPeriodicBreathing.ts` — the detector producing
  `PeriodicBreathingResult { episodes, recordHours, sessionCriterionMet }`; its
  algorithm version anchors the cache `detectorVersionHash`.
- `src/analysis/breathing/types.ts` — `PeriodicBreathingParams`,
  `DEFAULT_PERIODIC_BREATHING_PARAMS`, `BreathingEpisode` (incl.
  `belowDeviceThreshold`); the parameter set feeding the version hash.
- `src/services/storage/IndexedDBService.ts` — `cpap-analyzer` (`DB_VERSION = 3`),
  the numbered `upgradeSchema()` ladder (add a v4 step), `addSessionWithRelated`,
  and `deleteSessionCascade` (the new store joins its transaction).
- `src/types/analysis.ts` — `AnalysisResult` / `cacheVersion`: the existing
  range-keyed cache pattern the per-night version-hash invalidation mirrors.
- `src/services/import/ImportService.ts` — atomic per-session persistence; the
  optional post-import precompute hooks in here.
- `src/services/workers/WorkerPool.ts` — priority queue, min/max workers,
  `AbortSignal` cancellation, progress callbacks; backs the parallel streaming
  compute and the background precompute.

## Related Decisions

- [0001 — Client-Side Architecture](0001-client-side-architecture.md)
- [0005 — Dual Storage Strategy with IndexedDB and OPFS](0005-dual-storage-indexeddb-opfs.md)
- [0008 — Web Workers for Heavy Computation](0008-web-workers-heavy-computation.md)
- [0016 — Session Identity and Non-Unique machine/date Index](0016-session-identity-non-unique-machine-date-index.md)
- [0017 — App-Computed Breathing-Pattern Detection](0017-app-computed-breathing-pattern-detection.md)
