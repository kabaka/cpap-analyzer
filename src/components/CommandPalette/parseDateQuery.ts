/**
 * Date recogniser for the ⌘K command palette's session date-jump (spec B5).
 *
 * Recognises `YYYY-MM-DD` plus a handful of reasonable natural date forms and
 * normalises them to a canonical local `YYYY-MM-DD` string, which the palette
 * feeds to a date-indexed session lookup. Pure and locale-light: numeric
 * slash/dot forms are read month-first (US), matching the app's `Jul 5` short
 * date convention. Anything ambiguous or out-of-range returns `null` rather
 * than guessing.
 *
 * @module components/CommandPalette/parseDateQuery
 */

import { parseLocalDate } from '@/utils/formatDate';

/** Three-letter month prefixes, index 0 = January. */
const MONTH_PREFIXES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

/** Resolve a written month name/abbreviation to its 1-based number, or null. */
function monthFromName(name: string): number | null {
  const index = MONTH_PREFIXES.indexOf(name.slice(0, 3).toLowerCase());
  return index === -1 ? null : index + 1;
}

/**
 * Build a validated `YYYY-MM-DD` string, or `null` if the calendar date is
 * invalid. Validation (range + rollover) is delegated to `parseLocalDate`, the
 * same guard used across the app, so behaviour stays consistent.
 */
function toIso(year: number, month: number, day: number): string | null {
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
    day,
  ).padStart(2, '0')}`;
  return parseLocalDate(iso) ? iso : null;
}

/** Expand a 1–2 digit year to 20xx; pass 4-digit years through unchanged. */
function normaliseYear(raw: string | undefined, fallbackYear: number): number {
  if (raw === undefined) return fallbackYear;
  return raw.length <= 2 ? 2000 + Number(raw) : Number(raw);
}

/**
 * Parse a query string into a canonical local `YYYY-MM-DD`, or `null` if the
 * query is not a recognised date.
 *
 * Recognised forms:
 * - ISO: `2026-07-04` (also single-digit month/day: `2026-7-4`)
 * - Year-first numeric: `2026/07/04`, `2026.07.04`
 * - US numeric (month-first): `7/4`, `07/04/2026`, `7/4/26` (year defaults to
 *   `today`'s year when omitted)
 * - Month name first: `Jul 4`, `July 4, 2026`, `Jul 4 2026`
 * - Day first: `4 Jul`, `4 July 2026`
 *
 * @param query - The raw palette query.
 * @param today - Reference date for the implied year (injectable for tests).
 */
export function parseDateQuery(query: string, today: Date = new Date()): string | null {
  const q = query.trim();
  if (q === '') return null;
  const fallbackYear = today.getFullYear();

  // ISO 8601 (and lenient single-digit variants).
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(q);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Year-first numeric with / or . separators.
  const yearFirst = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(q);
  if (yearFirst) return toIso(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));

  // US numeric, month-first: M/D or M/D/YY(YY).
  const usNumeric = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(q);
  if (usNumeric) {
    return toIso(
      normaliseYear(usNumeric[3], fallbackYear),
      Number(usNumeric[1]),
      Number(usNumeric[2]),
    );
  }

  // Month name first: "Jul 4", "July 4, 2026".
  const monthFirst = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i.exec(q);
  if (monthFirst) {
    const monthName = monthFirst[1];
    const month = monthName ? monthFromName(monthName) : null;
    if (month) {
      return toIso(
        monthFirst[3] ? Number(monthFirst[3]) : fallbackYear,
        month,
        Number(monthFirst[2]),
      );
    }
  }

  // Day first: "4 Jul", "4 July 2026".
  const dayFirst = /^(\d{1,2})\s+([a-z]{3,9})\.?(?:,?\s+(\d{4}))?$/i.exec(q);
  if (dayFirst) {
    const monthName = dayFirst[2];
    const month = monthName ? monthFromName(monthName) : null;
    if (month) {
      return toIso(dayFirst[3] ? Number(dayFirst[3]) : fallbackYear, month, Number(dayFirst[1]));
    }
  }

  return null;
}
