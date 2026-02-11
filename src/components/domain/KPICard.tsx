/**
 * KPI summary card component.
 *
 * Displays a single key performance indicator with label, value, unit,
 * optional trend direction, and optional clinical severity badge.
 *
 * @module components/domain/KPICard
 */

import { Card, Badge } from '@/components/ui';
import styles from './KPICard.module.css';

type TrendDirection = 'up' | 'down' | 'stable';
type Severity = 'normal' | 'mild' | 'moderate' | 'severe';

interface KPICardProps {
  /** Display title (e.g., "AHI", "Leak Rate"). */
  title: string;
  /** Formatted numeric value. */
  value: string;
  /** Unit label (e.g., "events/hr", "L/min"). */
  unit: string;
  /** Trend direction arrow. */
  trend?: TrendDirection;
  /** Clinical severity (maps to status colors). */
  severity?: Severity;
  /** Whether the card is in a loading state. */
  loading?: boolean;
}

const TREND_ICONS: Record<TrendDirection, string> = {
  up: '↑',
  down: '↓',
  stable: '→',
};

const SEVERITY_BADGE_VARIANT: Record<Severity, 'success' | 'warning' | 'danger' | 'info'> = {
  normal: 'success',
  mild: 'warning',
  moderate: 'danger',
  severe: 'danger',
};

export function KPICard({ title, value, unit, trend, severity, loading }: KPICardProps) {
  return (
    <Card className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        {severity && (
          <Badge variant={SEVERITY_BADGE_VARIANT[severity]} size="sm">
            {severity}
          </Badge>
        )}
      </div>
      <div className={styles.body}>
        {loading ? (
          <span className={styles.skeleton} aria-label="Loading" />
        ) : (
          <>
            <span className={styles.value}>{value}</span>
            <span className={styles.unit}>{unit}</span>
          </>
        )}
      </div>
      {trend && !loading && (
        <div className={styles.trend} aria-label={`Trend: ${trend}`}>
          <span
            className={`${styles.trendIcon} ${styles[`trend${capitalize(trend)}`]}`}
            aria-hidden="true"
          >
            {TREND_ICONS[trend]}
          </span>
        </div>
      )}
    </Card>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
