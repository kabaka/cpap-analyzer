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
