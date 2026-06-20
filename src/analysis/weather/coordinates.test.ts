import { describe, it, expect } from 'vitest';

import {
  roundCoordinate,
  COORDINATE_DECIMAL_PLACES,
  ARCHIVE_LAG_DAYS,
  selectWeatherEndpoint,
  subtractDaysIso,
} from './coordinates';

describe('weather/coordinates — roundCoordinate', () => {
  it('rounds to exactly 2 decimal places', () => {
    expect(roundCoordinate(51.50735)).toBeCloseTo(51.51, 10);
    expect(roundCoordinate(-0.12758)).toBeCloseTo(-0.13, 10);
    expect(roundCoordinate(40.712776)).toBeCloseTo(40.71, 10);
    expect(roundCoordinate(139.6917)).toBeCloseTo(139.69, 10);
  });

  it('never keeps more than 2 decimals of precision', () => {
    // The rounded value times 100 must be (nearly) an integer.
    for (const v of [51.50735, -33.86882, 139.69171, -0.00001]) {
      const scaled = roundCoordinate(v) * 100;
      expect(Math.abs(scaled - Math.round(scaled))).toBeLessThan(1e-9);
    }
  });

  it('rounds half symmetrically about zero (sign never skews the result)', () => {
    // The rounding acts on the IEEE-754 double, not the typed decimal, but it
    // MUST treat +x and -x identically. `0.005` is stored just ABOVE the
    // half-way point, so it rounds up to 0.01 — and -0.005 rounds to -0.01.
    expect(roundCoordinate(0.005)).toBeCloseTo(0.01, 10);
    expect(roundCoordinate(-0.005)).toBeCloseTo(-0.01, 10);
    expect(roundCoordinate(0.005)).toBeCloseTo(-roundCoordinate(-0.005), 12);

    // `1.005` is stored just BELOW the half-way point, so round-to-nearest-double
    // correctly yields 1.00 — and -1.005 yields -1.00. Symmetric either way.
    expect(roundCoordinate(1.005)).toBeCloseTo(1.0, 10);
    expect(roundCoordinate(-1.005)).toBeCloseTo(-1.0, 10);
    expect(roundCoordinate(1.005)).toBeCloseTo(-roundCoordinate(-1.005), 12);

    // A value unambiguously above the boundary rounds up regardless of sign.
    expect(roundCoordinate(2.006)).toBeCloseTo(2.01, 10);
    expect(roundCoordinate(-2.006)).toBeCloseTo(-2.01, 10);
  });

  it('handles negative coordinates', () => {
    expect(roundCoordinate(-122.41942)).toBeCloseTo(-122.42, 10);
    expect(roundCoordinate(-0.004)).toBeCloseTo(0, 10);
  });

  it('normalizes -0 to 0', () => {
    expect(Object.is(roundCoordinate(-0.0001), 0)).toBe(true);
    expect(Object.is(roundCoordinate(-0), 0)).toBe(true);
  });

  it('passes non-finite values through unchanged', () => {
    expect(roundCoordinate(Number.NaN)).toBeNaN();
    expect(roundCoordinate(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(roundCoordinate(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('exposes the precision constant', () => {
    expect(COORDINATE_DECIMAL_PLACES).toBe(2);
  });
});

describe('weather/coordinates — subtractDaysIso', () => {
  it('subtracts whole days and zero-pads', () => {
    expect(subtractDaysIso('2026-06-20', 5)).toBe('2026-06-15');
    expect(subtractDaysIso('2026-06-20', 0)).toBe('2026-06-20');
    expect(subtractDaysIso('2026-03-03', 5)).toBe('2026-02-26'); // leap year
    expect(subtractDaysIso('2025-03-03', 5)).toBe('2025-02-26'); // non-leap
  });

  it('crosses month and year boundaries', () => {
    expect(subtractDaysIso('2026-01-03', 5)).toBe('2025-12-29');
  });
});

describe('weather/coordinates — selectWeatherEndpoint', () => {
  it('uses ARCHIVE when date ≤ today − 5 days', () => {
    const today = '2026-06-20';
    // cutover = 2026-06-15
    expect(selectWeatherEndpoint('2026-06-15', today)).toBe('archive');
    expect(selectWeatherEndpoint('2026-06-10', today)).toBe('archive');
    expect(selectWeatherEndpoint('2020-01-01', today)).toBe('archive');
  });

  it('uses FORECAST for dates within the lag window', () => {
    const today = '2026-06-20';
    expect(selectWeatherEndpoint('2026-06-16', today)).toBe('forecast');
    expect(selectWeatherEndpoint('2026-06-20', today)).toBe('forecast');
  });

  it('boundary date (today − 5) routes to archive (inclusive)', () => {
    expect(selectWeatherEndpoint('2026-06-15', '2026-06-20')).toBe('archive');
    expect(selectWeatherEndpoint('2026-06-16', '2026-06-20')).toBe('forecast');
  });

  it('exposes the archive lag constant', () => {
    expect(ARCHIVE_LAG_DAYS).toBe(5);
  });
});
