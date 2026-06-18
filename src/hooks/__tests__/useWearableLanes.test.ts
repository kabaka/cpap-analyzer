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
    mockGetByKey.mockImplementation((_src: string, dt: string, date: string) => {
      if (dt === 'heart_rate_intraday' && date === '2024-01-15') {
        return Promise.resolve(
          tsRecord('heart_rate_intraday', '2024-01-15', {
            baseTimestampMs: base,
            samples: [{ offsetSec: 0, bpm: 70, confidence: 2 }],
            sampleCount: 1,
          } satisfies FitbitHeartRateIntraday),
        );
      }
      return Promise.resolve(null); // spo2 absent; neighbour dates absent
    });

    const { result } = renderHook(() =>
      useWearableLanes('2024-01-15', ['heart_rate_intraday', 'spo2_intraday']),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.series.heart_rate_intraday).toBeDefined();
    expect(result.current.series.spo2_intraday).toBeUndefined();
    // Each type now loads the anchor date plus both neighbours (date ± 1):
    // 2 types × 3 dates = 6 keyed lookups.
    expect(mockGetByKey).toHaveBeenCalledTimes(6);
  });

  describe('cross-midnight merge', () => {
    it('merges anchor and next-day records into one full-night series', async () => {
      // A night spanning ~23:00 (Jan 15) → ~01:00 (Jan 16). The parser splits
      // this into two date-keyed records, each on the shared wall-clock-as-UTC
      // axis. The session is anchored on the start date (2024-01-15).
      const eveningBase = Date.UTC(2024, 0, 15, 23, 0, 0); // 23:00 tail
      const morningBase = Date.UTC(2024, 0, 16, 0, 30, 0); // 00:30 bulk

      mockGetByKey.mockImplementation((_src: string, dt: string, date: string) => {
        if (dt !== 'heart_rate_intraday') return Promise.resolve(null);
        if (date === '2024-01-15') {
          return Promise.resolve(
            tsRecord('heart_rate_intraday', '2024-01-15', {
              baseTimestampMs: eveningBase,
              samples: [
                { offsetSec: 0, bpm: 58, confidence: 3 },
                { offsetSec: 60, bpm: 57, confidence: 3 },
              ],
              sampleCount: 2,
            } satisfies FitbitHeartRateIntraday),
          );
        }
        if (date === '2024-01-16') {
          return Promise.resolve(
            tsRecord('heart_rate_intraday', '2024-01-16', {
              baseTimestampMs: morningBase,
              samples: [
                { offsetSec: 0, bpm: 55, confidence: 3 },
                { offsetSec: 60, bpm: 54, confidence: 3 },
              ],
              sampleCount: 2,
            } satisfies FitbitHeartRateIntraday),
          );
        }
        return Promise.resolve(null); // 2024-01-14 neighbour absent
      });

      const { result } = renderHook(() => useWearableLanes('2024-01-15', ['heart_rate_intraday']));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const series = result.current.series.heart_rate_intraday!;
      // Both sides of midnight are present, in ascending timestamp order.
      expect(series.samples).toEqual([
        { timestampMs: eveningBase, value: 58, confidence: 3 },
        { timestampMs: eveningBase + 60_000, value: 57, confidence: 3 },
        { timestampMs: morningBase, value: 55, confidence: 3 },
        { timestampMs: morningBase + 60_000, value: 54, confidence: 3 },
      ]);
      expect(series.startMs).toBe(eveningBase);
      expect(series.endMs).toBe(morningBase + 60_000);
      // The series still belongs to the anchor date.
      expect(series.date).toBe('2024-01-15');
    });

    it('merges a previous-day evening tail when the session starts after midnight', async () => {
      // Symmetric case: a session anchored on 2024-01-16 whose evening tail was
      // stored under the previous calendar date (2024-01-15).
      const eveningBase = Date.UTC(2024, 0, 15, 23, 30, 0);
      const morningBase = Date.UTC(2024, 0, 16, 0, 0, 0);

      mockGetByKey.mockImplementation((_src: string, dt: string, date: string) => {
        if (dt !== 'heart_rate_intraday') return Promise.resolve(null);
        if (date === '2024-01-15') {
          return Promise.resolve(
            tsRecord('heart_rate_intraday', '2024-01-15', {
              baseTimestampMs: eveningBase,
              samples: [{ offsetSec: 0, bpm: 60, confidence: 3 }],
              sampleCount: 1,
            } satisfies FitbitHeartRateIntraday),
          );
        }
        if (date === '2024-01-16') {
          return Promise.resolve(
            tsRecord('heart_rate_intraday', '2024-01-16', {
              baseTimestampMs: morningBase,
              samples: [{ offsetSec: 0, bpm: 56, confidence: 3 }],
              sampleCount: 1,
            } satisfies FitbitHeartRateIntraday),
          );
        }
        return Promise.resolve(null); // 2024-01-17 neighbour absent
      });

      const { result } = renderHook(() => useWearableLanes('2024-01-16', ['heart_rate_intraday']));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const series = result.current.series.heart_rate_intraday!;
      expect(series.samples.map((s) => s.value)).toEqual([60, 56]);
      expect(series.startMs).toBe(eveningBase);
      expect(series.endMs).toBe(morningBase);
    });

    it('handles a missing neighbour record gracefully (only anchor present)', async () => {
      const base = Date.UTC(2024, 0, 15, 23, 0, 0);
      mockGetByKey.mockImplementation((_src: string, dt: string, date: string) => {
        if (dt === 'heart_rate_intraday' && date === '2024-01-15') {
          return Promise.resolve(
            tsRecord('heart_rate_intraday', '2024-01-15', {
              baseTimestampMs: base,
              samples: [{ offsetSec: 0, bpm: 62, confidence: 3 }],
              sampleCount: 1,
            } satisfies FitbitHeartRateIntraday),
          );
        }
        return Promise.resolve(null); // both neighbours absent
      });

      const { result } = renderHook(() => useWearableLanes('2024-01-15', ['heart_rate_intraday']));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const series = result.current.series.heart_rate_intraday!;
      expect(series.samples).toEqual([{ timestampMs: base, value: 62, confidence: 3 }]);
      expect(mockGetByKey).toHaveBeenCalledTimes(3);
    });

    it('de-duplicates samples sharing an identical timestamp across records', async () => {
      // Defensive: disjoint date grouping should never produce a true overlap,
      // but identical timestamps must collapse to a single point.
      const shared = Date.UTC(2024, 0, 16, 0, 0, 0);
      mockGetByKey.mockImplementation((_src: string, dt: string, date: string) => {
        if (dt !== 'heart_rate_intraday') return Promise.resolve(null);
        if (date === '2024-01-15' || date === '2024-01-16') {
          return Promise.resolve(
            tsRecord('heart_rate_intraday', date, {
              baseTimestampMs: shared,
              samples: [{ offsetSec: 0, bpm: 59, confidence: 3 }],
              sampleCount: 1,
            } satisfies FitbitHeartRateIntraday),
          );
        }
        return Promise.resolve(null);
      });

      const { result } = renderHook(() => useWearableLanes('2024-01-15', ['heart_rate_intraday']));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const series = result.current.series.heart_rate_intraday!;
      expect(series.samples).toEqual([{ timestampMs: shared, value: 59, confidence: 3 }]);
    });
  });

  it('surfaces an error message when the fetch rejects', async () => {
    mockGetByKey.mockRejectedValue(new Error('db boom'));

    const { result } = renderHook(() => useWearableLanes('2024-01-15', ['heart_rate_intraday']));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('db boom');
    expect(result.current.series).toEqual({});
  });
});
