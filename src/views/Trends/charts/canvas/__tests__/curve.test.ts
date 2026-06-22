import { describe, it, expect } from 'vitest';
import { curveMonotoneX } from 'victory-vendor/d3-shape';
import { monotonePath, stepAfterPath, type PathSink, type CurvePoint } from '../curve';

/** A PathSink that records rounded drawing commands for comparison. */
function recorder() {
  const cmds: (string | number)[][] = [];
  const r = (n: number): number => Math.round(n * 1e4) / 1e4;
  const sink: PathSink & { cmds: (string | number)[][]; closePath: () => void } = {
    cmds,
    moveTo: (x, y) => cmds.push(['M', r(x), r(y)]),
    lineTo: (x, y) => cmds.push(['L', r(x), r(y)]),
    bezierCurveTo: (a, b, c, d, e, f) => cmds.push(['C', r(a), r(b), r(c), r(d), r(e), r(f)]),
    // d3's MonotoneX.lineEnd calls closePath() in the 1-point degenerate case.
    closePath: () => {},
  };
  return sink;
}

/** Drive d3-shape's real curveMonotoneX into the same recorder shape. */
function d3Reference(points: { x: number; y: number }[]): (string | number)[][] {
  const sink = recorder();
  const curve = curveMonotoneX(sink as unknown as CanvasRenderingContext2D);
  curve.lineStart();
  for (const p of points) curve.point(p.x, p.y);
  curve.lineEnd();
  return sink.cmds;
}

describe('monotonePath — byte-faithful to d3 curveMonotoneX', () => {
  const cases: { x: number; y: number }[][] = [
    [{ x: 0, y: 100 }],
    [
      { x: 0, y: 10 },
      { x: 50, y: 90 },
    ],
    [
      { x: 0, y: 10 },
      { x: 50, y: 90 },
      { x: 100, y: 20 },
    ],
    [
      { x: 0, y: 100 },
      { x: 100, y: 40 },
      { x: 200, y: 180 },
      { x: 300, y: 60 },
      { x: 400, y: 90 },
      { x: 500, y: 30 },
    ],
  ];

  for (const pts of cases) {
    it(`matches d3 for ${pts.length} point(s)`, () => {
      const sink = recorder();
      monotonePath(sink, pts as CurvePoint[], false);
      expect(sink.cmds).toEqual(d3Reference(pts));
    });
  }
});

describe('monotonePath — gap semantics', () => {
  it('breaks into separate subpaths on null (connectNulls=false)', () => {
    const pts: CurvePoint[] = [
      { x: 0, y: 10 },
      { x: 10, y: 20 },
      null,
      { x: 30, y: 5 },
      { x: 40, y: 15 },
    ];
    const sink = recorder();
    monotonePath(sink, pts, false);
    // Two runs → two moveTos.
    const moves = sink.cmds.filter((c) => c[0] === 'M');
    expect(moves.length).toBe(2);
  });

  it('bridges gaps when connectNulls=true (single subpath)', () => {
    const pts: CurvePoint[] = [{ x: 0, y: 10 }, null, { x: 30, y: 5 }, { x: 40, y: 15 }];
    const sink = recorder();
    monotonePath(sink, pts, true);
    const moves = sink.cmds.filter((c) => c[0] === 'M');
    expect(moves.length).toBe(1);
  });
});

describe('stepAfterPath', () => {
  it('holds Y then steps (stepAfter)', () => {
    const pts: CurvePoint[] = [
      { x: 0, y: 10 },
      { x: 50, y: 30 },
    ];
    const sink = recorder();
    stepAfterPath(sink, pts, true);
    expect(sink.cmds).toEqual([
      ['M', 0, 10],
      ['L', 50, 10], // horizontal hold at prev y
      ['L', 50, 30], // vertical riser
    ]);
  });
});
