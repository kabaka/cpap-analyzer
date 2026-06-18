/**
 * Unit tests for the pure Signal Viewer lane-building helpers — most importantly
 * the wearable↔CPAP timestamp alignment, which is correctness-critical: a wrong
 * offset would silently misplace heart-rate spikes relative to apnea events.
 */

import { describe, it, expect } from 'vitest';

import { SLEEP_STAGE_CODES, type WearableSeries } from '@/hooks/useWearableLanes';

import {
  buildWearableChannel,
  hypnogramBands,
  seriesHasData,
  sessionDateKey,
  sessionWallClockEpoch,
  sleepStageName,
  toSessionRelative,
  wearableRange,
  WEARABLE_LANE_SPECS,
} from '../signalLanes';

/** Build a minimal WearableSeries fixture. */
function makeSeries(
  dataType: WearableSeries['dataType'],
  samples: { timestampMs: number; value: number; confidence?: number }[],
): WearableSeries {
  const sorted = samples.slice().sort((a, b) => a.timestampMs - b.timestampMs);
  return {
    dataType,
    date: '2026-01-15',
    samples: sorted,
    startMs: sorted.length ? (sorted[0]?.timestampMs ?? null) : null,
    endMs: sorted.length ? (sorted[sorted.length - 1]?.timestampMs ?? null) : null,
  };
}

describe('sessionWallClockEpoch', () => {
  it('reduces a session start to the wall-clock-as-UTC epoch matching wearable samples', () => {
    // EDF parsing builds the session start as a LOCAL Date, then toISOString().
    const localStart = new Date(2026, 0, 15, 22, 30, 0); // local 2026-01-15 22:30:00
    const iso = localStart.toISOString();

    // A wearable sample at the same wall-clock instant is Date.UTC of the literal
    // local components (no timezone shift) — this is the hook's convention.
    const wearableSample = Date.UTC(2026, 0, 15, 22, 30, 0);

    expect(sessionWallClockEpoch(iso)).toBe(wearableSample);
  });

  it('is timezone-independent for a fixed wall clock (same epoch regardless of host TZ math)', () => {
    // Constructing via local components then reducing must round-trip the wall
    // clock exactly, so two sessions one hour apart differ by exactly 3_600_000.
    const a = sessionWallClockEpoch(new Date(2026, 5, 1, 1, 0, 0).toISOString());
    const b = sessionWallClockEpoch(new Date(2026, 5, 1, 2, 0, 0).toISOString());
    expect(b - a).toBe(3_600_000);
  });

  it('returns NaN for unparseable input', () => {
    expect(Number.isNaN(sessionWallClockEpoch('not-a-date'))).toBe(true);
  });
});

describe('sessionDateKey', () => {
  it('derives the local calendar date from a session start', () => {
    const iso = new Date(2026, 2, 9, 23, 15, 0).toISOString(); // local 2026-03-09
    expect(sessionDateKey(iso)).toBe('2026-03-09');
  });

  it('returns null for unparseable input', () => {
    expect(sessionDateKey('garbage')).toBeNull();
  });
});

describe('toSessionRelative', () => {
  it('subtracts the wall-clock epoch to produce session-relative offsets', () => {
    const epoch = Date.UTC(2026, 0, 15, 22, 0, 0);
    const series = makeSeries('heart_rate_intraday', [
      { timestampMs: epoch, value: 60 },
      { timestampMs: epoch + 60_000, value: 64 },
      { timestampMs: epoch + 120_000, value: 70 },
    ]);

    const { values, times } = toSessionRelative(series, epoch);
    expect(Array.from(times)).toEqual([0, 60_000, 120_000]);
    expect(Array.from(values)).toEqual([60, 64, 70]);
  });

  it('preserves non-finite values as NaN so the renderer can show gaps', () => {
    const epoch = 0;
    const series = makeSeries('heart_rate_intraday', [
      { timestampMs: 0, value: 60 },
      { timestampMs: 1000, value: Number.POSITIVE_INFINITY },
    ]);
    const { values } = toSessionRelative(series, epoch);
    expect(values[0]).toBe(60);
    expect(Number.isNaN(values[1])).toBe(true);
  });

  it('aligns a post-midnight wearable sample correctly to a pre-midnight session start (date straddle)', () => {
    // Session starts the night of 2026-01-15 at 23:40 local. EDF builds the start
    // as a local Date then toISOString(); the alignment base is its wall-clock-as-
    // UTC epoch.
    const sessionStartIso = new Date(2026, 0, 15, 23, 40, 0).toISOString();
    const epoch = sessionWallClockEpoch(sessionStartIso);

    // Two wearable readings: one before midnight (23:50) and one after midnight
    // the next calendar day (00:10 on 2026-01-16). The hook encodes each as
    // Date.UTC of its literal local wall-clock components.
    const beforeMidnight = Date.UTC(2026, 0, 15, 23, 50, 0);
    const afterMidnight = Date.UTC(2026, 0, 16, 0, 10, 0);
    const series = makeSeries('heart_rate_intraday', [
      { timestampMs: beforeMidnight, value: 58 },
      { timestampMs: afterMidnight, value: 62 },
    ]);

    const { times, values } = toSessionRelative(series, epoch);

    // 23:50 is 10 minutes after the 23:40 start; 00:10 is 30 minutes after.
    // The session-relative offsets must increase monotonically across midnight —
    // no negative or wrapped offset for the post-midnight sample.
    expect(Array.from(times)).toEqual([10 * 60_000, 30 * 60_000]);
    expect(times[1]).toBeGreaterThan(times[0] ?? 0);
    expect(Array.from(values)).toEqual([58, 62]);
  });
});

describe('wearableRange', () => {
  it('returns the ordinal stage span for the hypnogram regardless of samples', () => {
    const r = wearableRange('sleep_stages', new Float32Array([SLEEP_STAGE_CODES.light]));
    expect(r.min).toBe(SLEEP_STAGE_CODES.deep);
    expect(r.max).toBe(SLEEP_STAGE_CODES.wake);
  });

  it('keeps the default floor when data fits inside it (expand-only)', () => {
    // HR default range is [40, 120]; data [50, 100] fits entirely inside, so the
    // domain stays anchored at the clinical default with no padding.
    const r = wearableRange('heart_rate_intraday', new Float32Array([50, 100]));
    expect(r.min).toBe(40);
    expect(r.max).toBe(120);
  });

  it('expands and pads only the edge the data pushes past the default', () => {
    // HR default [40, 120]; data max 140 exceeds it.
    // outMin = min(40, 50) = 40; outMax = max(120, 140) = 140.
    // span = 140 - 40 = 100; pad = span·0.1 = 10. Only hi > defMax (140 > 120) so
    // outMax += 10 → 150; lo (50) is NOT < defMin (40) so the floor stays exact.
    const r = wearableRange('heart_rate_intraday', new Float32Array([50, 140]));
    expect(r.min).toBe(40); // anchored low edge, no pad
    expect(r.max).toBe(150); // expanded + ~10% pad
    expect(r.max).toBeGreaterThan(140); // genuinely covers the data
  });

  it('expands the low edge with pad when data dips below the default floor', () => {
    // HR default [40, 120]; data [30, 100]. outMin = min(40, 30) = 30;
    // outMax = max(120, 100) = 120. span = 120 - 30 = 90; pad = 9.
    // lo (30) < defMin (40) → outMin -= 9 → 21. hi (100) NOT > defMax (120) → exact 120.
    const r = wearableRange('heart_rate_intraday', new Float32Array([30, 100]));
    expect(r.min).toBe(21);
    expect(r.max).toBe(120);
  });

  it('pads both edges when data exceeds the default on both sides', () => {
    // HRV default [0, 120]; data [-5, 150]. outMin = min(0, -5) = -5;
    // outMax = max(120, 150) = 150. span = 155; pad = 15.5.
    // lo (-5) < 0 → outMin -= 15.5 → -20.5. hi (150) > 120 → outMax += 15.5 → 165.5.
    const r = wearableRange('hrv_detail', new Float32Array([-5, 150]));
    expect(r.min).toBeCloseTo(-20.5, 10);
    expect(r.max).toBeCloseTo(165.5, 10);
  });

  it('pins SpO₂ max at 100 and only expands downward', () => {
    // SpO₂ default [85, 100]; data [78, 99]. pinMax → outMax stays 100.
    // outMin = min(85, 78) = 78. span = 100 - 78 = 22; pad = 2.2.
    // lo (78) < defMin (85) → outMin -= 2.2 → 75.8. hi pinned, no pad.
    const r = wearableRange('spo2_intraday', new Float32Array([78, 99]));
    expect(r.max).toBe(100);
    expect(r.min).toBeCloseTo(75.8, 10);
    expect(r.min).toBeLessThan(78); // covers the dip
  });

  it('never lets the SpO₂ max exceed 100 even for an impossible >100 sample', () => {
    // A corrupt 103 reading must not push the pinned max above 100.
    // data [95, 103]: pinMax → outMax = 100; outMin = min(85, 95) = 85 (95 not below).
    const r = wearableRange('spo2_intraday', new Float32Array([95, 103]));
    expect(r.max).toBe(100);
    expect(r.min).toBe(85);
  });

  it('keeps SpO₂ at the default when data sits inside the default band', () => {
    // data [88, 97] fits inside [85, 100] → no expansion, no pad.
    const r = wearableRange('spo2_intraday', new Float32Array([88, 97]));
    expect(r.min).toBe(85);
    expect(r.max).toBe(100);
  });

  it('falls back to type defaults when there is no finite data', () => {
    const r = wearableRange('spo2_intraday', new Float32Array([NaN, NaN]));
    expect(r.min).toBe(85);
    expect(r.max).toBe(100);
  });

  it('falls back to type defaults for an empty value array', () => {
    // No samples at all → lo/hi stay ±Infinity → default fallback.
    const r = wearableRange('heart_rate_intraday', new Float32Array([]));
    expect(r.min).toBe(40);
    expect(r.max).toBe(120);
  });

  it('gives a flat series breathing room while keeping the default floor', () => {
    // HRV default [0, 120]; a flat series at 42 keeps the default span (the
    // value already fits) rather than collapsing to a 1-unit band.
    const r = wearableRange('hrv_detail', new Float32Array([42, 42, 42]));
    expect(r.min).toBe(0);
    expect(r.max).toBe(120);
  });

  it('extends a flat series that sits below the default floor (lo - 1) and never collapses', () => {
    // HR default [40, 120]; flat series at -10 (all equal → lo === hi branch).
    // min = min(defMin 40, lo - 1 = -11) = -11; max = max(defMax 120, hi + 1) = 120.
    const r = wearableRange('heart_rate_intraday', new Float32Array([-10, -10]));
    expect(r.min).toBe(-11);
    expect(r.max).toBe(120);
    expect(r.min).toBeLessThan(r.max); // never degenerate
  });

  it('respects the SpO₂ max pin for a flat series above the default max region', () => {
    // SpO₂ flat at 100 (lo === hi). pinMax → max stays defMax (100), not hi + 1 = 101.
    // min = min(defMin 85, lo - 1 = 99) = 85.
    const r = wearableRange('spo2_intraday', new Float32Array([100, 100]));
    expect(r.max).toBe(100); // pinned, not 101
    expect(r.min).toBe(85);
  });

  // ---- Window-aware range (session-window clipping) ---------------------------

  it('ignores an off-window neighbour-day HR spike so it does not inflate the range', () => {
    // The Signal Viewer merges neighbour-day data; an adjacent day's daytime HR of
    // 180 sits OUTSIDE the session window [0, end]. With the window applied, only
    // the nighttime 50–70 readings drive the edges, so the range stays at the
    // default floor [40, 120] — NOT inflated toward ~180.
    const end = 8 * 60 * 60 * 1000; // 8h session window
    const values = new Float32Array([55, 70, 50, 180]);
    const times = new Float64Array([0, 60_000, 120_000, end + 600_000]); // last is off-window

    const windowed = wearableRange('heart_rate_intraday', values, times, { start: 0, end });
    expect(windowed.min).toBe(40);
    expect(windowed.max).toBe(120);

    // Equivalent to dropping the spike entirely (same in-window data only).
    const withoutSpike = wearableRange('heart_rate_intraday', new Float32Array([55, 70, 50]));
    expect(windowed.min).toBe(withoutSpike.min);
    expect(windowed.max).toBe(withoutSpike.max);
  });

  it('still expands the range for an in-window extreme (expand-only preserved)', () => {
    // A 150 reading INSIDE the window must still push the edge out.
    // outMax = max(120, 150) = 150; span = 150 - 40 = 110; pad = 11 → 161.
    const end = 8 * 60 * 60 * 1000;
    const values = new Float32Array([55, 150, 60]);
    const times = new Float64Array([0, 60_000, 120_000]); // all in-window
    const r = wearableRange('heart_rate_intraday', values, times, { start: 0, end });
    expect(r.min).toBe(40);
    expect(r.max).toBe(161);
    expect(r.max).toBeGreaterThan(150);
  });

  it('falls back to per-type defaults when every sample is off-window (no throw, no ±Infinity)', () => {
    const end = 8 * 60 * 60 * 1000;
    const values = new Float32Array([180, 175, 60]);
    const times = new Float64Array([end + 1, end + 2, -1]); // all outside [0, end]
    const r = wearableRange('heart_rate_intraday', values, times, { start: 0, end });
    expect(r.min).toBe(40);
    expect(r.max).toBe(120);
    expect(Number.isFinite(r.min)).toBe(true);
    expect(Number.isFinite(r.max)).toBe(true);
  });

  it('is identical to pre-change behaviour when the window args are omitted (back-compat)', () => {
    // Same value array, with and without window args. Omitting the window must
    // scan the whole array exactly as before.
    const values = new Float32Array([50, 140]);
    const withWindow = wearableRange('heart_rate_intraday', values, new Float64Array([0, 60_000]), {
      start: 0,
      end: 8 * 60 * 60 * 1000,
    });
    const withoutWindow = wearableRange('heart_rate_intraday', values);
    expect(withoutWindow.min).toBe(40);
    expect(withoutWindow.max).toBe(150);
    expect(withWindow.min).toBe(withoutWindow.min);
    expect(withWindow.max).toBe(withoutWindow.max);
  });
});

describe('buildWearableChannel', () => {
  const hrSpec = WEARABLE_LANE_SPECS.find((s) => s.dataType === 'heart_rate_intraday')!;

  it('builds a wearable line channel with session-relative sample times', () => {
    const epoch = Date.UTC(2026, 0, 15, 22, 0, 0);
    const series = makeSeries('heart_rate_intraday', [
      { timestampMs: epoch + 1000, value: 58 },
      { timestampMs: epoch + 2000, value: 61 },
    ]);

    const channel = buildWearableChannel(
      hrSpec,
      series,
      epoch,
      () => '#ff0000',
      () => 200,
    );

    expect(channel.kind).toBe('wearable');
    expect(channel.render).toBe('line');
    expect(channel.color).toBe('#ff0000');
    expect(channel.height).toBe(200);
    expect(channel.sampleTimes).toBeDefined();
    expect(Array.from(channel.sampleTimes!)).toEqual([1000, 2000]);
    expect(Array.from(channel.data)).toEqual([58, 61]);
  });

  it('threads the session window through to the range yet keeps the full sample arrays', () => {
    // Three nighttime samples in-window plus one neighbour-day daytime spike (180)
    // an hour past the session end. The off-window spike must be kept in
    // data/sampleTimes (the renderer clips off-viewport itself) but must NOT
    // inflate the lane range, which stays at the HR default floor [40, 120].
    const epoch = Date.UTC(2026, 0, 15, 22, 0, 0);
    const end = 8 * 60 * 60 * 1000;
    const series = makeSeries('heart_rate_intraday', [
      { timestampMs: epoch, value: 55 },
      { timestampMs: epoch + 60_000, value: 70 },
      { timestampMs: epoch + 120_000, value: 50 },
      { timestampMs: epoch + end + 3_600_000, value: 180 }, // off-window neighbour day
    ]);

    const channel = buildWearableChannel(
      hrSpec,
      series,
      epoch,
      () => '#ff0000',
      () => 200,
      { start: 0, end },
    );

    // Range is window-aware: the 180 spike does NOT inflate it.
    expect(channel.physicalMin).toBe(40);
    expect(channel.physicalMax).toBe(120);

    // The full merged series is preserved for the rendered line.
    expect(Array.from(channel.data)).toEqual([55, 70, 50, 180]);
    expect(Array.from(channel.sampleTimes!)).toEqual([0, 60_000, 120_000, end + 3_600_000]);
  });

  it('marks the HRV step lane as sparse', () => {
    const hrvSpec = WEARABLE_LANE_SPECS.find((s) => s.dataType === 'hrv_detail')!;
    const series = makeSeries('hrv_detail', [{ timestampMs: 0, value: 35 }]);
    const channel = buildWearableChannel(
      hrvSpec,
      series,
      0,
      () => '#000',
      () => 150,
    );
    expect(channel.render).toBe('step');
    expect(channel.sparse).toBe(true);
  });
});

describe('hypnogramBands', () => {
  it('orders bands Wake → REM → Light → Deep and hatches REM', () => {
    const bands = hypnogramBands((v) => v); // identity resolver returns the var name
    expect(bands.map((b) => b.label)).toEqual(['W', 'REM', 'N1–2', 'N3']);
    expect(bands.map((b) => b.value)).toEqual([
      SLEEP_STAGE_CODES.wake,
      SLEEP_STAGE_CODES.rem,
      SLEEP_STAGE_CODES.light,
      SLEEP_STAGE_CODES.deep,
    ]);
    const rem = bands.find((b) => b.label === 'REM');
    expect(rem?.hatch).toBe(true);
  });
});

describe('sleepStageName', () => {
  it('maps ordinal codes to readable names', () => {
    expect(sleepStageName(SLEEP_STAGE_CODES.wake)).toBe('Wake');
    expect(sleepStageName(SLEEP_STAGE_CODES.rem)).toBe('REM');
    expect(sleepStageName(SLEEP_STAGE_CODES.light)).toBe('Light (N1–2)');
    expect(sleepStageName(SLEEP_STAGE_CODES.deep)).toBe('Deep (N3)');
    expect(sleepStageName(99)).toBe('Unknown');
  });
});

describe('seriesHasData', () => {
  it('is false for undefined or empty series', () => {
    expect(seriesHasData(undefined)).toBe(false);
    expect(seriesHasData(makeSeries('heart_rate_intraday', []))).toBe(false);
  });

  it('is false when all samples are non-finite', () => {
    expect(seriesHasData(makeSeries('heart_rate_intraday', [{ timestampMs: 0, value: NaN }]))).toBe(
      false,
    );
  });

  it('is true when at least one finite sample exists', () => {
    expect(seriesHasData(makeSeries('heart_rate_intraday', [{ timestampMs: 0, value: 60 }]))).toBe(
      true,
    );
  });
});
