/**
 * Machine Settings Chart — step chart for pressure config and EPR level
 * (Canvas2D).
 *
 * Migrated from Recharts/SVG. Shows configuredMinPressure and
 * configuredMaxPressure as `stepAfter` lines on a pressure Y axis (oriented
 * RIGHT, matching the original) and the EPR level on a secondary Y axis fixed to
 * [0, 3] (oriented LEFT). The EPR line is dashed (4 2); the pressure lines are
 * solid. The empty-state panel is preserved when no settings data exists.
 *
 * @module views/Trends/charts/SettingsChart
 */

import React, { useCallback, useMemo } from 'react';
import { useChartColors } from '@/components/charts/useChartColors';
import { useSyncedChart } from '../context/SyncedChartContext';
import type { NightlyAggregate } from '@/types';
import ChartPanel from './ChartPanel';
import TrendsCanvasChart, { type DrawContext, type ChartMargins } from './canvas/TrendsCanvasChart';
import type { CurvePoint } from './canvas/curve';
import { niceYTicks } from './canvas/scale';

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

/** Pressure axis right (`width={40}`), EPR axis left (`width={30}`). */
const MARGINS: ChartMargins = { top: 8, right: 48, bottom: 0, left: 30 };

const SettingsChart = React.memo(function SettingsChart({ data, height }: SettingsChartProps) {
  const colors = useChartColors();
  const { activeDate, activeIndex } = useSyncedChart();

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

  // Pressure Y domain (auto from data, niced like a Recharts numeric axis).
  const pressureDomain = useMemo(() => {
    const vals: number[] = [];
    for (const d of settingsData) {
      if (d.minPressure !== null) vals.push(d.minPressure);
      if (d.maxPressure !== null) vals.push(d.maxPressure);
    }
    if (vals.length === 0) return { min: 0, max: 1 };
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    if (lo === hi) return { min: lo - 1, max: hi + 1 };
    const ticks = niceYTicks(lo, hi, 5);
    const tMin = ticks.length > 0 ? Math.min(lo, ticks[0] as number) : lo;
    const tMax = ticks.length > 0 ? Math.max(hi, ticks[ticks.length - 1] as number) : hi;
    return { min: tMin, max: tMax };
  }, [settingsData]);

  const eprDomain = useMemo(() => ({ min: 0, max: 3 }), []);
  const dateAtIndex = useCallback((i: number) => settingsData[i]?.date, [settingsData]);

  const drawBase = useCallback(
    ({ renderer, plot, count, fontFamily }: DrawContext) => {
      renderer.beginBase(colors.surfacePrimary);
      const ticks = renderer.drawHorizontalGrid(pressureDomain, plot, colors.grid);

      const xs = settingsData.map((_, i) => renderer.pointX(i, count, plot));

      const maxPts: CurvePoint[] = settingsData.map((d, i) =>
        d.maxPressure === null
          ? null
          : { x: xs[i] as number, y: renderer.valueY(d.maxPressure, pressureDomain, plot) },
      );
      const minPts: CurvePoint[] = settingsData.map((d, i) =>
        d.minPressure === null
          ? null
          : { x: xs[i] as number, y: renderer.valueY(d.minPressure, pressureDomain, plot) },
      );
      const eprPts: CurvePoint[] = settingsData.map((d, i) =>
        d.eprLevel === null
          ? null
          : { x: xs[i] as number, y: renderer.valueY(d.eprLevel, eprDomain, plot) },
      );

      renderer.drawStepAfterLine(maxPts, { color: colors.chart2, width: 1.5 }, plot, true);
      renderer.drawStepAfterLine(minPts, { color: colors.chart3, width: 1.5 }, plot, true);
      renderer.drawStepAfterLine(
        eprPts,
        { color: colors.chart5, width: 1.5, dash: [4, 2] },
        plot,
        true,
      );

      // Pressure axis on the RIGHT; EPR axis on the LEFT.
      renderer.drawYAxisRight(pressureDomain, plot, colors.axis, fontFamily, ticks);
      renderer.drawYAxisLeft(eprDomain, plot, colors.axis, fontFamily, [0, 1, 2, 3]);
    },
    [colors, pressureDomain, eprDomain, settingsData],
  );

  const drawOverlay = useCallback(
    ({ renderer, plot, count }: DrawContext, idx: number | null) => {
      if (idx === null || idx < 0 || idx >= settingsData.length) return;
      const x = renderer.pointX(idx, count, plot);
      renderer.drawVerticalReferenceLine(x, plot, { color: colors.axis, opacity: 0.4 });
    },
    [colors, settingsData],
  );

  // Screen-reader table depends ONLY on the per-night rows, never on the active
  // hover index — memoise it so a hover-driven re-render does not reconcile the
  // night <tr>s. Markup is identical to the inline form (the local `fmt` helper
  // is inlined into the memo so it has no per-render closure dependency). Declared
  // BEFORE the empty-state early return to keep hook order unconditional.
  const srSummary = useMemo(() => {
    const fmt = (n: number | null): string =>
      typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—';
    return (
      <table>
        <caption>
          Configured machine settings over time: min/max pressure (cmH₂O) and EPR level.
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Min pressure</th>
            <th scope="col">Max pressure</th>
            <th scope="col">EPR</th>
          </tr>
        </thead>
        <tbody>
          {settingsData.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{fmt(d.minPressure)}</td>
              <td>{fmt(d.maxPressure)}</td>
              <td>{fmt(d.eprLevel)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }, [settingsData]);

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
      srSummary={srSummary}
    >
      <div style={{ position: 'relative', width: '100%', height }}>
        <TrendsCanvasChart
          count={settingsData.length}
          dataKey={settingsData}
          height={height}
          margins={MARGINS}
          drawBase={drawBase}
          drawOverlay={drawOverlay}
          dateAtIndex={dateAtIndex}
          ariaLabel="Machine settings chart"
        />
        {activeDate && activeIndex !== null && settingsData[activeIndex] && (
          <SettingsTooltip
            d={settingsData[activeIndex]}
            index={activeIndex}
            count={settingsData.length}
            margins={MARGINS}
            colors={colors}
          />
        )}
      </div>
    </ChartPanel>
  );
});

function SettingsTooltip({
  d,
  index,
  count,
  margins,
  colors,
}: {
  d: SettingsDataPoint;
  index: number;
  count: number;
  margins: ChartMargins;
  colors: ReturnType<typeof useChartColors>;
}) {
  const leftPct = count <= 1 ? 50 : (index / (count - 1)) * 100;
  const fmt = (n: number | null): string =>
    typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—';
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
      <div>Max pressure: {fmt(d.maxPressure)}</div>
      <div>Min pressure: {fmt(d.minPressure)}</div>
      <div>EPR: {fmt(d.eprLevel)}</div>
    </div>
  );
}

export default SettingsChart;
