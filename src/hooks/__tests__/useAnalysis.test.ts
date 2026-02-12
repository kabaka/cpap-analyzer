import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Mock the AnalysisEngine before importing useAnalysis
const mockExecute = vi.fn();

vi.mock('@/services/analysis/AnalysisEngine', () => ({
  AnalysisEngine: vi.fn().mockImplementation(() => ({
    execute: mockExecute,
  })),
}));

vi.mock('@/services/analysis/createDataProviderAdapter', () => ({
  createDataProviderAdapter: vi.fn().mockReturnValue({}),
}));

// We need to reset the engine singleton between tests
// by resetting the module cache
import { useAnalysis } from '@/hooks/useAnalysis';
import type { AnalysisOutput, AnalysisMetadata } from '@/types';
import { useAppStore } from '@/stores/useAppStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetadata(overrides: Partial<AnalysisMetadata> = {}): AnalysisMetadata {
  return {
    computedAt: new Date().toISOString(),
    computationTimeMs: 42,
    cacheVersion: 1,
    sampleSize: 100,
    warnings: [],
    assumptions: ['Normal distribution assumed'],
    ...overrides,
  };
}

function makeOutput(results: unknown, metadata?: Partial<AnalysisMetadata>): AnalysisOutput {
  return {
    type: 'test-analysis',
    dateRange: { start: '2025-01-01', end: '2025-06-01' },
    results,
    metadata: makeMetadata(metadata),
  };
}

describe('useAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set a stable date range in the app store so hook deps are stable
    useAppStore.setState({
      dateRange: {
        start: new Date('2025-01-01'),
        end: new Date('2025-06-01'),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return loading=true initially then resolve with data', async () => {
    const resultData = { mean: 3.5, count: 100 };
    mockExecute.mockResolvedValueOnce(makeOutput(resultData));

    const { result } = renderHook(() =>
      useAnalysis({ type: 'descriptive-stats', parameters: { metric: 'ahi' } }),
    );

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(resultData);
    expect(result.current.error).toBeNull();
    expect(result.current.metadata).toBeDefined();
    expect(result.current.metadata?.sampleSize).toBe(100);
  });

  it('should return error on failure', async () => {
    mockExecute.mockRejectedValueOnce(new Error('Computation failed'));

    const { result } = renderHook(() =>
      useAnalysis({ type: 'descriptive-stats', parameters: { metric: 'ahi' } }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Computation failed');
    expect(result.current.data).toBeNull();
    expect(result.current.metadata).toBeNull();
  });

  it('should return generic error message for non-Error throws', async () => {
    mockExecute.mockRejectedValueOnce('string error');

    const { result } = renderHook(() => useAnalysis({ type: 'descriptive-stats' }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Analysis failed');
  });

  it('should not execute when enabled=false', async () => {
    const { result } = renderHook(() => useAnalysis({ type: 'descriptive-stats', enabled: false }));

    // Give it a tick
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should re-fetch when the analysis type changes', async () => {
    const result1 = { mean: 3.5 };
    const result2 = { mean: 7.0 };
    mockExecute
      .mockResolvedValueOnce(makeOutput(result1))
      .mockResolvedValueOnce(makeOutput(result2));

    const { result, rerender } = renderHook(
      (props: { type: string }) => useAnalysis({ type: props.type }),
      { initialProps: { type: 'descriptive-stats' } },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toEqual(result1);

    rerender({ type: 'correlation-matrix' });

    await waitFor(() => {
      expect(result.current.data).toEqual(result2);
    });

    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('should re-fetch when parameters change', async () => {
    const result1 = { mean: 3.5 };
    const result2 = { mean: 10.2 };
    mockExecute
      .mockResolvedValueOnce(makeOutput(result1))
      .mockResolvedValueOnce(makeOutput(result2));

    const { result, rerender } = renderHook(
      (props: { params: Record<string, unknown> }) =>
        useAnalysis({ type: 'descriptive-stats', parameters: props.params }),
      { initialProps: { params: { metric: 'ahi' } } },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toEqual(result1);

    rerender({ params: { metric: 'leakMedian' } });

    await waitFor(() => {
      expect(result.current.data).toEqual(result2);
    });

    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('should re-fetch when dateRange changes', async () => {
    const result1 = { mean: 3.5 };
    const result2 = { mean: 8.0 };
    mockExecute
      .mockResolvedValueOnce(makeOutput(result1))
      .mockResolvedValueOnce(makeOutput(result2));

    const { result, rerender } = renderHook(
      (props: { dateRange: { start: Date; end: Date } }) =>
        useAnalysis({ type: 'descriptive-stats', dateRange: props.dateRange }),
      {
        initialProps: {
          dateRange: { start: new Date('2025-01-01'), end: new Date('2025-03-01') },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toEqual(result1);

    rerender({
      dateRange: { start: new Date('2025-04-01'), end: new Date('2025-06-01') },
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(result2);
    });
  });

  it('should support refetch to re-run the analysis', async () => {
    const result1 = { mean: 3.5 };
    const result2 = { mean: 4.0 };
    mockExecute
      .mockResolvedValueOnce(makeOutput(result1))
      .mockResolvedValueOnce(makeOutput(result2));

    const { result } = renderHook(() => useAnalysis({ type: 'descriptive-stats' }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toEqual(result1);

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(result2);
    });

    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('should not report AbortError as an error', async () => {
    mockExecute.mockImplementation(async (_input: unknown, signal: AbortSignal) => {
      // Simulate a delayed operation that gets aborted
      return new Promise((_resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('should not reach'));
        }, 1000);

        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const { result, unmount } = renderHook(() => useAnalysis({ type: 'descriptive-stats' }));

    // Unmount triggers cleanup → abort
    unmount();

    // The error should not be set for AbortError
    expect(result.current.error).toBeNull();
  });

  it('should pass AbortSignal to engine.execute', async () => {
    mockExecute.mockResolvedValueOnce(makeOutput({ ok: true }));

    renderHook(() => useAnalysis({ type: 'test' }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });

    const callArgs = mockExecute.mock.calls[0];
    expect(callArgs).toHaveLength(2);
    expect(callArgs?.[1]).toBeInstanceOf(AbortSignal);
  });

  it('should pass formatted date range and parameters to engine', async () => {
    mockExecute.mockResolvedValueOnce(makeOutput({ ok: true }));

    // Use explicit local dates to avoid timezone-shift issues
    const start = new Date(2025, 2, 15); // March 15, 2025 local
    const end = new Date(2025, 5, 15); // June 15, 2025 local

    renderHook(() =>
      useAnalysis({
        type: 'rolling-mean',
        parameters: { metric: 'ahi', window: 7 },
        dateRange: { start, end },
      }),
    );

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });

    const input = mockExecute.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      type: 'rolling-mean',
      dateRange: { start: '2025-03-15', end: '2025-06-15' },
      parameters: { metric: 'ahi', window: 7 },
    });
  });

  it('should default enabled to true', async () => {
    mockExecute.mockResolvedValueOnce(makeOutput({ ok: true }));

    renderHook(() => useAnalysis({ type: 'test' }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  it('should fall back to useAppStore dateRange when no override provided', async () => {
    // Use explicit local dates to avoid timezone-shift issues
    useAppStore.setState({
      dateRange: {
        start: new Date(2025, 1, 1), // Feb 1, 2025 local
        end: new Date(2025, 4, 1), // May 1, 2025 local
      },
    });

    mockExecute.mockResolvedValueOnce(makeOutput({ ok: true }));

    renderHook(() => useAnalysis({ type: 'test' }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
    });

    const input = mockExecute.mock.calls[0]?.[0];
    expect(input?.dateRange).toEqual({ start: '2025-02-01', end: '2025-05-01' });
  });
});
