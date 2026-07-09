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
  });
});
