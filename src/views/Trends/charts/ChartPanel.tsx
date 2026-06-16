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
  /**
   * Visible, low-emphasis caption rendered under the chart — use it to qualify
   * what a series means (e.g. that a shaded band is a "typical nightly range",
   * not a 95% confidence interval). Also exposed to screen readers.
   */
  footnote?: ReactNode;
  /**
   * Screen-reader-only summary/data appended after the chart, giving non-visual
   * users the numeric content that the SVG conveys graphically.
   */
  srSummary?: ReactNode;
}

const ChartPanel = React.memo(function ChartPanel({
  title,
  chartHeight,
  children,
  accessibleSummary,
  footnote,
  srSummary,
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
      {footnote && <p className={styles.footnote}>{footnote}</p>}
      {srSummary && <div className={styles.srOnly}>{srSummary}</div>}
    </section>
  );
});

export default ChartPanel;
