/**
 * Theme-aware Recharts area chart with gradient fills.
 *
 * @module components/charts/recharts/ThemedAreaChart
 */

import React, { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { paletteColor, useChartColors } from '../useChartColors';

// ── Types ────────────────────────────────────────────────────────

export interface AreaConfig {
  dataKey: string;
  name: string;
  color?: string;
  /** Stack id for stacked areas (same id = same stack). */
  stackId?: string;
  /** Fill opacity (default 0.3). */
  fillOpacity?: number;
}

export interface ThemedAreaChartProps {
  data: Record<string, unknown>[];
  areas: AreaConfig[];
  xKey: string;
  xLabel?: string;
  yLabel?: string;
  height?: number;
  yDomain?: [number | 'auto', number | 'auto'];
}

// ── Component ────────────────────────────────────────────────────

const ThemedAreaChart = React.memo(function ThemedAreaChart({
  data,
  areas,
  xKey,
  xLabel,
  yLabel,
  height = 300,
  yDomain,
}: ThemedAreaChartProps) {
  const colors = useChartColors();

  /** Unique id prefix for gradient defs to avoid collisions when multiple instances render. */
  const gradientId = useMemo(() => `area-grad-${Math.random().toString(36).slice(2, 8)}`, []);

  if (!data || data.length === 0) {
    return null;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 16 }}>
        <defs>
          {areas.map((area, i) => {
            const fill = area.color ?? paletteColor(colors, i);
            return (
              <linearGradient
                key={area.dataKey}
                id={`${gradientId}-${area.dataKey}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="5%" stopColor={fill} stopOpacity={area.fillOpacity ?? 0.3} />
                <stop offset="95%" stopColor={fill} stopOpacity={0.02} />
              </linearGradient>
            );
          })}
        </defs>

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

        {areas.map((area, i) => {
          const stroke = area.color ?? paletteColor(colors, i);
          return (
            <Area
              key={area.dataKey}
              type="monotone"
              dataKey={area.dataKey}
              name={area.name}
              stroke={stroke}
              strokeWidth={2}
              fill={`url(#${gradientId}-${area.dataKey})`}
              fillOpacity={1}
              stackId={area.stackId}
              isAnimationActive={false}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
});

export default ThemedAreaChart;
