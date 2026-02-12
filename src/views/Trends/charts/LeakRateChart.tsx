/**
 * Leak Rate Chart — median line with P95 band.
 *
 * @module views/Trends/charts/LeakRateChart
 */

import React, { useCallback, useMemo } from 'react';
import {
  Area,
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
import type { SettingsChange } from '../utils/detectSettingsChanges';
import ChartPanel from './ChartPanel';

interface LeakRateChartProps {
  data: NightlyAggregate[];
  height: number;
  settingsChanges: SettingsChange[];
  hideXAxis?: boolean;
  onDataPointClick?: (date: string) => void;
}

const LeakRateChart = React.memo(function LeakRateChart({
  data,
  height,
  settingsChanges,
  hideXAxis = true,
  onDataPointClick,
}: LeakRateChartProps) {
  const colors = useChartColors();
  const { activeDate, setActive, clear } = useSyncedChart();

  const maxLeak = useMemo(() => {
    const m = Math.max(...data.map((d) => d.leakP95), 0);
    return Math.max(m * 1.1, 30);
  }, [data]);

  const handleMouseMove = useCallback(
    (state: { activeLabel?: string; activeTooltipIndex?: number }) => {
      if (state.activeLabel) {
        setActive(state.activeLabel, state.activeTooltipIndex ?? null);
      }
    },
    [setActive],
  );

  const handleClick = useCallback(
    (state: { activeLabel?: string } | null) => {
      if (state?.activeLabel && onDataPointClick) {
        onDataPointClick(state.activeLabel);
      }
    },
    [onDataPointClick],
  );

  if (data.length === 0) return null;

  return (
    <ChartPanel
      title="Leak Rate"
      chartHeight={height}
      accessibleSummary="Leak rate chart showing median and 95th percentile"
    >
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={clear}
          onClick={handleClick}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
          <XAxis dataKey="date" hide={hideXAxis} />
          <YAxis
            domain={[0, maxLeak]}
            tick={{ fill: colors.axis, fontSize: 11 }}
            stroke={colors.axis}
            width={40}
            orientation="right"
          />

          <Tooltip
            cursor={{ stroke: colors.axis, strokeOpacity: 0.3 }}
            contentStyle={{
              background: colors.tooltipBg,
              border: `1px solid ${colors.tooltipBorder}`,
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => {
              const label = name === 'leakP95' ? 'P95' : 'Median';
              return [`${value.toFixed(1)} L/min`, label];
            }}
          />

          {/* P95 band (area from median to P95) */}
          <Area
            dataKey="leakP95"
            stroke="none"
            fill={colors.chart6}
            fillOpacity={0.15}
            isAnimationActive={false}
          />
          <Area
            dataKey="leakMedian"
            stroke="none"
            fill={colors.surfacePrimary}
            fillOpacity={1}
            isAnimationActive={false}
          />

          {/* Warning threshold */}
          <ReferenceLine
            y={24}
            stroke={colors.chart5}
            strokeDasharray="6 3"
            label={{ value: '24 L/min', position: 'right', fill: colors.axis, fontSize: 10 }}
          />

          {/* Settings change markers */}
          {settingsChanges.map((sc) => (
            <ReferenceLine
              key={`sc-${sc.date}`}
              x={sc.date}
              stroke={colors.axis}
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
          ))}

          {activeDate && <ReferenceLine x={activeDate} stroke={colors.axis} strokeOpacity={0.4} />}

          {/* Median line on top */}
          <Line
            dataKey="leakMedian"
            type="monotone"
            stroke={colors.chart6}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            activeDot={{ r: 5, cursor: 'pointer' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
});

export default LeakRateChart;
