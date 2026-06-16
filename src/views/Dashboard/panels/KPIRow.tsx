/**
 * KPI Row panel — five EnhancedKPICards for the dashboard.
 *
 * @module views/Dashboard/panels/KPIRow
 */

import React from 'react';
import { EnhancedKPICard } from '@/components/domain/EnhancedKPICard';
import type { SummaryStats } from '@/hooks/useSummaryStats';
import { useChartColors } from '@/components/charts/useChartColors';
import {
  formatMetric,
  reliabilityTier,
  dataQualityFlagLabel,
  LEAK_NOTICE_LPM,
  type DataQualityFlag,
  type ReliabilityTier,
} from '@/analysis/uncertainty';
import styles from './KPIRow.module.css';

/** Map AHI value to clinical severity. */
function ahiSeverity(ahi: number): 'normal' | 'mild' | 'moderate' | 'severe' {
  if (ahi < 5) return 'normal';
  if (ahi < 15) return 'mild';
  if (ahi < 30) return 'moderate';
  return 'severe';
}

function trendDirection(percent: number): 'up' | 'down' | 'stable' {
  if (percent > 2) return 'up';
  if (percent < -2) return 'down';
  return 'stable';
}

/** Reliability prop shape accepted by the KPI cards. */
interface CardReliability {
  readonly tier: ReliabilityTier;
  readonly flags?: readonly DataQualityFlag[];
  readonly reason?: string;
}

/**
 * Reliability for the AHI card. AHI is a SOFT metric (consensus D5: detected,
 * undercounts vs PSG, mask-on denominator). It is count-gated (D8) and
 * short-session flagged; the aggregate is intentionally NOT leak-gated.
 */
function ahiReliability(stats: SummaryStats): CardReliability {
  const { tier, flags } = reliabilityTier('ahi', {
    eventCount: stats.totalEventCount,
    maskOnHours: stats.meanMaskOnHours,
  });
  return {
    tier,
    flags,
    reason:
      'Aggregate AHI is algorithmically detected (mask-on denominator) and undercounts versus an in-lab study; read it as a trend.',
  };
}

/**
 * Reliability for the Leak card. Unintentional leak BELOW threshold is a
 * `high`-reliability measured value (consensus D5) — no chip. When the window
 * median leak reaches the device notice level (LEAK_NOTICE_LPM, consensus D7),
 * a neutral data-quality caveat surfaces; flow-derived metrics are the ones
 * actually degraded, so the tier itself stays high.
 */
function leakReliability(stats: SummaryStats): CardReliability | undefined {
  if (stats.meanLeak < LEAK_NOTICE_LPM) return undefined;
  const flag: DataQualityFlag = 'high-leak';
  return {
    tier: 'high',
    flags: [flag],
    reason: `${dataQualityFlagLabel(flag)}: median leak is at or above the device notice level (${LEAK_NOTICE_LPM} L/min), which degrades flow-derived metrics on affected nights.`,
  };
}

interface KPIRowProps {
  stats: SummaryStats | null;
  loading: boolean;
}

const KPIRow = React.memo(function KPIRow({ stats, loading }: KPIRowProps) {
  const colors = useChartColors();

  const ahiSparkline = stats?.trendData.map((d) => d.ahi) ?? [];
  const leakSparkline = stats?.trendData.map((d) => d.leakMedian) ?? [];
  const complianceSparkline =
    stats?.trendData.map((d) => (d.complianceStatus === 'compliant' ? 1 : 0)) ?? [];
  const usageSparkline = stats?.trendData.map((d) => d.usageHours) ?? [];
  const pressureP95Sparkline = stats?.trendData.map((d) => d.pressureP95) ?? [];

  return (
    <section className={styles.kpiRow} aria-label="Key performance indicators">
      <EnhancedKPICard
        title="AHI"
        value={stats ? formatMetric('ahi', stats.meanAHI) : '—'}
        unit="events/hr"
        trend={trendDirection(stats?.trendAHIPercent ?? 0)}
        trendPercent={stats?.trendAHIPercent ?? 0}
        trendFavorable={(stats?.trendAHIPercent ?? 0) <= 0}
        severity={stats ? ahiSeverity(stats.meanAHI) : undefined}
        sparklineData={ahiSparkline}
        sparklineColor={
          stats
            ? ahiSeverity(stats.meanAHI) === 'normal'
              ? colors.chart3
              : colors.chart2
            : undefined
        }
        loading={loading}
        tooltip="Apnea-Hypopnea Index — respiratory events per hour of sleep"
        reliability={stats ? ahiReliability(stats) : undefined}
      />
      <EnhancedKPICard
        title="Leak Rate"
        value={stats ? formatMetric('leakMedian', stats.meanLeak) : '—'}
        unit="L/min"
        trend={trendDirection(stats?.trendLeakPercent ?? 0)}
        trendPercent={stats?.trendLeakPercent ?? 0}
        trendFavorable={(stats?.trendLeakPercent ?? 0) <= 0}
        sparklineData={leakSparkline}
        sparklineColor={colors.chart5}
        loading={loading}
        tooltip="Median mask leak rate — lower values indicate better seal"
        reliability={stats ? leakReliability(stats) : undefined}
      />
      <EnhancedKPICard
        title="Compliance"
        value={stats ? formatMetric('compliance', stats.complianceRate * 100) : '—'}
        unit="%"
        trend={trendDirection(stats?.trendCompliancePercent ?? 0)}
        trendPercent={stats?.trendCompliancePercent ?? 0}
        trendFavorable={(stats?.trendCompliancePercent ?? 0) >= 0}
        sparklineData={complianceSparkline}
        sparklineColor={colors.chart3}
        loading={loading}
        tooltip="Percentage of nights with ≥4 hours of usage (CMS compliance)"
      />
      <EnhancedKPICard
        title="Usage"
        value={stats ? formatMetric('usage', stats.meanUsageHours) : '—'}
        unit="hrs/night"
        trend={trendDirection(stats?.trendUsagePercent ?? 0)}
        trendPercent={stats?.trendUsagePercent ?? 0}
        trendFavorable={(stats?.trendUsagePercent ?? 0) >= 0}
        sparklineData={usageSparkline}
        sparklineColor={colors.chart1}
        loading={loading}
        tooltip="Average nightly CPAP usage time"
      />
      <EnhancedKPICard
        title="Pressure P95"
        value={stats ? formatMetric('pressure', stats.meanPressureP95) : '—'}
        unit="cmH₂O"
        trend={trendDirection(stats?.trendPressureP95Percent ?? 0)}
        trendPercent={stats?.trendPressureP95Percent ?? 0}
        trendFavorable={true}
        sparklineData={pressureP95Sparkline}
        sparklineColor={colors.chart4}
        loading={loading}
        tooltip="95th percentile therapy pressure — informational metric"
      />
    </section>
  );
});

export default KPIRow;
