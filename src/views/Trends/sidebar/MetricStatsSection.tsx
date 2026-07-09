/**
 * MetricStatsSection — command-surface stat card for one metric.
 *
 * A compact nested card: metric label + directional trend chip in the header, a
 * headline mean, then median / min–max / std-dev detail rows. All descriptive
 * stats are retained; only the presentation is restyled (KEEP-TECH — the
 * `computeMetricStats` values are unchanged).
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
  const unitSuffix = stats.unit ? ` (${stats.unit})` : '';
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardLabel}>
          {stats.label}
          {unitSuffix}
        </span>
        <span className={`${styles.trend} ${styles[stats.trendDirection] ?? ''}`}>
          {trendIcon(stats.trendDirection)} {trendLabel(stats)}
        </span>
      </div>
      <div className={styles.meanRow}>
        <span className={styles.meanValue}>{stats.mean.toFixed(1)}</span>
        <span className={styles.meanUnit}>mean</span>
      </div>
      <dl className={styles.detailList}>
        <div className={styles.detailRow}>
          <dt className={styles.detailLabel}>Median</dt>
          <dd className={styles.detailValue}>{stats.median.toFixed(1)}</dd>
        </div>
        <div className={styles.detailRow}>
          <dt className={styles.detailLabel}>Min / Max</dt>
          <dd className={styles.detailValue}>
            {stats.min.toFixed(1)} / {stats.max.toFixed(1)}
          </dd>
        </div>
        <div className={styles.detailRow}>
          <dt className={styles.detailLabel}>Std Dev</dt>
          <dd className={styles.detailValue}>{stats.stdDev.toFixed(1)}</dd>
        </div>
      </dl>
    </div>
  );
});

export default MetricStatsSection;
