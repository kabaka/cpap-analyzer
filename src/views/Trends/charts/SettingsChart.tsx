/**
 * Machine Settings Chart — step chart for pressure config and EPR level.
 *
 * Shows configuredMinPressure, configuredMaxPressure as step lines
 * and EPR level on a secondary y-axis.
 *
 * @module views/Trends/charts/SettingsChart
 */

import React, { useCallback, useMemo } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartColors } from '@/components/charts/useChartColors';
import { useSyncedChart } from '../context/SyncedChartContext';
import type { NightlyAggregate } from '@/types';
import ChartPanel from './ChartPanel';

interface SettingsChartProps {
  data: NightlyAggregate[];
  height: number;
  hideXAxis?: boolean;
}

interface SettingsDataPoint {
  date: string;
  minPressure: number | null;
  maxPressure: number | null;
  eprLevel: number | null;
}

const SettingsChart = React.memo(function SettingsChart({
  data,
  height,
  hideXAxis = true,
}: SettingsChartProps) {
  const colors = useChartColors();
  const { activeDate, setActive, clear } = useSyncedChart();

  const hasSettingsData = useMemo(
    () =>
      data.some(
        (d) =>
          d.configuredMinPressure !== null ||
          d.configuredMaxPressure !== null ||
          d.eprLevel !== null,
      ),
    [data],
  );

  const settingsData: SettingsDataPoint[] = useMemo(
    () =>
      data.map((d) => ({
        date: d.date,
        minPressure: d.configuredMinPressure,
        maxPressure: d.configuredMaxPressure,
        eprLevel: d.eprLevel,
      })),
    [data],
  );

  const handleMouseMove = useCallback(
    (state: { activeLabel?: string; activeTooltipIndex?: number }) => {
      if (state.activeLabel) {
        setActive(state.activeLabel, state.activeTooltipIndex ?? null);
      }
    },
    [setActive],
  );

  if (!hasSettingsData || data.length === 0) {
    return (
      <ChartPanel title="Machine Settings" chartHeight={60} accessibleSummary="No settings data">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 60,
            color: 'var(--color-text-muted)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          Machine settings data not available.
        </div>
      </ChartPanel>
    );
  }

  return (
    <ChartPanel
      title="Machine Settings"
      chartHeight={height}
      accessibleSummary="Step chart showing configured pressure and EPR settings over time"
    >
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={settingsData}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={clear}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
          <XAxis dataKey="date" hide={hideXAxis} />

          {/* Left Y-axis: pressure */}
          <YAxis
            yAxisId="pressure"
            tick={{ fill: colors.axis, fontSize: 11 }}
            stroke={colors.axis}
            width={40}
            orientation="right"
            label={{
              value: 'cmH₂O',
              angle: -90,
              position: 'insideRight',
              fill: colors.axis,
              fontSize: 10,
            }}
          />

          {/* Right Y-axis: EPR */}
          <YAxis
            yAxisId="epr"
            domain={[0, 3]}
            tick={{ fill: colors.axis, fontSize: 11 }}
            stroke={colors.axis}
            width={30}
            orientation="left"
            label={{
              value: 'EPR',
              angle: 90,
              position: 'insideLeft',
              fill: colors.axis,
              fontSize: 10,
            }}
          />

          <Tooltip
            cursor={{ stroke: colors.axis, strokeOpacity: 0.3 }}
            contentStyle={{
              background: colors.tooltipBg,
              border: `1px solid ${colors.tooltipBorder}`,
              fontSize: 12,
            }}
            formatter={(value: number) => {
              if (value == null) return ['N/A', ''];
              return [value.toFixed(1), ''];
            }}
          />

          {activeDate && (
            <ReferenceLine
              x={activeDate}
              stroke={colors.axis}
              strokeOpacity={0.4}
              yAxisId="pressure"
            />
          )}

          <Line
            yAxisId="pressure"
            type="stepAfter"
            dataKey="maxPressure"
            name="maxPressure"
            stroke={colors.chart2}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            yAxisId="pressure"
            type="stepAfter"
            dataKey="minPressure"
            name="minPressure"
            stroke={colors.chart3}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            yAxisId="epr"
            type="stepAfter"
            dataKey="eprLevel"
            name="eprLevel"
            stroke={colors.chart5}
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
});

export default SettingsChart;
