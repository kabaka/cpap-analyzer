/**
 * Wearable Data overview panel for the Dashboard.
 *
 * Shows compact stat cards for the most recent day's wearable metrics
 * (Sleep Score, HRV, Resting Heart Rate, SpO2, Readiness, Steps) with
 * trend indicators comparing the latest value to the 7-day average.
 *
 * Only renders when wearable data is available (controlled by the parent).
 *
 * @module views/Dashboard/panels/WearableOverview
 */

import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui';
import { useWearableDailySummaries } from '@/hooks/useWearableData';
import type { WearableSummary } from '@/hooks/useWearableSummary';
import type {
  FitbitDailyType,
  FitbitSleepScore,
  FitbitHRVDaily,
  FitbitRestingHeartRate,
  FitbitSpO2Daily,
  FitbitReadiness,
  FitbitActivityDaily,
  IntegrationDailySummary,
} from '@/types';
import styles from './WearableOverview.module.css';

// ---------------------------------------------------------------------------
// Metric configuration
// ---------------------------------------------------------------------------

interface MetricConfig {
  /** FitbitDailyType to query from IndexedDB. */
  dataType: FitbitDailyType;
  /** Display label for the stat card. */
  label: string;
  /** Unit string displayed next to the value. */
  unit: string;
  /** Extract the numeric value from a daily summary payload. Returns null if unavailable. */
  extract: (data: unknown) => number | null;
  /** Format the numeric value for display. */
  format: (value: number) => string;
  /**
   * Whether a higher value is "better" (true) or lower is better (false).
   * Determines the color polarity of the trend arrow.
   */
  higherIsBetter: boolean;
}

const METRIC_CONFIGS: readonly MetricConfig[] = [
  {
    dataType: 'sleep_score',
    label: 'Sleep Score',
    unit: '',
    extract: (d) => (d as FitbitSleepScore)?.overallScore ?? null,
    format: (v) => Math.round(v).toString(),
    higherIsBetter: true,
  },
  {
    dataType: 'hrv_daily',
    label: 'HRV (RMSSD)',
    unit: 'ms',
    extract: (d) => (d as FitbitHRVDaily)?.dailyRmssd ?? null,
    format: (v) => v.toFixed(1),
    higherIsBetter: true,
  },
  {
    dataType: 'heart_rate_resting',
    label: 'Resting HR',
    unit: 'bpm',
    extract: (d) => (d as FitbitRestingHeartRate)?.restingHeartRate ?? null,
    format: (v) => Math.round(v).toString(),
    higherIsBetter: false,
  },
  {
    dataType: 'spo2_daily',
    label: 'SpO2 Avg',
    unit: '%',
    extract: (d) => (d as FitbitSpO2Daily)?.avg ?? null,
    format: (v) => v.toFixed(1),
    higherIsBetter: true,
  },
  {
    dataType: 'readiness',
    label: 'Readiness',
    unit: '',
    extract: (d) => (d as FitbitReadiness)?.score ?? null,
    format: (v) => Math.round(v).toString(),
    higherIsBetter: true,
  },
  {
    dataType: 'activity_daily',
    label: 'Steps',
    unit: '',
    extract: (d) => (d as FitbitActivityDaily)?.steps ?? null,
    format: (v) => v.toLocaleString(),
    higherIsBetter: true,
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Number of days to look back for trend computation. */
const TREND_WINDOW_DAYS = 7;

/** Threshold (as fraction of average) below which trend is considered unchanged. */
const TREND_THRESHOLD = 0.02;

type TrendDirection = 'up' | 'down' | 'unchanged';

interface ResolvedMetric {
  label: string;
  unit: string;
  value: string;
  trend: TrendDirection;
  /** Whether the current trend direction is favorable. */
  favorable: boolean;
}

/**
 * Build an ISO date string for N days before the given date string.
 */
function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Find the most recent date in a list of daily summary records.
 */
function findMostRecentDate(records: readonly IntegrationDailySummary[]): string | null {
  let latest: string | null = null;
  for (const r of records) {
    if (latest === null || r.date > latest) {
      latest = r.date;
    }
  }
  return latest;
}

/**
 * Compute the trend direction from the latest value vs. the 7-day average.
 */
function computeTrend(latestValue: number, values: readonly number[]): TrendDirection {
  if (values.length === 0) return 'unchanged';

  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (avg === 0) return 'unchanged';

  const diff = (latestValue - avg) / Math.abs(avg);
  if (diff > TREND_THRESHOLD) return 'up';
  if (diff < -TREND_THRESHOLD) return 'down';
  return 'unchanged';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface WearableOverviewProps {
  summary: WearableSummary;
}

const WearableOverview = React.memo(function WearableOverview({ summary }: WearableOverviewProps) {
  // Determine the data types we need to query, filtered to what is available.
  const availableSet = useMemo(
    () => new Set(summary.availableDataTypes),
    [summary.availableDataTypes],
  );

  const relevantTypes = useMemo(
    () =>
      METRIC_CONFIGS.filter((m) => availableSet.has(m.dataType)).map(
        (m) => m.dataType as FitbitDailyType,
      ),
    [availableSet],
  );

  // Compute the date range: we need TREND_WINDOW_DAYS + 1 (the current day).
  // We use "today" as the end date and look back.
  const dateRange = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      start: subtractDays(today, TREND_WINDOW_DAYS),
      end: today,
    };
  }, []);

  const {
    data: dailySummaries,
    loading,
    error,
  } = useWearableDailySummaries(
    relevantTypes.length > 0 ? relevantTypes : null,
    relevantTypes.length > 0 ? dateRange : null,
  );

  // Group summaries by data type for easier access.
  const byType = useMemo(() => {
    const map = new Map<FitbitDailyType, IntegrationDailySummary[]>();
    for (const record of dailySummaries) {
      const list = map.get(record.dataType) ?? [];
      list.push(record);
      map.set(record.dataType, list);
    }
    return map;
  }, [dailySummaries]);

  // Resolve each metric to its display values.
  const resolvedMetrics: ResolvedMetric[] = useMemo(() => {
    const results: ResolvedMetric[] = [];

    for (const config of METRIC_CONFIGS) {
      if (!availableSet.has(config.dataType)) continue;

      const records = byType.get(config.dataType);
      if (!records || records.length === 0) continue;

      // Find the most recent day.
      const latestDate = findMostRecentDate(records);
      if (!latestDate) continue;

      const latestRecord = records.find((r) => r.date === latestDate);
      if (!latestRecord) continue;

      const latestValue = config.extract(latestRecord.data);
      if (latestValue === null) continue;

      // Compute trend: compare latest value to previous days' average.
      const previousValues: number[] = [];
      for (const r of records) {
        if (r.date === latestDate) continue;
        const v = config.extract(r.data);
        if (v !== null) previousValues.push(v);
      }

      const trend = computeTrend(latestValue, previousValues);
      const favorable =
        trend === 'unchanged' ||
        (trend === 'up' && config.higherIsBetter) ||
        (trend === 'down' && !config.higherIsBetter);

      results.push({
        label: config.label,
        unit: config.unit,
        value: config.format(latestValue),
        trend,
        favorable,
      });
    }

    return results;
  }, [availableSet, byType]);

  // Count total days of wearable data for the footer.
  const dayCount = useMemo(() => {
    const dates = new Set<string>();
    for (const record of dailySummaries) {
      dates.add(record.date);
    }
    return dates.size;
  }, [dailySummaries]);

  // --- Loading state ---
  if (loading) {
    return (
      <Card className={styles.card} aria-label="Wearable data loading">
        <h3 className={styles.title}>Wearable Data</h3>
        <div className={styles.skeletonGrid}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles.skeletonCard} />
          ))}
        </div>
      </Card>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <Card className={styles.card} aria-label="Wearable data">
        <h3 className={styles.title}>Wearable Data</h3>
        <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
          Failed to load wearable data.
        </p>
      </Card>
    );
  }

  // --- No metrics resolved ---
  if (resolvedMetrics.length === 0) {
    return null;
  }

  return (
    <Card className={styles.card} aria-label="Wearable data overview">
      <h3 className={styles.title}>Wearable Data</h3>

      <div className={styles.statsGrid} role="list">
        {resolvedMetrics.map((metric) => (
          <div key={metric.label} className={styles.statCard} role="listitem">
            <span className={styles.statLabel}>{metric.label}</span>
            <div className={styles.statValueRow}>
              <span className={styles.statValue}>{metric.value}</span>
              {metric.unit && <span className={styles.statUnit}>{metric.unit}</span>}
              <TrendIndicator direction={metric.trend} favorable={metric.favorable} />
            </div>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <span className={styles.footerDays}>
          {dayCount} {dayCount === 1 ? 'day' : 'days'} of wearable data
        </span>
        <Link to="/explore/correlations?tab=cross-source" className={styles.exploreLink}>
          Explore correlations &rarr;
        </Link>
      </div>
    </Card>
  );
});

export default WearableOverview;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface TrendIndicatorProps {
  direction: TrendDirection;
  favorable: boolean;
}

function TrendIndicator({ direction, favorable }: TrendIndicatorProps) {
  if (direction === 'unchanged') {
    return (
      <span className={`${styles.trend} ${styles.trendUnchanged}`} aria-label="Trend unchanged">
        &mdash;
      </span>
    );
  }

  const arrow = direction === 'up' ? '↑' : '↓';
  const trendClass = favorable ? styles.trendUp : styles.trendDown;
  const label = `Trend ${direction}${favorable ? ' (favorable)' : ' (unfavorable)'}`;

  return (
    <span className={`${styles.trend} ${trendClass}`} aria-label={label}>
      {arrow}
    </span>
  );
}
