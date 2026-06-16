/**
 * Session List view — filterable, sortable, paginated table of all sessions.
 *
 * Joins session data with nightly aggregates to display AHI, leak,
 * and event metrics. Synced with the global date range selector.
 *
 * @module views/Sessions/SessionList
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Input,
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';
import { DateRangeSelector } from '@/components/domain/DateRangeSelector';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { classifyAhiSeverity, type AhiSeverity } from '@/analysis/clinical';
import styles from './SessionList.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  date: string;
  machineModel: string;
  durationMinutes: number;
  usageMinutes: number;
  ahi: number;
  leakMedian: number;
  eventCount: number;
  complianceStatus: 'compliant' | 'non-compliant' | 'partial';
}

type SortField = 'date' | 'durationMinutes' | 'usageMinutes' | 'ahi' | 'leakMedian' | 'eventCount';
type SortDirection = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

interface ColumnDef {
  key: SortField;
  label: string;
  numeric: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: 'date', label: 'Date', numeric: false },
  { key: 'durationMinutes', label: 'Duration', numeric: true },
  { key: 'usageMinutes', label: 'Usage', numeric: true },
  { key: 'ahi', label: 'AHI', numeric: true },
  { key: 'leakMedian', label: 'Leak (median)', numeric: true },
  { key: 'eventCount', label: 'Events', numeric: true },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const AHI_SEVERITY_LABELS: Record<AhiSeverity, string> = {
  normal: 'Normal',
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
};

const AHI_SEVERITY_STYLES: Record<AhiSeverity, string> = {
  normal: styles.ahiNormal ?? '',
  mild: styles.ahiMild ?? '',
  moderate: styles.ahiModerate ?? '',
  severe: styles.ahiSevere ?? '',
};

function compareRows(a: SessionRow, b: SessionRow, field: SortField): number {
  switch (field) {
    case 'date':
      return a.date.localeCompare(b.date);
    case 'durationMinutes':
      return a.durationMinutes - b.durationMinutes;
    case 'usageMinutes':
      return a.usageMinutes - b.usageMinutes;
    case 'ahi':
      return a.ahi - b.ahi;
    case 'leakMedian':
      return a.leakMedian - b.leakMedian;
    case 'eventCount':
      return a.eventCount - b.eventCount;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AHIBadge({ ahi }: { ahi: number }) {
  const severity = classifyAhiSeverity(ahi);
  return (
    <span
      className={`${styles.ahiBadge} ${AHI_SEVERITY_STYLES[severity]}`}
      title={`${AHI_SEVERITY_LABELS[severity]} (${ahi.toFixed(1)})`}
    >
      {ahi.toFixed(1)}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <Card>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <Skeleton width="120px" height="16px" />
          <Skeleton width="70px" height="16px" />
          <Skeleton width="60px" height="16px" />
          <Skeleton width="50px" height="16px" />
          <Skeleton width="80px" height="16px" />
          <Skeleton width="50px" height="16px" />
        </div>
      ))}
    </Card>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className={styles.emptyState} role="status">
      <span className={styles.emptyIcon} aria-hidden="true">
        📋
      </span>
      <h3 className={styles.emptyTitle}>
        {hasFilter ? 'No matching sessions' : 'No sessions found'}
      </h3>
      <p className={styles.emptyMessage}>
        {hasFilter
          ? 'Try adjusting your search filter or date range.'
          : 'Import your CPAP data to see sessions here.'}
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.errorState} role="alert">
      <p className={styles.errorMessage}>{message}</p>
      <button className={styles.pageButton} onClick={onRetry} type="button">
        Retry
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  const startItem = (currentPage - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(currentPage * PAGE_SIZE, totalItems);

  // Build visible page numbers (max 7 buttons)
  const pageNumbers = useMemo(() => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('ellipsis');
      const rangeStart = Math.max(2, currentPage - 1);
      const rangeEnd = Math.min(totalPages - 1, currentPage + 1);
      for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  }, [currentPage, totalPages]);

  if (totalPages <= 1) return null;

  return (
    <nav className={styles.pagination} aria-label="Session list pagination">
      <span className={styles.pageInfo}>
        Showing {startItem}–{endItem} of {totalItems} sessions
      </span>
      <div className={styles.pageControls}>
        <button
          className={styles.pageButton}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Previous page"
          type="button"
        >
          ‹ Prev
        </button>
        {pageNumbers.map((p, i) =>
          p === 'ellipsis' ? (
            <span key={`ellipsis-${i}`} className={styles.pageInfo} aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              className={`${styles.pageButton} ${p === currentPage ? styles.pageButtonActive : ''}`}
              onClick={() => onPageChange(p)}
              aria-label={`Page ${p}`}
              aria-current={p === currentPage ? 'page' : undefined}
              type="button"
            >
              {p}
            </button>
          ),
        )}
        <button
          className={styles.pageButton}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label="Next page"
          type="button"
        >
          Next ›
        </button>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function SessionList() {
  const navigate = useNavigate();

  // Global state
  const dateRange = useAppStore((s) => s.dateRange);
  const sessions = useDataStore((s) => s.sessions);
  const sessionsLoading = useDataStore((s) => s.sessionsLoading);
  const sessionsError = useDataStore((s) => s.sessionsError);
  const loadSessions = useDataStore((s) => s.loadSessions);

  // Local state
  const [searchFilter, setSearchFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);

  // Load sessions when dateRange changes
  useEffect(() => {
    void loadSessions(dateRange);
  }, [dateRange, loadSessions]);

  // Reset to page 1 when filter/sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchFilter, sortField, sortDirection]);

  // Convert Map to array
  const allRows: SessionRow[] = useMemo(() => Array.from(sessions.values()), [sessions]);

  // Filter
  const filteredRows = useMemo(() => {
    if (!searchFilter.trim()) return allRows;
    const query = searchFilter.toLowerCase().trim();
    return allRows.filter((row) => {
      const dateFormatted = formatSessionDate(row.date).toLowerCase();
      const dateRaw = row.date.toLowerCase();
      return dateFormatted.includes(query) || dateRaw.includes(query);
    });
  }, [allRows, searchFilter]);

  // Sort
  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => {
      const cmp = compareRows(a, b, sortField);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredRows, sortField, sortDirection]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = useMemo(
    () => sortedRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sortedRows, safePage],
  );

  // Handlers
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

  const handleRetry = useCallback(() => {
    void loadSessions(dateRange);
  }, [loadSessions, dateRange]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <h1 className={styles.title}>Sessions</h1>
          <span className={styles.sessionCount}>
            {sessionsLoading
              ? 'Loading…'
              : `${filteredRows.length} session${filteredRows.length !== 1 ? 's' : ''}`}
          </span>
        </div>

        {/* Toolbar: search + date range */}
        <div className={styles.toolbar}>
          <div className={styles.searchWrapper}>
            <Input
              placeholder="Filter by date…"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              aria-label="Filter sessions by date"
              type="search"
            />
          </div>
          <div className={styles.dateRangeWrapper}>
            <DateRangeSelector />
          </div>
        </div>
      </div>

      {/* Error state */}
      {sessionsError && <ErrorState message={sessionsError} onRetry={handleRetry} />}

      {/* Loading state */}
      {sessionsLoading && !sessionsError && <LoadingSkeleton />}

      {/* Data table */}
      {!sessionsLoading && !sessionsError && (
        <>
          {sortedRows.length === 0 ? (
            <Card>
              <EmptyState hasFilter={searchFilter.trim().length > 0} />
            </Card>
          ) : (
            <Card padding={false}>
              <div className={styles.tableWrapper}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {COLUMNS.map((col) => (
                        <TableHead
                          key={col.key}
                          className={`${styles.sortableHead} ${col.numeric ? styles.numericHead : ''}`}
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
                    {pageRows.map((row) => (
                      <TableRow
                        key={row.id}
                        className={styles.clickableRow}
                        onClick={() => handleRowClick(row.id)}
                        onKeyDown={(e) => handleRowKeyDown(e, row.id)}
                        tabIndex={0}
                        role="link"
                        aria-label={`Session from ${formatSessionDate(row.date)}`}
                      >
                        <TableCell>{formatSessionDate(row.date)}</TableCell>
                        <TableCell className={styles.numericCell}>
                          {formatMinutes(row.durationMinutes)}
                        </TableCell>
                        <TableCell className={styles.numericCell}>
                          {formatHours(row.usageMinutes)}
                        </TableCell>
                        <TableCell className={styles.numericCell}>
                          <AHIBadge ahi={row.ahi} />
                        </TableCell>
                        <TableCell className={styles.numericCell}>
                          {row.leakMedian.toFixed(1)}
                        </TableCell>
                        <TableCell className={styles.numericCell}>{row.eventCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className={styles.paginationWrapper}>
                <PaginationControls
                  currentPage={safePage}
                  totalPages={totalPages}
                  totalItems={sortedRows.length}
                  onPageChange={setCurrentPage}
                />
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
