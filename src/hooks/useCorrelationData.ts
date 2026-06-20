/**
 * Hook that joins CPAP nightly aggregates with wearable daily summaries by
 * date, producing an inner-joined dataset suitable for correlation analysis.
 *
 * Only days with BOTH CPAP and wearable data are included. Each
 * {@link JoinedDayRecord} groups wearable records by data type for easy
 * downstream access.
 *
 * In parallel it joins CPAP nightly aggregates with the ONE canonical nightly
 * weather record ({@link WeatherNightly}) keyed by date, so weather/air-quality
 * metrics can correlate against CPAP metrics. The weather join is INDEPENDENT of
 * the wearable join (a CPAP night needs only weather, not wearable, to enter it)
 * and reuses the SAME session-derived overnight window the dashboard panel uses,
 * so a metric never shows two different "last-night" numbers.
 *
 * @module hooks/useCorrelationData
 */

import { useState, useEffect, useRef } from 'react';
import type { FitbitDailyType, IntegrationDailySummary, NightlyAggregate, Session } from '@/types';
import type { AirQualityHourly, WeatherDaily, WeatherHourly } from '@/types/weather';
import { assembleNightly } from '@/hooks/useWeatherNightly';
import { subtractDaysIso, type WeatherNightly } from '@/analysis/weather';
import { getDB } from '@/services/storage/getDB';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface JoinedDayRecord {
  /** ISO date (YYYY-MM-DD) shared by both sources. */
  date: string;
  /** CPAP nightly aggregate for this date. */
  cpap: NightlyAggregate;
  /** Wearable daily summaries keyed by data type. */
  wearable: Record<string, IntegrationDailySummary>;
}

/** CPAP × weather inner-join record (independent of wearable availability). */
export interface JoinedWeatherRecord {
  /** ISO date (YYYY-MM-DD) shared by both sources. */
  date: string;
  /** CPAP nightly aggregate for this date. */
  cpap: NightlyAggregate;
  /** Canonical nightly weather + air-quality record for this date. */
  weather: WeatherNightly;
}

interface UseCorrelationDataResult {
  /** Inner-joined records (only dates present in BOTH CPAP and wearable). */
  data: JoinedDayRecord[];
  /** CPAP × weather inner-joined records (dates present in BOTH). */
  weatherData: JoinedWeatherRecord[];
  loading: boolean;
  error: string | null;
  /** Total CPAP days available in the date range. */
  cpapDays: number;
  /** Total wearable days available in the date range. */
  wearableDays: number;
  /** Number of days with data from both CPAP and wearable (= data.length). */
  overlapDays: number;
  /** Number of days with canonical nightly weather data (= weatherData.length). */
  weatherDays: number;
}

const WEATHER_SOURCE = 'weather';
const WEATHER_HOURLY = 'weather_hourly';
const AIR_QUALITY_HOURLY = 'air_quality_hourly';
const WEATHER_DAILY = 'weather_daily';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetch CPAP nightly aggregates, wearable daily summaries, and canonical nightly
 * weather records for the given date range and join them by date.
 *
 * @param dateRange     - ISO date strings (YYYY-MM-DD, inclusive). Pass `null`
 *                        to skip the query.
 * @param wearableTypes - Optional filter: only include these wearable data
 *                        types. When omitted, all types are included.
 */
export function useCorrelationData(
  dateRange: { start: string; end: string } | null,
  wearableTypes?: FitbitDailyType[],
): UseCorrelationDataResult {
  const [data, setData] = useState<JoinedDayRecord[]>([]);
  const [weatherData, setWeatherData] = useState<JoinedWeatherRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cpapDays, setCpapDays] = useState(0);
  const [wearableDays, setWearableDays] = useState(0);
  const [overlapDays, setOverlapDays] = useState(0);
  const [weatherDays, setWeatherDays] = useState(0);
  const requestIdRef = useRef(0);

  // Stable dependency key for wearableTypes.
  const typesKey = wearableTypes ? wearableTypes.slice().sort().join(',') : undefined;
  const rangeKey = dateRange ? `${dateRange.start}_${dateRange.end}` : null;

  useEffect(() => {
    if (rangeKey === null || dateRange === null) {
      setData([]);
      setWeatherData([]);
      setCpapDays(0);
      setWearableDays(0);
      setOverlapDays(0);
      setWeatherDays(0);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const db = await getDB();

        // A night ending on the range start may pull hourly weather from the day
        // before, so widen the timeseries/daily fetch by one day on the lower
        // bound (matching useWeatherNightly).
        const fetchStart = subtractDaysIso(dateRange.start, 1);

        // Fetch all sources in parallel.
        const [aggregates, summaries, timeseries, weatherDailySummaries, sessions] =
          await Promise.all([
            db.getNightlyAggregatesByDateRange(dateRange.start, dateRange.end),
            db.getIntegrationDailySummariesByDateRange(dateRange.start, dateRange.end),
            db.getIntegrationTimeseriesByDateRange(fetchStart, dateRange.end),
            db.getIntegrationDailySummariesByDateRange(fetchStart, dateRange.end),
            db.getSessionsByDateRange(dateRange.start, dateRange.end),
          ]);

        if (requestId !== requestIdRef.current) return;

        // --- Build a date-keyed map of CPAP aggregates. ---
        // When multiple aggregates share a date (e.g. split sessions), pick
        // the one with the longest usage so the correlation uses the primary
        // session for that night.
        const cpapMap = new Map<string, NightlyAggregate>();
        for (const agg of aggregates) {
          const existing = cpapMap.get(agg.date);
          if (!existing || agg.usageHours > existing.usageHours) {
            cpapMap.set(agg.date, agg);
          }
        }

        // --- Build a date-keyed map of wearable summaries. ---
        // Each date maps to a record of dataType -> summary.
        const wearableMap = new Map<string, Record<string, IntegrationDailySummary>>();
        const wearableDateSet = new Set<string>();

        for (const s of summaries) {
          // Source filter: only include Fitbit data.
          if (s.source !== 'fitbit') continue;
          // Optional type filter.
          if (wearableTypes && !wearableTypes.includes(s.dataType)) continue;

          wearableDateSet.add(s.date);
          let dateRecord = wearableMap.get(s.date);
          if (!dateRecord) {
            dateRecord = {};
            wearableMap.set(s.date, dateRecord);
          }
          dateRecord[s.dataType] = s;
        }

        // --- Inner join CPAP × wearable on date. ---
        const joined: JoinedDayRecord[] = [];
        for (const [date, cpap] of cpapMap) {
          const wearable = wearableMap.get(date);
          if (wearable) {
            joined.push({ date, cpap, wearable });
          }
        }

        // Sort chronologically.
        joined.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

        // --- Assemble canonical nightly weather and join CPAP × weather. ---
        const weatherHourlyByDate = new Map<string, WeatherHourly>();
        const airHourlyByDate = new Map<string, AirQualityHourly>();
        for (const rec of timeseries) {
          if (rec.source !== WEATHER_SOURCE) continue;
          const type = rec.dataType as unknown as string;
          if (type === WEATHER_HOURLY) {
            weatherHourlyByDate.set(rec.date, rec.data as unknown as WeatherHourly);
          } else if (type === AIR_QUALITY_HOURLY) {
            airHourlyByDate.set(rec.date, rec.data as unknown as AirQualityHourly);
          }
        }

        const weatherDailyByDate = new Map<string, WeatherDaily>();
        for (const rec of weatherDailySummaries) {
          if (rec.source !== WEATHER_SOURCE) continue;
          if ((rec.dataType as unknown as string) === WEATHER_DAILY) {
            weatherDailyByDate.set(rec.date, rec.data as unknown as WeatherDaily);
          }
        }

        // Widest-span session per date (longest recording wins) → overnight window.
        const sessionByDate = new Map<string, { start: string; end: string }>();
        for (const s of sessions as readonly Session[]) {
          if (s.deleted) continue;
          const existing = sessionByDate.get(s.date);
          if (existing === undefined) {
            sessionByDate.set(s.date, { start: s.startTime, end: s.endTime });
            continue;
          }
          const existingSpan = Date.parse(existing.end) - Date.parse(existing.start);
          const candidateSpan = Date.parse(s.endTime) - Date.parse(s.startTime);
          if (Number.isFinite(candidateSpan) && candidateSpan > existingSpan) {
            sessionByDate.set(s.date, { start: s.startTime, end: s.endTime });
          }
        }

        // Only assemble weather for nights that have a CPAP aggregate — the
        // weather join is CPAP × weather, so other dates cannot contribute.
        const weatherNightly = assembleNightly(cpapMap.keys(), {
          weatherHourlyByDate,
          airHourlyByDate,
          weatherDailyByDate,
          sessionByDate,
        });

        const weatherJoined: JoinedWeatherRecord[] = [];
        for (const night of weatherNightly) {
          // A night carries signal iff at least one hour was in-window.
          if (night.weatherHourCount === 0 && night.airHourCount === 0) continue;
          const cpap = cpapMap.get(night.date);
          if (cpap) {
            weatherJoined.push({ date: night.date, cpap, weather: night });
          }
        }
        weatherJoined.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

        if (requestId !== requestIdRef.current) return;

        setData(joined);
        setWeatherData(weatherJoined);
        setCpapDays(cpapMap.size);
        setWearableDays(wearableDateSet.size);
        setOverlapDays(joined.length);
        setWeatherDays(weatherJoined.length);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load correlation data');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, typesKey]);

  return {
    data,
    weatherData,
    loading,
    error,
    cpapDays,
    wearableDays,
    overlapDays,
    weatherDays,
  };
}
