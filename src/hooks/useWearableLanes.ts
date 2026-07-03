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
 * Wearable intraday lanes split into two timestamp conventions:
 *
 * - **Local wall-clock (no timezone):** `hrv_detail`, `snoring_segments`,
 *   `sleep_stages`. These are interpreted as wall-clock-as-UTC (the same
 *   convention {@link localIsoToWallClockEpoch} uses) and align to CPAP for
 *   free, since CPAP session timestamps are also local wall-clock.
 * - **UTC-sourced:** `heart_rate_intraday` AND `spo2_intraday`. Fitbit stamps
 *   both in UTC, so under the wall-clock-as-UTC convention their samples land at
 *   their UTC clock face — a 1:00 AM PDT reading would otherwise render at
 *   8:00 AM (a 7–8 h shift for a US-Pacific user). These two lanes are converted
 *   to LOCAL time by adding a per-night signed UTC offset via
 *   {@link applyOffset}, using the shared offset table from
 *   {@link useWearableOffsets} (derived from CPAP overlap; DST/browser-zone
 *   fallback). See `docs/accuracy/wearables.md` §10.
 *
 * After conversion every lane's `timestampMs` is in the same frame as
 * `sessionWallClockEpoch(session.startTime)` (see `signalLanes.ts`); the viewer
 * subtracts that base to get session-relative offsets, so no SignalViewer change
 * is needed. Do NOT compare against `new Date(session.startTime).getTime()` /
 * `Date.parse(...)` for wearable alignment: those interpret a timezone-less
 * string in the runtime's local zone, reintroducing exactly the shift the UTC
 * conversion removes.
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
import { localIsoToWallClockEpoch } from '@/utils/wallClock';
import { applyOffset } from '@/analysis/crossSource/wearableTimezone';
import { useWearableOffsets, offsetForDate } from '@/hooks/useWearableOffsets';

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
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Return the calendar dates to query for a session anchored on `date`: the
 * anchor plus its immediate neighbours (`date - 1` and `date + 1`).
 *
 * Intraday samples are stored split by the calendar date of each sample's own
 * timestamp, so a night spanning e.g. 23:00→07:00 lands in two date-keyed
 * records (the anchor's evening tail and the next day's morning bulk). Loading
 * both neighbours robustly covers sessions that start just after OR just before
 * midnight without the caller having to know which way the night straddles.
 *
 * Arithmetic is done on the `YYYY-MM-DD` string via {@link Date.UTC} so it is
 * timezone-independent and DST-safe, consistent with the wall-clock-as-UTC
 * convention documented in the module docstring. Returns `[date]` unchanged if
 * the input is not a well-formed `YYYY-MM-DD` string.
 */
function neighbourDates(date: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return [date];
  const [, y, mo, d] = m;
  const baseMs = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const fmt = (ms: number): string => {
    const dt = new Date(ms);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };
  const DAY_MS = 86_400_000;
  // Anchor first so it remains the natural primary; order is otherwise
  // irrelevant because samples are merged and sorted by absolute timestamp.
  return [date, fmt(baseMs - DAY_MS), fmt(baseMs + DAY_MS)];
}

// ---------------------------------------------------------------------------
// Per-type normalisers — each maps a stored payload to WearableSample[].
// ---------------------------------------------------------------------------

/**
 * Heart rate is UTC-sourced: each sample's wall-clock-as-UTC timestamp is shifted
 * into the local frame by `offsetMinutes` (the resolved per-night offset for this
 * record's date). With `offsetMinutes = 0` (unknown date) samples are left in
 * place — the pre-fix behaviour — so a missing offset degrades gracefully.
 */
function normaliseHeartRate(
  data: FitbitHeartRateIntraday,
  offsetMinutes: number,
): WearableSample[] {
  const base = data.baseTimestampMs;
  return data.samples.map((s) => ({
    timestampMs: applyOffset(base + s.offsetSec * 1000, offsetMinutes),
    value: s.bpm,
    confidence: s.confidence,
  }));
}

/**
 * SpO₂ is UTC-sourced (the Minute SpO₂ export carries a `Z`): each sample is
 * shifted into the local frame by `offsetMinutes` exactly like heart rate.
 */
function normaliseSpO2(data: FitbitSpO2Intraday, offsetMinutes: number): WearableSample[] {
  const base = localIsoToWallClockEpoch(data.sleepStartTime);
  if (Number.isNaN(base)) return [];
  return data.samples.map((s) => ({
    timestampMs: applyOffset(base + s.minuteOffset * 60_000, offsetMinutes),
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
 *
 * `offsetMinutes` is the resolved per-night UTC→local offset for the record's own
 * date; it is applied ONLY to the two UTC-sourced lanes (heart rate, SpO₂). The
 * three local lanes ignore it (they are already local wall-clock).
 */
function normalise(
  dataType: FitbitTimeseriesType,
  data: unknown,
  offsetMinutes: number,
): WearableSample[] | null {
  switch (dataType) {
    case 'heart_rate_intraday':
      return normaliseHeartRate(data as FitbitHeartRateIntraday, offsetMinutes);
    case 'spo2_intraday':
      return normaliseSpO2(data as FitbitSpO2Intraday, offsetMinutes);
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

/**
 * Sort `rawSamples` ascending, de-duplicate by `timestampMs`, and derive the
 * series bounds. De-duplication is defensive: the disjoint split-by-date storage
 * means a sample cannot legitimately appear in two of the merged date records,
 * but identical timestamps would otherwise produce overlapping points.
 */
function buildSeries(
  dataType: WearableIntradayType,
  date: string,
  rawSamples: WearableSample[],
): WearableSeries {
  const sorted = rawSamples.slice().sort((a, b) => a.timestampMs - b.timestampMs);
  const samples: WearableSample[] = [];
  let lastTs = Number.NaN;
  for (const s of sorted) {
    if (s.timestampMs === lastTs) continue;
    samples.push(s);
    lastTs = s.timestampMs;
  }
  const startMs = samples.length > 0 ? (samples[0]?.timestampMs ?? null) : null;
  const endMs = samples.length > 0 ? (samples[samples.length - 1]?.timestampMs ?? null) : null;
  return { dataType, date, samples, startMs, endMs };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetch and normalise intraday wearable series for a session anchored on a
 * calendar date.
 *
 * Intraday samples are stored split by the calendar date of each sample's own
 * timestamp, so a session crossing midnight straddles two date-keyed records.
 * To avoid silently truncating one side of midnight, this loads the anchor
 * `date` **and** its immediate neighbours (`date ± 1`) for every requested type,
 * then merges, de-duplicates, and sorts the normalised samples (see
 * {@link neighbourDates}). One record per (source, dataType, date) is stored, so
 * this issues `dataTypes.length × 3` O(1) keyed lookups, parallelised. Missing
 * neighbour records are normal and simply contribute nothing.
 *
 * The off-window tail of a neighbour day is harmless to the viewer: the renderer
 * drops samples outside the session viewport, and {@link WearableSeries.date}
 * remains the anchor date. When `date` is `null` or `dataTypes` is empty, no
 * query runs and an empty result is returned.
 *
 * @param date       - Anchor calendar date (YYYY-MM-DD), or `null` to skip.
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

  // Shared per-date UTC→local offset table for the two UTC lanes (HR, SpO₂).
  // Every consumer of these lanes reads the same table, so the lanes never
  // diverge. Local lanes ignore it. Re-running when the table changes is safe:
  // the offsets are near-constant, so this re-fetch is rare (import or first load).
  const { table: offsetTable } = useWearableOffsets(source);

  // Stable dependency key so identical requests don't re-fetch.
  const typesKey = dataTypes.slice().sort().join(',');

  useEffect(() => {
    if (date === null || typesKey === '') {
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
    // Anchor + adjacent dates: covers sessions straddling midnight either way.
    const dates = neighbourDates(date);

    void (async () => {
      try {
        const db = await getDB();

        // One keyed lookup per (type, date) — flattened so a single Promise.all
        // parallelises them all. Indexed as records[typeIndex * dates.length + d].
        const records = await Promise.all(
          types.flatMap((dt) => dates.map((d) => db.getIntegrationTimeseriesByKey(source, dt, d))),
        );

        // Discard if a newer request superseded this one.
        if (requestId !== requestIdRef.current) return;

        const next: Partial<Record<WearableIntradayType, WearableSeries>> = {};
        for (let i = 0; i < types.length; i++) {
          const dt = types[i];
          if (!dt) continue;

          // Merge every neighbour record's normalised samples for this type.
          const merged: WearableSample[] = [];
          let hadRecord = false;
          for (let d = 0; d < dates.length; d++) {
            const record = records[i * dates.length + d];
            if (!record) continue; // Missing neighbour date — normal.
            // Offset is keyed on the record's OWN date (a cross-midnight night
            // maps its evening tail and morning bulk to their own dates' offsets;
            // within a night these are equal barring a DST boundary).
            const offsetMinutes = offsetForDate(offsetTable, record.date);
            const samples = normalise(record.dataType, record.data, offsetMinutes);
            if (!samples) continue;
            hadRecord = true;
            for (const s of samples) merged.push(s);
          }

          // Omit types with no stored record on any of the dates (preserves the
          // existing "absent, not empty" return contract).
          if (!hadRecord) continue;

          next[dt] = buildSeries(dt, date, merged);
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
  }, [date, typesKey, source, offsetTable]);

  return { series, loading, error };
}
