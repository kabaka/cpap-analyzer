# 0009 — Vitest for Unit Testing

## Status

Accepted

## Context

CPAP Analyzer requires a unit testing framework that integrates with the Vite build system, supports TypeScript and JSX/React, provides fast test execution for rapid iteration, and works well in CI/CD pipelines.

Testing requirements:

- Fast execution: full test suite must run in < 10 seconds for rapid feedback
- TypeScript and React support: test modern TypeScript features and React components
- ESM-native: work with ES modules without complex configuration
- Coverage reporting: track code coverage with thresholds enforced in CI
- Watch mode: enable rapid test-driven development
- Mocking capabilities: mock IndexedDB, OPFS, Web Workers, and other Web APIs
- CI integration: parallel execution, JUnit reports for GitHub Actions

Critical constraints:

- Pre-commit hook must complete in < 30 seconds (tests are part of this)
- AI agents must be able to write tests without deep framework knowledge
- Tests must be deterministic (no flakiness)
- Coverage thresholds: 80% lines, 80% functions, 75% branches

Alternatives evaluated:

- **Jest**: Industry standard, mature ecosystem, but slow ESM support, complex configuration for Vite projects, ~200ms startup overhead per test file
- **Mocha + Chai**: Flexible, mature, but requires manual setup of assertion library, mocking library, coverage tool; no React Testing Library integration out of box
- **AVA**: Fast, modern, but limited React support; small community; no built-in coverage
- **uvu**: Ultra-fast, minimal, but too low-level; no React support; requires extensive custom setup
- **Karma**: Browser-based testing, accurate but slow (~5-10s startup); overkill for unit tests (use Playwright for E2E)

## Decision

Adopt **Vitest** as the unit testing framework.

Vitest characteristics:

- Vite-native: shares Vite configuration, no separate build pipeline
- Fast: ~10-20× faster than Jest, < 10s for full suite, < 100ms per test file
- ESM-native: first-class ES module support without complex transforms
- Jest-compatible API: familiar `describe`, `it`, `expect`, `beforeEach` syntax
- V8 coverage: accurate, fast native code coverage
- Watch mode: reactive file watching with smart re-run
- TypeScript: zero-config TypeScript support
- Built-in mocking: `vi.mock()`, `vi.fn()`, `vi.spyOn()`
- React Testing Library integration: works seamlessly with `@testing-library/react`

Configuration:

- Environment: jsdom for DOM simulation
- Globals: enabled for familiar `describe`/`it`/`expect` without imports
- Coverage: V8 provider with 80% line/function, 75% branch thresholds
- Isolation: each test runs in isolated environment
- Parallel execution: multi-threaded test runner (1-4 threads)

Test structure:

```text
src/
  components/
    Button/
      Button.tsx
      Button.test.tsx
  utils/
    dateFormat.ts
    dateFormat.test.ts
  test/
    setup.ts           # Global test setup
    mocks/             # Shared mocks (IndexedDB, OPFS)
    fixtures/          # Test data fixtures
```

Mocking strategy:

- Mock IndexedDB and OPFS in global setup (not available in jsdom)
- Mock Web Workers with simple postMessage spy
- Mock Zustand stores by direct state manipulation in tests
- Use React Testing Library for component testing (no Enzyme)

## Consequences

### Positive

- Fast test execution (< 10s for full suite) enables rapid TDD workflow and quick CI feedback
- Vite integration eliminates configuration complexity and ensures tests use same build config as production
- Jest-compatible API reduces learning curve for AI agents trained on Jest examples
- ESM-native support avoids transform overhead and "require is not defined" errors
- V8 coverage is accurate (better than Istanbul) and fast
- Watch mode with HMR provides instant feedback during development
- TypeScript support with zero configuration
- Built-in mocking eliminates need for additional libraries (no jest-mock, sinon, etc.)
- Parallel execution utilizes multi-core systems for faster CI runs
- Small bundle (no test framework code in production build)

### Negative

- Smaller community than Jest, fewer Stack Overflow answers and examples
- Some Jest ecosystem plugins not compatible (though core features covered)
- jsdom limitations: no full browser environment, some Web APIs not available or partially implemented
- Mock ecosystem less mature than Jest (but sufficient for our needs)
- Breaking changes possible as Vitest is relatively young (v1.0 in 2023)
- AI training data heavily weighted to Jest syntax, though Vitest is compatible

### Neutral

- Must maintain separate mocks for jsdom limitations (IndexedDB, OPFS, Workers)
- Coverage thresholds enforced in CI can block merges if code changes without tests
- Vitest's watch mode requires proper `.gitignore` to avoid watching unnecessary files
- Test file collocation (next to source files) is encouraged but optional
