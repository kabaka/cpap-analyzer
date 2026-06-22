/**
 * AHI Trend Chart — rolling-median trend with a "typical nightly range" band
 * (Canvas2D).
 *
 * Per consensus D3 the headline is the *trend*, not last night: a rolling
 * **median** centre line over {@link AHI_BAND_WINDOW_NIGHTS} nights with a shaded
 * **P25–P75 inter-quartile band** ("typical nightly range"). The band is
 * explicitly NOT a "95% confidence interval" — it is the empirical spread of
 * recent nights. The raw per-night AHI is demoted to a faint secondary line.
 *
 * Migrated from Recharts/SVG to Canvas2D with pixel-faithful reproduction of all
 * marks: four severity reference zones (exact fill opacities), the floating
 * [P25,P75] band (dashed 4 3 edge, fill 0.18), the faint raw-AHI line
 * (opacity 0.3, null nights → GAP, never 0), the bold rolling-median line
 * (2.25px, connectNulls), a right-oriented Y axis on [0, maxAHI], the synced
 * crosshair, settings-change markers, and the median-led tooltip.
 *
 * THE ONE APPROVED HONESTY CHANGE: when there are MORE nights than horizontal
 * pixel columns, the faint raw-AHI line is replaced by a per-pixel-column MIN/MAX
 * envelope (see {@link module:views/Trends/charts/canvas/envelope}) so a spike
 * night cannot be visually swallowed by a polyline that has to share a pixel
 * column with calmer neighbours. Null nights remain gaps. This affects ONLY the
 * faint raw series — never the band, median, or zones.
 *
 * @module views/Trends/charts/AHITrendChart
 */

import React, { useCallback, useMemo } from 'react';
import { useChartColors } from '@/components/charts/useChartColors';
import { AHI_BAND_WINDOW_NIGHTS, buildRollingBandSeries } from '@/components/charts/uncertainty';
import { AHI_SEVERITY_THRESHOLDS } from '@/analysis/clinical';
import { AHI_AXIS_FLOOR, computeAxisMax } from './chartScale';
import { useSyncedChart } from '../context/SyncedChartContext';
import type { NightlyAggregate } from '@/types';
import type { SettingsChange } from '../utils/detectSettingsChanges';
import ChartPanel from './ChartPanel';
import TrendsCanvasChart, { type DrawContext, type ChartMargins } from './canvas/TrendsCanvasChart';
import type { CurvePoint } from './canvas/curve';
import { SettingsMarkerOverlay } from './SettingsChangeMarkers';
import { buildAhiRawEnvelope, shouldEnvelopeAhiRaw } from './canvas/envelope';

interface AHITrendChartProps {
  data: NightlyAggregate[];
  height: number;
  settingsChanges: SettingsChange[];
  hideXAxis?: boolean;
  onDataPointClick?: (date: string) => void;
}

interface AHIChartPoint {
  date: string;
  ahi: number | null;
  ahiMedian: number | null;
  ahiBand: [number, number] | null;
}

const MARGINS: ChartMargins = { top: 8, right: 48, bottom: 0, left: 0 };

function fmt(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—';
}

const AHITrendChart = React.memo(function AHITrendChart({
  data,
  height,
  settingsChanges,
  onDataPointClick,
}: AHITrendChartProps) {
  const colors = useChartColors();
  const { activeDate, activeIndex } = useSyncedChart();

  const chartData: AHIChartPoint[] = useMemo(() => {
    const band = buildRollingBandSeries(data, (d) => d.ahi ?? NaN, AHI_BAND_WINDOW_NIGHTS);
    return data.map((d, i) => {
      const b = band[i];
      return {
        date: d.date,
        ahi: d.ahi,
        ahiMedian: b?.median ?? null,
        ahiBand: b?.band ? [b.band[0], b.band[1]] : null,
      };
    });
  }, [data]);

  const maxAHI = useMemo(() => {
    let m = 0;
    for (const d of chartData) {
      m = Math.max(m, d.ahi ?? 0, d.ahiBand?.[1] ?? 0);
    }
    return computeAxisMax(m, AHI_AXIS_FLOOR);
  }, [chartData]);

  const domain = useMemo(() => ({ min: 0, max: maxAHI }), [maxAHI]);
  const dateAtIndex = useCallback((i: number) => chartData[i]?.date, [chartData]);

  const drawBase = useCallback(
    ({ renderer, plot, count, fontFamily }: DrawContext) => {
      renderer.beginBase(colors.surfacePrimary);

      // Severity zones (drawn first, behind everything). Exact fill opacities.
      renderer.drawReferenceZone(
        0,
        AHI_SEVERITY_THRESHOLDS.mild,
        domain,
        plot,
        colors.chart3,
        0.06,
      );
      renderer.drawReferenceZone(
        AHI_SEVERITY_THRESHOLDS.mild,
        AHI_SEVERITY_THRESHOLDS.moderate,
        domain,
        plot,
        colors.chart5,
        0.06,
      );
      renderer.drawReferenceZone(
        AHI_SEVERITY_THRESHOLDS.moderate,
        AHI_SEVERITY_THRESHOLDS.severe,
        domain,
        plot,
        colors.chart5,
        0.12,
      );
      renderer.drawReferenceZone(
        AHI_SEVERITY_THRESHOLDS.severe,
        maxAHI,
        domain,
        plot,
        colors.chart2,
        0.08,
      );

      const ticks = renderer.drawHorizontalGrid(domain, plot, colors.grid);

      // Floating [P25, P75] band: dashed edge (4 3), fill 0.18.
      const lower: CurvePoint[] = chartData.map((d, i) =>
        d.ahiBand
          ? { x: renderer.pointX(i, count, plot), y: renderer.valueY(d.ahiBand[0], domain, plot) }
          : null,
      );
      const upper: CurvePoint[] = chartData.map((d, i) =>
        d.ahiBand
          ? { x: renderer.pointX(i, count, plot), y: renderer.valueY(d.ahiBand[1], domain, plot) }
          : null,
      );
      renderer.drawBandBetween(
        lower,
        upper,
        { color: colors.uncertaintyBand, opacity: 0.18 },
        plot,
        { color: colors.uncertaintyBandEdge, width: 1, dash: [4, 3] },
      );

      // Faint raw per-night AHI line (opacity 0.3, null → gap). When nights
      // over-subscribe the pixel columns, draw the honesty envelope instead.
      const columns = Math.max(1, Math.floor(plot.width));
      if (shouldEnvelopeAhiRaw(chartData.length, columns)) {
        const env = buildAhiRawEnvelope(
          chartData.map((d) => d.ahi),
          columns,
        );
        renderer.drawColumnEnvelope(
          env,
          domain,
          { color: colors.chart1, width: 1, opacity: 0.3 },
          plot,
        );
      } else {
        const raw: CurvePoint[] = chartData.map((d, i) =>
          d.ahi === null
            ? null
            : { x: renderer.pointX(i, count, plot), y: renderer.valueY(d.ahi, domain, plot) },
        );
        renderer.drawMonotoneLine(
          raw,
          { color: colors.chart1, width: 1, opacity: 0.3 },
          plot,
          false,
        );
      }

      // Bold rolling-median centre line (2.25px, connectNulls).
      const median: CurvePoint[] = chartData.map((d, i) =>
        d.ahiMedian === null
          ? null
          : { x: renderer.pointX(i, count, plot), y: renderer.valueY(d.ahiMedian, domain, plot) },
      );
      renderer.drawMonotoneLine(median, { color: colors.chart1, width: 2.25 }, plot, true);

      renderer.drawYAxisRight(domain, plot, colors.axis, fontFamily, ticks);
    },
    [colors, domain, chartData, maxAHI],
  );

  const drawOverlay = useCallback(
    ({ renderer, plot, count }: DrawContext, idx: number | null) => {
      if (idx === null || idx < 0 || idx >= chartData.length) return;
      const x = renderer.pointX(idx, count, plot);
      renderer.drawVerticalReferenceLine(x, plot, { color: colors.axis, opacity: 0.4 });
      const d = chartData[idx];
      if (d) {
        if (d.ahiMedian !== null) {
          renderer.drawActiveDot(x, renderer.valueY(d.ahiMedian, domain, plot), 5, colors.chart1);
        }
        if (d.ahi !== null) {
          renderer.drawActiveDot(x, renderer.valueY(d.ahi, domain, plot), 3, colors.chart1);
        }
      }
    },
    [colors, domain, chartData],
  );

  if (data.length === 0) return null;

  const footnote = (
    <>
      {`Line = rolling median AHI over a ${AHI_BAND_WINDOW_NIGHTS}-night window. Shaded band = typical nightly range (25th–75th percentile of recent nights), not a 95% confidence interval. Faint line = individual nights. `}
      On dense ranges, where nights outnumber the chart's pixel columns, the faint line shows each
      column's min–max range so a single spike night cannot vanish between pixels; nights with no
      data stay gaps.
    </>
  );

  const srSummary = (
    <table>
      <caption>
        AHI trend: rolling median and typical nightly range (P25–P75) per night. The band is the
        inter-quartile spread of recent nights, not a confidence interval.
      </caption>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Rolling median AHI</th>
          <th scope="col">Typical range lower (P25)</th>
          <th scope="col">Typical range upper (P75)</th>
          <th scope="col">This night AHI</th>
        </tr>
      </thead>
      <tbody>
        {chartData.map((d) => (
          <tr key={d.date}>
            <td>{d.date}</td>
            <td>{fmt(d.ahiMedian)}</td>
            <td>{fmt(d.ahiBand?.[0] ?? null)}</td>
            <td>{fmt(d.ahiBand?.[1] ?? null)}</td>
            <td>{fmt(d.ahi)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const activePoint = activeIndex !== null ? chartData[activeIndex] : undefined;

  return (
    <ChartPanel
      title="AHI"
      chartHeight={height}
      accessibleSummary="AHI trend chart: rolling median line with a typical-nightly-range band (P25–P75) and clinical severity zones"
      footnote={footnote}
      srSummary={srSummary}
    >
      <div style={{ position: 'relative', width: '100%', height }}>
        <TrendsCanvasChart
          count={chartData.length}
          dataKey={chartData}
          height={height}
          margins={MARGINS}
          drawBase={drawBase}
          drawOverlay={drawOverlay}
          dateAtIndex={dateAtIndex}
          onDataPointClick={onDataPointClick}
          ariaLabel="AHI trend chart"
        />
        <SettingsMarkerOverlay
          changes={settingsChanges}
          data={chartData}
          margins={MARGINS}
          stroke={colors.axis}
        />
        {activeDate && activeIndex !== null && activePoint && (
          <AHITooltip
            point={activePoint}
            index={activeIndex}
            count={chartData.length}
            margins={MARGINS}
            colors={colors}
          />
        )}
      </div>
    </ChartPanel>
  );
});

/** Median-led tooltip (never labels the band a "CI"). */
function AHITooltip({
  point,
  index,
  count,
  margins,
  colors,
}: {
  point: AHIChartPoint;
  index: number;
  count: number;
  margins: ChartMargins;
  colors: ReturnType<typeof useChartColors>;
}) {
  const leftPct = count <= 1 ? 50 : (index / (count - 1)) * 100;
  const band = point.ahiBand;
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
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{point.date}</div>
      <div>Rolling median AHI: {fmt(point.ahiMedian)}</div>
      {band && (
        <div>
          Typical nightly range: {fmt(band[0])}–{fmt(band[1])}
        </div>
      )}
      <div style={{ opacity: 0.7 }}>This night: {fmt(point.ahi)}</div>
    </div>
  );
}

export default AHITrendChart;
