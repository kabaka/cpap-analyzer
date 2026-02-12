/**
 * STL Decomposition panel — four stacked charts showing
 * Observed, Trend, Seasonal, and Residual components.
 *
 * Each sub-panel renders via ThemedLineChart with a synchronised X axis.
 *
 * @module components/charts/d3/STLDecompositionPanel
 */

import React from 'react';
import ThemedLineChart from '../recharts/ThemedLineChart';
import { useChartColors } from '../useChartColors';
import styles from './STLDecompositionPanel.module.css';

// ── Types ────────────────────────────────────────────────────────

export interface STLDataPoint {
  /** Shared X axis value (e.g. date string or numeric index). */
  x: string | number;
  observed: number;
  trend: number;
  seasonal: number;
  residual: number;
}

export interface STLDecompositionPanelProps {
  data: STLDataPoint[];
  /** X axis label (default "Time"). */
  xLabel?: string;
  /** Height per sub-panel (default 120). */
  panelHeight?: number;
}

// ── Constants ────────────────────────────────────────────────────

const PANEL_DEFS: { key: 'observed' | 'trend' | 'seasonal' | 'residual'; label: string }[] = [
  { key: 'observed', label: 'Observed' },
  { key: 'trend', label: 'Trend' },
  { key: 'seasonal', label: 'Seasonal' },
  { key: 'residual', label: 'Residual' },
];

// ── Component ────────────────────────────────────────────────────

const STLDecompositionPanel = React.memo(function STLDecompositionPanel({
  data,
  xLabel = 'Time',
  panelHeight = 120,
}: STLDecompositionPanelProps) {
  const colors = useChartColors();

  if (!data || data.length === 0) {
    return <div className={styles.empty}>No data</div>;
  }

  // Transform data for each sub-panel.
  const panelData = data.map((d) => ({
    x: d.x,
    observed: d.observed,
    trend: d.trend,
    seasonal: d.seasonal,
    residual: d.residual,
  }));

  return (
    <div className={styles.container}>
      {PANEL_DEFS.map((panel, i) => (
        <div key={panel.key} className={styles.panel}>
          <ThemedLineChart
            data={panelData}
            lines={[
              {
                dataKey: panel.key,
                name: panel.label,
                color: [colors.chart1, colors.chart3, colors.chart4, colors.chart5][i],
              },
            ]}
            xKey="x"
            yLabel={panel.label}
            xLabel={i === PANEL_DEFS.length - 1 ? xLabel : undefined}
            height={panelHeight}
            referenceLines={
              panel.key === 'residual'
                ? [{ value: 0, axis: 'y', color: colors.textSecondary, strokeDasharray: '3 3' }]
                : undefined
            }
          />
        </div>
      ))}
    </div>
  );
});

export default STLDecompositionPanel;
