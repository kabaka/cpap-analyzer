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
import type { Session } from '@/types';
import styles from './SessionsTable.module.css';

interface SessionsTableProps {
  sessions: Session[];
  /** Maximum rows to display. @default 10 */
  limit?: number;
}

type SortField = 'date' | 'durationMinutes' | 'usageMinutes' | 'ahi' | 'leakMedian' | 'eventCount';
type SortDirection = 'asc' | 'desc';

interface ColumnDef {
  key: SortField;
  label: string;
  format: (session: Session) => string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'date', label: 'Date', format: (s) => formatSessionDate(s.date) },
  { key: 'durationMinutes', label: 'Duration', format: (s) => formatMinutes(s.durationMinutes) },
  { key: 'usageMinutes', label: 'Usage', format: (s) => formatHours(s.usageMinutes) },
  { key: 'ahi', label: 'AHI', format: () => 'N/A' },
  { key: 'leakMedian', label: 'Leak (median)', format: () => 'N/A' },
  { key: 'eventCount', label: 'Events', format: () => 'N/A' },
];

export function SessionsTable({ sessions, limit = 10 }: SessionsTableProps) {
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

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
        default:
          cmp = a.date.localeCompare(b.date);
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted.slice(0, limit);
  }, [sessions, sortField, sortDirection, limit]);

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
                <AHIBadge session={session} />
              </TableCell>
              <TableCell className={styles.mono}>—</TableCell>
              <TableCell className={styles.mono}>—</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Display AHI with a severity badge (data not yet joined — placeholder). */
function AHIBadge({ session }: { session: Session }) {
  // Until we join NightlyAggregate data, show a placeholder
  void session;
  return <span className={styles.mono}>—</span>;
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
