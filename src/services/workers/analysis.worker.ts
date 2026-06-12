/**
 * Comlink-wrapped Web Worker exposing all analysis algorithm modules.
 *
 * Runs descriptive statistics, time-series analysis, correlation,
 * hypothesis testing, distribution fitting, event clustering, survival
 * analysis, and pressure analysis computations off the main thread to
 * keep the UI responsive during analysis operations.
 *
 * Phase 7: descriptive, time-series, correlation.
 * Phase 8: hypothesis, distribution, events, survival, pressure, Granger causality.
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
import { grangerCausality } from '@/analysis/correlation/granger';
import { mannWhitneyU, wilcoxonSignedRank, cohensD, pairedComparison } from '@/analysis/hypothesis';
import {
  qqNormal,
  shapiroFrancia,
  shapiroWilk,
  kolmogorovSmirnov,
  kernelDensityEstimation,
} from '@/analysis/distribution';
import {
  clusterEventsFLGBridged,
  clusterEventsKMeans,
  clusterEventsAgglomerative,
  eventDurationDistribution,
  interEventIntervals,
} from '@/analysis/events';
import { detectFalseNegatives } from '@/analysis/events/false-negatives';
import { kaplanMeier } from '@/analysis/survival';
import {
  titrationHelper,
  pressureResponseCurve,
  bipapEffectiveness,
  pressureVariability,
} from '@/analysis/pressure';
import { detectPeriodicBreathing, classifyTecsa, flagTecsaNights } from '@/analysis/breathing';

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
  grangerCausality,

  // Hypothesis testing
  mannWhitneyU,
  wilcoxonSignedRank,
  cohensD,
  pairedComparison,

  // Distribution
  qqNormal,
  shapiroFrancia,
  shapiroWilk, // deprecated alias of shapiroFrancia (testName now 'Shapiro-Francia')
  kolmogorovSmirnov,
  kernelDensityEstimation,

  // Events
  clusterEventsFLGBridged,
  clusterEventsKMeans,
  clusterEventsAgglomerative,
  eventDurationDistribution,
  interEventIntervals,
  detectFalseNegatives,

  // Survival
  kaplanMeier,

  // Pressure
  titrationHelper,
  pressureResponseCurve,
  bipapEffectiveness,
  pressureVariability,

  // Breathing-pattern detection (ADR 0017): app-computed candidate detections.
  // PB/CSR take caller-supplied signal arrays (flow/minuteVent + sampleRate +
  // optional device event flags), which the UI/plumbing workstream will source
  // from OPFS/IndexedDB. TECSA takes nightly aggregates.
  detectPeriodicBreathing,
  classifyTecsa,
  flagTecsaNights,
};

/** Public API type for consumers creating a Comlink Remote<T>. */
export type AnalysisWorkerAPI = typeof analysisAPI;

Comlink.expose(analysisAPI);
