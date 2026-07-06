/**
 * Canonical oximetry (SpO₂) classification thresholds.
 *
 * Single source of truth for the nocturnal-hypoxaemia burden bands used to
 * colour the oximetry segment of the Session Details component strip (and any
 * other oximetry summary). These band the **T90** metric — the percentage of
 * *valid oximetry time* spent with SpO₂ < 90% — deliberately NOT the raw
 * single-sample nightly minimum (`spo2Min`).
 *
 * ## Why T90, not the nadir
 * `spo2Min` is the raw single-sample minimum from `SessionBuilder`. A single
 * motion or probe-off artifact sample can drag the nadir into the severe range
 * on an otherwise unremarkable night, so it is unsuitable as the sole driver of
 * a severity colour. T90 is a **time-based, robust** burden measure: one bad
 * sample cannot move a percentage-of-time figure meaningfully, which is exactly
 * why it is the metric graded here.
 *
 * ## Band rationale (heuristic, non-diagnostic)
 * The commonly used clinical descriptor is the fraction of sleep time below
 * 90% saturation. A widely cited pragmatic split treats a T90 under ~1% as
 * unremarkable, single digits (~1–5%) as a mild burden, ~5–10% as a moderate
 * burden, and > 10% of the night below 90% as a heavy burden. These bands are a
 * **presentation heuristic** for at-a-glance colour, not a validated diagnostic
 * cutoff — this tool does not diagnose. Overnight oximetry interpretation is a
 * clinician's judgement over T90 together with ODI, coverage and trend.
 *
 * These are clinical-band cutoffs, NOT display/axis tuning; chart scaling lives
 * separately (see `views/Trends/charts/chartScale.ts`).
 *
 * @module analysis/clinical/oximetry
 */

import type { AhiSeverity } from './ahiSeverity';

/**
 * T90 (% of valid oximetry time with SpO₂ < 90%) at or above which the night's
 * hypoxaemia burden enters the **mild** band. Below this it is treated as
 * unremarkable (`normal`).
 */
export const SPO2_T90_MILD_PCT = 1;

/**
 * T90 (%) at or above which the burden enters the **moderate** band.
 */
export const SPO2_T90_MODERATE_PCT = 5;

/**
 * T90 (%) at or above which the burden enters the **severe** band (> 10% of the
 * analysed night spent below 90% saturation).
 */
export const SPO2_T90_SEVERE_PCT = 10;

/**
 * Classify a T90 value (percentage of valid oximetry time with SpO₂ < 90%) into
 * a colour-severity token.
 *
 * Pure and deterministic, with the same "below the next threshold" boundary
 * semantics as {@link classifyAhiSeverity}: `< 1 → normal`, `< 5 → mild`,
 * `< 10 → moderate`, otherwise `severe`. The returned token is a **heuristic
 * presentation band**, not a diagnosis.
 *
 * @param t90Percent - T90 in percent, or `null` when there is no oximetry (the
 *   metric is undefined). A `null` / non-finite input yields `null` ("no data"),
 *   never a passing/normal state.
 * @returns The severity token, or `null` when T90 is undefined.
 */
export function classifySpo2T90Severity(t90Percent: number | null): AhiSeverity | null {
  if (t90Percent === null || !Number.isFinite(t90Percent)) return null;
  if (t90Percent < SPO2_T90_MILD_PCT) return 'normal';
  if (t90Percent < SPO2_T90_MODERATE_PCT) return 'mild';
  if (t90Percent < SPO2_T90_SEVERE_PCT) return 'moderate';
  return 'severe';
}
