/**
 * Tests for {@link useBreathingEpisodeCatalog} — the streaming, uncapped
 * episode-catalog hook (ADR 0023; UX spec docs/design/breathing-catalog-
 * streaming-ux.md §§3, 5, 8, 11).
 *
 * The hook is driven entirely through its testing seams:
 *  - `@/services/storage/getDB` is module-mocked to a controllable DB stub
 *    (session enumeration, the bulk cache read, per-session events);
 *  - the shared read-through cache's L2 is injected via `_setBreathingDbForTesting`
 *    pointing at the SAME stub, so cache hits/misses are deterministic;
 *  - the worker pool is replaced with a synchronous stub via
 *    `_setCatalogWorkerFactoryForTesting`;
 *  - OPFS is module-mocked so misses "compute" without real signal I/O.
 *
 * No real workers, OPFS, or IndexedDB are involved; everything is deterministic.
 *
 * @module hooks/__tests__/useBreathingEpisodeCatalog
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
    static isSupported(): boolean {
      return opfsSupported;
    }
    initialize = mockInitialize;
    readManifest = mockReadManifest;
    readChannel = mockReadChannel;
  }
  return { OPFSService: MockOPFSService };
});

const mockGetDB = vi.fn();
vi.mock('@/services/storage/getDB', () => ({
  getDB: () => mockGetDB(),
  resetDB: vi.fn(),
}));

// ── Imports (after mocks) ────────────────────────────────────────

import {
  useBreathingEpisodeCatalog,
  _setCatalogWorkerFactoryForTesting,
  _clearCatalogCacheForTesting,
} from '@/hooks/useBreathingEpisodeCatalog';
import { _setBreathingDbForTesting, currentDetectionId } from '@/hooks/breathingDetectionCache';
import type {
  IndexedDBService,
  StoredBreathingDetection,
} from '@/services/storage/IndexedDBService';
import type { BreathingEpisode, PeriodicBreathingResult } from '@/analysis/breathing';
import type { Session } from '@/types';

// ── Helpers ──────────────────────────────────────────────────────

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  const dayIndex = Number(id.replace(/\D/g, '')) || 1;
  const dd = String(dayIndex).padStart(2, '0');
  return {
    id,
    date: `2026-01-${dd}`,
    startTime: `2026-01-${dd}T22:30:00.000Z`,
    endTime: `2026-01-${dd}T06:30:00.000Z`,
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
    importedAt: '2026-01-31T08:00:00.000Z',
    machineSettings: null,
    ...overrides,
  };
}

function makeEpisode(id: string): BreathingEpisode {
  return {
    id,
    type: 'PeriodicBreathing',
    startMs: 1_000,
    endMs: 60_000,
    durationSec: 59,
    confidence: 0.7,
    cycleLengthSec: 55,
    modulationDepth: 0.5,
    cycleCount: 4,
    belowDeviceThreshold: false,
  };
}

function makeStored(session: Session, episodeId: string): StoredBreathingDetection {
  return {
    id: currentDetectionId(session.id),
    sessionId: session.id,
    date: session.date,
    algoVersion: 1,
    paramHash: 'h',
    episodes: [makeEpisode(episodeId)],
    recordHours: 8,
    sessionCriterionMet: false,
    computedAt: '2026-01-31T00:00:00.000Z',
  };
}

const baseManifest = {
  channels: [{ name: 'Flow', sampleRate: 25, index: 0, unit: 'L/min', dtype: 'float32' }],
};

/**
 * A controllable in-memory DB stub. `cached` holds the bulk-read hits keyed by
 * sessionId; `getBreathingDetectionById` (used by the cache's compute path) also
 * reads it so persisted/seeded rows resolve consistently.
 */
function makeDb(opts: {
  sessions: Session[];
  cached?: Map<string, StoredBreathingDetection>;
}): IndexedDBService {
  const cached = opts.cached ?? new Map<string, StoredBreathingDetection>();
  const byId = new Map<string, StoredBreathingDetection>();
  for (const rec of cached.values()) byId.set(rec.id, rec);

  return {
    getSessionsByDateRange: vi.fn().mockResolvedValue(opts.sessions),
    getBreathingDetectionsByIds: vi.fn(async (ids: readonly string[]) => {
      const result = new Map<string, StoredBreathingDetection>();
      for (const id of ids) {
        const rec = byId.get(id);
        if (rec) result.set(rec.sessionId, rec);
      }
      return result;
    }),
    getBreathingDetectionById: vi.fn(async (id: string) => byId.get(id) ?? null),
    getEventsBySessionId: vi.fn().mockResolvedValue([]),
    getSession: vi.fn(async (id: string) => opts.sessions.find((s) => s.id === id) ?? null),
    putBreathingDetection: vi.fn(async (rec: StoredBreathingDetection) => {
      byId.set(rec.id, rec);
    }),
  } as unknown as IndexedDBService;
}

/**
 * Build a WorkerPool-shaped stub whose `submit(taskFn)` runs `taskFn` against a
 * proxy that resolves `detectPeriodicBreathing` via the supplied responder. This
 * lets a test return per-night results or throw for specific nights.
 */
function makePoolFactory(
  responder: (input: { startMs: number }) => Promise<PeriodicBreathingResult>,
): {
  factory: () => unknown;
  submit: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
} {
  const detect = vi.fn((input: { startMs: number }) => responder(input));
  const proxy = { detectPeriodicBreathing: detect };
  const submit = vi.fn((taskFn: (p: typeof proxy) => unknown) => Promise.resolve(taskFn(proxy)));
  const shutdown = vi.fn().mockResolvedValue(undefined);
  const factory = (): unknown => ({ submit, shutdown });
  return { factory, submit, shutdown };
}

const dateRange = { start: new Date('2026-01-01'), end: new Date('2026-01-31') };

// ── Tests ────────────────────────────────────────────────────────

describe('useBreathingEpisodeCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opfsSupported = true;
    mockReadManifest.mockResolvedValue(baseManifest);
    mockReadChannel.mockResolvedValue(new Float32Array([0, 1, 2, 3]));
    _clearCatalogCacheForTesting();
  });

  afterEach(() => {
    _setCatalogWorkerFactoryForTesting(null);
    _setBreathingDbForTesting(null);
    _clearCatalogCacheForTesting();
  });

  function wire(db: IndexedDBService): void {
    mockGetDB.mockResolvedValue(db);
    _setBreathingDbForTesting(() => Promise.resolve(db));
  }

  it('resolves cached nights in the reading-cache phase without compute', async () => {
    const sessions = [makeSession('s1'), makeSession('s2')];
    const cached = new Map([
      [sessions[0]!.id, makeStored(sessions[0]!, 'c1')],
      [sessions[1]!.id, makeStored(sessions[1]!, 'c2')],
    ]);
    const db = makeDb({ sessions, cached });
    wire(db);
    const pool = makePoolFactory(() => Promise.reject(new Error('should not compute')));
    _setCatalogWorkerFactoryForTesting(pool.factory);

    const { result } = renderHook(() => useBreathingEpisodeCatalog({ dateRange }));

    await waitFor(() => expect(result.current.phase).toBe('complete'));
    expect(result.current.nightsCached).toBe(2);
    expect(result.current.nightsComputed).toBe(0);
    expect(result.current.episodes).toHaveLength(2);
    expect(pool.submit).not.toHaveBeenCalled();
  });

  it('computes misses via the injected pool and streams them in', async () => {
    const sessions = [makeSession('s1'), makeSession('s2')];
    // s1 cached, s2 a miss.
    const cached = new Map([[sessions[0]!.id, makeStored(sessions[0]!, 'cached-ep')]]);
    const db = makeDb({ sessions, cached });
    wire(db);

    const pool = makePoolFactory(() =>
      Promise.resolve({
        episodes: [makeEpisode('computed-ep')],
        recordHours: 6,
        sessionCriterionMet: false,
      }),
    );
    _setCatalogWorkerFactoryForTesting(pool.factory);

    const { result } = renderHook(() => useBreathingEpisodeCatalog({ dateRange }));

    await waitFor(() => expect(result.current.phase).toBe('complete'));
    expect(result.current.nightsCached).toBe(1);
    expect(result.current.nightsComputed).toBe(1);
    expect(pool.submit).toHaveBeenCalledTimes(1);

    const episodeIds = result.current.episodes.map((e) => e.episode.id).sort();
    expect(episodeIds).toEqual(['cached-ep', 'computed-ep']);
  });

  it('transitions idle → reading-cache → ... → complete', async () => {
    const sessions = [makeSession('s1')];
    const db = makeDb({ sessions });
    wire(db);
    const pool = makePoolFactory(() =>
      Promise.resolve({ episodes: [], recordHours: 8, sessionCriterionMet: false }),
    );
    _setCatalogWorkerFactoryForTesting(pool.factory);

    const seen = new Set<string>();
    const { result } = renderHook(() => useBreathingEpisodeCatalog({ dateRange }));
    seen.add(result.current.phase);
    await waitFor(() => {
      seen.add(result.current.phase);
      expect(result.current.phase).toBe('complete');
    });

    // The terminal phase is complete; the run began in a loading phase.
    expect(result.current.phase).toBe('complete');
    expect(seen.has('reading-cache') || seen.has('computing')).toBe(true);
  });

  it('reports phase "error" and never computes when OPFS is unsupported', async () => {
    opfsSupported = false;
    const db = makeDb({ sessions: [makeSession('s1')] });
    wire(db);
    const pool = makePoolFactory(() => Promise.reject(new Error('nope')));
    _setCatalogWorkerFactoryForTesting(pool.factory);

    const { result } = renderHook(() => useBreathingEpisodeCatalog({ dateRange }));
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error).toMatch(/OPFS/i);
    expect(pool.submit).not.toHaveBeenCalled();
  });

  it('completes immediately for an empty range', async () => {
    const db = makeDb({ sessions: [] });
    wire(db);
    _setCatalogWorkerFactoryForTesting(makePoolFactory(() => Promise.reject(new Error())).factory);

    const { result } = renderHook(() => useBreathingEpisodeCatalog({ dateRange }));
    await waitFor(() => expect(result.current.phase).toBe('complete'));
    expect(result.current.nightsTotal).toBe(0);
    expect(result.current.episodes).toHaveLength(0);
  });

  it('records a per-night failure without aborting the rest', async () => {
    const sessions = [makeSession('s1'), makeSession('s2'), makeSession('s3')];
    const db = makeDb({ sessions }); // all misses
    wire(db);

    // s2 genuinely fails by throwing from the manifest read; s1/s3 succeed.
    mockReadManifest.mockImplementation((sessionId: string) =>
      sessionId === 's2'
        ? Promise.reject(new Error('signal unreadable'))
        : Promise.resolve(baseManifest),
    );

    const pool = makePoolFactory(() =>
      Promise.resolve({
        episodes: [makeEpisode('ok')],
        recordHours: 8,
        sessionCriterionMet: false,
      }),
    );
    _setCatalogWorkerFactoryForTesting(pool.factory);

    const { result } = renderHook(() => useBreathingEpisodeCatalog({ dateRange }));
    await waitFor(() => expect(result.current.phase).toBe('complete'));

    expect(result.current.nightsFailed).toBe(1);
    expect(result.current.failures).toHaveLength(1);
    expect(result.current.failures[0]?.reason).toMatch(/unreadable/i);
    // The other two nights still computed.
    expect(result.current.nightsComputed).toBe(2);
  });

  it('cancel() leaves partial results and sets phase "cancelled"', async () => {
    const sessions = [makeSession('s1'), makeSession('s2')];
    const cached = new Map([[sessions[0]!.id, makeStored(sessions[0]!, 'cached-ep')]]);
    const db = makeDb({ sessions, cached });
    wire(db);

    // Gate the compute so we can cancel while s2 is in flight.
    let releaseCompute: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseCompute = resolve;
    });
    const pool = makePoolFactory(async () => {
      await gate;
      return { episodes: [makeEpisode('late')], recordHours: 8, sessionCriterionMet: false };
    });
    _setCatalogWorkerFactoryForTesting(pool.factory);

    const { result } = renderHook(() => useBreathingEpisodeCatalog({ dateRange }));

    // Wait until the cached night has streamed in and compute has started.
    await waitFor(() => expect(result.current.nightsCached).toBe(1));
    await waitFor(() => expect(result.current.phase).toBe('computing'));

    result.current.cancel();
    await waitFor(() => expect(result.current.phase).toBe('cancelled'));

    // The cached night is retained; the in-flight compute is not counted.
    expect(result.current.episodes).toHaveLength(1);
    expect(result.current.episodes[0]?.episode.id).toBe('cached-ep');
    expect(result.current.nightsComputed).toBe(0);

    // Release the gate so the dangling promise settles cleanly (no leak).
    releaseCompute();
  });

  it('resume() computes only the remaining nights', async () => {
    const sessions = [makeSession('s1'), makeSession('s2')];
    const db = makeDb({ sessions }); // both misses
    wire(db);

    // Gate the first pass so we can cancel before either night resolves.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let gated = true;
    const pool = makePoolFactory(async () => {
      if (gated) await gate;
      return { episodes: [makeEpisode('done')], recordHours: 8, sessionCriterionMet: false };
    });
    _setCatalogWorkerFactoryForTesting(pool.factory);

    const { result } = renderHook(() => useBreathingEpisodeCatalog({ dateRange }));
    await waitFor(() => expect(result.current.phase).toBe('computing'));

    // Cancel while both nights are still pending (gated).
    result.current.cancel();
    await waitFor(() => expect(result.current.phase).toBe('cancelled'));
    expect(result.current.nightsComputed).toBe(0);

    // Open the gate and resume — the two remaining nights now compute.
    gated = false;
    release();
    result.current.resume();

    await waitFor(() => expect(result.current.phase).toBe('complete'));
    expect(result.current.nightsComputed).toBe(2);
  });

  it('processes more than 60 nights with no cap', async () => {
    const sessions = Array.from({ length: 75 }, (_, i) => makeSession(`s${i + 1}`));
    const db = makeDb({ sessions }); // all misses
    wire(db);
    const pool = makePoolFactory(() =>
      Promise.resolve({ episodes: [makeEpisode('e')], recordHours: 8, sessionCriterionMet: false }),
    );
    _setCatalogWorkerFactoryForTesting(pool.factory);

    const { result } = renderHook(() => useBreathingEpisodeCatalog({ dateRange }));
    await waitFor(() => expect(result.current.phase).toBe('complete'), { timeout: 5_000 });

    expect(result.current.nightsTotal).toBe(75);
    expect(result.current.nightsComputed).toBe(75);
    expect(result.current.episodes).toHaveLength(75);
    expect(pool.submit).toHaveBeenCalledTimes(75);
  });
});
