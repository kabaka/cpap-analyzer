/**
 * Session log — a compact, real `<table>` of recent nights.
 *
 * Columns: Date, Duration, Usage, AHI (severity-coloured + labelled), Leak,
 * Events, and a per-night event-mix bar. It is a semantic table (native `<th
 * scope="col">` column headers) for accessibility. Each row's Date is a real
 * link to the session detail; the whole row is also mouse-clickable for
 * convenience.
 *
 * AHI severity is paired with the numeric value AND an accessible severity word
 * (via `title`/`aria-label`), so colour is never the sole signal.
 *
 * @module views/Dashboard/signalDeck/SessionLog
 */

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { classifyAhiSeverity } from '@/analysis/clinical';
import { useChartColors } from '@/components/charts/useChartColors';
import type { NightlyAggregate, Session } from '@/types';

import { EVENT_KEYS, eventTypeColors } from './eventColors';
import { severityLabel, severityVar } from './severityTokens';
import styles from './SessionLog.module.css';

export interface SessionLogProps {
  /** Sessions in the window (newest first, as returned by useSessionData). */
  readonly sessions: readonly Session[];
  /** Nightly aggregates to join for AHI / leak / events columns. */
  readonly aggregates: readonly NightlyAggregate[];
  /** Maximum rows to show. @default 8 */
  readonly limit?: number;
}

function formatDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}

export function SessionLog({ sessions, aggregates, limit = 8 }: SessionLogProps): JSX.Element {
  const navigate = useNavigate();
  const colors = useChartColors();
  const eventColors = eventTypeColors(colors);

  const aggMap = useMemo(() => {
    const map = new Map<string, NightlyAggregate>();
    for (const agg of aggregates) map.set(agg.date, agg);
    return map;
  }, [aggregates]);

  const rows = sessions.slice(0, limit);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Session log</h2>
        <Link to="/sessions" className={styles.fullLog}>
          FULL LOG →
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>No sessions in the selected range.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.thLeft}>
                Date
              </th>
              <th scope="col" className={styles.thRight}>
                Dur
              </th>
              <th scope="col" className={styles.thRight}>
                Usage
              </th>
              <th scope="col" className={styles.thRight}>
                AHI
              </th>
              <th scope="col" className={styles.thRight}>
                Leak
              </th>
              <th scope="col" className={styles.thRight}>
                Events
              </th>
              <th scope="col" className={styles.thMix}>
                Event mix
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((session) => {
              const agg = aggMap.get(session.date);
              const ahi = agg?.ahi ?? null;
              const severity = ahi === null ? null : classifyAhiSeverity(ahi);
              const total = agg ? EVENT_KEYS.reduce((s, k) => s + agg.eventsByType[k], 0) : 0;
              return (
                <tr
                  key={session.id}
                  className={styles.row}
                  onClick={() => void navigate(`/sessions/${session.id}`)}
                >
                  <td className={styles.tdLeft}>
                    <Link
                      to={`/sessions/${session.id}`}
                      className={styles.dateLink}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {formatDate(session.date)}
                    </Link>
                  </td>
                  <td className={`${styles.tdRight} ${styles.muted}`}>
                    {formatDuration(session.durationMinutes)}
                  </td>
                  <td className={styles.tdRight}>{formatHours(session.usageMinutes)}</td>
                  <td
                    className={`${styles.tdRight} ${styles.ahi}`}
                    style={{ color: severity ? severityVar(severity) : 'var(--color-text-muted)' }}
                    title={
                      ahi === null
                        ? 'Insufficient recording time'
                        : `${ahi.toFixed(1)} events/h — ${severity ? severityLabel(severity) : ''}`
                    }
                    aria-label={
                      ahi === null
                        ? 'AHI not available'
                        : `AHI ${ahi.toFixed(1)}, ${severity ? severityLabel(severity) : ''}`
                    }
                  >
                    {ahi === null ? '—' : ahi.toFixed(1)}
                  </td>
                  <td className={`${styles.tdRight} ${styles.muted}`}>
                    {agg ? agg.leakMedian.toFixed(1) : '—'}
                  </td>
                  <td className={`${styles.tdRight} ${styles.muted}`}>
                    {agg ? agg.eventCount : '—'}
                  </td>
                  <td className={styles.tdMix}>
                    <span className={styles.mixBar} aria-hidden="true">
                      {agg &&
                        total > 0 &&
                        EVENT_KEYS.map((k) => {
                          const count = agg.eventsByType[k];
                          if (count <= 0) return null;
                          return (
                            <span
                              key={k}
                              className={styles.mixSeg}
                              style={{
                                width: `${(count / total) * 100}%`,
                                background: eventColors[k],
                              }}
                            />
                          );
                        })}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default SessionLog;
