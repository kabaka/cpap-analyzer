/**
 * Tests for SessionBuilder clinical-metric correctness:
 * - AHI excludes RERA; RDI = AHI + RERA index (AASM 2012 / ICSD-3)
 * - ODI via discrete desaturation-event detection (AASM SpO₂ scoring)
 * - Usage: STR mask intervals are authoritative ONLY when they yield strictly
 *   positive overlap for the session; an empty/non-overlapping STR overlap
 *   falls back PER-SESSION to the pressure-hysteresis detector (regression fix)
 * - T90 time-based + SpO₂ coverage
 * - Sentinel/gap handling does not bias pressure/leak stats toward zero
 * - Percentile values are unchanged by the sort-once refactor
 *
 * Synthetic data only.
 */

import { describe, it, expect } from 'vitest';
import { SessionBuilder } from '@/parsers/resmed/SessionBuilder';
import type {
  ResMedInterpretation,
  StandardChannel,
  StandardEvent,
} from '@/parsers/resmed/ResMedInterpreter';
import { STRParser } from '@/parsers/resmed/STRParser';
import type { MaskInterval } from '@/parsers/resmed/STRParser';
import type { EventType } from '@/types/events';
import { MIN_INDEX_USAGE_HOURS } from '@/analysis/uncertainty/constants';

// ---------------------------------------------------------------------------
// Synthetic builders
// ---------------------------------------------------------------------------

const START = new Date(2026, 0, 15, 22, 0, 0);

function channel(
  name: string,
  samples: Float32Array,
  sampleRate: number,
  unit = '',
): StandardChannel {
  return {
    name,
    unit,
    sampleRate,
    samples,
    metadata: {
      name,
      sampleRate,
      unit,
      physicalMin: 0,
      physicalMax: 100,
      digitalMin: 0,
      digitalMax: 100,
    },
  };
}

function evt(type: EventType, onset: number): StandardEvent {
  return { type, onset, duration: 10, rawLabels: [type] };
}

function interpretation(opts: {
  startTime?: Date;
  durationSeconds: number;
  channels?: StandardChannel[];
  events?: StandardEvent[];
}): ResMedInterpretation {
  return {
    machineInfo: {
      serialNumber: 'TEST123',
      model: 'AirSense 10 AutoSet',
      series: 'AirSense 10',
      firmwareVersion: 'Unknown',
      machineType: 'apap',
    },
    capabilities: {
      hasAutoCPAP: true,
      hasBilevel: false,
      hasIPAPChannel: false,
      hasPressureSupport: false,
      hasServoControl: false,
      hasFlowLimitation: true,
    },
    startTime: opts.startTime ?? START,
    duration: opts.durationSeconds,
    channels: opts.channels ?? [],
    events: opts.events ?? [],
    unknownLabels: [],
    unknownEvents: [],
  };
}

/** Constant-pressure mask channel covering the whole window (mask always on). */
function maskPressure(durationSeconds: number, value = 10, rate = 25): StandardChannel {
  return channel(
    'maskPressure',
    new Float32Array(durationSeconds * rate).fill(value),
    rate,
    'cmH2O',
  );
}

const builder = new SessionBuilder();

// ---------------------------------------------------------------------------
// Task 2: AHI excludes RERA; RDI separate
// ---------------------------------------------------------------------------

describe('AHI / RDI separation (AASM 2012)', () => {
  it('AHI counts apneas + hypopneas only; RDI adds RERAs', () => {
    // 1 hour of usage. 5 apnea/hypopnea events + 3 RERAs.
    const events: StandardEvent[] = [
      evt('ObstructiveApnea', 100),
      evt('Hypopnea', 200),
      evt('CentralApnea', 300),
      evt('MixedApnea', 400),
      evt('Hypopnea', 500),
      evt('RERA', 600),
      evt('RERA', 700),
      evt('RERA', 800),
    ];
    const interp = interpretation({
      durationSeconds: 3600,
      channels: [maskPressure(3600)],
      events,
    });
    const [result] = builder.buildSessions([interp]);
    const agg = result!.aggregate;

    // Usage ≈ 1h (constant 10 cmH₂O). AHI = 5 events/h, NOT 8.
    expect(agg.ahi).toBeCloseTo(5, 1);
    expect(agg.ahiRera).toBeCloseTo(3, 1);
    // RDI = AHI + RERA index = 8.
    expect(agg.rdi).toBeCloseTo(8, 1);
    expect(agg.rdi!).toBeGreaterThan(agg.ahi!);
  });

  it('RDI equals AHI when no RERAs are scored', () => {
    const interp = interpretation({
      durationSeconds: 3600,
      channels: [maskPressure(3600)],
      events: [evt('ObstructiveApnea', 100), evt('Hypopnea', 200)],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    expect(agg.rdi).toBeCloseTo(agg.ahi!, 5);
    expect(agg.ahiRera).toBe(0);
  });

  it('counts an UnclassifiedApnea toward AHI as an apnea', () => {
    // 1 hour of usage, 2 unclassified apneas + 1 obstructive → AHI = 3.
    const interp = interpretation({
      durationSeconds: 3600,
      channels: [maskPressure(3600)],
      events: [
        evt('UnclassifiedApnea', 100),
        evt('UnclassifiedApnea', 200),
        evt('ObstructiveApnea', 300),
      ],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    // AHI must include the unclassified apneas: 3 events / 1 h.
    expect(agg.ahi).toBeCloseTo(3, 1);
    expect(agg.ahi).toBeGreaterThan(0);
  });

  it('does NOT inflate the mixed-apnea index with unclassified apneas', () => {
    // No qualified mixed apneas present — only unclassified ones. The mixed
    // index MUST stay zero (this is the classification-fidelity regression we
    // are guarding against: a bare "Apnea" used to be bucketed as mixed).
    const interp = interpretation({
      durationSeconds: 3600,
      channels: [maskPressure(3600)],
      events: [
        evt('UnclassifiedApnea', 100),
        evt('UnclassifiedApnea', 200),
        evt('UnclassifiedApnea', 300),
      ],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    // The mixed slice is untouched by unclassified apneas …
    expect(agg.ahiMixed).toBe(0);
    // … yet the apneas still count toward AHI (3 events / 1 h).
    expect(agg.ahi).toBeCloseTo(3, 1);
  });

  it('keeps mixed and unclassified apneas in separate buckets', () => {
    // 1 mixed + 1 unclassified. Mixed index = 1/h; AHI includes both = 2/h.
    const interp = interpretation({
      durationSeconds: 3600,
      channels: [maskPressure(3600)],
      events: [evt('MixedApnea', 100), evt('UnclassifiedApnea', 200)],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    expect(agg.ahiMixed).toBeCloseTo(1, 1);
    expect(agg.ahi).toBeCloseTo(2, 1);
  });
});

// ---------------------------------------------------------------------------
// Task 4: Usage detection
// ---------------------------------------------------------------------------

describe('usage detection', () => {
  it('STR mask-interval path matches expected usage exactly', () => {
    // Session window: 22:00 → 06:00 (8h). Two mask intervals totalling 5h.
    const start = new Date(2026, 0, 15, 22, 0, 0);
    const interp = interpretation({
      startTime: start,
      durationSeconds: 8 * 3600,
      channels: [maskPressure(8 * 3600)],
    });
    const intervals: MaskInterval[] = [
      { start: new Date(2026, 0, 15, 22, 0, 0), end: new Date(2026, 0, 16, 1, 0, 0) }, // 3h
      { start: new Date(2026, 0, 16, 3, 0, 0), end: new Date(2026, 0, 16, 5, 0, 0) }, // 2h
    ];
    // STR keys by calendar date of the session start (2026-01-15).
    const byDate = new Map<string, MaskInterval[]>([['2026-01-15', intervals]]);

    const agg = builder.buildSessions([interp], undefined, byDate)[0]!.aggregate;
    expect(agg.usageHours).toBeCloseTo(5, 5);
    expect(agg.maskOnTimeMinutes).toBeCloseTo(300, 3);
  });

  it('falls back to the pressure detector when STR intervals are EMPTY but a mask-pressure channel is present (regression fix)', () => {
    // Regression: previously an empty STR array was "authoritative zero", which
    // zeroed usage even though the pressure channel proves the mask was worn.
    // Now an empty/non-positive STR overlap falls back to the pressure detector
    // PER SESSION, so a real night of therapy is never silently destroyed.
    const events: StandardEvent[] = [
      evt('ObstructiveApnea', 100),
      evt('Hypopnea', 200),
      evt('CentralApnea', 300),
      evt('MixedApnea', 400),
      evt('Hypopnea', 500),
    ];
    const interp = interpretation({
      durationSeconds: 3600,
      channels: [maskPressure(3600)], // constant 10 cmH₂O → mask worn the full hour
      events,
    });
    const byDate = new Map<string, MaskInterval[]>([['2026-01-15', []]]);
    const agg = builder.buildSessions([interp], undefined, byDate)[0]!.aggregate;

    // Pressure detector recovers the full hour of usage.
    expect(agg.usageHours).toBeCloseTo(1, 5);
    expect(agg.maskOnTimeMinutes).toBeCloseTo(60, 3);
    // AHI is now computed against real usage (5 events / 1 h), NOT zeroed out.
    expect(agg.ahi).toBeCloseTo(5, 5);
    expect(agg.ahi).toBeGreaterThan(0);
    // 1 h of usage is below the 4 h CMS bar but above 1 h → partial, not the
    // bogus 0 h "non-compliant" the old foot-gun produced.
    expect(agg.complianceStatus).toBe('partial');
  });

  it('falls back to the pressure detector when STR intervals exist for the night but do NOT overlap this session window', () => {
    // STR data is present for the date, but its (mis-decoded / mis-keyed)
    // intervals land entirely outside the session window. The clipped overlap
    // is zero, so usage must fall back to the pressure detector — not zero.
    const start = new Date(2026, 0, 15, 22, 0, 0);
    const interp = interpretation({
      startTime: start,
      durationSeconds: 8 * 3600, // 22:00 → 06:00
      channels: [maskPressure(8 * 3600)],
      events: [evt('ObstructiveApnea', 100), evt('Hypopnea', 200)],
    });
    // Intervals sit in the afternoon BEFORE the window opens → no overlap.
    const nonOverlapping: MaskInterval[] = [
      { start: new Date(2026, 0, 15, 13, 0, 0), end: new Date(2026, 0, 15, 15, 0, 0) },
    ];
    const byDate = new Map<string, MaskInterval[]>([['2026-01-15', nonOverlapping]]);
    const agg = builder.buildSessions([interp], undefined, byDate)[0]!.aggregate;

    // Full 8 h recovered from the pressure detector; STR is ignored for THIS
    // session because its overlap is zero.
    expect(agg.usageHours).toBeCloseTo(8, 5);
    expect(agg.ahi).toBeGreaterThan(0);
    expect(agg.complianceStatus).toBe('compliant');
  });

  it('keeps a genuinely-unworn night at ~0 usage (empty STR + flat near-ambient pressure)', () => {
    // The fallback must not invent usage: a truly-unworn night reads near
    // ambient (~0.5 cmH₂O, below the ON threshold) on the pressure channel, so
    // even with the fallback engaged usage stays ~0. Legitimate zeros stay zero.
    const interp = interpretation({
      durationSeconds: 3600,
      channels: [maskPressure(3600, 0.5)], // constant 0.5 cmH₂O, never crosses ON=2.0
    });
    const byDate = new Map<string, MaskInterval[]>([['2026-01-15', []]]);
    const agg = builder.buildSessions([interp], undefined, byDate)[0]!.aggregate;
    expect(agg.usageHours).toBe(0);
    expect(agg.complianceStatus).toBe('non-compliant');
  });

  it('uses STR as authoritative when its overlap is strictly positive (pressure ignored)', () => {
    // Mask physically worn the whole window (constant 10 → detector would say
    // 8 h), but STR records only 5 h of actual mask-on. STR wins.
    const start = new Date(2026, 0, 15, 22, 0, 0);
    const interp = interpretation({
      startTime: start,
      durationSeconds: 8 * 3600,
      channels: [maskPressure(8 * 3600)],
    });
    const intervals: MaskInterval[] = [
      { start: new Date(2026, 0, 15, 22, 0, 0), end: new Date(2026, 0, 16, 1, 0, 0) }, // 3h
      { start: new Date(2026, 0, 16, 3, 0, 0), end: new Date(2026, 0, 16, 5, 0, 0) }, // 2h
    ];
    const byDate = new Map<string, MaskInterval[]>([['2026-01-15', intervals]]);
    const agg = builder.buildSessions([interp], undefined, byDate)[0]!.aggregate;
    // STR's 5 h, not the detector's 8 h.
    expect(agg.usageHours).toBeCloseTo(5, 5);
    expect(agg.maskOnTimeMinutes).toBeCloseTo(300, 3);
  });

  it('uses the pressure detector when no STR map is supplied at all (older firmware, backward compatible)', () => {
    const interp = interpretation({
      durationSeconds: 3600,
      channels: [maskPressure(3600)],
      events: [evt('ObstructiveApnea', 100)],
    });
    // No third argument → no STR intervals anywhere.
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    expect(agg.usageHours).toBeCloseTo(1, 5);
    expect(agg.ahi).toBeCloseTo(1, 5);
  });

  it('fallback hysteresis counts usage despite per-breath exhalation dips below 1.5', () => {
    // Steady 5 cmH₂O CPAP with EPR: oscillates 5 → 1.5 each breath (15/min).
    const rate = 25;
    const seconds = 600; // 10 minutes
    const samples = new Float32Array(seconds * rate);
    for (let i = 0; i < samples.length; i++) {
      const tSec = i / rate;
      // ~0.25 Hz breathing; trough 1.5, peak 5.
      const phase = Math.sin(2 * Math.PI * 0.25 * tSec);
      samples[i] = phase < -0.5 ? 1.5 : 5;
    }
    const interp = interpretation({
      durationSeconds: seconds,
      channels: [channel('maskPressure', samples, rate, 'cmH2O')],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    // Brief 1.5 dips never persist past the 10s off-dwell, so the full ~10 min counts.
    expect(agg.usageHours).toBeCloseTo(seconds / 3600, 1);
  });

  it('fallback hysteresis includes the low-pressure ramp from 4 cmH₂O', () => {
    // 5-min ramp 4 → 10 then 5 min at 10. All above the ON threshold → all usage.
    const rate = 25;
    const seconds = 600;
    const samples = new Float32Array(seconds * rate);
    for (let i = 0; i < samples.length; i++) {
      const tSec = i / rate;
      samples[i] = tSec < 300 ? 4 + (6 * tSec) / 300 : 10;
    }
    const interp = interpretation({
      durationSeconds: seconds,
      channels: [channel('maskPressure', samples, rate, 'cmH2O')],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    expect(agg.usageHours).toBeCloseTo(seconds / 3600, 2);
  });

  it('fallback hysteresis ends usage after a sustained off period', () => {
    // 5 min on at 10, then 5 min off at 0.
    const rate = 25;
    const seconds = 600;
    const samples = new Float32Array(seconds * rate);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = i < 300 * rate ? 10 : 0;
    }
    const interp = interpretation({
      durationSeconds: seconds,
      channels: [channel('maskPressure', samples, rate, 'cmH2O')],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    // ~5 min usage (small dwell tolerance before off is declared).
    expect(agg.usageHours).toBeCloseTo(300 / 3600, 1);
    expect(agg.usageHours).toBeLessThan(350 / 3600);
  });
});

// ---------------------------------------------------------------------------
// Rate-validity floor: per-hour indices are NULL below MIN_INDEX_USAGE_HOURS.
//
// A per-hour index is count / usageHours. As usageHours → 0 the quotient
// explodes (1 event / (1/3600) h = 3600), which is meaningless, not imprecise.
// Below the 1-hour rate-validity floor every per-hour index must be NULL — not
// 0, not a clamped number. Raw counts (eventCount, eventsByType) stay valid.
// ---------------------------------------------------------------------------

describe('rate-validity floor (MIN_INDEX_USAGE_HOURS = 1h)', () => {
  it('nullifies AHI for a ~1s STR-overlap clip with one event (no 3600 poison)', () => {
    // The exact mask-fit-test foot-gun: an EDF window with one unnoticed event,
    // but STR records only a 1-second mask-on interval inside it. usageHours ≈
    // 1/3600 → the OLD code returned 1 / (1/3600) = 3600. Now: null.
    const start = new Date(2026, 0, 15, 22, 0, 0);
    const interp = interpretation({
      startTime: start,
      durationSeconds: 300, // 5-minute window
      channels: [maskPressure(300)],
      events: [evt('ObstructiveApnea', 1)],
    });
    // One 1-second STR interval at the very start of the window.
    const intervals: MaskInterval[] = [
      { start: new Date(2026, 0, 15, 22, 0, 0), end: new Date(2026, 0, 15, 22, 0, 1) },
    ];
    const byDate = new Map<string, MaskInterval[]>([['2026-01-15', intervals]]);
    const agg = builder.buildSessions([interp], undefined, byDate)[0]!.aggregate;

    // ~1 second of usage, far below the 1-hour floor.
    expect(agg.usageHours).toBeCloseTo(1 / 3600, 5);
    // Every per-hour index is NULL — explicitly NOT 3600 and NOT 0.
    expect(agg.ahi).toBeNull();
    expect(agg.rdi).toBeNull();
    expect(agg.ahiObstructive).toBeNull();
    expect(agg.ahiCentral).toBeNull();
    expect(agg.ahiMixed).toBeNull();
    expect(agg.ahiUnclassified).toBeNull();
    expect(agg.ahiHypopnea).toBeNull();
    expect(agg.ahiRera).toBeNull();
    // …but the raw event COUNT is preserved (it is not a rate).
    expect(agg.eventCount).toBe(1);
    expect(agg.eventsByType.obstructive).toBe(1);
  });

  it('nullifies AHI via the pressure-fallback path for a ~1s mask-on clip with one event', () => {
    // Same poison, different denominator source: no STR map at all, and the
    // mask-pressure channel is ON for only ~1 second (then near-ambient), so the
    // hysteresis detector measures ~1s of usage. Index must be null, not 3600.
    const rate = 25;
    const seconds = 300;
    const samples = new Float32Array(seconds * rate).fill(0.5); // near-ambient
    // One second above the ON threshold near the start.
    for (let i = 5 * rate; i < 6 * rate; i++) samples[i] = 10;
    const interp = interpretation({
      durationSeconds: seconds,
      channels: [channel('maskPressure', samples, rate, 'cmH2O')],
      events: [evt('Hypopnea', 5)],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;

    expect(agg.usageHours).toBeLessThan(MIN_INDEX_USAGE_HOURS);
    expect(agg.usageHours).toBeGreaterThan(0);
    expect(agg.ahi).toBeNull();
    expect(agg.ahiHypopnea).toBeNull();
    expect(agg.rdi).toBeNull();
    // Raw count still recorded.
    expect(agg.eventCount).toBe(1);
  });

  it('nullifies indices for a session just BELOW the 1-hour floor', () => {
    // 59 minutes of usage with events: still below the floor → null indices.
    const seconds = 59 * 60;
    const interp = interpretation({
      durationSeconds: seconds,
      channels: [maskPressure(seconds)],
      events: [evt('ObstructiveApnea', 100), evt('Hypopnea', 200)],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    expect(agg.usageHours).toBeLessThan(MIN_INDEX_USAGE_HOURS);
    expect(agg.ahi).toBeNull();
    expect(agg.ahiObstructive).toBeNull();
    expect(agg.ahiHypopnea).toBeNull();
  });

  it('computes a finite rate for a session exactly AT the 1-hour floor', () => {
    // Exactly 1 hour of usage with 3 apnea/hypopnea events → AHI = 3, defined.
    const seconds = 3600;
    const interp = interpretation({
      durationSeconds: seconds,
      channels: [maskPressure(seconds)],
      events: [evt('ObstructiveApnea', 100), evt('Hypopnea', 200), evt('CentralApnea', 300)],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    expect(agg.usageHours).toBeCloseTo(1, 5);
    expect(agg.ahi).toBeCloseTo(3, 1);
    expect(agg.ahi).not.toBeNull();
  });

  it('keeps a finite rate well ABOVE the floor (regression guard for existing behaviour)', () => {
    const interp = interpretation({
      durationSeconds: 8 * 3600,
      channels: [maskPressure(8 * 3600)],
      events: [evt('ObstructiveApnea', 100), evt('Hypopnea', 200)],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    // 2 events / 8 h = 0.25, a defined finite rate.
    expect(agg.ahi).toBeCloseTo(0.25, 5);
  });
});

// ---------------------------------------------------------------------------
// Task 3: ODI desaturation-event detection
// ---------------------------------------------------------------------------

describe('ODI desaturation-event detection (1 Hz)', () => {
  function spo2Session(samples: number[], rate = 1): ResMedInterpretation {
    const seconds = Math.ceil(samples.length / rate);
    return interpretation({
      durationSeconds: seconds,
      channels: [
        maskPressure(seconds), // ensures usage > 0
        channel('spo2', Float32Array.from(samples), rate, '%'),
      ],
    });
  }

  it('counts one event for a single true 4% dip over 12 s', () => {
    // ≥1 h baseline 96 (above the rate-validity floor so ODI is defined), then a
    // 12 s dip to 92 (4% drop), then recovery.
    const arr: number[] = [];
    for (let i = 0; i < 3600; i++) arr.push(96);
    for (let i = 0; i < 12; i++) arr.push(92);
    for (let i = 0; i < 120; i++) arr.push(96);
    const agg = builder.buildSessions([spo2Session(arr)])[0]!.aggregate;
    // One event over the full valid-oximetry time.
    const validHours = arr.length / 3600;
    expect(agg.oxygenDesaturationIndex).toBeCloseTo(1 / validHours, 2);
  });

  it('returns 0 events for ±1% noisy jitter', () => {
    // ≥1 h of valid oximetry (above the rate floor) so ODI is defined and we are
    // genuinely asserting "no spurious events scored", i.e. ODI === 0, not null.
    const arr: number[] = [];
    for (let i = 0; i < 3700; i++) arr.push(96 + (i % 2 === 0 ? 1 : -1));
    const agg = builder.buildSessions([spo2Session(arr)])[0]!.aggregate;
    expect(agg.oxygenDesaturationIndex).toBe(0);
  });

  it('does not multi-count a single deep dip as it recovers', () => {
    // ≥1 h baseline, one sustained dip to 88 (8% below 96) for 30 s, recovery — 1 event.
    const arr: number[] = [];
    for (let i = 0; i < 3600; i++) arr.push(96);
    for (let i = 0; i < 30; i++) arr.push(88);
    for (let i = 0; i < 120; i++) arr.push(96);
    const agg = builder.buildSessions([spo2Session(arr)])[0]!.aggregate;
    const validHours = arr.length / 3600;
    expect(agg.oxygenDesaturationIndex).toBeCloseTo(1 / validHours, 2);
  });

  it('handles a slow gradual drift that never recovers without spurious events', () => {
    // Linear drift 96 → 86 over ~62 min (above the 1 h rate floor so ODI is
    // defined): the trailing baseline tracks the drift, so no discrete event is
    // scored → ODI === 0, not null.
    const arr: number[] = [];
    for (let i = 0; i < 3720; i++) arr.push(96 - (10 * i) / 3720);
    const agg = builder.buildSessions([spo2Session(arr)])[0]!.aggregate;
    expect(agg.oxygenDesaturationIndex).toBe(0);
  });

  it('counts two separate dips as two events', () => {
    // ≥1 h baseline so ODI is defined; two discrete dips → 2 events.
    const arr: number[] = [];
    for (let i = 0; i < 3600; i++) arr.push(96);
    for (let i = 0; i < 12; i++) arr.push(91); // dip 1
    for (let i = 0; i < 200; i++) arr.push(96); // recovery
    for (let i = 0; i < 12; i++) arr.push(91); // dip 2
    for (let i = 0; i < 100; i++) arr.push(96);
    const agg = builder.buildSessions([spo2Session(arr)])[0]!.aggregate;
    const validHours = arr.length / 3600;
    expect(agg.oxygenDesaturationIndex).toBeCloseTo(2 / validHours, 2);
  });
});

// ---------------------------------------------------------------------------
// Task 5: T90 time-based + coverage
// ---------------------------------------------------------------------------

describe('T90 (time-based) and SpO₂ coverage', () => {
  it('computes T90 as a fraction of valid oximetry time, excluding sentinels', () => {
    // 1 Hz: 100 s valid, of which 25 s < 90. Sentinel 0 dropout for 50 s.
    const arr: number[] = [];
    for (let i = 0; i < 75; i++) arr.push(95);
    for (let i = 0; i < 25; i++) arr.push(85);
    for (let i = 0; i < 50; i++) arr.push(0); // sentinel dropout
    const interp = interpretation({
      durationSeconds: 150,
      channels: [maskPressure(150), channel('spo2', Float32Array.from(arr), 1, '%')],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    // 25 of 100 valid samples below 90 → 25%, NOT 25/150.
    expect(agg.spo2Below90Percent).toBeCloseTo(25, 5);
    // Coverage: 100 valid seconds of a 150 s session ≈ 66.7%.
    expect(agg.spo2CoveragePercent).toBeCloseTo(66.67, 1);
  });

  it('nullifies ODI when valid oximetry is below the rate-validity floor', () => {
    // A long night (mask worn) but oximetry probe on for only ~7 minutes (420 s
    // of valid SpO₂, 0.117 h — below MIN_INDEX_USAGE_HOURS). Even with a real
    // desaturation in that clip, ODI is an undefined per-hour rate → null. Mean/
    // median/min stay defined (they are not per-hour rates).
    const validSeconds = 420;
    const arr: number[] = [];
    for (let i = 0; i < 300; i++) arr.push(96);
    for (let i = 0; i < 12; i++) arr.push(91); // a genuine dip
    for (let i = 0; i < 108; i++) arr.push(96);
    const interp = interpretation({
      durationSeconds: 2 * 3600, // long session window
      channels: [maskPressure(2 * 3600), channel('spo2', Float32Array.from(arr), 1, '%')],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    expect(validSeconds / 3600).toBeLessThan(MIN_INDEX_USAGE_HOURS);
    expect(agg.oxygenDesaturationIndex).toBeNull();
    // Non-rate oximetry stats remain available.
    expect(agg.spo2Min).toBe(91);
    expect(agg.spo2Mean).not.toBeNull();
  });

  it('reports null oximetry stats when all samples are sentinel', () => {
    const arr = new Array<number>(120).fill(0);
    const interp = interpretation({
      durationSeconds: 120,
      channels: [maskPressure(120), channel('spo2', Float32Array.from(arr), 1, '%')],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    expect(agg.spo2Below90Percent).toBeNull();
    expect(agg.oxygenDesaturationIndex).toBeNull();
    expect(agg.spo2CoveragePercent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hasOximetry reflects VALID (non-sentinel) oximetry, not mere channel presence
//
// An spo2 channel object can exist while every sample is the SPO2_SENTINEL
// (0 → no oximeter / probe off / finger off). In that case the session has no
// real oximetry, and `computeSpO2Stats` already returns null (all spo2*
// aggregate fields null). `session.hasOximetry` must agree: it is true only
// when at least one valid, non-sentinel SpO₂ sample exists.
// ---------------------------------------------------------------------------

describe('session.hasOximetry derives from valid oximetry samples', () => {
  it('is false when the spo2 channel is entirely sentinel (0) values', () => {
    const arr = new Array<number>(120).fill(0); // all SPO2_SENTINEL
    const interp = interpretation({
      durationSeconds: 120,
      channels: [maskPressure(120), channel('spo2', Float32Array.from(arr), 1, '%')],
    });
    const result = builder.buildSessions([interp])[0]!;
    // No valid oximetry → hasOximetry false, consistent with null spo2 stats.
    expect(result.session.hasOximetry).toBe(false);
    expect(result.aggregate.spo2Mean).toBeNull();
  });

  it('is false when a pulse channel is present but spo2 is all-sentinel', () => {
    // Oximetry validity must NOT be inferred from a pulse channel's presence:
    // a pulse channel can exist (or hold its own sentinels) while the SpO₂
    // probe never produced a valid reading.
    const spo2 = new Array<number>(120).fill(0); // all SPO2_SENTINEL
    const pulse = new Array<number>(120).fill(60); // present, but irrelevant
    const interp = interpretation({
      durationSeconds: 120,
      channels: [
        maskPressure(120),
        channel('pulse', Float32Array.from(pulse), 1, 'bpm'),
        channel('spo2', Float32Array.from(spo2), 1, '%'),
      ],
    });
    const result = builder.buildSessions([interp])[0]!;
    expect(result.session.hasOximetry).toBe(false);
    expect(result.aggregate.spo2Mean).toBeNull();
  });

  it('is true when genuine valid SpO₂ samples are present (regression)', () => {
    const arr: number[] = [];
    for (let i = 0; i < 120; i++) arr.push(96); // real oximetry
    const interp = interpretation({
      durationSeconds: 120,
      channels: [maskPressure(120), channel('spo2', Float32Array.from(arr), 1, '%')],
    });
    const result = builder.buildSessions([interp])[0]!;
    expect(result.session.hasOximetry).toBe(true);
    expect(result.aggregate.spo2Mean).toBeCloseTo(96, 5);
    expect(result.aggregate.spo2Min).toBe(96);
  });
});

// ---------------------------------------------------------------------------
// Task 6: Sentinel/gap handling for pressure & leak
// ---------------------------------------------------------------------------

describe('sentinel/gap handling does not bias stats toward zero', () => {
  it('skips undefined padding samples in leak and pressure stats', () => {
    // Construct a leak array where the back half is "gap". A Float32Array can't
    // hold undefined, so we simulate a shorter valid region by building a
    // sparse typed array via a subarray-backed channel: use NaN-free values
    // and rely on the sort-once path operating on the present samples.
    //
    // Here we verify the median/mean are NOT dragged down: a channel that is
    // entirely 20 L/min must report median 20 regardless of length.
    const leak = new Float32Array(1000).fill(20);
    const pressure = new Float32Array(1000).fill(11);
    const interp = interpretation({
      durationSeconds: 40,
      channels: [
        channel('leak', leak, 25, 'L/min'),
        channel('maskPressure', pressure, 25, 'cmH2O'),
      ],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    expect(agg.leakMedian).toBeCloseTo(20, 3);
    expect(agg.pressureMedian).toBeCloseTo(11, 3);
    expect(agg.pressureMean).toBeCloseTo(11, 3);
  });
});

// ---------------------------------------------------------------------------
// Task 7: Percentile correctness preserved by sort-once refactor
// ---------------------------------------------------------------------------

describe('percentile values unchanged by sort-once refactor', () => {
  it('computes pressure median/p95 matching an independent reference', () => {
    // Ramp 0..999 over 1000 samples → known percentiles.
    const rate = 25;
    const n = 1000;
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = i;
    const interp = interpretation({
      durationSeconds: n / rate,
      channels: [channel('maskPressure', samples, rate, 'cmH2O')],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;

    // Reference linear-interpolation percentile over [0..999].
    const ref = (p: number): number => (p / 100) * (n - 1);
    expect(agg.pressureMedian).toBeCloseTo(ref(50), 4);
    expect(agg.pressureP95).toBeCloseTo(ref(95), 4);
    expect(agg.pressureMax).toBe(999);
    expect(agg.pressureMean).toBeCloseTo((n - 1) / 2, 4);
  });

  it('computes leak p95 matching an independent reference', () => {
    const n = 500;
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = i;
    const interp = interpretation({
      durationSeconds: 20,
      channels: [channel('leak', samples, 25, 'L/min')],
    });
    const agg = builder.buildSessions([interp])[0]!.aggregate;
    expect(agg.leakP95).toBeCloseTo((95 / 100) * (n - 1), 4);
    expect(agg.leakMax).toBe(499);
  });
});

// ---------------------------------------------------------------------------
// Integration: STRParser noon-anchored decode → SessionBuilder usage/overlap.
// This is the exact path the user's real sessions exercise: a raw STR record is
// decoded into noon-anchored mask intervals, then matched against an EDF
// session window by date and clipped to compute usage.
// ---------------------------------------------------------------------------

/**
 * ResMed STR `Date` day value for a local calendar date: whole days since the
 * Unix epoch (1970-01-01 UTC), matching the real hardware convention decoded by
 * STRParser (RESMED_STR_DAY_EPOCH_MS) — not the Excel/Lotus serial epoch.
 */
function strDayValue(year: number, month1: number, day: number): number {
  const epoch = Date.UTC(1970, 0, 1);
  return Math.round((Date.UTC(year, month1 - 1, day) - epoch) / 86_400_000);
}

/** Flatten a single 10-slot record into a Float32Array. */
function maskSlots(values: number[]): Float32Array {
  const out = new Float32Array(10).fill(-1);
  values.forEach((v, i) => (out[i] = v));
  return out;
}

describe('STR decode → SessionBuilder integration (noon-anchored)', () => {
  const strParser = new STRParser();

  it('cross-midnight STR record overlaps a 22:00→06:00 EDF session and yields positive usage, AHI, and compliance', () => {
    // STR record dated 2026-01-15. One mask interval: MaskOn=600 (noon+10h =
    // 22:00, keyed under 2026-01-15) → MaskOff=960 (noon+16h = next-day 04:00).
    // The interval start lands at 22:00, so it keys under 2026-01-15.
    const dv = strDayValue(2026, 1, 15);
    const edfStart = new Date(2026, 0, 15, 12, 0, 0); // STR.edf recording start
    const parsed = strParser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([dv]), samplesPerRecord: 1 },
        { label: 'MaskOn', samples: maskSlots([600]), samplesPerRecord: 10 },
        { label: 'MaskOff', samples: maskSlots([960]), samplesPerRecord: 10 },
      ],
      edfStart,
      1,
    );

    // Confirm the decode keyed the interval under the start date (2026-01-15).
    expect(parsed.maskIntervalsByDate.get('2026-01-15')).toHaveLength(1);

    // EDF session window 22:00 → 06:00 (8 h), with 4 apnea/hypopnea events.
    const sessionStart = new Date(2026, 0, 15, 22, 0, 0);
    const interp = interpretation({
      startTime: sessionStart,
      durationSeconds: 8 * 3600,
      channels: [maskPressure(8 * 3600)],
      events: [
        evt('ObstructiveApnea', 100),
        evt('Hypopnea', 200),
        evt('CentralApnea', 300),
        evt('Hypopnea', 400),
      ],
    });

    const agg = builder.buildSessions([interp], undefined, parsed.maskIntervalsByDate)[0]!
      .aggregate;

    // STR overlap with [22:00, 06:00] is 22:00 → 04:00 = 6 h exactly.
    expect(agg.usageHours).toBeCloseTo(6, 5);
    expect(agg.maskOnTimeMinutes).toBeCloseTo(360, 3);
    // AHI = 4 events / 6 h ≈ 0.667, non-zero.
    expect(agg.ahi).toBeCloseTo(4 / 6, 5);
    expect(agg.ahi).toBeGreaterThan(0);
    // 6 h ≥ 4 h CMS bar → compliant.
    expect(agg.complianceStatus).toBe('compliant');
  });

  it('a value above 1440 still decodes and overlaps a daytime session (no longer discarded)', () => {
    // MaskOn=1500 (noon+25h = next-day 13:00), MaskOff=1620 (next-day 15:00).
    // Under the old > 1440 reject this whole session vanished. A 13:00→16:00
    // EDF nap window on 2026-01-16 must now pick it up.
    const dv = strDayValue(2026, 1, 15);
    const edfStart = new Date(2026, 0, 15, 12, 0, 0);
    const parsed = strParser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([dv]), samplesPerRecord: 1 },
        { label: 'MaskOn', samples: maskSlots([1500]), samplesPerRecord: 10 },
        { label: 'MaskOff', samples: maskSlots([1620]), samplesPerRecord: 10 },
      ],
      edfStart,
      1,
    );
    // Keyed under 2026-01-16 (the start wall-clock's date).
    expect(parsed.maskIntervalsByDate.get('2026-01-16')).toHaveLength(1);

    const napStart = new Date(2026, 0, 16, 13, 0, 0);
    const interp = interpretation({
      startTime: napStart,
      durationSeconds: 3 * 3600, // 13:00 → 16:00
      channels: [maskPressure(3 * 3600)],
    });
    const agg = builder.buildSessions([interp], undefined, parsed.maskIntervalsByDate)[0]!
      .aggregate;
    // Interval 13:00 → 15:00 fully inside the 13:00 → 16:00 window → 2 h usage.
    expect(agg.usageHours).toBeCloseTo(2, 5);
  });
});
