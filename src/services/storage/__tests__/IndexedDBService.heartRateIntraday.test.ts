/**
 * Storage round-trip tests for the intraday heart-rate timeseries record.
 *
 * Verifies that a full-resolution `heart_rate_intraday` payload survives a
 * write → keyed-read → date-range-read cycle through the real
 * `integration_timeseries` store (backed by fake-indexeddb), with the nested
 * sample array preserved byte-for-byte by IndexedDB's structured clone.
 *
 * @module services/storage/__tests__/IndexedDBService.heartRateIntraday.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBService } from '@/services/storage/IndexedDBService';
import type { FitbitHeartRateIntraday, IntegrationTimeseries } from '@/types';

function makeRecord(
  date: string,
  data: FitbitHeartRateIntraday,
): IntegrationTimeseries<'heart_rate_intraday'> {
  return {
    id: crypto.randomUUID(),
    source: 'fitbit',
    dataType: 'heart_rate_intraday',
    date,
    data,
    importedAt: new Date().toISOString(),
  };
}

function makePayload(baseTimestampMs: number, count: number): FitbitHeartRateIntraday {
  const samples = Array.from({ length: count }, (_, i) => ({
    offsetSec: i * 5,
    bpm: 60 + (i % 20),
    confidence: i % 4,
  }));
  return { baseTimestampMs, samples, sampleCount: count };
}

describe('IndexedDBService — heart_rate_intraday round-trip', () => {
  let db: IndexedDBService;

  beforeEach(async () => {
    db = new IndexedDBService(`test-db-${crypto.randomUUID()}`);
    await db.open();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('should preserve a full-resolution payload through a keyed round-trip', async () => {
    const base = Date.UTC(2024, 0, 15, 22, 0, 0);
    const payload = makePayload(base, 17_000); // ≈ one day at 5-second cadence
    const record = makeRecord('2024-01-15', payload);

    await db.addIntegrationTimeseries(record);

    const fetched = await db.getIntegrationTimeseriesByKey(
      'fitbit',
      'heart_rate_intraday',
      '2024-01-15',
    );

    expect(fetched).not.toBeNull();
    const data = fetched!.data as FitbitHeartRateIntraday;
    expect(data.baseTimestampMs).toBe(base);
    expect(data.sampleCount).toBe(17_000);
    expect(data.samples).toHaveLength(17_000);
    // Spot-check that the nested array survived structured clone intact.
    expect(data.samples[0]).toEqual({ offsetSec: 0, bpm: 60, confidence: 0 });
    expect(data.samples[1]).toEqual({ offsetSec: 5, bpm: 61, confidence: 1 });
    expect(data.samples[16_999]!.offsetSec).toBe(16_999 * 5);
  });

  it('should store two date records from a single midnight-straddling night', async () => {
    await db.bulkAddIntegrationTimeseries([
      makeRecord('2024-01-15', makePayload(Date.UTC(2024, 0, 15, 23, 0, 0), 100)),
      makeRecord('2024-01-16', makePayload(Date.UTC(2024, 0, 16, 0, 0, 0), 200)),
    ]);

    const a = await db.getIntegrationTimeseriesByKey('fitbit', 'heart_rate_intraday', '2024-01-15');
    const b = await db.getIntegrationTimeseriesByKey('fitbit', 'heart_rate_intraday', '2024-01-16');

    expect((a!.data as FitbitHeartRateIntraday).sampleCount).toBe(100);
    expect((b!.data as FitbitHeartRateIntraday).sampleCount).toBe(200);
  });

  it('should retrieve the record via a date-range query', async () => {
    await db.addIntegrationTimeseries(
      makeRecord('2024-02-10', makePayload(Date.UTC(2024, 1, 10, 1, 0, 0), 50)),
    );

    const inRange = await db.getIntegrationTimeseriesByDateRange('2024-02-01', '2024-02-28');
    const hr = inRange.filter((r) => r.dataType === 'heart_rate_intraday');
    expect(hr).toHaveLength(1);
    expect(hr[0]!.date).toBe('2024-02-10');

    const outOfRange = await db.getIntegrationTimeseriesByDateRange('2024-03-01', '2024-03-31');
    expect(outOfRange.filter((r) => r.dataType === 'heart_rate_intraday')).toHaveLength(0);
  });

  it('should return null for a date with no record', async () => {
    const missing = await db.getIntegrationTimeseriesByKey(
      'fitbit',
      'heart_rate_intraday',
      '2099-12-31',
    );
    expect(missing).toBeNull();
  });
});
