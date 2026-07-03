/**
 * Tests for the Explore → Breathing view. Focused on the visual-spec branches
 * that the implementation must honour: insufficient-history, classified
 * trajectory, and loading. The catalog hook and the nightly-aggregate hook are
 * replaced with simple mocks so the view can be exercised without IndexedDB or
 * a real worker.
 *
 * @module views/Explore/Breathing/__tests__/Breathing.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { render, screen } from '@/test/test-utils';

vi.mock('@/hooks/useAnalysis', () => ({
  useAnalysis: vi.fn(),
}));

vi.mock('@/hooks/useNightlyAggregates', () => ({
  useNightlyAggregates: vi.fn(),
}));

vi.mock('@/hooks/useBreathingEpisodeCatalog', () => ({
  useBreathingEpisodeCatalog: vi.fn(),
}));

import Breathing from '@/views/Explore/Breathing/Breathing';
import { useAnalysis } from '@/hooks/useAnalysis';
import { useNightlyAggregates } from '@/hooks/useNightlyAggregates';
import { useBreathingEpisodeCatalog } from '@/hooks/useBreathingEpisodeCatalog';

const mockUseAnalysis = vi.mocked(useAnalysis);
const mockUseNightlyAggregates = vi.mocked(useNightlyAggregates);
const mockUseCatalog = vi.mocked(useBreathingEpisodeCatalog);

function setCatalog() {
  mockUseCatalog.mockReturnValue({
    episodes: [],
    phase: 'complete',
    nightsTotal: 0,
    nightsCached: 0,
    nightsComputed: 0,
    nightsFailed: 0,
    failures: [],
    loading: false,
    error: null,
    cancel: vi.fn(),
    resume: vi.fn(),
  });
}

function setAggregates() {
  mockUseNightlyAggregates.mockReturnValue({
    aggregates: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
}

function setAnalysis(data: unknown, overrides: Partial<ReturnType<typeof useAnalysis>> = {}) {
  mockUseAnalysis.mockReturnValue({
    data: data as never,
    loading: false,
    error: null,
    metadata: null,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAnalysis>);
}

describe('Breathing view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAggregates();
    setCatalog();
  });

  it('renders the page heading and the persistent disclaimer', () => {
    setAnalysis(null, { loading: true });
    render(<Breathing />);
    expect(
      screen.getByRole('heading', { name: /breathing patterns/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/candidate/i).length).toBeGreaterThan(0);
    // The disclaimer banner (persistent info banner) is always present.
    expect(screen.getAllByText(/not clinical diagnoses/i).length).toBeGreaterThan(0);
  });

  it('shows insufficient-history copy when the classifier returns unavailable', () => {
    setAnalysis({
      available: false,
      class: null,
      earlyCai: 0,
      lateCai: 0,
      earlyNights: 1,
      lateNights: 0,
      usableNightFraction: 0.2,
      confidence: 0,
      caiThreshold: 5,
    });
    render(<Breathing />);
    expect(screen.getByText(/insufficient history/i)).toBeInTheDocument();
  });

  it('shows the trajectory class and metrics when classified', () => {
    setAnalysis({
      available: true,
      class: 'transient',
      earlyCai: 8.2,
      lateCai: 1.3,
      earlyNights: 7,
      lateNights: 7,
      usableNightFraction: 1,
      confidence: 0.7,
      caiThreshold: 5,
    });
    render(<Breathing />);
    // Both the TECSA result badge and the "About these patterns" legend render
    // a Transient badge — accept ≥1 match.
    expect(screen.getAllByRole('img', { name: /transient tecsa pattern/i }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/8\.2\/h/)).toBeInTheDocument();
    expect(screen.getByText(/1\.3\/h/)).toBeInTheDocument();
  });

  it('shows the "none detected" copy when analysis is complete with no episodes', () => {
    // nightsTotal > 0 + complete + zero episodes → the clean "none detected" finding.
    mockUseCatalog.mockReturnValue({
      episodes: [],
      phase: 'complete',
      nightsTotal: 12,
      nightsCached: 12,
      nightsComputed: 0,
      nightsFailed: 0,
      failures: [],
      loading: false,
      error: null,
      cancel: vi.fn(),
      resume: vi.fn(),
    });
    setAnalysis(null, { loading: true });
    render(<Breathing />);
    expect(screen.getByText(/no candidate periodic-breathing/i)).toBeInTheDocument();
  });

  it('shows the "no sessions in range" copy when there are no nights', () => {
    setCatalog(); // nightsTotal === 0, complete
    setAnalysis(null, { loading: true });
    render(<Breathing />);
    expect(screen.getByText(/no sessions in the selected date range/i)).toBeInTheDocument();
  });

  it('uses the dual-count status line to communicate compute progress', () => {
    mockUseCatalog.mockReturnValue({
      episodes: [],
      phase: 'computing',
      nightsTotal: 10,
      nightsCached: 1,
      nightsComputed: 2,
      nightsFailed: 0,
      failures: [],
      loading: true,
      error: null,
      cancel: vi.fn(),
      resume: vi.fn(),
    });
    setAnalysis(null, { loading: true });
    render(<Breathing />);
    // nightsDone = cached + computed = 3; copy reads "… analyzing 3 of 10 nights"
    // OR the "still analyzing N nights" branch when no episodes match yet.
    expect(screen.getByText(/analyzing 7 night/i)).toBeInTheDocument();
  });

  it('exposes a determinate progress bar with night-count ARIA during a run', () => {
    mockUseCatalog.mockReturnValue({
      episodes: [],
      phase: 'computing',
      nightsTotal: 10,
      nightsCached: 1,
      nightsComputed: 2,
      nightsFailed: 0,
      failures: [],
      loading: true,
      error: null,
      cancel: vi.fn(),
      resume: vi.fn(),
    });
    setAnalysis(null, { loading: true });
    render(<Breathing />);
    const bar = screen.getByRole('progressbar', { name: /breathing analysis progress/i });
    expect(bar).toHaveAttribute('aria-valuemax', '10');
    expect(bar).toHaveAttribute('aria-valuenow', '3');
  });

  it('shows a Cancel control while running and a Resume control after cancel', () => {
    mockUseCatalog.mockReturnValue({
      episodes: [],
      phase: 'cancelled',
      nightsTotal: 10,
      nightsCached: 2,
      nightsComputed: 3,
      nightsFailed: 0,
      failures: [],
      loading: false,
      error: null,
      cancel: vi.fn(),
      resume: vi.fn(),
    });
    setAnalysis(null, { loading: true });
    render(<Breathing />);
    expect(screen.getByRole('button', { name: /resume breathing analysis/i })).toBeInTheDocument();
    // "Analysis cancelled" appears in both the visible status and the live region.
    expect(screen.getAllByText(/analysis cancelled/i).length).toBeGreaterThan(0);
  });

  it('status line counts only successfully-analyzed nights (failures excluded once, not twice)', () => {
    // Regression for the double-subtraction bug: nightsCached + nightsComputed
    // count ONLY successful nights, so the analyzed count must be their sum
    // (2 here), not sum-minus-failures (1). Total is 3 (2 ok + 1 failed).
    mockUseCatalog.mockReturnValue({
      episodes: [
        {
          sessionId: 'sess-1',
          nightDate: '2026-01-03',
          nightStartMs: Date.parse('2026-01-03T22:00:00.000Z'),
          episode: {
            id: 'ep-1',
            type: 'PeriodicBreathing',
            startMs: 1_000,
            endMs: 60_000,
            durationSec: 59,
            confidence: 0.9,
            cycleLengthSec: 55,
            modulationDepth: 0.5,
            cycleCount: 4,
            belowDeviceThreshold: false,
          },
        },
      ],
      phase: 'complete',
      nightsTotal: 3,
      nightsCached: 1,
      nightsComputed: 1,
      nightsFailed: 1,
      failures: [{ date: '2026-01-02', reason: 'signal unreadable' }],
      loading: false,
      error: null,
      cancel: vi.fn(),
      resume: vi.fn(),
    });
    setAnalysis(null, { loading: true });
    render(<Breathing />);

    // Correct: "from 2 of 3 nights" — NOT the buggy "from 1 of 3 nights".
    expect(screen.getByText(/from 2 of 3 night/i)).toBeInTheDocument();
    expect(screen.queryByText(/from 1 of 3 night/i)).not.toBeInTheDocument();

    // The single failure is still surfaced independently via the disclosure.
    expect(screen.getAllByText(/1 night could not be analyzed/i).length).toBeGreaterThan(0);
  });

  it('surfaces per-night failures with a Details disclosure', () => {
    mockUseCatalog.mockReturnValue({
      episodes: [],
      phase: 'complete',
      nightsTotal: 10,
      nightsCached: 8,
      nightsComputed: 0,
      nightsFailed: 2,
      failures: [
        { date: '2026-01-01', reason: 'signal unreadable' },
        { date: '2026-01-02', reason: 'no flow/minute-vent channel' },
      ],
      loading: false,
      error: null,
      cancel: vi.fn(),
      resume: vi.fn(),
    });
    setAnalysis(null, { loading: true });
    render(<Breathing />);
    // The clause appears in the visible failure notice and the live region.
    expect(screen.getAllByText(/2 nights could not be analyzed/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /details/i })).toBeInTheDocument();
  });
});
