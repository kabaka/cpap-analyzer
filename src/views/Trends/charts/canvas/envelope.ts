/**
 * Per-pixel-column MIN/MAX envelope for the AHI chart's faint raw per-night line.
 *
 * THE ONE HONESTY CHANGE (scoped to `AHITrendChart`): when there are MORE nights
 * than horizontal pixel columns in the plot, plotting one polyline vertex per
 * night forces several nights to share a single device pixel column. A plain
 * polyline then picks an arbitrary vertex per column and can visually SWALLOW a
 * spike night between two calm neighbours. To keep the faint raw series honest we
 * instead draw, per pixel column, the MIN→MAX vertical span of the nights that
 * fall in that column — so a single spike night always reaches a pixel.
 *
 * This is GATED: it only applies when `nights > columns`. When nights fit within
 * the columns (the common case) the chart draws the exact monotone polyline as
 * before — byte-faithful to Recharts.
 *
 * NULL nights stay GAPS (never 0): a night whose AHI is `null` (recording too
 * short for a per-hour rate) contributes NO sample to its column. A column whose
 * nights are all null/absent becomes a NaN gap that BREAKS the envelope, exactly
 * as the polyline breaks on a null (`connectNulls={false}`).
 *
 * Implementation reuses the SHARED, tested column reduction
 * {@link levelToColumnEnvelope} from `hybridWaveformPlan` (the same forward
 * per-column min/max fold the Signal Viewer uses), so the two paths can never
 * drift. We feed it a `Float32Array` of per-night values with `null → NaN`, and
 * it returns `min`/`max` arrays of length `columns` with NaN gaps preserved.
 *
 * Pure and unit-testable — no DOM.
 *
 * @module views/Trends/charts/canvas/envelope
 */

import { levelToColumnEnvelope } from '@/components/charts/hybridWaveformPlan';

/** Result of {@link buildAhiRawEnvelope}: per-column min/max with NaN gaps. */
export interface AhiEnvelope {
  readonly min: Float32Array;
  readonly max: Float32Array;
  readonly columns: number;
}

/**
 * Whether the raw-AHI envelope should replace the polyline for the given night
 * count and available pixel columns. True iff there are strictly MORE nights than
 * columns (so columns are over-subscribed and a polyline could hide a spike).
 *
 * `columns` should be the integer plot WIDTH in CSS pixels (one column per
 * device-independent pixel), matching the Signal Viewer's reference resolution.
 */
export function shouldEnvelopeAhiRaw(nights: number, columns: number): boolean {
  return Number.isFinite(columns) && columns >= 1 && nights > columns;
}

/**
 * Build the per-pixel-column MIN/MAX envelope for the faint raw per-night AHI
 * series. `values[i]` is night `i`'s raw AHI, or `null` for a short night (kept
 * as a GAP, never coerced to 0). `columns` is the integer plot width in CSS px.
 *
 * Reuses {@link levelToColumnEnvelope} unchanged (its signature is preserved): we
 * pass a `Float32Array` with `null → NaN`, and it folds each night index `i` into
 * column `floor(i / nights * columns)`, taking the min/max of real values per
 * column and marking all-NaN columns as NaN gaps.
 */
export function buildAhiRawEnvelope(
  values: readonly (number | null)[],
  columns: number,
): AhiEnvelope {
  const cols = Math.max(0, Math.floor(columns));
  const arr = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    arr[i] = v === null || v === undefined || Number.isNaN(v) ? NaN : v;
  }
  const env = levelToColumnEnvelope(arr, cols);
  return { min: env.min, max: env.max, columns: env.columns };
}
