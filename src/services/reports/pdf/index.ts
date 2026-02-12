/**
 * Re-exports for the PDF report module.
 *
 * @module services/reports/pdf
 */

export {
  drawLineChart,
  drawBarChart,
  drawHorizontalBarChart,
  drawStackedAreaChart,
} from './charts';

export type {
  LineChartConfig,
  BarChartConfig,
  HorizontalBarChartConfig,
  StackedAreaChartConfig,
  AxisConfig,
  LineChartSeries,
  SeverityZone,
  ReferenceLine,
  StackedAreaLayer,
} from './charts';

export {
  PDF_COLORS,
  LAYOUT,
  hexToRGB,
  setFillColor,
  setTextColor,
  setDrawColor,
  getAHISeverityColor,
  getAHISeverityLabel,
  addPageHeader,
  addPageFooter,
  addSectionHeading,
  addSubsectionHeading,
  ensureSpace,
  drawKPICard,
  drawKPIRow,
  addMetricLine,
  addChart,
  drawTable,
  computeDescriptiveStats,
  pearsonR,
  interpretCorrelation,
  formatEventTypeName,
} from './layout';

export type { PageContext, KPICardData, TableConfig, DescriptiveStats } from './layout';
