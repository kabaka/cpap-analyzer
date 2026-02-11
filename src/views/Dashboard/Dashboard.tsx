/**
 * Main dashboard view.
 *
 * Shows an empty state when no data is imported, or the full dashboard
 * with KPI cards, date range selector, and recent sessions table.
 *
 * @module views/Dashboard/Dashboard
 */

import { useAppStore } from '@/stores/useAppStore';
import { useSessionData } from '@/hooks/useSessionData';
import { useSummaryStats } from '@/hooks/useSummaryStats';
import { DateRangeSelector } from '@/components/domain/DateRangeSelector';
import { KPICard } from '@/components/domain/KPICard';
import { SessionsTable } from '@/components/domain/SessionsTable';
import { Card } from '@/components/ui';
import { EmptyState } from './EmptyState';
import styles from './Dashboard.module.css';

/** Map AHI value to clinical severity. */
function ahiSeverity(ahi: number): 'normal' | 'mild' | 'moderate' | 'severe' {
  if (ahi < 5) return 'normal';
  if (ahi < 15) return 'mild';
  if (ahi < 30) return 'moderate';
  return 'severe';
}

export default function Dashboard() {
  const dateRange = useAppStore((s) => s.dateRange);
  const { sessions, loading: sessionsLoading, error: sessionsError } = useSessionData(dateRange);
  const { stats, loading: statsLoading, error: statsError } = useSummaryStats(dateRange);

  const error = sessionsError ?? statsError;

  // Show empty state if no sessions, not loading, and no errors
  const hasData = sessions.length > 0 || statsLoading || sessionsLoading;

  if (!hasData && !error) {
    return <EmptyState />;
  }

  const loading = statsLoading || sessionsLoading;

  return (
    <div className={styles.dashboard}>
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

      {/* KPI Cards */}
      <section className={styles.kpiGrid} aria-label="Key performance indicators">
        <KPICard
          title="AHI"
          value={stats ? stats.meanAHI.toFixed(1) : '—'}
          unit="events/hr"
          severity={stats ? ahiSeverity(stats.meanAHI) : undefined}
          loading={loading}
        />
        <KPICard
          title="Leak Rate"
          value={stats ? stats.meanLeak.toFixed(1) : '—'}
          unit="L/min"
          loading={loading}
        />
        <KPICard
          title="Usage"
          value={stats ? stats.meanUsageHours.toFixed(1) : '—'}
          unit="hrs/night"
          loading={loading}
        />
        <KPICard
          title="Compliance"
          value={stats ? `${(stats.complianceRate * 100).toFixed(0)}` : '—'}
          unit="%"
          loading={loading}
        />
      </section>

      {/* Recent Sessions */}
      <section className={styles.sessionsSection}>
        <Card>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Recent Sessions</h2>
            <span className={styles.sessionCount}>
              {stats ? `${stats.totalSessions} total` : ''}
            </span>
          </div>
          <SessionsTable sessions={sessions} limit={10} />
        </Card>
      </section>
    </div>
  );
}
