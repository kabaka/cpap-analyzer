import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import type { Event } from '@/types/events';

// Mock getDB
const mockGetDB = vi.fn();
vi.mock('@/services/storage/getDB', () => ({
  getDB: () => mockGetDB(),
}));

// Mock the chart library (jsdom can't render Recharts/D3 meaningfully).
vi.mock('@/components/charts', () => ({
  ChartContainer: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid={`chart-${title}`}>{children}</div>
  ),
  ThemedBarChart: () => <div data-testid="bar-chart" />,
  ThemedScatterPlot: () => <div data-testid="scatter-plot" />,
  BoxPlot: () => <div data-testid="box-plot" />,
  ViolinPlot: () => <div data-testid="violin-plot" />,
}));

import { EventExplorer } from '../EventExplorer';

let id = 0;
function makeEvent(overrides: Partial<Event> = {}): Event {
  id += 1;
  return {
    id: `evt-${id}`,
    sessionId: 'sess-1',
    type: 'ObstructiveApnea',
    timestamp: Date.UTC(2025, 2, 15, 2, 0, 0),
    duration: 25,
    severity: null,
    pressure: 10,
    epap: null,
    ipap: null,
    leak: 5,
    spo2: null,
    clusterId: null,
    ...overrides,
  };
}

function mockDbWith(events: Event[]): void {
  mockGetDB.mockResolvedValue({
    getSessionsByDateRange: vi.fn().mockResolvedValue([{ id: 'sess-1' }]),
    getEventsBySessionId: vi.fn().mockResolvedValue(events),
  });
}

function renderAt(path = '/explore/events') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <EventExplorer />
    </MemoryRouter>,
  );
}

describe('EventExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    id = 0;
    useAppStore.setState({
      dateRange: { start: new Date('2025-01-01'), end: new Date('2025-06-01') },
    });
  });

  it('shows the loading state initially', () => {
    mockGetDB.mockReturnValue(new Promise(() => {}));
    renderAt();
    expect(screen.getByText('Loading event data…')).toBeInTheDocument();
  });

  it('shows the empty state when no events are present', async () => {
    mockDbWith([]);
    renderAt();
    expect(await screen.findByText('No events in this date range')).toBeInTheDocument();
  });

  it('renders the matched-count strip with the correct totals', async () => {
    mockDbWith([makeEvent(), makeEvent({ type: 'Hypopnea' }), makeEvent({ type: 'Hypopnea' })]);
    renderAt();
    // 3 of 3 with no filters
    const strip = await screen.findByText(/of 3 events match/);
    expect(strip).toHaveTextContent('3 of 3 events match no filters');
  });

  it('applies a URL-serialized query and reflects it in the matched count', async () => {
    mockDbWith([
      makeEvent({ type: 'ObstructiveApnea' }),
      makeEvent({ type: 'Hypopnea' }),
      makeEvent({ type: 'Hypopnea' }),
    ]);
    renderAt('/explore/events?types=Hypopnea');
    const strip = await screen.findByText(/of 3 events match/);
    expect(strip).toHaveTextContent('2 of 3 events match 1 filter');
  });

  it('renders the default duration-histogram view and the event table', async () => {
    mockDbWith([makeEvent(), makeEvent()]);
    renderAt();
    await waitFor(() => {
      expect(screen.getByTestId('chart-Duration distribution')).toBeInTheDocument();
    });
    expect(screen.getByText(/Showing 2 matched events/)).toBeInTheDocument();
  });

  it('shows a relax-filters affordance when nothing matches', async () => {
    mockDbWith([makeEvent({ type: 'ObstructiveApnea' })]);
    renderAt('/explore/events?types=CentralApnea');
    expect(await screen.findByText('No events match these filters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Relax all filters' })).toBeInTheDocument();
  });

  it('re-applies a types-only URL change (regression for B1: Set serialization)', async () => {
    // Mirror back/forward navigation by mutating the search params from inside
    // the router. Before B1 the URL→state sync compared via JSON.stringify,
    // which renders a Set as "{}" — so toggling types in the URL silently
    // no-op'd. After the fix the matched count must update.
    mockDbWith([
      makeEvent({ type: 'ObstructiveApnea' }),
      makeEvent({ type: 'Hypopnea' }),
      makeEvent({ type: 'Hypopnea' }),
      makeEvent({ type: 'CentralApnea' }),
    ]);

    let navigateFn: ((to: string) => void) | null = null;
    function NavCapture() {
      const navigate = useNavigate();
      useEffect(() => {
        navigateFn = (to: string) => navigate(to);
      }, [navigate]);
      return null;
    }

    render(
      <MemoryRouter initialEntries={['/explore/events?types=Hypopnea']}>
        <NavCapture />
        <EventExplorer />
      </MemoryRouter>,
    );

    const strip1 = await screen.findByText(/of 4 events match/);
    expect(strip1).toHaveTextContent('2 of 4 events match 1 filter');

    // "Navigate" to a different types-only query — simulates back/forward.
    await act(async () => {
      navigateFn?.('/explore/events?types=CentralApnea');
    });
    await waitFor(() => {
      expect(screen.getByText(/of 4 events match/)).toHaveTextContent(
        '1 of 4 events match 1 filter',
      );
    });
  });
});
