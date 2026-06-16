/**
 * StatsSidebar — summary statistics panel for the visible date range.
 *
 * Renders descriptive stats (mean, median, stddev, min, max, trend)
 * for AHI, usage, leak, and pressure, plus compliance and event breakdown.
 *
 * @module views/Trends/sidebar/StatsSidebar
 */

import React, { useMemo } from 'react';
import type { NightlyAggregate } from '@/types';
import { CMS_COMPLIANCE_HOURS } from '@/analysis/clinical';
import { computeMetricStats } from '../utils/computeSidebarStats';
import MetricStatsSection from './MetricStatsSection';
import styles from './StatsSidebar.module.css';

interface StatsSidebarProps {
  aggregates: NightlyAggregate[];
  open: boolean;
  onClose: () => void;
}

const StatsSidebar = React.memo(function StatsSidebar({
  aggregates,
  open,
  onClose,
}: StatsSidebarProps) {
  const ahiStats = useMemo(
    () =>
      computeMetricStats(
        'AHI',
        '',
        aggregates.map((a) => a.ahi),
      ),
    [aggregates],
  );

  const usageStats = useMemo(
    () =>
      computeMetricStats(
        'Usage Hours',
        'hrs',
        aggregates.map((a) => a.usageHours),
      ),
    [aggregates],
  );

  const leakStats = useMemo(
    () =>
      computeMetricStats(
        'Leak Rate (median)',
        'L/min',
        aggregates.map((a) => a.leakMedian),
      ),
    [aggregates],
  );

  const pressureStats = useMemo(
    () =>
      computeMetricStats(
        'Pressure (mean)',
        'cmH₂O',
        aggregates.map((a) => a.pressureMean),
      ),
    [aggregates],
  );

  const compliance = useMemo(() => {
    if (aggregates.length === 0) return null;
    const compliant = aggregates.filter((a) => a.usageHours >= CMS_COMPLIANCE_HOURS).length;
    return {
      rate: Math.round((compliant / aggregates.length) * 100),
      nights: compliant,
      total: aggregates.length,
    };
  }, [aggregates]);

  const eventAvgs = useMemo(() => {
    if (aggregates.length === 0) return null;
    const n = aggregates.length;
    const sum = {
      total: 0,
      obstructive: 0,
      central: 0,
      hypopnea: 0,
      mixed: 0,
      rera: 0,
    };
    for (const a of aggregates) {
      sum.total += a.eventCount;
      sum.obstructive += a.eventsByType.obstructive;
      sum.central += a.eventsByType.central;
      sum.hypopnea += a.eventsByType.hypopnea;
      sum.mixed += a.eventsByType.mixed;
      sum.rera += a.eventsByType.rera;
    }
    return {
      total: sum.total / n,
      obstructive: sum.obstructive / n,
      central: sum.central / n,
      hypopnea: sum.hypopnea / n,
      mixed: sum.mixed / n,
      rera: sum.rera / n,
    };
  }, [aggregates]);

  const dateRange = useMemo(() => {
    if (aggregates.length === 0) return '';
    const sorted = [...aggregates].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last) return '';
    return `${first.date} – ${last.date}`;
  }, [aggregates]);

  return (
    <aside
      className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`}
      role="complementary"
      aria-label="Summary statistics for visible date range"
    >
      <div className={styles.sidebarInner}>
        <div className={styles.sidebarHeader}>
          <h2 className={styles.sidebarTitle}>Summary Statistics</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close summary sidebar"
            type="button"
          >
            ✕
          </button>
        </div>

        {dateRange && <p className={styles.dateRange}>{dateRange}</p>}

        {aggregates.length === 0 ? (
          <p className={styles.empty}>No data in selected range.</p>
        ) : (
          <>
            {ahiStats && <MetricStatsSection stats={ahiStats} />}
            {usageStats && <MetricStatsSection stats={usageStats} />}
            {leakStats && <MetricStatsSection stats={leakStats} />}
            {pressureStats && <MetricStatsSection stats={pressureStats} />}

            {compliance && (
              <div className={styles.complianceSection}>
                <h4 className={styles.sectionHeader}>Compliance</h4>
                <dl className={styles.complianceList}>
                  <div className={styles.complianceRow}>
                    <dt className={styles.complianceLabel}>Rate</dt>
                    <dd className={styles.complianceValue}>{compliance.rate}%</dd>
                  </div>
                  <div className={styles.complianceRow}>
                    <dt className={styles.complianceLabel}>Nights</dt>
                    <dd className={styles.complianceValue}>
                      {compliance.nights}/{compliance.total}
                    </dd>
                  </div>
                  <div className={styles.complianceRow}>
                    <dt className={styles.complianceLabel}>CMS</dt>
                    <dd className={styles.complianceValue}>
                      {compliance.rate >= 70 ? '✓ Meets' : '✗ Below'}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            {eventAvgs && (
              <div className={styles.eventsSection}>
                <h4 className={styles.sectionHeader}>Events (per night avg)</h4>
                <dl className={styles.complianceList}>
                  {(
                    [
                      ['Total', eventAvgs.total],
                      ['Obstr.', eventAvgs.obstructive],
                      ['Central', eventAvgs.central],
                      ['Hypop.', eventAvgs.hypopnea],
                      ['Mixed', eventAvgs.mixed],
                      ['RERA', eventAvgs.rera],
                    ] as const
                  ).map(([label, val]) => (
                    <div key={label} className={styles.complianceRow}>
                      <dt className={styles.complianceLabel}>{label}</dt>
                      <dd className={styles.complianceValue}>{val.toFixed(1)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
});

export default StatsSidebar;
