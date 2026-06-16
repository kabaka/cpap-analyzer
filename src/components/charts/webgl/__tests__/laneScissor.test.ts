/**
 * Unit tests for the per-lane scissor rect.
 *
 * Pins {@link computeLaneScissor} to the Canvas2D LOAD-BEARING clip
 * (`ctx.rect(plotLeft, stripTop, plotWidth, stripHeight)`), at DPR 2, including
 * the device-pixel rounding and the bottom-left-origin Y flip. Lane layout is
 * derived with {@link computeLaneLayout} so the test mirrors how the host
 * positions lanes.
 *
 * @module components/charts/webgl/__tests__/laneScissor.test
 */

import { describe, it, expect } from 'vitest';
import { computeLaneScissor, type LaneClipRectCss } from '../laneScissor';
import { computeLaneLayout } from '../../canvas/SignalRenderer';

const DPR = 2;
const CSS_H = 400;
const BUF_H = CSS_H * DPR; // 800 device px

describe('computeLaneScissor', () => {
  it('converts a CSS clip rect to device px with a bottom-left Y flip', () => {
    const rect: LaneClipRectCss = { plotLeft: 48, stripTop: 60, plotWidth: 900, stripHeight: 140 };
    const s = computeLaneScissor(rect, DPR, BUF_H);
    expect(s.x).toBe(96); // 48*2
    expect(s.width).toBe(1800); // 900*2
    expect(s.height).toBe(280); // 140*2
    // bottom edge from top = (60+140)*2 = 400 device px; flip: 800 - 400 = 400.
    expect(s.y).toBe(400);
  });

  it('matches a multi-lane layout from computeLaneLayout', () => {
    const channels = [{ height: 140 }, { height: 80 }, {}];
    const defaultHeight = 120;
    const paddingTop = 8;
    const layout = computeLaneLayout(channels, defaultHeight, paddingTop);

    const plotLeft = 48;
    const plotWidth = 900;
    for (const entry of layout) {
      const rect: LaneClipRectCss = {
        plotLeft,
        stripTop: entry.top,
        plotWidth,
        stripHeight: entry.height,
      };
      const s = computeLaneScissor(rect, DPR, BUF_H);
      // Each lane's device-px height covers its CSS height (ceil - floor ≥ h*dpr).
      expect(s.height).toBeGreaterThanOrEqual(Math.floor(entry.height * DPR));
      // Y flip keeps the box inside the buffer.
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y + s.height).toBeLessThanOrEqual(BUF_H + 1);
    }
  });

  it('floors min edges and ceils max edges (conservative cover, never under-clips)', () => {
    // Fractional CSS px (e.g. plotLeft from a sub-pixel layout) at DPR 2.
    const rect: LaneClipRectCss = {
      plotLeft: 10.4,
      stripTop: 20.3,
      plotWidth: 100.4,
      stripHeight: 50.2,
    };
    const s = computeLaneScissor(rect, DPR, BUF_H);
    expect(s.x).toBe(Math.floor(10.4 * 2)); // 20
    expect(s.width).toBe(Math.ceil((10.4 + 100.4) * 2) - Math.floor(10.4 * 2)); // 222 - 20 = 202
    const topDev = Math.floor(20.3 * 2); // 40
    const bottomDev = Math.ceil((20.3 + 50.2) * 2); // 141
    expect(s.height).toBe(bottomDev - topDev); // 101
    expect(s.y).toBe(BUF_H - bottomDev); // 800 - 141 = 659
  });

  it('clamps negative dimensions and out-of-buffer Y to 0', () => {
    const rect: LaneClipRectCss = {
      plotLeft: 0,
      stripTop: 0,
      plotWidth: -10,
      stripHeight: -10,
    };
    const s = computeLaneScissor(rect, DPR, BUF_H);
    expect(s.width).toBe(0);
    expect(s.height).toBe(0);
    expect(s.y).toBeGreaterThanOrEqual(0);
    expect(s.x).toBeGreaterThanOrEqual(0);
  });

  it('preserves DPR 2 (device px are exactly 2× CSS px on integer rects)', () => {
    const rect: LaneClipRectCss = { plotLeft: 0, stripTop: 0, plotWidth: 500, stripHeight: 200 };
    const s = computeLaneScissor(rect, 2, BUF_H);
    expect(s.width).toBe(1000);
    expect(s.height).toBe(400);
  });
});
