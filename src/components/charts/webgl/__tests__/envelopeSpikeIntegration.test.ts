/**
 * INTEGRATION regression test for the WebGL envelope spike-survival bug
 * (ADR 0019, fidelity gate `view=all`).
 *
 * The bug: at the most-decimated ("all"/whole-night) zoom the WebGL envelope was
 * built by pairing a whole pyramid level's elements 1:2 into ~`levelLen / 2`
 * columns. That is ~`2 × plotWidthColumns` columns — each FAR narrower than one
 * device pixel. A 1-sample +59.5 L/min spike survived in the DATA (its column
 * carried the true max) but rendered as a sub-pixel-wide triangle peak the GPU
 * rasterizer stepped over: the topmost lit pixel reached only the envelope of the
 * spike's neighbours (~+37, ~38% of the spike's height), failing the gate's
 * extreme-survival assertion (`spike lit extreme y=98 did not reach y≈49.3`).
 *
 * The `envelopeGeometry.test.ts` spike-survival test PASSED throughout because it
 * exercises the geometry BUILDER in isolation with a handful of well-resolved
 * columns — it never reproduced the level→pixel-column collapse the integrated
 * path produces. This file closes that seam: it drives the SAME pipeline the
 * fidelity harness does (synthetic dataset → decimation pyramid → level selection
 * → `levelToColumnEnvelope` → `buildEnvelopeGeometry` → vertex Y → device px) and
 * asserts the spike's max vertex reaches the true +59.5 extreme AND maps to the
 * expected device-Y, matching the Canvas2D reference's `columnEnvelopeInto` path.
 *
 * Pure (jsdom, no GL): the geometry/transform are exactly what the GPU consumes,
 * so a vertex reaching the extreme value at the spike's device-X column is the
 * data-level proof that the rasterized waveform now reaches its full height.
 *
 * @module components/charts/webgl/__tests__/envelopeSpikeIntegration.test
 */

import { describe, it, expect } from 'vitest';

import { buildDecimationPyramid, selectPyramidLevel } from '../../canvas/decimationPyramid';
import { levelToColumnEnvelope } from '../../hybridWaveformPlan';
import { columnEnvelopeInto } from '@/services/workers/downsample.worker';
import { buildEnvelopeGeometry, ENVELOPE_VERTEX_STRIDE } from '../envelopeGeometry';
import {
  computeWaveformClipTransform,
  applyClipY,
  LANE_TOP_INSET,
  LANE_BOTTOM_INSET,
} from '../waveformTransform';

// ── Harness-mirrored constants (kept in sync with FidelityHarness.tsx) ──────
const SAMPLE_RATE_HZ = 25;
const SESSION_SECONDS = 3600;
const BASE_SAMPLES = SAMPLE_RATE_HZ * SESSION_SECONDS; // 90_000
const TOTAL_DURATION_MS = SESSION_SECONDS * 1000;
const MS_PER_SAMPLE = TOTAL_DURATION_MS / BASE_SAMPLES;

const SPIKE_BASE_INDEX = 30_000;
const NOTCH_BASE_INDEX = 60_000;
const GAP_START_BASE_INDEX = 45_000;
const GAP_LENGTH = 200;

const FLOW_MIN = -60;
const FLOW_MAX = 60;
const SPIKE_VALUE = FLOW_MAX - 0.5; // +59.5
const NOTCH_VALUE = FLOW_MIN + 0.5; // -59.5

// Harness canvas geometry (CSS px) and DPR.
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 600;
const CHANNEL_HEIGHT = 180;
const PADDING = { top: 8, right: 16, bottom: 28, left: 56 } as const;
const DPR = 2;
const PLOT_WIDTH = CANVAS_WIDTH - PADDING.left - PADDING.right; // 928
const ENVELOPE_SOURCE_OVERSCAN = 4;

/** mulberry32 PRNG — byte-identical to the harness so the dataset matches. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build the deterministic Flow lane exactly as the harness does. */
function buildFlowData(): Float32Array {
  const out = new Float32Array(BASE_SAMPLES);
  const rng = mulberry32(1); // Flow seed
  const breathHz = 0.25;
  for (let i = 0; i < BASE_SAMPLES; i++) {
    const tSec = i / SAMPLE_RATE_HZ;
    const wander = 0.85 + 0.15 * Math.sin(tSec * 0.013 + (rng() - 0.5) * 0.02);
    const phase = 2 * Math.PI * breathHz * tSec;
    out[i] = 45 * wander * Math.sin(phase);
  }
  out[SPIKE_BASE_INDEX] = SPIKE_VALUE;
  out[NOTCH_BASE_INDEX] = NOTCH_VALUE;
  for (let i = GAP_START_BASE_INDEX; i < GAP_START_BASE_INDEX + GAP_LENGTH; i++) out[i] = NaN;
  return out;
}

/** The Flow lane rect (lane 0) and its inner Y band in CSS px. */
function flowLaneRect(): {
  plotLeft: number;
  plotWidth: number;
  stripTop: number;
  stripHeight: number;
} {
  return {
    plotLeft: PADDING.left,
    plotWidth: PLOT_WIDTH,
    stripTop: PADDING.top,
    stripHeight: CHANNEL_HEIGHT,
  };
}

/** Expected device-Y for a Flow physical value (mirrors the gate's physToDeviceY). */
function expectedDeviceY(value: number): number {
  const innerTopCss = PADDING.top + LANE_TOP_INSET;
  const innerBottomCss = PADDING.top + CHANNEL_HEIGHT - LANE_BOTTOM_INSET;
  const norm = (value - FLOW_MIN) / (FLOW_MAX - FLOW_MIN);
  const cssY = innerBottomCss - norm * (innerBottomCss - innerTopCss);
  return cssY * DPR;
}

/** Convert a clip-Y (−1..+1, +Y up) to device-Y in the drawing buffer. */
function clipYToDeviceY(clipY: number): number {
  // clipY = 1 - (cssY / cssHeight) * 2  ⇒  cssY = (1 - clipY)/2 * cssHeight
  const cssY = ((1 - clipY) / 2) * CANVAS_HEIGHT;
  return cssY * DPR;
}

/**
 * Run the WebGL envelope pipeline for the whole-night ("all") viewport and return
 * the geometry, transform, and the resolved per-column envelope — exactly the
 * objects the GPU consumes.
 */
function buildAllViewWebglEnvelope(full: Float32Array): {
  vertices: Float32Array;
  columns: number;
  envMax: Float32Array;
  envMin: Float32Array;
  transform: ReturnType<typeof computeWaveformClipTransform>;
  dataXStart: number;
  dataXPerColumn: number;
} {
  const pyramid = buildDecimationPyramid(full);
  const startSample = 0;
  const endSample = BASE_SAMPLES;
  const columns = Math.max(1, Math.round(PLOT_WIDTH));
  const envTarget = columns * ENVELOPE_SOURCE_OVERSCAN;
  const esel = selectPyramidLevel(pyramid, startSample, endSample, envTarget);
  const level = pyramid.levels[esel.levelIndex];
  if (!level || esel.levelIndex < 1) throw new Error('expected a decimated level (≥1) for "all"');

  const msPerSampleBase = TOTAL_DURATION_MS / BASE_SAMPLES;
  const dataXPerElementMs = level.factor * msPerSampleBase;

  const { min, max, columns: cols } = levelToColumnEnvelope(level.data, columns);
  const dataXPerColumn = (level.data.length * dataXPerElementMs) / cols;
  const dataXStart = 0;

  const lane = flowLaneRect();
  const innerHeight = lane.stripHeight - LANE_TOP_INSET - LANE_BOTTOM_INSET;
  const valuePerPx = Math.abs((FLOW_MAX - FLOW_MIN) / innerHeight);

  const geo = buildEnvelopeGeometry(
    { min, max, columns: cols },
    { dataXStart, dataXPerColumn, valuePerPx },
  );

  const transform = computeWaveformClipTransform(
    { viewStart: 0, viewSpan: TOTAL_DURATION_MS },
    { physicalMin: FLOW_MIN, physicalMax: FLOW_MAX },
    lane,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
  );

  return {
    vertices: geo.vertices,
    columns: cols,
    envMax: max,
    envMin: min,
    transform,
    dataXStart,
    dataXPerColumn,
  };
}

/** The Canvas2D reference per-column envelope for "all" (columnEnvelopeInto). */
function buildAllViewReferenceEnvelope(full: Float32Array): {
  min: Float32Array;
  max: Float32Array;
  columns: number;
} {
  const pyramid = buildDecimationPyramid(full);
  const columns = Math.max(1, Math.round(PLOT_WIDTH));
  const envTarget = columns * ENVELOPE_SOURCE_OVERSCAN;
  const eslice = selectPyramidLevel(pyramid, 0, BASE_SAMPLES, envTarget);
  const envSource = eslice.data.subarray(eslice.startIndex, eslice.endIndex);
  const outMin = new Float32Array(columns);
  const outMax = new Float32Array(columns);
  return columnEnvelopeInto(envSource, columns, outMin, outMax);
}

describe('WebGL envelope spike survival at "all" zoom (integration regression)', () => {
  const full = buildFlowData();

  it('the WebGL envelope is built at the reference column resolution (≈plot width), NOT 2× sub-pixel columns', () => {
    const webgl = buildAllViewWebglEnvelope(full);
    const ref = buildAllViewReferenceEnvelope(full);
    // The fix: WebGL must use the SAME column count as the Canvas2D reference, so
    // columns are ~1 device px wide — not the ~2× count the 1:2 pairing produced.
    expect(webgl.columns).toBe(ref.columns);
    expect(webgl.columns).toBe(Math.round(PLOT_WIDTH));
  });

  it('the spike +59.5 reaches a max vertex at the expected device-Y (matches the reference)', () => {
    const webgl = buildAllViewWebglEnvelope(full);

    // Find the column whose max is the global maximum (the spike).
    let spikeCol = -1;
    let spikeMax = -Infinity;
    for (let c = 0; c < webgl.columns; c++) {
      const m = webgl.envMax[c] as number;
      if (!Number.isNaN(m) && m > spikeMax) {
        spikeMax = m;
        spikeCol = c;
      }
    }
    // 1. The data-level extreme survives the per-pixel reduction.
    expect(spikeMax).toBeCloseTo(SPIKE_VALUE, 5);

    // 2. The spike column's UPPER vertex carries the true +59.5 (extrema preserved
    //    through buildEnvelopeGeometry's min-thickness clamp untouched).
    //    Upper vertex of column `spikeCol` among non-gap columns: count non-gap
    //    columns before it (gaps emit no vertices).
    let vertexCol = 0;
    for (let c = 0; c < spikeCol; c++) {
      const isGap =
        Number.isNaN(webgl.envMin[c] as number) || Number.isNaN(webgl.envMax[c] as number);
      if (!isGap) vertexCol++;
    }
    const upperVertexIndex = vertexCol * 2; // upper then lower per column
    const upperY = webgl.vertices[upperVertexIndex * ENVELOPE_VERTEX_STRIDE + 1] as number;
    expect(upperY).toBeCloseTo(SPIKE_VALUE, 5);

    // 3. That vertex maps through the (Canvas2D-pinned) transform to the device-Y
    //    the fidelity gate expects for +59.5 (~49.3 device px) — i.e. the spike
    //    now rasterizes to its full height, not the ~+37 the bug produced.
    const clipY = applyClipY(webgl.transform, upperY);
    const deviceY = clipYToDeviceY(clipY);
    expect(deviceY).toBeCloseTo(expectedDeviceY(SPIKE_VALUE), 3);
  });

  it('the notch -59.5 reaches a min vertex at the expected device-Y', () => {
    const webgl = buildAllViewWebglEnvelope(full);

    let notchCol = -1;
    let notchMin = Infinity;
    for (let c = 0; c < webgl.columns; c++) {
      const m = webgl.envMin[c] as number;
      if (!Number.isNaN(m) && m < notchMin) {
        notchMin = m;
        notchCol = c;
      }
    }
    expect(notchMin).toBeCloseTo(NOTCH_VALUE, 5);

    let vertexCol = 0;
    for (let c = 0; c < notchCol; c++) {
      const isGap =
        Number.isNaN(webgl.envMin[c] as number) || Number.isNaN(webgl.envMax[c] as number);
      if (!isGap) vertexCol++;
    }
    const lowerVertexIndex = vertexCol * 2 + 1; // lower vertex of the column
    const lowerY = webgl.vertices[lowerVertexIndex * ENVELOPE_VERTEX_STRIDE + 1] as number;
    expect(lowerY).toBeCloseTo(NOTCH_VALUE, 5);

    const clipY = applyClipY(webgl.transform, lowerY);
    const deviceY = clipYToDeviceY(clipY);
    expect(deviceY).toBeCloseTo(expectedDeviceY(NOTCH_VALUE), 3);
  });

  it('the spike column centre lands within ±1 device px of the spike sample (rasterizable)', () => {
    const webgl = buildAllViewWebglEnvelope(full);

    let spikeCol = -1;
    let spikeMax = -Infinity;
    for (let c = 0; c < webgl.columns; c++) {
      const m = webgl.envMax[c] as number;
      if (!Number.isNaN(m) && m > spikeMax) {
        spikeMax = m;
        spikeCol = c;
      }
    }

    // The spike's true device-X (from its sample ms), and the WebGL column centre.
    const spikeMs = SPIKE_BASE_INDEX * MS_PER_SAMPLE;
    const spikeCssX = PADDING.left + (spikeMs / TOTAL_DURATION_MS) * PLOT_WIDTH;
    const spikeDeviceX = spikeCssX * DPR;

    const colCentreMs = webgl.dataXStart + (spikeCol + 0.5) * webgl.dataXPerColumn;
    const colCssX = PADDING.left + (colCentreMs / TOTAL_DURATION_MS) * PLOT_WIDTH;
    const colDeviceX = colCssX * DPR;

    // Within a column width (~2 device px) — comfortably inside the gate's probe
    // window (deviceX ± 1·dpr). The column is ~1 device px wide → rasterizes.
    expect(Math.abs(colDeviceX - spikeDeviceX)).toBeLessThanOrEqual(DPR);
    const columnWidthDevicePx = (webgl.dataXPerColumn / TOTAL_DURATION_MS) * PLOT_WIDTH * DPR;
    expect(columnWidthDevicePx).toBeGreaterThanOrEqual(1.5);
    expect(columnWidthDevicePx).toBeLessThanOrEqual(3);
  });

  it('the WebGL spike/notch device-Y match the Canvas2D reference within sub-pixel', () => {
    const webgl = buildAllViewWebglEnvelope(full);
    const ref = buildAllViewReferenceEnvelope(full);

    let refMax = -Infinity;
    let refMin = Infinity;
    for (let c = 0; c < ref.columns; c++) {
      const mx = ref.max[c] as number;
      const mn = ref.min[c] as number;
      if (!Number.isNaN(mx) && mx > refMax) refMax = mx;
      if (!Number.isNaN(mn) && mn < refMin) refMin = mn;
    }
    let wMax = -Infinity;
    let wMin = Infinity;
    for (let c = 0; c < webgl.columns; c++) {
      const mx = webgl.envMax[c] as number;
      const mn = webgl.envMin[c] as number;
      if (!Number.isNaN(mx) && mx > wMax) wMax = mx;
      if (!Number.isNaN(mn) && mn < wMin) wMin = mn;
    }
    // Both paths reach the same extreme values → the same device-Y.
    expect(wMax).toBeCloseTo(refMax, 5);
    expect(wMin).toBeCloseTo(refMin, 5);
    expect(wMax).toBeCloseTo(SPIKE_VALUE, 5);
    expect(wMin).toBeCloseTo(NOTCH_VALUE, 5);
  });
});
