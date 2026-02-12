import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { useAppStore } from '@/stores/useAppStore';

// Mock the hooks to avoid IndexedDB dependency in component tests
vi.mock('@/hooks/useSessionData', () => ({
  useSessionData: vi.fn(),
}));

vi.mock('@/hooks/useSummaryStats', () => ({
  useSummaryStats: vi.fn(),
}));

vi.mock('@/hooks/useNightlyAggregates', () => ({
  useNightlyAggregates: vi.fn(),
}));

import Dashboard from '@/views/Dashboard/Dashboard';
import { useSessionData } from '@/hooks/useSessionData';
import { useSummaryStats } from '@/hooks/useSummaryStats';
import { useNightlyAggregates } from '@/hooks/useNightlyAggregates';

const mockUseSessionData = vi.mocked(useSessionData);
const mockUseSummaryStats = vi.mocked(useSummaryStats);
const mockUseNightlyAggregates = vi.mocked(useNightlyAggregates);

/** Default mock stats with all required fields. */
function makeMockStats(overrides: Partial<ReturnType<typeof useSummaryStats>['stats']> = {}) {
  return {
    meanAHI: 5.2,
    medianAHI: 4.8,
    meanLeak: 8.1,
    leakP95: 14.0,
    meanUsageHours: 7.0,
    meanPressureP95: 12.3,
    complianceRate: 0.85,
    totalSessions: 1,
    trendAHIPercent: -10,
    trendLeakPercent: 2,
    trendUsagePercent: 5,
    trendCompliancePercent: 3,
    trendPressureP95Percent: 0,
    trendData: [],
    ...overrides,
  };
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store to default 30-day range
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    useAppStore.setState({ dateRange: { start, end } });

    // Default aggregates mock
    mockUseNightlyAggregates.mockReturnValue({
      aggregates: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it('should render empty state when no sessions exist and not loading', () => {
    mockUseSessionData.mockReturnValue({
      sessions: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSummaryStats.mockReturnValue({
      stats: null,
      loading: false,
      error: null,
    });

    render(<Dashboard />);

    // EmptyState shows "CPAP Analyzer" heading and import CTA
    expect(screen.getByText('CPAP Analyzer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import your data/i })).toBeInTheDocument();
  });

  it('should render KPI cards when sessions exist', () => {
    mockUseSessionData.mockReturnValue({
      sessions: [
        {
          id: 'session-1',
          machineId: 'SN-123',
          machineModel: 'AirSense 10 AutoSet',
          machineType: 'apap',
          firmwareVersion: '3.0.2',
          date: '2025-06-15',
          startTime: '2025-06-15T22:00:00Z',
          endTime: '2025-06-16T06:00:00Z',
          durationMinutes: 480,
          usageMinutes: 420,
          importedAt: new Date().toISOString(),
          sourceHash: 'abc123',
          channels: [],
          signalChunkIds: [],
          hasOximetry: false,
          deleted: false,
          machineSettings: null,
        },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSummaryStats.mockReturnValue({
      stats: makeMockStats(),
      loading: false,
      error: null,
    });

    render(<Dashboard />);

    // Dashboard heading and KPI section
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    // "AHI" appears in KPI card title and possibly table column header
    expect(screen.getAllByText('AHI').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Leak Rate')).toBeInTheDocument();
    // "Usage" appears as both KPI title and table column header
    expect(screen.getAllByText('Usage').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Compliance')).toBeInTheDocument();
    expect(screen.getByText('Pressure P95')).toBeInTheDocument();

    // KPI values should be displayed
    expect(screen.getByText('5.2')).toBeInTheDocument();
    expect(screen.getByText('8.1')).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument();
  });

  it('should render Recent Sessions section when sessions exist', () => {
    mockUseSessionData.mockReturnValue({
      sessions: [
        {
          id: 'session-1',
          machineId: 'SN-123',
          machineModel: 'AirSense 10 AutoSet',
          machineType: 'apap',
          firmwareVersion: '3.0.2',
          date: '2025-06-15',
          startTime: '2025-06-15T22:00:00Z',
          endTime: '2025-06-16T06:00:00Z',
          durationMinutes: 480,
          usageMinutes: 420,
          importedAt: new Date().toISOString(),
          sourceHash: 'abc123',
          channels: [],
          signalChunkIds: [],
          hasOximetry: false,
          deleted: false,
          machineSettings: null,
        },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSummaryStats.mockReturnValue({
      stats: makeMockStats(),
      loading: false,
      error: null,
    });

    render(<Dashboard />);

    expect(screen.getByText('Recent Sessions')).toBeInTheDocument();
  });

  it('should not render empty state while loading', () => {
    mockUseSessionData.mockReturnValue({
      sessions: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSummaryStats.mockReturnValue({
      stats: null,
      loading: true,
      error: null,
    });
    mockUseNightlyAggregates.mockReturnValue({
      aggregates: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    render(<Dashboard />);

    // Should show dashboard, not empty state, because it's still loading
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Import Your Data')).not.toBeInTheDocument();
  });
});
