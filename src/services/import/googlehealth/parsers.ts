/**
 * Individual data-type parsers for Google Health (Fitbit) export files.
 *
 * Each parser reads file content (via `File.text()`) and returns normalized
 * records keyed by date (YYYY-MM-DD) ready for storage. All parsers are
 * resilient: a single malformed record logs a warning and is skipped rather
 * than throwing.
 *
 * ## Timezone conventions
 *
 * Google Health export files are inconsistent about timezones:
 * - **UTC (`Z` suffix)**: sleep_score, spo2, stress
 * - **Local time (no TZ)**: HRV daily/detail, respiratory rate, temperature
 * - **ISO 8601 with offset**: rare; treated as-is
 *
 * Each parser documents its expectation. Date keys always use the calendar
 * date from the timestamp (not shifted to UTC) to align with CPAP session dates.
 *
 * @module services/import/googlehealth/parsers
 */

import type {
  FitbitSleepSession,
  FitbitSleepScore,
  FitbitSpO2Daily,
  FitbitSpO2Intraday,
  FitbitHeartRateIntraday,
  FitbitHeartRateIntradaySample,
  FitbitHRVDaily,
  FitbitHRVDetail,
  FitbitHRVDetailInterval,
  FitbitRespiratoryRate,
  FitbitRestingHeartRate,
  FitbitReadiness,
  FitbitStress,
  FitbitTemperature,
  FitbitActivityDaily,
  FitbitSnoringDaily,
  FitbitSnoringSegments,
  FitbitSnoringSegment,
  FitbitSleepStages,
  FitbitSleepStageTransition,
} from '@/types/fitbit';
import {
  parseCSV,
  extractDate,
  parseFitbitLegacyDate,
  parseFitbitLegacyDateTime,
  parseNumericField,
  parseNumericFieldWithDefault,
} from './csv-utils';
import { warnParseIssue } from './logging';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** A parsed record with its date key (YYYY-MM-DD). */
export interface ParsedRecord<T> {
  readonly date: string;
  readonly data: T;
}

// ---------------------------------------------------------------------------
// Worker-safe pure cores
// ---------------------------------------------------------------------------
//
// The heavy intraday parsers (heart rate, SpO2, HRV detail, snoring) are the
// ones moved off the main thread (ADR 0027). Their core logic is factored out
// here so that it (1) operates on already-decoded `(fileName, text)` input with
// NO `File`/DOM dependency, and (2) can be invoked verbatim from BOTH the
// existing `File[]`-based public functions (the equivalence baseline) and the
// `fitbitParser.worker`.
//
// IMPORTANT: the arithmetic/semantics here are a VERBATIM move from the original
// per-file bodies — same grouping, same `parseFitbitLegacyDateTime`, same
// sort/map, same outputs. Golden-fixture tests gate this equivalence.

/**
 * Per-file progress callback for the chunked worker-safe cores.
 *
 * Invoked between processed chunks of a file's entries so the worker can report
 * determinate within-file progress. `samplesTotal` is known up-front (right
 * after `JSON.parse` / `parseCSV`), so the reported fraction is determinate.
 */
export interface CoreProgressReport {
  /** 0-based index of the file currently being processed. */
  readonly fileIndex: number;
  /** Name of the file currently being processed. */
  readonly fileName: string;
  /** Entries processed so far within this file. */
  readonly samplesProcessed: number;
  /** Total entries in this file (known up-front). */
  readonly samplesTotal: number;
}

/** Optional per-chunk progress callback passed to the worker-safe cores. */
export type CoreProgressCallback = (report: CoreProgressReport) => void;

/**
 * Default chunk size for the per-entry loops in the worker-safe cores.
 *
 * Progress is emitted (and the cooperative chunk boundary is hit) every this
 * many entries. Chosen to bound `postMessage` frequency from the worker while
 * keeping the within-file progress bar visibly live on ~17k-sample HR files.
 */
export const DEFAULT_CORE_CHUNK_SIZE = 2_000;

// ---------------------------------------------------------------------------
// Sleep sessions (JSON)
// ---------------------------------------------------------------------------

/**
 * Raw sleep entry shape from `Global Export Data/sleep-YYYY-MM-DD.json` files.
 * Only the fields we consume are declared.
 */
interface RawSleepEntry {
  readonly dateOfSleep?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly duration?: number;
  readonly efficiency?: number;
  readonly minutesAsleep?: number;
  readonly minutesAwake?: number;
  readonly timeInBed?: number;
  readonly type?: string;
  readonly mainSleep?: boolean;
  readonly levels?: {
    readonly summary?: Partial<
      Record<'deep' | 'wake' | 'light' | 'rem', { readonly minutes?: number }>
    >;
    readonly data?: readonly {
      readonly dateTime?: string;
      readonly level?: string;
      readonly seconds?: number;
    }[];
  };
}

/**
 * Parse Fitbit sleep JSON files.
 *
 * Each file (`sleep-YYYY-MM-DD.json`) contains a JSON array with ~30 days
 * of sleep log entries. Only `mainSleep: true` entries are returned.
 *
 * Returns both daily records and sleep-stage transition timeseries.
 *
 * **Timezone**: `startTime` / `endTime` are local-time ISO strings (no TZ).
 * `dateOfSleep` is a plain YYYY-MM-DD date.
 */
export async function parseSleepFiles(files: File[]): Promise<{
  sessions: ParsedRecord<FitbitSleepSession>[];
  stages: ParsedRecord<FitbitSleepStages>[];
}> {
  const sessions: ParsedRecord<FitbitSleepSession>[] = [];
  const stages: ParsedRecord<FitbitSleepStages>[] = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const entries: RawSleepEntry[] = JSON.parse(text) as RawSleepEntry[];

      for (const entry of entries) {
        try {
          if (!entry.mainSleep) continue;
          const date = entry.dateOfSleep;
          if (!date) continue;

          const session: FitbitSleepSession = {
            startTime: entry.startTime ?? '',
            endTime: entry.endTime ?? '',
            durationMs: entry.duration ?? 0,
            efficiency: entry.efficiency ?? 0,
            minutesAsleep: entry.minutesAsleep ?? 0,
            minutesAwake: entry.minutesAwake ?? 0,
            timeInBed: entry.timeInBed ?? 0,
            type: entry.type === 'stages' ? 'stages' : 'classic',
            stages: {
              deep: entry.levels?.summary?.deep?.minutes ?? 0,
              light: entry.levels?.summary?.light?.minutes ?? 0,
              rem: entry.levels?.summary?.rem?.minutes ?? 0,
              wake: entry.levels?.summary?.wake?.minutes ?? 0,
            },
            isMainSleep: true,
          };

          sessions.push({ date, data: session });

          // Extract sleep stage transitions from levels.data
          if (entry.levels?.data && entry.levels.data.length > 0) {
            const transitions: FitbitSleepStageTransition[] = [];
            for (const segment of entry.levels.data) {
              const stage = normalizeSleepStage(segment.level);
              if (!stage || !segment.dateTime) continue;
              transitions.push({
                timestamp: segment.dateTime,
                stage,
                durationSeconds: segment.seconds ?? 0,
              });
            }
            if (transitions.length > 0) {
              stages.push({ date, data: { transitions } });
            }
          }
        } catch (e) {
          warnParseIssue('Skipping malformed sleep entry in', file.name, e);
        }
      }
    } catch (e) {
      warnParseIssue('Failed to parse sleep file', file.name, e);
    }
  }

  return { sessions, stages };
}

function normalizeSleepStage(level: string | undefined): 'deep' | 'light' | 'rem' | 'wake' | null {
  switch (level) {
    case 'deep':
    case 'light':
    case 'rem':
    case 'wake':
      return level;
    case 'restless':
    case 'awake':
      return 'wake';
    case 'asleep':
      return 'light';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Sleep score (CSV)
// ---------------------------------------------------------------------------

/**
 * Parse the sleep score CSV.
 *
 * Source: `Sleep Score/sleep_score.csv`
 *
 * **Timezone**: timestamps have `Z` suffix (UTC). Date key is extracted from
 * the UTC timestamp's calendar date.
 */
export async function parseSleepScoreFile(file: File): Promise<ParsedRecord<FitbitSleepScore>[]> {
  const results: ParsedRecord<FitbitSleepScore>[] = [];

  try {
    const text = await file.text();
    const { headers, rows } = parseCSV(text);
    const idx = buildColumnIndex(headers);

    for (const row of rows) {
      try {
        const timestamp = getColumn(row, idx, 'timestamp');
        if (!timestamp) continue;

        const date = extractDate(timestamp);
        const overall = parseNumericFieldWithDefault(getColumn(row, idx, 'overall_score'), 0);

        if (overall === 0) continue; // Skip entries with no score

        results.push({
          date,
          data: {
            overallScore: overall,
            compositionScore: parseNumericFieldWithDefault(
              getColumn(row, idx, 'composition_score'),
              0,
            ),
            revitalizationScore: parseNumericFieldWithDefault(
              getColumn(row, idx, 'revitalization_score'),
              0,
            ),
            durationScore: parseNumericFieldWithDefault(getColumn(row, idx, 'duration_score'), 0),
            deepSleepMinutes: parseNumericFieldWithDefault(
              getColumn(row, idx, 'deep_sleep_in_minutes'),
              0,
            ),
            restingHeartRate: parseNumericFieldWithDefault(
              getColumn(row, idx, 'resting_heart_rate'),
              0,
            ),
            restlessnessScore: parseNumericFieldWithDefault(getColumn(row, idx, 'restlessness'), 0),
          },
        });
      } catch (e) {
        warnParseIssue('Skipping malformed sleep score row in', file.name, e);
      }
    }
  } catch (e) {
    warnParseIssue('Failed to parse sleep score file', file.name, e);
  }

  return results;
}

// ---------------------------------------------------------------------------
// SpO2 daily (CSV)
// ---------------------------------------------------------------------------

/**
 * Parse daily SpO2 CSV files.
 *
 * Source: `Oxygen Saturation (SpO2)/Daily SpO2 - *.csv`
 *
 * **Timezone**: timestamps have `Z` suffix (UTC).
 */
export async function parseSpO2DailyFiles(files: File[]): Promise<ParsedRecord<FitbitSpO2Daily>[]> {
  const results: ParsedRecord<FitbitSpO2Daily>[] = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      const idx = buildColumnIndex(headers);

      for (const row of rows) {
        try {
          const timestamp = getColumn(row, idx, 'timestamp');
          if (!timestamp) continue;

          const avg = parseNumericField(getColumn(row, idx, 'average_value'));
          if (avg === null) continue;

          const date = extractDate(timestamp);
          const lower = parseNumericFieldWithDefault(getColumn(row, idx, 'lower_bound'), 0);
          const upper = parseNumericFieldWithDefault(getColumn(row, idx, 'upper_bound'), 0);

          results.push({
            date,
            data: {
              avg,
              min: lower,
              max: upper,
              lowerBound: lower,
              upperBound: upper,
              standardDeviation: upper > 0 && lower > 0 ? (upper - lower) / 2 : 0,
            },
          });
        } catch (e) {
          warnParseIssue('Skipping malformed SpO2 daily row in', file.name, e);
        }
      }
    } catch (e) {
      warnParseIssue('Failed to parse SpO2 daily file', file.name, e);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// SpO2 intraday (CSV)
// ---------------------------------------------------------------------------

/**
 * Parse per-minute SpO2 CSV files.
 *
 * Source: `Oxygen Saturation (SpO2)/Minute SpO2 - *.csv`
 *
 * **Timezone**: timestamps have `Z` suffix (UTC).
 *
 * **Note**: Values of exactly 50 are sentinel values indicating
 * invalid/low-confidence readings and are filtered out.
 */
export async function parseSpO2IntradayFiles(
  files: File[],
): Promise<ParsedRecord<FitbitSpO2Intraday>[]> {
  const results: ParsedRecord<FitbitSpO2Intraday>[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    results.push(...parseSpO2IntradayCore(file.name, await file.text(), i));
  }
  return results;
}

/**
 * Worker-safe core for {@link parseSpO2IntradayFiles}. Operates on decoded text.
 *
 * Verbatim move of the per-file body. Chunks the per-row loop so a progress
 * callback can report determinate within-file progress (`onProgress`). The
 * returned output is byte-identical to the corresponding single-file slice of
 * {@link parseSpO2IntradayFiles}.
 */
export function parseSpO2IntradayCore(
  fileName: string,
  text: string,
  fileIndex = 0,
  onProgress?: CoreProgressCallback,
  chunkSize: number = DEFAULT_CORE_CHUNK_SIZE,
): ParsedRecord<FitbitSpO2Intraday>[] {
  const results: ParsedRecord<FitbitSpO2Intraday>[] = [];

  try {
    const { headers, rows } = parseCSV(text);
    const idx = buildColumnIndex(headers);

    // Group samples by date
    const grouped = new Map<string, { timestamps: Date[]; values: number[] }>();

    const total = rows.length;
    for (let r = 0; r < total; r++) {
      const row = rows[r];
      if (!row) continue;
      try {
        const timestamp = getColumn(row, idx, 'timestamp');
        const valueStr = getColumn(row, idx, 'value');
        if (!timestamp || !valueStr) continue;

        const value = parseNumericField(valueStr);
        if (value === null || value === 50) continue; // Sentinel filter

        const date = extractDate(timestamp);
        const ts = new Date(timestamp);
        if (Number.isNaN(ts.getTime())) continue;

        let group = grouped.get(date);
        if (!group) {
          group = { timestamps: [], values: [] };
          grouped.set(date, group);
        }
        group.timestamps.push(ts);
        group.values.push(value);
      } catch {
        // Skip malformed row silently for intraday data
      }
      reportChunk(onProgress, fileIndex, fileName, r, total, chunkSize);
    }

    for (const [date, group] of grouped) {
      if (group.timestamps.length === 0) continue;

      // Sort by timestamp
      const sortedPairs = group.timestamps
        .map((ts, i) => ({ ts, value: group.values[i] ?? 0 }))
        .sort((a, b) => a.ts.getTime() - b.ts.getTime());

      const firstTs = sortedPairs[0]?.ts;
      if (!firstTs) continue;

      const samples = sortedPairs.map((pair) => ({
        minuteOffset: Math.round((pair.ts.getTime() - firstTs.getTime()) / 60_000),
        value: pair.value,
      }));

      results.push({
        date,
        data: {
          samples,
          sleepStartTime: firstTs.toISOString(),
          sampleCount: samples.length,
        },
      });
    }

    onProgress?.({ fileIndex, fileName, samplesProcessed: total, samplesTotal: total });
  } catch (e) {
    warnParseIssue('Failed to parse SpO2 intraday file', fileName, e);
  }

  return results;
}

// ---------------------------------------------------------------------------
// HRV daily (CSV)
// ---------------------------------------------------------------------------

/**
 * Parse daily HRV summary CSV files.
 *
 * Source: `Heart Rate Variability/Daily Heart Rate Variability Summary - *.csv`
 *
 * **Timezone**: timestamps are local time (no TZ indicator).
 */
export async function parseHRVDailyFiles(files: File[]): Promise<ParsedRecord<FitbitHRVDaily>[]> {
  const results: ParsedRecord<FitbitHRVDaily>[] = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      const idx = buildColumnIndex(headers);

      for (const row of rows) {
        try {
          const timestamp = getColumn(row, idx, 'timestamp');
          if (!timestamp) continue;

          const rmssd = parseNumericField(getColumn(row, idx, 'rmssd'));
          if (rmssd === null) continue;

          const date = extractDate(timestamp);

          results.push({
            date,
            data: {
              dailyRmssd: rmssd,
              deepRmssd: rmssd, // Daily summary only has one RMSSD value
              nremHeartRate: parseNumericFieldWithDefault(getColumn(row, idx, 'nremhr'), 0),
              entropy: parseNumericField(getColumn(row, idx, 'entropy')),
            },
          });
        } catch (e) {
          warnParseIssue('Skipping malformed HRV daily row in', file.name, e);
        }
      }
    } catch (e) {
      warnParseIssue('Failed to parse HRV daily file', file.name, e);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// HRV detail (CSV)
// ---------------------------------------------------------------------------

/**
 * Parse detailed HRV CSV files (5-minute intervals during sleep).
 *
 * Source: `Heart Rate Variability/Heart Rate Variability Details - *.csv`
 *
 * **Timezone**: timestamps are local time (no TZ indicator).
 *
 * Records are grouped by the calendar date of the timestamp.
 */
export async function parseHRVDetailFiles(files: File[]): Promise<ParsedRecord<FitbitHRVDetail>[]> {
  const results: ParsedRecord<FitbitHRVDetail>[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    results.push(...parseHRVDetailCore(file.name, await file.text(), i));
  }
  return results;
}

/**
 * Worker-safe core for {@link parseHRVDetailFiles}. Operates on decoded text.
 *
 * Verbatim move of the per-file body; chunked for determinate progress. Output
 * is byte-identical to the corresponding single-file slice of
 * {@link parseHRVDetailFiles}.
 */
export function parseHRVDetailCore(
  fileName: string,
  text: string,
  fileIndex = 0,
  onProgress?: CoreProgressCallback,
  chunkSize: number = DEFAULT_CORE_CHUNK_SIZE,
): ParsedRecord<FitbitHRVDetail>[] {
  const results: ParsedRecord<FitbitHRVDetail>[] = [];

  try {
    const { headers, rows } = parseCSV(text);
    const idx = buildColumnIndex(headers);

    // Group intervals by date
    const grouped = new Map<string, FitbitHRVDetailInterval[]>();

    const total = rows.length;
    for (let r = 0; r < total; r++) {
      const row = rows[r];
      if (!row) continue;
      try {
        const timestamp = getColumn(row, idx, 'timestamp');
        if (!timestamp) continue;

        const rmssd = parseNumericField(getColumn(row, idx, 'rmssd'));
        if (rmssd === null) continue;

        const date = extractDate(timestamp);
        const interval: FitbitHRVDetailInterval = {
          timestamp,
          rmssd,
          coverage: parseNumericFieldWithDefault(getColumn(row, idx, 'coverage'), 0),
          hf: parseNumericFieldWithDefault(getColumn(row, idx, 'high_frequency'), 0),
          lf: parseNumericFieldWithDefault(getColumn(row, idx, 'low_frequency'), 0),
        };

        let group = grouped.get(date);
        if (!group) {
          group = [];
          grouped.set(date, group);
        }
        group.push(interval);
      } catch {
        // Skip silently for detail data
      }
      reportChunk(onProgress, fileIndex, fileName, r, total, chunkSize);
    }

    for (const [date, intervals] of grouped) {
      if (intervals.length === 0) continue;
      results.push({ date, data: { intervals } });
    }

    onProgress?.({ fileIndex, fileName, samplesProcessed: total, samplesTotal: total });
  } catch (e) {
    warnParseIssue('Failed to parse HRV detail file', fileName, e);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Respiratory rate (CSV)
// ---------------------------------------------------------------------------

/**
 * Parse respiratory rate CSV files.
 *
 * Source: `Heart Rate Variability/Daily Respiratory Rate Summary - *.csv`
 *
 * Two formats exist:
 * 1. Simple: `timestamp,daily_respiratory_rate`
 * 2. Detailed: `timestamp,full_sleep_breathing_rate,full_sleep_standard_deviation,...`
 *
 * **Timezone**: timestamps are local time (no TZ indicator).
 */
export async function parseRespiratoryRateFiles(
  files: File[],
): Promise<ParsedRecord<FitbitRespiratoryRate>[]> {
  const results: ParsedRecord<FitbitRespiratoryRate>[] = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      const idx = buildColumnIndex(headers);

      // Detect format based on headers
      const isDetailed = headers.some(
        (h) =>
          h.toLowerCase().includes('full_sleep_breathing_rate') ||
          h.toLowerCase().includes('full_sleep_standard_deviation'),
      );

      for (const row of rows) {
        try {
          const timestamp = getColumn(row, idx, 'timestamp');
          if (!timestamp) continue;

          const date = extractDate(timestamp);

          if (isDetailed) {
            // Detailed format with per-stage breakdown
            const fullRate = parseNumericField(getColumn(row, idx, 'full_sleep_breathing_rate'));
            if (fullRate === null) continue;

            results.push({
              date,
              data: {
                fullSleepRate: fullRate,
                fullSleepStdDev: parseNumericFieldWithDefault(
                  getColumn(row, idx, 'full_sleep_standard_deviation'),
                  0,
                ),
                deepRate: parseNumericField(getColumn(row, idx, 'deep_sleep_breathing_rate')),
                deepStdDev: parseNumericField(getColumn(row, idx, 'deep_sleep_standard_deviation')),
                lightRate: parseNumericField(getColumn(row, idx, 'light_sleep_breathing_rate')),
                lightStdDev: parseNumericField(
                  getColumn(row, idx, 'light_sleep_standard_deviation'),
                ),
                remRate: parseNumericField(getColumn(row, idx, 'rem_sleep_breathing_rate')),
                remStdDev: parseNumericField(getColumn(row, idx, 'rem_sleep_standard_deviation')),
              },
            });
          } else {
            // Simple format with just daily rate
            const rate = parseNumericField(getColumn(row, idx, 'daily_respiratory_rate'));
            if (rate === null) continue;

            results.push({
              date,
              data: {
                fullSleepRate: rate,
                fullSleepStdDev: 0,
                deepRate: null,
                deepStdDev: null,
                lightRate: null,
                lightStdDev: null,
                remRate: null,
                remStdDev: null,
              },
            });
          }
        } catch (e) {
          warnParseIssue('Skipping malformed respiratory rate row in', file.name, e);
        }
      }
    } catch (e) {
      warnParseIssue('Failed to parse respiratory rate file', file.name, e);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Resting heart rate (JSON)
// ---------------------------------------------------------------------------

/**
 * Raw resting HR entry from `Global Export Data/resting_heart_rate-*.json`.
 */
interface RawRestingHREntry {
  readonly dateTime?: string;
  readonly value?: {
    readonly date?: string;
    readonly value?: number;
    readonly error?: number;
  };
}

/**
 * Parse resting heart rate JSON files.
 *
 * Source: `Global Export Data/resting_heart_rate-YYYY-MM-DD.json`
 *
 * **Note**: The `dateTime` field uses MM/DD/YY format. The `value.date` field
 * uses MM/DD/YYYY format. We prefer `value.date` for the date key.
 */
export async function parseRestingHeartRateFiles(
  files: File[],
): Promise<ParsedRecord<FitbitRestingHeartRate>[]> {
  const results: ParsedRecord<FitbitRestingHeartRate>[] = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const entries: RawRestingHREntry[] = JSON.parse(text) as RawRestingHREntry[];

      for (const entry of entries) {
        try {
          if (!entry.value?.value) continue;

          // Prefer value.date (MM/DD/YYYY) over dateTime (MM/DD/YY)
          let date: string;
          if (entry.value.date) {
            date = parseFitbitLegacyDate(entry.value.date);
          } else if (entry.dateTime) {
            date = parseFitbitLegacyDate(entry.dateTime);
          } else {
            continue;
          }

          results.push({
            date,
            data: {
              restingHeartRate: entry.value.value,
              error: entry.value.error !== undefined ? entry.value.error : null,
            },
          });
        } catch (e) {
          warnParseIssue('Skipping malformed resting HR entry in', file.name, e);
        }
      }
    } catch (e) {
      warnParseIssue('Failed to parse resting HR file', file.name, e);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Intraday heart rate (JSON)
// ---------------------------------------------------------------------------

/**
 * Raw intraday heart-rate entry from `Global Export Data/heart_rate-*.json`.
 *
 * One file holds ~17k entries (≈5-second cadence) and may span the midnight
 * boundary, so entries are grouped by their own calendar date rather than by
 * the filename's date.
 */
interface RawHeartRateIntradayEntry {
  /** Local wall-clock time, `MM/DD/YY HH:MM:SS`, no timezone. */
  readonly dateTime?: string;
  readonly value?: {
    readonly bpm?: number;
    readonly confidence?: number;
  };
}

/**
 * Parse intraday (≈5-second cadence) heart-rate JSON files.
 *
 * Source: `Global Export Data/heart_rate-YYYY-MM-DD.json`
 *
 * **Timezone**: `dateTime` is local wall-clock time in `MM/DD/YY HH:MM:SS`
 * format with no timezone indicator. We convert each sample to a wall-clock
 * epoch via {@link parseFitbitLegacyDateTime} (which uses `Date.UTC` on the
 * literal components, so results are timezone-independent and align with CPAP
 * session wall-clock times).
 *
 * **Date grouping**: the filename date is unreliable — a file named
 * `heart_rate-2016-08-24.json` can begin at `08/25/16`, and a night of samples
 * straddles midnight. Samples are therefore grouped by the calendar date of
 * each sample's own timestamp, so one file may yield two date records.
 *
 * ## Storage volume strategy — full-resolution, no downsampling
 *
 * At ~5-second cadence a full day is ~17k samples. Each stored sample is
 * `{ offsetSec, bpm, confidence }` — three small integers. Empirically a day's
 * record serialises to roughly 0.4–0.6 MB in IndexedDB's structured clone, and
 * ~3500 days (≈10 years) totals on the order of 1.5–2 GB.
 *
 * We deliberately keep FULL resolution rather than downsampling on import:
 *
 * - **Correctness (principle #2) first.** Intraday HR will drive breathing /
 *   arousal correlation against per-second CPAP flow; silently coarsening to
 *   15–30s would blunt exactly the short-timescale features that analysis
 *   targets. Any downsampling must be an explicit, opt-in, documented step —
 *   not a hidden import-time loss.
 * - **Records are independently loadable.** One record == one calendar date,
 *   keyed for O(1) lookup, so per-query cost is bounded by a single night's
 *   samples regardless of how many years are stored. Total DB footprint — not
 *   per-query latency — is the only concern, and IndexedDB origin quotas
 *   (typically a large fraction of free disk) comfortably absorb it. The
 *   quota-awareness layer warns the user as usage grows.
 * - **Confidence-0 noise is NOT dropped.** In sampled real exports confidence-0
 *   readings are only ~4% of samples; dropping them would save little while
 *   discarding data the consumer may legitimately want to weight. We retain
 *   `confidence` per sample so filtering/weighting is a downstream choice.
 *
 * Samples that fail to parse (bad timestamp, missing/non-numeric bpm) are
 * skipped individually; whole-file failures are caught and logged.
 */
export async function parseHeartRateIntradayFiles(
  files: File[],
): Promise<ParsedRecord<FitbitHeartRateIntraday>[]> {
  const results: ParsedRecord<FitbitHeartRateIntraday>[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    results.push(...parseHeartRateIntradayCore(file.name, await file.text(), i));
  }
  return results;
}

/**
 * Worker-safe core for {@link parseHeartRateIntradayFiles}. Operates on decoded
 * text.
 *
 * This is the heaviest parser (a synchronous `JSON.parse` of ~17k entries plus a
 * full `.sort()` and `.map()`), and the primary reason for the worker move (ADR
 * 0027). The body is a VERBATIM move — same grouping, same
 * {@link parseFitbitLegacyDateTime}, same sort/map — so the output is
 * byte-identical to the corresponding single-file slice of
 * {@link parseHeartRateIntradayFiles}. The only addition is the chunked progress
 * callback over the (now-known-up-front) entries array.
 */
export function parseHeartRateIntradayCore(
  fileName: string,
  text: string,
  fileIndex = 0,
  onProgress?: CoreProgressCallback,
  chunkSize: number = DEFAULT_CORE_CHUNK_SIZE,
): ParsedRecord<FitbitHeartRateIntraday>[] {
  const results: ParsedRecord<FitbitHeartRateIntraday>[] = [];

  try {
    const entries: RawHeartRateIntradayEntry[] = JSON.parse(text) as RawHeartRateIntradayEntry[];

    // Group raw (epochMs, bpm, confidence) tuples by calendar date.
    const grouped = new Map<string, { epochMs: number; bpm: number; confidence: number }[]>();

    const total = entries.length;
    for (let e = 0; e < total; e++) {
      const entry = entries[e];
      try {
        const bpm = entry?.value?.bpm;
        if (
          entry === undefined ||
          entry.dateTime === undefined ||
          typeof bpm !== 'number' ||
          !Number.isFinite(bpm)
        ) {
          continue;
        }

        const { epochMs, date } = parseFitbitLegacyDateTime(entry.dateTime);
        const rawConfidence = entry.value?.confidence;
        const confidence =
          typeof rawConfidence === 'number' && Number.isFinite(rawConfidence) ? rawConfidence : 0;

        let group = grouped.get(date);
        if (!group) {
          group = [];
          grouped.set(date, group);
        }
        group.push({ epochMs, bpm, confidence });
      } catch {
        // Skip malformed sample silently for high-frequency intraday data.
      }
      reportChunk(onProgress, fileIndex, fileName, e, total, chunkSize);
    }

    for (const [date, raw] of grouped) {
      if (raw.length === 0) continue;

      // Sort chronologically so offsets are non-negative and monotonic.
      raw.sort((a, b) => a.epochMs - b.epochMs);

      const base = raw[0];
      if (!base) continue;
      const baseTimestampMs = base.epochMs;

      const samples: FitbitHeartRateIntradaySample[] = raw.map((r) => ({
        offsetSec: Math.round((r.epochMs - baseTimestampMs) / 1000),
        bpm: r.bpm,
        confidence: r.confidence,
      }));

      results.push({
        date,
        data: {
          baseTimestampMs,
          samples,
          sampleCount: samples.length,
        },
      });
    }

    onProgress?.({ fileIndex, fileName, samplesProcessed: total, samplesTotal: total });
  } catch (e) {
    warnParseIssue('Failed to parse intraday heart rate file', fileName, e);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Readiness (CSV)
// ---------------------------------------------------------------------------

/**
 * Parse Daily Readiness Score CSV files.
 *
 * Source: `Daily Readiness/Daily Readiness Score - *.csv`
 *
 * **Timezone**: `date` column is a plain YYYY-MM-DD date.
 */
export async function parseReadinessFiles(files: File[]): Promise<ParsedRecord<FitbitReadiness>[]> {
  const results: ParsedRecord<FitbitReadiness>[] = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      const idx = buildColumnIndex(headers);

      for (const row of rows) {
        try {
          const date = getColumn(row, idx, 'date');
          if (!date) continue;

          const score = parseNumericField(getColumn(row, idx, 'readiness_score_value'));
          if (score === null) continue;

          const stateRaw = (getColumn(row, idx, 'readiness_state') ?? '').toUpperCase();

          results.push({
            date: extractDate(date),
            data: {
              score,
              level: mapReadinessLevel(stateRaw),
              sleepSubScore: parseNumericFieldWithDefault(
                getColumn(row, idx, 'sleep_subcomponent'),
                0,
              ),
              hrvSubScore: parseNumericFieldWithDefault(getColumn(row, idx, 'hrv_subcomponent'), 0),
              activitySubScore: parseNumericFieldWithDefault(
                getColumn(row, idx, 'activity_subcomponent'),
                0,
              ),
            },
          });
        } catch (e) {
          warnParseIssue('Skipping malformed readiness row in', file.name, e);
        }
      }
    } catch (e) {
      warnParseIssue('Failed to parse readiness file', file.name, e);
    }
  }

  return results;
}

function mapReadinessLevel(state: string): 'Excellent' | 'Good' | 'Fair' | 'Low' {
  switch (state) {
    case 'EXCELLENT':
    case 'HIGH':
      return 'Excellent';
    case 'GOOD':
      return 'Good';
    case 'MEDIUM':
    case 'FAIR':
      return 'Fair';
    case 'LOW':
    case 'POOR':
      return 'Low';
    default:
      return 'Fair';
  }
}

// ---------------------------------------------------------------------------
// Stress score (CSV)
// ---------------------------------------------------------------------------

/**
 * Parse the Stress Score CSV file.
 *
 * Source: `Stress Score/Stress Score.csv`
 *
 * **Timezone**: `DATE` column uses ISO 8601 with `Z` suffix (UTC).
 * Some rows may use uppercase column names.
 */
export async function parseStressFile(file: File): Promise<ParsedRecord<FitbitStress>[]> {
  const results: ParsedRecord<FitbitStress>[] = [];

  try {
    const text = await file.text();
    const { headers, rows } = parseCSV(text);
    const idx = buildColumnIndex(headers);

    for (const row of rows) {
      try {
        // Handle both upper- and lower-case column names
        const dateStr = getColumn(row, idx, 'date') ?? getColumn(row, idx, 'DATE');
        if (!dateStr) continue;

        const date = extractDate(dateStr);

        const score = parseNumericField(
          getColumn(row, idx, 'stress_score') ?? getColumn(row, idx, 'STRESS_SCORE'),
        );
        if (score === null) continue;

        const calcFailed = (
          getColumn(row, idx, 'calculation_failed') ??
          getColumn(row, idx, 'CALCULATION_FAILED') ??
          'false'
        ).toLowerCase();

        results.push({
          date,
          data: {
            score,
            sleepPoints: parseNumericFieldWithDefault(
              getColumn(row, idx, 'sleep_points') ?? getColumn(row, idx, 'SLEEP_POINTS'),
              0,
            ),
            responsivenessPoints: parseNumericFieldWithDefault(
              getColumn(row, idx, 'responsiveness_points') ??
                getColumn(row, idx, 'RESPONSIVENESS_POINTS'),
              0,
            ),
            exertionPoints: parseNumericFieldWithDefault(
              getColumn(row, idx, 'exertion_points') ?? getColumn(row, idx, 'EXERTION_POINTS'),
              0,
            ),
            calculationFailed: calcFailed === 'true',
          },
        });
      } catch (e) {
        warnParseIssue('Skipping malformed stress row in', file.name, e);
      }
    }
  } catch (e) {
    warnParseIssue('Failed to parse stress file', file.name, e);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Temperature (CSV)
// ---------------------------------------------------------------------------

/**
 * Parse Computed Temperature CSV files.
 *
 * Source: `Temperature/Computed Temperature - *.csv`
 *
 * **Timezone**: `sleep_start` is local time (no TZ indicator).
 */
export async function parseTemperatureFiles(
  files: File[],
): Promise<ParsedRecord<FitbitTemperature>[]> {
  const results: ParsedRecord<FitbitTemperature>[] = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      const idx = buildColumnIndex(headers);

      for (const row of rows) {
        try {
          const sleepStart = getColumn(row, idx, 'sleep_start');
          if (!sleepStart) continue;

          const deviation = parseNumericField(getColumn(row, idx, 'nightly_temperature'));
          if (deviation === null) continue;

          const date = extractDate(sleepStart);

          results.push({
            date,
            data: {
              nightlyDeviation: deviation,
              baselineRelative: parseNumericField(
                getColumn(row, idx, 'baseline_relative_sample_sum'),
              ),
            },
          });
        } catch (e) {
          warnParseIssue('Skipping malformed temperature row in', file.name, e);
        }
      }
    } catch (e) {
      warnParseIssue('Failed to parse temperature file', file.name, e);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Activity / Active Zone Minutes (CSV)
// ---------------------------------------------------------------------------

/**
 * Parse Active Zone Minutes CSV files.
 *
 * Source: `Active Zone Minutes (AZM)/Active Zone Minutes - *.csv`
 *
 * The file has one row per date per heart-rate zone. Rows are grouped by
 * date and zone minutes summed.
 *
 * **Timezone**: `date_time` is a YYYY-MM-DD date (no time component).
 */
export async function parseActivityFiles(
  files: File[],
): Promise<ParsedRecord<FitbitActivityDaily>[]> {
  const results: ParsedRecord<FitbitActivityDaily>[] = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      const idx = buildColumnIndex(headers);

      // Accumulate per-date
      const grouped = new Map<
        string,
        {
          fatBurn: number;
          cardio: number;
          peak: number;
          total: number;
        }
      >();

      for (const row of rows) {
        try {
          const dateStr = getColumn(row, idx, 'date_time');
          if (!dateStr) continue;

          const date = extractDate(dateStr);
          const zone = (getColumn(row, idx, 'heart_zone_id') ?? '').toUpperCase();
          const minutes = parseNumericFieldWithDefault(getColumn(row, idx, 'total_minutes'), 0);

          let group = grouped.get(date);
          if (!group) {
            group = { fatBurn: 0, cardio: 0, peak: 0, total: 0 };
            grouped.set(date, group);
          }

          group.total += minutes;
          if (zone === 'FAT_BURN') {
            group.fatBurn += minutes;
          } else if (zone === 'CARDIO') {
            group.cardio += minutes;
          } else if (zone === 'PEAK') {
            group.peak += minutes;
          }
        } catch {
          // Skip silently
        }
      }

      for (const [date, group] of grouped) {
        results.push({
          date,
          data: {
            steps: 0, // Not available in AZM file
            caloriesTotal: 0, // Not available in AZM file
            activeZoneMinutes: group.total,
            sedentaryMinutes: 0, // Not available in AZM file
            lightlyActiveMinutes: group.fatBurn,
            fairlyActiveMinutes: group.cardio,
            veryActiveMinutes: group.peak,
          },
        });
      }
    } catch (e) {
      warnParseIssue('Failed to parse activity file', file.name, e);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Snoring (CSV)
// ---------------------------------------------------------------------------

/**
 * Parse Snore Details CSV files into daily summaries and per-segment records.
 *
 * Source: `Snore and Noise Detect/Snore Details - *.csv`
 *
 * Each row is one ~30-second measurement interval. Rows are grouped by date
 * to produce:
 * - **Daily summaries**: total segments, duration, average/max dB
 * - **Segments**: the raw intervals with timestamp and noise levels
 *
 * **Timezone**: timestamps are local time (no TZ indicator).
 */
export async function parseSnoringFiles(files: File[]): Promise<{
  daily: ParsedRecord<FitbitSnoringDaily>[];
  segments: ParsedRecord<FitbitSnoringSegments>[];
}> {
  const daily: ParsedRecord<FitbitSnoringDaily>[] = [];
  const segments: ParsedRecord<FitbitSnoringSegments>[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    const result = parseSnoringCore(file.name, await file.text(), i);
    daily.push(...result.daily);
    segments.push(...result.segments);
  }

  return { daily, segments };
}

/**
 * Worker-safe core for {@link parseSnoringFiles}. Operates on decoded text.
 *
 * Verbatim move of the per-file body; chunked for determinate progress. Output
 * is byte-identical to the corresponding single-file slice of
 * {@link parseSnoringFiles}.
 */
export function parseSnoringCore(
  fileName: string,
  text: string,
  fileIndex = 0,
  onProgress?: CoreProgressCallback,
  chunkSize: number = DEFAULT_CORE_CHUNK_SIZE,
): {
  daily: ParsedRecord<FitbitSnoringDaily>[];
  segments: ParsedRecord<FitbitSnoringSegments>[];
} {
  const daily: ParsedRecord<FitbitSnoringDaily>[] = [];
  const segments: ParsedRecord<FitbitSnoringSegments>[] = [];

  try {
    const { headers, rows } = parseCSV(text);
    const idx = buildColumnIndex(headers);

    // Group by date
    const grouped = new Map<string, FitbitSnoringSegment[]>();

    const total = rows.length;
    for (let r = 0; r < total; r++) {
      const row = rows[r];
      if (!row) continue;
      try {
        const timestamp = getColumn(row, idx, 'timestamp');
        if (!timestamp) continue;

        const date = extractDate(timestamp);
        const meanDba = parseNumericFieldWithDefault(getColumn(row, idx, 'mean_dba'), 0);
        const maxDba = parseNumericFieldWithDefault(getColumn(row, idx, 'max_dba'), 0);
        const sampleDuration = parseNumericFieldWithDefault(
          getColumn(row, idx, 'sample_duration'),
          30,
        );
        const snoreLabel = getColumn(row, idx, 'snore_label');
        const snoreDetected = snoreLabel === '1' || snoreLabel === 'true';

        const segment: FitbitSnoringSegment = {
          timestamp,
          durationSeconds: sampleDuration,
          meanDba,
          maxDba,
          snoreDetected,
        };

        let group = grouped.get(date);
        if (!group) {
          group = [];
          grouped.set(date, group);
        }
        group.push(segment);
      } catch {
        // Skip silently
      }
      reportChunk(onProgress, fileIndex, fileName, r, total, chunkSize);
    }

    for (const [date, segs] of grouped) {
      if (segs.length === 0) continue;

      // Build daily summary
      const totalDurationMinutes = segs.reduce((sum, s) => sum + s.durationSeconds / 60, 0);
      const dbValues = segs.filter((s) => s.meanDba > 0).map((s) => s.meanDba);
      const maxDbValues = segs.filter((s) => s.maxDba > 0).map((s) => s.maxDba);

      daily.push({
        date,
        data: {
          totalSegments: segs.length,
          totalDurationMinutes: Math.round(totalDurationMinutes * 10) / 10,
          avgDb:
            dbValues.length > 0
              ? Math.round((dbValues.reduce((a, b) => a + b, 0) / dbValues.length) * 10) / 10
              : null,
          maxDb: maxDbValues.length > 0 ? Math.max(...maxDbValues) : null,
        },
      });

      // Build segment timeseries
      segments.push({ date, data: { segments: segs } });
    }

    onProgress?.({ fileIndex, fileName, samplesProcessed: total, samplesTotal: total });
  } catch (e) {
    warnParseIssue('Failed to parse snoring file', fileName, e);
  }

  return { daily, segments };
}

// ---------------------------------------------------------------------------
// Column index utilities
// ---------------------------------------------------------------------------

/**
 * Emit a determinate within-file progress report at chunk boundaries.
 *
 * Called once per processed entry by the worker-safe cores, but only actually
 * invokes `onProgress` when a chunk boundary is crossed (`(index + 1) %
 * chunkSize === 0`). This bounds the postMessage frequency from the worker while
 * keeping within-file progress visibly live. The final exact total is emitted
 * separately by each core after its loop completes.
 *
 * @param index  0-based index of the entry just processed.
 * @param total  Total entries in the file (known up-front).
 */
function reportChunk(
  onProgress: CoreProgressCallback | undefined,
  fileIndex: number,
  fileName: string,
  index: number,
  total: number,
  chunkSize: number,
): void {
  if (!onProgress) return;
  if (chunkSize > 0 && (index + 1) % chunkSize === 0) {
    onProgress({ fileIndex, fileName, samplesProcessed: index + 1, samplesTotal: total });
  }
}

/**
 * Build a case-insensitive column name → index map from CSV headers.
 */
function buildColumnIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (h !== undefined) {
      map.set(h.trim().toLowerCase(), i);
    }
  }
  return map;
}

/**
 * Get a column value from a CSV row by header name (case-insensitive).
 * Returns `undefined` if the column is not found or the row is too short.
 */
function getColumn(
  row: string[],
  idx: Map<string, number>,
  columnName: string,
): string | undefined {
  const i = idx.get(columnName.toLowerCase());
  if (i === undefined) return undefined;
  return row[i]?.trim();
}
