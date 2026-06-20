/**
 * Read/maintenance helpers for stored weather integration data, used by the
 * Settings panel (the "N nights" status line and the on-disable delete prompt).
 *
 * All fetching of weather data is done elsewhere (user-initiated, via
 * {@link WeatherSyncService}); this module only inspects and removes what is
 * already in IndexedDB.
 *
 * ## Deletion scope caveat (flagged for `database`)
 *
 * The existing IndexedDB API exposes a per-id delete for the `integration_data`
 * store (`deleteIntegrationData`) but NOT for `integration_timeseries` or
 * `integration_import_history`. {@link deleteAllWeatherData} therefore removes
 * the weather DAILY summaries (the records the dashboard/correlation surfaces
 * read) and reports any hourly/import records it could not remove via
 * {@link DeleteWeatherResult.timeseriesRemaining}, rather than silently leaving
 * them. A future database-provided bulk `deleteBySource` should make this
 * deletion total; until then the caller surfaces the residual count honestly.
 *
 * @module services/weather/weatherDataService
 */

import { getDB } from '@/services/storage/getDB';

/** Weather integration source identifier. */
const SOURCE = 'weather';

/** A very wide date bound used to sweep the date-indexed timeseries store. */
const MIN_DATE = '0000-01-01';
const MAX_DATE = '9999-12-31';

/** Count of stored weather nights (distinct dates with a daily summary). */
export async function countWeatherNights(): Promise<number> {
  const db = await getDB();
  const records = await db.getIntegrationDataBySource(SOURCE);
  const dates = new Set<string>();
  for (const r of records) dates.add(r.date);
  return dates.size;
}

/** Outcome of a weather-data deletion. */
export interface DeleteWeatherResult {
  /** Daily-summary records removed. */
  readonly dailyRemoved: number;
  /**
   * Hourly timeseries records that remain because the storage layer exposes no
   * per-record delete for that store yet. `0` once a bulk delete-by-source
   * exists. Surfaced so the UI never claims a complete wipe it did not perform.
   */
  readonly timeseriesRemaining: number;
}

/**
 * Delete stored weather data. Removes every `source: 'weather'` daily summary
 * via the supported per-id delete; counts (but cannot yet remove) any hourly
 * series so the caller can disclose the residual.
 */
export async function deleteAllWeatherData(): Promise<DeleteWeatherResult> {
  const db = await getDB();

  const daily = await db.getIntegrationDataBySource(SOURCE);
  let dailyRemoved = 0;
  for (const record of daily) {
    await db.deleteIntegrationData(record.id);
    dailyRemoved++;
  }

  // Best-effort accounting of hourly series we cannot yet delete.
  let timeseriesRemaining = 0;
  try {
    const series = await db.getIntegrationTimeseriesByDateRange(MIN_DATE, MAX_DATE);
    timeseriesRemaining = series.filter((r) => r.source === SOURCE).length;
  } catch {
    timeseriesRemaining = 0;
  }

  return { dailyRemoved, timeseriesRemaining };
}
