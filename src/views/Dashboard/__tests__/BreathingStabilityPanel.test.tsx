/**
 * Tests for the dashboard {@link BreathingStabilityPanel}. Covers the three
 * branches the visual spec calls out: insufficient-history, classified
 * trajectory, and external loading. The TECSA classifier is replaced through
 * the {@link useAnalysis} mock so the panel can be exercised without spinning
 * up the analysis worker.
 *
 * @module views/Dashboard/__tests__/BreathingStabilityPanel.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { render, screen } from '@/test/test-utils';

vi.mock('@/hooks/useAnalysis', () => ({
  useAnalysis: vi.fn(),
}));

import BreathingStabilityPanel from '@/views/Dashboard/panels/BreathingStabilityPanel';
import { useAnalysis } from '@/hooks/useAnalysis';

const mockUseAnalysis = vi.mocked(useAnalysis);

function withResult(data: unknown, overrides: Partial<ReturnType<typeof useAnalysis>> = {}) {
  return {
    data: data as never,
    loading: false,
    error: null,
    metadata: null,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAnalysis>;
}

describe('BreathingStabilityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the loading skeleton when the analysis is loading', () => {
    mockUseAnalysis.mockReturnValue(withResult(null, { loading: true }));
    render(<BreathingStabilityPanel />);
    expect(screen.getByText(/computing trajectory/i)).toBeInTheDocument();
  });

  it('shows the loading skeleton when the dashboard signals external loading', () => {
    // Even if useAnalysis returns data, externalLoading wins.
    mockUseAnalysis.mockReturnValue(
      withResult({
        available: true,
        class: 'obstructive',
        earlyCai: 1,
        lateCai: 1,
        earlyNights: 7,
        lateNights: 7,
        usableNightFraction: 1,
        confidence: 0.8,
        caiThreshold: 5,
      }),
    );
    render(<BreathingStabilityPanel loading />);
    expect(screen.getByText(/computing trajectory/i)).toBeInTheDocument();
  });

  it('shows the insufficient-history copy when the classifier returned unavailable', () => {
    mockUseAnalysis.mockReturnValue(
      withResult({
        available: false,
        class: null,
        earlyCai: 0,
        lateCai: 0,
        earlyNights: 2,
        lateNights: 1,
        usableNightFraction: 0.5,
        confidence: 0,
        caiThreshold: 5,
      }),
    );
    render(<BreathingStabilityPanel />);
    expect(screen.getByText(/insufficient history/i)).toBeInTheDocument();
    expect(screen.getByText(/2 early/i)).toBeInTheDocument();
    expect(screen.getByText(/1 late/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open breathing patterns/i })).toHaveAttribute(
      'href',
      '/explore/breathing',
    );
  });

  it('renders the classified trajectory with shape, copy, and link', () => {
    mockUseAnalysis.mockReturnValue(
      withResult({
        available: true,
        class: 'emergent',
        earlyCai: 0.5,
        lateCai: 8.4,
        earlyNights: 7,
        lateNights: 7,
        usableNightFraction: 1,
        confidence: 0.85,
        caiThreshold: 5,
      }),
    );
    render(<BreathingStabilityPanel />);
    // The trajectory label appears on the badge and again in the explainer copy.
    expect(screen.getAllByText(/emergent/i).length).toBeGreaterThan(0);
    // The non-colour redundant cue (shape role=img) is exposed.
    expect(screen.getByRole('img', { name: /emergent tecsa pattern/i })).toBeInTheDocument();
    // Card defaults to a left-border accent driven by data-tecsa-class.
    const card = screen.getByLabelText(/breathing stability/i);
    expect(card.getAttribute('data-tecsa-class')).toBe('emergent');
    expect(screen.getByText(/0\.5/)).toBeInTheDocument();
    expect(screen.getByText(/8\.4/)).toBeInTheDocument();
  });

  it('shows an error message when the analysis fails', () => {
    mockUseAnalysis.mockReturnValue(withResult(null, { error: 'kaboom' }));
    render(<BreathingStabilityPanel />);
    expect(screen.getByText(/kaboom/i)).toBeInTheDocument();
  });
});
