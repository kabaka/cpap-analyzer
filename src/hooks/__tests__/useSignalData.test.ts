import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── Module mocks ─────────────────────────────────────────────────
//
// useSignalData streams from OPFS and downsamples via a Web Worker. We mock
// both so the hook's branching logic (raw-vs-downsample, OPFS-unavailable,
// cancellation) can be exercised deterministically in jsdom without real OPFS
// or Workers.

const mockReadTimeRange = vi.fn();
const mockReadManifest = vi.fn();
const mockInitialize = vi.fn().mockResolvedValue(undefined);
let opfsSupported = true;

vi.mock('@/services/storage/OPFSService', () => {
  class MockOPFSService {
    static isSupported() {
      return opfsSupported;
    }
    initialize = mockInitialize;
    readTimeRange = mockReadTimeRange;
    readManifest = mockReadManifest;
  }
  return { OPFSService: MockOPFSService };
});

const mockLttb = vi.fn();
const mockDispose = vi.fn();
const mockCreateWorker = vi.fn(() => ({
  proxy: { lttb: mockLttb },
  dispose: mockDispose,
}));

vi.mock('@/services/workers/createWorker', () => ({
  createWorker: () => mockCreateWorker(),
}));

import { useSignalData } from '@/hooks/useSignalData';
import type { UseSignalDataParams } from '@/hooks/useSignalData';

function manifest(sampleRate = 25) {
  return {
    channels: [{ name: 'Flow', sampleRate, index: 0, unit: 'L/s', dtype: 'float32' }],
  };
}

const baseParams: UseSignalDataParams = {
  sessionId: 'sess-1',
  channel: 'Flow',
  startTime: 0,
  endTime: 10_000,
  viewportWidth: 100,
};

describe('useSignalData', () => {
  beforeEach(() => {
    opfsSupported = true;
    mockReadTimeRange.mockReset();
    mockReadManifest.mockReset();
    mockInitialize.mockClear();
    mockLttb.mockReset();
    mockDispose.mockClear();
    mockCreateWorker.mockClear();
    mockReadManifest.mockResolvedValue(manifest(25));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('skip conditions', () => {
    it('does not query OPFS when sessionId is undefined', async () => {
      const { result } = renderHook(() => useSignalData({ ...baseParams, sessionId: undefined }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toBeNull();
      expect(mockReadTimeRange).not.toHaveBeenCalled();
    });

    it('does not query OPFS when endTime <= startTime', async () => {
      const { result } = renderHook(() =>
        useSignalData({ ...baseParams, startTime: 100, endTime: 100 }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toBeNull();
      expect(mockReadTimeRange).not.toHaveBeenCalled();
    });

    it('does not query OPFS when viewportWidth <= 0', async () => {
      const { result } = renderHook(() => useSignalData({ ...baseParams, viewportWidth: 0 }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockReadTimeRange).not.toHaveBeenCalled();
    });
  });

  describe('OPFS-unavailable path', () => {
    it('surfaces a descriptive error and does not attempt to read data', async () => {
      opfsSupported = false;
      const { result } = renderHook(() => useSignalData(baseParams));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toMatch(/not supported/i);
      expect(result.current.data).toBeNull();
      expect(mockReadTimeRange).not.toHaveBeenCalled();
    });
  });

  describe('downsample-vs-raw decision', () => {
    it('returns raw data unchanged (and never spins up a worker) when length <= viewportWidth*2', async () => {
      // viewportWidth 100 → target 200 points. 150 samples is below target.
      const raw = new Float32Array(150).fill(1);
      mockReadTimeRange.mockResolvedValue(raw);

      const { result } = renderHook(() => useSignalData(baseParams));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.data).toBe(raw);
      expect(result.current.sampleRate).toBe(25); // straight from the manifest
      expect(result.current.error).toBeNull();
      expect(mockCreateWorker).not.toHaveBeenCalled();
      expect(mockLttb).not.toHaveBeenCalled();
    });

    it('downsamples via the worker when length > viewportWidth*2 and reports an effective sample rate', async () => {
      const raw = new Float32Array(5000).fill(1); // well above 200 target
      mockReadTimeRange.mockResolvedValue(raw);
      const downsampled = new Float32Array(200).fill(2);
      mockLttb.mockResolvedValue(downsampled);

      // 200 points over a 10_000ms window → effective rate = 200/10000*1000 = 20 Hz.
      const { result } = renderHook(() => useSignalData(baseParams));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
      expect(mockLttb).toHaveBeenCalledWith(raw, 200);
      expect(result.current.data).toBe(downsampled);
      expect(result.current.sampleRate).toBeCloseTo(20, 5);
      expect(result.current.error).toBeNull();
    });

    it('surfaces a worker/OPFS error as the hook error', async () => {
      mockReadTimeRange.mockRejectedValue(new Error('chunk read failed'));
      const { result } = renderHook(() => useSignalData(baseParams));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('chunk read failed');
      expect(result.current.data).toBeNull();
    });
  });

  describe('cancellation and cleanup', () => {
    it('does not set state after unmount (cancellation guard)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      let resolveRead!: (v: Float32Array) => void;
      mockReadTimeRange.mockReturnValue(
        new Promise<Float32Array>((res) => {
          resolveRead = res;
        }),
      );

      const { result, unmount } = renderHook(() => useSignalData(baseParams));
      // Still in-flight.
      expect(result.current.loading).toBe(true);

      unmount();

      // Resolve the read AFTER unmount — the cancelled flag must prevent any
      // setState, so React should log no "update on unmounted component" error.
      await act(async () => {
        resolveRead(new Float32Array(10));
        await Promise.resolve();
      });

      const sawUnmountWarning = errorSpy.mock.calls.some((c) => String(c[0]).includes('unmounted'));
      expect(sawUnmountWarning).toBe(false);
      errorSpy.mockRestore();
    });

    it('disposes the worker on unmount', async () => {
      const raw = new Float32Array(5000).fill(1);
      mockReadTimeRange.mockResolvedValue(raw);
      mockLttb.mockResolvedValue(new Float32Array(200));

      const { result, unmount } = renderHook(() => useSignalData(baseParams));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockCreateWorker).toHaveBeenCalledTimes(1);

      unmount();
      expect(mockDispose).toHaveBeenCalled();
    });

    it('re-queries when params change and reflects the new result', async () => {
      const first = new Float32Array(150).fill(1);
      const second = new Float32Array(150).fill(9);
      mockReadTimeRange.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

      const { result, rerender } = renderHook((p: UseSignalDataParams) => useSignalData(p), {
        initialProps: baseParams,
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toBe(first);

      rerender({ ...baseParams, startTime: 5_000, endTime: 15_000 });
      await waitFor(() => expect(result.current.data).toBe(second));
      expect(mockReadTimeRange).toHaveBeenCalledTimes(2);
    });
  });
});
