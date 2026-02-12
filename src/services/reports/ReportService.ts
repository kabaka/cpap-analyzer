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
import type { NightlyAggregate } from '@/types';
import type {
  EncryptionParams,
  ReportContentSelection,
  ReportResult,
  ReportStatistics,
  SessionCSVRow,
} from './types';

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
    document.body.removeChild(a);
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

  const compliantCount = aggregates.filter((a) => a.complianceStatus === 'compliant').length;
  const total = aggregates.length;

  return {
    totalSessions: total,
    dateRange,
    meanAHI: total > 0 ? ahiValues.reduce((s, v) => s + v, 0) / total : 0,
    medianAHI: median(ahiValues),
    minAHI: total > 0 ? Math.min(...ahiValues) : 0,
    maxAHI: total > 0 ? Math.max(...ahiValues) : 0,
    meanLeak: total > 0 ? leakValues.reduce((s, v) => s + v, 0) / total : 0,
    meanPressure: total > 0 ? pressureValues.reduce((s, v) => s + v, 0) / total : 0,
    meanUsageHours: total > 0 ? usageValues.reduce((s, v) => s + v, 0) / total : 0,
    totalUsageHours: usageValues.reduce((s, v) => s + v, 0),
    complianceRate: total > 0 ? compliantCount / total : 0,
    compliantNights: compliantCount,
    nonCompliantNights: total - compliantCount,
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

/** Page layout constants. */
const PDF_MARGIN = 20;
const PDF_LINE_HEIGHT = 7;
const PDF_PAGE_WIDTH = 210; // A4 width in mm
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - 2 * PDF_MARGIN;
const PDF_PAGE_HEIGHT = 297; // A4 height in mm
const PDF_FOOTER_MARGIN = 20;

/** Add page header and return the Y position after header. */
function addPageHeader(doc: jsPDF, title: string, dateRange: string, pageNum: number): number {
  // Title
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(title, PDF_MARGIN, PDF_MARGIN + 5);

  // Date range subtitle
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date Range: ${dateRange}`, PDF_MARGIN, PDF_MARGIN + 12);

  // Generation timestamp
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, PDF_MARGIN, PDF_MARGIN + 18);

  // Page number
  doc.text(`Page ${pageNum}`, PDF_PAGE_WIDTH - PDF_MARGIN - 15, PDF_MARGIN + 18);

  // Separator line
  doc.setLineWidth(0.5);
  doc.line(PDF_MARGIN, PDF_MARGIN + 22, PDF_PAGE_WIDTH - PDF_MARGIN, PDF_MARGIN + 22);

  return PDF_MARGIN + 28;
}

/** Check if we need a new page, and add one if so. Returns the current Y. */
function ensureSpace(
  doc: jsPDF,
  currentY: number,
  needed: number,
  title: string,
  dateRange: string,
  pageRef: { num: number },
): number {
  if (currentY + needed > PDF_PAGE_HEIGHT - PDF_FOOTER_MARGIN) {
    doc.addPage();
    pageRef.num += 1;
    return addPageHeader(doc, title, dateRange, pageRef.num);
  }
  return currentY;
}

/** Add a section heading. */
function addSectionHeading(doc: jsPDF, y: number, heading: string): number {
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(heading, PDF_MARGIN, y);
  doc.setLineWidth(0.3);
  doc.line(PDF_MARGIN, y + 2, PDF_MARGIN + PDF_CONTENT_WIDTH, y + 2);
  return y + PDF_LINE_HEIGHT + 2;
}

/** Add a key-value metric line. */
function addMetricLine(doc: jsPDF, y: number, label: string, value: string): number {
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(label, PDF_MARGIN + 4, y);
  doc.setFont('helvetica', 'normal');
  doc.text(value, PDF_MARGIN + 70, y);
  return y + PDF_LINE_HEIGHT;
}

/** Add a simple table to the PDF. */
function addTable(
  doc: jsPDF,
  startY: number,
  headers: string[],
  rows: string[][],
  colWidths: number[],
  title: string,
  dateRange: string,
  pageRef: { num: number },
): number {
  let y = startY;

  // Header row
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  let x = PDF_MARGIN;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i] ?? '', x, y);
    x += colWidths[i] ?? 20;
  }
  y += 2;
  doc.setLineWidth(0.2);
  doc.line(PDF_MARGIN, y, PDF_MARGIN + PDF_CONTENT_WIDTH, y);
  y += 4;

  // Data rows
  doc.setFont('helvetica', 'normal');
  for (const row of rows) {
    y = ensureSpace(doc, y, PDF_LINE_HEIGHT, title, dateRange, pageRef);
    x = PDF_MARGIN;
    for (let i = 0; i < row.length; i++) {
      doc.text(row[i] ?? '', x, y);
      x += colWidths[i] ?? 20;
    }
    y += PDF_LINE_HEIGHT - 2;
  }

  return y + 4;
}

/** Generate the PDF report. */
async function buildPDF(
  selection: ReportContentSelection,
  aggregates: NightlyAggregate[],
  stats: ReportStatistics,
): Promise<Blob> {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const dateRangeStr = `${selection.dateRange.start} to ${selection.dateRange.end}`;
  const title = selection.title ?? getTemplateTitle(selection.template);
  const pageRef = { num: 1 };

  let y = addPageHeader(doc, title, dateRangeStr, pageRef.num);

  const sections = selection.sections;

  // Summary Statistics
  if (sections.summaryStatistics) {
    y = ensureSpace(doc, y, 60, title, dateRangeStr, pageRef);
    y = addSectionHeading(doc, y, 'Summary Statistics');
    y = addMetricLine(doc, y, 'Total Sessions:', String(stats.totalSessions));
    y = addMetricLine(doc, y, 'Mean AHI:', `${stats.meanAHI.toFixed(2)} events/hr`);
    y = addMetricLine(doc, y, 'Median AHI:', `${stats.medianAHI.toFixed(2)} events/hr`);
    y = addMetricLine(
      doc,
      y,
      'AHI Range:',
      `${stats.minAHI.toFixed(1)} – ${stats.maxAHI.toFixed(1)}`,
    );
    y = addMetricLine(doc, y, 'Mean Leak Rate:', `${stats.meanLeak.toFixed(1)} L/min`);
    y = addMetricLine(doc, y, 'Mean Usage:', `${stats.meanUsageHours.toFixed(1)} hrs/night`);
    y = addMetricLine(doc, y, 'Total Usage:', `${stats.totalUsageHours.toFixed(1)} hours`);
    y += 4;
  }

  // Compliance Report
  if (sections.complianceReport) {
    y = ensureSpace(doc, y, 40, title, dateRangeStr, pageRef);
    y = addSectionHeading(doc, y, 'Compliance Report');
    y = addMetricLine(doc, y, 'Compliance Rate:', `${(stats.complianceRate * 100).toFixed(1)}%`);
    y = addMetricLine(doc, y, 'Compliant Nights:', String(stats.compliantNights));
    y = addMetricLine(doc, y, 'Non-Compliant Nights:', String(stats.nonCompliantNights));
    y = addMetricLine(doc, y, 'CMS Threshold:', '≥4 hours on ≥70% of nights in a 30-day period');
    y += 4;
  }

  // AHI Trend
  if (sections.ahiTrend && aggregates.length > 0) {
    y = ensureSpace(doc, y, 30 + Math.min(aggregates.length, 30) * 5, title, dateRangeStr, pageRef);
    y = addSectionHeading(doc, y, 'AHI Trend');

    const trendRows = aggregates
      .slice(-30)
      .map((a) => [a.date, a.ahi.toFixed(2), a.eventCount.toString(), a.usageHours.toFixed(1)]);

    y = addTable(
      doc,
      y,
      ['Date', 'AHI', 'Events', 'Usage (hrs)'],
      trendRows,
      [35, 30, 30, 35],
      title,
      dateRangeStr,
      pageRef,
    );
    y += 4;
  }

  // Pressure Metrics
  if (sections.pressureMetrics && aggregates.length > 0) {
    y = ensureSpace(doc, y, 40, title, dateRangeStr, pageRef);
    y = addSectionHeading(doc, y, 'Pressure Metrics');
    y = addMetricLine(doc, y, 'Mean Pressure:', `${stats.meanPressure.toFixed(1)} cmH2O`);

    const avgP95 = aggregates.reduce((s, a) => s + a.pressureP95, 0) / aggregates.length;
    y = addMetricLine(doc, y, 'Avg P95 Pressure:', `${avgP95.toFixed(1)} cmH2O`);

    const avgMax = aggregates.reduce((s, a) => s + a.pressureMax, 0) / aggregates.length;
    y = addMetricLine(doc, y, 'Avg Max Pressure:', `${avgMax.toFixed(1)} cmH2O`);
    y += 4;
  }

  // Leak Analysis
  if (sections.leakAnalysis && aggregates.length > 0) {
    y = ensureSpace(doc, y, 40, title, dateRangeStr, pageRef);
    y = addSectionHeading(doc, y, 'Leak Analysis');
    y = addMetricLine(doc, y, 'Mean Leak:', `${stats.meanLeak.toFixed(1)} L/min`);

    const avgP95Leak = aggregates.reduce((s, a) => s + a.leakP95, 0) / aggregates.length;
    y = addMetricLine(doc, y, 'Avg P95 Leak:', `${avgP95Leak.toFixed(1)} L/min`);

    const avgMaxLeak = aggregates.reduce((s, a) => s + a.leakMax, 0) / aggregates.length;
    y = addMetricLine(doc, y, 'Avg Max Leak:', `${avgMaxLeak.toFixed(1)} L/min`);

    const avgLeakDuration =
      aggregates.reduce((s, a) => s + a.leakDurationMinutes, 0) / aggregates.length;
    y = addMetricLine(doc, y, 'Avg Leak Duration:', `${avgLeakDuration.toFixed(0)} min`);
    y += 4;
  }

  // Event Breakdown
  if (sections.eventBreakdown && aggregates.length > 0) {
    y = ensureSpace(doc, y, 60, title, dateRangeStr, pageRef);
    y = addSectionHeading(doc, y, 'Event Breakdown');

    // Aggregate event counts across all sessions
    const eventTotals = {
      obstructive: 0,
      central: 0,
      mixed: 0,
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
      eventTotals.hypopnea += a.eventsByType.hypopnea;
      eventTotals.rera += a.eventsByType.rera;
      eventTotals.flowLimitation += a.eventsByType.flowLimitation;
      eventTotals.largeLeak += a.eventsByType.largeLeak;
      eventTotals.periodicBreathing += a.eventsByType.periodicBreathing;
    }

    const eventRows = [
      ['Obstructive Apnea', eventTotals.obstructive.toString()],
      ['Central Apnea', eventTotals.central.toString()],
      ['Mixed Apnea', eventTotals.mixed.toString()],
      ['Hypopnea', eventTotals.hypopnea.toString()],
      ['RERA', eventTotals.rera.toString()],
      ['Flow Limitation', eventTotals.flowLimitation.toString()],
      ['Large Leak', eventTotals.largeLeak.toString()],
      ['Periodic Breathing', eventTotals.periodicBreathing.toString()],
    ];

    y = addTable(
      doc,
      y,
      ['Event Type', 'Total Count'],
      eventRows,
      [80, 40],
      title,
      dateRangeStr,
      pageRef,
    );
    y += 4;
  }

  // Usage Patterns
  if (sections.usagePatterns && aggregates.length > 0) {
    y = ensureSpace(doc, y, 40, title, dateRangeStr, pageRef);
    y = addSectionHeading(doc, y, 'Usage Patterns');

    const usageOver4 = aggregates.filter((a) => a.usageHours >= 4).length;
    const usageOver6 = aggregates.filter((a) => a.usageHours >= 6).length;

    y = addMetricLine(
      doc,
      y,
      'Nights ≥ 4 hours:',
      `${usageOver4} (${((usageOver4 / aggregates.length) * 100).toFixed(1)}%)`,
    );
    y = addMetricLine(
      doc,
      y,
      'Nights ≥ 6 hours:',
      `${usageOver6} (${((usageOver6 / aggregates.length) * 100).toFixed(1)}%)`,
    );
    y = addMetricLine(doc, y, 'Mean Usage:', `${stats.meanUsageHours.toFixed(1)} hrs/night`);
    y += 4;
  }

  // Session Details (table)
  if (sections.sessionDetails && aggregates.length > 0) {
    y = ensureSpace(doc, y, 30, title, dateRangeStr, pageRef);
    y = addSectionHeading(doc, y, 'Session Details');

    const sessionRows = aggregates.map((a) => [
      a.date,
      a.ahi.toFixed(1),
      a.leakMedian.toFixed(1),
      a.pressureMean.toFixed(1),
      a.usageHours.toFixed(1),
      a.complianceStatus,
    ]);

    addTable(
      doc,
      y,
      ['Date', 'AHI', 'Leak', 'Pressure', 'Usage (hrs)', 'Compliance'],
      sessionRows,
      [30, 20, 20, 25, 30, 30],
      title,
      dateRangeStr,
      pageRef,
    );
  }

  // Footer on last page
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.text(
    'Generated by CPAP Analyzer — For informational purposes only. Not a medical document.',
    PDF_MARGIN,
    PDF_PAGE_HEIGHT - 10,
  );

  return doc.output('blob');
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
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Total Sessions: ${stats.totalSessions}`);
  lines.push(`# Mean AHI: ${stats.meanAHI.toFixed(2)}`);
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
