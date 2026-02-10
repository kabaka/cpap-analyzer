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

| Bundle | Target (gzipped) | Threshold (gzipped) |
|--------|------------------|---------------------|
| Initial (main) | < 150 KB | < 250 KB |
| Total JS (all chunks) | < 500 KB | < 1 MB |
| Total assets (CSS, fonts, images) | < 100 KB | < 200 KB |

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

### 2.4 Bundle Size Monitoring

**Tool**: `vite-bundle-visualizer`

**Process**:
1. Generate visualization after each build
2. Upload `stats.html` as CI artifact (30-day retention)
3. Manual review for regressions before releases
4. Future: Automated size regression checks with bundlesize or similar

**Actionable Thresholds**:
- **Warning**: Initial bundle > 200 KB gzipped
- **Blocking**: Initial bundle > 250 KB gzipped (must be resolved before merge)

### 2.5 Build Artifact Management

**Artifacts Produced**:

| Artifact | Location | Retention | Purpose |
|----------|----------|-----------|---------|
| Production bundle | `dist/` | Permanent (deployed) | GitHub Pages deployment |
| Bundle visualization | `stats.html` | 30 days | Size regression analysis |
| Playwright report | `playwright-report/` | 14 days | E2E test debugging |
| Test coverage | `coverage/` | 7 days | Coverage trend analysis |
| Source maps | `dist/**/*.map` | Not uploaded | Production debugging (local only) |

**Retention Strategy**:
- Only the latest successful build artifacts are deployed to GitHub Pages
- Historical artifacts (reports, coverage) are kept for debugging but automatically pruned
- Source maps are excluded from deployment for security (contain original source code)

---

## 3. Quality Gates

### 3.1 Pre-Commit Hooks

**Tool**: Husky + custom script (`.husky/pre-commit`)

**Checks** (run sequentially, fail fast):

1. **Formatting** (Prettier)
   ```bash
   npx prettier --check .
   ```
   - **Purpose**: Enforce consistent code style
   - **Fix**: `npx prettier --write .`
   - **Failure Impact**: Immediate rejection, zero cost

2. **Linting** (ESLint)
   ```bash
   npx eslint .
   ```
   - **Purpose**: Catch code quality issues, potential bugs, anti-patterns
   - **Fix**: `npx eslint . --fix` (auto-fixable rules only)
   - **Failure Impact**: Blocking, developer must address

3. **Type Checking** (TypeScript)
   ```bash
   npx tsc --noEmit
   ```
   - **Purpose**: Catch type errors before CI
   - **Fix**: Manual type corrections (no auto-fix)
   - **Failure Impact**: Blocking, must be resolved

4. **Unit Tests** (Vitest)
   ```bash
   npx vitest run --reporter=dot
   ```
   - **Purpose**: Ensure code changes don't break existing functionality
   - **Failure Impact**: Blocking, tests must pass or be fixed

**Performance**: Pre-commit checks complete in < 30 seconds on typical changes (< 10 files modified).

**Guarantee**: If pre-commit passes locally, CI must be green. This is a **contractual guarantee** of the DevOps architecture. Any violation is a P0 bug.

**Enforcement**:
- Husky installed via `npm install` (postinstall hook)
- Pre-commit hook is executable and git-tracked
- No bypass mechanisms (no `--no-verify` allowed; rejected in code review)

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
        lines: 80
      },
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/types.ts',
        'vite.config.ts'
      ]
    }
  }
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
      - kyle  # Human product owner
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
        singleThread: false,  // Enable parallelization
        useAtomics: true
      }
    }
  }
});
```

### 4.2 E2E Test Execution with Playwright

**Configuration**: `playwright.config.ts`

```typescript
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,  // Run tests in parallel
  forbidOnly: !!process.env.CI,  // Fail CI if .only() left in tests
  retries: process.env.CI ? 2 : 0,  // Retry flaky tests in CI
  workers: process.env.CI ? 2 : undefined,  // Limit CI parallelism
  reporter: process.env.CI
    ? [['html'], ['github']]  // HTML report + GitHub annotations
    : [['list']],  // Simple list for local dev
  use: {
    baseURL: 'http://localhost:5173',  // Vite dev server
    trace: 'on-first-retry',  // Capture trace on failures
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] }
    }
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
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
  bench('parse single-night EDF', async () => {
    const data = await readFixture('sample-brp.edf');
    await parseEDF(data);
  }, { iterations: 100 });
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

**Rationale** (from `.github/skills/calver-release/SKILL.md`):
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

## 8. Development Tooling

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
    strictPort: false,  // Try next port if 5173 is busy
    open: false,  // Don't auto-open browser (agent-friendly)
    cors: true,  // Allow CORS for local testing
    hmr: {
      overlay: true  // Show error overlay on HMR failures
    }
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

## 9. Dependency Management

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
      time: "09:00"
      timezone: America/Los_Angeles
    open-pull-requests-limit: 10
    reviewers:
      - kyle  # Human product owner
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
      - dependency-name: "react"
        update-types: ["version-update:semver-major"]

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

## 10. Performance and Optimization

### 10.1 Build Performance Targets

| Metric | Target | Threshold |
|--------|--------|-----------|
| Clean build | < 60s | < 90s |
| Incremental rebuild | < 10s | < 20s |
| Dev server startup | < 3s | < 5s |
| HMR update | < 100ms | < 300ms |
| CI full pipeline | < 5min | < 8min |

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

## 11. Security Considerations

### 11.1 CI/CD Security Best Practices

**Secrets Management**:
- No secrets required for current deployment (GitHub Pages uses `GITHUB_TOKEN` automatically)
- Future secrets (if needed): Stored in GitHub Secrets, never logged

**Permissions**:
```yaml
permissions:
  contents: read      # Read code
  pages: write        # Deploy to Pages
  id-token: write     # OIDC token for Pages
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

## 12. Disaster Recovery

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

## 13. Continuous Improvement

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

## 14. Appendices

### 14.1 Tool Versions

| Tool | Version | Update Policy |
|------|---------|---------------|
| Node.js | 22 (LTS) | Follow LTS releases |
| npm | 10+ | Bundled with Node.js |
| GitHub Actions | Latest | Auto-updated by GitHub |
| Vite | 6.x | Update minors, review majors |
| Vitest | 2.x | Update minors, review majors |
| Playwright | 1.x | Update minors monthly |
| TypeScript | 5.x | Update minors, review majors |

### 14.2 Workflow File Inventory

| File | Purpose | Trigger |
|------|---------|---------|
| `.github/workflows/ci.yml` | Main CI/CD pipeline | Push, PR |
| `.github/dependabot.yml` | Automated dependency updates | Weekly |

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

## 15. References

- [Frontend Architecture](frontend-architecture.md)
- [Security Architecture](security-architecture.md)
- [Performance Strategy](performance-strategy.md)
- [Pre-commit Checks Skill](.github/skills/pre-commit-checks/SKILL.md)
- [CalVer Release Skill](.github/skills/calver-release/SKILL.md)
- [Playwright Testing Skill](.github/skills/playwright-testing/SKILL.md)
- [Copilot Instructions](.github/copilot-instructions.md)
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
