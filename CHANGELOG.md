# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Calendar Versioning](https://calver.org/) with the format `YYYY.0M.MICRO`.

## [Unreleased]

### Added

- Initial project scaffolding and repository structure
- Project documentation and design specification
- Agent and skill definitions for AI-assisted development workflow
- CI/CD pipeline configuration via GitHub Actions
- Pre-commit hooks for code quality enforcement
- Complete TypeScript domain type system (`src/types/`) covering sessions, events, signals, analysis, plugins, errors, settings, and storage
- Design token system with CSS custom properties for light and dark themes (`src/styles/tokens.css`)
- CSS reset and base typography styles (`src/styles/reset.css`, `src/styles/base.css`)
- Theme provider with system preference detection, localStorage persistence, and real-time OS preference tracking
- 16 design system components built on Radix UI primitives (Button, Card, Input, Badge, Select, Switch, Tabs, Dialog, Tooltip, Accordion, Toast, Skeleton, Table, DropdownMenu, Popover, Slider)
- Application shell with sidebar navigation layout and responsive design
- React Router v6 routing with lazy-loaded views for all application sections (Dashboard, Sessions, Analysis, Reports, Data Management, Settings, Help)
- Zustand stores for application state (useAppStore), persisted settings (useSettingsStore), and data cache (useDataStore)
- Three-tier error boundary system (Root, Route, Component level) with recovery actions
- Bidirectional URL state sync hook for deep-linkable date ranges and session selection
- 113 unit tests across 15 test files
- E2E tests for navigation, theme switching, and responsive layout
- IndexedDB 7-store schema (`sessions`, `nightly_aggregates`, `events`, `analysis_results`, `settings`, `import_history`, `integration_data`) with full CRUD and cursor-based range queries
- OPFS signal storage service for Float32Array chunk read/write, quota checking, and streaming reads
- LRU cache service for analysis results with hash-based keys and import-triggered invalidation
- Schema migration framework with versioned up/down/verify and dependency resolution
- Comlink worker factory (`src/services/workers/createWorker.ts`) with typed wrappers, structured error marshalling, and timeout support
- Priority-based worker pool (`src/services/workers/WorkerPool.ts`) with round-robin dispatch, idle timeout, crash recovery, and graceful shutdown
- EDF binary parser (`src/parsers/edf/EDFParser.ts`) for fixed headers, per-signal headers, interleaved 16-bit data records, and EDF+ TAL annotations
- ResMed interpreter (`src/parsers/resmed/ResMedInterpreter.ts`) with channel label normalization, event annotation mapping, machine info extraction, and capability detection
- Session builder (`src/parsers/resmed/SessionBuilder.ts`) for multi-file merge, time alignment, session boundary detection, and usage time computation
- EDF validator (`src/parsers/validation/Validator.ts`) with header integrity checks, physiological range validation, AASM compliance, and AHI sanity checks
- Synthetic EDF data generator (`src/test/generators/edf-generator.ts`) for deterministic test data
- Import pipeline service (`src/services/import/ImportService.ts`) with File System Access API support, `<input type="file">` fallback, SHA-256 deduplication, and progress tracking
- EDF parser Web Worker (`src/services/workers/edfParser.worker.ts`) wrapping EDFParser + ResMedInterpreter + Validator behind Comlink interface
- AirSense 11 suffixed channel label support (Flow.40ms, MaskPress.2s, Leak.2s, etc.) in ResMedInterpreter
- Machine info extraction from EDF+ recordingId field (SRN=, MID=, VID= key-value parsing)
- Generic "Apnea" and CSR Start/End event type mapping in ResMedInterpreter
- Automatic leak unit conversion (L/s → L/min) for downstream consistency
- SpO2/Pulse sentinel value filtering (all-zero = no oximeter attached)
- Maximum file size guard (100 MB) in import pipeline
- Buffer bounds validation before signal header parsing in EDFParser
- Synthetic AirSense 11 EDF test fixtures with manifest (`tests/fixtures/edf/`)
- 84 new unit tests (424 total) covering fixture parsing, import pipeline, and interpreter edge cases
- 14 new E2E tests (27 total, 81 across 3 browsers) covering import routes, browser APIs, and fixture handling

### Fixed

- EDF parser now handles `numDataRecords = -1` (unknown record count per EDF spec) by computing actual count from file size
- EDF parser now allows `dataRecordDuration = 0` for EDF+ annotation-only files (EVE, CSL)
- TAL annotation parsing corrected to use `\x14` (not `\x15`) as duration-to-label separator per EDF+ specification
- SessionBuilder channel merge now prefers channels with more samples (not just higher sample rate)
- Validator now accepts `dataRecordDuration = 0` for annotation-only files
- Synthetic EDF generator TAL format corrected to match EDF+ specification
- GitHub Pages deployment now works correctly — configured Vite base path, React Router basename, and 404.html fallback for SPA routing on `/cpap-analyzer/` subpath

### Added (Phase 6: Session Views + Signal Viewer)

- Session list view (`src/views/Sessions/SessionList.tsx`) with filterable search, sortable columns (date, duration, usage, AHI, leak, events), pagination (25/page), and AHI severity badges
- Session detail view (`src/views/Sessions/SessionDetail.tsx`) with AHI breakdown (obstructive/central/mixed/hypopnea/RERA), leak metrics (median/P95/max/duration), pressure metrics (mean/median/P95/max with bilevel support), SpO₂ metrics (mean/min/<90%/ODI), event timeline, and event summary table
- Signal viewer (`src/views/Sessions/SignalViewer.tsx`) with Canvas 2D multi-channel waveform rendering, zoom (mouse wheel + presets: 1m/5m/30m/1h/All), pan (pointer drag), crosshair with time + value readout, event marker overlays, and OPFS signal streaming
- Canvas signal rendering engine (`src/components/charts/canvas/SignalRenderer.ts`) with DPI-aware rendering, multi-channel stacked display, grid lines, dynamic time axis formatting, and requestAnimationFrame coalescing
- Session comparison view (`src/views/Sessions/SessionComparison.tsx`) with session pickers, side-by-side metric table with delta columns (absolute + percentage), color-coded improvement direction, and CSS bar chart
- LTTB (Largest Triangle Three Buckets) downsampling Web Worker (`src/services/workers/downsample.worker.ts`) with min-max downsampling, Comlink.transfer() for zero-copy results
- Signal data hooks (`src/hooks/useSignalData.ts`): `useSessionDetail(sessionId)`, `useEventData(sessionId)`, `useSignalData(params)` with cached OPFS service and lazy worker creation
- Granular import progress reporting during parsing, building, and storing stages with per-file/per-session detail and setTimeout yields for UI repainting
- 80 new unit tests (548 total): LTTB/min-max downsampling correctness, SignalRenderer helper functions and spatial queries, session comparison delta calculations
- 19 new E2E tests (46 total, 138 across 3 browsers): session list rendering/filtering/sorting, session detail metrics and navigation, signal viewer chrome and controls, session comparison flow with deltas, full navigation journey

### Fixed (Phase 6 post-merge)

- Signal Viewer canvas now renders waveform data correctly — ResizeObserver/renderer setup used a `[]`-dependency `useEffect` that ran on mount when the canvas was not in the DOM (loading skeleton shown instead); converted to a callback ref pattern so setup happens when the canvas actually mounts
- Signal Viewer channel colors now match their designated palette — `CHANNEL_COLORS` keys corrected from PascalCase (`Flow`, `MaskPress`, `SpO2`) to camelCase (`flow`, `maskPressure`, `spo2`) matching the ResMed interpreter's output
- Signal Viewer zoom no longer truncates viewport at duration boundary — clamping logic corrected
- Signal Viewer pan no longer desyncs viewport start/end — pointer drag delta applied consistently
- Signal Viewer vertical scrolling no longer blocked — Ctrl/Cmd modifier required for wheel zoom, plain scroll passes through to overflow container

### Added (Phase 6 QA fixes)

- Multi-channel crosshair values on hover — hovering over the signal canvas shows interpolated physical values for all visible channels with coloured readout badges
- Loading indicator for signal data — semi-transparent overlay with spinner shown while channel data is being fetched/downsampled
- Clickable channel legend with persistence — legend buttons toggle channel visibility, hidden state persisted in localStorage per session

### Improved

- Import wizard now shows stage-specific progress labels and percentages during parsing, building, and storing stages (previously showed indeterminate state during CPU-intensive building)
