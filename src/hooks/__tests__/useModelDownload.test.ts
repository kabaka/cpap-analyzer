/**
 * Tests for {@link useModelDownload} — the Settings download lifecycle hook.
 * The provider is faked (no worker, no SDK) so we drive the state machine
 * directly.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LLMError } from '@/services/llm/types';
import type { ModelLoadProgress, PrefetchOptions } from '@/services/llm/types';

import { useModelDownload } from '../useModelDownload';
import type { DownloadProvider } from '../useModelDownload';

/** A fake provider whose `prefetch` is fully controllable. */
function fakeProvider(prefetch: DownloadProvider['prefetch']): DownloadProvider {
  return { prefetch };
}

describe('useModelDownload', () => {
  it('transitions starting → downloading → loading → done', async () => {
    let resolvePrefetch: (() => void) | undefined;
    const prefetch = vi.fn(async (opts: PrefetchOptions) => {
      opts.onProgress?.({ phase: 'downloading', fraction: 0.4, text: 'Fetching' });
      opts.onProgress?.({ phase: 'loading', fraction: null, text: 'Loading' });
      await new Promise<void>((resolve) => {
        resolvePrefetch = resolve;
      });
    });

    const { result } = renderHook(() => useModelDownload('M', () => fakeProvider(prefetch)));

    expect(result.current.state).toBe('idle');

    act(() => result.current.start());
    // Synchronously enters `starting`; the progress callbacks fire on the first
    // microtask of the awaited prefetch.
    await waitFor(() => expect(result.current.state).toBe('loading'));
    expect(result.current.progress?.phase).toBe('loading');

    act(() => resolvePrefetch?.());
    await waitFor(() => expect(result.current.state).toBe('done'));
  });

  it('cancel terminates and lands in cancelled (provider sees an aborted signal)', async () => {
    let sawAbort = false;
    const prefetch = vi.fn(
      (opts: PrefetchOptions) =>
        new Promise<void>((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            sawAbort = true;
            reject(new LLMError('aborted', 'stopped', { backend: 'webllm' }));
          });
        }),
    );

    const { result } = renderHook(() => useModelDownload('M', () => fakeProvider(prefetch)));

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('starting'));

    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.state).toBe('cancelled'));
    expect(sawAbort).toBe(true);
  });

  it('maps a non-abort failure to error with the classified LLMError', async () => {
    const prefetch = vi.fn(async () => {
      throw new LLMError('model-load-failed', 'OOM', { backend: 'webllm' });
    });
    const { result } = renderHook(() => useModelDownload('M', () => fakeProvider(prefetch)));

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error?.kind).toBe('model-load-failed');
  });

  it('start is a no-op when no model is selected', () => {
    const prefetch = vi.fn<(opts: PrefetchOptions) => Promise<void>>();
    const { result } = renderHook(() => useModelDownload(null, () => fakeProvider(prefetch)));
    act(() => result.current.start());
    expect(prefetch).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
  });

  it('reset returns to idle and clears progress', async () => {
    const prefetch = vi.fn(async (opts: PrefetchOptions) => {
      opts.onProgress?.({ phase: 'downloading', fraction: 0.5, text: 'x' } as ModelLoadProgress);
      await new Promise<void>(() => undefined);
    });
    const { result } = renderHook(() => useModelDownload('M', () => fakeProvider(prefetch)));

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('downloading'));

    act(() => result.current.reset());
    expect(result.current.state).toBe('idle');
    expect(result.current.progress).toBeNull();
  });
});
