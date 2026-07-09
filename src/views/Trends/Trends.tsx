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
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useNightlyAggregates } from '@/hooks/useNightlyAggregates';
import {
  InsightTrigger,
  buildDateRangeInput,
  buildGroundingCommon,
  machineClassOf,
  rangeScopeLabel,
} from '@/components/insights';
import { formatDate } from '@/utils/formatDate';
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
  const ahiThresholds = useSettingsStore((s) => s.analysisParams.ahi);
  const displayPrefs = useSettingsStore((s) => s.display);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Sort aggregates by date for chart rendering
  const sortedAggregates = useMemo(
    () => [...aggregates].sort((a, b) => a.date.localeCompare(b.date)),
    [aggregates],
  );

  // Build the "Summarize range" insight request from the loaded aggregates and
  // the active thresholds/display prefs. Machine class is coarse 'unknown' here
  // (the Trends view does not load the per-session therapy mode); the snapshot's
  // machineClass is optional metadata.
  const buildRangeRequest = useCallback(() => {
    const common = buildGroundingCommon(
      { ahi: ahiThresholds, display: displayPrefs },
      machineClassOf(null),
    );
    return {
      input: buildDateRangeInput(sortedAggregates, common),
      scopeLabel: rangeScopeLabel(formatDate(dateRange.start), formatDate(dateRange.end)),
    };
  }, [sortedAggregates, ahiThresholds, displayPrefs, dateRange]);

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
        <h1 className={styles.srOnly}>Trends</h1>
        <div className={styles.stateContainer} aria-busy="true">
          Loading trend data…
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={styles.trendsLayout}>
        <h1 className={styles.srOnly}>Trends</h1>
        <div className={styles.errorContainer} role="alert">
          <span aria-hidden="true">⚠</span>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (sortedAggregates.length === 0) {
    return (
      <div className={styles.trendsLayout}>
        <h1 className={styles.srOnly}>Trends</h1>
        <div className={styles.emptyContainer}>
          <span className={styles.emptyIcon} aria-hidden="true">
            📈
          </span>
          <p>No therapy data available for the selected date range.</p>
          <p>Import CPAP data to see long-term trends.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.trendsLayout}>
      {/* Toolbar. The shell's command strip already shows the "TRENDS" section
          title, the date-window toggle, and the coverage string, so the page
          <h1> is visually hidden (kept in the a11y tree for one programmatic
          heading) and the local date selector is dropped — the global window is
          the sole writer of dateRange. */}
      <header className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <h1 className={styles.srOnly}>Trends</h1>
          <span className={styles.coverageCaption}>
            {sortedAggregates.length} nights · synced crosshair
          </span>
        </div>
        <div className={styles.toolbarActions}>
          <InsightTrigger
            label="Summarize range"
            ariaLabel="Summarize the selected date range with AI"
            appearance="subtle"
            buildRequest={buildRangeRequest}
          />
          <button
            className={styles.statsToggle}
            onClick={toggleSidebar}
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? 'Hide summary statistics' : 'Show summary statistics'}
            type="button"
          >
            {sidebarOpen ? 'Hide stats' : 'Stats'}
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {/* Charts column — vertically stacked, 12px gaps, shared x-axis + synced
            crosshair/active-date via SyncedChartProvider. */}
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

        {/* Summary sidebar — sticky on desktop, slide-out drawer on mobile. */}
        <StatsSidebar aggregates={sortedAggregates} open={sidebarOpen} onClose={closeSidebar} />
      </div>
    </div>
  );
}
