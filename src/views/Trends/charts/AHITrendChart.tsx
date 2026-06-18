/**
 * AHI Trend Chart — rolling-median trend with a "typical nightly range" band.
 *
 * Per consensus D3 the headline is the *trend*, not last night: a rolling
 * **median** centre line over {@link AHI_BAND_WINDOW_NIGHTS} nights with a
 * shaded **P25–P75 inter-quartile band** ("typical nightly range"). The band is
 * explicitly NOT a "95% confidence interval" — it is the empirical spread of
 * recent nights, robust to outlier nights and free of the iid/normality
 * assumptions that invalidate `x̄ ± z·s/√n`. The raw per-night AHI is demoted to
 * a faint secondary line so it no longer reads as a precise headline value.
 *
 * The band is computed from per-night aggregates only (never the 25 Hz signal)
 * via the shared, tested `rollingMedianBand` util.
 *
 * @module views/Trends/charts/AHITrendChart
 */

import React, { useCallback, useMemo } from 'react';
import {
  Area,
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
import { AHI_BAND_WINDOW_NIGHTS, buildRollingBandSeries } from '@/components/charts/uncertainty';
import { AHI_SEVERITY_THRESHOLDS } from '@/analysis/clinical';
import { AHI_AXIS_FLOOR, computeAxisMax } from './chartScale';
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

/** Chart record: the nightly fields the chart reads plus the derived band. */
interface AHIChartPoint {
  date: string;
  /**
   * Raw per-night AHI (demoted to a faint secondary series). `null` when the
   * recording was too short for a per-hour rate — rendered as a GAP in the
   * line (never plotted as 0).
   */
  ahi: number | null;
  /** Rolling median (P50) over the trailing window — the headline series. */
  ahiMedian: number | null;
  /** Floating [P25, P75] band tuple for the recharts range `<Area>`. */
  ahiBand: [number, number] | null;
}

interface AHITooltipPayloadEntry {
  payload?: AHIChartPoint;
}

/** recharts passes loosely-typed tooltip props; we read only what we need. */
interface AHITooltipRenderProps {
  active?: boolean;
  label?: string | number;
  payload?: AHITooltipPayloadEntry[];
}

function fmt(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—';
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

  // Derive the rolling-median + P25–P75 band from per-night aggregates only.
  const chartData: AHIChartPoint[] = useMemo(() => {
    // d.ahi is null on nights too short for a per-hour rate. Map null to NaN
    // for the band accessor: rollingMedianBand filters non-finite values per
    // window, so null nights are skipped from the median/IQR (never treated as
    // 0) and an all-null window yields a null band (a gap).
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

  // Custom tooltip: leads with the rolling median + typical nightly range, then
  // the raw night value clearly subordinate. Never labels the band a "CI".
  const renderTooltip = useCallback(
    (props: AHITooltipRenderProps) => {
      const { active, label, payload } = props;
      if (!active || !payload || payload.length === 0) return null;
      const point = payload[0]?.payload;
      if (!point) return null;
      const band = point.ahiBand;
      return (
        <div
          style={{
            background: colors.tooltipBg,
            border: `1px solid ${colors.tooltipBorder}`,
            fontSize: 12,
            padding: '6px 8px',
            borderRadius: 4,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
          <div>Rolling median AHI: {fmt(point.ahiMedian)}</div>
          {band && (
            <div>
              Typical nightly range: {fmt(band[0])}–{fmt(band[1])}
            </div>
          )}
          <div style={{ opacity: 0.7 }}>This night: {fmt(point.ahi)}</div>
        </div>
      );
    },
    [colors.tooltipBg, colors.tooltipBorder],
  );

  if (data.length === 0) return null;

  const footnote = `Line = rolling median AHI over a ${AHI_BAND_WINDOW_NIGHTS}-night window. Shaded band = typical nightly range (25th–75th percentile of recent nights), not a 95% confidence interval. Faint line = individual nights.`;

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

  return (
    <ChartPanel
      title="AHI"
      chartHeight={height}
      accessibleSummary="AHI trend chart: rolling median line with a typical-nightly-range band (P25–P75) and clinical severity zones"
      footnote={footnote}
      srSummary={srSummary}
    >
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={chartData}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={clear}
          onClick={handleClick}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />

          {/* Severity zones — kept, slightly lighter so the band reads on top. */}
          <ReferenceArea
            y1={0}
            y2={AHI_SEVERITY_THRESHOLDS.mild}
            fill={colors.chart3}
            fillOpacity={0.06}
          />
          <ReferenceArea
            y1={AHI_SEVERITY_THRESHOLDS.mild}
            y2={AHI_SEVERITY_THRESHOLDS.moderate}
            fill={colors.chart5}
            fillOpacity={0.06}
          />
          <ReferenceArea
            y1={AHI_SEVERITY_THRESHOLDS.moderate}
            y2={AHI_SEVERITY_THRESHOLDS.severe}
            fill={colors.chart5}
            fillOpacity={0.12}
          />
          <ReferenceArea
            y1={AHI_SEVERITY_THRESHOLDS.severe}
            y2={maxAHI}
            fill={colors.chart2}
            fillOpacity={0.08}
          />

          <XAxis dataKey="date" hide={hideXAxis} />
          <YAxis
            domain={[0, maxAHI]}
            tick={{ fill: colors.axis, fontSize: 11 }}
            stroke={colors.axis}
            width={40}
            orientation="right"
          />

          <Tooltip cursor={{ stroke: colors.axis, strokeOpacity: 0.3 }} content={renderTooltip} />

          {/* Typical-nightly-range band (P25–P75) — neutral/desaturated fill
              with a dashed edge as a non-colour cue (survives grayscale/print).
              Rendered as a recharts floating range Area ([lower, upper]). */}
          <Area
            dataKey="ahiBand"
            name="Typical nightly range (P25–P75)"
            stroke={colors.uncertaintyBandEdge}
            strokeWidth={1}
            strokeDasharray="4 3"
            fill={colors.uncertaintyBand}
            fillOpacity={0.18}
            connectNulls={false}
            isAnimationActive={false}
            activeDot={false}
          />

          {/* Settings change markers — shared helper renders a dashed
              vertical line per change with a native-SVG <title> tooltip. */}
          {renderSettingsChangeMarkers(settingsChanges, { stroke: colors.axis })}

          {/* Synced crosshair */}
          {activeDate && <ReferenceLine x={activeDate} stroke={colors.axis} strokeOpacity={0.4} />}

          {/* Raw per-night AHI — demoted to a faint subordinate line. */}
          <Line
            type="monotone"
            dataKey="ahi"
            name="Individual nights"
            stroke={colors.chart1}
            strokeWidth={1}
            strokeOpacity={0.3}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
            activeDot={{ r: 3, cursor: 'pointer' }}
          />

          {/* Rolling-median centre line — the headline trend. */}
          <Line
            type="monotone"
            dataKey="ahiMedian"
            name="Rolling median AHI"
            stroke={colors.chart1}
            strokeWidth={2.25}
            dot={false}
            connectNulls
            isAnimationActive={false}
            activeDot={{ r: 5, cursor: 'pointer' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
});

export default AHITrendChart;
