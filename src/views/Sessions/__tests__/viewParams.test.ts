import { describe, it, expect } from 'vitest';

import {
  DEFAULT_METRIC,
  DEFAULT_PAGE_SIZE,
  DEFAULT_VIEW,
  METRIC_PARAM,
  SIZE_PARAM,
  VIEW_PARAM,
  parseMetricParam,
  parseSizeParam,
  parseViewParam,
  type CalendarMetric,
  type PageSize,
  type SessionView,
} from '../viewParams';

/**
 * Contract coverage for the Session List URL-param helpers.
 *
 * Each Session List control (view mode / calendar metric / table page size)
 * lives in the query string, and its DEFAULT is represented by the ABSENCE of
 * its param. These parsers are the single source of truth for "what does
 * `?view=…` / `?metric=…` / `?size=…` mean", so their fallback behavior
 * (missing/invalid → documented default) directly governs deep-link and
 * Back/Forward restoration. These cases pin that contract, mirroring the style
 * of `parsePageParam.test.ts`.
 *
 * The parsers are exact-string matchers (no `.toLowerCase()` / `.trim()`), so
 * case sensitivity and surrounding whitespace are asserted as the ACTUAL
 * behavior, not assumed.
 */
describe('SessionList/viewParams', () => {
  describe('param-key and default constants', () => {
    it('exposes the documented query-string keys', () => {
      expect(VIEW_PARAM).toBe('view');
      expect(METRIC_PARAM).toBe('metric');
      expect(SIZE_PARAM).toBe('size');
    });

    it('exposes the documented defaults (table / ahi / 25)', () => {
      expect(DEFAULT_VIEW).toBe('table');
      expect(DEFAULT_METRIC).toBe('ahi');
      expect(DEFAULT_PAGE_SIZE).toBe(25);
    });

    it('each parser returns its DEFAULT_* constant on null (defaults agree)', () => {
      expect(parseViewParam(null)).toBe(DEFAULT_VIEW);
      expect(parseMetricParam(null)).toBe(DEFAULT_METRIC);
      expect(parseSizeParam(null)).toBe(DEFAULT_PAGE_SIZE);
    });
  });

  describe('parseViewParam', () => {
    it('returns "calendar" for the explicit "calendar" value', () => {
      expect(parseViewParam('calendar')).toBe('calendar');
    });

    it('returns "table" for the explicit "table" value', () => {
      expect(parseViewParam('table')).toBe('table');
    });

    it('defaults to "table" when the param is absent (null)', () => {
      expect(parseViewParam(null)).toBe('table');
    });

    it('defaults to "table" for an empty string', () => {
      expect(parseViewParam('')).toBe('table');
    });

    it('defaults to "table" for an unrecognised value', () => {
      expect(parseViewParam('grid')).toBe('table');
      expect(parseViewParam('chart')).toBe('table');
    });

    it('is case-sensitive: only lowercase "calendar" is honored', () => {
      expect(parseViewParam('Calendar')).toBe('table');
      expect(parseViewParam('CALENDAR')).toBe('table');
    });

    it('does not trim surrounding whitespace', () => {
      expect(parseViewParam(' calendar ')).toBe('table');
    });
  });

  describe('parseMetricParam', () => {
    it('returns "ahi" for the explicit "ahi" value', () => {
      expect(parseMetricParam('ahi')).toBe('ahi');
    });

    it('returns "usage" for the explicit "usage" value', () => {
      expect(parseMetricParam('usage')).toBe('usage');
    });

    it('returns "leak" for the explicit "leak" value', () => {
      expect(parseMetricParam('leak')).toBe('leak');
    });

    it('defaults to "ahi" when the param is absent (null)', () => {
      expect(parseMetricParam(null)).toBe('ahi');
    });

    it('defaults to "ahi" for an empty string', () => {
      expect(parseMetricParam('')).toBe('ahi');
    });

    it('defaults to "ahi" for an unrecognised metric', () => {
      expect(parseMetricParam('pressure')).toBe('ahi');
      expect(parseMetricParam('events')).toBe('ahi');
    });

    it('is case-sensitive: only lowercase metric keys are honored', () => {
      expect(parseMetricParam('Usage')).toBe('ahi');
      expect(parseMetricParam('LEAK')).toBe('ahi');
      expect(parseMetricParam('AHI')).toBe('ahi');
    });

    it('does not trim surrounding whitespace', () => {
      expect(parseMetricParam(' usage')).toBe('ahi');
      expect(parseMetricParam('leak ')).toBe('ahi');
    });
  });

  describe('parseSizeParam', () => {
    it('returns 25 for "25"', () => {
      expect(parseSizeParam('25')).toBe(25);
    });

    it('returns 50 for "50"', () => {
      expect(parseSizeParam('50')).toBe(50);
    });

    it('returns 100 for "100"', () => {
      expect(parseSizeParam('100')).toBe(100);
    });

    it('defaults to 25 when the param is absent (null)', () => {
      expect(parseSizeParam(null)).toBe(25);
    });

    it('defaults to 25 for a numeric value that is not an allowed size', () => {
      expect(parseSizeParam('10')).toBe(25);
      expect(parseSizeParam('75')).toBe(25);
      expect(parseSizeParam('200')).toBe(25);
    });

    it('defaults to 25 for zero and negative values', () => {
      expect(parseSizeParam('0')).toBe(25);
      expect(parseSizeParam('-5')).toBe(25);
    });

    it('defaults to 25 for non-numeric and empty values', () => {
      expect(parseSizeParam('abc')).toBe(25);
      expect(parseSizeParam('')).toBe(25);
      expect(parseSizeParam('  ')).toBe(25);
    });

    // Documents CURRENT behavior: parseSizeParam uses Number.parseInt(value, 10),
    // which (a) trims leading whitespace and (b) stops at the first non-digit.
    // So '50.5', ' 50 ', '50abc', and '050' all parse to the integer 50, which
    // IS an allowed page size and therefore is accepted — they do NOT fall back
    // to the default. This is intentional documentation of the parseInt leniency
    // (matching the sibling parsePageParam behavior), not an endorsement; tighten
    // the parser and these cases change together.
    it('parses the leading integer of a trailing-garbage value ("50abc" → 50)', () => {
      expect(parseSizeParam('50abc')).toBe(50);
    });

    it('accepts a fractional string by its integer part ("50.5" → 50)', () => {
      expect(parseSizeParam('50.5')).toBe(50);
    });

    it('accepts a whitespace-padded valid size (" 50 " → 50)', () => {
      expect(parseSizeParam(' 50 ')).toBe(50);
    });

    it('accepts a zero-padded valid size ("050" → 50)', () => {
      expect(parseSizeParam('050')).toBe(50);
    });
  });

  // Type-level guards: keep the unions honest if someone edits viewParams.ts.
  describe('exported types stay in sync with parsers', () => {
    it('parser return values are assignable to their exported union types', () => {
      const v: SessionView = parseViewParam('calendar');
      const m: CalendarMetric = parseMetricParam('usage');
      const s: PageSize = parseSizeParam('50');
      expect(v).toBe('calendar');
      expect(m).toBe('usage');
      expect(s).toBe(50);
    });
  });
});
