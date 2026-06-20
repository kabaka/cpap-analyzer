/**
 * Unit tests for {@link WeatherSyncService}.
 *
 * Both the Open-Meteo client and the IndexedDB service are mocked — no network,
 * no real database. Validate: scope (distinct civil dates), dedupe via the
 * `source_dataType_date` key, batched store, locally-derived overnight AQ daily
 * aggregate, cancellation, rate-limit surfacing, and the import-history record.
 *
 * @module services/weather/__tests__/WeatherSyncService.test
 */

import { describe, it, expect, vi } from 'vitest';
import type { IndexedDBService } from '@/services/storage/IndexedDBService';
import { OpenMeteoClient, WeatherFetchError } from '../OpenMeteoClient';
import { WeatherSyncService, type WeatherSyncNight } from '../WeatherSyncService';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface MockDB {
  daily: unknown[];
  hourly: unknown[];
  imports: unknown[];
  getIntegrationDailySummaryByKey: ReturnType<typeof vi.fn>;
  getIntegrationTimeseriesByKey: ReturnType<typeof vi.fn>;
  bulkAddIntegrationDailySummaries: ReturnType<typeof vi.fn>;
  bulkAddIntegrationTimeseries: ReturnType<typeof vi.fn>;
  addIntegrationDailySummary: ReturnType<typeof vi.fn>;
  addIntegrationTimeseries: ReturnType<typeof vi.fn>;
  addIntegrationImportRecord: ReturnType<typeof vi.fn>;
}

function makeMockDB(): MockDB {
  const db: MockDB = {
    daily: [],
    hourly: [],
    imports: [],
    getIntegrationDailySummaryByKey: vi.fn().mockResolvedValue(null),
    getIntegrationTimeseriesByKey: vi.fn().mockResolvedValue(null),
    bulkAddIntegrationDailySummaries: vi.fn(),
    bulkAddIntegrationTimeseries: vi.fn(),
    addIntegrationDailySummary: vi.fn(),
    addIntegrationTimeseries: vi.fn(),
    addIntegrationImportRecord: vi.fn(),
  };
  db.bulkAddIntegrationDailySummaries.mockImplementation((recs: unknown[]) => {
    db.daily.push(...recs);
    return Promise.resolve();
  });
  db.bulkAddIntegrationTimeseries.mockImplementation((recs: unknown[]) => {
    db.hourly.push(...recs);
    return Promise.resolve();
  });
  db.addIntegrationImportRecord.mockImplementation((rec: unknown) => {
    db.imports.push(rec);
    return Promise.resolve();
  });
  return db;
}

function makeClient(): OpenMeteoClient {
  const client = new OpenMeteoClient();
  vi.spyOn(client, 'fetchWeather').mockImplementation((req) =>
    Promise.resolve({
      hourly: {
        time: [`${req.dates[0]}T22:00`, `${req.dates[0]}T23:00`],
        temperature_2m: [5, 4],
        pressure_msl: [1012, 1013],
      },
      daily: {
        time: [req.dates[0] as string],
        temperature_2m_min: [3],
        temperature_2m_max: [7],
      },
    }),
  );
  vi.spyOn(client, 'fetchAirQuality').mockImplementation((req) =>
    Promise.resolve({
      hourly: {
        time: [`${req.dates[0]}T22:00`, `${req.dates[0]}T23:00`],
        pm2_5: [10, 12],
        us_aqi: [40, 45],
        european_aqi: [20, 22],
      },
    }),
  );
  return client;
}

const LOCATION = { label: 'Test', latitude: 51.12, longitude: -0.99 };

function night(date: string, civilDates: string[]): WeatherSyncNight {
  return {
    date,
    civilDates,
    window: { start: `${date}T22:00:00`, end: `${civilDates[civilDates.length - 1]}T06:00:00` },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WeatherSyncService', () => {
  it('fetches distinct civil dates once and stores daily + hourly records', async () => {
    const db = makeMockDB();
    const client = makeClient();
    const svc = new WeatherSyncService(db as unknown as IndexedDBService, client);

    const record = await svc.sync({
      nights: [
        night('2026-01-10', ['2026-01-10', '2026-01-11']),
        night('2026-01-11', ['2026-01-11']),
      ],
      location: LOCATION,
      timezone: 'Europe/London',
      today: '2026-06-20',
    });

    // Distinct civil dates: 2026-01-10, 2026-01-11 → 2 fetches each domain.
    expect(client.fetchWeather).toHaveBeenCalledTimes(2);
    expect(client.fetchAirQuality).toHaveBeenCalledTimes(2);
    expect(record.recordsImported).toBeGreaterThan(0);
    expect(db.imports).toHaveLength(1);
    expect(record.source).toBe('weather');
  });

  it('skips dates already stored (dedupe via source_dataType_date)', async () => {
    const db = makeMockDB();
    db.getIntegrationDailySummaryByKey.mockResolvedValue({ id: 'existing' });
    db.getIntegrationTimeseriesByKey.mockResolvedValue({ id: 'existing' });
    const client = makeClient();
    const svc = new WeatherSyncService(db as unknown as IndexedDBService, client);

    const record = await svc.sync({
      nights: [night('2026-01-10', ['2026-01-10'])],
      location: LOCATION,
      timezone: 'Europe/London',
      today: '2026-06-20',
    });

    expect(record.recordsImported).toBe(0);
    expect(record.recordsSkipped).toBeGreaterThan(0);
    expect(db.bulkAddIntegrationDailySummaries).not.toHaveBeenCalled();
  });

  it('derives an overnight air_quality_daily record per night', async () => {
    const db = makeMockDB();
    const client = makeClient();
    const svc = new WeatherSyncService(db as unknown as IndexedDBService, client);

    const record = await svc.sync({
      nights: [night('2026-01-10', ['2026-01-10'])],
      location: LOCATION,
      timezone: 'Europe/London',
      today: '2026-06-20',
    });

    const aqDaily = db.daily.filter(
      (r): r is { dataType: string } =>
        typeof r === 'object' &&
        r !== null &&
        (r as { dataType?: string }).dataType === 'air_quality_daily',
    );
    expect(aqDaily).toHaveLength(1);
    expect(record.dataTypes).toContain('air_quality_daily');
  });

  it('honours cancellation and reports a cancelled status', async () => {
    const db = makeMockDB();
    const client = makeClient();
    const svc = new WeatherSyncService(db as unknown as IndexedDBService, client);
    const controller = new AbortController();
    controller.abort();

    const states: string[] = [];
    await svc.sync({
      nights: [night('2026-01-10', ['2026-01-10'])],
      location: LOCATION,
      timezone: 'Europe/London',
      today: '2026-06-20',
      signal: controller.signal,
      onProgress: (p) => states.push(p.status),
    });

    expect(states).toContain('cancelled');
    expect(client.fetchWeather).not.toHaveBeenCalled();
  });

  it('surfaces a provider rate limit as a rateLimited progress flag and an error', async () => {
    const db = makeMockDB();
    const client = makeClient();
    vi.spyOn(client, 'fetchWeather').mockRejectedValue(
      new WeatherFetchError('rate-limited', 'rate limited', { status: 429 }),
    );
    const svc = new WeatherSyncService(db as unknown as IndexedDBService, client);

    let sawRateLimited = false;
    const record = await svc.sync({
      nights: [night('2026-01-10', ['2026-01-10'])],
      location: LOCATION,
      timezone: 'Europe/London',
      today: '2026-06-20',
      fetchAirQuality: false,
      onProgress: (p) => {
        if (p.rateLimited) sawRateLimited = true;
      },
    });

    expect(sawRateLimited).toBe(true);
    expect(record.recordsErrored).toBeGreaterThan(0);
    expect(record.errors[0]?.error).toContain('rate limited');
  });

  it('writes an import record even with nothing to sync', async () => {
    const db = makeMockDB();
    const client = makeClient();
    const svc = new WeatherSyncService(db as unknown as IndexedDBService, client);

    const record = await svc.sync({
      nights: [],
      location: LOCATION,
      timezone: 'Europe/London',
      today: '2026-06-20',
    });

    expect(db.imports).toHaveLength(1);
    expect(record.recordsImported).toBe(0);
    expect(client.fetchWeather).not.toHaveBeenCalled();
  });
});
