/**
 * Clinical classification constants and pure classifiers.
 *
 * Centralises the AASM / ICSD-3 clinical thresholds (AHI severity bands, usage
 * compliance hours) so the cutoffs live in exactly one place. These are
 * clinical values; chart display tuning (axis floors / headroom) lives in
 * `views/Trends/charts/chartScale.ts`, and signal-lane plotting ranges live in
 * `views/Sessions/signalDomain.ts`.
 *
 * @module analysis/clinical
 */

export * from './ahiSeverity';
export * from './compliance';
