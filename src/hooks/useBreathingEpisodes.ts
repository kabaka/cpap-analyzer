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
 * ## Performance
 *
 * Detection is gated behind {@link UseBreathingEpisodesOptions.enabled}; the
 * caller should defer enabling until the primary content (signal viewer canvas
 * paint, dashboard KPIs) has rendered, so detection never blocks first paint.
 *
 * Results are cached in-memory per `sessionId` in a module-level Map so a
 * second mount of the same session reuses the previous computation. The cache
 * is keyed on `sessionId` only — detector parameters and signal data are
 * assumed stable within a session.
 *
 * ## Testability
 *
 * The worker dependency is injected through a module-level factory
 * ({@link _setBreathingWorkerFactoryForTesting}) so unit tests can replace it
 * with a Comlink-shaped stub without spawning a real worker.
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
import { OPFSService } from '@/services/storage/OPFSService';
import { createWorker, type WrappedWorker } from '@/services/workers/createWorker';
import type { AnalysisWorkerAPI } from '@/services/workers/analysis.worker';
import type { Event as TherapyEvent } from '@/types';

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
// Module-level caches + worker factory (testable seams)
// ---------------------------------------------------------------------------

/**
 * In-memory per-session episode cache. We intentionally keep this at module
 * scope (rather than per-mount) so that navigating away from and back to the
 * same session reuses the previous detection rather than re-running it.
 * Detector parameters are stable in v1, so `sessionId` alone is a safe key.
 */
const episodeCache = new Map<string, PeriodicBreathingResult>();

/** In-flight detection promises keyed by sessionId (de-dupe concurrent mounts). */
const inFlight = new Map<string, Promise<PeriodicBreathingResult>>();

type BreathingWorker = Pick<AnalysisWorkerAPI, 'detectPeriodicBreathing'>;

type WorkerFactory = () => WrappedWorker<BreathingWorker>;

let workerFactory: WorkerFactory = () =>
  createWorker<BreathingWorker>(
    () =>
      new Worker(new URL('../services/workers/analysis.worker.ts', import.meta.url), {
        type: 'module',
        name: 'breathing-detection',
      }),
    { name: 'breathing-detection' },
  );

let sharedWorker: WrappedWorker<BreathingWorker> | null = null;

function getWorker(): WrappedWorker<BreathingWorker> {
  if (!sharedWorker) sharedWorker = workerFactory();
  return sharedWorker;
}

/**
 * @internal Testing seam — replace the worker factory with a stub. Accepts a
 * loosely-typed factory so tests can pass a plain `{ proxy, dispose }` object
 * without satisfying the Comlink `Remote<…>` brand. Production code must never
 * call this.
 */
export function _setBreathingWorkerFactoryForTesting(factory: (() => unknown) | null): void {
  // Tear down any active worker so the next call uses the new factory.
  sharedWorker?.dispose();
  sharedWorker = null;
  workerFactory = factory
    ? (factory as WorkerFactory)
    : () =>
        createWorker<BreathingWorker>(
          () =>
            new Worker(new URL('../services/workers/analysis.worker.ts', import.meta.url), {
              type: 'module',
              name: 'breathing-detection',
            }),
          { name: 'breathing-detection' },
        );
  episodeCache.clear();
  inFlight.clear();
}

/**
 * @internal Testing seam — clear the per-session episode cache between tests.
 */
export function _clearBreathingCacheForTesting(): void {
  episodeCache.clear();
  inFlight.clear();
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

/**
 * Best-effort case-insensitive channel lookup against the session manifest.
 * Returns the canonical channel name (as stored) or `null`.
 */
function findChannel(
  manifest: { channels: readonly { name: string }[] },
  needles: readonly string[],
): string | null {
  const byLower = new Map(manifest.channels.map((c) => [c.name.toLowerCase(), c.name]));
  for (const n of needles) {
    const hit = byLower.get(n.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/**
 * Load the flow + optional leak channels from OPFS and run the detector via the
 * Comlink-wrapped worker. Results are memoised in {@link episodeCache} and
 * concurrent calls de-duped via {@link inFlight}.
 */
async function detectForSession(
  sessionId: string,
  sessionStartMs: number,
  flags: readonly DeviceEventFlag[],
): Promise<PeriodicBreathingResult> {
  const cached = episodeCache.get(sessionId);
  if (cached) return cached;

  const existing = inFlight.get(sessionId);
  if (existing) return existing;

  const promise = (async () => {
    if (!OPFSService.isSupported()) {
      throw new Error('OPFS is not supported in this browser; breathing detection unavailable.');
    }

    const opfs = new OPFSService();
    await opfs.initialize();
    const manifest = await opfs.readManifest(sessionId);

    // Prefer minute-ventilation when present (cleaner envelope), else flow.
    const minuteVentName = findChannel(manifest, ['MinuteVent', 'minuteVent', 'minute_vent']);
    const flowName = findChannel(manifest, ['Flow', 'FlowRate', 'Flow Rate']);
    const leakName = findChannel(manifest, ['Leak', 'LeakRate']);

    const channelName = minuteVentName ?? flowName;
    if (!channelName) {
      throw new Error('No flow or minute-ventilation channel available for breathing detection.');
    }
    const descriptor = manifest.channels.find((c) => c.name === channelName);
    if (!descriptor) {
      throw new Error(`Channel "${channelName}" missing descriptor.`);
    }

    const [signal, leakSignal] = await Promise.all([
      opfs.readChannel(sessionId, channelName),
      leakName ? opfs.readChannel(sessionId, leakName) : Promise.resolve(null),
    ]);

    const input: PeriodicBreathingInput = {
      ...(channelName === minuteVentName ? { minuteVent: signal } : { flow: signal }),
      sampleRateHz: descriptor.sampleRate,
      startMs: sessionStartMs,
      eventFlags: flags,
      ...(leakSignal ? { leak: leakSignal } : {}),
    };

    const worker = getWorker();
    const result = await worker.proxy.detectPeriodicBreathing(input);
    episodeCache.set(sessionId, result);
    return result;
  })();

  inFlight.set(sessionId, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(sessionId);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const EMPTY_RESULT: PeriodicBreathingResult = {
  episodes: [],
  recordHours: 0,
  sessionCriterionMet: false,
};

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
  }>(() => ({
    episodes: sessionId ? (episodeCache.get(sessionId)?.episodes ?? null) : null,
    recordHours: sessionId ? (episodeCache.get(sessionId)?.recordHours ?? 0) : 0,
    sessionCriterionMet: sessionId
      ? (episodeCache.get(sessionId)?.sessionCriterionMet ?? false)
      : false,
    loading: false,
    error: null,
  }));

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

    // Cache hit — surface synchronously, skip the network.
    const cached = episodeCache.get(sessionId);
    if (cached) {
      setState({
        episodes: cached.episodes,
        recordHours: cached.recordHours,
        sessionCriterionMet: cached.sessionCriterionMet,
        loading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const flags = toDeviceEventFlags(eventsRef.current);
    detectForSession(sessionId, sessionStartMs, flags)
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
