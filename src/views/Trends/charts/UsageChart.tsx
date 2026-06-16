/**
 * Usage Hours Chart — bar chart with CMS compliance and target reference lines.
 *
 * Color-codes bars: green (≥6h), yellow (≥4h), red (<4h).
 * Falls back to a line chart for ranges > 180 days.
 *
 * @module views/Trends/charts/UsageChart
 */

import React, { useCallback, useMemo } from 'react';
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartColors } from '@/components/charts/useChartColors';
import { CMS_COMPLIANCE_HOURS, RECOMMENDED_USAGE_HOURS } from '@/analysis/clinical';
import { USAGE_AXIS_FLOOR, computeAxisMax } from './chartScale';
import { useSyncedChart } from '../context/SyncedChartContext';
import type { NightlyAggregate } from '@/types';
import type { SettingsChange } from '../utils/detectSettingsChanges';
import { renderSettingsChangeMarkers } from './SettingsChangeMarkers';
import ChartPanel from './ChartPanel';

interface UsageChartProps {
  data: NightlyAggregate[];
  height: number;
  settingsChanges: SettingsChange[];
  hideXAxis?: boolean;
  onDataPointClick?: (date: string) => void;
}

function getBarColor(hours: number, colors: { chart3: string; chart5: string; chart2: string }) {
  if (hours >= RECOMMENDED_USAGE_HOURS) return colors.chart3; // green
  if (hours >= CMS_COMPLIANCE_HOURS) return colors.chart5; // orange/yellow
  return colors.chart2; // red
}

const UsageChart = React.memo(function UsageChart({
  data,
  height,
  settingsChanges,
  hideXAxis = true,
  onDataPointClick,
}: UsageChartProps) {
  const colors = useChartColors();
  const { activeDate, setActive, clear } = useSyncedChart();

  const maxUsage = useMemo(() => {
    const m = Math.max(...data.map((d) => d.usageHours), 0);
    return computeAxisMax(m, USAGE_AXIS_FLOOR);
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
      title="Usage Hours"
      chartHeight={height}
      accessibleSummary="Usage hours bar chart with CMS compliance and target lines"
    >
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={clear}
          onClick={handleClick}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
          <XAxis dataKey="date" hide={hideXAxis} />
          <YAxis
            domain={[0, maxUsage]}
            tick={{ fill: colors.axis, fontSize: 11 }}
            stroke={colors.axis}
            width={40}
            orientation="right"
          />

          <Tooltip
            cursor={{ fill: colors.grid, fillOpacity: 0.3 }}
            contentStyle={{
              background: colors.tooltipBg,
              border: `1px solid ${colors.tooltipBorder}`,
              fontSize: 12,
            }}
            formatter={(value: number) => [`${value.toFixed(1)} hrs`, 'Usage']}
          />

          {/* Reference lines */}
          <ReferenceLine
            y={CMS_COMPLIANCE_HOURS}
            stroke={colors.chart5}
            strokeDasharray="6 3"
            label={{
              value: `${CMS_COMPLIANCE_HOURS}h`,
              position: 'right',
              fill: colors.axis,
              fontSize: 10,
            }}
          />
          <ReferenceLine
            y={RECOMMENDED_USAGE_HOURS}
            stroke={colors.chart3}
            strokeDasharray="6 3"
            label={{
              value: `${RECOMMENDED_USAGE_HOURS}h`,
              position: 'right',
              fill: colors.axis,
              fontSize: 10,
            }}
          />

          {/* Settings change markers — shared helper with <title> hover. */}
          {renderSettingsChangeMarkers(settingsChanges, { stroke: colors.axis })}

          {/* Synced crosshair */}
          {activeDate && <ReferenceLine x={activeDate} stroke={colors.axis} strokeOpacity={0.4} />}

          <Bar
            dataKey="usageHours"
            isAnimationActive={false}
            radius={[2, 2, 0, 0]}
            cursor="pointer"
          >
            {data.map((entry) => (
              <Cell key={entry.date} fill={getBarColor(entry.usageHours, colors)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
});

export default UsageChart;
