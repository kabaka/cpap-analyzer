/**
 * ChartPanel — lightweight wrapper for each trend chart.
 *
 * Provides a title bar, accessible labelling, and consistent sizing.
 *
 * @module views/Trends/charts/ChartPanel
 */

import React, { type ReactNode } from 'react';
import styles from './ChartPanel.module.css';

interface ChartPanelProps {
  title: string;
  chartHeight: number;
  children: ReactNode;
  accessibleSummary?: string;
}

const ChartPanel = React.memo(function ChartPanel({
  title,
  chartHeight,
  children,
  accessibleSummary,
}: ChartPanelProps) {
  return (
    <section
      className={styles.panel}
      role="figure"
      aria-label={accessibleSummary ?? `${title} chart`}
    >
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
      </div>
      <div className={styles.chartArea} style={{ height: chartHeight }}>
        {children}
      </div>
    </section>
  );
});

export default ChartPanel;
