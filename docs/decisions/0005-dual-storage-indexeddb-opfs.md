# 0005 — Dual Storage Strategy with IndexedDB and OPFS

## Status

Accepted

## Context

CPAP Analyzer must store years of high-frequency CPAP therapy data entirely client-side. A single night contains ~1.5 million signal samples (~6 MB), scaling to 11 GB for 5 years or 22 GB for 10 years. The storage solution must handle:

- Structured metadata requiring complex queries (sessions, events, nightly aggregates)
- Large binary signal data with high-throughput streaming access
- Efficient data import from EDF files
- Fast queries for date ranges, metrics, and analysis results
- Cross-browser compatibility

Storage requirements by data type:

- **Session metadata**: Structured, queryable (date, machine ID, duration, etc.)
- **Nightly aggregates**: Pre-computed metrics (AHI, leak rates, pressure statistics)
- **Events**: Timestamped respiratory events (apneas, hypopneas, flow limitation)
- **Analysis results**: Cached computation results
- **Settings**: User preferences and configuration
- **Signal data**: High-frequency time-series (Flow 25 Hz, MaskPress 25 Hz, Leak 2 Hz, etc.)

Alternatives evaluated:

- **IndexedDB only**: Good for structured data but inefficient for large binary blobs; transaction overhead degrades performance for signal data; slow chunked streaming
- **OPFS only**: No built-in indexing; query patterns for metadata would require custom index files; OPFS excels at binary I/O but poor for structured queries
- **LocalStorage**: Synchronous API blocks main thread; 5-10 MB limit; not suitable
- **Cache API**: Designed for HTTP caching, not application data; no transaction support; no structure
- **File System Access API**: Requires user permission for each directory; user must manually select location; not suitable for persistent app storage

Browser compatibility matrix:

- IndexedDB: Universal (Chrome 24+, Firefox 16+, Safari 10+, Edge all versions)
- OPFS: Chrome/Edge 86+, Safari 15.2+, Firefox 111+
- Storage API (quota queries): Chrome 55+, Edge 79+, Safari 15.2+, Firefox 57+

## Decision

Implement **dual storage strategy**:

- **IndexedDB** for structured, queryable data (metadata, aggregates, settings, analysis cache)
- **OPFS (Origin Private File System)** for high-frequency signal data

Technology split:

| Store    | Technology | Purpose                                                                  | Rationale                                                                                               |
| -------- | ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Metadata | IndexedDB  | Sessions, aggregates, events, settings, analysis results, import history | Structured queryable data with indices; transaction support; cross-browser compatibility                |
| Signals  | OPFS       | High-resolution time-series (25–50 Hz)                                   | High-throughput binary I/O; direct file system access; lower overhead for large blobs; better streaming |

IndexedDB stores (database: `cpap-analyzer`):

- `sessions` — Session metadata with indices on date, machineId
- `nightly_aggregates` — Pre-computed metrics with date range queries
- `events` — Respiratory events with session and datetime indices
- `analysis_results` — Cached computations with LRU eviction
- `settings` — User preferences persisted to localStorage
- `import_history` — Import tracking for incremental imports
- `integration_data` — Fitbit, weather integration data

OPFS structure:

```text
/cpap-analyzer/
  signals/
    {sessionId}/
      flow.f32
      maskpress.f32
      leak.f32
      ...
```

Signal files stored as Float32Array binary format for direct memory mapping without parsing overhead.

## Consequences

### Positive

- IndexedDB's native indexing provides fast structured queries: date ranges (< 50ms for 1 year), metric filtering, event lookups
- OPFS high-throughput binary I/O handles signal data efficiently: 6 MB signal file writes in < 1.5s, streaming read without full materialization
- Separation of concerns: query engine (IndexedDB) separate from blob storage (OPFS)
- Transaction support in IndexedDB ensures consistency for metadata updates
- Browser quota typically ~60% of available disk: ~150 GB on 256 GB device, sufficient for decades of data
- OPFS avoids IndexedDB blob overhead: no transaction wrapping, no serialization
- Can stream signal data in chunks without loading entire dataset into memory

### Negative

- Increased complexity: two storage systems to manage instead of one
- OPFS browser compatibility requires fallback strategy for older browsers (though all modern browsers now support)
- Must maintain consistency between IndexedDB metadata and OPFS signal files during import/deletion
- Debugging requires separate tools for IndexedDB (DevTools Application tab) and OPFS (DevTools Storage)
- OPFS files not visible to user in filesystem (origin-private), complicating manual debugging
- Firefox in private browsing mode has restrictive OPFS quotas
- Orphaned signal files if IndexedDB metadata deletion fails (requires garbage collection logic)

### Neutral

- Storage quota is shared between IndexedDB and OPFS, managed at origin level
- Both systems are origin-isolated (same-origin policy enforced)
- Neither storage API supports encryption at rest (must be handled at application level if needed)
- Browser may evict storage under pressure (both IndexedDB and OPFS), though persistent storage API can request persistence
