/**
 * Aggregate per-night breathing-pattern episode detections for an entire date
 * range, powering the Explore → Breathing Patterns episode catalog.
 *
 * Implements ADR 0023 and the streaming-UX spec
 * (docs/design/breathing-catalog-streaming-ux.md): the catalog serves unbounded
 * ("all time") ranges with **no cap**, in two honest phases —
 *
 *  1. **Reading cache** — one bulk IndexedDB read
 *     (`getBreathingDetectionsByIds` over the composite current-version ids)
 *     resolves every already-analyzed night instantly, with no OPFS I/O. These
 *     stream into the table as `nightsCached`.
 *  2. **Computing** — the uncached remainder is fanned across a {@link WorkerPool}
 *     at low/background priority and streams in as each night completes
 *     (`nightsComputed`). The whole run is cancellable via `AbortSignal`.
 *
 * Detection flows through the **shared** read-through cache in
 * {@link import('./breathingDetectionCache')} (L1 Map → L2 IndexedDB → compute →
 * persist), so the catalog and the per-session viewer warm one shared cache and
 * never diverge.
 *
 * The hook streams episodes **append-only and unsorted**; the view owns
 * filtering and sorting (UX spec §7/§10).
 *
 * @module hooks/useBreathingEpisodeCatalog
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type BreathingEpisode,
  type PeriodicBreathingInput,
  type PeriodicBreathingResult,
} from '@/analysis/breathing';
import { getDB } from '@/services/storage/getDB';
import { OPFSService } from '@/services/storage/OPFSService';
import { WorkerPool } from '@/services/workers/WorkerPool';
import type { AnalysisWorkerAPI } from '@/services/workers/analysis.worker';
import { formatDate } from '@/utils/formatDate';
import type { Session } from '@/types';

import {
  currentDetectionId,
  getBreathingDetection,
  primeL1FromRecord,
  type ComputeRunner,
} from './breathingDetectionCache';
import { toDeviceEventFlags } from './useBreathingEpisodes';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The catalog run's lifecycle phase (UX spec §3.0 state machine). */
export type CatalogPhase =
  | 'idle'
  | 'reading-cache'
  | 'computing'
  | 'complete'
  | 'cancelled'
  | 'error';

/** One catalog row — an episode joined to the night it came from. */
export interface CatalogEpisode {
  readonly sessionId: string;
  readonly nightDate: string;
  readonly nightStartMs: number;
  readonly episode: BreathingEpisode;
}

/** A per-night failure surfaced in the "could not analyze" disclosure (UX §8.3). */
export interface CatalogFailure {
  readonly date: string;
  readonly reason: string;
}

/** Result returned by {@link useBreathingEpisodeCatalog}. */
export interface UseBreathingEpisodeCatalogResult {
  /**
   * Catalog rows, appended **unsorted** as nights resolve. The view owns
   * filtering and sorting (UX spec §7/§10).
   */
  readonly episodes: readonly CatalogEpisode[];
  /** The run's current lifecycle phase. */
  readonly phase: CatalogPhase;
  /** Total sessions in scope for the selected range. */
  readonly nightsTotal: number;
  /** Nights resolved from the persistent cache (the "reading cache" phase). */
  readonly nightsCached: number;
  /** Nights freshly computed this run (distinct from cached). */
  readonly nightsComputed: number;
  /** Nights that errored during analysis (excluded from the table). */
  readonly nightsFailed: number;
  /** Per-night failures (date + short reason) for the §8.3 disclosure. */
  readonly failures: readonly CatalogFailure[];
  /** True while the run is in `reading-cache` or `computing`. */
  readonly loading: boolean;
  /** Fatal (enumerate / DB) error message, or `null`. Per-night errors use {@link failures}. */
  readonly error: string | null;
  /** Cancel the in-flight run, keeping every streamed row (UX §5). */
  readonly cancel: () => void;
  /** Resume a cancelled run — computes only the still-uncached nights (UX §5.3). */
  readonly resume: () => void;
}

/** Options accepted by {@link useBreathingEpisodeCatalog}. */
export interface UseBreathingEpisodeCatalogOptions {
  /** Date range to enumerate sessions over. */
  readonly dateRange: { readonly start: Date; readonly end: Date };
  /** Set to `false` to defer execution (e.g. while the view is hidden). */
  readonly enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Worker pool factory (testable seam)
// ---------------------------------------------------------------------------

type CatalogWorker = Pick<AnalysisWorkerAPI, 'detectPeriodicBreathing'>;

/** Upper bound on catalog-pool workers — mirrors the import pool's discipline. */
const MAX_POOL_WORKERS = 8;

function recommendedPoolSize(): number {
  const hw =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 4;
  return Math.max(1, Math.min(hw, MAX_POOL_WORKERS));
}

type PoolFactory = () => WorkerPool<CatalogWorker>;

function defaultPoolFactory(): WorkerPool<CatalogWorker> {
  return new WorkerPool<CatalogWorker>({
    workerFactory: (name?: string) =>
      new Worker(new URL('../services/workers/analysis.worker.ts', import.meta.url), {
        type: 'module',
        name: name ?? 'breathing-catalog',
      }),
    minWorkers: 1,
    maxWorkers: recommendedPoolSize(),
    taskTimeoutMs: 60_000,
  });
}

let poolFactory: PoolFactory = defaultPoolFactory;

/**
 * @internal Testing seam — replace the worker-pool factory with a stub. The stub
 * must expose `submit(taskFn)` / `shutdown()` shaped like {@link WorkerPool}.
 * Pass `null` to restore the production factory.
 */
export function _setCatalogWorkerFactoryForTesting(factory: (() => unknown) | null): void {
  poolFactory = factory ? (factory as PoolFactory) : defaultPoolFactory;
}

/**
 * @internal Testing seam — clear the shared per-session detection cache (L1 +
 * in-flight). L2 (IndexedDB) is reset separately via `resetDB`. Kept for
 * backwards compatibility with existing catalog tests.
 */
export { _clearBreathingDetectionCacheForTesting as _clearCatalogCacheForTesting } from './breathingDetectionCache';

// ---------------------------------------------------------------------------
// Run state (mutable, lives across phases for cancel/resume)
// ---------------------------------------------------------------------------

interface RunState {
  /** Aborted when the range changes, the view unmounts, or the user cancels. */
  controller: AbortController;
  /** Sessions still needing compute (drains as the pool finishes them). */
  pending: Session[];
  /** Shared OPFS handle for this run. */
  opfs: OPFSService | null;
  /** The pool for this run; shut down on teardown. */
  pool: WorkerPool<CatalogWorker> | null;
  /** Set once the run is fully torn down so a late resume cannot reuse it. */
  disposed: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const INITIAL: Omit<UseBreathingEpisodeCatalogResult, 'cancel' | 'resume'> = {
  episodes: [],
  phase: 'idle',
  nightsTotal: 0,
  nightsCached: 0,
  nightsComputed: 0,
  nightsFailed: 0,
  failures: [],
  loading: false,
  error: null,
};

export function useBreathingEpisodeCatalog(
  options: UseBreathingEpisodeCatalogOptions,
): UseBreathingEpisodeCatalogResult {
  const { dateRange, enabled = true } = options;
  const startStr = formatDate(dateRange.start);
  const endStr = formatDate(dateRange.end);

  const [state, setState] = useState(INITIAL);
  const runRef = useRef<RunState | null>(null);

  // Tear down the active run (abort, drain pool). Safe to call repeatedly.
  const teardown = useCallback((run: RunState | null) => {
    if (!run || run.disposed) return;
    run.disposed = true;
    run.controller.abort();
    void run.pool?.shutdown();
    run.pool = null;
    run.pending = [];
  }, []);

  /**
   * Drive the compute phase: dispatch each pending night to the pool at low
   * priority and stream results as they resolve. Cached nights are already on
   * screen. `run.pending` stays authoritative for "not yet resolved": a session
   * is removed from it only once it succeeds or fails, so a cancel mid-run
   * leaves exactly the un-analyzed nights in `pending` for a later resume.
   */
  const runCompute = useCallback(async (run: RunState): Promise<void> => {
    if (run.pending.length === 0) {
      if (!run.controller.signal.aborted) {
        setState((prev) => ({ ...prev, phase: 'complete', loading: false }));
      }
      return;
    }

    const pool = run.pool ?? poolFactory();
    run.pool = pool;

    const opfs = run.opfs ?? (OPFSService.isSupported() ? new OPFSService() : null);
    if (opfs && opfs !== run.opfs) {
      await opfs.initialize();
      run.opfs = opfs;
    }

    setState((prev) => ({ ...prev, phase: 'computing', loading: true }));

    const db = await getDB();

    const runOnPool: ComputeRunner = (input: PeriodicBreathingInput, signal?: AbortSignal) =>
      pool.submit((proxy) => proxy.detectPeriodicBreathing(input), {
        priority: 'low',
        ...(signal ? { signal } : {}),
      });

    // Snapshot the nights to dispatch this pass. `pending` remains the live
    // "unresolved" set — each session is spliced out only when it resolves, so a
    // cancel leaves the un-started/in-flight nights behind for resume.
    const nights = [...run.pending];

    const removeFromPending = (sessionId: string): void => {
      const idx = run.pending.findIndex((s) => s.id === sessionId);
      if (idx !== -1) run.pending.splice(idx, 1);
    };

    const tasks = nights.map(async (session) => {
      if (run.controller.signal.aborted) return;
      try {
        const events = await db.getEventsBySessionId(session.id);
        const startMs = new Date(session.startTime).getTime();
        const result = await getBreathingDetection({
          sessionId: session.id,
          sessionStartMs: startMs,
          flags: toDeviceEventFlags(events),
          compute: runOnPool,
          ...(run.opfs ? { opfs: run.opfs } : {}),
          signal: run.controller.signal,
        });
        if (run.controller.signal.aborted) return;
        removeFromPending(session.id);
        appendNight(setState, session, startMs, result, 'computed');
      } catch (err) {
        if (run.controller.signal.aborted) return;
        // A failure is terminal for this night — drop it from pending so resume
        // does not retry a night that cannot be read.
        removeFromPending(session.id);
        recordFailure(setState, session, err);
      }
    });

    await Promise.allSettled(tasks);

    if (run.controller.signal.aborted) return;
    // A resume may have re-entered with a fresh run; only finalize if anything
    // queued during this pass remains for this same run.
    if (run.pending.length > 0) {
      await runCompute(run);
      return;
    }
    setState((prev) => ({ ...prev, phase: 'complete', loading: false }));
    void run.pool?.shutdown();
    run.pool = null;
  }, []);

  /** Start a fresh run for the current range: enumerate → read cache → compute. */
  const start = useCallback(async (): Promise<void> => {
    if (!OPFSService.isSupported()) {
      setState({
        ...INITIAL,
        phase: 'error',
        error: 'OPFS is not supported in this browser; breathing detection unavailable.',
      });
      return;
    }

    const run: RunState = {
      controller: new AbortController(),
      pending: [],
      opfs: null,
      pool: null,
      disposed: false,
    };
    runRef.current = run;

    setState({ ...INITIAL, phase: 'reading-cache', loading: true });

    let db;
    let sessions: Session[];
    try {
      db = await getDB();
      sessions = await db.getSessionsByDateRange(startStr, endStr);
    } catch (err) {
      if (run.controller.signal.aborted) return;
      setState({
        ...INITIAL,
        phase: 'error',
        error: err instanceof Error ? err.message : 'Failed to enumerate sessions',
      });
      return;
    }
    if (run.controller.signal.aborted) return;

    // Oldest-first so the earliest matches stream in first (preserves the
    // established ordering; the view's Sort control governs display order).
    const sorted = [...sessions].sort((a, b) => a.startTime.localeCompare(b.startTime));
    setState((prev) => ({ ...prev, nightsTotal: sorted.length }));

    if (sorted.length === 0) {
      setState((prev) => ({ ...prev, phase: 'complete', loading: false }));
      return;
    }

    // ── Reading-cache phase: one bulk read of all current-version ids. ──
    const ids = sorted.map((s) => currentDetectionId(s.id));
    const cachedById = await db.getBreathingDetectionsByIds(ids);
    if (run.controller.signal.aborted) return;

    const misses: Session[] = [];
    for (const session of sorted) {
      const record = cachedById.get(session.id);
      if (record) {
        primeL1FromRecord(currentDetectionId(session.id), record);
        const startMs = new Date(session.startTime).getTime();
        appendNight(
          setState,
          session,
          startMs,
          {
            episodes: record.episodes,
            recordHours: record.recordHours,
            sessionCriterionMet: record.sessionCriterionMet,
          },
          'cached',
        );
      } else {
        misses.push(session);
      }
    }

    run.pending = misses;
    await runCompute(run);
  }, [startStr, endStr, runCompute]);

  // Restart on range change / enable; cancel on unmount or dependency change.
  useEffect(() => {
    if (!enabled) {
      teardown(runRef.current);
      runRef.current = null;
      setState({ ...INITIAL, phase: 'idle' });
      return;
    }

    teardown(runRef.current);
    void start();

    return () => {
      teardown(runRef.current);
    };
  }, [enabled, start, teardown]);

  const cancel = useCallback(() => {
    const run = runRef.current;
    if (!run || run.disposed) return;
    run.controller.abort();
    void run.pool?.shutdown();
    run.pool = null;
    setState((prev) =>
      prev.phase === 'reading-cache' || prev.phase === 'computing'
        ? { ...prev, phase: 'cancelled', loading: false }
        : prev,
    );
  }, []);

  const resume = useCallback(() => {
    const prevRun = runRef.current;
    if (!prevRun) return;
    // A cancelled run's controller is already aborted; build a fresh run that
    // reuses the remaining-uncached list but a new abort controller + pool.
    const remaining = prevRun.pending;
    teardown(prevRun);

    const run: RunState = {
      controller: new AbortController(),
      pending: remaining,
      opfs: null,
      pool: null,
      disposed: false,
    };
    runRef.current = run;
    void runCompute(run);
  }, [runCompute, teardown]);

  const loading = state.phase === 'reading-cache' || state.phase === 'computing';

  return useMemo(() => ({ ...state, loading, cancel, resume }), [state, loading, cancel, resume]);
}

// ---------------------------------------------------------------------------
// State updaters (append-only streaming; the view owns sort/filter)
// ---------------------------------------------------------------------------

type SetState = React.Dispatch<React.SetStateAction<typeof INITIAL>>;

/** Append a resolved night's episodes and bump the appropriate counter. */
function appendNight(
  setState: SetState,
  session: Session,
  startMs: number,
  result: PeriodicBreathingResult,
  kind: 'cached' | 'computed',
): void {
  const rows: CatalogEpisode[] = result.episodes.map((episode) => ({
    sessionId: session.id,
    nightDate: session.date,
    nightStartMs: startMs,
    episode,
  }));
  setState((prev) => ({
    ...prev,
    episodes: rows.length > 0 ? [...prev.episodes, ...rows] : prev.episodes,
    nightsCached: kind === 'cached' ? prev.nightsCached + 1 : prev.nightsCached,
    nightsComputed: kind === 'computed' ? prev.nightsComputed + 1 : prev.nightsComputed,
  }));
}

/** Record a per-night failure (date + short reason), keeping the run resilient. */
function recordFailure(setState: SetState, session: Session, err: unknown): void {
  const reason = err instanceof Error ? err.message : 'Unknown error';
  setState((prev) => ({
    ...prev,
    nightsFailed: prev.nightsFailed + 1,
    failures: [...prev.failures, { date: session.date, reason }],
  }));
}
