import { describe, it, expect } from 'vitest';

import { LLMError } from '../../types';
import { WebLLMProvider, mapWebLLMError, toModelLoadProgress } from '../webllmProvider';

describe('toModelLoadProgress', () => {
  it('classifies a fetch/download report as "downloading"', () => {
    expect(toModelLoadProgress({ progress: 0.42, text: 'Fetching param shard 3/8' })).toEqual({
      phase: 'downloading',
      fraction: 0.42,
      text: 'Fetching param shard 3/8',
    });
  });

  it('classifies a non-fetch report as "loading"', () => {
    expect(toModelLoadProgress({ progress: 1, text: 'Loading model into GPU' }).phase).toBe(
      'loading',
    );
  });

  it('clamps the fraction to [0,1] and tolerates a missing/non-finite progress', () => {
    expect(toModelLoadProgress({ progress: 1.5, text: 'download' }).fraction).toBe(1);
    expect(toModelLoadProgress({ progress: -0.2, text: 'download' }).fraction).toBe(0);
    expect(toModelLoadProgress({ text: 'loading' }).fraction).toBeNull();
    expect(toModelLoadProgress({ progress: Number.NaN, text: 'x' }).fraction).toBeNull();
  });
});

describe('mapWebLLMError', () => {
  it('passes through an LLMError', () => {
    const e = new LLMError('aborted', 'x', { backend: 'webllm' });
    expect(mapWebLLMError(e)).toBe(e);
  });

  it('maps an AbortError to aborted', () => {
    expect(mapWebLLMError({ name: 'AbortError' }).kind).toBe('aborted');
  });

  it('maps a WebGPU message to webgpu-unsupported', () => {
    expect(mapWebLLMError(new Error('WebGPU is not available')).kind).toBe('webgpu-unsupported');
  });

  it('maps an OOM message to model-load-failed', () => {
    expect(mapWebLLMError(new Error('Out of memory while loading')).kind).toBe('model-load-failed');
  });

  it('maps any other failure to model-load-failed', () => {
    expect(mapWebLLMError(new Error('something else')).kind).toBe('model-load-failed');
  });
});

describe('WebLLMProvider.capabilities', () => {
  it('is zero-egress (none/none)', () => {
    const p = new WebLLMProvider({ modelId: 'M' });
    expect(p.capabilities()).toEqual({
      backend: 'webllm',
      egress: 'none',
      consent: 'none',
      streaming: true,
    });
  });
});

describe('WebLLMProvider.checkAvailability (no egress)', () => {
  it('returns unsupported when WebGPU is absent', async () => {
    const p = new WebLLMProvider({ modelId: 'M', hasWebGPU: () => false });
    const a = await p.checkAvailability();
    expect(a.state).toBe('unsupported');
    expect(a.reason).toMatch(/WebGPU/i);
  });

  it('returns needs-config when no model is chosen', async () => {
    const p = new WebLLMProvider({ modelId: null, hasWebGPU: () => true });
    expect((await p.checkAvailability()).state).toBe('needs-config');
  });

  it('returns needs-download when the model is not cached', async () => {
    const p = new WebLLMProvider({
      modelId: 'M',
      hasWebGPU: () => true,
      isModelCached: async () => false,
    });
    const a = await p.checkAvailability();
    expect(a.state).toBe('needs-download');
    expect(a.reason).toMatch(/download/i);
  });

  it('returns available when WebGPU is present and the model is cached', async () => {
    const p = new WebLLMProvider({
      modelId: 'M',
      hasWebGPU: () => true,
      isModelCached: async () => true,
    });
    expect(await p.checkAvailability()).toEqual({ state: 'available', reason: null });
  });
});

describe('WebLLMProvider.generate guards', () => {
  it('throws webgpu-unsupported when WebGPU is absent', async () => {
    const p = new WebLLMProvider({ modelId: 'M', hasWebGPU: () => false });
    const iter = p.generate({ context: {} as never, systemPrompt: 's', userPrompt: 'u' });
    await expect(iter[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      kind: 'webgpu-unsupported',
    });
  });

  it('throws model-not-downloaded when no model is selected', async () => {
    const p = new WebLLMProvider({ modelId: null, hasWebGPU: () => true });
    const iter = p.generate({ context: {} as never, systemPrompt: 's', userPrompt: 'u' });
    await expect(iter[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      kind: 'model-not-downloaded',
    });
  });

  it('throws aborted when the signal is already aborted', async () => {
    const p = new WebLLMProvider({ modelId: 'M', hasWebGPU: () => true });
    const iter = p.generate({
      context: {} as never,
      systemPrompt: 's',
      userPrompt: 'u',
      signal: AbortSignal.abort(),
    });
    await expect(iter[Symbol.asyncIterator]().next()).rejects.toMatchObject({ kind: 'aborted' });
  });
});
