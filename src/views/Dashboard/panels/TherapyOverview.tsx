/**
 * Therapy Overview panel — AHI trend line chart and usage hours bar chart.
 *
 * @module views/Dashboard/panels/TherapyOverview
 */

import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@/components/ui';
import { useChartColors } from '@/components/charts/useChartColors';
import {
  AHI_SEVERITY_THRESHOLDS,
  CMS_COMPLIANCE_HOURS,
  RECOMMENDED_USAGE_HOURS,
} from '@/analysis/clinical';
import { AHI_AXIS_FLOOR, USAGE_AXIS_FLOOR, computeAxisMax } from '@/views/Trends/charts/chartScale';
import type { TrendDataPoint } from '@/hooks/useSummaryStats';
import styles from './TherapyOverview.module.css';

interface TherapyOverviewProps {
  trendData: TrendDataPoint[];
  loading: boolean;
}

/** Format ISO date to short "Mon DD" format. */
function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function readCSSVar(prop: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
}

const TherapyOverview = React.memo(function TherapyOverview({
  trendData,
  loading,
}: TherapyOverviewProps) {
  const colors = useChartColors();

  const chartData = useMemo(
    () =>
      trendData.map((d) => ({
        ...d,
        label: formatShortDate(d.date),
      })),
    [trendData],
  );

  const maxAHI = useMemo(() => {
    // d.ahi is null on nights too short for a per-hour rate; skip those so the
    // axis is scaled from real values rather than a coerced 0.
    const ahiValues = trendData.map((d) => d.ahi).filter((v): v is number => v != null);
    const max = Math.max(...ahiValues, 0);
    return computeAxisMax(max, AHI_AXIS_FLOOR);
  }, [trendData]);

  const ahiSummary = useMemo(() => {
    const ahiValues = trendData.map((d) => d.ahi).filter((v): v is number => v != null);
    if (ahiValues.length === 0) {
      return 'No nights with a defined AHI in this period (recordings too short for a per-hour rate).';
    }
    return `AHI ranged from ${Math.min(...ahiValues).toFixed(1)} to ${Math.max(
      ...ahiValues,
    ).toFixed(1)} over the period.`;
  }, [trendData]);

  const maxUsage = useMemo(() => {
    const max = Math.max(...trendData.map((d) => d.usageHours), 0);
    return computeAxisMax(max, USAGE_AXIS_FLOOR);
  }, [trendData]);

  // Resolve status colors for severity zones
  const statusNormalBg = readCSSVar('--color-status-normal-bg') || 'rgba(22, 163, 74, 0.1)';
  const statusMildBg = readCSSVar('--color-status-mild-bg') || 'rgba(202, 138, 4, 0.1)';
  const statusModerateBg = readCSSVar('--color-status-moderate-bg') || 'rgba(234, 88, 12, 0.1)';
  const statusSevereBg = readCSSVar('--color-status-severe-bg') || 'rgba(220, 38, 38, 0.1)';
  const statusNormal = readCSSVar('--color-status-normal') || '#16a34a';
  const statusSevere = readCSSVar('--color-status-severe') || '#dc2626';
  const colorWarning = readCSSVar('--color-warning') || '#ca8a04';

  if (loading) {
    return (
      <section className={styles.container} aria-label="Therapy overview charts">
        <div className={styles.chartRow}>
          <Card className={styles.chartCard}>
            <h3 className={styles.chartTitle}>AHI Trend</h3>
            <div className={styles.chartSkeleton} />
          </Card>
          <Card className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Usage Hours</h3>
            <div className={styles.chartSkeleton} />
          </Card>
        </div>
      </section>
    );
  }

  if (chartData.length === 0) return null;

  return (
    <section className={styles.container} aria-label="Therapy overview charts">
      <div className={styles.chartRow}>
        {/* AHI Trend Chart */}
        <Card className={styles.chartCard}>
          <h3 className={styles.chartTitle}>AHI Trend</h3>
          <div aria-label="AHI trend over the last 30 days">
            <span className={styles.srOnly}>{ahiSummary}</span>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 40, bottom: 24, left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                {/* Severity zone bands */}
                <ReferenceArea
                  y1={0}
                  y2={AHI_SEVERITY_THRESHOLDS.mild}
                  fill={statusNormalBg}
                  fillOpacity={1}
                  label={{
                    value: 'Normal',
                    position: 'insideRight',
                    fill: colors.textSecondary,
                    fontSize: 10,
                  }}
                />
                <ReferenceArea
                  y1={AHI_SEVERITY_THRESHOLDS.mild}
                  y2={AHI_SEVERITY_THRESHOLDS.moderate}
                  fill={statusMildBg}
                  fillOpacity={1}
                  label={{
                    value: 'Mild',
                    position: 'insideRight',
                    fill: colors.textSecondary,
                    fontSize: 10,
                  }}
                />
                <ReferenceArea
                  y1={AHI_SEVERITY_THRESHOLDS.moderate}
                  y2={AHI_SEVERITY_THRESHOLDS.severe}
                  fill={statusModerateBg}
                  fillOpacity={1}
                  label={{
                    value: 'Moderate',
                    position: 'insideRight',
                    fill: colors.textSecondary,
                    fontSize: 10,
                  }}
                />
                <ReferenceArea
                  y1={AHI_SEVERITY_THRESHOLDS.severe}
                  y2={maxAHI}
                  fill={statusSevereBg}
                  fillOpacity={1}
                  label={{
                    value: 'Severe',
                    position: 'insideRight',
                    fill: colors.textSecondary,
                    fontSize: 10,
                  }}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: colors.axis, fontSize: 11 }}
                  stroke={colors.axis}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: colors.axis, fontSize: 11 }}
                  stroke={colors.axis}
                  domain={[0, maxAHI]}
                  label={{
                    value: 'events/hr',
                    angle: -90,
                    position: 'insideLeft',
                    offset: 4,
                    fill: colors.axis,
                    fontSize: 11,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: colors.tooltipBg,
                    border: `1px solid ${colors.tooltipBorder}`,
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [value.toFixed(1), 'AHI']}
                />
                <Line
                  type="monotone"
                  dataKey="ahi"
                  name="AHI"
                  stroke={colors.chart1}
                  strokeWidth={2}
                  dot={{ r: 3, fill: colors.chart1 }}
                  activeDot={{ r: 5, fill: colors.chart1 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Usage Hours Bar Chart */}
        <Card className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Usage Hours</h3>
          <div aria-label="Nightly usage hours for the last 30 days">
            <span className={styles.srOnly}>
              Usage ranged from {Math.min(...trendData.map((d) => d.usageHours)).toFixed(1)} to{' '}
              {Math.max(...trendData.map((d) => d.usageHours)).toFixed(1)} hours. 4-hour CMS
              compliance line and 6-hour target line are shown.
            </span>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 24, left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: colors.axis, fontSize: 11 }}
                  stroke={colors.axis}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: colors.axis, fontSize: 11 }}
                  stroke={colors.axis}
                  domain={[0, maxUsage]}
                  label={{
                    value: 'hours',
                    angle: -90,
                    position: 'insideLeft',
                    offset: 4,
                    fill: colors.axis,
                    fontSize: 11,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: colors.tooltipBg,
                    border: `1px solid ${colors.tooltipBorder}`,
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [`${value.toFixed(1)} hrs`, 'Usage']}
                />
                <ReferenceLine
                  y={CMS_COMPLIANCE_HOURS}
                  stroke={colorWarning}
                  strokeDasharray="5 3"
                  strokeWidth={1}
                  label={{
                    value: `${CMS_COMPLIANCE_HOURS}h (CMS)`,
                    position: 'insideTopRight',
                    fill: colorWarning,
                    fontSize: 10,
                  }}
                />
                <ReferenceLine
                  y={RECOMMENDED_USAGE_HOURS}
                  stroke={statusNormal}
                  strokeDasharray="5 3"
                  strokeWidth={1}
                  label={{
                    value: `${RECOMMENDED_USAGE_HOURS}h target`,
                    position: 'insideTopRight',
                    fill: statusNormal,
                    fontSize: 10,
                  }}
                />
                <Bar
                  dataKey="usageHours"
                  name="Usage"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                >
                  {chartData.map((entry, index) => {
                    let fill = colors.chart1;
                    if (entry.usageHours >= RECOMMENDED_USAGE_HOURS) fill = statusNormal;
                    else if (entry.usageHours < CMS_COMPLIANCE_HOURS) fill = statusSevere;
                    return <Cell key={`cell-${index}`} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </section>
  );
});

export default TherapyOverview;
