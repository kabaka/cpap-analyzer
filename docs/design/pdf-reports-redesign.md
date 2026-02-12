# PDF Reports Redesign — CPAP Analyzer

**Version**: 1.0
**Last Updated**: February 12, 2026
**Status**: Design Specification
**Audience**: Frontend, Data Visualization, QA agents

---

## Executive Summary

This specification redesigns the PDF report system from text-only output to a clinically professional document with embedded charts, structured layouts, and rich data presentation. Reports should be suitable for sharing with a physician.

All charts are drawn directly to off-screen `<canvas>` elements using the Canvas 2D API, then embedded into the PDF via `jsPDF.addImage()`. No `html2canvas` dependency is required.

---

## 1. Page Layout System

### 1.1 Page Dimensions (A4 Portrait)

| Property                 | Value  |
| ------------------------ | ------ |
| Page width               | 210 mm |
| Page height              | 297 mm |
| Left margin              | 20 mm  |
| Right margin             | 20 mm  |
| Top margin               | 15 mm  |
| Bottom margin            | 15 mm  |
| Content width            | 170 mm |
| Content height           | 267 mm |
| Gutter (between columns) | 6 mm   |
| Half-column width        | 82 mm  |
| Quarter-column width     | 40 mm  |

### 1.2 Vertical Spacing Constants

```typescript
const LAYOUT = {
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
  SECTION_GAP: 10, // Space between major sections
  SUBSECTION_GAP: 6, // Space between subsections
  ELEMENT_GAP: 4, // Space between elements within a section
  LINE_HEIGHT: 5, // Standard text line height
  HEADING_AFTER: 3, // Space after a heading before content

  // Chart heights
  CHART_FULL_HEIGHT: 60, // Full-width chart height
  CHART_HALF_HEIGHT: 50, // Half-width chart height
  CHART_MINI_HEIGHT: 30, // Mini sparkline/KPI chart height

  // Component heights
  HEADER_HEIGHT: 28, // Page header block
  KPI_CARD_HEIGHT: 22, // Single KPI metric card
  TABLE_ROW_HEIGHT: 5, // Table row
  TABLE_HEADER_HEIGHT: 7, // Table header row
  FOOTER_HEIGHT: 10, // Page footer
} as const;
```

### 1.3 Page Header (all pages)

**Position**: `y = MARGIN_TOP` to `y = MARGIN_TOP + HEADER_HEIGHT`

```
┌─────────────────────────────────────────────────────────────────────┐
│ [CPAP Analyzer Logo/Text]                               Page X / N │
│ Report Title                                                        │
│ Date Range: YYYY-MM-DD to YYYY-MM-DD    Generated: YYYY-MM-DD      │
│ ─────────────────────────────────────────────────────────────────── │
└─────────────────────────────────────────────────────────────────────┘
```

- Line 1: "CPAP Analyzer" in 8pt helvetica bold, color `#6b7280`. Right-aligned: "Page X / N" in 8pt.
- Line 2: Report title in 14pt helvetica bold, color `#111827`.
- Line 3: Date range and generation date in 9pt helvetica normal, color `#6b7280`.
- Line 4: 0.4pt horizontal rule, color `#d1d5db`.

### 1.4 Page Footer (all pages)

**Position**: `y = PAGE_HEIGHT - MARGIN_BOTTOM`

```
────────────────────────────────────────────────────────────────────
For informational purposes only. Not a medical document.   CPAP Analyzer
```

- 0.3pt horizontal rule, color `#e5e7eb`.
- Left: disclaimer in 7pt helvetica italic, color `#9ca3af`.
- Right: "CPAP Analyzer" in 7pt helvetica normal, color `#9ca3af`.

### 1.5 Pagination Logic

```typescript
function ensureSpace(doc: jsPDF, currentY: number, needed: number, context: PageContext): number {
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
```

Charts and KPI card rows are **never** split across pages. Tables can break across pages at row boundaries. Each table page break repeats the table column headers.

---

## 2. Typography System

### 2.1 Font Stack

All PDF text uses `helvetica` (built into jsPDF, no external fonts needed).

### 2.2 Type Scale

| Element            | Size (pt) | Weight | Color (hex) | Usage                         |
| ------------------ | --------- | ------ | ----------- | ----------------------------- |
| Report title       | 14        | bold   | `#111827`   | First line of page header     |
| Section heading    | 12        | bold   | `#111827`   | Major section titles          |
| Subsection heading | 10        | bold   | `#374151`   | Chart titles, sub-areas       |
| Body text          | 9         | normal | `#374151`   | Metric values, descriptions   |
| KPI value          | 18        | bold   | `#111827`   | Large headline numbers        |
| KPI label          | 8         | normal | `#6b7280`   | Labels above/below KPI values |
| KPI subtitle       | 7         | normal | `#9ca3af`   | Secondary info under KPI      |
| Table header       | 8         | bold   | `#374151`   | Column headers                |
| Table cell         | 8         | normal | `#4b5563`   | Table data                    |
| Chart axis label   | 7         | normal | `#6b7280`   | Axis tick labels              |
| Chart title        | 9         | bold   | `#374151`   | Title above chart             |
| Footer text        | 7         | italic | `#9ca3af`   | Page footer                   |
| Watermark text     | 8         | normal | `#6b7280`   | Header branding               |

### 2.3 Section Heading Rendering

```typescript
function addSectionHeading(doc: jsPDF, y: number, text: string): number {
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(17, 24, 39); // #111827
  doc.text(text, LAYOUT.MARGIN_LEFT, y);
  // Accent underline (2mm, blue)
  doc.setDrawColor(59, 130, 246); // #3b82f6
  doc.setLineWidth(0.8);
  doc.line(LAYOUT.MARGIN_LEFT, y + 1.5, LAYOUT.MARGIN_LEFT + 30, y + 1.5);
  // Reset
  doc.setDrawColor(0);
  doc.setLineWidth(0.2);
  return y + LAYOUT.HEADING_AFTER + 4;
}
```

---

## 3. Color System

### 3.1 Color Constants

```typescript
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

  // Severity zone fills (20% opacity → pre-computed on white background)
  SEVERITY_NORMAL_FILL: '#d4f4dd',
  SEVERITY_MILD_FILL: '#fdf6cc',
  SEVERITY_MODERATE_FILL: '#fee6d0',
  SEVERITY_SEVERE_FILL: '#fdd4d4',

  // Chart series
  CHART_BLUE: '#3b82f6',
  CHART_PURPLE: '#8b5cf6',
  CHART_CYAN: '#06b6d4',
  CHART_EMERALD: '#10b981',

  // Chart series fills (20% opacity → pre-computed on white)
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
```

### 3.2 Hex-to-RGB Helper

```typescript
function hexToRGB(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function setFillColor(doc: jsPDF, hex: string): void {
  const [r, g, b] = hexToRGB(hex);
  doc.setFillColor(r, g, b);
}

function setTextColor(doc: jsPDF, hex: string): void {
  const [r, g, b] = hexToRGB(hex);
  doc.setTextColor(r, g, b);
}

function setDrawColor(doc: jsPDF, hex: string): void {
  const [r, g, b] = hexToRGB(hex);
  doc.setDrawColor(r, g, b);
}
```

### 3.3 AHI Severity Classifiers

```typescript
function getAHISeverityColor(ahi: number): string {
  if (ahi < 5) return PDF_COLORS.SEVERITY_NORMAL;
  if (ahi < 15) return PDF_COLORS.SEVERITY_MILD;
  if (ahi < 30) return PDF_COLORS.SEVERITY_MODERATE;
  return PDF_COLORS.SEVERITY_SEVERE;
}

function getAHISeverityLabel(ahi: number): string {
  if (ahi < 5) return 'Normal';
  if (ahi < 15) return 'Mild';
  if (ahi < 30) return 'Moderate';
  return 'Severe';
}
```

---

## 4. KPI Cards

### 4.1 KPI Card Layout

KPI cards display headline metrics in a row of 3–4 cards across the content width.

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Mean AHI    │  │  Usage       │  │  Compliance  │  │  Leak Rate   │
│   4.2        │  │   6.8 hrs    │  │   87%        │  │   3.1 L/min  │
│  Normal ●    │  │  med: 7.1    │  │  26/30 nights│  │  P95: 8.4    │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

**Dimensions**: 4 cards across = `(170 - 3×6) / 4 = 38mm` wide × 22mm tall each.

### 4.2 KPI Card Rendering

```typescript
interface KPICardData {
  label: string; // e.g., "Mean AHI"
  value: string; // e.g., "4.2"
  unit?: string; // e.g., "events/hr"
  subtitle?: string; // e.g., "Normal ●"
  subtitleColor?: string; // severity color for subtitle
  bgColor?: string; // card background tint
}

function drawKPICard(
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

  // Value (center, large)
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  setTextColor(doc, PDF_COLORS.TEXT_PRIMARY);
  const valueText = data.unit ? `${data.value}` : data.value;
  doc.text(valueText, x + 3, y + 14);

  // Unit (next to value, smaller)
  if (data.unit) {
    const valueWidth = doc.getTextWidth(valueText);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setTextColor(doc, PDF_COLORS.TEXT_MUTED);
    doc.text(data.unit, x + 4 + valueWidth, y + 14);
  }

  // Subtitle (bottom)
  if (data.subtitle) {
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    setTextColor(doc, data.subtitleColor ?? PDF_COLORS.TEXT_LIGHT);
    doc.text(data.subtitle, x + 3, y + 19);
  }
}

function drawKPIRow(doc: jsPDF, y: number, cards: KPICardData[]): number {
  const count = cards.length;
  const cardWidth = (LAYOUT.CONTENT_WIDTH - (count - 1) * LAYOUT.GUTTER) / count;
  cards.forEach((card, i) => {
    const x = LAYOUT.MARGIN_LEFT + i * (cardWidth + LAYOUT.GUTTER);
    drawKPICard(doc, x, y, cardWidth, LAYOUT.KPI_CARD_HEIGHT, card);
  });
  return y + LAYOUT.KPI_CARD_HEIGHT + LAYOUT.ELEMENT_GAP;
}
```

---

## 5. Chart Rendering System

### 5.1 Architecture Overview

All charts are rendered off-screen using the Canvas 2D API and embedded as PNG images.

```
NightlyAggregate[]
    → prepareChartData(field mapping)
    → create off-screen canvas (pixel dimensions from mm × devicePixelRatio)
    → draw via Canvas 2D API (axes, grid, data, labels)
    → canvas.toDataURL('image/png')
    → doc.addImage(dataUrl, 'PNG', x, y, widthMm, heightMm)
```

### 5.2 Canvas Resolution

To ensure crisp rendering in PDF, use a scale factor of 3× (simulating 300 DPI on a 96 DPI screen):

```typescript
const PDF_CANVAS_SCALE = 3;

function createChartCanvas(
  widthMm: number,
  heightMm: number,
): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  pixelWidth: number;
  pixelHeight: number;
} {
  // 1mm ≈ 3.7795px at 96 DPI; at 3× scale for 300 DPI output
  const pxPerMm = 3.7795 * PDF_CANVAS_SCALE;
  const pixelWidth = Math.round(widthMm * pxPerMm);
  const pixelHeight = Math.round(heightMm * pxPerMm);

  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d')!;

  // Scale all drawing operations
  ctx.scale(PDF_CANVAS_SCALE, PDF_CANVAS_SCALE);

  // White background
  ctx.fillStyle = PDF_COLORS.WHITE;
  ctx.fillRect(0, 0, pixelWidth / PDF_CANVAS_SCALE, pixelHeight / PDF_CANVAS_SCALE);

  return { canvas, ctx, pixelWidth, pixelHeight };
}
```

### 5.3 Chart Coordinate System

All chart drawing functions work in a logical coordinate system (before scaling) with a chart area defined by internal padding:

```typescript
interface ChartArea {
  /** Left edge of the plot area in logical pixels */
  left: number;
  /** Top edge of the plot area in logical pixels */
  top: number;
  /** Right edge of the plot area in logical pixels */
  right: number;
  /** Bottom edge of the plot area in logical pixels */
  bottom: number;
  /** Plot width in logical pixels */
  width: number;
  /** Plot height in logical pixels */
  height: number;
}

// Standard chart paddings (logical pixels, before 3× scale)
const CHART_PADDING = {
  top: 8,
  right: 10,
  bottom: 30, // Room for X-axis labels
  left: 40, // Room for Y-axis labels
};

function computeChartArea(widthMm: number, heightMm: number): ChartArea {
  const pxPerMm = 3.7795; // logical pixels per mm
  const totalW = widthMm * pxPerMm;
  const totalH = heightMm * pxPerMm;
  const left = CHART_PADDING.left;
  const top = CHART_PADDING.top;
  const right = totalW - CHART_PADDING.right;
  const bottom = totalH - CHART_PADDING.bottom;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}
```

### 5.4 Axis Drawing

```typescript
interface AxisConfig {
  min: number;
  max: number;
  tickCount: number;
  label: string;
  unit?: string;
  formatTick?: (value: number) => string;
}

function drawYAxis(ctx: CanvasRenderingContext2D, area: ChartArea, config: AxisConfig): void {
  const { min, max, tickCount } = config;
  const range = max - min;

  ctx.strokeStyle = PDF_COLORS.AXIS_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(area.left, area.top);
  ctx.lineTo(area.left, area.bottom);
  ctx.stroke();

  // Ticks and grid lines
  ctx.font = '7px Helvetica, Arial, sans-serif';
  ctx.fillStyle = PDF_COLORS.TEXT_MUTED;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= tickCount; i++) {
    const value = min + (range * i) / tickCount;
    const y = area.bottom - (area.height * i) / tickCount;

    // Grid line
    ctx.strokeStyle = PDF_COLORS.GRID_LINE;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(area.left, y);
    ctx.lineTo(area.right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Tick label
    const label = config.formatTick?.(value) ?? value.toFixed(1);
    ctx.fillText(label, area.left - 4, y);
  }

  // Axis label (rotated)
  ctx.save();
  ctx.translate(8, area.top + area.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.font = '7px Helvetica, Arial, sans-serif';
  ctx.fillStyle = PDF_COLORS.TEXT_MUTED;
  const labelText = config.unit ? `${config.label} (${config.unit})` : config.label;
  ctx.fillText(labelText, 0, 0);
  ctx.restore();
}

function drawXAxis(
  ctx: CanvasRenderingContext2D,
  area: ChartArea,
  labels: string[],
  maxLabels: number = 10,
): void {
  ctx.strokeStyle = PDF_COLORS.AXIS_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(area.left, area.bottom);
  ctx.lineTo(area.right, area.bottom);
  ctx.stroke();

  // Thin out labels if too many
  const step = Math.max(1, Math.ceil(labels.length / maxLabels));
  ctx.font = '6px Helvetica, Arial, sans-serif';
  ctx.fillStyle = PDF_COLORS.TEXT_MUTED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let i = 0; i < labels.length; i += step) {
    const x = area.left + (area.width * i) / (labels.length - 1 || 1);
    // Format date labels: show "Jan 5" from "2024-01-05"
    const dateLabel = formatShortDate(labels[i]!);
    ctx.save();
    ctx.translate(x, area.bottom + 4);
    ctx.rotate(-Math.PI / 6); // 30° tilt
    ctx.fillText(dateLabel, 0, 0);
    ctx.restore();
  }
}

function formatShortDate(isoDate: string): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const [, m, d] = isoDate.split('-');
  return `${months[parseInt(m!, 10) - 1]} ${parseInt(d!, 10)}`;
}
```

---

## 6. Chart Drawing Functions

### 6.1 `drawLineChart` — Line Chart with Optional Fill and Severity Zones

**Used for**: AHI trend, pressure trend, leak trend.

```typescript
interface LineChartSeries {
  data: number[];
  color: string;
  fillColor?: string; // If set, area under line is filled
  lineWidth?: number; // Default: 1.5
  dashed?: boolean; // Dashed line style
  label: string; // Legend label
}

interface SeverityZone {
  yMin: number;
  yMax: number;
  color: string; // Fill color for zone background
  label: string; // e.g., "Normal", "Mild"
}

interface LineChartConfig {
  widthMm: number;
  heightMm: number;
  title: string;
  xLabels: string[]; // ISO date strings
  yAxis: AxisConfig;
  series: LineChartSeries[];
  severityZones?: SeverityZone[]; // Horizontal colored bands
  referenceLines?: { value: number; color: string; label: string; dashed: boolean }[];
}

function drawLineChart(config: LineChartConfig): string {
  const { canvas, ctx } = createChartCanvas(config.widthMm, config.heightMm);
  const area = computeChartArea(config.widthMm, config.heightMm);
  const { min, max } = config.yAxis;
  const range = max - min;

  // 1. Draw severity zone backgrounds
  if (config.severityZones) {
    for (const zone of config.severityZones) {
      const yTop = area.bottom - (area.height * (zone.yMax - min)) / range;
      const yBot = area.bottom - (area.height * (zone.yMin - min)) / range;
      const clampTop = Math.max(area.top, yTop);
      const clampBot = Math.min(area.bottom, yBot);
      ctx.fillStyle = zone.color;
      ctx.fillRect(area.left, clampTop, area.width, clampBot - clampTop);

      // Zone label (right side)
      ctx.font = '6px Helvetica, Arial, sans-serif';
      ctx.fillStyle = PDF_COLORS.TEXT_LIGHT;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(zone.label, area.right - 2, (clampTop + clampBot) / 2);
    }
  }

  // 2. Draw axes and grid
  drawYAxis(ctx, area, config.yAxis);
  drawXAxis(ctx, area, config.xLabels);

  // 3. Draw reference lines (e.g., compliance threshold)
  if (config.referenceLines) {
    for (const ref of config.referenceLines) {
      const y = area.bottom - (area.height * (ref.value - min)) / range;
      ctx.strokeStyle = ref.color;
      ctx.lineWidth = 1;
      if (ref.dashed) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(area.left, y);
      ctx.lineTo(area.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Label
      ctx.font = '6px Helvetica, Arial, sans-serif';
      ctx.fillStyle = ref.color;
      ctx.textAlign = 'left';
      ctx.fillText(ref.label, area.left + 2, y - 3);
    }
  }

  // 4. Draw each data series
  for (const series of config.series) {
    const points: { x: number; y: number }[] = series.data.map((val, i) => ({
      x: area.left + (area.width * i) / (series.data.length - 1 || 1),
      y: area.bottom - (area.height * (val - min)) / range,
    }));

    // Fill area under curve
    if (series.fillColor) {
      ctx.fillStyle = series.fillColor;
      ctx.beginPath();
      ctx.moveTo(points[0]!.x, area.bottom);
      for (const p of points) ctx.lineTo(p.x, p.y);
      ctx.lineTo(points[points.length - 1]!.x, area.bottom);
      ctx.closePath();
      ctx.fill();
    }

    // Draw line
    ctx.strokeStyle = series.color;
    ctx.lineWidth = series.lineWidth ?? 1.5;
    if (series.dashed) ctx.setLineDash([4, 3]);
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 5. Legend (bottom-right inside chart)
  if (config.series.length > 1) {
    const legendX = area.right - 60;
    let legendY = area.top + 4;
    ctx.font = '6px Helvetica, Arial, sans-serif';
    for (const series of config.series) {
      ctx.fillStyle = series.color;
      ctx.fillRect(legendX, legendY - 3, 8, 3);
      ctx.fillStyle = PDF_COLORS.TEXT_BODY;
      ctx.textAlign = 'left';
      ctx.fillText(series.label, legendX + 11, legendY);
      legendY += 8;
    }
  }

  return canvas.toDataURL('image/png');
}
```

### 6.2 `drawBarChart` — Vertical Bar Chart

**Used for**: Usage hours per night, event breakdown.

```typescript
interface BarChartConfig {
  widthMm: number;
  heightMm: number;
  title: string;
  xLabels: string[];
  yAxis: AxisConfig;
  data: number[];
  barColor: string | ((value: number, index: number) => string); // Fixed or per-bar
  referenceLines?: { value: number; color: string; label: string; dashed: boolean }[];
}

function drawBarChart(config: BarChartConfig): string {
  const { canvas, ctx } = createChartCanvas(config.widthMm, config.heightMm);
  const area = computeChartArea(config.widthMm, config.heightMm);
  const { min, max } = config.yAxis;
  const range = max - min;

  // Grid and axes
  drawYAxis(ctx, area, config.yAxis);
  drawXAxis(ctx, area, config.xLabels);

  // Reference lines
  if (config.referenceLines) {
    for (const ref of config.referenceLines) {
      const y = area.bottom - (area.height * (ref.value - min)) / range;
      ctx.strokeStyle = ref.color;
      ctx.lineWidth = 1;
      if (ref.dashed) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(area.left, y);
      ctx.lineTo(area.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '6px Helvetica, Arial, sans-serif';
      ctx.fillStyle = ref.color;
      ctx.textAlign = 'left';
      ctx.fillText(ref.label, area.left + 2, y - 3);
    }
  }

  // Bars
  const barWidth = (area.width / config.data.length) * 0.7;
  const barGap = (area.width / config.data.length) * 0.3;

  for (let i = 0; i < config.data.length; i++) {
    const value = config.data[i]!;
    const barHeight = (area.height * (value - min)) / range;
    const x = area.left + (area.width * i) / config.data.length + barGap / 2;
    const y = area.bottom - barHeight;

    const color =
      typeof config.barColor === 'function' ? config.barColor(value, i) : config.barColor;

    ctx.fillStyle = color;
    // Rounded top corners
    const radius = Math.min(2, barWidth / 2);
    roundedRect(ctx, x, y, barWidth, barHeight, radius, 'top');
    ctx.fill();
  }

  return canvas.toDataURL('image/png');
}

/** Draw a rectangle with selectively rounded corners. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  which: 'top' | 'all' = 'all',
): void {
  ctx.beginPath();
  if (which === 'top') {
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }
  ctx.closePath();
}
```

### 6.3 `drawHorizontalBarChart` — Horizontal Bar Chart

**Used for**: Event breakdown by type.

```typescript
interface HorizontalBarChartConfig {
  widthMm: number;
  heightMm: number;
  title: string;
  categories: string[]; // e.g., ["Obstructive", "Central", ...]
  values: number[];
  barColor: string | string[]; // Single color or per-category
  showValues: boolean; // Show count at end of bar
}

function drawHorizontalBarChart(config: HorizontalBarChartConfig): string {
  const { canvas, ctx } = createChartCanvas(config.widthMm, config.heightMm);
  const pxPerMm = 3.7795;
  const totalW = config.widthMm * pxPerMm;
  const totalH = config.heightMm * pxPerMm;

  const labelWidth = 80; // Logical px reserved for category labels
  const valueMargin = 25; // Logical px for value text on right
  const barAreaLeft = labelWidth;
  const barAreaRight = totalW - valueMargin - 5;
  const barAreaWidth = barAreaRight - barAreaLeft;

  const maxVal = Math.max(...config.values, 1);
  const barHeight = Math.min(12, (totalH - 10) / config.categories.length - 4);
  const barSpacing = (totalH - 10) / config.categories.length;

  for (let i = 0; i < config.categories.length; i++) {
    const y = 6 + i * barSpacing;
    const value = config.values[i] ?? 0;
    const w = (value / maxVal) * barAreaWidth;

    // Category label
    ctx.font = '7px Helvetica, Arial, sans-serif';
    ctx.fillStyle = PDF_COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(config.categories[i]!, labelWidth - 6, y + barHeight / 2);

    // Bar
    const color = Array.isArray(config.barColor)
      ? config.barColor[i % config.barColor.length]!
      : config.barColor;
    ctx.fillStyle = color;
    roundedRect(ctx, barAreaLeft, y, Math.max(w, 1), barHeight, 2, 'all');
    ctx.fill();

    // Value label
    if (config.showValues) {
      ctx.font = '7px Helvetica, Arial, sans-serif';
      ctx.fillStyle = PDF_COLORS.TEXT_BODY;
      ctx.textAlign = 'left';
      ctx.fillText(String(value), barAreaLeft + w + 4, y + barHeight / 2);
    }
  }

  return canvas.toDataURL('image/png');
}
```

### 6.4 `drawStackedAreaChart` — Stacked Area Chart

**Used for**: Event distribution over time.

```typescript
interface StackedAreaChartConfig {
  widthMm: number;
  heightMm: number;
  title: string;
  xLabels: string[];
  yAxis: AxisConfig;
  layers: {
    data: number[];
    color: string;
    fillColor: string;
    label: string;
  }[];
}

function drawStackedAreaChart(config: StackedAreaChartConfig): string {
  const { canvas, ctx } = createChartCanvas(config.widthMm, config.heightMm);
  const area = computeChartArea(config.widthMm, config.heightMm);
  const { min, max } = config.yAxis;
  const range = max - min;

  drawYAxis(ctx, area, config.yAxis);
  drawXAxis(ctx, area, config.xLabels);

  // Compute cumulative stacks (draw back to front)
  const n = config.xLabels.length;
  const cumulative: number[][] = [];
  const zeros = new Array(n).fill(0) as number[];
  let prev = zeros;

  for (const layer of config.layers) {
    const current = layer.data.map((v, i) => (prev[i] ?? 0) + v);
    cumulative.push(current);
    prev = current;
  }

  // Draw layers in reverse order (top layer first for correct overlap)
  for (let li = config.layers.length - 1; li >= 0; li--) {
    const layer = config.layers[li]!;
    const top = cumulative[li]!;
    const bottom = li > 0 ? cumulative[li - 1]! : zeros;

    ctx.fillStyle = layer.fillColor;
    ctx.beginPath();

    // Top edge (left to right)
    for (let i = 0; i < n; i++) {
      const x = area.left + (area.width * i) / (n - 1 || 1);
      const y = area.bottom - (area.height * (top[i]! - min)) / range;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // Bottom edge (right to left)
    for (let i = n - 1; i >= 0; i--) {
      const x = area.left + (area.width * i) / (n - 1 || 1);
      const y = area.bottom - (area.height * (bottom[i]! - min)) / range;
      ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();

    // Outline on top edge
    ctx.strokeStyle = layer.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = area.left + (area.width * i) / (n - 1 || 1);
      const y = area.bottom - (area.height * (top[i]! - min)) / range;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Legend
  let legendY = area.top + 4;
  ctx.font = '6px Helvetica, Arial, sans-serif';
  for (const layer of config.layers) {
    ctx.fillStyle = layer.fillColor;
    ctx.fillRect(area.right - 60, legendY - 3, 8, 3);
    ctx.strokeStyle = layer.color;
    ctx.strokeRect(area.right - 60, legendY - 3, 8, 3);
    ctx.fillStyle = PDF_COLORS.TEXT_BODY;
    ctx.textAlign = 'left';
    ctx.fillText(layer.label, area.right - 49, legendY);
    legendY += 8;
  }

  return canvas.toDataURL('image/png');
}
```

---

## 7. Table Drawing for PDF

### 7.1 Enhanced Table Rendering

```typescript
interface TableConfig {
  headers: string[];
  rows: string[][];
  colWidths: number[]; // mm widths for each column
  colAligns?: ('left' | 'center' | 'right')[];
  zebraStripe?: boolean; // Alternate row backgrounds
  highlightFn?: (row: string[], rowIndex: number) => string | null; // Row bg color
}

function drawTable(
  doc: jsPDF,
  startY: number,
  config: TableConfig,
  pageContext: PageContext,
): number {
  let y = startY;
  const { headers, rows, colWidths, colAligns, zebraStripe, highlightFn } = config;

  // ── Draw header row ──
  function drawHeaderRow(atY: number): number {
    // Header background
    setFillColor(doc, PDF_COLORS.BACKGROUND_CARD);
    doc.rect(LAYOUT.MARGIN_LEFT, atY - 1, LAYOUT.CONTENT_WIDTH, LAYOUT.TABLE_HEADER_HEIGHT, 'F');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    setTextColor(doc, PDF_COLORS.TEXT_SECONDARY);

    let x = LAYOUT.MARGIN_LEFT;
    for (let i = 0; i < headers.length; i++) {
      const align = colAligns?.[i] ?? 'left';
      let textX = x + 2;
      if (align === 'right') textX = x + (colWidths[i] ?? 20) - 2;
      else if (align === 'center') textX = x + (colWidths[i] ?? 20) / 2;
      doc.text(headers[i] ?? '', textX, atY + 3, { align });
      x += colWidths[i] ?? 20;
    }

    // Bottom border
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

  // ── Data rows ──
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');

  for (let ri = 0; ri < rows.length; ri++) {
    // Page break check
    const available = LAYOUT.PAGE_HEIGHT - LAYOUT.MARGIN_BOTTOM - LAYOUT.FOOTER_HEIGHT;
    if (y + LAYOUT.TABLE_ROW_HEIGHT > available) {
      addPageFooter(doc, pageContext);
      doc.addPage();
      pageContext.pageNum += 1;
      addPageHeader(doc, pageContext);
      y = LAYOUT.MARGIN_TOP + LAYOUT.HEADER_HEIGHT + LAYOUT.ELEMENT_GAP;
      y = drawHeaderRow(y); // Repeat headers
    }

    const row = rows[ri]!;

    // Row background
    const highlight = highlightFn?.(row, ri);
    if (highlight) {
      setFillColor(doc, highlight);
      doc.rect(LAYOUT.MARGIN_LEFT, y - 1, LAYOUT.CONTENT_WIDTH, LAYOUT.TABLE_ROW_HEIGHT, 'F');
    } else if (zebraStripe && ri % 2 === 0) {
      setFillColor(doc, PDF_COLORS.BACKGROUND_LIGHT);
      doc.rect(LAYOUT.MARGIN_LEFT, y - 1, LAYOUT.CONTENT_WIDTH, LAYOUT.TABLE_ROW_HEIGHT, 'F');
    }

    setTextColor(doc, PDF_COLORS.TEXT_BODY);
    let x = LAYOUT.MARGIN_LEFT;
    for (let ci = 0; ci < row.length; ci++) {
      const align = colAligns?.[ci] ?? 'left';
      let textX = x + 2;
      if (align === 'right') textX = x + (colWidths[ci] ?? 20) - 2;
      else if (align === 'center') textX = x + (colWidths[ci] ?? 20) / 2;
      doc.text(row[ci] ?? '', textX, y + 2.5, { align });
      x += colWidths[ci] ?? 20;
    }

    y += LAYOUT.TABLE_ROW_HEIGHT;
  }

  return y + LAYOUT.ELEMENT_GAP;
}
```

---

## 8. Template Layouts

### 8.1 Template: Physician Summary (2–3 pages)

#### Page 1: Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│ CPAP Analyzer                                          Page 1 / 3   │
│ CPAP Therapy — Physician Summary                                     │
│ Date Range: 2024-09-17 to 2024-10-15        Generated: 2026-02-12   │
│ ──────────────────────────────────────────────────────────────────── │
│                                                                      │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│ │ Mean AHI │ │ Usage    │ │Compliance│ │Mean Leak │                │
│ │  4.2     │ │ 6.8 hrs  │ │  87%     │ │ 3.1 L/m  │                │
│ │ Normal   │ │ med 7.1  │ │ 26/30    │ │ P95: 8.4 │                │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘                │
│                                                                      │
│ ── AHI Trend ──────────────                                         │
│ ┌────────────────────────────────────────────────────────────┐      │
│ │/// severity zones: green/yellow/orange/red backgrounds ///│      │
│ │                                                            │      │
│ │    ╌╌╌╌    AHI line chart over date range                 │      │
│ │                                                            │      │
│ │  Jan 5  Jan 10  Jan 15  Jan 20  Jan 25  Jan 30            │      │
│ └────────────────────────────────────────────────────────────┘      │
│                                      170mm × 60mm full width        │
│                                                                      │
│ ── Nightly Usage ──────────────                                     │
│ ┌────────────────────────────────────────────────────────────┐      │
│ │                                                            │      │
│ │  ██ ██ ██    bar chart, one bar per night                 │      │
│ │  ██ ██ ██ ██ ── 4hr compliance line (dashed green) ──     │      │
│ │  ██ ██ ██ ██ ██                                           │      │
│ │  Jan 5  Jan 10  Jan 15  Jan 20  Jan 25  Jan 30            │      │
│ └────────────────────────────────────────────────────────────┘      │
│                                      170mm × 60mm full width        │
│                                                                      │
│ ──────────────────────────────────────────────────────────────────── │
│ For informational purposes only.                    CPAP Analyzer    │
└──────────────────────────────────────────────────────────────────────┘
```

**Data mappings — Page 1:**

| Component       | Source fields                              | Details                                  |
| --------------- | ------------------------------------------ | ---------------------------------------- |
| KPI: Mean AHI   | `aggregates.map(a => a.ahi)` → mean        | Subtitle: severity label + color         |
| KPI: Usage      | `aggregates.map(a => a.usageHours)` → mean | Subtitle: median                         |
| KPI: Compliance | `stats.complianceRate * 100`               | Subtitle: `${compliant}/${total} nights` |
| KPI: Mean Leak  | `aggregates.map(a => a.leakMedian)` → mean | Subtitle: `P95: ${avgLeakP95}`           |
| AHI Trend Chart | X: `a.date`, Y: `a.ahi`                    | Line chart, severity zone backgrounds    |
| Usage Bar Chart | X: `a.date`, Y: `a.usageHours`             | Per-bar color: green if ≥4, amber if <4  |

**AHI Trend Chart Config:**

```typescript
const ahiTrendConfig: LineChartConfig = {
  widthMm: 170,
  heightMm: 60,
  title: 'AHI Trend',
  xLabels: aggregates.map((a) => a.date),
  yAxis: {
    min: 0,
    max: Math.max(Math.ceil(Math.max(...aggregates.map((a) => a.ahi)) * 1.1), 10),
    tickCount: 5,
    label: 'AHI',
    unit: 'events/hr',
  },
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
```

**Usage Bar Chart Config:**

```typescript
const usageBarConfig: BarChartConfig = {
  widthMm: 170,
  heightMm: 60,
  title: 'Nightly Usage',
  xLabels: aggregates.map((a) => a.date),
  yAxis: {
    min: 0,
    max: Math.max(Math.ceil(Math.max(...aggregates.map((a) => a.usageHours)) * 1.1), 10),
    tickCount: 5,
    label: 'Usage',
    unit: 'hours',
  },
  data: aggregates.map((a) => a.usageHours),
  barColor: (value) => (value >= 4 ? PDF_COLORS.SEVERITY_NORMAL : PDF_COLORS.SEVERITY_MILD),
  referenceLines: [
    {
      value: 4,
      color: PDF_COLORS.COMPLIANCE_LINE,
      label: '4hr CMS Threshold',
      dashed: true,
    },
  ],
};
```

#### Page 2: Detailed Metrics

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Header]                                               Page 2 / 3   │
│                                                                      │
│ ── Pressure Therapy ──────────────                                  │
│ ┌───────────────────────────────────────────────────────────┐       │
│ │  Line: pressureMean (blue)                                │       │
│ │  Band: pressureP95 (purple fill)                          │       │
│ │  170mm × 55mm                                             │       │
│ └───────────────────────────────────────────────────────────┘       │
│                                                                      │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                             │
│ │Mean Press│ │P95 Press │ │Max Press │                             │
│ │ 10.4     │ │ 12.8     │ │ 14.2     │                             │
│ │ cmH2O    │ │ cmH2O    │ │ cmH2O    │                             │
│ └──────────┘ └──────────┘ └──────────┘                             │
│                                                                      │
│ ── Leak Analysis ──────────────                                     │
│ ┌───────────────────────────────────────────────────────────┐       │
│ │  Line: leakMedian (cyan)                                  │       │
│ │  Band: leakP95 (cyan fill)                                │       │
│ │  170mm × 55mm                                             │       │
│ └───────────────────────────────────────────────────────────┘       │
│                                                                      │
│ ── Event Breakdown ──────────────                                   │
│ ┌───────────────────────────────────────────────────────────┐       │
│ │ Obstructive  ████████████████████  124                    │       │
│ │ Hypopnea     ██████████████  98                           │       │
│ │ Central      ████████  52                                 │       │
│ │ RERA         ██████  34                                   │       │
│ │ Mixed        ███  18                                      │       │
│ │ Flow Limit.  ██  12                                       │       │
│ │              170mm × 50mm                                 │       │
│ └───────────────────────────────────────────────────────────┘       │
│                                                                      │
│ ── Compliance ──────────────                                        │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐               │
│ │Compliance│ │Compliant │ │Non-Compl.│ │CMS Status│               │
│ │  87%     │ │  26      │ │  4       │ │  MET ✓   │               │
│ │ Rate     │ │ nights   │ │ nights   │ │ 70% req  │               │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘               │
│                                                                      │
│ [Footer]                                                             │
└──────────────────────────────────────────────────────────────────────┘
```

**Data mappings — Page 2:**

| Component       | Source fields                                                        | Details                                |
| --------------- | -------------------------------------------------------------------- | -------------------------------------- |
| Pressure Chart  | X: `a.date`, Y1: `a.pressureMean`, Y2: `a.pressureP95`               | Line: mean. Fill band: mean to P95     |
| Pressure KPIs   | Mean of `pressureMean`, mean of `pressureP95`, mean of `pressureMax` | 3-card row                             |
| Leak Chart      | X: `a.date`, Y1: `a.leakMedian`, Y2: `a.leakP95`                     | Line: median. Fill band: median to P95 |
| Event Bar Chart | `eventsByType` summed across all aggregates                          | Horizontal bars, sorted by count desc  |
| Compliance KPIs | `complianceRate`, `compliantNights`, `nonCompliantNights`            | CMS check: rate ≥ 0.7                  |

**Pressure Chart Config:**

```typescript
const pressureChartConfig: LineChartConfig = {
  widthMm: 170,
  heightMm: 55,
  title: 'Therapy Pressure',
  xLabels: aggregates.map((a) => a.date),
  yAxis: {
    min: Math.max(0, Math.floor(Math.min(...aggregates.map((a) => a.pressureMean)) - 1)),
    max: Math.ceil(Math.max(...aggregates.map((a) => a.pressureP95)) + 1),
    tickCount: 5,
    label: 'Pressure',
    unit: 'cmH2O',
  },
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
```

**Leak Chart Config:**

```typescript
const leakChartConfig: LineChartConfig = {
  widthMm: 170,
  heightMm: 55,
  title: 'Leak Rate',
  xLabels: aggregates.map((a) => a.date),
  yAxis: {
    min: 0,
    max: Math.max(Math.ceil(Math.max(...aggregates.map((a) => a.leakP95)) * 1.1), 20),
    tickCount: 5,
    label: 'Leak',
    unit: 'L/min',
  },
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
```

**Event Breakdown Config:**

```typescript
// Sum events across all aggregates, sort descending
const eventTotals = sumEventsByType(aggregates);
const sortedEvents = Object.entries(eventTotals)
  .sort(([, a], [, b]) => b - a)
  .filter(([, v]) => v > 0);

const eventBreakdownConfig: HorizontalBarChartConfig = {
  widthMm: 170,
  heightMm: Math.max(30, sortedEvents.length * 8 + 10),
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
```

#### Page 3: Session Data Table

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Header]                                               Page 3 / 3   │
│                                                                      │
│ ── Nightly Session Data ──────────────                              │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Date       AHI   OA   CA  Hyp  Leak  P95Lk Press  Usage  Comp │ │
│ │ ───────────────────────────────────────────────────────────────  │ │
│ │ 2024-09-17  3.2  1.0  0.5  1.7  2.1   6.3  10.2   7.5   ✓    │ │
│ │ 2024-09-18  4.8  2.1  0.3  2.4  3.4   9.1  11.0   6.2   ✓    │ │
│ │ 2024-09-19  2.1  0.8  0.0  1.3  1.8   5.2   9.8   8.0   ✓    │ │
│ │ ...                                                             │ │
│ │ (zebra striping, auto-paginates with header repeat)             │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ [Footer]                                                             │
└──────────────────────────────────────────────────────────────────────┘
```

**Table column spec:**

| Column    | Width (mm) | Align  | Source field       | Format                                                 |
| --------- | ---------- | ------ | ------------------ | ------------------------------------------------------ |
| Date      | 22         | left   | `date`             | `YYYY-MM-DD`                                           |
| AHI       | 14         | right  | `ahi`              | `0.1`                                                  |
| OA        | 12         | right  | `ahiObstructive`   | `0.1`                                                  |
| CA        | 12         | right  | `ahiCentral`       | `0.1`                                                  |
| Hyp       | 12         | right  | `ahiHypopnea`      | `0.1`                                                  |
| Leak      | 14         | right  | `leakMedian`       | `0.1`                                                  |
| P95 Lk    | 14         | right  | `leakP95`          | `0.1`                                                  |
| Press     | 14         | right  | `pressureMean`     | `0.1`                                                  |
| P95 Pr    | 14         | right  | `pressureP95`      | `0.1`                                                  |
| Usage     | 14         | right  | `usageHours`       | `0.1`                                                  |
| Comp      | 14         | center | `complianceStatus` | `✓` / `✗` / `~`                                        |
| **Total** | **156**    |        |                    | _(fits within 170mm content area with 14mm remaining)_ |

**Row highlighting:**

- Non-compliant nights: background `#fee2e2` (faint red)
- AHI ≥ 15 (moderate/severe): background `#fef9c3` (faint yellow)

---

### 8.2 Template: Full Analysis (4–6 pages)

Includes everything from Physician Summary, plus the following additional pages/sections:

#### Additional Page: Event Distribution Over Time

```
── Event Distribution Over Time ──────────────
┌───────────────────────────────────────────────────────────────┐
│  Stacked area chart                                           │
│  Layers (bottom to top):                                      │
│    - Obstructive (blue)                                       │
│    - Hypopnea (purple)                                        │
│    - Central (cyan)                                           │
│    - Mixed (emerald)                                          │
│    - RERA (orange)                                            │
│  170mm × 65mm                                                 │
└───────────────────────────────────────────────────────────────┘
```

**Config:**

```typescript
const eventDistConfig: StackedAreaChartConfig = {
  widthMm: 170,
  heightMm: 65,
  title: 'Event Distribution Over Time',
  xLabels: aggregates.map((a) => a.date),
  yAxis: {
    min: 0,
    max: computeStackMax(aggregates),
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
```

#### Additional Section: Machine Settings Summary

Rendered as a bordered card below the event distribution chart.

```
── Machine Settings ──────────────
┌──────────────────────────────────────────────┐
│  Therapy Mode:    APAP                        │
│  Pressure Range:  6.0 – 16.0 cmH2O           │
│  EPR Level:       3                           │
│  EPR Type:        Ramp Only                   │
│  Ramp Time:       Auto                        │
│  Mask Type:       Full Face                   │
│  Humidifier:      Level 6                     │
│  Climate Control: On                          │
│  SmartStart:      On                          │
└──────────────────────────────────────────────┘
```

**Data source**: `aggregates[0]?.configuredMinPressure`, `configuredMaxPressure`, `eprLevel` for per-aggregate fields. For fuller settings, look up the `Session.machineSettings` via the `sessionId` foreign key on the first aggregate. If machine settings are null, omit section.

**Rendering**: Uses `addMetricLine` inside a rounded-rect bordered card. Card width: 110mm, centered.

#### Additional Section: Statistical Summary Table

```
── Statistical Summary ──────────────
┌────────────────────────────────────────────────────────────────────┐
│ Metric         Min    Q1     Median  Mean    Q3     Max    Std    │
│ ───────────────────────────────────────────────────────────────── │
│ AHI            0.3    2.1    3.8     4.2     5.9    14.2   2.8   │
│ Usage (hrs)    2.1    5.5    7.1     6.8     8.2    9.4    1.7   │
│ Leak (L/min)   0.4    1.8    3.1     3.4     4.7    12.3   2.1   │
│ Press (cmH2O)  8.0    9.6    10.4    10.5    11.2   14.2   1.3   │
│ P95 Press      9.2    11.4   12.8    12.9    14.0   16.0   1.5   │
│ SpO2 (%)       88     93     95      94.8    96     98     1.6   │
└────────────────────────────────────────────────────────────────────┘
```

**Computation**: For each metric array, compute:

- `min`, `max`: `Math.min/max(...values)`
- `q1`: 25th percentile
- `median`: 50th percentile
- `q3`: 75th percentile
- `mean`: arithmetic mean
- `stdDev`: sample standard deviation

```typescript
function computeDescriptiveStats(values: number[]): {
  min: number;
  q1: number;
  median: number;
  mean: number;
  q3: number;
  max: number;
  stdDev: number;
} {
  if (values.length === 0) return { min: 0, q1: 0, median: 0, mean: 0, q3: 0, max: 0, stdDev: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1 || 1);
  return {
    min: sorted[0]!,
    q1: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    mean,
    q3: percentile(sorted, 0.75),
    max: sorted[n - 1]!,
    stdDev: Math.sqrt(variance),
  };
}

function percentile(sorted: number[], p: number): number {
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}
```

**Metrics to compute:**

| Row label       | Source field                | Unit      |
| --------------- | --------------------------- | --------- |
| AHI             | `a.ahi`                     | events/hr |
| Usage           | `a.usageHours`              | hours     |
| Leak (Median)   | `a.leakMedian`              | L/min     |
| Leak (P95)      | `a.leakP95`                 | L/min     |
| Pressure (Mean) | `a.pressureMean`            | cmH2O     |
| Pressure (P95)  | `a.pressureP95`             | cmH2O     |
| SpO2            | `a.spo2Mean` (filter nulls) | %         |

#### Additional Section: Usage Patterns Analysis

```
── Usage Patterns ──────────────

  ┌────────────────────────────┐  ┌────────────────────────────┐
  │  Usage Distribution        │  │  AHI vs. Usage Scatter     │
  │  Histogram                 │  │                            │
  │  X: hours, Y: # of nights │  │  X: usage hrs, Y: AHI      │
  │  82mm × 50mm               │  │  82mm × 50mm               │
  └────────────────────────────┘  └────────────────────────────┘

  Nights ≥ 4 hours: 26 (86.7%)
  Nights ≥ 6 hours: 22 (73.3%)
  Nights ≥ 8 hours: 12 (40.0%)

── Correlation Highlights ──────────────
  AHI ↔ Usage:    r = -0.32 (weak negative)
  AHI ↔ Leak:     r = +0.45 (moderate positive)
  Leak ↔ Pressure: r = +0.28 (weak positive)
```

**Usage Distribution Histogram Config:**

```typescript
// Binning: 0–1, 1–2, ..., up to max
function computeHistogramBins(
  values: number[],
  binWidth: number = 1,
): {
  labels: string[];
  counts: number[];
} {
  const max = Math.ceil(Math.max(...values));
  const bins = Math.ceil(max / binWidth);
  const counts = new Array(bins).fill(0) as number[];
  for (const v of values) {
    const idx = Math.min(Math.floor(v / binWidth), bins - 1);
    counts[idx]!++;
  }
  const labels = Array.from(
    { length: bins },
    (_, i) => `${(i * binWidth).toFixed(0)}–${((i + 1) * binWidth).toFixed(0)}`,
  );
  return { labels, counts };
}

const { labels: histLabels, counts: histCounts } = computeHistogramBins(
  aggregates.map((a) => a.usageHours),
  1,
);

const usageHistConfig: BarChartConfig = {
  widthMm: 82,
  heightMm: 50,
  title: 'Usage Distribution',
  xLabels: histLabels,
  yAxis: {
    min: 0,
    max: Math.max(...histCounts) + 1,
    tickCount: 4,
    label: 'Nights',
    unit: 'count',
  },
  data: histCounts,
  barColor: PDF_COLORS.CHART_BLUE,
};
```

**Correlation Computation:**

```typescript
function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0,
    denX = 0,
    denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function interpretCorrelation(r: number): string {
  const abs = Math.abs(r);
  const dir = r >= 0 ? 'positive' : 'negative';
  if (abs < 0.2) return `negligible ${dir}`;
  if (abs < 0.4) return `weak ${dir}`;
  if (abs < 0.6) return `moderate ${dir}`;
  if (abs < 0.8) return `strong ${dir}`;
  return `very strong ${dir}`;
}
```

---

### 8.3 Template: Custom

The custom template assembles pages dynamically from whichever `ReportSections` flags are enabled. The rendering pipeline iterates sections in this order:

1. `summaryStatistics` → KPI cards row
2. `ahiTrend` → AHI trend line chart (full-width)
3. `complianceReport` → Usage bar chart + compliance KPI cards
4. `pressureMetrics` → Pressure trend chart + pressure KPI cards
5. `leakAnalysis` → Leak trend chart
6. `eventBreakdown` → Horizontal event bar chart
7. `usagePatterns` → Usage histogram + correlation text
8. `sessionDetails` → Full nightly data table

Each section calls `ensureSpace()` before rendering. Sections are vertically stacked with `SECTION_GAP` between them.

---

## 9. Extended `ReportStatistics` Type

The current `ReportStatistics` interface must be extended:

```typescript
export interface ReportStatistics {
  // ── Existing fields ──
  totalSessions: number;
  dateRange: { start: string; end: string };
  meanAHI: number;
  medianAHI: number;
  minAHI: number;
  maxAHI: number;
  meanLeak: number;
  meanPressure: number;
  meanUsageHours: number;
  totalUsageHours: number;
  complianceRate: number;
  compliantNights: number;
  nonCompliantNights: number;

  // ── New fields for enhanced reports ──
  medianUsageHours: number;
  meanLeakP95: number;
  meanPressureP95: number;
  meanPressureMax: number;
  meanLeakMax: number;
  meanLeakDurationMinutes: number;

  // Descriptive stats per metric
  descriptive: {
    ahi: DescriptiveStats;
    usageHours: DescriptiveStats;
    leakMedian: DescriptiveStats;
    leakP95: DescriptiveStats;
    pressureMean: DescriptiveStats;
    pressureP95: DescriptiveStats;
    spo2Mean: DescriptiveStats | null; // null if no SpO2 data
  };

  // Event totals
  eventTotals: {
    obstructive: number;
    central: number;
    mixed: number;
    hypopnea: number;
    rera: number;
    flowLimitation: number;
    largeLeak: number;
    periodicBreathing: number;
  };

  // Correlations
  correlations: {
    ahiVsUsage: number; // Pearson r
    ahiVsLeak: number;
    leakVsPressure: number;
  };

  // Usage tier counts
  nightsAbove4Hours: number;
  nightsAbove6Hours: number;
  nightsAbove8Hours: number;

  // CMS compliance check (30-day window)
  cmsCompliant: boolean;
}

interface DescriptiveStats {
  min: number;
  q1: number;
  median: number;
  mean: number;
  q3: number;
  max: number;
  stdDev: number;
}
```

---

## 10. Implementation File Structure

```
src/services/reports/
├── ReportService.ts          # Main entry points (generatePDF, etc.) — MODIFY
├── types.ts                  # Types and templates — MODIFY (extend ReportStatistics)
├── pdf/
│   ├── PDFBuilder.ts         # Orchestrator: page layout, section sequencing
│   ├── PDFLayout.ts          # Layout constants (LAYOUT object, PageContext)
│   ├── PDFColors.ts          # PDF_COLORS constant, hex-to-RGB helpers
│   ├── PDFTypography.ts      # Font size/weight helpers, heading/body renderers
│   ├── PDFHeader.ts          # Page header and footer renderers
│   ├── PDFKPICards.ts        # KPI card and KPI row renderers
│   ├── PDFTable.ts           # Enhanced table renderer with zebra striping
│   ├── charts/
│   │   ├── ChartCanvas.ts    # createChartCanvas, computeChartArea, helpers
│   │   ├── ChartAxis.ts      # drawXAxis, drawYAxis, formatShortDate
│   │   ├── LineChart.ts      # drawLineChart (with severity zones, reference lines)
│   │   ├── BarChart.ts       # drawBarChart (vertical bars)
│   │   ├── HBarChart.ts      # drawHorizontalBarChart
│   │   ├── StackedArea.ts    # drawStackedAreaChart
│   │   └── index.ts          # Re-exports
│   └── sections/
│       ├── SummarySection.ts     # KPI cards row
│       ├── AHITrendSection.ts    # AHI line chart
│       ├── UsageSection.ts       # Usage bar chart
│       ├── PressureSection.ts    # Pressure chart + KPIs
│       ├── LeakSection.ts        # Leak chart
│       ├── EventSection.ts       # Event breakdown chart
│       ├── ComplianceSection.ts  # Compliance KPIs
│       ├── UsagePatternsSection.ts # Histogram + correlations
│       ├── StatisticsSection.ts  # Descriptive stats table
│       ├── MachineSettingsSection.ts # Machine config card
│       ├── SessionTableSection.ts    # Full nightly data table
│       └── index.ts
└── index.ts                  # Public API re-exports
```

---

## 11. Chart-to-PDF Embedding Workflow

### 11.1 Step-by-Step Process

```typescript
async function addChartToPDF(
  doc: jsPDF,
  x: number,
  y: number,
  widthMm: number,
  heightMm: number,
  chartRenderer: () => string, // Returns data URL
): Promise<void> {
  // 1. Draw chart title above the chart area
  //    (handled by calling code before this function)

  // 2. Render chart to canvas and get PNG data URL
  const dataUrl = chartRenderer();

  // 3. Add image to PDF at the specified position
  doc.addImage(dataUrl, 'PNG', x, y, widthMm, heightMm);
}
```

### 11.2 Image Format

- Format: PNG (lossless, supports transparency if needed)
- Compression: jsPDF handles PNG compression internally
- Resolution: 3× scale ensures ~300 DPI equivalent in the PDF

### 11.3 Memory Considerations

Each full-width chart at 3× scale: `(170 × 3.78 × 3) × (60 × 3.78 × 3) ≈ 1925 × 680 px ≈ 5.2 MB` uncompressed RGBA.

With 4–6 charts per report, peak memory is ~25–30 MB for canvas data. This is acceptable for modern browsers. Each canvas should be discarded (dereferenced) immediately after `toDataURL()` to allow GC.

```typescript
function renderAndEmbed(doc: jsPDF, x: number, y: number, config: LineChartConfig): void {
  const dataUrl = drawLineChart(config);
  doc.addImage(dataUrl, 'PNG', x, y, config.widthMm, config.heightMm);
  // dataUrl string will be GC'd when it leaves scope
}
```

---

## 12. Handling Variable-Length Data

### 12.1 Adaptive Chart X-Axis

| Data range   | X-axis label strategy                   |
| ------------ | --------------------------------------- |
| ≤ 14 days    | Show every date label                   |
| 15–30 days   | Show every 2nd date                     |
| 31–90 days   | Show every 7th date (weekly)            |
| 91–180 days  | Show every 14th date                    |
| 181–365 days | Show monthly labels (1st of each month) |
| > 365 days   | Show quarterly labels                   |

```typescript
function computeXLabelStep(totalDays: number): number {
  if (totalDays <= 14) return 1;
  if (totalDays <= 30) return 2;
  if (totalDays <= 90) return 7;
  if (totalDays <= 180) return 14;
  if (totalDays <= 365) return 30;
  return 90;
}
```

### 12.2 Adaptive Y-Axis Scaling

- AHI: Default max = 10. If actual max exceeds default, scale to `Math.ceil(actualMax * 1.1)`.
- Usage: Default max = 12. Scale up if needed.
- Pressure: Fit range ±1 cmH2O around data min/max.
- Leak: Default max = 25. Scale up if needed.

### 12.3 Long Date Ranges (> 60 days)

When the date range exceeds ~60 data points, line charts become dense. Apply LTTB (Largest Triangle Three Buckets) downsampling to reduce points to ~100 while preserving shape:

```typescript
function lttbDownsample(
  data: { x: number; y: number }[],
  targetPoints: number,
): { x: number; y: number }[] {
  if (data.length <= targetPoints) return data;

  const sampled: { x: number; y: number }[] = [data[0]!];
  const bucketSize = (data.length - 2) / (targetPoints - 2);

  let prevIndex = 0;
  for (let i = 1; i < targetPoints - 1; i++) {
    const rangeStart = Math.floor((i - 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor(i * bucketSize) + 1, data.length - 1);
    const nextRangeStart = Math.floor(i * bucketSize) + 1;
    const nextRangeEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length - 1);

    // Average of next bucket
    let avgX = 0,
      avgY = 0,
      count = 0;
    for (let j = nextRangeStart; j < nextRangeEnd; j++) {
      avgX += data[j]!.x;
      avgY += data[j]!.y;
      count++;
    }
    avgX /= count || 1;
    avgY /= count || 1;

    // Find point in current bucket with largest triangle area
    let maxArea = -1;
    let maxIndex = rangeStart;
    const prev = data[prevIndex]!;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs(
        (prev.x - avgX) * (data[j]!.y - prev.y) - (prev.x - data[j]!.x) * (avgY - prev.y),
      );
      if (area > maxArea) {
        maxArea = area;
        maxIndex = j;
      }
    }

    sampled.push(data[maxIndex]!);
    prevIndex = maxIndex;
  }

  sampled.push(data[data.length - 1]!);
  return sampled;
}
```

### 12.4 Table Pagination

Tables auto-paginate when rows exceed the available page space. Each new page repeats the column headers. See `drawTable` in Section 7.

### 12.5 Empty Data Handling

If `aggregates.length === 0`:

- KPI cards show "N/A" values
- Charts are replaced with a centered text message: "No data available for the selected date range"
- Session data table shows "No sessions found"

---

## 13. Section Rendering Pipeline

### 13.1 Build Pipeline

```typescript
interface SectionRenderer {
  id: keyof ReportSections;
  minHeight: number; // Minimum vertical mm needed (for ensureSpace)
  render: (
    doc: jsPDF,
    y: number,
    aggregates: NightlyAggregate[],
    stats: ReportStatistics,
    context: PageContext,
  ) => number; // Returns new Y position after rendering
}

const SECTION_RENDERERS: SectionRenderer[] = [
  { id: 'summaryStatistics', minHeight: 32, render: renderSummarySection },
  { id: 'ahiTrend', minHeight: 75, render: renderAHITrendSection },
  { id: 'complianceReport', minHeight: 80, render: renderComplianceSection },
  { id: 'pressureMetrics', minHeight: 85, render: renderPressureSection },
  { id: 'leakAnalysis', minHeight: 70, render: renderLeakSection },
  { id: 'eventBreakdown', minHeight: 60, render: renderEventSection },
  { id: 'usagePatterns', minHeight: 70, render: renderUsagePatternsSection },
  { id: 'sessionDetails', minHeight: 40, render: renderSessionTableSection },
];

async function buildEnhancedPDF(
  selection: ReportContentSelection,
  aggregates: NightlyAggregate[],
  stats: ReportStatistics,
): Promise<Blob> {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const context: PageContext = {
    pageNum: 1,
    totalPages: 0, // Calculated after first pass or set to '?' and overwritten
    title: selection.title ?? getTemplateTitle(selection.template),
    dateRange: computeDateRangeString(aggregates, selection.dateRange),
  };

  let y = LAYOUT.MARGIN_TOP;
  addPageHeader(doc, context);
  y = LAYOUT.MARGIN_TOP + LAYOUT.HEADER_HEIGHT + LAYOUT.SECTION_GAP;

  for (const renderer of SECTION_RENDERERS) {
    if (!selection.sections[renderer.id]) continue;

    // Additional sections for full-analysis template only
    // (event distribution, machine settings, statistics)
    // are handled in their respective section renderers

    y = ensureSpace(doc, y, renderer.minHeight, context);
    y = renderer.render(doc, y, aggregates, stats, context);
    y += LAYOUT.SECTION_GAP;
  }

  // Final footer
  addPageFooter(doc, context);

  return doc.output('blob');
}
```

### 13.2 `PageContext` Type

```typescript
interface PageContext {
  pageNum: number;
  totalPages: number;
  title: string;
  dateRange: string;
}
```

---

## 14. Accessibility Notes for PDF

While PDF accessibility is limited compared to HTML, apply these practices:

1. **Document title**: Set via `doc.setProperties({ title: context.title })`.
2. **Logical reading order**: Sections are rendered in document flow order.
3. **Chart alt-text**: Below each chart image, add a small-text descriptive summary:
   ```
   "AHI ranged from 1.2 to 8.4 events/hr (mean 4.2) over 30 days."
   ```
   This is rendered in 7pt italic text, color `#9ca3af`, immediately below the chart.
4. **Table structure**: Column alignment headers help screen readers parse table content.
5. **Color is never the sole indicator**: Severity zones have text labels alongside colored backgrounds. Compliance status uses `✓`/`✗` symbols, not just color.

---

## 15. Implementation Notes for Frontend Agent

### 15.1 Integration Points

- **Entry point**: Modify `generatePDF()` in [ReportService.ts](../src/services/reports/ReportService.ts) to call `buildEnhancedPDF()` instead of the current `buildPDF()`.
- **Backward compatibility**: Keep the old `buildPDF()` as `buildPDFLegacy()` until the new implementation is validated.
- **Types**: Extend `ReportStatistics` in [types.ts](../src/services/reports/types.ts) with the new fields. Extend `computeStatistics()` to populate them.
- **UI**: No changes needed to [Reports.tsx](../src/views/Reports/Reports.tsx) — the same section flags drive the enhanced renderer.

### 15.2 Testing Strategy

- **Unit tests**: Each chart drawing function should be testable with mock canvas (use `jest-canvas-mock` or Vitest equivalent).
- **Snapshot tests**: Generate PDFs from sample data and compare page count, file size consistency.
- **Visual verification**: Generate a PDF with the sample data in `sample-data/` and visually inspect.
- **Edge cases**:
  - 0 aggregates (empty date range)
  - 1 aggregate (single night)
  - 365+ aggregates (downsampling kicks in)
  - All null SpO2 data
  - All compliant / all non-compliant nights

### 15.3 Performance Budget

| Metric                              | Target      |
| ----------------------------------- | ----------- |
| PDF generation time (30 days data)  | < 1 second  |
| PDF generation time (365 days data) | < 3 seconds |
| Peak memory usage                   | < 50 MB     |
| Output file size (3 pages)          | < 500 KB    |
| Output file size (6 pages)          | < 1 MB      |

### 15.4 Dependencies

- `jsPDF` — already installed, no new dependencies needed
- Canvas 2D API — built into browsers, no polyfill needed
- No `html2canvas`, no `jspdf-autotable`, no external chart rendering libraries
