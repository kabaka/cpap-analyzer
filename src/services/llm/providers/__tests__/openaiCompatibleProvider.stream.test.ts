import { describe, it, expect, vi, afterEach } from 'vitest';

import type { StreamChunk } from '../../types';
import { OpenAICompatibleProvider } from '../openaiCompatibleProvider';

/** Build a streaming Response whose body emits the given SSE text chunks. */
function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

async function collect(iter: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenAICompatibleProvider.generate (streaming, mocked fetch)', () => {
  it('yields text deltas then a terminal done chunk', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"Your "}}]}\n',
          'data: {"choices":[{"delta":{"content":"AHI "}}]}\n',
          'data: {"choices":[{"delta":{"content":"was low."}}]}\n',
          'data: [DONE]\n',
        ]),
      );

    const p = new OpenAICompatibleProvider({
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
      getApiKey: () => null,
    });

    const chunks = await collect(
      p.generate({ context: {} as never, systemPrompt: 's', userPrompt: 'u' }),
    );

    expect(chunks.map((c) => c.text)).toEqual(['Your ', 'AHI ', 'was low.', '']);
    expect(chunks[chunks.length - 1]?.done).toBe(true);
    expect(chunks.slice(0, -1).every((c) => !c.done)).toBe(true);

    // Posts to the resolved chat-completions URL with stream:true and no auth
    // header for the keyless loopback endpoint.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = fetchMock.mock.calls[0]![1]!;
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'llama3.1', stream: true });
    expect((init.headers as Record<string, string>)['authorization']).toBeUndefined();
  });

  it('sends a Bearer auth header for a keyed remote endpoint', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseResponse(['data: [DONE]\n']));

    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      getApiKey: () => 'sk-secret',
    });
    await collect(p.generate({ context: {} as never, systemPrompt: 's', userPrompt: 'u' }));

    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer sk-secret');
  });

  it('maps an HTTP 401 to invalid-key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
      getApiKey: () => 'bad',
    });
    await expect(
      collect(p.generate({ context: {} as never, systemPrompt: 's', userPrompt: 'u' })),
    ).rejects.toMatchObject({ kind: 'invalid-key' });
  });

  it('maps a fetch rejection to network-blocked', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'http://localhost:11434/v1',
      model: 'm',
      getApiKey: () => null,
    });
    await expect(
      collect(p.generate({ context: {} as never, systemPrompt: 's', userPrompt: 'u' })),
    ).rejects.toMatchObject({ kind: 'network-blocked' });
  });
});
