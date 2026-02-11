# Analysis Service

Analysis engine that orchestrates statistical computations through Web Workers with result caching.

## Architecture

- **AnalysisEngine** — Pipeline orchestrator: cache check → data fetch → worker dispatch → cache store
- **analysis.worker.ts** — Comlink-wrapped worker exposing all algorithm modules
- **Algorithm modules** — `src/analysis/descriptive/`, `src/analysis/timeseries/`, `src/analysis/correlation/`
