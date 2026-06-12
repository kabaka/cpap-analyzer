/**
 * AHI Trend Chart — line chart with severity zone bands.
 *
 * @module views/Trends/charts/AHITrendChart
 */

import React, { useCallback, useMemo } from 'react';
import {
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { useChartColors } from '@/components/charts/useChartColors';
import { useSyncedChart } from '../context/SyncedChartContext';
import type { NightlyAggregate } from '@/types';
import type { SettingsChange } from '../utils/detectSettingsChanges';
import { renderSettingsChangeMarkers } from './SettingsChangeMarkers';
import ChartPanel from './ChartPanel';

interface AHITrendChartProps {
  data: NightlyAggregate[];
  height: number;
  settingsChanges: SettingsChange[];
  hideXAxis?: boolean;
  onDataPointClick?: (date: string) => void;
}

const AHITrendChart = React.memo(function AHITrendChart({
  data,
  height,
  settingsChanges,
  hideXAxis = true,
  onDataPointClick,
}: AHITrendChartProps) {
  const colors = useChartColors();
  const { activeDate, setActive, clear } = useSyncedChart();

  const maxAHI = useMemo(() => {
    const m = Math.max(...data.map((d) => d.ahi), 0);
    return Math.max(m * 1.1, 10);
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
      title="AHI"
      chartHeight={height}
      accessibleSummary="AHI trend chart with clinical severity zones"
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

          {/* Severity zones */}
          <ReferenceArea y1={0} y2={5} fill={colors.chart3} fillOpacity={0.08} />
          <ReferenceArea y1={5} y2={15} fill={colors.chart5} fillOpacity={0.08} />
          <ReferenceArea y1={15} y2={30} fill={colors.chart5} fillOpacity={0.15} />
          <ReferenceArea y1={30} y2={maxAHI} fill={colors.chart2} fillOpacity={0.1} />

          <XAxis dataKey="date" hide={hideXAxis} />
          <YAxis
            domain={[0, maxAHI]}
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
            labelFormatter={(label: string) => label}
            formatter={(value: number) => [value.toFixed(1), 'AHI']}
          />

          {/* Settings change markers — shared helper renders a dashed
              vertical line per change with a native-SVG <title> tooltip. */}
          {renderSettingsChangeMarkers(settingsChanges, { stroke: colors.axis })}

          {/* Synced crosshair */}
          {activeDate && <ReferenceLine x={activeDate} stroke={colors.axis} strokeOpacity={0.4} />}

          <Line
            type="monotone"
            dataKey="ahi"
            stroke={colors.chart1}
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

export default AHITrendChart;
