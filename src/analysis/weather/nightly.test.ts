import { describe, it, expect } from 'vitest';

import type { AirQualityHourlySample, WeatherDaily, WeatherHourlySample } from '@/types/weather';

import {
  computeWeatherNightly,
  defaultCivilNightWindow,
  resolveNightlyWindow,
  DEFAULT_CIVIL_NIGHT_WINDOW_HOURS,
  toWallClock,
} from './nightly';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

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

function daily(over: Partial<WeatherDaily> = {}): WeatherDaily {
  return {
    location: null,
    temperature2mMax: null,
    temperature2mMin: null,
    temperature2mMean: null,
    precipitationSum: null,
    windspeed10mMax: null,
    weathercode: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Default civil-night window constant + resolver
// ---------------------------------------------------------------------------

describe('weather/nightly — default civil-night window', () => {
  it('is defined ONCE as [D-1 20:00, D 08:00)', () => {
    expect(DEFAULT_CIVIL_NIGHT_WINDOW_HOURS.startHour).toBe(20);
    expect(DEFAULT_CIVIL_NIGHT_WINDOW_HOURS.endHour).toBe(8);
    expect(defaultCivilNightWindow('2026-01-15')).toEqual({
      start: '2026-01-14T20:00',
      end: '2026-01-15T08:00',
    });
  });

  it('resolveNightlyWindow uses the session window when bounds are present', () => {
    const r = resolveNightlyWindow('2026-01-15', '2026-01-14T23:14:00Z', '2026-01-15T06:30:00Z');
    expect(r.source).toBe('session');
    // Offset stripped to local wall-clock frame.
    expect(r.window).toEqual({ start: '2026-01-14T23:14:00', end: '2026-01-15T06:30:00' });
  });

  it('resolveNightlyWindow falls back to the default civil night without a session', () => {
    const r = resolveNightlyWindow('2026-01-15');
    expect(r.source).toBe('default-civil-night');
    expect(r.window).toEqual({ start: '2026-01-14T20:00', end: '2026-01-15T08:00' });
  });

  it('toWallClock strips a trailing Z / offset', () => {
    expect(toWallClock('2026-01-15T06:30:00Z')).toBe('2026-01-15T06:30:00');
    expect(toWallClock('2026-01-15T06:30:00+02:00')).toBe('2026-01-15T06:30:00');
    expect(toWallClock('2026-01-15T06:30')).toBe('2026-01-15T06:30');
  });
});

// ---------------------------------------------------------------------------
// Session-window vs default-window equivalence when they coincide
// ---------------------------------------------------------------------------

describe('weather/nightly — session vs default window equivalence', () => {
  // Hourly humidity at each hour of the night 2026-01-14 20:00 .. 2026-01-15 07:00.
  const samples: WeatherHourlySample[] = [];
  for (let h = 20; h < 24; h++) {
    samples.push(wx(`2026-01-14T${String(h).padStart(2, '0')}:00`, { relativeHumidity2m: 50 + h }));
  }
  for (let h = 0; h < 8; h++) {
    samples.push(wx(`2026-01-15T${String(h).padStart(2, '0')}:00`, { relativeHumidity2m: 50 + h }));
  }

  it('yields identical humidity whether the window is session-derived or the default, when they coincide', () => {
    const viaDefault = computeWeatherNightly({
      date: '2026-01-15',
      hourlyWeather: [samples],
    });

    // A session whose [start,end) exactly equals the default civil night.
    const viaSession = computeWeatherNightly({
      date: '2026-01-15',
      sessionStart: '2026-01-14T20:00:00Z',
      sessionEnd: '2026-01-15T08:00:00Z',
      hourlyWeather: [samples],
    });

    expect(viaDefault.windowSource).toBe('default-civil-night');
    expect(viaSession.windowSource).toBe('session');
    expect(viaDefault.humidityMean).not.toBeNull();
    expect(viaSession.humidityMean).toBe(viaDefault.humidityMean);
    expect(viaSession.weatherHourCount).toBe(viaDefault.weatherHourCount);
  });
});

// ---------------------------------------------------------------------------
// Two-civil-date merge
// ---------------------------------------------------------------------------

describe('weather/nightly — two civil-date night merge', () => {
  it('merges the previous evening and the morning into one overnight aggregate', () => {
    const eveningDate: WeatherHourlySample[] = [
      wx('2026-01-14T23:00', { pressureMsl: 1000, relativeHumidity2m: 40 }),
    ];
    const morningDate: WeatherHourlySample[] = [
      wx('2026-01-15T00:00', { pressureMsl: 1004, relativeHumidity2m: 60 }),
      // 08:00 is OUTSIDE the session window below (exclusive end) — must be ignored.
      wx('2026-01-15T08:00', { pressureMsl: 9999, relativeHumidity2m: 999 }),
    ];

    const n = computeWeatherNightly({
      date: '2026-01-15',
      sessionStart: '2026-01-14T23:00:00Z',
      sessionEnd: '2026-01-15T08:00:00Z',
      hourlyWeather: [eveningDate, morningDate],
    });

    expect(n.weatherHourCount).toBe(2); // 23:00 and 00:00 only
    expect(n.humidityMean).toBe(50); // (40 + 60) / 2
    expect(n.pressureMslMean).toBe(1002); // (1000 + 1004) / 2
  });
});

// ---------------------------------------------------------------------------
// Null vs zero (dry-night precipitation)
// ---------------------------------------------------------------------------

describe('weather/nightly — null vs zero precipitation', () => {
  it('a dry night sums to 0 (not null)', () => {
    const n = computeWeatherNightly({
      date: '2026-01-15',
      hourlyWeather: [
        [
          wx('2026-01-15T02:00', { precipitation: 0 }),
          wx('2026-01-15T03:00', { precipitation: 0 }),
        ],
      ],
    });
    expect(n.precipitationSum).toBe(0);
    expect(n.precipitationSource).toBe('hourly');
  });

  it('a night with no precipitation data is null (not 0)', () => {
    const n = computeWeatherNightly({
      date: '2026-01-15',
      hourlyWeather: [[wx('2026-01-15T02:00', { relativeHumidity2m: 50 })]],
    });
    expect(n.precipitationSum).toBeNull();
    expect(n.precipitationSource).toBe('none');
  });

  it('does NOT fabricate 0 when there are no in-window samples at all', () => {
    const n = computeWeatherNightly({ date: '2026-01-15', hourlyWeather: [[]] });
    expect(n.precipitationSum).toBeNull();
    expect(n.humidityMean).toBeNull();
    expect(n.pressureMslMean).toBeNull();
    expect(n.weatherHourCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Hourly-vs-daily precedence (temp / precip fallback)
// ---------------------------------------------------------------------------

describe('weather/nightly — hourly vs stored-daily precedence', () => {
  it('prefers hourly temperature low over the stored daily min', () => {
    const n = computeWeatherNightly({
      date: '2026-01-15',
      hourlyWeather: [
        [
          wx('2026-01-15T03:00', { temperature2m: 4 }),
          wx('2026-01-15T04:00', { temperature2m: 2 }),
        ],
      ],
      dailyWeather: daily({ temperature2mMin: -10, temperature2mMean: 0 }),
    });
    expect(n.temperatureLow).toBe(2);
    expect(n.temperatureSource).toBe('hourly');
  });

  it('falls back to the stored daily min/mean when no in-window hourly temperature exists', () => {
    const n = computeWeatherNightly({
      date: '2026-01-15',
      hourlyWeather: [[wx('2026-01-15T03:00', { relativeHumidity2m: 50 })]],
      dailyWeather: daily({ temperature2mMin: -3, temperature2mMean: 1 }),
    });
    expect(n.temperatureLow).toBe(-3);
    expect(n.temperatureMean).toBe(1);
    expect(n.temperatureSource).toBe('daily');
  });

  it('falls back to the stored daily precipitation sum when hourly precip is absent', () => {
    const n = computeWeatherNightly({
      date: '2026-01-15',
      hourlyWeather: [[wx('2026-01-15T03:00', { relativeHumidity2m: 50 })]],
      dailyWeather: daily({ precipitationSum: 7.2 }),
    });
    expect(n.precipitationSum).toBe(7.2);
    expect(n.precipitationSource).toBe('daily');
  });
});

// ---------------------------------------------------------------------------
// Pressure delta sign / correctness
// ---------------------------------------------------------------------------

describe('weather/nightly — overnight pressure change (delta)', () => {
  it('is last-minus-first in chronological order (rising = positive)', () => {
    const n = computeWeatherNightly({
      date: '2026-01-15',
      sessionStart: '2026-01-14T22:00:00Z',
      sessionEnd: '2026-01-15T07:00:00Z',
      // Provided out of order to prove chronological sorting.
      hourlyWeather: [
        [
          wx('2026-01-15T06:00', { pressureMsl: 1018 }),
          wx('2026-01-14T22:00', { pressureMsl: 1006 }),
          wx('2026-01-15T02:00', { pressureMsl: 1012 }),
        ],
      ],
    });
    expect(n.pressureChange).toBe(12); // 1018 - 1006
  });

  it('is negative when pressure falls overnight', () => {
    const n = computeWeatherNightly({
      date: '2026-01-15',
      hourlyWeather: [
        [
          wx('2026-01-15T01:00', { pressureMsl: 1010 }),
          wx('2026-01-15T05:00', { pressureMsl: 1001 }),
        ],
      ],
    });
    expect(n.pressureChange).toBe(-9);
  });

  it('is null with fewer than two valid MSL samples', () => {
    const n = computeWeatherNightly({
      date: '2026-01-15',
      hourlyWeather: [[wx('2026-01-15T01:00', { pressureMsl: 1010 })]],
    });
    expect(n.pressureChange).toBeNull();
  });

  it('skips null pressure samples when computing the delta', () => {
    const n = computeWeatherNightly({
      date: '2026-01-15',
      hourlyWeather: [
        [
          wx('2026-01-15T01:00', { pressureMsl: null }),
          wx('2026-01-15T02:00', { pressureMsl: 1005 }),
          wx('2026-01-15T06:00', { pressureMsl: 1000 }),
          wx('2026-01-15T07:00', { pressureMsl: null }),
        ],
      ],
    });
    expect(n.pressureChange).toBe(-5); // 1000 - 1005 (nulls ignored)
  });
});

// ---------------------------------------------------------------------------
// Air quality is hourly-window derived
// ---------------------------------------------------------------------------

describe('weather/nightly — air quality', () => {
  it('aggregates AQI mean/max over the overnight window', () => {
    const n = computeWeatherNightly({
      date: '2026-01-15',
      hourlyAir: [[aq('2026-01-15T01:00', { usAqi: 40 }), aq('2026-01-15T05:00', { usAqi: 60 })]],
    });
    expect(n.usAqiMean).toBe(50);
    expect(n.usAqiMax).toBe(60);
    expect(n.airHourCount).toBe(2);
  });
});
