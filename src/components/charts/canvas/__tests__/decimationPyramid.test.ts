/**
 * Unit tests for the multi-resolution decimation pyramid.
 *
 * These tests pin the public contract of {@link decimateMinMax},
 * {@link buildDecimationPyramid} and {@link selectPyramidLevel}: zoomed-in
 * renders must stay byte-identical to raw slicing, zoomed-out renders must pick
 * the coarsest level that still satisfies the overscan invariant, index mapping
 * must preserve the viewport's time span, and — critically for health data —
 * narrow spikes must survive to the coarsest level rather than being averaged
 * away.
 *
 * @module components/charts/canvas/__tests__/decimationPyramid.test
 */

import { describe, it, expect } from 'vitest';
import {
  decimateMinMax,
  buildDecimationPyramid,
  selectPyramidLevel,
  PYRAMID_OVERSCAN,
} from '../decimationPyramid';

/** Mirrors the (private) MIN_LEVEL_SAMPLES stop condition in the module. */
const MIN_LEVEL_SAMPLES = 256;

/** Largest value across a (sub)array, ignoring NaN. */
function maxOf(data: Float32Array, start = 0, end = data.length): number {
  let m = -Infinity;
  for (let i = start; i < end; i++) {
    const v = data[i] as number;
    if (!Number.isNaN(v) && v > m) m = v;
  }
  return m;
}

/** Smallest value across a (sub)array, ignoring NaN. */
function minOf(data: Float32Array, start = 0, end = data.length): number {
  let m = Infinity;
  for (let i = start; i < end; i++) {
    const v = data[i] as number;
    if (!Number.isNaN(v) && v < m) m = v;
  }
  return m;
}

/** A smooth-ish synthetic waveform of the requested length. */
function makeWave(length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = Math.sin(i * 0.01) * 10 + Math.cos(i * 0.0007) * 3;
  }
  return out;
}

// ── decimateMinMax ───────────────────────────────────────────────

describe('decimateMinMax', () => {
  it('reduces a 4-sample group to its [min, max] in temporal order (min first)', () => {
    // Group (1, 5, 2, 8): min=1 at idx0, max=8 at idx3 -> min precedes max.
    const out = decimateMinMax(Float32Array.of(1, 5, 2, 8));
    expect(Array.from(out)).toEqual([1, 8]);
  });

  it('emits [max, min] when the max occurs before the min within the group', () => {
    // Group (8, 5, 2, 1): max=8 at idx0, min=1 at idx3 -> max precedes min.
    const out = decimateMinMax(Float32Array.of(8, 5, 2, 1));
    expect(Array.from(out)).toEqual([8, 1]);
  });

  it('reduces two 4-sample groups to 4 outputs (2× reduction)', () => {
    // Group A (3, 1, 9, 4): min=1@1, max=9@2 -> [1, 9].
    // Group B (7, 2, 5, 6): min=2@1, max=7@0 -> max precedes min -> [7, 2].
    const out = decimateMinMax(Float32Array.of(3, 1, 9, 4, 7, 2, 5, 6));
    expect(Array.from(out)).toEqual([1, 9, 7, 2]);
    expect(out.length).toBe(4);
  });

  it('handles a 3-sample tail group with min/max in temporal order', () => {
    // Group A (5, 4, 9, 1): min=1@3, max=9@2 -> max precedes min -> [9, 1].
    // Tail (2, 8, 3): min=2@0, max=8@1 -> min precedes max -> [2, 8].
    const out = decimateMinMax(Float32Array.of(5, 4, 9, 1, 2, 8, 3));
    expect(Array.from(out)).toEqual([9, 1, 2, 8]);
    expect(out.length).toBe(4);
  });

  it('handles a 2-sample tail group', () => {
    // Group A (1, 2, 3, 8) -> [1, 8]. Tail (7, 4): min=4@1, max=7@0 -> [7, 4].
    const out = decimateMinMax(Float32Array.of(1, 2, 3, 8, 7, 4));
    expect(Array.from(out)).toEqual([1, 8, 7, 4]);
    expect(out.length).toBe(4);
  });

  it('emits a lone trailing sample once', () => {
    // Group A (5, 4, 9, 1) -> [9, 1]. Tail (7): single sample -> [7] (emitted once).
    const out = decimateMinMax(Float32Array.of(5, 4, 9, 1, 7));
    expect(out.length).toBe(4); // 2 groups -> 4 outputs
    expect(out[0]).toBe(9);
    expect(out[1]).toBe(1);
    // The lone tail emits its single value as both min and max (it is its own
    // extreme). The contract only requires that its value survives.
    expect(out[2]).toBe(7);
    expect(out[3]).toBe(7);
  });

  it('preserves a gap: a NaN group emits a NaN to break the polyline plus the real extreme', () => {
    // Group (NaN, 7, 2, 1): non-NaN min=1, max=7; |7| >= |1| so surface 7 (@1).
    // NaN is at idx0 which precedes the extreme @1 -> [NaN, 7].
    const out = decimateMinMax(Float32Array.of(NaN, 7, 2, 1));
    expect(out.length).toBe(2);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBe(7);
  });

  it('surfaces a real extreme alongside the gap when the extreme precedes the NaN', () => {
    // Group (9, 2, NaN, 1): non-NaN min=1, max=9; surface 9 (@0). NaN @2 follows
    // the extreme -> [9, NaN].
    const out = decimateMinMax(Float32Array.of(9, 2, NaN, 1));
    expect(out.length).toBe(2);
    expect(out[0]).toBe(9);
    expect(out[1]).toBeNaN();
  });

  it('preserves a spike adjacent to a gap (most-extreme-by-magnitude survives)', () => {
    // Group (NaN, 1, 1, -640): a deep trough sits next to a gap. The trough's
    // magnitude dominates, so it must survive while the gap break is kept.
    const out = decimateMinMax(Float32Array.of(NaN, 1, 1, -640));
    expect(out.length).toBe(2);
    // One output is the NaN break, the other is the surviving trough.
    const values = Array.from(out);
    expect(values.some((v) => Number.isNaN(v))).toBe(true);
    expect(values.some((v) => v === -640)).toBe(true);
  });

  it('drops the secondary extreme of a gap group (documented, clinically signed-off trade-off)', () => {
    // Group (NaN, 2, -50, 50): three things compete for two output slots — the
    // NaN break, the real min (-50), and the real max (50). The rule keeps the
    // NaN break plus the most-extreme-by-magnitude real sample (|50| === |-50|,
    // tie -> max), so the -50 trough is dropped at this COARSE level: [NaN, 50].
    // This is bounded to gap EDGES at zoomed-out levels only (level 0 is lossless)
    // and was reviewed and accepted by the resmed-specialist; pinned here so the
    // trade-off cannot silently regress. See decimateMinMax docblock.
    const out = decimateMinMax(Float32Array.of(NaN, 2, -50, 50));
    expect(out.length).toBe(2);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBe(50);
  });

  it('emits two NaNs for a wholly-NaN group', () => {
    const out = decimateMinMax(Float32Array.of(NaN, NaN, NaN, NaN));
    expect(out.length).toBe(2);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
  });

  it('returns a length-matched copy for n <= 1', () => {
    const single = Float32Array.of(42);
    const out = decimateMinMax(single);
    expect(out.length).toBe(1);
    expect(out[0]).toBe(42);
    expect(out).not.toBe(single); // a copy, not an alias

    const empty = decimateMinMax(new Float32Array(0));
    expect(empty.length).toBe(0);
  });

  it('output length is 2 * ceil(n / 4) for n >= 2 (true 2× reduction)', () => {
    expect(decimateMinMax(makeWave(2)).length).toBe(2); // 2*ceil(2/4)=2
    expect(decimateMinMax(makeWave(3)).length).toBe(2); // 2*ceil(3/4)=2
    expect(decimateMinMax(makeWave(4)).length).toBe(2); // 2*ceil(4/4)=2
    expect(decimateMinMax(makeWave(5)).length).toBe(4); // 2*ceil(5/4)=4
    expect(decimateMinMax(makeWave(10)).length).toBe(6); // 2*ceil(10/4)=6
    expect(decimateMinMax(makeWave(1000)).length).toBe(500);
    expect(decimateMinMax(makeWave(1001)).length).toBe(502); // 2*ceil(1001/4)=2*251
    expect(decimateMinMax(makeWave(720_000)).length).toBe(360_000);
  });

  it('shrinks strictly for every n >= 3 so the pyramid grows levels', () => {
    for (const n of [3, 4, 5, 8, 9, 256, 1000, 720_001]) {
      expect(decimateMinMax(makeWave(n)).length).toBeLessThan(n);
    }
  });
});

// ── buildDecimationPyramid ───────────────────────────────────────

describe('buildDecimationPyramid', () => {
  it('aliases the base array as level 0 with factor 1', () => {
    const base = makeWave(100_000);
    const pyramid = buildDecimationPyramid(base);
    expect(pyramid.baseLength).toBe(100_000);
    expect(pyramid.levels[0]?.data).toBe(base); // identity, no copy
    expect(pyramid.levels[0]?.factor).toBe(1);
  });

  it('halves (~2×) length each level until at or below MIN_LEVEL_SAMPLES', () => {
    const pyramid = buildDecimationPyramid(makeWave(720_000));
    const top = pyramid.levels[pyramid.levels.length - 1];
    expect(pyramid.levels.length).toBeGreaterThan(1);
    expect(top?.data.length).toBeLessThanOrEqual(MIN_LEVEL_SAMPLES);

    // Every level except the top is still above the stop threshold.
    for (let i = 0; i < pyramid.levels.length - 1; i++) {
      expect((pyramid.levels[i] as { data: Float32Array }).data.length).toBeGreaterThan(
        MIN_LEVEL_SAMPLES,
      );
    }

    // Each level is ~2× smaller than the previous (true 2× reduction).
    for (let i = 1; i < pyramid.levels.length; i++) {
      const prev = (pyramid.levels[i - 1] as { data: Float32Array }).data.length;
      const cur = (pyramid.levels[i] as { data: Float32Array }).data.length;
      const ratio = prev / cur;
      expect(ratio).toBeGreaterThan(1.8);
      expect(ratio).toBeLessThan(2.2);
    }
  });

  it('sets each level factor to baseLength / level.data.length', () => {
    const pyramid = buildDecimationPyramid(makeWave(720_000));
    for (let i = 1; i < pyramid.levels.length; i++) {
      const level = pyramid.levels[i] as { data: Float32Array; factor: number };
      const expected = pyramid.baseLength / level.data.length;
      expect(level.factor).toBeCloseTo(expected, 6);
      // Roughly 2** coarser per level. Tail rounding (each level is
      // 2 * ceil(len / 4)) makes the factor drift slightly below the ideal
      // 2 ** i as levels accumulate, so assert a tolerant band around it rather
      // than sub-0.5 precision.
      expect(level.factor).toBeGreaterThan(2 ** i * 0.9);
      expect(level.factor).toBeLessThan(2 ** i * 1.1);
    }
  });

  it('keeps total extra memory bounded by ~base length (geometric series)', () => {
    const base = makeWave(720_000);
    const pyramid = buildDecimationPyramid(base);
    let above0 = 0;
    for (let i = 1; i < pyramid.levels.length; i++) {
      above0 += (pyramid.levels[i] as { data: Float32Array }).data.length;
    }
    expect(above0).toBeLessThanOrEqual(1.1 * pyramid.baseLength);
  });

  it('builds only level 0 when the base is already at or below MIN_LEVEL_SAMPLES', () => {
    const small = buildDecimationPyramid(makeWave(MIN_LEVEL_SAMPLES));
    expect(small.levels.length).toBe(1);
    expect(small.levels[0]?.factor).toBe(1);

    const tiny = buildDecimationPyramid(makeWave(10));
    expect(tiny.levels.length).toBe(1);
  });

  it('returns a single level with baseLength 0 for an empty base array', () => {
    const pyramid = buildDecimationPyramid(new Float32Array(0));
    expect(pyramid.levels.length).toBe(1);
    expect(pyramid.baseLength).toBe(0);
    expect(pyramid.levels[0]?.data.length).toBe(0);
  });
});

// ── selectPyramidLevel: zoomed in (level 0) ──────────────────────

describe('selectPyramidLevel — small windows', () => {
  it('returns raw level 0 byte-identical to slicing when the span is below threshold', () => {
    const base = makeWave(720_000);
    const pyramid = buildDecimationPyramid(base);
    const targetPoints = 2000;
    // A window strictly smaller than targetPoints * OVERSCAN samples.
    const baseStart = 100_000;
    const baseEnd = baseStart + targetPoints * PYRAMID_OVERSCAN - 1;

    const slice = selectPyramidLevel(pyramid, baseStart, baseEnd, targetPoints);

    expect(slice.levelIndex).toBe(0);
    expect(slice.data).toBe(base); // the raw array itself
    expect(slice.startIndex).toBe(baseStart);
    expect(slice.endIndex).toBe(baseEnd);

    // The rendered slice equals a direct subarray of raw — byte-for-byte.
    expect(base.subarray(slice.startIndex, slice.endIndex)).toEqual(
      base.subarray(baseStart, baseEnd),
    );
  });

  it('clamps a window that runs off the start/end of the base array', () => {
    const base = makeWave(720_000);
    const pyramid = buildDecimationPyramid(base);
    const targetPoints = 2000;
    // Below-threshold span (so we stay on level 0) but out of bounds on both ends.
    const slice = selectPyramidLevel(pyramid, -500, base.length + 500, targetPoints);

    // The clamp collapses to [0, baseLength) but the resulting span is the whole
    // array, which is far above threshold — so it will NOT be level 0 here.
    // Use a genuinely tiny array to exercise the clamped level-0 path instead.
    const tiny = buildDecimationPyramid(makeWave(50));
    const tinySlice = selectPyramidLevel(tiny, -10, 999, 8);
    expect(tinySlice.levelIndex).toBe(0);
    expect(tinySlice.startIndex).toBe(0);
    expect(tinySlice.endIndex).toBe(50);

    // The large-array call still produced sane, clamped bounds.
    expect(slice.startIndex).toBeGreaterThanOrEqual(0);
    expect(slice.endIndex).toBeLessThanOrEqual(slice.data.length);
  });
});

// ── selectPyramidLevel: zoomed out (coarser level) ───────────────

describe('selectPyramidLevel — large windows', () => {
  it('picks a coarser level that still satisfies the overscan invariant', () => {
    const base = makeWave(720_000);
    const pyramid = buildDecimationPyramid(base);
    const targetPoints = 2000;
    const minSamples = targetPoints * PYRAMID_OVERSCAN;

    const slice = selectPyramidLevel(pyramid, 0, base.length, targetPoints);

    expect(slice.levelIndex).toBeGreaterThanOrEqual(1);

    // In-viewport sample count of the chosen level (whole array => ~ level len).
    const chosenLevel = pyramid.levels[slice.levelIndex] as { factor: number };
    const chosenLevelSpan = base.length / chosenLevel.factor;
    expect(chosenLevelSpan).toBeGreaterThanOrEqual(minSamples);
  });

  it('picks the COARSEST level satisfying the invariant — next coarser falls below it', () => {
    const base = makeWave(720_000);
    const pyramid = buildDecimationPyramid(base);
    const targetPoints = 2000;
    const minSamples = targetPoints * PYRAMID_OVERSCAN;

    const slice = selectPyramidLevel(pyramid, 0, base.length, targetPoints);
    const nextCoarserIndex = slice.levelIndex + 1;

    // If a coarser level exists, it MUST fail the invariant (otherwise it would
    // have been chosen instead).
    if (nextCoarserIndex < pyramid.levels.length) {
      const next = pyramid.levels[nextCoarserIndex] as { factor: number };
      const nextSpan = base.length / next.factor;
      expect(nextSpan).toBeLessThan(minSamples);
    } else {
      // Chosen level is the literal coarsest; nothing coarser to undercut it.
      expect(slice.levelIndex).toBe(pyramid.levels.length - 1);
    }
  });

  it('maps the level-space window to the same time span as the base window', () => {
    const base = makeWave(720_000);
    const pyramid = buildDecimationPyramid(base);
    const targetPoints = 1000;
    const baseStart = 120_000;
    const baseEnd = 600_000;

    const slice = selectPyramidLevel(pyramid, baseStart, baseEnd, targetPoints);
    const level = pyramid.levels[slice.levelIndex] as { data: Float32Array };
    const scale = level.data.length / pyramid.baseLength;

    // startIndex / endIndex track baseStart / baseEnd scaled by the level ratio,
    // within rounding (floor on start, ceil on end => ±1 level-sample). This holds
    // for any selected level, including the coarse (scale < 1) level a whole-night
    // zoom-out lands on and level 0 (scale === 1) for zoomed-in windows.
    expect(slice.startIndex).toBeCloseTo(baseStart * scale, -1);
    expect(slice.endIndex).toBeCloseTo(baseEnd * scale, -1);
    expect(Math.abs(slice.startIndex - Math.floor(baseStart * scale))).toBeLessThanOrEqual(1);
    expect(Math.abs(slice.endIndex - Math.ceil(baseEnd * scale))).toBeLessThanOrEqual(1);

    // Bounds stay inside the level.
    expect(slice.startIndex).toBeGreaterThanOrEqual(0);
    expect(slice.endIndex).toBeLessThanOrEqual(level.data.length);
    expect(slice.endIndex).toBeGreaterThanOrEqual(slice.startIndex);
  });

  // Once the pyramid genuinely coarsens, a whole-array zoom-out lands on a level
  // with scale < 1, so the level-space window is strictly NARROWER than the base
  // window.
  it('scales the window down onto a coarser (scale < 1) level', () => {
    const base = makeWave(720_000);
    const pyramid = buildDecimationPyramid(base);
    const baseStart = 0;
    const baseEnd = base.length;

    const slice = selectPyramidLevel(pyramid, baseStart, baseEnd, 2000);
    const level = pyramid.levels[slice.levelIndex] as { data: Float32Array };
    const scale = level.data.length / pyramid.baseLength;

    expect(scale).toBeLessThan(1);
    expect(slice.endIndex - slice.startIndex).toBeLessThan(baseEnd - baseStart);
  });

  it('does not throw and returns an empty-ish slice for an empty pyramid', () => {
    const pyramid = buildDecimationPyramid(new Float32Array(0));
    const slice = selectPyramidLevel(pyramid, 0, 100, 2000);
    expect(slice.levelIndex).toBe(0);
    expect(slice.data.length).toBe(0);
    expect(slice.startIndex).toBe(0);
    expect(slice.endIndex).toBe(0);
  });
});

// ── Peak preservation (correctness — health data) ────────────────

describe('peak preservation through the pyramid', () => {
  // The pyramid genuinely coarsens (decimateMinMax is a true 2× min/max-preserving
  // reduction), so "the coarsest level" below is a real, far-from-raw level. These
  // checks exercise spike survival THROUGH many rounds of coarsening — the
  // correctness guarantee that matters for health data.

  // The genuine, level-independent guarantee: one round of min/max reduction never
  // drops a 1-sample spike's extreme.
  it('decimateMinMax keeps a 1-sample spike extreme through one reduction', () => {
    const n = 4096;
    const input = new Float32Array(n).fill(1);
    input[1234] = 777; // positive spike
    input[2345] = -640; // negative spike
    const out = decimateMinMax(input);
    expect(maxOf(out)).toBeCloseTo(777, 2);
    expect(minOf(out)).toBeCloseTo(-640, 2);
  });

  // Real correctness for health data: the spike must survive into a level that is
  // NOT level 0 — i.e. through actual coarsening, not merely by living in the raw
  // array. With a working multi-level pyramid this is a hard guarantee.
  it('a narrow spike survives into a coarser (non-raw) level', () => {
    const length = 100_000;
    const base = new Float32Array(length).fill(1);
    const spikeValue = 250;
    base[54_321] = spikeValue;

    const pyramid = buildDecimationPyramid(base);
    // At least one coarser level beyond raw, and the spike present there.
    expect(pyramid.levels.length).toBeGreaterThan(1);
    const coarser = pyramid.levels[pyramid.levels.length - 1] as { data: Float32Array };
    expect(coarser.data.length).toBeLessThan(base.length); // genuinely coarser
    expect(maxOf(coarser.data)).toBeCloseTo(spikeValue, 2);
  });

  it('keeps a narrow positive spike in the coarsest level (not averaged away)', () => {
    const length = 100_000;
    const base = new Float32Array(length).fill(1);
    const spikeValue = 250;
    base[54_321] = spikeValue; // single-sample spike amid a flat field of 1s

    const pyramid = buildDecimationPyramid(base);
    const coarsest = pyramid.levels[pyramid.levels.length - 1] as { data: Float32Array };

    // The spike's extreme value survives min/max reduction to the top level.
    expect(maxOf(coarsest.data)).toBeCloseTo(spikeValue, 2);
  });

  it('keeps a 2-sample positive spike in the coarsest level', () => {
    const length = 100_000;
    const base = new Float32Array(length).fill(1);
    const spikeValue = 300;
    base[40_000] = spikeValue;
    base[40_001] = spikeValue;

    const pyramid = buildDecimationPyramid(base);
    const coarsest = pyramid.levels[pyramid.levels.length - 1] as { data: Float32Array };
    expect(maxOf(coarsest.data)).toBeCloseTo(spikeValue, 2);
  });

  it('keeps a narrow negative spike (trough) in the coarsest level', () => {
    const length = 100_000;
    const base = new Float32Array(length).fill(1);
    const troughValue = -180;
    base[77_777] = troughValue; // single deep negative spike

    const pyramid = buildDecimationPyramid(base);
    const coarsest = pyramid.levels[pyramid.levels.length - 1] as { data: Float32Array };
    expect(minOf(coarsest.data)).toBeCloseTo(troughValue, 2);
  });

  it('preserves the spike extreme at EVERY level, not just the coarsest', () => {
    const length = 100_000;
    const base = new Float32Array(length).fill(0);
    const spikeValue = 500;
    base[12_345] = spikeValue;

    const pyramid = buildDecimationPyramid(base);
    for (const level of pyramid.levels) {
      expect(maxOf(level.data)).toBeCloseTo(spikeValue, 2);
    }
  });
});
