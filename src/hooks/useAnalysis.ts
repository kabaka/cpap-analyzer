/**
 * Hook for executing analysis via the AnalysisEngine.
 *
 * Manages the lifecycle of an analysis request: instantiation of the
 * engine, cancellation of in-flight requests, dependency tracking,
 * and result caching via the engine's built-in LRU cache.
 *
 * Re-runs automatically when `type`, `parameters`, or `dateRange` change.
 *
 * @module hooks/useAnalysis
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AnalysisMetadata, AnalysisOutput } from '@/types';
import { AnalysisEngine } from '@/services/analysis/AnalysisEngine';
import { createDataProviderAdapter } from '@/services/analysis/createDataProviderAdapter';
import { useAppStore } from '@/stores/useAppStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAnalysisOptions {
  /** Analysis type identifier (e.g., 'descriptive-stats'). */
  type: string;
  /** Algorithm-specific parameters. */
  parameters?: Record<string, unknown>;
  /** Override the global date range. Falls back to useAppStore. */
  dateRange?: { start: Date; end: Date };
  /** Set to false to defer execution. Default true. */
  enabled?: boolean;
}

export interface UseAnalysisResult<T = unknown> {
  /** The analysis result data, typed by the caller. */
  data: T | null;
  /** Whether a computation is in progress. */
  loading: boolean;
  /** Human-readable error message, if any. */
  error: string | null;
  /** Computation metadata (timing, sample size, etc.). */
  metadata: AnalysisMetadata | null;
  /** Re-run the analysis. */
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Date as YYYY-MM-DD for the AnalysisEngine. */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Stable JSON representation for dependency comparison. */
function stableKey(value: unknown): string {
  if (value === undefined || value === null) return '';
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

// ---------------------------------------------------------------------------
// Singleton engine
// ---------------------------------------------------------------------------

let engineInstance: AnalysisEngine | null = null;

function getEngine(): AnalysisEngine {
  if (!engineInstance) {
    engineInstance = new AnalysisEngine(createDataProviderAdapter());
  }
  return engineInstance;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Execute an analysis and manage its loading / error / result state.
 *
 * @typeParam T - Shape of `AnalysisOutput.results` for this analysis type.
 */
export function useAnalysis<T = unknown>(options: UseAnalysisOptions): UseAnalysisResult<T> {
  const { type, parameters, dateRange: dateRangeOverride, enabled = true } = options;

  const globalDateRange = useAppStore((s) => s.dateRange);
  const dateRange = dateRangeOverride ?? globalDateRange;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<AnalysisMetadata | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const abortRef = useRef<AbortController | null>(null);

  // Serialise dependencies for stable comparison
  const startStr = formatDate(dateRange.start);
  const endStr = formatDate(dateRange.end);
  const paramsKey = useMemo(() => stableKey(parameters), [parameters]);

  const refetch = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const engine = getEngine();
        const output: AnalysisOutput = await engine.execute(
          {
            type,
            dateRange: { start: startStr, end: endStr },
            parameters: parameters ?? {},
          },
          controller.signal,
        );

        if (!cancelled) {
          setData(output.results as T);
          setMetadata(output.metadata);
        }
      } catch (err) {
        if (!cancelled) {
          // Don't treat abort as an error
          if (err instanceof DOMException && err.name === 'AbortError') {
            return;
          }
          setError(err instanceof Error ? err.message : 'Analysis failed');
          setData(null);
          setMetadata(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, startStr, endStr, paramsKey, enabled, refreshKey]);

  return { data, loading, error, metadata, refetch };
}
