import { describe, it, expect } from 'vitest';
import { generateInsights } from './insights';
import type { Insight } from './insights';
import {
  detectSettingsChanges,
  findFirstSettingsChangeDate,
} from '@/views/Trends/utils/detectSettingsChanges';
import type { SummaryStats } from '@/hooks/useSummaryStats';
import type { NightlyAggregate } from '@/types';

/**
 * Minimal valid {@link NightlyAggregate} fixture.
 *
 * Defaults represent a healthy, compliant night: AHI 3 (apnea+hypopnea only,
 * EXCLUDING RERAs per AASM 2012 / ICSD-3), low leak, full usage.
 */
function makeAggregate(overrides: Partial<NightlyAggregate> = {}): NightlyAggregate {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    machineId: 'SN-123',
    date: overrides.date ?? '2025-06-15',
    ahi: overrides.ahi ?? 3.0,
    ahiObstructive: 1.5,
    ahiCentral: overrides.ahiCentral ?? 0.5,
    ahiMixed: 0.0,
    ahiHypopnea: 1.0,
    ahiRera: overrides.ahiRera ?? 0.0,
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
    configuredMinPressure: overrides.configuredMinPressure ?? null,
    configuredMaxPressure: overrides.configuredMaxPressure ?? null,
    eprLevel: overrides.eprLevel ?? null,
    notes: '',
    tags: [],
    ...overrides,
  };
}

/**
 * Healthy default {@link SummaryStats} fixture: everything within normal
 * ranges. Override individual fields to exercise specific insight branches.
 */
function makeStats(overrides: Partial<SummaryStats> = {}): SummaryStats {
  return {
    meanAHI: 3.0,
    medianAHI: 3.0,
    meanLeak: 8.0,
    leakP95: 15.0,
    meanUsageHours: 7.0,
    meanPressureP95: 12.0,
    complianceRate: 0.9,
    totalSessions: 30,
    trendAHIPercent: 0,
    trendLeakPercent: 0,
    trendUsagePercent: 0,
    trendCompliancePercent: 0,
    trendPressureP95Percent: 0,
    trendData: [],
    ...overrides,
  };
}

function byId(insights: Insight[], id: string): Insight | undefined {
  return insights.find((i) => i.id === id);
}

describe('generateInsights', () => {
  describe('edge cases', () => {
    it('returns no insights for empty aggregate input', () => {
      expect(generateInsights([], makeStats())).toEqual([]);
    });

    it('handles a single-session input without throwing and produces insights', () => {
      const result = generateInsights([makeAggregate()], makeStats());
      expect(Array.isArray(result)).toBe(true);
      // A single healthy night still yields at least the positive compliance/usage insights.
      expect(result.length).toBeGreaterThan(0);
    });

    it('never returns more than 5 insights', () => {
      // Construct a scenario that trips many branches at once.
      const aggregates = [
        makeAggregate({ date: '2025-06-01', ahiCentral: 8, configuredMinPressure: 4 }),
        makeAggregate({ date: '2025-06-02', ahiCentral: 8, configuredMinPressure: 6 }),
      ];
      const stats = makeStats({
        trendAHIPercent: 50,
        complianceRate: 0.4,
        meanUsageHours: 3,
        leakP95: 40,
      });
      const result = generateInsights(aggregates, stats);
      expect(result.length).toBeLessThanOrEqual(5);
    });
  });

  describe('compliance insights (CMS 70% threshold)', () => {
    it('reports a positive insight when compliance is at or above 70%', () => {
      const result = generateInsights([makeAggregate()], makeStats({ complianceRate: 0.7 }));
      const insight = byId(result, 'compliance-good');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('positive');
      expect(insight!.message).toContain('70%');
      expect(insight!.message).toContain('above CMS threshold');
    });

    it('reports a warning when compliance is below 70%', () => {
      const result = generateInsights([makeAggregate()], makeStats({ complianceRate: 0.69 }));
      const good = byId(result, 'compliance-good');
      const low = byId(result, 'compliance-low');
      expect(good).toBeUndefined();
      expect(low).toBeDefined();
      expect(low!.severity).toBe('warning');
      expect(low!.message).toContain('below CMS 70% threshold');
    });
  });

  describe('usage insights', () => {
    it('flags excellent adherence at or above 6 hours', () => {
      const result = generateInsights([makeAggregate()], makeStats({ meanUsageHours: 6.2 }));
      const insight = byId(result, 'usage-excellent');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('positive');
    });

    it('warns when average usage is below the CMS 4-hour minimum', () => {
      const result = generateInsights([makeAggregate()], makeStats({ meanUsageHours: 3.5 }));
      const insight = byId(result, 'usage-low');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('warning');
      expect(insight!.message).toContain('below CMS minimum');
    });

    it('produces neither excellent nor low usage insight in the partial 4–6 hour band', () => {
      const result = generateInsights([makeAggregate()], makeStats({ meanUsageHours: 5.0 }));
      expect(byId(result, 'usage-excellent')).toBeUndefined();
      expect(byId(result, 'usage-low')).toBeUndefined();
    });
  });

  describe('AHI trend insights (corrected: AHI excludes RERAs)', () => {
    it('reports a positive insight when AHI trends down by more than 10%', () => {
      const result = generateInsights([makeAggregate()], makeStats({ trendAHIPercent: -25 }));
      const insight = byId(result, 'ahi-trending-down');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('positive');
      expect(insight!.message).toContain('25%');
    });

    it('reports a warning when AHI trends up by more than 10%', () => {
      const result = generateInsights([makeAggregate()], makeStats({ trendAHIPercent: 30 }));
      const insight = byId(result, 'ahi-trending-up');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('warning');
    });

    it('does not report an AHI trend insight for small (<=10%) movements', () => {
      const result = generateInsights([makeAggregate()], makeStats({ trendAHIPercent: 8 }));
      expect(byId(result, 'ahi-trending-up')).toBeUndefined();
      expect(byId(result, 'ahi-trending-down')).toBeUndefined();
    });

    it('does NOT trip an AHI-based warning from RERA load alone (RERAs belong to RDI, not AHI)', () => {
      // A night with a very high RERA index but low apnea+hypopnea AHI.
      // Under the corrected semantics, aggregate.ahi excludes RERAs, so the
      // AHI-derived stats stay low and no AHI warning should appear.
      const aggregates = [makeAggregate({ ahi: 2.0, ahiRera: 25.0, ahiCentral: 0.5 })];
      // SummaryStats are derived from aggregate.ahi (RERA-free), so meanAHI is low
      // and the trend is flat — mirroring what useSummaryStats would compute.
      const stats = makeStats({ meanAHI: 2.0, medianAHI: 2.0, trendAHIPercent: 0 });
      const result = generateInsights(aggregates, stats);

      expect(byId(result, 'ahi-trending-up')).toBeUndefined();
      // No insight message should mention an elevated AHI driven by the RERA count.
      const allMessages = result.map((i) => i.message).join(' ');
      expect(allMessages).not.toContain('25');
    });
  });

  describe('leak insights', () => {
    it('warns when 95th-percentile leak exceeds 24 L/min', () => {
      const result = generateInsights([makeAggregate()], makeStats({ leakP95: 30 }));
      const insight = byId(result, 'leak-high');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('warning');
      expect(insight!.message).toContain('30.0 L/min');
    });

    it('does not warn on leak at or below the 24 L/min threshold', () => {
      const result = generateInsights([makeAggregate()], makeStats({ leakP95: 24 }));
      expect(byId(result, 'leak-high')).toBeUndefined();
    });

    it('warns about a rising leak trend (>15% up) when absolute leak is acceptable', () => {
      const result = generateInsights(
        [makeAggregate()],
        makeStats({ leakP95: 10, trendLeakPercent: 20 }),
      );
      const insight = byId(result, 'leak-trending-up');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('warning');
    });

    it('prefers the absolute high-leak insight over the trend insight', () => {
      // Both conditions met; only leak-high should be emitted (else-if branch).
      const result = generateInsights(
        [makeAggregate()],
        makeStats({ leakP95: 30, trendLeakPercent: 20 }),
      );
      expect(byId(result, 'leak-high')).toBeDefined();
      expect(byId(result, 'leak-trending-up')).toBeUndefined();
    });
  });

  describe('central apnea index insights', () => {
    it('emits a neutral insight when the cross-night mean central index exceeds 5', () => {
      const aggregates = [
        makeAggregate({ date: '2025-06-01', ahiCentral: 7 }),
        makeAggregate({ date: '2025-06-02', ahiCentral: 7 }),
      ];
      const result = generateInsights(aggregates, makeStats());
      const insight = byId(result, 'central-apnea-high');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('neutral');
      expect(insight!.message).toContain('7.0');
    });

    it('does not emit the central insight when the mean is at or below 5', () => {
      const aggregates = [
        makeAggregate({ date: '2025-06-01', ahiCentral: 5 }),
        makeAggregate({ date: '2025-06-02', ahiCentral: 5 }),
      ];
      const result = generateInsights(aggregates, makeStats());
      expect(byId(result, 'central-apnea-high')).toBeUndefined();
    });

    it('does NOT trip on a single very-short-usage outlier when well-used nights are benign', () => {
      // 6 well-used nights have a benign central index (0.5/h), but a single
      // 0.2-hour night (~12 minutes of mask-on time) reports a wildly high
      // nightly central index of 60/h — which on such a short night can come
      // from a tiny handful of events.
      //
      // An UNWEIGHTED mean would be (6 * 0.5 + 60) / 7 ≈ 9.0 and would trip the
      // > 5 "discuss with provider" message. The corrected insight excludes the
      // sub-1h night entirely (and would down-weight it heavily even if counted),
      // so the aggregate stays at the benign 0.5/h and no warning fires.
      const goodNights = Array.from({ length: 6 }, (_, i) =>
        makeAggregate({
          date: `2025-06-0${i + 1}`,
          ahiCentral: 0.5,
          usageHours: 7,
        }),
      );
      const outlier = makeAggregate({
        date: '2025-06-07',
        ahiCentral: 60,
        usageHours: 0.2,
      });
      const aggregates = [...goodNights, outlier];

      const result = generateInsights(aggregates, makeStats());
      expect(byId(result, 'central-apnea-high')).toBeUndefined();
    });

    it('STILL trips on a genuinely elevated usage-weighted central index', () => {
      // Every night is well-used and carries a high central index, so the
      // usage-weighted aggregate is genuinely > 5 and the referral message
      // fires as it should — the fix removes the false positive without
      // suppressing true positives.
      const aggregates = Array.from({ length: 7 }, (_, i) =>
        makeAggregate({
          date: `2025-06-0${i + 1}`,
          ahiCentral: 8,
          usageHours: 7,
        }),
      );
      const result = generateInsights(aggregates, makeStats());
      const insight = byId(result, 'central-apnea-high');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('neutral');
      expect(insight!.message).toContain('8.0');
    });

    it('weights the central index by usage hours rather than treating nights equally', () => {
      // One short (1h) night at 20/h and one long (9h) night at 1/h. An
      // unweighted mean would be 10.5/h (> 5, would warn); the usage-weighted
      // rate is (20*1 + 1*9) / (1 + 9) = 29/10 = 2.9/h (benign, no warning).
      const aggregates = [
        makeAggregate({ date: '2025-06-01', ahiCentral: 20, usageHours: 1 }),
        makeAggregate({ date: '2025-06-02', ahiCentral: 1, usageHours: 9 }),
      ];
      const result = generateInsights(aggregates, makeStats());
      expect(byId(result, 'central-apnea-high')).toBeUndefined();
    });
  });

  describe('settings-change detection (shared detectSettingsChanges helpers)', () => {
    it('reports the first night under the NEW settings, matching detectSettingsChanges', () => {
      // Oldest two nights at min pressure 4; the change to 6 first took effect
      // on 2025-06-03. Both helpers must agree on that date.
      const aggregates = [
        makeAggregate({ date: '2025-06-01', configuredMinPressure: 4 }),
        makeAggregate({ date: '2025-06-02', configuredMinPressure: 4 }),
        makeAggregate({ date: '2025-06-03', configuredMinPressure: 6 }),
        makeAggregate({ date: '2025-06-04', configuredMinPressure: 6 }),
      ];
      const result = generateInsights(aggregates, makeStats());
      const insight = byId(result, 'settings-changed');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('neutral');
      // Corrected behavior: the first night the new settings landed (06-03).
      expect(insight!.message).toContain('2025-06-03');
    });

    it('findFirstSettingsChangeDate AGREES with detectSettingsChanges on identical input', () => {
      // The single-date helper that drives the Dashboard insight/banner must
      // report the same date detectSettingsChanges assigns to the first change,
      // so the Dashboard and Trends views never disagree about when settings
      // changed.
      const aggregates = [
        makeAggregate({ date: '2025-06-01', configuredMinPressure: 4 }),
        makeAggregate({ date: '2025-06-02', configuredMinPressure: 4 }),
        makeAggregate({ date: '2025-06-03', configuredMinPressure: 6 }),
        makeAggregate({ date: '2025-06-04', configuredMinPressure: 6, eprLevel: 2 }),
      ];
      const firstChange = detectSettingsChanges(aggregates)[0];
      expect(firstChange).toBeDefined();
      expect(findFirstSettingsChangeDate(aggregates)).toBe(firstChange!.date);
      expect(findFirstSettingsChangeDate(aggregates)).toBe('2025-06-03');
    });

    it('does not report a settings change when all nights share the same configuration', () => {
      const aggregates = [
        makeAggregate({ date: '2025-06-01', configuredMinPressure: 5, eprLevel: 2 }),
        makeAggregate({ date: '2025-06-02', configuredMinPressure: 5, eprLevel: 2 }),
      ];
      const result = generateInsights(aggregates, makeStats());
      expect(byId(result, 'settings-changed')).toBeUndefined();
    });

    it('detects a change driven by EPR level alone', () => {
      const aggregates = [
        makeAggregate({ date: '2025-06-01', eprLevel: 1 }),
        makeAggregate({ date: '2025-06-02', eprLevel: 3 }),
      ];
      const result = generateInsights(aggregates, makeStats());
      const insight = byId(result, 'settings-changed');
      expect(insight).toBeDefined();
      expect(insight!.message).toContain('2025-06-02');
    });
  });

  describe('all-good fallback', () => {
    it('emits the all-good insight when metrics are healthy and few other insights fire', () => {
      // Usage in the partial band (4–6h) suppresses usage-excellent, leaving
      // fewer than 2 insights so the fallback engages.
      const stats = makeStats({
        meanAHI: 3,
        complianceRate: 0.72,
        meanUsageHours: 5,
        trendAHIPercent: 0,
        leakP95: 10,
      });
      const result = generateInsights([makeAggregate({ ahiCentral: 0.5 })], stats);
      const insight = byId(result, 'all-good');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('positive');
    });

    it('does not emit the all-good fallback when AHI is elevated', () => {
      const stats = makeStats({ meanAHI: 6, complianceRate: 0.72, meanUsageHours: 5 });
      const result = generateInsights([makeAggregate()], stats);
      expect(byId(result, 'all-good')).toBeUndefined();
    });
  });

  describe('ordering', () => {
    it('sorts insights warning → neutral → positive', () => {
      // Trip one of each severity: warning (low compliance), neutral (settings
      // change), positive (good usage).
      const aggregates = [
        makeAggregate({ date: '2025-06-01', configuredMinPressure: 4 }),
        makeAggregate({ date: '2025-06-02', configuredMinPressure: 6 }),
      ];
      const stats = makeStats({ complianceRate: 0.5, meanUsageHours: 6.5 });
      const result = generateInsights(aggregates, stats);

      const severityRank: Record<string, number> = { warning: 0, neutral: 1, positive: 2 };
      const ranks = result.map((i) => severityRank[i.severity]!);
      const sorted = [...ranks].sort((a, b) => a - b);
      expect(ranks).toEqual(sorted);
    });
  });
});
