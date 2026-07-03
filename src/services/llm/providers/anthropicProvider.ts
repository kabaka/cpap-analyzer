/**
 * Claude (Anthropic) browser-direct backend (ADR 0024 §3).
 *
 * Calls the Anthropic Messages API straight from the browser using the user's
 * own API key, via the official `@anthropic-ai/sdk` with `dangerouslyAllowBrowser`
 * (which sets the `anthropic-dangerous-direct-browser-access` header). The SDK
 * is **dynamically imported inside `generate()`** so it never enters the main
 * bundle — importing this module is cheap.
 *
 * Privacy/correctness invariants (enforced upstream):
 * - The provider receives an already-built, guardrailed prompt; it never
 *   computes a clinical value (compute-then-narrate).
 * - The API key is read from the session-scoped credential store at request
 *   time and travels only as the SDK auth header. It is never logged, never
 *   placed in the snapshot, and never persisted here.
 * - Only `api.anthropic.com` is contacted — an exact origin allowlisted in
 *   `src/buildtime/csp.ts` `connect-src`.
 *
 * Generation is **streamed** (text deltas → {@link StreamChunk}s). For short
 * grounded narration we deliberately omit extended thinking and keep
 * `max_tokens` modest; `temperature` is not set (4.x Opus/Sonnet reject it).
 *
 * @module services/llm/providers/anthropicProvider
 */

import type { LLMAnthropicModel } from '@/types/settings';

import { LLMError } from '../types';
import type {
  BackendAvailability,
  BackendCapabilities,
  GenerateOptions,
  LLMProvider,
  StreamChunk,
} from '../types';

/** The default Claude model when settings have not specified one. */
const DEFAULT_MODEL: LLMAnthropicModel = 'claude-opus-4-8';

/**
 * Modest output cap for short grounded narration. Advisory only — the grounded
 * insight is a few sentences, so a small cap keeps cost and latency down.
 */
const DEFAULT_MAX_TOKENS = 1024;

/** Resolved configuration for the Anthropic backend. */
export interface AnthropicProviderConfig {
  /** Chosen Claude model. Defaults to {@link DEFAULT_MODEL}. */
  readonly model?: LLMAnthropicModel;
  /**
   * Reader for the session API key (injected for testability). Returns the
   * current Anthropic key from the credential store, or `null` if none is set.
   * The provider NEVER reads persisted settings or storage directly.
   */
  readonly getApiKey: () => string | null;
}

/**
 * Narrow structural shape of an Anthropic SDK error we branch on. We avoid
 * importing the SDK's error classes (they would pull the SDK into the type
 * graph and complicate the dynamic-import boundary); the SDK populates `status`
 * on API errors, which is all we need to classify.
 */
interface SdkLikeError {
  readonly status?: number;
  readonly name?: string;
  readonly message?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Best-effort extraction of an HTTP status / name from an unknown thrown value. */
function asSdkError(err: unknown): SdkLikeError {
  if (!isObject(err)) return {};
  const status = typeof err['status'] === 'number' ? (err['status'] as number) : undefined;
  const name = typeof err['name'] === 'string' ? (err['name'] as string) : undefined;
  const message = typeof err['message'] === 'string' ? (err['message'] as string) : undefined;
  return { status, name, message };
}

/** True if the thrown value is an abort (user "Stop" or signal abort). */
function isAbortError(err: unknown): boolean {
  if (!isObject(err)) return false;
  const name = err['name'];
  return name === 'AbortError' || name === 'APIUserAbortError';
}

/**
 * Map an arbitrary thrown SDK/network value onto a classified {@link LLMError}.
 * Exported for unit testing — this is the pure, mappable core of the provider.
 */
export function mapAnthropicError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;

  if (isAbortError(err)) {
    return new LLMError('aborted', 'Generation was stopped.', {
      backend: 'anthropic',
      retryable: false,
      cause: err,
    });
  }

  const { status, message } = asSdkError(err);

  if (status === 401 || status === 403) {
    return new LLMError('invalid-key', 'The Claude API key was rejected.', {
      backend: 'anthropic',
      retryable: false,
      cause: err,
    });
  }

  if (status === 429) {
    return new LLMError('rate-limited', 'Claude is rate-limiting requests.', {
      backend: 'anthropic',
      retryable: true,
      cause: err,
    });
  }

  // A connection error before any HTTP response — network failure or a request
  // blocked by the `connect-src` CSP. The SDK surfaces these as
  // `APIConnectionError` (no `status`).
  if (status === undefined) {
    return new LLMError(
      'network-blocked',
      "Couldn't reach Claude. The connection failed or was blocked.",
      { backend: 'anthropic', retryable: true, cause: err },
    );
  }

  return new LLMError('unknown', message ?? 'Claude returned an unexpected error.', {
    backend: 'anthropic',
    retryable: true,
    cause: err,
  });
}

/**
 * Map a non-`end_turn` stop reason onto an {@link LLMError}, or `null` when the
 * stream completed normally. A `refusal` stop reason (safety/policy decline)
 * maps to the `refusal` kind. Exported for unit testing.
 */
export function refusalErrorForStopReason(stopReason: string | null | undefined): LLMError | null {
  if (stopReason === 'refusal') {
    return new LLMError('refusal', 'Claude declined to answer this request.', {
      backend: 'anthropic',
      retryable: false,
    });
  }
  return null;
}

/**
 * The Claude browser-direct provider.
 *
 * `checkAvailability()` performs NO network call — availability is `needs-config`
 * when no key is present, `available` otherwise (UX §3.6: key validity is only
 * checked by the first real generation).
 */
export class AnthropicProvider implements LLMProvider {
  readonly backend = 'anthropic' as const;

  private readonly config: AnthropicProviderConfig;

  constructor(config: AnthropicProviderConfig) {
    this.config = config;
  }

  capabilities(): BackendCapabilities {
    return {
      backend: this.backend,
      egress: 'cloud',
      consent: 'cloud-egress',
      streaming: true,
    };
  }

  async checkAvailability(): Promise<BackendAvailability> {
    // No egress: presence of a key is the only gate we can check locally.
    const key = this.config.getApiKey();
    if (key === null || key.length === 0) {
      return { state: 'needs-config', reason: 'Add your Claude API key' };
    }
    return { state: 'available', reason: null };
  }

  async *generate(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const key = this.config.getApiKey();
    if (key === null || key.length === 0) {
      throw new LLMError('missing-key', 'No Claude API key is configured.', {
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

    const model = this.config.model ?? DEFAULT_MODEL;
    const maxTokens = options.maxOutputTokens ?? DEFAULT_MAX_TOKENS;

    // Dynamic import keeps the SDK out of the main bundle (ADR 0024; it lands in
    // its own async chunk). The import lives inside the method, after the
    // cheap synchronous guards above.
    let Anthropic: typeof import('@anthropic-ai/sdk').default;
    try {
      ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
    } catch (err) {
      throw mapAnthropicError(err);
    }

    const client = new Anthropic({
      apiKey: key,
      // Sets the `anthropic-dangerous-direct-browser-access` header so the API
      // accepts a request originating from the browser with the user's own key
      // (ADR 0024 §3 — we have no backend to proxy through).
      dangerouslyAllowBrowser: true,
    });

    try {
      // STREAM short grounded narration. No `thinking` (unnecessary for a few
      // sentences) and no `temperature` (4.x Opus/Sonnet reject it).
      const stream = client.messages.stream(
        {
          model,
          max_tokens: maxTokens,
          system: options.systemPrompt,
          messages: [{ role: 'user', content: options.userPrompt }],
        },
        options.signal ? { signal: options.signal } : undefined,
      );

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { text: event.delta.text, done: false };
        }
      }

      const finalMessage = await stream.finalMessage();
      const refusal = refusalErrorForStopReason(finalMessage.stop_reason);
      if (refusal !== null) throw refusal;

      yield { text: '', done: true };
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }
}
