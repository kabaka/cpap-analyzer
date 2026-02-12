/**
 * Kaplan-Meier survival curve with optional confidence intervals.
 *
 * @module components/charts/d3/KaplanMeierCurve
 */

import React, { useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { useChartColors } from '../useChartColors';
import styles from './KaplanMeierCurve.module.css';

// ── Types ────────────────────────────────────────────────────────

export interface SurvivalPoint {
  time: number;
  survival: number;
  censored?: boolean;
}

export interface ConfidenceInterval {
  time: number;
  lower: number;
  upper: number;
}

export interface KaplanMeierCurveProps {
  data: SurvivalPoint[];
  width?: number;
  height?: number;
  /** Confidence interval band. */
  confidenceInterval?: ConfidenceInterval[];
  /** X axis label (default "Time"). */
  xLabel?: string;
  /** Y axis label (default "Survival probability"). */
  yLabel?: string;
  /** Show reference line at survival = 0.5 (default true). */
  showMedianReference?: boolean;
}

// ── Component ────────────────────────────────────────────────────

const MARGIN = { top: 16, right: 24, bottom: 44, left: 56 };

const KaplanMeierCurve = React.memo(function KaplanMeierCurve({
  data,
  width: widthProp,
  height = 300,
  confidenceInterval,
  xLabel = 'Time',
  yLabel = 'Survival probability',
  showMedianReference = true,
}: KaplanMeierCurveProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const colors = useChartColors();

  const width = widthProp ?? 600;
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const sorted = useMemo(() => [...data].sort((a, b) => a.time - b.time), [data]);

  const { xScale, yScale, xTicks, yTicks } = useMemo(() => {
    const tMax = d3.max(sorted, (d) => d.time) ?? 1;

    const xs = d3.scaleLinear().domain([0, tMax]).range([0, innerW]).nice();
    const ys = d3.scaleLinear().domain([0, 1]).range([innerH, 0]);

    return { xScale: xs, yScale: ys, xTicks: xs.ticks(6), yTicks: ys.ticks(6) };
  }, [sorted, innerW, innerH]);

  /** Build step-function path data. */
  const stepPath = useMemo(() => {
    if (sorted.length === 0) return '';

    const parts: string[] = [`M ${xScale(0)} ${yScale(1)}`];
    let prevY = yScale(1);

    for (const pt of sorted) {
      const x = xScale(pt.time);
      const y = yScale(pt.survival);
      // Horizontal to current x at previous y, then vertical drop
      parts.push(`H ${x}`);
      if (y !== prevY) {
        parts.push(`V ${y}`);
      }
      prevY = y;
    }

    // Extend to end
    const domainEnd = xScale.domain()[1] ?? 0;
    parts.push(`H ${xScale(domainEnd)}`);
    return parts.join(' ');
  }, [sorted, xScale, yScale]);

  /** Build confidence band area. */
  const ciBand = useMemo(() => {
    if (!confidenceInterval || confidenceInterval.length === 0) return null;

    const ciSorted = [...confidenceInterval].sort((a, b) => a.time - b.time);

    const areaGen = d3
      .area<ConfidenceInterval>()
      .x((d) => xScale(d.time))
      .y0((d) => yScale(d.lower))
      .y1((d) => yScale(d.upper))
      .curve(d3.curveStepAfter);

    return areaGen(ciSorted);
  }, [confidenceInterval, xScale, yScale]);

  if (sorted.length === 0) {
    return <div className={styles.empty}>No data</div>;
  }

  const censoredPoints = sorted.filter((d) => d.censored);

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

          {/* Confidence interval band */}
          {ciBand && <path className={styles.confidenceBand} d={ciBand} fill={colors.chart1} />}

          {/* Step function line */}
          <path className={styles.stepLine} d={stepPath} stroke={colors.chart1} />

          {/* Censoring tick marks */}
          {censoredPoints.map((pt, i) => (
            <line
              key={`censor-${i}`}
              className={styles.censorTick}
              x1={xScale(pt.time)}
              x2={xScale(pt.time)}
              y1={yScale(pt.survival) - 5}
              y2={yScale(pt.survival) + 5}
              stroke={colors.chart1}
            />
          ))}

          {/* Median survival reference (y = 0.5) */}
          {showMedianReference && (
            <>
              <line
                className={styles.referenceLine}
                x1={0}
                x2={innerW}
                y1={yScale(0.5)}
                y2={yScale(0.5)}
                stroke={colors.textSecondary}
              />
              <text className={styles.referenceLabel} x={innerW + 4} y={yScale(0.5) + 4}>
                0.5
              </text>
            </>
          )}

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
              {xLabel}
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
            {yLabel}
          </text>
        </g>
      </svg>
    </div>
  );
});

export default KaplanMeierCurve;
