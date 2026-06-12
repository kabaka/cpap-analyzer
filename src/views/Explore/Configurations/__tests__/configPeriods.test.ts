/**
 * Tests for the configuration-period segmentation helper used by the Machine
 * Configurations comparison view.
 *
 * @module views/Explore/Configurations/__tests__/configPeriods.test
 */

import { describe, expect, it } from 'vitest';
import type { NightlyAggregate } from '@/types';
import { buildConfigPeriods, formatConfigKey, type ConfigPeriod } from '../configPeriods';

/**
 * Build a minimal NightlyAggregate carrying just the settings + outcome
 * fields the configPeriods helper reads.
 */
function makeAggregate(overrides: Partial<NightlyAggregate> = {}): NightlyAggregate {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    machineId: 'SN-123',
    date: overrides.date ?? '2025-06-15',
    ahi: 3.0,
    ahiObstructive: 1.5,
    ahiCentral: 0.5,
    ahiMixed: 0.0,
    ahiHypopnea: 1.0,
    ahiRera: 0.0,
    eventCount: 24,
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
    pressureMean: 10.0,
    pressureMedian: 9.8,
    pressureP95: 12.0,
    pressureMax: 14.0,
    epapMedian: null,
    ipapMedian: null,
    pressureSupport: null,
    leakMedian: 8.0,
    leakP95: 15.0,
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
    usageHours: 7.0,
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

describe('buildConfigPeriods', () => {
  it('returns an empty list for empty input', () => {
    expect(buildConfigPeriods([])).toEqual([]);
  });

  it('groups consecutive nights with identical settings into one period', () => {
    const nights = [
      makeAggregate({
        date: '2025-06-01',
        configuredMinPressure: 6,
        configuredMaxPressure: 15,
        eprLevel: 2,
        ahi: 2,
      }),
      makeAggregate({
        date: '2025-06-02',
        configuredMinPressure: 6,
        configuredMaxPressure: 15,
        eprLevel: 2,
        ahi: 4,
      }),
      makeAggregate({
        date: '2025-06-03',
        configuredMinPressure: 6,
        configuredMaxPressure: 15,
        eprLevel: 2,
        ahi: 3,
      }),
    ];
    const periods = buildConfigPeriods(nights);
    expect(periods).toHaveLength(1);
    expect(periods[0]?.kind).toBe('config');
    expect(periods[0]?.nights).toBe(3);
    expect(periods[0]?.startDate).toBe('2025-06-01');
    expect(periods[0]?.endDate).toBe('2025-06-03');
    expect(periods[0]?.outcomes.ahi?.mean).toBeCloseTo(3, 5);
    expect(periods[0]?.outcomes.ahi?.median).toBeCloseTo(3, 5);
  });

  it('splits the series at a settings-change boundary', () => {
    const nights = [
      makeAggregate({
        date: '2025-06-01',
        configuredMinPressure: 6,
        configuredMaxPressure: 12,
        eprLevel: 2,
      }),
      makeAggregate({
        date: '2025-06-02',
        configuredMinPressure: 6,
        configuredMaxPressure: 12,
        eprLevel: 2,
      }),
      makeAggregate({
        date: '2025-06-03',
        configuredMinPressure: 6,
        configuredMaxPressure: 15, // changed
        eprLevel: 2,
      }),
      makeAggregate({
        date: '2025-06-04',
        configuredMinPressure: 6,
        configuredMaxPressure: 15,
        eprLevel: 2,
      }),
    ];
    const periods = buildConfigPeriods(nights);
    expect(periods).toHaveLength(2);
    expect(periods[0]?.endDate).toBe('2025-06-02');
    expect(periods[1]?.startDate).toBe('2025-06-03');
    expect(periods[1]?.settings.maxPressure).toBe(15);
  });

  it('sorts input by date before segmenting', () => {
    const nights = [
      makeAggregate({
        date: '2025-06-03',
        configuredMaxPressure: 15,
        configuredMinPressure: 6,
        eprLevel: 2,
      }),
      makeAggregate({
        date: '2025-06-01',
        configuredMaxPressure: 12,
        configuredMinPressure: 6,
        eprLevel: 2,
      }),
      makeAggregate({
        date: '2025-06-02',
        configuredMaxPressure: 12,
        configuredMinPressure: 6,
        eprLevel: 2,
      }),
    ];
    const periods = buildConfigPeriods(nights);
    expect(periods).toHaveLength(2);
    expect(periods[0]?.startDate).toBe('2025-06-01');
    expect(periods[1]?.startDate).toBe('2025-06-03');
  });

  it('places nights with no recorded settings into their own unknown period', () => {
    const nights = [
      makeAggregate({
        date: '2025-06-01',
        configuredMinPressure: 6,
        configuredMaxPressure: 12,
        eprLevel: 2,
      }),
      makeAggregate({
        date: '2025-06-02',
        configuredMinPressure: null,
        configuredMaxPressure: null,
        eprLevel: null,
      }),
      makeAggregate({
        date: '2025-06-03',
        configuredMinPressure: null,
        configuredMaxPressure: null,
        eprLevel: null,
      }),
      makeAggregate({
        date: '2025-06-04',
        configuredMinPressure: 6,
        configuredMaxPressure: 12,
        eprLevel: 2,
      }),
    ];
    const periods = buildConfigPeriods(nights);
    expect(periods).toHaveLength(3);
    expect(periods[1]?.kind).toBe('unknown');
    expect(periods[1]?.nights).toBe(2);
    expect(periods[1]?.outcomes.ahi).toBeNull();
    // Adjacent real-config periods are not merged across the gap — they are
    // distinct periods because the unknown gap separates them.
    expect(periods[0]?.kind).toBe('config');
    expect(periods[2]?.kind).toBe('config');
  });

  it('guards against the sentinel-config row (max pressure ≤ 1 cmH₂O)', () => {
    const nights = [
      makeAggregate({
        date: '2025-06-01',
        configuredMinPressure: 6,
        configuredMaxPressure: 12,
        eprLevel: 2,
      }),
      makeAggregate({
        date: '2025-06-02',
        configuredMinPressure: 0,
        configuredMaxPressure: 0, // sentinel
        eprLevel: 0,
      }),
      makeAggregate({
        date: '2025-06-03',
        configuredMinPressure: 6,
        configuredMaxPressure: 12,
        eprLevel: 2,
      }),
    ];
    const periods = buildConfigPeriods(nights);
    expect(periods).toHaveLength(3);
    expect(periods[1]?.kind).toBe('sentinel');
    expect(periods[1]?.outcomes.ahi).toBeNull();
  });

  it('aggregates AHI mean, median, P95, IQR, stdDev correctly', () => {
    const ahis = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const nights = ahis.map((ahi, i) =>
      makeAggregate({
        date: `2025-06-${String(i + 1).padStart(2, '0')}`,
        configuredMinPressure: 6,
        configuredMaxPressure: 15,
        eprLevel: 2,
        ahi,
      }),
    );
    const periods = buildConfigPeriods(nights);
    expect(periods).toHaveLength(1);
    const ahiSummary = periods[0]?.outcomes.ahi;
    expect(ahiSummary).not.toBeNull();
    expect(ahiSummary?.n).toBe(10);
    expect(ahiSummary?.mean).toBeCloseTo(5.5, 5);
    expect(ahiSummary?.median).toBeCloseTo(5.5, 5);
    // P95 of 1..10 with linear interpolation between Q3 and max — well above
    // the median.
    expect(ahiSummary?.p95).toBeGreaterThan(9);
    // Sample stdDev of 1..10 is ~3.0277.
    expect(ahiSummary?.stdDev).toBeCloseTo(3.0277, 3);
    expect(ahiSummary?.min).toBe(1);
    expect(ahiSummary?.max).toBe(10);
  });

  it('produces stable period IDs the comparison view can use as React keys', () => {
    const nights = [
      makeAggregate({
        date: '2025-06-01',
        configuredMinPressure: 6,
        configuredMaxPressure: 15,
        eprLevel: 2,
      }),
    ];
    const periods = buildConfigPeriods(nights);
    expect(periods[0]?.id).toBe('cfg-2025-06-01-6-15-2');
  });
});

describe('formatConfigKey', () => {
  it('formats a full APAP key compactly', () => {
    expect(formatConfigKey({ minPressure: 6, maxPressure: 15, eprLevel: 2 })).toMatch(
      /6\.0.*15\.0.*EPR 2/,
    );
  });

  it('falls back when only max pressure is set', () => {
    expect(formatConfigKey({ minPressure: null, maxPressure: 12, eprLevel: null })).toContain(
      'max 12.0',
    );
  });

  it('returns a friendly placeholder when nothing is recorded', () => {
    expect(formatConfigKey({ minPressure: null, maxPressure: null, eprLevel: null })).toBe(
      'No settings recorded',
    );
  });
});

// Type re-export sanity check — keeps the public surface from silently
// shrinking on refactor.
describe('ConfigPeriod type', () => {
  it('exposes the documented shape', () => {
    const period: ConfigPeriod = {
      id: 'cfg-x',
      kind: 'config',
      settings: { minPressure: 4, maxPressure: 20, eprLevel: 3 },
      startDate: '2025-01-01',
      endDate: '2025-01-02',
      nights: 2,
      aggregates: [],
      outcomes: {
        ahi: null,
        centralIndex: null,
        obstructiveIndex: null,
        leakMedian: null,
        leakP95: null,
        usageHours: null,
      },
    };
    expect(period.id).toBe('cfg-x');
  });
});
