/**
 * Pressure Chart — mean line with P95 band and configured pressure references.
 *
 * @module views/Trends/charts/PressureChart
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

interface PressureChartProps {
  data: NightlyAggregate[];
  height: number;
  settingsChanges: SettingsChange[];
  hideXAxis?: boolean;
  onDataPointClick?: (date: string) => void;
}

const PressureChart = React.memo(function PressureChart({
  data,
  height,
  settingsChanges,
  hideXAxis = true,
  onDataPointClick,
}: PressureChartProps) {
  const colors = useChartColors();
  const { activeDate, setActive, clear } = useSyncedChart();

  const { yMin, yMax, configuredMin, configuredMax } = useMemo(() => {
    const means = data.map((d) => d.pressureMean);
    const p95s = data.map((d) => d.pressureP95);
    const allVals = [...means, ...p95s];

    const low = Math.min(...allVals);
    const high = Math.max(...allVals);

    // Use the latest aggregate for configured pressures
    const latest = data.length > 0 ? data[data.length - 1] : null;
    const cfgMin = latest?.configuredMinPressure ?? null;
    const cfgMax = latest?.configuredMaxPressure ?? null;

    return {
      yMin: Math.max((cfgMin ?? low) - 2, 0),
      yMax: Math.max(cfgMax ?? high, high) + 2,
      configuredMin: cfgMin,
      configuredMax: cfgMax,
    };
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
      title="Pressure"
      chartHeight={height}
      accessibleSummary="Therapy pressure chart with mean line and P95 band"
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
            domain={[yMin, yMax]}
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
              const label = name === 'pressureP95' ? 'P95' : 'Mean';
              return [`${value.toFixed(1)} cmH₂O`, label];
            }}
          />

          {/* P95 band */}
          <Area
            dataKey="pressureP95"
            stroke="none"
            fill={colors.chart4}
            fillOpacity={0.15}
            isAnimationActive={false}
          />
          <Area
            dataKey="pressureMean"
            stroke="none"
            fill={colors.surfacePrimary}
            fillOpacity={1}
            isAnimationActive={false}
          />

          {/* Configured pressure reference lines */}
          {configuredMin !== null && (
            <ReferenceLine
              y={configuredMin}
              stroke={colors.axis}
              strokeDasharray="3 3"
              label={{ value: 'Min', position: 'right', fill: colors.axis, fontSize: 10 }}
            />
          )}
          {configuredMax !== null && (
            <ReferenceLine
              y={configuredMax}
              stroke={colors.axis}
              strokeDasharray="3 3"
              label={{ value: 'Max', position: 'right', fill: colors.axis, fontSize: 10 }}
            />
          )}

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

          {/* Mean line on top */}
          <Line
            dataKey="pressureMean"
            type="monotone"
            stroke={colors.chart4}
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

export default PressureChart;
