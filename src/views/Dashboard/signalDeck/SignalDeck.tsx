/**
 * Signal Deck — the dense, monospace "command surface" home dashboard.
 *
 * Owns the deck's data hooks and composes the panels: the good-night-rate
 * verdict, the 12-month AHI calendar spine, alert cards, signal small-multiples,
 * distributions, wearable lanes, the TECSA dumbbell, the (opt-in) weather panel,
 * and the session log.
 *
 * ## Windowing
 * The deck body follows the global `dateRange`, driven by the shell's window
 * toggle (all presets, 7D–12M). The calendar heatmap and monthly strip always
 * cover a trailing 12 months regardless of the global window — they are the
 * longitudinal spine — so they read from a SECOND, widened
 * `useNightlyAggregates` call.
 *
 * ## Real data, honest gaps
 * Every value comes from the real analysis hooks and the tested pure selectors in
 * `./metrics`. `null` per-hour indices are gaps ("—"), never `0`. When no
 * wearable data exists, the wearable lane panel is omitted and the HR/HRV
 * small-multiple cells read "—".
 *
 * @module views/Dashboard/signalDeck/SignalDeck
 */

import { useCallback, useMemo } from 'react';

import { classifyAhiSeverity } from '@/analysis/clinical';
import { Card } from '@/components/ui';
import {
  buildDateRangeInput,
  buildGroundingCommon,
  machineClassOf,
  rangeScopeLabel,
} from '@/components/insights';
import type { InsightRequest } from '@/components/insights';
import { useNightlyAggregates } from '@/hooks/useNightlyAggregates';
import { useSessionData } from '@/hooks/useSessionData';
import { useSummaryStats } from '@/hooks/useSummaryStats';
import { useWearableSummary } from '@/hooks/useWearableSummary';
import { useWearableDailySummaries } from '@/hooks/useWearableData';
import { useAppStore } from '@/stores/useAppStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { IntegrationDailySummary, NightlyAggregate } from '@/types';
import { formatDate } from '@/utils/formatDate';

import { EmptyState } from '../EmptyState';
import { generateInsights } from '../insights';
import AhiCalendarPanel from './AhiCalendarPanel';
import AlertCards from './AlertCards';
import DistributionsRow from './DistributionsRow';
import SessionLog from './SessionLog';
import SmallMultiples from './SmallMultiples';
import TecsaDumbbell from './TecsaDumbbell';
import VerdictCard from './VerdictCard';
import WearableLanes from './WearableLanes';
import WeatherPanel from './WeatherPanel';
import { goodNightRate, seriesMean } from './metrics';
import styles from './SignalDeck.module.css';

/** Midnight-anchored date `days` before now (mirrors DateRangeSelector). */
function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

/** Read a finite numeric property from an unknown daily payload, else null. */
function pickNumber(data: unknown, key: string): number | null {
  if (data && typeof data === 'object' && key in data) {
    const value = (data as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  return null;
}

/** Align a wearable daily series to the given ordered night dates (`null` = gap). */
function alignSeries(
  dates: readonly string[],
  summaries: readonly IntegrationDailySummary[],
  pick: (data: unknown) => number | null,
): (number | null)[] {
  const byDate = new Map<string, IntegrationDailySummary>();
  for (const summary of summaries) byDate.set(summary.date, summary);
  return dates.map((date) => {
    const summary = byDate.get(date);
    return summary ? pick(summary.data) : null;
  });
}

/**
 * Deterministic, non-fabricated range summary. Factual and non-diagnostic — it
 * only restates already-computed metrics; it names no condition and no therapy.
 */
function buildNarrative(
  nights: readonly NightlyAggregate[],
  meanAhi: number,
  complianceRate: number,
  meanUsageHours: number,
  trendAhiPercent: number,
): string {
  if (nights.length === 0) return 'No nights recorded in this range yet.';
  const severity = classifyAhiSeverity(meanAhi);
  const central = seriesMean(nights.map((n) => n.ahiCentral));
  const trendWord = trendAhiPercent < -2 ? 'down' : trendAhiPercent > 2 ? 'up' : 'roughly flat';
  const trendClause =
    trendWord === 'roughly flat'
      ? 'roughly flat'
      : `${trendWord} ${Math.abs(Math.round(trendAhiPercent))}%`;
  const centralClause = central === null ? '' : ` Central index averages ${central.toFixed(2)}/h.`;
  return (
    `Over ${nights.length} nights, pooled AHI is ${meanAhi.toFixed(1)}/h (${severity}), ` +
    `trending ${trendClause}. Adherence is ${Math.round(complianceRate * 100)}% at ` +
    `${meanUsageHours.toFixed(1)}h mean usage.${centralClause}`
  );
}

export function SignalDeck(): JSX.Element {
  const dateRange = useAppStore((s) => s.dateRange);

  const { sessions, loading: sessionsLoading, error: sessionsError } = useSessionData(dateRange);
  const { stats, loading: statsLoading, error: statsError } = useSummaryStats(dateRange);
  const { aggregates, loading: aggLoading, error: aggError } = useNightlyAggregates(dateRange);

  // Widened trailing-12-month window for the calendar spine (independent of the
  // 30/90D toggle). formatDate() yields a stable YYYY-MM-DD within a day, so the
  // underlying hook does not re-fetch on every render.
  const wideRange = useMemo(() => ({ start: daysAgo(365), end: new Date() }), []);
  const { aggregates: heatmapAggregates } = useNightlyAggregates(wideRange);

  const { summary: wearableSummary } = useWearableSummary();
  const wearableAvailable = wearableSummary?.hasData ?? false;

  // The wearable hooks key on ISO date strings, not Date objects.
  const isoRange = useMemo(
    () => ({ start: formatDate(dateRange.start), end: formatDate(dateRange.end) }),
    [dateRange],
  );
  const { data: hrSummaries } = useWearableDailySummaries(
    wearableAvailable ? 'heart_rate_resting' : null,
    isoRange,
  );
  const { data: spo2Summaries } = useWearableDailySummaries(
    wearableAvailable ? 'spo2_daily' : null,
    isoRange,
  );
  const { data: hrvSummaries } = useWearableDailySummaries(
    wearableAvailable ? 'hrv_daily' : null,
    isoRange,
  );

  const ahiThresholds = useSettingsStore((s) => s.analysisParams.ahi);
  const displayPrefs = useSettingsStore((s) => s.display);
  const weatherEnabled = useSettingsStore((s) => s.integrations.weather.enabled);

  const error = sessionsError ?? statsError ?? aggError;
  const loading = statsLoading || sessionsLoading || aggLoading;

  // Aggregates sorted oldest → newest for the deck's time series.
  const sortedAggregates = useMemo(
    () => [...aggregates].sort((a, b) => a.date.localeCompare(b.date)),
    [aggregates],
  );
  const nightDates = useMemo(() => sortedAggregates.map((a) => a.date), [sortedAggregates]);

  const hrSeries = useMemo(
    () => alignSeries(nightDates, hrSummaries, (d) => pickNumber(d, 'restingHeartRate')),
    [nightDates, hrSummaries],
  );
  const spo2Series = useMemo(
    () => alignSeries(nightDates, spo2Summaries, (d) => pickNumber(d, 'min')),
    [nightDates, spo2Summaries],
  );
  const hrvSeries = useMemo(
    () => alignSeries(nightDates, hrvSummaries, (d) => pickNumber(d, 'dailyRmssd')),
    [nightDates, hrvSummaries],
  );

  const goodNight = useMemo(() => goodNightRate(sortedAggregates), [sortedAggregates]);

  const insights = useMemo(() => {
    if (!stats || aggregates.length === 0) return [];
    return generateInsights(aggregates, stats);
  }, [aggregates, stats]);

  const narrative = useMemo(() => {
    if (!stats) return 'Loading range summary…';
    return buildNarrative(
      sortedAggregates,
      stats.meanAHI,
      stats.complianceRate,
      stats.meanUsageHours,
      stats.trendAHIPercent,
    );
  }, [stats, sortedAggregates]);

  const buildRangeRequest = useCallback((): InsightRequest => {
    const common = buildGroundingCommon(
      { ahi: ahiThresholds, display: displayPrefs },
      machineClassOf(sessions[0]?.machineType),
    );
    return {
      input: buildDateRangeInput(aggregates, common),
      scopeLabel: rangeScopeLabel(formatDate(dateRange.start), formatDate(dateRange.end)),
    };
  }, [aggregates, ahiThresholds, displayPrefs, sessions, dateRange]);

  // Empty state: no sessions, not loading, no error.
  const hasData = sessions.length > 0 || loading;
  if (!hasData && !error) {
    return <EmptyState />;
  }

  return (
    <div className={styles.deck}>
      {/* The shell's command strip owns the visible section title, LOCAL·NO UPLOAD
          badge, coverage string, and window toggle. The deck keeps a single
          visually-hidden <h1> so the page still exposes one programmatic heading
          named "Dashboard" (a11y + e2e). */}
      <h1 className={styles.srOnly}>Dashboard</h1>

      {error && (
        <Card className={styles.errorBanner}>
          <p className={styles.errorMessage} role="alert">
            {error}
          </p>
        </Card>
      )}

      {stats && (
        <>
          {/* Top: verdict + calendar spine + alerts */}
          <div className={styles.topGrid}>
            <VerdictCard
              goodNight={goodNight}
              narrative={narrative}
              buildRequest={buildRangeRequest}
            />
            <div className={styles.rightColumn}>
              <AhiCalendarPanel
                aggregates={heatmapAggregates}
                rangeStart={formatDate(wideRange.start)}
                rangeEnd={formatDate(wideRange.end)}
              />
              <AlertCards insights={insights} />
            </div>
          </div>

          {/* Signal small-multiples */}
          <SmallMultiples
            aggregates={sortedAggregates}
            stats={stats}
            hrSeries={hrSeries}
            hrvSeries={hrvSeries}
            wearableAvailable={wearableAvailable}
          />

          {/* Distributions + event stack */}
          <DistributionsRow aggregates={sortedAggregates} />

          {/* Wearable lanes + TECSA */}
          <div className={styles.wearableGrid}>
            {wearableAvailable ? (
              <WearableLanes hrSeries={hrSeries} spo2Series={spo2Series} hrvSeries={hrvSeries} />
            ) : (
              <div className={styles.panel}>
                <h2 className={styles.panelTitle}>Wearable correlation lanes</h2>
                <p className={styles.panelSub} style={{ marginTop: 'var(--space-3)' }}>
                  Connect a wearable to overlay resting HR, SpO₂, and HRV against your nights.
                </p>
              </div>
            )}
            {/* TECSA is a long-horizon trajectory — classify over the widened
                trailing-12-month window, not the 30/90D toggle window. */}
            <TecsaDumbbell loading={loading} dateRange={wideRange} />
          </div>

          {/* Weather & air quality — only when the integration is enabled. */}
          {weatherEnabled && <WeatherPanel />}

          {/* Session log */}
          <SessionLog sessions={sessions} aggregates={sortedAggregates} />
        </>
      )}
    </div>
  );
}

export default SignalDeck;
