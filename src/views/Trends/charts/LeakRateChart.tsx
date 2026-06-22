/**
 * Leak Rate Chart — median line with a median→P95 band (Canvas2D).
 *
 * Migrated from Recharts/SVG to the Canvas2D + HTML-chrome architecture. The
 * visuals are reproduced exactly: a desaturated band spanning the per-night
 * median up to the 95th percentile (the Recharts "knockout" of a P95 area by an
 * opaque median area, drawn here directly as a single filled band between the two
 * series), the median line on top, the leak-notice reference line with a
 * right-anchored label, settings-change markers, and the synced crosshair.
 *
 * @module views/Trends/charts/LeakRateChart
 */

import React, { useCallback, useMemo } from 'react';
import { useChartColors } from '@/components/charts/useChartColors';
import { LEAK_NOTICE_LPM } from '@/analysis/uncertainty/constants';
import { LEAK_AXIS_FLOOR, computeAxisMax } from './chartScale';
import { useSyncedChart } from '../context/SyncedChartContext';
import type { NightlyAggregate } from '@/types';
import type { SettingsChange } from '../utils/detectSettingsChanges';
import ChartPanel from './ChartPanel';
import TrendsCanvasChart, { type DrawContext, type ChartMargins } from './canvas/TrendsCanvasChart';
import type { CurvePoint } from './canvas/curve';
import { SettingsMarkerOverlay } from './SettingsChangeMarkers';

interface LeakRateChartProps {
  data: NightlyAggregate[];
  height: number;
  settingsChanges: SettingsChange[];
  hideXAxis?: boolean;
  onDataPointClick?: (date: string) => void;
}

/** Recharts `margin={{ top: 8, right: 8, bottom: 0, left: 0 }}` + right Y gutter
 *  (`YAxis width={40}`). The plot is inset by the gutter on the right. */
const MARGINS: ChartMargins = { top: 8, right: 48, bottom: 0, left: 0 };

const LeakRateChart = React.memo(function LeakRateChart({
  data,
  height,
  settingsChanges,
  onDataPointClick,
}: LeakRateChartProps) {
  const colors = useChartColors();
  const { activeDate, activeIndex } = useSyncedChart();

  const maxLeak = useMemo(() => {
    const m = Math.max(...data.map((d) => d.leakP95), 0);
    return computeAxisMax(m, LEAK_AXIS_FLOOR);
  }, [data]);

  const domain = useMemo(() => ({ min: 0, max: maxLeak }), [maxLeak]);

  const dateAtIndex = useCallback((i: number) => data[i]?.date, [data]);

  const drawBase = useCallback(
    ({ renderer, plot, count, fontFamily }: DrawContext) => {
      renderer.beginBase(colors.surfacePrimary);
      const ticks = renderer.drawHorizontalGrid(domain, plot, colors.grid);

      // Band between median and P95 (the Recharts knockout, drawn directly).
      const median: CurvePoint[] = data.map((d, i) => ({
        x: renderer.pointX(i, count, plot),
        y: renderer.valueY(d.leakMedian, domain, plot),
      }));
      const p95: CurvePoint[] = data.map((d, i) => ({
        x: renderer.pointX(i, count, plot),
        y: renderer.valueY(d.leakP95, domain, plot),
      }));
      renderer.drawBandBetween(median, p95, { color: colors.chart6, opacity: 0.15 }, plot);

      // Leak-notice reference line + right label.
      renderer.drawHorizontalReferenceLine(
        LEAK_NOTICE_LPM,
        domain,
        plot,
        { color: colors.chart5, dash: [6, 3] },
        { text: `${LEAK_NOTICE_LPM} L/min`, color: colors.axis, fontFamily },
      );

      // Median line on top.
      renderer.drawMonotoneLine(median, { color: colors.chart6, width: 1.5 }, plot, false);

      renderer.drawYAxisRight(domain, plot, colors.axis, fontFamily, ticks);
    },
    [colors, domain, data],
  );

  const drawOverlay = useCallback(
    ({ renderer, plot, count }: DrawContext, idx: number | null) => {
      if (idx === null || idx < 0 || idx >= data.length) return;
      const x = renderer.pointX(idx, count, plot);
      renderer.drawVerticalReferenceLine(x, plot, { color: colors.axis, opacity: 0.4 });
      const d = data[idx];
      if (d) {
        const y = renderer.valueY(d.leakMedian, domain, plot);
        renderer.drawActiveDot(x, y, 5, colors.chart6);
      }
    },
    [colors, domain, data],
  );

  // Screen-reader table depends ONLY on the per-night rows, never on the active
  // hover index — memoise it so a hover-driven re-render does not reconcile the
  // night <tr>s. Markup is identical to the inline form. Declared BEFORE the
  // empty-data early return to keep hook order unconditional.
  const srSummary = useMemo(
    () => (
      <table>
        <caption>Leak rate per night: median and 95th percentile (L/min).</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Median leak</th>
            <th scope="col">P95 leak</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.leakMedian.toFixed(1)}</td>
              <td>{d.leakP95.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
    [data],
  );

  if (data.length === 0) return null;

  return (
    <ChartPanel
      title="Leak Rate"
      chartHeight={height}
      accessibleSummary="Leak rate chart showing median and 95th percentile"
      srSummary={srSummary}
    >
      <div style={{ position: 'relative', width: '100%', height }}>
        <TrendsCanvasChart
          count={data.length}
          dataKey={data}
          height={height}
          margins={MARGINS}
          drawBase={drawBase}
          drawOverlay={drawOverlay}
          dateAtIndex={dateAtIndex}
          onDataPointClick={onDataPointClick}
          ariaLabel="Leak rate chart"
        />
        <SettingsMarkerOverlay
          changes={settingsChanges}
          data={data}
          margins={MARGINS}
          stroke={colors.axis}
        />
        {activeDate && activeIndex !== null && data[activeIndex] && (
          <LeakTooltip
            d={data[activeIndex]}
            index={activeIndex}
            count={data.length}
            margins={MARGINS}
            colors={colors}
          />
        )}
      </div>
    </ChartPanel>
  );
});

/** HTML tooltip positioned at the hovered category (replaces Recharts Tooltip). */
function LeakTooltip({
  d,
  index,
  count,
  margins,
  colors,
}: {
  d: NightlyAggregate;
  index: number;
  count: number;
  margins: ChartMargins;
  colors: ReturnType<typeof useChartColors>;
}) {
  // Position as a percentage of the plot width so it tracks on resize.
  const leftPct = count <= 1 ? 50 : (index / (count - 1)) * 100;
  return (
    <div
      style={{
        position: 'absolute',
        top: margins.top,
        left: `calc(${margins.left}px + (100% - ${margins.left + margins.right}px) * ${leftPct / 100})`,
        transform: 'translateX(-50%)',
        background: colors.tooltipBg,
        border: `1px solid ${colors.tooltipBorder}`,
        fontSize: 12,
        padding: '6px 8px',
        borderRadius: 4,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: 2,
      }}
      role="status"
      aria-hidden="true"
    >
      <div style={{ fontWeight: 600 }}>{d.date}</div>
      <div>Median: {d.leakMedian.toFixed(1)} L/min</div>
      <div>P95: {d.leakP95.toFixed(1)} L/min</div>
    </div>
  );
}

export default LeakRateChart;
