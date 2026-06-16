/**
 * Triangle-strip geometry for the zoomed-OUT min/max envelope band.
 *
 * The Canvas2D reference ({@link
 * module:components/charts/canvas/SignalRenderer} `drawEnvelope`) draws, per
 * contiguous run of non-gap columns, a single closed path: the upper boundary
 * (`max`) left→right then the lower boundary (`min`) right→left, then `fill()` +
 * `stroke()` at {@link DENSE_LINE_WIDTH} (1.2 px). Where the band is thin (≈1 px)
 * the fill+stroke reads as a ~1.2 px line; where it is tall it reads as a solid
 * envelope. A column with `min === max === NaN` is a **gap** and BREAKS the band.
 * Each column's centre sits at `plotLeft + (c + 0.5) * (plotWidth / cols)`.
 *
 * In WebGL2 that same band is a **triangle strip**: two vertices per column — the
 * column's `max` (upper) and `min` (lower), both at the same X (the column
 * centre) — emitted left→right. A strip of `2N` vertices renders `2N - 2`
 * triangles forming the filled band, which is the GPU-native equivalent of the
 * Canvas2D closed fill. Gaps are handled with **primitive-restart**: an index of
 * {@link PRIMITIVE_RESTART_INDEX} between two runs tells WebGL to start a fresh
 * strip, so no triangle bridges a gap (mirroring how `flushRun` emits each run as
 * its own closed band).
 *
 * This module produces:
 *   - a `Float32Array` of interleaved vertex attributes `[xData, yValue]` per
 *     vertex (data-space; the vertex shader applies the clip transform), and
 *   - a `Uint32Array` index buffer with primitive-restart sentinels at gap
 *     boundaries.
 *
 * MIN-THICKNESS CLAMP (fidelity)
 * ------------------------------
 * The Canvas2D stroke gives even a zero-height band (`min === max`) a perceived
 * weight of ~1.2 px. A bare triangle strip with `min === max` is degenerate
 * (zero area) and would vanish. To replicate the stroke's perceived weight, each
 * column's [min, max] value pair is separated to span **at least
 * {@link DENSE_LINE_WIDTH} CSS px** about its centre value. Because the clamp is a
 * *pixel* quantity but the vertices are in *value* space, the caller supplies the
 * value-per-CSS-px scale for the lane (`valuePerPx`, the magnitude of the Y
 * transform's css-px → value factor) so the clamp can be expressed in value
 * units. The clamp only ever WIDENS a band, never narrows it, so a genuine spike
 * column (already taller than 1.2 px) is untouched and still reaches its extreme
 * pixel — the extrema-preservation contract holds by construction (unit-tested).
 *
 * Everything here is **pure** and unit-tested; no GL context is touched. Width
 * for the *fill* edge is exact (the clamped strip); the additional shader
 * feathering that matches the 1.2 px AA stroke lives in the envelope fragment
 * shader.
 *
 * @module components/charts/webgl/envelopeGeometry
 */

/** Dense-waveform stroke width in CSS px — must match the Canvas2D renderer. */
export const DENSE_LINE_WIDTH = 1.2;

/**
 * Primitive-restart sentinel index. With `gl.enable(PRIMITIVE_RESTART_FIXED_INDEX)`
 * WebGL2 treats the maximum value of the index type (here `0xffffffff` for
 * `UNSIGNED_INT`) as "end this primitive, start a new one". We emit it between
 * runs so a gap never bridges two strips.
 */
export const PRIMITIVE_RESTART_INDEX = 0xffffffff;

/** Floats per envelope vertex: `[xData, yValue]`. */
export const ENVELOPE_VERTEX_STRIDE = 2;

/** Per-column source envelope (physical min/max), as produced by the worker. */
export interface ColumnEnvelopeInput {
  /** Per-column minima. NaN marks a gap column. */
  readonly min: Float32Array;
  /** Per-column maxima. NaN marks a gap column. */
  readonly max: Float32Array;
  /** Number of populated columns. */
  readonly columns: number;
}

/** Parameters describing how columns map to data-space X and the thickness clamp. */
export interface EnvelopeGeometryParams {
  /**
   * Data-space X of column `c`'s centre is `xData(c) = dataXStart + (c + 0.5) *
   * dataXPerColumn`. The caller derives `dataXStart` / `dataXPerColumn` so that,
   * after the clip transform, the column centre lands exactly where the Canvas2D
   * `plotLeft + (c + 0.5) * (plotWidth / cols)` would. For a viewport spanning
   * the whole slice, `dataXStart = viewStart` and `dataXPerColumn = viewSpan /
   * cols`.
   */
  readonly dataXStart: number;
  /** Data-space X width of one column (see {@link dataXStart}). */
  readonly dataXPerColumn: number;
  /**
   * Value units per CSS pixel for this lane's Y axis (magnitude). Used to express
   * the {@link DENSE_LINE_WIDTH} min-thickness clamp in value space:
   * `minValueSpan = DENSE_LINE_WIDTH * valuePerPx`. Pass the magnitude of
   * `physRange / innerHeight`.
   */
  readonly valuePerPx: number;
}

/** The built triangle-strip geometry for one channel's envelope. */
export interface EnvelopeGeometry {
  /**
   * Interleaved vertex attributes `[xData, yValue]`, two vertices per non-gap
   * column (upper = max, lower = min). Length = `2 * nonGapColumns *
   * ENVELOPE_VERTEX_STRIDE`.
   */
  readonly vertices: Float32Array;
  /**
   * Triangle-strip indices into {@link vertices} (by vertex, not float), with
   * {@link PRIMITIVE_RESTART_INDEX} separating runs. Drawn with
   * `gl.TRIANGLE_STRIP` and primitive restart enabled.
   */
  readonly indices: Uint32Array;
  /** Number of vertices emitted (`vertices.length / ENVELOPE_VERTEX_STRIDE`). */
  readonly vertexCount: number;
  /** Number of contiguous non-gap runs (each rendered as one strip). */
  readonly runCount: number;
}

/**
 * Build a triangle-strip envelope from per-column min/max.
 *
 * For each non-gap column we emit two vertices at the column centre X: the upper
 * (`max`) then the lower (`min`). Index order is `upper, lower` per column so the
 * strip walks `u0, l0, u1, l1, …` — the standard band triangulation. Between two
 * runs separated by one or more gap columns we emit a single
 * {@link PRIMITIVE_RESTART_INDEX}, so the GPU starts a fresh strip and no triangle
 * spans the gap.
 *
 * The min-thickness clamp widens any column whose `max - min` is below the 1.2 px
 * equivalent (`minValueSpan`) symmetrically about its midpoint, so a flat or
 * single-sample column still renders a ~1.2 px ribbon. A taller column (a real
 * spike) is left exactly as-is, guaranteeing its extreme value reaches a vertex
 * (extrema-preservation contract).
 *
 * @param env    - Per-column min/max (NaN = gap).
 * @param params - Column→data-X mapping and the value-space thickness clamp.
 */
export function buildEnvelopeGeometry(
  env: ColumnEnvelopeInput,
  params: EnvelopeGeometryParams,
): EnvelopeGeometry {
  const cols = Math.max(0, Math.min(env.columns, env.min.length, env.max.length));
  const { dataXStart, dataXPerColumn, valuePerPx } = params;
  const minValueSpan = DENSE_LINE_WIDTH * Math.abs(valuePerPx);

  // First pass: count non-gap columns and runs so we can size buffers exactly
  // (no growable arrays on what becomes a GPU upload).
  let nonGapColumns = 0;
  let runCount = 0;
  let inRun = false;
  for (let c = 0; c < cols; c++) {
    const isGap = Number.isNaN(env.min[c] as number) || Number.isNaN(env.max[c] as number);
    if (isGap) {
      inRun = false;
    } else {
      nonGapColumns++;
      if (!inRun) {
        runCount++;
        inRun = true;
      }
    }
  }

  const vertexCount = nonGapColumns * 2;
  const vertices = new Float32Array(vertexCount * ENVELOPE_VERTEX_STRIDE);
  // Indices: one per vertex, plus one restart sentinel between consecutive runs
  // (runCount - 1 sentinels when runCount > 0).
  const indexLength = vertexCount + (runCount > 0 ? runCount - 1 : 0);
  const indices = new Uint32Array(indexLength);

  let v = 0; // vertex index (counts vertices, not floats)
  let vf = 0; // float write cursor into `vertices`
  let iw = 0; // write cursor into `indices`
  let prevWasGap = true;
  let emittedAnyRun = false;

  for (let c = 0; c < cols; c++) {
    const rawMin = env.min[c] as number;
    const rawMax = env.max[c] as number;
    const isGap = Number.isNaN(rawMin) || Number.isNaN(rawMax);

    if (isGap) {
      prevWasGap = true;
      continue;
    }

    // Run boundary: insert a restart sentinel before this run's first vertex,
    // but only between runs (not before the very first run).
    if (prevWasGap && emittedAnyRun) {
      indices[iw++] = PRIMITIVE_RESTART_INDEX;
    }
    prevWasGap = false;
    emittedAnyRun = true;

    // Min-thickness clamp: widen symmetrically about the midpoint if the band is
    // thinner than the 1.2 px equivalent. Never narrows a genuine spike.
    let lo = Math.min(rawMin, rawMax);
    let hi = Math.max(rawMin, rawMax);
    const span = hi - lo;
    if (span < minValueSpan) {
      const mid = (lo + hi) / 2;
      lo = mid - minValueSpan / 2;
      hi = mid + minValueSpan / 2;
    }

    const xData = dataXStart + (c + 0.5) * dataXPerColumn;

    // Upper vertex (max / hi) then lower vertex (min / lo).
    vertices[vf++] = xData;
    vertices[vf++] = hi;
    indices[iw++] = v++;

    vertices[vf++] = xData;
    vertices[vf++] = lo;
    indices[iw++] = v++;
  }

  return { vertices, indices, vertexCount, runCount };
}
