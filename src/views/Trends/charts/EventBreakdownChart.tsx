/**
 * Event Breakdown Chart — stacked area of event types per night (Canvas2D).
 *
 * Migrated from Recharts/SVG with pixel-faithful reproduction of all marks:
 * five monotone stacked areas (obstructive → central → hypopnea → mixed → rera,
 * bottom→top), where the central and RERA "modeled" series are filled with a 45°
 * diagonal HATCH (the non-colour reliability cue) instead of a flat fill, a
 * bottom legend, the synced crosshair, and settings-change markers.
 *
 * Two uncertainty treatments remain INDEPENDENT (consensus D5/D6):
 *
 * 1. Central-vs-obstructive split and RERA are LOW-reliability modelled
 *    inferences → hatched fill + a "modeled inference" caveat footnote (lowers
 *    the PRECISION claim only).
 *
 * 2. A rising central (Clear-Airway) trend STILL surfaces a persistent, visible
 *    **"discuss with your clinician" prompt** rendered OUTSIDE the plot as
 *    full-opacity HTML with `role="status"` — the low-reliability caveat must
 *    never silence, hide, or dim it (D6). This stays HTML over the canvas.
 *
 * @module views/Trends/charts/EventBreakdownChart
 */

import React, { useCallback, useMemo } from 'react';
import { useChartColors } from '@/components/charts/useChartColors';
import { useSyncedChart } from '../context/SyncedChartContext';
import { detectRisingCentralTrend } from '../utils/centralTrend';
import type { NightlyAggregate } from '@/types';
import type { SettingsChange } from '../utils/detectSettingsChanges';
import ChartPanel from './ChartPanel';
import styles from './EventBreakdownChart.module.css';
import TrendsCanvasChart, { type DrawContext, type ChartMargins } from './canvas/TrendsCanvasChart';
import type { CurvePoint } from './canvas/curve';
import { monotonePath } from './canvas/curve';
import { niceYTicks } from './canvas/scale';
import { SettingsMarkerOverlay } from './SettingsChangeMarkers';

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

/** A stacked series in render order (bottom→top), with its visual treatment. */
interface SeriesSpec {
  key: keyof Omit<EventDataPoint, 'date'>;
  name: string;
  colorKey: 'chart1' | 'chart2' | 'chart4' | 'chart5' | 'chart6';
  hatch: boolean;
}

const SERIES: readonly SeriesSpec[] = [
  { key: 'obstructive', name: 'Obstructive', colorKey: 'chart2', hatch: false },
  { key: 'central', name: 'Central (modeled)', colorKey: 'chart4', hatch: true },
  { key: 'hypopnea', name: 'Hypopnea', colorKey: 'chart1', hatch: false },
  { key: 'mixed', name: 'Mixed', colorKey: 'chart5', hatch: false },
  { key: 'rera', name: 'RERA (modeled)', colorKey: 'chart6', hatch: true },
];

/** Legend reserves 24px at the bottom (Recharts `<Legend height={24}>`). */
const MARGINS: ChartMargins = { top: 8, right: 48, bottom: 24, left: 0 };

const EventBreakdownChart = React.memo(function EventBreakdownChart({
  data,
  height,
  settingsChanges,
  onDataPointClick,
}: EventBreakdownChartProps) {
  const colors = useChartColors();
  const { activeDate, activeIndex } = useSyncedChart();

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

  const centralTrend = useMemo(() => detectRisingCentralTrend(data), [data]);

  // Y domain: stacked total per night, niced like a Recharts auto numeric axis.
  const domain = useMemo(() => {
    let max = 0;
    for (const d of eventData) {
      max = Math.max(max, d.obstructive + d.central + d.hypopnea + d.mixed + d.rera);
    }
    if (max <= 0) return { min: 0, max: 1 };
    const ticks = niceYTicks(0, max, 5);
    const tMax = ticks.length > 0 ? Math.max(max, ticks[ticks.length - 1] as number) : max;
    return { min: 0, max: tMax };
  }, [eventData]);

  const dateAtIndex = useCallback((i: number) => eventData[i]?.date, [eventData]);

  const drawBase = useCallback(
    ({ renderer, plot, count, fontFamily }: DrawContext) => {
      renderer.beginBase(colors.surfacePrimary);
      const ticks = renderer.drawHorizontalGrid(domain, plot, colors.grid);

      const n = eventData.length;
      const xs = eventData.map((_, i) => renderer.pointX(i, count, plot));
      // Cumulative lower boundary per category (starts at 0 = baseline).
      const lower = new Array<number>(n).fill(0);

      for (const spec of SERIES) {
        const color = colors[spec.colorKey];
        const upperVals = eventData.map((d, i) => (lower[i] ?? 0) + d[spec.key]);
        const upperPts: CurvePoint[] = upperVals.map((v, i) => ({
          x: xs[i] as number,
          y: renderer.valueY(v, domain, plot),
        }));
        const lowerPts: CurvePoint[] = lower.map((v, i) => ({
          x: xs[i] as number,
          y: renderer.valueY(v, domain, plot),
        }));

        if (spec.hatch) {
          // Hatched "modeled" series: clip to the band and paint the 45° pattern
          // (translucent base rect @0.25 + diagonal strokes, 6px pitch, 1.5px),
          // reproducing the SVG <pattern>.
          renderer.fillHatchedRegion(
            (ctx) => buildBandPath(ctx, upperPts, lowerPts),
            plot,
            { color, opacity: 0.25 },
            { color, width: 1.5, period: 6 },
          );
        } else {
          renderer.drawStackedBand(upperPts, lowerPts, { color, opacity: 0.6 }, plot);
        }
        // Stroke the series' top boundary in its colour (Recharts area stroke).
        renderer.drawMonotoneLine(upperPts, { color, width: 1 }, plot, false);

        for (let i = 0; i < n; i++) lower[i] = upperVals[i] ?? 0;
      }

      renderer.drawYAxisRight(domain, plot, colors.axis, fontFamily, ticks);
    },
    [colors, domain, eventData],
  );

  const drawOverlay = useCallback(
    ({ renderer, plot, count }: DrawContext, idx: number | null) => {
      if (idx === null || idx < 0 || idx >= eventData.length) return;
      const x = renderer.pointX(idx, count, plot);
      renderer.drawVerticalReferenceLine(x, plot, { color: colors.axis, opacity: 0.4 });
    },
    [colors, eventData],
  );

  // Screen-reader table depends ONLY on the per-night rows, never on the active
  // hover index — memoise it so a hover-driven re-render does not reconcile the
  // night <tr>s. Markup is identical to the inline form. Declared BEFORE the
  // empty-data early return to keep hook order unconditional.
  const srSummary = useMemo(
    () => (
      <table>
        <caption>
          Event counts per night by type. Central and RERA are modeled estimates, not direct
          measurements.
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Obstructive</th>
            <th scope="col">Central</th>
            <th scope="col">Hypopnea</th>
            <th scope="col">Mixed</th>
            <th scope="col">RERA</th>
          </tr>
        </thead>
        <tbody>
          {eventData.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.obstructive}</td>
              <td>{d.central}</td>
              <td>{d.hypopnea}</td>
              <td>{d.mixed}</td>
              <td>{d.rera}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
    [eventData],
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
      srSummary={srSummary}
    >
      {/* SAFETY-CRITICAL clinician prompt (consensus D6) — full-opacity HTML,
          role="status", informational/non-diagnostic. Never dimmed or hidden. */}
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

      <div style={{ position: 'relative', width: '100%', height }}>
        <TrendsCanvasChart
          count={eventData.length}
          dataKey={eventData}
          height={height}
          margins={MARGINS}
          drawBase={drawBase}
          drawOverlay={drawOverlay}
          dateAtIndex={dateAtIndex}
          onDataPointClick={onDataPointClick}
          ariaLabel="Event breakdown chart"
        />
        <SettingsMarkerOverlay
          changes={settingsChanges}
          data={eventData}
          margins={MARGINS}
          stroke={colors.axis}
        />
        {/* Bottom legend (replaces Recharts <Legend>). */}
        <ul className={styles.legend} aria-hidden="true">
          {SERIES.map((s) => (
            <li key={s.key} className={styles.legendItem}>
              <span
                className={styles.legendSwatch}
                style={{ background: colors[s.colorKey] }}
                data-hatch={s.hatch ? 'true' : 'false'}
              />
              {s.name}
            </li>
          ))}
        </ul>
        {activeDate && activeIndex !== null && eventData[activeIndex] && (
          <EventTooltip
            d={eventData[activeIndex]}
            index={activeIndex}
            count={eventData.length}
            margins={MARGINS}
            colors={colors}
          />
        )}
      </div>
    </ChartPanel>
  );
});

/** Build a closed monotone band path (upper L→R, lower R→L) for hatch clipping. */
function buildBandPath(
  ctx: CanvasRenderingContext2D,
  upper: readonly CurvePoint[],
  lower: readonly CurvePoint[],
): void {
  monotonePath(ctx, upper, false);
  const loRev = [...lower].reverse();
  const first = loRev[0];
  if (first) ctx.lineTo(first.x, first.y);
  // Append the reversed lower boundary as straight-segment monotone.
  monotonePath(
    {
      moveTo: () => {},
      lineTo: (x: number, y: number) => ctx.lineTo(x, y),
      bezierCurveTo: (a, b, c, d, e, f) => ctx.bezierCurveTo(a, b, c, d, e, f),
    },
    loRev,
    false,
  );
  ctx.closePath();
}

function EventTooltip({
  d,
  index,
  count,
  margins,
  colors,
}: {
  d: EventDataPoint;
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
      <div>Obstructive: {d.obstructive}</div>
      <div>Central: {d.central}</div>
      <div>Hypopnea: {d.hypopnea}</div>
      <div>Mixed: {d.mixed}</div>
      <div>RERA: {d.rera}</div>
    </div>
  );
}

export default EventBreakdownChart;
