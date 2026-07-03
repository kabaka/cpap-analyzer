/**
 * Per-session app-computed breathing-pattern (PB/CSR) episode detection.
 *
 * Wires the worker-exposed {@link import('@/analysis/breathing').detectPeriodicBreathing}
 * algorithm into the UI for a single session. Loads the flow signal (and
 * optionally leak) from OPFS, sources device central-apnea / hypopnea flags
 * from IndexedDB via {@link useEventData}, and invokes the worker to produce
 * candidate {@link BreathingEpisode} records.
 *
 * Per ADR 0017 this is **candidate detection, never diagnosis** — the hook
 * returns the worker payload as-is (confidence is a continuous score, not a
 * probability of disease) and surfaces sub-threshold episodes explicitly via
 * `belowDeviceThreshold`.
 *
 * ## Caching (ADR 0023)
 *
 * Detection results flow through the **shared** read-through cache in
 * {@link import('./breathingDetectionCache')} — L1 in-memory Map → L2 IndexedDB
 * (`breathing_detections`) → compute from OPFS → persist. Because the catalog
 * uses the same module and the same composite `id`
 * (`makeBreathingDetectionId(sessionId, BREATHING_ALGO_VERSION,
 * DEFAULT_BREATHING_PARAM_HASH)`), a night computed by the viewer warms the
 * catalog and vice-versa: the two surfaces now share one persistent cache
 * (ending the prior "two caches don't warm each other" divergence). A reload
 * resolves from IndexedDB with no OPFS I/O and no detector run.
 *
 * ## Performance
 *
 * Detection is gated behind {@link UseBreathingEpisodesOptions.enabled}; the
 * caller should defer enabling until the primary content (signal viewer canvas
 * paint, dashboard KPIs) has rendered, so detection never blocks first paint.
 *
 * ## Testability
 *
 * The worker dependency is injected through a module-level factory
 * ({@link _setBreathingWorkerFactoryForTesting}) so unit tests can replace it
 * with a Comlink-shaped stub without spawning a real worker; the shared cache's
 * L1 / L2 seams are cleared via {@link _clearBreathingCacheForTesting}.
 *
 * @module hooks/useBreathingEpisodes
 */

import { useEffect, useRef, useState } from 'react';

import type {
  BreathingEpisode,
  DeviceEventFlag,
  PeriodicBreathingInput,
  PeriodicBreathingResult,
} from '@/analysis/breathing';
import { createWorker, type WrappedWorker } from '@/services/workers/createWorker';
import type { AnalysisWorkerAPI } from '@/services/workers/analysis.worker';
import type { Event as TherapyEvent } from '@/types';

import {
  _clearBreathingDetectionCacheForTesting,
  currentDetectionId,
  getBreathingDetection,
  peekL1,
} from './breathingDetectionCache';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Options accepted by {@link useBreathingEpisodes}. */
export interface UseBreathingEpisodesOptions {
  /** Session ID to detect over, or `undefined` to skip. */
  readonly sessionId: string | undefined;
  /** Epoch-millisecond start of the session (manifest.startTime). */
  readonly sessionStartMs: number | undefined;
  /** Device events for this session — central apneas and hypopneas anchor the cycle nadirs. */
  readonly events: readonly TherapyEvent[];
  /**
   * Set to `false` to defer detection until the caller is ready (e.g. after the
   * primary content has rendered). Defaults to `true`.
   */
  readonly enabled?: boolean;
}

/** Result returned by {@link useBreathingEpisodes}. */
export interface UseBreathingEpisodesResult {
  /** Detected candidate episodes in time order, or `null` while loading. */
  readonly episodes: readonly BreathingEpisode[] | null;
  /** Worker-reported total analyzed record length in hours. */
  readonly recordHours: number;
  /** Whether the session-level CSR ≥5 events/h over ≥2 h gate was met. */
  readonly sessionCriterionMet: boolean;
  /** True while detection is running for this session. */
  readonly loading: boolean;
  /** Human-readable error message, or `null` on success. */
  readonly error: string | null;
}

// ---------------------------------------------------------------------------
// Worker factory (testable seam)
// ---------------------------------------------------------------------------

type BreathingWorker = Pick<AnalysisWorkerAPI, 'detectPeriodicBreathing'>;

type WorkerFactory = () => WrappedWorker<BreathingWorker>;

function defaultWorkerFactory(): WrappedWorker<BreathingWorker> {
  return createWorker<BreathingWorker>(
    () =>
      new Worker(new URL('../services/workers/analysis.worker.ts', import.meta.url), {
        type: 'module',
        name: 'breathing-detection',
      }),
    { name: 'breathing-detection' },
  );
}

let workerFactory: WorkerFactory = defaultWorkerFactory;

let sharedWorker: WrappedWorker<BreathingWorker> | null = null;

function getWorker(): WrappedWorker<BreathingWorker> {
  if (!sharedWorker) sharedWorker = workerFactory();
  return sharedWorker;
}

/** Run the detector for one input on the shared single worker (viewer path). */
async function computeOnSharedWorker(
  input: PeriodicBreathingInput,
): Promise<PeriodicBreathingResult> {
  return getWorker().proxy.detectPeriodicBreathing(input);
}

/**
 * @internal Testing seam — replace the worker factory with a stub. Accepts a
 * loosely-typed factory so tests can pass a plain `{ proxy, dispose }` object
 * without satisfying the Comlink `Remote<…>` brand. Production code must never
 * call this. Also clears the shared read-through cache so a stale L1/L2 entry
 * from a prior test cannot mask the new stub.
 */
export function _setBreathingWorkerFactoryForTesting(factory: (() => unknown) | null): void {
  // Tear down any active worker so the next call uses the new factory.
  sharedWorker?.dispose();
  sharedWorker = null;
  workerFactory = factory ? (factory as WorkerFactory) : defaultWorkerFactory;
  _clearBreathingDetectionCacheForTesting();
}

/**
 * @internal Testing seam — clear the shared per-session detection cache between
 * tests (L1 + in-flight). L2 (IndexedDB) is reset separately via `resetDB`.
 */
export function _clearBreathingCacheForTesting(): void {
  _clearBreathingDetectionCacheForTesting();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Project device events into the {@link DeviceEventFlag} shape the detector
 * consumes. Only central apneas and hypopneas anchor cycle nadirs — every other
 * event type is ignored.
 */
export function toDeviceEventFlags(events: readonly TherapyEvent[]): readonly DeviceEventFlag[] {
  const out: DeviceEventFlag[] = [];
  for (const ev of events) {
    if (ev.type === 'CentralApnea' || ev.type === 'ClearAirway') {
      out.push({ timestampMs: ev.timestamp, durationSec: ev.duration, kind: 'central' });
    } else if (ev.type === 'Hypopnea') {
      out.push({ timestampMs: ev.timestamp, durationSec: ev.duration, kind: 'hypopnea' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const EMPTY_RESULT: PeriodicBreathingResult = {
  episodes: [],
  recordHours: 0,
  sessionCriterionMet: false,
};

/** Read the synchronous L1 result for a session, or `null`. */
function l1ResultFor(sessionId: string | undefined): PeriodicBreathingResult | null {
  if (!sessionId) return null;
  return peekL1(currentDetectionId(sessionId)) ?? null;
}

/**
 * Detect candidate periodic-breathing and Cheyne–Stokes-respiration episodes
 * for one session. See module docs for caching and gating semantics.
 */
export function useBreathingEpisodes(
  options: UseBreathingEpisodesOptions,
): UseBreathingEpisodesResult {
  const { sessionId, sessionStartMs, events, enabled = true } = options;

  const [state, setState] = useState<{
    episodes: readonly BreathingEpisode[] | null;
    recordHours: number;
    sessionCriterionMet: boolean;
    loading: boolean;
    error: string | null;
  }>(() => {
    const memo = l1ResultFor(sessionId);
    return {
      episodes: memo?.episodes ?? null,
      recordHours: memo?.recordHours ?? 0,
      sessionCriterionMet: memo?.sessionCriterionMet ?? false,
      loading: false,
      error: null,
    };
  });

  // Keep the latest event flags accessible inside the async effect without
  // re-triggering it: events array identity changes on every render but the
  // detection is keyed on sessionId.
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    if (
      !enabled ||
      !sessionId ||
      sessionStartMs === undefined ||
      !Number.isFinite(sessionStartMs)
    ) {
      setState({
        episodes: null,
        recordHours: 0,
        sessionCriterionMet: false,
        loading: false,
        error: null,
      });
      return;
    }

    // L1 hit — surface synchronously, skip the read-through.
    const memo = l1ResultFor(sessionId);
    if (memo) {
      setState({
        episodes: memo.episodes,
        recordHours: memo.recordHours,
        sessionCriterionMet: memo.sessionCriterionMet,
        loading: false,
        error: null,
      });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const flags = toDeviceEventFlags(eventsRef.current);
    getBreathingDetection({
      sessionId,
      sessionStartMs,
      flags,
      compute: computeOnSharedWorker,
      throwOnNoChannel: true,
      signal: controller.signal,
    })
      .then((result) => {
        if (cancelled) return;
        setState({
          episodes: result.episodes,
          recordHours: result.recordHours,
          sessionCriterionMet: result.sessionCriterionMet,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          episodes: null,
          recordHours: 0,
          sessionCriterionMet: false,
          loading: false,
          error: err instanceof Error ? err.message : 'Breathing detection failed',
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionId, sessionStartMs, enabled]);

  if (!enabled || !sessionId) {
    return {
      episodes: EMPTY_RESULT.episodes,
      recordHours: EMPTY_RESULT.recordHours,
      sessionCriterionMet: EMPTY_RESULT.sessionCriterionMet,
      loading: false,
      error: null,
    };
  }

  return state;
}
