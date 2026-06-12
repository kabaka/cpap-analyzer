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

  it('pads a numeric range by 10%', () => {
    const r = wearableRange('heart_rate_intraday', new Float32Array([50, 100]));
    expect(r.min).toBeCloseTo(45, 5);
    expect(r.max).toBeCloseTo(105, 5);
  });

  it('falls back to type defaults when there is no finite data', () => {
    const r = wearableRange('spo2_intraday', new Float32Array([NaN, NaN]));
    expect(r.min).toBe(85);
    expect(r.max).toBe(100);
  });

  it('gives a flat series breathing room', () => {
    const r = wearableRange('hrv_detail', new Float32Array([42, 42, 42]));
    expect(r.min).toBe(41);
    expect(r.max).toBe(43);
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
