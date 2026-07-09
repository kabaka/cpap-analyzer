import { describe, it, expect } from 'vitest';
import { parseDateQuery } from './parseDateQuery';

// Fixed reference "today" so the implied-year forms are deterministic. Only the
// YEAR is read from this date (parseDateQuery uses `today.getFullYear()` as the
// fallback year), so any 2026 date works here.
const TODAY = new Date(2026, 0, 1);

describe('parseDateQuery', () => {
  // Every recognised spelling of "July 4th, 2026" normalises to the SAME
  // canonical local-ISO string — the value the palette feeds to the
  // date-indexed session lookup. A mis-parse would jump to the wrong night.
  describe('recognised date forms → canonical local YYYY-MM-DD', () => {
    it.each([
      { query: '2026-07-04', expected: '2026-07-04' }, // ISO 8601
      { query: '2026-7-4', expected: '2026-07-04' }, // ISO, single-digit month/day
      { query: '2026/07/04', expected: '2026-07-04' }, // year-first, slash
      { query: '2026.07.04', expected: '2026-07-04' }, // year-first, dot
      { query: '7/4', expected: '2026-07-04' }, // US month-first, implied year
      { query: '07/04/2026', expected: '2026-07-04' }, // US month-first, 4-digit year
      { query: '7/4/26', expected: '2026-07-04' }, // US month-first, 2-digit year → 20xx
      { query: 'Jul 4', expected: '2026-07-04' }, // month abbrev + day, implied year
      { query: 'July 4, 2026', expected: '2026-07-04' }, // full month + day, comma + year
      { query: 'Jul 4 2026', expected: '2026-07-04' }, // month + day + year, no comma
      { query: '4 Jul', expected: '2026-07-04' }, // day-first abbrev, implied year
      { query: '4 July 2026', expected: '2026-07-04' }, // day-first, full month + year
    ])('"$query" → $expected', ({ query, expected }) => {
      expect(parseDateQuery(query, TODAY)).toBe(expected);
    });

    it('trims surrounding whitespace before parsing', () => {
      expect(parseDateQuery('  2026-07-04  ', TODAY)).toBe('2026-07-04');
    });
  });

  // Anything ambiguous, out-of-range, or unrecognised returns null rather than
  // guessing — the palette then shows "no session on that date" instead of
  // silently navigating somewhere wrong.
  describe('invalid or out-of-range input → null', () => {
    it.each([
      { query: '2026-02-30' }, // calendar rollover (Feb has 28/29 days)
      { query: '2026-13-01' }, // month 13
      { query: '2026-00-10' }, // month 00
      { query: '13/40' }, // US numeric, month + day both out of range
      { query: 'Foo 4' }, // unknown month name
      { query: 'not-a-date' }, // pure garbage
      { query: '' }, // empty
      { query: '   ' }, // whitespace only (trims to empty)
    ])('"$query" → null', ({ query }) => {
      expect(parseDateQuery(query, TODAY)).toBeNull();
    });
  });
});
