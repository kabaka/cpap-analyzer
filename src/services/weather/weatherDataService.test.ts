/**
 * Tests for the weather data maintenance helpers.
 *
 * Backs the assertions with a real {@link IndexedDBService} instance over
 * fake-indexeddb so {@link deleteAllWeatherData} is exercised against the actual
 * three-store purge primitive, proving a disable→Delete is a total wipe of
 * `source: 'weather'` (daily + hourly + import history) and leaves other
 * sources untouched.
 *
 * @module services/weather/weatherDataService.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IndexedDBService } from '@/services/storage/IndexedDBService';
import type { IntegrationData, IntegrationImportRecord, IntegrationTimeseries } from '@/types';

let db: IndexedDBService;

// getDB() is the singleton accessor weatherDataService depends on; route it to
// our per-test fake-indexeddb instance.
vi.mock('@/services/storage/getDB', () => ({
  getDB: () => Promise.resolve(db),
}));

import { countWeatherDays, deleteAllWeatherData } from './weatherDataService';

function makeDaily(overrides: Partial<IntegrationData> = {}): IntegrationData {
  return {
    id: crypto.randomUUID(),
    source: 'weather',
    date: '2026-01-15',
    data: { tempC: 12 },
    importedAt: '2026-01-16T09:00:00.000Z',
    ...overrides,
  };
}

function makeTimeseries(overrides: Partial<IntegrationTimeseries> = {}): IntegrationTimeseries {
  return {
    id: crypto.randomUUID(),
    source: 'weather',
    dataType: 'heart_rate_intraday',
    date: '2026-01-15',
    data: { baseTimestampMs: 0, samples: [], sampleCount: 0 },
    importedAt: '2026-01-16T09:00:00.000Z',
    ...overrides,
  };
}

function makeImport(overrides: Partial<IntegrationImportRecord> = {}): IntegrationImportRecord {
  return {
    id: crypto.randomUUID(),
    source: 'weather',
    importedAt: '2026-01-16T09:00:00.000Z',
    dateRangeStart: '2026-01-01',
    dateRangeEnd: '2026-01-31',
    dataTypes: ['weather_daily'],
    recordsImported: 10,
    recordsSkipped: 0,
    recordsErrored: 0,
    errors: [],
    durationSeconds: 1.5,
    fileHashes: [],
    ...overrides,
  };
}

describe('weatherDataService', () => {
  beforeEach(async () => {
    db = new IndexedDBService(`test-db-${crypto.randomUUID()}`);
    await db.open();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('countWeatherDays', () => {
    it('counts distinct civil dates with a weather daily summary', async () => {
      await db.addIntegrationData(makeDaily({ date: '2026-01-10' }));
      await db.addIntegrationData(makeDaily({ date: '2026-01-10' }));
      await db.addIntegrationData(makeDaily({ date: '2026-01-11' }));
      await db.addIntegrationData(makeDaily({ source: 'fitbit', date: '2026-01-12' }));

      expect(await countWeatherDays()).toBe(2);
    });

    it('counts both civil dates of a midnight-spanning night as two days', async () => {
      // A single night crossing local midnight stores a daily summary for BOTH
      // civil dates; this helper honestly reports 2 days (the Settings panel
      // labels it "N days of weather data", not "N nights").
      await db.addIntegrationData(makeDaily({ date: '2026-02-01' }));
      await db.addIntegrationData(makeDaily({ date: '2026-02-02' }));

      expect(await countWeatherDays()).toBe(2);
    });
  });

  describe('deleteAllWeatherData', () => {
    it('totally wipes weather across all three stores and returns counts', async () => {
      // Weather rows.
      await db.addIntegrationData(makeDaily({ date: '2026-01-10' }));
      await db.addIntegrationData(makeDaily({ date: '2026-01-11' }));
      await db.addIntegrationTimeseries(makeTimeseries({ date: '2026-01-10' }));
      await db.addIntegrationTimeseries(makeTimeseries({ date: '2026-01-11' }));
      await db.addIntegrationTimeseries(makeTimeseries({ date: '2026-01-12' }));
      await db.addIntegrationImportRecord(makeImport());

      // Non-weather rows that must survive.
      await db.addIntegrationData(makeDaily({ source: 'fitbit', date: '2026-01-10' }));
      await db.addIntegrationTimeseries(makeTimeseries({ source: 'fitbit', date: '2026-01-10' }));
      await db.addIntegrationImportRecord(makeImport({ source: 'fitbit' }));

      const result = await deleteAllWeatherData();

      expect(result).toEqual({
        dailyRemoved: 2,
        timeseriesRemoved: 3,
        importRecordsRemoved: 1,
      });

      // Nothing weather remains.
      expect(await db.getIntegrationDataBySource('weather')).toHaveLength(0);
      expect(await db.hasIntegrationData('weather')).toBe(false);
      expect(await db.getIntegrationImportRecords('weather')).toHaveLength(0);
      expect(
        (await db.getIntegrationTimeseriesByDateRange('0000-01-01', '9999-12-31')).filter(
          (r) => r.source === 'weather',
        ),
      ).toHaveLength(0);

      // Fitbit untouched.
      expect(await db.getIntegrationDataBySource('fitbit')).toHaveLength(1);
      expect(await db.getIntegrationImportRecords('fitbit')).toHaveLength(1);
      expect(
        (await db.getIntegrationTimeseriesByDateRange('0000-01-01', '9999-12-31')).filter(
          (r) => r.source === 'fitbit',
        ),
      ).toHaveLength(1);
    });

    it('returns zero counts when no weather data is stored', async () => {
      const result = await deleteAllWeatherData();
      expect(result).toEqual({ dailyRemoved: 0, timeseriesRemoved: 0, importRecordsRemoved: 0 });
    });
  });
});
