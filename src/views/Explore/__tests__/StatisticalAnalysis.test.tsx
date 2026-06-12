import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@/stores/useAppStore';

// Mock useAnalysis to return controlled data
const mockUseAnalysis = vi.fn();
vi.mock('@/hooks/useAnalysis', () => ({
  useAnalysis: (...args: unknown[]) => mockUseAnalysis(...args),
}));

// Mock chart components to avoid Recharts/D3 rendering
vi.mock('@/components/charts', () => ({
  ChartContainer: ({
    title,
    children,
    loading,
    error,
  }: {
    title: string;
    children: React.ReactNode;
    loading?: boolean;
    error?: string | null;
  }) => (
    <div data-testid={`chart-container-${title}`}>
      {loading && <div>Loading chart…</div>}
      {error && <div role="alert">{error}</div>}
      {!loading && !error && children}
    </div>
  ),
  ThemedLineChart: () => <div data-testid="line-chart" />,
  ThemedBarChart: () => <div data-testid="bar-chart" />,
  CorrelationHeatmap: () => <div data-testid="heatmap" />,
  QQPlot: () => <div data-testid="qq-plot" />,
}));

// Mock CSS module
vi.mock('../StatisticalAnalysis.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { StatisticalAnalysis } from '@/views/Explore/StatisticalAnalysis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAnalysisResult(data: unknown, overrides: Record<string, unknown> = {}) {
  return {
    data,
    loading: false,
    error: null,
    metadata: {
      computedAt: new Date().toISOString(),
      computationTimeMs: 42,
      cacheVersion: 1,
      sampleSize: 30,
      warnings: [],
      assumptions: ['Normal distribution assumed'],
    },
    refetch: vi.fn(),
    ...overrides,
  };
}

function loadingResult() {
  return makeAnalysisResult(null, { loading: true, metadata: null });
}

function errorResult(message: string) {
  return makeAnalysisResult(null, { error: message, metadata: null });
}

describe('StatisticalAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      dateRange: {
        start: new Date('2025-01-01'),
        end: new Date('2025-06-01'),
      },
    });

    // Default: return valid descriptive stats for the initial tab
    mockUseAnalysis.mockImplementation((opts: { type: string }) => {
      if (opts.type === 'descriptive-stats') {
        return makeAnalysisResult({
          count: 100,
          mean: 3.5,
          median: 3.2,
          stdDev: 1.1,
          min: 0.5,
          max: 8.0,
          iqr: 1.5,
          skewness: 0.3,
          kurtosis: 2.8,
        });
      }
      return makeAnalysisResult(null);
    });
  });

  it('should render the page heading', () => {
    render(<StatisticalAnalysis />);
    expect(screen.getByText('Statistical Analysis')).toBeInTheDocument();
  });

  it('should render the metric selector', () => {
    render(<StatisticalAnalysis />);
    expect(screen.getByLabelText('Metric')).toBeInTheDocument();
  });

  it('should render the rolling window selector', () => {
    render(<StatisticalAnalysis />);
    expect(screen.getByLabelText('Rolling Window')).toBeInTheDocument();
  });

  it('should render all section tabs', () => {
    render(<StatisticalAnalysis />);

    expect(screen.getByText('Descriptive Stats')).toBeInTheDocument();
    expect(screen.getByText('Trends')).toBeInTheDocument();
    expect(screen.getByText('Distribution')).toBeInTheDocument();
    expect(screen.getByText('Correlation')).toBeInTheDocument();
    expect(screen.getByText('Hypothesis Testing')).toBeInTheDocument();
  });

  it('should default to the Descriptive Stats tab', () => {
    render(<StatisticalAnalysis />);

    const descriptiveTab = screen.getByText('Descriptive Stats');
    expect(descriptiveTab).toHaveAttribute('aria-selected', 'true');
  });

  it('should display the descriptive statistics table with data', () => {
    render(<StatisticalAnalysis />);

    // Stats table should show computed values
    expect(screen.getByText('Count')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Mean')).toBeInTheDocument();
    expect(screen.getByText('3.500')).toBeInTheDocument();
    expect(screen.getByText('Median')).toBeInTheDocument();
    expect(screen.getByText('Std Dev')).toBeInTheDocument();
    expect(screen.getByText('Min')).toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
    expect(screen.getByText('IQR')).toBeInTheDocument();
    expect(screen.getByText('Skewness')).toBeInTheDocument();
    expect(screen.getByText('Kurtosis')).toBeInTheDocument();
  });

  it('should display metadata banner with sample size and timing', () => {
    render(<StatisticalAnalysis />);

    expect(screen.getByText(/Samples: 30/)).toBeInTheDocument();
  });

  it('should show loading spinner when analysis is loading', () => {
    mockUseAnalysis.mockReturnValue(loadingResult());

    render(<StatisticalAnalysis />);

    expect(screen.getByText('Computing descriptive statistics…')).toBeInTheDocument();
  });

  it('should show error message and retry button on failure', () => {
    mockUseAnalysis.mockReturnValue(errorResult('Engine crashed'));

    render(<StatisticalAnalysis />);

    expect(screen.getByText('Engine crashed')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('should show empty state when data is null', () => {
    mockUseAnalysis.mockReturnValue(makeAnalysisResult(null));

    render(<StatisticalAnalysis />);

    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('should switch tabs when clicking a different tab', async () => {
    const user = userEvent.setup();

    // Set up mocks for both descriptive and correlation
    mockUseAnalysis.mockImplementation((opts: { type: string }) => {
      if (opts.type === 'descriptive-stats') {
        return makeAnalysisResult({
          count: 50,
          mean: 3.5,
          median: 3.2,
          stdDev: 1.1,
          min: 0.5,
          max: 8.0,
          iqr: 1.5,
          skewness: 0.3,
          kurtosis: 2.8,
        });
      }
      if (opts.type === 'correlation-matrix') {
        return makeAnalysisResult({
          labels: ['ahi', 'leakMedian'],
          matrix: [
            [1, -0.3],
            [-0.3, 1],
          ],
        });
      }
      return makeAnalysisResult(null);
    });

    render(<StatisticalAnalysis />);

    // Click Correlation tab
    await user.click(screen.getByText('Correlation'));

    const correlationTab = screen.getByText('Correlation');
    expect(correlationTab).toHaveAttribute('aria-selected', 'true');
  });

  it('should implement roving tabindex on the tablist', () => {
    render(<StatisticalAnalysis />);

    const selected = screen.getByRole('tab', { selected: true });
    expect(selected).toHaveAttribute('tabindex', '0');

    screen
      .getAllByRole('tab')
      .filter((t) => t.getAttribute('aria-selected') !== 'true')
      .forEach((t) => expect(t).toHaveAttribute('tabindex', '-1'));
  });

  it('should move focus with ArrowRight/ArrowLeft without activating (manual activation)', async () => {
    const user = userEvent.setup();
    render(<StatisticalAnalysis />);

    const firstTab = screen.getByRole('tab', { name: 'Descriptive Stats' });
    const secondTab = screen.getByRole('tab', { name: 'Trends' });

    firstTab.focus();
    expect(firstTab).toHaveFocus();

    await user.keyboard('{ArrowRight}');

    // Focus moved, but active tab did NOT change (manual activation)
    expect(secondTab).toHaveFocus();
    expect(firstTab).toHaveAttribute('aria-selected', 'true');
    expect(secondTab).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowLeft}');
    expect(firstTab).toHaveFocus();
  });

  it('should wrap focus around with arrow keys', async () => {
    const user = userEvent.setup();
    render(<StatisticalAnalysis />);

    const firstTab = screen.getByRole('tab', { name: 'Descriptive Stats' });
    const lastTab = screen.getByRole('tab', { name: 'Hypothesis Testing' });

    firstTab.focus();
    await user.keyboard('{ArrowLeft}');
    expect(lastTab).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(firstTab).toHaveFocus();
  });

  it('should move focus to first/last tab with Home/End', async () => {
    const user = userEvent.setup();
    render(<StatisticalAnalysis />);

    const firstTab = screen.getByRole('tab', { name: 'Descriptive Stats' });
    const lastTab = screen.getByRole('tab', { name: 'Hypothesis Testing' });

    firstTab.focus();
    await user.keyboard('{End}');
    expect(lastTab).toHaveFocus();

    await user.keyboard('{Home}');
    expect(firstTab).toHaveFocus();
  });

  it('should activate the focused tab with Enter and Space', async () => {
    const user = userEvent.setup();

    mockUseAnalysis.mockImplementation((opts: { type: string }) => {
      if (opts.type === 'descriptive-stats') {
        return makeAnalysisResult({
          count: 50,
          mean: 3.5,
          median: 3.2,
          stdDev: 1.1,
          min: 0.5,
          max: 8.0,
          iqr: 1.5,
          skewness: 0.3,
          kurtosis: 2.8,
        });
      }
      if (opts.type === 'correlation-matrix') {
        return makeAnalysisResult({
          labels: ['ahi', 'leakMedian'],
          matrix: [
            [1, -0.3],
            [-0.3, 1],
          ],
        });
      }
      return makeAnalysisResult(null);
    });

    render(<StatisticalAnalysis />);

    const trendsTab = screen.getByText('Trends');
    const correlationTab = screen.getByText('Correlation');

    // Focus the Trends tab and activate with Enter
    trendsTab.focus();
    await user.keyboard('{Enter}');
    expect(trendsTab).toHaveAttribute('aria-selected', 'true');

    // Focus the Correlation tab and activate with Space
    correlationTab.focus();
    await user.keyboard('[Space]');
    expect(correlationTab).toHaveAttribute('aria-selected', 'true');
  });

  it('should call useAnalysis with the selected metric', async () => {
    const user = userEvent.setup();
    render(<StatisticalAnalysis />);

    // Change metric
    await user.selectOptions(screen.getByLabelText('Metric'), 'leakMedian');

    // useAnalysis should have been called with the new metric
    const calls = mockUseAnalysis.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall?.[0]).toMatchObject({
      type: 'descriptive-stats',
      parameters: { metric: 'leakMedian' },
    });
  });

  it('should have accessible stat table with aria-label', () => {
    render(<StatisticalAnalysis />);

    const table = screen.getByRole('table');
    expect(table).toHaveAttribute('aria-label', 'Descriptive statistics for AHI');
  });
});
