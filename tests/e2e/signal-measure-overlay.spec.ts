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
