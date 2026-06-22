/**
 * Pure scale helpers for the Canvas2D Trends charts.
 *
 * The Trends X axis is a CATEGORICAL axis over per-night date strings. Recharts
 * builds it differently depending on the chart kind, and these helpers replicate
 * that EXACTLY so the migrated Canvas2D charts are pixel-faithful to the previous
 * Recharts/SVG output:
 *
 * - **Line / Area / Composed charts WITHOUT a bar** (AHI, Leak, Pressure, Event
 *   Breakdown, Settings) use a d3 **`scalePoint`** (see Recharts `parseScale`).
 *   With the default `padding = 0`, `align = 0.5` and a `[0, W]` range, the i-th
 *   category sits at `i * step` where `step = W / (N - 1)` for `N > 1` (so the
 *   first point is flush at the left edge and the last flush at the right edge),
 *   and at the band CENTRE (`W / 2`) for a single category.
 *
 * - **Bar charts** (Usage) use a d3 **`scaleBand`**. With the default
 *   `paddingInner = 0`, `paddingOuter = 0`, `align = 0.5` and a `[0, W]` range,
 *   the i-th band's LEFT EDGE is `i * step` where `step = bandwidth = W / N`. A
 *   single bar series within a band is then placed by Recharts' `getBarPosition`:
 *   with the default `barCategoryGap = '10%'` the inner offset is `0.1 *
 *   bandwidth` and the bar width is `floor(0.8 * bandwidth)` (a single series, no
 *   `barSize`/`maxBarSize`, no `barGap` contribution).
 *
 * Everything here is a pure function of `(index, count, plotLeft, plotWidth)` so
 * it is fully unit-testable without a DOM, mirroring the project's
 * `SignalRenderer` axis helpers.
 *
 * @module views/Trends/charts/canvas/scale
 */

import { computeAxisMax } from '../chartScale';

export { computeAxisMax };

/**
 * X (CSS px) of the categorical POINT for index `i` of `count` categories on a
 * `scalePoint` axis spanning `[plotLeft, plotLeft + plotWidth]`.
 *
 * Mirrors d3 `scalePoint` with default padding/align: first point flush left,
 * last flush right, evenly spaced; a single category is centred.
 */
export function pointX(i: number, count: number, plotLeft: number, plotWidth: number): number {
  if (count <= 0) return plotLeft;
  if (count === 1) return plotLeft + plotWidth / 2;
  const step = plotWidth / (count - 1);
  return plotLeft + i * step;
}

/**
 * The `scalePoint` step (px) — also the effective "band size" Recharts reports
 * for a point axis (min tick spacing), used to width settings-marker hover
 * targets and to centre tooltips. For `count <= 1` the whole plot width is the
 * step (matching Recharts' single-tick fallback).
 */
export function pointStep(count: number, plotWidth: number): number {
  if (count <= 1) return plotWidth;
  return plotWidth / (count - 1);
}

/**
 * LEFT EDGE (CSS px) of the band for index `i` of `count` categories on a
 * `scaleBand` axis spanning `[plotLeft, plotLeft + plotWidth]`. Mirrors d3
 * `scaleBand` with default zero padding and `align = 0.5`.
 */
export function bandLeft(i: number, count: number, plotLeft: number, plotWidth: number): number {
  if (count <= 0) return plotLeft;
  const step = plotWidth / count;
  return plotLeft + i * step;
}

/** Band width (px) for a zero-padding `scaleBand` of `count` categories. */
export function bandWidth(count: number, plotWidth: number): number {
  if (count <= 0) return 0;
  return plotWidth / count;
}

/**
 * CENTRE (CSS px) of band index `i` on a `scaleBand` axis — where the crosshair
 * reference line and the bar-chart tooltip cursor are drawn (Recharts offsets a
 * band-scale grid/cursor by `bandwidth / 2`).
 */
export function bandCenter(i: number, count: number, plotLeft: number, plotWidth: number): number {
  return bandLeft(i, count, plotLeft, plotWidth) + bandWidth(count, plotWidth) / 2;
}

/** A single bar's geometry within its band, per Recharts `getBarPosition`. */
export interface BarGeometry {
  /** Left X (CSS px) of the bar rectangle. */
  readonly x: number;
  /** Bar width (CSS px). */
  readonly width: number;
}

/**
 * Geometry of the single Usage bar in band index `i`, replicating Recharts'
 * `getBarPosition` for ONE series with the default `barCategoryGap = '10%'` and
 * no explicit `barSize`/`maxBarSize`:
 *   inner offset = `floor`-free `0.1 * bandwidth`
 *   bar width    = `floor(0.8 * bandwidth)` (Recharts `>> 0` truncation when > 1)
 *
 * The truncation matches Recharts so the rendered bar width is identical to the
 * pixel the SVG `<rect>` used.
 */
export function singleBarGeometry(
  i: number,
  count: number,
  plotLeft: number,
  plotWidth: number,
  categoryGapFraction = 0.1,
): BarGeometry {
  const bw = bandWidth(count, plotWidth);
  const offset = categoryGapFraction * bw;
  let size = bw - 2 * offset; // one series, no barGap
  if (size > 1) size = Math.floor(size); // Recharts `originalSize >>= 0`
  const left = bandLeft(i, count, plotLeft, plotWidth) + offset;
  return { x: left, width: Math.max(0, size) };
}

/**
 * Map a physical value to a Y coordinate (CSS px) within the plot rectangle for
 * a linear Y domain `[domainMin, domainMax]`. `domainMax` maps to `plotTop`,
 * `domainMin` to `plotTop + plotHeight` (Y grows downward, value grows upward) —
 * the same orientation Recharts uses for a numeric Y axis.
 */
export function valueY(
  value: number,
  domainMin: number,
  domainMax: number,
  plotTop: number,
  plotHeight: number,
): number {
  const range = domainMax - domainMin;
  if (range <= 0) return plotTop + plotHeight;
  const norm = (value - domainMin) / range;
  return plotTop + plotHeight - norm * plotHeight;
}

/**
 * Nice Y tick values for a `[domainMin, domainMax]` axis at a target tick count,
 * matching d3's `ticks` "nice step" behaviour (1/2/5 × 10^k) that Recharts uses.
 * Returned ascending, inclusive of any nice value within the domain.
 */
export function niceYTicks(domainMin: number, domainMax: number, maxTicks: number): number[] {
  const range = domainMax - domainMin;
  if (range <= 0 || maxTicks < 2) return [domainMin, domainMax];

  const rawStep = range / maxTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceSteps = [1, 2, 5, 10];
  let step = magnitude;
  for (const n of niceSteps) {
    if (n * magnitude >= rawStep) {
      step = n * magnitude;
      break;
    }
  }

  const ticks: number[] = [];
  const start = Math.ceil(domainMin / step) * step;
  for (let v = start; v <= domainMax + step * 1e-9; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

/**
 * Resolve the nearest category index for a pointer X (CSS px) on a categorical
 * axis. Works for both point and band scales by nearest-centre matching, which
 * is how Recharts hit-tests hover (`calculateActiveTickIndex`). Returns `null`
 * when there are no categories or the pointer is outside the plot.
 *
 * @param isBand - true for the bar chart's `scaleBand`, false for `scalePoint`.
 */
export function indexAtX(
  x: number,
  count: number,
  plotLeft: number,
  plotWidth: number,
  isBand: boolean,
): number | null {
  if (count <= 0) return null;
  if (count === 1) return 0;
  // Nearest category centre. For a band scale the centre is offset by half a
  // band; for a point scale the point itself is the centre.
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < count; i++) {
    const cx = isBand
      ? bandCenter(i, count, plotLeft, plotWidth)
      : pointX(i, count, plotLeft, plotWidth);
    const d = Math.abs(x - cx);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}
