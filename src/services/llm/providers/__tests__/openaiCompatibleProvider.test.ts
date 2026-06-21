import { describe, it, expect, vi } from 'vitest';

import { LLMError } from '../../types';
import {
  OpenAICompatibleProvider,
  SSEDeltaParser,
  chatCompletionsUrl,
  egressClassForUrl,
  extractDelta,
  isLoopbackHost,
  isOriginReachable,
  mapFetchError,
  mapHttpStatus,
  parseBaseUrl,
} from '../openaiCompatibleProvider';

describe('isLoopbackHost', () => {
  it.each(['localhost', '127.0.0.1', '[::1]', '::1', 'foo.localhost', 'ollama.local'])(
    'treats %s as loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(['api.openai.com', 'example.com', '8.8.8.8'])('treats %s as remote', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe('isOriginReachable (CSP allowlist)', () => {
  it('allows the allowlisted OpenAI origin', () => {
    expect(isOriginReachable(new URL('https://api.openai.com/v1'))).toBe(true);
  });

  it('allows any loopback origin regardless of port', () => {
    expect(isOriginReachable(new URL('http://localhost:11434/v1'))).toBe(true);
    expect(isOriginReachable(new URL('http://127.0.0.1:1234/v1'))).toBe(true);
  });

  it('rejects an arbitrary remote host not in the allowlist', () => {
    expect(isOriginReachable(new URL('https://openrouter.ai/api/v1'))).toBe(false);
    expect(isOriginReachable(new URL('https://evil.example.com/v1'))).toBe(false);
  });
});

describe('egressClassForUrl', () => {
  it('is none for loopback, cloud for remote', () => {
    expect(egressClassForUrl(new URL('http://localhost:11434/v1'))).toBe('none');
    expect(egressClassForUrl(new URL('https://api.openai.com/v1'))).toBe('cloud');
  });
});

describe('chatCompletionsUrl', () => {
  it('appends /chat/completions to a /v1 base', () => {
    expect(chatCompletionsUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
  });

  it('appends /v1/chat/completions to a bare base', () => {
    expect(chatCompletionsUrl('http://localhost:11434')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });

  it('tolerates a trailing slash', () => {
    expect(chatCompletionsUrl('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
  });

  it('is idempotent if the path is already complete', () => {
    expect(chatCompletionsUrl('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
  });
});

describe('parseBaseUrl', () => {
  it('parses a valid URL', () => {
    expect(parseBaseUrl('https://api.openai.com/v1')?.hostname).toBe('api.openai.com');
  });

  it('returns null for garbage', () => {
    expect(parseBaseUrl('not a url')).toBeNull();
  });
});

describe('mapHttpStatus', () => {
  it('maps 401/403 to invalid-key (non-retryable)', () => {
    expect(mapHttpStatus(401).kind).toBe('invalid-key');
    expect(mapHttpStatus(403).retryable).toBe(false);
  });

  it('maps 429 to rate-limited (retryable)', () => {
    const err = mapHttpStatus(429);
    expect(err.kind).toBe('rate-limited');
    expect(err.retryable).toBe(true);
  });

  it('maps 5xx to unknown retryable', () => {
    const err = mapHttpStatus(503);
    expect(err.kind).toBe('unknown');
    expect(err.retryable).toBe(true);
  });

  it('maps a 4xx (non-auth) to unknown non-retryable', () => {
    expect(mapHttpStatus(400).retryable).toBe(false);
  });
});

describe('mapFetchError', () => {
  it('passes through an LLMError', () => {
    const e = new LLMError('aborted', 'x');
    expect(mapFetchError(e)).toBe(e);
  });

  it('maps an AbortError to aborted', () => {
    expect(mapFetchError({ name: 'AbortError' }).kind).toBe('aborted');
  });

  it('maps a generic TypeError (fetch failure) to network-blocked', () => {
    expect(mapFetchError(new TypeError('Failed to fetch')).kind).toBe('network-blocked');
  });
});

describe('extractDelta', () => {
  it('extracts content from a standard chunk', () => {
    expect(extractDelta({ choices: [{ delta: { content: 'Hi' } }] })).toBe('Hi');
  });

  it('returns null for a role-only chunk', () => {
    expect(extractDelta({ choices: [{ delta: { role: 'assistant' } }] })).toBeNull();
  });

  it('returns null for empty/absent content', () => {
    expect(extractDelta({ choices: [{ delta: { content: '' } }] })).toBeNull();
    expect(extractDelta({ choices: [] })).toBeNull();
    expect(extractDelta({})).toBeNull();
    expect(extractDelta(null)).toBeNull();
  });
});

describe('SSEDeltaParser', () => {
  it('parses deltas from complete data lines', () => {
    const p = new SSEDeltaParser();
    const out = p.push(
      'data: {"choices":[{"delta":{"content":"He"}}]}\n' +
        'data: {"choices":[{"delta":{"content":"llo"}}]}\n',
    );
    expect(out).toEqual(['He', 'llo']);
    expect(p.isDone).toBe(false);
  });

  it('buffers partial lines across chunk boundaries', () => {
    const p = new SSEDeltaParser();
    expect(p.push('data: {"choices":[{"delta":{"content":"par')).toEqual([]);
    expect(p.push('tial"}}]}\n')).toEqual(['partial']);
  });

  it('terminates on [DONE]', () => {
    const p = new SSEDeltaParser();
    const out = p.push('data: {"choices":[{"delta":{"content":"x"}}]}\ndata: [DONE]\n');
    expect(out).toEqual(['x']);
    expect(p.isDone).toBe(true);
    // Further pushes are inert once done.
    expect(p.push('data: {"choices":[{"delta":{"content":"y"}}]}\n')).toEqual([]);
  });

  it('skips blank separator lines and SSE comments', () => {
    const p = new SSEDeltaParser();
    const out = p.push(
      ': keep-alive comment\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
    );
    expect(out).toEqual(['ok']);
  });

  it('skips malformed JSON without failing the stream', () => {
    const p = new SSEDeltaParser();
    const out = p.push('data: {not json}\ndata: {"choices":[{"delta":{"content":"z"}}]}\n');
    expect(out).toEqual(['z']);
  });

  it('handles CRLF line endings', () => {
    const p = new SSEDeltaParser();
    expect(p.push('data: {"choices":[{"delta":{"content":"crlf"}}]}\r\n')).toEqual(['crlf']);
  });
});

describe('OpenAICompatibleProvider.capabilities', () => {
  it('is none/none for a loopback base URL', () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
      getApiKey: () => null,
    });
    expect(p.capabilities()).toMatchObject({ egress: 'none', consent: 'none' });
  });

  it('is cloud/cloud-egress for a remote base URL', () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      getApiKey: () => 'sk-x',
    });
    expect(p.capabilities()).toMatchObject({ egress: 'cloud', consent: 'cloud-egress' });
  });

  it('defaults to cloud when the base URL is unset', () => {
    const p = new OpenAICompatibleProvider({ baseUrl: null, model: null, getApiKey: () => null });
    expect(p.capabilities().egress).toBe('cloud');
  });
});

describe('OpenAICompatibleProvider.checkAvailability (no egress)', () => {
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 200 }));

  it('needs-config when base URL missing', async () => {
    const p = new OpenAICompatibleProvider({ baseUrl: null, model: 'm', getApiKey: () => 'k' });
    expect((await p.checkAvailability()).state).toBe('needs-config');
  });

  it('needs-config when model missing', async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'http://localhost:11434/v1',
      model: null,
      getApiKey: () => null,
    });
    expect((await p.checkAvailability()).state).toBe('needs-config');
  });

  it('unsupported when the remote host is not CSP-allowlisted', async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'm',
      getApiKey: () => 'k',
    });
    const a = await p.checkAvailability();
    expect(a.state).toBe('unsupported');
    expect(a.reason).toMatch(/allowed list/i);
  });

  it('needs-config (key) for a remote allowlisted host with no key', async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      getApiKey: () => null,
    });
    const a = await p.checkAvailability();
    expect(a.state).toBe('needs-config');
    expect(a.reason).toMatch(/key/i);
  });

  it('available for a loopback host without a key', async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
      getApiKey: () => null,
    });
    expect((await p.checkAvailability()).state).toBe('available');
  });

  it('available for a remote allowlisted host with a key', async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      getApiKey: () => 'sk-x',
    });
    expect((await p.checkAvailability()).state).toBe('available');
  });

  it('never calls fetch', async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
      getApiKey: () => 'k',
    });
    await p.checkAvailability();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('OpenAICompatibleProvider.generate guards', () => {
  it('throws network-blocked for a non-allowlisted remote host (no egress attempted)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'm',
      getApiKey: () => 'k',
    });
    const iter = p.generate({ context: {} as never, systemPrompt: 's', userPrompt: 'u' });
    await expect(iter[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      kind: 'network-blocked',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('throws missing-key for a remote host without a key', async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
      getApiKey: () => null,
    });
    const iter = p.generate({ context: {} as never, systemPrompt: 's', userPrompt: 'u' });
    await expect(iter[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      kind: 'missing-key',
    });
  });

  it('throws aborted when the signal is already aborted', async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'http://localhost:11434/v1',
      model: 'm',
      getApiKey: () => null,
    });
    const iter = p.generate({
      context: {} as never,
      systemPrompt: 's',
      userPrompt: 'u',
      signal: AbortSignal.abort(),
    });
    await expect(iter[Symbol.asyncIterator]().next()).rejects.toMatchObject({ kind: 'aborted' });
  });
});
