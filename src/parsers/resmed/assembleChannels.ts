/**
 * Window-aligned channel assembly for multi-segment ResMed nights.
 *
 * ## Why this exists
 * A single therapy session can be split across multiple consecutive EDF files
 * (e.g. ResMed rolls a new BRP/PLD/SAD file mid-night, so one night arrives as
 * two or more contiguous "segments"). Each segment is its own
 * {@link ResMedInterpretation} with its own `startTime`, `duration` and
 * per-channel `sampleRate`.
 *
 * Historically both the OPFS write path ({@link ImportService.buildChannelInputs})
 * and the nightly-aggregate path ({@link SessionBuilder.buildFromGroup}) merged
 * segments with a "longest single segment wins" rule: per channel name, they
 * kept only the channel from the file with the most samples and discarded the
 * rest. For a two-segment night that silently dropped the shorter segment, so
 * the channel handed downstream started at the LONG segment's origin — not at
 * the session window start. The chunker then laid those samples from the window
 * origin, shifting everything earlier and exhausting the data before the true
 * session end (confirmed: a 02:51→11:59 night truncated to ~11:04 / displayed
 * as ending ~10:20). Aggregates (pressure/leak/usage) were likewise computed
 * off one segment only.
 *
 * This module replaces that with TRUE concatenation: per channel name it builds
 * ONE {@link Float32Array} spanning the full session window `[sessionStart,
 * sessionEnd]`, placing each segment's samples at the offset implied by that
 * segment's own start time and rate. Both call sites use this single helper so
 * signal data and aggregates agree and both cover the whole night.
 *
 * ## Gap sentinel: NaN
 * Inter-segment gaps (and any lead-in before the first segment) are filled with
 * `NaN`. NaN is the project-wide "no data" sentinel for Float32 signal samples:
 *
 * - The render pipeline already BREAKS the polyline on NaN
 *   (`webgl/lineGeometry.ts`, `canvas/decimationPyramid.ts`,
 *   `hybridWaveformPlan.ts`), so gaps appear as gaps, not as a line drawn to 0.
 * - The descriptive-statistics module filters non-finite values via
 *   `filterFinite` (`Number.isFinite`), so NaN is excluded from means/medians.
 * - The {@link SessionBuilder} aggregate stats skip NaN (see the
 *   `Number.isNaN`/`undefined` guards there), so padding never drags
 *   pressure/leak means or AHI toward a fabricated 0.
 *
 * A real `0` would corrupt leak/pressure means and usage detection; NaN cannot.
 * Filling padding with `0` is therefore explicitly WRONG here.
 *
 * ## Sample rate
 * Segments of the same channel name may declare different sample rates (rare,
 * but firmware-dependent). The assembled series uses a SINGLE rate per channel
 * name — the rate of the segment with the most samples, with the higher rate as
 * a tiebreaker (preserving the prior tiebreaker behaviour). Each segment is
 * placed at the offset implied by the CHOSEN rate, and a segment whose own rate
 * differs from the chosen rate is nearest-neighbour resampled onto the chosen
 * rate so its sample count matches the window slice it occupies. This keeps the
 * declared rate, total length and window duration mutually consistent — we never
 * silently emit a sample count that disagrees with `rate * windowDuration`.
 *
 * ## Single-segment fast path
 * When a channel name appears in exactly one contributing segment AND that
 * segment starts at the session window start, the segment's own samples are
 * returned UNCHANGED (same backing data, no copy, no padding). This makes the
 * overwhelmingly common single-file night byte-identical to the pre-fix output.
 */

import type { ResMedInterpretation, StandardChannel } from './ResMedInterpreter';

/** Gap / no-data sentinel for assembled Float32 signal samples. See file docs. */
export const GAP_SENTINEL = NaN;

/**
 * Maximum plausible sample rate (Hz) for an assembled channel.
 *
 * Security bound (memory-exhaustion DoS): `totalSamples = round(windowDuration *
 * rate)` and `rate` derives from an untrusted EDF header
 * (`samplesPerRecord / dataRecordDuration`). ResMed signals run at 25–50 Hz
 * (per CLAUDE.md); 256 Hz is a generous ceiling that comfortably covers any real
 * waveform channel while rejecting a crafted rate that would balloon the
 * allocation.
 */
export const MAX_SAMPLE_RATE = 256;

/**
 * Maximum plausible session-window duration (seconds).
 *
 * Security bound: the session window is the min/max of segment start + duration
 * across segments, both header-derived and decoupled across segments. A
 * noon-anchored "session day" is at most ~24 h; 48 h is a generous ceiling that
 * absorbs clock skew / overlap while capping the window component of the
 * allocation. (48 h = 172800 s.)
 *
 * This bound is also the load-bearing guard in the OPFS write path
 * (`OPFSService.writeSession`): the chunk count is `ceil(window / 300s)`, so an
 * unbounded window would spawn millions of chunk-file operations. Both layers
 * import this single constant so the caps can never drift apart.
 */
export const MAX_SESSION_SECONDS = 48 * 3600;

/**
 * Hard upper bound on the assembled sample count before allocation.
 *
 * Derived from the two bounds above (~4.2e7 samples ≈ 170 MB as Float32). Even a
 * header that individually passes the per-field checks cannot drive an
 * allocation past this. Crossing it means the inputs are implausible/corrupt, so
 * we bail to an empty series rather than attempt the allocation. A small margin
 * is added so a legitimate window sitting exactly at the bound (e.g. rounding)
 * is not spuriously rejected.
 */
export const MAX_TOTAL_SAMPLES = Math.ceil(MAX_SAMPLE_RATE * MAX_SESSION_SECONDS * 1.01);

/** A channel assembled across one or more segments, spanning the full window. */
export interface AssembledChannel {
  /** Standard channel name (e.g. "flow", "maskPressure"). */
  readonly name: string;
  /** Physical unit. */
  readonly unit: string;
  /** Chosen sample rate (Hz) for the whole assembled series. */
  readonly sampleRate: number;
  /** Window-aligned, gap-padded samples spanning [sessionStart, sessionEnd]. */
  readonly samples: Float32Array;
  /** Domain channel metadata (from the dominant segment). */
  readonly metadata: StandardChannel['metadata'];
}

/** One channel's contribution from a single segment. */
interface ChannelSegment {
  readonly channel: StandardChannel;
  /** Segment start time in epoch ms. */
  readonly startMs: number;
}

/**
 * Assemble one window-aligned, gap-padded channel per channel name across the
 * given interpretation segments.
 *
 * @param segments     - Contributing interpretation segments (any order).
 * @param sessionStart - Session window start (epoch ms).
 * @param sessionEnd   - Session window end (epoch ms).
 * @returns One {@link AssembledChannel} per distinct channel name.
 */
export function assembleChannels(
  segments: readonly ResMedInterpretation[],
  sessionStart: number,
  sessionEnd: number,
): AssembledChannel[] {
  // Group every channel by name, remembering which segment it came from.
  const byName = new Map<string, ChannelSegment[]>();
  for (const seg of segments) {
    const startMs = seg.startTime.getTime();
    for (const ch of seg.channels) {
      const list = byName.get(ch.name);
      if (list) {
        list.push({ channel: ch, startMs });
      } else {
        byName.set(ch.name, [{ channel: ch, startMs }]);
      }
    }
  }

  const assembled: AssembledChannel[] = [];
  for (const [name, parts] of byName) {
    assembled.push(assembleOneChannel(name, parts, sessionStart, sessionEnd));
  }
  return assembled;
}

/**
 * Assemble a single channel name's segments into one window-aligned series.
 *
 * Exported only for direct unit testing of the assembly math; production code
 * should call {@link assembleChannels}.
 */
export function assembleOneChannel(
  name: string,
  parts: readonly ChannelSegment[],
  sessionStart: number,
  sessionEnd: number,
): AssembledChannel {
  // Choose the dominant segment: most samples, higher rate as tiebreaker.
  // This preserves the historical rate-selection behaviour.
  const first = parts[0];
  if (!first) {
    // No segments for this name — return an empty series spanning the window.
    return {
      name,
      unit: '',
      sampleRate: 0,
      samples: new Float32Array(0),
      metadata: {
        name,
        sampleRate: 0,
        unit: '',
        physicalMin: 0,
        physicalMax: 0,
        digitalMin: 0,
        digitalMax: 0,
      },
    };
  }

  let dominant = first;
  for (const part of parts) {
    const a = part.channel;
    const b = dominant.channel;
    if (
      a.samples.length > b.samples.length ||
      (a.samples.length === b.samples.length && a.sampleRate > b.sampleRate)
    ) {
      dominant = part;
    }
  }

  const rate = dominant.channel.sampleRate;

  // --- Single-segment fast path -------------------------------------------
  // Exactly one segment for this channel name AND it starts at the window
  // origin → return its samples unchanged (no copy, no padding). The common
  // single-file night is byte-identical to the pre-fix output.
  if (parts.length === 1 && first.startMs === sessionStart) {
    const only = first.channel;
    return {
      name,
      unit: only.unit,
      sampleRate: only.sampleRate,
      samples: only.samples,
      metadata: only.metadata,
    };
  }

  // --- Multi-segment (or offset single segment): build a padded window -----
  // Total length is governed by the declared window and the chosen rate, so the
  // emitted sample count always matches rate * windowDurationSeconds. We never
  // let a segment's own length silently redefine the window.
  const windowDurationSeconds = Math.max(0, (sessionEnd - sessionStart) / 1000);

  // --- Defensive allocation cap (memory-exhaustion DoS) --------------------
  // `rate` and `windowDurationSeconds` both derive from untrusted, decoupled EDF
  // headers; their product sizes the allocation below. The parser boundary is
  // the primary defence, but assemble inputs can be constructed independently
  // (and segment windows are min/max across files), so we re-validate here. If
  // rate or window is non-finite/out of physiologic range, or the resulting
  // count exceeds the hard cap, bail to an empty series instead of allocating.
  // The warning is PHI-free (channel name + numbers only).
  const totalSamplesUnclamped = rate > 0 ? Math.round(windowDurationSeconds * rate) : 0;
  const inBounds =
    Number.isFinite(rate) &&
    rate >= 0 &&
    rate <= MAX_SAMPLE_RATE &&
    Number.isFinite(windowDurationSeconds) &&
    windowDurationSeconds <= MAX_SESSION_SECONDS &&
    totalSamplesUnclamped <= MAX_TOTAL_SAMPLES;

  if (!inBounds) {
    // eslint-disable-next-line no-console
    console.warn(
      `[assembleChannels] channel "${name}" exceeds safety bounds ` +
        `(rate=${rate} Hz, window=${windowDurationSeconds} s, ` +
        `samples=${totalSamplesUnclamped}, cap=${MAX_TOTAL_SAMPLES}); ` +
        `returning empty series.`,
    );
    return {
      name,
      unit: dominant.channel.unit,
      sampleRate: rate,
      samples: new Float32Array(0),
      metadata: dominant.channel.metadata,
    };
  }

  const totalSamples = totalSamplesUnclamped;

  const out = new Float32Array(totalSamples);
  // Fill with the gap sentinel; real samples overwrite their slices below. Any
  // index left as NaN is a genuine gap (lead-in or inter-segment) and is
  // treated as "no data" by every downstream consumer (see file docs).
  out.fill(GAP_SENTINEL);

  // Place each segment at its window offset (by the CHOSEN rate). Sort by start
  // so later segments win on the rare overlap (contiguous segments don't).
  const ordered = [...parts].sort((a, b) => a.startMs - b.startMs);
  for (const part of ordered) {
    placeSegment(out, part, sessionStart, rate, totalSamples);
  }

  return {
    name,
    unit: dominant.channel.unit,
    sampleRate: rate,
    samples: out,
    metadata: dominant.channel.metadata,
  };
}

/**
 * Copy one segment's samples into the assembled buffer at its window offset.
 *
 * The destination offset is computed from the segment's own start time and the
 * CHOSEN rate. If the segment's native rate differs from the chosen rate it is
 * nearest-neighbour resampled so its written length matches the window slice it
 * occupies — keeping sample counts consistent with the declared rate.
 */
function placeSegment(
  out: Float32Array,
  part: ChannelSegment,
  sessionStart: number,
  chosenRate: number,
  totalSamples: number,
): void {
  if (chosenRate <= 0 || totalSamples === 0) return;

  const src = part.channel.samples;
  if (src.length === 0) return;

  const offsetSamples = Math.round(((part.startMs - sessionStart) / 1000) * chosenRate);
  const nativeRate = part.channel.sampleRate;

  if (nativeRate === chosenRate || nativeRate <= 0) {
    // Same rate (the overwhelming common case): straight copy, clamped to the
    // window bounds on both ends.
    const destStart = Math.max(0, offsetSamples);
    const srcSkip = destStart - offsetSamples; // >0 only if the segment starts before the window
    const available = Math.max(0, src.length - srcSkip);
    const writable = Math.min(available, totalSamples - destStart);
    if (writable <= 0) return;
    out.set(src.subarray(srcSkip, srcSkip + writable), destStart);
    return;
  }

  // Differing rate: nearest-neighbour resample onto the chosen-rate grid. The
  // segment's wall-clock span is src.length / nativeRate seconds, which maps to
  // round(span * chosenRate) destination samples.
  const spanSeconds = src.length / nativeRate;
  const destCount = Math.round(spanSeconds * chosenRate);
  for (let i = 0; i < destCount; i++) {
    const destIdx = offsetSamples + i;
    if (destIdx < 0) continue;
    if (destIdx >= totalSamples) break;
    // Map this destination sample's time back to the nearest native sample.
    const srcIdx = Math.min(src.length - 1, Math.round((i / chosenRate) * nativeRate));
    const v = src[srcIdx];
    if (v !== undefined) out[destIdx] = v;
  }
}
