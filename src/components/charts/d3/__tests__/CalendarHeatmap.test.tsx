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
      // The window is aligned to whole weeks, so the first rendered cell is the
      // Sunday before rangeStart (2026-06-21). Arrowing left from there must not
      // escape the window — focus stays on the first cell.
      const firstCell = cellFor('2026-06-21');
      expect(firstCell).toHaveAttribute('data-state', 'gap');
      fireEvent.keyDown(firstCell, { key: 'ArrowLeft' });
      // The cell before 2026-06-21 (2026-06-20) is not rendered.
      expect(document.querySelector('[data-date="2026-06-20"]')).toBeNull();
      // Focus stayed: arrowing left was a no-op, 2026-06-21 keeps its tab stop
      // once focused.
      fireEvent.focus(firstCell);
      fireEvent.keyDown(firstCell, { key: 'ArrowLeft' });
      expect(cellFor('2026-06-21')).toHaveAttribute('tabindex', '0');
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
    it('exposes grid / row / gridcell roles and an svg aria-label', () => {
      render(
        <CalendarHeatmap
          data={[{ date: '2026-06-22', value: 3 }]}
          bands={BANDS}
          metricLabel="AHI"
        />,
      );
      const grid = screen.getByRole('grid');
      expect(grid).toHaveAttribute('aria-label', expect.stringContaining('Calendar heatmap'));
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
