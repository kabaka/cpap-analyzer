# 0008 — Web Workers for Heavy Computation

## Status

Accepted

## Context

CPAP Analyzer performs computationally expensive operations that could block the main thread and freeze the UI:

- EDF file parsing (6 MB binary files, 1-2 seconds parsing time)
- Signal processing (millions of samples: filtering, FFT, anomaly detection)
- Statistical analysis (correlation matrices, time-series decomposition, clustering)
- Level-of-detail downsampling (LTTB algorithm on 720k samples)
- Data export (generating large CSV/JSON files)

Performance requirements:

- UI must remain responsive (< 100ms input delay) during background processing
- Import progress updates must render smoothly (60 FPS)
- Chart interactions (zoom, pan) must not be blocked by analysis
- Multi-core systems should parallelize heavy workloads

Main thread constraints:

- JavaScript is single-threaded
- Long-running synchronous operations block rendering
- Users perceive unresponsiveness if input delay > 100ms
- Browser may show "Page Unresponsive" dialog for operations > 5 seconds

Alternatives considered:

- **Main thread only with setTimeout chunking**: Break work into small chunks with setTimeout delays to yield to event loop. Rejected: adds complexity, unpredictable timing, still blocks between chunks.
- **requestIdleCallback**: Execute work only during browser idle time. Rejected: not suitable for high-priority operations; idle time may not occur for seconds; no parallelization.
- **WebAssembly**: Compile performance-critical code to WASM for speed boost. Rejected: still runs on main thread unless used with Web Workers; complexity not justified when JavaScript performance is sufficient in Workers.
- **Service Worker**: Background thread primarily for network caching. Rejected: not designed for computation; limited API access; lifecycle tied to service worker events.
- **Shared Workers**: One worker shared across tabs. Rejected: CPAP Analyzer is single-tab application; shared state adds complexity without benefit.

## Decision

Use **dedicated Web Workers** for all heavy computation with **Comlink** for typed communication.

Worker usage:

- **EDF Parser Worker**: Parse EDF files (~2s per file)
- **Signal Processing Worker**: Filter, resample, compute statistics on high-frequency signals
- **Analysis Workers** (pool): Execute statistical analysis algorithms in parallel
- **Downsampling Worker**: LTTB and min-max downsampling for visualization
- **Export Worker**: Generate large CSV/JSON/PDF export files

Worker communication:

- **Comlink** library provides typed RPC-style communication (functions, async/await, proxying)
- Eliminates manual postMessage boilerplate and serialization errors
- TypeScript types preserved across worker boundary

Worker pool strategy:

- Create worker pool with size = `navigator.hardwareConcurrency` (typically 4-12)
- Reuse workers for multiple tasks to avoid creation overhead
- Terminate idle workers after 30 seconds to free memory
- Queue tasks when all workers busy

Data transfer optimization:

- Use `Transferable` objects (ArrayBuffer, ImageBitmap) for zero-copy transfer
- Large datasets (signal arrays) transferred via Transferable, not cloned
- Avoid transferring large objects unless necessary; pass IndexedDB/OPFS references instead

Error handling:

- Workers catch errors and send structured error responses
- Main thread retries failed operations once
- Errors displayed to user with option to export error log

## Consequences

### Positive

- UI remains responsive during heavy operations: parsing, analysis, export never block main thread
- Multi-core systems fully utilized: 4 analysis workers on 4-core CPU = 4× speedup for parallel tasks
- Comlink provides type-safe communication: TypeScript catches worker API mismatches at compile time
- Transferable objects enable zero-copy data transfer: 6 MB signal array transfers instantly vs cloning overhead
- Workers isolated: crashing worker doesn't crash application; can restart failed worker
- Progress updates render smoothly: main thread free to update UI at 60 FPS during import
- Scalability: worker pool automatically adapts to CPU core count
- Separation of concerns: computation logic separated from UI logic

### Negative

- Architectural complexity: workers require separate build targets and lifecycle management
- Debugging difficulty: can't set breakpoints across worker boundary easily; Chrome DevTools requires separate worker debugging
- Limited API access in workers: no DOM, no localStorage (must use postMessage to coordinate), IndexedDB available but must open separately
- Worker creation overhead: ~50ms per worker; mitigated by worker pooling
- Memory usage: each worker has separate heap; 4 workers can use 4× memory
- Serialization cost: non-Transferable objects cloned across boundary (use Transferable where possible)
- Comlink abstraction hides postMessage boundary; can lead to unintentional large data transfers

### Neutral

- Must bundle worker code separately from main bundle (Vite handles via `new Worker('./worker.ts', { type: 'module' })`)
- Worker termination logic needed to prevent memory leaks from long-lived workers
- Progress reporting requires polling or callbacks from workers
- SharedArrayBuffer not used (requires COOP/COEP headers, not available on GitHub Pages)
