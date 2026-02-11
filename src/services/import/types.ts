/**
 * Import pipeline types.
 *
 * Shared interfaces for the import service, progress tracking,
 * and file classification. Framework-agnostic — no React dependencies.
 *
 * @module services/import/types
 */

/** How the import data was provided by the user. */
export type ImportSourceType = 'sd-card' | 'folder' | 'file';

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
}

/** A single error encountered during import. */
export interface ImportError {
  readonly fileName: string;
  readonly error: string;
  readonly recoverable: boolean;
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
