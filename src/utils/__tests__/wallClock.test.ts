/**
 * Tests for the wall-clock-as-UTC timestamp parser.
 *
 * @module utils/__tests__/wallClock.test
 */

import { describe, it, expect } from 'vitest';
import { localIsoToWallClockEpoch } from '@/utils/wallClock';

describe('localIsoToWallClockEpoch', () => {
  it('parses a basic local ISO timestamp as wall-clock-as-UTC', () => {
    // Components fed directly to Date.UTC — no timezone shift.
    expect(localIsoToWallClockEpoch('2024-01-15T23:30:00')).toBe(
      Date.UTC(2024, 0, 15, 23, 30, 0, 0),
    );
  });

  it('accepts a space separator between date and time', () => {
    expect(localIsoToWallClockEpoch('2024-06-20 07:05:09')).toBe(Date.UTC(2024, 5, 20, 7, 5, 9, 0));
  });

  it('parses fractional seconds, padding to milliseconds', () => {
    expect(localIsoToWallClockEpoch('2024-03-01T00:00:00.5')).toBe(
      Date.UTC(2024, 2, 1, 0, 0, 0, 500),
    );
    expect(localIsoToWallClockEpoch('2024-03-01T00:00:00.05')).toBe(
      Date.UTC(2024, 2, 1, 0, 0, 0, 50),
    );
    expect(localIsoToWallClockEpoch('2024-03-01T00:00:00.123')).toBe(
      Date.UTC(2024, 2, 1, 0, 0, 0, 123),
    );
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(localIsoToWallClockEpoch('  2024-01-15T23:30:00  ')).toBe(
      Date.UTC(2024, 0, 15, 23, 30, 0, 0),
    );
  });

  it('ignores any trailing content after the seconds (timezone suffix not applied)', () => {
    expect(localIsoToWallClockEpoch('2024-01-15T23:30:00Z')).toBe(Date.UTC(2024, 0, 15, 23, 30, 0));
    expect(localIsoToWallClockEpoch('2024-01-15T23:30:00+05:00')).toBe(
      Date.UTC(2024, 0, 15, 23, 30, 0),
    );
  });

  it('is timezone-independent (depends only on Date.UTC, not the host TZ)', () => {
    // Equivalent to the documented invariant: identical input → identical epoch.
    const a = localIsoToWallClockEpoch('2024-12-31T12:00:00');
    const b = localIsoToWallClockEpoch('2024-12-31T12:00:00');
    expect(a).toBe(b);
    expect(a).toBe(Date.UTC(2024, 11, 31, 12, 0, 0));
  });

  it('returns NaN for unparseable input', () => {
    expect(localIsoToWallClockEpoch('')).toBeNaN();
    expect(localIsoToWallClockEpoch('not-a-date')).toBeNaN();
    expect(localIsoToWallClockEpoch('2024-01-15')).toBeNaN();
    expect(localIsoToWallClockEpoch('2024/01/15 23:30:00')).toBeNaN();
    expect(localIsoToWallClockEpoch('15-01-2024T23:30:00')).toBeNaN();
  });
});
