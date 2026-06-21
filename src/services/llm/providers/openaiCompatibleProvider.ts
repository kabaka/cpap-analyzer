/**
 * Generic OpenAI-compatible Chat Completions backend (ADR 0024 §3).
 *
 * Targets any `/v1/chat/completions` endpoint — OpenAI, OpenRouter, Together,
 * and local servers (Ollama, LM Studio) — using **raw `fetch` + SSE parsing**
 * (no SDK dependency, so this stays lean). The base URL and model come from
 * settings; the API key comes from the session credential store (loopback URLs
 * may have no key).
 *
 * CSP awareness: a meta-tag CSP cannot allowlist a host the user types at
 * runtime, so requests can only reach the hosts in `src/buildtime/csp.ts`
 * `connect-src` (api.openai.com + loopback). When the configured base URL's
 * origin is NOT allowlisted, we surface a clear `network-blocked`
 * {@link LLMError} rather than letting the request fail opaquely at the network
 * layer.
 *
 * `checkAvailability()` performs NO network call — it validates local config
 * only (base URL, model, and key-for-remote).
 *
 * @module services/llm/providers/openaiCompatibleProvider
 */

import { LLMError } from '../types';
import type {
  BackendAvailability,
  BackendCapabilities,
  EgressClass,
  GenerateOptions,
  LLMProvider,
  StreamChunk,
} from '../types';

/** Modest output cap for short grounded narration (advisory). */
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Origins permitted by the static `connect-src` CSP for this backend
 * (`src/buildtime/csp.ts`). A remote host not in this set cannot be reached
 * under the meta-tag CSP, so we detect and report it before issuing the fetch.
 *
 * Loopback hosts are handled separately (see {@link isLoopbackHost}) because the
 * CSP entries match the default port only and we treat any loopback as
 * on-device regardless of port.
 */
const ALLOWLISTED_REMOTE_ORIGINS: ReadonlySet<string> = new Set(['https://api.openai.com']);

/** Resolved configuration for the OpenAI-compatible backend. */
export interface OpenAICompatibleProviderConfig {
  /**
   * Endpoint base URL, e.g. `https://api.openai.com/v1` or a loopback
   * `http://localhost:11434/v1`. `null` until the user configures it.
   */
  readonly baseUrl: string | null;
  /** Free-text model id (OpenAI-compatible servers expose arbitrary ids), or `null`. */
  readonly model: string | null;
  /**
   * Reader for the session API key (injected for testability). Returns the
   * current OpenAI-compatible key from the credential store, or `null`. A
   * loopback endpoint may legitimately have no key.
   */
  readonly getApiKey: () => string | null;
}

/**
 * True for loopback hostnames — treated as on-device (no egress, no consent).
 *
 * Restricted to the literal loopback set (`localhost`, `127.0.0.1`, `::1`,
 * `[::1]`). A `*.local`/`*.localhost` SUFFIX match is deliberately NOT loopback:
 * an mDNS/`.local` name can resolve to a remote LAN host, and this classifier
 * drives {@link egressClassForUrl} / the consent gate, so a too-permissive match
 * could skip consent for a remote-looking host. The static `connect-src` CSP in
 * `src/buildtime/csp.ts` is the load-bearing egress control — this classifier
 * only governs whether the consent layer engages, and it must agree with the CSP
 * rather than be looser than it.
 */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/** Parse a base URL string into a `URL`, or `null` if malformed. */
export function parseBaseUrl(baseUrl: string): URL | null {
  try {
    return new URL(baseUrl);
  } catch {
    return null;
  }
}

/**
 * Whether the configured base URL's origin can be reached under the static CSP.
 * Loopback origins are always allowed; remote origins must be in the allowlist.
 * Exported for unit testing.
 */
export function isOriginReachable(url: URL): boolean {
  if (isLoopbackHost(url.hostname)) return true;
  return ALLOWLISTED_REMOTE_ORIGINS.has(url.origin);
}

/** Egress class for a configured instance: `none` for loopback, `cloud` otherwise. */
export function egressClassForUrl(url: URL): EgressClass {
  return isLoopbackHost(url.hostname) ? 'none' : 'cloud';
}

/**
 * Join the base URL with the chat-completions path, tolerating whether the base
 * URL already includes a trailing `/v1`. Exported for unit testing.
 */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

/**
 * Map an HTTP status (from a non-OK response) onto an {@link LLMError}.
 * Exported for unit testing.
 */
export function mapHttpStatus(status: number): LLMError {
  if (status === 401 || status === 403) {
    return new LLMError('invalid-key', 'The API key was rejected.', {
      backend: 'openai-compatible',
      retryable: false,
    });
  }
  if (status === 429) {
    return new LLMError('rate-limited', 'The endpoint is rate-limiting requests.', {
      backend: 'openai-compatible',
      retryable: true,
    });
  }
  return new LLMError('unknown', `The endpoint returned HTTP ${status}.`, {
    backend: 'openai-compatible',
    retryable: status >= 500,
  });
}

/** Map an arbitrary thrown fetch/abort value onto an {@link LLMError}. */
export function mapFetchError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  if (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError') {
    return new LLMError('aborted', 'Generation was stopped.', {
      backend: 'openai-compatible',
      retryable: false,
      cause: err,
    });
  }
  // A `fetch` rejection (TypeError) is a network failure or a CSP block.
  return new LLMError(
    'network-blocked',
    "Couldn't reach the endpoint. The connection failed or was blocked.",
    { backend: 'openai-compatible', retryable: true, cause: err },
  );
}

/**
 * Extract the incremental text delta from one parsed SSE `data:` JSON object,
 * or `null` when the event carries no text (role-only chunk, etc.). Tolerant of
 * the minor shape variations across OpenAI-compatible servers. Exported for
 * unit testing.
 */
export function extractDelta(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== 'object' || first === null) return null;
  const delta = (first as { delta?: unknown }).delta;
  if (typeof delta !== 'object' || delta === null) return null;
  const content = (delta as { content?: unknown }).content;
  return typeof content === 'string' && content.length > 0 ? content : null;
}

/**
 * A pure, incremental SSE parser for the OpenAI streaming wire format. Feed it
 * raw decoded chunks via {@link push}; it yields each text delta as it
 * completes a `data:` line. `[DONE]` terminates the stream. Buffers partial
 * lines across chunk boundaries.
 *
 * Kept as a standalone class (no `fetch`/DOM dependency) so it is unit-testable
 * without any network. Exported for that purpose.
 */
export class SSEDeltaParser {
  private buffer = '';
  private done = false;

  /** True once a `data: [DONE]` sentinel has been seen. */
  get isDone(): boolean {
    return this.done;
  }

  /**
   * Feed a decoded chunk of the response body; returns the text deltas that
   * became complete within it (in order). May return an empty array if the
   * chunk only advanced a partial line.
   */
  push(chunk: string): string[] {
    if (this.done) return [];
    this.buffer += chunk;
    const deltas: string[] = [];

    // SSE events are newline-delimited; an event's payload lines start with
    // `data:`. Process complete lines, keeping any trailing partial line.
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const rawLine = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      const delta = this.consumeLine(rawLine);
      if (delta !== null) deltas.push(delta);
      if (this.done) return deltas;

      newlineIndex = this.buffer.indexOf('\n');
    }

    return deltas;
  }

  private consumeLine(rawLine: string): string | null {
    const line = rawLine.replace(/\r$/, '').trim();
    if (line.length === 0) return null; // event separator
    if (!line.startsWith('data:')) return null; // comments / other SSE fields

    const data = line.slice('data:'.length).trim();
    if (data === '[DONE]') {
      this.done = true;
      return null;
    }

    try {
      return extractDelta(JSON.parse(data));
    } catch {
      // A malformed JSON payload is skipped rather than failing the stream —
      // some servers emit keep-alive comments or non-JSON lines.
      return null;
    }
  }
}

/**
 * The generic OpenAI-compatible provider.
 *
 * Egress class and consent requirement depend on the configured base URL: a
 * loopback URL is on-device (`none`/`none`), a remote URL is cloud
 * (`cloud`/`cloud-egress`).
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly backend = 'openai-compatible' as const;

  private readonly config: OpenAICompatibleProviderConfig;

  constructor(config: OpenAICompatibleProviderConfig) {
    this.config = config;
  }

  capabilities(): BackendCapabilities {
    const url = this.config.baseUrl !== null ? parseBaseUrl(this.config.baseUrl) : null;
    const egress: EgressClass = url !== null ? egressClassForUrl(url) : 'cloud';
    return {
      backend: this.backend,
      egress,
      consent: egress === 'cloud' ? 'cloud-egress' : 'none',
      streaming: true,
    };
  }

  async checkAvailability(): Promise<BackendAvailability> {
    // No egress: validate local config only.
    if (this.config.baseUrl === null || this.config.baseUrl.length === 0) {
      return { state: 'needs-config', reason: 'Add the endpoint base URL' };
    }
    const url = parseBaseUrl(this.config.baseUrl);
    if (url === null) {
      return { state: 'needs-config', reason: 'The endpoint base URL is not valid' };
    }
    if (this.config.model === null || this.config.model.length === 0) {
      return { state: 'needs-config', reason: 'Choose a model' };
    }
    if (!isOriginReachable(url)) {
      return {
        state: 'unsupported',
        reason: 'This endpoint host is not in the allowed list and cannot be reached',
      };
    }
    // A remote endpoint requires a key; a loopback endpoint may not.
    if (!isLoopbackHost(url.hostname)) {
      const key = this.config.getApiKey();
      if (key === null || key.length === 0) {
        return { state: 'needs-config', reason: 'Add your API key' };
      }
    }
    return { state: 'available', reason: null };
  }

  async *generate(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.config.baseUrl === null || this.config.baseUrl.length === 0) {
      throw new LLMError('network-blocked', 'No endpoint base URL is configured.', {
        backend: this.backend,
        retryable: false,
      });
    }
    const url = parseBaseUrl(this.config.baseUrl);
    if (url === null) {
      throw new LLMError('network-blocked', 'The endpoint base URL is not valid.', {
        backend: this.backend,
        retryable: false,
      });
    }
    if (!isOriginReachable(url)) {
      throw new LLMError(
        'network-blocked',
        "Couldn't reach this endpoint — its host isn't in the allowed list.",
        { backend: this.backend, retryable: false },
      );
    }
    if (this.config.model === null || this.config.model.length === 0) {
      throw new LLMError('network-blocked', 'No model is configured.', {
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

    const key = this.config.getApiKey();
    const isLoopback = isLoopbackHost(url.hostname);
    if (!isLoopback && (key === null || key.length === 0)) {
      throw new LLMError('missing-key', 'No API key is configured for this endpoint.', {
        backend: this.backend,
        retryable: false,
      });
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key !== null && key.length > 0) headers['authorization'] = `Bearer ${key}`;

    const body = JSON.stringify({
      model: this.config.model,
      stream: true,
      max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
    });

    let response: Response;
    try {
      response = await fetch(chatCompletionsUrl(this.config.baseUrl), {
        method: 'POST',
        headers,
        body,
        signal: options.signal,
      });
    } catch (err) {
      throw mapFetchError(err);
    }

    if (!response.ok) {
      throw mapHttpStatus(response.status);
    }
    if (response.body === null) {
      throw new LLMError('unknown', 'The endpoint returned an empty response.', {
        backend: this.backend,
        retryable: true,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SSEDeltaParser();

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const deltas = parser.push(decoder.decode(value, { stream: true }));
        for (const text of deltas) {
          yield { text, done: false };
        }
        if (parser.isDone) break;
      }
    } catch (err) {
      throw mapFetchError(err);
    } finally {
      // Releasing the reader cancels the underlying stream if we exited early.
      reader.releaseLock();
    }

    yield { text: '', done: true };
  }
}
