/**
 * Trends View — long-term therapy data analysis with synchronized charts.
 *
 * Displays 6 vertically stacked time-series charts sharing a synchronized
 * x-axis, crosshair, and date range. Each data point is one night.
 *
 * @module views/Trends/Trends
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';
import { useNightlyAggregates } from '@/hooks/useNightlyAggregates';
import { DateRangeSelector } from '@/components/domain/DateRangeSelector';
import { SyncedChartProvider } from './context/SyncedChartContext';
import { detectSettingsChanges } from './utils/detectSettingsChanges';
import AHITrendChart from './charts/AHITrendChart';
import UsageChart from './charts/UsageChart';
import LeakRateChart from './charts/LeakRateChart';
import PressureChart from './charts/PressureChart';
import EventBreakdownChart from './charts/EventBreakdownChart';
import SettingsChart from './charts/SettingsChart';
import SharedXAxis from './charts/SharedXAxis';
import StatsSidebar from './sidebar/StatsSidebar';
import styles from './Trends.module.css';

/** Chart heights in px by responsive tier. Uses desktop defaults. */
const CHART_HEIGHT = 180;
const SETTINGS_CHART_HEIGHT = 120;

export default function Trends() {
  const navigate = useNavigate();
  const dateRange = useAppStore((s) => s.dateRange);
  const { aggregates, loading, error } = useNightlyAggregates(dateRange);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Sort aggregates by date for chart rendering
  const sortedAggregates = useMemo(
    () => [...aggregates].sort((a, b) => a.date.localeCompare(b.date)),
    [aggregates],
  );

  // Detect settings changes for vertical marker lines
  const settingsChanges = useMemo(
    () => detectSettingsChanges(sortedAggregates),
    [sortedAggregates],
  );

  // Navigate to session detail on data point click
  const handleDataPointClick = useCallback(
    (date: string) => {
      const agg = sortedAggregates.find((a) => a.date === date);
      if (agg) {
        navigate(`/sessions/${agg.sessionId}`);
      }
    },
    [sortedAggregates, navigate],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className={styles.trendsLayout}>
        <div className={styles.loadingContainer} aria-busy="true">
          Loading trend data…
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={styles.trendsLayout}>
        <div className={styles.errorContainer} role="alert">
          <span>⚠</span>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (sortedAggregates.length === 0) {
    return (
      <div className={styles.trendsLayout}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <h1 className={styles.title}>Trends</h1>
          </div>
          <div className={styles.headerRight}>
            <DateRangeSelector />
          </div>
        </header>
        <div className={styles.emptyContainer}>
          <span className={styles.emptyIcon}>📈</span>
          <p>No therapy data available for the selected date range.</p>
          <p>Import CPAP data to see long-term trends.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.trendsLayout}>
      {/* Sticky header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Trends</h1>
        </div>
        <div className={styles.headerRight}>
          <DateRangeSelector />
          <button
            className={styles.sidebarToggle}
            onClick={toggleSidebar}
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? 'Hide summary statistics' : 'Show summary statistics'}
            type="button"
          >
            {sidebarOpen ? 'Hide Stats' : 'Stats'}
          </button>
        </div>
      </header>

      {/* Charts column */}
      <div className={styles.chartsColumn}>
        <SyncedChartProvider>
          <AHITrendChart
            data={sortedAggregates}
            height={CHART_HEIGHT}
            settingsChanges={settingsChanges}
            onDataPointClick={handleDataPointClick}
          />
          <UsageChart
            data={sortedAggregates}
            height={CHART_HEIGHT}
            settingsChanges={settingsChanges}
            onDataPointClick={handleDataPointClick}
          />
          <LeakRateChart
            data={sortedAggregates}
            height={CHART_HEIGHT}
            settingsChanges={settingsChanges}
            onDataPointClick={handleDataPointClick}
          />
          <PressureChart
            data={sortedAggregates}
            height={CHART_HEIGHT}
            settingsChanges={settingsChanges}
            onDataPointClick={handleDataPointClick}
          />
          <EventBreakdownChart
            data={sortedAggregates}
            height={CHART_HEIGHT}
            settingsChanges={settingsChanges}
            onDataPointClick={handleDataPointClick}
          />
          <SettingsChart data={sortedAggregates} height={SETTINGS_CHART_HEIGHT} />
          <SharedXAxis data={sortedAggregates} />
        </SyncedChartProvider>
      </div>

      {/* Summary sidebar */}
      <StatsSidebar aggregates={sortedAggregates} open={sidebarOpen} onClose={closeSidebar} />
    </div>
  );
}
