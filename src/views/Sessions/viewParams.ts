/**
 * URL query-string helpers for the Session List view mode, calendar metric, and
 * page size.
 *
 * These mirror the pattern established by {@link module:views/Sessions/paginationParams}:
 * the relevant view state lives in the URL (so browser Back/Forward and deep
 * links restore it) and the DEFAULT for each control is represented by the
 * ABSENCE of its param (keeping URLs clean). The helpers are kept in their own
 * module — separate from the `SessionList` component — so they can be
 * unit-tested directly and so the component file only exports components (Fast
 * Refresh friendliness).
 *
 * @module views/Sessions/viewParams
 */

/** The query-string key under which the active view (`table` | `calendar`) is stored. */
export const VIEW_PARAM = 'view';

/** The query-string key under which the calendar metric (`ahi` | `usage` | `leak`) is stored. */
export const METRIC_PARAM = 'metric';

/** The query-string key under which the table page size (`25` | `50` | `100`) is stored. */
export const SIZE_PARAM = 'size';

/** The two Session List view modes. `table` is the default. */
export type SessionView = 'table' | 'calendar';

/** The selectable calendar metrics. `ahi` is the default. */
export type CalendarMetric = 'ahi' | 'usage' | 'leak';

/** The allowed table page sizes. `25` is the default; there is no "All". */
export type PageSize = 25 | 50 | 100;

/** The default view when the `view` param is missing or unrecognised. */
export const DEFAULT_VIEW: SessionView = 'table';

/** The default calendar metric when the `metric` param is missing or unrecognised. */
export const DEFAULT_METRIC: CalendarMetric = 'ahi';

/** The default page size when the `size` param is missing or unrecognised. */
export const DEFAULT_PAGE_SIZE: PageSize = 25;

/** The set of valid page-size values, used to validate the `size` param. */
const VALID_PAGE_SIZES: readonly PageSize[] = [25, 50, 100];

/**
 * Parse the `view` query parameter into a {@link SessionView}, falling back to
 * `table` when the param is missing or is anything other than `calendar`.
 */
export function parseViewParam(value: string | null): SessionView {
  return value === 'calendar' ? 'calendar' : DEFAULT_VIEW;
}

/**
 * Parse the `metric` query parameter into a {@link CalendarMetric}, falling back
 * to `ahi` when the param is missing or not one of the known metric keys.
 */
export function parseMetricParam(value: string | null): CalendarMetric {
  if (value === 'usage' || value === 'leak') return value;
  return DEFAULT_METRIC;
}

/**
 * Parse the `size` query parameter into a {@link PageSize}, clamping any missing
 * or invalid value (non-numeric, or not one of 25/50/100) back to the default
 * of 25. There is intentionally no "All" option — large datasets are paginated.
 */
export function parseSizeParam(value: string | null): PageSize {
  if (value == null) return DEFAULT_PAGE_SIZE;
  const parsed = Number.parseInt(value, 10);
  return (VALID_PAGE_SIZES as readonly number[]).includes(parsed)
    ? (parsed as PageSize)
    : DEFAULT_PAGE_SIZE;
}
