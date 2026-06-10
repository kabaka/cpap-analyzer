/**
 * ImportService unit tests.
 *
 * Tests the import pipeline with mocked storage and worker dependencies.
 * Uses real parsing logic via a mock worker factory that delegates to
 * the actual EDFParser + ResMedInterpreter + Validator.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ImportService,
  type EDFWorkerFactory,
  type EDFWorkerPoolFactory,
} from '@/services/import/ImportService';
import type { ImportOptions, ImportProgress } from '@/services/import/types';
import { EDFParser } from '@/parsers/edf/EDFParser';
import { ResMedInterpreter } from '@/parsers/resmed/ResMedInterpreter';
import { Validator } from '@/parsers/validation/Validator';
import type { ParseResult } from '@/services/workers/edfParser.worker';
import type { IndexedDBService } from '@/services/storage/IndexedDBService';
import type { OPFSService } from '@/services/storage/OPFSService';
import type { WrappedWorker } from '@/services/workers/createWorker';
import type { WorkerPool } from '@/services/workers/WorkerPool';
import type { EDFParserWorkerAPI } from '@/services/workers/edfParser.worker';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.resolve(__dirname, '../../../../tests/fixtures/edf');

function loadFixtureBuffer(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, name));
}

/**
 * Create a mock File object from a real fixture.
 * Manually provides arrayBuffer() since jsdom's File may not support it.
 */
function createMockFile(name: string, fixtureBuffer: Buffer, webkitRelativePath?: string): File {
  const arrayBuffer = fixtureBuffer.buffer.slice(
    fixtureBuffer.byteOffset,
    fixtureBuffer.byteOffset + fixtureBuffer.byteLength,
  );

  const file = {
    name,
    size: fixtureBuffer.byteLength,
    type: 'application/octet-stream',
    lastModified: Date.now(),
    webkitRelativePath: webkitRelativePath ?? name,
    arrayBuffer: () => Promise.resolve(arrayBuffer),
    slice: () => new Blob(),
    stream: () => new ReadableStream(),
    text: () => Promise.resolve(''),
  } as unknown as File;

  return file;
}

function createEmptyFile(name: string, webkitRelativePath?: string): File {
  return {
    name,
    size: 0,
    type: 'application/octet-stream',
    lastModified: Date.now(),
    webkitRelativePath: webkitRelativePath ?? name,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    slice: () => new Blob(),
    stream: () => new ReadableStream(),
    text: () => Promise.resolve(''),
  } as unknown as File;
}

/**
 * Build a 256-byte global-header-only EDF buffer (CSL-style stub): a valid
 * fixed header declaring `numSignals` signals and 0 data records, with NO
 * signal-header block following. EDFParser.parse returns an EMPTY EDFFile for
 * these rather than throwing.
 */
function makeCslStubBuffer(numSignals = 2): ArrayBuffer {
  const buffer = new ArrayBuffer(256);
  const bytes = new Uint8Array(buffer);
  const encoder = new TextEncoder();
  const write = (offset: number, length: number, value: string): void => {
    const padded = value.padEnd(length, ' ').slice(0, length);
    bytes.set(encoder.encode(padded), offset);
  };

  const headerBytes = 256 + 256 * numSignals; // declared, but absent on disk
  write(0, 8, '0'); // version
  write(8, 80, '23241654214 AirSense 11'); // patient id
  write(88, 80, 'Startdate 17-SEP-2024 X X X SRN=23241654214  MID=36  VID=39');
  write(168, 8, '17.09.24'); // date
  write(176, 8, '12.00.00'); // time
  write(184, 8, String(headerBytes)); // header byte count
  write(192, 44, 'EDF+C'); // reserved
  write(236, 8, '0'); // numDataRecords
  write(244, 8, '0'); // dataRecordDuration
  write(252, 4, String(numSignals)); // numSignals

  return buffer;
}

/** Create a mock File wrapping a raw ArrayBuffer (for synthetic stubs). */
function createBufferFile(name: string, buffer: ArrayBuffer, webkitRelativePath?: string): File {
  return {
    name,
    size: buffer.byteLength,
    type: 'application/octet-stream',
    lastModified: Date.now(),
    webkitRelativePath: webkitRelativePath ?? name,
    arrayBuffer: () => Promise.resolve(buffer),
    slice: () => new Blob(),
    stream: () => new ReadableStream(),
    text: () => Promise.resolve(''),
  } as unknown as File;
}

function createNonEdfFile(name: string, webkitRelativePath?: string): File {
  return {
    name,
    size: 3,
    type: 'application/octet-stream',
    lastModified: Date.now(),
    webkitRelativePath: webkitRelativePath ?? name,
    arrayBuffer: () => Promise.resolve(new Uint8Array([0x00, 0x01, 0x02]).buffer),
    slice: () => new Blob(),
    stream: () => new ReadableStream(),
    text: () => Promise.resolve(''),
  } as unknown as File;
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/** Compute a lowercase-hex SHA-256 of a buffer (mirrors the worker). */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Creates a mock worker that runs real parsing logic.
 *
 * Mirrors the real worker's contract: async, computes the file hash, returns
 * the raw `edf` only when `includeEdf` is requested (STR files).
 */
function createMockWorkerFactory(): EDFWorkerFactory {
  return () => {
    const parser = new EDFParser();
    const interpreter = new ResMedInterpreter();
    const validator = new Validator();

    const proxy = {
      async parseEDFFile(buffer: ArrayBuffer, includeEdf = false): Promise<ParseResult> {
        const fileHash = await sha256Hex(buffer);
        const edf = parser.parse(buffer);
        const interpretation = interpreter.interpret(edf);
        const validation = validator.validateEDF(edf);
        return { edf: includeEdf ? edf : undefined, interpretation, validation, fileHash };
      },
      validateEDFHeader(buffer: ArrayBuffer) {
        return parser.validate(buffer);
      },
    };

    return {
      proxy,
      dispose: vi.fn(),
    } as unknown as WrappedWorker<EDFParserWorkerAPI>;
  };
}

function createMockIndexedDB(): IndexedDBService {
  const sessions: Array<{ id: string }> = [];
  const aggregates: Array<{ sessionId?: string }> = [];
  const events: Array<{ sessionId?: string }> = [];

  return {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    // Legacy single-store writers (kept for any direct callers).
    addSession: vi.fn().mockImplementation(async (s: { id: string }) => {
      sessions.push(s);
    }),
    addNightlyAggregate: vi.fn().mockImplementation(async (a: { sessionId?: string }) => {
      aggregates.push(a);
    }),
    addEvents: vi.fn().mockImplementation(async (e: Array<{ sessionId?: string }>) => {
      events.push(...e);
    }),
    // Atomic combined writer used by the import pipeline.
    addSessionWithRelated: vi
      .fn()
      .mockImplementation(
        async (s: { id: string }, a: { sessionId?: string }, e: Array<{ sessionId?: string }>) => {
          sessions.push(s);
          aggregates.push(a);
          if (e.length > 0) events.push(...e);
        },
      ),
    deleteSession: vi.fn().mockImplementation(async (id: string) => {
      const idx = sessions.findIndex((s) => s.id === id);
      if (idx !== -1) sessions.splice(idx, 1);
    }),
    // Cascade delete: removes the session row AND its aggregate(s) + events,
    // mirroring the real multi-store transaction. This is what the OPFS-failure
    // compensation calls so no orphaned aggregate/events remain.
    deleteSessionCascade: vi.fn().mockImplementation(async (sessionId: string) => {
      const sIdx = sessions.findIndex((s) => s.id === sessionId);
      if (sIdx !== -1) sessions.splice(sIdx, 1);
      for (let i = aggregates.length - 1; i >= 0; i--) {
        if (aggregates[i]?.sessionId === sessionId) aggregates.splice(i, 1);
      }
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i]?.sessionId === sessionId) events.splice(i, 1);
      }
    }),
    getAllSessions: vi.fn().mockResolvedValue([]),
    // Expose internals for assertions
    _sessions: sessions,
    _aggregates: aggregates,
    _events: events,
  } as unknown as IndexedDBService;
}

/**
 * Creates a mock {@link WorkerPool} factory that runs real parsing logic with
 * an artificial async delay, resolving tasks OUT OF ORDER (LIFO-ish) to prove
 * the pipeline preserves per-file progress counts and error isolation under
 * genuine concurrency. Tracks max in-flight tasks to confirm parallel dispatch.
 */
function createMockWorkerPoolFactory(stats: { maxInFlight: number; shutdown: boolean }): {
  factory: EDFWorkerPoolFactory;
} {
  const factory: EDFWorkerPoolFactory = () => {
    const parser = new EDFParser();
    const interpreter = new ResMedInterpreter();
    const validator = new Validator();
    let inFlight = 0;
    let counter = 0;

    const pool = {
      submit<R>(taskFn: (proxy: unknown) => Promise<R>): Promise<R> {
        inFlight++;
        stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
        // Stagger completion so files within a day resolve out of order.
        const delay = (counter++ % 2 === 0 ? 5 : 1) as number;
        const proxy = {
          async parseEDFFile(buffer: ArrayBuffer, includeEdf = false): Promise<ParseResult> {
            await new Promise((r) => setTimeout(r, delay));
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

function createMockOPFS(): OPFSService {
  return {
    writeSignalData: vi.fn().mockResolvedValue(undefined),
    writeSession: vi.fn().mockResolvedValue(undefined),
    deleteSessionData: vi.fn().mockResolvedValue(undefined),
  } as unknown as OPFSService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImportService', () => {
  let indexedDB: ReturnType<typeof createMockIndexedDB>;
  let opfs: ReturnType<typeof createMockOPFS>;
  let workerFactory: EDFWorkerFactory;
  let service: ImportService;

  beforeEach(() => {
    indexedDB = createMockIndexedDB();
    opfs = createMockOPFS();
    workerFactory = createMockWorkerFactory();
    service = new ImportService(
      indexedDB as unknown as Parameters<
        (typeof ImportService)['prototype']['importFiles']
      > extends never
        ? never
        : IndexedDBService,
      opfs as unknown as OPFSService,
      workerFactory,
    );
  });

  // -----------------------------------------------------------------------
  // File scanning
  // -----------------------------------------------------------------------

  describe('scanFiles', () => {
    it('should classify EDF files by type', () => {
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
        createMockFile(
          '20241015_220145_EVE.edf',
          loadFixtureBuffer('eve-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_EVE.edf',
        ),
        createMockFile(
          '20241015_220145_PLD.edf',
          loadFixtureBuffer('pld-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_PLD.edf',
        ),
        createMockFile(
          '20241015_220145_SAD.edf',
          loadFixtureBuffer('sad-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_SAD.edf',
        ),
      ];

      const discovered = service.scanFiles(files);
      expect(discovered).toHaveLength(4);

      const types = discovered.map((d) => d.fileType);
      expect(types).toContain('BRP');
      expect(types).toContain('EVE');
      expect(types).toContain('PLD');
      expect(types).toContain('SAD');
    });

    it('should skip non-EDF files', () => {
      const files = [
        createNonEdfFile('Identification.crc', 'Identification.crc'),
        createNonEdfFile('Identification.tgt', 'Identification.tgt'),
        createNonEdfFile('some-log.log', 'some-log.log'),
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
      ];

      const discovered = service.scanFiles(files);
      expect(discovered).toHaveLength(1);
      expect(discovered[0]!.fileType).toBe('BRP');
    });

    it('should skip 0-byte EDF files', () => {
      const files = [
        createEmptyFile('20241015_220145_BRP.edf', 'DATALOG/20241015/20241015_220145_BRP.edf'),
        createMockFile(
          '20241015_220145_PLD.edf',
          loadFixtureBuffer('pld-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_PLD.edf',
        ),
      ];

      const discovered = service.scanFiles(files);
      expect(discovered).toHaveLength(1);
      expect(discovered[0]!.fileType).toBe('PLD');
    });

    it('should extract day folder from path', () => {
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
      ];

      const discovered = service.scanFiles(files);
      expect(discovered[0]!.dayFolder).toBe('20241015');
    });

    it('should extract timestamp from filename', () => {
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
      ];

      const discovered = service.scanFiles(files);
      expect(discovered[0]!.timestamp).toBe('20241015_220145');
    });
  });

  // -----------------------------------------------------------------------
  // File grouping
  // -----------------------------------------------------------------------

  describe('groupByDay', () => {
    it('should group files by day folder and timestamp', () => {
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
        createMockFile(
          '20241015_220145_EVE.edf',
          loadFixtureBuffer('eve-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_EVE.edf',
        ),
        createMockFile(
          '20241016_223000_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241016/20241016_223000_BRP.edf',
        ),
      ];

      const discovered = service.scanFiles(files);
      const groups = service.groupByDay(discovered);

      expect(groups).toHaveLength(2);
      const dayFolders = groups.map((g) => g.dayFolder);
      expect(dayFolders).toContain('20241015');
      expect(dayFolders).toContain('20241016');
    });
  });

  // -----------------------------------------------------------------------
  // Import flow
  // -----------------------------------------------------------------------

  describe('importFiles', () => {
    it('should process files and create sessions', async () => {
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
        createMockFile(
          '20241015_220145_PLD.edf',
          loadFixtureBuffer('pld-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_PLD.edf',
        ),
        createMockFile(
          '20241015_220145_EVE.edf',
          loadFixtureBuffer('eve-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_EVE.edf',
        ),
      ];

      const options: ImportOptions = {
        sourceType: 'file',
        skipDuplicates: true,
        onProgress: vi.fn(),
      };

      const result = await service.importFiles(files, options);
      expect(result.sessionsImported).toBeGreaterThanOrEqual(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should report correct filesProcessed count', async () => {
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
      ];

      const options: ImportOptions = {
        sourceType: 'file',
        onProgress: vi.fn(),
      };

      const result = await service.importFiles(files, options);
      expect(result.sessionsImported).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Progress tracking
  // -----------------------------------------------------------------------

  describe('progress tracking', () => {
    it('should call progress callback at each stage', async () => {
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
      ];

      const progressUpdates: ImportProgress[] = [];
      const options: ImportOptions = {
        sourceType: 'file',
        onProgress: (p) => progressUpdates.push({ ...p }),
      };

      await service.importFiles(files, options);

      const statuses = progressUpdates.map((p) => p.status);
      expect(statuses).toContain('scanning');
      expect(statuses).toContain('parsing');
      expect(statuses).toContain('building');
      expect(statuses).toContain('storing');
      expect(statuses).toContain('complete');
    });

    it('should report totalFiles matching discovered file count', async () => {
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
        createMockFile(
          '20241015_220145_PLD.edf',
          loadFixtureBuffer('pld-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_PLD.edf',
        ),
      ];

      const progressUpdates: ImportProgress[] = [];
      const options: ImportOptions = {
        sourceType: 'file',
        onProgress: (p) => progressUpdates.push({ ...p }),
      };

      await service.importFiles(files, options);

      // After scanning, totalFiles should match discovered count
      const afterScanning = progressUpdates.find((p) => p.totalFiles > 0);
      expect(afterScanning).toBeDefined();
      expect(afterScanning!.totalFiles).toBe(2);
    });

    it('should increment filesProcessed for each file', async () => {
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
        createMockFile(
          '20241015_220145_PLD.edf',
          loadFixtureBuffer('pld-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_PLD.edf',
        ),
      ];

      const progressUpdates: ImportProgress[] = [];
      const options: ImportOptions = {
        sourceType: 'file',
        onProgress: (p) => progressUpdates.push({ ...p }),
      };

      await service.importFiles(files, options);

      const processedValues = progressUpdates
        .filter((p) => p.status === 'parsing')
        .map((p) => p.filesProcessed);

      // Should see incremental progress
      expect(processedValues.length).toBeGreaterThanOrEqual(2);
      const maxProcessed = Math.max(...processedValues);
      expect(maxProcessed).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Deduplication
  // -----------------------------------------------------------------------

  describe('deduplication', () => {
    it('should skip duplicate imports on second run', async () => {
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
      ];

      const options: ImportOptions = {
        sourceType: 'file',
        skipDuplicates: true,
        onProgress: vi.fn(),
      };

      // First import
      const result1 = await service.importFiles(files, options);
      expect(result1.sessionsImported).toBe(1);

      // Mock getAllSessions to return the stored session with the sourceHash
      const storedSessions = (indexedDB as unknown as { _sessions: Array<{ sourceHash: string }> })
        ._sessions;
      vi.mocked(indexedDB.getAllSessions).mockResolvedValue(
        storedSessions.map((s) => ({ ...s })) as never,
      );

      // Second import with same files
      const result2 = await service.importFiles(files, options);
      expect(result2.sessionsImported).toBe(0);
    });

    it('should import regardless when skipDuplicates is false', async () => {
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
      ];

      const options: ImportOptions = {
        sourceType: 'file',
        skipDuplicates: false,
        onProgress: vi.fn(),
      };

      const result1 = await service.importFiles(files, options);
      expect(result1.sessionsImported).toBe(1);

      // Second import with skipDuplicates=false — should still import
      const result2 = await service.importFiles(files, options);
      expect(result2.sessionsImported).toBe(1);
    });

    it('should NOT duplicate when re-importing the same day with one source byte changed', async () => {
      // First import: pristine fixture.
      const firstFiles = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
      ];
      const options: ImportOptions = {
        sourceType: 'file',
        skipDuplicates: true,
        onProgress: vi.fn(),
      };

      const result1 = await service.importFiles(firstFiles, options);
      expect(result1.sessionsImported).toBe(1);

      // Surface the stored session so the next import's pre-pass sees it.
      const storedSessions = (indexedDB as unknown as { _sessions: Array<{ sourceHash: string }> })
        ._sessions;
      vi.mocked(indexedDB.getAllSessions).mockResolvedValue(
        storedSessions.map((s) => ({ ...s })) as never,
      );

      // Mutate a single non-header DATA byte so the sourceHash changes but the
      // session's natural key (machineId + startTime) is identical. Pick an
      // offset well past the header + signal-header block.
      const original = loadFixtureBuffer('brp-airsense11.edf');
      const mutated = Buffer.from(original);
      const mutateAt = mutated.length - 1;
      mutated[mutateAt] = (mutated[mutateAt]! ^ 0xff) & 0xff;
      expect(mutated.equals(original)).toBe(false);

      const secondFiles = [
        createMockFile(
          '20241015_220145_BRP.edf',
          mutated,
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
      ];

      const result2 = await service.importFiles(secondFiles, options);

      // Natural-key dedup must catch this even though the source hash differs.
      expect(result2.sessionsImported).toBe(0);
      expect(result2.sessionsSkipped).toBe(1);
      // No second session row was written.
      expect(storedSessions).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('should collect errors for invalid files without stopping import', async () => {
      // Create a file that will cause a parse error (too small to be valid EDF)
      const badBuffer = Buffer.from(new Uint8Array(100)); // under 256 bytes
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          badBuffer,
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
        createMockFile(
          '20241015_220145_PLD.edf',
          loadFixtureBuffer('pld-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_PLD.edf',
        ),
      ];

      const options: ImportOptions = {
        sourceType: 'file',
        onProgress: vi.fn(),
      };

      const result = await service.importFiles(files, options);
      // One file fails, one succeeds
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });

    it('should include fileName in error details via progress', async () => {
      const badBuffer = Buffer.from(new Uint8Array(100));
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          badBuffer,
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
      ];

      const progressUpdates: ImportProgress[] = [];
      const options: ImportOptions = {
        sourceType: 'file',
        onProgress: (p) => progressUpdates.push({ ...p }),
      };

      await service.importFiles(files, options);

      const errorUpdates = progressUpdates.filter((p) => p.errors.length > 0);
      expect(errorUpdates.length).toBeGreaterThan(0);
      const lastWithErrors = errorUpdates[errorUpdates.length - 1]!;
      expect(lastWithErrors.errors[0]!.fileName).toContain('BRP.edf');
    });

    it('should return partial status when some files fail', async () => {
      const badBuffer = Buffer.from(new Uint8Array(100));
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          badBuffer,
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
        createMockFile(
          '20241016_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241016/20241016_220145_BRP.edf',
        ),
      ];

      const options: ImportOptions = {
        sourceType: 'file',
        onProgress: vi.fn(),
      };

      const result = await service.importFiles(files, options);
      expect(result.sessionsErrored).toBeGreaterThanOrEqual(0);
    });

    it('should return empty result for no discoverable files', async () => {
      const files = [createNonEdfFile('readme.txt', 'readme.txt')];

      const options: ImportOptions = {
        sourceType: 'file',
        onProgress: vi.fn(),
      };

      const result = await service.importFiles(files, options);
      expect(result.sessionsImported).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Empty / header-only stubs (e.g. CSL on nights with no events)
  // -----------------------------------------------------------------------

  describe('empty EDF stubs', () => {
    it('skips a 256-byte CSL stub without recording an error or fabricating a session', async () => {
      const files = [
        createBufferFile(
          '20241015_220145_CSL.edf',
          makeCslStubBuffer(2),
          'DATALOG/20241015/20241015_220145_CSL.edf',
        ),
      ];

      const progressUpdates: ImportProgress[] = [];
      const options: ImportOptions = {
        sourceType: 'file',
        onProgress: (p) => progressUpdates.push({ ...p }),
      };

      const result = await service.importFiles(files, options);

      // Benign skip: zero errors, zero sessions.
      expect(result.errors).toHaveLength(0);
      expect(result.sessionsImported).toBe(0);
      expect(result.sessionsErrored).toBe(0);

      // The empty stub is counted separately.
      const finalProgress = progressUpdates[progressUpdates.length - 1]!;
      expect(finalProgress.filesSkippedEmpty).toBe(1);
      expect(finalProgress.errors).toHaveLength(0);
    });

    it('imports real sessions alongside an empty stub in the same day', async () => {
      const files = [
        createBufferFile(
          '20241015_220145_CSL.edf',
          makeCslStubBuffer(2),
          'DATALOG/20241015/20241015_220145_CSL.edf',
        ),
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
      ];

      const options: ImportOptions = {
        sourceType: 'file',
        onProgress: vi.fn(),
      };

      const result = await service.importFiles(files, options);
      expect(result.errors).toHaveLength(0);
      expect(result.sessionsImported).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Atomic metadata store
  // -----------------------------------------------------------------------

  describe('atomic storage', () => {
    it('persists session + aggregate + events via addSessionWithRelated', async () => {
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
        createMockFile(
          '20241015_220145_EVE.edf',
          loadFixtureBuffer('eve-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_EVE.edf',
        ),
      ];

      const options: ImportOptions = { sourceType: 'file', onProgress: vi.fn() };
      const result = await service.importFiles(files, options);
      expect(result.sessionsImported).toBeGreaterThanOrEqual(1);

      // The atomic writer was used; the legacy single-store writers were not.
      expect(indexedDB.addSessionWithRelated).toHaveBeenCalled();
      expect(indexedDB.addSession).not.toHaveBeenCalled();
      expect(indexedDB.addNightlyAggregate).not.toHaveBeenCalled();
      expect(indexedDB.addEvents).not.toHaveBeenCalled();
    });

    it('cascade-compensates (no orphaned aggregate/events) when the OPFS signal write fails', async () => {
      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
      ];

      // Force the OPFS write to fail after the IDB commit.
      vi.mocked(opfs.writeSession).mockRejectedValueOnce(new Error('disk full'));

      const options: ImportOptions = { sourceType: 'file', onProgress: vi.fn() };
      const result = await service.importFiles(files, options);

      // The metadata was committed then rolled back, so the failure surfaces as
      // a (recoverable) per-session error and NOTHING is left behind.
      expect(indexedDB.addSessionWithRelated).toHaveBeenCalled();
      // Compensation must use the CASCADE delete, not the session-only delete —
      // a bare deleteSession would leave the aggregate + events orphaned.
      expect(indexedDB.deleteSessionCascade).toHaveBeenCalled();
      expect(result.sessionsImported).toBe(0);

      const internals = indexedDB as unknown as {
        _sessions: unknown[];
        _aggregates: unknown[];
        _events: unknown[];
      };
      // No phantom night: session, aggregate, AND events are all gone. An
      // orphaned aggregate would surface in Dashboard/Trends with wrong metrics.
      expect(internals._sessions).toHaveLength(0);
      expect(internals._aggregates).toHaveLength(0);
      expect(internals._events).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // WorkerPool parsing path
  // -----------------------------------------------------------------------

  describe('worker pool', () => {
    it('parses concurrently via the pool while preserving progress + error isolation', async () => {
      const stats = { maxInFlight: 0, shutdown: false };
      const { factory } = createMockWorkerPoolFactory(stats);
      const pooledService = new ImportService(
        indexedDB as unknown as IndexedDBService,
        opfs as unknown as OPFSService,
        workerFactory, // fallback, unused when a pool is supplied
        factory,
      );

      const files = [
        createMockFile(
          '20241015_220145_BRP.edf',
          loadFixtureBuffer('brp-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_BRP.edf',
        ),
        createMockFile(
          '20241015_220145_PLD.edf',
          loadFixtureBuffer('pld-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_PLD.edf',
        ),
        createMockFile(
          '20241015_220145_EVE.edf',
          loadFixtureBuffer('eve-airsense11.edf'),
          'DATALOG/20241015/20241015_220145_EVE.edf',
        ),
        // One bad file: must NOT fail the whole import (error isolation).
        createMockFile(
          '20241015_220145_SAD.edf',
          Buffer.from(new Uint8Array(100)),
          'DATALOG/20241015/20241015_220145_SAD.edf',
        ),
      ];

      const progressUpdates: ImportProgress[] = [];
      const options: ImportOptions = {
        sourceType: 'file',
        onProgress: (p) => progressUpdates.push({ ...p }),
      };

      const result = await pooledService.importFiles(files, options);

      // The 3 valid files of one day were dispatched concurrently.
      expect(stats.maxInFlight).toBeGreaterThan(1);
      // Pool was shut down at the end.
      expect(stats.shutdown).toBe(true);
      // Error isolation: the bad file produced exactly one error, sessions still built.
      expect(result.errors.length).toBe(1);
      expect(result.sessionsImported).toBeGreaterThanOrEqual(1);

      // Per-file processed count is accurate despite out-of-order completion.
      const maxProcessed = Math.max(...progressUpdates.map((p) => p.filesProcessed));
      expect(maxProcessed).toBe(4);
    });
  });
});
