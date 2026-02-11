/**
 * Import orchestration service.
 *
 * Coordinates the full import pipeline:
 *   scan → parse → build sessions → validate → store.
 *
 * Framework-agnostic (no React). Dependencies are injected via constructor.
 *
 * @module services/import/ImportService
 */

import type { ResMedInterpretation, StandardChannel } from '@/parsers/resmed/ResMedInterpreter';
import { SessionBuilder, type BuildResult } from '@/parsers/resmed/SessionBuilder';
import { Validator } from '@/parsers/validation/Validator';
import type { IndexedDBService, StoredNightlyAggregate } from '@/services/storage/IndexedDBService';
import type { OPFSService } from '@/services/storage/OPFSService';
import type { ChannelInput } from '@/services/storage/OPFSService';
import type { ImportRecord } from '@/types/storage';
import type { ImportError as StorageImportError } from '@/types/storage';
import type { WrappedWorker } from '@/services/workers/createWorker';
import type { EDFParserWorkerAPI, ParseResult } from '@/services/workers/edfParser.worker';

import type {
  DayFileGroup,
  DiscoveredFile,
  EDFFileType,
  ImportError,
  ImportOptions,
  ImportProgress,
} from './types';

// Re-export types for consumers
export type { ImportError, ImportOptions, ImportProgress } from './types';

// ---------------------------------------------------------------------------
// Worker factory type
// ---------------------------------------------------------------------------

/**
 * Factory function that creates a Comlink-wrapped EDF parser worker.
 * Injected to keep the service testable without real Web Workers.
 */
export type EDFWorkerFactory = () => WrappedWorker<EDFParserWorkerAPI>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Regex for ResMed EDF filenames: `{YYYYMMDD}_{HHMMSS}_{TYPE}.edf` */
const RESMED_FILENAME_RE = /^(\d{8}_\d{6})_([A-Z]{2,3})\.edf$/i;

/** Regex for the day-folder pattern (YYYYMMDD). */
const DAY_FOLDER_RE = /^\d{8}$/;

/** Known EDF file type suffixes. */
const KNOWN_TYPES = new Set<string>(['BRP', 'EVE', 'PLD', 'SAD', 'CSL']);

/** Maximum allowed file size (100 MB). Prevents excessive memory allocation. */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

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
    const progress = this.createInitialProgress();

    const emit = (patch: Partial<ImportProgress>): void => {
      Object.assign(progress, patch);
      options.onProgress?.({ ...progress });
    };

    emit({ status: 'scanning', startTime: Date.now() });

    // --- 1. Scan & classify -----------------------------------------------
    const discovered = this.scanFiles(files);
    const totalBytes = discovered.reduce((sum, f) => sum + f.file.size, 0);
    emit({ totalFiles: discovered.length, totalBytes });

    if (discovered.length === 0) {
      return this.buildImportRecord([], 0, 0, [], progress);
    }

    // --- 2. Parse via worker ----------------------------------------------
    emit({ status: 'parsing' });

    const fileHashes = new Map<string, string>();
    const interpretations = new Map<string, ResMedInterpretation>();
    const signalDataByFile = new Map<string, ReadonlyMap<string, StandardChannel>>();
    const errors: ImportError[] = [];
    const warnings: string[] = [];
    let bytesRead = 0;

    // Load existing session hashes for deduplication
    const existingHashes = skipDuplicates ? await this.loadExistingHashes() : new Set<string>();

    const worker = this.workerFactory();
    try {
      for (let fileIdx = 0; fileIdx < discovered.length; fileIdx++) {
        const df = discovered[fileIdx];
        if (!df) continue;
        try {
          emit({
            currentFileName: df.relativePath,
            currentStage: `Parsing file ${fileIdx + 1} of ${discovered.length}`,
          });

          if (df.file.size > MAX_FILE_SIZE) {
            errors.push({
              fileName: df.relativePath,
              error: `File exceeds maximum size of 100 MB (${(df.file.size / 1024 / 1024).toFixed(1)} MB)`,
              recoverable: true,
            });
            continue;
          }

          const buffer = await df.file.arrayBuffer();
          bytesRead += buffer.byteLength;

          // Compute per-file SHA-256
          const hash = await this.computeHash(buffer);
          fileHashes.set(df.relativePath, hash);

          // Parse via worker
          const result: ParseResult = await worker.proxy.parseEDFFile(buffer);

          // Collect validation issues
          if (!result.validation.isValid) {
            for (const err of result.validation.errors) {
              warnings.push(`${df.relativePath}: ${err.message}`);
            }
          }
          for (const w of result.validation.warnings) {
            warnings.push(`${df.relativePath}: ${w.message}`);
          }

          interpretations.set(df.relativePath, result.interpretation);

          // Track channel data for OPFS storage
          const channelMap = new Map<string, StandardChannel>();
          for (const ch of result.interpretation.channels) {
            channelMap.set(ch.name, ch);
          }
          signalDataByFile.set(df.relativePath, channelMap);
        } catch (err) {
          errors.push({
            fileName: df.relativePath,
            error: err instanceof Error ? err.message : String(err),
            recoverable: true,
          });
        }

        emit({
          filesProcessed: progress.filesProcessed + 1,
          bytesRead,
          errors: [...errors],
          warnings: [...warnings],
        });
      }
    } finally {
      worker.dispose();
    }

    // --- 3. Group & build sessions ----------------------------------------
    const dayGroups = this.groupByDay(discovered);
    emit({
      status: 'building',
      currentStage: 'Building sessions from parsed data...',
      totalDayGroups: dayGroups.length,
      dayGroupsProcessed: 0,
    });

    const allBuildResults: BuildResult[] = [];
    /** Maps session ID → set of file relative paths that contributed. */
    const sessionFileMap = new Map<string, Set<string>>();

    for (let i = 0; i < dayGroups.length; i++) {
      const dayGroup = dayGroups[i];
      if (!dayGroup) continue;
      try {
        const dayInterpretations = this.collectDayInterpretations(dayGroup, interpretations);
        if (dayInterpretations.length === 0) continue;

        const results = this.sessionBuilder.buildSessions(dayInterpretations);

        // Map each build result back to contributing files for sourceHash
        for (const result of results) {
          const contributingFiles = this.findContributingFiles(dayGroup, interpretations, result);
          sessionFileMap.set(result.session.id, contributingFiles);
          allBuildResults.push(result);
        }
      } catch (err) {
        errors.push({
          fileName: dayGroup.dayFolder,
          error: `Session build failed: ${err instanceof Error ? err.message : String(err)}`,
          recoverable: true,
        });
      }

      emit({
        dayGroupsProcessed: i + 1,
        currentStage: `Building sessions: day ${i + 1} of ${dayGroups.length}`,
      });

      // Yield to the browser every 5 day groups so the UI can repaint
      if ((i + 1) % 5 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // --- 4. Validate built sessions ---------------------------------------
    emit({ currentStage: 'Validating sessions...', sessionsValidated: 0 });

    for (let i = 0; i < allBuildResults.length; i++) {
      const br = allBuildResults[i];
      if (!br) continue;
      const sessionValidation = this.validator.validateSession(br);
      for (const w of sessionValidation.warnings) {
        warnings.push(`Session ${br.session.date}: ${w.message}`);
      }
      for (const e of sessionValidation.errors) {
        warnings.push(`Session ${br.session.date} [error]: ${e.message}`);
      }
      emit({ sessionsValidated: i + 1 });
    }

    // --- 5. Store ---------------------------------------------------------
    emit({
      status: 'storing',
      totalSessionsToStore: allBuildResults.length,
      sessionsStored: 0,
      currentStage: 'Storing sessions...',
    });

    let sessionsCreated = 0;
    let sessionsSkipped = 0;
    const allFileHashes: string[] = [];

    for (let storeIdx = 0; storeIdx < allBuildResults.length; storeIdx++) {
      const br = allBuildResults[storeIdx];
      if (!br) continue;
      try {
        // Compute session sourceHash from contributing file hashes
        const contributing = sessionFileMap.get(br.session.id) ?? new Set<string>();
        const sortedPaths = [...contributing].sort();
        const combinedHash = sortedPaths.map((p) => fileHashes.get(p) ?? '').join(':');
        const sessionSourceHash = await this.computeStringHash(combinedHash);
        allFileHashes.push(sessionSourceHash);

        // Deduplication check
        if (skipDuplicates && existingHashes.has(sessionSourceHash)) {
          warnings.push(`Session ${br.session.date}: skipped (duplicate)`);
          sessionsSkipped++;
          emit({
            sessionsStored: storeIdx + 1,
            currentStage: `Storing session ${storeIdx + 1} of ${allBuildResults.length}`,
          });
          continue;
        }

        // Patch sourceHash on the session (SessionBuilder uses a placeholder)
        const sessionWithHash = { ...br.session, sourceHash: sessionSourceHash };

        await this.storeSession(
          { ...br, session: sessionWithHash },
          signalDataByFile,
          contributing,
        );
        sessionsCreated++;
        emit({
          sessionsCreated,
          sessionsStored: storeIdx + 1,
          currentStage: `Storing session ${storeIdx + 1} of ${allBuildResults.length}`,
        });
      } catch (err) {
        errors.push({
          fileName: `session-${br.session.date}`,
          error: `Storage failed: ${err instanceof Error ? err.message : String(err)}`,
          recoverable: true,
        });
        emit({
          sessionsStored: storeIdx + 1,
          currentStage: `Storing session ${storeIdx + 1} of ${allBuildResults.length}`,
        });
      }
    }

    // --- 6. Report --------------------------------------------------------
    emit({ status: 'complete', errors: [...errors], warnings: [...warnings] });

    const overallHash = await this.computeStringHash(allFileHashes.sort().join(':'));
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

  /** Collect all interpretations that belong to a day group. */
  private collectDayInterpretations(
    dayGroup: DayFileGroup,
    allInterpretations: Map<string, ResMedInterpretation>,
  ): ResMedInterpretation[] {
    const result: ResMedInterpretation[] = [];
    for (const filesInTimestamp of dayGroup.files.values()) {
      for (const df of filesInTimestamp) {
        const interp = allInterpretations.get(df.relativePath);
        if (interp) result.push(interp);
      }
    }
    return result;
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

  /** Store a single session's metadata + signal data. */
  private async storeSession(
    buildResult: BuildResult,
    signalDataByFile: Map<string, ReadonlyMap<string, StandardChannel>>,
    contributingFiles: Set<string>,
  ): Promise<void> {
    const { session, aggregate, events } = buildResult;

    // Store metadata in IndexedDB
    await this.indexedDB.addSession(session);

    const storedAggregate: StoredNightlyAggregate = {
      ...aggregate,
      machineId: session.machineId,
    };
    await this.indexedDB.addNightlyAggregate(storedAggregate);

    if (events.length > 0) {
      await this.indexedDB.addEvents(events);
    }

    // Store signal data in OPFS (if available)
    if (this.opfs) {
      const mergedChannels = new Map<string, StandardChannel>();
      for (const filePath of contributingFiles) {
        const channels = signalDataByFile.get(filePath);
        if (!channels) continue;
        for (const [name, ch] of channels) {
          const existing = mergedChannels.get(name);
          if (!existing || ch.samples.length > existing.samples.length) {
            mergedChannels.set(name, ch);
          }
        }
      }

      // Convert StandardChannels to ChannelInput for chunked OPFS storage
      const channelInputs: ChannelInput[] = [];
      for (const [, channel] of mergedChannels) {
        channelInputs.push({
          name: channel.name,
          sampleRate: channel.sampleRate,
          unit: channel.unit,
          physicalMin: channel.metadata.physicalMin,
          physicalMax: channel.metadata.physicalMax,
          data: channel.samples,
        });
      }

      if (channelInputs.length > 0) {
        const startMs = new Date(session.startTime).getTime();
        const endMs = new Date(session.endTime).getTime();
        await this.opfs.writeSession(session.id, startMs, endMs, channelInputs);
      }
    }
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

  /** Load all existing session sourceHashes into a Set for dedup lookup. */
  private async loadExistingHashes(): Promise<Set<string>> {
    const sessions = await this.indexedDB.getAllSessions();
    return new Set(sessions.map((s) => s.sourceHash));
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
