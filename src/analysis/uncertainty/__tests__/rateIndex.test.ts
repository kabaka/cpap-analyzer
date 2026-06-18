import { describe, it, expect } from 'vitest';
import { rateIndex, pooledRate, type RateContribution } from '../rateIndex';
import { MIN_INDEX_USAGE_HOURS } from '../constants';

describe('rateIndex — per-hour index with the rate-validity floor', () => {
  it('returns null (not 0, not a number) just below the default floor', () => {
    const result = rateIndex(10, MIN_INDEX_USAGE_HOURS - 0.0001);
    expect(result).toBeNull();
  });

  it('treats the floor boundary (hours === minHours) as inclusive → finite value', () => {
    // Source guards with `recordingHours < minHours`, so equality is NOT below
    // the floor: exactly-at-floor must yield a defined rate.
    const result = rateIndex(5, MIN_INDEX_USAGE_HOURS);
    expect(result).not.toBeNull();
    expect(Number.isFinite(result as number)).toBe(true);
    // 5 events / 1 h = 5/h
    expect(result).toBeCloseTo(5, 12);
  });

  it('returns events / hours above the floor', () => {
    expect(rateIndex(15, 7.5)).toBeCloseTo(2, 12); // 15 / 7.5
    expect(rateIndex(21, 6)).toBeCloseTo(3.5, 12); // 21 / 6
  });

  it('returns 0 for a measured zero at the floor (valid zero, not null)', () => {
    const result = rateIndex(0, MIN_INDEX_USAGE_HOURS);
    expect(result).toBe(0);
    expect(result).not.toBeNull();
  });

  it('returns 0 for a measured zero above the floor (valid zero, not null)', () => {
    const result = rateIndex(0, 8);
    expect(result).toBe(0);
    expect(result).not.toBeNull();
  });

  it('returns null for non-finite hours', () => {
    expect(rateIndex(5, NaN)).toBeNull();
    expect(rateIndex(5, Infinity)).toBeNull();
    expect(rateIndex(5, -Infinity)).toBeNull();
  });

  it('returns null for hours <= 0', () => {
    expect(rateIndex(5, 0)).toBeNull();
    expect(rateIndex(5, -3)).toBeNull();
  });

  describe('custom minHours (the ODI oximetry-coverage path)', () => {
    const customFloor = 3;

    it('returns null below the custom floor', () => {
      expect(rateIndex(12, customFloor - 0.5, customFloor)).toBeNull();
    });

    it('returns a finite value exactly at the custom floor (inclusive)', () => {
      const result = rateIndex(6, customFloor, customFloor);
      expect(result).not.toBeNull();
      expect(result).toBeCloseTo(2, 12); // 6 / 3
    });

    it('returns events / hours above the custom floor', () => {
      expect(rateIndex(12, 4, customFloor)).toBeCloseTo(3, 12); // 12 / 4
    });

    it('a value valid under the default floor can be undefined under a higher custom floor', () => {
      // 1.5 h ≥ default 1 h (defined), but < custom 3 h floor (undefined).
      expect(rateIndex(9, 1.5)).toBeCloseTo(6, 12);
      expect(rateIndex(9, 1.5, customFloor)).toBeNull();
    });
  });
});

describe('pooledRate — duration-weighted Σ(rate·hours)/Σhours', () => {
  it('returns null for empty input', () => {
    expect(pooledRate([])).toBeNull();
  });

  it('returns null when every contribution has a null rate', () => {
    const contributions: RateContribution[] = [
      { rate: null, hours: 6 },
      { rate: null, hours: 8 },
    ];
    expect(pooledRate(contributions)).toBeNull();
  });

  it('returns null when no contribution qualifies (null rates and non-positive hours)', () => {
    const contributions: RateContribution[] = [
      { rate: null, hours: 7 },
      { rate: 5, hours: 0 },
      { rate: 3, hours: -2 },
    ];
    expect(pooledRate(contributions)).toBeNull();
  });

  it('excludes a contribution with hours <= 0 from numerator and denominator', () => {
    // The 0-hour night must contribute neither events nor weight; the result is
    // entirely the qualifying 6 h / rate 4 night.
    const contributions: RateContribution[] = [
      { rate: 4, hours: 6 },
      { rate: 999, hours: 0 },
    ];
    expect(pooledRate(contributions)).toBeCloseTo(4, 12);
  });

  it('excludes a contribution with non-finite hours from numerator and denominator', () => {
    const contributions: RateContribution[] = [
      { rate: 4, hours: 6 },
      { rate: 100, hours: NaN },
      { rate: 100, hours: Infinity },
    ];
    expect(pooledRate(contributions)).toBeCloseTo(4, 12);
  });

  it('weights by duration: unequal-hour nights give Σ(rate·hours)/Σhours, not a plain mean', () => {
    // Nights {rate 10, 8 h} and {rate 2, 1 h}.
    // Plain mean would be (10 + 2) / 2 = 6 — WRONG.
    // Duration-weighted = (10·8 + 2·1) / (8 + 1) = 82 / 9 = 9.111…
    const contributions: RateContribution[] = [
      { rate: 10, hours: 8 },
      { rate: 2, hours: 1 },
    ];
    expect(pooledRate(contributions)).toBeCloseTo(82 / 9, 12);
    // And explicitly distinct from the naive unweighted mean.
    expect(pooledRate(contributions)).not.toBeCloseTo(6, 6);
  });

  it('algebraic identity: Σ(rate·hours)/Σhours === Σevents/Σhours for unequal hours', () => {
    // Reconstruct each night's event count as rate·hours, then form the pooled
    // count/time directly and confirm pooledRate matches it.
    const nights = [
      { rate: 7, hours: 5.5 },
      { rate: 1.5, hours: 2 },
      { rate: 12, hours: 9.25 },
    ];
    const totalEvents = nights.reduce((s, n) => s + n.rate * n.hours, 0);
    const totalHours = nights.reduce((s, n) => s + n.hours, 0);
    const expected = totalEvents / totalHours;

    expect(pooledRate(nights)).toBeCloseTo(expected, 12);
  });

  it('mixes qualifying, null, and short/zero-hour nights: nulls excluded, weighting correct', () => {
    // Only the two qualifying nights count: {10, 8 h} and {2, 1 h} → 82/9.
    const contributions: RateContribution[] = [
      { rate: 10, hours: 8 },
      { rate: null, hours: 6 }, // below per-session floor → excluded
      { rate: 2, hours: 1 },
      { rate: 50, hours: 0 }, // zero-hour → excluded
    ];
    expect(pooledRate(contributions)).toBeCloseTo(82 / 9, 12);
  });

  it('preserves a measured pooled zero (all qualifying rates are 0) as 0, not null', () => {
    const contributions: RateContribution[] = [
      { rate: 0, hours: 8 },
      { rate: 0, hours: 6.5 },
    ];
    const result = pooledRate(contributions);
    expect(result).toBe(0);
    expect(result).not.toBeNull();
  });
});
