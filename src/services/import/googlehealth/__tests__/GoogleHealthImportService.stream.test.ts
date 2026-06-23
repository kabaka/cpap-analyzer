/**
 * Memory-bounding regression tests for the worker-parsed heavy-type import path.
 *
 * The worker path INTERLEAVES storage with parsing: each file's records are
 * stored and released before the next file is parsed, bounding peak heap to
 * ~O(one file) instead of O(all files in the type). These tests pin the
 * behaviour that MUST stay identical to the old parse-all-then-store path:
 *
 *  (a) stored records + counts + skipped + tracked date range are identical to
 *      the parse-all-then-store expectation;
 *  (b) a within-import duplicate across two files is skipped exactly once;
 *  (c) progress counters are monotonic non-decreasing and end at the right
 *      totals;
 *  (d) a recoverable per-file parse error does not abort the type;
 *  (e) the streaming property holds: a store is observed before the LAST file
 *      is parsed.
 *
 * The stub worker pool runs the REAL `fitbitParserAPI` core, so parsed output is
 * byte-identical to production; only the threading is stubbed.
 *
 * @module services/import/googlehealth/__tests__/GoogleHealthImportService.stream
 */

import { describe, it, expect, vi } from 'vitest';

import { GoogleHealthImportService } from '../GoogleHealthImportService';
import { fitbitParserAPI } from '@/services/workers/fitbitParser.worker';
import type { FitbitParserWorkerAPI } from '@/services/workers/fitbitParser.worker';
import type { WorkerPool } from '@/services/workers/WorkerPool';
import type { IndexedDBService } from '@/services/storage/IndexedDBService';
import type { GoogleHealthScanResult, GoogleHealthDataTypeInfo } from '@/types/fitbit';
import type {
  IntegrationDailySummary,
  IntegrationTimeseries,
  IntegrationImportRecord,
} from '@/types/storage';
import type { GoogleHealthImportProgress } from '../../types';

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
 * Build a heart-rate intraday JSON fixture for a single calendar day, at 1-minute
 * cadence, with `count` samples starting at the given hour. All entries share the
 * same date, so the parser collapses them into ONE `ParsedRecord` per file/day.
 */
function hrIntradayFixtureForDay(day: string, startHour: number, count: number): string {
  // day is "MM/DD/YY" Fitbit-legacy date.
  const entries: { dateTime: string; value: { bpm: number; confidence: number } }[] = [];
  const pad = (n: number): string => String(n).padStart(2, '0');
  for (let m = 0; m < count; m++) {
    const total = startHour * 60 + m;
    const hh = Math.floor(total / 60) % 24;
    const mm = total % 60;
    entries.push({
      dateTime: `${day} ${pad(hh)}:${pad(mm)}:00`,
      value: { bpm: 60 + (m % 25), confidence: m % 4 },
    });
  }
  return JSON.stringify(entries);
}

/** A File-like object whose bytes/text round-trip the given content under jsdom. */
function makeFile(name: string, content: string): File {
  const bytes = new TextEncoder().encode(content);
  const buffer = bytes.buffer.slice(0) as ArrayBuffer;
  const file = {
    name,
    size: bytes.byteLength,
    type: 'application/json',
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
  /** Ordered log of pipeline events for the streaming-order assertion. */
  events: string[];
}

function createMockDB(preexistingTsKeys: Set<string> = new Set()): MockDB {
  const timeseries = new Map<string, IntegrationTimeseries>();
  const daily = new Map<string, IntegrationDailySummary>();
  const importRecords: IntegrationImportRecord[] = [];
  const events: string[] = [];

  const tsKey = (dataType: string, date: string): string => `fitbit|${dataType}|${date}`;
  const dKey = tsKey;

  // Seed pre-existing timeseries keys (used to exercise the dedup path).
  for (const k of preexistingTsKeys) {
    timeseries.set(k, {} as IntegrationTimeseries);
  }

  const db = {
    getIntegrationTimeseriesByKey: (_source: string, dataType: string, date: string) =>
      Promise.resolve(timeseries.get(tsKey(dataType, date))),
    getIntegrationDailySummaryByKey: (_source: string, dataType: string, date: string) =>
      Promise.resolve(daily.get(dKey(dataType, date))),
    bulkAddIntegrationTimeseries: (records: IntegrationTimeseries[]) => {
      events.push('store');
      for (const r of records) timeseries.set(tsKey(r.dataType, r.date), r);
      return Promise.resolve();
    },
    addIntegrationTimeseries: (record: IntegrationTimeseries) => {
      events.push('store');
      timeseries.set(tsKey(record.dataType, record.date), record);
      return Promise.resolve();
    },
    bulkAddIntegrationDailySummaries: (records: IntegrationDailySummary[]) => {
      events.push('store');
      for (const r of records) daily.set(dKey(r.dataType, r.date), r);
      return Promise.resolve();
    },
    addIntegrationDailySummary: (record: IntegrationDailySummary) => {
      events.push('store');
      daily.set(dKey(record.dataType, record.date), record);
      return Promise.resolve();
    },
    addIntegrationImportRecord: (record: IntegrationImportRecord) => {
      importRecords.push(record);
      return Promise.resolve();
    },
  } as unknown as IndexedDBService;

  return { db, timeseries, daily, importRecords, events };
}

// ---------------------------------------------------------------------------
// Stub worker pool running the REAL parser core
// ---------------------------------------------------------------------------

function createStubPoolFactory(
  events: string[],
  opts: { failFileName?: string } = {},
): {
  factory: () => WorkerPool<FitbitParserWorkerAPI>;
  parsedFiles: string[];
} {
  const parsedFiles: string[] = [];
  const factory = (): WorkerPool<FitbitParserWorkerAPI> => {
    const pool = {
      submit<R>(taskFn: (proxy: FitbitParserWorkerAPI) => Promise<R>): Promise<R> {
        const proxy: FitbitParserWorkerAPI = {
          parseDataType: async (dataType, files, onProgress, chunkSize) => {
            const file = files[0];
            if (file && opts.failFileName && file.name === opts.failFileName) {
              throw new Error(`synthetic parse failure for ${file.name}`);
            }
            if (file) {
              parsedFiles.push(file.name);
              events.push(`parse:${file.name}`);
            }
            return fitbitParserAPI.parseDataType(dataType, files, onProgress, chunkSize);
          },
        };
        return taskFn(proxy);
      },
      shutdown: () => Promise.resolve(),
    } as unknown as WorkerPool<FitbitParserWorkerAPI>;
    return pool;
  };
  return { factory, parsedFiles };
}

// ---------------------------------------------------------------------------
// Scan-result helpers
// ---------------------------------------------------------------------------

function hrScanResult(fileNames: string[], recordCount: number): GoogleHealthScanResult {
  const info: GoogleHealthDataTypeInfo = {
    dataType: 'heart_rate_intraday',
    tier: 2,
    label: 'Heart Rate (Intraday)',
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoogleHealthImportService — interleaved store for worker-parsed heavy types', () => {
  it('stores identical records/counts/date-range across multiple files, streaming as it goes', async () => {
    // Three distinct days, one file each. Each day => exactly one timeseries
    // record (collapsed by the parser). Total stored should be 3.
    const files = new Map<string, File>([
      [
        'hr-2024-01-01.json',
        makeFile('hr-2024-01-01.json', hrIntradayFixtureForDay('01/01/24', 8, 60)),
      ],
      [
        'hr-2024-01-02.json',
        makeFile('hr-2024-01-02.json', hrIntradayFixtureForDay('01/02/24', 8, 60)),
      ],
      [
        'hr-2024-01-03.json',
        makeFile('hr-2024-01-03.json', hrIntradayFixtureForDay('01/03/24', 8, 60)),
      ],
    ]);
    const fileNames = [...files.keys()];

    const mock = createMockDB();
    const { factory, parsedFiles } = createStubPoolFactory(mock.events);
    const service = new GoogleHealthImportService(mock.db, factory);

    const progressLog: GoogleHealthImportProgress[] = [];
    const record = await service.import(makeDirHandle(files), hrScanResult(fileNames, 180), {
      selectedDataTypes: ['heart_rate_intraday'],
      skipDuplicates: true,
      onProgress: (p) => progressLog.push(p),
    });

    // (a) Identical stored output: one record per day, all three days present.
    expect(mock.timeseries.size).toBe(3);
    expect([...mock.timeseries.values()].map((r) => r.date).sort()).toEqual([
      '2024-01-01',
      '2024-01-02',
      '2024-01-03',
    ]);
    expect(record.recordsImported).toBe(3);
    expect(record.recordsSkipped).toBe(0);
    expect(record.recordsErrored).toBe(0);
    // Date range tracked across all stored records.
    expect(record.dateRangeStart).toBe('2024-01-01');
    expect(record.dateRangeEnd).toBe('2024-01-03');

    // (e) Streaming property: a store happened before the LAST file was parsed.
    const lastParseIdx = mock.events.lastIndexOf(`parse:${fileNames[2]}`);
    const firstStoreIdx = mock.events.indexOf('store');
    expect(firstStoreIdx).toBeGreaterThanOrEqual(0);
    expect(lastParseIdx).toBeGreaterThanOrEqual(0);
    expect(firstStoreIdx).toBeLessThan(lastParseIdx);
    expect(parsedFiles).toEqual(fileNames);
  });

  it('skips a within-import duplicate that spans two files exactly once', async () => {
    // Two files for the SAME day. First file stores the record; the second
    // file's identical-date record must be skipped via the shared DB dedup.
    const dupDay = '02/10/24';
    const files = new Map<string, File>([
      ['hr-a.json', makeFile('hr-a.json', hrIntradayFixtureForDay(dupDay, 9, 30))],
      ['hr-b.json', makeFile('hr-b.json', hrIntradayFixtureForDay(dupDay, 14, 30))],
    ]);
    const fileNames = [...files.keys()];

    const mock = createMockDB();
    const { factory } = createStubPoolFactory(mock.events);
    const service = new GoogleHealthImportService(mock.db, factory);

    const record = await service.import(makeDirHandle(files), hrScanResult(fileNames, 60), {
      selectedDataTypes: ['heart_rate_intraday'],
      skipDuplicates: true,
    });

    // Stored exactly once; the duplicate from file B is skipped exactly once.
    expect(mock.timeseries.size).toBe(1);
    expect(record.recordsImported).toBe(1);
    expect(record.recordsSkipped).toBe(1);
    expect([...mock.timeseries.values()][0]?.date).toBe('2024-02-10');
  });

  it('keeps progress counters monotonic and ending at the correct totals', async () => {
    const files = new Map<string, File>([
      [
        'hr-2024-03-01.json',
        makeFile('hr-2024-03-01.json', hrIntradayFixtureForDay('03/01/24', 8, 40)),
      ],
      [
        'hr-2024-03-02.json',
        makeFile('hr-2024-03-02.json', hrIntradayFixtureForDay('03/02/24', 8, 40)),
      ],
      [
        'hr-2024-03-03.json',
        makeFile('hr-2024-03-03.json', hrIntradayFixtureForDay('03/03/24', 8, 40)),
      ],
      [
        'hr-2024-03-04.json',
        makeFile('hr-2024-03-04.json', hrIntradayFixtureForDay('03/04/24', 8, 40)),
      ],
    ]);
    const fileNames = [...files.keys()];

    const mock = createMockDB();
    const { factory } = createStubPoolFactory(mock.events);
    const service = new GoogleHealthImportService(mock.db, factory);

    const processedSeq: number[] = [];
    const skippedSeq: number[] = [];
    const record = await service.import(makeDirHandle(files), hrScanResult(fileNames, 160), {
      selectedDataTypes: ['heart_rate_intraday'],
      skipDuplicates: true,
      onProgress: (p) => {
        processedSeq.push(p.recordsProcessed);
        skippedSeq.push(p.recordsSkipped);
      },
    });

    // Monotonic non-decreasing throughout.
    for (let i = 1; i < processedSeq.length; i++) {
      expect(processedSeq[i]!).toBeGreaterThanOrEqual(processedSeq[i - 1]!);
    }
    for (let i = 1; i < skippedSeq.length; i++) {
      expect(skippedSeq[i]!).toBeGreaterThanOrEqual(skippedSeq[i - 1]!);
    }
    // Ends at the correct totals.
    expect(record.recordsImported).toBe(4);
    expect(record.recordsSkipped).toBe(0);
    expect(processedSeq[processedSeq.length - 1]).toBe(4);
  });

  it('continues the type after a recoverable per-file parse error', async () => {
    const files = new Map<string, File>([
      [
        'hr-2024-04-01.json',
        makeFile('hr-2024-04-01.json', hrIntradayFixtureForDay('04/01/24', 8, 30)),
      ],
      ['hr-bad.json', makeFile('hr-bad.json', hrIntradayFixtureForDay('04/02/24', 8, 30))],
      [
        'hr-2024-04-03.json',
        makeFile('hr-2024-04-03.json', hrIntradayFixtureForDay('04/03/24', 8, 30)),
      ],
    ]);
    const fileNames = [...files.keys()];

    const mock = createMockDB();
    const { factory } = createStubPoolFactory(mock.events, { failFileName: 'hr-bad.json' });
    const service = new GoogleHealthImportService(mock.db, factory);

    const record = await service.import(makeDirHandle(files), hrScanResult(fileNames, 90), {
      selectedDataTypes: ['heart_rate_intraday'],
      skipDuplicates: true,
    });

    // The two good files still stored; the type was NOT aborted.
    expect(mock.timeseries.size).toBe(2);
    expect([...mock.timeseries.values()].map((r) => r.date).sort()).toEqual([
      '2024-04-01',
      '2024-04-03',
    ]);
    expect(record.recordsImported).toBe(2);
    // The bad file is recorded as a recoverable error.
    expect(record.recordsErrored).toBeGreaterThanOrEqual(1);
    expect(record.errors.some((e) => e.fileName === 'hr-bad.json')).toBe(true);
  });
});
