/**
 * `useModelDownload` — the small dedicated hook that owns the Settings on-device
 * (WebLLM) model-download lifecycle (Surface A of
 * `docs/design/ai-insights-model-download-ux.md`).
 *
 * It is intentionally narrow: it drives a single model's weights download via
 * {@link WebLLMProvider.prefetch}, owns the `AbortController`, and exposes a
 * `{ state, progress, error }` view-model plus `start()` / `cancel()` / `reset()`
 * actions. It performs ZERO egress beyond the model CDN the provider already
 * uses, and nothing about a download ever leaves the device.
 *
 * The lifecycle (spec §3.1):
 *   `idle → starting → downloading → loading → done | error | cancelled`
 *
 * - `starting`     — `start()` called, no `fraction` yet (pre-first-byte).
 * - `downloading`  — provider reported `phase: 'downloading'`.
 * - `loading`      — provider reported `phase: 'loading'` (warm-up).
 * - `done`         — `prefetch` resolved; the weights are cached. The caller
 *                    re-probes availability so the picker flips to "Ready".
 * - `cancelled`    — the user cancelled; the in-flight download was terminated.
 * - `error`        — a classified {@link LLMError} (network / OOM / unknown).
 *
 * The provider factory is injected (default: a real {@link WebLLMProvider}) so
 * tests drive the state machine with a fake provider and no worker.
 *
 * @module hooks/useModelDownload
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { WebLLMProvider } from '@/services/llm/providers/webllmProvider';
import { LLMError } from '@/services/llm/types';
import type { LLMProvider, ModelLoadProgress } from '@/services/llm/types';

/** The download lifecycle state (spec §3.1). */
export type ModelDownloadState =
  | 'idle'
  | 'starting'
  | 'downloading'
  | 'loading'
  | 'done'
  | 'error'
  | 'cancelled';

/** A provider that can prefetch — the hook only needs the optional `prefetch`. */
export type DownloadProvider = Pick<LLMProvider, 'prefetch'>;

/** The hook's return value. */
export interface UseModelDownload {
  /** The current lifecycle state. */
  readonly state: ModelDownloadState;
  /** The latest model-load progress, or `null` before the first report. */
  readonly progress: ModelLoadProgress | null;
  /** The classified error, or `null` unless `state === 'error'`. */
  readonly error: LLMError | null;
  /** Whether a download is currently in flight (`starting`/`downloading`/`loading`). */
  readonly isActive: boolean;
  /** Start the download for the configured model. No-op while already active. */
  start: () => void;
  /** Cancel an in-flight download (terminates the fetch → `cancelled`). */
  cancel: () => void;
  /** Reset to `idle` (e.g. when the selected model changes). */
  reset: () => void;
}

/** Build the default real provider for `modelId`. */
function defaultProviderFactory(modelId: string | null): DownloadProvider {
  return new WebLLMProvider({ modelId });
}

/**
 * Drive a single WebLLM model download.
 *
 * @param modelId the selected model id (or `null` — `start()` is then a no-op).
 * @param providerFactory injectable provider builder (defaults to a real
 *   {@link WebLLMProvider}); overridden in tests.
 */
export function useModelDownload(
  modelId: string | null,
  providerFactory: (modelId: string | null) => DownloadProvider = defaultProviderFactory,
): UseModelDownload {
  const [state, setState] = useState<ModelDownloadState>('idle');
  const [progress, setProgress] = useState<ModelLoadProgress | null>(null);
  const [error, setError] = useState<LLMError | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Monotonic run id so a stale download that resolves late can't mutate state.
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const reset = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current += 1;
    setState('idle');
    setProgress(null);
    setError(null);
  }, []);

  const cancel = useCallback((): void => {
    // Abort terminates the in-flight fetch; the provider rejects with `aborted`,
    // which the run loop maps to `cancelled`.
    abortRef.current?.abort();
  }, []);

  const start = useCallback((): void => {
    if (modelId === null || modelId.length === 0) return;
    const provider = providerFactory(modelId);
    if (typeof provider.prefetch !== 'function') return;

    // Supersede any prior run and take a fresh controller + id.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const myRunId = ++runIdRef.current;

    setState('starting');
    setProgress(null);
    setError(null);

    void (async () => {
      try {
        await provider.prefetch?.({
          signal: controller.signal,
          onProgress: (p: ModelLoadProgress) => {
            if (runIdRef.current !== myRunId || !mountedRef.current) return;
            setProgress(p);
            setState(p.phase === 'loading' ? 'loading' : 'downloading');
          },
        });
        if (runIdRef.current !== myRunId || !mountedRef.current) return;
        setState('done');
      } catch (err) {
        if (runIdRef.current !== myRunId || !mountedRef.current) return;
        const llmError =
          err instanceof LLMError
            ? err
            : new LLMError('unknown', 'The model download failed.', {
                backend: 'webllm',
                cause: err,
              });
        if (llmError.kind === 'aborted') {
          setState('cancelled');
          return;
        }
        setError(llmError);
        setState('error');
      }
    })();
  }, [modelId, providerFactory]);

  return {
    state,
    progress,
    error,
    isActive: state === 'starting' || state === 'downloading' || state === 'loading',
    start,
    cancel,
    reset,
  };
}
