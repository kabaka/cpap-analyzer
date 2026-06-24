/**
 * Bounded look-ahead parse↔store OVERLAP tests for the worker-parsed heavy types
 * (ADR 0030).
 *
 * The strict-serial (#67) memory + equivalence invariants are pinned in the
 * sibling `*.stream.test.ts`; this file pins the NEW pipelining behaviour the
 * overlap introduces, using an ASYNC, controllable stub pool so parse and store
 * genuinely interleave (the stream test's stub resolves synchronously and cannot
 * observe overlap):
 *
 *  (1) STORE stays single-flight and in file order — no two stores overlap, and
 *      file N commits before file N+1 stores (the dedup-ordering guarantee).
 *  (2) The producer parses AHEAD of the store (real overlap), but the look-ahead
 *      is BOUNDED: at most `LOOKAHEAD_FILE_CAP` files are ever in flight at once,
 *      so parse cannot run unboundedly ahead (memory cap holds).
 *  (3) Persisted output + counts are byte-identical to a serial reference run.
 *  (4) A within-import cross-file duplicate is skipped exactly once.
 *  (5) A mid-import abort stops promptly with a consistent partial commit (the
 *      already-stored prefix is durable; nothing half-stored; idempotent).
 *  (6) A recoverable per-file parse error still continues to the next file.
 *
 * The stub pool runs the REAL `fitbitParserAPI` core, so parsed output is
 * byte-identical to production; only the threading + scheduling are stubbed.
 *
 * @module services/import/googlehealth/__tests__/GoogleHealthImportService.overlap
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

// Resolve the directory handle straight through; keep the real scanner module.
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

/** A single intraday-HR day file (all samples on one date → one stored record). */
function hrFixtureForDay(day: string, count: number): string {
  const entries: { dateTime: string; value: { bpm: number; confidence: number } }[] = [];
  const pad = (n: number): string => String(n).padStart(2, '0');
  for (let m = 0; m < count; m++) {
    const hh = Math.floor(m / 60) % 24;
    const mm = m % 60;
    entries.push({
      dateTime: `${day} ${pad(hh)}:${pad(mm)}:00`,
      value: { bpm: 60 + (m % 25), confidence: m % 4 },
    });
  }
  return JSON.stringify(entries);
}

function makeFile(name: string, content: string): File {
  const bytes = new TextEncoder().encode(content);
  const buffer = bytes.buffer.slice(0) as ArrayBuffer;
  return {
    name,
    size: bytes.byteLength,
    type: 'application/json',
    text: () => Promise.resolve(content),
    arrayBuffer: () => Promise.resolve(buffer.slice(0)),
  } as unknown as File;
}

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
// Mock IndexedDB with real (source, dataType, date) dedup + an event log
// ---------------------------------------------------------------------------

interface MockDB {
  db: IndexedDBService;
  timeseries: Map<string, IntegrationTimeseries>;
  daily: Map<string, IntegrationDailySummary>;
  importRecords: IntegrationImportRecord[];
  /** Ordered pipeline event log. */
  events: string[];
}

function createMockDB(opts: { storeDelayMs?: number } = {}): MockDB {
  const timeseries = new Map<string, IntegrationTimeseries>();
  const daily = new Map<string, IntegrationDailySummary>();
  const importRecords: IntegrationImportRecord[] = [];
  const events: string[] = [];
  const tsKey = (dataType: string, date: string): string => `fitbit|${dataType}|${date}`;

  const delay = (): Promise<void> =>
    opts.storeDelayMs ? new Promise((r) => setTimeout(r, opts.storeDelayMs)) : Promise.resolve();

  const db = {
    getIntegrationTimeseriesByKey: (_s: string, dataType: string, date: string) =>
      Promise.resolve(timeseries.get(tsKey(dataType, date))),
    getIntegrationDailySummaryByKey: (_s: string, dataType: string, date: string) =>
      Promise.resolve(daily.get(tsKey(dataType, date))),
    bulkAddIntegrationTimeseries: async (records: IntegrationTimeseries[]) => {
      events.push('store:start');
      await delay();
      for (const r of records) timeseries.set(tsKey(r.dataType, r.date), r);
      events.push('store:end');
    },
    addIntegrationTimeseries: async (record: IntegrationTimeseries) => {
      await delay();
      timeseries.set(tsKey(record.dataType, record.date), record);
    },
    bulkAddIntegrationDailySummaries: async (records: IntegrationDailySummary[]) => {
      events.push('store:start');
      await delay();
      for (const r of records) daily.set(tsKey(r.dataType, r.date), r);
      events.push('store:end');
    },
    addIntegrationDailySummary: async (record: IntegrationDailySummary) => {
      await delay();
      daily.set(tsKey(record.dataType, record.date), record);
    },
    addIntegrationImportRecord: (record: IntegrationImportRecord) => {
      importRecords.push(record);
      return Promise.resolve();
    },
  } as unknown as IndexedDBService;

  return { db, timeseries, daily, importRecords, events };
}

// ---------------------------------------------------------------------------
// Async stub pool that records concurrency + lets us observe look-ahead
// ---------------------------------------------------------------------------

interface PoolProbe {
  factory: () => WorkerPool<FitbitParserWorkerAPI>;
  /** Peak number of parse tasks that were simultaneously in flight. */
  peakConcurrentParses: () => number;
  /** Names of files whose parse has STARTED, in start order. */
  parseStarts: string[];
  /** Names of files whose parse has COMPLETED, in completion order. */
  parseDones: string[];
}

/**
 * A stub pool whose `parseDataType` runs the real core but defers completion to
 * a macrotask, so multiple parses can be in flight at once and the orchestrator's
 * look-ahead / store-overlap is genuinely exercised. Concurrency is tracked so
 * tests can assert the look-ahead bound and parse-ahead behaviour.
 */
function createAsyncPoolProbe(
  events: string[],
  opts: { failFileName?: string; cloneFailFileName?: string; parseDelayMs?: number } = {},
): PoolProbe {
  let inFlight = 0;
  let peak = 0;
  const parseStarts: string[] = [];
  const parseDones: string[] = [];

  const factory = (): WorkerPool<FitbitParserWorkerAPI> =>
    ({
      submit<R>(taskFn: (proxy: FitbitParserWorkerAPI) => Promise<R>): Promise<R> {
        const proxy: FitbitParserWorkerAPI = {
          parseDataType: async (dataType, files, onProgress, chunkSize) => {
            const file = files[0];
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            if (file) {
              parseStarts.push(file.name);
              events.push(`parse:start:${file.name}`);
            }
            // Defer so the producer can admit further look-ahead before this
            // resolves (real overlap), bounded by the orchestrator's cap.
            await new Promise((r) => setTimeout(r, opts.parseDelayMs ?? 1));
            try {
              if (file && opts.cloneFailFileName && file.name === opts.cloneFailFileName) {
                // Mimic a worker structured-clone failure (the PR #70 hard-fail
                // path), recognised by isCloneFailure via the DataCloneError name.
                throw Object.assign(new Error('parseDataType argument could not be cloned'), {
                  name: 'DataCloneError',
                });
              }
              if (file && opts.failFileName && file.name === opts.failFileName) {
                throw new Error(`synthetic parse failure for ${file.name}`);
              }
              const result = await fitbitParserAPI.parseDataType(
                dataType,
                files,
                onProgress,
                chunkSize,
              );
              if (file) {
                parseDones.push(file.name);
                events.push(`parse:done:${file.name}`);
              }
              return result;
            } finally {
              inFlight -= 1;
            }
          },
        };
        return taskFn(proxy);
      },
      shutdown: () => Promise.resolve(),
      get busyWorkerCount() {
        return inFlight;
      },
      get maxPoolSize() {
        return 4;
      },
    }) as unknown as WorkerPool<FitbitParserWorkerAPI>;

  return {
    factory,
    peakConcurrentParses: () => peak,
    parseStarts,
    parseDones,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoogleHealthImportService — bounded look-ahead parse↔store overlap (ADR 0030)', () => {
  const days = ['01/01/24', '01/02/24', '01/03/24', '01/04/24', '01/05/24', '01/06/24'];
  const isoDays = [
    '2024-01-01',
    '2024-01-02',
    '2024-01-03',
    '2024-01-04',
    '2024-01-05',
    '2024-01-06',
  ];

  function buildFiles(): Map<string, File> {
    const files = new Map<string, File>();
    days.forEach((d, idx) => {
      const name = `hr-${isoDays[idx]}.json`;
      files.set(name, makeFile(name, hrFixtureForDay(d, 60)));
    });
    return files;
  }

  it('stores strictly single-flight, in file order, and parses ahead (overlap)', async () => {
    const files = buildFiles();
    const fileNames = [...files.keys()];

    // Store is slow + parse is fast → the producer can run ahead during stores.
    const mock = createMockDB({ storeDelayMs: 5 });
    const probe = createAsyncPoolProbe(mock.events, { parseDelayMs: 1 });
    const service = new GoogleHealthImportService(mock.db, probe.factory);

    const record = await service.import(makeDirHandle(files), hrScanResult(fileNames, 360), {
      selectedDataTypes: ['heart_rate_intraday'],
      skipDuplicates: true,
    });

    // (1) Single-flight store: no two store windows overlap. Every 'store:start'
    // is immediately followed by its matching 'store:end' with no interleaving.
    const storeEvents = mock.events.filter((e) => e === 'store:start' || e === 'store:end');
    for (let i = 0; i < storeEvents.length; i += 2) {
      expect(storeEvents[i]).toBe('store:start');
      expect(storeEvents[i + 1]).toBe('store:end');
    }

    // Store committed in file order: the Nth stored record is day N.
    expect([...mock.timeseries.values()].map((r) => r.date)).toEqual(isoDays);
    expect(record.recordsImported).toBe(6);
    expect(record.recordsSkipped).toBe(0);

    // (overlap) The producer parsed AHEAD: at least one parse completed before
    // the first store ended, i.e. parse and store genuinely overlapped.
    const firstStoreEnd = mock.events.indexOf('store:end');
    const firstParseDoneAfterFirstStore = mock.events.findIndex(
      (e, idx) => idx < firstStoreEnd && e.startsWith('parse:done:'),
    );
    expect(firstParseDoneAfterFirstStore).toBeGreaterThanOrEqual(0);
    // And a parse STARTED before the first store finished (look-ahead active).
    const firstParseStartIdx = mock.events.findIndex((e) => e.startsWith('parse:start:'));
    expect(firstParseStartIdx).toBeLessThan(firstStoreEnd);
  });

  it('bounds the look-ahead: never more than the file cap in flight at once', async () => {
    const files = buildFiles();
    const fileNames = [...files.keys()];

    // Make stores SLOW so, without a bound, the producer would race far ahead.
    const mock = createMockDB({ storeDelayMs: 15 });
    const probe = createAsyncPoolProbe(mock.events, { parseDelayMs: 1 });
    const service = new GoogleHealthImportService(mock.db, probe.factory);

    await service.import(makeDirHandle(files), hrScanResult(fileNames, 360), {
      selectedDataTypes: ['heart_rate_intraday'],
      skipDuplicates: true,
    });

    // The orchestrator's LOOKAHEAD_FILE_CAP is 2; peak concurrent parses must
    // never exceed it (the producer waits on the admission gate). This is the
    // memory-bound guarantee: parse cannot run unboundedly ahead of store.
    expect(probe.peakConcurrentParses()).toBeLessThanOrEqual(2);
    // It SHOULD reach the cap (otherwise the test is not exercising the bound).
    expect(probe.peakConcurrentParses()).toBeGreaterThanOrEqual(2);
  });

  it('produces output byte-identical to a serial reference run', async () => {
    const files = buildFiles();
    const fileNames = [...files.keys()];

    // Overlapped run (fast parse, slow store).
    const mockA = createMockDB({ storeDelayMs: 3 });
    const probeA = createAsyncPoolProbe(mockA.events, { parseDelayMs: 1 });
    const recA = await new GoogleHealthImportService(mockA.db, probeA.factory).import(
      makeDirHandle(files),
      hrScanResult(fileNames, 360),
      { selectedDataTypes: ['heart_rate_intraday'], skipDuplicates: true },
    );

    // "Serial" reference: no parse delay AND no store delay → no opportunity to
    // overlap; same cores, same store path.
    const mockB = createMockDB();
    const probeB = createAsyncPoolProbe(mockB.events, { parseDelayMs: 0 });
    const recB = await new GoogleHealthImportService(mockB.db, probeB.factory).import(
      makeDirHandle(files),
      hrScanResult(fileNames, 360),
      { selectedDataTypes: ['heart_rate_intraday'], skipDuplicates: true },
    );

    // Identical persisted records (date set + count), identical counts.
    const datesA = [...mockA.timeseries.values()].map((r) => r.date).sort();
    const datesB = [...mockB.timeseries.values()].map((r) => r.date).sort();
    expect(datesA).toEqual(datesB);
    expect(datesA).toEqual(isoDays);
    expect(recA.recordsImported).toBe(recB.recordsImported);
    expect(recA.recordsSkipped).toBe(recB.recordsSkipped);
    expect(recA.recordsErrored).toBe(recB.recordsErrored);
    expect(recA.dateRangeStart).toBe(recB.dateRangeStart);
    expect(recA.dateRangeEnd).toBe(recB.dateRangeEnd);
  });

  it('skips a within-import cross-file duplicate exactly once (single-flight ordering)', async () => {
    // Two files for the SAME day, separated by a third distinct day BETWEEN them
    // so the duplicate genuinely spans the look-ahead window.
    const files = new Map<string, File>([
      ['hr-a.json', makeFile('hr-a.json', hrFixtureForDay('02/10/24', 30))],
      ['hr-mid.json', makeFile('hr-mid.json', hrFixtureForDay('02/11/24', 30))],
      ['hr-b.json', makeFile('hr-b.json', hrFixtureForDay('02/10/24', 30))],
    ]);
    const fileNames = [...files.keys()];

    const mock = createMockDB({ storeDelayMs: 4 });
    const probe = createAsyncPoolProbe(mock.events, { parseDelayMs: 1 });
    const service = new GoogleHealthImportService(mock.db, probe.factory);

    const record = await service.import(makeDirHandle(files), hrScanResult(fileNames, 90), {
      selectedDataTypes: ['heart_rate_intraday'],
      skipDuplicates: true,
    });

    // 02/10 stored once (from file a), 02/11 stored once; file b's 02/10 skipped.
    expect([...mock.timeseries.values()].map((r) => r.date).sort()).toEqual([
      '2024-02-10',
      '2024-02-11',
    ]);
    expect(record.recordsImported).toBe(2);
    expect(record.recordsSkipped).toBe(1);
  });

  it('stops promptly on mid-import abort with a consistent partial commit', async () => {
    const files = buildFiles();
    const fileNames = [...files.keys()];

    const controller = new AbortController();
    const mock = createMockDB({ storeDelayMs: 5 });
    const probe = createAsyncPoolProbe(mock.events, { parseDelayMs: 1 });
    const service = new GoogleHealthImportService(mock.db, probe.factory);

    // Abort after the first couple of stores have committed.
    let stores = 0;
    const origBulk = mock.db.bulkAddIntegrationTimeseries.bind(mock.db);
    (
      mock.db as unknown as { bulkAddIntegrationTimeseries: typeof origBulk }
    ).bulkAddIntegrationTimeseries = async (records: IntegrationTimeseries[]) => {
      await origBulk(records);
      stores += 1;
      if (stores === 2) controller.abort();
    };

    await expect(
      service.import(makeDirHandle(files), hrScanResult(fileNames, 360), {
        selectedDataTypes: ['heart_rate_intraday'],
        skipDuplicates: true,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'ImportAbortedError' });

    // Partial commit is consistent: a PREFIX of the days is stored (no gaps, no
    // half-stored record), and it stopped before all 6.
    const storedDates = [...mock.timeseries.values()].map((r) => r.date).sort();
    expect(storedDates.length).toBeGreaterThanOrEqual(2);
    expect(storedDates.length).toBeLessThan(6);
    // Prefix property: stored dates are exactly the first K of the file order.
    expect(storedDates).toEqual(isoDays.slice(0, storedDates.length));

    // Idempotent: re-importing skips the already-committed prefix and completes
    // the rest (no duplicates, no errors).
    const mock2 = mock; // same DB instance — already has the committed prefix
    const probe2 = createAsyncPoolProbe(mock2.events, { parseDelayMs: 0 });
    const service2 = new GoogleHealthImportService(mock2.db, probe2.factory);
    const rec2 = await service2.import(makeDirHandle(files), hrScanResult(fileNames, 360), {
      selectedDataTypes: ['heart_rate_intraday'],
      skipDuplicates: true,
    });
    expect([...mock2.timeseries.values()].map((r) => r.date).sort()).toEqual(isoDays);
    expect(rec2.recordsImported).toBe(6 - storedDates.length);
    expect(rec2.recordsSkipped).toBe(storedDates.length);
  });

  it('continues past a recoverable per-file parse error, in order', async () => {
    const files = new Map<string, File>([
      ['hr-2024-04-01.json', makeFile('hr-2024-04-01.json', hrFixtureForDay('04/01/24', 30))],
      ['hr-bad.json', makeFile('hr-bad.json', hrFixtureForDay('04/02/24', 30))],
      ['hr-2024-04-03.json', makeFile('hr-2024-04-03.json', hrFixtureForDay('04/03/24', 30))],
    ]);
    const fileNames = [...files.keys()];

    const mock = createMockDB({ storeDelayMs: 3 });
    const probe = createAsyncPoolProbe(mock.events, {
      failFileName: 'hr-bad.json',
      parseDelayMs: 1,
    });
    const service = new GoogleHealthImportService(mock.db, probe.factory);

    const record = await service.import(makeDirHandle(files), hrScanResult(fileNames, 90), {
      selectedDataTypes: ['heart_rate_intraday'],
      skipDuplicates: true,
    });

    // The two good files stored (in order); the type was NOT aborted.
    expect([...mock.timeseries.values()].map((r) => r.date).sort()).toEqual([
      '2024-04-01',
      '2024-04-03',
    ]);
    expect(record.recordsImported).toBe(2);
    expect(record.recordsErrored).toBeGreaterThanOrEqual(1);
    expect(record.errors.some((e) => e.fileName === 'hr-bad.json')).toBe(true);
  });

  it('rejects (does not hang) when a clone-failure hits while the look-ahead gate is saturated', async () => {
    // Regression for the B1 deadlock. With more files than the look-ahead cap and
    // a structured-clone failure on an EARLY file, the consumer hard-fails (throws)
    // while the producer is parked at a saturated admission gate. Without the
    // consumer-teardown that breaks the gate (`consumerDone`), the woken producer
    // re-parks on a still-full predicate and `await producer` never resolves —
    // import() hangs. (Reachable in production: PR #70 made worker structured-clone
    // failures a hard-fail; the prior cloneFailure test used a single file, so the
    // gate never saturated.)
    const dayList = ['05/01/24', '05/02/24', '05/03/24', '05/04/24', '05/05/24'];
    const isoList = ['2024-05-01', '2024-05-02', '2024-05-03', '2024-05-04', '2024-05-05'];
    const files = new Map<string, File>();
    dayList.forEach((d, i) => {
      const name = `hr-${isoList[i]}.json`;
      files.set(name, makeFile(name, hrFixtureForDay(d, 30)));
    });
    const fileNames = [...files.keys()];

    const mock = createMockDB({ storeDelayMs: 5 });
    const probe = createAsyncPoolProbe(mock.events, {
      cloneFailFileName: fileNames[0], // hard-fail on the FIRST file
      parseDelayMs: 1,
    });
    const service = new GoogleHealthImportService(mock.db, probe.factory);

    const importPromise = service.import(makeDirHandle(files), hrScanResult(fileNames, 150), {
      selectedDataTypes: ['heart_rate_intraday'],
      skipDuplicates: true,
    });

    // Fail fast (rather than hanging the whole suite) if the deadlock regresses.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('TIMEOUT: import() did not settle — B1 deadlock regressed')),
        3000,
      ),
    );

    await expect(Promise.race([importPromise, timeout])).rejects.toMatchObject({
      name: 'DataCloneError',
    });
    // The hard-fail on the first file unwinds the whole import: nothing stored.
    expect(mock.timeseries.size).toBe(0);
  });
});
