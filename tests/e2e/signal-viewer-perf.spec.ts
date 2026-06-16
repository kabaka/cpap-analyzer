import { test, expect, type Page } from '@playwright/test';

/**
 * Signal Viewer — REAL-BROWSER pan/zoom performance probe (CI-only).
 *
 * WHY THIS EXISTS
 * ---------------
 * The Vitest benches (src/components/charts/canvas/__tests__/SignalRenderer.bench.test.ts)
 * measure jsdom-proxy-faithful metrics: draw-op counts and ArrayBuffer
 * allocations. Those are deterministic and reproduce the browser's algorithmic
 * work exactly — but jsdom has NO GPU rasterization and does NOT model real GC
 * pressure, so wall-clock frame time there is indicative only. THIS probe closes
 * that gap: it drives a real Chromium/Firefox/WebKit, performs scripted pan and
 * wheel-zoom gestures over the canvas, and records real frame timing via
 * `requestAnimationFrame` deltas (mean/p95 frame interval + long-frame count).
 *
 * The two perf wins it validates in a real engine:
 *   1. rAF-coalesced pan/wheel — many input events collapse to one paint/frame.
 *   2. LTTB buffer reuse — fewer per-frame allocations ⇒ fewer GC long-frames.
 *
 * GATING — CI ONLY
 * ----------------
 * This probe is skipped unless RUN_PERF_PROBE=1 (set it in the CI perf job). It
 * needs real signal data in OPFS to render waveforms; the standard E2E sandbox
 * seeds IndexedDB only (no OPFS signal chunks), so the chart shows a fallback
 * state and there is nothing to pan. When the chart IS present the probe records
 * and asserts frame health; when it is absent it asserts the fallback renders and
 * exits cleanly (never a silent pass). It also requires the dev server / preview
 * build to be reachable (the Playwright webServer config handles that).
 *
 * HOW TO RUN
 * ----------
 *   RUN_PERF_PROBE=1 npm run test:e2e -- signal-viewer-perf
 * Or target one engine:
 *   RUN_PERF_PROBE=1 npx playwright test signal-viewer-perf --project=chromium
 *
 * NOTE FOR THE SANDBOX: this environment cannot run Playwright (no browser
 * download / no display), so this spec is authored to CI conventions but is not
 * executed locally here. Run it in the CI perf job (or any machine with the
 * Playwright browsers installed).
 *
 * Data seeding mirrors sessions.spec.ts (version-less indexedDB.open).
 */

const RUN = process.env.RUN_PERF_PROBE === '1';

const DB_NAME = 'cpap-analyzer';
const MACHINE_ID = '23241654214';
const MACHINE_MODEL = 'AirSense 11 AutoSet';

/** Frame-interval budget: 60 fps ⇒ 16.7 ms; allow generous CI headroom. */
const FRAME_BUDGET_MS = 32; // ~30 fps floor for the p95 frame interval
/** A "long frame" exceeds ~2 dropped frames at 60 fps. */
const LONG_FRAME_MS = 50;

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function makeSession(id: string, date: string) {
  return {
    id,
    machineId: MACHINE_ID,
    machineModel: MACHINE_MODEL,
    machineType: 'cpap' as const,
    firmwareVersion: '3.0.2',
    date,
    startTime: `${date}T22:00:00Z`,
    endTime: `${date}T06:00:00Z`,
    durationMinutes: 480,
    usageMinutes: 420,
    importedAt: new Date().toISOString(),
    sourceHash: `hash-${id}`,
    channels: [],
    signalChunkIds: [],
    hasOximetry: false,
    deleted: false,
    machineSettings: null,
  };
}

async function injectSession(page: Page, session: ReturnType<typeof makeSession>): Promise<void> {
  await page.evaluate(
    ({ dbName, session }) => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(new Error('Failed to open database'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['sessions'], 'readwrite');
          tx.objectStore('sessions').put(session);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Transaction failed'));
          };
        };
      });
    },
    { dbName: DB_NAME, session },
  );
}

interface FrameStats {
  count: number;
  mean: number;
  p95: number;
  max: number;
  longFrames: number;
}

/**
 * Record requestAnimationFrame inter-frame intervals in the page while `action`
 * runs, then return summary stats. Captures the genuine browser frame cadence
 * during the scripted gesture (the metric jsdom cannot provide).
 */
async function recordFrames(page: Page, action: () => Promise<void>): Promise<FrameStats> {
  await page.evaluate(() => {
    const w = window as unknown as { __frameTimes: number[]; __frameStop?: () => void };
    w.__frameTimes = [];
    let last = performance.now();
    let running = true;
    const tick = (): void => {
      const now = performance.now();
      w.__frameTimes.push(now - last);
      last = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    w.__frameStop = () => {
      running = false;
    };
  });

  await action();

  return page.evaluate(
    ({ longMs }) => {
      const w = window as unknown as { __frameTimes: number[]; __frameStop?: () => void };
      w.__frameStop?.();
      const times = (w.__frameTimes ?? []).slice(1); // drop the first (warm) sample
      times.sort((a, b) => a - b);
      const count = times.length;
      if (count === 0) return { count: 0, mean: 0, p95: 0, max: 0, longFrames: 0 };
      const mean = times.reduce((s, v) => s + v, 0) / count;
      const p95 = times[Math.min(count - 1, Math.floor(count * 0.95))] ?? mean;
      const max = times[count - 1] ?? mean;
      const longFrames = times.filter((t) => t > longMs).length;
      return { count, mean, p95, max, longFrames };
    },
    { longMs: LONG_FRAME_MS },
  );
}

test.describe('Signal Viewer real-browser pan/zoom perf probe', () => {
  test.skip(!RUN, 'Set RUN_PERF_PROBE=1 to run the real-browser perf probe (CI perf job only).');

  test('pan + wheel-zoom keep frame intervals within budget (or fallback renders)', async ({
    page,
  }, testInfo) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    const date = daysAgoStr(2);
    const session = makeSession('sess-perf', date);

    // Seed: load once to create schema, inject session, open the signal viewer.
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await injectSession(page, session);
    await page.goto('/sessions/sess-perf/signals');
    await page.waitForLoadState('networkidle');

    // The chart only renders when OPFS has real signal chunks. Without them the
    // viewer shows a fallback — assert it and exit (no gesture to measure).
    const viewerLoaded = await page
      .locator('text="Signal Viewer"')
      .isVisible()
      .catch(() => false);
    const wrapper = viewerLoaded ? page.locator('[class*="canvasWrapper"]').first() : null;
    const haveChart = wrapper ? await wrapper.isVisible().catch(() => false) : false;

    if (!haveChart) {
      await expect(
        page.getByText('No Signal Data').or(page.getByText(/failed to load|not supported/i)),
      ).toBeVisible();
      testInfo.annotations.push({
        type: 'perf-probe',
        description:
          'No OPFS signal data in this environment — fallback verified, gesture skipped.',
      });
      expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
      return;
    }

    const box = await wrapper!.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const midY = box.y + box.height / 2;

    // ── PAN gesture: press-drag-release across the chart, many small steps. ──
    const panStats = await recordFrames(page, async () => {
      await page.mouse.move(box.x + box.width * 0.7, midY);
      await page.mouse.down();
      for (let i = 0; i < 40; i++) {
        const frac = 0.7 - i * 0.012;
        await page.mouse.move(box.x + box.width * frac, midY, { steps: 2 });
      }
      await page.mouse.up();
    });

    // ── WHEEL-ZOOM gesture: a burst of zoom-in notches over the cursor. ──
    const wheelStats = await recordFrames(page, async () => {
      await page.mouse.move(box.x + box.width * 0.5, midY);
      for (let i = 0; i < 24; i++) {
        await page.mouse.wheel(0, -120); // zoom in
      }
      for (let i = 0; i < 24; i++) {
        await page.mouse.wheel(0, 120); // zoom back out
      }
    });

    // Emit the numbers as a test annotation (visible in the Playwright HTML report).
    for (const [label, s] of [
      ['pan', panStats],
      ['wheel', wheelStats],
    ] as const) {
      testInfo.annotations.push({
        type: `perf-${label}`,
        description: `frames=${s.count} mean=${s.mean.toFixed(2)}ms p95=${s.p95.toFixed(2)}ms max=${s.max.toFixed(2)}ms long(>${LONG_FRAME_MS}ms)=${s.longFrames}`,
      });
    }

    // Frame-health assertions (real-browser-only metric). Lenient thresholds so
    // CI variance doesn't flake; the bench's allocation delta is the precise win.
    for (const s of [panStats, wheelStats]) {
      expect(s.count).toBeGreaterThan(0);
      expect(s.p95).toBeLessThan(FRAME_BUDGET_MS);
      // Coalescing + buffer reuse should keep dropped frames rare during a gesture.
      expect(s.longFrames).toBeLessThanOrEqual(2);
    }

    // No uncaught errors during the gestures.
    expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
  });
});
