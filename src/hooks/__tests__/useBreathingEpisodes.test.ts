/**
 * Tests for {@link useBreathingEpisodes} — the per-session PB/CSR detection
 * hook. We replace the worker proxy and OPFS service with deterministic
 * mocks so the hook's gating, caching, and event-flag projection can be
 * exercised in jsdom without a real worker.
 *
 * @module hooks/__tests__/useBreathingEpisodes
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ── Module mocks ─────────────────────────────────────────────────

const mockReadManifest = vi.fn();
const mockReadChannel = vi.fn();
const mockInitialize = vi.fn().mockResolvedValue(undefined);
let opfsSupported = true;

vi.mock('@/services/storage/OPFSService', () => {
  class MockOPFSService {
    static isSupported() {
      return opfsSupported;
    }
    initialize = mockInitialize;
    readManifest = mockReadManifest;
    readChannel = mockReadChannel;
  }
  return { OPFSService: MockOPFSService };
});

// ── Imports ──────────────────────────────────────────────────────

import {
  _clearBreathingCacheForTesting,
  _setBreathingWorkerFactoryForTesting,
  toDeviceEventFlags,
  useBreathingEpisodes,
} from '@/hooks/useBreathingEpisodes';
import type { Event as TherapyEvent } from '@/types';
import type { BreathingEpisode, PeriodicBreathingResult } from '@/analysis/breathing';

// ── Helpers ──────────────────────────────────────────────────────

function makeEpisode(overrides: Partial<BreathingEpisode> = {}): BreathingEpisode {
  return {
    id: 'ep-1',
    type: 'PeriodicBreathing',
    startMs: 1_000,
    endMs: 60_000,
    durationSec: 59,
    confidence: 0.7,
    cycleLengthSec: 55,
    modulationDepth: 0.5,
    cycleCount: 4,
    belowDeviceThreshold: false,
    ...overrides,
  };
}

function makeResult(overrides: Partial<PeriodicBreathingResult> = {}): PeriodicBreathingResult {
  return {
    episodes: [makeEpisode()],
    recordHours: 8,
    sessionCriterionMet: false,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<TherapyEvent> = {}): TherapyEvent {
  return {
    id: 'evt-1',
    sessionId: 'sess-1',
    type: 'CentralApnea',
    timestamp: 1_000,
    duration: 12,
    severity: null,
    pressure: null,
    epap: null,
    ipap: null,
    leak: null,
    spo2: null,
    clusterId: null,
    ...overrides,
  };
}

const baseManifest = {
  channels: [
    { name: 'Flow', sampleRate: 25, index: 0, unit: 'L/min', dtype: 'float32' },
    { name: 'Leak', sampleRate: 25, index: 1, unit: 'L/min', dtype: 'float32' },
  ],
};

// ── Tests ────────────────────────────────────────────────────────

describe('toDeviceEventFlags', () => {
  it('projects central, clear-airway, and hypopnea events into device flags', () => {
    const flags = toDeviceEventFlags([
      makeEvent({ type: 'CentralApnea', timestamp: 100, duration: 12 }),
      makeEvent({ type: 'ClearAirway', timestamp: 200, duration: 10 }),
      makeEvent({ type: 'Hypopnea', timestamp: 300, duration: 14 }),
      makeEvent({ type: 'ObstructiveApnea', timestamp: 400, duration: 18 }),
      makeEvent({ type: 'RERA', timestamp: 500, duration: 4 }),
    ]);
    expect(flags).toEqual([
      { timestampMs: 100, durationSec: 12, kind: 'central' },
      { timestampMs: 200, durationSec: 10, kind: 'central' },
      { timestampMs: 300, durationSec: 14, kind: 'hypopnea' },
    ]);
  });
});

describe('useBreathingEpisodes', () => {
  const mockDetectPeriodicBreathing = vi.fn();
  const mockDispose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    opfsSupported = true;
    mockReadManifest.mockResolvedValue(baseManifest);
    mockReadChannel.mockResolvedValue(new Float32Array([0, 1, 2, 3]));
    mockDetectPeriodicBreathing.mockResolvedValue(makeResult());

    _setBreathingWorkerFactoryForTesting(() => ({
      proxy: { detectPeriodicBreathing: mockDetectPeriodicBreathing },
      dispose: mockDispose,
    }));
    _clearBreathingCacheForTesting();
  });

  afterEach(() => {
    _setBreathingWorkerFactoryForTesting(null);
  });

  it('returns empty result when disabled', async () => {
    const { result } = renderHook(() =>
      useBreathingEpisodes({
        sessionId: 'sess-1',
        sessionStartMs: 0,
        events: [],
        enabled: false,
      }),
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.episodes).toEqual([]);
    expect(mockDetectPeriodicBreathing).not.toHaveBeenCalled();
  });

  it('returns empty result when sessionId is undefined', () => {
    const { result } = renderHook(() =>
      useBreathingEpisodes({
        sessionId: undefined,
        sessionStartMs: 0,
        events: [],
      }),
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.episodes).toEqual([]);
  });

  it('runs detection and surfaces episodes', async () => {
    const result1 = makeResult({
      episodes: [makeEpisode({ id: 'pb-1', confidence: 0.8 })],
      recordHours: 6,
    });
    mockDetectPeriodicBreathing.mockResolvedValueOnce(result1);

    const { result } = renderHook(() =>
      useBreathingEpisodes({
        sessionId: 'sess-1',
        sessionStartMs: 1_000,
        events: [makeEvent({ type: 'CentralApnea' })],
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.episodes).toEqual(result1.episodes);
    expect(result.current.recordHours).toBe(6);
    expect(result.current.error).toBeNull();

    // The worker received flow signal, leak signal, and event flags.
    const callArg = mockDetectPeriodicBreathing.mock.calls[0]?.[0];
    expect(callArg.sampleRateHz).toBe(25);
    expect(callArg.startMs).toBe(1_000);
    expect(callArg.flow).toBeInstanceOf(Float32Array);
    expect(callArg.leak).toBeInstanceOf(Float32Array);
    expect(callArg.eventFlags).toEqual([{ timestampMs: 1_000, durationSec: 12, kind: 'central' }]);
  });

  it('caches detection per session — second mount does not re-detect', async () => {
    const { result, unmount } = renderHook(() =>
      useBreathingEpisodes({
        sessionId: 'sess-1',
        sessionStartMs: 0,
        events: [],
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockDetectPeriodicBreathing).toHaveBeenCalledTimes(1);

    unmount();

    const { result: result2 } = renderHook(() =>
      useBreathingEpisodes({
        sessionId: 'sess-1',
        sessionStartMs: 0,
        events: [],
      }),
    );
    // Cache hit — loading=false from first render, no extra worker call.
    expect(result2.current.loading).toBe(false);
    expect(result2.current.episodes).toHaveLength(1);
    expect(mockDetectPeriodicBreathing).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error when OPFS is unsupported', async () => {
    opfsSupported = false;
    const { result } = renderHook(() =>
      useBreathingEpisodes({
        sessionId: 'sess-1',
        sessionStartMs: 0,
        events: [],
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/OPFS/i);
    expect(result.current.episodes).toBeNull();
  });

  it('surfaces an error when no flow channel is available', async () => {
    mockReadManifest.mockResolvedValueOnce({ channels: [] });
    const { result } = renderHook(() =>
      useBreathingEpisodes({
        sessionId: 'sess-1',
        sessionStartMs: 0,
        events: [],
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/no flow/i);
  });

  it('prefers MinuteVent when present', async () => {
    mockReadManifest.mockResolvedValueOnce({
      channels: [
        { name: 'Flow', sampleRate: 25, index: 0, unit: 'L/min', dtype: 'float32' },
        { name: 'MinuteVent', sampleRate: 1, index: 1, unit: 'L/min', dtype: 'float32' },
      ],
    });

    const { result } = renderHook(() =>
      useBreathingEpisodes({
        sessionId: 'mv-session',
        sessionStartMs: 0,
        events: [],
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const callArg = mockDetectPeriodicBreathing.mock.calls[0]?.[0];
    expect(callArg.minuteVent).toBeInstanceOf(Float32Array);
    expect(callArg.flow).toBeUndefined();
    expect(callArg.sampleRateHz).toBe(1);
  });
});
