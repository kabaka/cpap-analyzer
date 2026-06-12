/**
 * Tests for useWearableLanes — the intraday wearable retrieval hook.
 *
 * Validates skip conditions, keyed fetch dispatch, and — most importantly — the
 * per-type normalisation into absolute wall-clock-as-UTC sample timestamps that
 * the signal viewer aligns lanes against.
 *
 * `getDB` is mocked so the keyed lookups are deterministic without a real
 * IndexedDB; the storage round-trip itself is covered by the IndexedDBService
 * suite.
 *
 * @module hooks/__tests__/useWearableLanes.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type {
  FitbitHeartRateIntraday,
  FitbitSpO2Intraday,
  FitbitHRVDetail,
  FitbitSleepStages,
  IntegrationTimeseries,
} from '@/types';

const mockGetByKey = vi.fn();

vi.mock('@/services/storage/getDB', () => ({
  getDB: () => Promise.resolve({ getIntegrationTimeseriesByKey: mockGetByKey }),
}));

import { useWearableLanes, SLEEP_STAGE_CODES } from '@/hooks/useWearableLanes';

function tsRecord(dataType: string, date: string, data: unknown): IntegrationTimeseries {
  return {
    id: crypto.randomUUID(),
    source: 'fitbit',
    dataType: dataType as IntegrationTimeseries['dataType'],
    date,
    data: data as IntegrationTimeseries['data'],
    importedAt: '2024-01-15T00:00:00Z',
  };
}

describe('useWearableLanes', () => {
  beforeEach(() => {
    mockGetByKey.mockReset();
  });

  describe('skip conditions', () => {
    it('does not query when date is null', async () => {
      const { result } = renderHook(() => useWearableLanes(null, ['heart_rate_intraday']));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockGetByKey).not.toHaveBeenCalled();
      expect(result.current.series).toEqual({});
    });

    it('does not query when dataTypes is empty', async () => {
      const { result } = renderHook(() => useWearableLanes('2024-01-15', []));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockGetByKey).not.toHaveBeenCalled();
    });
  });

  it('normalises heart rate via baseTimestampMs + offsetSec*1000', async () => {
    const base = Date.UTC(2024, 0, 15, 22, 0, 0);
    const hr: FitbitHeartRateIntraday = {
      baseTimestampMs: base,
      samples: [
        { offsetSec: 0, bpm: 60, confidence: 3 },
        { offsetSec: 5, bpm: 62, confidence: 2 },
      ],
      sampleCount: 2,
    };
    mockGetByKey.mockResolvedValue(tsRecord('heart_rate_intraday', '2024-01-15', hr));

    const { result } = renderHook(() => useWearableLanes('2024-01-15', ['heart_rate_intraday']));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const series = result.current.series.heart_rate_intraday!;
    expect(series.samples).toEqual([
      { timestampMs: base, value: 60, confidence: 3 },
      { timestampMs: base + 5000, value: 62, confidence: 2 },
    ]);
    expect(series.startMs).toBe(base);
    expect(series.endMs).toBe(base + 5000);
  });

  it('normalises SpO2 minute offsets against a local-time sleepStartTime', async () => {
    const spo2: FitbitSpO2Intraday = {
      sleepStartTime: '2024-01-15T23:00:00',
      samples: [
        { minuteOffset: 0, value: 96 },
        { minuteOffset: 2, value: 95 },
      ],
      sampleCount: 2,
    };
    mockGetByKey.mockResolvedValue(tsRecord('spo2_intraday', '2024-01-15', spo2));

    const { result } = renderHook(() => useWearableLanes('2024-01-15', ['spo2_intraday']));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const base = Date.UTC(2024, 0, 15, 23, 0, 0);
    expect(result.current.series.spo2_intraday!.samples).toEqual([
      { timestampMs: base, value: 96 },
      { timestampMs: base + 120_000, value: 95 },
    ]);
  });

  it('normalises hrv_detail absolute local-time timestamps and exposes coverage', async () => {
    const hrv: FitbitHRVDetail = {
      intervals: [
        { timestamp: '2024-01-15T23:05:00', rmssd: 40, coverage: 0.9, hf: 1, lf: 2 },
        { timestamp: '2024-01-15T23:00:00', rmssd: 38, coverage: 0.8, hf: 1, lf: 2 },
      ],
    };
    mockGetByKey.mockResolvedValue(tsRecord('hrv_detail', '2024-01-15', hrv));

    const { result } = renderHook(() => useWearableLanes('2024-01-15', ['hrv_detail']));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const samples = result.current.series.hrv_detail!.samples;
    // Sorted ascending by timestamp despite reversed input order.
    expect(samples[0]).toEqual({
      timestampMs: Date.UTC(2024, 0, 15, 23, 0, 0),
      value: 38,
      confidence: 0.8,
    });
    expect(samples[1]!.value).toBe(40);
  });

  it('maps sleep stages to ordinal codes', async () => {
    const stages: FitbitSleepStages = {
      transitions: [
        { timestamp: '2024-01-15T23:00:00', stage: 'wake', durationSeconds: 60 },
        { timestamp: '2024-01-15T23:01:00', stage: 'deep', durationSeconds: 600 },
      ],
    };
    mockGetByKey.mockResolvedValue(tsRecord('sleep_stages', '2024-01-15', stages));

    const { result } = renderHook(() => useWearableLanes('2024-01-15', ['sleep_stages']));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const samples = result.current.series.sleep_stages!.samples;
    expect(samples[0]!.value).toBe(SLEEP_STAGE_CODES.wake);
    expect(samples[1]!.value).toBe(SLEEP_STAGE_CODES.deep);
  });

  it('fetches multiple types in one pass and omits types with no record', async () => {
    const base = Date.UTC(2024, 0, 15, 22, 0, 0);
    mockGetByKey.mockImplementation((_src: string, dt: string) => {
      if (dt === 'heart_rate_intraday') {
        return Promise.resolve(
          tsRecord('heart_rate_intraday', '2024-01-15', {
            baseTimestampMs: base,
            samples: [{ offsetSec: 0, bpm: 70, confidence: 2 }],
            sampleCount: 1,
          } satisfies FitbitHeartRateIntraday),
        );
      }
      return Promise.resolve(null); // spo2 absent
    });

    const { result } = renderHook(() =>
      useWearableLanes('2024-01-15', ['heart_rate_intraday', 'spo2_intraday']),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.series.heart_rate_intraday).toBeDefined();
    expect(result.current.series.spo2_intraday).toBeUndefined();
    expect(mockGetByKey).toHaveBeenCalledTimes(2);
  });

  it('surfaces an error message when the fetch rejects', async () => {
    mockGetByKey.mockRejectedValue(new Error('db boom'));

    const { result } = renderHook(() => useWearableLanes('2024-01-15', ['heart_rate_intraday']));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('db boom');
    expect(result.current.series).toEqual({});
  });
});
