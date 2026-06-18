/**
 * Recent sessions table with sortable columns.
 *
 * Displays session metadata in a table with click-to-navigate and
 * AHI severity badges.
 *
 * @module components/domain/SessionsTable
 */

import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui';
import { classifyAhiSeverity } from '@/analysis/clinical';
import type { Session, NightlyAggregate } from '@/types';
import styles from './SessionsTable.module.css';

interface SessionsTableProps {
  sessions: Session[];
  /** Nightly aggregates to join with sessions for AHI/leak/events columns. */
  aggregates?: NightlyAggregate[];
  /** Maximum rows to display. @default 10 */
  limit?: number;
}

type SortField = 'date' | 'durationMinutes' | 'usageMinutes' | 'ahi' | 'leakMedian' | 'eventCount';
type SortDirection = 'asc' | 'desc';

interface ColumnDef {
  key: SortField;
  label: string;
  format: (session: Session, aggMap: Map<string, NightlyAggregate>) => string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'date', label: 'Date', format: (s) => formatSessionDate(s.date) },
  { key: 'durationMinutes', label: 'Duration', format: (s) => formatMinutes(s.durationMinutes) },
  { key: 'usageMinutes', label: 'Usage', format: (s) => formatHours(s.usageMinutes) },
  {
    key: 'ahi',
    label: 'AHI',
    format: (s, m) => {
      const ahi = m.get(s.date)?.ahi;
      return ahi != null ? ahi.toFixed(1) : '—';
    },
  },
  {
    key: 'leakMedian',
    label: 'Leak (median)',
    format: (s, m) => {
      const agg = m.get(s.date);
      return agg ? `${agg.leakMedian.toFixed(1)} L/min` : '—';
    },
  },
  {
    key: 'eventCount',
    label: 'Events',
    format: (s, m) => {
      const agg = m.get(s.date);
      return agg ? String(agg.eventCount) : '—';
    },
  },
];

export function SessionsTable({ sessions, aggregates = [], limit = 10 }: SessionsTableProps) {
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  /** Map session date → NightlyAggregate for O(1) lookup. */
  const aggMap = useMemo(() => {
    const map = new Map<string, NightlyAggregate>();
    for (const agg of aggregates) {
      map.set(agg.date, agg);
    }
    return map;
  }, [aggregates]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDirection('desc');
      }
    },
    [sortField],
  );

  const sortedSessions = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date':
          cmp = a.date.localeCompare(b.date);
          break;
        case 'durationMinutes':
          cmp = a.durationMinutes - b.durationMinutes;
          break;
        case 'usageMinutes':
          cmp = a.usageMinutes - b.usageMinutes;
          break;
        case 'ahi': {
          // AHI may be null (recording too short for a per-hour rate). Sort
          // null entries to the end regardless of direction rather than
          // coercing them to 0 (which would rank them as the best night).
          const ahiA = aggMap.get(a.date)?.ahi;
          const ahiB = aggMap.get(b.date)?.ahi;
          const aNull = ahiA == null;
          const bNull = ahiB == null;
          if (aNull || bNull) {
            // Keep nulls last irrespective of sort direction (return here so
            // the direction negation below does not reorder them).
            return aNull === bNull ? 0 : aNull ? 1 : -1;
          }
          cmp = ahiA - ahiB;
          break;
        }
        case 'leakMedian':
          cmp = (aggMap.get(a.date)?.leakMedian ?? 0) - (aggMap.get(b.date)?.leakMedian ?? 0);
          break;
        case 'eventCount':
          cmp = (aggMap.get(a.date)?.eventCount ?? 0) - (aggMap.get(b.date)?.eventCount ?? 0);
          break;
        default:
          cmp = a.date.localeCompare(b.date);
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted.slice(0, limit);
  }, [sessions, sortField, sortDirection, limit, aggMap]);

  const handleRowClick = useCallback(
    (sessionId: string) => {
      void navigate(`/sessions/${sessionId}`);
    },
    [navigate],
  );

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent, sessionId: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void navigate(`/sessions/${sessionId}`);
      }
    },
    [navigate],
  );

  if (sessions.length === 0) {
    return <p className={styles.empty}>No sessions found for the selected date range.</p>;
  }

  return (
    <div className={styles.wrapper}>
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((col) => (
              <TableHead
                key={col.key}
                className={styles.sortableHead}
                onClick={() => handleSort(col.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSort(col.key);
                  }
                }}
                tabIndex={0}
                role="columnheader"
                aria-sort={
                  sortField === col.key
                    ? sortDirection === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <span className={styles.headContent}>
                  {col.label}
                  {sortField === col.key && (
                    <span className={styles.sortArrow} aria-hidden="true">
                      {sortDirection === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedSessions.map((session) => (
            <TableRow
              key={session.id}
              className={styles.clickableRow}
              onClick={() => handleRowClick(session.id)}
              onKeyDown={(e) => handleRowKeyDown(e, session.id)}
              tabIndex={0}
              role="link"
              aria-label={`Session from ${formatSessionDate(session.date)}`}
            >
              <TableCell>{formatSessionDate(session.date)}</TableCell>
              <TableCell>{formatMinutes(session.durationMinutes)}</TableCell>
              <TableCell>{formatHours(session.usageMinutes)}</TableCell>
              <TableCell>
                <AHIBadge ahi={aggMap.get(session.date)?.ahi} />
              </TableCell>
              <TableCell className={styles.mono}>
                {COLUMNS[4]?.format(session, aggMap) ?? '—'}
              </TableCell>
              <TableCell className={styles.mono}>
                {COLUMNS[5]?.format(session, aggMap) ?? '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Display AHI with a severity badge. */
function AHIBadge({ ahi }: { ahi?: number | null }) {
  if (ahi == null) {
    // null = recording too short for a per-hour rate; undefined = no aggregate.
    return (
      <span className={styles.mono} title="Insufficient recording time" aria-label="Not available">
        —
      </span>
    );
  }

  const severity = classifyAhiSeverity(ahi);

  return (
    <span
      className={`${styles.mono} ${styles[`ahi${severity.charAt(0).toUpperCase()}${severity.slice(1)}`] ?? ''}`}
    >
      {ahi.toFixed(1)}
    </span>
  );
}

function formatSessionDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return `${hours.toFixed(1)}h`;
}
