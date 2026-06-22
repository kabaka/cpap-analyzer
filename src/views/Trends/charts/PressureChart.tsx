/**
 * Pressure Chart — mean line with a mean→P95 band and configured-pressure
 * reference lines (Canvas2D).
 *
 * Migrated from Recharts/SVG. Visuals reproduced exactly: a desaturated band
 * from the per-night mean up to the 95th percentile (the Recharts "knockout"
 * drawn directly as a single band between the two series), the mean line on top,
 * configured min/max pressure reference lines with right-anchored labels,
 * settings-change markers, and the synced crosshair.
 *
 * @module views/Trends/charts/PressureChart
 */

import React, { useCallback, useMemo } from 'react';
import { useChartColors } from '@/components/charts/useChartColors';
import { useSyncedChart } from '../context/SyncedChartContext';
import type { NightlyAggregate } from '@/types';
import type { SettingsChange } from '../utils/detectSettingsChanges';
import ChartPanel from './ChartPanel';
import TrendsCanvasChart, { type DrawContext, type ChartMargins } from './canvas/TrendsCanvasChart';
import type { CurvePoint } from './canvas/curve';
import { SettingsMarkerOverlay } from './SettingsChangeMarkers';

interface PressureChartProps {
  data: NightlyAggregate[];
  height: number;
  settingsChanges: SettingsChange[];
  hideXAxis?: boolean;
  onDataPointClick?: (date: string) => void;
}

const MARGINS: ChartMargins = { top: 8, right: 48, bottom: 0, left: 0 };

const PressureChart = React.memo(function PressureChart({
  data,
  height,
  settingsChanges,
  onDataPointClick,
}: PressureChartProps) {
  const colors = useChartColors();
  const { activeDate, activeIndex } = useSyncedChart();

  const { yMin, yMax, configuredMin, configuredMax } = useMemo(() => {
    const means = data.map((d) => d.pressureMean);
    const p95s = data.map((d) => d.pressureP95);
    const allVals = [...means, ...p95s];

    const low = Math.min(...allVals);
    const high = Math.max(...allVals);

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

  const domain = useMemo(() => ({ min: yMin, max: yMax }), [yMin, yMax]);
  const dateAtIndex = useCallback((i: number) => data[i]?.date, [data]);

  const drawBase = useCallback(
    ({ renderer, plot, count, fontFamily }: DrawContext) => {
      renderer.beginBase(colors.surfacePrimary);
      const ticks = renderer.drawHorizontalGrid(domain, plot, colors.grid);

      const mean: CurvePoint[] = data.map((d, i) => ({
        x: renderer.pointX(i, count, plot),
        y: renderer.valueY(d.pressureMean, domain, plot),
      }));
      const p95: CurvePoint[] = data.map((d, i) => ({
        x: renderer.pointX(i, count, plot),
        y: renderer.valueY(d.pressureP95, domain, plot),
      }));
      renderer.drawBandBetween(mean, p95, { color: colors.chart4, opacity: 0.15 }, plot);

      if (configuredMin !== null) {
        renderer.drawHorizontalReferenceLine(
          configuredMin,
          domain,
          plot,
          { color: colors.axis, dash: [3, 3] },
          { text: 'Min', color: colors.axis, fontFamily },
        );
      }
      if (configuredMax !== null) {
        renderer.drawHorizontalReferenceLine(
          configuredMax,
          domain,
          plot,
          { color: colors.axis, dash: [3, 3] },
          { text: 'Max', color: colors.axis, fontFamily },
        );
      }

      renderer.drawMonotoneLine(mean, { color: colors.chart4, width: 1.5 }, plot, false);
      renderer.drawYAxisRight(domain, plot, colors.axis, fontFamily, ticks);
    },
    [colors, domain, data, configuredMin, configuredMax],
  );

  const drawOverlay = useCallback(
    ({ renderer, plot, count }: DrawContext, idx: number | null) => {
      if (idx === null || idx < 0 || idx >= data.length) return;
      const x = renderer.pointX(idx, count, plot);
      renderer.drawVerticalReferenceLine(x, plot, { color: colors.axis, opacity: 0.4 });
      const d = data[idx];
      if (d) {
        const y = renderer.valueY(d.pressureMean, domain, plot);
        renderer.drawActiveDot(x, y, 5, colors.chart4);
      }
    },
    [colors, domain, data],
  );

  if (data.length === 0) return null;

  const srSummary = (
    <table>
      <caption>Therapy pressure per night: mean and 95th percentile (cmH₂O).</caption>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Mean pressure</th>
          <th scope="col">P95 pressure</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.date}>
            <td>{d.date}</td>
            <td>{d.pressureMean.toFixed(1)}</td>
            <td>{d.pressureP95.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartPanel
      title="Pressure"
      chartHeight={height}
      accessibleSummary="Therapy pressure chart with mean line and P95 band"
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
          ariaLabel="Pressure chart"
        />
        <SettingsMarkerOverlay
          changes={settingsChanges}
          data={data}
          margins={MARGINS}
          stroke={colors.axis}
        />
        {activeDate && activeIndex !== null && data[activeIndex] && (
          <PressureTooltip
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

function PressureTooltip({
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
      <div>Mean: {d.pressureMean.toFixed(1)} cmH₂O</div>
      <div>P95: {d.pressureP95.toFixed(1)} cmH₂O</div>
    </div>
  );
}

export default PressureChart;
