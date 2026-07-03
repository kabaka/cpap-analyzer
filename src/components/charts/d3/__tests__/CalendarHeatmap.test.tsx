import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@test/test-utils';
import CalendarHeatmap, {
  selectBand,
  type CalendarBand,
  type CalendarDatum,
} from '../CalendarHeatmap';

// Make useChartColors deterministic (and independent of jsdom CSS resolution).
vi.mock('../../useChartColors', () => ({
  useChartColors: () => ({ chart1: '#123456' }),
}));

const BANDS: CalendarBand[] = [
  { min: 0, color: 'var(--color-status-normal)', label: 'Normal', rangeLabel: '<5' },
  { min: 5, color: 'var(--color-status-mild)', label: 'Mild', rangeLabel: '5–<15' },
  { min: 15, color: 'var(--color-status-moderate)', label: 'Moderate', rangeLabel: '15–<30' },
  { min: 30, color: 'var(--color-status-severe)', label: 'Severe', rangeLabel: '≥30' },
];

/** Find the gridcell <g> for an ISO date. */
function cellFor(date: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-date="${date}"]`);
  if (!el) throw new Error(`No cell rendered for ${date}`);
  return el;
}

describe('CalendarHeatmap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('selectBand (band membership)', () => {
    it('picks the last band whose min <= value (boundary enters next band)', () => {
      expect(selectBand(0, BANDS)?.label).toBe('Normal');
      expect(selectBand(4.9, BANDS)?.label).toBe('Normal');
      // Boundary values: at-or-above enters the next band.
      expect(selectBand(5, BANDS)?.label).toBe('Mild');
      expect(selectBand(14.99, BANDS)?.label).toBe('Mild');
      expect(selectBand(15, BANDS)?.label).toBe('Moderate');
      expect(selectBand(30, BANDS)?.label).toBe('Severe');
      expect(selectBand(120, BANDS)?.label).toBe('Severe');
    });

    it('falls into the first band for values below the first min', () => {
      const shifted: CalendarBand[] = [
        { min: 5, color: 'a', label: 'Low', rangeLabel: '5+' },
        { min: 10, color: 'b', label: 'High', rangeLabel: '10+' },
      ];
      expect(selectBand(1, shifted)?.label).toBe('Low');
    });

    it('returns null for an empty band list', () => {
      expect(selectBand(3, [])).toBeNull();
    });
  });

  describe('cell states: value vs partial vs gap', () => {
    const data: CalendarDatum[] = [
      { date: '2026-06-22', value: 3 }, // value (Normal)
      { date: '2026-06-23', value: null }, // partial
      // 2026-06-24 deliberately absent → gap (within window)
      { date: '2026-06-25', value: 20 }, // value (Moderate)
    ];

    it('renders value cells coloured by band with a correct aria-label', () => {
      render(<CalendarHeatmap data={data} bands={BANDS} metricLabel="AHI (events/h)" />);
      const value = cellFor('2026-06-22');
      expect(value).toHaveAttribute('data-state', 'value');
      const rect = value.querySelector('rect');
      expect(rect).toHaveAttribute('fill', 'var(--color-status-normal)');
      expect(value).toHaveAttribute(
        'aria-label',
        expect.stringContaining('AHI (events/h) 3.0, Normal'),
      );
    });

    it('renders partial cells with a neutral fill, a glyph, and a not-available label', () => {
      render(
        <CalendarHeatmap
          data={data}
          bands={BANDS}
          metricLabel="AHI"
          partialLabel="Short recording — AHI not available"
        />,
      );
      const partial = cellFor('2026-06-23');
      expect(partial).toHaveAttribute('data-state', 'partial');
      const rect = partial.querySelector('rect');
      expect(rect).toHaveAttribute('fill', 'var(--color-surface-tertiary)');
      // Non-colour glyph cue present.
      expect(partial.querySelector('circle')).not.toBeNull();
      expect(partial).toHaveAttribute(
        'aria-label',
        expect.stringContaining('short recording, AHI not available'),
      );
    });

    it('renders gap cells (absent within window) distinctly with a no-session label', () => {
      render(<CalendarHeatmap data={data} bands={BANDS} metricLabel="AHI" />);
      const gap = cellFor('2026-06-24');
      expect(gap).toHaveAttribute('data-state', 'gap');
      const rect = gap.querySelector('rect');
      expect(rect).toHaveAttribute('fill', 'var(--color-surface-secondary)');
      // No glyph on gaps.
      expect(gap.querySelector('circle')).toBeNull();
      expect(gap).toHaveAttribute('aria-label', expect.stringContaining('no recorded session'));
    });
  });

  describe('rangeStart / rangeEnd windowing', () => {
    it('renders days with no datum as gaps across the full window', () => {
      const data: CalendarDatum[] = [{ date: '2026-03-10', value: 8 }];
      render(
        <CalendarHeatmap data={data} bands={BANDS} rangeStart="2026-03-01" rangeEnd="2026-03-31" />,
      );
      // A date inside the window with no datum is a gap.
      expect(cellFor('2026-03-05')).toHaveAttribute('data-state', 'gap');
      expect(cellFor('2026-03-20')).toHaveAttribute('data-state', 'gap');
      // The single datum is a value cell.
      expect(cellFor('2026-03-10')).toHaveAttribute('data-state', 'value');
    });
  });

  describe('per-calendar-year panels', () => {
    /** All grid panels' aria-labels, in render order (oldest → newest). */
    function panelYears(): string[] {
      return screen
        .getAllByRole('grid')
        .map((g) => g.getAttribute('aria-label') ?? '')
        .map((label) => label.match(/^(\d{4})/)?.[1] ?? '')
        .filter(Boolean);
    }

    it('renders one grid panel per calendar year across a multi-year range', () => {
      const data: CalendarDatum[] = [
        { date: '2023-12-30', value: 4 },
        { date: '2024-06-15', value: 8 },
        { date: '2025-02-01', value: 12 },
      ];
      render(
        <CalendarHeatmap data={data} bands={BANDS} rangeStart="2023-01-01" rangeEnd="2025-12-31" />,
      );
      expect(panelYears()).toEqual(['2023', '2024', '2025']);
    });

    it('trims empty leading/trailing years but keeps interior empty years', () => {
      // Data only in 2023 and 2025; 2024 is an interior empty (therapy gap) year.
      const data: CalendarDatum[] = [
        { date: '2023-11-10', value: 4 },
        { date: '2025-03-20', value: 9 },
      ];
      render(
        <CalendarHeatmap
          data={data}
          bands={BANDS}
          // Window is far wider than the data on both ends.
          rangeStart="2000-01-01"
          rangeEnd="2026-12-31"
        />,
      );
      // Leading (2000–2022) and trailing (2026) empty years are dropped; the
      // interior empty year (2024) is kept.
      expect(panelYears()).toEqual(['2023', '2024', '2025']);
    });

    it('collapses an "all time" window to only the years that contain data', () => {
      // The classic bug: rangeStart deep in the past, data only recently.
      const data: CalendarDatum[] = [
        { date: '2025-05-01', value: 3 },
        { date: '2026-01-15', value: 7 },
      ];
      render(
        <CalendarHeatmap data={data} bands={BANDS} rangeStart="2000-01-01" rangeEnd="2026-06-26" />,
      );
      // ~26 years requested, but only 2 panels render.
      expect(panelYears()).toEqual(['2025', '2026']);
    });

    it('left-aligns a window-clipped partial panel to column 0 (no empty left gap)', () => {
      // A short window spanning only May–June of one year. The absolute
      // week-of-year of May 1 is ~18, so without the offset the grid would
      // float ~18 columns to the right with a large empty gutter. After the
      // left-align fix the FIRST rendered cell sits at the grid origin (x===0)
      // and the panel's column count equals the in-window week span — not the
      // absolute week-of-year of the last day (~26).
      const data: CalendarDatum[] = [{ date: '2026-05-15', value: 8 }];
      render(
        <CalendarHeatmap data={data} bands={BANDS} rangeStart="2026-05-01" rangeEnd="2026-06-30" />,
      );

      // The very first in-window day is the leftmost cell at local column 0.
      const first = cellFor('2026-05-01').querySelector('rect');
      expect(first).toHaveAttribute('x', '0');

      // The single grid panel's width reflects only the in-window week span.
      // May 1 (Fri) → Jun 30 spans 10 Sunday-aligned weeks (cols 0–9), not ~27.
      const grid = screen.getByRole('grid');
      // svgWidth = weeks * pitch - CELL_GAP + 1; pitch = 13 + 3 = 16.
      // 10 weeks → 10*16 - 3 + 1 = 158. (A non-offset render would be far wider.)
      expect(Number(grid.getAttribute('width'))).toBe(158);
    });

    it('keeps Jan-aligned full-year panels at column 0 across a multi-year render', () => {
      // Three full calendar years (all-time style window, no clipping of the
      // interior years). Every full-year panel must keep Jan 1 at column 0 so
      // the panels share one Jan-aligned axis — the multi-year look is intact.
      const data: CalendarDatum[] = [
        { date: '2023-06-15', value: 4 },
        { date: '2024-06-15', value: 8 },
        { date: '2025-06-15', value: 12 },
      ];
      render(
        <CalendarHeatmap data={data} bands={BANDS} rangeStart="2023-01-01" rangeEnd="2025-12-31" />,
      );
      // Jan 1 of each full year is the leftmost cell (local column 0).
      for (const year of ['2023', '2024', '2025']) {
        const jan1 = cellFor(`${year}-01-01`).querySelector('rect');
        expect(jan1).toHaveAttribute('x', '0');
      }
    });

    it('left-aligns each side of a 1-year window that splits into two partial panels', () => {
      // A "last year" window (Jun 2025 → Jun 2026) splits into a 2025 partial
      // and a 2026 partial. Each panel left-aligns to ITS OWN first week, so
      // both start at column 0 — the intended cleaner result.
      const data: CalendarDatum[] = [
        { date: '2025-07-10', value: 5 },
        { date: '2026-02-20', value: 9 },
      ];
      render(
        <CalendarHeatmap data={data} bands={BANDS} rangeStart="2025-06-26" rangeEnd="2026-06-26" />,
      );
      // 2025 panel: first in-window day (Jun 26, 2025) at column 0.
      expect(cellFor('2025-06-26').querySelector('rect')).toHaveAttribute('x', '0');
      // 2026 panel: first in-window day (Jan 1, 2026) at column 0.
      expect(cellFor('2026-01-01').querySelector('rect')).toHaveAttribute('x', '0');
    });

    it('renders a single frame for the window year when no data falls in the window', () => {
      render(
        <CalendarHeatmap data={[]} bands={BANDS} rangeStart="2026-01-01" rangeEnd="2026-12-31" />,
      );
      expect(panelYears()).toEqual(['2026']);
    });
  });

  describe('onSelectDate activation', () => {
    const data: CalendarDatum[] = [
      { date: '2026-06-22', value: 3 },
      { date: '2026-06-23', value: null },
    ];

    it('fires for value days on click', () => {
      const onSelectDate = vi.fn();
      render(
        <CalendarHeatmap
          data={data}
          bands={BANDS}
          rangeStart="2026-06-21"
          rangeEnd="2026-06-24"
          onSelectDate={onSelectDate}
        />,
      );
      fireEvent.click(cellFor('2026-06-22'));
      expect(onSelectDate).toHaveBeenCalledWith('2026-06-22');
    });

    it('fires for partial days on click (a session exists)', () => {
      const onSelectDate = vi.fn();
      render(
        <CalendarHeatmap
          data={data}
          bands={BANDS}
          rangeStart="2026-06-21"
          rangeEnd="2026-06-24"
          onSelectDate={onSelectDate}
        />,
      );
      fireEvent.click(cellFor('2026-06-23'));
      expect(onSelectDate).toHaveBeenCalledWith('2026-06-23');
    });

    it('does NOT fire for gap days on click', () => {
      const onSelectDate = vi.fn();
      render(
        <CalendarHeatmap
          data={data}
          bands={BANDS}
          rangeStart="2026-06-21"
          rangeEnd="2026-06-24"
          onSelectDate={onSelectDate}
        />,
      );
      // 2026-06-24 is absent → gap.
      fireEvent.click(cellFor('2026-06-24'));
      expect(onSelectDate).not.toHaveBeenCalled();
    });

    it('fires on Enter and Space for a session day, not for a gap', () => {
      const onSelectDate = vi.fn();
      render(
        <CalendarHeatmap
          data={data}
          bands={BANDS}
          rangeStart="2026-06-21"
          rangeEnd="2026-06-24"
          onSelectDate={onSelectDate}
        />,
      );
      fireEvent.keyDown(cellFor('2026-06-22'), { key: 'Enter' });
      expect(onSelectDate).toHaveBeenLastCalledWith('2026-06-22');

      fireEvent.keyDown(cellFor('2026-06-23'), { key: ' ' });
      expect(onSelectDate).toHaveBeenLastCalledWith('2026-06-23');

      onSelectDate.mockClear();
      fireEvent.keyDown(cellFor('2026-06-24'), { key: 'Enter' });
      expect(onSelectDate).not.toHaveBeenCalled();
    });
  });

  describe('roving tabindex and keyboard navigation', () => {
    const data: CalendarDatum[] = [
      { date: '2026-06-22', value: 3 },
      { date: '2026-06-23', value: 8 },
      { date: '2026-06-24', value: 20 },
    ];

    it('exposes a single tab stop (one cell tabIndex=0, rest -1)', () => {
      render(
        <CalendarHeatmap data={data} bands={BANDS} rangeStart="2026-06-21" rangeEnd="2026-06-27" />,
      );
      const tabbable = document.querySelectorAll('[role="gridcell"][tabindex="0"]');
      expect(tabbable.length).toBe(1);
      // Default focus target is the last day with data.
      expect(tabbable[0]).toHaveAttribute('data-date', '2026-06-24');
    });

    it('selectedDate becomes the roving tab stop when present', () => {
      render(
        <CalendarHeatmap
          data={data}
          bands={BANDS}
          rangeStart="2026-06-21"
          rangeEnd="2026-06-27"
          selectedDate="2026-06-22"
        />,
      );
      expect(cellFor('2026-06-22')).toHaveAttribute('tabindex', '0');
      expect(cellFor('2026-06-24')).toHaveAttribute('tabindex', '-1');
    });

    it('ArrowRight / ArrowLeft move focus by one day', () => {
      render(
        <CalendarHeatmap
          data={data}
          bands={BANDS}
          rangeStart="2026-06-21"
          rangeEnd="2026-06-27"
          selectedDate="2026-06-22"
        />,
      );
      fireEvent.keyDown(cellFor('2026-06-22'), { key: 'ArrowRight' });
      expect(cellFor('2026-06-23')).toHaveAttribute('tabindex', '0');
      expect(cellFor('2026-06-22')).toHaveAttribute('tabindex', '-1');

      fireEvent.keyDown(cellFor('2026-06-23'), { key: 'ArrowLeft' });
      expect(cellFor('2026-06-22')).toHaveAttribute('tabindex', '0');
    });

    it('ArrowDown / ArrowUp move focus by one week (±7 days)', () => {
      render(
        <CalendarHeatmap
          data={data}
          bands={BANDS}
          rangeStart="2026-06-01"
          rangeEnd="2026-06-30"
          selectedDate="2026-06-10"
        />,
      );
      fireEvent.keyDown(cellFor('2026-06-10'), { key: 'ArrowDown' });
      expect(cellFor('2026-06-17')).toHaveAttribute('tabindex', '0');

      fireEvent.keyDown(cellFor('2026-06-17'), { key: 'ArrowUp' });
      expect(cellFor('2026-06-10')).toHaveAttribute('tabindex', '0');
    });

    it('moves focus across a year-panel boundary (Dec 31 → Jan 1 of next panel)', () => {
      const crossYear: CalendarDatum[] = [
        { date: '2024-12-31', value: 5 },
        { date: '2025-01-01', value: 6 },
      ];
      render(
        <CalendarHeatmap
          data={crossYear}
          bands={BANDS}
          rangeStart="2024-12-01"
          rangeEnd="2025-01-31"
          selectedDate="2024-12-31"
        />,
      );
      // The two dates live in DIFFERENT grid panels (2024 vs 2025).
      const dec31 = cellFor('2024-12-31');
      const jan1 = cellFor('2025-01-01');
      expect(dec31.closest('[role="grid"]')).not.toBe(jan1.closest('[role="grid"]'));

      // ArrowRight from Dec 31 lands the roving tab stop on Jan 1 (next panel).
      expect(dec31).toHaveAttribute('tabindex', '0');
      fireEvent.keyDown(dec31, { key: 'ArrowRight' });
      expect(cellFor('2025-01-01')).toHaveAttribute('tabindex', '0');
      expect(cellFor('2024-12-31')).toHaveAttribute('tabindex', '-1');
    });

    it('does not move focus past the rendered window edge', () => {
      render(
        <CalendarHeatmap
          data={data}
          bands={BANDS}
          rangeStart="2026-06-22"
          rangeEnd="2026-06-24"
          selectedDate="2026-06-22"
        />,
      );
      // Days are clipped to the requested window (no week-alignment padding),
      // so the first rendered cell is exactly rangeStart (2026-06-22). Arrowing
      // left from there must not escape the window — focus stays on the cell.
      const firstCell = cellFor('2026-06-22');
      // The day before rangeStart (2026-06-21) is not rendered.
      expect(document.querySelector('[data-date="2026-06-21"]')).toBeNull();
      fireEvent.focus(firstCell);
      fireEvent.keyDown(firstCell, { key: 'ArrowLeft' });
      expect(cellFor('2026-06-22')).toHaveAttribute('tabindex', '0');
    });
  });

  describe('legend', () => {
    it('renders band labels, ranges, and a No-data entry when bands are set', () => {
      render(
        <CalendarHeatmap
          data={[{ date: '2026-06-22', value: 3 }]}
          bands={BANDS}
          metricLabel="AHI (events/h)"
        />,
      );
      const legend = screen.getByRole('list', { name: 'AHI (events/h) legend' });
      expect(within(legend).getByText('Normal')).toBeInTheDocument();
      expect(within(legend).getByText('Mild')).toBeInTheDocument();
      expect(within(legend).getByText('5–<15')).toBeInTheDocument();
      expect(within(legend).getByText('15–<30')).toBeInTheDocument();
      expect(within(legend).getByText('No data')).toBeInTheDocument();
      expect(within(legend).getByText('Short recording')).toBeInTheDocument();
      expect(screen.getByText('AHI (events/h)')).toBeInTheDocument();
    });

    it('hides the legend when showLegend is false', () => {
      render(
        <CalendarHeatmap
          data={[{ date: '2026-06-22', value: 3 }]}
          bands={BANDS}
          showLegend={false}
        />,
      );
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });
  });

  describe('accessibility scaffolding', () => {
    it('exposes grid / row / gridcell roles and a per-year grid aria-label', () => {
      render(
        <CalendarHeatmap
          data={[{ date: '2026-06-22', value: 3 }]}
          bands={BANDS}
          metricLabel="AHI"
        />,
      );
      // Single-year data → one panel → one grid, named for its year + metric.
      const grid = screen.getByRole('grid');
      expect(grid).toHaveAttribute('aria-label', expect.stringContaining('2026'));
      expect(grid).toHaveAttribute('aria-label', expect.stringContaining('AHI'));
      expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
      expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(0);
    });

    it('marks the selected cell with aria-selected', () => {
      render(
        <CalendarHeatmap
          data={[{ date: '2026-06-22', value: 3 }]}
          bands={BANDS}
          rangeStart="2026-06-21"
          rangeEnd="2026-06-24"
          selectedDate="2026-06-22"
        />,
      );
      expect(cellFor('2026-06-22')).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('continuous mode (backward compatibility)', () => {
    it('renders without bands using the linear scale and no legend', () => {
      render(
        <CalendarHeatmap
          data={[
            { date: '2026-06-22', value: 1 },
            { date: '2026-06-23', value: 9 },
          ]}
        />,
      );
      // No legend in continuous mode by default.
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      // Value cells still render.
      expect(cellFor('2026-06-22')).toHaveAttribute('data-state', 'value');
    });
  });

  describe('empty state', () => {
    it('renders a "No data" placeholder when there is no data and no range', () => {
      render(<CalendarHeatmap data={[]} bands={BANDS} />);
      expect(screen.getByText('No data')).toBeInTheDocument();
    });
  });
});
