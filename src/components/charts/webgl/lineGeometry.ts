/**
 * Instanced-line geometry for the zoomed-IN per-sample polyline.
 *
 * The Canvas2D reference ({@link
 * module:components/charts/canvas/SignalRenderer} `drawLine`) strokes the LTTB
 * polyline as one path at {@link DENSE_LINE_WIDTH} (1.2 px) with
 * `lineJoin: 'round'`, breaking the line wherever a sample is `NaN` (the
 * `firstPoint = true` reset). Width is constant in *screen* pixels regardless of
 * zoom.
 *
 * WebGL2 has no native thick polyline, so we render it as **instanced quads**:
 * one instance per polyline segment, each instance a unit quad expanded in the
 * vertex shader into a screen-space rectangle of width {@link DENSE_LINE_WIDTH}
 * device px around the segment, with the fragment shader applying an SDF feather
 * for the 1.2 px round-joined anti-aliasing. The per-instance attributes this
 * module produces are the two segment endpoints in **data space**:
 * `[xCurrent, yCurrent, xNext, yNext]`. The shader transforms both endpoints to
 * clip space, then expands the quad in screen space — so the line width is
 * constant in pixels no matter the X/Y zoom, exactly like the Canvas2D stroke.
 *
 * GAP / NaN BREAKS
 * ----------------
 * `drawLine` breaks the polyline when either endpoint is NaN (no `lineTo` is
 * issued across the gap). We mirror that by simply **not emitting an instance**
 * for any segment whose current or next endpoint is NaN. The instance count and
 * which segments survive are unit-tested against the `firstPoint` break logic.
 *
 * Everything here is **pure** and unit-tested; no GL context is touched. The
 * width expansion and round-join feathering are in the shader, validated by the
 * CI pixel-diff gate (they cannot run without a GL context).
 *
 * @module components/charts/webgl/lineGeometry
 */

import { DENSE_LINE_WIDTH } from './envelopeGeometry';

export { DENSE_LINE_WIDTH };

/** Floats per line instance: `[xCurrent, yCurrent, xNext, yNext]`. */
export const LINE_INSTANCE_STRIDE = 4;

/**
 * The static unit-quad vertex positions (two triangles) shared by every line
 * instance. Each row is a corner `(along, side)`:
 *   - `along` ∈ {0, 1}: position along the segment (current → next).
 *   - `side`  ∈ {-1, +1}: which side of the segment to offset (× half width).
 * The vertex shader uses these to build the screen-space rectangle and to drive
 * the fragment SDF. Six vertices = two triangles (no index buffer needed).
 */
export const LINE_QUAD_UNIT: Float32Array = new Float32Array([
  // along, side
  0,
  -1, // 0: current, lower
  1,
  -1, // 1: next, lower
  1,
  1, // 2: next, upper
  0,
  -1, // 3: current, lower
  1,
  1, // 4: next, upper
  0,
  1, // 5: current, upper
]);

/** Number of vertices in {@link LINE_QUAD_UNIT} (per instance). */
export const LINE_QUAD_VERTEX_COUNT = 6;

/**
 * Mapping from polyline sample index to data-space X.
 *
 * The Canvas2D uniform-cadence path places sample `s` at `dataX = dataXStart + s
 * * dataXPerSample`. For the timestamped path the caller supplies explicit
 * `sampleX` values instead. Exactly one of `dataXPerSample` (uniform) or
 * `sampleX` (explicit) is used.
 */
export interface LineGeometryParams {
  /** Data-space X of sample 0 (uniform path). */
  readonly dataXStart: number;
  /** Data-space X step per sample index (uniform path). */
  readonly dataXPerSample: number;
  /**
   * Explicit data-space X per sample (timestamped path). When provided and the
   * length matches the polyline, these override the uniform `dataXStart` /
   * `dataXPerSample` mapping.
   */
  readonly sampleX?: Float64Array;
}

/** The built instanced-line geometry for one channel's polyline. */
export interface LineGeometry {
  /**
   * Interleaved per-instance attributes `[xCur, yCur, xNext, yNext]`, one
   * instance per drawn segment (NaN-broken segments are omitted). Length =
   * `instanceCount * LINE_INSTANCE_STRIDE`.
   */
  readonly instances: Float32Array;
  /** Number of segment instances emitted. */
  readonly instanceCount: number;
}

/**
 * Build instanced-line segment attributes from an LTTB polyline.
 *
 * Walks consecutive sample pairs `(s, s+1)`. A pair is emitted as one instance
 * iff **both** samples are finite (mirroring `drawLine`, which only issues a
 * `lineTo` when both the previous and current points are real — a NaN resets
 * `firstPoint`, suppressing the connecting segment). The X of each endpoint comes
 * from the explicit `sampleX` mapping when supplied, else the uniform
 * `dataXStart + s * dataXPerSample` mapping.
 *
 * @param data   - The LTTB polyline y-values (physical units; NaN = break).
 * @param params - Sample-index → data-space-X mapping.
 */
export function buildLineGeometry(data: Float32Array, params: LineGeometryParams): LineGeometry {
  const n = data.length;
  const { dataXStart, dataXPerSample, sampleX } = params;
  const useExplicitX = sampleX !== undefined && sampleX.length === n;

  if (n < 2) {
    return { instances: new Float32Array(0), instanceCount: 0 };
  }

  // First pass: count drawable segments so the instance buffer is sized exactly.
  let count = 0;
  for (let s = 0; s < n - 1; s++) {
    const a = data[s] as number;
    const b = data[s + 1] as number;
    if (!Number.isNaN(a) && !Number.isNaN(b)) count++;
  }

  const instances = new Float32Array(count * LINE_INSTANCE_STRIDE);
  let w = 0;
  const xOf = (s: number): number =>
    useExplicitX ? (sampleX[s] as number) : dataXStart + s * dataXPerSample;

  for (let s = 0; s < n - 1; s++) {
    const a = data[s] as number;
    const b = data[s + 1] as number;
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    instances[w++] = xOf(s);
    instances[w++] = a;
    instances[w++] = xOf(s + 1);
    instances[w++] = b;
  }

  return { instances, instanceCount: count };
}
