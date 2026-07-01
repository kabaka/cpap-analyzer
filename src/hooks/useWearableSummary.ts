/**
 * Hook that provides an aggregate overview of imported wearable/Fitbit data.
 *
 * Performs a lightweight check for integration data existence, then loads
 * import records to derive available data types, date ranges, and overlap
 * with CPAP session data. The result is memoised and automatically refreshed
 * when {@link useDataStore.lastImportAt} changes (signalling new data).
 *
 * @module hooks/useWearableSummary
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import type { FitbitDataType, IntegrationImportRecord } from '@/types';
import { getDB } from '@/services/storage/getDB';
import { useDataStore } from '@/stores/useDataStore';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface WearableSummary {
  /** Whether any Fitbit/wearable data exists in IndexedDB. */
  hasData: boolean;
  /** Union of all data types found across import records. */
  availableDataTypes: FitbitDataType[];
  /**
   * Overlap between the CPAP sessions date range and the wearable data date
   * range, or `null` if there is no overlap or no CPAP data.
   */
  overlapDateRange: { start: string; end: string } | null;
  /** Total number of records imported across all import operations. */
  totalRecords: number;
  /** ISO 8601 timestamp of the most recent import, or `null`. */
  lastImportAt: string | null;
}

interface UseWearableSummaryResult {
  summary: WearableSummary | null;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWearableSummary(): UseWearableSummaryResult {
  const [summary, setSummary] = useState<WearableSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  // Subscribe to import-freshness signals so we re-fetch when new data lands.
  const lastImportAt = useDataStore((s) => s.lastImportAt);

  // Derive the CPAP session date range from the store for overlap computation.
  const summaryStats = useDataStore((s) => s.summaryStats);
  const cpapDateRange = useMemo(() => {
    if (!summaryStats?.stats.dateRange) return null;
    return summaryStats.stats.dateRange;
  }, [summaryStats]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const db = await getDB();

        // Fast existence check — avoids loading all records when there is no data.
        const hasData = await db.hasIntegrationData('fitbit');

        if (requestId !== requestIdRef.current) return;

        if (!hasData) {
          setSummary({
            hasData: false,
            availableDataTypes: [],
            overlapDateRange: null,
            totalRecords: 0,
            lastImportAt: null,
          });
          setLoading(false);
          return;
        }

        // Load import records to derive metadata.
        const imports: IntegrationImportRecord[] = await db.getIntegrationImportRecords('fitbit');

        if (requestId !== requestIdRef.current) return;

        // Derive available data types (deduplicated).
        const typeSet = new Set<FitbitDataType>();
        let totalRecords = 0;
        let latestImport: string | null = null;
        let wearableStart: string | null = null;
        let wearableEnd: string | null = null;

        for (const rec of imports) {
          totalRecords += rec.recordsImported;

          for (const dt of rec.dataTypes) {
            typeSet.add(dt as FitbitDataType);
          }

          if (latestImport === null || rec.importedAt > latestImport) {
            latestImport = rec.importedAt;
          }

          if (
            rec.dateRangeStart &&
            (wearableStart === null || rec.dateRangeStart < wearableStart)
          ) {
            wearableStart = rec.dateRangeStart;
          }
          if (rec.dateRangeEnd && (wearableEnd === null || rec.dateRangeEnd > wearableEnd)) {
            wearableEnd = rec.dateRangeEnd;
          }
        }

        // Compute overlap between CPAP and wearable date ranges.
        let overlapDateRange: { start: string; end: string } | null = null;
        if (cpapDateRange && wearableStart && wearableEnd) {
          const overlapStart =
            cpapDateRange.start > wearableStart ? cpapDateRange.start : wearableStart;
          const overlapEnd = cpapDateRange.end < wearableEnd ? cpapDateRange.end : wearableEnd;
          if (overlapStart <= overlapEnd) {
            overlapDateRange = { start: overlapStart, end: overlapEnd };
          }
        }

        if (requestId !== requestIdRef.current) return;

        setSummary({
          hasData: true,
          availableDataTypes: Array.from(typeSet).sort(),
          overlapDateRange,
          totalRecords,
          lastImportAt: latestImport,
        });
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load wearable summary');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();

    // On unmount (or before the next run), invalidate this request so the async
    // IIFE above never calls setState after the component is gone. Every setState
    // is already gated on `requestId === requestIdRef.current`; bumping the ref
    // here makes those guards bail, preventing a "window is not defined"
    // setState-after-teardown rejection (surfaced as a flaky unit-test error).
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: bump the live ref at cleanup to invalidate in-flight requests; copying to a local would defeat the request-id guard
      requestIdRef.current++;
    };
  }, [lastImportAt, cpapDateRange]);

  return { summary, loading, error };
}
