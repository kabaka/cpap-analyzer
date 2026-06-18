/**
 * Measurement-uncertainty & reliability utilities — barrel export.
 *
 * Pure, deterministic, I/O-free statistical and reliability helpers backing
 * the measurement-uncertainty feature (consensus decisions D1, D3, D4, D5,
 * D7, D8, D9). See each sub-module for the relevant decision references.
 *
 * @module analysis/uncertainty
 */

export * from './constants';
export * from './rateIndex';
export * from './poissonCI';
export * from './rollingBand';
export * from './reliabilityTier';
export * from './formatMetric';
