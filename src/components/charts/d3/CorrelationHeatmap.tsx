/**
 * Correlation heatmap using D3 color scales and React SVG rendering.
 *
 * @module components/charts/d3/CorrelationHeatmap
 */

import React, { useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { useChartColors } from '../useChartColors';
import styles from './CorrelationHeatmap.module.css';

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
    const negCol = negativeColor ?? '#2563eb';
    const posCol = positiveColor ?? '#dc2626';
    return d3
      .scaleLinear<string>()
      .domain([-1, 0, 1])
      .range([negCol, colors.surfacePrimary, posCol])
      .clamp(true);
  }, [positiveColor, negativeColor, colors.surfacePrimary]);

  const cellSize = useMemo(
    () => ({ w: innerW / Math.max(n, 1), h: innerH / Math.max(n, 1) }),
    [innerW, innerH, n],
  );

  if (n === 0 || data.matrix.length !== n) {
    return <div className={styles.empty}>No data</div>;
  }

  /** Choose black or white text for contrast against the cell colour. */
  function textColor(value: number): string {
    return Math.abs(value) > 0.6 ? '#ffffff' : colors.textPrimary;
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
                  fill={colorScale(value)}
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
