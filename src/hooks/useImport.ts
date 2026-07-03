/**
 * Hook to manage the CPAP import workflow: file selection → scanning →
 * importing → complete.
 *
 * Since ADR 0026 the import lifecycle lives on the module-level
 * {@link importController} OUTSIDE the React tree, and progress lives in
 * {@link useImportStore}. This hook is now a thin subscribe + dispatch adapter:
 * it dispatches `start*`/`cancel`/`dismiss` to the controller and DERIVES the
 * state it returns by subscribing to the store. Navigating away (unmounting this
 * hook) therefore no longer aborts or orphans the import.
 *
 * The PUBLIC API is unchanged — the import wizard and existing tests continue to
 * consume the same `{ progress, isImporting, result, error, startFileImport,
 * startDirectoryImport, reset }` shape (the legacy {@link ImportProgress} the
 * service still emits).
 *
 * @module hooks/useImport
 */

import { useCallback, useRef } from 'react';
import { useStore } from 'zustand';

import type { ImportProgress } from '@/services/import/types';
import { importController } from '@/services/import/ImportController';
import { useImportStore, selectLatestJobOfKind } from '@/stores/useImportStore';
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
  filesSkippedEmpty: 0,
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

export function useImport(): UseImportResult {
  // The id of the job this hook instance is currently tracking. Mirrors what the
  // controller returns from start*, so reset() can target the right job.
  const trackedJobId = useRef<string | null>(null);

  // Subscribe to the latest CPAP job entry. The controller is the single writer.
  const entry = useStore(useImportStore, (s) => selectLatestJobOfKind(s, 'cpap'));

  const legacy = entry && entry.legacy.kind === 'cpap' ? entry.legacy.progress : IDLE_PROGRESS;
  const status = entry?.progress.status ?? 'idle';
  const isImporting = status === 'scanning' || status === 'running';
  const result = entry?.result && entry.result.kind === 'cpap' ? entry.result.record : null;
  const error = entry?.error ?? null;

  // Keep the tracked id current with whichever job the store surfaces.
  if (entry && entry.progress.jobId !== trackedJobId.current) {
    trackedJobId.current = entry.progress.jobId;
  }

  const startFileImport = useCallback(async (files: File[]): Promise<void> => {
    const outcome = importController.startCpap(files, {
      sourceType: 'file',
      skipDuplicates: true,
    });
    if (outcome.ok) trackedJobId.current = outcome.jobId;
    // The job runs in the background; we intentionally do NOT await it so the
    // hook returns promptly and the store drives the UI.
    return Promise.resolve();
  }, []);

  const startDirectoryImport = useCallback(
    async (handle: FileSystemDirectoryHandle): Promise<void> => {
      const outcome = importController.startCpap(handle, {
        sourceType: 'sd-card',
        skipDuplicates: true,
      });
      if (outcome.ok) trackedJobId.current = outcome.jobId;
      return Promise.resolve();
    },
    [],
  );

  const reset = useCallback(() => {
    const jobId = trackedJobId.current;
    if (!jobId) return;
    const current = useImportStore.getState().jobs[jobId];
    const s = current?.progress.status;
    if (s === 'scanning' || s === 'running') {
      // Reset of a running job = cancel (truly stops the work).
      importController.cancel(jobId);
    }
    // Whether running or finished, drop it from the store so the wizard returns
    // to its initial state.
    importController.dismiss(jobId);
    trackedJobId.current = null;
  }, []);

  return {
    startFileImport,
    startDirectoryImport,
    progress: legacy,
    isImporting,
    result,
    error,
    reset,
  };
}
