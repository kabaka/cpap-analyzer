/**
 * Unit tests for the pure per-session analysis helpers.
 *
 * These specs assert against the CANONICAL clinical constants (imported, never
 * re-typed), so a future edit that silently hardcodes a different cutoff fails.
 * The honesty rules under test:
 *   - `null` AHI is a gap, never `0`, and never a passing/normal state.
 *   - baselineDelta over an all-null baseline yields `null`, not `0`.
 *   - centralFraction divide-by-zero yields `null`, not `0`.
 *
 * @module views/Sessions/__tests__/sessionAssessment.test
 */

import { describe, it, expect } from 'vitest';

import {
  AHI_SEVERITY_THRESHOLDS,
  CMS_COMPLIANCE_HOURS,
  SPO2_T90_MILD_PCT,
  SPO2_T90_MODERATE_PCT,
  SPO2_T90_SEVERE_PCT,
} from '@/analysis/clinical';
import { LEAK_NOTICE_LPM, LEAK_SUPPRESS_LPM, MIN_SPLIT_TOTAL_EVENTS } from '@/analysis/uncertainty';
import type { Event, EventType, NightlyAggregate } from '@/types';

import { makeAggregate } from '@/services/llm/context/__tests__/fixtures';
import {
  assessNight,
  componentStatuses,
  baselineDelta,
  longestApnea,
  centralFraction,
  respiratoryBreakdown,
  sessionClusters,
} from '../sessionAssessment';

// ---------------------------------------------------------------------------
// Local event fixture builder
// ---------------------------------------------------------------------------

let eventSeq = 0;

/**
 * Build a minimal {@link Event}. `timestamp` is epoch ms, `duration` is seconds.
 * Only the fields the helpers read matter; the rest are filled with inert values.
 */
function makeEvent(overrides: Partial<Event> = {}): Event {
  eventSeq += 1;
  const base: Event = {
    id: `event-${eventSeq}`,
    sessionId: 'session-1',
    type: 'ObstructiveApnea',
    timestamp: 1_000_000,
    duration: 20,
    severity: null,
    pressure: null,
    epap: null,
    ipap: null,
    leak: null,
    spo2: null,
    clusterId: null,
  };
  return { ...base, ...overrides };
}

// ===========================================================================
// 1. assessNight — two gates, four quadrants
// ===========================================================================

describe('assessNight', () => {
  it('Good night — both gates pass', () => {
    const v = assessNight(makeAggregate({ ahi: 3.0, usageHours: 7 }));
    expect(v.effective).toBe(true);
    expect(v.adherent).toBe(true);
    expect(v.bothPass).toBe(true);
    expect(v.verdictWord).toBe('Good night');
    expect(v.severityForVerdict).toBe('normal');
  });

  it('Fair night — adherent only (AHI too high)', () => {
    const v = assessNight(makeAggregate({ ahi: 9.0, usageHours: 7 }));
    expect(v.effective).toBe(false);
    expect(v.adherent).toBe(true);
    expect(v.bothPass).toBe(false);
    expect(v.verdictWord).toBe('Fair night');
    expect(v.severityForVerdict).toBe('mild');
  });

  it('Partial night — effective only (usage too low)', () => {
    const v = assessNight(makeAggregate({ ahi: 2.0, usageHours: 2 }));
    expect(v.effective).toBe(true);
    expect(v.adherent).toBe(false);
    expect(v.bothPass).toBe(false);
    expect(v.verdictWord).toBe('Partial night');
    expect(v.severityForVerdict).toBe('moderate');
  });

  it('Rough night — neither gate passes', () => {
    const v = assessNight(makeAggregate({ ahi: 20.0, usageHours: 1 }));
    expect(v.effective).toBe(false);
    expect(v.adherent).toBe(false);
    expect(v.bothPass).toBe(false);
    expect(v.verdictWord).toBe('Rough night');
    expect(v.severityForVerdict).toBe('severe');
  });

  it('null AHI => effective is null (cannot confirm), never a pass, even with good usage', () => {
    const v = assessNight(makeAggregate({ ahi: null, usageHours: 8 }));
    expect(v.effective).toBeNull();
    expect(v.adherent).toBe(true);
    expect(v.bothPass).toBe(false); // null is NOT a pass
    expect(v.ahi).toBeNull(); // preserved as null, never coerced to 0
    expect(v.verdictWord).toBe('Fair night'); // adherent-only quadrant
  });

  it('null AHI with low usage => Rough night', () => {
    const v = assessNight(makeAggregate({ ahi: null, usageHours: 1 }));
    expect(v.effective).toBeNull();
    expect(v.adherent).toBe(false);
    expect(v.bothPass).toBe(false);
    expect(v.verdictWord).toBe('Rough night');
  });

  it('AHI exactly at the mild threshold (=5) is NOT effective (strict <)', () => {
    const v = assessNight(makeAggregate({ ahi: AHI_SEVERITY_THRESHOLDS.mild, usageHours: 7 }));
    expect(v.effective).toBe(false);
    expect(v.verdictWord).toBe('Fair night');
  });

  it('AHI just below the mild threshold is effective', () => {
    const v = assessNight(
      makeAggregate({ ahi: AHI_SEVERITY_THRESHOLDS.mild - 0.01, usageHours: 7 }),
    );
    expect(v.effective).toBe(true);
  });

  it('usage exactly at the CMS floor (=4) is adherent (inclusive >=)', () => {
    const v = assessNight(makeAggregate({ ahi: 3, usageHours: CMS_COMPLIANCE_HOURS }));
    expect(v.adherent).toBe(true);
    expect(v.verdictWord).toBe('Good night');
  });

  it('usage just below the CMS floor is not adherent', () => {
    const v = assessNight(makeAggregate({ ahi: 3, usageHours: CMS_COMPLIANCE_HOURS - 0.01 }));
    expect(v.adherent).toBe(false);
    expect(v.verdictWord).toBe('Partial night');
  });
});

// ===========================================================================
// 2. componentStatuses — four independent segments, boundary bands
// ===========================================================================

describe('componentStatuses', () => {
  it('returns exactly four segments in fixed order', () => {
    const s = componentStatuses(makeAggregate());
    expect(s.map((x) => x.key)).toEqual(['ahi', 'leak', 'usage', 'spo2']);
  });

  it('AHI severity comes from classifyAhiSeverity, null when AHI is null', () => {
    expect(componentStatuses(makeAggregate({ ahi: 2 }))[0]?.severity).toBe('normal');
    expect(componentStatuses(makeAggregate({ ahi: 10 }))[0]?.severity).toBe('mild');
    expect(componentStatuses(makeAggregate({ ahi: 20 }))[0]?.severity).toBe('moderate');
    expect(componentStatuses(makeAggregate({ ahi: 40 }))[0]?.severity).toBe('severe');
    expect(componentStatuses(makeAggregate({ ahi: null }))[0]?.severity).toBeNull();
  });

  const leakOf = (agg: NightlyAggregate) => componentStatuses(agg)[1]?.severity;

  it('leak normal just below the notice threshold', () => {
    expect(leakOf(makeAggregate({ leakP95: LEAK_NOTICE_LPM - 0.01 }))).toBe('normal');
  });

  it('leak moderate at exactly the notice threshold (inclusive lower edge, =24)', () => {
    expect(leakOf(makeAggregate({ leakP95: LEAK_NOTICE_LPM }))).toBe('moderate');
  });

  it('leak moderate just below the suppress threshold', () => {
    expect(leakOf(makeAggregate({ leakP95: LEAK_SUPPRESS_LPM - 0.01 }))).toBe('moderate');
  });

  it('leak severe at exactly the suppress threshold (LEAK_SUPPRESS_LPM, =30) and above', () => {
    expect(leakOf(makeAggregate({ leakP95: LEAK_SUPPRESS_LPM }))).toBe('severe');
    expect(leakOf(makeAggregate({ leakP95: 100 }))).toBe('severe');
  });

  it('leak severe boundary is the canonical suppress anchor, not the old 1.5× notice factor', () => {
    // Guard against threshold drift: the old invented cut was 36 (1.5 × 24),
    // which must now read severe because it is >= LEAK_SUPPRESS_LPM (30), and
    // the band edge itself must sit at 30, not 36.
    expect(LEAK_SUPPRESS_LPM).toBeLessThan(LEAK_NOTICE_LPM * 1.5);
    expect(leakOf(makeAggregate({ leakP95: LEAK_SUPPRESS_LPM }))).toBe('severe');
    expect(leakOf(makeAggregate({ leakP95: LEAK_NOTICE_LPM * 1.5 }))).toBe('severe');
  });

  const usageOf = (agg: NightlyAggregate) => componentStatuses(agg)[2]?.severity;

  it('usage normal at/above the CMS floor, moderate below', () => {
    expect(usageOf(makeAggregate({ usageHours: CMS_COMPLIANCE_HOURS }))).toBe('normal');
    expect(usageOf(makeAggregate({ usageHours: CMS_COMPLIANCE_HOURS - 0.01 }))).toBe('moderate');
  });

  const spo2Of = (agg: NightlyAggregate) => componentStatuses(agg)[3]?.severity;

  it('SpO₂ null when no oximetry (spo2Below90Percent null)', () => {
    expect(spo2Of(makeAggregate({ spo2Below90Percent: null }))).toBeNull();
  });

  it('SpO₂ severity is driven by robust T90, NOT the raw single-sample nadir', () => {
    // A single artifact sample can crater spo2Min into the severe range, but a
    // clean night (T90 ≈ 0) must still read normal — the colour is off T90.
    expect(spo2Of(makeAggregate({ spo2Min: 70, spo2Below90Percent: 0 }))).toBe('normal');
    // Conversely a benign-looking nadir with a heavy time-below-90 burden is severe.
    expect(spo2Of(makeAggregate({ spo2Min: 92, spo2Below90Percent: 25 }))).toBe('severe');
  });

  it('SpO₂ T90 bands at the canonical boundaries', () => {
    // normal: T90 < SPO2_T90_MILD_PCT (1)
    expect(spo2Of(makeAggregate({ spo2Below90Percent: 0 }))).toBe('normal');
    expect(spo2Of(makeAggregate({ spo2Below90Percent: SPO2_T90_MILD_PCT - 0.01 }))).toBe('normal');
    // mild: [1, 5)
    expect(spo2Of(makeAggregate({ spo2Below90Percent: SPO2_T90_MILD_PCT }))).toBe('mild');
    expect(spo2Of(makeAggregate({ spo2Below90Percent: SPO2_T90_MODERATE_PCT - 0.01 }))).toBe(
      'mild',
    );
    // moderate: [5, 10)
    expect(spo2Of(makeAggregate({ spo2Below90Percent: SPO2_T90_MODERATE_PCT }))).toBe('moderate');
    expect(spo2Of(makeAggregate({ spo2Below90Percent: SPO2_T90_SEVERE_PCT - 0.01 }))).toBe(
      'moderate',
    );
    // severe: >= 10
    expect(spo2Of(makeAggregate({ spo2Below90Percent: SPO2_T90_SEVERE_PCT }))).toBe('severe');
    expect(spo2Of(makeAggregate({ spo2Below90Percent: 50 }))).toBe('severe');
  });
});

// ===========================================================================
// 3. baselineDelta — null-safe, all-null baseline => null (not 0)
// ===========================================================================

describe('baselineDelta', () => {
  it('computes mean/delta/percent/direction for a normal case', () => {
    const r = baselineDelta(6.0, [4, 5, 6]); // baseline mean = 5
    expect(r.mean).toBe(5);
    expect(r.delta).toBeCloseTo(1.0, 10);
    expect(r.percent).toBeCloseTo(20, 10); // (6-5)/5 * 100
    expect(r.direction).toBe('up');
  });

  it('direction down when current below baseline', () => {
    const r = baselineDelta(3.0, [4, 5, 6]);
    expect(r.delta).toBeCloseTo(-2.0, 10);
    expect(r.direction).toBe('down');
  });

  it('direction unchanged when delta is exactly zero', () => {
    const r = baselineDelta(5.0, [4, 5, 6]);
    expect(r.delta).toBe(0);
    expect(r.direction).toBe('unchanged');
  });

  it('skips null gaps in the baseline (never treats them as 0)', () => {
    const r = baselineDelta(6.0, [null, 4, null, 6]); // mean of {4,6} = 5
    expect(r.mean).toBe(5);
    expect(r.delta).toBeCloseTo(1.0, 10);
  });

  it('all-null baseline => mean/delta/percent null, NOT 0', () => {
    const r = baselineDelta(6.0, [null, null, null]);
    expect(r.mean).toBeNull();
    expect(r.delta).toBeNull();
    expect(r.percent).toBeNull();
    expect(r.direction).toBe('unchanged');
  });

  it('empty baseline => nulls', () => {
    const r = baselineDelta(6.0, []);
    expect(r.mean).toBeNull();
    expect(r.delta).toBeNull();
    expect(r.percent).toBeNull();
  });

  it('null current => delta/percent null even with a valid baseline', () => {
    const r = baselineDelta(null, [4, 5, 6]);
    expect(r.mean).toBe(5); // baseline still reported
    expect(r.delta).toBeNull();
    expect(r.percent).toBeNull();
    expect(r.direction).toBe('unchanged');
  });

  it('zero baseline with non-zero current => percent null (undefined), delta still defined', () => {
    const r = baselineDelta(3.0, [0, 0]);
    expect(r.mean).toBe(0);
    expect(r.delta).toBe(3);
    expect(r.percent).toBeNull(); // percentChange(0, 3) is undefined
    expect(r.direction).toBe('up');
  });
});

// ===========================================================================
// 4. longestApnea — apnea-only, tie-breaking, empty
// ===========================================================================

describe('longestApnea', () => {
  it('returns null when there are no events', () => {
    expect(longestApnea([])).toBeNull();
  });

  it('returns null when there are no apnea events (hypopneas/RERAs ignored)', () => {
    const events = [
      makeEvent({ type: 'Hypopnea', duration: 40 }),
      makeEvent({ type: 'RERA', duration: 50 }),
      makeEvent({ type: 'FlowLimitation', duration: 60 }),
    ];
    expect(longestApnea(events)).toBeNull();
  });

  it('picks the longest among the four apnea classes', () => {
    const events = [
      makeEvent({ type: 'ObstructiveApnea', duration: 20, timestamp: 100 }),
      makeEvent({ type: 'CentralApnea', duration: 35, timestamp: 200 }),
      makeEvent({ type: 'MixedApnea', duration: 15, timestamp: 300 }),
      makeEvent({ type: 'UnclassifiedApnea', duration: 30, timestamp: 400 }),
      makeEvent({ type: 'Hypopnea', duration: 99, timestamp: 500 }), // ignored
    ];
    const r = longestApnea(events);
    expect(r).not.toBeNull();
    expect(r?.durationSec).toBe(35);
    expect(r?.type).toBe('CentralApnea');
    expect(r?.timestamp).toBe(200);
  });

  it('breaks duration ties by the earliest timestamp', () => {
    const events = [
      makeEvent({ type: 'ObstructiveApnea', duration: 30, timestamp: 5000 }),
      makeEvent({ type: 'CentralApnea', duration: 30, timestamp: 1000 }), // earliest at same duration
      makeEvent({ type: 'MixedApnea', duration: 30, timestamp: 9000 }),
    ];
    const r = longestApnea(events);
    expect(r?.timestamp).toBe(1000);
    expect(r?.type).toBe('CentralApnea');
  });

  it('handles a single apnea event', () => {
    const r = longestApnea([makeEvent({ type: 'UnclassifiedApnea', duration: 12, timestamp: 42 })]);
    expect(r).toEqual({ durationSec: 12, type: 'UnclassifiedApnea', timestamp: 42 });
  });
});

// ===========================================================================
// 5. centralFraction — divide-by-zero => null
// ===========================================================================

/** Build an eventsByType override, filling required fields with 0. */
function withCounts(counts: Partial<NightlyAggregate['eventsByType']>): NightlyAggregate {
  return makeAggregate({
    eventsByType: {
      obstructive: 0,
      central: 0,
      mixed: 0,
      unclassified: 0,
      hypopnea: 0,
      rera: 0,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
      ...counts,
    },
  });
}

describe('centralFraction', () => {
  it('central / total apneas (once the total meets the reportable floor)', () => {
    // central 6 over (obstructive 12 + central 6 + mixed 2 + unclassified 0) = 20
    const f = centralFraction(withCounts({ obstructive: 12, central: 6, mixed: 2 }));
    expect(f).toBeCloseTo(0.3, 10);
  });

  it('excludes hypopneas and RERAs from the denominator', () => {
    const f = centralFraction(
      withCounts({ obstructive: 10, central: 10, hypopnea: 100, rera: 100 }),
    );
    expect(f).toBeCloseTo(0.5, 10); // 10 / (10 + 10)
  });

  it('counts unclassified apneas in the denominator', () => {
    const f = centralFraction(withCounts({ central: 5, unclassified: 15 }));
    expect(f).toBeCloseTo(0.25, 10); // 5 / (0 + 5 + 0 + 15)
  });

  it('treats a missing unclassified field as 0', () => {
    const agg = makeAggregate({
      eventsByType: {
        obstructive: 10,
        central: 10,
        mixed: 0,
        hypopnea: 0,
        rera: 0,
        flowLimitation: 0,
        largeLeak: 0,
        periodicBreathing: 0,
        // unclassified intentionally omitted
      },
    });
    expect(centralFraction(agg)).toBeCloseTo(0.5, 10);
  });

  it('divide-by-zero (no apneas at all) => null, never 0', () => {
    const f = centralFraction(withCounts({ hypopnea: 10, rera: 5 }));
    expect(f).toBeNull();
  });

  it('all-central => 1 (with a reportable total)', () => {
    expect(centralFraction(withCounts({ central: MIN_SPLIT_TOTAL_EVENTS }))).toBe(1);
  });

  it('below the minimum-event floor => null, never an alarming ratio (patient safety)', () => {
    // 1 central / 1 total would read "100% central" — meaningless and alarming.
    expect(centralFraction(withCounts({ central: 1 }))).toBeNull();
    // Just under the floor is still suppressed.
    const f = centralFraction(withCounts({ obstructive: MIN_SPLIT_TOTAL_EVENTS - 2, central: 1 }));
    expect(f).toBeNull();
  });

  it('exactly at MIN_SPLIT_TOTAL_EVENTS => the ratio is reported (inclusive floor)', () => {
    // obstructive 15 + central 5 = 20 (== MIN_SPLIT_TOTAL_EVENTS) -> reportable.
    const f = centralFraction(withCounts({ obstructive: 15, central: 5 }));
    expect(f).toBeCloseTo(5 / MIN_SPLIT_TOTAL_EVENTS, 10);
  });
});

// ===========================================================================
// 6. respiratoryBreakdown
// ===========================================================================

describe('respiratoryBreakdown', () => {
  it('always includes Obstructive, Hypopnea, Central even at zero count', () => {
    const rows = respiratoryBreakdown(withCounts({ obstructive: 0, hypopnea: 0, central: 0 }));
    expect(rows.map((r) => r.type)).toEqual(['ObstructiveApnea', 'Hypopnea', 'CentralApnea']);
  });

  it('includes Mixed/Unclassified/RERA only when their count is non-zero', () => {
    const rows = respiratoryBreakdown(
      withCounts({ obstructive: 5, hypopnea: 3, central: 1, mixed: 2, unclassified: 1, rera: 4 }),
    );
    expect(rows.map((r) => r.type)).toEqual([
      'ObstructiveApnea',
      'Hypopnea',
      'CentralApnea',
      'MixedApnea',
      'UnclassifiedApnea',
      'RERA',
    ]);
  });

  it('pulls rates from ahi* fields and counts from eventsByType', () => {
    const agg = makeAggregate({
      ahiObstructive: 2.5,
      ahiHypopnea: 1.5,
      ahiCentral: 0.5,
      eventsByType: {
        obstructive: 10,
        central: 2,
        mixed: 0,
        unclassified: 0,
        hypopnea: 6,
        rera: 0,
        flowLimitation: 0,
        largeLeak: 0,
        periodicBreathing: 0,
      },
    });
    const rows = respiratoryBreakdown(agg);
    const obstructive = rows.find((r) => r.type === 'ObstructiveApnea');
    expect(obstructive?.ratePerHour).toBe(2.5);
    expect(obstructive?.count).toBe(10);
  });

  it('preserves null rate as null (never coerced to 0)', () => {
    const rows = respiratoryBreakdown(makeAggregate({ ahiCentral: null }));
    const central = rows.find((r) => r.type === 'CentralApnea');
    expect(central?.ratePerHour).toBeNull();
  });
});

// ===========================================================================
// 7. sessionClusters — sorting by severity, thin wrapper
// ===========================================================================

describe('sessionClusters', () => {
  it('returns no clusters for an empty event list', () => {
    const r = sessionClusters([]);
    expect(r.clusters).toHaveLength(0);
    expect(r.summaries).toHaveLength(0);
  });

  it('sorts clusters by severityScore descending with matching summaries', () => {
    const base = 1_600_000_000_000; // epoch ms

    // Cluster A: a tight, dense burst (short window, many events) -> high severity.
    // Cluster B: a looser burst far later -> lower severity.
    const clusterA: Event[] = [
      makeEvent({ type: 'ObstructiveApnea', duration: 20, timestamp: base + 0 }),
      makeEvent({ type: 'ObstructiveApnea', duration: 20, timestamp: base + 25_000 }),
      makeEvent({ type: 'ObstructiveApnea', duration: 20, timestamp: base + 50_000 }),
      makeEvent({ type: 'ObstructiveApnea', duration: 20, timestamp: base + 75_000 }),
    ];
    const farLater = base + 3_600_000; // +1 h, well beyond any bridge gap
    const clusterB: Event[] = [
      makeEvent({ type: 'Hypopnea', duration: 15, timestamp: farLater + 0 }),
      makeEvent({ type: 'Hypopnea', duration: 15, timestamp: farLater + 100_000 }),
    ];

    const r = sessionClusters([...clusterB, ...clusterA]);

    expect(r.clusters.length).toBeGreaterThanOrEqual(2);
    // Descending severity ordering.
    for (let i = 1; i < r.clusters.length; i++) {
      expect(r.clusters[i - 1]!.severityScore).toBeGreaterThanOrEqual(r.clusters[i]!.severityScore);
    }
    // Summaries mirror clusters in order and carry the shaped fields.
    expect(r.summaries).toHaveLength(r.clusters.length);
    r.summaries.forEach((s, i) => {
      const c = r.clusters[i]!;
      expect(s.id).toBe(c.id);
      expect(s.startTime).toBe(c.startTime);
      expect(s.endTime).toBe(c.endTime);
      expect(s.eventCount).toBe(c.events.length);
      expect(s.density).toBe(c.density);
      expect(s.weightedDensity).toBe(c.weightedDensity);
      expect(s.severityScore).toBe(c.severityScore);
    });
  });

  it('does not mutate the input events array', () => {
    const events: Event[] = [
      makeEvent({ timestamp: 3000 }),
      makeEvent({ timestamp: 1000 }),
      makeEvent({ timestamp: 2000 }),
    ];
    const snapshot = events.map((e) => e.timestamp);
    sessionClusters(events);
    expect(events.map((e) => e.timestamp)).toEqual(snapshot);
  });

  it('respects the FLG preset argument', () => {
    // Two events 90 s apart: bridged under 'lenient'/'balanced', split under 'strict'
    // (strict maxGap = 60 s, minClusterSize = 3).
    const base = 1_600_000_000_000;
    const events: Event[] = [
      makeEvent({ type: 'ObstructiveApnea', duration: 10, timestamp: base }),
      makeEvent({ type: 'ObstructiveApnea', duration: 10, timestamp: base + 90_000 }),
    ];
    const balanced = sessionClusters(events, 'balanced');
    expect(balanced.clusters.length).toBe(1); // bridged, minClusterSize 2 met

    const strict = sessionClusters(events, 'strict');
    expect(strict.clusters.length).toBe(0); // gap too large AND below minClusterSize 3
  });
});

// Reference EventType exhaustiveness guard (compile-time sanity for fixtures).
const _apneaTypeSample: EventType = 'MixedApnea';
void _apneaTypeSample;
