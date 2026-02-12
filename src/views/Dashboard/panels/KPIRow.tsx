/**
 * KPI Row panel — five EnhancedKPICards for the dashboard.
 *
 * @module views/Dashboard/panels/KPIRow
 */

import React from 'react';
import { EnhancedKPICard } from '@/components/domain/EnhancedKPICard';
import type { SummaryStats } from '@/hooks/useSummaryStats';
import { useChartColors } from '@/components/charts/useChartColors';
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
        value={stats ? stats.meanAHI.toFixed(1) : '—'}
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
      />
      <EnhancedKPICard
        title="Leak Rate"
        value={stats ? stats.meanLeak.toFixed(1) : '—'}
        unit="L/min"
        trend={trendDirection(stats?.trendLeakPercent ?? 0)}
        trendPercent={stats?.trendLeakPercent ?? 0}
        trendFavorable={(stats?.trendLeakPercent ?? 0) <= 0}
        sparklineData={leakSparkline}
        sparklineColor={colors.chart5}
        loading={loading}
        tooltip="Median mask leak rate — lower values indicate better seal"
      />
      <EnhancedKPICard
        title="Compliance"
        value={stats ? `${(stats.complianceRate * 100).toFixed(0)}` : '—'}
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
        value={stats ? stats.meanUsageHours.toFixed(1) : '—'}
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
        value={stats ? stats.meanPressureP95.toFixed(1) : '—'}
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
