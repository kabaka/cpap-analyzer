/**
 * Left-rail query builder for the Event Explorer.
 *
 * Renders the AND-combined filter controls: event-type chips, duration /
 * pressure / leak / SpO₂ range filters (nullable fields disable when absent),
 * a time-of-night window, and the saved-query controls. All edits flow up via
 * `onChange`; this component owns no query state itself.
 *
 * @module views/Explore/EventExplorer/QueryBuilder
 */

import { useMemo, useState } from 'react';
import type { Event, EventType } from '@/types/events';
import { EventTypeSwatch } from '@/components/events/EventTypeSwatch';
import { EVENT_TYPE_META, EVENT_TYPE_ORDER, eventLabel } from '@/components/events/eventTypeMeta';
import { useAppStore } from '@/stores/useAppStore';
import {
  fieldExtent,
  type EventQuery,
  type FieldAvailability,
  type NumericRange,
  type TimeOfNightWindow,
} from './queryEngine';
import { RangeFilter } from './RangeFilter';
import { EXAMPLE_QUERIES, savedQueryToEventQuery, type SavedQuery } from './savedQueries';
import styles from './QueryBuilder.module.css';

export interface QueryBuilderProps {
  query: EventQuery;
  onChange: (next: EventQuery) => void;
  /** All loaded events (for computing extents and present types). */
  events: readonly Event[];
  /** sessionId → session `startTime` (ISO), for labelling session-scope chips. */
  sessionStartTimes: ReadonlyMap<string, string>;
  availability: FieldAvailability;
  /** Persisted user queries. */
  savedQueries: readonly SavedQuery[];
  onSaveQuery: (name: string) => void;
  onDeleteQuery: (id: string) => void;
  onApplySaved: (query: EventQuery) => void;
  onReset: () => void;
}

function fmtTime(mins: number): string {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function parseTimeInput(raw: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Format an epoch-ms timestamp as a local `YYYY-MM-DD` (the `<input type="date">` shape). */
function fmtDate(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a `YYYY-MM-DD` date string as a local-midnight epoch ms; `null` on bad input. */
function parseDateInput(raw: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  return dt.getTime();
}

/** End-of-day epoch ms (23:59:59.999 local) for the date containing `epochMs`. */
function endOfLocalDay(epochMs: number): number {
  const d = new Date(epochMs);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Human-readable calendar date for a session-scope chip, derived from the
 * session `startTime` (ISO). Returns `null` when the start is missing or
 * unparseable so callers can fall back to a non-UUID label.
 */
function fmtSessionDate(startIso: string | undefined): string | null {
  if (startIso === undefined) return null;
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function QueryBuilder({
  query,
  onChange,
  events,
  sessionStartTimes,
  availability,
  savedQueries,
  onSaveQuery,
  onDeleteQuery,
  onApplySaved,
  onReset,
}: QueryBuilderProps) {
  const [saveName, setSaveName] = useState('');

  const presentTypes = useMemo(() => {
    const present = new Set<EventType>();
    for (const e of events) present.add(e.type);
    return EVENT_TYPE_ORDER.filter((t) => present.has(t));
  }, [events]);

  const durationBounds = useMemo(
    () => fieldExtent(events, 'duration') ?? { min: 0, max: 120 },
    [events],
  );
  const pressureBounds = useMemo(
    () => fieldExtent(events, 'pressure') ?? { min: 0, max: 20 },
    [events],
  );
  const leakBounds = useMemo(() => fieldExtent(events, 'leak') ?? { min: 0, max: 60 }, [events]);
  const spo2Bounds = useMemo(() => fieldExtent(events, 'spo2') ?? { min: 70, max: 100 }, [events]);

  const toggleType = (type: EventType): void => {
    const next = new Set(query.types);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onChange({ ...query, types: next });
  };

  const setRange = (key: 'duration' | 'pressure' | 'leak' | 'spo2', range: NumericRange): void => {
    onChange({ ...query, [key]: range });
  };

  const ton = query.timeOfNight;
  const setTon = (next: TimeOfNightWindow | null): void => {
    onChange({ ...query, timeOfNight: next });
  };

  // ── Session scope ───────────────────────────────────────────
  // A non-null `sessionIds` pre-scopes the Explorer to specific sessions
  // (e.g. linked from Session Detail). Removing the last id clears the scope
  // back to `null` (no constraint).
  const scopeIds = query.sessionIds === null ? [] : [...query.sessionIds];
  const removeSessionScope = (id: string): void => {
    if (query.sessionIds === null) return;
    const next = new Set(query.sessionIds);
    next.delete(id);
    onChange({ ...query, sessionIds: next.size > 0 ? next : null });
  };

  // ── Date range ──────────────────────────────────────────────
  // Defaults reflect the *global* app date range — the same window that
  // determines which events were loaded into the explorer. The explorer's
  // own date-range filter narrows *within* that loaded set.
  const appDateRange = useAppStore((s) => s.dateRange);
  const defaultRangeStart = appDateRange.start.getTime();
  const defaultRangeEnd = endOfLocalDay(appDateRange.end.getTime());
  const dr = query.dateRange;
  const setDateRange = (next: { start: number; end: number } | null): void => {
    onChange({ ...query, dateRange: next });
  };
  const dateRangeInvalid = dr !== null && dr.start > dr.end;

  const allExamples: readonly SavedQuery[] = EXAMPLE_QUERIES;

  return (
    <div className={styles.builder}>
      <div className={styles.headerRow}>
        <h2 className={styles.title}>Filters</h2>
        <button type="button" className={styles.resetBtn} onClick={onReset}>
          Reset
        </button>
      </div>

      {/* Session scope (only when the Explorer is pre-scoped to sessions) */}
      {scopeIds.length > 0 ? (
        <section className={styles.section} aria-labelledby="qb-scope">
          <h3 id="qb-scope" className={styles.sectionTitle}>
            Session scope
          </h3>
          <div className={styles.chips} role="group" aria-label="Session scope filter">
            {scopeIds.map((id) => {
              const dateLabel = fmtSessionDate(sessionStartTimes.get(id));
              const chipText = dateLabel === null ? 'Session' : `Session: ${dateLabel}`;
              const removeLabel =
                dateLabel === null ? 'Remove session scope' : `Remove session scope ${dateLabel}`;
              return (
                <span key={id} className={`${styles.chip} ${styles.chipSelected}`}>
                  <span>{chipText}</span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={removeLabel}
                    onClick={() => removeSessionScope(id)}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
          <p className={styles.hint}>
            Scoped to specific sessions. Events load regardless of the global date range while a
            scope is active.
          </p>
        </section>
      ) : null}

      {/* Event types */}
      <section className={styles.section} aria-labelledby="qb-types">
        <h3 id="qb-types" className={styles.sectionTitle}>
          Event type
        </h3>
        {presentTypes.length === 0 ? (
          <p className={styles.muted}>No events loaded.</p>
        ) : (
          <div className={styles.chips} role="group" aria-label="Event type filter">
            {presentTypes.map((type) => {
              const selected = query.types.has(type);
              const meta = EVENT_TYPE_META[type];
              return (
                <button
                  key={type}
                  type="button"
                  className={`${styles.chip} ${selected ? styles.chipSelected : ''}`}
                  aria-pressed={selected}
                  onClick={() => toggleType(type)}
                >
                  <EventTypeSwatch type={type} />
                  <span>{eventLabel(type)}</span>
                  {meta?.detection ? (
                    <span className={styles.detectionTag} title="Detection pattern">
                      pattern
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Duration */}
      <section className={styles.section}>
        <RangeFilter
          label="Duration"
          unit="s"
          bounds={durationBounds}
          value={query.duration}
          onChange={(r) => setRange('duration', r)}
          step={1}
        />
      </section>

      {/* Pressure */}
      <section className={styles.section}>
        <RangeFilter
          label="Pressure"
          unit="cmH₂O"
          bounds={pressureBounds}
          value={query.pressure}
          onChange={(r) => setRange('pressure', r)}
          step={0.5}
          disabled={!availability.pressure}
          disabledReason="Requires pressure data (not available for this set)"
        />
      </section>

      {/* Leak */}
      <section className={styles.section}>
        <RangeFilter
          label="Leak"
          unit="L/min"
          bounds={leakBounds}
          value={query.leak}
          onChange={(r) => setRange('leak', r)}
          step={1}
          disabled={!availability.leak}
          disabledReason="Requires leak data (not available for this set)"
        />
      </section>

      {/* SpO2 */}
      <section className={styles.section}>
        <RangeFilter
          label="SpO₂"
          unit="%"
          bounds={spo2Bounds}
          value={query.spo2}
          onChange={(r) => setRange('spo2', r)}
          step={1}
          disabled={!availability.spo2}
          disabledReason="Requires SpO₂ data (no oximetry in this set)"
        />
      </section>

      {/* Time of night */}
      <section className={styles.section} aria-labelledby="qb-ton">
        <h3 id="qb-ton" className={styles.sectionTitle}>
          Time of night
        </h3>
        <div className={styles.tonRow}>
          <label className={styles.tonLabel}>
            <span className={styles.srOnly}>Window start</span>
            <input
              type="time"
              className={styles.timeInput}
              value={fmtTime(ton?.startMinute ?? 22 * 60)}
              onChange={(e) => {
                const start = parseTimeInput(e.target.value);
                if (start === null) return;
                setTon({ startMinute: start, endMinute: ton?.endMinute ?? 6 * 60 });
              }}
            />
          </label>
          <span aria-hidden="true">–</span>
          <label className={styles.tonLabel}>
            <span className={styles.srOnly}>Window end</span>
            <input
              type="time"
              className={styles.timeInput}
              value={fmtTime(ton?.endMinute ?? 6 * 60)}
              onChange={(e) => {
                const end = parseTimeInput(e.target.value);
                if (end === null) return;
                setTon({ startMinute: ton?.startMinute ?? 22 * 60, endMinute: end });
              }}
            />
          </label>
          {ton ? (
            <button type="button" className={styles.clearBtn} onClick={() => setTon(null)}>
              Clear
            </button>
          ) : (
            <button
              type="button"
              className={styles.clearBtn}
              onClick={() => setTon({ startMinute: 22 * 60, endMinute: 6 * 60 })}
            >
              Enable
            </button>
          )}
        </div>
        <p className={styles.hint}>Wraps past midnight when start is later than end.</p>
      </section>

      {/* Date range */}
      <section className={styles.section} aria-labelledby="qb-daterange">
        <h3 id="qb-daterange" className={styles.sectionTitle}>
          Date range
        </h3>
        <div className={styles.tonRow}>
          <label className={styles.tonLabel}>
            <span className={styles.srOnly}>Date range start</span>
            <input
              type="date"
              className={styles.timeInput}
              value={fmtDate(dr?.start ?? defaultRangeStart)}
              onChange={(e) => {
                const start = parseDateInput(e.target.value);
                if (start === null) return;
                setDateRange({ start, end: dr?.end ?? defaultRangeEnd });
              }}
              aria-label="Date range start"
            />
          </label>
          <span aria-hidden="true">–</span>
          <label className={styles.tonLabel}>
            <span className={styles.srOnly}>Date range end</span>
            <input
              type="date"
              className={styles.timeInput}
              value={fmtDate(dr?.end ?? defaultRangeEnd)}
              onChange={(e) => {
                const end = parseDateInput(e.target.value);
                if (end === null) return;
                // Use end-of-day so the picked date is inclusive.
                setDateRange({ start: dr?.start ?? defaultRangeStart, end: endOfLocalDay(end) });
              }}
              aria-label="Date range end"
            />
          </label>
          {dr ? (
            <button
              type="button"
              className={styles.clearBtn}
              onClick={() => setDateRange(null)}
              aria-label="Clear date-range filter"
            >
              Clear
            </button>
          ) : (
            <button
              type="button"
              className={styles.clearBtn}
              onClick={() => setDateRange({ start: defaultRangeStart, end: defaultRangeEnd })}
              aria-label="Enable date-range filter"
            >
              Enable
            </button>
          )}
        </div>
        <p className={styles.hint}>
          Narrows the matched set within the data already loaded. The global app date range (top of
          the screen) determines which events get loaded here.
        </p>
        {dateRangeInvalid ? (
          <p className={styles.hint} role="alert">
            Start date is after end date.
          </p>
        ) : null}
      </section>

      {/* Saved queries */}
      <section className={styles.section} aria-labelledby="qb-saved">
        <h3 id="qb-saved" className={styles.sectionTitle}>
          Saved queries
        </h3>
        <ul className={styles.savedList}>
          {allExamples.map((ex) => {
            const disabled = ex.requiresField ? !availability[ex.requiresField] : false;
            return (
              <li key={ex.id}>
                <button
                  type="button"
                  className={styles.savedItem}
                  disabled={disabled}
                  title={
                    disabled ? `Requires ${ex.requiresField} data` : 'Apply this example query'
                  }
                  onClick={() => onApplySaved(savedQueryToEventQuery(ex))}
                >
                  {ex.name}
                  <span className={styles.exampleTag}>example</span>
                </button>
              </li>
            );
          })}
          {savedQueries.map((sq) => (
            <li key={sq.id} className={styles.savedRow}>
              <button
                type="button"
                className={styles.savedItem}
                onClick={() => onApplySaved(savedQueryToEventQuery(sq))}
              >
                {sq.name}
              </button>
              <button
                type="button"
                className={styles.deleteBtn}
                aria-label={`Delete saved query ${sq.name}`}
                onClick={() => onDeleteQuery(sq.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <form
          className={styles.saveForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (saveName.trim()) {
              onSaveQuery(saveName.trim());
              setSaveName('');
            }
          }}
        >
          <input
            type="text"
            className={styles.saveInput}
            placeholder="Save current filters as…"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            aria-label="Name for saved query"
          />
          <button type="submit" className={styles.saveBtn} disabled={!saveName.trim()}>
            Save
          </button>
        </form>
      </section>
    </div>
  );
}
