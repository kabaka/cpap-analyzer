/**
 * Import orchestration service.
 *
 * Coordinates the full import pipeline:
 *   scan → parse → build sessions → validate → store.
 *
 * Framework-agnostic (no React). Dependencies are injected via constructor.
 *
 * ## Performance design
 * - **Parallel parsing**: files are parsed across a {@link WorkerPool} sized to
 *   `navigator.hardwareConcurrency` (capped). A single injected worker factory
 *   is used as a fallback when no pool is supplied (tests).
 * - **Transferred buffers**: the worker MOVES `Float32Array` sample buffers to
 *   the main thread instead of cloning them, and returns the raw `EDFFile` only
 *   for STR files. It also computes each file's SHA-256 hash in-worker.
 * - **Per-day streaming**: parsed buffers for a day-group are released as soon
 *   as that day's sessions are built, validated and stored, capping peak memory
 *   on multi-year imports. STR data is parsed first (machine-wide) and its raw
 *   `edf` dropped once the STRParser has consumed it.
 *
 * @module services/import/ImportService
 */

import type { ResMedInterpretation } from '@/parsers/resmed/ResMedInterpreter';
import { assembleChannels } from '@/parsers/resmed/assembleChannels';
import { SessionBuilder, type BuildResult } from '@/parsers/resmed/SessionBuilder';
import { STRParser, type MaskInterval } from '@/parsers/resmed/STRParser';
import type { MachineSettings } from '@/types/session';
import { Validator } from '@/parsers/validation/Validator';
import type { IndexedDBService, StoredNightlyAggregate } from '@/services/storage/IndexedDBService';
import type { OPFSService } from '@/services/storage/OPFSService';
import type { ChannelInput } from '@/services/storage/OPFSService';
import type { ImportRecord } from '@/types/storage';
import type { ImportError as StorageImportError } from '@/types/storage';
import type { WrappedWorker } from '@/services/workers/createWorker';
import type { WorkerPool } from '@/services/workers/WorkerPool';
import type { EDFParserWorkerAPI, ParseResult } from '@/services/workers/edfParser.worker';

import type {
  DayFileGroup,
  DiscoveredFile,
  EDFFileType,
  ImportError,
  ImportOptions,
  ImportProgress,
} from './types';
import { checkpoint } from './types';
import { importProfiler } from './profiling/ImportProfiler';

// Re-export types for consumers
export type { ImportError, ImportOptions, ImportProgress } from './types';

// ---------------------------------------------------------------------------
// Worker / pool factory types
// ---------------------------------------------------------------------------

/**
 * Factory function that creates a Comlink-wrapped EDF parser worker.
 * Injected to keep the service testable without real Web Workers.
 */
export type EDFWorkerFactory = () => WrappedWorker<EDFParserWorkerAPI>;

/**
 * Factory function that creates a {@link WorkerPool} of EDF parser workers.
 *
 * Optional — when omitted, the service falls back to the single-worker
 * {@link EDFWorkerFactory}. Injected so tests can supply a deterministic pool
 * (or rely on the single-worker path) without spawning real Web Workers.
 */
export type EDFWorkerPoolFactory = () => WorkerPool<EDFParserWorkerAPI>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Regex for ResMed EDF filenames: `{YYYYMMDD}_{HHMMSS}_{TYPE}.edf` */
const RESMED_FILENAME_RE = /^(\d{8}_\d{6})_([A-Z]{2,3})\.edf$/i;

/** Regex for the day-folder pattern (YYYYMMDD). */
const DAY_FOLDER_RE = /^\d{8}$/;

/** Known EDF file type suffixes. */
const KNOWN_TYPES = new Set<string>(['BRP', 'EVE', 'PLD', 'SAD', 'CSL', 'STR']);

/** Maximum allowed file size (100 MB). Prevents excessive memory allocation. */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Yield to the event loop every Nth iteration of long synchronous-ish loops. */
const YIELD_EVERY = 10;

// ---------------------------------------------------------------------------
// ImportService
// ---------------------------------------------------------------------------

export class ImportService {
  private readonly sessionBuilder = new SessionBuilder();
  private readonly validator = new Validator();

  constructor(
    private readonly indexedDB: IndexedDBService,
    private readonly opfs: OPFSService | null,
    private readonly workerFactory: EDFWorkerFactory,
    private readonly workerPoolFactory?: EDFWorkerPoolFactory,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Import from an array of `File` objects (drag-and-drop or file input).
   *
   * Resilient: per-file errors are collected, not thrown.
   */
  async importFiles(files: File[], options: ImportOptions): Promise<ImportRecord> {
    return this.runImport(files, options);
  }

  /**
   * Import from a `FileSystemDirectoryHandle` (File System Access API).
   *
   * Recursively walks the directory tree and delegates to the common pipeline.
   */
  async importDirectory(
    dirHandle: FileSystemDirectoryHandle,
    options: ImportOptions,
  ): Promise<ImportRecord> {
    const files: File[] = [];
    for await (const { file } of walkDirectory(dirHandle)) {
      files.push(file);
    }
    return this.runImport(files, options);
  }

  // -----------------------------------------------------------------------
  // Pipeline
  // -----------------------------------------------------------------------

  private async runImport(files: File[], options: ImportOptions): Promise<ImportRecord> {
    const skipDuplicates = options.skipDuplicates ?? true;
    const signal = options.signal;
    const progress = this.createInitialProgress();

    // Gated, default-OFF profiling. `begin()` reads the live global switch; when
    // off, every subsequent profiler call is a cheap no-op (see ImportProfiler).
    importProfiler.begin('cpap');

    const emit = (patch: Partial<ImportProgress>): void => {
      Object.assign(progress, patch);
      options.onProgress?.({ ...progress });
    };

    emit({ status: 'scanning', startTime: Date.now() });

    // --- 1. Scan & classify -----------------------------------------------
    const stopScan = importProfiler.open('scan');
    const discovered = this.scanFiles(files);
    const totalBytes = discovered.reduce((sum, f) => sum + f.file.size, 0);
    stopScan();
    emit({ totalFiles: discovered.length, totalBytes });

    if (discovered.length === 0) {
      return this.buildImportRecord([], 0, 0, [], progress);
    }

    // --- Shared pipeline state --------------------------------------------
    /** Long-lived, tiny: per-file SHA-256 hex strings. */
    const fileHashes = new Map<string, string>();
    const errors: ImportError[] = [];
    const warnings: string[] = [];
    /** Files skipped because they parsed to an empty (header-only) EDF stub. */
    let filesSkippedEmpty = 0;
    let bytesRead = 0;

    // Pre-load dedup keys (source-hash + natural-key) for skipDuplicates.
    const dedup = skipDuplicates
      ? await this.loadExistingDedupKeys()
      : { hashes: new Set<string>(), naturalKeys: new Set<string>() };

    // --- 2. Parse via pool (or single-worker fallback) --------------------
    emit({ status: 'parsing' });

    const runner = this.createParseRunner(signal);
    const totalFiles = discovered.length;

    // Cumulative store counters that span all day-groups.
    let sessionsCreated = 0;
    let sessionsSkipped = 0;
    const allBuildResults: BuildResult[] = [];
    const allSessionSourceHashes: string[] = [];

    try {
      // --- 2a. STR phase (machine-wide) -----------------------------------
      // Parse all STR files first so settings + mask intervals are available
      // before any day-group's sessions are built. STR buffers are released as
      // soon as the STRParser has consumed them.
      const strFiles = discovered.filter((d) => d.fileType === 'STR');
      const nonStrFiles = discovered.filter((d) => d.fileType !== 'STR');

      let strSettingsByDate: ReadonlyMap<string, MachineSettings> = new Map();
      let strMaskIntervalsByDate: ReadonlyMap<string, readonly MaskInterval[]> = new Map();
      const strParser = new STRParser();

      const stopStr = importProfiler.open('str');
      for (const df of strFiles) {
        // Loop-boundary checkpoint: abort lands here, before any parse work for
        // this STR file begins — never mid-write.
        await checkpoint(signal);
        const parsed = await this.parseOne(runner, df, /* includeEdf */ true);
        bytesRead += parsed.byteLength;
        emit({
          currentFileName: df.relativePath,
          filesProcessed: progress.filesProcessed + 1,
          bytesRead,
          currentStage: `Parsing file ${progress.filesProcessed + 1} of ${totalFiles}`,
        });

        if (parsed.error) {
          errors.push(parsed.error);
          continue;
        }
        const result = parsed.result;
        if (!result) continue;
        fileHashes.set(df.relativePath, result.fileHash);
        this.collectValidationMessages(df.relativePath, result, warnings);

        // Empty stub: benign skip, not an error and not a session source.
        if (this.isEmptyParse(result)) {
          filesSkippedEmpty++;
          continue;
        }

        const edf = result.edf;
        if (!edf) continue;
        try {
          const rawChannels = edf.signals.map((sig) => ({
            label: sig.label,
            samples: sig.samples,
            samplesPerRecord: sig.samplesPerRecord,
          }));
          const strResult = strParser.parseFromRawChannels(
            rawChannels,
            edf.startTime,
            edf.header.numDataRecords,
          );
          if (strResult.settingsByDate.size > 0) {
            strSettingsByDate = strResult.settingsByDate;
          }
          if (strResult.maskIntervalsByDate.size > 0) {
            strMaskIntervalsByDate = strResult.maskIntervalsByDate;
          }
        } catch (err) {
          warnings.push(
            `STR.edf parsing (${df.relativePath}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        // STR raw `edf` is now consumable garbage; `parsed`/`result` go out of
        // scope at the next loop iteration so its buffers are released.
      }
      stopStr();

      // --- 2b. Per-day streaming phase ------------------------------------
      // Group the non-STR files by day, then for each day: parse concurrently,
      // build → validate → store, and release that day's buffers before moving
      // on. This caps peak memory regardless of total import span.
      const dayGroups = this.groupByDay(nonStrFiles);
      emit({ totalDayGroups: dayGroups.length, dayGroupsProcessed: 0 });

      const sessionBaselineStore = { value: 0 };

      for (let i = 0; i < dayGroups.length; i++) {
        const dayGroup = dayGroups[i];
        if (!dayGroup) continue;

        // Loop-boundary checkpoint: abort lands here, between fully-committed
        // days. The previous day's storage is complete and consistent; this
        // day's parse/build/store has not started.
        await checkpoint(signal);

        // Parse every file in this day-group concurrently across the pool. The
        // per-file callback keeps `status: 'parsing'` while files are in flight,
        // even though parse/build/store now interleave per day.
        const stopParse = importProfiler.open('parse');
        const { interpretations, byteTotal, emptySkips } = await this.parseDayGroup(
          runner,
          dayGroup,
          fileHashes,
          errors,
          warnings,
          (delta) => {
            bytesRead += delta;
          },
          () => {
            emit({
              status: 'parsing',
              filesProcessed: progress.filesProcessed + 1,
              bytesRead,
              currentStage: `Parsing file ${progress.filesProcessed + 1} of ${totalFiles}`,
            });
          },
        );
        stopParse();
        const dayParseMs = importProfiler.isEnabled() ? importProfiler.lastSpanMs : 0;
        filesSkippedEmpty += emptySkips;

        // Build sessions for this day.
        let dayResults: BuildResult[] = [];
        let dayBuildMs = 0;
        const dayInterps = [...interpretations.values()];
        if (dayInterps.length > 0) {
          emit({
            status: 'building',
            currentStage: `Building sessions: day ${i + 1} of ${dayGroups.length}`,
          });
          const stopBuild = importProfiler.open('build');
          try {
            dayResults = this.sessionBuilder.buildSessions(
              dayInterps,
              strSettingsByDate,
              strMaskIntervalsByDate,
            );
          } catch (err) {
            errors.push({
              fileName: dayGroup.dayFolder || '(root)',
              error: `Session build failed: ${err instanceof Error ? err.message : String(err)}`,
              recoverable: true,
            });
          }
          stopBuild();
          dayBuildMs = importProfiler.isEnabled() ? importProfiler.lastSpanMs : 0;
        }

        // Validate + store this day's sessions, then release its buffers.
        const dayStoreTiming = {
          validateMs: 0,
          storeMs: 0,
          storeIdbMs: 0,
          storeOpfsMs: 0,
          chunks: 0,
        };
        const storeOutcome = await this.validateAndStoreDay(
          dayGroup,
          dayResults,
          interpretations,
          fileHashes,
          dedup,
          skipDuplicates,
          errors,
          warnings,
          sessionBaselineStore,
          (patch) => emit(patch),
          signal,
          dayStoreTiming,
        );

        // Record this day-group's timing breakdown (no-op when profiling is off).
        importProfiler.recordCpapDayGroup({
          dayFolder: dayGroup.dayFolder || '(root)',
          files: this.countDayFiles(dayGroup),
          parsedBytes: byteTotal,
          parseMs: dayParseMs,
          buildMs: dayBuildMs,
          validateMs: dayStoreTiming.validateMs,
          storeMs: dayStoreTiming.storeMs,
          storeIdbMs: dayStoreTiming.storeIdbMs,
          storeOpfsMs: dayStoreTiming.storeOpfsMs,
          opfsChunks: dayStoreTiming.chunks,
        });
        sessionsCreated += storeOutcome.created;
        sessionsSkipped += storeOutcome.skipped;
        allBuildResults.push(...dayResults);
        allSessionSourceHashes.push(...storeOutcome.sourceHashes);

        // Release this day's parsed buffers explicitly.
        interpretations.clear();

        emit({
          dayGroupsProcessed: i + 1,
          sessionsCreated,
          currentStage: `Processed day ${i + 1} of ${dayGroups.length}`,
        });

        if ((i + 1) % YIELD_EVERY === 0) {
          await checkpoint(signal);
        }
      }
    } finally {
      runner.dispose();
    }

    // --- 3. Report --------------------------------------------------------
    emit({
      status: 'complete',
      errors: [...errors],
      warnings: [...warnings],
      filesSkippedEmpty,
    });

    importProfiler.finish();

    const overallHash = await this.computeStringHash(allSessionSourceHashes.sort().join(':'));
    return this.buildImportRecord(
      allBuildResults,
      sessionsCreated,
      sessionsSkipped,
      errors,
      progress,
      overallHash,
    );
  }

  // -----------------------------------------------------------------------
  // Parse runner abstraction (pool ↔ single-worker fallback)
  // -----------------------------------------------------------------------

  /**
   * Build a parse runner backed by a {@link WorkerPool} when a pool factory was
   * injected, or a single Comlink worker otherwise (tests / environments
   * without `navigator.hardwareConcurrency`).
   */
  private createParseRunner(signal?: AbortSignal): ParseRunner {
    if (this.workerPoolFactory) {
      const pool = this.workerPoolFactory();
      // Gated occupancy sampling: when profiling is on, poll the pool's
      // busy/size so the profile can show whether workers idle during
      // build/validate/store. No-op when profiling is off.
      importProfiler.attachPoolSnapshot(() => ({
        busy: pool.busyWorkerCount,
        size: pool.maxPoolSize,
      }));
      return {
        // Forward the job's signal so a cancelled job's still-queued parse
        // tasks are dropped immediately (the pool rejects them) rather than
        // running to completion in the background.
        run: (buffer, includeEdf) =>
          pool.submit((proxy) => proxy.parseEDFFile(buffer, includeEdf), { signal }),
        dispose: () => {
          void pool.shutdown();
        },
      };
    }

    const worker = this.workerFactory();
    return {
      run: (buffer, includeEdf) => worker.proxy.parseEDFFile(buffer, includeEdf),
      dispose: () => worker.dispose(),
    };
  }

  /**
   * Parse a single discovered file. Reads its bytes, enforces the size cap, and
   * dispatches to the runner. Errors are returned (never thrown) so callers can
   * isolate per-file failures.
   */
  private async parseOne(
    runner: ParseRunner,
    df: DiscoveredFile,
    includeEdf: boolean,
  ): Promise<{ result?: ParseResult; error?: ImportError; byteLength: number }> {
    if (df.file.size > MAX_FILE_SIZE) {
      return {
        error: {
          fileName: df.relativePath,
          error: `File exceeds maximum size of 100 MB (${(df.file.size / 1024 / 1024).toFixed(1)} MB)`,
          recoverable: true,
        },
        byteLength: 0,
      };
    }

    try {
      const buffer = await df.file.arrayBuffer();
      const byteLength = buffer.byteLength;
      // The buffer is structured-cloned into the worker (passed by value, not
      // transferred), so it stays valid on the main thread and is safe for the
      // pool to resubmit on worker crash-recovery. The parsed result (with its
      // sample buffers) is transferred back out of the worker.
      const result = await runner.run(buffer, includeEdf);
      return { result, byteLength };
    } catch (err) {
      return {
        error: {
          fileName: df.relativePath,
          error: err instanceof Error ? err.message : String(err),
          recoverable: true,
        },
        byteLength: 0,
      };
    }
  }

  /**
   * Parse all files in a single day-group concurrently.
   *
   * Concurrency is bounded by the pool's worker count (the pool queues excess
   * tasks). Per-file errors are captured into `errors`; the file hash and any
   * validation warnings are recorded. Returns the surviving interpretations
   * keyed by relative path so the store step can map sessions → files.
   *
   * Progress (`onFileDone`) fires once per completed file. Because files in a
   * day complete out of order under the pool, the per-file COUNT stays accurate
   * even though `currentFileName` is best-effort.
   */
  private async parseDayGroup(
    runner: ParseRunner,
    dayGroup: DayFileGroup,
    fileHashes: Map<string, string>,
    errors: ImportError[],
    warnings: string[],
    addBytes: (delta: number) => void,
    onFileDone: () => void,
  ): Promise<{
    interpretations: Map<string, ResMedInterpretation>;
    byteTotal: number;
    emptySkips: number;
  }> {
    const interpretations = new Map<string, ResMedInterpretation>();
    let byteTotal = 0;
    let emptySkips = 0;

    const dayFiles: DiscoveredFile[] = [];
    for (const group of dayGroup.files.values()) {
      for (const df of group) dayFiles.push(df);
    }

    await Promise.all(
      dayFiles.map(async (df) => {
        const parsed = await this.parseOne(runner, df, /* includeEdf */ false);
        addBytes(parsed.byteLength);
        byteTotal += parsed.byteLength;

        if (parsed.error) {
          errors.push(parsed.error);
        } else if (parsed.result) {
          fileHashes.set(df.relativePath, parsed.result.fileHash);
          this.collectValidationMessages(df.relativePath, parsed.result, warnings);
          if (this.isEmptyParse(parsed.result)) {
            // Benign empty (header-only) stub: do NOT fabricate a session and
            // do NOT record an error — just count it.
            emptySkips++;
          } else {
            interpretations.set(df.relativePath, parsed.result.interpretation);
          }
        }
        onFileDone();
      }),
    );

    return { interpretations, byteTotal, emptySkips };
  }

  /** Append validation errors/warnings from a parse result to `warnings`. */
  private collectValidationMessages(
    relativePath: string,
    result: ParseResult,
    warnings: string[],
  ): void {
    if (!result.validation.isValid) {
      for (const err of result.validation.errors) {
        warnings.push(`${relativePath}: ${err.message}`);
      }
    }
    for (const w of result.validation.warnings) {
      warnings.push(`${relativePath}: ${w.message}`);
    }
  }

  /**
   * An empty (header-only) EDF stub yields zero signals and zero channels. Such
   * files (e.g. CSL on nights with no Cheyne-Stokes events) are a benign skip.
   */
  private isEmptyParse(result: ParseResult): boolean {
    return (
      result.interpretation.channels.length === 0 &&
      result.interpretation.events.length === 0 &&
      result.interpretation.duration === 0
    );
  }

  // -----------------------------------------------------------------------
  // Validate + store a single day-group
  // -----------------------------------------------------------------------

  private async validateAndStoreDay(
    dayGroup: DayFileGroup,
    dayResults: BuildResult[],
    interpretations: Map<string, ResMedInterpretation>,
    fileHashes: Map<string, string>,
    dedup: DedupKeys,
    skipDuplicates: boolean,
    errors: ImportError[],
    warnings: string[],
    storeBaseline: { value: number },
    emit: (patch: Partial<ImportProgress>) => void,
    signal: AbortSignal | undefined,
    timing?: StoreTiming,
  ): Promise<{ created: number; skipped: number; sourceHashes: string[] }> {
    let created = 0;
    let skipped = 0;
    const sourceHashes: string[] = [];

    if (dayResults.length === 0) {
      return { created, skipped, sourceHashes };
    }

    // Validate (warnings only — never blocks the store).
    emit({ status: 'building', currentStage: 'Validating sessions...' });
    const stopValidate = importProfiler.open('validate');
    for (let i = 0; i < dayResults.length; i++) {
      const br = dayResults[i];
      if (!br) continue;
      const sessionValidation = this.validator.validateSession(br);
      for (const w of sessionValidation.warnings) {
        warnings.push(`Session ${br.session.date}: ${w.message}`);
      }
      for (const e of sessionValidation.errors) {
        warnings.push(`Session ${br.session.date} [error]: ${e.message}`);
      }
      emit({ sessionsValidated: storeBaseline.value + i + 1 });
      // Validation is read-only — safe to abort between sessions.
      if ((i + 1) % YIELD_EVERY === 0) await checkpoint(signal);
    }
    stopValidate();
    if (timing) timing.validateMs = importProfiler.isEnabled() ? importProfiler.lastSpanMs : 0;

    const stopStore = importProfiler.open('store');
    // Store. `totalSessionsToStore` accumulates across days (sessions are built
    // incrementally under streaming, so the denominator grows but is never 0
    // once storing begins) — keeps the storing-stage progress bar meaningful.
    emit({
      status: 'storing',
      currentStage: 'Storing sessions...',
      totalSessionsToStore: storeBaseline.value + dayResults.length,
    });
    for (let i = 0; i < dayResults.length; i++) {
      const br = dayResults[i];
      if (!br) continue;
      const storeIdx = storeBaseline.value + i;
      try {
        // Compose this session's sourceHash from its contributing file hashes.
        const contributing = this.findContributingFiles(dayGroup, interpretations, br);
        const sortedPaths = [...contributing].sort();
        const combinedHash = sortedPaths.map((p) => fileHashes.get(p) ?? '').join(':');
        const sessionSourceHash = await this.computeStringHash(combinedHash);
        sourceHashes.push(sessionSourceHash);

        const naturalKey = this.naturalKey(br.session.machineId, br.session.startTime);

        // Deduplication: skip if either the exact source hash OR the stable
        // natural key (machineId + startTime) already exists. The natural key
        // catches re-imports where a single source byte changed.
        if (
          skipDuplicates &&
          (dedup.hashes.has(sessionSourceHash) || dedup.naturalKeys.has(naturalKey))
        ) {
          warnings.push(`Session ${br.session.date}: skipped (duplicate)`);
          skipped++;
          emit({
            sessionsStored: storeIdx + 1,
            currentStage: `Storing session ${storeIdx + 1}`,
          });
          // Boundary AFTER this session's outcome is finalised (skip path: no
          // write was performed). Safe to abort here.
          if ((i + 1) % YIELD_EVERY === 0) await checkpoint(signal);
          continue;
        }

        const sessionWithHash = { ...br.session, sourceHash: sessionSourceHash };

        await this.storeSession(
          { ...br, session: sessionWithHash },
          interpretations,
          contributing,
          timing,
        );

        // Record the new keys so later sessions in THIS import also dedup
        // against it (e.g. the same night appearing twice in one selection).
        dedup.hashes.add(sessionSourceHash);
        dedup.naturalKeys.add(naturalKey);
        created++;
        emit({
          sessionsCreated: storeBaseline.value + i + 1,
          sessionsStored: storeIdx + 1,
          currentStage: `Storing session ${storeIdx + 1}`,
        });
      } catch (err) {
        errors.push({
          fileName: `session-${br.session.date}`,
          error: `Storage failed: ${err instanceof Error ? err.message : String(err)}`,
          recoverable: true,
        });
        emit({
          sessionsStored: storeIdx + 1,
          currentStage: `Storing session ${storeIdx + 1}`,
        });
      }
      // Boundary AFTER this session's store (or its compensation) has fully
      // resolved — the per-session IDB transaction + OPFS write are complete, so
      // aborting here leaves storage consistent.
      if ((i + 1) % YIELD_EVERY === 0) await checkpoint(signal);
    }
    stopStore();
    if (timing) timing.storeMs = importProfiler.isEnabled() ? importProfiler.lastSpanMs : 0;

    storeBaseline.value += dayResults.length;
    return { created, skipped, sourceHashes };
  }

  // -----------------------------------------------------------------------
  // File scanning & classification
  // -----------------------------------------------------------------------

  /** Discover EDF files, classify by type, and filter empties. */
  scanFiles(files: File[]): DiscoveredFile[] {
    const discovered: DiscoveredFile[] = [];

    for (const file of files) {
      // Only .edf files
      if (!file.name.toLowerCase().endsWith('.edf')) continue;
      // Skip 0-byte files
      if (file.size === 0) continue;

      const relativePath = (file as FileWithPath).webkitRelativePath || file.name;
      const pathParts = relativePath.split('/');
      const fileName = pathParts[pathParts.length - 1] ?? file.name;

      // Determine day folder from parent directory
      const parentDir = pathParts.length >= 2 ? (pathParts[pathParts.length - 2] ?? '') : '';
      const dayFolder = DAY_FOLDER_RE.test(parentDir) ? parentDir : '';

      // Classify file type and extract timestamp
      const { fileType, timestamp } = this.classifyFile(fileName, dayFolder);

      discovered.push({
        file,
        relativePath,
        dayFolder,
        fileType,
        timestamp,
      });
    }

    return discovered;
  }

  /** Count the total files across all timestamp-groups in a day-group. */
  private countDayFiles(dayGroup: DayFileGroup): number {
    let n = 0;
    for (const group of dayGroup.files.values()) n += group.length;
    return n;
  }

  /** Group discovered files by day folder and timestamp. */
  groupByDay(files: DiscoveredFile[]): DayFileGroup[] {
    const dayMap = new Map<string, Map<string, DiscoveredFile[]>>();

    for (const df of files) {
      const key = df.dayFolder || '__root__';
      let timestampMap = dayMap.get(key);
      if (!timestampMap) {
        timestampMap = new Map();
        dayMap.set(key, timestampMap);
      }

      const tsKey = df.timestamp || df.relativePath;
      let group = timestampMap.get(tsKey);
      if (!group) {
        group = [];
        timestampMap.set(tsKey, group);
      }
      group.push(df);
    }

    return Array.from(dayMap.entries()).map(([dayFolder, filesMap]) => ({
      dayFolder: dayFolder === '__root__' ? '' : dayFolder,
      files: filesMap,
    }));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Classify an EDF filename into type and timestamp. */
  private classifyFile(
    fileName: string,
    dayFolder: string,
  ): { fileType: EDFFileType; timestamp: string } {
    // Top-level STR.edf
    if (fileName.toLowerCase() === 'str.edf') {
      return { fileType: 'STR', timestamp: dayFolder };
    }

    const match = RESMED_FILENAME_RE.exec(fileName);
    if (!match) {
      return { fileType: 'unknown', timestamp: dayFolder };
    }

    const timestamp = match[1] ?? '';
    const typeSuffix = (match[2] ?? '').toUpperCase();
    const fileType: EDFFileType = KNOWN_TYPES.has(typeSuffix)
      ? (typeSuffix as EDFFileType)
      : 'unknown';

    return { fileType, timestamp };
  }

  /**
   * Determine which files contributed to a given session by matching
   * interpretation start times within the session's time window.
   */
  private findContributingFiles(
    dayGroup: DayFileGroup,
    allInterpretations: Map<string, ResMedInterpretation>,
    buildResult: BuildResult,
  ): Set<string> {
    const sessionStart = new Date(buildResult.session.startTime).getTime();
    const sessionEnd = new Date(buildResult.session.endTime).getTime();
    const contributing = new Set<string>();

    for (const filesInTimestamp of dayGroup.files.values()) {
      for (const df of filesInTimestamp) {
        const interp = allInterpretations.get(df.relativePath);
        if (!interp) continue;

        const interpStart = interp.startTime.getTime();
        const interpEnd = interpStart + interp.duration * 1000;

        // If the interpretation overlaps the session window, it contributed
        if (interpStart <= sessionEnd && interpEnd >= sessionStart) {
          contributing.add(df.relativePath);
        }
      }
    }

    return contributing;
  }

  /**
   * Stable natural key for a session: machine serial + recording start time.
   *
   * Unlike `sourceHash` (which changes if any source byte changes), this key is
   * invariant across re-exports of the same night, so it dedups re-imports.
   */
  private naturalKey(machineId: string, startTime: string): string {
    return `${machineId} ${startTime}`;
  }

  /**
   * Store a single session's metadata + signal data.
   *
   * Metadata (session + nightly aggregate + events) is written in a SINGLE
   * IndexedDB transaction via {@link IndexedDBService.addSessionWithRelated},
   * which rolls back all three on any failure.
   *
   * The OPFS signal write is sequenced AFTER the IDB commit. If the OPFS write
   * then fails we compensate by deleting the just-committed session metadata, so
   * metadata and signal chunks can never diverge (no session row pointing at
   * absent/partial signal data).
   */
  private async storeSession(
    buildResult: BuildResult,
    interpretations: InterpretationMap,
    contributingFiles: Set<string>,
    timing?: StoreTiming,
  ): Promise<void> {
    const { session, aggregate, events } = buildResult;
    const profiling = importProfiler.isEnabled();

    const storedAggregate: StoredNightlyAggregate = {
      ...aggregate,
      machineId: session.machineId,
    };

    // 1. Atomic metadata write (sessions + nightly_aggregates + events).
    const idbStart = profiling ? performanceNow() : 0;
    await this.indexedDB.addSessionWithRelated(session, storedAggregate, events);
    if (profiling && timing) timing.storeIdbMs += performanceNow() - idbStart;

    // 2. Signal data → OPFS (if available). Sequenced after the IDB commit so a
    //    successful commit is never left pointing at a failed signal write.
    if (this.opfs) {
      try {
        const startMs = new Date(session.startTime).getTime();
        const endMs = new Date(session.endTime).getTime();
        const channelInputs = this.buildChannelInputs(
          interpretations,
          contributingFiles,
          startMs,
          endMs,
        );
        // Skip the write when every assembled channel is empty. The assembler
        // (`assembleChannels`) bails to an empty Float32Array when a segment's
        // declared window exceeds its own safety bounds, but still emits one
        // descriptor per channel — so `channelInputs.length > 0` alone is not
        // proof there is anything to store. Writing an all-empty set would
        // produce a manifest with no usable signal data; `writeSession`'s own
        // window guard is the load-bearing DoS defence, this is a cheap
        // defensive skip layered on top.
        const hasSignalData =
          channelInputs.length > 0 && channelInputs.some((ch) => ch.data.length > 0);
        if (hasSignalData) {
          const opfsStart = profiling ? performanceNow() : 0;
          const manifest = await this.opfs.writeSession(session.id, startMs, endMs, channelInputs);
          if (profiling && timing) {
            timing.storeOpfsMs += performanceNow() - opfsStart;
            timing.chunks += manifest.chunks.length;
          }
        }
      } catch (opfsErr) {
        // Compensate: undo the metadata commit so the two stores stay in sync.
        // Cascade-delete the session AND its nightly aggregate + events in one
        // atomic IDB transaction — deleting only the `sessions` row would leave
        // an orphaned aggregate that Dashboard/Trends read by date range and
        // surface as a phantom night with wrong AHI/usage/compliance.
        try {
          await this.indexedDB.deleteSessionCascade(session.id);
        } catch {
          // Best-effort rollback; surface the original OPFS failure regardless.
        }
        // Defensively clear any partial OPFS chunks the failed write may have
        // left behind (OPFS lives outside IndexedDB, so it is not covered by the
        // IDB cascade above).
        try {
          await this.opfs.deleteSessionData(session.id);
        } catch {
          // Best-effort; surface the original OPFS failure regardless.
        }
        throw opfsErr;
      }
    }
  }

  /**
   * Assemble the contributing files' channels into window-aligned, gap-padded
   * series spanning the full session window, then convert them to
   * {@link ChannelInput}s for OPFS.
   *
   * A single therapy night can be split across several consecutive EDF files
   * (segments). Each must be CONCATENATED at its own window offset — not merged
   * by "longest segment wins", which discarded shorter segments and shifted the
   * surviving samples to the window origin, truncating multi-segment nights.
   * {@link assembleChannels} is the single shared assembler used here and in
   * {@link SessionBuilder.buildFromGroup}, so OPFS signal data and the nightly
   * aggregates agree and both span the whole night. Gaps are filled with NaN
   * (the project-wide no-data sentinel; see {@link assembleChannels}).
   */
  private buildChannelInputs(
    interpretations: InterpretationMap,
    contributingFiles: Set<string>,
    sessionStartMs: number,
    sessionEndMs: number,
  ): ChannelInput[] {
    const segments: ResMedInterpretation[] = [];
    for (const filePath of contributingFiles) {
      const interp = interpretations.get(filePath);
      if (interp) segments.push(interp);
    }

    const assembled = assembleChannels(segments, sessionStartMs, sessionEndMs);

    return assembled.map((channel) => ({
      name: channel.name,
      sampleRate: channel.sampleRate,
      unit: channel.unit,
      physicalMin: channel.metadata.physicalMin,
      physicalMax: channel.metadata.physicalMax,
      data: channel.samples,
    }));
  }

  /** Compute SHA-256 hash of an ArrayBuffer, returned as hex string. */
  private async computeHash(buffer: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return this.hexFromBuffer(digest);
  }

  /** Compute SHA-256 hash of a plain string, returned as hex string. */
  private async computeStringHash(input: string): Promise<string> {
    const encoder = new TextEncoder();
    return this.computeHash(encoder.encode(input).buffer as ArrayBuffer);
  }

  /** Convert an ArrayBuffer to a lowercase hex string. */
  private hexFromBuffer(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const hex: string[] = [];
    for (let i = 0; i < bytes.length; i++) {
      hex.push((bytes[i] ?? 0).toString(16).padStart(2, '0'));
    }
    return hex.join('');
  }

  /**
   * Load existing dedup keys: both session `sourceHash`es and the stable
   * `(machineId, startTime)` natural keys, in one pass over stored sessions.
   */
  private async loadExistingDedupKeys(): Promise<DedupKeys> {
    const sessions = await this.indexedDB.getAllSessions();
    const hashes = new Set<string>();
    const naturalKeys = new Set<string>();
    for (const s of sessions) {
      hashes.add(s.sourceHash);
      naturalKeys.add(this.naturalKey(s.machineId, s.startTime));
    }
    return { hashes, naturalKeys };
  }

  /** Build an initial (idle) progress snapshot. */
  private createInitialProgress(): ImportProgress {
    return {
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
  }

  /** Assemble the final ImportRecord from pipeline results. */
  private buildImportRecord(
    allSessions: BuildResult[],
    sessionsImported: number,
    sessionsSkipped: number,
    errors: ImportError[],
    progress: ImportProgress,
    sourceHash = '',
  ): ImportRecord {
    const now = new Date().toISOString();
    const durationSeconds = progress.startTime > 0 ? (Date.now() - progress.startTime) / 1000 : 0;

    const firstSession = allSessions[0]?.session;
    const dates = allSessions.map((r) => r.session.date).sort();
    const sessionsErrored = allSessions.length - sessionsImported - sessionsSkipped;

    return {
      id: crypto.randomUUID(),
      machineId: firstSession?.machineId ?? '',
      machineModel: firstSession?.machineModel ?? '',
      importedAt: now,
      dateRangeStart: dates[0] ?? '',
      dateRangeEnd: dates[dates.length - 1] ?? '',
      sessionsImported,
      sessionsSkipped,
      sessionsErrored: Math.max(sessionsErrored, 0),
      sourceHash,
      durationSeconds: Math.round(durationSeconds * 100) / 100,
      errors: errors.map(
        (e): StorageImportError => ({
          fileName: e.fileName,
          error: e.error,
          timestamp: now,
        }),
      ),
    };
  }
}

// ---------------------------------------------------------------------------
// Parse runner (internal)
// ---------------------------------------------------------------------------

/**
 * Abstraction over "parse one buffer" that hides whether a single worker or a
 * pool is doing the work. Lets the pipeline drive bounded concurrency uniformly.
 */
interface ParseRunner {
  run(buffer: ArrayBuffer, includeEdf: boolean): Promise<ParseResult>;
  dispose(): void;
}

/** Pre-loaded dedup lookup keys. */
interface DedupKeys {
  readonly hashes: Set<string>;
  readonly naturalKeys: Set<string>;
}

/**
 * Per-day-group store-phase timing accumulator (gated profiling only). Split so
 * the profile can attribute store time to IndexedDB metadata writes vs. OPFS
 * chunk writes — the decision input for "parallel OPFS chunk writes". Passed in
 * (and mutated) only when profiling is enabled; otherwise it is `undefined` and
 * the timing branches are skipped.
 */
interface StoreTiming {
  validateMs: number;
  storeMs: number;
  storeIdbMs: number;
  storeOpfsMs: number;
  chunks: number;
}

/** Monotonic clock for the store IDB/OPFS split. */
function performanceNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Per-day map of relativePath → interpretation (channels carried for OPFS). */
type InterpretationMap = Map<string, ResMedInterpretation>;

// ---------------------------------------------------------------------------
// Directory walker
// ---------------------------------------------------------------------------

/**
 * Recursively walk a FileSystemDirectoryHandle, yielding each file with
 * its relative path.
 */
async function* walkDirectory(
  dirHandle: FileSystemDirectoryHandle,
  path = '',
): AsyncGenerator<{ file: File; path: string }> {
  for await (const [name, handle] of dirHandle.entries()) {
    const fullPath = path ? `${path}/${name}` : name;
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile();
      yield { file, path: fullPath };
    } else if (handle.kind === 'directory') {
      yield* walkDirectory(handle as FileSystemDirectoryHandle, fullPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Utility: File with webkitRelativePath
// ---------------------------------------------------------------------------

/**
 * Extended File type including the non-standard `webkitRelativePath`
 * property available when files are selected via directory input.
 */
interface FileWithPath extends File {
  readonly webkitRelativePath: string;
}
