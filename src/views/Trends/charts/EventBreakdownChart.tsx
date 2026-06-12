/**
 * Event Breakdown Chart — stacked area chart of event types per night.
 *
 * @module views/Trends/charts/EventBreakdownChart
 */

import React, { useCallback, useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
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
import { renderSettingsChangeMarkers } from './SettingsChangeMarkers';
import ChartPanel from './ChartPanel';

interface EventBreakdownChartProps {
  data: NightlyAggregate[];
  height: number;
  settingsChanges: SettingsChange[];
  hideXAxis?: boolean;
  onDataPointClick?: (date: string) => void;
}

interface EventDataPoint {
  date: string;
  obstructive: number;
  central: number;
  hypopnea: number;
  mixed: number;
  rera: number;
}

const EventBreakdownChart = React.memo(function EventBreakdownChart({
  data,
  height,
  settingsChanges,
  hideXAxis = true,
  onDataPointClick,
}: EventBreakdownChartProps) {
  const colors = useChartColors();
  const { activeDate, setActive, clear } = useSyncedChart();

  const eventData: EventDataPoint[] = useMemo(
    () =>
      data.map((d) => ({
        date: d.date,
        obstructive: d.eventsByType.obstructive,
        central: d.eventsByType.central,
        hypopnea: d.eventsByType.hypopnea,
        mixed: d.eventsByType.mixed,
        rera: d.eventsByType.rera,
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
      title="Event Breakdown"
      chartHeight={height + 30}
      accessibleSummary="Stacked area chart showing event types per night"
    >
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={eventData}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={clear}
          onClick={handleClick}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
          <XAxis dataKey="date" hide={hideXAxis} />
          <YAxis
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
          />

          <Legend
            verticalAlign="bottom"
            height={24}
            iconSize={10}
            wrapperStyle={{ fontSize: 11 }}
          />

          {/* Settings change markers — shared helper with <title> hover. */}
          {renderSettingsChangeMarkers(settingsChanges, { stroke: colors.axis })}

          {activeDate && <ReferenceLine x={activeDate} stroke={colors.axis} strokeOpacity={0.4} />}

          <Area
            type="monotone"
            dataKey="obstructive"
            name="Obstructive"
            stackId="events"
            stroke={colors.chart2}
            fill={colors.chart2}
            fillOpacity={0.6}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="central"
            name="Central"
            stackId="events"
            stroke={colors.chart4}
            fill={colors.chart4}
            fillOpacity={0.6}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="hypopnea"
            name="Hypopnea"
            stackId="events"
            stroke={colors.chart1}
            fill={colors.chart1}
            fillOpacity={0.6}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="mixed"
            name="Mixed"
            stackId="events"
            stroke={colors.chart5}
            fill={colors.chart5}
            fillOpacity={0.6}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="rera"
            name="RERA"
            stackId="events"
            stroke={colors.chart6}
            fill={colors.chart6}
            fillOpacity={0.6}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
});

export default EventBreakdownChart;
