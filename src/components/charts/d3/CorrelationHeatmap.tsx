/**
 * Correlation heatmap using D3 color scales and React SVG rendering.
 *
 * @module components/charts/d3/CorrelationHeatmap
 */

import React, { useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { useChartColors } from '../useChartColors';
import { parseCssColorToRgba } from '../cssColor';
import styles from './CorrelationHeatmap.module.css';

// ── Contrast helpers (luminance-aware ink selection) ─────────────

/** WCAG relative luminance of an already-resolved CSS colour string (sRGB). */
function relLuminance(color: string): number {
  const { r, g, b } = parseCssColorToRgba(color);
  const lin = (u: number): number =>
    u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two relative luminances. */
function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// ── Types ────────────────────────────────────────────────────────

export interface CorrelationHeatmapProps {
  data: {
    labels: string[];
    /** Square matrix of correlation coefficients (−1 to +1). */
    matrix: number[][];
  };
  width?: number;
  height?: number;
  /** Positive-end colour (default red). */
  positiveColor?: string;
  /** Negative-end colour (default blue). */
  negativeColor?: string;
}

// ── Component ────────────────────────────────────────────────────

const MARGIN = { top: 60, right: 8, bottom: 8, left: 80 };

const CorrelationHeatmap = React.memo(function CorrelationHeatmap({
  data,
  width: widthProp,
  height: heightProp,
  positiveColor,
  negativeColor,
}: CorrelationHeatmapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const colors = useChartColors();

  const n = data.labels.length;

  const width = widthProp ?? Math.max(300, n * 48 + MARGIN.left + MARGIN.right);
  const height = heightProp ?? Math.max(300, n * 48 + MARGIN.top + MARGIN.bottom);
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const colorScale = useMemo(() => {
    // Diverging scale: negative → blue (`--color-chart-1`), positive → red
    // (`--color-chart-2`), through the theme surface at r = 0. Both endpoints are
    // theme tokens (were hardcoded #2563eb / #dc2626 — identical in light, now
    // correctly brightened in dark). Hue polarity is preserved exactly.
    const negCol = negativeColor ?? colors.chart1;
    const posCol = positiveColor ?? colors.chart2;
    return d3
      .scaleLinear<string>()
      .domain([-1, 0, 1])
      .range([negCol, colors.surfacePrimary, posCol])
      .clamp(true);
  }, [positiveColor, negativeColor, colors.chart1, colors.chart2, colors.surfacePrimary]);

  // Pre-compute the luminance of the two candidate inks once per theme. The cell
  // fill is OPAQUE (d3 interpolation), so in dark mode a high-|r| cell is a LIGHT
  // chart colour needing DARK ink, while a low-|r| cell is near the dark surface
  // needing LIGHT ink — a single ink can't serve both. `--color-text-primary` and
  // `--color-surface-primary` are always a dark/light pair in each theme, so
  // picking the higher-contrast of the two per cell guarantees legible text
  // everywhere (replaces the hardcoded white flip that failed in dark).
  const inkLum = useMemo(
    () => ({
      primary: relLuminance(colors.textPrimary),
      surface: relLuminance(colors.surfacePrimary),
    }),
    [colors.textPrimary, colors.surfacePrimary],
  );

  const cellSize = useMemo(
    () => ({ w: innerW / Math.max(n, 1), h: innerH / Math.max(n, 1) }),
    [innerW, innerH, n],
  );

  if (n === 0 || data.matrix.length !== n) {
    return <div className={styles.empty}>No data</div>;
  }

  /** Pick the higher-contrast theme ink (text-primary vs surface-primary) for
   *  the cell's resolved fill colour — luminance-aware, works in both themes. */
  function textColor(value: number): string {
    const fill = colorScale(value);
    // NaN correlation cells (zero-variance / insufficient-overlap metric pairs)
    // make d3 return `undefined` and leave the cell unfilled (transparent). Fall
    // back to the primary theme ink so the "NaN" label stays legible — this both
    // restores the pre-tokenization behaviour and keeps `undefined` out of
    // `relLuminance` (which would otherwise throw parsing it).
    if (fill == null) return colors.textPrimary;
    const bgLum = relLuminance(fill);
    return contrastRatio(bgLum, inkLum.primary) >= contrastRatio(bgLum, inkLum.surface)
      ? colors.textPrimary
      : colors.surfacePrimary;
  }

  return (
    <div className={styles.container} ref={containerRef}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Column labels */}
          {data.labels.map((label, ci) => (
            <text
              key={`col-${ci}`}
              className={styles.colLabel}
              x={ci * cellSize.w + cellSize.w / 2}
              y={-8}
              transform={`rotate(-45, ${ci * cellSize.w + cellSize.w / 2}, -8)`}
            >
              {label}
            </text>
          ))}

          {/* Row labels */}
          {data.labels.map((label, ri) => (
            <text
              key={`row-${ri}`}
              className={styles.rowLabel}
              x={-8}
              y={ri * cellSize.h + cellSize.h / 2}
            >
              {label}
            </text>
          ))}

          {/* Cells */}
          {data.matrix.map((row, ri) =>
            row.map((value, ci) => (
              <g key={`${ri}-${ci}`}>
                <rect
                  className={styles.cell}
                  x={ci * cellSize.w}
                  y={ri * cellSize.h}
                  width={cellSize.w}
                  height={cellSize.h}
                  // NaN cells make d3 return `undefined`; without a fallback React
                  // omits the attribute and the SVG default paints the cell black.
                  // Render `transparent` so the panel surface shows through — mirrors
                  // the `matrixCellColor` convention in IntegrationAnalysis.tsx.
                  fill={colorScale(value) ?? 'transparent'}
                >
                  <title>
                    {data.labels[ri]} × {data.labels[ci]}: {value.toFixed(2)}
                  </title>
                </rect>
                {cellSize.w > 28 && (
                  <text
                    className={styles.cellLabel}
                    x={ci * cellSize.w + cellSize.w / 2}
                    y={ri * cellSize.h + cellSize.h / 2}
                    fill={textColor(value)}
                  >
                    {value.toFixed(2)}
                  </text>
                )}
              </g>
            )),
          )}
        </g>
      </svg>
    </div>
  );
});

export default CorrelationHeatmap;
