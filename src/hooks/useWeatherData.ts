/**
 * Hooks for reading stored weather / air-quality integration data from
 * IndexedDB for the dashboard panel and the cross-source correlation join.
 *
 * Parallels {@link useWearableData}: useState + useEffect with monotonic request
 * sequencing so a slow earlier request cannot overwrite fresher results. These
 * hooks are READ-ONLY — they never trigger a network fetch (all egress is via
 * {@link WeatherSyncService}, user-initiated). They surface what has already
 * been synced into storage.
 *
 * @module hooks/useWeatherData
 */

import { useEffect, useRef, useState } from 'react';
import type { IntegrationDailySummary, IntegrationTimeseries } from '@/types';
import type { WeatherDailyType, WeatherHourlyType } from '@/types/weather';
import { getDB } from '@/services/storage/getDB';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface DateRange {
  start: string;
  end: string;
}

/** Per-data-type availability counts for the queried date range. */
export interface WeatherAvailability {
  /** Count of stored `weather_daily` records in range. */
  readonly weatherDaily: number;
  /** Count of stored `air_quality_daily` records in range. */
  readonly airQualityDaily: number;
  /** Total weather-source daily records in range. */
  readonly total: number;
}

/** Result of the weather daily-summary hook. */
export interface WeatherDailyResult {
  /** `weather_daily` records in range. */
  readonly weatherDaily: readonly IntegrationDailySummary[];
  /** `air_quality_daily` records in range. */
  readonly airQualityDaily: readonly IntegrationDailySummary[];
  /** Availability counts (for "weather days" stats and empty states). */
  readonly availability: WeatherAvailability;
  readonly loading: boolean;
  readonly error: string | null;
}

const EMPTY_AVAILABILITY: WeatherAvailability = {
  weatherDaily: 0,
  airQualityDaily: 0,
  total: 0,
};

const WEATHER_DAILY_TYPE: WeatherDailyType = 'weather_daily';
const AIR_QUALITY_DAILY_TYPE: WeatherDailyType = 'air_quality_daily';

// ---------------------------------------------------------------------------
// useWeatherDailySummaries
// ---------------------------------------------------------------------------

/**
 * Fetch stored weather + air-quality daily summaries for a date range.
 *
 * Filters the `integration_data` store to `source: 'weather'` and splits the
 * results by data type. When `dateRange` is `null`, no query is issued.
 */
export function useWeatherDailySummaries(dateRange: DateRange | null): WeatherDailyResult {
  const [weatherDaily, setWeatherDaily] = useState<readonly IntegrationDailySummary[]>([]);
  const [airQualityDaily, setAirQualityDaily] = useState<readonly IntegrationDailySummary[]>([]);
  const [availability, setAvailability] = useState<WeatherAvailability>(EMPTY_AVAILABILITY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const rangeKey = dateRange ? `${dateRange.start}_${dateRange.end}` : null;

  useEffect(() => {
    if (rangeKey === null || dateRange === null) {
      setWeatherDaily([]);
      setAirQualityDaily([]);
      setAvailability(EMPTY_AVAILABILITY);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const db = await getDB();
        const all = await db.getIntegrationDailySummariesByDateRange(
          dateRange.start,
          dateRange.end,
        );

        if (requestId !== requestIdRef.current) return;

        const weatherSource = all.filter((r) => r.source === 'weather');
        // Records stored by the weather sync carry weather dataTypes; the
        // IntegrationDailySummary.dataType is statically typed against the Fitbit
        // map, so compare via a widened string.
        const wDaily = weatherSource.filter((r) => (r.dataType as string) === WEATHER_DAILY_TYPE);
        const aqDaily = weatherSource.filter(
          (r) => (r.dataType as string) === AIR_QUALITY_DAILY_TYPE,
        );

        setWeatherDaily(wDaily);
        setAirQualityDaily(aqDaily);
        setAvailability({
          weatherDaily: wDaily.length,
          airQualityDaily: aqDaily.length,
          total: wDaily.length + aqDaily.length,
        });
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load weather data');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();
  }, [rangeKey, dateRange]);

  return { weatherDaily, airQualityDaily, availability, loading, error };
}

// ---------------------------------------------------------------------------
// useWeatherTimeseries
// ---------------------------------------------------------------------------

/** Result of the weather timeseries hook. */
export interface WeatherTimeseriesResult {
  readonly data: readonly IntegrationTimeseries[];
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * Fetch stored hourly weather / air-quality series for a date range and data
 * type(s). Powers the Signal-Viewer weather ribbon. When `dateRange` is `null`,
 * no query is issued.
 */
export function useWeatherTimeseries(
  dataType: WeatherHourlyType | WeatherHourlyType[] | null,
  dateRange: DateRange | null,
): WeatherTimeseriesResult {
  const [data, setData] = useState<readonly IntegrationTimeseries[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const typesKey =
    dataType === null ? null : Array.isArray(dataType) ? dataType.join(',') : dataType;
  const rangeKey = dateRange ? `${dateRange.start}_${dateRange.end}` : null;

  useEffect(() => {
    if (typesKey === null || rangeKey === null || dateRange === null) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }

    const types: WeatherHourlyType[] = Array.isArray(dataType)
      ? dataType
      : [dataType as WeatherHourlyType];

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const db = await getDB();
        const all = await db.getIntegrationTimeseriesByDateRange(dateRange.start, dateRange.end);

        if (requestId !== requestIdRef.current) return;

        const filtered = all.filter(
          (r) =>
            r.source === 'weather' && types.includes(r.dataType as unknown as WeatherHourlyType),
        );
        setData(filtered);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load weather timeseries');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typesKey, rangeKey]);

  return { data, loading, error };
}
