/**
 * Fitbit / Google Health data types.
 *
 * All payload interfaces correspond to data extracted from a Google Takeout
 * "Fitbit" export. They are stored in IndexedDB via the integration_data and
 * integration_timeseries object stores, keyed by date and discriminated by
 * {@link FitbitDataType}.
 */

// ---------------------------------------------------------------------------
// Data-type discriminators
// ---------------------------------------------------------------------------

/** Fitbit daily summary data types stored in integration_data. */
export type FitbitDailyType =
  | 'sleep_session'
  | 'sleep_score'
  | 'spo2_daily'
  | 'hrv_daily'
  | 'respiratory_rate'
  | 'heart_rate_resting'
  | 'readiness'
  | 'stress'
  | 'temperature'
  | 'activity_daily'
  | 'body_weight'
  | 'body_vo2max'
  | 'sleep_profile'
  | 'snoring_daily';

/** Fitbit time-series data types stored in integration_timeseries. */
export type FitbitTimeseriesType =
  | 'spo2_intraday'
  | 'hrv_detail'
  | 'sleep_stages'
  | 'snoring_segments'
  | 'heart_rate_intraday';

/** Combined discriminator for all Fitbit data types. */
export type FitbitDataType = FitbitDailyType | FitbitTimeseriesType;

// ---------------------------------------------------------------------------
// Daily payload interfaces
// ---------------------------------------------------------------------------

/** A single Fitbit sleep session (one night). */
export interface FitbitSleepSession {
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMs: number;
  readonly efficiency: number;
  readonly minutesAsleep: number;
  readonly minutesAwake: number;
  readonly timeInBed: number;
  readonly type: 'stages' | 'classic';
  readonly stages: {
    readonly deep: number;
    readonly light: number;
    readonly rem: number;
    readonly wake: number;
  };
  readonly isMainSleep: boolean;
}

/** Fitbit Sleep Score breakdown. */
export interface FitbitSleepScore {
  readonly overallScore: number;
  readonly compositionScore: number;
  readonly revitalizationScore: number;
  readonly durationScore: number;
  readonly deepSleepMinutes: number;
  readonly restingHeartRate: number;
  readonly restlessnessScore: number;
}

/** Fitbit daily SpO2 summary (percentage values). */
export interface FitbitSpO2Daily {
  readonly avg: number;
  readonly min: number;
  readonly max: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly standardDeviation: number;
}

/** Fitbit daily HRV summary. */
export interface FitbitHRVDaily {
  readonly dailyRmssd: number;
  readonly deepRmssd: number;
  readonly nremHeartRate: number;
  readonly entropy: number | null;
}

/** Fitbit respiratory rate during sleep, broken out by sleep stage. */
export interface FitbitRespiratoryRate {
  readonly fullSleepRate: number;
  readonly fullSleepStdDev: number;
  readonly deepRate: number | null;
  readonly deepStdDev: number | null;
  readonly lightRate: number | null;
  readonly lightStdDev: number | null;
  readonly remRate: number | null;
  readonly remStdDev: number | null;
}

/** Fitbit resting heart rate. */
export interface FitbitRestingHeartRate {
  readonly restingHeartRate: number;
  readonly error: number | null;
}

/** Fitbit Readiness Score and sub-components. */
export interface FitbitReadiness {
  readonly score: number;
  readonly level: 'Excellent' | 'Good' | 'Fair' | 'Low';
  readonly sleepSubScore: number;
  readonly hrvSubScore: number;
  readonly activitySubScore: number;
}

/** Fitbit Stress Management Score. */
export interface FitbitStress {
  readonly score: number;
  readonly sleepPoints: number;
  readonly responsivenessPoints: number;
  readonly exertionPoints: number;
  readonly calculationFailed: boolean;
}

/** Fitbit skin temperature deviation from personal baseline. */
export interface FitbitTemperature {
  /** Deviation in degrees Celsius from the user's baseline. */
  readonly nightlyDeviation: number;
  readonly baselineRelative: number | null;
}

/** Fitbit daily activity summary. */
export interface FitbitActivityDaily {
  readonly steps: number;
  readonly caloriesTotal: number;
  readonly activeZoneMinutes: number;
  readonly sedentaryMinutes: number;
  readonly lightlyActiveMinutes: number;
  readonly fairlyActiveMinutes: number;
  readonly veryActiveMinutes: number;
}

/** Fitbit body weight log entry. */
export interface FitbitBodyWeight {
  readonly weightKg: number;
  readonly bmi: number | null;
  readonly source: string;
  readonly loggedAt: string;
}

/** Fitbit VO2 Max (cardio fitness) estimate. */
export interface FitbitVO2Max {
  /** mL/kg/min */
  readonly vo2Max: number;
}

/** Fitbit Sleep Profile (monthly). */
export interface FitbitSleepProfile {
  /** YYYY-MM */
  readonly month: string;
  readonly animalType: string;
  readonly sleepDuration: number;
  readonly deepSleepPercent: number;
  readonly remSleepPercent: number;
  readonly sleepLatency: number;
  readonly sleepEfficiency: number;
}

/** Fitbit daily snoring summary. */
export interface FitbitSnoringDaily {
  readonly totalSegments: number;
  readonly totalDurationMinutes: number;
  readonly avgDb: number | null;
  readonly maxDb: number | null;
}

// ---------------------------------------------------------------------------
// Timeseries payload interfaces
// ---------------------------------------------------------------------------

/** Fitbit per-minute SpO2 data for a single night. */
export interface FitbitSpO2Intraday {
  readonly samples: readonly {
    readonly minuteOffset: number;
    readonly value: number;
  }[];
  readonly sleepStartTime: string;
  readonly sampleCount: number;
}

/**
 * A single intraday heart-rate sample.
 *
 * Offsets are relative to {@link FitbitHeartRateIntraday.baseTimestampMs} to
 * keep the per-record payload compact (an `offsetSec` is far smaller than a
 * repeated absolute timestamp across the ~17k samples/day this data carries).
 */
export interface FitbitHeartRateIntradaySample {
  /** Seconds elapsed since {@link FitbitHeartRateIntraday.baseTimestampMs}. */
  readonly offsetSec: number;
  /** Beats per minute. */
  readonly bpm: number;
  /**
   * Fitbit's optical-sensor confidence for this reading, 0–3 (3 = highest).
   * Retained so downstream consumers can weight or filter low-confidence noise
   * rather than us discarding it at import time.
   */
  readonly confidence: number;
}

/**
 * Fitbit intraday (≈5-second cadence) heart-rate data for a single calendar
 * date.
 *
 * ## Time base
 *
 * The Fitbit export records each sample's local wall-clock time with no
 * timezone (`MM/DD/YY HH:MM:SS`). {@link baseTimestampMs} is the epoch value of
 * the first sample's wall-clock interpreted as UTC — i.e. the same convention
 * CPAP session timestamps use, so the viewer can align lanes by wall-clock
 * without timezone math. Each sample's absolute time is therefore
 * `baseTimestampMs + offsetSec * 1000`.
 *
 * ## Storage strategy
 *
 * Stored at full native resolution (no downsampling). See the parser
 * (`parseHeartRateIntradayFiles`) for the rationale and per-record size
 * envelope. One record corresponds to one calendar date; a single export file
 * spans the midnight boundary and may produce two date records.
 */
export interface FitbitHeartRateIntraday {
  /**
   * Epoch milliseconds of the first sample, computed from the local wall-clock
   * components via {@link Date.UTC} (NOT timezone-shifted). Adding
   * `offsetSec * 1000` to this yields each sample's wall-clock epoch.
   */
  readonly baseTimestampMs: number;
  readonly samples: readonly FitbitHeartRateIntradaySample[];
  readonly sampleCount: number;
}

/** A single HRV measurement interval. */
export interface FitbitHRVDetailInterval {
  readonly timestamp: string;
  readonly rmssd: number;
  readonly coverage: number;
  readonly hf: number;
  readonly lf: number;
}

/** Fitbit detailed HRV data for a single night. */
export interface FitbitHRVDetail {
  readonly intervals: readonly FitbitHRVDetailInterval[];
}

/** A single sleep stage transition. */
export interface FitbitSleepStageTransition {
  readonly timestamp: string;
  readonly stage: 'deep' | 'light' | 'rem' | 'wake';
  readonly durationSeconds: number;
}

/** Fitbit hypnogram (sleep stage timeline) for a single night. */
export interface FitbitSleepStages {
  readonly transitions: readonly FitbitSleepStageTransition[];
}

/** A single snoring segment detected during sleep. */
export interface FitbitSnoringSegment {
  readonly timestamp: string;
  readonly durationSeconds: number;
  readonly meanDba: number;
  readonly maxDba: number;
  readonly snoreDetected: boolean;
}

/** Fitbit detailed snoring segments for a single night. */
export interface FitbitSnoringSegments {
  readonly segments: readonly FitbitSnoringSegment[];
}

// ---------------------------------------------------------------------------
// Discriminated union maps
// ---------------------------------------------------------------------------

/** Maps {@link FitbitDailyType} discriminator to its typed payload. */
export type FitbitDailyPayloadMap = {
  readonly sleep_session: FitbitSleepSession;
  readonly sleep_score: FitbitSleepScore;
  readonly spo2_daily: FitbitSpO2Daily;
  readonly hrv_daily: FitbitHRVDaily;
  readonly respiratory_rate: FitbitRespiratoryRate;
  readonly heart_rate_resting: FitbitRestingHeartRate;
  readonly readiness: FitbitReadiness;
  readonly stress: FitbitStress;
  readonly temperature: FitbitTemperature;
  readonly activity_daily: FitbitActivityDaily;
  readonly body_weight: FitbitBodyWeight;
  readonly body_vo2max: FitbitVO2Max;
  readonly sleep_profile: FitbitSleepProfile;
  readonly snoring_daily: FitbitSnoringDaily;
};

/** Maps {@link FitbitTimeseriesType} discriminator to its typed payload. */
export type FitbitTimeseriesPayloadMap = {
  readonly spo2_intraday: FitbitSpO2Intraday;
  readonly hrv_detail: FitbitHRVDetail;
  readonly sleep_stages: FitbitSleepStages;
  readonly snoring_segments: FitbitSnoringSegments;
  readonly heart_rate_intraday: FitbitHeartRateIntraday;
};

// ---------------------------------------------------------------------------
// Google Health import scan types
// ---------------------------------------------------------------------------

/** Result of scanning a Google Health export directory. */
export interface GoogleHealthScanResult {
  readonly dataTypes: readonly GoogleHealthDataTypeInfo[];
  readonly dateRange: { readonly start: string; readonly end: string } | null;
  readonly deviceInfo: string | null;
  readonly totalFileCount: number;
  readonly estimatedSizeBytes: number;
}

/** Information about a single data type found during a Google Health scan. */
export interface GoogleHealthDataTypeInfo {
  readonly dataType: FitbitDataType;
  readonly tier: 1 | 2 | 3 | 4;
  readonly label: string;
  readonly recordCount: number;
  readonly dateRange: { readonly start: string; readonly end: string } | null;
  readonly estimatedSizeBytes: number;
  readonly files: readonly string[];
}

// ---------------------------------------------------------------------------
// Data-type metadata constants
// ---------------------------------------------------------------------------

/** Tier labels for UI grouping. */
export const FITBIT_DATA_TIERS: Record<1 | 2 | 3 | 4, string> = {
  1: 'Core Sleep & Respiratory',
  2: 'Heart & Recovery',
  3: 'Activity & Body',
  4: 'Advanced Metrics',
} as const;

/** Map each data type to its tier. */
export const FITBIT_DATA_TYPE_TIER: Record<FitbitDataType, 1 | 2 | 3 | 4> = {
  sleep_session: 1,
  sleep_score: 1,
  sleep_stages: 1,
  spo2_daily: 1,
  spo2_intraday: 1,
  respiratory_rate: 1,
  hrv_daily: 2,
  hrv_detail: 2,
  heart_rate_resting: 2,
  heart_rate_intraday: 2,
  readiness: 2,
  stress: 2,
  temperature: 2,
  activity_daily: 3,
  body_weight: 3,
  body_vo2max: 3,
  sleep_profile: 4,
  snoring_daily: 4,
  snoring_segments: 4,
};

/** Human-readable labels for each data type. */
export const FITBIT_DATA_TYPE_LABEL: Record<FitbitDataType, string> = {
  sleep_session: 'Sleep Sessions',
  sleep_score: 'Sleep Scores',
  sleep_stages: 'Sleep Stages',
  spo2_daily: 'SpO₂ (Daily)',
  spo2_intraday: 'SpO₂ (Per-Minute)',
  respiratory_rate: 'Respiratory Rate',
  hrv_daily: 'HRV (Daily)',
  hrv_detail: 'HRV (Detailed)',
  heart_rate_resting: 'Resting Heart Rate',
  heart_rate_intraday: 'Heart Rate (Intraday)',
  readiness: 'Readiness Score',
  stress: 'Stress Score',
  temperature: 'Skin Temperature',
  activity_daily: 'Daily Activity',
  body_weight: 'Weight',
  body_vo2max: 'VO₂ Max',
  sleep_profile: 'Sleep Profile',
  snoring_daily: 'Snoring (Daily)',
  snoring_segments: 'Snoring (Detailed)',
};
