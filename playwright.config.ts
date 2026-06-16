import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
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
    // ── WebGL fidelity gate (ADR 0019, Stage 3) ──────────────────────────────
    // Headless Chromium with ANGLE + SwiftShader so a software WebGL2 context is
    // available on GPU-less CI runners. This project is targeted explicitly by
    // the `test-e2e-fidelity` CI job (RUN_FIDELITY=1) and is NOT part of the
    // normal e2e matrix above. The load-bearing flags are
    // `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
    // --ignore-gpu-blocklist`; the rest force WebGL on regardless of blocklists.
    {
      name: 'chromium-fidelity',
      use: {
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 2,
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
            '--enable-webgl',
            '--enable-features=Vulkan',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
