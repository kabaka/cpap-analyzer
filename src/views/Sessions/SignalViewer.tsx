/**
 * Signal Viewer — interactive multi-channel waveform display with aligned
 * wearable health lanes and a sleep hypnogram.
 *
 * Renders high-frequency (25–50 Hz) CPAP signal data (Flow, MaskPressure,
 * Leak, SpO₂) as stacked Canvas 2D waveforms with zoom, pan, and crosshair
 * controls, and overlays intraday wearable signals (heart rate, SpO₂, HRV,
 * snoring) plus a sleep hypnogram on the same session-relative time axis.
 *
 * Data flow:
 * 1. Session metadata + events loaded from IndexedDB via hooks.
 * 2. Full CPAP signal data preloaded from OPFS into memory on mount and painted
 *    FIRST — wearable I/O never blocks the first CPAP paint (performance #3).
 * 3. Wearable lanes hydrate in a follow-up effect once CPAP data is ready.
 * 4. Viewport slices derived synchronously and downsampled via synchronous LTTB
 *    for CPAP; wearable/hypnogram lanes are low-rate and rendered directly.
 * 5. Rendered by {@link SignalRenderer} on a Canvas element; lane HEADERS are
 *    HTML overlay elements positioned over the canvas for keyboard/AT access.
 *
 * Wearable↔CPAP time alignment is documented in {@link module:views/Sessions/signalLanes}.
 *
 * @module views/Sessions/SignalViewer
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { SignalRenderer } from '@/components/charts/canvas/SignalRenderer';
import {
  computeLaneLayout,
  type EventMarker,
  type RenderOptions,
  type RibbonBand,
  type SignalChannel,
  type ViewportState,
} from '@/components/charts/canvas/SignalRenderer';
import { Button, Dialog, Skeleton, Switch } from '@/components/ui';
import { useSessionDetail, useEventData } from '@/hooks/useSignalData';
import { useWearableLanes, type WearableSeries } from '@/hooks/useWearableLanes';
import type { SignalManifest, ChannelDescriptor } from '@/services/storage/OPFSService';
import { OPFSService } from '@/services/storage/OPFSService';
import { lttbImpl } from '@/services/workers/downsample.worker';
import { useAppStore } from '@/stores/useAppStore';
import type { Event as TherapyEvent } from '@/types';

import { evaluateDeepLink } from './deepLinkGuard';
import {
  applyOrder,
  lanePrefsKey,
  moveLane,
  parseLanePrefs,
  toggleId,
  type LanePrefs,
} from './laneState';
import {
  buildWearableChannel,
  hypnogramBands,
  seriesHasData,
  sessionDateKey,
  sessionWallClockEpoch,
  WEARABLE_DATA_TYPES,
  WEARABLE_LANE_SPECS,
  type LaneDescriptor,
  type LaneGroup,
} from './signalLanes';
import styles from './SignalViewer.module.css';

// ── Constants ────────────────────────────────────────────────────

/** Chart palette — resolved at render time from CSS custom properties. */
const CHANNEL_COLORS: Record<string, string> = {
  flow: 'var(--color-chart-1)',
  maskPressure: 'var(--color-chart-2)',
  leak: 'var(--color-chart-3)',
  spo2: 'var(--color-chart-4)',
  epap: 'var(--color-chart-5)',
  ipap: 'var(--color-chart-6)',
};

/** Fallback colour if channel name isn't in the map. */
const DEFAULT_CHANNEL_COLOR = 'var(--color-chart-7)';

/** Event type → colour mapping (matches SessionDetail). */
const EVENT_COLORS: Record<string, string> = {
  ObstructiveApnea: 'var(--color-status-severe)',
  CentralApnea: 'var(--color-status-moderate)',
  MixedApnea: 'var(--color-status-moderate)',
  Hypopnea: 'var(--color-status-mild)',
  RERA: 'var(--color-chart-4)',
  FlowLimitation: 'var(--color-chart-5)',
  LargeLeak: 'var(--color-chart-6)',
  PeriodicBreathing: 'var(--color-chart-5)',
  ClearAirway: 'var(--color-chart-3)',
  Vibratory: 'var(--color-text-muted)',
  ChecksumError: 'var(--color-text-muted)',
};

/** Zoom presets: label → duration in ms. */
const ZOOM_PRESETS: readonly { label: string; ms: number | null }[] = [
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '1h', ms: 3_600_000 },
  { label: 'All', ms: null },
];

/** Zoom factor per wheel notch. */
const ZOOM_FACTOR = 1.5;

/** Minimum visible time window in ms (0.5 second). */
const MIN_VIEWPORT_MS = 500;

/** Default pixel height per CPAP channel strip. */
const CHANNEL_HEIGHT = 150;

/** Canvas padding. */
const PADDING = { top: 20, right: 24, bottom: 28, left: 56 } as const;

/** Number of viewport pixels to downsample target. */
const DOWNSAMPLE_MULTIPLIER = 2;

/** Lane drawer presets — id → set of lane ids to show (others hidden). */
interface LanePreset {
  readonly id: string;
  readonly label: string;
  /** Predicate selecting which lane ids should be visible. */
  readonly match: (lane: LaneDescriptor) => boolean;
}

const LANE_PRESETS: readonly LanePreset[] = [
  {
    id: 'respiratory',
    label: 'Respiratory focus',
    match: (l) => l.group === 'cpap',
  },
  {
    id: 'cardio',
    label: 'Cardio focus',
    match: (l) =>
      l.id === 'cpap:flow' ||
      l.id === 'wear:heart_rate_intraday' ||
      l.id === 'wear:spo2_intraday' ||
      l.id === 'cpap:spo2',
  },
  {
    id: 'sleep',
    label: 'Sleep architecture',
    match: (l) => l.group === 'sleep' || l.id === 'wear:heart_rate_intraday',
  },
  {
    id: 'everything',
    label: 'Everything',
    match: () => true,
  },
];

// ── Types ────────────────────────────────────────────────────────

/** Full channel data stored in memory for the entire session. */
interface FullChannelData {
  descriptor: ChannelDescriptor;
  data: Float32Array;
}

interface ViewportRange {
  startTime: number; // ms offset from session signal start
  endTime: number; // ms offset from session signal start
}

// ── Resolve CSS custom property to a computed colour value ────────

function resolveColor(el: HTMLElement | null, varExpr: string): string {
  if (!el) return varExpr;
  const match = /^var\(([^)]+)\)$/.exec(varExpr);
  if (!match) return varExpr;
  const resolved = getComputedStyle(el)
    .getPropertyValue(match[1] ?? '')
    .trim();
  return resolved || varExpr;
}

/** Resolve a CSS length token (e.g. `--signal-lane-height-hero`) to px. */
function resolveLengthPx(el: HTMLElement | null, token: string, fallback: number): number {
  if (!el) return fallback;
  const raw = getComputedStyle(el).getPropertyValue(token).trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

// ── Build event markers from therapy events ──────────────────────

function buildEventMarkers(
  events: TherapyEvent[],
  sessionStartMs: number,
  containerEl: HTMLElement | null,
): EventMarker[] {
  return events.map((evt) => ({
    startTime: evt.timestamp - sessionStartMs,
    duration: evt.duration * 1000,
    type: evt.type,
    color: resolveColor(containerEl, EVENT_COLORS[evt.type] ?? 'var(--color-chart-7)'),
  }));
}

// ── Format event type for display ────────────────────────────────

function formatEventType(type: string): string {
  return type.replace(/([A-Z])/g, ' $1').trim();
}

// ── Component ────────────────────────────────────────────────────

export default function SignalViewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  /**
   * Optional deep-link target: `?t=<epochMs>` centers the initial viewport
   * around the given absolute timestamp (e.g. when arriving from the Event
   * Explorer's event table). Parsed once; `null` when absent/invalid.
   */
  const deepLinkTargetMs = useMemo(() => {
    const raw = searchParams.get('t');
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, [searchParams]);

  // ── Session + event data from IndexedDB ──────────────────────
  const { session, loading: sessionLoading, error: sessionError } = useSessionDetail(sessionId);
  const { events, loading: eventsLoading, error: eventsError } = useEventData(sessionId);

  // ── Refs ─────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SignalRenderer | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const opfsRef = useRef<OPFSService | null>(null);

  /** Full CPAP session signal data preloaded into memory. */
  const fullDataRef = useRef<Map<string, FullChannelData>>(new Map());

  /** Crosshair X position — bypasses React state for zero-latency rendering. */
  const crosshairXRef = useRef<number | null>(null);

  /** Last-rendered viewport and options — used by pointer handler for direct renders. */
  const lastViewportRef = useRef<ViewportState | null>(null);
  const lastOptionsRef = useRef<RenderOptions | null>(null);

  // ── State ────────────────────────────────────────────────────
  const [manifest, setManifest] = useState<SignalManifest | null>(null);
  const [viewport, setViewport] = useState<ViewportRange>({ startTime: 0, endTime: 0 });
  const [totalDurationMs, setTotalDurationMs] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [fullDataReady, setFullDataReady] = useState(false);

  // Interaction state
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; viewport: ViewportRange } | null>(null);

  // Canvas dimensions
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [wrapperWidth, setWrapperWidth] = useState(0);

  /** CPAP channels detected as having no meaningful data (all NaN/zero). */
  const [emptyChannels, setEmptyChannels] = useState<Set<string>>(new Set());

  /** Lane prefs (order/hidden/collapsed/preset), persisted per session. */
  const [lanePrefs, setLanePrefs] = useState<LanePrefs>(() =>
    parseLanePrefs(sessionId ? localStorage.getItem(lanePrefsKey(sessionId)) : null),
  );

  /** Drawer open state. */
  const [drawerOpen, setDrawerOpen] = useState(false);

  /** Keyboard data-cursor time (session-relative ms), or null when inactive. */
  const cursorTimeRef = useRef<number | null>(null);

  /** aria-live readout text for the keyboard data cursor. */
  const [cursorReadout, setCursorReadout] = useState('');

  /** aria-live announcement for keyboard lane grab/move/drop reordering. */
  const [laneReorderAnnouncement, setLaneReorderAnnouncement] = useState('');

  /** Whether the "no wearable data connected" hint has been dismissed this view. */
  const [hintDismissed, setHintDismissed] = useState(false);

  // ── Derived values ───────────────────────────────────────────────

  const sessionStartMs = useMemo(
    () => (session ? new Date(session.startTime).getTime() : 0),
    [session],
  );

  /** Wall-clock-as-UTC epoch of the session start (wearable alignment base). */
  const wallClockEpoch = useMemo(
    () => (session ? sessionWallClockEpoch(session.startTime) : NaN),
    [session],
  );

  /** Calendar date to query wearable data for. */
  const wearableDate = useMemo(
    () => (session ? sessionDateKey(session.startTime) : null),
    [session],
  );

  const opfsSupported = useMemo(() => OPFSService.isSupported(), []);

  /**
   * Apply a `?t=` deep-link once the session data is ready: center a focused
   * window (±1 min) on the target timestamp.
   *
   * The applied-ref is only stamped when the target was actually IN-RANGE and
   * applied. An out-of-range target sets an "outside range" notice but does
   * NOT poison the ref, so a subsequent navigation that updates `t` can be
   * retried against fresh session bounds without being short-circuited.
   *
   * The decision is delegated to {@link evaluateDeepLink} so it can be
   * unit-tested without mounting this canvas-heavy component.
   */
  const appliedDeepLinkRef = useRef<number | null>(null);
  /** aria-live status when the deep-link target falls outside the session. */
  const [deepLinkStatus, setDeepLinkStatus] = useState('');
  useEffect(() => {
    const decision = evaluateDeepLink({
      deepLinkTargetMs,
      fullDataReady,
      totalDurationMs,
      session,
      sessionStartMs,
      appliedTarget: appliedDeepLinkRef.current,
    });
    if (decision.kind === 'apply') {
      setViewport({ startTime: decision.start, endTime: decision.end });
      setDeepLinkStatus('');
      appliedDeepLinkRef.current = deepLinkTargetMs;
    } else if (decision.kind === 'out-of-range') {
      setDeepLinkStatus(decision.message);
    }
  }, [deepLinkTargetMs, fullDataReady, totalDurationMs, sessionStartMs, session]);

  /**
   * Resolved theme name — used as a memo key so theme-resolved colours/heights
   * (read via getComputedStyle) re-resolve on theme change. Mirrors the signal
   * `useChartColors` keys on.
   */
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);

  // ── Wearable data hook (runs independently of CPAP load) ─────
  const {
    series: wearableSeries,
    loading: wearableLoading,
    error: wearableError,
  } = useWearableLanes(wearableDate, WEARABLE_DATA_TYPES);

  /** Whether any wearable series exists for this night. */
  const anyWearableData = useMemo(
    () => Object.values(wearableSeries).some((s) => seriesHasData(s)),
    [wearableSeries],
  );

  /** Whether NO external source has ever produced data for this date at all. */
  const noWearableConnected = useMemo(
    () => !wearableLoading && Object.keys(wearableSeries).length === 0,
    [wearableLoading, wearableSeries],
  );

  // ── Lane catalogue (CPAP + available wearable lanes) ─────────

  const cpapLanes = useMemo<LaneDescriptor[]>(() => {
    if (!manifest) return [];
    return manifest.channels.map((ch) => ({
      id: `cpap:${ch.name}`,
      name: ch.name,
      unit: ch.unit,
      group: 'cpap' as LaneGroup,
      pill: 'CPAP' as const,
      colorVar: CHANNEL_COLORS[ch.name] ?? DEFAULT_CHANNEL_COLOR,
      render: 'line' as const,
      heightVar: '--signal-lane-height',
      hasData: !emptyChannels.has(ch.name),
    }));
  }, [manifest, emptyChannels]);

  const wearableLanes = useMemo<LaneDescriptor[]>(() => {
    return WEARABLE_LANE_SPECS.map((spec) => {
      const series = wearableSeries[spec.dataType];
      return {
        id: `wear:${spec.dataType}`,
        name: spec.name,
        unit: spec.unit,
        group: spec.group,
        pill: spec.pill,
        colorVar: spec.colorVar,
        render: spec.render,
        heightVar: spec.heightVar,
        hasData: seriesHasData(series),
      };
    });
  }, [wearableSeries]);

  /** Full catalogue in catalogue order. */
  const allLanes = useMemo<LaneDescriptor[]>(
    () => [...cpapLanes, ...wearableLanes],
    [cpapLanes, wearableLanes],
  );

  /** Lane ids in their effective (persisted) order. */
  const orderedLaneIds = useMemo(
    () =>
      applyOrder(
        allLanes.map((l) => l.id),
        lanePrefs.order,
      ),
    [allLanes, lanePrefs.order],
  );

  const laneById = useMemo(() => {
    const m = new Map<string, LaneDescriptor>();
    for (const l of allLanes) m.set(l.id, l);
    return m;
  }, [allLanes]);

  const hiddenSet = useMemo(() => new Set(lanePrefs.hidden), [lanePrefs.hidden]);
  const collapsedSet = useMemo(() => new Set(lanePrefs.collapsed), [lanePrefs.collapsed]);

  /**
   * Lanes that are actually rendered, in order: visible (not hidden by the user),
   * with data (lanes with zero session data auto-hide). Includes collapsed lanes
   * (rendered as a short stub).
   */
  const visibleLaneIds = useMemo(
    () =>
      orderedLaneIds.filter((id) => {
        const lane = laneById.get(id);
        if (!lane || !lane.hasData) return false;
        return !hiddenSet.has(id);
      }),
    [orderedLaneIds, laneById, hiddenSet],
  );

  // ── Persist lane prefs ───────────────────────────────────────

  useEffect(() => {
    if (sessionId) {
      localStorage.setItem(lanePrefsKey(sessionId), JSON.stringify(lanePrefs));
    }
  }, [lanePrefs, sessionId]);

  // ── Initialize OPFS + preload all CPAP data into memory ──────

  useEffect(() => {
    if (!sessionId || !opfsSupported) return;

    let cancelled = false;
    const sid = sessionId;

    async function init() {
      setDataLoading(true);
      setDataError(null);
      setFullDataReady(false);
      setManifest(null);

      try {
        const opfs = new OPFSService();
        await opfs.initialize();
        opfsRef.current = opfs;

        const m = await opfs.readManifest(sid);
        if (cancelled) return;

        setManifest(m);
        const duration = m.durationSeconds * 1000;
        setTotalDurationMs(duration);
        setViewport({ startTime: 0, endTime: duration });

        const newFullData = new Map<string, FullChannelData>();
        await Promise.all(
          m.channels.map(async (chDesc) => {
            const data = await opfs.readChannel(sid, chDesc.name);
            if (!cancelled) {
              newFullData.set(chDesc.name, { descriptor: chDesc, data });
            }
          }),
        );

        if (!cancelled) {
          fullDataRef.current = newFullData;

          const detectedEmpty = new Set<string>();
          for (const [name, fcd] of newFullData) {
            const data = fcd.data;
            if (data.length === 0) {
              detectedEmpty.add(name);
              continue;
            }
            let hasMeaningful = false;
            for (let i = 0; i < data.length; i++) {
              const v = data[i];
              if (!Number.isNaN(v) && v !== 0) {
                hasMeaningful = true;
                break;
              }
            }
            if (!hasMeaningful) detectedEmpty.add(name);
          }
          setEmptyChannels(detectedEmpty);
          setFullDataReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setDataError(err instanceof Error ? err.message : 'Failed to load signal data');
        }
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [sessionId, opfsSupported]);

  // ── Initialize renderer + ResizeObserver via callback ref ────

  const canvasCallbackRef = useCallback((canvas: HTMLCanvasElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (rendererRef.current) {
      rendererRef.current.dispose();
      rendererRef.current = null;
    }

    canvasRef.current = canvas;
    if (!canvas) return;

    const renderer = new SignalRenderer(canvas);
    rendererRef.current = renderer;

    const wrapper = canvas.parentElement;
    if (!wrapper) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0) setWrapperWidth(width);
      }
    });
    observerRef.current = observer;
    observer.observe(wrapper);

    const rect = wrapper.getBoundingClientRect();
    if (rect.width > 0) setWrapperWidth(rect.width);
  }, []);

  // ── Resolve per-lane heights (for layout + canvas sizing) ────

  const laneHeights = useMemo(() => {
    const el = containerRef.current;
    const map = new Map<string, number>();
    for (const id of visibleLaneIds) {
      const lane = laneById.get(id);
      if (!lane) continue;
      const base = resolveLengthPx(el, lane.heightVar, CHANNEL_HEIGHT);
      const h = collapsedSet.has(id)
        ? resolveLengthPx(el, '--signal-lane-height-collapsed', 28)
        : base;
      map.set(id, h);
    }
    return map;
    // wrapperWidth included so heights re-resolve after the container mounts
    // (resolveLengthPx reads getComputedStyle, which only works post-mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLaneIds, laneById, collapsedSet, wrapperWidth]);

  /** Ordered list of rendered lane descriptors with their resolved heights. */
  const renderLanes = useMemo(
    () =>
      visibleLaneIds.map((id) => ({
        lane: laneById.get(id) as LaneDescriptor,
        height: laneHeights.get(id) ?? CHANNEL_HEIGHT,
        collapsed: collapsedSet.has(id),
      })),
    [visibleLaneIds, laneById, laneHeights, collapsedSet],
  );

  // ── Content-driven canvas sizing ─────────────────────────────

  const stackHeight = useMemo(
    () => renderLanes.reduce((sum, r) => sum + r.height, 0),
    [renderLanes],
  );

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || wrapperWidth <= 0) return;
    const contentHeight = PADDING.top + stackHeight + PADDING.bottom;
    const finalHeight = Math.max(contentHeight, 100);
    renderer.resize(wrapperWidth, finalHeight);
    setCanvasSize({ width: wrapperWidth, height: finalHeight });
  }, [wrapperWidth, stackHeight]);

  // ── Build CPAP channel for the current viewport ──────────────

  const buildCpapChannel = useCallback(
    (
      laneName: string,
      targetPoints: number,
      container: HTMLElement | null,
    ): SignalChannel | null => {
      const fcd = fullDataRef.current.get(laneName);
      if (!fcd || fcd.data.length === 0 || !manifest) return null;
      const desc = manifest.channels.find((c) => c.name === laneName);
      if (!desc) return null;

      const fullData = fcd.data;
      const totalSamples = fullData.length;
      const startFrac = viewport.startTime / totalDurationMs;
      const endFrac = viewport.endTime / totalDurationMs;
      const startSample = Math.floor(startFrac * totalSamples);
      const endSample = Math.min(Math.ceil(endFrac * totalSamples), totalSamples);
      const slice = fullData.subarray(startSample, endSample);
      const displayData = slice.length > targetPoints ? lttbImpl(slice, targetPoints) : slice;

      const viewDurationMs = viewport.endTime - viewport.startTime;
      const effectiveSampleRate =
        viewDurationMs > 0 ? (displayData.length / viewDurationMs) * 1000 : desc.sampleRate;

      const colorVar = CHANNEL_COLORS[laneName] ?? DEFAULT_CHANNEL_COLOR;
      return {
        name: laneName,
        data: displayData,
        sampleRate: effectiveSampleRate,
        unit: desc.unit,
        color: resolveColor(container, colorVar),
        physicalMin: desc.physicalMin,
        physicalMax: desc.physicalMax,
        kind: 'cpap',
        render: 'line',
      };
    },
    [manifest, viewport, totalDurationMs],
  );

  // ── Memoized base wearable channels (viewport-independent) ───
  //
  // Wearable lanes are projected onto a session-relative axis once; their sample
  // data and times do NOT change with pan/zoom. Rebuilding them per viewport
  // change (the drag-pan hot path) needlessly re-ran `toSessionRelative`,
  // allocating a Float32Array + Float64Array per lane every frame. We build the
  // base channels (everything EXCEPT the viewport-dependent `height`) once and
  // look them up in the render loop, spreading only `{ ...base, height }`.
  //
  // The build reads theme-resolved colours/line-widths/ribbon bands via
  // getComputedStyle(containerRef.current), so the memo is keyed on the resolved
  // theme (re-resolve on theme change) and on `wrapperWidth` (which flips to > 0
  // only once the container has mounted, so colours resolve against real styles
  // rather than the unresolved var() fallbacks).

  interface BaseWearableEntry {
    /** Base channel WITHOUT `height` (applied per-render). */
    readonly channel: Omit<SignalChannel, 'height'>;
    /** Ribbon bands for ribbon lanes (keyed by channel name in render options). */
    readonly ribbonBands?: readonly RibbonBand[];
  }

  const baseWearableChannels = useMemo(() => {
    const map = new Map<string, BaseWearableEntry>();
    if (!Number.isFinite(wallClockEpoch)) return map;

    const container = containerRef.current;
    const heroLineWidth = resolveLengthPx(container, '--signal-hero-line-width', 1.6);
    const secondaryLineWidth = resolveLengthPx(container, '--signal-secondary-line-width', 1);

    for (const spec of WEARABLE_LANE_SPECS) {
      const series = wearableSeries[spec.dataType] as WearableSeries | undefined;
      if (!series) continue;

      let channel: SignalChannel = buildWearableChannel(
        spec,
        series,
        wallClockEpoch,
        (cssVar) => resolveColor(container, cssVar),
        (token) => resolveLengthPx(container, token, CHANNEL_HEIGHT),
      );

      let ribbonBands: readonly RibbonBand[] | undefined;
      if (spec.render === 'ribbon') {
        ribbonBands = hypnogramBands((cssVar) => resolveColor(container, cssVar));
      }
      if (spec.dataType === 'heart_rate_intraday') {
        channel = { ...channel, lineWidth: heroLineWidth };
      } else if (spec.render === 'line') {
        channel = { ...channel, lineWidth: secondaryLineWidth };
      }

      // Drop the resolveHeight-derived height; the render loop applies the
      // viewport/collapse-aware height instead.
      const { height: _height, ...base } = channel;
      void _height;
      map.set(
        `wear:${spec.dataType}`,
        ribbonBands ? { channel: base, ribbonBands } : { channel: base },
      );
    }
    return map;
    // wrapperWidth + resolvedTheme drive re-resolution of getComputedStyle reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wearableSeries, wallClockEpoch, resolvedTheme, wrapperWidth]);

  // ── Build the full ordered channel list + render ─────────────

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !fullDataReady || !manifest) return;
    if (viewport.endTime <= viewport.startTime || totalDurationMs <= 0) return;

    const container = containerRef.current;
    const targetPoints = Math.max(100, Math.round(canvasSize.width * DOWNSAMPLE_MULTIPLIER));

    const channels: SignalChannel[] = [];
    const ribbonBands: Record<string, readonly RibbonBand[]> = {};

    for (const { lane, height } of renderLanes) {
      let channel: SignalChannel | null = null;

      if (lane.group === 'cpap') {
        channel = buildCpapChannel(lane.name, targetPoints, container);
      } else {
        // Wearable / sleep lane — look up the memoized, viewport-independent base.
        const base = baseWearableChannels.get(lane.id);
        if (base) {
          channel = { ...base.channel, height };
          if (base.ribbonBands) {
            ribbonBands[base.channel.name] = base.ribbonBands;
          }
          channels.push(channel);
          continue;
        }
      }

      if (!channel) continue;
      // Apply the resolved (possibly collapsed) lane height. `height` already
      // encodes the collapsed state (resolved in `laneHeights`).
      channels.push({ ...channel, height });
    }

    const viewportState: ViewportState = {
      startTime: viewport.startTime,
      endTime: viewport.endTime,
      channels,
    };

    const eventMarkers = buildEventMarkers(events, sessionStartMs, container);
    const currentCrosshairX = crosshairXRef.current;
    const options: RenderOptions = {
      showCrosshair: currentCrosshairX !== null,
      crosshairX: currentCrosshairX,
      showGrid: true,
      eventMarkers,
      ribbonBands,
      channelHeight: CHANNEL_HEIGHT,
      padding: PADDING,
    };

    lastViewportRef.current = viewportState;
    lastOptionsRef.current = options;
    renderer.render(viewportState, options);
  }, [
    fullDataReady,
    manifest,
    viewport,
    totalDurationMs,
    events,
    sessionStartMs,
    canvasSize,
    renderLanes,
    buildCpapChannel,
    baseWearableChannels,
  ]);

  // ── Lane mutations ───────────────────────────────────────────

  const toggleLane = useCallback((laneId: string) => {
    setLanePrefs((prev) => ({ ...prev, hidden: toggleId(prev.hidden, laneId), preset: undefined }));
  }, []);

  const toggleCollapse = useCallback((laneId: string) => {
    setLanePrefs((prev) => ({ ...prev, collapsed: toggleId(prev.collapsed, laneId) }));
  }, []);

  const reorderLane = useCallback(
    (laneId: string, direction: -1 | 1) => {
      setLanePrefs((prev) => {
        const ordered = applyOrder(
          allLanes.map((l) => l.id),
          prev.order,
        );
        const from = ordered.indexOf(laneId);
        if (from < 0) return prev;
        const next = moveLane(ordered, from, from + direction);
        return { ...prev, order: next };
      });
    },
    [allLanes],
  );

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = LANE_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      const hidden = allLanes.filter((l) => !preset.match(l)).map((l) => l.id);
      setLanePrefs((prev) => ({ ...prev, hidden, preset: presetId }));
    },
    [allLanes],
  );

  // ── Keyboard reorder (roving grab) ───────────────────────────

  const [grabbedLane, setGrabbedLane] = useState<string | null>(null);

  /**
   * Position (1-based) of a lane within the visible stack, and the stack size,
   * for screen-reader announcements. Uses the rendered (visible) order so the
   * announced position matches what a sighted user perceives.
   */
  const visiblePositionOf = useCallback(
    (laneId: string): { position: number; total: number } => {
      const idx = visibleLaneIds.indexOf(laneId);
      return { position: idx + 1, total: visibleLaneIds.length };
    },
    [visibleLaneIds],
  );

  const handleHeaderKeyDown = useCallback(
    (e: React.KeyboardEvent, laneId: string) => {
      const lane = laneById.get(laneId);
      const laneName = lane?.name ?? 'Lane';

      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        const nextGrabbed = grabbedLane === laneId ? null : laneId;
        const { position, total } = visiblePositionOf(laneId);
        setGrabbedLane(nextGrabbed);
        // Announce grab on pick-up, drop on release.
        setLaneReorderAnnouncement(
          nextGrabbed
            ? `${laneName} grabbed, position ${position} of ${total}. Use Arrow Up and Arrow Down to move, Space to drop.`
            : `${laneName} dropped at position ${position} of ${total}.`,
        );
        return;
      }
      if (grabbedLane === laneId && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        reorderLane(laneId, e.key === 'ArrowUp' ? -1 : 1);
      }
    },
    [grabbedLane, reorderLane, laneById, visiblePositionOf],
  );

  // Announce each move while a lane is grabbed. `visibleLaneIds` recomputes after
  // `reorderLane` updates the order, so this fires once the new position settles.
  // A null reset guards against re-announcing the same string on unrelated renders.
  const lastAnnouncedMoveRef = useRef<string | null>(null);
  useEffect(() => {
    if (!grabbedLane) {
      lastAnnouncedMoveRef.current = null;
      return;
    }
    const lane = laneById.get(grabbedLane);
    const laneName = lane?.name ?? 'Lane';
    const idx = visibleLaneIds.indexOf(grabbedLane);
    if (idx < 0) return;
    const message = `${laneName} moved to position ${idx + 1} of ${visibleLaneIds.length}.`;
    // Only announce when the position actually changed (skip the initial grab,
    // which is announced by the Space handler).
    const positionKey = `${grabbedLane}:${idx}:${visibleLaneIds.length}`;
    if (lastAnnouncedMoveRef.current === null) {
      lastAnnouncedMoveRef.current = positionKey;
      return;
    }
    if (lastAnnouncedMoveRef.current !== positionKey) {
      lastAnnouncedMoveRef.current = positionKey;
      setLaneReorderAnnouncement(message);
    }
  }, [grabbedLane, visibleLaneIds, laneById]);

  // ── Zoom handler (native wheel listener for passive: false) ───

  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (totalDurationMs <= 0) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const cursorX = e.clientX - rect.left;
      const plotLeft = PADDING.left;
      const plotWidth = rect.width - PADDING.left - PADDING.right;
      if (plotWidth <= 0) return;

      const cursorFrac = Math.max(0, Math.min(1, (cursorX - plotLeft) / plotWidth));

      setViewport((prev) => {
        const cursorTimeMs = prev.startTime + cursorFrac * (prev.endTime - prev.startTime);
        const zoomIn = e.deltaY < 0;
        const factor = zoomIn ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
        const currentDuration = prev.endTime - prev.startTime;
        let newDuration = currentDuration * factor;
        newDuration = Math.max(MIN_VIEWPORT_MS, Math.min(totalDurationMs, newDuration));

        let newStart = cursorTimeMs - cursorFrac * newDuration;
        let newEnd = newStart + newDuration;
        if (newStart < 0) {
          newStart = 0;
          newEnd = newDuration;
        }
        if (newEnd > totalDurationMs) {
          newEnd = totalDurationMs;
          newStart = Math.max(0, newEnd - newDuration);
        }
        return { startTime: newStart, endTime: newEnd };
      });
    };

    wrapper.addEventListener('wheel', onWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', onWheel);
  }, [totalDurationMs]);

  // ── Pan + crosshair handlers ─────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, viewport: { ...viewport } };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [viewport],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      crosshairXRef.current = x;

      const renderer = rendererRef.current;
      if (renderer && lastViewportRef.current && lastOptionsRef.current) {
        renderer.render(lastViewportRef.current, {
          ...lastOptionsRef.current,
          showCrosshair: true,
          crosshairX: x,
        });
      }

      if (isPanning && panStartRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const plotWidth = rect.width - PADDING.left - PADDING.right;
        if (plotWidth <= 0) return;
        const startVP = panStartRef.current.viewport;
        const vpDuration = startVP.endTime - startVP.startTime;
        const timeDelta = -(dx / plotWidth) * vpDuration;
        let newStart = startVP.startTime + timeDelta;
        let newEnd = startVP.endTime + timeDelta;
        if (newStart < 0) {
          newStart = 0;
          newEnd = vpDuration;
        }
        if (newEnd > totalDurationMs) {
          newEnd = totalDurationMs;
          newStart = Math.max(0, newEnd - vpDuration);
        }
        setViewport({ startTime: newStart, endTime: newEnd });
      }
    },
    [isPanning, totalDurationMs],
  );

  const handlePointerUp = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  const handlePointerLeave = useCallback(() => {
    crosshairXRef.current = null;
    const renderer = rendererRef.current;
    if (renderer && lastViewportRef.current && lastOptionsRef.current) {
      renderer.render(lastViewportRef.current, {
        ...lastOptionsRef.current,
        showCrosshair: false,
        crosshairX: null,
      });
    }
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
    }
  }, [isPanning]);

  // ── Keyboard data cursor (arrow keys move crosshair) ─────────

  /** Build a multi-lane readout string for an aria-live announcement. */
  const announceAtTime = useCallback(
    (timeMs: number) => {
      const renderer = rendererRef.current;
      const vp = lastViewportRef.current;
      const opts = lastOptionsRef.current;
      if (!renderer || !vp || !opts) return;

      const plotLeft = PADDING.left;
      const plotWidth = canvasSize.width - PADDING.left - PADDING.right;
      if (plotWidth <= 0) return;
      const frac = (timeMs - vp.startTime) / (vp.endTime - vp.startTime);
      const x = plotLeft + frac * plotWidth;
      crosshairXRef.current = x;
      renderer.render(vp, { ...opts, showCrosshair: true, crosshairX: x });

      const values = renderer.getValuesAtTime(x, vp, opts);
      const parts = values.map((v) => {
        if (v.label !== undefined) return `${v.channel} ${v.label}`;
        return `${v.channel} ${v.value.toFixed(1)} ${v.unit}`.trim();
      });
      const elapsedSec = Math.round(timeMs / 1000);
      setCursorReadout(`At ${elapsedSec}s: ${parts.join('; ') || 'no data'}`);
    },
    [canvasSize.width],
  );

  const handleCanvasKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const vp = lastViewportRef.current;
      if (!vp) return;
      const span = vp.endTime - vp.startTime;
      if (span <= 0) return;

      // Step by ~1/200th of the viewport (one "sample" at display resolution),
      // or a coarser step with Shift held.
      const step = (span / 200) * (e.shiftKey ? 10 : 1);
      const base = cursorTimeRef.current ?? vp.startTime + span / 2;
      const next = Math.max(
        vp.startTime,
        Math.min(vp.endTime, base + (e.key === 'ArrowRight' ? step : -step)),
      );
      cursorTimeRef.current = next;
      announceAtTime(next);
    },
    [announceAtTime],
  );

  const handleCanvasBlur = useCallback(() => {
    cursorTimeRef.current = null;
    crosshairXRef.current = null;
    const renderer = rendererRef.current;
    if (renderer && lastViewportRef.current && lastOptionsRef.current) {
      renderer.render(lastViewportRef.current, {
        ...lastOptionsRef.current,
        showCrosshair: false,
        crosshairX: null,
      });
    }
  }, []);

  // ── Zoom presets ─────────────────────────────────────────────

  const handleZoomPreset = useCallback(
    (durationMs: number | null) => {
      if (totalDurationMs <= 0) return;
      if (durationMs === null) {
        setViewport({ startTime: 0, endTime: totalDurationMs });
        return;
      }
      const currentCenter = (viewport.startTime + viewport.endTime) / 2;
      const halfDuration = Math.min(durationMs, totalDurationMs) / 2;
      let newStart = currentCenter - halfDuration;
      let newEnd = currentCenter + halfDuration;
      if (newStart < 0) {
        newStart = 0;
        newEnd = Math.min(durationMs, totalDurationMs);
      }
      if (newEnd > totalDurationMs) {
        newEnd = totalDurationMs;
        newStart = Math.max(0, newEnd - durationMs);
      }
      setViewport({ startTime: newStart, endTime: newEnd });
    },
    [viewport, totalDurationMs],
  );

  const activePreset = useMemo(() => {
    const currentDuration = viewport.endTime - viewport.startTime;
    if (totalDurationMs <= 0) return null;
    if (Math.abs(currentDuration - totalDurationMs) / totalDurationMs < 0.01) return null;
    for (const preset of ZOOM_PRESETS) {
      if (preset.ms !== null && Math.abs(currentDuration - preset.ms) / preset.ms < 0.05) {
        return preset.label;
      }
    }
    return undefined;
  }, [viewport, totalDurationMs]);

  const viewportLabel = useMemo(() => {
    const durMs = viewport.endTime - viewport.startTime;
    if (durMs <= 0) return '';
    const totalSec = Math.round(durMs / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    if (totalSec < 3600) return `${Math.round(totalSec / 60)}m`;
    const h = Math.floor(totalSec / 3600);
    const m = Math.round((totalSec % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }, [viewport]);

  // ── Event types present in this session (for legend) ─────────

  const eventTypesInSession = useMemo(() => {
    const typeSet = new Set(events.map((ev) => ev.type));
    return Array.from(typeSet).sort();
  }, [events]);

  // ── Lane layout for HTML header overlay positioning ──────────

  const laneLayout = useMemo(
    () =>
      computeLaneLayout(
        renderLanes.map((r) => ({ height: r.height })),
        CHANNEL_HEIGHT,
        PADDING.top,
      ),
    [renderLanes],
  );

  // ── Global keyboard shortcut: 'L' opens the lanes drawer ─────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'l' && e.key !== 'L') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      setDrawerOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Conditional rendering ────────────────────────────────────

  const loading = sessionLoading || eventsLoading || dataLoading;
  const error = sessionError ?? eventsError ?? dataError;

  if (!opfsSupported) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState} role="alert">
          <span className={styles.errorIcon} aria-hidden="true">
            ⚠
          </span>
          <h2 className={styles.errorTitle}>Browser Not Supported</h2>
          <p className={styles.errorMessage}>
            The Origin Private File System (OPFS) is not available in this browser. Signal data
            requires a modern browser with OPFS support (Chrome 86+, Firefox 111+, Safari 15.2+).
          </p>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  if (loading && !manifest) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingState}>
          <div className={styles.loadingSkeletons}>
            <Skeleton width="100%" height={CHANNEL_HEIGHT} variant="rect" />
            <Skeleton width="100%" height={CHANNEL_HEIGHT} variant="rect" />
            <Skeleton width="100%" height={CHANNEL_HEIGHT} variant="rect" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState} role="alert">
          <span className={styles.errorIcon} aria-hidden="true">
            ⚠
          </span>
          <h2 className={styles.errorTitle}>Failed to load signals</h2>
          <p className={styles.errorMessage}>{error}</p>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  if (!manifest || manifest.channels.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            📊
          </span>
          <h2 className={styles.emptyTitle}>No Signal Data</h2>
          <p className={styles.emptyMessage}>
            This session does not contain any high-frequency signal data. Signal data is typically
            found in the DATALOG EDF files.
          </p>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  const canvasDescription = `Signal waveform viewer. ${renderLanes.length} lane${
    renderLanes.length === 1 ? '' : 's'
  } visible: ${renderLanes.map((r) => `${r.lane.name} (${r.lane.pill})`).join(', ')}. Use arrow keys to move the data cursor.`;

  return (
    <div className={styles.container} ref={containerRef}>
      {/* ── Toolbar ───────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <Button
            variant="ghost"
            size="sm"
            className={styles.backButton}
            onClick={() => navigate(`/sessions/${sessionId}`)}
          >
            ← Back
          </Button>
          <span className={styles.title}>Signal Viewer{session ? ` — ${session.date}` : ''}</span>
        </div>

        <div className={styles.toolbarRight}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDrawerOpen(true)}
            aria-haspopup="dialog"
            title="Manage lanes (L)"
          >
            Lanes
          </Button>
          <div className={styles.zoomPresets}>
            <span>Zoom:</span>
            {ZOOM_PRESETS.map((preset) => {
              const isActive =
                (preset.ms === null && activePreset === null) || activePreset === preset.label;
              return (
                <Button
                  key={preset.label}
                  variant={isActive ? 'primary' : 'ghost'}
                  size="sm"
                  className={isActive ? styles.presetButtonActive : styles.presetButton}
                  onClick={() => handleZoomPreset(preset.ms)}
                  aria-pressed={isActive}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── No-wearable-connected hint (non-error affordance) ─── */}
      {noWearableConnected && !hintDismissed && (
        <div className={styles.hintBar} role="note">
          <span>
            Connect a wearable to overlay heart rate, SpO₂, and sleep stages on your signals.
          </span>
          <div className={styles.hintActions}>
            <Button variant="ghost" size="sm" onClick={() => navigate('/data/import')}>
              Import data
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHintDismissed(true)}
              aria-label="Dismiss"
            >
              ✕
            </Button>
          </div>
        </div>
      )}

      {/* ── Legend bar (quick toggles, grouped) ───────────────── */}
      <div className={styles.legendBar}>
        <span className={styles.legendGroupHeading}>SIGNALS</span>
        <div className={styles.channelLegend}>
          {orderedLaneIds
            .map((id) => laneById.get(id))
            .filter((l): l is LaneDescriptor => !!l && l.hasData)
            .map((lane) => (
              <button
                key={lane.id}
                className={`${styles.legendItem} ${hiddenSet.has(lane.id) ? styles.legendItemHidden : ''}`}
                onClick={() => toggleLane(lane.id)}
                aria-pressed={!hiddenSet.has(lane.id)}
                title={`Toggle ${lane.name} visibility`}
                type="button"
              >
                <span
                  className={styles.legendSwatch}
                  ref={(el) => {
                    if (el)
                      el.style.backgroundColor = resolveColor(containerRef.current, lane.colorVar);
                  }}
                />
                {lane.name}
                {lane.unit ? ` (${lane.unit})` : ''}
                <span className={styles.lanePill} data-kind={lane.pill}>
                  {lane.pill}
                </span>
              </button>
            ))}
        </div>
        {eventTypesInSession.length > 0 && (
          <>
            <span className={styles.legendSeparator}>|</span>
            <span className={styles.legendGroupHeading}>DEVICE EVENTS</span>
            {eventTypesInSession.map((type) => (
              <span key={type} className={styles.eventLegendItem}>
                <span
                  className={styles.eventLegendSwatch}
                  style={{
                    backgroundColor: resolveColor(
                      containerRef.current,
                      EVENT_COLORS[type] ?? 'var(--color-chart-7)',
                    ),
                  }}
                />
                {formatEventType(type)}
              </span>
            ))}
          </>
        )}
        <span className={styles.legendSeparator}>|</span>
        <span
          className={styles.legendGroupHeading}
          title="App-detected breathing episodes (coming soon)"
        >
          DETECTIONS
        </span>
      </div>

      {/* ── Canvas + lane-header overlay ──────────────────────── */}
      <div
        ref={canvasWrapperRef}
        className={styles.canvasWrapper}
        data-panning={isPanning}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      >
        <canvas
          ref={canvasCallbackRef}
          className={styles.canvas}
          role="img"
          tabIndex={0}
          aria-label={canvasDescription}
          onKeyDown={handleCanvasKeyDown}
          onBlur={handleCanvasBlur}
        />

        {/* Lane headers as positioned HTML overlay (keyboard accessible). */}
        <div className={styles.laneHeaders} aria-label="Lane controls">
          {renderLanes.map((r, i) => {
            const entry = laneLayout[i];
            if (!entry) return null;
            const grabbed = grabbedLane === r.lane.id;
            return (
              <div
                key={r.lane.id}
                className={styles.laneHeader}
                data-grabbed={grabbed}
                data-collapsed={r.collapsed}
                style={{ top: `${entry.top}px`, height: `${entry.height}px` }}
              >
                <div
                  className={styles.laneGrip}
                  role="button"
                  tabIndex={0}
                  aria-label={`Reorder ${r.lane.name}. Press Space to grab, then Arrow Up or Down to move.`}
                  aria-pressed={grabbed}
                  onKeyDown={(e) => handleHeaderKeyDown(e, r.lane.id)}
                  title="Drag to reorder (Space to grab)"
                >
                  ⋮⋮
                </div>
                <span
                  className={styles.laneAccent}
                  ref={(el) => {
                    if (el)
                      el.style.backgroundColor = resolveColor(
                        containerRef.current,
                        r.lane.colorVar,
                      );
                  }}
                  aria-hidden="true"
                />
                <span className={styles.laneName}>
                  {r.lane.name}
                  {r.lane.unit ? <span className={styles.laneUnit}> {r.lane.unit}</span> : null}
                </span>
                <span className={styles.lanePill} data-kind={r.lane.pill}>
                  {r.lane.pill}
                </span>
                <button
                  type="button"
                  className={styles.laneIconButton}
                  onClick={() => toggleCollapse(r.lane.id)}
                  aria-pressed={r.collapsed}
                  aria-label={`${r.collapsed ? 'Expand' : 'Collapse'} ${r.lane.name}`}
                  title={r.collapsed ? 'Expand lane' : 'Collapse lane'}
                >
                  {r.collapsed ? '▸' : '▾'}
                </button>
                <button
                  type="button"
                  className={styles.laneIconButton}
                  onClick={() => toggleLane(r.lane.id)}
                  aria-label={`Hide ${r.lane.name}`}
                  title="Hide lane"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live region for the keyboard data cursor readout. */}
      <div className={styles.srOnly} aria-live="polite" role="status">
        {cursorReadout}
      </div>

      {/* Live region for keyboard lane grab/move/drop reordering. */}
      <div className={styles.srOnly} aria-live="polite" role="status">
        {laneReorderAnnouncement}
      </div>

      {/* Live region for out-of-range `?t=` deep-link targets. */}
      <div className={styles.srOnly} aria-live="polite" role="status">
        {deepLinkStatus}
      </div>

      {/* ── Status bar ────────────────────────────────────────── */}
      <div className={styles.statusBar}>
        <div className={styles.statusLeft}>
          {events.length > 0 && (
            <span>
              {events.length} event{events.length !== 1 ? 's' : ''}
            </span>
          )}
          {wearableLoading && <span>Loading wearable lanes…</span>}
          {wearableError && <span title={wearableError}>Wearable lanes unavailable</span>}
          {!wearableLoading && !anyWearableData && !noWearableConnected && (
            <span>No wearable data this night</span>
          )}
        </div>
        <div className={styles.statusRight}>
          <span>Showing {viewportLabel}</span>
        </div>
      </div>

      {/* ── Lanes drawer ──────────────────────────────────────── */}
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen} title="Lanes">
        <div className={styles.drawer}>
          <div className={styles.drawerPresets}>
            <span className={styles.drawerHeading}>Presets</span>
            <div className={styles.drawerPresetButtons}>
              {LANE_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  variant={lanePrefs.preset === preset.id ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => applyPreset(preset.id)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {(['cpap', 'wearable', 'sleep'] as const).map((group) => {
            const groupLanes = allLanes.filter((l) => l.group === group);
            if (groupLanes.length === 0) return null;
            const heading = group === 'cpap' ? 'CPAP' : group === 'wearable' ? 'Wearable' : 'Sleep';
            return (
              <div key={group} className={styles.drawerGroup}>
                <span className={styles.drawerHeading}>{heading}</span>
                <ul className={styles.drawerList}>
                  {groupLanes.map((lane) => (
                    <li key={lane.id} className={styles.drawerRow}>
                      <Switch
                        label={`${lane.name}${lane.hasData ? '' : ' (no data this night)'}`}
                        checked={lane.hasData && !hiddenSet.has(lane.id)}
                        disabled={!lane.hasData}
                        onCheckedChange={() => toggleLane(lane.id)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Dialog>
    </div>
  );
}
