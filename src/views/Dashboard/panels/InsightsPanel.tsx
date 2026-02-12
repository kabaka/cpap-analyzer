/**
 * Insights panel — auto-generated therapy insights.
 *
 * @module views/Dashboard/panels/InsightsPanel
 */

import React from 'react';
import { Card } from '@/components/ui';
import type { Insight, InsightSeverity } from '../insights';
import styles from './InsightsPanel.module.css';

interface InsightsPanelProps {
  insights: Insight[];
  loading: boolean;
}

const ICON_MAP: Record<string, string> = {
  'trending-down': '📉',
  'trending-up': '📈',
  check: '✓',
  alert: '⚠',
  info: 'ℹ',
};

const SEVERITY_CLASS: Record<InsightSeverity, string> = {
  positive: styles.iconPositive ?? '',
  neutral: styles.iconNeutral ?? '',
  warning: styles.iconWarning ?? '',
};

const InsightsPanel = React.memo(function InsightsPanel({ insights, loading }: InsightsPanelProps) {
  if (loading) {
    return (
      <Card className={styles.card}>
        <h3 className={styles.title}>Insights</h3>
        <div className={styles.skeletonList}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={styles.skeletonRow} />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className={styles.card} aria-label="Therapy insights">
      <h3 className={styles.title}>Insights</h3>
      {insights.length === 0 ? (
        <p className={styles.empty}>No significant trends detected in this date range.</p>
      ) : (
        <ul className={styles.insightList}>
          {insights.map((insight) => (
            <li key={insight.id} className={styles.insightItem}>
              <span
                className={`${styles.icon} ${SEVERITY_CLASS[insight.severity]}`}
                aria-hidden="true"
              >
                {ICON_MAP[insight.icon] ?? 'ℹ'}
              </span>
              <span className={styles.message}>{insight.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
});

export default InsightsPanel;
