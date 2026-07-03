import { describe, it, expect } from 'vitest';

import { AnthropicProvider } from '../anthropicProvider';
import { ChromeAIProvider } from '../chromeAiProvider';
import { createProvider } from '../createProvider';
import { OpenAICompatibleProvider } from '../openaiCompatibleProvider';
import { WebLLMProvider } from '../webllmProvider';

describe('createProvider', () => {
  it('constructs the WebLLM provider', () => {
    const p = createProvider('webllm', { backend: 'webllm', modelId: 'M' });
    expect(p).toBeInstanceOf(WebLLMProvider);
    expect(p.backend).toBe('webllm');
  });

  it('constructs the Chrome AI provider', () => {
    const p = createProvider('chrome-ai', { backend: 'chrome-ai' });
    expect(p).toBeInstanceOf(ChromeAIProvider);
    expect(p.backend).toBe('chrome-ai');
  });

  it('constructs the Anthropic provider', () => {
    const p = createProvider('anthropic', { backend: 'anthropic', getApiKey: () => null });
    expect(p).toBeInstanceOf(AnthropicProvider);
    expect(p.backend).toBe('anthropic');
  });

  it('constructs the OpenAI-compatible provider', () => {
    const p = createProvider('openai-compatible', {
      backend: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
      getApiKey: () => null,
    });
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
    expect(p.backend).toBe('openai-compatible');
  });

  it('throws on a mismatched discriminant', () => {
    expect(() => createProvider('anthropic', { backend: 'webllm', modelId: 'M' })).toThrow(
      /does not match/,
    );
  });
});
