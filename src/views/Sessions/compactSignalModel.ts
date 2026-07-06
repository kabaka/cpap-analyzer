/**
 * Pure, framework-free model helpers for {@link CompactSignalViewer}.
 *
 * Kept out of the component file so they are unit-testable in isolation and so
 * the component module only exports a component (fast-refresh friendly).
 *
 * @module views/Sessions/compactSignalModel
 */

import type { ChannelDescriptor, SignalManifest } from '@/services/storage/OPFSService';
import type { EventType } from '@/types';

import { CHANNEL_COLORS, DEFAULT_CHANNEL_COLOR, type ViewportRange } from './signalChannelBuild';

/**
 * The four lanes the compact card shows, in stack order. `key` matches the
 * standardized manifest channel name (case-insensitive); `label` is the display
 * name. Only lanes present in the manifest are rendered.
 */
export const COMPACT_LANE_SPECS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'flow', label: 'Flow' },
  { key: 'maskPressure', label: 'Pressure' },
  { key: 'leak', label: 'Leak' },
  { key: 'spo2', label: 'SpO₂' },
];

/** Event types shown in the legend, matching the app-wide colour mapping. */
export const LEGEND_EVENT_TYPES: readonly EventType[] = [
  'ObstructiveApnea',
  'CentralApnea',
  'Hypopnea',
  'FlowLimitation',
  'RERA',
  'LargeLeak',
];

/** A resolved lane present in the session. */
export interface CompactLane {
  /** Manifest channel name (data-map key). */
  readonly name: string;
  /** Display label (also the rendered `SignalChannel` name). */
  readonly label: string;
  /** Channel descriptor from the manifest. */
  readonly descriptor: ChannelDescriptor;
  /** CSS var expression for the lane accent colour. */
  readonly colorVar: string;
}

/**
 * Resolve which of the four compact lanes are present in a manifest, in stack
 * order. Matches {@link COMPACT_LANE_SPECS} keys against manifest channel names
 * case-insensitively so it is robust to naming-case drift.
 */
export function resolveCompactLanes(manifest: SignalManifest): CompactLane[] {
  const out: CompactLane[] = [];
  for (const spec of COMPACT_LANE_SPECS) {
    const descriptor = manifest.channels.find(
      (c) => c.name.toLowerCase() === spec.key.toLowerCase(),
    );
    if (!descriptor) continue;
    out.push({
      name: descriptor.name,
      label: spec.label,
      descriptor,
      colorVar: CHANNEL_COLORS[descriptor.name] ?? DEFAULT_CHANNEL_COLOR,
    });
  }
  return out;
}

/** Clamp a centred window of `spanMs` into `[0, durationMs]`, preserving span. */
export function clampWindow(centerMs: number, spanMs: number, durationMs: number): ViewportRange {
  const span = Math.min(spanMs, durationMs);
  let start = centerMs - span / 2;
  let end = start + span;
  if (start < 0) {
    start = 0;
    end = span;
  }
  if (end > durationMs) {
    end = durationMs;
    start = Math.max(0, end - span);
  }
  return { startTime: start, endTime: end };
}

/**
 * Find the densest cluster of events and return a window of `windowMs` centred
 * on it. With no events, returns `null`. Uses a two-pointer sweep to find the
 * `windowMs`-wide span containing the most event start times, then centres on
 * that span's midpoint.
 */
export function computeClusterWindow(
  offsets: readonly number[],
  durationMs: number,
  windowMs: number,
): ViewportRange | null {
  if (offsets.length === 0 || durationMs <= 0) return null;
  const sorted = [...offsets].sort((a, b) => a - b);
  let bestCount = 0;
  let bestCenter = sorted[0] ?? 0;
  let j = 0;
  for (let i = 0; i < sorted.length; i++) {
    const lo = sorted[i] ?? 0;
    while (j < sorted.length && (sorted[j] ?? 0) - lo <= windowMs) j++;
    const count = j - i;
    if (count > bestCount) {
      bestCount = count;
      const hi = sorted[j - 1] ?? lo;
      bestCenter = (lo + hi) / 2;
    }
  }
  return clampWindow(bestCenter, windowMs, durationMs);
}

/** Format a duration in ms as a compact `Hh Mm` / `Mm` / `Ss` string. */
export function formatSpan(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/**
 * Compute a fixed-resolution MIN/MAX envelope for the minimap. Scans the whole
 * channel once (O(n)), grouping samples into `columns` buckets. Wholly-NaN /
 * empty buckets are marked NaN so the renderer can break there.
 */
export function buildMinimapEnvelope(
  data: Float32Array,
  columns: number,
  outMin: Float32Array,
  outMax: Float32Array,
): { min: Float32Array; max: Float32Array; columns: number } {
  const cols = Math.max(1, Math.min(columns, outMin.length, outMax.length));
  const len = data.length;
  for (let c = 0; c < cols; c++) {
    const start = Math.floor((c / cols) * len);
    const end = Math.min(len, Math.floor(((c + 1) / cols) * len));
    let mn = Number.POSITIVE_INFINITY;
    let mx = Number.NEGATIVE_INFINITY;
    for (let i = start; i < end; i++) {
      const v = data[i];
      if (v === undefined || Number.isNaN(v)) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (Number.isFinite(mn) && Number.isFinite(mx)) {
      outMin[c] = mn;
      outMax[c] = mx;
    } else {
      outMin[c] = NaN;
      outMax[c] = NaN;
    }
  }
  return { min: outMin, max: outMax, columns: cols };
}
