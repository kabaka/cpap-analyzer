/**
 * Unit tests for the Open-Meteo → typed-record parsers.
 *
 * Validate the happy path (correct field mapping, SI/metric values stored
 * as-returned, grouping by local date) and the CRITICAL "queried but empty"
 * marker that must stay distinct from "not fetched" so surfaces show "—" rather
 * than a fabricated zero. Also assert provider `null`s are preserved, never
 * coerced to 0.
 *
 * @module services/weather/__tests__/parsers.test
 */

import { describe, it, expect } from 'vitest';
import type { WeatherLocation } from '@/types/weather';
import { parseAirQualityResponse, parseWeatherResponse } from '../parsers';
import type { OpenMeteoAirQualityResponse, OpenMeteoWeatherResponse } from '../OpenMeteoClient';

const LOCATION: WeatherLocation = { label: 'Test City', latitude: 51.12, longitude: -0.99 };

// ---------------------------------------------------------------------------
// Weather — happy path
// ---------------------------------------------------------------------------

describe('parseWeatherResponse — happy path', () => {
  const response: OpenMeteoWeatherResponse = {
    hourly: {
      time: ['2026-01-15T22:00', '2026-01-15T23:00', '2026-01-16T00:00'],
      temperature_2m: [4.5, 4.1, 3.8],
      relative_humidity_2m: [88, 90, 92],
      dewpoint_2m: [2.5, 2.6, 2.4],
      surface_pressure: [1011, 1010.5, 1010],
      pressure_msl: [1013.2, 1012.8, 1012.4],
      precipitation: [0, 0.2, 0.1],
      windspeed_10m: [12, 14, 10],
      cloudcover: [100, 95, 90],
      weathercode: [3, 61, 61],
    },
    daily: {
      time: ['2026-01-15', '2026-01-16'],
      temperature_2m_max: [6.2, 5.5],
      temperature_2m_min: [3.1, 2.8],
      temperature_2m_mean: [4.6, 4.0],
      precipitation_sum: [0.2, 1.4],
      windspeed_10m_max: [18, 22],
      weathercode: [61, 63],
    },
  };

  it('groups hourly samples by local calendar date', () => {
    const { hourly } = parseWeatherResponse(response, LOCATION);
    expect(hourly).toHaveLength(2);
    expect(hourly[0]?.date).toBe('2026-01-15');
    expect(hourly[0]?.data.samples).toHaveLength(2);
    expect(hourly[1]?.date).toBe('2026-01-16');
    expect(hourly[1]?.data.samples).toHaveLength(1);
  });

  it('maps hourly fields with SI values stored as-returned and attaches location', () => {
    const { hourly } = parseWeatherResponse(response, LOCATION);
    const first = hourly[0]?.data.samples[0];
    expect(first).toMatchObject({
      time: '2026-01-15T22:00',
      temperature2m: 4.5,
      relativeHumidity2m: 88,
      dewpoint2m: 2.5,
      surfacePressure: 1011,
      pressureMsl: 1013.2,
      precipitation: 0,
      windspeed10m: 12,
      cloudcover: 100,
      weathercode: 3,
    });
    expect(hourly[0]?.data.location).toEqual(LOCATION);
  });

  it('maps the provider daily aggregates per civil date', () => {
    const { daily } = parseWeatherResponse(response, LOCATION);
    expect(daily).toHaveLength(2);
    expect(daily[0]).toMatchObject({ date: '2026-01-15', queriedEmpty: false });
    expect(daily[0]?.data).toMatchObject({
      temperature2mMax: 6.2,
      temperature2mMin: 3.1,
      temperature2mMean: 4.6,
      precipitationSum: 0.2,
      windspeed10mMax: 18,
      weathercode: 61,
    });
  });

  it('marks dates with real data as NOT queriedEmpty', () => {
    const { hourly } = parseWeatherResponse(response, LOCATION);
    expect(hourly.every((r) => r.queriedEmpty === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Weather — null preservation
// ---------------------------------------------------------------------------

describe('parseWeatherResponse — missing data', () => {
  it('preserves provider null values and never coerces to 0', () => {
    const response: OpenMeteoWeatherResponse = {
      hourly: {
        time: ['2026-02-01T03:00'],
        temperature_2m: [null],
        precipitation: [null],
        pressure_msl: [1015],
      },
    };
    const { hourly } = parseWeatherResponse(response, LOCATION);
    const sample = hourly[0]?.data.samples[0];
    expect(sample?.temperature2m).toBeNull();
    expect(sample?.precipitation).toBeNull();
    expect(sample?.pressureMsl).toBe(1015);
    // One real (non-null) field means the date is NOT empty.
    expect(hourly[0]?.queriedEmpty).toBe(false);
  });

  it('marks a date as queriedEmpty when every field of every hour is null', () => {
    const response: OpenMeteoWeatherResponse = {
      hourly: {
        time: ['2026-02-01T03:00', '2026-02-01T04:00'],
        temperature_2m: [null, null],
        pressure_msl: [null, null],
      },
    };
    const { hourly } = parseWeatherResponse(response, LOCATION);
    expect(hourly).toHaveLength(1);
    expect(hourly[0]?.queriedEmpty).toBe(true);
    // The record still exists (queried) — distinct from "not fetched" (no record).
    expect(hourly[0]?.data.samples).toHaveLength(2);
  });

  it('returns no records when the response has no hourly block at all', () => {
    const { hourly, daily } = parseWeatherResponse({}, LOCATION);
    expect(hourly).toHaveLength(0);
    expect(daily).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Air quality
// ---------------------------------------------------------------------------

describe('parseAirQualityResponse', () => {
  it('maps hourly air-quality fields and groups by date', () => {
    const response: OpenMeteoAirQualityResponse = {
      hourly: {
        time: ['2026-03-01T00:00', '2026-03-01T01:00'],
        pm2_5: [12.3, 14.1],
        pm10: [20, 22],
        ozone: [55, 50],
        nitrogen_dioxide: [18, 19],
        us_aqi: [51, 60],
        european_aqi: [25, 30],
      },
    };
    const { hourly } = parseAirQualityResponse(response, LOCATION);
    expect(hourly).toHaveLength(1);
    expect(hourly[0]?.data.samples[0]).toMatchObject({
      time: '2026-03-01T00:00',
      pm25: 12.3,
      pm10: 20,
      ozone: 55,
      nitrogenDioxide: 18,
      usAqi: 51,
      europeanAqi: 25,
    });
    expect(hourly[0]?.queriedEmpty).toBe(false);
  });

  it('marks an all-null air-quality date as queriedEmpty', () => {
    const response: OpenMeteoAirQualityResponse = {
      hourly: {
        time: ['2026-03-02T00:00'],
        pm2_5: [null],
        us_aqi: [null],
      },
    };
    const { hourly } = parseAirQualityResponse(response, LOCATION);
    expect(hourly[0]?.queriedEmpty).toBe(true);
  });
});
