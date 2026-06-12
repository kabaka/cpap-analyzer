/**
 * Named saved queries for the Event Explorer (localStorage-backed).
 *
 * Users can persist filter combinations under a name and recall them later.
 * The app ships a few example queries to demonstrate the tool; examples that
 * depend on data the user may not have (e.g. SpO₂) are flagged so the UI can
 * disable them. Saved queries are stored as the URL-serialized search-param
 * record (see {@link querySerialization}) for forward compatibility.
 *
 * Privacy: this stays entirely in the browser. No query, name, or event ever
 * leaves the device.
 *
 * @module views/Explore/EventExplorer/savedQueries
 */

import type { EventQuery } from './queryEngine';
import { queryToSearchParams, searchParamsToQuery } from './querySerialization';

/** localStorage key under which the saved-query list is persisted. */
export const SAVED_QUERIES_STORAGE_KEY = 'cpap.eventExplorer.savedQueries.v1';

/** A persisted, named query. */
export interface SavedQuery {
  /** Stable id (uuid-ish; example queries use a fixed `example:` prefix). */
  readonly id: string;
  /** User-facing name. */
  readonly name: string;
  /** URL-serialized query (param record). */
  readonly params: Record<string, string>;
  /**
   * Field this query depends on, if any. The UI disables the entry (with an
   * explanatory hint) when the field is unavailable in the loaded data.
   */
  readonly requiresField?: 'pressure' | 'leak' | 'spo2';
  /** True for shipped examples (not user-deletable from the saved list). */
  readonly example?: boolean;
}

/** Built-in example queries demonstrating the explorer's power. */
export const EXAMPLE_QUERIES: readonly SavedQuery[] = [
  {
    id: 'example:long-obstructive',
    name: 'Long obstructive events ≥30s',
    params: { types: 'ObstructiveApnea', dur: '30-' },
    example: true,
  },
  {
    id: 'example:clear-airway',
    name: 'Clear-airway (central) events',
    params: { types: 'ClearAirway,CentralApnea' },
    example: true,
  },
  {
    id: 'example:rem-window',
    name: 'Events in the early-morning window (03:00–06:00)',
    params: { ton: '0300-0600' },
    example: true,
  },
  {
    id: 'example:low-spo2',
    name: 'Events during low SpO₂ (<88%)',
    params: { spo2: '-88' },
    requiresField: 'spo2',
    example: true,
  },
];

/** Convert a {@link SavedQuery} into a usable {@link EventQuery}. */
export function savedQueryToEventQuery(saved: SavedQuery): EventQuery {
  return searchParamsToQuery(new URLSearchParams(saved.params));
}

/** Load user-saved queries from localStorage (examples are not stored here). */
export function loadSavedQueries(storage: Storage = localStorage): SavedQuery[] {
  try {
    const raw = storage.getItem(SAVED_QUERIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedQuery);
  } catch {
    return [];
  }
}

/** Persist the user-saved query list to localStorage. */
export function persistSavedQueries(
  queries: readonly SavedQuery[],
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(SAVED_QUERIES_STORAGE_KEY, JSON.stringify(queries));
  } catch {
    // Quota or unavailable storage — fail silently; saved queries are a convenience.
  }
}

/** Create a persistable SavedQuery from a live query + name. */
export function createSavedQuery(name: string, query: EventQuery): SavedQuery {
  return {
    id: `q:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    params: queryToSearchParams(query),
  };
}

const REQUIRES_FIELD_VALUES = ['pressure', 'leak', 'spo2'] as const;
type RequiresField = (typeof REQUIRES_FIELD_VALUES)[number];

function isRequiresField(value: unknown): value is RequiresField {
  return typeof value === 'string' && (REQUIRES_FIELD_VALUES as readonly string[]).includes(value);
}

/**
 * `params` is a string→string record (the URL-serialized query). Accept only
 * plain objects whose own enumerable values are all strings — defensively
 * refuse arrays, prototype-poisoned shapes, and JSON like `{params: 5}` or
 * `{params: {types: 12}}` that would otherwise sneak past the legacy
 * `typeof === 'object'` check and crash downstream consumers that assume
 * strings.
 */
function isParamRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  // Reject anything that isn't a plain object literal — class instances, Maps,
  // etc. (`Object.getPrototypeOf(null)` returns null too, hence the dual check).
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v !== 'string') return false;
  }
  return true;
}

function isSavedQuery(value: unknown): value is SavedQuery {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.name !== 'string') return false;
  if (!isParamRecord(v.params)) return false;
  // Optional fields: validate only if present so malformed blobs are refused
  // cleanly rather than producing a SavedQuery whose `requiresField` is any
  // arbitrary string (which would mis-disable example queries in the UI).
  if (v.requiresField !== undefined && !isRequiresField(v.requiresField)) return false;
  if (v.example !== undefined && typeof v.example !== 'boolean') return false;
  return true;
}
