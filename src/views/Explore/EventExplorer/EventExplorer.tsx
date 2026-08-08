/**
 * Event Explorer — an ad-hoc query tool for respiratory-event characteristics.
 *
 * Three-zone layout: a left-rail {@link QueryBuilder}, a main results area with
 * a {@link MatchedCountStrip}, a view switcher over five lenses
 * ({@link ResultsViews}), and a virtualized {@link EventTable}. Query state is
 * serialized to the URL (bookmarkable, back-button-able) and named queries are
 * persisted to localStorage. The matched set can be exported to CSV/JSON,
 * entirely in-browser.
 *
 * This view replaces the former EventAnalysis at `/explore/events`. The
 * analyses it carried (FLG clustering, inter-event intervals, duration
 * distribution) live on here as lenses. Kaplan-Meier survival was removed from
 * this view; that night-level analysis remains available via the Correlations /
 * Statistical analyses.
 *
 * @module views/Explore/EventExplorer/EventExplorer
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigationType, useSearchParams } from 'react-router-dom';
import { Tabs } from '@/components/ui';
import { useExplorerEvents } from './useExplorerEvents';
import {
  computeFieldAvailability,
  countActiveFilters,
  emptyQuery,
  runQuery,
  type EventQuery,
} from './queryEngine';
import { queriesEqual, queryToSearchParams, searchParamsToQuery } from './querySerialization';
import {
  createSavedQuery,
  loadSavedQueries,
  persistSavedQueries,
  type SavedQuery,
} from './savedQueries';
import { exportEventsCsv, exportEventsJson, LARGE_EXPORT_THRESHOLD } from './exportEvents';
import { QueryBuilder } from './QueryBuilder';
import { MatchedCountStrip } from './MatchedCountStrip';
import { ResultsViews } from './ResultsViews';
import { VIEW_OPTIONS, type ViewId } from './viewOptions';
import { EventTable } from './EventTable';
import styles from './EventExplorer.module.css';

/** Table is windowed; aggregations use the full matched set. */
const TABLE_ROW_CAP = 5000;

function isViewId(value: string | null): value is ViewId {
  return value !== null && VIEW_OPTIONS.some((v) => v.value === value);
}

/**
 * Command-surface page header: an `Explore / Event Explorer` breadcrumb above
 * the mono page title, with an optional right-hand slot (export controls). The
 * `<h1 id="explorer-heading">` is preserved across every view state so the
 * `getByRole('heading', { name: 'Event Explorer' })` selectors keep resolving.
 */
function ExplorerHeader({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.topBar}>
      <div className={styles.titleBlock}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <Link to="/explore" className={styles.breadcrumbLink}>
            Explore
          </Link>
          <span className={styles.breadcrumbSep} aria-hidden="true">
            /
          </span>
          <span className={styles.breadcrumbCurrent}>Event Explorer</span>
        </nav>
        <h1 id="explorer-heading" className={styles.heading}>
          Event Explorer
        </h1>
      </div>
      {children}
    </div>
  );
}

export function EventExplorer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigationType = useNavigationType();

  // Query state is derived from the URL on first render, then kept in sync.
  const [query, setQueryState] = useState<EventQuery>(() => searchParamsToQuery(searchParams));
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() => loadSavedQueries());

  // Loading is session-scope-aware: a scoped session is loaded directly,
  // ignoring the global date range, so a session OUTSIDE that range still
  // resolves. See useExplorerEvents.
  const { events, sessionStartTimes, loading, error, refetch } = useExplorerEvents(
    query.sessionIds,
  );

  const activeView: ViewId = isViewId(searchParams.get('view'))
    ? (searchParams.get('view') as ViewId)
    : 'histogram';

  // Reflect a query into the URL (preserving the `view` param).
  const writeQueryToUrl = useCallback(
    (next: EventQuery, view?: ViewId) => {
      const params = queryToSearchParams(next);
      const viewVal = view ?? searchParams.get('view');
      if (viewVal && isViewId(viewVal)) params.view = viewVal;
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setQuery = useCallback(
    (next: EventQuery) => {
      setQueryState(next);
      writeQueryToUrl(next);
    },
    [writeQueryToUrl],
  );

  // Keep query in sync with external URL changes (back/forward navigation).
  // Structural comparison (via the canonical URL serialization) is required
  // because `EventQuery.types` is a `Set` — `JSON.stringify` would render it
  // as `"{}"` and silently drop types-only differences.
  //
  // Session-scope guard: never let this resync SILENTLY drop an existing
  // non-empty `query.sessionIds` scope just because the observed URL lacks
  // `sessions=`, unless the navigation was a genuine back/forward (POP) —
  // the one case where "the URL now has no `sessions` param" legitimately
  // means the user navigated to an unscoped state. This is defense-in-depth
  // against a transient or momentarily-clobbered URL (e.g. a race with
  // `useURLStateSync`'s debounced write — see `src/hooks/useURLState.ts`)
  // silently dropping the `role="group" aria-label="Session scope filter"`
  // chip in `QueryBuilder` even though the intended navigation carried a
  // scope. A deliberate user-initiated clear (the Reset button, or removing
  // the last scope chip) already updates `query` directly via
  // `setQuery`/`writeQueryToUrl`, so by the time this effect observes the
  // resulting URL, `query.sessionIds` is already empty and there is nothing
  // to protect — this guard only ever grows/replaces scope from the URL, it
  // never uses the URL to silently clear one PUSH/REPLACE navigations set.
  useEffect(() => {
    const incoming = searchParamsToQuery(searchParams);
    const droppedScopeWithoutPop =
      navigationType !== 'POP' &&
      query.sessionIds !== null &&
      query.sessionIds.size > 0 &&
      (incoming.sessionIds === null || incoming.sessionIds.size === 0);
    const reconciled = droppedScopeWithoutPop
      ? { ...incoming, sessionIds: query.sessionIds }
      : incoming;

    if (!queriesEqual(reconciled, query)) {
      setQueryState(reconciled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setView = useCallback(
    (view: string) => {
      if (!isViewId(view)) return;
      writeQueryToUrl(query, view);
    },
    [query, writeQueryToUrl],
  );

  const availability = useMemo(() => computeFieldAvailability(events), [events]);
  const result = useMemo(() => runQuery(events, query), [events, query]);
  const activeFilters = countActiveFilters(query);

  // ── Saved-query handlers ──────────────────────────────────────
  const handleSaveQuery = useCallback(
    (name: string) => {
      const sq = createSavedQuery(name, query);
      setSavedQueries((prev) => {
        const next = [...prev, sq];
        persistSavedQueries(next);
        return next;
      });
    },
    [query],
  );

  const handleDeleteQuery = useCallback((id: string) => {
    setSavedQueries((prev) => {
      const next = prev.filter((q) => q.id !== id);
      persistSavedQueries(next);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => setQuery(emptyQuery()), [setQuery]);

  // ── Export ────────────────────────────────────────────────────
  const confirmLarge = (count: number): boolean => {
    if (count <= LARGE_EXPORT_THRESHOLD) return true;
    return window.confirm(
      `You are about to export ${count.toLocaleString()} events. This may take a moment and ` +
        `produce a large file. The export stays on your device. Continue?`,
    );
  };

  const handleExportCsv = useCallback(() => {
    if (confirmLarge(result.matched.length)) exportEventsCsv(result.matched);
  }, [result.matched]);

  const handleExportJson = useCallback(() => {
    if (confirmLarge(result.matched.length)) exportEventsJson(result.matched);
  }, [result.matched]);

  // ── States ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={styles.page}>
        <ExplorerHeader />
        <div className={styles.spinner} role="status" aria-label="Loading event data">
          Loading event data…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <ExplorerHeader />
        <div className={styles.errorBox} role="alert">
          <p>{error}</p>
          <button type="button" className={styles.retryBtn} onClick={refetch}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className={styles.page}>
        <ExplorerHeader />
        <div className={styles.emptyState} role="status">
          <h2>No events in this date range</h2>
          <p>
            Import CPAP data, or widen the global date range, to explore respiratory events. Use the
            Data Management page to get started.
          </p>
        </div>
      </div>
    );
  }

  const tabs = VIEW_OPTIONS.map((v) => ({
    value: v.value,
    label: v.label,
    content: <ResultsViews view={v.value} events={result.matched} />,
  }));

  return (
    <div className={styles.page} role="main" aria-labelledby="explorer-heading">
      <ExplorerHeader>
        <div className={styles.exportGroup} role="group" aria-label="Export matched events">
          <button
            type="button"
            className={styles.exportBtn}
            onClick={handleExportCsv}
            disabled={result.matched.length === 0}
          >
            Export CSV
          </button>
          <button
            type="button"
            className={styles.exportBtn}
            onClick={handleExportJson}
            disabled={result.matched.length === 0}
          >
            Export JSON
          </button>
        </div>
      </ExplorerHeader>

      <div className={styles.layout}>
        <aside className={styles.rail} aria-label="Query builder">
          <QueryBuilder
            query={query}
            onChange={setQuery}
            events={events}
            sessionStartTimes={sessionStartTimes}
            availability={availability}
            savedQueries={savedQueries}
            onSaveQuery={handleSaveQuery}
            onDeleteQuery={handleDeleteQuery}
            onApplySaved={setQuery}
            onReset={handleReset}
          />
        </aside>

        <div className={styles.main}>
          <MatchedCountStrip
            matched={result.matched.length}
            total={result.total}
            activeFilters={activeFilters}
          />

          {result.matched.length === 0 ? (
            <div className={styles.zeroMatch} role="status">
              <h2>No events match these filters</h2>
              <p>
                {activeFilters > 0
                  ? `${activeFilters} active filter${activeFilters === 1 ? '' : 's'} excluded every event.`
                  : 'There are no events to show.'}
              </p>
              <button type="button" className={styles.retryBtn} onClick={handleReset}>
                Relax all filters
              </button>
            </div>
          ) : (
            <>
              <Tabs tabs={tabs} value={activeView} onValueChange={setView} />
              <EventTable
                events={result.matched}
                sessionStartTimes={sessionStartTimes}
                maxRows={TABLE_ROW_CAP}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default EventExplorer;
