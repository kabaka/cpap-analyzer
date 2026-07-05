import { describe, it, expect } from 'vitest';

import type { NightlyAggregate } from '@/types';

import {
  ahiHistogram,
  classifyTherapyIndex,
  computeTherapyIndex,
  DEFAULT_AHI_HISTOGRAM_EDGES,
  leakDistribution,
  monthlyMeanAhi,
  seriesMean,
  THERAPY_INDEX_WEIGHTS,
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
// classifyTherapyIndex + weights
// ---------------------------------------------------------------------------

describe('classifyTherapyIndex', () => {
  it('maps scores to bands at the documented boundaries', () => {
    expect(classifyTherapyIndex(85)).toBe('Dialed in');
    expect(classifyTherapyIndex(84.999)).toBe('On track');
    expect(classifyTherapyIndex(70)).toBe('On track');
    expect(classifyTherapyIndex(69.999)).toBe('Needs attention');
    expect(classifyTherapyIndex(55)).toBe('Needs attention');
    expect(classifyTherapyIndex(54.999)).toBe('Off track');
    expect(classifyTherapyIndex(0)).toBe('Off track');
  });
});

describe('THERAPY_INDEX_WEIGHTS', () => {
  it('sums to 1', () => {
    const { ahi, adherence, usage, leak } = THERAPY_INDEX_WEIGHTS;
    expect(ahi + adherence + usage + leak).toBeCloseTo(1, 12);
  });
});

// ---------------------------------------------------------------------------
// computeTherapyIndex
// ---------------------------------------------------------------------------

describe('computeTherapyIndex', () => {
  it('computes the hand-verified composite for two clean nights', () => {
    // Night A: ahi 4, usage 8h, leak 6.  Night B: ahi 8, usage 8h, leak 18.
    // Equal usage hours → pooled AHI is the simple mean = 6.
    //   sAHI     = (15 - 6)/15*100                 = 60
    //   sAdhere  = 1.0 * 100                        = 100  (both ≥ 4h)
    //   sUsage   = clamp(8/7.5*100, 0, 100)         = 100
    //   sLeak    = (24 - 12)/24*100                 = 50   (mean leak = 12)
    //   score    = 0.40*60 + 0.28*100 + 0.20*100 + 0.12*50 = 78
    const result = computeTherapyIndex([
      makeNight({ ahi: 4, usageHours: 8, leakMedian: 6 }),
      makeNight({ ahi: 8, usageHours: 8, leakMedian: 18 }),
    ]);

    expect(result.score).toBe(78);
    expect(result.label).toBe('On track');
    expect(result.severityForLabel).toBe('mild');
    expect(result.subscores.ahi).toBeCloseTo(60, 10);
    expect(result.subscores.adherence).toBeCloseTo(100, 10);
    expect(result.subscores.usage).toBeCloseTo(100, 10);
    expect(result.subscores.leak).toBeCloseTo(50, 10);
    expect(result.nightsUsed).toBe(2);
  });

  it('renormalises over the remaining weights when no AHI is defined', () => {
    // Both nights have null AHI → sAHI null, dropped from the composite.
    //   sAdhere = 100, sUsage = 100 (8h), sLeak = (24-6)/24*100 = 75
    //   composite = (0.28*100 + 0.20*100 + 0.12*75) / (0.28+0.20+0.12)
    //             = (28 + 20 + 9) / 0.60 = 57 / 0.60 = 95
    const result = computeTherapyIndex([
      makeNight({ ahi: null, usageHours: 8, leakMedian: 6 }),
      makeNight({ ahi: null, usageHours: 8, leakMedian: 6 }),
    ]);

    expect(result.subscores.ahi).toBeNull();
    expect(result.score).toBe(95);
    expect(result.label).toBe('Dialed in');
    expect(result.severityForLabel).toBe('normal');
    expect(result.nightsUsed).toBe(2);
  });

  it('duration-weights the pooled AHI (short night does not dominate)', () => {
    // Night A: ahi 2 over 8h; Night B: ahi 20 over 2h.
    // pooled = (2*8 + 20*2)/(8+2) = (16+40)/10 = 5.6
    //   sAHI = (15 - 5.6)/15*100 = 62.6666...
    const result = computeTherapyIndex([
      makeNight({ ahi: 2, usageHours: 8, leakMedian: 12 }),
      makeNight({ ahi: 20, usageHours: 2, leakMedian: 12 }),
    ]);
    expect(result.subscores.ahi).toBeCloseTo(((15 - 5.6) / 15) * 100, 8);
  });

  it('clamps a very high AHI sub-score to 0', () => {
    const result = computeTherapyIndex([makeNight({ ahi: 40, usageHours: 8 })]);
    expect(result.subscores.ahi).toBe(0);
  });

  it('counts nights below the CMS floor as non-compliant', () => {
    // One 8h (compliant) + one 3h (non-compliant) → complianceRate = 0.5
    const result = computeTherapyIndex([
      makeNight({ usageHours: 8 }),
      makeNight({ usageHours: 3 }),
    ]);
    expect(result.subscores.adherence).toBeCloseTo(50, 10);
  });

  it('returns a well-defined no-data sentinel for empty input', () => {
    const result = computeTherapyIndex([]);
    expect(result.nightsUsed).toBe(0);
    expect(result.score).toBe(0);
    expect(result.label).toBe('Off track');
    expect(result.subscores).toEqual({
      ahi: null,
      adherence: null,
      usage: null,
      leak: null,
    });
  });

  it('is deterministic and order-independent', () => {
    const a = makeNight({ ahi: 4, usageHours: 8, leakMedian: 6 });
    const b = makeNight({ ahi: 8, usageHours: 8, leakMedian: 18 });
    expect(computeTherapyIndex([a, b])).toEqual(computeTherapyIndex([b, a]));
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
