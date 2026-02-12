/**
 * Responsive chart container with loading, error, and data-table states.
 *
 * Wraps any chart component with a consistent header, action buttons
 * (View as Table / Export PNG), and accessible labelling.
 *
 * @module components/charts/ChartContainer
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import styles from './ChartContainer.module.css';

// ── Public types ─────────────────────────────────────────────────

export interface TableData {
  headers: string[];
  rows: (string | number)[][];
}

export interface ChartContainerProps {
  /** Chart title shown in the header. */
  title: string;
  /** Description for screen readers (aria-label fallback). */
  description?: string;
  /** Show loading skeleton. */
  loading?: boolean;
  /** Error message — replaces chart content when non-null. */
  error?: string | null;
  /** Container height in px (default 400). */
  height?: number;
  /** Chart element */
  children: ReactNode;
  /** Data for the "View as Table" alternative. */
  tableData?: TableData;
  /** Filename prefix for PNG export (without extension). */
  exportFileName?: string;
}

// ── Component ────────────────────────────────────────────────────

function ChartContainer({
  title,
  description,
  loading = false,
  error = null,
  height = 400,
  children,
  tableData,
  exportFileName,
}: ChartContainerProps) {
  const [showTable, setShowTable] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const handleExport = useCallback(async () => {
    const el = bodyRef.current;
    if (!el) return;

    try {
      // Use canvas-based screenshot via the browser-native approach.
      // We create an off-screen canvas and draw the SVG / DOM content.
      const svg = el.querySelector('svg');
      if (!svg) return;

      const svgData = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = img.width * dpr;
        canvas.height = img.height * dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.scale(dpr, dpr);
        ctx.fillStyle = getComputedStyle(document.documentElement)
          .getPropertyValue('--color-surface-primary')
          .trim();
        ctx.fillRect(0, 0, img.width, img.height);
        ctx.drawImage(img, 0, 0);

        canvas.toBlob((blob) => {
          if (!blob) return;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${exportFileName ?? title.replace(/\s+/g, '_')}.png`;
          a.click();
          URL.revokeObjectURL(a.href);
        }, 'image/png');

        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch {
      // Silently fail — export is a convenience feature
    }
  }, [exportFileName, title]);

  const ariaLabel = description ?? title;

  return (
    <div className={styles.container} role="figure" aria-label={ariaLabel}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h3 className={styles.title}>{title}</h3>
          {description && <span className={styles.srOnly}>{description}</span>}
        </div>

        <div className={styles.actions}>
          {tableData && (
            <button
              className={`${styles.iconButton} ${showTable ? styles.iconButtonActive : ''}`}
              onClick={() => setShowTable((prev) => !prev)}
              aria-label={showTable ? 'View as chart' : 'View as table'}
              title={showTable ? 'View as chart' : 'View as table'}
              type="button"
            >
              {showTable ? '📊' : '📋'}
            </button>
          )}

          <button
            className={styles.iconButton}
            onClick={handleExport}
            aria-label="Export chart as PNG"
            title="Export as PNG"
            type="button"
            disabled={loading || !!error || showTable}
          >
            ⬇
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        className={styles.body}
        style={{ '--chart-height': `${height}px` } as React.CSSProperties}
        ref={bodyRef}
      >
        {loading && (
          <div className={styles.skeleton} aria-busy="true">
            <div className={styles.skeletonPulse} />
          </div>
        )}

        {error && !loading && (
          <div className={styles.error} role="alert">
            <span className={styles.errorIcon}>⚠</span>
            <p className={styles.errorMessage}>{error}</p>
          </div>
        )}

        {!loading && !error && showTable && tableData && (
          <div className={styles.tableWrapper}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  {tableData.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && !showTable && children}
      </div>
    </div>
  );
}

export default ChartContainer;
