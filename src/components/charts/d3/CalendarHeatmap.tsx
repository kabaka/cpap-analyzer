/**
 * Calendar heatmap — GitHub-contribution-style grid for daily data.
 *
 * Uses D3 for colour scales and date calculations, React SVG for rendering.
 *
 * @module components/charts/d3/CalendarHeatmap
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useChartColors } from '../useChartColors';
import styles from './CalendarHeatmap.module.css';

// ── Types ────────────────────────────────────────────────────────

export interface CalendarDatum {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  value: number;
}

export interface CalendarHeatmapProps {
  data: CalendarDatum[];
  width?: number;
  /** Cell size in px (default 14). */
  cellSize?: number;
  /** Minimum colour (low value — default surface-tertiary). */
  minColor?: string;
  /** Maximum colour (high value — default chart-1). */
  maxColor?: string;
}

// ── Helpers ──────────────────────────────────────────────────────

const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTH_NAMES = [
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

// ── Component ────────────────────────────────────────────────────

const CalendarHeatmap = React.memo(function CalendarHeatmap({
  data,
  width: widthProp,
  cellSize = 14,
  minColor,
  maxColor,
}: CalendarHeatmapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const colors = useChartColors();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  const valueMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of data) {
      map.set(d.date, d.value);
    }
    return map;
  }, [data]);

  const { cells, monthLabels, weeks, dateRange, colorScale } = useMemo(() => {
    if (data.length === 0) {
      return {
        cells: [],
        monthLabels: [] as { label: string; x: number }[],
        weeks: 0,
        dateRange: null,
        colorScale: d3.scaleLinear<string>(),
      };
    }

    const dates = data.map((d) => new Date(d.date));
    const minDate = d3.min(dates) ?? new Date();
    const maxDate = d3.max(dates) ?? new Date();

    // Align to week boundaries
    const startDate = d3.timeWeek.floor(minDate);
    const endDate = d3.timeWeek.ceil(d3.timeDay.offset(maxDate, 1));

    const allDays = d3.timeDays(startDate, endDate);
    const numWeeks = d3.timeWeek.count(startDate, endDate) + 1;

    const vMin = d3.min(data, (d) => d.value) ?? 0;
    const vMax = d3.max(data, (d) => d.value) ?? 1;

    const cs = d3
      .scaleLinear<string>()
      .domain([vMin, vMax])
      .range([minColor ?? 'var(--color-surface-tertiary)', maxColor ?? colors.chart1])
      .clamp(true);

    const cellData = allDays.map((day) => {
      const key = d3.timeFormat('%Y-%m-%d')(day);
      const weekIndex = d3.timeWeek.count(startDate, day);
      const dayOfWeek = day.getDay();
      return {
        date: key,
        value: valueMap.get(key),
        x: weekIndex,
        y: dayOfWeek,
      };
    });

    // Month labels — first week where a month starts
    const months: { label: string; x: number }[] = [];
    let lastMonth = -1;
    for (const c of cellData) {
      const d = new Date(c.date);
      const m = d.getMonth();
      if (m !== lastMonth) {
        months.push({ label: MONTH_NAMES[m] ?? '', x: c.x });
        lastMonth = m;
      }
    }

    return {
      cells: cellData,
      monthLabels: months,
      weeks: numWeeks,
      dateRange: { start: startDate, end: endDate },
      colorScale: cs,
    };
  }, [data, valueMap, minColor, maxColor, colors.chart1]);

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, date: string, value: number | undefined) => {
      const rect = (e.target as SVGElement).getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      setTooltip({
        x: rect.left - containerRect.left + cellSize / 2,
        y: rect.top - containerRect.top - 4,
        text: `${date}: ${value !== undefined ? value.toFixed(1) : 'No data'}`,
      });
    },
    [cellSize],
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  if (data.length === 0 || !dateRange) {
    return <div className={styles.empty}>No data</div>;
  }

  const leftPad = 32;
  const topPad = 20;
  const svgWidth = widthProp ?? leftPad + weeks * (cellSize + 2) + 8;
  const svgHeight = topPad + 7 * (cellSize + 2) + 8;

  return (
    <div className={styles.container} ref={containerRef}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Day-of-week labels */}
        {DAY_LABELS.map((label, i) =>
          label ? (
            <text
              key={i}
              className={styles.dayLabel}
              x={leftPad - 4}
              y={topPad + i * (cellSize + 2) + cellSize / 2}
            >
              {label}
            </text>
          ) : null,
        )}

        {/* Month labels */}
        {monthLabels.map((m, i) => (
          <text
            key={i}
            className={styles.monthLabel}
            x={leftPad + m.x * (cellSize + 2)}
            y={topPad - 6}
          >
            {m.label}
          </text>
        ))}

        {/* Day cells */}
        {cells.map((cell) => (
          <rect
            key={cell.date}
            className={styles.dayCell}
            x={leftPad + cell.x * (cellSize + 2)}
            y={topPad + cell.y * (cellSize + 2)}
            width={cellSize}
            height={cellSize}
            rx={2}
            ry={2}
            fill={
              cell.value !== undefined ? colorScale(cell.value) : 'var(--color-surface-secondary)'
            }
            onMouseEnter={(e) => handleMouseEnter(e, cell.date, cell.value)}
            onMouseLeave={handleMouseLeave}
          >
            <title>
              {cell.date}: {cell.value !== undefined ? cell.value.toFixed(1) : 'No data'}
            </title>
          </rect>
        ))}
      </svg>

      {tooltip && (
        <div
          className={styles.tooltip}
          style={
            {
              '--tt-x': `${tooltip.x}px`,
              '--tt-y': `${tooltip.y}px`,
            } as React.CSSProperties
          }
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
});

export default CalendarHeatmap;
