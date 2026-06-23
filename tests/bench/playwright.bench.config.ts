import { defineConfig, devices } from '@playwright/test';

/**
 * Dedicated Playwright config for the import-parallelization MEASUREMENT harness.
 *
 * Separate from the main `playwright.config.ts` (whose `testDir` is `tests/e2e`)
 * so the bench never runs in the normal e2e matrix. Single worker, no retries —
 * benchmarks must not run concurrently (they would contend for CPU/disk and
 * pollute timings) and a measurement is not a flaky gate to retry.
 *
 * Run on Chromium only (real OPFS + IndexedDB + Web Workers):
 *   npx playwright test --config tests/bench/playwright.bench.config.ts
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 15 * 60 * 1000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium-bench',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
