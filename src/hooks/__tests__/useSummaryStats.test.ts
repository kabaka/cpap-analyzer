import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSummaryStats } from '@/hooks/useSummaryStats';
import { resetDB, getDB } from '@/services/storage/getDB';
import type { NightlyAggregate } from '@/types';

/** Minimal valid NightlyAggregate fixture. */
function makeAggregate(overrides: Partial<NightlyAggregate> = {}): NightlyAggregate {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    machineId: 'SN-123',
    date: overrides.date ?? '2025-06-15',
    ahi: overrides.ahi ?? 5.0,
    ahiObstructive: 2.0,
    ahiCentral: 1.0,
    ahiMixed: 0.5,
    ahiHypopnea: 1.0,
    ahiRera: 0.5,
    eventCount: 40,
    eventsByType: {
      obstructive: 16,
      central: 8,
      mixed: 4,
      hypopnea: 8,
      rera: 4,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
    },
    pressureMean: 10.0,
    pressureMedian: 9.8,
    pressureP95: 12.0,
    pressureMax: 14.0,
    epapMedian: null,
    ipapMedian: null,
    pressureSupport: null,
    leakMedian: overrides.leakMedian ?? 8.0,
    leakP95: overrides.leakP95 ?? 15.0,
    leakMax: 25.0,
    leakDurationMinutes: 5,
    tidalVolumeMean: null,
    tidalVolumeMedian: null,
    minuteVentMean: null,
    respRateMean: null,
    respRateMedian: null,
    spo2Mean: null,
    spo2Median: null,
    spo2Min: null,
    spo2Below90Percent: null,
    oxygenDesaturationIndex: null,
    usageHours: overrides.usageHours ?? 7.0,
    maskOnTimeMinutes: 420,
    complianceStatus: overrides.complianceStatus ?? 'compliant',
    configuredMinPressure: null,
    configuredMaxPressure: null,
    eprLevel: null,
    notes: '',
    tags: [],
    ...overrides,
  };
}

describe('useSummaryStats', () => {
  beforeEach(async () => {
    // Destroy the database to clear data from previous tests, then reset the singleton
    try {
      const db = await getDB();
      await db.destroy();
    } catch {
      // Ignore if DB doesn't exist yet
    }
    resetDB();
  });

  it('should return null stats when no aggregates exist', async () => {
    const dateRange = { start: new Date('2025-01-01'), end: new Date('2025-12-31') };
    const { result } = renderHook(() => useSummaryStats(dateRange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // computeStats returns zeroed stats for empty array, not null
    expect(result.current.stats).toBeDefined();
    expect(result.current.stats!.totalSessions).toBe(0);
    expect(result.current.stats!.meanAHI).toBe(0);
    expect(result.current.stats!.trendData).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should compute correct mean and median AHI from aggregates', async () => {
    const db = await getDB();
    // AHI values: 4, 6, 10 → mean = 20/3 ≈ 6.667, median = 6
    await db.addNightlyAggregate(makeAggregate({ date: '2025-06-01', ahi: 4 }));
    await db.addNightlyAggregate(makeAggregate({ date: '2025-06-02', ahi: 6 }));
    await db.addNightlyAggregate(makeAggregate({ date: '2025-06-03', ahi: 10 }));

    const dateRange = { start: new Date('2025-06-01'), end: new Date('2025-06-30') };
    const { result } = renderHook(() => useSummaryStats(dateRange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stats).not.toBeNull();
    expect(result.current.stats!.meanAHI).toBeCloseTo(6.667, 2);
    expect(result.current.stats!.medianAHI).toBe(6);
    expect(result.current.stats!.totalSessions).toBe(3);
  });

  it('should compute correct compliance rate', async () => {
    const db = await getDB();
    // 2 compliant, 1 non-compliant → compliance rate = 2/3 ≈ 0.667
    await db.addNightlyAggregate(
      makeAggregate({ date: '2025-06-01', complianceStatus: 'compliant' }),
    );
    await db.addNightlyAggregate(
      makeAggregate({ date: '2025-06-02', complianceStatus: 'compliant' }),
    );
    await db.addNightlyAggregate(
      makeAggregate({ date: '2025-06-03', complianceStatus: 'non-compliant' }),
    );

    const dateRange = { start: new Date('2025-06-01'), end: new Date('2025-06-30') };
    const { result } = renderHook(() => useSummaryStats(dateRange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stats!.complianceRate).toBeCloseTo(0.667, 2);
  });

  it('should build trend data from the last 30 entries sorted by date', async () => {
    const db = await getDB();
    // Add 35 aggregates — trend should contain only the last 30
    for (let i = 1; i <= 35; i++) {
      const date =
        i <= 30
          ? `2025-06-${String(i).padStart(2, '0')}`
          : `2025-07-${String(i - 30).padStart(2, '0')}`;
      await db.addNightlyAggregate(makeAggregate({ date, ahi: i }));
    }

    const dateRange = { start: new Date('2025-06-01'), end: new Date('2025-07-31') };
    const { result } = renderHook(() => useSummaryStats(dateRange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stats!.trendData).toHaveLength(30);
    // Trend should be sorted by date ascending
    const dates = result.current.stats!.trendData.map((t) => t.date);
    const sortedDates = [...dates].sort();
    expect(dates).toEqual(sortedDates);
  });

  it('weights mean AHI by usage hours (unequal usage)', async () => {
    const db = await getDB();
    // Night A: ahi=10 over 8 h; Night B: ahi=2 over 1 h.
    // Pooled (duration-weighted) mean = (10*8 + 2*1) / (8 + 1) = 82/9 ≈ 9.111,
    // NOT the unweighted (10 + 2)/2 = 6.0 — a long high-AHI night must dominate.
    await db.addNightlyAggregate(makeAggregate({ date: '2025-06-01', ahi: 10, usageHours: 8 }));
    await db.addNightlyAggregate(makeAggregate({ date: '2025-06-02', ahi: 2, usageHours: 1 }));

    const dateRange = { start: new Date('2025-06-01'), end: new Date('2025-06-30') };
    const { result } = renderHook(() => useSummaryStats(dateRange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stats).not.toBeNull();
    expect(result.current.stats!.meanAHI).toBeCloseTo(82 / 9, 3);
    // Guard against a regression to the unweighted arithmetic mean.
    expect(result.current.stats!.meanAHI).not.toBeCloseTo(6.0, 3);
  });

  it('excludes null-AHI short sessions from mean, median, and trend', async () => {
    const db = await getDB();
    // Three valid nights (equal usage so pooled == unweighted): ahi 4, 6, 8.
    await db.addNightlyAggregate(makeAggregate({ date: '2025-06-01', ahi: 4, usageHours: 7 }));
    await db.addNightlyAggregate(makeAggregate({ date: '2025-06-02', ahi: 6, usageHours: 7 }));
    await db.addNightlyAggregate(makeAggregate({ date: '2025-06-03', ahi: 8, usageHours: 7 }));
    // A sub-floor mask-fit clip: AHI is undefined (null), tiny usage hours.
    await db.addNightlyAggregate(
      makeAggregate({
        date: '2025-06-04',
        ahi: null,
        usageHours: 0.01,
        eventCount: 1,
        eventsByType: {
          obstructive: 1,
          central: 0,
          mixed: 0,
          hypopnea: 0,
          rera: 0,
          flowLimitation: 0,
          largeLeak: 0,
          periodicBreathing: 0,
        },
      }),
    );

    const dateRange = { start: new Date('2025-06-01'), end: new Date('2025-06-30') };
    const { result } = renderHook(() => useSummaryStats(dateRange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stats).not.toBeNull();
    // Pooled over the 3 valid nights only (equal usage) = (4 + 6 + 8)/3 = 6.0.
    expect(result.current.stats!.meanAHI).toBeCloseTo(6.0, 3);
    // Median of [4, 6, 8] with the null night excluded.
    expect(result.current.stats!.medianAHI).toBe(6);
    // The null night still counts as a session.
    expect(result.current.stats!.totalSessions).toBe(4);

    // The null night must appear in the trend as a gap (ahi === null), never 0.
    const nullPoint = result.current.stats!.trendData.find((t) => t.date === '2025-06-04');
    expect(nullPoint).toBeDefined();
    expect(nullPoint!.ahi).toBeNull();
    expect(nullPoint!.ahi).not.toBe(0);
  });

  it('trendData carries null AHI as a gap, not zero', async () => {
    const db = await getDB();
    await db.addNightlyAggregate(makeAggregate({ date: '2025-06-01', ahi: 5, usageHours: 7 }));
    await db.addNightlyAggregate(makeAggregate({ date: '2025-06-02', ahi: null, usageHours: 0.5 }));

    const dateRange = { start: new Date('2025-06-01'), end: new Date('2025-06-30') };
    const { result } = renderHook(() => useSummaryStats(dateRange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stats).not.toBeNull();
    const nullPoint = result.current.stats!.trendData.find((t) => t.date === '2025-06-02');
    expect(nullPoint).toBeDefined();
    expect(nullPoint!.ahi).toBeNull();
  });

  it('should handle errors gracefully', async () => {
    const mockGetDB = vi.spyOn(await import('@/services/storage/getDB'), 'getDB');
    mockGetDB.mockRejectedValueOnce(new Error('DB failure'));

    const dateRange = { start: new Date('2025-01-01'), end: new Date('2025-12-31') };
    const { result } = renderHook(() => useSummaryStats(dateRange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('DB failure');
    expect(result.current.stats).toBeNull();

    mockGetDB.mockRestore();
  });
});
