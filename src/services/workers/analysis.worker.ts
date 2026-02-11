/**
 * Comlink-wrapped Web Worker exposing all analysis algorithm modules.
 *
 * Runs descriptive statistics, time-series analysis, and correlation
 * computations off the main thread to keep the UI responsive during
 * analysis operations.
 *
 * @module services/workers/analysis.worker
 */

import * as Comlink from 'comlink';

import {
  computeDescriptiveStats,
  percentile,
  computePercentiles,
  detectOutliers,
  computeHistogram,
} from '@/analysis/descriptive';
import {
  rollingMean,
  rollingMedian,
  linearTrend,
  loess,
  detectChangePoints,
  stlDecomposition,
  acf,
  pacf,
} from '@/analysis/timeseries';
import {
  pearsonCorrelation,
  spearmanCorrelation,
  correlationMatrix,
  partialCorrelation,
  crossCorrelation,
} from '@/analysis/correlation';

const analysisAPI = {
  // Descriptive
  computeDescriptiveStats,
  percentile,
  computePercentiles,
  detectOutliers,
  computeHistogram,

  // Time-series
  rollingMean,
  rollingMedian,
  linearTrend,
  loess,
  detectChangePoints,
  stlDecomposition,
  acf,
  pacf,

  // Correlation
  pearsonCorrelation,
  spearmanCorrelation,
  correlationMatrix,
  partialCorrelation,
  crossCorrelation,
};

/** Public API type for consumers creating a Comlink Remote<T>. */
export type AnalysisWorkerAPI = typeof analysisAPI;

Comlink.expose(analysisAPI);
