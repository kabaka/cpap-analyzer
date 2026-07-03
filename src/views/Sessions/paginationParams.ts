/**
 * URL query-string helpers for Session List pagination.
 *
 * The current page lives in the URL (`?page=N`) rather than React state so that
 * browser Back/Forward restores it after the user opens a session detail and
 * returns. These helpers are kept in their own module (separate from the
 * `SessionList` component) so they can be unit-tested directly and so the
 * component file only exports components (Fast Refresh friendliness).
 *
 * @module views/Sessions/paginationParams
 */

/** The query-string key under which the active page number is stored. */
export const PAGE_PARAM = 'page';

/**
 * Parse the `page` query parameter into a 1-based page number, falling back to
 * page 1 when the param is missing or invalid (non-numeric or < 1).
 */
export function parsePageParam(value: string | null): number {
  if (value == null) return 1;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}
