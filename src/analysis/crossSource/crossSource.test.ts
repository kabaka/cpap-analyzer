import { describe, it, expect } from 'vitest';
import {
  computeCorrelation,
  computeBlandAltman,
  computePartialCorrelationCrossSrc,
  computeLaggedCrossCorrelation,
  correlateDataSources,
  extractWearableMetricSeries,
} from './index';
import type {
  CrossSourceCorrelationInput,
  BlandAltmanInput,
  PartialCorrelationInput,
  LaggedCrossSourceCorrelationInput,
  CorrelateDataSourcesInput,
  CpapDailyRecord,
} from './index';
import type { IntegrationDailySummary } from '@/types/storage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build ISO date strings for consecutive days starting at 2025-01-01. */
function makeDates(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(2025, 0, 1 + i);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  });
}

/** Build a minimal CpapDailyRecord for testing correlateDataSources. */
function makeCpapRecord(date: string, overrides: Partial<CpapDailyRecord> = {}): CpapDailyRecord {
  return {
    date,
    ahi: 5.0,
    pressureMean: 10.0,
    pressure95th: 12.0,
    leakMedian: 2.0,
    leak95th: 5.0,
    usageHours: 7.0,
    ahiObstructive: 3.0,
    ahiCentral: 1.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. computeCorrelation
// ---------------------------------------------------------------------------

describe('computeCorrelation', () => {
  describe('Pearson method', () => {
    it('should detect perfect positive correlation (r = 1.0)', () => {
      const input: CrossSourceCorrelationInput = {
        x: [1, 2, 3, 4, 5],
        y: [2, 4, 6, 8, 10],
        dates: makeDates(5),
        method: 'pearson',
      };

      const result = computeCorrelation(input);

      expect(result.r).toBeCloseTo(1.0, 10);
      expect(result.rSquared).toBeCloseTo(1.0, 10);
      expect(result.pValue).toBe(0);
      expect(result.n).toBe(5);
      expect(result.strength).toBe('very strong');
      expect(result.direction).toBe('positive');
      expect(result.method).toBe('pearson');
    });

    it('should detect perfect negative correlation (r = -1.0)', () => {
      const input: CrossSourceCorrelationInput = {
        x: [1, 2, 3, 4, 5],
        y: [10, 8, 6, 4, 2],
        dates: makeDates(5),
        method: 'pearson',
      };

      const result = computeCorrelation(input);

      expect(result.r).toBeCloseTo(-1.0, 10);
      expect(result.pValue).toBe(0);
      expect(result.direction).toBe('negative');
    });

    it('should produce near-zero r for uncorrelated data', () => {
      const input: CrossSourceCorrelationInput = {
        x: [1, 2, 3, 4, 5],
        y: [3, 1, 4, 1, 5],
        dates: makeDates(5),
        method: 'pearson',
      };

      const result = computeCorrelation(input);

      expect(Math.abs(result.r)).toBeLessThan(0.5);
      expect(result.n).toBe(5);
    });

    it('should return NaN when fewer than 3 valid pairs', () => {
      const input: CrossSourceCorrelationInput = {
        x: [1, 2],
        y: [3, 4],
        dates: makeDates(2),
        method: 'pearson',
      };

      const result = computeCorrelation(input);

      expect(result.r).toBeNaN();
      expect(result.pValue).toBeNaN();
      expect(result.n).toBe(2);
    });

    it('should pairwise-delete NaN values from input', () => {
      const input: CrossSourceCorrelationInput = {
        x: [1, NaN, 3, 4, 5],
        y: [2, 4, NaN, 8, 10],
        dates: makeDates(5),
        method: 'pearson',
      };

      const result = computeCorrelation(input);

      // After pairwise deletion only indices 0, 3, 4 remain: x=[1,4,5], y=[2,8,10]
      expect(result.n).toBe(3);
      expect(result.r).toBeCloseTo(1.0, 4);
    });

    it('should pairwise-delete Infinity values from input', () => {
      const input: CrossSourceCorrelationInput = {
        x: [1, Infinity, 3, 4, 5],
        y: [2, 4, -Infinity, 8, 10],
        dates: makeDates(5),
        method: 'pearson',
      };

      const result = computeCorrelation(input);

      // Indices 0, 3, 4 survive
      expect(result.n).toBe(3);
      expect(Number.isFinite(result.r)).toBe(true);
    });

    it('should produce valid confidence intervals for moderate sample sizes', () => {
      const input: CrossSourceCorrelationInput = {
        x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        y: [2, 3, 5, 4, 7, 6, 9, 8, 10, 11],
        dates: makeDates(10),
        method: 'pearson',
      };

      const result = computeCorrelation(input);

      expect(result.ci95Lower).toBeLessThan(result.r);
      expect(result.ci95Upper).toBeGreaterThan(result.r);
      expect(result.ci95Lower).toBeGreaterThanOrEqual(-1);
      expect(result.ci95Upper).toBeLessThanOrEqual(1);
    });
  });

  describe('Spearman method', () => {
    it('should detect perfect monotonic positive relationship', () => {
      const input: CrossSourceCorrelationInput = {
        x: [1, 2, 3, 4, 5],
        y: [10, 20, 30, 40, 50],
        dates: makeDates(5),
        method: 'spearman',
      };

      const result = computeCorrelation(input);

      expect(result.r).toBeCloseTo(1.0, 4);
      expect(result.method).toBe('spearman');
    });

    it('should produce valid result with tied values', () => {
      const input: CrossSourceCorrelationInput = {
        x: [1, 2, 2, 3, 4],
        y: [5, 5, 6, 7, 8],
        dates: makeDates(5),
        method: 'spearman',
      };

      const result = computeCorrelation(input);

      expect(Number.isFinite(result.r)).toBe(true);
      expect(result.r).toBeGreaterThan(0);
      expect(result.n).toBe(5);
      expect(result.method).toBe('spearman');
    });

    it('should detect perfect monotonic negative relationship', () => {
      const input: CrossSourceCorrelationInput = {
        x: [1, 2, 3, 4, 5],
        y: [50, 40, 30, 20, 10],
        dates: makeDates(5),
        method: 'spearman',
      };

      const result = computeCorrelation(input);

      expect(result.r).toBeCloseTo(-1.0, 4);
      expect(result.direction).toBe('negative');
    });
  });
});

// ---------------------------------------------------------------------------
// 2. computeBlandAltman
// ---------------------------------------------------------------------------

describe('computeBlandAltman', () => {
  it('should compute correct bias and limits of agreement for known values', () => {
    const input: BlandAltmanInput = {
      method1: [10, 12, 14, 16, 18],
      method2: [9, 11, 15, 15, 19],
      dates: makeDates(5),
      method1Label: 'CPAP SpO2',
      method2Label: 'Fitbit SpO2',
    };

    const result = computeBlandAltman(input);

    // Differences: [1, 1, -1, 1, -1] => mean = 0.2
    expect(result.meanDifference).toBeCloseTo(0.2, 4);
    expect(result.n).toBe(5);

    // SD of differences: sqrt(((0.8^2 + 0.8^2 + 1.2^2 + 0.8^2 + 1.2^2) / 4))
    // = sqrt((0.64 + 0.64 + 1.44 + 0.64 + 1.44) / 4) = sqrt(4.8 / 4) = sqrt(1.2)
    expect(result.sdDifference).toBeCloseTo(Math.sqrt(1.2), 4);

    // Limits of agreement
    const expectedSD = Math.sqrt(1.2);
    expect(result.upperLimit).toBeCloseTo(0.2 + 1.96 * expectedSD, 3);
    expect(result.lowerLimit).toBeCloseTo(0.2 - 1.96 * expectedSD, 3);
  });

  it('should produce 5 points with correct mean/difference pairs', () => {
    const input: BlandAltmanInput = {
      method1: [10, 12, 14, 16, 18],
      method2: [9, 11, 15, 15, 19],
      dates: makeDates(5),
      method1Label: 'M1',
      method2Label: 'M2',
    };

    const result = computeBlandAltman(input);

    expect(result.points).toHaveLength(5);

    // Point 0: mean=(10+9)/2=9.5, diff=10-9=1
    expect(result.points[0]?.mean).toBeCloseTo(9.5, 4);
    expect(result.points[0]?.difference).toBeCloseTo(1, 4);

    // Point 2: mean=(14+15)/2=14.5, diff=14-15=-1
    expect(result.points[2]?.mean).toBeCloseTo(14.5, 4);
    expect(result.points[2]?.difference).toBeCloseTo(-1, 4);

    // Point 4: mean=(18+19)/2=18.5, diff=18-19=-1
    expect(result.points[4]?.mean).toBeCloseTo(18.5, 4);
    expect(result.points[4]?.difference).toBeCloseTo(-1, 4);
  });

  it('should produce zero bias and zero SD when measurements are identical', () => {
    const values = [10, 12, 14, 16, 18];
    const input: BlandAltmanInput = {
      method1: values,
      method2: [...values],
      dates: makeDates(5),
      method1Label: 'M1',
      method2Label: 'M2',
    };

    const result = computeBlandAltman(input);

    expect(result.meanDifference).toBeCloseTo(0, 10);
    expect(result.sdDifference).toBeCloseTo(0, 10);
    expect(result.upperLimit).toBeCloseTo(0, 10);
    expect(result.lowerLimit).toBeCloseTo(0, 10);
    expect(result.n).toBe(5);
  });

  it('should test proportional bias via regression of differences on means', () => {
    // Create data where disagreement grows with the measured value
    // method1 is always 10% higher than method2 => proportional bias
    const method2 = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const method1 = method2.map((v) => v * 1.1);

    const input: BlandAltmanInput = {
      method1,
      method2,
      dates: makeDates(10),
      method1Label: 'M1',
      method2Label: 'M2',
    };

    const result = computeBlandAltman(input);

    // The slope should be positive (differences increase with mean)
    expect(result.proportionalBias.slope).toBeGreaterThan(0);
    // With such a clear proportional bias, p should be significant
    expect(result.proportionalBias.isSignificant).toBe(true);
    expect(result.proportionalBias.pValue).toBeLessThan(0.05);
  });

  it('should return degenerate result for empty arrays', () => {
    const input: BlandAltmanInput = {
      method1: [],
      method2: [],
      dates: [],
      method1Label: 'M1',
      method2Label: 'M2',
    };

    const result = computeBlandAltman(input);

    expect(result.n).toBe(0);
    expect(result.meanDifference).toBeNaN();
    expect(result.sdDifference).toBeNaN();
    expect(result.upperLimit).toBeNaN();
    expect(result.lowerLimit).toBeNaN();
    expect(result.points).toHaveLength(0);
  });

  it('should return degenerate result for fewer than 3 valid pairs', () => {
    const input: BlandAltmanInput = {
      method1: [10, 20],
      method2: [11, 21],
      dates: makeDates(2),
      method1Label: 'M1',
      method2Label: 'M2',
    };

    const result = computeBlandAltman(input);

    expect(result.n).toBe(2);
    expect(result.meanDifference).toBeNaN();
    expect(result.points).toHaveLength(0);
  });

  it('should pairwise-delete NaN values', () => {
    const input: BlandAltmanInput = {
      method1: [10, NaN, 14, 16, 18],
      method2: [9, 11, 15, NaN, 19],
      dates: makeDates(5),
      method1Label: 'M1',
      method2Label: 'M2',
    };

    const result = computeBlandAltman(input);

    // Only indices 0, 2, 4 survive: method1=[10,14,18], method2=[9,15,19]
    expect(result.n).toBe(3);
    // Differences: [1, -1, -1] => mean = -1/3
    expect(result.meanDifference).toBeCloseTo(-1 / 3, 4);
  });
});

// ---------------------------------------------------------------------------
// 3. computePartialCorrelationCrossSrc
// ---------------------------------------------------------------------------

describe('computePartialCorrelationCrossSrc', () => {
  it('should return the same as Pearson when no controls are provided', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
    const dates = makeDates(10);

    const partialInput: PartialCorrelationInput = {
      x,
      y,
      controls: {},
      dates,
    };

    const partialResult = computePartialCorrelationCrossSrc(partialInput);

    const pearsonResult = computeCorrelation({
      x,
      y,
      dates,
      method: 'pearson',
    });

    expect(partialResult.r).toBeCloseTo(pearsonResult.r, 4);
    expect(partialResult.n).toBe(pearsonResult.n);
    expect(partialResult.controlledFor).toEqual([]);
  });

  it('should attenuate correlation when controlling for a confounder', () => {
    // x and y both correlate with z, which inflates their apparent correlation.
    // Controlling for z should reduce |r|.
    const z = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const x = z.map((v) => v * 2 + Math.sin(v)); // strongly correlated with z
    const y = z.map((v) => v * 3 + Math.cos(v)); // strongly correlated with z
    const dates = makeDates(10);

    const rawResult = computePartialCorrelationCrossSrc({
      x,
      y,
      controls: {},
      dates,
    });

    const controlledResult = computePartialCorrelationCrossSrc({
      x,
      y,
      controls: { usage_hours: z },
      dates,
    });

    // After controlling for z, the residual correlation should be weaker
    expect(Math.abs(controlledResult.r)).toBeLessThanOrEqual(Math.abs(rawResult.r) + 0.01);
    expect(controlledResult.controlledFor).toEqual(['usage_hours']);
  });

  it('should return named controls in controlledFor', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
    const dates = makeDates(10);

    const result = computePartialCorrelationCrossSrc({
      x,
      y,
      controls: {
        leak_rate: [3, 3, 4, 4, 5, 5, 6, 6, 7, 7],
        pressure: [10, 10, 11, 11, 12, 12, 13, 13, 14, 14],
      },
      dates,
    });

    expect(result.controlledFor).toContain('leak_rate');
    expect(result.controlledFor).toContain('pressure');
    expect(result.controlledFor).toHaveLength(2);
  });

  it('should return valid confidence intervals', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [2, 3, 5, 4, 7, 6, 9, 8, 10, 11];
    const dates = makeDates(10);

    const result = computePartialCorrelationCrossSrc({
      x,
      y,
      controls: {
        z: [5, 4, 6, 3, 7, 2, 8, 1, 9, 0],
      },
      dates,
    });

    expect(Number.isFinite(result.r)).toBe(true);
    expect(Number.isFinite(result.pValue)).toBe(true);
    // CI should bracket r
    if (Number.isFinite(result.ci95Lower) && Number.isFinite(result.ci95Upper)) {
      expect(result.ci95Lower).toBeLessThanOrEqual(result.r + 0.001);
      expect(result.ci95Upper).toBeGreaterThanOrEqual(result.r - 0.001);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. computeLaggedCrossCorrelation
// ---------------------------------------------------------------------------

describe('computeLaggedCrossCorrelation', () => {
  it('should identify the correct best lag for a shifted signal', () => {
    // Create two distinct signals where the cross-correlation peaks at a known lag.
    // y has a spike at index 5, x has a spike at index 8 (shifted by 3).
    //
    // CCF convention: for lag k, xStart = max(0,k) and yStart = max(0,-k).
    // Positive lag k means y leads x by k days (i.e., y's pattern appears first).
    // Here y leads x by 3 days, so the peak should be at lag +3.
    const n = 30;
    const x = new Array(n).fill(0);
    const y = new Array(n).fill(0);
    // Place a distinctive pattern in y at indices 5-9 (earlier)
    for (let i = 5; i < 10; i++) y[i] = 10;
    // Place the same pattern in x at indices 8-12 (later, shifted by +3)
    for (let i = 8; i < 13; i++) x[i] = 10;

    const input: LaggedCrossSourceCorrelationInput = {
      x,
      y,
      maxLag: 7,
      dates: makeDates(n),
    };

    const result = computeLaggedCrossCorrelation(input);

    // y leads x by 3 days => bestLag should be +3
    expect(result.bestLag).toBe(3);
    expect(result.bestCCF).toBeGreaterThan(0);
  });

  it('should generate a non-empty interpretation string', () => {
    const input: LaggedCrossSourceCorrelationInput = {
      x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      y: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
      dates: makeDates(10),
    };

    const result = computeLaggedCrossCorrelation(input);

    expect(result.interpretation).toBeTruthy();
    expect(typeof result.interpretation).toBe('string');
    expect(result.interpretation.length).toBeGreaterThan(0);
  });

  it('should default maxLag to 7', () => {
    const input: LaggedCrossSourceCorrelationInput = {
      x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      y: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40],
      dates: makeDates(20),
    };

    const result = computeLaggedCrossCorrelation(input);

    // Lags should span from -7 to +7 => 15 elements
    expect(result.lags.length).toBe(15);
    expect(result.lags[0]).toBe(-7);
    expect(result.lags[result.lags.length - 1]).toBe(7);
  });

  it('should provide a significance bound based on sample size', () => {
    const n = 100;
    const input: LaggedCrossSourceCorrelationInput = {
      x: Array.from({ length: n }, (_, i) => Math.sin(i)),
      y: Array.from({ length: n }, (_, i) => Math.cos(i)),
      maxLag: 5,
      dates: makeDates(n),
    };

    const result = computeLaggedCrossCorrelation(input);

    expect(result.significanceBound).toBeCloseTo(1.96 / Math.sqrt(n), 4);
  });

  it('should produce symmetric lags array', () => {
    const input: LaggedCrossSourceCorrelationInput = {
      x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      y: [2, 3, 5, 4, 6, 7, 9, 8, 10, 11],
      maxLag: 3,
      dates: makeDates(10),
    };

    const result = computeLaggedCrossCorrelation(input);

    expect(result.lags.length).toBe(7); // -3..+3
    expect(result.lags[0]).toBe(-3);
    expect(result.lags[6]).toBe(3);
    expect(result.ccf.length).toBe(result.lags.length);
  });

  it('should return empty results for insufficient data', () => {
    const input: LaggedCrossSourceCorrelationInput = {
      x: [1, 2],
      y: [3, 4],
      dates: makeDates(2),
    };

    const result = computeLaggedCrossCorrelation(input);

    expect(result.lags).toHaveLength(0);
    expect(result.ccf).toHaveLength(0);
    // Interpretation should indicate insufficient data
    expect(result.interpretation).toContain('Insufficient');
  });
});

// ---------------------------------------------------------------------------
// 5. correlateDataSources
// ---------------------------------------------------------------------------

describe('correlateDataSources', () => {
  it('should compute a correlation matrix for two overlapping days', () => {
    const cpapData: CpapDailyRecord[] = [
      makeCpapRecord('2025-01-01', { ahi: 5.0, usageHours: 7.0 }),
      makeCpapRecord('2025-01-02', { ahi: 8.0, usageHours: 6.0 }),
      makeCpapRecord('2025-01-03', { ahi: 3.0, usageHours: 8.0 }),
      makeCpapRecord('2025-01-04', { ahi: 6.0, usageHours: 7.5 }),
      makeCpapRecord('2025-01-05', { ahi: 4.0, usageHours: 7.2 }),
    ];

    const wearableData = {
      'Sleep Score': [
        { date: '2025-01-01', value: 80 },
        { date: '2025-01-02', value: 70 },
        { date: '2025-01-03', value: 90 },
        { date: '2025-01-04', value: 75 },
        { date: '2025-01-05', value: 85 },
      ],
    };

    const input: CorrelateDataSourcesInput = {
      cpapData,
      wearableData,
      method: 'pearson',
    };

    const result = correlateDataSources(input);

    expect(result.n).toBe(5);
    expect(result.cpapMetrics.length).toBeGreaterThan(0);
    expect(result.wearableMetrics).toContain('Sleep Score');
    expect(result.matrix.length).toBe(result.cpapMetrics.length);
    // Each row should have one column (one wearable metric)
    for (const row of result.matrix) {
      expect(row.length).toBe(1);
    }
  });

  it('should return empty matrix when no dates overlap', () => {
    const cpapData: CpapDailyRecord[] = [
      makeCpapRecord('2025-01-01'),
      makeCpapRecord('2025-01-02'),
      makeCpapRecord('2025-01-03'),
    ];

    const wearableData = {
      'Resting HR': [
        { date: '2025-02-01', value: 60 },
        { date: '2025-02-02', value: 62 },
        { date: '2025-02-03', value: 61 },
      ],
    };

    const input: CorrelateDataSourcesInput = {
      cpapData,
      wearableData,
      method: 'pearson',
    };

    const result = correlateDataSources(input);

    expect(result.n).toBe(0);
    expect(result.matrix).toHaveLength(0);
    expect(result.significantPairs).toHaveLength(0);
  });

  it('should sort significant pairs by |r| descending', () => {
    // Create data with two wearable metrics that have different |r| with AHI
    const cpapData: CpapDailyRecord[] = Array.from({ length: 10 }, (_, i) =>
      makeCpapRecord(`2025-01-${String(i + 1).padStart(2, '0')}`, {
        ahi: i + 1,
        pressureMean: 10 + i * 0.5,
        pressure95th: 12 + i * 0.5,
        leakMedian: 2,
        leak95th: 5,
        usageHours: 7,
        ahiObstructive: (i + 1) * 0.6,
        ahiCentral: (i + 1) * 0.3,
      }),
    );

    const wearableData = {
      // Perfectly correlated with AHI
      'Perfect Metric': Array.from({ length: 10 }, (_, i) => ({
        date: `2025-01-${String(i + 1).padStart(2, '0')}`,
        value: (i + 1) * 10,
      })),
      // Weakly correlated noise
      'Noisy Metric': Array.from({ length: 10 }, (_, i) => ({
        date: `2025-01-${String(i + 1).padStart(2, '0')}`,
        value: Math.sin(i) * 10 + 50,
      })),
    };

    const input: CorrelateDataSourcesInput = {
      cpapData,
      wearableData,
      method: 'pearson',
    };

    const result = correlateDataSources(input);

    // Significant pairs should be sorted by |r| descending
    for (let i = 1; i < result.significantPairs.length; i++) {
      const prev = result.significantPairs[i - 1];
      const curr = result.significantPairs[i];
      expect(Math.abs(prev!.r)).toBeGreaterThanOrEqual(Math.abs(curr!.r));
    }
  });

  it('should exclude optional CPAP metrics when they are undefined', () => {
    const cpapData: CpapDailyRecord[] = Array.from({ length: 5 }, (_, i) =>
      makeCpapRecord(`2025-01-${String(i + 1).padStart(2, '0')}`, {
        ahi: i + 1,
        // respiratoryRateMedian is NOT set (undefined)
      }),
    );

    const wearableData = {
      HR: Array.from({ length: 5 }, (_, i) => ({
        date: `2025-01-${String(i + 1).padStart(2, '0')}`,
        value: 60 + i,
      })),
    };

    const input: CorrelateDataSourcesInput = {
      cpapData,
      wearableData,
      method: 'pearson',
    };

    const result = correlateDataSources(input);

    // Optional metrics like 'Respiratory Rate' should NOT appear if all undefined
    expect(result.cpapMetrics).not.toContain('Respiratory Rate');
    expect(result.cpapMetrics).not.toContain('Tidal Volume');
    expect(result.cpapMetrics).not.toContain('Minute Ventilation');

    // Required metrics should still appear
    expect(result.cpapMetrics).toContain('AHI');
    expect(result.cpapMetrics).toContain('Usage Hours');
  });

  it('should include optional CPAP metrics when they have sufficient data', () => {
    const cpapData: CpapDailyRecord[] = Array.from({ length: 5 }, (_, i) =>
      makeCpapRecord(`2025-01-${String(i + 1).padStart(2, '0')}`, {
        ahi: i + 1,
        respiratoryRateMedian: 14 + i * 0.5,
      }),
    );

    const wearableData = {
      HR: Array.from({ length: 5 }, (_, i) => ({
        date: `2025-01-${String(i + 1).padStart(2, '0')}`,
        value: 60 + i,
      })),
    };

    const input: CorrelateDataSourcesInput = {
      cpapData,
      wearableData,
      method: 'pearson',
    };

    const result = correlateDataSources(input);

    expect(result.cpapMetrics).toContain('Respiratory Rate');
  });

  it('should handle Spearman method', () => {
    const cpapData: CpapDailyRecord[] = Array.from({ length: 5 }, (_, i) =>
      makeCpapRecord(`2025-01-${String(i + 1).padStart(2, '0')}`, {
        ahi: i + 1,
      }),
    );

    const wearableData = {
      HR: Array.from({ length: 5 }, (_, i) => ({
        date: `2025-01-${String(i + 1).padStart(2, '0')}`,
        value: 60 + i,
      })),
    };

    const input: CorrelateDataSourcesInput = {
      cpapData,
      wearableData,
      method: 'spearman',
    };

    const result = correlateDataSources(input);

    expect(result.n).toBe(5);
    expect(result.matrix.length).toBeGreaterThan(0);
  });

  it('should filter out non-finite wearable values', () => {
    const cpapData: CpapDailyRecord[] = Array.from({ length: 5 }, (_, i) =>
      makeCpapRecord(`2025-01-${String(i + 1).padStart(2, '0')}`, {
        ahi: i + 1,
      }),
    );

    const wearableData = {
      'Bad Metric': [
        { date: '2025-01-01', value: NaN },
        { date: '2025-01-02', value: Infinity },
        { date: '2025-01-03', value: 10 },
        { date: '2025-01-04', value: 20 },
        { date: '2025-01-05', value: 30 },
      ],
    };

    const input: CorrelateDataSourcesInput = {
      cpapData,
      wearableData,
      method: 'pearson',
    };

    const result = correlateDataSources(input);

    // NaN and Infinity values are excluded during wearable map building,
    // so only dates with finite wearable values appear in the overlap.
    // That means n = 3 (dates 03, 04, 05).
    expect(result.n).toBe(3);
    expect(result.matrix.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. extractWearableMetricSeries
// ---------------------------------------------------------------------------

describe('extractWearableMetricSeries', () => {
  it('should extract a top-level metric from daily summaries', () => {
    const summaries: IntegrationDailySummary<'sleep_score'>[] = [
      {
        id: '1',
        source: 'fitbit',
        dataType: 'sleep_score',
        date: '2025-01-01',
        data: {
          overallScore: 85,
          compositionScore: 20,
          revitalizationScore: 25,
          durationScore: 30,
          deepSleepMinutes: 60,
          restingHeartRate: 55,
          restlessnessScore: 10,
        },
        importedAt: '2025-01-02T00:00:00Z',
      },
      {
        id: '2',
        source: 'fitbit',
        dataType: 'sleep_score',
        date: '2025-01-02',
        data: {
          overallScore: 90,
          compositionScore: 22,
          revitalizationScore: 28,
          durationScore: 32,
          deepSleepMinutes: 65,
          restingHeartRate: 53,
          restlessnessScore: 8,
        },
        importedAt: '2025-01-03T00:00:00Z',
      },
    ];

    const result = extractWearableMetricSeries(summaries, 'sleep_score', 'overallScore');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ date: '2025-01-01', value: 85 });
    expect(result[1]).toEqual({ date: '2025-01-02', value: 90 });
  });

  it('should extract a nested metric using dot-separated path', () => {
    const summaries: IntegrationDailySummary<'sleep_session'>[] = [
      {
        id: '1',
        source: 'fitbit',
        dataType: 'sleep_session',
        date: '2025-01-01',
        data: {
          startTime: '2025-01-01T22:00:00',
          endTime: '2025-01-02T06:00:00',
          durationMs: 28800000,
          efficiency: 90,
          minutesAsleep: 420,
          minutesAwake: 60,
          timeInBed: 480,
          type: 'stages' as const,
          stages: { deep: 90, light: 200, rem: 100, wake: 30 },
          isMainSleep: true,
        },
        importedAt: '2025-01-02T12:00:00Z',
      },
    ];

    const result = extractWearableMetricSeries(summaries, 'sleep_session', 'stages.deep');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ date: '2025-01-01', value: 90 });
  });

  it('should filter out non-finite values', () => {
    const summaries: IntegrationDailySummary<'sleep_score'>[] = [
      {
        id: '1',
        source: 'fitbit',
        dataType: 'sleep_score',
        date: '2025-01-01',
        data: {
          overallScore: NaN,
          compositionScore: 20,
          revitalizationScore: 25,
          durationScore: 30,
          deepSleepMinutes: 60,
          restingHeartRate: 55,
          restlessnessScore: 10,
        },
        importedAt: '2025-01-02T00:00:00Z',
      },
      {
        id: '2',
        source: 'fitbit',
        dataType: 'sleep_score',
        date: '2025-01-02',
        data: {
          overallScore: 85,
          compositionScore: 22,
          revitalizationScore: 28,
          durationScore: 32,
          deepSleepMinutes: 65,
          restingHeartRate: 53,
          restlessnessScore: 8,
        },
        importedAt: '2025-01-03T00:00:00Z',
      },
    ];

    const result = extractWearableMetricSeries(summaries, 'sleep_score', 'overallScore');

    // First summary's overallScore is NaN, should be excluded
    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBe(85);
  });

  it('should filter by dataType', () => {
    // Mix of sleep_score and hrv_daily summaries — only sleep_score should be extracted
    const summaries = [
      {
        id: '1',
        source: 'fitbit' as const,
        dataType: 'sleep_score' as const,
        date: '2025-01-01',
        data: {
          overallScore: 85,
          compositionScore: 20,
          revitalizationScore: 25,
          durationScore: 30,
          deepSleepMinutes: 60,
          restingHeartRate: 55,
          restlessnessScore: 10,
        },
        importedAt: '2025-01-02T00:00:00Z',
      },
      {
        id: '2',
        source: 'fitbit' as const,
        dataType: 'hrv_daily' as const,
        date: '2025-01-01',
        data: {
          dailyRmssd: 40,
          deepRmssd: 50,
          nremHeartRate: 55,
          entropy: null,
        },
        importedAt: '2025-01-02T00:00:00Z',
      },
    ];

    // Extract only sleep_score type even though hrv_daily also has data
    const result = extractWearableMetricSeries(
      summaries as IntegrationDailySummary[],
      'sleep_score',
      'overallScore',
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBe(85);
  });

  it('should return an empty array when no summaries match the dataType', () => {
    const summaries: IntegrationDailySummary<'sleep_score'>[] = [
      {
        id: '1',
        source: 'fitbit',
        dataType: 'sleep_score',
        date: '2025-01-01',
        data: {
          overallScore: 85,
          compositionScore: 20,
          revitalizationScore: 25,
          durationScore: 30,
          deepSleepMinutes: 60,
          restingHeartRate: 55,
          restlessnessScore: 10,
        },
        importedAt: '2025-01-02T00:00:00Z',
      },
    ];

    const result = extractWearableMetricSeries(
      summaries as IntegrationDailySummary[],
      'hrv_daily',
      'dailyRmssd',
    );

    expect(result).toHaveLength(0);
  });

  it('should return an empty array for empty input', () => {
    const result = extractWearableMetricSeries([], 'sleep_score', 'overallScore');
    expect(result).toHaveLength(0);
  });

  it('should sort results by date ascending', () => {
    const summaries: IntegrationDailySummary<'sleep_score'>[] = [
      {
        id: '2',
        source: 'fitbit',
        dataType: 'sleep_score',
        date: '2025-01-03',
        data: {
          overallScore: 90,
          compositionScore: 22,
          revitalizationScore: 28,
          durationScore: 32,
          deepSleepMinutes: 65,
          restingHeartRate: 53,
          restlessnessScore: 8,
        },
        importedAt: '2025-01-04T00:00:00Z',
      },
      {
        id: '1',
        source: 'fitbit',
        dataType: 'sleep_score',
        date: '2025-01-01',
        data: {
          overallScore: 85,
          compositionScore: 20,
          revitalizationScore: 25,
          durationScore: 30,
          deepSleepMinutes: 60,
          restingHeartRate: 55,
          restlessnessScore: 10,
        },
        importedAt: '2025-01-02T00:00:00Z',
      },
    ];

    const result = extractWearableMetricSeries(summaries, 'sleep_score', 'overallScore');

    expect(result).toHaveLength(2);
    expect(result[0]?.date).toBe('2025-01-01');
    expect(result[1]?.date).toBe('2025-01-03');
  });

  it('should return empty when metric path does not resolve to a number', () => {
    const summaries: IntegrationDailySummary<'sleep_score'>[] = [
      {
        id: '1',
        source: 'fitbit',
        dataType: 'sleep_score',
        date: '2025-01-01',
        data: {
          overallScore: 85,
          compositionScore: 20,
          revitalizationScore: 25,
          durationScore: 30,
          deepSleepMinutes: 60,
          restingHeartRate: 55,
          restlessnessScore: 10,
        },
        importedAt: '2025-01-02T00:00:00Z',
      },
    ];

    // Path that doesn't exist in the data payload
    const result = extractWearableMetricSeries(summaries, 'sleep_score', 'nonexistent.path');

    expect(result).toHaveLength(0);
  });
});
