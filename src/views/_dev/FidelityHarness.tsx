/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  DEV / TEST-ONLY — the entire `src/views/_dev/` directory is NEVER shipped ║
 * ║  in a production bundle.                                                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Stage-3 WebGL fidelity-gate HARNESS (ADR 0019).
 *
 * This component is the in-app fixture the Playwright fidelity gate
 * (`tests/e2e/webgl-fidelity-gate.spec.ts`) drives. It builds ONE deterministic
 * synthetic CPAP dataset and renders it side-by-side through BOTH the rendering
 * paths the gate compares:
 *
 *   • the Canvas2D **reference** ({@link SignalRenderer} in full-draw mode), and
 *   • the WebGL2 path under test ({@link HybridSignalRenderer}).
 *
 * THE LOAD-BEARING INVARIANT: each lane is built ONCE as a single
 * {@link SignalChannel} carrying BOTH representations — the pre-sliced
 * `data`/`envelope` (consumed by the Canvas2D reference) AND the whole-level
 * `webglLane` geometry (consumed by the WebGL path) — exactly as the real app's
 * `buildCpapChannel` does in `src/views/Sessions/SignalViewer.tsx`. The SAME
 * channel object is handed to both renderers, so the gate measures the genuine
 * divergence between the two interpretations of the same source, which is the
 * fidelity risk ADR 0019 mandates we close before WebGL becomes the default.
 *
 * WHY IT IS DEV-ONLY: the route is registered only when `import.meta.env.DEV`
 * (see `src/router.tsx`) and the component is lazy-imported, so it tree-shakes
 * out of `npm run build`. Privacy/perf principles are unaffected: it uses only
 * synthetic in-memory data and fixed colours (theme-independent).
 *
 * @module views/_dev/FidelityHarness
 */

import { useEffect, useRef, useState } from 'react';

import {
  SignalRenderer,
  computeLaneLayout,
  type RenderOptions,
  type SignalChannel,
  type ViewportState,
} from '@/components/charts/canvas/SignalRenderer';
import { HybridSignalRenderer, type ColorResolver } from '@/components/charts/HybridSignalRenderer';
import { parseCssColorToRgba } from '@/components/charts/cssColor';
import {
  buildDecimationPyramid,
  selectPyramidLevel,
  type DecimationPyramid,
} from '@/components/charts/canvas/decimationPyramid';
import { columnEnvelopeInto, lttbInto, lttbOutLength } from '@/services/workers/downsample.worker';

// ── Fixed harness geometry (CSS px) ────────────────────────────────────────
// A FIXED canvas size so both renderers receive byte-identical dimensions.
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 600;
const CHANNEL_HEIGHT = 180;
const PADDING = { top: 8, right: 16, bottom: 28, left: 56 } as const;
const DEFAULT_DPR = 2;

// ── Module-private constants mirrored from SignalViewer (not exported there) ─
const ENVELOPE_SAMPLES_PER_PIXEL = 1;
const ENVELOPE_SOURCE_OVERSCAN = 4;

// ── Deterministic synthetic dataset parameters ─────────────────────────────
const SAMPLE_RATE_HZ = 25; // dense CPAP base rate
const SESSION_SECONDS = 3600; // ~1 hour
const BASE_SAMPLES = SAMPLE_RATE_HZ * SESSION_SECONDS; // 90_000
const TOTAL_DURATION_MS = SESSION_SECONDS * 1000;
const MS_PER_SAMPLE = TOTAL_DURATION_MS / BASE_SAMPLES;

// Known landmark base indices (deterministic; the spec targets these).
const SPIKE_BASE_INDEX = 30_000; // single-sample positive extreme (flow)
const NOTCH_BASE_INDEX = 60_000; // single-sample negative extreme (flow)
const GAP_START_BASE_INDEX = 45_000; // NaN run start (all lanes)
const GAP_LENGTH = 200; // NaN run length
const GAP_END_BASE_INDEX = GAP_START_BASE_INDEX + GAP_LENGTH;

// Fixed, theme-independent lane colours so the gate is deterministic.
const LANE_COLORS = {
  Flow: '#3b82f6',
  Pressure: '#10b981',
  Leak: '#f59e0b',
} as const;

// Physical domains per lane.
const LANE_DOMAINS = {
  Flow: { min: -60, max: 60, unit: 'L/min' },
  Pressure: { min: 4, max: 20, unit: 'cmH2O' },
  Leak: { min: 0, max: 40, unit: 'L/min' },
} as const;

type LaneName = keyof typeof LANE_COLORS;

/** Deterministic PRNG (mulberry32) — no `Math.random`, fully reproducible. */
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

/** Build the deterministic full-resolution signal for one lane. */
function buildLaneData(name: LaneName): Float32Array {
  const out = new Float32Array(BASE_SAMPLES);
  const rng = mulberry32(name === 'Flow' ? 1 : name === 'Pressure' ? 2 : 3);
  const dom = LANE_DOMAINS[name];

  // ~15 breaths/min = 0.25 Hz fundamental breathing rhythm.
  const breathHz = 0.25;
  for (let i = 0; i < BASE_SAMPLES; i++) {
    const tSec = i / SAMPLE_RATE_HZ;
    // Mild amplitude + phase wander so the waveform is non-trivial but bounded.
    const wander = 0.85 + 0.15 * Math.sin(tSec * 0.013 + (rng() - 0.5) * 0.02);
    const phase = 2 * Math.PI * breathHz * tSec;

    let v: number;
    if (name === 'Flow') {
      // Zero-centred sinusoid, ±~45 L/min envelope.
      v = 45 * wander * Math.sin(phase);
    } else if (name === 'Pressure') {
      // Slow ramp 8→13 cmH2O + small breathing ripple.
      const ramp = 8 + (5 * i) / BASE_SAMPLES;
      v = ramp + 0.8 * Math.sin(phase);
    } else {
      // Leak: mostly low with two raised plateaus.
      const plateauA = i > 18_000 && i < 22_000 ? 24 : 0;
      const plateauB = i > 70_000 && i < 75_000 ? 18 : 0;
      v = 4 + 1.5 * Math.abs(Math.sin(phase * 0.5)) + plateauA + plateauB;
    }
    out[i] = v;
  }

  // Single-sample SPIKE and NOTCH on the FLOW lane at known indices, pushed to
  // near the physical extreme so the gate can assert they reach the lane edge.
  if (name === 'Flow') {
    out[SPIKE_BASE_INDEX] = dom.max - 0.5; // +59.5 L/min
    out[NOTCH_BASE_INDEX] = dom.min + 0.5; // -59.5 L/min
  }

  // NaN GAP run on EVERY lane (real data on both sides).
  for (let i = GAP_START_BASE_INDEX; i < GAP_END_BASE_INDEX; i++) {
    out[i] = NaN;
  }

  return out;
}

/** Viewport (ms) for each supported `view` query value. */
function viewportForView(view: string): { startTime: number; endTime: number } {
  const spikeMs = SPIKE_BASE_INDEX * MS_PER_SAMPLE;
  const gapStartMs = GAP_START_BASE_INDEX * MS_PER_SAMPLE;
  const gapEndMs = GAP_END_BASE_INDEX * MS_PER_SAMPLE;
  switch (view) {
    case '1h':
      return { startTime: 0, endTime: TOTAL_DURATION_MS };
    case '5m':
      return { startTime: 0, endTime: 5 * 60 * 1000 };
    case '1m':
      // A 1-minute zoomed-in window → line mode (raw samples per px < 1).
      return { startTime: 10 * 60 * 1000, endTime: 11 * 60 * 1000 };
    case 'spike': {
      // ~1-minute window centred on the spike.
      const half = 30 * 1000;
      return { startTime: spikeMs - half, endTime: spikeMs + half };
    }
    case 'gap': {
      // A window that comfortably contains the whole NaN gap with margin so the
      // gap occupies many interior pixel columns.
      const margin = 30 * 1000;
      return { startTime: gapStartMs - margin, endTime: gapEndMs + margin };
    }
    case 'all':
    default:
      return { startTime: 0, endTime: TOTAL_DURATION_MS };
  }
}

/**
 * Build ONE {@link SignalChannel} for a lane, mirroring `buildCpapChannel` in
 * SignalViewer: populate `data` (LTTB) + `envelope` (per-column min/max) for the
 * Canvas2D reference AND `webglLane` (whole pyramid level) for the WebGL path.
 */
function buildChannel(
  name: LaneName,
  fullData: Float32Array,
  pyramid: DecimationPyramid,
  range: { startTime: number; endTime: number },
  plotWidth: number,
  targetPoints: number,
): SignalChannel {
  const dom = LANE_DOMAINS[name];
  const physicalMin = dom.min;
  const physicalMax = dom.max;

  const totalSamples = fullData.length;
  const startSample = Math.floor((range.startTime / TOTAL_DURATION_MS) * totalSamples);
  const endSample = Math.min(
    Math.ceil((range.endTime / TOTAL_DURATION_MS) * totalSamples),
    totalSamples,
  );

  const columns = Math.max(1, Math.round(plotWidth));
  const rawSpan = endSample - startSample;
  const useEnvelope = plotWidth > 0 && rawSpan > columns * ENVELOPE_SAMPLES_PER_PIXEL;

  // ── LTTB display data (crosshair source; reference polyline when zoomed in) ─
  const pslice = selectPyramidLevel(pyramid, startSample, endSample, targetPoints);
  const levelSlice = pslice.data.subarray(pslice.startIndex, pslice.endIndex);
  let displayData: Float32Array;
  if (levelSlice.length > targetPoints) {
    const needed = lttbOutLength(levelSlice.length, targetPoints);
    const out = new Float32Array(Math.max(needed, targetPoints));
    displayData = lttbInto(levelSlice, targetPoints, out);
  } else {
    displayData = levelSlice;
  }

  // ── Envelope (Canvas2D reference's zoomed-out waveform) ────────────────────
  let envelope: SignalChannel['envelope'] | undefined;
  if (useEnvelope) {
    const envTarget = columns * ENVELOPE_SOURCE_OVERSCAN;
    const eslice = selectPyramidLevel(pyramid, startSample, endSample, envTarget);
    const envSource = eslice.data.subarray(eslice.startIndex, eslice.endIndex);
    if (envSource.length > 0) {
      const outMin = new Float32Array(columns);
      const outMax = new Float32Array(columns);
      const env = columnEnvelopeInto(envSource, columns, outMin, outMax);
      envelope = { min: env.min, max: env.max, columns: env.columns };
    }
  }

  // ── WebGL whole-level geometry (the path under test) ───────────────────────
  const msPerSampleBase = TOTAL_DURATION_MS / totalSamples;
  let webglLane: SignalChannel['webglLane'] | undefined;
  if (useEnvelope) {
    const envTarget = columns * ENVELOPE_SOURCE_OVERSCAN;
    const esel = selectPyramidLevel(pyramid, startSample, endSample, envTarget);
    const level = pyramid.levels[esel.levelIndex];
    if (level && esel.levelIndex >= 1) {
      webglLane = {
        mode: 'envelope',
        levelData: level.data,
        levelIndex: esel.levelIndex,
        dataXPerElementMs: level.factor * msPerSampleBase,
        dataXStartMs: 0,
        plotWidthColumns: columns,
        physRange: physicalMax - physicalMin,
      };
    }
  }
  if (!webglLane) {
    const lsel = selectPyramidLevel(pyramid, startSample, endSample, targetPoints);
    const level = pyramid.levels[lsel.levelIndex];
    if (level) {
      webglLane = {
        mode: 'line',
        levelData: level.data,
        levelIndex: lsel.levelIndex,
        dataXPerElementMs: level.factor * msPerSampleBase,
        dataXStartMs: 0,
        plotWidthColumns: columns,
        physRange: physicalMax - physicalMin,
      };
    }
  }

  const viewDurationMs = range.endTime - range.startTime;
  const effectiveSampleRate =
    viewDurationMs > 0 ? (displayData.length / viewDurationMs) * 1000 : SAMPLE_RATE_HZ;

  return {
    name,
    data: displayData,
    sampleRate: effectiveSampleRate,
    unit: dom.unit,
    color: LANE_COLORS[name],
    physicalMin,
    physicalMax,
    kind: 'cpap',
    render: 'line',
    ...(envelope ? { envelope } : {}),
    ...(webglLane ? { webglLane } : {}),
  };
}

/** Fixed colour resolver (theme-independent) for the WebGL path. */
const resolveColor: ColorResolver = (channel) => parseCssColorToRgba(channel.color);

/** Landmarks the spec reads from `window.__fidelity`. */
interface FidelityLandmarks {
  view: string;
  dpr: number;
  spikeMs: number;
  spikeBaseIndex: number;
  notchMs: number;
  notchBaseIndex: number;
  gapStartMs: number;
  gapEndMs: number;
  totalDurationMs: number;
  viewport: { startTime: number; endTime: number };
  padding: { top: number; right: number; bottom: number; left: number };
  channelHeight: number;
  plot: { left: number; top: number; width: number; height: number };
  laneRects: {
    name: string;
    top: number;
    height: number;
    physicalMin: number;
    physicalMax: number;
  }[];
  /**
   * Force a SYNCHRONOUS WebGL waveform re-render at the harness viewport. The
   * fidelity spec calls this inside the same `page.evaluate` task as each pixel
   * read-back so the drawing buffer is guaranteed freshly populated at read time
   * (belt-and-suspenders alongside `preserveDrawingBuffer:true`). No-op on the
   * Canvas2D fallback. DEV/TEST-ONLY.
   */
  renderWebglNow: () => void;
}

declare global {
  interface Window {
    __fidelity?: FidelityLandmarks;
  }
}

/**
 * Render the harness: build the dataset once, render BOTH paths at DPR 2, and
 * publish landmarks + a `harness-ready` marker for the spec to await.
 */
export default function FidelityHarness(): React.JSX.Element {
  const refHostRef = useRef<HTMLDivElement>(null);
  const webglHostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [webglActive, setWebglActive] = useState<boolean | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view') ?? 'all';
    const dprParam = Number(params.get('dpr'));
    const dpr = Number.isFinite(dprParam) && dprParam > 0 ? dprParam : DEFAULT_DPR;

    // Force a deterministic devicePixelRatio so both renderers rasterize at the
    // same density regardless of the host display. The renderers read the global
    // `devicePixelRatio` on resize/render.
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      get: () => dpr,
    });

    const range = viewportForView(view);
    const plotWidth = CANVAS_WIDTH - PADDING.left - PADDING.right;
    // Target point density mirrors the app: ~1 LTTB point per CSS px column.
    const targetPoints = Math.max(2, Math.round(plotWidth));

    // Build the deterministic dataset + pyramids ONCE.
    const laneNames: LaneName[] = ['Flow', 'Pressure', 'Leak'];
    const channels: SignalChannel[] = laneNames.map((name) => {
      const full = buildLaneData(name);
      const pyramid = buildDecimationPyramid(full);
      return buildChannel(name, full, pyramid, range, plotWidth, targetPoints);
    });

    const viewport: ViewportState = {
      startTime: range.startTime,
      endTime: range.endTime,
      channels,
    };
    const options: RenderOptions = {
      showCrosshair: false,
      crosshairX: null,
      showGrid: false,
      eventMarkers: [],
      channelHeight: CHANNEL_HEIGHT,
      padding: PADDING,
    };

    // ── Reference renderer (Canvas2D full-draw) ──────────────────────────────
    const refHost = refHostRef.current;
    const webglHost = webglHostRef.current;
    if (!refHost || !webglHost) return;

    const refCanvas = document.createElement('canvas');
    refCanvas.setAttribute('data-testid', 'ref-canvas');
    refHost.appendChild(refCanvas);
    const refRenderer = new SignalRenderer(refCanvas);
    refRenderer.setChromeOnly(false); // reference paints the waveforms
    refRenderer.resize(CANVAS_WIDTH, CANVAS_HEIGHT);
    refRenderer.renderSync(viewport, options);

    // ── WebGL path (HybridSignalRenderer: chrome canvas + transparent webgl) ──
    const chromeCanvas = document.createElement('canvas');
    const waveformCanvas = document.createElement('canvas');
    waveformCanvas.setAttribute('data-testid', 'webgl-canvas');
    // Stack the two layers pixel-aligned (chrome z0, webgl z1).
    chromeCanvas.style.position = 'absolute';
    chromeCanvas.style.left = '0';
    chromeCanvas.style.top = '0';
    waveformCanvas.style.position = 'absolute';
    waveformCanvas.style.left = '0';
    waveformCanvas.style.top = '0';
    webglHost.style.position = 'relative';
    webglHost.style.width = `${CANVAS_WIDTH}px`;
    webglHost.style.height = `${CANVAS_HEIGHT}px`;
    webglHost.appendChild(chromeCanvas);
    webglHost.appendChild(waveformCanvas);

    // preserveDrawingBuffer:true is DEV/TEST-ONLY (default false in production).
    // Without it, reading the WebGL canvas back off-screen (the fidelity gate's
    // gl.readPixels / drawImage-onto-2D capture) is unreliable in headless
    // Chromium/SwiftShader: the buffer may have been swapped away and read blank.
    // Preserving it guarantees a populated buffer at read time. See ADR 0019 and
    // HybridRendererOptions.
    const hybrid = new HybridSignalRenderer(chromeCanvas, waveformCanvas, resolveColor, {
      preserveDrawingBuffer: true,
    });
    hybrid.resize(CANVAS_WIDTH, CANVAS_HEIGHT);
    hybrid.render(viewport, options);
    const active = hybrid.isWebGLActive();
    setWebglActive(active);

    // ── Publish landmarks for the spec ───────────────────────────────────────
    const layout = computeLaneLayout(channels, CHANNEL_HEIGHT, PADDING.top);
    const laneRects = channels.map((ch, i) => ({
      name: ch.name,
      top: layout[i]?.top ?? 0,
      height: layout[i]?.height ?? CHANNEL_HEIGHT,
      physicalMin: ch.physicalMin,
      physicalMax: ch.physicalMax,
    }));

    window.__fidelity = {
      view,
      dpr,
      spikeMs: SPIKE_BASE_INDEX * MS_PER_SAMPLE,
      spikeBaseIndex: SPIKE_BASE_INDEX,
      notchMs: NOTCH_BASE_INDEX * MS_PER_SAMPLE,
      notchBaseIndex: NOTCH_BASE_INDEX,
      gapStartMs: GAP_START_BASE_INDEX * MS_PER_SAMPLE,
      gapEndMs: GAP_END_BASE_INDEX * MS_PER_SAMPLE,
      totalDurationMs: TOTAL_DURATION_MS,
      viewport: { startTime: range.startTime, endTime: range.endTime },
      padding: { ...PADDING },
      channelHeight: CHANNEL_HEIGHT,
      plot: {
        left: PADDING.left,
        top: PADDING.top,
        width: plotWidth,
        height: CANVAS_HEIGHT - PADDING.top - PADDING.bottom,
      },
      laneRects,
      // Re-issue a synchronous WebGL draw at the harness viewport. Called by the
      // spec immediately before each read-back so the buffer is populated.
      renderWebglNow: () => {
        hybrid.render(viewport, options);
      },
    };

    // Mark ready only AFTER both renderers have completed a synchronous draw.
    // (renderSync for the reference; hybrid.render's WebGL pass is synchronous,
    // and the chrome pass is rAF-coalesced but irrelevant to the waveform diff.)
    setReady(true);

    return () => {
      refRenderer.dispose();
      hybrid.dispose();
      refHost.replaceChildren();
      webglHost.replaceChildren();
      delete window.__fidelity;
    };
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: 'monospace' }}>
      <h1 style={{ fontSize: 14 }}>WebGL Fidelity Harness (dev/test-only)</h1>
      <p data-testid="webgl-active">{webglActive === null ? 'pending' : String(webglActive)}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <section>
          <h2 style={{ fontSize: 12 }}>Reference (Canvas2D)</h2>
          <div ref={refHostRef} style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />
        </section>
        <section>
          <h2 style={{ fontSize: 12 }}>WebGL (HybridSignalRenderer)</h2>
          <div
            ref={webglHostRef}
            data-testid="webgl-canvas-host"
            style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
          />
        </section>
      </div>
      {ready ? <span data-testid="harness-ready" hidden /> : null}
    </div>
  );
}
