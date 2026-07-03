/**
 * Regression tests for compound-key uniqueness handling in the Google Health
 * import pipeline.
 *
 * Background: imports were surfacing user-facing errors of the form
 *   `temperature/2025-09-30 — Storage failed: ... Unable to add key to index
 *   'source_dataType_date': at least one key does not satisfy the uniqueness
 *   requirements.`
 *
 * Two root causes were fixed in `GoogleHealthImportService` and are pinned here:
 *
 *  (A) Intra-import duplicate dates. Within a SINGLE dataType's parsed records,
 *      two records sharing the same `(source, dataType, date)` compound key were
 *      both queued into one batch before any DB write, violating the unique
 *      `source_dataType_date` index. A per-call `seenKeys` set now skips the
 *      later occurrence (first-occurrence-wins), counting it as `skipped` rather
 *      than erroring — independent of the `skipDuplicates` option. We drive this
 *      through the public `import()` API using the `temperature` parser, which
 *      emits one record PER CSV ROW (no intra-file grouping), so two rows on the
 *      same calendar date produce two same-date records in one parse result.
 *
 *  (B) Robust constraint detection. `isConstraintError` now classifies a
 *      uniqueness violation by `DOMException.name === 'ConstraintError'`
 *      (including when wrapped in a `StorageError` exposing `originalCause`)
 *      rather than fragile message matching. The one-by-one storage fallback
 *      uses it so genuine duplicates are counted as `skipped`, while non-
 *      constraint storage failures still surface as recoverable `errors`.
 *
 * The mock IndexedDB dedups on `fitbit|dataType|date`, mirroring the production
 * unique index, and lets individual tests force `bulkAdd…` / `add…` rejections
 * to exercise the fallback branch.
 *
 * @module services/import/googlehealth/__tests__/GoogleHealthImportService.dedup
 */

import { describe, it, expect, vi } from 'vitest';

import { GoogleHealthImportService } from '../GoogleHealthImportService';
import { StorageError } from '@/services/storage/IndexedDBService';
import type { IndexedDBService } from '@/services/storage/IndexedDBService';
import type { GoogleHealthScanResult, GoogleHealthDataTypeInfo } from '@/types/fitbit';
import type {
  IntegrationDailySummary,
  IntegrationTimeseries,
  IntegrationImportRecord,
} from '@/types/storage';

// Make `resolveRoot` return the handle we pass straight through, and keep the
// real `scanGoogleHealthExport` untouched (unused here). Files are resolved by
// our mock directory handle (flat layout, names without slashes).
vi.mock('../scanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scanner')>();
  return {
    ...actual,
    resolveRoot: (h: FileSystemDirectoryHandle) => Promise.resolve(h),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a temperature CSV whose rows each map to a `(date, deviation)` record.
 * The temperature parser pushes ONE record per row (no intra-file grouping), so
 * passing two rows with `sleep_start` timestamps on the SAME calendar date
 * yields two same-date records in a single parse result — the exact shape that
 * triggered the `source_dataType_date` uniqueness violation.
 */
function temperatureCsv(rows: { sleepStart: string; deviation: number }[]): string {
  const header = 'sleep_start,nightly_temperature,baseline_relative_sample_sum';
  const body = rows.map((r) => `${r.sleepStart},${String(r.deviation)},0`);
  return [header, ...body].join('\n');
}

/** A File-like object whose bytes/text round-trip the given content under jsdom. */
function makeFile(name: string, content: string): File {
  const bytes = new TextEncoder().encode(content);
  const buffer = bytes.buffer.slice(0) as ArrayBuffer;
  const file = {
    name,
    size: bytes.byteLength,
    type: 'text/csv',
    text: () => Promise.resolve(content),
    arrayBuffer: () => Promise.resolve(buffer.slice(0)),
  };
  return file as unknown as File;
}

// ---------------------------------------------------------------------------
// Mock directory handle (flat: file name -> File)
// ---------------------------------------------------------------------------

function makeDirHandle(files: Map<string, File>): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: 'root',
    getFileHandle: (name: string) => {
      const file = files.get(name);
      if (!file) return Promise.reject(new Error(`no file ${name}`));
      return Promise.resolve({
        kind: 'file',
        name,
        getFile: () => Promise.resolve(file),
      } as unknown as FileSystemFileHandle);
    },
    getDirectoryHandle: () => Promise.reject(new Error('no subdirs')),
  } as unknown as FileSystemDirectoryHandle;
}

// ---------------------------------------------------------------------------
// Mock IndexedDB with real (source, dataType, date)-keyed dedup
// ---------------------------------------------------------------------------

interface MockDB {
  db: IndexedDBService;
  timeseries: Map<string, IntegrationTimeseries>;
  daily: Map<string, IntegrationDailySummary>;
  importRecords: IntegrationImportRecord[];
}

/**
 * Per-record fault injection for the daily store fallback path.
 *
 * - `failBulk`: when true, `bulkAddIntegrationDailySummaries` rejects, forcing
 *   the service into its one-by-one `addIntegrationDailySummary` fallback.
 * - `addError(record)`: optional hook returning the error a given one-by-one
 *   `add…` should reject with (e.g. a `ConstraintError` DOMException, a
 *   `StorageError` wrapping one, or a generic non-constraint failure). Returning
 *   `null`/`undefined` lets the add succeed.
 */
interface DailyFaults {
  readonly failBulk?: boolean;
  readonly addError?: (record: IntegrationDailySummary) => unknown;
}

function createMockDB(faults: DailyFaults = {}): MockDB {
  const timeseries = new Map<string, IntegrationTimeseries>();
  const daily = new Map<string, IntegrationDailySummary>();
  const importRecords: IntegrationImportRecord[] = [];

  const key = (dataType: string, date: string): string => `fitbit|${dataType}|${date}`;

  const db = {
    getIntegrationTimeseriesByKey: (_source: string, dataType: string, date: string) =>
      Promise.resolve(timeseries.get(key(dataType, date))),
    getIntegrationDailySummaryByKey: (_source: string, dataType: string, date: string) =>
      Promise.resolve(daily.get(key(dataType, date))),
    bulkAddIntegrationTimeseries: (records: IntegrationTimeseries[]) => {
      for (const r of records) timeseries.set(key(r.dataType, r.date), r);
      return Promise.resolve();
    },
    addIntegrationTimeseries: (record: IntegrationTimeseries) => {
      timeseries.set(key(record.dataType, record.date), record);
      return Promise.resolve();
    },
    bulkAddIntegrationDailySummaries: (records: IntegrationDailySummary[]) => {
      if (faults.failBulk) {
        return Promise.reject(new Error('synthetic bulk failure (forces fallback)'));
      }
      // Mirror the unique compound index: a duplicate key throws ConstraintError.
      for (const r of records) {
        const k = key(r.dataType, r.date);
        if (daily.has(k)) {
          return Promise.reject(makeConstraintError());
        }
        daily.set(k, r);
      }
      return Promise.resolve();
    },
    addIntegrationDailySummary: (record: IntegrationDailySummary) => {
      const injected = faults.addError?.(record);
      if (injected) {
        return Promise.reject(injected);
      }
      const k = key(record.dataType, record.date);
      if (daily.has(k)) {
        return Promise.reject(makeConstraintError());
      }
      daily.set(k, record);
      return Promise.resolve();
    },
    addIntegrationImportRecord: (record: IntegrationImportRecord) => {
      importRecords.push(record);
      return Promise.resolve();
    },
  } as unknown as IndexedDBService;

  return { db, timeseries, daily, importRecords };
}

/**
 * An IndexedDB uniqueness-violation error as the classifier sees it at runtime:
 * a real `Error` whose `name` is `ConstraintError`. In a browser the IDB request
 * error is a `DOMException` (which IS an `Error` there, and which
 * `StorageError.originalCause` therefore preserves); jsdom's `DOMException` is
 * NOT an `Error`, so we model the cross-realm-stable shape the production code
 * relies on with a real `Error` subclass.
 *
 * Critically, the message contains "uniqueness requirements" but NEITHER
 * "Constraint" NOR "duplicate", so a passing skip can ONLY come from the
 * `name === 'ConstraintError'` classification, not the defensive substring
 * fallback. (The literal `Constraint` in the class name does not appear in the
 * message text.)
 */
class ConstraintError extends Error {
  constructor() {
    super(
      "Unable to add key to index 'source_dataType_date': at least one key does not satisfy the uniqueness requirements.",
    );
    this.name = 'ConstraintError';
  }
}

function makeConstraintError(): Error {
  return new ConstraintError();
}

// ---------------------------------------------------------------------------
// Scan-result helper
// ---------------------------------------------------------------------------

function temperatureScanResult(fileNames: string[], recordCount: number): GoogleHealthScanResult {
  const info: GoogleHealthDataTypeInfo = {
    dataType: 'temperature',
    tier: 2,
    label: 'Temperature',
    recordCount,
    dateRange: null,
    estimatedSizeBytes: 1000,
    files: fileNames,
  };
  return {
    dataTypes: [info],
    dateRange: null,
    deviceInfo: null,
    totalFileCount: fileNames.length,
    estimatedSizeBytes: 1000,
  };
}

/** True if any collected error message implicates a uniqueness/storage failure. */
function hasUniquenessError(record: IntegrationImportRecord): boolean {
  return record.errors.some(
    (e) => e.error.includes('uniqueness') || e.error.includes('Storage failed'),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoogleHealthImportService — compound-key uniqueness handling', () => {
  describe('intra-import duplicate dates within a single parse result', () => {
    it('skips the same-date duplicate instead of erroring on the unique index', async () => {
      // One file, two rows on the SAME calendar date -> two same-date records in
      // a single parse result. Before the fix both were queued into one batch and
      // the unique `source_dataType_date` index rejected the second with a
      // `Storage failed: ... uniqueness requirements` error.
      const csv = temperatureCsv([
        { sleepStart: '2025-09-30T22:00:00', deviation: -0.3 },
        { sleepStart: '2025-09-30T23:45:00', deviation: 0.1 },
      ]);
      const files = new Map<string, File>([['temp.csv', makeFile('temp.csv', csv)]]);
      const fileNames = [...files.keys()];

      const mock = createMockDB();
      const service = new GoogleHealthImportService(mock.db);

      const record = await service.import(
        makeDirHandle(files),
        temperatureScanResult(fileNames, 2),
        {
          selectedDataTypes: ['temperature'],
          // Intra-import dedup must run regardless of this flag; false proves it
          // is not the cross-import DB check doing the work.
          skipDuplicates: false,
        },
      );

      // Exactly one record stored; the duplicate counted as skipped, not errored.
      expect(mock.daily.size).toBe(1);
      expect([...mock.daily.values()][0]?.date).toBe('2025-09-30');
      expect(record.recordsImported).toBe(1);
      expect(record.recordsSkipped).toBe(1);
      expect(record.recordsErrored).toBe(0);
      expect(record.errors).toEqual([]);
      // The core regression: no uniqueness/storage error surfaced to the user.
      expect(hasUniquenessError(record)).toBe(false);
    });

    it('keeps the FIRST occurrence and drops only later same-key duplicates', async () => {
      // Three rows: first date appears twice, a second date once. Result: two
      // distinct dates stored, exactly one skip, zero errors. First-occurrence
      // wins, so the stored record for the duplicated date is the first row.
      const csv = temperatureCsv([
        { sleepStart: '2025-09-30T22:00:00', deviation: -0.3 },
        { sleepStart: '2025-10-01T22:00:00', deviation: 0.2 },
        { sleepStart: '2025-09-30T23:45:00', deviation: 9.9 },
      ]);
      const files = new Map<string, File>([['temp.csv', makeFile('temp.csv', csv)]]);
      const fileNames = [...files.keys()];

      const mock = createMockDB();
      const service = new GoogleHealthImportService(mock.db);

      const record = await service.import(
        makeDirHandle(files),
        temperatureScanResult(fileNames, 3),
        { selectedDataTypes: ['temperature'], skipDuplicates: false },
      );

      expect(mock.daily.size).toBe(2);
      expect([...mock.daily.values()].map((r) => r.date).sort()).toEqual([
        '2025-09-30',
        '2025-10-01',
      ]);
      expect(record.recordsImported).toBe(2);
      expect(record.recordsSkipped).toBe(1);
      expect(record.recordsErrored).toBe(0);
      // First-occurrence-wins: the duplicated date kept the first row's value.
      const kept = mock.daily.get('fitbit|temperature|2025-09-30');
      expect((kept?.data as { nightlyDeviation: number }).nightlyDeviation).toBe(-0.3);
      expect(hasUniquenessError(record)).toBe(false);
    });
  });

  describe('isConstraintError classification in the one-by-one fallback', () => {
    it('counts a ConstraintError-named error as skipped via name, not message', async () => {
      // Two distinct dates so the intra-import dedup does NOT fire; both reach the
      // batch. `failBulk` forces the one-by-one fallback, where the second add
      // rejects with a `name === 'ConstraintError'` error whose MESSAGE contains
      // none of the defensive fallback keywords ("Constraint"/"duplicate"/
      // "uniqueness"). A passing skip therefore proves classification by `name`,
      // not by message substring — the heart of the robustness fix.
      const csv = temperatureCsv([
        { sleepStart: '2025-09-30T22:00:00', deviation: -0.3 },
        { sleepStart: '2025-10-01T22:00:00', deviation: 0.2 },
      ]);
      const files = new Map<string, File>([['temp.csv', makeFile('temp.csv', csv)]]);
      const fileNames = [...files.keys()];

      const nameOnlyConstraint = (): Error => {
        const e = new Error('a generic-sounding message with no telltale keywords');
        e.name = 'ConstraintError';
        return e;
      };

      const mock = createMockDB({
        failBulk: true,
        addError: (rec) => (rec.date === '2025-10-01' ? nameOnlyConstraint() : null),
      });
      const service = new GoogleHealthImportService(mock.db);

      const record = await service.import(
        makeDirHandle(files),
        temperatureScanResult(fileNames, 2),
        { selectedDataTypes: ['temperature'], skipDuplicates: false },
      );

      // One genuinely stored, one classified as a duplicate skip, none errored.
      expect(record.recordsImported).toBe(1);
      expect(record.recordsSkipped).toBe(1);
      expect(record.recordsErrored).toBe(0);
      expect(record.errors).toEqual([]);
      expect(hasUniquenessError(record)).toBe(false);
    });

    it('counts a StorageError wrapping a ConstraintError as skipped, not errored', async () => {
      // The same uniqueness violation, but wrapped in a StorageError whose
      // `originalCause` is the ConstraintError (the realistic shape: production
      // wraps the IDB request error via `wrapError`). The classifier must unwrap
      // `originalCause.name` and treat it as a skip.
      const csv = temperatureCsv([
        { sleepStart: '2025-09-30T22:00:00', deviation: -0.3 },
        { sleepStart: '2025-10-01T22:00:00', deviation: 0.2 },
      ]);
      const files = new Map<string, File>([['temp.csv', makeFile('temp.csv', csv)]]);
      const fileNames = [...files.keys()];

      const mock = createMockDB({
        failBulk: true,
        addError: (rec) =>
          rec.date === '2025-10-01'
            ? new StorageError('STORAGE_WRITE_FAILED', 'Failed to add daily summary', {
                cause: makeConstraintError(),
              })
            : null,
      });
      const service = new GoogleHealthImportService(mock.db);

      const record = await service.import(
        makeDirHandle(files),
        temperatureScanResult(fileNames, 2),
        { selectedDataTypes: ['temperature'], skipDuplicates: false },
      );

      expect(record.recordsImported).toBe(1);
      expect(record.recordsSkipped).toBe(1);
      expect(record.recordsErrored).toBe(0);
      expect(record.errors).toEqual([]);
      expect(hasUniquenessError(record)).toBe(false);
    });

    it('surfaces a non-constraint storage failure as a recoverable error', async () => {
      // A genuine, non-duplicate failure (e.g. quota/disk) must NOT be silently
      // swallowed as a skip — it has to reach `record.errors` so the user knows.
      const csv = temperatureCsv([
        { sleepStart: '2025-09-30T22:00:00', deviation: -0.3 },
        { sleepStart: '2025-10-01T22:00:00', deviation: 0.2 },
      ]);
      const files = new Map<string, File>([['temp.csv', makeFile('temp.csv', csv)]]);
      const fileNames = [...files.keys()];

      const mock = createMockDB({
        failBulk: true,
        addError: (rec) => (rec.date === '2025-10-01' ? new Error('disk full') : null),
      });
      const service = new GoogleHealthImportService(mock.db);

      const record = await service.import(
        makeDirHandle(files),
        temperatureScanResult(fileNames, 2),
        { selectedDataTypes: ['temperature'], skipDuplicates: false },
      );

      // The good record stored; the bad one surfaced as a recoverable error.
      expect(record.recordsImported).toBe(1);
      expect(record.recordsSkipped).toBe(0);
      expect(record.recordsErrored).toBe(1);
      const surfaced = record.errors.find((e) => e.fileName === 'temperature/2025-10-01');
      expect(surfaced).toBeDefined();
      expect(surfaced?.error).toContain('Storage failed');
      expect(surfaced?.error).toContain('disk full');
    });
  });
});
