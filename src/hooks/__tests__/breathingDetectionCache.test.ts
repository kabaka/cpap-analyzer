/**
 * Tests for the shared read-through breathing-detection cache
 * ({@link import('@/hooks/breathingDetectionCache')}).
 *
 * Exercises the L1 → L2 → compute → persist contract (ADR 0023, storage spec
 * §8.3) with deterministic stubs: OPFS is module-mocked (as in
 * `useBreathingEpisodes.test.ts`), and L2 (IndexedDB) is injected through the
 * `_setBreathingDbForTesting` seam so we never touch a real database. The
 * compute runner is a plain `vi.fn()`, so we can assert exactly when the
 * detector is (not) invoked.
 *
 * @module hooks/__tests__/breathingDetectionCache
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────

const mockReadManifest = vi.fn();
const mockReadChannel = vi.fn();
const mockInitialize = vi.fn().mockResolvedValue(undefined);
let opfsSupported = true;

vi.mock('@/services/storage/OPFSService', () => {
  class MockOPFSService {
    static isSupported(): boolean {
      return opfsSupported;
    }
    initialize = mockInitialize;
    readManifest = mockReadManifest;
    readChannel = mockReadChannel;
  }
  return { OPFSService: MockOPFSService };
});

// ── Imports (after the mock) ─────────────────────────────────────

import {
  _clearBreathingDetectionCacheForTesting,
  _setBreathingDbForTesting,
  clearBreathingDetectionMemoryCache,
  currentDetectionId,
  getBreathingDetection,
  peekL1,
} from '@/hooks/breathingDetectionCache';
import type {
  IndexedDBService,
  StoredBreathingDetection,
} from '@/services/storage/IndexedDBService';
import type {
  BreathingEpisode,
  PeriodicBreathingResult,
  PeriodicBreathingInput,
} from '@/analysis/breathing';
import type { Session } from '@/types';

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

function makeStored(
  sessionId: string,
  overrides: Partial<StoredBreathingDetection> = {},
): StoredBreathingDetection {
  return {
    id: currentDetectionId(sessionId),
    sessionId,
    date: '2026-01-15',
    algoVersion: 1,
    paramHash: 'h',
    episodes: [makeEpisode({ id: 'cached-ep', confidence: 0.99 })],
    recordHours: 5,
    sessionCriterionMet: true,
    computedAt: '2026-01-16T00:00:00.000Z',
    ...overrides,
  };
}

function makeSession(id: string): Session {
  return {
    id,
    date: '2026-01-15',
    startTime: '2026-01-15T22:30:00.000Z',
    endTime: '2026-01-16T06:30:00.000Z',
    durationMinutes: 480,
    usageMinutes: 420,
    machineId: 'SN1',
    machineModel: 'AirSense 10 AutoSet',
    machineType: 'apap',
    firmwareVersion: '3.0.2',
    sourceHash: 'abc',
    channels: [],
    signalChunkIds: [],
    hasOximetry: false,
    deleted: false,
    importedAt: '2026-01-16T08:00:00.000Z',
    machineSettings: null,
  };
}

const baseManifest = {
  channels: [
    { name: 'Flow', sampleRate: 25, index: 0, unit: 'L/min', dtype: 'float32' },
    { name: 'Leak', sampleRate: 25, index: 1, unit: 'L/min', dtype: 'float32' },
  ],
};

/**
 * Build a stub IndexedDBService exposing only the methods the cache touches:
 * `getBreathingDetectionById`, `putBreathingDetection`, and `getSession`.
 */
function makeDbStub(overrides: Partial<IndexedDBService> = {}): {
  db: IndexedDBService;
  getById: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
} {
  const getById = vi.fn().mockResolvedValue(null);
  const put = vi.fn().mockResolvedValue(undefined);
  const getSession = vi.fn().mockResolvedValue(makeSession('default'));
  const db = {
    getBreathingDetectionById: getById,
    putBreathingDetection: put,
    getSession,
    ...overrides,
  } as unknown as IndexedDBService;
  return { db, getById, put, getSession };
}

// ── Tests ────────────────────────────────────────────────────────

describe('breathingDetectionCache — read-through', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opfsSupported = true;
    mockReadManifest.mockResolvedValue(baseManifest);
    mockReadChannel.mockResolvedValue(new Float32Array([0, 1, 2, 3]));
    _clearBreathingDetectionCacheForTesting();
  });

  afterEach(() => {
    _setBreathingDbForTesting(null);
    _clearBreathingDetectionCacheForTesting();
  });

  it('L2 hit returns the cached result without invoking compute', async () => {
    const sessionId = 'sess-l2';
    const stored = makeStored(sessionId);
    const { db, getById } = makeDbStub();
    getById.mockResolvedValue(stored);
    _setBreathingDbForTesting(() => Promise.resolve(db));

    const compute = vi.fn();
    const result = await getBreathingDetection({
      sessionId,
      sessionStartMs: 0,
      flags: [],
      compute,
    });

    expect(compute).not.toHaveBeenCalled();
    expect(result.episodes).toEqual(stored.episodes);
    expect(result.recordHours).toBe(stored.recordHours);
    expect(result.sessionCriterionMet).toBe(true);
    // Seeds L1 for the next read.
    expect(peekL1(currentDetectionId(sessionId))).toBeDefined();
  });

  it('miss invokes compute, then persists to L2 and seeds L1', async () => {
    const sessionId = 'sess-miss';
    const session = makeSession(sessionId);
    const { db, getById, put, getSession } = makeDbStub();
    getById.mockResolvedValue(null);
    getSession.mockResolvedValue(session);
    _setBreathingDbForTesting(() => Promise.resolve(db));

    const computed = makeResult({ recordHours: 7 });
    const compute = vi.fn().mockResolvedValue(computed);

    const opfsStub = {
      initialize: mockInitialize,
      readManifest: mockReadManifest,
      readChannel: mockReadChannel,
    } as never;

    const result = await getBreathingDetection({
      sessionId,
      sessionStartMs: 1_000,
      flags: [],
      compute,
      opfs: opfsStub,
    });

    expect(compute).toHaveBeenCalledTimes(1);
    const computeArg = compute.mock.calls[0]?.[0] as PeriodicBreathingInput;
    expect(computeArg.flow).toBeInstanceOf(Float32Array);
    expect(computeArg.sampleRateHz).toBe(25);
    expect(result).toEqual(computed);

    // L1 seeded immediately.
    expect(peekL1(currentDetectionId(sessionId))).toEqual(computed);

    // Best-effort persist runs (it is fire-and-forget; flush microtasks).
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const persisted = put.mock.calls[0]?.[0] as StoredBreathingDetection;
    expect(persisted.sessionId).toBe(sessionId);
    expect(persisted.recordHours).toBe(7);
    expect(persisted.date).toBe(session.date);
  });

  it('L1 hit short-circuits L2 (no DB read, no compute)', async () => {
    const sessionId = 'sess-l1';
    const { db, getById } = makeDbStub();
    getById.mockResolvedValue(makeStored(sessionId));
    _setBreathingDbForTesting(() => Promise.resolve(db));

    // First call populates L1 from L2.
    await getBreathingDetection({ sessionId, sessionStartMs: 0, flags: [], compute: vi.fn() });
    expect(getById).toHaveBeenCalledTimes(1);

    // Second call should hit L1 — no further DB read, no compute.
    const compute = vi.fn();
    const result = await getBreathingDetection({
      sessionId,
      sessionStartMs: 0,
      flags: [],
      compute,
    });
    expect(getById).toHaveBeenCalledTimes(1);
    expect(compute).not.toHaveBeenCalled();
    expect(result.episodes[0]?.id).toBe('cached-ep');
  });

  it('swallows a QuotaExceededError from put without breaking the returned result', async () => {
    const sessionId = 'sess-quota';
    const { db, getById, put, getSession } = makeDbStub();
    getById.mockResolvedValue(null);
    getSession.mockResolvedValue(makeSession(sessionId));
    const quotaError = new DOMException('quota', 'QuotaExceededError');
    put.mockRejectedValue(quotaError);
    _setBreathingDbForTesting(() => Promise.resolve(db));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const computed = makeResult({ recordHours: 9 });
    const compute = vi.fn().mockResolvedValue(computed);

    const opfsStub = {
      initialize: mockInitialize,
      readManifest: mockReadManifest,
      readChannel: mockReadChannel,
    } as never;

    // The result resolves normally despite the persist failure.
    const result = await getBreathingDetection({
      sessionId,
      sessionStartMs: 0,
      flags: [],
      compute,
      opfs: opfsStub,
    });
    expect(result).toEqual(computed);

    await vi.waitFor(() => expect(put).toHaveBeenCalled());
    // The failure is logged, not propagated.
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('shared L1: a record computed via one runner serves a different surface', async () => {
    const sessionId = 'sess-shared';
    const { db, getById, getSession } = makeDbStub();
    getById.mockResolvedValue(null);
    getSession.mockResolvedValue(makeSession(sessionId));
    _setBreathingDbForTesting(() => Promise.resolve(db));

    const opfsStub = {
      initialize: mockInitialize,
      readManifest: mockReadManifest,
      readChannel: mockReadChannel,
    } as never;

    // Surface A (e.g. the viewer) computes via runner A.
    const computed = makeResult({ recordHours: 4 });
    const runnerA = vi.fn().mockResolvedValue(computed);
    const a = await getBreathingDetection({
      sessionId,
      sessionStartMs: 0,
      flags: [],
      compute: runnerA,
      opfs: opfsStub,
    });
    expect(runnerA).toHaveBeenCalledTimes(1);

    // Surface B (e.g. the catalog) requests the same night via a different
    // runner — served from the shared L1, so runner B is never called.
    const runnerB = vi.fn();
    const b = await getBreathingDetection({
      sessionId,
      sessionStartMs: 0,
      flags: [],
      compute: runnerB,
      opfs: opfsStub,
    });
    expect(runnerB).not.toHaveBeenCalled();
    expect(b).toEqual(a);
  });

  it('throws when OPFS is unsupported', async () => {
    opfsSupported = false;
    const { db } = makeDbStub();
    _setBreathingDbForTesting(() => Promise.resolve(db));

    await expect(
      getBreathingDetection({ sessionId: 'x', sessionStartMs: 0, flags: [], compute: vi.fn() }),
    ).rejects.toThrow(/OPFS/i);
  });

  // Security MEDIUM regression: derived health data must not survive a memory
  // wipe and be re-served from L1 on a later request without recomputation.
  it('clearBreathingDetectionMemoryCache empties L1 so a later request recomputes', async () => {
    const sessionId = 'sess-wipe';
    const { db, getById, getSession } = makeDbStub();
    // L2 starts populated; first call seeds L1 from it.
    getById.mockResolvedValue(makeStored(sessionId));
    getSession.mockResolvedValue(makeSession(sessionId));
    _setBreathingDbForTesting(() => Promise.resolve(db));

    // First call populates L1.
    await getBreathingDetection({ sessionId, sessionStartMs: 0, flags: [], compute: vi.fn() });
    expect(peekL1(currentDetectionId(sessionId))).toBeDefined();

    // The privacy-critical wipe drops the in-memory derived health data.
    clearBreathingDetectionMemoryCache();
    expect(peekL1(currentDetectionId(sessionId))).toBeUndefined();

    // After the wipe, with L2 now also empty, a later request must NOT be served
    // from the stale in-memory result — it has to recompute.
    getById.mockResolvedValue(null);
    const compute = vi.fn().mockResolvedValue(makeResult({ recordHours: 3 }));
    const opfsStub = {
      initialize: mockInitialize,
      readManifest: mockReadManifest,
      readChannel: mockReadChannel,
    } as never;
    const result = await getBreathingDetection({
      sessionId,
      sessionStartMs: 0,
      flags: [],
      compute,
      opfs: opfsStub,
    });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(result.recordHours).toBe(3);
  });

  // Security LOW regression: a cache-write failure must log only the error
  // name/message — never the full error object or the record id (it embeds the
  // sessionId), so health-data identifiers cannot leak to the console.
  it('cache-write failure log scrubs the error object and the sessionId', async () => {
    const sessionId = 'sess-secret-id';
    const { db, getById, put, getSession } = makeDbStub();
    getById.mockResolvedValue(null);
    getSession.mockResolvedValue(makeSession(sessionId));
    put.mockRejectedValue(new DOMException('quota', 'QuotaExceededError'));
    _setBreathingDbForTesting(() => Promise.resolve(db));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const compute = vi.fn().mockResolvedValue(makeResult({ recordHours: 2 }));
    const opfsStub = {
      initialize: mockInitialize,
      readManifest: mockReadManifest,
      readChannel: mockReadChannel,
    } as never;

    await getBreathingDetection({
      sessionId,
      sessionStartMs: 0,
      flags: [],
      compute,
      opfs: opfsStub,
    });

    await vi.waitFor(() => expect(put).toHaveBeenCalled());
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());

    // A single warn, with only string arguments — no Error object, no id.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const args = warnSpy.mock.calls[0] ?? [];
    expect(args).toHaveLength(1);
    const message = String(args[0]);
    expect(message).toContain('QuotaExceededError');
    expect(message).not.toContain(sessionId);
    expect(args.some((a) => a instanceof Error || a instanceof DOMException)).toBe(false);
    warnSpy.mockRestore();
  });
});
