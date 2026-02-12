/**
 * MetricStatsSection — renders descriptive stats for one metric.
 *
 * @module views/Trends/sidebar/MetricStatsSection
 */

import React from 'react';
import type { MetricStats } from '../utils/computeSidebarStats';
import styles from './MetricStatsSection.module.css';

interface MetricStatsSectionProps {
  stats: MetricStats;
}

function trendIcon(dir: 'up' | 'down' | 'stable'): string {
  switch (dir) {
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    case 'stable':
      return '→';
  }
}

function trendLabel(stats: MetricStats): string {
  if (stats.trendDirection === 'stable') return 'stable';
  return `${Math.abs(stats.trendPercent)}%`;
}

const MetricStatsSection = React.memo(function MetricStatsSection({
  stats,
}: MetricStatsSectionProps) {
  return (
    <div className={styles.section}>
      <h4 className={styles.header}>{stats.label}</h4>
      <dl className={styles.statsList}>
        <div className={styles.statRow}>
          <dt className={styles.label}>Mean</dt>
          <dd className={styles.value}>
            {stats.mean.toFixed(1)} {stats.unit}
          </dd>
        </div>
        <div className={styles.statRow}>
          <dt className={styles.label}>Median</dt>
          <dd className={styles.value}>
            {stats.median.toFixed(1)} {stats.unit}
          </dd>
        </div>
        <div className={styles.statRow}>
          <dt className={styles.label}>Std Dev</dt>
          <dd className={styles.value}>
            {stats.stdDev.toFixed(1)} {stats.unit}
          </dd>
        </div>
        <div className={styles.statRow}>
          <dt className={styles.label}>Min</dt>
          <dd className={styles.value}>
            {stats.min.toFixed(1)} {stats.unit}
          </dd>
        </div>
        <div className={styles.statRow}>
          <dt className={styles.label}>Max</dt>
          <dd className={styles.value}>
            {stats.max.toFixed(1)} {stats.unit}
          </dd>
        </div>
        <div className={styles.statRow}>
          <dt className={styles.label}>Trend</dt>
          <dd className={`${styles.value} ${styles[stats.trendDirection] ?? ''}`}>
            {trendIcon(stats.trendDirection)} {trendLabel(stats)}
          </dd>
        </div>
      </dl>
    </div>
  );
});

export default MetricStatsSection;
