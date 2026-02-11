/**
 * Signal Viewer — interactive multi-channel waveform display.
 *
 * Renders high-frequency (25–50 Hz) CPAP signal data (Flow, MaskPressure,
 * Leak, SpO₂) as stacked Canvas 2D waveforms with zoom, pan, and crosshair
 * controls.
 *
 * Data flow:
 * 1. Session metadata + events loaded from IndexedDB via hooks.
 * 2. Full session signal data preloaded from OPFS into memory on mount.
 * 3. Viewport slices derived synchronously from in-memory data and
 *    downsampled via synchronous LTTB for responsive zoom/pan.
 * 4. Rendered by {@link SignalRenderer} on a Canvas element.
 *
 * @module views/Sessions/SignalViewer
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { SignalRenderer } from '@/components/charts/canvas/SignalRenderer';
import type {
  EventMarker,
  RenderOptions,
  SignalChannel,
  ViewportState,
} from '@/components/charts/canvas/SignalRenderer';
import { Button, Skeleton } from '@/components/ui';
import { useSessionDetail, useEventData } from '@/hooks/useSignalData';
import type { SignalManifest, ChannelDescriptor } from '@/services/storage/OPFSService';
import { OPFSService } from '@/services/storage/OPFSService';
import { lttbImpl } from '@/services/workers/downsample.worker';
import type { Event as TherapyEvent } from '@/types';

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

/** Pixel height per channel strip. */
const CHANNEL_HEIGHT = 150;

/** Canvas padding. */
const PADDING = { top: 20, right: 24, bottom: 28, left: 56 } as const;

/** Number of viewport pixels to downsample target. */
const DOWNSAMPLE_MULTIPLIER = 2;

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
  // Extract var name: "var(--color-chart-1)" → "--color-chart-1"
  const match = /^var\(([^)]+)\)$/.exec(varExpr);
  if (!match) return varExpr;

  const resolved = getComputedStyle(el)
    .getPropertyValue(match[1] ?? '')
    .trim();
  return resolved || varExpr;
}

// ── Build event markers from therapy events ──────────────────────

function buildEventMarkers(
  events: TherapyEvent[],
  sessionStartMs: number,
  containerEl: HTMLElement | null,
): EventMarker[] {
  return events.map((evt) => ({
    startTime: evt.timestamp - sessionStartMs,
    duration: evt.duration * 1000, // seconds → ms
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

  /** Full session signal data preloaded into memory. */
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

  /** Whether full session data has been loaded into fullDataRef. */
  const [fullDataReady, setFullDataReady] = useState(false);

  // Interaction state
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; viewport: ViewportRange } | null>(null);

  // Canvas dimensions
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Wrapper width from ResizeObserver (for content-driven canvas height)
  const [wrapperWidth, setWrapperWidth] = useState(0);

  // Hidden channels for legend toggle
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(() => {
    if (!sessionId) return new Set();
    const stored = localStorage.getItem(`signal-viewer-hidden-${sessionId}`);
    if (stored) {
      try {
        return new Set(JSON.parse(stored) as string[]);
      } catch {
        /* ignore */
      }
    }
    return new Set();
  });

  // ── Derived values ───────────────────────────────────────────────

  const sessionStartMs = useMemo(
    () => (session ? new Date(session.startTime).getTime() : 0),
    [session],
  );

  const opfsSupported = useMemo(() => OPFSService.isSupported(), []);

  const visibleChannelCount = useMemo(() => {
    if (!manifest) return 0;
    return manifest.channels.filter((ch) => !hiddenChannels.has(ch.name)).length;
  }, [manifest, hiddenChannels]);

  // ── Initialize OPFS + preload all session data into memory ───

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

        // Preload ALL channels into memory (~9 MB for a typical 8h session)
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
          setFullDataReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setDataError(err instanceof Error ? err.message : 'Failed to load signal data');
        }
      } finally {
        if (!cancelled) {
          setDataLoading(false);
        }
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [sessionId, opfsSupported]);

  // ── Initialize renderer + ResizeObserver via callback ref ────

  const canvasCallbackRef = useCallback((canvas: HTMLCanvasElement | null) => {
    // Cleanup previous renderer + observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (rendererRef.current) {
      rendererRef.current.dispose();
      rendererRef.current = null;
    }

    // Update the stable ref used by event handlers
    canvasRef.current = canvas;

    if (!canvas) return;

    const renderer = new SignalRenderer(canvas);
    rendererRef.current = renderer;

    // Size the canvas to its container
    const wrapper = canvas.parentElement;
    if (!wrapper) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0) {
          setWrapperWidth(width);
        }
      }
    });

    observerRef.current = observer;
    observer.observe(wrapper);

    // Initial size
    const rect = wrapper.getBoundingClientRect();
    if (rect.width > 0) {
      setWrapperWidth(rect.width);
    }
  }, []);

  // ── Persist hidden channels ──────────────────────────────────────

  useEffect(() => {
    if (sessionId) {
      localStorage.setItem(
        `signal-viewer-hidden-${sessionId}`,
        JSON.stringify([...hiddenChannels]),
      );
    }
  }, [hiddenChannels, sessionId]);

  // ── Content-driven canvas sizing ─────────────────────────────

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || wrapperWidth <= 0) return;

    const contentHeight = PADDING.top + visibleChannelCount * CHANNEL_HEIGHT + PADDING.bottom;
    const finalHeight = Math.max(contentHeight, 100);

    renderer.resize(wrapperWidth, finalHeight);
    setCanvasSize({ width: wrapperWidth, height: finalHeight });
  }, [wrapperWidth, visibleChannelCount]);

  // ── Build render data from in-memory full data + trigger render ──

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !fullDataReady || !manifest) return;
    if (viewport.endTime <= viewport.startTime || totalDurationMs <= 0) return;

    const container = containerRef.current;
    const targetPoints = Math.max(100, Math.round(canvasSize.width * DOWNSAMPLE_MULTIPLIER));

    const channels: SignalChannel[] = manifest.channels
      .filter((ch) => fullDataRef.current.has(ch.name) && !hiddenChannels.has(ch.name))
      .map((ch) => {
        const fcd = fullDataRef.current.get(ch.name);
        if (!fcd) return null;

        const fullData = fcd.data;
        const totalSamples = fullData.length;
        if (totalSamples === 0) return null;

        // Compute sample indices for the current viewport
        const startFrac = viewport.startTime / totalDurationMs;
        const endFrac = viewport.endTime / totalDurationMs;
        const startSample = Math.floor(startFrac * totalSamples);
        const endSample = Math.min(Math.ceil(endFrac * totalSamples), totalSamples);
        const slice = fullData.subarray(startSample, endSample);

        // Synchronous LTTB downsampling for responsive zoom/pan
        const displayData = slice.length > targetPoints ? lttbImpl(slice, targetPoints) : slice;

        const viewDurationMs = viewport.endTime - viewport.startTime;
        const effectiveSampleRate =
          viewDurationMs > 0 ? (displayData.length / viewDurationMs) * 1000 : ch.sampleRate;

        const colorVar = CHANNEL_COLORS[ch.name] ?? DEFAULT_CHANNEL_COLOR;
        return {
          name: ch.name,
          data: displayData,
          sampleRate: effectiveSampleRate,
          unit: ch.unit,
          color: resolveColor(container, colorVar),
          physicalMin: ch.physicalMin,
          physicalMax: ch.physicalMax,
        };
      })
      .filter((ch): ch is SignalChannel => ch !== null);

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
      channelHeight: CHANNEL_HEIGHT,
      padding: PADDING,
    };

    // Store for crosshair direct renders
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
    hiddenChannels,
  ]);

  // ── Toggle channel visibility ────────────────────────────────

  const toggleChannel = useCallback((channelName: string) => {
    setHiddenChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channelName)) {
        next.delete(channelName);
      } else {
        next.add(channelName);
      }
      return next;
    });
  }, []);

  // ── Zoom handler (native wheel listener for passive: false) ───

  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;

    const onWheel = (e: WheelEvent) => {
      // Only zoom on Ctrl/Cmd+wheel; let regular wheel scroll vertically
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (totalDurationMs <= 0) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Cursor position as fraction of the plot area
      const cursorX = e.clientX - rect.left;
      const plotLeft = PADDING.left;
      const plotWidth = rect.width - PADDING.left - PADDING.right;
      if (plotWidth <= 0) return;

      const cursorFrac = Math.max(0, Math.min(1, (cursorX - plotLeft) / plotWidth));

      setViewport((prev) => {
        const cursorTime = prev.startTime + cursorFrac * (prev.endTime - prev.startTime);

        const zoomIn = e.deltaY < 0;
        const factor = zoomIn ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;

        const currentDuration = prev.endTime - prev.startTime;
        let newDuration = currentDuration * factor;

        // Clamp
        newDuration = Math.max(MIN_VIEWPORT_MS, Math.min(totalDurationMs, newDuration));

        // Center around cursor
        let newStart = cursorTime - cursorFrac * newDuration;
        let newEnd = newStart + newDuration;

        // Clamp to valid range
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

  // ── Pan handlers ─────────────────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only primary button (left click)
      if (e.button !== 0) return;

      setIsPanning(true);
      panStartRef.current = { x: e.clientX, viewport: { ...viewport } };

      // Capture pointer for smooth dragging outside the element
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [viewport],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Update crosshair position via ref + direct render (bypasses React state)
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

      // Pan if dragging
      if (isPanning && panStartRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const plotWidth = rect.width - PADDING.left - PADDING.right;
        if (plotWidth <= 0) return;

        const startVP = panStartRef.current.viewport;
        const vpDuration = startVP.endTime - startVP.startTime;
        const timeDelta = -(dx / plotWidth) * vpDuration;

        let newStart = startVP.startTime + timeDelta;
        let newEnd = startVP.endTime + timeDelta;

        // Clamp to valid range
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

    // Trigger a render without crosshair
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

  // ── Zoom presets ─────────────────────────────────────────────

  const handleZoomPreset = useCallback(
    (durationMs: number | null) => {
      if (totalDurationMs <= 0) return;

      if (durationMs === null) {
        // "All" — show full session
        setViewport({ startTime: 0, endTime: totalDurationMs });
        return;
      }

      // Center the requested duration around the current viewport center
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

  // ── Active zoom preset detection ─────────────────────────────

  const activePreset = useMemo(() => {
    const currentDuration = viewport.endTime - viewport.startTime;
    if (totalDurationMs <= 0) return null;

    // Check "All" — within 1% tolerance
    if (Math.abs(currentDuration - totalDurationMs) / totalDurationMs < 0.01) {
      return null; // "All" preset
    }

    for (const preset of ZOOM_PRESETS) {
      if (preset.ms !== null && Math.abs(currentDuration - preset.ms) / preset.ms < 0.05) {
        return preset.label;
      }
    }
    return undefined; // not matching any preset
  }, [viewport, totalDurationMs]);

  // ── Viewport time readout for status bar ─────────────────────

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

  // ── Channel info for legend bar ───────────────────────────────

  const channelLegend = useMemo(() => {
    if (!manifest) return [];
    return manifest.channels.map((ch) => ({
      name: ch.name,
      unit: ch.unit,
      colorVar: CHANNEL_COLORS[ch.name] ?? DEFAULT_CHANNEL_COLOR,
    }));
  }, [manifest]);

  // ── Event types present in this session (for legend) ─────────

  const eventTypesInSession = useMemo(() => {
    const typeSet = new Set(events.map((e) => e.type));
    return Array.from(typeSet).sort();
  }, [events]);

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

      {/* ── Legend bar ─────────────────────────────────────────── */}
      <div className={styles.legendBar}>
        <div className={styles.channelLegend}>
          {channelLegend.map((ch) => (
            <button
              key={ch.name}
              className={`${styles.legendItem} ${hiddenChannels.has(ch.name) ? styles.legendItemHidden : ''}`}
              onClick={() => toggleChannel(ch.name)}
              aria-pressed={!hiddenChannels.has(ch.name)}
              title={`Toggle ${ch.name} visibility`}
              type="button"
            >
              <span
                className={styles.legendSwatch}
                ref={(el) => {
                  if (el) {
                    el.style.backgroundColor = resolveColor(containerRef.current, ch.colorVar);
                  }
                }}
              />
              {ch.name}
              {ch.unit ? ` (${ch.unit})` : ''}
            </button>
          ))}
        </div>
        {eventTypesInSession.length > 0 && (
          <>
            <span className={styles.legendSeparator}>|</span>
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
      </div>

      {/* ── Canvas ────────────────────────────────────────────── */}
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
          aria-label={`Signal waveform viewer showing ${visibleChannelCount} channels: ${manifest.channels
            .filter((c) => !hiddenChannels.has(c.name))
            .map((c) => c.name)
            .join(', ')}`}
        />
      </div>

      {/* ── Status bar ────────────────────────────────────────── */}
      <div className={styles.statusBar}>
        <div className={styles.statusLeft}>
          {events.length > 0 && (
            <span>
              {events.length} event{events.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className={styles.statusRight}>
          <span>Showing {viewportLabel}</span>
        </div>
      </div>
    </div>
  );
}
