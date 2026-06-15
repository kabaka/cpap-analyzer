import { describe, it, expect } from 'vitest';
import {
  reliabilityTier,
  baseReliabilityTier,
  reliabilityTierLabel,
  dataQualityFlagLabel,
} from '../reliabilityTier';
import { LEAK_NOTICE_LPM, LEAK_SUPPRESS_LPM } from '../constants';

describe('baseReliabilityTier — registry (consensus D5)', () => {
  it('assigns high to pressure / usage / leak-below', () => {
    expect(baseReliabilityTier('pressure')).toBe('high');
    expect(baseReliabilityTier('usage')).toBe('high');
    expect(baseReliabilityTier('compliance')).toBe('high');
    expect(baseReliabilityTier('leakBelow')).toBe('high');
  });

  it('assigns moderate to apnea count / AHI / hypopnea / Vt / MV / RR', () => {
    expect(baseReliabilityTier('apneaCount')).toBe('moderate');
    expect(baseReliabilityTier('ahi')).toBe('moderate');
    expect(baseReliabilityTier('hypopneaCount')).toBe('moderate');
    expect(baseReliabilityTier('tidalVolume')).toBe('moderate');
    expect(baseReliabilityTier('minuteVentilation')).toBe('moderate');
    expect(baseReliabilityTier('respiratoryRate')).toBe('moderate');
  });

  it('assigns low to split / flow-limitation / RERA / wearable SpO2 / sleep', () => {
    expect(baseReliabilityTier('centralObstructiveSplit')).toBe('low');
    expect(baseReliabilityTier('centralFraction')).toBe('low');
    expect(baseReliabilityTier('flowLimitation')).toBe('low');
    expect(baseReliabilityTier('rera')).toBe('low');
    expect(baseReliabilityTier('wearableSpo2')).toBe('low');
    expect(baseReliabilityTier('sleepStage')).toBe('low');
  });

  it('falls back to moderate for unknown metric ids', () => {
    expect(baseReliabilityTier('not-a-metric')).toBe('moderate');
  });
});

describe('reliabilityTier — no context never downgrades', () => {
  it('returns base tier with no flags when ctx is empty', () => {
    expect(reliabilityTier('ahi')).toEqual({ tier: 'moderate', flags: [] });
    expect(reliabilityTier('pressure')).toEqual({ tier: 'high', flags: [] });
  });

  it('unknown metric → moderate, no flags', () => {
    expect(reliabilityTier('mystery', { medianLeak: 50 })).toEqual({
      tier: 'moderate',
      flags: [],
    });
  });
});

describe('reliabilityTier — leak gate boundary (24 vs 30, D7)', () => {
  it('leak just below the notice gate (23) → no downgrade, no flag', () => {
    const r = reliabilityTier('tidalVolume', { medianLeak: LEAK_NOTICE_LPM - 1 });
    expect(r.tier).toBe('moderate');
    expect(r.flags).not.toContain('high-leak');
  });

  it('leak at the notice gate (24) → one-step downgrade + high-leak flag', () => {
    const r = reliabilityTier('tidalVolume', { medianLeak: LEAK_NOTICE_LPM });
    expect(r.tier).toBe('low'); // moderate → low (one step)
    expect(r.flags).toContain('high-leak');
  });

  it('leak in the notice band (24–30) downgrades one step', () => {
    const r = reliabilityTier('tidalVolume', { medianLeak: 27 });
    expect(r.tier).toBe('low');
    expect(r.flags).toContain('high-leak');
  });

  it('leak at the suppress gate (30) → two-step downgrade', () => {
    const r = reliabilityTier('tidalVolume', { medianLeak: LEAK_SUPPRESS_LPM });
    // moderate → low (clamped at floor after 2 steps)
    expect(r.tier).toBe('low');
    expect(r.flags).toContain('high-leak');
  });

  it('AHI is NOT leak-gated (robust aggregate, stats-review §8)', () => {
    const r = reliabilityTier('ahi', { medianLeak: 50 });
    expect(r.tier).toBe('moderate');
    expect(r.flags).not.toContain('high-leak');
  });
});

describe('reliabilityTier — low event-count gate (D8)', () => {
  it('AHI with N >= 20 and good context stays moderate', () => {
    const r = reliabilityTier('ahi', { eventCount: 40, maskOnHours: 7 });
    expect(r.tier).toBe('moderate');
    expect(r.flags).toEqual([]);
  });

  it('AHI with N < 20 downgrades + flags low-count', () => {
    const r = reliabilityTier('ahi', { eventCount: 8, maskOnHours: 7 });
    expect(r.tier).toBe('low');
    expect(r.flags).toContain('low-count');
  });

  it('count exactly 20 does not trip the low-count gate', () => {
    const r = reliabilityTier('ahi', { eventCount: 20 });
    expect(r.tier).toBe('moderate');
    expect(r.flags).not.toContain('low-count');
  });
});

describe('reliabilityTier — split / rare-class gate (D8)', () => {
  it('central split with rare class < 5 stays low and flags low-count', () => {
    const r = reliabilityTier('centralFraction', { eventCount: 50, rareClassCount: 2 });
    expect(r.tier).toBe('low');
    expect(r.flags).toContain('low-count');
  });

  it('total < 20 trips the split gate', () => {
    const r = reliabilityTier('centralObstructiveSplit', { eventCount: 12, rareClassCount: 6 });
    expect(r.flags).toContain('low-count');
  });

  it('total >= 20 and rare >= 5 does not trip the split gate', () => {
    const r = reliabilityTier('centralFraction', { eventCount: 40, rareClassCount: 6 });
    expect(r.flags).not.toContain('low-count');
  });
});

describe('reliabilityTier — SpO2 coverage gate', () => {
  it('coverage below the minimum downgrades + flags low-coverage', () => {
    const r = reliabilityTier('wearableSpo2', { spo2Coverage: 0.3 });
    expect(r.tier).toBe('low');
    expect(r.flags).toContain('low-coverage');
  });

  it('adequate coverage does not flag', () => {
    const r = reliabilityTier('wearableSpo2', { spo2Coverage: 0.9 });
    expect(r.flags).not.toContain('low-coverage');
  });
});

describe('reliabilityTier — short-session flag (orthogonal)', () => {
  it('short session flags but does not change the tier on its own', () => {
    const r = reliabilityTier('usage', { maskOnHours: 2 });
    expect(r.tier).toBe('high'); // tier unchanged
    expect(r.flags).toContain('short-session');
  });

  it('adequate session length does not flag', () => {
    const r = reliabilityTier('usage', { maskOnHours: 7 });
    expect(r.flags).not.toContain('short-session');
  });
});

describe('reliabilityTier — flags de-duplicated and combined', () => {
  it('combines multiple flags without duplicates', () => {
    const r = reliabilityTier('hypopneaIndex', {
      medianLeak: 35,
      eventCount: 5,
      maskOnHours: 1,
    });
    expect(r.tier).toBe('low');
    expect(new Set(r.flags)).toEqual(new Set(['high-leak', 'low-count', 'short-session']));
    expect(r.flags.length).toBe(new Set(r.flags).size);
  });
});

describe('label helpers', () => {
  it('reliabilityTierLabel', () => {
    expect(reliabilityTierLabel('high')).toBe('High reliability');
    expect(reliabilityTierLabel('moderate')).toBe('Estimate');
    expect(reliabilityTierLabel('low')).toBe('Modeled');
  });

  it('dataQualityFlagLabel', () => {
    expect(dataQualityFlagLabel('high-leak')).toBe('Leak-affected');
    expect(dataQualityFlagLabel('short-session')).toBe('Short session');
    expect(dataQualityFlagLabel('low-coverage')).toBe('Low coverage');
    expect(dataQualityFlagLabel('low-count')).toBe('Few events');
  });
});
