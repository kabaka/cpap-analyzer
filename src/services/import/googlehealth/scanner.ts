/**
 * Directory scanner for Google Health (Fitbit) data exports.
 *
 * Scans a user-selected `FileSystemDirectoryHandle` to discover available
 * data types, file counts, and estimated date ranges — without reading file
 * contents. This is the first step in the Google Health import pipeline.
 *
 * ## Root resolution
 *
 * The user may select:
 * 1. The exact export directory (containing `Sleep`, `Heart Rate`, etc.)
 * 2. A parent with a `Google Health/` subfolder
 * 3. A `Takeout/` folder containing `Google Health/`
 *
 * The scanner tries all three automatically.
 *
 * @module services/import/googlehealth/scanner
 */

import type {
  FitbitDataType,
  GoogleHealthDataTypeInfo,
  GoogleHealthScanResult,
} from '@/types/fitbit';
import { FITBIT_DATA_TYPE_LABEL, FITBIT_DATA_TYPE_TIER } from '@/types/fitbit';

// ---------------------------------------------------------------------------
// Known data-type source mappings
// ---------------------------------------------------------------------------

interface DataTypeSource {
  readonly dataType: FitbitDataType;
  readonly pattern: RegExp;
  readonly tier: 1 | 2 | 3 | 4;
}

/**
 * Maps top-level Google Health directory names to the data types they contain
 * and the filename patterns used to identify source files.
 */
const DATA_TYPE_SOURCES: Readonly<Record<string, readonly DataTypeSource[]>> = {
  Sleep: [
    {
      dataType: 'sleep_session',
      pattern: /^sleep-\d{4}-\d{2}-\d{2}\.json$/,
      tier: 1,
    },
  ],
  'Sleep Score': [
    {
      dataType: 'sleep_score',
      pattern: /^sleep_score\.csv$/,
      tier: 1,
    },
  ],
  'Oxygen Saturation (SpO2)': [
    {
      dataType: 'spo2_daily',
      pattern: /^Daily SpO2 - .*\.csv$/,
      tier: 1,
    },
    {
      dataType: 'spo2_intraday',
      pattern: /^Minute SpO2 - .*\.csv$/,
      tier: 1,
    },
  ],
  'Heart Rate Variability': [
    {
      dataType: 'hrv_daily',
      pattern: /^Daily Heart Rate Variability Summary - .*\.csv$/,
      tier: 2,
    },
    {
      dataType: 'hrv_detail',
      pattern: /^Heart Rate Variability Details - .*\.csv$/,
      tier: 2,
    },
    {
      dataType: 'respiratory_rate',
      pattern: /^Daily Respiratory Rate Summary - .*\.csv$/,
      tier: 1,
    },
  ],
  'Heart Rate': [
    {
      dataType: 'heart_rate_resting',
      pattern: /^heart_rate-\d{4}-\d{2}-\d{2}\.json$/,
      tier: 2,
    },
  ],
  'Global Export Data': [
    {
      dataType: 'heart_rate_resting',
      pattern: /^resting_heart_rate-\d{4}-\d{2}-\d{2}\.json$/,
      tier: 2,
    },
    {
      // Intraday (≈5-second cadence) heart rate. Distinct from the `Heart Rate`
      // directory's daily resting-HR `heart_rate-*.json`: this one lives under
      // `Global Export Data` and its files are large JSON arrays of per-sample
      // { dateTime, value: { bpm, confidence } } objects.
      dataType: 'heart_rate_intraday',
      pattern: /^heart_rate-\d{4}-\d{2}-\d{2}\.json$/,
      tier: 2,
    },
  ],
  'Daily Readiness': [
    {
      dataType: 'readiness',
      pattern: /^Daily Readiness Score - .*\.csv$/,
      tier: 2,
    },
  ],
  'Stress Score': [
    {
      dataType: 'stress',
      pattern: /^Stress Score\.csv$/,
      tier: 2,
    },
  ],
  Temperature: [
    {
      dataType: 'temperature',
      pattern: /^Computed Temperature - .*\.csv$/,
      tier: 2,
    },
  ],
  'Active Zone Minutes (AZM)': [
    {
      dataType: 'activity_daily',
      pattern: /^Active Zone Minutes - .*\.csv$/,
      tier: 3,
    },
  ],
  'Snore and Noise Detect': [
    {
      dataType: 'snoring_daily',
      pattern: /^Snore Details - .*\.csv$/,
      tier: 4,
    },
    {
      dataType: 'snoring_segments',
      pattern: /^Snore Details - .*\.csv$/,
      tier: 4,
    },
  ],
};

/** Directory names that positively identify a Google Health export root. */
const KNOWN_SUBDIRS = new Set(Object.keys(DATA_TYPE_SOURCES));

/** Minimum number of known subdirectories to consider a directory the root. */
const MIN_KNOWN_SUBDIRS = 2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan a user-selected directory for Google Health (Fitbit) export data.
 *
 * Resolves the true export root, enumerates files per data type, estimates
 * date ranges from filenames, and returns a summary that can be displayed
 * in the import wizard before the user commits to a full parse.
 *
 * @param dirHandle - `FileSystemDirectoryHandle` from `showDirectoryPicker`.
 * @param onProgress - Optional progress callback for UI feedback.
 * @returns Scan result with discovered data types and metadata.
 */
export async function scanGoogleHealthExport(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: (message: string) => void,
): Promise<GoogleHealthScanResult> {
  onProgress?.('Locating Google Health export root…');

  const root = await resolveRoot(dirHandle);
  if (!root) {
    return emptyScanResult();
  }

  onProgress?.('Enumerating data files…');

  // Accumulate per-data-type results. Use a Map so that duplicate data types
  // (e.g. resting HR found in both Heart Rate and Global Export Data) merge.
  const typeMap = new Map<FitbitDataType, MutableDataTypeInfo>();
  let totalFileCount = 0;
  let totalEstimatedSize = 0;

  for (const [dirName, sources] of Object.entries(DATA_TYPE_SOURCES)) {
    let subDir: FileSystemDirectoryHandle;
    try {
      subDir = await root.getDirectoryHandle(dirName);
    } catch {
      // Directory not present — skip.
      continue;
    }

    onProgress?.(`Scanning ${dirName}…`);

    const fileEntries = await listFiles(subDir);

    for (const source of sources) {
      const matchingFiles: string[] = [];
      let estimatedSize = 0;

      for (const entry of fileEntries) {
        if (source.pattern.test(entry.name)) {
          matchingFiles.push(`${dirName}/${entry.name}`);
          // Use the File API's `size` property for estimates when available.
          // File System Access API's FileSystemFileHandle has no sync size,
          // so we estimate based on filename count (sizes measured during parse).
          estimatedSize += entry.estimatedSize;
        }
      }

      if (matchingFiles.length === 0) continue;

      const dateRange = estimateDateRangeFromFilenames(matchingFiles);

      const existing = typeMap.get(source.dataType);
      if (existing) {
        // Merge additional files into the existing entry.
        existing.files.push(...matchingFiles);
        existing.recordCount += matchingFiles.length;
        existing.estimatedSizeBytes += estimatedSize;
        if (dateRange) {
          if (!existing.dateRange) {
            existing.dateRange = dateRange;
          } else {
            if (dateRange.start < existing.dateRange.start) {
              existing.dateRange.start = dateRange.start;
            }
            if (dateRange.end > existing.dateRange.end) {
              existing.dateRange.end = dateRange.end;
            }
          }
        }
      } else {
        typeMap.set(source.dataType, {
          dataType: source.dataType,
          tier: source.tier,
          label: FITBIT_DATA_TYPE_LABEL[source.dataType],
          recordCount: matchingFiles.length,
          dateRange: dateRange ? { start: dateRange.start, end: dateRange.end } : null,
          estimatedSizeBytes: estimatedSize,
          files: [...matchingFiles],
        });
      }

      totalFileCount += matchingFiles.length;
      totalEstimatedSize += estimatedSize;
    }
  }

  // Also check for Physical Activity fallback directory
  try {
    const activityDir = await root.getDirectoryHandle('Physical Activity_GoogleData');
    onProgress?.('Scanning Physical Activity fallback data…');
    const activityFiles = await listFiles(activityDir);
    // These CSVs are consolidated single-file backups; count but don't
    // add them as primary sources unless the AZM directory was empty.
    if (!typeMap.has('activity_daily') && activityFiles.length > 0) {
      const csvFiles = activityFiles.filter((f) => f.name.endsWith('.csv'));
      if (csvFiles.length > 0) {
        const estimatedSize = csvFiles.reduce((sum, f) => sum + f.estimatedSize, 0);
        typeMap.set('activity_daily', {
          dataType: 'activity_daily',
          tier: FITBIT_DATA_TYPE_TIER['activity_daily'],
          label: FITBIT_DATA_TYPE_LABEL['activity_daily'],
          recordCount: csvFiles.length,
          dateRange: null,
          estimatedSizeBytes: estimatedSize,
          files: csvFiles.map((f) => `Physical Activity_GoogleData/${f.name}`),
        });
        totalFileCount += csvFiles.length;
        totalEstimatedSize += estimatedSize;
      }
    }
  } catch {
    // Physical Activity directory not found — fine.
  }

  const dataTypes: GoogleHealthDataTypeInfo[] = [...typeMap.values()]
    .sort((a, b) => a.tier - b.tier || a.label.localeCompare(b.label))
    .map((info) => ({
      dataType: info.dataType,
      tier: info.tier,
      label: info.label,
      recordCount: info.recordCount,
      dateRange: info.dateRange ? { start: info.dateRange.start, end: info.dateRange.end } : null,
      estimatedSizeBytes: info.estimatedSizeBytes,
      files: info.files,
    }));

  const overallRange = computeOverallDateRange(dataTypes);

  onProgress?.('Scan complete.');

  return {
    dataTypes,
    dateRange: overallRange,
    deviceInfo: null, // Could be extracted from profile.json if present
    totalFileCount,
    estimatedSizeBytes: totalEstimatedSize,
  };
}

// ---------------------------------------------------------------------------
// Root resolution
// ---------------------------------------------------------------------------

/**
 * Find the actual Google Health export root within the user-selected
 * directory, handling the three common cases:
 *
 * 1. The selected directory IS the root (contains known subdirs like `Sleep`)
 * 2. The root is at `<selected>/Google Health/`
 * 3. The root is at `<selected>/Takeout/Google Health/`
 */
export async function resolveRoot(
  dirHandle: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle | null> {
  // Case 1: check if the selected directory itself is the root
  if (await isGoogleHealthRoot(dirHandle)) {
    return dirHandle;
  }

  // Case 2: check for a `Google Health` subfolder
  try {
    const ghDir = await dirHandle.getDirectoryHandle('Google Health');
    if (await isGoogleHealthRoot(ghDir)) {
      return ghDir;
    }
  } catch {
    // Not found — try next case.
  }

  // Case 3: check for `Takeout/Google Health`
  try {
    const takeoutDir = await dirHandle.getDirectoryHandle('Takeout');
    const ghDir = await takeoutDir.getDirectoryHandle('Google Health');
    if (await isGoogleHealthRoot(ghDir)) {
      return ghDir;
    }
  } catch {
    // Not found.
  }

  // Case 4: Takeout with variant naming (Fitbit)
  try {
    const takeoutDir = await dirHandle.getDirectoryHandle('Takeout');
    const fitbitDir = await takeoutDir.getDirectoryHandle('Fitbit');
    if (await isGoogleHealthRoot(fitbitDir)) {
      return fitbitDir;
    }
  } catch {
    // Not found.
  }

  return null;
}

/**
 * Test whether a directory contains enough known Google Health subdirectories
 * to be considered the export root.
 */
async function isGoogleHealthRoot(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
  let matchCount = 0;
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'directory' && KNOWN_SUBDIRS.has(entry.name)) {
      matchCount += 1;
      if (matchCount >= MIN_KNOWN_SUBDIRS) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// File enumeration
// ---------------------------------------------------------------------------

interface FileEntry {
  readonly name: string;
  readonly estimatedSize: number;
}

/**
 * List all files in a directory (non-recursive, flat).
 * Estimates file size from the file handle when possible.
 */
async function listFiles(dirHandle: FileSystemDirectoryHandle): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];

  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      // Attempt to get the File to read its size
      let estimatedSize = 0;
      try {
        const file = await entry.getFile();
        estimatedSize = file.size;
      } catch {
        // Cannot access file size — use zero as fallback.
      }
      entries.push({ name: entry.name, estimatedSize });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Date-range estimation
// ---------------------------------------------------------------------------

/** Regex for extracting a YYYY-MM-DD date from filenames. */
const FILENAME_DATE_RE = /(\d{4}-\d{2}-\d{2})/;

/** Regex for extracting a date like "2024-10-15" from CSV-style filenames. */
const CSV_FILENAME_DATE_RE =
  /(\d{4}-\d{2}-\d{2})|(\w+ \d{4}-\d{2}-\d{2})|(?:- )(\d{4}-\d{2}-\d{2})/;

/**
 * Estimate the date range covered by a set of filenames.
 * Extracts YYYY-MM-DD dates from filename patterns. Returns null if no
 * dates can be extracted.
 */
function estimateDateRangeFromFilenames(
  filenames: string[],
): { start: string; end: string } | null {
  const dates: string[] = [];

  for (const name of filenames) {
    const match = FILENAME_DATE_RE.exec(name) ?? CSV_FILENAME_DATE_RE.exec(name);
    if (match) {
      // First captured group that contains a date
      const date = match[1] ?? match[2] ?? match[3];
      if (date) {
        dates.push(date);
      }
    }
  }

  if (dates.length === 0) return null;

  dates.sort();
  const start = dates[0];
  const end = dates[dates.length - 1];
  if (!start || !end) return null;
  return { start, end };
}

/**
 * Compute the overall date range across all data types.
 */
function computeOverallDateRange(
  dataTypes: readonly GoogleHealthDataTypeInfo[],
): { readonly start: string; readonly end: string } | null {
  let start: string | null = null;
  let end: string | null = null;

  for (const dt of dataTypes) {
    if (!dt.dateRange) continue;
    if (start === null || dt.dateRange.start < start) {
      start = dt.dateRange.start;
    }
    if (end === null || dt.dateRange.end > end) {
      end = dt.dateRange.end;
    }
  }

  if (start === null || end === null) return null;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mutable version of GoogleHealthDataTypeInfo used during scan accumulation. */
interface MutableDataTypeInfo {
  readonly dataType: FitbitDataType;
  readonly tier: 1 | 2 | 3 | 4;
  readonly label: string;
  recordCount: number;
  dateRange: { start: string; end: string } | null;
  estimatedSizeBytes: number;
  readonly files: string[];
}

function emptyScanResult(): GoogleHealthScanResult {
  return {
    dataTypes: [],
    dateRange: null,
    deviceInfo: null,
    totalFileCount: 0,
    estimatedSizeBytes: 0,
  };
}
