/**
 * Hook to manage the import workflow: file selection → scanning → importing → complete.
 *
 * Creates ImportService instances on demand, updates the global app store
 * with progress, and supports both File[] and FileSystemDirectoryHandle inputs.
 *
 * @module hooks/useImport
 */

import { useState, useCallback, useRef } from 'react';
import type { ImportProgress } from '@/services/import/types';
import { ImportService } from '@/services/import/ImportService';
import type { EDFWorkerFactory } from '@/services/import/ImportService';
import type { EDFParserWorkerAPI } from '@/services/workers/edfParser.worker';
import { createWorker } from '@/services/workers/createWorker';
import { getDB } from '@/services/storage/getDB';
import { OPFSService } from '@/services/storage/OPFSService';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import type { ImportRecord } from '@/types/storage';

/** The initial idle progress state. */
const IDLE_PROGRESS: ImportProgress = {
  status: 'idle',
  totalFiles: 0,
  filesProcessed: 0,
  currentFileName: '',
  bytesRead: 0,
  totalBytes: 0,
  sessionsCreated: 0,
  errors: [],
  startTime: 0,
  warnings: [],
  currentStage: '',
  dayGroupsProcessed: 0,
  totalDayGroups: 0,
  sessionsValidated: 0,
  sessionsStored: 0,
  totalSessionsToStore: 0,
};

interface UseImportResult {
  /** Start importing from an array of Files (drag-drop / file input). */
  startFileImport: (files: File[]) => Promise<void>;
  /** Start importing from a directory handle (File System Access API). */
  startDirectoryImport: (handle: FileSystemDirectoryHandle) => Promise<void>;
  /** Current import progress. */
  progress: ImportProgress;
  /** Whether an import is currently running. */
  isImporting: boolean;
  /** The final import record after completion. */
  result: ImportRecord | null;
  /** Any fatal error that aborted the import. */
  error: string | null;
  /** Reset state to allow a new import. */
  reset: () => void;
}

/** Create an EDF worker factory for the ImportService. */
function makeWorkerFactory(): EDFWorkerFactory {
  return () =>
    createWorker<EDFParserWorkerAPI>(
      () =>
        new Worker(new URL('../services/workers/edfParser.worker.ts', import.meta.url), {
          type: 'module',
          name: 'edf-parser',
        }),
      { timeoutMs: 60_000 },
    );
}

/** Create an OPFSService if the API is available. */
async function getOPFS(): Promise<OPFSService | null> {
  if (!OPFSService.isSupported()) return null;
  const opfs = new OPFSService();
  await opfs.initialize();
  return opfs;
}

export function useImport(): UseImportResult {
  const [progress, setProgress] = useState<ImportProgress>(IDLE_PROGRESS);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const setImportStatus = useAppStore((s) => s.setImportStatus);
  const setImportProgress = useAppStore((s) => s.setImportProgress);
  const setLastImportAt = useDataStore((s) => s.setLastImportAt);

  const handleProgress = useCallback(
    (p: ImportProgress) => {
      setProgress(p);

      // Map detailed status to app-level status
      const statusMap: Record<
        ImportProgress['status'],
        'idle' | 'scanning' | 'importing' | 'complete' | 'error'
      > = {
        idle: 'idle',
        scanning: 'scanning',
        parsing: 'importing',
        building: 'importing',
        storing: 'importing',
        complete: 'complete',
        error: 'error',
      };
      setImportStatus(statusMap[p.status]);
      setImportProgress({ current: p.filesProcessed, total: p.totalFiles });
    },
    [setImportStatus, setImportProgress],
  );

  const runImport = useCallback(
    async (importFn: (service: ImportService) => Promise<ImportRecord>) => {
      if (isImporting) return;

      abortRef.current = false;
      setIsImporting(true);
      setError(null);
      setResult(null);
      setProgress(IDLE_PROGRESS);
      setImportStatus('scanning');

      try {
        const db = await getDB();
        const opfs = await getOPFS();
        const workerFactory = makeWorkerFactory();
        const service = new ImportService(db, opfs, workerFactory);

        const record = await importFn(service);

        if (!abortRef.current) {
          setResult(record);
          setImportStatus('complete');
          setLastImportAt(new Date().toISOString());
        }
      } catch (err) {
        if (!abortRef.current) {
          const message = err instanceof Error ? err.message : 'Import failed';
          setError(message);
          setImportStatus('error');
        }
      } finally {
        if (!abortRef.current) {
          setIsImporting(false);
        }
      }
    },
    [isImporting, setImportStatus, setLastImportAt],
  );

  const startFileImport = useCallback(
    async (files: File[]) => {
      await runImport((service) =>
        service.importFiles(files, {
          sourceType: 'file',
          skipDuplicates: true,
          onProgress: handleProgress,
        }),
      );
    },
    [runImport, handleProgress],
  );

  const startDirectoryImport = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      await runImport((service) =>
        service.importDirectory(handle, {
          sourceType: 'sd-card',
          skipDuplicates: true,
          onProgress: handleProgress,
        }),
      );
    },
    [runImport, handleProgress],
  );

  const reset = useCallback(() => {
    abortRef.current = true;
    setProgress(IDLE_PROGRESS);
    setIsImporting(false);
    setResult(null);
    setError(null);
    setImportStatus('idle');
    setImportProgress({ current: 0, total: 0 });
  }, [setImportStatus, setImportProgress]);

  return {
    startFileImport,
    startDirectoryImport,
    progress,
    isImporting,
    result,
    error,
    reset,
  };
}
