/**
 * Hook producing the ONE canonical {@link WeatherNightly} record per night,
 * shared by the dashboard {@link WeatherOverview} panel and the cross-source
 * correlation surface so "last night's" weather is a single number everywhere.
 *
 * It reads what has already been synced into IndexedDB (it never fetches from
 * the network — egress is user-initiated via the weather sync service) and joins
 * three stored sources by local date:
 *
 * - hourly `weather_hourly` series (the canonical source for overnight stats),
 * - hourly `air_quality_hourly` series,
 * - stored `weather_daily` civil-day summaries (fallback ONLY for temperature
 *   extremes and precipitation when the hourly series is missing — see
 *   {@link computeWeatherNightly}),
 *
 * plus CPAP {@link Session} bounds so the overnight window is session-derived
 * `[start, end)` whenever a session exists for the night; dates without a
 * session fall back to the single documented default civil-night window
 * ({@link DEFAULT_CIVIL_NIGHT_WINDOW_HOURS}).
 *
 * Two civil-date nights are handled by passing BOTH the night's date record and
 * the previous date's record to {@link computeWeatherNightly}, which merges and
 * window-filters them.
 *
 * Follows the {@link useWeatherData} / {@link useCorrelationData} conventions:
 * `useState` + `useEffect` with a monotonic request counter so a slow earlier
 * request cannot overwrite fresher results.
 *
 * @module hooks/useWeatherNightly
 */

import { useEffect, useRef, useState } from 'react';

import { computeWeatherNightly, type WeatherNightly } from '@/analysis/weather';
import { subtractDaysIso } from '@/analysis/weather/coordinates';
import { getDB } from '@/services/storage/getDB';
import type {
  AirQualityHourly,
  WeatherDaily,
  WeatherHourly,
  WeatherHourlySample,
  AirQualityHourlySample,
} from '@/types/weather';
import type { Session } from '@/types';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface DateRange {
  start: string;
  end: string;
}

/** Result of {@link useWeatherNightly}. */
export interface UseWeatherNightlyResult {
  /** Canonical nightly records, ascending by date (the night-ending date). */
  readonly data: readonly WeatherNightly[];
  /** Most-recent night with any in-window data, or `null` when none. */
  readonly latest: WeatherNightly | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const WEATHER_SOURCE = 'weather';
const WEATHER_HOURLY = 'weather_hourly';
const AIR_QUALITY_HOURLY = 'air_quality_hourly';
const WEATHER_DAILY = 'weather_daily';

/** A nightly record carries some signal iff at least one hour was in-window. */
function hasData(n: WeatherNightly): boolean {
  return n.weatherHourCount > 0 || n.airHourCount > 0;
}

// ---------------------------------------------------------------------------
// Pure assembly (exported for direct unit testing without IndexedDB)
// ---------------------------------------------------------------------------

/** Per-date stored inputs, keyed by local `YYYY-MM-DD`. */
export interface NightlyStoreInputs {
  /** `weather_hourly` payloads keyed by civil date. */
  readonly weatherHourlyByDate: ReadonlyMap<string, WeatherHourly>;
  /** `air_quality_hourly` payloads keyed by civil date. */
  readonly airHourlyByDate: ReadonlyMap<string, AirQualityHourly>;
  /** `weather_daily` payloads keyed by civil date. */
  readonly weatherDailyByDate: ReadonlyMap<string, WeatherDaily>;
  /**
   * Session bounds keyed by the session's local date (the night-ending date).
   * When several sessions share a date, the one with the widest `[start, end)`
   * span should win (longest recording). Absent ⇒ default civil-night window.
   */
  readonly sessionByDate: ReadonlyMap<string, { readonly start: string; readonly end: string }>;
}

/**
 * Build one {@link WeatherNightly} per candidate date from already-loaded stored
 * inputs. Pure: no storage/network. Exposed so tests (and any non-React caller)
 * can assemble nightly records deterministically.
 *
 * For each date `D`, the night's hourly samples are taken from BOTH the record
 * for `D` and the record for `D-1` (to cover a midnight-spanning recording);
 * `computeWeatherNightly` merges and window-filters them.
 *
 * @param dates - Candidate night-ending dates (any order; output is sorted).
 */
export function assembleNightly(
  dates: Iterable<string>,
  inputs: NightlyStoreInputs,
): WeatherNightly[] {
  const out: WeatherNightly[] = [];
  for (const date of new Set(dates)) {
    const prev = subtractDaysIso(date, 1);

    const hourlyWeather: Array<readonly WeatherHourlySample[] | undefined> = [
      inputs.weatherHourlyByDate.get(prev)?.samples,
      inputs.weatherHourlyByDate.get(date)?.samples,
    ];
    const hourlyAir: Array<readonly AirQualityHourlySample[] | undefined> = [
      inputs.airHourlyByDate.get(prev)?.samples,
      inputs.airHourlyByDate.get(date)?.samples,
    ];

    const session = inputs.sessionByDate.get(date);
    const dailyWeather = inputs.weatherDailyByDate.get(date) ?? null;

    out.push(
      computeWeatherNightly({
        date,
        sessionStart: session?.start ?? null,
        sessionEnd: session?.end ?? null,
        hourlyWeather,
        hourlyAir,
        dailyWeather,
      }),
    );
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Compute canonical {@link WeatherNightly} records for every date in
 * `dateRange` that has any stored weather/air-quality data.
 *
 * @param dateRange - Inclusive `YYYY-MM-DD` range. Pass `null` to skip the query
 *                    (returns empty/idle).
 */
export function useWeatherNightly(dateRange: DateRange | null): UseWeatherNightlyResult {
  const [data, setData] = useState<readonly WeatherNightly[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const rangeKey = dateRange ? `${dateRange.start}_${dateRange.end}` : null;

  useEffect(() => {
    if (rangeKey === null || dateRange === null) {
      setData([]);
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

        // A night ending on the range start may pull hourly from the day before,
        // so widen the hourly/daily fetch by one day on the lower bound.
        const fetchStart = subtractDaysIso(dateRange.start, 1);

        const [timeseries, dailySummaries, sessions] = await Promise.all([
          db.getIntegrationTimeseriesByDateRange(fetchStart, dateRange.end),
          db.getIntegrationDailySummariesByDateRange(fetchStart, dateRange.end),
          db.getSessionsByDateRange(dateRange.start, dateRange.end),
        ]);

        if (requestId !== requestIdRef.current) return;

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
        for (const rec of dailySummaries) {
          if (rec.source !== WEATHER_SOURCE) continue;
          if ((rec.dataType as unknown as string) === WEATHER_DAILY) {
            weatherDailyByDate.set(rec.date, rec.data as unknown as WeatherDaily);
          }
        }

        // Pick the widest-span session per date (longest recording wins).
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

        // Candidate night dates: any date in [start, end] that has weather,
        // air-quality, or session data. (Hourly records keyed on `date` itself;
        // the previous-day record is pulled in by `assembleNightly`.)
        const candidates = new Set<string>();
        const inRange = (d: string): boolean => d >= dateRange.start && d <= dateRange.end;
        for (const d of weatherHourlyByDate.keys()) if (inRange(d)) candidates.add(d);
        for (const d of airHourlyByDate.keys()) if (inRange(d)) candidates.add(d);
        for (const d of weatherDailyByDate.keys()) if (inRange(d)) candidates.add(d);
        for (const d of sessionByDate.keys()) if (inRange(d)) candidates.add(d);

        const nightly = assembleNightly(candidates, {
          weatherHourlyByDate,
          airHourlyByDate,
          weatherDailyByDate,
          sessionByDate,
        }).filter(hasData);

        if (requestId !== requestIdRef.current) return;
        setData(nightly);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load nightly weather');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const latest = data.length > 0 ? (data[data.length - 1] as WeatherNightly) : null;
  return { data, latest, loading, error };
}
