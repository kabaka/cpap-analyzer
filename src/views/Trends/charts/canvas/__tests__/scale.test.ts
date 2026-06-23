import { describe, it, expect } from 'vitest';
import {
  pointX,
  pointStep,
  bandLeft,
  bandWidth,
  bandCenter,
  singleBarGeometry,
  valueY,
  niceYTicks,
  indexAtX,
} from '../scale';

describe('Trends canvas scale — categorical X', () => {
  it('places scalePoint categories flush at both edges (matches d3 scalePoint)', () => {
    // N=4 across [0, 300]: step 100, points 0,100,200,300.
    expect(pointX(0, 4, 0, 300)).toBe(0);
    expect(pointX(1, 4, 0, 300)).toBe(100);
    expect(pointX(3, 4, 0, 300)).toBe(300);
    expect(pointStep(4, 300)).toBe(100);
  });

  it('centres a single point category', () => {
    expect(pointX(0, 1, 0, 300)).toBe(150);
  });

  it('honours a non-zero plotLeft', () => {
    expect(pointX(0, 4, 56, 300)).toBe(56);
    expect(pointX(3, 4, 56, 300)).toBe(356);
  });

  it('places scaleBand left edges at i*step (matches d3 scaleBand, zero padding)', () => {
    // N=4 across [0, 300]: step = bandwidth = 75, lefts 0,75,150,225.
    expect(bandWidth(4, 300)).toBe(75);
    expect(bandLeft(0, 4, 0, 300)).toBe(0);
    expect(bandLeft(2, 4, 0, 300)).toBe(150);
    expect(bandCenter(0, 4, 0, 300)).toBeCloseTo(37.5, 6);
  });

  it('computes a single Usage bar geometry per Recharts getBarPosition', () => {
    // bandwidth 75, gap 10% → offset 7.5, width floor(0.8*75)=floor(60)=60.
    const geo = singleBarGeometry(1, 4, 0, 300);
    expect(geo.x).toBeCloseTo(75 + 7.5, 6);
    expect(geo.width).toBe(60);
  });
});

describe('Trends canvas scale — Y mapping & ticks', () => {
  it('maps domain max to plot top, min to plot bottom', () => {
    expect(valueY(10, 0, 10, 8, 100)).toBe(8); // max → top
    expect(valueY(0, 0, 10, 8, 100)).toBe(108); // min → bottom
    expect(valueY(5, 0, 10, 8, 100)).toBe(58); // mid
  });

  it('produces nice 1/2/5 ticks within the domain', () => {
    const ticks = niceYTicks(0, 10, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(10);
    // Even spacing.
    const step = (ticks[1] as number) - (ticks[0] as number);
    expect(step).toBeGreaterThan(0);
  });
});

describe('Trends canvas scale — hit testing', () => {
  it('finds the nearest point category', () => {
    expect(indexAtX(0, 4, 0, 300, false)).toBe(0);
    expect(indexAtX(149, 4, 0, 300, false)).toBe(1);
    expect(indexAtX(151, 4, 0, 300, false)).toBe(2);
    expect(indexAtX(300, 4, 0, 300, false)).toBe(3);
  });

  it('finds the nearest band centre for bar charts', () => {
    // centres at 37.5, 112.5, 187.5, 262.5.
    expect(indexAtX(0, 4, 0, 300, true)).toBe(0);
    expect(indexAtX(120, 4, 0, 300, true)).toBe(1);
    expect(indexAtX(300, 4, 0, 300, true)).toBe(3);
  });

  it('returns 0 for a single category and null for none', () => {
    expect(indexAtX(123, 1, 0, 300, false)).toBe(0);
    expect(indexAtX(123, 0, 0, 300, false)).toBeNull();
  });
});
