/**
 * Usage Hours Chart — bar chart with CMS compliance and target reference lines
 * (Canvas2D).
 *
 * Migrated from Recharts/SVG. Visuals reproduced exactly: per-night bars on a
 * `scaleBand` axis (default `barCategoryGap='10%'` → 0.1·band inset, floor(0.8·
 * band) width), each coloured green/yellow/red by usage via {@link getBarColor},
 * rounded TOP corners (radius [2,2,0,0]), two dashed reference lines (CMS 4h and
 * recommended 6h) with right-anchored labels, settings-change markers, and the
 * synced crosshair. Bars are drawn in Canvas2D (not WebGL).
 *
 * @module views/Trends/charts/UsageChart
 */

import React, { useCallback, useMemo } from 'react';
import { useChartColors } from '@/components/charts/useChartColors';
import { CMS_COMPLIANCE_HOURS, RECOMMENDED_USAGE_HOURS } from '@/analysis/clinical';
import { USAGE_AXIS_FLOOR, computeAxisMax } from './chartScale';
import { useSyncedChart } from '../context/SyncedChartContext';
import type { NightlyAggregate } from '@/types';
import type { SettingsChange } from '../utils/detectSettingsChanges';
import ChartPanel from './ChartPanel';
import TrendsCanvasChart, { type DrawContext, type ChartMargins } from './canvas/TrendsCanvasChart';
import { singleBarGeometry, bandCenter } from './canvas/scale';
import { SettingsMarkerOverlay } from './SettingsChangeMarkers';

interface UsageChartProps {
  data: NightlyAggregate[];
  height: number;
  settingsChanges: SettingsChange[];
  hideXAxis?: boolean;
  onDataPointClick?: (date: string) => void;
}

const MARGINS: ChartMargins = { top: 8, right: 48, bottom: 0, left: 0 };

function getBarColor(hours: number, colors: { chart3: string; chart5: string; chart2: string }) {
  if (hours >= RECOMMENDED_USAGE_HOURS) return colors.chart3; // green
  if (hours >= CMS_COMPLIANCE_HOURS) return colors.chart5; // orange/yellow
  return colors.chart2; // red
}

const UsageChart = React.memo(function UsageChart({
  data,
  height,
  settingsChanges,
  onDataPointClick,
}: UsageChartProps) {
  const colors = useChartColors();
  const { activeDate, activeIndex } = useSyncedChart();

  const maxUsage = useMemo(() => {
    const m = Math.max(...data.map((d) => d.usageHours), 0);
    return computeAxisMax(m, USAGE_AXIS_FLOOR);
  }, [data]);

  const domain = useMemo(() => ({ min: 0, max: maxUsage }), [maxUsage]);
  const dateAtIndex = useCallback((i: number) => data[i]?.date, [data]);

  const drawBase = useCallback(
    ({ renderer, plot, count, fontFamily }: DrawContext) => {
      renderer.beginBase(colors.surfacePrimary);
      const ticks = renderer.drawHorizontalGrid(domain, plot, colors.grid);

      const baseY = renderer.valueY(0, domain, plot);

      // Reference lines BEHIND the bars (Recharts draws ReferenceLine before Bar
      // in this chart's child order).
      renderer.drawHorizontalReferenceLine(
        CMS_COMPLIANCE_HOURS,
        domain,
        plot,
        { color: colors.chart5, dash: [6, 3] },
        { text: `${CMS_COMPLIANCE_HOURS}h`, color: colors.axis, fontFamily },
      );
      renderer.drawHorizontalReferenceLine(
        RECOMMENDED_USAGE_HOURS,
        domain,
        plot,
        { color: colors.chart3, dash: [6, 3] },
        { text: `${RECOMMENDED_USAGE_HOURS}h`, color: colors.axis, fontFamily },
      );

      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        if (!d) continue;
        const geo = singleBarGeometry(i, count, plot.left, plot.width);
        const topY = renderer.valueY(d.usageHours, domain, plot);
        renderer.drawBar(geo.x, geo.width, topY, baseY, getBarColor(d.usageHours, colors), 2, plot);
      }

      renderer.drawYAxisRight(domain, plot, colors.axis, fontFamily, ticks);
    },
    [colors, domain, data],
  );

  const drawOverlay = useCallback(
    ({ renderer, plot, count }: DrawContext, idx: number | null) => {
      if (idx === null || idx < 0 || idx >= data.length) return;
      // Bar-chart crosshair sits at the band centre (Recharts band cursor).
      const x = bandCenter(idx, count, plot.left, plot.width);
      renderer.drawVerticalReferenceLine(x, plot, { color: colors.axis, opacity: 0.4 });
    },
    [colors, data],
  );

  if (data.length === 0) return null;

  const srSummary = (
    <table>
      <caption>Nightly usage hours, colour-coded by compliance.</caption>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Usage hours</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.date}>
            <td>{d.date}</td>
            <td>{d.usageHours.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartPanel
      title="Usage Hours"
      chartHeight={height}
      accessibleSummary="Usage hours bar chart with CMS compliance and target lines"
      srSummary={srSummary}
    >
      <div style={{ position: 'relative', width: '100%', height }}>
        <TrendsCanvasChart
          count={data.length}
          dataKey={data}
          height={height}
          margins={MARGINS}
          isBand
          drawBase={drawBase}
          drawOverlay={drawOverlay}
          dateAtIndex={dateAtIndex}
          onDataPointClick={onDataPointClick}
          ariaLabel="Usage hours chart"
        />
        <SettingsMarkerOverlay
          changes={settingsChanges}
          data={data}
          margins={MARGINS}
          stroke={colors.axis}
          isBand
        />
        {activeDate && activeIndex !== null && data[activeIndex] && (
          <UsageTooltip
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

function UsageTooltip({
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
  // Band-centre fraction: (i + 0.5) / count.
  const frac = (index + 0.5) / count;
  return (
    <div
      style={{
        position: 'absolute',
        top: margins.top,
        left: `calc(${margins.left}px + (100% - ${margins.left + margins.right}px) * ${frac})`,
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
      <div>Usage: {d.usageHours.toFixed(1)} hrs</div>
    </div>
  );
}

export default UsageChart;
