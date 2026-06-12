/**
 * Hook for fetching intraday wearable signal series for a single date (or an
 * explicit session time-window) and normalising every supported series into a
 * uniform, viewer-ready shape.
 *
 * The per-session signal viewer renders wearable data as aligned "lanes"
 * stacked beneath the CPAP flow/pressure signals. To do that it needs every
 * series in one consistent shape: a list of samples each carrying an *absolute*
 * epoch timestamp (so it can be projected onto session-relative time) plus a
 * numeric value and optional confidence. The four already-stored intraday types
 * each encode time differently (offset-from-base, minute-offset-from-start,
 * absolute local-time ISO strings); this hook hides that and emits one shape.
 *
 * ## Time base
 *
 * All wearable intraday timestamps in the Google Health export are local
 * wall-clock with no timezone. To align cleanly with CPAP session timestamps —
 * which are also wall-clock — we interpret every wearable timestamp as
 * wall-clock-as-UTC (the same convention {@link parseFitbitLegacyDateTime}
 * uses). `timestampMs` in the returned samples is therefore directly comparable
 * to `Date.parse(session.startTime)` parsed the same way; the viewer subtracts
 * the session start to get session-relative offsets. This is intentionally
 * timezone-independent so a record imported on one machine renders identically
 * on another (and in CI).
 *
 * Follows the useState + useEffect pattern with monotonic request sequencing
 * used across the wearable hooks (see {@link useWearableData}); a stale slow
 * request can never overwrite a fresher result.
 *
 * @module hooks/useWearableLanes
 */

import { useState, useEffect, useRef } from 'react';
import type {
  FitbitTimeseriesType,
  FitbitHeartRateIntraday,
  FitbitSpO2Intraday,
  FitbitHRVDetail,
  FitbitSleepStages,
  FitbitSnoringSegments,
} from '@/types';
import { getDB } from '@/services/storage/getDB';

// ---------------------------------------------------------------------------
// Public types — the frontend lane work builds against these.
// ---------------------------------------------------------------------------

/**
 * The intraday wearable types this hook can normalise. (Excludes any future
 * timeseries types without a numeric lane representation.)
 */
export type WearableIntradayType =
  | 'heart_rate_intraday'
  | 'spo2_intraday'
  | 'hrv_detail'
  | 'sleep_stages'
  | 'snoring_segments';

/** A single normalised sample on a wearable lane. */
export interface WearableSample {
  /**
   * Absolute timestamp in epoch milliseconds, using the wall-clock-as-UTC
   * convention described in the module docstring. Compare against the session
   * start (parsed the same way) to obtain session-relative time.
   */
  readonly timestampMs: number;
  /**
   * The lane value. Units depend on the series:
   * - `heart_rate_intraday` → bpm
   * - `spo2_intraday` → SpO₂ percent
   * - `hrv_detail` → RMSSD (ms)
   * - `snoring_segments` → mean dBA
   * - `sleep_stages` → ordinal stage code (see {@link SLEEP_STAGE_CODES})
   */
  readonly value: number;
  /**
   * Source confidence/coverage when the series provides one, else `undefined`.
   * - `heart_rate_intraday` → Fitbit optical confidence 0–3
   * - `hrv_detail` → coverage fraction 0–1
   * Other series omit this.
   */
  readonly confidence?: number;
}

/** One normalised wearable series ready to render as a lane. */
export interface WearableSeries {
  readonly dataType: WearableIntradayType;
  /** Calendar date (YYYY-MM-DD) this series belongs to. */
  readonly date: string;
  /** Samples, sorted ascending by `timestampMs`. */
  readonly samples: readonly WearableSample[];
  /** Earliest sample timestamp (epoch ms), or `null` when empty. */
  readonly startMs: number | null;
  /** Latest sample timestamp (epoch ms), or `null` when empty. */
  readonly endMs: number | null;
}

/** Result of {@link useWearableLanes}. */
export interface UseWearableTimeseriesResult {
  /**
   * Normalised series, one per requested data type that had data for the date.
   * Keyed by data type for direct lane lookup. Types with no stored record are
   * absent (not present as empty entries).
   */
  readonly series: Partial<Record<WearableIntradayType, WearableSeries>>;
  /** True while a fetch is in flight. */
  readonly loading: boolean;
  /** Error message if the fetch failed, else `null`. */
  readonly error: string | null;
}

/**
 * Ordinal codes for sleep stages, exposed so the viewer can map the
 * `sleep_stages` lane value back to a label / band height.
 */
export const SLEEP_STAGE_CODES = {
  wake: 3,
  rem: 2,
  light: 1,
  deep: 0,
} as const;

// ---------------------------------------------------------------------------
// Time-base helpers
// ---------------------------------------------------------------------------

/**
 * Parse a local-time ISO-like timestamp (`YYYY-MM-DDTHH:MM:SS[.sss]`, no TZ)
 * into a wall-clock-as-UTC epoch. Mirrors {@link parseFitbitLegacyDateTime} for
 * the ISO-string-bearing series (hrv_detail, sleep_stages, snoring_segments) so
 * every lane shares one time base. Returns `NaN` for unparseable input.
 */
function localIsoToWallClockEpoch(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(iso.trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s, ms] = m;
  return Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
    ms ? Number(ms.padEnd(3, '0')) : 0,
  );
}

// ---------------------------------------------------------------------------
// Per-type normalisers — each maps a stored payload to WearableSample[].
// ---------------------------------------------------------------------------

function normaliseHeartRate(data: FitbitHeartRateIntraday): WearableSample[] {
  const base = data.baseTimestampMs;
  return data.samples.map((s) => ({
    timestampMs: base + s.offsetSec * 1000,
    value: s.bpm,
    confidence: s.confidence,
  }));
}

function normaliseSpO2(data: FitbitSpO2Intraday): WearableSample[] {
  const base = localIsoToWallClockEpoch(data.sleepStartTime);
  if (Number.isNaN(base)) return [];
  return data.samples.map((s) => ({
    timestampMs: base + s.minuteOffset * 60_000,
    value: s.value,
  }));
}

function normaliseHrvDetail(data: FitbitHRVDetail): WearableSample[] {
  const out: WearableSample[] = [];
  for (const interval of data.intervals) {
    const ts = localIsoToWallClockEpoch(interval.timestamp);
    if (Number.isNaN(ts)) continue;
    out.push({ timestampMs: ts, value: interval.rmssd, confidence: interval.coverage });
  }
  return out;
}

function normaliseSleepStages(data: FitbitSleepStages): WearableSample[] {
  const out: WearableSample[] = [];
  for (const t of data.transitions) {
    const ts = localIsoToWallClockEpoch(t.timestamp);
    if (Number.isNaN(ts)) continue;
    out.push({ timestampMs: ts, value: SLEEP_STAGE_CODES[t.stage] });
  }
  return out;
}

function normaliseSnoring(data: FitbitSnoringSegments): WearableSample[] {
  const out: WearableSample[] = [];
  for (const seg of data.segments) {
    const ts = localIsoToWallClockEpoch(seg.timestamp);
    if (Number.isNaN(ts)) continue;
    out.push({ timestampMs: ts, value: seg.meanDba });
  }
  return out;
}

/**
 * Dispatch a stored timeseries payload to its normaliser. Returns `null` for
 * data types this hook does not render.
 */
function normalise(dataType: FitbitTimeseriesType, data: unknown): WearableSample[] | null {
  switch (dataType) {
    case 'heart_rate_intraday':
      return normaliseHeartRate(data as FitbitHeartRateIntraday);
    case 'spo2_intraday':
      return normaliseSpO2(data as FitbitSpO2Intraday);
    case 'hrv_detail':
      return normaliseHrvDetail(data as FitbitHRVDetail);
    case 'sleep_stages':
      return normaliseSleepStages(data as FitbitSleepStages);
    case 'snoring_segments':
      return normaliseSnoring(data as FitbitSnoringSegments);
    default:
      return null;
  }
}

function buildSeries(
  dataType: WearableIntradayType,
  date: string,
  rawSamples: WearableSample[],
): WearableSeries {
  const samples = rawSamples.slice().sort((a, b) => a.timestampMs - b.timestampMs);
  const startMs = samples.length > 0 ? (samples[0]?.timestampMs ?? null) : null;
  const endMs = samples.length > 0 ? (samples[samples.length - 1]?.timestampMs ?? null) : null;
  return { dataType, date, samples, startMs, endMs };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetch and normalise intraday wearable series for a single calendar date.
 *
 * One record per (source, dataType, date) is stored, so this issues an O(1)
 * keyed lookup per requested type. When `date` is `null` or `dataTypes` is
 * empty, no query runs and an empty result is returned.
 *
 * @param date       - Calendar date (YYYY-MM-DD) to load, or `null` to skip.
 * @param dataTypes  - Which intraday series to load.
 * @param source     - Integration source. Defaults to `'fitbit'`.
 * @returns Normalised series keyed by data type, plus loading/error state.
 */
export function useWearableLanes(
  date: string | null,
  dataTypes: readonly WearableIntradayType[],
  source = 'fitbit',
): UseWearableTimeseriesResult {
  const [series, setSeries] = useState<Partial<Record<WearableIntradayType, WearableSeries>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  // Stable dependency key so identical requests don't re-fetch.
  const typesKey = dataTypes.slice().sort().join(',');

  useEffect(() => {
    if (date === null || dataTypes.length === 0) {
      setSeries({});
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    // Snapshot the requested types for this run.
    const types = typesKey.split(',') as WearableIntradayType[];

    void (async () => {
      try {
        const db = await getDB();

        const records = await Promise.all(
          types.map((dt) => db.getIntegrationTimeseriesByKey(source, dt, date)),
        );

        // Discard if a newer request superseded this one.
        if (requestId !== requestIdRef.current) return;

        const next: Partial<Record<WearableIntradayType, WearableSeries>> = {};
        for (let i = 0; i < types.length; i++) {
          const dt = types[i];
          const record = records[i];
          if (!dt || !record) continue;

          const samples = normalise(record.dataType, record.data);
          if (!samples) continue;

          next[dt] = buildSeries(dt, date, samples);
        }

        setSeries(next);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load wearable timeseries');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();
  }, [date, typesKey, source]);

  return { series, loading, error };
}
