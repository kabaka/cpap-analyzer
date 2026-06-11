/**
 * Hook to manage the Google Health import workflow:
 *   select directory → scan → preview → import → complete.
 *
 * Creates a {@link GoogleHealthImportService} on demand, tracks scan results
 * and import progress in React state, and integrates with the global app store
 * for status reporting.
 *
 * @module hooks/useGoogleHealthImport
 */

import { useState, useCallback, useRef } from 'react';
import type { GoogleHealthScanResult } from '@/types/fitbit';
import type { IntegrationImportRecord } from '@/types/storage';
import type { GoogleHealthImportProgress } from '@/services/import/types';
import { GoogleHealthImportService } from '@/services/import/googlehealth/GoogleHealthImportService';
import { getDB } from '@/services/storage/getDB';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';

// ---------------------------------------------------------------------------
// Idle progress constant
// ---------------------------------------------------------------------------

const IDLE_PROGRESS: GoogleHealthImportProgress = {
  status: 'idle',
  currentDataType: '',
  dataTypesTotal: 0,
  dataTypesProcessed: 0,
  recordsProcessed: 0,
  recordsTotal: 0,
  recordsSkipped: 0,
  errors: [],
  warnings: [],
  startTime: 0,
  currentStage: '',
};

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
  const [progress, setProgress] = useState<GoogleHealthImportProgress | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [result, setResult] = useState<IntegrationImportRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Prevents state updates after the user has called reset(). */
  const abortRef = useRef(false);

  /** Guards against concurrent imports (avoids stale-closure on isActive). */
  const activeRef = useRef(false);

  /** Lazily created service instance, reused across scan and import. */
  const serviceRef = useRef<GoogleHealthImportService | null>(null);

  const setImportStatus = useAppStore((s) => s.setImportStatus);
  const setImportProgress = useAppStore((s) => s.setImportProgress);
  const setLastImportAt = useDataStore((s) => s.setLastImportAt);

  /** Ensure the service is initialized. */
  const getService = useCallback(async (): Promise<GoogleHealthImportService> => {
    if (!serviceRef.current) {
      const db = await getDB();
      serviceRef.current = new GoogleHealthImportService(db);
    }
    return serviceRef.current;
  }, []);

  // -----------------------------------------------------------------------
  // Scan
  // -----------------------------------------------------------------------

  const scan = useCallback(
    async (dirHandle: FileSystemDirectoryHandle): Promise<GoogleHealthScanResult> => {
      setIsActive(true);
      setError(null);
      setScanResult(null);
      setImportStatus('scanning');
      abortRef.current = false;

      try {
        const service = await getService();
        const result = await service.scan(dirHandle);

        if (!abortRef.current) {
          setScanResult(result);
          setImportStatus('idle');
        }

        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Scan failed';
        if (!abortRef.current) {
          setError(message);
          setImportStatus('error');
        }
        throw err;
      } finally {
        if (!abortRef.current) {
          setIsActive(false);
        }
      }
    },
    [getService, setImportStatus],
  );

  // -----------------------------------------------------------------------
  // Import
  // -----------------------------------------------------------------------

  const startImport = useCallback(
    async (
      dirHandle: FileSystemDirectoryHandle,
      scanRes: GoogleHealthScanResult,
      selectedDataTypes: string[],
    ): Promise<void> => {
      if (activeRef.current) return;
      activeRef.current = true;

      setIsActive(true);
      setError(null);
      setResult(null);
      setProgress(IDLE_PROGRESS);
      setImportStatus('importing');
      abortRef.current = false;

      try {
        const service = await getService();

        const handleProgress = (p: GoogleHealthImportProgress): void => {
          if (abortRef.current) return;
          setProgress(p);
          setImportProgress({
            current: p.dataTypesProcessed,
            total: p.dataTypesTotal,
          });
        };

        const importRecord = await service.import(dirHandle, scanRes, {
          selectedDataTypes,
          skipDuplicates: true,
          onProgress: handleProgress,
        });

        if (!abortRef.current) {
          setResult(importRecord);
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
        activeRef.current = false;
        if (!abortRef.current) {
          setIsActive(false);
        }
      }
    },
    [getService, setImportStatus, setImportProgress, setLastImportAt],
  );

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  const reset = useCallback(() => {
    abortRef.current = true;
    activeRef.current = false;
    setScanResult(null);
    setProgress(null);
    setIsActive(false);
    setResult(null);
    setError(null);
    setImportStatus('idle');
    setImportProgress({ current: 0, total: 0 });
    // Drop the service reference so next use gets a fresh one.
    serviceRef.current = null;
  }, [setImportStatus, setImportProgress]);

  return {
    scan,
    startImport,
    scanResult,
    progress,
    isActive,
    result,
    error,
    reset,
  };
}
