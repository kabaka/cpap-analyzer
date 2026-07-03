/**
 * Per-night local UTC-offset estimation for UTC-sourced wearable lanes.
 *
 * ## Why this module exists
 *
 * CPAP session timestamps are the machine's LOCAL wall-clock time and the app
 * renders everything in a "wall-clock-as-UTC" frame (a local calendar/clock is
 * fed literally to {@link Date.UTC}; see `src/utils/wallClock.ts`). Most wearable
 * intraday lanes (HRV, sleep stages, snoring) are ALSO exported in local
 * wall-clock and align for free under that convention. Two lanes do not:
 * `heart_rate_intraday` and `spo2_intraday` are exported in **UTC**, so under the
 * wall-clock-as-UTC convention their samples land at their UTC clock face — a
 * 1:00 AM PDT event shows at 8:00 AM. They must be shifted back to local time.
 *
 * The shift is a per-night signed UTC offset. Rather than ask the user to
 * annotate a timezone, this module derives the offset automatically from data,
 * treating the overlapping CPAP session as local-time ground truth: a CPAP
 * session happens during sleep, and the wearable's sleep signal (once shifted by
 * the correct offset) must line up with it.
 *
 * ## Sign convention (documented, load-bearing)
 *
 * `tzOffsetMinutes` is the STANDARD signed UTC offset of the local zone: minutes
 * to ADD to a UTC clock to obtain the local clock. Zones west of Greenwich are
 * negative (America/Los_Angeles PDT = −420, PST = −480); zones east are positive
 * (Europe/Berlin CEST = +120). The reconstruction of a true local epoch from a
 * UTC-wall-clock-as-UTC epoch is therefore:
 *
 * ```
 * localEpoch = utcWallClockEpoch + tzOffsetMinutes * 60_000
 * ```
 *
 * (09:00Z + (−420 min) = 02:00 local — the PDT sleep block collapses onto the
 * CPAP 02:00 session start.) See {@link applyOffset}.
 *
 * ## Determinism & timezone-independence
 *
 * Every function here is pure and deterministic. No `Date.now()`, no
 * `new Date(string)` on a timezone-less string, no reliance on the process
 * timezone. All epoch inputs are already in a fixed frame; date-string
 * arithmetic uses {@link Date.UTC} only. Tests therefore pass in any `TZ`.
 *
 * This module is intentionally decoupled from storage, hooks, React, and DOM:
 * the caller converts `Session.startTime/endTime` to LOCAL-frame epochs (via
 * `sessionWallClockEpoch`) and supplies raw wearable samples; the wiring
 * specialist plugs the resulting offset table into the retrieval hook.
 *
 * @module analysis/crossSource/wearableTimezone
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_MINUTE = 60_000;

/** Real-world civil offsets are multiples of 15 minutes; snap to that grid. */
const SNAP_STEP_MINUTES = 15;

/**
 * Max gap (ms) between two consecutive samples for them to count as part of the
 * same dense run when locating a robust sleep-onset/wake edge. 15 min tolerates
 * ordinary intraday cadence (1–5 min) and short gaps, while isolating a truly
 * detached stray sample.
 */
const DENSE_RUN_MS = 15 * 60_000;

/**
 * Plausible band for a civil UTC offset, in minutes. Bounds the search and lets
 * us reject nonsense alignments. −12:00 … +14:00 covers every IANA zone.
 */
const MIN_OFFSET_MINUTES = -12 * 60;
const MAX_OFFSET_MINUTES = 14 * 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A CPAP session reduced to a LOCAL-frame window. `startMs`/`endMs` are
 * `sessionWallClockEpoch`-style epochs (local wall-clock fed to {@link Date.UTC}
 * by the CALLER). The caller must convert `Session.startTime/endTime`; this
 * module never imports the Session type or the DB.
 */
export interface LocalSessionWindow {
  /** Local-frame epoch ms of session start. */
  readonly startMs: number;
  /** Local-frame epoch ms of session end. */
  readonly endMs: number;
}

/**
 * A single wearable sample in the UTC-wall-clock-as-UTC frame (i.e. the raw
 * value produced today by the retrieval layer for a UTC-sourced lane).
 */
export interface UtcWearableSample {
  /** UTC-wall-clock-as-UTC epoch ms. */
  readonly timestampMs: number;
  /**
   * Optional lane value (bpm for HR). Used only to locate the low-HR sleep
   * trough when {@link WearableNight.sleepOnly} is false. Ignored otherwise.
   */
  readonly value?: number;
}

/**
 * One wearable night's samples for a single lane, plus the calendar date the
 * record is keyed under.
 */
export interface WearableNight {
  /** Calendar date (YYYY-MM-DD) the wearable record is keyed under. */
  readonly date: string;
  /** The lane's samples in the UTC-wall-clock-as-UTC frame. */
  readonly samples: readonly UtcWearableSample[];
  /**
   * True when the lane is inherently sleep-only (SpO₂ minute data, HRV detail):
   * every sample already lies within the sleep window, so the full sample span
   * IS the sleep feature — no trough search is needed. False (default) for
   * 24/7 heart rate, where a low-HR trough must be extracted first.
   */
  readonly sleepOnly?: boolean;
}

/** A per-night raw estimate: the snapped offset (or null) tagged with its date. */
export interface NightOffsetEstimate {
  readonly date: string;
  /** Snapped offset in minutes, or null when the night was indeterminable. */
  readonly offsetMinutes: number | null;
}

/**
 * Fallback seed: given a date, return a signed offset in minutes (same
 * convention) or null. Left as a typed hook for the wiring specialist to plug in
 * the IANA zone parsed from `Profile.csv`. This module does NOT parse IANA data;
 * the fallback is only consulted when the CPAP-overlap path yields nothing.
 */
export type FallbackOffsetForDate = (date: string) => number | null;

/** Tunables for the estimator. Defaults match the verified real export. */
export interface OffsetEstimatorOptions {
  /**
   * Half-width (in nights) of the smoothing window used by
   * {@link buildOffsetTable}. A window of `±smoothingRadius` nights votes on
   * each night's stabilised value. Default 3 (a 7-night window) — long enough to
   * kill single-night noise, short enough to let a real DST/travel step through.
   */
  readonly smoothingRadius?: number;
  /**
   * Minimum fraction of the CPAP window that the shifted wearable sleep feature
   * must cover for a night estimate to be trusted. Guards against aligning a
   * sliver of data. Default 0.5.
   */
  readonly minFeatureCoverage?: number;
}

// ---------------------------------------------------------------------------
// Public: offset application (sign convention lives here)
// ---------------------------------------------------------------------------

/**
 * Convert a UTC-wall-clock-as-UTC epoch to a true LOCAL-frame epoch by applying
 * a signed offset.
 *
 * `localEpoch = utcWallClockEpoch + offsetMinutes * 60_000`. With
 * `offsetMinutes = −420` (PDT), 09:00Z maps to 02:00 local. See the module
 * docstring for the full sign convention.
 *
 * @param utcWallClockEpoch - Sample epoch in the UTC-wall-clock-as-UTC frame.
 * @param offsetMinutes     - Signed civil UTC offset in minutes.
 * @returns The local-frame epoch ms.
 */
export function applyOffset(utcWallClockEpoch: number, offsetMinutes: number): number {
  return utcWallClockEpoch + offsetMinutes * MS_PER_MINUTE;
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

/**
 * Snap a raw (possibly noisy) offset in minutes to the nearest
 * {@link SNAP_STEP_MINUTES}-minute civil-offset grid point, with ties rounding
 * toward +∞ (deterministic). E.g. −418 → −420, −451 → −450 (UTC−7:30).
 */
export function snapOffsetMinutes(rawMinutes: number): number {
  return Math.round(rawMinutes / SNAP_STEP_MINUTES) * SNAP_STEP_MINUTES;
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

/**
 * A wearable sleep-feature window in the UTC frame. `startMs`/`endMs` are the
 * (robust) sleep-onset and wake edges. The estimator anchors on `startMs` (sleep
 * onset — the sharpest, most reliable edge; see
 * {@link estimateNightOffsetMinutes}); the full span drives the coverage guard.
 */
interface FeatureWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/** Ascending-sorted copy of a sample list by timestamp. */
function sortedByTime(samples: readonly UtcWearableSample[]): UtcWearableSample[] {
  return samples.slice().sort((a, b) => a.timestampMs - b.timestampMs);
}

/**
 * Extract the wearable "sleep feature" window in the UTC frame.
 *
 * - **Sleep-only lanes** (SpO₂ / HRV): the samples already cover only the sleep
 *   period, so the feature IS the sample span. The onset edge (`startMs`) is a
 *   robust near-minimum — the 2nd-percentile timestamp — so a single stray early
 *   sample cannot drag it; the wake edge (`endMs`) is the 98th percentile,
 *   symmetric. These bracket the true sleep span tightly.
 * - **24/7 lanes** (heart rate): sleep must be discriminated from wake. We slide
 *   a window of the CPAP session's duration across the night and pick the
 *   placement whose mean HR is lowest — the nocturnal HR trough. This solves the
 *   "24/7 coverage is non-discriminating" problem: raw coverage spans the whole
 *   day and cannot fix the offset, but the low-HR trough marks actual sleep and
 *   aligns to the CPAP window.
 *
 * @returns The feature window, or null if there is too little data.
 */
function extractSleepFeature(night: WearableNight, cpapDurationMs: number): FeatureWindow | null {
  const samples = sortedByTime(night.samples).filter((s) => Number.isFinite(s.timestampMs));
  if (samples.length < 2) return null;

  const times = samples.map((s) => s.timestampMs);

  if (night.sleepOnly) {
    // Robust onset/wake edges: the start of the first dense run and the end of
    // the last dense run. This equals the true min/max for clean dense data (no
    // percentile shrinkage) but discards a single isolated stray sample at
    // either extreme (one with no companion within DENSE_RUN_MS).
    const lo = robustEdge(times, 'onset');
    const hi = robustEdge(times, 'wake');
    return { startMs: lo, endMs: hi };
  }

  // 24/7 lane: find the low-HR trough window of width ~cpapDurationMs.
  const withValue = samples.filter((s) => Number.isFinite(s.value));
  if (withValue.length < 2) {
    // No usable values to discriminate sleep; fall back to full span, which is
    // non-discriminating and will typically be rejected by coverage checks.
    return { startMs: times[0] ?? 0, endMs: times[times.length - 1] ?? 0 };
  }

  return lowestMeanWindow(withValue, cpapDurationMs);
}

/**
 * Slide a window of `widthMs` across `samples` (sorted, value-bearing) and
 * return the placement whose mean value is lowest. Uses each sample as a
 * candidate window start (a two-pointer sweep), which is exact for the discrete
 * sample set and O(n). Returns null if no window contains ≥2 samples.
 */
function lowestMeanWindow(
  samples: readonly UtcWearableSample[],
  widthMs: number,
): FeatureWindow | null {
  const n = samples.length;
  if (n < 2 || widthMs <= 0) return null;

  // Read into flat parallel arrays so the sweep never re-indexes the object list
  // (and to keep the numeric maths free of optional/undefined access).
  const t = new Float64Array(n);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    if (s === undefined) return null;
    t[i] = s.timestampMs;
    v[i] = Number(s.value);
  }

  let best: { mean: number; startMs: number; endMs: number } | null = null;
  let hi = 0;
  let sum = 0;
  let count = 0;

  for (let lo = 0; lo < n; lo++) {
    if (lo > 0) {
      // Remove the sample leaving the window on the left.
      sum -= v[lo - 1] ?? 0;
      count -= 1;
      if (hi < lo) {
        hi = lo;
        sum = 0;
        count = 0;
      }
    }
    const windowEnd = (t[lo] ?? 0) + widthMs;
    while (hi < n && (t[hi] ?? 0) <= windowEnd) {
      sum += v[hi] ?? 0;
      count += 1;
      hi += 1;
    }
    if (count >= 2) {
      const mean = sum / count;
      const startMs = t[lo] ?? 0;
      const endMs = t[hi - 1] ?? 0;
      if (
        best === null ||
        mean < best.mean ||
        // Deterministic tie-break: prefer the earlier window.
        (mean === best.mean && startMs < best.startMs)
      ) {
        best = { mean, startMs, endMs };
      }
    }
  }

  if (best === null) return null;
  return { startMs: best.startMs, endMs: best.endMs };
}

/**
 * Robust sleep-onset or wake edge of an ascending `times` array.
 *
 * - `'onset'`: the earliest timestamp with a companion within
 *   {@link DENSE_RUN_MS} after it — the start of the first dense run.
 * - `'wake'`: the latest timestamp with a companion within {@link DENSE_RUN_MS}
 *   before it — the end of the last dense run.
 *
 * For clean dense data these equal the true min / max (no shrinkage); a single
 * isolated stray sample at either extreme is skipped. Falls back to the array
 * extreme when no dense run exists (very sparse night). Returns 0 for an empty
 * array (callers guard against that upstream).
 */
function robustEdge(times: readonly number[], edge: 'onset' | 'wake'): number {
  const n = times.length;
  if (n === 0) return 0;
  if (edge === 'onset') {
    for (let i = 0; i < n - 1; i++) {
      const a = times[i];
      const b = times[i + 1];
      if (a !== undefined && b !== undefined && b - a <= DENSE_RUN_MS) return a;
    }
    return times[0] ?? 0;
  }
  for (let i = n - 1; i > 0; i--) {
    const a = times[i - 1];
    const b = times[i];
    if (a !== undefined && b !== undefined && b - a <= DENSE_RUN_MS) return b;
  }
  return times[n - 1] ?? 0;
}

// ---------------------------------------------------------------------------
// Public: per-night estimation
// ---------------------------------------------------------------------------

/**
 * Estimate a single night's signed UTC offset (minutes) by aligning the
 * wearable sleep feature to the overlapping CPAP session, snapped to the 15-min
 * civil-offset grid. Returns null when indeterminable.
 *
 * ## Method
 *
 * 1. Merge the supplied CPAP session windows into the enclosing sleep span
 *    `[cpapStart, cpapEnd]` (the LOCAL-frame ground truth for this night). If no
 *    session is supplied, return null — this night has no local anchor.
 * 2. Extract the wearable sleep feature window in the UTC frame
 *    (see {@link extractSleepFeature}): a robust onset/wake span for sleep-only
 *    lanes, or the low-HR trough for 24/7 heart rate.
 * 3. The raw offset aligns the feature's SLEEP-ONSET edge to the CPAP session
 *    start: `raw = cpapStart − featureStart` (ms → minutes). Adding this to a UTC
 *    sample moves it into the local frame. Onset is chosen over the wake edge or
 *    the center because mask-on / sleep-onset is the sharpest shared anchor:
 *    people lie awake before rising and remove the mask early, blurring the wake
 *    edge and the midpoint, whereas onset is crisp. When the feature and CPAP
 *    window are equal-width (the 24/7 trough is forced to the CPAP duration),
 *    onset-, center-, and wake-alignment coincide.
 * 4. Reject if the raw offset is outside the plausible civil band, or if after
 *    applying it the feature covers less than `minFeatureCoverage` of the CPAP
 *    window (guards against aligning a sliver).
 * 5. Snap to the nearest 15 minutes and return.
 *
 * ## Failure modes / assumptions
 *
 * - Assumes the wearable sleep feature and the CPAP session describe the SAME
 *   physical sleep. A daytime nap on the wearable with no CPAP session, or vice
 *   versa, is not this function's concern (it looks only at the passed session).
 * - For 24/7 HR, assumes a genuine nocturnal HR trough exists. A flat HR trace
 *   (illness, artifact) produces a weak trough; the coverage guard and, above
 *   all, the cross-night stabilisation in {@link buildOffsetTable} absorb the
 *   resulting single-night noise.
 * - Onset-edge alignment tolerates the feature and CPAP window differing in
 *   LENGTH (a person may nod off before or after mask-on); snapping to 15 min
 *   then removes residual sub-quarter-hour error. It cannot recover an offset
 *   whose true value is not a 15-min multiple (none exist civilly), nor a night
 *   where onset is displaced from mask-on by more than ~7.5 min AND the residual
 *   pushes across a snap boundary — again absorbed by cross-night stabilisation.
 */
export function estimateNightOffsetMinutes(
  sessions: readonly LocalSessionWindow[],
  wearableNight: WearableNight,
  options: OffsetEstimatorOptions = {},
): number | null {
  const minCoverage = options.minFeatureCoverage ?? 0.5;

  const cpap = mergeSessions(sessions);
  if (cpap === null) return null;
  const cpapDurationMs = cpap.endMs - cpap.startMs;
  if (cpapDurationMs <= 0) return null;

  const feature = extractSleepFeature(wearableNight, cpapDurationMs);
  if (feature === null) return null;

  // Align the sleep-onset edges (see method note above).
  const rawOffsetMs = cpap.startMs - feature.startMs;
  const rawOffsetMinutes = rawOffsetMs / MS_PER_MINUTE;

  if (rawOffsetMinutes < MIN_OFFSET_MINUTES || rawOffsetMinutes > MAX_OFFSET_MINUTES) {
    return null;
  }

  // Coverage guard: after shifting the feature into the local frame, how much of
  // the CPAP window does it overlap?
  const shiftedStart = feature.startMs + rawOffsetMs;
  const shiftedEnd = feature.endMs + rawOffsetMs;
  const overlap = Math.min(shiftedEnd, cpap.endMs) - Math.max(shiftedStart, cpap.startMs);
  const coverage = overlap / cpapDurationMs;
  if (coverage < minCoverage) return null;

  return snapOffsetMinutes(rawOffsetMinutes);
}

/** Merge session windows into the enclosing span, or null if none/invalid. */
function mergeSessions(
  sessions: readonly LocalSessionWindow[],
): { startMs: number; endMs: number } | null {
  let start = Infinity;
  let end = -Infinity;
  for (const s of sessions) {
    if (!Number.isFinite(s.startMs) || !Number.isFinite(s.endMs)) continue;
    if (s.startMs < start) start = s.startMs;
    if (s.endMs > end) end = s.endMs;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { startMs: start, endMs: end };
}

// ---------------------------------------------------------------------------
// Public: cross-night stabilisation + table build
// ---------------------------------------------------------------------------

/**
 * Build a date → offset map from per-night raw estimates, applying robust
 * cross-night stabilisation and nearest-neighbour fill so EVERY requested date
 * resolves to an offset while genuine DST/travel step-changes are preserved.
 *
 * ## Algorithm
 *
 * 1. Sort the estimates by date (deterministic, `YYYY-MM-DD` lexicographic ==
 *    chronological).
 * 2. **Windowed mode smoothing.** For each night, take the snapped offsets of
 *    all nights within `±smoothingRadius` (default 3) that HAVE an estimate and
 *    pick the modal value (ties broken toward the value closest to the night's
 *    own estimate, then numerically). Because a real zone is near-constant, the
 *    mode robustly overrides a single noisy night. Because the window is narrow,
 *    a sustained step (DST/travel) flips the mode within a few nights of the
 *    boundary rather than smearing across the whole series.
 * 3. **Nearest-neighbour fill.** Any date with no estimate of its own (and no
 *    neighbour within the smoothing window) inherits the stabilised offset of
 *    the chronologically closest date that has one (ties → earlier date).
 * 4. **Fallback seed.** If, after all of the above, a date still has no value
 *    (e.g. the entire series was indeterminable), `fallbackOffsetForDate` is
 *    consulted. Dates it cannot resolve are omitted from the map.
 *
 * The step-change is preserved because smoothing votes only within a local
 * window: a night one day after a DST boundary sees mostly post-boundary nights
 * in its window and adopts the new offset.
 *
 * @param estimates            - Per-night raw estimates (any order).
 * @param options              - Smoothing radius, etc.
 * @param fallbackOffsetForDate - Optional last-resort seed (e.g. Profile IANA).
 * @returns A Map from date string to signed offset minutes.
 */
export function buildOffsetTable(
  estimates: readonly NightOffsetEstimate[],
  options: OffsetEstimatorOptions = {},
  fallbackOffsetForDate?: FallbackOffsetForDate,
): Map<string, number> {
  const radius = options.smoothingRadius ?? 3;

  // Deterministic order; de-duplicate dates keeping the first non-null estimate.
  const byDate = new Map<string, number | null>();
  for (const e of estimates) {
    const existing = byDate.get(e.date);
    if (existing === undefined || (existing === null && e.offsetMinutes !== null)) {
      byDate.set(e.date, e.offsetMinutes);
    }
  }
  const dates = Array.from(byDate.keys()).sort();
  const rawOffsets = dates.map((d) => byDate.get(d) ?? null);

  const result = new Map<string, number>();

  // Step 2: windowed mode smoothing over nights that have an estimate.
  const stabilised: (number | null)[] = dates.map((_, i) => {
    const own = rawOffsets[i] ?? null;
    const votes: number[] = [];
    for (let j = Math.max(0, i - radius); j <= Math.min(dates.length - 1, i + radius); j++) {
      const v = rawOffsets[j];
      if (v !== null && v !== undefined) votes.push(v);
    }
    if (votes.length === 0) return null;
    return modeWithTieBreak(votes, own);
  });

  // Step 3: nearest-neighbour fill for dates still null.
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    if (date === undefined) continue;
    let value: number | null = stabilised[i] ?? null;
    if (value === null) {
      value = nearestNonNull(stabilised, i);
    }
    if (value !== null) result.set(date, value);
  }

  // Step 4: fallback seed for any date left unresolved.
  if (fallbackOffsetForDate) {
    for (const d of dates) {
      if (!result.has(d)) {
        const fb = fallbackOffsetForDate(d);
        if (fb !== null) result.set(d, snapOffsetMinutes(fb));
      }
    }
  }

  return result;
}

/**
 * Modal value of `votes`. Ties are broken toward the value closest to `own`
 * (the night's own estimate), then toward the numerically smaller value — both
 * deterministic and TZ-independent.
 */
function modeWithTieBreak(votes: readonly number[], own: number | null): number {
  const counts = new Map<number, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);

  let bestValue = votes[0] ?? 0;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    } else if (count === bestCount) {
      if (own !== null) {
        const dNew = Math.abs(value - own);
        const dOld = Math.abs(bestValue - own);
        if (dNew < dOld || (dNew === dOld && value < bestValue)) bestValue = value;
      } else if (value < bestValue) {
        bestValue = value;
      }
    }
  }
  return bestValue;
}

/**
 * Nearest non-null value in `arr` to index `i`, searching outward. Ties (equal
 * distance on both sides) resolve to the EARLIER (lower-index) side for
 * determinism. Returns null if the array is entirely null.
 */
function nearestNonNull(arr: readonly (number | null)[], i: number): number | null {
  for (let d = 0; d < arr.length; d++) {
    const leftVal = arr[i - d];
    if (i - d >= 0 && leftVal !== null && leftVal !== undefined) return leftVal;
    const rightVal = arr[i + d];
    if (i + d < arr.length && rightVal !== null && rightVal !== undefined) return rightVal;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public: top-level convenience
// ---------------------------------------------------------------------------

/**
 * A wearable night together with the CPAP sessions that overlap it, ready for
 * end-to-end offset resolution. The caller is responsible for matching sessions
 * to nights (typically by calendar date ± 1) and for converting session times to
 * the LOCAL frame; this module stays storage-agnostic.
 */
export interface NightWithSessions {
  readonly night: WearableNight;
  /** CPAP sessions overlapping this night, in the LOCAL frame. May be empty. */
  readonly sessions: readonly LocalSessionWindow[];
}

/**
 * Resolve a per-date offset map end-to-end: estimate each night, then stabilise
 * and fill. Nights with no overlapping CPAP session contribute a null estimate
 * and are resolved by nearest-neighbour fill (or the fallback seed).
 *
 * This is the single entry point the wiring specialist calls after grouping
 * wearable records by night and attaching overlapping sessions.
 *
 * @param nights                - Wearable nights paired with overlapping sessions.
 * @param options               - Estimator + stabilisation tunables.
 * @param fallbackOffsetForDate - Optional last-resort seed (e.g. Profile IANA).
 * @returns date → signed offset minutes for every resolvable requested date.
 */
export function resolveOffsetTable(
  nights: readonly NightWithSessions[],
  options: OffsetEstimatorOptions = {},
  fallbackOffsetForDate?: FallbackOffsetForDate,
): Map<string, number> {
  const estimates: NightOffsetEstimate[] = nights.map(({ night, sessions }) => ({
    date: night.date,
    offsetMinutes: estimateNightOffsetMinutes(sessions, night, options),
  }));
  return buildOffsetTable(estimates, options, fallbackOffsetForDate);
}

// Re-export the snap grid for the wiring layer / tests that assert on it.
export { SNAP_STEP_MINUTES };
