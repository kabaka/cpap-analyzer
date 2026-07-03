/**
 * Shared test fixtures for the grounded-context layer.
 *
 * Provides a fully-populated `NightlyAggregate` and the common builder input so
 * each spec can override just the fields it exercises. NOT production code.
 *
 * @module services/llm/context/__tests__/fixtures
 */

import type { NightlyAggregate } from '@/types/session';
import { AHI_SEVERITY_THRESHOLDS } from '@/analysis/clinical/ahiSeverity';
import type { GroundingCommonInput } from '../buildGroundedContext';
import type { DisplayUnitPreferences } from '../types';

export const DISPLAY: DisplayUnitPreferences = {
  dateFormat: 'YYYY-MM-DD',
  timeFormat: '24h',
  pressureUnit: 'cmH2O',
  leakUnit: 'L/min',
  tidalVolumeUnit: 'mL',
};

export const COMMON: GroundingCommonInput = {
  ahiThresholds: AHI_SEVERITY_THRESHOLDS,
  ahiThresholdsSource: 'aasm-icsd3-default',
  machineClass: 'APAP',
  display: DISPLAY,
  generatedOnDate: '2026-06-21',
};

/**
 * A complete, healthy-looking aggregate. AHI 4.2 (normal under defaults), high
 * usage, low leak, oximetry present. Override per-test for edge cases.
 */
export function makeAggregate(overrides: Partial<NightlyAggregate> = {}): NightlyAggregate {
  const base: NightlyAggregate = {
    id: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    machineId: 'SERIAL-DO-NOT-LEAK',
    date: '2026-06-20',

    ahi: 4.2,
    rdi: 5.1,
    ahiObstructive: 2.0,
    ahiCentral: 0.4,
    ahiMixed: 0.1,
    ahiUnclassified: 0.1,
    ahiHypopnea: 1.6,
    ahiRera: 0.9,

    eventCount: 34,
    eventsByType: {
      obstructive: 16,
      central: 3,
      mixed: 1,
      unclassified: 1,
      hypopnea: 13,
      rera: 7,
      flowLimitation: 40,
      largeLeak: 0,
      periodicBreathing: 0,
    },

    pressureMean: 9.4,
    pressureMedian: 9.2,
    pressureP95: 11.8,
    pressureMax: 12.4,
    epapMedian: null,
    ipapMedian: null,
    pressureSupport: null,

    leakMedian: 6,
    leakP95: 18,
    leakMax: 27,
    leakDurationMinutes: 2,

    tidalVolumeMean: 480,
    tidalVolumeMedian: 470,
    minuteVentMean: 6.8,
    respRateMean: 14,
    respRateMedian: 14,

    spo2Mean: 95,
    spo2Median: 96,
    spo2Min: 88,
    spo2Below90Percent: 1.2,
    spo2CoveragePercent: 92,
    oxygenDesaturationIndex: 3.4,

    usageHours: 7.3,
    maskOnTimeMinutes: 438,
    complianceStatus: 'compliant',

    configuredMinPressure: 6,
    configuredMaxPressure: 14,
    eprLevel: 2,

    notes: 'SECRET PATIENT NOTE — do not leak',
    tags: ['private-tag'],
  };
  return { ...base, ...overrides };
}
