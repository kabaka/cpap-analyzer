/**
 * Barrel exports for the chart component library.
 *
 * @module components/charts
 */

// Chart container
export { default as ChartContainer } from './ChartContainer';
export type { ChartContainerProps, TableData } from './ChartContainer';

// Chart colours hook
export { useChartColors, paletteColor } from './useChartColors';
export type { ChartColors } from './useChartColors';

// Recharts themed wrappers
export { ThemedLineChart, ThemedAreaChart, ThemedBarChart, ThemedScatterPlot } from './recharts';
export type {
  ThemedLineChartProps,
  LineConfig,
  ReferenceLineConfig,
  ThemedAreaChartProps,
  AreaConfig,
  ThemedBarChartProps,
  BarConfig,
  ThemedScatterPlotProps,
  ScatterDataPoint,
} from './recharts';

// D3 specialised charts
export {
  BoxPlot,
  ViolinPlot,
  CorrelationHeatmap,
  KaplanMeierCurve,
  QQPlot,
  STLDecompositionPanel,
  CalendarHeatmap,
} from './d3';
export type {
  BoxPlotProps,
  BoxPlotGroup,
  ViolinPlotProps,
  ViolinPlotGroup,
  CorrelationHeatmapProps,
  KaplanMeierCurveProps,
  SurvivalPoint,
  ConfidenceInterval,
  QQPlotProps,
  STLDecompositionPanelProps,
  STLDataPoint,
  CalendarHeatmapProps,
  CalendarDatum,
} from './d3';
