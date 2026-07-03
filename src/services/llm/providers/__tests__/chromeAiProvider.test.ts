import { describe, it, expect, vi } from 'vitest';

import type { StreamChunk } from '../../types';
import { LLMError } from '../../types';
import { ChromeAIProvider, mapAvailability, mapChromeAIError } from '../chromeAiProvider';

/** A fake `LanguageModel` static surface for injection. */
function fakeLanguageModel(opts: {
  availability: ChromeAIAvailability;
  streamChunks?: string[];
}): ChromeAILanguageModelStatic {
  return {
    availability: async () => opts.availability,
    create: async () => ({
      promptStreaming: () =>
        new ReadableStream<string>({
          start(controller) {
            for (const c of opts.streamChunks ?? []) controller.enqueue(c);
            controller.close();
          },
        }),
      destroy: () => {},
    }),
  };
}

async function collect(iter: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

describe('mapAvailability', () => {
  it('maps native states onto BackendAvailability', () => {
    expect(mapAvailability('available')).toEqual({ state: 'available', reason: null });
    expect(mapAvailability('downloadable').state).toBe('needs-download');
    expect(mapAvailability('downloading').state).toBe('needs-download');
    expect(mapAvailability('unavailable').state).toBe('unsupported');
    expect(mapAvailability(null).state).toBe('unsupported');
  });
});

describe('mapChromeAIError', () => {
  it('passes through an LLMError', () => {
    const e = new LLMError('aborted', 'x', { backend: 'chrome-ai' });
    expect(mapChromeAIError(e)).toBe(e);
  });

  it('maps an AbortError to aborted', () => {
    expect(mapChromeAIError({ name: 'AbortError' }).kind).toBe('aborted');
  });

  it('maps a NotSupportedError to model-load-failed', () => {
    expect(mapChromeAIError({ name: 'NotSupportedError' }).kind).toBe('model-load-failed');
  });

  it('maps anything else to model-load-failed', () => {
    expect(mapChromeAIError(new Error('x')).kind).toBe('model-load-failed');
  });
});

describe('ChromeAIProvider.capabilities', () => {
  it('is zero-egress (none/none)', () => {
    const p = new ChromeAIProvider({ getLanguageModel: () => null });
    expect(p.capabilities()).toEqual({
      backend: 'chrome-ai',
      egress: 'none',
      consent: 'none',
      streaming: true,
    });
  });
});

describe('ChromeAIProvider.checkAvailability (no egress)', () => {
  it('returns unsupported when the global is absent', async () => {
    const p = new ChromeAIProvider({ getLanguageModel: () => null });
    expect((await p.checkAvailability()).state).toBe('unsupported');
  });

  it('returns unsupported when undefined is returned', async () => {
    const p = new ChromeAIProvider({ getLanguageModel: () => undefined });
    expect((await p.checkAvailability()).state).toBe('unsupported');
  });

  it('maps the native availability state', async () => {
    const p = new ChromeAIProvider({
      getLanguageModel: () => fakeLanguageModel({ availability: 'available' }),
    });
    expect((await p.checkAvailability()).state).toBe('available');
  });

  it('returns needs-download for a downloadable model', async () => {
    const p = new ChromeAIProvider({
      getLanguageModel: () => fakeLanguageModel({ availability: 'downloadable' }),
    });
    expect((await p.checkAvailability()).state).toBe('needs-download');
  });

  it('treats a throwing availability() as unsupported', async () => {
    const p = new ChromeAIProvider({
      getLanguageModel: () =>
        ({
          availability: async () => {
            throw new Error('boom');
          },
          create: async () => {
            throw new Error('unused');
          },
        }) as ChromeAILanguageModelStatic,
    });
    expect((await p.checkAvailability()).state).toBe('unsupported');
  });

  it('never calls fetch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    const p = new ChromeAIProvider({
      getLanguageModel: () => fakeLanguageModel({ availability: 'available' }),
    });
    await p.checkAvailability();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('ChromeAIProvider.generate', () => {
  it('streams deltas from the session then a terminal done chunk', async () => {
    const p = new ChromeAIProvider({
      getLanguageModel: () =>
        fakeLanguageModel({ availability: 'available', streamChunks: ['Hel', 'lo'] }),
    });
    const chunks = await collect(
      p.generate({ context: {} as never, systemPrompt: 's', userPrompt: 'u' }),
    );
    expect(chunks.map((c) => c.text)).toEqual(['Hel', 'lo', '']);
    expect(chunks[chunks.length - 1]?.done).toBe(true);
  });

  it('throws model-load-failed when the global is absent', async () => {
    const p = new ChromeAIProvider({ getLanguageModel: () => null });
    const iter = p.generate({ context: {} as never, systemPrompt: 's', userPrompt: 'u' });
    await expect(iter[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      kind: 'model-load-failed',
    });
  });

  it('throws aborted when the signal is already aborted', async () => {
    const p = new ChromeAIProvider({
      getLanguageModel: () => fakeLanguageModel({ availability: 'available' }),
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
