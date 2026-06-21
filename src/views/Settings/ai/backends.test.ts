import { describe, it, expect } from 'vitest';
import {
  ALL_BACKENDS,
  ANTHROPIC_MODELS,
  backendById,
  backendNeedsConsent,
  isLoopbackUrl,
  openAICompatibleNeedsConsent,
  WEBLLM_MODELS,
  webllmModelById,
} from './backends';

describe('isLoopbackUrl', () => {
  it.each([
    ['http://localhost:11434/v1', true],
    ['http://127.0.0.1:8080/v1', true],
    ['http://127.5.5.5/v1', true],
    ['http://[::1]:1234/v1', true],
    ['http://ollama.local/v1', true],
    ['https://api.openai.com/v1', false],
    ['https://example.com', false],
    ['', false],
    ['not a url', false],
  ])('isLoopbackUrl(%s) === %s', (url, expected) => {
    expect(isLoopbackUrl(url)).toBe(expected);
  });

  it('treats null as non-loopback (consent required)', () => {
    expect(isLoopbackUrl(null)).toBe(false);
  });
});

describe('consent derivation', () => {
  it('anthropic always needs consent', () => {
    expect(backendNeedsConsent('anthropic', null)).toBe(true);
  });

  it('local backends never need consent', () => {
    expect(backendNeedsConsent('webllm', null)).toBe(false);
    expect(backendNeedsConsent('chrome-ai', null)).toBe(false);
    expect(backendNeedsConsent(null, null)).toBe(false);
  });

  it('openai-compatible needs consent only for non-loopback URLs', () => {
    expect(openAICompatibleNeedsConsent('http://localhost:11434/v1')).toBe(false);
    expect(openAICompatibleNeedsConsent('https://api.openai.com/v1')).toBe(true);
    expect(backendNeedsConsent('openai-compatible', 'http://127.0.0.1/v1')).toBe(false);
    expect(backendNeedsConsent('openai-compatible', 'https://api.openai.com/v1')).toBe(true);
  });
});

describe('curated lists', () => {
  it('exposes four backends in privacy-first order', () => {
    expect(ALL_BACKENDS.map((b) => b.id)).toEqual([
      'webllm',
      'chrome-ai',
      'anthropic',
      'openai-compatible',
    ]);
  });

  it('every WebLLM model discloses an on-disk size', () => {
    expect(WEBLLM_MODELS.length).toBeGreaterThan(0);
    for (const m of WEBLLM_MODELS) {
      expect(m.sizeLabel).toMatch(/GB/);
      expect(m.id).toMatch(/MLC$/);
    }
    expect(webllmModelById(WEBLLM_MODELS[0]!.id)).toBe(WEBLLM_MODELS[0]);
    expect(webllmModelById('nope')).toBeNull();
    expect(webllmModelById(null)).toBeNull();
  });

  it('exposes exactly the three allowed Claude models, default opus persisted', () => {
    expect(ANTHROPIC_MODELS.map((m) => m.id)).toEqual([
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
    ]);
  });

  it('backendById is total over the four ids', () => {
    expect(backendById('webllm').egress).toBe('local');
    expect(backendById('anthropic').egress).toBe('cloud');
  });
});
