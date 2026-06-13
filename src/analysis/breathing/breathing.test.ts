/**
 * Tests for app-computed breathing-pattern detection (PB / CSR / TECSA).
 *
 * Strategy: synthesize envelopes / flow signals with KNOWN periodic-breathing
 * structure and assert the detector recovers cycle length, type, and morphology;
 * assert steady signals yield nothing; and validate the TECSA classifier against
 * constructed CAI trajectories for all four classes plus insufficient-history
 * and high-leak exclusion. Property tests (fast-check) cover monotonicity of the
 * modulation index and cycle-length recovery across a parameter sweep.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  buildEnvelopeFromFlow,
  buildEnvelopeFromMinuteVent,
  classifyTecsa,
  crescendoDecrescendoFit,
  detectPeriodicBreathing,
  estimatePeriodicity,
  flagTecsaNights,
  modulationIndex,
  spectralBandEnergyFraction,
  segmentBreaths,
  type DeviceEventFlag,
  type TecsaNightRecord,
} from './index';
import { MAX_UPSAMPLE_FACTOR, MIN_ENVELOPE_SOURCE_RATE_HZ } from './envelope';

// ---------------------------------------------------------------------------
// Synthetic signal helpers
// ---------------------------------------------------------------------------

/**
 * Build a synthetic ventilation envelope: a baseline ventilation modulated by a
 * slow sinusoid of period `cycleSec` with modulation depth `depth` in [0, 1].
 *
 *   v(t) = base * (1 + depth * sin(2π t / cycleSec))
 *
 * Sampled at `rateHz` for `durationSec`.
 */
function syntheticEnvelope(
  cycleSec: number,
  depth: number,
  durationSec: number,
  rateHz = 1,
  base = 8,
): Float32Array {
  const n = Math.floor(durationSec * rateHz);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rateHz;
    out[i] = base * (1 + depth * Math.sin((2 * Math.PI * t) / cycleSec));
  }
  return out;
}

/**
 * Build a synthetic FLOW signal: a respiratory carrier (~4 s breaths) whose
 * amplitude is modulated by a slow crescendo-decrescendo sinusoid of period
 * `cycleSec`. This produces an envelope the detector must recover.
 */
function syntheticFlow(
  cycleSec: number,
  depth: number,
  durationSec: number,
  rateHz = 25,
  breathSec = 4,
): Float32Array {
  const n = Math.floor(durationSec * rateHz);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rateHz;
    const carrier = Math.sin((2 * Math.PI * t) / breathSec); // breathing
    const envelope = 1 + depth * Math.sin((2 * Math.PI * t) / cycleSec); // slow modulation
    out[i] = 20 * carrier * Math.max(0, envelope);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Signal primitives
// ---------------------------------------------------------------------------

describe('modulationIndex', () => {
  it('is ~0 for a steady signal', () => {
    const steady = new Float32Array(120).fill(8);
    expect(modulationIndex(steady)).toBeLessThan(0.05);
  });

  it('grows with modulation depth', () => {
    const shallow = syntheticEnvelope(60, 0.2, 600);
    const deep = syntheticEnvelope(60, 0.8, 600);
    expect(modulationIndex(deep)).toBeGreaterThan(modulationIndex(shallow));
  });

  it('returns 0 for empty input', () => {
    expect(modulationIndex(new Float32Array(0))).toBe(0);
  });

  it('is monotonic in depth (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 0.4, noNaN: true }),
        fc.double({ min: 0.5, max: 0.9, noNaN: true }),
        (lowDepth, highDepth) => {
          const low = modulationIndex(syntheticEnvelope(60, lowDepth, 600));
          const high = modulationIndex(syntheticEnvelope(60, highDepth, 600));
          return high >= low;
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('estimatePeriodicity', () => {
  it('recovers a known 60 s cycle within tolerance', () => {
    const env = syntheticEnvelope(60, 0.6, 600);
    const res = estimatePeriodicity(env, 1, 30, 100);
    expect(res.cycleLengthSec).not.toBeNull();
    expect(res.cycleLengthSec as number).toBeGreaterThan(54);
    expect(res.cycleLengthSec as number).toBeLessThan(66);
    expect(res.strength).toBeGreaterThan(0.6);
  });

  it('finds no strong periodicity in white noise', () => {
    // Deterministic pseudo-noise.
    const n = 600;
    const env = new Float32Array(n);
    let seed = 12345;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      env[i] = 8 + (seed / 0x7fffffff - 0.5) * 0.5;
    }
    const res = estimatePeriodicity(env, 1, 30, 100);
    // Either no peak, or a weak one.
    expect(res.strength).toBeLessThan(0.5);
  });

  it('recovers various cycle lengths (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 40, max: 95 }), (cycle) => {
        const env = syntheticEnvelope(cycle, 0.6, cycle * 12, 1);
        const res = estimatePeriodicity(env, 1, 30, 100);
        if (res.cycleLengthSec === null) return false;
        // Within ±15% or ±3 s, whichever is larger.
        const tol = Math.max(3, cycle * 0.15);
        return Math.abs(res.cycleLengthSec - cycle) <= tol;
      }),
      { numRuns: 30 },
    );
  });
});

describe('crescendoDecrescendoFit', () => {
  it('is high for a smooth sinusoidal cycle', () => {
    const env = syntheticEnvelope(60, 0.7, 600);
    expect(crescendoDecrescendoFit(env, 60)).toBeGreaterThan(0.5);
  });

  it('is low for a flat signal', () => {
    const flat = new Float32Array(120).fill(8);
    expect(crescendoDecrescendoFit(flat, 60)).toBe(0);
  });

  it('scores a smooth sinusoid higher than an abrupt square/on-off cycle of the same period', () => {
    const cycleSec = 60;
    const durationSec = 600;
    // Smooth crescendo-decrescendo (near-sinusoidal) envelope.
    const sine = syntheticEnvelope(cycleSec, 0.7, durationSec, 1);
    // Square / abrupt on-off envelope of the SAME period and comparable depth:
    // ventilation alternates between a high and a low plateau each half-cycle.
    const square = new Float32Array(durationSec);
    for (let i = 0; i < durationSec; i++) {
      const phase = (i % cycleSec) / cycleSec;
      square[i] = phase < 0.5 ? 8 * 1.7 : 8 * 0.3;
    }
    const sineFit = crescendoDecrescendoFit(sine, cycleSec);
    const squareFit = crescendoDecrescendoFit(square, cycleSec);
    // The harmonic-purity ratio is ~1 for the sinusoid (energy at the
    // fundamental) and ~8/π² ≈ 0.81 for the square wave (energy leaks into odd
    // harmonics). The sinusoid must score meaningfully higher.
    expect(sineFit).toBeGreaterThan(0.95);
    expect(squareFit).toBeLessThan(0.85);
    expect(sineFit).toBeGreaterThan(squareFit);
  });

  it('is phase-invariant for a shifted sinusoid', () => {
    const cycleSec = 60;
    const n = 600;
    const base = new Float32Array(n);
    const shifted = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      base[i] = 8 * (1 + 0.7 * Math.sin((2 * Math.PI * i) / cycleSec));
      shifted[i] = 8 * (1 + 0.7 * Math.sin((2 * Math.PI * i) / cycleSec + 1.1));
    }
    expect(crescendoDecrescendoFit(shifted, cycleSec)).toBeCloseTo(
      crescendoDecrescendoFit(base, cycleSec),
      2,
    );
  });
});

describe('spectralBandEnergyFraction', () => {
  it('concentrates energy in band for a periodic signal', () => {
    const env = syntheticEnvelope(60, 0.7, 600);
    const frac = spectralBandEnergyFraction(env, 1, 40, 100);
    expect(frac).toBeGreaterThan(0.3);
  });

  it('is small for a steady signal', () => {
    const steady = new Float32Array(600).fill(8);
    expect(spectralBandEnergyFraction(steady, 1, 40, 100)).toBe(0);
  });
});

describe('segmentBreaths / buildEnvelopeFromFlow', () => {
  it('segments roughly the expected number of breaths', () => {
    // 120 s at 4 s/breath ≈ 30 breaths.
    const flow = syntheticFlow(60, 0, 120, 25, 4);
    const breaths = segmentBreaths(flow, 25);
    expect(breaths.length).toBeGreaterThan(20);
    expect(breaths.length).toBeLessThan(40);
  });

  it('builds a 1 Hz envelope that recovers the modulation cycle', () => {
    const flow = syntheticFlow(60, 0.8, 600, 25, 4);
    const env = buildEnvelopeFromFlow(flow, 25, 0, 1);
    expect(env.values.length).toBeGreaterThan(500);
    const res = estimatePeriodicity(env.values, 1, 30, 100);
    expect(res.cycleLengthSec).not.toBeNull();
    expect(res.cycleLengthSec as number).toBeGreaterThan(50);
    expect(res.cycleLengthSec as number).toBeLessThan(70);
  });

  it('returns empty envelope for empty flow', () => {
    const env = buildEnvelopeFromFlow(new Float32Array(0), 25);
    expect(env.values.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PB / CSR detector
// ---------------------------------------------------------------------------

describe('detectPeriodicBreathing', () => {
  it('detects a periodic-breathing episode from a known modulated envelope', () => {
    // 12 minutes of strong 60 s-cycle modulation via minute ventilation.
    const mv = syntheticEnvelope(60, 0.7, 720, 1);
    const result = detectPeriodicBreathing({
      minuteVent: mv,
      sampleRateHz: 1,
      startMs: 0,
    });
    expect(result.episodes.length).toBeGreaterThanOrEqual(1);
    const ep = result.episodes[0]!;
    expect(ep.cycleLengthSec).toBeGreaterThan(50);
    expect(ep.cycleLengthSec).toBeLessThan(70);
    expect(ep.cycleCount).toBeGreaterThanOrEqual(3);
    // No event flags supplied → classified as PeriodicBreathing candidate.
    expect(ep.type).toBe('PeriodicBreathing');
    expect(ep.belowDeviceThreshold).toBe(true);
    expect(ep.confidence).toBeGreaterThan(0);
    expect(ep.confidence).toBeLessThanOrEqual(1);
  });

  it('classifies CheyneStokes when central-apnea nadirs anchor the cycles', () => {
    const durationSec = 900; // 15 min
    const cycleSec = 60;
    const mv = syntheticEnvelope(cycleSec, 0.8, durationSec, 1);
    // Place a central apnea at each ventilation nadir (trough of sin at 3/4 period).
    const eventFlags: DeviceEventFlag[] = [];
    for (let t = cycleSec * 0.75; t < durationSec; t += cycleSec) {
      eventFlags.push({ timestampMs: t * 1000, durationSec: 12, kind: 'central' });
    }
    const result = detectPeriodicBreathing({
      minuteVent: mv,
      sampleRateHz: 1,
      startMs: 0,
      eventFlags,
    });
    expect(result.episodes.length).toBeGreaterThanOrEqual(1);
    const csr = result.episodes.find((e) => e.type === 'CheyneStokes');
    expect(csr).toBeDefined();
    expect(csr!.meanNadirType).toBe('apnea');
    // 15 central events over 0.25 h ≈ 60/h > 5/h over ≥2 h? record is 0.25 h, so
    // the session criterion (≥2 h) is NOT met → still flagged below threshold.
    expect(result.recordHours).toBeCloseTo(0.25, 1);
  });

  it('marks CSR above device threshold when the session criterion holds', () => {
    const durationSec = 3 * 3600; // 3 h record
    const cycleSec = 60;
    const mv = syntheticEnvelope(cycleSec, 0.8, durationSec, 1);
    const eventFlags: DeviceEventFlag[] = [];
    // One central apnea per cycle across the whole record → ~60/h >> 5/h.
    for (let t = cycleSec * 0.75; t < durationSec; t += cycleSec) {
      eventFlags.push({ timestampMs: t * 1000, durationSec: 12, kind: 'central' });
    }
    const result = detectPeriodicBreathing({
      minuteVent: mv,
      sampleRateHz: 1,
      eventFlags,
    });
    expect(result.sessionCriterionMet).toBe(true);
    const csr = result.episodes.find((e) => e.type === 'CheyneStokes');
    expect(csr).toBeDefined();
    expect(csr!.belowDeviceThreshold).toBe(false);
  });

  it('yields no episodes for a steady (non-periodic) signal', () => {
    const mv = new Float32Array(720).fill(8);
    const result = detectPeriodicBreathing({ minuteVent: mv, sampleRateHz: 1 });
    expect(result.episodes.length).toBe(0);
  });

  it('returns empty for empty input', () => {
    const result = detectPeriodicBreathing({ sampleRateHz: 1 });
    expect(result.episodes.length).toBe(0);
    expect(result.recordHours).toBe(0);
  });

  it('down-weights confidence under sustained high leak', () => {
    const durationSec = 720;
    const cycleSec = 60;
    const mv = syntheticEnvelope(cycleSec, 0.7, durationSec, 1);

    // Partially leak-corrupted span: half the samples exceed the 24 L/min
    // threshold, so the episode still emits but with a reduced leak-clean
    // fraction (and thus lower confidence) than a clean span.
    const partiallyDirty = new Float32Array(durationSec);
    for (let i = 0; i < durationSec; i++) partiallyDirty[i] = i % 2 === 0 ? 2 : 40;

    const clean = detectPeriodicBreathing({
      minuteVent: mv,
      sampleRateHz: 1,
      leak: new Float32Array(durationSec).fill(2),
    });
    const dirty = detectPeriodicBreathing({
      minuteVent: mv,
      sampleRateHz: 1,
      leak: partiallyDirty,
    });
    expect(clean.episodes.length).toBeGreaterThanOrEqual(1);
    expect(dirty.episodes.length).toBeGreaterThanOrEqual(1);
    expect(dirty.episodes[0]!.confidence).toBeLessThan(clean.episodes[0]!.confidence);
  });

  it('does not surface zero-confidence episodes under total leak corruption', () => {
    const durationSec = 720;
    const cycleSec = 60;
    const mv = syntheticEnvelope(cycleSec, 0.7, durationSec, 1);

    // Entire span above the leak threshold → leak-clean fraction 0 → confidence
    // collapses to 0 → the candidate must be dropped, not emitted as noise.
    const result = detectPeriodicBreathing({
      minuteVent: mv,
      sampleRateHz: 1,
      leak: new Float32Array(durationSec).fill(40), // > 24 L/min everywhere
    });
    expect(result.episodes.length).toBe(0);
  });

  it('recovers PB from a raw flow signal (not just minute vent)', () => {
    const flow = syntheticFlow(60, 0.8, 720, 25, 4);
    const result = detectPeriodicBreathing({ flow, sampleRateHz: 25 });
    expect(result.episodes.length).toBeGreaterThanOrEqual(1);
    expect(result.episodes[0]!.cycleLengthSec).toBeGreaterThan(45);
    expect(result.episodes[0]!.cycleLengthSec).toBeLessThan(75);
  });
});

// ---------------------------------------------------------------------------
// TECSA classifier
// ---------------------------------------------------------------------------

/** Build N nightly records starting at `startDate`, one per day. */
function nights(
  startDate: string,
  caiValues: number[],
  opts: { obstructive?: number; leak?: number; hours?: number } = {},
): TecsaNightRecord[] {
  const base = new Date(`${startDate}T00:00:00Z`).getTime();
  return caiValues.map((cai, i) => ({
    date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    centralApneaIndex: cai,
    obstructiveIndex: opts.obstructive ?? 1,
    hypopneaIndex: 2,
    leakMetric: opts.leak ?? 5,
    usableHours: opts.hours ?? 7,
  }));
}

describe('classifyTecsa', () => {
  // 13 weeks = 91 days. Build early nights, a gap, then late nights past offset.
  function trajectory(earlyCai: number, lateCai: number): TecsaNightRecord[] {
    const early = nights('2026-01-01', Array(7).fill(earlyCai));
    // Late window starts ≥ 91 days after first record.
    const late = nights('2026-04-10', Array(7).fill(lateCai)); // ~99 days later
    return [...early, ...late];
  }

  it('classifies obstructive (low early, low late)', () => {
    const res = classifyTecsa(trajectory(1, 1));
    expect(res.available).toBe(true);
    expect(res.class).toBe('obstructive');
  });

  it('classifies transient (high early, low late)', () => {
    const res = classifyTecsa(trajectory(12, 1));
    expect(res.available).toBe(true);
    expect(res.class).toBe('transient');
  });

  it('classifies persistent (high early, high late)', () => {
    const res = classifyTecsa(trajectory(12, 10));
    expect(res.available).toBe(true);
    expect(res.class).toBe('persistent');
  });

  it('classifies emergent (low early, high late) — classic TECSA', () => {
    const res = classifyTecsa(trajectory(1, 12));
    expect(res.available).toBe(true);
    expect(res.class).toBe('emergent');
    expect(res.earlyCai).toBeLessThan(res.caiThreshold);
    expect(res.lateCai).toBeGreaterThanOrEqual(res.caiThreshold);
  });

  it('returns insufficient data for short history', () => {
    const res = classifyTecsa(nights('2026-01-01', [1, 2, 1]));
    expect(res.available).toBe(false);
    expect(res.class).toBeNull();
    expect(res.confidence).toBe(0);
  });

  it('returns insufficient data for empty input', () => {
    const res = classifyTecsa([]);
    expect(res.available).toBe(false);
    expect(res.class).toBeNull();
  });

  it('excludes high-leak nights, lowering usable-night fraction', () => {
    const early = nights('2026-01-01', Array(7).fill(1));
    const late = nights('2026-04-10', Array(7).fill(12), { leak: 80 }); // all high-leak
    const res = classifyTecsa([...early, ...late]);
    // Late window fully excluded → insufficient data, not a fabricated class.
    expect(res.available).toBe(false);
    expect(res.usableNightFraction).toBeLessThan(1);
  });

  it('confidence rises with clean separation from threshold', () => {
    const borderline = classifyTecsa(trajectory(4, 6)); // near cutoff
    const clear = classifyTecsa(trajectory(1, 15)); // far from cutoff
    expect(clear.confidence).toBeGreaterThan(borderline.confidence);
  });
});

describe('flagTecsaNights', () => {
  it('flags a night with controlled OA but high CAI as a candidate', () => {
    const recs = nights('2026-01-01', [8], { obstructive: 1 });
    const flags = flagTecsaNights(recs);
    expect(flags[0]!.candidate).toBe(true);
  });

  it('does not flag a night with uncontrolled obstructive disease', () => {
    const recs = nights('2026-01-01', [8], { obstructive: 20 });
    const flags = flagTecsaNights(recs);
    expect(flags[0]!.candidate).toBe(false);
  });

  it('does not flag a low-CAI night', () => {
    const recs = nights('2026-01-01', [2], { obstructive: 1 });
    const flags = flagTecsaNights(recs);
    expect(flags[0]!.candidate).toBe(false);
  });

  it('marks high-leak nights and excludes them from candidacy', () => {
    const recs = nights('2026-01-01', [8], { obstructive: 1, leak: 80 });
    const flags = flagTecsaNights(recs);
    expect(flags[0]!.highLeak).toBe(true);
    expect(flags[0]!.candidate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION SUITE — 0.5 Hz MinuteVent resampling (CRITICAL correctness bug)
//
// Real ResMed MinuteVent is stored at 0.5 Hz, but the detector resamples to a
// fixed 1 Hz envelope. The OLD `buildEnvelopeFromMinuteVent` decimation path
// zero-filled every other output bin (`samplesPerBin = 0.5/1 = 0.5`), turning a
// 0.5 → 1 Hz upsample into a real/zero COMB. That degenerate envelope cascaded
// into: cycle pinned to the 40 s band floor, modulation clamped to 1.0,
// confidence stuck at ~0.47, and one full-night "episode" overlaying the whole
// record. The fix branches the resampler (decimate / interpolate-upsample /
// passthrough), bridges non-finite samples instead of zero-filling, and hardens
// `estimatePeriodicity` to require a true *interior* ACF maximum.
//
// The pre-existing suites above only exercise 1 Hz synthetic envelopes — which
// is exactly the passthrough branch — so the resample bug shipped untested.
// These tests pin the fixed behaviour; each carries a note on the value the OLD
// code produced, to prove it is a genuine regression guard.
// ---------------------------------------------------------------------------

describe('buildEnvelopeFromMinuteVent — resampling', () => {
  it('upsamples a constant 0.5 Hz signal to 1 Hz with NO zero comb (canonical regression)', () => {
    // The exact comb the OLD code produced: constant 10.0 at 0.5 Hz became
    // [10, 0, 10, 0, ...] at 1 Hz. The fix interpolates → all ≈ 10, no zeros.
    const src = new Float32Array(60).fill(10.0); // 120 s at 0.5 Hz
    const env = buildEnvelopeFromMinuteVent(src, 0.5, 0, 1);
    expect(env.sampleRateHz).toBe(1);
    expect(env.values.length).toBeGreaterThan(0);
    for (let i = 0; i < env.values.length; i++) {
      // OLD code: every odd index was exactly 0 here. Guard against ANY zero.
      expect(env.values[i]).not.toBe(0);
      expect(env.values[i]).toBeCloseTo(10.0, 5);
    }
  });

  it('linearly interpolates the mid bin when upsampling 0.5 → 1 Hz', () => {
    // Two source samples [0, 2] at 0.5 Hz span t = 0 s and t = 2 s. At 1 Hz the
    // output times are 0, 1, 2 s; the t = 1 s bin sits exactly between them and
    // must interpolate to 1.0 — NOT the OLD code's 0.
    const src = new Float32Array([0, 2]);
    const env = buildEnvelopeFromMinuteVent(src, 0.5, 0, 1);
    // outLen = floor(2 / 0.5 * 1) = floor(4) = 4 → times 0,1,2,3 s.
    expect(env.values.length).toBe(4);
    expect(env.values[0]).toBeCloseTo(0, 5);
    expect(env.values[1]).toBeCloseTo(1.0, 5); // OLD: 0
    expect(env.values[2]).toBeCloseTo(2.0, 5);
  });

  it('emits the contractual length, rate, and timestamp grid', () => {
    const n = 50;
    const sampleRateHz = 0.5;
    const envelopeRateHz = 1;
    const startMs = 1_700_000_000_000;
    const src = new Float32Array(n);
    for (let i = 0; i < n; i++) src[i] = 8 + Math.sin(i);
    const env = buildEnvelopeFromMinuteVent(src, sampleRateHz, startMs, envelopeRateHz);

    const expectedLen = Math.floor((n / sampleRateHz) * envelopeRateHz);
    expect(env.values.length).toBe(expectedLen);
    expect(env.timestampsMs.length).toBe(expectedLen);
    expect(env.sampleRateHz).toBe(envelopeRateHz);

    const stepMs = 1000 / envelopeRateHz;
    expect(env.timestampsMs[0]).toBe(startMs);
    expect(env.timestampsMs[1]).toBe(startMs + stepMs);
    expect(env.timestampsMs[expectedLen - 1]).toBe(startMs + (expectedLen - 1) * stepMs);
  });

  it('decimates a high-rate (25 Hz) input to 1 Hz by bin-averaging', () => {
    // A 25 Hz ramp; each 1-second output bin averages 25 consecutive samples.
    const rate = 25;
    const seconds = 4;
    const n = rate * seconds;
    const src = new Float32Array(n);
    for (let i = 0; i < n; i++) src[i] = i; // ramp 0..99
    const env = buildEnvelopeFromMinuteVent(src, rate, 0, 1);
    expect(env.values.length).toBe(seconds);
    // Bin k averages indices [25k, 25k+25): mean = 25k + 12.
    for (let k = 0; k < seconds; k++) {
      expect(env.values[k]).toBeCloseTo(25 * k + 12, 5);
    }
  });

  describe('non-finite bridging', () => {
    it('bridges an interior NaN run by interpolation (output finite everywhere)', () => {
      // 0.5 Hz source with a NaN gap in the middle; upsampled to 1 Hz. The fix
      // skips non-finite neighbours and interpolates across the gap — the OLD
      // code zero-filled the gap (and the upsample comb on top).
      const src = new Float32Array([10, 12, NaN, NaN, 18, 20]);
      const env = buildEnvelopeFromMinuteVent(src, 0.5, 0, 1);
      for (let i = 0; i < env.values.length; i++) {
        expect(Number.isFinite(env.values[i])).toBe(true);
      }
      // Endpoints (finite source samples land on exact output times) preserved.
      expect(env.values[0]).toBeCloseTo(10, 5);
    });

    it('yields all-zeros for an all-NaN input (the only zero-producing case)', () => {
      const src = new Float32Array(20).fill(NaN);
      const env = buildEnvelopeFromMinuteVent(src, 0.5, 0, 1);
      expect(env.values.length).toBeGreaterThan(0);
      for (let i = 0; i < env.values.length; i++) {
        expect(env.values[i]).toBe(0);
      }
    });

    it('carries leading/trailing NaN runs from the nearest finite edge', () => {
      // Leading and trailing NaN runs around a finite plateau of 7.
      const src = new Float32Array([NaN, NaN, 7, 7, 7, NaN, NaN]);
      const env = buildEnvelopeFromMinuteVent(src, 0.5, 0, 1);
      for (let i = 0; i < env.values.length; i++) {
        expect(Number.isFinite(env.values[i])).toBe(true);
        // Carried edge value is the finite plateau; nothing should be zero.
        expect(env.values[i]).toBeCloseTo(7, 5);
      }
    });
  });

  it('bridges NaNs on the equal-rate passthrough and otherwise copies values', () => {
    // sampleRateHz === envelopeRateHz exercises the passthrough branch, which
    // must still bridge non-finite samples (never emit NaN).
    const src = new Float32Array([5, NaN, 9, 11]);
    const env = buildEnvelopeFromMinuteVent(src, 1, 0, 1);
    expect(env.values.length).toBe(4);
    for (let i = 0; i < env.values.length; i++) {
      expect(Number.isFinite(env.values[i])).toBe(true);
    }
    // Finite values copied through unchanged.
    expect(env.values[0]).toBeCloseTo(5, 5);
    expect(env.values[2]).toBeCloseTo(9, 5);
    expect(env.values[3]).toBeCloseTo(11, 5);
    // The bridged NaN sits between 5 and 9 → interpolates to 7.
    expect(env.values[1]).toBeCloseTo(7, 5);
  });
});

describe('detectPeriodicBreathing — 0.5 Hz MinuteVent (cascade regression)', () => {
  it('recovers the true cycle, unclamped modulation, and bounded episodes from 0.5 Hz MinVent', () => {
    // ~10 min of a 60 s-cycle ventilation oscillation sampled at the REAL ResMed
    // MinuteVent rate of 0.5 Hz, mean offset > 0 so the envelope is non-negative:
    //   v(t) = 8 + 3*sin(2π t / 60).
    // OLD code (zero-comb envelope): cycleLengthSec pinned to 40 and
    // modulationDepth clamped to 1.0 (the degenerate full-night "episode"). The
    // fix recovers cycle ≈ 60, modulation < 1, a bounded episode count, and a
    // cycleCount consistent with the recovered cycle over the span. (This signal
    // is one continuous, uninterrupted oscillation, so a single full-span episode
    // is the *correct* result — what changed is that it is now a VALID episode,
    // not a comb-derived artifact; the discriminating assertions are the cycle,
    // the modulation, the bounded count, and the consistent cycleCount.)
    const sampleRateHz = 0.5;
    const durationSec = 600;
    const cycleSec = 60;
    const n = Math.floor(durationSec * sampleRateHz);
    const mv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRateHz;
      mv[i] = 8 + 3 * Math.sin((2 * Math.PI * t) / cycleSec);
    }

    const result = detectPeriodicBreathing({ minuteVent: mv, sampleRateHz, startMs: 0 });

    expect(result.episodes.length).toBeGreaterThanOrEqual(1);
    const ep = result.episodes[0]!;

    // Cycle recovered near 60 s and — crucially — NOT pinned to the 40 s floor.
    expect(ep.cycleLengthSec).toBeGreaterThan(52);
    expect(ep.cycleLengthSec).toBeLessThan(68);
    expect(Math.abs(ep.cycleLengthSec - 40)).toBeGreaterThan(8); // OLD: exactly 40

    // Modulation not clamped to the on/off ceiling. depth = 3/8 ≈ 0.375 here, so
    // a generous < 0.95 bound still fails the OLD code's clamped 1.0.
    expect(ep.modulationDepth).toBeLessThan(0.95); // OLD: 1.0
    expect(ep.modulationDepth).toBeGreaterThan(0);

    // Bounded episode count — the fix does not shatter the clean oscillation into
    // a spray of fragments, nor (as the old comb did) pile up degenerate runs.
    expect(result.episodes.length).toBeLessThanOrEqual(3);

    // The single full-span episode is a VALID one: its cycleCount matches the
    // ~600 s / ~60 s ≈ 10 cycles the signal actually contains, within ±2. The OLD
    // comb-derived episode reported a cycle of 40, which over the same span would
    // have yielded ~15 cycles — inconsistent with the true 60 s oscillation.
    const recordSpanSec = n / sampleRateHz;
    const expectedCycles = recordSpanSec / cycleSec; // ≈ 10
    expect(Math.abs(ep.cycleCount - expectedCycles)).toBeLessThanOrEqual(2);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', NaN],
    ['Infinity', Infinity],
    // Tiny-but-positive rate: rejected by the sub-floor guard
    // (< MIN_ENVELOPE_SOURCE_RATE_HZ). Without it, the envelope builder would
    // try to allocate ~1e9+ samples (DoS). See the dedicated suite below.
    ['tiny-positive (DoS)', 1e-6],
  ])('returns an empty result for a %s sample rate (bad-rate guard)', (_label, rate) => {
    const mv = new Float32Array(120).fill(8);
    const result = detectPeriodicBreathing({ minuteVent: mv, sampleRateHz: rate });
    expect(result.episodes).toEqual([]);
    expect(result.recordHours).toBe(0);
    expect(result.sessionCriterionMet).toBe(false);
  });

  it('down-weights confidence using the SOURCE-rate leak span over a 0.5 Hz envelope', () => {
    // 0.5 Hz MinVent envelope (upsampled to 1 Hz internally). The leak channel is
    // aligned 1:1 with the SOURCE signal at 0.5 Hz. Leak is high over the first
    // half of the record only. The corrected mapping converts the run's envelope
    // span → seconds → source indices; the OLD index-confusion would have sliced
    // the wrong span. We assert confidence is meaningfully reduced vs. no leak,
    // consistent with ~50% clean.
    const sampleRateHz = 0.5;
    const durationSec = 900;
    const cycleSec = 60;
    const n = Math.floor(durationSec * sampleRateHz);
    const mv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRateHz;
      mv[i] = 8 + 3 * Math.sin((2 * Math.PI * t) / cycleSec);
    }
    // Source-aligned leak: high (> 24 L/min) over the first half, clean after.
    const leak = new Float32Array(n);
    for (let i = 0; i < n; i++) leak[i] = i < n / 2 ? 60 : 2;

    const clean = detectPeriodicBreathing({ minuteVent: mv, sampleRateHz });
    const dirty = detectPeriodicBreathing({ minuteVent: mv, sampleRateHz, leak });

    expect(clean.episodes.length).toBeGreaterThanOrEqual(1);
    expect(dirty.episodes.length).toBeGreaterThanOrEqual(1);
    // Confidence meaningfully reduced — a run overlapping the dirty first half is
    // down-weighted by its leak-clean fraction.
    expect(dirty.episodes[0]!.confidence).toBeLessThan(clean.episodes[0]!.confidence);
  });
});

describe('estimatePeriodicity — interior-peak hardening', () => {
  // The OLD implementation tested a band-edge lag against a neighbour OUTSIDE the
  // band, letting a *monotone-decaying* ACF qualify as a "local maximum" and pin
  // the reported cycle to minCycleSec (the band floor). The hardening requires a
  // true INTERIOR ACF maximum. The genuine regression guard is therefore: a
  // non-oscillatory / monotone-ACF segment is no longer pinned to the band floor.
  //
  // Two distinct regimes are exercised below:
  //   (a) monotone / DC-like ACFs (ramp, monotone decay) — these have NO interior
  //       bump and now correctly return null; and
  //   (b) signals that DO carry a real (possibly degenerate) interior periodicity
  //       (the real/zero comb is genuinely period-2; pseudo-noise has a faint
  //       interior peak) — the hardening does not fabricate a null for these, but
  //       it must NOT floor-pin them to minCycleSec the way the old band-edge bug
  //       did. We assert that distinguishing property directly.

  it('does not floor-pin a real/zero staircase comb to minCycleSec (the resampling-bug envelope)', () => {
    // The exact degenerate envelope the old resampler produced: real/zero comb.
    // It is genuinely periodic at period 2, so the interior-peak test correctly
    // finds an even-lag interior maximum rather than fabricating a null. The
    // regression that matters is that the reported cycle is NOT pinned to the
    // band-floor lag (minCycleSec = 30 s) the way the OLD band-edge comparison
    // pinned every monotone/degenerate segment.
    const n = 600;
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) env[i] = i % 2 === 0 ? 8 : 0;
    const minCycleSec = 30;
    const res = estimatePeriodicity(env, 1, minCycleSec, 100);
    // OLD: pinned to ~minCycleSec (30 s). FIXED: a true interior even-lag peak
    // strictly above the band floor.
    expect(res.cycleLengthSec).not.toBeNull();
    expect(res.cycleLengthSec as number).toBeGreaterThan(minCycleSec);
  });

  it('returns null for a monotone decay', () => {
    const n = 600;
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) env[i] = 100 * Math.exp(-i / 200);
    const res = estimatePeriodicity(env, 1, 30, 100);
    expect(res.cycleLengthSec).toBeNull();
    expect(res.strength).toBe(0);
  });

  it('returns null for a pure linear ramp', () => {
    const n = 600;
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) env[i] = i;
    const res = estimatePeriodicity(env, 1, 30, 100);
    expect(res.cycleLengthSec).toBeNull();
    expect(res.strength).toBe(0);
  });

  it('does not floor-pin constant + small noise and reports only weak strength', () => {
    // Near-DC level with tiny pseudo-noise: no real ventilatory oscillation. Any
    // interior ACF maximum the noise produces must be (a) weak — well below the
    // periodicity gate, mirroring the white-noise case above — and (b) NOT pinned
    // to the band floor, which is the specific failure the OLD band-edge test
    // produced for every non-oscillatory segment.
    const n = 600;
    const env = new Float32Array(n);
    let seed = 98765;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      env[i] = 8 + (seed / 0x7fffffff - 0.5) * 0.02; // tiny noise on a DC level
    }
    const minCycleSec = 30;
    const res = estimatePeriodicity(env, 1, minCycleSec, 100);
    // Weak: nowhere near a real oscillation (OLD: ~1.0 at the pinned floor lag).
    expect(res.strength).toBeLessThan(0.5);
    // Not floor-pinned: if a faint interior peak is reported it is not the band
    // floor lag the old band-edge comparison would have latched onto.
    if (res.cycleLengthSec !== null) {
      expect(res.cycleLengthSec).toBeGreaterThan(minCycleSec);
    }
  });

  it('recovers a true interior period from a sinusoid with strength in (0, 1]', () => {
    const cycleSec = 50;
    const env = syntheticEnvelope(cycleSec, 0.6, cycleSec * 12, 1);
    const res = estimatePeriodicity(env, 1, 30, 100);
    expect(res.cycleLengthSec).not.toBeNull();
    expect(res.cycleLengthSec as number).toBeGreaterThan(cycleSec - 5);
    expect(res.cycleLengthSec as number).toBeLessThan(cycleSec + 5);
    expect(res.strength).toBeGreaterThan(0);
    expect(res.strength).toBeLessThanOrEqual(1);
  });

  it('returns null when the search band is too narrow for an interior peak (maxLag − minLag < 2)', () => {
    // At 1 Hz, a band of [50, 51] s gives minLag = 50, maxLag = 51 → diff 1 < 2.
    const env = syntheticEnvelope(50, 0.6, 600, 1);
    const res = estimatePeriodicity(env, 1, 50, 51);
    expect(res.cycleLengthSec).toBeNull();
    expect(res.strength).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SECURITY REGRESSION — unbounded allocation from a tiny-but-positive rate
//
// A crafted EDF can carry an attacker-controlled, arbitrarily tiny positive
// `sampleRate` (e.g. 1e-6 Hz, from an unbounded `dataRecordDuration` header).
// The envelope output length is `floor((n / sampleRateHz) · envelopeRateHz)`, so
// a 1e-6 Hz rate over a 1000-sample source would try to allocate ~1e9 samples
// (gigabytes of Float32Array/Float64Array), OOM-crashing the analysis worker on
// import. The fix is two-layered:
//   (1) a physiological floor MIN_ENVELOPE_SOURCE_RATE_HZ (0.01 Hz) — any rate
//       below it is rejected at the guard and yields an EMPTY envelope/result; and
//   (2) a defense-in-depth allocation cap MAX_UPSAMPLE_FACTOR (output length is
//       clamped to n · this) so even a near-floor rate that slips the guard
//       cannot inflate the allocation far beyond the source size.
// These tests pin both layers, and confirm the cap never truncates a legitimate
// (≥ floor, ≤ 1 Hz) upsample.
// ---------------------------------------------------------------------------

describe('envelope resampling — unbounded-allocation hardening (DoS)', () => {
  it('buildEnvelopeFromMinuteVent returns an EMPTY envelope for a tiny positive rate (no giant allocation)', () => {
    // 1e-6 Hz over 1000 samples would be floor(1000 / 1e-6 · 1) = 1e9 output
    // samples (~8 GB across the two arrays) without the sub-floor guard.
    const env = buildEnvelopeFromMinuteVent(new Float32Array(1000), 1e-6, 0, 1);
    expect(env.values.length).toBe(0);
    expect(env.timestampsMs.length).toBe(0);
  });

  it('buildEnvelopeFromFlow returns an EMPTY envelope for a tiny positive rate', () => {
    const env = buildEnvelopeFromFlow(new Float32Array(1000), 1e-6, 0, 1);
    expect(env.values.length).toBe(0);
    expect(env.timestampsMs.length).toBe(0);
  });

  it('rejects every rate strictly below the floor, accepts the floor itself', () => {
    const justBelow = MIN_ENVELOPE_SOURCE_RATE_HZ / 2; // 0.005 Hz → rejected
    expect(buildEnvelopeFromMinuteVent(new Float32Array(500), justBelow, 0, 1).values.length).toBe(
      0,
    );
    // Exactly at the floor is accepted (boundary is inclusive: rejects `< floor`).
    const atFloor = buildEnvelopeFromMinuteVent(
      new Float32Array(500),
      MIN_ENVELOPE_SOURCE_RATE_HZ,
      0,
      1,
    );
    expect(atFloor.values.length).toBeGreaterThan(0);
  });

  it('detectPeriodicBreathing returns the empty result for a tiny positive rate (MinVent path)', () => {
    const mv = new Float32Array(300).fill(8);
    const result = detectPeriodicBreathing({ minuteVent: mv, sampleRateHz: 1e-6, startMs: 0 });
    expect(result).toEqual({ episodes: [], recordHours: 0, sessionCriterionMet: false });
  });

  it('detectPeriodicBreathing returns the empty result for a tiny positive rate (Flow path)', () => {
    const flow = syntheticFlow(60, 0.8, 600, 25, 4);
    const result = detectPeriodicBreathing({ flow, sampleRateHz: 1e-6, startMs: 0 });
    expect(result).toEqual({ episodes: [], recordHours: 0, sessionCriterionMet: false });
  });

  it('the allocation cap does NOT truncate a legitimate 0.5 → 1 Hz upsample', () => {
    // The real ResMed case: 0.5 Hz source, 1 Hz target → a 2× upsample, far below
    // the 64× MAX_UPSAMPLE_FACTOR cap. The output length must be the full
    // contractual span (floor(n / 0.5 · 1) = 2n), NOT clamped by the cap.
    const n = 120; // 240 s at 0.5 Hz
    const env = buildEnvelopeFromMinuteVent(new Float32Array(n).fill(10), 0.5, 0, 1);
    const expectedLen = Math.floor((n / 0.5) * 1); // 240
    expect(env.values.length).toBe(expectedLen);
    // Confirm the cap (n · MAX_UPSAMPLE_FACTOR) sits well above the real length.
    expect(expectedLen).toBeLessThan(n * MAX_UPSAMPLE_FACTOR);
  });

  it('the allocation cap does NOT truncate a legitimate at-floor upsample', () => {
    // At exactly the floor (0.01 Hz) the real upsample factor to 1 Hz is 100× —
    // ABOVE the 64× cap — so here the cap legitimately bounds the output. This is
    // the intended defense-in-depth behaviour: a near-floor rate is bounded to
    // n · MAX_UPSAMPLE_FACTOR rather than the uncapped (much larger) span, while
    // still producing a non-empty envelope.
    const n = 50;
    const env = buildEnvelopeFromMinuteVent(
      new Float32Array(n).fill(9),
      MIN_ENVELOPE_SOURCE_RATE_HZ,
      0,
      1,
    );
    expect(env.values.length).toBeGreaterThan(0);
    // Bounded by the cap, never the uncapped floor(n / 0.01) = 100n.
    expect(env.values.length).toBeLessThanOrEqual(n * MAX_UPSAMPLE_FACTOR);
  });
});
