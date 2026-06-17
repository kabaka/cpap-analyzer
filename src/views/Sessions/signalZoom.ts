/**
 * Pure zoom-interaction math for the Signal Viewer.
 *
 * Extracted out of the (otherwise canvas/OPFS-heavy) viewer so the wheel-zoom
 * sensitivity curve and the shift-drag "zoom-to-range" pixel→time conversion can
 * be unit-tested without mounting the full component or driving a real browser.
 *
 * Two concerns live here:
 *
 * 1. {@link wheelDeltaToZoomFactor} — converts a raw `WheelEvent` delta (which
 *    varies wildly by device: discrete line "notches" from a mouse wheel vs. a
 *    stream of tiny pixel deltas from a trackpad pinch) into a *gentle*,
 *    proportional multiplicative zoom factor. Using `exp(delta * rate)` makes
 *    successive events compose smoothly and symmetrically (zoom-in then the same
 *    zoom-out returns exactly to the start), and clamping the per-event factor
 *    stops one fat delta (or an inertial trackpad fling) from teleporting the
 *    zoom level.
 *
 * 2. {@link pixelRangeToTimeRange} — converts a pixel x-range dragged over the
 *    plot (the shift-drag rubber-band selection) into a session-relative time
 *    range, clamped to the session bounds and floored at the minimum zoom span.
 *
 * @module views/Sessions/signalZoom
 */

/** A `WheelEvent.deltaMode` value: pixels, lines, or pages. */
export const DOM_DELTA_PIXEL = 0;
export const DOM_DELTA_LINE = 1;
export const DOM_DELTA_PAGE = 2;

/**
 * Wheel-zoom sensitivity, expressed as the exponent rate `k` in
 * `factor = exp(normalizedDelta * k)`.
 *
 * The value is deliberately conservative/gentle so the zoom feels controllable
 * rather than "too touchy": one typical mouse-wheel notch (normalized to ≈1
 * line, see below) changes the view span by only ≈6 %, vs. the previous 50 % per
 * notch which made users overshoot and hunt.
 *
 * FINAL FEEL IS TUNED IN PRODUCTION BY THE PRODUCT OWNER — interaction feel
 * cannot be validated in CI (no real input device), so this is the single,
 * obvious knob to turn. Larger = faster/touchier zoom; smaller = gentler. Keep
 * it small; the per-event clamp below bounds the worst case regardless.
 */
export const WHEEL_ZOOM_RATE = 0.0625;

/**
 * Per-line scale applied to `DOM_DELTA_LINE` deltas to bring a single mouse
 * "notch" (usually `deltaY === ±1` line, sometimes ±3) into the same normalized
 * magnitude domain as a small batch of trackpad pixel deltas. One notch should
 * feel like a deliberate, modest zoom step — not a jump.
 */
export const LINE_TO_NORMALIZED = 1;

/**
 * Per-pixel scale applied to `DOM_DELTA_PIXEL` deltas. Trackpads emit many small
 * pixel deltas per gesture; dividing keeps each event's contribution tiny so the
 * accumulation across a pinch is smooth rather than jumpy. ~16px (one text line)
 * of pixel scroll ≈ one normalized unit ≈ one mouse-wheel line.
 */
export const PIXEL_TO_NORMALIZED = 1 / 16;

/**
 * Per-page scale for the rare `DOM_DELTA_PAGE` mode. Treated as a few lines so a
 * page-scroll wheel doesn't slam the zoom; the clamp still bounds it.
 */
export const PAGE_TO_NORMALIZED = 3;

/**
 * Maximum absolute normalized delta honoured for a SINGLE wheel event. Caps the
 * per-event zoom factor so one outsized delta (a chunky wheel driver, or the
 * spike at the start of a trackpad inertial fling) can't teleport the zoom. With
 * `WHEEL_ZOOM_RATE = 0.0625` this bounds a single event to ≈ exp(±0.5) ≈ ×0.6 /
 * ×1.65 — still gentle, and smooth gestures simply apply many sub-cap events.
 */
export const MAX_NORMALIZED_DELTA_PER_EVENT = 8;

/**
 * Minimum visible time window in ms (0.5 s). Mirrors `MIN_VIEWPORT_MS` in the
 * viewer; the deepest zoom-in clamp for BOTH wheel-zoom and shift-drag so a
 * sliver selection or a fast scroll can't zoom below the renderer's useful
 * resolution.
 */
export const MIN_VIEWPORT_MS = 500;

/**
 * Minimum horizontal drag (in CSS px) for a shift-drag selection to count as a
 * zoom. A shorter drag (or a plain shift-click) is treated as a no-op so the
 * viewport never snaps to an accidental sliver.
 */
export const MIN_SELECTION_PX = 5;

/**
 * Normalize a raw `WheelEvent` delta into a device-independent magnitude.
 *
 * Mouse wheels report `DOM_DELTA_LINE` with large discrete steps; trackpads
 * report `DOM_DELTA_PIXEL` with many tiny steps. Scaling each mode into a common
 * "normalized" domain lets a single `exp(delta * rate)` curve feel consistent
 * across devices.
 *
 * The sign is preserved (negative = zoom in, per the wheel convention) and the
 * magnitude is clamped to {@link MAX_NORMALIZED_DELTA_PER_EVENT}.
 */
export function normalizeWheelDelta(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY)) return 0;
  let scale: number;
  switch (deltaMode) {
    case DOM_DELTA_LINE:
      scale = LINE_TO_NORMALIZED;
      break;
    case DOM_DELTA_PAGE:
      scale = PAGE_TO_NORMALIZED;
      break;
    case DOM_DELTA_PIXEL:
    default:
      scale = PIXEL_TO_NORMALIZED;
      break;
  }
  const normalized = deltaY * scale;
  return Math.max(
    -MAX_NORMALIZED_DELTA_PER_EVENT,
    Math.min(MAX_NORMALIZED_DELTA_PER_EVENT, normalized),
  );
}

/**
 * Convert a raw `WheelEvent` delta into a multiplicative zoom factor for the
 * view span.
 *
 * Returns a factor to multiply the current view *duration* by. We follow the
 * standard wheel convention (`deltaY < 0` = wheel up / pinch out = zoom IN):
 * - `< 1` zooms IN  (deltaY negative — span shrinks),
 * - `> 1` zooms OUT (deltaY positive — span grows),
 * - `≈ 1` for a zero/near-zero delta (no-op).
 *
 * Because the factor is `exp(normalizedDelta * WHEEL_ZOOM_RATE)`, repeated
 * events compose by multiplication and a zoom-in immediately followed by the
 * mirror-image zoom-out returns exactly to the original span (no drift).
 */
export function wheelDeltaToZoomFactor(deltaY: number, deltaMode: number): number {
  const normalized = normalizeWheelDelta(deltaY, deltaMode);
  return Math.exp(normalized * WHEEL_ZOOM_RATE);
}

/** A session-relative time window in ms. */
export interface TimeRange {
  readonly startTime: number;
  readonly endTime: number;
}

/**
 * Apply a multiplicative zoom `factor` to `current`, anchored so the time under
 * the cursor stays put. `cursorFraction` is the pointer's position across the
 * plot in [0, 1] (0 = left edge, 1 = right edge).
 *
 * The new span is floored at {@link MIN_VIEWPORT_MS} and capped at
 * `totalDurationMs`, then slid back inside `[0, totalDurationMs]` so the window
 * never runs off either session edge while preserving its (clamped) span.
 */
export function applyCursorAnchoredZoom(
  current: TimeRange,
  factor: number,
  cursorFraction: number,
  totalDurationMs: number,
): TimeRange {
  const span = current.endTime - current.startTime;
  if (span <= 0 || totalDurationMs <= 0) return current;

  const frac = Math.max(0, Math.min(1, cursorFraction));
  const cursorTimeMs = current.startTime + frac * span;

  let newSpan = span * factor;
  newSpan = Math.max(MIN_VIEWPORT_MS, Math.min(totalDurationMs, newSpan));

  let newStart = cursorTimeMs - frac * newSpan;
  let newEnd = newStart + newSpan;
  if (newStart < 0) {
    newStart = 0;
    newEnd = newSpan;
  }
  if (newEnd > totalDurationMs) {
    newEnd = totalDurationMs;
    newStart = Math.max(0, newEnd - newSpan);
  }
  return { startTime: newStart, endTime: newEnd };
}

/** Result of evaluating a shift-drag rubber-band selection. */
export type SelectionZoomResult =
  /** Drag too small (or degenerate) — caller should NOT change the viewport. */
  | { readonly kind: 'noop' }
  /** Apply this clamped time range as the new viewport. */
  | { readonly kind: 'zoom'; readonly range: TimeRange };

/**
 * Convert a pixel x-range dragged over the plot into a session-relative time
 * range to zoom into.
 *
 * Inputs are two pointer x-positions *relative to the canvas* (in CSS px, in any
 * order); `plotLeft`/`plotWidth` describe the plot's drawable band inside the
 * canvas padding. `current` is the live viewport the drag started over, used to
 * map pixels → time.
 *
 * Returns `{ kind: 'noop' }` when the drag is shorter than
 * {@link MIN_SELECTION_PX} (a shift-click or accidental nudge), otherwise a
 * clamped `{ kind: 'zoom', range }`:
 * - x is clamped to the plot band before conversion (a drag that runs off the
 *   edge selects up to that edge),
 * - the resulting time range is clamped to `[0, totalDurationMs]`,
 * - the span is floored at {@link MIN_VIEWPORT_MS} (don't zoom below the max
 *   zoom-in limit), re-centred on the selection and slid inside the bounds.
 */
export function pixelRangeToTimeRange(
  xA: number,
  xB: number,
  plotLeft: number,
  plotWidth: number,
  current: TimeRange,
  totalDurationMs: number,
): SelectionZoomResult {
  if (plotWidth <= 0 || totalDurationMs <= 0) return { kind: 'noop' };
  const span = current.endTime - current.startTime;
  if (span <= 0) return { kind: 'noop' };

  const loPx = Math.min(xA, xB);
  const hiPx = Math.max(xA, xB);
  if (hiPx - loPx < MIN_SELECTION_PX) return { kind: 'noop' };

  // Clamp to the plot band, then map to a fraction of the live viewport.
  const clampPx = (x: number): number => Math.max(plotLeft, Math.min(plotLeft + plotWidth, x));
  const fracLo = (clampPx(loPx) - plotLeft) / plotWidth;
  const fracHi = (clampPx(hiPx) - plotLeft) / plotWidth;

  let startTime = current.startTime + fracLo * span;
  let endTime = current.startTime + fracHi * span;

  // Floor the span at the max zoom-in limit, re-centred on the selection.
  let newSpan = endTime - startTime;
  if (newSpan < MIN_VIEWPORT_MS) {
    const center = (startTime + endTime) / 2;
    startTime = center - MIN_VIEWPORT_MS / 2;
    endTime = center + MIN_VIEWPORT_MS / 2;
    newSpan = MIN_VIEWPORT_MS;
  }

  // Slide-clamp inside the session bounds, preserving the (clamped) span.
  if (startTime < 0) {
    startTime = 0;
    endTime = Math.min(totalDurationMs, newSpan);
  }
  if (endTime > totalDurationMs) {
    endTime = totalDurationMs;
    startTime = Math.max(0, endTime - newSpan);
  }

  return { kind: 'zoom', range: { startTime, endTime } };
}
