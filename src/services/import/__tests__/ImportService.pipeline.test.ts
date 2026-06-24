/**
 * ImportService — bounded look-ahead pipeline tests (ADR 0029).
 *
 * These tests target the producer/consumer restructuring of the per-day phase:
 *
 *  - identical persisted output + counts vs. the sequential baseline,
 *  - within-import duplicate across two *pipelined* day-groups skipped once,
 *  - store happens strictly in day order and single-flight,
 *  - the 64 MB in-flight byte budget bounds how far parsing runs ahead,
 *  - cancellation mid-pipeline stops promptly and leaves consistent state,
 *  - a single oversized day still progresses (never deadlocks the budget).
 *
 * The pool mock here runs the REAL parser, optionally with an artificial parse
 * delay and a "size override" so a few day-groups can exceed the byte budget,
 * and records max-concurrent parses + store order for assertions.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  ImportService,
  type EDFWorkerFactory,
  type EDFWorkerPoolFactory,
} from '@/services/import/ImportService';
import { ImportAbortedError } from '@/services/import/types';
import { EDFParser } from '@/parsers/edf/EDFParser';
import { ResMedInterpreter } from '@/parsers/resmed/ResMedInterpreter';
import { Validator } from '@/parsers/validation/Validator';
import type { ParseResult } from '@/services/workers/edfParser.worker';
import type { IndexedDBService } from '@/services/storage/IndexedDBService';
import type { OPFSService } from '@/services/storage/OPFSService';
import type { WrappedWorker } from '@/services/workers/createWorker';
import type { WorkerPool } from '@/services/workers/WorkerPool';
import type { EDFParserWorkerAPI } from '@/services/workers/edfParser.worker';

const FIXTURE_DIR = path.resolve(__dirname, '../../../../tests/fixtures/edf');
const PIPELINE_BYTE_BUDGET = 64 * 1024 * 1024;

function loadFixtureBuffer(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, name));
}

/**
 * A mock File whose `size` and `arrayBuffer()` can be inflated past the real
 * fixture size so a day-group's parsed byteTotal can be driven above the budget,
 * while still parsing to a valid interpretation (the parser reads only the EDF
 * structure at the front of the buffer; trailing padding is ignored).
 */
function createFile(name: string, buf: Buffer, relPath: string, inflateTo?: number): File {
  let backing: ArrayBuffer;
  if (inflateTo && inflateTo > buf.byteLength) {
    const padded = new Uint8Array(inflateTo);
    padded.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), 0);
    backing = padded.buffer;
  } else {
    const copy = new Uint8Array(buf.byteLength);
    copy.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), 0);
    backing = copy.buffer;
  }
  return {
    name,
    size: backing.byteLength,
    type: 'application/octet-stream',
    lastModified: Date.now(),
    webkitRelativePath: relPath,
    arrayBuffer: () => Promise.resolve(backing),
    slice: () => new Blob(),
    stream: () => new ReadableStream(),
    text: () => Promise.resolve(''),
  } as unknown as File;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  return hex;
}

interface StoreRecord {
  id: string;
  startTime: string;
  sourceHash: string;
}

/** IndexedDB mock that records store order (the consume order). */
function createRecordingIDB(): {
  idb: IndexedDBService;
  stored: StoreRecord[];
  setExisting: (rows: StoreRecord[]) => void;
} {
  const stored: StoreRecord[] = [];
  let existing: StoreRecord[] = [];
  const idb = {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    addSessionWithRelated: vi
      .fn()
      .mockImplementation(async (s: { id: string; startTime: string; sourceHash: string }) => {
        // Small async hop so a (buggy) concurrent store would interleave here.
        await Promise.resolve();
        stored.push({ id: s.id, startTime: s.startTime, sourceHash: s.sourceHash });
      }),
    deleteSessionCascade: vi.fn().mockImplementation(async (id: string) => {
      const i = stored.findIndex((s) => s.id === id);
      if (i !== -1) stored.splice(i, 1);
    }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getAllSessions: vi.fn().mockImplementation(async () => existing.map((r) => ({ ...r }))),
  } as unknown as IndexedDBService;
  return {
    idb,
    stored,
    setExisting: (rows) => {
      existing = rows;
    },
  };
}

function createOPFS(): OPFSService {
  return {
    writeSession: vi.fn().mockResolvedValue({ chunks: [] }),
    deleteSessionData: vi.fn().mockResolvedValue(undefined),
  } as unknown as OPFSService;
}

interface PoolStats {
  /** Peak simultaneously-parsing files across the whole pool. */
  maxInFlight: number;
  shutdown: boolean;
}

/**
 * Pool factory that parses real EDF with a configurable per-file delay so
 * look-ahead is observable, and tracks peak concurrent parses (the signal a
 * byte-budget violation would surface as).
 */
function createPoolFactory(
  stats: PoolStats,
  delayMs = 4,
  resolveVia: 'macrotask' | 'microtask' = 'macrotask',
): { factory: EDFWorkerPoolFactory } {
  const factory: EDFWorkerPoolFactory = () => {
    const parser = new EDFParser();
    const interpreter = new ResMedInterpreter();
    const validator = new Validator();
    let inFlight = 0;

    const pool = {
      busyWorkerCount: 0,
      maxPoolSize: 4,
      submit<R>(taskFn: (proxy: unknown) => Promise<R>): Promise<R> {
        inFlight++;
        stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
        const proxy = {
          async parseEDFFile(buffer: ArrayBuffer, includeEdf = false): Promise<ParseResult> {
            if (resolveVia === 'microtask') {
              // Resolve across microtasks only (no macrotask boundary) — the
              // interleaving most likely to expose a producer/consumer slot
              // assignment race when the budget gate blocks.
              await Promise.resolve();
              await Promise.resolve();
            } else {
              await new Promise((r) => setTimeout(r, delayMs));
            }
            const fileHash = await sha256Hex(buffer);
            const edf = parser.parse(buffer);
            const interpretation = interpreter.interpret(edf);
            const validation = validator.validateEDF(edf);
            return { edf: includeEdf ? edf : undefined, interpretation, validation, fileHash };
          },
        };
        return taskFn(proxy).finally(() => {
          inFlight--;
        });
      },
      shutdown(): Promise<void> {
        stats.shutdown = true;
        return Promise.resolve();
      },
    } as unknown as WorkerPool<EDFParserWorkerAPI>;

    return pool;
  };
  return { factory };
}

/** A no-op single-worker fallback factory (unused when a pool is supplied). */
function fallbackWorkerFactory(): EDFWorkerFactory {
  return () =>
    ({
      proxy: {
        async parseEDFFile(): Promise<ParseResult> {
          throw new Error('fallback worker should not be used');
        },
      },
      dispose: vi.fn(),
    }) as unknown as WrappedWorker<EDFParserWorkerAPI>;
}

/** Build N day-groups, each one BRP file under a distinct YYYYMMDD folder. */
function makeDays(count: number, inflateTo?: number): File[] {
  const brp = loadFixtureBuffer('brp-airsense11.edf');
  const files: File[] = [];
  for (let i = 0; i < count; i++) {
    const day = `202401${String(i + 1).padStart(2, '0')}`;
    files.push(
      createFile(`${day}_220145_BRP.edf`, brp, `DATALOG/${day}/${day}_220145_BRP.edf`, inflateTo),
    );
  }
  return files;
}

describe('ImportService — bounded look-ahead pipeline (ADR 0029)', () => {
  // -----------------------------------------------------------------------
  // Identical output + counts vs. baseline; store in day order
  // -----------------------------------------------------------------------

  it('stores every day-group single-flight and advances dayGroupsProcessed in day order', async () => {
    const stats: PoolStats = { maxInFlight: 0, shutdown: false };
    const { factory } = createPoolFactory(stats, 4);
    const { idb, stored } = createRecordingIDB();
    const opfs = createOPFS();

    // Single-flight detector: assert no two stores overlap. We wrap the IDB
    // writer to mark "storing" across an async hop; if a second store began
    // while one is in flight, that is a single-flight violation.
    let storing = false;
    let overlapDetected = false;
    vi.mocked(idb.addSessionWithRelated).mockImplementation(
      async (s: { id: string; startTime: string; sourceHash: string }) => {
        if (storing) overlapDetected = true;
        storing = true;
        await Promise.resolve();
        await Promise.resolve();
        stored.push({ id: s.id, startTime: s.startTime, sourceHash: s.sourceHash });
        storing = false;
      },
    );

    const service = new ImportService(idb, opfs, fallbackWorkerFactory(), factory);

    const dayProgress: number[] = [];
    const files = makeDays(6);
    const result = await service.importFiles(files, {
      sourceType: 'file',
      skipDuplicates: false,
      onProgress: (p) => {
        if (typeof p.dayGroupsProcessed === 'number') dayProgress.push(p.dayGroupsProcessed);
      },
    });

    // Same fixture under distinct day folders → distinct sessions, all stored.
    expect(result.sessionsImported).toBe(6);
    expect(stored).toHaveLength(6);

    // Store stayed strictly single-flight (no two stores ever overlapped).
    expect(overlapDetected).toBe(false);

    // dayGroupsProcessed advances monotonically 1..6 (store order = day order),
    // never going backwards even though parsing ran ahead.
    let prev = 0;
    for (const v of dayProgress) {
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(dayProgress[dayProgress.length - 1]).toBe(6);
  });

  it('produces identical counts whether the pool runs fast or slow (parse-ahead invariant)', async () => {
    const run = async (delayMs: number): Promise<number> => {
      const stats: PoolStats = { maxInFlight: 0, shutdown: false };
      const { factory } = createPoolFactory(stats, delayMs);
      const { idb, stored } = createRecordingIDB();
      const service = new ImportService(idb, createOPFS(), fallbackWorkerFactory(), factory);
      const result = await service.importFiles(makeDays(8), {
        sourceType: 'file',
        skipDuplicates: false,
        onProgress: vi.fn(),
      });
      expect(result.sessionsImported).toBe(stored.length);
      return stored.length;
    };
    const slow = await run(8);
    const fast = await run(0);
    expect(slow).toBe(8);
    expect(fast).toBe(8);
  });

  // -----------------------------------------------------------------------
  // Within-import duplicate across two pipelined day-groups
  // -----------------------------------------------------------------------

  it('skips a within-import duplicate that spans two pipelined day-groups exactly once', async () => {
    const stats: PoolStats = { maxInFlight: 0, shutdown: false };
    const { factory } = createPoolFactory(stats, 4);
    const { idb, stored } = createRecordingIDB();
    const service = new ImportService(idb, createOPFS(), fallbackWorkerFactory(), factory);

    // The SAME fixture under two different day folders. Both build a session
    // whose natural key (machineId + startTime) is identical (the start time is
    // embedded in the EDF, not the folder), so the second is a within-import
    // duplicate and must be skipped exactly once — even though parsing the two
    // day-groups is pipelined.
    const brp = loadFixtureBuffer('brp-airsense11.edf');
    const files = [
      createFile('20240101_220145_BRP.edf', brp, 'DATALOG/20240101/20240101_220145_BRP.edf'),
      createFile('20240102_220145_BRP.edf', brp, 'DATALOG/20240102/20240102_220145_BRP.edf'),
    ];

    const result = await service.importFiles(files, {
      sourceType: 'file',
      skipDuplicates: true,
      onProgress: vi.fn(),
    });

    expect(result.sessionsImported).toBe(1);
    expect(result.sessionsSkipped).toBe(1);
    expect(stored).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Byte budget bounds the look-ahead
  // -----------------------------------------------------------------------

  it('bounds in-flight parsed bytes by the 64 MB budget (does not parse all days at once)', async () => {
    const stats: PoolStats = { maxInFlight: 0, shutdown: false };
    // Slow store so the producer has every chance to race far ahead; slow parse
    // so several files can be in flight together if the budget did not gate.
    const { factory } = createPoolFactory(stats, 3);
    const { idb } = createRecordingIDB();
    const opfs = createOPFS();
    // Make the store slow to widen the window for unbounded look-ahead.
    vi.mocked(opfs.writeSession).mockImplementation(
      async () => new Promise((r) => setTimeout(() => r({ chunks: [] } as never), 10)),
    );
    const service = new ImportService(idb, opfs, fallbackWorkerFactory(), factory);

    // 10 day-groups, each inflated to ~24 MB → 3 in flight ≈ 72 MB > 64 MB
    // budget, so the producer must throttle. If the budget were ignored, all 10
    // (~240 MB) would be parsed up front and maxInFlight would reach ~10.
    const inflate = 24 * 1024 * 1024;
    const files = makeDays(10, inflate);

    const result = await service.importFiles(files, {
      sourceType: 'file',
      skipDuplicates: false,
      onProgress: vi.fn(),
    });

    expect(result.sessionsImported).toBe(10);

    // The producer may admit one over-budget day beyond the resolved set, so the
    // resolved-but-unconsumed bytes peak at < budget + one day. With ~24 MB
    // days, that is at most 3 days' worth of parses overlapping — far below the
    // 10 that an unbounded producer would reach.
    const maxDaysInFlightByBytes = Math.ceil(PIPELINE_BYTE_BUDGET / inflate) + 1; // 3 + 1
    expect(stats.maxInFlight).toBeLessThanOrEqual(maxDaysInFlightByBytes);
    expect(stats.maxInFlight).toBeLessThan(10);
  });

  it('lets a single oversized day (alone exceeding the budget) still progress', async () => {
    const stats: PoolStats = { maxInFlight: 0, shutdown: false };
    const { factory } = createPoolFactory(stats, 2);
    const { idb, stored } = createRecordingIDB();
    const service = new ImportService(idb, createOPFS(), fallbackWorkerFactory(), factory);

    // Three days, EACH inflated to 80 MB — every single day alone exceeds the
    // 64 MB budget. The "always admit at least one" rule must keep the pipeline
    // moving rather than deadlocking on the budget gate.
    const files = makeDays(3, 80 * 1024 * 1024);

    const result = await service.importFiles(files, {
      sourceType: 'file',
      skipDuplicates: false,
      onProgress: vi.fn(),
    });

    expect(result.sessionsImported).toBe(3);
    expect(stored).toHaveLength(3);
  });

  it.each(['macrotask', 'microtask'] as const)(
    'stores every day-group (none skipped, no hang) with %s-resolving parses when many days each exceed the budget',
    async (resolveVia) => {
      const stats: PoolStats = { maxInFlight: 0, shutdown: false };
      const { factory } = createPoolFactory(stats, 1, resolveVia);
      const { idb, stored } = createRecordingIDB();
      const service = new ImportService(idb, createOPFS(), fallbackWorkerFactory(), factory);

      // 5 days, EACH inflated past the 64 MB budget, so the producer's admission
      // gate blocks on EVERY iteration (the always-admit-one path runs each time).
      // The consumer must never await a not-yet-assigned slot and silently skip a
      // day — guaranteed by the load-bearing per-iteration checkpoint macrotask.
      // The `microtask` style (parses resolving with no macrotask boundary) is the
      // interleaving most likely to expose a slot race and is otherwise uncovered
      // (RCA 2026-06-24).
      const files = makeDays(5, 70 * 1024 * 1024);

      const run = service.importFiles(files, {
        sourceType: 'file',
        skipDuplicates: false,
        onProgress: vi.fn(),
      });
      // Fail fast instead of hanging the suite if a slot-ordering regression
      // deadlocks the pipeline.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('TIMEOUT: pipeline did not settle — slot-ordering regressed')),
          20000,
        ),
      );
      const result = await Promise.race([run, timeout]);

      expect(result.sessionsImported).toBe(5);
      expect(stored).toHaveLength(5);
    },
    30000,
  );

  // -----------------------------------------------------------------------
  // Cancellation mid-pipeline
  // -----------------------------------------------------------------------

  it('aborts promptly mid-pipeline and leaves a consistent partial commit', async () => {
    const stats: PoolStats = { maxInFlight: 0, shutdown: false };
    const { factory } = createPoolFactory(stats, 3);
    const { idb, stored } = createRecordingIDB();
    const opfs = createOPFS();
    const controller = new AbortController();

    let storeCount = 0;
    vi.mocked(idb.addSessionWithRelated).mockImplementation(
      async (s: { id: string; startTime: string; sourceHash: string }) => {
        await Promise.resolve();
        stored.push({ id: s.id, startTime: s.startTime, sourceHash: s.sourceHash });
        storeCount++;
        // Abort after the first couple of day-groups commit. The next per-day
        // checkpoint must surface the abort and stop further stores.
        if (storeCount === 2) controller.abort();
      },
    );

    const service = new ImportService(idb, opfs, fallbackWorkerFactory(), factory);

    const files = makeDays(20); // YIELD_EVERY is 10; abort lands well before the end.
    await expect(
      service.importFiles(files, {
        sourceType: 'file',
        skipDuplicates: false,
        signal: controller.signal,
        onProgress: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ImportAbortedError);

    // Stopped promptly: far fewer than all 20 days committed, and what DID commit
    // stayed consistent (every committed session is a complete row).
    expect(stored.length).toBeGreaterThanOrEqual(2);
    expect(stored.length).toBeLessThan(20);
    for (const s of stored) {
      expect(s.id).toBeTruthy();
      expect(s.sourceHash).toBeTruthy();
    }
    expect(stats.shutdown).toBe(true);
  });

  it('shuts down the pool even when the import is aborted', async () => {
    const stats: PoolStats = { maxInFlight: 0, shutdown: false };
    const { factory } = createPoolFactory(stats, 2);
    const { idb } = createRecordingIDB();
    const controller = new AbortController();
    controller.abort();
    const service = new ImportService(idb, createOPFS(), fallbackWorkerFactory(), factory);

    await expect(
      service.importFiles(makeDays(4), {
        sourceType: 'file',
        signal: controller.signal,
        onProgress: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ImportAbortedError);

    expect(stats.shutdown).toBe(true);
  });
});
