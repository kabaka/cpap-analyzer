import { describe, it, expect } from 'vitest';

import type { WeatherHourlySample, AirQualityHourlySample } from '@/types/weather';

import {
  parseWallClockMs,
  mergeHourlySamples,
  selectOvernightSamples,
  aggregateWeatherNight,
  aggregateAirQualityNight,
  toAirQualityDaily,
  type OvernightWindow,
} from './aggregation';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** Build a weather hourly sample with sensible defaults overridden by `over`. */
function wx(time: string, over: Partial<WeatherHourlySample> = {}): WeatherHourlySample {
  return {
    time,
    temperature2m: null,
    relativeHumidity2m: null,
    dewpoint2m: null,
    surfacePressure: null,
    pressureMsl: null,
    precipitation: null,
    windspeed10m: null,
    cloudcover: null,
    weathercode: null,
    ...over,
  };
}

function aq(time: string, over: Partial<AirQualityHourlySample> = {}): AirQualityHourlySample {
  return {
    time,
    pm25: null,
    pm10: null,
    ozone: null,
    nitrogenDioxide: null,
    usAqi: null,
    europeanAqi: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// parseWallClockMs
// ---------------------------------------------------------------------------

describe('weather/aggregation — parseWallClockMs', () => {
  it('parses ISO without offset as wall-clock-as-UTC', () => {
    expect(parseWallClockMs('2026-01-15T03:00')).toBe(Date.UTC(2026, 0, 15, 3, 0));
    expect(parseWallClockMs('2026-01-15T03:00:30')).toBe(Date.UTC(2026, 0, 15, 3, 0, 30));
  });

  it('ignores a trailing Z / offset (keeps wall-clock fields)', () => {
    expect(parseWallClockMs('2026-01-15T03:00Z')).toBe(Date.UTC(2026, 0, 15, 3, 0));
    expect(parseWallClockMs('2026-01-15T03:00+05:00')).toBe(Date.UTC(2026, 0, 15, 3, 0));
  });

  it('preserves ordering and difference for same-zone times', () => {
    const a = parseWallClockMs('2026-01-15T23:00');
    const b = parseWallClockMs('2026-01-16T01:00');
    expect(b - a).toBe(2 * 3600 * 1000);
  });

  it('returns NaN for unparseable input', () => {
    expect(parseWallClockMs('not-a-date')).toBeNaN();
    expect(parseWallClockMs('')).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// selectOvernightSamples — half-open window
// ---------------------------------------------------------------------------

describe('weather/aggregation — selectOvernightSamples', () => {
  const samples = [
    wx('2026-01-15T22:00'),
    wx('2026-01-15T23:00'),
    wx('2026-01-16T00:00'),
    wx('2026-01-16T01:00'),
    wx('2026-01-16T02:00'),
  ];

  it('includes the start hour and excludes the end hour (half-open)', () => {
    const window: OvernightWindow = {
      start: '2026-01-15T23:00',
      end: '2026-01-16T02:00',
    };
    const picked = selectOvernightSamples(samples, window).map((s) => s.time);
    expect(picked).toEqual(['2026-01-15T23:00', '2026-01-16T00:00', '2026-01-16T01:00']);
  });

  it('selects hours across the midnight boundary', () => {
    const window: OvernightWindow = {
      start: '2026-01-15T22:00',
      end: '2026-01-16T03:00',
    };
    expect(selectOvernightSamples(samples, window)).toHaveLength(5);
  });

  it('returns empty when window bounds are unparseable', () => {
    expect(selectOvernightSamples(samples, { start: 'x', end: 'y' })).toEqual([]);
  });

  it('drops samples with unparseable timestamps', () => {
    const mixed = [...samples, wx('garbage')];
    const window: OvernightWindow = { start: '2026-01-15T22:00', end: '2026-01-16T03:00' };
    expect(selectOvernightSamples(mixed, window)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// mergeHourlySamples — two-civil-date nights
// ---------------------------------------------------------------------------

describe('weather/aggregation — mergeHourlySamples', () => {
  it('merges two civil dates into one ascending series', () => {
    const eve = [wx('2026-01-15T23:00'), wx('2026-01-15T22:00')];
    const morn = [wx('2026-01-16T01:00'), wx('2026-01-16T00:00')];
    const merged = mergeHourlySamples(eve, morn).map((s) => s.time);
    expect(merged).toEqual([
      '2026-01-15T22:00',
      '2026-01-15T23:00',
      '2026-01-16T00:00',
      '2026-01-16T01:00',
    ]);
  });

  it('de-duplicates by timestamp (first occurrence wins)', () => {
    const a = [wx('2026-01-16T00:00', { temperature2m: 1 })];
    const b = [wx('2026-01-16T00:00', { temperature2m: 99 })];
    const merged = mergeHourlySamples(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.temperature2m).toBe(1);
  });

  it('tolerates undefined/null sample sets', () => {
    const merged = mergeHourlySamples(undefined, [wx('2026-01-16T00:00')], null);
    expect(merged).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// aggregateWeatherNight — statistics + missing data
// ---------------------------------------------------------------------------

describe('weather/aggregation — aggregateWeatherNight', () => {
  const window: OvernightWindow = { start: '2026-01-15T23:00', end: '2026-01-16T03:00' };

  it('computes the canonical per-metric statistics over a two-date night', () => {
    // 4 in-window hours: 23:00, 00:00, 01:00, 02:00. The 03:00 hour is excluded.
    const merged = mergeHourlySamples([
      wx('2026-01-15T23:00', {
        temperature2m: 8,
        relativeHumidity2m: 80,
        dewpoint2m: 5,
        pressureMsl: 1010,
        surfacePressure: 1005,
        precipitation: 0.2,
        windspeed10m: 10,
        cloudcover: 50,
      }),
      wx('2026-01-16T00:00', {
        temperature2m: 6,
        relativeHumidity2m: 84,
        dewpoint2m: 4,
        pressureMsl: 1012,
        surfacePressure: 1007,
        precipitation: 0,
        windspeed10m: 14,
        cloudcover: 60,
      }),
      wx('2026-01-16T01:00', {
        temperature2m: 4,
        relativeHumidity2m: 88,
        dewpoint2m: 3,
        pressureMsl: 1014,
        surfacePressure: 1009,
        precipitation: 0.6,
        windspeed10m: 12,
        cloudcover: 70,
      }),
      wx('2026-01-16T02:00', {
        temperature2m: 5,
        relativeHumidity2m: 88,
        dewpoint2m: 4,
        pressureMsl: 1016,
        surfacePressure: 1011,
        precipitation: 0,
        windspeed10m: 8,
        cloudcover: 80,
      }),
      // Out of window (== end): must be excluded by the half-open rule.
      wx('2026-01-16T03:00', { temperature2m: -100, windspeed10m: 999 }),
    ]);

    const agg = aggregateWeatherNight(merged, window);

    expect(agg.hourCount).toBe(4);
    expect(agg.temperatureLow).toBe(4); // min(8,6,4,5)
    expect(agg.temperatureMean).toBeCloseTo((8 + 6 + 4 + 5) / 4, 10);
    expect(agg.humidityMean).toBeCloseTo((80 + 84 + 88 + 88) / 4, 10);
    expect(agg.dewpointMean).toBeCloseTo((5 + 4 + 3 + 4) / 4, 10);
    expect(agg.pressureMslMean).toBeCloseTo((1010 + 1012 + 1014 + 1016) / 4, 10);
    expect(agg.surfacePressureMean).toBeCloseTo((1005 + 1007 + 1009 + 1011) / 4, 10);
    expect(agg.precipitationSum).toBeCloseTo(0.8, 10); // 0.2 + 0 + 0.6 + 0
    expect(agg.windMean).toBeCloseTo((10 + 14 + 12 + 8) / 4, 10);
    expect(agg.windMax).toBe(14);
    expect(agg.cloudcoverMean).toBeCloseTo((50 + 60 + 70 + 80) / 4, 10);
  });

  it('skips null/non-finite hours per metric without fabricating values', () => {
    const merged = [
      wx('2026-01-15T23:00', { temperature2m: 10, precipitation: null, windspeed10m: 5 }),
      wx('2026-01-16T00:00', { temperature2m: null, precipitation: 1.5, windspeed10m: null }),
      wx('2026-01-16T01:00', { temperature2m: 6, precipitation: null, windspeed10m: 9 }),
    ];
    const agg = aggregateWeatherNight(merged, window);
    expect(agg.temperatureLow).toBe(6); // min over the two finite temps
    expect(agg.temperatureMean).toBeCloseTo(8, 10);
    expect(agg.precipitationSum).toBeCloseTo(1.5, 10); // only the one finite hour
    expect(agg.windMean).toBeCloseTo(7, 10);
    expect(agg.windMax).toBe(9);
  });

  it('returns null (not 0) for every metric when no hours are in window', () => {
    const merged = [wx('2026-01-20T23:00', { temperature2m: 5, precipitation: 3 })];
    const agg = aggregateWeatherNight(merged, window);
    expect(agg.hourCount).toBe(0);
    expect(agg.temperatureLow).toBeNull();
    expect(agg.temperatureMean).toBeNull();
    expect(agg.humidityMean).toBeNull();
    expect(agg.precipitationSum).toBeNull(); // critically NOT 0
    expect(agg.windMean).toBeNull();
    expect(agg.windMax).toBeNull();
  });

  it('distinguishes precipitation null (no data) from 0 (dry night)', () => {
    const dry = [
      wx('2026-01-15T23:00', { precipitation: 0 }),
      wx('2026-01-16T00:00', { precipitation: 0 }),
    ];
    const noData = [
      wx('2026-01-15T23:00', { precipitation: null }),
      wx('2026-01-16T00:00', { precipitation: null }),
    ];
    expect(aggregateWeatherNight(dry, window).precipitationSum).toBe(0);
    expect(aggregateWeatherNight(noData, window).precipitationSum).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// aggregateAirQualityNight + toAirQualityDaily
// ---------------------------------------------------------------------------

describe('weather/aggregation — aggregateAirQualityNight', () => {
  const window: OvernightWindow = { start: '2026-01-15T23:00', end: '2026-01-16T02:00' };

  it('computes mean and max for AQI/PM and mean for ozone/NO2', () => {
    const merged = [
      aq('2026-01-15T23:00', {
        pm25: 10,
        pm10: 20,
        ozone: 40,
        nitrogenDioxide: 12,
        usAqi: 42,
        europeanAqi: 18,
      }),
      aq('2026-01-16T00:00', {
        pm25: 30,
        pm10: 40,
        ozone: 60,
        nitrogenDioxide: 18,
        usAqi: 88,
        europeanAqi: 35,
      }),
      aq('2026-01-16T01:00', {
        pm25: 20,
        pm10: 30,
        ozone: 50,
        nitrogenDioxide: 15,
        usAqi: 60,
        europeanAqi: 26,
      }),
      // excluded (== end)
      aq('2026-01-16T02:00', { pm25: 999, usAqi: 999 }),
    ];

    const agg = aggregateAirQualityNight(merged, window);
    expect(agg.hourCount).toBe(3);
    expect(agg.pm25Mean).toBeCloseTo((10 + 30 + 20) / 3, 10);
    expect(agg.pm25Max).toBe(30);
    expect(agg.pm10Mean).toBeCloseTo((20 + 40 + 30) / 3, 10);
    expect(agg.pm10Max).toBe(40);
    expect(agg.ozoneMean).toBeCloseTo((40 + 60 + 50) / 3, 10);
    expect(agg.nitrogenDioxideMean).toBeCloseTo((12 + 18 + 15) / 3, 10);
    expect(agg.usAqiMean).toBeCloseTo((42 + 88 + 60) / 3, 10);
    expect(agg.usAqiMax).toBe(88);
    expect(agg.europeanAqiMean).toBeCloseTo((18 + 35 + 26) / 3, 10);
    expect(agg.europeanAqiMax).toBe(35);
  });

  it('yields all-null when no hours are in window', () => {
    const agg = aggregateAirQualityNight([aq('2026-02-01T23:00', { pm25: 5 })], window);
    expect(agg.hourCount).toBe(0);
    expect(agg.pm25Mean).toBeNull();
    expect(agg.pm25Max).toBeNull();
    expect(agg.usAqiMean).toBeNull();
    expect(agg.usAqiMax).toBeNull();
  });

  it('projects to AirQualityDaily preserving location and values', () => {
    const agg = aggregateAirQualityNight(
      [aq('2026-01-16T00:00', { pm25: 12, usAqi: 50, europeanAqi: 22 })],
      window,
    );
    const location = { label: 'London', latitude: 51.51, longitude: -0.13 };
    const daily = toAirQualityDaily(agg, location);
    expect(daily.location).toEqual(location);
    expect(daily.pm25Mean).toBe(12);
    expect(daily.pm25Max).toBe(12);
    expect(daily.usAqiMean).toBe(50);
    expect(daily.europeanAqiMax).toBe(22);
  });

  it('accepts a null location stamp', () => {
    const agg = aggregateAirQualityNight([], window);
    expect(toAirQualityDaily(agg, null).location).toBeNull();
  });
});
