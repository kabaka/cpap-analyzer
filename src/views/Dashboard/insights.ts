/**
 * Pure function to generate auto-insights from therapy data.
 *
 * Analyzes nightly aggregate data and summary statistics to produce
 * 3–5 human-readable insight strings for the dashboard.
 *
 * @module views/Dashboard/insights
 */

import type { NightlyAggregate } from '@/types';
import type { SummaryStats } from '@/hooks/useSummaryStats';

export type InsightSeverity = 'positive' | 'neutral' | 'warning';
export type InsightIcon = 'trending-down' | 'trending-up' | 'check' | 'alert' | 'info';

export interface Insight {
  id: string;
  icon: InsightIcon;
  severity: InsightSeverity;
  message: string;
}

/**
 * Generate 3–5 insight strings from therapy data.
 *
 * Insights are returned sorted by severity (warning first, then neutral, then positive).
 * At most 5 insights are returned.
 */
export function generateInsights(aggregates: NightlyAggregate[], stats: SummaryStats): Insight[] {
  if (aggregates.length === 0) return [];

  const insights: Insight[] = [];
  const days = aggregates.length;

  // 1. AHI trend
  if (Math.abs(stats.trendAHIPercent) > 10) {
    if (stats.trendAHIPercent < 0) {
      insights.push({
        id: 'ahi-trending-down',
        icon: 'trending-down',
        severity: 'positive',
        message: `Your AHI has decreased ${Math.abs(stats.trendAHIPercent).toFixed(0)}% over the last ${days} days`,
      });
    } else {
      insights.push({
        id: 'ahi-trending-up',
        icon: 'trending-up',
        severity: 'warning',
        message: `Your AHI has increased ${stats.trendAHIPercent.toFixed(0)}% — consider reviewing recent changes`,
      });
    }
  }

  // 2. Compliance rate
  const compliancePct = stats.complianceRate * 100;
  if (compliancePct >= 70) {
    insights.push({
      id: 'compliance-good',
      icon: 'check',
      severity: 'positive',
      message: `Compliance rate is ${compliancePct.toFixed(0)}% (above CMS threshold)`,
    });
  } else {
    insights.push({
      id: 'compliance-low',
      icon: 'alert',
      severity: 'warning',
      message: `Compliance rate is ${compliancePct.toFixed(0)}% (below CMS 70% threshold)`,
    });
  }

  // 3. Usage assessment
  if (stats.meanUsageHours >= 6) {
    insights.push({
      id: 'usage-excellent',
      icon: 'check',
      severity: 'positive',
      message: `Average usage is ${stats.meanUsageHours.toFixed(1)} hours — excellent adherence`,
    });
  } else if (stats.meanUsageHours < 4) {
    insights.push({
      id: 'usage-low',
      icon: 'alert',
      severity: 'warning',
      message: `Average usage is ${stats.meanUsageHours.toFixed(1)} hours — below CMS minimum`,
    });
  }

  // 4. Leak assessment
  if (stats.leakP95 > 24) {
    insights.push({
      id: 'leak-high',
      icon: 'alert',
      severity: 'warning',
      message: `95th percentile leak is ${stats.leakP95.toFixed(1)} L/min — check mask fit`,
    });
  } else if (Math.abs(stats.trendLeakPercent) > 15 && stats.trendLeakPercent > 0) {
    insights.push({
      id: 'leak-trending-up',
      icon: 'trending-up',
      severity: 'warning',
      message: 'Leak rates are trending up — check mask fit and seal',
    });
  }

  // 5. Central apnea index
  const meanCentralIndex = aggregates.reduce((sum, a) => sum + a.ahiCentral, 0) / aggregates.length;
  if (meanCentralIndex > 5) {
    insights.push({
      id: 'central-apnea-high',
      icon: 'info',
      severity: 'neutral',
      message: `Central apnea index is ${meanCentralIndex.toFixed(1)} — discuss with your provider`,
    });
  }

  // 6. Settings change detection
  const settingsChanges = detectSettingsChanges(aggregates);
  if (settingsChanges) {
    insights.push({
      id: 'settings-changed',
      icon: 'info',
      severity: 'neutral',
      message: `Machine settings were changed on ${settingsChanges}`,
    });
  }

  // 7. All good fallback — if we have fewer than 2 insights and everything looks fine
  if (
    insights.length < 2 &&
    stats.meanAHI < 5 &&
    stats.complianceRate >= 0.7 &&
    stats.meanUsageHours >= 4
  ) {
    insights.push({
      id: 'all-good',
      icon: 'check',
      severity: 'positive',
      message: 'All metrics are within normal ranges — keep it up!',
    });
  }

  // Sort: warning first, then neutral, then positive
  const severityOrder: Record<InsightSeverity, number> = {
    warning: 0,
    neutral: 1,
    positive: 2,
  };
  insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return insights.slice(0, 5);
}

/**
 * Detect if machine settings changed within the period.
 * Returns the date string of first change, or null.
 */
function detectSettingsChanges(aggregates: NightlyAggregate[]): string | null {
  if (aggregates.length < 2) return null;

  const sorted = [...aggregates].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;

  for (let i = 0; i < sorted.length - 1; i++) {
    const agg = sorted[i];
    if (!agg) continue;
    if (
      agg.configuredMinPressure !== latest.configuredMinPressure ||
      agg.configuredMaxPressure !== latest.configuredMaxPressure ||
      agg.eprLevel !== latest.eprLevel
    ) {
      // The change first appears at the next aggregate
      return sorted[i + 1]?.date ?? agg.date;
    }
  }

  return null;
}
