/**
 * Data-space → clip-space transform for the WebGL2 waveform renderer.
 *
 * The Canvas2D reference renderer ({@link
 * module:components/charts/canvas/SignalRenderer}) maps a sample to a CSS-pixel
 * position with two independent linear transforms:
 *
 *   - **X** (time / sample index):
 *       `x_css = plotLeft + (tMs - viewStartMs) * (plotWidth / viewSpanMs)`
 *     where for the uniform-cadence CPAP path `tMs = sampleIndex * msPerSample`
 *     and `msPerSample = viewSpanMs / sampleCount`. Equivalently, X is linear in
 *     a data-space coordinate that is *either* a session-relative millisecond
 *     value *or* a sample index — both are affine in the viewport, so this module
 *     stays agnostic: the caller supplies a data-space X range `[dataXStart,
 *     dataXEnd)` that corresponds to the lane's plot extent.
 *
 *   - **Y** (physical units):
 *       `innerTop    = stripTop + TOP_INSET`
 *       `innerBottom = stripTop + stripHeight - BOTTOM_INSET`
 *       `y_css = innerBottom - ((value - physicalMin) / physRange) * innerHeight`
 *     (top = physicalMax, bottom = physicalMin), with `innerHeight = innerBottom
 *     - innerTop`. These insets reserve the lane's top label strip exactly as the
 *     Canvas2D `drawLine` / `drawEnvelope` paths do.
 *
 * WebGL clip space is `[-1, +1]` on both axes, with **+Y up** (the opposite of
 * canvas, where +Y is down) and the origin at the centre of the *drawing
 * buffer*. The drawing buffer is `cssW * dpr` × `cssH * dpr` device pixels (DPR
 * is preserved at 2 — never reduced — per ADR 0019). Because clip space is
 * already normalised, the transform is **DPR-independent for vertex positions**:
 * a CSS-pixel coordinate maps to the same clip coordinate regardless of DPR
 * (DPR only changes how many device pixels back each clip unit, which the
 * viewport/scissor handle). DPR therefore enters only the *scissor* maths
 * ({@link module:components/charts/webgl/laneScissor}) and the *screen-space
 * line width* expansion in the shader, not this transform.
 *
 * The transform is expressed as per-axis `scale`/`offset` pairs so the GPU
 * computes `clip = data * scale + offset` in the vertex shader — a single MAD.
 * Pan changes only the X offset (via `viewStart`); zoom changes the X scale (via
 * `viewSpan`). Neither re-uploads geometry — exactly the property ADR 0019
 * requires to remove the per-frame texture re-upload.
 *
 * Everything here is **pure** and unit-tested against the Canvas2D pixel
 * mapping; no GL context is touched.
 *
 * @module components/charts/webgl/waveformTransform
 */

/**
 * Top label-strip inset (CSS px) reserved above the waveform within a lane.
 * Mirrors `stripTop + 16` in {@link
 * module:components/charts/canvas/SignalRenderer} `drawLine`/`drawEnvelope`.
 */
export const LANE_TOP_INSET = 16;

/**
 * Bottom inset (CSS px) reserved below the waveform within a lane. Mirrors
 * `stripTop + stripHeight - 8` in the Canvas2D paths.
 */
export const LANE_BOTTOM_INSET = 8;

/** A lane's plot rectangle in CSS pixels (the strip the lane paints into). */
export interface LaneRect {
  /** Left edge (CSS px) of the plot area (canvas `plotLeft`). */
  readonly plotLeft: number;
  /** Plot width (CSS px) (canvas `plotWidth`). */
  readonly plotWidth: number;
  /** Top edge (CSS px) of the lane strip (canvas `stripTop`). */
  readonly stripTop: number;
  /** Lane strip height (CSS px) (canvas `stripHeight`). */
  readonly stripHeight: number;
}

/** Current horizontal viewport in data-space X units (ms or sample index). */
export interface ViewportX {
  /** Inclusive data-space X at the left plot edge. */
  readonly viewStart: number;
  /** Data-space X span across the plot width (`viewEnd - viewStart`). */
  readonly viewSpan: number;
}

/** A lane's physical-value Y range (canvas `physicalMin`/`physicalMax`). */
export interface PhysicalRange {
  readonly physicalMin: number;
  readonly physicalMax: number;
}

/**
 * Per-axis affine transform from data space to WebGL clip space, applied in the
 * vertex shader as `clip = data * scale + offset` per axis.
 */
export interface WaveformClipTransform {
  /** X scale: clip-units per data-space X unit. */
  readonly scaleX: number;
  /** X offset: clip X when data-space X is 0. */
  readonly offsetX: number;
  /** Y scale: clip-units per physical-value unit (negative — physics up). */
  readonly scaleY: number;
  /** Y offset: clip Y when the physical value is 0. */
  readonly offsetY: number;
}

/**
 * Compute the CSS-pixel inner-plot Y extent for a lane, identical to the
 * Canvas2D `drawLine`/`drawEnvelope` insets.
 */
export function laneInnerYExtent(lane: LaneRect): {
  innerTop: number;
  innerBottom: number;
  innerHeight: number;
} {
  const innerTop = lane.stripTop + LANE_TOP_INSET;
  const innerBottom = lane.stripTop + lane.stripHeight - LANE_BOTTOM_INSET;
  return { innerTop, innerBottom, innerHeight: innerBottom - innerTop };
}

/**
 * Map a data-space X coordinate to a CSS-pixel X, identical to the Canvas2D
 * `x = plotLeft + (dataX - viewStart) * (plotWidth / viewSpan)` mapping. Pure
 * reference used by the unit tests to pin the GPU transform to the canvas.
 */
export function dataXToCssX(dataX: number, view: ViewportX, lane: LaneRect): number {
  if (view.viewSpan === 0) return lane.plotLeft;
  return lane.plotLeft + ((dataX - view.viewStart) / view.viewSpan) * lane.plotWidth;
}

/**
 * Map a physical value to a CSS-pixel Y, identical to the Canvas2D
 * `y = innerBottom - ((value - physicalMin) / physRange) * innerHeight` mapping.
 */
export function valueToCssY(value: number, phys: PhysicalRange, lane: LaneRect): number {
  const { innerBottom, innerHeight } = laneInnerYExtent(lane);
  const physRange = phys.physicalMax - phys.physicalMin;
  if (physRange === 0) return innerBottom;
  return innerBottom - ((value - phys.physicalMin) / physRange) * innerHeight;
}

/**
 * Convert a CSS-pixel X to a clip-space X for a drawing buffer `cssWidth` CSS px
 * wide. Clip X is `(cssX / cssWidth) * 2 - 1` (left edge → -1, right edge → +1);
 * DPR-independent because both numerator and the buffer scale by DPR.
 */
export function cssXToClipX(cssX: number, cssWidth: number): number {
  if (cssWidth === 0) return -1;
  return (cssX / cssWidth) * 2 - 1;
}

/**
 * Convert a CSS-pixel Y to a clip-space Y for a drawing buffer `cssHeight` CSS px
 * tall. Canvas Y grows downward; clip Y grows upward, so the mapping flips:
 * `1 - (cssY / cssHeight) * 2` (top edge → +1, bottom edge → -1).
 */
export function cssYToClipY(cssY: number, cssHeight: number): number {
  if (cssHeight === 0) return 1;
  return 1 - (cssY / cssHeight) * 2;
}

/**
 * Build the per-lane data→clip affine transform.
 *
 * Composes the two Canvas2D pixel mappings (X: data→css, Y: value→css) with the
 * css→clip normalisation, then folds each composition into a single
 * `scale`/`offset` pair so the shader runs one MAD per axis.
 *
 * Correctness: for every input the produced transform satisfies
 *   `clipX = dataXToClipX(dataX) == cssXToClipX(dataXToCssX(dataX, ...), cssWidth)`
 *   `clipY = valueToClipY(value) == cssYToClipY(valueToCssY(value, ...), cssHeight)`
 * which the unit tests assert exhaustively — the GPU output is therefore pinned
 * to the Canvas2D reference to within float precision.
 *
 * @param view      - Horizontal viewport in data-space X.
 * @param phys      - Lane physical Y range.
 * @param lane      - Lane plot rect (CSS px).
 * @param cssWidth  - Drawing-buffer width in CSS px (canvas logical width).
 * @param cssHeight - Drawing-buffer height in CSS px (canvas logical height).
 */
export function computeWaveformClipTransform(
  view: ViewportX,
  phys: PhysicalRange,
  lane: LaneRect,
  cssWidth: number,
  cssHeight: number,
): WaveformClipTransform {
  // ── X: dataX → cssX → clipX ─────────────────────────────────────
  // cssX   = plotLeft + (dataX - viewStart) * (plotWidth / viewSpan)
  // clipX  = (cssX / cssWidth) * 2 - 1
  // Fold:  clipX = dataX * scaleX + offsetX
  let scaleX = 0;
  let offsetX = -1;
  if (view.viewSpan !== 0 && cssWidth !== 0) {
    const pxPerX = lane.plotWidth / view.viewSpan; // css px per data-space X unit
    const cssXAt0 = lane.plotLeft - view.viewStart * pxPerX; // cssX when dataX == 0
    const clipPerCssX = 2 / cssWidth;
    scaleX = pxPerX * clipPerCssX;
    offsetX = cssXAt0 * clipPerCssX - 1;
  }

  // ── Y: value → cssY → clipY ─────────────────────────────────────
  // cssY   = innerBottom - ((value - physicalMin) / physRange) * innerHeight
  // clipY  = 1 - (cssY / cssHeight) * 2
  // Fold:  clipY = value * scaleY + offsetY
  let scaleY = 0;
  let offsetY = 1;
  const physRange = phys.physicalMax - phys.physicalMin;
  if (physRange !== 0 && cssHeight !== 0) {
    const { innerBottom, innerHeight } = laneInnerYExtent(lane);
    const cssPerValue = -innerHeight / physRange; // css px per value (negative: value up)
    const cssYAt0 = innerBottom - (0 - phys.physicalMin) * (innerHeight / physRange);
    const clipPerCssY = -2 / cssHeight;
    scaleY = cssPerValue * clipPerCssY;
    offsetY = cssYAt0 * clipPerCssY + 1;
  }

  return { scaleX, offsetX, scaleY, offsetY };
}

/** Apply a {@link WaveformClipTransform} to a data-space X (test/diagnostic helper). */
export function applyClipX(t: WaveformClipTransform, dataX: number): number {
  return dataX * t.scaleX + t.offsetX;
}

/** Apply a {@link WaveformClipTransform} to a physical value (test/diagnostic helper). */
export function applyClipY(t: WaveformClipTransform, value: number): number {
  return value * t.scaleY + t.offsetY;
}
