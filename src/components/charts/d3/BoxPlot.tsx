/**
 * Box plot chart using D3 for calculations and React/SVG for rendering.
 *
 * Renders box-and-whisker plots with outlier circles and median labels.
 *
 * @module components/charts/d3/BoxPlot
 */

import React, { useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { paletteColor, useChartColors } from '../useChartColors';
import styles from './BoxPlot.module.css';

// ── Types ────────────────────────────────────────────────────────

export interface BoxPlotGroup {
  label: string;
  values: number[];
}

export interface BoxPlotProps {
  data: BoxPlotGroup[];
  /** Chart width — fills container if omitted. */
  width?: number;
  height?: number;
  /** Show outlier circles (default true). */
  showOutliers?: boolean;
}

interface BoxStats {
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers: number[];
}

// ── Helpers ──────────────────────────────────────────────────────

function computeStats(group: BoxPlotGroup): BoxStats | null {
  const sorted = Float64Array.from(group.values).sort();
  if (sorted.length === 0) return null;

  const q1 = d3.quantile(sorted, 0.25) ?? 0;
  const median = d3.quantile(sorted, 0.5) ?? 0;
  const q3 = d3.quantile(sorted, 0.75) ?? 0;
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  const outliers: number[] = [];
  let whiskerMin = Infinity;
  let whiskerMax = -Infinity;

  for (const v of sorted) {
    if (v < lowerFence || v > upperFence) {
      outliers.push(v);
    } else {
      if (v < whiskerMin) whiskerMin = v;
      if (v > whiskerMax) whiskerMax = v;
    }
  }

  if (!isFinite(whiskerMin)) whiskerMin = q1;
  if (!isFinite(whiskerMax)) whiskerMax = q3;

  return { label: group.label, min: whiskerMin, q1, median, q3, max: whiskerMax, outliers };
}

// ── Component ────────────────────────────────────────────────────

const MARGIN = { top: 16, right: 24, bottom: 40, left: 48 };

const BoxPlot = React.memo(function BoxPlot({
  data,
  width: widthProp,
  height = 300,
  showOutliers = true,
}: BoxPlotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const colors = useChartColors();

  const stats = useMemo(() => data.map(computeStats).filter(Boolean) as BoxStats[], [data]);

  const width = widthProp ?? 600;
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const { xScale, yScale, yTicks } = useMemo(() => {
    const allValues = stats.flatMap((s) => [s.min, s.max, ...s.outliers]);
    const yMin = d3.min(allValues) ?? 0;
    const yMax = d3.max(allValues) ?? 1;
    const yPad = (yMax - yMin) * 0.1 || 1;

    const xs = d3
      .scaleBand()
      .domain(stats.map((s) => s.label))
      .range([0, innerW])
      .padding(0.3);

    const ys = d3
      .scaleLinear()
      .domain([yMin - yPad, yMax + yPad])
      .range([innerH, 0])
      .nice();

    return { xScale: xs, yScale: ys, yTicks: ys.ticks(6) };
  }, [stats, innerW, innerH]);

  if (stats.length === 0) {
    return <div className={styles.empty}>No data</div>;
  }

  const boxWidth = Math.min(xScale.bandwidth(), 60);

  return (
    <div className={styles.container} ref={containerRef}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Y-axis grid + ticks */}
          {yTicks.map((t) => (
            <g key={t} className={styles.tick} transform={`translate(0,${yScale(t)})`}>
              <line x1={0} x2={innerW} stroke="var(--color-chart-grid)" strokeOpacity={0.5} />
              <text
                x={-8}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill="var(--color-chart-axis)"
              >
                {t}
              </text>
            </g>
          ))}

          {stats.map((s, i) => {
            const cx = (xScale(s.label) ?? 0) + xScale.bandwidth() / 2;
            const x0 = cx - boxWidth / 2;
            const color = paletteColor(colors, i);

            return (
              <g key={s.label}>
                {/* Whiskers */}
                <line
                  className={styles.whiskerLine}
                  x1={cx}
                  x2={cx}
                  y1={yScale(s.min)}
                  y2={yScale(s.q1)}
                  stroke={color}
                />
                <line
                  className={styles.whiskerLine}
                  x1={cx}
                  x2={cx}
                  y1={yScale(s.q3)}
                  y2={yScale(s.max)}
                  stroke={color}
                />

                {/* Whisker caps */}
                <line
                  x1={cx - boxWidth * 0.25}
                  x2={cx + boxWidth * 0.25}
                  y1={yScale(s.min)}
                  y2={yScale(s.min)}
                  stroke={color}
                  strokeWidth={1.5}
                />
                <line
                  x1={cx - boxWidth * 0.25}
                  x2={cx + boxWidth * 0.25}
                  y1={yScale(s.max)}
                  y2={yScale(s.max)}
                  stroke={color}
                  strokeWidth={1.5}
                />

                {/* Box */}
                <rect
                  className={styles.boxRect}
                  x={x0}
                  y={yScale(s.q3)}
                  width={boxWidth}
                  height={yScale(s.q1) - yScale(s.q3)}
                  fill={color}
                  fillOpacity={0.2}
                  stroke={color}
                />

                {/* Median line */}
                <line
                  className={styles.medianLine}
                  x1={x0}
                  x2={x0 + boxWidth}
                  y1={yScale(s.median)}
                  y2={yScale(s.median)}
                  stroke={color}
                />

                {/* Median label */}
                <text className={styles.medianLabel} x={cx} y={yScale(s.median) - 8}>
                  {s.median.toFixed(1)}
                </text>

                {/* Outliers */}
                {showOutliers &&
                  s.outliers.map((o, oi) => (
                    <circle
                      key={oi}
                      className={styles.outlier}
                      cx={cx}
                      cy={yScale(o)}
                      r={3}
                      fill={color}
                    />
                  ))}

                {/* X label */}
                <text className={styles.label} x={cx} y={innerH + 20}>
                  {s.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
});

export default BoxPlot;
