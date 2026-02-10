---
name: playwright-testing
description: Write and run Playwright end-to-end tests. Use when creating E2E tests, debugging browser test failures, or testing user flows.
metadata:
  version: '1.0'
---

# Playwright E2E Testing

## Running Tests

```bash
# Run all E2E tests
npx playwright test

# Run with UI mode (interactive debugging)
npx playwright test --ui

# Run in headed mode (visible browser)
npx playwright test --headed

# Run a specific test file
npx playwright test tests/e2e/import.spec.ts

# Run with trace recording
npx playwright test --trace on

# View last test report
npx playwright show-report
```

## Test File Location

E2E tests live in `tests/e2e/` with the extension `.spec.ts`.

## Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test('should complete user journey', async ({ page }) => {
    await page.goto('/');

    // Interact using accessible selectors
    await page.getByRole('button', { name: 'Import Data' }).click();

    // Or use data-testid for stability
    await page.getByTestId('file-picker').setInputFiles('fixtures/sample.edf');

    // Assert outcomes
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});
```

## Selector Priority

1. `getByRole()` — Accessible role selectors (preferred)
2. `getByLabel()` — Form labels
3. `getByText()` — Visible text content
4. `getByTestId()` — `data-testid` attributes (for complex components)
5. CSS selectors — Last resort only

## Test Fixtures

Store test data files in `tests/fixtures/`:
- Sample EDF files (minimal, valid data)
- Expected output snapshots
- Configuration presets

## CI Configuration

Playwright in CI uses the `ci.yml` workflow which:
- Installs browsers: `npx playwright install --with-deps`
- Runs tests: `npx playwright test`
- Uploads reports as artifacts on failure
