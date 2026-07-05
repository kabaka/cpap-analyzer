import { describe, it, expect } from 'vitest';

import type { NightlyAggregate } from '@/types';

import {
  ahiHistogram,
  classifyGoodNightRate,
  DEFAULT_AHI_HISTOGRAM_EDGES,
  GOOD_NIGHT_AHI_MAX,
  GOOD_NIGHT_MIN_HOURS,
  goodNightRate,
  leakDistribution,
  monthlyMeanAhi,
  seriesMean,
} from './metrics';

// ---------------------------------------------------------------------------
// Test factory — a fully-populated NightlyAggregate with sane defaults that
// individual tests override only for the fields under test.
// ---------------------------------------------------------------------------

let nightCounter = 0;

function makeNight(overrides: Partial<NightlyAggregate> = {}): NightlyAggregate {
  nightCounter += 1;
  const base: NightlyAggregate = {
    id: `agg-${nightCounter}`,
    sessionId: `sess-${nightCounter}`,
    machineId: 'machine-1',
    date: '2025-01-01',

    ahi: 5,
    ahiObstructive: 3,
    ahiCentral: 1,
    ahiMixed: 0,
    ahiHypopnea: 1,
    ahiRera: 0,

    eventCount: 40,
    eventsByType: {
      obstructive: 24,
      central: 8,
      mixed: 0,
      hypopnea: 8,
      rera: 0,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
    },

    pressureMean: 9,
    pressureMedian: 9,
    pressureP95: 11,
    pressureMax: 12,
    epapMedian: null,
    ipapMedian: null,
    pressureSupport: null,

    leakMedian: 12,
    leakP95: 20,
    leakMax: 30,
    leakDurationMinutes: 0,

    tidalVolumeMean: null,
    tidalVolumeMedian: null,
    minuteVentMean: null,
    respRateMean: null,
    respRateMedian: null,

    spo2Mean: null,
    spo2Median: null,
    spo2Min: null,
    spo2Below90Percent: null,
    oxygenDesaturationIndex: null,

    usageHours: 8,
    maskOnTimeMinutes: 480,
    complianceStatus: 'compliant',

    configuredMinPressure: null,
    configuredMaxPressure: null,
    eprLevel: null,

    notes: '',
    tags: [],
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// seriesMean
// ---------------------------------------------------------------------------

describe('seriesMean', () => {
  it('averages skipping null gaps', () => {
    expect(seriesMean([2, null, 4, null, 6])).toBe(4);
  });

  it('returns null when every entry is null', () => {
    expect(seriesMean([null, null])).toBeNull();
  });

  it('returns null for an empty series (never 0)', () => {
    expect(seriesMean([])).toBeNull();
  });

  it('ignores non-finite values', () => {
    expect(seriesMean([10, Number.NaN, Number.POSITIVE_INFINITY, 20])).toBe(15);
  });

  it('handles a single value', () => {
    expect(seriesMean([7])).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// classifyGoodNightRate + gate constants
// ---------------------------------------------------------------------------

describe('classifyGoodNightRate', () => {
  it('maps rates to bands at the documented boundaries', () => {
    expect(classifyGoodNightRate(85)).toBe('Excellent');
    expect(classifyGoodNightRate(84.999)).toBe('Good');
    expect(classifyGoodNightRate(70)).toBe('Good');
    expect(classifyGoodNightRate(69.999)).toBe('Fair');
    expect(classifyGoodNightRate(50)).toBe('Fair');
    expect(classifyGoodNightRate(49.999)).toBe('Low');
    expect(classifyGoodNightRate(0)).toBe('Low');
  });
});

describe('good-night gate constants', () => {
  it('sources the gates from the canonical clinical thresholds', () => {
    // AASM normal/mild residual-AHI boundary and the CMS usage floor.
    expect(GOOD_NIGHT_AHI_MAX).toBe(5);
    expect(GOOD_NIGHT_MIN_HOURS).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// goodNightRate
// ---------------------------------------------------------------------------

describe('goodNightRate', () => {
  it('scores 100 when every night passes both gates', () => {
    const result = goodNightRate([
      makeNight({ ahi: 1, usageHours: 8 }),
      makeNight({ ahi: 4.9, usageHours: 6 }),
      makeNight({ ahi: 0, usageHours: 4 }),
    ]);
    expect(result.rate).toBe(100);
    expect(result.goodNights).toBe(3);
    expect(result.assessedNights).toBe(3);
    expect(result.effectiveRate).toBe(100);
    expect(result.adherentRate).toBe(100);
    expect(result.label).toBe('Excellent');
    expect(result.severityForLabel).toBe('normal');
  });

  it('scores 0 when no night passes both gates', () => {
    const result = goodNightRate([
      makeNight({ ahi: 12, usageHours: 8 }), // adherent but not effective
      makeNight({ ahi: 1, usageHours: 2 }), // effective but not adherent
    ]);
    expect(result.rate).toBe(0);
    expect(result.goodNights).toBe(0);
    expect(result.assessedNights).toBe(2);
    // Each night passes exactly one gate, so the component rates are non-zero.
    expect(result.effectiveRate).toBe(50);
    expect(result.adherentRate).toBe(50);
    expect(result.label).toBe('Low');
    expect(result.severityForLabel).toBe('severe');
  });

  it('computes a hand-verified mix where component rates differ from the combined rate', () => {
    // 5 recorded nights:
    //   1) ahi 2,   usage 8  → effective ✓, adherent ✓ → GOOD
    //   2) ahi 4,   usage 5  → effective ✓, adherent ✓ → GOOD
    //   3) ahi 3,   usage 7  → effective ✓, adherent ✓ → GOOD
    //   4) ahi 10,  usage 8  → effective ✗, adherent ✓ → not good (adherent only)
    //   5) ahi 1,   usage 2  → effective ✓, adherent ✗ → not good (effective only)
    // goodNights = 3 → rate = 60
    // effectiveNights = 4 (1,2,3,5) → effectiveRate = 80
    // adherentNights  = 4 (1,2,3,4) → adherentRate  = 80
    const result = goodNightRate([
      makeNight({ ahi: 2, usageHours: 8 }),
      makeNight({ ahi: 4, usageHours: 5 }),
      makeNight({ ahi: 3, usageHours: 7 }),
      makeNight({ ahi: 10, usageHours: 8 }),
      makeNight({ ahi: 1, usageHours: 2 }),
    ]);
    expect(result.rate).toBe(60);
    expect(result.goodNights).toBe(3);
    expect(result.assessedNights).toBe(5);
    expect(result.effectiveRate).toBe(80);
    expect(result.adherentRate).toBe(80);
    // Component rates both exceed the combined rate.
    expect(result.effectiveRate).toBeGreaterThan(result.rate ?? 0);
    expect(result.adherentRate).toBeGreaterThan(result.rate ?? 0);
    expect(result.label).toBe('Fair');
    expect(result.severityForLabel).toBe('moderate');
  });

  it('counts a null-AHI short night as not-good and keeps it in the denominator', () => {
    // Night 1 is good. Night 2 has a null AHI (below the rate-validity floor)
    // and a short usage — it fails BOTH gates but still counts as an assessed
    // night, so the rate is 1/2 = 50, not 1/1 = 100.
    const result = goodNightRate([
      makeNight({ ahi: 2, usageHours: 8 }),
      makeNight({ ahi: null, usageHours: 0.5 }),
    ]);
    expect(result.assessedNights).toBe(2);
    expect(result.goodNights).toBe(1);
    expect(result.rate).toBe(50);
    // A null AHI can never be effective (control cannot be confirmed).
    expect(result.effectiveRate).toBe(50);
    expect(result.adherentRate).toBe(50);
  });

  it('treats a null AHI as not effective even when the night is adherent', () => {
    // Long, well-used night but AHI is null → cannot confirm control → not good.
    const result = goodNightRate([makeNight({ ahi: null, usageHours: 8 })]);
    expect(result.effectiveRate).toBe(0);
    expect(result.adherentRate).toBe(100);
    expect(result.rate).toBe(0);
    expect(result.goodNights).toBe(0);
    expect(result.assessedNights).toBe(1);
  });

  it('applies the gate boundaries exactly (AHI 5 fails effective, usage 4.0 passes adherent)', () => {
    // AHI exactly at GOOD_NIGHT_AHI_MAX (5) is NOT effective (strict <).
    const atAhiCeiling = goodNightRate([makeNight({ ahi: 5, usageHours: 8 })]);
    expect(atAhiCeiling.effectiveRate).toBe(0);
    expect(atAhiCeiling.rate).toBe(0);

    // usage exactly at GOOD_NIGHT_MIN_HOURS (4.0) IS adherent (inclusive ≥).
    const atUsageFloor = goodNightRate([makeNight({ ahi: 2, usageHours: 4 })]);
    expect(atUsageFloor.adherentRate).toBe(100);
    expect(atUsageFloor.rate).toBe(100);

    // Just below the usage floor is NOT adherent.
    const belowUsageFloor = goodNightRate([makeNight({ ahi: 2, usageHours: 3.999 })]);
    expect(belowUsageFloor.adherentRate).toBe(0);
    expect(belowUsageFloor.rate).toBe(0);
  });

  it('rounds the reported rates to integers', () => {
    // 1 of 3 good → 33.333… → 33; effective 2/3 → 67; adherent 2/3 → 67.
    const result = goodNightRate([
      makeNight({ ahi: 2, usageHours: 8 }), // good
      makeNight({ ahi: 2, usageHours: 2 }), // effective only
      makeNight({ ahi: 10, usageHours: 8 }), // adherent only
    ]);
    expect(result.rate).toBe(33);
    expect(result.effectiveRate).toBe(67);
    expect(result.adherentRate).toBe(67);
  });

  it('returns the null sentinel for empty input', () => {
    expect(goodNightRate([])).toEqual({
      rate: null,
      goodNights: 0,
      assessedNights: 0,
      effectiveRate: null,
      adherentRate: null,
      label: null,
      severityForLabel: null,
    });
  });

  it('is deterministic and order-independent', () => {
    const a = makeNight({ ahi: 2, usageHours: 8 });
    const b = makeNight({ ahi: 10, usageHours: 8 });
    const c = makeNight({ ahi: 1, usageHours: 2 });
    expect(goodNightRate([a, b, c])).toEqual(goodNightRate([c, b, a]));
  });
});

// ---------------------------------------------------------------------------
// monthlyMeanAhi
// ---------------------------------------------------------------------------

describe('monthlyMeanAhi', () => {
  it('pools AHI within each month, skipping null-AHI nights', () => {
    const points = monthlyMeanAhi([
      // January: one usable (ahi 10, 8h), one null-AHI short night (excluded)
      makeNight({ date: '2025-01-05', ahi: 10, usageHours: 8 }),
      makeNight({ date: '2025-01-20', ahi: null, usageHours: 0.5 }),
      // February: two usable nights, equal hours → simple mean
      makeNight({ date: '2025-02-10', ahi: 2, usageHours: 6 }),
      makeNight({ date: '2025-02-11', ahi: 4, usageHours: 6 }),
    ]);

    expect(points).toHaveLength(2);
    const [jan, feb] = points;

    expect(jan?.month).toBe('2025-01');
    expect(jan?.label).toBe('Jan');
    expect(jan?.meanAhi).toBeCloseTo(10, 10);
    expect(jan?.nights).toBe(1); // only the non-null-AHI night contributes
    expect(jan?.severity).toBe('mild');

    expect(feb?.month).toBe('2025-02');
    expect(feb?.label).toBe('Feb');
    expect(feb?.meanAhi).toBeCloseTo(3, 10);
    expect(feb?.nights).toBe(2);
    expect(feb?.severity).toBe('normal');
  });

  it('returns oldest → newest', () => {
    const points = monthlyMeanAhi([
      makeNight({ date: '2025-03-01', ahi: 5 }),
      makeNight({ date: '2025-01-01', ahi: 5 }),
      makeNight({ date: '2025-02-01', ahi: 5 }),
    ]);
    expect(points.map((p) => p.month)).toEqual(['2025-01', '2025-02', '2025-03']);
  });

  it('keeps only the trailing monthsBack months', () => {
    const nights = [
      makeNight({ date: '2025-01-01', ahi: 5 }),
      makeNight({ date: '2025-02-01', ahi: 5 }),
      makeNight({ date: '2025-03-01', ahi: 5 }),
    ];
    const points = monthlyMeanAhi(nights, 2);
    expect(points.map((p) => p.month)).toEqual(['2025-02', '2025-03']);
  });

  it('emits a null meanAhi / null severity for a month with data but no usable AHI', () => {
    const points = monthlyMeanAhi([
      makeNight({ date: '2025-04-02', ahi: null, usageHours: 0.4 }),
      makeNight({ date: '2025-04-03', ahi: null, usageHours: 0.6 }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]?.meanAhi).toBeNull();
    expect(points[0]?.severity).toBeNull();
    expect(points[0]?.nights).toBe(0);
  });

  it('returns an empty array for no aggregates or non-positive monthsBack', () => {
    expect(monthlyMeanAhi([])).toEqual([]);
    expect(monthlyMeanAhi([makeNight()], 0)).toEqual([]);
    expect(monthlyMeanAhi([makeNight()], -3)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// leakDistribution
// ---------------------------------------------------------------------------

describe('leakDistribution', () => {
  it('computes Type-7 quartiles and percentile whiskers on a known array', () => {
    // leakMedian values: 10, 12, 14, 16, 18 (n = 5)
    //   p25 = 12, p50 = 14, p75 = 16  (Type-7)
    //   whiskerLow  (p2)  = 10 + 0.08*(12-10) = 10.16
    //   whiskerHigh (p98) = 16 + 0.92*(18-16) = 17.84
    const dist = leakDistribution(
      [10, 12, 14, 16, 18].map((leakMedian) => makeNight({ leakMedian })),
    );
    expect(dist.n).toBe(5);
    expect(dist.p25).toBeCloseTo(12, 10);
    expect(dist.p50).toBeCloseTo(14, 10);
    expect(dist.p75).toBeCloseTo(16, 10);
    expect(dist.min).toBe(10);
    expect(dist.max).toBe(18);
    expect(dist.whiskerLow).toBeCloseTo(10.16, 10);
    expect(dist.whiskerHigh).toBeCloseTo(17.84, 10);
  });

  it('handles a single night', () => {
    const dist = leakDistribution([makeNight({ leakMedian: 9 })]);
    expect(dist.n).toBe(1);
    expect(dist.p25).toBe(9);
    expect(dist.p50).toBe(9);
    expect(dist.p75).toBe(9);
    expect(dist.min).toBe(9);
    expect(dist.max).toBe(9);
    expect(dist.whiskerLow).toBe(9);
    expect(dist.whiskerHigh).toBe(9);
  });

  it('returns all-null with n=0 for empty input', () => {
    expect(leakDistribution([])).toEqual({
      p25: null,
      p50: null,
      p75: null,
      min: null,
      max: null,
      whiskerLow: null,
      whiskerHigh: null,
      n: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// ahiHistogram
// ---------------------------------------------------------------------------

describe('ahiHistogram', () => {
  it('bins non-null AHI values and skips nulls (never coercing null to 0)', () => {
    const hist = ahiHistogram([
      makeNight({ ahi: 1 }), // [0,2)
      makeNight({ ahi: 3 }), // [2,4)
      makeNight({ ahi: 5 }), // [4,6)
      makeNight({ ahi: 7 }), // [6,8)
      makeNight({ ahi: 25 }), // [20, Inf)
      makeNight({ ahi: null }), // skipped, NOT placed in [0,2)
    ]);

    expect(hist.n).toBe(5);
    expect(hist.median).toBeCloseTo(5, 10); // median of [1,3,5,7,25]

    const countFor = (lo: number) => hist.bins.find((b) => b.lo === lo)?.count;
    expect(countFor(0)).toBe(1);
    expect(countFor(2)).toBe(1);
    expect(countFor(4)).toBe(1);
    expect(countFor(6)).toBe(1);
    expect(countFor(20)).toBe(1);
    // The null night landed nowhere.
    const total = hist.bins.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(5);
  });

  it('uses the default edges and left-inclusive boundaries', () => {
    const hist = ahiHistogram([
      makeNight({ ahi: 0 }), // boundary → [0,2)
      makeNight({ ahi: 2 }), // boundary → [2,4)
      makeNight({ ahi: 15 }), // boundary → [15,20)
      makeNight({ ahi: 20 }), // boundary → [20, Inf)
    ]);
    expect(hist.bins.length).toBe(DEFAULT_AHI_HISTOGRAM_EDGES.length - 1);
    const countFor = (lo: number) => hist.bins.find((b) => b.lo === lo)?.count;
    expect(countFor(0)).toBe(1);
    expect(countFor(2)).toBe(1);
    expect(countFor(15)).toBe(1);
    expect(countFor(20)).toBe(1);
  });

  it('classifies bin severity from the representative point', () => {
    const hist = ahiHistogram([]);
    const sevFor = (lo: number) => hist.bins.find((b) => b.lo === lo)?.severity;
    expect(sevFor(0)).toBe('normal'); // midpoint 1
    expect(sevFor(4)).toBe('mild'); // midpoint 5
    expect(sevFor(15)).toBe('moderate'); // midpoint 17.5
    expect(sevFor(20)).toBe('moderate'); // open bin uses lower edge 20
  });

  it('returns null median with no non-null AHI nights', () => {
    const hist = ahiHistogram([makeNight({ ahi: null }), makeNight({ ahi: null })]);
    expect(hist.n).toBe(0);
    expect(hist.median).toBeNull();
    expect(hist.bins.every((b) => b.count === 0)).toBe(true);
  });

  it('supports custom edges', () => {
    const hist = ahiHistogram(
      [makeNight({ ahi: 1 }), makeNight({ ahi: 12 })],
      [0, 5, 10, Infinity],
    );
    expect(hist.bins).toHaveLength(3);
    expect(hist.bins[0]?.count).toBe(1); // [0,5) → ahi 1
    expect(hist.bins[2]?.count).toBe(1); // [10,Inf) → ahi 12
  });
});
