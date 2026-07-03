/**
 * Session List view — filterable, sortable, paginated table of all sessions.
 *
 * Joins session data with nightly aggregates to display AHI, leak,
 * and event metrics. Synced with the global date range selector.
 *
 * @module views/Sessions/SessionList
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card,
  Input,
  SegmentedControl,
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';
import type { SegmentedControlOption } from '@/components/ui';
import { DateRangeSelector } from '@/components/domain/DateRangeSelector';
import CalendarHeatmap, { type CalendarDatum } from '@/components/charts/d3/CalendarHeatmap';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { classifyAhiSeverity, type AhiSeverity } from '@/analysis/clinical';
import { formatDate } from '@/utils/formatDate';
import { PAGE_PARAM, parsePageParam } from './paginationParams';
import {
  METRIC_PARAM,
  SIZE_PARAM,
  VIEW_PARAM,
  parseMetricParam,
  parseSizeParam,
  parseViewParam,
  type CalendarMetric,
  type PageSize,
  type SessionView,
} from './viewParams';
import { CALENDAR_METRIC_CONFIG } from './calendarBands';
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
  /**
   * Per-night AHI rate, or `null` when the recording was below the
   * rate-validity floor (undefined rate). Rendered as an "insufficient
   * recording time" indicator, never as 0.
   */
  ahi: number | null;
  leakMedian: number;
  eventCount: number;
  complianceStatus: 'compliant' | 'non-compliant' | 'partial';
}

type SortField = 'date' | 'durationMinutes' | 'usageMinutes' | 'ahi' | 'leakMedian' | 'eventCount';
type SortDirection = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * View-toggle options (Table | Calendar). `SegmentedControl` renders a text
 * `label`; the spelled-out `ariaLabel` ("Table view" / "Calendar view") is the
 * full accessible name announced to screen-reader users. (Icon glyphs would
 * require `SegmentedControl` to accept a ReactNode label — flagged as a gap
 * rather than changing the shared component here.)
 */
const VIEW_OPTIONS: ReadonlyArray<SegmentedControlOption<SessionView>> = [
  { value: 'table', label: 'Table', ariaLabel: 'Table view' },
  { value: 'calendar', label: 'Calendar', ariaLabel: 'Calendar view' },
];

/** Calendar metric options (Calendar view only). */
const METRIC_OPTIONS: ReadonlyArray<SegmentedControlOption<CalendarMetric>> = [
  { value: 'ahi', label: 'AHI', ariaLabel: 'Apnea–Hypopnea Index' },
  { value: 'usage', label: 'Usage', ariaLabel: 'Usage hours' },
  { value: 'leak', label: 'Leak', ariaLabel: 'Median leak' },
];

/** Page-size options (Table view only). Values mirror {@link PageSize}. */
const PAGE_SIZE_OPTIONS: ReadonlyArray<SegmentedControlOption<`${PageSize}`>> = [
  { value: '25', label: '25', ariaLabel: '25 rows per page' },
  { value: '50', label: '50', ariaLabel: '50 rows per page' },
  { value: '100', label: '100', ariaLabel: '100 rows per page' },
];

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
      // AHI may be null (recording too short for a per-hour rate). Never
      // coerce null to 0 here; the directional null-last handling lives in
      // the sort callback (see sortedRows) so nulls stay last regardless of
      // sort direction.
      return (a.ahi ?? 0) - (b.ahi ?? 0);
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

function AHIBadge({ ahi }: { ahi: number | null }) {
  if (ahi == null) {
    // null = recording too short for a per-hour rate; render the
    // "insufficient recording time" indicator, never 0.
    return (
      <span
        className={styles.ahiBadge}
        title="Insufficient recording time"
        aria-label="Not available"
      >
        —
      </span>
    );
  }

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

/**
 * Calendar-shaped loading placeholder. Distinct from the table {@link
 * LoadingSkeleton}: a single muted grid-sized block plus a legend bar, sized to
 * roughly match the rendered heatmap so the layout does not jump on load.
 */
function CalendarLoadingSkeleton() {
  return (
    <Card>
      <div className={styles.calendarSkeleton} aria-hidden="true">
        <Skeleton width="100%" height="132px" />
        <Skeleton width="60%" height="20px" />
      </div>
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
  pageSize,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

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
  const selectedSessionId = useAppStore((s) => s.selectedSessionId);
  const sessions = useDataStore((s) => s.sessions);
  const sessionsLoading = useDataStore((s) => s.sessionsLoading);
  const sessionsError = useDataStore((s) => s.sessionsError);
  const loadSessions = useDataStore((s) => s.loadSessions);

  // Local state
  const [searchFilter, setSearchFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // View mode (table | calendar), calendar metric, table page, and table page
  // size all live in the URL query string rather than React state so that
  // browser Back/Forward and deep links restore them. Opening a session detail
  // unmounts this view; returning via Back remounts it and recovers all of this
  // state from the URL. Each control's DEFAULT is the ABSENCE of its param, so
  // URLs stay clean (mirrors the `?page=N` pattern below).
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseViewParam(searchParams.get(VIEW_PARAM));
  const metric = parseMetricParam(searchParams.get(METRIC_PARAM));
  const pageSize = parseSizeParam(searchParams.get(SIZE_PARAM));
  const currentPage = parsePageParam(searchParams.get(PAGE_PARAM));

  /**
   * Update the page in the URL. Page 1 is the default, so we delete the param
   * rather than write `page=1` to keep URLs clean (mirrors the Correlations
   * pattern). `{ replace: true }` avoids polluting history with each pagination
   * click; only the row-click navigation pushes a new history entry. All other
   * existing query params (start/end/session/…) are preserved verbatim.
   */
  const setPage = useCallback(
    (page: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (page <= 1) {
            next.delete(PAGE_PARAM);
          } else {
            next.set(PAGE_PARAM, String(page));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /**
   * Switch the view mode. `table` is the default → drop the `view` param
   * (clean URLs). Same `{ replace: true }` + preserve-other-params conventions
   * as {@link setPage}: switching views should not push a history entry, and
   * the active date range / selected session / page are kept verbatim.
   */
  const setView = useCallback(
    (next: SessionView) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'table') {
            params.delete(VIEW_PARAM);
          } else {
            params.set(VIEW_PARAM, next);
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /** Switch the calendar metric. `ahi` is the default → drop the `metric` param. */
  const setMetric = useCallback(
    (next: CalendarMetric) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'ahi') {
            params.delete(METRIC_PARAM);
          } else {
            params.set(METRIC_PARAM, next);
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /**
   * Set the table page size. `25` is the default → drop the `size` param. The
   * page-reset on size change is handled by the change-detection effect below
   * (which tracks `pageSize`), so we only write the size here.
   */
  const setPageSize = useCallback(
    (next: PageSize) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 25) {
            params.delete(SIZE_PARAM);
          } else {
            params.set(SIZE_PARAM, String(next));
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Load sessions when dateRange changes
  useEffect(() => {
    void loadSessions(dateRange);
  }, [dateRange, loadSessions]);

  // Reset to page 1 only when the filter/sort VALUES actually change. We compare
  // against the previously-seen values rather than using a "skip first mount"
  // ref: under React StrictMode (dev) the mount/cleanup/mount cycle re-runs this
  // effect, and a didMount ref would survive the remount and fire setPage(1) on
  // the second mount — wiping a deep-linked or Back-restored `?page=N`. Tracking
  // the prior values makes the reset idempotent across StrictMode remounts.
  //
  // `setPage` (via react-router's setSearchParams) gets a NEW identity on every
  // URL change, so it is read through a ref and kept OUT of the effect deps:
  // including it would re-fire the reset on each pagination/date-range URL write
  // and snap the page back to 1.
  const setPageRef = useRef(setPage);
  setPageRef.current = setPage;
  const prevFilterSortRef = useRef({ searchFilter, sortField, sortDirection, pageSize });
  useEffect(() => {
    const prev = prevFilterSortRef.current;
    const changed =
      prev.searchFilter !== searchFilter ||
      prev.sortField !== sortField ||
      prev.sortDirection !== sortDirection ||
      // A page-size change can strand the user on a now-out-of-range page
      // (e.g. page 3 at 25/page becomes empty at 100/page). Resetting to page 1
      // is cleaner than relying on the `safePage` clamp alone.
      prev.pageSize !== pageSize;
    prevFilterSortRef.current = { searchFilter, sortField, sortDirection, pageSize };
    if (changed) {
      setPageRef.current(1);
    }
  }, [searchFilter, sortField, sortDirection, pageSize]);

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
      // AHI may be null (recording too short for a per-hour rate). Sort null
      // entries to the end regardless of direction rather than coercing them
      // to 0 (which would rank them as the best night). Returning here skips
      // the direction negation below so nulls stay last.
      if (sortField === 'ahi') {
        const aNull = a.ahi == null;
        const bNull = b.ahi == null;
        if (aNull || bNull) {
          return aNull === bNull ? 0 : aNull ? 1 : -1;
        }
      }
      const cmp = compareRows(a, b, sortField);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredRows, sortField, sortDirection]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = useMemo(
    () => sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sortedRows, safePage, pageSize],
  );

  // ── Calendar data ────────────────────────────────────────────────
  // Build one CalendarDatum per session date for the selected metric, plus a
  // date → session-id map so a cell click can navigate to that session's detail
  // (mirrors handleRowClick). Only dates WITH a session get an entry; gap days
  // never fire onSelectDate. AHI may be null (too-short recording) — pass it
  // through as null so the heatmap renders the PARTIAL state, never coercing to 0.
  // Depends on filteredRows (not sortedRows): cell position is keyed by date, so
  // table sort order is irrelevant here and depending on it would rebuild this on
  // every sort toggle for an identical result.
  const { calendarData, dateToSessionId } = useMemo(() => {
    const valueByDate = new Map<string, number | null>();
    const idByDate = new Map<string, string>();
    for (const row of filteredRows) {
      let value: number | null;
      switch (metric) {
        case 'usage':
          value = row.usageMinutes / 60;
          break;
        case 'leak':
          value = row.leakMedian;
          break;
        case 'ahi':
        default:
          value = row.ahi;
          break;
      }
      // Last-wins if two sessions share a date (rare); the Map keeps the value
      // and id consistent in O(1) without an inner array scan.
      valueByDate.set(row.date, value);
      idByDate.set(row.date, row.id);
    }
    const data: CalendarDatum[] = Array.from(valueByDate, ([date, value]) => ({
      date,
      value,
    }));
    return { calendarData: data, dateToSessionId: idByDate };
  }, [filteredRows, metric]);

  // ISO bounds of the global date range so the calendar renders the FULL window
  // (gaps across the whole span show, not just the min/max of present sessions).
  const rangeStartISO = useMemo(() => formatDate(dateRange.start), [dateRange.start]);
  const rangeEndISO = useMemo(() => formatDate(dateRange.end), [dateRange.end]);

  // Highlight the globally-selected session's cell when its date is in range.
  const selectedDate = useMemo(() => {
    if (selectedSessionId == null) return undefined;
    return sessions.get(selectedSessionId)?.date ?? undefined;
  }, [selectedSessionId, sessions]);

  const metricConfig = CALENDAR_METRIC_CONFIG[metric];

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

  // Calendar cell activation → navigate to that day's session (mirrors
  // handleRowClick). Only fires for dates with a session (gaps never call it),
  // but we still guard the lookup.
  const handleSelectDate = useCallback(
    (date: string) => {
      const id = dateToSessionId.get(date);
      if (id) void navigate(`/sessions/${id}`);
    },
    [dateToSessionId, navigate],
  );

  // On view switch, move focus to the revealed content region so keyboard users
  // land in the new content rather than being stranded on the toggle. The panel
  // carries tabIndex={-1} to be a programmatic focus target. We skip the very
  // first render (mount) so an initial deep-link to ?view=calendar does not
  // steal focus on page load.
  const contentPanelRef = useRef<HTMLDivElement>(null);
  const prevViewRef = useRef<SessionView | null>(null);
  useEffect(() => {
    if (prevViewRef.current !== null && prevViewRef.current !== view) {
      contentPanelRef.current?.focus();
    }
    prevViewRef.current = view;
  }, [view]);

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

        {/*
         * Toolbar. The leading slot is view-dependent: in Table view it holds
         * the free-text date search; in Calendar view (which has no row-text
         * filter) it holds the Metric selector. The DateRangeSelector and the
         * View toggle stay mounted in BOTH views; the View toggle is pinned to
         * the right (margin-left:auto) as a peer of the search/metric + range.
         */}
        <div className={styles.toolbar}>
          {view === 'table' ? (
            <div className={styles.searchWrapper}>
              <Input
                placeholder="Filter by date…"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                aria-label="Filter sessions by date"
                type="search"
              />
            </div>
          ) : (
            <div className={styles.metricWrapper}>
              <SegmentedControl<CalendarMetric>
                label="Metric"
                options={METRIC_OPTIONS}
                value={metric}
                onChange={setMetric}
              />
            </div>
          )}
          <div className={styles.dateRangeWrapper}>
            <DateRangeSelector />
          </div>
          <div className={styles.viewToggleWrapper}>
            <SegmentedControl<SessionView>
              label="View"
              options={VIEW_OPTIONS}
              value={view}
              onChange={setView}
            />
          </div>
        </div>
      </div>

      {/* Error state (shared by both views) */}
      {sessionsError && <ErrorState message={sessionsError} onRetry={handleRetry} />}

      {/* Loading state — view-shaped skeleton */}
      {sessionsLoading &&
        !sessionsError &&
        (view === 'calendar' ? <CalendarLoadingSkeleton /> : <LoadingSkeleton />)}

      {/*
       * Content. State precedence stays error → loading → empty → content. The
       * panel is a programmatic focus target (tabIndex={-1}) so a view switch
       * can move focus here; it is labelled by the live session-count text in
       * the header.
       */}
      {!sessionsLoading && !sessionsError && (
        <div ref={contentPanelRef} tabIndex={-1} className={styles.contentPanel}>
          {view === 'calendar' ? (
            sortedRows.length === 0 ? (
              // All-gaps-in-range (the window spans dates but holds no sessions)
              // shows the empty state rather than a grid of only gap cells.
              <Card>
                <EmptyState hasFilter={searchFilter.trim().length > 0} />
              </Card>
            ) : (
              <Card>
                <div className={styles.calendarWrapper}>
                  <CalendarHeatmap
                    data={calendarData}
                    bands={[...metricConfig.bands]}
                    rangeStart={rangeStartISO}
                    rangeEnd={rangeEndISO}
                    selectedDate={selectedDate}
                    metricLabel={metricConfig.metricLabel}
                    metricFormatter={metricConfig.metricFormatter}
                    partialLabel={metricConfig.partialLabel}
                    onSelectDate={handleSelectDate}
                  />
                </div>
              </Card>
            )
          ) : sortedRows.length === 0 ? (
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
                <div className={styles.pageSizeRow}>
                  <SegmentedControl<`${PageSize}`>
                    label="Rows per page"
                    options={PAGE_SIZE_OPTIONS}
                    value={`${pageSize}`}
                    onChange={(next) => setPageSize(Number(next) as PageSize)}
                  />
                </div>
                <PaginationControls
                  currentPage={safePage}
                  totalPages={totalPages}
                  totalItems={sortedRows.length}
                  pageSize={pageSize}
                  onPageChange={setPage}
                />
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
