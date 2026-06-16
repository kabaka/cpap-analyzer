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
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { SignalRenderer } from '@/components/charts/canvas/SignalRenderer';
import {
  computeLaneLayout,
  type DetectionEpisode,
  type EventMarker,
  type RenderOptions,
  type RibbonBand,
  type SignalChannel,
  type ViewportState,
} from '@/components/charts/canvas/SignalRenderer';
import {
  buildDecimationPyramid,
  selectPyramidLevel,
  type DecimationPyramid,
} from '@/components/charts/canvas/decimationPyramid';
import { Button, Dialog, Popover, Skeleton, Switch } from '@/components/ui';
import { ConfidenceBar, DetectionDisclaimer } from '@/components/domain/Breathing';
import { confidenceTier, confidenceTierLabel, type BreathingEpisode } from '@/analysis/breathing';
import { useBreathingEpisodes } from '@/hooks/useBreathingEpisodes';
import { useSessionDetail, useEventData } from '@/hooks/useSignalData';
import { useWearableLanes, type WearableSeries } from '@/hooks/useWearableLanes';
import type { SignalManifest, ChannelDescriptor } from '@/services/storage/OPFSService';
import { OPFSService } from '@/services/storage/OPFSService';
import { lttbImpl } from '@/services/workers/downsample.worker';
import { useAppStore } from '@/stores/useAppStore';
import type { Event as TherapyEvent } from '@/types';

import { evaluateDeepLink, formatOffsetLabel } from './deepLinkGuard';
import {
  detectionReadoutText,
  EMPTY_HOVERED_REGION,
  eventReadoutText,
  findHoveredRegion as findHoveredRegionPure,
  formatDuration,
  formatEventType,
  hoveredRegionKey,
  type HoveredRegion,
} from './hoverReadout';
import {
  applyOrder,
  lanePrefsKey,
  moveLane,
  parseLanePrefs,
  toggleId,
  type LanePrefs,
} from './laneState';
import { computeLaneDomain } from './signalDomain';
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
  UnclassifiedApnea: 'var(--color-chart-2)',
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

/**
 * Vertical offset (px) from the top of the flow lane to the detection-chip band.
 * Pushes the PB/CSR confidence chips DOWN below the lane-control label band
 * (the 24px `--signal-lane-control-size` row at the lane's top-left) so the
 * chips no longer collide with the lane label/pill, with enough headroom that a
 * chip's `:focus-visible` outline isn't clipped against the label.
 */
const DETECTION_CHIP_BAND_OFFSET = 28;

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

// ── Breathing-detection confidence chip (overlay) ────────────────

/**
 * Anchored, clickable confidence chip for an app-computed breathing episode.
 * The chip sits at the top of the airflow lane region at the episode's
 * session-relative start. Tier (low / moderate / high), short label
 * ("PB" / "CSR"), and a numeric confidence are all redundant cues so colour is
 * never the sole signal.
 *
 * Clicking the chip opens a popover with episode features and the persistent
 * "candidate, not diagnosis" disclaimer.
 */
function DetectionChip({
  episode,
  leftPct,
}: {
  episode: BreathingEpisode;
  leftPct: number;
}): JSX.Element {
  const tier = confidenceTier(episode.confidence);
  const tierName = confidenceTierLabel(tier);
  const shortLabel = episode.type === 'CheyneStokes' ? 'CSR' : 'PB';
  const pct = Math.round(episode.confidence * 100);
  const nadirLabel =
    episode.meanNadirType === 'apnea'
      ? 'central apnea nadirs'
      : episode.meanNadirType === 'hypopnea'
        ? 'hypopnea nadirs'
        : 'nadir type unknown';
  return (
    <Popover
      side="bottom"
      align="start"
      trigger={
        <button
          type="button"
          className={styles.detectionChip}
          data-tier={tier}
          data-belowdevice={episode.belowDeviceThreshold ? 'true' : 'false'}
          style={{ left: `${leftPct}%` }}
          aria-label={`${shortLabel} candidate, ${tierName}, ${pct}% confidence`}
        >
          <span className={styles.detectionChipDot} aria-hidden="true" />
          <span className={styles.detectionChipLabel}>{shortLabel}</span>
          <span className={styles.detectionChipPct}>{pct}%</span>
        </button>
      }
    >
      <div className={styles.detectionPopover}>
        <h4 className={styles.detectionPopoverTitle}>
          {episode.type === 'CheyneStokes'
            ? 'Cheyne-Stokes (candidate)'
            : 'Periodic breathing (candidate)'}
        </h4>
        <dl className={styles.detectionPopoverList}>
          <dt>Confidence</dt>
          <dd>
            <ConfidenceBar value={episode.confidence} label="Episode confidence" compact />
          </dd>
          <dt>Cycle length</dt>
          <dd>{episode.cycleLengthSec.toFixed(1)} s</dd>
          <dt>Cycles</dt>
          <dd>{episode.cycleCount}</dd>
          <dt>Modulation depth</dt>
          <dd>{episode.modulationDepth.toFixed(2)}</dd>
          <dt>Duration</dt>
          <dd>{(episode.durationSec / 60).toFixed(1)} min</dd>
          <dt>Nadirs</dt>
          <dd>{nadirLabel}</dd>
          {episode.belowDeviceThreshold && (
            <>
              <dt>Threshold</dt>
              <dd>Sub-threshold candidate (below device reporting gate)</dd>
            </>
          )}
        </dl>
        <DetectionDisclaimer compact />
        <Link className={styles.detectionPopoverLink} to="/help/breathing-patterns">
          What does this mean? →
        </Link>
      </div>
    </Popover>
  );
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

  /**
   * Optional deep-link event END: `?te=<epochMs>`. When present the viewport is
   * framed so the whole event fills ~90 % of the view (vs. a fixed ±60 s window
   * on the start). Parsed once; `null` when absent/invalid.
   */
  const deepLinkEndMs = useMemo(() => {
    const raw = searchParams.get('te');
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
  // Transparent overlay canvas stacked over the base; holds only the crosshair so
  // pointer moves repaint it alone (never the waveform stack).
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SignalRenderer | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const opfsRef = useRef<OPFSService | null>(null);

  /** Full CPAP session signal data preloaded into memory. */
  const fullDataRef = useRef<Map<string, FullChannelData>>(new Map());

  /**
   * Per-channel full-session finite data extent (min/max), accumulated during
   * the same single pass that detects empty channels. Feeds the hybrid display
   * domain (see {@link computeLaneDomain}). Channels with no finite samples are
   * absent. Reset on session change alongside `emptyChannels`.
   */
  const dataExtentRef = useRef<Map<string, { min: number; max: number }>>(new Map());

  /**
   * Per-channel multi-resolution decimation pyramids, keyed by channel name.
   * Built lazily after the first CPAP paint (see the pyramid-build effect) so it
   * never blocks first frame. Empty until built; the render hot path falls back
   * to slicing the raw data directly when a channel has no pyramid yet — so
   * behaviour and output are unchanged before the pyramid lands.
   */
  const pyramidsRef = useRef<Map<string, DecimationPyramid>>(new Map());

  /** Crosshair X position — bypasses React state for zero-latency rendering. */
  const crosshairXRef = useRef<number | null>(null);

  /** Last-rendered viewport and options — used by pointer handler for direct renders. */
  const lastViewportRef = useRef<ViewportState | null>(null);
  const lastOptionsRef = useRef<RenderOptions | null>(null);

  /**
   * Stable handle to the latest `renderRangeDirect` callback, so effects that run
   * before it is defined (e.g. the pyramid-build effect) can trigger a direct
   * repaint without taking it as a dependency.
   */
  const renderRangeDirectRef = useRef<((range: ViewportRange) => ViewportState | null) | null>(
    null,
  );

  /**
   * Live viewport during a direct-render interaction (drag-pan / wheel-zoom).
   * These hot paths re-slice + paint without a React state round-trip; the
   * settled value is committed to `viewport` state once at the end (pan) or on a
   * trailing debounce (wheel). `null` when no such interaction is in flight.
   */
  const liveViewportRef = useRef<ViewportRange | null>(null);

  /** rAF handle coalescing wheel-zoom paints to one per frame. */
  const wheelRafRef = useRef<number | null>(null);
  /** Trailing-debounce handle that commits the settled wheel viewport to state. */
  const wheelCommitTimerRef = useRef<number | null>(null);

  /**
   * Mirror of the committed `viewport` state, readable synchronously from the
   * native wheel listener (which closes over a stale `viewport` otherwise).
   */
  const viewportRef = useRef<ViewportRange>({ startTime: 0, endTime: 0 });

  // ── State ────────────────────────────────────────────────────
  const [manifest, setManifest] = useState<SignalManifest | null>(null);
  const [viewport, setViewport] = useState<ViewportRange>({ startTime: 0, endTime: 0 });
  const [totalDurationMs, setTotalDurationMs] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [fullDataReady, setFullDataReady] = useState(false);

  /**
   * Flipped true once the full-session load pass (which fills `dataExtentRef`)
   * completes. Gates the hybrid-domain memo without coupling it to the viewport.
   */
  const [dataExtentReady, setDataExtentReady] = useState(false);

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

  /**
   * Live DOM refs to each lane's drag-grip, keyed by lane id. Used to redirect
   * keyboard focus to a sibling grip after a keyboard-initiated lane hide, so
   * focus is never lost to `document.body` when its host header unmounts.
   */
  const laneGripRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  /** Ref to the toolbar "Lanes" button — the focus fallback when no lane remains. */
  const lanesButtonRef = useRef<HTMLButtonElement | null>(null);

  /** Keyboard data-cursor time (session-relative ms), or null when inactive. */
  const cursorTimeRef = useRef<number | null>(null);

  /** aria-live readout text for the keyboard data cursor. */
  const [cursorReadout, setCursorReadout] = useState('');

  /**
   * Device event + detection episode currently under the pointer (or empty).
   * Rendered, non-interactively and `aria-hidden`, in the sticky legend bar.
   */
  const [hoveredRegion, setHoveredRegion] = useState<HoveredRegion>(EMPTY_HOVERED_REGION);

  /**
   * Composite identity (`${eventId}|${episodeId}`) of the hovered region, kept in
   * a ref so the pointermove hot path can detect region enter/exit/cross without
   * a React state read and only call `setHoveredRegion` when it actually changes.
   */
  const hoveredKeyRef = useRef('');

  /** aria-live announcement for keyboard lane grab/move/drop reordering. */
  const [laneReorderAnnouncement, setLaneReorderAnnouncement] = useState('');

  /** Whether the "no wearable data connected" hint has been dismissed this view. */
  const [hintDismissed, setHintDismissed] = useState(false);

  /**
   * Whether app-computed breathing-detection overlays (PB/CSR candidates) are
   * shown. Persisted in lane prefs alongside other toggles. Defaults to `true`
   * — an existing pref of `undefined` (pre-detection) is treated as enabled.
   */
  const showDetections = lanePrefs.showDetections ?? true;

  /**
   * Defer breathing detection until after the CPAP canvas has its first paint
   * so the detector never blocks first frame (priority #3 — performance).
   */
  const [detectionEnabled, setDetectionEnabled] = useState(false);
  useEffect(() => {
    if (!fullDataReady) return;
    // Defer one frame so the canvas paints first.
    const handle = window.requestAnimationFrame(() => setDetectionEnabled(true));
    return () => window.cancelAnimationFrame(handle);
  }, [fullDataReady]);

  /**
   * Build the per-channel decimation pyramids ONCE after the first CPAP paint.
   *
   * Deferred a frame (like the detection effect above) so it never blocks first
   * frame — the viewer paints CPAP at full resolution first, then the pyramids
   * land and subsequent zoomed-out frames become cheap. The build is bounded to
   * ≤ ~1× the base array per channel in extra memory (geometric series). The
   * pyramid is keyed on the channel data identity (replaced wholesale on session
   * change), so this also clears stale pyramids when navigating between sessions.
   */
  useEffect(() => {
    if (!fullDataReady || !manifest) return;
    let cancelled = false;
    const handle = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const next = new Map<string, DecimationPyramid>();
      for (const [name, fcd] of fullDataRef.current) {
        if (fcd.data.length === 0) continue;
        next.set(name, buildDecimationPyramid(fcd.data));
      }
      pyramidsRef.current = next;
      // Repaint the current viewport so the (visually identical) pyramid-backed
      // path takes over immediately rather than on the next interaction.
      if (rendererRef.current && lastViewportRef.current && lastOptionsRef.current) {
        const range = {
          startTime: lastViewportRef.current.startTime,
          endTime: lastViewportRef.current.endTime,
        };
        renderRangeDirectRef.current?.(range);
      }
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(handle);
      pyramidsRef.current = new Map();
    };
    // fullDataRef is a ref (stable); manifest identity tracks session changes.
  }, [fullDataReady, manifest]);

  // ── Derived values ───────────────────────────────────────────────

  const sessionStartMs = useMemo(
    () => (session ? new Date(session.startTime).getTime() : 0),
    [session],
  );

  const {
    episodes: detectionEpisodesRaw,
    loading: detectionLoading,
    error: detectionError,
  } = useBreathingEpisodes({
    sessionId,
    sessionStartMs,
    events,
    enabled: detectionEnabled && showDetections,
  });

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
      deepLinkEndMs,
      fullDataReady,
      totalDurationMs,
      session,
      sessionStartMs,
      appliedTarget: appliedDeepLinkRef.current,
    });
    if (decision.kind === 'apply') {
      setViewport({ startTime: decision.start, endTime: decision.end });
      setDeepLinkStatus(decision.announcement);
      appliedDeepLinkRef.current = deepLinkTargetMs;
    } else if (decision.kind === 'out-of-range') {
      setDeepLinkStatus(decision.message);
    }
  }, [deepLinkTargetMs, deepLinkEndMs, fullDataReady, totalDurationMs, sessionStartMs, session]);

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
      setDataExtentReady(false);
      dataExtentRef.current = new Map();
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
          const detectedExtent = new Map<string, { min: number; max: number }>();
          for (const [name, fcd] of newFullData) {
            const data = fcd.data;
            if (data.length === 0) {
              detectedEmpty.add(name);
              continue;
            }
            // Single pass: empty-channel detection AND finite min/max extent.
            let hasMeaningful = false;
            let lo = Number.POSITIVE_INFINITY;
            let hi = Number.NEGATIVE_INFINITY;
            for (let i = 0; i < data.length; i++) {
              const v = data[i];
              if (v === undefined || Number.isNaN(v)) continue;
              if (v !== 0) hasMeaningful = true;
              if (v < lo) lo = v;
              if (v > hi) hi = v;
            }
            if (!hasMeaningful) detectedEmpty.add(name);
            if (Number.isFinite(lo) && Number.isFinite(hi)) {
              detectedExtent.set(name, { min: lo, max: hi });
            }
          }
          dataExtentRef.current = detectedExtent;
          setEmptyChannels(detectedEmpty);
          setFullDataReady(true);
          setDataExtentReady(true);
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

    // Wire any already-mounted overlay (mount order between the two canvas
    // callback refs is not guaranteed; the overlay ref also wires up if it
    // mounts after the renderer is created).
    if (overlayCanvasRef.current) {
      renderer.setOverlayCanvas(overlayCanvasRef.current);
    }

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

  // Overlay canvas callback ref. Stores the element and (when the renderer
  // already exists) attaches it immediately; otherwise canvasCallbackRef wires it
  // when the renderer is created. On unmount (null) it detaches from the renderer.
  const overlayCanvasCallbackRef = useCallback((canvas: HTMLCanvasElement | null) => {
    overlayCanvasRef.current = canvas;
    const renderer = rendererRef.current;
    if (renderer) renderer.setOverlayCanvas(canvas);
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

  // ── Memoized per-CPAP-lane descriptor + resolved colour ──────
  //
  // `buildCpapChannel` previously ran `manifest.channels.find(...)` plus a
  // `resolveColor` (a forced getComputedStyle read) for EVERY cpap lane EVERY
  // frame on the pan/wheel hot path. Both inputs are viewport-independent, so we
  // resolve them once per (manifest, resolvedTheme, wrapperWidth) — mirroring
  // baseWearableChannels — and look them up in the render loop. The colour reads
  // only resolve against real styles once wrapperWidth > 0, and re-resolve on
  // theme change; wrapperWidth + resolvedTheme are therefore the deps that gate
  // getComputedStyle, identical to baseWearableChannels.
  interface CpapChannelMeta {
    readonly descriptor: ChannelDescriptor;
    readonly resolvedColor: string;
  }

  const cpapChannelMeta = useMemo(() => {
    const map = new Map<string, CpapChannelMeta>();
    if (!manifest) return map;
    const container = containerRef.current;
    for (const descriptor of manifest.channels) {
      const colorVar = CHANNEL_COLORS[descriptor.name] ?? DEFAULT_CHANNEL_COLOR;
      map.set(descriptor.name, {
        descriptor,
        resolvedColor: resolveColor(container, colorVar),
      });
    }
    return map;
    // wrapperWidth + resolvedTheme drive re-resolution of the getComputedStyle
    // read in resolveColor (mirrors baseWearableChannels).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, resolvedTheme, wrapperWidth]);

  // ── Hybrid display domains per CPAP channel ──────────────────
  //
  // Resolve each channel's display bounds from a clinical default expanded only
  // to cover the session's data extent (see `signalDomain.computeLaneDomain`).
  // This replaces scaling lanes to the EDF `physicalMin`/`physicalMax` decode
  // anchors, which clip real spikes and waste vertical resolution. Keyed on
  // `[manifest, dataExtentReady]` only — it is viewport-independent, so pan/zoom
  // never recomputes it. `dataExtentRef` is read (not a dep) but is guaranteed
  // populated by the time `dataExtentReady` flips true.
  const cpapDisplayDomains = useMemo(() => {
    const map = new Map<string, { min: number; max: number }>();
    if (!manifest) return map;
    for (const descriptor of manifest.channels) {
      const extent = dataExtentRef.current.get(descriptor.name);
      map.set(
        descriptor.name,
        computeLaneDomain({
          channelName: descriptor.name,
          unit: descriptor.unit,
          declaredMin: descriptor.physicalMin,
          declaredMax: descriptor.physicalMax,
          dataMin: extent?.min,
          dataMax: extent?.max,
        }),
      );
    }
    return map;
    // dataExtentRef is a ref (stable); dataExtentReady gates when it is read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, dataExtentReady]);

  // ── Build CPAP channel for the current viewport ──────────────

  const buildCpapChannel = useCallback(
    (laneName: string, targetPoints: number, range: ViewportRange): SignalChannel | null => {
      const fcd = fullDataRef.current.get(laneName);
      if (!fcd || fcd.data.length === 0) return null;
      const meta = cpapChannelMeta.get(laneName);
      if (!meta) return null;
      const desc = meta.descriptor;

      const fullData = fcd.data;
      const totalSamples = fullData.length;
      const startFrac = range.startTime / totalDurationMs;
      const endFrac = range.endTime / totalDurationMs;
      const startSample = Math.floor(startFrac * totalSamples);
      const endSample = Math.min(Math.ceil(endFrac * totalSamples), totalSamples);

      // Pick the source samples for this viewport. When a decimation pyramid has
      // been built for this channel, select an appropriate level (level 0 / raw
      // for already-small windows, so zoomed-in output is byte-identical to
      // slicing raw); otherwise fall back to the exact pre-pyramid behaviour
      // (raw subarray) so pre-build frames are unchanged.
      const pyramid = pyramidsRef.current.get(laneName);
      let levelSlice: Float32Array;
      if (pyramid) {
        const pslice = selectPyramidLevel(pyramid, startSample, endSample, targetPoints);
        levelSlice = pslice.data.subarray(pslice.startIndex, pslice.endIndex);
      } else {
        levelSlice = fullData.subarray(startSample, endSample);
      }

      // SAME LTTB as before, only when the source is denser than the target.
      const displayData =
        levelSlice.length > targetPoints ? lttbImpl(levelSlice, targetPoints) : levelSlice;

      const viewDurationMs = range.endTime - range.startTime;
      // Output-point density over the viewport duration — independent of which
      // pyramid level fed LTTB (LTTB always emits ≤ targetPoints spanning the
      // same viewport), so the semantics are unchanged from the raw path.
      const effectiveSampleRate =
        viewDurationMs > 0 ? (displayData.length / viewDurationMs) * 1000 : desc.sampleRate;

      // Display bounds come from the hybrid clinical domain (expand-only from a
      // clinical default), NOT the EDF decode anchors. Threading them through
      // physicalMin/physicalMax keeps the crosshair readout
      // (getValueAtPosition/getValuesAtTime) and dot positioning automatically
      // consistent, since they derive from the same fields. Fall back to the EDF
      // declared range when no hybrid domain is available (e.g. pre-extent).
      const domain = cpapDisplayDomains.get(laneName);

      return {
        name: laneName,
        data: displayData,
        sampleRate: effectiveSampleRate,
        unit: desc.unit,
        color: meta.resolvedColor,
        physicalMin: domain?.min ?? desc.physicalMin,
        physicalMax: domain?.max ?? desc.physicalMax,
        kind: 'cpap',
        render: 'line',
      };
    },
    [cpapChannelMeta, cpapDisplayDomains, totalDurationMs],
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

  /**
   * Ribbon bands (e.g. hypnogram) keyed by channel name, derived once from the
   * viewport-independent wearable base channels. Passing the full set is safe —
   * the renderer only consults bands for channels actually present in a frame.
   */
  const wearableRibbonBands = useMemo(() => {
    const bands: Record<string, readonly RibbonBand[]> = {};
    for (const entry of baseWearableChannels.values()) {
      if (entry.ribbonBands) bands[entry.channel.name] = entry.ribbonBands;
    }
    return bands;
  }, [baseWearableChannels]);

  /**
   * Assemble the renderer's {@link ViewportState} (CPAP channels re-sliced &
   * downsampled to `range`, plus the viewport-independent wearable/sleep lanes)
   * for an ARBITRARY time `range`. Extracted from the render effect so the
   * pan/zoom hot paths can re-slice and render a new viewport DIRECTLY (without a
   * React state round-trip) while still producing identical output.
   */
  const buildViewportState = useCallback(
    (range: ViewportRange): ViewportState | null => {
      if (!manifest) return null;
      const targetPoints = Math.max(100, Math.round(canvasSize.width * DOWNSAMPLE_MULTIPLIER));

      const channels: SignalChannel[] = [];
      for (const { lane, height } of renderLanes) {
        let channel: SignalChannel | null = null;

        if (lane.group === 'cpap') {
          channel = buildCpapChannel(lane.name, targetPoints, range);
        } else {
          // Wearable / sleep lane — look up the memoized, viewport-independent base.
          const base = baseWearableChannels.get(lane.id);
          if (base) {
            channels.push({ ...base.channel, height });
            continue;
          }
        }

        if (!channel) continue;
        // Apply the resolved (possibly collapsed) lane height. `height` already
        // encodes the collapsed state (resolved in `laneHeights`).
        channels.push({ ...channel, height });
      }

      return { startTime: range.startTime, endTime: range.endTime, channels };
    },
    [manifest, canvasSize.width, renderLanes, buildCpapChannel, baseWearableChannels],
  );

  // ── Memoized viewport-independent render overlays ────────────
  //
  // Event + detection markers do NOT depend on the viewport, yet
  // `buildRenderOptions` rebuilt them every frame on the pan/zoom hot path —
  // `buildEventMarkers` maps over ALL events calling `resolveColor`
  // (getComputedStyle) PER EVENT. We hoist both into memos so the hot path only
  // references stable arrays.

  // Event markers. resolvedTheme + wrapperWidth gate the getComputedStyle reads
  // inside buildEventMarkers (resolve once mounted, re-resolve on theme change),
  // mirroring baseWearableChannels.
  const eventMarkers = useMemo(
    () => buildEventMarkers(events, sessionStartMs, containerRef.current),
    // wrapperWidth + resolvedTheme drive re-resolution of getComputedStyle reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, sessionStartMs, resolvedTheme, wrapperWidth],
  );

  // Detection overlay markers (no getComputedStyle — purely a data transform).
  const detectionMarkers = useMemo<DetectionEpisode[] | undefined>(
    () =>
      showDetections && detectionEpisodesRaw && detectionEpisodesRaw.length > 0
        ? detectionEpisodesRaw.map((ep) => ({
            startTime: ep.startMs - sessionStartMs,
            duration: ep.endMs - ep.startMs,
            type: ep.type === 'CheyneStokes' ? 'CSR' : 'PB',
            confidence: ep.confidence,
          }))
        : undefined,
    [detectionEpisodesRaw, showDetections, sessionStartMs],
  );

  /**
   * Build the {@link RenderOptions} (event markers, detection overlays, grid,
   * padding). `crosshairX` is read live from the ref so direct crosshair renders
   * and the effect agree. Shared between the effect and the pan/zoom hot paths.
   * Event + detection markers are viewport-independent and supplied pre-memoized,
   * so this is now allocation-light per frame.
   */
  const buildRenderOptions = useCallback((): RenderOptions => {
    const currentCrosshairX = crosshairXRef.current;
    return {
      showCrosshair: currentCrosshairX !== null,
      crosshairX: currentCrosshairX,
      showGrid: true,
      eventMarkers,
      ...(detectionMarkers ? { detectionEpisodes: detectionMarkers } : {}),
      ribbonBands: wearableRibbonBands,
      channelHeight: CHANNEL_HEIGHT,
      padding: PADDING,
    };
  }, [eventMarkers, detectionMarkers, wearableRibbonBands]);

  /**
   * Render an arbitrary viewport `range` DIRECTLY to the canvas, bypassing React
   * state. Re-slices CPAP channels for the range and keeps `lastViewportRef` /
   * `lastOptionsRef` coherent so an immediately-following crosshair render uses
   * the live viewport. Used by the pan and wheel-zoom hot paths to avoid a full
   * component re-render per event. Returns the rendered state (or `null`).
   */
  const renderRangeDirect = useCallback(
    (range: ViewportRange): ViewportState | null => {
      const renderer = rendererRef.current;
      if (!renderer) return null;
      const viewportState = buildViewportState(range);
      if (!viewportState) return null;
      const options = buildRenderOptions();
      lastViewportRef.current = viewportState;
      lastOptionsRef.current = options;
      renderer.render(viewportState, options);
      // The base content just changed under a (possibly) active crosshair, so the
      // overlay's intersection dots and value readouts are now stale. Re-sample
      // and repaint the overlay at the same cursor X. Cheap (overlay-only) and a
      // no-op when no crosshair is showing.
      if (crosshairXRef.current !== null) {
        renderer.renderOverlay(viewportState, {
          ...options,
          showCrosshair: true,
          crosshairX: crosshairXRef.current,
        });
      }
      return viewportState;
    },
    [buildViewportState, buildRenderOptions],
  );
  renderRangeDirectRef.current = renderRangeDirect;

  /** Commit a settled live (pan/wheel) viewport to React state, then clear it. */
  const commitLiveViewport = useCallback(() => {
    const live = liveViewportRef.current;
    liveViewportRef.current = null;
    if (!live) return;
    // Only commit when it actually differs, to avoid a redundant render.
    setViewport((prev) =>
      prev.startTime === live.startTime && prev.endTime === live.endTime ? prev : { ...live },
    );
  }, []);

  // Keep the synchronous viewport mirror current. When committed state diverges
  // from the live ref (e.g. a zoom preset or deep-link set state directly, not
  // via a pan/wheel commit), drop the stale live ref so the next gesture seeds
  // from the authoritative state rather than an abandoned interaction window.
  useEffect(() => {
    viewportRef.current = viewport;
    const live = liveViewportRef.current;
    if (live && (live.startTime !== viewport.startTime || live.endTime !== viewport.endTime)) {
      liveViewportRef.current = null;
    }
  }, [viewport]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !fullDataReady || !manifest) return;
    if (viewport.endTime <= viewport.startTime || totalDurationMs <= 0) return;

    const viewportState = buildViewportState(viewport);
    if (!viewportState) return;
    const options = buildRenderOptions();

    lastViewportRef.current = viewportState;
    lastOptionsRef.current = options;
    renderer.render(viewportState, options);
    // Keep the overlay crosshair coherent after a base repaint (zoom preset,
    // deep-link, lane toggle, etc.) while the cursor is parked on the chart.
    if (crosshairXRef.current !== null) {
      renderer.renderOverlay(viewportState, {
        ...options,
        showCrosshair: true,
        crosshairX: crosshairXRef.current,
      });
    }
  }, [fullDataReady, manifest, viewport, totalDurationMs, buildViewportState, buildRenderOptions]);

  // ── Lane mutations ───────────────────────────────────────────

  const toggleLane = useCallback((laneId: string) => {
    setLanePrefs((prev) => ({ ...prev, hidden: toggleId(prev.hidden, laneId), preset: undefined }));
  }, []);

  const toggleCollapse = useCallback((laneId: string) => {
    setLanePrefs((prev) => ({ ...prev, collapsed: toggleId(prev.collapsed, laneId) }));
  }, []);

  /**
   * Hide a lane from its in-header ✕ control. When the action was initiated by
   * the keyboard (`viaKeyboard`), the just-hidden header unmounts and would drop
   * focus to `document.body`; we redirect it to the next remaining lane's grip
   * (or the previous one if this was the last lane, or the toolbar Lanes button
   * if none remain) and announce the change on the existing lane live region.
   */
  const hideLane = useCallback(
    (laneId: string, viaKeyboard: boolean) => {
      const laneName = laneById.get(laneId)?.name ?? 'Lane';
      // Snapshot the visible order BEFORE the hide so we can pick a focus target.
      const remaining = visibleLaneIds.filter((id) => id !== laneId);
      const hiddenIdx = visibleLaneIds.indexOf(laneId);

      toggleLane(laneId);

      // Announce on the shared lane live region (mirrors reorder announcements).
      setLaneReorderAnnouncement(
        `${laneName} hidden. ${remaining.length} lane${remaining.length === 1 ? '' : 's'} shown.`,
      );

      if (!viaKeyboard) return;

      // The next lane occupies the hidden lane's old index; if it was last, fall
      // back to the previous lane; if none remain, the toolbar Lanes button.
      const focusTargetId =
        remaining[hiddenIdx] ?? remaining[hiddenIdx - 1] ?? remaining[remaining.length - 1] ?? null;

      // Defer until after React has unmounted the hidden header and rendered the
      // new visible set, so the target grip exists in the DOM.
      requestAnimationFrame(() => {
        const grip = focusTargetId ? laneGripRefs.current.get(focusTargetId) : null;
        if (grip) {
          grip.focus();
        } else {
          lanesButtonRef.current?.focus();
        }
      });
    },
    [laneById, visibleLaneIds, toggleLane],
  );

  const toggleDetections = useCallback(() => {
    setLanePrefs((prev) => ({
      ...prev,
      showDetections: !(prev.showDetections ?? true),
    }));
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

  /** Trailing-debounce delay (ms) before a wheel-zoom commits to React state. */
  const WHEEL_COMMIT_DELAY_MS = 120;

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

      // WHEEL HOT PATH: accumulate against the live viewport (seeded from the
      // last-rendered viewport so successive notches compound without a React
      // round-trip), paint directly via a single coalescing rAF, and commit the
      // settled viewport to state once on a trailing debounce. This keeps cursor-
      // anchored zoom and all clamps identical to the previous per-event version
      // while avoiding a full component re-render on every wheel notch.
      const prev =
        liveViewportRef.current ??
        (lastViewportRef.current
          ? {
              startTime: lastViewportRef.current.startTime,
              endTime: lastViewportRef.current.endTime,
            }
          : { startTime: viewportRef.current.startTime, endTime: viewportRef.current.endTime });

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
      const range = { startTime: newStart, endTime: newEnd };
      liveViewportRef.current = range;

      // Coalesce paints to one per frame.
      if (wheelRafRef.current === null) {
        wheelRafRef.current = window.requestAnimationFrame(() => {
          wheelRafRef.current = null;
          if (liveViewportRef.current) renderRangeDirect(liveViewportRef.current);
        });
      }

      // (Re)arm the trailing commit so the settled viewport reaches React state
      // exactly once after the gesture stops — matching what was last painted.
      if (wheelCommitTimerRef.current !== null) {
        window.clearTimeout(wheelCommitTimerRef.current);
      }
      wheelCommitTimerRef.current = window.setTimeout(() => {
        wheelCommitTimerRef.current = null;
        if (wheelRafRef.current !== null) {
          window.cancelAnimationFrame(wheelRafRef.current);
          wheelRafRef.current = null;
        }
        // Paint the final viewport once more so committed state == last frame.
        if (liveViewportRef.current) renderRangeDirect(liveViewportRef.current);
        commitLiveViewport();
      }, WHEEL_COMMIT_DELAY_MS);
    };

    wrapper.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      wrapper.removeEventListener('wheel', onWheel);
      if (wheelRafRef.current !== null) {
        window.cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
      if (wheelCommitTimerRef.current !== null) {
        window.clearTimeout(wheelCommitTimerRef.current);
        wheelCommitTimerRef.current = null;
        // A wheel gesture had settled but its trailing commit hadn't fired yet.
        // Flush it now so a re-subscribe (deps change) doesn't drop the settled
        // viewport and let the render effect snap back to stale state.
        commitLiveViewport();
      }
    };
  }, [totalDurationMs, renderRangeDirect, commitLiveViewport]);

  // ── Hovered-region hit-test (shared by pointer + keyboard) ───

  /**
   * Find the device event and detection episode whose [start, end] span (in
   * session-relative ms) contains `timeMs`. Thin wrapper that binds the
   * component's data to the pure {@link findHoveredRegionPure} hit-test so the
   * pointer hover path and the keyboard cursor announcement report the same
   * region.
   */
  const findHoveredRegion = useCallback(
    (timeMs: number): HoveredRegion =>
      findHoveredRegionPure(timeMs, events, detectionEpisodesRaw, sessionStartMs, showDetections),
    [events, sessionStartMs, showDetections, detectionEpisodesRaw],
  );

  /**
   * Convert a pointer X (canvas-relative px) to a session-relative time using
   * the same x↔time mapping the keyboard cursor (`announceAtTime`) uses, then
   * hit-test it and commit to state only when the hovered identity changes.
   */
  const updateHoveredRegion = useCallback(
    (x: number, plotWidth: number) => {
      const vp = lastViewportRef.current;
      if (!vp || plotWidth <= 0) return;
      const frac = (x - PADDING.left) / plotWidth;
      if (frac < 0 || frac > 1) {
        if (hoveredKeyRef.current !== '') {
          hoveredKeyRef.current = '';
          setHoveredRegion(EMPTY_HOVERED_REGION);
        }
        return;
      }
      const timeMs = vp.startTime + frac * (vp.endTime - vp.startTime);
      const region = findHoveredRegion(timeMs);
      const key = hoveredRegionKey(region);
      if (key !== hoveredKeyRef.current) {
        hoveredKeyRef.current = key;
        setHoveredRegion(region);
      }
    },
    [findHoveredRegion],
  );

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

      // Non-obstructive hovered-region readout: hit-test the cursor time against
      // device events / detection episodes and surface the match in the sticky
      // legend bar. State only changes on region enter/exit/cross (guarded by
      // hoveredKeyRef), so this stays a no-op while the cursor sits in one region
      // and never adds a per-pixel re-render to the direct crosshair path.
      updateHoveredRegion(x, rect.width - PADDING.left - PADDING.right);

      if (isPanning && panStartRef.current) {
        // PAN HOT PATH: re-slice and paint the new window directly each move,
        // tracking the live viewport in a ref. We deliberately do NOT call
        // setViewport here — that would re-render this 1700-line component (and
        // reposition every lane-header overlay) on every pointermove. The final
        // window is committed to React state once in handlePointerUp/Leave.
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
        const range = { startTime: newStart, endTime: newEnd };
        liveViewportRef.current = range;
        // crosshairXRef is already set above; renderRangeDirect picks it up.
        renderRangeDirect(range);
        return;
      }

      // Not panning: paint the crosshair on the dedicated overlay canvas ONLY.
      // The base waveform layer is untouched, so a hover no longer repaints any
      // waveform/grid/axis work — just the 1px crosshair, a few dots, and badges.
      const renderer = rendererRef.current;
      if (renderer && lastViewportRef.current && lastOptionsRef.current) {
        renderer.renderOverlay(lastViewportRef.current, {
          ...lastOptionsRef.current,
          showCrosshair: true,
          crosshairX: x,
        });
      }
    },
    [isPanning, totalDurationMs, renderRangeDirect, updateHoveredRegion],
  );

  const handlePointerUp = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
    commitLiveViewport();
  }, [commitLiveViewport]);

  const handlePointerLeave = useCallback(() => {
    crosshairXRef.current = null;
    // Clear the hovered-region readout (only if it isn't already empty) and reset
    // the identity ref so the next hover re-enters cleanly.
    if (hoveredKeyRef.current !== '') {
      hoveredKeyRef.current = '';
      setHoveredRegion(EMPTY_HOVERED_REGION);
    }
    // If a pan was in flight (pointer left the wrapper / capture lost), commit
    // its settled viewport before clearing so the displayed window persists.
    if (isPanning) {
      commitLiveViewport();
      setIsPanning(false);
      panStartRef.current = null;
    }
    // Hiding the crosshair only needs the overlay cleared — the base waveform
    // layer is unchanged, so it must not repaint.
    const renderer = rendererRef.current;
    if (renderer && lastViewportRef.current && lastOptionsRef.current) {
      renderer.renderOverlay(lastViewportRef.current, {
        ...lastOptionsRef.current,
        showCrosshair: false,
        crosshairX: null,
      });
    }
  }, [isPanning, commitLiveViewport]);

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
      // Keyboard cursor only moves the crosshair within the current viewport, so
      // paint the overlay alone — no base repaint needed.
      renderer.renderOverlay(vp, { ...opts, showCrosshair: true, crosshairX: x });

      const values = renderer.getValuesAtTime(x, vp, opts);
      const parts = values.map((v) => {
        if (v.label !== undefined) return `${v.channel} ${v.label}`;
        return `${v.channel} ${v.value.toFixed(1)} ${v.unit}`.trim();
      });
      // Keyboard counterpart of the pointer hover readout: append a spoken-
      // friendly clause for any device event / detection episode at the cursor
      // time, via the SAME polite live region (no new live region added).
      const region = findHoveredRegion(timeMs);
      const regionParts: string[] = [];
      if (region.event) {
        regionParts.push(
          `in ${formatEventType(region.event.type)} event, ${formatDuration(
            region.event.duration,
          )}`,
        );
      }
      if (region.episode) {
        const short = region.episode.type === 'CheyneStokes' ? 'CSR' : 'PB';
        const pct = Math.round(region.episode.confidence * 100);
        regionParts.push(`in ${short} candidate, ${pct}% confidence`);
      }

      const elapsedSec = Math.round(timeMs / 1000);
      const lead = `At ${elapsedSec}s: ${parts.join('; ') || 'no data'}`;
      setCursorReadout(regionParts.length > 0 ? `${lead} — ${regionParts.join('; ')}` : lead);
    },
    [canvasSize.width, findHoveredRegion],
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
    // Clear the crosshair on the overlay only; the base layer is unchanged.
    const renderer = rendererRef.current;
    if (renderer && lastViewportRef.current && lastOptionsRef.current) {
      renderer.renderOverlay(lastViewportRef.current, {
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
    // Shared with the deep-link announcement so the on-screen "Showing …" label
    // and the framed-event aria-live copy use identical formatting.
    return formatOffsetLabel(durMs);
  }, [viewport]);

  // ── Event types present in this session (for legend) ─────────

  const eventTypesInSession = useMemo(() => {
    const typeSet = new Set(events.map((ev) => ev.type));
    return Array.from(typeSet).sort();
  }, [events]);

  // ── Hovered-region readout content (legend bar) ──────────────

  /**
   * Display model for the legend-bar hovered-region readout: a decorative colour
   * swatch (event colour when present), the line text, and a longer un-truncated
   * `title` for the hover tooltip. When nothing is hovered all are empty and the
   * element holds its row position (reserved height) to avoid layout shift.
   *
   * When both an event and a detection are present, the event's optional metric
   * and the detection's cycle/duration tail are both omitted so the combined
   * line fits.
   */
  const hoverReadout = useMemo(() => {
    const { event, episode } = hoveredRegion;
    if (!event && !episode) {
      return { swatch: null as string | null, text: '', title: '' };
    }

    const both = Boolean(event && episode);
    const segments: string[] = [];
    const fullSegments: string[] = [];
    if (event) {
      // In the combined case the event's optional metric is omitted so the line fits.
      segments.push(`▮ ${eventReadoutText(event, sessionStartMs, !both)}`);
      fullSegments.push(`▮ ${eventReadoutText(event, sessionStartMs, true)}`);
    }
    if (episode) {
      // In the combined case the detection's cycle/duration tail is omitted so the line fits.
      segments.push(`◷ ${detectionReadoutText(episode, !both)}`);
      fullSegments.push(`◷ ${detectionReadoutText(episode, true)}`);
    }

    const swatch = event
      ? resolveColor(containerRef.current, EVENT_COLORS[event.type] ?? 'var(--color-chart-7)')
      : resolveColor(containerRef.current, 'var(--color-detection)');
    return {
      swatch,
      text: segments.join(' · '),
      title: fullSegments.join(' · '),
    };
  }, [hoveredRegion, sessionStartMs]);

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

  /**
   * Pixel `top` of the first CPAP airflow lane (or the first lane as a fallback),
   * used to anchor breathing-detection confidence chips so they sit at the top
   * of the flow lane region rather than floating above the canvas.
   */
  const airflowChipTop = useMemo(() => {
    const flowIdx = renderLanes.findIndex(
      (r) => r.lane.group === 'cpap' && /flow/i.test(r.lane.name),
    );
    const idx = flowIdx >= 0 ? flowIdx : 0;
    const entry = laneLayout[idx];
    const base = entry ? entry.top : PADDING.top;
    return base + DETECTION_CHIP_BAND_OFFSET;
  }, [renderLanes, laneLayout]);

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
            ref={lanesButtonRef}
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
        {eventTypesInSession.length > 0 && (
          <>
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
        {eventTypesInSession.length > 0 && <span className={styles.legendSeparator}>|</span>}
        <span className={styles.legendGroupHeading}>DETECTIONS</span>
        <button
          type="button"
          className={`${styles.legendItem} ${!showDetections ? styles.legendItemHidden : ''}`}
          onClick={toggleDetections}
          aria-pressed={showDetections}
          title="Toggle app-computed breathing-pattern detections (PB / CSR candidates)"
        >
          <span className={styles.detectionSwatch} aria-hidden="true" />
          Periodic Breathing / CSR
        </button>
        <span className={styles.detectionDisclaimerInline}>
          Detections are candidate patterns, not diagnoses.
        </span>
        {detectionLoading && <span className={styles.detectionStatus}>Detecting…</span>}
        {detectionError && (
          <span className={styles.detectionStatus} title={detectionError}>
            Detection unavailable
          </span>
        )}
        {/* Non-obstructive hovered-region readout. Always rendered (reserves its
            row height) to avoid layout shift; aria-hidden so mouse hover never
            announces — the keyboard path speaks via the polite cursor live region
            instead. Yields/ellipsis before forcing the legend to wrap. */}
        <div className={styles.hoverReadout} aria-hidden="true" title={hoverReadout.title}>
          {hoverReadout.text ? (
            <>
              <span
                className={styles.hoverReadoutSwatch}
                style={hoverReadout.swatch ? { backgroundColor: hoverReadout.swatch } : undefined}
              />
              <span className={styles.hoverReadoutText}>{hoverReadout.text}</span>
            </>
          ) : null}
        </div>
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

        {/* Transparent crosshair overlay, stacked pixel-perfectly over the base
            canvas. pointer-events:none so pointer events still reach the wrapper.
            aria-hidden — the base canvas carries the accessible description and the
            keyboard cursor speaks via the live region. */}
        <canvas
          ref={overlayCanvasCallbackRef}
          className={styles.overlayCanvas}
          aria-hidden="true"
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
                style={{ top: `${entry.top}px` }}
              >
                <div
                  ref={(el) => {
                    laneGripRefs.current.set(r.lane.id, el);
                  }}
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
                <button
                  type="button"
                  className={styles.laneHide}
                  onClick={() => hideLane(r.lane.id, false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                      e.preventDefault();
                      hideLane(r.lane.id, true);
                    }
                  }}
                  aria-label={`Hide ${r.lane.name} lane`}
                  title="Hide lane"
                >
                  ✕
                </button>
                <button
                  type="button"
                  className={styles.laneName}
                  onClick={() => toggleCollapse(r.lane.id)}
                  aria-expanded={!r.collapsed}
                  aria-label={`${r.collapsed ? 'Expand' : 'Collapse'} ${r.lane.name} lane`}
                  style={{ color: resolveColor(containerRef.current, r.lane.colorVar) }}
                >
                  <span className={styles.laneCollapseGlyph} aria-hidden="true">
                    {r.collapsed ? '▸' : '▾'}
                  </span>
                  {r.lane.name}
                  {r.lane.unit ? <span className={styles.laneUnit}>{r.lane.unit}</span> : null}
                </button>
                <span className={styles.lanePill} data-kind={r.lane.pill}>
                  {r.lane.pill}
                </span>
              </div>
            );
          })}
        </div>

        {/* App-computed breathing-pattern detection chip overlay. */}
        {showDetections && detectionEpisodesRaw && detectionEpisodesRaw.length > 0 && (
          <div
            className={styles.detectionChips}
            aria-label="App-computed breathing pattern detections"
            style={{
              top: `${airflowChipTop}px`,
              left: `${PADDING.left}px`,
              right: `${PADDING.right}px`,
            }}
          >
            {detectionEpisodesRaw.map((ep) => {
              const startRel = ep.startMs - sessionStartMs;
              const endRel = ep.endMs - sessionStartMs;
              if (endRel < viewport.startTime || startRel > viewport.endTime) return null;
              const span = viewport.endTime - viewport.startTime;
              if (span <= 0) return null;
              const frac = (startRel - viewport.startTime) / span;
              const leftPct = Math.max(0, Math.min(1, frac)) * 100;
              return <DetectionChip key={ep.id} episode={ep} leftPct={leftPct} />;
            })}
          </div>
        )}
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

          <div className={styles.drawerGroup}>
            <span className={styles.drawerHeading}>Detections</span>
            <ul className={styles.drawerList}>
              <li className={styles.drawerRow}>
                <Switch
                  label="Periodic Breathing / CSR (candidate)"
                  checked={showDetections}
                  onCheckedChange={toggleDetections}
                />
              </li>
            </ul>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
