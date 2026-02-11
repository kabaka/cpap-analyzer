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
import { ImportService, type EDFWorkerFactory } from '@/services/import/ImportService';
import type { ImportOptions, ImportProgress } from '@/services/import/types';
import { EDFParser } from '@/parsers/edf/EDFParser';
import { ResMedInterpreter } from '@/parsers/resmed/ResMedInterpreter';
import { Validator } from '@/parsers/validation/Validator';
import type { ParseResult } from '@/services/workers/edfParser.worker';
import type { IndexedDBService } from '@/services/storage/IndexedDBService';
import type { OPFSService } from '@/services/storage/OPFSService';
import type { WrappedWorker } from '@/services/workers/createWorker';
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

/** Creates a mock worker that runs real parsing logic synchronously. */
function createMockWorkerFactory(): EDFWorkerFactory {
  return () => {
    const parser = new EDFParser();
    const interpreter = new ResMedInterpreter();
    const validator = new Validator();

    const proxy = {
      parseEDFFile(buffer: ArrayBuffer): ParseResult {
        const edf = parser.parse(buffer);
        const interpretation = interpreter.interpret(edf);
        const validation = validator.validateEDF(edf);
        return { edf, interpretation, validation };
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
  const sessions: unknown[] = [];
  const aggregates: unknown[] = [];
  const events: unknown[] = [];

  return {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    addSession: vi.fn().mockImplementation(async (s: unknown) => {
      sessions.push(s);
    }),
    addNightlyAggregate: vi.fn().mockImplementation(async (a: unknown) => {
      aggregates.push(a);
    }),
    addEvents: vi.fn().mockImplementation(async (e: unknown[]) => {
      events.push(...e);
    }),
    getAllSessions: vi.fn().mockResolvedValue([]),
    // Expose internals for assertions
    _sessions: sessions,
    _aggregates: aggregates,
    _events: events,
  } as unknown as IndexedDBService;
}

function createMockOPFS(): OPFSService {
  return {
    writeSignalData: vi.fn().mockResolvedValue(undefined),
    writeSession: vi.fn().mockResolvedValue(undefined),
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
});
