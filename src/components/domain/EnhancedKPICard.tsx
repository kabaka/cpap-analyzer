/**
 * Enhanced KPI card with sparkline and trend percentage.
 *
 * Extends the basic KPICard with a mini Recharts sparkline and
 * percentage-based trend indicator for the control-room dashboard.
 *
 * @module components/domain/EnhancedKPICard
 */

import React, { useMemo } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Card, Badge } from '@/components/ui';
import { useChartColors } from '@/components/charts/useChartColors';
import { ReliabilityChip } from '@/components/domain/ReliabilityChip';
import type { DataQualityFlag, ReliabilityTier } from '@/analysis/uncertainty';
import styles from './EnhancedKPICard.module.css';

type TrendDirection = 'up' | 'down' | 'stable';
type Severity = 'normal' | 'mild' | 'moderate' | 'severe';

export interface EnhancedKPICardProps {
  /** Display title (e.g., "AHI", "Leak Rate"). */
  title: string;
  /** Formatted numeric value. */
  value: string;
  /** Unit label (e.g., "events/hr", "L/min"). */
  unit: string;
  /** Trend direction arrow. */
  trend: TrendDirection;
  /** Trend change percentage. */
  trendPercent: number;
  /** Whether this trend direction is favorable (green) or unfavorable (orange). */
  trendFavorable: boolean;
  /** Clinical severity (maps to status colors). */
  severity?: Severity;
  /** 30 data points for the sparkline. */
  sparklineData: number[];
  /** Whether the card is in a loading state. */
  loading?: boolean;
  /** Contextual tooltip on title hover. */
  tooltip?: string;
  /** Sparkline color override (CSS color string). */
  sparklineColor?: string;
  /**
   * Optional measurement-reliability annotation for soft metrics (consensus
   * D2/D6). A `high` tier with no active flags renders nothing; otherwise a
   * quiet chip is shown in a footer row so it never collides with the
   * top-right clinical-severity badge.
   */
  reliability?: {
    readonly tier: ReliabilityTier;
    readonly flags?: readonly DataQualityFlag[];
    readonly reason?: string;
  };
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

const SEVERITY_LABELS: Record<Severity, string> = {
  normal: 'Normal',
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
};

const RELIABILITY_TIER_PHRASE: Record<ReliabilityTier, string> = {
  high: 'high reliability',
  moderate: 'estimate',
  low: 'modeled value',
};

const DATA_QUALITY_FLAG_PHRASE: Record<DataQualityFlag, string> = {
  'high-leak': 'leak-affected',
  'short-session': 'short session',
  'low-coverage': 'low coverage',
  'low-count': 'few events',
};

/**
 * Build a terse reliability phrase for the card's `<article aria-label>` so SR
 * users hear the reliability state without reaching the chip (ux §5).
 */
function reliabilityAriaSuffix(reliability: {
  readonly tier: ReliabilityTier;
  readonly flags?: readonly DataQualityFlag[];
}): string {
  const parts: string[] = [];
  if (reliability.tier !== 'high') {
    parts.push(RELIABILITY_TIER_PHRASE[reliability.tier]);
  }
  for (const flag of reliability.flags ?? []) {
    parts.push(DATA_QUALITY_FLAG_PHRASE[flag]);
  }
  return parts.join(', ');
}

export const EnhancedKPICard = React.memo(function EnhancedKPICard({
  title,
  value,
  unit,
  trend,
  trendPercent,
  trendFavorable,
  severity,
  sparklineData,
  loading,
  tooltip,
  sparklineColor,
  reliability,
}: EnhancedKPICardProps) {
  const colors = useChartColors();
  const lineColor = sparklineColor ?? colors.chart1;

  const chartData = useMemo(() => sparklineData.map((v, i) => ({ i, v })), [sparklineData]);

  const trendLabel = `Trend: ${trend} ${Math.abs(trendPercent).toFixed(0)} percent`;

  const sparklineLabel = useMemo(() => {
    if (sparklineData.length < 2) return `${title} sparkline`;
    const first = sparklineData[0]?.toFixed(1) ?? '?';
    const last = sparklineData[sparklineData.length - 1]?.toFixed(1) ?? '?';
    const dir = trendPercent < 0 ? 'decreasing' : trendPercent > 0 ? 'increasing' : 'stable';
    return `30-day ${title} trend, ${dir} from ${first} to ${last}`;
  }, [sparklineData, title, trendPercent]);

  // High tier with no active flags shows no chip; only render the footer row
  // when there is something decision-relevant to display.
  const showReliability =
    !loading &&
    reliability !== undefined &&
    (reliability.tier !== 'high' || (reliability.flags?.length ?? 0) > 0);

  const articleLabel = showReliability
    ? `${title}: ${value} ${unit}, ${reliabilityAriaSuffix(reliability)}`
    : `${title}: ${value} ${unit}`;

  return (
    <Card className={styles.card}>
      <article aria-label={articleLabel}>
        <div className={styles.header}>
          <span className={styles.title} title={tooltip}>
            {title}
          </span>
          {severity && (
            <Badge variant={SEVERITY_BADGE_VARIANT[severity]} size="sm">
              {SEVERITY_LABELS[severity]}
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
              <span
                className={`${styles.trendBadge} ${trendFavorable ? styles.trendFavorable : styles.trendUnfavorable}`}
                aria-label={trendLabel}
              >
                <span aria-hidden="true">{TREND_ICONS[trend]}</span>
                {Math.abs(trendPercent).toFixed(0)}%
              </span>
            </>
          )}
        </div>

        {!loading && sparklineData.length > 1 && (
          <div className={styles.sparkline} role="img" aria-label={sparklineLabel}>
            <ResponsiveContainer width="100%" height={32}>
              <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke={lineColor}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {loading && <div className={styles.sparklineSkeleton} aria-label="Loading sparkline" />}

        {showReliability && reliability && (
          <div className={styles.reliabilityFooter}>
            <ReliabilityChip
              tier={reliability.tier}
              flags={reliability.flags}
              reason={reliability.reason}
            />
          </div>
        )}
      </article>
    </Card>
  );
});
