/**
 * Hook to manage the Google Health import workflow:
 *   select directory → scan → preview → import → complete.
 *
 * Since ADR 0026 the import lifecycle lives on the module-level
 * {@link importController} OUTSIDE the React tree, and progress lives in
 * {@link useImportStore}. This hook is now a thin subscribe + dispatch adapter:
 * it dispatches scan/start/cancel to the controller and derives import state by
 * subscribing to the store. The scan RESULT (a UI selection concern, not job
 * lifecycle) stays in local React state.
 *
 * The PUBLIC API is unchanged so the import wizard and existing tests keep
 * working: `{ scan, startImport, scanResult, progress, isActive, result, error,
 * reset }` (the legacy {@link GoogleHealthImportProgress} the service emits).
 *
 * @module hooks/useGoogleHealthImport
 */

import { useState, useCallback, useRef } from 'react';
import { useStore } from 'zustand';

import type { GoogleHealthScanResult } from '@/types/fitbit';
import type { IntegrationImportRecord } from '@/types/storage';
import type { GoogleHealthImportProgress } from '@/services/import/types';
import { importController } from '@/services/import/ImportController';
import { useImportStore, selectLatestJobOfKind } from '@/stores/useImportStore';
import { useAppStore } from '@/stores/useAppStore';

// ---------------------------------------------------------------------------
// Public hook interface
// ---------------------------------------------------------------------------

export interface UseGoogleHealthImportResult {
  /** Scan a directory to discover available data. */
  scan: (dirHandle: FileSystemDirectoryHandle) => Promise<GoogleHealthScanResult>;
  /** Start importing selected data types. */
  startImport: (
    dirHandle: FileSystemDirectoryHandle,
    scanResult: GoogleHealthScanResult,
    selectedDataTypes: string[],
  ) => Promise<void>;
  /** Current scan result (null before scanning). */
  scanResult: GoogleHealthScanResult | null;
  /** Import progress (null before importing). */
  progress: GoogleHealthImportProgress | null;
  /** Whether currently scanning or importing. */
  isActive: boolean;
  /** Final import record on completion. */
  result: IntegrationImportRecord | null;
  /** Error message if import failed. */
  error: string | null;
  /** Reset state for a new import. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useGoogleHealthImport(): UseGoogleHealthImportResult {
  const [scanResult, setScanResult] = useState<GoogleHealthScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const trackedJobId = useRef<string | null>(null);

  const setImportStatus = useAppStore((s) => s.setImportStatus);

  // Subscribe to the latest Fitbit job entry from the store.
  const entry = useStore(useImportStore, (s) => selectLatestJobOfKind(s, 'fitbit'));

  const legacyProgress = entry && entry.legacy.kind === 'fitbit' ? entry.legacy.progress : null;
  const status = entry?.progress.status ?? null;
  const importActive = status === 'scanning' || status === 'running';
  const result = entry?.result && entry.result.kind === 'fitbit' ? entry.result.record : null;
  const importError = entry?.error ?? null;

  if (entry && entry.progress.jobId !== trackedJobId.current) {
    trackedJobId.current = entry.progress.jobId;
  }

  // -----------------------------------------------------------------------
  // Scan
  // -----------------------------------------------------------------------

  const scan = useCallback(
    async (dirHandle: FileSystemDirectoryHandle): Promise<GoogleHealthScanResult> => {
      setScanning(true);
      setScanError(null);
      setScanResult(null);
      setImportStatus('scanning');

      try {
        const res = await importController.scanFitbit(dirHandle);
        setScanResult(res);
        setImportStatus('idle');
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Scan failed';
        setScanError(message);
        setImportStatus('error');
        throw err;
      } finally {
        setScanning(false);
      }
    },
    [setImportStatus],
  );

  // -----------------------------------------------------------------------
  // Import (dispatch to controller; store drives state)
  // -----------------------------------------------------------------------

  const startImport = useCallback(
    async (
      dirHandle: FileSystemDirectoryHandle,
      scanRes: GoogleHealthScanResult,
      selectedDataTypes: string[],
    ): Promise<void> => {
      const outcome = importController.startFitbit(
        { dirHandle, scanResult: scanRes, selectedDataTypes },
        { skipDuplicates: true },
      );
      if (outcome.ok) trackedJobId.current = outcome.jobId;
      return Promise.resolve();
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  const reset = useCallback(() => {
    const jobId = trackedJobId.current;
    if (jobId) {
      const current = useImportStore.getState().jobs[jobId];
      const s = current?.progress.status;
      if (s === 'scanning' || s === 'running') {
        importController.cancel(jobId);
      }
      importController.dismiss(jobId);
      trackedJobId.current = null;
    }
    setScanResult(null);
    setScanError(null);
    setScanning(false);
    setImportStatus('idle');
  }, [setImportStatus]);

  return {
    scan,
    startImport,
    scanResult,
    progress: legacyProgress,
    isActive: scanning || importActive,
    result,
    error: scanError ?? importError,
    reset,
  };
}
