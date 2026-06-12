/**
 * Periodic-breathing / Cheyne–Stokes-respiration **candidate** detector.
 *
 * Implements the hybrid morphology + spectral method specified in ADR 0017:
 * AASM-style morphology and device central-apnea nadirs *find and bound*
 * oscillation episodes over the ventilation envelope, while an autocorrelation
 * periodicity test, a Guyot-style modulation index, a crescendo–decrescendo
 * morphology fit, and a narrow-band spectral confirmation *score* them into a
 * continuous confidence.
 *
 * Output is always framed as **candidate detection, never diagnosis**.
 * Sub-threshold periodic breathing (hypopnea nadirs) and short CSR runs that
 * fall below the device's reporting threshold are surfaced explicitly with
 * `belowDeviceThreshold = true`, never silently dropped and never promoted to a
 * formal flag.
 *
 * **Literature.**
 * - Weinreich et al. 2009 — airflow alone suffices for CSR detection.
 * - Javed et al. 2018 (ResCSRF) — automated CSR detection from flow.
 * - Midelet et al. 2023 — airflow-based PB/CSR detection.
 * - Guyot et al. 2019 — flow-modulation index as continuous confidence.
 * - AASM / Berry et al. 2012 — morphology criteria: ≥3 consecutive central
 *   events, crescendo–decrescendo, cycle length ≥40 s (typically 45–90 s), and
 *   the session-level ≥5 events/h over ≥2 h CSR criterion.
 *
 * **Confounders explicitly guarded (see inline comments).**
 * - *Arousal / movement spikes* — a single large breath inflates a raw min/max
 *   amplitude ratio. The modulation index uses 10th/90th percentiles, and the
 *   sustained-periodicity (≥`minCycles`) and autocorrelation requirements reject
 *   isolated transients that do not recur at a fixed period.
 * - *Leak artifact* — high mask leak corrupts the flow envelope and the
 *   device's central-apnea anchoring. When a leak channel is supplied, episode
 *   confidence is multiplied by the leak-clean fraction of its span.
 * - *Wake / irregular breathing* — irregular amplitude with no fixed period
 *   fails the autocorrelation `periodicityStrengthMin` gate and the spectral
 *   band-energy confirmation.
 *
 * Pure, worker-safe, deterministic. No I/O, no DOM.
 *
 * @module analysis/breathing/detectPeriodicBreathing
 */

import {
  buildEnvelopeFromFlow,
  buildEnvelopeFromMinuteVent,
  crescendoDecrescendoFit,
  estimatePeriodicity,
  leakCleanFraction,
  modulationIndex,
} from './envelope';
import {
  DEFAULT_PERIODIC_BREATHING_PARAMS,
  type BreathingEpisode,
  type DeviceEventFlag,
  type PeriodicBreathingInput,
  type PeriodicBreathingParams,
  type PeriodicBreathingResult,
  type VentilationEnvelope,
} from './types';

// ---------------------------------------------------------------------------
// Spectral confirmation (narrow-band DFT — dependency-free)
// ---------------------------------------------------------------------------

/**
 * Confirm that the envelope carries oscillation energy concentrated in the
 * periodic-breathing band by direct (Goertzel-style) evaluation of the DFT at a
 * sweep of frequencies inside `[1/maxCycle, 1/minCycle]`, normalized against the
 * total spectral energy. Returns the in-band energy fraction in [0, 1].
 *
 * A self-contained narrow-band DFT is used rather than the `fft.js`
 * devDependency so this production detector pulls in no extra runtime
 * dependency; the band is narrow, so the cost is trivial.
 *
 * @param values        Envelope samples.
 * @param sampleRateHz  Envelope sample rate (Hz).
 * @param minCycleSec   Shortest cycle in the band (seconds).
 * @param maxCycleSec   Longest cycle in the band (seconds).
 * @returns             In-band spectral energy fraction in [0, 1].
 */
export function spectralBandEnergyFraction(
  values: ArrayLike<number>,
  sampleRateHz: number,
  minCycleSec: number,
  maxCycleSec: number,
): number {
  const n = values.length;
  if (n < 4 || sampleRateHz <= 0) return 0;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i] as number;
  mean /= n;

  const centered = new Float64Array(n);
  let totalEnergy = 0;
  for (let i = 0; i < n; i++) {
    const c = (values[i] as number) - mean;
    centered[i] = c;
    totalEnergy += c * c;
  }
  if (totalEnergy <= 0) return 0;

  // Find the peak periodogram power inside the band. The single-sided
  // periodogram of the centered signal sums (over all positive-frequency bins)
  // to the total energy, so the peak in-band power divided by total energy is a
  // bounded [0, 1] measure of how concentrated oscillation energy is in the
  // periodic-breathing band.
  const fLo = 1 / maxCycleSec;
  const fHi = 1 / minCycleSec;
  const steps = 24;
  let peakBandPower = 0;
  for (let s = 0; s <= steps; s++) {
    const f = fLo + ((fHi - fLo) * s) / steps;
    const omega = (2 * Math.PI * f) / sampleRateHz;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const c = centered[i] as number;
      re += c * Math.cos(omega * i);
      im -= c * Math.sin(omega * i);
    }
    // Single-sided power at this frequency (factor 2 for the negative-frequency
    // mirror), normalized so the per-bin power is comparable to total energy.
    const power = (2 * (re * re + im * im)) / n;
    if (power > peakBandPower) peakBandPower = power;
  }
  return Math.min(1, Math.max(0, peakBandPower / totalEnergy));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the full parameter set from partial overrides. */
function resolveParams(p?: Partial<PeriodicBreathingParams>): PeriodicBreathingParams {
  return { ...DEFAULT_PERIODIC_BREATHING_PARAMS, ...(p ?? {}) };
}

/**
 * Minimum episode confidence below which a candidate is **not surfaced**. An
 * episode whose confidence collapses to (near) zero — e.g. its entire span is
 * leak-corrupted, so the leak-clean fraction drives the confidence product to 0
 * — carries no actionable signal and would only add noise. Such episodes are
 * dropped rather than emitted with a meaningless zero confidence. The
 * morphology / periodicity / modulation gates already bound the *minimum*
 * informative confidence well above this floor, so this only removes degenerate
 * (leak-zeroed) episodes.
 */
const MIN_EMIT_CONFIDENCE = 1e-6;

/**
 * Count central events fully contained within `[startMs, endMs]`, and report
 * the longest run of consecutive central events (no intervening hypopnea) plus
 * which nadir type predominates within the span.
 */
function summarizeNadirs(
  startMs: number,
  endMs: number,
  flags: readonly DeviceEventFlag[] | undefined,
): { centralCount: number; hypopneaCount: number; maxConsecutiveCentral: number } {
  if (!flags || flags.length === 0) {
    return { centralCount: 0, hypopneaCount: 0, maxConsecutiveCentral: 0 };
  }
  const within = flags
    .filter((f) => f.timestampMs >= startMs && f.timestampMs <= endMs)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  let centralCount = 0;
  let hypopneaCount = 0;
  let run = 0;
  let maxRun = 0;
  for (const f of within) {
    if (f.kind === 'central') {
      centralCount += 1;
      run += 1;
      if (run > maxRun) maxRun = run;
    } else {
      hypopneaCount += 1;
      run = 0;
    }
  }
  return { centralCount, hypopneaCount, maxConsecutiveCentral: maxRun };
}

/** Build a deterministic episode id from its time span and type. */
function episodeId(type: string, startMs: number, endMs: number): string {
  return `${type}:${Math.round(startMs)}-${Math.round(endMs)}`;
}

/** A raw oscillation run before classification, in envelope-sample indices. */
interface RawRun {
  startK: number;
  endK: number; // inclusive
  cycleLenSec: number;
  strength: number;
  modDepth: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect candidate periodic-breathing and Cheyne–Stokes episodes over a
 * session's ventilation envelope.
 *
 * Pipeline:
 * 1. Build a ≈1 Hz ventilation envelope from minute ventilation (preferred) or
 *    by segmenting breaths from raw flow.
 * 2. Slide a `windowSec` window (`stepSec` step) and, for each window, estimate
 *    cycle length / periodicity strength (autocorrelation) and modulation depth
 *    (Guyot index). Windows passing both `periodicityStrengthMin` and
 *    `modulationDepthMin` are flagged as oscillatory.
 * 3. Merge contiguous oscillatory windows into runs; keep runs spanning at
 *    least `minCycles` cycles.
 * 4. For each run, compute a morphology fit, a spectral band-energy
 *    confirmation, and (when event flags are supplied) the nadir character and
 *    longest consecutive-central run.
 * 5. Classify: `CheyneStokes` when nadirs are central apneas with
 *    ≥`minConsecutiveEvents` consecutive central events and cycle ≥
 *    `cycleLenMinSec`; otherwise `PeriodicBreathing`. Set `belowDeviceThreshold`
 *    for hypopnea-nadir PB and for CSR runs failing the session-level
 *    ≥`minEventsPerHour` over ≥`minRecordHours` criterion.
 * 6. Confidence = mean(modulation, morphology fit, periodicity strength,
 *    spectral fraction) × leak-clean fraction over the run's span.
 *
 * @param input PB/CSR detector input (signal + optional flags + params).
 * @returns     Detected candidate episodes and session-level summary.
 *
 * @remarks
 * **Missing-data strategy.** Non-finite flow / ventilation samples are treated
 * as 0 in the envelope; leak gaps are excluded from the clean-fraction
 * denominator (pairwise). Empty input → empty result.
 */
export function detectPeriodicBreathing(input: PeriodicBreathingInput): PeriodicBreathingResult {
  const params = resolveParams(input.params);
  const startMs = input.startMs ?? 0;

  // -- 1. Envelope ---------------------------------------------------------
  let envelope: VentilationEnvelope;
  if (input.minuteVent && input.minuteVent.length > 0) {
    envelope = buildEnvelopeFromMinuteVent(
      input.minuteVent,
      input.sampleRateHz,
      startMs,
      params.envelopeRateHz,
    );
  } else if (input.flow && input.flow.length > 0) {
    envelope = buildEnvelopeFromFlow(
      input.flow,
      input.sampleRateHz,
      startMs,
      params.envelopeRateHz,
    );
  } else {
    return { episodes: [], recordHours: 0, sessionCriterionMet: false };
  }

  const env = envelope.values;
  const envRate = envelope.sampleRateHz;
  const nEnv = env.length;
  const recordHours = nEnv / envRate / 3600;

  // Session-level central event rate (AASM ≥5/h over ≥2 h).
  const centralFlags = (input.eventFlags ?? []).filter((f) => f.kind === 'central');
  const centralPerHour = recordHours > 0 ? centralFlags.length / recordHours : 0;
  const sessionCriterionMet =
    recordHours >= params.minRecordHours && centralPerHour >= params.minEventsPerHour;

  if (nEnv < params.minCycles * params.cycleLenMinSec * envRate) {
    return { episodes: [], recordHours, sessionCriterionMet };
  }

  // -- 2. Sliding-window oscillation flags --------------------------------
  const winSamples = Math.max(2, Math.round(params.windowSec * envRate));
  const stepSamples = Math.max(1, Math.round(params.stepSec * envRate));

  interface WinFlag {
    startK: number;
    endK: number;
    cycleLenSec: number;
    strength: number;
    modDepth: number;
  }
  const oscillatory: WinFlag[] = [];

  for (let k = 0; k + winSamples <= nEnv; k += stepSamples) {
    const seg = env.subarray(k, k + winSamples);
    const periodicity = estimatePeriodicity(
      seg,
      envRate,
      params.cycleLenMinSec,
      params.cycleLenMaxSec,
    );
    if (periodicity.cycleLengthSec === null) continue;
    if (periodicity.strength < params.periodicityStrengthMin) continue;
    const modDepth = modulationIndex(seg);
    if (modDepth < params.modulationDepthMin) continue;
    oscillatory.push({
      startK: k,
      endK: k + winSamples - 1,
      cycleLenSec: periodicity.cycleLengthSec,
      strength: periodicity.strength,
      modDepth,
    });
  }

  if (oscillatory.length === 0) {
    return { episodes: [], recordHours, sessionCriterionMet };
  }

  // -- 3. Merge contiguous/overlapping oscillatory windows into runs ------
  const runs: RawRun[] = [];
  let cur: RawRun | null = null;
  for (const w of oscillatory) {
    if (cur && w.startK <= cur.endK + stepSamples) {
      // Extend the current run; track the dominant (strongest) cycle estimate.
      cur.endK = Math.max(cur.endK, w.endK);
      if (w.strength > cur.strength) {
        cur.strength = w.strength;
        cur.cycleLenSec = w.cycleLenSec;
      }
      cur.modDepth = Math.max(cur.modDepth, w.modDepth);
    } else {
      if (cur) runs.push(cur);
      cur = {
        startK: w.startK,
        endK: w.endK,
        cycleLenSec: w.cycleLenSec,
        strength: w.strength,
        modDepth: w.modDepth,
      };
    }
  }
  if (cur) runs.push(cur);

  // -- 4 & 5. Score and classify each run ---------------------------------
  const episodes: BreathingEpisode[] = [];
  for (const run of runs) {
    const spanSamples = run.endK - run.startK + 1;
    const durationSec = spanSamples / envRate;
    const cycleCount = Math.floor(durationSec / run.cycleLenSec);
    if (cycleCount < params.minCycles) continue;

    const startEpMs = envelope.timestampsMs[run.startK] as number;
    const endEpMs = envelope.timestampsMs[run.endK] as number;

    const seg = env.subarray(run.startK, run.endK + 1);
    const cycleLenSamples = run.cycleLenSec * envRate;
    const morphFit = crescendoDecrescendoFit(seg, cycleLenSamples);
    const spectralFrac = spectralBandEnergyFraction(
      seg,
      envRate,
      params.cycleLenMinSec,
      params.cycleLenMaxSec,
    );

    const nadirs = summarizeNadirs(startEpMs, endEpMs, input.eventFlags);
    const hasFlags = (input.eventFlags?.length ?? 0) > 0;

    // Classification: CSR requires central-apnea nadirs meeting AASM morphology.
    const isCsr =
      hasFlags &&
      nadirs.maxConsecutiveCentral >= params.minConsecutiveEvents &&
      run.cycleLenSec >= params.cycleLenMinSec;

    const type = isCsr ? 'CheyneStokes' : 'PeriodicBreathing';
    let meanNadirType: 'apnea' | 'hypopnea' | undefined;
    if (hasFlags) {
      meanNadirType = nadirs.centralCount >= nadirs.hypopneaCount ? 'apnea' : 'hypopnea';
    }

    // belowDeviceThreshold: PB candidates always sub-threshold; CSR only when
    // the session-level events/h-over-hours criterion is NOT met.
    const belowDeviceThreshold = isCsr ? !sessionCriterionMet : true;

    // -- 6. Confidence ----------------------------------------------------
    // Down-weight by the leak-clean fraction over the run's signal span when a
    // leak channel is supplied (leak artifact guard).
    let leakClean = 1;
    if (input.leak && input.leak.length > 0) {
      const srcLo = Math.floor((run.startK / envRate) * input.sampleRateHz);
      const srcHi = Math.min(
        input.leak.length,
        Math.ceil(((run.endK + 1) / envRate) * input.sampleRateHz),
      );
      leakClean = leakCleanFraction(input.leak.subarray(srcLo, srcHi), params.leakThresholdLpm);
    }

    const baseConfidence = (run.modDepth + morphFit + run.strength + spectralFrac) / 4;
    const confidence = Math.min(1, Math.max(0, baseConfidence * leakClean));

    // Do not surface zero-confidence candidates (e.g. a fully leak-corrupted
    // span whose leak-clean fraction zeroes the confidence) — they carry no
    // actionable signal.
    if (confidence < MIN_EMIT_CONFIDENCE) continue;

    episodes.push({
      id: episodeId(type, startEpMs, endEpMs),
      type,
      startMs: startEpMs,
      endMs: endEpMs,
      durationSec,
      confidence,
      cycleLengthSec: run.cycleLenSec,
      modulationDepth: run.modDepth,
      cycleCount,
      ...(meanNadirType ? { meanNadirType } : {}),
      belowDeviceThreshold,
    });
  }

  episodes.sort((a, b) => a.startMs - b.startMs);
  return { episodes, recordHours, sessionCriterionMet };
}
