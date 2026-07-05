/**
 * Signal small-multiples — eight compact stat cells in one panel.
 *
 * Each cell shows a mono label, the window value, a trend delta, a sparkline, and
 * a unit. Values and canonical trends come from {@link SummaryStats}; the central
 * / leak-P95 / wearable deltas use the display-only {@link seriesTrendPercent}
 * (which reuses the canonical null-skipping mean). Colours resolve from theme
 * tokens via {@link useChartColors}.
 *
 * Wearable cells (Rest HR, HRV) render `—` when no wearable data is present —
 * never `0` — and their sparkline collapses to an empty box.
 *
 * @module views/Dashboard/signalDeck/SmallMultiples
 */

import { useChartColors } from '@/components/charts/useChartColors';
import { classifyAhiSeverity } from '@/analysis/clinical';
import type { SummaryStats } from '@/hooks/useSummaryStats';
import type { NightlyAggregate } from '@/types';

import Sparkline from './Sparkline';
import { seriesMean } from './metrics';
import { seriesTrendPercent } from './seriesTrend';
import { severityColor, useSeverityColors } from './severityTokens';
import styles from './SmallMultiples.module.css';

type Favorability = 'lowerIsBetter' | 'higherIsBetter' | 'neutral';

export interface SmallMultiplesProps {
  /** Nightly aggregates for the window, sorted oldest → newest. */
  readonly aggregates: readonly NightlyAggregate[];
  /** Window summary statistics. */
  readonly stats: SummaryStats;
  /** Per-night resting-HR series aligned to `aggregates` (`null` = no sample). */
  readonly hrSeries: readonly (number | null)[];
  /** Per-night HRV rmssd series aligned to `aggregates`. */
  readonly hrvSeries: readonly (number | null)[];
  /** Whether any wearable data exists (gates the HR/HRV cells). */
  readonly wearableAvailable: boolean;
}

interface Cell {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly series: readonly (number | null)[];
  readonly color: string;
  readonly delta: number | null;
  readonly favorability: Favorability;
}

function fmt(value: number | null, digits = 1): string {
  return value === null ? '—' : value.toFixed(digits);
}

function fmtInt(value: number | null): string {
  return value === null ? '—' : String(Math.round(value));
}

export function SmallMultiples({
  aggregates,
  stats,
  hrSeries,
  hrvSeries,
  wearableAvailable,
}: SmallMultiplesProps): JSX.Element {
  const colors = useChartColors();
  const severityColors = useSeverityColors();

  const ahiSeries = aggregates.map((a) => a.ahi);
  const centralSeries = aggregates.map((a) => a.ahiCentral);
  const leakSeries = aggregates.map((a) => a.leakMedian);
  const leakP95Series = aggregates.map((a) => a.leakP95);
  const usageSeries = aggregates.map((a) => a.usageHours);
  const pressureSeries = aggregates.map((a) => a.pressureP95);

  const meanCentral = seriesMean(centralSeries);
  const meanHr = wearableAvailable ? seriesMean(hrSeries) : null;
  const meanHrv = wearableAvailable ? seriesMean(hrvSeries) : null;
  const ahiSeverityColor = severityColor(severityColors, classifyAhiSeverity(stats.meanAHI));

  const cells: Cell[] = [
    {
      key: 'ahi',
      label: 'AHI',
      value: fmt(stats.meanAHI),
      unit: 'ev/hr',
      series: ahiSeries,
      color: ahiSeverityColor,
      delta: stats.trendAHIPercent,
      favorability: 'lowerIsBetter',
    },
    {
      key: 'central',
      label: 'Central',
      value: fmt(meanCentral, 2),
      unit: '/hr',
      series: centralSeries,
      color: colors.detection,
      delta: seriesTrendPercent(centralSeries),
      favorability: 'lowerIsBetter',
    },
    {
      key: 'leak',
      label: 'Leak',
      value: fmt(stats.meanLeak),
      unit: 'L/min',
      series: leakSeries,
      color: colors.chart5,
      delta: stats.trendLeakPercent,
      favorability: 'lowerIsBetter',
    },
    {
      key: 'leakP95',
      label: 'Leak P95',
      value: fmt(stats.leakP95),
      unit: 'L/min',
      series: leakP95Series,
      color: colors.chart5,
      delta: seriesTrendPercent(leakP95Series),
      favorability: 'lowerIsBetter',
    },
    {
      key: 'usage',
      label: 'Usage',
      value: fmt(stats.meanUsageHours),
      unit: 'h',
      series: usageSeries,
      color: colors.chart1,
      delta: stats.trendUsagePercent,
      favorability: 'higherIsBetter',
    },
    {
      key: 'pressure',
      label: 'Pressure',
      value: fmt(stats.meanPressureP95),
      unit: 'cmH₂O',
      series: pressureSeries,
      color: colors.chart4,
      delta: stats.trendPressureP95Percent,
      favorability: 'neutral',
    },
    {
      key: 'hr',
      label: 'Rest HR',
      value: fmtInt(meanHr),
      unit: 'bpm',
      series: hrSeries,
      color: colors.wearableHr,
      delta: wearableAvailable ? seriesTrendPercent(hrSeries) : null,
      favorability: 'lowerIsBetter',
    },
    {
      key: 'hrv',
      label: 'HRV',
      value: fmtInt(meanHrv),
      unit: 'ms',
      series: hrvSeries,
      color: colors.wearableHrv,
      delta: wearableAvailable ? seriesTrendPercent(hrvSeries) : null,
      favorability: 'higherIsBetter',
    },
  ];

  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>Signal small-multiples</h2>
      <div className={styles.grid}>
        {cells.map((cell) => (
          <div key={cell.key} className={styles.cell}>
            <div className={styles.label}>{cell.label}</div>
            <div className={styles.valueRow}>
              <span className={styles.value}>{cell.value}</span>
              {renderDelta(cell.delta, cell.favorability)}
            </div>
            <div className={styles.spark}>
              <Sparkline values={cell.series} color={cell.color} width={120} height={28} fill />
            </div>
            <div className={styles.unit}>{cell.unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Render the signed delta with an arrow glyph and a tone class. */
function renderDelta(delta: number | null, favorability: Favorability): JSX.Element | null {
  if (delta === null) return null;
  const rounded = Math.round(delta);
  const arrow = delta > 0.5 ? '↑' : delta < -0.5 ? '↓' : '→';
  const sign = rounded > 0 ? '+' : '';

  let tone = styles.deltaNeutral;
  if (Math.abs(delta) >= 2 && favorability !== 'neutral') {
    const good = favorability === 'lowerIsBetter' ? delta <= 0 : delta >= 0;
    tone = good ? styles.deltaGood : styles.deltaBad;
  }

  return (
    <span className={`${styles.delta} ${tone ?? ''}`}>
      <span aria-hidden="true">{arrow}</span>
      {sign}
      {rounded}%
    </span>
  );
}

export default SmallMultiples;
