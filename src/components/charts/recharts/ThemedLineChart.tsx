/**
 * Theme-aware Recharts line chart.
 *
 * Uses CSS design-token colours resolved at runtime for axes,
 * grid, and data lines.
 *
 * @module components/charts/recharts/ThemedLineChart
 */

import React, { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { paletteColor, useChartColors } from '../useChartColors';

// ── Types ────────────────────────────────────────────────────────

export interface LineConfig {
  /** Data key within each data record. */
  dataKey: string;
  /** Human-readable series name. */
  name: string;
  /** Override palette colour. */
  color?: string;
  /** Show dots on data points (default false). */
  dot?: boolean;
  /** Dash pattern e.g. "5 3" (default solid). */
  strokeDasharray?: string;
}

export interface ReferenceLineConfig {
  /** Y value for horizontal reference line, or X for vertical. */
  value: number;
  /** Label text displayed beside the line. */
  label?: string;
  /** Axis: 'y' for horizontal line, 'x' for vertical line (default 'y'). */
  axis?: 'x' | 'y';
  /** CSS colour. */
  color?: string;
  /** Dash pattern (default "3 3"). */
  strokeDasharray?: string;
}

export interface ThemedLineChartProps {
  /** Array of data points. */
  data: Record<string, unknown>[];
  /** Line series configuration. */
  lines: LineConfig[];
  /** Key used for the X axis. */
  xKey: string;
  /** X axis label. */
  xLabel?: string;
  /** Y axis label. */
  yLabel?: string;
  /** Chart height in px (default 300). */
  height?: number;
  /** Optional threshold / reference lines. */
  referenceLines?: ReferenceLineConfig[];
  /** Y axis domain [min, max]. */
  yDomain?: [number | 'auto', number | 'auto'];
}

// ── Component ────────────────────────────────────────────────────

const ThemedLineChart = React.memo(function ThemedLineChart({
  data,
  lines,
  xKey,
  xLabel,
  yLabel,
  height = 300,
  referenceLines,
  yDomain,
}: ThemedLineChartProps) {
  const colors = useChartColors();

  const renderedLines = useMemo(
    () =>
      lines.map((line, i) => (
        <Line
          key={line.dataKey}
          type="monotone"
          dataKey={line.dataKey}
          name={line.name}
          stroke={line.color ?? paletteColor(colors, i)}
          strokeWidth={2}
          dot={line.dot ?? false}
          strokeDasharray={line.strokeDasharray}
          isAnimationActive={false}
        />
      )),
    [lines, colors],
  );

  if (!data || data.length === 0) {
    return null;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
        <XAxis
          dataKey={xKey}
          tick={{ fill: colors.axis, fontSize: 12 }}
          stroke={colors.axis}
          label={
            xLabel
              ? { value: xLabel, position: 'insideBottom', offset: -12, fill: colors.axis }
              : undefined
          }
        />
        <YAxis
          tick={{ fill: colors.axis, fontSize: 12 }}
          stroke={colors.axis}
          domain={yDomain}
          label={
            yLabel
              ? { value: yLabel, angle: -90, position: 'insideLeft', offset: 4, fill: colors.axis }
              : undefined
          }
        />
        <Tooltip
          contentStyle={{
            backgroundColor: colors.tooltipBg,
            border: `1px solid ${colors.tooltipBorder}`,
            borderRadius: 6,
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {renderedLines}
        {referenceLines?.map((rl, i) =>
          rl.axis === 'x' ? (
            <ReferenceLine
              key={`ref-${i}`}
              x={rl.value}
              stroke={rl.color ?? colors.chart2}
              strokeDasharray={rl.strokeDasharray ?? '3 3'}
              label={
                rl.label ? { value: rl.label, fill: colors.textSecondary, fontSize: 11 } : undefined
              }
            />
          ) : (
            <ReferenceLine
              key={`ref-${i}`}
              y={rl.value}
              stroke={rl.color ?? colors.chart2}
              strokeDasharray={rl.strokeDasharray ?? '3 3'}
              label={
                rl.label ? { value: rl.label, fill: colors.textSecondary, fontSize: 11 } : undefined
              }
            />
          ),
        )}
      </LineChart>
    </ResponsiveContainer>
  );
});

export default ThemedLineChart;
