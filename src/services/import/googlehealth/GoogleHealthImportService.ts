/**
 * Google Health import orchestrator service.
 *
 * Coordinates the full import pipeline for Google Takeout "Fitbit" exports:
 *   scan directory → resolve files → parse CSV/JSON → deduplicate → store.
 *
 * Framework-agnostic (no React). The IndexedDB dependency is injected via
 * the constructor for testability.
 *
 * ## Design notes
 * - Parsing runs on the main thread with periodic yields to the event loop.
 *   Google Health files are small CSVs/JSONs (not multi-MB EDF binaries), so
 *   Web Workers are unnecessary overhead for now.
 * - Records are processed per-data-type in tier order (core sleep & respiratory
 *   first) so the most important data is available soonest.
 * - Memory is managed by processing files in batches and releasing references
 *   between data types.
 * - Per-record and per-file errors are collected, not thrown. Only truly fatal
 *   errors (IndexedDB failure during batch write) propagate.
 * - Some parser functions return compound results (e.g. `parseSleepFiles`
 *   returns both daily sessions and sleep-stage timeseries). The orchestrator
 *   handles these by dispatching both result sets to the appropriate stores.
 *
 * @module services/import/googlehealth/GoogleHealthImportService
 */

import type { IndexedDBService } from '@/services/storage/IndexedDBService';
import { StorageError } from '@/services/storage/IndexedDBService';
import type {
  GoogleHealthScanResult,
  GoogleHealthDataTypeInfo,
  FitbitDailyType,
  FitbitTimeseriesType,
} from '@/types/fitbit';
import type {
  IntegrationDailySummary,
  IntegrationTimeseries,
  IntegrationImportRecord,
  IntegrationSource,
} from '@/types/storage';
import type { ImportError as StorageImportError } from '@/types/storage';
import * as Comlink from 'comlink';

import type { FitbitTimeseriesPayloadMap } from '@/types/fitbit';

import type { GoogleHealthImportProgress, ImportError } from '../types';
import { checkpoint, ImportAbortedError, isImportAbortedError } from '../types';
import { mergeTimeseriesPayload } from './mergeTimeseries';
import { importProfiler } from '../profiling/ImportProfiler';
import type { WorkerPool } from '@/services/workers/WorkerPool';
import type {
  FitbitParserWorkerAPI,
  FitbitWorkerDataType,
  FitbitWorkerFile,
  FitbitWorkerProgress,
} from '@/services/workers/fitbitParser.worker';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Number of records to store per IndexedDB batch transaction. */
const BATCH_SIZE = 100;

/** Yield to the event loop every Nth record to keep the UI responsive. */
const YIELD_EVERY = 50;

/** Integration source identifier for Fitbit data. */
const SOURCE: IntegrationSource = 'fitbit';

/**
 * Bounded look-ahead budget for the heavy-type parse↔store overlap (ADR 0030).
 *
 * The producer parses upcoming files ahead of the single-flight store, but never
 * more than this many files in flight (parsed-but-not-yet-stored + actively
 * parsing). Hiding a single store window only requires the NEXT file to be ready
 * when the current store finishes, so a tiny budget fully overlaps the idle
 * window while keeping peak heap close to #67's O(one file) bound. The producer
 * always admits at least the next file regardless of this cap, so an oversized
 * file still makes progress and the budget never deadlocks.
 */
const LOOKAHEAD_FILE_CAP = 2;

/**
 * Soft in-flight parsed-byte budget for the look-ahead (ADR 0030). A second,
 * size-aware brake so a run of large files cannot let {@link LOOKAHEAD_FILE_CAP}
 * files pin a large heap. Sized to a couple of full-resolution intraday day-files
 * (~a few MB of parsed records each). As with the file cap, the producer always
 * admits at least one in-flight file even if it alone exceeds this budget.
 */
const LOOKAHEAD_BYTE_BUDGET = 16 * 1024 * 1024;

/**
 * The heavy data types routed through the Fitbit parser worker pool (ADR 0027).
 * Everything else stays inline on the main thread (small CSVs/JSONs where worker
 * round-trip overhead would not pay for itself).
 */
const WORKER_PARSED_TYPES: ReadonlySet<string> = new Set<FitbitWorkerDataType>([
  'heart_rate_intraday',
  'spo2_intraday',
  'hrv_detail',
  'snoring_daily',
  'snoring_segments',
]);

/**
 * Factory that builds a {@link WorkerPool} for the Fitbit parser worker.
 *
 * Injected (like the EDF pool factory on {@link ImportService}) so tests can run
 * the equivalence path without spinning real Web Workers. When omitted, the
 * heavy parsers run inline via the SAME worker-safe cores, so output is
 * identical — only the threading differs.
 */
export type FitbitWorkerPoolFactory = () => WorkerPool<FitbitParserWorkerAPI>;

// ---------------------------------------------------------------------------
// Public option types
// ---------------------------------------------------------------------------

export interface GoogleHealthImportOptions {
  /** Which data types to import (from scan result). */
  readonly selectedDataTypes: readonly string[];
  /** Skip records that already exist for the same date+type. @default true */
  readonly skipDuplicates?: boolean;
  /** Progress callback. */
  readonly onProgress?: (progress: GoogleHealthImportProgress) => void;
  /**
   * When aborted, the import stops at the next per-record/per-batch
   * {@link checkpoint} boundary by throwing `ImportAbortedError`. Abort only
   * lands between already-committed batches, so stored data stays consistent.
   */
  readonly signal?: AbortSignal;
}

/**
 * Parsed record ready for storage.
 *
 * Matches the `ParsedRecord<T>` shape exported by `parsers.ts`.
 */
export interface ParsedDailyRecord {
  readonly date: string;
  readonly data: unknown;
}

export interface ParsedTimeseriesRecord {
  readonly date: string;
  readonly data: unknown;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class GoogleHealthImportService {
  /**
   * @param db                 IndexedDB service (injected for testability).
   * @param workerPoolFactory  Optional factory for the Fitbit parser worker pool
   *   (ADR 0027). When provided, the heavy intraday/snoring parsers run on the
   *   pool; otherwise they run inline via the same worker-safe cores (tests).
   */
  constructor(
    private readonly db: IndexedDBService,
    private readonly workerPoolFactory?: FitbitWorkerPoolFactory,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Scan a directory to discover available Google Health data.
   *
   * Fast -- reads filenames only, not content. Delegates to the scanner module.
   */
  async scan(dirHandle: FileSystemDirectoryHandle): Promise<GoogleHealthScanResult> {
    // Lazy-import the scanner so the module graph stays clean when only the
    // orchestrator types are needed.
    const { scanGoogleHealthExport } = await import('./scanner');
    return scanGoogleHealthExport(dirHandle);
  }

  /**
   * Import selected data types from a previously scanned directory.
   *
   * Returns an import record summarizing what was imported.
   */
  async import(
    dirHandle: FileSystemDirectoryHandle,
    scanResult: GoogleHealthScanResult,
    options: GoogleHealthImportOptions,
  ): Promise<IntegrationImportRecord> {
    const skipDuplicates = options.skipDuplicates ?? true;
    const signal = options.signal;
    const startTime = Date.now();

    // Gated, default-OFF profiling. `begin()` reads the live global switch; when
    // off, every subsequent profiler call is a cheap no-op (see ImportProfiler).
    // No PHI is recorded — only per-data-type timings and file/record counts.
    importProfiler.begin('fitbit');

    // Resolve selected data types from the scan result, sorted by tier priority.
    const selectedInfos = scanResult.dataTypes
      .filter((dt) => options.selectedDataTypes.includes(dt.dataType))
      .slice()
      .sort((a, b) => a.tier - b.tier);

    const totalRecords = selectedInfos.reduce((sum, dt) => sum + dt.recordCount, 0);

    // Mutable progress state.
    const progress: GoogleHealthImportProgress = {
      status: 'parsing',
      currentDataType: '',
      dataTypesTotal: selectedInfos.length,
      dataTypesProcessed: 0,
      recordsProcessed: 0,
      recordsTotal: totalRecords,
      recordsSkipped: 0,
      errors: [],
      warnings: [],
      startTime,
      currentStage: 'Preparing import...',
    };

    const emit = (patch: Partial<GoogleHealthImportProgress>): void => {
      Object.assign(progress, patch);
      options.onProgress?.({ ...progress });
    };

    emit({ status: 'parsing' });

    // Resolve the actual export root (the scanner does the same thing
    // internally during scan, but the import method receives the original
    // user-selected handle which may be a parent of the real root).
    const { resolveRoot } = await import('./scanner');
    const root = await resolveRoot(dirHandle);
    if (!root) {
      const importRecord: IntegrationImportRecord = {
        id: crypto.randomUUID(),
        source: SOURCE,
        importedAt: new Date().toISOString(),
        dateRangeStart: scanResult.dateRange?.start ?? '',
        dateRangeEnd: scanResult.dateRange?.end ?? '',
        dataTypes: options.selectedDataTypes,
        recordsImported: 0,
        recordsSkipped: 0,
        recordsErrored: 1,
        errors: [
          {
            fileName: '',
            error: 'Could not locate Google Health export root',
            timestamp: new Date().toISOString(),
          },
        ],
        durationSeconds: Math.round(((Date.now() - startTime) / 1000) * 100) / 100,
        fileHashes: [],
      };
      try {
        await this.db.addIntegrationImportRecord(importRecord);
      } catch {
        // Best-effort: if we can't even record the failure, still return.
      }
      emit({
        status: 'error',
        errors: [
          {
            fileName: '',
            error: 'Could not locate Google Health export root',
            recoverable: false,
          },
        ],
        currentStage: 'Import failed',
      });
      // Finalize the gated profiler so it does not stay enabled across imports
      // (and any pool-occupancy interval is cleared). No-op when disabled.
      importProfiler.finish();
      return importRecord;
    }

    // Best-effort: capture the account's IANA timezone from `Profile.csv` as the
    // DST-aware FALLBACK zone for the UTC-sourced wearable lanes (heart rate /
    // SpO2) on dates the CPAP-overlap estimator cannot resolve. Derived location
    // metadata: stored LOCALLY only (IndexedDB `settings`), never transmitted,
    // and wiped by `clearAllUserData`'s whole-database destroy. A missing,
    // malformed, or unreadable Profile.csv never affects the import.
    await this.persistProfileTimeZone(root);

    // Lazy-import the parsers module.
    const parsers = await import('./parsers');

    // Accumulators for the import record.
    const errors: ImportError[] = [];
    const warnings: string[] = [];
    let totalImported = 0;
    let totalSkipped = 0;
    const fileHashes: string[] = [];

    // Track the date range across all processed records.
    const dateRange = { earliest: '', latest: '' };
    const trackDate = (date: string): void => {
      if (!date) return;
      if (dateRange.earliest === '' || date < dateRange.earliest) {
        dateRange.earliest = date;
      }
      if (dateRange.latest === '' || date > dateRange.latest) {
        dateRange.latest = date;
      }
    };

    // -----------------------------------------------------------------------
    // Process each selected data type
    // -----------------------------------------------------------------------

    // The Fitbit parser worker pool is created lazily on first heavy data type
    // and shut down once the whole import finishes (or aborts). When no factory
    // was injected (tests) it stays null and the heavy parsers run inline.
    let pool: WorkerPool<FitbitParserWorkerAPI> | null = null;

    try {
      for (let i = 0; i < selectedInfos.length; i++) {
        const dtInfo = selectedInfos[i];
        if (!dtInfo) continue;

        // Loop-boundary checkpoint: abort lands between fully-processed data
        // types, before this type's files are read/parsed/stored.
        await checkpoint(signal);

        emit({
          status: 'parsing',
          currentDataType: dtInfo.dataType,
          currentDataTypeLabel: dtInfo.label,
          currentDataTypePhase: 'parsing',
          currentDataTypeRecordsProcessed: 0,
          currentDataTypeRecordsTotal: 0,
          currentStage: `Processing ${dtInfo.label} (${String(i + 1)}/${String(selectedInfos.length)})`,
          dataTypesProcessed: i,
        });

        try {
          // 1. Read File objects from directory handle.
          const files = await this.readFilesForDataType(root, dtInfo, errors);
          if (files.length === 0) {
            warnings.push(`No readable files found for ${dtInfo.label}`);
            continue;
          }

          // Compute a simple hash of file names + sizes for the import record.
          for (const file of files) {
            fileHashes.push(await this.computeStringHash(`${file.name}:${String(file.size)}`));
          }

          // 2. Parse + store. Heavy types go through the worker pool, which
          //    INTERLEAVES storage with parsing: each file's records are stored
          //    and released before the next file is parsed, so peak heap stays
          //    ~O(one file) regardless of how many files/years the type spans.
          //    Light types parse fully inline (trivially small) then store.
          if (WORKER_PARSED_TYPES.has(dtInfo.dataType) && this.workerPoolFactory) {
            if (!pool) {
              pool = this.workerPoolFactory();
              // Gated occupancy sampling: when profiling is on, poll the pool's
              // busy/size so the profile can show whether the worker idles during
              // the store window. No-op when profiling is off.
              const p = pool;
              importProfiler.attachPoolSnapshot(() => ({
                busy: p.busyWorkerCount,
                size: p.maxPoolSize,
              }));
            }
            const outcome = await this.parseAndStoreDataTypeViaWorker(
              pool,
              dtInfo.dataType as FitbitWorkerDataType,
              files,
              skipDuplicates,
              errors,
              progress,
              emit,
              trackDate,
              (parsed, total) => {
                emit({
                  status: 'parsing',
                  currentDataTypePhase: 'parsing',
                  currentDataTypeRecordsProcessed: parsed,
                  currentDataTypeRecordsTotal: total,
                });
              },
              signal,
            );
            totalImported += outcome.stored;
            totalSkipped += outcome.skipped;
          } else {
            const { daily, timeseries } = await this.parseDataType(
              parsers,
              dtInfo.dataType,
              files,
              errors,
            );

            // 3. Store daily records.
            if (daily.length > 0) {
              const dailyDataType = dtInfo.dataType as FitbitDailyType;
              const outcome = await this.processDailyRecords(
                daily,
                dailyDataType,
                skipDuplicates,
                errors,
                (processed, skipped) => {
                  emit({
                    status: 'storing',
                    currentDataTypePhase: 'storing',
                    recordsProcessed: progress.recordsProcessed + processed,
                    recordsSkipped: progress.recordsSkipped + skipped,
                  });
                },
                signal,
              );
              totalImported += outcome.stored;
              totalSkipped += outcome.skipped;

              for (const rec of daily) {
                trackDate(rec.date);
              }
            }

            // 4. Store timeseries records.
            if (timeseries.length > 0) {
              const tsDataType = dtInfo.dataType as FitbitTimeseriesType;
              const outcome = await this.processTimeseriesRecords(
                timeseries,
                tsDataType,
                skipDuplicates,
                errors,
                (processed, skipped) => {
                  emit({
                    status: 'storing',
                    currentDataTypePhase: 'storing',
                    recordsProcessed: progress.recordsProcessed + processed,
                    recordsSkipped: progress.recordsSkipped + skipped,
                  });
                },
                signal,
              );
              totalImported += outcome.stored;
              totalSkipped += outcome.skipped;

              for (const rec of timeseries) {
                trackDate(rec.date);
              }
            }
          }
        } catch (err) {
          // Cancellation must NOT be swallowed as a per-type error — rethrow so
          // it unwinds the whole import. (Checked by name to be robust across
          // realms.)
          if (err instanceof Error && err.name === 'ImportAbortedError') {
            throw err;
          }
          // A structured-clone/serialisation failure is a programming bug, not a
          // recoverable data problem. Let it unwind the whole import as a hard
          // failure rather than collecting it as a per-type error and pressing on
          // (which would report success having stored nothing).
          if (isCloneFailure(err)) {
            throw err;
          }
          // Per-data-type failure. Collect and continue with next type.
          errors.push({
            fileName: dtInfo.dataType,
            error: `Failed to process ${dtInfo.label}: ${err instanceof Error ? err.message : String(err)}`,
            recoverable: true,
          });
        }

        emit({ dataTypesProcessed: i + 1 });

        // Checkpoint between data types: abort lands here, between fully-stored
        // types.
        await checkpoint(signal);
      }
    } finally {
      // Finalize the gated profiler inside the finally so its pool-occupancy
      // sampling interval is always cleared — including when the loop throws
      // (e.g. on abort), which would otherwise skip a finish() placed after the
      // try and leak the interval until the next import (mirrors ADR 0029's fix
      // on the CPAP path). No-op when profiling is off.
      importProfiler.finish();
      // Release the worker pool (if one was created) regardless of how the loop
      // exits — normal completion, per-type error, or abort.
      if (pool) {
        void pool.shutdown();
      }
    }

    // -----------------------------------------------------------------------
    // Build and store import record
    // -----------------------------------------------------------------------

    const importRecord: IntegrationImportRecord = {
      id: crypto.randomUUID(),
      source: SOURCE,
      importedAt: new Date().toISOString(),
      dateRangeStart: dateRange.earliest || (scanResult.dateRange?.start ?? ''),
      dateRangeEnd: dateRange.latest || (scanResult.dateRange?.end ?? ''),
      dataTypes: options.selectedDataTypes,
      recordsImported: totalImported,
      recordsSkipped: totalSkipped,
      recordsErrored: errors.length,
      errors: errors.map(
        (e): StorageImportError => ({
          fileName: e.fileName,
          error: e.error,
          timestamp: new Date().toISOString(),
        }),
      ),
      durationSeconds: Math.round(((Date.now() - startTime) / 1000) * 100) / 100,
      fileHashes,
    };

    try {
      await this.db.addIntegrationImportRecord(importRecord);
    } catch (err) {
      // Fatal: we cannot record the import. Add to warnings but still return.
      warnings.push(
        `Failed to store import record: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    emit({
      status: errors.length > 0 && totalImported === 0 ? 'error' : 'complete',
      errors: [...errors],
      warnings: [...warnings],
      currentStage: 'Import complete',
      dataTypesProcessed: selectedInfos.length,
      recordsProcessed: totalImported + totalSkipped,
    });

    return importRecord;
  }

  // -----------------------------------------------------------------------
  // File reading
  // -----------------------------------------------------------------------

  /**
   * Read all File objects for a given data type from the directory handle.
   *
   * Uses the file paths listed in the scan result's data type info.
   */
  private async readFilesForDataType(
    dirHandle: FileSystemDirectoryHandle,
    dataTypeInfo: GoogleHealthDataTypeInfo,
    errors: ImportError[],
  ): Promise<File[]> {
    const files: File[] = [];

    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB per file

    for (const filePath of dataTypeInfo.files) {
      try {
        const file = await this.getFileFromPath(dirHandle, filePath);
        if (file) {
          if (file.size > MAX_FILE_SIZE) {
            errors.push({
              fileName: filePath,
              error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max ${MAX_FILE_SIZE / 1024 / 1024} MB)`,
              recoverable: true,
            });
            continue;
          }
          files.push(file);
        }
      } catch (err) {
        errors.push({
          fileName: filePath,
          error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
          recoverable: true,
        });
      }
    }

    return files;
  }

  /**
   * Resolve a file from a directory handle given a relative path.
   *
   * Walks the path segments to reach the target file. Returns null if
   * any segment is not found (directory or file).
   */
  private async getFileFromPath(
    root: FileSystemDirectoryHandle,
    relativePath: string,
  ): Promise<File | null> {
    const segments = relativePath.split('/').filter((s) => s.length > 0 && s !== '.' && s !== '..');
    if (segments.length === 0) return null;

    const fileName = segments[segments.length - 1];
    if (!fileName) return null;
    const dirSegments = segments.slice(0, -1);

    let current: FileSystemDirectoryHandle = root;
    for (const seg of dirSegments) {
      const sub = await this.getSubdirectory(current, seg);
      if (!sub) return null;
      current = sub;
    }

    try {
      const fileHandle = await current.getFileHandle(fileName);
      return await fileHandle.getFile();
    } catch {
      return null;
    }
  }

  /** Read a subdirectory by name. Returns null if not found. */
  private async getSubdirectory(
    root: FileSystemDirectoryHandle,
    name: string,
  ): Promise<FileSystemDirectoryHandle | null> {
    try {
      return await root.getDirectoryHandle(name);
    } catch {
      return null;
    }
  }

  /**
   * Parse `Profile.csv`'s IANA timezone and persist it as the source's fallback
   * zone (IndexedDB `settings`). Purely best-effort: any failure — no Profile.csv,
   * an unreadable file, a missing/invalid `timezone` column, or a storage error —
   * is swallowed so the import proceeds unaffected. Only a valid, resolvable zone
   * is written; when absent, any previously-stored zone is left untouched.
   */
  private async persistProfileTimeZone(root: FileSystemDirectoryHandle): Promise<void> {
    try {
      const { findProfileCsvFile, parseProfileTimeZone, profileTimeZoneSettingKey } =
        await import('./profile');
      const file = await findProfileCsvFile(root);
      if (!file) return;
      const zone = parseProfileTimeZone(await file.text());
      if (zone === null) return;
      await this.db.putSetting(profileTimeZoneSettingKey(SOURCE), zone);
    } catch {
      // Non-fatal: the Profile-zone fallback is an optional refinement, never a
      // reason to fail or degrade the import.
    }
  }

  // -----------------------------------------------------------------------
  // Worker-pool parser dispatch (ADR 0027)
  // -----------------------------------------------------------------------

  /**
   * Parse AND store a heavy data type on the Fitbit parser worker pool, using a
   * BOUNDED LOOK-AHEAD overlap of parse and store (ADR 0030).
   *
   * A PRODUCER parses upcoming files eagerly in the worker pool, so that the
   * parse of file _N+1_ (and a small bounded look-ahead beyond it) overlaps the
   * store of file _N_. A single-flight CONSUMER then, in strict file order,
   * stores each file's records and releases them. Only the read-only parse stage
   * is pipelined; the store stage stays single-flight, so this reclaims the
   * ~100%-idle worker window the profiler measured during the store tail without
   * relaxing correctness.
   *
   * Each file's `ArrayBuffer` is TRANSFERRED into the worker (neutered on this
   * thread so the structured-clone copy is avoided and main-thread memory is
   * released), parsed off-thread, and its `ParsedRecord[]` returned. The consumer
   * stores the returned records (daily + timeseries) and drops them before the
   * budget admits more parses, so peak accumulated-results heap stays bounded to
   * the small look-ahead — O(look-ahead), a modest refinement of #67's O(one
   * file), NOT the pre-#67 "hold everything" problem.
   *
   * Equivalence with the strict serial (#67) parse→store path — the persisted
   * output is byte-for-byte identical:
   * - **Stored output** is identical: the same records are wrapped and written;
   *   when parsing starts does not change record contents.
   * - **Store is strictly single-flight, in file order.** File _N_ is fully
   *   stored (committed) before file _N+1_ is stored. Dedup is keyed on
   *   `(source, dataType, date)` via {@link IndexedDBService} lookups, so a
   *   within-import cross-file duplicate finds file _N_'s already-committed
   *   record and is skipped EXACTLY ONCE — exactly as in the serial loop. No
   *   in-memory dedup set spans files, so nothing per-file can desynchronise it.
   * - **Progress counters** stay monotonic: the running base in `progress`
   *   (`recordsProcessed`/`recordsSkipped`) is advanced by each file's outcome
   *   AFTER that file is stored, in store order, so totals never go backwards or
   *   double-count even though parsing runs ahead.
   * - **trackDate** is called for every stored record's date (both halves), so
   *   the import's date-range summary is unchanged.
   *
   * The job `signal` is forwarded to {@link WorkerPool.submit} so a cancelled
   * job's still-queued AND in-flight look-ahead parse tasks are dropped
   * immediately. `checkpoint(signal)` still lands BETWEEN files in the consumer,
   * so an abort leaves the database consistent (already-stored files complete, no
   * half-stored file); a cancel mid-type leaves the already-committed prefix
   * durable, consistent with the idempotent per-day dedup model.
   *
   * @param onParseProgress Receives `(recordsProcessedSoFar, recordsTotal)`
   *   across the whole data type, emitted in STORE order so it stays monotonic.
   * @returns Aggregate `{ stored, skipped }` across all files of the type.
   */
  private async parseAndStoreDataTypeViaWorker(
    pool: WorkerPool<FitbitParserWorkerAPI>,
    dataType: FitbitWorkerDataType,
    files: File[],
    skipDuplicates: boolean,
    errors: ImportError[],
    progress: GoogleHealthImportProgress,
    emit: (patch: Partial<GoogleHealthImportProgress>) => void,
    trackDate: (date: string) => void,
    onParseProgress: (recordsProcessed: number, recordsTotal: number) => void,
    signal?: AbortSignal,
  ): Promise<{ stored: number; skipped: number }> {
    let totalStored = 0;
    let totalSkipped = 0;

    // Records fully parsed in files completed (stored) BEFORE the current one.
    // Advanced in STORE order so the across-type parse counter stays monotonic.
    let baseProcessed = 0;

    // Explicit, deterministic store-progress base for THIS type. Seeded from the
    // cross-type running totals so progress keeps accumulating across data types,
    // and advanced by each file's stored/skipped outcome AFTER it is stored. The
    // per-file store callbacks render `baseStored + processed` /
    // `baseSkipped + skipped`, so counters stay monotonic and end at the same
    // totals as the strict-serial path.
    let baseStored = progress.recordsProcessed;
    let baseSkipped = progress.recordsSkipped;

    // --- Profiling accumulators (no-ops fold to zero when disabled) ----------
    const profiling = importProfiler.isEnabled();
    let parseMsTotal = 0;
    let storeMsTotal = 0;
    // Wall time spent storing while NO parse was in flight in the pool — the
    // reclaimable idle the overlap targets. With look-ahead working this should
    // trend toward zero (the producer keeps a parse running through the store).
    let parseIdleDuringStoreMs = 0;
    /** Files whose parse is queued/in flight in the pool right now. */
    let inFlightParses = 0;

    // --- Bounded look-ahead state -------------------------------------------
    // Per-file parse outcome. The consumer awaits these slots in file order.
    interface ParsedSlot {
      readonly index: number;
      readonly fileName: string;
      readonly daily: ParsedDailyRecord[];
      readonly timeseries: ParsedTimeseriesRecord[];
      /** This file's exact entry count (for the monotonic parse counter). */
      readonly fileTotal: number;
      /** Approx parsed-record bytes, for the in-flight byte budget. */
      readonly approxBytes: number;
      /** A genuine (recoverable) per-file parse error, if any. */
      readonly parseError?: unknown;
    }

    // Pre-allocate ONE deferred promise per file up front, so the consumer can
    // always `await slots[i]` even before the producer has reached file i (e.g.
    // while the producer is blocked on the admission gate). This removes the
    // producer/consumer race entirely: the consumer never sees an "empty" slot
    // and so never skips a file or wedges — it simply waits for the producer to
    // settle that slot. Each resolver is called EXACTLY ONCE (parse result,
    // parse/read error carried on the slot, or an abort marker on unwind).
    const slots: Array<Promise<ParsedSlot> | undefined> = new Array(files.length);
    const slotResolvers: Array<((s: ParsedSlot) => void) | undefined> = new Array(files.length);
    for (let i = 0; i < files.length; i++) {
      slots[i] = new Promise<ParsedSlot>((resolve) => {
        slotResolvers[i] = resolve;
      });
    }
    /** Approx in-flight parsed bytes (admitted-but-not-yet-released). */
    let inFlightBytes = 0;
    /** Files admitted (parse started) but not yet released by the consumer. */
    let inFlightFiles = 0;
    /** Charged byte estimate per slot, reconciled on parse resolution / release. */
    const chargedBytes: number[] = new Array(files.length).fill(0);
    /**
     * Whether slot `i` was actually ADMITTED into flight (the producer ran
     * `inFlightFiles += 1` for it). False for slots resolved WITHOUT admission —
     * missing-file, read-error, and abort/teardown-marker slots. The consumer
     * only releases an admitted slot, so the in-flight counters stay exact rather
     * than relying on clamping.
     */
    const admitted: boolean[] = new Array(files.length).fill(false);

    // A tiny EDGE-SAFE notifier the producer awaits when the budget is full; the
    // consumer (and parse resolutions) ping it after freeing budget so the
    // producer can admit the next file. `pendingSignal` absorbs a signal that
    // races AHEAD of the producer reaching its `await`, so a wakeup is never
    // lost (the classic lost-wakeup deadlock when the consumer signals before the
    // producer registers its waiter).
    let wakeProducer: (() => void) | null = null;
    let pendingSignal = false;
    const waitForSlot = (): Promise<void> => {
      // Consume a signal that already fired since the last wait — return at once.
      if (pendingSignal) {
        pendingSignal = false;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        wakeProducer = resolve;
      });
    };
    const signalSlot = (): void => {
      const w = wakeProducer;
      if (w) {
        wakeProducer = null;
        w();
      } else {
        // No waiter registered yet — remember the signal so the next wait sees it.
        pendingSignal = true;
      }
    };

    let producerError: unknown;
    let producerAborted = false;
    // Set by the consumer's `finally` on ANY exit (normal, abort, or a non-abort
    // throw such as the clone-failure hard-fail). The producer's admission gate
    // tests this so a woken producer ALWAYS makes progress and returns, even when
    // the consumer abandoned the loop without draining/releasing the remaining
    // look-ahead files (which would otherwise leave the gate predicate saturated
    // forever — the B1 deadlock). It is a teardown signal, NOT an abort: it never
    // masks the consumer's original error.
    let consumerDone = false;

    // Resolve a pre-allocated slot exactly once (defensive against double-calls).
    const resolveSlot = (idx: number, s: ParsedSlot): void => {
      const r = slotResolvers[idx];
      if (r) {
        slotResolvers[idx] = undefined;
        r(s);
      }
    };
    const abortMarker = (idx: number, fileName: string): ParsedSlot => ({
      index: idx,
      fileName,
      daily: [],
      timeseries: [],
      fileTotal: 0,
      approxBytes: 0,
      parseError: new ImportAbortedError(),
    });

    // --- Producer: parse upcoming files ahead of the store, bounded ----------
    const producer = (async (): Promise<void> => {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) {
          // Resolve the slot for a missing file so the consumer never wedges.
          resolveSlot(i, {
            index: i,
            fileName: '',
            daily: [],
            timeseries: [],
            fileTotal: 0,
            approxBytes: 0,
          });
          continue;
        }

        // Admission gate: wait while the look-ahead budget is full, BUT always
        // admit at least the next file (when nothing is in flight) so an
        // oversized file never deadlocks the budget. The gate ALSO breaks on
        // abort OR consumer teardown so a woken producer can never re-park on a
        // still-saturated predicate after the consumer has abandoned the loop.
        while (
          inFlightFiles > 0 &&
          (inFlightFiles >= LOOKAHEAD_FILE_CAP || inFlightBytes >= LOOKAHEAD_BYTE_BUDGET) &&
          !signal?.aborted &&
          !consumerDone
        ) {
          await waitForSlot();
        }
        if (signal?.aborted || consumerDone) {
          // Abort or consumer teardown: resolve this and all remaining slots with
          // a marker so the consumer (if still iterating) unwinds promptly, and
          // stop admitting so `await producer` resolves. `producerAborted` is set
          // only for a genuine signal abort; teardown after a non-abort throw is
          // NOT an abort — the consumer's original error still propagates.
          if (signal?.aborted) producerAborted = true;
          for (let j = i; j < files.length; j++) {
            resolveSlot(j, abortMarker(j, files[j]?.name ?? ''));
          }
          return;
        }

        let buffer: ArrayBuffer;
        try {
          buffer = await file.arrayBuffer();
        } catch (err) {
          // A read failure is a recoverable per-file error; surface it on the
          // slot so the consumer records it in file order and continues.
          resolveSlot(i, {
            index: i,
            fileName: file.name,
            daily: [],
            timeseries: [],
            fileTotal: 0,
            approxBytes: 0,
            parseError: new FileReadError(
              `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
            ),
          });
          continue;
        }

        // Charge this file's source size up front so the NEXT iteration's gate
        // sees the admission immediately; reconciled to parsed bytes on resolve.
        const estBytes = buffer.byteLength;
        chargedBytes[i] = estBytes;
        inFlightBytes += estBytes;
        inFlightFiles += 1;
        admitted[i] = true;

        // TRANSFER the bytes into the worker (neutered here): the clone is
        // avoided and this thread's reference to the source buffer is released.
        const workerFile = Comlink.transfer<FitbitWorkerFile>({ name: file.name, buffer }, [
          buffer,
        ]);

        // Determinate within-file progress proxied back from the worker. This
        // fires DURING parse; the across-type counter it renders is bounded by
        // `baseProcessed` (advanced in store order) so it can never run ahead of
        // committed progress — staying monotonic with the consumer's emissions.
        let fileTotal = 0;
        const onProgress = (p: FitbitWorkerProgress): void => {
          fileTotal = Math.max(fileTotal, p.samplesTotal, p.samplesProcessed);
          onParseProgress(baseProcessed + p.samplesProcessed, baseProcessed + fileTotal);
        };

        const t0 = profiling ? Date.now() : 0;
        if (profiling) inFlightParses += 1;
        // Fire the parse and resolve this file's slot when it settles. We do NOT
        // await it here — that is the whole point of the look-ahead: the loop
        // continues to admit the next file (subject to the gate) while this parse
        // runs in the pool.
        void pool
          .submit(
            (proxy) => proxy.parseDataType(dataType, [workerFile], Comlink.proxy(onProgress)),
            {
              signal,
            },
          )
          .then((result) => {
            if (profiling) {
              inFlightParses -= 1;
              parseMsTotal += Date.now() - t0;
            }
            // Copy out of the Comlink result so the proxied object is released.
            const daily = result.daily.map((rec) => ({ date: rec.date, data: rec.data }));
            const timeseries = result.timeseries.map((rec) => ({ date: rec.date, data: rec.data }));
            const approxBytes = approxParsedBytes(daily) + approxParsedBytes(timeseries);
            // Reconcile the up-front estimate to the actual parsed-record bytes.
            inFlightBytes += approxBytes - (chargedBytes[i] ?? 0);
            chargedBytes[i] = approxBytes;
            // A newly-resolved parse may have freed byte budget; let the producer
            // re-evaluate admission.
            signalSlot();
            resolveSlot(i, {
              index: i,
              fileName: file.name,
              daily,
              timeseries,
              fileTotal,
              approxBytes,
            });
          })
          .catch((err: unknown) => {
            if (profiling) {
              inFlightParses -= 1;
              parseMsTotal += Date.now() - t0;
            }
            // Drop this file's byte charge so a failed parse cannot pin the
            // budget; the consumer reconciles `inFlightFiles` on release.
            inFlightBytes -= chargedBytes[i] ?? 0;
            chargedBytes[i] = 0;
            if (inFlightBytes < 0) inFlightBytes = 0;
            signalSlot();
            // Carry the rejection on the slot; the consumer classifies it in
            // file order (abort / clone-failure / recoverable parse error).
            resolveSlot(i, {
              index: i,
              fileName: file.name,
              daily: [],
              timeseries: [],
              fileTotal: 0,
              approxBytes: 0,
              parseError: err,
            });
          });
      }
    })().catch((err: unknown) => {
      producerError = err;
      // A producer-level fault must not leave the consumer waiting on unsettled
      // slots. Resolve any still-pending slots with an abort marker so the
      // consumer unwinds; the fault is surfaced after the consumer loop.
      for (let j = 0; j < files.length; j++) {
        resolveSlot(j, abortMarker(j, files[j]?.name ?? ''));
      }
    });

    // --- Consumer: single-flight store, strictly in file order ---------------
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) continue;

        // Abort lands BETWEEN files, before this file's store begins — never
        // mid-write. The previous file's store is fully committed.
        await checkpoint(signal);

        // Every slot is pre-allocated, so this always resolves: with the parsed
        // result, a per-file error carried on the slot, or an abort marker the
        // producer set when unwinding. The consumer never races an empty slot.
        const slotPromise = slots[i];
        // Defensive: a pre-allocated slot is always present here.
        if (!slotPromise) continue;
        const parsed = await slotPromise;

        // Account for this file leaving flight, then wake the producer so it can
        // admit the next look-ahead file in place of this one. Only an ADMITTED
        // slot ever charged the in-flight counters, so only it releases them;
        // missing-file / read-error / abort-marker slots are no-ops here.
        const releaseSlot = (): void => {
          if (admitted[i]) {
            admitted[i] = false;
            inFlightFiles -= 1;
            inFlightBytes -= chargedBytes[i] ?? 0;
            if (inFlightFiles < 0) inFlightFiles = 0;
            if (inFlightBytes < 0) inFlightBytes = 0;
          }
          chargedBytes[i] = 0;
          signalSlot();
        };

        if (parsed.parseError !== undefined) {
          const err = parsed.parseError;
          releaseSlot();
          // A mid-flight abort surfaces as our ImportAbortedError or the pool's
          // TASK_ABORTED/POOL_SHUTDOWN; either unwinds the whole import.
          if (isImportAbortedError(err) || isPoolAbort(err) || signal?.aborted) {
            throw new ImportAbortedError();
          }
          // A structured-clone/serialisation failure is a PROGRAMMING bug, not
          // bad input — hard-fail rather than silently importing zero records.
          if (isCloneFailure(err)) {
            throw err;
          }
          // Genuine recoverable per-file parse (or read) error: record and
          // continue to the next file in order — exactly as the serial path did.
          errors.push({
            fileName: parsed.fileName,
            error:
              err instanceof FileReadError
                ? err.message
                : `Parser error: ${err instanceof Error ? err.message : String(err)}`,
            recoverable: true,
          });
          continue;
        }

        const { daily, timeseries, fileTotal } = parsed;

        // Advance the parse counter for this completed file (store order).
        baseProcessed += fileTotal;
        onParseProgress(baseProcessed, baseProcessed);

        // Was the pool idle (no parse in flight) as this store began? If so, the
        // store window is reclaimable-idle time the overlap is meant to hide.
        const storeT0 = profiling ? Date.now() : 0;
        const idleAtStoreStart = profiling && inFlightParses === 0;

        // Store THIS file's records (daily then timeseries), single-flight.
        if (daily.length > 0) {
          const dailyDataType = dataType as FitbitDailyType;
          const outcome = await this.processDailyRecords(
            daily,
            dailyDataType,
            skipDuplicates,
            errors,
            (processed, skipped) => {
              emit({
                status: 'storing',
                currentDataTypePhase: 'storing',
                recordsProcessed: baseStored + processed,
                recordsSkipped: baseSkipped + skipped,
              });
            },
            signal,
          );
          totalStored += outcome.stored;
          totalSkipped += outcome.skipped;
          baseStored += outcome.stored;
          baseSkipped += outcome.skipped;
          for (const rec of daily) {
            trackDate(rec.date);
          }
        }

        if (timeseries.length > 0) {
          const tsDataType = dataType as FitbitTimeseriesType;
          const outcome = await this.processTimeseriesRecords(
            timeseries,
            tsDataType,
            skipDuplicates,
            errors,
            (processed, skipped) => {
              emit({
                status: 'storing',
                currentDataTypePhase: 'storing',
                recordsProcessed: baseStored + processed,
                recordsSkipped: baseSkipped + skipped,
              });
            },
            signal,
          );
          totalStored += outcome.stored;
          totalSkipped += outcome.skipped;
          baseStored += outcome.stored;
          baseSkipped += outcome.skipped;
          for (const rec of timeseries) {
            trackDate(rec.date);
          }
        }

        if (profiling) {
          const storeMs = Date.now() - storeT0;
          storeMsTotal += storeMs;
          // Attribute the store window to parse-idle only if the pool started it
          // idle AND remained idle throughout (no producer parse covered it).
          if (idleAtStoreStart && inFlightParses === 0) {
            parseIdleDuringStoreMs += storeMs;
          }
        }

        // Release this file's parsed records + budget charge so the producer can
        // admit the next look-ahead file. Dropping the slot drops the only
        // references to these records, so peak heap stays O(look-ahead).
        slots[i] = undefined;
        releaseSlot();
      }
    } finally {
      // Signal teardown BEFORE waking/draining the producer so a parked producer,
      // once woken, sees `consumerDone`, breaks its admission gate, resolves any
      // remaining slots, and returns — guaranteeing `await producer` resolves on
      // ANY consumer exit, including a non-abort throw (e.g. the clone-failure
      // hard-fail) while the gate was saturated. This is the B1 deadlock fix.
      consumerDone = true;
      signalSlot();
      // Drain the producer so its in-flight parse promises settle and any
      // already-started look-ahead slots we never consumed are not left as
      // unhandled rejections. Producer-level faults are captured in producerError.
      await producer;
      // Settle any unconsumed slots (e.g. after an abort) so their parse promises
      // resolve and don't leak buffers or surface unhandled rejections.
      await Promise.allSettled(slots.filter((s): s is Promise<ParsedSlot> => s !== undefined));

      // Record this type's timing breakdown (no-op when profiling is off).
      importProfiler.recordFitbitType({
        dataType,
        files: files.length,
        parseMs: parseMsTotal,
        storeMs: storeMsTotal,
        parseIdleDuringStoreMs,
      });
    }

    // A producer-level fault that was not an abort propagates so the import
    // surfaces it (genuine parse errors are already captured per-file above).
    if (producerError && !producerAborted && !signal?.aborted) {
      throw producerError;
    }

    return { stored: totalStored, skipped: totalSkipped };
  }

  // -----------------------------------------------------------------------
  // Parser dispatch
  // -----------------------------------------------------------------------

  /**
   * Dispatch to the correct parser for a data type.
   *
   * Some parsers return compound results (sleep files produce both daily
   * sessions and sleep-stage timeseries; snoring files produce both daily
   * summaries and detailed segments). This method normalises all parser
   * outputs into a `{ daily, timeseries }` pair.
   */
  private async parseDataType(
    parsers: typeof import('./parsers'),
    dataType: string,
    files: File[],
    errors: ImportError[],
  ): Promise<{
    daily: ParsedDailyRecord[];
    timeseries: ParsedTimeseriesRecord[];
  }> {
    try {
      switch (dataType) {
        // -- Compound parsers (produce both daily and timeseries) --------
        case 'sleep_session':
        case 'sleep_stages': {
          const result = await parsers.parseSleepFiles(files);
          return {
            daily: dataType === 'sleep_session' ? result.sessions : [],
            timeseries: dataType === 'sleep_stages' ? result.stages : [],
          };
        }

        case 'snoring_daily':
        case 'snoring_segments': {
          const result = await parsers.parseSnoringFiles(files);
          return {
            daily: dataType === 'snoring_daily' ? result.daily : [],
            timeseries: dataType === 'snoring_segments' ? result.segments : [],
          };
        }

        // -- Single-file daily parsers ----------------------------------
        case 'sleep_score': {
          // parseSleepScoreFile takes a single File, not File[].
          const allRecords: ParsedDailyRecord[] = [];
          for (const file of files) {
            const records = await parsers.parseSleepScoreFile(file);
            allRecords.push(...records);
          }
          return { daily: allRecords, timeseries: [] };
        }

        case 'stress': {
          // parseStressFile takes a single File, not File[].
          const allRecords: ParsedDailyRecord[] = [];
          for (const file of files) {
            const records = await parsers.parseStressFile(file);
            allRecords.push(...records);
          }
          return { daily: allRecords, timeseries: [] };
        }

        // -- Multi-file daily parsers -----------------------------------
        case 'spo2_daily':
          return { daily: await parsers.parseSpO2DailyFiles(files), timeseries: [] };

        case 'hrv_daily':
          return { daily: await parsers.parseHRVDailyFiles(files), timeseries: [] };

        case 'respiratory_rate':
          return { daily: await parsers.parseRespiratoryRateFiles(files), timeseries: [] };

        case 'heart_rate_resting':
          return { daily: await parsers.parseRestingHeartRateFiles(files), timeseries: [] };

        case 'readiness':
          return { daily: await parsers.parseReadinessFiles(files), timeseries: [] };

        case 'temperature':
          return { daily: await parsers.parseTemperatureFiles(files), timeseries: [] };

        case 'activity_daily':
          return { daily: await parsers.parseActivityFiles(files), timeseries: [] };

        // -- Multi-file timeseries parsers ------------------------------
        case 'spo2_intraday':
          return { daily: [], timeseries: await parsers.parseSpO2IntradayFiles(files) };

        case 'hrv_detail':
          return { daily: [], timeseries: await parsers.parseHRVDetailFiles(files) };

        case 'heart_rate_intraday':
          return {
            daily: [],
            timeseries: await parsers.parseHeartRateIntradayFiles(files),
          };

        // -- Data types without dedicated parsers yet -------------------
        case 'body_weight':
        case 'body_vo2max':
        case 'sleep_profile':
          errors.push({
            fileName: dataType,
            error: `Parser not yet implemented for data type: ${dataType}`,
            recoverable: true,
          });
          return { daily: [], timeseries: [] };

        default:
          errors.push({
            fileName: dataType,
            error: `Unknown data type: ${dataType}`,
            recoverable: true,
          });
          return { daily: [], timeseries: [] };
      }
    } catch (err) {
      errors.push({
        fileName: dataType,
        error: `Parser error: ${err instanceof Error ? err.message : String(err)}`,
        recoverable: true,
      });
      return { daily: [], timeseries: [] };
    }
  }

  // -----------------------------------------------------------------------
  // Daily record processing
  // -----------------------------------------------------------------------

  /**
   * Deduplicate, wrap, and batch-store daily summary records.
   *
   * Note: daily summaries keep the first-occurrence-wins de-dupe (skip later
   * same-key records) and are intentionally NOT merged like the intraday
   * timeseries path. A daily record is a pre-aggregated scalar set (an AHI, a
   * mean SpO2, a sleep score) with no per-sample identity to union — two records
   * for one date are genuine duplicates (e.g. two CSV rows on the same calendar
   * date), not complementary partial-day chunks, so skipping the later one is
   * correct. Merging would require re-deriving aggregates from raw inputs the
   * daily files do not carry. See `processTimeseriesRecords` for the merge path.
   */
  private async processDailyRecords(
    parsed: readonly ParsedDailyRecord[],
    dataType: FitbitDailyType,
    skipDuplicates: boolean,
    errors: ImportError[],
    onBatchProgress: (processed: number, skipped: number) => void,
    signal?: AbortSignal,
  ): Promise<{ stored: number; skipped: number }> {
    let stored = 0;
    let skipped = 0;
    const batch: IntegrationDailySummary[] = [];

    // Tracks compound keys already queued during THIS import run. `source` is the
    // constant SOURCE, so the key is `dataType:date`. Queueing two records with
    // the same key into a single batch always violates the unique
    // `source_dataType_date` index, so this in-memory de-dupe runs regardless of
    // the `skipDuplicates` flag (which only governs cross-import DB de-dupe).
    // First occurrence wins; later duplicates are skipped.
    const seenKeys = new Set<string>();

    for (let i = 0; i < parsed.length; i++) {
      const rec = parsed[i];
      if (!rec) continue;

      const key = `${dataType}:${rec.date}`;

      // Intra-import deduplication: skip records whose compound key was already
      // queued earlier in this run, before the DB check or queueing.
      if (seenKeys.has(key)) {
        skipped++;
        if ((i + 1) % YIELD_EVERY === 0) {
          onBatchProgress(stored, skipped);
          await checkpoint(signal);
        }
        continue;
      }

      // Cross-import deduplication check (DB-backed).
      if (skipDuplicates) {
        try {
          const existing = await this.db.getIntegrationDailySummaryByKey(
            SOURCE,
            dataType,
            rec.date,
          );
          if (existing) {
            skipped++;
            if ((i + 1) % YIELD_EVERY === 0) {
              onBatchProgress(stored, skipped);
              await checkpoint(signal);
            }
            continue;
          }
        } catch {
          // If the check fails, proceed with the insert (it will fail on
          // duplicate via the unique index constraint).
        }
      }

      seenKeys.add(key);

      const record: IntegrationDailySummary = {
        id: crypto.randomUUID(),
        source: SOURCE,
        dataType,
        date: rec.date,
        data: rec.data as IntegrationDailySummary['data'],
        importedAt: new Date().toISOString(),
      };

      batch.push(record);

      // Flush batch when it reaches BATCH_SIZE.
      if (batch.length >= BATCH_SIZE) {
        const outcome = await this.storeDailyBatch(batch, errors);
        stored += outcome.stored;
        skipped += outcome.skipped;
        batch.length = 0;
        onBatchProgress(stored, skipped);
        // Boundary AFTER a committed batch — safe to abort.
        await checkpoint(signal);
      }

      if ((i + 1) % YIELD_EVERY === 0) {
        await checkpoint(signal);
      }
    }

    // Flush remaining.
    if (batch.length > 0) {
      const outcome = await this.storeDailyBatch(batch, errors);
      stored += outcome.stored;
      skipped += outcome.skipped;
      onBatchProgress(stored, skipped);
    }

    return { stored, skipped };
  }

  /** Store a batch of daily summary records. */
  private async storeDailyBatch(
    records: IntegrationDailySummary[],
    errors: ImportError[],
  ): Promise<{ stored: number; skipped: number }> {
    try {
      await this.db.bulkAddIntegrationDailySummaries(records);
      return { stored: records.length, skipped: 0 };
    } catch {
      // If the bulk write fails (e.g. constraint error), fall back to
      // inserting one-by-one so partial success is possible.
      let stored = 0;
      let skipped = 0;
      for (const record of records) {
        try {
          await this.db.addIntegrationDailySummary(record);
          stored++;
        } catch (innerErr) {
          // A uniqueness violation means a duplicate already exists — skip it.
          if (this.isConstraintError(innerErr)) {
            skipped++;
          } else {
            const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
            errors.push({
              fileName: `${record.dataType}/${record.date}`,
              error: `Storage failed: ${msg}`,
              recoverable: true,
            });
          }
        }
      }
      return { stored, skipped };
    }
  }

  // -----------------------------------------------------------------------
  // Timeseries record processing
  // -----------------------------------------------------------------------

  /**
   * Merge-on-conflict (upsert-merge), wrap, and store timeseries records.
   *
   * ## Why this is NOT a first-occurrence-wins de-dupe (unlike the daily path)
   *
   * Intraday timeseries records for a SINGLE local date are routinely produced by
   * TWO different export files: real Fitbit `heart_rate-*.json` files span a 24h
   * window offset from local midnight (the offset is the user's UTC offset, so it
   * is DST-dependent), so a date's `00:00 → ~07:00` chunk comes from one file and
   * its `~07:00 → 23:59` chunk from the next. The parser groups by each sample's
   * own local date, emitting these as two same-key records; the streaming
   * pipeline delivers them in separate per-file `processTimeseriesRecords` calls.
   * A skip-the-duplicate strategy (or the unique `source_dataType_date` index)
   * dropped the second chunk, truncating every day's signal. We therefore MERGE
   * the two chunks into one record instead of skipping — see {@link
   * module:services/import/googlehealth/mergeTimeseries} for the merge semantics.
   *
   * The merge is keyed by absolute timestamp and existing-wins on collision, so
   * re-importing identical files is idempotent (records do not grow) and never
   * errors. `skipDuplicates` no longer means "skip if it already exists" for
   * timeseries — there is nothing safe to skip when partial-day chunks must be
   * unioned — so when it is false we treat an existing record exactly as we do
   * when true: as a base to merge into. (The flag still governs whether the
   * costly DB lookup is attempted; with it false a same-date record from a prior
   * import is overwritten by the unique index only if we add, so we always look
   * up and merge to stay correct. The lookup is O(1) on the unique index.)
   *
   * ## Counting
   *
   * `stored` counts records WRITTEN (added or updated-in-place via merge);
   * `skipped` counts records the writer genuinely declined (only the constraint
   * fallback on a non-mergeable add race). A merge into an existing record counts
   * as one `stored`, because it is a write that changed stored state — counting
   * it as `skipped` would mislead the user into thinking their data was dropped,
   * which is precisely the bug class this fix removes. Counts stay monotonic.
   */
  private async processTimeseriesRecords(
    parsed: readonly ParsedTimeseriesRecord[],
    dataType: FitbitTimeseriesType,
    skipDuplicates: boolean,
    errors: ImportError[],
    onBatchProgress: (processed: number, skipped: number) => void,
    signal?: AbortSignal,
  ): Promise<{ stored: number; skipped: number }> {
    let stored = 0;
    let skipped = 0;

    // Intra-call accumulator: collapse records sharing a date BEFORE any DB write
    // by merging their payloads, so a single per-file call that itself contains
    // two same-date chunks emits one record per date. `source` is the constant
    // SOURCE, so the date alone is the in-call key. Insertion order is preserved
    // (Map iteration order) so earlier-parsed records win on a timestamp tie,
    // matching the existing-wins rule used cross-file.
    const byDate = new Map<string, FitbitTimeseriesPayloadMap[FitbitTimeseriesType]>();

    for (let i = 0; i < parsed.length; i++) {
      const rec = parsed[i];
      if (!rec) continue;

      const incoming = rec.data as FitbitTimeseriesPayloadMap[FitbitTimeseriesType];
      const prior = byDate.get(rec.date);
      byDate.set(
        rec.date,
        prior === undefined ? incoming : mergeTimeseriesPayload(dataType, prior, incoming),
      );

      if ((i + 1) % YIELD_EVERY === 0) {
        await checkpoint(signal);
      }
    }

    // Store/merge each accumulated date, in batches, with abort checkpoints
    // AFTER each committed batch.
    const dates = [...byDate.keys()];
    const batch: IntegrationTimeseries[] = [];
    let processedInBatch = 0;

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      const outcome = await this.storeTimeseriesBatch(batch, errors);
      stored += outcome.stored;
      skipped += outcome.skipped;
      batch.length = 0;
      onBatchProgress(stored, skipped);
      await checkpoint(signal);
    };

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      if (date === undefined) continue;
      const payload = byDate.get(date) as FitbitTimeseriesPayloadMap[FitbitTimeseriesType];

      // Cross-import / cross-file merge: fold the accumulated payload into any
      // record already stored under this key and write it back in place by its
      // existing `id`. This runs regardless of `skipDuplicates`: an existing
      // partial-day record must be UNIONED with the new chunk, never skipped.
      const recordToWrite: IntegrationTimeseries = {
        id: crypto.randomUUID(),
        source: SOURCE,
        dataType,
        date,
        data: payload as IntegrationTimeseries['data'],
        importedAt: new Date().toISOString(),
      };

      try {
        const existing = await this.db.getIntegrationTimeseriesByKey(SOURCE, dataType, date);
        if (existing) {
          // Merge into the existing record and UPDATE it in place (same id) via a
          // `put` upsert below — bypasses the batch `add` path so we do not trip
          // the unique index. Counted as stored (a write that changed state).
          const merged = mergeTimeseriesPayload(
            dataType,
            existing.data as FitbitTimeseriesPayloadMap[FitbitTimeseriesType],
            payload,
          );
          const updated: IntegrationTimeseries = {
            ...existing,
            data: merged as IntegrationTimeseries['data'],
            importedAt: new Date().toISOString(),
          };
          try {
            await this.db.putIntegrationTimeseries(updated);
            stored++;
          } catch (putErr) {
            const msg = putErr instanceof Error ? putErr.message : String(putErr);
            errors.push({
              fileName: `${dataType}/${date}`,
              error: `Storage failed: ${msg}`,
              recoverable: true,
            });
          }
          processedInBatch++;
          if (processedInBatch % BATCH_SIZE === 0) {
            onBatchProgress(stored, skipped);
            await checkpoint(signal);
          }
          continue;
        }
      } catch {
        // Lookup failed: fall through and try to add as a new record. If a record
        // actually exists, the unique index rejects the add and the fallback in
        // `storeTimeseriesBatch` classifies it as a skip (a rare race; the next
        // import will merge it correctly).
      }

      batch.push(recordToWrite);
      processedInBatch++;
      if (batch.length >= BATCH_SIZE) {
        await flush();
      }
      if (processedInBatch % YIELD_EVERY === 0) {
        await checkpoint(signal);
      }
    }

    await flush();

    // `skipDuplicates` intentionally does not short-circuit the per-date merge:
    // for timeseries there is never a duplicate that is safe to skip wholesale.
    // The parameter is retained for signature/symmetry with the daily path.
    void skipDuplicates;

    return { stored, skipped };
  }

  /**
   * Store a batch of brand-new timeseries records (no existing key collision was
   * found during {@link processTimeseriesRecords}). Records that DO collide are
   * handled by an in-place merge upsert before reaching this batch, so a
   * `ConstraintError` here means a concurrent/raced insert; we classify it as a
   * skip rather than an error (the next import merges it correctly).
   */
  private async storeTimeseriesBatch(
    records: IntegrationTimeseries[],
    errors: ImportError[],
  ): Promise<{ stored: number; skipped: number }> {
    try {
      await this.db.bulkAddIntegrationTimeseries(records);
      return { stored: records.length, skipped: 0 };
    } catch {
      let stored = 0;
      let skipped = 0;
      for (const record of records) {
        try {
          await this.db.addIntegrationTimeseries(record);
          stored++;
        } catch (innerErr) {
          // A uniqueness violation means a duplicate already exists — skip it.
          if (this.isConstraintError(innerErr)) {
            skipped++;
          } else {
            const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
            errors.push({
              fileName: `${record.dataType}/${record.date}`,
              error: `Storage failed: ${msg}`,
              recoverable: true,
            });
          }
        }
      }
      return { stored, skipped };
    }
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  /**
   * Detect whether an error represents a unique-index constraint violation
   * (i.e. an attempt to insert a duplicate of an already-stored record).
   *
   * Robust against fragile message matching: a uniqueness violation surfaces as
   * a `DOMException` with `.name === 'ConstraintError'` whose message is
   * "...at least one key does not satisfy the uniqueness requirements" — which
   * contains neither "Constraint" nor "duplicate". We therefore inspect the
   * error `name` (including the `StorageError.originalCause` it wraps) and only
   * fall back to substring matching defensively.
   */
  private isConstraintError(err: unknown): boolean {
    if (err instanceof StorageError && err.originalCause?.name === 'ConstraintError') {
      return true;
    }
    if (err instanceof Error && err.name === 'ConstraintError') {
      return true;
    }
    // Defensive fallback: legacy/wrapped errors that only expose a message.
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('Constraint') || msg.includes('duplicate') || msg.includes('uniqueness');
  }

  /** Compute SHA-256 hash of a plain string, returned as hex string. */
  private async computeStringHash(input: string): Promise<string> {
    const encoder = new TextEncoder();
    const buffer = encoder.encode(input).buffer as ArrayBuffer;
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const bytes = new Uint8Array(digest);
    const hex: string[] = [];
    for (let i = 0; i < bytes.length; i++) {
      hex.push((bytes[i] ?? 0).toString(16).padStart(2, '0'));
    }
    return hex.join('');
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/**
 * Marker for a per-file source-read failure surfaced from the producer to the
 * consumer. Distinguished from a parser rejection so the consumer can format its
 * message identically to the strict-serial path ("Failed to read file: ...")
 * without the "Parser error:" prefix.
 */
class FileReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileReadError';
  }
}

/**
 * Cheap upper-bound estimate of a parsed-record array's heap footprint, used to
 * brake the look-ahead byte budget. Each record carries a date string plus a
 * data payload; a fixed per-record charge plus the JSON length of `data` is a
 * conservative, allocation-free-enough proxy (we only need order-of-magnitude
 * accuracy to keep the budget from drifting toward "hold everything").
 */
function approxParsedBytes(
  records: ReadonlyArray<{ readonly date: string; readonly data: unknown }>,
): number {
  let bytes = 0;
  for (const rec of records) {
    bytes += 64; // fixed per-record overhead (wrapper object + date string)
    const data = rec.data;
    if (data && typeof data === 'object') {
      // Arrays of samples dominate; charge by element count when array-like.
      const len = (data as { length?: unknown }).length;
      bytes += typeof len === 'number' ? len * 16 : 256;
    } else {
      bytes += 16;
    }
  }
  return bytes;
}

/**
 * Recognise the {@link WorkerPool}'s cancellation rejections.
 *
 * When a job is cancelled mid-flight the pool rejects in-flight/queued tasks
 * with a `CPAPError` whose `id` is `TASK_ABORTED` (signal fired) or
 * `POOL_SHUTDOWN` (pool draining). Either should be treated as a deliberate
 * cancellation rather than a parser failure.
 */
function isPoolAbort(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const id = (err as { id?: unknown }).id;
  return id === 'TASK_ABORTED' || id === 'POOL_SHUTDOWN';
}

/**
 * Recognise a structured-clone / serialisation failure crossing the worker
 * boundary.
 *
 * `structuredClone` (used by `postMessage`/Comlink) rejects non-cloneable
 * values with a `DataCloneError` `DOMException`. Such a failure is a
 * PROGRAMMING bug — a value that cannot be transferred to or from the worker —
 * not a recoverable problem with the user's data. It must therefore be allowed
 * to fail the import hard rather than being collected as a per-file/per-type
 * parser error (which would silently import zero records while reporting
 * success).
 *
 * Detects both a native `DataCloneError` (`err.name === 'DataCloneError'`) and a
 * marshalled {@link CPAPError} whose message indicates a clone/serialisation
 * failure (e.g. one surfaced across the boundary by the worker pool).
 */
function isCloneFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ((err as { name?: unknown }).name === 'DataCloneError') return true;
  const message = (err as { message?: unknown }).message;
  if (
    typeof message === 'string' &&
    /\b(DataCloneError|could not be cloned|structuredClone)\b/i.test(message)
  ) {
    return true;
  }
  return false;
}
