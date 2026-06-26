/**
 * Calendar heatmap — GitHub-contribution-style grid for daily data.
 *
 * Renders one ≤53-column × 7-row week-grid panel per CALENDAR YEAR, stacked
 * vertically (oldest at top → newest at bottom). Each panel's week-column index
 * is relative to its own Jan 1, so all panels left-align into a clean rail. The
 * left gutter holds the year label; weekday labels appear on the top panel only;
 * month labels run along each panel's top band.
 *
 * Empty leading/trailing years are trimmed (the visible span is
 * [firstDataYear, lastDataYear] derived from dates that actually have a datum),
 * while interior empty years are kept — a multi-year therapy gap is meaningful.
 * The first/last panels are clipped to the requested `[rangeStart, rangeEnd]`
 * window so we never draw out-of-window days. This is what collapses an
 * "all time" 2000→today window down to just the years that contain data.
 *
 * Cells use a fixed size (no width-stretch), so short ranges render as a small,
 * neat, left-aligned grid and multi-year ranges stay readable. Panels overflow
 * horizontally on narrow viewports: the gutter (year + weekday labels) stays
 * fixed while the week grid scrolls.
 *
 * Supports two colouring modes:
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
 * The whole calendar is a single tab stop with roving `tabindex` and arrow-key
 * navigation that crosses year-panel boundaries (date arithmetic + a
 * container-scoped lookup); tooltips appear on hover and keyboard focus.
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
  /** Cell size in px (default 13). */
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

// ── Layout constants ─────────────────────────────────────────────
// Fixed cell geometry — no width-stretch. Pitch = cell + gap.
// Cells are a fixed size by design: narrow viewports scroll the week grid
// horizontally (the gutter stays pinned) rather than shrinking cells. A
// responsive step-down (e.g. smaller cells on tablet/mobile via a
// ResizeObserver) could be a future enhancement.
const DEFAULT_CELL_SIZE = 13;
const CELL_GAP = 3;
const CELL_RADIUS = 2;
/** Vertical band above each grid for month labels. */
const TOP_PAD = 20;
/** 7-row weekday block height in px (used to centre the year label). */
const GRID_ROWS = 7;
/**
 * Left-rail width in px. Holds the year label and (top panel only) weekday
 * labels. Mirrors the `--cal-gutter` CSS token so the SVG coordinate space and
 * the flex box agree; the legend's `padding-left` references the same token.
 */
const GUTTER_WIDTH = 36;

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
  /** Week index (column), RELATIVE to this cell's calendar year. */
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

/** One calendar-year grid. */
interface YearPanel {
  year: number;
  cells: Cell[];
  /**
   * Cells bucketed by week-column: index = week-column (0…weeks-1) → that
   * column's cells, in row (day-of-week) order. Precomputed once when the panel
   * is built so render never re-filters `cells` per column (avoids O(weeks ×
   * cells) work on every render, including frequent tooltip-hover re-renders).
   * Empty columns are `[]`.
   */
  weekColumns: Cell[][];
  monthLabels: { label: string; x: number }[];
  /** Number of week-columns in this panel (≤ 53). */
  weeks: number;
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

/**
 * Week-column index of a day RELATIVE to Jan 1 of its own calendar year.
 * Week 0 is the (Sunday-aligned) week containing Jan 1 of `year`.
 */
function weekOfYear(day: Date, year: number): number {
  const jan1 = new Date(year, 0, 1);
  const yearStart = d3.timeWeek.floor(jan1);
  return d3.timeWeek.count(yearStart, day);
}

// ── Component ────────────────────────────────────────────────────

const CalendarHeatmap = React.memo(function CalendarHeatmap({
  data,
  cellSize = DEFAULT_CELL_SIZE,
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

  const pitch = cellSize + CELL_GAP;

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

  const { panels, cells } = useMemo(() => {
    const empty = { panels: [] as YearPanel[], cells: [] as Cell[] };

    // Determine the requested window: explicit range wins, else derive from data.
    let windowStart: Date;
    let windowEnd: Date;
    if (rangeStart && rangeEnd) {
      windowStart = parseISO(rangeStart);
      windowEnd = parseISO(rangeEnd);
      if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) return empty;
    } else {
      if (data.length === 0) return empty;
      const dates = data.map((d) => parseISO(d.date));
      windowStart = d3.min(dates) ?? new Date();
      windowEnd = d3.max(dates) ?? new Date();
    }
    if (windowEnd < windowStart) return empty;

    // Trim empty leading/trailing years: clamp the rendered span to the years
    // that actually contain a datum (value OR partial — gaps don't count), but
    // never outside the requested window. Interior empty years stay.
    let firstDataYear = Infinity;
    let lastDataYear = -Infinity;
    for (const d of data) {
      const dt = parseISO(d.date);
      if (Number.isNaN(dt.getTime())) continue;
      if (dt < windowStart || dt > windowEnd) continue; // datum outside the window
      const y = dt.getFullYear();
      if (y < firstDataYear) firstDataYear = y;
      if (y > lastDataYear) lastDataYear = y;
    }

    let startYear: number;
    let endYear: number;
    if (firstDataYear === Infinity) {
      // No data inside the window — render a single frame for the window's
      // start year so empty/loading states still have a panel (safety net;
      // SessionList routes true all-gaps to its own EmptyState).
      startYear = windowStart.getFullYear();
      endYear = startYear;
    } else {
      startYear = firstDataYear;
      endYear = lastDataYear;
    }

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

    const buildCell = (day: Date, year: number): Cell => {
      const key = ISO_FORMAT(day);
      const x = weekOfYear(day, year);
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
        x,
        y: dayOfWeek,
        fill,
        band,
        actionable,
      };
    };

    const builtPanels: YearPanel[] = [];
    const allCells: Cell[] = [];

    for (let year = startYear; year <= endYear; year++) {
      // The panel's day span: the calendar year, CLIPPED to the requested window.
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31);
      const panelStart = yearStart < windowStart ? windowStart : yearStart;
      const panelEnd = yearEnd > windowEnd ? windowEnd : yearEnd;
      if (panelEnd < panelStart) continue;

      const days = d3.timeDays(panelStart, d3.timeDay.offset(panelEnd, 1));
      const panelCells = days.map((day) => buildCell(day, year));

      // Month labels — first occurrence of each month in this panel.
      const months: { label: string; x: number }[] = [];
      let lastMonth = -1;
      for (const c of panelCells) {
        const m = parseISO(c.date).getMonth();
        if (m !== lastMonth) {
          months.push({ label: MONTH_NAMES[m] ?? '', x: c.x });
          lastMonth = m;
        }
      }

      const maxWeek = panelCells.reduce((acc, c) => Math.max(acc, c.x), 0);
      const weeks = maxWeek + 1;

      // Bucket cells by week-column once. `panelCells` is in chronological
      // order, so each column ends up in row (day-of-week) order — matching the
      // previous per-column filter exactly.
      const weekColumns: Cell[][] = Array.from({ length: weeks }, () => []);
      for (const c of panelCells) {
        weekColumns[c.x]?.push(c);
      }

      builtPanels.push({
        year,
        cells: panelCells,
        weekColumns,
        monthLabels: months,
        weeks,
      });
      allCells.push(...panelCells);
    }

    if (builtPanels.length === 0) return empty;
    return { panels: builtPanels, cells: allCells };
  }, [data, valueMap, minColor, maxColor, colors.chart1, bands, discrete, rangeStart, rangeEnd]);

  // Map of date → cell for O(1) lookup during keyboard nav (spans all panels).
  const cellByDate = useMemo(() => {
    const map = new Map<string, Cell>();
    for (const c of cells) map.set(c.date, c);
    return map;
  }, [cells]);

  // ── Roving focus ──────────────────────────────────────────────
  // The cell holding tabIndex=0: selectedDate if present, else last day with
  // data, else first day. A SINGLE roving tab stop spans ALL panels.
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
  // tabindex update. The container-scoped querySelector finds the cell in
  // whichever panel SVG holds it, so focus crosses year-panel boundaries
  // (e.g. Dec 31 → Jan 1 of the next panel) seamlessly. useLayoutEffect runs
  // synchronously post-commit (before paint), which focuses the target
  // reliably across engines — notably WebKit.
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

  if (panels.length === 0) {
    return <div className={styles.empty}>No data</div>;
  }

  const gridHeight = GRID_ROWS * pitch - CELL_GAP;
  const svgHeight = TOP_PAD + gridHeight;

  const svgAriaLabelFor = (year: number): string =>
    discrete
      ? `${year} nightly ${metricName} calendar; colour indicates severity band — see legend.`
      : `${year} nightly ${metricName} calendar.`;

  /** Render the cell groups for one panel, grouped by week-column for ARIA rows. */
  const renderPanelCells = (panel: YearPanel) =>
    panel.weekColumns.map((weekCells, weekIndex) => {
      if (weekCells.length === 0) return null;
      return (
        <g key={weekIndex} role="row">
          {weekCells.map((cell) => {
            const cx = cell.x * pitch;
            const cy = TOP_PAD + cell.y * pitch;
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
                  rx={CELL_RADIUS}
                  ry={CELL_RADIUS}
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
    });

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.panels}>
        {panels.map((panel, panelIndex) => {
          const isTopPanel = panelIndex === 0;
          const svgWidth = panel.weeks * pitch - CELL_GAP + 1;
          return (
            <div className={styles.panel} key={panel.year}>
              {/* Fixed gutter: year label (+ weekday labels on the top panel). */}
              <svg
                className={styles.gutter}
                width={GUTTER_WIDTH}
                height={svgHeight}
                viewBox={`0 0 ${GUTTER_WIDTH} ${svgHeight}`}
                aria-hidden="true"
              >
                <text className={styles.yearLabel} x={0} y={TOP_PAD + gridHeight / 2}>
                  {panel.year}
                </text>
                {isTopPanel &&
                  DAY_LABELS.map((label, i) =>
                    label ? (
                      <text
                        key={i}
                        className={styles.dayLabel}
                        x={GUTTER_WIDTH - 4}
                        y={TOP_PAD + i * pitch + cellSize / 2}
                      >
                        {label}
                      </text>
                    ) : null,
                  )}
              </svg>

              {/* Scrollable week grid. */}
              <div className={styles.scrollport}>
                <svg
                  className={styles.svg}
                  width={svgWidth}
                  height={svgHeight}
                  viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                  role="grid"
                  aria-label={svgAriaLabelFor(panel.year)}
                >
                  {/* Month labels */}
                  {panel.monthLabels.map((m, i) => (
                    <text
                      key={i}
                      className={styles.monthLabel}
                      x={m.x * pitch}
                      y={TOP_PAD - 6}
                      aria-hidden="true"
                    >
                      {m.label}
                    </text>
                  ))}

                  {renderPanelCells(panel)}
                </svg>
              </div>
            </div>
          );
        })}
      </div>

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
