/**
 * Signal Deck — the dense, monospace "command surface" home dashboard.
 *
 * Owns the deck's data hooks and composes the panels: the good-night-rate
 * verdict, the 12-month AHI calendar spine, alert cards, signal small-multiples,
 * distributions, wearable lanes, the TECSA dumbbell, the (opt-in) weather panel,
 * and the session log.
 *
 * ## Windowing
 * The 30D/90D toggle drives the global `dateRange` (30d / 90d presets), which the
 * deck body follows. The calendar heatmap and monthly strip always cover a
 * trailing 12 months regardless of the toggle — they are the longitudinal spine —
 * so they read from a SECOND, widened `useNightlyAggregates` call.
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
import { SegmentedControl } from '@/components/ui';
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

type WindowKey = '30d' | '90d';

const WINDOW_OPTIONS = [
  { value: '30d' as const, label: '30D', ariaLabel: 'Last 30 days' },
  { value: '90d' as const, label: '90D', ariaLabel: 'Last 90 days' },
];

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

/** Short month/day label, e.g. "Jul 5". */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
  const setDateRange = useAppStore((s) => s.setDateRange);

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

  const activeWindow: WindowKey = useMemo(() => {
    const diffDays = Math.round((dateRange.end.getTime() - dateRange.start.getTime()) / 86_400_000);
    return diffDays <= 45 ? '30d' : '90d';
  }, [dateRange]);

  const handleWindowChange = useCallback(
    (value: WindowKey) => {
      setDateRange({ start: daysAgo(value === '30d' ? 30 : 90), end: new Date() });
    },
    [setDateRange],
  );

  const coverage = useMemo(() => {
    if (sortedAggregates.length === 0) return `${sessions.length} nights`;
    const first = sortedAggregates[0]?.date;
    const last = sortedAggregates[sortedAggregates.length - 1]?.date;
    return `${shortDate(first ?? '')} – ${shortDate(last ?? '')} · ${sortedAggregates.length} nights`;
  }, [sortedAggregates, sessions.length]);

  // Empty state: no sessions, not loading, no error.
  const hasData = sessions.length > 0 || loading;
  if (!hasData && !error) {
    return <EmptyState />;
  }

  return (
    <div className={styles.deck}>
      {/* Terminal header (contains the real <h1>). */}
      <header className={styles.terminal}>
        <div className={styles.terminalLeft}>
          <span className={styles.brand} aria-hidden="true">
            CPAP<span className={styles.brandSlash}>//</span>ANALYZER
          </span>
          <span className={styles.brandDivider} aria-hidden="true" />
          {/* Real page heading (accessible name "Dashboard"), styled small to
              integrate with the terminal header. Single <h1> on the page. */}
          <h1 className={styles.section}>Dashboard</h1>
          <span className={styles.localBadge}>
            <span className={styles.pulseDot} aria-hidden="true" />
            LOCAL · NO UPLOAD
          </span>
        </div>
        <div className={styles.terminalRight}>
          <span className={styles.coverage}>{coverage}</span>
          <SegmentedControl
            label="Analysis window"
            options={WINDOW_OPTIONS}
            value={activeWindow}
            onChange={handleWindowChange}
          />
        </div>
      </header>

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
