/**
 * Unit tests for the pure CSS colour → RGBA parser used to feed resolved theme
 * colours to the WebGL waveform layer (ADR 0019) without getComputedStyle.
 */

import { describe, expect, it } from 'vitest';

import { parseCssColorToRgba } from '../cssColor';

describe('parseCssColorToRgba', () => {
  it('parses #rrggbb', () => {
    expect(parseCssColorToRgba('#ff0000')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseCssColorToRgba('#00ff00')).toEqual({ r: 0, g: 1, b: 0, a: 1 });
  });

  it('parses #rgb shorthand', () => {
    expect(parseCssColorToRgba('#f00')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    const grey = parseCssColorToRgba('#888');
    expect(grey.r).toBeCloseTo(0x88 / 255, 6);
    expect(grey.a).toBe(1);
  });

  it('parses #rrggbbaa and #rgba with alpha', () => {
    const a = parseCssColorToRgba('#ff000080');
    expect(a.r).toBe(1);
    expect(a.a).toBeCloseTo(0x80 / 255, 6);
    const b = parseCssColorToRgba('#0f08');
    expect(b.g).toBe(1);
    expect(b.a).toBeCloseTo(0x88 / 255, 6);
  });

  it('parses rgb() and rgba() comma-separated', () => {
    expect(parseCssColorToRgba('rgb(255, 0, 0)')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    const c = parseCssColorToRgba('rgba(0, 128, 255, 0.5)');
    expect(c.b).toBe(1);
    expect(c.g).toBeCloseTo(128 / 255, 6);
    expect(c.a).toBe(0.5);
  });

  it('parses space-separated rgb() with / alpha (modern syntax)', () => {
    const c = parseCssColorToRgba('rgb(255 0 0 / 0.25)');
    expect(c.r).toBe(1);
    expect(c.a).toBe(0.25);
  });

  it('parses percentage channels', () => {
    const c = parseCssColorToRgba('rgb(100% 0% 50%)');
    expect(c.r).toBe(1);
    expect(c.b).toBe(0.5);
  });

  it('clamps out-of-range values to [0,1]', () => {
    const c = parseCssColorToRgba('rgb(300, -20, 0)');
    expect(c.r).toBe(1);
    expect(c.g).toBe(0);
  });

  it('falls back to opaque mid-grey on unrecognised input', () => {
    expect(parseCssColorToRgba('not-a-color')).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
    expect(parseCssColorToRgba('')).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
  });
});
