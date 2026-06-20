/**
 * Read/maintenance helpers for stored weather integration data, used by the
 * Settings panel (the "N nights" status line and the on-disable delete prompt).
 *
 * All fetching of weather data is done elsewhere (user-initiated, via
 * {@link WeatherSyncService}); this module only inspects and removes what is
 * already in IndexedDB.
 *
 * ## Deletion scope
 *
 * {@link deleteAllWeatherData} performs a TOTAL wipe of `source: 'weather'`
 * across all three integration stores — daily summaries, intra-night hourly
 * timeseries, and import-history provenance — via the storage layer's
 * {@link IndexedDBService.deleteIntegrationDataBySource} primitive, which runs
 * the three cursor sweeps in a single atomic transaction. A disable→Delete
 * therefore leaves nothing behind; no residual count needs to be disclosed.
 *
 * @module services/weather/weatherDataService
 */

import { getDB } from '@/services/storage/getDB';

/** Weather integration source identifier. */
const SOURCE = 'weather';

/** Count of stored weather nights (distinct dates with a daily summary). */
export async function countWeatherNights(): Promise<number> {
  const db = await getDB();
  const records = await db.getIntegrationDataBySource(SOURCE);
  const dates = new Set<string>();
  for (const r of records) dates.add(r.date);
  return dates.size;
}

/** Outcome of a weather-data deletion — per-store counts of records removed. */
export interface DeleteWeatherResult {
  /** Daily-summary records removed from `integration_data`. */
  readonly dailyRemoved: number;
  /** Intra-night hourly timeseries records removed from `integration_timeseries`. */
  readonly timeseriesRemoved: number;
  /** Import-history records removed from `integration_import_history`. */
  readonly importRecordsRemoved: number;
}

/**
 * Delete ALL stored weather data — every `source: 'weather'` record across the
 * daily-summary, hourly-timeseries, and import-history stores — in a single
 * atomic transaction. Returns the per-store counts of records removed.
 */
export async function deleteAllWeatherData(): Promise<DeleteWeatherResult> {
  const db = await getDB();
  const { dailyDeleted, timeseriesDeleted, importRecordsDeleted } =
    await db.deleteIntegrationDataBySource(SOURCE);
  return {
    dailyRemoved: dailyDeleted,
    timeseriesRemoved: timeseriesDeleted,
    importRecordsRemoved: importRecordsDeleted,
  };
}
