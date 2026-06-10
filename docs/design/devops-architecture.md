# DevOps Architecture — CPAP Analyzer

**Version**: 1.0  
**Last Updated**: February 10, 2026  
**Status**: Architecture Decision Record  
**Audience**: DevOps, Frontend, QA, Security, all Implementation Agents

## Executive Summary

This document defines the complete DevOps architecture for CPAP Analyzer, establishing CI/CD pipelines, quality gates, deployment strategies, and development tooling. The architecture prioritizes **fast feedback loops**, **deterministic builds**, **zero-friction development**, and **security-first practices** while supporting an entirely AI-driven development team.

### Key Architectural Decisions

- **CI/CD Platform**: GitHub Actions with parallel job execution
- **Build Tool**: Vite for fast, optimized production builds
- **Quality Gates**: Four-stage pre-commit validation (format → lint → type-check → test)
- **Testing Strategy**: Parallel execution of unit tests (Vitest) and E2E tests (Playwright) in CI
- **Deployment**: GitHub Pages with atomic deployments, preview builds for PRs
- **Versioning**: Calendar Versioning (CalVer) with automated changelog management
- **Security**: npm audit in CI, Dependabot for dependency updates, no external telemetry
- **Monitoring**: Build status notifications, bundle size tracking, no runtime telemetry

### Core Principles

1. **Pre-commit Guarantee**: If pre-commit passes locally, CI must be green. Any violation is a critical bug.
2. **Parallel by Default**: Independent checks run in parallel to minimize feedback time.
3. **Fail Fast**: Security audit and lint errors block immediately; no expensive operations run on broken code.
4. **Deterministic Builds**: Same commit hash = identical build output, every time.
5. **Zero Telemetry**: No build analytics, no error tracking services, no usage metrics (aligns with privacy architecture).

---

## 1. CI/CD Platform

### 1.1 GitHub Actions

**Rationale**:

- **Native Integration**: First-class GitHub repository integration (no external service authentication)
- **Zero Configuration**: Included with GitHub repositories, no billing setup required
- **Adequate Performance**: Sufficient for our build times (~2–5 minutes total)
- **Artifact Support**: Native support for test reports, build artifacts, and Pages deployment
- **Concurrency Control**: Built-in concurrency groups for atomic deployments

**Runner Specifications**:

- **OS**: `ubuntu-latest` (currently Ubuntu 22.04)
- **CPU**: 2-core
- **RAM**: 7 GB
- **Storage**: 14 GB SSD
- **Node.js**: Version 22 (LTS) via `actions/setup-node@v4`
- **Cache**: npm cache enabled for fast `npm ci` execution

**Alternative Considerations**:

- **GitLab CI**: Would require migrating from GitHub. Rejected for unnecessary complexity.
- **CircleCI / Travis CI**: External services with additional authentication overhead. No compelling benefit over GitHub Actions.
- **Self-hosted runners**: Overkill for this project's scale. GitHub-hosted runners are sufficient and simpler.

**Decision**: GitHub Actions is the optimal choice for this GitHub-hosted, client-side application.

---

## 2. Build Pipeline

### 2.1 Build Tool: Vite

**Configuration**: `vite.config.ts` (to be created)

**Build Features**:

- **ES Module Output**: Modern ESM bundles for fast parsing in browsers
- **Code Splitting**: Automatic route-based splitting with React Router integration
- **Tree Shaking**: Eliminate unused code from production bundles
- **Asset Optimization**:
  - Image compression (inline < 4KB, external otherwise)
  - CSS extraction and minification
  - Font subsetting for optimal loading
- **Source Maps**: Separate `.map` files for production debugging (not uploaded to deployment)

**Bundle Size Targets** (from [performance-strategy.md](performance-strategy.md)):

| Bundle                            | Target (gzipped) | Threshold (gzipped) |
| --------------------------------- | ---------------- | ------------------- |
| Initial (main)                    | < 150 KB         | < 250 KB            |
| Total JS (all chunks)             | < 500 KB         | < 1 MB              |
| Total assets (CSS, fonts, images) | < 100 KB         | < 200 KB            |

### 2.2 Build Workflow

**Job**: `build` (runs after all quality checks pass)

```yaml
build:
  name: Build
  runs-on: ubuntu-latest
  needs: [audit, lint, test-unit, test-e2e]
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm
    - run: npm ci
    - run: npm run build
    - name: Analyze Bundle Size
      run: npx vite-bundle-visualizer --mode production
    - name: Upload Build Artifacts
      uses: actions/upload-pages-artifact@v3
      with:
        path: dist/
    - name: Upload Bundle Report
      uses: actions/upload-artifact@v4
      with:
        name: bundle-report
        path: stats.html
        retention-days: 30
```

**Build Steps**:

1. **Clean**: Remove previous `dist/` directory
2. **Compile**: TypeScript → JavaScript (via Vite's esbuild integration)
3. **Bundle**: Rollup with optimized chunking strategy
4. **Minify**: Terser for JavaScript, cssnano for CSS
5. **Hash**: Content-based hashing for cache busting (`app.[hash].js`)
6. **Generate Manifest**: `manifest.json` for PWA support
7. **Copy Static Assets**: `public/` → `dist/`

### 2.3 Asset Optimization

**JavaScript**:

- Minification: Terser with `compress` and `mangle` enabled
- Target: ES2020 (95%+ browser support, modern syntax for smaller output)
- Polyfills: None (target modern browsers only per [deployment-architecture.md](deployment-architecture.md))

**CSS**:

- Minification: cssnano with default preset
- Autoprefixer: Target last 2 versions of major browsers
- CSS Modules: Scoped class names with shortened hashes in production

**Images**:

- SVGs: Inlined and optimized with SVGO
- PNGs/JPGs: Optimized with sharp (if any exist)
- Inline threshold: 4 KB (base64 data URIs for tiny assets)

**Fonts**:

- Subset to Latin character ranges
- Preload critical font files with `<link rel="preload">`
- Self-hosted (no CDN dependencies per privacy architecture)

### 2.4 Bundle Size Monitoring & Enforcement

**Status**: REQUIRED — Addresses QA GAP-8 (IMPORTANT)

This section defines the complete bundle size monitoring, enforcement, and optimization strategy to ensure CPAP Analyzer maintains optimal performance characteristics. Bundle size directly impacts Largest Contentful Paint (LCP) and Time to Interactive (TTI), which are critical performance metrics per [performance-strategy.md](performance-strategy.md).

#### 2.4.1 Tool Selection

**Primary Tool**: **`size-limit`**

**Rationale**:

- **Performance Budget Integration**: size-limit calculates actual download, parse, and execution time on defined network conditions (3G by default), not just file size
- **Granular Control**: Per-entry point limits for main bundle, route chunks, worker bundles, and vendor code
- **CI-First Design**: Purpose-built for automated enforcement in CI pipelines
- **PR Comments**: Native GitHub Action integration with automatic PR feedback
- **Fast Execution**: ~5-10 seconds for size checks (does not require full build)
- **Why Not bundlesize**: Deprecated and no longer maintained
- **Why Not bundle-analyzer Alone**: Visualization tool only, no enforcement

**Secondary Tool**: **`rollup-plugin-visualizer`** (Vite-compatible fork of webpack-bundle-analyzer)

**Purpose**:

- Visual bundle composition analysis
- Identify largest dependencies for optimization
- Compare bundle changes across commits
- Developer-facing debugging tool

**Installation**:

```bash
npm install --save-dev @size-limit/preset-app @size-limit/file rollup-plugin-visualizer
```

#### 2.4.2 Bundle Size Targets

Bundle size targets are derived from performance budgets in [performance-strategy.md](performance-strategy.md) and calibrated for **Slow 3G network conditions** (400 Kbps, 400ms RTT) to ensure accessibility for users with limited connectivity.

| Bundle                            | Target (gzipped) | Threshold (Fail CI) | Rationale                                           |
| --------------------------------- | ---------------- | ------------------- | --------------------------------------------------- |
| **Initial (main entry)**          | ≤150 KB          | ≤200 KB             | LCP budget: 2.5s @ 400 Kbps = 125 KB max transfer   |
| **Route bundle (per route)**      | ≤75 KB           | ≤100 KB             | Route transitions < 1s; parallel download with main |
| **Worker bundle (ResMed parser)** | ≤50 KB           | ≤75 KB              | Background thread; non-blocking but monitored       |
| **Vendor chunks (React + deps)**  | ≤120 KB          | ≤150 KB             | Shared chunk cached across routes                   |
| **Total application**             | ≤500 KB          | ≤1 MB               | Full app download budget (all routes + vendor)      |
| **CSS (total)**                   | ≤30 KB           | ≤50 KB              | Render-blocking; must be minimal                    |
| **Fonts**                         | ≤40 KB           | ≤60 KB              | Subsetted Latin only; preloaded                     |

**Network Assumptions**:

- **Baseline**: Slow 3G (400 Kbps downlink, 400ms RTT) per [WebPageTest mobile profile](https://www.webpagetest.org/)
- **Parse/Execute Budget**: ~50ms per 100 KB of JavaScript on low-end mobile (adds to LCP)
- **Target LCP**: ≤2.5s (includes network transfer, parse, execute, first render)

**Calculation Example** (Initial Bundle):

```text
Target transfer time: 2.5s - 400ms (RTT) - 200ms (parse) - 300ms (render) = 1600ms
Bytes transferable: 1600ms × (400 Kbps / 8) / 1000 = ~80 KB raw
With gzip compression (typical 3x): ~240 KB source → ~80 KB gzipped
Safe target with margin: 150 KB gzipped → ~50 KB transferred
```

#### 2.4.3 size-limit Configuration

**File**: `.size-limit.json`

```json
[
  {
    "name": "Main entry (initial load)",
    "path": "dist/assets/index-*.js",
    "limit": "200 KB",
    "gzip": true,
    "running": false,
    "webpack": false
  },
  {
    "name": "Dashboard route",
    "path": "dist/assets/Dashboard-*.js",
    "limit": "100 KB",
    "gzip": true,
    "running": false
  },
  {
    "name": "Analysis route",
    "path": "dist/assets/Analysis-*.js",
    "limit": "100 KB",
    "gzip": true,
    "running": false
  },
  {
    "name": "Settings route",
    "path": "dist/assets/Settings-*.js",
    "limit": "50 KB",
    "gzip": true,
    "running": false
  },
  {
    "name": "Vendor chunks (React + Radix UI)",
    "path": "dist/assets/vendor-*.js",
    "limit": "150 KB",
    "gzip": true,
    "running": false
  },
  {
    "name": "ResMed parser worker",
    "path": "dist/workers/resmed-parser-*.js",
    "limit": "75 KB",
    "gzip": true,
    "running": false
  },
  {
    "name": "Total CSS",
    "path": "dist/assets/*.css",
    "limit": "50 KB",
    "gzip": true,
    "running": false
  },
  {
    "name": "Total JavaScript (all chunks)",
    "path": "dist/assets/*.js",
    "limit": "1 MB",
    "gzip": true,
    "running": false
  }
]
```

**Configuration Notes**:

- `"running": false`: Disables time-based checks (file size only); time checks require full browser execution
- `"webpack": false`: Uses file system paths (build output), not webpack imports
- `"gzip": true`: All limits are post-gzip compression
- Glob patterns (`*`) match Vite's content-hashed output (e.g., `index-a83f9d27.js`)

**NPM Scripts** (`package.json`):

```json
{
  "scripts": {
    "size": "size-limit",
    "size:why": "size-limit --why",
    "size:json": "size-limit --json > size-limit-report.json"
  }
}
```

#### 2.4.4 CI Integration

**GitHub Actions Workflow**: `.github/workflows/ci.yml`

Add to `build` job (runs after quality checks pass):

```yaml
build:
  name: Build
  runs-on: ubuntu-latest
  needs: [audit, lint, test-unit, test-e2e]
  steps:
    - uses: actions/checkout@v4

    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm

    - run: npm ci

    - run: npm run build

    # Bundle Size Enforcement
    - name: Check Bundle Size
      run: npm run size

    # Bundle Size PR Comment (PRs only)
    - uses: andresz1/size-limit-action@v1
      if: github.event_name == 'pull_request'
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        skip_step: build # We already built above

    # Visual Bundle Analysis
    - name: Generate Bundle Visualization
      run: npm run build:analyze

    - name: Upload Bundle Report
      uses: actions/upload-artifact@v4
      with:
        name: bundle-report
        path: bundle-report.html
        retention-days: 30

    # Upload build artifacts for deployment
    - name: Upload Build Artifacts
      uses: actions/upload-pages-artifact@v3
      with:
        path: dist/
```

**Behavior**:

1. **size-limit runs**: If any bundle exceeds its limit, CI fails with detailed error
2. **PR Comment**: `size-limit-action` posts a comment on PRs showing size delta vs base branch
3. **Bundle Visualization**: Generates interactive treemap of bundle composition
4. **All or Nothing**: CI is blocked until bundle sizes are within limits

**Example PR Comment Format**:

```text
📦 Bundle Size — 2 changes

Path                      | Size      | Change
--------------------------|-----------|----------
Main entry (initial load) | 187 KB ⚠️ | +12 KB (+6.8%)
Dashboard route           | 94 KB ✅  | -3 KB (-3.1%)

⚠️ Warning: Main entry is at 93.5% of limit (200 KB)
```

#### 2.4.5 Bundle Analysis Workflow

**Tool**: `rollup-plugin-visualizer`

**Vite Configuration**: `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    // ... other plugins
  ],
  build: {
    rollupOptions: {
      plugins: [
        visualizer({
          filename: 'bundle-report.html',
          open: false, // Don't auto-open in CI
          gzipSize: true,
          brotliSize: true,
          template: 'treemap', // Options: treemap, sunburst, network
        }),
      ],
    },
  },
});
```

**NPM Script**:

```json
{
  "scripts": {
    "build:analyze": "vite build --mode production"
  }
}
```

**Generated Output**: `bundle-report.html`

- **Treemap Visualization**: Interactive chart showing relative size of each module
- **Gzip Sizes**: Post-compression sizes (realistic browser download)
- **Brotli Sizes**: Alternative compression for supporting browsers
- **Drill-Down**: Click packages to see internal module composition

**Developer Workflow**:

1. Run `npm run build:analyze` locally after adding dependencies
2. Open `bundle-report.html` in browser
3. Identify unexpectedly large dependencies
4. Investigate alternatives or lazy-load non-critical code
5. In CI: Download `bundle-report` artifact from Actions tab

**CI Artifact Access**:

1. Navigate to failed/passing CI run in GitHub Actions
2. Scroll to "Artifacts" section
3. Download `bundle-report.zip`
4. Extract and open `bundle-report.html` locally

#### 2.4.6 Tracking Bundle Size Over Time

**Strategy**: GitHub Actions artifact storage + JSON exports

**Historical Data Collection**:

```yaml
# Add to build job in .github/workflows/ci.yml
- name: Export Size Limit Report
  run: npm run size:json

- name: Upload Size History
  uses: actions/upload-artifact@v4
  with:
    name: size-limit-${{ github.sha }}
    path: size-limit-report.json
    retention-days: 90
```

**JSON Report Example**:

```json
[
  {
    "name": "Main entry (initial load)",
    "size": 187243,
    "limit": 204800,
    "passed": true
  },
  {
    "name": "Dashboard route",
    "size": 96321,
    "limit": 102400,
    "passed": true
  }
]
```

**Trend Analysis** (Manual, Post-Release):

1. Download JSON reports from last 10 releases
2. Plot size trends in spreadsheet or [size-limit-dashboard](https://github.com/size-limit/size-limit-dashboard)
3. Identify upward trends (e.g., vendor bundle growing 5% per month)
4. Schedule optimization work before thresholds are hit

**Future Enhancement**: Integrate with [size-limit-dashboard](https://github.com/size-limit-dashboard/size-limit-dashboard) for automated visualization (requires external service; must evaluate privacy implications per ADR-0015).

#### 2.4.7 Developer Workflow

**Pre-Commit** (Local Development):

```bash
# Before committing code that adds/modifies dependencies:
npm run build          # Rebuild production bundle
npm run size           # Check if size limits are exceeded
npm run build:analyze  # (Optional) Review bundle composition
```

**Expected Output** (Passing):

```text
✔ Main entry (initial load): 187 KB (limit: 200 KB)
✔ Dashboard route: 94 KB (limit: 100 KB)
✔ Analysis route: 88 KB (limit: 100 KB)
✔ Vendor chunks: 142 KB (limit: 150 KB)
✔ Total JavaScript: 891 KB (limit: 1 MB)

All size limits passed ✅
```

**Expected Output** (Failing):

```text
✖ Main entry (initial load): 215 KB (limit: 200 KB) — EXCEEDED by 15 KB
✔ Dashboard route: 94 KB (limit: 100 KB)

❌ Size limit check failed: 1 bundle exceeds limits
```

**When Size Check Fails**:

1. **Identify Cause**: Run `npm run build:analyze` and review bundle report
2. **Common Culprits**:
   - Large new dependency (e.g., moment.js → use day.js instead)
   - Importing entire library instead of specific functions (e.g., `import lodash` → `import debounce from 'lodash/debounce'`)
   - Missing dynamic import for heavy feature (e.g., export functionality)
3. **Fix Strategies**: See Section 2.4.9 (Optimization Recommendations)
4. **Retest**: Run `npm run size` again
5. **Exception Process**: If bundle increase is unavoidable, see Section 2.4.12

**CI Failure Investigation**:

1. Check PR comment for size delta (which bundle grew, by how much)
2. Download `bundle-report` artifact from GitHub Actions
3. Open `bundle-report.html` to see treemap visualization
4. Identify which dependency caused the increase
5. Apply optimization strategies or request size limit increase

#### 2.4.8 Automated Alerts

**PR Comment Integration**: `size-limit-action` (from Section 2.4.4)

**Alert Thresholds**:

| Status         | Condition                   | Action                       |
| -------------- | --------------------------- | ---------------------------- |
| ✅ **Pass**    | All bundles ≤ 80% of limit  | No alert, CI passes          |
| ⚠️ **Warning** | Any bundle 80-100% of limit | PR comment warns, CI passes  |
| ❌ **Fail**    | Any bundle > 100% of limit  | PR comment fails, CI blocked |

**PR Comment Format**:

**Passing (< 80%)**:

```text
✅ Bundle Size Check Passed

All bundles are within size limits.
```

**Warning (80-100%)**:

```text
⚠️ Bundle Size Warning

Path                      | Size      | Limit   | Usage
--------------------------|-----------|---------|-------
Main entry (initial load) | 187 KB    | 200 KB  | 93.5% ⚠️

This bundle is approaching its size limit. Consider:
- Lazy-loading non-critical features
- Using smaller alternative dependencies
- Code splitting heavy components
```

**Failure (> 100%)**:

```text
❌ Bundle Size Limit Exceeded

Path                      | Size      | Limit   | Over by
--------------------------|-----------|---------|----------
Main entry (initial load) | 215 KB    | 200 KB  | +15 KB ❌

This PR exceeds the bundle size limit and cannot be merged.

See devops-architecture.md Section 2.4.9 for optimization strategies.
To request a size limit increase, see Section 2.4.12.
```

**PR Labeling** (GitHub Actions):

Add to CI workflow:

```yaml
- name: Label Large Bundle Changes
  if: github.event_name == 'pull_request'
  uses: actions/github-script@v7
  with:
    script: |
      const fs = require('fs');
      const report = JSON.parse(fs.readFileSync('size-limit-report.json'));
      const anyIncreased = report.some(r => r.size > r.limit * 0.9);

      if (anyIncreased) {
        github.rest.issues.addLabels({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: context.issue.number,
          labels: ['⚠️ bundle-size']
        });
      }
```

**Labels**:

- `⚠️ bundle-size`: Any bundle at 90%+ of limit (warning or failing)
- Visible in PR list for easy identification during code review

#### 2.4.9 Optimization Recommendations

##### Strategy 1: Dynamic Imports for Heavy Features

❌ **Before** (synchronous import):

```typescript
import { ExportDialog } from './components/ExportDialog';

function App() {
  return <ExportDialog />;
}
```

✅ **After** (lazy-loaded):

```typescript
const ExportDialog = lazy(() => import('./components/ExportDialog'));

function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ExportDialog />
    </Suspense>
  );
}
```

**Savings**: Export functionality (including CSV generation, chart export) moves from main bundle to separate chunk loaded on-demand.

##### Strategy 2: Tree-Shaking Verification

Ensure imports are tree-shakeable:

❌ **Before** (imports entire library):

```typescript
import _ from 'lodash';
const result = _.debounce(fn, 300);
```

✅ **After** (imports specific function):

```typescript
import debounce from 'lodash/debounce';
const result = debounce(fn, 300);
```

**Savings**: ~70 KB (lodash full library) → ~2 KB (single function)

##### Strategy 3: Package Size Alternatives

Common bloated dependencies and lightweight alternatives:

| Heavy Dependency | Size (gzipped) | Lightweight Alternative      | Size (gzipped) | Savings |
| ---------------- | -------------- | ---------------------------- | -------------- | ------- |
| `moment`         | 71 KB          | `day.js`                     | 7 KB           | 64 KB   |
| `axios`          | 13 KB          | `fetch` (native)             | 0 KB           | 13 KB   |
| `lodash` (full)  | 72 KB          | `lodash-es` (tree-shakeable) | ~5-20 KB       | 50+ KB  |
| `chart.js`       | 88 KB          | `recharts` (already used)    | 45 KB          | N/A     |

##### Strategy 4: Code Splitting by Route

Vite automatically splits routes, but verify Splitting is working:

```bash
npm run build
ls -lh dist/assets/

# Expected output (content hashes will vary):
# index-a83f9d27.js       <- Main entry
# Dashboard-f2e45b19.js   <- Dashboard route chunk
# Analysis-c9d28a45.js    <- Analysis route chunk
# vendor-7f8e2d31.js      <- Shared vendor chunk
```

If routes are bundled in main entry, configure manual chunks in `vite.config.ts`:

```typescript
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', '@radix-ui/react-*'],
          analysis: ['./src/features/analysis'],
          dashboard: ['./src/features/dashboard'],
        },
      },
    },
  },
});
```

##### Strategy 5: Remove Unused Dependencies

Audit `package.json` for unused packages:

```bash
npx depcheck

# Output shows unused dependencies:
# Unused dependencies: styled-components, framer-motion
```

Remove unused packages:

```bash
npm uninstall styled-components framer-motion
```

##### Strategy 6: Optimize Images and Fonts

- **SVGs**: Optimize with SVGO (Vite plugin: `vite-plugin-svgo`)
- **Fonts**: Subset to Latin character ranges only (removes CJK, Cyrillic)
- **Images**: Convert PNGs to WebP with fallbacks

##### Strategy 7: Analyze Bundle Report

Generate and review treemap:

```bash
npm run build:analyze
open bundle-report.html
```

Look for:

- Unexpectedly large dependencies (e.g., entire UI library when only using 3 components)
- Duplicate dependencies (multiple versions of same package)
- Development-only code accidentally included in production

#### 2.4.10 Split Points Monitoring

**Goal**: Ensure route-based code splitting remains effective as application grows.

**Metrics to Track**:

| Split Point     | Target Size | Monitor For                                  |
| --------------- | ----------- | -------------------------------------------- |
| Main entry      | ≤150 KB     | Growing vendor imports, app shell bloat      |
| Dashboard route | ≤75 KB      | Heavy chart libraries, data processing logic |
| Analysis route  | ≤75 KB      | Statistical libraries, visualization code    |
| Settings route  | ≤50 KB      | Minimal; mostly form components              |
| Worker bundles  | ≤50 KB each | Parser libraries, compression codecs         |

**Monitoring Process**:

1. Run `npm run size` locally before each commit
2. Review size-limit output for per-route sizes
3. If any route exceeds 80% of limit, investigate in bundle report
4. Common causes:
   - Importing shared utilities directly in route (should be in vendor chunk)
   - Large component libraries not lazy-loaded
   - Route importing other route's code (circular dependency)

**Vendor Bundle Monitoring**:

Vendor chunk should contain **ONLY**:

- React & React-DOM
- Radix UI primitives
- Zustand (state management)
- Small utilities (clsx, class-variance-authority)

**Not in vendor chunk** (should be route chunks or lazy-loaded):

- Recharts (heavy, only used in Analysis route)
- D3 functions (only used in Analysis route)
- Export utilities (CSV, PDF generation)

**Verification**:

```bash
npm run build:analyze
# In bundle-report.html:
# - Expand vendor-*.js
# - Verify recharts is NOT in vendor chunk
# - Verify recharts IS in Analysis-*.js chunk
```

#### 2.4.11 Performance Budget Alignment

Bundle size targets are **derived from** performance budgets in [performance-strategy.md](performance-strategy.md):

**Performance Budget → Bundle Size Calculation**:

| Performance Metric                 | Target | Derives Bundle Size Limit                     |
| ---------------------------------- | ------ | --------------------------------------------- |
| **LCP (Largest Contentful Paint)** | ≤2.5s  | Initial bundle ≤200 KB (download + parse ≤2s) |
| **FID (First Input Delay)**        | ≤100ms | Main thread not blocked by parse/execute      |
| **CLS (Cumulative Layout Shift)**  | ≤0.1   | CSS must load before render (≤50 KB)          |
| **TTI (Time to Interactive)**      | ≤3.5s  | Total JS ≤1 MB (includes all route chunks)    |

**Network Speed Baseline**: **Slow 3G** (400 Kbps downlink, 400ms RTT)

**Why Slow 3G?**

- Represents mobile users on poor connectivity
- Corresponds to WebPageTest "Mobile - 3G" profile
- Chrome DevTools throttling profile
- Target: 75th percentile user experience (not average)

**Parse/Execute Time Assumptions** (Low-End Mobile):

| Operation              | Time per 100 KB | Impact on LCP                |
| ---------------------- | --------------- | ---------------------------- |
| Download @ 400 Kbps    | 2000ms          | Direct                       |
| Parse JS (V8 engine)   | 50ms            | Direct (main thread blocked) |
| Execute JS (hydration) | 100ms           | Direct (React render)        |
| First Paint            | 200ms           | Direct (browser layout)      |

**Example Budget Breakdown** (Main Entry Bundle):

```
LCP Target: 2.5s

Time Budget Allocation:
- DNS + SSL: 400ms (1 RTT)
- Download 150 KB gzipped @ 400 Kbps: 3000ms ❌ (exceeds budget!)

Revised:
- Reduce to 80 KB gzipped: 1600ms
- Parse: 50ms
- Execute + hydrate: 300ms
- First paint: 200ms
- Reserve: 350ms (buffer for variability)
────────────────────────
Total: 2500ms ✅ (within LCP target)
```

**This is why initial bundle limit is 200 KB** (with 150 KB target): Network transfer dominates LCP on slow connections.

**Tooling Alignment**:

- `size-limit --why` shows estimated download + parse time (requires `@size-limit/preset-app`)
- Add to `package.json`:

  ```json
  {
    "size-limit": [
      {
        "name": "Main entry (initial load)",
        "path": "dist/assets/index-*.js",
        "limit": "200 KB",
        "gzip": true,
        "running": true // Enable time-based checks
      }
    ]
  }
  ```

- Running time check:

  ```bash
  npm run size:why

  # Output:
  # Main entry (initial load)
  #   Size: 187 KB (limit: 200 KB) ✅
  #   Download time (Slow 3G): 1900ms
  #   Parse time: 48ms
  #   Execution time: 312ms
  #   Total LCP impact: 2260ms ✅ (< 2500ms target)
  ```

#### 2.4.12 Exceptions & Override Process

**When to Request Size Limit Increase**:

Legitimate reasons:

- ✅ New critical feature requires unavoidable dependency (e.g., PDF export library)
- ✅ Dependency update adds features used by application (intentional growth)
- ✅ Accessibility improvement requires additional code (WCAG compliance > size)

Invalid reasons:

- ❌ Developer convenience (e.g., adding lodash instead of writing 5 lines of code)
- ❌ "Nice to have" features without user demand
- ❌ Premature optimization (adding framework before needed)

**Approval Process**:

1. **Attempt Optimization First** (Required)
   - Follow all strategies in Section 2.4.9
   - Document what was tried and why it's insufficient
   - Example: "Tried lazy-loading PDF export, but users need immediate generation"

2. **Document in ADR** (Required for Permanent Increases)
   - Create ADR in `docs/decisions/` (use MADR 4.0 template)
   - Title: "Increase Bundle Size Limit for [Feature]"
   - Include:
     - Performance impact analysis (LCP, TTI degradation)
     - Alternative approaches considered
     - Justification for approval
   - Example: `docs/decisions/0016-increase-bundle-size-pdf-export.md`

3. **Update `.size-limit.json`** (After ADR Approval)

   ```json
   [
     {
       "name": "Main entry (initial load)",
       "limit": "250 KB", // Increased from 200 KB (see ADR-0016)
       "gzip": true
     }
   ]
   ```

4. **Update Performance Budget** (If Necessary)
   - If bundle increase degrades LCP/TTI targets, update [performance-strategy.md](performance-strategy.md) accordingly
   - Example: "LCP target revised to 2.8s (from 2.5s) due to PDF export feature"

5. **Approval Authority**:
   - **Temporary increase (single PR)**: QA agent approval (use `--skip-step` in PR)
   - **Permanent increase**: Human product owner approval + ADR
   - **Emergency override**: Human product owner only (e.g., security patch requires larger bundle)

**Temporary Override** (Single PR Only):

If legitimate feature requires size increase but ADR not yet written:

```yaml
# In PR description, add comment:
# bundle-size-override: emergency-security-patch

# CI workflow detects comment and allows override:
- name: Check Bundle Size
  run: |
    if grep -q "bundle-size-override" <<< "${{ github.event.pull_request.body }}"; then
      echo "⚠️ Bundle size check skipped (temporary override)"
      exit 0
    fi
    npm run size
```

**Merge Condition**: Override PRs must have follow-up issue created to address size increase or document in ADR.

**Revert Policy**: If size increase causes user-reported performance regressions, feature may be reverted regardless of approval status.

### 2.5 Build Artifact Management

**Artifacts Produced**:

| Artifact             | Location             | Retention            | Purpose                           |
| -------------------- | -------------------- | -------------------- | --------------------------------- |
| Production bundle    | `dist/`              | Permanent (deployed) | GitHub Pages deployment           |
| Bundle visualization | `stats.html`         | 30 days              | Size regression analysis          |
| Playwright report    | `playwright-report/` | 14 days              | E2E test debugging                |
| Test coverage        | `coverage/`          | 7 days               | Coverage trend analysis           |
| Source maps          | `dist/**/*.map`      | Not uploaded         | Production debugging (local only) |

**Retention Strategy**:

- Only the latest successful build artifacts are deployed to GitHub Pages
- Historical artifacts (reports, coverage) are kept for debugging but automatically pruned
- Source maps are excluded from deployment for security (contain original source code)

---

## 3. Quality Gates

### 3.1 Pre-Commit Hooks

**Status**: IMPLEMENTED — Addresses QA COMPLIANCE-1

This section documents the complete pre-commit hook system for local development, including installation, configuration, execution, bypass options, troubleshooting, and integration with CI/CD. Pre-commit hooks are the **first line of defense** for code quality, catching issues locally before they reach CI and reducing feedback cycles from minutes to seconds.

---

#### 3.1.1 Purpose & Rationale

Pre-commit hooks serve four critical functions:

1. **Fast Feedback**: Catch issues in seconds (locally) vs minutes (CI wait time)
2. **Quality Enforcement**: Ensure code meets formatting, linting, type safety, and correctness standards before commit
3. **CI Failure Reduction**: Block broken code from reaching CI, reducing wasted CI minutes and context switching
4. **Developer Experience**: Consistent code style across team; fewer surprises in code review

**Core Guarantee**: **If pre-commit passes locally, CI must be green.** Any violation of this guarantee is a P0 bug in the DevOps architecture.

---

#### 3.1.2 Pre-Commit Checks

Pre-commit hooks run **four checks sequentially** in fail-fast order (formatting → linting → type-checking → testing). This order optimizes for speed: fast checks (formatting, linting) run first, expensive checks (type-checking, tests) run last.

##### Check 1: Code Formatting (Prettier)

**Command**:

```bash
npx prettier --check .
```

**Purpose**: Enforce consistent code style (indentation, quotes, semicolons, line breaks)

**Scope**: All files matching `.prettierrc` and `.prettierignore` configuration

**Configuration**: `.prettierrc`

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "endOfLine": "lf"
}
```

**Auto-fix**: `npx prettier --write .` or `npm run format`

**Typical Execution Time**: 1–3 seconds

**Failure Handling**: Immediate rejection; zero cost to retry after fix

---

##### Check 2: Code Linting (ESLint)

**Command**:

```bash
npx eslint .
```

**Purpose**: Catch code quality issues, potential bugs, unused variables, anti-patterns

**Scope**: All `.ts`, `.tsx`, `.js`, `.jsx` files per `.eslintrc.json`

**Configuration**: `.eslintrc.json`

```json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended"
  ],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module",
    "ecmaFeatures": {
      "jsx": true
    }
  },
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "react/react-in-jsx-scope": "off"
  }
}
```

**Auto-fix**: `npx eslint . --fix` or `npm run lint:fix` (auto-fixable rules only)

**Typical Execution Time**: 2–5 seconds

**Failure Examples**:

- Unused variables: `'x' is assigned a value but never used`
- Missing dependencies in React hooks: `React Hook useEffect has a missing dependency`
- Invalid TypeScript patterns: `Unexpected any. Specify a different type`

**Failure Handling**: Blocking; developer must manually fix issues that can't be auto-fixed

---

##### Check 3: Type Checking (TypeScript)

**Command**:

```bash
npx tsc --noEmit
```

**Purpose**: Catch type errors, interface mismatches, and type safety violations before CI

**Scope**: All `.ts` and `.tsx` files per `tsconfig.json`

**Configuration**: `tsconfig.json` (key settings)

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Auto-fix**: None — type errors must be resolved manually

**Typical Execution Time**: 3–8 seconds (depends on project size and tsserver cache)

**Failure Examples**:

- Type mismatch: `Type 'string' is not assignable to type 'number'`
- Missing properties: `Property 'name' is missing in type 'User'`
- Incorrect function signature: `Expected 2 arguments, but got 1`

**Failure Handling**: Blocking; developer must fix type errors. **Never use `// @ts-ignore` or `any` to bypass.**

**Performance Optimization**: TypeScript uses incremental compilation (`.tsbuildinfo` cache); subsequent runs are faster.

---

##### Check 4: Unit Tests (Vitest)

**Command**:

```bash
npx vitest run --reporter=dot
```

**Purpose**: Ensure code changes don't break existing functionality; catch regressions early

**Scope**: All test files matching `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx` per `vitest.config.ts`

**Configuration**: `vitest.config.ts` (key settings)

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', 'src/test/'],
    },
  },
});
```

**Reporter**: `dot` (minimal output for speed; one dot per passing test, F for failure)

**Typical Execution Time**: 5–15 seconds (depends on test count and complexity)

**Failure Handling**: Blocking; tests must pass or be fixed. Skipped tests (`test.skip`) are allowed but discouraged.

**Performance Optimization**: Vitest runs tests in parallel across CPU cores; use `--no-threads` if flaky tests suspected.

---

#### 3.1.3 Execution Order & Fail Fast

Pre-commit checks run in the following order to **minimize wasted time**:

1. **Prettier** (1–3s) — Fastest; trivial to fix
2. **ESLint** (2–5s) — Fast; mostly auto-fixable
3. **TypeScript** (3–8s) — Moderate; requires manual fixes
4. **Vitest** (5–15s) — Slowest; requires debugging

**Fail Fast**: If any check fails, subsequent checks are **not run**. Example: if Prettier fails, ESLint/TypeScript/Vitest are skipped. This reduces feedback time and avoids cascading error messages.

**Total Execution Time**: **< 30 seconds** on typical changes (< 10 files modified). Larger changesets may take 30–60 seconds.

---

#### 3.1.4 Installation & Setup

**Tool**: **Husky v9** (industry-standard Git hooks manager)

**Why Husky**:

- Zero-friction installation via npm postinstall hook
- Committed hook scripts (`.husky/pre-commit` is version-controlled)
- Cross-platform compatibility (Windows, macOS, Linux)
- No global dependencies required

**Installation** (automatic on `npm install`):

```bash
# Clone repository
git clone https://github.com/kylescudder/cpap-analyzer.git
cd cpap-analyzer

# Install dependencies (automatically installs Husky hooks)
npm install

# Verify hooks are installed
ls -la .git/hooks/pre-commit
# Expected: .git/hooks/pre-commit exists and is executable
```

**Manual Installation** (if hooks not installed):

```bash
npm run prepare
```

**NPM Scripts** (`package.json`):

```json
{
  "scripts": {
    "prepare": "husky install",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "pre-commit": "prettier --check . && eslint . && tsc --noEmit && vitest run --reporter=dot"
  },
  "devDependencies": {
    "husky": "^9.0.0",
    "prettier": "^3.2.0",
    "eslint": "^8.57.0",
    "@typescript-eslint/parser": "^7.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "typescript": "^5.3.0",
    "vitest": "^1.3.0"
  }
}
```

**First-Time Contributor Setup**:

1. Fork the repository
2. Clone the fork: `git clone https://github.com/<your-username>/cpap-analyzer.git`
3. Install dependencies: `npm install`
4. Verify hooks: `npm run pre-commit`
5. Make changes
6. Commit (hooks run automatically)

---

#### 3.1.5 Running Checks Manually

Pre-commit hooks run automatically on `git commit`, but checks can also be run manually for debugging, verification, or CI mirroring.

**Individual Check Commands**:

| Check              | Command                | Purpose                                        |
| ------------------ | ---------------------- | ---------------------------------------------- |
| Formatting (check) | `npm run format:check` | Verify code formatting without modifying files |
| Formatting (fix)   | `npm run format`       | Auto-format all files                          |
| Linting (check)    | `npm run lint`         | Check for linting errors                       |
| Linting (fix)      | `npm run lint:fix`     | Auto-fix fixable linting issues                |
| Type checking      | `npm run type-check`   | Run TypeScript compiler without emitting files |
| Unit tests         | `npm run test`         | Run full test suite                            |
| Unit tests (watch) | `npm run test:watch`   | Run tests in watch mode (interactive)          |
| **All checks**     | `npm run pre-commit`   | Run all pre-commit checks manually             |

**Use Cases**:

- **Before committing**: `npm run pre-commit` to verify all checks pass
- **Auto-fix formatting**: `npm run format` to fix all Prettier issues at once
- **Auto-fix linting**: `npm run lint:fix` to fix auto-fixable ESLint issues
- **Interactive testing**: `npm run test:watch` to debug failing tests
- **CI debugging**: `npm run pre-commit` mirrors exact pre-commit behavior

---

#### 3.1.6 Bypass Options

**Default Policy**: Pre-commit hooks **should not be bypassed** under normal circumstances. The pre-commit guarantee ("if pre-commit passes, CI is green") only holds if hooks are not bypassed.

**Bypass Command**:

```bash
git commit --no-verify
# or short form:
git commit -n
```

**When Bypass is Appropriate**:

1. **Emergency Hotfixes**: Critical production bug that must be deployed immediately; skip pre-commit, fix later
2. **Work-in-Progress Commits**: Committing unfinished code to a feature branch for backup or collaboration (not main branch)
3. **Pre-Commit Hook Bugs**: Pre-commit hook itself is broken and blocking valid commits (rare, but report to DevOps immediately)

**When Bypass is NOT Appropriate**:

- "Too slow" — Pre-commit is < 30 seconds; fix the issue instead
- "Tests are flaky" — Fix the tests, don't bypass
- "Just this once" — If the code doesn't pass pre-commit, it won't pass CI either

**Consequences of Bypassing**:

- **CI will fail**: Same checks run in CI; bypassing pre-commit only delays the error
- **Blocked PRs**: CI must be green to merge; bypassed commits will block the PR
- **Context switching**: Waiting for CI failures (5+ minutes) vs fixing locally (< 1 minute)
- **Code review friction**: Reviewers see linting/formatting issues; wastes review time

**Better Alternatives to Bypass**:

1. **Fix issues locally**: Run `npm run format` and `npm run lint:fix` to auto-fix most issues
2. **Commit smaller chunks**: If tests fail, commit passing changes first, fix failing tests separately
3. **Use `--amend`**: Fix issues and amend the commit instead of creating a new commit
4. **WIP branches**: For work-in-progress, push to a feature branch (not main) with `--no-verify` if needed

**PR Review Policy**: Commits that bypass pre-commit (detected by CI failures) should be rejected in code review unless there's a documented reason (emergency hotfix, pre-commit bug).

---

#### 3.1.7 Performance Considerations

**Performance Target**: Pre-commit checks complete in **< 30 seconds** on typical changes.

**Performance Optimizations**:

##### 3.1.7.1 Lint-Staged (Future Optimization)

**Status**: NOT YET IMPLEMENTED — Performance is currently acceptable (< 30s)

**Concept**: Run checks only on **staged files** (not entire codebase)

**Tool**: `lint-staged` + `husky`

**Configuration** (`.lintstagedrc.json`):

```json
{
  "*.{ts,tsx,js,jsx}": ["prettier --write", "eslint --fix", "tsc-files --noEmit"],
  "*.{json,md,css}": ["prettier --write"]
}
```

**Expected Speedup**: 3–10x faster for small changes (< 10 files)

**Trade-off**: Added complexity; may miss issues in unchanged files

**Decision**: Implement if pre-commit checks exceed 30 seconds regularly. Currently not needed.

##### 3.1.7.2 TypeScript Incremental Compilation

**Status**: ENABLED via `tsconfig.json`

**Configuration**:

```json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": ".tsbuildinfo"
  }
}
```

**Speedup**: First run ~8s, subsequent runs ~3s (60% faster)

##### 3.1.7.3 Vitest Affected Tests Only (Future Optimization)

**Status**: NOT YET IMPLEMENTED

**Concept**: Run only tests affected by changed files (requires test dependency graph)

**Tool**: `vitest --changed` (experimental feature)

**Decision**: Implement if test suite grows beyond 500 tests or execution time exceeds 15 seconds

---

#### 3.1.8 Troubleshooting Pre-Commit Failures

##### Prettier Failure

**Symptom**:

```
Checking formatting...
[warn] src/components/Dashboard.tsx
[warn] Code style issues found in the above file. Run Prettier to fix.
```

**Cause**: Code formatting doesn't match `.prettierrc` configuration

**Fix**:

```bash
npm run format
git add .
git commit
```

**Prevention**: Configure your code editor to run Prettier on save:

- **VS Code**: Install `esbenp.prettier-vscode`, enable "Format on Save"
- **WebStorm**: Enable "Prettier" in Settings > Languages & Frameworks > JavaScript > Prettier

---

##### ESLint Failure

**Symptom**:

```
/Users/dev/cpap-analyzer/src/utils/helpers.ts
  12:7  error  'result' is assigned a value but never used  @typescript-eslint/no-unused-vars
```

**Cause**: Code violates ESLint rules

**Fix (Auto-fixable)**:

```bash
npm run lint:fix
git add .
git commit
```

**Fix (Manual)**:

1. Open the file indicated in the error (`src/utils/helpers.ts`)
2. Fix the specific issue (remove unused variable, add missing dependency, etc.)
3. Retry commit

**Prevention**: Configure your code editor to run ESLint on save:

- **VS Code**: Install `dbaeumer.vscode-eslint`, enable "ESLint: Auto Fix On Save"
- **WebStorm**: Enable "ESLint" in Settings > Languages & Frameworks > JavaScript > Code Quality Tools

---

##### TypeScript Type Error

**Symptom**:

```
src/stores/sessionStore.ts:45:12 - error TS2322: Type 'string' is not assignable to type 'number'.

45     age: "25",
            ~~~~
```

**Cause**: Type mismatch detected by TypeScript compiler

**Fix**:

1. Open the file and line indicated (`src/stores/sessionStore.ts:45`)
2. Correct the type error (change `"25"` to `25`, or update type definition)
3. Retry commit

**Prevention**:

- Configure your code editor for TypeScript integration:
  - **VS Code**: TypeScript support is built-in; errors appear in "Problems" panel
  - **WebStorm**: TypeScript support is built-in; enable "TypeScript type checking"
- Run `npm run type-check` frequently during development

**NEVER USE**:

- `// @ts-ignore` to suppress errors (hides real bugs)
- `any` type to bypass type checking (defeats purpose of TypeScript)

---

##### Test Failure

**Symptom**:

```
 FAIL  src/utils/helpers.test.ts > formatDate > should format ISO date
AssertionError: expected '2024-01-01' to equal '01/01/2024'
```

**Cause**: Code changes broke a test, or test expectations are incorrect

**Fix**:

1. Run tests interactively: `npm run test:watch`
2. Debug the failing test:
   - If code is correct, update test expectations
   - If code is wrong, fix the implementation
3. Verify all tests pass: `npm run test`
4. Retry commit

**Prevention**:

- Run tests in watch mode during development: `npm run test:watch`
- Write tests as you write code (TDD approach)
- Run full test suite before committing: `npm run test`

---

##### Hook Not Running

**Symptom**: Commit succeeds without running pre-commit checks (no output)

**Cause**: Husky hooks not installed or not executable

**Fix**:

```bash
# Reinstall Husky hooks
npm run prepare

# Verify hook is executable
chmod +x .husky/pre-commit

# Verify hook content
cat .husky/pre-commit
```

**Expected Hook Content** (`.husky/pre-commit`):

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

echo "Running pre-commit checks..."
npm run pre-commit
```

**Prevention**: Run `npm install` (not `npm ci`) during setup to ensure postinstall hooks run

---

#### 3.1.9 Configuration Files

Pre-commit checks rely on the following configuration files:

| File                | Purpose                           | Owner                | Change Frequency                 |
| ------------------- | --------------------------------- | -------------------- | -------------------------------- |
| `.husky/pre-commit` | Pre-commit hook script            | DevOps               | Rare (add new checks)            |
| `.prettierrc`       | Code formatting rules             | DevOps               | Rare (style changes)             |
| `.prettierignore`   | Files excluded from formatting    | DevOps               | Occasional (ignore build output) |
| `.eslintrc.json`    | Linting rules                     | DevOps               | Occasional (rule updates)        |
| `.eslintignore`     | Files excluded from linting       | DevOps               | Occasional                       |
| `tsconfig.json`     | TypeScript compiler configuration | DevOps               | Rare (target changes)            |
| `vitest.config.ts`  | Test runner configuration         | DevOps + Unit Tester | Occasional (coverage thresholds) |
| `package.json`      | npm scripts for manual checks     | DevOps               | Frequent (add new scripts)       |

**Configuration Change Process**:

1. Propose change in GitHub issue (justify rationale)
2. Update configuration file
3. Update `.github/workflows/ci.yml` to mirror change (maintain pre-commit/CI parity)
4. Test locally with `npm run pre-commit`
5. Create PR; ensure CI is green
6. Announce configuration change to team (if user-facing impact)

---

#### 3.1.10 Integration with CI/CD

**Philosophy**: CI mirrors pre-commit checks exactly, plus additional steps that are too slow for local pre-commit (E2E tests, security audit, bundle size analysis).

**Pre-Commit vs CI Checks**:

| Check                  | Pre-Commit (Local)          | CI (GitHub Actions)            | Why Different?                              |
| ---------------------- | --------------------------- | ------------------------------ | ------------------------------------------- |
| Prettier               | ✅ `npx prettier --check .` | ✅ `npx prettier --check .`    | Identical                                   |
| ESLint                 | ✅ `npx eslint .`           | ✅ `npx eslint .`              | Identical                                   |
| TypeScript             | ✅ `npx tsc --noEmit`       | ✅ `npx tsc --noEmit`          | Identical                                   |
| Vitest unit tests      | ✅ `npx vitest run`         | ✅ `npx vitest run --coverage` | CI adds coverage reporting                  |
| E2E tests (Playwright) | ❌ (too slow, ~2–5 min)     | ✅                             | Too slow for pre-commit                     |
| Security audit         | ❌ (too slow, ~30s)         | ✅                             | Blocks on vulnerabilities, not code changes |
| Bundle size check      | ❌ (requires full build)    | ✅                             | Needs production build                      |

**Pre-Commit Guarantee**: **If pre-commit passes locally, CI formatting/linting/type-checking/unit-tests MUST be green.** CI may still fail on E2E tests or security audit, but core checks must pass.

**Enforcement**: Any violation of this guarantee is a **P0 DevOps bug**. Root causes include:

- CI and pre-commit use different Node.js versions (must match)
- CI and pre-commit use different dependency versions (lock file out of sync)
- Environment-specific configuration differences (`.env` files, OS-specific behavior)

**Debugging Mismatches**:

1. Reproduce locally: Run CI commands exactly as defined in `.github/workflows/ci.yml`
2. Check Node.js versions: `node --version` (local) vs `github-actions` (CI logs)
3. Check dependency versions: `npm list <package>` (local) vs CI logs
4. Check configuration files: Ensure `.prettierrc`, `.eslintrc.json`, `tsconfig.json` are committed

---

#### 3.1.11 Developer Experience

**Benefits of Pre-Commit Hooks**:

1. **Fast Feedback**: Errors caught in seconds, not minutes (no CI wait time)
2. **Consistent Code Style**: No debates about formatting; Prettier enforces one style
3. **Fewer Context Switches**: Fix issues immediately, not after switching tasks
4. **Reduced CI Failures**: Blocks broken code from reaching CI
5. **Cleaner Git History**: Every commit passes quality checks
6. **Better Code Reviews**: Reviewers focus on logic, not formatting/style issues

**Developer Workflow**:

```bash
# 1. Make changes
vim src/components/Dashboard.tsx

# 2. (Optional) Run checks manually
npm run pre-commit

# 3. Stage changes
git add src/components/Dashboard.tsx

# 4. Commit (pre-commit hook runs automatically)
git commit -m "feat: add dashboard export button"

# 5. If pre-commit fails, fix and re-commit
npm run format       # Fix Prettier issues
npm run lint:fix     # Fix auto-fixable ESLint issues
git add .
git commit --amend --no-edit

# 6. Push (CI will mirror pre-commit checks)
git push
```

**Time Savings** (per commit):

- **Without pre-commit**: Commit (5s) → Push (10s) → Wait for CI (3–5 min) → CI fails → Fix → Repeat = **5–10 minutes**
- **With pre-commit**: Commit fails locally (15s) → Fix (1–2 min) → Re-commit succeeds (15s) → Push → CI green = **2–3 minutes**

**Average time saved per commit**: **3–7 minutes**

---

#### 3.1.12 Hook Script Implementation

**File**: `.husky/pre-commit`

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

echo "🎯 Running pre-commit checks..."
echo ""

# Exit immediately if any command fails
set -e

# 1. Formatting (Prettier)
echo "✨ Checking code formatting (Prettier)..."
npx prettier --check . || {
  echo "❌ Formatting check failed. Run 'npm run format' to fix."
  exit 1
}
echo "✅ Formatting passed"
echo ""

# 2. Linting (ESLint)
echo "🔍 Linting code (ESLint)..."
npx eslint . || {
  echo "❌ Linting failed. Run 'npm run lint:fix' to auto-fix, or fix manually."
  exit 1
}
echo "✅ Linting passed"
echo ""

# 3. Type Checking (TypeScript)
echo "🔎 Type checking (TypeScript)..."
npx tsc --noEmit || {
  echo "❌ Type checking failed. Fix type errors and retry."
  exit 1
}
echo "✅ Type checking passed"
echo ""

# 4. Unit Tests (Vitest)
echo "🧪 Running unit tests (Vitest)..."
npx vitest run --reporter=dot || {
  echo "❌ Tests failed. Fix failing tests and retry."
  exit 1
}
echo "✅ Tests passed"
echo ""

echo "✅ All pre-commit checks passed! 🎉"
echo ""
```

**Key Features**:

- **`set -e`**: Fail fast on first error
- **Custom error messages**: Guide developers to fix commands
- **Clear progress output**: Shows which check is running
- **Non-zero exit codes**: Blocks commit on failure

---

#### 3.1.13 Lint-Staged Configuration (Future)

**File**: `.lintstagedrc.json` (NOT YET IMPLEMENTED)

**Purpose**: Run checks only on staged files (not entire codebase) to improve performance

**Configuration**:

```json
{
  "*.{ts,tsx}": ["prettier --write", "eslint --fix", "bash -c 'tsc --noEmit'"],
  "*.{js,jsx}": ["prettier --write", "eslint --fix"],
  "*.{json,md,css,html}": ["prettier --write"]
}
```

**Modified Hook** (`.husky/pre-commit`):

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

echo "🎯 Running pre-commit checks on staged files..."
npx lint-staged

echo "🧪 Running unit tests..."
npx vitest run --reporter=dot
```

**Decision**: Implement if pre-commit checks regularly exceed 30 seconds. Currently not needed (checks complete in < 30s).

---

#### 3.1.14 NPM Scripts Summary

**File**: `package.json` (scripts section)

```json
{
  "scripts": {
    "prepare": "husky install",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "pre-commit": "prettier --check . && eslint . && tsc --noEmit && vitest run --reporter=dot"
  }
}
```

**Usage Guide**:

| Script                 | Command                            | Purpose                           |
| ---------------------- | ---------------------------------- | --------------------------------- |
| `npm run format`       | Auto-fix all formatting issues     | Use daily before committing       |
| `npm run format:check` | Check formatting without modifying | Use in CI/scripts                 |
| `npm run lint:fix`     | Auto-fix linting issues            | Use when ESLint fails             |
| `npm run type-check`   | Check TypeScript types             | Use frequently during development |
| `npm run test`         | Run all tests once                 | Use before committing             |
| `npm run test:watch`   | Run tests in watch mode            | Use during TDD development        |
| `npm run pre-commit`   | Run all pre-commit checks manually | Use to verify before committing   |

---

**Performance**: Pre-commit checks complete in < 30 seconds on typical changes (< 10 files modified).

**Guarantee**: If pre-commit passes locally, CI must be green. This is a **contractual guarantee** of the DevOps architecture. Any violation is a P0 bug.

### 3.2 CI Quality Checks

**Philosophy**: CI mirrors pre-commit checks exactly, plus additional steps that are too slow for local pre-commit (E2E tests, security audit).

#### 3.2.1 Parallel Jobs (Stage 1)

Four independent jobs run in parallel:

**Job 1: Security Audit**

```yaml
audit:
  name: Security Audit
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm
    - run: npm ci
    - run: npm audit --audit-level=high
```

- **Purpose**: Block builds with high/critical npm vulnerabilities
- **Threshold**: Zero high or critical vulnerabilities allowed
- **Failure Handling**: Blocking; must upgrade/patch affected dependencies

**Job 2: Lint & Format**

```yaml
lint:
  name: Lint & Format
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm
    - run: npm ci
    - run: npx prettier --check .
    - run: npx eslint .
    - run: npx tsc --noEmit
```

- **Purpose**: Verify pre-commit formatting/linting guarantee
- **Expected Result**: Always pass (pre-commit ensures this)
- **Failure Handling**: Indicates pre-commit bypass or CI/local environment mismatch (bug)

**Job 3: Unit & Integration Tests**

```yaml
test-unit:
  name: Unit & Integration Tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm
    - run: npm ci
    - run: npx vitest run --coverage
    - uses: actions/upload-artifact@v4
      if: always()
      with:
        name: coverage-report
        path: coverage/
        retention-days: 7
```

- **Purpose**: Full test suite execution with coverage reporting
- **Coverage Thresholds**: (to be enforced via `vitest.config.ts`)
  - Statements: 80%
  - Branches: 75%
  - Functions: 80%
  - Lines: 80%
- **Failure Handling**: Blocking; tests must pass or be fixed

**Job 4: E2E Tests (Playwright)**

```yaml
test-e2e:
  name: E2E Tests (Playwright)
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm
    - run: npm ci
    - run: npx playwright install --with-deps
    - run: npx playwright test
    - uses: actions/upload-artifact@v4
      if: ${{ !cancelled() }}
      with:
        name: playwright-report
        path: playwright-report/
        retention-days: 14
```

- **Purpose**: End-to-end user journey validation in real browsers
- **Browsers**: Chromium, Firefox, WebKit (parallel execution)
- **Test Strategy**: Critical user paths only (import, analysis, export)
- **Failure Handling**: Blocking; E2E failures indicate broken user experience

**Timing**: All four jobs complete in ~3–5 minutes (parallel execution).

#### 3.2.2 Build Job (Stage 2)

Runs **only after all Stage 1 jobs pass**:

```yaml
build:
  name: Build
  runs-on: ubuntu-latest
  needs: [audit, lint, test-unit, test-e2e]
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm
    - run: npm ci
    - run: npm run build
    - uses: actions/upload-pages-artifact@v3
      with:
        path: dist/
```

- **Purpose**: Produce production-ready bundle
- **Expected Duration**: ~30–60 seconds
- **Failure Handling**: Rare (type errors caught in Stage 1); indicates build configuration issue

#### 3.2.3 Deploy Job (Stage 3)

Runs **only on `main` branch after successful build**:

```yaml
deploy:
  name: Deploy to GitHub Pages
  if: github.ref == 'refs/heads/main' && github.event_name == 'push'
  needs: build
  runs-on: ubuntu-latest
  environment:
    name: github-pages
    url: ${{ steps.deployment.outputs.page_url }}
  steps:
    - id: deployment
      uses: actions/deploy-pages@v4
```

- **Purpose**: Atomic deployment to production (GitHub Pages)
- **Concurrency**: Only one deployment at a time (`concurrency.group: 'pages'`)
- **Rollback**: Via `git revert` + push to main (triggers new deployment)

### 3.3 Coverage Thresholds

**Configuration**: `vitest.config.ts`

```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/types.ts',
        'vite.config.ts',
      ],
    },
  },
});
```

**Enforcement**:

- CI blocks on coverage < threshold
- Coverage report uploaded as artifact for review
- Future: Coverage badges in README.md

**Exclusions**:

- Test files themselves (no need to test tests)
- Type definition files (pure types, no runtime behavior)
- Configuration files (low value, high maintenance)

### 3.4 Audit Checks

#### npm Audit

**Command**: `npm audit --audit-level=high`

**Policy**:

- **High/Critical vulnerabilities**: Blocking in CI
- **Moderate/Low vulnerabilities**: Logged but non-blocking (reviewed during dependency updates)

**Handling Process**:

1. Upgrade affected packages to patched versions
2. If no patch available, evaluate risk and document exception
3. If critical and unfixable, switch to alternative package

#### Dependabot Configuration

**File**: `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
    open-pull-requests-limit: 10
    reviewers:
      - kyle # Human product owner
    commit-message:
      prefix: chore
      prefix-development: chore
    groups:
      development-dependencies:
        dependency-type: development
      production-dependencies:
        dependency-type: production
```

**Process**:

1. Dependabot opens PRs weekly for dependency updates
2. CI runs full quality gate on each PR
3. Human product owner reviews and merges
4. AI agents do not auto-merge Dependabot PRs (security-critical decision)

---

## 4. Testing Pipeline

### 4.1 Unit Test Execution

**Tool**: Vitest

**Execution**:

- **Local (pre-commit)**: `npx vitest run --reporter=dot` (fast, minimal output)
- **CI**: `npx vitest run --coverage --reporter=verbose` (full report + coverage)

**Parallelization**: Vitest automatically parallelizes test files across CPU cores.

**Performance**:

- **Target**: < 10 seconds for full test suite
- **Current**: ~3–5 seconds (as of Feb 2026)

**Configuration**: `vitest.config.ts`

```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      // ... (see Section 3.3)
    },
    poolOptions: {
      threads: {
        singleThread: false, // Enable parallelization
        useAtomics: true,
      },
    },
  },
});
```

### 4.2 E2E Test Execution with Playwright

**Configuration**: `playwright.config.ts`

```typescript
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true, // Run tests in parallel
  forbidOnly: !!process.env.CI, // Fail CI if .only() left in tests
  retries: process.env.CI ? 2 : 0, // Retry flaky tests in CI
  workers: process.env.CI ? 2 : undefined, // Limit CI parallelism
  reporter: process.env.CI
    ? [['html'], ['github']] // HTML report + GitHub annotations
    : [['list']], // Simple list for local dev
  use: {
    baseURL: 'http://localhost:5173', // Vite dev server
    trace: 'on-first-retry', // Capture trace on failures
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

**CI Execution**:

1. Install browsers: `npx playwright install --with-deps` (~2 minutes, cached)
2. Start dev server: Vite serves application on localhost:5173
3. Run tests: `npx playwright test` (parallel across 3 browsers, ~2–5 minutes)
4. Generate report: HTML report with videos/screenshots of failures
5. Upload report: Stored as CI artifact for 14 days

**Test Strategy**:

- **Critical User Paths**: Import data, view dashboard, analyze session, export results
- **Browser Coverage**: Chromium (Chrome/Edge), Firefox, WebKit (Safari)
- **Parallelization**: Tests run in parallel workers for speed
- **Retry Logic**: Flaky tests auto-retry 2× in CI (prevents false negatives)

**Performance**:

- **Target**: < 5 minutes for full E2E suite across all browsers
- **Current**: ~3–4 minutes (as of Feb 2026)

### 4.3 Test Result Reporting

**Unit Tests**:

- **Local**: Dot reporter (fast feedback)
- **CI**: Verbose reporter with coverage summary in GitHub Actions logs

**E2E Tests**:

- **Local**: List reporter (live progress)
- **CI**:
  - GitHub reporter (inline annotations on PR)
  - HTML report uploaded as artifact
  - Screenshots/videos of failures attached to report

**Viewing Reports**:

```bash
# Download Playwright report artifact from GitHub Actions
# Unzip and open locally
npx playwright show-report path/to/playwright-report
```

### 4.4 Coverage Reporting

**Format**: HTML + LCOV

**Storage**:

- HTML report: CI artifact (7-day retention)
- LCOV: Future integration with coverage tracking service (TBD)

**Viewing**:

```bash
# After running tests locally
npm run test:coverage
# Open coverage/index.html in browser
```

**Trends**: Manual review of coverage artifacts to track trends over time. Future: Automated coverage diff on PRs.

### 4.5 Performance Benchmarking

**Status**: Not yet implemented

**Future Plan**:

1. **Tool**: Vitest's `bench` API for microbenchmarks
2. **Metrics**:
   - EDF parsing time (single file)
   - Analysis computation time (1-year nightly aggregates)
   - Chart rendering time (1M data points, downsampled)
3. **Storage**: Benchmark results stored as CI artifacts
4. **Alerts**: Performance regressions > 20% trigger review flag

**Example Benchmark** (future):

```typescript
import { bench, describe } from 'vitest';
import { parseEDF } from './edf-parser';
import { readFixture } from './test-utils';

describe('EDF Parsing Performance', () => {
  bench(
    'parse single-night EDF',
    async () => {
      const data = await readFixture('sample-brp.edf');
      await parseEDF(data);
    },
    { iterations: 100 },
  );
});
```

---

## 5. Deployment Strategy

### 5.1 Platform: GitHub Pages

**URL**: `https://<username>.github.io/cpap-analyzer/`

**Rationale**:

- **Zero Cost**: Free for public repositories
- **HTTPS by Default**: Automatic SSL via GitHub
- **CDN Distribution**: Global edge network for fast delivery
- **Atomic Deployments**: All-or-nothing deploys (no partial state)
- **Simple Configuration**: Native GitHub Actions integration

**Alternatives Considered**:

- **Netlify**: Excellent platform but adds external dependency and potential cost
- **Vercel**: Similar to Netlify, no compelling advantage for static site
- **Cloudflare Pages**: Good performance but GitHub Pages is simpler for GitHub-hosted repos

**Decision**: GitHub Pages is optimal for a static, client-side application hosted on GitHub.

### 5.2 Production Deployment Process

**Trigger**: Push to `main` branch (after successful build)

**Workflow**:

```yaml
deploy:
  name: Deploy to GitHub Pages
  if: github.ref == 'refs/heads/main' && github.event_name == 'push'
  needs: build
  runs-on: ubuntu-latest
  environment:
    name: github-pages
    url: ${{ steps.deployment.outputs.page_url }}
  steps:
    - id: deployment
      uses: actions/deploy-pages@v4
```

**Process**:

1. Build job uploads `dist/` as Pages artifact
2. Deploy job picks up artifact and deploys to GitHub Pages
3. GitHub's CDN propagates new version globally (~1–2 minutes)
4. Old version is atomically replaced (no mixed state)

**Concurrency Control**:

```yaml
concurrency:
  group: 'pages'
  cancel-in-progress: true
```

- Ensures only one deployment runs at a time
- If a new push occurs during deployment, previous deploy is cancelled
- Prevents race conditions and deployment conflicts

**Deployment Time**: ~1–2 minutes from merge to live

### 5.3 Preview Deployments for PRs

**Status**: Not yet implemented

**Future Plan**: Netlify or Vercel PR previews for pre-merge testing

**Proposed Workflow**:

1. PR opened → Netlify/Vercel builds preview from PR branch
2. Preview URL posted as PR comment
3. QA agent reviews preview before approving merge
4. Preview deleted when PR closed/merged

**Benefits**:

- Visual review of UI changes before merge
- E2E testing in production-like environment
- Stakeholder feedback without merging

**Implementation**: Separate GitHub Actions workflow with Netlify/Vercel CLI.

### 5.4 Rollback Procedures

**Method**: Git revert + push to `main`

**Process**:

1. Identify problematic commit
2. `git revert <commit-hash>`
3. `git push origin main`
4. CI/CD pipeline runs, deploys reverted state

**Rollback Time**: ~3–5 minutes (full CI pipeline + deployment)

**Alternative (Urgent Hotfix)**:

1. Revert locally
2. Cherry-pick urgent fix
3. Push to `main`
4. CI/CD validates and deploys

**No Manual Deployments**: All deployments go through CI/CD. No direct GitHub Pages settings updates.

### 5.5 Environment Configuration

**Environments**:

- **Development**: Local dev server (`npm run dev`)
- **Preview**: PR preview builds (future)
- **Production**: GitHub Pages (`main` branch)

**Configuration Strategy**: No environment-specific configuration needed (client-side only, no backend).

**Build Modes**:

- `development`: Source maps, hot reload, verbose errors
- `production`: Minified, hashed, optimized, no source maps deployed

**Environment Variables**: None required (no API keys, all local processing).

**Feature Flags**: Not currently used. Future: LocalStorage-based flags for experimental features.

---

## 6. Release Automation

### 6.1 Versioning: Calendar Versioning (CalVer)

**Format**: `YYYY.0M.MICRO`

- `YYYY`: Full year (e.g., `2026`)
- `0M`: Zero-padded month (`01`–`12`)
- `MICRO`: Incremental patch within month, starting at `0`

**Examples**:

- `2026.02.0` — First release of February 2026
- `2026.02.1` — Second release of February 2026
- `2026.03.0` — First release of March 2026

**Rationale** (from `.claude/skills/calver-release/SKILL.md`):

- Time-based versioning suits continuous delivery model
- No semantic meaning required (no external API consumers)
- Clear temporal ordering for user support ("Which version?" → "February 2026")

### 6.2 Release Process

**Current Process** (Manual):

1. **Pre-release Checks**:
   - Ensure all CI checks pass on `main`
   - Review `CHANGELOG.md` for completeness
   - Verify no open P0/P1 bugs

2. **Version Bump**:
   - Update `package.json`: `"version": "YYYY.0M.MICRO"`
   - Update `CHANGELOG.md`: Move `[Unreleased]` items to new version header
   - Commit: `chore: release YYYY.0M.MICRO`

3. **Tagging**:

   ```bash
   git tag vYYYY.0M.MICRO
   git push origin vYYYY.0M.MICRO
   ```

4. **GitHub Release Creation**:
   - Go to GitHub Releases
   - Create new release from tag
   - Copy changelog section as release notes
   - Publish release

5. **Deployment**:
   - Push to `main` (if not already)
   - CI/CD deploys to GitHub Pages automatically

**Duration**: ~5–10 minutes (manual steps)

### 6.3 Automated Release (Future)

**Goal**: Automate version bumping, changelog updates, tagging, and GitHub release creation.

**Proposed Tool**: `release-please` (Google's release automation tool)

**Workflow** (Future):

```yaml
name: Release Please

on:
  push:
    branches: [main]

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          release-type: simple
          versioning: calendar
          changelog-path: CHANGELOG.md
          package-name: cpap-analyzer
```

**Benefits**:

- Automatic version calculation based on CalVer
- Automatic changelog updates from commit messages
- Automatic GitHub release creation with notes
- Atomic: One PR merges version bump + changelog + tag

**Implementation**: Phase 2 (after initial release cycle stabilizes)

### 6.4 Changelog Management

**Format**: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

**Structure**:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Calendar Versioning](https://calver.org/).

## [Unreleased]

### Added

- New feature X

### Changed

- Modified behavior Y

### Fixed

- Bug fix Z

## [2026.02.0] - 2026-02-15

### Added

- Initial release
- EDF import from SD card
- Nightly aggregate dashboard
- Session detail view
```

**Categories**:

- `Added`: New features
- `Changed`: Changes to existing functionality
- `Deprecated`: Soon-to-be-removed features
- `Removed`: Removed features
- `Fixed`: Bug fixes
- `Security`: Security vulnerability patches

**Maintenance**:

- Developers (AI agents) add entries to `[Unreleased]` section in commit messages
- Release process moves entries to versioned section
- Commit message format (Conventional Commits) guides categorization

### 6.5 Release Notes Creation

**Current**: Manual copy-paste from `CHANGELOG.md` to GitHub Release

**Future**: Automated via `release-please`:

- Changelog section automatically used as release notes
- GitHub Release created with tag and notes
- Assets (none needed, web app) can be attached if required

---

## 7. Monitoring and Alerts

### 7.1 Build Failure Notifications

**Mechanism**: GitHub Actions + GitHub Notifications

**Current**:

- Email notifications to repository watchers on CI failure
- GitHub UI shows failing CI status on PRs and commits

**Future Enhancements**:

1. **Slack Integration**: Post build failures to dedicated channel
2. **Discord Webhook**: Alternative for teams using Discord
3. **Custom Script**: Parse CI logs and generate actionable failure summaries

**Configuration** (Future):

```yaml
- name: Notify on Failure
  if: failure()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    text: 'Build failed on ${{ github.ref }}'
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

### 7.2 Security Vulnerability Alerts

**Dependabot Security Alerts**:

- **Enabled**: Yes (GitHub Security tab)
- **Frequency**: Real-time alerts on new CVEs
- **Visibility**: Security tab + email notifications
- **Action**: Dependabot auto-creates PRs for patched versions

**GitHub Advanced Security** (Optional):

- **Code Scanning**: CodeQL analysis for TypeScript vulnerabilities (future)
- **Secret Scanning**: Detects accidentally committed secrets (enabled by default for public repos)

**Manual Audits**:

- Weekly `npm audit` review (part of dependency update process)
- Quarterly security architecture review (Security agent)

### 7.3 Bundle Size Regression Alerts

**Current**: Manual review of bundle size visualization after builds

**Future**: Automated regression detection

**Proposed Tool**: `bundlesize` or `size-limit`

**Configuration** (Future `package.json`):

```json
{
  "bundlesize": [
    {
      "path": "dist/assets/*.js",
      "maxSize": "250 KB",
      "compression": "gzip"
    },
    {
      "path": "dist/assets/*.css",
      "maxSize": "30 KB",
      "compression": "gzip"
    }
  ]
}
```

**Workflow Integration**:

```yaml
- name: Check Bundle Size
  run: npx bundlesize
```

**Action on Regression**:

- CI fails if bundle exceeds threshold
- PR comment shows size increase
- Developer must justify or reduce bundle size

### 7.4 No Runtime Monitoring

**Explicit Decision**: No runtime monitoring services per privacy architecture.

**Prohibited**:

- Error tracking (Sentry, Bugsnag, Rollbar)
- Performance monitoring (New Relic, Datadog)
- Session replay (LogRocket, FullStory)
- Analytics (Google Analytics, Mixpanel)

**Rationale**: These services transmit user data to external servers, violating zero-trust privacy model.

**Alternative**: Client-side error logging to console. Users can manually export logs for bug reports.

---

## 8. Client-Side Logging & Observability

### 8.1 Privacy-First Observability Philosophy

**Core Principle**: **Zero external telemetry while maintaining complete debuggability**.

Per [ADR-0015: Zero Telemetry & Analytics](../decisions/0015-zero-telemetry-analytics.md), CPAP Analyzer does not transmit any data to external servers. This extends to error tracking, performance monitoring, and usage analytics. However, production issues still occur and must be debuggable.

**Solution**: User-controlled, privacy-safe log export system.

**Key Requirements**:

1. **No Automatic Reporting**: Logs never leave the user's browser automatically
2. **User Consent**: Log export requires explicit user action (button click)
3. **Privacy-Safe Sanitization**: PHI and sensitive data stripped before export
4. **Technical Completeness**: Sufficient detail for developers to diagnose issues
5. **Zero Performance Impact**: Logging must not degrade application responsiveness

**Design Trade-offs**:

- **Loss**: Real-time error tracking, automatic crash reports, usage analytics
- **Gain**: Complete privacy, user trust, regulatory simplicity
- **Mitigation**: Comprehensive structured logging + easy export workflow

### 8.2 Structured Logging Implementation

#### 8.2.1 Logging Library Choice

**Selected Library**: **Custom logger** (thin wrapper around `console`)

**Rationale**:

- **Simplicity**: No external dependencies for core logging
- **Performance**: Native `console` methods are highly optimized
- **Control**: Full ownership of log format and sanitization
- **Structured Output**: Can still produce JSON-structured logs
- **Browser DevTools Integration**: Logs appear natively in console

**Alternative Considerations**:

- **`loglevel`**: Lightweight, but limited structure support
- **`debug`**: Excellent filtering, but no built-in structure
- **`winston`/`bunyan`**: Node.js-focused, too heavy for client-side
- **`pino`**: Performance-focused, but still Node.js-oriented

**Decision**: Custom logger provides the best balance of simplicity, performance, and control.

#### 8.2.2 Log Levels

**Hierarchy** (least to most verbose):

| Level   | Severity              | Production Default | Development Default | Use Cases                                                      |
| ------- | --------------------- | ------------------ | ------------------- | -------------------------------------------------------------- |
| `ERROR` | Critical failures     | ✅ Enabled         | ✅ Enabled          | Unhandled exceptions, critical errors, data corruption         |
| `WARN`  | Recoverable issues    | ✅ Enabled         | ✅ Enabled          | Deprecated features, missing optional data, fallback behaviors |
| `INFO`  | Significant events    | ❌ Disabled        | ✅ Enabled          | User actions, data loaded, analysis complete                   |
| `DEBUG` | Developer diagnostics | ❌ Disabled        | ✅ Enabled          | Function entry/exit, state changes, algorithm steps            |
| `TRACE` | Fine-grained detail   | ❌ Disabled        | ❌ Disabled         | Loop iterations, individual data points (use sparingly)        |

**Level Selection Guidelines**:

- **ERROR**: Always log. User will see in exported logs.
- **WARN**: Log by default. May indicate future problems.
- **INFO**: Disable in production to reduce log volume. Enable during debugging.
- **DEBUG**: Only for active troubleshooting. Not captured in production.
- **TRACE**: Rarely useful. Can generate massive log volume. Avoid in hot paths.

#### 8.2.3 Structured Log Format

**Format**: JSON-serializable object with consistent schema

**Schema**:

```typescript
interface LogEntry {
  timestamp: string; // ISO 8601: "2026-02-10T14:32:45.123Z"
  level: LogLevel; // "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE"
  category: LogCategory; // "UI" | "Storage" | "Analysis" | etc.
  message: string; // Human-readable message
  context?: Record<string, unknown>; // Structured metadata
  error?: {
    // Present for ERROR level
    name: string;
    message: string;
    stack?: string;
  };
}

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

type LogCategory =
  | 'UI' // React components, routing, user interactions
  | 'Storage' // IndexedDB, OPFS, data persistence
  | 'Analysis' // Data analysis algorithms, statistics
  | 'Worker' // Web Worker communication and tasks
  | 'Plugin' // Plugin loading, execution, errors
  | 'Import' // File import, EDF parsing, data validation
  | 'Export' // Data export, file generation
  | 'System'; // Browser features, initialization, lifecycle
```

**Example Log Entries**:

```typescript
// ERROR: Storage operation failed
{
  timestamp: "2026-02-10T14:32:45.123Z",
  level: "ERROR",
  category: "Storage",
  message: "Failed to save session data to IndexedDB",
  context: {
    operation: "put",
    storeName: "sessions",
    recordId: "session-abc123"
  },
  error: {
    name: "QuotaExceededError",
    message: "The quota has been exceeded.",
    stack: "Error: The quota has been exceeded.\n    at IDBObjectStore..."
  }
}

// INFO: Analysis complete
{
  timestamp: "2026-02-10T14:33:12.456Z",
  level: "INFO",
  category: "Analysis",
  message: "AHI analysis completed successfully",
  context: {
    nightId: "2026-02-09",
    eventsDetected: 42,
    duration: "7h 32m",
    processingTime: 1234
  }
}

// DEBUG: Worker task started
{
  timestamp: "2026-02-10T14:33:10.000Z",
  level: "DEBUG",
  category: "Worker",
  message: "Started analysis worker task",
  context: {
    workerId: "worker-1",
    taskType: "ahi-calculation",
    inputSize: 1048576
  }
}
```

#### 8.2.4 Logger Implementation

**File**: `src/utils/logger.ts`

```typescript
import type { LogEntry, LogLevel, LogCategory } from './logger.types';

class Logger {
  private static instance: Logger;
  private logs: LogEntry[] = [];
  private maxLogs = 10000; // Prevent memory bloat
  private levelThresholds: Record<LogLevel, number> = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
    TRACE: 4,
  };
  private currentLevel: number;

  private constructor() {
    // Default: ERROR + WARN in production, INFO in development
    this.currentLevel = import.meta.env.PROD ? 1 : 2;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = this.levelThresholds[level];
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelThresholds[level] <= this.currentLevel;
  }

  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      ...(context && { context }),
      ...(error && {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      }),
    };

    // Store in memory
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift(); // Remove oldest log
    }

    // Output to console
    const consoleMethod =
      level === 'ERROR'
        ? 'error'
        : level === 'WARN'
          ? 'warn'
          : level === 'DEBUG' || level === 'TRACE'
            ? 'debug'
            : 'log';
    console[consoleMethod](`[${level}] [${category}] ${message}`, context || '', error || '');
  }

  error(
    category: LogCategory,
    message: string,
    error: Error,
    context?: Record<string, unknown>,
  ): void {
    this.log('ERROR', category, message, context, error);
  }

  warn(category: LogCategory, message: string, context?: Record<string, unknown>): void {
    this.log('WARN', category, message, context);
  }

  info(category: LogCategory, message: string, context?: Record<string, unknown>): void {
    this.log('INFO', category, message, context);
  }

  debug(category: LogCategory, message: string, context?: Record<string, unknown>): void {
    this.log('DEBUG', category, message, context);
  }

  trace(category: LogCategory, message: string, context?: Record<string, unknown>): void {
    this.log('TRACE', category, message, context);
  }

  getLogs(): LogEntry[] {
    return [...this.logs]; // Return copy to prevent external mutation
  }

  clearLogs(): void {
    this.logs = [];
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Convenience exports for category-specific loggers
export const createCategoryLogger = (category: LogCategory) => ({
  error: (message: string, error: Error, context?: Record<string, unknown>) =>
    logger.error(category, message, error, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    logger.warn(category, message, context),
  info: (message: string, context?: Record<string, unknown>) =>
    logger.info(category, message, context),
  debug: (message: string, context?: Record<string, unknown>) =>
    logger.debug(category, message, context),
  trace: (message: string, context?: Record<string, unknown>) =>
    logger.trace(category, message, context),
});

// Usage example:
// const log = createCategoryLogger('Storage');
// log.info('Session saved', { sessionId: '123' });
```

#### 8.2.5 Performance Considerations

**Logging in Critical Paths**:

- **Rule**: Never log in hot loops (> 1000 iterations/sec)
- **Exception**: Use `TRACE` level (disabled by default) for temporary debugging
- **Example**: Don't log every time-series data point during analysis

**Structured Context Serialization**:

- **Rule**: Keep context objects shallow (< 5 levels deep)
- **Rationale**: Deep object cloning is expensive
- **Mitigation**: Pass only essential fields, not entire objects

**Memory Management**:

- **Circular Buffer**: Fixed-size log array (10,000 entries default)
- **Rationale**: Prevents unbounded memory growth in long-running sessions
- **Impact**: Oldest logs discarded when limit reached

**Performance Budget**:

- Logging overhead: < 0.1ms per log statement (INFO or higher)
- Memory footprint: < 5 MB for full 10,000-entry log buffer

### 8.3 Log Filtering & Verbosity Control

#### 8.3.1 Debug Mode Toggle

**User Interface**: Settings panel → "Developer Options" section

**UI Component**:

```tsx
// src/components/Settings/DeveloperOptions.tsx
export function DeveloperOptions() {
  const [debugMode, setDebugMode] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<LogCategory[]>([]);

  const handleDebugModeToggle = (enabled: boolean) => {
    setDebugMode(enabled);
    logger.setLevel(enabled ? 'DEBUG' : 'WARN');

    if (enabled) {
      logger.info('System', 'Debug mode enabled');
    }
  };

  return (
    <div className="developer-options">
      <h3>Debug Logging</h3>

      <Switch
        checked={debugMode}
        onCheckedChange={handleDebugModeToggle}
        label="Enable Debug Mode"
      />

      {debugMode && (
        <CategoryFilter categories={selectedCategories} onChange={setSelectedCategories} />
      )}

      <ExportLogsButton />
    </div>
  );
}
```

#### 8.3.2 Per-Category Verbosity Control

**Feature**: Enable DEBUG logging for specific categories only

**Use Case**: "I want to debug storage issues without seeing all UI logs"

**Implementation**:

```typescript
// Enhanced Logger with category filtering
class Logger {
  private categoryLevels: Partial<Record<LogCategory, number>> = {};

  setCategoryLevel(category: LogCategory, level: LogLevel): void {
    this.categoryLevels[category] = this.levelThresholds[level];
  }

  private shouldLog(level: LogLevel, category: LogCategory): boolean {
    // Check category-specific level first
    const categoryLevel = this.categoryLevels[category];
    if (categoryLevel !== undefined) {
      return this.levelThresholds[level] <= categoryLevel;
    }

    // Fall back to global level
    return this.levelThresholds[level] <= this.currentLevel;
  }
}

// Usage:
logger.setCategoryLevel('Storage', 'DEBUG'); // Enable DEBUG for Storage only
logger.setCategoryLevel('UI', 'WARN'); // Silence UI except warnings/errors
```

#### 8.3.3 Default Log Levels

**Production** (built with `NODE_ENV=production`):

```typescript
const PRODUCTION_DEFAULTS: Record<LogCategory, LogLevel> = {
  UI: 'WARN',
  Storage: 'WARN',
  Analysis: 'WARN',
  Worker: 'WARN',
  Plugin: 'WARN',
  Import: 'WARN',
  Export: 'WARN',
  System: 'ERROR', // Only critical system errors
};
```

**Development** (local dev server):

```typescript
const DEVELOPMENT_DEFAULTS: Record<LogCategory, LogLevel> = {
  UI: 'INFO',
  Storage: 'DEBUG',
  Analysis: 'INFO',
  Worker: 'DEBUG',
  Plugin: 'INFO',
  Import: 'INFO',
  Export: 'INFO',
  System: 'INFO',
};
```

#### 8.3.4 URL Parameter Override

**Feature**: Enable debug logging via URL parameter (for user support)

**Usage**: `https://cpap-analyzer.app/?debug=Storage,Analysis`

**Implementation**:

```typescript
// src/utils/logger-init.ts
function initializeLoggerFromURL() {
  const params = new URLSearchParams(window.location.search);
  const debugCategories = params.get('debug');

  if (debugCategories) {
    if (debugCategories === '*') {
      logger.setLevel('DEBUG');
      logger.info('System', 'Debug mode enabled for all categories via URL parameter');
    } else {
      const categories = debugCategories.split(',') as LogCategory[];
      categories.forEach((category) => {
        logger.setCategoryLevel(category, 'DEBUG');
        logger.info('System', `Debug mode enabled for category: ${category}`);
      });
    }
  }
}

// Call during app initialization
initializeLoggerFromURL();
```

### 8.4 Export Debug Logs Feature

#### 8.4.1 User Interface

**Location**: Settings → Developer Options → "Export Debug Logs" button

**Button Component**:

```tsx
// src/components/Settings/ExportLogsButton.tsx
export function ExportLogsButton() {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);

    try {
      const logData = await exportLogs();
      const blob = new Blob([logData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `cpap-analyzer-logs-${new Date().toISOString()}.json`;
      a.click();

      URL.revokeObjectURL(url);

      logger.info('System', 'Debug logs exported successfully');
    } catch (error) {
      logger.error('System', 'Failed to export debug logs', error as Error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button onClick={handleExport} disabled={isExporting} className="export-logs-button">
      {isExporting ? 'Exporting...' : 'Export Debug Logs'}
    </button>
  );
}
```

#### 8.4.2 Export Format

**File Format**: JSON with metadata + sanitized logs

**Schema**:

```typescript
interface LogExport {
  exportedAt: string; // ISO timestamp
  version: string; // Application version
  systemInfo: SystemInfo; // Browser/system details
  logCount: number; // Total number of logs
  sanitizationWarnings: string[]; // List of sanitized fields
  logs: LogEntry[]; // Sanitized log entries
}

interface SystemInfo {
  appVersion: string; // e.g., "2026.02.0"
  userAgent: string; // Browser UA
  platform: string; // "MacIntel", "Win32", etc.
  storageQuota: {
    usage: number; // Bytes used
    quota: number; // Total quota
  };
  features: {
    indexedDB: boolean;
    opfs: boolean;
    webWorkers: boolean;
    serviceWorker: boolean;
  };
  errorCounts: Record<LogCategory, number>; // Error count per category
}
```

**Example Export**:

```json
{
  "exportedAt": "2026-02-10T14:35:00.000Z",
  "version": "2026.02.0",
  "systemInfo": {
    "appVersion": "2026.02.0",
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
    "platform": "MacIntel",
    "storageQuota": {
      "usage": 52428800,
      "quota": 1099511627776
    },
    "features": {
      "indexedDB": true,
      "opfs": true,
      "webWorkers": true,
      "serviceWorker": false
    },
    "errorCounts": {
      "UI": 0,
      "Storage": 2,
      "Analysis": 0,
      "Worker": 1,
      "Plugin": 0,
      "Import": 0,
      "Export": 0,
      "System": 0
    }
  },
  "logCount": 1542,
  "sanitizationWarnings": [
    "File names redacted from Import logs",
    "Stack traces truncated to 3 frames"
  ],
  "logs": [
    {
      "timestamp": "2026-02-10T14:32:45.123Z",
      "level": "ERROR",
      "category": "Storage",
      "message": "Failed to save session data to IndexedDB",
      "context": {
        "operation": "put",
        "storeName": "sessions",
        "recordId": "[REDACTED]"
      },
      "error": {
        "name": "QuotaExceededError",
        "message": "The quota has been exceeded.",
        "stack": "Error: The quota has been exceeded.\n    at IDBObjectStore...\n    at async saveSession"
      }
    }
  ]
}
```

#### 8.4.3 Implementation

**File**: `src/utils/export-logs.ts`

```typescript
import { logger } from './logger';
import { sanitizeLogs } from './log-sanitization';
import { gatherSystemInfo } from './system-info';

export async function exportLogs(): Promise<string> {
  const logs = logger.getLogs();
  const sanitized = sanitizeLogs(logs);
  const systemInfo = await gatherSystemInfo();

  const exportData: LogExport = {
    exportedAt: new Date().toISOString(),
    version: import.meta.env.VITE_APP_VERSION || 'unknown',
    systemInfo,
    logCount: sanitized.logs.length,
    sanitizationWarnings: sanitized.warnings,
    logs: sanitized.logs,
  };

  return JSON.stringify(exportData, null, 2);
}
```

#### 8.4.4 User Prompt

**Privacy Notice**: Displayed before export

**Modal Content**:

```text
Export Debug Logs

This will export a JSON file containing:
✓ Application logs (errors, warnings, debug messages)
✓ System information (browser, version, available features)
✓ Error counts and timestamps

The following data is EXCLUDED:
✗ File names (which may contain patient names)
✗ Personal health information (PHI)
✗ Authentication tokens or credentials

All logs are sanitized for privacy. You can review the exported
file before sharing it with developers.

[Cancel]  [Export Logs]
```

### 8.5 System Information Capture

#### 8.5.1 System Info Collection

**File**: `src/utils/system-info.ts`

```typescript
interface SystemInfo {
  appVersion: string;
  userAgent: string;
  platform: string;
  storageQuota: {
    usage: number;
    quota: number;
  };
  features: {
    indexedDB: boolean;
    opfs: boolean;
    webWorkers: boolean;
    serviceWorker: boolean;
  };
  errorCounts: Record<LogCategory, number>;
}

export async function gatherSystemInfo(): Promise<SystemInfo> {
  const storageEstimate = (await navigator.storage?.estimate()) || { usage: 0, quota: 0 };
  const logs = logger.getLogs();

  // Count errors by category
  const errorCounts = logs
    .filter((log) => log.level === 'ERROR')
    .reduce(
      (acc, log) => {
        acc[log.category] = (acc[log.category] || 0) + 1;
        return acc;
      },
      {} as Record<LogCategory, number>,
    );

  return {
    appVersion: import.meta.env.VITE_APP_VERSION || 'unknown',
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    storageQuota: {
      usage: storageEstimate.usage || 0,
      quota: storageEstimate.quota || 0,
    },
    features: {
      indexedDB: 'indexedDB' in window,
      opfs: 'storage' in navigator && 'getDirectory' in navigator.storage,
      webWorkers: 'Worker' in window,
      serviceWorker: 'serviceWorker' in navigator,
    },
    errorCounts: {
      UI: errorCounts.UI || 0,
      Storage: errorCounts.Storage || 0,
      Analysis: errorCounts.Analysis || 0,
      Worker: errorCounts.Worker || 0,
      Plugin: errorCounts.Plugin || 0,
      Import: errorCounts.Import || 0,
      Export: errorCounts.Export || 0,
      System: errorCounts.System || 0,
    },
  };
}
```

#### 8.5.2 Feature Detection

**Purpose**: Identify which browser features are available

**Use Case**: Diagnose why storage or workers aren't functioning

**Implementation** (already in system-info.ts above):

```typescript
const features = {
  indexedDB: 'indexedDB' in window,
  opfs: 'storage' in navigator && 'getDirectory' in navigator.storage,
  webWorkers: 'Worker' in window,
  serviceWorker: 'serviceWorker' in navigator,
  webassembly: 'WebAssembly' in window,
  bigInt64Array: 'BigInt64Array' in window,
};
```

#### 8.5.3 Anonymized Error Counts

**Purpose**: Understand error patterns without exposing individual errors

**Privacy**: No error messages, only counts by category

**Use Case**: "This user has 50 Storage errors but zero UI errors" → focus on storage debugging

### 8.6 Privacy-Safe Log Sanitization

#### 8.6.1 Sanitization Rules

##### Rule 1: Strip File Names

- **Rationale**: File names may contain patient names (e.g., "John-Doe-2026-02-09.edf")
- **Action**: Replace with `[REDACTED-FILENAME]`
- **Exception**: File extensions preserved for debugging (e.g., `[REDACTED].edf`)

##### Rule 2: Redact Record IDs

- **Rationale**: Record IDs might be derived from patient data
- **Action**: Replace with `[REDACTED-ID]` or hash if needed for correlation

##### Rule 3: Truncate Stack Traces

- **Rationale**: Full stack traces can reveal internal details
- **Action**: Keep top 3 frames (enough for diagnosis, not excessive)

##### Rule 4: Remove Sensitive Context Fields

- **Rationale**: Context objects may contain PHI
- **Action**: Allowlist safe fields, reject others

##### Rule 5: Hash Plugin Names

- **Rationale**: User may have custom plugins with sensitive names
- **Action**: Replace with `plugin-<hash>` (preserves correlation)

#### 8.6.2 Sanitization Implementation

**File**: `src/utils/log-sanitization.ts`

```typescript
import type { LogEntry } from './logger.types';
import { createHash } from './hash-utils';

interface SanitizationResult {
  logs: LogEntry[];
  warnings: string[];
}

export function sanitizeLogs(logs: LogEntry[]): SanitizationResult {
  const warnings: string[] = [];
  const sanitized = logs.map((log) => sanitizeLogEntry(log, warnings));

  return { logs: sanitized, warnings: Array.from(new Set(warnings)) };
}

function sanitizeLogEntry(log: LogEntry, warnings: string[]): LogEntry {
  const sanitized = { ...log };

  // Sanitize message
  sanitized.message = sanitizeString(sanitized.message, warnings);

  // Sanitize context
  if (sanitized.context) {
    sanitized.context = sanitizeContext(sanitized.context, log.category, warnings);
  }

  // Truncate stack traces
  if (sanitized.error?.stack) {
    sanitized.error.stack = truncateStackTrace(sanitized.error.stack, 3);
    if (!warnings.includes('Stack traces truncated to 3 frames')) {
      warnings.push('Stack traces truncated to 3 frames');
    }
  }

  return sanitized;
}

function sanitizeString(str: string, warnings: string[]): string {
  // Remove file names (anything ending in .edf, .csv, etc.)
  const fileNamePattern = /[\w\-]+\.(edf|csv|json|txt)/gi;
  if (fileNamePattern.test(str)) {
    if (!warnings.includes('File names redacted from messages')) {
      warnings.push('File names redacted from messages');
    }
    return str.replace(fileNamePattern, '[REDACTED].$1');
  }

  return str;
}

function sanitizeContext(
  context: Record<string, unknown>,
  category: LogCategory,
  warnings: string[],
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  // Allowlist of safe fields per category
  const SAFE_FIELDS: Record<LogCategory, string[]> = {
    UI: ['component', 'action', 'route', 'duration'],
    Storage: ['operation', 'storeName', 'recordCount', 'databaseVersion'],
    Analysis: ['algorithm', 'duration', 'sampleCount', 'eventsDetected'],
    Worker: ['workerId', 'taskType', 'inputSize', 'outputSize', 'duration'],
    Plugin: ['pluginType', 'version', 'status'],
    Import: ['fileExtension', 'fileSize', 'recordCount', 'duration'],
    Export: ['format', 'recordCount', 'fileSize'],
    System: ['feature', 'status', 'version'],
  };

  const allowedFields = SAFE_FIELDS[category] || [];

  for (const [key, value] of Object.entries(context)) {
    if (allowedFields.includes(key)) {
      sanitized[key] = value;
    } else {
      // Redact but indicate what was removed
      sanitized[key] = '[REDACTED]';
      if (!warnings.includes(`Context field '${key}' redacted from ${category} logs`)) {
        warnings.push(`Context field '${key}' redacted from ${category} logs`);
      }
    }
  }

  return sanitized;
}

function truncateStackTrace(stack: string, maxFrames: number): string {
  const lines = stack.split('\n');
  if (lines.length <= maxFrames + 1) return stack;

  return [
    lines[0], // Error message line
    ...lines.slice(1, maxFrames + 1), // Top N frames
    `    ... (${lines.length - maxFrames - 1} more frames omitted)`,
  ].join('\n');
}
```

#### 8.6.3 Sanitization Validation

**Testing**: Unit tests verify sanitization effectiveness

**Test Cases**:

```typescript
// src/utils/log-sanitization.test.ts
describe('log sanitization', () => {
  it('redacts file names from messages', () => {
    const log: LogEntry = {
      timestamp: '2026-02-10T12:00:00.000Z',
      level: 'ERROR',
      category: 'Import',
      message: 'Failed to parse file: John-Doe-2026-02-09.edf',
    };

    const result = sanitizeLogs([log]);
    expect(result.logs[0].message).toBe('Failed to parse file: [REDACTED].edf');
    expect(result.warnings).toContain('File names redacted from messages');
  });

  it('redacts unsafe context fields', () => {
    const log: LogEntry = {
      timestamp: '2026-02-10T12:00:00.000Z',
      level: 'INFO',
      category: 'Storage',
      message: 'Session saved',
      context: {
        operation: 'put', // Safe
        storeName: 'sessions', // Safe
        patientId: '12345', // Unsafe!
        recordId: 'abc-123', // Unsafe!
      },
    };

    const result = sanitizeLogs([log]);
    expect(result.logs[0].context).toEqual({
      operation: 'put',
      storeName: 'sessions',
      patientId: '[REDACTED]',
      recordId: '[REDACTED]',
    });
  });

  it('truncates stack traces to 3 frames', () => {
    const log: LogEntry = {
      timestamp: '2026-02-10T12:00:00.000Z',
      level: 'ERROR',
      category: 'System',
      message: 'Unhandled exception',
      error: {
        name: 'TypeError',
        message: 'Cannot read property of undefined',
        stack: `Error: Cannot read property of undefined
    at func1 (file1.ts:10:5)
    at func2 (file2.ts:20:10)
    at func3 (file3.ts:30:15)
    at func4 (file4.ts:40:20)
    at func5 (file5.ts:50:25)`,
      },
    };

    const result = sanitizeLogs([log]);
    const frames = result.logs[0].error!.stack!.split('\n');
    expect(frames).toHaveLength(5); // Error line + 3 frames + omitted message
    expect(frames[4]).toMatch(/\(\d+ more frames omitted\)/);
  });
});
```

### 8.7 Integration Points

#### 8.7.1 Error Handling Integration

**Reference**: [error-handling-architecture.md](error-handling-architecture.md)

**Error Boundary Logging**:

```tsx
// src/components/ErrorBoundary.tsx (enhanced)
class ErrorBoundary extends React.Component<Props, State> {
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to structured logger
    logger.error('UI', 'React error boundary caught exception', error, {
      componentStack: errorInfo.componentStack,
      boundary: this.props.boundaryName,
    });

    // Still show user-friendly error UI
    this.setState({ hasError: true, error });
  }
}
```

**Global Error Handler**:

```typescript
// src/utils/global-error-handler.ts
window.addEventListener('error', (event) => {
  logger.error('System', 'Unhandled JavaScript error', event.error, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  logger.error('System', 'Unhandled promise rejection', event.reason, {
    promise: '[Promise object]',
  });
});
```

#### 8.7.2 Storage Architecture Integration

**Reference**: [storage-architecture.md](storage-architecture.md)

**IndexedDB Operation Logging**:

```typescript
// src/storage/indexeddb-wrapper.ts
async function put<T>(storeName: string, record: T): Promise<void> {
  const startTime = performance.now();
  const log = createCategoryLogger('Storage');

  try {
    log.debug('IndexedDB PUT operation started', {
      storeName,
      operation: 'put',
    });

    await db.put(storeName, record);

    const duration = performance.now() - startTime;
    log.info('IndexedDB PUT operation completed', {
      storeName,
      operation: 'put',
      duration: Math.round(duration),
    });
  } catch (error) {
    log.error('IndexedDB PUT operation failed', error as Error, {
      storeName,
      operation: 'put',
      errorName: (error as Error).name,
    });
    throw error;
  }
}
```

**OPFS Operation Logging**:

```typescript
// src/storage/opfs-wrapper.ts
async function writeFile(path: string, data: ArrayBuffer): Promise<void> {
  const log = createCategoryLogger('Storage');

  try {
    log.debug('OPFS write started', {
      path: '[REDACTED]', // Don't log actual paths
      size: data.byteLength,
    });

    await opfsHandle.write(data);

    log.info('OPFS write completed', {
      size: data.byteLength,
    });
  } catch (error) {
    log.error('OPFS write failed', error as Error, {
      size: data.byteLength,
      errorName: (error as Error).name,
    });
    throw error;
  }
}
```

#### 8.7.3 Web Worker Integration

**Reference**: [data-architecture.md](../data-architecture.md) → Web Workers section

**Worker Task Logging**:

```typescript
// src/workers/analysis-worker.ts
self.addEventListener('message', async (event) => {
  const log = createCategoryLogger('Worker');
  const { taskId, taskType, input } = event.data;

  log.debug('Worker task started', {
    workerId: self.name,
    taskId,
    taskType,
    inputSize: input.byteLength,
  });

  try {
    const result = await processTask(taskType, input);

    log.info('Worker task completed', {
      workerId: self.name,
      taskId,
      taskType,
      outputSize: result.byteLength,
    });

    self.postMessage({ taskId, result });
  } catch (error) {
    log.error('Worker task failed', error as Error, {
      workerId: self.name,
      taskId,
      taskType,
    });

    self.postMessage({ taskId, error: (error as Error).message });
  }
});
```

#### 8.7.4 Plugin Error Isolation

**Reference**: [plugin-architecture.md](../decisions/0007-plugin-architecture.md)

**Plugin Execution Logging**:

```typescript
// src/plugins/plugin-executor.ts
export async function executePlugin(plugin: Plugin, input: unknown): Promise<unknown> {
  const log = createCategoryLogger('Plugin');

  log.debug('Plugin execution started', {
    pluginName: plugin.name,
    pluginType: plugin.type,
    version: plugin.version,
  });

  try {
    const result = await plugin.execute(input);

    log.info('Plugin execution completed', {
      pluginName: plugin.name,
      pluginType: plugin.type,
    });

    return result;
  } catch (error) {
    log.error('Plugin execution failed', error as Error, {
      pluginName: plugin.name,
      pluginType: plugin.type,
      version: plugin.version,
    });

    // Re-throw to allow error boundary to handle
    throw error;
  }
}
```

### 8.8 Developer Workflow

#### 8.8.1 Requesting Logs from Users

**Standard Support Process**:

1. **User reports issue**: "Data analysis isn't working"

2. **Developer requests logs**:

   ```text
   Can you export your debug logs?

   1. Open Settings
   2. Scroll to "Developer Options"
   3. Enable "Debug Mode"
   4. Reproduce the issue
   5. Click "Export Debug Logs"
   6. Send the exported JSON file
   ```

3. **User exports logs**: Receives `cpap-analyzer-logs-2026-02-10T14-35-00Z.json`

4. **Developer analyzes logs**: Uses log analysis tools (see below)

5. **Developer diagnoses issue**: Identifies root cause from logs

6. **Developer fixes issue**: Implements fix, requests user to verify

#### 8.8.2 Log Analysis Tools

##### Tool 1: Log Viewer Script

**File**: `scripts/analyze-logs.ts` (development tool, not shipped)

```typescript
// Run with: npx tsx scripts/analyze-logs.ts path/to/logs.json

import fs from 'fs';
import type { LogExport, LogEntry } from '../src/utils/logger.types';

const logFile = process.argv[2];
if (!logFile) {
  console.error('Usage: npx tsx scripts/analyze-logs.ts <log-file.json>');
  process.exit(1);
}

const data: LogExport = JSON.parse(fs.readFileSync(logFile, 'utf-8'));

console.log('=== Log File Analysis ===\n');
console.log(`App Version: ${data.systemInfo.appVersion}`);
console.log(`Exported At: ${data.exportedAt}`);
console.log(`Total Logs: ${data.logCount}`);
console.log(`Platform: ${data.systemInfo.platform}`);
console.log(`User Agent: ${data.systemInfo.userAgent}\n`);

console.log('=== Error Counts by Category ===');
for (const [category, count] of Object.entries(data.systemInfo.errorCounts)) {
  if (count > 0) {
    console.log(`  ${category}: ${count} errors`);
  }
}

console.log('\n=== Recent Errors ===');
const errors = data.logs.filter((log) => log.level === 'ERROR').slice(-10);
errors.forEach((error) => {
  console.log(`\n[${error.timestamp}] [${error.category}]`);
  console.log(`  ${error.message}`);
  if (error.error) {
    console.log(`  ${error.error.name}: ${error.error.message}`);
  }
});

console.log('\n=== Storage Quota ===');
const quota = data.systemInfo.storageQuota;
const usagePercent = ((quota.usage / quota.quota) * 100).toFixed(1);
console.log(`  Used: ${(quota.usage / 1024 / 1024).toFixed(2)} MB`);
console.log(`  Total: ${(quota.quota / 1024 / 1024 / 1024).toFixed(2)} GB`);
console.log(`  Usage: ${usagePercent}%`);

console.log('\n=== Feature Detection ===');
for (const [feature, available] of Object.entries(data.systemInfo.features)) {
  console.log(`  ${feature}: ${available ? '✓' : '✗'}`);
}
```

##### Tool 2: Log Filtering Utilities

```typescript
// Filter logs by category
function filterByCategory(logs: LogEntry[], category: LogCategory): LogEntry[] {
  return logs.filter((log) => log.category === category);
}

// Find error patterns
function findErrorPatterns(logs: LogEntry[]): Map<string, number> {
  const patterns = new Map<string, number>();

  logs
    .filter((log) => log.level === 'ERROR')
    .forEach((log) => {
      const key = `${log.category}:${log.error?.name || 'Unknown'}`;
      patterns.set(key, (patterns.get(key) || 0) + 1);
    });

  return patterns;
}

// Timeline analysis
function analyzeTimeline(logs: LogEntry[]): void {
  const timeline = logs
    .filter((log) => log.level === 'ERROR' || log.level === 'WARN')
    .map((log) => ({
      time: new Date(log.timestamp),
      level: log.level,
      category: log.category,
      message: log.message,
    }));

  console.log('=== Error Timeline ===');
  timeline.forEach((event) => {
    console.log(
      `${event.time.toISOString()} [${event.level}] [${event.category}] ${event.message}`,
    );
  });
}
```

#### 8.8.3 Common Log Patterns

##### Pattern 1: Storage Quota Exceeded

**Symptoms in Logs**:

```json
{
  "level": "ERROR",
  "category": "Storage",
  "error": { "name": "QuotaExceededError" },
  "systemInfo": {
    "storageQuota": {
      "usage": 1099511627776,
      "quota": 1099511627776
    }
  }
}
```

**Diagnosis**: User has filled their storage quota

**Solution**: Prompt user to delete old sessions or increase quota

---

##### Pattern 2: OPFS Not Available

**Symptoms in Logs**:

```json
{
  "level": "WARN",
  "category": "Storage",
  "message": "OPFS not available, falling back to IndexedDB",
  "systemInfo": {
    "features": {
      "opfs": false
    }
  }
}
```

**Diagnosis**: Browser doesn't support OPFS (or is in private mode)

**Solution**: Already handled by fallback, but may affect performance

---

##### Pattern 3: Worker Communication Failure

**Symptoms in Logs**:

```json
{
  "level": "ERROR",
  "category": "Worker",
  "message": "Worker failed to respond within timeout",
  "context": {
    "taskType": "ahi-calculation",
    "timeout": 30000
  }
}
```

**Diagnosis**: Worker crashed or hung during analysis

**Solution**: Check for infinite loops or memory issues in worker code

---

##### Pattern 4: Plugin Load Failure

**Symptoms in Logs**:

```json
{
  "level": "ERROR",
  "category": "Plugin",
  "message": "Failed to load plugin",
  "error": {
    "name": "SyntaxError",
    "message": "Unexpected token"
  },
  "context": {
    "pluginName": "custom-analysis-plugin",
    "version": "1.0.0"
  }
}
```

**Diagnosis**: Plugin has syntax error or incompatible API version

**Solution**: Fix plugin code or update to compatible version

#### 8.8.4 Support FAQ

##### Q: User reports error but logs show nothing

**A**: Check:

1. Was debug mode enabled when issue occurred?
2. Did user reproduce the issue after enabling debug mode?
3. Is the user on an old app version without logging?

##### Q: How identify which storage backend (IndexedDB vs OPFS) was used?

**A**: Check `systemInfo.features.opfs` and look for "falling back to IndexedDB" warnings

##### Q: User's log file is 50 MB, too large to analyze

**A**:

1. This shouldn't happen (10,000 entry limit = ~5 MB max)
2. Check if context objects contain large data (bug in sanitization)
3. Ask user to reproduce with only ERROR+WARN levels enabled

##### Q: How to correlate logs across workers and main thread?

**A**: Use `taskId` or `sessionId` in context to correlate related logs

### 8.9 Testing & Validation

#### 8.9.1 Performance Testing

**Test**: Verify logging doesn't impact critical path performance

**Tools**: Vitest + `performance.now()`

**Test Cases**:

```typescript
// src/utils/logger.test.ts
describe('logger performance', () => {
  it('logs INFO message in < 0.1ms', () => {
    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      logger.info('UI', 'Test message', { iteration: i });
    }

    const duration = performance.now() - start;
    const avgDuration = duration / iterations;

    expect(avgDuration).toBeLessThan(0.1); // < 0.1ms per log
  });

  it('does not log below threshold (zero overhead)', () => {
    logger.setLevel('ERROR'); // Only ERROR level enabled

    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      logger.debug('UI', 'This should be skipped');
    }
    const duration = performance.now() - start;

    // Should be near-instant because logs are skipped early
    expect(duration).toBeLessThan(10); // < 10ms for 10,000 skipped logs
  });

  it('respects max log limit', () => {
    logger.clearLogs();

    // Log more than max (10,000)
    for (let i = 0; i < 15000; i++) {
      logger.info('System', `Log ${i}`);
    }

    const logs = logger.getLogs();
    expect(logs.length).toBeLessThanOrEqual(10000);
  });
});
```

#### 8.9.2 Sanitization Testing

**Test**: Verify sanitization removes sensitive data

**Test Cases** (already shown in section 8.6.3 above):

- File name redaction
- Context field filtering
- Stack trace truncation
- Plugin name hashing

#### 8.9.3 Export Format Validation

**Test**: Verify exported JSON is valid and complete

**Test Cases**:

```typescript
describe('log export', () => {
  it('produces valid JSON', async () => {
    const exported = await exportLogs();
    expect(() => JSON.parse(exported)).not.toThrow();
  });

  it('includes all required fields', async () => {
    const exported = await exportLogs();
    const data: LogExport = JSON.parse(exported);

    expect(data.exportedAt).toBeDefined();
    expect(data.version).toBeDefined();
    expect(data.systemInfo).toBeDefined();
    expect(data.logCount).toBeDefined();
    expect(data.sanitizationWarnings).toBeDefined();
    expect(data.logs).toBeDefined();
  });

  it('includes system info', async () => {
    const exported = await exportLogs();
    const data: LogExport = JSON.parse(exported);

    expect(data.systemInfo.appVersion).toBeDefined();
    expect(data.systemInfo.userAgent).toBeDefined();
    expect(data.systemInfo.features.indexedDB).toBeDefined();
  });
});
```

#### 8.9.4 Integration Testing

**Test**: Verify logging integrates correctly with error boundaries, storage, workers

**Test Cases**:

```typescript
describe('logging integration', () => {
  it('captures React error boundary exceptions', () => {
    const spy = vi.spyOn(logger, 'error');

    // Trigger React error boundary
    render(<ThrowingComponent />);

    expect(spy).toHaveBeenCalledWith(
      'UI',
      expect.stringContaining('error boundary'),
      expect.any(Error),
      expect.objectContaining({ boundary: expect.any(String) })
    );
  });

  it('captures storage operation failures', async () => {
    const spy = vi.spyOn(logger, 'error');

    // Simulate quota exceeded error
    await expect(storage.put('test', largeData)).rejects.toThrow(QuotaExceededError);

    expect(spy).toHaveBeenCalledWith(
      'Storage',
      expect.stringContaining('failed'),
      expect.any(Error),
      expect.objectContaining({ operation: 'put' })
    );
  });

  it('captures worker task failures', async () => {
    const spy = vi.spyOn(logger, 'error');

    // Send invalid task to worker
    await expect(worker.execute({ type: 'invalid' })).rejects.toThrow();

    expect(spy).toHaveBeenCalledWith(
      'Worker',
      expect.stringContaining('failed'),
      expect.any(Error),
      expect.objectContaining({ taskType: 'invalid' })
    );
  });
});
```

---

## 9. Development Tooling

### 8.1 Local Development Setup

**Prerequisites**:

- Node.js 22 (LTS)
- npm 10+
- Git

**Setup Steps**:

```bash
# Clone repository
git clone https://github.com/<org>/cpap-analyzer.git
cd cpap-analyzer

# Install dependencies
npm install

# Install pre-commit hooks
npx husky install

# Start dev server
npm run dev
```

**Dev Server URL**: `http://localhost:5173`

### 8.2 Hot Module Replacement (HMR)

**Tool**: Vite's built-in HMR

**Features**:

- **Fast Refresh**: React components update without full reload
- **State Preservation**: Component state retained during updates (where possible)
- **CSS HMR**: CSS changes apply instantly without reload
- **Error Overlay**: Compile errors displayed in-browser

**Performance**: < 100ms for typical component updates

### 8.3 Dev Server Configuration

**Configuration**: `vite.config.ts`

```typescript
export default defineConfig({
  server: {
    port: 5173,
    strictPort: false, // Try next port if 5173 is busy
    open: false, // Don't auto-open browser (agent-friendly)
    cors: true, // Allow CORS for local testing
    hmr: {
      overlay: true, // Show error overlay on HMR failures
    },
  },
  // ...
});
```

**HTTPS (Optional)**: For testing Service Worker features:

```typescript
server: {
  https: true,  // Vite generates self-signed cert
  // Or provide custom cert:
  https: {
    key: fs.readFileSync('path/to/key.pem'),
    cert: fs.readFileSync('path/to/cert.pem')
  }
}
```

### 8.4 Debug Configuration

**Browser DevTools**: Primary debugging interface

**VS Code Configuration** (`.vscode/launch.json`):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "chrome",
      "request": "launch",
      "name": "Launch Chrome against localhost",
      "url": "http://localhost:5173",
      "webRoot": "${workspaceFolder}/src",
      "sourceMapPathOverrides": {
        "webpack:///./*": "${webRoot}/*"
      }
    }
  ]
}
```

**Source Maps**:

- **Development**: Inline source maps for instant debugging
- **Production**: Separate `.map` files (not deployed, local debugging only)

**React DevTools**: Install browser extension for component inspection.

**TypeScript Debugging**: Full source-level debugging via source maps.

---

## 10. Dependency Management

### 9.1 Dependency Update Strategy

**Philosophy**: Stay reasonably up-to-date, but prioritize stability over bleeding-edge.

**Update Frequency**:

- **Security patches**: Immediate (via Dependabot alerts)
- **Minor/patch updates**: Weekly (via Dependabot PRs)
- **Major updates**: Quarterly review + manual testing

**Process**:

1. Dependabot opens PR with dependency update
2. CI runs full quality gate (tests, build, E2E)
3. Human product owner reviews changelog and impact
4. Merge if CI passes and no breaking changes observed

### 9.2 Automated Dependency Updates

**Tool**: Dependabot

**Configuration**: `.github/dependabot.yml`

```yaml
version: 2
updates:
  # npm dependencies
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
      time: '09:00'
      timezone: America/Los_Angeles
    open-pull-requests-limit: 10
    reviewers:
      - kyle # Human product owner
    assignees:
      - kyle
    commit-message:
      prefix: chore
      prefix-development: chore
      include: scope
    # Group updates to reduce PR spam
    groups:
      development-dependencies:
        dependency-type: development
        update-types:
          - minor
          - patch
      production-dependencies:
        dependency-type: production
        update-types:
          - patch
    # Ignore specific packages (if needed)
    ignore:
      # Example: Pin React to v18.x
      - dependency-name: 'react'
        update-types: ['version-update:semver-major']

  # GitHub Actions
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
    commit-message:
      prefix: ci
```

**Grouping Strategy**:

- **Development dependencies**: Batch minor/patch updates weekly
- **Production dependencies**: Individual patch updates, manual review for minors
- **GitHub Actions**: Monthly updates (low churn)

### 9.3 Version Pinning Strategy

**npm Lockfile**: `package-lock.json` (committed to git)

**Pinning Policy**:

- **Production dependencies**: Use caret ranges (`^1.2.3`) for flexibility
- **Development dependencies**: Use caret ranges (`^1.2.3`)
- **Known breaking packages**: Pin exact versions (`1.2.3`)

**Rationale**:

- Caret ranges allow automatic patch updates (security fixes)
- Lockfile pins transitive dependencies for reproducibility
- Exact pins only for problematic packages (rare)

**Reproducible Builds**:

- `npm ci` in CI (installs exact lockfile versions)
- `npm install` locally (may update within ranges)
- Lockfile changes reviewed in PRs

### 9.4 Dependency Review Process

**Automated Review** (via Dependabot):

1. Dependabot PR created
2. CI runs (tests, build, security audit)
3. Changelog link included in PR description
4. Human reviews changelog for breaking changes

**Manual Review** (for major updates):

1. Create feature branch
2. Update dependency manually
3. Run full test suite locally
4. Test critical user paths manually
5. Review bundle size impact
6. Open PR with detailed upgrade notes

**Rejection Criteria**:

- CI failures (tests, build, audit)
- Bundle size increase > 10% without justification
- Known breaking changes affecting behavior
- Insufficient testing/documentation of new version

### 9.5 License Compliance Checking

**Tool**: `license-checker` (to be integrated)

**Permitted Licenses**:

- MIT
- Apache-2.0
- BSD-2-Clause / BSD-3-Clause
- ISC
- CC0-1.0 (Public Domain)

**Prohibited Licenses**:

- GPL (copyleft, incompatible with MIT)
- AGPL (strong copyleft)
- Commercial/proprietary licenses

**Process** (Future):

```bash
# Add to CI
npx license-checker --summary --onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;CC0-1.0"
```

**Action on Violation**:

- CI fails
- Find alternative library with compatible license
- Document decision in ADR

---

## 11. Performance and Optimization

### 10.1 Build Performance Targets

| Metric              | Target  | Threshold |
| ------------------- | ------- | --------- |
| Clean build         | < 60s   | < 90s     |
| Incremental rebuild | < 10s   | < 20s     |
| Dev server startup  | < 3s    | < 5s      |
| HMR update          | < 100ms | < 300ms   |
| CI full pipeline    | < 5min  | < 8min    |

**Current Performance** (as of Feb 2026):

- Clean build: ~30s
- Dev server startup: ~2s
- HMR update: ~50ms
- CI full pipeline: ~4min

**Optimization Strategies**:

- **Vite Caching**: Leverages native ESM for fast dev server
- **npm Cache**: `actions/setup-node@v4` caches npm packages
- **Parallelization**: Independent CI jobs run in parallel
- **Build Artifacts**: Reuse build output across jobs (Pages artifact)

### 10.2 CI Pipeline Optimization

**Current Pipeline Structure**:

```
┌─────────────────────────────────────────────────────┐
│ Stage 1: Parallel Checks (~3–5 min)                 │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐│
│ │  Audit   │ │   Lint   │ │Unit Tests│ │E2E Tests ││
│ │  ~2 min  │ │  ~2 min  │ │  ~2 min  │ │ ~4 min   ││
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘│
└─────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────┐
        │ Stage 2: Build (~1 min)         │
        │ Waits for Stage 1 to complete   │
        └─────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────┐
        │ Stage 3: Deploy (~1 min)        │
        │ Only on main branch             │
        └─────────────────────────────────┘

Total: ~5–7 minutes (wall clock)
```

**Optimization Opportunities**:

1. **Playwright Caching**: Cache installed browsers (~2 GB) between runs
   - Benefit: ~2 min savings on E2E job
   - Implementation: `actions/cache@v4` for `~/.cache/ms-playwright`

2. **Split E2E Tests**: Run critical tests first, full suite after
   - Benefit: Faster feedback on high-impact failures
   - Trade-off: More complex workflow

3. **Conditional Jobs**: Skip E2E on docs-only changes
   - Benefit: ~4 min savings on documentation updates
   - Implementation: `paths-ignore` in workflow trigger

**Decision**: Implement Playwright caching (low-hanging fruit). Defer conditional jobs until test suite grows significantly.

---

## 12. Security Considerations

### 11.1 CI/CD Security Best Practices

**Secrets Management**:

- No secrets required for current deployment (GitHub Pages uses `GITHUB_TOKEN` automatically)
- Future secrets (if needed): Stored in GitHub Secrets, never logged

**Permissions**:

```yaml
permissions:
  contents: read # Read code
  pages: write # Deploy to Pages
  id-token: write # OIDC token for Pages
```

**Principle of Least Privilege**: Workflows only request necessary permissions.

**Third-Party Actions**: Only use actions from verified publishers (GitHub, official vendors).

### 11.2 Supply Chain Security

**npm Audit**: Blocks high/critical vulnerabilities in CI

**Dependabot Security Alerts**: Real-time notification of CVEs in dependencies

**Lock File Integrity**: `package-lock.json` committed and audited in PRs

**No Postinstall Scripts**: Avoid dependencies with postinstall scripts (attack vector)

**Future**: Implement [npm provenance](https://docs.npmjs.com/generating-provenance-statements) for published packages (if applicable).

### 11.3 Deployment Security

**GitHub Pages Security**:

- **HTTPS Enforced**: All traffic over TLS
- **Origin Isolation**: Runs on github.io subdomain (origin sandbox)
- **No Server-Side Code**: Static files only (no execution surface)

**Content Security Policy** (CSP):

- **Implemented in HTML**: `<meta>` tag or HTTP header via `_headers` file
- **Strict Policy**: No `unsafe-inline`, no `unsafe-eval`
- **Worker Isolation**: Web Workers run in isolated contexts

**Future Enhancement**: Subresource Integrity (SRI) for critical assets.

---

## 13. Disaster Recovery

### 12.1 Backup Strategy

**Code**: Git repository (primary: GitHub, developer clones as backup)

**CI/CD Configuration**: Version-controlled in `.github/workflows/`

**Build Artifacts**:

- **Short-term**: GitHub Actions artifacts (7–30 day retention)
- **Long-term**: Git tags + GitHub Releases

**No Data Backups Required**: Application is client-side; no server-side state.

### 12.2 Recovery Procedures

**Scenario 1: Broken Deployment**

- **Detection**: User reports or monitoring alerts
- **Action**: Git revert + push to `main` (see Section 5.4)
- **Time**: ~5 minutes (full CI/CD cycle)

**Scenario 2: CI Pipeline Failure (Infrastructure)**

- **Detection**: All jobs fail with "service unavailable"
- **Action**: Wait for GitHub Actions restoration (out of our control)
- **Workaround**: Local build + manual deployment (emergency only)

**Scenario 3: Compromised Dependency**

- **Detection**: npm audit or Dependabot alert
- **Action**:
  1. Revert to last known-good version
  2. Pin compromised package to safe version
  3. Open issue to track resolution
- **Time**: ~10–30 minutes

**Scenario 4: Lost Git Repository**

- **Likelihood**: Extremely low (GitHub's infrastructure)
- **Prevention**: Developer clones serve as distributed backups
- **Recovery**: Restore from any developer clone

### 12.3 Incident Response Plan

**Severity Levels**:

- **P0 (Critical)**: Production site down or major security vulnerability
- **P1 (High)**: Feature broken, data loss risk
- **P2 (Medium)**: Minor bug, degraded performance
- **P3 (Low)**: Cosmetic issue, documentation error

**P0 Response**:

1. **Immediate**: Rollback to last known-good version
2. **Within 1 hour**: Identify root cause
3. **Within 4 hours**: Deploy fix or workaround
4. **Within 24 hours**: RCA document published

**Communication**:

- GitHub Issues for tracking
- Project README for status updates (no external status page)

---

## 14. Continuous Improvement

### 13.1 Metrics to Track

**Build Metrics**:

- CI pipeline duration (target: < 5 min)
- Build failure rate (target: < 5% of commits)
- Flaky test rate (target: < 1% of E2E tests)

**Performance Metrics**:

- Bundle size over time (target: flat or decreasing)
- Build time over time (target: flat)
- Test suite duration (target: flat or decreasing)

**Security Metrics**:

- Dependency update latency (time from Dependabot PR to merge)
- Security vulnerability count (target: 0 high/critical)

**Collection**: Manual review of GitHub Actions logs and artifacts (no automated metrics service).

### 13.2 Planned Enhancements

**Short-term** (Next 3 months):

1. Implement Playwright browser caching
2. Add bundle size regression checks
3. Automate release process with `release-please`

**Medium-term** (Next 6 months):

1. Add performance benchmarking to CI
2. Implement PR preview deployments
3. Add visual regression testing (e.g., Percy, Chromatic)

**Long-term** (Next 12 months):

1. Optimize CI pipeline to < 3 min
2. Add Lighthouse CI for Core Web Vitals tracking
3. Implement automated dependency compatibility testing

### 13.3 Review Cadence

**Weekly**:

- Review Dependabot PRs
- Check for flaky tests

**Monthly**:

- Review CI metrics (duration, failure rate)
- Review bundle size trends
- Security audit of dependencies

**Quarterly**:

- DevOps architecture review
- Pipeline optimization sprint
- Tool/platform evaluation

---

## 15. Appendices

### 14.1 Tool Versions

| Tool           | Version  | Update Policy                |
| -------------- | -------- | ---------------------------- |
| Node.js        | 22 (LTS) | Follow LTS releases          |
| npm            | 10+      | Bundled with Node.js         |
| GitHub Actions | Latest   | Auto-updated by GitHub       |
| Vite           | 6.x      | Update minors, review majors |
| Vitest         | 2.x      | Update minors, review majors |
| Playwright     | 1.x      | Update minors monthly        |
| TypeScript     | 5.x      | Update minors, review majors |

### 14.2 Workflow File Inventory

| File                       | Purpose                      | Trigger  |
| -------------------------- | ---------------------------- | -------- |
| `.github/workflows/ci.yml` | Main CI/CD pipeline          | Push, PR |
| `.github/dependabot.yml`   | Automated dependency updates | Weekly   |

**Future Workflows**:

- `.github/workflows/release.yml` — Automated release process
- `.github/workflows/preview.yml` — PR preview deployments

### 14.3 CI/CD Pipeline Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  GitHub Repository                                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Push to main / Open PR                                │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  GitHub Actions CI/CD                                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Stage 1: Parallel Quality Checks                      │  │
│  │  ┌───────────┐  ┌───────────┐  ┌──────────┐  ┌──────┐ │  │
│  │  │Audit      │  │Lint       │  │Unit Test │  │E2E   │ │  │
│  │  │npm audit  │  │Prettier   │  │Vitest    │  │Play  │ │  │
│  │  │~2 min     │  │ESLint     │  │Coverage  │  │wright│ │  │
│  │  │           │  │TypeScript │  │~2 min    │  │~4min │ │  │
│  │  │           │  │~2 min     │  │          │  │      │ │  │
│  │  └───────────┘  └───────────┘  └──────────┘  └──────┘ │  │
│  └────────────────────────────────────────────────────────┘  │
│                          │                                    │
│                          ▼                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Stage 2: Build (only if Stage 1 passes)              │  │
│  │  - npm run build                                       │  │
│  │  - Bundle size analysis                                │  │
│  │  - Upload Pages artifact                               │  │
│  │  ~1 min                                                │  │
│  └────────────────────────────────────────────────────────┘  │
│                          │                                    │
│                          ▼                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Stage 3: Deploy (only if main branch)                │  │
│  │  - Deploy to GitHub Pages                              │  │
│  │  - Atomic deployment                                   │  │
│  │  ~1 min                                                │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  Production (GitHub Pages)                                   │
│  https://<user>.github.io/cpap-analyzer/                     │
│  - HTTPS enforced                                            │
│  - Global CDN                                                │
│  - Atomic updates                                            │
└──────────────────────────────────────────────────────────────┘
```

**Total Pipeline Time**: ~5–7 minutes (push to production)

---

## 16. References

- [Frontend Architecture](frontend-architecture.md)
- [Security Architecture](security-architecture.md)
- [Performance Strategy](performance-strategy.md)
- [Pre-commit Checks Skill](.claude/skills/pre-commit-checks/SKILL.md)
- [CalVer Release Skill](.claude/skills/calver-release/SKILL.md)
- [Playwright Testing Skill](.claude/skills/playwright-testing/SKILL.md)
- [Project Instructions (CLAUDE.md)](CLAUDE.md)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Vite Build Documentation](https://vitejs.dev/guide/build.html)
- [Vitest Configuration](https://vitest.dev/config/)
- [Playwright CI Documentation](https://playwright.dev/docs/ci)
- [Keep a Changelog](https://keepachangelog.com/)
- [Calendar Versioning](https://calver.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)

---

**Document Status**: ✅ Complete  
**Review Cycle**: Quarterly  
**Next Review**: May 2026  
**Owner**: DevOps Agent
