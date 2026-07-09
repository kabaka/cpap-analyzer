/**
 * Regression coverage for {@link CorrelationHeatmap}.
 *
 * A `NaN` cell is legitimate clinical data: `correlationMatrix()` writes `r: NaN`
 * whenever a metric pair has zero variance (a constant series) or fewer than 3
 * overlapping observations. For a `NaN` value d3's diverging `scaleLinear`
 * returns `undefined`, which previously flowed into the luminance-based
 * `textColor` helper and threw (`undefined.trim()`), taking down the whole
 * Statistical Analysis view via the route error boundary. The heatmap must
 * therefore render `NaN` cells without throwing.
 *
 * These tests intentionally do NOT mock `useChartColors`: in jsdom
 * `getComputedStyle` resolves the theme tokens to empty strings, so the real
 * hook exercises the empty-string colour path as well — a useful robustness
 * check that the component never hands a nullish/blank colour anywhere that
 * throws.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@test/test-utils';
import CorrelationHeatmap from '../CorrelationHeatmap';

const NA = NaN;

/** Text content of every rendered SVG `<text>` node (labels + cell values). */
function svgTextContent(): (string | null)[] {
  return Array.from(document.querySelectorAll('svg text')).map((t) => t.textContent);
}

/**
 * The cell `<rect>` whose `<title>` contains `coefficient` (e.g. `'NaN'`,
 * `'1.00'`), or `undefined`. Each cell's `<title>` is `row × col: value`, so
 * this locates a specific cell without depending on DOM order or the resolved
 * fill colour (jsdom resolves theme tokens to empty strings).
 */
function cellRectByTitle(coefficient: string): SVGRectElement | undefined {
  return Array.from(document.querySelectorAll<SVGRectElement>('svg rect')).find((rect) =>
    rect.querySelector('title')?.textContent?.includes(coefficient),
  );
}

describe('CorrelationHeatmap', () => {
  it('renders NaN correlation cells without throwing and labels them "NaN"', () => {
    // 3×3 symmetric matrix: finite diagonal (r = 1), NaN off-diagonal — the
    // shape a zero-variance / insufficient-overlap metric pair produces.
    const data = {
      labels: ['A', 'B', 'C'],
      matrix: [
        [1, NA, NA],
        [NA, 1, NA],
        [NA, NA, 1],
      ],
    };

    // width/height 400 for n = 3 → cellSize.w ≈ 104px (> 28), so the in-cell
    // text branch (the regressed code path) is actually exercised.
    const renderHeatmap = () => render(<CorrelationHeatmap data={data} width={400} height={400} />);
    expect(renderHeatmap).not.toThrow();

    const labels = svgTextContent();
    // NaN cells are labelled "NaN" rather than crashing the view…
    expect(labels).toContain('NaN');
    // …and the finite diagonal cells still render their coefficient.
    expect(labels).toContain('1.00');

    // The NaN cell's rect must carry an explicit `fill="transparent"` — the
    // attribute PRESENT and equal to `transparent`, so the panel surface shows
    // through. Without the `?? 'transparent'` fallback, `colorScale(NaN)` is
    // `undefined`, React omits the attribute, and the SVG default paints the
    // cell black (illegible dark-on-black label in the light theme).
    const nanCell = cellRectByTitle('NaN');
    expect(nanCell).toBeDefined();
    expect(nanCell?.getAttribute('fill')).toBe('transparent');

    // In the SAME render, a finite diagonal cell takes the colour scale, never
    // the transparent fallback — proving the fallback is applied per-cell, not
    // globally, and that finite rendering is untouched.
    const finiteCell = cellRectByTitle('1.00');
    expect(finiteCell).toBeDefined();
    expect(finiteCell?.getAttribute('fill')).not.toBeNull();
    expect(finiteCell?.getAttribute('fill')).not.toBe('transparent');
  });

  it('renders a fully finite matrix with formatted labels (valid-data rendering unchanged)', () => {
    const data = {
      labels: ['X', 'Y'],
      matrix: [
        [1, 0.5],
        [0.5, 1],
      ],
    };

    const renderHeatmap = () => render(<CorrelationHeatmap data={data} width={400} height={400} />);
    expect(renderHeatmap).not.toThrow();

    const labels = svgTextContent();
    expect(labels).toContain('1.00');
    expect(labels).toContain('0.50');
    expect(labels).not.toContain('NaN');

    // Finite cells still get a real colour fill from the diverging scale — never
    // the transparent NaN fallback. (jsdom resolves theme tokens to '' so the
    // resolved colour is empty; asserting "present and not transparent" is
    // exactly what proves the finite path skips the NaN fallback and is
    // unchanged by this fix.)
    const diagonalCell = cellRectByTitle('1.00');
    expect(diagonalCell).toBeDefined();
    expect(diagonalCell?.getAttribute('fill')).not.toBeNull();
    expect(diagonalCell?.getAttribute('fill')).not.toBe('transparent');
  });
});
