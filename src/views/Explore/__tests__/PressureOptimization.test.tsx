import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { render as rtlRender, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';

// The view renders a router-aware `Explore /` breadcrumb (react-router <Link>),
// so every render needs a Router context in scope.
function render(ui: ReactElement) {
  return rtlRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>,
  });
}

// Mock getDB
const mockGetDB = vi.fn();
vi.mock('@/services/storage/getDB', () => ({
  getDB: () => mockGetDB(),
}));

// Mock analysis functions
vi.mock('@/analysis/pressure', () => ({
  pressureResponseCurve: vi.fn().mockReturnValue({
    regressionSlope: -0.5,
    regressionIntercept: 12.0,
    rSquared: 0.6,
    pValue: 0.01,
  }),
  pressureVariability: vi.fn().mockReturnValue({
    mean: 10.5,
    p5: 8.0,
    p95: 13.0,
    cv: 0.15,
    interpretation: 'stable' as const,
  }),
  titrationHelper: vi.fn().mockReturnValue({
    optimalPressureMin: 9.0,
    optimalPressureMax: 11.0,
    ahiAtOptimal: 2.5,
    regressionR: 0.75,
    regressionSlope: -0.4,
    recommendation: 'Current pressure appears well-optimised.',
  }),
  bipapEffectiveness: vi.fn().mockReturnValue(null),
}));

// Mock chart components
vi.mock('@/components/charts', () => ({
  ChartContainer: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid={`chart-container-${title}`}>{children}</div>
  ),
  ThemedScatterPlot: () => <div data-testid="scatter-plot" />,
  BoxPlot: () => <div data-testid="box-plot" />,
}));

// Mock CSS module
vi.mock('../PressureOptimization.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { PressureOptimization } from '@/views/Explore/PressureOptimization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAggregate(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    sessionId: 'sess-1',
    machineId: 'SN-123',
    date: '2025-03-15',
    ahi: 4.0,
    ahiObstructive: 2.0,
    ahiCentral: 1.0,
    ahiMixed: 0.0,
    ahiHypopnea: 1.0,
    ahiRera: 0.0,
    eventCount: 16,
    eventsByType: {
      obstructive: 8,
      central: 4,
      mixed: 0,
      hypopnea: 4,
      rera: 0,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
    },
    pressureMean: 10.5,
    pressureMedian: 10.2,
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
    ...overrides,
  };
}

describe('PressureOptimization', () => {
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
      getNightlyAggregatesByDateRange: vi.fn().mockResolvedValue([]),
    });

    render(<PressureOptimization />);

    // The title text also appears as the current breadcrumb crumb, so target the
    // heading specifically.
    expect(screen.getByRole('heading', { name: 'Pressure Optimization' })).toBeInTheDocument();
  });

  it('should show loading state initially', () => {
    mockGetDB.mockReturnValue(new Promise(() => {}));

    render(<PressureOptimization />);

    expect(screen.getByText('Loading pressure data…')).toBeInTheDocument();
  });

  it('should show empty state when no aggregates are available', async () => {
    mockGetDB.mockResolvedValue({
      getNightlyAggregatesByDateRange: vi.fn().mockResolvedValue([]),
    });

    render(<PressureOptimization />);

    const emptyText = await screen.findByText('No data available');
    expect(emptyText).toBeInTheDocument();
    expect(
      screen.getByText(/Import CPAP data to see pressure optimisation results/),
    ).toBeInTheDocument();
  });

  it('should show error state when data fetch fails', async () => {
    mockGetDB.mockResolvedValue({
      getNightlyAggregatesByDateRange: vi.fn().mockRejectedValue(new Error('Storage error')),
    });

    render(<PressureOptimization />);

    const errorText = await screen.findByText('Storage error');
    expect(errorText).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('should render pressure analysis sections when data is present', async () => {
    const aggregates = [
      makeAggregate({ date: '2025-03-01', pressureMean: 9.5, ahi: 5.0 }),
      makeAggregate({ date: '2025-03-02', pressureMean: 10.0, ahi: 4.0 }),
      makeAggregate({ date: '2025-03-03', pressureMean: 10.5, ahi: 3.5 }),
      makeAggregate({ date: '2025-03-04', pressureMean: 11.0, ahi: 3.0 }),
    ];

    mockGetDB.mockResolvedValue({
      getNightlyAggregatesByDateRange: vi.fn().mockResolvedValue(aggregates),
    });

    render(<PressureOptimization />);

    // Wait for sections to render
    const heading = await screen.findByText('Pressure-Response Relationship');
    expect(heading).toBeInTheDocument();

    expect(screen.getByText('Pressure Variability')).toBeInTheDocument();
    expect(screen.getByText('Titration Recommendations')).toBeInTheDocument();
  });

  it('should render controls with time grouping selector', async () => {
    const aggregates = [
      makeAggregate({ date: '2025-03-01' }),
      makeAggregate({ date: '2025-03-02' }),
      makeAggregate({ date: '2025-03-03' }),
    ];

    mockGetDB.mockResolvedValue({
      getNightlyAggregatesByDateRange: vi.fn().mockResolvedValue(aggregates),
    });

    render(<PressureOptimization />);

    const groupingSelect = await screen.findByLabelText('Time Grouping');
    expect(groupingSelect).toBeInTheDocument();
  });

  it('should show accessible loading indicator', () => {
    mockGetDB.mockReturnValue(new Promise(() => {}));

    render(<PressureOptimization />);

    const loadingEl = screen.getByRole('status');
    expect(loadingEl).toBeInTheDocument();
  });

  it('should display titration recommendation text when data is sufficient', async () => {
    const aggregates = [
      makeAggregate({ date: '2025-03-01', pressureMean: 9.5, ahi: 5.0 }),
      makeAggregate({ date: '2025-03-02', pressureMean: 10.0, ahi: 4.0 }),
      makeAggregate({ date: '2025-03-03', pressureMean: 10.5, ahi: 3.0 }),
      makeAggregate({ date: '2025-03-04', pressureMean: 11.0, ahi: 2.5 }),
    ];

    mockGetDB.mockResolvedValue({
      getNightlyAggregatesByDateRange: vi.fn().mockResolvedValue(aggregates),
    });

    render(<PressureOptimization />);

    const recommendation = await screen.findByText('Current pressure appears well-optimised.');
    expect(recommendation).toBeInTheDocument();
  });

  it('should show pressure variability summary cards', async () => {
    const aggregates = [
      makeAggregate({ date: '2025-03-01', pressureMean: 10.0 }),
      makeAggregate({ date: '2025-03-02', pressureMean: 10.5 }),
      makeAggregate({ date: '2025-03-03', pressureMean: 11.0 }),
    ];

    mockGetDB.mockResolvedValue({
      getNightlyAggregatesByDateRange: vi.fn().mockResolvedValue(aggregates),
    });

    render(<PressureOptimization />);

    // Wait for variability section
    const meanPressure = await screen.findByText('Mean Pressure');
    expect(meanPressure).toBeInTheDocument();
    expect(screen.getByText('Stability')).toBeInTheDocument();
  });
});
