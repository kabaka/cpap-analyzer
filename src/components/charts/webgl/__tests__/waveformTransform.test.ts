/**
 * Unit tests for the WebGL2 data→clip transform.
 *
 * These pin the GPU transform to the Canvas2D pixel mapping in {@link
 * module:components/charts/canvas/SignalRenderer}: for representative inputs the
 * clip coordinate produced by {@link computeWaveformClipTransform} must equal the
 * clip coordinate obtained by running the value through the *exact* Canvas2D
 * css-pixel formula and then normalising to clip space. This is the in-sandbox
 * proof that vertices land where the reference renderer would draw them.
 *
 * @module components/charts/webgl/__tests__/waveformTransform.test
 */

import { describe, it, expect } from 'vitest';
import {
  computeWaveformClipTransform,
  applyClipX,
  applyClipY,
  dataXToCssX,
  valueToCssY,
  cssXToClipX,
  cssYToClipY,
  laneInnerYExtent,
  LANE_TOP_INSET,
  LANE_BOTTOM_INSET,
  type LaneRect,
  type ViewportX,
  type PhysicalRange,
} from '../waveformTransform';

const lane: LaneRect = { plotLeft: 48, plotWidth: 900, stripTop: 60, stripHeight: 140 };
const view: ViewportX = { viewStart: 1000, viewSpan: 30000 };
const phys: PhysicalRange = { physicalMin: -60, physicalMax: 60 };
const CSS_W = 1000;
const CSS_H = 400;

/** Reference: the Canvas2D css-pixel mapping replicated independently. */
function refCssX(dataX: number): number {
  return lane.plotLeft + ((dataX - view.viewStart) / view.viewSpan) * lane.plotWidth;
}
function refCssY(value: number): number {
  const innerTop = lane.stripTop + LANE_TOP_INSET;
  const innerBottom = lane.stripTop + lane.stripHeight - LANE_BOTTOM_INSET;
  const innerHeight = innerBottom - innerTop;
  const physRange = phys.physicalMax - phys.physicalMin;
  return innerBottom - ((value - phys.physicalMin) / physRange) * innerHeight;
}

describe('laneInnerYExtent', () => {
  it('matches the Canvas2D stripTop+16 / stripHeight-8 insets', () => {
    const { innerTop, innerBottom, innerHeight } = laneInnerYExtent(lane);
    expect(innerTop).toBe(76);
    expect(innerBottom).toBe(192);
    expect(innerHeight).toBe(116);
  });
});

describe('dataXToCssX / valueToCssY reference mappings', () => {
  it('reproduce the Canvas2D x/y formulas exactly', () => {
    for (const dx of [1000, 4000, 16000, 31000]) {
      expect(dataXToCssX(dx, view, lane)).toBeCloseTo(refCssX(dx), 10);
    }
    for (const v of [-60, -30, 0, 30, 60]) {
      expect(valueToCssY(v, phys, lane)).toBeCloseTo(refCssY(v), 10);
    }
  });

  it('places the viewport edges at the plot edges', () => {
    expect(dataXToCssX(view.viewStart, view, lane)).toBeCloseTo(lane.plotLeft, 10);
    expect(dataXToCssX(view.viewStart + view.viewSpan, view, lane)).toBeCloseTo(
      lane.plotLeft + lane.plotWidth,
      10,
    );
  });

  it('places physicalMax at the top inset and physicalMin at the bottom inset', () => {
    const { innerTop, innerBottom } = laneInnerYExtent(lane);
    expect(valueToCssY(phys.physicalMax, phys, lane)).toBeCloseTo(innerTop, 10);
    expect(valueToCssY(phys.physicalMin, phys, lane)).toBeCloseTo(innerBottom, 10);
  });
});

describe('css→clip normalisation', () => {
  it('maps css edges to clip [-1, +1] with Y flipped', () => {
    expect(cssXToClipX(0, CSS_W)).toBeCloseTo(-1, 10);
    expect(cssXToClipX(CSS_W, CSS_W)).toBeCloseTo(1, 10);
    expect(cssYToClipY(0, CSS_H)).toBeCloseTo(1, 10); // top → +1
    expect(cssYToClipY(CSS_H, CSS_H)).toBeCloseTo(-1, 10); // bottom → -1
  });
});

describe('computeWaveformClipTransform', () => {
  it('equals the composed css→clip mapping for every representative X', () => {
    const t = computeWaveformClipTransform(view, phys, lane, CSS_W, CSS_H);
    for (const dx of [1000, 2500, 8000, 16000, 23500, 31000]) {
      const expected = cssXToClipX(refCssX(dx), CSS_W);
      expect(applyClipX(t, dx)).toBeCloseTo(expected, 9);
    }
  });

  it('equals the composed css→clip mapping for every representative value', () => {
    const t = computeWaveformClipTransform(view, phys, lane, CSS_W, CSS_H);
    for (const v of [-60, -45, -10, 0, 25, 60]) {
      const expected = cssYToClipY(refCssY(v), CSS_H);
      expect(applyClipY(t, v)).toBeCloseTo(expected, 9);
    }
  });

  it('pan changes only the X offset, not the X scale', () => {
    const base = computeWaveformClipTransform(view, phys, lane, CSS_W, CSS_H);
    const panned = computeWaveformClipTransform(
      { viewStart: view.viewStart + 5000, viewSpan: view.viewSpan },
      phys,
      lane,
      CSS_W,
      CSS_H,
    );
    expect(panned.scaleX).toBeCloseTo(base.scaleX, 12);
    expect(panned.offsetX).not.toBeCloseTo(base.offsetX, 6);
    // Y untouched by a horizontal pan.
    expect(panned.scaleY).toBeCloseTo(base.scaleY, 12);
    expect(panned.offsetY).toBeCloseTo(base.offsetY, 12);
  });

  it('zoom changes the X scale', () => {
    const base = computeWaveformClipTransform(view, phys, lane, CSS_W, CSS_H);
    const zoomed = computeWaveformClipTransform(
      { viewStart: view.viewStart, viewSpan: view.viewSpan / 2 },
      phys,
      lane,
      CSS_W,
      CSS_H,
    );
    expect(zoomed.scaleX).toBeCloseTo(base.scaleX * 2, 9);
  });

  it('is DPR-independent (clip coords identical regardless of device pixels)', () => {
    // The transform never takes DPR; the same css size yields the same transform.
    const t = computeWaveformClipTransform(view, phys, lane, CSS_W, CSS_H);
    const again = computeWaveformClipTransform(view, phys, lane, CSS_W, CSS_H);
    expect(again).toEqual(t);
  });

  it('degenerates safely on zero span / zero range / zero buffer', () => {
    const zeroSpan = computeWaveformClipTransform(
      { viewStart: 0, viewSpan: 0 },
      phys,
      lane,
      CSS_W,
      CSS_H,
    );
    expect(Number.isFinite(zeroSpan.scaleX)).toBe(true);
    expect(Number.isFinite(zeroSpan.offsetX)).toBe(true);

    const zeroRange = computeWaveformClipTransform(
      view,
      { physicalMin: 5, physicalMax: 5 },
      lane,
      CSS_W,
      CSS_H,
    );
    expect(Number.isFinite(zeroRange.scaleY)).toBe(true);
    expect(Number.isFinite(zeroRange.offsetY)).toBe(true);

    const zeroBuf = computeWaveformClipTransform(view, phys, lane, 0, 0);
    expect(Number.isFinite(zeroBuf.scaleX)).toBe(true);
    expect(Number.isFinite(zeroBuf.scaleY)).toBe(true);
  });
});
