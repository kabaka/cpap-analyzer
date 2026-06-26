/**
 * Calendar heatmap — GitHub-contribution-style grid for daily data.
 *
 * Renders a week-columns × weekday-rows calendar where each day is coloured by
 * a metric. Supports two colouring modes:
 *
 * - **Continuous** (default, backward compatible): a `d3.scaleLinear` between
 *   `minColor` and `maxColor`.
 * - **Discrete** (`bands` provided): each day takes the colour of the clinical
 *   band it falls into, mirroring `classifyAhiSeverity`'s "at or above enters
 *   the next band" semantics.
 *
 * Three cell states are visually distinguished with redundant (non-colour)
 * cues so the chart satisfies WCAG 1.4.1:
 *
 * - **value** — a numeric metric for that night.
 * - **partial** — a session exists but the metric is unavailable
 *   (`value === null`). Neutral fill + a centred glyph dot.
 * - **gap** — no session that night (date absent from `data`, but inside the
 *   rendered window). Secondary-surface fill + a dashed outline.
 *
 * The grid is a single tab stop with roving `tabindex` and arrow-key
 * navigation; tooltips appear on hover and keyboard focus.
 *
 * Uses D3 for colour scales and date maths, React SVG for rendering.
 *
 * @module components/charts/d3/CalendarHeatmap
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useChartColors } from '../useChartColors';
import styles from './CalendarHeatmap.module.css';

// ── Types ────────────────────────────────────────────────────────

export interface CalendarDatum {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  /**
   * Metric value. `null` means a session EXISTS that night but the metric is
   * unavailable (e.g. AHI on a too-short recording) — rendered as the PARTIAL
   * state, never as 0. A date entirely ABSENT from `data` is a GAP (no
   * session).
   */
  value: number | null;
}

export interface CalendarBand {
  /** Inclusive lower bound; band covers [min, nextBand.min). */
  min: number;
  /** Cell fill — a CSS color or var(), e.g. 'var(--color-status-mild)'. */
  color: string;
  /** Short legend label, e.g. 'Mild'. */
  label: string;
  /** Spelled-out range for legend/tooltip, e.g. '5–<15'. */
  rangeLabel: string;
}

export interface CalendarHeatmapProps {
  data: CalendarDatum[];
  width?: number;
  /** Cell size in px (default 14). */
  cellSize?: number;
  /** Minimum colour (continuous mode only). */
  minColor?: string;
  /** Maximum colour (continuous mode only). */
  maxColor?: string;
  /**
   * When provided, colour cells by band membership (discrete mode) instead of
   * the linear scale.
   */
  bands?: CalendarBand[];
  /**
   * ISO start of the rendered window. When set together with `rangeEnd`, the
   * FULL window is rendered (days with no datum become gaps) instead of
   * deriving the range from data min/max.
   */
  rangeStart?: string;
  /** ISO end of the rendered window (inclusive). */
  rangeEnd?: string;
  /** Outline this date's cell as "selected". */
  selectedDate?: string;
  /** Legend caption with units, e.g. 'AHI (events/h)'. */
  metricLabel?: string;
  /** Formats a numeric value for the tooltip, e.g. v => `${v.toFixed(1)}`. */
  metricFormatter?: (v: number) => string;
  /** Tooltip text for value===null cells, e.g. 'Short recording — AHI not available'. */
  partialLabel?: string;
  /**
   * Called when a day that HAS a session (value number OR null) is
   * clicked/activated. Not called for gap days.
   */
  onSelectDate?: (date: string) => void;
  /** Show the legend (band swatches + No-data swatch). Default true when `bands` is set. */
  showLegend?: boolean;
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

const ISO_FORMAT = d3.timeFormat('%Y-%m-%d');
const ISO_PARSE = d3.timeParse('%Y-%m-%d');

/** Local-time date for an ISO `YYYY-MM-DD` string (avoids UTC drift). */
function parseISO(date: string): Date {
  return ISO_PARSE(date) ?? new Date(NaN);
}

const CellState = {
  Value: 'value',
  Partial: 'partial',
  Gap: 'gap',
} as const;
type CellStateType = (typeof CellState)[keyof typeof CellState];

interface Cell {
  date: string;
  /** Numeric value for value cells; null for partial; undefined for gaps. */
  value: number | null | undefined;
  state: CellStateType;
  /** Week index (column). */
  x: number;
  /** Day-of-week index 0–6 (row). */
  y: number;
  /** Resolved fill colour. */
  fill: string;
  /** Matched band (discrete value cells only). */
  band: CalendarBand | null;
  /** Whether this cell is actionable (has a session). */
  actionable: boolean;
}

/**
 * Select the band a value belongs to: the LAST band whose `min <= value`.
 * Values below the first band's min fall into the first band. Mirrors
 * `classifyAhiSeverity` boundary semantics ("at or above enters next band").
 */
// eslint-disable-next-line react-refresh/only-export-components
export function selectBand(value: number, bands: CalendarBand[]): CalendarBand | null {
  if (bands.length === 0) return null;
  let match = bands[0] ?? null;
  for (const band of bands) {
    if (value >= band.min) match = band;
  }
  return match;
}

/** Formats an ISO date as a full, human-readable label, e.g. "Wed, Jun 24, 2026". */
function formatFullDate(date: string): string {
  const d = parseISO(date);
  if (Number.isNaN(d.getTime())) return date;
  return d3.timeFormat('%a, %b %-d, %Y')(d);
}

// ── Component ────────────────────────────────────────────────────

const CalendarHeatmap = React.memo(function CalendarHeatmap({
  data,
  width: widthProp,
  cellSize = 14,
  minColor,
  maxColor,
  bands,
  rangeStart,
  rangeEnd,
  selectedDate,
  metricLabel,
  metricFormatter,
  partialLabel,
  onSelectDate,
  showLegend,
}: CalendarHeatmapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const colors = useChartColors();
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    lines: string[];
  } | null>(null);

  const discrete = !!bands && bands.length > 0;
  const showLegendResolved = showLegend ?? discrete;
  const formatValue = useMemo(
    () => metricFormatter ?? ((v: number) => v.toFixed(1)),
    [metricFormatter],
  );
  const metricName = metricLabel ?? 'Value';

  const valueMap = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const d of data) {
      map.set(d.date, d.value);
    }
    return map;
  }, [data]);

  const { cells, monthLabels, weeks } = useMemo(() => {
    const empty = {
      cells: [] as Cell[],
      monthLabels: [] as { label: string; x: number }[],
      weeks: 0,
    };

    // Determine the window: explicit range wins, else derive from data.
    let minDate: Date;
    let maxDate: Date;
    if (rangeStart && rangeEnd) {
      minDate = parseISO(rangeStart);
      maxDate = parseISO(rangeEnd);
      if (Number.isNaN(minDate.getTime()) || Number.isNaN(maxDate.getTime())) return empty;
    } else {
      if (data.length === 0) return empty;
      const dates = data.map((d) => parseISO(d.date));
      minDate = d3.min(dates) ?? new Date();
      maxDate = d3.max(dates) ?? new Date();
    }
    if (maxDate < minDate) return empty;

    // Align to week boundaries (Sunday-start, matching getDay()).
    const startDate = d3.timeWeek.floor(minDate);
    const endDate = d3.timeWeek.ceil(d3.timeDay.offset(maxDate, 1));

    const allDays = d3.timeDays(startDate, endDate);
    const numWeeks = d3.timeWeek.count(startDate, endDate) + 1;

    // Continuous-mode colour scale (only used when not discrete).
    const numericValues = data
      .map((d) => d.value)
      .filter((v): v is number => typeof v === 'number');
    const vMin = d3.min(numericValues) ?? 0;
    const vMax = d3.max(numericValues) ?? 1;
    const colorScale = d3
      .scaleLinear<string>()
      .domain([vMin, vMax])
      .range([minColor ?? 'var(--color-surface-tertiary)', maxColor ?? colors.chart1])
      .clamp(true);

    const cellData: Cell[] = allDays.map((day) => {
      const key = ISO_FORMAT(day);
      const weekIndex = d3.timeWeek.count(startDate, day);
      const dayOfWeek = day.getDay();
      const hasDatum = valueMap.has(key);
      const value = hasDatum ? valueMap.get(key) : undefined;

      let state: CellStateType;
      let fill: string;
      let band: CalendarBand | null = null;
      let actionable: boolean;

      if (!hasDatum) {
        state = CellState.Gap;
        fill = 'var(--color-surface-secondary)';
        actionable = false;
      } else if (value === null || value === undefined) {
        state = CellState.Partial;
        fill = 'var(--color-surface-tertiary)';
        actionable = true;
      } else {
        state = CellState.Value;
        actionable = true;
        if (discrete && bands) {
          band = selectBand(value, bands);
          fill = band?.color ?? 'var(--color-surface-tertiary)';
        } else {
          fill = colorScale(value);
        }
      }

      return {
        date: key,
        value: value ?? (hasDatum ? null : undefined),
        state,
        x: weekIndex,
        y: dayOfWeek,
        fill,
        band,
        actionable,
      };
    });

    // Month labels — first week where a month starts.
    const months: { label: string; x: number }[] = [];
    let lastMonth = -1;
    for (const c of cellData) {
      const d = parseISO(c.date);
      const m = d.getMonth();
      if (m !== lastMonth) {
        months.push({ label: MONTH_NAMES[m] ?? '', x: c.x });
        lastMonth = m;
      }
    }

    return { cells: cellData, monthLabels: months, weeks: numWeeks };
  }, [data, valueMap, minColor, maxColor, colors.chart1, bands, discrete, rangeStart, rangeEnd]);

  // Map of date → cell for O(1) lookup during keyboard nav.
  const cellByDate = useMemo(() => {
    const map = new Map<string, Cell>();
    for (const c of cells) map.set(c.date, c);
    return map;
  }, [cells]);

  // ── Roving focus ──────────────────────────────────────────────
  // The cell holding tabIndex=0: selectedDate if present, else last day with
  // data, else first day.
  const defaultFocusDate = useMemo(() => {
    if (cells.length === 0) return null;
    if (selectedDate && cellByDate.has(selectedDate)) return selectedDate;
    const withData = [...cells].reverse().find((c) => c.state !== CellState.Gap);
    if (withData) return withData.date;
    return cells[0]?.date ?? null;
  }, [cells, cellByDate, selectedDate]);

  const [focusedDate, setFocusedDate] = useState<string | null>(defaultFocusDate);

  // Keep the roving focus target valid when the window/data changes.
  useEffect(() => {
    if (focusedDate === null || !cellByDate.has(focusedDate)) {
      setFocusedDate(defaultFocusDate);
    }
  }, [defaultFocusDate, focusedDate, cellByDate]);

  const activeTabDate = focusedDate ?? defaultFocusDate;

  // Set true when an arrow-key move requests DOM focus, so the layout effect
  // below only steals focus on keyboard navigation — never on mount or when the
  // window/data changes (which also update `focusedDate`).
  const pendingFocusRef = useRef(false);

  const moveFocus = useCallback(
    (fromDate: string, deltaDays: number) => {
      const from = parseISO(fromDate);
      const target = d3.timeDay.offset(from, deltaDays);
      const key = ISO_FORMAT(target);
      const cell = cellByDate.get(key);
      if (!cell) return; // outside the rendered window — stay put.
      pendingFocusRef.current = true;
      setFocusedDate(key);
    },
    [cellByDate],
  );

  // Move DOM focus to the newly active cell AFTER React commits the roving
  // tabindex update. useLayoutEffect runs synchronously post-commit (before
  // paint), which focuses the target reliably across engines — notably WebKit,
  // where the previous requestAnimationFrame-deferred focus() on the SVG <g>
  // raced and was dropped, breaking keyboard navigation.
  useLayoutEffect(() => {
    if (!pendingFocusRef.current || focusedDate == null) return;
    pendingFocusRef.current = false;
    const el = containerRef.current?.querySelector<SVGGElement>(`[data-date="${focusedDate}"]`);
    el?.focus();
  }, [focusedDate]);

  // ── Tooltip helpers ───────────────────────────────────────────
  const tooltipLines = useCallback(
    (cell: Cell): string[] => {
      const line1 = formatFullDate(cell.date);
      let line2: string;
      if (cell.state === CellState.Value && typeof cell.value === 'number') {
        const word = cell.band ? ` · ${cell.band.label}` : '';
        line2 = `${metricName} ${formatValue(cell.value)}${word}`;
      } else if (cell.state === CellState.Partial) {
        line2 = partialLabel ?? `Short recording — ${metricName} not available`;
      } else {
        line2 = 'No recorded session';
      }
      return [line1, line2];
    },
    [metricName, formatValue, partialLabel],
  );

  const showTooltip = useCallback(
    (target: SVGElement, cell: Cell) => {
      const rect = target.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      setTooltip({
        x: rect.left - containerRect.left + cellSize / 2,
        y: rect.top - containerRect.top - 4,
        lines: tooltipLines(cell),
      });
    },
    [cellSize, tooltipLines],
  );

  const hideTooltip = useCallback(() => setTooltip(null), []);

  // ── aria-label per cell ───────────────────────────────────────
  const cellAriaLabel = useCallback(
    (cell: Cell): string => {
      const date = formatFullDate(cell.date);
      if (cell.state === CellState.Value && typeof cell.value === 'number') {
        const word = cell.band ? `, ${cell.band.label}` : '';
        return `${date} — ${metricName} ${formatValue(cell.value)}${word}`;
      }
      if (cell.state === CellState.Partial) {
        return `${date} — short recording, ${metricName} not available`;
      }
      return `${date} — no recorded session`;
    },
    [metricName, formatValue],
  );

  // ── Activation (click / Enter / Space) ────────────────────────
  const activate = useCallback(
    (cell: Cell) => {
      if (cell.actionable) onSelectDate?.(cell.date);
    },
    [onSelectDate],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<SVGGElement>, cell: Cell) => {
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          moveFocus(cell.date, -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          moveFocus(cell.date, 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveFocus(cell.date, -7);
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveFocus(cell.date, 7);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          activate(cell);
          break;
        case 'Escape':
          hideTooltip();
          break;
        default:
          break;
      }
    },
    [moveFocus, activate, hideTooltip],
  );

  // ── "Today" ───────────────────────────────────────────────────
  const todayISO = useMemo(() => ISO_FORMAT(new Date()), []);

  if (cells.length === 0) {
    return <div className={styles.empty}>No data</div>;
  }

  const leftPad = 32;
  const topPad = 20;
  const svgWidth = widthProp ?? leftPad + weeks * (cellSize + 2) + 8;
  const svgHeight = topPad + 7 * (cellSize + 2) + 8;

  const svgAriaLabel = discrete
    ? `Calendar heatmap of nightly ${metricName}; colour indicates severity band — see legend.`
    : `Calendar heatmap of nightly ${metricName}.`;

  return (
    <div className={styles.container} ref={containerRef}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="grid"
        aria-label={svgAriaLabel}
      >
        {/* Day-of-week labels */}
        {DAY_LABELS.map((label, i) =>
          label ? (
            <text
              key={i}
              className={styles.dayLabel}
              x={leftPad - 4}
              y={topPad + i * (cellSize + 2) + cellSize / 2}
              aria-hidden="true"
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
            aria-hidden="true"
          >
            {m.label}
          </text>
        ))}

        {/* Day cells, grouped by week (column) into rows for ARIA. */}
        {Array.from({ length: weeks }, (_, weekIndex) => {
          const weekCells = cells.filter((c) => c.x === weekIndex);
          if (weekCells.length === 0) return null;
          return (
            <g key={weekIndex} role="row">
              {weekCells.map((cell) => {
                const cx = leftPad + cell.x * (cellSize + 2);
                const cy = topPad + cell.y * (cellSize + 2);
                const isFocusTarget = cell.date === activeTabDate;
                const isSelected = !!selectedDate && cell.date === selectedDate;
                const isToday = cell.date === todayISO;
                const groupClass = [
                  styles.cell,
                  cell.state === CellState.Gap ? styles.cellGap : '',
                  cell.state === CellState.Partial ? styles.cellPartial : '',
                  isSelected ? styles.cellSelected : '',
                  isToday ? styles.cellToday : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <g
                    key={cell.date}
                    className={groupClass}
                    data-date={cell.date}
                    data-state={cell.state}
                    role="gridcell"
                    tabIndex={isFocusTarget ? 0 : -1}
                    aria-label={cellAriaLabel(cell)}
                    aria-selected={isSelected || undefined}
                    onMouseEnter={(e) => showTooltip(e.currentTarget, cell)}
                    onMouseLeave={hideTooltip}
                    onFocus={(e) => {
                      setFocusedDate(cell.date);
                      showTooltip(e.currentTarget, cell);
                    }}
                    onBlur={hideTooltip}
                    onClick={() => activate(cell)}
                    onKeyDown={(e) => handleKeyDown(e, cell)}
                  >
                    <rect
                      className={styles.dayCell}
                      x={cx}
                      y={cy}
                      width={cellSize}
                      height={cellSize}
                      rx={2}
                      ry={2}
                      fill={cell.fill}
                    />
                    {cell.state === CellState.Partial && (
                      <circle
                        className={styles.partialGlyph}
                        cx={cx + cellSize / 2}
                        cy={cy + cellSize / 2}
                        r={Math.max(1.5, cellSize * 0.16)}
                        aria-hidden="true"
                      />
                    )}
                    <title>{cellAriaLabel(cell)}</title>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {tooltip && (
        <div
          className={styles.tooltip}
          role="status"
          style={
            {
              '--tt-x': `${tooltip.x}px`,
              '--tt-y': `${tooltip.y}px`,
            } as React.CSSProperties
          }
        >
          {tooltip.lines.map((line, i) => (
            <div key={i} className={i === 0 ? styles.tooltipDate : styles.tooltipDetail}>
              {line}
            </div>
          ))}
        </div>
      )}

      {showLegendResolved && discrete && bands && (
        <div className={styles.legend}>
          {metricLabel && <div className={styles.legendCaption}>{metricLabel}</div>}
          <ul className={styles.legendList} aria-label={`${metricName} legend`}>
            {bands.map((band) => (
              <li key={band.label} className={styles.legendItem}>
                <span
                  className={styles.legendSwatch}
                  style={{ backgroundColor: band.color }}
                  aria-hidden="true"
                />
                <span className={styles.legendText}>
                  <span className={styles.legendLabelStrong}>{band.label}</span>{' '}
                  <span className={styles.legendRange}>{band.rangeLabel}</span>
                </span>
              </li>
            ))}
            <li className={styles.legendItem}>
              <span
                className={`${styles.legendSwatch} ${styles.legendSwatchPartial}`}
                aria-hidden="true"
              >
                <span className={styles.legendSwatchDot} />
              </span>
              <span className={styles.legendText}>
                <span className={styles.legendLabelStrong}>Short recording</span>
              </span>
            </li>
            <li className={styles.legendItem}>
              <span
                className={`${styles.legendSwatch} ${styles.legendSwatchGap}`}
                aria-hidden="true"
              />
              <span className={styles.legendText}>
                <span className={styles.legendLabelStrong}>No data</span>
              </span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
});

export default CalendarHeatmap;
