/**
 * WebLLM (in-browser, WebGPU) backend — the privacy default (ADR 0024 §3).
 *
 * Runs a small model entirely on the device's GPU via `@mlc-ai/web-llm`. After
 * the one-time model-weights download (cached in the browser), inference is
 * **zero-egress**: no user data ever leaves the device.
 *
 * The engine runs inside a **Web Worker** (`webllm.worker.ts`) so the heavy
 * prefill/decode never blocks the UI thread — connected via WebLLM's
 * `CreateWebWorkerMLCEngine`. The `@mlc-ai/web-llm` package is **dynamically
 * imported inside `generate()`/`checkAvailability()`** so it never enters the
 * main bundle (it lands in its own async chunk).
 *
 * Availability is determined WITHOUT egress:
 * - `unsupported`     — no WebGPU (`navigator.gpu` absent).
 * - `needs-download`  — WebGPU present but the chosen model is not cached.
 * - `available`       — WebGPU present and the model is cached.
 *
 * Model-download / warm-up progress is reported via the optional
 * {@link GenerateOptions.onProgress} channel (an interface addition made for
 * this wave — see the docblock on that field). The shared {@link StreamChunk}
 * stream carries only generated narration, so a download phase that precedes
 * any token has no other channel.
 *
 * @module services/llm/providers/webllmProvider
 */

import { LLMError } from '../types';
import type {
  BackendAvailability,
  BackendCapabilities,
  GenerateOptions,
  LLMProvider,
  ModelLoadProgress,
  PrefetchOptions,
  StreamChunk,
} from '../types';

/** Resolved configuration for the WebLLM backend. */
export interface WebLLMProviderConfig {
  /** Curated MLC model id (e.g. `Llama-3.2-3B-Instruct-q4f16_1-MLC`), or `null`. */
  readonly modelId: string | null;
  /**
   * Factory for the engine worker (injected for testability and to let Vite
   * statically detect the `new Worker(new URL(...))` pattern at the call site).
   */
  readonly createWorker?: () => Worker;
  /**
   * Feature-detection hook (injected for testability). Returns whether WebGPU
   * is available in this environment. Defaults to checking `navigator.gpu`.
   */
  readonly hasWebGPU?: () => boolean;
  /**
   * Cache-probe hook (injected for testability). Returns whether the given
   * model's weights are already cached locally — used by `checkAvailability()`
   * WITHOUT any network call. Defaults to WebLLM's own cache check.
   */
  readonly isModelCached?: (modelId: string) => Promise<boolean>;
}

/** Minimal structural view of the WebLLM engine surface we use. */
interface WebLLMEngineLike {
  readonly chat: {
    readonly completions: {
      create(params: {
        stream: true;
        messages: ReadonlyArray<{ role: 'system' | 'user'; content: string }>;
        max_tokens?: number;
        stream_options?: { include_usage: boolean };
      }): Promise<
        AsyncIterable<{ choices: ReadonlyArray<{ delta: { content?: string | null } }> }>
      >;
    };
  };
  interruptGenerate(): void;
  unload(): Promise<void>;
}

/** Default WebGPU feature detection: a `gpu` adapter on `navigator`. */
function defaultHasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null;
}

/**
 * The handle returned by {@link createEngine}: the live engine plus its worker
 * and a teardown that detaches the abort listener. Bundling these lets the
 * caller `unload()`/`terminate()` deterministically on abort or error.
 */
interface EngineHandle {
  readonly engine: WebLLMEngineLike;
  readonly worker: Worker;
  /** Detach the init-phase abort listener (the worker is NOT terminated here). */
  readonly detachInitAbort: () => void;
}

/**
 * Create (provision + warm up) a WebLLM worker engine for `modelId`, honouring
 * `signal` **during the download/warm-up itself**.
 *
 * This is the heart of the Stop-during-download fix: the abort listener — which
 * `worker.terminate()`s the in-flight engine — is registered *before* the
 * `CreateWebWorkerMLCEngine` await and stays active until init resolves. WebLLM
 * has no way to cancel a mid-download `Create…`, so terminating the worker is
 * the hard stop that actually halts the network fetch. A terminated init
 * surfaces as an `aborted` {@link LLMError}.
 *
 * On any failure the worker is terminated so no worker (and its GPU context)
 * leaks; on success the caller owns teardown (`unload()` then drop the worker).
 */
async function createEngine(
  modelId: string,
  createWorker: () => Worker,
  signal: AbortSignal | undefined,
  onProgress: ((progress: ModelLoadProgress) => void) | undefined,
): Promise<EngineHandle> {
  if (signal?.aborted) {
    throw new LLMError('aborted', 'Model loading was stopped.', {
      backend: 'webllm',
      retryable: false,
    });
  }

  const webllm = await import('@mlc-ai/web-llm');
  const worker = createWorker();

  // Register the terminate-on-abort listener BEFORE awaiting the download so an
  // abort during the (multi-minute) provision actually stops it. `aborted` is
  // tracked so a termination is reported as `aborted`, not a generic load error.
  let abortedDuringInit = false;
  const onAbort = (): void => {
    abortedDuringInit = true;
    try {
      worker.terminate();
    } catch {
      // Best-effort — a terminated worker rejects the pending Create… await.
    }
  };
  // An abort that landed during the dynamic import above (before the listener
  // was attached) won't re-fire, so handle the already-aborted case explicitly:
  // terminate now and bail before kicking off the download.
  if (signal?.aborted) {
    onAbort();
    throw new LLMError('aborted', 'Model loading was stopped.', {
      backend: 'webllm',
      retryable: false,
    });
  }
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const engine = (await webllm.CreateWebWorkerMLCEngine(worker, modelId, {
      initProgressCallback: (report: { progress?: number; text?: string }) => {
        onProgress?.(toModelLoadProgress(report));
      },
    })) as unknown as WebLLMEngineLike;

    // A late abort that landed between the await resolving and here: tear the
    // fresh engine down and report it as aborted rather than returning a live
    // engine the caller believes was cancelled.
    if (abortedDuringInit || signal?.aborted) {
      signal?.removeEventListener('abort', onAbort);
      try {
        await engine.unload();
      } catch {
        // Ignore unload failures during teardown.
      }
      try {
        worker.terminate();
      } catch {
        // Ignore terminate failures during teardown.
      }
      throw new LLMError('aborted', 'Model loading was stopped.', {
        backend: 'webllm',
        retryable: false,
      });
    }

    return {
      engine,
      worker,
      detachInitAbort: () => signal?.removeEventListener('abort', onAbort),
    };
  } catch (err) {
    signal?.removeEventListener('abort', onAbort);
    // Always terminate so a failed/aborted init never leaks a worker.
    try {
      worker.terminate();
    } catch {
      // Ignore.
    }
    if (abortedDuringInit || signal?.aborted) {
      throw new LLMError('aborted', 'Model loading was stopped.', {
        backend: 'webllm',
        retryable: false,
        cause: err,
      });
    }
    throw mapWebLLMError(err);
  }
}

/** Map an arbitrary thrown value from engine init/generation onto an {@link LLMError}. */
export function mapWebLLMError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;

  const name =
    typeof err === 'object' && err !== null ? (err as { name?: string }).name : undefined;
  if (name === 'AbortError') {
    return new LLMError('aborted', 'Generation was stopped.', {
      backend: 'webllm',
      retryable: false,
      cause: err,
    });
  }

  const message =
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { message?: unknown }).message === 'string'
      ? (err as { message: string }).message
      : '';
  const lower = message.toLowerCase();

  if (lower.includes('webgpu') || lower.includes('gpu')) {
    return new LLMError('webgpu-unsupported', 'WebGPU is unavailable for on-device AI.', {
      backend: 'webllm',
      retryable: false,
      cause: err,
    });
  }
  if (lower.includes('out of memory') || lower.includes('oom')) {
    return new LLMError('model-load-failed', 'The on-device model ran out of memory.', {
      backend: 'webllm',
      retryable: false,
      cause: err,
    });
  }

  return new LLMError('model-load-failed', 'The on-device model could not be loaded.', {
    backend: 'webllm',
    retryable: false,
    cause: err,
  });
}

/**
 * Translate a WebLLM `initProgressCallback` report into our coarse
 * {@link ModelLoadProgress}. Exported for unit testing.
 *
 * WebLLM reports `{ progress: number; text: string }`; `progress` is a fraction
 * in `[0, 1]`. We classify the phase from the report text (it contains
 * "Fetching"/"Downloading" during the weights fetch, "Loading" during warm-up).
 */
export function toModelLoadProgress(report: {
  progress?: number;
  text?: string;
}): ModelLoadProgress {
  const text = report.text ?? '';
  const lower = text.toLowerCase();
  const phase: ModelLoadProgress['phase'] =
    lower.includes('fetch') || lower.includes('download') || lower.includes('cache')
      ? 'downloading'
      : 'loading';
  const fraction =
    typeof report.progress === 'number' && Number.isFinite(report.progress)
      ? Math.min(1, Math.max(0, report.progress))
      : null;
  return { phase, fraction, text };
}

/**
 * The WebLLM (on-device) provider.
 *
 * Capabilities are fixed `none`/`none` — nothing leaves the device for a
 * generation (the one-time weights download is disclosed separately and carries
 * no user data).
 */
export class WebLLMProvider implements LLMProvider {
  readonly backend = 'webllm' as const;

  private readonly config: WebLLMProviderConfig;

  constructor(config: WebLLMProviderConfig) {
    this.config = config;
  }

  capabilities(): BackendCapabilities {
    return {
      backend: this.backend,
      egress: 'none',
      consent: 'none',
      streaming: true,
    };
  }

  private hasWebGPU(): boolean {
    return (this.config.hasWebGPU ?? defaultHasWebGPU)();
  }

  async checkAvailability(): Promise<BackendAvailability> {
    // No egress: WebGPU feature-detection + a local cache probe only.
    if (!this.hasWebGPU()) {
      return { state: 'unsupported', reason: "WebGPU isn't supported in this browser" };
    }
    if (this.config.modelId === null || this.config.modelId.length === 0) {
      return { state: 'needs-config', reason: 'Choose an on-device model' };
    }

    const cached = await this.isModelCached(this.config.modelId);
    if (!cached) {
      return { state: 'needs-download', reason: 'Model not downloaded' };
    }
    return { state: 'available', reason: null };
  }

  private async isModelCached(modelId: string): Promise<boolean> {
    if (this.config.isModelCached !== undefined) {
      return this.config.isModelCached(modelId);
    }
    try {
      const webllm = await import('@mlc-ai/web-llm');
      // WebLLM exposes a cache check that does NOT hit the network — it inspects
      // the local Cache Storage / OPFS for the model's weight shards.
      return await webllm.hasModelInCache(modelId);
    } catch {
      // If the check itself fails, treat the model as not cached rather than
      // claiming availability we can't verify.
      return false;
    }
  }

  /**
   * Proactively download + cache the configured model's weights, then release
   * the engine's GPU/VRAM (the cached weights remain on disk). Honours `signal`
   * *during the download* — aborting terminates the in-flight fetch and rejects
   * with an `aborted` {@link LLMError}. Powers the Settings download affordance.
   */
  async prefetch(options: PrefetchOptions): Promise<void> {
    if (!this.hasWebGPU()) {
      throw new LLMError('webgpu-unsupported', 'WebGPU is unavailable for on-device AI.', {
        backend: this.backend,
        retryable: false,
      });
    }
    if (this.config.modelId === null || this.config.modelId.length === 0) {
      throw new LLMError('model-not-downloaded', 'No on-device model is selected.', {
        backend: this.backend,
        retryable: false,
      });
    }

    const handle = await createEngine(
      this.config.modelId,
      this.config.createWorker ?? defaultCreateWorker,
      options.signal,
      options.onProgress,
    );
    // The weights are now downloaded and cached. Free GPU/VRAM immediately —
    // Settings only needed the cache populated, not a warm engine — and drop the
    // worker so nothing leaks.
    handle.detachInitAbort();
    try {
      await handle.engine.unload();
    } catch {
      // Ignore unload failures during teardown.
    } finally {
      try {
        handle.worker.terminate();
      } catch {
        // Ignore terminate failures during teardown.
      }
    }
  }

  async *generate(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!this.hasWebGPU()) {
      throw new LLMError('webgpu-unsupported', 'WebGPU is unavailable for on-device AI.', {
        backend: this.backend,
        retryable: false,
      });
    }
    if (this.config.modelId === null || this.config.modelId.length === 0) {
      throw new LLMError('model-not-downloaded', 'No on-device model is selected.', {
        backend: this.backend,
        retryable: false,
      });
    }
    if (options.signal?.aborted) {
      throw new LLMError('aborted', 'Generation was stopped.', {
        backend: this.backend,
        retryable: false,
      });
    }

    const modelId = this.config.modelId;

    // Provision the engine with the SAME abort-aware path `prefetch` uses, so
    // Stop works during the model load/download — not only during generation.
    const handle = await createEngine(
      modelId,
      this.config.createWorker ?? defaultCreateWorker,
      options.signal,
      options.onProgress,
    );
    const engine = handle.engine;
    // The init-phase abort listener (which terminates the worker) has done its
    // job; detach it and switch to interrupting token generation on abort.
    handle.detachInitAbort();

    // Wire cancellation: once loaded, aborting interrupts the in-flight
    // generation (the worker terminate in `finally` is the hard stop).
    const onAbort = (): void => {
      try {
        engine.interruptGenerate();
      } catch {
        // Best-effort — the unload in `finally` is the hard stop.
      }
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const completion = await engine.chat.completions.create({
        stream: true,
        max_tokens: options.maxOutputTokens,
        messages: [
          { role: 'system', content: options.systemPrompt },
          { role: 'user', content: options.userPrompt },
        ],
      });

      for await (const chunk of completion) {
        if (options.signal?.aborted) {
          throw new LLMError('aborted', 'Generation was stopped.', {
            backend: this.backend,
            retryable: false,
          });
        }
        const text = chunk.choices[0]?.delta.content;
        if (typeof text === 'string' && text.length > 0) {
          yield { text, done: false };
        }
      }

      yield { text: '', done: true };
    } catch (err) {
      throw mapWebLLMError(err);
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      // Free GPU/VRAM held by the engine, then drop the worker so neither leaks.
      try {
        await engine.unload();
      } catch {
        // Ignore unload failures during teardown.
      }
      try {
        handle.worker.terminate();
      } catch {
        // Ignore terminate failures during teardown.
      }
    }
  }
}

/**
 * Default worker factory. Kept separate so Vite statically detects the
 * `new Worker(new URL(...), { type: 'module' })` pattern and bundles the worker
 * (and its dynamically-imported WebLLM chunk) correctly.
 */
function defaultCreateWorker(): Worker {
  return new Worker(new URL('./webllm.worker.ts', import.meta.url), {
    type: 'module',
    name: 'webllm-engine',
  });
}
