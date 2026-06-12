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
