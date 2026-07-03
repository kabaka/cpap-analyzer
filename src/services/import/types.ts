/**
 * Import pipeline types.
 *
 * Shared interfaces for the import service, progress tracking,
 * and file classification. Framework-agnostic — no React dependencies.
 *
 * @module services/import/types
 */

/** How the import data was provided by the user. */
export type ImportSourceType = 'sd-card' | 'folder' | 'file' | 'google-health';

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

/** Observable state of an in-progress import operation. */
export interface ImportProgress {
  readonly status: 'idle' | 'scanning' | 'parsing' | 'building' | 'storing' | 'complete' | 'error';
  readonly totalFiles: number;
  readonly filesProcessed: number;
  readonly currentFileName: string;
  readonly bytesRead: number;
  readonly totalBytes: number;
  readonly sessionsCreated: number;
  readonly errors: readonly ImportError[];
  readonly startTime: number;
  readonly warnings: readonly string[];
  /** Current sub-stage description for user feedback during long operations */
  readonly currentStage: string;
  /** Number of day groups processed during building stage */
  readonly dayGroupsProcessed: number;
  /** Total number of day groups to process during building stage */
  readonly totalDayGroups: number;
  /** Number of sessions validated so far */
  readonly sessionsValidated: number;
  /** Number of sessions stored so far */
  readonly sessionsStored: number;
  /** Total sessions to store */
  readonly totalSessionsToStore: number;
  /**
   * Number of discovered EDF files that parsed to an empty (header-only) stub
   * and were skipped without error (e.g. CSL files on nights with no
   * Cheyne-Stokes events). Distinct from {@link errors}.
   */
  readonly filesSkippedEmpty: number;
}

/** A single error encountered during import. */
export interface ImportError {
  readonly fileName: string;
  readonly error: string;
  readonly recoverable: boolean;
}

// ---------------------------------------------------------------------------
// Unified, serializable job-progress model (ADR 0026)
// ---------------------------------------------------------------------------
//
// `ImportJobProgress` is the SINGLE, structured-clone-safe progress contract
// published to `useImportStore`. It deliberately contains NO `Date`s,
// functions, or class instances — only primitives, plain objects, and frozen
// arrays — so it can be cloned across realms (and snapshotted defensively)
// without surprises.
//
// The two services keep emitting their own internal shapes
// ({@link ImportProgress} / {@link GoogleHealthImportProgress}); the
// ImportController adapts those to `ImportJobProgress` at its boundary.

/** Lifecycle state of a whole import job (kind-agnostic). */
export type ImportJobStatus = 'idle' | 'scanning' | 'running' | 'complete' | 'error' | 'cancelled';

/** Visual/lifecycle state of a single pipeline stage. */
export type StageState = 'pending' | 'active' | 'done' | 'warning' | 'error' | 'skipped';

/** Unit of measure for a stage's `completed`/`total` counters. */
export type StageUnit = 'files' | 'records' | 'sessions' | 'bytes' | 'days';

/** Progress of a single nested sub-item within a stage (e.g. a Fitbit data type). */
export interface SubItemProgress {
  readonly id: string;
  readonly label: string;
  readonly state: StageState;
  readonly completed: number;
  /** `null` when the total is not yet known (indeterminate). */
  readonly total: number | null;
}

/** Progress of a single top-level pipeline stage. */
export interface StageProgress {
  readonly id: string;
  readonly label: string;
  readonly state: StageState;
  /** Whether `total` is known; when `false` the stage renders as indeterminate. */
  readonly determinate: boolean;
  readonly completed: number;
  /** `null` when indeterminate. */
  readonly total: number | null;
  readonly unit: StageUnit;
  readonly subItems?: readonly SubItemProgress[];
}

/** A capped, serializable record of a recent per-file/per-record error. */
export interface RecentImportError {
  readonly fileName: string;
  readonly error: string;
}

/**
 * Unified, serializable progress snapshot for one import job.
 *
 * All timestamps are epoch-milliseconds numbers. Arrays are treated as
 * immutable (frozen by the controller). Safe to `structuredClone`.
 */
export interface ImportJobProgress {
  readonly jobId: string;
  readonly kind: 'cpap' | 'fitbit';
  readonly status: ImportJobStatus;
  readonly stages: readonly StageProgress[];
  /** The id of the currently active stage, or `null` when none is active. */
  readonly activeStageId: string | null;
  /** Epoch-ms when the job started (0 before it starts). */
  readonly startedAtMs: number;
  readonly bytesProcessed: number;
  /** `null` when the byte total is unknown. */
  readonly bytesTotal: number | null;
  readonly itemsProcessed: number;
  /** `null` when the item total is unknown. */
  readonly itemsTotal: number | null;
  /** Smoothed items-per-second throughput, or `null` until enough samples. */
  readonly throughputPerSec: number | null;
  /** Estimated milliseconds remaining, or `null` while indeterminate. */
  readonly etaMs: number | null;
  readonly errorCount: number;
  readonly warningCount: number;
  /** Most recent errors, CAPPED (see {@link RECENT_ERRORS_CAP}). */
  readonly recentErrors: readonly RecentImportError[];
  /** Human-readable label for the current activity. */
  readonly currentLabel: string;
}

/** Maximum number of {@link RecentImportError}s retained in a snapshot. */
export const RECENT_ERRORS_CAP = 20;

// ---------------------------------------------------------------------------
// Google Health import progress
// ---------------------------------------------------------------------------

/** Observable state of an in-progress Google Health import. */
export interface GoogleHealthImportProgress {
  readonly status: 'idle' | 'scanning' | 'parsing' | 'storing' | 'complete' | 'error';
  readonly currentDataType: string;
  readonly dataTypesTotal: number;
  readonly dataTypesProcessed: number;
  readonly recordsProcessed: number;
  readonly recordsTotal: number;
  readonly recordsSkipped: number;
  readonly errors: readonly ImportError[];
  readonly warnings: readonly string[];
  readonly startTime: number;
  readonly currentStage: string;
  // -------------------------------------------------------------------------
  // Granular per-data-type progress (ADR 0027, additive)
  // -------------------------------------------------------------------------
  //
  // These OPTIONAL fields give the controller adapter determinate within-type
  // record progress so the unified `ImportJobProgress` can show e.g. the
  // intraday-HR substage as a live bar instead of a multi-minute freeze. They
  // describe the CURRENTLY-active data type only; `dataTypesProcessed` /
  // `dataTypesTotal` continue to describe the across-type position.
  //
  // For heavy worker-parsed types these reflect the parse phase (entries
  // decoded). For light/inline types they may be omitted (left undefined),
  // in which case the adapter falls back to the coarse per-type counters.

  /** Human-readable label of the current data type (e.g. "Heart Rate (intraday)"). */
  readonly currentDataTypeLabel?: string;
  /**
   * Records (entries/rows/samples) processed for the CURRENT data type so far.
   * Determinate within-type progress for the active substage.
   */
  readonly currentDataTypeRecordsProcessed?: number;
  /**
   * Total records to process for the CURRENT data type. `0`/undefined means the
   * total is not yet known (indeterminate substage).
   */
  readonly currentDataTypeRecordsTotal?: number;
  /** Phase of the current data type: parsing files vs. storing records. */
  readonly currentDataTypePhase?: 'parsing' | 'storing';
}

// ---------------------------------------------------------------------------
// Import options
// ---------------------------------------------------------------------------

/** Configuration for an import operation. */
export interface ImportOptions {
  readonly sourceType: ImportSourceType;
  /** Skip files/sessions that have already been imported. @default true */
  readonly skipDuplicates?: boolean;
  /** Progress callback invoked at each stage transition and per file. */
  readonly onProgress?: (progress: ImportProgress) => void;
  /**
   * When aborted, the pipeline stops at the next {@link checkpoint} boundary by
   * throwing {@link ImportAbortedError}. Abort only ever lands at loop-boundary
   * yield points — never mid-IndexedDB-transaction / mid-OPFS-write — so storage
   * stays consistent (per-day/per-batch writes are idempotent via dedup).
   */
  readonly signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Cancellation primitives (ADR 0026)
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link checkpoint} when an import's {@link AbortSignal} has fired.
 *
 * Typed so the controller/hooks can distinguish a deliberate cancellation from
 * a genuine failure and map it to the `cancelled` status rather than `error`.
 */
export class ImportAbortedError extends Error {
  constructor(message = 'Import cancelled') {
    super(message);
    this.name = 'ImportAbortedError';
    // Restore prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, ImportAbortedError.prototype);
  }
}

/** Type guard for {@link ImportAbortedError}, robust across realms. */
export function isImportAbortedError(err: unknown): err is ImportAbortedError {
  return (
    err instanceof ImportAbortedError ||
    (typeof err === 'object' && err !== null && (err as Error).name === 'ImportAbortedError')
  );
}

/**
 * Yield to the event loop AND honour cancellation.
 *
 * Drop-in replacement for the services' previous `yieldToEventLoop()` calls. It
 * (1) yields so the UI can repaint, then (2) throws {@link ImportAbortedError}
 * if `signal` is aborted. Placed only at existing loop-boundary yield points so
 * the throw unwinds cleanly between idempotent units of work.
 */
export async function checkpoint(signal?: AbortSignal): Promise<void> {
  // Fast-fail before yielding so an already-aborted job stops immediately.
  if (signal?.aborted) {
    throw new ImportAbortedError();
  }

  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sched?.yield) {
    await sched.yield();
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (signal?.aborted) {
    throw new ImportAbortedError();
  }
}

// ---------------------------------------------------------------------------
// File discovery / classification
// ---------------------------------------------------------------------------

/** Recognised EDF file type suffixes from ResMed file naming convention. */
export type EDFFileType = 'BRP' | 'EVE' | 'PLD' | 'SAD' | 'CSL' | 'STR' | 'unknown';

/** Metadata about a single EDF file discovered during scanning. */
export interface DiscoveredFile {
  readonly file: File;
  /** Path relative to the import root (e.g. "DATALOG/20241015/20241015_220145_BRP.edf"). */
  readonly relativePath: string;
  /** Parent day-folder name (e.g. "20241015"). */
  readonly dayFolder: string;
  /** Recognised file type suffix. */
  readonly fileType: EDFFileType;
  /** Timestamp prefix from filename (e.g. "20241015_220145"). */
  readonly timestamp: string;
}

/** All discovered files within a single day folder, grouped by timestamp. */
export interface DayFileGroup {
  readonly dayFolder: string;
  /** Map from timestamp string to the set of files sharing that timestamp. */
  readonly files: Map<string, DiscoveredFile[]>;
}
