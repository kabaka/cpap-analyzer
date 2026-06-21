/**
 * Shared read-through cache for per-night periodic-breathing / Cheyne–Stokes
 * (PB/CSR) detection results, used by BOTH the per-session viewer
 * ({@link import('./useBreathingEpisodes').useBreathingEpisodes}) and the
 * cross-night episode catalog
 * ({@link import('./useBreathingEpisodeCatalog').useBreathingEpisodeCatalog}).
 *
 * Implements the lookup contract of ADR 0023 and the storage spec
 * (docs/analysis/breathing-detection-cache-storage.md §8.3):
 *
 *   **L1 in-memory Map → L2 IndexedDB → compute from OPFS → write L2 + L1.**
 *
 * Both surfaces resolve the SAME persistent `id`
 * (`makeBreathingDetectionId(sessionId, BREATHING_ALGO_VERSION,
 * DEFAULT_BREATHING_PARAM_HASH)`), so a night computed by the viewer is an
 * IndexedDB hit for the catalog and vice-versa — the two surfaces now warm a
 * single shared cache instead of diverging (the pre-0023 "two caches don't warm
 * each other" problem). The L1 Map is keyed by the composite `id` (not bare
 * `sessionId`) so it stays correct across an algorithm/parameter-version change
 * within a single tab session, and is future-proof for tunable params.
 *
 * Persisting to L2 is **best-effort**: a `QuotaExceededError` (or any write
 * failure) is swallowed and logged (storage spec §7 — the cache is an
 * accelerator, never source of truth), so a failed cache write can never break
 * detection. The freshly-computed in-memory result is returned regardless.
 *
 * The actual worker invocation is injected via a {@link ComputeRunner} so each
 * surface picks its own scheduling: the viewer uses a single dedicated worker;
 * the catalog fans uncached nights across a {@link WorkerPool} for parallelism.
 *
 * Every symbol here is worker-agnostic and side-effect-isolated behind testing
 * seams ({@link _clearBreathingDetectionCacheForTesting},
 * {@link _setBreathingDbForTesting}) so unit tests can stub the DB and clear L1
 * without a real worker or IndexedDB.
 *
 * @module hooks/breathingDetectionCache
 */

import {
  BREATHING_ALGO_VERSION,
  DEFAULT_BREATHING_PARAM_HASH,
  makeBreathingDetectionId,
  type PeriodicBreathingInput,
  type PeriodicBreathingResult,
} from '@/analysis/breathing';
import { getDB } from '@/services/storage/getDB';
import type {
  IndexedDBService,
  StoredBreathingDetection,
} from '@/services/storage/IndexedDBService';
import { OPFSService } from '@/services/storage/OPFSService';
import type { DeviceEventFlag } from '@/analysis/breathing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Runs the detector for one prepared input and resolves the result. Injected by
 * the caller so the viewer can use a single worker and the catalog a pool.
 *
 * Implementations should honour the optional `signal` (abort the work / reject
 * promptly) so cancellation propagates from the hook through to the worker pool.
 */
export type ComputeRunner = (
  input: PeriodicBreathingInput,
  signal?: AbortSignal,
) => Promise<PeriodicBreathingResult>;

// ---------------------------------------------------------------------------
// L1 cache + DB seam
// ---------------------------------------------------------------------------

/**
 * Process-lifetime L1 memo, keyed by the composite cache `id`
 * (`makeBreathingDetectionId(...)`), shared across every surface and mount.
 */
const l1 = new Map<string, PeriodicBreathingResult>();

/** In-flight compute promises keyed by composite `id` (de-dupe concurrent callers). */
const inFlight = new Map<string, Promise<PeriodicBreathingResult>>();

/** DB accessor — overridable in tests so L2 can be stubbed without IndexedDB. */
let dbAccessor: () => Promise<IndexedDBService> = getDB;

/**
 * Build the current-version composite cache id for a session. Exported so the
 * catalog can construct the id list for a single bulk `getBreathingDetectionsByIds`
 * read (the "reading cache" phase).
 */
export function currentDetectionId(sessionId: string): string {
  return makeBreathingDetectionId(sessionId, BREATHING_ALGO_VERSION, DEFAULT_BREATHING_PARAM_HASH);
}

/** Read an L1 entry by composite id, or `undefined`. */
export function peekL1(id: string): PeriodicBreathingResult | undefined {
  return l1.get(id);
}

/** Seed L1 from a bulk L2 read (catalog "reading cache" phase). */
export function primeL1FromRecord(id: string, record: StoredBreathingDetection): void {
  if (l1.has(id)) return;
  l1.set(id, {
    episodes: record.episodes,
    recordHours: record.recordHours,
    sessionCriterionMet: record.sessionCriterionMet,
  });
}

// ---------------------------------------------------------------------------
// OPFS signal preparation
// ---------------------------------------------------------------------------

/** Best-effort case-insensitive channel lookup against the session manifest. */
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

/** Empty result for a session with no usable flow/minute-vent channel. */
const EMPTY_RESULT: PeriodicBreathingResult = {
  episodes: [],
  recordHours: 0,
  sessionCriterionMet: false,
};

/**
 * Load the flow (or minute-ventilation) + optional leak channels from OPFS and
 * assemble the detector input. Returns `null` when the session has no usable
 * channel — the catalog treats this as a clean "0 episodes" night, while the
 * single-session viewer surfaces it as an error (it passes `throwOnNoChannel`).
 */
async function prepareInput(
  sessionId: string,
  sessionStartMs: number,
  flags: readonly DeviceEventFlag[],
  opfs: OPFSService,
  throwOnNoChannel: boolean,
): Promise<PeriodicBreathingInput | null> {
  const manifest = await opfs.readManifest(sessionId);

  // Prefer minute-ventilation when present (cleaner envelope), else flow.
  const minuteVentName = findChannel(manifest, ['MinuteVent', 'minuteVent', 'minute_vent']);
  const flowName = findChannel(manifest, ['Flow', 'FlowRate', 'Flow Rate']);
  const leakName = findChannel(manifest, ['Leak', 'LeakRate']);

  const channelName = minuteVentName ?? flowName;
  if (!channelName) {
    if (throwOnNoChannel) {
      throw new Error('No flow or minute-ventilation channel available for breathing detection.');
    }
    return null;
  }
  const descriptor = manifest.channels.find((c) => c.name === channelName);
  if (!descriptor) {
    if (throwOnNoChannel) {
      throw new Error(`Channel "${channelName}" missing descriptor.`);
    }
    return null;
  }

  const [signal, leakSignal] = await Promise.all([
    opfs.readChannel(sessionId, channelName),
    leakName ? opfs.readChannel(sessionId, leakName) : Promise.resolve(null),
  ]);

  return {
    ...(channelName === minuteVentName ? { minuteVent: signal } : { flow: signal }),
    sampleRateHz: descriptor.sampleRate,
    startMs: sessionStartMs,
    eventFlags: flags,
    ...(leakSignal ? { leak: leakSignal } : {}),
  };
}

// ---------------------------------------------------------------------------
// Read-through core
// ---------------------------------------------------------------------------

/** Arguments for {@link getBreathingDetection}. */
export interface GetBreathingDetectionArgs {
  readonly sessionId: string;
  readonly sessionStartMs: number;
  readonly flags: readonly DeviceEventFlag[];
  /**
   * Runs the detector for the prepared input. Lets the caller choose single
   * worker vs. pool. Receives the abort signal so the runner can cancel.
   */
  readonly compute: ComputeRunner;
  /**
   * When `true`, a session with no usable channel rejects (viewer semantics);
   * when `false`, it resolves to an empty result (catalog semantics).
   *
   * @default false
   */
  readonly throwOnNoChannel?: boolean;
  /**
   * Pre-initialized OPFS service to reuse across many calls (the catalog opens
   * one and shares it). When omitted, a fresh one is created and initialized.
   */
  readonly opfs?: OPFSService;
  readonly signal?: AbortSignal;
}

/**
 * Resolve a session's detection result through the L1 → L2 → compute → persist
 * read-through. Concurrent calls for the same `id` share one in-flight promise.
 *
 * @throws if OPFS is unsupported, if `throwOnNoChannel` is set and the session
 *   lacks a usable channel, or if the compute runner rejects (e.g. abort).
 */
export async function getBreathingDetection(
  args: GetBreathingDetectionArgs,
): Promise<PeriodicBreathingResult> {
  const { sessionId, sessionStartMs, flags, compute, throwOnNoChannel = false, signal } = args;
  const id = currentDetectionId(sessionId);

  // L1 hit.
  const memo = l1.get(id);
  if (memo) return memo;

  // De-dupe concurrent compute for the same night.
  const existing = inFlight.get(id);
  if (existing) return existing;

  const promise = (async (): Promise<PeriodicBreathingResult> => {
    if (!OPFSService.isSupported()) {
      throw new Error('OPFS is not supported in this browser; breathing detection unavailable.');
    }

    // L2 (IndexedDB) hit — valid by construction (the id embeds the current
    // version + param hash, storage spec §4.2).
    const db = await dbAccessor();
    const cached = await db.getBreathingDetectionById(id);
    if (cached) {
      const result: PeriodicBreathingResult = {
        episodes: cached.episodes,
        recordHours: cached.recordHours,
        sessionCriterionMet: cached.sessionCriterionMet,
      };
      l1.set(id, result);
      return result;
    }

    // Miss → compute from OPFS.
    const opfs = args.opfs ?? (await initOpfs());
    const input = await prepareInput(sessionId, sessionStartMs, flags, opfs, throwOnNoChannel);
    const result = input ? await compute(input, signal) : EMPTY_RESULT;

    l1.set(id, result);
    // Best-effort persist (storage spec §7): swallow QuotaExceededError and any
    // other write failure — a failed cache write must never break detection.
    void persistBestEffort(db, sessionId, result);
    return result;
  })();

  inFlight.set(id, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(id);
  }
}

/** Create + initialize a fresh OPFS service. */
async function initOpfs(): Promise<OPFSService> {
  const opfs = new OPFSService();
  await opfs.initialize();
  return opfs;
}

/**
 * Persist a freshly-computed result to L2, swallowing any failure. The `date` is
 * looked up cheaply only when we have to write; we keep it on the record so the
 * catalog can range-read by date. `computedAt` is the write timestamp.
 */
async function persistBestEffort(
  db: IndexedDBService,
  sessionId: string,
  result: PeriodicBreathingResult,
): Promise<void> {
  try {
    const session = await db.getSession(sessionId);
    if (!session) return; // Night vanished (deleted mid-compute) — nothing to cache.
    const record: StoredBreathingDetection = {
      id: currentDetectionId(sessionId),
      sessionId,
      date: session.date,
      algoVersion: BREATHING_ALGO_VERSION,
      paramHash: DEFAULT_BREATHING_PARAM_HASH,
      episodes: result.episodes,
      recordHours: result.recordHours,
      sessionCriterionMet: result.sessionCriterionMet,
      computedAt: new Date().toISOString(),
    };
    await db.putBreathingDetection(record);
  } catch (error) {
    // Swallow-and-degrade (storage spec §7): the cache is an accelerator, not
    // source of truth. Log for diagnostics; never propagate.
    // eslint-disable-next-line no-console
    console.warn('Breathing-detection cache write failed (non-fatal):', error);
  }
}

// ---------------------------------------------------------------------------
// Testing seams
// ---------------------------------------------------------------------------

/** @internal Clear the shared L1 cache + in-flight map between tests. */
export function _clearBreathingDetectionCacheForTesting(): void {
  l1.clear();
  inFlight.clear();
}

/**
 * @internal Override the IndexedDB accessor so tests can stub L2 without a real
 * database. Pass `null` to restore the production {@link getDB} accessor.
 */
export function _setBreathingDbForTesting(
  accessor: (() => Promise<IndexedDBService>) | null,
): void {
  dbAccessor = accessor ?? getDB;
}
