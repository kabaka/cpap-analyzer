# 0026 — Background Import Controller Outside the React Tree

## Status

Accepted — 2026-06-23

## Context

Imports (CPAP/EDF via the worker pool, and Google Health/Fitbit) currently bind their lifecycle to a React component. In `src/hooks/useImport.ts`:

- The `ImportService` / `GoogleHealthImportService` instances are created **inside the hook**, so they live and die with the component that mounts it.
- Progress lives in component-local `useState` plus the app store.
- The cancellation handle is a React ref (`abortRef`).

This couples a long-running, cross-cutting process to the render tree, with two concrete failures:

1. **Orphaned imports on navigation.** Navigating away from the import view unmounts the component. The in-flight import keeps running, but its completion/progress handlers now write into an unmounted component (stale closures, React "update on unmounted component" hazards). The user loses all visibility into an import that is still consuming CPU.
2. **Cancellation is fake.** "Cancel" only discards the result on the main thread. The worker pool keeps parsing every queued file to completion in the background — wasting CPU and battery and delaying anything else queued behind it.

The product owner wants imports to **run in the background while the user navigates the app**, with a **persistent progress indicator**, and a **Cancel that actually stops work**.

Relevant constraints and prior decisions:

- **Privacy (priority 1):** No backend exists and none may be added. Any "durability" must stay within the existing client-side, per-page storage model (IndexedDB/OPFS). We will not introduce a new persistence mechanism (e.g., resumable-import journals) as a side effect of this change.
- **Correctness (priority 2):** The storage-consistency protocol (per-day / per-batch writes, idempotent via dedup) must remain intact. Cancellation must leave IndexedDB/OPFS in a consistent state — never a half-written day.
- **Performance (priority 3):** EDF parsing is already off-thread in the worker pool (see [0008](0008-web-workers-heavy-computation.md)). The remaining problem is lifecycle and control-flow, not raw compute throughput.
- We already use **Zustand** for cross-cutting app state (see [0004](0004-zustand-state-management.md)), and Zustand stores are plain modules that live outside the React tree.

Alternatives considered:

- **(a) Long-lived module-level singleton controller, orchestrated on the main thread.** Owns service instances, the worker pool, and a per-job `AbortController`; publishes progress to a Zustand store. Decouples lifecycle from rendering with minimal moving parts. EDF parse stays in the existing pool.
- **(b) Full orchestration Web Worker** that owns the entire pipeline — scan → parse → build → validate → store — including IndexedDB/OPFS access from inside the worker. Maximally isolates the main thread, but requires porting the storage-consistency protocol (per-day/per-batch idempotent writes) into a worker context. High correctness risk for marginal benefit, since the expensive EDF parse is already pooled and off-thread. Rejected for now.
- **(c) Keep lifecycle in React but add a global "is importing" flag** and re-attach handlers on remount. Rejected: does not fix orphaning (work still tied to a component that may be unmounted), does not make cancellation real, and re-attachment across remounts is fragile.

## Decision

Introduce a **module-level singleton `ImportController`** that lives **outside the React tree** and owns the entire import lifecycle. This is the core of a **hybrid** architecture — option (a) for orchestration, with heavy Fitbit parsing moved off-thread separately in [0027](0027-fitbit-googlehealth-parsing-web-workers.md).

The `ImportController` owns:

- The `ImportService` and `GoogleHealthImportService` instances (created once, not per-component).
- The `WorkerPool` used for parsing.
- A **per-job `AbortController`**, replacing the React ref.

Progress is written into a dedicated **`useImportStore`** (Zustand) that any component can subscribe to. React components no longer create services or hold lifecycle state; they only:

- **subscribe** to `useImportStore` for progress/status (enabling a persistent, app-wide progress indicator), and
- **dispatch** `start()` / `cancel()` on the controller.

Two correctness/performance mechanisms:

1. **Coalesced progress writes.** Progress updates from the pipeline are batched and flushed via `requestAnimationFrame` — **one store write per frame** — so a high-frequency progress stream cannot thrash subscribers or starve rendering.
2. **End-to-end `AbortSignal`.** The job's `AbortSignal` is threaded through the pipeline. A `checkpoint(signal)` helper is invoked at the **existing yield points** (between files, between batches) and throws/aborts there. Because storage is **per-day/per-batch and idempotent via dedup**, aborting at a checkpoint leaves IndexedDB/OPFS consistent: already-committed days remain valid and complete, and no partial day is left behind.

Singleton lifecycle hygiene: the controller reaps/disposes the worker pool when idle so the long-lived singleton does not pin worker heaps indefinitely (see the idle-reaping behaviour in [0008](0008-web-workers-heavy-computation.md)).

### Justification against the priority order

- **Privacy:** No new network surface and no new persistence mechanism — the controller is an in-memory main-thread object writing to the storage layers we already use. Option (b) was not rejected on privacy grounds but adds no privacy benefit either.
- **Correctness:** The decisive factor. The chosen design keeps the storage-consistency protocol exactly where it already lives and works, and makes abort land only at idempotent checkpoints. Option (b) would have re-implemented that protocol inside a worker — unacceptable correctness risk for this change.
- **Performance:** EDF parse is already pooled, so option (a) loses almost nothing versus (b) while rAF-coalesced progress protects frame rate. The residual main-thread cost (Fitbit parsing) is addressed in [0027](0027-fitbit-googlehealth-parsing-web-workers.md).
- **User experience:** Directly delivers the requested behaviour — background imports during navigation, a persistent progress indicator, and a Cancel that truly stops work.

## Consequences

### Positive

- **True background import:** imports survive navigation because their lifecycle is no longer tied to a mounted component.
- **Real cancellation:** `cancel()` aborts the `AbortController`; the next `checkpoint(signal)` stops the pipeline and the worker pool stops parsing further files, freeing CPU/battery immediately.
- **Unified, persistent progress:** a single `useImportStore` is the one source of truth for import status, so any view (or a global indicator) can render it consistently.
- **Cleaner separation:** React components are reduced to subscribe + dispatch; orchestration logic is testable in isolation without a render tree.
- **Frame-rate safety:** rAF-coalesced writes bound store churn to one update per frame.

### Negative

- **Singleton risks leaking resources:** a long-lived controller can pin a worker pool if not disposed. Mitigated by pool idle-reaping/disposal, but this is now a responsibility we must maintain and test.
- **Global mutable state outside React:** module-level singletons are harder to reset between tests and can hide ordering bugs; tests must explicitly reset the controller and store.
- **Checkpoint discipline required:** correctness of cancellation depends on `checkpoint(signal)` being present at every yield point. A missing checkpoint silently degrades cancellation latency.

### Neutral

- **Tab close still ends the import.** There is no resumable-import journal. This is deliberate and consistent with the privacy / per-page model: durable **partial** results already written remain valid, and re-importing the same data is cheap because dedup **skips already-stored days**. This is documented behaviour, not a regression — and explicitly **no new persistence mechanism is added**.
- Single-tab assumption is retained (consistent with [0008](0008-web-workers-heavy-computation.md)); the controller is not shared across tabs.
- Progress shape is now defined by `useImportStore` rather than ad-hoc component state, which fixes the contract but means progress changes must update the store schema.
