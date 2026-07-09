import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

import { useDataStore } from '@/stores/useDataStore';

/**
 * Integration coverage for the Session List pagination URL-state fix.
 *
 * The page lives in the URL (`?page=N`) rather than component state so browser
 * Back restores it. These tests pin the regression-prone behaviors:
 *   - the rendered page derives from the URL param,
 *   - pagination clicks write the param (and drop it for page 1),
 *   - a genuine filter change resets to page 1 (the didMount guard must NOT
 *     suppress that reset),
 *   - a `?page=N` present on initial mount is honored, not reset by the mount
 *     effect.
 *
 * `loadSessions` is stubbed to a no-op (see beforeEach) so the directly-seeded
 * session Map is not clobbered by an IndexedDB round-trip.
 *
 * (The Sessions index no longer renders a per-view DateRangeSelector, so the
 * previous stub for it was removed.)
 */
import SessionList from '@/views/Sessions/SessionList';

type SessionMetadata =
  ReturnType<typeof useDataStore.getState>['sessions'] extends Map<string, infer V> ? V : never;

const TOTAL_SESSIONS = 60;

/** Build a deterministic set of sessions, newest date first when sorted desc. */
function buildSessions(count: number): Map<string, SessionMetadata> {
  const map = new Map<string, SessionMetadata>();
  for (let i = 0; i < count; i++) {
    // 2024-01-01 .. ascending; index 0 is the earliest date so that the default
    // date-desc sort places the highest index first (stable, predictable rows).
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

/** Reports the current location's search string into a data attribute. */
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

describe('SessionList — pagination URL state', () => {
  beforeEach(() => {
    // Seed the data store directly and neutralize loadSessions so the mount
    // effect cannot overwrite the seeded Map with an empty IndexedDB result.
    useDataStore.setState({
      sessions: buildSessions(TOTAL_SESSIONS),
      sessionsLoading: false,
      sessionsError: null,
      loadSessions: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the first page by default (no page param)', () => {
    renderAt('/sessions');
    // 25 per page → rows 1–25 of 60.
    expect(screen.getByText(/Showing 1–25 of 60 sessions/)).toBeInTheDocument();
    // Page 1 is the active page.
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
  });

  it('honors ?page=2 on initial mount and shows the second page of rows', () => {
    renderAt('/sessions?page=2');
    // The page-info text proves the slice is rows 26–50, i.e. page 2 — NOT reset
    // to page 1 by the mount effect (the core regression).
    expect(screen.getByText(/Showing 26–50 of 60 sessions/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
    // The URL is left untouched on mount.
    expect(currentSearch()).toBe('?page=2');
  });

  it('writes ?page=2 to the URL when the Page 2 control is clicked from page 1', async () => {
    const user = userEvent.setup();
    renderAt('/sessions');
    expect(currentSearch()).toBe('');

    await user.click(screen.getByRole('button', { name: 'Page 2' }));

    expect(screen.getByText(/Showing 26–50 of 60 sessions/)).toBeInTheDocument();
    expect(currentSearch()).toBe('?page=2');
  });

  it('drops the page param (deletes ?page) when returning to page 1 via the controls', async () => {
    const user = userEvent.setup();
    renderAt('/sessions?page=2');
    expect(currentSearch()).toBe('?page=2');

    // "Prev" from page 2 lands on page 1, which deletes the param for a clean URL.
    await user.click(screen.getByRole('button', { name: 'Previous page' }));

    expect(currentSearch()).toBe('');
    expect(screen.getByText(/Showing 1–25 of 60 sessions/)).toBeInTheDocument();
  });

  it('resets to page 1 (drops ?page) when the search filter changes — didMount guard does not suppress it', async () => {
    const user = userEvent.setup();
    renderAt('/sessions?page=2');
    expect(currentSearch()).toBe('?page=2');

    // A genuine filter change must reset pagination. "2024" matches every seeded
    // session so the list stays populated and pagination remains visible.
    const filter = screen.getByRole('searchbox', { name: /filter sessions by date/i });
    await user.type(filter, '2024');

    expect(currentSearch()).toBe('');
    expect(screen.getByText(/Showing 1–25 of 60 sessions/)).toBeInTheDocument();
  });

  it('shows the page-2 slice of rows distinct from page 1', () => {
    // Sanity check that the page slice actually differs: capture the first data
    // row's accessible label on each page and assert they are not equal.
    const { unmount } = renderAt('/sessions');
    const page1Table = screen.getByRole('table');
    const page1FirstRow = within(page1Table).getAllByRole('link')[0]?.getAttribute('aria-label');
    unmount();

    renderAt('/sessions?page=2');
    const page2Table = screen.getByRole('table');
    const page2FirstRow = within(page2Table).getAllByRole('link')[0]?.getAttribute('aria-label');

    expect(page1FirstRow).toBeTruthy();
    expect(page2FirstRow).toBeTruthy();
    expect(page2FirstRow).not.toEqual(page1FirstRow);
  });
});
