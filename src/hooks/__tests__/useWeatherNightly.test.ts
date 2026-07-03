import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useWeatherNightly, assembleNightly } from '@/hooks/useWeatherNightly';
import { resetDB, getDB } from '@/services/storage/getDB';
import type { IntegrationTimeseries, Session } from '@/types';
import type { WeatherHourly, WeatherHourlySample } from '@/types/weather';

// ---------------------------------------------------------------------------
// Fixtures
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

function weatherHourlyRecord(date: string, samples: WeatherHourlySample[]): IntegrationTimeseries {
  const payload: WeatherHourly = { location: null, samples };
  return {
    id: `weather|weather_hourly|${date}`,
    source: 'weather' as unknown as IntegrationTimeseries['source'],
    dataType: 'weather_hourly' as unknown as IntegrationTimeseries['dataType'],
    date,
    data: payload as unknown as IntegrationTimeseries['data'],
    importedAt: new Date().toISOString(),
  };
}

function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: over.id ?? crypto.randomUUID(),
    machineId: 'SN-1',
    machineModel: 'AirSense 10 AutoSet',
    machineType: 'apap',
    firmwareVersion: '3.0.2',
    date: over.date ?? '2026-01-15',
    startTime: over.startTime ?? '2026-01-14T23:00:00Z',
    endTime: over.endTime ?? '2026-01-15T06:00:00Z',
    durationMinutes: 420,
    usageMinutes: 400,
    importedAt: new Date().toISOString(),
    sourceHash: 'h',
    channels: [],
    signalChunkIds: [],
    hasOximetry: false,
    deleted: false,
    machineSettings: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// assembleNightly (pure)
// ---------------------------------------------------------------------------

describe('assembleNightly', () => {
  it('uses the session window for a date with a session and the default otherwise', () => {
    const weatherHourlyByDate = new Map<string, WeatherHourly>([
      [
        '2026-01-14',
        { location: null, samples: [wx('2026-01-14T23:00', { relativeHumidity2m: 40 })] },
      ],
      [
        '2026-01-15',
        {
          location: null,
          samples: [
            wx('2026-01-15T01:00', { relativeHumidity2m: 60 }),
            wx('2026-01-15T09:00', { relativeHumidity2m: 999 }), // outside both windows
          ],
        },
      ],
    ]);

    const sessionByDate = new Map([
      ['2026-01-15', { start: '2026-01-14T23:00:00Z', end: '2026-01-15T06:00:00Z' }],
    ]);

    const out = assembleNightly(['2026-01-15'], {
      weatherHourlyByDate,
      airHourlyByDate: new Map(),
      weatherDailyByDate: new Map(),
      sessionByDate,
    });

    expect(out).toHaveLength(1);
    const night = out[0]!;
    expect(night.windowSource).toBe('session');
    // 23:00 (prev day) and 01:00 are in [23:00, 06:00); 09:00 excluded.
    expect(night.weatherHourCount).toBe(2);
    expect(night.humidityMean).toBe(50);
  });

  it('falls back to the default civil-night window when no session exists', () => {
    const weatherHourlyByDate = new Map<string, WeatherHourly>([
      [
        '2026-01-15',
        { location: null, samples: [wx('2026-01-15T01:00', { relativeHumidity2m: 70 })] },
      ],
    ]);

    const out = assembleNightly(['2026-01-15'], {
      weatherHourlyByDate,
      airHourlyByDate: new Map(),
      weatherDailyByDate: new Map(),
      sessionByDate: new Map(),
    });

    expect(out[0]!.windowSource).toBe('default-civil-night');
    expect(out[0]!.humidityMean).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// useWeatherNightly (IndexedDB-backed)
// ---------------------------------------------------------------------------

describe('useWeatherNightly', () => {
  beforeEach(async () => {
    try {
      const db = await getDB();
      await db.destroy();
    } catch {
      // ignore
    }
    resetDB();
  });

  it('returns empty/idle when no data exists', async () => {
    const { result } = renderHook(() =>
      useWeatherNightly({ start: '2026-01-01', end: '2026-01-31' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([]);
    expect(result.current.latest).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('computes the session-windowed night joining stored hourly + sessions', async () => {
    const db = await getDB();
    await db.addIntegrationTimeseries(
      weatherHourlyRecord('2026-01-14', [wx('2026-01-14T23:00', { pressureMsl: 1000 })]),
    );
    await db.addIntegrationTimeseries(
      weatherHourlyRecord('2026-01-15', [
        wx('2026-01-15T01:00', { pressureMsl: 1010 }),
        wx('2026-01-15T05:00', { pressureMsl: 1004 }),
      ]),
    );
    await db.addSession(makeSession());

    const { result } = renderHook(() =>
      useWeatherNightly({ start: '2026-01-15', end: '2026-01-15' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toHaveLength(1);
    const night = result.current.latest!;
    expect(night.windowSource).toBe('session');
    // In [23:00, 06:00): 23:00 (1000), 01:00 (1010), 05:00 (1004).
    expect(night.weatherHourCount).toBe(3);
    expect(night.pressureMslMean).toBeCloseTo((1000 + 1010 + 1004) / 3, 6);
    // Delta = last (1004) - first (1000) chronologically.
    expect(night.pressureChange).toBe(4);
  });
});
