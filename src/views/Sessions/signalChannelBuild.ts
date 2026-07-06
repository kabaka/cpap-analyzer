/**
 * Pure, framework-free helpers for building renderer {@link SignalChannel}s from
 * a session's full-resolution CPAP channel data for a given viewport.
 *
 * This module was extracted from `SignalViewer.tsx` so the shared constants and
 * the viewport→channel construction can be reused by the compact embedded
 * signal viewer (and unit-tested without mounting a canvas). It contains no
 * React and no DOM access beyond the small {@link resolveColor} helper (which
 * reads a computed CSS custom property from a host element).
 *
 * ## Reuse split
 *
 * - The colour palette, {@link PADDING}, and the envelope-threshold constants
 *   are the SAME values the full Signal Viewer uses; `SignalViewer.tsx` imports
 *   them from here so the two viewers never drift.
 * - {@link buildCpapChannelForViewport} is a self-contained builder that mirrors
 *   the full viewer's per-frame LTTB + MIN/MAX-envelope pipeline (via the shared
 *   pyramid + `lttbInto`/`columnEnvelopeInto` primitives). It deliberately OMITS
 *   the WebGL whole-level geometry the full viewer attaches — the compact card
 *   renders with the plain Canvas2D {@link SignalRenderer}, so that geometry is
 *   unnecessary weight. The full viewer keeps its own tightly-integrated builder
 *   (bound to its component-scoped double-buffered scratch and WebGL layer); this
 *   one is the reusable, dependency-light equivalent.
 *
 * @module views/Sessions/signalChannelBuild
 */

import {
  selectPyramidLevel,
  type DecimationPyramid,
} from '@/components/charts/canvas/decimationPyramid';
import type { SignalChannel } from '@/components/charts/canvas/SignalRenderer';
import { columnEnvelopeInto, lttbInto, lttbOutLength } from '@/services/workers/downsample.worker';

// ── Shared presentation constants ────────────────────────────────

/** Chart palette — resolved at render time from CSS custom properties. */
export const CHANNEL_COLORS: Record<string, string> = {
  flow: 'var(--color-chart-1)',
  maskPressure: 'var(--color-chart-2)',
  leak: 'var(--color-chart-3)',
  spo2: 'var(--color-chart-4)',
  epap: 'var(--color-chart-5)',
  ipap: 'var(--color-chart-6)',
};

/** Fallback colour if channel name isn't in the map. */
export const DEFAULT_CHANNEL_COLOR = 'var(--color-chart-7)';

/** Canvas padding around the stacked plot area. */
export const PADDING = { top: 20, right: 24, bottom: 28, left: 56 } as const;

/**
 * Samples-per-pixel threshold separating the two dense-CPAP render modes. When
 * the in-viewport source holds MORE than this many samples per output pixel
 * column (zoomed out) we render a per-column MIN/MAX envelope; otherwise
 * (zoomed in) the exact LTTB polyline. See `SignalViewer.tsx` for the full
 * rationale (kept as a single shared constant so both viewers agree).
 */
export const ENVELOPE_SAMPLES_PER_PIXEL = 1;

/**
 * Envelope source density target: the per-column min/max is computed from a
 * pyramid level selected with a target of `columns * this`, so each column is
 * fed several samples and a 1-sample spike is never dropped.
 */
export const ENVELOPE_SOURCE_OVERSCAN = 4;

// ── Colour resolution ────────────────────────────────────────────

/**
 * Resolve a `var(--token)` expression to its computed colour value against a
 * host element. Non-`var()` inputs (already-resolved colours) pass through
 * unchanged. Returns the original expression when `el` is null or the token is
 * unset, so the caller always gets a usable canvas colour string.
 */
export function resolveColor(el: HTMLElement | null, varExpr: string): string {
  if (!el) return varExpr;
  const match = /^var\(([^)]+)\)$/.exec(varExpr);
  if (!match) return varExpr;
  const resolved = getComputedStyle(el)
    .getPropertyValue(match[1] ?? '')
    .trim();
  return resolved || varExpr;
}

// ── Viewport channel construction ────────────────────────────────

/** A session-relative viewport window in ms offset from signal start. */
export interface ViewportRange {
  readonly startTime: number;
  readonly endTime: number;
}

/**
 * Double-buffered LTTB output scratch for one lane. Alternating `a`/`b` avoids
 * overwriting a buffer whose view a previous frame may still be reading (e.g.
 * the crosshair readout), while allocating ~0 per steady-state frame.
 */
interface LttbScratch {
  a: Float32Array;
  b: Float32Array;
  flip: 0 | 1;
  capacity: number;
}

/** Double-buffered per-column MIN/MAX envelope scratch for one lane. */
interface EnvelopeScratch {
  aMin: Float32Array;
  aMax: Float32Array;
  bMin: Float32Array;
  bMax: Float32Array;
  flip: 0 | 1;
  capacity: number;
}

/**
 * Per-lane reusable scratch, held across frames by the caller (one per lane).
 * Passing it in drives steady-state per-frame allocations to ~zero during pan /
 * zoom. Create via {@link createLaneScratch}. When omitted from a build call the
 * builder allocates transient buffers for that call (correct, just not reused).
 */
export interface CpapLaneScratch {
  lttb: LttbScratch | null;
  envelope: EnvelopeScratch | null;
}

/** Create an empty {@link CpapLaneScratch} for one lane. */
export function createLaneScratch(): CpapLaneScratch {
  return { lttb: null, envelope: null };
}

/** Inputs to {@link buildCpapChannelForViewport}. */
export interface BuildCpapChannelInput {
  /** Lane / channel name (manifest channel name, e.g. `flow`). */
  readonly name: string;
  /** Full-resolution channel samples for the whole session. */
  readonly data: Float32Array;
  /** Optional decimation pyramid for `data` (built off first paint). */
  readonly pyramid?: DecimationPyramid;
  /** Resolved stroke colour (not a `var()` expression). */
  readonly color: string;
  /** Physical unit label. */
  readonly unit: string;
  /** Display-domain lower bound (from {@link computeLaneDomain}). */
  readonly physicalMin: number;
  /** Display-domain upper bound. */
  readonly physicalMax: number;
  /** Total session duration in ms (maps time ↔ sample index). */
  readonly totalDurationMs: number;
  /** LTTB output-point target for this frame (≈ plotWidth × 2). */
  readonly targetPoints: number;
  /** Plot width in CSS px (column count for the envelope path). */
  readonly plotWidth: number;
  /** The viewport window to build for. */
  readonly range: ViewportRange;
}

/**
 * Build a renderer {@link SignalChannel} for one CPAP lane over a viewport.
 *
 * Mirrors the full Signal Viewer's per-frame pipeline:
 * 1. Map the viewport time window to base-sample indices.
 * 2. Select a pyramid level (or raw data) and LTTB it to `targetPoints` for the
 *    displayed polyline and the crosshair value source (`data`).
 * 3. When zoomed OUT (> {@link ENVELOPE_SAMPLES_PER_PIXEL} samples/column) attach
 *    a per-column MIN/MAX `envelope` so a 1-sample spike is never dropped.
 *
 * Returns `null` when the lane has no data or the viewport is degenerate.
 *
 * @param input   - Lane data + viewport.
 * @param scratch - Optional reusable per-lane scratch (see {@link CpapLaneScratch}).
 */
export function buildCpapChannelForViewport(
  input: BuildCpapChannelInput,
  scratch?: CpapLaneScratch,
): SignalChannel | null {
  const {
    name,
    data: fullData,
    pyramid,
    color,
    unit,
    physicalMin,
    physicalMax,
    totalDurationMs,
    targetPoints,
    plotWidth,
    range,
  } = input;

  if (fullData.length === 0 || totalDurationMs <= 0) return null;
  const viewDurationMs = range.endTime - range.startTime;
  if (viewDurationMs <= 0) return null;

  const totalSamples = fullData.length;
  const startFrac = range.startTime / totalDurationMs;
  const endFrac = range.endTime / totalDurationMs;
  const startSample = Math.max(0, Math.floor(startFrac * totalSamples));
  const endSample = Math.min(Math.ceil(endFrac * totalSamples), totalSamples);
  if (endSample <= startSample) return null;

  // ── Hybrid threshold: envelope (zoomed out) vs polyline (zoomed in) ──
  const columns = Math.max(1, Math.round(plotWidth));
  const rawSpan = endSample - startSample;
  const useEnvelope =
    plotWidth > 0 && rawSpan > columns * ENVELOPE_SAMPLES_PER_PIXEL && pyramid !== undefined;

  // ── LTTB display data (also the crosshair value source) ──────────────
  let levelSlice: Float32Array;
  if (pyramid) {
    const pslice = selectPyramidLevel(pyramid, startSample, endSample, targetPoints);
    levelSlice = pslice.data.subarray(pslice.startIndex, pslice.endIndex);
  } else {
    levelSlice = fullData.subarray(startSample, endSample);
  }

  let displayData: Float32Array;
  if (levelSlice.length > targetPoints) {
    const needed = lttbOutLength(levelSlice.length, targetPoints);
    if (scratch) {
      let s = scratch.lttb;
      if (!s || s.capacity < needed) {
        const capacity = Math.max(needed, targetPoints);
        s = {
          a: new Float32Array(capacity),
          b: new Float32Array(capacity),
          flip: 0,
          capacity,
        };
        scratch.lttb = s;
      }
      const out = s.flip === 0 ? s.a : s.b;
      s.flip = s.flip === 0 ? 1 : 0;
      displayData = lttbInto(levelSlice, targetPoints, out);
    } else {
      displayData = lttbInto(levelSlice, targetPoints, new Float32Array(needed));
    }
  } else {
    displayData = levelSlice;
  }

  // ── Envelope (zoomed-out fidelity path) ──────────────────────────────
  let envelope: SignalChannel['envelope'] | undefined;
  if (useEnvelope && pyramid) {
    const envTarget = columns * ENVELOPE_SOURCE_OVERSCAN;
    const eslice = selectPyramidLevel(pyramid, startSample, endSample, envTarget);
    const envSource = eslice.data.subarray(eslice.startIndex, eslice.endIndex);
    if (envSource.length > 0) {
      let outMin: Float32Array;
      let outMax: Float32Array;
      if (scratch) {
        let e = scratch.envelope;
        if (!e || e.capacity < columns) {
          e = {
            aMin: new Float32Array(columns),
            aMax: new Float32Array(columns),
            bMin: new Float32Array(columns),
            bMax: new Float32Array(columns),
            flip: 0,
            capacity: columns,
          };
          scratch.envelope = e;
        }
        outMin = e.flip === 0 ? e.aMin : e.bMin;
        outMax = e.flip === 0 ? e.aMax : e.bMax;
        e.flip = e.flip === 0 ? 1 : 0;
      } else {
        outMin = new Float32Array(columns);
        outMax = new Float32Array(columns);
      }
      const env = columnEnvelopeInto(envSource, columns, outMin, outMax);
      envelope = { min: env.min, max: env.max, columns: env.columns };
    }
  }

  const effectiveSampleRate = viewDurationMs > 0 ? (displayData.length / viewDurationMs) * 1000 : 0;

  return {
    name,
    data: displayData,
    sampleRate: effectiveSampleRate,
    unit,
    color,
    physicalMin,
    physicalMax,
    kind: 'cpap',
    render: 'line',
    ...(envelope ? { envelope } : {}),
  };
}
