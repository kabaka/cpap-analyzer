/**
 * Treatment-emergent central sleep apnea (TECSA) longitudinal trajectory
 * classifier and per-night candidate flags.
 *
 * Implements the **Liu et al. 2017** four-class trajectory model
 * (obstructive / transient / persistent / emergent) from the **nightly
 * central-apnea index (CAI)**, comparing an early-treatment window against a
 * late-treatment window using a CAI threshold (default 5/h). This is a
 * cross-night classifier — it reads stored per-night aggregates, has no
 * per-session output, and lives in the longitudinal analysis layer (ADR 0017,
 * Decision 2).
 *
 * High-leak nights are **excluded** because forced-oscillation-technique (FOT)
 * central-apnea detection is unreliable under large mask leak; the result's
 * confidence reflects how much usable history survived that gate.
 *
 * Output is **candidate classification, never diagnosis.** The clinical caveats
 * (SERVE-HF / ASV-contraindication signal, ~60–80% spontaneous resolution) are
 * owned by help content per ADR 0017, not by this algorithm.
 *
 * **Literature.** Liu D. et al. 2017 — four-class TECSA trajectory model from
 * nightly CAI; AASM CAI threshold 5/h.
 *
 * Pure, worker-safe, deterministic. No I/O, no DOM.
 *
 * @module analysis/breathing/classifyTecsa
 */

import {
  DEFAULT_TECSA_PARAMS,
  type TecsaClass,
  type TecsaClassification,
  type TecsaNightFlag,
  type TecsaNightRecord,
  type TecsaParams,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the full parameter set from partial overrides. */
function resolveParams(p?: Partial<TecsaParams>): TecsaParams {
  return { ...DEFAULT_TECSA_PARAMS, ...(p ?? {}) };
}

/** Median of a numeric array. Returns NaN for empty input. */
function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/** Parse an ISO YYYY-MM-DD date to an epoch-day integer (UTC). */
function isoToEpochDay(iso: string): number {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Math.floor(ms / 86_400_000);
}

/**
 * Determine whether a night is usable: low leak and sufficient mask-on time.
 * High leak corrupts FOT central detection (ADR 0017), so such nights are
 * excluded rather than down-weighted to zero in-place.
 */
function isUsable(night: TecsaNightRecord, params: TecsaParams): boolean {
  return (
    Number.isFinite(night.centralApneaIndex) &&
    night.leakMetric <= params.maxLeakMetric &&
    night.usableHours >= params.minUsableHours
  );
}

// ---------------------------------------------------------------------------
// Per-night TECSA-candidate flags
// ---------------------------------------------------------------------------

/**
 * Flag each night as a TECSA candidate. A night is a candidate when it is
 * usable (low leak, sufficient usage), its obstructive disease is controlled
 * (`obstructiveIndex` < `obstructiveControlledIndex`), yet its central-apnea
 * index is at or above threshold — the classic treatment-emergent picture of
 * obstruction resolving while central apnea persists or appears.
 *
 * @param nights Ordered per-night records.
 * @param params Optional threshold overrides.
 * @returns      One {@link TecsaNightFlag} per input night, in input order.
 */
export function flagTecsaNights(
  nights: readonly TecsaNightRecord[],
  params?: Partial<TecsaParams>,
): TecsaNightFlag[] {
  const p = resolveParams(params);
  return nights.map((night) => {
    // A non-finite leak metric is treated as high leak (the leak gate cannot be
    // satisfied), keeping `highLeak` consistent with `isUsable`'s exclusion of
    // such nights rather than reporting a misleading `highLeak: false`.
    const highLeak = !Number.isFinite(night.leakMetric) || night.leakMetric > p.maxLeakMetric;
    const usable = isUsable(night, p);
    const candidate =
      usable &&
      night.centralApneaIndex >= p.caiThreshold &&
      night.obstructiveIndex < p.obstructiveControlledIndex;
    return {
      date: night.date,
      candidate,
      cai: night.centralApneaIndex,
      obstructiveIndex: night.obstructiveIndex,
      highLeak,
    };
  });
}

// ---------------------------------------------------------------------------
// Longitudinal trajectory classification
// ---------------------------------------------------------------------------

/**
 * Classify a user's TECSA trajectory across many nights using the Liu et al.
 * 2017 four-class model.
 *
 * Early window: the first `earlyWindowNights` **usable** nights from treatment
 * start. Late window: up to `lateWindowNights` usable nights at or after
 * `lateWindowOffsetWeeks` from the first record. High-leak / low-usage nights
 * are excluded from both windows. The early- and late-window median CAIs are
 * each compared against `caiThreshold`:
 *
 * | early CAI | late CAI | class       |
 * |-----------|----------|-------------|
 * | < thr     | < thr    | obstructive |
 * | ≥ thr     | < thr    | transient   |
 * | ≥ thr     | ≥ thr    | persistent  |
 * | < thr     | ≥ thr    | emergent    |
 *
 * If either window has fewer than `minNightsPerWindow` usable nights, the
 * result is **insufficient data** (`available: false`, `class: null`) — a class
 * is never fabricated from sparse history.
 *
 * @param nights Ordered per-night records (ascending date). Order is enforced
 *               internally by sorting on date.
 * @param params Optional threshold overrides.
 * @returns      A {@link TecsaClassification}.
 *
 * @remarks
 * **Missing-data strategy.** Nights with non-finite CAI, high leak, or
 * insufficient usage are excluded (listwise) before windowing. The window
 * separation drives confidence: a clear gap between both window medians and the
 * threshold yields higher confidence than a borderline CAI near the cutoff.
 */
export function classifyTecsa(
  nights: readonly TecsaNightRecord[],
  params?: Partial<TecsaParams>,
): TecsaClassification {
  const p = resolveParams(params);

  const insufficient = (
    earlyCai: number,
    lateCai: number,
    earlyNights: number,
    lateNights: number,
    usableNightFraction: number,
  ): TecsaClassification => ({
    available: false,
    class: null,
    earlyCai: Number.isFinite(earlyCai) ? earlyCai : 0,
    lateCai: Number.isFinite(lateCai) ? lateCai : 0,
    earlyNights,
    lateNights,
    usableNightFraction,
    confidence: 0,
    caiThreshold: p.caiThreshold,
  });

  if (nights.length === 0) {
    return insufficient(0, 0, 0, 0, 0);
  }

  // Sort ascending by date and split usable vs. excluded.
  const sorted = [...nights].sort((a, b) => isoToEpochDay(a.date) - isoToEpochDay(b.date));
  const usable = sorted.filter((nt) => isUsable(nt, p));
  const usableNightFraction = usable.length / sorted.length;

  if (usable.length === 0) {
    return insufficient(0, 0, 0, 0, usableNightFraction);
  }

  const firstDay = isoToEpochDay((usable[0] as TecsaNightRecord).date);
  const lateOffsetDays = p.lateWindowOffsetWeeks * 7;

  // Early window: first N usable nights.
  const earlyRecords = usable.slice(0, p.earlyWindowNights);
  // Late window: usable nights at/after the late offset, take the first N.
  const lateRecords = usable
    .filter((nt) => isoToEpochDay(nt.date) - firstDay >= lateOffsetDays)
    .slice(0, p.lateWindowNights);

  const earlyCai = median(earlyRecords.map((nt) => nt.centralApneaIndex));
  const lateCai = median(lateRecords.map((nt) => nt.centralApneaIndex));

  if (earlyRecords.length < p.minNightsPerWindow || lateRecords.length < p.minNightsPerWindow) {
    return insufficient(
      earlyCai,
      lateCai,
      earlyRecords.length,
      lateRecords.length,
      usableNightFraction,
    );
  }

  const earlyHigh = earlyCai >= p.caiThreshold;
  const lateHigh = lateCai >= p.caiThreshold;

  let cls: TecsaClass;
  if (!earlyHigh && !lateHigh) cls = 'obstructive';
  else if (earlyHigh && !lateHigh) cls = 'transient';
  else if (earlyHigh && lateHigh) cls = 'persistent';
  else cls = 'emergent';

  // Confidence: combine usable-night fraction with how cleanly each window
  // median separates from the threshold (a borderline CAI near the cutoff is
  // low-confidence). Separation is normalized by the threshold and saturates.
  const earlySep = Math.min(1, Math.abs(earlyCai - p.caiThreshold) / p.caiThreshold);
  const lateSep = Math.min(1, Math.abs(lateCai - p.caiThreshold) / p.caiThreshold);
  const separation = (earlySep + lateSep) / 2;
  const confidence = Math.min(1, Math.max(0, usableNightFraction * separation));

  return {
    available: true,
    class: cls,
    earlyCai,
    lateCai,
    earlyNights: earlyRecords.length,
    lateNights: lateRecords.length,
    usableNightFraction,
    confidence,
    caiThreshold: p.caiThreshold,
  };
}
