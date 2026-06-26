import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';

/**
 * Integration coverage for the Session List CALENDAR view branch.
 *
 * Companion to `SessionList.urlPage.test.tsx` (which pins the table/pagination
 * URL state). These tests pin the calendar-branch wiring:
 *   - `?view=calendar` renders the heatmap region and hides the table-only
 *     date search box (the toolbar's leading slot swaps to the Metric control),
 *   - `?metric=…` / `?size=…` parse and reflect into the URL/controls,
 *   - switching the view preserves the other params,
 *   - a page-size change resets pagination to page 1.
 *
 * The DateRangeSelector pulls in heavy Select/store machinery irrelevant here,
 * so it is stubbed (matching the sibling test). `loadSessions` is stubbed to a
 * no-op so the directly-seeded session Map is not clobbered by an IndexedDB
 * round-trip, AND so the date-range-change effect cannot reload empty data.
 *
 * The calendar window comes from the global `dateRange` (NOT from data), so we
 * pin `dateRange` to a fixed span around the seeded session dates. This keeps
 * the rendered window deterministic and independent of the real "today"
 * (CalendarHeatmap's only `Date.now()` use is the non-asserted "today" outline).
 */
vi.mock('@/components/domain/DateRangeSelector', () => ({
  DateRangeSelector: () => <div data-testid="date-range-selector" />,
}));

// Import AFTER mocks are registered.
import SessionList from '@/views/Sessions/SessionList';

type SessionMetadata =
  ReturnType<typeof useDataStore.getState>['sessions'] extends Map<string, infer V> ? V : never;

const TOTAL_SESSIONS = 60;

/** A fixed window that fully contains the seeded session dates below. */
const RANGE_START = new Date(2024, 0, 1); // 2024-01-01 local
const RANGE_END = new Date(2024, 11, 31); // 2024-12-31 local

/** Build a deterministic set of sessions within the pinned window. */
function buildSessions(count: number): Map<string, SessionMetadata> {
  const map = new Map<string, SessionMetadata>();
  for (let i = 0; i < count; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String((Math.floor(i / 28) % 12) + 1).padStart(2, '0');
    const id = `sess-${String(i).padStart(3, '0')}`;
    map.set(id, {
      id,
      date: `2024-${month}-${day}`,
      machineModel: 'AirSense 10',
      durationMinutes: 480,
      usageMinutes: 450,
      ahi: 3.2,
      leakMedian: 12.5,
      eventCount: 10,
      complianceStatus: 'compliant',
    });
  }
  return map;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe" data-search={location.search} />;
}

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/sessions" element={<SessionList />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function currentSearch(): string {
  return screen.getByTestId('location-probe').getAttribute('data-search') ?? '';
}

describe('SessionList — calendar view', () => {
  beforeEach(() => {
    useDataStore.setState({
      sessions: buildSessions(TOTAL_SESSIONS),
      sessionsLoading: false,
      sessionsError: null,
      loadSessions: vi.fn().mockResolvedValue(undefined),
    });
    // Pin the calendar window deterministically (independent of real "today").
    useAppStore.setState({ dateRange: { start: RANGE_START, end: RANGE_END } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the table (with the date search box) by default — no view param', () => {
    renderAt('/sessions');
    expect(screen.getByRole('searchbox', { name: /filter sessions by date/i })).toBeInTheDocument();
    // No calendar grid in table view.
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('renders the calendar heatmap and hides the date search box for ?view=calendar', () => {
    renderAt('/sessions?view=calendar');
    // The heatmap SVG carries role="grid".
    expect(screen.getByRole('grid')).toBeInTheDocument();
    // The table-only date search box is gone; the Metric control takes its slot.
    expect(
      screen.queryByRole('searchbox', { name: /filter sessions by date/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /metric/i })).toBeInTheDocument();
  });

  it('defaults the calendar metric to AHI and labels the grid accordingly', () => {
    renderAt('/sessions?view=calendar');
    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('aria-label', expect.stringContaining('AHI'));
  });

  it('reflects ?metric=usage into the rendered metric and grid label', () => {
    renderAt('/sessions?view=calendar&metric=usage');
    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('aria-label', expect.stringContaining('Usage'));
  });

  it('reflects ?metric=leak into the grid label', () => {
    renderAt('/sessions?view=calendar&metric=leak');
    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('aria-label', expect.stringContaining('Leak'));
  });

  it('switching from table to calendar preserves the other params (size, page)', async () => {
    const user = userEvent.setup();
    // Start in table view, page 2, size 50.
    renderAt('/sessions?page=2&size=50');
    expect(currentSearch()).toContain('page=2');
    expect(currentSearch()).toContain('size=50');

    await user.click(screen.getByRole('radio', { name: 'Calendar view' }));

    const search = currentSearch();
    expect(search).toContain('view=calendar');
    // The unrelated params survive the view switch verbatim.
    expect(search).toContain('size=50');
    expect(search).toContain('page=2');
  });

  it('switching the calendar metric writes ?metric and preserves view=calendar', async () => {
    const user = userEvent.setup();
    renderAt('/sessions?view=calendar');
    expect(currentSearch()).toBe('?view=calendar');

    await user.click(screen.getByRole('radio', { name: /usage hours/i }));

    const search = currentSearch();
    expect(search).toContain('view=calendar');
    expect(search).toContain('metric=usage');
  });

  it('reflects ?size=50 in the table page-size control', () => {
    renderAt('/sessions?size=50');
    // 50 per page → rows 1–50 of 60.
    expect(screen.getByText(/Showing 1–50 of 60 sessions/)).toBeInTheDocument();
  });

  it('changing the page size resets pagination to page 1 (drops ?page)', async () => {
    const user = userEvent.setup();
    // On page 2 at the default size (25): rows 26–50 of 60.
    renderAt('/sessions?page=2');
    expect(screen.getByText(/Showing 26–50 of 60 sessions/)).toBeInTheDocument();
    expect(currentSearch()).toBe('?page=2');

    // Switch to 100 rows/page → the page-reset effect drops ?page and writes size.
    await user.click(screen.getByRole('radio', { name: /100 rows per page/i }));

    const search = currentSearch();
    expect(search).not.toContain('page=');
    expect(search).toContain('size=100');
    // All 60 rows now fit on a single page, so the pagination nav (and its
    // "Showing …" text) is hidden entirely. Assert the slice directly: every
    // seeded session row is present.
    expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
    const rows = screen.getAllByRole('link', { name: /^Session from / });
    expect(rows).toHaveLength(TOTAL_SESSIONS);
  });
});
