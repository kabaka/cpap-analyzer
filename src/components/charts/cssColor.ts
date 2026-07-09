/**
 * Pure CSS colour-string parsing for the WebGL waveform layer (ADR 0019).
 *
 * The hybrid renderer needs lane colours as {@link RGBA} (0..1) uniforms, but the
 * "no getComputedStyle inside the renderer" contract means colours must be
 * RESOLVED upstream (against the live theme) and passed in as strings. This
 * module turns those already-resolved strings (hex or `rgb()/rgba()`) into RGBA
 * with no DOM access, so it is fully unit-testable in the headless sandbox.
 *
 * @module components/charts/cssColor
 */

import type { RGBA } from './webgl';

/**
 * Parse a resolved CSS colour string to {@link RGBA} in 0..1.
 *
 * Supports `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, and `rgb()/rgba()` with
 * comma- or space-separated channels (0..255 or %), optional `/ alpha`. Falls
 * back to opaque mid-grey on an unrecognised format — or a nullish/non-string
 * input — so a waveform is never invisible and this never throws.
 *
 * @param input Resolved CSS colour string. A nullish (or otherwise non-string)
 *   value yields the mid-grey fallback rather than throwing.
 */
export function parseCssColorToRgba(input: string | null | undefined): RGBA {
  const s = typeof input === 'string' ? input.trim() : '';

  // #rgb / #rgba / #rrggbb / #rrggbbaa
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1] ?? '';
    const expand = (c: string): number => parseInt(c + c, 16) / 255;
    if (h.length === 3 || h.length === 4) {
      return {
        r: expand(h[0] as string),
        g: expand(h[1] as string),
        b: expand(h[2] as string),
        a: h.length === 4 ? expand(h[3] as string) : 1,
      };
    }
    if (h.length === 6 || h.length === 8) {
      const byte = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255;
      return {
        r: byte(0),
        g: byte(2),
        b: byte(4),
        a: h.length === 8 ? byte(6) : 1,
      };
    }
  }

  // rgb(...) / rgba(...) — comma or space separated, % or 0..255, optional /alpha.
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (rgb) {
    const parts = (rgb[1] ?? '')
      .split(/[,/\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const chan = (p: string | undefined): number => {
      if (p === undefined) return 0;
      if (p.endsWith('%')) return clamp01(parseFloat(p) / 100);
      return clamp01(parseFloat(p) / 255);
    };
    const alpha = (p: string | undefined): number => {
      if (p === undefined) return 1;
      if (p.endsWith('%')) return clamp01(parseFloat(p) / 100);
      return clamp01(parseFloat(p));
    };
    if (parts.length >= 3) {
      return { r: chan(parts[0]), g: chan(parts[1]), b: chan(parts[2]), a: alpha(parts[3]) };
    }
  }

  // Unknown format → opaque mid-grey (visible, neutral).
  return { r: 0.5, g: 0.5, b: 0.5, a: 1 };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
