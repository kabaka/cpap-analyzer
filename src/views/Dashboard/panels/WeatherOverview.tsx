/**
 * Weather & Air-Quality overview panel for the Dashboard (visual spec §2).
 *
 * Six headline tiles for the most recent synced night — overnight-low
 * temperature, humidity, **barometric pressure** (headline accent), air quality
 * (AQI swatch), dew point, wind — each unit-aware and carrying a 7-day trend
 * with the correct polarity (neutral for the meteorological metrics, polar
 * lower-better for AQI). An "as of {date}" caption is mandatory (provider data
 * lags ~5 days; the panel must never imply "today").
 *
 * Data sources:
 * - Core weather tiles aggregate stored `weather_hourly` over a canonical
 *   overnight window (see {@link overnightWindowFor}); humidity / pressure /
 *   dew point exist only in the hourly series, so the panel reads hourly.
 * - AQI reads the stored `air_quality_daily` overnight aggregate (already true
 *   overnight, derived by the sync service).
 *
 * States: loading skeleton · error · disabled → `null` · enabled-but-unsynced →
 * CTA card · synced → tiles + footer link to the cross-source correlations.
 *
 * NOTE (flagged for the correlation/signal tasks): the overnight window used
 * here is a panel-local canonical window. It should be unified with the
 * session-derived window the correlation surface uses so a metric never shows
 * two different "last-night" numbers. This is intentionally NOT wired to
 * per-session windows to stay out of those tasks' files.
 *
 * @module views/Dashboard/panels/WeatherOverview
 */

import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, TrendIndicator } from '@/components/ui';
import type { TrendDirection, TrendPolarity } from '@/components/ui';
import { AqiSwatch } from '@/components/domain/weather';
import {
  aggregateWeatherNight,
  selectOvernightSamples,
  subtractDaysIso,
  convertTemperature,
  convertPressure,
  convertWind,
  type OvernightWindow,
} from '@/analysis/weather';
import { useWeatherDailySummaries, useWeatherTimeseries } from '@/hooks/useWeatherData';
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { AirQualityDaily, WeatherHourly, WeatherHourlySample } from '@/types/weather';
import type { IntegrationDailySummary, IntegrationTimeseries } from '@/types';
import styles from './WeatherOverview.module.css';

const TREND_WINDOW_DAYS = 7;
const TREND_THRESHOLD = 0.02;
/** How many days of context to load (current night + trend window + lag buffer). */
const LOOKBACK_DAYS = 14;

/** Canonical overnight window for the night that ENDS on `date`. */
function overnightWindowFor(date: string): OvernightWindow {
  const prev = subtractDaysIso(date, 1);
  return { start: `${prev}T22:00`, end: `${date}T10:00` };
}

/** A resolved tile value with its trend. */
interface NumericTile {
  readonly kind: 'numeric';
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly direction: TrendDirection;
  readonly polarity: TrendPolarity;
  readonly headline?: boolean;
}

interface AqiTile {
  readonly kind: 'aqi';
  readonly label: string;
  readonly value: number | null;
  readonly direction: TrendDirection;
}

type Tile = NumericTile | AqiTile;

/** Trend direction of `latest` vs the mean of `prior`. */
function trendOf(latest: number | null, prior: readonly (number | null)[]): TrendDirection {
  const vals = prior.filter((v): v is number => v !== null && Number.isFinite(v));
  if (latest === null || !Number.isFinite(latest) || vals.length === 0) return 'unchanged';
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  if (avg === 0) return 'unchanged';
  const diff = (latest - avg) / Math.abs(avg);
  if (diff > TREND_THRESHOLD) return 'up';
  if (diff < -TREND_THRESHOLD) return 'down';
  return 'unchanged';
}

function fmt(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function fmtInt(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return Math.round(value).toString();
}

interface OvernightCore {
  readonly date: string;
  readonly temperatureLow: number | null;
  readonly humidityMean: number | null;
  readonly pressureMslMean: number | null;
  readonly dewpointMean: number | null;
  readonly windMean: number | null;
}

/** Group hourly weather records by date and aggregate each night. */
function aggregateCore(records: readonly IntegrationTimeseries[]): OvernightCore[] {
  // Collect all samples keyed by their date and also globally (so a night that
  // spans two civil dates can pull from both).
  const all: WeatherHourlySample[] = [];
  const dates = new Set<string>();
  for (const rec of records) {
    const payload = rec.data as unknown as WeatherHourly;
    if (payload && Array.isArray(payload.samples)) {
      all.push(...payload.samples);
    }
    dates.add(rec.date);
  }

  const out: OvernightCore[] = [];
  for (const date of [...dates].sort()) {
    const window = overnightWindowFor(date);
    const inWindow = selectOvernightSamples(all, window);
    if (inWindow.length === 0) continue;
    const agg = aggregateWeatherNight(inWindow, window);
    out.push({
      date,
      temperatureLow: agg.temperatureLow,
      humidityMean: agg.humidityMean,
      pressureMslMean: agg.pressureMslMean,
      dewpointMean: agg.dewpointMean,
      windMean: agg.windMean,
    });
  }
  return out;
}

interface WeatherOverviewProps {
  /** Render even without a stored sync (used to force the unsynced CTA in tests). */
  readonly forceVisible?: boolean;
}

const WeatherOverview = React.memo(function WeatherOverview({
  forceVisible,
}: WeatherOverviewProps) {
  const weather = useSettingsStore((s) => s.integrations.weather);
  const units = weather.units;

  const dateRange = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return { start: subtractDaysIso(today, LOOKBACK_DAYS), end: today };
  }, []);

  const enabled = weather.enabled || forceVisible === true;

  const {
    data: hourly,
    loading: hourlyLoading,
    error: hourlyError,
  } = useWeatherTimeseries(enabled ? 'weather_hourly' : null, enabled ? dateRange : null);

  const {
    airQualityDaily,
    loading: aqLoading,
    error: aqError,
  } = useWeatherDailySummaries(enabled ? dateRange : null);

  const core = useMemo(() => aggregateCore(hourly), [hourly]);

  const aqByDate = useMemo(() => {
    const map = new Map<string, AirQualityDaily>();
    for (const rec of airQualityDaily as readonly IntegrationDailySummary[]) {
      map.set(rec.date, rec.data as unknown as AirQualityDaily);
    }
    return map;
  }, [airQualityDaily]);

  const loading = hourlyLoading || aqLoading;
  const error = hourlyError ?? aqError;

  // The most recent night with any core data.
  const latest = core.length > 0 ? core[core.length - 1] : null;
  const prior = core.slice(0, -1).slice(-TREND_WINDOW_DAYS);

  const tiles: Tile[] = useMemo(() => {
    if (!latest) return [];
    const priorAq = prior.map((c) => aqByDate.get(c.date)?.usAqiMean ?? null);
    const latestAq = aqByDate.get(latest.date)?.usAqiMean ?? null;

    return [
      {
        kind: 'numeric',
        label: 'Overnight Low',
        value: fmt(convertTemperature(latest.temperatureLow, units.temperature), 1),
        unit: units.temperature === 'F' ? '°F' : '°C',
        direction: trendOf(
          latest.temperatureLow,
          prior.map((c) => c.temperatureLow),
        ),
        polarity: 'neutral',
      },
      {
        kind: 'numeric',
        label: 'Humidity',
        value: fmtInt(latest.humidityMean),
        unit: '%',
        direction: trendOf(
          latest.humidityMean,
          prior.map((c) => c.humidityMean),
        ),
        polarity: 'neutral',
      },
      {
        kind: 'numeric',
        label: 'Pressure',
        value: fmt(convertPressure(latest.pressureMslMean, units.pressure), 1),
        unit: units.pressure,
        direction: trendOf(
          latest.pressureMslMean,
          prior.map((c) => c.pressureMslMean),
        ),
        polarity: 'neutral',
        headline: true,
      },
      {
        kind: 'aqi',
        label: 'Air Quality',
        value: latestAq,
        direction: trendOf(latestAq, priorAq),
      },
      {
        kind: 'numeric',
        label: 'Dew Point',
        value: fmt(convertTemperature(latest.dewpointMean, units.temperature), 1),
        unit: units.temperature === 'F' ? '°F' : '°C',
        direction: trendOf(
          latest.dewpointMean,
          prior.map((c) => c.dewpointMean),
        ),
        polarity: 'neutral',
      },
      {
        kind: 'numeric',
        label: 'Wind',
        value: fmtInt(convertWind(latest.windMean, units.wind)),
        unit: units.wind === 'kmh' ? 'km/h' : units.wind === 'mph' ? 'mph' : 'm/s',
        direction: trendOf(
          latest.windMean,
          prior.map((c) => c.windMean),
        ),
        polarity: 'neutral',
      },
    ];
  }, [latest, prior, aqByDate, units]);

  // ── Disabled → render nothing ──
  if (!enabled) return null;

  // ── Loading skeleton ──
  if (loading) {
    return (
      <Card className={styles.card} aria-label="Weather data loading">
        <h3 className={styles.title}>Weather &amp; Air Quality</h3>
        <div className={styles.skeletonGrid}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={styles.skeletonCard} />
          ))}
        </div>
      </Card>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <Card className={styles.card} aria-label="Weather data">
        <h3 className={styles.title}>Weather &amp; Air Quality</h3>
        <p className={styles.errorText} role="alert">
          Failed to load weather data.
        </p>
      </Card>
    );
  }

  // ── Enabled but unsynced → CTA ──
  if (!latest) {
    return (
      <Card className={styles.card} aria-label="Weather data">
        <h3 className={styles.title}>Weather &amp; Air Quality</h3>
        <div className={styles.ctaCard}>
          <p className={styles.ctaText}>
            No weather data yet. Sync your therapy nights to see overnight conditions.
          </p>
          <Link to="/settings" className={styles.ctaButtonLink}>
            <Button variant="primary">Sync now</Button>
          </Link>
        </div>
      </Card>
    );
  }

  // ── Synced → tiles ──
  const today = new Date().toISOString().slice(0, 10);
  const stale = subtractDaysIso(today, 5) > latest.date;
  const asOf = new Date(`${latest.date}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Card className={styles.card} aria-label="Weather and air quality overview">
      <h3 className={styles.title}>Weather &amp; Air Quality</h3>
      <p className={styles.asOfCaption}>
        As of {asOf}
        {stale && ' · provider data lags ~5 days'}
      </p>

      <div className={styles.statsGrid} role="list">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className={styles.statCard}
            role="listitem"
            data-headline={tile.kind === 'numeric' && tile.headline ? 'true' : undefined}
          >
            <span className={styles.statLabel}>{tile.label}</span>
            <div className={styles.statValueRow}>
              {tile.kind === 'aqi' ? (
                <AqiSwatch value={tile.value} scale="us" />
              ) : (
                <>
                  <span className={styles.statValue}>{tile.value}</span>
                  {tile.unit && <span className={styles.statUnit}>{tile.unit}</span>}
                </>
              )}
              <TrendIndicator
                direction={tile.direction}
                polarity={tile.kind === 'aqi' ? 'favorable-low' : tile.polarity}
              />
            </div>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <span className={styles.footerDays}>
          {core.length} {core.length === 1 ? 'night' : 'nights'} of weather data
        </span>
        <Link to="/explore/correlations?tab=cross-source" className={styles.exploreLink}>
          Explore correlations &rarr;
        </Link>
      </div>
    </Card>
  );
});

export default WeatherOverview;
