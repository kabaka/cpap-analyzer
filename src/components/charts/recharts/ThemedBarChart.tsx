/**
 * Theme-aware Recharts bar chart with optional stacking and orientation.
 *
 * @module components/charts/recharts/ThemedBarChart
 */

import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { paletteColor, useChartColors } from '../useChartColors';

// ── Types ────────────────────────────────────────────────────────

export interface BarConfig {
  dataKey: string;
  name: string;
  color?: string;
  stackId?: string;
  /** Radius for rounded bar caps [topLeft, topRight, bottomRight, bottomLeft]. */
  radius?: [number, number, number, number];
}

export interface ThemedBarChartProps {
  data: Record<string, unknown>[];
  bars: BarConfig[];
  xKey: string;
  xLabel?: string;
  yLabel?: string;
  height?: number;
  /** 'vertical' (default) renders vertical bars, 'horizontal' rotates layout. */
  orientation?: 'vertical' | 'horizontal';
  yDomain?: [number | 'auto', number | 'auto'];
}

// ── Component ────────────────────────────────────────────────────

const ThemedBarChart = React.memo(function ThemedBarChart({
  data,
  bars,
  xKey,
  xLabel,
  yLabel,
  height = 300,
  orientation = 'vertical',
  yDomain,
}: ThemedBarChartProps) {
  const colors = useChartColors();

  const renderedBars = useMemo(
    () =>
      bars.map((bar, i) => (
        <Bar
          key={bar.dataKey}
          dataKey={bar.dataKey}
          name={bar.name}
          fill={bar.color ?? paletteColor(colors, i)}
          stackId={bar.stackId}
          radius={bar.radius ?? [2, 2, 0, 0]}
          isAnimationActive={false}
        />
      )),
    [bars, colors],
  );

  if (!data || data.length === 0) {
    return null;
  }

  const isHorizontal = orientation === 'horizontal';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={isHorizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 16, bottom: 24, left: 16 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />

        {isHorizontal ? (
          <>
            <XAxis
              type="number"
              tick={{ fill: colors.axis, fontSize: 12 }}
              stroke={colors.axis}
              domain={yDomain}
              label={
                yLabel
                  ? { value: yLabel, position: 'insideBottom', offset: -12, fill: colors.axis }
                  : undefined
              }
            />
            <YAxis
              type="category"
              dataKey={xKey}
              tick={{ fill: colors.axis, fontSize: 12 }}
              stroke={colors.axis}
              width={80}
              label={
                xLabel
                  ? {
                      value: xLabel,
                      angle: -90,
                      position: 'insideLeft',
                      offset: 4,
                      fill: colors.axis,
                    }
                  : undefined
              }
            />
          </>
        ) : (
          <>
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
                  ? {
                      value: yLabel,
                      angle: -90,
                      position: 'insideLeft',
                      offset: 4,
                      fill: colors.axis,
                    }
                  : undefined
              }
            />
          </>
        )}

        <Tooltip
          contentStyle={{
            backgroundColor: colors.tooltipBg,
            border: `1px solid ${colors.tooltipBorder}`,
            borderRadius: 6,
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {renderedBars}
      </BarChart>
    </ResponsiveContainer>
  );
});

export default ThemedBarChart;
