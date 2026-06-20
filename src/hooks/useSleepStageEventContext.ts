/**
 * Data hook: load the wearable sleep-stage context (hypnogram + optional
 * intraday heart rate) overlapping the active date range, normalised into the
 * pure shapes the {@link module:analysis/sleepStages} module consumes.
 *
 * The "Sleep stages & cycles" lens of the Event Explorer tags device events by
 * the sleep stage active at their marker time, derives NREM–REM cycles, and (in
 * its autonomic sub-view) builds event-triggered heart-rate profiles. All of
 * that analysis is PURE and lives in `@/analysis/sleepStages`; this hook is the
 * IO boundary that reads the stored Fitbit/Google-Health timeseries and shapes
 * it into {@link StageSegment} / {@link HrSample} arrays.
 *
 * ## Time base
 *
 * Wearable timestamps are local wall-clock with no timezone. We interpret them
 * as wall-clock-as-UTC (see {@link localIsoToWallClockEpoch}) so segment/sample
 * times are directly comparable to {@link Event.timestamp}, exactly as
 * {@link useWearableLanes} does for the per-session signal viewer.
 *
 * ## Date widening
 *
 * Intraday wearable records are stored split by the calendar date of each
 * record. A night straddles midnight, so we widen the active range by one day on
 * each side before querying (mirroring the `neighbourDates` idea in
 * {@link useWearableLanes}) to avoid truncating a night that began the evening
 * before the range start or ended the morning after the range end.
 *
 * Follows the useState + useEffect pattern with a monotonic `requestId` ref used
 * across the data hooks (see {@link useExplorerEvents}, {@link useWearableLanes}):
 * a stale slow request can never overwrite a fresher result, and an in-flight
 * request is cancelled on unmount / dependency change.
 *
 * @module hooks/useSleepStageEventContext
 */

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { getDB } from '@/services/storage/getDB';
import { localIsoToWallClockEpoch } from '@/utils/wallClock';
import { formatDate } from '@/utils/formatDate';
import type { HrSample, StageSegment } from '@/analysis/sleepStages';
import type { FitbitHeartRateIntraday, FitbitSleepStages } from '@/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One wearable night: its hypnogram segments and overall recorded window. */
export interface SleepNight {
  /** Calendar date (YYYY-MM-DD) of the stored sleep_stages record. */
  readonly date: string;
  /** Stage segments for this night, sorted ascending by `startMs`. */
  readonly segments: readonly StageSegment[];
  /** Earliest segment start (epoch ms, wall-clock-as-UTC). */
  readonly startMs: number;
  /** Latest segment end (epoch ms, wall-clock-as-UTC). */
  readonly endMs: number;
}

/** Result of {@link useSleepStageEventContext}. */
export interface SleepStageContextState {
  /** One entry per sleep_stages record, sorted ascending by `startMs`. */
  readonly nights: readonly SleepNight[];
  /** Concatenation of every night's segments, sorted ascending by `startMs`. */
  readonly allSegments: readonly StageSegment[];
  /** Intraday HR samples, sorted ascending by `timestampMs`; `[]` when `!includeHr`. */
  readonly hrSamples: readonly HrSample[];
  /** True when at least one usable stage segment was loaded. */
  readonly hasStageData: boolean;
  /** True when at least one VALID (finite) HR sample survived filtering. */
  readonly hasHrData: boolean;
  /**
   * True when the active range spans more intraday-HR nights than
   * {@link MAX_HR_NIGHTS}, so HR was deliberately NOT loaded (`hrSamples` is `[]`
   * and `hasHrData` is `false`). Distinct from "no HR data": the data exists but
   * the range is too wide to load on the main thread without partial truncation,
   * which would bias the event-triggered average. The UI prompts the user to
   * narrow the range rather than showing a misleading result.
   */
  readonly hrRangeTooLarge: boolean;
  /** True while a fetch is in flight. */
  readonly loading: boolean;
  /** Error message if the fetch failed, else `null`. */
  readonly error: string | null;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * Maximum number of intraday-HR night records to flatten/sort on the main
 * thread. Each night holds ~17k samples; flattening + sorting a multi-year range
 * would build millions of objects and block the UI. Beyond this bound we refuse
 * to load HR entirely (rather than partially) because truncating to the first N
 * nights would bias the event-triggered heart-rate average toward those nights.
 */
const MAX_HR_NIGHTS = 60;

/**
 * Shift a `YYYY-MM-DD` string by `deltaDays` whole days using {@link Date.UTC},
 * keeping the arithmetic timezone-independent and DST-safe (matching the
 * wall-clock-as-UTC convention). Returns the input unchanged if it is not a
 * well-formed date string.
 */
function shiftDate(date: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d)) + deltaDays * DAY_MS;
  const dt = new Date(ms);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Record → pure-shape builders
// ---------------------------------------------------------------------------

/**
 * Convert one stored sleep_stages record (one night) into a {@link SleepNight}.
 * Transitions whose timestamp fails to parse (NaN) are skipped. Returns `null`
 * when no segment survives, so an empty/garbage record contributes nothing.
 */
function buildNight(date: string, data: FitbitSleepStages): SleepNight | null {
  const segments: StageSegment[] = [];
  for (const t of data.transitions) {
    const startMs = localIsoToWallClockEpoch(t.timestamp);
    if (Number.isNaN(startMs)) continue;
    const endMs = startMs + t.durationSeconds * 1000;
    if (!(endMs > startMs)) continue; // reject zero/negative-length segments
    segments.push({ stage: t.stage, startMs, endMs });
  }
  if (segments.length === 0) return null;

  segments.sort((a, b) => a.startMs - b.startMs);
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const s of segments) {
    if (s.startMs < startMs) startMs = s.startMs;
    if (s.endMs > endMs) endMs = s.endMs;
  }
  return { date, segments, startMs, endMs };
}

/**
 * Convert one stored heart_rate_intraday record into absolute-time HR samples.
 * Samples whose computed `timestampMs` or `bpm` is not finite are dropped (a
 * garbage/NaN sample must not silently bias the event-triggered average),
 * mirroring the defensive parsing in {@link buildNight}. `confidence` is kept
 * only when finite, else omitted.
 */
function buildHrSamples(data: FitbitHeartRateIntraday): HrSample[] {
  const baseTimestampMs = data.baseTimestampMs;
  const out: HrSample[] = [];
  for (const s of data.samples) {
    const timestampMs = baseTimestampMs + s.offsetSec * 1000;
    const bpm = s.bpm;
    if (!Number.isFinite(timestampMs) || !Number.isFinite(bpm)) continue;
    out.push(
      Number.isFinite(s.confidence)
        ? { timestampMs, bpm, confidence: s.confidence }
        : { timestampMs, bpm },
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const EMPTY: SleepStageContextState = {
  nights: [],
  allSegments: [],
  hrSamples: [],
  hasStageData: false,
  hasHrData: false,
  hrRangeTooLarge: false,
  loading: false,
  error: null,
};

/**
 * Load the wearable sleep-stage context overlapping the global date range.
 *
 * @param includeHr - When true, also loads intraday heart rate (for the
 *   autonomic sub-view). When false, `hrSamples` is `[]` and the HR query is
 *   skipped entirely — so the autonomic data is only fetched when its tab is
 *   active, keeping the common stage path light.
 * @returns Normalised nights, pooled segments, optional HR samples, and
 *   loading/error/availability flags.
 */
export function useSleepStageEventContext(includeHr: boolean): SleepStageContextState {
  const dateRange = useAppStore((s) => s.dateRange);
  const [state, setState] = useState<SleepStageContextState>({ ...EMPTY, loading: true });
  const requestIdRef = useRef(0);

  const startStr = formatDate(dateRange.start);
  const endStr = formatDate(dateRange.end);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    // Widen ±1 day: a night can straddle midnight either side of the range.
    const queryStart = shiftDate(startStr, -1);
    const queryEnd = shiftDate(endStr, 1);

    void (async () => {
      try {
        const db = await getDB();
        const records = await db.getIntegrationTimeseriesByDateRange(queryStart, queryEnd);
        if (cancelled || requestId !== requestIdRef.current) return;

        const nights: SleepNight[] = [];
        // Collect HR records first so we can bound their total before flattening.
        const hrRecords: FitbitHeartRateIntraday[] = [];

        for (const record of records) {
          if (record.source !== 'fitbit') continue;

          if (record.dataType === 'sleep_stages') {
            const night = buildNight(record.date, record.data as FitbitSleepStages);
            if (night) nights.push(night);
          } else if (includeHr && record.dataType === 'heart_rate_intraday') {
            hrRecords.push(record.data as FitbitHeartRateIntraday);
          }
        }

        nights.sort((a, b) => a.startMs - b.startMs);
        const allSegments: StageSegment[] = [];
        for (const night of nights) {
          for (const seg of night.segments) allSegments.push(seg);
        }
        allSegments.sort((a, b) => a.startMs - b.startMs);

        // Bound HR loading: a multi-year range holds millions of samples whose
        // flatten+sort would block the main thread. Refuse to load (rather than
        // truncate, which would bias the event-triggered average) when too wide.
        const hrSamples: HrSample[] = [];
        let hasHrData = false;
        let hrRangeTooLarge = false;
        if (hrRecords.length > MAX_HR_NIGHTS) {
          hrRangeTooLarge = true;
        } else {
          for (const data of hrRecords) {
            for (const sample of buildHrSamples(data)) hrSamples.push(sample);
          }
          hrSamples.sort((a, b) => a.timestampMs - b.timestampMs);
          // Derive availability AFTER filtering: a record full of NaN samples
          // must report hasHrData=false, matching what the autonomic view shows.
          hasHrData = hrSamples.length > 0;
        }

        if (cancelled || requestId !== requestIdRef.current) return;
        setState({
          nights,
          allSegments,
          hrSamples,
          hasStageData: allSegments.length > 0,
          hasHrData,
          hrRangeTooLarge,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled || requestId !== requestIdRef.current) return;
        setState({
          ...EMPTY,
          error: err instanceof Error ? err.message : 'Failed to load sleep-stage context',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [startStr, endStr, includeHr]);

  return state;
}
