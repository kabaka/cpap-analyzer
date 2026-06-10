# Performance Optimization Strategy — CPAP Analyzer

**Version**: 1.0  
**Last Updated**: February 10, 2026  
**Status**: Architecture Decision Record  
**Audience**: Performance, Frontend, Data Science, Data Visualization, Database agents

## Executive Summary

This document defines the comprehensive performance optimization strategy for CPAP Analyzer. The application must handle years of high-frequency time-series data (25–50 Hz, potential dataset sizes exceeding 20 GB) while maintaining a responsive, fluid user experience on devices ranging from high-end desktops to modest laptops.

Performance is a **first-class architectural concern**, not an afterthought. Every architectural decision documented in [frontend-architecture.md](frontend-architecture.md), [storage-architecture.md](storage-architecture.md), [data-analysis.md](data-analysis.md), and [data-visualization.md](data-visualization.md) has been made with performance constraints at the forefront.

### Core Performance Challenges

1. **Scale**: Years of 25–50 Hz data = hundreds of millions of data points
2. **Memory**: Limited browser heap (typically 2–4 GB practical limit)
3. **Responsiveness**: UI must remain responsive during heavy computation
4. **Initial Load**: Bundle size must support fast first load even on slow connections
5. **Platform Diversity**: Wide range of device capabilities (mobile, laptop, desktop)

### Strategic Approach

- **Lazy Everything**: Compute only what's visible/needed, when needed
- **Worker Isolation**: Heavy computation off the main thread
- **Streaming Processing**: Avoid full data materialization
- **Aggressive Caching**: Cache expensive computations at multiple levels
- **Progressive Enhancement**: Core functionality fast everywhere, advanced features for capable devices

---

## 1. Performance Goals & Metrics

### 1.1 Core Web Vitals Targets

| Metric                              | Target  | Threshold      | Current Importance       |
| ----------------------------------- | ------- | -------------- | ------------------------ |
| **Largest Contentful Paint (LCP)**  | < 1.5s  | < 2.5s (Good)  | Critical                 |
| **First Input Delay (FID)**         | < 50ms  | < 100ms (Good) | Critical                 |
| **Cumulative Layout Shift (CLS)**   | < 0.05  | < 0.1 (Good)   | Critical                 |
| **Interaction to Next Paint (INP)** | < 100ms | < 200ms (Good) | Critical (replacing FID) |
| **Time to First Byte (TTFB)**       | < 200ms | < 600ms (Good) | Important                |
| **First Contentful Paint (FCP)**    | < 1.0s  | < 1.8s (Good)  | Important                |

**Rationale**: These targets represent "Good" scores according to Chrome User Experience Report (CrUX) methodology. LCP < 1.5s provides instant perceived performance. INP < 100ms ensures UI feels immediate and responsive.

### 1.2 Application-Specific Performance Targets

#### 1.2.1 Import & Parsing

| Operation                                 | Target  | Acceptable | Notes                                     |
| ----------------------------------------- | ------- | ---------- | ----------------------------------------- |
| **Single night EDF parse**                | < 2s    | < 5s       | Typical 6 MB BRP.edf file on main thread  |
| **Single night EDF parse (Worker)**       | < 1s    | < 3s       | Same file, Web Worker parallel processing |
| **Full SD card scan**                     | < 10s   | < 30s      | Directory enumeration, no parsing         |
| **Multi-night batch import (10 nights)**  | < 30s   | < 90s      | Parallel Worker pool, 4 concurrent        |
| **Multi-night batch import (100 nights)** | < 5min  | < 15min    | Batch processing with progress updates    |
| **IndexedDB write (single session)**      | < 500ms | < 1.5s     | Metadata + aggregate metrics              |
| **OPFS write (signal data, per night)**   | < 1.5s  | < 4s       | ~6 MB Float32Array to OPFS                |

**Testing Methodology**: Benchmarked on "reference system" (2020 MacBook Pro, M1, 16 GB RAM, Chrome 120+). Acceptable threshold = 3× target for "low-end system" (2018 laptop, Core i5, 8 GB RAM).

#### 1.2.2 Analysis Computation

| Analysis Type                            | Target  | Acceptable | Notes                                    |
| ---------------------------------------- | ------- | ---------- | ---------------------------------------- |
| **Nightly aggregate query (1 year)**     | < 50ms  | < 150ms    | IndexedDB query, 365 records             |
| **Time-series analysis (1 year)**        | < 200ms | < 500ms    | Rolling statistics, trend detection      |
| **Correlation analysis (2 years)**       | < 500ms | < 1.5s     | Pearson correlation, significance tests  |
| **Event clustering (1 year)**            | < 1s    | < 3s       | FLG clustering algorithm                 |
| **Signal-based analysis (single night)** | < 3s    | < 10s      | Breath-by-breath flow limitation, Worker |
| **Signal-based analysis (1 week)**       | < 20s   | < 60s      | 7× single night, parallel processing     |
| **Cache lookup**                         | < 10ms  | < 30ms     | IndexedDB indexed query                  |

**Testing Methodology**: Median of 10 runs with cold cache, using representative real-world datasets. Measure from user action trigger to result display completion.

#### 1.2.3 Visualization Rendering

| Visualization                                    | Target  | Acceptable | Notes                            |
| ------------------------------------------------ | ------- | ---------- | -------------------------------- |
| **Recharts render (< 1k points)**                | < 100ms | < 300ms    | Standard Recharts rendering      |
| **Recharts render (< 10k points)**               | < 500ms | < 1.5s     | Recharts with optimized data     |
| **Canvas time-series (1M points, downsampled)**  | < 200ms | < 600ms    | LTTB to 2k points, Canvas render |
| **Canvas time-series (10M points, downsampled)** | < 500ms | < 1.5s     | LTTB to 2k points, Canvas render |
| **Zoom/pan interaction response**                | < 50ms  | < 100ms    | Viewport recalculation + redraw  |
| **Crosshair update (synchronized charts)**       | < 16ms  | < 33ms     | 60 FPS / 30 FPS                  |
| **Chart resize**                                 | < 100ms | < 300ms    | Layout recalculation + redraw    |
| **Export to PNG (1080p chart)**                  | < 2s    | < 5s       | Canvas → Blob conversion         |

**Testing Methodology**: Measure from requestAnimationFrame to paint completion using Chrome DevTools Performance profiler. Interaction targets based on 60 FPS goal (16.67ms budget).

#### 1.2.4 Initial Load Performance

| Metric                                     | Target  | Acceptable | Notes                                     |
| ------------------------------------------ | ------- | ---------- | ----------------------------------------- |
| **Bundle size (initial, gzipped)**         | ≤150 KB | ≤200 KB    | Main app bundle without code-split chunks |
| **Route bundles (per route, gzipped)**     | ≤75 KB  | ≤100 KB    | Code-split route chunks                   |
| **Worker bundles (per worker, gzipped)**   | ≤50 KB  | ≤75 KB     | ResMed parser and other workers           |
| **Vendor chunks (gzipped)**                | ≤120 KB | ≤150 KB    | React, Radix UI, shared dependencies      |
| **Total JavaScript (all chunks, gzipped)** | ≤500 KB | ≤1 MB      | All bundles combined                      |
| **CSS (total, gzipped)**                   | ≤30 KB  | ≤50 KB     | All stylesheets                           |
| **Fonts (gzipped)**                        | ≤40 KB  | ≤60 KB     | Subsetted fonts (if any)                  |
| **Time to Interactive (TTI)**              | < 2s    | < 3.5s     | On 3G connection (1.6 Mbps)               |
| **Service Worker cache priming**           | < 5s    | < 10s      | Background, non-blocking                  |
| **IndexedDB schema initialization**        | < 100ms | < 300ms    | First launch only                         |

**Note**: Bundle size targets are enforced in CI/CD. See [devops-architecture.md](./devops-architecture.md) for detailed target breakdown and monitoring strategy.

**Testing Methodology**: Lighthouse audit in lab environment with throttled 3G connection (1.6 Mbps, 150ms RTT). Clear cache between tests.

### 1.3 Memory Budgets

| Component                         | Budget   | Critical Threshold | Recovery Strategy                        |
| --------------------------------- | -------- | ------------------ | ---------------------------------------- |
| **React component tree**          | < 50 MB  | < 100 MB           | Virtualization, unmount off-screen       |
| **Chart rendering (active)**      | < 100 MB | < 200 MB           | LOD downsampling, Canvas reuse           |
| **Analysis computation (Worker)** | < 200 MB | < 500 MB           | Streaming algorithms, chunked processing |
| **Signal data (in-memory cache)** | < 100 MB | < 200 MB           | LRU eviction, OPFS read-through          |
| **Nightly aggregates cache**      | < 20 MB  | < 50 MB            | In-memory LRU, IndexedDB backing         |
| **Total heap (per tab)**          | < 500 MB | < 1 GB             | Combined budget                          |

**Monitoring**: Continuous heap snapshots during automated test runs. Critical threshold triggers warning in development console and telemetry flag.

**Recovery Strategies**:

- **Component unmounting**: Virtualized lists, route-based code splitting
- **Cache eviction**: LRU with size-based limits
- **Worker termination**: Terminate idle Workers after 30s
- **Explicit GC hints**: `null` references, clear large arrays

### 1.4 Performance Budgets (Bundle Size)

**Canonical Bundle Size Targets** (enforced in CI):

| Bundle Type                     | Target (gzipped) | Threshold (Fail CI) | Notes                                      |
| ------------------------------- | ---------------- | ------------------- | ------------------------------------------ |
| **Initial (main entry)**        | ≤150 KB          | ≤200 KB             | Main app bundle with core framework        |
| **Route bundles (per route)**   | ≤75 KB           | ≤100 KB             | Dashboard, Analysis, Settings, Help routes |
| **Worker bundles (per worker)** | ≤50 KB           | ≤75 KB              | ResMed parser, analysis workers            |
| **Vendor chunks**               | ≤120 KB          | ≤150 KB             | React, Radix UI, Zustand, shared deps      |
| **Total application**           | ≤500 KB          | ≤1 MB               | All JavaScript bundles combined            |
| **CSS (total)**                 | ≤30 KB           | ≤50 KB              | All stylesheets                            |
| **Fonts**                       | ≤40 KB           | ≤60 KB              | Subsetted fonts (if any)                   |

**Component Budget Breakdown** (for planning and monitoring):

| Component           | Budget (gzipped) | Budget (uncompressed) | Notes                                |
| ------------------- | ---------------- | --------------------- | ------------------------------------ |
| Core framework      | ~45 KB           | ~130 KB               | React, React-DOM, Router             |
| State management    | ~3 KB            | ~10 KB                | Zustand                              |
| UI components       | ~20 KB           | ~60 KB                | Radix primitives + custom components |
| Charting libraries  | ~80 KB           | ~240 KB               | Recharts + D3 subset (lazy-loaded)   |
| Analysis engine     | ~50 KB           | ~150 KB               | Statistical algorithms               |
| Storage layer       | ~15 KB           | ~45 KB                | IndexedDB wrapper, OPFS utilities    |
| Utilities & helpers | ~20 KB           | ~60 KB                | Date formatting, validation, etc.    |
| Machine plugins     | ~40-50 KB        | ~120-150 KB           | ResMed EDF parser (per worker)       |
| Service Worker      | ~10 KB           | ~30 KB                | Workbox runtime                      |

**Enforcement**: Bundle size targets are enforced in CI/CD using `size-limit`. Builds fail if any bundle exceeds its threshold. See [devops-architecture.md](./devops-architecture.md) for detailed monitoring strategy and PR comment integration.

---

## 2. Critical Performance Paths

### 2.1 Path Identification & Prioritization

**Ranked by user frequency × performance impact**:

| Rank | User Flow                             | Frequency            | Perf Impact | Priority |
| ---- | ------------------------------------- | -------------------- | ----------- | -------- |
| 1    | **View dashboard (recent data)**      | Every session        | High        | **P0**   |
| 2    | **Navigate to session detail**        | Multiple per session | High        | **P0**   |
| 3    | **Zoom/pan time-series chart**        | Many per session     | Medium      | **P0**   |
| 4    | **Import single night (incremental)** | Daily                | High        | **P0**   |
| 5    | **Run trend analysis (1 year)**       | Weekly               | High        | **P1**   |
| 6    | **Compare sessions side-by-side**     | Occasional           | Medium      | **P1**   |
| 7    | **Initial bulk import (setup)**       | Once                 | Very High   | **P1**   |
| 8    | **Export session report (PDF)**       | Occasional           | Medium      | **P2**   |
| 9    | **Custom plugin execution**           | Power users          | Variable    | **P2**   |

**P0 (Critical)**: Must meet target performance on all supported devices. Continuous monitoring. Regressions block releases.  
**P1 (Important)**: Must meet acceptable performance on reference system. Monitored in CI. Regressions require issue filing.  
**P2 (Nice-to-have)**: Best-effort optimization. No performance gates.

### 2.2 Path: Initial App Load

**Flow**: User navigates to app URL → sees interactive dashboard

**Critical Rendering Path**:

```
DNS Lookup → TCP → TLS → HTML → CSS → JS (main bundle) → Parse/Compile
  ↓
React Hydration → Zustand Init → Router Init → Dashboard Render
  ↓
IndexedDB Open → Load Recent Sessions → Fetch Aggregates → Render Charts
```

**Optimization Strategy**:

1. **Minimize initial bundle**:
   - Code-split by route (Dashboard, SessionDetail, Settings, Help)
   - Lazy-load charting libraries (load on first chart render, not upfront)
   - Defer non-critical features (export, advanced analysis, plugins)

2. **Optimize critical CSS**:
   - Inline critical CSS (above-the-fold styles) in HTML
   - Defer non-critical stylesheets
   - Use CSS Modules for automatic tree-shaking via Vite

3. **Preload hints**:
   - `<link rel="modulepreload">` for main bundle
   - `<link rel="preconnect">` for any CDNs (if used)
   - Avoid `<link rel="prefetch">` for non-critical resources

4. **Service Worker strategy**:
   - CacheFirst for static assets (JS, CSS, fonts, images)
   - NetworkFirst for HTML (support updates)
   - No precaching of heavy libraries (load on-demand)

5. **Progressive loading**:
   - Show skeleton UI immediately (no loading spinner)
   - Render dashboard cards incrementally as data loads
   - Defer heavy chart rendering until viewport (Intersection Observer)

**Current Measurement (Target)**:

- HTML: 5 KB gzipped → 2 KB target (inline critical CSS + shell)
- Main JS bundle: Must be ≤150 KB target / ≤200 KB threshold (enforced in CI)
- Route bundles: Must be ≤75 KB target / ≤100 KB threshold per route
- Worker bundles: Must be ≤50 KB target / ≤75 KB threshold per worker
- Vendor chunks: Must be ≤120 KB target / ≤150 KB threshold
- Total JS: Must be ≤500 KB target / ≤1 MB threshold
- CSS: Must be ≤30 KB target / ≤50 KB threshold
- Fonts: ≤40 KB target / ≤60 KB threshold (system fonts preferred)

**Monitoring**: Lighthouse CI on every PR. LCP regression > 200ms fails CI. Bundle size targets are enforced via `size-limit` (see [devops-architecture.md](./devops-architecture.md)).

### 2.3 Path: Import & Parsing Workflow

**Flow**: User selects SD card directory → scans files → parses EDFs → writes to storage

**Detailed Flow**:

```
File System Access API → Directory Handle → Enumerate Files
  ↓
Filter EDF Files by Date → Group by Session Date
  ↓
(For each session, in parallel)
  ↓
Transfer EDF File → Worker → Parse Header → Validate
  ↓
Parse Signals → Parse Annotations → Compute Aggregates
  ↓
Write to OPFS (signals) + IndexedDB (metadata/aggregates)
  ↓
Update UI Progress → (Next session)
```

**Bottlenecks**:

1. **File reading**: Transfer from OPFS/file system to Worker memory
2. **EDF parsing**: Header parsing (sync), signal decoding (CPU-intensive)
3. **Storage writes**: Serial OPFS writes can block; IndexedDB transaction contention

**Optimization Strategy**:

1. **Parallel processing**:
   - **Worker pool** (4–8 workers depending on `navigator.hardwareConcurrency`)
   - Each Worker handles one session end-to-end
   - Queue sessions; dispatch to idle Workers
   - Limit active Workers to avoid memory exhaustion

2. **Streaming EDF parsing**:
   - Don't read entire file into memory
   - Use FileReader or ReadableStream to parse in chunks
   - Parse header (first 256 bytes + per-signal headers) first
   - Stream data records in batches (e.g., 10 MB at a time)
   - Directly write signal chunks to OPFS as they're decoded

3. **Zero-copy transfers**:
   - Transfer `ArrayBuffer` ownership to Worker (not structured clone)
   - Use Comlink's `transfer()` helper for transferable objects
   - Worker transfers result buffers back to main thread

4. **Batched storage writes**:
   - Accumulate metadata for multiple sessions
   - Single IndexedDB transaction for batch insert
   - OPFS writes are naturally batched per session
   - Commit transactions only on Worker completion

5. **Incremental feedback**:
   - Update progress bar every 500ms (not on every session)
   - Use `requestIdleCallback` for progress UI updates
   - Show ETA based on average session processing time

**Expected Performance (10 night import)**:

| Stage                      | Time | Cumulative |
| -------------------------- | ---- | ---------- |
| Directory scan             | 1s   | 1s         |
| Transfer files to Workers  | 2s   | 3s         |
| Parse + compute (parallel) | 8s   | 11s        |
| Write to storage           | 4s   | 15s        |
| **Total**                  | —    | **15s**    |

**Target**: **< 30s** for 10 nights on reference system.

**Fallback for low-end devices**:

- Reduce Worker pool size to 2
- Process sessions sequentially if memory pressure detected
- Target: < 90s acceptable on low-end system

### 2.4 Path: Dashboard Render

**Flow**: App loads → fetch recent sessions → aggregate metrics → render dashboard cards

**Detailed Flow**:

```
Router Navigation → Dashboard Component Mount
  ↓
Zustand: Get Date Range (default: last 30 days)
  ↓
IndexedDB Query: nightly_aggregates WHERE date IN (dateRange)
  ↓
Aggregate Metrics (mean, trend, compliance %)
  ↓
Render Dashboard Cards + Mini-Charts
```

**Optimization Strategy**:

1. **Indexed queries**:
   - Ensure `date` index on `nightly_aggregates` (see [storage-architecture.md](storage-architecture.md#22-object-store-sessions))
   - Use indexed range query: `IDBKeyRange.bound(startDate, endDate)`
   - Avoid full table scans

2. **Lazy card rendering**:
   - Use `IntersectionObserver` to defer off-screen card rendering
   - Render top 3 cards immediately; rest on scroll-into-view
   - Reduces initial render cost by ~60%

3. **Memoization**:
   - Memoize expensive aggregate calculations (`useMemo`)
   - Memoize chart components (`React.memo`)
   - Prevent re-renders on unrelated state changes

4. **Light data fetch**:
   - Dashboard only needs aggregate metrics (already in IndexedDB)
   - Never fetch signal data (OPFS) for dashboard
   - Total data transfer: ~50 KB for 30 days

5. **Progressive chart loading**:
   - Render cards with numeric values first
   - Load chart library on-demand (code-split)
   - Render charts incrementally (one per frame via `requestIdleCallback`)

**Expected Performance**:

- IndexedDB query (30 days): **< 20ms**
- Metric aggregation: **< 10ms**
- Initial render (3 cards): **< 100ms**
- Full dashboard (6+ cards): **< 300ms**

### 2.5 Path: Session Detail View

**Flow**: User clicks session → navigate to detail → load signals → render charts

**Detailed Flow**:

```
Router Navigation → SessionDetail Component Mount
  ↓
Fetch Session Metadata (IndexedDB)
  ↓
Fetch Nightly Aggregate (IndexedDB)
  ↓
Render Header + Summary Metrics
  ↓
(User scrolls to chart)
  ↓
IntersectionObserver Trigger → Load Signal Data
  ↓
OPFS Read (signal chunk) → Downsample (Worker) → Render Canvas Chart
```

**Optimization Strategy**:

1. **Staggered loading**:
   - Load metadata/aggregates immediately (< 50 KB)
   - Render summary section instantly
   - Defer signal data load until chart scrolls into viewport

2. **On-demand signal loading**:
   - Don't load all signals upfront (6 MB per session)
   - Load only visible chart's signal (e.g., Flow first)
   - Load additional signals when user switches chart tabs

3. **Level-of-detail downsampling** (see [data-visualization.md](data-visualization.md#4-level-of-detail-lod-downsampling)):
   - **LTTB (Largest Triangle Three Buckets)** for non-zoomed view
   - Downsample 720k samples → 2k points for initial render
   - Perform downsampling in Worker (off main thread)
   - Cache downsampled result in memory (invalidate on zoom)

4. **Viewport-based rendering**:
   - Canvas renders only visible time range
   - Zoom/pan triggers incremental redraw (not full reparse)
   - Use `requestAnimationFrame` for smooth interactions

5. **Lazy chart component loading**:
   - Code-split heavy chart libraries (D3, Recharts)
   - Load on first session detail navigation
   - Cache loaded module for subsequent views

**Expected Performance**:

- Metadata fetch: **< 20ms**
- Page render (no charts): **< 100ms**
- Signal fetch + downsample (Worker): **< 500ms**
- Chart render (Canvas): **< 200ms**
- **Total Time to Interactive**: **< 800ms**

### 2.6 Path: Analysis Computation

**Flow**: User requests trend analysis → fetch data → compute → cache → display

**Detailed Flow**:

```
User Action (e.g., "Show AHI Trend") → Analysis Request
  ↓
Check Cache (IndexedDB analysis_results)
  ↓ (if miss)
Fetch Required Data (nightly_aggregates query)
  ↓
Transfer to Worker → Run Analysis Algorithm → Transfer Result
  ↓
Cache Result → Render Visualization
```

**Optimization Strategy**:

1. **Aggressive result caching** (see [data-analysis.md](data-analysis.md#132-cache-strategy)):
   - Cache key: `${analysisType}:${dateRangeHash}:${parametersHash}`
   - Cache hit: return immediately (< 10ms)
   - Cache miss: compute + store
   - Invalidate on data import for overlapping date range

2. **Incremental computation**:
   - For analyses that support incremental updates (running statistics, rolling windows)
   - Store intermediate state in cache
   - On new data import, update state incrementally (don't recompute from scratch)
   - Reduces 1-year analysis from 500ms → 50ms on incremental update

3. **Worker isolation**:
   - All analyses > 100ms execute in Worker
   - Transfer data to Worker via `ArrayBuffer` (transferable)
   - Worker executes algorithm without blocking main thread
   - Return result as transferable where possible

4. **Batched data fetch**:
   - Single IndexedDB query for entire date range
   - Transfer full dataset to Worker once
   - Worker performs all required analyses in one session
   - Avoid round-trip latency per analysis

5. **Progressive results**:
   - For long-running analyses (> 5s), stream partial results
   - Worker posts intermediate updates (e.g., "50% complete")
   - Update UI progressively (show partial chart)
   - User perceives progress, not blocking

**Expected Performance (1 year of data)**:

| Analysis                       | Cache Hit | Cache Miss | Data Size |
| ------------------------------ | --------- | ---------- | --------- |
| AHI trend (rolling 7-day avg)  | < 10ms    | 200ms      | ~150 KB   |
| Correlation (AHI vs leak)      | < 10ms    | 300ms      | ~150 KB   |
| Event clustering (FLG)         | < 10ms    | 2s         | ~2 MB     |
| Signal-based (breath analysis) | < 10ms    | 20s        | ~500 MB   |

**Cache hit rate target**: > 80% for analyses (measured via telemetry).

### 2.7 Path: Chart Interaction (Zoom/Pan)

**Flow**: User drags to zoom → update chart state → re-render visible region

**Detailed Flow**:

```
User Mouse/Touch Event → Interaction Handler
  ↓
Zustand: Update Zoom Domain
  ↓
Re-render Chart Component (React)
  ↓
Recalculate Visible Data Range
  ↓
Downsample Visible Region (if > 2k points)
  ↓
Canvas Redraw (only visible region)
```

**Optimization Strategy**:

1. **Debounced state updates**:
   - Capture mouse events at 60 FPS
   - Update Zustand store max every 16ms (60 FPS pacing)
   - Avoid thrashing React render cycle

2. **Viewport-only rendering**:
   - Never render data outside visible canvas bounds
   - Calculate visible time range from zoom domain
   - Filter dataset to visible range before downsampling
   - Reduces processing from 720k points → ~50k visible points

3. **LOD re-downsampling**:
   - As user zooms in, increase LOD resolution
   - Zoom level 1 (full view): 2k points
   - Zoom level 2 (10× zoom): 5k points
   - Zoom level 3 (100× zoom): 10k points (show more detail)
   - Perform downsampling in Worker to avoid main thread block

4. **Canvas double-buffering**:
   - Draw to offscreen canvas during computation
   - Swap buffers on complete (single blit operation)
   - Ensures no partial draws/flickers

5. **RequestAnimationFrame pacing**:
   - Schedule redraws via `requestAnimationFrame`
   - Coalesce multiple zoom events per frame
   - Never block frame rendering (target 60 FPS)

**Expected Performance**:

- Interaction response (zoom/pan): **< 50ms** (20 FPS minimum)
- Target: **< 16ms** (60 FPS) on reference system
- Acceptable: **< 33ms** (30 FPS) on low-end devices

---

## 3. Optimization Strategies

### 3.1 Code Splitting & Lazy Loading

**Strategy**: Minimize initial bundle; load features on-demand

**Route-Based Splitting**:

```typescript
// src/App.tsx
import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';

// Loaded immediately (part of main bundle)
import Dashboard from './views/Dashboard';

// Lazy-loaded (separate chunks)
const SessionDetail = lazy(() => import('./views/SessionDetail'));
const TrendAnalysis = lazy(() => import('./views/TrendAnalysis'));
const Settings = lazy(() => import('./views/Settings'));
const Help = lazy(() => import('./views/Help'));

function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/session/:id" element={<SessionDetail />} />
        <Route path="/trends" element={<TrendAnalysis />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/help" element={<Help />} />
      </Routes>
    </Suspense>
  );
}
```

**Feature-Based Splitting**:

```typescript
// src/components/SessionChart.tsx
import { lazy, Suspense } from 'react';

// Lazy-load heavy charting library
const RechartsRenderer = lazy(() => import('./RechartsRenderer'));
const CanvasRenderer = lazy(() => import('./CanvasRenderer'));

export function SessionChart({ data, highFrequency }: Props) {
  const Renderer = highFrequency ? CanvasRenderer : RechartsRenderer;

  return (
    <Suspense fallback={<ChartSkeleton />}>
      <Renderer data={data} />
    </Suspense>
  );
}
```

**Library Splitting**:

| Library                | Bundle Size    | Strategy                            |
| ---------------------- | -------------- | ----------------------------------- |
| **Recharts**           | 80 KB gzipped  | Lazy-load on first chart render     |
| **D3 (subset)**        | 30 KB gzipped  | Lazy-load for custom visualizations |
| **PDF export (jsPDF)** | 120 KB gzipped | Lazy-load on export action          |
| **Fitbit integration** | 40 KB gzipped  | Lazy-load on integration page       |
| **Plugin system**      | 50 KB gzipped  | Lazy-load on first plugin use       |

**Granular Imports**:

```typescript
// ❌ Bad: Imports entire d3 library (~240 KB)
import * as d3 from 'd3';

// ✅ Good: Import only needed modules (~15 KB)
import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import { axisBottom } from 'd3-axis';
```

**Vite Configuration**:

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunk (React, Router, Zustand)
          vendor: ['react', 'react-dom', 'react-router-dom', 'zustand'],

          // Charting chunk (lazy-loaded)
          charting: ['recharts'],

          // Analysis chunk (lazy-loaded)
          analysis: ['./src/analysis/engine.ts'],
        },
      },
    },

    // Enable minification and tree-shaking
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.log in production
        drop_debugger: true,
      },
    },

    // Target modern browsers (smaller bundle)
    target: 'es2020',
  },
});
```

**Expected Impact**:

- Initial bundle: **180 KB → 150 KB** (17% reduction)
- Total bundle (all chunks): **800 KB → 500 KB** (38% reduction)
- Time to Interactive: **2.5s → 1.8s** (28% improvement) on 3G

### 3.2 Web Worker Utilization Patterns

**Strategy**: Isolate CPU-intensive tasks to prevent main thread blocking

**Worker Pool Architecture**:

```typescript
// src/workers/WorkerPool.ts
export class WorkerPool {
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private taskQueue: Task[] = [];

  constructor(workerScript: string, poolSize: number = navigator.hardwareConcurrency || 4) {
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(workerScript, { type: 'module' });
      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  async execute<T>(task: () => Promise<T>): Promise<T> {
    const worker = await this.getIdleWorker();
    try {
      const result = await this.runTask(worker, task);
      return result;
    } finally {
      this.releaseWorker(worker);
    }
  }

  private async getIdleWorker(): Promise<Worker> {
    if (this.idleWorkers.length > 0) {
      return this.idleWorkers.pop()!;
    }
    // Wait for worker to become idle
    return new Promise((resolve) => {
      this.taskQueue.push({ resolve });
    });
  }

  private releaseWorker(worker: Worker): void {
    if (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift()!;
      task.resolve(worker);
    } else {
      this.idleWorkers.push(worker);
    }
  }
}
```

**EDF Parsing Worker**:

```typescript
// src/workers/edfParser.worker.ts
import { expose } from 'comlink';
import { EDFParser } from '../parsers/edf';

const api = {
  async parseEDF(fileBuffer: ArrayBuffer): Promise<SessionData> {
    // Runs off main thread
    const parser = new EDFParser(fileBuffer);
    const header = parser.parseHeader();
    const signals = parser.parseSignals();
    const annotations = parser.parseAnnotations();
    const aggregates = computeNightlyAggregates(signals, annotations);

    return {
      header,
      signals,
      annotations,
      aggregates,
    };
  },
};

expose(api);
```

**Analysis Worker**:

```typescript
// src/workers/analysis.worker.ts
import { expose } from 'comlink';
import { runAnalysis } from '../analysis/engine';

const api = {
  async analyze(type: string, data: Float32Array, params: unknown): Promise<AnalysisResult> {
    // Heavy computation off main thread
    const result = await runAnalysis(type, data, params);
    return result;
  },

  async downsample(data: Float32Array, targetPoints: number): Promise<Float32Array> {
    // LTTB downsampling
    const downsampled = lttb(data, targetPoints);
    // Transfer ownership back to main thread (zero-copy)
    return downsampled;
  },
};

expose(api);
```

**Comlink Integration**:

```typescript
// src/services/workerService.ts
import { wrap } from 'comlink';
import type { EDFParserAPI } from '../workers/edfParser.worker';

let parserWorkerPool: WorkerPool;

export function getEDFParser(): Remote<EDFParserAPI> {
  if (!pars erWorkerPool) {
    parserWorkerPool = new WorkerPool(
      new URL('../workers/edfParser.worker.ts', import.meta.url),
      4 // 4 concurrent Workers
    );
  }

  return wrap<EDFParserAPI>(parserWorkerPool.getWorker());
}
```

**Worker Lifecycle**:

```typescript
// Terminate idle Workers after 30s to free memory
const WORKER_IDLE_TIMEOUT = 30_000;

class ManagedWorker {
  private worker: Worker;
  private idleTimer: number | null = null;

  use(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  release(): void {
    this.idleTimer = setTimeout(() => {
      this.worker.terminate();
      // Remove from pool
    }, WORKER_IDLE_TIMEOUT);
  }
}
```

**Transferable Objects**:

```typescript
import { transfer } from 'comlink';

// ❌ Bad: No transfer specified (Comlink will structured clone)
await worker.processData(largeArrayBuffer);

// ✅ Good: Transfer ownership using Comlink's transfer() (zero-copy, fast)
await worker.processData(transfer(largeArrayBuffer, [largeArrayBuffer]));

// After transfer, largeArrayBuffer is neutered (no longer usable in main thread)
```

**Note**: Comlink automatically handles the underlying `postMessage` with transferable list.

**Expected Impact**:

- EDF parsing: **5s → 1s** (5× faster with parallel Workers)
- Signal downsampling: **300ms → 100ms** (3× faster, main thread non-blocking)
- Analysis computation: **2s → 2s** (same duration, but UI remains responsive)

### 3.3 Memory Management & Garbage Collection

**Strategy**: Minimize memory allocations; enable efficient GC

**ArrayBuffer Reuse**:

```typescript
// ❌ Bad: Allocate new buffer on every render
function renderChart(data: Float32Array) {
  const downsampled = new Float32Array(2000);
  // ... populate downsampled
  drawCanvas(downsampled);
}

// ✅ Good: Reuse buffer across renders
class ChartRenderer {
  private downsampledBuffer: Float32Array = new Float32Array(2000);

  renderChart(data: Float32Array) {
    lttbInPlace(data, this.downsampledBuffer);
    drawCanvas(this.downsampledBuffer);
  }
}
```

**Object Pooling** (for high-churn objects):

```typescript
class PointPool {
  private pool: Point[] = [];

  acquire(): Point {
    return this.pool.pop() || { x: 0, y: 0 };
  }

  release(point: Point): void {
    point.x = 0;
    point.y = 0;
    this.pool.push(point);
  }
}

// Use for temporary objects in hot loops
for (let i = 0; i < 1_000_000; i++) {
  const point = pool.acquire();
  // ... use point
  pool.release(point);
}
```

**Weak References** (for caches):

```typescript
// Cache large objects with WeakRef to allow GC when memory pressure
class SignalCache {
  private cache = new Map<string, WeakRef<Float32Array>>();

  get(key: string): Float32Array | undefined {
    const ref = this.cache.get(key);
    return ref?.deref(); // Returns undefined if GC'd
  }

  set(key: string, value: Float32Array): void {
    this.cache.set(key, new WeakRef(value));
  }
}
```

**Explicit Cleanup**:

```typescript
// In React component unmount
useEffect(() => {
  const largeData = fetchLargeData();

  return () => {
    // Explicitly null references to hint GC
    largeData = null;

    // Clear any WeakMap/WeakSet entries
    cache.delete(id);
  };
}, []);
```

**Avoid Memory Leaks**:

```typescript
// ❌ Bad: Event listener not cleaned up
useEffect(() => {
  window.addEventListener('resize', handleResize);
  // Missing cleanup!
}, []);

// ✅ Good: Remove listener on unmount
useEffect(() => {
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);

// ❌ Bad: Timer not cleared
useEffect(() => {
  setInterval(updateChart, 1000);
  // Missing cleanup!
}, []);

// ✅ Good: Clear timer on unmount
useEffect(() => {
  const timer = setInterval(updateChart, 1000);
  return () => clearInterval(timer);
}, []);

// ❌ Bad: Worker not terminated
const worker = new Worker('analysis.worker.ts');
// Missing cleanup!

// ✅ Good: Terminate worker on unmount
useEffect(() => {
  const worker = new Worker('analysis.worker.ts');
  return () => worker.terminate();
}, []);
```

**Memory Profiling**:

```typescript
// Development helper: log heap size
if (import.meta.env.DEV && performance.memory) {
  setInterval(() => {
    const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = performance.memory;
    console.log(
      `Heap: ${(usedJSHeapSize / 1024 / 1024).toFixed(0)} MB / ${(jsHeapSizeLimit / 1024 / 1024).toFixed(0)} MB`,
    );

    if (usedJSHeapSize / jsHeapSizeLimit > 0.9) {
      console.warn('Memory pressure: 90% of heap limit');
    }
  }, 10_000);
}
```

**Expected Impact**:

- Heap allocations: **1 GB → 500 MB** (50% reduction via reuse + GC hints)
- GC pauses: **100ms avg → 30ms avg** (smaller heap, fewer allocations)
- Memory leaks: **0 critical leaks** (enforced via automated heap snapshot analysis)

### 3.4 Cache Strategies

**Multi-Level Caching Architecture**:

```
┌──────────────────────────┐
│  Memory (L1)             │  Fastest (< 1ms), ephemeral
│  - React Query           │
│  - Zustand state         │
│  - LRU cache (20 MB)     │
└──────────────────────────┘
           ↕
┌──────────────────────────┐
│  IndexedDB (L2)          │  Fast (< 50ms), persistent
│  - Analysis results      │
│  - Nightly aggregates    │
│  - Session metadata      │
└──────────────────────────┘
           ↕
┌──────────────────────────┐
│  OPFS (L3)               │  Moderate (< 500ms), persistent
│  - Raw signal data       │
│  - Large blobs           │
└──────────────────────────┘
           ↕
┌──────────────────────────┐
│  HTTP (Fallback)         │  Slow (> 1s), external
│  - Plugin CDN            │
│  - Updates               │
└──────────────────────────┘
```

**L1: In-Memory Caching**:

```typescript
// src/services/cacheService.ts
import { LRUCache } from 'lru-cache';

const signalCache = new LRUCache<string, Float32Array>({
  max: 100, // 100 entries
  maxSize: 100 * 1024 * 1024, // 100 MB
  sizeCalculation: (value) => value.byteLength,
  dispose: (value) => {
    // Hint GC
    value = null;
  },
});

export function getCachedSignal(sessionId: string, channel: string): Float32Array | undefined {
  return signal Cache.get(`${sessionId}:${channel}`);
}

export function setCachedSignal(sessionId: string, channel: string, data: Float32Array): void {
  signalCache.set(`${sessionId}:${channel}`, data);
}
```

**L2: IndexedDB Caching** (see [data-analysis.md](data-analysis.md#132-cache-strategy)):

```typescript
// Cache analysis results
interface CacheEntry {
  key: string; // ${analysisType}:${dateRangeHash}:${parametersHash}
  result: unknown;
  computedAt: string;
  cacheVersion: number;
  expiresAt: string; // TTL
}

async function getCachedAnalysis(key: string): Promise<unknown | null> {
  const entry = await db.analysis_results.get(key);

  if (!entry) return null;

  // Check expiration
  if (new Date(entry.expiresAt) < new Date()) {
    await db.analysis_results.delete(key);
    return null;
  }

  // Check cache version
  const currentVersion = getAnalysisVersion(entry.analysisType);
  if (entry.cacheVersion !== currentVersion) {
    await db.analysis_results.delete(key);
    return null;
  }

  return entry.result;
}
```

**Cache Invalidation**:

```typescript
// On data import, invalidate affected analyses
async function onImportComplete(importedSessions: Session[]): Promise<void> {
  const dateRanges = importedSessions.map((s) => s.date);

  // Find cached analyses overlapping these dates
  const affectedAnalyses = await db.analysis_results.where('dateRange').anyOf(dateRanges).toArray();

  // Delete affected analyses
  await db.analysis_results.bulkDelete(affectedAnalyses.map((a) => a.key));
}
```

**Service Worker Caching** (HTTP layer):

```typescript
// src/service-worker.ts (Workbox)
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';

// Cache static assets (JS, CSS, fonts)
registerRoute(
  ({ request }) => ['script', 'style', 'font'].includes(request.destination),
  new CacheFirst({
    cacheName: 'static-assets',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      }),
    ],
  }),
);

// Network-first for HTML (support updates)
registerRoute(
  ({ request }) => request.destination === 'document',
  new NetworkFirst({
    cacheName: 'html',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 10 }),
    ],
  }),
);

// Stale-while-revalidate for images
registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: 'images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
      }),
    ],
  }),
);
```

**Expected Impact**:

- Analysis cache hit rate: **> 80%**
- Analysis execution time (cache hit): **500ms → 10ms** (50× faster)
- Signal data fetch time (L1 hit): **500ms → < 1ms** (500× faster)
- Static asset load time (Service Worker hit): **< 50ms** (instant)

### 3.5 Asset Optimization

**Strategy**: Minimize asset sizes; optimize delivery

**Image Optimization**:

- **No images in initial bundle** (prefer SVG icons, icon fonts, or inline SVG)
- If images needed: WebP format, responsive sizes via `srcset`
- Lazy-load images outside viewport (`loading="lazy"`)
- No hero images or marketing assets (clinical app)

**Font Optimization**:

- **System fonts only** (no web font downloads)
- `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;`
- Zero font download overhead

**CSS Optimization**:

- **CSS Modules** for automatic scoping and dead code elimination
- Critical CSS inlined in HTML (`<style>` tag)
- Non-critical CSS loaded async (`<link rel="stylesheet" media="print" onload="this.media='all'">`)
- PostCSS with cssnano for minification
- Remove unused CSS via PurgeCSS (if needed)

**JavaScript Optimization**:

- **Terser** minification with dead code elimination
- Tree-shaking via ES modules
- Target modern browsers (`es2020`) for smaller syntax
- Remove console.log in production
- Source maps external (not inline)

**Vite Build Configuration**:

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info'],
      },
      format: {
        comments: false,
      },
    },
    sourcemap: true, // External source maps
    cssMinify: 'lightningcss',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', 'zustand'],
        },
      },
    },
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
    postcss: {
      plugins: [autoprefixer(), cssnano({ preset: 'default' })],
    },
  },
});
```

**Compression**:

- **Brotli** compression for all text assets (JS, CSS, HTML)
- Serve pre-compressed `.br` files from CDN/hosting
- Fallback to gzip for older browsers
- Target: 75–80% size reduction for JS bundles

**Expected Impact**:

- Total assets (gzipped): **700 KB → 500 KB** (29% reduction)
- Initial load (3G): **3.5s → 2.0s** (43% improvement)
- No web font latency (system fonts)

---

## 4. Data Pipeline Performance

### 4.1 Integration with Storage Architecture

**Storage Strategy** (see [storage-architecture.md](storage-architecture.md#1-storage-technology-choices)):

- **IndexedDB**: Metadata, aggregates, analysis results (structured, queryable)
- **OPFS**: Raw signal data (high-throughput, binary)

**Performance Characteristics**:

| Operation                    | IndexedDB | OPFS      | Notes                                  |
| ---------------------------- | --------- | --------- | -------------------------------------- |
| **Write (small, <1 MB)**     | 10–50ms   | 50–150ms  | IndexedDB faster for small writes      |
| **Write (large, >10 MB)**    | 500ms–2s  | 200–500ms | OPFS faster for large writes           |
| **Read (indexed query)**     | 10–50ms   | N/A       | IndexedDB excels at indexed queries    |
| **Read (sequential, large)** | 500ms–2s  | 100–300ms | OPFS faster for large sequential reads |
| **Random access**            | 10–50ms   | 50–150ms  | Both perform well                      |
| **Transaction overhead**     | 10–20ms   | < 5ms     | OPFS has lower overhead                |

**Design Decision**: Store structure in IndexedDB, signals in OPFS (see [ADR 0001](../decisions/0001-client-side-architecture.md)).

### 4.2 Batch Processing Strategies

**Batch Import Workflow**:

```typescript
// src/services/importService.ts
async function importMultipleSessions(files: File[]): Promise<void> {
  const workerPool = new WorkerPool('edf-parser.worker.ts', 4);
  const batchSize = 10;

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);

    // Process batch in parallel
    const results = await Promise.all(
      batch.map((file) => workerPool.execute(() => parseEDF(file))),
    );

    // Batch write to IndexedDB (single transaction)
    await db.transaction('rw', [db.sessions, db.nightly_aggregates], async () => {
      await db.sessions.bulkAdd(results.map((r) => r.session));
      await db.nightly_aggregates.bulkAdd(results.map((r) => r.aggregate));
    });

    // Write signals to OPFS (parallel)
    await Promise.all(results.map((r) => writeSignalToOPFS(r.sessionId, r.signals)));

    // Update progress (every batch)
    progress.current = i + batch.length;
    onProgress(progress);
  }
}
```

**Batch Query Optimization**:

```typescript
// ❌ Bad: N queries in a loop
for (const sessionId of sessionIds) {
  const aggregate = await db.nightly_aggregates.get(sessionId);
  // ... process
}

// ✅ Good: Single bulk query
const aggregates = await db.nightly_aggregates.where('sessionId').anyOf(sessionIds).toArray();
```

### 4.3 Streaming Data Handling

**Streaming EDF Parsing** (avoid full file in memory):

```typescript
async function streamParseEDF(file: File): Promise<AsyncGenerator<DataRecord>> {
  const HEADER_SIZE = 256;
  const reader = file.stream().getReader();

  // Read header
  const headerBuffer = await readBytes(reader, HEADER_SIZE);
  const header = parseHeader(headerBuffer);

  const recordSize = calculateRecordSize(header);

  // Stream data records
  while (true) {
    const recordBuffer = await readBytes(reader, recordSize);
    if (!recordBuffer) break;

    const record = parseDataRecord(recordBuffer, header);
    yield record;
  }
}

// Consumer processes incrementally
async function importSession(file: File): Promise<void> {
  const records = stream ParseEDF(file);
  const signalBuffer = new Float32Array(MAX_SAMPLES);
  let offset = 0;

  for await (const record of records) {
    // Accumulate signals
    signalBuffer.set(record.samples, offset);
    offset += record.samples.length;

    // Flush to OPFS every 10 MB
    if (offset * 4 >= 10 * 1024 * 1024) {
      await writeChunkToOPFS(signalBuffer.subarray(0, offset));
      offset = 0;
    }
  }

  // Flush remaining
  if (offset > 0) {
    await writeChunkToOPFS(signalBuffer.subarray(0, offset));
  }
}
```

**Streaming Analysis**:

```typescript
// Welford's online algorithm for mean/variance (streaming)
class OnlineStats {
  private count = 0;
  private mean = 0;
  private m2 = 0;

  update(value: number): void {
    this.count++;
    const delta = value - this.mean;
    this.mean += delta / this.count;
    const delta2 = value - this.mean;
    this.m2 += delta * delta2;
  }

  getMean(): number {
    return this.mean;
  }

  getVariance(): number {
    return this.count > 1 ? this.m2 / (this.count - 1) : 0;
  }
}

// Process 1M samples without storing all in memory
async function computeStats(sessionId: string): Promise<Stats> {
  const stats = new OnlineStats();
  const stream = streamSignalFromOPFS(sessionId, 'Flow');

  for await (const chunk of stream) {
    for (const sample of chunk) {
      stats.update(sample);
    }
  }

  return {
    mean: stats.getMean(),
    variance: stats.getVariance(),
  };
}
```

### 4.4 Incremental Computation

**Incremental AHI Calculation** (see [data-analysis.md](data-analysis.md#133-incremental-computation)):

```typescript
interface IncrementalAHIState {
  totalEvents: number;
  totalHours: number;
  lastUpdateDate: string;
}

async function updateAHIIncremental(
  state: IncrementalAHIState,
  newSessions: Session[],
): Promise<IncrementalAHIState> {
  // Only process new sessions since lastUpdateDate
  const newEvents = newSessions.reduce((sum, s) => sum + s.eventCount, 0);
  const newHours = newSessions.reduce((sum, s) => sum + s.usageMinutes / 60, 0);

  return {
    totalEvents: state.totalEvents + newEvents,
    totalHours: state.totalHours + newHours,
    lastUpdateDate: newSessions[newSessions.length - 1].date,
  };
}

// AHI derived from state (no recompute)
function getAHI(state: IncrementalAHIState): number {
  return state.totalHours > 0 ? state.totalEvents / state.totalHours : 0;
}
```

**Rolling Window Efficient Update**:

```typescript
class RollingWindow {
  private window: number[] = [];
  private sum = 0;
  private readonly size: number;

  constructor(size: number) {
    this.size = size;
  }

  push(value: number): void {
    this.window.push(value);
    this.sum += value;

    if (this.window.length > this.size) {
      const removed = this.window.shift()!;
      this.sum -= removed;
    }
  }

  getMean(): number {
    return this.window.length > 0 ? this.sum / this.window.length : 0;
  }
}

// Update 30-day rolling average in O(1) per new day
const rolling30Day = new RollingWindow(30);
rolling30Day.push(newDayAHI); // O(1)
const avgAHI = rolling30Day.getMean(); // O(1)
```

### 4.5 Background Processing

**Service Worker Background Sync**:

```typescript
// Register background sync on import
navigator.serviceWorker.ready.then((registration) => {
  registration.sync.register('process-import');
});

// Service Worker listens for sync event
self.addEventListener('sync', (event) => {
  if (event.tag === 'process-import') {
    event.waitUntil(processQueuedImports());
  }
});

async function processQueuedImports(): Promise<void> {
  // Retrieve queued import tasks from IndexedDB
  const tasks = await getQueuedTasks();

  for (const task of tasks) {
    await processImport(task);
    await markTaskComplete(task.id);
  }
}
```

**Periodic Background Analysis**:

```typescript
// Update caches periodically (e.g., nightly)
navigator.serviceWorker.ready.then((registration) => {
  registration.periodicSync.register('refresh-analysis', {
    minInterval: 24 * 60 * 60 * 1000, // 24 hours
  });
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'refresh-analysis') {
    event.waitUntil(refreshAnalysisCaches());
  }
});
```

**Web Worker Idle Processing**:

```typescript
// In main thread: request idle processing
requestIdleCallback(
  () => {
    // Trigger background cache warming
    workerPool.execute(() => warmCaches());
  },
  { timeout: 5000 },
);

// Worker warms caches when idle
async function warmCaches(): Promise<void> {
  // Pre-compute common analyses
  const commonAnalyses = ['ahi-trend-30day', 'compliance-rate'];

  for (const analysisType of commonAnalyses) {
    await computeAndCacheAnalysis(analysisType);
  }
}
```

**Expected Impact**:

- User-perceived import time: **30s → 5s** (background continuation)
- Cache warmth on app open: **Cold → Warm** (80% hit rate on first use)

---

## 5. Profiling & Measurement

### 5.1 Tools & Methodologies

**Development Tools**:

| Tool                            | Purpose                             | Frequency                       |
| ------------------------------- | ----------------------------------- | ------------------------------- |
| **Chrome DevTools Performance** | Profile CPU, memory, rendering      | Every performance investigation |
| **Chrome DevTools Memory**      | Heap snapshots, allocation timeline | Weekly during development       |
| **Lighthouse**                  | Core Web Vitals, best practices     | Every PR via CI                 |
| **React DevTools Profiler**     | Component render time, re-renders   | During component optimization   |
| **Webpack Bundle Analyzer**     | Bundle size visualization           | Monthly review                  |
| **Performance Observer API**    | Custom metrics in production        | Always (telemetry)              |

**Custom Benchmarking Suite**:

```typescript
// src/benchmarks/analyze.bench.ts
import { bench, describe } from 'vitest';

describe('Analysis Performance', () => {
  const testData = generateTestDataset(365); // 1 year

  bench(
    'AHI trend calculation',
    () => {
      computeAHITrend(testData);
    },
    { time: 1000, iterations: 100 },
  );

  bench(
    'Correlation analysis',
    () => {
      computeCorrelation(testData, 'AHI', 'LeakRate');
    },
    { time: 1000, iterations: 100 },
  );

  bench(
    'LTTB downsampling (720k → 2k)',
    () => {
      lttb(largeSignalData, 2000);
    },
    { time: 5000, iterations: 50 },
  );
});
```

**Automated Performance Tests (Playwright)**:

```typescript
// tests/performance/import.spec.ts
import { test, expect } from '@playwright/test';

test('import 10 nights within 30s', async ({ page }) => {
  await page.goto('/');

  const startTime = Date.now();

  // Trigger import
  await page.click('[data-testid="import-button"]');
  await page.setInputFiles('[data-testid="file-input"]', testFiles);

  // Wait for completion
  await page.waitForSelector('[data-testid="import-complete"]', { timeout: 30_000 });

  const elapsed = Date.now() - startTime;
  expect(elapsed).toBeLessThan(30_000);

  // Log for tracking
  console.log(`Import time: ${elapsed}ms`);
});
```

### 5.2 Continuous Performance Monitoring

**Lighthouse CI Configuration**:

```yaml
# .lighthouserc.json
{
  'ci':
    {
      'collect':
        {
          'numberOfRuns': 3,
          'settings':
            {
              'preset': 'desktop',
              'throttling': { 'rttMs': 150, 'throughputKbps': 1638, 'cpuSlowdownMultiplier': 4 },
            },
        },
      'assert':
        {
          'assertions':
            {
              'categories:performance': ['error', { 'minScore': 0.9 }],
              'first-contentful-paint': ['error', { 'maxNumericValue': 1800 }],
              'largest-contentful-paint': ['error', { 'maxNumericValue': 2500 }],
              'interactive': ['error', { 'maxNumericValue': 3500 }],
              'cumulative-layout-shift': ['error', { 'maxNumericValue': 0.1 }],
            },
        },
      'upload': { 'target': 'temporary-public-storage' },
    },
}
```

**GitHub Actions Workflow**:

```yaml
# .github/workflows/performance.yml
name: Performance Tests

on:
  pull_request:
    branches: [main]

jobs:
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
          cache: 'npm'

      - run: npm ci
      - run: npm run build

      - name: Run Lighthouse CI
        uses: treosh/lighthouse-ci-action@v9
        with:
          configPath: './.lighthouserc.json'
          uploadArtifacts: true

      - name: Comment PR
        uses: actions/github-script@v6
        with:
          script: |
            // Post Lighthouse results to PR comment
```

**Performance Telemetry (Production)**:

```typescript
// src/telemetry/performance.ts
import { PerformanceObserver } from 'perf_hooks';

// Observe Core Web Vitals
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.entryType === 'largest-contentful-paint') {
      logMetric('LCP', entry.startTime);
    }
    if (entry.entryType === 'first-input') {
      logMetric('FID', entry.processingStart - entry.startTime);
    }
    if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) {
      logMetric('CLS', entry.value);
    }
  }
});

observer.observe({ entryTypes: ['largest-contentful-paint', 'first-input', 'layout-shift'] });

// Custom metrics
export function measureAnalysis(type: string, fn: () => Promise<unknown>): Promise<unknown> {
  const start = performance.now();

  return fn().finally(() => {
    const duration = performance.now() - start;
    logMetric(`analysis.${type}`, duration);
  });
}

// Aggregate and report (batched)
function logMetric(name: string, value: number): void {
  // Store in-memory buffer
  metricBuffer.push({ name, value, timestamp: Date.now() });

  // Flush every 1 minute (non-blocking)
  if (metricBuffer.length >= FLUSH_THRESHOLD) {
    flushMetrics();
  }
}

async function flushMetrics(): Promise<void> {
  // No external service (privacy-first)
  // Store aggregates in IndexedDB for user inspection
  await db.telemetry.bulkAdd(metricBuffer);
  metricBuffer = [];
}
```

### 5.3 Regression Detection

**Baseline Establishment**:

```typescript
// scripts/benchmark-baseline.ts
import { execSync } from 'child_process';
import fs from 'fs';

// Run benchmarks and save baseline
execSync('npm run bench -- --reporter=json > baseline.json');

const baseline = JSON.parse(fs.readFileSync('baseline.json', 'utf-8'));

// Store in repo
fs.writeFileSync('.performance/baseline.json', JSON.stringify(baseline, null, 2));
```

**Regression Check (CI)**:

```typescript
// scripts/check-regression.ts
import fs from 'fs';

const baseline = JSON.parse(fs.readFileSync('.performance/baseline.json', 'utf-8'));
const current = JSON.parse(fs.readFileSync('benchmark-results.json', 'utf-8'));

const REGRESSION_THRESHOLD = 1.2; // 20% slower = regression

for (const bench of current.benchmarks) {
  const baselineBench = baseline.benchmarks.find((b) => b.name === bench.name);
  if (!baselineBench) continue;

  const ratio = bench.mean / baselineBench.mean;

  if (ratio > REGRESSION_THRESHOLD) {
    console.error(`❌ Performance regression detected: ${bench.name}`);
    console.error(`   Baseline: ${baselineBench.mean.toFixed(2)}ms`);
    console.error(`   Current:  ${bench.mean.toFixed(2)}ms`);
    console.error(`   Ratio:    ${ratio.toFixed(2)}x slower`);
    process.exit(1);
  }
}

console.log('✅ No performance regressions detected');
```

**Bundle Size Regression**:

```json
// package.json
{
  "scripts": {
    "build:check-size": "vite build && node scripts/check-bundle-size.js"
  }
}
```

```typescript
// scripts/check-bundle-size.js
import fs from 'fs';
import { gzipSync } from 'zlib';

const BUNDLE_SIZE_LIMIT = 150 * 1024; // 150 KB gzipped

const mainBundle = fs.readFileSync('dist/assets/index-*.js');
const gzipped = gzipSync(mainBundle);

if (gzipped.length > BUNDLE_SIZE_LIMIT) {
  console.error(
    `❌ Bundle size exceeds limit: ${(gzipped.length / 1024).toFixed(0)} KB > ${(BUNDLE_SIZE_LIMIT / 1024).toFixed(0)} KB`,
  );
  process.exit(1);
}

console.log(`✅ Bundle size OK: ${(gzipped.length / 1024).toFixed(0)} KB`);
```

---

## 6. Mobile & Low-End Device Support

### 6.1 Device Capability Detection

**Feature Detection**:

```typescript
// src/utils/deviceCapabilities.ts
export interface DeviceCapabilities {
  tier: 'high' | 'medium' | 'low';
  supportsWorkers: boolean;
  supportsOPFS: boolean;
  supportsWebGL: boolean;
  cores: number;
  memory: number; // GB (estimate)
}

export function detectCapabilities(): DeviceCapabilities {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory || 4; // GB

  // Tiering heuristic
  let tier: DeviceCapabilities['tier'] = 'medium';

  if (cores >= 8 && memory >= 8) {
    tier = 'high';
  } else if (cores <= 2 || memory <= 2) {
    tier = 'low';
  }

  return {
    tier,
    supportsWorkers: typeof Worker !== 'undefined',
    supportsOPFS: 'showOpenFilePicker' in window,
    supportsWebGL: detectWebGL(),
    cores,
    memory,
  };
}

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}
```

**Adaptive Configuration**:

```typescript
// src/config/adaptiveConfig.ts
import { detectCapabilities } from '../utils/deviceCapabilities';

const capabilities = detectCapabilities();

export const config = {
  maxWorkers: capabilities.tier === 'high' ? 8 : capabilities.tier === 'medium' ? 4 : 2,

  chartRenderer: capabilities.tier === 'low' ? 'svg' : 'canvas',

  chunkSize: capabilities.tier === 'high' ? 10 * 1024 * 1024 : 5 * 1024 * 1024,

  downsamplePoints:
    capabilities.tier === 'high' ? 5000 : capabilities.tier === 'medium' ? 2000 : 1000,

  enableAnimations: capabilities.tier !== 'low',

  cacheSize:
    capabilities.tier === 'high'
      ? 200 * 1024 * 1024
      : capabilities.tier === 'medium'
        ? 100 * 1024 * 1024
        : 50 * 1024 * 1024,
};
```

### 6.2 Progressive Enhancement Strategies

**Core Functionality** (works everywhere):

- View session metadata and nightly aggregates
- Simple aggregate statistics (AHI, compliance)
- Export session data to CSV
- Basic navigation and settings

**Enhanced Functionality** (medium-tier devices):

- Time-series charting with downsampling
- Trend analysis (1 year)
- Web Worker parallelism
- Service Worker caching

**Advanced Functionality** (high-tier devices):

- High-resolution signal visualization
- Complex multi-variate analysis (clustering, correlation)
- Real-time chart interactions (60 FPS zoom/pan)
- Concurrent import (8× parallel)

**Implementation**:

```typescript
// Conditional feature loading
if (capabilities.tier === 'high') {
  const AdvancedAnalysis = lazy(() => import('./AdvancedAnalysis'));
  // ... use component
} else {
  // Fallback to simplified analysis
  const BasicAnalysis = lazy(() => import('./BasicAnalysis'));
}
```

### 6.3 Graceful Degradation

**Fallback Strategies**:

| Feature                | Primary         | Fallback (Low-End)           |
| ---------------------- | --------------- | ---------------------------- |
| **Chart rendering**    | Canvas          | SVG                          |
| **Downsampling**       | LTTB (accurate) | Simple decimation (fast)     |
| **Import parallelism** | 8 Workers       | 2 Workers or sequential      |
| **Analysis**           | Web Worker      | Main thread (with yield)     |
| **Animations**         | 60 FPS          | Instant transitions          |
| **Storage**            | OPFS            | IndexedDB (signals as blobs) |

**Responsive Downsampling**:

```typescript
function getDownsampleTarget(deviceTier: string, dataSize: number): number {
  if (dataSize < 1000) return dataSize; // No downsampling needed

  if (deviceTier === 'high') {
    return Math.min(dataSize, 5000);
  } else if (deviceTier === 'medium') {
    return Math.min(dataSize, 2000);
  } else {
    return Math.min(dataSize, 1000);
  }
}
```

**Memory-Constrained Import**:

```typescript
async function importWithMemoryLimit(files: File[]): Promise<void> {
  const memoryLimit = capabilities.memory * 1024 * 1024 * 1024 * 0.5; // 50% of device memory

  let processedSize = 0;

  for (const file of files) {
    // Check memory before processing
    if (performance.memory && performance.memory.usedJSHeapSize > memoryLimit) {
      // Wait for GC
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Force cache eviction
      clearCache();
    }

    await processFile(file);
    processedSize += file.size;
  }
}
```

---

## 7. Future Scalability

### 7.1 Handling Even Larger Datasets

**Current Capacity**: 10 years of data (~22 GB) handled comfortably.

**Future Scenarios**:

| Scenario               | Data Size        | Challenge                           | Mitigation                                          |
| ---------------------- | ---------------- | ----------------------------------- | --------------------------------------------------- |
| **20+ years**          | 44+ GB           | Exceeds typical browser quota       | Selective archive/delete old data                   |
| **Multiple machines**  | 2×–5× multiplier | Index complexity, query performance | Partition by machineId, optimize indices            |
| **High-freq oximetry** | 3× signal data   | Storage and rendering overhead      | Optional signal storage, on-demand load             |
| **Video integration**  | TB-scale         | Exceeds client-side capacity        | External S3-compatible storage link (metadata only) |

**Scalability Strategies**:

1. **Data Archiving**:
   - User-initiated archive of old data (> 5 years)
   - Export to external file (ZIP of EDFs + metadata JSON)
   - Import on-demand ("restore from archive")

2. **Partitioning**:
   - Separate IndexedDB databases per machine (`cpap-analyzer-{machineId}`)
   - Reduces index size, improves query performance
   - Cross-machine queries aggregate across databases

3. **Lazy Signal Loading**:
   - Signal data loaded only when chart is viewed
   - Unload signal data when chart unmounted
   - Keep only most recent N sessions in memory

4. **Differential Storage**:
   - Store only signal deltas (run-length encoding for stable signals like Leak)
   - Reduces storage by 30–50% for low-frequency channels

5. **Cloud Backup (Optional)**:
   - User-controlled export to Dropbox/Google Drive/iCloud
   - App never transmits data (user initiates via file save dialog)
   - Re-import from cloud storage on new device

### 7.2 Performance Implications of Plugin System

**Plugin Architecture** (see [plugin-architecture](/.claude/skills/plugin-architecture/SKILL.md)):

**Performance Risks**:

1. **Unbounded plugin execution time**:
   - Poorly optimized plugin could block UI for seconds
   - **Mitigation**: Enforce Worker execution for all plugins > 100ms. Timeout after 30s.

2. **Memory leaks in plugins**:
   - Plugin holds large objects, doesn't release
   - **Mitigation**: Isolate plugins in dedicated Workers. Terminate Worker after execution.

3. **Bundle size explosion**:
   - If all plugins bundled, initial load suffers
   - **Mitigation**: Plugins loaded on-demand via dynamic import. Cache loaded plugins.

4. **Plugin data access overhead**:
   - Plugin fetches raw signals repeatedly
   - **Mitigation**: `DataProvider` abstraction with caching. Plugin receives pre-fetched data.

**Performance Safeguards**:

```typescript
// src/plugins/runtime.ts
export async function executePlugin(
  plugin: AnalysisPlugin,
  input: AnalysisInput,
): Promise<AnalysisOutput> {
  // Enforce Worker execution for heavy plugins
  if (plugin.executionMode === 'worker' || estimateExecutionTime(plugin, input) > 100) {
    return executeInWorker(plugin, input);
  }

  // Timeout protection
  const timeout = 30_000; // 30s max
  const result = await Promise.race([
    plugin.execute(input, dataProvider),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Plugin timeout')), timeout)),
  ]);

  return result as AnalysisOutput;
}

// Memory monitoring
async function executeInWorker(
  plugin: AnalysisPlugin,
  input: AnalysisInput,
): Promise<AnalysisOutput> {
  const workerInstance = new Worker(plugin.workerUrl, { type: 'module' });
  const worker = wrap<PluginWorkerAPI>(workerInstance);

  // Monitor memory usage
  const memoryCheck = setInterval(() => {
    if (performance.memory && performance.memory.usedJSHeapSize > MEMORY_LIMIT) {
      workerInstance.terminate();
      throw new Error('Plugin exceeded memory limit');
    }
  }, 1000);

  try {
    const result = await worker.execute(input);
    clearInterval(memoryCheck);
    workerInstance.terminate();
    return result;
  } catch (error) {
    clearInterval(memoryCheck);
    workerInstance.terminate();
    throw error;
  }
}
```

**Plugin Performance Budget**:

| Plugin Type          | Max Execution Time | Max Memory | Max Bundle Size |
| -------------------- | ------------------ | ---------- | --------------- |
| **Visualization**    | 1s                 | 50 MB      | 100 KB          |
| **Analysis (light)** | 5s                 | 100 MB     | 200 KB          |
| **Analysis (heavy)** | 30s                | 500 MB     | 500 KB          |
| **Integration**      | 10s                | 50 MB      | 100 KB          |

**Enforcement**: Plugins that exceed budget logged as warnings. Repeat violations → disable plugin.

### 7.3 Anticipated Bottlenecks & Mitigation Plans

| Bottleneck                               | Trigger                                 | Impact                          | Mitigation Plan                                                             |
| ---------------------------------------- | --------------------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| **IndexedDB transaction contention**     | Concurrent writes from multiple Workers | Serialized writes, slow imports | **Batch writes**: accumulate, single transaction                            |
| **OPFS quota exhaustion**                | 20+ years of data                       | Import fails                    | **Quota management**: user-facing quota meter, archive old data             |
| **Memory exhaustion on low-end devices** | Importing 100+ nights                   | Import crashes                  | **Chunked processing**: process in smaller batches, force GC between        |
| **Chart rendering lag (high zoom)**      | Zooming into 10M-point signal           | UI freezes                      | **Adaptive LOD**: increase resolution only to visible limit (5k points max) |
| **Analysis cache bloat**                 | Years of cached results                 | IndexedDB slow                  | **LRU eviction**: cap cache at 500 MB, evict oldest                         |
| **Service Worker cache staleness**       | User doesn't reload for weeks           | Outdated app code               | **Version check**: prompt user to reload on new version                     |
| **WebAssembly overhead**                 | Future WASM plugins                     | Startup cost                    | **Lazy WASM init**: load on first plugin execution, reuse instance          |

**Monitoring & Alerting**:

- **Development**: Performance tests fail if bottleneck thresholds exceeded
- **Production**: Telemetry logs bottleneck occurrences (no external transmission, stored locally)
- **User-facing**: Warnings displayed when approaching quota, cache, or memory limits

---

## 8. Performance Testing Strategy

### 8.1 Unit-Level Performance Tests

**Benchmark Suite** (Vitest bench):

```typescript
// src/benchmarks/signal-processing.bench.ts
import { bench, describe } from 'vitest';
import { lttb, minMax, downsampleDecimate } from '../utils/downsampling';

describe('Downsampling Algorithms', () => {
  const signal = new Float32Array(720_000); // 25 Hz, 8 hours
  for (let i = 0; i < signal.length; i++) {
    signal[i] = Math.sin(i / 1000) + Math.random() * 0.1;
  }

  bench(
    'LTTB (720k → 2k)',
    () => {
      lttb(signal, 2000);
    },
    { time: 5000 },
  );

  bench(
    'MinMax (720k → 2k)',
    () => {
      minMax(signal, 2000);
    },
    { time: 5000 },
  );

  bench(
    'Decimation (720k → 2k)',
    () => {
      downsampleDecimate(signal, 360); // every 360th sample
    },
    { time: 5000 },
  );
});
```

**Run Regularly**:

- Local: `npm run bench`
- CI: On every PR to main branch

### 8.2 Integration Performance Tests

**Playwright Performance Tests**:

```typescript
// tests/performance/dashboard-load.spec.ts
import { test, expect } from '@playwright/test';

test('dashboard loads under 1s', async ({ page }) => {
  // Start performance measurement
  await page.goto('/', { waitUntil: 'networkidle' });

  // Measure LCP
  const lcp = await page.evaluate(() => {
    return new Promise((resolve) => {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        resolve(lastEntry.startTime);
      }).observe({ entryTypes: ['largest-contentful-paint'] });
    });
  });

  expect(lcp).toBeLessThan(1500);
});

test('session detail navigates under 500ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="session-card"]');

  const start = Date.now();
  await page.click('[data-testid="session-card"]:first-child');
  await page.waitForSelector('[data-testid="session-detail"]');
  const elapsed = Date.now() - start;

  expect(elapsed).toBeLessThan(500);
});
```

### 8.3 Load Testing

**Simulated Large Dataset**:

```typescript
// tests/fixtures/generateLargeDataset.ts
export async function generateLargeDataset(years: number): Promise<void> {
  const db = await openDB('cpap-analyzer');

  const sessions: Session[] = [];
  const aggregates: NightlyAggregate[] = [];

  for (let day = 0; day < years * 365; day++) {
    const date = new Date();
    date.setDate(date.getDate() - day);

    const session = generateRandomSession(date);
    sessions.push(session);

    const aggregate = generateRandomAggregate(session);
    aggregates.push(aggregate);

    // Batch writes every 1000 sessions
    if (sessions.length >= 1000) {
      await db.sessions.bulkAdd(sessions);
      await db.nightly_aggregates.bulkAdd(aggregates);
      sessions.length = 0;
      aggregates.length = 0;
    }
  }

  // Flush remaining
  if (sessions.length > 0) {
    await db.sessions.bulkAdd(sessions);
    await db.nightly_aggregates.bulkAdd(aggregates);
  }
}
```

**Load Test Scenarios**:

```typescript
// tests/load/10-year-dataset.spec.ts
test.beforeAll(async () => {
  await generateLargeDataset(10); // 3650 sessions
});

test('query 1-year aggregates from 10-year dataset', async ({ page }) => {
  await page.goto('/trends?range=1y');

  // Measure query time
  const queryTime = await page.evaluate(async () => {
    const start = performance.now();
    await db.nightly_aggregates.where('date').between(oneYearAgo, today).toArray();
    return performance.now() - start;
  });

  expect(queryTime).toBeLessThan(150);
});
```

### 8.4 CI/CD Performance Gates

**GitHub Actions Workflow**:

```yaml
name: Performance CI

on:
  pull_request:
    branches: [main]

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run bench
      - name: Check for regressions
        run: node scripts/check-regression.js

  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build
      - uses: treosh/lighthouse-ci-action@v9
        with:
          configPath: './.lighthouserc.json'

  bundle-size:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build
      - name: Check bundle size
        run: node scripts/check-bundle-size.js

  load-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx playwright install
      - run: npm run test:perf # Playwright performance tests
```

---

## 9. Summary & Action Items

### 9.1 Performance Priorities

**P0 (Must optimize before v1.0)**:

- ✅ Initial load (LCP < 1.5s)
- ✅ Dashboard render (< 300ms)
- ✅ Worker-based EDF parsing
- ✅ Canvas rendering for time-series
- ✅ Code splitting by route
- ✅ Service Worker caching

**P1 (Optimize before v1.1)**:

- 🔄 Analysis result caching with incremental computation
- 🔄 Adaptive configuration based on device tier
- 🔄 LTTB downsampling in Workers
- 🔄 Memory profiling and optimization
- 🔄 Plugin performance safeguards

**P2 (Future optimization)**:

- ⏳ Data archiving for 20+ year datasets
- ⏳ WebAssembly for signal processing
- ⏳ WebGL rendering for ultra-high-frequency signals

### 9.2 Key Metrics Dashboard

**Monitor continuously**:

| Metric             | Target           | Current | Status     |
| ------------------ | ---------------- | ------- | ---------- |
| LCP                | < 1.5s           | TBD     | 🟡 Pending |
| FID/INP            | < 50ms / < 100ms | TBD     | 🟡 Pending |
| CLS                | < 0.05           | TBD     | 🟡 Pending |
| Bundle (gzipped)   | < 150 KB         | TBD     | 🟡 Pending |
| Import (10 nights) | < 30s            | TBD     | 🟡 Pending |
| Analysis (1 year)  | < 500ms          | TBD     | 🟡 Pending |
| Chart render       | < 200ms          | TBD     | 🟡 Pending |

**Update quarterly**: Review metrics, adjust targets, identify optimizations.

### 9.3 Continuous Improvement Process

1. **Baseline Establishment** (Sprint 1):
   - Implement all P0 optimizations
   - Run full benchmark suite
   - Record baseline metrics
   - Commit baseline to `.performance/baseline.json`

2. **CI Integration** (Sprint 2):
   - Add Lighthouse CI to PR workflow
   - Add benchmark regression checks
   - Add bundle size limits

3. **Monitoring** (Sprint 3):
   - Implement telemetry hooks
   - Create performance dashboard (in-app)
   - Set up alerting for regressions

4. **Regular Review** (Monthly):
   - Review telemetry data
   - Identify slow operations
   - Prioritize optimizations
   - Update baselines

5. **Performance Budgets** (Quarterly):
   - Re-evaluate bundle size budgets
   - Adjust targets based on user feedback
   - Plan optimization sprints

---

## Cross-References

- **Frontend Architecture**: [docs/design/frontend-architecture.md](frontend-architecture.md)
- **Storage Architecture**: [docs/design/storage-architecture.md](storage-architecture.md)
- **Data Analysis**: [docs/design/data-analysis.md](data-analysis.md)
- **Data Visualization**: [docs/design/data-visualization.md](data-visualization.md)
- **ResMed Machine Support**: [docs/design/resmed-machine-support.md](resmed-machine-support.md)
- **Plugin Architecture**: [.claude/skills/plugin-architecture/SKILL.md](/.claude/skills/plugin-architecture/SKILL.md)
- **Architecture Decision Record**: [docs/decisions/0001-client-side-architecture.md](../decisions/0001-client-side-architecture.md)

---

**End of Document**
