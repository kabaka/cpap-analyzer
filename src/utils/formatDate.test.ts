import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatDate, parseLocalDate } from '@/utils/formatDate';

describe('formatDate', () => {
  it('formats a date as YYYY-MM-DD using local calendar fields', () => {
    // Constructed via local fields so the assertion is timezone-independent.
    expect(formatDate(new Date(2025, 0, 5))).toBe('2025-01-05');
    expect(formatDate(new Date(2025, 11, 31))).toBe('2025-12-31');
  });

  it('zero-pads single-digit months and days', () => {
    expect(formatDate(new Date(2025, 8, 9))).toBe('2025-09-09');
  });

  it('uses local time, not UTC, near midnight boundaries', () => {
    // 2025-03-10 00:30 local. Under a UTC formatter, a user west of UTC would
    // see the previous day; formatDate must report the local day.
    const localMidnightish = new Date(2025, 2, 10, 0, 30, 0);
    expect(formatDate(localMidnightish)).toBe('2025-03-10');
  });

  it('round-trips with parseLocalDate', () => {
    const original = '2025-07-21';
    const parsed = parseLocalDate(original);
    expect(parsed).not.toBeNull();
    expect(formatDate(parsed as Date)).toBe(original);
  });
});

describe('parseLocalDate', () => {
  it('parses a valid YYYY-MM-DD to a local-midnight Date', () => {
    const d = parseLocalDate('2025-06-15');
    expect(d).not.toBeNull();
    const date = d as Date;
    expect(date.getFullYear()).toBe(2025);
    expect(date.getMonth()).toBe(5);
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });

  it('returns null for malformed strings', () => {
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate('2025-6-15')).toBeNull();
    expect(parseLocalDate('2025/06/15')).toBeNull();
    expect(parseLocalDate('not-a-date')).toBeNull();
    expect(parseLocalDate('2025-06-15T00:00:00')).toBeNull();
  });

  it('returns null for out-of-range or rolled-over dates', () => {
    expect(parseLocalDate('2025-13-01')).toBeNull();
    expect(parseLocalDate('2025-00-10')).toBeNull();
    expect(parseLocalDate('2025-02-30')).toBeNull();
    expect(parseLocalDate('2025-04-31')).toBeNull();
  });

  it('does not shift the day for users west of UTC (regression for UTC parsing)', () => {
    // Simulate a negative-UTC environment by spying on getTimezoneOffset.
    // new Date('2025-03-10') would be UTC midnight, which is the prior evening
    // locally; parseLocalDate must keep the calendar day intact.
    const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(480); // UTC-8
    try {
      const d = parseLocalDate('2025-03-10');
      expect(d).not.toBeNull();
      expect(formatDate(d as Date)).toBe('2025-03-10');
    } finally {
      spy.mockRestore();
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
