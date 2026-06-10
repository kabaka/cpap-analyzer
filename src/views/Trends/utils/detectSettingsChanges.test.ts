import { describe, it, expect } from 'vitest';
import {
  settingsDiffer,
  findFirstSettingsChangeDate,
  detectSettingsChanges,
} from './detectSettingsChanges';
import type { NightlyAggregate } from '@/types';

/** Minimal NightlyAggregate carrying only the settings-relevant fields. */
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
    configuredMinPressure: overrides.configuredMinPressure ?? null,
    configuredMaxPressure: overrides.configuredMaxPressure ?? null,
    eprLevel: overrides.eprLevel ?? null,
    notes: '',
    tags: [],
    ...overrides,
  };
}

describe('settingsDiffer', () => {
  it('returns false for identical configured settings', () => {
    const a = makeAggregate({ configuredMinPressure: 4, configuredMaxPressure: 15, eprLevel: 2 });
    const b = makeAggregate({ configuredMinPressure: 4, configuredMaxPressure: 15, eprLevel: 2 });
    expect(settingsDiffer(a, b)).toBe(false);
  });

  it('detects a min-pressure difference', () => {
    const a = makeAggregate({ configuredMinPressure: 4 });
    const b = makeAggregate({ configuredMinPressure: 6 });
    expect(settingsDiffer(a, b)).toBe(true);
  });

  it('detects a max-pressure difference', () => {
    const a = makeAggregate({ configuredMaxPressure: 15 });
    const b = makeAggregate({ configuredMaxPressure: 20 });
    expect(settingsDiffer(a, b)).toBe(true);
  });

  it('detects an EPR-level difference', () => {
    const a = makeAggregate({ eprLevel: 1 });
    const b = makeAggregate({ eprLevel: 3 });
    expect(settingsDiffer(a, b)).toBe(true);
  });

  it('treats null vs a value as different', () => {
    const a = makeAggregate({ configuredMinPressure: null });
    const b = makeAggregate({ configuredMinPressure: 4 });
    expect(settingsDiffer(a, b)).toBe(true);
  });
});

describe('detectSettingsChanges', () => {
  it('returns no changes for fewer than two nights', () => {
    expect(detectSettingsChanges([])).toEqual([]);
    expect(detectSettingsChanges([makeAggregate()])).toEqual([]);
  });

  it('returns the change dated to the FIRST night under the new settings', () => {
    const aggregates = [
      makeAggregate({ date: '2025-06-01', configuredMinPressure: 4 }),
      makeAggregate({ date: '2025-06-02', configuredMinPressure: 4 }),
      makeAggregate({ date: '2025-06-03', configuredMinPressure: 6 }),
    ];
    const changes = detectSettingsChanges(aggregates);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.date).toBe('2025-06-03');
    expect(changes[0]!.from.minPressure).toBe(4);
    expect(changes[0]!.to.minPressure).toBe(6);
  });

  it('sorts unsorted input by date before comparing', () => {
    const aggregates = [
      makeAggregate({ date: '2025-06-03', configuredMinPressure: 6 }),
      makeAggregate({ date: '2025-06-01', configuredMinPressure: 4 }),
      makeAggregate({ date: '2025-06-02', configuredMinPressure: 4 }),
    ];
    const changes = detectSettingsChanges(aggregates);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.date).toBe('2025-06-03');
  });

  it('reports multiple consecutive changes', () => {
    const aggregates = [
      makeAggregate({ date: '2025-06-01', configuredMinPressure: 4 }),
      makeAggregate({ date: '2025-06-02', configuredMinPressure: 6 }),
      makeAggregate({ date: '2025-06-03', configuredMinPressure: 8 }),
    ];
    const changes = detectSettingsChanges(aggregates);
    expect(changes.map((c) => c.date)).toEqual(['2025-06-02', '2025-06-03']);
  });
});

describe('findFirstSettingsChangeDate', () => {
  it('returns null for fewer than two nights', () => {
    expect(findFirstSettingsChangeDate([])).toBeNull();
    expect(findFirstSettingsChangeDate([makeAggregate()])).toBeNull();
  });

  it('returns null when no settings change across the window', () => {
    const aggregates = [
      makeAggregate({ date: '2025-06-01', configuredMinPressure: 4 }),
      makeAggregate({ date: '2025-06-02', configuredMinPressure: 4 }),
    ];
    expect(findFirstSettingsChangeDate(aggregates)).toBeNull();
  });

  it('AGREES with detectSettingsChanges: both date the change to the first new-settings night', () => {
    // Same data fed to both helpers. detectSettingsChanges dates the change to
    // the first new-settings night (2025-06-03); findFirstSettingsChangeDate
    // must return the same date so the Dashboard insight/settings banner and the
    // Trends change list never disagree about when settings changed.
    const aggregates = [
      makeAggregate({ date: '2025-06-01', configuredMinPressure: 4 }),
      makeAggregate({ date: '2025-06-02', configuredMinPressure: 4 }),
      makeAggregate({ date: '2025-06-03', configuredMinPressure: 6 }),
      makeAggregate({ date: '2025-06-04', configuredMinPressure: 6 }),
    ];

    const firstDate = findFirstSettingsChangeDate(aggregates);
    const detected = detectSettingsChanges(aggregates);

    expect(detected).toHaveLength(1);
    expect(detected[0]!.date).toBe('2025-06-03');
    // Corrected behavior: the two helpers agree on the change date.
    expect(firstDate).toBe('2025-06-03');
    expect(firstDate).toBe(detected[0]!.date);
  });

  it('sorts unsorted input by date before scanning', () => {
    const aggregates = [
      makeAggregate({ date: '2025-06-04', configuredMinPressure: 6 }),
      makeAggregate({ date: '2025-06-01', configuredMinPressure: 4 }),
      makeAggregate({ date: '2025-06-03', configuredMinPressure: 6 }),
      makeAggregate({ date: '2025-06-02', configuredMinPressure: 4 }),
    ];
    // After sorting: 4, 4, 6, 6 — the new settings first appear on 06-03.
    expect(findFirstSettingsChangeDate(aggregates)).toBe('2025-06-03');
  });
});
