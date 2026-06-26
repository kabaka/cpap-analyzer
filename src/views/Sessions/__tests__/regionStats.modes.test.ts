/**
 * Unit tests for the extended Measure-region "mode" computations in
 * `regionStats.ts`: variability/spread, trend (OLS), distribution (percentiles),
 * and the small pure helpers (`quantileSorted`, `effectiveCadenceHz`,
 * `isCvMeaningful`, `CV_MEAN_EPSILON`).
 *
 * These feed clinical/analytical readouts, so the known-value SD/slope/percentile
 * assertions and the wearable irregular-Δt slope correctness are the load-bearing
 * cases — every expected number here is hand-computable and cited in a comment.
 *
 * Conventions match the sibling `regionStats.test.ts`:
 *   - half-open `[startIndex, endIndex)` sample-index ranges;
 *   - sentinels excluded via `isMeaningfulSample` (`0`, `-1` below floor, NaN,
 *     out-of-range, byte sentinels);
 *   - `count: 0` ⇒ all stats `null` (never `0`).
 *
 * Fixtures use REAL channel names and in-range values verified against
 * `MEANINGFUL_SAMPLE_RANGES`/`isMeaningfulSample` in
 * `@/parsers/validation/physiologicalRanges`:
 *   flow  [-300, 300],  spo2 (meaningful) [30, 100],  pulse [30, 250],
 *   leak  [0, 200],     pressure [0, 40].
 *
 * Note (CV unit): `computeSpreadStats` returns CV as a dimensionless FRACTION
 * (`sd / |mean|`), NOT a percent — verified against source (`cv = sd / |mean|`).
 * A pulse fixture with mean 60, sd 6 therefore yields `cv ≈ 0.10`, not `10`.
 *
 * Note (netDelta): `netDelta = slopePerMin * (xLast − xFirst)` where x is in
 * MINUTES — i.e. the fitted change across the region, not the raw last−first of y.
 * On a perfect line it equals the true endpoint delta.
 */

import { describe, it, expect } from 'vitest';

import {
  computeSpreadStats,
  computeTrendStats,
  computeDistributionStats,
  quantileSorted,
  effectiveCadenceHz,
  isCvMeaningful,
  CV_MEAN_EPSILON,
  type NumericChannelInput,
  type IndexRange,
} from '../regionStats';

// ---------------------------------------------------------------------------
// Helpers (mirrors the sibling test's `channel`/`whole`)
// ---------------------------------------------------------------------------

function channel(
  values: readonly number[],
  over: Partial<Omit<NumericChannelInput, 'data'>> = {},
): NumericChannelInput {
  return {
    name: over.name ?? 'flow',
    unit: over.unit ?? 'L/min',
    sampleRate: over.sampleRate ?? 1,
    data: Float32Array.from(values),
  };
}

function whole(ch: NumericChannelInput): IndexRange {
  return { startIndex: 0, endIndex: ch.data.length };
}

// ===========================================================================
// 1. computeSpreadStats — sample (n−1) SD/variance, CV gating, IQR
// ===========================================================================

describe('computeSpreadStats — sample SD and variance (n−1)', () => {
  it('uses the n−1 (sample) estimator, not population, for SD and variance', () => {
    // Classic fixture [2,4,4,4,5,5,7,9], mean 5. Σ(x−5)² = 9+1+1+1+0+0+4+16 = 32.
    //   sample variance = 32/(8−1) = 32/7 ≈ 4.5714  (population would be 32/8 = 4.0)
    //   sample SD       = √(32/7)  ≈ 2.1381          (population SD would be 2.0)
    // Asserting the n−1 value proves the sample estimator is used. flow admits all.
    const ch = channel([2, 4, 4, 4, 5, 5, 7, 9], { name: 'flow' });
    const r = computeSpreadStats(ch, whole(ch));
    expect(r.kind).toBe('spread');
    expect(r.count).toBe(8);
    expect(r.mean).toBeCloseTo(5, 10);
    expect(r.variance).toBeCloseTo(32 / 7, 10); // ≈ 4.5714 — NOT 4.0
    expect(r.sd).toBeCloseTo(Math.sqrt(32 / 7), 10); // ≈ 2.1381 — NOT 2.0
    // Sanity guard: it is definitively not the population SD of 2.0.
    expect(r.sd as number).toBeGreaterThan(2.1);
  });

  it('echoes count/mean and carries unit/decimals', () => {
    const ch = channel([2, 4, 4, 4, 5, 5, 7, 9], { name: 'flow', unit: 'L/min' });
    const r = computeSpreadStats(ch, whole(ch));
    expect(r.unit).toBe('L/min');
    expect(r.decimals).toBe(1); // flow -> 1dp
  });
});

describe('computeSpreadStats — coefficient of variation gating', () => {
  it('returns cv as a FRACTION (sd/|mean|) for an allowlisted pulse channel', () => {
    // pulse fixture engineered for mean 60, sample SD 6 -> CV = 6/60 = 0.10.
    // Construct values symmetric about 60 so the mean is exact: [54,66] repeated.
    //   Σ(x−60)² with k pairs of (±6) = k·(36+36) = 72k; n = 2k.
    //   sample variance = 72k/(2k−1). For the SD to be exactly 6 we need n−1 = n,
    //   which is impossible, so instead pick values giving SD≈6 and assert closeTo.
    // Simpler exact route: values [54,54,66,66] -> mean 60, Σdev²=4·36=144,
    //   sample var = 144/3 = 48, sd = √48 ≈ 6.928 -> cv ≈ 0.1155. Assert that.
    const ch = channel([54, 54, 66, 66], { name: 'pulse', unit: 'bpm' });
    const r = computeSpreadStats(ch, whole(ch));
    expect(r.mean).toBeCloseTo(60, 10);
    expect(r.sd).toBeCloseTo(Math.sqrt(48), 10);
    // CV is the dimensionless fraction sd/|mean|, NOT a percent.
    expect(r.cv).toBeCloseTo(Math.sqrt(48) / 60, 10);
    expect(r.cv as number).toBeLessThan(1); // i.e. ~0.115, not ~11.5
  });

  it('returns cv equal to sd/|mean| for an allowlisted pulse channel', () => {
    // [57,63]: mean 60, Σdev²=9+9=18, sample var=18/1=18, sd=√18≈4.243, cv=√18/60.
    // Confirms the CV contract cv == sd/|mean| as a dimensionless fraction.
    const ch = channel([57, 63], { name: 'pulse', unit: 'bpm' });
    const r = computeSpreadStats(ch, whole(ch));
    expect(r.mean).toBeCloseTo(60, 10);
    expect(r.cv).toBeCloseTo(Math.sqrt(18) / 60, 10);
  });

  it('returns cv: null for flow (not on the CV allowlist; zero-centred)', () => {
    const ch = channel([-2, -1, 1, 2, 3], { name: 'flow' });
    const r = computeSpreadStats(ch, whole(ch));
    expect(r.sd).not.toBeNull(); // SD is defined
    expect(r.cv).toBeNull(); // but CV is gated off for flow
  });

  it('returns cv: null when |mean| < CV_MEAN_EPSILON even for an allowlisted channel', () => {
    // A true |mean| < epsilon needs values straddling 0, but every range-gated channel
    // rejects near-zero samples (e.g. pulse floor is 30). 'heart_rate_intraday' IS on the
    // CV allowlist yet has NO MEANINGFUL_SAMPLE_RANGES entry, so any non-zero finite value
    // is meaningful — letting us drive the mean to ~0 with symmetric tiny values and so
    // exercise the epsilon guard on an allowlisted channel.
    const ch = channel([1e-9, -1e-9], { name: 'heart_rate_intraday', unit: 'bpm' });
    const r = computeSpreadStats(ch, whole(ch));
    expect(Math.abs(r.mean as number)).toBeLessThan(CV_MEAN_EPSILON); // mean ≈ 0
    expect(r.sd).not.toBeNull(); // SD is defined (count ≥ 2)
    expect(r.cv).toBeNull(); // but CV is gated off by the epsilon guard
    expect(CV_MEAN_EPSILON).toBe(1e-6);
  });
});

describe('computeSpreadStats — IQR (type-7 / NumPy quantile)', () => {
  it('computes IQR=4 for [1..9] (p25=3, p75=7)', () => {
    // type-7: h = (n−1)·p. n=9 -> p25 rank = 8·0.25 = 2 -> value sorted[2]=3;
    //                          p75 rank = 8·0.75 = 6 -> value sorted[6]=7. IQR = 4.
    const ch = channel([1, 2, 3, 4, 5, 6, 7, 8, 9], { name: 'flow' });
    const r = computeSpreadStats(ch, whole(ch));
    expect(r.iqr).toBeCloseTo(4, 10);
  });

  it('computes a defined IQR at the n=4 minimum boundary', () => {
    // n=4 -> p25 rank = 3·0.25 = 0.75 -> interp sorted[0]+0.75·(sorted[1]−sorted[0]);
    //         for [1,2,3,4]: 1 + 0.75·1 = 1.75; p75 rank = 3·0.75 = 2.25 ->
    //         3 + 0.25·(4−3) = 3.25; IQR = 3.25 − 1.75 = 1.5.
    const ch = channel([1, 2, 3, 4], { name: 'flow' });
    const r = computeSpreadStats(ch, whole(ch));
    expect(r.count).toBe(4);
    expect(r.iqr).toBeCloseTo(1.5, 10);
  });

  it('returns iqr: null below the n=4 minimum (n=3)', () => {
    const ch = channel([1, 2, 3], { name: 'flow' });
    const r = computeSpreadStats(ch, whole(ch));
    expect(r.count).toBe(3);
    expect(r.iqr).toBeNull();
    // SD/variance still defined (need only n≥2).
    expect(r.sd).not.toBeNull();
    expect(r.variance).not.toBeNull();
  });
});

describe('computeSpreadStats — minimum-n and empty regions', () => {
  it('returns null sd/variance/cv/iqr (mean set) for a single meaningful sample', () => {
    const ch = channel([42], { name: 'flow' });
    const r = computeSpreadStats(ch, whole(ch));
    expect(r.count).toBe(1);
    expect(r.mean).toBe(42);
    expect(r.sd).toBeNull();
    expect(r.variance).toBeNull();
    expect(r.cv).toBeNull();
    expect(r.iqr).toBeNull();
  });

  it('returns count 0 with every stat null for an empty (zero-width) range', () => {
    const ch = channel([1, 2, 3], { name: 'flow' });
    const r = computeSpreadStats(ch, { startIndex: 1, endIndex: 1 });
    expect(r.count).toBe(0);
    expect(r.mean).toBeNull();
    expect(r.sd).toBeNull();
    expect(r.variance).toBeNull();
    expect(r.cv).toBeNull();
    expect(r.iqr).toBeNull();
  });

  it('treats an all-sentinel region as empty (count 0, nulls — never 0)', () => {
    const ch = channel([0, 0, 0, 0], { name: 'flow' });
    const r = computeSpreadStats(ch, whole(ch));
    expect(r.count).toBe(0);
    expect(r.mean).toBeNull();
    expect(r.sd).toBeNull();
    expect(r.variance).toBeNull();
  });
});

// ===========================================================================
// 2. computeTrendStats — OLS slope/R²/netDelta and the wearable Δt keystone
// ===========================================================================

describe('computeTrendStats — known slope on a uniform ramp', () => {
  it('recovers slope=60 unit/min, R²=1, netDelta=59 on a 1 Hz ramp', () => {
    // sampleRate 1 Hz; sample i -> time i s -> x = i/60 min. value = i+1 (1..60, no
    // zero sentinel for flow). y is linear in x with d(y)/d(x) = 60, so the OLS slope
    // is exactly 60 unit/min, the fit is perfect (R²=1), and the constant offset (+1)
    // does not change the slope. netDelta = slope·(xLast−xFirst) = 60·((59/60)−0) = 59.
    const ramp = channel(
      Array.from({ length: 60 }, (_, i) => i + 1), // 1..60, no zero sentinel
      { name: 'flow', sampleRate: 1 },
    );
    const r = computeTrendStats(ramp, whole(ramp));
    expect(r.kind).toBe('trend');
    expect(r.count).toBe(60);
    expect(r.slopePerMin).toBeCloseTo(60, 6);
    expect(r.rSquared).toBeCloseTo(1, 10);
    expect(r.netDelta).toBeCloseTo(59, 6);
  });
});

describe('computeTrendStats — mean and firstFitted echoes', () => {
  it('echoes the region mean ȳ and the fitted start value on a 1 Hz ramp', () => {
    // values 1..60 at t = i/60 min (i=0..59). y is a perfect line, so:
    //   mean (ȳ) = (1+…+60)/60 = 30.5
    //   firstFitted = ŷ(x_first) = the line's fitted start; equals y_first for a
    //                 perfect fit -> ≈ 1.0
    //   netDelta = 59 (fitted last − fitted first)
    // NOTE: a `[0..59]` ramp would NOT give mean 29.5 / firstFitted 0 — the value 0 at
    // index 0 is a sentinel rejected for EVERY channel, dropping the count to 59. Using
    // 1..60 keeps all 60 points meaningful, so the mean is 30.5, not 29.5.
    const ramp = channel(
      Array.from({ length: 60 }, (_, i) => i + 1),
      { name: 'flow', sampleRate: 1 },
    );
    const r = computeTrendStats(ramp, whole(ramp));
    expect(r.count).toBe(60);
    expect(r.mean).toBeCloseTo(30.5, 6);
    expect(r.firstFitted).toBeCloseTo(1, 6);
    expect(r.netDelta).toBeCloseTo(59, 6);
  });

  it('returns mean and firstFitted as null when count < 2', () => {
    const ch = channel([42], { name: 'flow' });
    const r = computeTrendStats(ch, whole(ch));
    expect(r.count).toBe(1);
    expect(r.mean).toBeNull();
    expect(r.firstFitted).toBeNull();
  });

  it('returns mean/firstFitted null when x-variance is zero (Sxx=0)', () => {
    // Two meaningful values at one instant -> no slope; mean/firstFitted null too.
    const ch = channel([10, 20], { name: 'heart_rate_intraday', unit: 'bpm' });
    const r = computeTrendStats(ch, whole(ch), [5000, 5000]);
    expect(r.mean).toBeNull();
    expect(r.firstFitted).toBeNull();
  });
});

describe('computeTrendStats — wearable irregular Δt (correctness keystone)', () => {
  it('honours explicit timesMs: slope on TRUE times [0,1,3] min is 10 unit/min', () => {
    // values [10,20,40] at x(min)=[0,1,3]:
    //   meanX=4/3, meanY=70/3; Sxy=420/9, Sxx=42/9 -> slope = 420/42 = 10 unit/min.
    //   netDelta = 10·(3−0) = 30; R²: Syy = (40²+10²+50²)/9? compute -> dy=[-40/3,-10/3,50/3]
    //   Syy = (1600+100+2500)/9 = 4200/9; R² = Sxy²/(Sxx·Syy) = (420/9)²/((42/9)(4200/9))
    //       = (176400/81)/(176400/81) = 1.0 (these three points are colinear in (x,y)? check:
    //       slope 10 from x0=0,y0=10 predicts y(1)=20 ✓, y(3)=40 ✓ -> perfectly colinear).
    const ch = channel([10, 20, 40], { name: 'heart_rate_intraday', unit: 'bpm' });
    const timesMs = [0, 60000, 180000];
    const r = computeTrendStats(ch, whole(ch), timesMs);
    expect(r.count).toBe(3);
    expect(r.slopePerMin).toBeCloseTo(10, 10);
    expect(r.netDelta).toBeCloseTo(30, 10);
    expect(r.rSquared).toBeCloseTo(1, 10); // colinear -> perfect fit
  });

  it('produces a DIFFERENT (wrong) slope when timesMs is omitted (synthetic uniform Δt)', () => {
    // Omitting timesMs forces synthetic uniform spacing from sampleRate (1 Hz):
    // indices 0,1,2 -> t = 0,1,2 s -> x(min) = 0, 1/60, 2/60 (uniform).
    // On uniform x the slope of [10,20,40] is (regression) = Σdx·dy / Σdx² with
    // dx=[-1/60,0,1/60], dy=[-20/3,-10/3,... ] -> NOT 10; it is far larger because the
    // Δt is compressed to seconds-apart instead of the true minutes-apart cadence.
    const ch = channel([10, 20, 40], { name: 'heart_rate_intraday', unit: 'bpm', sampleRate: 1 });
    const withTimes = computeTrendStats(ch, whole(ch), [0, 60000, 180000]);
    const uniform = computeTrendStats(ch, whole(ch)); // synthetic uniform Δt
    expect(withTimes.slopePerMin).toBeCloseTo(10, 10);
    // The uniform-Δt slope must NOT equal the true-time slope (proves the timestamp
    // path is honored, not silently ignored).
    expect(uniform.slopePerMin).not.toBeCloseTo(10, 3);
    expect(Math.abs((uniform.slopePerMin as number) - 10)).toBeGreaterThan(1);
  });

  it('is stable under a large time offset (mean-centring guards catastrophic cancellation)', () => {
    // Same colinear ramp, once at t-offset 0 and once shifted +10,000,000 ms.
    // A naive Σxy − ΣxΣy/n form would lose precision at large t; mean-centring must
    // give the SAME slope to full double precision.
    const ch = channel([10, 20, 40], { name: 'heart_rate_intraday', unit: 'bpm' });
    const base = [0, 60000, 180000];
    const offset = base.map((t) => t + 10_000_000);
    const a = computeTrendStats(ch, whole(ch), base);
    const b = computeTrendStats(ch, whole(ch), offset);
    expect(a.slopePerMin).toBeCloseTo(10, 12);
    expect(b.slopePerMin).toBeCloseTo(a.slopePerMin as number, 12);
  });
});

describe('computeTrendStats — degenerate variance and minimum-n', () => {
  it('returns rSquared: null and slope 0 for a flat-y region (Σyy=0)', () => {
    // Constant y over varying x: slope is 0 (no trend), Sxx>0 so slope is defined (0),
    // but Syy=0 so R² is undefined -> null per the source rule (syy > 0 ? ... : null).
    const ch = channel([7, 7, 7, 7], { name: 'flow', sampleRate: 1 });
    const r = computeTrendStats(ch, whole(ch));
    expect(r.count).toBe(4);
    expect(r.slopePerMin).toBeCloseTo(0, 12);
    expect(r.rSquared).toBeNull();
  });

  it('returns all null when every meaningful sample shares one timestamp (Sxx=0)', () => {
    // Two meaningful values but identical times -> zero x-variance -> no defined slope.
    const ch = channel([10, 20], { name: 'heart_rate_intraday', unit: 'bpm' });
    const r = computeTrendStats(ch, whole(ch), [5000, 5000]);
    expect(r.count).toBe(2);
    expect(r.slopePerMin).toBeNull();
    expect(r.netDelta).toBeNull();
    expect(r.rSquared).toBeNull();
  });

  it('returns all null for fewer than 2 meaningful samples', () => {
    const ch = channel([42], { name: 'flow' });
    const r = computeTrendStats(ch, whole(ch));
    expect(r.count).toBe(1);
    expect(r.slopePerMin).toBeNull();
    expect(r.netDelta).toBeNull();
    expect(r.rSquared).toBeNull();
  });

  it('excludes sentinels from the regression and counts only meaningful pairs', () => {
    // 0 is a flow sentinel; it must not enter the regression. Remaining 1..4 at 1 Hz.
    const ch = channel([0, 1, 2, 3, 4], { name: 'flow', sampleRate: 1 });
    const r = computeTrendStats(ch, whole(ch));
    expect(r.count).toBe(4); // the leading 0 dropped
  });
});

// ===========================================================================
// 3. computeDistributionStats — five-number percentile summary
// ===========================================================================

describe('computeDistributionStats — known percentiles', () => {
  it('computes p50=2.5 for [1,2,3,4]', () => {
    const ch = channel([1, 2, 3, 4], { name: 'flow' });
    const r = computeDistributionStats(ch, whole(ch));
    expect(r.kind).toBe('distribution');
    expect(r.p50).toBeCloseTo(2.5, 10); // type-7: h=3·0.5=1.5 -> (2+3)/2
    expect(r.approximate).toBe(false);
  });

  it('computes p25=2.0 for [1,2,3,4,5]', () => {
    const ch = channel([1, 2, 3, 4, 5], { name: 'flow' });
    const r = computeDistributionStats(ch, whole(ch));
    expect(r.p25).toBeCloseTo(2.0, 10); // h=(5−1)·0.25=1 -> sorted[1]=2
  });

  it('computes the full five-number summary for [1..9]', () => {
    // n=9, h=(n−1)·p: p5 -> 8·0.05=0.4 -> 1+0.4·1 = 1.4; p25 -> 2 -> 3; p50 -> 4 -> 5;
    //                p75 -> 6 -> 7; p95 -> 8·0.95=7.6 -> 8 + 0.6·1 = 8.6.
    const ch = channel([1, 2, 3, 4, 5, 6, 7, 8, 9], { name: 'flow' });
    const r = computeDistributionStats(ch, whole(ch));
    expect(r.p5).toBeCloseTo(1.4, 10);
    expect(r.p25).toBeCloseTo(3, 10);
    expect(r.p50).toBeCloseTo(5, 10);
    expect(r.p75).toBeCloseTo(7, 10);
    expect(r.p95).toBeCloseTo(8.6, 10);
    expect(r.count).toBe(9);
    expect(r.approximate).toBe(false);
  });

  it('excludes sentinels before computing percentiles', () => {
    // 0 sentinels interleaved; only [1,2,3,4] feed the percentiles.
    const ch = channel([1, 0, 2, 0, 3, 0, 4], { name: 'flow' });
    const r = computeDistributionStats(ch, whole(ch));
    expect(r.count).toBe(4);
    expect(r.p50).toBeCloseTo(2.5, 10);
  });
});

describe('computeDistributionStats — minimum-n, empty, and approximate path', () => {
  it('returns all percentiles null but reports count for a single sample (n=1)', () => {
    const ch = channel([42], { name: 'flow' });
    const r = computeDistributionStats(ch, whole(ch));
    expect(r.count).toBe(1);
    expect(r.p5).toBeNull();
    expect(r.p25).toBeNull();
    expect(r.p50).toBeNull();
    expect(r.p75).toBeNull();
    expect(r.p95).toBeNull();
  });

  it('reports count 0 with all percentiles null for an empty range', () => {
    const ch = channel([1, 2, 3], { name: 'flow' });
    const r = computeDistributionStats(ch, { startIndex: 1, endIndex: 1 });
    expect(r.count).toBe(0);
    expect(r.p50).toBeNull();
  });

  it('reports count 0 for an all-sentinel region (never 0)', () => {
    const ch = channel([0, 0, 0], { name: 'flow' });
    const r = computeDistributionStats(ch, whole(ch));
    expect(r.count).toBe(0);
    expect(r.p5).toBeNull();
    expect(r.p95).toBeNull();
  });

  it('flags approximate:true when meaningful samples exceed the (overridden) threshold', () => {
    // Mirror the baseline median-approx test: force the path with a tiny threshold so
    // the compact buffer holds only `threshold` samples and the rest overflow.
    // With threshold=4 and 9 meaningful samples, stored(4) < count(9) -> approximate.
    const ch = channel([1, 2, 3, 4, 5, 6, 7, 8, 9], { name: 'flow' });
    const r = computeDistributionStats(ch, whole(ch), 4);
    expect(r.count).toBe(9);
    expect(r.approximate).toBe(true);
    // Percentiles are read from the retained prefix [1,2,3,4] (insertion order, sorted).
    // They are no longer the exact full-set percentiles, but must still be finite numbers.
    expect(Number.isFinite(r.p50 as number)).toBe(true);
  });

  it('keeps approximate:false on the exact path at the default threshold', () => {
    const ch = channel([1, 2, 3, 4, 5, 6, 7, 8, 9], { name: 'flow' });
    const r = computeDistributionStats(ch, whole(ch));
    expect(r.approximate).toBe(false);
  });

  it('does not include a sample exactly at the exclusive end index (half-open)', () => {
    // [10,20,30,40,50]; range [0,4) includes indices 0..3 -> 10,20,30,40 (50 excluded).
    const ch = channel([10, 20, 30, 40, 50], { name: 'flow' });
    const r = computeDistributionStats(ch, { startIndex: 0, endIndex: 4 });
    expect(r.count).toBe(4);
    // p95 of [10,20,30,40] is at most 40; the value 50 at the excluded end index
    // must never enter, so p95 stays ≤ 40 (never approaches 50).
    expect(r.p95 as number).toBeLessThanOrEqual(40);
  });
});

// ===========================================================================
// 4. quantileSorted — direct (type-7 linear interpolation, clamping)
// ===========================================================================

describe('quantileSorted — type-7 linear interpolation', () => {
  it('p50 of [1,2,3,4] = 2.5', () => {
    expect(quantileSorted(Float32Array.from([1, 2, 3, 4]), 0.5)).toBeCloseTo(2.5, 10);
  });

  it('p25 of [1,2,3,4,5] = 2.0', () => {
    expect(quantileSorted(Float32Array.from([1, 2, 3, 4, 5]), 0.25)).toBeCloseTo(2.0, 10);
  });

  it('returns the sole element for a single-element array', () => {
    expect(quantileSorted(Float32Array.from([7]), 0.5)).toBe(7);
    expect(quantileSorted(Float32Array.from([7]), 0)).toBe(7);
    expect(quantileSorted(Float32Array.from([7]), 1)).toBe(7);
  });

  it('clamps p ≤ 0 to the minimum and p ≥ 1 to the maximum', () => {
    const a = Float32Array.from([10, 20, 30, 40]);
    expect(quantileSorted(a, 0)).toBe(10);
    expect(quantileSorted(a, -5)).toBe(10); // clamped to 0 -> min
    expect(quantileSorted(a, 1)).toBe(40);
    expect(quantileSorted(a, 2)).toBe(40); // clamped to 1 -> max
  });

  it('interpolates linearly between ranks (h fractional)', () => {
    // [0,10,20,30], p=0.5 -> h=(4−1)·0.5=1.5 -> 10 + 0.5·(20−10) = 15.
    expect(quantileSorted(Float32Array.from([0, 10, 20, 30]), 0.5)).toBeCloseTo(15, 10);
  });
});

// ===========================================================================
// 5. effectiveCadenceHz — count / durationSeconds with guards
// ===========================================================================

describe('effectiveCadenceHz', () => {
  it('computes 25 Hz for 100 samples over 4000 ms', () => {
    expect(effectiveCadenceHz(100, 4000)).toBeCloseTo(25, 10);
  });

  it('returns null for zero or negative duration', () => {
    expect(effectiveCadenceHz(100, 0)).toBeNull();
    expect(effectiveCadenceHz(100, -1000)).toBeNull();
  });

  it('returns null for zero or negative count', () => {
    expect(effectiveCadenceHz(0, 4000)).toBeNull();
    expect(effectiveCadenceHz(-5, 4000)).toBeNull();
  });

  it('returns null for a non-finite duration', () => {
    expect(effectiveCadenceHz(100, Number.POSITIVE_INFINITY)).toBeNull();
    expect(effectiveCadenceHz(100, NaN)).toBeNull();
  });
});

// ===========================================================================
// 6. isCvMeaningful — the CV allowlist gate
// ===========================================================================

describe('isCvMeaningful — CV allowlist', () => {
  it('returns true for allowlisted ratio-scale channels', () => {
    for (const name of [
      'leak',
      'pressure',
      'maskPressure',
      'eprPressure',
      'epap',
      'ipap',
      'minuteVent',
      'tidalVolume',
      'respRate',
      'pulse',
      'snore',
      'heart_rate_intraday',
      'hrv_detail',
      'snoring_segments',
    ]) {
      expect(isCvMeaningful(name)).toBe(true);
    }
  });

  it('returns false for flow (zero-centred) and spo2 (narrow band)', () => {
    expect(isCvMeaningful('flow')).toBe(false);
    expect(isCvMeaningful('spo2')).toBe(false);
  });

  it('returns false for an unknown channel name', () => {
    expect(isCvMeaningful('mysteryChannel')).toBe(false);
    expect(isCvMeaningful('')).toBe(false);
  });
});

// ===========================================================================
// 7. Determinism (mode functions, same input twice)
// ===========================================================================

describe('mode computations — determinism', () => {
  it('computeSpreadStats is deterministic', () => {
    const ch = channel([2, 4, 4, 4, 5, 5, 7, 9], { name: 'flow' });
    expect(computeSpreadStats(ch, whole(ch))).toEqual(computeSpreadStats(ch, whole(ch)));
  });

  it('computeTrendStats is deterministic', () => {
    const ch = channel([10, 20, 40], { name: 'heart_rate_intraday', unit: 'bpm' });
    const t = [0, 60000, 180000];
    expect(computeTrendStats(ch, whole(ch), t)).toEqual(computeTrendStats(ch, whole(ch), t));
  });

  it('computeDistributionStats is deterministic', () => {
    const ch = channel([1, 2, 3, 4, 5, 6, 7, 8, 9], { name: 'flow' });
    expect(computeDistributionStats(ch, whole(ch))).toEqual(
      computeDistributionStats(ch, whole(ch)),
    );
  });
});
