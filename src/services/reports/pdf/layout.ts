/**
 * PDF layout constants, color system, and helper functions.
 *
 * Provides the visual foundation for the redesigned PDF reports:
 * page layout, typography, KPI cards, section headings, and
 * page header/footer rendering.
 *
 * @module services/reports/pdf/layout
 */

import type { jsPDF } from 'jspdf';

// ── Color constants ──────────────────────────────────────────────

export const PDF_COLORS = {
  // Text
  TEXT_PRIMARY: '#111827',
  TEXT_SECONDARY: '#374151',
  TEXT_BODY: '#4b5563',
  TEXT_MUTED: '#6b7280',
  TEXT_LIGHT: '#9ca3af',

  // Clinical severity zones
  SEVERITY_NORMAL: '#22c55e',
  SEVERITY_MILD: '#eab308',
  SEVERITY_MODERATE: '#f97316',
  SEVERITY_SEVERE: '#ef4444',

  // Severity zone fills (20% opacity pre-computed on white)
  SEVERITY_NORMAL_FILL: '#d4f4dd',
  SEVERITY_MILD_FILL: '#fdf6cc',
  SEVERITY_MODERATE_FILL: '#fee6d0',
  SEVERITY_SEVERE_FILL: '#fdd4d4',

  // Chart series
  CHART_BLUE: '#3b82f6',
  CHART_PURPLE: '#8b5cf6',
  CHART_CYAN: '#06b6d4',
  CHART_EMERALD: '#10b981',

  // Chart series fills (20% opacity pre-computed on white)
  CHART_BLUE_FILL: '#d5e3fd',
  CHART_PURPLE_FILL: '#e4d9fd',
  CHART_CYAN_FILL: '#cdf2f8',
  CHART_EMERALD_FILL: '#cff5e7',

  // UI elements
  COMPLIANCE_LINE: '#22c55e',
  GRID_LINE: '#e5e7eb',
  AXIS_LINE: '#d1d5db',
  BORDER: '#e5e7eb',
  BACKGROUND_LIGHT: '#f9fafb',
  BACKGROUND_CARD: '#f3f4f6',
  WHITE: '#ffffff',

  // KPI badge backgrounds
  KPI_GREEN_BG: '#dcfce7',
  KPI_YELLOW_BG: '#fef9c3',
  KPI_RED_BG: '#fee2e2',
} as const;

// ── Layout constants ─────────────────────────────────────────────

export const LAYOUT = {
  PAGE_WIDTH: 210,
  PAGE_HEIGHT: 297,
  MARGIN_LEFT: 20,
  MARGIN_RIGHT: 20,
  MARGIN_TOP: 15,
  MARGIN_BOTTOM: 15,
  CONTENT_WIDTH: 170,
  CONTENT_HEIGHT: 267,
  GUTTER: 6,
  HALF_WIDTH: 82,
  QUARTER_WIDTH: 40,

  // Vertical spacing
  SECTION_GAP: 10,
  SUBSECTION_GAP: 6,
  ELEMENT_GAP: 4,
  LINE_HEIGHT: 5,
  HEADING_AFTER: 3,

  // Chart heights
  CHART_FULL_HEIGHT: 60,
  CHART_HALF_HEIGHT: 50,
  CHART_MINI_HEIGHT: 30,

  // Component heights
  HEADER_HEIGHT: 28,
  KPI_CARD_HEIGHT: 22,
  TABLE_ROW_HEIGHT: 5,
  TABLE_HEADER_HEIGHT: 7,
  FOOTER_HEIGHT: 10,
} as const;

// ── Page context ─────────────────────────────────────────────────

export interface PageContext {
  pageNum: number;
  totalPages: number;
  title: string;
  dateRange: string;
}

// ── Hex helpers ──────────────────────────────────────────────────

export function hexToRGB(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

export function setFillColor(doc: jsPDF, hex: string): void {
  const [r, g, b] = hexToRGB(hex);
  doc.setFillColor(r, g, b);
}

export function setTextColor(doc: jsPDF, hex: string): void {
  const [r, g, b] = hexToRGB(hex);
  doc.setTextColor(r, g, b);
}

export function setDrawColor(doc: jsPDF, hex: string): void {
  const [r, g, b] = hexToRGB(hex);
  doc.setDrawColor(r, g, b);
}

// ── AHI severity ─────────────────────────────────────────────────

export function getAHISeverityColor(ahi: number): string {
  if (ahi < 5) return PDF_COLORS.SEVERITY_NORMAL;
  if (ahi < 15) return PDF_COLORS.SEVERITY_MILD;
  if (ahi < 30) return PDF_COLORS.SEVERITY_MODERATE;
  return PDF_COLORS.SEVERITY_SEVERE;
}

export function getAHISeverityLabel(ahi: number): string {
  if (ahi < 5) return 'Normal';
  if (ahi < 15) return 'Mild';
  if (ahi < 30) return 'Moderate';
  return 'Severe';
}

// ── Page header ──────────────────────────────────────────────────

export function addPageHeader(doc: jsPDF, context: PageContext): number {
  const y = LAYOUT.MARGIN_TOP;

  // Line 1: branding + page number
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  setTextColor(doc, PDF_COLORS.TEXT_MUTED);
  doc.text('CPAP Analyzer', LAYOUT.MARGIN_LEFT, y + 4);
  doc.text(`Page ${context.pageNum}`, LAYOUT.PAGE_WIDTH - LAYOUT.MARGIN_RIGHT, y + 4, {
    align: 'right',
  });

  // Line 2: title
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  setTextColor(doc, PDF_COLORS.TEXT_PRIMARY);
  doc.text(context.title, LAYOUT.MARGIN_LEFT, y + 12);

  // Line 3: date range + generation date
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  setTextColor(doc, PDF_COLORS.TEXT_MUTED);
  doc.text(`Date Range: ${context.dateRange}`, LAYOUT.MARGIN_LEFT, y + 19);

  const now = new Date();
  const genDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  doc.text(`Generated: ${genDate}`, LAYOUT.PAGE_WIDTH - LAYOUT.MARGIN_RIGHT, y + 19, {
    align: 'right',
  });

  // Line 4: separator
  setDrawColor(doc, '#d1d5db');
  doc.setLineWidth(0.4);
  doc.line(LAYOUT.MARGIN_LEFT, y + 23, LAYOUT.PAGE_WIDTH - LAYOUT.MARGIN_RIGHT, y + 23);

  return y + LAYOUT.HEADER_HEIGHT;
}

// ── Page footer ──────────────────────────────────────────────────

export function addPageFooter(doc: jsPDF, context?: PageContext): void {
  void context;
  const y = LAYOUT.PAGE_HEIGHT - LAYOUT.MARGIN_BOTTOM;

  setDrawColor(doc, PDF_COLORS.GRID_LINE);
  doc.setLineWidth(0.3);
  doc.line(LAYOUT.MARGIN_LEFT, y - 4, LAYOUT.PAGE_WIDTH - LAYOUT.MARGIN_RIGHT, y - 4);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  setTextColor(doc, PDF_COLORS.TEXT_LIGHT);
  doc.text('For informational purposes only. Not a medical document.', LAYOUT.MARGIN_LEFT, y);
  doc.setFont('helvetica', 'normal');
  doc.text('CPAP Analyzer', LAYOUT.PAGE_WIDTH - LAYOUT.MARGIN_RIGHT, y, { align: 'right' });
}

// ── Section heading ──────────────────────────────────────────────

export function addSectionHeading(doc: jsPDF, y: number, text: string): number {
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  setTextColor(doc, PDF_COLORS.TEXT_PRIMARY);
  doc.text(text, LAYOUT.MARGIN_LEFT, y);

  // Accent underline
  setDrawColor(doc, PDF_COLORS.CHART_BLUE);
  doc.setLineWidth(0.8);
  doc.line(LAYOUT.MARGIN_LEFT, y + 1.5, LAYOUT.MARGIN_LEFT + 30, y + 1.5);

  // Reset
  setDrawColor(doc, '#000000');
  doc.setLineWidth(0.2);

  return y + LAYOUT.HEADING_AFTER + 4;
}

// ── Ensure space / page break ────────────────────────────────────

export function ensureSpace(
  doc: jsPDF,
  currentY: number,
  needed: number,
  context: PageContext,
): number {
  const available = LAYOUT.PAGE_HEIGHT - LAYOUT.MARGIN_BOTTOM - LAYOUT.FOOTER_HEIGHT;
  if (currentY + needed > available) {
    addPageFooter(doc, context);
    doc.addPage();
    context.pageNum += 1;
    addPageHeader(doc, context);
    return LAYOUT.MARGIN_TOP + LAYOUT.HEADER_HEIGHT + LAYOUT.SECTION_GAP;
  }
  return currentY;
}

// ── KPI card ─────────────────────────────────────────────────────

export interface KPICardData {
  label: string;
  value: string;
  unit?: string;
  subtitle?: string;
  subtitleColor?: string;
  bgColor?: string;
}

export function drawKPICard(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  data: KPICardData,
): void {
  // Card background
  const bg = data.bgColor ?? PDF_COLORS.BACKGROUND_CARD;
  setFillColor(doc, bg);
  doc.roundedRect(x, y, width, height, 2, 2, 'F');

  // Label (top)
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  setTextColor(doc, PDF_COLORS.TEXT_MUTED);
  doc.text(data.label, x + 3, y + 5);

  // Value (large)
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  setTextColor(doc, PDF_COLORS.TEXT_PRIMARY);
  doc.text(data.value, x + 3, y + 14);

  // Unit
  if (data.unit) {
    const valueWidth = doc.getTextWidth(data.value);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setTextColor(doc, PDF_COLORS.TEXT_MUTED);
    doc.text(data.unit, x + 4 + valueWidth, y + 14);
  }

  // Subtitle
  if (data.subtitle) {
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    setTextColor(doc, data.subtitleColor ?? PDF_COLORS.TEXT_LIGHT);
    doc.text(data.subtitle, x + 3, y + 19);
  }
}

export function drawKPIRow(doc: jsPDF, y: number, cards: KPICardData[]): number {
  const count = cards.length;
  const cardWidth = (LAYOUT.CONTENT_WIDTH - (count - 1) * LAYOUT.GUTTER) / count;
  cards.forEach((card, i) => {
    const x = LAYOUT.MARGIN_LEFT + i * (cardWidth + LAYOUT.GUTTER);
    drawKPICard(doc, x, y, cardWidth, LAYOUT.KPI_CARD_HEIGHT, card);
  });
  return y + LAYOUT.KPI_CARD_HEIGHT + LAYOUT.ELEMENT_GAP;
}

// ── Metric line ──────────────────────────────────────────────────

export function addMetricLine(doc: jsPDF, y: number, label: string, value: string): number {
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  setTextColor(doc, PDF_COLORS.TEXT_SECONDARY);
  doc.text(label, LAYOUT.MARGIN_LEFT + 4, y);
  doc.setFont('helvetica', 'normal');
  setTextColor(doc, PDF_COLORS.TEXT_BODY);
  doc.text(value, LAYOUT.MARGIN_LEFT + 60, y);
  return y + LAYOUT.LINE_HEIGHT;
}

// ── Chart embedding ──────────────────────────────────────────────

export function addChart(
  doc: jsPDF,
  dataUrl: string,
  x: number,
  y: number,
  w: number,
  h: number,
): number {
  doc.addImage(dataUrl, 'PNG', x, y, w, h);
  return y + h + LAYOUT.ELEMENT_GAP;
}

// ── Subsection heading ───────────────────────────────────────────

export function addSubsectionHeading(doc: jsPDF, y: number, text: string): number {
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  setTextColor(doc, PDF_COLORS.TEXT_SECONDARY);
  doc.text(text, LAYOUT.MARGIN_LEFT, y);
  return y + LAYOUT.HEADING_AFTER + 2;
}

// ── Enhanced table ───────────────────────────────────────────────

export interface TableConfig {
  headers: string[];
  rows: string[][];
  colWidths: number[];
  colAligns?: ('left' | 'center' | 'right')[];
  zebraStripe?: boolean;
  highlightFn?: (row: string[], rowIndex: number) => string | null;
}

export function drawTable(
  doc: jsPDF,
  startY: number,
  config: TableConfig,
  context: PageContext,
): number {
  let y = startY;

  function drawHeaderRow(atY: number): number {
    setFillColor(doc, PDF_COLORS.BACKGROUND_CARD);
    doc.rect(LAYOUT.MARGIN_LEFT, atY - 1, LAYOUT.CONTENT_WIDTH, LAYOUT.TABLE_HEADER_HEIGHT, 'F');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    setTextColor(doc, PDF_COLORS.TEXT_SECONDARY);

    let x = LAYOUT.MARGIN_LEFT;
    for (let i = 0; i < config.headers.length; i++) {
      const align = config.colAligns?.[i] ?? 'left';
      let textX = x + 2;
      if (align === 'right') textX = x + (config.colWidths[i] ?? 20) - 2;
      else if (align === 'center') textX = x + (config.colWidths[i] ?? 20) / 2;
      doc.text(config.headers[i] ?? '', textX, atY + 3, { align });
      x += config.colWidths[i] ?? 20;
    }

    setDrawColor(doc, PDF_COLORS.BORDER);
    doc.setLineWidth(0.3);
    doc.line(
      LAYOUT.MARGIN_LEFT,
      atY + LAYOUT.TABLE_HEADER_HEIGHT - 1,
      LAYOUT.MARGIN_LEFT + LAYOUT.CONTENT_WIDTH,
      atY + LAYOUT.TABLE_HEADER_HEIGHT - 1,
    );

    return atY + LAYOUT.TABLE_HEADER_HEIGHT;
  }

  y = drawHeaderRow(y);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');

  for (let ri = 0; ri < config.rows.length; ri++) {
    // Page break check
    const available = LAYOUT.PAGE_HEIGHT - LAYOUT.MARGIN_BOTTOM - LAYOUT.FOOTER_HEIGHT;
    if (y + LAYOUT.TABLE_ROW_HEIGHT > available) {
      addPageFooter(doc, context);
      doc.addPage();
      context.pageNum += 1;
      addPageHeader(doc, context);
      y = LAYOUT.MARGIN_TOP + LAYOUT.HEADER_HEIGHT + LAYOUT.ELEMENT_GAP;
      y = drawHeaderRow(y);
    }

    const row = config.rows[ri] as string[];

    // Row background
    const highlight = config.highlightFn?.(row, ri);
    if (highlight) {
      setFillColor(doc, highlight);
      doc.rect(LAYOUT.MARGIN_LEFT, y - 1, LAYOUT.CONTENT_WIDTH, LAYOUT.TABLE_ROW_HEIGHT, 'F');
    } else if (config.zebraStripe && ri % 2 === 0) {
      setFillColor(doc, PDF_COLORS.BACKGROUND_LIGHT);
      doc.rect(LAYOUT.MARGIN_LEFT, y - 1, LAYOUT.CONTENT_WIDTH, LAYOUT.TABLE_ROW_HEIGHT, 'F');
    }

    setTextColor(doc, PDF_COLORS.TEXT_BODY);
    doc.setFont('helvetica', 'normal');

    let x = LAYOUT.MARGIN_LEFT;
    for (let ci = 0; ci < row.length; ci++) {
      const align = config.colAligns?.[ci] ?? 'left';
      let textX = x + 2;
      if (align === 'right') textX = x + (config.colWidths[ci] ?? 20) - 2;
      else if (align === 'center') textX = x + (config.colWidths[ci] ?? 20) / 2;
      doc.text(row[ci] ?? '', textX, y + 2.5, { align });
      x += config.colWidths[ci] ?? 20;
    }

    y += LAYOUT.TABLE_ROW_HEIGHT;
  }

  return y + LAYOUT.ELEMENT_GAP;
}

// ── Descriptive statistics helper ────────────────────────────────

export interface DescriptiveStats {
  min: number;
  q1: number;
  median: number;
  mean: number;
  q3: number;
  max: number;
  stdDev: number;
}

export function computeDescriptiveStats(values: number[]): DescriptiveStats {
  if (values.length === 0) {
    return { min: 0, q1: 0, median: 0, mean: 0, q3: 0, max: 0, stdDev: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1 || 1);

  return {
    min: sorted[0] as number,
    q1: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    mean,
    q3: percentile(sorted, 0.75),
    max: sorted[n - 1] as number,
    stdDev: Math.sqrt(variance),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] as number;
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] as number;
  const lo = sorted[lower] as number;
  const hi = sorted[upper] as number;
  return lo + (hi - lo) * (index - lower);
}

// ── Correlation helper ───────────────────────────────────────────

export function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - meanX;
    const dy = (ys[i] ?? 0) - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

export function interpretCorrelation(r: number): string {
  const abs = Math.abs(r);
  const dir = r >= 0 ? 'positive' : 'negative';
  if (abs < 0.2) return `negligible ${dir}`;
  if (abs < 0.4) return `weak ${dir}`;
  if (abs < 0.6) return `moderate ${dir}`;
  if (abs < 0.8) return `strong ${dir}`;
  return `very strong ${dir}`;
}

// ── Event type formatting ────────────────────────────────────────

export function formatEventTypeName(key: string): string {
  const map: Record<string, string> = {
    obstructive: 'Obstructive Apnea',
    central: 'Central Apnea',
    mixed: 'Mixed Apnea',
    hypopnea: 'Hypopnea',
    rera: 'RERA',
    flowLimitation: 'Flow Limitation',
    largeLeak: 'Large Leak',
    periodicBreathing: 'Periodic Breathing',
  };
  return map[key] ?? key;
}
