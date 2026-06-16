/**
 * Event Breakdown Chart — stacked area of event types per night.
 *
 * Two uncertainty treatments, deliberately INDEPENDENT (consensus D5/D6):
 *
 * 1. The central-vs-obstructive split and RERA are LOW-reliability modelled
 *    inferences. They are drawn with a diagonal **hatch pattern** (a non-colour
 *    cue that survives grayscale/print) and a "modeled inference" caveat note.
 *    This lowers the *precision* claim only.
 *
 * 2. A rising central (Clear-Airway) trend STILL surfaces a persistent, visible
 *    **"discuss with your clinician" prompt**. The low-reliability caveat must
 *    never silence, hide, or dim this prompt — under-reaction to
 *    treatment-emergent central apnea is the dangerous failure mode (D6). The
 *    prompt is rendered outside the plot, full-opacity, with informational
 *    (non-diagnostic, non-therapy-specific) copy.
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
import { detectRisingCentralTrend } from '../utils/centralTrend';
import type { NightlyAggregate } from '@/types';
import type { SettingsChange } from '../utils/detectSettingsChanges';
import { renderSettingsChangeMarkers } from './SettingsChangeMarkers';
import ChartPanel from './ChartPanel';
import styles from './EventBreakdownChart.module.css';

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

const CENTRAL_HATCH_ID = 'event-breakdown-central-hatch';
const RERA_HATCH_ID = 'event-breakdown-rera-hatch';

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

  // Safety-critical: detect a rising central trend independently of the
  // low-reliability caveat styling (consensus D6).
  const centralTrend = useMemo(() => detectRisingCentralTrend(data), [data]);

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

  const caveat =
    'Central vs. obstructive split and RERA are modeled inferences (shown with a hatched fill), not direct measurements — read them as directional, not exact.';

  return (
    <ChartPanel
      title="Event Breakdown"
      chartHeight={height + 30}
      accessibleSummary="Stacked area chart showing event types per night; central and RERA series are modeled inferences shown with a hatched fill"
      footnote={caveat}
    >
      {/* SAFETY-CRITICAL clinician prompt (consensus D6). Rendered ABOVE/outside
          the plot at full opacity so the low-reliability caveat never buries it.
          role="status" so assistive tech announces it; copy is informational
          and non-diagnostic — it prompts a conversation, names no condition or
          therapy. */}
      {centralTrend.rising && (
        <div
          className={styles.clinicianPrompt}
          role="status"
          data-testid="central-clinician-prompt"
        >
          <span className={styles.clinicianPromptIcon} aria-hidden="true">
            ⚑
          </span>
          <p className={styles.clinicianPromptText}>
            <span className={styles.clinicianPromptTitle}>
              Your central (clear-airway) events appear to be rising.
            </span>{' '}
            This pattern is worth discussing with your clinician. The central/obstructive split is
            an estimate, so bring your data along for review rather than drawing conclusions from it
            alone.
          </p>
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={eventData}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={clear}
          onClick={handleClick}
        >
          {/* Diagonal hatch patterns — non-colour cue marking the low-reliability
              (modeled) series, robust to grayscale/print/colour-blindness. */}
          <defs>
            <pattern
              id={CENTRAL_HATCH_ID}
              patternUnits="userSpaceOnUse"
              width={6}
              height={6}
              patternTransform="rotate(45)"
            >
              <rect width={6} height={6} fill={colors.chart4} fillOpacity={0.25} />
              <line x1={0} y1={0} x2={0} y2={6} stroke={colors.chart4} strokeWidth={1.5} />
            </pattern>
            <pattern
              id={RERA_HATCH_ID}
              patternUnits="userSpaceOnUse"
              width={6}
              height={6}
              patternTransform="rotate(45)"
            >
              <rect width={6} height={6} fill={colors.chart6} fillOpacity={0.25} />
              <line x1={0} y1={0} x2={0} y2={6} stroke={colors.chart6} strokeWidth={1.5} />
            </pattern>
          </defs>

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
            name="Central (modeled)"
            stackId="events"
            stroke={colors.chart4}
            fill={`url(#${CENTRAL_HATCH_ID})`}
            fillOpacity={1}
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
            name="RERA (modeled)"
            stackId="events"
            stroke={colors.chart6}
            fill={`url(#${RERA_HATCH_ID})`}
            fillOpacity={1}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
});

export default EventBreakdownChart;
