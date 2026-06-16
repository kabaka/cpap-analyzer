/**
 * Pure planning logic for the WebGL2/Canvas2D hybrid Signal Viewer (ADR 0019,
 * Stage 2).
 *
 * The hybrid renderer composites three layers (bottom → top):
 *
 *   1. **Canvas2D chrome** — channel backgrounds, grid, event-marker + detection
 *      washes, Y/X axis labels, the hypnogram ribbon, sparse/step lanes, and
 *      wearable line lanes. Drawn by {@link
 *      module:components/charts/canvas/SignalRenderer} in `chromeOnly` mode.
 *   2. **WebGL2 waveform** — ONLY the dense-CPAP envelope/line lanes.
 *   3. **Canvas2D crosshair overlay** — unchanged.
 *
 * Deciding *which lanes go to which layer*, *whether a lane draws an envelope or
 * a line*, *how a lane maps to a per-frame transform*, and *whether a re-upload
 * is needed* are all pure, deterministic functions of the inputs — so they live
 * here, fully unit-tested in the headless sandbox, instead of inside the
 * GL-context-bound renderer (which cannot run without a GPU).
 *
 * This module deliberately depends on NO GL types beyond the renderer-agnostic
 * geometry shapes, so it stays unit-testable.
 *
 * @module components/charts/hybridWaveformPlan
 */

import type { SignalChannel } from './canvas/SignalRenderer';

/**
 * A dense-CPAP waveform lane is the only kind the WebGL2 layer paints: `kind`
 * defaults to `'cpap'` and `render` defaults to `'line'`. Wearable lanes
 * (`kind: 'wearable'`), step/sparse lanes, and ribbons all stay on Canvas2D.
 *
 * This is the SINGLE source of truth for the chrome/waveform split — both the
 * Canvas2D chrome pass (which skips these) and the WebGL upload (which selects
 * these) consult it, so the two layers can never disagree about a lane.
 */
export function isDenseCpapWaveform(ch: {
  readonly kind?: SignalChannel['kind'];
  readonly render?: SignalChannel['render'];
  readonly sparse?: boolean;
}): boolean {
  const kind = ch.kind ?? 'cpap';
  const render = ch.render ?? 'line';
  return kind === 'cpap' && render === 'line' && ch.sparse !== true;
}

/**
 * Per-lane WebGL geometry source, attached to a {@link SignalChannel} by the host
 * for the dense-CPAP lanes the WebGL2 layer paints. It carries the WHOLE chosen
 * pyramid level (not the per-viewport slice) in a STABLE, absolute ms data-space
 * X domain, so pan/zoom are uniform-only: the renderer windows the uploaded
 * geometry with `viewStart`/`viewSpan` in ms instead of re-slicing + re-uploading.
 *
 * The Canvas2D path ignores this field entirely (it consumes the pre-sliced
 * `data`/`envelope`), so attaching it is back-compatible. See ADR 0019 and {@link
 * module:components/charts/HybridSignalRenderer}.
 */
export interface WebGLLaneGeometry {
  /** Render mode chosen for this lane this frame. */
  readonly mode: 'envelope' | 'line';
  /**
   * The whole chosen pyramid level array (extrema-preserving). In `line` mode this
   * is the polyline samples; in `envelope` mode it is the level's interleaved
   * min/max temporal sequence reinterpreted as a band (see the renderer).
   */
  readonly levelData: Float32Array;
  /** Index of the chosen level within the channel's pyramid (LOD fingerprint). */
  readonly levelIndex: number;
  /** Data-space X (ms) step per element of {@link levelData}: `factor * msPerSampleBase`. */
  readonly dataXPerElementMs: number;
  /** Data-space X (ms) of element 0 (the session signal start = 0). */
  readonly dataXStartMs: number;
  /** Plot-width column count at upload time (resize fingerprint). */
  readonly plotWidthColumns: number;
  /** Physical Y range at upload time (envelope clamp fingerprint). */
  readonly physRange: number;
}

/**
 * Which dense-CPAP render mode a lane uses for the current viewport: a per-column
 * MIN/MAX envelope (zoomed OUT) or the per-sample polyline (zoomed IN).
 *
 * This mirrors EXACTLY the threshold the Canvas2D path uses to decide whether to
 * attach an `envelope` to a {@link SignalChannel} (see `buildCpapChannel` in the
 * Signal Viewer): the lane renders an envelope iff a usable envelope was built
 * AND it has at least one column. Expressing it as a pure predicate lets the
 * WebGL upload pick envelope-vs-line geometry from the SAME channel object the
 * Canvas2D path consumed, guaranteeing the two paths never diverge at the
 * boundary (where min ≈ max and the two looks coincide).
 *
 * When the host has attached {@link WebGLLaneGeometry} (`webglLane`), its `mode`
 * is authoritative (the host already decided envelope-vs-line during slicing);
 * otherwise we infer from the channel's `envelope`/`data` for back-compat.
 */
export type WaveformMode = 'envelope' | 'line' | 'none';

/** Decide the render mode for a (possibly null) built channel. */
export function waveformModeForChannel(ch: SignalChannel | null | undefined): WaveformMode {
  if (!ch) return 'none';
  if (!isDenseCpapWaveform(ch)) return 'none';
  if (ch.webglLane) return ch.webglLane.mode;
  if (ch.envelope && ch.envelope.columns > 0) return 'envelope';
  if (ch.data.length > 0) return 'line';
  return 'none';
}

/**
 * A compact, comparable signature of a lane's UPLOADED geometry. Two frames with
 * equal signatures share identical GPU buffers, so {@link uploadLanes} must NOT
 * be re-issued between them — pan/zoom within a level only changes uniforms.
 *
 * Because the WebGL geometry is the WHOLE chosen pyramid level in a STABLE,
 * absolute ms domain (see {@link WebGLLaneGeometry}), pan and zoom WITHIN a level
 * change neither the level nor the geometry — only the viewStart/viewSpan
 * uniforms. A re-upload is required ONLY when one of these changes:
 *   - `mode` — envelope↔line switch crossing the samples-per-pixel threshold.
 *   - `levelIndex` — zoom crossed an LOD boundary (a different pyramid level).
 *   - `plotWidthColumns` — resize changed the plot width (and thus level choice).
 *   - `physRange` — the display domain expanded (envelope min-thickness clamp is
 *     baked into vertex Y at upload time, so a changed range changes vertices).
 *
 * The signature deliberately does NOT include the viewport (viewStart/viewSpan),
 * colour, lane rect, or crosshair: those are per-frame uniforms / overlay work,
 * never a reason to re-upload. This is the load-bearing check that keeps
 * continuous pan/zoom at ~0 upload cost.
 */
export interface LaneUploadSignature {
  readonly mode: WaveformMode;
  /** Chosen pyramid level (LOD fingerprint). */
  readonly levelIndex: number;
  /** Plot width column count (resize fingerprint). */
  readonly plotWidthColumns: number;
  /** Physical Y range (envelope-clamp fingerprint). */
  readonly physRange: number;
}

/** Derive the upload signature for a built channel. */
export function laneUploadSignature(ch: SignalChannel | null | undefined): LaneUploadSignature {
  const mode = waveformModeForChannel(ch);
  if (!ch || mode === 'none' || !ch.webglLane) {
    return { mode: 'none', levelIndex: -1, plotWidthColumns: 0, physRange: 0 };
  }
  const g = ch.webglLane;
  return {
    mode,
    levelIndex: g.levelIndex,
    plotWidthColumns: g.plotWidthColumns,
    // Only the envelope clamp depends on physRange; line mode's width is a shader
    // uniform, so we fold physRange in for envelope and leave it neutral for line.
    physRange: mode === 'envelope' ? g.physRange : 0,
  };
}

/** True when two signatures require different GPU buffers (i.e. a re-upload). */
export function uploadSignaturesDiffer(a: LaneUploadSignature, b: LaneUploadSignature): boolean {
  return (
    a.mode !== b.mode ||
    a.levelIndex !== b.levelIndex ||
    a.plotWidthColumns !== b.plotWidthColumns ||
    a.physRange !== b.physRange
  );
}

/**
 * Decide, for a whole frame, whether {@link uploadLanes} must be re-issued.
 *
 * `prev`/`next` are maps of lane id → signature. A re-upload is needed when:
 *   - the set of lane ids changed (a lane appeared/disappeared, e.g. toggled or
 *     auto-hidden), OR
 *   - any surviving lane's signature differs (mode/LOD/columns change).
 *
 * Returns `true` to re-upload, `false` to render with the existing buffers
 * (uniform-only frame). Pure so the LOD-change detection is unit-tested without
 * a GL context.
 */
export function needsReupload(
  prev: ReadonlyMap<string, LaneUploadSignature>,
  next: ReadonlyMap<string, LaneUploadSignature>,
): boolean {
  if (prev.size !== next.size) return true;
  for (const [id, sig] of next) {
    const prevSig = prev.get(id);
    if (!prevSig) return true;
    if (uploadSignaturesDiffer(prevSig, sig)) return true;
  }
  return false;
}

/**
 * Reinterpret a whole pyramid LEVEL array as a per-column MIN/MAX envelope in the
 * STABLE absolute domain.
 *
 * The pyramid's coarser levels are produced by {@link
 * module:components/charts/canvas/decimationPyramid.decimateMinMax}, which emits,
 * per group of four base samples, exactly TWO values — that group's min and max
 * in temporal order. So a level is already an interleaved extrema sequence. We map
 * each consecutive PAIR `(levelData[2k], levelData[2k+1])` to one band column with
 * that column's `min`/`max`, giving `columns = floor(levelLen / 2)` columns that
 * span the whole session. A pair containing a NaN (gap) yields a NaN column,
 * preserving the polyline break exactly as the Canvas2D envelope does.
 *
 * Level 0 (raw, factor 1) is NOT an interleaved extrema sequence — but envelope
 * mode is only ever selected when the viewport holds > 1 sample/pixel, i.e. a
 * coarser level is chosen (levelIndex ≥ 1). The host never attaches envelope
 * geometry at level 0, so this pairing is always applied to a real extrema level.
 *
 * Pure and unit-tested. Returns arrays sized exactly `columns`.
 */
export function levelToColumnEnvelope(levelData: Float32Array): {
  min: Float32Array;
  max: Float32Array;
  columns: number;
} {
  const columns = Math.floor(levelData.length / 2);
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  for (let c = 0; c < columns; c++) {
    const a = levelData[2 * c] as number;
    const b = levelData[2 * c + 1] as number;
    if (Number.isNaN(a) || Number.isNaN(b)) {
      // Gap column — breaks the band (mirrors the polyline NaN break).
      min[c] = NaN;
      max[c] = NaN;
      continue;
    }
    min[c] = Math.min(a, b);
    max[c] = Math.max(a, b);
  }
  return { min, max, columns };
}

/**
 * The data-space X (ms) step per ELEMENT of a level array, and per COLUMN of the
 * paired envelope, in the STABLE absolute ms domain. `factor` is the level's
 * decimation factor relative to base; `msPerSampleBase` is `totalDurationMs /
 * totalBaseSamples`.
 *
 * - Line mode: each level element is one polyline sample at `dataX = element *
 *   factor * msPerSampleBase`, so `dataXPerElementMs = factor * msPerSampleBase`.
 * - Envelope mode: each COLUMN is a PAIR of level elements (4 base samples ×
 *   `factor`/... ), spanning `2 * factor * msPerSampleBase` ms; its centre sits at
 *   `(c + 0.5) * dataXPerColumnMs`.
 */
export function levelDataXPerElementMs(factor: number, msPerSampleBase: number): number {
  return factor * msPerSampleBase;
}

/** Envelope column width in ms (a column = a pair of level elements). */
export function envelopeDataXPerColumnMs(factor: number, msPerSampleBase: number): number {
  return 2 * factor * msPerSampleBase;
}

/**
 * The value-units-per-CSS-pixel magnitude for a lane's Y axis, needed by the
 * envelope min-thickness clamp ({@link buildEnvelopeGeometry}). Mirrors the
 * Canvas2D inner-plot Y mapping: `innerHeight = stripHeight - TOP_INSET -
 * BOTTOM_INSET`, `valuePerPx = physRange / innerHeight`.
 *
 * @returns the magnitude, or 0 when the lane has no usable Y extent.
 */
export function laneValuePerPx(params: {
  readonly physicalMin: number;
  readonly physicalMax: number;
  readonly stripHeight: number;
  readonly topInset: number;
  readonly bottomInset: number;
}): number {
  const innerHeight = params.stripHeight - params.topInset - params.bottomInset;
  const physRange = params.physicalMax - params.physicalMin;
  if (innerHeight <= 0 || physRange <= 0) return 0;
  return Math.abs(physRange / innerHeight);
}
