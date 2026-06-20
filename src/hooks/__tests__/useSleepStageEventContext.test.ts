/**
 * Tests for useSleepStageEventContext — the IO boundary that loads wearable
 * sleep-stage context (hypnogram segments + optional intraday HR) overlapping
 * the active date range and normalises it into the pure shapes the
 * `@/analysis/sleepStages` module consumes.
 *
 * Scope: this suite exercises the HOOK's IO / normalisation / sequencing logic
 * only — segment construction, the numeric/parse guards, `includeHr` gating, the
 * `MAX_HR_NIGHTS` bound, ±1-day range widening, and the stale-request guard. The
 * statistical layer in `@/analysis/sleepStages` is covered exhaustively by its
 * own suite and is deliberately NOT re-tested here.
 *
 * Unlike `useWearableLanes.test.ts` (which mocks `getDB` for keyed lookups), this
 * hook reads via `getIntegrationTimeseriesByDateRange`, so we seed the REAL
 * `getDB()` singleton backed by fake-indexeddb — matching the seeding style of
 * the `IndexedDBService` round-trip suite — and reset it between tests for
 * isolation.
 *
 * @module hooks/__tests__/useSleepStageEventContext.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { getDB, resetDB } from '@/services/storage/getDB';
import { useAppStore } from '@/stores/useAppStore';
import { parseLocalDate } from '@/utils/formatDate';
import type { FitbitHeartRateIntraday, FitbitSleepStages, IntegrationTimeseries } from '@/types';
import { useSleepStageEventContext } from '@/hooks/useSleepStageEventContext';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function stagesRecord(date: string, data: FitbitSleepStages): IntegrationTimeseries {
  return {
    id: crypto.randomUUID(),
    source: 'fitbit',
    dataType: 'sleep_stages',
    date,
    data: data as IntegrationTimeseries['data'],
    importedAt: '2024-01-15T00:00:00Z',
  };
}

function hrRecord(date: string, data: FitbitHeartRateIntraday): IntegrationTimeseries {
  return {
    id: crypto.randomUUID(),
    source: 'fitbit',
    dataType: 'heart_rate_intraday',
    date,
    data: data as IntegrationTimeseries['data'],
    importedAt: '2024-01-15T00:00:00Z',
  };
}

/**
 * Set the global date range from `YYYY-MM-DD` strings. Uses `parseLocalDate`
 * (local midnight) so the hook's `formatDate` reproduces exactly these strings
 * regardless of the CI timezone, keeping the date-range query deterministic.
 */
function setRange(start: string, end: string): void {
  useAppStore.getState().setDateRange({
    start: parseLocalDate(start)!,
    end: parseLocalDate(end)!,
  });
}

async function seed(records: readonly IntegrationTimeseries[]): Promise<void> {
  const db = await getDB();
  await db.bulkAddIntegrationTimeseries(records);
}

/**
 * Tear down the shared singleton DB. The singleton uses a FIXED database name,
 * so simply resetting the accessor leaves the fake-indexeddb data in place;
 * `destroy()` deletes the underlying database so each test starts clean.
 */
async function teardownDB(): Promise<void> {
  const db = await getDB();
  await db.destroy();
  resetDB();
}

// ---------------------------------------------------------------------------

describe('useSleepStageEventContext', () => {
  beforeEach(async () => {
    await teardownDB();
    // Default range that brackets the fixtures' canonical 2024-01-15 night.
    setRange('2024-01-15', '2024-01-15');
  });

  afterEach(async () => {
    await teardownDB();
  });

  describe('stage segments', () => {
    it('builds StageSegments with endMs = startMs + durationSeconds*1000 on the wall-clock-as-UTC base', async () => {
      const t0 = Date.UTC(2024, 0, 15, 23, 0, 0); // 23:00 wall clock
      await seed([
        stagesRecord('2024-01-15', {
          transitions: [
            { timestamp: '2024-01-15T23:00:00', stage: 'wake', durationSeconds: 60 },
            { timestamp: '2024-01-15T23:01:00', stage: 'light', durationSeconds: 600 },
            { timestamp: '2024-01-15T23:11:00', stage: 'deep', durationSeconds: 1200 },
          ],
        }),
      ]);

      const { result } = renderHook(() => useSleepStageEventContext(false));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.hasStageData).toBe(true);
      expect(result.current.nights).toHaveLength(1);
      expect(result.current.nights[0]!.date).toBe('2024-01-15');

      expect(result.current.allSegments).toEqual([
        { stage: 'wake', startMs: t0, endMs: t0 + 60_000 },
        { stage: 'light', startMs: t0 + 60_000, endMs: t0 + 60_000 + 600_000 },
        { stage: 'deep', startMs: t0 + 660_000, endMs: t0 + 660_000 + 1_200_000 },
      ]);

      // Night window spans the first segment start to the last segment end.
      expect(result.current.nights[0]!.startMs).toBe(t0);
      expect(result.current.nights[0]!.endMs).toBe(t0 + 660_000 + 1_200_000);
    });

    it('drops a transition with an unparseable timestamp and keeps the valid ones', async () => {
      const t0 = Date.UTC(2024, 0, 15, 22, 30, 0);
      await seed([
        stagesRecord('2024-01-15', {
          transitions: [
            { timestamp: '2024-01-15T22:30:00', stage: 'light', durationSeconds: 300 },
            { timestamp: 'not-a-timestamp', stage: 'deep', durationSeconds: 300 },
            { timestamp: '2024-01-15T22:40:00', stage: 'rem', durationSeconds: 300 },
          ],
        }),
      ]);

      const { result } = renderHook(() => useSleepStageEventContext(false));
      await waitFor(() => expect(result.current.loading).toBe(false));

      // Only the two parseable segments survive; the garbage one is skipped.
      expect(result.current.allSegments).toEqual([
        { stage: 'light', startMs: t0, endMs: t0 + 300_000 },
        {
          stage: 'rem',
          startMs: Date.UTC(2024, 0, 15, 22, 40, 0),
          endMs: Date.UTC(2024, 0, 15, 22, 40, 0) + 300_000,
        },
      ]);
      expect(result.current.hasStageData).toBe(true);
    });
  });

  describe('includeHr gating', () => {
    const stages: FitbitSleepStages = {
      transitions: [{ timestamp: '2024-01-15T23:00:00', stage: 'light', durationSeconds: 600 }],
    };
    const hr: FitbitHeartRateIntraday = {
      baseTimestampMs: Date.UTC(2024, 0, 15, 23, 0, 0),
      samples: [
        { offsetSec: 0, bpm: 60, confidence: 3 },
        { offsetSec: 5, bpm: 61, confidence: 2 },
      ],
      sampleCount: 2,
    };

    it('skips HR entirely when includeHr=false even though HR records exist', async () => {
      await seed([stagesRecord('2024-01-15', stages), hrRecord('2024-01-15', hr)]);

      const { result } = renderHook(() => useSleepStageEventContext(false));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.hasStageData).toBe(true);
      expect(result.current.hrSamples).toEqual([]);
      expect(result.current.hasHrData).toBe(false);
      expect(result.current.hrRangeTooLarge).toBe(false);
    });

    it('loads HR when includeHr=true', async () => {
      await seed([stagesRecord('2024-01-15', stages), hrRecord('2024-01-15', hr)]);

      const { result } = renderHook(() => useSleepStageEventContext(true));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.hasHrData).toBe(true);
      expect(result.current.hrSamples).toEqual([
        { timestampMs: hr.baseTimestampMs, bpm: 60, confidence: 3 },
        { timestampMs: hr.baseTimestampMs + 5000, bpm: 61, confidence: 2 },
      ]);
    });
  });

  describe('HR numeric guards', () => {
    it('reports hasHrData=false when every sample is non-finite (NaN bpm)', async () => {
      const hr: FitbitHeartRateIntraday = {
        baseTimestampMs: Date.UTC(2024, 0, 15, 23, 0, 0),
        samples: [
          { offsetSec: 0, bpm: NaN, confidence: 3 },
          { offsetSec: 5, bpm: Number.NaN, confidence: 2 },
        ],
        sampleCount: 2,
      };
      await seed([hrRecord('2024-01-15', hr)]);

      const { result } = renderHook(() => useSleepStageEventContext(true));
      await waitFor(() => expect(result.current.loading).toBe(false));

      // Availability is derived AFTER filtering: a record full of NaN bpm must
      // not report hasHrData=true.
      expect(result.current.hrSamples).toEqual([]);
      expect(result.current.hasHrData).toBe(false);
      expect(result.current.hrRangeTooLarge).toBe(false);
    });
  });

  describe('hrRangeTooLarge bound (MAX_HR_NIGHTS = 60)', () => {
    function manyHrNights(count: number): IntegrationTimeseries[] {
      // One HR record per consecutive calendar day, each with a single sample.
      // Day-of-month walks 2024-01-02.. (kept well inside a ±1-day-widened
      // January range so all are returned by the date-range query).
      return Array.from({ length: count }, (_, i) => {
        const day = i + 2; // 2..(count+1)
        const date = `2024-01-${String(day).padStart(2, '0')}`;
        return hrRecord(date, {
          baseTimestampMs: Date.UTC(2024, 0, day, 12, 0, 0),
          samples: [{ offsetSec: 0, bpm: 60, confidence: 3 }],
          sampleCount: 1,
        });
      });
    }

    it('refuses to load HR (hrRangeTooLarge=true, empty samples) when records exceed the bound', async () => {
      setRange('2024-01-01', '2024-01-31');
      await seed(manyHrNights(61)); // > MAX_HR_NIGHTS

      const { result } = renderHook(() => useSleepStageEventContext(true));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.hrRangeTooLarge).toBe(true);
      expect(result.current.hrSamples).toEqual([]);
      expect(result.current.hasHrData).toBe(false);
    });

    it('loads HR normally when records are at/under the bound', async () => {
      setRange('2024-01-01', '2024-01-31');
      await seed(manyHrNights(60)); // == MAX_HR_NIGHTS (not over)

      const { result } = renderHook(() => useSleepStageEventContext(true));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.hrRangeTooLarge).toBe(false);
      expect(result.current.hasHrData).toBe(true);
      expect(result.current.hrSamples).toHaveLength(60);
    });
  });

  describe('±1-day range widening', () => {
    it('surfaces a night stored one day before the range start (midnight straddle)', async () => {
      // Selected range is a single day; the night record sits on the day BEFORE
      // it. The ±1-day widening must still return it.
      setRange('2024-01-16', '2024-01-16');
      const t0 = Date.UTC(2024, 0, 15, 23, 30, 0);
      await seed([
        stagesRecord('2024-01-15', {
          transitions: [
            { timestamp: '2024-01-15T23:30:00', stage: 'light', durationSeconds: 1800 },
          ],
        }),
      ]);

      const { result } = renderHook(() => useSleepStageEventContext(false));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.nights).toHaveLength(1);
      expect(result.current.nights[0]!.date).toBe('2024-01-15');
      expect(result.current.allSegments).toEqual([
        { stage: 'light', startMs: t0, endMs: t0 + 1_800_000 },
      ]);
    });

    it('surfaces a night stored one day after the range end', async () => {
      setRange('2024-01-15', '2024-01-15');
      const t0 = Date.UTC(2024, 0, 16, 0, 15, 0);
      await seed([
        stagesRecord('2024-01-16', {
          transitions: [{ timestamp: '2024-01-16T00:15:00', stage: 'deep', durationSeconds: 600 }],
        }),
      ]);

      const { result } = renderHook(() => useSleepStageEventContext(false));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.nights).toHaveLength(1);
      expect(result.current.nights[0]!.date).toBe('2024-01-16');
      expect(result.current.allSegments).toEqual([
        { stage: 'deep', startMs: t0, endMs: t0 + 600_000 },
      ]);
    });
  });

  describe('stale-request sequencing', () => {
    // NOTE: fake-indexeddb resolves queries in FIFO order, so we cannot
    // deterministically force the FIRST (wider) request to resolve AFTER the
    // second without brittle internal mocking. The monotonic requestId guard is
    // unit-covered indirectly here: after the dependency (date range) changes we
    // assert the hook converges on the LATEST range's result with no stale
    // segments from the prior range leaking through. A truly out-of-order
    // resolution test would be flaky, so it is intentionally omitted.
    it('converges on the latest date range after a change, dropping the prior result', async () => {
      // Night A only in range R1; night B only in range R2 (non-overlapping,
      // accounting for ±1-day widening: R1 widened is 2024-02-09..2024-02-11,
      // R2 widened is 2024-03-09..2024-03-11).
      const aStart = Date.UTC(2024, 1, 10, 23, 0, 0);
      const bStart = Date.UTC(2024, 2, 10, 23, 0, 0);
      await seed([
        stagesRecord('2024-02-10', {
          transitions: [{ timestamp: '2024-02-10T23:00:00', stage: 'light', durationSeconds: 600 }],
        }),
        stagesRecord('2024-03-10', {
          transitions: [{ timestamp: '2024-03-10T23:00:00', stage: 'deep', durationSeconds: 600 }],
        }),
      ]);

      setRange('2024-02-10', '2024-02-10');
      const { result, rerender } = renderHook(() => useSleepStageEventContext(false));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.allSegments).toEqual([
        { stage: 'light', startMs: aStart, endMs: aStart + 600_000 },
      ]);

      // Change the global range; the effect re-runs on the new start/end strings.
      setRange('2024-03-10', '2024-03-10');
      rerender();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.allSegments).toEqual([
          { stage: 'deep', startMs: bStart, endMs: bStart + 600_000 },
        ]);
      });
      // The prior range's segment did not leak into the latest result.
      expect(result.current.nights).toHaveLength(1);
      expect(result.current.nights[0]!.date).toBe('2024-03-10');
    });
  });

  describe('empty / no data', () => {
    it('resolves to the empty state when no records match', async () => {
      // DB seeded with nothing; range has no overlapping records.
      const { result } = renderHook(() => useSleepStageEventContext(true));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.hasStageData).toBe(false);
      expect(result.current.nights).toEqual([]);
      expect(result.current.allSegments).toEqual([]);
      expect(result.current.hrSamples).toEqual([]);
      expect(result.current.hasHrData).toBe(false);
      expect(result.current.hrRangeTooLarge).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });
});
