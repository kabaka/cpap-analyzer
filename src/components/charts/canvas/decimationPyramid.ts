/**
 * Multi-resolution decimation pyramid for high-frequency CPAP waveforms.
 *
 * The Signal Viewer's interactive pan/wheel-zoom hot path re-slices the full
 * channel data and runs LTTB (Largest Triangle Three Buckets) downsampling on
 * the visible slice once per animation frame. At the default whole-night view a
 * single CPAP lane holds hundreds of thousands of samples, so LTTB-on-raw is the
 * dominant per-frame cost when zoomed out (O(n) with a non-trivial inner loop),
 * multiplied across lanes.
 *
 * This module precomputes — ONCE per channel, off the first-paint path — a
 * pyramid of progressively coarser levels (each ~2× smaller than the previous).
 * At render time {@link selectPyramidLevel} picks the COARSEST level whose
 * in-viewport sample count is still comfortably larger than the LTTB target
 * (`targetPoints * OVERSCAN`), the caller slices THAT level (cheap), and the
 * existing LTTB runs on the small slice. Because the chosen level still carries
 * several samples per output pixel, the final LTTB polyline is visually
 * indistinguishable from LTTB-on-raw.
 *
 * Correctness (priority #2 — this is health data): each coarser level is built
 * with a MIN/MAX-preserving 2× reduction. Every group of four source samples
 * emits two values — its minimum and its maximum — in the temporal order they
 * occur, so a narrow spike (e.g. a flow-limitation notch or a leak transient) is
 * never averaged away as the pyramid coarsens; the extreme survives to the top
 * level.
 *
 * Zoomed-in behaviour is unchanged: for any window whose raw slice is already
 * ≤ `targetPoints * OVERSCAN`, level selection returns level 0 (the raw array),
 * so the rendered polyline is byte-identical to the previous implementation.
 *
 * @module components/charts/canvas/decimationPyramid
 */

/**
 * Overscan factor: how many source samples per LTTB output point a selected
 * level must still provide. With ~4 samples per output point feeding LTTB, the
 * min/max-preserving level reproduces the raw-LTTB polyline to sub-pixel
 * precision. Increasing this trades a little extra per-frame LTTB input for
 * higher fidelity; decreasing it risks visible deviation from raw.
 */
export const PYRAMID_OVERSCAN = 4;

/**
 * Stop adding levels once a level is at or below this many samples — a slice of
 * the base array this small is already cheap to LTTB, so coarser levels add
 * memory for no benefit.
 */
const MIN_LEVEL_SAMPLES = 256;

/** One level of the decimation pyramid. */
export interface PyramidLevel {
  /** Decimated sample values for this level (level 0 aliases the raw data). */
  readonly data: Float32Array;
  /**
   * Decimation factor relative to the base (level 0) array:
   * `factor = baseLength / data.length` (approximately, due to odd tails).
   * Level 0 has `factor === 1`.
   */
  readonly factor: number;
}

/** A built pyramid for a single channel. */
export interface DecimationPyramid {
  /** Levels ordered finest (index 0 = raw) → coarsest. */
  readonly levels: readonly PyramidLevel[];
  /** Length of the base (raw, level 0) array. */
  readonly baseLength: number;
}

/**
 * Reduce a series ~2× while preserving local extrema.
 *
 * The input is processed in groups of FOUR consecutive samples; each group emits
 * exactly TWO values — the group's minimum and its maximum — in the temporal
 * order they occur within the group (`[min, max]` when the min's index precedes
 * the max's, otherwise `[max, min]`). Four inputs → two outputs is a true 2×
 * reduction, and because BOTH the extreme low and the extreme high of every group
 * survive, a narrow spike (flow-limitation notch, leak transient, spike peak or
 * trough) is never averaged away as the pyramid coarsens; its extreme value
 * reaches the top level. Emitting in temporal order keeps the output a plausible
 * left-to-right traversal of the waveform envelope rather than an arbitrary
 * min-then-max zig-zag.
 *
 * Tail (length not divisible by 4): the trailing 1–3 samples form a final,
 * smaller group processed by the same min/max-in-temporal-order rule. A lone
 * trailing sample emits itself once.
 *
 * NaN (gap) handling: the line renderer breaks the polyline on NaN, so a group
 * containing any NaN must still surface a NaN in its output to preserve the gap.
 * Such a group emits one NaN (keeping the break) and, when the group has any
 * non-NaN samples, one real extreme of those samples (the more extreme of their
 * min/max by absolute magnitude, so a spike adjacent to a gap is not lost),
 * placed in temporal order relative to where the NaN falls. A wholly-NaN group
 * emits two NaNs. The group's OPPOSITE real extreme is dropped — only two output
 * slots exist for the {NaN, min, max} trio, and keeping the break over fabricating
 * continuity across missing data is the correctness-preserving choice. This is
 * bounded to the 1–2 groups straddling a gap EDGE (a mask-off / sensor-dropout
 * boundary — therapy-transition samples, not scored physiology) and only at the
 * coarse levels reached when zoomed out; level 0 is lossless, so zooming in to
 * inspect any transient shows both extremes. Reviewed and accepted by the
 * resmed-specialist. NOTE: the absolute-magnitude tiebreak is tuned for the
 * zero-centered FLOW channel (largest excursion in either direction is salient);
 * for strictly-positive offset channels (mask pressure, leak) it degenerates to
 * "keep the max", which is acceptable here — at a gap edge these are blower
 * ramp transients, and for leak the upward excursion is the clinically relevant one.
 *
 * Output-length formula. For `n = input.length`:
 *   - `n <= 1`            → `n`   (returns a length-matched copy; never shrinks
 *                                  below 2 inputs, which keeps the pyramid loop
 *                                  from spinning on tiny arrays).
 *   - `n >= 2`            → `2 * ceil(n / 4)`.
 * For any `n >= 2` this is strictly less than `n` (e.g. 2→2 is the lone equal
 * case at n=2; for n=3 →2, n=4 →2, n=5 →4, …, n=720000 →360000), so each pyramid
 * level is ~2× smaller than the previous and the pyramid genuinely grows levels.
 */
export function decimateMinMax(input: Float32Array): Float32Array {
  const n = input.length;
  if (n <= 1) {
    const copy = new Float32Array(n);
    copy.set(input);
    return copy;
  }
  const groupCount = Math.ceil(n / 4);
  const out = new Float32Array(groupCount * 2);

  let w = 0;
  for (let g = 0; g < n; g += 4) {
    const end = Math.min(g + 4, n);

    // Locate the min and max over the group's non-NaN samples, tracking their
    // positions so we can emit in temporal order. Also detect any NaN so the
    // renderer's gap break survives the reduction.
    let minVal = Infinity;
    let maxVal = -Infinity;
    let minIdx = -1;
    let maxIdx = -1;
    let nanIdx = -1;
    for (let i = g; i < end; i++) {
      const v = input[i] as number;
      if (Number.isNaN(v)) {
        if (nanIdx < 0) nanIdx = i;
        continue;
      }
      if (v < minVal) {
        minVal = v;
        minIdx = i;
      }
      if (v > maxVal) {
        maxVal = v;
        maxIdx = i;
      }
    }

    if (nanIdx >= 0) {
      // Gap group: must emit a NaN to break the polyline. If the group also has
      // real samples, surface the single most-extreme one (by absolute value, so
      // a spike beside a gap is preserved) as the other output, ordered by which
      // index comes first in time.
      if (minIdx < 0) {
        // Wholly NaN.
        out[w++] = NaN;
        out[w++] = NaN;
      } else {
        const useMax = Math.abs(maxVal) >= Math.abs(minVal);
        const extremeVal = useMax ? maxVal : minVal;
        const extremeIdx = useMax ? maxIdx : minIdx;
        if (extremeIdx < nanIdx) {
          out[w++] = extremeVal;
          out[w++] = NaN;
        } else {
          out[w++] = NaN;
          out[w++] = extremeVal;
        }
      }
      continue;
    }

    // No NaN: emit min and max in temporal order.
    if (minIdx <= maxIdx) {
      out[w++] = minVal;
      out[w++] = maxVal;
    } else {
      out[w++] = maxVal;
      out[w++] = minVal;
    }
  }

  return out;
}

/**
 * Build a decimation pyramid for one channel's full-resolution data.
 *
 * Level 0 aliases `base` (no copy — the pyramid does not own it). Each
 * subsequent level is a 2× min/max-preserving reduction of the previous, until a
 * level drops to {@link MIN_LEVEL_SAMPLES} or fewer. The summed length of all
 * levels above level 0 is bounded by the base length (geometric series), so the
 * pyramid costs ≤ ~1× the base array in extra memory per channel.
 *
 * Pure and synchronous; the caller is responsible for building it OFF the
 * first-paint path (e.g. deferred a frame after data load).
 */
export function buildDecimationPyramid(base: Float32Array): DecimationPyramid {
  const levels: PyramidLevel[] = [{ data: base, factor: 1 }];
  const baseLength = base.length;
  if (baseLength === 0) {
    return { levels, baseLength };
  }

  let current = base;
  while (current.length > MIN_LEVEL_SAMPLES) {
    const next = decimateMinMax(current);
    // Guard against non-shrinking reductions (n <= 1 returns a copy of equal
    // length); never loop forever.
    if (next.length >= current.length) break;
    levels.push({ data: next, factor: baseLength / next.length });
    current = next;
  }

  return { levels, baseLength };
}

/** Result of selecting a pyramid level for a viewport slice. */
export interface PyramidSlice {
  /** The level's full data array to slice from. */
  readonly data: Float32Array;
  /** Inclusive start index into `data` for the viewport. */
  readonly startIndex: number;
  /** Exclusive end index into `data` for the viewport. */
  readonly endIndex: number;
  /** Index of the chosen level within {@link DecimationPyramid.levels}. */
  readonly levelIndex: number;
}

/**
 * Select the coarsest pyramid level whose in-viewport sample count is still at
 * least `targetPoints * PYRAMID_OVERSCAN`, and map the viewport's base-array
 * sample range onto that level's indices.
 *
 * The viewport is given as base-level sample indices `[baseStart, baseEnd)`
 * (the same indices the caller would `subarray` from the raw data). The returned
 * slice bounds are computed by scaling those indices by each level's decimation
 * factor and are clamped to the level's length.
 *
 * Returns level 0 (raw) whenever the raw viewport span is already
 * ≤ `targetPoints * PYRAMID_OVERSCAN`, making zoomed-in renders byte-identical to
 * slicing the raw data directly.
 *
 * @param pyramid      - The channel's pyramid.
 * @param baseStart    - Inclusive start sample index into the base array.
 * @param baseEnd      - Exclusive end sample index into the base array.
 * @param targetPoints - The LTTB output point count for this frame.
 */
export function selectPyramidLevel(
  pyramid: DecimationPyramid,
  baseStart: number,
  baseEnd: number,
  targetPoints: number,
): PyramidSlice {
  const { levels, baseLength } = pyramid;
  const start = Math.max(0, Math.min(baseStart, baseLength));
  const end = Math.max(start, Math.min(baseEnd, baseLength));
  const spanSamples = end - start;
  const minSamples = Math.max(2, targetPoints) * PYRAMID_OVERSCAN;

  // Walk from coarsest → finest and pick the first (coarsest) level that still
  // has at least `minSamples` samples inside the viewport. Falls through to
  // level 0 (raw) when even the raw span is below the threshold (zoomed in).
  for (let li = levels.length - 1; li >= 1; li--) {
    const level = levels[li];
    if (!level) continue;
    const levelLen = level.data.length;
    if (levelLen === 0) continue;
    // Samples of THIS level that fall within the viewport.
    const levelSpan = spanSamples / level.factor;
    if (levelSpan >= minSamples) {
      const scale = levelLen / baseLength;
      const li0 = Math.floor(start * scale);
      const li1 = Math.min(levelLen, Math.ceil(end * scale));
      return {
        data: level.data,
        startIndex: Math.max(0, Math.min(li0, levelLen)),
        endIndex: Math.max(li0, li1),
        levelIndex: li,
      };
    }
  }

  const raw = levels[0]?.data ?? new Float32Array(0);
  return { data: raw, startIndex: start, endIndex: end, levelIndex: 0 };
}
