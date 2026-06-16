/**
 * Per-lane scissor rectangle for the WebGL2 waveform renderer.
 *
 * The Canvas2D reference renderer wraps every dense-waveform draw in a
 * LOAD-BEARING clip:
 *
 * ```
 * ctx.rect(plotLeft, stripTop, plotWidth, stripHeight);
 * ctx.clip();
 * ```
 *
 * which guarantees an out-of-domain (e.g. clamped corrupt) sample can never
 * paint into a neighbouring lane. The WebGL2 path must reproduce that guarantee
 * exactly, using `gl.scissor`.
 *
 * Two coordinate-system differences must be handled:
 *
 *  1. **Device pixels, not CSS pixels.** The drawing buffer is `cssW * dpr` ×
 *     `cssH * dpr` device pixels (DPR preserved at 2 — never reduced — per ADR
 *     0019). `gl.scissor` takes device-pixel coordinates, so the CSS-px clip rect
 *     is multiplied by DPR.
 *
 *  2. **Bottom-left origin, +Y up.** Canvas Y grows downward from the top;
 *     WebGL's scissor box has its origin at the **bottom-left** of the drawing
 *     buffer with +Y up. The rect's Y is therefore flipped:
 *       `deviceY_bottom = bufferHeight - (stripTop + stripHeight) * dpr`.
 *
 * Rounding matches integer device pixels: the left/top edges floor and the
 * right/bottom edges ceil before differencing, so the scissor box never clips a
 * fractional edge pixel the canvas clip would have painted (a deliberate,
 * documented +/-1 device-pixel conservative bias at lane edges — see the fidelity
 * notes in the renderer). Negative widths/heights are clamped to 0.
 *
 * Pure and unit-tested against {@link
 * module:components/charts/canvas/SignalRenderer.computeLaneLayout}; no GL
 * context is touched.
 *
 * @module components/charts/webgl/laneScissor
 */

/** A scissor box in device pixels, ready for `gl.scissor(x, y, width, height)`. */
export interface ScissorRect {
  /** Device-pixel X of the box's left edge (bottom-left origin). */
  readonly x: number;
  /** Device-pixel Y of the box's bottom edge (bottom-left origin, +Y up). */
  readonly y: number;
  /** Device-pixel width (≥ 0). */
  readonly width: number;
  /** Device-pixel height (≥ 0). */
  readonly height: number;
}

/** The CSS-pixel clip rect for a lane (mirrors the Canvas2D `ctx.rect` args). */
export interface LaneClipRectCss {
  /** Left edge (CSS px). */
  readonly plotLeft: number;
  /** Top edge (CSS px). */
  readonly stripTop: number;
  /** Width (CSS px). */
  readonly plotWidth: number;
  /** Height (CSS px). */
  readonly stripHeight: number;
}

/**
 * Convert a lane's CSS-pixel clip rect into a device-pixel, bottom-left-origin
 * scissor box.
 *
 * @param rect             - The lane clip rect in CSS px (the Canvas2D clip args).
 * @param dpr              - Device-pixel ratio (preserved at 2; never reduced).
 * @param bufferHeightDevice - Drawing-buffer height in device px (`cssHeight * dpr`,
 *   i.e. `canvas.height`). Used for the Y flip.
 */
export function computeLaneScissor(
  rect: LaneClipRectCss,
  dpr: number,
  bufferHeightDevice: number,
): ScissorRect {
  // Edges in device px. Floor the min edges, ceil the max edges, so the integer
  // box is the smallest one that fully covers the CSS rect (never under-clips an
  // edge pixel the canvas painted).
  const leftDev = Math.floor(rect.plotLeft * dpr);
  const rightDev = Math.ceil((rect.plotLeft + rect.plotWidth) * dpr);
  const topDev = Math.floor(rect.stripTop * dpr); // distance from buffer TOP
  const bottomDev = Math.ceil((rect.stripTop + rect.stripHeight) * dpr); // from buffer TOP

  const width = Math.max(0, rightDev - leftDev);
  const height = Math.max(0, bottomDev - topDev);

  // Flip Y: scissor origin is bottom-left. The box's bottom edge measured from
  // the buffer bottom is `bufferHeight - bottomDev` (bottomDev is from the top).
  const y = Math.max(0, bufferHeightDevice - bottomDev);

  return { x: Math.max(0, leftDev), y, width, height };
}
