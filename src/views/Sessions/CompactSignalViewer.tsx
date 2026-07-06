/**
 * Compact embedded signal viewer — a self-contained "Signals" card body for the
 * Session Details page.
 *
 * Reuses the app's decoupled, highly-optimised rendering pipeline (the plain
 * Canvas2D {@link SignalRenderer} + decimation pyramid + LTTB / MIN-MAX-envelope
 * primitives) to draw Flow, Pressure (MaskPress), Leak and SpO₂ as stacked lanes
 * inside a small card, WITHOUT dragging in the full 5000-line `SignalViewer`
 * (which drives itself from the URL/localStorage and is the wrong fit to embed).
 *
 * Features: channel chips (toggle lanes), a floating per-channel readout on
 * hover, a whole-night minimap with a draggable view window, zoom presets
 * (whole night / event cluster / breath detail), wheel-zoom + drag-pan, and a
 * "Full explorer" link to the standalone viewer.
 *
 * Performance: full channels are read from OPFS once; decimation pyramids are
 * built AFTER first paint (so the first CPAP frame is never blocked); each frame
 * selects a pyramid level and LTTBs / envelopes only the visible window; repaints
 * are `requestAnimationFrame`-coalesced. The renderer + listeners are torn down
 * on unmount.
 *
 * @module views/Sessions/CompactSignalViewer
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { EVENT_TYPE_META } from '@/components/events/eventTypeMeta';
import {
  SignalRenderer,
  formatWallClockLabel,
  type EventMarker,
  type RenderOptions,
  type SignalChannel,
  type ViewportState,
} from '@/components/charts/canvas/SignalRenderer';
import {
  buildDecimationPyramid,
  type DecimationPyramid,
} from '@/components/charts/canvas/decimationPyramid';
import { Icon } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton/Skeleton';
import { useEventData, useSessionDetail } from '@/hooks/useSignalData';
import { isMeaningfulSample } from '@/parsers/validation/physiologicalRanges';
import { OPFSService } from '@/services/storage/OPFSService';
import { useAppStore } from '@/stores/useAppStore';
import type { Event, EventType } from '@/types';

import {
  DEFAULT_CHANNEL_COLOR,
  PADDING,
  buildCpapChannelForViewport,
  createLaneScratch,
  resolveColor,
  type CpapLaneScratch,
  type ViewportRange,
} from './signalChannelBuild';
import {
  LEGEND_EVENT_TYPES,
  buildMinimapEnvelope,
  clampWindow,
  computeClusterWindow,
  formatSpan,
  resolveCompactLanes,
  type CompactLane,
} from './compactSignalModel';
import { computeLaneDomain } from './signalDomain';
import { sessionWallClockEpoch } from './signalLanes';
import { applyCursorAnchoredZoom, wheelDeltaToZoomFactor } from './signalZoom';
import styles from './CompactSignalViewer.module.css';

// ── Constants ────────────────────────────────────────────────────

/** Pixel height of each lane strip in the compact card. */
const COMPACT_CHANNEL_HEIGHT = 64;

/** Minimap height in CSS px. */
const MINIMAP_HEIGHT = 46;

/** Fixed column resolution for the precomputed minimap flow envelope. */
const MINIMAP_ENV_COLUMNS = 800;

/** Downsample point target multiplier over plot width. */
const DOWNSAMPLE_MULTIPLIER = 2;

/** Event-cluster preset window (~30 min). */
const CLUSTER_WINDOW_MS = 30 * 60 * 1000;

/** Breath-detail preset window (~60 s). */
const BREATH_WINDOW_MS = 60 * 1000;

/** Fraction of the session span at/above which the view counts as "whole night". */
const WHOLE_NIGHT_FRACTION = 0.98;

/** Preset identifiers. */
type Preset = 'whole' | 'cluster' | 'breath';

// ── Component ────────────────────────────────────────────────────

export interface CompactSignalViewerProps {
  /** Session to display signals for. */
  readonly sessionId: string;
  /**
   * Optional session-relative time (ms) to focus the "Event cluster" preset on.
   * When omitted the densest event cluster (or first event) is used.
   */
  readonly focusTime?: number;
}

type Phase = 'loading' | 'ready' | 'error' | 'unsupported' | 'empty';

/**
 * Compact embedded signal viewer card body. See the module docstring.
 */
export default function CompactSignalViewer({ sessionId, focusTime }: CompactSignalViewerProps) {
  const navigate = useNavigate();
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const { session } = useSessionDetail(sessionId);
  const { events } = useEventData(sessionId);

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lanes, setLanes] = useState<CompactLane[]>([]);
  const [hiddenLanes, setHiddenLanes] = useState<ReadonlySet<string>>(new Set());
  const [viewport, setViewport] = useState<ViewportRange>({ startTime: 0, endTime: 0 });
  const [activePreset, setActivePreset] = useState<Preset | null>('whole');
  const [readout, setReadout] = useState<{
    time: string;
    rows: { label: string; value: string; color: string }[];
    event: string | null;
  } | null>(null);

  // ── Refs: data + imperative render state ──────────────────────
  const dataRef = useRef<Map<string, Float32Array>>(new Map());
  const pyramidRef = useRef<Map<string, DecimationPyramid>>(new Map());
  const domainRef = useRef<Map<string, { min: number; max: number }>>(new Map());
  const scratchRef = useRef<Map<string, CpapLaneScratch>>(new Map());
  const eventMarkersRef = useRef<EventMarker[]>([]);
  const eventOffsetsRef = useRef<number[]>([]);
  const minimapEnvRef = useRef<{ min: Float32Array; max: Float32Array; columns: number } | null>(
    null,
  );
  const totalDurationRef = useRef(0);
  const wallClockEpochRef = useRef<number>(NaN);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<SignalRenderer | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef<number | null>(null);
  const widthRef = useRef(0);
  const lastVpRef = useRef<ViewportState | null>(null);
  const crosshairXRef = useRef<number | null>(null);
  const panRef = useRef<{ startX: number; startVp: ViewportRange } | null>(null);

  // Latest values mirrored into refs so the imperative paint/handlers read
  // current state without re-subscribing.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const hiddenLanesRef = useRef(hiddenLanes);
  hiddenLanesRef.current = hiddenLanes;
  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;

  const visibleLanes = useMemo(
    () => lanes.filter((l) => !hiddenLanes.has(l.name)),
    [lanes, hiddenLanes],
  );

  const plotHeight = Math.max(
    COMPACT_CHANNEL_HEIGHT + PADDING.top + PADDING.bottom,
    visibleLanes.length * COMPACT_CHANNEL_HEIGHT + PADDING.top + PADDING.bottom,
  );

  // ── Data load (OPFS) ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setErrorMsg(null);

    async function load() {
      if (!OPFSService.isSupported()) {
        if (!cancelled) setPhase('unsupported');
        return;
      }
      try {
        const opfs = new OPFSService();
        await opfs.initialize();
        const manifest = await opfs.readManifest(sessionId);
        const resolved = resolveCompactLanes(manifest);
        if (resolved.length === 0) {
          if (!cancelled) setPhase('empty');
          return;
        }

        const dataMap = new Map<string, Float32Array>();
        const domainMap = new Map<string, { min: number; max: number }>();
        for (const lane of resolved) {
          const data = await opfs.readChannel(sessionId, lane.name);
          if (cancelled) return;
          dataMap.set(lane.name, data);
          domainMap.set(lane.name, computeDomain(lane, data));
        }
        // Bail if every lane is empty.
        const anyData = [...dataMap.values()].some((d) => d.length > 0);
        if (!anyData) {
          if (!cancelled) setPhase('empty');
          return;
        }

        dataRef.current = dataMap;
        domainRef.current = domainMap;
        scratchRef.current = new Map(resolved.map((l) => [l.name, createLaneScratch()]));
        pyramidRef.current = new Map();
        totalDurationRef.current = manifest.durationSeconds * 1000;
        wallClockEpochRef.current = session
          ? sessionWallClockEpoch(session.startTime)
          : sessionWallClockEpoch(new Date(manifest.startTime).toISOString());

        if (cancelled) return;
        setLanes(resolved);
        setViewport({ startTime: 0, endTime: totalDurationRef.current });
        setActivePreset('whole');
        setPhase('ready');

        // Build pyramids + the minimap envelope AFTER first paint so the initial
        // CPAP frame is never blocked.
        requestAnimationFrame(() => {
          if (cancelled) return;
          const pyramids = new Map<string, DecimationPyramid>();
          for (const [name, data] of dataMap) {
            if (data.length > 0) pyramids.set(name, buildDecimationPyramid(data));
          }
          pyramidRef.current = pyramids;
          const flowLane = resolved.find((l) => l.name.toLowerCase() === 'flow') ?? resolved[0];
          const flowData = flowLane ? dataMap.get(flowLane.name) : undefined;
          if (flowData && flowData.length > 0) {
            const cols = Math.min(MINIMAP_ENV_COLUMNS, flowData.length);
            const min = new Float32Array(cols);
            const max = new Float32Array(cols);
            minimapEnvRef.current = buildMinimapEnvelope(flowData, cols, min, max);
          }
          schedulePaint();
        });
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to load signal data');
          setPhase('error');
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // session is intentionally excluded: the wall-clock epoch is re-derived from
    // the manifest when the session row is not yet hydrated, and a late session
    // load does not need to re-read OPFS.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Event markers + offsets (rebuilt on events / theme) ───────
  useEffect(() => {
    if (phase !== 'ready') return;
    const container = wrapperRef.current;
    const startMs = wallClockEpochRef.current;
    const sessionStartMs = session ? Date.parse(session.startTime) : NaN;
    const base = Number.isFinite(sessionStartMs) ? sessionStartMs : NaN;
    const markers: EventMarker[] = [];
    const offsets: number[] = [];
    for (const evt of events as Event[]) {
      const rel = Number.isFinite(base) ? evt.timestamp - base : evt.timestamp - startMs;
      offsets.push(rel);
      const colorVar = EVENT_TYPE_META[evt.type]?.color ?? DEFAULT_CHANNEL_COLOR;
      markers.push({
        startTime: rel,
        duration: evt.duration * 1000,
        type: evt.type,
        color: resolveColor(container, colorVar),
      });
    }
    eventMarkersRef.current = markers;
    eventOffsetsRef.current = offsets;
    schedulePaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, phase, resolvedTheme, session]);

  // ── Domain compute helper ─────────────────────────────────────
  function computeDomain(lane: CompactLane, data: Float32Array): { min: number; max: number } {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v === undefined || !isMeaningfulSample(lane.name, v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const dataMin = Number.isFinite(lo) ? lo : undefined;
    const dataMax = Number.isFinite(hi) ? hi : undefined;
    return computeLaneDomain({
      channelName: lane.name,
      unit: lane.descriptor.unit,
      declaredMin: lane.descriptor.physicalMin,
      declaredMax: lane.descriptor.physicalMax,
      ...(dataMin !== undefined ? { dataMin } : {}),
      ...(dataMax !== undefined ? { dataMax } : {}),
    });
  }

  // ── Render pipeline ───────────────────────────────────────────
  const baseOptions = useCallback(
    (): RenderOptions => ({
      showCrosshair: false,
      crosshairX: null,
      showGrid: true,
      eventMarkers: eventMarkersRef.current,
      channelHeight: COMPACT_CHANNEL_HEIGHT,
      padding: PADDING,
      ...(Number.isFinite(wallClockEpochRef.current)
        ? { axisWallClockEpochMs: wallClockEpochRef.current }
        : {}),
    }),
    [],
  );

  const buildChannels = useCallback((): SignalChannel[] => {
    const container = wrapperRef.current;
    const plotWidth = Math.max(0, widthRef.current - PADDING.left - PADDING.right);
    const targetPoints = Math.max(2, Math.round(plotWidth * DOWNSAMPLE_MULTIPLIER));
    const vp = viewportRef.current;
    const channels: SignalChannel[] = [];
    for (const lane of lanesRef.current) {
      if (hiddenLanesRef.current.has(lane.name)) continue;
      const data = dataRef.current.get(lane.name);
      if (!data || data.length === 0) continue;
      const domain = domainRef.current.get(lane.name);
      const ch = buildCpapChannelForViewport(
        {
          name: lane.label,
          data,
          ...(pyramidRef.current.get(lane.name)
            ? { pyramid: pyramidRef.current.get(lane.name) }
            : {}),
          color: resolveColor(container, lane.colorVar),
          unit: lane.descriptor.unit,
          physicalMin: domain?.min ?? lane.descriptor.physicalMin,
          physicalMax: domain?.max ?? lane.descriptor.physicalMax,
          totalDurationMs: totalDurationRef.current,
          targetPoints,
          plotWidth,
          range: vp,
        },
        scratchRef.current.get(lane.name),
      );
      if (ch) channels.push(ch);
    }
    return channels;
  }, []);

  const paint = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const channels = buildChannels();
    const vp: ViewportState = {
      startTime: viewportRef.current.startTime,
      endTime: viewportRef.current.endTime,
      channels,
    };
    lastVpRef.current = vp;
    renderer.render(vp, baseOptions());
    if (crosshairXRef.current !== null) {
      renderer.renderOverlay(vp, {
        ...baseOptions(),
        showCrosshair: true,
        crosshairX: crosshairXRef.current,
      });
    }
    paintMinimap();
  }, [buildChannels, baseOptions]);

  const paintRef = useRef(paint);
  paintRef.current = paint;

  const schedulePaint = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      paintRef.current();
    });
  }, []);

  // ── Minimap paint ─────────────────────────────────────────────
  function paintMinimap() {
    const canvas = minimapCanvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      // No 2D context (e.g. jsdom) — skip the minimap paint.
      return;
    }
    if (!ctx) return;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const cssW = widthRef.current;
    if (cssW <= 0) return;
    if (
      canvas.width !== Math.round(cssW * dpr) ||
      canvas.height !== Math.round(MINIMAP_HEIGHT * dpr)
    ) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(MINIMAP_HEIGHT * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const container = wrapperRef.current;
    ctx.clearRect(0, 0, cssW, MINIMAP_HEIGHT);
    ctx.fillStyle = resolveColor(container, 'var(--color-surface-secondary)');
    ctx.fillRect(0, 0, cssW, MINIMAP_HEIGHT);

    const dur = totalDurationRef.current;
    if (dur <= 0) return;

    // Flow envelope (whole night).
    const env = minimapEnvRef.current;
    if (env && env.columns > 0) {
      const midY = MINIMAP_HEIGHT / 2;
      const half = (MINIMAP_HEIGHT - 8) / 2;
      const flowDomain = domainRef.current.get(
        lanesRef.current.find((l) => l.name.toLowerCase() === 'flow')?.name ?? '',
      );
      const dMin = flowDomain?.min ?? -60;
      const dMax = flowDomain?.max ?? 60;
      const range = dMax - dMin || 1;
      ctx.strokeStyle = resolveColor(container, 'var(--color-chart-1)');
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (let x = 0; x < cssW; x++) {
        const c = Math.min(env.columns - 1, Math.floor((x / cssW) * env.columns));
        const mn = env.min[c];
        const mx = env.max[c];
        if (mn === undefined || mx === undefined || Number.isNaN(mn) || Number.isNaN(mx)) continue;
        const yTop = midY - ((mx - dMin) / range - 0.5) * 2 * half;
        const yBot = midY - ((mn - dMin) / range - 0.5) * 2 * half;
        ctx.moveTo(x + 0.5, yTop);
        ctx.lineTo(x + 0.5, yBot);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Event ticks along the bottom.
    ctx.fillStyle = resolveColor(container, 'var(--color-status-severe)');
    ctx.globalAlpha = 0.5;
    for (const off of eventOffsetsRef.current) {
      const x = (off / dur) * cssW;
      if (x < 0 || x > cssW) continue;
      ctx.fillRect(x, MINIMAP_HEIGHT - 4, 1, 4);
    }
    ctx.globalAlpha = 1;

    // View-window rectangle.
    const vp = viewportRef.current;
    const x0 = (vp.startTime / dur) * cssW;
    const x1 = (vp.endTime / dur) * cssW;
    ctx.fillStyle = resolveColor(container, 'var(--color-chart-1)');
    ctx.globalAlpha = 0.14;
    ctx.fillRect(x0, 0, Math.max(2, x1 - x0), MINIMAP_HEIGHT);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = resolveColor(container, 'var(--color-border-emphasis)');
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, 0.5, Math.max(2, x1 - x0) - 1, MINIMAP_HEIGHT - 1);
  }

  // ── Renderer lifecycle (mirrors TrendsCanvasChart) ────────────
  const tryInitRenderer = useCallback(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas || rendererRef.current) return;
    let renderer: SignalRenderer;
    try {
      renderer = new SignalRenderer(canvas);
    } catch {
      // No 2D context available — leave the renderer null; the card chrome
      // still renders. (Real browsers always provide a context.)
      return;
    }
    rendererRef.current = renderer;
    if (overlayCanvasRef.current) renderer.setOverlayCanvas(overlayCanvasRef.current);

    const wrapper = plotRef.current ?? canvas.parentElement;
    if (wrapper && !observerRef.current) {
      let pending: number | null = null;
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) widthRef.current = entry.contentRect.width;
        if (pending !== null) return;
        pending = requestAnimationFrame(() => {
          pending = null;
          const w = widthRef.current;
          const r = rendererRef.current;
          if (r && w > 0) {
            r.resize(w, plotHeightRef.current);
            paintRef.current();
          }
        });
      });
      observer.observe(wrapper);
      observerRef.current = observer;
      const rect = wrapper.getBoundingClientRect();
      if (rect.width > 0) {
        widthRef.current = rect.width;
        renderer.resize(rect.width, plotHeightRef.current);
        paintRef.current();
      }
    }
  }, []);

  const teardownRenderer = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const r = rendererRef.current;
    if (r) r.dispose();
    rendererRef.current = null;
  }, []);

  const plotHeightRef = useRef(plotHeight);
  plotHeightRef.current = plotHeight;

  const baseCallbackRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      baseCanvasRef.current = canvas;
      if (!canvas) {
        teardownRenderer();
        return;
      }
      tryInitRenderer();
    },
    [tryInitRenderer, teardownRenderer],
  );

  const overlayCallbackRef = useCallback((canvas: HTMLCanvasElement | null) => {
    overlayCanvasRef.current = canvas;
    const r = rendererRef.current;
    if (r) r.setOverlayCanvas(canvas);
  }, []);

  // Resize + repaint on viewport / lane visibility / theme / height change.
  useEffect(() => {
    if (phase !== 'ready') return;
    const r = rendererRef.current;
    if (r && widthRef.current > 0) r.resize(widthRef.current, plotHeight);
    schedulePaint();
  }, [viewport, hiddenLanes, resolvedTheme, plotHeight, phase, schedulePaint]);

  // Cancel any pending rAF on unmount (renderer disposed via callback ref).
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  // ── Viewport mutation helpers ─────────────────────────────────
  const applyViewport = useCallback((next: ViewportRange, preset: Preset | null) => {
    viewportRef.current = next;
    setViewport(next);
    setActivePreset(preset);
  }, []);

  const applyPreset = useCallback(
    (preset: Preset) => {
      const dur = totalDurationRef.current;
      if (dur <= 0) return;
      if (preset === 'whole') {
        applyViewport({ startTime: 0, endTime: dur }, 'whole');
        return;
      }
      if (preset === 'cluster') {
        const center =
          focusTime !== undefined && Number.isFinite(focusTime)
            ? clampWindow(focusTime, CLUSTER_WINDOW_MS, dur)
            : computeClusterWindow(eventOffsetsRef.current, dur, CLUSTER_WINDOW_MS);
        applyViewport(center ?? clampWindow(dur / 2, CLUSTER_WINDOW_MS, dur), 'cluster');
        return;
      }
      // breath: centre on the current viewport midpoint.
      const mid = (viewportRef.current.startTime + viewportRef.current.endTime) / 2;
      applyViewport(clampWindow(mid, BREATH_WINDOW_MS, dur), 'breath');
    },
    [applyViewport, focusTime],
  );

  // ── Wheel-zoom (native, non-passive) ──────────────────────────
  useEffect(() => {
    const el = plotRef.current;
    if (!el || phase !== 'ready') return;
    const onWheel = (e: WheelEvent) => {
      const dur = totalDurationRef.current;
      if (dur <= 0) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const plotWidth = rect.width - PADDING.left - PADDING.right;
      if (plotWidth <= 0) return;
      const cursorFraction = (e.clientX - rect.left - PADDING.left) / plotWidth;
      const factor = wheelDeltaToZoomFactor(e.deltaY, e.deltaMode);
      const next = applyCursorAnchoredZoom(viewportRef.current, factor, cursorFraction, dur);
      applyViewport(next, null);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [phase, applyViewport]);

  // ── Pointer interaction on the plot (hover crosshair + drag-pan) ──
  const updateReadout = useCallback(
    (x: number) => {
      const renderer = rendererRef.current;
      const vp = lastVpRef.current;
      if (!renderer || !vp) return;
      const opts = baseOptions();
      const values = renderer.getValuesAtTime(x, vp, opts);
      const time = renderer.getTimeAtX(x, vp, opts);
      const rows = values.map((v) => ({
        label: v.channel,
        value: `${v.value.toFixed(v.unit === '%' ? 0 : 1)} ${v.unit}`.trim(),
        color: v.color,
      }));
      const epoch = wallClockEpochRef.current;
      const timeStr = Number.isFinite(epoch)
        ? formatWallClockLabel(epoch, time, true)
        : `${Math.max(0, Math.round(time / 1000))}s`;
      const marker = eventMarkersRef.current.find(
        (m) => time >= m.startTime && time <= m.startTime + m.duration,
      );
      const eventLabel = marker
        ? (EVENT_TYPE_META[marker.type as EventType]?.label ?? marker.type)
        : null;
      setReadout({ time: timeStr, rows, event: eventLabel });
      renderer.renderOverlay(vp, { ...opts, showCrosshair: true, crosshairX: x });
    },
    [baseOptions],
  );

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = { startX: e.clientX, startVp: viewportRef.current };
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const pan = panRef.current;
      if (pan) {
        const dur = totalDurationRef.current;
        const plotWidth = rect.width - PADDING.left - PADDING.right;
        if (plotWidth <= 0 || dur <= 0) return;
        const span = pan.startVp.endTime - pan.startVp.startTime;
        const dtMs = -((e.clientX - pan.startX) / plotWidth) * span;
        let start = pan.startVp.startTime + dtMs;
        let end = start + span;
        if (start < 0) {
          start = 0;
          end = span;
        }
        if (end > dur) {
          end = dur;
          start = Math.max(0, end - span);
        }
        crosshairXRef.current = null;
        setReadout(null);
        applyViewport({ startTime: start, endTime: end }, null);
        return;
      }
      const x = e.clientX - rect.left;
      crosshairXRef.current = x;
      updateReadout(x);
    },
    [applyViewport, updateReadout],
  );

  const endPan = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be released */
      }
      panRef.current = null;
    }
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (panRef.current) return;
    crosshairXRef.current = null;
    setReadout(null);
    const renderer = rendererRef.current;
    const vp = lastVpRef.current;
    if (renderer && vp) {
      renderer.renderOverlay(vp, { ...baseOptions(), showCrosshair: false, crosshairX: null });
    }
  }, [baseOptions]);

  // ── Minimap interaction (click / drag to recenter) ────────────
  const minimapSeek = useCallback(
    (clientX: number, el: HTMLElement) => {
      const dur = totalDurationRef.current;
      if (dur <= 0) return;
      const rect = el.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const span = viewportRef.current.endTime - viewportRef.current.startTime;
      applyViewport(clampWindow(frac * dur, span, dur), activePreset);
    },
    [applyViewport, activePreset],
  );

  const minimapPanRef = useRef(false);
  const handleMinimapDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      minimapPanRef.current = true;
      minimapSeek(e.clientX, e.currentTarget);
    },
    [minimapSeek],
  );
  const handleMinimapMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!minimapPanRef.current) return;
      minimapSeek(e.clientX, e.currentTarget);
    },
    [minimapSeek],
  );
  const handleMinimapUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!minimapPanRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    minimapPanRef.current = false;
  }, []);

  // Keyboard operability for the minimap slider (WCAG 2.1.1 / 4.1.2). Moves the
  // view window without changing its span: Arrow keys nudge, PageUp/Down page by
  // a full window, Home/End jump to session start/end. Mirrors `minimapSeek`'s
  // clamp-window semantics so pointer and keyboard stay consistent.
  const handleMinimapKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      const dur = totalDurationRef.current;
      if (dur <= 0) return;
      const vp = viewportRef.current;
      const span = vp.endTime - vp.startTime;
      const center = (vp.startTime + vp.endTime) / 2;
      const smallStep = span * 0.25;
      const largeStep = span;
      let nextCenter: number;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          nextCenter = center - smallStep;
          break;
        case 'ArrowRight':
        case 'ArrowUp':
          nextCenter = center + smallStep;
          break;
        case 'PageDown':
          nextCenter = center - largeStep;
          break;
        case 'PageUp':
          nextCenter = center + largeStep;
          break;
        case 'Home':
          nextCenter = 0;
          break;
        case 'End':
          nextCenter = dur;
          break;
        default:
          return;
      }
      e.preventDefault();
      applyViewport(clampWindow(nextCenter, span, dur), activePreset);
    },
    [applyViewport, activePreset],
  );

  // ── Chip toggle ───────────────────────────────────────────────
  const toggleLane = useCallback((name: string) => {
    setHiddenLanes((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // ── Derived UI text ───────────────────────────────────────────
  const rangeText = useMemo(() => {
    const dur = totalDurationRef.current;
    const span = viewport.endTime - viewport.startTime;
    if (dur <= 0) return '';
    if (span >= dur * WHOLE_NIGHT_FRACTION) return `whole night · ${formatSpan(span)}`;
    const epoch = wallClockEpochRef.current;
    if (Number.isFinite(epoch)) {
      const a = formatWallClockLabel(epoch, viewport.startTime, false);
      const b = formatWallClockLabel(epoch, viewport.endTime, false);
      return `${a} – ${b} · ${formatSpan(span)}`;
    }
    return `${formatSpan(viewport.startTime)} – ${formatSpan(viewport.endTime)} · ${formatSpan(span)}`;
  }, [viewport]);

  // ── Render ────────────────────────────────────────────────────
  const presets: { id: Preset; label: string }[] = [
    { id: 'whole', label: 'Whole night' },
    { id: 'cluster', label: 'Event cluster' },
    { id: 'breath', label: 'Breath detail' },
  ];

  return (
    <section
      ref={wrapperRef}
      className={styles.card}
      aria-label="Signals"
      data-testid="compact-signal-viewer"
    >
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <Icon name="trends" size="sm" />
          <h2 className={styles.title}>Signals</h2>
          <span className={styles.subtitle}>Full-resolution · scroll to zoom, drag to pan</span>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.presetGroup} role="group" aria-label="Zoom preset">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className={styles.presetButton}
                aria-pressed={activePreset === p.id}
                data-active={activePreset === p.id}
                onClick={() => applyPreset(p.id)}
                disabled={phase !== 'ready'}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => navigate(`/sessions/${sessionId}/signals`)}
          >
            <span aria-hidden="true">⤢</span> Full explorer
          </button>
        </div>
      </header>

      {phase === 'loading' && (
        <div className={styles.body} data-testid="compact-signal-loading">
          <Skeleton variant="rect" height={20} width="60%" />
          <Skeleton variant="rect" height={COMPACT_CHANNEL_HEIGHT * 3} />
          <Skeleton variant="rect" height={MINIMAP_HEIGHT} />
        </div>
      )}

      {phase === 'unsupported' && (
        <p className={styles.message} role="status">
          Signal data cannot be displayed because this browser does not support the Origin Private
          File System.
        </p>
      )}

      {phase === 'empty' && (
        <p className={styles.message} role="status">
          No signal waveforms are stored for this session.
        </p>
      )}

      {phase === 'error' && (
        <p className={styles.message} role="alert">
          {errorMsg ?? 'Failed to load signal data.'}
        </p>
      )}

      {phase === 'ready' && (
        <div className={styles.body}>
          <div className={styles.controlRow}>
            <div className={styles.chips} role="group" aria-label="Toggle channels">
              {lanes.map((lane) => {
                const on = !hiddenLanes.has(lane.name);
                return (
                  <button
                    key={lane.name}
                    type="button"
                    className={styles.chip}
                    data-off={!on}
                    aria-pressed={on}
                    onClick={() => toggleLane(lane.name)}
                  >
                    <span
                      className={styles.chipDot}
                      style={{ backgroundColor: lane.colorVar }}
                      aria-hidden="true"
                    />
                    {lane.label}
                  </button>
                );
              })}
            </div>
            <span className={styles.rangeReadout} aria-live="polite">
              {rangeText}
            </span>
          </div>

          <div
            ref={plotRef}
            className={styles.plot}
            style={{ height: plotHeight }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endPan}
            onPointerLeave={handlePointerLeave}
            role="img"
            aria-label={`Signal waveforms, ${rangeText}`}
          >
            <canvas ref={baseCallbackRef} className={styles.canvas} aria-hidden="true" />
            <canvas ref={overlayCallbackRef} className={styles.overlayCanvas} aria-hidden="true" />
            {readout && (
              <div className={styles.floatingReadout} aria-hidden="true">
                <div className={styles.readoutTime}>{readout.time}</div>
                {readout.rows.map((r) => (
                  <div key={r.label} className={styles.readoutRow}>
                    <span className={styles.readoutSwatch} style={{ backgroundColor: r.color }} />
                    <span className={styles.readoutLabel}>{r.label}</span>
                    <span className={styles.readoutValue}>{r.value}</span>
                  </div>
                ))}
                {readout.event && <div className={styles.readoutEvent}>{readout.event}</div>}
              </div>
            )}
          </div>

          <canvas
            ref={minimapCanvasRef}
            className={styles.minimap}
            style={{ height: MINIMAP_HEIGHT }}
            onPointerDown={handleMinimapDown}
            onPointerMove={handleMinimapMove}
            onPointerUp={handleMinimapUp}
            onKeyDown={handleMinimapKeyDown}
            aria-label="Whole-night overview. Use arrow keys to move the view window, Page Up/Down to page, Home/End to jump to the start or end."
            role="slider"
            aria-valuemin={0}
            aria-valuemax={Math.round(totalDurationRef.current / 1000)}
            aria-valuenow={Math.round(viewport.startTime / 1000)}
            aria-valuetext={rangeText}
            tabIndex={0}
          />

          <ul className={styles.legend} aria-label="Event colour legend">
            {LEGEND_EVENT_TYPES.map((type) => (
              <li key={type} className={styles.legendItem}>
                <span
                  className={styles.legendSwatch}
                  style={{ backgroundColor: EVENT_TYPE_META[type]?.color ?? DEFAULT_CHANNEL_COLOR }}
                  aria-hidden="true"
                />
                {EVENT_TYPE_META[type]?.label ?? type}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
