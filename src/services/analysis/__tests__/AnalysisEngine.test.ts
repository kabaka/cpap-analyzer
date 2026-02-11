/**
 * Unit tests for AnalysisEngine — the pipeline orchestrator.
 *
 * Tests the orchestration logic: cache checking, data fetching,
 * worker dispatch, caching of results, cancellation, and cleanup.
 * Does NOT test the underlying algorithms (those have their own suites).
 *
 * @module services/analysis/__tests__/AnalysisEngine.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { AnalysisInput, NightlyAggregate } from '@/types';
import type { DataProvider } from '@/types/storage';
import { AnalysisEngine } from '../AnalysisEngine';
import { CacheService } from '@/services/storage/CacheService';

// ---------------------------------------------------------------------------
// Mock: createWorker
// ---------------------------------------------------------------------------

const mockWorkerProxy = {
  computeDescriptiveStats: vi.fn().mockResolvedValue({ mean: 5, median: 4.5, stdDev: 1.2 }),
  computePercentiles: vi.fn().mockResolvedValue({ p25: 3, p50: 5, p75: 7 }),
  detectOutliers: vi.fn().mockResolvedValue({ outliers: [], fences: { lower: 1, upper: 9 } }),
  computeHistogram: vi.fn().mockResolvedValue({ bins: [], counts: [] }),
  rollingMean: vi.fn().mockResolvedValue({ dates: [], values: [], ci: [] }),
  rollingMedian: vi.fn().mockResolvedValue({ dates: [], values: [], ci: [] }),
  linearTrend: vi.fn().mockResolvedValue({ slope: 0.1, intercept: 3, r: 0.5 }),
  loess: vi.fn().mockResolvedValue({ fitted: [], residuals: [] }),
  detectChangePoints: vi.fn().mockResolvedValue({ changePoints: [] }),
  stlDecomposition: vi.fn().mockResolvedValue({ trend: [], seasonal: [], remainder: [] }),
  acf: vi.fn().mockResolvedValue({ lags: [], values: [] }),
  pacf: vi.fn().mockResolvedValue({ lags: [], values: [] }),
  pearsonCorrelation: vi.fn().mockResolvedValue({ r: 0.8, p: 0.01 }),
  spearmanCorrelation: vi.fn().mockResolvedValue({ rho: 0.75, p: 0.02 }),
  correlationMatrix: vi.fn().mockResolvedValue({ labels: [], matrix: [] }),
  partialCorrelation: vi.fn().mockResolvedValue({ r: 0.6, p: 0.05 }),
  crossCorrelation: vi.fn().mockResolvedValue({ lags: [], values: [] }),
};

const mockDispose = vi.fn();

vi.mock('@/services/workers/createWorker', () => ({
  createWorker: vi.fn(() => ({
    proxy: mockWorkerProxy,
    dispose: mockDispose,
  })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAggregate(overrides: Partial<NightlyAggregate> = {}): NightlyAggregate {
  return {
    id: 'agg-1',
    sessionId: 'sess-1',
    machineId: 'machine-1',
    date: '2024-01-01',
    ahi: 3.2,
    ahiObstructive: 1.0,
    ahiCentral: 0.5,
    ahiMixed: 0.2,
    ahiHypopnea: 1.3,
    ahiRera: 0.2,
    eventCount: 24,
    eventsByType: {
      obstructive: 7,
      central: 4,
      mixed: 2,
      hypopnea: 9,
      rera: 2,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
    },
    pressureMean: 10,
    pressureMedian: 9.5,
    pressureP95: 13,
    pressureMax: 15,
    epapMedian: null,
    leakMedian: 4.5,
    usageHours: 7,
    ...overrides,
  } as NightlyAggregate;
}

const SAMPLE_AGGREGATES: NightlyAggregate[] = [
  makeAggregate({
    id: 'agg-1',
    date: '2024-01-01',
    ahi: 3.2,
    leakMedian: 4.5,
    pressureMean: 10,
    usageHours: 7,
  }),
  makeAggregate({
    id: 'agg-2',
    date: '2024-01-02',
    ahi: 4.1,
    leakMedian: 5.2,
    pressureMean: 11,
    usageHours: 6.5,
  }),
  makeAggregate({
    id: 'agg-3',
    date: '2024-01-03',
    ahi: 2.8,
    leakMedian: 3.8,
    pressureMean: 9.5,
    usageHours: 7.5,
  }),
];

function makeInput(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    type: 'descriptive-stats',
    dateRange: { start: '2024-01-01', end: '2024-01-31' },
    parameters: { metric: 'ahi' },
    ...overrides,
  };
}

function makeDataProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return {
    getSessions: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue(null),
    getNightlyAggregates: vi.fn().mockResolvedValue(SAMPLE_AGGREGATES),
    getEvents: vi.fn().mockResolvedValue([]),
    getSignalData: vi.fn().mockResolvedValue(new Float32Array()),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnalysisEngine', () => {
  let engine: AnalysisEngine;
  let cache: CacheService;
  let dataProvider: DataProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new CacheService();
    dataProvider = makeDataProvider();
    engine = new AnalysisEngine(dataProvider, cache);
  });

  afterEach(() => {
    engine.dispose();
  });

  // -----------------------------------------------------------------------
  // Cache hit
  // -----------------------------------------------------------------------

  describe('cache hit', () => {
    it('should return cached result without fetching data or dispatching to worker', async () => {
      const input = makeInput();

      // Prime the cache by running the analysis once
      const firstResult = await engine.execute(input);
      vi.clearAllMocks();

      // Second call should use cache
      const secondResult = await engine.execute(input);

      expect(secondResult).toBe(firstResult);
      expect(dataProvider.getNightlyAggregates).not.toHaveBeenCalled();
      expect(mockWorkerProxy.computeDescriptiveStats).not.toHaveBeenCalled();
    });

    it('should not return cached result when input parameters differ', async () => {
      const input1 = makeInput({ parameters: { metric: 'ahi' } });
      const input2 = makeInput({ parameters: { metric: 'leakMedian' } });

      await engine.execute(input1);
      vi.clearAllMocks();

      await engine.execute(input2);

      // Different params → cache miss → must fetch and compute
      expect(dataProvider.getNightlyAggregates).toHaveBeenCalled();
      expect(mockWorkerProxy.computeDescriptiveStats).toHaveBeenCalled();
    });

    it('should not return cached result when date range differs', async () => {
      const input1 = makeInput({ dateRange: { start: '2024-01-01', end: '2024-01-31' } });
      const input2 = makeInput({ dateRange: { start: '2024-02-01', end: '2024-02-28' } });

      await engine.execute(input1);
      vi.clearAllMocks();

      await engine.execute(input2);

      expect(dataProvider.getNightlyAggregates).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Cache miss → compute → cache store
  // -----------------------------------------------------------------------

  describe('cache miss → compute → cache store', () => {
    it('should fetch data from DataProvider on cache miss', async () => {
      const input = makeInput();

      await engine.execute(input);

      expect(dataProvider.getNightlyAggregates).toHaveBeenCalledWith({
        start: '2024-01-01',
        end: '2024-01-31',
      });
    });

    it('should dispatch to the correct worker method based on analysis type', async () => {
      const input = makeInput({ type: 'descriptive-stats' });

      await engine.execute(input);

      expect(mockWorkerProxy.computeDescriptiveStats).toHaveBeenCalledWith([3.2, 4.1, 2.8]);
    });

    it('should store results in cache after computation', async () => {
      const input = makeInput();

      // Cache should be empty
      expect(cache.size).toBe(0);

      await engine.execute(input);

      // Cache should contain one entry
      expect(cache.size).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Analysis type dispatch
  // -----------------------------------------------------------------------

  describe('analysis type dispatch', () => {
    it('should dispatch percentiles analysis to computePercentiles', async () => {
      await engine.execute(makeInput({ type: 'percentiles' }));
      expect(mockWorkerProxy.computePercentiles).toHaveBeenCalledWith([3.2, 4.1, 2.8]);
    });

    it('should dispatch outlier-detection to detectOutliers', async () => {
      await engine.execute(makeInput({ type: 'outlier-detection' }));
      expect(mockWorkerProxy.detectOutliers).toHaveBeenCalledWith([3.2, 4.1, 2.8]);
    });

    it('should dispatch histogram with optional binCount parameter', async () => {
      await engine.execute(
        makeInput({ type: 'histogram', parameters: { metric: 'ahi', binCount: 10 } }),
      );
      expect(mockWorkerProxy.computeHistogram).toHaveBeenCalledWith([3.2, 4.1, 2.8], 10);
    });

    it('should dispatch rolling-mean with window and confidence defaults', async () => {
      await engine.execute(makeInput({ type: 'rolling-mean' }));
      const dates = ['2024-01-01', '2024-01-02', '2024-01-03'];
      expect(mockWorkerProxy.rollingMean).toHaveBeenCalledWith(dates, [3.2, 4.1, 2.8], 7, 0.95);
    });

    it('should dispatch rolling-mean with custom window', async () => {
      await engine.execute(
        makeInput({
          type: 'rolling-mean',
          parameters: { metric: 'ahi', window: 14, confidence: 0.99 },
        }),
      );
      expect(mockWorkerProxy.rollingMean).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        14,
        0.99,
      );
    });

    it('should dispatch linear-trend analysis', async () => {
      await engine.execute(makeInput({ type: 'linear-trend' }));
      expect(mockWorkerProxy.linearTrend).toHaveBeenCalledWith(
        ['2024-01-01', '2024-01-02', '2024-01-03'],
        [3.2, 4.1, 2.8],
      );
    });

    it('should dispatch pearson-correlation with two metric columns', async () => {
      await engine.execute(
        makeInput({
          type: 'pearson-correlation',
          parameters: { metric: 'ahi', metric2: 'leakMedian' },
        }),
      );
      expect(mockWorkerProxy.pearsonCorrelation).toHaveBeenCalledWith(
        [3.2, 4.1, 2.8],
        [4.5, 5.2, 3.8],
      );
    });

    it('should dispatch correlation-matrix with multiple metrics', async () => {
      await engine.execute(
        makeInput({
          type: 'correlation-matrix',
          parameters: { metrics: ['ahi', 'leakMedian', 'pressureMean'] },
        }),
      );
      expect(mockWorkerProxy.correlationMatrix).toHaveBeenCalledWith({
        ahi: [3.2, 4.1, 2.8],
        leakMedian: [4.5, 5.2, 3.8],
        pressureMean: [10, 11, 9.5],
      });
    });

    it('should throw for unknown analysis type', async () => {
      await expect(engine.execute(makeInput({ type: 'nonexistent-analysis' }))).rejects.toThrow(
        'Unknown analysis type: nonexistent-analysis',
      );
    });
  });

  // -----------------------------------------------------------------------
  // Cache invalidation
  // -----------------------------------------------------------------------

  describe('cache invalidation', () => {
    it('should delegate invalidateByDateRange to CacheService', async () => {
      const spy = vi.spyOn(cache, 'invalidateByDateRange');

      // Prime the cache
      await engine.execute(makeInput());
      expect(cache.size).toBe(1);

      const count = engine.invalidateByDateRange('2024-01-01', '2024-01-15');

      expect(spy).toHaveBeenCalledWith('2024-01-01', '2024-01-15');
      expect(count).toBe(1);
      expect(cache.size).toBe(0);
    });

    it('should delegate invalidateByType to CacheService', async () => {
      const spy = vi.spyOn(cache, 'invalidateByType');

      await engine.execute(makeInput({ type: 'descriptive-stats' }));
      expect(cache.size).toBe(1);

      const count = engine.invalidateByType('descriptive-stats');

      expect(spy).toHaveBeenCalledWith('descriptive-stats');
      expect(count).toBe(1);
      expect(cache.size).toBe(0);
    });

    it('should return 0 when no entries match the invalidation range', async () => {
      await engine.execute(makeInput({ dateRange: { start: '2024-01-01', end: '2024-01-31' } }));

      const count = engine.invalidateByDateRange('2025-06-01', '2025-06-30');

      expect(count).toBe(0);
      expect(cache.size).toBe(1);
    });

    it('should force recomputation after invalidation', async () => {
      const input = makeInput();
      await engine.execute(input);

      engine.invalidateByType('descriptive-stats');
      vi.clearAllMocks();

      await engine.execute(input);

      // Should refetch and recompute since cache was invalidated
      expect(dataProvider.getNightlyAggregates).toHaveBeenCalled();
      expect(mockWorkerProxy.computeDescriptiveStats).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // AbortSignal
  // -----------------------------------------------------------------------

  describe('AbortSignal cancellation', () => {
    it('should throw AbortError when signal is already aborted before execute', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(engine.execute(makeInput(), controller.signal)).rejects.toThrow(
        'Analysis cancelled',
      );
    });

    it('should throw a DOMException with name AbortError', async () => {
      const controller = new AbortController();
      controller.abort();

      try {
        await engine.execute(makeInput(), controller.signal);
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DOMException);
        expect((error as DOMException).name).toBe('AbortError');
      }
    });

    it('should not fetch data when signal is pre-aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await engine.execute(makeInput(), controller.signal).catch(() => {});

      expect(dataProvider.getNightlyAggregates).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  describe('output metadata', () => {
    it('should include computedAt as ISO timestamp', async () => {
      const output = await engine.execute(makeInput());

      expect(output.metadata.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include computationTimeMs as a non-negative number', async () => {
      const output = await engine.execute(makeInput());

      expect(output.metadata.computationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should report correct sampleSize from the fetched data', async () => {
      const output = await engine.execute(makeInput());

      expect(output.metadata.sampleSize).toBe(3);
    });

    it('should include assumptions for descriptive-stats', async () => {
      const output = await engine.execute(makeInput({ type: 'descriptive-stats' }));

      expect(output.metadata.assumptions).toContain('Data points are independent observations');
    });

    it('should include assumptions for pearson-correlation', async () => {
      const output = await engine.execute(
        makeInput({
          type: 'pearson-correlation',
          parameters: { metric: 'ahi', metric2: 'leakMedian' },
        }),
      );

      expect(output.metadata.assumptions).toEqual(
        expect.arrayContaining(['Relationship is linear', 'Observations are independent']),
      );
    });

    it('should echo the input type and date range on the output', async () => {
      const input = makeInput({ type: 'linear-trend' });
      const output = await engine.execute(input);

      expect(output.type).toBe('linear-trend');
      expect(output.dateRange).toEqual({ start: '2024-01-01', end: '2024-01-31' });
    });

    it('should include cacheVersion in metadata', async () => {
      const output = await engine.execute(makeInput());

      expect(output.metadata.cacheVersion).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple executions (integration-style)
  // -----------------------------------------------------------------------

  describe('multiple executions', () => {
    it('should compute on first call and return cached on second', async () => {
      const input = makeInput();

      const first = await engine.execute(input);
      expect(mockWorkerProxy.computeDescriptiveStats).toHaveBeenCalledTimes(1);

      const second = await engine.execute(input);
      // Worker should NOT be called again
      expect(mockWorkerProxy.computeDescriptiveStats).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it('should compute separately for different analysis types', async () => {
      await engine.execute(makeInput({ type: 'descriptive-stats' }));
      await engine.execute(makeInput({ type: 'linear-trend' }));

      expect(mockWorkerProxy.computeDescriptiveStats).toHaveBeenCalledTimes(1);
      expect(mockWorkerProxy.linearTrend).toHaveBeenCalledTimes(1);
      expect(cache.size).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('should call dispose on the worker handle', async () => {
      // Force worker creation by running an analysis
      await engine.execute(makeInput());

      engine.dispose();

      expect(mockDispose).toHaveBeenCalledTimes(1);
    });

    it('should be safe to call dispose when no worker has been created', () => {
      // No analysis has been executed → no worker was created
      const freshEngine = new AnalysisEngine(dataProvider, cache);
      expect(() => freshEngine.dispose()).not.toThrow();
    });

    it('should be safe to call dispose multiple times', async () => {
      await engine.execute(makeInput());
      engine.dispose();
      expect(() => engine.dispose()).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Metric extraction
  // -----------------------------------------------------------------------

  describe('metric extraction', () => {
    it('should extract the correct metric values and pass them to the worker', async () => {
      await engine.execute(makeInput({ parameters: { metric: 'pressureMean' } }));

      expect(mockWorkerProxy.computeDescriptiveStats).toHaveBeenCalledWith([10, 11, 9.5]);
    });

    it('should default to ahi when no metric is specified', async () => {
      await engine.execute(makeInput({ parameters: {} }));

      expect(mockWorkerProxy.computeDescriptiveStats).toHaveBeenCalledWith([3.2, 4.1, 2.8]);
    });

    it('should produce NaN for missing/unknown metric fields', async () => {
      await engine.execute(makeInput({ parameters: { metric: 'nonexistentField' } }));

      expect(mockWorkerProxy.computeDescriptiveStats).toHaveBeenCalledWith([NaN, NaN, NaN]);
    });
  });

  // -----------------------------------------------------------------------
  // Default CacheService creation
  // -----------------------------------------------------------------------

  describe('constructor defaults', () => {
    it('should create its own CacheService when none is provided', async () => {
      const defaultEngine = new AnalysisEngine(dataProvider);

      // Should work without issue (uses internal cache)
      const output = await defaultEngine.execute(makeInput());
      expect(output.type).toBe('descriptive-stats');

      defaultEngine.dispose();
    });
  });
});
