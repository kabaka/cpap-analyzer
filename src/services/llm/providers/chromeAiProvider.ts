/**
 * Chrome built-in AI backend (Gemini Nano via the Prompt API) — zero-egress
 * progressive enhancement (ADR 0024 §3).
 *
 * Uses the browser's built-in `LanguageModel` global. The model ships with the
 * browser (or is provisioned once on-device), so inference is **zero-egress**:
 * no user data leaves the device and there is no app-side model download host.
 *
 * Availability is determined WITHOUT egress, mapping the native availability
 * states onto {@link BackendAvailability}:
 * - global absent                → `unsupported`
 * - `'unavailable'`              → `unsupported`
 * - `'downloadable'`/`'downloading'` → `needs-download` (one-time provision)
 * - `'available'`                → `available`
 *
 * The experimental global is not in the standard DOM lib; minimal ambient types
 * live in `chromeAi.d.ts`.
 *
 * @module services/llm/providers/chromeAiProvider
 */

import { LLMError } from '../types';
import type {
  BackendAvailability,
  BackendCapabilities,
  GenerateOptions,
  LLMProvider,
  StreamChunk,
} from '../types';

/** Resolved configuration for the Chrome built-in AI backend. */
export interface ChromeAIProviderConfig {
  /**
   * Accessor for the experimental `LanguageModel` global (injected for
   * testability). Returns the global, or `null`/`undefined` when absent.
   * Defaults to reading `self.LanguageModel`.
   */
  readonly getLanguageModel?: () => ChromeAILanguageModelStatic | null | undefined;
}

/**
 * Read the experimental `LanguageModel` global, guarding against environments
 * (Node, older browsers) where it is absent.
 */
function defaultGetLanguageModel(): ChromeAILanguageModelStatic | null {
  if (typeof self !== 'undefined' && 'LanguageModel' in self) {
    return (
      (self as unknown as { LanguageModel?: ChromeAILanguageModelStatic }).LanguageModel ?? null
    );
  }
  return null;
}

/**
 * Map a native availability state onto a {@link BackendAvailability}. Exported
 * for unit testing.
 */
export function mapAvailability(state: ChromeAIAvailability | null): BackendAvailability {
  switch (state) {
    case 'available':
      return { state: 'available', reason: null };
    case 'downloadable':
    case 'downloading':
      return { state: 'needs-download', reason: 'On-device model needs to be set up' };
    case 'unavailable':
    case null:
    default:
      return {
        state: 'unsupported',
        reason: "Chrome's built-in AI isn't available in this browser",
      };
  }
}

/** Map an arbitrary thrown value onto an {@link LLMError}. Exported for testing. */
export function mapChromeAIError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  const name =
    typeof err === 'object' && err !== null ? (err as { name?: string }).name : undefined;
  if (name === 'AbortError') {
    return new LLMError('aborted', 'Generation was stopped.', {
      backend: 'chrome-ai',
      retryable: false,
      cause: err,
    });
  }
  if (name === 'NotSupportedError') {
    return new LLMError('model-load-failed', "Chrome's built-in AI couldn't run on this device.", {
      backend: 'chrome-ai',
      retryable: false,
      cause: err,
    });
  }
  return new LLMError('model-load-failed', "Chrome's built-in AI returned an unexpected error.", {
    backend: 'chrome-ai',
    retryable: false,
    cause: err,
  });
}

/**
 * The Chrome built-in AI provider.
 *
 * Capabilities are fixed `none`/`none` — nothing leaves the device.
 */
export class ChromeAIProvider implements LLMProvider {
  readonly backend = 'chrome-ai' as const;

  private readonly getLanguageModel: () => ChromeAILanguageModelStatic | null | undefined;

  constructor(config: ChromeAIProviderConfig = {}) {
    this.getLanguageModel = config.getLanguageModel ?? defaultGetLanguageModel;
  }

  capabilities(): BackendCapabilities {
    return {
      backend: this.backend,
      egress: 'none',
      consent: 'none',
      streaming: true,
    };
  }

  async checkAvailability(): Promise<BackendAvailability> {
    const lm = this.getLanguageModel();
    if (lm === null || lm === undefined) {
      return mapAvailability(null);
    }
    try {
      const state = await lm.availability();
      return mapAvailability(state);
    } catch {
      // A throwing availability() means the API is present but unusable here.
      return mapAvailability('unavailable');
    }
  }

  async *generate(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const lm = this.getLanguageModel();
    if (lm === null || lm === undefined) {
      throw new LLMError('model-load-failed', "Chrome's built-in AI isn't available.", {
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

    let session: ChromeAILanguageModelSession;
    try {
      session = await lm.create({
        signal: options.signal,
        initialPrompts: [{ role: 'system', content: options.systemPrompt }],
        monitor: (monitor) => {
          monitor.addEventListener('downloadprogress', (event) => {
            options.onProgress?.({
              phase: 'downloading',
              fraction: Number.isFinite(event.loaded) ? event.loaded : null,
              text: `Setting up on-device model… ${Math.round((event.loaded ?? 0) * 100)}%`,
            });
          });
        },
      });
    } catch (err) {
      throw mapChromeAIError(err);
    }

    try {
      // The Prompt API yields the cumulative running text? No — `promptStreaming`
      // yields incremental string chunks (deltas). Forward each as a StreamChunk.
      const stream = options.signal
        ? session.promptStreaming(options.userPrompt, { signal: options.signal })
        : session.promptStreaming(options.userPrompt);

      const reader = stream.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (typeof value === 'string' && value.length > 0) {
            yield { text: value, done: false };
          }
        }
      } finally {
        reader.releaseLock();
      }

      yield { text: '', done: true };
    } catch (err) {
      throw mapChromeAIError(err);
    } finally {
      try {
        session.destroy();
      } catch {
        // Ignore teardown failures.
      }
    }
  }
}
