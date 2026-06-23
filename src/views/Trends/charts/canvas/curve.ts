/**
 * Pure curve-path helpers replicating the d3-shape curves Recharts uses, so the
 * Canvas2D Trends charts reproduce the SVG paths pixel-faithfully.
 *
 * - {@link monotonePath} replicates **`curveMonotoneX`** (Recharts
 *   `type="monotone"` with a horizontal layout): monotone-cubic interpolation
 *   that prevents overshoot, using the Fritsch–Carlson tangents exactly as
 *   `d3-shape`'s `MonotoneX` does. This is NOT straight segments — adjacent
 *   points are joined with cubic Béziers whose control points come from the
 *   slope-limited tangents.
 *
 * - {@link stepAfterPath} replicates **`curveStepAfter`** (Settings chart): hold
 *   the current Y until the next X, then step. A horizontal segment to the next
 *   X at the current Y, then a vertical riser handled implicitly by the next
 *   point's `lineTo`.
 *
 * Both helpers consume an array of points where a `null` point marks a GAP
 * (mirroring Recharts `connectNulls={false}`): the path BREAKS there and resumes
 * a new sub-path at the next real point. With `connectNulls = true` gaps are
 * skipped and the surrounding real points are joined, exactly as Recharts does
 * (it drops null entries from the point list before building the curve).
 *
 * Each helper emits drawing commands into a minimal sink ({@link PathSink}) — in
 * production a `CanvasRenderingContext2D`, in tests a command recorder — so the
 * geometry is verifiable without a real canvas.
 *
 * @module views/Trends/charts/canvas/curve
 */

/** A point in plot space, or `null` for a gap (Recharts null datum). */
export type CurvePoint = { readonly x: number; readonly y: number } | null;

/**
 * The subset of `CanvasRenderingContext2D` the curve helpers drive. Implemented
 * by the real 2D context; a tiny recorder implements it in unit tests.
 */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
}

/** Drop gaps (connectNulls) or split into contiguous runs (break on gap). */
function toRuns(
  points: readonly CurvePoint[],
  connectNulls: boolean,
): { x: number; y: number }[][] {
  if (connectNulls) {
    const flat = points.filter((p): p is { x: number; y: number } => p !== null);
    return flat.length > 0 ? [flat] : [];
  }
  const runs: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  for (const p of points) {
    if (p === null) {
      if (cur.length > 0) runs.push(cur);
      cur = [];
    } else {
      cur.push(p);
    }
  }
  if (cur.length > 0) runs.push(cur);
  return runs;
}

/** Sign of the slope, matching d3 `sign`. */
function slopeSign(x: number): number {
  return x < 0 ? -1 : 1;
}

/**
 * The slope of a point given its neighbouring secant slopes — d3 `slope3` /
 * `slope2` Fritsch–Carlson formulation that prevents monotone overshoot.
 */
function slope3(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  const h0 = x1 - x0;
  const h1 = x2 - x1;
  const s0 = (y1 - y0) / (h0 || (h1 < 0 ? -0 : 0));
  const s1 = (y2 - y1) / (h1 || (h0 < 0 ? -0 : 0));
  const p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (
    (slopeSign(s0) + slopeSign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
  );
}

/** Endpoint slope — d3 `slope2`. */
function slope2(x0: number, y0: number, x1: number, y1: number, t: number): number {
  const h = x1 - x0;
  return h ? ((3 * (y1 - y0)) / h - t) / 2 : t;
}

/**
 * Emit one cubic Bézier between (x0,y0) and (x1,y1) given the tangents t0,t1, in
 * d3-shape's `MonotoneX` parametrisation (control points one-third of the way).
 */
function emitCubic(
  sink: PathSink,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t0: number,
  t1: number,
): void {
  const dx = (x1 - x0) / 3;
  sink.bezierCurveTo(x0 + dx, y0 + dx * t0, x1 - dx, y1 - dx * t1, x1, y1);
}

/**
 * Append a monotone-cubic (`curveMonotoneX`) path for `points` to `sink`.
 * Replicates d3-shape's `MonotoneX` point-by-point, including its 1- and
 * 2-point degenerate cases (a single `moveTo`, or a straight `lineTo`).
 */
export function monotonePath(
  sink: PathSink,
  points: readonly CurvePoint[],
  connectNulls = false,
): void {
  for (const run of toRuns(points, connectNulls)) {
    monotoneRun(sink, run);
  }
}

function monotoneRun(sink: PathSink, pts: readonly { x: number; y: number }[]): void {
  const n = pts.length;
  if (n === 0) return;
  const first = pts[0];
  if (!first) return;
  if (n === 1) {
    sink.moveTo(first.x, first.y);
    return;
  }

  sink.moveTo(first.x, first.y);
  if (n === 2) {
    const second = pts[1];
    if (second) sink.lineTo(second.x, second.y);
    return;
  }

  // d3 MonotoneX: t0 is the running tangent at the current point.
  let x0 = first.x;
  let y0 = first.y;
  const p1 = pts[1];
  if (!p1) return;
  let x1 = p1.x;
  let y1 = p1.y;
  let t0 = 0;
  let started = false;

  for (let i = 2; i < n; i++) {
    const p = pts[i];
    if (!p) continue;
    const x2 = p.x;
    const y2 = p.y;
    const t1 = slope3(x0, y0, x1, y1, x2, y2);
    if (!started) {
      // First segment: endpoint tangent from slope2.
      emitCubic(sink, x0, y0, x1, y1, slope2(x0, y0, x1, y1, t1), t1);
      started = true;
    } else {
      emitCubic(sink, x0, y0, x1, y1, t0, t1);
    }
    x0 = x1;
    y0 = y1;
    x1 = x2;
    y1 = y2;
    t0 = t1;
  }

  // Final segment to the last point with a slope2 endpoint tangent. For n >= 3
  // the loop above always ran at least once, so `started` is true here.
  void started;
  emitCubic(sink, x0, y0, x1, y1, t0, slope2(x0, y0, x1, y1, t0));
}

/**
 * Append a `curveStepAfter` path for `points` to `sink`: from each point, hold Y
 * horizontally to the next point's X, then the next point's `lineTo` rises
 * vertically. Matches d3-shape `StepAfter` (t = 1).
 */
export function stepAfterPath(
  sink: PathSink,
  points: readonly CurvePoint[],
  connectNulls = false,
): void {
  for (const run of toRuns(points, connectNulls)) {
    const n = run.length;
    if (n === 0) continue;
    const first = run[0];
    if (!first) continue;
    sink.moveTo(first.x, first.y);
    let prev = first;
    for (let i = 1; i < n; i++) {
      const p = run[i];
      if (!p) continue;
      // Horizontal hold at prev.y to the new x, then vertical riser to new y.
      sink.lineTo(p.x, prev.y);
      sink.lineTo(p.x, p.y);
      prev = p;
    }
  }
}
