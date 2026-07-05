/**
 * Event mix / night — per-night stacked bars of respiratory-event counts.
 *
 * One thin bar per night, stacked by event type (obstructive / hypopnea /
 * central / mixed / RERA) from `aggregate.eventsByType` (always-defined raw
 * counts). A text legend pairs each colour with its label so type is never
 * conveyed by colour alone.
 *
 * @module views/Dashboard/signalDeck/EventMixPanel
 */

import { useChartColors } from '@/components/charts/useChartColors';
import type { NightlyAggregate } from '@/types';

import { EVENT_KEYS, EVENT_LABELS, eventTypeColors } from './eventColors';
import styles from './DistributionsRow.module.css';

export interface EventMixPanelProps {
  /** Nightly aggregates for the window, sorted oldest → newest. */
  readonly aggregates: readonly NightlyAggregate[];
}

const VB_W = 480;
const VB_H = 150;
const PAD = { left: 6, right: 6, top: 4, bottom: 8 };

export function EventMixPanel({ aggregates }: EventMixPanelProps): JSX.Element {
  const colors = useChartColors();

  const eventColors = eventTypeColors(colors);
  const keys = EVENT_KEYS;

  const innerW = VB_W - PAD.left - PAD.right;
  const innerH = VB_H - PAD.top - PAD.bottom;
  const n = Math.max(1, aggregates.length);
  const gap = innerW / n;
  const barW = gap * 0.74;

  const maxTotal = aggregates.reduce((m, a) => {
    const total = keys.reduce((s, k) => s + a.eventsByType[k], 0);
    return Math.max(m, total);
  }, 1);

  return (
    <div className={styles.panel}>
      <div className={styles.eventHeader}>
        <h2 className={styles.title}>Event mix / night</h2>
        <ul className={styles.legend} aria-hidden="true">
          {keys.map((key) => (
            <li key={key} className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ background: eventColors[key] }} />
              {EVENT_LABELS[key]}
            </li>
          ))}
        </ul>
      </div>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        height="150"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Per-night respiratory event mix over ${aggregates.length} nights, stacked by obstructive, hypopnea, central, mixed, and RERA events.`}
        className={styles.chart}
      >
        {aggregates.map((a, i) => {
          let y = PAD.top + innerH;
          const x = PAD.left + i * gap + (gap - barW) / 2;
          return (
            <g key={a.date}>
              {keys.map((k) => {
                const count = a.eventsByType[k];
                if (count <= 0) return null;
                const h = (count / maxTotal) * innerH;
                y -= h;
                return <rect key={k} x={x} y={y} width={barW} height={h} fill={eventColors[k]} />;
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default EventMixPanel;
