/**
 * Background import controller (ADR 0026).
 *
 * A module-level singleton that owns the ENTIRE import lifecycle OUTSIDE the
 * React tree:
 *
 * - It holds the service instances, the shared {@link WorkerPool}, the in-flight
 *   promise, the per-job {@link AbortController}, and the completed result. Because
 *   these strong references live on the singleton — not on a React component — an
 *   import survives navigation/unmount and keeps running.
 * - It subscribes to each service's internal progress callback, ADAPTS that to the
 *   unified, serializable {@link ImportJobProgress}, computes throughput (EWMA) and
 *   ETA, caps recent errors, and writes to {@link useImportStore} — COALESCED via
 *   `requestAnimationFrame` so a high-frequency progress stream produces at most one
 *   store write per frame. Terminal states flush synchronously.
 * - It mirrors a coarse status into {@link useAppStore} so the existing StatusBar and
 *   other consumers keep working unchanged.
 * - `cancel(jobId)` aborts the job's controller; the next `checkpoint(signal)` in the
 *   pipeline stops the work and the worker pool drops still-queued parse tasks.
 *
 * Single active job PER KIND: a CPAP and a Fitbit import may run concurrently, but a
 * second start of the SAME kind while one is active is rejected (the caller is told
 * via the returned outcome rather than silently dropped).
 *
 * @module services/import/ImportController
 */

import { ImportService } from './ImportService';
import type { EDFWorkerFactory, EDFWorkerPoolFactory } from './ImportService';
import { GoogleHealthImportService } from './googlehealth/GoogleHealthImportService';
import type { GoogleHealthImportOptions } from './googlehealth/GoogleHealthImportService';
import {
  RECENT_ERRORS_CAP,
  isImportAbortedError,
  type GoogleHealthImportProgress,
  type ImportJobProgress,
  type ImportOptions,
  type ImportProgress,
  type RecentImportError,
  type StageProgress,
} from './types';

import { createWorker } from '@/services/workers/createWorker';
import { WorkerPool } from '@/services/workers/WorkerPool';
import type { EDFParserWorkerAPI } from '@/services/workers/edfParser.worker';
import { getDB } from '@/services/storage/getDB';
import { OPFSService } from '@/services/storage/OPFSService';
import type { IndexedDBService } from '@/services/storage/IndexedDBService';

import type { GoogleHealthScanResult } from '@/types/fitbit';
import type { ImportRecord, IntegrationImportRecord } from '@/types/storage';

import { useImportStore } from '@/stores/useImportStore';
import type { ImportJobResult, LegacyImportProgress } from '@/stores/useImportStore';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Upper bound on parser-pool workers (mirrors the old hook constant). */
const MAX_POOL_WORKERS = 8;

/**
 * EWMA smoothing factor for throughput. Higher = more responsive to recent
 * samples, lower = smoother. 0.3 balances a stable ETA against adaptation.
 */
const THROUGHPUT_ALPHA = 0.3;

// ---------------------------------------------------------------------------
// Public outcome of a start() call
// ---------------------------------------------------------------------------

/** Outcome of attempting to start a job. */
export type StartOutcome =
  | { readonly ok: true; readonly jobId: string }
  | { readonly ok: false; readonly reason: 'busy'; readonly activeJobId: string };

// ---------------------------------------------------------------------------
// Per-job runtime state (controller-private; NOT in the store)
// ---------------------------------------------------------------------------

interface JobRuntime {
  readonly jobId: string;
  readonly kind: 'cpap' | 'fitbit';
  readonly abort: AbortController;
  /** The in-flight pipeline promise (kept alive on the singleton). */
  readonly promise: Promise<void>;
  /** Latest coalesced snapshot awaiting a flush, or null when flushed. */
  pending: { progress: ImportJobProgress; legacy: LegacyImportProgress } | null;
  /** Scheduled rAF handle (or timeout id) for the pending flush, if any. */
  rafHandle: number | null;
  // --- throughput / ETA bookkeeping ---
  lastSampleMs: number;
  lastItemsProcessed: number;
  ewmaItemsPerSec: number | null;
}

// ---------------------------------------------------------------------------
// Worker factories (moved off the React hook; created lazily, shared)
// ---------------------------------------------------------------------------

function makeWorkerFactory(): EDFWorkerFactory {
  return () =>
    createWorker<EDFParserWorkerAPI>(
      () =>
        new Worker(new URL('../workers/edfParser.worker.ts', import.meta.url), {
          type: 'module',
          name: 'edf-parser',
        }),
      { timeoutMs: 60_000 },
    );
}

function recommendedPoolSize(): number {
  const hw =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 4;
  return Math.max(1, Math.min(hw, MAX_POOL_WORKERS));
}

function makeWorkerPoolFactory(): EDFWorkerPoolFactory {
  return () =>
    new WorkerPool<EDFParserWorkerAPI>({
      workerFactory: (name?: string) =>
        new Worker(new URL('../workers/edfParser.worker.ts', import.meta.url), {
          type: 'module',
          name: name ?? 'edf-parser',
        }),
      minWorkers: 1,
      maxWorkers: recommendedPoolSize(),
      taskTimeoutMs: 60_000,
    });
}

async function getOPFS(): Promise<OPFSService | null> {
  if (!OPFSService.isSupported()) return null;
  const opfs = new OPFSService();
  await opfs.initialize();
  return opfs;
}

// ---------------------------------------------------------------------------
// Environment helpers (rAF with non-DOM fallback)
// ---------------------------------------------------------------------------

function scheduleFrame(cb: () => void): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(() => cb());
  }
  // Non-DOM / test environment: fall back to a macrotask so updates still
  // coalesce within a turn but flush promptly.
  return setTimeout(cb, 0) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class ImportController {
  /** One active job slot per kind. */
  private readonly active: Map<'cpap' | 'fitbit', JobRuntime> = new Map();

  /** Lazily created services, reused across jobs. */
  private cpapDeps: {
    db: IndexedDBService;
    opfs: OPFSService | null;
    service: ImportService;
  } | null = null;
  private fitbitService: GoogleHealthImportService | null = null;

  // -----------------------------------------------------------------------
  // CPAP
  // -----------------------------------------------------------------------

  /**
   * Start a CPAP import from `File[]` or a `FileSystemDirectoryHandle`.
   *
   * Mirrors what {@link useImport} passed to {@link ImportService} previously.
   * Returns a {@link StartOutcome}; a second concurrent CPAP start is rejected.
   */
  startCpap(
    input: File[] | FileSystemDirectoryHandle,
    opts: { sourceType: ImportOptions['sourceType']; skipDuplicates?: boolean } = {
      sourceType: Array.isArray(input) ? 'file' : 'sd-card',
    },
  ): StartOutcome {
    const existing = this.active.get('cpap');
    if (existing) {
      return { ok: false, reason: 'busy', activeJobId: existing.jobId };
    }

    const jobId = crypto.randomUUID();
    const abort = new AbortController();
    const startedAtMs = Date.now();

    // Seed an initial snapshot so subscribers see the job immediately.
    this.initJob(jobId, 'cpap', startedAtMs, this.cpapStages());

    const runtime: JobRuntime = {
      jobId,
      kind: 'cpap',
      abort,
      pending: null,
      rafHandle: null,
      lastSampleMs: startedAtMs,
      lastItemsProcessed: 0,
      ewmaItemsPerSec: null,
      // Placeholder; replaced just below once we can reference `runtime`.
      promise: Promise.resolve(),
    };
    this.active.set('cpap', runtime);

    const promise = this.runCpap(runtime, input, opts, startedAtMs);
    // Replace the placeholder promise with the real one (kept alive here).
    (runtime as { promise: Promise<void> }).promise = promise;

    return { ok: true, jobId };
  }

  private async runCpap(
    runtime: JobRuntime,
    input: File[] | FileSystemDirectoryHandle,
    opts: { sourceType: ImportOptions['sourceType']; skipDuplicates?: boolean },
    startedAtMs: number,
  ): Promise<void> {
    try {
      const { service } = await this.getCpapDeps();

      const options: ImportOptions = {
        sourceType: opts.sourceType,
        skipDuplicates: opts.skipDuplicates ?? true,
        signal: runtime.abort.signal,
        onProgress: (p) => this.onCpapProgress(runtime, p, startedAtMs),
      };

      const record = Array.isArray(input)
        ? await service.importFiles(input, options)
        : await service.importDirectory(input, options);

      this.finishSuccess(runtime, { kind: 'cpap', record });
    } catch (err) {
      this.finishFailure(runtime, err);
    } finally {
      this.active.delete('cpap');
    }
  }

  // -----------------------------------------------------------------------
  // Fitbit (Google Health)
  // -----------------------------------------------------------------------

  /**
   * Scan a Google Health export. Scanning is cheap (filenames only) and does not
   * occupy the single-active-job slot.
   */
  async scanFitbit(dirHandle: FileSystemDirectoryHandle): Promise<GoogleHealthScanResult> {
    const service = await this.getFitbitService();
    return service.scan(dirHandle);
  }

  /**
   * Start a Fitbit import for the selected data types. Returns a
   * {@link StartOutcome}; a second concurrent Fitbit start is rejected.
   */
  startFitbit(
    input: {
      dirHandle: FileSystemDirectoryHandle;
      scanResult: GoogleHealthScanResult;
      selectedDataTypes: readonly string[];
    },
    opts: { skipDuplicates?: boolean } = {},
  ): StartOutcome {
    const existing = this.active.get('fitbit');
    if (existing) {
      return { ok: false, reason: 'busy', activeJobId: existing.jobId };
    }

    const jobId = crypto.randomUUID();
    const abort = new AbortController();
    const startedAtMs = Date.now();

    this.initJob(jobId, 'fitbit', startedAtMs, this.fitbitStages());

    const runtime: JobRuntime = {
      jobId,
      kind: 'fitbit',
      abort,
      pending: null,
      rafHandle: null,
      lastSampleMs: startedAtMs,
      lastItemsProcessed: 0,
      ewmaItemsPerSec: null,
      promise: Promise.resolve(),
    };
    this.active.set('fitbit', runtime);

    const promise = this.runFitbit(runtime, input, opts, startedAtMs);
    (runtime as { promise: Promise<void> }).promise = promise;

    return { ok: true, jobId };
  }

  private async runFitbit(
    runtime: JobRuntime,
    input: {
      dirHandle: FileSystemDirectoryHandle;
      scanResult: GoogleHealthScanResult;
      selectedDataTypes: readonly string[];
    },
    opts: { skipDuplicates?: boolean },
    startedAtMs: number,
  ): Promise<void> {
    try {
      const service = await this.getFitbitService();

      const options: GoogleHealthImportOptions = {
        selectedDataTypes: input.selectedDataTypes,
        skipDuplicates: opts.skipDuplicates ?? true,
        signal: runtime.abort.signal,
        onProgress: (p) => this.onFitbitProgress(runtime, p, startedAtMs),
      };

      const record = await service.import(input.dirHandle, input.scanResult, options);
      this.finishSuccess(runtime, { kind: 'fitbit', record });
    } catch (err) {
      this.finishFailure(runtime, err);
    } finally {
      this.active.delete('fitbit');
    }
  }

  // -----------------------------------------------------------------------
  // Cancellation, result reading, dismissal
  // -----------------------------------------------------------------------

  /** Abort a running job. The next pipeline checkpoint stops the work. */
  cancel(jobId: string): void {
    const runtime = this.findRuntime(jobId);
    if (!runtime) {
      // Job already terminal (or unknown): just mark it cancelled in the store
      // if it is still present and non-terminal.
      const entry = useImportStore.getState().jobs[jobId];
      if (entry && entry.result === null && entry.error === null) {
        const cancelled: ImportJobProgress = {
          ...entry.progress,
          status: 'cancelled',
          activeStageId: null,
          etaMs: null,
          currentLabel: 'Import cancelled',
        };
        this.flushTerminal(jobId, cancelled, entry.legacy);
      }
      return;
    }
    runtime.abort.abort();
  }

  /** Read a completed job's result (for the wizard summary). */
  getResult(jobId: string): ImportRecord | IntegrationImportRecord | null {
    return useImportStore.getState().jobs[jobId]?.result?.record ?? null;
  }

  /** Remove a job from the store once its summary has been consumed. */
  dismiss(jobId: string): void {
    useImportStore.getState().dismissJob(jobId);
    // If a coarse mirror still points at idle, leave it; clear active flags.
    const anyActive = Object.values(useImportStore.getState().jobs).some(
      (e) => e.progress.status === 'scanning' || e.progress.status === 'running',
    );
    if (!anyActive) {
      useAppStore.getState().setImportStatus('idle');
      useAppStore.getState().setImportProgress({ current: 0, total: 0 });
    }
  }

  /** Whether a job of the given kind is currently active. */
  isActive(kind: 'cpap' | 'fitbit'): boolean {
    return this.active.has(kind);
  }

  /** The active job id for a kind, or null. */
  activeJobId(kind: 'cpap' | 'fitbit'): string | null {
    return this.active.get(kind)?.jobId ?? null;
  }

  /**
   * Await the in-flight promise of a kind's active job (or resolve immediately
   * if none). Used by tests to await job completion deterministically.
   */
  async whenIdle(kind: 'cpap' | 'fitbit'): Promise<void> {
    const runtime = this.active.get(kind);
    if (runtime) {
      await runtime.promise.catch(() => undefined);
    }
  }

  /**
   * Inject pre-built services and reset all state. TEST-ONLY seam so the
   * singleton can be driven without real Web Workers / IndexedDB.
   *
   * @internal
   */
  __resetForTests(deps?: {
    cpapService?: ImportService;
    fitbitService?: GoogleHealthImportService;
  }): void {
    for (const runtime of this.active.values()) {
      if (runtime.rafHandle !== null) cancelFrame(runtime.rafHandle);
    }
    this.active.clear();
    this.cpapDeps = deps?.cpapService
      ? { db: null as unknown as IndexedDBService, opfs: null, service: deps.cpapService }
      : null;
    this.fitbitService = deps?.fitbitService ?? null;
  }

  // -----------------------------------------------------------------------
  // Lazy dependency construction
  // -----------------------------------------------------------------------

  private async getCpapDeps(): Promise<{
    db: IndexedDBService;
    opfs: OPFSService | null;
    service: ImportService;
  }> {
    if (this.cpapDeps) return this.cpapDeps;
    const db = await getDB();
    const opfs = await getOPFS();
    const service = new ImportService(db, opfs, makeWorkerFactory(), makeWorkerPoolFactory());
    this.cpapDeps = { db, opfs, service };
    return this.cpapDeps;
  }

  private async getFitbitService(): Promise<GoogleHealthImportService> {
    if (this.fitbitService) return this.fitbitService;
    const db = await getDB();
    this.fitbitService = new GoogleHealthImportService(db);
    return this.fitbitService;
  }

  // -----------------------------------------------------------------------
  // Progress adaptation
  // -----------------------------------------------------------------------

  private onCpapProgress(runtime: JobRuntime, p: ImportProgress, startedAtMs: number): void {
    const progress = this.adaptCpap(runtime, p, startedAtMs);
    const legacy: LegacyImportProgress = { kind: 'cpap', progress: p };
    this.publish(runtime, progress, legacy);
  }

  private onFitbitProgress(
    runtime: JobRuntime,
    p: GoogleHealthImportProgress,
    startedAtMs: number,
  ): void {
    const progress = this.adaptFitbit(runtime, p, startedAtMs);
    const legacy: LegacyImportProgress = { kind: 'fitbit', progress: p };
    this.publish(runtime, progress, legacy);
  }

  /** Map the CPAP service's internal progress to the unified shape. */
  private adaptCpap(
    runtime: JobRuntime,
    p: ImportProgress,
    startedAtMs: number,
  ): ImportJobProgress {
    const status = mapCpapStatus(p.status);
    const itemsProcessed = p.filesProcessed;
    const itemsTotal = p.totalFiles > 0 ? p.totalFiles : null;

    // Stage assembly. Totals: parse=files, build=days, store=sessions.
    const scanDone = p.totalFiles > 0 || p.status !== 'scanning';
    const stages: StageProgress[] = [
      {
        id: 'scan',
        label: 'Scanning files',
        state: stageState(p.status === 'scanning' ? 'active' : scanDone ? 'done' : 'pending'),
        determinate: false,
        completed: p.totalFiles,
        total: p.totalFiles > 0 ? p.totalFiles : null,
        unit: 'files',
      },
      {
        id: 'parse',
        label: 'Parsing files',
        state: parseStageState(p),
        determinate: p.totalFiles > 0,
        completed: p.filesProcessed,
        total: p.totalFiles > 0 ? p.totalFiles : null,
        unit: 'files',
      },
      {
        id: 'build',
        label: 'Building days',
        state: phaseState(p.status, 'building', p.dayGroupsProcessed, p.totalDayGroups),
        determinate: p.totalDayGroups > 0,
        completed: p.dayGroupsProcessed,
        total: p.totalDayGroups > 0 ? p.totalDayGroups : null,
        unit: 'days',
      },
      {
        id: 'store',
        label: 'Storing sessions',
        state: phaseState(p.status, 'storing', p.sessionsStored, p.totalSessionsToStore),
        determinate: p.totalSessionsToStore > 0,
        completed: p.sessionsStored,
        total: p.totalSessionsToStore > 0 ? p.totalSessionsToStore : null,
        unit: 'sessions',
      },
    ];

    const activeStageId = activeStage(stages, status);

    // ETA is suppressed while the gating stage (parse) is still indeterminate,
    // i.e. before the file total is known.
    const gatingIndeterminate = p.totalFiles === 0;
    const { throughputPerSec, etaMs } = this.computeRate(
      runtime,
      itemsProcessed,
      itemsTotal,
      gatingIndeterminate || status === 'complete' || status === 'error',
    );

    return {
      jobId: runtime.jobId,
      kind: 'cpap',
      status,
      stages,
      activeStageId,
      startedAtMs,
      bytesProcessed: p.bytesRead,
      bytesTotal: p.totalBytes > 0 ? p.totalBytes : null,
      itemsProcessed,
      itemsTotal,
      throughputPerSec,
      etaMs,
      errorCount: p.errors.length,
      warningCount: p.warnings.length,
      recentErrors: capErrors(p.errors),
      currentLabel: p.currentStage || statusLabel(status),
    };
  }

  /** Map the Fitbit service's internal progress to the unified shape. */
  private adaptFitbit(
    runtime: JobRuntime,
    p: GoogleHealthImportProgress,
    startedAtMs: number,
  ): ImportJobProgress {
    const status = mapFitbitStatus(p.status);
    const itemsProcessed = p.recordsProcessed;
    const itemsTotal = p.recordsTotal > 0 ? p.recordsTotal : null;

    // The import stage carries one sub-item per selected data type. We can only
    // mark the current/processed ones from the coarse counters the service emits.
    const subItems = Array.from({ length: p.dataTypesTotal }, (_, idx) => {
      const done = idx < p.dataTypesProcessed;
      const activeIdx = idx === p.dataTypesProcessed && status === 'running';
      return {
        id: `dt-${String(idx)}`,
        label: activeIdx
          ? p.currentDataType || `Data type ${String(idx + 1)}`
          : `Data type ${String(idx + 1)}`,
        state: stageState(done ? 'done' : activeIdx ? 'active' : 'pending'),
        completed: done ? 1 : 0,
        total: 1,
      };
    });

    const stages: StageProgress[] = [
      {
        id: 'scan',
        label: 'Scanning export',
        state: stageState(status === 'scanning' ? 'active' : 'done'),
        determinate: false,
        completed: 0,
        total: null,
        unit: 'files',
      },
      {
        id: 'import',
        label: 'Importing records',
        state: importStageState(status),
        determinate: p.recordsTotal > 0,
        completed: p.recordsProcessed,
        total: p.recordsTotal > 0 ? p.recordsTotal : null,
        unit: 'records',
        subItems,
      },
    ];

    const activeStageId = activeStage(stages, status);
    const gatingIndeterminate = p.recordsTotal === 0;
    const { throughputPerSec, etaMs } = this.computeRate(
      runtime,
      itemsProcessed,
      itemsTotal,
      gatingIndeterminate || status === 'complete' || status === 'error',
    );

    return {
      jobId: runtime.jobId,
      kind: 'fitbit',
      status,
      stages,
      activeStageId,
      startedAtMs,
      bytesProcessed: 0,
      bytesTotal: null,
      itemsProcessed,
      itemsTotal,
      throughputPerSec,
      etaMs,
      errorCount: p.errors.length,
      warningCount: p.warnings.length,
      recentErrors: capErrors(p.errors),
      currentLabel: p.currentStage || statusLabel(status),
    };
  }

  // -----------------------------------------------------------------------
  // Throughput (EWMA) + ETA
  // -----------------------------------------------------------------------

  /**
   * Update the job's EWMA throughput from the latest items count and derive an
   * ETA. ETA is suppressed (null) whenever `suppress` is set — e.g. while a
   * gating stage is still indeterminate, or in a terminal state.
   */
  private computeRate(
    runtime: JobRuntime,
    itemsProcessed: number,
    itemsTotal: number | null,
    suppress: boolean,
  ): { throughputPerSec: number | null; etaMs: number | null } {
    const now = Date.now();

    // Only fold in a sample when measurable forward progress was made over a
    // non-trivial interval; this avoids divide-by-zero and 0-delta noise.
    runtime.ewmaItemsPerSec = updateThroughputEwma(runtime.ewmaItemsPerSec, {
      dItems: itemsProcessed - runtime.lastItemsProcessed,
      dtMs: now - runtime.lastSampleMs,
    });
    if (now - runtime.lastSampleMs >= 1 && itemsProcessed - runtime.lastItemsProcessed > 0) {
      runtime.lastSampleMs = now;
      runtime.lastItemsProcessed = itemsProcessed;
    }

    const rate = runtime.ewmaItemsPerSec;
    if (suppress) {
      return { throughputPerSec: rate, etaMs: null };
    }
    return { throughputPerSec: rate, etaMs: computeEtaMs(rate, itemsProcessed, itemsTotal) };
  }

  // -----------------------------------------------------------------------
  // Publishing (rAF-coalesced) + terminal flush
  // -----------------------------------------------------------------------

  /**
   * Queue a progress snapshot for a coalesced flush. Terminal states flush
   * synchronously so the final snapshot is never dropped.
   */
  private publish(
    runtime: JobRuntime,
    progress: ImportJobProgress,
    legacy: LegacyImportProgress,
  ): void {
    const terminal =
      progress.status === 'complete' ||
      progress.status === 'error' ||
      progress.status === 'cancelled';

    if (terminal) {
      this.cancelPendingFlush(runtime);
      this.writeStore(runtime.jobId, progress, legacy);
      this.mirrorAppStore(progress);
      return;
    }

    runtime.pending = { progress, legacy };
    if (runtime.rafHandle === null) {
      runtime.rafHandle = scheduleFrame(() => {
        runtime.rafHandle = null;
        const snapshot = runtime.pending;
        runtime.pending = null;
        if (snapshot) {
          this.writeStore(runtime.jobId, snapshot.progress, snapshot.legacy);
          this.mirrorAppStore(snapshot.progress);
        }
      });
    }
  }

  private cancelPendingFlush(runtime: JobRuntime): void {
    if (runtime.rafHandle !== null) {
      cancelFrame(runtime.rafHandle);
      runtime.rafHandle = null;
    }
    runtime.pending = null;
  }

  private writeStore(
    jobId: string,
    progress: ImportJobProgress,
    legacy: LegacyImportProgress,
  ): void {
    useImportStore.getState().upsertJobProgress(jobId, progress, legacy);
  }

  /** Mirror a coarse status + counts into the legacy app store. */
  private mirrorAppStore(progress: ImportJobProgress): void {
    const app = useAppStore.getState();
    app.setImportStatus(coarseAppStatus(progress.status));
    app.setImportProgress({
      current: progress.itemsProcessed,
      total: progress.itemsTotal ?? 0,
    });
  }

  // -----------------------------------------------------------------------
  // Terminal transitions
  // -----------------------------------------------------------------------

  private finishSuccess(runtime: JobRuntime, result: ImportJobResult): void {
    const entry = useImportStore.getState().jobs[runtime.jobId];
    const base = entry?.progress;
    const legacy = entry?.legacy ?? this.fallbackLegacy(runtime);
    const completed: ImportJobProgress = base
      ? {
          ...base,
          status: 'complete',
          activeStageId: null,
          etaMs: null,
          currentLabel: 'Import complete',
        }
      : this.terminalSnapshot(runtime, 'complete', 'Import complete');

    this.cancelPendingFlush(runtime);
    this.writeStore(runtime.jobId, completed, legacy);
    useImportStore.getState().setJobResult(runtime.jobId, result);
    this.mirrorAppStore(completed);
    // Mark data freshness so views refetch.
    useDataStore.getState().setLastImportAt(new Date().toISOString());
  }

  private finishFailure(runtime: JobRuntime, err: unknown): void {
    const cancelled = isImportAbortedError(err);
    const entry = useImportStore.getState().jobs[runtime.jobId];
    const base = entry?.progress;
    const legacy = entry?.legacy ?? this.fallbackLegacy(runtime);
    const status = cancelled ? 'cancelled' : 'error';
    const label = cancelled ? 'Import cancelled' : 'Import failed';

    const snapshot: ImportJobProgress = base
      ? { ...base, status, activeStageId: null, etaMs: null, currentLabel: label }
      : this.terminalSnapshot(runtime, status, label);

    this.cancelPendingFlush(runtime);
    this.writeStore(runtime.jobId, snapshot, legacy);
    if (!cancelled) {
      const message = err instanceof Error ? err.message : 'Import failed';
      useImportStore.getState().setJobError(runtime.jobId, message);
    }
    this.mirrorAppStore(snapshot);
  }

  /** Used by {@link cancel} when the job is already gone from `active`. */
  private flushTerminal(
    jobId: string,
    progress: ImportJobProgress,
    legacy: LegacyImportProgress,
  ): void {
    this.writeStore(jobId, progress, legacy);
    this.mirrorAppStore(progress);
  }

  // -----------------------------------------------------------------------
  // Snapshot seeding helpers
  // -----------------------------------------------------------------------

  private initJob(
    jobId: string,
    kind: 'cpap' | 'fitbit',
    startedAtMs: number,
    stages: StageProgress[],
  ): void {
    const progress: ImportJobProgress = {
      jobId,
      kind,
      status: 'scanning',
      stages,
      activeStageId: stages[0]?.id ?? null,
      startedAtMs,
      bytesProcessed: 0,
      bytesTotal: null,
      itemsProcessed: 0,
      itemsTotal: null,
      throughputPerSec: null,
      etaMs: null,
      errorCount: 0,
      warningCount: 0,
      recentErrors: [],
      currentLabel: 'Preparing import…',
    };
    const legacy: LegacyImportProgress =
      kind === 'cpap'
        ? { kind: 'cpap', progress: IDLE_CPAP_PROGRESS }
        : { kind: 'fitbit', progress: IDLE_FITBIT_PROGRESS };
    this.writeStore(jobId, progress, legacy);
    this.mirrorAppStore(progress);
  }

  private terminalSnapshot(
    runtime: JobRuntime,
    status: ImportJobProgress['status'],
    label: string,
  ): ImportJobProgress {
    return {
      jobId: runtime.jobId,
      kind: runtime.kind,
      status,
      stages: runtime.kind === 'cpap' ? this.cpapStages() : this.fitbitStages(),
      activeStageId: null,
      startedAtMs: runtime.lastSampleMs,
      bytesProcessed: 0,
      bytesTotal: null,
      itemsProcessed: runtime.lastItemsProcessed,
      itemsTotal: null,
      throughputPerSec: runtime.ewmaItemsPerSec,
      etaMs: null,
      errorCount: 0,
      warningCount: 0,
      recentErrors: [],
      currentLabel: label,
    };
  }

  private fallbackLegacy(runtime: JobRuntime): LegacyImportProgress {
    return runtime.kind === 'cpap'
      ? { kind: 'cpap', progress: IDLE_CPAP_PROGRESS }
      : { kind: 'fitbit', progress: IDLE_FITBIT_PROGRESS };
  }

  private cpapStages(): StageProgress[] {
    return [
      pendingStage('scan', 'Scanning files', 'files'),
      pendingStage('parse', 'Parsing files', 'files'),
      pendingStage('build', 'Building days', 'days'),
      pendingStage('store', 'Storing sessions', 'sessions'),
    ];
  }

  private fitbitStages(): StageProgress[] {
    return [
      pendingStage('scan', 'Scanning export', 'files'),
      pendingStage('import', 'Importing records', 'records'),
    ];
  }

  private findRuntime(jobId: string): JobRuntime | null {
    for (const runtime of this.active.values()) {
      if (runtime.jobId === jobId) return runtime;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure adaptation helpers (module-level, easily testable)
// ---------------------------------------------------------------------------

function pendingStage(id: string, label: string, unit: StageProgress['unit']): StageProgress {
  return { id, label, state: 'pending', determinate: false, completed: 0, total: null, unit };
}

/**
 * Fold one throughput sample into a running EWMA (items/sec). A sample is only
 * folded in when forward progress (`dItems > 0`) occurred over a measurable
 * interval (`dtMs >= 1`); otherwise the previous EWMA is returned unchanged.
 * Pure — exported for direct unit testing.
 */
export function updateThroughputEwma(
  prev: number | null,
  sample: { dItems: number; dtMs: number },
  alpha: number = THROUGHPUT_ALPHA,
): number | null {
  const { dItems, dtMs } = sample;
  if (dtMs < 1 || dItems <= 0) return prev;
  const instantaneous = (dItems / dtMs) * 1000;
  return prev === null ? instantaneous : alpha * instantaneous + (1 - alpha) * prev;
}

/**
 * Derive an ETA (ms) from a throughput rate and progress. Returns `null` when
 * the rate is unknown/non-positive or the total is unknown. Pure — exported for
 * direct unit testing.
 */
export function computeEtaMs(
  ratePerSec: number | null,
  itemsProcessed: number,
  itemsTotal: number | null,
): number | null {
  if (ratePerSec === null || ratePerSec <= 0 || itemsTotal === null) return null;
  const remaining = Math.max(0, itemsTotal - itemsProcessed);
  return Math.round((remaining / ratePerSec) * 1000);
}

function stageState(s: StageProgress['state']): StageProgress['state'] {
  return s;
}

function mapCpapStatus(s: ImportProgress['status']): ImportJobProgress['status'] {
  switch (s) {
    case 'idle':
      return 'idle';
    case 'scanning':
      return 'scanning';
    case 'parsing':
    case 'building':
    case 'storing':
      return 'running';
    case 'complete':
      return 'complete';
    case 'error':
      return 'error';
  }
}

function mapFitbitStatus(s: GoogleHealthImportProgress['status']): ImportJobProgress['status'] {
  switch (s) {
    case 'idle':
      return 'idle';
    case 'scanning':
      return 'scanning';
    case 'parsing':
    case 'storing':
      return 'running';
    case 'complete':
      return 'complete';
    case 'error':
      return 'error';
  }
}

function parseStageState(p: ImportProgress): StageProgress['state'] {
  if (p.status === 'scanning') return 'pending';
  if (p.status === 'parsing') return 'active';
  // Once we've moved past parsing, it is done (warning if files were skipped).
  return p.filesSkippedEmpty > 0 ? 'warning' : 'done';
}

/**
 * State for a CPAP phase keyed off the linear status order
 * scanning → parsing → building → storing → complete.
 */
function phaseState(
  status: ImportProgress['status'],
  phase: 'building' | 'storing',
  completed: number,
  total: number,
): StageProgress['state'] {
  const order: Record<ImportProgress['status'], number> = {
    idle: 0,
    scanning: 1,
    parsing: 2,
    building: 3,
    storing: 4,
    complete: 5,
    error: 5,
  };
  const phaseOrder = phase === 'building' ? 3 : 4;
  const current = order[status];
  if (current < phaseOrder) return 'pending';
  if (current === phaseOrder) return 'active';
  // Past this phase: a phase that never had any work (total 0) is skipped.
  if ((status === 'complete' || status === 'error') && total === 0) return 'skipped';
  void completed;
  return 'done';
}

function importStageState(status: ImportJobProgress['status']): StageProgress['state'] {
  switch (status) {
    case 'scanning':
    case 'idle':
      return 'pending';
    case 'running':
      return 'active';
    case 'complete':
      return 'done';
    case 'error':
      return 'error';
    case 'cancelled':
      return 'warning';
  }
}

/** Pick the active stage id for a job snapshot. */
function activeStage(stages: StageProgress[], status: ImportJobProgress['status']): string | null {
  if (status === 'complete' || status === 'error' || status === 'cancelled') return null;
  const active = stages.find((s) => s.state === 'active');
  return active?.id ?? null;
}

function capErrors(errors: readonly { fileName: string; error: string }[]): RecentImportError[] {
  const tail = errors.slice(-RECENT_ERRORS_CAP);
  return tail.map((e) => ({ fileName: e.fileName, error: e.error }));
}

function statusLabel(status: ImportJobProgress['status']): string {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'scanning':
      return 'Scanning…';
    case 'running':
      return 'Importing…';
    case 'complete':
      return 'Import complete';
    case 'error':
      return 'Import failed';
    case 'cancelled':
      return 'Import cancelled';
  }
}

function coarseAppStatus(
  status: ImportJobProgress['status'],
): 'idle' | 'scanning' | 'importing' | 'complete' | 'error' {
  switch (status) {
    case 'idle':
      return 'idle';
    case 'scanning':
      return 'scanning';
    case 'running':
      return 'importing';
    case 'complete':
      return 'complete';
    case 'error':
      return 'error';
    case 'cancelled':
      // No dedicated coarse state; treat as idle so the StatusBar clears.
      return 'idle';
  }
}

// ---------------------------------------------------------------------------
// Idle legacy snapshots (mirror the hooks' previous IDLE_PROGRESS constants)
// ---------------------------------------------------------------------------

const IDLE_CPAP_PROGRESS: ImportProgress = {
  status: 'idle',
  totalFiles: 0,
  filesProcessed: 0,
  currentFileName: '',
  bytesRead: 0,
  totalBytes: 0,
  sessionsCreated: 0,
  errors: [],
  startTime: 0,
  warnings: [],
  currentStage: '',
  dayGroupsProcessed: 0,
  totalDayGroups: 0,
  sessionsValidated: 0,
  sessionsStored: 0,
  totalSessionsToStore: 0,
  filesSkippedEmpty: 0,
};

const IDLE_FITBIT_PROGRESS: GoogleHealthImportProgress = {
  status: 'idle',
  currentDataType: '',
  dataTypesTotal: 0,
  dataTypesProcessed: 0,
  recordsProcessed: 0,
  recordsTotal: 0,
  recordsSkipped: 0,
  errors: [],
  warnings: [],
  startTime: 0,
  currentStage: '',
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** The one shared controller instance for the whole app (outside React). */
export const importController = new ImportController();
