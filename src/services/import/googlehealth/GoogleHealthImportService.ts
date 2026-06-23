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
import type { GoogleHealthImportProgress, ImportError } from '../types';
import { checkpoint } from '../types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Number of records to store per IndexedDB batch transaction. */
const BATCH_SIZE = 100;

/** Yield to the event loop every Nth record to keep the UI responsive. */
const YIELD_EVERY = 50;

/** Integration source identifier for Fitbit data. */
const SOURCE: IntegrationSource = 'fitbit';

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
  constructor(private readonly db: IndexedDBService) {}

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

    for (let i = 0; i < selectedInfos.length; i++) {
      const dtInfo = selectedInfos[i];
      if (!dtInfo) continue;

      // Loop-boundary checkpoint: abort lands between fully-processed data
      // types, before this type's files are read/parsed/stored.
      await checkpoint(signal);

      emit({
        currentDataType: dtInfo.dataType,
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

        // 2. Parse the files using the appropriate parser.
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
      } catch (err) {
        // Cancellation must NOT be swallowed as a per-type error — rethrow so it
        // unwinds the whole import. (Checked by name to be robust across realms.)
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

    for (let i = 0; i < parsed.length; i++) {
      const rec = parsed[i];
      if (!rec) continue;

      // Deduplication check.
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
          // Likely a duplicate constraint error. Count as skipped.
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          if (msg.includes('Constraint') || msg.includes('duplicate')) {
            skipped++;
          } else {
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

    for (let i = 0; i < parsed.length; i++) {
      const rec = parsed[i];
      if (!rec) continue;

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
          const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
          if (msg.includes('Constraint') || msg.includes('duplicate')) {
            skipped++;
          } else {
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
