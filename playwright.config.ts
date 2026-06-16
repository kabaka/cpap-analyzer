import { defineConfig, devices } from '@playwright/test';

/**
 * The WebGL fidelity gate spec. The `chromium-fidelity` project runs ONLY this
 * file; the normal `chromium`/`firefox`/`webkit` projects run everything EXCEPT
 * it. A glob (not a path) so it matches regardless of the project's working dir.
 */
const FIDELITY_SPEC = '**/webgl-fidelity-gate.spec.ts';

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
    // ── Normal e2e matrix ────────────────────────────────────────────────────
    // These run the WHOLE suite EXCEPT the WebGL fidelity gate, which is GPU-
    // dependent and lives in its own dedicated project/CI job below. We ignore it
    // here so the normal matrix never tries to run it (it is also internally
    // `RUN_FIDELITY`-gated via `test.skip`, so this is belt-and-suspenders).
    {
      name: 'chromium',
      testIgnore: FIDELITY_SPEC,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testIgnore: FIDELITY_SPEC,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: FIDELITY_SPEC,
      use: { ...devices['Desktop Safari'] },
    },
    // ── WebGL fidelity gate (ADR 0019, Stage 3) ──────────────────────────────
    // Headless Chromium with ANGLE + SwiftShader so a software WebGL2 context is
    // available on GPU-less CI runners. This project is targeted explicitly by
    // the `test-e2e-fidelity` CI job (RUN_FIDELITY=1) and is NOT part of the
    // normal e2e matrix above. It runs ONLY the fidelity spec (via `testMatch`)
    // so the gate is fast and unambiguous under the SwiftShader flags — it does
    // not drag the whole 200+ test suite through software GL. The load-bearing
    // flags are `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
    // --ignore-gpu-blocklist`; the rest force WebGL on regardless of blocklists.
    {
      name: 'chromium-fidelity',
      testMatch: FIDELITY_SPEC,
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
