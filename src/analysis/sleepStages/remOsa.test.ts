import { describe, it, expect } from 'vitest';
import type { Event, EventType } from '@/types/events';
import {
  remOsaPattern,
  remVsNremAcrossNights,
  type StageDurations,
  type TaggedEvent,
  type NightInput,
} from './index';

const MIN = 60_000;

function makeEvent(timestamp: number, type: EventType = 'ObstructiveApnea'): Event {
  return {
    id: `e-${timestamp}`,
    sessionId: 's',
    type,
    timestamp,
    duration: 15,
    severity: null,
    pressure: null,
    epap: null,
    ipap: null,
    leak: null,
    spo2: null,
    clusterId: null,
  };
}

function durations(remMin: number, nremMin: number): StageDurations {
  const remMs = remMin * MIN;
  const nremMs = nremMin * MIN;
  // Split NREM arbitrarily into deep/light halves.
  const deep = Math.floor(nremMs / 2);
  const light = nremMs - deep;
  return {
    deep,
    light,
    rem: remMs,
    wake: 0,
    nremMs,
    remMs,
    asleepMs: remMs + nremMs,
  };
}

function tagged(remCount: number, nremCount: number): TaggedEvent[] {
  const out: TaggedEvent[] = [];
  let t = 0;
  for (let i = 0; i < remCount; i++) out.push({ event: makeEvent(t++), stage: 'rem' });
  for (let i = 0; i < nremCount; i++) out.push({ event: makeEvent(t++), stage: 'deep' });
  return out;
}

describe('remOsaPattern', () => {
  it('classifies REM-predominant (ratio >= 2 and AHI_NREM < 15)', () => {
    // REM 60min (1h), NREM 240min (4h). REM events=10 -> AHI_REM=10.
    // NREM events=8 -> AHI_NREM=2. ratio=5 >= 2, AHI_NREM=2 < 15.
    const res = remOsaPattern(tagged(10, 8), durations(60, 240));
    expect(res.ahiRem).toBeCloseTo(10, 9);
    expect(res.ahiNrem).toBeCloseTo(2, 9);
    expect(res.ratio).toBeCloseTo(5, 9);
    expect(res.classification).toBe('rem-predominant');
  });

  it('classifies REM-related (ratio >= 2 but AHI_NREM >= 15)', () => {
    // REM 60min (1h) events=80 -> AHI_REM=80. NREM 60min (1h) events=20 -> AHI_NREM=20.
    // ratio=4 >= 2 but AHI_NREM=20 >= 15 -> rem-related.
    const res = remOsaPattern(tagged(80, 20), durations(60, 60));
    expect(res.ratio).toBeCloseTo(4, 9);
    expect(res.ahiNrem).toBeCloseTo(20, 9);
    expect(res.classification).toBe('rem-related');
  });

  it('classifies not-rem-predominant when ratio < 2', () => {
    // REM 60min events=10 -> AHI_REM=10. NREM 60min events=10 -> AHI_NREM=10. ratio=1.
    const res = remOsaPattern(tagged(10, 10), durations(60, 60));
    expect(res.ratio).toBeCloseTo(1, 9);
    expect(res.classification).toBe('not-rem-predominant');
  });

  it('returns insufficient-data when REM time < 30 min', () => {
    const res = remOsaPattern(tagged(10, 5), durations(20, 240));
    expect(res.classification).toBe('insufficient-data');
    expect(res.remMinutes).toBe(20);
  });

  it('returns insufficient-data when NREM time < 15 min', () => {
    const res = remOsaPattern(tagged(10, 1), durations(60, 10));
    expect(res.classification).toBe('insufficient-data');
  });

  it('returns insufficient-data when AHI_NREM is 0 (undefined ratio)', () => {
    // Enough time but zero NREM events.
    const res = remOsaPattern(tagged(10, 0), durations(60, 60));
    expect(res.ahiNrem).toBe(0);
    expect(res.ratio).toBeNull();
    expect(res.classification).toBe('insufficient-data');
  });

  it('ignores non-AHI event types in the counts', () => {
    const evts: TaggedEvent[] = [
      { event: makeEvent(1, 'RERA'), stage: 'rem' },
      { event: makeEvent(2, 'ObstructiveApnea'), stage: 'rem' },
      { event: makeEvent(3, 'FlowLimitation'), stage: 'deep' },
    ];
    const res = remOsaPattern(evts, durations(60, 60));
    expect(res.remEventCount).toBe(1); // only the OA
    expect(res.nremEventCount).toBe(0); // FlowLimitation not AHI
  });
});

describe('remVsNremAcrossNights', () => {
  function night(date: string, remCount: number, nremCount: number): NightInput {
    return { date, taggedEvents: tagged(remCount, nremCount), durations: durations(60, 240) };
  }

  it('flags insufficient data with fewer than 5 paired nights', () => {
    const nights = [night('d1', 10, 2), night('d2', 12, 3)];
    const res = remVsNremAcrossNights(nights);
    expect(res.sufficientData).toBe(false);
    expect(res.wilcoxon).toBeNull();
    expect(res.nIncludedNights).toBe(2);
  });

  it('runs Wilcoxon with >= 5 paired nights where REM consistently exceeds NREM', () => {
    // REM events 10 (AHI_REM=10), NREM events 8 (AHI_NREM=2) each night.
    const nights = Array.from({ length: 6 }, (_, i) => night(`d${i}`, 10, 8));
    const res = remVsNremAcrossNights(nights);
    expect(res.sufficientData).toBe(true);
    expect(res.nIncludedNights).toBe(6);
    expect(res.wilcoxon).not.toBeNull();
    expect(res.medianAhiRem).toBeCloseTo(10, 9); // 10 events / 1h
    expect(res.medianAhiNrem).toBeCloseTo(2, 9); // 8 events / 4h
    // All pairs have REM > NREM -> small p-value.
    expect(res.wilcoxon!.pValue).toBeLessThan(0.05);
  });

  it('excludes nights below the per-night stage-time thresholds', () => {
    const nights: NightInput[] = [
      ...Array.from({ length: 5 }, (_, i) => night(`ok${i}`, 10, 8)),
      { date: 'short-rem', taggedEvents: tagged(5, 5), durations: durations(10, 240) },
    ];
    const res = remVsNremAcrossNights(nights);
    expect(res.nIncludedNights).toBe(5); // short-rem night excluded
  });
});
