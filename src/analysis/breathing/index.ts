/**
 * App-computed breathing-pattern detection — barrel export.
 *
 * Periodic-breathing / Cheyne–Stokes **candidate** episode detection over the
 * ventilation envelope, and the longitudinal TECSA trajectory classifier. Per
 * ADR 0017 these are computed detections distinct from device events, framed as
 * candidate detection (never diagnosis).
 *
 * @module analysis/breathing
 */

export * from './types';
export {
  segmentBreaths,
  buildEnvelopeFromFlow,
  buildEnvelopeFromMinuteVent,
  estimatePeriodicity,
  modulationIndex,
  crescendoDecrescendoFit,
  leakCleanFraction,
} from './envelope';
export { detectPeriodicBreathing, spectralBandEnergyFraction } from './detectPeriodicBreathing';
export { classifyTecsa, flagTecsaNights } from './classifyTecsa';
