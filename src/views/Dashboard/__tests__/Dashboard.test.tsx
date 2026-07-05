import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { useAppStore } from '@/stores/useAppStore';
import type { Session } from '@/types';

// Mock the data hooks so the Signal Deck renders without IndexedDB. The deck
// pulls from the CPAP hooks (sessions / summary stats / nightly aggregates) plus
// the wearable + analysis hooks used by the wearable lanes and TECSA trajectory.
vi.mock('@/hooks/useSessionData', () => ({
  useSessionData: vi.fn(),
}));

vi.mock('@/hooks/useSummaryStats', () => ({
  useSummaryStats: vi.fn(),
}));

vi.mock('@/hooks/useNightlyAggregates', () => ({
  useNightlyAggregates: vi.fn(),
}));

vi.mock('@/hooks/useWearableSummary', () => ({
  useWearableSummary: vi.fn(),
}));

vi.mock('@/hooks/useWearableData', () => ({
  useWearableDailySummaries: vi.fn(),
}));

vi.mock('@/hooks/useAnalysis', () => ({
  useAnalysis: vi.fn(),
}));

import Dashboard from '@/views/Dashboard/Dashboard';
import { useSessionData } from '@/hooks/useSessionData';
import { useSummaryStats } from '@/hooks/useSummaryStats';
import { useNightlyAggregates } from '@/hooks/useNightlyAggregates';
import { useWearableSummary } from '@/hooks/useWearableSummary';
import { useWearableDailySummaries } from '@/hooks/useWearableData';
import { useAnalysis } from '@/hooks/useAnalysis';

const mockUseSessionData = vi.mocked(useSessionData);
const mockUseSummaryStats = vi.mocked(useSummaryStats);
const mockUseNightlyAggregates = vi.mocked(useNightlyAggregates);
const mockUseWearableSummary = vi.mocked(useWearableSummary);
const mockUseWearableDailySummaries = vi.mocked(useWearableDailySummaries);
const mockUseAnalysis = vi.mocked(useAnalysis);

/** Default mock summary stats with all required fields. */
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
    totalEventCount: 30,
    totalHypopneaCount: 12,
    meanMaskOnHours: 7.0,
    trendAHIPercent: -10,
    trendLeakPercent: 2,
    trendUsagePercent: 5,
    trendCompliancePercent: 3,
    trendPressureP95Percent: 0,
    trendData: [],
    ...overrides,
  };
}

/** A single fully-formed session fixture. */
function makeSession(overrides: Partial<Session> = {}): Session {
  return {
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
    ...overrides,
  } as Session;
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store to default 30-day range.
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    useAppStore.setState({ dateRange: { start, end } });

    // Default aggregates: empty (the deck renders on stats/sessions presence).
    mockUseNightlyAggregates.mockReturnValue({
      aggregates: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    // No wearable data by default → wearable-lane empty state + "—" HR/HRV cells.
    mockUseWearableSummary.mockReturnValue({
      summary: {
        hasData: false,
        availableDataTypes: [],
        overlapDateRange: null,
        totalRecords: 0,
        lastImportAt: null,
      },
      loading: false,
      error: null,
    });
    mockUseWearableDailySummaries.mockReturnValue({
      data: [],
      loading: false,
      error: null,
    });

    // TECSA trajectory analysis: no result by default.
    mockUseAnalysis.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      metadata: null,
      refetch: vi.fn(),
    });
  });

  it('shows the empty state when no sessions exist and not loading', () => {
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

    // EmptyState shows the "CPAP Analyzer" heading and an import CTA.
    expect(screen.getByRole('heading', { name: 'CPAP Analyzer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import your data/i })).toBeInTheDocument();

    // The deck itself is absent — no signal panels.
    expect(
      screen.queryByRole('heading', { name: /signal small-multiples/i }),
    ).not.toBeInTheDocument();
  });

  it('renders the Signal Deck with the page heading and core panels when sessions exist', () => {
    mockUseSessionData.mockReturnValue({
      sessions: [makeSession()],
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

    // Exactly one real <h1> named "Dashboard".
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();

    // Key deck panels are present (assert by accessible heading name).
    expect(screen.getByRole('heading', { name: 'Signal small-multiples' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Session log' })).toBeInTheDocument();

    // Verdict card: "Therapy index" eyebrow + non-diagnostic range summary.
    expect(screen.getByText('Therapy index')).toBeInTheDocument();
    expect(screen.getByText('Range summary')).toBeInTheDocument();

    // The empty state must NOT be shown when data exists.
    expect(screen.queryByRole('button', { name: /import your data/i })).not.toBeInTheDocument();
  });

  it('renders the session log as a semantic table with accessible column headers', () => {
    mockUseSessionData.mockReturnValue({
      sessions: [makeSession()],
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

    // Real <table> with <th scope="col"> headers (not sortable in the new design).
    for (const name of ['Date', 'Dur', 'Usage', 'AHI', 'Leak', 'Events', 'Event mix']) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
    }
    // Columns are not sortable — no aria-sort anywhere in the deck.
    expect(document.querySelector('[aria-sort]')).toBeNull();
  });

  it('displays summary-stat values in the small-multiples panel', () => {
    mockUseSessionData.mockReturnValue({
      sessions: [makeSession()],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSummaryStats.mockReturnValue({
      stats: makeMockStats({ meanAHI: 5.2, meanUsageHours: 7.0 }),
      loading: false,
      error: null,
    });

    render(<Dashboard />);

    // AHI cell shows the pooled mean AHI at 1 dp; Usage cell shows mean usage hours.
    expect(screen.getByText('5.2')).toBeInTheDocument();
    expect(screen.getByText('7.0')).toBeInTheDocument();
  });

  it('does not render the empty state while data is still loading', () => {
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

    // The deck header (with the <h1>) renders; the empty-state CTA does not.
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import your data/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'CPAP Analyzer' })).not.toBeInTheDocument();
  });
});
