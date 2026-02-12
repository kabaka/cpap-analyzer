/**
 * Barrel exports for D3-based specialised chart components.
 *
 * @module components/charts/d3
 */

export { default as BoxPlot } from './BoxPlot';
export type { BoxPlotProps, BoxPlotGroup } from './BoxPlot';

export { default as ViolinPlot } from './ViolinPlot';
export type { ViolinPlotProps, ViolinPlotGroup } from './ViolinPlot';

export { default as CorrelationHeatmap } from './CorrelationHeatmap';
export type { CorrelationHeatmapProps } from './CorrelationHeatmap';

export { default as KaplanMeierCurve } from './KaplanMeierCurve';
export type { KaplanMeierCurveProps, SurvivalPoint, ConfidenceInterval } from './KaplanMeierCurve';

export { default as QQPlot } from './QQPlot';
export type { QQPlotProps } from './QQPlot';

export { default as STLDecompositionPanel } from './STLDecompositionPanel';
export type { STLDecompositionPanelProps, STLDataPoint } from './STLDecompositionPanel';

export { default as CalendarHeatmap } from './CalendarHeatmap';
export type { CalendarHeatmapProps, CalendarDatum } from './CalendarHeatmap';
