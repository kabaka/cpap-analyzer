# 0030 — Bounded Look-Ahead Overlap of Parse and Store for Google Health (Fitbit) Heavy Types

## Status

Accepted — 2026-06-23

## Context

The heavy Google Health / Fitbit parsers — intraday heart rate, intraday SpO2, HRV detail, and snoring — now run in a dedicated worker pool (see [0027](0027-fitbit-googlehealth-parsing-web-workers.md)). A subsequent refinement (PR #67, "stream-to-store") changed the orchestrator so that, for a given heavy data type, it parses and stores files **strictly one at a time**: parse file _N_ in the worker, await it, store file _N_'s records, release them, then parse file _N+1_. That deliberately bounded peak memory to **~O(one file)** so multi-year exports — which can be hundreds or thousands of per-day files — do not accumulate parsed records on the heap.

The benchmarking added in this PR — the gated `ImportProfiler` plus a real-browser harness — quantifies the cost of that strict alternation:

- During the store of file _N_, the parser/worker is **idle for ~100% of the store time**.
- That idle window is **~30% of the heaviest data type's total wall time**, because parse and store never overlap: every store phase stalls the worker that could already be parsing the next file.

The idle is reclaimable: parsing file _N+1_ is read-only over its own input and has no dependency on file _N_'s store completing, yet #67's strict serialization refuses to start it until file _N_ is fully stored.

Relevant constraints and prior decisions:

- **Privacy (priority 1):** No new network surface; this is an in-browser control-flow change only.
- **Correctness (priority 2):** Deduplication is **DB-keyed on `(source, dataType, date)`**. Storing file _N_ **before** parsing/storing file _N+1_, in file order, is what lets a within-import cross-file duplicate (two files contributing the same `(source, dataType, date)`) be detected and skipped **exactly once**. Any reordering or concurrency of the store stage would put that guarantee at risk. Cancellation must continue to land on consistent boundaries (see [0026](0026-background-import-controller-outside-react-tree.md)).
- **Performance (priority 3):** The measured ~100%-idle worker during the store tail is the target.
- **Infrastructure:** The worker pool, the per-job `AbortSignal` / `checkpoint(signal)` mechanism, and the background `ImportController` already exist (see [0008](0008-web-workers-heavy-computation.md), [0026](0026-background-import-controller-outside-react-tree.md), [0027](0027-fitbit-googlehealth-parsing-web-workers.md)).

This is the **Fitbit-side analogue** of the CPAP pipelining decided in [0029](0029-bounded-look-ahead-pipelining-cpap-import.md): the same shape of inefficiency (an idle worker pool during a store-dominated tail) and the same remedy (overlap the read-only parse stage while keeping store single-flight and in order).

Alternatives considered:

- **(a) Bounded look-ahead overlap with single-flight store.** While the single-flight consumer stores file _N_, the producer parses file _N+1_ (and up to a small bounded look-ahead) in the worker pool. **Chosen.**
- **(b) Keep strict serial parse→store (the #67 status quo).** **Rejected:** leaves the worker idle ~100% of the store time — about ~30% of the heaviest type's wall time — which the profiler was built to expose.
- **(c) Parse all files ahead, then store.** **Rejected:** reintroduces the exact unbounded-memory problem that #67 fixed; a multi-year export would hold every parsed day-file on the heap at once.
- **(d) Concurrent multi-file store.** **Rejected:** storing multiple files at once races the `(source, dataType, date)` dedup keying — a within-import cross-file duplicate could be committed twice or skipped inconsistently. Correctness > Performance.

## Decision

Adopt **option (a): bounded look-ahead overlap of parse and store**.

For each heavy data type, restructure the per-file loop into a **producer/consumer** pair within a single file ordering:

- The **producer** parses upcoming files eagerly in the worker pool, so that the parse of file _N+1_ (and a small bounded look-ahead beyond it) overlaps the store of file _N_.
- The **consumer** is **single-flight** and processes files **strictly in file order**: store file _N_'s records, then file _N+1_'s, exactly as #67 does today.

The look-ahead is **bounded** — by a small in-flight file count and/or a modest in-flight parsed-byte budget (on the order of a couple of parsed day-files). The budget is deliberately small: the whole point of #67 was the O(one file) bound, and the only inefficiency the profiler found is the single idle store window. Overlapping that window requires only the **one** next file to be ready when the current store finishes; a look-ahead of roughly one-to-two files in flight fully hides the ~100% store idle without drifting back toward "hold everything." The producer always admits at least the next file regardless of size, so an oversized file still makes progress and never deadlocks the budget.

Correctness-preserving constraints that shape this decision (these are part of the decision, not incidental):

- **The store stage stays strictly single-flight, in file order.** Only **parsing** — read-only over its own input, in the worker — is pipelined. Because file _N_ is always fully stored before file _N+1_ is stored, the `(source, dataType, date)` dedup keying sees the same writes in the same order as the #67 serial loop, so a within-import cross-file duplicate is still detected and skipped **exactly once**. Storing two files concurrently is explicitly **out of scope** (option (d), rejected above).
- **Memory stays bounded** by the look-ahead budget. This is an explicit, modest refinement of #67's O(one file) bound to **O(look-ahead)** — not a reversal of #67. The budget is kept to about a couple of parsed day-files so peak heap stays close to the #67 bound and far from the pre-#67 "hold everything" problem.
- **Progress counters stay monotonic.** Per-file/per-chunk progress (see [0027](0027-fitbit-googlehealth-parsing-web-workers.md)) is still emitted in store order, so the user never sees progress go backwards even though parsing now runs ahead.
- **Cancellation semantics are preserved.** `checkpoint(AbortSignal)` still lands **between files**, so an abort leaves the database in a consistent state (already-stored files complete, no half-stored file). On abort, **queued look-ahead parse tasks are dropped** rather than awaited.
- **Persisted output is identical.** The bytes written to storage, and the dedup decisions that produced them, are byte-for-byte the same as the #67 serial path; only _when_ parse work starts changes.

The central trade-off, stated explicitly: this **relaxes #67's O(one file) peak-memory bound to O(look-ahead)** — a small, fixed number of parsed files in flight. That is the price of overlapping the idle worker with the store tail, and the budget is kept intentionally small because hiding a single store window only requires the next file to be ready.

### Justification against the priority order

- **Privacy:** Unaffected — no network surface, no new persistence mechanism; purely in-memory control flow over the storage layer already in use.
- **Correctness:** The decisive constraint. By pipelining only the read-only parse stage and keeping store **single-flight and in file order**, the `(source, dataType, date)` dedup keying behaves exactly as in the #67 serial loop. Option (d)'s concurrent store was rejected precisely because it would race that keying; option (c) was rejected because, while it preserves correctness, it sacrifices the memory bound that protects multi-year imports.
- **Performance:** Directly attacks the measured ~100% worker idle during the store window — ~30% of the heaviest type's wall time — by ensuring the next file is already parsing when the current store finishes. The gain scales with file count, so multi-year exports benefit most.
- **User experience:** Faster heavy-type imports with the determinate, monotonic progress from [0027](0027-fitbit-googlehealth-parsing-web-workers.md) retained.
- **Features:** No feature surface change.

## Consequences

### Positive

- **~30% faster import of the heaviest data type:** the previously ~100%-idle worker now parses ahead during the store window instead of stalling on it. The gain **scales with file count**, so multi-year Fitbit/Google Health exports — the worst case under #67 — benefit the most.
- **Bounded, predictable heap growth:** the small in-flight look-ahead budget gives a deterministic upper bound that stays close to #67's O(one file) and far from the pre-#67 unbounded accumulation.
- **Architectural consistency:** mirrors the CPAP-side pipelining of [0029](0029-bounded-look-ahead-pipelining-cpap-import.md) — same producer/consumer-with-single-flight-store shape — so both import paths reason about overlap the same way.

### Negative

- **Relaxed memory invariant:** #67's O(one file) bound becomes O(look-ahead). This is the deliberate central trade-off — modest and predictable, but a real increase in peak heap during import.
- **Slightly more complex control flow:** a producer/consumer with a bounded admission gate is harder to reason about than the strict serial parse→store of #67. Mitigated by keeping the store stage single-flight and reusing the existing `checkpoint(signal)` between-file boundaries rather than inventing new ones.
- **New failure surface at the producer boundary:** a parse error on a looked-ahead file surfaces before its store turn and must be attributed to the correct file and abort the rest cleanly.

### Neutral

- **#67's memory decision is refined, not reversed.** The streaming, single-file-store philosophy of #67 is preserved; only the strict O(one file) ceiling is loosened to a small O(look-ahead) budget to reclaim the idle store window.
- **The single-flight store path is unchanged.** Dedup keying on `(source, dataType, date)`, store ordering, and persisted output are byte-for-byte as in #67; only parse scheduling moves earlier.
- **Cancellation behaviour is preserved**, with the only addition being that queued look-ahead parse tasks are discarded on abort (consistent with [0026](0026-background-import-controller-outside-react-tree.md) and [0029](0029-bounded-look-ahead-pipelining-cpap-import.md)).
- **The look-ahead budget is a tunable constant**, not a structural commitment; it can be revisited from profiler data without changing the architecture.
