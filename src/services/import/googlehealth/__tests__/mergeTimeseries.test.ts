/**
 * Unit tests for {@link mergeTimeseriesPayload}.
 *
 * The merge is the fix for the Fitbit heart-rate-timing data-loss bug: real
 * `heart_rate-YYYY-MM-DD.json` files span a 24h window offset from local
 * midnight, so a single local date is produced by TWO files (a `00:00 →
 * 06:59:59` morning chunk from the previous file and a `07:00 → 23:59` chunk
 * from that date's file). Those arrive as two same-key records that MUST be
 * unioned, not de-duped away. These tests pin that union plus the
 * idempotency/dedupe/sort invariants for every timeseries shape.
 *
 * @module services/import/googlehealth/__tests__/mergeTimeseries
 */

import { describe, it, expect } from 'vitest';

import { mergeTimeseriesPayload } from '../mergeTimeseries';
import { localIsoToWallClockEpoch } from '@/utils/wallClock';
import type {
  FitbitHeartRateIntraday,
  FitbitHeartRateIntradaySample,
  FitbitSpO2Intraday,
  FitbitHRVDetail,
  FitbitSnoringSegments,
  FitbitSleepStages,
} from '@/types/fitbit';

// ---------------------------------------------------------------------------
// Heart-rate helpers
// ---------------------------------------------------------------------------

/**
 * Build a `heart_rate_intraday` payload from absolute wall-clock epochs, encoding
 * offsets against the first (sorted) epoch exactly as the parser does. `bpmFor`
 * lets a test mark samples so collision-resolution can be observed.
 */
function hrPayload(
  epochs: number[],
  bpmFor: (epoch: number) => number = () => 60,
  confFor: (epoch: number) => number = () => 3,
): FitbitHeartRateIntraday {
  const sorted = [...epochs].sort((a, b) => a - b);
  const base = sorted[0] ?? 0;
  const samples: FitbitHeartRateIntradaySample[] = sorted.map((epoch) => ({
    offsetSec: Math.round((epoch - base) / 1000),
    bpm: bpmFor(epoch),
    confidence: confFor(epoch),
  }));
  return { baseTimestampMs: base, samples, sampleCount: samples.length };
}

/** Reconstruct the absolute epochs covered by a HR payload, sorted ascending. */
function hrEpochs(p: FitbitHeartRateIntraday): number[] {
  return p.samples.map((s) => p.baseTimestampMs + s.offsetSec * 1000);
}

/** Wall-clock-as-UTC epoch for `MM/DD/YY HH:MM:SS`-style days expressed as ISO. */
function epoch(iso: string): number {
  return localIsoToWallClockEpoch(iso);
}

// ---------------------------------------------------------------------------
// heart_rate_intraday — the primary case
// ---------------------------------------------------------------------------

describe('mergeTimeseriesPayload — heart_rate_intraday', () => {
  it('unions the real two-file partial-day chunks for 2026-06-02 with no 07:00 gap', () => {
    // Reproduce the EXACT confirmed boundary. File heart_rate-2026-06-01.json
    // contributes the date 2026-06-02's MORNING chunk (00:00 → 06:59:59); file
    // heart_rate-2026-06-02.json contributes 2026-06-02's DAY chunk (07:00 →
    // 23:59). 5-second cadence. Both chunks are for the same local date and were
    // previously stored under the same `heart_rate_intraday:2026-06-02` key, so
    // the second was dropped. After the merge the record must span the full day.
    const STEP = 5_000; // 5 s

    // Morning chunk: 00:00:01 → 06:59:59 (inclusive), 5 s cadence.
    const morningStart = epoch('2026-06-02T00:00:01');
    const morningEnd = epoch('2026-06-02T06:59:59');
    const morningEpochs: number[] = [];
    for (let t = morningStart; t <= morningEnd; t += STEP) morningEpochs.push(t);

    // Day chunk: 07:00:01 → 23:59:59 (inclusive), 5 s cadence.
    const dayStart = epoch('2026-06-02T07:00:01');
    const dayEnd = epoch('2026-06-02T23:59:59');
    const dayEpochs: number[] = [];
    for (let t = dayStart; t <= dayEnd; t += STEP) dayEpochs.push(t);

    // Last epoch actually reachable on the 5 s grid from the day chunk's start.
    const lastDayEpoch = dayEpochs[dayEpochs.length - 1]!;

    const morning = hrPayload(morningEpochs);
    const day = hrPayload(dayEpochs);

    // Stored order: morning chunk first (it arrives from file -06-01), then day.
    const merged = mergeTimeseriesPayload('heart_rate_intraday', morning, day);

    // Spans the full day: base = first morning epoch, last = last day epoch.
    expect(merged.baseTimestampMs).toBe(morningStart);
    expect(merged.sampleCount).toBe(morningEpochs.length + dayEpochs.length);
    expect(merged.samples.length).toBe(merged.sampleCount);

    const epochs = hrEpochs(merged);
    expect(epochs[0]).toBe(morningStart);
    expect(epochs[epochs.length - 1]).toBe(lastDayEpoch);

    // No ~7h cliff at the 07:00 file boundary: the gap from the last morning
    // sample to the first day sample is small (< one cadence step here because of
    // the :01/:59 boundary offsets), NEVER the ~7h cliff the bug produced.
    const lastMorningEpoch = morningEpochs[morningEpochs.length - 1]!;
    const boundaryIdx = epochs.indexOf(lastMorningEpoch);
    expect(boundaryIdx).toBeGreaterThan(0);
    const gapAcrossBoundary = (epochs[boundaryIdx + 1] ?? 0) - lastMorningEpoch;
    expect(gapAcrossBoundary).toBeLessThanOrEqual(STEP);

    // Offsets are monotonic non-negative and consistent with reconstructed time.
    let prev = -1;
    for (const s of merged.samples) {
      expect(s.offsetSec).toBeGreaterThanOrEqual(0);
      expect(s.offsetSec).toBeGreaterThan(prev);
      prev = s.offsetSec;
    }

    // The merged span covers the full ~24h, not the truncated ~7h of the bug.
    const spanSec = (epochs[epochs.length - 1]! - epochs[0]!) / 1000;
    expect(spanSec).toBeGreaterThan(23 * 3600);
  });

  it('is idempotent: merging a payload with itself yields the same sample set', () => {
    const epochs = [
      epoch('2026-06-02T01:00:00'),
      epoch('2026-06-02T01:00:05'),
      epoch('2026-06-02T01:00:10'),
    ];
    const p = hrPayload(epochs, (e) => 50 + ((e / 1000) % 7));
    const merged = mergeTimeseriesPayload('heart_rate_intraday', p, p);

    expect(merged.sampleCount).toBe(p.sampleCount); // no growth
    expect(hrEpochs(merged)).toEqual(hrEpochs(p));
    expect(merged.baseTimestampMs).toBe(p.baseTimestampMs);
    // Same bpm/confidence preserved.
    expect(merged.samples.map((s) => s.bpm)).toEqual(p.samples.map((s) => s.bpm));
  });

  it('dedupes overlapping/out-of-order epochs and prefers the EXISTING sample', () => {
    const t1 = epoch('2026-06-02T02:00:00');
    const t2 = epoch('2026-06-02T02:00:05');
    const t3 = epoch('2026-06-02T02:00:10');

    // existing covers t1,t2 with bpm=60; incoming covers t2,t3 with bpm=99 (so the
    // t2 collision must resolve to the EXISTING bpm=60), and is given out of order.
    const existing = hrPayload(
      [t1, t2],
      () => 60,
      () => 3,
    );
    const incoming = hrPayload(
      [t3, t2],
      () => 99,
      () => 1,
    );

    const merged = mergeTimeseriesPayload('heart_rate_intraday', existing, incoming);

    expect(merged.sampleCount).toBe(3);
    expect(hrEpochs(merged)).toEqual([t1, t2, t3]); // sorted ascending, deduped

    // The shared t2 kept the existing sample (bpm 60, confidence 3), not 99/1.
    const t2Sample = merged.samples.find((s) => merged.baseTimestampMs + s.offsetSec * 1000 === t2);
    expect(t2Sample?.bpm).toBe(60);
    expect(t2Sample?.confidence).toBe(3);
  });

  it('handles two empty payloads without throwing', () => {
    const empty: FitbitHeartRateIntraday = { baseTimestampMs: 123, samples: [], sampleCount: 0 };
    const merged = mergeTimeseriesPayload('heart_rate_intraday', empty, empty);
    expect(merged.samples).toEqual([]);
    expect(merged.sampleCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// spo2_intraday
// ---------------------------------------------------------------------------

describe('mergeTimeseriesPayload — spo2_intraday', () => {
  function spo2(
    sleepStart: string,
    minuteOffsets: number[],
    valueFor = (o: number) => 95 + (o % 3),
  ): FitbitSpO2Intraday {
    const samples = minuteOffsets.map((minuteOffset) => ({
      minuteOffset,
      value: valueFor(minuteOffset),
    }));
    return { samples, sleepStartTime: sleepStart, sampleCount: samples.length };
  }

  it('unions two minute-offset chunks across different sleepStartTimes', () => {
    // existing starts 23:00, incoming starts 02:00 next day; ranges abut/overlap.
    const existing = spo2('2026-06-01T23:00:00', [0, 1, 2]); // 23:00, 23:01, 23:02
    const incoming = spo2('2026-06-02T02:00:00', [0, 1]); // 02:00, 02:01

    const merged = mergeTimeseriesPayload('spo2_intraday', existing, incoming);

    expect(merged.sampleCount).toBe(5);
    // New base = earliest absolute = 23:00 of 06-01.
    expect(localIsoToWallClockEpoch(merged.sleepStartTime)).toBe(
      localIsoToWallClockEpoch('2026-06-01T23:00:00'),
    );
    // minuteOffsets recomputed against the new base, sorted ascending.
    expect(merged.samples.map((s) => s.minuteOffset)).toEqual([0, 1, 2, 180, 181]);
  });

  it('is idempotent and dedupes identical absolute minutes (existing wins)', () => {
    const a = spo2('2026-06-02T00:00:00', [0, 5, 10], () => 90);
    const merged = mergeTimeseriesPayload('spo2_intraday', a, a);
    expect(merged.sampleCount).toBe(3);
    expect(merged.samples.map((s) => s.minuteOffset)).toEqual([0, 5, 10]);

    const overlap = spo2('2026-06-02T00:05:00', [0, 5], () => 99); // 00:05, 00:10 collide
    const merged2 = mergeTimeseriesPayload('spo2_intraday', a, overlap);
    expect(merged2.sampleCount).toBe(3); // no growth: both incoming minutes already present
    // Collisions kept existing value 90, not 99.
    expect(merged2.samples.every((s) => s.value === 90)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Absolute-ISO shapes: hrv_detail, snoring_segments, sleep_stages
// ---------------------------------------------------------------------------

describe('mergeTimeseriesPayload — absolute-ISO shapes', () => {
  it('hrv_detail: concat, dedupe by timestamp string (existing wins), sort ascending', () => {
    const existing: FitbitHRVDetail = {
      intervals: [
        { timestamp: '2026-06-02T01:05:00', rmssd: 30, coverage: 1, hf: 1, lf: 1 },
        { timestamp: '2026-06-02T01:00:00', rmssd: 31, coverage: 1, hf: 1, lf: 1 },
      ],
    };
    const incoming: FitbitHRVDetail = {
      intervals: [
        { timestamp: '2026-06-02T01:05:00', rmssd: 999, coverage: 9, hf: 9, lf: 9 }, // dup ts
        { timestamp: '2026-06-02T01:10:00', rmssd: 32, coverage: 1, hf: 1, lf: 1 },
      ],
    };
    const merged = mergeTimeseriesPayload('hrv_detail', existing, incoming);

    expect(merged.intervals.map((i) => i.timestamp)).toEqual([
      '2026-06-02T01:00:00',
      '2026-06-02T01:05:00',
      '2026-06-02T01:10:00',
    ]);
    // Collision on 01:05:00 kept the existing interval (rmssd 30, not 999).
    expect(merged.intervals.find((i) => i.timestamp === '2026-06-02T01:05:00')?.rmssd).toBe(30);
  });

  it('hrv_detail idempotency: merging with itself does not grow', () => {
    const p: FitbitHRVDetail = {
      intervals: [
        { timestamp: '2026-06-02T01:00:00', rmssd: 30, coverage: 1, hf: 1, lf: 1 },
        { timestamp: '2026-06-02T01:05:00', rmssd: 31, coverage: 1, hf: 1, lf: 1 },
      ],
    };
    const merged = mergeTimeseriesPayload('hrv_detail', p, p);
    expect(merged.intervals.length).toBe(2);
  });

  it('snoring_segments: union deduped by timestamp, sorted', () => {
    const existing: FitbitSnoringSegments = {
      segments: [
        {
          timestamp: '2026-06-02T03:00:30',
          durationSeconds: 30,
          meanDba: 40,
          maxDba: 50,
          snoreDetected: true,
        },
      ],
    };
    const incoming: FitbitSnoringSegments = {
      segments: [
        {
          timestamp: '2026-06-02T03:00:00',
          durationSeconds: 30,
          meanDba: 38,
          maxDba: 48,
          snoreDetected: false,
        },
        {
          timestamp: '2026-06-02T03:00:30',
          durationSeconds: 30,
          meanDba: 99,
          maxDba: 99,
          snoreDetected: true,
        }, // dup
      ],
    };
    const merged = mergeTimeseriesPayload('snoring_segments', existing, incoming);
    expect(merged.segments.map((s) => s.timestamp)).toEqual([
      '2026-06-02T03:00:00',
      '2026-06-02T03:00:30',
    ]);
    expect(merged.segments.find((s) => s.timestamp === '2026-06-02T03:00:30')?.meanDba).toBe(40);
  });

  it('sleep_stages: union deduped by timestamp, sorted', () => {
    const existing: FitbitSleepStages = {
      transitions: [{ timestamp: '2026-06-02T04:00:00', stage: 'light', durationSeconds: 600 }],
    };
    const incoming: FitbitSleepStages = {
      transitions: [
        { timestamp: '2026-06-02T03:30:00', stage: 'deep', durationSeconds: 1800 },
        { timestamp: '2026-06-02T04:00:00', stage: 'rem', durationSeconds: 0 }, // dup ts -> existing wins
      ],
    };
    const merged = mergeTimeseriesPayload('sleep_stages', existing, incoming);
    expect(merged.transitions.map((t) => t.timestamp)).toEqual([
      '2026-06-02T03:30:00',
      '2026-06-02T04:00:00',
    ]);
    expect(merged.transitions.find((t) => t.timestamp === '2026-06-02T04:00:00')?.stage).toBe(
      'light',
    );
  });
});
