import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ImportController } from '@/services/import/ImportController';
import type { ImportService } from '@/services/import/ImportService';
import type { GoogleHealthImportService } from '@/services/import/googlehealth/GoogleHealthImportService';
import { ImportAbortedError } from '@/services/import/types';
import type {
  ImportOptions,
  ImportProgress,
  GoogleHealthImportProgress,
} from '@/services/import/types';
import type { ImportRecord, IntegrationImportRecord } from '@/types/storage';
import { useImportStore } from '@/stores/useImportStore';
import { useAppStore } from '@/stores/useAppStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseCpapProgress(over: Partial<ImportProgress> = {}): ImportProgress {
  return {
    status: 'parsing',
    totalFiles: 3,
    filesProcessed: 0,
    currentFileName: '',
    bytesRead: 0,
    totalBytes: 300,
    sessionsCreated: 0,
    errors: [],
    startTime: Date.now(),
    warnings: [],
    currentStage: 'Parsing',
    dayGroupsProcessed: 0,
    totalDayGroups: 1,
    sessionsValidated: 0,
    sessionsStored: 0,
    totalSessionsToStore: 0,
    filesSkippedEmpty: 0,
    ...over,
  };
}

const CPAP_RECORD: ImportRecord = {
  id: 'rec-1',
  machineId: 'm1',
  machineModel: 'AirSense 11',
  importedAt: new Date().toISOString(),
  dateRangeStart: '2024-10-15',
  dateRangeEnd: '2024-10-15',
  sessionsImported: 1,
  sessionsSkipped: 0,
  sessionsErrored: 0,
  sourceHash: 'h',
  durationSeconds: 1,
  errors: [],
};

/** A fake ImportService that drives progress then resolves. */
function makeCpapService(
  opts: {
    emit?: ImportProgress[];
    record?: ImportRecord;
    honorSignal?: boolean;
  } = {},
): ImportService {
  const run = async (options: ImportOptions): Promise<ImportRecord> => {
    const updates = opts.emit ?? [
      baseCpapProgress({ status: 'scanning' }),
      baseCpapProgress({ status: 'parsing', filesProcessed: 1, bytesRead: 100 }),
      baseCpapProgress({ status: 'parsing', filesProcessed: 3, bytesRead: 300 }),
      baseCpapProgress({ status: 'complete', filesProcessed: 3, sessionsStored: 1 }),
    ];
    for (const u of updates) {
      if (opts.honorSignal && options.signal?.aborted) {
        throw new ImportAbortedError();
      }
      options.onProgress?.(u);
      // Let microtasks/macrotasks run so an abort can land between emits.
      await new Promise((r) => setTimeout(r, 1));
    }
    if (opts.honorSignal && options.signal?.aborted) {
      throw new ImportAbortedError();
    }
    return opts.record ?? CPAP_RECORD;
  };
  return {
    importFiles: (_files: File[], options: ImportOptions) => run(options),
    importDirectory: (_h: FileSystemDirectoryHandle, options: ImportOptions) => run(options),
  } as unknown as ImportService;
}

function makeFitbitService(record?: IntegrationImportRecord): GoogleHealthImportService {
  return {
    async import(
      _dir: FileSystemDirectoryHandle,
      _scan: unknown,
      options: {
        onProgress?: (p: GoogleHealthImportProgress) => void;
        signal?: AbortSignal;
      },
    ): Promise<IntegrationImportRecord> {
      options.onProgress?.({
        status: 'parsing',
        currentDataType: 'sleep_session',
        dataTypesTotal: 2,
        dataTypesProcessed: 0,
        recordsProcessed: 0,
        recordsTotal: 10,
        recordsSkipped: 0,
        errors: [],
        warnings: [],
        startTime: Date.now(),
        currentStage: 'Importing',
      });
      options.onProgress?.({
        status: 'complete',
        currentDataType: '',
        dataTypesTotal: 2,
        dataTypesProcessed: 2,
        recordsProcessed: 10,
        recordsTotal: 10,
        recordsSkipped: 0,
        errors: [],
        warnings: [],
        startTime: Date.now(),
        currentStage: 'Done',
      });
      return (
        record ?? {
          id: 'fr-1',
          source: 'fitbit',
          importedAt: new Date().toISOString(),
          dateRangeStart: '',
          dateRangeEnd: '',
          dataTypes: [],
          recordsImported: 10,
          recordsSkipped: 0,
          recordsErrored: 0,
          errors: [],
          durationSeconds: 1,
          fileHashes: [],
        }
      );
    },
  } as unknown as GoogleHealthImportService;
}

describe('ImportController', () => {
  let controller: ImportController;

  beforeEach(() => {
    useImportStore.setState({ jobs: {}, activeJobId: null });
    useAppStore.setState({ importStatus: 'idle', importProgress: { current: 0, total: 0 } });
    controller = new ImportController();
  });

  describe('startCpap → progress → complete', () => {
    it('runs to completion, publishing progress and the final result', async () => {
      controller.__resetForTests({ cpapService: makeCpapService() });

      const outcome = controller.startCpap([], { sourceType: 'file', skipDuplicates: true });
      expect(outcome.ok).toBe(true);
      const jobId = outcome.ok ? outcome.jobId : '';

      // The job is immediately visible in the store (seeded snapshot).
      expect(useImportStore.getState().jobs[jobId]?.progress.kind).toBe('cpap');

      await controller.whenIdle('cpap');

      const entry = useImportStore.getState().jobs[jobId];
      expect(entry?.progress.status).toBe('complete');
      expect(entry?.result?.kind).toBe('cpap');
      expect(entry?.result?.record).toEqual(CPAP_RECORD);
      // Coarse mirror landed in the app store.
      expect(useAppStore.getState().importStatus).toBe('complete');
    });

    it('adapts CPAP stages (scan/parse/build/store) into the unified shape', async () => {
      controller.__resetForTests({ cpapService: makeCpapService() });
      const outcome = controller.startCpap([], { sourceType: 'file' });
      const jobId = outcome.ok ? outcome.jobId : '';
      await controller.whenIdle('cpap');

      const stages = useImportStore.getState().jobs[jobId]?.progress.stages ?? [];
      expect(stages.map((s) => s.id)).toEqual(['scan', 'parse', 'build', 'store']);
      expect(stages.find((s) => s.id === 'parse')?.unit).toBe('files');
      expect(stages.find((s) => s.id === 'store')?.unit).toBe('sessions');
    });
  });

  describe('single active job per kind', () => {
    it('rejects a second CPAP start while one is active', async () => {
      controller.__resetForTests({ cpapService: makeCpapService() });
      const first = controller.startCpap([], { sourceType: 'file' });
      const second = controller.startCpap([], { sourceType: 'file' });
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.reason).toBe('busy');
        expect(second.activeJobId).toBe(first.ok ? first.jobId : '');
      }
      await controller.whenIdle('cpap');
    });

    it('allows a CPAP and a Fitbit job concurrently', async () => {
      controller.__resetForTests({
        cpapService: makeCpapService(),
        fitbitService: makeFitbitService(),
      });
      const cpap = controller.startCpap([], { sourceType: 'file' });
      const fitbit = controller.startFitbit({
        dirHandle: {} as FileSystemDirectoryHandle,
        scanResult: { dataTypes: [] } as never,
        selectedDataTypes: ['sleep_session'],
      });
      expect(cpap.ok).toBe(true);
      expect(fitbit.ok).toBe(true);
      await Promise.all([controller.whenIdle('cpap'), controller.whenIdle('fitbit')]);
      expect(useImportStore.getState().jobs[cpap.ok ? cpap.jobId : '']?.progress.status).toBe(
        'complete',
      );
      expect(useImportStore.getState().jobs[fitbit.ok ? fitbit.jobId : '']?.progress.status).toBe(
        'complete',
      );
    });
  });

  describe('cancel actually aborts', () => {
    it('aborts the running job and marks it cancelled (no result, no error)', async () => {
      // A service that honors the signal and emits slowly so cancel can land.
      const slow = makeCpapService({
        honorSignal: true,
        emit: [
          baseCpapProgress({ status: 'parsing', filesProcessed: 1 }),
          baseCpapProgress({ status: 'parsing', filesProcessed: 2 }),
          baseCpapProgress({ status: 'parsing', filesProcessed: 3 }),
        ],
      });
      controller.__resetForTests({ cpapService: slow });

      const outcome = controller.startCpap([], { sourceType: 'file' });
      const jobId = outcome.ok ? outcome.jobId : '';

      // Cancel almost immediately.
      controller.cancel(jobId);
      await controller.whenIdle('cpap');

      const entry = useImportStore.getState().jobs[jobId];
      expect(entry?.progress.status).toBe('cancelled');
      expect(entry?.result).toBeNull();
      expect(entry?.error).toBeNull();
      // Cancelled mirrors to idle coarse status (no dedicated cancelled coarse state).
      expect(useAppStore.getState().importStatus).toBe('idle');
    });
  });

  describe('failure handling', () => {
    it('records a fatal error (not cancelled) when the service throws', async () => {
      const failing = {
        importFiles: vi.fn().mockRejectedValue(new Error('disk full')),
        importDirectory: vi.fn().mockRejectedValue(new Error('disk full')),
      } as unknown as ImportService;
      controller.__resetForTests({ cpapService: failing });

      const outcome = controller.startCpap([], { sourceType: 'file' });
      const jobId = outcome.ok ? outcome.jobId : '';
      await controller.whenIdle('cpap');

      const entry = useImportStore.getState().jobs[jobId];
      expect(entry?.progress.status).toBe('error');
      expect(entry?.error).toBe('disk full');
      expect(useAppStore.getState().importStatus).toBe('error');
    });
  });

  describe('dismiss', () => {
    it('removes a finished job from the store', async () => {
      controller.__resetForTests({ cpapService: makeCpapService() });
      const outcome = controller.startCpap([], { sourceType: 'file' });
      const jobId = outcome.ok ? outcome.jobId : '';
      await controller.whenIdle('cpap');
      controller.dismiss(jobId);
      expect(useImportStore.getState().jobs[jobId]).toBeUndefined();
    });
  });
});
