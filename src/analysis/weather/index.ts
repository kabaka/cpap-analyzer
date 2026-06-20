/**
 * Weather & environmental analysis — pure, unit-tested core.
 *
 * Barrel re-exporting the overnight aggregation, unit conversions, AQI category
 * mapping, and coordinate/routing utilities for the Open-Meteo weather
 * integration. All members are pure and deterministic (no storage, network, or
 * React dependency).
 *
 * @module analysis/weather
 */

export * from './aggregation';
export * from './aqi';
export * from './coordinates';
export * from './units';
