/**
 * REM-predominant / REM-related OSA pattern detection.
 *
 * REM sleep relaxes upper-airway dilator muscle tone, so in many patients
 * obstructive events cluster in REM. The sleep-medicine literature names this
 * phenotype with a family of related, partly overlapping definitions. We adopt
 * the most commonly cited operational thresholds and label them explicitly:
 *
 *   • REM-RELATED OSA — the broad definition: AHI_REM / AHI_NREM ≥ 2 with
 *     AHI_NREM > 0. (Reviewed across cohorts; e.g. Koo et al., 2008;
 *     Mokhlesi et al., 2014.)
 *   • REM-PREDOMINANT OSA — the stricter "Conwell" form: additionally requires
 *     AHI_NREM < 15 events/h, with enough REM (≥ 30 min) and NREM (≥ 15 min)
 *     recorded for the per-stage AHIs to be stable. (Conwell et al., 2012.)
 *
 * Citations (verified June 2026):
 *   - Conwell W, Patel B, Doeing D, et al. Prevalence, clinical features, and
 *     CPAP adherence in REM-related sleep-disordered breathing: a cross-sectional
 *     analysis of a large clinical population. Sleep Breath. 2012;16(2):519-526.
 *     (REM-related OSA: AHI ≥ 5, AHI_REM/AHI_NREM ≥ 2, AHI_NREM < 15.)
 *   - Koo BB, Patel SR, Strohl K, Hoffstein V. Rapid eye movement-related
 *     sleep-disordered breathing: influence of age and gender. Chest.
 *     2008;134(6):1156-1161. (AHI_REM/AHI_NREM ≥ 2 with REM-time stability rule.)
 *   - Mokhlesi B, Punjabi NM. "REM-related" obstructive sleep apnea: an
 *     epiphenomenon or a clinically important entity? Sleep. 2012;35(1):5-7;
 *     and Mokhlesi et al., Sleep 2014 — discussion of ratio thresholds and the
 *     ≥ 30 min REM requirement.
 *
 * Caveats: per-stage AHI is unstable when REM or NREM time is short; wearable
 * staging is approximate vs PSG; this is a descriptive PATTERN, not a diagnosis.
 *
 * @module analysis/sleepStages/remOsa
 */

import { percentileFromSorted } from '@/analysis/math';
import { wilcoxonSignedRank, type WilcoxonResult } from '@/analysis/hypothesis';
import { isAhiEvent, MS_PER_HOUR, MS_PER_MINUTE } from './constants';
import type { StageDurations, TaggedEvent } from './types';

/** Ratio at/above which OSA is considered REM-related (broad) or REM-predominant. */
export const REM_RATIO_THRESHOLD = 2;

/** Upper bound on AHI_NREM for the stricter "REM-predominant" label. */
export const REM_PREDOMINANT_NREM_AHI_MAX = 15;

/** Minimum REM time (minutes) for per-stage AHI to be considered stable. */
export const MIN_REM_MINUTES = 30;

/** Minimum NREM time (minutes) for per-stage AHI to be considered stable. */
export const MIN_NREM_MINUTES = 15;

/** Classification produced by {@link remOsaPattern}. */
export type RemOsaClassification =
  | 'rem-predominant'
  | 'rem-related'
  | 'not-rem-predominant'
  | 'insufficient-data';

/** Result of {@link remOsaPattern}. */
export interface RemOsaResult {
  /** AHI within REM = (AHI-type REM event count) / (REM hours); null if no REM. */
  readonly ahiRem: number | null;
  /** AHI within NREM = (AHI-type NREM event count) / (NREM hours); null if no NREM. */
  readonly ahiNrem: number | null;
  /** ahiRem / ahiNrem; null when either component is null or ahiNrem is 0. */
  readonly ratio: number | null;
  /** Classification per the thresholds documented in this module. */
  readonly classification: RemOsaClassification;
  /** Recorded REM time in minutes. */
  readonly remMinutes: number;
  /** Recorded NREM (deep+light) time in minutes. */
  readonly nremMinutes: number;
  /** AHI-type event count scored in REM. */
  readonly remEventCount: number;
  /** AHI-type event count scored in NREM. */
  readonly nremEventCount: number;
  /** Human-readable caveat describing the limiting condition, when relevant. */
  readonly caveat: string;
}

/** Count AHI-type events tagged to REM and to NREM (deep+light). */
function countRemNrem(taggedEvents: readonly TaggedEvent[]): {
  remEventCount: number;
  nremEventCount: number;
} {
  let remEventCount = 0;
  let nremEventCount = 0;
  for (const { event, stage } of taggedEvents) {
    if (!isAhiEvent(event.type)) continue;
    if (stage === 'rem') remEventCount += 1;
    else if (stage === 'deep' || stage === 'light') nremEventCount += 1;
  }
  return { remEventCount, nremEventCount };
}

/**
 * Classify a single night's REM vs NREM OSA pattern.
 *
 * Conservative by design: returns `'insufficient-data'` when REM or NREM time
 * is below the stability thresholds, since per-stage AHIs computed over a few
 * minutes are dominated by noise.
 *
 * @param taggedEvents output of `tagEventsByStage`
 * @param durations    output of `stageDurations`
 */
export function remOsaPattern(
  taggedEvents: readonly TaggedEvent[],
  durations: StageDurations,
): RemOsaResult {
  const { remEventCount, nremEventCount } = countRemNrem(taggedEvents);
  const remMinutes = durations.remMs / MS_PER_MINUTE;
  const nremMinutes = durations.nremMs / MS_PER_MINUTE;

  const remHours = durations.remMs / MS_PER_HOUR;
  const nremHours = durations.nremMs / MS_PER_HOUR;

  const ahiRem = remHours > 0 ? remEventCount / remHours : null;
  const ahiNrem = nremHours > 0 ? nremEventCount / nremHours : null;
  const ratio = ahiRem !== null && ahiNrem !== null && ahiNrem > 0 ? ahiRem / ahiNrem : null;

  // Insufficient stage time → do not classify.
  if (remMinutes < MIN_REM_MINUTES || nremMinutes < MIN_NREM_MINUTES) {
    return {
      ahiRem,
      ahiNrem,
      ratio,
      classification: 'insufficient-data',
      remMinutes,
      nremMinutes,
      remEventCount,
      nremEventCount,
      caveat: `Insufficient stage time for a stable per-stage AHI (need ≥ ${MIN_REM_MINUTES} min REM and ≥ ${MIN_NREM_MINUTES} min NREM; have ${remMinutes.toFixed(0)} min REM, ${nremMinutes.toFixed(0)} min NREM).`,
    };
  }

  // With adequate stage time but no measurable NREM rate, the ratio is undefined.
  if (ahiNrem === null || ahiNrem === 0 || ratio === null) {
    return {
      ahiRem,
      ahiNrem,
      ratio,
      classification: 'insufficient-data',
      remMinutes,
      nremMinutes,
      remEventCount,
      nremEventCount,
      caveat: 'AHI_NREM is zero, so the REM/NREM ratio is undefined; pattern cannot be classified.',
    };
  }

  if (ratio >= REM_RATIO_THRESHOLD) {
    if (ahiNrem < REM_PREDOMINANT_NREM_AHI_MAX) {
      return {
        ahiRem,
        ahiNrem,
        ratio,
        classification: 'rem-predominant',
        remMinutes,
        nremMinutes,
        remEventCount,
        nremEventCount,
        caveat:
          'REM-predominant pattern (ratio ≥ 2 and AHI_NREM < 15). Wearable staging is approximate; this is descriptive, not diagnostic.',
      };
    }
    return {
      ahiRem,
      ahiNrem,
      ratio,
      classification: 'rem-related',
      remMinutes,
      nremMinutes,
      remEventCount,
      nremEventCount,
      caveat:
        'REM-related pattern (ratio ≥ 2) but AHI_NREM ≥ 15, so events are not confined to REM.',
    };
  }

  return {
    ahiRem,
    ahiNrem,
    ratio,
    classification: 'not-rem-predominant',
    remMinutes,
    nremMinutes,
    remEventCount,
    nremEventCount,
    caveat: 'Events are not concentrated in REM (REM/NREM ratio < 2).',
  };
}

// ---------------------------------------------------------------------------
// Across-nights paired test
// ---------------------------------------------------------------------------

/** Minimum paired nights required to run the across-nights Wilcoxon test. */
export const MIN_PAIRED_NIGHTS = 5;

/** One night's tagged events and durations, keyed by a date label. */
export interface NightInput {
  /** Date label (e.g. ISO `YYYY-MM-DD`); used only for identification. */
  readonly date: string;
  /** Stage-tagged events for the night. */
  readonly taggedEvents: readonly TaggedEvent[];
  /** Stage durations for the night. */
  readonly durations: StageDurations;
}

/** Result of {@link remVsNremAcrossNights}. */
export interface RemVsNremAcrossNightsResult {
  /** Number of nights that met the per-night stage-time thresholds. */
  readonly nIncludedNights: number;
  /** Median per-night AHI_REM across included nights; null if none. */
  readonly medianAhiRem: number | null;
  /** Median per-night AHI_NREM across included nights; null if none. */
  readonly medianAhiNrem: number | null;
  /** Wilcoxon signed-rank result (NREM vs REM); null when too few nights. */
  readonly wilcoxon: WilcoxonResult | null;
  /** `true` only when ≥ {@link MIN_PAIRED_NIGHTS} paired nights were available. */
  readonly sufficientData: boolean;
}

/**
 * Paired across-nights comparison of within-night AHI_REM vs AHI_NREM.
 *
 * For each night with both REM ≥ {@link MIN_REM_MINUTES} and NREM ≥
 * {@link MIN_NREM_MINUTES}, we form the pair (AHI_NREM, AHI_REM) and run the
 * Wilcoxon signed-rank test (reusing `@/analysis/hypothesis`). We pass
 * `(before = AHI_NREM, after = AHI_REM)`, so a positive median difference / the
 * test's direction reflects REM exceeding NREM.
 *
 * @param nights per-night tagged events + durations
 */
export function remVsNremAcrossNights(nights: readonly NightInput[]): RemVsNremAcrossNightsResult {
  const ahiRemArr: number[] = [];
  const ahiNremArr: number[] = [];

  for (const night of nights) {
    const remMinutes = night.durations.remMs / MS_PER_MINUTE;
    const nremMinutes = night.durations.nremMs / MS_PER_MINUTE;
    if (remMinutes < MIN_REM_MINUTES || nremMinutes < MIN_NREM_MINUTES) continue;

    const { remEventCount, nremEventCount } = countRemNrem(night.taggedEvents);
    const remHours = night.durations.remMs / MS_PER_HOUR;
    const nremHours = night.durations.nremMs / MS_PER_HOUR;
    if (remHours <= 0 || nremHours <= 0) continue;

    ahiRemArr.push(remEventCount / remHours);
    ahiNremArr.push(nremEventCount / nremHours);
  }

  const nIncludedNights = ahiRemArr.length;
  const medianAhiRem =
    nIncludedNights > 0
      ? percentileFromSorted(
          [...ahiRemArr].sort((a, b) => a - b),
          50,
        )
      : null;
  const medianAhiNrem =
    nIncludedNights > 0
      ? percentileFromSorted(
          [...ahiNremArr].sort((a, b) => a - b),
          50,
        )
      : null;

  if (nIncludedNights < MIN_PAIRED_NIGHTS) {
    return {
      nIncludedNights,
      medianAhiRem,
      medianAhiNrem,
      wilcoxon: null,
      sufficientData: false,
    };
  }

  return {
    nIncludedNights,
    medianAhiRem,
    medianAhiNrem,
    wilcoxon: wilcoxonSignedRank(ahiNremArr, ahiRemArr),
    sufficientData: true,
  };
}
