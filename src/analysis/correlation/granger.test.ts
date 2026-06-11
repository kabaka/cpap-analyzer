import { describe, it, expect } from 'vitest';
import { grangerCausality, type GrangerCausalityResult } from '@/analysis/correlation/granger';

describe('grangerCausality', () => {
  // -----------------------------------------------------------------------
  // Happy-path: clear causal relationship
  // -----------------------------------------------------------------------

  describe('X causes Y (y ≈ 0.8 * x lagged by 1, with noise)', () => {
    // Non-monotonic x so that lagged y is a poor predictor, but lagged x is strong
    const x = [2, 5, 1, 4, 3, 5, 1, 4, 2, 3, 5, 1, 4, 2, 5, 3, 1, 4, 2, 5];
    // y[t] ≈ 0.8 * x[t-1] + small noise
    const y = [
      2.0, 1.8, 3.9, 1.1, 3.0, 2.5, 4.2, 0.7, 3.5, 1.4, 2.5, 3.7, 1.0, 3.1, 1.9, 3.8, 2.5, 0.7, 3.4,
      1.3,
    ];

    it('should detect causality with a low p-value', () => {
      const result = grangerCausality(x, y, 1);

      expect(result.pValue).toBeLessThan(0.05);
    });

    it('should classify causality involving X→Y', () => {
      const result = grangerCausality(x, y, 1);

      // X should Granger-cause Y
      expect(['X causes Y', 'bidirectional']).toContain(result.causality);
    });

    it('should report a positive F-statistic', () => {
      const result = grangerCausality(x, y, 1);

      expect(result.fStatistic).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // No causality: independent series
  // -----------------------------------------------------------------------

  describe('no causality (independent series)', () => {
    // Two series with strong but unrelated autoregressive structure:
    // primes and Fibonacci — both highly autocorrelated but independent
    const x = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71];
    const y = [
      1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765,
    ];

    it('should have a high p-value', () => {
      const result = grangerCausality(x, y, 1);

      expect(result.pValue).toBeGreaterThan(0.05);
    });

    it('should classify causality as "none"', () => {
      const result = grangerCausality(x, y, 1);

      expect(result.causality).toBe('none');
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('insufficient data', () => {
    it('should return NaN values when arrays are shorter than 2*maxLag + 2', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [5, 4, 3, 2, 1];
      const maxLag = 3; // needs 2*3+2 = 8 observations

      const result = grangerCausality(x, y, maxLag);

      expect(result.fStatistic).toBeNaN();
      expect(result.pValue).toBeNaN();
      expect(result.causality).toBe('none');
    });

    it('should report unavailableReason "insufficient-data" with nPaired = finite-paired count', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [5, 4, 3, 2, 1];
      const maxLag = 3; // needs 2*3+2 = 8 observations; only 5 available

      const result = grangerCausality(x, y, maxLag);

      expect(result.unavailableReason).toBe('insufficient-data');
      // All 5 pairs are finite, so nPaired is the full length.
      expect(result.nPaired).toBe(5);
      expect(result.aicValues).toHaveLength(0);
    });
  });

  describe('empty arrays', () => {
    it('should return NaN values with causality "none"', () => {
      const result = grangerCausality([], []);

      expect(result.fStatistic).toBeNaN();
      expect(result.pValue).toBeNaN();
      expect(result.causality).toBe('none');
      expect(result.confidenceLevel).toBe('low');
    });

    it('should report unavailableReason "insufficient-data" with nPaired 0', () => {
      const result = grangerCausality([], []);

      expect(result.unavailableReason).toBe('insufficient-data');
      expect(result.nPaired).toBe(0);
    });
  });

  describe('all identical values', () => {
    it('should return causality "none" (no predictive power)', () => {
      const x = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
      const y = [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3];

      const result = grangerCausality(x, y);

      expect(result.fStatistic).toBeNaN();
      expect(result.pValue).toBeNaN();
      expect(result.causality).toBe('none');
    });

    it('should report unavailableReason "constant-series" when nights ARE sufficient (blocker regression)', () => {
      // 20 paired nights at default maxLag=7 → 2*7+2 = 16 needed, 20 available.
      // Data is plentiful; the metrics simply have zero variance. This MUST
      // report a constant-series reason, never "insufficient-data": reporting a
      // shortage of nights here would be factually wrong (the QA blocker).
      const x = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
      const y = [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3];

      const result = grangerCausality(x, y);

      expect(result.unavailableReason).toBe('constant-series');
      // Sufficiency is real: the finite-paired count clears the threshold.
      expect(result.nPaired).toBe(20);
      expect(result.nPaired).toBeGreaterThanOrEqual(2 * 7 + 2);
    });

    it('should report "constant-series" when only ONE series is constant', () => {
      // x varies, y is constant. With sufficient nights this is still a
      // zero-variance failure, not a data shortage.
      const x = [2, 5, 1, 4, 3, 5, 1, 4, 2, 3, 5, 1, 4, 2, 5, 3, 1, 4, 2, 5];
      const y = [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3];

      const result = grangerCausality(x, y);

      expect(result.unavailableReason).toBe('constant-series');
      expect(result.nPaired).toBe(20);
    });
  });

  describe('NaN in input', () => {
    it('should filter out NaN-containing pairs and still compute', () => {
      const x = [1, NaN, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
      const y = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, NaN, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

      const result = grangerCausality(x, y);

      // After filtering NaN pairs, there are 20 valid observations — enough data
      expect(result.causality).not.toBe(undefined);
      expect(['X causes Y', 'Y causes X', 'bidirectional', 'none']).toContain(result.causality);
    });

    it('should set nPaired to the finite-paired count, strictly below raw length', () => {
      // x has 22 entries (1 NaN at index 1); y has 22 entries (1 NaN at index
      // 11). filterFinitePairs aligns on the shorter length (22) and drops any
      // index where either is non-finite → indices 1 and 11 are removed → 20
      // finite pairs. nPaired must be 20, well below the 22-element raw input.
      const x = [1, NaN, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
      const y = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, NaN, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

      const result = grangerCausality(x, y);

      expect(result.nPaired).toBe(20);
      expect(result.nPaired).toBeLessThan(x.length);
      expect(result.nPaired).toBeLessThan(y.length);
    });

    it('should return NaN result when too many NaN values leave insufficient data', () => {
      const x = [1, NaN, NaN, NaN, 5];
      const y = [NaN, 2, NaN, 4, NaN];

      const result = grangerCausality(x, y);

      expect(result.causality).toBe('none');
      expect(result.fStatistic).toBeNaN();
    });

    it('should report insufficient-data with the post-filter nPaired when NaNs leave too few pairs', () => {
      // No index has both x and y finite → 0 finite pairs after filtering.
      const x = [1, NaN, NaN, NaN, 5];
      const y = [NaN, 2, NaN, 4, NaN];

      const result = grangerCausality(x, y);

      expect(result.unavailableReason).toBe('insufficient-data');
      // nPaired is the finite-paired count (0), NOT the raw length (5). This is
      // the honesty fix: the UI must report usable nights, not raw rows.
      expect(result.nPaired).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // maxLag configuration
  // -----------------------------------------------------------------------

  describe('custom maxLag', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const y = [
      0.2, 1.1, 1.8, 3.2, 3.9, 5.1, 5.8, 7.2, 7.9, 9.1, 9.8, 11.2, 12.9, 14.1, 14.8, 16.2, 16.9,
      18.1, 18.8, 19.2,
    ];

    it('should work with maxLag=3', () => {
      const result = grangerCausality(x, y, 3);

      expect(result.optimalLag).toBeGreaterThanOrEqual(1);
      expect(result.optimalLag).toBeLessThanOrEqual(3);
      expect(result.aicValues).toHaveLength(3);
    });

    it('should work with maxLag=7', () => {
      // 20 data points, 2*7+2 = 16 → enough data
      const result = grangerCausality(x, y, 7);

      expect(result.optimalLag).toBeGreaterThanOrEqual(1);
      expect(result.optimalLag).toBeLessThanOrEqual(7);
      expect(result.aicValues).toHaveLength(7);
    });
  });

  describe('default maxLag', () => {
    it('should default to maxLag=7', () => {
      const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
      const y = [
        0.2, 1.1, 1.8, 3.2, 3.9, 5.1, 5.8, 7.2, 7.9, 9.1, 9.8, 11.2, 12.9, 14.1, 14.8, 16.2, 16.9,
        18.1, 18.8, 19.2,
      ];

      const result = grangerCausality(x, y);

      expect(result.aicValues).toHaveLength(7);
    });
  });

  // -----------------------------------------------------------------------
  // Result structure validation
  // -----------------------------------------------------------------------

  describe('result structure', () => {
    // Use noisy data with explicit maxLag to ensure valid numeric results
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const y = [
      0.2, 1.1, 1.8, 3.2, 3.9, 5.1, 5.8, 7.2, 7.9, 9.1, 9.8, 11.2, 12.9, 14.1, 14.8, 16.2, 16.9,
      18.1, 18.8, 19.2,
    ];
    const maxLag = 3;

    it('should have fStatistic ≥ 0', () => {
      const result = grangerCausality(x, y, maxLag);

      expect(result.fStatistic).toBeGreaterThanOrEqual(0);
    });

    it('should have pValue in [0, 1]', () => {
      const result = grangerCausality(x, y, maxLag);

      expect(result.pValue).toBeGreaterThanOrEqual(0);
      expect(result.pValue).toBeLessThanOrEqual(1);
    });

    it('should have optimalLag ≥ 1', () => {
      const result = grangerCausality(x, y, maxLag);

      expect(result.optimalLag).toBeGreaterThanOrEqual(1);
    });

    it('should have causality as one of the 4 valid options', () => {
      const result = grangerCausality(x, y, maxLag);
      const validOptions: GrangerCausalityResult['causality'][] = [
        'X causes Y',
        'Y causes X',
        'bidirectional',
        'none',
      ];

      expect(validOptions).toContain(result.causality);
    });

    it('should have confidenceLevel as "high", "moderate", or "low"', () => {
      const result = grangerCausality(x, y, maxLag);

      expect(['high', 'moderate', 'low']).toContain(result.confidenceLevel);
    });

    it('should have aicValues array with length = maxLag', () => {
      const result = grangerCausality(x, y, maxLag);

      expect(result.aicValues).toHaveLength(maxLag);
    });

    it('should expose selectionAffected and stationarityWarning fields', () => {
      const result = grangerCausality(x, y, maxLag);

      expect(typeof result.selectionAffected).toBe('boolean');
      expect(
        result.stationarityWarning === null || typeof result.stationarityWarning === 'string',
      ).toBe(true);
    });

    it('should expose unavailableReason and nPaired fields', () => {
      const result = grangerCausality(x, y, maxLag);

      expect(['insufficient-data', 'constant-series', 'singular-fit', null]).toContain(
        result.unavailableReason,
      );
      expect(typeof result.nPaired).toBe('number');
      expect(result.nPaired).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Availability discriminant: the normal (finite) success path
  // -----------------------------------------------------------------------

  describe('unavailableReason on a normal finite result', () => {
    // Non-monotonic, mean-stationary inputs with a genuine X→Y relationship so
    // the F-statistic is finite and the test fully computes.
    const x = [2, 5, 1, 4, 3, 5, 1, 4, 2, 3, 5, 1, 4, 2, 5, 3, 1, 4, 2, 5];
    const y = [
      2.0, 1.8, 3.9, 1.1, 3.0, 2.5, 4.2, 0.7, 3.5, 1.4, 2.5, 3.7, 1.0, 3.1, 1.9, 3.8, 2.5, 0.7, 3.4,
      1.3,
    ];

    it('should set unavailableReason = null for a finite, computed result', () => {
      const result = grangerCausality(x, y, 1);

      expect(Number.isFinite(result.fStatistic)).toBe(true);
      expect(result.unavailableReason).toBeNull();
    });

    it('should set nPaired to the finite-paired count actually used', () => {
      const result = grangerCausality(x, y, 1);

      // All 20 pairs are finite → nPaired equals the input length.
      expect(result.nPaired).toBe(20);
    });
  });

  // -----------------------------------------------------------------------
  // Availability discriminant: degenerate fit (singular-fit)
  // -----------------------------------------------------------------------

  describe('unavailableReason "singular-fit" on a degenerate fit', () => {
    it('should report singular-fit when both guards pass but df2 collapses at the tested lag', () => {
      // n = 4 finite pairs, maxLag = 1: the insufficiency guard needs
      // n >= 2*1+2 = 4, so n = 4 PASSES (not < 4). Data is non-constant, so the
      // constant guard PASSES too. At lag 1 the residual df2 = nEff - 2*lag - 1
      // = (4-1) - 2 - 1 = 0 ≤ 0, so grangerOneDirection cannot form an F-stat
      // and returns NaN through the normal flow → singular-fit.
      const x = [2, 5, 1, 4];
      const y = [3, 1, 4, 2];

      const result = grangerCausality(x, y, 1);

      expect(result.nPaired).toBe(4);
      expect(result.fStatistic).toBeNaN();
      expect(result.unavailableReason).toBe('singular-fit');
    });
  });

  // -----------------------------------------------------------------------
  // Post-selection inference: selectionAffected flag
  // -----------------------------------------------------------------------

  describe('post-selection inference flagging', () => {
    // Non-monotonic, mean-stationary inputs to avoid the trend warning.
    const x = [2, 5, 1, 4, 3, 5, 1, 4, 2, 3, 5, 1, 4, 2, 5, 3, 1, 4, 2, 5];
    const y = [
      2.0, 1.8, 3.9, 1.1, 3.0, 2.5, 4.2, 0.7, 3.5, 1.4, 2.5, 3.7, 1.0, 3.1, 1.9, 3.8, 2.5, 0.7, 3.4,
      1.3,
    ];

    it('should set selectionAffected=true when the lag is AIC-selected (no fixed lag)', () => {
      const result = grangerCausality(x, y, 5);
      expect(result.selectionAffected).toBe(true);
    });

    it('should set selectionAffected=false when a fixed lag is supplied', () => {
      const result = grangerCausality(x, y, 5, { lag: 1 });
      expect(result.selectionAffected).toBe(false);
      // The reported lag must equal the fixed lag, not an AIC-selected one.
      expect(result.optimalLag).toBe(1);
    });

    it('should compute the F-test at the supplied fixed lag', () => {
      const atLag2 = grangerCausality(x, y, 5, { lag: 2 });
      expect(atLag2.optimalLag).toBe(2);
      expect(atLag2.selectionAffected).toBe(false);
      // aicValues are still reported for all candidate lags as diagnostics.
      expect(atLag2.aicValues).toHaveLength(5);
    });

    it('should ignore an out-of-range fixed lag and fall back to AIC selection', () => {
      // lag=99 > maxLag=5 is invalid → treated as unspecified.
      const result = grangerCausality(x, y, 5, { lag: 99 });
      expect(result.selectionAffected).toBe(true);
      expect(result.optimalLag).toBeGreaterThanOrEqual(1);
      expect(result.optimalLag).toBeLessThanOrEqual(5);
    });
  });

  // -----------------------------------------------------------------------
  // Stationarity guard
  // -----------------------------------------------------------------------

  describe('stationarity guard', () => {
    it('should warn when both inputs carry a strong deterministic trend', () => {
      // Two independent but strongly trending series. A shared trend is the
      // classic spurious-Granger setup, so the result must carry a warning.
      const x = Array.from({ length: 24 }, (_, i) => i + Math.sin(i));
      const y = Array.from({ length: 24 }, (_, i) => 2 * i + Math.cos(i * 1.3));

      const result = grangerCausality(x, y, 3);

      expect(result.stationarityWarning).not.toBeNull();
      expect(result.stationarityWarning).toContain('trend');
    });

    it('should not warn for mean-stationary (trendless) inputs', () => {
      // Oscillating, zero-trend inputs.
      const x = [2, 5, 1, 4, 3, 5, 1, 4, 2, 3, 5, 1, 4, 2, 5, 3, 1, 4, 2, 5, 3, 1, 4, 2];
      const y = [3, 1, 4, 2, 5, 1, 4, 2, 3, 5, 1, 4, 3, 5, 1, 4, 2, 5, 1, 4, 2, 3, 5, 1];

      const result = grangerCausality(x, y, 3);

      expect(result.stationarityWarning).toBeNull();
    });
  });
});
