/**
 * Type definitions and literature-backed default parameters for app-computed
 * breathing-pattern detection (periodic breathing, Cheyne–Stokes respiration,
 * and treatment-emergent central sleep apnea).
 *
 * Per ADR 0017, these detections are a channel **distinct** from device
 * {@link import('@/types/events').Event} records: they are computed by the app
 * from the airflow / ventilation envelope and carry **provenance and a
 * continuous confidence score** that device annotations lack. All output is
 * framed as *candidate detection*, never diagnosis.
 *
 * Literature anchors (see ADR 0017 "Key Literature"):
 * - Weinreich et al. 2009 — single-channel nasal-airflow CSR detection.
 * - Javed et al. 2018 — ResCSRF automated CSR detection from flow.
 * - Midelet et al. 2023 — airflow-based periodic-breathing / CSR detection.
 * - Guyot et al. 2019 — flow-modulation index as continuous confidence.
 * - Liu et al. 2017 — four-class TECSA trajectory model from nightly CAI.
 * - AASM (Berry et al. 2012) — morphology definitions for PB / CSR.
 *
 * @module analysis/breathing/types
 */

// ---------------------------------------------------------------------------
// Episode model (PB / CSR)
// ---------------------------------------------------------------------------

/**
 * Classification of a detected oscillatory breathing episode.
 *
 * - `PeriodicBreathing` — crescendo–decrescendo ventilatory oscillation whose
 *   nadirs are hypopneas (or sub-threshold reductions) rather than central
 *   apneas, and/or which falls below the formal AASM CSR criteria. Surfaced as
 *   a **candidate** with `belowDeviceThreshold = true`.
 * - `CheyneStokes` — periodic breathing whose nadirs are central apneas and
 *   which meets the AASM morphology criteria (≥3 consecutive central events,
 *   cycle length ≥40 s). Whether the session-level ≥5 events/h over ≥2 h
 *   criterion also holds is reported via {@link BreathingEpisode.belowDeviceThreshold}.
 */
export type BreathingEpisodeType = 'PeriodicBreathing' | 'CheyneStokes';

/**
 * A single candidate breathing-pattern episode detected over the ventilation
 * envelope. This is an app **computed detection**, deliberately separate from
 * the device `Event` model (ADR 0017, Option C).
 */
export interface BreathingEpisode {
  /** Stable identifier for this episode (deterministic, derived from span). */
  readonly id: string;
  /** Episode classification. */
  readonly type: BreathingEpisodeType;
  /** Episode start in epoch milliseconds (UTC). */
  readonly startMs: number;
  /** Episode end in epoch milliseconds (UTC). */
  readonly endMs: number;
  /** Episode duration in seconds (`(endMs - startMs) / 1000`). */
  readonly durationSec: number;
  /**
   * Continuous confidence in [0, 1] that this is a genuine periodic-breathing
   * episode. Derived from the Guyot-style modulation index, crescendo–decrescendo
   * morphology fit, and autocorrelation periodicity strength, down-weighted by
   * the leak-clean fraction when leak is supplied. NOT a probability of disease.
   */
  readonly confidence: number;
  /** Estimated dominant oscillation cycle length in seconds. */
  readonly cycleLengthSec: number;
  /**
   * Guyot-style modulation depth in [0, 1]: the peak-to-trough amplitude of the
   * ventilation oscillation normalized by its envelope, i.e. how deep the
   * periodic modulation is. 0 = no modulation, 1 = full on/off cycling.
   */
  readonly modulationDepth: number;
  /** Number of complete oscillation cycles spanned by the episode. */
  readonly cycleCount: number;
  /**
   * Predominant nadir character when device event flags were supplied:
   * `'apnea'` when cycle troughs coincide with central apneas, `'hypopnea'`
   * when they coincide with hypopneas. Undefined when no event flags were
   * available to anchor the nadirs.
   */
  readonly meanNadirType?: 'apnea' | 'hypopnea';
  /**
   * `true` when this episode is a **candidate below the device's reporting
   * threshold** — sub-AASM periodic breathing (hypopnea nadirs) or a CSR run
   * that satisfies the morphology rules but not the session-level
   * ≥5 events/h over ≥2 h criterion. Such episodes are surfaced explicitly,
   * never promoted to a formal flag and never silently dropped.
   */
  readonly belowDeviceThreshold: boolean;
}

// ---------------------------------------------------------------------------
// TECSA model
// ---------------------------------------------------------------------------

/**
 * Four-class treatment-emergent central sleep apnea trajectory class
 * (Liu et al. 2017).
 *
 * - `obstructive` — central apnea index (CAI) below threshold in both early and
 *   late windows; no treatment-emergent central pattern.
 * - `transient` — early CAI above threshold but late CAI resolved below it
 *   (CAI present at treatment onset, then spontaneously resolves).
 * - `persistent` — CAI above threshold in both early and late windows.
 * - `emergent` — early CAI below threshold but late CAI above it (central
 *   apnea *emerges* during established treatment): classic TECSA.
 */
export type TecsaClass = 'obstructive' | 'transient' | 'persistent' | 'emergent';

/**
 * Result of the longitudinal TECSA trajectory classification. When history is
 * insufficient to classify, {@link available} is `false` and {@link class} is
 * `null` — a class is **never fabricated** from sparse data.
 */
export interface TecsaClassification {
  /**
   * `true` when there were enough usable nights in both early and late windows
   * to classify. When `false`, {@link class} is `null` and the caller should
   * present an honest "insufficient data" state.
   */
  readonly available: boolean;
  /** Assigned trajectory class, or `null` when {@link available} is `false`. */
  readonly class: TecsaClass | null;
  /** Median central-apnea index (events/h) over the early window. */
  readonly earlyCai: number;
  /** Median central-apnea index (events/h) over the late window. */
  readonly lateCai: number;
  /** Number of usable (low-leak) nights contributing to the early window. */
  readonly earlyNights: number;
  /** Number of usable (low-leak) nights contributing to the late window. */
  readonly lateNights: number;
  /**
   * Fraction in [0, 1] of supplied nights that were usable (passed the leak and
   * minimum-usage gates). Low values indicate leak-corrupted or sparse history.
   */
  readonly usableNightFraction: number;
  /**
   * Continuous confidence in [0, 1] reflecting usable-night count and the
   * separation between early and late CAI relative to the threshold. 0 when
   * {@link available} is `false`.
   */
  readonly confidence: number;
  /** CAI threshold (events/h) used to classify each window. */
  readonly caiThreshold: number;
}

/**
 * Per-night "TECSA candidate" flag: a single night that exhibits the
 * treatment-emergent pattern (baseline obstructive disease with obstructive
 * apneas controlled, yet central apnea index at or above threshold). This is a
 * per-night marker, distinct from the longitudinal {@link TecsaClassification}.
 */
export interface TecsaNightFlag {
  /** ISO date (YYYY-MM-DD) of the night. */
  readonly date: string;
  /**
   * `true` when this night is a TECSA candidate: usable (low-leak) night with
   * CAI ≥ threshold while the obstructive index is controlled below its gate.
   */
  readonly candidate: boolean;
  /** Central-apnea index for the night (events/h). */
  readonly cai: number;
  /** Obstructive index for the night (events/h). */
  readonly obstructiveIndex: number;
  /** `true` when the night was excluded from analysis due to high leak. */
  readonly highLeak: boolean;
}

/** Ordered per-night record consumed by the TECSA classifier. */
export interface TecsaNightRecord {
  /** ISO date (YYYY-MM-DD). Records are expected in ascending date order. */
  readonly date: string;
  /** Central-apnea index (events/h). */
  readonly centralApneaIndex: number;
  /** Obstructive apnea index (events/h). */
  readonly obstructiveIndex: number;
  /** Hypopnea index (events/h). */
  readonly hypopneaIndex: number;
  /**
   * Leak metric used for the leak gate. Interpreted as median leak in L/min by
   * default (configurable via {@link TecsaParams.maxLeakMetric}).
   */
  readonly leakMetric: number;
  /** Usable (mask-on) hours for the night. */
  readonly usableHours: number;
}

// ---------------------------------------------------------------------------
// Envelope / signal primitive results
// ---------------------------------------------------------------------------

/**
 * A per-breath ventilation envelope resampled to a fixed rate (≈1 Hz). Each
 * sample is a ventilation proxy (per-breath peak flow or tidal-volume proxy)
 * at the corresponding timestamp.
 */
export interface VentilationEnvelope {
  /** Epoch-millisecond timestamp for each envelope sample. */
  readonly timestampsMs: Float64Array;
  /** Ventilation proxy value for each sample (arbitrary, non-negative units). */
  readonly values: Float32Array;
  /** Envelope sample rate in Hz (e.g. 1). */
  readonly sampleRateHz: number;
}

/** Result of autocorrelation-based periodicity estimation on an envelope. */
export interface PeriodicityResult {
  /**
   * Estimated dominant cycle length in seconds (lag of the first significant
   * autocorrelation peak within the cycle-length search band), or `null` when
   * no periodic structure is found in the band.
   */
  readonly cycleLengthSec: number | null;
  /**
   * Periodicity strength in [0, 1]: the height of the autocorrelation peak at
   * the dominant lag (1 = perfectly periodic, 0 = no periodicity).
   */
  readonly strength: number;
}

// ---------------------------------------------------------------------------
// Parameters — periodic breathing / CSR
// ---------------------------------------------------------------------------

/**
 * Configurable thresholds for the PB / CSR detector. Defaults follow AASM
 * (Berry et al. 2012) morphology rules and the airflow-CSR literature.
 */
export interface PeriodicBreathingParams {
  /**
   * Minimum number of consecutive central events for a formal CSR episode
   * (AASM). Default 3.
   */
  readonly minConsecutiveEvents: number;
  /** Minimum cycle length in seconds for CSR (AASM ≥40 s). Default 40. */
  readonly cycleLenMinSec: number;
  /**
   * Typical CSR cycle-length range `[min, max]` in seconds; episodes whose
   * cycle falls in this band score a morphology bonus. Default `[45, 90]`.
   */
  readonly cycleLenTypicalRange: readonly [number, number];
  /**
   * Upper bound of the cycle-length search band in seconds (covers shorter,
   * high-altitude / idiopathic periodic breathing). Default 100.
   */
  readonly cycleLenMaxSec: number;
  /**
   * Minimum number of oscillation cycles for any candidate episode. Default 3.
   */
  readonly minCycles: number;
  /**
   * Minimum Guyot-style modulation depth in [0, 1] for a candidate episode.
   * Default 0.3.
   */
  readonly modulationDepthMin: number;
  /**
   * Minimum autocorrelation periodicity strength in [0, 1] for a candidate.
   * Default 0.3.
   */
  readonly periodicityStrengthMin: number;
  /**
   * Session-level events/h that, together with {@link minRecordHours}, must be
   * met for a CSR episode to be considered above the device threshold
   * (AASM ≥5/h). Default 5.
   */
  readonly minEventsPerHour: number;
  /**
   * Session-level minimum record length in hours for the events/h criterion to
   * apply (AASM ≥2 h). Default 2.
   */
  readonly minRecordHours: number;
  /**
   * Analysis-window length in seconds for the sliding envelope analysis.
   * Default 300 (5 min) — long enough to contain ≥3 cycles at the upper band.
   */
  readonly windowSec: number;
  /**
   * Step in seconds between successive sliding windows. Default 30.
   */
  readonly stepSec: number;
  /**
   * Leak rate (L/min) above which an envelope sample is treated as
   * leak-corrupted when a leak channel is supplied. The fraction of clean
   * samples down-weights confidence. Default 24 (ResMed large-leak threshold).
   */
  readonly leakThresholdLpm: number;
  /**
   * Envelope sample rate (Hz) to resample the per-breath envelope onto.
   * Default 1.
   */
  readonly envelopeRateHz: number;
}

/** Literature-backed defaults for {@link PeriodicBreathingParams}. */
export const DEFAULT_PERIODIC_BREATHING_PARAMS: PeriodicBreathingParams = {
  minConsecutiveEvents: 3,
  cycleLenMinSec: 40,
  cycleLenTypicalRange: [45, 90],
  cycleLenMaxSec: 100,
  minCycles: 3,
  modulationDepthMin: 0.3,
  periodicityStrengthMin: 0.3,
  minEventsPerHour: 5,
  minRecordHours: 2,
  windowSec: 300,
  stepSec: 30,
  leakThresholdLpm: 24,
  envelopeRateHz: 1,
};

// ---------------------------------------------------------------------------
// Parameters — TECSA
// ---------------------------------------------------------------------------

/**
 * Configurable thresholds for the TECSA trajectory classifier. Defaults follow
 * Liu et al. 2017.
 */
export interface TecsaParams {
  /** Central-apnea index threshold (events/h) per window. Default 5. */
  readonly caiThreshold: number;
  /** Number of nights in the early-treatment window. Default 7. */
  readonly earlyWindowNights: number;
  /**
   * Offset, in weeks from treatment start, of the late-treatment window.
   * Default 13 (≈3 months). Nights at or after this offset form the late window.
   */
  readonly lateWindowOffsetWeeks: number;
  /** Number of nights in the late-treatment window. Default 7. */
  readonly lateWindowNights: number;
  /**
   * Minimum usable nights required in *each* window to classify. Below this in
   * either window, the result is "insufficient data". Default 3.
   */
  readonly minNightsPerWindow: number;
  /**
   * Leak-metric value (default L/min) above which a night is excluded as
   * leak-corrupted (FOT central detection is unreliable under large leak).
   * Default 24.
   */
  readonly maxLeakMetric: number;
  /** Minimum usable hours for a night to count. Default 2. */
  readonly minUsableHours: number;
  /**
   * Obstructive index (events/h) below which obstructive disease is considered
   * "controlled" for the per-night TECSA-candidate flag. Default 5.
   */
  readonly obstructiveControlledIndex: number;
}

/** Literature-backed defaults for {@link TecsaParams}. */
export const DEFAULT_TECSA_PARAMS: TecsaParams = {
  caiThreshold: 5,
  earlyWindowNights: 7,
  lateWindowOffsetWeeks: 13,
  lateWindowNights: 7,
  minNightsPerWindow: 3,
  maxLeakMetric: 24,
  minUsableHours: 2,
  obstructiveControlledIndex: 5,
};

// ---------------------------------------------------------------------------
// Detector inputs
// ---------------------------------------------------------------------------

/**
 * A device event flag passed to the PB/CSR detector to anchor cycle nadirs.
 * A normalized subset of the device `Event` model — the detector only needs the
 * timing, duration, and apnea-vs-hypopnea character.
 */
export interface DeviceEventFlag {
  /** Epoch-millisecond timestamp of the event onset. */
  readonly timestampMs: number;
  /** Event duration in seconds. */
  readonly durationSec: number;
  /** Whether this is a central apnea or a hypopnea (the two nadir types). */
  readonly kind: 'central' | 'hypopnea';
}

/**
 * Input to {@link import('./detectPeriodicBreathing').detectPeriodicBreathing}.
 *
 * Exactly one of {@link flow} or {@link minuteVent} must be provided. Minute
 * ventilation, when available, is the cleaner input and skips per-breath
 * segmentation.
 */
export interface PeriodicBreathingInput {
  /** Raw flow-rate samples (L/min). Used when {@link minuteVent} is absent. */
  readonly flow?: Float32Array;
  /**
   * Pre-computed minute-ventilation samples (L/min). Preferred over {@link flow}
   * when present — a cleaner ventilation envelope that skips breath segmentation.
   */
  readonly minuteVent?: Float32Array;
  /** Sample rate (Hz) of {@link flow} / {@link minuteVent}. */
  readonly sampleRateHz: number;
  /**
   * Epoch-millisecond timestamp of the first sample. Used to place episode
   * boundaries in absolute time. Default 0 (relative timeline).
   */
  readonly startMs?: number;
  /**
   * Optional device event flags (central apneas and hypopneas) to anchor and
   * classify cycle nadirs. Without these, episodes default to
   * `PeriodicBreathing` candidates with no {@link BreathingEpisode.meanNadirType}.
   */
  readonly eventFlags?: readonly DeviceEventFlag[];
  /**
   * Optional leak samples (L/min), aligned 1:1 with {@link flow} / {@link minuteVent},
   * used to compute a leak-clean fraction that down-weights confidence.
   */
  readonly leak?: Float32Array;
  /** Optional parameter overrides (merged onto {@link DEFAULT_PERIODIC_BREATHING_PARAMS}). */
  readonly params?: Partial<PeriodicBreathingParams>;
}

/** Aggregate result of the PB / CSR detector. */
export interface PeriodicBreathingResult {
  /** Detected candidate episodes, in ascending time order. */
  readonly episodes: readonly BreathingEpisode[];
  /** Total analyzed record length in hours. */
  readonly recordHours: number;
  /**
   * Whether the session-level ≥{@link PeriodicBreathingParams.minEventsPerHour}
   * over ≥{@link PeriodicBreathingParams.minRecordHours} criterion was met by
   * supplied central event flags.
   */
  readonly sessionCriterionMet: boolean;
}
