/**
 * Report generation service.
 *
 * Provides PDF, CSV, and encrypted archive generation from CPAP
 * session data. All processing happens client-side.
 *
 * @module services/reports/ReportService
 */

import { jsPDF } from 'jspdf';
import { getDB } from '@/services/storage/getDB';
import { formatMetric } from '@/analysis/uncertainty';
import {
  AHI_SEVERITY_THRESHOLDS,
  CMS_COMPLIANCE_HOURS,
  RECOMMENDED_USAGE_HOURS,
} from '@/analysis/clinical';
import type { NightlyAggregate } from '@/types';
import type {
  EncryptionParams,
  ReportContentSelection,
  ReportResult,
  ReportStatistics,
  SessionCSVRow,
} from './types';
import {
  PDF_COLORS,
  LAYOUT,
  addPageHeader,
  addPageFooter,
  addSectionHeading,
  addSubsectionHeading,
  ensureSpace,
  drawKPIRow,
  addMetricLine,
  addChart,
  drawTable,
  computeDescriptiveStats,
  pearsonR,
  interpretCorrelation,
  formatEventTypeName,
  getAHISeverityColor,
  getAHISeverityLabel,
  setFillColor,
  setTextColor,
} from './pdf/layout';
import type { PageContext, KPICardData } from './pdf/layout';
import {
  drawLineChart,
  drawBarChart,
  drawHorizontalBarChart,
  drawStackedAreaChart,
} from './pdf/charts';
import type {
  LineChartConfig,
  BarChartConfig,
  HorizontalBarChartConfig,
  StackedAreaChartConfig,
} from './pdf/charts';

// ── Helpers ──────────────────────────────────────────────────────

/** Format a Date to YYYY-MM-DD. */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Compute median of a numeric array. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Escape a CSV field value. */
function escapeCSV(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Trigger a file download from a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Clean up after a tick to ensure the download starts
  setTimeout(() => {
    try {
      document.body.removeChild(a);
    } catch {
      // Element may already be removed if document was torn down (e.g., in tests)
    }
    URL.revokeObjectURL(url);
  }, 100);
}

// ── Data fetching ────────────────────────────────────────────────

/** Fetch nightly aggregates for the given date range. */
async function fetchAggregates(startDate: string, endDate: string): Promise<NightlyAggregate[]> {
  const db = await getDB();
  return db.getNightlyAggregatesByDateRange(startDate, endDate);
}

/** Compute report statistics from aggregates. */
function computeStatistics(
  aggregates: NightlyAggregate[],
  dateRange: { start: string; end: string },
): ReportStatistics {
  const ahiValues = aggregates.map((a) => a.ahi);
  const leakValues = aggregates.map((a) => a.leakMedian);
  const pressureValues = aggregates.map((a) => a.pressureMean);
  const usageValues = aggregates.map((a) => a.usageHours);
  const leakP95Values = aggregates.map((a) => a.leakP95);
  const pressureP95Values = aggregates.map((a) => a.pressureP95);
  const pressureMaxValues = aggregates.map((a) => a.pressureMax);
  const leakMaxValues = aggregates.map((a) => a.leakMax);
  const leakDurationValues = aggregates.map((a) => a.leakDurationMinutes);
  const spo2Values = aggregates.map((a) => a.spo2Mean).filter((v): v is number => v !== null);

  const compliantCount = aggregates.filter((a) => a.complianceStatus === 'compliant').length;
  const total = aggregates.length;

  const meanAHI = total > 0 ? ahiValues.reduce((s, v) => s + v, 0) / total : 0;
  const meanLeak = total > 0 ? leakValues.reduce((s, v) => s + v, 0) / total : 0;
  const meanPressure = total > 0 ? pressureValues.reduce((s, v) => s + v, 0) / total : 0;
  const meanUsageHours = total > 0 ? usageValues.reduce((s, v) => s + v, 0) / total : 0;
  const complianceRate = total > 0 ? compliantCount / total : 0;

  // Event totals
  const eventTotals = {
    obstructive: 0,
    central: 0,
    mixed: 0,
    unclassified: 0,
    hypopnea: 0,
    rera: 0,
    flowLimitation: 0,
    largeLeak: 0,
    periodicBreathing: 0,
  };
  for (const a of aggregates) {
    eventTotals.obstructive += a.eventsByType.obstructive;
    eventTotals.central += a.eventsByType.central;
    eventTotals.mixed += a.eventsByType.mixed;
    eventTotals.unclassified += a.eventsByType.unclassified ?? 0;
    eventTotals.hypopnea += a.eventsByType.hypopnea;
    eventTotals.rera += a.eventsByType.rera;
    eventTotals.flowLimitation += a.eventsByType.flowLimitation;
    eventTotals.largeLeak += a.eventsByType.largeLeak;
    eventTotals.periodicBreathing += a.eventsByType.periodicBreathing;
  }

  // Usage tiers
  const nightsAbove4Hours = aggregates.filter((a) => a.usageHours >= CMS_COMPLIANCE_HOURS).length;
  const nightsAbove6Hours = aggregates.filter(
    (a) => a.usageHours >= RECOMMENDED_USAGE_HOURS,
  ).length;
  const nightsAbove8Hours = aggregates.filter((a) => a.usageHours >= 8).length;

  return {
    totalSessions: total,
    dateRange,
    meanAHI,
    medianAHI: median(ahiValues),
    minAHI: total > 0 ? Math.min(...ahiValues) : 0,
    maxAHI: total > 0 ? Math.max(...ahiValues) : 0,
    meanLeak,
    meanPressure,
    meanUsageHours,
    totalUsageHours: usageValues.reduce((s, v) => s + v, 0),
    complianceRate,
    compliantNights: compliantCount,
    nonCompliantNights: total - compliantCount,

    // Extended fields
    medianUsageHours: median(usageValues),
    meanLeakP95: total > 0 ? leakP95Values.reduce((s, v) => s + v, 0) / total : 0,
    meanPressureP95: total > 0 ? pressureP95Values.reduce((s, v) => s + v, 0) / total : 0,
    meanPressureMax: total > 0 ? pressureMaxValues.reduce((s, v) => s + v, 0) / total : 0,
    meanLeakMax: total > 0 ? leakMaxValues.reduce((s, v) => s + v, 0) / total : 0,
    meanLeakDurationMinutes: total > 0 ? leakDurationValues.reduce((s, v) => s + v, 0) / total : 0,

    descriptive: {
      ahi: computeDescriptiveStats(ahiValues),
      usageHours: computeDescriptiveStats(usageValues),
      leakMedian: computeDescriptiveStats(leakValues),
      leakP95: computeDescriptiveStats(leakP95Values),
      pressureMean: computeDescriptiveStats(pressureValues),
      pressureP95: computeDescriptiveStats(pressureP95Values),
      spo2Mean: spo2Values.length > 0 ? computeDescriptiveStats(spo2Values) : null,
    },

    eventTotals,

    correlations: {
      ahiVsUsage: pearsonR(ahiValues, usageValues),
      ahiVsLeak: pearsonR(ahiValues, leakValues),
      leakVsPressure: pearsonR(leakValues, pressureValues),
    },

    nightsAbove4Hours,
    nightsAbove6Hours,
    nightsAbove8Hours,

    cmsCompliant: complianceRate >= 0.7,
  };
}

/** Convert aggregates to CSV rows. */
function toCSVRows(aggregates: NightlyAggregate[]): SessionCSVRow[] {
  return aggregates.map((a) => ({
    date: a.date,
    ahi: a.ahi,
    ahiObstructive: a.ahiObstructive,
    ahiCentral: a.ahiCentral,
    ahiHypopnea: a.ahiHypopnea,
    eventCount: a.eventCount,
    leakMedian: a.leakMedian,
    leakP95: a.leakP95,
    pressureMean: a.pressureMean,
    pressureP95: a.pressureP95,
    usageHours: a.usageHours,
    complianceStatus: a.complianceStatus,
  }));
}

// ── PDF generation ───────────────────────────────────────────────

/** Compute an effective date range string clamped to actual data. */
function computeDateRangeString(
  aggregates: NightlyAggregate[],
  dateRange: { start: string; end: string },
): string {
  if (aggregates.length === 0) return `${dateRange.start} to ${dateRange.end}`;
  const sorted = aggregates.slice().sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0] as NightlyAggregate;
  const last = sorted[sorted.length - 1] as NightlyAggregate;
  return `${first.date} to ${last.date}`;
}

/** Get template display title. */
function getTemplateTitle(template: ReportContentSelection['template']): string {
  switch (template) {
    case 'physician-summary':
      return 'CPAP Therapy — Physician Summary';
    case 'full-analysis':
      return 'CPAP Therapy — Full Analysis Report';
    case 'custom':
      return 'CPAP Therapy — Custom Report';
  }
}

/** Sum event counts across all aggregates. */
function sumEventsByType(aggregates: NightlyAggregate[]): Record<string, number> {
  const totals: Record<string, number> = {
    obstructive: 0,
    central: 0,
    mixed: 0,
    unclassified: 0,
    hypopnea: 0,
    rera: 0,
    flowLimitation: 0,
    largeLeak: 0,
    periodicBreathing: 0,
  };
  for (const a of aggregates) {
    totals['obstructive'] = (totals['obstructive'] ?? 0) + a.eventsByType.obstructive;
    totals['central'] = (totals['central'] ?? 0) + a.eventsByType.central;
    totals['mixed'] = (totals['mixed'] ?? 0) + a.eventsByType.mixed;
    totals['unclassified'] = (totals['unclassified'] ?? 0) + (a.eventsByType.unclassified ?? 0);
    totals['hypopnea'] = (totals['hypopnea'] ?? 0) + a.eventsByType.hypopnea;
    totals['rera'] = (totals['rera'] ?? 0) + a.eventsByType.rera;
    totals['flowLimitation'] = (totals['flowLimitation'] ?? 0) + a.eventsByType.flowLimitation;
    totals['largeLeak'] = (totals['largeLeak'] ?? 0) + a.eventsByType.largeLeak;
    totals['periodicBreathing'] =
      (totals['periodicBreathing'] ?? 0) + a.eventsByType.periodicBreathing;
  }
  return totals;
}

// ── Section renderers ────────────────────────────────────────────

function renderSummarySection(
  doc: jsPDF,
  y: number,
  aggregates: NightlyAggregate[],
  stats: ReportStatistics,
  context: PageContext,
): number {
  void context; // reserved for future ensureSpace use
  const cards: KPICardData[] = [
    {
      label: 'Mean AHI',
      value: stats.meanAHI.toFixed(1),
      unit: 'events/hr',
      subtitle: getAHISeverityLabel(stats.meanAHI),
      subtitleColor: getAHISeverityColor(stats.meanAHI),
    },
    {
      label: 'Usage',
      value: stats.meanUsageHours.toFixed(1),
      unit: 'hrs/night',
      subtitle: `med: ${stats.medianUsageHours.toFixed(1)}`,
    },
    {
      label: 'Compliance',
      value: `${(stats.complianceRate * 100).toFixed(0)}%`,
      subtitle: `${stats.compliantNights}/${stats.totalSessions} nights`,
    },
    {
      label: 'Mean Leak',
      value: stats.meanLeak.toFixed(1),
      unit: 'L/min',
      subtitle: `P95: ${stats.meanLeakP95.toFixed(1)}`,
    },
  ];

  return drawKPIRow(
    doc,
    y,
    aggregates.length > 0 ? cards : cards.map((c) => ({ ...c, value: 'N/A', subtitle: '' })),
  );
}

function renderAHITrendSection(
  doc: jsPDF,
  y: number,
  aggregates: NightlyAggregate[],
  _stats: ReportStatistics,
  context: PageContext,
): number {
  y = ensureSpace(doc, y, LAYOUT.CHART_FULL_HEIGHT + 15, context);
  y = addSubsectionHeading(doc, y, 'AHI Trend');

  if (aggregates.length === 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    setTextColor(doc, PDF_COLORS.TEXT_MUTED);
    doc.text('No data available for the selected date range.', LAYOUT.MARGIN_LEFT, y + 10);
    return y + 20;
  }

  const ahiMax = Math.max(Math.ceil(Math.max(...aggregates.map((a) => a.ahi)) * 1.1), 10);
  const config: LineChartConfig = {
    widthMm: LAYOUT.CONTENT_WIDTH,
    heightMm: LAYOUT.CHART_FULL_HEIGHT,
    title: 'AHI Trend',
    xLabels: aggregates.map((a) => a.date),
    yAxis: { min: 0, max: ahiMax, tickCount: 5, label: 'AHI', unit: 'events/hr' },
    series: [
      {
        data: aggregates.map((a) => a.ahi),
        color: PDF_COLORS.CHART_BLUE,
        fillColor: PDF_COLORS.CHART_BLUE_FILL,
        label: 'AHI',
      },
    ],
    severityZones: [
      { yMin: 0, yMax: 5, color: PDF_COLORS.SEVERITY_NORMAL_FILL, label: 'Normal' },
      { yMin: 5, yMax: 15, color: PDF_COLORS.SEVERITY_MILD_FILL, label: 'Mild' },
      { yMin: 15, yMax: 30, color: PDF_COLORS.SEVERITY_MODERATE_FILL, label: 'Moderate' },
      { yMin: 30, yMax: Infinity, color: PDF_COLORS.SEVERITY_SEVERE_FILL, label: 'Severe' },
    ],
  };

  const dataUrl = drawLineChart(config);
  y = addChart(doc, dataUrl, LAYOUT.MARGIN_LEFT, y, LAYOUT.CONTENT_WIDTH, LAYOUT.CHART_FULL_HEIGHT);

  // Alt text
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  setTextColor(doc, PDF_COLORS.TEXT_LIGHT);
  doc.text(
    `AHI ranged from ${_stats.minAHI.toFixed(1)} to ${_stats.maxAHI.toFixed(1)} events/hr (mean ${_stats.meanAHI.toFixed(1)}) over ${aggregates.length} days.`,
    LAYOUT.MARGIN_LEFT,
    y,
  );
  return y + LAYOUT.ELEMENT_GAP;
}

function renderUsageBarSection(
  doc: jsPDF,
  y: number,
  aggregates: NightlyAggregate[],
  _stats: ReportStatistics,
  context: PageContext,
): number {
  y = ensureSpace(doc, y, LAYOUT.CHART_FULL_HEIGHT + 15, context);
  y = addSubsectionHeading(doc, y, 'Nightly Usage');

  if (aggregates.length === 0) return y + 5;

  const usageMax = Math.max(Math.ceil(Math.max(...aggregates.map((a) => a.usageHours)) * 1.1), 10);
  const config: BarChartConfig = {
    widthMm: LAYOUT.CONTENT_WIDTH,
    heightMm: LAYOUT.CHART_FULL_HEIGHT,
    title: 'Nightly Usage',
    xLabels: aggregates.map((a) => a.date),
    yAxis: { min: 0, max: usageMax, tickCount: 5, label: 'Usage', unit: 'hours' },
    data: aggregates.map((a) => a.usageHours),
    barColor: (value: number) =>
      value >= CMS_COMPLIANCE_HOURS ? PDF_COLORS.SEVERITY_NORMAL : PDF_COLORS.SEVERITY_MILD,
    referenceLines: [
      {
        value: CMS_COMPLIANCE_HOURS,
        color: PDF_COLORS.COMPLIANCE_LINE,
        label: '4hr CMS Threshold',
        dashed: true,
      },
    ],
  };

  const dataUrl = drawBarChart(config);
  return addChart(
    doc,
    dataUrl,
    LAYOUT.MARGIN_LEFT,
    y,
    LAYOUT.CONTENT_WIDTH,
    LAYOUT.CHART_FULL_HEIGHT,
  );
}

function renderPressureSection(
  doc: jsPDF,
  y: number,
  aggregates: NightlyAggregate[],
  stats: ReportStatistics,
  context: PageContext,
): number {
  y = ensureSpace(doc, y, LAYOUT.CHART_FULL_HEIGHT + 40, context);
  y = addSectionHeading(doc, y, 'Pressure Therapy');

  if (aggregates.length === 0) return y + 5;

  const pMin = Math.max(0, Math.floor(Math.min(...aggregates.map((a) => a.pressureMean)) - 1));
  const pMax = Math.ceil(Math.max(...aggregates.map((a) => a.pressureP95)) + 1);
  const config: LineChartConfig = {
    widthMm: LAYOUT.CONTENT_WIDTH,
    heightMm: 55,
    title: 'Therapy Pressure',
    xLabels: aggregates.map((a) => a.date),
    yAxis: { min: pMin, max: pMax, tickCount: 5, label: 'Pressure', unit: 'cmH2O' },
    series: [
      {
        data: aggregates.map((a) => a.pressureP95),
        color: PDF_COLORS.CHART_PURPLE,
        fillColor: PDF_COLORS.CHART_PURPLE_FILL,
        label: 'P95',
        lineWidth: 1,
      },
      {
        data: aggregates.map((a) => a.pressureMean),
        color: PDF_COLORS.CHART_BLUE,
        label: 'Mean',
        lineWidth: 1.5,
      },
    ],
  };

  const dataUrl = drawLineChart(config);
  y = addChart(doc, dataUrl, LAYOUT.MARGIN_LEFT, y, LAYOUT.CONTENT_WIDTH, 55);

  // Pressure KPI row
  const pressureCards: KPICardData[] = [
    { label: 'Mean Pressure', value: stats.meanPressure.toFixed(1), unit: 'cmH2O' },
    { label: 'P95 Pressure', value: stats.meanPressureP95.toFixed(1), unit: 'cmH2O' },
    { label: 'Max Pressure', value: stats.meanPressureMax.toFixed(1), unit: 'cmH2O' },
  ];
  return drawKPIRow(doc, y, pressureCards);
}

function renderLeakSection(
  doc: jsPDF,
  y: number,
  aggregates: NightlyAggregate[],
  _stats: ReportStatistics,
  context: PageContext,
): number {
  y = ensureSpace(doc, y, 70, context);
  y = addSectionHeading(doc, y, 'Leak Analysis');

  if (aggregates.length === 0) return y + 5;

  const leakMax = Math.max(Math.ceil(Math.max(...aggregates.map((a) => a.leakP95)) * 1.1), 20);
  const config: LineChartConfig = {
    widthMm: LAYOUT.CONTENT_WIDTH,
    heightMm: 55,
    title: 'Leak Rate',
    xLabels: aggregates.map((a) => a.date),
    yAxis: { min: 0, max: leakMax, tickCount: 5, label: 'Leak', unit: 'L/min' },
    series: [
      {
        data: aggregates.map((a) => a.leakP95),
        color: PDF_COLORS.CHART_CYAN,
        fillColor: PDF_COLORS.CHART_CYAN_FILL,
        label: 'P95',
        lineWidth: 1,
      },
      {
        data: aggregates.map((a) => a.leakMedian),
        color: PDF_COLORS.CHART_BLUE,
        label: 'Median',
        lineWidth: 1.5,
      },
    ],
    referenceLines: [
      {
        value: 24,
        color: PDF_COLORS.SEVERITY_MODERATE,
        label: 'High Leak (24 L/min)',
        dashed: true,
      },
    ],
  };

  const dataUrl = drawLineChart(config);
  return addChart(doc, dataUrl, LAYOUT.MARGIN_LEFT, y, LAYOUT.CONTENT_WIDTH, 55);
}

function renderEventBreakdownSection(
  doc: jsPDF,
  y: number,
  aggregates: NightlyAggregate[],
  _stats: ReportStatistics,
  context: PageContext,
): number {
  y = ensureSpace(doc, y, 60, context);
  y = addSectionHeading(doc, y, 'Event Breakdown');

  if (aggregates.length === 0) return y + 5;

  const eventTotals = sumEventsByType(aggregates);
  const sortedEvents = Object.entries(eventTotals)
    .sort(([, a], [, b]) => b - a)
    .filter(([, v]) => v > 0);

  if (sortedEvents.length === 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    setTextColor(doc, PDF_COLORS.TEXT_MUTED);
    doc.text('No events recorded.', LAYOUT.MARGIN_LEFT, y);
    return y + LAYOUT.LINE_HEIGHT;
  }

  const chartHeight = Math.max(30, sortedEvents.length * 8 + 10);
  const config: HorizontalBarChartConfig = {
    widthMm: LAYOUT.CONTENT_WIDTH,
    heightMm: chartHeight,
    title: 'Event Breakdown',
    categories: sortedEvents.map(([k]) => formatEventTypeName(k)),
    values: sortedEvents.map(([, v]) => v),
    barColor: [
      PDF_COLORS.CHART_BLUE,
      PDF_COLORS.CHART_PURPLE,
      PDF_COLORS.CHART_CYAN,
      PDF_COLORS.CHART_EMERALD,
      PDF_COLORS.SEVERITY_MODERATE,
      PDF_COLORS.SEVERITY_MILD,
    ],
    showValues: true,
  };

  const dataUrl = drawHorizontalBarChart(config);
  return addChart(doc, dataUrl, LAYOUT.MARGIN_LEFT, y, LAYOUT.CONTENT_WIDTH, chartHeight);
}

function renderComplianceSection(
  doc: jsPDF,
  y: number,
  _aggregates: NightlyAggregate[],
  stats: ReportStatistics,
  context: PageContext,
): number {
  y = ensureSpace(doc, y, 35, context);
  y = addSectionHeading(doc, y, 'Compliance');

  const cards: KPICardData[] = [
    {
      label: 'Compliance Rate',
      value: `${(stats.complianceRate * 100).toFixed(0)}%`,
      subtitle: 'of nights ≥4 hrs',
    },
    {
      label: 'Compliant Nights',
      value: String(stats.compliantNights),
      subtitle: 'nights',
    },
    {
      label: 'Non-Compliant',
      value: String(stats.nonCompliantNights),
      subtitle: 'nights',
    },
    {
      label: 'CMS Status',
      value: stats.cmsCompliant ? 'MET ✓' : 'NOT MET',
      subtitle: '70% req.',
      subtitleColor: stats.cmsCompliant ? PDF_COLORS.SEVERITY_NORMAL : PDF_COLORS.SEVERITY_SEVERE,
    },
  ];

  y = drawKPIRow(doc, y, cards);

  // CMS explanation
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  setTextColor(doc, PDF_COLORS.TEXT_LIGHT);
  doc.text(
    'CMS defines compliance as ≥ 4 hours of usage on ≥ 70% of nights in a consecutive 30-day period.',
    LAYOUT.MARGIN_LEFT,
    y,
  );
  return y + LAYOUT.ELEMENT_GAP + 2;
}

function renderUsagePatternsSection(
  doc: jsPDF,
  y: number,
  aggregates: NightlyAggregate[],
  stats: ReportStatistics,
  context: PageContext,
): number {
  y = ensureSpace(doc, y, 40, context);
  y = addSectionHeading(doc, y, 'Usage Patterns');

  if (aggregates.length === 0) return y + 5;

  const total = stats.totalSessions;
  y = addMetricLine(
    doc,
    y,
    'Nights ≥ 4 hours:',
    `${stats.nightsAbove4Hours} (${total > 0 ? ((stats.nightsAbove4Hours / total) * 100).toFixed(1) : 0}%)`,
  );
  y = addMetricLine(
    doc,
    y,
    'Nights ≥ 6 hours:',
    `${stats.nightsAbove6Hours} (${total > 0 ? ((stats.nightsAbove6Hours / total) * 100).toFixed(1) : 0}%)`,
  );
  y = addMetricLine(
    doc,
    y,
    'Nights ≥ 8 hours:',
    `${stats.nightsAbove8Hours} (${total > 0 ? ((stats.nightsAbove8Hours / total) * 100).toFixed(1) : 0}%)`,
  );
  y = addMetricLine(doc, y, 'Mean Usage:', `${stats.meanUsageHours.toFixed(1)} hrs/night`);
  y += LAYOUT.ELEMENT_GAP;

  // Correlations (only if enough data)
  if (aggregates.length >= 3) {
    y = ensureSpace(doc, y, 25, context);
    y = addSubsectionHeading(doc, y, 'Correlation Highlights');
    y = addMetricLine(
      doc,
      y,
      'AHI ↔ Usage:',
      `r = ${stats.correlations.ahiVsUsage >= 0 ? '+' : ''}${stats.correlations.ahiVsUsage.toFixed(2)} (${interpretCorrelation(stats.correlations.ahiVsUsage)})`,
    );
    y = addMetricLine(
      doc,
      y,
      'AHI ↔ Leak:',
      `r = ${stats.correlations.ahiVsLeak >= 0 ? '+' : ''}${stats.correlations.ahiVsLeak.toFixed(2)} (${interpretCorrelation(stats.correlations.ahiVsLeak)})`,
    );
    y = addMetricLine(
      doc,
      y,
      'Leak ↔ Pressure:',
      `r = ${stats.correlations.leakVsPressure >= 0 ? '+' : ''}${stats.correlations.leakVsPressure.toFixed(2)} (${interpretCorrelation(stats.correlations.leakVsPressure)})`,
    );
  }

  return y;
}

function renderEventDistributionSection(
  doc: jsPDF,
  y: number,
  aggregates: NightlyAggregate[],
  _stats: ReportStatistics,
  context: PageContext,
): number {
  y = ensureSpace(doc, y, 80, context);
  y = addSectionHeading(doc, y, 'Event Distribution Over Time');

  if (aggregates.length === 0) return y + 5;

  // Compute max stacked value
  const stackMax = Math.max(
    ...aggregates.map(
      (a) =>
        a.eventsByType.obstructive +
        a.eventsByType.hypopnea +
        a.eventsByType.central +
        a.eventsByType.mixed +
        a.eventsByType.rera,
    ),
    1,
  );

  const config: StackedAreaChartConfig = {
    widthMm: LAYOUT.CONTENT_WIDTH,
    heightMm: 65,
    title: 'Event Distribution Over Time',
    xLabels: aggregates.map((a) => a.date),
    yAxis: {
      min: 0,
      max: Math.ceil(stackMax * 1.1),
      tickCount: 5,
      label: 'Events',
      unit: 'count',
    },
    layers: [
      {
        data: aggregates.map((a) => a.eventsByType.obstructive),
        color: PDF_COLORS.CHART_BLUE,
        fillColor: PDF_COLORS.CHART_BLUE_FILL,
        label: 'Obstructive',
      },
      {
        data: aggregates.map((a) => a.eventsByType.hypopnea),
        color: PDF_COLORS.CHART_PURPLE,
        fillColor: PDF_COLORS.CHART_PURPLE_FILL,
        label: 'Hypopnea',
      },
      {
        data: aggregates.map((a) => a.eventsByType.central),
        color: PDF_COLORS.CHART_CYAN,
        fillColor: PDF_COLORS.CHART_CYAN_FILL,
        label: 'Central',
      },
      {
        data: aggregates.map((a) => a.eventsByType.mixed),
        color: PDF_COLORS.CHART_EMERALD,
        fillColor: PDF_COLORS.CHART_EMERALD_FILL,
        label: 'Mixed',
      },
      {
        data: aggregates.map((a) => a.eventsByType.rera),
        color: PDF_COLORS.SEVERITY_MODERATE,
        fillColor: PDF_COLORS.SEVERITY_MODERATE_FILL,
        label: 'RERA',
      },
    ],
  };

  const dataUrl = drawStackedAreaChart(config);
  return addChart(doc, dataUrl, LAYOUT.MARGIN_LEFT, y, LAYOUT.CONTENT_WIDTH, 65);
}

function renderMachineSettingsSection(
  doc: jsPDF,
  y: number,
  aggregates: NightlyAggregate[],
  _stats: ReportStatistics,
  context: PageContext,
): number {
  // Only render if we have machine settings data
  const firstWithSettings = aggregates.find(
    (a) =>
      a.configuredMinPressure !== null || a.configuredMaxPressure !== null || a.eprLevel !== null,
  );
  if (!firstWithSettings) return y;

  y = ensureSpace(doc, y, 50, context);
  y = addSectionHeading(doc, y, 'Machine Settings');

  // Bordered card
  const cardX = LAYOUT.MARGIN_LEFT + 30;
  const cardW = 110;
  const startCardY = y;

  if (
    firstWithSettings.configuredMinPressure !== null &&
    firstWithSettings.configuredMaxPressure !== null
  ) {
    y = addMetricLine(
      doc,
      y,
      'Pressure Range:',
      `${firstWithSettings.configuredMinPressure.toFixed(1)} – ${firstWithSettings.configuredMaxPressure.toFixed(1)} cmH2O`,
    );
  }
  if (firstWithSettings.eprLevel !== null) {
    y = addMetricLine(doc, y, 'EPR Level:', String(firstWithSettings.eprLevel));
  }

  // Draw card border
  setFillColor(doc, PDF_COLORS.WHITE);
  const cardH = y - startCardY + 4;
  doc.setLineWidth(0.3);
  doc.setDrawColor(209, 213, 219); // #d1d5db
  doc.roundedRect(cardX, startCardY - 4, cardW, cardH, 2, 2, 'S');

  return y + LAYOUT.ELEMENT_GAP;
}

function renderStatisticsSection(
  doc: jsPDF,
  y: number,
  _aggregates: NightlyAggregate[],
  stats: ReportStatistics,
  context: PageContext,
): number {
  y = ensureSpace(doc, y, 60, context);
  y = addSectionHeading(doc, y, 'Statistical Summary');

  interface MetricRow {
    name: string;
    desc: DescriptiveStats;
  }

  // Import type inline
  type DescriptiveStats = typeof stats.descriptive.ahi;

  const metrics: MetricRow[] = [
    { name: 'AHI (events/hr)', desc: stats.descriptive.ahi },
    { name: 'Usage (hrs)', desc: stats.descriptive.usageHours },
    { name: 'Leak Median (L/min)', desc: stats.descriptive.leakMedian },
    { name: 'Leak P95 (L/min)', desc: stats.descriptive.leakP95 },
    { name: 'Pressure Mean (cmH2O)', desc: stats.descriptive.pressureMean },
    { name: 'Pressure P95 (cmH2O)', desc: stats.descriptive.pressureP95 },
  ];

  if (stats.descriptive.spo2Mean) {
    metrics.push({ name: 'SpO2 (%)', desc: stats.descriptive.spo2Mean });
  }

  const headers = ['Metric', 'Min', 'Q1', 'Median', 'Mean', 'Q3', 'Max', 'StdDev'];
  const rows = metrics.map((m) => [
    m.name,
    m.desc.min.toFixed(1),
    m.desc.q1.toFixed(1),
    m.desc.median.toFixed(1),
    m.desc.mean.toFixed(1),
    m.desc.q3.toFixed(1),
    m.desc.max.toFixed(1),
    m.desc.stdDev.toFixed(2),
  ]);

  return drawTable(
    doc,
    y,
    {
      headers,
      rows,
      colWidths: [38, 16, 16, 18, 18, 16, 16, 18],
      colAligns: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
      zebraStripe: true,
    },
    context,
  );
}

function renderSessionTableSection(
  doc: jsPDF,
  y: number,
  aggregates: NightlyAggregate[],
  _stats: ReportStatistics,
  context: PageContext,
): number {
  y = ensureSpace(doc, y, 30, context);
  y = addSectionHeading(doc, y, 'Nightly Session Data');

  if (aggregates.length === 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    setTextColor(doc, PDF_COLORS.TEXT_MUTED);
    doc.text('No sessions found.', LAYOUT.MARGIN_LEFT, y);
    return y + LAYOUT.LINE_HEIGHT;
  }

  const headers = [
    'Date',
    'AHI',
    'OA',
    'CA',
    'Hyp',
    'Leak',
    'P95 Lk',
    'Press',
    'P95 Pr',
    'Usage',
    'Comp',
  ];
  const rows = aggregates.map((a) => [
    a.date,
    a.ahi.toFixed(1),
    a.ahiObstructive.toFixed(1),
    a.ahiCentral.toFixed(1),
    a.ahiHypopnea.toFixed(1),
    a.leakMedian.toFixed(1),
    a.leakP95.toFixed(1),
    a.pressureMean.toFixed(1),
    a.pressureP95.toFixed(1),
    a.usageHours.toFixed(1),
    a.complianceStatus === 'compliant' ? '✓' : a.complianceStatus === 'partial' ? '~' : '✗',
  ]);

  return drawTable(
    doc,
    y,
    {
      headers,
      rows,
      colWidths: [22, 14, 12, 12, 12, 14, 14, 14, 14, 14, 14],
      colAligns: [
        'left',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
        'center',
      ],
      zebraStripe: true,
      highlightFn: (row: string[]) => {
        // Non-compliant: faint red
        if (row[10] === '✗') return PDF_COLORS.KPI_RED_BG;
        // High AHI (≥ moderate threshold, 15): faint yellow
        const ahi = parseFloat(row[1] ?? '0');
        if (ahi >= AHI_SEVERITY_THRESHOLDS.moderate) return PDF_COLORS.KPI_YELLOW_BG;
        return null;
      },
    },
    context,
  );
}

// ── Main PDF build pipeline ──────────────────────────────────────

/** Generate the enhanced PDF report with embedded charts. */
async function buildPDF(
  selection: ReportContentSelection,
  aggregates: NightlyAggregate[],
  stats: ReportStatistics,
): Promise<Blob> {
  const doc = new jsPDF('portrait', 'mm', 'a4');

  const dateRangeStr = computeDateRangeString(aggregates, selection.dateRange);
  const title = selection.title ?? getTemplateTitle(selection.template);

  const context: PageContext = {
    pageNum: 1,
    totalPages: 0,
    title,
    dateRange: dateRangeStr,
  };

  // Set document properties
  doc.setProperties({ title });

  // Page 1 header
  let y = addPageHeader(doc, context);
  y += LAYOUT.SECTION_GAP;

  const sections = selection.sections;

  // ── Page 1: Overview ──

  // Summary KPI cards
  if (sections.summaryStatistics) {
    y = renderSummarySection(doc, y, aggregates, stats, context);
    y += LAYOUT.SUBSECTION_GAP;
  }

  // AHI Trend Chart
  if (sections.ahiTrend) {
    y = renderAHITrendSection(doc, y, aggregates, stats, context);
    y += LAYOUT.SUBSECTION_GAP;
  }

  // Usage Bar Chart (linked to compliance)
  if (sections.complianceReport || sections.usagePatterns) {
    y = renderUsageBarSection(doc, y, aggregates, stats, context);
    y += LAYOUT.SECTION_GAP;
  }

  // ── Page 2: Detailed Analysis ──

  // Pressure Metrics
  if (sections.pressureMetrics) {
    y = renderPressureSection(doc, y, aggregates, stats, context);
    y += LAYOUT.SECTION_GAP;
  }

  // Leak Analysis
  if (sections.leakAnalysis) {
    y = renderLeakSection(doc, y, aggregates, stats, context);
    y += LAYOUT.SECTION_GAP;
  }

  // Event Breakdown
  if (sections.eventBreakdown) {
    y = renderEventBreakdownSection(doc, y, aggregates, stats, context);
    y += LAYOUT.SECTION_GAP;
  }

  // Compliance section
  if (sections.complianceReport) {
    y = renderComplianceSection(doc, y, aggregates, stats, context);
    y += LAYOUT.SECTION_GAP;
  }

  // Usage Patterns
  if (sections.usagePatterns) {
    y = renderUsagePatternsSection(doc, y, aggregates, stats, context);
    y += LAYOUT.SECTION_GAP;
  }

  // ── Full analysis extras ──

  if (
    selection.template === 'full-analysis' ||
    (sections.eventBreakdown && sections.usagePatterns)
  ) {
    // Event distribution stacked area
    y = renderEventDistributionSection(doc, y, aggregates, stats, context);
    y += LAYOUT.SECTION_GAP;

    // Machine settings
    y = renderMachineSettingsSection(doc, y, aggregates, stats, context);
    y += LAYOUT.SECTION_GAP;

    // Statistical summary table
    y = renderStatisticsSection(doc, y, aggregates, stats, context);
    y += LAYOUT.SECTION_GAP;
  }

  // ── Session Details Table (last) ──
  if (sections.sessionDetails) {
    void renderSessionTableSection(doc, y, aggregates, stats, context);
  }

  // Footer on last page
  addPageFooter(doc, context);

  return doc.output('blob');
}

// ── CSV generation ───────────────────────────────────────────────

/** Generate a CSV string from session data and optional aggregate stats. */
function buildCSV(aggregates: NightlyAggregate[], stats: ReportStatistics): string {
  const rows = toCSVRows(aggregates);
  const headers: (keyof SessionCSVRow)[] = [
    'date',
    'ahi',
    'ahiObstructive',
    'ahiCentral',
    'ahiHypopnea',
    'eventCount',
    'leakMedian',
    'leakP95',
    'pressureMean',
    'pressureP95',
    'usageHours',
    'complianceStatus',
  ];

  const lines: string[] = [];

  // Summary section
  lines.push('# CPAP Analyzer — Session Data Export');
  lines.push(`# Date Range: ${stats.dateRange.start} to ${stats.dateRange.end}`);
  lines.push(`# Generated: ${formatDate(new Date())}`);
  lines.push(`# Total Sessions: ${stats.totalSessions}`);
  // AHI is rendered at 1 dp (consensus D9 — no false precision).
  lines.push(`# Mean AHI: ${formatMetric('ahi', stats.meanAHI)}`);
  lines.push(`# Compliance Rate: ${(stats.complianceRate * 100).toFixed(1)}%`);
  lines.push('');

  // Header row
  lines.push(headers.map(escapeCSV).join(','));

  // Data rows
  for (const row of rows) {
    const values = headers.map((h) => escapeCSV(row[h]));
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

// ── Encryption ───────────────────────────────────────────────────

/** Derive an AES-256-GCM key from a password using PBKDF2. */
async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
}

/** Encrypt data with AES-256-GCM and return a Blob with salt + iv + ciphertext. */
async function encryptData(data: ArrayBuffer, params: EncryptionParams): Promise<Blob> {
  const iterations = params.iterations ?? 600_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(params.password, salt, iterations);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    data,
  );

  // File format: [4 bytes iteration count][16 bytes salt][12 bytes IV][ciphertext]
  const iterBytes = new Uint8Array(4);
  new DataView(iterBytes.buffer as ArrayBuffer).setUint32(0, iterations, false);

  const result = new Uint8Array(4 + 16 + 12 + ciphertext.byteLength);
  result.set(iterBytes, 0);
  result.set(salt, 4);
  result.set(iv, 20);
  result.set(new Uint8Array(ciphertext), 32);

  return new Blob([result], { type: 'application/octet-stream' });
}

// ── Public API ───────────────────────────────────────────────────

/** Generate a date-stamped filename. */
function makeFilename(
  prefix: string,
  extension: string,
  dateRange: { start: string; end: string },
): string {
  return `${prefix}_${dateRange.start}_${dateRange.end}.${extension}`;
}

/**
 * Generate a PDF report.
 *
 * @param selection - Content selection and template configuration.
 * @returns Report result with PDF blob and filename.
 */
export async function generatePDF(selection: ReportContentSelection): Promise<ReportResult> {
  const aggregates = await fetchAggregates(selection.dateRange.start, selection.dateRange.end);
  const stats = computeStatistics(aggregates, selection.dateRange);
  const blob = await buildPDF(selection, aggregates, stats);

  return {
    blob,
    filename: makeFilename('cpap-report', 'pdf', selection.dateRange),
    mimeType: 'application/pdf',
  };
}

/**
 * Generate a CSV export.
 *
 * @param dateRange - Date range for the export.
 * @returns Report result with CSV blob and filename.
 */
export async function generateCSV(dateRange: {
  start: string;
  end: string;
}): Promise<ReportResult> {
  const aggregates = await fetchAggregates(dateRange.start, dateRange.end);
  const stats = computeStatistics(aggregates, dateRange);
  const csv = buildCSV(aggregates, stats);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });

  return {
    blob,
    filename: makeFilename('cpap-data', 'csv', dateRange),
    mimeType: 'text/csv',
  };
}

/**
 * Generate an encrypted archive containing the CSV data.
 *
 * Uses AES-256-GCM with PBKDF2 key derivation.
 *
 * @param dateRange - Date range for the export.
 * @param encryption - Password and optional iteration count.
 * @returns Report result with encrypted blob and filename.
 */
export async function generateEncryptedArchive(
  dateRange: { start: string; end: string },
  encryption: EncryptionParams,
): Promise<ReportResult> {
  const aggregates = await fetchAggregates(dateRange.start, dateRange.end);
  const stats = computeStatistics(aggregates, dateRange);
  const csv = buildCSV(aggregates, stats);

  const encoder = new TextEncoder();
  const data = encoder.encode(csv).buffer as ArrayBuffer;
  const blob = await encryptData(data, encryption);

  return {
    blob,
    filename: makeFilename('cpap-data-encrypted', 'bin', dateRange),
    mimeType: 'application/octet-stream',
  };
}

/**
 * Generate a CSV string from raw aggregate data (for worker use).
 * Does not access IndexedDB — operates on pre-fetched data.
 */
export function buildCSVFromAggregates(
  aggregates: NightlyAggregate[],
  dateRange: { start: string; end: string },
): string {
  const stats = computeStatistics(aggregates, dateRange);
  return buildCSV(aggregates, stats);
}

/**
 * Encrypt a data buffer with AES-256-GCM (for worker use).
 * Does not access IndexedDB — operates on pre-fetched data.
 */
export async function encryptBuffer(data: ArrayBuffer, params: EncryptionParams): Promise<Blob> {
  return encryptData(data, params);
}

/** Re-export for convenience. */
export { formatDate };
