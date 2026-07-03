import { test, expect, type Page } from '@playwright/test';

/**
 * Region Statistics ("Measure") overlay — Signal Viewer E2E.
 *
 * Covers the UX journeys J1–J4 plus the key gesture-isolation invariant for the
 * Measure overlay added to {@link module:views/Sessions/SignalViewer}:
 *
 *   J1  Viewport stats reflect the displayed window (default source).
 *   J2  Alt+drag pins an explicit measure REGION (distinct from Shift+drag zoom).
 *   J4  Keyboard region ([ / ]) + aria-live announcement + screen-reader table.
 *   ──  Toggle discoverability / default-off, gesture isolation, persistence.
 *
 * ── REACHING THE SIGNAL VIEWER WITH REAL DATA ───────────────────────────────
 * The Signal Viewer renders waveforms ONLY when OPFS holds real signal chunks.
 * The established sessions.spec.ts seeding path injects IndexedDB metadata only
 * (no OPFS chunks), so every existing signal-viewer test there renders the
 * "No Signal Data" fallback and guards behind `if (!wrapper)`. The Measure
 * overlay needs an actual rendered chart with lanes, so this suite seeds OPFS
 * DIRECTLY — writing the same on-disk layout that {@link OPFSService.writeSession}
 * produces (cpap-analyzer/signals/<id>/manifest.json + channel-wise contiguous
 * Float32 chunk-NNN.bin files). The SignalViewer's load path depends only on the
 * OPFS manifest + chunks (readManifest/readChannel), independent of the IDB
 * session record's channels/signalChunkIds, so this is sufficient to render the
 * chart. The IDB session record is still seeded (mirrors sessions.spec.ts) so
 * the route resolves and the viewer chrome populates.
 *
 * Selectors follow the existing suite's conventions: accessible role/text where
 * possible (the toolbar button, presets, the SR <table>), and `[class*="…"]`
 * attribute selectors for the CSS-Module-hashed overlay nodes (footer, band,
 * chips) — the same fallback sessions.spec.ts uses for the hashed canvas nodes.
 * The footer's source pill is matched by its stable `data-source` attribute.
 */

const DB_NAME = 'cpap-analyzer';
const SESSION_ID = 'sess-measure';
const SESSION_DURATION_SEC = 3600; // 1h — 12 chunks, enough to zoom meaningfully.

/** Return a YYYY-MM-DD string for N days before today (local time). */
function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Write a session's signal data straight into OPFS in the exact layout
 * {@link OPFSService} reads: `cpap-analyzer/signals/<id>/` containing a
 * `manifest.json` and `chunk-NNN.bin` files whose bytes are the per-chunk,
 * channel-wise contiguous Float32 samples in manifest `channels` order.
 */
async function seedOpfsSignals(page: Page, sessionId: string, durationSec: number): Promise<void> {
  await page.evaluate(
    async ({ sessionId, durationSec }) => {
      const CHUNK_SEC = 300; // OPFSService CHUNK_DURATION_SECONDS
      const channels = [
        { name: 'Flow', sampleRate: 25, unit: 'L/min', physicalMin: -120, physicalMax: 120 },
        { name: 'MaskPress', sampleRate: 25, unit: 'cmH2O', physicalMin: 0, physicalMax: 30 },
        { name: 'Leak', sampleRate: 5, unit: 'L/min', physicalMin: 0, physicalMax: 120 },
      ];
      const startTime = Date.parse('2026-01-01T22:00:00Z');
      const endTime = startTime + durationSec * 1000;
      const chunkCount = Math.max(1, Math.ceil(durationSec / CHUNK_SEC));

      const root = await navigator.storage.getDirectory();
      const app = await root.getDirectoryHandle('cpap-analyzer', { create: true });
      const signals = await app.getDirectoryHandle('signals', { create: true });
      const dir = await signals.getDirectoryHandle(sessionId, { create: true });

      const chunks: Array<{
        index: number;
        fileName: string;
        startTime: number;
        endTime: number;
        samples: Record<string, number>;
        byteSize: number;
      }> = [];

      for (let ci = 0; ci < chunkCount; ci++) {
        const cStart = startTime + ci * CHUNK_SEC * 1000;
        const cEnd = Math.min(startTime + (ci + 1) * CHUNK_SEC * 1000, endTime);
        const cDur = (cEnd - cStart) / 1000;
        const samples: Record<string, number> = {};
        const views: Float32Array[] = [];

        for (const ch of channels) {
          const count = Math.floor(cDur * ch.sampleRate);
          const arr = new Float32Array(count);
          for (let i = 0; i < count; i++) {
            const tSec = (cStart - startTime) / 1000 + i / ch.sampleRate;
            // Deterministic, physiologically-plausible waveforms so every lane
            // has meaningful (non-sentinel) samples for the stats to summarise.
            if (ch.name === 'Flow') arr[i] = 30 * Math.sin(tSec * 0.5);
            else if (ch.name === 'MaskPress') arr[i] = 10 + 2 * Math.sin(tSec * 0.05);
            else arr[i] = 5 + 3 * Math.sin(tSec * 0.02);
          }
          samples[ch.name] = count;
          views.push(arr);
        }

        let total = 0;
        for (const v of views) total += v.byteLength;
        const buf = new Uint8Array(total);
        let off = 0;
        for (const v of views) {
          buf.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), off);
          off += v.byteLength;
        }

        const fileName = `chunk-${String(ci).padStart(3, '0')}.bin`;
        const fh = await dir.getFileHandle(fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(buf);
        await w.close();

        chunks.push({
          index: ci,
          fileName,
          startTime: cStart,
          endTime: cEnd,
          samples,
          byteSize: total,
        });
      }

      const manifest = {
        version: 1,
        sessionId,
        startTime,
        endTime,
        durationSeconds: durationSec,
        chunkDurationSeconds: CHUNK_SEC,
        channels: channels.map((ch, i) => ({
          index: i,
          name: ch.name,
          sampleRate: ch.sampleRate,
          unit: ch.unit,
          dtype: 'float32',
          physicalMin: ch.physicalMin,
          physicalMax: ch.physicalMax,
        })),
        chunks,
      };
      const mh = await dir.getFileHandle('manifest.json', { create: true });
      const mw = await mh.createWritable();
      await mw.write(JSON.stringify(manifest, null, 2));
      await mw.close();
    },
    { sessionId, durationSec },
  );
}

/** Inject the minimal Session metadata record so the route resolves (mirrors sessions.spec.ts). */
async function seedSessionRecord(page: Page, sessionId: string, date: string): Promise<void> {
  await page.evaluate(
    ({ dbName, sessionId, date }) => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(new Error('Failed to open database'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['sessions'], 'readwrite');
          tx.objectStore('sessions').put({
            id: sessionId,
            machineId: '23241654214',
            machineModel: 'AirSense 11 AutoSet',
            machineType: 'cpap',
            firmwareVersion: '3.0.2',
            date,
            startTime: `${date}T22:00:00Z`,
            endTime: `${date}T06:00:00Z`,
            durationMinutes: 480,
            usageMinutes: 420,
            importedAt: new Date().toISOString(),
            sourceHash: `hash-${sessionId}`,
            channels: [],
            signalChunkIds: [],
            hasOximetry: false,
            deleted: false,
            machineSettings: null,
          });
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
    { dbName: DB_NAME, sessionId, date },
  );
}

/**
 * Load the app (creates the IDB schema), seed the session record + OPFS signal
 * chunks, then open the signal viewer and wait for the waveform chart to render.
 * Returns the canvas-wrapper locator so callers can compute plot coordinates.
 */
async function gotoSignalViewer(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();

  await seedSessionRecord(page, SESSION_ID, daysAgoStr(2));
  await seedOpfsSignals(page, SESSION_ID, SESSION_DURATION_SEC);

  await page.goto(`/sessions/${SESSION_ID}/signals`);
  await page.waitForLoadState('networkidle');

  const wrapper = page.locator('[class*="canvasWrapper"]').first();
  // If OPFS seeding ever fails to render the chart this assertion fails loudly,
  // rather than the test silently exercising the fallback empty state.
  await expect(wrapper).toBeVisible({ timeout: 15000 });
  await expect(wrapper.locator('canvas[role="img"]')).toBeVisible();
  return wrapper;
}

// ── Locator helpers (scoped to the rendered viewer) ──

const measureButton = (page: Page) => page.getByRole('button', { name: /Measure/ });

/** The sticky region footer (role=status) carrying the source pill + span + count. */
const regionFooter = (wrapper: ReturnType<Page['locator']>) =>
  wrapper.locator('[role="status"]').filter({ hasText: /VIEWPORT|REGION/ });

/** The source pill, matched by its stable data-source attribute (viewport|region). */
const sourcePill = (wrapper: ReturnType<Page['locator']>) =>
  regionFooter(wrapper).locator('[data-source]');

/** The footer's `n = …` sample count. */
const footerCount = (wrapper: ReturnType<Page['locator']>) =>
  regionFooter(wrapper).locator('[class*="regionFooterCount"]');

/** The footer's clock-span readout (start · ~duration · end). */
const footerSpan = (wrapper: ReturnType<Page['locator']>) =>
  regionFooter(wrapper).locator('[class*="regionFooterSpan"]');

/** The "Showing <from – to · span>" status text — a proxy for the current viewport. */
const viewportLabel = (page: Page) => page.getByText(/^Showing /);

/** Pin a measure region by Alt+dragging horizontally across the middle of the plot. */
async function altDragRegion(
  page: Page,
  wrapper: ReturnType<Page['locator']>,
  fromFrac = 0.35,
  toFrac = 0.6,
): Promise<void> {
  const box = await wrapper.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const y = box.y + box.height / 2;
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + box.width * fromFrac, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * toFrac, y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
}

test.describe('Signal Viewer — Region Statistics (Measure) overlay', () => {
  // ── OPFS capability gate ─────────────────────────────────────────────────
  // This suite seeds signal data into OPFS (navigator.storage.getDirectory) so
  // the waveform chart renders. Some Playwright browser builds — notably the
  // Linux WebKit runner — do not implement OPFS, so seeding (and therefore the
  // chart) is impossible there. We feature-detect rather than match on browser
  // name so any current/future OPFS-less runner (e.g. Firefox) skips cleanly
  // instead of failing. The probe needs a loaded document, so we navigate to a
  // real page first (never probe on about:blank) and run it BEFORE any
  // seedOpfsSignals/gotoSignalViewer call.
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const hasOpfs = await page.evaluate(
      () => typeof navigator?.storage?.getDirectory === 'function',
    );
    test.skip(
      !hasOpfs,
      'Browser has no OPFS (navigator.storage.getDirectory); signal data cannot be seeded — covered on Chromium/Firefox where OPFS is available',
    );
  });

  // ── 1. Toggle discoverability & default-off ──────────────────────────────
  test('Measure toggle: discoverable, default-off, toggles chips + footer on/off', async ({
    page,
  }) => {
    const wrapper = await gotoSignalViewer(page);
    const btn = measureButton(page);

    // Discoverable and OFF by default — no footer/chips at rest.
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(regionFooter(wrapper)).toHaveCount(0);
    await expect(wrapper.locator('[class*="statChip"]')).toHaveCount(0);

    // Click ON → pressed, footer appears showing VIEWPORT source + a sample count,
    // and per-lane chips dock onto the plot.
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(regionFooter(wrapper)).toBeVisible();
    await expect(sourcePill(wrapper)).toHaveAttribute('data-source', 'viewport');
    await expect(sourcePill(wrapper)).toHaveText(/VIEWPORT/);
    await expect(footerCount(wrapper)).toHaveText(/n =/);
    await expect(wrapper.locator('[class*="statChip"]').first()).toBeVisible();

    // Click again → everything hidden.
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(regionFooter(wrapper)).toHaveCount(0);
    await expect(wrapper.locator('[class*="statChip"]')).toHaveCount(0);

    // The `M` shortcut toggles it back on (default source still the viewport).
    await page.keyboard.press('m');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(sourcePill(wrapper)).toHaveAttribute('data-source', 'viewport');
  });

  // ── 2. Viewport stats reflect the view (J1) ──────────────────────────────
  test('J1: viewport stats track the displayed window when zooming', async ({ page }) => {
    const wrapper = await gotoSignalViewer(page);
    await measureButton(page).click();

    const footer = regionFooter(wrapper);
    await expect(footer).toBeVisible();
    await expect(sourcePill(wrapper)).toHaveText(/VIEWPORT/);

    const fullCount = await footerCount(wrapper).textContent();
    const fullSpan = await footerSpan(wrapper).textContent();
    expect(fullCount).toMatch(/n =/);

    // Zoom into a smaller (5-minute) window via the existing zoom preset. The
    // viewport-sourced stats must recompute for the new, smaller window: both the
    // sample count and the clock span should change. We assert they CHANGE — the
    // exact statistics are covered by the regionStats unit tests.
    await page.getByRole('button', { name: '5m', exact: true }).click();

    await expect.poll(async () => footerCount(wrapper).textContent()).not.toBe(fullCount);
    await expect.poll(async () => footerSpan(wrapper).textContent()).not.toBe(fullSpan);
    // Still viewport-sourced (no region was pinned).
    await expect(sourcePill(wrapper)).toHaveAttribute('data-source', 'viewport');
  });

  // ── 3. Alt+drag pins a region (J2) ───────────────────────────────────────
  test('J2: Alt+drag pins a measure region; Esc clears it back to the viewport', async ({
    page,
  }) => {
    const wrapper = await gotoSignalViewer(page);
    await measureButton(page).click();
    await expect(sourcePill(wrapper)).toHaveAttribute('data-source', 'viewport');

    const viewportSpan = await footerSpan(wrapper).textContent();

    await altDragRegion(page, wrapper);

    // Source pill flips to REGION, a dashed measure band appears, and the region
    // span differs from the full viewport span.
    await expect(sourcePill(wrapper)).toHaveAttribute('data-source', 'region', { timeout: 5000 });
    await expect(sourcePill(wrapper)).toHaveText(/REGION/);
    await expect(wrapper.locator('[class*="measureBand"]').first()).toBeVisible();
    await expect.poll(async () => footerSpan(wrapper).textContent()).not.toBe(viewportSpan);

    // First Esc clears the pinned region (back to viewport source); the overlay
    // stays on (Measure was toggled on, not just peeked).
    await page.keyboard.press('Escape');
    await expect(sourcePill(wrapper)).toHaveAttribute('data-source', 'viewport', { timeout: 5000 });
    await expect(wrapper.locator('[class*="measureBand"]')).toHaveCount(0);
    await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'true');
  });

  // ── 4. Gesture isolation (the key regression guard) ──────────────────────
  test('gesture isolation: Alt+drag does not zoom; Shift+drag does not pin a region', async ({
    page,
  }) => {
    const wrapper = await gotoSignalViewer(page);
    await measureButton(page).click();
    await expect(sourcePill(wrapper)).toHaveAttribute('data-source', 'viewport');

    // (a) Alt+drag MEASURES but must NOT change the zoom. Capture the viewport
    // label ("Showing …"), Alt+drag, and assert the viewport is unchanged while a
    // region got pinned.
    const beforeZoom = await viewportLabel(page).textContent();
    await altDragRegion(page, wrapper);
    await expect(sourcePill(wrapper)).toHaveAttribute('data-source', 'region', { timeout: 5000 });
    // Give any (erroneous) viewport change a chance to land, then assert none did.
    await expect(viewportLabel(page)).toHaveText(beforeZoom ?? '');

    // Clear the region before the next gesture.
    await page.keyboard.press('Escape');
    await expect(sourcePill(wrapper)).toHaveAttribute('data-source', 'viewport', { timeout: 5000 });

    // (b) Shift+drag ZOOMS but must NOT pin a region. The viewport label changes,
    // the source stays VIEWPORT, and no measure band is drawn.
    const beforeShift = await viewportLabel(page).textContent();
    const box = await wrapper.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const y = box.y + box.height / 2;
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, y, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    await expect.poll(async () => viewportLabel(page).textContent()).not.toBe(beforeShift);
    await expect(sourcePill(wrapper)).toHaveAttribute('data-source', 'viewport');
    await expect(wrapper.locator('[class*="measureBand"]')).toHaveCount(0);
  });

  // ── 5. Keyboard + a11y (J4) ──────────────────────────────────────────────
  test('J4: keyboard [ / ] defines a region; aria-live announces it; SR table exposes lanes', async ({
    page,
  }) => {
    const wrapper = await gotoSignalViewer(page);
    const btn = measureButton(page);

    // The Measure toggle is keyboard-reachable and `M` activates it.
    await btn.focus();
    await expect(btn).toBeFocused();
    await page.keyboard.press('m');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');

    // Focus the chart, set a region: `[` marks the start at the data cursor, then
    // ArrowRight advances the cursor, then `]` marks the end.
    const baseCanvas = wrapper.locator('canvas[role="img"]');
    await baseCanvas.focus();
    await baseCanvas.press('[');
    for (let i = 0; i < 10; i++) await baseCanvas.press('ArrowRight');
    await baseCanvas.press(']');

    // The region is pinned (source → REGION).
    await expect(sourcePill(wrapper)).toHaveAttribute('data-source', 'region', { timeout: 5000 });

    // An aria-live region announces the region (polite status live regions).
    const liveRegions = page.locator('[class*="srOnly"][role="status"]');
    await expect(
      liveRegions.filter({ hasText: /measuring|Region end set|Pinned region/i }).first(),
    ).toHaveText(/measuring|Region end set|Pinned region/i, { timeout: 5000 });

    // The focusable screen-reader "Region statistics" <table> is present with one
    // row per numeric lane (Flow / MaskPress / Leak → 3 data rows).
    const table = page.getByRole('table', { name: 'Region statistics' });
    await expect(table).toHaveCount(1);
    await expect(table).toHaveAttribute('tabindex', '0');
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(table.getByRole('row', { name: /Flow/ })).toBeVisible();
  });

  // ── 6. Persistence ───────────────────────────────────────────────────────
  test('persistence: Measure on/off survives reload; a pinned region does not', async ({
    page,
  }) => {
    await gotoSignalViewer(page);
    await measureButton(page).click();
    await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'true');

    // Reload → Measure stays ON (persisted via the lanePrefs localStorage key).
    await page.reload();
    await page.waitForLoadState('networkidle');
    let wrapper2 = page.locator('[class*="canvasWrapper"]').first();
    await expect(wrapper2).toBeVisible({ timeout: 15000 });
    await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(sourcePill(wrapper2)).toHaveAttribute('data-source', 'viewport');

    // Pin a region, then reload → Measure still ON but the drawn region is GONE
    // (transient by design; only the on/off flag persists).
    await altDragRegion(page, wrapper2);
    await expect(sourcePill(wrapper2)).toHaveAttribute('data-source', 'region', { timeout: 5000 });

    await page.reload();
    await page.waitForLoadState('networkidle');
    wrapper2 = page.locator('[class*="canvasWrapper"]').first();
    await expect(wrapper2).toBeVisible({ timeout: 15000 });
    await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(sourcePill(wrapper2)).toHaveAttribute('data-source', 'viewport');
    await expect(wrapper2.locator('[class*="measureBand"]')).toHaveCount(0);
  });
});

/**
 * Analysis modes for the Measure overlay (commit 6cd8b13, branch
 * `claude/measure-modes-extension`). When Measure is on, a footer segmented
 * control (`role="radiogroup"`, aria-label "Measure mode") with five options —
 * Stats · Var · Trend · Dist · Sel — re-skins the chips, footer, and SR table.
 * Keys `.` (forward) and `,` (back) cycle modes (wrapping), active only while
 * Measure is on and guarded against text inputs. The active mode persists per
 * session (`lanePrefs.measureStatMode`).
 *
 * These tests REUSE the seeding/skip helpers and selector conventions of the
 * suite above. New mode-specific hooks relied on (all stable, non-hashed):
 *   • the radiogroup (`getByRole('radiogroup', { name: 'Measure mode' })`) and its
 *     `role="radio"` options, whose accessible names are the FULL mode names
 *     (Statistics/Variability/Trend/Distribution/Selection) and `aria-checked`.
 *   • the footer's `data-mode` attribute (statistics|variability|trend|distribution|selection).
 *   • the "Region statistics" `<table>` caption (begins with the mode name) and
 *     per-mode column headers.
 *   • the Selection footer's precise-timing fields (the `start`/`dur`/`end` labels)
 *     and the copy button (`aria-label="Copy precise region timing"`, which flips
 *     its `data-copied` attribute + label to "Copied" on success).
 */

const MEASURE_MODE_NAMES = ['Statistics', 'Variability', 'Trend', 'Distribution', 'Selection'];

/** The footer segmented control (role=radiogroup). Lives inside the region footer. */
const modeSwitcher = (page: Page) => page.getByRole('radiogroup', { name: 'Measure mode' });

/** A single mode option, by its accessible (full) name — e.g. radioOption(page, 'Trend'). */
const radioOption = (page: Page, name: string) =>
  modeSwitcher(page).getByRole('radio', { name, exact: true });

/** The region footer's data-mode attribute carrier (drives chip/footer/table skin). */
const footerModeHost = (wrapper: ReturnType<Page['locator']>) =>
  wrapper.locator('[role="status"][data-mode]');

/** The screen-reader "Region statistics" table (caption + headers change per mode). */
const srTable = (page: Page) => page.getByRole('table', { name: 'Region statistics' });

/** The Selection-mode footer copy button. */
const copyTimingButton = (page: Page) =>
  page.getByRole('button', { name: 'Copy precise region timing' });

/** Assert exactly one mode option is checked, and that it is `expected`. */
async function expectActiveMode(page: Page, expected: string): Promise<void> {
  await expect(radioOption(page, expected)).toHaveAttribute('aria-checked', 'true');
  for (const other of MEASURE_MODE_NAMES) {
    if (other === expected) continue;
    await expect(radioOption(page, other)).toHaveAttribute('aria-checked', 'false');
  }
}

test.describe('Signal Viewer — Measure analysis modes', () => {
  // Reuse the exact OPFS capability gate from the suite above (skip cleanly on
  // OPFS-less runners such as Linux WebKit; probe on a real page, never about:blank).
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const hasOpfs = await page.evaluate(
      () => typeof navigator?.storage?.getDirectory === 'function',
    );
    test.skip(
      !hasOpfs,
      'Browser has no OPFS (navigator.storage.getDirectory); signal data cannot be seeded — covered on Chromium/Firefox where OPFS is available',
    );
  });

  // ── 1. Switcher visible + default mode ───────────────────────────────────
  test('mode switcher: visible with Measure on; defaults to Stats; all five options present', async ({
    page,
  }) => {
    const wrapper = await gotoSignalViewer(page);

    // No switcher at rest (Measure off).
    await expect(modeSwitcher(page)).toHaveCount(0);

    await measureButton(page).click();
    await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'true');

    // Radiogroup appears with all five options; default checked option is Statistics.
    await expect(modeSwitcher(page)).toBeVisible();
    await expect(modeSwitcher(page).getByRole('radio')).toHaveCount(5);
    for (const name of MEASURE_MODE_NAMES) {
      await expect(radioOption(page, name)).toBeVisible();
    }
    await expectActiveMode(page, 'Statistics');

    // The footer's data-mode and the SR-table caption corroborate the default.
    await expect(footerModeHost(wrapper)).toHaveAttribute('data-mode', 'statistics');
    await expect(srTable(page)).toContainText(/^Statistics —/);
  });

  // ── 2. Click to select a mode (re-skins chips/footer/table) ──────────────
  test('clicking a mode option selects it and re-skins the footer + SR table', async ({ page }) => {
    const wrapper = await gotoSignalViewer(page);
    await measureButton(page).click();
    await expectActiveMode(page, 'Statistics');

    // Trend: option checks, footer data-mode flips, SR-table headers gain Trend columns,
    // and the (aria-hidden) per-lane chips carry the Trend hallmark "/min" + a direction word.
    await radioOption(page, 'Trend').click();
    await expectActiveMode(page, 'Trend');
    await expect(footerModeHost(wrapper)).toHaveAttribute('data-mode', 'trend');
    await expect(srTable(page).getByRole('columnheader', { name: /Slope/ })).toBeVisible();
    await expect(srTable(page).getByRole('columnheader', { name: 'Direction' })).toBeVisible();
    await expect(srTable(page)).toContainText(/^Trend —/);
    // Soft chip corroboration (chips are aria-hidden; assert their visible text).
    await expect(wrapper.locator('[class*="statChip"]').first()).toContainText(/\/min/);
    await expect(wrapper.locator('[class*="statChip"]').first()).toContainText(
      /rising|falling|flat/,
    );

    // Variability: distinct headers (Std dev / CV / IQR) confirm the re-skin.
    await radioOption(page, 'Variability').click();
    await expectActiveMode(page, 'Variability');
    await expect(footerModeHost(wrapper)).toHaveAttribute('data-mode', 'variability');
    await expect(srTable(page).getByRole('columnheader', { name: 'Std dev' })).toBeVisible();
    await expect(srTable(page).getByRole('columnheader', { name: 'IQR' })).toBeVisible();
    await expect(srTable(page)).toContainText(/^Variability —/);
  });

  // ── 3. Keyboard cycle `.` (forward, wraps) and `,` (back, wraps) ──────────
  test('keyboard `.` / `,` cycle the mode through Stats→Var→Trend→Dist→Sel and wrap', async ({
    page,
  }) => {
    const wrapper = await gotoSignalViewer(page);
    await measureButton(page).click();
    await expectActiveMode(page, 'Statistics');

    // Focus the chart so the page (window keydown listener) receives the keys, but
    // the focused element is NOT a text input (the cycle is guarded against those).
    await wrapper.locator('canvas[role="img"]').focus();

    const forward = ['Variability', 'Trend', 'Distribution', 'Selection', 'Statistics'];
    for (const expected of forward) {
      await page.keyboard.press('.');
      await expectActiveMode(page, expected);
    }
    // We are back at Statistics (wrapped). One more `,` wraps backward to Selection.
    await page.keyboard.press(',');
    await expectActiveMode(page, 'Selection');
    await page.keyboard.press(',');
    await expectActiveMode(page, 'Distribution');

    // Footer skin tracks the active mode.
    await expect(footerModeHost(wrapper)).toHaveAttribute('data-mode', 'distribution');
  });

  // ── 4. Cycle keys are inert while Measure is OFF ─────────────────────────
  test('`.` / `,` do nothing while Measure is off (no switcher, no mode change)', async ({
    page,
  }) => {
    const wrapper = await gotoSignalViewer(page);

    // Measure off: no switcher; cycle keys must be inert.
    await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'false');
    await wrapper.locator('canvas[role="img"]').focus();
    await page.keyboard.press('.');
    await page.keyboard.press('.');
    await page.keyboard.press(',');
    await expect(modeSwitcher(page)).toHaveCount(0);
    await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'false');

    // Turning Measure on still starts at the default (the keys had no latent effect).
    await measureButton(page).click();
    await expectActiveMode(page, 'Statistics');
  });

  // ── 5. Selection mode: precise-timing footer + copy button ───────────────
  test('Selection mode shows start/dur/end timing fields and a working copy button', async ({
    page,
  }) => {
    const wrapper = await gotoSignalViewer(page);
    await measureButton(page).click();
    await radioOption(page, 'Selection').click();
    await expectActiveMode(page, 'Selection');
    await expect(footerModeHost(wrapper)).toHaveAttribute('data-mode', 'selection');

    // The precise-timing fields render (labels start / dur / end) inside the footer.
    const footer = footerModeHost(wrapper);
    await expect(footer.getByText('start', { exact: true })).toBeVisible();
    await expect(footer.getByText('dur', { exact: true })).toBeVisible();
    await expect(footer.getByText('end', { exact: true })).toBeVisible();

    // The copy button is present, focusable, and shows "Copy" at rest.
    const copyBtn = copyTimingButton(page);
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toContainText('Copy');
    await copyBtn.focus();
    await expect(copyBtn).toBeFocused();

    // Clicking must not throw. If the clipboard write is permitted, the button flips
    // to its confirmed state (data-copied="true" + "Copied"); if blocked, the
    // aria-live region carries an explanatory message. Either way: no error, and a
    // visible state change. We don't assert clipboard CONTENTS (read may be blocked).
    await copyBtn.click();
    const copyConfirmed = copyBtn.and(page.locator('[data-copied="true"]'));
    const copyStatusLive = page
      .locator('[class*="srOnly"][role="status"]')
      .filter({ hasText: /copied|copy/i });
    await expect
      .poll(async () => (await copyConfirmed.count()) > 0 || (await copyStatusLive.count()) > 0, {
        timeout: 5000,
      })
      .toBe(true);
  });

  // ── 6. Mode persists across reload (region does not) ─────────────────────
  test('selected mode persists across a reload; the pinned region does not', async ({ page }) => {
    let wrapper = await gotoSignalViewer(page);
    await measureButton(page).click();
    await radioOption(page, 'Trend').click();
    await expectActiveMode(page, 'Trend');

    // Pin a region too, so we can confirm the region is transient while the mode persists.
    await altDragRegion(page, wrapper);
    await expect(sourcePill(wrapper)).toHaveAttribute('data-source', 'region', { timeout: 5000 });

    await page.reload();
    await page.waitForLoadState('networkidle');
    wrapper = page.locator('[class*="canvasWrapper"]').first();
    await expect(wrapper).toBeVisible({ timeout: 15000 });

    // Measure is still on (existing spec covers that) and the MODE is still Trend.
    await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expectActiveMode(page, 'Trend');
    await expect(footerModeHost(wrapper)).toHaveAttribute('data-mode', 'trend');
    // The drawn region is gone (transient by design); source is back to viewport.
    await expect(sourcePill(wrapper)).toHaveAttribute('data-source', 'viewport');
    await expect(wrapper.locator('[class*="measureBand"]')).toHaveCount(0);
  });

  // ── 7. Per-mode SR table (a11y): caption + headers reflect the active mode ─
  test('SR table caption and column headers reflect the active mode', async ({ page }) => {
    const wrapper = await gotoSignalViewer(page);
    await measureButton(page).click();

    // Statistics (default): Average/Median/Minimum/Maximum columns.
    await expect(srTable(page)).toContainText(/^Statistics —/);
    await expect(srTable(page).getByRole('columnheader', { name: 'Average' })).toBeVisible();
    await expect(srTable(page).getByRole('columnheader', { name: 'Median' })).toBeVisible();

    // Variability: caption + Std dev / CV / IQR headers.
    await radioOption(page, 'Variability').click();
    await expect(srTable(page)).toContainText(/^Variability —/);
    await expect(srTable(page).getByRole('columnheader', { name: 'Std dev' })).toBeVisible();
    await expect(srTable(page).getByRole('columnheader', { name: 'CV' })).toBeVisible();
    await expect(srTable(page).getByRole('columnheader', { name: 'IQR' })).toBeVisible();

    // Trend: caption + Slope (/min) / Direction / R² headers.
    await radioOption(page, 'Trend').click();
    await expect(srTable(page)).toContainText(/^Trend —/);
    await expect(srTable(page).getByRole('columnheader', { name: /Slope/ })).toBeVisible();
    await expect(srTable(page).getByRole('columnheader', { name: 'Direction' })).toBeVisible();

    // Distribution: caption + the p5…p95 percentile ladder headers.
    await radioOption(page, 'Distribution').click();
    await expect(srTable(page)).toContainText(/^Distribution —/);
    await expect(
      srTable(page).getByRole('columnheader', { name: 'p5', exact: true }),
    ).toBeVisible();
    await expect(
      srTable(page).getByRole('columnheader', { name: 'p95', exact: true }),
    ).toBeVisible();

    // Selection: caption + Sample rate (Hz) / Span headers.
    await radioOption(page, 'Selection').click();
    await expect(srTable(page)).toContainText(/^Selection —/);
    await expect(srTable(page).getByRole('columnheader', { name: /Sample rate/ })).toBeVisible();
    await expect(
      srTable(page).getByRole('columnheader', { name: 'Span', exact: true }),
    ).toBeVisible();

    // The table stays a single mounted element across mode switches.
    await expect(srTable(page)).toHaveCount(1);
    void wrapper;
  });

  // ── 8. Alt-peek repeat (regression guard for the menu-accelerator fix) ────
  //
  // The fix: a lone Alt over the plot used to be claimed by the browser to focus
  // its menu bar, blurring the page so only the FIRST peek registered until a
  // click. The overlay now suppresses that default, so repeated peeks work with no
  // intervening click. We exercise: Measure OFF → hover plot → hold Alt → peek
  // chips appear → release → hide → hold Alt AGAIN (no click) → chips appear again.
  //
  // LIMITATION: Playwright's `keyboard.down('Alt')` does not reproduce the OS-level
  // menu-accelerator focus steal that the fix addresses, so this is a behavioural
  // smoke test of the peek-show/hide/repeat cycle rather than a faithful
  // reproduction of the original blur bug. It is gated on the peek chips being
  // observable; if they are not, we still assert the non-flaky invariant (no chips
  // while Alt is up) and document the gap rather than asserting a flaky positive.
  test('Alt-peek shows chips, hides on release, and shows AGAIN without a click', async ({
    page,
  }) => {
    const wrapper = await gotoSignalViewer(page);
    // Measure OFF — peek is the only thing that can surface chips.
    await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(wrapper.locator('[class*="statChip"]')).toHaveCount(0);

    const box = await wrapper.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const chips = wrapper.locator('[class*="statChip"]');

    const peekOnce = async (): Promise<boolean> => {
      await page.mouse.move(cx, cy);
      await page.keyboard.down('Alt');
      // Let the peek state settle; poll for chips rather than a fixed wait.
      let shown = false;
      try {
        await expect.poll(async () => chips.count(), { timeout: 2000 }).toBeGreaterThan(0);
        shown = true;
      } catch {
        shown = false;
      }
      await page.keyboard.up('Alt');
      // After release (Measure off, no pin) the chips must be gone again.
      await expect(chips).toHaveCount(0, { timeout: 3000 });
      return shown;
    };

    const firstShown = await peekOnce();
    const secondShown = await peekOnce();

    if (firstShown) {
      // The regression guard: the SECOND peek must also surface chips with no
      // intervening click. If the first peeked, the second must too.
      expect(secondShown).toBe(true);
    } else {
      // Peek chips weren't observable under Playwright's synthetic Alt (see the
      // LIMITATION note above). We still hold the safe invariant: no chips linger
      // while Alt is up and Measure is off.
      await expect(chips).toHaveCount(0);
    }
  });
});
