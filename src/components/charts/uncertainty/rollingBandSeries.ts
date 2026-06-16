/**
 * Chart-side adapter for the rolling robust band (consensus D3).
 *
 * Turns a chronological nightly series into per-point chart records carrying a
 * rolling **median** centre and a **P25–P75 inter-quartile band** — the
 * "typical nightly range". The statistics themselves live in (and are tested
 * in) `@/analysis/uncertainty` via {@link rollingMedianBand}; this module only
 * shapes that output for a recharts floating-band `<Area>` (a `[lower, upper]`
 * 2-tuple datum) plus a centre `<Line>`.
 *
 * Performance: this operates purely on per-night aggregates (a few hundred
 * points over years), never the 25 Hz signal, so it is trivially memoisable in
 * the chart's existing `useMemo` and never touches the decimation pyramid.
 *
 * @module components/charts/uncertainty/rollingBandSeries
 */

import { rollingMedianBand } from '@/analysis/uncertainty';

/**
 * Default trailing window (nights) for the AHI "typical nightly range" band.
 *
 * Seven nights smooths single-night Poisson/biological noise while staying
 * responsive to genuine regime changes; biological reliability of nightly AHI
 * plateaus around 1–2 weeks (accuracy review §7). Exposed as a constant so the
 * window is a single, documented decision rather than a magic number.
 */
export const AHI_BAND_WINDOW_NIGHTS = 7;

/** One chart record with the rolling band attached. */
export interface BandSeriesPoint<T> {
  /** The original datum, spread through unchanged. */
  readonly source: T;
  /** Rolling median (P50) centre, or `null` when undefined (empty window). */
  readonly median: number | null;
  /**
   * Floating band as a `[lower, upper]` 2-tuple for a recharts range `<Area>`,
   * or `null` when undefined. recharts renders a `null` datum as a gap.
   */
  readonly band: readonly [number, number] | null;
}

/**
 * Build a rolling median + P25–P75 band over a numeric accessor of a series.
 *
 * Non-finite medians/quartiles (e.g. a window with no finite values) are
 * emitted as `null` so the chart shows a gap rather than a spurious 0.
 *
 * @param series chronological data (e.g. nightly aggregates).
 * @param value accessor returning the metric to band (e.g. `d => d.ahi`).
 * @param window trailing window length in points (default
 *   {@link AHI_BAND_WINDOW_NIGHTS}).
 */
export function buildRollingBandSeries<T>(
  series: readonly T[],
  value: (d: T) => number,
  window: number = AHI_BAND_WINDOW_NIGHTS,
): BandSeriesPoint<T>[] {
  const values = series.map(value);
  const band = rollingMedianBand(values, window);

  return series.map((source, i) => {
    const point = band[i];
    if (
      point === undefined ||
      !Number.isFinite(point.median) ||
      !Number.isFinite(point.p25) ||
      !Number.isFinite(point.p75)
    ) {
      return { source, median: null, band: null };
    }
    return {
      source,
      median: point.median,
      band: [point.p25, point.p75] as const,
    };
  });
}
