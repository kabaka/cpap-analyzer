/**
 * Main dashboard view — "Control Room" redesign.
 *
 * Dense, information-rich dashboard with KPI sparklines, therapy charts,
 * event distribution, machine settings, auto-insights, and recent sessions.
 *
 * @module views/Dashboard/Dashboard
 */

import { useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { useSessionData } from '@/hooks/useSessionData';
import { useSummaryStats } from '@/hooks/useSummaryStats';
import { useNightlyAggregates } from '@/hooks/useNightlyAggregates';
import { DateRangeSelector } from '@/components/domain/DateRangeSelector';
import { Card } from '@/components/ui';
import { generateInsights } from './insights';
import { EmptyState } from './EmptyState';
import KPIRow from './panels/KPIRow';
import TherapyOverview from './panels/TherapyOverview';
import EventDistribution from './panels/EventDistribution';
import InsightsPanel from './panels/InsightsPanel';
import MachineSettingsPanel from './panels/MachineSettingsPanel';
import RecentSessions from './panels/RecentSessions';
import styles from './Dashboard.module.css';
import type { MachineSettings } from '@/types';

export default function Dashboard() {
  const dateRange = useAppStore((s) => s.dateRange);
  const { sessions, loading: sessionsLoading, error: sessionsError } = useSessionData(dateRange);
  const { stats, loading: statsLoading, error: statsError } = useSummaryStats(dateRange);
  const { aggregates, loading: aggLoading, error: aggError } = useNightlyAggregates(dateRange);

  const error = sessionsError ?? statsError ?? aggError;
  const loading = statsLoading || sessionsLoading || aggLoading;

  // Machine settings from the most recent session
  const machineSettings: MachineSettings | null = useMemo(() => {
    if (sessions.length === 0) return null;
    // Sessions are sorted newest-first by useSessionData
    return sessions[0]?.machineSettings ?? null;
  }, [sessions]);

  // Detect settings changes in aggregates
  const settingsChangeDate = useMemo(() => {
    if (aggregates.length < 2) return null;
    const sorted = [...aggregates].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    if (!latest) return null;
    for (let i = 0; i < sorted.length - 1; i++) {
      const agg = sorted[i];
      if (!agg) continue;
      if (
        agg.configuredMinPressure !== latest.configuredMinPressure ||
        agg.configuredMaxPressure !== latest.configuredMaxPressure ||
        agg.eprLevel !== latest.eprLevel
      ) {
        return sorted[i + 1]?.date ?? agg.date;
      }
    }
    return null;
  }, [aggregates]);

  // Generate insights
  const insights = useMemo(() => {
    if (!stats || aggregates.length === 0) return [];
    return generateInsights(aggregates, stats);
  }, [aggregates, stats]);

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
        <DateRangeSelector />
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
      <TherapyOverview trendData={trendData} loading={loading} />

      {/* Event Distribution + Insights */}
      <div className={styles.analyticsRow}>
        <EventDistribution trendData={trendData} loading={loading} />
        <InsightsPanel insights={insights} loading={loading} />
      </div>

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
