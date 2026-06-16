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
import { findFirstSettingsChangeDate } from '@/views/Trends/utils/detectSettingsChanges';
import {
  detectRisingCentralTrend,
  MIN_CENTRAL_USAGE_HOURS,
} from '@/views/Trends/utils/centralTrend';
import { LEAK_NOTICE_LPM } from '@/analysis/uncertainty/constants';

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
  if (stats.leakP95 > LEAK_NOTICE_LPM) {
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
  //
  // The central apnea index is an events-per-hour RATE, so the clinically sound
  // cross-night aggregate is total central events / total hours — equivalently a
  // mean of each night's index WEIGHTED BY that night's usage hours. A plain
  // unweighted mean lets a single very short night (e.g. ~12 min of mask-on time)
  // with a spuriously high nightly index dominate the average and trip a
  // provider-referral message even when every well-used night is benign.
  //
  // We additionally require ≥ 1 hour of usage for a night to count toward this
  // insight (shared MIN_CENTRAL_USAGE_HOURS). Nights below an hour carry too few
  // breaths for a stable per-hour rate, and the >5/h threshold here drives a
  // clinical referral, so excluding them avoids misleading the user. (Distinct
  // from the CMS 4h compliance floor, which is about adherence accounting, not
  // rate stability.)
  let centralEventHours = 0;
  let centralUsageHours = 0;
  for (const a of aggregates) {
    if (a.usageHours >= MIN_CENTRAL_USAGE_HOURS) {
      centralEventHours += a.ahiCentral * a.usageHours;
      centralUsageHours += a.usageHours;
    }
  }
  // No qualifying nights → no stable rate → no insight (avoids divide-by-zero).
  if (centralUsageHours > 0) {
    const weightedCentralIndex = centralEventHours / centralUsageHours;
    if (weightedCentralIndex > 5) {
      insights.push({
        id: 'central-apnea-high',
        icon: 'info',
        severity: 'neutral',
        message: `Central apnea index is ${weightedCentralIndex.toFixed(1)} — discuss with your provider`,
      });
    }
  }

  // 5b. Rising central (Clear-Airway) trend — SAFETY-CRITICAL (consensus D6).
  //
  // The central/obstructive split is a LOW-reliability modeled inference, so its
  // precision is qualified elsewhere. But a low-reliability label must NEVER
  // silence a *rising* central trend: under-reaction to treatment-emergent
  // central apnea is the dangerous failure mode. This insight is emitted on a
  // rising trend regardless of whether the absolute index has crossed 5/h, with
  // a 'warning' severity so it sorts to the top and is never dropped by the
  // 5-insight cap below. Copy is informational and non-diagnostic — it prompts a
  // conversation; it names no condition and no therapy.
  const centralTrend = detectRisingCentralTrend(aggregates);
  if (centralTrend.rising) {
    insights.push({
      id: 'central-apnea-rising',
      icon: 'alert',
      severity: 'warning',
      message:
        'Your central (clear-airway) events appear to be rising — worth discussing with your clinician. The split is an estimate, so review your data together rather than acting on it alone.',
    });
  }

  // 6. Settings change detection
  const settingsChangeDate = findFirstSettingsChangeDate(aggregates);
  if (settingsChangeDate) {
    insights.push({
      id: 'settings-changed',
      icon: 'info',
      severity: 'neutral',
      message: `Machine settings were changed on ${settingsChangeDate}`,
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

  // Defense-in-depth (consensus D6): the safety-critical rising-central insight
  // must never be dropped by the display cap, even if many warnings precede it.
  // The EventBreakdownChart prompt remains the guaranteed surface; this keeps
  // the dashboard surface consistent with it.
  const safetyInsightIds = new Set(['central-apnea-rising']);
  const safety = insights.filter((i) => safetyInsightIds.has(i.id));
  const rest = insights.filter((i) => !safetyInsightIds.has(i.id));
  return [...safety, ...rest].slice(0, 5);
}
