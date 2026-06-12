import { describe, it, expect } from 'vitest';
import {
  METRIC_OPTIONS,
  CONFIDENCE_META,
  metricById,
  minNightsForMaxLag,
  largestFeasibleMaxLag,
  verdictText,
  formatPValue,
  rewriteStationarityWarning,
  interpretationClause,
  unavailableMessage,
  MAX_LAG_OPTIONS,
} from '@/views/Explore/grangerHelpers';

// The raw stationarity warning strings are produced by the worker in
// src/analysis/correlation/granger.ts. They are copied here VERBATIM so that
// these tests fail if either the producer (granger.ts) or the consumer
// (rewriteStationarityWarning) drifts apart.
const RAW_BOTH =
  'Both series show a significant linear trend (non-stationary); Granger results may be spurious. Consider first-differencing the inputs.';
const RAW_X =
  'Series X shows a significant linear trend (non-stationary); Granger results may be spurious. Consider first-differencing X.';
const RAW_Y =
  'Series Y shows a significant linear trend (non-stationary); Granger results may be spurious. Consider first-differencing Y.';

describe('grangerHelpers', () => {
  // -----------------------------------------------------------------------
  // Metric catalogue
  // -----------------------------------------------------------------------

  describe('METRIC_OPTIONS', () => {
    it('exposes a non-empty, frozen-shaped list of metric options', () => {
      expect(METRIC_OPTIONS.length).toBeGreaterThan(0);
    });

    it('gives every option a unique id', () => {
      const ids = METRIC_OPTIONS.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('gives every option a non-empty id, label, and unit string', () => {
      for (const opt of METRIC_OPTIONS) {
        expect(opt.id.length).toBeGreaterThan(0);
        expect(opt.label.length).toBeGreaterThan(0);
        expect(typeof opt.unit).toBe('string');
      }
    });

    it('includes the core CPAP metrics with their display labels', () => {
      const byId = Object.fromEntries(METRIC_OPTIONS.map((m) => [m.id, m]));
      expect(byId.ahi?.label).toBe('AHI');
      expect(byId.leakMedian?.label).toBe('Median Leak');
    });
  });

  describe('metricById', () => {
    it('returns the catalogue entry for a known id', () => {
      expect(metricById('ahi')).toEqual({ id: 'ahi', label: 'AHI', unit: 'events/hr' });
    });

    it('falls back to a synthetic entry (label = id, empty unit) for an unknown id', () => {
      expect(metricById('totallyMadeUp')).toEqual({
        id: 'totallyMadeUp',
        label: 'totallyMadeUp',
        unit: '',
      });
    });
  });

  // -----------------------------------------------------------------------
  // minNightsForMaxLag — the insufficient-data threshold shown in the UI
  // -----------------------------------------------------------------------

  describe('minNightsForMaxLag', () => {
    it('equals 2 * maxLag + 2 across several lags', () => {
      expect(minNightsForMaxLag(2)).toBe(6);
      expect(minNightsForMaxLag(3)).toBe(8);
      expect(minNightsForMaxLag(5)).toBe(12);
      expect(minNightsForMaxLag(7)).toBe(16);
      expect(minNightsForMaxLag(14)).toBe(30);
    });

    it('matches the formula 2 * maxLag + 2 for every offered max-lag option', () => {
      for (const lag of MAX_LAG_OPTIONS) {
        expect(minNightsForMaxLag(lag)).toBe(2 * lag + 2);
      }
    });
  });

  // -----------------------------------------------------------------------
  // largestFeasibleMaxLag — largest offered lag whose requirement fits
  // -----------------------------------------------------------------------

  describe('largestFeasibleMaxLag', () => {
    it('returns the largest offered lag whose 2*lag+2 requirement fits the sample', () => {
      // maxLag 7 needs 16 nights; with exactly 16 it should be feasible.
      expect(largestFeasibleMaxLag(16)).toBe(7);
    });

    it('handles an exact fit at the boundary', () => {
      // maxLag 5 needs exactly 12 nights.
      expect(largestFeasibleMaxLag(12)).toBe(5);
    });

    it('drops to the next-smaller lag when one night short of an exact fit', () => {
      // 11 nights is one short of supporting maxLag 5 (needs 12); maxLag 4 needs 10.
      expect(largestFeasibleMaxLag(11)).toBe(4);
    });

    it('returns the minimum offered lag (2) at the smallest sample that supports it', () => {
      // maxLag 2 needs 6 nights.
      expect(largestFeasibleMaxLag(6)).toBe(2);
    });

    it('returns null when even maxLag 2 (needs 6) does not fit', () => {
      expect(largestFeasibleMaxLag(5)).toBeNull();
      expect(largestFeasibleMaxLag(1)).toBeNull();
      expect(largestFeasibleMaxLag(0)).toBeNull();
    });

    it('returns the maximum offered lag for very large samples', () => {
      const maxOption = Math.max(...MAX_LAG_OPTIONS);
      expect(largestFeasibleMaxLag(10_000)).toBe(maxOption);
    });

    it('never exceeds the offered max-lag option set', () => {
      const maxOption = Math.max(...MAX_LAG_OPTIONS);
      for (const n of [6, 8, 12, 16, 30, 100, 1000]) {
        const result = largestFeasibleMaxLag(n);
        if (result !== null) {
          expect(MAX_LAG_OPTIONS).toContain(result as (typeof MAX_LAG_OPTIONS)[number]);
          expect(result).toBeLessThanOrEqual(maxOption);
          // The chosen lag's requirement must actually fit.
          expect(minNightsForMaxLag(result)).toBeLessThanOrEqual(n);
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // formatPValue — exact display strings
  // -----------------------------------------------------------------------

  describe('formatPValue', () => {
    it('renders tiny values as "< 0.001"', () => {
      expect(formatPValue(0.0001)).toBe('< 0.001');
      expect(formatPValue(0)).toBe('< 0.001');
      expect(formatPValue(1e-9)).toBe('< 0.001');
    });

    it('renders the 0.001 boundary at fixed precision (not the < threshold)', () => {
      // 0.001 is NOT < 0.001, so it formats with toFixed(4).
      expect(formatPValue(0.001)).toBe('0.0010');
    });

    it('renders ordinary p-values at four decimal places', () => {
      expect(formatPValue(0.05)).toBe('0.0500');
      expect(formatPValue(0.0423)).toBe('0.0423');
      expect(formatPValue(0.5)).toBe('0.5000');
      expect(formatPValue(1)).toBe('1.0000');
    });

    it('renders the em-dash sentinel for NaN and non-finite values', () => {
      expect(formatPValue(NaN)).toBe('—');
      expect(formatPValue(Infinity)).toBe('—');
      expect(formatPValue(-Infinity)).toBe('—');
    });
  });

  // -----------------------------------------------------------------------
  // verdictText — uses real labels, correct direction, all four cases
  // -----------------------------------------------------------------------

  describe('verdictText', () => {
    const X = 'Median Leak';
    const Y = 'AHI';

    it('phrases "X causes Y" with X before Y', () => {
      expect(verdictText('X causes Y', X, Y)).toBe('Median Leak Granger-causes AHI');
    });

    it('phrases "Y causes X" with Y before X', () => {
      expect(verdictText('Y causes X', X, Y)).toBe('AHI Granger-causes Median Leak');
    });

    it('phrases bidirectional with both labels present', () => {
      const text = verdictText('bidirectional', X, Y);
      expect(text).toBe('Bidirectional Granger causality between Median Leak and AHI');
      expect(text).toContain(X);
      expect(text).toContain(Y);
    });

    it('phrases "none" without raw placeholders', () => {
      expect(verdictText('none', X, Y)).toBe('No Granger causality detected');
    });

    it('never leaks the generic "X"/"Y" placeholders in directional verdicts', () => {
      for (const c of ['X causes Y', 'Y causes X', 'bidirectional'] as const) {
        const text = verdictText(c, X, Y);
        expect(text).not.toMatch(/\bGranger-causes [XY]\b/);
      }
    });
  });

  // -----------------------------------------------------------------------
  // rewriteStationarityWarning — the honesty story (labels, not "Series X/Y")
  // -----------------------------------------------------------------------

  describe('rewriteStationarityWarning', () => {
    const X = 'Median Leak';
    const Y = 'AHI';

    it('rewrites the "Series X" warning to use the X label and drops "Series X"', () => {
      const out = rewriteStationarityWarning(RAW_X, X, Y);
      expect(out).toContain(X);
      expect(out).not.toContain('Series X');
      // "first-differencing X" should become "first-differencing <X label>".
      expect(out).toContain(`first-differencing ${X}`);
      expect(out).not.toMatch(/first-differencing X\b/);
    });

    it('rewrites the "Series Y" warning to use the Y label and drops "Series Y"', () => {
      const out = rewriteStationarityWarning(RAW_Y, X, Y);
      expect(out).toContain(Y);
      expect(out).not.toContain('Series Y');
      expect(out).toContain(`first-differencing ${Y}`);
      expect(out).not.toMatch(/first-differencing Y\b/);
    });

    it('rewrites the "Both series" warning to "Both metrics"', () => {
      const out = rewriteStationarityWarning(RAW_BOTH, X, Y);
      expect(out).toContain('Both metrics');
      expect(out).not.toContain('Both series');
    });

    it('appends the fixed spurious-causality advisory to every rewrite', () => {
      const advisory =
        'A shared trend in two unrelated series can manufacture spurious Granger causality.';
      for (const raw of [RAW_X, RAW_Y, RAW_BOTH]) {
        expect(rewriteStationarityWarning(raw, X, Y)).toContain(advisory);
      }
    });

    it('never leaks the generic "Series X" / "Series Y" tokens for any raw warning', () => {
      for (const raw of [RAW_X, RAW_Y, RAW_BOTH]) {
        const out = rewriteStationarityWarning(raw, X, Y);
        expect(out).not.toContain('Series X');
        expect(out).not.toContain('Series Y');
      }
    });
  });

  // -----------------------------------------------------------------------
  // interpretationClause — dynamic clause per direction, labels substituted
  // -----------------------------------------------------------------------

  describe('interpretationClause', () => {
    const X = 'Median Leak';
    const Y = 'AHI';

    it('describes X→Y prediction at the given lag', () => {
      const out = interpretationClause('X causes Y', X, Y, 3);
      expect(out).toContain(`past ${X}`);
      expect(out).toContain(`prediction of ${Y}`);
      expect(out).toContain('3-night lag');
    });

    it('describes Y→X prediction', () => {
      const out = interpretationClause('Y causes X', X, Y, 3);
      expect(out).toContain(`past ${Y}`);
      expect(out).toContain(`prediction of ${X}`);
    });

    it('describes bidirectional as mutual prediction / feedback', () => {
      const out = interpretationClause('bidirectional', X, Y, 3);
      expect(out).toContain('each metric helps predict the other');
    });

    it('describes "none" as neither metric improving prediction', () => {
      const out = interpretationClause('none', X, Y, 3);
      expect(out).toContain('neither metric');
    });
  });

  // -----------------------------------------------------------------------
  // CONFIDENCE_META — label text and dot glyphs per confidence level
  // -----------------------------------------------------------------------

  describe('CONFIDENCE_META', () => {
    it('maps high confidence to its label, three filled dots, and class', () => {
      expect(CONFIDENCE_META.high).toEqual({
        dots: '●●●',
        label: 'High confidence',
        className: 'confHigh',
      });
    });

    it('maps moderate confidence to its label, two filled dots, and class', () => {
      expect(CONFIDENCE_META.moderate).toEqual({
        dots: '●●○',
        label: 'Moderate confidence',
        className: 'confModerate',
      });
    });

    it('maps low confidence to its label, one filled dot, and class', () => {
      expect(CONFIDENCE_META.low).toEqual({
        dots: '●○○',
        label: 'Low confidence',
        className: 'confLow',
      });
    });

    it('uses a descending count of filled dots from high to low', () => {
      const filled = (s: string) => (s.match(/●/g) ?? []).length;
      expect(filled(CONFIDENCE_META.high.dots)).toBe(3);
      expect(filled(CONFIDENCE_META.moderate.dots)).toBe(2);
      expect(filled(CONFIDENCE_META.low.dots)).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // unavailableMessage — heading/body copy keyed by unavailableReason
  // -----------------------------------------------------------------------

  describe('unavailableMessage', () => {
    const X = 'Median Leak';
    const Y = 'AHI';

    describe('insufficient-data', () => {
      it('uses the exact heading depended on by the e2e suite', () => {
        // tests/e2e/granger-causality.spec.ts asserts this exact substring, so
        // assert it verbatim here too — a copy drift breaks this test.
        const { heading } = unavailableMessage('insufficient-data', {
          xLabel: X,
          yLabel: Y,
          maxLag: 7,
          nPaired: 10,
        });
        expect(heading).toBe('Not enough nights for this test');
      });

      it('reports the required night count (2*maxLag+2) and the available count, with both labels', () => {
        const maxLag = 7;
        const nPaired = 10;
        const { body } = unavailableMessage('insufficient-data', {
          xLabel: X,
          yLabel: Y,
          maxLag,
          nPaired,
        });
        // Required nights come from minNightsForMaxLag (2*7+2 = 16).
        expect(body).toContain(String(minNightsForMaxLag(maxLag)));
        expect(body).toContain('16');
        // Available paired count is shown verbatim.
        expect(body).toContain(String(nPaired));
        // The chosen max lag is referenced.
        expect(body).toContain(String(maxLag));
        // Both metric labels appear.
        expect(body).toContain(X);
        expect(body).toContain(Y);
      });

      it('recomputes the required night count for a different max lag / available combo', () => {
        const maxLag = 3;
        const nPaired = 5;
        const { body } = unavailableMessage('insufficient-data', {
          xLabel: X,
          yLabel: Y,
          maxLag,
          nPaired,
        });
        // 2*3+2 = 8 nights required.
        expect(minNightsForMaxLag(maxLag)).toBe(8);
        expect(body).toContain('8');
        expect(body).toContain('5');
        expect(body).toContain(X);
        expect(body).toContain(Y);
      });
    });

    describe('constant-series', () => {
      it('does NOT mention nights, "available", or sample size', () => {
        const { heading, body } = unavailableMessage('constant-series', {
          xLabel: X,
          yLabel: Y,
          maxLag: 7,
          nPaired: 50,
        });
        // The data is sufficient here; only the no-variation message should show.
        expect(heading).not.toMatch(/nights/i);
        expect(body).not.toMatch(/nights/i);
        expect(body).not.toMatch(/available/i);
      });

      it('uses constant / no-variation phrasing and names both metrics', () => {
        const { body } = unavailableMessage('constant-series', {
          xLabel: X,
          yLabel: Y,
          maxLag: 7,
          nPaired: 50,
        });
        expect(body).toMatch(/constant/i);
        expect(body).toMatch(/variation/i);
        expect(body).toContain(X);
        expect(body).toContain(Y);
      });
    });

    describe('singular-fit', () => {
      it('is fit-focused and does NOT claim insufficient nights or constant data', () => {
        const { body } = unavailableMessage('singular-fit', {
          xLabel: X,
          yLabel: Y,
          maxLag: 7,
          nPaired: 50,
        });
        // Distinguishing fit-failure phrasing.
        expect(body).toMatch(/fit/i);
        expect(body).toMatch(/lag/i);
        expect(body).toMatch(/date range/i);
        // Not the insufficient-data or constant-series stories.
        expect(body).not.toMatch(/nights/i);
        expect(body).not.toMatch(/available/i);
        expect(body).not.toMatch(/constant/i);
        expect(body).not.toMatch(/no variation/i);
      });
    });
  });
});
