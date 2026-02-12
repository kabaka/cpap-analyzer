import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '@/stores/useAppStore';

// Mock getDB
const mockGetDB = vi.fn();
vi.mock('@/services/storage/getDB', () => ({
  getDB: () => mockGetDB(),
}));

// Mock analysis functions
vi.mock('@/analysis/events', () => ({
  clusterEventsFLGBridged: vi.fn().mockReturnValue({ clusters: [], unclustered: [] }),
  eventDurationDistribution: vi.fn().mockReturnValue([]),
  interEventIntervals: vi.fn().mockReturnValue(null),
}));

vi.mock('@/analysis/survival', () => ({
  kaplanMeier: vi.fn().mockReturnValue(null),
}));

// Mock chart components
vi.mock('@/components/charts', () => ({
  ChartContainer: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid={`chart-container-${title}`}>{children}</div>
  ),
  ThemedBarChart: () => <div data-testid="bar-chart" />,
  ThemedScatterPlot: () => <div data-testid="scatter-plot" />,
  KaplanMeierCurve: () => <div data-testid="km-curve" />,
}));

// Mock CSS module
vi.mock('../EventAnalysis.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { EventAnalysis } from '@/views/Analysis/EventAnalysis';

describe('EventAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      dateRange: {
        start: new Date('2025-01-01'),
        end: new Date('2025-06-01'),
      },
    });
  });

  it('should render the page heading', async () => {
    mockGetDB.mockResolvedValue({
      getSessionsByDateRange: vi.fn().mockResolvedValue([]),
      getNightlyAggregatesByDateRange: vi.fn().mockResolvedValue([]),
      getEventsBySessionId: vi.fn().mockResolvedValue([]),
    });

    render(<EventAnalysis />);

    expect(screen.getByText('Event Analysis')).toBeInTheDocument();
  });

  it('should show loading state initially', () => {
    // Return a promise that never resolves to keep loading state
    mockGetDB.mockReturnValue(new Promise(() => {}));

    render(<EventAnalysis />);

    expect(screen.getByText('Loading event data…')).toBeInTheDocument();
  });

  it('should show empty state when no data is available', async () => {
    mockGetDB.mockResolvedValue({
      getSessionsByDateRange: vi.fn().mockResolvedValue([]),
      getNightlyAggregatesByDateRange: vi.fn().mockResolvedValue([]),
      getEventsBySessionId: vi.fn().mockResolvedValue([]),
    });

    render(<EventAnalysis />);

    // Wait for loading to finish
    const emptyText = await screen.findByText('No data available');
    expect(emptyText).toBeInTheDocument();
    expect(screen.getByText(/Import CPAP data to see event analysis/)).toBeInTheDocument();
  });

  it('should show error state when data fetch fails', async () => {
    mockGetDB.mockResolvedValue({
      getSessionsByDateRange: vi.fn().mockRejectedValue(new Error('DB is broken')),
      getNightlyAggregatesByDateRange: vi.fn().mockResolvedValue([]),
      getEventsBySessionId: vi.fn().mockResolvedValue([]),
    });

    render(<EventAnalysis />);

    const errorText = await screen.findByText('DB is broken');
    expect(errorText).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('should render controls and summary when data is present', async () => {
    const mockSession = { id: 'sess-1' };
    const mockEvent = {
      id: 'evt-1',
      sessionId: 'sess-1',
      type: 'ObstructiveApnea',
      timestamp: Date.now(),
      duration: 15,
      severity: null,
      pressure: 10,
      epap: null,
      ipap: null,
      leak: 5,
      spo2: null,
      clusterId: null,
    };
    const mockAggregate = {
      id: 'agg-1',
      sessionId: 'sess-1',
      machineId: 'SN-123',
      date: '2025-03-15',
      ahi: 5.0,
      ahiObstructive: 3.0,
      ahiCentral: 1.0,
      ahiMixed: 0.0,
      ahiHypopnea: 1.0,
      ahiRera: 0.0,
      eventCount: 20,
      eventsByType: {
        obstructive: 12,
        central: 4,
        mixed: 0,
        hypopnea: 4,
        rera: 0,
        flowLimitation: 0,
        largeLeak: 0,
        periodicBreathing: 0,
      },
      pressureMean: 10.0,
      pressureMedian: 10.0,
      pressureP95: 12.0,
      pressureMax: 14.0,
      epapMedian: null,
      ipapMedian: null,
      pressureSupport: null,
      leakMedian: 5.0,
      leakP95: 15.0,
      leakMax: 25.0,
      leakDurationMinutes: 10,
      tidalVolumeMean: null,
      tidalVolumeMedian: null,
      respiratoryRate: null,
      minuteVentilation: null,
      spo2Mean: null,
      spo2Min: null,
      spo2Below88Duration: null,
      usageHours: 7.0,
    };

    mockGetDB.mockResolvedValue({
      getSessionsByDateRange: vi.fn().mockResolvedValue([mockSession]),
      getNightlyAggregatesByDateRange: vi.fn().mockResolvedValue([mockAggregate]),
      getEventsBySessionId: vi.fn().mockResolvedValue([mockEvent]),
    });

    render(<EventAnalysis />);

    // Wait for data to load
    const heading = await screen.findByText('Total Events');
    expect(heading).toBeInTheDocument();

    // Summary cards — all three show '1' so use getAllByText
    const onesEls = screen.getAllByText('1');
    expect(onesEls.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Nights Analyzed')).toBeInTheDocument();

    // Controls
    expect(screen.getByLabelText('Event Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Cluster Sensitivity')).toBeInTheDocument();
  });

  it('should show accessible loading indicator', () => {
    mockGetDB.mockReturnValue(new Promise(() => {}));

    render(<EventAnalysis />);

    const loadingEl = screen.getByRole('status');
    expect(loadingEl).toBeInTheDocument();
  });
});
