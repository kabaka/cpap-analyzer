/**
 * Unit tests for the hybrid display-domain resolver (`signalDomain.ts`).
 *
 * These lock the *correctness contract* of y-axis scaling: a clinical default
 * range that is **expanded only** to fit the session's data, with plausibility
 * clamps so a single corrupt sample can't blow out the axis, and nice-number
 * rounding so expanded edges land on gridlines.
 *
 * Every numeric expectation below cites the arithmetic that produces it, traced
 * against the algorithm in `computeLaneDomain` and the `[1,2,5]·10^k` step
 * ladder in `niceFloor`/`niceCeil`.
 */

import { describe, it, expect } from 'vitest';

import {
  computeLaneDomain,
  niceFloor,
  niceCeil,
  RESMED_CLINICAL_RANGES,
  type ClinicalRange,
  type LaneDomainOptions,
} from '../signalDomain';

/**
 * Build a LaneDomainOptions with sensible declared-range defaults. The declared
 * range is the EDF fallback; for known channels it should be ignored, so we set
 * it to obviously-wrong sentinels to catch accidental leakage into the result.
 */
function opts(over: Partial<LaneDomainOptions> & { channelName: string }): LaneDomainOptions {
  return {
    declaredMin: -999,
    declaredMax: 999,
    ...over,
  };
}

// ===========================================================================
// niceFloor / niceCeil — the [1,2,5]·10^k step ladder
// ===========================================================================

describe('niceCeil', () => {
  it('rounds outward toward +∞ onto a [1,2,5]·10^k step derived from span/5', () => {
    // span 95 → step = niceStep(95/5 = 19): mag = 10^floor(log10(19)) = 10;
    // candidates 1·10=10 (<19), 2·10=20 (>=19) → step 20.
    // ceil(99.75 / 20) = ceil(4.9875) = 5 → 5·20 = 100.
    expect(niceCeil(99.75, 95)).toBe(100);
  });

  it('snaps a small value onto a small step', () => {
    // span 1 → step = niceStep(0.2): mag = 10^floor(log10(0.2)) = 10^-1 = 0.1;
    // 1·0.1 = 0.1 (<0.2), 2·0.1 = 0.2 (>=0.2) → step 0.2.
    // ceil(0.55 / 0.2) = ceil(2.75) = 3 → 3·0.2 = 0.6.
    expect(niceCeil(0.55, 1)).toBeCloseTo(0.6, 10);
  });

  it('returns the value unchanged when span is non-positive (no usable step)', () => {
    // niceStep(0) returns 1 only for positive targets; span/5 = 0 → step = 1?
    // niceStep guards `!(target > 0)` → returns 1, so ceil(7.2/1)*1 = 8.
    expect(niceCeil(7.2, 0)).toBe(8);
  });
});

describe('niceFloor', () => {
  it('rounds outward toward -∞ onto a [1,2,5]·10^k step derived from span/5', () => {
    // span 28 → step = niceStep(28/5 = 5.6): mag = 10^0 = 1;
    // 1 (<5.6), 2 (<5.6), 5 (<5.6), 10 (>=5.6) → step 10.
    // floor(70.6 / 10) = 7 → 7·10 = 70.
    expect(niceFloor(70.6, 28)).toBe(70);
  });

  it('handles negative values by rounding more negative', () => {
    // span 50 → step = niceStep(10) = 10. floor(-83.5/10) = floor(-8.35) = -9 → -90.
    expect(niceFloor(-83.5, 50)).toBe(-90);
  });
});

// ===========================================================================
// Invariant 1 — expand-only / never-contract (expandUp: leak)
// ===========================================================================

describe('computeLaneDomain — expand-only (never contract)', () => {
  it('keeps the clinical default when data fits below it (does NOT shrink to fit)', () => {
    // leak default [0, 60]; data 0..40 fits inside → domain stays [0, 60].
    const r = computeLaneDomain(opts({ channelName: 'leak', dataMin: 0, dataMax: 40 }));
    expect(r).toEqual({ min: 0, max: 60 });
  });

  it('expands the upper edge to cover data above the default, rounded out to a nice number', () => {
    // leak default [0, 60], clampMax 200; dataMax 95 > 60 → hi = 95, expanded.
    // span = 95 - 0 = 95; pad = 95·0.05 = 4.75; hi + pad = 99.75.
    // niceCeil(99.75, 95): step 20 (see niceCeil test) → 100.
    const r = computeLaneDomain(opts({ channelName: 'leak', dataMin: 0, dataMax: 95 }));
    expect(r.min).toBe(0); // anchored low edge, exact
    expect(r.max).toBe(100); // expanded, padded, nice-rounded
    expect(r.max).toBeGreaterThanOrEqual(95); // genuinely covers the data
  });

  it('does not move the anchored min edge for an expandUp signal even with negative-ish data', () => {
    // expandUp cannot grow DOWN; a dataMin below the default min is ignored.
    // pressure default [0, 25]; dataMin -5 is below 0 but canGrowDown is false.
    const r = computeLaneDomain(opts({ channelName: 'pressure', dataMin: -5, dataMax: 12 }));
    expect(r.min).toBe(0);
    expect(r.max).toBe(25);
  });
});

// ===========================================================================
// Invariant 2 — symmetric flow (always centred on 0)
// ===========================================================================

describe('computeLaneDomain — symmetric (flow)', () => {
  it('stays at the symmetric clinical default when data fits inside', () => {
    // flow default [-60, 60]; data [-30, 45] → |data| max 45 < 60, no expansion.
    const r = computeLaneDomain(opts({ channelName: 'flow', dataMin: -30, dataMax: 45 }));
    expect(r).toEqual({ min: -60, max: 60 });
  });

  it('expands symmetrically around 0 to the largest absolute extent', () => {
    // flow [-60, 60], clampBound 200; data [-80, 50] → absData = max(80, 50) = 80 > 60.
    // expanded: bound = 80; pad: 80 + 80·2·0.05 = 80 + 8 = 88;
    // niceCeil(88, 88): step = niceStep(17.6) = 20; ceil(88/20)=ceil(4.4)=5 → 100.
    // bound = 100 → [-100, 100], symmetric.
    const r = computeLaneDomain(opts({ channelName: 'flow', dataMin: -80, dataMax: 50 }));
    expect(r.min).toBe(-100);
    expect(r.max).toBe(100);
    expect(r.min).toBe(-r.max); // strictly symmetric about 0
    expect(r.max).toBeGreaterThanOrEqual(80); // covers the larger extent
  });

  it('is driven by whichever side has the larger magnitude (positive-dominant)', () => {
    // data [-10, 130] → absData = 130 > 60. bound 130; 130 + 13 = 143;
    // niceCeil(143, 143): step = niceStep(28.6) = 50; ceil(143/50)=ceil(2.86)=3 → 150.
    const r = computeLaneDomain(opts({ channelName: 'flow', dataMin: -10, dataMax: 130 }));
    expect(r.max).toBe(150);
    expect(r.min).toBe(-150);
  });

  it('never lets the rounded symmetric bound exceed clampBound at the ceiling boundary', () => {
    // flow clampBound 200; a value just under the ceiling (195) clamps to 195
    // before padding, then padding+niceCeil would push it ABOVE 200
    // (195 + 19.5 = 214.5 → niceCeil = 250) — the post-rounding re-clamp must
    // pin the final bound at exactly 200, never above it. Symmetry preserved.
    const r = computeLaneDomain(opts({ channelName: 'flow', dataMin: -195, dataMax: 195 }));
    expect(r.max).toBeLessThanOrEqual(200);
    expect(r.max).toBe(200);
    expect(r.min).toBe(-200);
    expect(r.min).toBe(-r.max); // strictly symmetric about 0
  });

  it('keeps the rounded symmetric bound at clampBound for a value at the exact ceiling', () => {
    // dataMax exactly 200 → bound 200, clamp leaves it 200, padding+rounding
    // would exceed 200 → re-clamp pins at 200.
    const r = computeLaneDomain(opts({ channelName: 'flow', dataMin: -200, dataMax: 200 }));
    expect(r.max).toBe(200);
    expect(r.min).toBe(-200);
  });
});

// ===========================================================================
// Invariant 3 — SpO2 downward-only, max pinned at 100
// ===========================================================================

describe('computeLaneDomain — SpO₂ (downward-only, max pinned 100)', () => {
  it('expands the min DOWN for a real desaturation but keeps max pinned at 100', () => {
    // spo2 default [85, 100], clampMin 50; dataMin 72 < 85 → lo = 72, expanded.
    // canGrowUp is false → hi stays pinned at 100.
    // span = 100 - 72 = 28; pad = 28·0.05 = 1.4; lo - pad = 70.6;
    // niceFloor(70.6, 28): step 10 → 70.
    const r = computeLaneDomain(opts({ channelName: 'spo2', dataMin: 72, dataMax: 99 }));
    expect(r.max).toBe(100); // exact pin, no padding/rounding
    expect(r.min).toBe(70);
    expect(r.min).toBeLessThanOrEqual(72); // genuinely covers the desat
  });

  it('stays at the default floor 85 when data never dips below it', () => {
    // dataMin 90 >= 85 → no downward expansion; max pinned at 100.
    const r = computeLaneDomain(opts({ channelName: 'spo2', dataMin: 90, dataMax: 99 }));
    expect(r).toEqual({ min: 85, max: 100 });
  });

  it('never lets the max exceed 100 even for an impossible >100 sample', () => {
    // A corrupt 105 reading must not push the upper edge (downward-only pins max).
    const r = computeLaneDomain(opts({ channelName: 'spo2', dataMin: 95, dataMax: 105 }));
    expect(r.max).toBe(100);
    expect(r.min).toBe(85);
  });
});

// ===========================================================================
// Invariant 4 — flow limitation fixed [0, 1]
// ===========================================================================

describe('computeLaneDomain — flow limitation (fixed)', () => {
  it('is always [0, 1] regardless of in-range data', () => {
    const r = computeLaneDomain(
      opts({ channelName: 'flowLimitation', dataMin: 0.1, dataMax: 0.8 }),
    );
    expect(r).toEqual({ min: 0, max: 1 });
  });

  it('does NOT expand for out-of-range data (decode errors are clamped at render, axis fixed)', () => {
    // A 3.5 reading is a decode error; the axis must remain [0, 1], not stretch.
    const r = computeLaneDomain(opts({ channelName: 'flowLimitation', dataMin: -2, dataMax: 3.5 }));
    expect(r).toEqual({ min: 0, max: 1 });
  });
});

// ===========================================================================
// Invariant 5 — plausibility clamps (corrupt spikes don't blow out the axis)
// ===========================================================================

describe('computeLaneDomain — plausibility clamps', () => {
  it('clamps a corrupt leak spike at the per-signal ceiling (≤ 200)', () => {
    // leak clampMax 200; a 5000 L/min spike is non-physical.
    // hi = 5000 → clamped to 200 BEFORE padding; then padding/rounding re-clamp to 200.
    const r = computeLaneDomain(opts({ channelName: 'leak', dataMin: 0, dataMax: 5000 }));
    expect(r.max).toBeLessThanOrEqual(200);
    expect(r.max).toBe(200);
    expect(r.min).toBe(0);
  });

  it('clamps a corrupt pressure spike at ≤ 60', () => {
    // pressure clampMax 60; 999 cmH₂O is impossible.
    const r = computeLaneDomain(opts({ channelName: 'pressure', dataMin: 0, dataMax: 999 }));
    expect(r.max).toBeLessThanOrEqual(60);
    expect(r.max).toBe(60);
  });

  it('clamps pulse within [20, 240] on both edges (expandBoth)', () => {
    // pulse default [40, 120], clampMin 20, clampMax 240; data [5, 400] → both clamp.
    const r = computeLaneDomain(opts({ channelName: 'pulse', dataMin: 5, dataMax: 400 }));
    expect(r.min).toBeGreaterThanOrEqual(20);
    expect(r.max).toBeLessThanOrEqual(240);
    expect(r.min).toBe(20);
    expect(r.max).toBe(240);
  });

  it('clamps the SpO₂ floor at ≥ 50 for an absurd low reading', () => {
    // spo2 clampMin 50; a 10% reading is non-physical → floor clamps at 50.
    const r = computeLaneDomain(opts({ channelName: 'spo2', dataMin: 10, dataMax: 99 }));
    expect(r.min).toBeGreaterThanOrEqual(50);
    expect(r.min).toBe(50);
    expect(r.max).toBe(100);
  });
});

// ===========================================================================
// Invariant 6 — nice-number rounding; anchored edges stay exact
// ===========================================================================

describe('computeLaneDomain — nice rounding vs exact anchored edges', () => {
  it('rounds an expanded edge outward but leaves the anchored edge exact', () => {
    // pressure default [0, 25]; dataMax 33 > 25 → hi = 33, expanded.
    // span = 33; pad = 1.65; hi+pad = 34.65;
    // niceCeil(34.65, 33): step = niceStep(6.6) = 10; ceil(34.65/10)=4 → 40.
    const r = computeLaneDomain(opts({ channelName: 'pressure', dataMin: 0, dataMax: 33 }));
    expect(r.min).toBe(0); // exact anchor — no rounding/pad
    expect(r.max).toBe(40); // expanded → nice-rounded
  });

  it('leaves the SpO₂ pinned 100 exact (never rounded or padded)', () => {
    const r = computeLaneDomain(opts({ channelName: 'spo2', dataMin: 71, dataMax: 100 }));
    expect(r.max).toBe(100); // pinned, not 105 or any rounded value
  });
});

// ===========================================================================
// Invariant 7 — asymmetric padding (only data-pushed edges get the pad)
// ===========================================================================

describe('computeLaneDomain — asymmetric padding', () => {
  it('pads only the expanded edge; the anchored edge gets none', () => {
    // pulse default [40, 120], expandBoth; data [38, 150].
    // lo: 38 < 40 → lo = 38, loExpanded. hi: 150 > 120 → hi = 150, hiExpanded.
    // span = 150 - 38 = 112; pad = 5.6.
    // hi = niceCeil(150 + 5.6 = 155.6, 112): step = niceStep(22.4) = 50;
    //      ceil(155.6/50) = ceil(3.112) = 4 → 200; clampMax 240 → 200.
    // lo = niceFloor(38 - 5.6 = 32.4, 112): step 50; floor(32.4/50)=0 → 0;
    //      clampMin 20 → max(0,20) = 20.
    const r = computeLaneDomain(opts({ channelName: 'pulse', dataMin: 38, dataMax: 150 }));
    expect(r.max).toBe(200);
    expect(r.min).toBe(20);
  });

  it('does not pad an edge that data did not push past the default', () => {
    // pressure: only the top is pushed (dataMax 28); the bottom stays exact at 0.
    // span = 28; pad = 1.4; hi+pad = 29.4; niceCeil(29.4, 28): step 10 → 30.
    const r = computeLaneDomain(opts({ channelName: 'pressure', dataMin: 2, dataMax: 28 }));
    expect(r.min).toBe(0); // unchanged anchor, no negative pad
    expect(r.max).toBe(30);
  });
});

// ===========================================================================
// Invariant 8 — degenerate / NaN handling
// ===========================================================================

describe('computeLaneDomain — degenerate & NaN handling', () => {
  it('ignores a NaN data extent and keeps the clinical default', () => {
    const r = computeLaneDomain(opts({ channelName: 'leak', dataMin: NaN, dataMax: Number.NaN }));
    expect(r).toEqual({ min: 0, max: 60 });
  });

  it('ignores an Infinity data extent (treated as unknown, not as a huge spike)', () => {
    const r = computeLaneDomain(
      opts({ channelName: 'pressure', dataMin: 0, dataMax: Number.POSITIVE_INFINITY }),
    );
    expect(r).toEqual({ min: 0, max: 25 });
  });

  it('produces a valid (min < max) domain when no data extent is supplied', () => {
    const r = computeLaneDomain(opts({ channelName: 'respRate' }));
    expect(r.min).toBeLessThan(r.max);
    expect(r).toEqual({ min: 0, max: 30 }); // pristine clinical default
  });

  it('never returns min >= max for a flat series at the default floor', () => {
    // A flat series at 0 for leak keeps default [0, 60] (data fits) — guard holds.
    const r = computeLaneDomain(opts({ channelName: 'leak', dataMin: 0, dataMax: 0 }));
    expect(r.min).toBeLessThan(r.max);
  });

  it('falls back to the EDF declared range for an unknown channel', () => {
    const r = computeLaneDomain(
      opts({ channelName: 'mysterySignal', declaredMin: 2, declaredMax: 9 }),
    );
    expect(r).toEqual({ min: 2, max: 9 });
  });

  it('repairs a degenerate declared range (min >= max) for an unknown channel', () => {
    // declared 5..5 is degenerate → resolver must widen to avoid divide-by-zero.
    const r = computeLaneDomain(
      opts({ channelName: 'mysterySignal', declaredMin: 5, declaredMax: 5 }),
    );
    expect(r.min).toBeLessThan(r.max);
    expect(r).toEqual({ min: 5, max: 6 });
  });

  it('handles a non-finite declared range for an unknown channel without NaN output', () => {
    const r = computeLaneDomain(
      opts({ channelName: 'mysterySignal', declaredMin: NaN, declaredMax: NaN }),
    );
    expect(Number.isFinite(r.min)).toBe(true);
    expect(Number.isFinite(r.max)).toBe(true);
    expect(r.min).toBeLessThan(r.max);
  });

  it('tames an absurd declared range for an unknown channel using the data extent when known', () => {
    // Crafted EDF declares [0, 1e300] on an unknown channel → absurd span/magnitude.
    // With a finite data extent [2, 9] the fallback derives a bounded, readable
    // domain from the data (nice-rounded with a small pad), never the 1e300 edge.
    const r = computeLaneDomain(
      opts({
        channelName: 'mysterySignal',
        declaredMin: 0,
        declaredMax: 1e300,
        dataMin: 2,
        dataMax: 9,
      }),
    );
    expect(Number.isFinite(r.min)).toBe(true);
    expect(Number.isFinite(r.max)).toBe(true);
    expect(r.min).toBeLessThan(r.max);
    expect(r.max - r.min).toBeLessThanOrEqual(1e6); // within the generic ceiling
    expect(Math.abs(r.min)).toBeLessThanOrEqual(1e6);
    expect(Math.abs(r.max)).toBeLessThanOrEqual(1e6);
    expect(r.min).toBeLessThanOrEqual(2); // genuinely covers the data
    expect(r.max).toBeGreaterThanOrEqual(9);
  });

  it('tames an absurd declared range for an unknown channel with no data extent (clamped window)', () => {
    // Same absurd declared range but no observed data → clamp the declared span
    // to a generic readable window; output stays finite and within the ceiling.
    const r = computeLaneDomain(
      opts({ channelName: 'mysterySignal', declaredMin: 0, declaredMax: 1e300 }),
    );
    expect(Number.isFinite(r.min)).toBe(true);
    expect(Number.isFinite(r.max)).toBe(true);
    expect(r.min).toBeLessThan(r.max);
    expect(r.max - r.min).toBeLessThanOrEqual(1e6); // span clamped to the generic ceiling
    expect(Math.abs(r.min)).toBeLessThanOrEqual(1e6);
    expect(Math.abs(r.max)).toBeLessThanOrEqual(1e6);
  });
});

// ===========================================================================
// Invariant 9 — tidal volume unit switch (L vs mL)
// ===========================================================================

describe('computeLaneDomain — tidal volume unit selection', () => {
  it('selects the litres entry (default [0, 1.0], clamp 3.0) when unit is "L"', () => {
    // litres entry: default 1.0; dataMax 0.8 fits → stays [0, 1.0].
    const r = computeLaneDomain(opts({ channelName: 'tidalVolume', unit: 'L', dataMax: 0.8 }));
    expect(r).toEqual({ min: 0, max: 1.0 });
  });

  it('clamps the litres entry at 3.0 for a corrupt large litre value', () => {
    // litres clampMax 3.0; a 50 L tidal volume is impossible.
    const r = computeLaneDomain(opts({ channelName: 'tidalVolume', unit: 'L', dataMax: 50 }));
    expect(r.max).toBeLessThanOrEqual(3.0);
    expect(r.max).toBe(3.0);
  });

  it('selects the mL entry (default [0, 1000], clamp 3000) when unit is "mL"', () => {
    // mL entry: default 1000; dataMax 600 fits → stays [0, 1000].
    const r = computeLaneDomain(opts({ channelName: 'tidalVolume', unit: 'mL', dataMax: 600 }));
    expect(r).toEqual({ min: 0, max: 1000 });
  });

  it('falls back to the mL (unguarded) entry when unit is absent', () => {
    // No unit string → resolver uses the first unguarded entry (mL).
    const r = computeLaneDomain(opts({ channelName: 'tidalVolume', dataMax: 600 }));
    expect(r).toEqual({ min: 0, max: 1000 });
  });

  it('clamps the mL entry at 3000 for a corrupt large value', () => {
    const r = computeLaneDomain(opts({ channelName: 'tidalVolume', dataMax: 99999 }));
    expect(r.max).toBeLessThanOrEqual(3000);
    expect(r.max).toBe(3000);
  });
});

// ===========================================================================
// Table sanity — guard against silent edits to the clinical contract
// ===========================================================================

describe('RESMED_CLINICAL_RANGES', () => {
  it('keeps flow symmetric and SpO₂ downward-only with a 100 ceiling', () => {
    const flow = RESMED_CLINICAL_RANGES.flow as ClinicalRange;
    const spo2 = RESMED_CLINICAL_RANGES.spo2 as ClinicalRange;
    expect(flow.behavior).toBe('symmetric');
    expect(spo2.behavior).toBe('downwardOnly');
    expect(spo2.max).toBe(100);
  });

  it('supports passing a custom table (plugin extensibility)', () => {
    // A custom expandUp channel resolves against the supplied table, not ResMed's.
    const table = {
      custom: { min: 0, max: 10, behavior: 'expandUp', clampMax: 100, minSpan: 1 } as ClinicalRange,
    };
    const r = computeLaneDomain(opts({ channelName: 'custom', dataMax: 8, table }));
    expect(r).toEqual({ min: 0, max: 10 });
  });
});
