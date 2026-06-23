/**
 * Regression test for the worker-boundary structured-clone failure path.
 *
 * When a value crossing the worker boundary cannot be cloned, `postMessage`/
 * Comlink rejects with a `DataCloneError`. That is a PROGRAMMING bug, not a
 * recoverable problem with the user's data: it means the import stored NOTHING.
 * `parseAndStoreDataTypeViaWorker` previously classified any non-abort error as
 * a recoverable per-file parser error and pressed on, so a `DataCloneError`
 * caused the import to report SUCCESS with zero records imported. These tests
 * pin the hardened behaviour: a clone failure unwinds the import as a hard
 * failure (the `import()` promise rejects) rather than being swallowed.
 *
 * @module services/import/googlehealth/__tests__/GoogleHealthImportService.cloneFailure
 */

import { describe, it, expect, vi } from 'vitest';

import { GoogleHealthImportService } from '../GoogleHealthImportService';
import type { FitbitParserWorkerAPI } from '@/services/workers/fitbitParser.worker';
import type { WorkerPool } from '@/services/workers/WorkerPool';
import type { IndexedDBService } from '@/services/storage/IndexedDBService';
import type { GoogleHealthScanResult, GoogleHealthDataTypeInfo } from '@/types/fitbit';

// Keep the real scanner but resolve the directory handle straight through.
vi.mock('../scanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scanner')>();
  return {
    ...actual,
    resolveRoot: (h: FileSystemDirectoryHandle) => Promise.resolve(h),
  };
});

// ---------------------------------------------------------------------------
// Fixtures (minimal — the parse never completes; the pool rejects)
// ---------------------------------------------------------------------------

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

/** Minimal DB stub: nothing should ever be stored on the clone-failure path. */
function createMockDB(): { db: IndexedDBService; state: { stored: number } } {
  const state = { stored: 0 };
  const bump = (): Promise<void> => {
    state.stored++;
    return Promise.resolve();
  };
  const db = {
    getIntegrationTimeseriesByKey: () => Promise.resolve(undefined),
    getIntegrationDailySummaryByKey: () => Promise.resolve(undefined),
    bulkAddIntegrationTimeseries: bump,
    addIntegrationTimeseries: bump,
    bulkAddIntegrationDailySummaries: bump,
    addIntegrationDailySummary: bump,
    addIntegrationImportRecord: () => Promise.resolve(),
  } as unknown as IndexedDBService;
  return { db, state };
}

/**
 * Worker pool whose `submit` rejects with the given error, simulating a
 * `postMessage`/Comlink structured-clone failure.
 */
function createRejectingPoolFactory(error: unknown): () => WorkerPool<FitbitParserWorkerAPI> {
  return () =>
    ({
      submit: () => Promise.reject(error),
      shutdown: () => Promise.resolve(),
    }) as unknown as WorkerPool<FitbitParserWorkerAPI>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoogleHealthImportService — worker structured-clone failure', () => {
  const files = new Map<string, File>([
    ['hr-2024-01-01.json', makeFile('hr-2024-01-01.json', '[]')],
  ]);
  const fileNames = [...files.keys()];

  it('rejects the import (hard failure) when the worker rejects with a DataCloneError DOMException', async () => {
    const mock = createMockDB();
    const cloneError = new DOMException('callback could not be cloned.', 'DataCloneError');
    const service = new GoogleHealthImportService(mock.db, createRejectingPoolFactory(cloneError));

    await expect(
      service.import(makeDirHandle(files), hrScanResult(fileNames, 1), {
        selectedDataTypes: ['heart_rate_intraday'],
        skipDuplicates: true,
      }),
    ).rejects.toBe(cloneError);

    // Nothing should have been stored — the import did not silently succeed.
    expect(mock.state.stored).toBe(0);
  });

  it('also rejects for a plain Error whose name is DataCloneError', async () => {
    const mock = createMockDB();
    const cloneError = Object.assign(new Error('could not be cloned'), { name: 'DataCloneError' });
    const service = new GoogleHealthImportService(mock.db, createRejectingPoolFactory(cloneError));

    await expect(
      service.import(makeDirHandle(files), hrScanResult(fileNames, 1), {
        selectedDataTypes: ['heart_rate_intraday'],
        skipDuplicates: true,
      }),
    ).rejects.toBe(cloneError);
    expect(mock.state.stored).toBe(0);
  });

  it('still treats a genuine (non-clone) per-file parser error as recoverable', async () => {
    const mock = createMockDB();
    const parseError = new Error('Unexpected token in JSON');
    const service = new GoogleHealthImportService(mock.db, createRejectingPoolFactory(parseError));

    // A real parse failure must NOT reject the import — it is collected and the
    // import completes (with zero imported, the error recorded).
    const record = await service.import(makeDirHandle(files), hrScanResult(fileNames, 1), {
      selectedDataTypes: ['heart_rate_intraday'],
      skipDuplicates: true,
    });

    expect(record.recordsImported).toBe(0);
    expect(record.recordsErrored).toBeGreaterThanOrEqual(1);
    expect(record.errors.some((e) => /Unexpected token/.test(e.error))).toBe(true);
  });
});
