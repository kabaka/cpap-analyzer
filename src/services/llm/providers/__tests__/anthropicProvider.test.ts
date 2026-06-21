import { describe, it, expect, vi } from 'vitest';

import { LLMError } from '../../types';
import {
  AnthropicProvider,
  mapAnthropicError,
  refusalErrorForStopReason,
} from '../anthropicProvider';

describe('mapAnthropicError', () => {
  it('passes through an existing LLMError unchanged', () => {
    const original = new LLMError('rate-limited', 'x', { backend: 'anthropic' });
    expect(mapAnthropicError(original)).toBe(original);
  });

  it('maps an abort (AbortError name) to "aborted", non-retryable', () => {
    const err = mapAnthropicError({ name: 'AbortError' });
    expect(err.kind).toBe('aborted');
    expect(err.retryable).toBe(false);
  });

  it('maps the SDK APIUserAbortError name to "aborted"', () => {
    const err = mapAnthropicError({ name: 'APIUserAbortError' });
    expect(err.kind).toBe('aborted');
  });

  it('maps 401 to "invalid-key", non-retryable', () => {
    const err = mapAnthropicError({ status: 401 });
    expect(err.kind).toBe('invalid-key');
    expect(err.retryable).toBe(false);
  });

  it('maps 403 to "invalid-key"', () => {
    expect(mapAnthropicError({ status: 403 }).kind).toBe('invalid-key');
  });

  it('maps 429 to "rate-limited", retryable', () => {
    const err = mapAnthropicError({ status: 429 });
    expect(err.kind).toBe('rate-limited');
    expect(err.retryable).toBe(true);
  });

  it('maps a connection error (no status) to "network-blocked"', () => {
    const err = mapAnthropicError({ name: 'APIConnectionError', message: 'fetch failed' });
    expect(err.kind).toBe('network-blocked');
    expect(err.retryable).toBe(true);
  });

  it('maps an unrecognized HTTP status to "unknown"', () => {
    const err = mapAnthropicError({ status: 500, message: 'boom' });
    expect(err.kind).toBe('unknown');
  });

  it('keeps the original value as cause for logging', () => {
    const raw = { status: 429 };
    expect(mapAnthropicError(raw).cause).toBe(raw);
  });
});

describe('refusalErrorForStopReason', () => {
  it('returns a "refusal" LLMError for a refusal stop reason', () => {
    const err = refusalErrorForStopReason('refusal');
    expect(err).not.toBeNull();
    expect(err?.kind).toBe('refusal');
    expect(err?.retryable).toBe(false);
  });

  it('returns null for end_turn', () => {
    expect(refusalErrorForStopReason('end_turn')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(refusalErrorForStopReason(null)).toBeNull();
    expect(refusalErrorForStopReason(undefined)).toBeNull();
  });
});

describe('AnthropicProvider', () => {
  it('declares cloud egress and cloud-egress consent', () => {
    const p = new AnthropicProvider({ getApiKey: () => 'sk-x' });
    expect(p.capabilities()).toEqual({
      backend: 'anthropic',
      egress: 'cloud',
      consent: 'cloud-egress',
      streaming: true,
    });
  });

  describe('checkAvailability (no egress)', () => {
    it('returns needs-config when no key is present', async () => {
      const p = new AnthropicProvider({ getApiKey: () => null });
      const a = await p.checkAvailability();
      expect(a.state).toBe('needs-config');
      expect(a.reason).toMatch(/key/i);
    });

    it('returns needs-config for an empty key', async () => {
      const p = new AnthropicProvider({ getApiKey: () => '' });
      expect((await p.checkAvailability()).state).toBe('needs-config');
    });

    it('returns available when a key is present', async () => {
      const p = new AnthropicProvider({ getApiKey: () => 'sk-x' });
      expect(await p.checkAvailability()).toEqual({ state: 'available', reason: null });
    });

    it('never invokes fetch', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      const p = new AnthropicProvider({ getApiKey: () => 'sk-x' });
      await p.checkAvailability();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe('generate guards', () => {
    it('throws missing-key when no key is configured', async () => {
      const p = new AnthropicProvider({ getApiKey: () => null });
      const iter = p.generate({
        context: {} as never,
        systemPrompt: 's',
        userPrompt: 'u',
      });
      await expect(iter[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        kind: 'missing-key',
      });
    });

    it('throws aborted when the signal is already aborted', async () => {
      const p = new AnthropicProvider({ getApiKey: () => 'sk-x' });
      const iter = p.generate({
        context: {} as never,
        systemPrompt: 's',
        userPrompt: 'u',
        signal: AbortSignal.abort(),
      });
      await expect(iter[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        kind: 'aborted',
      });
    });
  });
});
