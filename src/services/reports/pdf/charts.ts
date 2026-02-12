/**
 * Canvas 2D-based chart drawing functions for PDF embedding.
 *
 * Each function creates an off-screen canvas, draws the chart using
 * the Canvas 2D API, and returns a PNG data URL for use with
 * `jsPDF.addImage()`.
 *
 * @module services/reports/pdf/charts
 */

import { PDF_COLORS } from './layout';

// ── Constants ────────────────────────────────────────────────────

/** Scaling factor for crisp PDF rendering (~300 DPI). */
const PDF_CANVAS_SCALE = 3;

/** Logical pixels per mm at 96 DPI. */
const PX_PER_MM = 3.7795;

/** Standard chart padding in logical pixels (before scale). */
const CHART_PADDING = {
  top: 8,
  right: 10,
  bottom: 30,
  left: 40,
};

/** Font family for chart text. */
const FONT = 'Helvetica, Arial, sans-serif';

// ── Types ────────────────────────────────────────────────────────

interface ChartArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface AxisConfig {
  min: number;
  max: number;
  tickCount: number;
  label: string;
  unit?: string;
  formatTick?: (value: number) => string;
}

export interface LineChartSeries {
  data: number[];
  color: string;
  fillColor?: string;
  lineWidth?: number;
  dashed?: boolean;
  label: string;
}

export interface SeverityZone {
  yMin: number;
  yMax: number;
  color: string;
  label: string;
}

export interface ReferenceLine {
  value: number;
  color: string;
  label: string;
  dashed: boolean;
}

export interface LineChartConfig {
  widthMm: number;
  heightMm: number;
  title: string;
  xLabels: string[];
  yAxis: AxisConfig;
  series: LineChartSeries[];
  severityZones?: SeverityZone[];
  referenceLines?: ReferenceLine[];
}

export interface BarChartConfig {
  widthMm: number;
  heightMm: number;
  title: string;
  xLabels: string[];
  yAxis: AxisConfig;
  data: number[];
  barColor: string | ((value: number, index: number) => string);
  referenceLines?: ReferenceLine[];
}

export interface HorizontalBarChartConfig {
  widthMm: number;
  heightMm: number;
  title: string;
  categories: string[];
  values: number[];
  barColor: string | string[];
  showValues: boolean;
}

export interface StackedAreaLayer {
  data: number[];
  color: string;
  fillColor: string;
  label: string;
}

export interface StackedAreaChartConfig {
  widthMm: number;
  heightMm: number;
  title: string;
  xLabels: string[];
  yAxis: AxisConfig;
  layers: StackedAreaLayer[];
}

// ── Canvas helpers ───────────────────────────────────────────────

function createChartCanvas(
  widthMm: number,
  heightMm: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const pixelWidth = Math.round(widthMm * PX_PER_MM * PDF_CANVAS_SCALE);
  const pixelHeight = Math.round(heightMm * PX_PER_MM * PDF_CANVAS_SCALE);

  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // Scale all operations so we draw in logical coordinates
  ctx.scale(PDF_CANVAS_SCALE, PDF_CANVAS_SCALE);

  // White background
  ctx.fillStyle = PDF_COLORS.WHITE;
  ctx.fillRect(0, 0, pixelWidth / PDF_CANVAS_SCALE, pixelHeight / PDF_CANVAS_SCALE);

  return { canvas, ctx };
}

function computeChartArea(widthMm: number, heightMm: number): ChartArea {
  const totalW = widthMm * PX_PER_MM;
  const totalH = heightMm * PX_PER_MM;
  const left = CHART_PADDING.left;
  const top = CHART_PADDING.top;
  const right = totalW - CHART_PADDING.right;
  const bottom = totalH - CHART_PADDING.bottom;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

// ── Short date formatting ────────────────────────────────────────

const MONTH_ABBR = [
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

function formatShortDate(isoDate: string): string {
  const parts = isoDate.split('-');
  const m = parseInt(parts[1] ?? '1', 10);
  const d = parseInt(parts[2] ?? '1', 10);
  return `${MONTH_ABBR[m - 1]} ${d}`;
}

// ── X-axis label step ────────────────────────────────────────────

function computeXLabelStep(totalDays: number): number {
  if (totalDays <= 14) return 1;
  if (totalDays <= 30) return 2;
  if (totalDays <= 90) return 7;
  if (totalDays <= 180) return 14;
  if (totalDays <= 365) return 30;
  return 90;
}

// ── Axis drawing ─────────────────────────────────────────────────

function drawYAxis(ctx: CanvasRenderingContext2D, area: ChartArea, config: AxisConfig): void {
  const { min, max, tickCount } = config;
  const range = max - min || 1;

  // Axis line
  ctx.strokeStyle = PDF_COLORS.AXIS_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(area.left, area.top);
  ctx.lineTo(area.left, area.bottom);
  ctx.stroke();

  // Ticks and grid
  ctx.font = `7px ${FONT}`;
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

    const label = config.formatTick?.(value) ?? value.toFixed(1);
    ctx.fillStyle = PDF_COLORS.TEXT_MUTED;
    ctx.fillText(label, area.left - 4, y);
  }

  // Rotated axis label
  ctx.save();
  ctx.translate(8, area.top + area.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.font = `7px ${FONT}`;
  ctx.fillStyle = PDF_COLORS.TEXT_MUTED;
  const labelText = config.unit ? `${config.label} (${config.unit})` : config.label;
  ctx.fillText(labelText, 0, 0);
  ctx.restore();
}

function drawXAxis(ctx: CanvasRenderingContext2D, area: ChartArea, labels: string[]): void {
  ctx.strokeStyle = PDF_COLORS.AXIS_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(area.left, area.bottom);
  ctx.lineTo(area.right, area.bottom);
  ctx.stroke();

  const step = computeXLabelStep(labels.length);
  ctx.font = `6px ${FONT}`;
  ctx.fillStyle = PDF_COLORS.TEXT_MUTED;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let i = 0; i < labels.length; i += step) {
    const x = area.left + (area.width * i) / (labels.length - 1 || 1);
    const dateLabel = formatShortDate(labels[i] ?? '');
    ctx.save();
    ctx.translate(x, area.bottom + 4);
    ctx.rotate(-Math.PI / 6);
    ctx.fillText(dateLabel, 0, 0);
    ctx.restore();
  }
}

// ── Rounded rect helper ──────────────────────────────────────────

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  which: 'top' | 'all' = 'all',
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (which === 'top') {
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
  }
  ctx.closePath();
}

// ── LTTB downsampling ────────────────────────────────────────────

interface Point {
  x: number;
  y: number;
}

function lttbDownsample(data: Point[], targetPoints: number): Point[] {
  if (data.length <= targetPoints) return data;

  const first = data[0] as Point;
  const sampled: Point[] = [first];
  const bucketSize = (data.length - 2) / (targetPoints - 2);

  let prevIndex = 0;
  for (let i = 1; i < targetPoints - 1; i++) {
    const rangeStart = Math.floor((i - 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor(i * bucketSize) + 1, data.length - 1);
    const nextRangeStart = Math.floor(i * bucketSize) + 1;
    const nextRangeEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length - 1);

    let avgX = 0;
    let avgY = 0;
    let count = 0;
    for (let j = nextRangeStart; j < nextRangeEnd; j++) {
      const pt = data[j] as Point;
      avgX += pt.x;
      avgY += pt.y;
      count++;
    }
    avgX /= count || 1;
    avgY /= count || 1;

    let maxArea = -1;
    let maxIndex = rangeStart;
    const prev = data[prevIndex] as Point;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const dp = data[j] as Point;
      const area = Math.abs((prev.x - avgX) * (dp.y - prev.y) - (prev.x - dp.x) * (avgY - prev.y));
      if (area > maxArea) {
        maxArea = area;
        maxIndex = j;
      }
    }

    sampled.push(data[maxIndex] as Point);
    prevIndex = maxIndex;
  }

  sampled.push(data[data.length - 1] as Point);
  return sampled;
}

/**
 * Downsample a data series if it exceeds the target length.
 * Returns new arrays of values and labels with preserved visual shape.
 */
function downsampleSeries(
  values: number[],
  labels: string[],
  targetPoints: number = 100,
): { values: number[]; labels: string[] } {
  if (values.length <= targetPoints) return { values, labels };

  const points: Point[] = values.map((y, x) => ({ x, y }));
  const sampled = lttbDownsample(points, targetPoints);

  return {
    values: sampled.map((p) => p.y),
    labels: sampled.map((p) => labels[Math.round(p.x)] ?? ''),
  };
}

// ── Chart drawing functions ──────────────────────────────────────

/**
 * Draw a line chart with optional severity zones and reference lines.
 * Returns a PNG data URL.
 */
export function drawLineChart(config: LineChartConfig): string {
  const { canvas, ctx } = createChartCanvas(config.widthMm, config.heightMm);
  const area = computeChartArea(config.widthMm, config.heightMm);
  const { min, max } = config.yAxis;
  const range = max - min || 1;

  // Handle empty data
  const firstSeries = config.series[0];
  if (config.series.length === 0 || !firstSeries || firstSeries.data.length === 0) {
    ctx.font = `9px ${FONT}`;
    ctx.fillStyle = PDF_COLORS.TEXT_MUTED;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data available', (area.left + area.right) / 2, (area.top + area.bottom) / 2);
    return canvas.toDataURL('image/png');
  }

  // 1. Severity zone backgrounds
  if (config.severityZones) {
    for (const zone of config.severityZones) {
      const yTop = area.bottom - (area.height * (Math.min(zone.yMax, max) - min)) / range;
      const yBot = area.bottom - (area.height * (Math.max(zone.yMin, min) - min)) / range;
      const clampTop = Math.max(area.top, yTop);
      const clampBot = Math.min(area.bottom, yBot);
      if (clampBot > clampTop) {
        ctx.fillStyle = zone.color;
        ctx.fillRect(area.left, clampTop, area.width, clampBot - clampTop);

        // Zone label
        ctx.font = `6px ${FONT}`;
        ctx.fillStyle = PDF_COLORS.TEXT_LIGHT;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(zone.label, area.right - 2, (clampTop + clampBot) / 2);
      }
    }
  }

  // 2. Axes and grid
  drawYAxis(ctx, area, config.yAxis);
  drawXAxis(ctx, area, config.xLabels);

  // 3. Reference lines
  if (config.referenceLines) {
    for (const ref of config.referenceLines) {
      const y = area.bottom - (area.height * (ref.value - min)) / range;
      if (y >= area.top && y <= area.bottom) {
        ctx.strokeStyle = ref.color;
        ctx.lineWidth = 1;
        if (ref.dashed) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(area.left, y);
        ctx.lineTo(area.right, y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = `6px ${FONT}`;
        ctx.fillStyle = ref.color;
        ctx.textAlign = 'left';
        ctx.fillText(ref.label, area.left + 2, y - 3);
      }
    }
  }

  // 4. Data series
  for (const series of config.series) {
    // Downsample if needed
    const { values: dsValues, labels: dsLabels } = downsampleSeries(
      series.data,
      config.xLabels,
      100,
    );
    void dsLabels; // labels are only used for x-axis (already drawn)

    const dataLen = dsValues.length;
    const points = dsValues.map((val, i) => ({
      x: area.left + (area.width * i) / (dataLen - 1 || 1),
      y: area.bottom - (area.height * (Math.min(Math.max(val, min), max) - min)) / range,
    }));

    // Fill area under curve
    if (series.fillColor && points.length > 0) {
      ctx.fillStyle = series.fillColor;
      ctx.beginPath();
      ctx.moveTo((points[0] as Point).x, area.bottom);
      for (const p of points) ctx.lineTo(p.x, p.y);
      ctx.lineTo((points[points.length - 1] as Point).x, area.bottom);
      ctx.closePath();
      ctx.fill();
    }

    // Draw line
    if (points.length > 0) {
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
  }

  // 5. Legend (if multiple series)
  if (config.series.length > 1) {
    const legendX = area.right - 60;
    let legendY = area.top + 4;
    ctx.font = `6px ${FONT}`;
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

/**
 * Draw a vertical bar chart with optional reference lines.
 * Returns a PNG data URL.
 */
export function drawBarChart(config: BarChartConfig): string {
  const { canvas, ctx } = createChartCanvas(config.widthMm, config.heightMm);
  const area = computeChartArea(config.widthMm, config.heightMm);
  const { min, max } = config.yAxis;
  const range = max - min || 1;

  if (config.data.length === 0) {
    ctx.font = `9px ${FONT}`;
    ctx.fillStyle = PDF_COLORS.TEXT_MUTED;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data available', (area.left + area.right) / 2, (area.top + area.bottom) / 2);
    return canvas.toDataURL('image/png');
  }

  // Downsample if needed
  const { values: dsData, labels: dsLabels } = downsampleSeries(config.data, config.xLabels, 100);

  // Grid and axes
  drawYAxis(ctx, area, config.yAxis);
  drawXAxis(ctx, area, dsLabels);

  // Reference lines
  if (config.referenceLines) {
    for (const ref of config.referenceLines) {
      const y = area.bottom - (area.height * (ref.value - min)) / range;
      if (y >= area.top && y <= area.bottom) {
        ctx.strokeStyle = ref.color;
        ctx.lineWidth = 1;
        if (ref.dashed) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(area.left, y);
        ctx.lineTo(area.right, y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = `6px ${FONT}`;
        ctx.fillStyle = ref.color;
        ctx.textAlign = 'left';
        ctx.fillText(ref.label, area.left + 2, y - 3);
      }
    }
  }

  // Bars
  const barWidth = (area.width / dsData.length) * 0.7;
  const barGap = (area.width / dsData.length) * 0.3;

  for (let i = 0; i < dsData.length; i++) {
    const value = dsData[i] ?? 0;
    const barHeight = Math.max(0, (area.height * (value - min)) / range);
    const x = area.left + (area.width * i) / dsData.length + barGap / 2;
    const y = area.bottom - barHeight;

    const color =
      typeof config.barColor === 'function' ? config.barColor(value, i) : config.barColor;

    ctx.fillStyle = color;
    const radius = Math.min(2, barWidth / 2);
    roundedRect(ctx, x, y, barWidth, barHeight, radius, 'top');
    ctx.fill();
  }

  return canvas.toDataURL('image/png');
}

/**
 * Draw a horizontal bar chart.
 * Returns a PNG data URL.
 */
export function drawHorizontalBarChart(config: HorizontalBarChartConfig): string {
  const { canvas, ctx } = createChartCanvas(config.widthMm, config.heightMm);
  const totalW = config.widthMm * PX_PER_MM;
  const totalH = config.heightMm * PX_PER_MM;

  if (config.categories.length === 0) {
    ctx.font = `9px ${FONT}`;
    ctx.fillStyle = PDF_COLORS.TEXT_MUTED;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data available', totalW / 2, totalH / 2);
    return canvas.toDataURL('image/png');
  }

  const labelWidth = 80;
  const valueMargin = 25;
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
    ctx.font = `7px ${FONT}`;
    ctx.fillStyle = PDF_COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(config.categories[i] ?? '', labelWidth - 6, y + barHeight / 2);

    // Bar
    const color = Array.isArray(config.barColor)
      ? (config.barColor[i % config.barColor.length] ?? config.barColor[0] ?? '#888')
      : config.barColor;
    ctx.fillStyle = color;
    roundedRect(ctx, barAreaLeft, y, Math.max(w, 1), barHeight, 2, 'all');
    ctx.fill();

    // Value label
    if (config.showValues) {
      ctx.font = `7px ${FONT}`;
      ctx.fillStyle = PDF_COLORS.TEXT_BODY;
      ctx.textAlign = 'left';
      ctx.fillText(String(value), barAreaLeft + w + 4, y + barHeight / 2);
    }
  }

  return canvas.toDataURL('image/png');
}

/**
 * Draw a stacked area chart.
 * Returns a PNG data URL.
 */
export function drawStackedAreaChart(config: StackedAreaChartConfig): string {
  const { canvas, ctx } = createChartCanvas(config.widthMm, config.heightMm);
  const area = computeChartArea(config.widthMm, config.heightMm);
  const { min, max } = config.yAxis;
  const range = max - min || 1;
  const n = config.xLabels.length;

  if (n === 0 || config.layers.length === 0) {
    ctx.font = `9px ${FONT}`;
    ctx.fillStyle = PDF_COLORS.TEXT_MUTED;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data available', (area.left + area.right) / 2, (area.top + area.bottom) / 2);
    return canvas.toDataURL('image/png');
  }

  drawYAxis(ctx, area, config.yAxis);
  drawXAxis(ctx, area, config.xLabels);

  // Compute cumulative stacks
  const zeros = new Array<number>(n).fill(0);
  const cumulative: number[][] = [];
  let prev = zeros;

  for (const layer of config.layers) {
    const current = layer.data.map((v, i) => (prev[i] ?? 0) + v);
    cumulative.push(current);
    prev = current;
  }

  // Draw layers in reverse (topmost first)
  for (let li = config.layers.length - 1; li >= 0; li--) {
    const layer = config.layers[li] as (typeof config.layers)[number];
    const top = cumulative[li] as number[];
    const bottom = li > 0 ? (cumulative[li - 1] as number[]) : zeros;

    ctx.fillStyle = layer.fillColor;
    ctx.beginPath();

    // Top edge (left to right)
    for (let i = 0; i < n; i++) {
      const x = area.left + (area.width * i) / (n - 1 || 1);
      const y = area.bottom - (area.height * ((top[i] ?? 0) - min)) / range;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // Bottom edge (right to left)
    for (let i = n - 1; i >= 0; i--) {
      const x = area.left + (area.width * i) / (n - 1 || 1);
      const y = area.bottom - (area.height * ((bottom[i] ?? 0) - min)) / range;
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
      const y = area.bottom - (area.height * ((top[i] ?? 0) - min)) / range;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Legend
  let legendY = area.top + 4;
  ctx.font = `6px ${FONT}`;
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
