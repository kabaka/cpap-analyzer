/**
 * Quantile-Quantile plot against the normal distribution.
 *
 * Uses D3 for quantile calculations and renders deviation-coloured
 * points via React SVG.
 *
 * @module components/charts/d3/QQPlot
 */

import React, { useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { useChartColors } from '../useChartColors';
import styles from './QQPlot.module.css';

// ── Types ────────────────────────────────────────────────────────

export interface QQPlotProps {
  /** Sample data values. */
  data: number[];
  width?: number;
  height?: number;
  /** Colour for points near the line (default chart-3 = green). */
  goodColor?: string;
  /** Colour for points far from line (default chart-2 = red). */
  badColor?: string;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Standard normal quantile function (inverse CDF) via rational approximation. */
function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  // Rational approximation (Abramowitz & Stegun 26.2.23)
  const a0 = -3.969683028665376e1;
  const a1 = 2.209460984245205e2;
  const a2 = -2.759285104469687e2;
  const a3 = 1.38357751867269e2;
  const a4 = -3.066479806614716e1;
  const a5 = 2.506628277459239;

  const b0 = -5.447609879822406e1;
  const b1 = 1.615858368580409e2;
  const b2 = -1.556989798598866e2;
  const b3 = 6.680131188771972e1;
  const b4 = -1.328068155288572e1;

  const c0 = -7.784894002430293e-3;
  const c1 = -3.223964580411365e-1;
  const c2 = -2.400758277161838;
  const c3 = -2.549732539343734;
  const c4 = 4.374664141464968;
  const c5 = 2.938163982698783;

  const d0 = 7.784695709041462e-3;
  const d1 = 3.224671290700398e-1;
  const d2 = 2.445134137142996;
  const d3 = 3.754408661907416;

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) /
      ((((d0 * q + d1) * q + d2) * q + d3) * q + 1)
    );
  } else if (p <= pHigh) {
    q = p - 0.5;
    const r = q * q;
    return (
      ((((((a0 * r + a1) * r + a2) * r + a3) * r + a4) * r + a5) * q) /
      (((((b0 * r + b1) * r + b2) * r + b3) * r + b4) * r + 1)
    );
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) /
      ((((d0 * q + d1) * q + d2) * q + d3) * q + 1)
    );
  }
}

interface QQPoint {
  theoretical: number;
  sample: number;
  deviation: number;
}

function computeQQ(values: number[]): QQPoint[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return [];

  const mean = d3.mean(sorted) ?? 0;
  const stdDev = d3.deviation(sorted) ?? 1;

  return sorted.map((v, i) => {
    const p = (i + 0.5) / n;
    const theoretical = normalQuantile(p);
    const standardised = (v - mean) / stdDev;
    return {
      theoretical,
      sample: standardised,
      deviation: Math.abs(standardised - theoretical),
    };
  });
}

// ── Component ────────────────────────────────────────────────────

const MARGIN = { top: 16, right: 24, bottom: 44, left: 56 };

const QQPlot = React.memo(function QQPlot({
  data,
  width: widthProp,
  height = 300,
  goodColor,
  badColor,
}: QQPlotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const colors = useChartColors();

  const width = widthProp ?? 400;
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const points = useMemo(() => computeQQ(data), [data]);

  const { xScale, yScale, xTicks, yTicks, deviationColorScale } = useMemo(() => {
    if (points.length === 0) {
      return {
        xScale: d3.scaleLinear(),
        yScale: d3.scaleLinear(),
        xTicks: [] as number[],
        yTicks: [] as number[],
        deviationColorScale: d3.scaleLinear<string>(),
      };
    }

    const xMin = d3.min(points, (p) => p.theoretical) ?? -3;
    const xMax = d3.max(points, (p) => p.theoretical) ?? 3;
    const yMin = d3.min(points, (p) => p.sample) ?? -3;
    const yMax = d3.max(points, (p) => p.sample) ?? 3;
    const pad = 0.3;

    const xs = d3
      .scaleLinear()
      .domain([xMin - pad, xMax + pad])
      .range([0, innerW]);
    const ys = d3
      .scaleLinear()
      .domain([yMin - pad, yMax + pad])
      .range([innerH, 0]);

    const maxDev = d3.max(points, (p) => p.deviation) ?? 1;

    const devColor = d3
      .scaleLinear<string>()
      .domain([0, maxDev])
      .range([goodColor ?? colors.chart3, badColor ?? colors.chart2])
      .clamp(true);

    return {
      xScale: xs,
      yScale: ys,
      xTicks: xs.ticks(6),
      yTicks: ys.ticks(6),
      deviationColorScale: devColor,
    };
  }, [points, innerW, innerH, goodColor, badColor, colors]);

  if (points.length === 0) {
    return <div className={styles.empty}>No data</div>;
  }

  // Reference line from corner to corner
  const refX1 = xScale.domain()[0] ?? -3;
  const refX2 = xScale.domain()[1] ?? 3;

  return (
    <div className={styles.container} ref={containerRef}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Grid */}
          {xTicks.map((t) => (
            <line
              key={`xg-${t}`}
              x1={xScale(t)}
              x2={xScale(t)}
              y1={0}
              y2={innerH}
              stroke="var(--color-chart-grid)"
              strokeOpacity={0.4}
            />
          ))}
          {yTicks.map((t) => (
            <line
              key={`yg-${t}`}
              x1={0}
              x2={innerW}
              y1={yScale(t)}
              y2={yScale(t)}
              stroke="var(--color-chart-grid)"
              strokeOpacity={0.4}
            />
          ))}

          {/* Diagonal reference line */}
          <line
            className={styles.referenceLine}
            x1={xScale(refX1)}
            y1={yScale(refX1)}
            x2={xScale(refX2)}
            y2={yScale(refX2)}
            stroke={colors.textSecondary}
          />

          {/* Points */}
          {points.map((p, i) => (
            <circle
              key={i}
              className={styles.point}
              cx={xScale(p.theoretical)}
              cy={yScale(p.sample)}
              r={3}
              fill={deviationColorScale(p.deviation)}
              stroke={deviationColorScale(p.deviation)}
            >
              <title>
                Theoretical: {p.theoretical.toFixed(2)}, Sample: {p.sample.toFixed(2)}
              </title>
            </circle>
          ))}

          {/* X axis */}
          <g transform={`translate(0,${innerH})`}>
            {xTicks.map((t) => (
              <text
                key={t}
                x={xScale(t)}
                y={16}
                textAnchor="middle"
                fontSize={11}
                fill="var(--color-chart-axis)"
              >
                {t}
              </text>
            ))}
            <text className={styles.axisLabel} x={innerW / 2} y={36} textAnchor="middle">
              Theoretical quantiles
            </text>
          </g>

          {/* Y axis */}
          {yTicks.map((t) => (
            <text
              key={t}
              x={-8}
              y={yScale(t)}
              dy="0.32em"
              textAnchor="end"
              fontSize={11}
              fill="var(--color-chart-axis)"
            >
              {t.toFixed(1)}
            </text>
          ))}
          <text
            className={styles.axisLabel}
            x={-innerH / 2}
            y={-42}
            textAnchor="middle"
            transform="rotate(-90)"
          >
            Sample quantiles
          </text>
        </g>
      </svg>
    </div>
  );
});

export default QQPlot;
