# 0027 — Move Fitbit (Google Health) Parsing to Web Workers

## Status

Accepted — 2026-06-23

## Context

Google Health / Fitbit parsing currently runs **entirely on the main thread**, in `src/services/import/googlehealth/parsers.ts` and `src/services/import/googlehealth/GoogleHealthImportService.ts`.

The intraday heart-rate parser is the worst offender:

- It does a **synchronous `JSON.parse`** of large per-day files (~17,000 samples each).
- It then runs `.sort()` and `.map()` over the **whole** array.
- There is **no yielding** and **no progress reporting** between parse-start and the storage phase.

On large datasets or slower hardware this **freezes the UI for minutes**, with no feedback. This is inconsistent with the rest of the pipeline: EDF parsing already runs in a worker pool (see [0008](0008-web-workers-heavy-computation.md)), but Fitbit parsing does not. It is also the residual main-thread cost left unaddressed by the import-controller refactor (see [0026](0026-background-import-controller-outside-react-tree.md)).

Relevant constraints and prior decisions:

- **Correctness (priority 2):** Fitbit parsing is timezone-sensitive. In particular `parseFitbitLegacyDateTime` is **load-bearing**: its handling of legacy timestamps determines which day a sample lands on. Any move must be byte-for-byte behaviour-preserving.
- **Performance (priority 3):** The freeze is a main-thread blocking problem, and the parse functions are **pure** — ideal candidates for relocation to a worker.
- **Infrastructure:** We already have a `WorkerPool` and Comlink-based typed RPC (see [0008](0008-web-workers-heavy-computation.md)); a new parser worker should reuse it rather than invent new plumbing.
- The storage path (`processTimeseriesRecords`) is already correct and must remain unchanged.

Alternatives considered:

- **(A) Chunked main-thread parsing with yields.** Break the post-parse `.sort()`/`.map()` into chunks that yield to the event loop. Rejected as the _sole_ fix: the per-file `JSON.parse` itself is a single synchronous blocking call that yielding cannot break up, and the GC pressure from materializing large arrays on the main thread still drops frames. It treats the symptom, not the freeze.
- **(B) Move parsing into a Web Worker.** Run the heavy parsers off the main thread on the existing pool. Only this fully removes the main-thread freeze, and because the parsers are pure they port cleanly. **Chosen.**
- **(C) Streaming / SAX-style JSON parsing.** Parse the per-file JSON incrementally to bound peak memory. Rejected for now: large correctness and code-surface cost for a _per-file_ benefit that is **already hidden once parsing is off-thread** (a main-thread freeze is the user-visible problem; per-file peak memory is not). Documented as a fallback if worker-side memory becomes a problem.

A further option was raised and explicitly **deferred** (see below): a columnar transferable typed-array intraday representation.

## Decision

Adopt **option (B)**: move the heavy Fitbit parsers — **intraday heart rate, SpO2, HRV, and snoring** — into a dedicated **`fitbitParser.worker.ts`** driven by the existing `WorkerPool` / Comlink infrastructure.

Mechanics:

- **Extract pure parse functions** (and their pure `csv-utils` dependencies) into a **worker-safe module** shared between the worker and unit tests. The functions move **verbatim** — notably `parseFitbitLegacyDateTime`, which is timezone-load-bearing and **must not change** during the move.
- **Determinate progress at two levels:** the worker reports **per-file** progress and **per-chunk** progress within a file. Entries are chunked (~2,000 per chunk) with progress callbacks **proxied via Comlink** back to the orchestrator (which coalesces them per the [0026](0026-background-import-controller-outside-react-tree.md) rAF batching).
- **Storage is unchanged:** `processTimeseriesRecords` continues to run as before; only the parse step relocates.

**Correctness gate (blocking):** before switching the orchestrator to the worker path, **golden-fixture tests** must assert **byte-identical parsed output** between the existing main-thread parser and the new worker parser across representative fixtures (including legacy-timestamp and timezone-edge cases). The cutover does not land until these pass.

### Justification against the priority order

- **Correctness first:** The verbatim move plus a golden-fixture byte-equality gate makes this a behaviour-preserving relocation, not a rewrite. The timezone-load-bearing function is protected explicitly.
- **Performance:** Only (B) removes the main-thread freeze; (A) cannot break up the synchronous `JSON.parse`. Two-level determinate progress also replaces a multi-minute dead UI with continuous feedback.
- **Consistency:** Aligns Fitbit parsing with the already-pooled EDF parsing and plugs the residual main-thread gap from [0026](0026-background-import-controller-outside-react-tree.md).

## Consequences

### Positive

- **No more main-thread freeze:** the synchronous `JSON.parse`, `.sort()`, and `.map()` run off-thread; the UI stays responsive during Fitbit import.
- **Determinate, two-level progress:** per-file and per-chunk callbacks give the user real feedback where there was previously none.
- **Architectural consistency:** Fitbit and EDF parsing both run on the shared worker pool with one set of pooling/lifecycle behaviours.
- **Test-protected cutover:** golden-fixture byte-equality makes the regression risk explicit and gated rather than implicit.

### Negative

- **Serialization cost at the worker boundary:** parsed records cross from worker to main thread; for very large days this clone is non-trivial (a motivation for the deferred columnar option below).
- **Worker memory:** the per-file `JSON.parse` peak now lives in the worker heap. If a single file is pathologically large, the streaming fallback (option C) may become necessary.
- **Two code paths during migration:** until the golden-fixture gate passes and the old path is removed, both parsers exist and must stay in sync.

### Neutral

- The pure parsers are now imported by both the worker and unit tests via the shared worker-safe module; the module boundary is a new (but small) maintenance surface.
- Progress callbacks are proxied via Comlink, which is already how worker communication works in this codebase (see [0008](0008-web-workers-heavy-computation.md)).

### Deferred (considered, not decided here)

- **Columnar transferable typed-array intraday representation** (e.g. `Int32` timestamps, `Int16`/`Uint8` values). This would yield **zero-copy `Transferable`** serialization across the worker boundary and a smaller **stored** footprint. It is **deferred to a separate ADR** because it **changes the stored data shapes** and therefore requires independent correctness review (migration, dedup behaviour, and downstream consumers). It is recorded here as explicitly considered so the future work is traceable, but it is **not** part of this decision.
