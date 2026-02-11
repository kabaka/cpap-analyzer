# CPAP Analyzer — Implementation Plan

This document defines the phased implementation plan for the CPAP Analyzer application. Each phase corresponds to one orchestrator prompt — the orchestrator delegates to specialist agents who work in parallel on independent tasks within the phase.

**Rules for every phase:**

- Pre-commit hooks (Prettier, ESLint, TypeScript, Vitest) must pass at phase end.
- CI pipeline (audit, lint, test-unit, test-e2e, build) must be green at phase end.
- Every phase produces a working, testable increment.
- QA agent reviews all code before a phase is considered complete.

**Current state:** Phase 6 complete. Session list view with filterable, sortable, paginated table. Session detail with AHI/Leak/Pressure/SpO₂ metrics, event timeline, and event summary. Signal viewer with Canvas 2D multi-channel waveforms, LTTB downsampling via Web Worker, zoom/pan/crosshair, and event markers. Session comparison with side-by-side metric deltas and bar chart. Import progress now shows granular stage-level feedback. 548 unit tests and 138 E2E tests (46 × 3 browsers) pass. All pre-commit checks green.

---

## Phase 1: Project Scaffolding

**Goal:** Go from zero code to a blank React app that builds, lints cleanly, passes one unit test and one E2E test, and achieves full CI green across all 5 jobs. Reconcile any existing config issues.

**Work items:**

- [x] `package.json` — All runtime and dev dependencies (React 18, React Router v6, Zustand, Radix UI primitives, Recharts, D3, Comlink, Zod, React Hook Form, Vite, VitePWA, Vitest, Playwright, ESLint, TypeScript, fast-check, size-limit, Husky, ml-matrix, fft.js)
- [x] `tsconfig.json` — Strict mode, ES2020 target, `@` → `src/` and `@test` → `src/test/` path aliases
- [x] `vite.config.ts` — React plugin, tsconfig paths, worker support (`new Worker('./x.ts', { type: 'module' })`), manual chunk strategy (vendor, recharts, d3, analysis), PWA stub
- [x] `vitest.config.ts` — jsdom environment, globals, setup file, V8 coverage (thresholds deferred until sufficient code exists)
- [x] `playwright.config.ts` — 3 browser projects (Chromium, Firefox, WebKit), dev server integration, test directory, reporter config
- [x] ESLint config — TypeScript + React plugin (ESLint 9 flat config), strict rules, no-console warning
- [x] `src/test/setup.ts` — Mock IndexedDB (fake-indexeddb), OPFS stubs, Worker stubs, Comlink stubs, crypto stubs
- [x] `index.html` → `src/main.tsx` → `src/App.tsx` — Renders "CPAP Analyzer" heading in a root div
- [x] `src/App.test.tsx` — Verifies app renders without crashing (2 tests)
- [x] `tests/e2e/app-loads.spec.ts` — Navigates to `/`, confirms heading visible (2 tests)
- [x] Verify pre-commit hook works end-to-end
- [x] Verify all 5 CI jobs pass (audit, lint, test-unit, test-e2e, build) — Verified: CI green on remote after push

**Agents:** DevOps (all config files, CI compatibility), Frontend (index.html, main.tsx, App.tsx), Unit Tester (setup file, first test), E2E Tester (first Playwright test), QA (verify everything passes)

**Done when:**

- `npm run dev` starts a dev server showing the heading
- `npm run build` produces `dist/` with a working SPA
- `npx prettier --check .` passes
- `npx eslint .` passes
- `npx tsc --noEmit` passes
- `npx vitest run --coverage` passes (1 test, coverage thresholds met via no-threshold-on-empty or initial test coverage)
- `npx playwright test` passes (1 test, 3 browsers)
- Pre-commit hook completes successfully
- CI pipeline green

**Depends on:** Nothing — this is the first phase.

---

## Phase 2: Domain Types, Design System, App Shell

**Goal:** Establish the complete TypeScript type system, implement the design token and themed component library, wire up all routes with placeholder views, create Zustand stores, and build error boundaries. The entire structural skeleton of the application.

**Work items:**

- [x] **Domain types** (`src/types/`) — All interfaces: Session, NightlyAggregate, Event, ChannelMetadata, SignalChunk, AnalysisInput/Output/Metadata, DataProvider, CPAPError, ErrorCategory, ErrorSeverity, all 5 plugin interfaces (MachinePlugin, AnalysisPlugin, VisualizationPlugin, IntegrationPlugin, ExportPlugin), Settings, ImportRecord, IntegrationData
- [x] **Design tokens** (`src/styles/tokens.css`) — Complete CSS custom property set: surfaces, text, status/clinical colors (normal/green, mild/yellow, moderate/orange, severe/red), chart color palette (8 colors), spacing scale (4px base), typography (system fonts, 7-step scale), shadows (4 levels), radii, transitions, z-index layers — light theme default + dark theme override via `[data-theme="dark"]`
- [x] **Reset + base styles** (`src/styles/reset.css`, `src/styles/base.css`) — CSS reset, base typography, scrollbar styling, focus-visible styles
- [x] **Theme provider** — `useTheme()` hook, system preference detection via `prefers-color-scheme`, localStorage persistence, `[data-theme]` attribute on `<html>`
- [x] **Design system components** (`src/components/ui/`) — Button, Card, Input, Select, Badge, Table, Tabs, Dialog, Tooltip, Switch, Slider, Accordion, Popover, DropdownMenu, Toast, Skeleton/Loading — each wrapping Radix UI primitives, styled via CSS Modules + tokens, keyboard accessible, ARIA compliant
- [x] **Layout components** (`src/components/layouts/`) — `RootLayout` (header with app title, primary sidebar nav, `<Outlet/>`, toast container), `DashboardLayout` (content area with breadcrumb)
- [x] **Routing** (`src/router.tsx`) — All routes with React.lazy placeholder views: `/` Dashboard, `/sessions` SessionList, `/sessions/:id` SessionDetail, `/sessions/:id/signals` SignalViewer, `/sessions/compare` SessionComparison, `/analysis` AnalysisHub, `/analysis/statistical` StatisticalAnalysis, `/analysis/events` EventAnalysis, `/analysis/pressure` PressureOptimization, `/analysis/integrations` IntegrationAnalysis, `/reports` Reports, `/data` DataManagement, `/data/import` ImportWizard, `/settings` Settings, `/help` HelpHome, `/help/:topic` HelpArticle
- [x] **Zustand stores** (`src/stores/`) — `useAppStore` (dateRange, selectedSession, importStatus, errors), `useSettingsStore` (analysisParams, display, integrations), `useDataStore` (sessions cache, summaryStats, loading states) — typed interfaces, devtools middleware
- [x] **Error boundaries** — Root (catches fatal), route-level (catches view crashes with "Go Home" recovery), component-level (catches widget failures with retry)
- [x] **URL state sync** (`src/hooks/useURLState.ts`) — Bidirectional sync of dateRange + selected session to URL search params
- [x] **Unit tests** — All design system components render and accept keyboard input, Zustand stores initialize and update correctly, theme toggle works, error boundaries catch thrown errors
- [x] **E2E tests** — Navigate all top-level routes, toggle theme, verify responsive layout at mobile/tablet/desktop breakpoints

**Agents:** Frontend (routing, layouts, stores, hooks, error boundaries), UI Design (design tokens, CSS, component visual specs), UX (nav structure, URL state, error UX), Unit Tester (component + store tests), E2E Tester (navigation + theme tests), QA (review)

**Done when:**

- `tsc --noEmit` passes with zero errors — all types are internally consistent
- All routes render their placeholder views without errors
- Theme toggle switches light ↔ dark with correct token values applied
- All design system components render, accept keyboard input, and expose correct ARIA attributes
- Zustand stores initialize with correct default state and update on actions
- Error boundaries catch errors and render fallback UI
- Unit tests ≥80% coverage on new code
- E2E tests pass: navigate all top-level routes, toggle theme
- CI green

**Depends on:** Phase 1

---

## Phase 3: Storage Layer, Web Worker Infrastructure, EDF Parser

**Goal:** Implement the three infrastructure pillars that all feature work depends on — client-side storage (IndexedDB + OPFS), the Comlink-based worker pool, and the EDF binary parser with ResMed interpretation. Validated against synthetic test data.

**Work items:**

- [x] **IndexedDB service** (`src/services/storage/IndexedDBService.ts`) — Database `cpap-analyzer`, schema version 1. 7 object stores with all indexes per storage-architecture.md: `sessions` (key: id, indexes: date, machineId), `nightly_aggregates` (key: id, indexes: date, sessionId), `events` (key: id, indexes: sessionId, timestamp, type), `analysis_results` (key: id, indexes: analysisType, dateRangeHash), `settings` (key: key), `import_history` (key: id, indexes: date, status), `integration_data` (key: id, indexes: source, date). CRUD operations, transaction management, cursor-based range queries.
- [x] **OPFS service** (`src/services/storage/OPFSService.ts`) — Directory structure `/cpap-analyzer/signals/{sessionId}/{channel}.f32` and `/cpap-analyzer/cache/downsampled/`. Write/read Float32Array chunks, file listing, deletion, quota checking, streaming reads.
- [x] **Cache service** (`src/services/storage/CacheService.ts`) — In-memory LRU cache for analysis results (max 100 entries), key generation from analysis params + date range hash, invalidation triggers on new imports
- [x] **Migration framework** (`src/services/storage/MigrationService.ts`) — Versioned schema migrations with up/down/verify, dependency resolution, runs on app start before any data access
- [x] **Comlink worker wrapper** (`src/services/workers/createWorker.ts`) — Typed factory for creating Comlink-wrapped workers, error marshalling across thread boundary (structured CPAPError serialization), timeout support
- [x] **Worker pool** (`src/services/workers/WorkerPool.ts`) — Pool size = `navigator.hardwareConcurrency - 1` (min 2), task queue with priority, round-robin dispatch, idle timeout (30s), graceful shutdown, restart on crash
- [x] **EDF parser** (`src/parsers/edf/EDFParser.ts`) — Parse 256-byte fixed header (version, patient, recording, start date/time, header bytes, data format, num records, record duration, num signals). Parse per-signal headers (label, transducer, physical dim, physical min/max, digital min/max, prefiltering, num samples). Parse data records (interleaved 16-bit little-endian integers → Float32 physical values). Parse EDF+ annotations (TAL format — onset, duration, annotation text).
- [x] **ResMed interpreter** (`src/parsers/resmed/ResMedInterpreter.ts`) — Channel label normalization (12+ mappings: `Flow` → Flow, `Mask Pres` → MaskPressure, `Leak` → Leak, etc.), event annotation mapping (12+ types: obstructive apnea, central apnea, hypopnea, RERA, CSR, large leak, etc.), machine info extraction from patient ID field (serial number, model, series detection), capability detection (CPAP vs APAP vs BiPAP vs ASV)
- [x] **Session builder** (`src/parsers/resmed/SessionBuilder.ts`) — Merge multiple EDF files into sessions (BRP breathing + EVE events + STR settings + SAD SpO₂ + CSL + PLD). Time-align across files. Session boundary detection (>30 min gap). Usage time computation (mask pressure > 2 cmH₂O). Produce Session + NightlyAggregate + Event[] ready for storage.
- [x] **Validator** (`src/parsers/validation/Validator.ts`) — EDF header integrity (magic bytes, field ranges, consistent num records). Physiological range validation: flow [-300, 300] L/min, pressure [0, 30] cmH₂O, leak [0, 200] L/min, SpO₂ [50, 100]%. AASM event duration compliance (apnea ≥ 10s). AHI sanity check (>200 = error). Session duration minimums.
- [x] **Synthetic data generator** (`src/test/generators/edf-generator.ts`) — Generate valid EDF binary files with configurable: header fields, signal count/channels, sample rates, known signal values (sine waves, step functions, ramps), known annotations at exact timestamps. For deterministic unit and E2E testing.
- [x] **Unit tests** — IndexedDB CRUD (via fake-indexeddb), OPFS operations (mocked or abstracted), EDF parser against synthetic binaries (byte-level verification of header fields, signal value accuracy within ε), ResMed label mapping (all 12+ channels, all 12+ events), SessionBuilder merging logic, WorkerPool dispatch + queue + timeout, cache hit/miss/eviction

**Agents:** Database (IndexedDB, OPFS, Cache, Migrations), Performance (WorkerPool, Comlink setup, Transferable optimization), ResMed Specialist (EDF parser, ResMed interpreter, SessionBuilder, Validator), Frontend (service integration into app context), Unit Tester (all tests), Security (input validation, buffer bounds checking in parser), QA (review)

**Done when:**

- IndexedDB service creates all 7 stores with correct indexes on first open
- OPFS service writes and reads Float32Array chunks round-trip
- EDF parser correctly parses synthetic EDF files — header fields match exactly, signal values match within ε of expected physical values
- ResMed interpreter maps all channel labels and event labels correctly
- SessionBuilder merges multi-file synthetic sessions into correct Session objects
- WorkerPool dispatches tasks through Comlink and returns results
- Cache service stores, retrieves, and evicts correctly
- Synthetic data generator produces EDF files that round-trip through parser
- No `any` types in parser code
- Unit tests ≥80% coverage on new code (227 tests covering all new modules)
- CI green (0 type errors, 0 lint errors, 340 tests passing)

**Depends on:** Phase 2 (domain types)

---

## Phase 4: Real Data Validation & Import Path

**Goal:** The user provides real ResMed EDF files. Validate all parser assumptions against real-world data, fix edge cases, create sanitized test fixtures for the repo, and build the complete import pipeline (File System Access API → EDF Worker → storage). This phase ends with a working import that correctly processes real data and a comprehensive E2E test using synthetic fixtures.

**Work items:**

- [x] **Receive real EDF files** — Full SD card dump with 506 days of data
- [x] **Real data parser validation** — 3700/3702 files parsed (99.9%)
- [x] **Edge case fixes** — 5 critical bugs fixed (numDataRecords=-1, dataRecordDuration=0, TAL format, suffixed labels, recordingId machine info)
- [x] **Aggregate validation** — AHI within ±0.5/hr across 5 validated days
- [x] **Sanitized test fixtures** — 6 synthetic AirSense 11 fixtures with manifest
- [x] **Import pipeline** — Full ImportService with directory walking, error resilience, dedup
- [x] **Import progress tracking** — Observable ImportProgress with stage transitions
- [x] **EDF parser worker** — Comlink-wrapped with parseEDFFile + validateEDFHeader
- [x] **Validation report** — Documented in code review (findings integrated into fixes)
- [x] **Unit tests** — 84 new tests (fixture parsing, import pipeline, interpreter edge cases)
- [x] **E2E tests** — 14 new tests (route rendering, browser APIs, fixture handling, IndexedDB round-trip)

**Agents:** ResMed Specialist (parser validation + fixes, real data analysis), Data Science (aggregate numerical validation), Frontend (import pipeline service, Worker integration), Unit Tester (fixture-based tests), E2E Tester (import flow tests), Security (verify fixtures contain no real PHI, validate import input sanitization), QA (validation report review, overall quality)

**Done when:**

- Parser successfully reads all provided real EDF files without errors
- Parsed session metadata matches expected values (dates, machine model, channel count, sample rates)
- Computed AHI matches machine-reported AHI within ±0.1 events/hour
- All known ResMed channel labels correctly mapped
- All known event types correctly classified
- Sanitized test fixtures committed (zero PHI verified by Security agent)
- Import pipeline processes files end-to-end into IndexedDB + OPFS
- Incremental import skips already-imported sessions
- E2E test: import synthetic EDF → verify data appears in storage
- Validation report documents findings and any remaining limitations
- CI green

**Depends on:** Phase 3 (parser, storage, workers). **GATE:** User must provide real EDF data before this phase begins.

---

## Phase 5: Import UI + Dashboard

**Goal:** First end-to-end user flow — users can import EDF files through a polished import wizard and see their data on a functional dashboard with KPI cards, sparklines, compliance gauge, and recent sessions table.

**Work items:**

- [x] **Import wizard** (`src/views/DataManagement/ImportWizard/`) — Multi-step flow: file/folder selection (drag-and-drop zone + file picker button) → scanning/previewing found files → confirmation → importing with real-time progress bar → completion summary with any errors. Accessible: keyboard navigable, ARIA live region for progress.
- [x] **Empty state** — Welcome screen on first launch (no data): illustration/icon, explanation of what the app does, prominent "Import Data" CTA. Displayed when sessions store is empty.
- [x] **Dashboard view** (`src/views/Dashboard/`) —
  - KPI summary cards: AHI (with severity badge), Leak Rate (median + P95), Usage Hours (mean), Compliance % (nights ≥ 4h / total nights) — each with trend indicator arrow (↑↓→) and sparkline
  - Compliance gauge: Donut chart showing CMS compliance percentage (≥4h for ≥70% of nights in 30-day window)
  - 30-day AHI trend: Recharts AreaChart with severity color zones
  - 30-day usage trend: Recharts BarChart
  - Recent sessions table: Last 7–30 nights, sortable columns (date, AHI, usage, leak), click-to-navigate
  - Date range selector: Persistent across views, presets (7d, 30d, 90d, 1y, all, custom range picker)
- [x] **Data hooks** (`src/hooks/`) — `useSessionData(dateRange)`: fetch sessions from IndexedDB filtered by date range. `useSummaryStats(dateRange)`: compute aggregate KPIs from nightly_aggregates. `useImport()`: manage import wizard state and trigger ImportService. All hooks manage loading/error/empty states.
- [ ] **Downsampling worker** (`src/services/workers/downsample.worker.ts`) — LTTB and min-max downsampling behind Comlink, accepts Float32Array + target point count, returns downsampled array via Transferable _(deferred to Phase 6 — needed for Signal Viewer, not dashboard)_
- [x] **Unit tests** — Import wizard state machine, summary stat computations, data hooks (with mocked storage), dashboard KPI calculations, date range filtering
- [x] **E2E tests** — Full import flow (select synthetic EDF → dashboard renders with values), empty state → import → dashboard transition, date range preset switching, session table sort

**Agents:** Frontend (ImportWizard, Dashboard, data hooks, empty state), UX (import flow design, empty state, date range UX, KPI card layout), UI Design (wizard styling, KPI cards, gauge, sparklines), Data Visualization (sparklines, compliance gauge, trend charts), Unit Tester, E2E Tester, QA

**Done when:**

- Users can import EDF files via drag-and-drop or file picker
- Import wizard shows real-time progress and handles errors gracefully
- Dashboard displays correct KPI values computed from imported data
- Sparklines render 30-day trends accurately
- Compliance gauge shows correct percentage
- Recent sessions table is sortable and navigable
- Date range selector filters all dashboard content
- Empty state displays on first launch
- E2E: import synthetic data → verify dashboard KPI values match expected
- CI green

**Depends on:** Phase 4 (validated import pipeline), Phase 2 (design system)

---

## Phase 6: Session Views + Signal Viewer

**Goal:** Users can browse their sessions, drill into any session's detail with metrics and events, view full-resolution 25–50 Hz signal waveforms with interactive zoom/pan on a custom Canvas renderer, and compare two sessions side-by-side.

**Work items:**

- [x] **Session list view** (`src/views/Sessions/SessionList/`) — Filterable, sortable table/list of all sessions. Columns: date, duration, usage hours, AHI, leak median, leak P95, event count. Pagination or virtualization for large datasets. Click row → navigate to session detail. Filter by date range (synced with global selector).
- [x] **Session detail view** (`src/views/Sessions/SessionDetail/`) — Header: date, machine, duration, mask-on time. Key metrics panel: AHI (total/obstructive/central/hypopnea breakdown), leak rate (median/P95/max/large leak duration), pressure (mean/P95/EPAP/IPAP if applicable), SpO₂ if available (mean/min/time <90%/ODI). Event timeline: horizontal bar showing events positioned in time (color-coded by type). Statistics table. "View Signals" button → navigate to Signal Viewer.
- [x] **Signal viewer** (`src/views/Sessions/SignalViewer/`) — Custom Canvas 2D renderer. Multi-channel display (Flow, MaskPressure, Leak, SpO₂ stacked vertically, synchronized time axis). LTTB downsampling from OPFS → Worker → Canvas (only downsample visible viewport + buffer). Zoom: mouse wheel/pinch, zoom rectangle, zoom presets (1min, 5min, 30min, 1h, all). Pan: click-drag horizontal. Crosshair with time + value readout. Event markers overlaid on signals (color-coded rectangles at event positions). Time axis with dynamic tick formatting. Amplitude axis per channel with auto-scaling.
- [x] **Session comparison** (`src/views/Sessions/SessionComparison/`) — Session picker (select 2 sessions from dropdown/search). Side-by-side metric tables with delta column (absolute and percentage change). Key metric comparison bar chart.
- [x] **Signal data hooks** — `useSignalData(sessionId, channel, timeRange)`: streams OPFS chunks via Worker, applies LTTB for current viewport width. Returns Float32Array or downsampled array ready for Canvas. `useSessionDetail(sessionId)`, `useEventData(sessionId)`.
- [x] **Canvas rendering engine** (`src/components/charts/canvas/SignalRenderer.ts`) — requestAnimationFrame loop, draws line plot from Float32Array, handles resize, DPI-aware rendering (`devicePixelRatio`), cursor position tracking for crosshair, event marker overlay, axis drawing.
- [x] **Unit tests** — LTTB downsampling correctness (preserves peaks/valleys), Canvas renderer data transform, session comparison delta calculations, viewport calculation logic
- [x] **E2E tests** — Session list → click row → session detail loads, session detail → "View Signals" → signal viewer renders, signal viewer zoom/pan interactions (wheel, drag), session comparison flow (select 2 sessions, verify deltas)

**Agents:** Frontend (SessionList, SessionDetail, SessionComparison views, signal data hooks), Data Visualization (Signal Viewer Canvas renderer, LTTB integration, axis rendering, crosshair, event markers), Performance (viewport-based rendering, streaming OPFS reads, memory management, frame budget), UX (zoom/pan interaction design, crosshair UX, event marker visibility), UI Design (session detail layout, comparison layout, signal viewer chrome), Unit Tester, E2E Tester, QA

**Done when:**

- Session list displays all sessions with correct aggregates, sortable and filterable
- Session detail shows all metrics and event timeline for selected session
- Signal viewer renders multi-channel waveforms from OPFS data via Worker
- Zoom/pan is smooth (interaction response < 50ms per performance targets)
- LTTB downsampling produces visually accurate representations at all zoom levels
- Event markers appear at correct time positions on signal timeline
- Session comparison shows two sessions with delta values
- E2E: navigate list → detail → signals → zoom/pan, compare two sessions
- CI green

**Depends on:** Phase 5 (imported data), Phase 3 (OPFS, Workers, downsampling worker)

---

## Phase 7: Analysis Engine — Core Algorithms

**Goal:** Implement the most important statistical algorithms — descriptive statistics, time-series analysis, and correlation analysis. These run in Web Workers with result caching and cover the majority of daily analysis use cases.

**Work items:**

- [ ] **Analysis pipeline** (`src/services/analysis/AnalysisEngine.ts`) — Orchestrator: receive analysis request → check cache → fetch data from IndexedDB → dispatch to Worker → cache result → return. Invalidate cache on new imports. Support cancellation for long-running analyses.
- [ ] **Descriptive statistics** (`src/analysis/descriptive/`) — Welford's online mean/variance (numerically stable), median (quickselect), percentiles (Type 7 interpolation), IQR + Tukey outlier detection (1.5×IQR), histogram binning (Freedman-Diaconis rule for bin width), skewness (Fisher's), kurtosis (excess), range, coefficient of variation
- [ ] **Time-series analysis** (`src/analysis/timeseries/`) — Rolling mean/median with configurable window + 95% CI, linear trend (least squares) with p-value and R², LOESS smoothing (tricube kernel, configurable bandwidth), PELT change-point detection (L2 cost, penalty β=10), STL seasonal-trend decomposition (7-day seasonality, robust weights), ACF/PACF via Durbin-Levinson recursion
- [ ] **Correlation analysis** (`src/analysis/correlation/`) — Pearson correlation coefficient with exact p-value (t-distribution), Spearman rank correlation, full correlation matrix for all metrics, partial correlation (matrix inversion method), cross-correlation with lag range
- [ ] **Analysis worker** (`src/services/workers/analysis.worker.ts`) — Comlink-wrapped worker that exposes all algorithm modules, accepts typed AnalysisInput, returns AnalysisOutput with Transferable arrays
- [ ] **Reference validation** — Pre-compute expected values for test datasets using R or scipy. Every algorithm test includes a known-correct reference answer.
- [ ] **Edge case handling** — Empty arrays return null/NaN gracefully, single-element inputs handled, all-identical values (variance = 0) handled, NaN/Infinity values filtered, data validation before computation
- [ ] **Unit tests** — Every algorithm tested with deterministic inputs. Welford's vs naive sum-of-squares (verify numerical stability). Rolling stats vs brute-force. Pearson r against known correlation. PELT change-point against synthetic step-function. LOESS against R output. STL decomposition components sum to original. ACF lag-0 = 1.0.

**Agents:** Data Science (all algorithms — primary), Performance (Worker execution, Transferable optimization, streaming for large datasets), Database (cache integration), Unit Tester (reference validation tests, edge cases), QA (review numerical correctness)

**Done when:**

- All descriptive statistics match reference values within ε (< 1e-10 for means/variances, < 0.01 for percentiles)
- PELT correctly identifies change-points in synthetic step-function data
- LOESS curve matches R's `loess()` output within ε
- STL decomposition: trend + seasonal + residual sums to original series within ε
- Pearson r and p-values match scipy.stats.pearsonr within ε
- ACF/PACF match statsmodels output within ε
- All algorithms run in Worker without blocking main thread
- Cache hit returns in < 10ms
- Edge cases (empty, single, NaN, identical) all handled without throwing
- Unit tests ≥80% coverage on algorithm code
- CI green

**Depends on:** Phase 3 (Workers, storage), Phase 2 (types)

---

## Phase 8: Analysis Engine — Advanced Algorithms

**Goal:** Complete the analysis engine with hypothesis testing, distribution analysis, event analysis (clustering, survival), and pressure optimization algorithms. The full suite of 20+ methods is now available.

**Work items:**

- [ ] **Hypothesis testing** (`src/analysis/hypothesis/`) — Mann-Whitney U test (exact for n ≤ 28, normal approximation with tie correction for larger n), Wilcoxon signed-rank test, effect size measures (Cohen's d, Hedges' g, rank-biserial correlation), paired before/after comparison helpers
- [ ] **Distribution analysis** (`src/analysis/distribution/`) — QQ-normal plot data (Hazen plotting position formula), Shapiro-Wilk test (n < 5000), Kolmogorov-Smirnov test + Lilliefors correction, kernel density estimation (Gaussian kernel, Silverman bandwidth)
- [ ] **Event analysis** (`src/analysis/events/`) — FLG-bridged clustering (Schmitt trigger hysteresis with 3 presets: strict/balanced/lenient), K-means++ clustering (Arthur & Vassilvitskii initialization, configurable k), single-link agglomerative clustering, event duration distributions by type, inter-event interval analysis
- [ ] **Survival analysis** (`src/analysis/survival/`) — Kaplan-Meier estimator (Greenwood variance for CI, log-log transformation for confidence bands), time-to-event for apnea recurrence, censoring support
- [ ] **Pressure analysis** (`src/analysis/pressure/`) — Titration helper (optimal pressure range estimation based on AHI minimization), pressure-response curves (AHI vs pressure scatter with regression), EPAP×IPAP effectiveness for BiPAP users, pressure variability metrics
- [ ] **False-negative detection** (`src/analysis/events/false-negatives.ts`) — Heuristic detection of potentially missed events using FLG threshold/duration/gap analysis with 3 sensitivity presets
- [ ] **Granger causality** (`src/analysis/correlation/granger.ts`) — VAR model estimation, F-test for causal lag relationships, AIC for lag selection
- [ ] **Unit tests** — Mann-Whitney U against scipy.stats.mannwhitneyu reference, Shapiro-Wilk against scipy reference, KM curve against R survival::survfit reference, K-means against known cluster membership, FLG clustering against synthetic event patterns, all edge cases

**Agents:** Data Science (all algorithms — primary), Performance (large-dataset profiling, Worker memory), Unit Tester (reference validation), QA (review)

**Done when:**

- Mann-Whitney U p-values match scipy within ε for both exact and approximation cases
- Shapiro-Wilk statistic matches scipy within ε
- KM estimator matches R survfit output within ε
- K-means++ converges to expected clusters on well-separated synthetic data
- FLG clustering correctly groups events at all 3 preset sensitivity levels
- All algorithms run in Workers without blocking main thread
- Edge cases handled (insufficient data, ties, zero variance, single group)
- Unit tests ≥80% coverage on algorithm code
- CI green

**Depends on:** Phase 7 (core algorithms, analysis pipeline, analysis worker)

---

## Phase 9: Analysis Views + Visualization Library

**Goal:** Build the analysis UI — users can select analyses, configure parameters, run computations, and view results as interactive charts. Implements the full chart library across three rendering tiers (Recharts, Canvas, D3).

**Work items:**

- [ ] **Statistical analysis view** (`src/views/Analysis/StatisticalAnalysis/`) — Descriptive stats summary table, time-series trend charts (rolling average with CI band, LOESS overlay, change-point markers), correlation matrix heatmap, distribution charts (histogram with KDE overlay, QQ-plot), hypothesis test results panel with effect size interpretation
- [ ] **Event analysis view** (`src/views/Analysis/EventAnalysis/`) — Event cluster scatter plot (colored by cluster ID), event duration histogram by type, inter-event interval distribution, Kaplan-Meier survival curve, false-negative detection summary with sensitivity controls, event density chart (events per hour over time)
- [ ] **Pressure analysis view** (`src/views/Analysis/PressureOptimization/`) — Pressure-response scatter (AHI vs pressure with regression line and optimal range shading), pressure variability box plot, titration helper recommendations display, EPAP/IPAP panel for BiPAP users
- [ ] **Recharts standard charts** (`src/components/charts/recharts/`) — ThemedAreaChart, ThemedLineChart, ThemedBarChart, ThemedScatterPlot, ThemedPieChart — each with theme-aware colors from tokens, responsive sizing, tooltips, legends, click handlers for drill-down, PNG export
- [ ] **D3 specialized charts** (`src/components/charts/d3/`) — BoxPlot, ViolinPlot, CorrelationHeatmap, KaplanMeierCurve, QQPlot, STLDecompositionPanel, CalendarHeatmap — each self-contained with D3 scales + SVG rendering
- [ ] **Chart container** (`src/components/charts/ChartContainer.tsx`) — Responsive wrapper, loading skeleton, error state, "View as Table" toggle (data table alternative), export PNG button
- [ ] **Chart interaction layer** — Zustand store for synchronized zoom/crosshair across charts, brush selection for date range, tooltip coordination
- [ ] **Analysis hooks** (`src/hooks/`) — `useAnalysis(type, params, dateRange)`: triggers AnalysisEngine, manages loading/error/result state, caches across renders
- [ ] **Unit tests** — Chart data transformation functions, analysis view state machines, chart interaction store, analysis hooks
- [ ] **E2E tests** — Run each analysis type → verify chart renders with data, change analysis parameters → results update, export chart as PNG

**Agents:** Data Visualization (all chart components — primary), Frontend (analysis views, layouts, hooks, interaction), UI Design (chart styling, dark mode, analysis view layout), UX (chart interactions, tooltip placement, parameter controls, information density), Data Science (verify analysis views display algorithm output correctly), Unit Tester, E2E Tester, QA

**Done when:**

- Statistical, Event, and Pressure analysis views render with imported data
- All Recharts charts display correctly with theme-aware colors (both themes)
- D3 charts render specialized visualizations (box plots, KM curves, heatmaps, QQ plots)
- Canvas charts (signal viewer from Phase 6) integrate with analysis view context
- Charts respond to theme changes without remounting
- Zoom/crosshair interactions synchronize across linked charts
- "View as Table" provides data table alternative for every chart
- PNG export works for all chart types
- E2E: run each analysis → verify charts render with plausible data
- CI green

**Depends on:** Phase 7 + 8 (complete analysis engine), Phase 5 (imported data), Phase 2 (design system)

---

## Phase 10: Reports, Settings, Data Management, Help System

**Goal:** Complete all remaining application features — report generation (PDF/CSV/encrypted), full settings UI, data management tools, and the in-app help system with contextual documentation.

**Work items:**

- [ ] **Report generator** (`src/services/reports/`) — Content selection (analyses, charts, date range to include), PDF generation (Chart → Canvas → PNG embedded in structured PDF via jsPDF), CSV export (raw sessions + aggregates + analysis results), encrypted archive (AES-256-GCM via WebCrypto, PBKDF2 key derivation from user-provided password)
- [ ] **Report templates** — Physician summary (1-page: key metrics, 30-day trend, compliance), full analysis report (multi-page: all analyses with charts), custom builder (user selects which sections)
- [ ] **Report view** (`src/views/Reports/`) — Template picker, date range selection, content configuration, preview mode, download buttons (PDF, CSV, encrypted)
- [ ] **Export worker** (`src/services/workers/export.worker.ts`) — Comlink-wrapped worker for heavy export tasks (large CSV, PDF rendering, encryption)
- [ ] **Settings view** (`src/views/Settings/`) — Theme selection (light/dark/system auto), date/time format, analysis parameter defaults (pressure thresholds, smoothing bandwidth, cluster count, significance level), chart preferences (animation on/off, tooltip style, color scheme), integration configuration panels (Fitbit, Weather, LLM — all disabled by default), privacy/storage section (data retention, export defaults)
- [ ] **Settings persistence** — Zustand persist middleware → localStorage, settings hydration on app start, settings migration for version upgrades
- [ ] **Data management view** (`src/views/DataManagement/`) — Storage usage display (IndexedDB + OPFS breakdown, quota used/remaining), import history table (date, status, file count, session count), data cleanup (delete by date range, delete by session, delete all with confirmation), session export (individual sessions as JSON), full backup/restore (export all data as encrypted archive, import from archive)
- [ ] **Help system** (`src/components/help/`) — Contextual tooltips on all metric labels (hover/focus → brief explanation), info popovers on clinical terms with "Learn more" links (Radix Popover), help panel (slide-out drawer with topic tree and search), guided tours (Getting Started, Dashboard Tour, First Analysis — step-by-step with highlights), keyboard shortcuts reference (`?` key), metric glossary (alphabetical, searchable, with layered explanations: quick/standard/detailed)
- [ ] **Help content** (`src/content/help/`) — Getting started guide, import guide, dashboard guide, sessions guide, analysis guides (statistical, events, pressure), reports guide, settings guide, clinical reference (AHI, leak, pressure, SpO₂, compliance, event types), statistical methods reference (each algorithm explained for target audience), glossary entries (50+ terms)
- [ ] **Unit tests** — Report generation logic, CSV formatting, encryption round-trip, settings persistence, help search, data export/import round-trip
- [ ] **E2E tests** — Generate PDF report → verify download, CSV export → verify file content structure, change theme → reload → verify persistence, navigate help panel → search → find article, data cleanup → verify empty state, backup → full delete → restore → verify data integrity

**Agents:** Frontend (report views, settings, data management, export worker), UX (help system interactions, guided tours, settings organization), UI Design (help panel styling, settings layout, report preview), Documentation (all help content authoring — primary), Security (export encryption correctness, settings data sanitization), Data Science (report content accuracy verification), Unit Tester, E2E Tester, QA

**Done when:**

- PDF report generates with charts and downloads correctly
- CSV export contains all requested data in correct format
- Encrypted archive encrypts/decrypts correctly with user password
- Settings persist across page reload (theme, params, integrations)
- Storage usage display shows accurate IndexedDB + OPFS usage
- Data cleanup works (delete by range, delete all → returns to empty state)
- Full backup → delete all → restore produces identical data
- Contextual tooltips appear on metric labels throughout the app
- Help panel opens with search, guided tour steps through feature
- Glossary is searchable and contains 50+ terms with layered explanations
- E2E: report generation, settings persistence, help navigation, backup/restore
- CI green

**Depends on:** Phase 9 (analysis views + charts for reports), Phase 5 (import + dashboard for help context)

---

## Phase 11: Plugin Architecture + Integration Stubs

**Goal:** Operationalize the plugin system — core features are registered as plugins, the architecture supports extension, and integration stubs (Fitbit, Weather, LLM) are functional as opt-in plugins.

**Work items:**

- [ ] **Plugin registry** (`src/services/plugins/PluginRegistry.ts`) — Registration with metadata (id, name, version, type, author, capabilities), discovery by type, enable/disable per plugin, dependency resolution, lifecycle hooks (init, destroy)
- [ ] **DataProvider interface** (`src/services/plugins/DataProvider.ts`) — Read-only data access API for plugins: query sessions, query aggregates, query events, read signals (chunked). Prevents direct IndexedDB/OPFS access from plugins.
- [ ] **Core plugin registration** — ResMed parser as MachinePlugin, built-in statistical algorithms as AnalysisPlugins, all chart types as VisualizationPlugins, PDF/CSV/encrypted as ExportPlugins. Verify they work identically when accessed through plugin interfaces.
- [ ] **Integration plugin base** (`src/plugins/integrations/`) — `IntegrationPlugin` interface implementation with: permission model (user must explicitly enable + configure), domain allowlist enforcement (fetch policy integration), OAuth helper for Fitbit, API key management for Weather/LLM
- [ ] **Fitbit integration stub** — OAuth 2.0 PKCE flow (client-side, no server), heart rate + HRV + SpO₂ + sleep stage data fetch, correlation with CPAP metrics display, enable/disable toggle in settings
- [ ] **Weather integration stub** — API key configuration, location picker (lat/long or auto-detect), temperature/humidity/pressure/AQI data fetch, environmental correlation display
- [ ] **LLM integration stub** — Endpoint configuration (OpenAI-compatible), prompt builder (analysis summary → natural language), streaming response display, enable/disable toggle, works completely without it
- [ ] **Integration analysis view** (`src/views/Analysis/Integrations/`) — Integration cards (connected/disconnected status), data preview when connected, correlation analysis with CPAP metrics
- [ ] **Network policy enforcement** — Verify `fetch()` monkey-patch correctly blocks non-allowlisted domains, verify integration plugins can only reach their configured endpoints
- [ ] **Unit tests** — Plugin registration/discovery/lifecycle, DataProvider query correctness, integration config validation, network policy enforcement, OAuth PKCE flow
- [ ] **E2E tests** — Enable integration → configure → verify UI state, disable → verify no network requests

**Agents:** Frontend (plugin registry, DataProvider, integration UI), Security (network policy, OAuth security, API key storage, domain allowlisting — primary), ResMed Specialist (verify MachinePlugin interface works for ResMed), Data Science (verify AnalysisPlugin interface works for algorithms), Unit Tester, E2E Tester, QA

**Done when:**

- PluginRegistry lists all core plugins, can enable/disable
- DataProvider correctly abstracts storage access (no direct IndexedDB/OPFS from plugin code)
- Core features work identically when accessed as plugins vs directly
- Integration stubs show configuration UI and handle enable/disable correctly
- Network policy blocks unauthorized requests and allows configured integration endpoints
- OAuth PKCE flow is implemented correctly (no client secrets exposed)
- All integration features are opt-in and non-functional by default
- App works fully without any integrations enabled
- Unit tests ≥80% coverage on plugin code
- CI green

**Depends on:** Phase 9 (analysis views), Phase 3 (storage for DataProvider)

---

## Phase 12: Performance Optimization + Security Hardening + Accessibility Audit

**Goal:** Production hardening — enforce bundle size budgets, profile and optimize critical paths, implement all security controls, and achieve comprehensive WCAG AA compliance.

**Work items:**

- [ ] **Code splitting audit** — Verify all routes are lazy-loaded (React.lazy + Suspense), Recharts/D3/analysis code in separate chunks, no analysis code in initial bundle. Measure actual chunk sizes.
- [ ] **Bundle size enforcement** — Configure `size-limit` in CI: initial bundle ≤ 150KB gzipped, total JS ≤ 500KB gzipped (per performance-strategy.md budgets). CI build fails on violation.
- [ ] **Lazy loading verification** — Analysis views, Signal Viewer, D3 charts, Report Generator, Help panel all loaded on demand. Network waterfall clean.
- [ ] **Signal rendering profiling** — Profile LTTB + Canvas at 1M+ data points. Optimize: pre-computed downsampled caches in OPFS (1-sample/min, 1-sample/hr), viewport buffer for smooth panning, typed array pooling for GC reduction.
- [ ] **Memory profiling** — Verify < 500MB heap under stress (1 year of data loaded). LRU eviction working for signal cache. Worker idle timeout releasing memory. No memory leaks on view transitions.
- [ ] **`fetch()` network policy** (`src/core/network-policy.ts`) — Production monkey-patch of `fetch` and `XMLHttpRequest` to block all requests except user-configured integration domains. Log blocked requests for debugging.
- [ ] **CSP meta tag** — `<meta http-equiv="Content-Security-Policy">` in `index.html`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' <integration-domains>; img-src 'self' blob: data:; worker-src 'self' blob:`
- [ ] **PHI-safe logging** (`src/core/logger.ts`) — Strip all patient data from error messages and console output. Error export function for debugging (downloads sanitized log file).
- [ ] **Input sanitization** — All user-provided text (session notes, tags, search queries) sanitized before rendering. EDF filename sanitization. No innerHTML usage.
- [ ] **WCAG AA audit** — Color contrast ≥ 4.5:1 for normal text, ≥ 3:1 for large text (verify all token pairs). Focus-visible indicators on all interactive elements. Keyboard navigation for all views (tab order, arrow keys in lists/tables/charts, Escape closes modals/drawers). Screen reader landmarks (`<main>`, `<nav>`, `<aside>`), live regions for dynamic content (import progress, analysis results). `aria-label`/`aria-describedby` on all charts.
- [ ] **Chart accessibility** — Every chart has "View as Table" alternative (verify from Phase 9). Charts announce summary to screen readers on load. Chart keyboard navigation (arrow through data points).
- [ ] **Skip nav** — "Skip to main content" link as first focusable element
- [ ] **Reduced motion** — `prefers-reduced-motion` media query disables chart animations, page transitions, loading spinners → static alternatives
- [ ] **Unit tests** — Network policy blocking verification, sanitization functions, CSP validation
- [ ] **E2E tests** — Keyboard-only navigation of critical path (import → dashboard → session detail → analysis), axe-core audit (via @axe-core/playwright) with zero serious/critical violations, bundle size assertion

**Agents:** Performance (code splitting, bundle analysis, rendering profiling, memory — primary), Security (network policy, CSP, PHI logging, sanitization — primary), Frontend (accessibility fixes, skip nav, reduced motion, keyboard handling), UX (keyboard navigation flow, focus management, screen reader experience), DevOps (size-limit CI integration, performance monitoring), E2E Tester (keyboard nav test, axe-core audit), QA (comprehensive WCAG review)

**Done when:**

- Initial bundle ≤ 150KB gzipped (CI enforced)
- Total JS ≤ 500KB gzipped (CI enforced)
- Canvas renders 1M+ points in < 200ms
- Memory stays under 500MB heap with 1 year of data
- `fetch('https://evil.com')` throws SecurityError
- CSP meta tag present and validated
- No PHI appears in error logs (verified by Security agent)
- All interactive elements keyboard-accessible (verified via E2E)
- axe-core reports zero serious/critical violations
- Color contrast meets AA ratios on all elements
- `prefers-reduced-motion` disables all animations
- CI green with size-limit checks passing

**Depends on:** Phases 5–11 (all features complete)

---

## Phase 13: Comprehensive E2E Test Suite + Final QA + Release

**Goal:** Comprehensive Playwright test suite across Chromium/Firefox/WebKit, visual regression baselines, final QA pass against all 14 design documents, and v1 release.

**Work items:**

- [ ] **Critical path E2E suite** (`tests/e2e/critical-path/`) — App loads, first-launch empty state, import synthetic EDF (full flow), dashboard KPI verification, session list browsing, session detail metrics, signal viewer rendering, analysis execution (one of each type), report generation, settings persistence. **All 3 browsers.**
- [ ] **Analysis E2E suite** (`tests/e2e/analysis/`) — Statistical analysis with parameter changes, event analysis with cluster configuration, pressure analysis with scatter interaction. **Chromium primary.**
- [ ] **Signal viewer E2E suite** (`tests/e2e/signals/`) — Multi-channel render, zoom in/out, pan, crosshair, event markers, zoom presets. **Chromium primary.**
- [ ] **Data management E2E suite** (`tests/e2e/data/`) — Import, re-import (dedup), export session, backup, delete all, restore from backup, storage usage display. **Chromium primary.**
- [ ] **Help & settings E2E suite** (`tests/e2e/settings/`) — Settings changes + reload persistence, help panel navigation + search, guided tour completion, keyboard shortcut reference, glossary. **Chromium primary.**
- [ ] **Accessibility E2E suite** (`tests/e2e/accessibility/`) — Keyboard-only navigation of entire app, axe-core automated scan on every route, skip-to-content link, focus management on route changes, screen reader landmark verification. **Chromium.**
- [ ] **Visual regression baselines** — Screenshot comparisons for: dashboard, session detail, signal viewer, each analysis view, settings, help panel — both light and dark themes. Chromium only. Committed as reference images.
- [ ] **Cross-browser test matrix** — Critical path: all 3 browsers. Feature-specific: Chromium primary, Firefox/WebKit for nightly/CI.
- [ ] **Final QA pass** — QA agent reviews entire application against all 14 design docs: ux-design.md, ui-design-system.md, frontend-architecture.md, storage-architecture.md, resmed-machine-support.md, data-analysis.md, data-visualization.md, performance-strategy.md, error-handling-architecture.md, security-architecture.md, documentation-strategy.md, e2e-testing-strategy.md, unit-testing-strategy.md, deployment-architecture.md. Files issues for any gaps.
- [ ] **Performance final check** — Lighthouse audit on production build (target: Performance ≥ 90, Accessibility ≥ 90, Best Practices ≥ 90). Bundle size report. Memory profiling summary.
- [ ] **CHANGELOG.md** — Document all features across Phases 1–13 per Keep a Changelog format
- [ ] **README.md update** — Feature list, usage instructions, browser support matrix, privacy architecture summary, screenshots
- [ ] **CalVer release** — Version tag per `YYYY.0M.MICRO` format, GitHub release with notes
- [ ] **Deploy** — Merge to main → CI → GitHub Pages deployment

**Agents:** E2E Tester (full test suite — primary), QA (final design doc audit — primary), Performance (Lighthouse, profiling), DevOps (release tagging, CHANGELOG, README, deployment), Frontend (fix any QA-identified gaps), Security (final security audit), Documentation (README, CHANGELOG), ADR Author (document any implementation decisions that diverged from ADRs)

**Done when:**

- ≥40 E2E tests passing
- Critical path tests pass on Chromium, Firefox, and WebKit
- axe-core: zero serious/critical accessibility violations on all routes
- Visual regression baselines established for both themes
- Lighthouse: Performance ≥ 90, Accessibility ≥ 90, Best Practices ≥ 90
- QA agent approves: all 14 design doc requirements verified implemented (or gaps documented as known limitations)
- No known P0 or P1 bugs remaining
- CHANGELOG.md covers all phases
- CalVer version tag created
- README.md complete with full usage docs and browser support
- CI green on release commit
- Application deployed to GitHub Pages and functional
- **The application is fully implemented per the 14 design documents.**

**Depends on:** Phases 1–12 (all prior work complete)

---

## Phase Summary

| Phase | Title                                    | Key Deliverable                                       |            Gate            |
| :---: | ---------------------------------------- | ----------------------------------------------------- | :------------------------: |
|   1   | Project Scaffolding                      | Blank app builds, CI green                            |             —              |
|   2   | Types, Design System, App Shell          | Full skeleton with themed components and routing      |             —              |
|   3   | Storage, Workers, EDF Parser             | Infrastructure pillars with synthetic data tests      |             —              |
|   4   | Real Data Validation & Import Path       | Validated parser, import pipeline, sanitized fixtures | **User provides EDF data** |
|   5   | Import UI + Dashboard                    | First end-to-end user flow                            |             —              |
|   6   | Session Views + Signal Viewer            | Session browsing and Canvas signal rendering          |             —              |
|   7   | Analysis Engine — Core                   | Descriptive, time-series, correlation algorithms      |             —              |
|   8   | Analysis Engine — Advanced               | Hypothesis, distribution, events, survival, pressure  |             —              |
|   9   | Analysis Views + Visualization Library   | Full chart library and analysis UI                    |             —              |
|  10   | Reports, Settings, Data Management, Help | All remaining features                                |             —              |
|  11   | Plugin Architecture + Integrations       | Extensible plugin system, opt-in integrations         |             —              |
|  12   | Performance + Security + Accessibility   | Production hardening, WCAG AA, bundle budgets         |             —              |
|  13   | E2E Test Suite + Final QA + Release      | Comprehensive tests, QA audit, v1 release             |             —              |
