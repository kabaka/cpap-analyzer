/**
 * Tests for {@link WebLLMProvider.prefetch} and the shared abort-aware engine
 * creation (the Stop-during-download fix). The `@mlc-ai/web-llm` module is
 * dynamically imported by the provider, so we mock it here; the worker is
 * injected via `createWorker` so we assert `terminate()` is called on abort.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LLMError } from '../../types';
import type { ModelLoadProgress } from '../../types';
import { WebLLMProvider } from '../webllmProvider';

// ── Mock the WebLLM SDK. `CreateWebWorkerMLCEngine` is controllable per test. ──

const createEngineMock = vi.fn();

vi.mock('@mlc-ai/web-llm', () => ({
  CreateWebWorkerMLCEngine: (...args: unknown[]) => createEngineMock(...args),
  hasModelInCache: vi.fn(async () => false),
}));

/** A fake Worker that records `terminate()` calls. */
function makeFakeWorker(): Worker & { terminated: boolean } {
  const worker = {
    terminated: false,
    terminate() {
      this.terminated = true;
    },
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return worker as unknown as Worker & { terminated: boolean };
}

/** A fake engine with a recordable `unload()`. */
function makeFakeEngine(): { unload: ReturnType<typeof vi.fn> } {
  return { unload: vi.fn(async () => undefined) };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('WebLLMProvider.prefetch', () => {
  it('resolves on success, forwards progress, then unloads + terminates the worker', async () => {
    const engine = makeFakeEngine();
    const worker = makeFakeWorker();
    createEngineMock.mockImplementation(
      async (
        _worker: Worker,
        _modelId: string,
        opts: { initProgressCallback: (r: { progress?: number; text?: string }) => void },
      ) => {
        opts.initProgressCallback({ progress: 0.5, text: 'Fetching param 1/2' });
        opts.initProgressCallback({ progress: 1, text: 'Loading model into GPU' });
        return engine;
      },
    );

    const reports: ModelLoadProgress[] = [];
    const provider = new WebLLMProvider({
      modelId: 'M',
      hasWebGPU: () => true,
      createWorker: () => worker,
    });

    await provider.prefetch({ onProgress: (p) => reports.push(p) });

    expect(createEngineMock).toHaveBeenCalledOnce();
    expect(reports.map((r) => r.phase)).toEqual(['downloading', 'loading']);
    expect(reports[0]?.fraction).toBe(0.5);
    // Weights cached, GPU released, worker dropped — no leak.
    expect(engine.unload).toHaveBeenCalledOnce();
    expect(worker.terminated).toBe(true);
  });

  it('aborting DURING init terminates the worker and rejects with an aborted LLMError', async () => {
    const worker = makeFakeWorker();
    const controller = new AbortController();

    // The engine "download" never resolves on its own; the abort (which
    // terminates the worker) is what ends it. We model that here by rejecting
    // once the worker is terminated (mirrors a terminated worker's pending init).
    createEngineMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          const tick = setInterval(() => {
            if (worker.terminated) {
              clearInterval(tick);
              reject(new Error('worker terminated'));
            }
          }, 1);
        }),
    );

    const provider = new WebLLMProvider({
      modelId: 'M',
      hasWebGPU: () => true,
      createWorker: () => worker,
    });

    const promise = provider.prefetch({ signal: controller.signal });
    // Abort mid-download: the listener must terminate the worker.
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(LLMError);
    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
    expect(worker.terminated).toBe(true);
  });

  it('rejects with aborted when the signal is already aborted', async () => {
    const worker = makeFakeWorker();
    const provider = new WebLLMProvider({
      modelId: 'M',
      hasWebGPU: () => true,
      createWorker: () => worker,
    });
    await expect(provider.prefetch({ signal: AbortSignal.abort() })).rejects.toMatchObject({
      kind: 'aborted',
    });
    // We never even created the engine.
    expect(createEngineMock).not.toHaveBeenCalled();
  });

  it('throws webgpu-unsupported when WebGPU is absent', async () => {
    const provider = new WebLLMProvider({ modelId: 'M', hasWebGPU: () => false });
    await expect(provider.prefetch({})).rejects.toMatchObject({ kind: 'webgpu-unsupported' });
  });

  it('throws model-not-downloaded when no model is selected', async () => {
    const provider = new WebLLMProvider({ modelId: null, hasWebGPU: () => true });
    await expect(provider.prefetch({})).rejects.toMatchObject({ kind: 'model-not-downloaded' });
  });

  it('maps an OOM init failure to model-load-failed', async () => {
    const worker = makeFakeWorker();
    createEngineMock.mockRejectedValue(new Error('Out of memory while loading'));
    const provider = new WebLLMProvider({
      modelId: 'M',
      hasWebGPU: () => true,
      createWorker: () => worker,
    });
    await expect(provider.prefetch({})).rejects.toMatchObject({ kind: 'model-load-failed' });
    // The worker is terminated even on a failed init (no leak).
    expect(worker.terminated).toBe(true);
  });
});

describe('WebLLMProvider.generate (Stop during model load)', () => {
  it('terminates the worker and throws aborted when aborted while loading', async () => {
    const worker = makeFakeWorker();
    const controller = new AbortController();
    createEngineMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          const tick = setInterval(() => {
            if (worker.terminated) {
              clearInterval(tick);
              reject(new Error('worker terminated'));
            }
          }, 1);
        }),
    );

    const provider = new WebLLMProvider({
      modelId: 'M',
      hasWebGPU: () => true,
      createWorker: () => worker,
    });

    const iter = provider.generate({
      context: {} as never,
      systemPrompt: 's',
      userPrompt: 'u',
      signal: controller.signal,
    });
    const next = iter[Symbol.asyncIterator]().next();
    controller.abort();

    await expect(next).rejects.toMatchObject({ kind: 'aborted' });
    expect(worker.terminated).toBe(true);
  });
});
