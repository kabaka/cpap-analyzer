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

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { HybridSignalRenderer } from '@/components/charts/HybridSignalRenderer';
import { parseCssColorToRgba } from '@/components/charts/cssColor';
import {
  computeLaneLayout,
  formatWallClockDate,
  formatWallClockLabel,
  type DetectionEpisode,
  type EventMarker,
  type RenderOptions,
  type RibbonBand,
  type SignalChannel,
  type ViewportState,
} from '@/components/charts/canvas/SignalRenderer';
import type { RGBA } from '@/components/charts/webgl';
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
import { useWeatherTimeseries } from '@/hooks/useWeatherData';
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { AqiScale } from '@/analysis/weather/aqiRamp';
import type { WeatherHourly, AirQualityHourly } from '@/types/weather';
import type { SignalManifest, ChannelDescriptor } from '@/services/storage/OPFSService';
import { OPFSService } from '@/services/storage/OPFSService';
import { lttbInto, lttbOutLength, columnEnvelopeInto } from '@/services/workers/downsample.worker';
import { useAppStore } from '@/stores/useAppStore';
import type { Event as TherapyEvent } from '@/types';

import { isMeaningfulSample } from '@/parsers/validation/physiologicalRanges';
import { evaluateDeepLink, formatOffsetLabel } from './deepLinkGuard';
import { createFramePaintScheduler, type FramePaintScheduler } from './framePaintScheduler';
import { createResizeCoalescer, type ResizeCoalescer } from './resizeCoalescer';
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
import type { CategoricalSample, EventInput, NumericChannelInput } from './regionStats';
import {
  buildMeasureLaneStats,
  categoricalChipRows,
  distributionChipRows,
  formatStatValue,
  laneStatSummary,
  numericChipRows,
  selectionChipRows,
  spreadChipRows,
  trendChipRows,
  type MeasureDataSources,
  type MeasureLaneStat,
  type MeasureMode,
  type TrendDirection,
} from './regionStatsModel';
import {
  applyCursorAnchoredZoom,
  pixelRangeToTimeRange,
  wheelDeltaToZoomFactor,
} from './signalZoom';
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
import {
  aqiBands,
  aqiSeriesHasData,
  buildWeatherChannel,
  conditionBands,
  conditionsHaveData,
  mergeAirQualityPoints,
  mergeWeatherPoints,
  pickAqiScale,
  pressureHasData,
  temperatureHasData,
  weatherCursorReadout,
  weatherLaneDescriptor,
  WEATHER_LANE_SPECS,
  type AirQualityPoint,
  type WeatherPoint,
  type WeatherReadoutUnits,
} from './weatherLanes';
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

/**
 * Wheel-zoom sensitivity and the min/max zoom-span clamps now live in the pure
 * {@link module:views/Sessions/signalZoom} helper (`WHEEL_ZOOM_RATE`,
 * `MIN_VIEWPORT_MS`), so the sensitivity curve and the shift-drag pixel→time
 * math are unit-testable without a browser. The product owner tunes feel via
 * `WHEEL_ZOOM_RATE` there.
 */

/** Default pixel height per CPAP channel strip. */
const CHANNEL_HEIGHT = 150;

/** Canvas padding. */
const PADDING = { top: 20, right: 24, bottom: 28, left: 56 } as const;

/** Number of viewport pixels to downsample target. */
const DOWNSAMPLE_MULTIPLIER = 2;

/**
 * Samples-per-pixel threshold separating the two dense-CPAP render modes.
 *
 * - When the in-viewport source holds MORE than this many samples per output
 *   pixel column (zoomed OUT), the lane renders a per-column MIN/MAX ENVELOPE —
 *   a true envelope cannot hide a 1-sample spike/notch the LTTB polyline's
 *   vertex-picking can skip (the approved fidelity change).
 * - When it holds ≤ this many (zoomed IN), the lane renders the EXACT existing
 *   LTTB polyline, byte-identical to before — at that density each column holds
 *   ≈1 sample, so there is nothing to envelope.
 *
 * Set to 1.0 so the boundary is exactly "1 source sample per pixel". At the
 * boundary each column's min≈max, the envelope collapses to a ~1px ribbon, and
 * the look matches the polyline — the transition is seamless (no pop/flicker).
 */
const ENVELOPE_SAMPLES_PER_PIXEL = 1;

/**
 * Envelope source density target. The per-column min/max must be computed from a
 * source with COMFORTABLY more than one sample per pixel column, so we select a
 * pyramid level using a target of `plotWidth * this` (≥ several× the column
 * count). The pyramid preserves extrema at every level, so a coarser-but-still
 * dense level yields the same per-column extremes far cheaper than scanning raw.
 */
const ENVELOPE_SOURCE_OVERSCAN = 4;

/**
 * Vertical offset (px) from the top of the flow lane to the detection-chip band.
 * Pushes the PB/CSR confidence chips DOWN below the lane-control label band
 * (the 24px `--signal-lane-control-size` row at the lane's top-left) so the
 * chips no longer collide with the lane label/pill, with enough headroom that a
 * chip's `:focus-visible` outline isn't clipped against the label.
 */
const DETECTION_CHIP_BAND_OFFSET = 28;

/**
 * Lane heights at/below this (px) use the COMPACT single-row stat chip variant
 * (collapsed 28px stubs, short lanes). Above it the 4-row grid chip is shown.
 */
const MEASURE_COMPACT_CHIP_MAX_HEIGHT = 64;

/**
 * Plot width (px) below which the per-lane stat chips are replaced by a single
 * collapsible "Region statistics" bottom sheet (responsive fallback). The
 * measure band still draws on the canvas.
 */
const MEASURE_SHEET_BREAKPOINT = 520;

/**
 * Region-statistics glyphs (shape-distinct; aria-hidden — the accessible word is
 * carried in the chip label / aria-label). avg = x̄ (x + combining overline),
 * med = M̃ (M + combining tilde), min = ↓, max = ↑. See the render decision note
 * in the PR: M̃ is KEPT (system-ui renders the combining tilde on M correctly on
 * the supported browser matrix); the `Md` fallback is documented but unused.
 */
const MEASURE_GLYPH = {
  avg: 'x̅',
  med: 'M̃',
  min: '↓',
  max: '↑',
} as const;

/** Per-stat accessible words (paired with {@link MEASURE_GLYPH}). */
const MEASURE_WORD = {
  avg: 'average',
  med: 'median',
  min: 'minimum',
  max: 'maximum',
} as const;

// ── Measure mode catalogue ───────────────────────────────────────
//
// Five overlay lenses on the measured region (UI order = `.`/`,` cycle order):
// Statistics → Variability → Trend → Distribution → Selection. Each re-skins the
// per-lane chip + the SR table; the active mode is the single source of truth held
// in `lanePrefs.measureStatMode` and surfaced by the footer segmented control.

/** All overlay modes in UI / cycle order (mirrors {@link MEASURE_STAT_MODES}). */
const MEASURE_MODE_ORDER: readonly MeasureMode[] = [
  'statistics',
  'variability',
  'trend',
  'distribution',
  'selection',
];

/** Short segmented-control label per mode (the radiogroup options). */
const MEASURE_MODE_SHORT: Record<MeasureMode, string> = {
  statistics: 'Stats',
  variability: 'Var',
  trend: 'Trend',
  distribution: 'Dist',
  selection: 'Sel',
};

/** Full mode name for aria + the collapsed disclosure trigger. */
const MEASURE_MODE_NAME: Record<MeasureMode, string> = {
  statistics: 'Statistics',
  variability: 'Variability',
  trend: 'Trend',
  distribution: 'Distribution',
  selection: 'Selection',
};

/** One-line "what this mode shows", spoken in the debounced aria-live announcement. */
const MEASURE_MODE_DESCRIPTION: Record<MeasureMode, string> = {
  statistics: 'average, median, minimum and maximum',
  variability: 'standard deviation, coefficient of variation and interquartile range',
  trend: 'slope per minute, net change, percent change and direction',
  distribution: 'the 5th, 25th, 50th, 75th and 95th percentiles',
  selection: 'sample rate, sample count and precise region timing',
};

/** Cycle the active mode forward (`+1`) or back (`−1`), wrapping both ways. */
function cycleMeasureMode(current: MeasureMode, delta: 1 | -1): MeasureMode {
  const i = MEASURE_MODE_ORDER.indexOf(current);
  const base = i < 0 ? 0 : i;
  const n = MEASURE_MODE_ORDER.length;
  const next = (base + delta + n) % n;
  return MEASURE_MODE_ORDER[next] as MeasureMode;
}

/** Variability chip glyph/word columns. `σ`/`cv`/`iqr` are non-combining BMP glyphs. */
const SPREAD_GLYPH = { sd: 'σ', cv: 'cv', iqr: 'iqr' } as const;
const SPREAD_WORD = { sd: 'sd', cv: 'cv', iqr: 'iqr' } as const;

/** Trend chip glyph/word columns (slope/net/percent + a direction row). */
const TREND_GLYPH = { slope: 'Δ', net: 'Δ', percent: '%' } as const;
const TREND_WORD = { slope: 'slope', net: 'net', percent: 'change' } as const;

/** Direction arrow + word per {@link TrendDirection}. */
const TREND_DIRECTION: Record<TrendDirection, { glyph: string; word: string }> = {
  rising: { glyph: '↗', word: 'rising' },
  falling: { glyph: '↘', word: 'falling' },
  flat: { glyph: '→', word: 'flat' },
};

/** Distribution percentile rows (glyph is a ladder tick; label is the percentile). */
const DISTRIBUTION_ROWS = [
  { key: 'p5', label: 'p5' },
  { key: 'p25', label: 'p25' },
  { key: 'p50', label: 'p50' },
  { key: 'p75', label: 'p75' },
  { key: 'p95', label: 'p95' },
] as const;

/** Selection chip rows (rate/count/span). `fs`/`n`/`Δt` are non-combining BMP glyphs. */
const SELECTION_GLYPH = { rate: 'fs', count: 'n', span: 'Δt' } as const;
const SELECTION_WORD = { rate: 'rate', count: 'samples', span: 'span' } as const;

/** Debounce (ms) for the spoken mode-switch announcement (aria-checked is instant). */
const MEASURE_MODE_ANNOUNCE_DEBOUNCE_MS = 250;

/**
 * Format a precise wall-clock-or-relative timestamp WITH milliseconds for the
 * Selection footer. Reuses the {@link formatWallClockLabel} HH:MM:SS form (UTC
 * getters) and appends `.mmm`; falls back to a session-relative `mm:ss.mmm` when
 * there is no wall-clock epoch (mirrors the footer's existing wall-clock fallback).
 */
function formatPreciseTime(wallClockEpoch: number, relMs: number): string {
  const ms = String(Math.floor(((relMs % 1000) + 1000) % 1000)).padStart(3, '0');
  if (!Number.isNaN(wallClockEpoch)) {
    return `${formatWallClockLabel(wallClockEpoch, relMs, true)}.${ms}`;
  }
  // Session-relative fallback: H:MM:SS.mmm from session start.
  const totalSec = Math.floor(relMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** Build the exact Selection-footer timing string (start · dur · end), ms-precise. */
function buildPreciseTimingString(wallClockEpoch: number, startMs: number, endMs: number): string {
  const start = formatPreciseTime(wallClockEpoch, startMs);
  const end = formatPreciseTime(wallClockEpoch, endMs);
  const durMs = Math.max(0, Math.round(endMs - startMs));
  const dur = formatExactDuration(durMs);
  return `start ${start} · dur ${dur} · end ${end}`;
}

/** Exact `H:MM:SS.mmm` duration for the Selection footer (millisecond precision). */
function formatExactDuration(durMs: number): string {
  const ms = String(durMs % 1000).padStart(3, '0');
  const totalSec = Math.floor(durMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}.${ms}` : `${m}:${ss}.${ms}`;
}

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
    id: 'environment',
    label: 'Environment focus',
    match: (l) => l.id === 'cpap:flow' || l.group === 'weather',
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

/**
 * The two sources a measured region can come from. `viewport` tracks the visible
 * window live (recomputed on the settled viewport); `selection` is an explicitly
 * pinned region (Alt-drag or keyboard `[`/`]`) that stays fixed in time across
 * pan/zoom. The pinned region is transient (never persisted).
 */
type MeasureRegionSource = 'viewport' | 'selection';

/** An explicitly pinned measure region, session-relative ms, half-open `[start, end)`. */
interface PinnedRegion {
  startMs: number;
  endMs: number;
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

/**
 * Spell a session-relative duration naturally for an aria-live announcement,
 * e.g. `1 hour 12 minutes`, `5 minutes`, `42 seconds`. Used by the keyboard
 * data-cursor readout so the elapsed time is spoken in words rather than a
 * `H:MM:SS` glyph string.
 */
function spokenElapsed(relMs: number): string {
  const totalSeconds = Math.max(0, Math.round(relMs / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m > 0) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  // Show seconds only when under an hour (keeps long offsets concise).
  if (h === 0 && (s > 0 || parts.length === 0)) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
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

// ── Region-statistics per-lane chip (overlay) ────────────────────

/**
 * One per-lane stat chip docked to the lane's left inner edge. Purely decorative
 * (`aria-hidden`, `pointer-events:none`) — the structured table + the polite
 * live-region summary carry the accessible data. Renders the 4-row numeric grid
 * (avg/med/min/max), the categorical stage-% summary, or a "— no data" dash; the
 * `compact` flag switches to the single-row inline variant for short/collapsed
 * lanes. Stats text swaps in place (tabular figures prevent jitter).
 */
/**
 * The "— no data" chip variant, shared by the three empty-stats branches in
 * {@link MeasureChip} (no stats, empty numeric, empty categorical).
 */
function MeasureChipNoData({ top, compact }: { top: number; compact: boolean }): JSX.Element {
  return (
    <div
      className={`${styles.statChip} ${compact ? styles.statChipCompact : ''}`}
      style={{ top: `${top}px` }}
      aria-hidden="true"
    >
      <span className={styles.statChipNoData}>—</span>
    </div>
  );
}

/**
 * "— not numeric" chip variant for hypnogram/categorical & event lanes under the
 * numeric overlay modes (Variability/Trend/Distribution/Selection): those lanes
 * have no continuous-metric to report, so the chip shows a labelled dash rather
 * than a number (never fabricated).
 */
function MeasureChipNotNumeric({
  top,
  compact,
  reason,
}: {
  top: number;
  compact: boolean;
  reason: string;
}): JSX.Element {
  return (
    <div
      className={`${styles.statChip} ${compact ? styles.statChipCompact : ''}`}
      style={{ top: `${top}px` }}
      aria-hidden="true"
    >
      <span className={styles.statChipNoData}>— {reason}</span>
    </div>
  );
}

function MeasureChip({
  stat,
  top,
  compact,
  mode,
}: {
  stat: MeasureLaneStat;
  top: number;
  compact: boolean;
  mode: MeasureMode;
}): JSX.Element | null {
  const { stats } = stat;

  // Selection mode is metadata-driven (rate/count/span), independent of `stats.kind`.
  if (mode === 'selection') {
    return <MeasureSelectionChip stat={stat} top={top} compact={compact} />;
  }

  if (stats.kind === 'none') {
    return <MeasureChipNoData top={top} compact={compact} />;
  }

  // Numeric overlay modes re-skin the numeric chip; categorical/none lanes are
  // "not numeric" under them (Statistics keeps the categorical stage chip).
  if (mode === 'variability') {
    if (stats.kind !== 'spread') {
      return <MeasureChipNotNumeric top={top} compact={compact} reason="not numeric" />;
    }
    return <MeasureSpreadChip stats={stats} top={top} compact={compact} />;
  }
  if (mode === 'trend') {
    if (stats.kind !== 'trend') {
      return <MeasureChipNotNumeric top={top} compact={compact} reason="not numeric" />;
    }
    return <MeasureTrendChip stats={stats} top={top} compact={compact} />;
  }
  if (mode === 'distribution') {
    if (stats.kind !== 'distribution') {
      return <MeasureChipNotNumeric top={top} compact={compact} reason="not numeric" />;
    }
    return <MeasureDistributionChip stats={stats} top={top} compact={compact} />;
  }

  // ── Statistics mode (default, unchanged behaviour) ──
  if (stats.kind === 'numeric') {
    const rows = numericChipRows(stats);
    const unit = rows.unit;
    if (rows.empty) {
      return <MeasureChipNoData top={top} compact={compact} />;
    }
    if (compact) {
      // Single inline row: glyphs only, unit once at the end.
      return (
        <div
          className={`${styles.statChip} ${styles.statChipCompact}`}
          style={{ top: `${top}px` }}
          aria-hidden="true"
        >
          <span className={styles.statChipCompactRow}>
            <span className={styles.statChipGlyph}>{MEASURE_GLYPH.avg}</span> {rows.avg}
            <span className={styles.legendSeparatorInline}>·</span>
            <span className={styles.statChipGlyph}>{MEASURE_GLYPH.med}</span>
            {rows.medianIsApproximate ? '~' : ''}
            {rows.med}
            <span className={styles.legendSeparatorInline}>·</span>
            <span className={styles.statChipGlyph}>{MEASURE_GLYPH.min}</span> {rows.min}
            <span className={styles.legendSeparatorInline}>·</span>
            <span className={styles.statChipGlyph}>{MEASURE_GLYPH.max}</span> {rows.max}
            {unit ? <span className={styles.statChipUnit}> {unit}</span> : null}
          </span>
        </div>
      );
    }
    // Single-sample collapse: show value on the avg row; collapse the rest.
    if (rows.singleSample) {
      return (
        <div className={styles.statChip} style={{ top: `${top}px` }} aria-hidden="true">
          <span className={styles.statChipGlyph}>{MEASURE_GLYPH.avg}</span>
          <span className={styles.statChipLabel}>{MEASURE_WORD.avg}</span>
          <span className={styles.statChipValue}>
            {rows.avg}
            {unit ? <span className={styles.statChipUnit}> {unit}</span> : null}
          </span>
          <span className={styles.statChipSingle}>n = 1 (single sample)*</span>
        </div>
      );
    }
    return (
      <div className={styles.statChip} style={{ top: `${top}px` }} aria-hidden="true">
        {(['avg', 'med', 'min', 'max'] as const).map((key) => {
          const value = rows[key];
          const approx = key === 'med' && rows.medianIsApproximate;
          return (
            <Fragment key={key}>
              <span className={styles.statChipGlyph}>{MEASURE_GLYPH[key]}</span>
              <span className={styles.statChipLabel}>{MEASURE_WORD[key]}</span>
              <span className={styles.statChipValue}>
                {approx ? '~' : ''}
                {value}
                {unit ? <span className={styles.statChipUnit}> {unit}</span> : null}
              </span>
            </Fragment>
          );
        })}
      </div>
    );
  }

  // Event-count lanes are not modelled as lanes in this viewer (events are
  // markers across the stack; the count is shown in the footer/table), so a
  // `count` kind never reaches a lane chip. Render nothing defensively.
  if (stats.kind !== 'categorical') return null;

  // Categorical (hypnogram): per-stage occupancy summary.
  const stageRows = categoricalChipRows(stats);
  if (stageRows.length === 0) {
    return <MeasureChipNoData top={top} compact={compact} />;
  }
  if (compact) {
    return (
      <div
        className={`${styles.statChip} ${styles.statChipCompact}`}
        style={{ top: `${top}px` }}
        aria-hidden="true"
      >
        <span className={styles.statChipCompactRow}>
          {stageRows.map((s, i) => (
            <Fragment key={s.stageName}>
              {i > 0 ? <span className={styles.legendSeparatorInline}>·</span> : null}
              {s.stageName} {s.percent}%
            </Fragment>
          ))}
        </span>
      </div>
    );
  }
  return (
    <div className={styles.statChip} style={{ top: `${top}px` }} aria-hidden="true">
      {stageRows.map((s) => (
        <Fragment key={s.stageName}>
          <span className={styles.statChipGlyph} aria-hidden="true">
            ◼
          </span>
          <span className={styles.statChipLabel}>{s.stageName}</span>
          <span className={styles.statChipValue}>{s.percent}%</span>
        </Fragment>
      ))}
    </div>
  );
}

/** Variability chip: σ / cv / iqr rows (CV dashes for zero-mean / non-allowlisted). */
function MeasureSpreadChip({
  stats,
  top,
  compact,
}: {
  stats: Extract<MeasureLaneStat['stats'], { kind: 'spread' }>;
  top: number;
  compact: boolean;
}): JSX.Element {
  const rows = spreadChipRows(stats);
  if (rows.empty) return <MeasureChipNoData top={top} compact={compact} />;
  const unit = rows.unit;
  const cvTitle = rows.cvUndefined ? 'CV undefined for a zero-mean signal' : undefined;
  if (compact) {
    return (
      <div
        className={`${styles.statChip} ${styles.statChipCompact}`}
        style={{ top: `${top}px` }}
        aria-hidden="true"
      >
        <span className={styles.statChipCompactRow}>
          <span className={styles.statChipGlyph}>{SPREAD_GLYPH.sd}</span> {rows.sd}
          <span className={styles.legendSeparatorInline}>·</span>
          <span className={styles.statChipGlyph}>{SPREAD_GLYPH.cv}</span>
          <span title={cvTitle}>
            {rows.cv}
            {rows.cv === '—' ? '' : '%'}
          </span>
          <span className={styles.legendSeparatorInline}>·</span>
          <span className={styles.statChipGlyph}>{SPREAD_GLYPH.iqr}</span> {rows.iqr}
          {unit ? <span className={styles.statChipUnit}> {unit}</span> : null}
        </span>
      </div>
    );
  }
  return (
    <div className={styles.statChip} style={{ top: `${top}px` }} aria-hidden="true">
      <span className={styles.statChipGlyph}>{SPREAD_GLYPH.sd}</span>
      <span className={styles.statChipLabel}>{SPREAD_WORD.sd}</span>
      <span className={styles.statChipValue}>
        {rows.sd}
        {unit ? <span className={styles.statChipUnit}> {unit}</span> : null}
      </span>
      <span className={styles.statChipGlyph}>{SPREAD_GLYPH.cv}</span>
      <span className={styles.statChipLabel}>{SPREAD_WORD.cv}</span>
      <span className={styles.statChipValue} title={cvTitle}>
        {rows.cv}
        {rows.cv === '—' ? '' : <span className={styles.statChipUnit}> %</span>}
      </span>
      <span className={styles.statChipGlyph}>{SPREAD_GLYPH.iqr}</span>
      <span className={styles.statChipLabel}>{SPREAD_WORD.iqr}</span>
      <span className={styles.statChipValue}>
        {rows.iqr}
        {unit ? <span className={styles.statChipUnit}> {unit}</span> : null}
      </span>
    </div>
  );
}

/** Trend chip: slope / net / % change + a direction row and a muted r² note. */
function MeasureTrendChip({
  stats,
  top,
  compact,
}: {
  stats: Extract<MeasureLaneStat['stats'], { kind: 'trend' }>;
  top: number;
  compact: boolean;
}): JSX.Element {
  const rows = trendChipRows(stats);
  if (rows.empty) return <MeasureChipNoData top={top} compact={compact} />;
  const unit = rows.unit;
  const dir = TREND_DIRECTION[rows.direction];
  if (compact) {
    return (
      <div
        className={`${styles.statChip} ${styles.statChipCompact}`}
        style={{ top: `${top}px` }}
        aria-hidden="true"
      >
        <span className={styles.statChipCompactRow}>
          <span className={styles.statChipGlyph}>{dir.glyph}</span> {rows.slope}
          {unit ? `${unit}/min` : '/min'}
          <span className={styles.legendSeparatorInline}>·</span>
          <span className={styles.statChipGlyph}>{TREND_GLYPH.net}</span> {rows.net}
          {unit ? <span className={styles.statChipUnit}> {unit}</span> : null}
        </span>
      </div>
    );
  }
  return (
    <div className={styles.statChip} style={{ top: `${top}px` }} aria-hidden="true">
      <span className={styles.statChipGlyph}>{TREND_GLYPH.slope}</span>
      <span className={styles.statChipLabel}>{TREND_WORD.slope}</span>
      <span className={styles.statChipValue}>
        {rows.slope}
        <span className={styles.statChipUnit}> {unit ? `${unit}/min` : '/min'}</span>
      </span>
      <span className={styles.statChipGlyph}>{TREND_GLYPH.net}</span>
      <span className={styles.statChipLabel}>{TREND_WORD.net}</span>
      <span className={styles.statChipValue}>
        {rows.net}
        {unit ? <span className={styles.statChipUnit}> {unit}</span> : null}
      </span>
      <span className={styles.statChipGlyph}>{TREND_GLYPH.percent}</span>
      <span className={styles.statChipLabel}>{TREND_WORD.percent}</span>
      <span className={styles.statChipValue}>
        {rows.percent}
        {rows.percent === '—' ? '' : <span className={styles.statChipUnit}> %</span>}
      </span>
      <span className={styles.statChipGlyph} aria-hidden="true">
        {dir.glyph}
      </span>
      <span className={styles.statChipLabel}>direction</span>
      <span className={styles.statChipValue}>{dir.word}</span>
      {rows.rSquared !== null ? (
        <span className={styles.statChipNote}>r²={rows.rSquared}</span>
      ) : null}
    </div>
  );
}

/** Distribution chip: p5/p25/p50/p75/p95 rows (ladder tick glyph), unit once. */
function MeasureDistributionChip({
  stats,
  top,
  compact,
}: {
  stats: Extract<MeasureLaneStat['stats'], { kind: 'distribution' }>;
  top: number;
  compact: boolean;
}): JSX.Element {
  const rows = distributionChipRows(stats);
  if (rows.empty) return <MeasureChipNoData top={top} compact={compact} />;
  const unit = rows.unit;
  if (compact) {
    return (
      <div
        className={`${styles.statChip} ${styles.statChipCompact}`}
        style={{ top: `${top}px` }}
        aria-hidden="true"
      >
        <span className={styles.statChipCompactRow}>
          {DISTRIBUTION_ROWS.map((r, i) => (
            <Fragment key={r.key}>
              {i > 0 ? <span className={styles.legendSeparatorInline}>·</span> : null}
              {rows[r.key]}
            </Fragment>
          ))}
          {unit ? <span className={styles.statChipUnit}> {unit}</span> : null}
        </span>
      </div>
    );
  }
  return (
    <div className={styles.statChip} style={{ top: `${top}px` }} aria-hidden="true">
      {DISTRIBUTION_ROWS.map((r) => (
        <Fragment key={r.key}>
          <span className={styles.statChipGlyph} aria-hidden="true">
            ▏
          </span>
          <span className={styles.statChipLabel}>{r.label}</span>
          <span className={styles.statChipValue}>
            {rows[r.key]}
            {unit ? <span className={styles.statChipUnit}> {unit}</span> : null}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** Selection chip: fs rate / n samples / Δt span (per-lane facts). */
function MeasureSelectionChip({
  stat,
  top,
  compact,
}: {
  stat: MeasureLaneStat;
  top: number;
  compact: boolean;
}): JSX.Element {
  const info = stat.selection;
  if (!info) return <MeasureChipNoData top={top} compact={compact} />;
  const rows = selectionChipRows(info);
  if (rows.empty) return <MeasureChipNoData top={top} compact={compact} />;
  const rateTitle = rows.rateEstimated ? 'mean cadence; wearable sampling is irregular' : undefined;
  if (compact) {
    return (
      <div
        className={`${styles.statChip} ${styles.statChipCompact}`}
        style={{ top: `${top}px` }}
        aria-hidden="true"
      >
        <span className={styles.statChipCompactRow}>
          <span className={styles.statChipGlyph}>{SELECTION_GLYPH.rate}</span>
          <span title={rateTitle}>
            {rows.rate}
            {info.stepped ? '' : ' Hz'}
          </span>
          <span className={styles.legendSeparatorInline}>·</span>
          <span className={styles.statChipGlyph}>{SELECTION_GLYPH.count}</span> {rows.count}
          <span className={styles.legendSeparatorInline}>·</span>
          <span className={styles.statChipGlyph}>{SELECTION_GLYPH.span}</span> {rows.span}
        </span>
      </div>
    );
  }
  return (
    <div className={styles.statChip} style={{ top: `${top}px` }} aria-hidden="true">
      <span className={styles.statChipGlyph}>{SELECTION_GLYPH.rate}</span>
      <span className={styles.statChipLabel}>{SELECTION_WORD.rate}</span>
      <span className={styles.statChipValue} title={rateTitle}>
        {rows.rate}
        {info.stepped ? '' : <span className={styles.statChipUnit}> Hz</span>}
      </span>
      <span className={styles.statChipGlyph}>{SELECTION_GLYPH.count}</span>
      <span className={styles.statChipLabel}>{SELECTION_WORD.count}</span>
      <span className={styles.statChipValue}>{rows.count}</span>
      <span className={styles.statChipGlyph}>{SELECTION_GLYPH.span}</span>
      <span className={styles.statChipLabel}>{SELECTION_WORD.span}</span>
      <span className={styles.statChipValue}>{rows.span}</span>
    </div>
  );
}

// ── Measure-mode footer switcher ─────────────────────────────────

/**
 * The footer segmented control: the visible mode switcher AND the mode indicator
 * (single source of truth). A standard `role="radiogroup"` of 5 options
 * (Stats · Var · Trend · Dist · Sel) with roving tabindex, Arrow Left/Right to move,
 * and Space/Enter to select; clicking an option selects it directly. The selected
 * option is marked by a fill + a leading `●` marker + weight + shadow (never colour
 * alone). On a tight footer (`collapsed`) it folds to "active label + ▸" that opens
 * an upward popover list of the five modes.
 */
function MeasureModeSwitcher({
  mode,
  onChange,
  collapsed,
}: {
  mode: MeasureMode;
  onChange: (next: MeasureMode) => void;
  collapsed: boolean;
}): JSX.Element {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const optionRefs = useRef<Map<MeasureMode, HTMLButtonElement | null>>(new Map());

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = cycleMeasureMode(mode, 1);
      onChange(next);
      optionRefs.current.get(next)?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = cycleMeasureMode(mode, -1);
      onChange(next);
      optionRefs.current.get(next)?.focus();
    }
  };

  if (collapsed) {
    return (
      <div className={styles.modeSwitcherCollapsed}>
        <button
          type="button"
          className={styles.modeSwitcherDisclosure}
          aria-haspopup="listbox"
          aria-expanded={popoverOpen}
          aria-label={`Measure mode: ${MEASURE_MODE_NAME[mode]}. Change mode`}
          onClick={() => setPopoverOpen((o) => !o)}
        >
          {MEASURE_MODE_SHORT[mode]}
          <span className={styles.regionStatsSheetChevron} aria-hidden="true">
            ▸
          </span>
        </button>
        {popoverOpen && (
          <ul className={styles.modeSwitcherPopover} role="listbox" aria-label="Measure mode">
            {MEASURE_MODE_ORDER.map((m) => (
              <li key={m} role="option" aria-selected={m === mode}>
                <button
                  type="button"
                  className={styles.modeSwitcherPopoverOption}
                  data-selected={m === mode ? 'true' : undefined}
                  onClick={() => {
                    onChange(m);
                    setPopoverOpen(false);
                  }}
                >
                  <span className={styles.modeSwitcherOptionMarker} aria-hidden="true">
                    ●
                  </span>
                  {MEASURE_MODE_NAME[m]}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div
      className={styles.modeSwitcher}
      role="radiogroup"
      aria-label="Measure mode"
      onKeyDown={onKeyDown}
    >
      {MEASURE_MODE_ORDER.map((m) => {
        const selected = m === mode;
        return (
          <button
            key={m}
            type="button"
            ref={(el) => {
              optionRefs.current.set(m, el);
            }}
            className={styles.modeSwitcherOption}
            role="radio"
            aria-checked={selected}
            aria-label={MEASURE_MODE_NAME[m]}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(m)}
          >
            <span className={styles.modeSwitcherOptionMarker} aria-hidden="true">
              ●
            </span>
            {MEASURE_MODE_SHORT[m]}
          </button>
        );
      })}
    </div>
  );
}

// ── Measure-region SR table (per-mode) ───────────────────────────

/** Column headers per mode (Lane is always the first row-header column). */
const MEASURE_TABLE_HEADERS: Record<MeasureMode, readonly string[]> = {
  statistics: ['Lane', 'Average', 'Median', 'Minimum', 'Maximum', 'Unit', 'Samples'],
  variability: ['Lane', 'Std dev', 'CV', 'IQR', 'Unit', 'Samples'],
  trend: ['Lane', 'Slope (/min)', 'Net Δ', '% change', 'Direction', 'R²', 'Unit', 'Samples'],
  distribution: ['Lane', 'p5', 'p25', 'p50', 'p75', 'p95', 'Unit', 'Samples'],
  selection: ['Lane', 'Sample rate (Hz)', 'Samples', 'Span'],
};

/** Number of data columns (excluding the Lane row-header) for an inapplicable lane's colSpan. */
function measureTableDataColumns(mode: MeasureMode): number {
  return MEASURE_TABLE_HEADERS[mode].length - 1;
}

/**
 * The screen-reader structured path for the Measure overlay: a real, focusable
 * `<table>` whose caption, column headers, and cells swap per active mode while the
 * element stays mounted (only contents change). Inapplicable lanes render an explicit
 * `—` summary cell with a `title` reason; numeric/categorical-empty lanes fall back to
 * {@link laneStatSummary}.
 */
function MeasureStatsTable({
  mode,
  laneStats,
  region,
  wallClockEpoch,
  eventCount,
}: {
  mode: MeasureMode;
  laneStats: readonly MeasureLaneStat[];
  region: { startMs: number; endMs: number; source: MeasureRegionSource };
  wallClockEpoch: number;
  eventCount: number;
}): JSX.Element {
  const headers = MEASURE_TABLE_HEADERS[mode];
  const dataCols = measureTableDataColumns(mode);
  const sourceWord = region.source === 'selection' ? 'pinned region' : 'viewport';
  const modeName = MEASURE_MODE_NAME[mode];
  const clockClause = Number.isNaN(wallClockEpoch)
    ? ''
    : mode === 'selection'
      ? `, ${formatPreciseTime(wallClockEpoch, region.startMs)} to ${formatPreciseTime(
          wallClockEpoch,
          region.endMs,
        )}`
      : `, ${formatWallClockLabel(wallClockEpoch, region.startMs, true)} to ${formatWallClockLabel(
          wallClockEpoch,
          region.endMs,
          true,
        )}`;
  const durLabel =
    mode === 'selection'
      ? formatExactDuration(Math.max(0, Math.round(region.endMs - region.startMs)))
      : formatDuration(Math.round((region.endMs - region.startMs) / 1000));

  return (
    <table className={styles.srOnly} tabIndex={0} aria-label="Region statistics">
      <caption>
        {modeName} — Region statistics, {sourceWord}, {durLabel}
        {clockClause}
      </caption>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={h} scope="col">
              {i === 0 ? 'Lane' : h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {laneStats.map((laneStat) => (
          <MeasureStatsTableRow
            key={laneStat.laneId}
            mode={mode}
            laneStat={laneStat}
            dataCols={dataCols}
          />
        ))}
        {eventCount > 0 && (
          <tr>
            <th scope="row">Events</th>
            <td colSpan={dataCols}>
              {eventCount.toLocaleString()} event{eventCount === 1 ? '' : 's'} in region
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** One lane row of the per-mode SR table. */
function MeasureStatsTableRow({
  mode,
  laneStat,
  dataCols,
}: {
  mode: MeasureMode;
  laneStat: MeasureLaneStat;
  dataCols: number;
}): JSX.Element {
  const s = laneStat.stats;
  const name = laneStat.laneName;
  const unit = laneStat.unit || '—';

  // A single explicit "—" summary cell for an inapplicable / empty lane.
  const notApplicable = (reason: string) => (
    <tr>
      <th scope="row">{name}</th>
      <td colSpan={dataCols} title={reason}>
        —<span className={styles.srOnly}> {reason}</span>
      </td>
    </tr>
  );

  if (mode === 'selection') {
    const info = laneStat.selection;
    if (!info) return notApplicable('no data');
    if (info.stepped) return notApplicable('stepped lane (no single sample rate)');
    const rows = selectionChipRows(info);
    if (rows.empty) return notApplicable('no meaningful samples in region');
    return (
      <tr>
        <th scope="row">{name}</th>
        <td>{rows.rate}</td>
        <td>{rows.count}</td>
        <td>{rows.span}</td>
      </tr>
    );
  }

  if (mode === 'variability') {
    if (s.kind !== 'spread' || s.count === 0) return notApplicable('not numeric / no data');
    const rows = spreadChipRows(s);
    return (
      <tr>
        <th scope="row">{name}</th>
        <td>{rows.sd}</td>
        <td title={rows.cvUndefined ? 'CV undefined for a zero-mean signal' : undefined}>
          {rows.cv === '—' ? '—' : `${rows.cv}%`}
        </td>
        <td>{rows.iqr}</td>
        <td>{unit}</td>
        <td>{s.count.toLocaleString()}</td>
      </tr>
    );
  }

  if (mode === 'trend') {
    if (s.kind !== 'trend' || s.count < 2 || s.slopePerMin === null) {
      return notApplicable('not numeric / no defined trend');
    }
    const rows = trendChipRows(s);
    return (
      <tr>
        <th scope="row">{name}</th>
        <td>{rows.slope}</td>
        <td>{rows.net}</td>
        <td>{rows.percent === '—' ? rows.percent : `${rows.percent}%`}</td>
        <td>{TREND_DIRECTION[rows.direction].word}</td>
        <td>{rows.rSquared ?? '—'}</td>
        <td>{unit}</td>
        <td>{s.count.toLocaleString()}</td>
      </tr>
    );
  }

  if (mode === 'distribution') {
    if (s.kind !== 'distribution' || s.count < 2) return notApplicable('not numeric / no data');
    const rows = distributionChipRows(s);
    return (
      <tr>
        <th scope="row">{name}</th>
        <td>{rows.p5}</td>
        <td>{rows.p25}</td>
        <td>{rows.p50}</td>
        <td>{rows.p75}</td>
        <td>{rows.p95}</td>
        <td>{unit}</td>
        <td>{s.count.toLocaleString()}</td>
      </tr>
    );
  }

  // ── Statistics mode (default) ──
  if (s.kind === 'numeric' && s.count > 0) {
    const d = s.decimals;
    return (
      <tr>
        <th scope="row">{name}</th>
        <td>{formatStatValue(s.mean, d)}</td>
        <td>
          {s.medianIsApproximate ? '~' : ''}
          {formatStatValue(s.median, d)}
        </td>
        <td>{formatStatValue(s.min, d)}</td>
        <td>{formatStatValue(s.max, d)}</td>
        <td>{unit}</td>
        <td>{s.count.toLocaleString()}</td>
      </tr>
    );
  }
  // Categorical / count / none / empty-numeric: a single summary cell.
  return (
    <tr>
      <th scope="row">{name}</th>
      <td colSpan={dataCols}>{laneStatSummary(laneStat) ?? 'No data'}</td>
    </tr>
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
  // Transparent WebGL2 waveform layer stacked between the base chrome canvas and
  // the crosshair overlay (ADR 0019). Only the dense-CPAP waveforms paint here;
  // when WebGL2 is unavailable / its context is lost the hybrid renderer paints
  // the waveforms on the base canvas instead (automatic fallback).
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<HybridSignalRenderer | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  // rAF-coalescing applier for wrapper-width changes. Records the latest
  // observed width and applies it at most once per frame, and — crucially —
  // suppresses applies entirely while the sidebar collapse/expand transition is
  // animating (document.body.dataset.sidebarAnimating === 'true'), performing a
  // single authoritative trailing apply once the flag clears. See
  // resizeCoalescer.ts. Created lazily on observe, torn down with the renderer.
  const resizeCoalescerRef = useRef<ResizeCoalescer | null>(null);
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

  /** Trailing-debounce handle that commits the settled wheel viewport to state. */
  const wheelCommitTimerRef = useRef<number | null>(null);

  /**
   * Shared rAF-coalescing paint scheduler for BOTH the wheel-zoom and drag-pan
   * hot paths. Each input event records the latest viewport and the scheduler
   * paints it at most once per animation frame (see {@link framePaintScheduler}).
   * Created lazily on first use against the live `renderRangeDirect` (read via
   * `renderRangeDirectRef` so the scheduler never goes stale across renders).
   */
  const paintSchedulerRef = useRef<FramePaintScheduler | null>(null);

  /**
   * Per-lane reusable LTTB scratch buffers (keyed by lane name). DOUBLE-BUFFERED:
   * each lane keeps two `Float32Array`s and alternates between them every frame
   * (`flip` toggles 0/1). Because the renderer retains the just-built channel
   * `data` in `lastViewportRef` and the crosshair overlay later re-samples it,
   * we must NOT overwrite the buffer the previous frame handed out until that
   * frame's render + overlay-resync has completed. Alternating two buffers
   * guarantees the previous frame's view survives through the next frame's full
   * render+resync. `targetPoints` is tracked so the buffers are reallocated only
   * when the budget changes (e.g. on resize), not per frame.
   */
  const lttbScratchRef = useRef<
    Map<string, { a: Float32Array; b: Float32Array; flip: 0 | 1; capacity: number }>
  >(new Map());

  /**
   * Per-lane reusable MIN/MAX-envelope scratch buffers (keyed by lane name).
   * DOUBLE-BUFFERED for the same reason as {@link lttbScratchRef}: the renderer
   * retains the just-built channel's `envelope` arrays in `lastViewportRef`, and a
   * following crosshair/overlay render must still read last frame's buffers, so we
   * never overwrite a buffer until its frame's render + overlay-resync completed.
   * Each entry holds two {min,max} buffer pairs and alternates `flip` per frame.
   * Capacity tracks the column budget (≈ plot width) so reallocation happens only
   * on resize, not per frame. Only the zoomed-OUT dense-CPAP path uses these.
   */
  const envelopeScratchRef = useRef<
    Map<
      string,
      {
        aMin: Float32Array;
        aMax: Float32Array;
        bMin: Float32Array;
        bMax: Float32Array;
        flip: 0 | 1;
        capacity: number;
      }
    >
  >(new Map());

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

  /**
   * Active SHIFT-DRAG zoom-to-range selection (rubber-band), or `null`.
   * `startX`/`currentX` are canvas-relative CSS px; `viewport` is the viewport
   * the drag started over (the px→time mapping basis). A Shift+pointerdown starts
   * this INSTEAD of a pan; releasing applies the selected time range as the new
   * viewport. The visual band is a cheap positioned DOM element (no waveform
   * repaint) driven by `selectionRect`. Mouse-only enhancement — keyboard users
   * zoom via the existing preset buttons / wheel controls (unchanged).
   */
  const selectionStartRef = useRef<{
    startX: number;
    currentX: number;
    viewport: ViewportRange;
  } | null>(null);

  /**
   * Whether Shift is currently held while the pointer is over the plot, so the
   * cursor flips to a zoom/col-resize style affordance (discoverability). Updated
   * by pointermove/keyboard listeners; independent of an in-flight selection.
   */
  const [shiftZoomArmed, setShiftZoomArmed] = useState(false);

  /**
   * Pixel rect of the live selection band ({left,width} in CSS px relative to the
   * canvas wrapper), or `null` when no selection is in flight. Kept in React
   * state because the band is a DOM element — it repaints only the band, never
   * the waveform stack.
   */
  const [selectionRect, setSelectionRect] = useState<{ left: number; width: number } | null>(null);

  // ── Measure-region overlay state ─────────────────────────────
  //
  // "Measure region" describes EITHER the live viewport (default source) or an
  // explicitly pinned region (Alt-drag / keyboard). Stats compute only when the
  // overlay is active (sticky on, or an Alt peek, or a pinned region exists) and
  // only on the SETTLED viewport — never per wheel/drag frame (perf priority).

  /**
   * An explicitly pinned region (Alt-drag or keyboard `[`/`]`), or `null` when the
   * overlay tracks the viewport. Stays fixed in time across pan/zoom. Transient —
   * never persisted (only the on/off `measureMode` flag is).
   */
  const [measureRegion, setMeasureRegion] = useState<PinnedRegion | null>(null);

  /**
   * Momentary Alt peek: while Alt is held over the plot, chips fade in for the
   * viewport even when sticky mode is off. Released → hidden (unless pinned/sticky).
   */
  const [altPeek, setAltPeek] = useState(false);

  /**
   * Whether the pointer is currently inside the plot area. A ref (not state) so it
   * stays off the hot render path — it is read synchronously by the Alt-keydown
   * handler to gate the peek. Set `true` while the pointer moves over the canvas
   * wrapper and `false` on pointer leave. The whole point of this gate: a bare Alt
   * keydown (e.g. Alt-Tab) must do NOTHING unless the pointer is over the plot, so
   * the overlay never flips on — and stats never compute — at rest.
   */
  const pointerOverPlotRef = useRef(false);

  /**
   * Active ALT-DRAG measure marquee (the persistent sibling of the shift-zoom
   * rubber-band). Same px mechanics as {@link selectionStartRef}; on release it
   * PINS a measure region instead of zooming. `null` when no marquee is in flight.
   */
  const measureMarqueeRef = useRef<{
    startX: number;
    currentX: number;
    viewport: ViewportRange;
  } | null>(null);

  /** Pixel rect of the live ALT-drag marquee, or `null`. Mirrors `selectionRect`. */
  const [measureMarqueeRect, setMeasureMarqueeRect] = useState<{
    left: number;
    width: number;
  } | null>(null);

  /**
   * Pending keyboard region start (session-relative ms) set by `[` and awaiting a
   * closing `]`. Held in a ref so the keydown handler reads it without a stale
   * closure; cleared once `]` pins the region.
   */
  const keyboardRegionStartRef = useRef<number | null>(null);

  /** Whether the responsive "Region statistics" bottom sheet is expanded. */
  const [measureSheetOpen, setMeasureSheetOpen] = useState(false);

  /** Polite aria-live summary pushed on region change (span + first lanes). */
  const [measureAnnouncement, setMeasureAnnouncement] = useState('');

  /**
   * Debounced polite aria-live text announcing the active Measure mode (name + what
   * it shows). `aria-checked` on the segmented control updates immediately; only this
   * spoken text debounces (~250ms) so fast `,`/`.` cycling doesn't spam the SR.
   */
  const [measureModeAnnouncement, setMeasureModeAnnouncement] = useState('');

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

  /**
   * Sticky "Measure" mode, persisted in lane prefs. When on, the stat chips +
   * footer are shown for the active region even with no pointer interaction.
   */
  const measureMode = lanePrefs.measureMode ?? false;

  /**
   * Which statistic the Measure overlay renders (Statistics / Variability / Trend /
   * Distribution / Selection), persisted per session. Single source of truth for the
   * footer segmented control, the `.`/`,` cycle, the per-lane chips, and the SR table.
   * Defaults to `'statistics'` when unset.
   */
  const measureStatMode: MeasureMode = lanePrefs.measureStatMode ?? 'statistics';

  /** Set the active Measure stat mode (persisted in lane prefs). */
  const setMeasureStatMode = useCallback(
    (next: MeasureMode) => {
      setLanePrefs((prev) =>
        (prev.measureStatMode ?? 'statistics') === next ? prev : { ...prev, measureStatMode: next },
      );
    },
    [setLanePrefs],
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

  /** Whether the "no weather for this night" hint has been dismissed this view. */
  const [weatherHintDismissed, setWeatherHintDismissed] = useState(false);

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

  // ── Weather data (independent, read-only — never fetches network) ──
  //
  // The weather integration stores hourly weather/air-quality per civil date. A
  // night can span two civil dates, so we query the anchor date ± 1 day and merge
  // BOTH dates' hourly records (mergeWeather/AirQualityPoints) into one ascending
  // series before aligning to wall-clock. The hook is read-only (no egress).

  const weatherEnabled = useSettingsStore((s) => s.integrations.weather.enabled);
  const weatherUnitsSetting = useSettingsStore((s) => s.integrations.weather.units);

  /** Date range (anchor ± 1 day) covering a midnight-spanning night either way. */
  const weatherDateRange = useMemo(() => {
    if (!weatherEnabled || !wearableDate) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(wearableDate);
    if (!m) return null;
    const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const DAY = 86_400_000;
    const fmtDate = (ms: number): string => {
      const d = new Date(ms);
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${mo}-${day}`;
    };
    return { start: fmtDate(base - DAY), end: fmtDate(base + DAY) };
  }, [weatherEnabled, wearableDate]);

  const { data: weatherTimeseries, loading: weatherLoading } = useWeatherTimeseries(
    weatherEnabled ? ['weather_hourly', 'air_quality_hourly'] : null,
    weatherDateRange,
  );

  /** Merged, ascending, session-relative-ready weather points (both civil dates). */
  const weatherPoints = useMemo<WeatherPoint[]>(() => {
    const records = weatherTimeseries
      .filter((r) => (r.dataType as string) === 'weather_hourly')
      .map((r) => r.data as unknown as WeatherHourly);
    return mergeWeatherPoints(...records);
  }, [weatherTimeseries]);

  /** Merged, ascending air-quality points (both civil dates). */
  const aqiPoints = useMemo<AirQualityPoint[]>(() => {
    const records = weatherTimeseries
      .filter((r) => (r.dataType as string) === 'air_quality_hourly')
      .map((r) => r.data as unknown as AirQualityHourly);
    return mergeAirQualityPoints(...records);
  }, [weatherTimeseries]);

  /** AQI scale to display (US preferred, European fallback). */
  const aqiScale = useMemo<AqiScale>(() => pickAqiScale(aqiPoints), [aqiPoints]);

  /** Display-unit prefs for the cursor readout (storage stays SI/metric). */
  const weatherReadoutUnits = useMemo<WeatherReadoutUnits>(
    () => ({
      temperature: weatherUnitsSetting.temperature,
      pressure: weatherUnitsSetting.pressure,
      wind: weatherUnitsSetting.wind,
    }),
    [weatherUnitsSetting],
  );

  /** Whether any weather/AQI lane has data this night. */
  const anyWeatherData = useMemo(
    () =>
      conditionsHaveData(weatherPoints) ||
      temperatureHasData(weatherPoints) ||
      pressureHasData(weatherPoints) ||
      aqiSeriesHasData(aqiPoints, aqiScale),
    [weatherPoints, aqiPoints, aqiScale],
  );

  /** Weather enabled in Settings but nothing synced for this night yet. */
  const weatherEnabledButEmpty = useMemo(
    () => weatherEnabled && !weatherLoading && !anyWeatherData,
    [weatherEnabled, weatherLoading, anyWeatherData],
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

  const weatherLanes = useMemo<LaneDescriptor[]>(() => {
    const has: Record<string, boolean> = {
      conditions: conditionsHaveData(weatherPoints),
      pressure: pressureHasData(weatherPoints),
      temperature: temperatureHasData(weatherPoints),
      aqi: aqiSeriesHasData(aqiPoints, aqiScale),
    };
    return WEATHER_LANE_SPECS.map((spec) =>
      weatherLaneDescriptor(spec.key, has[spec.key] ?? false),
    );
  }, [weatherPoints, aqiPoints, aqiScale]);

  /** Full catalogue in catalogue order. */
  const allLanes = useMemo<LaneDescriptor[]>(
    () => [...cpapLanes, ...wearableLanes, ...weatherLanes],
    [cpapLanes, wearableLanes, weatherLanes],
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
            // Single pass: sentinel/range-aware empty-channel detection AND
            // finite min/max extent over MEANINGFUL samples only. Excluding
            // non-meaningful samples (e.g. a `-1` probe-off sentinel) from the
            // extent keeps `cpapDisplayDomains` from being skewed by sentinels
            // on partially-valid oximetry channels. The predicate is shared with
            // the Validator (`isMeaningfulSample`) — single source of truth.
            let hasMeaningful = false;
            let lo = Number.POSITIVE_INFINITY;
            let hi = Number.NEGATIVE_INFINITY;
            for (let i = 0; i < data.length; i++) {
              const v = data[i];
              if (v === undefined || !isMeaningfulSample(name, v)) continue;
              hasMeaningful = true;
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

  // ── Initialize hybrid renderer + ResizeObserver via callback refs ────
  //
  // The hybrid renderer (ADR 0019) composes a base Canvas2D chrome canvas and a
  // transparent WebGL2 waveform canvas, so it must be constructed once BOTH are
  // mounted (WebGL needs its canvas at init). Each canvas callback ref records
  // its element and calls `tryInitRenderer`, which constructs the renderer the
  // first time both are present. Mount order between the refs is not guaranteed.

  /**
   * Stable per-channel colour resolver for the WebGL waveform layer. The channel
   * already carries a resolved colour STRING (via `cpapChannelMeta`); we parse it
   * to RGBA here — no getComputedStyle inside the renderer, re-resolved on theme
   * change because the channel's resolved colour re-resolves there.
   */
  const colorResolver = useCallback((ch: SignalChannel): RGBA => parseCssColorToRgba(ch.color), []);

  const tryInitRenderer = useCallback(() => {
    const base = canvasRef.current;
    const waveform = waveformCanvasRef.current;
    // Construct only once BOTH canvases are mounted. The base chrome canvas and
    // the waveform canvas mount in the same commit but their ref callbacks fire
    // in DOM order (base first), so requiring both here prevents constructing the
    // hybrid with a null waveform canvas — which would pin it to the Canvas2D
    // fallback for the lifetime of the view (the `rendererRef.current` guard
    // below blocks reconstruction). The waveform canvas is rendered
    // unconditionally, so this never deadlocks. If WebGL2 is genuinely
    // unavailable at runtime, HybridSignalRenderer still falls back internally.
    if (!base || !waveform) return;
    if (rendererRef.current) return; // already constructed

    const renderer = new HybridSignalRenderer(base, waveform, colorResolver);
    rendererRef.current = renderer;

    if (overlayCanvasRef.current) {
      renderer.setOverlayCanvas(overlayCanvasRef.current);
    }

    const wrapper = base.parentElement;
    if (!wrapper) return;

    if (!observerRef.current) {
      // rAF-coalesce every observed resize, and suppress applies while the
      // sidebar transition animates (a single authoritative trailing apply runs
      // once it ends). setWrapperWidth is a stable useState setter, so the
      // coalescer can be created once here. See resizeCoalescer.ts.
      const coalescer = createResizeCoalescer(
        (width) => setWrapperWidth(width),
        () => document.body.dataset.sidebarAnimating === 'true',
      );
      resizeCoalescerRef.current = coalescer;

      const observer = new ResizeObserver((entries) => {
        // Record only the latest width; the coalescer decides when to apply.
        for (const entry of entries) {
          coalescer.record(entry.contentRect.width);
        }
      });
      observerRef.current = observer;
      observer.observe(wrapper);

      // Initial mount is never animating, so set the first-paint width
      // synchronously (bypassing the coalescer) for correct first paint.
      const rect = wrapper.getBoundingClientRect();
      if (rect.width > 0) setWrapperWidth(rect.width);
    }
  }, [colorResolver]);

  const teardownRenderer = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    // Cancel any pending apply frame AND the post-animation poll so no rAF
    // leaks and no apply fires after teardown/unmount (even mid-animation).
    if (resizeCoalescerRef.current) {
      resizeCoalescerRef.current.cancel();
      resizeCoalescerRef.current = null;
    }
    if (rendererRef.current) {
      rendererRef.current.dispose();
      rendererRef.current = null;
    }
  }, []);

  const canvasCallbackRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      canvasRef.current = canvas;
      if (!canvas) {
        teardownRenderer();
        return;
      }
      tryInitRenderer();
    },
    [tryInitRenderer, teardownRenderer],
  );

  const waveformCanvasCallbackRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      waveformCanvasRef.current = canvas;
      if (canvas) tryInitRenderer();
    },
    [tryInitRenderer],
  );

  // Overlay canvas callback ref. Stores the element and (when the renderer
  // already exists) attaches it immediately; otherwise tryInitRenderer wires it
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
    (
      laneName: string,
      targetPoints: number,
      plotWidth: number,
      range: ViewportRange,
    ): SignalChannel | null => {
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

      const pyramid = pyramidsRef.current.get(laneName);

      // ── Hybrid threshold: envelope (zoomed out) vs polyline (zoomed in) ──
      //
      // Samples-per-pixel = raw in-viewport sample count / plot width. When MORE
      // than ENVELOPE_SAMPLES_PER_PIXEL samples map to each pixel column, the LTTB
      // polyline can skip a 1-sample spike, so we render a per-column MIN/MAX
      // envelope instead (the approved fidelity change). Otherwise (zoomed in) we
      // render the EXACT existing LTTB polyline below — byte-identical to before.
      const columns = Math.max(1, Math.round(plotWidth));
      const rawSpan = endSample - startSample;
      const useEnvelope =
        plotWidth > 0 && rawSpan > columns * ENVELOPE_SAMPLES_PER_PIXEL && pyramid !== undefined;

      // ── Always build the LTTB display data ──────────────────────────────
      //
      // In BOTH modes we keep populating `data` with the LTTB output (selected via
      // the existing pyramid level for `targetPoints`). In envelope mode the
      // renderer draws the envelope for the waveform, but `data` is still the
      // crosshair's value source (getValuesAtTime samples it), so the readout
      // keeps working and reading correctly for envelope lanes. The LTTB path here
      // is byte-identical to before (same level select, same lttbInto scratch).
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
        let scratch = lttbScratchRef.current.get(laneName);
        if (!scratch || scratch.capacity < needed) {
          const capacity = Math.max(needed, targetPoints);
          scratch = {
            a: new Float32Array(capacity),
            b: new Float32Array(capacity),
            flip: 0,
            capacity,
          };
          lttbScratchRef.current.set(laneName, scratch);
        }
        const out = scratch.flip === 0 ? scratch.a : scratch.b;
        scratch.flip = scratch.flip === 0 ? 1 : 0;
        displayData = lttbInto(levelSlice, targetPoints, out);
      } else {
        displayData = levelSlice;
      }

      // ── Envelope (zoomed-out fidelity path) ─────────────────────────────
      //
      // Compute per-column min/max from a pyramid level dense enough to have
      // several samples per pixel column (selected with a target of
      // columns * ENVELOPE_SOURCE_OVERSCAN). The pyramid preserves extrema at
      // every level, so this is faithful AND cheaper than the per-frame LTTB it
      // replaces. Written into per-lane DOUBLE-BUFFERED scratch (same retention
      // rationale as lttbScratchRef) so steady-state drags allocate ~0.
      let envelope: SignalChannel['envelope'] | undefined;
      if (useEnvelope && pyramid) {
        const envTarget = columns * ENVELOPE_SOURCE_OVERSCAN;
        const eslice = selectPyramidLevel(pyramid, startSample, endSample, envTarget);
        const envSource = eslice.data.subarray(eslice.startIndex, eslice.endIndex);
        if (envSource.length > 0) {
          let escr = envelopeScratchRef.current.get(laneName);
          if (!escr || escr.capacity < columns) {
            escr = {
              aMin: new Float32Array(columns),
              aMax: new Float32Array(columns),
              bMin: new Float32Array(columns),
              bMax: new Float32Array(columns),
              flip: 0,
              capacity: columns,
            };
            envelopeScratchRef.current.set(laneName, escr);
          }
          const outMin = escr.flip === 0 ? escr.aMin : escr.bMin;
          const outMax = escr.flip === 0 ? escr.aMax : escr.bMax;
          escr.flip = escr.flip === 0 ? 1 : 0;
          const env = columnEnvelopeInto(envSource, columns, outMin, outMax);
          envelope = { min: env.min, max: env.max, columns: env.columns };
        }
      }

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
      const physicalMin = domain?.min ?? desc.physicalMin;
      const physicalMax = domain?.max ?? desc.physicalMax;

      // ── WebGL whole-level geometry (ADR 0019, Stage 2) ──────────────────
      //
      // For the WebGL2 waveform layer we attach the WHOLE chosen pyramid level (not
      // the per-viewport slice) in a STABLE, absolute session-relative ms domain,
      // so pan/zoom are uniform-only (no per-frame re-upload). The Canvas2D path
      // ignores `webglLane` and keeps drawing the pre-sliced `data`/`envelope`
      // above, so the fallback is byte-identical. We only attach it once a pyramid
      // exists for this lane (before then the hybrid renderer runs Canvas2D-only
      // for this lane, drawing the polyline/envelope above). The chosen level
      // matches the SAME selection the Canvas2D path uses (same targets), so the
      // envelope-vs-line boundary and LOD are consistent across both layers.
      let webglLane: SignalChannel['webglLane'] | undefined;
      if (pyramid && totalSamples > 0 && totalDurationMs > 0) {
        const msPerSampleBase = totalDurationMs / totalSamples;
        if (useEnvelope) {
          const envTarget = columns * ENVELOPE_SOURCE_OVERSCAN;
          const esel = selectPyramidLevel(pyramid, startSample, endSample, envTarget);
          const level = pyramid.levels[esel.levelIndex];
          // Envelope mode requires an interleaved-extrema level (levelIndex ≥ 1);
          // selectPyramidLevel only returns level 0 when zoomed in, where
          // useEnvelope is false — so this is always a real extrema level here.
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
          // Line mode: upload the whole level chosen for `targetPoints`.
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
      }

      return {
        name: laneName,
        data: displayData,
        sampleRate: effectiveSampleRate,
        unit: desc.unit,
        color: meta.resolvedColor,
        physicalMin,
        physicalMax,
        kind: 'cpap',
        render: 'line',
        ...(envelope ? { envelope } : {}),
        ...(webglLane ? { webglLane } : {}),
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
        // Clip the lane's fixed y-range to the session window so merged
        // neighbour-day tails (e.g. an adjacent day's daytime HR) don't inflate
        // it. The full merged series still feeds the rendered line. While
        // totalDurationMs is unmeasured (0), no sample is in-window and the range
        // falls back to per-type defaults; the memo recomputes once it updates.
        { start: 0, end: totalDurationMs },
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
    // totalDurationMs bounds the window-aware wearable y-range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wearableSeries, wallClockEpoch, resolvedTheme, wrapperWidth, totalDurationMs]);

  // ── Memoized base WEATHER channels (viewport-independent) ────
  //
  // Like the wearable lanes, weather lanes are projected onto the session-relative
  // axis once (their hourly samples don't change with pan/zoom). Each weather lane
  // (conditions ribbon, pressure line, temperature dashed line, AQI ribbon) is
  // built keyed by its stable lane id. Ribbon bands (conditions glyphs, AQI rank
  // fill + pattern) are derived here and merged into the renderer's `ribbonBands`.
  const baseWeatherChannels = useMemo(() => {
    const map = new Map<string, BaseWearableEntry>();
    if (!Number.isFinite(wallClockEpoch)) return map;

    const container = containerRef.current;
    const pressureLineWidth = resolveLengthPx(container, '--signal-hero-line-width', 1.6);
    const temperatureLineWidth = resolveLengthPx(container, '--signal-secondary-line-width', 1.2);
    const resolveCol = (cssVar: string): string => resolveColor(container, cssVar);

    const ctx = {
      weatherPoints,
      aqiPoints,
      aqiScale,
      wallClockEpoch,
    } as const;
    const presentation = {
      resolveColor: resolveCol,
      resolveHeight: (token: string): number => resolveLengthPx(container, token, CHANNEL_HEIGHT),
      pressureLineWidth,
      temperatureLineWidth,
    } as const;

    for (const spec of WEATHER_LANE_SPECS) {
      const channel = buildWeatherChannel(spec.key, ctx, presentation);
      if (!channel) continue;

      let ribbonBands: readonly RibbonBand[] | undefined;
      if (spec.key === 'conditions') {
        const bands = conditionBands(weatherPoints, resolveCol);
        if (bands.length > 0) ribbonBands = bands;
      } else if (spec.key === 'aqi') {
        const bands = aqiBands(aqiPoints, aqiScale, resolveCol);
        if (bands.length > 0) ribbonBands = bands;
      }

      const { height: _height, ...base } = channel;
      void _height;
      map.set(spec.id, ribbonBands ? { channel: base, ribbonBands } : { channel: base });
    }
    return map;
    // wrapperWidth + resolvedTheme drive re-resolution of getComputedStyle reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherPoints, aqiPoints, aqiScale, wallClockEpoch, resolvedTheme, wrapperWidth]);

  // ── Build the full ordered channel list + render ─────────────

  /**
   * Ribbon bands (hypnogram + weather conditions/AQI) keyed by channel name,
   * derived once from the viewport-independent base channels. Passing the full
   * set is safe — the renderer only consults bands for channels in a frame.
   */
  const wearableRibbonBands = useMemo(() => {
    const bands: Record<string, readonly RibbonBand[]> = {};
    for (const entry of baseWearableChannels.values()) {
      if (entry.ribbonBands) bands[entry.channel.name] = entry.ribbonBands;
    }
    for (const entry of baseWeatherChannels.values()) {
      if (entry.ribbonBands) bands[entry.channel.name] = entry.ribbonBands;
    }
    return bands;
  }, [baseWearableChannels, baseWeatherChannels]);

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
      // Plot width drives the envelope column count (one column per x pixel) and
      // the samples-per-pixel threshold that selects envelope vs polyline.
      const plotWidth = canvasSize.width - PADDING.left - PADDING.right;

      const channels: SignalChannel[] = [];
      for (const { lane, height } of renderLanes) {
        let channel: SignalChannel | null = null;

        if (lane.group === 'cpap') {
          channel = buildCpapChannel(lane.name, targetPoints, plotWidth, range);
        } else if (lane.group === 'weather') {
          // Weather lane — look up the memoized, viewport-independent base.
          const base = baseWeatherChannels.get(lane.id);
          if (base) {
            channels.push({ ...base.channel, height });
          }
          continue;
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
    [
      manifest,
      canvasSize.width,
      renderLanes,
      buildCpapChannel,
      baseWearableChannels,
      baseWeatherChannels,
    ],
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
      // Wall-clock-as-UTC epoch so the X axis + crosshair label CLOCK time (the
      // recording device's then-current local wall clock), not duration. NaN when
      // the session start is unparseable → renderer falls back to duration labels.
      axisWallClockEpochMs: wallClockEpoch,
      // Live vertical scroll offset of the lane scroll container, so the renderer
      // can pin the crosshair time badge to the top of the VISIBLE area instead of
      // letting it scroll out of view with the full-height overlay canvas. Read
      // fresh per paint so every direct render/overlay uses the current offset.
      viewportScrollTopPx: canvasWrapperRef.current?.scrollTop ?? 0,
    };
  }, [eventMarkers, detectionMarkers, wearableRibbonBands, wallClockEpoch]);

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

  /**
   * Latest CSS-px pan delta (`clientX - panStart.x`) for the active drag, read by
   * the pan paint path so the chrome layer is CSS-translated to follow the drag
   * instead of being re-rendered (ADR 0019 trap fix). Reset to 0 between gestures.
   */
  const panDxRef = useRef(0);

  /**
   * Render a pan FRAME via the hybrid renderer's CSS-translate-chrome + WebGL-
   * uniform path (ADR 0019). The chrome canvas is translated by `dxPx` (no
   * re-render → no per-frame texture re-upload) and the WebGL waveform pans via
   * uniforms. Keeps `lastViewportRef`/`lastOptionsRef` coherent and re-syncs the
   * crosshair overlay, exactly like {@link renderRangeDirect}. On the Canvas2D
   * fallback the renderer re-renders the chrome at the live viewport instead.
   */
  const renderRangeDuringPan = useCallback(
    (range: ViewportRange, dxPx: number): ViewportState | null => {
      const renderer = rendererRef.current;
      if (!renderer) return null;
      const viewportState = buildViewportState(range);
      if (!viewportState) return null;
      const options = buildRenderOptions();
      lastViewportRef.current = viewportState;
      lastOptionsRef.current = options;
      renderer.renderDuringPan(viewportState, options, dxPx);
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
  const renderRangeDuringPanRef = useRef(renderRangeDuringPan);
  renderRangeDuringPanRef.current = renderRangeDuringPan;

  /**
   * Lazily create (once) the shared rAF-coalescing paint scheduler used by BOTH
   * the wheel-zoom and drag-pan hot paths. The paint callback routes through
   * `renderRangeDirectRef` so it always invokes the latest `renderRangeDirect`
   * (which keeps `lastViewportRef`/overlay coherent), never a stale closure.
   *
   * During an ACTIVE pan it routes to the pan path instead (CSS-translate chrome +
   * WebGL uniform), reading the latest `panDxRef` so the chrome tracks the drag
   * without a per-frame re-render. `panStartRef !== null` distinguishes a pan from
   * a wheel-zoom (which never sets it).
   */
  const getPaintScheduler = useCallback((): FramePaintScheduler => {
    let scheduler = paintSchedulerRef.current;
    if (!scheduler) {
      scheduler = createFramePaintScheduler((range) => {
        if (panStartRef.current) {
          renderRangeDuringPanRef.current(range, panDxRef.current);
        } else {
          renderRangeDirectRef.current?.(range);
        }
      });
      paintSchedulerRef.current = scheduler;
    }
    return scheduler;
  }, []);

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

      // Device-aware, GENTLE zoom factor: exp(-normalizedDelta * WHEEL_ZOOM_RATE)
      // (see signalZoom). Mouse-wheel notches (DOM_DELTA_LINE) and trackpad pinch
      // pixel streams (DOM_DELTA_PIXEL) are normalized to a common magnitude so
      // neither feels jumpy, and the per-event delta is clamped so one fat delta
      // can't teleport the zoom. The factor composes multiplicatively across the
      // accumulating live viewport, and cursor-anchored zoom keeps the time under
      // the pointer fixed. Sensitivity is the single WHEEL_ZOOM_RATE knob.
      const factor = wheelDeltaToZoomFactor(e.deltaY, e.deltaMode);
      const range = applyCursorAnchoredZoom(prev, factor, cursorFrac, totalDurationMs);
      liveViewportRef.current = range;

      // Coalesce paints to one per frame via the shared scheduler (same handle
      // the pan path uses).
      getPaintScheduler().schedule(range);

      // (Re)arm the trailing commit so the settled viewport reaches React state
      // exactly once after the gesture stops — matching what was last painted.
      if (wheelCommitTimerRef.current !== null) {
        window.clearTimeout(wheelCommitTimerRef.current);
      }
      wheelCommitTimerRef.current = window.setTimeout(() => {
        wheelCommitTimerRef.current = null;
        // Cancel any frame still pending and paint the final viewport once more
        // so committed state == last painted frame.
        getPaintScheduler().cancel();
        if (liveViewportRef.current) renderRangeDirect(liveViewportRef.current);
        commitLiveViewport();
      }, WHEEL_COMMIT_DELAY_MS);
    };

    wrapper.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      wrapper.removeEventListener('wheel', onWheel);
      paintSchedulerRef.current?.cancel();
      if (wheelCommitTimerRef.current !== null) {
        window.clearTimeout(wheelCommitTimerRef.current);
        wheelCommitTimerRef.current = null;
        // A wheel gesture had settled but its trailing commit hadn't fired yet.
        // Flush it now so a re-subscribe (deps change) doesn't drop the settled
        // viewport and let the render effect snap back to stale state.
        commitLiveViewport();
      }
    };
  }, [totalDurationMs, renderRangeDirect, commitLiveViewport, getPaintScheduler]);

  // ── Crosshair time-badge scroll-pin (overlay re-paint on scroll) ──
  //
  // The lane stack lives in a scrollable container and the overlay canvas is the
  // full content height, so the crosshair time badge — drawn once at the top of the
  // visible area — must be REPOSITIONED as the user scrolls, or it drifts. The
  // badge Y already folds in `viewportScrollTopPx` (read live in buildRenderOptions),
  // so we just need to re-paint the overlay when the scroll offset changes WHILE a
  // crosshair is active. This follows the same direct-paint, ref-driven model as the
  // hover path (no React state, no base-layer re-render) and coalesces bursts of
  // scroll events into at most one overlay paint per animation frame.
  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;

    let rafId: number | null = null;
    const paint = () => {
      rafId = null;
      const renderer = rendererRef.current;
      const viewport = lastViewportRef.current;
      const crosshairX = crosshairXRef.current;
      // Nothing to reposition when no crosshair is showing (cheap early return).
      if (!renderer || !viewport || crosshairX === null) return;
      renderer.renderOverlay(viewport, {
        ...buildRenderOptions(),
        showCrosshair: true,
        crosshairX,
      });
    };

    const onScroll = () => {
      // Skip entirely when no crosshair is active — scrolling without a hover does
      // not need an overlay paint.
      if (crosshairXRef.current === null) return;
      if (rafId !== null) return; // already scheduled this frame
      rafId = requestAnimationFrame(paint);
    };

    wrapper.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      wrapper.removeEventListener('scroll', onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [buildRenderOptions]);

  // ── Shift-key cursor affordance (window-level keyup) ─────────
  //
  // Releasing Shift anywhere drops the "zoom-to-range" cursor affordance even if
  // the pointer is parked over the plot (a pointermove may not follow). An
  // IN-FLIGHT selection is intentionally NOT cancelled here — releasing Shift
  // mid-drag still completes on pointerup (less surprising: the user already drew
  // the band). The window-level keyup just keeps the cursor honest.
  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftZoomArmed(false);
    };
    window.addEventListener('keyup', onKeyUp);
    return () => window.removeEventListener('keyup', onKeyUp);
  }, []);

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

      // A press over the wrapper means the pointer is over the plot — keep the
      // Alt-peek gate in sync even if no pointermove preceded this down.
      pointerOverPlotRef.current = true;

      // SHIFT+drag starts a zoom-to-range SELECTION instead of a pan. The band is
      // drawn as a cheap DOM element; on release the pixel range is converted to a
      // time range and applied as the viewport. A plain drag (no Shift) pans.
      if (e.shiftKey) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        selectionStartRef.current = { startX: x, currentX: x, viewport: { ...viewport } };
        // Capture so the drag keeps tracking even when the pointer leaves the
        // canvas (pointer-capture); see handlePointerMove/Up.
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        // Seed a zero-width band at the anchor; widened on move.
        setSelectionRect(null);
        return;
      }

      // ALT(Option)+drag starts a MEASURE marquee — same px mechanics as the
      // shift-zoom band, but on release it PINS a measure region instead of
      // zooming (Shift stays zoom; Alt stays measure). A press-and-hold without a
      // drag is a peek (handled by the Alt-peek listener); a drag pins.
      if (e.altKey) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        measureMarqueeRef.current = { startX: x, currentX: x, viewport: { ...viewport } };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setMeasureMarqueeRect(null);
        return;
      }

      setIsPanning(true);
      panStartRef.current = { x: e.clientX, viewport: { ...viewport } };
      panDxRef.current = 0;
      // Enter CSS-translate-chrome pan mode (ADR 0019): while the drag is active
      // the chrome layer is translated, not re-rendered, so it never re-uploads.
      rendererRef.current?.beginPan();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [viewport],
  );

  /**
   * Apply (or discard) the active shift-drag selection. Converts the pixel
   * x-range to a clamped, min-span-floored time range via the pure
   * {@link pixelRangeToTimeRange} helper and commits it to the viewport. A drag
   * shorter than the helper's minimum (or a shift-click) is a no-op so the
   * viewport never snaps to a sliver. Always clears the band + selection ref.
   */
  const finishSelection = useCallback(() => {
    const sel = selectionStartRef.current;
    selectionStartRef.current = null;
    setSelectionRect(null);
    if (!sel) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const plotWidth = rect.width - PADDING.left - PADDING.right;
    const result = pixelRangeToTimeRange(
      sel.startX,
      sel.currentX,
      PADDING.left,
      plotWidth,
      sel.viewport,
      totalDurationMs,
    );
    if (result.kind === 'zoom') {
      setViewport(result.range);
    }
  }, [totalDurationMs]);

  /**
   * Apply (or discard) the active ALT-drag measure marquee. Reuses the SAME
   * pixel→time conversion as {@link finishSelection}, but instead of zooming it
   * PINS the resulting time range as a measure region (`source='selection'`) and
   * keeps the dashed band visible. A drag shorter than the helper's minimum (or an
   * Alt-click) is a no-op so a stray click never pins a sliver. Always clears the
   * marquee ref + rect.
   */
  const finishMeasureMarquee = useCallback(() => {
    const sel = measureMarqueeRef.current;
    measureMarqueeRef.current = null;
    setMeasureMarqueeRect(null);
    if (!sel) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const plotWidth = rect.width - PADDING.left - PADDING.right;
    const result = pixelRangeToTimeRange(
      sel.startX,
      sel.currentX,
      PADDING.left,
      plotWidth,
      sel.viewport,
      totalDurationMs,
    );
    if (result.kind === 'zoom') {
      // `range` is already session-relative ms (same axis as the viewport).
      setMeasureRegion({ startMs: result.range.startTime, endMs: result.range.endTime });
      keyboardRegionStartRef.current = null;
    }
  }, [totalDurationMs]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      // The pointer is over the plot — gate for the Alt-peek handler (so bare Alt
      // outside the plot, e.g. Alt-Tab, never activates the overlay).
      pointerOverPlotRef.current = true;

      const x = e.clientX - rect.left;
      crosshairXRef.current = x;

      // ACTIVE SHIFT-DRAG SELECTION: update the band's pixel rect (clamped to the
      // plot band) and skip the crosshair/pan paths entirely. The band is a DOM
      // element so this repaints only the band, never the waveform stack.
      const sel = selectionStartRef.current;
      if (sel) {
        const plotLeft = PADDING.left;
        const plotRight = rect.width - PADDING.right;
        const clampedX = Math.max(plotLeft, Math.min(plotRight, x));
        sel.currentX = clampedX;
        const left = Math.min(sel.startX, clampedX);
        const width = Math.abs(clampedX - sel.startX);
        setSelectionRect({ left, width });
        return;
      }

      // ACTIVE ALT-DRAG MEASURE MARQUEE: identical band mechanics, but on release
      // it pins a measure region rather than zooming. Only the band repaints.
      const mq = measureMarqueeRef.current;
      if (mq) {
        const plotLeft = PADDING.left;
        const plotRight = rect.width - PADDING.right;
        const clampedX = Math.max(plotLeft, Math.min(plotRight, x));
        mq.currentX = clampedX;
        const left = Math.min(mq.startX, clampedX);
        const width = Math.abs(clampedX - mq.startX);
        setMeasureMarqueeRect({ left, width });
        return;
      }

      // Keep the shift-zoom cursor affordance in sync with the modifier state
      // while hovering (no selection in flight). Only toggles state on change.
      setShiftZoomArmed((armed) => (armed === e.shiftKey ? armed : e.shiftKey));

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
        // EFFECTIVE chrome translate (ADR 0019 trap fix): the chrome canvas is
        // CSS-translated to follow the pan WITHOUT a re-render. It must track the
        // ACTUAL viewport delta (which clamps at the session edges), not the raw
        // pointer dx — otherwise the chrome would keep sliding past the edge while
        // the (clamped) waveform stops. Derive it from the committed viewport
        // delta so chrome and waveform stay locked together.
        panDxRef.current =
          vpDuration > 0 ? -((newStart - startVP.startTime) / vpDuration) * plotWidth : 0;
        // crosshairXRef is already set above; the scheduled pan paint picks it up.
        // PAN HOT PATH: high-rate pointers (120–1000 Hz) fire many moves per
        // displayed frame, so we coalesce to AT MOST ONE pan frame per animation
        // frame via the shared scheduler. While a pan is active the scheduler
        // routes to renderRangeDuringPan (CSS-translate chrome + WebGL uniform).
        getPaintScheduler().schedule(range);
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
    [isPanning, totalDurationMs, updateHoveredRegion, getPaintScheduler],
  );

  const handlePointerUp = useCallback(() => {
    // A shift-drag selection takes precedence over a pan: apply (or discard) it.
    if (selectionStartRef.current) {
      finishSelection();
      return;
    }
    // An ALT-drag measure marquee likewise takes precedence: pin (or discard) it.
    if (measureMarqueeRef.current) {
      finishMeasureMarquee();
      return;
    }
    setIsPanning(false);
    panStartRef.current = null;
    panDxRef.current = 0;
    // Settle the pan: flush any pending coalesced pan frame, then exit pan mode
    // (repaints chrome at the settled viewport + clears the CSS translate, flash-
    // free), then commit the viewport to React state.
    paintSchedulerRef.current?.cancel();
    rendererRef.current?.endPan();
    commitLiveViewport();
  }, [commitLiveViewport, finishSelection, finishMeasureMarquee]);

  const handlePointerLeave = useCallback(() => {
    crosshairXRef.current = null;
    // The pointer has left the plot — close the Alt-peek gate.
    pointerOverPlotRef.current = false;
    // If a bare-Alt peek was the ONLY reason the overlay was showing (sticky off,
    // nothing pinned), clear it so the overlay doesn't linger after the pointer
    // leaves — even if Alt is still physically held.
    if (!measureMode && measureRegion === null) {
      setAltPeek(false);
    }
    // Drop the shift-cursor affordance once the pointer leaves the plot.
    setShiftZoomArmed(false);
    // A selection in flight when the pointer leaves WITHOUT pointer-capture (the
    // capture normally keeps events flowing): apply what was selected so the
    // gesture completes gracefully rather than silently vanishing. With capture
    // active this rarely fires mid-drag — pointerup handles the common case.
    if (selectionStartRef.current) {
      finishSelection();
    }
    // Same graceful completion for an in-flight ALT-drag measure marquee.
    if (measureMarqueeRef.current) {
      finishMeasureMarquee();
    }
    // Clear the hovered-region readout (only if it isn't already empty) and reset
    // the identity ref so the next hover re-enters cleanly.
    if (hoveredKeyRef.current !== '') {
      hoveredKeyRef.current = '';
      setHoveredRegion(EMPTY_HOVERED_REGION);
    }
    // If a pan was in flight (pointer left the wrapper / capture lost), settle it
    // (exit pan mode → repaint chrome at the settled viewport + clear translate)
    // and commit before clearing so the displayed window persists.
    if (isPanning) {
      panDxRef.current = 0;
      paintSchedulerRef.current?.cancel();
      rendererRef.current?.endPan();
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
  }, [
    isPanning,
    commitLiveViewport,
    finishSelection,
    finishMeasureMarquee,
    measureMode,
    measureRegion,
  ]);

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

      // Lead with CLOCK time (matching the axis + crosshair), then the natural
      // duration-into-session. Append the date when the cursor sits in a calendar
      // day after the session's start day (e.g. `, Jun 18`), so a cursor that has
      // crossed midnight is unambiguous. Falls back to elapsed seconds when no
      // valid wall-clock epoch is available.
      const useWallClock = !Number.isNaN(wallClockEpoch);
      let lead: string;
      if (useWallClock) {
        const clock = formatWallClockLabel(wallClockEpoch, timeMs, true);
        const elapsed = spokenElapsed(timeMs);
        const startDay = formatWallClockDate(wallClockEpoch);
        const cursorDay = formatWallClockDate(wallClockEpoch + timeMs);
        const dateClause = cursorDay !== startDay ? `, ${cursorDay}` : '';
        lead = `At ${clock}${dateClause}, ${elapsed} into session: ${parts.join('; ') || 'no data'}`;
      } else {
        const elapsedSec = Math.round(timeMs / 1000);
        lead = `At ${elapsedSec}s: ${parts.join('; ') || 'no data'}`;
      }

      // Append the weather/AQI clause — the required NON-VISUAL path for the
      // colour-encoded weather lanes (temp, pressure, dew point, wind, condition
      // word, and "Air quality: {word}, AQI {value}" — word + number, never a
      // bare value). Computed from the merged hourly samples at the cursor's
      // wall-clock time, since dew point / wind / condition aren't their own
      // lanes. Only spoken when a sample is near the cursor and a wall clock exists.
      if (useWallClock) {
        const weatherClause = weatherCursorReadout(
          wallClockEpoch + timeMs,
          weatherPoints,
          aqiPoints,
          aqiScale,
          weatherReadoutUnits,
        );
        if (weatherClause) regionParts.push(weatherClause);
      }

      setCursorReadout(regionParts.length > 0 ? `${lead} — ${regionParts.join('; ')}` : lead);
    },
    [
      canvasSize.width,
      findHoveredRegion,
      wallClockEpoch,
      weatherPoints,
      aqiPoints,
      aqiScale,
      weatherReadoutUnits,
    ],
  );

  const handleCanvasKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // KEYBOARD REGION DEFINITION (a11y path for the mouse-only Alt-drag):
      // `[` sets the region start at the data cursor, `]` sets the end. Announced
      // via the existing polite cursor live region. The cursor time defaults to
      // the viewport centre when the user hasn't moved it with the arrow keys.
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        const vp = lastViewportRef.current;
        if (!vp) return;
        const span = vp.endTime - vp.startTime;
        if (span <= 0) return;
        const t = cursorTimeRef.current ?? vp.startTime + span / 2;
        const clock = Number.isNaN(wallClockEpoch)
          ? `${Math.round(t / 1000)}s`
          : formatWallClockLabel(wallClockEpoch, t, true);
        if (e.key === '[') {
          keyboardRegionStartRef.current = t;
          setCursorReadout(`Region start set at ${clock}`);
        } else {
          const start = keyboardRegionStartRef.current;
          if (start === null) {
            setCursorReadout('Set a region start with the left-bracket key first.');
            return;
          }
          const startMs = Math.min(start, t);
          const endMs = Math.max(start, t);
          setMeasureRegion({ startMs, endMs });
          keyboardRegionStartRef.current = null;
          const mins = Math.max(1, Math.round((endMs - startMs) / 60000));
          setCursorReadout(`Region end set; measuring ${mins} minute${mins === 1 ? '' : 's'}`);
        }
        return;
      }

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
    [announceAtTime, wallClockEpoch],
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
    // `formatOffsetLabel` (the visible-window DURATION) is shared with the
    // deep-link announcement so the on-screen label and the framed-event aria-live
    // copy use identical duration formatting.
    const span = formatOffsetLabel(durMs);
    // Lead with the visible CLOCK range (device local wall clock) so seeing the
    // window's clock time is immediate, with the duration as a trailing `· <span>`.
    // Falls back to duration-only when no valid wall-clock epoch is available.
    if (Number.isNaN(wallClockEpoch)) return span;
    const from = formatWallClockLabel(wallClockEpoch, viewport.startTime, false);
    const to = formatWallClockLabel(wallClockEpoch, viewport.endTime, false);
    return `${from} – ${to} · ${span}`;
  }, [viewport, wallClockEpoch]);

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
      // `wallClockEpoch` is passed so the displayed clock matches the axis exactly.
      segments.push(`▮ ${eventReadoutText(event, sessionStartMs, !both, wallClockEpoch)}`);
      fullSegments.push(`▮ ${eventReadoutText(event, sessionStartMs, true, wallClockEpoch)}`);
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
  }, [hoveredRegion, sessionStartMs, wallClockEpoch]);

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

  // ── Measure-region overlay: active region, sources, stats ────

  /**
   * Whether the overlay is currently active (chips/footer rendered + stats
   * computed). True when sticky `measureMode` is on, OR an Alt peek is held, OR a
   * region is pinned. When false the overlay renders nothing (zero cost at rest).
   */
  const measureActive = measureMode || altPeek || measureRegion !== null;

  /**
   * The region the stats describe, session-relative ms, half-open `[startMs, endMs)`.
   * A pinned region wins; otherwise it tracks the SETTLED viewport (this memo is
   * keyed on `viewport` state, which the pan/wheel hot paths only commit once the
   * gesture settles — so stats never recompute per frame).
   */
  const measureRegionRange = useMemo<{
    startMs: number;
    endMs: number;
    source: MeasureRegionSource;
  }>(
    () =>
      measureRegion
        ? { startMs: measureRegion.startMs, endMs: measureRegion.endMs, source: 'selection' }
        : { startMs: viewport.startTime, endMs: viewport.endTime, source: 'viewport' },
    [measureRegion, viewport.startTime, viewport.endTime],
  );

  /**
   * Data sources for the stats model, resolved once per relevant input change.
   * CPAP buffers come from `fullDataRef` (a ref — read on each rebuild, keyed on
   * `manifest`/`fullDataReady` which change wholesale on session load). Wearable
   * NUMERIC lanes are pre-clipped to the active region's in-region values (the
   * cadence is irregular, so we cannot use a uniform time→index map); the
   * hypnogram step series and events are projected to session-relative ms.
   */
  const measureSources = useMemo<MeasureDataSources>(() => {
    // Genuinely zero-cost at rest: build nothing while the overlay is inactive.
    const empty: MeasureDataSources = {
      cpap: new Map(),
      wearableNumeric: new Map(),
      categorical: new Map(),
      events: [],
    };
    if (!measureActive) return empty;

    const cpap = new Map<string, { descriptor: NumericChannelInput; data: Float32Array }>();
    for (const [name, fcd] of fullDataRef.current) {
      cpap.set(name, {
        descriptor: {
          name: fcd.descriptor.name,
          unit: fcd.descriptor.unit,
          sampleRate: fcd.descriptor.sampleRate,
          data: fcd.data,
        },
        data: fcd.data,
      });
    }

    const categorical = new Map<string, readonly CategoricalSample[]>();
    const wearableNumeric = new Map<
      string,
      { channel: NumericChannelInput; timesMs: Float64Array }
    >();
    if (Number.isFinite(wallClockEpoch)) {
      for (const spec of WEARABLE_LANE_SPECS) {
        const series = wearableSeries[spec.dataType];
        if (!series || series.samples.length === 0) continue;
        const laneId = `wear:${spec.dataType}`;
        if (spec.dataType === 'sleep_stages') {
          categorical.set(
            laneId,
            series.samples.map((s) => ({
              timeMs: s.timestampMs - wallClockEpoch,
              value: s.value,
            })),
          );
        } else {
          // Clip to the active region and pack the in-region values compactly.
          // Carry the PARALLEL session-relative time of each kept sample so the
          // model can fit a correct Trend slope against true (irregular) cadence —
          // a synthetic uniform Δt would yield a wrong wearable slope. The clip
          // already computes `t` per sample, so retaining it is free.
          const values: number[] = [];
          const times: number[] = [];
          for (const s of series.samples) {
            const t = s.timestampMs - wallClockEpoch;
            if (t >= measureRegionRange.startMs && t < measureRegionRange.endMs) {
              values.push(s.value);
              times.push(t);
            }
          }
          // NOTE — intentional divergence from the CPAP path's sentinel handling:
          // wearable intraday channel names (`heart_rate_intraday`, `spo2_intraday`,
          // …) are NOT keys in MEANINGFUL_SAMPLE_RANGES, so downstream
          // `isMeaningfulSample` applies only its non-zero rule for them (the
          // physiologic range-filter is a no-op). That is safe here: wearable samples
          // are range-validated upstream at import, so no out-of-range sentinels reach
          // this buffer. A future reader should NOT assume range filtering runs on
          // these lanes the way it does for CPAP channels.
          wearableNumeric.set(laneId, {
            channel: {
              name: spec.dataType,
              unit: spec.unit,
              sampleRate: 1,
              data: Float32Array.from(values),
            },
            timesMs: Float64Array.from(times),
          });
        }
      }
    }

    const eventInputs: EventInput[] = events.map((ev) => ({
      startTimeMs: ev.timestamp - sessionStartMs,
      type: ev.type,
      durationMs: ev.duration * 1000,
    }));

    return { cpap, wearableNumeric, categorical, events: eventInputs };
    // fullDataRef is a ref; manifest/fullDataReady gate when its buffers are present.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    measureActive,
    manifest,
    fullDataReady,
    wearableSeries,
    wallClockEpoch,
    events,
    sessionStartMs,
    measureRegionRange.startMs,
    measureRegionRange.endMs,
  ]);

  /**
   * Per-lane region statistics for the active region. Computed ONLY when the
   * overlay is active — `null` otherwise so there is genuinely zero cost at rest.
   * Numeric medians are exact and bounded to ~tens of ms for a whole night (see
   * regionStats), acceptable on the main thread on settle. FUTURE: a Web Worker
   * could offload this if a pathological multi-night region ever janks.
   */
  const measureLaneStats = useMemo<MeasureLaneStat[] | null>(() => {
    if (!measureActive) return null;
    if (measureRegionRange.endMs <= measureRegionRange.startMs) return [];
    return buildMeasureLaneStats(
      renderLanes,
      { startMs: measureRegionRange.startMs, endMs: measureRegionRange.endMs },
      measureSources,
      measureStatMode,
    );
    // Keyed additionally on the active mode: only the active mode's metrics are
    // computed lazily (each mode is a distinct `RegionStats.kind`), recomputed on a
    // settled viewport / region pin / mode change — never per wheel/drag frame.
  }, [measureActive, measureRegionRange, renderLanes, measureSources, measureStatMode]);

  /** Event count in the active region (surfaced once in the footer/table). */
  const measureEventCount = useMemo(() => {
    if (!measureActive) return 0;
    const { startMs, endMs } = measureRegionRange;
    if (endMs <= startMs) return 0;
    let n = 0;
    for (const e of measureSources.events) {
      if (e.startTimeMs >= startMs && e.startTimeMs < endMs) n++;
    }
    return n;
  }, [measureActive, measureRegionRange, measureSources]);

  /**
   * Total sample count across numeric lanes in the active region — the footer's
   * `n =` figure. Sums each numeric lane's meaningful-sample count.
   */
  const measureSampleCount = useMemo(() => {
    if (!measureLaneStats) return 0;
    let n = 0;
    for (const s of measureLaneStats) {
      if (s.stats.kind === 'numeric') n += s.stats.count;
    }
    return n;
  }, [measureLaneStats]);

  /**
   * Push a concise polite announcement whenever the active region (or its source)
   * changes while the overlay is active: span + first 2–3 lanes + a pointer to the
   * full table. Debounced via the memoised region so it fires once per settle.
   */
  useEffect(() => {
    if (!measureActive || !measureLaneStats) {
      setMeasureAnnouncement('');
      return;
    }
    const { startMs, endMs, source } = measureRegionRange;
    const span = formatDuration(Math.round((endMs - startMs) / 1000));
    const clockClause = Number.isNaN(wallClockEpoch)
      ? ''
      : ` from ${formatWallClockLabel(wallClockEpoch, startMs, false)} to ${formatWallClockLabel(
          wallClockEpoch,
          endMs,
          false,
        )}`;
    const sourceWord = source === 'selection' ? 'Pinned region' : 'Viewport';
    const laneSummaries = measureLaneStats
      .map((s) => laneStatSummary(s))
      .filter((x): x is string => x !== null)
      .slice(0, 3);
    const eventClause =
      measureEventCount > 0
        ? `; ${measureEventCount} event${measureEventCount === 1 ? '' : 's'}`
        : '';
    setMeasureAnnouncement(
      `${sourceWord}: ${span}${clockClause}. ${laneSummaries.join('; ')}${eventClause}. ` +
        `Open the Region statistics table for all lanes.`,
    );
  }, [measureActive, measureLaneStats, measureRegionRange, measureEventCount, wallClockEpoch]);

  /**
   * Debounced spoken announcement of the active Measure mode. Fires ~250ms after the
   * last mode switch (so cycling fast with `,`/`.` announces once, not per step),
   * announcing the mode name + what it shows + the region descriptor. The visible
   * segmented control's `aria-checked` is the immediate indicator; this is the spoken
   * confirmation. Cleared when the overlay is inactive.
   */
  useEffect(() => {
    if (!measureActive) {
      setMeasureModeAnnouncement('');
      return;
    }
    const name = MEASURE_MODE_NAME[measureStatMode];
    const desc = MEASURE_MODE_DESCRIPTION[measureStatMode];
    const sourceWord = measureRegionRange.source === 'selection' ? 'pinned region' : 'viewport';
    const handle = window.setTimeout(() => {
      setMeasureModeAnnouncement(`${name} mode: showing ${desc} for the ${sourceWord}.`);
    }, MEASURE_MODE_ANNOUNCE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [measureActive, measureStatMode, measureRegionRange.source]);

  /**
   * Pixel rect ({left,width} CSS px in the canvas wrapper) of a PINNED measure
   * region, for the dashed band. `null` when there is no pinned region or it is
   * entirely off-screen (the footer then shows an off-screen chevron pill). Tracks
   * the live viewport so the band stays locked to its time span across pan/zoom.
   */
  const measureBandRect = useMemo<{ left: number; width: number } | null>(() => {
    if (!measureRegion) return null;
    const span = viewport.endTime - viewport.startTime;
    if (span <= 0 || canvasSize.width <= 0) return null;
    const plotLeft = PADDING.left;
    const plotWidth = canvasSize.width - PADDING.left - PADDING.right;
    if (plotWidth <= 0) return null;
    const startFrac = (measureRegion.startMs - viewport.startTime) / span;
    const endFrac = (measureRegion.endMs - viewport.startTime) / span;
    // Clamp to the plot band; the band is hidden only when fully outside.
    if (endFrac < 0 || startFrac > 1) return null;
    const leftPx = plotLeft + Math.max(0, Math.min(1, startFrac)) * plotWidth;
    const rightPx = plotLeft + Math.max(0, Math.min(1, endFrac)) * plotWidth;
    return { left: leftPx, width: Math.max(0, rightPx - leftPx) };
  }, [measureRegion, viewport.startTime, viewport.endTime, canvasSize.width]);

  /**
   * Direction a PINNED region sits relative to the visible viewport when it is
   * entirely off-screen: `'before'` (earlier in time, to the left) or `'after'`
   * (later, to the right). `null` when no region is pinned or it is at least
   * partly visible. Drives the footer's directional chevron pill.
   */
  const measureOffscreen = useMemo<'before' | 'after' | null>(() => {
    if (!measureRegion) return null;
    if (measureRegion.endMs <= viewport.startTime) return 'before';
    if (measureRegion.startMs >= viewport.endTime) return 'after';
    return null;
  }, [measureRegion, viewport.startTime, viewport.endTime]);

  /** Whether to use the responsive bottom-sheet fallback instead of per-lane chips. */
  const measureUseSheet = canvasSize.width > 0 && canvasSize.width < MEASURE_SHEET_BREAKPOINT;

  // ── Measure-region handlers ──────────────────────────────────

  /** Toggle sticky Measure mode (persisted). Also drives the `M` key + toolbar button. */
  const toggleMeasureMode = useCallback(() => {
    setLanePrefs((prev) => ({ ...prev, measureMode: !(prev.measureMode ?? false) }));
  }, []);

  /** Clear a pinned region (revert to viewport source). Keeps Measure on/off as-is. */
  const clearMeasureRegion = useCallback(() => {
    setMeasureRegion(null);
    keyboardRegionStartRef.current = null;
    setMeasureMarqueeRect(null);
    measureMarqueeRef.current = null;
  }, []);

  /**
   * Scroll a pinned, off-screen region back into view (footer chevron pill). Pans
   * the viewport to centre the region, honouring reduced-motion for any smoothing.
   */
  const scrollToMeasureRegion = useCallback(() => {
    if (!measureRegion || totalDurationMs <= 0) return;
    const center = (measureRegion.startMs + measureRegion.endMs) / 2;
    const span = viewport.endTime - viewport.startTime;
    let start = center - span / 2;
    let end = center + span / 2;
    if (start < 0) {
      start = 0;
      end = span;
    }
    if (end > totalDurationMs) {
      end = totalDurationMs;
      start = Math.max(0, end - span);
    }
    setViewport({ startTime: start, endTime: end });
  }, [measureRegion, viewport.startTime, viewport.endTime, totalDurationMs]);

  // ── Selection-mode precise timing + copy ─────────────────────

  /**
   * The precise (ms-resolution) GLOBAL timing string for the active region, shown in
   * the footer ONLY in Selection mode: `start <…> · dur <…> · end <…>`. Wall-clock
   * when available, else session-relative (mirrors the footer's wall-clock fallback).
   */
  const measurePreciseTiming = useMemo(
    () =>
      buildPreciseTimingString(
        wallClockEpoch,
        measureRegionRange.startMs,
        measureRegionRange.endMs,
      ),
    [wallClockEpoch, measureRegionRange.startMs, measureRegionRange.endMs],
  );

  /** Whether the "Copied" confirmation is currently shown on the copy button. */
  const [timingCopied, setTimingCopied] = useState(false);
  /** aria-live confirmation text for the copy action (cleared shortly after). */
  const [timingCopyStatus, setTimingCopyStatus] = useState('');
  const timingCopyTimerRef = useRef<number | null>(null);

  /**
   * Copy the precise region-timing string to the clipboard. Shows a brief "Copied"
   * confirmation (icon swap + aria-live). The clipboard promise can reject (denied
   * permission / insecure context); that is handled gracefully with a spoken error
   * and no thrown rejection.
   */
  const copyPreciseTiming = useCallback(() => {
    const reset = () => {
      if (timingCopyTimerRef.current !== null) window.clearTimeout(timingCopyTimerRef.current);
      timingCopyTimerRef.current = window.setTimeout(() => {
        setTimingCopied(false);
        setTimingCopyStatus('');
      }, 1800);
    };
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      setTimingCopyStatus('Copy unavailable in this browser.');
      reset();
      return;
    }
    clipboard.writeText(measurePreciseTiming).then(
      () => {
        setTimingCopied(true);
        setTimingCopyStatus('Region timing copied to the clipboard.');
        reset();
      },
      () => {
        setTimingCopied(false);
        setTimingCopyStatus('Could not copy region timing.');
        reset();
      },
    );
  }, [measurePreciseTiming]);

  // Clean up a pending copy-confirmation timer on unmount.
  useEffect(() => {
    return () => {
      if (timingCopyTimerRef.current !== null) window.clearTimeout(timingCopyTimerRef.current);
    };
  }, []);

  // ── Global keyboard shortcuts: 'L' lanes drawer, 'M' measure ─

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      // Same guard the lanes drawer uses: never hijack typing in a field.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (e.key === 'l' || e.key === 'L') {
        setDrawerOpen((o) => !o);
      } else if (e.key === 'm' || e.key === 'M') {
        toggleMeasureMode();
      } else if (e.key === '.' || e.key === ',') {
        // Cycle the Measure mode forward (`.`) / back (`,`) — only while the overlay
        // is active. Ignore autorepeat so a held key doesn't spin through modes.
        if (e.repeat) return;
        if (!measureActive) return;
        const delta = e.key === '.' ? 1 : -1;
        setMeasureStatMode(cycleMeasureMode(measureStatMode, delta));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleMeasureMode, measureActive, measureStatMode, setMeasureStatMode]);

  // ── Alt-peek + Escape (two-step clear) for the measure overlay ─
  //
  // HOLD Alt over the plot → momentary peek (chips fade in for the viewport even
  // when sticky mode is off); release hides them (unless pinned / sticky on). Alt
  // is ALSO the marquee modifier (press-and-drag pins a region), so the peek state
  // is purely additive — a drag that follows still pins. Escape is a two-step:
  // a pinned region clears first; otherwise sticky Measure turns off.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        // Ignore keyboard autorepeat (cleanliness — the set is idempotent anyway).
        if (e.repeat) return;
        // Gate the peek on the pointer being OVER THE PLOT (the spec's intent:
        // "hold Alt over the plot"). A bare Alt elsewhere — most commonly Alt-Tab —
        // must NOT activate the overlay or trigger a stats pass. The Alt+drag
        // marquee is unaffected: it starts from a pointerdown over the plot, so the
        // ref is already true there.
        if (!pointerOverPlotRef.current) return;
        // BUGFIX (Alt-peek only firing once): a lone Alt keydown is the browser's
        // "focus the menu bar" accelerator (Chromium/Firefox). Without
        // preventDefault the first Alt focuses browser chrome and blurs the page —
        // `onWindowBlur` then clears the peek and subsequent Alt keydowns never reach
        // the window until the user clicks back. We only capture Alt for the peek
        // when the pointer is over the plot (checked above), so suppressing the
        // accelerator here is safe and scoped: Alt-Tab and Alt elsewhere are
        // untouched (the early return above leaves their default behaviour intact).
        e.preventDefault();
        setAltPeek(true);
        return;
      }
      if (e.key === 'Escape') {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
        // Yield Esc to other overlays this component owns that also handle Esc (the
        // lanes drawer): if one is open, let it consume Esc rather than clobbering a
        // pinned measure region the user didn't mean to clear.
        if (drawerOpen) return;
        if (measureRegion !== null) {
          clearMeasureRegion();
          setMeasureAnnouncement('Region cleared. Measuring the viewport.');
        } else if (measureMode) {
          toggleMeasureMode();
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        // Firefox (and some Chromium configs) activate the menu bar on Alt KEYUP,
        // not keydown. If we captured this Alt for the peek (pointer over the plot),
        // also suppress the keyup default so focus stays on the page across repeated
        // Alt presses. Scoped identically to the keydown guard — Alt elsewhere keeps
        // its native behaviour.
        if (pointerOverPlotRef.current) e.preventDefault();
        setAltPeek(false);
      }
    };
    // Releasing focus / leaving the window can swallow the Alt keyup; clear on blur.
    const onWindowBlur = () => setAltPeek(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [measureRegion, measureMode, clearMeasureRegion, toggleMeasureMode, drawerOpen]);

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

  // X axis is labelled in clock time (device local wall clock) when available; the
  // off-canvas description states the visible clock range so AT users get the same
  // orientation the on-screen axis provides.
  const axisRangeClause = Number.isNaN(wallClockEpoch)
    ? ''
    : ` Showing clock time from ${formatWallClockLabel(
        wallClockEpoch,
        viewport.startTime,
        false,
      )} to ${formatWallClockLabel(wallClockEpoch, viewport.endTime, false)}.`;
  const canvasDescription = `Signal waveform viewer. ${renderLanes.length} lane${
    renderLanes.length === 1 ? '' : 's'
  } visible: ${renderLanes
    .map((r) => `${r.lane.name} (${r.lane.pill})`)
    .join(', ')}.${axisRangeClause} Use arrow keys to move the data cursor.`;

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
          <Button
            variant={measureMode ? 'primary' : 'secondary'}
            size="sm"
            onClick={toggleMeasureMode}
            aria-pressed={measureMode}
            title="Measure region (M) · switch modes: , ."
          >
            <span aria-hidden="true" className={styles.measureGlyph}>
              ⊢⊣
            </span>
            Measure
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

      {/* ── No-weather-for-this-night hint (enabled-but-empty) ── */}
      {weatherEnabledButEmpty && !weatherHintDismissed && (
        <div className={styles.hintBar} role="note">
          <span>No weather for this night. Sync in Settings → Integrations</span>
          <div className={styles.hintActions}>
            <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>
              Open Settings
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWeatherHintDismissed(true)}
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
        data-shiftzoom={shiftZoomArmed || selectionRect !== null}
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

        {/* Transparent WebGL2 waveform layer (ADR 0019), stacked over the base
            chrome canvas and beneath the crosshair overlay. Only the dense-CPAP
            waveforms paint here; everything else (grid, axes, markers, ribbon,
            step/wearable) stays on the base canvas. pointer-events:none so events
            reach the wrapper; aria-hidden because the base canvas carries the
            accessible description. When WebGL2 is unavailable or its context is
            lost the hybrid renderer paints the waveforms on the base canvas
            instead, so this layer simply stays transparent. */}
        <canvas
          ref={waveformCanvasCallbackRef}
          className={styles.waveformCanvas}
          aria-hidden="true"
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

        {/* Shift-drag zoom-to-range selection band. A cheap full-height DOM
            element spanning the dragged x-range (theme-tokened, semi-transparent
            with a subtle border); only the band repaints during the drag — never
            the waveform stack. aria-hidden: this is a mouse-only enhancement;
            keyboard users zoom via the preset buttons / wheel. Rendered only
            while a selection is in flight. */}
        {selectionRect !== null && (
          <div
            className={styles.selectionBand}
            aria-hidden="true"
            style={{ left: `${selectionRect.left}px`, width: `${selectionRect.width}px` }}
          />
        )}

        {/* ── Measure-region band(s) ──────────────────────────────
            The ACTIVE alt-drag marquee (transient, while dragging) and the
            PINNED measure band (persistent). Both use the NEUTRAL slate fill +
            DASHED edges so they never read as the transient blue zoom band. No
            band is drawn for the viewport source. aria-hidden: the structured
            table + live region carry the accessible region info. */}
        {measureMarqueeRect !== null && (
          <div
            className={styles.measureBand}
            aria-hidden="true"
            style={{
              left: `${measureMarqueeRect.left}px`,
              width: `${measureMarqueeRect.width}px`,
            }}
          />
        )}
        {measureMarqueeRect === null && measureBandRect !== null && (
          <div
            className={styles.measureBand}
            aria-hidden="true"
            style={{ left: `${measureBandRect.left}px`, width: `${measureBandRect.width}px` }}
          />
        )}

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

        {/* ── Region-statistics per-lane chips (overlay) ──────────
            Docked to each lane's left inner edge, vertically centred on the lane.
            Lives in the scroll box (like .laneHeaders) so it tracks vertical
            scroll. aria-hidden — the structured table below carries the data.
            Hidden entirely on narrow plots (the bottom sheet takes over). */}
        {measureActive && measureLaneStats && !measureUseSheet && (
          <div className={styles.statChips} aria-hidden="true">
            {renderLanes.map((r, i) => {
              const entry = laneLayout[i];
              const laneStat = measureLaneStats[i];
              if (!entry || !laneStat) return null;
              const compact = r.collapsed || r.height <= MEASURE_COMPACT_CHIP_MAX_HEIGHT;
              return (
                <MeasureChip
                  key={r.lane.id}
                  stat={laneStat}
                  top={entry.top + r.height / 2}
                  compact={compact}
                  mode={measureStatMode}
                />
              );
            })}
          </div>
        )}

        {/* ── Responsive "Region statistics" bottom sheet ─────────
            Replaces the per-lane chips on narrow plots. Collapsed by default; the
            disclosure row + lane rows are real interactive/structured content
            (the chips are aria-hidden). The measure band still draws on canvas. */}
        {measureActive && measureLaneStats && measureUseSheet && (
          <div className={styles.regionStatsSheet}>
            <button
              type="button"
              className={styles.regionStatsSheetToggle}
              aria-expanded={measureSheetOpen}
              onClick={() => setMeasureSheetOpen((o) => !o)}
            >
              <span className={styles.regionStatsSheetChevron} aria-hidden="true">
                ▸
              </span>
              Region statistics
              <span className={styles.regionStatsSheetCount}>
                n = {measureSampleCount.toLocaleString()}
              </span>
            </button>
            {measureSheetOpen && (
              <ul className={styles.regionStatsSheetList}>
                {measureLaneStats.map((laneStat) => (
                  <li key={laneStat.laneId} className={styles.regionStatsSheetRow}>
                    <span
                      className={styles.regionStatsSheetSwatch}
                      style={{
                        backgroundColor: resolveColor(containerRef.current, laneStat.colorVar),
                      }}
                      aria-hidden="true"
                    />
                    <span className={styles.regionStatsSheetName}>{laneStat.laneName}</span>
                    <span className={styles.regionStatsSheetStat}>
                      {laneStatSummary(laneStat) ?? '— no data'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Region footer ──────────────────────────────────────
            Sticky at the bottom of the plot while the overlay is active. Mode
            switcher (first child + single source of truth) → source pill → clock
            span → sample count. An off-screen pinned region adds a directional
            chevron pill. In Selection mode the footer expands to carry precise
            (ms) GLOBAL timing + a copy button. */}
        {measureActive && (
          <div
            className={styles.regionFooter}
            role="status"
            aria-live="off"
            data-mode={measureStatMode}
          >
            <MeasureModeSwitcher
              mode={measureStatMode}
              onChange={setMeasureStatMode}
              collapsed={measureUseSheet}
            />
            <span
              className={styles.regionSourcePill}
              data-source={measureRegionRange.source === 'selection' ? 'region' : 'viewport'}
            >
              <span aria-hidden="true">
                {measureRegionRange.source === 'selection' ? '⊐⊏' : '⟦'}
              </span>
              {measureRegionRange.source === 'selection' ? 'REGION' : 'VIEWPORT'}
            </span>
            {measureStatMode === 'selection' ? (
              <span className={styles.regionTimingPrecise}>
                <span className={styles.regionTimingField}>
                  <span className={styles.regionTimingLabel}>start</span>
                  <span className={styles.regionTimingValue}>
                    {formatPreciseTime(wallClockEpoch, measureRegionRange.startMs)}
                  </span>
                </span>
                <span className={styles.regionTimingField}>
                  <span className={styles.regionTimingLabel}>dur</span>
                  <span className={styles.regionTimingValue}>
                    {formatExactDuration(
                      Math.max(
                        0,
                        Math.round(measureRegionRange.endMs - measureRegionRange.startMs),
                      ),
                    )}
                  </span>
                </span>
                <span className={styles.regionTimingField}>
                  <span className={styles.regionTimingLabel}>end</span>
                  <span className={styles.regionTimingValue}>
                    {formatPreciseTime(wallClockEpoch, measureRegionRange.endMs)}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.regionTimingCopy}
                  aria-label="Copy precise region timing"
                  data-copied={timingCopied ? 'true' : undefined}
                  onClick={copyPreciseTiming}
                >
                  <span aria-hidden="true">{timingCopied ? '✓' : '⧉'}</span>
                  {timingCopied ? 'Copied' : 'Copy'}
                </button>
              </span>
            ) : (
              !Number.isNaN(wallClockEpoch) && (
                <span className={styles.regionFooterSpan}>
                  {formatWallClockLabel(wallClockEpoch, measureRegionRange.startMs, true)}
                  <span className={styles.legendSeparator}>·</span>~
                  {formatDuration(
                    Math.round((measureRegionRange.endMs - measureRegionRange.startMs) / 1000),
                  )}
                  <span className={styles.legendSeparator}>·</span>
                  {formatWallClockLabel(wallClockEpoch, measureRegionRange.endMs, true)}
                </span>
              )
            )}
            {measureOffscreen !== null && (
              <button
                type="button"
                className={styles.regionOffscreenPill}
                onClick={scrollToMeasureRegion}
              >
                <span aria-hidden="true">{measureOffscreen === 'before' ? '◂' : '▸'}</span>
                {measureOffscreen === 'before' ? 'region earlier' : 'region later'}
              </button>
            )}
            <span className={styles.regionFooterCount}>
              n = {measureSampleCount.toLocaleString()}
            </span>
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

      {/* Polite live region: concise region-statistics summary on region change. */}
      <div className={styles.srOnly} aria-live="polite" role="status">
        {measureAnnouncement}
      </div>

      {/* Polite live region: debounced Measure-mode switch announcement. */}
      <div className={styles.srOnly} aria-live="polite" role="status">
        {measureModeAnnouncement}
      </div>

      {/* Polite live region: precise-timing copy confirmation (Selection mode). */}
      <div className={styles.srOnly} aria-live="polite" role="status">
        {timingCopyStatus}
      </div>

      {/* ── Region statistics table (screen-reader structured path) ──
          A real, focusable <table> so AT users get the full per-lane statistics
          the (aria-hidden) canvas chips show visually. Visually hidden but in the
          a11y + tab order whenever the overlay is active. Caption + columns + cells
          swap with the active mode; the element stays mounted across mode changes. */}
      {measureActive && measureLaneStats && (
        <MeasureStatsTable
          mode={measureStatMode}
          laneStats={measureLaneStats}
          region={measureRegionRange}
          wallClockEpoch={wallClockEpoch}
          eventCount={measureEventCount}
        />
      )}

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

          {(['cpap', 'wearable', 'sleep', 'weather'] as const).map((group) => {
            const groupLanes = allLanes.filter((l) => l.group === group);
            if (groupLanes.length === 0) return null;
            const heading =
              group === 'cpap'
                ? 'CPAP'
                : group === 'wearable'
                  ? 'Wearable'
                  : group === 'sleep'
                    ? 'Sleep'
                    : 'Weather & Environment';
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
