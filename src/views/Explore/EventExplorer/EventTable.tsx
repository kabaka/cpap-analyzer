/**
 * Virtualized, sortable event table for the Event Explorer.
 *
 * Implements lightweight fixed-row-height windowing (no external virtualization
 * dependency): only the rows intersecting the scroll viewport (plus an overscan
 * margin) are rendered. Row click deep-links into the Signal Viewer centered on
 * the event timestamp (`/sessions/:sessionId/signals?t=<epochMs>`).
 *
 * @module views/Explore/EventExplorer/EventTable
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Event } from '@/types/events';
import { EventTypeSwatch } from '@/components/events/EventTypeSwatch';
import { eventLabel } from '@/components/events/eventTypeMeta';
import { sessionWallClockEpoch } from '@/views/Sessions/signalLanes';
import styles from './EventTable.module.css';

/** Sortable columns. */
type SortKey = 'timestamp' | 'type' | 'duration' | 'pressure' | 'leak' | 'spo2';
type SortDir = 'asc' | 'desc';

const ROW_HEIGHT = 40; // px, must match CSS
const OVERSCAN = 8; // rows rendered above/below the viewport
const VIEWPORT_HEIGHT = 480; // px

export interface EventTableProps {
  events: readonly Event[];
  /**
   * sessionId → session `startTime` (ISO). Used to render each event's time in
   * the wall-clock-as-UTC convention (matching the Signal Viewer and Session
   * Detail), independent of the viewer's timezone.
   */
  sessionStartTimes: ReadonlyMap<string, string>;
  /** Cap on rendered rows. Aggregations use the full set; the table caps. */
  maxRows?: number;
}

function compareNullableNumber(a: number | null, b: number | null, dir: SortDir): number {
  // Nulls always sort last regardless of direction.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

/**
 * Defensive fallback: render an epoch-ms timestamp in the viewer's LOCAL
 * timezone. Only used when a session's wall-clock start is missing/unparseable
 * (rare); the primary path is {@link formatWallClockTime}.
 */
function formatLocalTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Render an event's time in the wall-clock-as-UTC convention used by the Signal
 * Viewer and Session Detail.
 *
 * The Explorer spans multiple days, so we keep the date as well as the time.
 * We compute the event's wall-clock instant by anchoring it to the session's
 * wall-clock start (`sessionWallClockEpoch`) plus its offset from the raw
 * session start, then format with `timeZone: 'UTC'` so the displayed fields are
 * the wall-clock components — viewer-timezone-independent while preserving
 * locale month formatting. Falls back to {@link formatLocalTime} when the
 * session start is missing or unparseable.
 */
function formatWallClockTime(event: Event, sessionStartTimes: ReadonlyMap<string, string>): string {
  const startIso = sessionStartTimes.get(event.sessionId);
  if (startIso !== undefined) {
    const wallStart = sessionWallClockEpoch(startIso);
    const rawStart = new Date(startIso).getTime();
    if (!Number.isNaN(wallStart) && !Number.isNaN(rawStart)) {
      const wallInstant = wallStart + (event.timestamp - rawStart);
      return new Date(wallInstant).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'UTC',
      });
    }
  }
  // Defensive fallback so a missing/invalid session start never crashes a row.
  return formatLocalTime(event.timestamp);
}

function formatNum(v: number | null, digits = 1): string {
  return v === null ? 'n/a' : v.toFixed(digits);
}

export function EventTable({ events, sessionStartTimes, maxRows = 5000 }: EventTableProps) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * Index of the row that currently holds tabindex=0 (roving tabindex pattern).
   * Arrow keys move focus along this index; other rows hold tabindex=-1 so
   * the entire grid is one Tab stop, not one stop per row.
   */
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  /** Set when focus should follow a programmatic row-index change. */
  const pendingFocusRef = useRef(false);

  const sorted = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) => {
      switch (sortKey) {
        case 'timestamp':
          return sortDir === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
        case 'duration':
          return sortDir === 'asc' ? a.duration - b.duration : b.duration - a.duration;
        case 'type':
          return sortDir === 'asc'
            ? eventLabel(a.type).localeCompare(eventLabel(b.type))
            : eventLabel(b.type).localeCompare(eventLabel(a.type));
        case 'pressure':
          return compareNullableNumber(a.pressure, b.pressure, sortDir);
        case 'leak':
          return compareNullableNumber(a.leak, b.leak, sortDir);
        case 'spo2':
          return compareNullableNumber(a.spo2, b.spo2, sortDir);
        default:
          return 0;
      }
    });
    return copy;
  }, [events, sortKey, sortDir]);

  const capped = sorted.length > maxRows;
  const rows = capped ? sorted.slice(0, maxRows) : sorted;

  // Clamp the focused-row index whenever the row count shrinks (e.g. filters
  // tighten between renders) — otherwise the roving tabindex could point at
  // nothing.
  const clampedFocusIndex = rows.length === 0 ? 0 : Math.min(focusedRowIndex, rows.length - 1);

  const totalHeight = rows.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const endIdx = Math.min(rows.length, startIdx + visibleCount);
  const visible = rows.slice(startIdx, endIdx);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir(key === 'timestamp' ? 'asc' : 'desc');
      }
    },
    [sortKey],
  );

  const openEvent = useCallback(
    (event: Event) => {
      // Device events carry `duration` in SECONDS. When it's meaningful, pass the
      // event END (`te`) so the Signal Viewer frames the whole event rather than
      // centering a fixed window on its start.
      const base = `/sessions/${event.sessionId}/signals?t=${event.timestamp}`;
      const url =
        event.duration > 0 ? `${base}&te=${event.timestamp + event.duration * 1000}` : base;
      navigate(url);
    },
    [navigate],
  );

  /** Move the roving-tabindex focus to a row, scrolling it into view. */
  const moveFocusTo = useCallback(
    (nextIndex: number) => {
      if (rows.length === 0) return;
      const clamped = Math.max(0, Math.min(rows.length - 1, nextIndex));
      setFocusedRowIndex(clamped);
      pendingFocusRef.current = true;
      // Keep the row inside the viewport: nudge scrollTop so the row's top
      // falls between the current scroll window.
      const el = scrollRef.current;
      if (el) {
        const rowTop = clamped * ROW_HEIGHT;
        const rowBottom = rowTop + ROW_HEIGHT;
        if (rowTop < el.scrollTop) {
          el.scrollTop = rowTop;
        } else if (rowBottom > el.scrollTop + el.clientHeight) {
          el.scrollTop = rowBottom - el.clientHeight;
        }
      }
    },
    [rows.length],
  );

  // Move DOM focus to the row that received the roving tabindex (after the
  // virtual list re-renders with the newly-visible button).
  useEffect(() => {
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    const el = scrollRef.current?.querySelector<HTMLButtonElement>(
      `[data-row-index="${clampedFocusIndex}"]`,
    );
    el?.focus();
  }, [clampedFocusIndex, scrollTop]);

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveFocusTo(index + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveFocusTo(index - 1);
          break;
        case 'Home':
          e.preventDefault();
          moveFocusTo(0);
          break;
        case 'End':
          e.preventDefault();
          moveFocusTo(rows.length - 1);
          break;
        default:
          break;
      }
    },
    [moveFocusTo, rows.length],
  );

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  const headers: { key: SortKey; label: string; numeric?: boolean }[] = [
    { key: 'timestamp', label: 'Time' },
    { key: 'type', label: 'Type' },
    { key: 'duration', label: 'Duration (s)', numeric: true },
    { key: 'pressure', label: 'Pressure', numeric: true },
    { key: 'leak', label: 'Leak', numeric: true },
    { key: 'spo2', label: 'SpO₂', numeric: true },
  ];

  // Grid uses 1-based rowindex per WAI-ARIA. Row 1 is the header row.
  const totalRowCount = rows.length + 1;

  return (
    <div className={styles.wrapper}>
      <div
        role="grid"
        aria-label="Matched events"
        aria-rowcount={totalRowCount}
        className={styles.grid}
      >
        <div className={styles.tableHeader} role="row" aria-rowindex={1}>
          {headers.map((h) => (
            <button
              key={h.key}
              type="button"
              role="columnheader"
              aria-sort={ariaSort(h.key)}
              className={`${styles.headerCell} ${h.numeric ? styles.numeric : ''}`}
              onClick={() => toggleSort(h.key)}
            >
              {h.label}
              {h.key === sortKey && (
                <span aria-hidden="true" className={styles.sortArrow}>
                  {sortDir === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          ))}
        </div>

        <div
          ref={scrollRef}
          className={styles.scrollArea}
          style={{ height: VIEWPORT_HEIGHT }}
          onScroll={handleScroll}
          role="rowgroup"
        >
          <div style={{ height: totalHeight, position: 'relative' }}>
            {visible.map((event, i) => {
              const rowIndex = startIdx + i;
              const top = rowIndex * ROW_HEIGHT;
              const isFocused = rowIndex === clampedFocusIndex;
              return (
                <button
                  key={event.id}
                  type="button"
                  role="row"
                  aria-rowindex={rowIndex + 2}
                  data-row-index={rowIndex}
                  tabIndex={isFocused ? 0 : -1}
                  className={styles.row}
                  style={{ top, height: ROW_HEIGHT }}
                  onClick={() => openEvent(event)}
                  onFocus={() => setFocusedRowIndex(rowIndex)}
                  onKeyDown={(e) => handleRowKeyDown(e, rowIndex)}
                  title="Open in Signal Viewer"
                >
                  <span role="gridcell" className={styles.cell}>
                    {formatWallClockTime(event, sessionStartTimes)}
                  </span>
                  <span role="gridcell" className={styles.cell}>
                    <EventTypeSwatch type={event.type} />
                    <span className={styles.typeLabel}>{eventLabel(event.type)}</span>
                  </span>
                  <span role="gridcell" className={`${styles.cell} ${styles.numeric}`}>
                    {event.duration.toFixed(1)}
                  </span>
                  <span role="gridcell" className={`${styles.cell} ${styles.numeric}`}>
                    {formatNum(event.pressure)}
                  </span>
                  <span role="gridcell" className={`${styles.cell} ${styles.numeric}`}>
                    {formatNum(event.leak)}
                  </span>
                  <span role="gridcell" className={`${styles.cell} ${styles.numeric}`}>
                    {formatNum(event.spo2, 0)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <p className={styles.caption}>
        {capped
          ? `Showing first ${maxRows.toLocaleString()} of ${sorted.length.toLocaleString()} matched events (sorted). Refine filters or export to access the full set.`
          : `Showing ${rows.length.toLocaleString()} matched event${rows.length === 1 ? '' : 's'}.`}
      </p>
    </div>
  );
}
