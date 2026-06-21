/**
 * URL ↔ EventQuery serialization for the Event Explorer.
 *
 * Query state is reflected into `URLSearchParams` so views are bookmarkable
 * and the browser back/forward buttons restore prior filter states. The format
 * is compact and human-inspectable. All functions are pure.
 *
 * Search-param keys (all optional):
 * - `types`   comma-separated EventType list, e.g. `ObstructiveApnea,Hypopnea`
 * - `dur`     `min-max` seconds, either side may be blank (`30-` or `-45`)
 * - `prs`     pressure `min-max` cmH₂O
 * - `leak`    leak `min-max` L/min
 * - `spo2`    SpO₂ `min-max` %
 * - `ton`     time-of-night `HHMM-HHMM` (local clock), may wrap midnight
 * - `from`    inclusive date-range start, epoch ms
 * - `to`      inclusive date-range end, epoch ms
 * - `session` comma-separated session id list to scope the Explorer to, e.g.
 *             `session=<uuid>` (links from Session Detail pre-scope to one id)
 * - `view`    active results view id (handled by the view component, not here)
 *
 * @module views/Explore/EventExplorer/querySerialization
 */

import type { EventType } from '@/types/events';
import {
  emptyQuery,
  type EventQuery,
  type NumericRange,
  type TimeOfNightWindow,
} from './queryEngine';

const VALID_EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  'ObstructiveApnea',
  'CentralApnea',
  'MixedApnea',
  'UnclassifiedApnea',
  'Hypopnea',
  'RERA',
  'FlowLimitation',
  'LargeLeak',
  'PeriodicBreathing',
  'ClearAirway',
  'Vibratory',
  'ChecksumError',
]);

// ── Range helpers ────────────────────────────────────────────────

function serializeRange(range: NumericRange): string | null {
  if (range.min === null && range.max === null) return null;
  const lo = range.min === null ? '' : String(range.min);
  const hi = range.max === null ? '' : String(range.max);
  return `${lo}-${hi}`;
}

function parseRange(raw: string | null): NumericRange {
  if (!raw) return { min: null, max: null };
  // Only non-negative ranges are supported — every range filter in the
  // Explorer (duration, pressure, leak, SpO₂) targets a non-negative field.
  // We therefore split on the FIRST hyphen as the min/max delimiter; if you
  // ever add a signed range field, switch to a different separator (e.g.
  // `~` or `..`) instead of trying to disambiguate signs here.
  const idx = raw.indexOf('-');
  if (idx === -1) return { min: null, max: null };
  const loStr = raw.slice(0, idx);
  const hiStr = raw.slice(idx + 1);
  const min = loStr === '' ? null : toFiniteOrNull(loStr);
  const max = hiStr === '' ? null : toFiniteOrNull(hiStr);
  return { min, max };
}

function toFiniteOrNull(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ── Time-of-night helpers ────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function serializeTimeOfNight(window: TimeOfNightWindow): string {
  const fmt = (mins: number): string => `${pad2(Math.floor(mins / 60))}${pad2(mins % 60)}`;
  return `${fmt(window.startMinute)}-${fmt(window.endMinute)}`;
}

function parseHHMM(token: string): number | null {
  if (!/^\d{4}$/.test(token)) return null;
  const h = Number(token.slice(0, 2));
  const m = Number(token.slice(2, 4));
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function parseTimeOfNight(raw: string | null): TimeOfNightWindow | null {
  if (!raw) return null;
  const [a, b] = raw.split('-');
  if (a === undefined || b === undefined) return null;
  const startMinute = parseHHMM(a);
  const endMinute = parseHHMM(b);
  if (startMinute === null || endMinute === null) return null;
  return { startMinute, endMinute };
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Structural equality for two queries.
 *
 * Compares via the URL-serialized representation, which is the canonical
 * shape of a query (the same form used for bookmarks and back/forward
 * navigation). Using a serialized comparison is essential because
 * `EventQuery.types` is a `Set` — `JSON.stringify(new Set(...))` returns
 * `"{}"`, which would treat any two type-only-different queries as equal.
 */
export function queriesEqual(a: EventQuery, b: EventQuery): boolean {
  return serializeForCompare(a) === serializeForCompare(b);
}

function serializeForCompare(query: EventQuery): string {
  const params = queryToSearchParams(query);
  // Sort keys (and the types list within) for a canonical representation
  // independent of insertion order.
  const keys = Object.keys(params).sort();
  return keys
    .map((k) => {
      const v = params[k];
      if ((k === 'types' || k === 'session') && v) {
        // Sort the list so set membership, not insertion order, drives equality.
        return `${k}=${v.split(',').sort().join(',')}`;
      }
      return `${k}=${v ?? ''}`;
    })
    .join('&');
}

/** Serialize a query into a flat record suitable for `URLSearchParams`. */
export function queryToSearchParams(query: EventQuery): Record<string, string> {
  const params: Record<string, string> = {};

  if (query.types.size > 0) {
    params.types = [...query.types].join(',');
  }
  const dur = serializeRange(query.duration);
  if (dur) params.dur = dur;
  const prs = serializeRange(query.pressure);
  if (prs) params.prs = prs;
  const leak = serializeRange(query.leak);
  if (leak) params.leak = leak;
  const spo2 = serializeRange(query.spo2);
  if (spo2) params.spo2 = spo2;
  if (query.timeOfNight) params.ton = serializeTimeOfNight(query.timeOfNight);
  if (query.dateRange) {
    params.from = String(query.dateRange.start);
    params.to = String(query.dateRange.end);
  }
  if (query.sessionIds && query.sessionIds.size > 0) {
    params.session = [...query.sessionIds].join(',');
  }

  return params;
}

/** Parse an `EventQuery` from `URLSearchParams`. Unknown/invalid keys are ignored. */
export function searchParamsToQuery(params: URLSearchParams): EventQuery {
  const base = emptyQuery();

  const typesRaw = params.get('types');
  const types = new Set<EventType>();
  if (typesRaw) {
    for (const t of typesRaw.split(',')) {
      if (VALID_EVENT_TYPES.has(t)) types.add(t as EventType);
    }
  }

  const fromRaw = params.get('from');
  const toRaw = params.get('to');
  const from = fromRaw === null ? null : toFiniteOrNull(fromRaw);
  const to = toRaw === null ? null : toFiniteOrNull(toRaw);
  const dateRange = from !== null && to !== null ? { start: from, end: to } : null;

  const sessionRaw = params.get('session');
  let sessionIds: Set<string> | null = null;
  if (sessionRaw) {
    const ids = new Set<string>();
    for (const id of sessionRaw.split(',')) {
      if (id !== '') ids.add(id);
    }
    sessionIds = ids.size > 0 ? ids : null;
  }

  return {
    ...base,
    types,
    duration: parseRange(params.get('dur')),
    pressure: parseRange(params.get('prs')),
    leak: parseRange(params.get('leak')),
    spo2: parseRange(params.get('spo2')),
    timeOfNight: parseTimeOfNight(params.get('ton')),
    dateRange,
    sessionIds,
  };
}
