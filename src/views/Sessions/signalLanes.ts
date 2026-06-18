/**
 * Pure helpers for building the Signal Viewer lane model from CPAP channels and
 * normalised wearable series. Kept free of React and DOM so the alignment maths
 * and channel construction can be unit-tested directly.
 *
 * ## Time alignment (critical)
 *
 * Wearable intraday samples carry `timestampMs` computed as `Date.UTC(...)` of
 * the literal **local wall-clock** of each reading (no timezone applied) — see
 * {@link module:hooks/useWearableLanes}. CPAP session timestamps, by contrast,
 * are produced by `new Date(year, month, …).toISOString()` in the importing
 * machine's local zone, so a session's `startTime` ISO string is the UTC
 * encoding of a *local* `Date`.
 *
 * To project both onto one shared, session-relative time axis we must reduce the
 * session start to the **same** wall-clock-as-UTC convention. We therefore read
 * the session start's *local* calendar fields (`getFullYear`, `getHours`, …) and
 * feed them back through `Date.UTC`. That yields the wall-clock-as-UTC epoch that
 * is directly comparable to every wearable `timestampMs`. Subtracting it gives a
 * session-relative offset in ms.
 *
 * Assumption: the viewer runs in the same timezone the data was imported in
 * (the same assumption the rest of the app already makes when it renders session
 * times with `new Date(session.startTime)`). This keeps alignment timezone-
 * independent for a given user/machine; cross-timezone viewing is out of scope.
 *
 * @module views/Sessions/signalLanes
 */

import type { RibbonBand, SignalChannel } from '@/components/charts/canvas/SignalRenderer';
import {
  SLEEP_STAGE_CODES,
  type WearableIntradayType,
  type WearableSeries,
} from '@/hooks/useWearableLanes';

// ---------------------------------------------------------------------------
// Lane model
// ---------------------------------------------------------------------------

/** Logical grouping for the lanes drawer + legend. */
export type LaneGroup = 'cpap' | 'wearable' | 'sleep';

/** Lane-kind pill shown on each header (also a non-colour redundancy cue). */
export type LaneKindPill = 'CPAP' | 'WEAR' | 'SLEEP';

/**
 * A lane descriptor: the persistent identity + presentation metadata for one row
 * in the stack. The actual sample data is attached at render time (it changes
 * with the viewport), so this stays cheap to keep in React state.
 */
export interface LaneDescriptor {
  /** Stable id, unique within a session (e.g. `cpap:Flow`, `wear:heart_rate_intraday`). */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** Physical unit (empty for the hypnogram). */
  readonly unit: string;
  /** Group for drawer/legend bucketing. */
  readonly group: LaneGroup;
  /** Pill label. */
  readonly pill: LaneKindPill;
  /** CSS var expression for the lane accent colour (resolved by the host). */
  readonly colorVar: string;
  /** Render style for the underlying SignalChannel. */
  readonly render: 'line' | 'step' | 'ribbon';
  /** Lane height CSS var token (resolved by the host). */
  readonly heightVar: string;
  /** Whether the lane has any data this session (drives auto-hide + drawer note). */
  readonly hasData: boolean;
}

/** Wearable lane catalogue: dataType → presentation. Order defines stack order. */
export const WEARABLE_LANE_SPECS: readonly {
  readonly dataType: WearableIntradayType;
  readonly name: string;
  readonly unit: string;
  readonly group: LaneGroup;
  readonly pill: LaneKindPill;
  readonly colorVar: string;
  readonly render: 'line' | 'step' | 'ribbon';
  readonly heightVar: string;
}[] = [
  {
    dataType: 'heart_rate_intraday',
    name: 'Heart Rate',
    unit: 'bpm',
    group: 'wearable',
    pill: 'WEAR',
    colorVar: 'var(--color-wearable-hr)',
    render: 'line',
    heightVar: '--signal-lane-height-hero',
  },
  {
    dataType: 'spo2_intraday',
    name: 'SpO₂ (wearable)',
    unit: '%',
    group: 'wearable',
    pill: 'WEAR',
    colorVar: 'var(--color-wearable-spo2)',
    render: 'line',
    heightVar: '--signal-lane-height',
  },
  {
    dataType: 'hrv_detail',
    name: 'HRV (RMSSD)',
    unit: 'ms',
    group: 'wearable',
    pill: 'WEAR',
    colorVar: 'var(--color-wearable-hrv)',
    render: 'step',
    heightVar: '--signal-lane-height',
  },
  {
    dataType: 'snoring_segments',
    name: 'Snoring',
    unit: 'dBA',
    group: 'wearable',
    pill: 'WEAR',
    colorVar: 'var(--color-wearable-snore)',
    render: 'line',
    heightVar: '--signal-lane-height',
  },
  {
    dataType: 'sleep_stages',
    name: 'Sleep Stages',
    unit: '',
    group: 'sleep',
    pill: 'SLEEP',
    colorVar: 'var(--color-hypno-light)',
    render: 'ribbon',
    heightVar: '--signal-lane-height-hypno',
  },
];

/** All wearable data types we request from the hook. */
export const WEARABLE_DATA_TYPES: readonly WearableIntradayType[] = WEARABLE_LANE_SPECS.map(
  (s) => s.dataType,
);

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

/**
 * Reduce a session start ISO timestamp to the wall-clock-as-UTC epoch used by
 * wearable samples. See the module docstring for why local getters are used.
 *
 * @param sessionStartIso - The session's `startTime` ISO 8601 string.
 * @returns Epoch ms in the wall-clock-as-UTC convention, or `NaN` if unparseable.
 */
export function sessionWallClockEpoch(sessionStartIso: string): number {
  const d = new Date(sessionStartIso);
  if (Number.isNaN(d.getTime())) return NaN;
  return Date.UTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  );
}

/**
 * Derive the calendar date (YYYY-MM-DD) to query the wearable hook with, from a
 * session start ISO string, using the same local-wall-clock interpretation.
 */
export function sessionDateKey(sessionStartIso: string): string | null {
  const d = new Date(sessionStartIso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Convert one wearable series to session-relative arrays.
 *
 * Returns parallel `values` and `times` (session-relative ms). Samples are kept
 * as-is (no resampling) since wearable cadences are low. Samples whose value is
 * non-finite are preserved as `NaN` so the renderer can break lines / show gaps.
 */
export function toSessionRelative(
  series: WearableSeries,
  wallClockEpoch: number,
): { values: Float32Array; times: Float64Array } {
  const n = series.samples.length;
  const values = new Float32Array(n);
  const times = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = series.samples[i];
    if (!s) {
      values[i] = NaN;
      times[i] = 0;
      continue;
    }
    values[i] = Number.isFinite(s.value) ? s.value : NaN;
    times[i] = s.timestampMs - wallClockEpoch;
  }
  return { values, times };
}

// ---------------------------------------------------------------------------
// Physical ranges
// ---------------------------------------------------------------------------

/**
 * Compute a [min, max] for a wearable lane: a sane per-type default range
 * **expanded only** to cover the data (never contracted below the default).
 *
 * This mirrors the CPAP hybrid-domain rule (see `signalDomain.computeLaneDomain`)
 * so wearable lanes scale consistently: clinically-anchored default floor, grown
 * outward by data, with ~10% padding applied only to the data-expanded edge(s).
 * SpO₂ pins its max at 100 and only expands downward.
 *
 * When `times` and `windowMs` are supplied, only samples whose session-relative
 * time falls within `[windowMs.start, windowMs.end]` drive the data-expanded edges.
 * The Signal Viewer merges neighbour-day wearable data (to avoid cross-midnight
 * line truncation), but those off-session-window tails — e.g. an adjacent day's
 * daytime/exercise heart rate — must NOT inflate the lane's range and compress
 * the actual nighttime waveform. The full series still feeds the rendered line;
 * only this range computation is clipped to the session window. When the window
 * args are omitted, behaviour is identical to scanning the whole `values` array.
 */
export function wearableRange(
  dataType: WearableIntradayType,
  values: Float32Array,
  times?: Float64Array,
  windowMs?: { start: number; end: number },
): { min: number; max: number } {
  // Hypnogram is categorical; its range is the ordinal stage span (fixed).
  if (dataType === 'sleep_stages') {
    return { min: SLEEP_STAGE_CODES.deep, max: SLEEP_STAGE_CODES.wake };
  }

  const def = DEFAULT_RANGES[dataType];
  const defMin = def[0];
  const defMax = def[1];
  // SpO₂ is a percentage: the max is physically pinned at 100 (downward-only).
  const pinMax = dataType === 'spo2_intraday';

  // Restrict the data-expanded scan to the session window when one is given.
  const clipToWindow = times !== undefined && windowMs !== undefined;

  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === undefined || Number.isNaN(v)) continue;
    if (clipToWindow) {
      const t = times[i];
      if (t === undefined || t < windowMs.start || t > windowMs.end) continue;
    }
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }

  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    // No data — fall back to type defaults so the lane still scales sensibly.
    return { min: defMin, max: defMax };
  }

  if (lo === hi) {
    // Flat series — keep the default floor and give it a little room, still
    // respecting the SpO₂ max pin.
    return { min: Math.min(defMin, lo - 1), max: pinMax ? defMax : Math.max(defMax, hi + 1) };
  }

  // Expand-only against the default floor.
  let outMin = Math.min(defMin, lo);
  let outMax = pinMax ? defMax : Math.max(defMax, hi);

  // Pad only the data-expanded edge(s) (~10%); leave anchored edges exact.
  const span = outMax - outMin;
  const pad = span * 0.1;
  if (lo < defMin) outMin -= pad;
  if (!pinMax && hi > defMax) outMax += pad;

  return { min: outMin, max: outMax };
}

const DEFAULT_RANGES: Record<WearableIntradayType, readonly [number, number]> = {
  heart_rate_intraday: [40, 120],
  spo2_intraday: [85, 100],
  hrv_detail: [0, 120],
  snoring_segments: [20, 80],
  sleep_stages: [SLEEP_STAGE_CODES.deep, SLEEP_STAGE_CODES.wake],
};

// ---------------------------------------------------------------------------
// Hypnogram bands
// ---------------------------------------------------------------------------

/**
 * Ribbon bands for the hypnogram, ordered top→bottom (Wake → REM → Light → Deep)
 * to match clinical convention. Colours are passed in already resolved.
 */
export function hypnogramBands(resolve: (cssVar: string) => string): RibbonBand[] {
  return [
    { value: SLEEP_STAGE_CODES.wake, label: 'W', color: resolve('--color-hypno-wake') },
    {
      value: SLEEP_STAGE_CODES.rem,
      label: 'REM',
      color: resolve('--color-hypno-rem'),
      hatch: true, // redundant non-colour cue for REM
    },
    { value: SLEEP_STAGE_CODES.light, label: 'N1–2', color: resolve('--color-hypno-light') },
    { value: SLEEP_STAGE_CODES.deep, label: 'N3', color: resolve('--color-hypno-deep') },
  ];
}

/** Human-readable stage name for a hypnogram ordinal value (for a11y readouts). */
export function sleepStageName(value: number): string {
  switch (value) {
    case SLEEP_STAGE_CODES.wake:
      return 'Wake';
    case SLEEP_STAGE_CODES.rem:
      return 'REM';
    case SLEEP_STAGE_CODES.light:
      return 'Light (N1–2)';
    case SLEEP_STAGE_CODES.deep:
      return 'Deep (N3)';
    default:
      return 'Unknown';
  }
}

// ---------------------------------------------------------------------------
// Channel construction
// ---------------------------------------------------------------------------

/**
 * Build a renderer {@link SignalChannel} for a wearable series, projected onto
 * session-relative time. `resolveColor` and `resolveHeight` let the caller inject
 * theme-resolved values (kept out of this pure module).
 *
 * `windowMs` (the session-relative session window, `[start, end]`) restricts the
 * lane's fixed y-axis range to in-window samples so merged neighbour-day tails do
 * not inflate it (see {@link wearableRange}). The full merged series is always
 * kept in `data`/`sampleTimes` so panning/line drawing still shows neighbour data
 * where it legitimately overlaps — only the range is window-aware. When `windowMs`
 * is omitted the range scans the whole series (back-compat).
 */
export function buildWearableChannel(
  spec: (typeof WEARABLE_LANE_SPECS)[number],
  series: WearableSeries,
  wallClockEpoch: number,
  resolveColor: (cssVar: string) => string,
  resolveHeight: (cssVar: string) => number,
  windowMs?: { start: number; end: number },
): SignalChannel {
  const { values, times } = toSessionRelative(series, wallClockEpoch);
  const { min, max } = wearableRange(spec.dataType, values, times, windowMs);

  // Effective sample rate is informational here (renderer uses sampleTimes for
  // positioning); approximate from coverage so it is non-zero.
  const spanMs =
    series.startMs !== null && series.endMs !== null ? series.endMs - series.startMs : 0;
  const sampleRate = spanMs > 0 && values.length > 1 ? (values.length / spanMs) * 1000 : 1;

  return {
    name: spec.name,
    data: values,
    sampleTimes: times,
    sampleRate,
    unit: spec.unit,
    color: resolveColor(spec.colorVar),
    physicalMin: min,
    physicalMax: max,
    kind: 'wearable',
    render: spec.render,
    sparse: spec.render === 'step',
    height: resolveHeight(spec.heightVar),
  };
}

/** True when a wearable series has at least one finite sample. */
export function seriesHasData(series: WearableSeries | undefined): boolean {
  if (!series || series.samples.length === 0) return false;
  return series.samples.some((s) => Number.isFinite(s.value));
}
