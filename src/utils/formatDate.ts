/**
 * Local-time date formatting helpers shared across data hooks, stores, and views.
 *
 * IMPORTANT: All date-range queries against IndexedDB use date keys derived from
 * the user's LOCAL calendar day (year/month/day), not UTC. Using
 * `Date.prototype.toISOString()` here would shift the key by up to a day for
 * users west (or east) of UTC, producing range bounds that no longer match the
 * stored keys. Always format with local getters so the URL, the store, and the
 * DB queries all agree.
 *
 * @module utils/formatDate
 */

/**
 * Format a `Date` as a `YYYY-MM-DD` string using the LOCAL calendar day.
 *
 * @param date - The date to format.
 * @returns The local date as `YYYY-MM-DD`.
 */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse a `YYYY-MM-DD` string into a `Date` at LOCAL midnight.
 *
 * This is the inverse of {@link formatDate}: it constructs the date from the
 * calendar fields so the result round-trips back to the same string under
 * {@link formatDate}. Unlike `new Date('YYYY-MM-DD')` (which parses as UTC
 * midnight), this avoids the off-by-one-day shift for non-UTC users.
 *
 * @param value - A date string in `YYYY-MM-DD` form.
 * @returns The parsed `Date` at local midnight, or `null` if the string is not
 *   a valid `YYYY-MM-DD` date.
 */
export function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Reject out-of-range month/day before constructing (Date would roll over,
  // e.g. 2024-02-31 -> March 2).
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);

  // Guard against rollover (e.g. 2024-02-30 -> March 1).
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}
