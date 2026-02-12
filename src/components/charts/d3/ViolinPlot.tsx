/**
 * Violin plot using D3 kernel density estimation + box plot overlay.
 *
 * @module components/charts/d3/ViolinPlot
 */

import React, { useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { paletteColor, useChartColors } from '../useChartColors';
import styles from './ViolinPlot.module.css';

// ── Types ────────────────────────────────────────────────────────

export interface ViolinPlotGroup {
  label: string;
  values: number[];
}

export interface ViolinPlotProps {
  data: ViolinPlotGroup[];
  width?: number;
  height?: number;
  /** Number of KDE evaluation points (default 40). */
  resolution?: number;
}

interface ViolinStats {
  label: string;
  q1: number;
  median: number;
  q3: number;
  kde: { value: number; density: number }[];
  maxDensity: number;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Epanechnikov kernel for KDE.
 */
function kernelEpanechnikov(bandwidth: number) {
  return (v: number): number => {
    const u = v / bandwidth;
    return Math.abs(u) <= 1 ? (0.75 * (1 - u * u)) / bandwidth : 0;
  };
}

function kde(
  kernel: (v: number) => number,
  thresholds: number[],
  data: number[],
): { value: number; density: number }[] {
  return thresholds.map((t) => ({
    value: t,
    density: d3.mean(data, (d) => kernel(t - d)) ?? 0,
  }));
}

function computeViolin(group: ViolinPlotGroup, resolution: number): ViolinStats | null {
  if (group.values.length < 2) return null;

  const sorted = Float64Array.from(group.values).sort();
  const q1 = d3.quantile(sorted, 0.25) ?? 0;
  const median = d3.quantile(sorted, 0.5) ?? 0;
  const q3 = d3.quantile(sorted, 0.75) ?? 0;

  const yMin = sorted[0] ?? 0;
  const yMax = sorted[sorted.length - 1] ?? 1;
  const bandwidth = (q3 - q1) * 0.6 || 1;
  const step = (yMax - yMin) / resolution;
  if (step <= 0) return null;

  const thresholds = d3.range(yMin, yMax, step);
  if (thresholds.length === 0) return null;

  const density = kde(kernelEpanechnikov(bandwidth), thresholds, Array.from(sorted));
  const maxDensity = d3.max(density, (d) => d.density) ?? 1;

  return { label: group.label, q1, median, q3, kde: density, maxDensity };
}

// ── Component ────────────────────────────────────────────────────

const MARGIN = { top: 16, right: 24, bottom: 40, left: 48 };

const ViolinPlot = React.memo(function ViolinPlot({
  data,
  width: widthProp,
  height = 300,
  resolution = 40,
}: ViolinPlotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const colors = useChartColors();

  const violins = useMemo(
    () => data.map((g) => computeViolin(g, resolution)).filter(Boolean) as ViolinStats[],
    [data, resolution],
  );

  const width = widthProp ?? 600;
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const { xScale, yScale } = useMemo(() => {
    const allValues = data.flatMap((g) => g.values);
    const yMin = d3.min(allValues) ?? 0;
    const yMax = d3.max(allValues) ?? 1;
    const yPad = (yMax - yMin) * 0.1 || 1;

    const xs = d3
      .scaleBand()
      .domain(violins.map((v) => v.label))
      .range([0, innerW])
      .padding(0.15);

    const ys = d3
      .scaleLinear()
      .domain([yMin - yPad, yMax + yPad])
      .range([innerH, 0])
      .nice();

    return { xScale: xs, yScale: ys };
  }, [data, violins, innerW, innerH]);

  if (violins.length === 0) {
    return <div className={styles.empty}>No data</div>;
  }

  return (
    <div className={styles.container} ref={containerRef}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Y-axis ticks */}
          {yScale.ticks(6).map((t) => (
            <g key={t} transform={`translate(0,${yScale(t)})`}>
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

          {violins.map((v, i) => {
            const cx = (xScale(v.label) ?? 0) + xScale.bandwidth() / 2;
            const halfWidth = xScale.bandwidth() / 2;
            const color = paletteColor(colors, i);

            // Density scaler — maps density to half-width
            const dScale = d3.scaleLinear().domain([0, v.maxDensity]).range([0, halfWidth]);

            // Violin area generator
            const areaGen = d3
              .area<{ value: number; density: number }>()
              .x0((d) => cx - dScale(d.density))
              .x1((d) => cx + dScale(d.density))
              .y((d) => yScale(d.value))
              .curve(d3.curveCatmullRom);

            const violinPath = areaGen(v.kde) ?? '';

            // Mini box dimensions
            const boxWidth = halfWidth * 0.35;

            return (
              <g key={v.label}>
                {/* Violin shape */}
                <path className={styles.violinPath} d={violinPath} fill={color} stroke={color} />

                {/* Inner box */}
                <rect
                  className={styles.boxRect}
                  x={cx - boxWidth / 2}
                  y={yScale(v.q3)}
                  width={boxWidth}
                  height={yScale(v.q1) - yScale(v.q3)}
                  fill={color}
                  stroke={color}
                />

                {/* Whisker */}
                <line
                  className={styles.whiskerLine}
                  x1={cx}
                  x2={cx}
                  y1={yScale(v.q1)}
                  y2={yScale(v.q3)}
                  stroke={color}
                />

                {/* Median dot */}
                <circle
                  cx={cx}
                  cy={yScale(v.median)}
                  r={3}
                  fill="white"
                  stroke={color}
                  strokeWidth={1.5}
                />

                {/* X label */}
                <text className={styles.label} x={cx} y={innerH + 20}>
                  {v.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
});

export default ViolinPlot;
