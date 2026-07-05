/**
 * Nightly-AHI 12-month calendar (the deck's "spine") plus a monthly-mean strip.
 *
 * The calendar always shows a full trailing 12 months regardless of the deck's
 * 30D/90D window toggle — it is the longitudinal context the rest of the deck
 * zooms into. It reuses the accessible, theme-aware {@link CalendarHeatmap} with
 * the canonical AHI clinical bands.
 *
 * The monthly strip below shows duration-weighted pooled mean AHI per calendar
 * month via {@link monthlyMeanAhi}. Bars are coloured by clinical severity and
 * always carry a numeric value label, so severity is never colour-only. A month
 * that recorded nights but has no defined AHI shows `—` (never `0`).
 *
 * @module views/Dashboard/signalDeck/AhiCalendarPanel
 */

import { CalendarHeatmap } from '@/components/charts';
import { CALENDAR_METRIC_CONFIG } from '@/views/Sessions/calendarBands';
import type { NightlyAggregate } from '@/types';

import { monthlyMeanAhi } from './metrics';
import { severityColor, useSeverityColors } from './severityTokens';
import { useChartColors } from '@/components/charts/useChartColors';
import styles from './AhiCalendarPanel.module.css';

export interface AhiCalendarPanelProps {
  /** Nightly aggregates over a trailing 12-month range. */
  readonly aggregates: readonly NightlyAggregate[];
  /** ISO start of the rendered calendar window (YYYY-MM-DD). */
  readonly rangeStart: string;
  /** ISO end of the rendered calendar window (YYYY-MM-DD). */
  readonly rangeEnd: string;
}

const AHI_CONFIG = CALENDAR_METRIC_CONFIG.ahi;

export function AhiCalendarPanel({
  aggregates,
  rangeStart,
  rangeEnd,
}: AhiCalendarPanelProps): JSX.Element {
  const colors = useChartColors();
  const severityColors = useSeverityColors();
  const heatmapData = aggregates.map((a) => ({ date: a.date, value: a.ahi }));
  const monthly = monthlyMeanAhi(aggregates, 12);
  const maxMean = monthly.reduce(
    (m, p) => (p.meanAhi !== null && p.meanAhi > m ? p.meanAhi : m),
    0,
  );

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Nightly AHI · 12-month calendar</h2>
      </div>

      <CalendarHeatmap
        data={heatmapData}
        bands={[...AHI_CONFIG.bands]}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        metricLabel={AHI_CONFIG.metricLabel}
        metricFormatter={AHI_CONFIG.metricFormatter}
        partialLabel={AHI_CONFIG.partialLabel}
      />

      <div className={styles.monthly}>
        <div className={styles.monthlyHeader}>
          <span className={styles.monthlyEyebrow}>Monthly mean AHI</span>
          <span className={styles.monthlyUnit}>ev/hr · trailing 12 mo</span>
        </div>
        <ul className={styles.bars} aria-label="Monthly mean AHI, trailing 12 months">
          {monthly.map((point) => {
            const hasValue = point.meanAhi !== null;
            const heightPx =
              hasValue && maxMean > 0 ? Math.round((point.meanAhi / maxMean) * 46) + 2 : 2;
            const fill = hasValue ? severityColor(severityColors, point.severity) : colors.grid;
            const valueText = hasValue ? point.meanAhi.toFixed(1) : '—';
            return (
              <li
                key={point.month}
                className={styles.barCell}
                title={`${point.label}: ${hasValue ? `${valueText} ev/hr` : 'no defined AHI'}`}
              >
                <span className={styles.barValue}>{valueText}</span>
                <span
                  className={styles.bar}
                  style={{ height: `${heightPx}px`, background: fill }}
                />
                <span className={styles.barLabel}>{point.label.charAt(0)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default AhiCalendarPanel;
