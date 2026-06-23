# 0029 — Bounded Look-Ahead Pipelining for CPAP Import

## Status

Accepted — 2026-06-23

## Context

The CPAP/EDF import pipeline (`src/services/import/ImportService.ts`) processes the data day-group by day-group in a **strict serial loop**: for each day it parses that day's files (concurrently within the day, across the worker pool), builds sessions, validates them, and stores the result (IndexedDB metadata + OPFS signal chunks), and only then moves to the next day. Because parsing and storing **strictly alternate**, the worker pool sits idle for the entire build → validate → store phase of every day-group.

This is a deliberate streaming design: the loop holds **exactly one day-group's parsed buffers in memory at a time**, giving an explicit O(1-day) memory bound that lets multi-year imports run without unbounded heap growth. Parsing is already off-thread on the worker pool (see [0008](0008-web-workers-heavy-computation.md)), and the orchestration runs in the background controller introduced in [0026](0026-background-import-controller-outside-react-tree.md).

The benchmarking added in this PR — the gated `ImportProfiler` plus a real-browser Playwright harness — quantifies the cost of the strict alternation:

- **Many small days:** the **store phase is ~83% of wall time** (OPFS writes ~70%, IndexedDB ~12%), while the worker pool is only **~6–8% busy**. The pool idles for the overwhelming majority of the import.
- **Few large nights:** parse ~57% / store ~40%, with the pool peaking at **3 of 4 workers** (a single 8h night cannot fill a 4-wide pool on its own).
- Across both shapes, **the pool idles 80–94% of the store phase** — there is parse work available (the next day), but the loop refuses to start it until the current day has finished storing.

The bottleneck is therefore **work supply during the store tail**, not raw parse throughput and not the worker-pool width.

Relevant constraints and prior decisions:

- **Privacy (priority 1):** No new network surface; this is an in-browser control-flow change only.
- **Correctness (priority 2):** Deduplication mutates **shared in-memory key sets** — a source-content hash set and a machine/start-time natural-key set — that are **read-then-written per session** as day-groups are stored. Storage also uses a per-session **IndexedDB-commit-then-OPFS-write with compensating-delete** consistency protocol. Both are order- and single-writer-sensitive (see [0016](0016-session-identity-non-unique-machine-date-index.md)). Cancellation must continue to land on consistent boundaries (see [0026](0026-background-import-controller-outside-react-tree.md)).
- **Performance (priority 3):** The measured idle pool is the target.
- **Infrastructure:** The worker pool, the per-job `AbortSignal` / `checkpoint(signal)` mechanism, and the background `ImportController` already exist (see [0008](0008-web-workers-heavy-computation.md), [0026](0026-background-import-controller-outside-react-tree.md)).
- The STR-first **settings phase** runs once, before any day-group, and is independent of the per-day loop.

Per the profiler, a full 8h night parses to **~10.5 MB**; a small day is **~0.04 MB**. The existing per-file cap is **100 MB**.

Alternatives considered:

- **(a) Bounded look-ahead pipelining with single-flight store.** A producer parses upcoming day-groups (filling the pool) and runs ahead of a single-flight consumer that builds → validates → stores in day order. Look-ahead is bounded by **in-flight parsed bytes**, not a day count. **Chosen.**
- **(b) Full producer/consumer with concurrent multi-day store.** Pipeline the store stage too, storing several day-groups at once. **Rejected:** concurrent stores race the shared dedup key sets (read-then-write per session) and force the IDB-then-OPFS compensation protocol to become concurrency-safe — a substantial correctness risk for the part of the system where correctness is least negotiable. Correctness > Performance.
- **(c) Raise the worker-pool cap past its current limit.** **Rejected:** the measured bottleneck is the idle pool during the store tail, not the cap. Without pipelining there is no additional work to hand the extra workers — even a 1-of-4 utilisation never approaches the existing ceiling, so raising it buys nothing.
- **(d) Status quo.** **Rejected:** leaves the pool idle 80–94% of the store phase, the exact inefficiency the profiler was built to expose.

## Decision

Adopt **option (a): bounded look-ahead pipelining**.

Restructure the per-day loop into a **producer/consumer** pair within a single day-group ordering:

- The **producer** parses upcoming day-groups eagerly, keeping the worker pool fed so that parse work for day _N+1_ overlaps the store tail of day _N_.
- The **consumer** is **single-flight** and processes day-groups **strictly in order**: build → validate → store, exactly as today.

Look-ahead is **bounded by in-flight parsed bytes ≤ 64 MB**, not by a day count. The producer admits the next day-group's parse only while under that budget, and **always admits at least one** day-group regardless of size, so a single oversized night still makes progress and never deadlocks the budget. Choosing a byte budget rather than a day count keeps the bound meaningful across both import shapes: at ~10.5 MB per large night, 64 MB is **~6 nights** in flight; at ~0.04 MB per small day, it is **hundreds of days** in flight. Either way the in-flight total stays well under the existing 100 MB/file cap.

Correctness-preserving constraints that shape this decision (these are part of the decision, not incidental):

- **The settings phase is unchanged.** STR-first settings resolution completes before any day-group; look-ahead is confined entirely to the per-day phase.
- **The store stage stays strictly single-flight, in day order.** Only **parsing** — which is read-only over its inputs — is pipelined. The dedup key sets are still mutated by exactly one writer at a time, in deterministic order, so dedup results are byte-for-byte identical to the serial loop. Storing two day-groups concurrently is explicitly **out of scope** (option (b), rejected above).
- **The per-session IDB-commit-then-OPFS-write-with-compensating-delete protocol is untouched.** Pipelining changes _when_ parse work starts, never _how_ a day is committed.
- **Cancellation semantics are preserved.** `checkpoint(AbortSignal)` still lands at store boundaries, so an abort leaves IndexedDB/OPFS consistent (already-stored days complete, no half-written day). On abort, **queued look-ahead parse tasks are dropped** rather than awaited.

The central trade-off, stated explicitly: this **relaxes the documented per-day O(1-day) memory invariant to O(64 MB in-flight)**. That is the price of overlapping the idle pool with the store tail, and 64 MB is justified directly by the measured per-day parsed sizes above.

A small, related implementation detail ships alongside but is **not** its own decision: **OPFS chunk writes within a single session** are issued in parallel (the per-session ordering and the IDB-then-OPFS protocol are unchanged; only the independent chunk writes of one session overlap).

### Justification against the priority order

- **Privacy:** Unaffected — no network surface, no new persistence mechanism; purely in-memory control flow over the storage layers already in use.
- **Correctness:** The decisive constraint. By pipelining only the read-only parse stage and keeping store **single-flight and in order**, the shared dedup state and the IDB/OPFS consistency protocol behave exactly as in the serial loop. Option (b)'s concurrent store was rejected precisely because it would put that guarantee at risk for a performance gain.
- **Performance:** Directly attacks the measured 80–94% pool idle during the store tail by ensuring parse work for the next day is already running. Option (c) was rejected because more workers without more work supply changes nothing.
- **User experience:** Faster imports — especially the many-small-days case dominated by the store phase — with continuous background progress retained from [0026](0026-background-import-controller-outside-react-tree.md).
- **Features:** No feature surface change.

## Consequences

### Positive

- **Large speedup on many-day imports:** the previously-idle worker pool now parses ahead during the store-dominated tail, overlapping the ~83% store phase with parse work instead of stalling on it.
- **Better pool utilisation on large nights too:** the producer can begin the next night's parse before the current night finishes storing, filling the pool past the single-night ceiling.
- **Bounded, predictable heap growth:** the 64 MB in-flight cap gives a deterministic upper bound that scales sensibly across both small-day and large-night imports and stays under the 100 MB/file cap.

### Negative

- **Relaxed memory invariant:** the per-day O(1-day) bound becomes O(64 MB in-flight). This is the deliberate central trade-off — modest and predictable, but a real increase in peak heap during import.
- **More complex control flow:** a producer/consumer with a byte-budgeted admission gate is harder to reason about than a strict serial loop. Mitigated by keeping the store stage single-flight and reusing the existing `checkpoint(signal)` boundaries rather than inventing new ones.
- **New failure surface at the producer boundary:** a parse error on a looked-ahead day surfaces before its store turn and must be attributed to the correct day-group and abort the rest cleanly.

### Neutral

- **The single-flight store path is unchanged.** Dedup ordering, natural-key resolution, and the IDB-then-OPFS compensation protocol are byte-for-byte as before; only parse scheduling moves earlier.
- **Cancellation behaviour is preserved**, with the only addition being that queued look-ahead parse tasks are discarded on abort (consistent with [0026](0026-background-import-controller-outside-react-tree.md)).
- **The 64 MB budget is a tunable constant**, not a structural commitment; it can be revisited from profiler data without changing the architecture.
- **Parallel within-session OPFS chunk writes** ride along as an implementation detail and do not alter stored shapes or per-session ordering.
- **Diagnostic `errors`/`warnings` array ordering** now reflects parse-completion order rather than strict day order, because parsing runs concurrently across day-groups. This is cosmetic: counts are unchanged, nothing persisted or de-duplicated depends on the order (the overall source hash sorts before hashing, and build results stay day-ordered), and no consumer relies on cross-day diagnostic ordering. The "byte-for-byte identical" guarantee above is precise about store/dedup state, not these diagnostic arrays.
