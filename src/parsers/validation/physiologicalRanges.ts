/**
 * Single source of truth for per-channel physiological ranges and the
 * "meaningful sample" predicate used to decide whether a channel carries real
 * data.
 *
 * Both the {@link module:parsers/validation/Validator} (declared-range checks)
 * and the Signal Viewer's empty-channel detection import from here so the
 * clinical ranges are defined exactly once.
 *
 * ## Why a "meaningful sample" predicate
 *
 * Some machines (and probe-off / no-sensor conditions) emit a sentinel value to
 * mean "no reading": historically `0`, but some hardware uses `-1`. A channel
 * full of such sentinels has no clinical content and its lane should be hidden.
 * A sample is treated as meaningful only when it is finite, non-zero, AND — if a
 * plausibility range is defined for the channel — within that range. A `-1`
 * SpO₂/pulse sample is out of range (and zero is excluded directly), so an
 * all-`-1` or all-`0` oximetry channel is correctly classified as empty, while a
 * flow value of `-1` (in flow's `[-300, 300]` range and non-zero) stays
 * meaningful.
 *
 * ## Two distinct range concepts (validation vs. visibility)
 *
 * These are deliberately decoupled:
 *
 * - {@link PHYSIOLOGICAL_RANGES} is the validation source of truth. The
 *   {@link module:parsers/validation/Validator} uses it to warn when a channel's
 *   *declared* physical range exceeds clinically expected bounds. SpO₂ is
 *   `[50, 100]` there because readings below 50% are clinically extreme and worth
 *   flagging on a declared range.
 * - {@link MEANINGFUL_SAMPLE_RANGES} is the visibility / plausibility source of
 *   truth, used ONLY by {@link isMeaningfulSample} to decide whether an
 *   individual sample is real data or a sentinel. Its SpO₂ floor is *lower*
 *   (`30`) than validation's so that a genuinely profoundly-hypoxic recording is
 *   never hidden as "empty" — the worst possible false negative for a tool that
 *   informs health decisions.
 *
 * @module parsers/validation/physiologicalRanges
 */

/**
 * Acceptable physiological ranges per standard channel name `[min, max]`,
 * inclusive. Used both for declared-range validation and for the
 * range-aware meaningful-sample predicate.
 */
export const PHYSIOLOGICAL_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  flow: [-300, 300],
  maskPressure: [0, 30],
  pressure: [0, 40],
  eprPressure: [0, 30],
  leak: [0, 200],
  tidalVolume: [0, 3000],
  minuteVent: [0, 50],
  respRate: [0, 60],
  epap: [4, 25],
  ipap: [4, 30],
  spo2: [50, 100],
  pulse: [30, 250],
  snore: [0, 100],
  flowLimitation: [0, 1],
};

/**
 * Plausibility ranges per standard channel name `[min, max]`, inclusive, used
 * ONLY by {@link isMeaningfulSample} to distinguish real samples from sentinel /
 * no-reading markers. Defaults to {@link PHYSIOLOGICAL_RANGES} for every channel
 * and overrides only where the visibility floor must differ from the validation
 * floor.
 *
 * ## Why SpO₂'s meaningful floor (`30`) is looser than its validation floor (`50`)
 *
 * The single overriding goal here is to **never hide a real, clinically critical
 * desaturation.** A recording in which every valid SpO₂ sample is below 50% would
 * be wrongly classified as "empty" under the `[50, 100]` validation range and its
 * lane hidden — the worst possible false negative for a health-decision tool.
 *
 * SpO₂ values below ~30% are below the reliable reporting floor of pulse-oximetry
 * hardware and indicate artifact rather than physiology, so `30` is the
 * defensible real-vs-sentinel boundary. Crucially, this looser floor still
 * rejects every known sentinel: `0` is excluded directly by the non-zero rule,
 * `-1` (probe-off) is below `30`, and `127` / `128` / `255` (byte sentinels) are
 * above `100`. Pulse keeps its `[30, 250]` range unchanged.
 */
export const MEANINGFUL_SAMPLE_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  ...PHYSIOLOGICAL_RANGES,
  spo2: [30, 100],
};

/**
 * Whether a single sample `value` for channel `channelName` is meaningful
 * (carries real clinical content rather than a sentinel / no-reading marker).
 *
 * A sample is meaningful iff:
 * 1. `Number.isFinite(value)` is true; AND
 * 2. `value !== 0` (preserves all-zero ⇒ empty for flow/leak/pressure/etc.); AND
 * 3. if a plausibility range is defined for `channelName` in
 *    {@link MEANINGFUL_SAMPLE_RANGES}, `value` is within `[min, max]` inclusive.
 *    When no range is defined, this clause is skipped (the non-zero rule alone
 *    applies).
 *
 * The range lookup is guarded with an own-property check
 * ({@link Object.prototype.hasOwnProperty}) so an unusual `channelName` (e.g.
 * `__proto__`, `constructor`) can never resolve to an inherited property and be
 * misread as a range; such names fall back to the non-zero rule.
 *
 * @param channelName - Standard channel name (e.g. `flow`, `spo2`, `pulse`).
 * @param value - One physical-unit sample value.
 * @returns True when the sample is meaningful.
 */
export function isMeaningfulSample(channelName: string, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (value === 0) return false;
  if (Object.prototype.hasOwnProperty.call(MEANINGFUL_SAMPLE_RANGES, channelName)) {
    const [min, max] = MEANINGFUL_SAMPLE_RANGES[channelName] as readonly [number, number];
    if (value < min || value > max) return false;
  }
  return true;
}

/**
 * Whether a channel's sample buffer contains at least one meaningful sample
 * (see {@link isMeaningfulSample}). An empty buffer, or one consisting only of
 * sentinel / out-of-range / zero values, is considered to have no data and its
 * lane should be hidden.
 *
 * Pure and allocation-free: intended to run over full-resolution
 * (25–50 Hz) data, so it scans once and returns on the first meaningful sample.
 *
 * @param channelName - Standard channel name.
 * @param data - Sample buffer in physical units.
 * @returns True when at least one sample is meaningful.
 */
export function channelHasMeaningfulData(
  channelName: string,
  data: Float32Array | readonly number[],
): boolean {
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v === undefined) continue;
    if (isMeaningfulSample(channelName, v)) return true;
  }
  return false;
}
