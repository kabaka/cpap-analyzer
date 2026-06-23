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

import type { GoogleHealthImportProgress, ImportError } from '../types';
import { checkpoint, ImportAbortedError, isImportAbortedError } from '../types';
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
      return importRecord;
    }

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
            pool ??= this.workerPoolFactory();
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

  // -----------------------------------------------------------------------
  // Worker-pool parser dispatch (ADR 0027)
  // -----------------------------------------------------------------------

  /**
   * Parse AND store a heavy data type on the Fitbit parser worker pool,
   * INTERLEAVING storage with parsing to bound peak main-thread memory.
   *
   * Files are processed ONE AT A TIME per pool task: each file's bytes are read,
   * its `ArrayBuffer` is TRANSFERRED into the worker (neutered on this thread so
   * the clone is avoided and main-thread memory is released), parsed off-thread,
   * and its `ParsedRecord[]` returned. The returned records are then stored
   * IMMEDIATELY (daily + timeseries) and the per-file `result` is dropped before
   * the next file is parsed. Peak accumulated-results heap is therefore ~O(one
   * file) regardless of how many files/years the type spans — the previous path
   * accumulated every file's records for the whole type before storing.
   *
   * Equivalence with the old parse-all-then-store path:
   * - **Stored output** is identical: the same records are wrapped and written;
   *   storing per-file vs. per-type does not change record contents.
   * - **Dedup** is preserved, INCLUDING within-import duplicates: dedup is keyed
   *   on `(source, dataType, date)` via {@link IndexedDBService} lookups, so once
   *   file A's record for a date is committed, file B's duplicate finds it and is
   *   skipped — exactly as when all files were stored in one pass. No in-memory
   *   dedup set exists to reset, so nothing per-file can desynchronise it.
   * - **Progress counters** stay monotonic: the running base in `progress`
   *   (`recordsProcessed`/`recordsSkipped`) is advanced by each file's outcome
   *   AFTER that file is stored, so the next file's store callbacks build on the
   *   updated base and totals never go backwards or double-count.
   * - **trackDate** is called for every stored record's date (both halves), so
   *   the import's date-range summary is unchanged.
   *
   * The job `signal` is forwarded to {@link WorkerPool.submit} so a cancelled
   * job's still-queued parse tasks are dropped immediately. A cancel mid-type now
   * leaves MORE already-stored data durable (the desired side benefit); this is
   * consistent with the idempotent per-day dedup model — a re-import skips what
   * was already committed.
   *
   * @param onParseProgress Receives `(recordsProcessedSoFar, recordsTotal)`
   *   across the whole data type. `recordsTotal` is the summed entry count of
   *   all files; it becomes known incrementally as each file is decoded, so it
   *   is reported as a running floor (processed-so-far + current-file-total).
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

    // Records fully parsed in files completed BEFORE the current one.
    let baseProcessed = 0;

    // Explicit, deterministic store-progress base for THIS type. Seeded from the
    // cross-type running totals so progress keeps accumulating across data types,
    // and advanced by each file's stored/skipped outcome AFTER it is stored. The
    // per-file store callbacks render `baseStored + processed` /
    // `baseSkipped + skipped`, so counters stay monotonic and end at the same
    // totals as the old parse-all-then-store path — without depending on whether
    // a fully-skipped file happens to emit a final batch callback.
    let baseStored = progress.recordsProcessed;
    let baseSkipped = progress.recordsSkipped;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;

      // Abort lands between files, before the next is read/transferred.
      await checkpoint(signal);

      let buffer: ArrayBuffer;
      try {
        buffer = await file.arrayBuffer();
      } catch (err) {
        errors.push({
          fileName: file.name,
          error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
          recoverable: true,
        });
        continue;
      }

      // The bytes are TRANSFERRED into the worker (neutered here): the single
      // source file becomes the worker's; the structured-clone copy is avoided
      // and this thread's reference to the buffer is released.
      const workerFile = Comlink.transfer<FitbitWorkerFile>({ name: file.name, buffer }, [buffer]);

      // Determinate within-file progress proxied back from the worker. The
      // last report's `samplesTotal` is this file's exact entry count, which we
      // fold into `baseProcessed` once the file completes so the across-type
      // counter stays monotonic.
      let fileTotal = 0;
      const onProgress = (p: FitbitWorkerProgress): void => {
        fileTotal = Math.max(fileTotal, p.samplesTotal, p.samplesProcessed);
        onParseProgress(baseProcessed + p.samplesProcessed, baseProcessed + fileTotal);
      };

      // Parsed records for THIS file only; dropped before the next iteration.
      let daily: ParsedDailyRecord[];
      let timeseries: ParsedTimeseriesRecord[];
      try {
        const result = await pool.submit(
          (proxy) => proxy.parseDataType(dataType, [workerFile], Comlink.proxy(onProgress)),
          { signal },
        );
        // Copy out of the Comlink result so the proxied object can be released.
        daily = result.daily.map((rec) => ({ date: rec.date, data: rec.data }));
        timeseries = result.timeseries.map((rec) => ({ date: rec.date, data: rec.data }));

        baseProcessed += fileTotal;
        onParseProgress(baseProcessed, baseProcessed);
      } catch (err) {
        // A mid-flight abort surfaces as either our ImportAbortedError (thrown
        // by a checkpoint that raced) or the pool's TASK_ABORTED/POOL_SHUTDOWN
        // CPAPError. Both must unwind the import as a cancellation, not a
        // per-file parser error.
        if (isImportAbortedError(err) || isPoolAbort(err) || signal?.aborted) {
          throw new ImportAbortedError();
        }
        errors.push({
          fileName: file.name,
          error: `Parser error: ${err instanceof Error ? err.message : String(err)}`,
          recoverable: true,
        });
        continue;
      }

      // Store THIS file's records immediately, then release them.
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
        // Advance the running base so the next store builds on it.
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

      // Drop this file's parsed records before the next iteration so peak heap
      // stays bounded to one file.
      daily = [];
      timeseries = [];
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
   * Deduplicate, wrap, and batch-store timeseries records.
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
    const batch: IntegrationTimeseries[] = [];

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
          const existing = await this.db.getIntegrationTimeseriesByKey(SOURCE, dataType, rec.date);
          if (existing) {
            skipped++;
            if ((i + 1) % YIELD_EVERY === 0) {
              onBatchProgress(stored, skipped);
              await checkpoint(signal);
            }
            continue;
          }
        } catch {
          // Proceed with insert.
        }
      }

      seenKeys.add(key);

      const record: IntegrationTimeseries = {
        id: crypto.randomUUID(),
        source: SOURCE,
        dataType,
        date: rec.date,
        data: rec.data as IntegrationTimeseries['data'],
        importedAt: new Date().toISOString(),
      };

      batch.push(record);

      if (batch.length >= BATCH_SIZE) {
        const outcome = await this.storeTimeseriesBatch(batch, errors);
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

    if (batch.length > 0) {
      const outcome = await this.storeTimeseriesBatch(batch, errors);
      stored += outcome.stored;
      skipped += outcome.skipped;
      onBatchProgress(stored, skipped);
    }

    return { stored, skipped };
  }

  /** Store a batch of timeseries records. */
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
