/**
 * Signal primitives for breathing-pattern detection: per-breath ventilation
 * envelope extraction, autocorrelation-based cycle-length / periodicity
 * estimation, and a Guyot-style flow-modulation index.
 *
 * These are pure functions with no I/O and no DOM access, safe to run inside
 * the analysis Web Worker (ADR 0008).
 *
 * **Method grounding.** Periodic breathing and Cheyne–Stokes respiration appear
 * in the *ventilation envelope* (the slow ~0.01–0.02 Hz modulation of breath
 * amplitude), not in the raw 25 Hz carrier. The single-channel airflow
 * literature (Weinreich 2009, Javed 2018, Midelet 2023) reduces flow to a
 * per-breath amplitude series; Guyot et al. 2019 score the resulting
 * oscillation with a continuous *modulation index*. We follow that pipeline:
 *
 * 1. Segment breaths from the flow signal (zero-crossing of a smoothed signal).
 * 2. Take a per-breath ventilation proxy (peak inspiratory flow, a tidal-volume
 *    surrogate) and resample to a uniform ≈1 Hz envelope.
 * 3. Score periodicity with autocorrelation and modulation depth with the
 *    Guyot index.
 *
 * When a clean minute-ventilation channel exists, steps 1–2 are unnecessary —
 * the channel *is* the envelope (after resampling), which is why the detector
 * accepts it as a preferred alternative input.
 *
 * @module analysis/breathing/envelope
 */

import type { PeriodicityResult, VentilationEnvelope } from './types';

// ---------------------------------------------------------------------------
// Resampling safety bounds (DoS hardening — see threat note below)
// ---------------------------------------------------------------------------

/**
 * Lowest source sample rate (Hz) the envelope builders will accept. Any rate
 * below this is treated as invalid and yields an empty envelope.
 *
 * **Rationale (physiological + safety).** No legitimate CPAP channel is sampled
 * below ~0.5 Hz (ResMed MinuteVent is 0.5 Hz; flow is 25 Hz). 0.01 Hz is a safe
 * floor an order of magnitude below the slowest real channel, so it never
 * rejects valid data.
 *
 * **Threat.** Output length is `floor((n / sampleRateHz) · envelopeRateHz)`. A
 * crafted EDF can carry an attacker-controlled, arbitrarily tiny positive
 * `sampleRate` (e.g. 1e-6 Hz, from an unbounded `dataRecordDuration` header),
 * which makes the output length explode to 1e9–1e12 samples and allocate
 * gigabytes-to-terabytes of `Float32Array`/`Float64Array`, OOM-crashing the
 * analysis worker on import. Rejecting sub-floor rates here neutralizes that
 * unbounded allocation for every direct caller. (The upstream EDF parser not
 * bounding `sampleRate` is a separate, out-of-scope fix.)
 */
export const MIN_ENVELOPE_SOURCE_RATE_HZ = 0.01;

/**
 * Defense-in-depth cap on how many output samples the resampler may emit per
 * source sample. Upsampling from the slowest real source (0.5 Hz) to the 1 Hz
 * envelope is only a 2× factor, so 64× is generous headroom for any legitimate
 * rate while bounding the worst-case allocation even if a near-floor rate slips
 * through the rate guard. Output length is clamped to `n · this` so a tiny rate
 * can never inflate the allocation far beyond the source size.
 */
export const MAX_UPSAMPLE_FACTOR = 64;

// ---------------------------------------------------------------------------
// Small numeric helpers (local to keep this module dependency-free)
// ---------------------------------------------------------------------------

/** Mean of a numeric view, ignoring NaN. Returns 0 for empty input. */
function meanFinite(values: ArrayLike<number>): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * Centered moving-average smoother with a window of `radius` samples on each
 * side. Used to remove the high-frequency carrier before zero-crossing breath
 * segmentation. Pure; returns a new array.
 */
function movingAverage(values: Float32Array, radius: number): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  if (radius <= 0 || n === 0) {
    out.set(values);
    return out;
  }
  // Prefix sums for O(n) windowed mean.
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    prefix[i + 1] = (prefix[i] as number) + (values[i] as number);
  }
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n - 1, i + radius);
    const sum = (prefix[hi + 1] as number) - (prefix[lo] as number);
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-breath ventilation envelope
// ---------------------------------------------------------------------------

/** A single segmented breath. */
interface Breath {
  /** Sample index of the breath onset (an upward zero-crossing). */
  readonly startIdx: number;
  /** Sample index of the next breath onset (exclusive end). */
  readonly endIdx: number;
  /** Ventilation proxy for the breath (peak inspiratory flow). */
  readonly amplitude: number;
  /** Tidal-volume surrogate: integral of positive (inspiratory) flow. */
  readonly tidalProxy: number;
}

/**
 * Segment breaths from a flow-rate signal using zero-crossings of a smoothed
 * copy of the signal, then take a per-breath ventilation proxy.
 *
 * A breath boundary is an **upward** zero-crossing of the (mean-removed,
 * smoothed) flow — the onset of inspiration. Between consecutive onsets we take
 * the peak inspiratory flow (`amplitude`) and the integral of positive flow
 * (`tidalProxy`, a tidal-volume surrogate in L·sample/min units).
 *
 * @param flow         Raw flow-rate samples (L/min), inspiration positive.
 * @param sampleRateHz Sample rate of `flow` in Hz.
 * @returns            Ordered breaths; empty when no breaths are found.
 *
 * @remarks
 * **Assumptions / guards.** Inspiration is positive flow. The smoothing radius
 * is sized to ~0.4 s to suppress cardiac/turbulence ripple without erasing the
 * ~3–6 s respiratory period. A minimum inter-breath spacing (≈1 s) rejects
 * spurious double-crossings from noise. Movement/arousal spikes inflate a
 * single breath's amplitude but, being isolated, do not create the *sustained*
 * oscillation the downstream periodicity test requires.
 */
export function segmentBreaths(flow: Float32Array, sampleRateHz: number): Breath[] {
  const n = flow.length;
  if (n === 0 || sampleRateHz <= 0) return [];

  // Smooth to suppress the sub-respiratory ripple (~0.4 s radius).
  const smoothRadius = Math.max(1, Math.round(0.4 * sampleRateHz));
  const smoothed = movingAverage(flow, smoothRadius);
  const baseline = meanFinite(smoothed);

  // Minimum spacing between accepted onsets (~1 s) to reject noise crossings.
  const minSpacing = Math.max(1, Math.round(1.0 * sampleRateHz));

  // Find upward zero-crossings of (smoothed - baseline).
  const onsets: number[] = [];
  let prevSign = (smoothed[0] as number) - baseline >= 0 ? 1 : -1;
  for (let i = 1; i < n; i++) {
    const sign = (smoothed[i] as number) - baseline >= 0 ? 1 : -1;
    if (prevSign < 0 && sign > 0) {
      if (onsets.length === 0 || i - (onsets[onsets.length - 1] as number) >= minSpacing) {
        onsets.push(i);
      }
    }
    prevSign = sign;
  }

  if (onsets.length < 2) return [];

  const breaths: Breath[] = [];
  const dtMin = 1 / sampleRateHz / 60; // sample period in minutes, for the L/min integral
  for (let b = 0; b < onsets.length - 1; b++) {
    const startIdx = onsets[b] as number;
    const endIdx = onsets[b + 1] as number;
    let peak = 0;
    let tidal = 0;
    for (let i = startIdx; i < endIdx; i++) {
      const v = (flow[i] as number) - baseline;
      if (v > peak) peak = v;
      if (v > 0) tidal += v * dtMin; // integrate positive (inspiratory) flow
    }
    breaths.push({ startIdx, endIdx, amplitude: peak, tidalProxy: tidal });
  }
  return breaths;
}

/**
 * Build a uniform ventilation envelope (≈1 Hz) from a raw flow signal by
 * segmenting breaths and resampling the per-breath ventilation proxy with
 * zero-order hold (each breath's amplitude held until the next breath).
 *
 * @param flow         Raw flow-rate samples (L/min).
 * @param sampleRateHz Sample rate of `flow` in Hz.
 * @param startMs      Epoch ms of the first sample (default 0).
 * @param envelopeRateHz Target envelope rate in Hz (default 1).
 * @param useTidalProxy When `true`, use the per-breath tidal-volume surrogate;
 *                       otherwise peak inspiratory flow (default `false`).
 * @returns            A {@link VentilationEnvelope}; empty arrays when no breaths.
 */
export function buildEnvelopeFromFlow(
  flow: Float32Array,
  sampleRateHz: number,
  startMs = 0,
  envelopeRateHz = 1,
  useTidalProxy = false,
): VentilationEnvelope {
  // Reject sub-floor / non-finite source rates before any allocation: a tiny
  // positive rate would make `outLen` explode (see MIN_ENVELOPE_SOURCE_RATE_HZ).
  if (
    flow.length === 0 ||
    !Number.isFinite(sampleRateHz) ||
    sampleRateHz < MIN_ENVELOPE_SOURCE_RATE_HZ ||
    envelopeRateHz <= 0
  ) {
    return {
      timestampsMs: new Float64Array(0),
      values: new Float32Array(0),
      sampleRateHz: envelopeRateHz,
    };
  }

  const breaths = segmentBreaths(flow, sampleRateHz);
  if (breaths.length === 0) {
    return {
      timestampsMs: new Float64Array(0),
      values: new Float32Array(0),
      sampleRateHz: envelopeRateHz,
    };
  }

  const totalSeconds = flow.length / sampleRateHz;
  // Cap the output length to a bounded multiple of the source (defense in depth
  // against a near-floor rate inflating the allocation).
  const outLen = Math.min(
    Math.max(1, Math.floor(totalSeconds * envelopeRateHz)),
    flow.length * MAX_UPSAMPLE_FACTOR,
  );
  const values = new Float32Array(outLen);
  const timestampsMs = new Float64Array(outLen);
  const stepMs = 1000 / envelopeRateHz;

  // Zero-order hold: for each output time, take the amplitude of the breath
  // whose [startIdx, endIdx) interval contains that time.
  let b = 0;
  for (let k = 0; k < outLen; k++) {
    const tSec = k / envelopeRateHz;
    const sampleIdx = tSec * sampleRateHz;
    while (b < breaths.length - 1 && (breaths[b] as Breath).endIdx <= sampleIdx) {
      b += 1;
    }
    const breath = breaths[b] as Breath;
    values[k] = useTidalProxy ? breath.tidalProxy : breath.amplitude;
    timestampsMs[k] = startMs + k * stepMs;
  }

  return { timestampsMs, values, sampleRateHz: envelopeRateHz };
}

/**
 * Build a uniform ventilation envelope from a pre-computed minute-ventilation
 * channel, resampled to a uniform `envelopeRateHz`. This is the preferred,
 * cleaner path when the device exposes minute ventilation.
 *
 * **Resampling contract.** The envelope is always emitted at a *fixed* uniform
 * target rate (default 1 Hz), independent of the source rate, so the detector
 * behaves identically across sessions and devices. 1 Hz cleanly resolves the
 * 40–100 s periodic-breathing band (Nyquist 0.5 Hz ≫ the ~0.01–0.025 Hz
 * oscillation; ≥40 samples per cycle for lag-resolution by autocorrelation).
 * Three regimes are handled explicitly:
 *
 * - **source > target** (e.g. flow-derived proxies, or high-rate MinVent):
 *   anti-aliased decimation by bin-averaging the source samples falling in each
 *   output bin.
 * - **source < target** (the real ResMed case — MinVent is stored at 0.5 Hz,
 *   so we upsample 0.5 → 1 Hz): **linear interpolation** between the two
 *   bracketing source samples. This is the critical fix: the previous
 *   bin-average path silently emitted 0 for output bins that contained no source
 *   sample (`samplesPerBin = 0.5/1 = 0.5`), turning the envelope into a
 *   real/zero comb and degenerating every downstream metric.
 * - **source == target**: passthrough (a copy).
 *
 * Non-finite source samples are **bridged**, not zeroed: they are skipped when
 * locating interpolation/averaging neighbours so a brief dropout is interpolated
 * across the nearest finite samples (carrying the edge value past a leading or
 * trailing run of non-finite samples). An output time with *no* finite source
 * sample anywhere is the only case that yields 0; with at least one finite
 * source sample the envelope is never silently zero-filled.
 *
 * @param minuteVent   Minute-ventilation samples (L/min).
 * @param sampleRateHz Sample rate of `minuteVent` in Hz.
 * @param startMs      Epoch ms of the first sample (default 0).
 * @param envelopeRateHz Target envelope rate in Hz (default 1).
 * @returns            A {@link VentilationEnvelope} at exactly `envelopeRateHz`.
 *
 * @remarks
 * **Assumptions / guards.** A non-finite or non-positive `sampleRateHz`, or
 * empty input, returns an empty envelope (no garbage from a bad rate). The
 * output length spans the same wall-clock duration as the source
 * (`floor(n / sampleRateHz · envelopeRateHz)`, at least 1 sample).
 */
export function buildEnvelopeFromMinuteVent(
  minuteVent: Float32Array,
  sampleRateHz: number,
  startMs = 0,
  envelopeRateHz = 1,
): VentilationEnvelope {
  const n = minuteVent.length;
  // A sub-floor `sampleRateHz` (e.g. a crafted 1e-6 Hz) is rejected here, not
  // just <= 0: a tiny positive rate would make `outLen` explode and allocate
  // gigabytes (see MIN_ENVELOPE_SOURCE_RATE_HZ).
  if (
    n === 0 ||
    !Number.isFinite(sampleRateHz) ||
    sampleRateHz < MIN_ENVELOPE_SOURCE_RATE_HZ ||
    envelopeRateHz <= 0
  ) {
    return {
      timestampsMs: new Float64Array(0),
      values: new Float32Array(0),
      sampleRateHz: envelopeRateHz,
    };
  }

  const stepMs = 1000 / envelopeRateHz;

  if (sampleRateHz === envelopeRateHz) {
    // Passthrough, but still bridge any non-finite samples so the contract
    // ("never silently zero-fill") holds on this path too.
    const ts = new Float64Array(n);
    for (let i = 0; i < n; i++) ts[i] = startMs + i * stepMs;
    return {
      timestampsMs: ts,
      values: bridgeNonFinite(minuteVent),
      sampleRateHz: envelopeRateHz,
    };
  }

  const totalSeconds = n / sampleRateHz;
  // Cap the output length to a bounded multiple of the source (defense in depth
  // against a near-floor rate inflating the allocation).
  const outLen = Math.min(
    Math.max(1, Math.floor(totalSeconds * envelopeRateHz)),
    n * MAX_UPSAMPLE_FACTOR,
  );
  const values = new Float32Array(outLen);
  const timestampsMs = new Float64Array(outLen);

  if (sampleRateHz > envelopeRateHz) {
    // -- Anti-aliased decimation: bin-average source samples per output bin. --
    const samplesPerBin = sampleRateHz / envelopeRateHz;
    for (let k = 0; k < outLen; k++) {
      const lo = Math.floor(k * samplesPerBin);
      const hi = Math.min(n, Math.floor((k + 1) * samplesPerBin));
      let sum = 0;
      let count = 0;
      for (let i = lo; i < hi; i++) {
        const v = minuteVent[i] as number;
        if (Number.isFinite(v)) {
          sum += v;
          count += 1;
        }
      }
      // A bin with no finite sample (e.g. an empty bin from rounding, or an
      // all-NaN dropout) falls back to nearest-finite interpolation at the bin
      // centre rather than emitting 0.
      values[k] =
        count > 0 ? sum / count : interpolateFinite(minuteVent, (k + 0.5) * samplesPerBin);
      timestampsMs[k] = startMs + k * stepMs;
    }
    return { timestampsMs, values, sampleRateHz: envelopeRateHz };
  }

  // -- Upsampling: linear interpolation between bracketing source samples. ----
  // Output time k maps to fractional source index `k · sampleRateHz /
  // envelopeRateHz`; we interpolate the two nearest *finite* source samples
  // around it (bridging non-finite samples), so a 0.5 Hz → 1 Hz upsample yields
  // a smooth ventilation oscillation, never a real/zero comb.
  const srcPerOut = sampleRateHz / envelopeRateHz; // < 1
  for (let k = 0; k < outLen; k++) {
    values[k] = interpolateFinite(minuteVent, k * srcPerOut);
    timestampsMs[k] = startMs + k * stepMs;
  }
  return { timestampsMs, values, sampleRateHz: envelopeRateHz };
}

/**
 * Linearly interpolate `samples` at the (possibly fractional) source index
 * `pos`, skipping non-finite samples by reaching outward to the nearest finite
 * neighbour on each side. Returns 0 only when `samples` contains no finite value
 * at all (so the "never silently zero-fill" contract holds whenever any finite
 * source sample exists). Out-of-range positions clamp (carry) to the nearest
 * finite edge sample. Pure.
 */
function interpolateFinite(samples: Float32Array, pos: number): number {
  const n = samples.length;
  if (n === 0) return 0;

  // Nearest finite sample at or below floor(pos).
  let lo = Math.floor(pos);
  if (lo < 0) lo = 0;
  if (lo > n - 1) lo = n - 1;
  let loIdx = lo;
  while (loIdx >= 0 && !Number.isFinite(samples[loIdx] as number)) loIdx -= 1;

  // Nearest finite sample at or above ceil(pos).
  let hi = Math.ceil(pos);
  if (hi < 0) hi = 0;
  if (hi > n - 1) hi = n - 1;
  let hiIdx = hi;
  while (hiIdx < n && !Number.isFinite(samples[hiIdx] as number)) hiIdx += 1;

  const loFinite = loIdx >= 0;
  const hiFinite = hiIdx < n;
  if (!loFinite && !hiFinite) return 0; // no finite sample anywhere
  if (!loFinite) return samples[hiIdx] as number; // carry leading edge
  if (!hiFinite) return samples[loIdx] as number; // carry trailing edge
  if (loIdx === hiIdx) return samples[loIdx] as number; // exact / coincident

  const a = samples[loIdx] as number;
  const b = samples[hiIdx] as number;
  const frac = (pos - loIdx) / (hiIdx - loIdx);
  return a + (b - a) * frac;
}

/**
 * Return a copy of `samples` with non-finite values bridged by linear
 * interpolation across the nearest finite neighbours (leading/trailing runs are
 * carried from the nearest finite edge). Used on the passthrough path so the
 * envelope never contains a NaN/Inf that would poison downstream statistics.
 * Pure; returns a new array. An all-non-finite input yields all-zeros.
 */
function bridgeNonFinite(samples: Float32Array): Float32Array {
  const n = samples.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = samples[i] as number;
    out[i] = Number.isFinite(v) ? v : interpolateFinite(samples, i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Autocorrelation periodicity
// ---------------------------------------------------------------------------

/**
 * Estimate the dominant oscillation cycle length and periodicity strength of an
 * envelope segment via the biased autocorrelation function, searching only the
 * physiologically plausible cycle-length band.
 *
 * The biased ACF (divide by N, not N−lag) is used so the estimator is
 * well-behaved and tapers toward 0 at long lags, avoiding spurious unit peaks
 * near the segment length. The reported `cycleLengthSec` is the lag of the
 * tallest **interior** local ACF maximum strictly within
 * `(minCycleSec, maxCycleSec)`; `strength` is that peak's normalized height in
 * [0, 1].
 *
 * **Why interior-only.** A genuine oscillation produces an ACF *bump* — a lag
 * with neighbours lower on *both* sides. A monotone-decaying ACF (a non-periodic
 * segment: DC/ramp, a staircase comb from a resampling bug, or pure noise) has
 * no such interior bump; its largest in-band value is always at the band edge
 * `minLag`. The previous implementation tested `acfAt(minLag − 1)` — a lag
 * *outside* the search band — which let that monotone band-edge value qualify as
 * a "local maximum", pinning the reported cycle to the band floor. We now
 * require both neighbours to lie inside `(minLag, maxLag)`, so a band-edge lag
 * can never be accepted and a monotone / near-DC / staircase segment correctly
 * returns `{ cycleLengthSec: null, strength: 0 }`.
 *
 * @param values        Envelope samples (uniformly sampled).
 * @param sampleRateHz  Envelope sample rate in Hz.
 * @param minCycleSec   Lower bound of the cycle-length search band (seconds).
 * @param maxCycleSec   Upper bound of the cycle-length search band (seconds).
 * @returns             {@link PeriodicityResult}.
 *
 * @remarks
 * Requires at least one full cycle of data within the band *plus* room for an
 * interior peak; if the band is too narrow to contain a lag with neighbours on
 * both sides (`maxLag − minLag < 2`), returns
 * `{ cycleLengthSec: null, strength: 0 }`.
 */
export function estimatePeriodicity(
  values: ArrayLike<number>,
  sampleRateHz: number,
  minCycleSec: number,
  maxCycleSec: number,
): PeriodicityResult {
  const n = values.length;
  if (n < 2 || sampleRateHz <= 0) return { cycleLengthSec: null, strength: 0 };

  const minLag = Math.max(1, Math.round(minCycleSec * sampleRateHz));
  const maxLag = Math.min(n - 1, Math.round(maxCycleSec * sampleRateHz));
  // An interior peak needs a lag with both neighbours inside the band, i.e. at
  // least three candidate lags (minLag, minLag+1, maxLag). A band too narrow for
  // that cannot carry a resolvable oscillation.
  if (maxLag - minLag < 2) return { cycleLengthSec: null, strength: 0 };

  // Mean-center.
  const mean = meanFinite(values);
  const centered = new Float64Array(n);
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const c = (values[i] as number) - mean;
    centered[i] = Number.isFinite(c) ? c : 0;
    variance += (centered[i] as number) * (centered[i] as number);
  }
  if (variance <= 0) return { cycleLengthSec: null, strength: 0 };

  // Biased ACF normalized so r(0) = 1.
  const acfAt = (lag: number): number => {
    let s = 0;
    for (let i = 0; i + lag < n; i++) {
      s += (centered[i] as number) * (centered[i + lag] as number);
    }
    return s / variance;
  };

  // Find the tallest *interior* local maximum strictly within (minLag, maxLag):
  // a lag whose ACF is ≥ both immediate neighbours, where both neighbours lie
  // inside the search band. Band-edge lags (minLag, maxLag) are never eligible,
  // so a monotone-decaying ACF (non-periodic / staircase / DC) yields no peak.
  let bestLag = -1;
  let bestVal = -Infinity;
  let rPrev = acfAt(minLag);
  let r = acfAt(minLag + 1);
  for (let lag = minLag + 1; lag <= maxLag - 1; lag++) {
    const rNext = acfAt(lag + 1);
    if (r >= rPrev && r >= rNext && r > bestVal) {
      bestVal = r;
      bestLag = lag;
    }
    rPrev = r;
    r = rNext;
  }

  if (bestLag < 0) return { cycleLengthSec: null, strength: 0 };
  const strength = Math.min(1, Math.max(0, bestVal));
  return { cycleLengthSec: bestLag / sampleRateHz, strength };
}

// ---------------------------------------------------------------------------
// Guyot-style modulation index
// ---------------------------------------------------------------------------

/**
 * Compute a Guyot-style flow-modulation index in [0, 1] for an envelope
 * segment: the depth of the slow ventilatory oscillation relative to its mean.
 *
 * Following Guyot et al. 2019, the modulation index quantifies how strongly
 * ventilation cycles between high and low. We compute it robustly as the
 * difference between the high (90th) and low (10th) percentiles of the envelope
 * divided by twice the mean, clamped to [0, 1]. 0 ⇒ steady ventilation;
 * values approaching 1 ⇒ full on/off (apnea-deep) cycling.
 *
 * Using percentiles rather than raw min/max makes the index resistant to a
 * single movement/arousal spike (which would otherwise saturate a min/max
 * amplitude ratio) — one of the documented confounders for these detectors.
 *
 * @param values Envelope samples (non-negative ventilation proxy).
 * @returns      Modulation index in [0, 1]. 0 for empty / non-positive-mean input.
 */
export function modulationIndex(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return 0;

  const finite: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i] as number;
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return 0;

  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  if (mean <= 0) return 0;

  finite.sort((a, b) => a - b);
  const pct = (p: number): number => {
    const idx = (finite.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const frac = idx - lo;
    return (finite[lo] as number) * (1 - frac) + (finite[hi] as number) * frac;
  };

  const high = pct(0.9);
  const low = pct(0.1);
  const index = (high - low) / (2 * mean);
  return Math.min(1, Math.max(0, index));
}

/**
 * Score crescendo–decrescendo morphology fit in [0, 1] for an envelope segment
 * spanning one oscillation cycle (or a short multiple) as a **harmonic-purity
 * ratio**: the fraction of the segment's AC (mean-removed) energy carried by the
 * single fundamental cycle frequency.
 *
 * CSR/PB cycles have a characteristic smooth waxing-then-waning ("spindle")
 * shape — a near-sinusoidal ventilation oscillation that concentrates its
 * energy at the fundamental. Abrupt obstructive on/off patterns are closer to a
 * square / pulse wave: by Fourier analysis their energy spreads into the odd
 * harmonics (a 50 % square wave carries only 8/π² ≈ 0.81 of its energy at the
 * fundamental, and sharper apnea-like duty cycles far less), so they score
 * meaningfully lower than a smooth sinusoid.
 *
 * We evaluate the fundamental's complex amplitude with a Goertzel-style DFT at
 * the cycle frequency, convert it to single-sided energy (`2·|X|²/n`, by
 * Parseval), and divide by the total AC energy. This makes the score
 *
 * - **phase-invariant** — it uses the DFT *magnitude*, so a shifted sinusoid
 *   scores identically;
 * - **1.0 for a pure fundamental sinusoid** (all AC energy at the cycle
 *   frequency);
 * - **lower as energy leaks into harmonics** — ≈0.81 for a 50 % square wave,
 *   lower still for sharper on/off morphologies, and ≈0 for broadband noise.
 *
 * Unlike a single-template correlation (which a square wave can still satisfy at
 * ~0.9 because its fundamental component alone correlates strongly), the energy
 * ratio is sensitive to the harmonic content that distinguishes spindle-shaped
 * periodic breathing from abrupt obstructive cycling. Morphology is one term in
 * the episode confidence score, not a gate.
 *
 * @param values     Envelope samples for the segment.
 * @param cycleLenSamples Estimated cycle length in samples (fundamental period).
 * @returns          Harmonic-purity morphology fit in [0, 1].
 */
export function crescendoDecrescendoFit(
  values: ArrayLike<number>,
  cycleLenSamples: number,
): number {
  const n = values.length;
  if (n < 3 || cycleLenSamples < 2) return 0;

  let meanV = 0;
  for (let i = 0; i < n; i++) meanV += values[i] as number;
  meanV /= n;

  const omega = (2 * Math.PI) / cycleLenSamples;
  // Goertzel-style DFT at the fundamental, plus total AC energy (Parseval).
  let re = 0;
  let im = 0;
  let energyV = 0;
  for (let i = 0; i < n; i++) {
    const dv = (values[i] as number) - meanV;
    re += dv * Math.cos(omega * i);
    im -= dv * Math.sin(omega * i);
    energyV += dv * dv;
  }
  if (energyV <= 0) return 0;

  // Single-sided energy at the fundamental (factor 2 for the negative-frequency
  // mirror), as a fraction of total AC energy: 1 for a pure sinusoid, less when
  // energy spreads into harmonics. Phase-invariant (uses |X|, not a fixed
  // quadrature template).
  const fundamentalEnergy = (2 * (re * re + im * im)) / n;
  return Math.min(1, Math.max(0, fundamentalEnergy / energyV));
}

/**
 * Compute the fraction of envelope samples whose corresponding leak is below
 * the leak threshold (the "leak-clean fraction"), used to down-weight episode
 * confidence under high leak.
 *
 * @param leak          Leak samples (L/min) aligned to the source signal.
 * @param leakThreshold Leak threshold (L/min) above which a sample is "dirty".
 * @returns             Clean fraction in [0, 1]; 1 when no leak data.
 */
export function leakCleanFraction(
  leak: ArrayLike<number> | undefined,
  leakThreshold: number,
): number {
  if (!leak || leak.length === 0) return 1;
  let clean = 0;
  let total = 0;
  for (let i = 0; i < leak.length; i++) {
    const v = leak[i] as number;
    if (!Number.isFinite(v)) continue;
    total += 1;
    if (v <= leakThreshold) clean += 1;
  }
  return total === 0 ? 1 : clean / total;
}
