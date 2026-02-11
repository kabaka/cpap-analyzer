/**
 * Analysis Engine — orchestrator for statistical computations.
 *
 * Provides a pipeline that:
 * 1. Checks an in-memory LRU cache for previously computed results
 * 2. Fetches required data from the DataProvider on cache miss
 * 3. Dispatches computation to a Comlink-wrapped Web Worker
 * 4. Caches and returns the result
 *
 * Supports cancellation via AbortSignal and cache invalidation
 * when new data is imported.
 *
 * @module services/analysis/AnalysisEngine
 */

import type { Remote } from 'comlink';

import type { AnalysisInput, AnalysisOutput, NightlyAggregate } from '@/types';
import { CacheService } from '@/services/storage/CacheService';
import type { DataProvider } from '@/types/storage';
import { createWorker, type WrappedWorker } from '@/services/workers/createWorker';
import type { AnalysisWorkerAPI } from '@/services/workers/analysis.worker';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Increment when algorithms change to invalidate stale cache entries. */
const CACHE_VERSION = 1;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Generate a simple hash of a string for cache key construction. */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Throw if the signal has already been aborted. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Analysis cancelled', 'AbortError');
  }
}

// ---------------------------------------------------------------------------
// AnalysisEngine
// ---------------------------------------------------------------------------

export class AnalysisEngine {
  private readonly cache: CacheService;
  private readonly dataProvider: DataProvider;
  private workerHandle: WrappedWorker<AnalysisWorkerAPI> | null = null;

  constructor(dataProvider: DataProvider, cache?: CacheService) {
    this.dataProvider = dataProvider;
    this.cache = cache ?? new CacheService();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Execute an analysis and return cached or freshly computed results.
   *
   * @param input  - Describes the analysis type, date range, and parameters.
   * @param signal - Optional AbortSignal for cancellation.
   * @returns The analysis output with results and metadata.
   */
  async execute(input: AnalysisInput, signal?: AbortSignal): Promise<AnalysisOutput> {
    // 1. Generate cache key
    const cacheKey = this.buildCacheKey(input);

    // 2. Check cache
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // 3. Check abort before fetching data
    throwIfAborted(signal);

    // 4. Fetch required data from DataProvider
    const data = await this.fetchData(input);

    // 5. Check abort before dispatching to worker
    throwIfAborted(signal);

    // 6. Dispatch computation to worker
    const startTime = performance.now();
    const results = await this.dispatch(input, data);
    const computationTimeMs = performance.now() - startTime;

    // 7. Build output with metadata
    const output: AnalysisOutput = {
      type: input.type,
      dateRange: input.dateRange,
      results,
      metadata: {
        computedAt: new Date().toISOString(),
        computationTimeMs,
        cacheVersion: CACHE_VERSION,
        sampleSize: this.getSampleSize(data),
        warnings: [],
        assumptions: this.getAssumptions(input.type),
      },
    };

    // 8. Cache result
    this.cache.set(cacheKey, output, { dateRange: input.dateRange });

    return output;
  }

  /**
   * Invalidate cached results whose date range overlaps the given range.
   * Call this when new data is imported.
   *
   * @returns Number of entries invalidated.
   */
  invalidateByDateRange(start: string, end: string): number {
    return this.cache.invalidateByDateRange(start, end);
  }

  /**
   * Invalidate all cached results of a specific analysis type.
   *
   * @returns Number of entries invalidated.
   */
  invalidateByType(type: string): number {
    return this.cache.invalidateByType(type);
  }

  /** Clean up the worker when the engine is no longer needed. */
  dispose(): void {
    if (this.workerHandle) {
      this.workerHandle.dispose();
      this.workerHandle = null;
    }
  }

  // -----------------------------------------------------------------------
  // Private — cache key
  // -----------------------------------------------------------------------

  /**
   * Build a deterministic cache key from analysis type, date range,
   * and parameters.
   */
  private buildCacheKey(input: AnalysisInput): string {
    const dateRangeHash = hashString(`${input.dateRange.start}|${input.dateRange.end}`);
    const paramsHash = hashString(JSON.stringify(input.parameters));
    return this.cache.generateKey(input.type, `${dateRangeHash}:${paramsHash}`);
  }

  // -----------------------------------------------------------------------
  // Private — data fetching
  // -----------------------------------------------------------------------

  /**
   * Fetch the data required by the analysis from the DataProvider.
   *
   * Switches on analysis type to determine what data is needed:
   * - Most analyses operate on nightly aggregates
   * - Session-level analyses fetch sessions directly
   */
  private async fetchData(input: AnalysisInput): Promise<NightlyAggregate[]> {
    const range = {
      start: input.dateRange.start,
      end: input.dateRange.end,
    };

    return this.dataProvider.getNightlyAggregates(range);
  }

  // -----------------------------------------------------------------------
  // Private — worker dispatch
  // -----------------------------------------------------------------------

  /** Lazily initialise the analysis worker. */
  private getWorker(): Remote<AnalysisWorkerAPI> {
    if (!this.workerHandle) {
      this.workerHandle = createWorker<AnalysisWorkerAPI>(
        () =>
          new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
            type: 'module',
            name: 'analysis-worker',
          }),
        { name: 'analysis-worker' },
      );
    }
    return this.workerHandle.proxy;
  }

  /**
   * Dispatch computation to the analysis worker based on the input type.
   *
   * Extracts the relevant columns from the nightly aggregate data and
   * calls the appropriate worker method.
   */
  private async dispatch(input: AnalysisInput, data: NightlyAggregate[]): Promise<unknown> {
    const worker = this.getWorker();
    const metric = (input.parameters.metric as string) ?? 'ahi';
    const dates = data.map((d) => d.date);
    const values = this.extractMetricValues(data, metric);

    switch (input.type) {
      // -- Descriptive --
      case 'descriptive-stats':
        return worker.computeDescriptiveStats(values);

      case 'percentiles':
        return worker.computePercentiles(values);

      case 'outlier-detection':
        return worker.detectOutliers(values);

      case 'histogram':
        return worker.computeHistogram(values, input.parameters.binCount as number | undefined);

      // -- Time-series --
      case 'rolling-mean':
        return worker.rollingMean(
          dates,
          values,
          (input.parameters.window as number) ?? 7,
          (input.parameters.confidence as number) ?? 0.95,
        );

      case 'rolling-median':
        return worker.rollingMedian(
          dates,
          values,
          (input.parameters.window as number) ?? 7,
          (input.parameters.confidence as number) ?? 0.95,
        );

      case 'linear-trend':
        return worker.linearTrend(dates, values);

      case 'loess':
        return worker.loess(
          dates.map((_, i) => i),
          values,
          (input.parameters.bandwidth as number) ?? 0.3,
          (input.parameters.robustnessIters as number) ?? 2,
        );

      case 'change-points':
        return worker.detectChangePoints(values, dates, (input.parameters.penalty as number) ?? 10);

      case 'stl-decomposition':
        return worker.stlDecomposition(
          dates,
          values,
          (input.parameters.seasonalPeriod as number) ?? 7,
        );

      case 'acf':
        return worker.acf(values, (input.parameters.maxLag as number) ?? undefined);

      case 'pacf':
        return worker.pacf(values, (input.parameters.maxLag as number) ?? undefined);

      // -- Correlation --
      case 'pearson-correlation': {
        const metric2 = (input.parameters.metric2 as string) ?? 'leakMedian';
        const y = this.extractMetricValues(data, metric2);
        return worker.pearsonCorrelation(values, y);
      }

      case 'spearman-correlation': {
        const metric2 = (input.parameters.metric2 as string) ?? 'leakMedian';
        const y = this.extractMetricValues(data, metric2);
        return worker.spearmanCorrelation(values, y);
      }

      case 'correlation-matrix': {
        const metrics = (input.parameters.metrics as string[]) ?? [
          'ahi',
          'leakMedian',
          'pressureMean',
        ];
        const columns: Record<string, number[]> = {};
        for (const m of metrics) {
          columns[m] = this.extractMetricValues(data, m);
        }
        return worker.correlationMatrix(columns);
      }

      case 'partial-correlation': {
        const metric2 = (input.parameters.metric2 as string) ?? 'leakMedian';
        const controlMetrics = (input.parameters.controls as string[]) ?? ['pressureMean'];
        const y = this.extractMetricValues(data, metric2);
        const controls = controlMetrics.map((m) => this.extractMetricValues(data, m));
        return worker.partialCorrelation(values, y, controls);
      }

      case 'cross-correlation': {
        const metric2 = (input.parameters.metric2 as string) ?? 'leakMedian';
        const y = this.extractMetricValues(data, metric2);
        return worker.crossCorrelation(values, y, (input.parameters.maxLag as number) ?? undefined);
      }

      default:
        throw new Error(`Unknown analysis type: ${input.type}`);
    }
  }

  // -----------------------------------------------------------------------
  // Private — metric extraction
  // -----------------------------------------------------------------------

  /**
   * Extract a numeric metric array from nightly aggregate data.
   *
   * Falls back to NaN for null values so downstream algorithms can
   * handle missing data via their own filtering (pairwise deletion).
   */
  private extractMetricValues(data: NightlyAggregate[], metric: string): number[] {
    return data.map((d) => {
      const value = (d as unknown as Record<string, unknown>)[metric];
      return typeof value === 'number' ? value : NaN;
    });
  }

  // -----------------------------------------------------------------------
  // Private — metadata helpers
  // -----------------------------------------------------------------------

  /** Determine the sample size from the fetched data. */
  private getSampleSize(data: NightlyAggregate[]): number {
    return data.length;
  }

  /**
   * Return statistical assumptions for a given analysis type.
   *
   * These are displayed alongside results to help users understand
   * the conditions under which the analysis is valid.
   */
  private getAssumptions(type: string): string[] {
    switch (type) {
      case 'descriptive-stats':
      case 'percentiles':
      case 'histogram':
        return ['Data points are independent observations'];

      case 'outlier-detection':
        return [
          'Data is approximately symmetric',
          "Outlier detection uses Tukey's fences (1.5 × IQR)",
        ];

      case 'rolling-mean':
      case 'rolling-median':
        return [
          'Time series has no large gaps in the date range',
          'Confidence intervals assume approximate normality within each window',
        ];

      case 'linear-trend':
        return [
          'Relationship between time and values is approximately linear',
          'Residuals are independent and normally distributed',
        ];

      case 'loess':
        return [
          'Local polynomial regression assumes smooth underlying trend',
          'Observations are approximately equally spaced',
        ];

      case 'change-points':
        return [
          'Change-point detection assumes piecewise constant mean (PELT)',
          'Minimum segment length prevents over-segmentation',
        ];

      case 'stl-decomposition':
        return [
          'Additive decomposition: observed = trend + seasonal + remainder',
          'Seasonal period is fixed (default: 7-day week cycle)',
        ];

      case 'acf':
      case 'pacf':
        return ['Time series is weakly stationary', 'Observations are equally spaced'];

      case 'pearson-correlation':
        return [
          'Both variables are approximately normally distributed',
          'Relationship is linear',
          'Observations are independent',
        ];

      case 'spearman-correlation':
        return ['Relationship is monotonic', 'Observations are independent'];

      case 'correlation-matrix':
        return [
          'Pairwise Pearson correlations assume linear relationships',
          'Variables are approximately normally distributed',
        ];

      case 'partial-correlation':
        return ['Relationships are linear', 'Control variables have been measured without error'];

      case 'cross-correlation':
        return ['Both time series are weakly stationary', 'Observations are equally spaced'];

      default:
        return [];
    }
  }
}
