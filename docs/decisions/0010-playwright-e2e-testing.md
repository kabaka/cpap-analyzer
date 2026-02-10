# 0010 — Playwright for End-to-End Testing

## Status

Accepted

## Context

CPAP Analyzer requires end-to-end testing to validate complete user workflows across real browsers, including data import, dashboard interaction, session analysis, and report generation. E2E tests must verify that UI, data processing, storage, and visualization work correctly when integrated.

E2E testing requirements:

- Real browser testing: validate actual browser behavior, not simulated DOM
- Cross-browser support: Chromium (Chrome/Edge), Firefox, WebKit (Safari)
- File system interactions: import from SD card via File System Access API
- IndexedDB and OPFS validation: verify client-side storage works correctly
- Visual regression detection: catch unintended UI changes
- Accessibility testing: validate WCAG AA compliance with real assistive tech simulation
- Performance assertions: ensure operations complete within acceptable time
- Parallel execution: fast CI runs
- Artifact collection: screenshots, videos, traces for debugging failures

Critical constraints:

- E2E tests must run in < 5 minutes in CI for fast feedback
- Tests must be deterministic (no flakiness)
- Support GitHub Actions workflow integration
- Work with client-side-only architecture (no backend to mock)

Alternatives evaluated:

- **Cypress**: Popular, great developer experience, but limited to Chromium-based browsers (no real Firefox/Safari testing)
- **Selenium WebDriver**: Industry standard, broad language support, but slow, flaky, verbose API, heavy infrastructure
- **Puppeteer**: Fast, Chrome-focused, but Chromium-only (no Firefox/Safari), lower-level API requires more boilerplate
- **TestCafe**: Cross-browser without WebDriver, but slower than Playwright, smaller ecosystem
- **WebDriverIO**: modern WebDriver implementation, but complex configuration, slower than Playwright

## Decision

Adopt **Playwright** with TypeScript for end-to-end testing.

Playwright characteristics:

- Multi-browser: Chromium, Firefox, WebKit with consistent API
- Fast: parallel execution, fast test isolation with browser contexts
- Auto-wait: automatically waits for elements before actions, reducing flakiness
- Powerful selectors: CSS, text, ARIA role, custom test IDs
- Accessibility testing: built-in accessibility tree inspection
- Visual regression: screenshot comparison with baseline management
- Network interception: mock API responses for integration tests
- Artifacts: screenshots, videos, traces automatically captured on failure
- TypeScript-first: excellent type definitions
- CI-friendly: GitHub Actions integration, parallel workers

Browser matrix:

- **Primary: Chromium** (Chrome, Edge, Opera, Brave) — all tests
- **Secondary: Firefox, WebKit** — critical path tests only
- Full suite on all browsers runs nightly, not per-commit

Test organization:

```text
tests/e2e/
  critical-path/     # Must pass for release
  analysis/          # Advanced analysis features
  visualization/     # Chart interactions
  accessibility/     # WCAG AA compliance
  performance/       # Timing assertions
  integration/       # Third-party integrations
  fixtures/          # Test data (sample EDF files)
  pages/             # Page Object Model
    DashboardPage.ts
    SessionDetailPage.ts
```

Page Object Model:

- Encapsulate page interactions in classes
- Reusable methods for common operations
- Selectors centralized for maintainability
- Type-safe with TypeScript

Selector strategy:

- Prefer accessible selectors: `getByRole`, `getByLabel`, `getByText`
- Use `data-testid` for complex components without semantic roles
- Avoid CSS selectors tied to implementation (classnames)

## Consequences

### Positive

- Real browser testing catches issues that unit tests miss: layout, timing, browser APIs
- Multi-browser support validates cross-browser compatibility automatically
- Auto-wait reduces flakiness compared to manual wait/sleep patterns
- Parallel execution with browser contexts provides fast test runs (< 5 min for full suite)
- Accessibility tree inspection validates WCAG compliance with real assistive tech behavior
- Visual regression catches unintended UI changes not detectable by functional tests
- Artifact collection (screenshots, videos, traces) simplifies debugging failures in CI
- TypeScript support provides type safety for test code, reducing test bugs
- Page Object Model improves test maintainability and reduces duplication
- GitHub Actions integration works out-of-box with official Playwright action

### Negative

- Slower than unit tests: E2E suite takes 2-5 minutes vs < 10 seconds for unit tests
- Flakiness risk: network timing, animation timing, race conditions can cause intermittent failures (mitigated by auto-wait)
- Browser binaries: ~300 MB per browser, must be installed in CI (cached between runs)
- Visual regression baseline management: screenshots differ slightly across OS/browser versions
- Debugging complexity: failures in E2E tests harder to isolate than unit test failures
- Resource intensive: running full browser consumes more CPU/memory than unit tests
- CI parallelization limited: GitHub Actions free tier has limited concurrent jobs

### Neutral

- Tests require dev server running: `webServer` config auto-starts in CI, manual start in local dev
- Test data management: need sample EDF files in fixture folder, version-controlled
- Screenshot baselines stored in git, can bloat repository over time (use Git LFS if needed)
- E2E tests complement unit tests, don't replace them: need both for comprehensive coverage
