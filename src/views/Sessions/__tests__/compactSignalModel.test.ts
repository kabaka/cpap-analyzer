/**
 * Unit tests for the pure model helpers behind the compact Session-Details
 * signal viewer.
 *
 * These specs pin the edge-case math that decides which signal region and what
 * fidelity the user sees: the densest-cluster two-pointer sweep, the span-
 * preserving window clamp, the minimap MIN/MAX envelope, and lane resolution.
 * They assert against the module's own exported constants (never re-typed), so a
 * silent behaviour change fails here.
 *
 * @module views/Sessions/__tests__/compactSignalModel.test
 */

import { describe, it, expect } from 'vitest';

import type { ChannelDescriptor, SignalManifest } from '@/services/storage/OPFSService';

import { CHANNEL_COLORS, DEFAULT_CHANNEL_COLOR } from '../signalChannelBuild';
import {
  COMPACT_LANE_SPECS,
  LEGEND_EVENT_TYPES,
  buildMinimapEnvelope,
  clampWindow,
  computeClusterWindow,
  formatSpan,
  resolveCompactLanes,
} from '../compactSignalModel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeChannel(overrides: Partial<ChannelDescriptor> = {}): ChannelDescriptor {
  return {
    index: 0,
    name: 'flow',
    sampleRate: 25,
    unit: 'L/min',
    dtype: 'float32',
    physicalMin: -60,
    physicalMax: 60,
    ...overrides,
  };
}

function makeManifest(channels: readonly ChannelDescriptor[]): SignalManifest {
  return {
    version: 1,
    sessionId: 'session-1',
    startTime: 1_600_000_000_000,
    endTime: 1_600_000_030_000,
    durationSeconds: 30,
    chunkDurationSeconds: 300,
    channels,
    chunks: [],
  };
}

// ===========================================================================
// COMPACT_LANE_SPECS / LEGEND_EVENT_TYPES — constant shape guards
// ===========================================================================

describe('COMPACT_LANE_SPECS', () => {
  it('lists the four lanes in fixed stack order with the standardized keys', () => {
    expect(COMPACT_LANE_SPECS.map((s) => s.key)).toEqual(['flow', 'maskPressure', 'leak', 'spo2']);
    expect(COMPACT_LANE_SPECS.map((s) => s.label)).toEqual(['Flow', 'Pressure', 'Leak', 'SpO₂']);
  });
});

describe('LEGEND_EVENT_TYPES', () => {
  it('exposes the six legend event types', () => {
    expect(LEGEND_EVENT_TYPES).toEqual([
      'ObstructiveApnea',
      'CentralApnea',
      'Hypopnea',
      'FlowLimitation',
      'RERA',
      'LargeLeak',
    ]);
  });
});

// ===========================================================================
// resolveCompactLanes
// ===========================================================================

describe('resolveCompactLanes', () => {
  it('returns an empty array when the manifest has no channels', () => {
    expect(resolveCompactLanes(makeManifest([]))).toEqual([]);
  });

  it('returns an empty array when no channel matches a compact lane', () => {
    const manifest = makeManifest([
      makeChannel({ name: 'temperature' }),
      makeChannel({ name: 'respRate' }),
    ]);
    expect(resolveCompactLanes(manifest)).toEqual([]);
  });

  it('resolves only the present lanes, in fixed stack order regardless of manifest order', () => {
    // Deliberately reversed relative to COMPACT_LANE_SPECS order.
    const manifest = makeManifest([
      makeChannel({ name: 'spo2' }),
      makeChannel({ name: 'leak' }),
      makeChannel({ name: 'maskPressure' }),
      makeChannel({ name: 'flow' }),
    ]);
    const lanes = resolveCompactLanes(manifest);
    expect(lanes.map((l) => l.name)).toEqual(['flow', 'maskPressure', 'leak', 'spo2']);
    expect(lanes.map((l) => l.label)).toEqual(['Flow', 'Pressure', 'Leak', 'SpO₂']);
  });

  it('omits absent lanes and keeps the survivors in stack order', () => {
    const manifest = makeManifest([makeChannel({ name: 'leak' }), makeChannel({ name: 'flow' })]);
    const lanes = resolveCompactLanes(manifest);
    expect(lanes.map((l) => l.label)).toEqual(['Flow', 'Leak']);
  });

  it('matches channel names case-insensitively but preserves the manifest name', () => {
    const manifest = makeManifest([makeChannel({ name: 'FLOW' })]);
    const lanes = resolveCompactLanes(manifest);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]?.name).toBe('FLOW');
    expect(lanes[0]?.label).toBe('Flow');
    expect(lanes[0]?.descriptor.name).toBe('FLOW');
  });

  it('maps a known lowercase channel name to its palette colour', () => {
    const manifest = makeManifest([makeChannel({ name: 'flow' })]);
    expect(resolveCompactLanes(manifest)[0]?.colorVar).toBe(CHANNEL_COLORS['flow']);
  });

  it('falls back to the default colour when the name case does not match the palette key', () => {
    // colorVar keys the palette by the manifest name verbatim: 'Flow' !== 'flow'.
    const manifest = makeManifest([makeChannel({ name: 'Flow' })]);
    expect(resolveCompactLanes(manifest)[0]?.colorVar).toBe(DEFAULT_CHANNEL_COLOR);
  });

  it('carries the descriptor through unchanged', () => {
    const descriptor = makeChannel({ name: 'leak', physicalMin: 0, physicalMax: 120 });
    const manifest = makeManifest([descriptor]);
    expect(resolveCompactLanes(manifest)[0]?.descriptor).toBe(descriptor);
  });
});

// ===========================================================================
// clampWindow — span-preserving clamp into [0, duration]
// ===========================================================================

describe('clampWindow', () => {
  it('centres a window fully inside the range without clamping', () => {
    const w = clampWindow(500, 100, 1000);
    expect(w).toEqual({ startTime: 450, endTime: 550 });
    expect(w.endTime - w.startTime).toBe(100); // span preserved
  });

  it('clamps a negative start to 0 while preserving the span', () => {
    const w = clampWindow(10, 100, 1000);
    expect(w.startTime).toBe(0);
    expect(w.endTime).toBe(100);
    expect(w.endTime - w.startTime).toBe(100);
  });

  it('clamps a window past the end while preserving the span', () => {
    const w = clampWindow(980, 100, 1000);
    expect(w.endTime).toBe(1000);
    expect(w.startTime).toBe(900);
    expect(w.endTime - w.startTime).toBe(100);
  });

  it('treats a window at the exact right edge as in-bounds (inclusive end)', () => {
    const w = clampWindow(950, 100, 1000);
    expect(w).toEqual({ startTime: 900, endTime: 1000 });
  });

  it('shrinks a window larger than the duration to fill exactly [0, duration]', () => {
    const w = clampWindow(500, 2000, 1000);
    expect(w).toEqual({ startTime: 0, endTime: 1000 });
    expect(w.endTime - w.startTime).toBe(1000); // span == duration
  });

  it('produces a zero-length window for a zero span', () => {
    const w = clampWindow(500, 0, 1000);
    expect(w).toEqual({ startTime: 500, endTime: 500 });
  });

  it('fills the whole range for an exact-fit span', () => {
    expect(clampWindow(500, 1000, 1000)).toEqual({ startTime: 0, endTime: 1000 });
  });

  it('always returns start <= end within [0, duration]', () => {
    for (const [center, span, dur] of [
      [0, 100, 1000],
      [1000, 100, 1000],
      [-500, 300, 1000],
      [2000, 300, 1000],
      [500, 5000, 1000],
    ] as const) {
      const w = clampWindow(center, span, dur);
      expect(w.startTime).toBeGreaterThanOrEqual(0);
      expect(w.endTime).toBeLessThanOrEqual(dur);
      expect(w.startTime).toBeLessThanOrEqual(w.endTime);
    }
  });
});

// ===========================================================================
// computeClusterWindow — densest-window two-pointer sweep
// ===========================================================================

describe('computeClusterWindow', () => {
  it('returns null for no events', () => {
    expect(computeClusterWindow([], 1000, 100)).toBeNull();
  });

  it('returns null for a non-positive duration', () => {
    expect(computeClusterWindow([100, 200], 0, 100)).toBeNull();
    expect(computeClusterWindow([100, 200], -1, 100)).toBeNull();
  });

  it('centres on a single event (then clamps the window into range)', () => {
    // Window 100 centred on t=42 → [-8, 92] → clamped to [0, 100].
    expect(computeClusterWindow([42], 1000, 100)).toEqual({ startTime: 0, endTime: 100 });
  });

  it('centres on the midpoint of a clear densest cluster away from the origin', () => {
    // Dense burst at 500..530 (four events) vs. lone events at 0 and 900.
    const offsets = [0, 500, 510, 520, 530, 900];
    // best centre = (500 + 530) / 2 = 515; window 40 → [495, 535].
    expect(computeClusterWindow(offsets, 1000, 40)).toEqual({ startTime: 495, endTime: 535 });
  });

  it('is robust to unsorted input (does not depend on offset order)', () => {
    const sorted = computeClusterWindow([0, 500, 510, 520, 530, 900], 1000, 40);
    const shuffled = computeClusterWindow([530, 0, 520, 900, 500, 510], 1000, 40);
    expect(shuffled).toEqual(sorted);
  });

  it('does not mutate the caller input array', () => {
    const offsets = [530, 0, 520, 900, 500, 510];
    const snapshot = [...offsets];
    computeClusterWindow(offsets, 1000, 40);
    expect(offsets).toEqual(snapshot);
  });

  it('counts an event exactly windowMs away as inside the window (inclusive edge)', () => {
    // window 20: t=0 and t=20 are both inside → densest span midpoint = 10.
    expect(computeClusterWindow([0, 20], 1000, 20)).toEqual({ startTime: 0, endTime: 20 });
  });

  it('excludes an event just beyond windowMs (off-by-one boundary)', () => {
    // window 19: t=20 is outside the window anchored at t=0, so the densest
    // window collapses to a single event → leftmost centre = 0 → [0, 19].
    expect(computeClusterWindow([0, 20], 1000, 19)).toEqual({ startTime: 0, endTime: 19 });
  });

  it('breaks ties toward the earliest (leftmost) densest window', () => {
    // Two equally-dense clusters of two: [0,10] and [100,110]. Strict `>` keeps
    // the first, so the window centres on the early cluster (midpoint 5 → clamp).
    const w = computeClusterWindow([0, 10, 100, 110], 1000, 20);
    expect(w).toEqual({ startTime: 0, endTime: 20 });
  });

  it('clamps to the end of the range when the densest cluster sits past the duration', () => {
    // Offsets beyond the session duration still clamp into [0, duration].
    const w = computeClusterWindow([5000, 5010], 1000, 100);
    expect(w).toEqual({ startTime: 900, endTime: 1000 });
  });
});

// ===========================================================================
// formatSpan
// ===========================================================================

describe('formatSpan', () => {
  it('formats sub-minute spans as seconds', () => {
    expect(formatSpan(0)).toBe('0s');
    expect(formatSpan(5_000)).toBe('5s');
    expect(formatSpan(59_000)).toBe('59s');
  });

  it('clamps negative input to 0s', () => {
    expect(formatSpan(-100)).toBe('0s');
  });

  it('rounds to the nearest second', () => {
    expect(formatSpan(1_400)).toBe('1s');
    expect(formatSpan(1_500)).toBe('2s');
  });

  it('formats whole minutes, dropping trailing seconds', () => {
    expect(formatSpan(60_000)).toBe('1m');
    expect(formatSpan(65_000)).toBe('1m'); // seconds dropped when minutes present
    expect(formatSpan(120_000)).toBe('2m');
  });

  it('formats whole hours, dropping trailing minutes', () => {
    expect(formatSpan(3_600_000)).toBe('1h');
  });

  it('formats hours with remaining minutes', () => {
    expect(formatSpan(3_660_000)).toBe('1h 1m');
    expect(formatSpan(2 * 3_600_000 + 30 * 60_000)).toBe('2h 30m');
  });
});

// ===========================================================================
// buildMinimapEnvelope — column MIN/MAX envelope
// ===========================================================================

describe('buildMinimapEnvelope', () => {
  it('computes per-column min/max when there are more samples than columns', () => {
    const data = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const outMin = new Float32Array(2);
    const outMax = new Float32Array(2);
    const env = buildMinimapEnvelope(data, 2, outMin, outMax);
    expect(env.columns).toBe(2);
    expect(Array.from(env.min)).toEqual([1, 5]);
    expect(Array.from(env.max)).toEqual([4, 8]);
    // Returns the caller's buffers (no allocation).
    expect(env.min).toBe(outMin);
    expect(env.max).toBe(outMax);
  });

  it('collapses min==max for all-equal samples', () => {
    const data = new Float32Array([3, 3, 3, 3]);
    const outMin = new Float32Array(2);
    const outMax = new Float32Array(2);
    const env = buildMinimapEnvelope(data, 2, outMin, outMax);
    expect(Array.from(env.min)).toEqual([3, 3]);
    expect(Array.from(env.max)).toEqual([3, 3]);
  });

  it('marks empty columns as NaN when there are fewer samples than columns', () => {
    const data = new Float32Array([1, 5]);
    const outMin = new Float32Array(4);
    const outMax = new Float32Array(4);
    const env = buildMinimapEnvelope(data, 4, outMin, outMax);
    expect(env.columns).toBe(4);
    // Sample 0 lands in column 1, sample 1 in column 3; columns 0 and 2 are empty.
    expect(env.min[0]).toBeNaN();
    expect(env.min[1]).toBe(1);
    expect(env.min[2]).toBeNaN();
    expect(env.min[3]).toBe(5);
  });

  it('ignores NaN samples inside a column but keeps the real extrema', () => {
    const data = new Float32Array([1, NaN, 3, NaN]);
    const outMin = new Float32Array(2);
    const outMax = new Float32Array(2);
    const env = buildMinimapEnvelope(data, 2, outMin, outMax);
    expect(Array.from(env.min)).toEqual([1, 3]);
    expect(Array.from(env.max)).toEqual([1, 3]);
  });

  it('marks a wholly-NaN column as a NaN break', () => {
    const data = new Float32Array([NaN, NaN, 5, 6]);
    const outMin = new Float32Array(2);
    const outMax = new Float32Array(2);
    const env = buildMinimapEnvelope(data, 2, outMin, outMax);
    expect(env.min[0]).toBeNaN();
    expect(env.max[0]).toBeNaN();
    expect(env.min[1]).toBe(5);
    expect(env.max[1]).toBe(6);
  });

  it('marks every column NaN for empty data', () => {
    const data = new Float32Array(0);
    const outMin = new Float32Array(3);
    const outMax = new Float32Array(3);
    const env = buildMinimapEnvelope(data, 3, outMin, outMax);
    expect(env.columns).toBe(3);
    expect(Array.from(env.min).every(Number.isNaN)).toBe(true);
    expect(Array.from(env.max).every(Number.isNaN)).toBe(true);
  });

  it('clamps the column count to the smaller output buffer and never writes past it', () => {
    const data = new Float32Array([1, 2, 3, 4, 5, 6]);
    const outMin = new Float32Array(3);
    const outMax = new Float32Array(3);
    const env = buildMinimapEnvelope(data, 10, outMin, outMax);
    // cols = min(columns=10, outMin.len=3, outMax.len=3) = 3.
    expect(env.columns).toBe(3);
    expect(Array.from(env.min)).toEqual([1, 3, 5]);
    expect(Array.from(env.max)).toEqual([2, 4, 6]);
  });

  it('honours the smaller of the two output buffers', () => {
    const data = new Float32Array([1, 2, 3, 4]);
    const outMin = new Float32Array(2);
    const outMax = new Float32Array(5);
    const env = buildMinimapEnvelope(data, 4, outMin, outMax);
    expect(env.columns).toBe(2); // min(4, 2, 5)
  });

  it('does not overwrite output slots beyond the resolved column count', () => {
    const data = new Float32Array([1, 2, 3, 4]);
    const outMin = new Float32Array(5).fill(-999);
    const outMax = new Float32Array(5).fill(-999);
    const env = buildMinimapEnvelope(data, 2, outMin, outMax);
    expect(env.columns).toBe(2);
    // Slots 2..4 stay at their sentinel — the function only touched [0, cols).
    expect(outMin[2]).toBe(-999);
    expect(outMin[3]).toBe(-999);
    expect(outMin[4]).toBe(-999);
  });

  it('clamps a zero column request up to a single column', () => {
    const data = new Float32Array([2, 8, 4]);
    const outMin = new Float32Array(1);
    const outMax = new Float32Array(1);
    const env = buildMinimapEnvelope(data, 0, outMin, outMax);
    expect(env.columns).toBe(1); // max(1, min(0, ...)) === 1
    expect(env.min[0]).toBe(2);
    expect(env.max[0]).toBe(8);
  });
});
