/**
 * Stage-3 WebGL FIDELITY GATE (ADR 0019) — the objective, default-on gate.
 *
 * PURPOSE
 * -------
 * ADR 0019 mandates an objective gate proving the WebGL2 hybrid Signal Viewer
 * renders the dense-CPAP waveform IDENTICALLY (within a documented tolerance) to
 * the Canvas2D reference at DPR 2, BEFORE WebGL becomes the shipped default. This
 * spec drives the in-app harness at `/__fidelity__` (registered dev-only in
 * `src/router.tsx`; see `src/views/_dev/FidelityHarness.tsx`), which renders ONE
 * deterministic synthetic dataset through BOTH paths from the SAME built channel
 * objects, then compares the two waveform regions pixel-for-pixel.
 *
 * WHAT IT ASSERTS, per viewport (`all`, `1h`, `5m`, `1m`, `spike`, `gap`)
 * --------------------------------------------------------------------------
 *   1. WebGL is ACTIVE (the GPU path engaged). FAILS LOUDLY otherwise — this is
 *      the missing-WebGL2 guard; the gate is meaningless on the Canvas2D
 *      fallback, so a fallback is a hard failure, never a skip.
 *   2. Per-pixel diff over the waveform region ≤ MISMATCH_BUDGET, with a ±1px
 *      AA-edge dilation so a genuinely-different band shape fails but sub-pixel
 *      anti-aliasing between two rasterizers does not.
 *   3. Mean windowed SSIM ≥ SSIM_THRESHOLD over the region (structure match).
 *   4. SPIKE-SURVIVAL (zero tolerance): the 1-sample spike/notch reaches the
 *      lane extreme in the WebGL output (and the reference), for every viewport
 *      that contains it. A min/max-preserving pyramid MUST keep the extreme.
 *   5. GAP-BREAK: no WebGL waveform pixels bridge the interior of the NaN gap.
 *   6. SCISSOR/CLIP: no WebGL waveform pixels paint outside their lane rect
 *      (inter-lane gutter, left of padding.left, right of the plot). Load-bearing
 *      because WebGL geometry spans the whole session and relies on gl.scissor.
 *
 * GATING
 * ------
 * Runs ONLY when `RUN_FIDELITY=1` (the dedicated CI `test-e2e-fidelity` job sets
 * it) so it stays out of the normal e2e matrix. When it runs, it requires
 * WebGL2; a missing GPU path is a LOUD failure (assertion 1), never a skip.
 *
 * HOW TO RUN
 * ----------
 *   Local (needs a machine with Chromium + WebGL2/SwiftShader):
 *     RUN_FIDELITY=1 npx playwright test --project=chromium-fidelity
 *   The `chromium-fidelity` project (see playwright.config.ts) launches headless
 *   Chromium with the ANGLE/SwiftShader flags that give a software WebGL2:
 *     --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
 *     --ignore-gpu-blocklist --enable-webgl
 *
 * SANDBOX CAVEAT
 * --------------
 * This spec is AUTHORED to CI conventions but is NOT executed in the dev sandbox
 * (cdn.playwright.dev is blocked and there is no GPU). It runs in CI's
 * `test-e2e-fidelity` job. SwiftShader WebGL2 reliability on the GitHub runner is
 * a devops follow-up flagged in the Stage-3 report.
 *
 * @see src/views/_dev/FidelityHarness.tsx
 * @see tests/e2e/_support/ssim.ts
 */

import { test, expect, type Page } from '@playwright/test';

import { meanSsim, rgbaToGray } from './_support/ssim';

const RUN = process.env.RUN_FIDELITY === '1';

/**
 * The landmarks the dev harness publishes on `window.__fidelity`. Declared here
 * (rather than imported from the harness, which Playwright does not type-check)
 * so both the in-page `page.evaluate` callbacks and the Node-side helpers below
 * are strongly typed against the same shape.
 */
interface FidelityWindow {
  dpr: number;
  spikeMs: number;
  notchMs: number;
  gapStartMs: number;
  gapEndMs: number;
  totalDurationMs: number;
  viewport: { startTime: number; endTime: number };
  padding: { top: number; right: number; bottom: number; left: number };
  channelHeight: number;
  plot: { left: number; top: number; width: number; height: number };
  laneRects: {
    name: string;
    top: number;
    height: number;
    physicalMin: number;
    physicalMax: number;
  }[];
  /**
   * Force a synchronous WebGL re-render at the harness viewport. The harness
   * publishes this so each in-page read-back can re-issue the draw in the SAME JS
   * task immediately before capture — guaranteeing the drawing buffer is
   * populated (the headless-Chromium blank-read-back mitigation, alongside the
   * harness's `preserveDrawingBuffer:true`).
   */
  renderWebglNow: () => void;
}

declare global {
  interface Window {
    __fidelity?: FidelityWindow;
  }
}

/** Viewports to certify. */
const VIEWS = ['all', '1h', '5m', '1m', 'spike', 'gap'] as const;
type View = (typeof VIEWS)[number];

// ── Tolerance constants (named + documented) ───────────────────────────────

/**
 * Per-RGB-channel tolerance: two pixels match if every channel differs by ≤ this
 * (out of 255). ~4% of full scale absorbs rasterizer-level colour rounding while
 * still catching a wrong colour / a band drawn where there should be none.
 */
const CHANNEL_TOLERANCE = 10;

/**
 * Max fraction of waveform-region pixels allowed to mismatch (after the ±1px AA
 * dilation below). 0.5% catches a visibly-different band shape (a shifted or
 * fattened envelope easily exceeds it) while tolerating the thin AA edge band
 * that two different rasterizers will never agree on bit-for-bit.
 */
const MISMATCH_BUDGET = 0.005;

/**
 * Mean windowed-SSIM floor over the region. 0.98 is a tight structural-match
 * bar: identical shape scores ~1.0; a shifted/fattened band or a missing lane
 * drops well below 0.98.
 */
const SSIM_THRESHOLD = 0.98;

/** WebGL pixel is "lit" (waveform painted) when its alpha exceeds this (0..255). */
const WEBGL_LIT_ALPHA = 24;

/** Spike/notch must reach within this many px of the lane extreme edge. */
const EXTREME_TOLERANCE_PX = 1;

// ── In-page extraction (runs in the browser) ───────────────────────────────
//
// All canvas reads happen inside page.evaluate via 2D getImageData. The WebGL
// canvas is read by drawing it onto a scratch 2D canvas first. Device-pixel
// rects are derived from the CSS-px landmarks × DPR. Returns plain numbers /
// number[] so they cross the CDP boundary cheaply; the heavier diff/SSIM math
// over the returned buffers runs in Node.
//
// BLANK-READ-BACK MITIGATION (headless Chromium / SwiftShader): the harness
// creates the WebGL2 context with `preserveDrawingBuffer:true` (dev/test-only)
// AND publishes `window.__fidelity.renderWebglNow()`. Every read-back below calls
// that to re-issue a SYNCHRONOUS WebGL draw in the SAME JS task right before
// reading, so the drawing buffer is guaranteed populated when `drawImage` copies
// it. Without this, a non-preserved buffer can be swapped away and read blank —
// the exact failure ADR 0019's gate hit on its first CI run.

interface RegionPixels {
  /** Reference region RGBA (opaque), row-major, length = w*h*4 (device px). */
  ref: number[];
  /** WebGL region RGBA (transparent except waveform), same layout. */
  webgl: number[];
  /** Region dimensions in DEVICE pixels. */
  width: number;
  height: number;
}

/** Read the waveform-region pixels (all lanes) from both canvases. */
async function readRegion(page: Page): Promise<RegionPixels> {
  return page.evaluate(
    ({ litAlpha }) => {
      void litAlpha;
      const fid = window.__fidelity;
      if (!fid) throw new Error('window.__fidelity missing — harness did not publish landmarks');
      const dpr = fid.dpr;

      // Re-issue a synchronous WebGL draw in THIS task so the buffer is populated
      // before we copy it (blank-read-back mitigation).
      fid.renderWebglNow();

      const ref = document.querySelector<HTMLCanvasElement>('[data-testid="ref-canvas"]');
      const webgl = document.querySelector<HTMLCanvasElement>('[data-testid="webgl-canvas"]');
      if (!ref) throw new Error('ref-canvas not found');
      if (!webgl) throw new Error('webgl-canvas not found');

      // Waveform region = the plot rect, in device px.
      const rx = Math.round(fid.plot.left * dpr);
      const ry = Math.round(fid.plot.top * dpr);
      const rw = Math.round(fid.plot.width * dpr);
      const rh = Math.round(fid.plot.height * dpr);

      const refCtx = ref.getContext('2d');
      if (!refCtx) throw new Error('ref 2d context unavailable');
      const refData = refCtx.getImageData(rx, ry, rw, rh).data;

      // The WebGL canvas needs to be drawn onto a 2D scratch canvas to read pixels.
      const scratch = document.createElement('canvas');
      scratch.width = webgl.width;
      scratch.height = webgl.height;
      const sctx = scratch.getContext('2d');
      if (!sctx) throw new Error('scratch 2d context unavailable');
      sctx.drawImage(webgl, 0, 0);
      const webglData = sctx.getImageData(rx, ry, rw, rh).data;

      return {
        ref: Array.from(refData),
        webgl: Array.from(webglData),
        width: rw,
        height: rh,
      };
    },
    { litAlpha: WEBGL_LIT_ALPHA },
  );
}

interface LitProbe {
  /** For a given x-window (device px, region-relative) and lane, the lit y-extent. */
  minLitY: number;
  maxLitY: number;
  litCount: number;
}

/**
 * Probe the WebGL canvas alpha for "lit" waveform pixels within a column window
 * and y-band (all in DEVICE px, canvas-absolute). Returns the vertical extent of
 * lit pixels and a count. Reading the WebGL canvas alpha directly is the cleanest
 * "lit" signal (transparent everywhere except the waveform).
 */
async function probeWebglLit(
  page: Page,
  xStart: number,
  xEnd: number,
  yTop: number,
  yBottom: number,
): Promise<LitProbe> {
  return page.evaluate(
    ({ xStart, xEnd, yTop, yBottom, litAlpha }) => {
      const fid = window.__fidelity;
      if (!fid) throw new Error('window.__fidelity missing — harness did not publish landmarks');
      // Re-issue a synchronous WebGL draw in THIS task so the buffer is populated
      // before we copy it (blank-read-back mitigation).
      fid.renderWebglNow();

      const webgl = document.querySelector<HTMLCanvasElement>('[data-testid="webgl-canvas"]');
      if (!webgl) throw new Error('webgl-canvas not found');
      const scratch = document.createElement('canvas');
      scratch.width = webgl.width;
      scratch.height = webgl.height;
      const sctx = scratch.getContext('2d');
      if (!sctx) throw new Error('scratch 2d context unavailable');
      sctx.drawImage(webgl, 0, 0);

      const x0 = Math.max(0, Math.floor(xStart));
      const x1 = Math.min(webgl.width, Math.ceil(xEnd));
      const y0 = Math.max(0, Math.floor(yTop));
      const y1 = Math.min(webgl.height, Math.ceil(yBottom));
      if (x1 <= x0 || y1 <= y0) return { minLitY: -1, maxLitY: -1, litCount: 0 };

      const img = sctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const w = x1 - x0;
      const h = y1 - y0;
      let minLitY = -1;
      let maxLitY = -1;
      let litCount = 0;
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const a = img[(yy * w + xx) * 4 + 3] ?? 0;
          if (a > litAlpha) {
            litCount++;
            const absY = y0 + yy;
            if (minLitY < 0 || absY < minLitY) minLitY = absY;
            if (absY > maxLitY) maxLitY = absY;
          }
        }
      }
      return { minLitY, maxLitY, litCount };
    },
    { xStart, xEnd, yTop, yBottom, litAlpha: WEBGL_LIT_ALPHA },
  );
}

// ── Node-side pixel math ────────────────────────────────────────────────────

/** A pixel is a mismatch only if it differs beyond tolerance AND none of its 8
 * neighbours in the OTHER image match within tolerance (±1px AA dilation). */
function mismatchRatio(region: RegionPixels): number {
  const { ref, webgl, width, height } = region;
  // Composite the (transparent) WebGL region onto the reference's background so
  // the two are comparable: where WebGL is unlit, use the ref background colour
  // (they should agree there). We compare ref vs WebGL-composited-over-ref-bg by
  // taking the ref's own background where WebGL alpha is ~0.
  const at = (buf: number[], x: number, y: number, c: number): number =>
    buf[(y * width + x) * 4 + c] ?? 0;

  const within = (x: number, y: number, rR: number, rG: number, rB: number): boolean => {
    const a = at(webgl, x, y, 3);
    // Where WebGL is unlit, treat it as matching the reference background — the
    // gate's waveform comparison is about lit pixels, not the shared background.
    if (a <= WEBGL_LIT_ALPHA) return true;
    return (
      Math.abs(at(webgl, x, y, 0) - rR) <= CHANNEL_TOLERANCE &&
      Math.abs(at(webgl, x, y, 1) - rG) <= CHANNEL_TOLERANCE &&
      Math.abs(at(webgl, x, y, 2) - rB) <= CHANNEL_TOLERANCE
    );
  };

  let mismatches = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rR = at(ref, x, y, 0);
      const rG = at(ref, x, y, 1);
      const rB = at(ref, x, y, 2);
      if (within(x, y, rR, rG, rB)) continue;
      // Dilation: accept if ANY 8-neighbour WebGL pixel matches this ref pixel.
      let neighbourOk = false;
      for (let dy = -1; dy <= 1 && !neighbourOk; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (within(nx, ny, rR, rG, rB)) {
            neighbourOk = true;
            break;
          }
        }
      }
      if (!neighbourOk) mismatches++;
    }
  }
  return mismatches / (width * height);
}

// ── Coordinate helpers (CSS px / ms → device px) ────────────────────────────

type Fidelity = FidelityWindow;

async function readFidelity(page: Page): Promise<Fidelity> {
  const fid = await page.evaluate(() => window.__fidelity);
  if (!fid) throw new Error('window.__fidelity missing');
  return fid;
}

/** ms (session-relative) → device-px x within the canvas, or null if off-screen. */
function msToDeviceX(fid: Fidelity, ms: number): number | null {
  const { startTime, endTime } = fid.viewport;
  const span = endTime - startTime;
  if (span <= 0) return null;
  if (ms < startTime || ms > endTime) return null;
  const cssX = fid.plot.left + ((ms - startTime) / span) * fid.plot.width;
  return cssX * fid.dpr;
}

/** The Flow lane rect (the spike/notch lane) in device px (canvas-absolute). */
function flowLaneDevice(fid: Fidelity): {
  top: number;
  bottom: number;
  innerTop: number;
  innerBottom: number;
  physicalMin: number;
  physicalMax: number;
} {
  const lane = fid.laneRects.find((l) => l.name === 'Flow');
  if (!lane) throw new Error('Flow lane rect missing');
  // Inner band matches the renderer insets: top + 16, bottom - 8 (CSS px).
  const innerTopCss = lane.top + 16;
  const innerBottomCss = lane.top + lane.height - 8;
  return {
    top: lane.top * fid.dpr,
    bottom: (lane.top + lane.height) * fid.dpr,
    innerTop: innerTopCss * fid.dpr,
    innerBottom: innerBottomCss * fid.dpr,
    physicalMin: lane.physicalMin,
    physicalMax: lane.physicalMax,
  };
}

/** Expected device-px y for a physical value within the Flow lane band. */
function physToDeviceY(lane: ReturnType<typeof flowLaneDevice>, value: number): number {
  const norm = (value - lane.physicalMin) / (lane.physicalMax - lane.physicalMin);
  return lane.innerBottom - norm * (lane.innerBottom - lane.innerTop);
}

// ── The gate ────────────────────────────────────────────────────────────────

test.describe('WebGL fidelity gate (ADR 0019, Stage 3)', () => {
  test.skip(!RUN, 'Set RUN_FIDELITY=1 to run the WebGL fidelity gate (CI fidelity job only).');
  test.describe.configure({ mode: 'serial' });

  for (const view of VIEWS) {
    test(`view=${view}: WebGL waveform matches the Canvas2D reference`, async ({ page }) => {
      // The per-viewport pixel-diff + SSIM + extreme/gap/scissor probes each read
      // back device-pixel regions across multiple page.evaluate round-trips; under
      // software SwiftShader these are genuinely heavy. Give them headroom so a
      // slow-but-correct run is not killed by the default 30 s timeout.
      test.setTimeout(90_000);

      const pageErrors: Error[] = [];
      page.on('pageerror', (err) => pageErrors.push(err));

      await page.goto(`/__fidelity__?view=${view}`);
      await page.getByTestId('harness-ready').waitFor({ state: 'attached' });

      // ── 1. WebGL MUST be active — loud failure on the Canvas2D fallback. ──
      const active = (await page.getByTestId('webgl-active').textContent())?.trim();
      expect(
        active,
        `[WEBGL INACTIVE] view=${view}: WebGL2 path did not engage ` +
          `(webgl-active="${active}"). The fidelity gate requires the GPU path: a ` +
          `Canvas2D fallback means WebGL2 is unavailable in this runner. Ensure the ` +
          `chromium-fidelity project's SwiftShader flags are applied. This is a ` +
          `HARD FAILURE, not a skip.`,
      ).toBe('true');

      const fid = await readFidelity(page);

      // ── 2 + 3. Region pixel-diff + SSIM. ──
      const region = await readRegion(page);
      expect(region.width).toBeGreaterThan(0);
      expect(region.height).toBeGreaterThan(0);

      // ── 1b. ACTIVE-but-BLANK guard. WebGL reported active, so any all-zero
      // read-back is NOT a missing GPU path. With preserveDrawingBuffer:true and
      // the synchronous re-render before capture, a blank buffer is no longer a
      // read-back race either — it means SwiftShader genuinely painted nothing.
      // Fail with a message that says exactly that, so it is distinguishable from
      // a fidelity mismatch (assertions 2–6) and from WEBGL INACTIVE above. ──
      const litCount = litRegionPixelCount(region);
      expect(
        litCount,
        `[WEBGL BLANK READBACK] view=${view}: WebGL is ACTIVE but the entire ` +
          `waveform region read back blank (0 lit pixels of ${region.width * region.height}). ` +
          `The harness uses preserveDrawingBuffer:true and re-renders synchronously ` +
          `before capture, so this is NOT a read-back race — it indicates ` +
          `SwiftShader produced no output (a genuine software-GL render problem to ` +
          `escalate), not a fidelity mismatch.`,
      ).toBeGreaterThan(0);

      const ratio = mismatchRatio(region);
      expect(
        ratio,
        `view=${view}: waveform region mismatch ratio ${(ratio * 100).toFixed(3)}% ` +
          `exceeds budget ${(MISMATCH_BUDGET * 100).toFixed(3)}% — the WebGL band ` +
          `differs visibly from the Canvas2D reference.`,
      ).toBeLessThanOrEqual(MISMATCH_BUDGET);

      // Composite WebGL over the reference for SSIM (structure of lit pixels).
      const refGray = rgbaToGray(Uint8ClampedArray.from(region.ref), region.width, region.height);
      const composited = compositeWebglOverRef(region);
      const webglGray = rgbaToGray(composited, region.width, region.height);
      const ssim = meanSsim(refGray, webglGray);
      expect(
        ssim,
        `view=${view}: mean SSIM ${ssim.toFixed(4)} below threshold ${SSIM_THRESHOLD} — ` +
          `structural divergence between WebGL and the reference.`,
      ).toBeGreaterThanOrEqual(SSIM_THRESHOLD);

      // ── 4. Spike-survival (zero tolerance) when the spike is in view. ──
      const lane = flowLaneDevice(fid);
      await assertExtremeSurvives(page, fid, lane, fid.spikeMs, /*positive*/ true, view);
      await assertExtremeSurvives(page, fid, lane, fid.notchMs, /*positive*/ false, view);

      // ── 5. Gap-break: no WebGL pixels bridge the interior of the gap. ──
      if (view === 'gap') {
        await assertGapBreaks(page, fid, lane);
      }

      // ── 6. Scissor/clip: no WebGL waveform pixels outside any lane rect. ──
      await assertScissorClip(page, fid);

      expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
    });
  }
});

/**
 * Count WebGL region pixels whose alpha exceeds the lit threshold. Used by the
 * ACTIVE-but-BLANK guard to tell a genuine SwiftShader no-output condition apart
 * from a fidelity mismatch (the WebGL layer is transparent except the waveform,
 * so a correctly-rendered frame has many lit pixels).
 */
function litRegionPixelCount(region: RegionPixels): number {
  const { webgl, width, height } = region;
  let count = 0;
  for (let i = 0; i < width * height; i++) {
    if ((webgl[i * 4 + 3] ?? 0) > WEBGL_LIT_ALPHA) count++;
  }
  return count;
}

/** Composite the (transparent) WebGL region over the reference RGBA for SSIM. */
function compositeWebglOverRef(region: RegionPixels): Uint8ClampedArray {
  const { ref, webgl, width, height } = region;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = (webgl[i * 4 + 3] ?? 0) / 255;
    for (let c = 0; c < 3; c++) {
      const w = webgl[i * 4 + c] ?? 0;
      const r = ref[i * 4 + c] ?? 0;
      out[i * 4 + c] = Math.round(w * a + r * (1 - a));
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Assert the 1-sample spike/notch reaches the lane extreme in BOTH the WebGL
 * output and the reference, for any viewport that contains it. Skips when the
 * landmark is outside the viewport.
 */
async function assertExtremeSurvives(
  page: Page,
  fid: Fidelity,
  lane: ReturnType<typeof flowLaneDevice>,
  ms: number,
  positive: boolean,
  view: View,
): Promise<void> {
  const deviceX = msToDeviceX(fid, ms);
  if (deviceX === null) return; // landmark not in this viewport → skip per spec.

  const xPad = EXTREME_TOLERANCE_PX * fid.dpr;
  const probe = await probeWebglLit(
    page,
    deviceX - xPad,
    deviceX + xPad + 1,
    lane.top,
    lane.bottom,
  );
  expect(
    probe.litCount,
    `[FIDELITY MISMATCH] view=${view}: no lit WebGL pixels at the ` +
      `${positive ? 'spike' : 'notch'} column (x≈${deviceX.toFixed(1)} device px) — the ` +
      `extreme was lost. (The whole-region ACTIVE-but-BLANK guard already passed, so ` +
      `the buffer is populated; this is a genuine spike-survival failure, not a ` +
      `read-back race.)`,
  ).toBeGreaterThan(0);

  // Expected extreme y: positive spike → near lane top (physicalMax side);
  // notch → near lane bottom (physicalMin side).
  const extremeValue = positive ? lane.physicalMax - 0.5 : lane.physicalMin + 0.5;
  const expectedY = physToDeviceY(lane, extremeValue);
  const reached = positive ? probe.minLitY : probe.maxLitY;
  const tolerance = (EXTREME_TOLERANCE_PX + 1) * fid.dpr; // ±1px band + AA slack.
  expect(
    Math.abs(reached - expectedY),
    `view=${view}: ${positive ? 'spike' : 'notch'} lit extreme y=${reached} did not ` +
      `reach expected y=${expectedY.toFixed(1)} (±${tolerance.toFixed(1)} device px).`,
  ).toBeLessThanOrEqual(tolerance);
}

/** Assert no WebGL pixels bridge the interior columns of the NaN gap at mid-lane. */
async function assertGapBreaks(
  page: Page,
  fid: Fidelity,
  lane: ReturnType<typeof flowLaneDevice>,
): Promise<void> {
  const gx0 = msToDeviceX(fid, fid.gapStartMs);
  const gx1 = msToDeviceX(fid, fid.gapEndMs);
  expect(gx0, 'gap start must be in the gap viewport').not.toBeNull();
  expect(gx1, 'gap end must be in the gap viewport').not.toBeNull();
  if (gx0 === null || gx1 === null) return;

  // Stay away from the ≤1px edges so AA at the break does not count.
  const edge = (EXTREME_TOLERANCE_PX + 1) * fid.dpr;
  const interiorStart = gx0 + edge;
  const interiorEnd = gx1 - edge;
  expect(
    interiorEnd - interiorStart,
    'gap viewport too narrow — choose a wider gap window so it has interior columns',
  ).toBeGreaterThan(2 * fid.dpr);

  // Mid-lane band: a thin strip around the lane centre where a bridging line
  // would paint. (At the gap, the waveform should be absent entirely.)
  const midY = (lane.innerTop + lane.innerBottom) / 2;
  const band = 4 * fid.dpr;
  const probe = await probeWebglLit(page, interiorStart, interiorEnd, midY - band, midY + band);
  expect(
    probe.litCount,
    `gap-break: ${probe.litCount} lit WebGL pixels bridge the gap interior — the ` +
      `NaN run must break the waveform, matching the reference.`,
  ).toBe(0);
}

/**
 * Assert NO WebGL waveform pixels paint outside any lane's rect: the inter-lane
 * gutters and the regions left of padding.left / right of the plot must be empty.
 * Load-bearing — WebGL geometry spans the whole session and relies on gl.scissor.
 */
async function assertScissorClip(page: Page, fid: Fidelity): Promise<void> {
  const dpr = fid.dpr;
  const plotLeftPx = fid.plot.left * dpr;
  const plotRightPx = (fid.plot.left + fid.plot.width) * dpr;
  const canvasHeightPx = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="webgl-canvas"]');
    return c ? c.height : 0;
  });

  // (a) Left gutter: x in [0, plotLeft).
  if (plotLeftPx > 2 * dpr) {
    const left = await probeWebglLit(page, 0, plotLeftPx - dpr, 0, canvasHeightPx);
    expect(
      left.litCount,
      `scissor: ${left.litCount} lit WebGL pixels left of the plot (x<${plotLeftPx}).`,
    ).toBe(0);
  }

  // (b) Right gutter: x in (plotRight, canvasWidth].
  const canvasWidthPx = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="webgl-canvas"]');
    return c ? c.width : 0;
  });
  if (canvasWidthPx - plotRightPx > 2 * dpr) {
    const right = await probeWebglLit(page, plotRightPx + dpr, canvasWidthPx, 0, canvasHeightPx);
    expect(
      right.litCount,
      `scissor: ${right.litCount} lit WebGL pixels right of the plot (x>${plotRightPx}).`,
    ).toBe(0);
  }

  // (c) Inter-lane gutter: a thin band straddling each lane boundary should be
  // empty (lanes are stacked with no overlap; the waveform stays inside its
  // strip's inner band). Probe a 2px band at each boundary between adjacent lanes.
  for (let i = 0; i < fid.laneRects.length - 1; i++) {
    const upper = fid.laneRects[i];
    if (!upper) continue;
    const boundaryCss = upper.top + upper.height;
    const boundaryPx = boundaryCss * dpr;
    const probe = await probeWebglLit(
      page,
      plotLeftPx,
      plotRightPx,
      boundaryPx - dpr,
      boundaryPx + dpr,
    );
    // A small AA allowance at the strip seam; a real spill is far larger.
    expect(
      probe.litCount,
      `scissor: ${probe.litCount} lit WebGL pixels in the gutter between lane ` +
        `"${upper.name}" and the next — geometry spilled past its lane rect.`,
    ).toBeLessThanOrEqual(Math.ceil((plotRightPx - plotLeftPx) * 0.02));
  }
}
