/**
 * Main dashboard view — "Control Room" redesign.
 *
 * Dense, information-rich dashboard with KPI sparklines, therapy charts,
 * event distribution, machine settings, auto-insights, and recent sessions.
 *
 * @module views/Dashboard/Dashboard
 */

import { useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { useSessionData } from '@/hooks/useSessionData';
import { useSummaryStats } from '@/hooks/useSummaryStats';
import { useNightlyAggregates } from '@/hooks/useNightlyAggregates';
import { useWearableSummary } from '@/hooks/useWearableSummary';
import { DateRangeSelector } from '@/components/domain/DateRangeSelector';
import { Card } from '@/components/ui';
import {
  InsightTrigger,
  buildDateRangeInput,
  buildGroundingCommon,
  machineClassOf,
  rangeScopeLabel,
} from '@/components/insights';
import { formatDate } from '@/utils/formatDate';
import { generateInsights } from './insights';
import { findFirstSettingsChangeDate } from '@/views/Trends/utils/detectSettingsChanges';
import { EmptyState } from './EmptyState';
import KPIRow from './panels/KPIRow';
import TherapyOverview from './panels/TherapyOverview';
import EventDistribution from './panels/EventDistribution';
import InsightsPanel from './panels/InsightsPanel';
import BreathingStabilityPanel from './panels/BreathingStabilityPanel';
import MachineSettingsPanel from './panels/MachineSettingsPanel';
import RecentSessions from './panels/RecentSessions';
import WearableOverview from './panels/WearableOverview';
import WeatherOverview from './panels/WeatherOverview';
import { useSettingsStore } from '@/stores/useSettingsStore';
import styles from './Dashboard.module.css';
import type { MachineSettings } from '@/types';

export default function Dashboard() {
  const dateRange = useAppStore((s) => s.dateRange);
  const { sessions, loading: sessionsLoading, error: sessionsError } = useSessionData(dateRange);
  const { stats, loading: statsLoading, error: statsError } = useSummaryStats(dateRange);
  const { aggregates, loading: aggLoading, error: aggError } = useNightlyAggregates(dateRange);
  const { summary: wearableSummary } = useWearableSummary();
  const weatherEnabled = useSettingsStore((s) => s.integrations.weather.enabled);
  const ahiThresholds = useSettingsStore((s) => s.analysisParams.ahi);
  const displayPrefs = useSettingsStore((s) => s.display);

  const error = sessionsError ?? statsError ?? aggError;
  const loading = statsLoading || sessionsLoading || aggLoading;

  // Machine settings from the most recent session
  const machineSettings: MachineSettings | null = useMemo(() => {
    if (sessions.length === 0) return null;
    // Sessions are sorted newest-first by useSessionData
    return sessions[0]?.machineSettings ?? null;
  }, [sessions]);

  // Detect settings changes in aggregates
  const settingsChangeDate = useMemo(() => findFirstSettingsChangeDate(aggregates), [aggregates]);

  // Generate insights
  const insights = useMemo(() => {
    if (!stats || aggregates.length === 0) return [];
    return generateInsights(aggregates, stats);
  }, [aggregates, stats]);

  // Build the "Summarize range" insight request from the loaded aggregates and
  // the active thresholds/display prefs. Lazy: assembled only when the trigger
  // is activated (the InsightTrigger calls this on click). Trends are computed
  // by the builder via the existing `linearTrend` estimator — the UI never
  // re-implements a statistic.
  const buildRangeRequest = useCallback(() => {
    const common = buildGroundingCommon(
      { ahi: ahiThresholds, display: displayPrefs },
      machineClassOf(sessions[0]?.machineType),
    );
    return {
      input: buildDateRangeInput(aggregates, common),
      scopeLabel: rangeScopeLabel(formatDate(dateRange.start), formatDate(dateRange.end)),
    };
  }, [aggregates, ahiThresholds, displayPrefs, sessions, dateRange]);

  // Trend data for charts
  const trendData = stats?.trendData ?? [];

  // Show empty state if no sessions, not loading, and no errors
  const hasData = sessions.length > 0 || loading;

  if (!hasData && !error) {
    return <EmptyState />;
  }

  return (
    <div className={styles.dashboard}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>Dashboard</h1>
        <div className={styles.headerActions}>
          <InsightTrigger
            label="Summarize range"
            ariaLabel="Summarize the selected date range with AI"
            buildRequest={buildRangeRequest}
          />
          <DateRangeSelector />
        </div>
      </div>

      {error && (
        <Card className={styles.errorBanner}>
          <p className={styles.errorMessage} role="alert">
            {error}
          </p>
        </Card>
      )}

      {/* KPI Row */}
      <KPIRow stats={stats} loading={loading} />

      {/* Therapy Overview Charts */}
      <div className={styles.sectionWithAffordance}>
        <div className={styles.sectionAffordance}>
          <InsightTrigger
            label="Explain trend"
            ariaLabel="Explain the therapy trends for the selected range with AI"
            appearance="subtle"
            buildRequest={() => {
              const request = buildRangeRequest();
              return {
                ...request,
                userBrief: 'Describe the AHI, usage, and leak trends shown for this range.',
              };
            }}
          />
        </div>
        <TherapyOverview trendData={trendData} loading={loading} />
      </div>

      {/* Event Distribution + Insights */}
      <div className={styles.analyticsRow}>
        <EventDistribution trendData={trendData} loading={loading} />
        <InsightsPanel insights={insights} loading={loading} />
      </div>

      {/* Breathing-stability insight (app-computed TECSA trajectory). */}
      <div className={styles.breathingRow}>
        <BreathingStabilityPanel loading={loading} />
      </div>

      {/* Wearable Data Overview (when available) */}
      {wearableSummary?.hasData && (
        <div className={styles.wearableRow}>
          <WearableOverview summary={wearableSummary} />
        </div>
      )}

      {/* Weather & Air Quality Overview (when the integration is enabled) */}
      {weatherEnabled && (
        <div className={styles.wearableRow}>
          <WeatherOverview />
        </div>
      )}

      {/* Machine Settings + Recent Sessions */}
      <div className={styles.bottomRow}>
        <MachineSettingsPanel
          settings={machineSettings}
          settingsChangeDate={settingsChangeDate}
          loading={loading}
        />
        <RecentSessions sessions={sessions} aggregates={aggregates} loading={loading} />
      </div>
    </div>
  );
}
