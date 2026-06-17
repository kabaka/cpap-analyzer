/**
 * Tests for the Signal Viewer's pure zoom-interaction math.
 *
 * Covers:
 * - Device-aware wheel-delta normalization (line vs. pixel vs. page) and the
 *   per-event magnitude clamp.
 * - The exp-based zoom factor: direction, gentleness, multiplicative symmetry
 *   (zoom-in then mirror zoom-out returns to the start), and zero-delta no-op.
 * - Cursor-anchored zoom keeping the time under the pointer fixed, plus the
 *   min-span / max-span / edge-slide clamps.
 * - Shift-drag pixel→time conversion: noop below the min drag, x-order
 *   independence, plot-band clamping, the minimum-zoom-span floor, and
 *   session-edge slide clamping.
 */

import { describe, it, expect } from 'vitest';

import {
  applyCursorAnchoredZoom,
  DOM_DELTA_LINE,
  DOM_DELTA_PAGE,
  DOM_DELTA_PIXEL,
  MAX_NORMALIZED_DELTA_PER_EVENT,
  MIN_SELECTION_PX,
  MIN_VIEWPORT_MS,
  normalizeWheelDelta,
  pixelRangeToTimeRange,
  wheelDeltaToZoomFactor,
  WHEEL_ZOOM_RATE,
} from '../signalZoom';

describe('normalizeWheelDelta', () => {
  it('scales line, pixel, and page modes into a common domain', () => {
    // One mouse-wheel line notch normalizes to ≈1; ~16px of trackpad scroll is
    // comparable; a page is a few "lines".
    expect(normalizeWheelDelta(1, DOM_DELTA_LINE)).toBeCloseTo(1);
    expect(normalizeWheelDelta(16, DOM_DELTA_PIXEL)).toBeCloseTo(1);
    expect(normalizeWheelDelta(1, DOM_DELTA_PAGE)).toBeCloseTo(3);
  });

  it('preserves sign (negative = zoom in)', () => {
    expect(normalizeWheelDelta(-1, DOM_DELTA_LINE)).toBeLessThan(0);
    expect(normalizeWheelDelta(1, DOM_DELTA_LINE)).toBeGreaterThan(0);
  });

  it('clamps an outsized single delta to the per-event cap', () => {
    expect(normalizeWheelDelta(100000, DOM_DELTA_PIXEL)).toBe(MAX_NORMALIZED_DELTA_PER_EVENT);
    expect(normalizeWheelDelta(-100000, DOM_DELTA_PIXEL)).toBe(-MAX_NORMALIZED_DELTA_PER_EVENT);
  });

  it('treats a non-finite delta as zero (NaN and Infinity are safe no-ops)', () => {
    expect(normalizeWheelDelta(Number.NaN, DOM_DELTA_LINE)).toBe(0);
    expect(normalizeWheelDelta(Number.POSITIVE_INFINITY, DOM_DELTA_PIXEL)).toBe(0);
    // A large-but-finite delta still clamps to the per-event cap.
    expect(normalizeWheelDelta(1e9, DOM_DELTA_PIXEL)).toBe(MAX_NORMALIZED_DELTA_PER_EVENT);
  });
});

describe('wheelDeltaToZoomFactor', () => {
  it('returns 1 (no-op) for a zero delta', () => {
    expect(wheelDeltaToZoomFactor(0, DOM_DELTA_LINE)).toBe(1);
  });

  it('zooms in (<1) for negative delta and out (>1) for positive delta', () => {
    // Standard wheel convention: deltaY < 0 (wheel up / pinch out) zooms IN.
    expect(wheelDeltaToZoomFactor(-1, DOM_DELTA_LINE)).toBeLessThan(1);
    expect(wheelDeltaToZoomFactor(1, DOM_DELTA_LINE)).toBeGreaterThan(1);
  });

  it('is gentle: one wheel notch changes the span by only a few percent', () => {
    const factor = wheelDeltaToZoomFactor(1, DOM_DELTA_LINE);
    // ~6% per notch — clearly gentler than the old ×1.5 (50%) per notch.
    expect(factor).toBeGreaterThan(1.0);
    expect(factor).toBeLessThan(1.1);
    expect(factor).toBeCloseTo(Math.exp(WHEEL_ZOOM_RATE), 6);
  });

  it('composes multiplicatively and is symmetric (in then mirror-out returns)', () => {
    const inFactor = wheelDeltaToZoomFactor(-1, DOM_DELTA_LINE);
    const outFactor = wheelDeltaToZoomFactor(1, DOM_DELTA_LINE);
    expect(inFactor * outFactor).toBeCloseTo(1, 10);
  });
});

describe('applyCursorAnchoredZoom', () => {
  const TOTAL = 60_000; // 1 minute

  it('keeps the time under the cursor fixed when zooming in', () => {
    const current = { startTime: 0, endTime: TOTAL };
    const frac = 0.25;
    const cursorTime = current.startTime + frac * (current.endTime - current.startTime);
    const next = applyCursorAnchoredZoom(current, 0.5, frac, TOTAL);
    const nextCursorTime = next.startTime + frac * (next.endTime - next.startTime);
    expect(nextCursorTime).toBeCloseTo(cursorTime, 6);
    expect(next.endTime - next.startTime).toBeCloseTo(TOTAL * 0.5, 6);
  });

  it('floors the span at the minimum viewport', () => {
    const current = { startTime: 0, endTime: MIN_VIEWPORT_MS };
    const next = applyCursorAnchoredZoom(current, 0.0001, 0.5, TOTAL);
    expect(next.endTime - next.startTime).toBeGreaterThanOrEqual(MIN_VIEWPORT_MS);
  });

  it('caps the span at the total duration and clamps to the left edge', () => {
    const current = { startTime: 10_000, endTime: 20_000 };
    const next = applyCursorAnchoredZoom(current, 100, 0.5, TOTAL);
    expect(next.startTime).toBe(0);
    expect(next.endTime).toBeLessThanOrEqual(TOTAL);
    expect(next.endTime - next.startTime).toBeCloseTo(TOTAL, 6);
  });

  it('slides inside the right edge without overrunning', () => {
    const current = { startTime: 50_000, endTime: 60_000 };
    // Zoom out near the right edge; the window must slide left, not overflow.
    const next = applyCursorAnchoredZoom(current, 2, 1, TOTAL);
    expect(next.endTime).toBeLessThanOrEqual(TOTAL);
    expect(next.startTime).toBeGreaterThanOrEqual(0);
  });

  it('returns the input unchanged for a degenerate span', () => {
    const current = { startTime: 5, endTime: 5 };
    expect(applyCursorAnchoredZoom(current, 0.5, 0.5, TOTAL)).toBe(current);
  });
});

describe('pixelRangeToTimeRange', () => {
  const PLOT_LEFT = 56;
  const PLOT_WIDTH = 1000;
  const TOTAL = 600_000; // 10 minutes
  const current = { startTime: 0, endTime: TOTAL };

  it('is a no-op for a drag shorter than the minimum', () => {
    const res = pixelRangeToTimeRange(
      PLOT_LEFT + 100,
      PLOT_LEFT + 100 + (MIN_SELECTION_PX - 1),
      PLOT_LEFT,
      PLOT_WIDTH,
      current,
      TOTAL,
    );
    expect(res.kind).toBe('noop');
  });

  it('is a no-op for a zero-width shift-click', () => {
    const res = pixelRangeToTimeRange(
      PLOT_LEFT + 300,
      PLOT_LEFT + 300,
      PLOT_LEFT,
      PLOT_WIDTH,
      current,
      TOTAL,
    );
    expect(res.kind).toBe('noop');
  });

  it('maps a mid-plot half-width drag to the middle quarter of the viewport', () => {
    const res = pixelRangeToTimeRange(
      PLOT_LEFT + 0.25 * PLOT_WIDTH,
      PLOT_LEFT + 0.75 * PLOT_WIDTH,
      PLOT_LEFT,
      PLOT_WIDTH,
      current,
      TOTAL,
    );
    expect(res.kind).toBe('zoom');
    if (res.kind !== 'zoom') return;
    expect(res.range.startTime).toBeCloseTo(0.25 * TOTAL, 4);
    expect(res.range.endTime).toBeCloseTo(0.75 * TOTAL, 4);
  });

  it('is independent of drag direction (left→right === right→left)', () => {
    const ltr = pixelRangeToTimeRange(
      PLOT_LEFT + 200,
      PLOT_LEFT + 600,
      PLOT_LEFT,
      PLOT_WIDTH,
      current,
      TOTAL,
    );
    const rtl = pixelRangeToTimeRange(
      PLOT_LEFT + 600,
      PLOT_LEFT + 200,
      PLOT_LEFT,
      PLOT_WIDTH,
      current,
      TOTAL,
    );
    expect(ltr).toEqual(rtl);
  });

  it('clamps a drag that runs off the plot edges to the plot band', () => {
    const res = pixelRangeToTimeRange(
      -500,
      PLOT_LEFT + PLOT_WIDTH + 500,
      PLOT_LEFT,
      PLOT_WIDTH,
      current,
      TOTAL,
    );
    expect(res.kind).toBe('zoom');
    if (res.kind !== 'zoom') return;
    expect(res.range.startTime).toBeCloseTo(0, 4);
    expect(res.range.endTime).toBeCloseTo(TOTAL, 4);
  });

  it('floors a thin selection at the minimum zoom span, re-centred', () => {
    // A drag just over MIN_SELECTION_PX in the middle of the plot maps to a tiny
    // time span; it must be widened to MIN_VIEWPORT_MS about its centre.
    const startPx = PLOT_LEFT + 0.5 * PLOT_WIDTH;
    const res = pixelRangeToTimeRange(
      startPx,
      startPx + MIN_SELECTION_PX + 1,
      PLOT_LEFT,
      PLOT_WIDTH,
      current,
      TOTAL,
    );
    expect(res.kind).toBe('zoom');
    if (res.kind !== 'zoom') return;
    const widenedSpan = res.range.endTime - res.range.startTime;
    expect(widenedSpan).toBeGreaterThanOrEqual(MIN_VIEWPORT_MS);
    // Widened about the (tiny) selection's own centre, which sits ≈ mid-plot.
    // Tolerance covers the few-px selection width mapped to time (≈1.8 s here).
    const center = (res.range.startTime + res.range.endTime) / 2;
    expect(Math.abs(center - 0.5 * TOTAL)).toBeLessThan(5_000);
  });

  it('slide-clamps a min-span selection at the right edge', () => {
    // Tiny selection at the far right: widening to MIN_VIEWPORT_MS must slide
    // left so it stays inside [0, TOTAL].
    const res = pixelRangeToTimeRange(
      PLOT_LEFT + PLOT_WIDTH - 1,
      PLOT_LEFT + PLOT_WIDTH,
      PLOT_LEFT,
      PLOT_WIDTH,
      current,
      TOTAL,
    );
    // 1px < MIN_SELECTION_PX → noop; bump to a qualifying drag at the edge.
    const res2 = pixelRangeToTimeRange(
      PLOT_LEFT + PLOT_WIDTH - (MIN_SELECTION_PX + 2),
      PLOT_LEFT + PLOT_WIDTH,
      PLOT_LEFT,
      PLOT_WIDTH,
      current,
      TOTAL,
    );
    expect(res.kind).toBe('noop');
    expect(res2.kind).toBe('zoom');
    if (res2.kind !== 'zoom') return;
    expect(res2.range.endTime).toBeLessThanOrEqual(TOTAL);
    expect(res2.range.startTime).toBeGreaterThanOrEqual(0);
    expect(res2.range.endTime - res2.range.startTime).toBeGreaterThanOrEqual(MIN_VIEWPORT_MS);
  });

  it('is a no-op when the plot width or total duration is non-positive', () => {
    expect(pixelRangeToTimeRange(0, 100, PLOT_LEFT, 0, current, TOTAL).kind).toBe('noop');
    expect(pixelRangeToTimeRange(0, 100, PLOT_LEFT, PLOT_WIDTH, current, 0).kind).toBe('noop');
  });
});
