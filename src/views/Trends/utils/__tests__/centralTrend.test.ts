import { describe, it, expect } from 'vitest';
import { detectRisingCentralTrend, MIN_NIGHTS_PER_HALF } from '@/views/Trends/utils/centralTrend';
import type { NightlyAggregate } from '@/types';

/** Minimal NightlyAggregate fixture; override the fields the trend reads. */
function makeAggregate(overrides: Partial<NightlyAggregate> = {}): NightlyAggregate {
  return {
    id: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    machineId: 'SN-1',
    date: overrides.date ?? '2025-06-15',
    ahi: 3,
    ahiObstructive: 1.5,
    ahiCentral: overrides.ahiCentral ?? 0.5,
    ahiMixed: 0,
    ahiHypopnea: 1,
    ahiRera: 0,
    eventCount: 20,
    eventsByType: {
      obstructive: 12,
      central: 4,
      mixed: 0,
      hypopnea: 8,
      rera: 0,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
    },
    pressureMean: 10,
    pressureMedian: 9.8,
    pressureP95: 12,
    pressureMax: 14,
    epapMedian: null,
    ipapMedian: null,
    pressureSupport: null,
    leakMedian: 8,
    leakP95: 15,
    leakMax: 25,
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
    usageHours: overrides.usageHours ?? 7,
    maskOnTimeMinutes: 420,
    complianceStatus: 'compliant',
    configuredMinPressure: null,
    configuredMaxPressure: null,
    eprLevel: null,
    notes: '',
    tags: [],
    ...overrides,
  };
}

/** Build N consecutive nights with a per-night central index. */
function nights(centrals: number[], usageHours = 7): NightlyAggregate[] {
  return centrals.map((c, i) =>
    makeAggregate({
      date: `2025-06-${String(i + 1).padStart(2, '0')}`,
      ahiCentral: c,
      usageHours,
    }),
  );
}

describe('detectRisingCentralTrend', () => {
  it('flags a clearly rising central trend', () => {
    // earlier half ~0.5/h, later half ~4/h → rising
    const data = nights([0.5, 0.5, 0.5, 4, 4, 4]);
    const result = detectRisingCentralTrend(data);
    expect(result.rising).toBe(true);
    expect(result.laterIndex).toBeGreaterThan(result.earlierIndex);
  });

  it('does not flag a flat (stable) central trend', () => {
    const data = nights([1, 1, 1, 1, 1, 1]);
    expect(detectRisingCentralTrend(data).rising).toBe(false);
  });

  it('does not flag a falling central trend', () => {
    const data = nights([5, 5, 5, 1, 1, 1]);
    expect(detectRisingCentralTrend(data).rising).toBe(false);
  });

  it('does not flag a rise that stays below the absolute floor (near-zero noise)', () => {
    // 0.1 → 0.4 is a >100% relative rise but the later index is < 1.0/h floor.
    const data = nights([0.1, 0.1, 0.1, 0.4, 0.4, 0.4]);
    expect(detectRisingCentralTrend(data).rising).toBe(false);
  });

  it('is order-independent (sorts by date)', () => {
    const data = nights([0.5, 0.5, 0.5, 4, 4, 4]);
    const shuffled = [data[3]!, data[0]!, data[5]!, data[2]!, data[4]!, data[1]!];
    expect(detectRisingCentralTrend(shuffled).rising).toBe(true);
  });

  it('usage-weights so a single short spurious night does not trip the trend', () => {
    // Six benign well-used nights plus more well-used benign nights; a single
    // 0.2h night at 60/h must not, on its own, manufacture a rising trend.
    const data = nights([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    data.push(makeAggregate({ date: '2025-06-07', ahiCentral: 60, usageHours: 0.2 }));
    expect(detectRisingCentralTrend(data).rising).toBe(false);
  });

  describe('short-window / empty edge cases', () => {
    it('returns rising:false for empty input', () => {
      expect(detectRisingCentralTrend([])).toEqual({
        rising: false,
        earlierIndex: 0,
        laterIndex: 0,
      });
    });

    it('returns rising:false when there are too few qualifying nights per half', () => {
      // Fewer than MIN_NIGHTS_PER_HALF * 2 qualifying nights → no trend claim.
      const data = nights([0.5, 5, 5].slice(0, MIN_NIGHTS_PER_HALF * 2 - 1));
      expect(detectRisingCentralTrend(data).rising).toBe(false);
    });

    it('excludes sub-1h nights from the qualifying count', () => {
      // Six nights but all under the usage floor → none qualify → no trend.
      const data = nights([1, 1, 1, 4, 4, 4], 0.5);
      expect(detectRisingCentralTrend(data).rising).toBe(false);
    });
  });
});
