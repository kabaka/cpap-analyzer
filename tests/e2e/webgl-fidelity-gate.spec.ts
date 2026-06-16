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
 * WHAT IT ASSERTS, per viewport (`all`, `5m`, `spike`, `gap`)
 * --------------------------------------------------------------------------
 *
 * VIEW MATRIX (CI VIABILITY)
 * --------------------------
 * Trimmed from the original six (`all`,`1h`,`5m`,`1m`,`spike`,`gap`) to FOUR
 * representative views so the whole `chromium-fidelity` job finishes in minutes,
 * not the 25+ it ground to under software SwiftShader. The dropped two were pure
 * redundancy; the kept four still cover every distinct render path:
 *   - `all`   — whole-night ENVELOPE mode (raw samples/px ≫ 1). The path the
 *               just-fixed spike-attenuation bug lived in; contains spike, notch
 *               AND gap. Highest-value single view.
 *   - `5m`    — zoomed-in LINE mode + the envelope→line transition band.
 *   - `spike` — narrow (~1 min) LINE-mode window on the spike/notch, so spike
 *               survival is certified in BOTH envelope (`all`) and line (`spike`)
 *               paths. Cheap: a small viewport, same probe geometry.
 *   - `gap`   — narrow window around the NaN run; the ONLY view that exercises
 *               `assertGapBreaks` (the gap-bridging regression guard).
 *   DROPPED `1h` (viewport IDENTICAL to `all` — `0..TOTAL_DURATION_MS` — pure
 *   duplication) and `1m` (a second pure line-mode window adding nothing over
 *   `5m`/`spike`).
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

/**
 * Viewports to certify. Trimmed to the four representative views (see the file
 * header's VIEW MATRIX note) for CI viability: `all` (envelope), `5m` (line +
 * transition), `spike` (line-mode spike/notch survival), `gap` (gap-break).
 */
const VIEWS = ['all', '5m', 'spike', 'gap'] as const;
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

/**
 * Reference (Canvas2D) "lit" detector. The reference layer is OPAQUE — it paints
 * the waveform in the saturated lane colour over a near-neutral surface
 * background — so alpha cannot signal "lit" as it does on the transparent WebGL
 * layer. Instead we use CHROMA: a pixel is a waveform pixel when its colourfulness
 * `max(|R-G|, |G-B|, |R-B|)` exceeds this threshold. The lane colours are
 * saturated (Flow `#3b82f6` → |R-B| ≈ 187) while every background the harness can
 * resolve (white `#ffffff`, light grey `#f5f5f5`, and their dark-theme analogues)
 * is neutral grey with chroma ≈ 0. 40/255 sits far above AA-blended-grey noise
 * yet far below the saturated lane colour, so it is background-/theme-agnostic and
 * does not depend on knowing the exact surface shade.
 */
const REF_LIT_CHROMA = 40;

/** Spike/notch must reach within this many px of the lane extreme edge. */
const EXTREME_TOLERANCE_PX = 1;

/**
 * WebGL-vs-REFERENCE reached-extreme agreement, in CSS px (scaled by DPR at use).
 * This is the gate's TRUE invariant — "WebGL matches the Canvas2D reference" —
 * and is immune to the AA-vs-analytic mismatch that an absolute analytic bar
 * suffers under software SwiftShader. 3 CSS px (= 6 device px at DPR 2) comfortably
 * absorbs the sub-pixel AA-fade + litAlpha/litChroma threshold asymmetry between
 * the two rasterizers at a band edge (the observed CI miss was ~2.35 CSS px on the
 * notch's bottom edge) while remaining an order of magnitude below the ~24.5 CSS px
 * (49 device px) gross attenuation the just-fixed spike bug produced. See
 * `assertExtremeSurvives` for the regression-still-caught argument.
 */
const EXTREME_REF_MATCH_PX = 3;

/**
 * LOOSE analytic sanity margin, in CSS px (scaled by DPR at use). After the
 * reference-relative check (above) proves WebGL tracks the reference, this only
 * guards against "the extreme is in totally the wrong place" — e.g. a squashed or
 * vertically-shifted waveform whose reference ALSO moved would pass the relative
 * check, so we still bound the WebGL extreme to a generous neighbourhood of the
 * analytic lane edge. 12 CSS px (= 24 device px at DPR 2) is ~13% of the lane's
 * inner band; a correct extreme is within ~2–3 CSS px of analytic, so this never
 * trips on AA, but a waveform compressed to half-amplitude (extreme pulled tens of
 * px toward lane centre) blows past it.
 */
const EXTREME_ANALYTIC_MARGIN_PX = 12;

/**
 * Column stride (in DEVICE px) for the region pixel-diff + SSIM read-back. Rather
 * than marshalling the ENTIRE plot rect (≈2000×1200 device px → a ~9.6M-element
 * array per canvas, twice, over CDP — the dominant cost that made the gate take
 * 25+ min under SwiftShader), we sample every Nth COLUMN. Stride 3 reads ⅓ of the
 * columns: a structurally representative sub-grid that still spans the full lane
 * width, so a shifted/fattened/missing band (which is many px wide) is caught, but
 * the per-view marshalling + Node pixel math drop ~3×. Rows are NOT strided so the
 * vertical band-edge structure SSIM keys on is preserved. The strided buffer is
 * laid out as a dense `sampledWidth × height` image (the stride is collapsed), so
 * the downstream diff/SSIM operate on a normal contiguous region.
 */
const REGION_COL_STRIDE = 3;

// ── In-page extraction (runs in the browser) ───────────────────────────────
//
// All canvas reads happen inside page.evaluate via 2D getImageData. The WebGL
// canvas is read by drawing it onto a scratch 2D canvas first. Device-pixel
// rects are derived from the CSS-px landmarks × DPR. Returns plain numbers /
// number[] so they cross the CDP boundary cheaply; the heavier diff/SSIM math
// over the returned buffers runs in Node.
//
// COST CONTROL (CI viability): the region we read is the FLOW LANE BAND ONLY —
// the lane that carries the spike/notch and the densest structure — not the whole
// multi-lane plot, and we COLUMN-STRIDE it (REGION_COL_STRIDE). One lane band is
// ~⅓ the plot height and the stride drops another ~3×, so each read-back marshals
// roughly an ORDER OF MAGNITUDE fewer pixels than the old full-plot read while
// still covering the full session width and the full vertical band a regression
// would move. Spike/notch survival, gap-break and scissor probes are unchanged
// (they already read tiny targeted windows).
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
  /** Region dimensions in DEVICE pixels (width = column-strided/collapsed). */
  width: number;
  height: number;
}

/**
 * Read the waveform-region pixels from both canvases, scoped to the FLOW LANE
 * BAND and COLUMN-STRIDED (see REGION_COL_STRIDE) to keep the per-view read-back
 * cheap under software SwiftShader. The returned buffer is a dense
 * `sampledWidth × height` image (the stride collapsed) so the Node-side diff/SSIM
 * treat it as an ordinary contiguous region.
 */
async function readRegion(page: Page): Promise<RegionPixels> {
  return page.evaluate(
    ({ stride }) => {
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

      // Region = the FLOW LANE band intersected with the plot rect, in device px.
      // (One lane band instead of the whole multi-lane plot: ~⅓ the height, and
      // the lane that carries the spike/notch + densest structure.)
      const flow = fid.laneRects.find((l) => l.name === 'Flow');
      if (!flow) throw new Error('Flow lane rect missing');
      const rx = Math.round(fid.plot.left * dpr);
      const rw = Math.round(fid.plot.width * dpr);
      const laneTopPx = Math.round(flow.top * dpr);
      const laneBottomPx = Math.round((flow.top + flow.height) * dpr);
      const ry = Math.max(Math.round(fid.plot.top * dpr), laneTopPx);
      const rh = Math.min(Math.round((fid.plot.top + fid.plot.height) * dpr), laneBottomPx) - ry;
      if (rw <= 0 || rh <= 0) throw new Error('flow-lane region has non-positive size');

      const refCtx = ref.getContext('2d');
      if (!refCtx) throw new Error('ref 2d context unavailable');
      const refFull = refCtx.getImageData(rx, ry, rw, rh).data;

      // The WebGL canvas needs to be drawn onto a 2D scratch canvas to read pixels.
      const scratch = document.createElement('canvas');
      scratch.width = webgl.width;
      scratch.height = webgl.height;
      const sctx = scratch.getContext('2d');
      if (!sctx) throw new Error('scratch 2d context unavailable');
      sctx.drawImage(webgl, 0, 0);
      const webglFull = sctx.getImageData(rx, ry, rw, rh).data;

      // Collapse columns by `stride` into a dense sampledWidth × rh image. We pick
      // every stride-th source column; the result is a normal contiguous region.
      const s = Math.max(1, Math.floor(stride));
      const sampledWidth = Math.ceil(rw / s);
      const refOut = new Array<number>(sampledWidth * rh * 4);
      const webglOut = new Array<number>(sampledWidth * rh * 4);
      for (let y = 0; y < rh; y++) {
        for (let sx = 0; sx < sampledWidth; sx++) {
          const srcX = sx * s;
          const src = (y * rw + srcX) * 4;
          const dst = (y * sampledWidth + sx) * 4;
          refOut[dst] = refFull[src] ?? 0;
          refOut[dst + 1] = refFull[src + 1] ?? 0;
          refOut[dst + 2] = refFull[src + 2] ?? 0;
          refOut[dst + 3] = refFull[src + 3] ?? 0;
          webglOut[dst] = webglFull[src] ?? 0;
          webglOut[dst + 1] = webglFull[src + 1] ?? 0;
          webglOut[dst + 2] = webglFull[src + 2] ?? 0;
          webglOut[dst + 3] = webglFull[src + 3] ?? 0;
        }
      }

      return { ref: refOut, webgl: webglOut, width: sampledWidth, height: rh };
    },
    { stride: REGION_COL_STRIDE },
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

/**
 * Probe the REFERENCE (Canvas2D) canvas for "lit" waveform pixels within a column
 * window and y-band (all in DEVICE px, canvas-absolute). The reference is opaque,
 * so "lit" is detected by CHROMA (colourfulness) rather than alpha: a saturated
 * lane-colour pixel is the waveform; a near-neutral grey pixel is background/grid.
 * Mirrors {@link probeWebglLit}'s geometry exactly so the two reached-extremes are
 * directly comparable. No `renderWebglNow()` call — the reference is drawn once at
 * harness mount and never swapped.
 */
async function probeRefLit(
  page: Page,
  xStart: number,
  xEnd: number,
  yTop: number,
  yBottom: number,
): Promise<LitProbe> {
  return page.evaluate(
    ({ xStart, xEnd, yTop, yBottom, litChroma }) => {
      const ref = document.querySelector<HTMLCanvasElement>('[data-testid="ref-canvas"]');
      if (!ref) throw new Error('ref-canvas not found');
      const rctx = ref.getContext('2d');
      if (!rctx) throw new Error('ref 2d context unavailable');

      const x0 = Math.max(0, Math.floor(xStart));
      const x1 = Math.min(ref.width, Math.ceil(xEnd));
      const y0 = Math.max(0, Math.floor(yTop));
      const y1 = Math.min(ref.height, Math.ceil(yBottom));
      if (x1 <= x0 || y1 <= y0) return { minLitY: -1, maxLitY: -1, litCount: 0 };

      const img = rctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const w = x1 - x0;
      const h = y1 - y0;
      let minLitY = -1;
      let maxLitY = -1;
      let litCount = 0;
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const i = (yy * w + xx) * 4;
          const r = img[i] ?? 0;
          const g = img[i + 1] ?? 0;
          const b = img[i + 2] ?? 0;
          const chroma = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
          if (chroma > litChroma) {
            litCount++;
            const absY = y0 + yy;
            if (minLitY < 0 || absY < minLitY) minLitY = absY;
            if (absY > maxLitY) maxLitY = absY;
          }
        }
      }
      return { minLitY, maxLitY, litCount };
    },
    { xStart, xEnd, yTop, yBottom, litChroma: REF_LIT_CHROMA },
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
  // NOT `serial`. Each view test is fully independent — it does its own
  // `page.goto('/__fidelity__?view=…')`, which mounts a fresh harness that
  // republishes `window.__fidelity` and tears it down on unmount, so there is no
  // cross-test harness/page state to protect with serial ordering. We deliberately
  // drop `mode: 'serial'` (which STOPS at the first failing view) so a single CI run
  // surfaces EVERY remaining divergence across the kept views at once, rather than
  // one borderline tolerance per CI cycle. The CI fidelity job pins `workers: 1`
  // (playwright.config.ts), so the views still execute one-at-a-time on a single
  // SwiftShader context — no parallel software-GL contention that could induce the
  // blank-read-backs the harness mitigates.

  for (const view of VIEWS) {
    test(`view=${view}: WebGL waveform matches the Canvas2D reference`, async ({ page }) => {
      // 40 s per view. The region read-back is now the FLOW LANE band, column-
      // strided (REGION_COL_STRIDE) — roughly an order of magnitude fewer pixels
      // than the old full-plot read — and the targeted probes are tiny, so a
      // correct view completes in single-digit seconds even under SwiftShader.
      // 40 s leaves generous headroom for a cold dev-server compile on the first
      // view without the 90 s ceiling that let a stuck run burn 2×90 s on retry.
      test.setTimeout(40_000);

      const pageErrors: Error[] = [];
      page.on('pageerror', (err) => pageErrors.push(err));

      await page.goto(`/__fidelity__?view=${view}`);
      // Bound the harness-ready wait explicitly: if the dev-only harness never
      // mounts (e.g. the route was dropped or the build broke), fail FAST with a
      // clear message instead of letting the spec hang to the test timeout.
      await page
        .getByTestId('harness-ready')
        .waitFor({ state: 'attached', timeout: 15_000 })
        .catch(() => {
          throw new Error(
            `[FIDELITY HARNESS NOT READY] view=${view}: /__fidelity__ did not publish ` +
              `the harness-ready marker within 15 s. The dev-only fidelity harness did not ` +
              `mount — check the /__fidelity__ route and dev-server build, not the renderer.`,
          );
        });

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

      // ── 2 + 3. Region pixel-diff + SSIM (Flow lane band, column-strided). ──
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
 * Assert the 1-sample spike/notch reaches the lane extreme in the WebGL output —
 * REFERENCE-RELATIVE. The gate's true invariant is "WebGL matches the Canvas2D
 * reference", so we probe the SAME extreme column on BOTH canvases and assert the
 * WebGL reached-extreme tracks the REFERENCE's reached-extreme, not an analytic
 * ideal. This is immune to the AA-vs-analytic mismatch that an absolute
 * `physToDeviceY(... ± 0.5)` bar suffers under software SwiftShader (where the
 * notch's bottom-edge lit pixel falls ~2.35 CSS px shy of analytic from AA fade +
 * the lit threshold, not from lost data).
 *
 * Three layered checks, each failing loudly and distinguishably:
 *   (a) WebGL has lit pixels at the column at all (extreme not totally lost).
 *   (b) PRIMARY: WebGL reached-extreme is within `EXTREME_REF_MATCH_PX` of the
 *       REFERENCE reached-extreme. Catches gross attenuation (the just-fixed spike
 *       bug left WebGL ~49 device px short of the reference — fails by ~8×).
 *   (c) LOOSE analytic sanity: the WebGL extreme is within
 *       `EXTREME_ANALYTIC_MARGIN_PX` of the analytic lane edge AND in the correct
 *       half of the lane. Catches a squashed/shifted waveform whose reference moved
 *       in lock-step (so (b) would pass) but whose extreme is nowhere near the edge.
 *
 * Skips when the landmark is outside the viewport.
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
  const x0 = deviceX - xPad;
  const x1 = deviceX + xPad + 1;
  const [webglProbe, refProbe] = await Promise.all([
    probeWebglLit(page, x0, x1, lane.top, lane.bottom),
    probeRefLit(page, x0, x1, lane.top, lane.bottom),
  ]);

  const kind = positive ? 'spike' : 'notch';

  // (a) The extreme must exist at all in WebGL (not totally lost).
  expect(
    webglProbe.litCount,
    `[FIDELITY MISMATCH] view=${view}: no lit WebGL pixels at the ${kind} column ` +
      `(x≈${deviceX.toFixed(1)} device px) — the extreme was lost. (The whole-region ` +
      `ACTIVE-but-BLANK guard already passed, so the buffer is populated; this is a ` +
      `genuine spike-survival failure, not a read-back race.)`,
  ).toBeGreaterThan(0);
  // The reference MUST have lit the extreme — if it did not, the harness/landmarks
  // are wrong (a fixture bug), surfaced distinctly from a WebGL regression.
  expect(
    refProbe.litCount,
    `view=${view}: no lit REFERENCE pixels at the ${kind} column (x≈${deviceX.toFixed(1)} ` +
      `device px). The Canvas2D reference itself did not paint the extreme — this is a ` +
      `harness/landmark fixture bug, not a WebGL fidelity mismatch.`,
  ).toBeGreaterThan(0);

  // For the positive spike the extreme is the TOPMOST lit pixel (minLitY); for the
  // notch it is the BOTTOMMOST (maxLitY). Compare WebGL vs reference on the SAME edge.
  const webglReached = positive ? webglProbe.minLitY : webglProbe.maxLitY;
  const refReached = positive ? refProbe.minLitY : refProbe.maxLitY;

  // (b) PRIMARY — reference-relative agreement. Immune to AA-vs-analytic mismatch.
  const refMatchTol = EXTREME_REF_MATCH_PX * fid.dpr;
  expect(
    Math.abs(webglReached - refReached),
    `[FIDELITY MISMATCH] view=${view}: WebGL ${kind} reached-extreme y=${webglReached} ` +
      `diverges from the Canvas2D reference's reached-extreme y=${refReached} by ` +
      `${Math.abs(webglReached - refReached).toFixed(1)} device px (tol ` +
      `±${refMatchTol.toFixed(1)}). WebGL is not tracking the reference at the extreme — ` +
      `a min/max-preserving pyramid MUST keep the 1-sample ${kind}; gross attenuation ` +
      `(the WebGL spike bug left WebGL tens of px short of the reference) fails here.`,
  ).toBeLessThanOrEqual(refMatchTol);

  // (c) LOOSE analytic sanity — catches a squashed/shifted waveform whose reference
  // moved with it (so (b) passes). The analytic extreme y is the band edge; require
  // the WebGL extreme to be near it AND on the correct side of lane centre.
  const extremeValue = positive ? lane.physicalMax - 0.5 : lane.physicalMin + 0.5;
  const analyticY = physToDeviceY(lane, extremeValue);
  const analyticMargin = EXTREME_ANALYTIC_MARGIN_PX * fid.dpr;
  expect(
    Math.abs(webglReached - analyticY),
    `[FIDELITY MISMATCH] view=${view}: WebGL ${kind} reached-extreme y=${webglReached} is ` +
      `${Math.abs(webglReached - analyticY).toFixed(1)} device px from the analytic lane ` +
      `edge y=${analyticY.toFixed(1)} (loose margin ±${analyticMargin.toFixed(1)}). Even ` +
      `tracking the reference, the extreme is nowhere near the band edge — the waveform ` +
      `looks squashed or vertically shifted.`,
  ).toBeLessThanOrEqual(analyticMargin);

  const laneMidY = (lane.innerTop + lane.innerBottom) / 2;
  if (positive) {
    expect(
      webglReached,
      `[FIDELITY MISMATCH] view=${view}: WebGL spike extreme y=${webglReached} is below ` +
        `lane centre y=${laneMidY.toFixed(1)} — a positive spike must reach the TOP half.`,
    ).toBeLessThan(laneMidY);
  } else {
    expect(
      webglReached,
      `[FIDELITY MISMATCH] view=${view}: WebGL notch extreme y=${webglReached} is above ` +
        `lane centre y=${laneMidY.toFixed(1)} — a negative notch must reach the BOTTOM half.`,
    ).toBeGreaterThan(laneMidY);
  }
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
  const [probe, refProbe] = await Promise.all([
    probeWebglLit(page, interiorStart, interiorEnd, midY - band, midY + band),
    probeRefLit(page, interiorStart, interiorEnd, midY - band, midY + band),
  ]);
  // Reference-relative: the WebGL gap interior must be at least as empty as the
  // reference's. The reference breaks the waveform at the NaN run, so refProbe
  // should be 0; allowing `refProbe.litCount` as the bar means that if the
  // reference rasterizer ever leaves a stray mid-band AA pixel we do not punish
  // WebGL for matching it. In practice both are 0 — a real bridging line (WebGL
  // interpolating across the NaN run) lights the whole interior strip, far above
  // any reference AA speck.
  expect(
    probe.litCount,
    `gap-break: ${probe.litCount} lit WebGL pixels bridge the gap interior ` +
      `(reference has ${refProbe.litCount} there) — the NaN run must break the waveform, ` +
      `matching the reference.`,
  ).toBeLessThanOrEqual(refProbe.litCount);
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
