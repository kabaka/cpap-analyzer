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

function setCatalog(empty = true) {
  mockUseCatalog.mockReturnValue({
    episodes: empty ? [] : [],
    nightsComputed: empty ? 0 : 0,
    nightsTotal: 0,
    capped: false,
    loading: false,
    error: null,
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

  it('shows the catalog "no episodes" copy when the catalog is empty and not loading', () => {
    setAnalysis(null, { loading: true });
    render(<Breathing />);
    expect(screen.getByText(/no candidate periodic-breathing/i)).toBeInTheDocument();
  });

  it('uses the catalog status line to communicate progress', () => {
    mockUseCatalog.mockReturnValue({
      episodes: [],
      nightsComputed: 3,
      nightsTotal: 10,
      capped: false,
      loading: true,
      error: null,
    });
    setAnalysis(null, { loading: true });
    render(<Breathing />);
    expect(screen.getByText(/3 of 10 nights/i)).toBeInTheDocument();
  });
});
