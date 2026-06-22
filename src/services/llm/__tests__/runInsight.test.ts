/**
 * Tests for the AI-Insights orchestration ({@link runInsight}).
 *
 * Covers the integration contract that ties consent, the grounded builders, the
 * grounding/validation layer, and the provider factory together:
 *  - the cloud egress consent gate (no context built, no provider called without
 *    fresh consent),
 *  - the validation-failure → single-regenerate → template-fallback path,
 *  - the abort path,
 *  - the empty / insufficient-data short-circuit (no provider created).
 *
 * Providers are mocked via `vi.mock` of the factory — no network, no model.
 *
 * @module services/llm/__tests__/runInsight.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { EGRESS_CONTRACT_VERSION } from '@/types/settings';

import { COMMON, makeAggregate } from '../context/__tests__/fixtures';
import type { LinearTrend } from '@/analysis/timeseries';
import { LLMError } from '../types';
import type { LLMProvider, StreamChunk, GenerateOptions } from '../types';

// ─── Mock the provider factory so no real provider is ever constructed. ──────
const createProviderMock = vi.fn();
vi.mock('../providers', () => ({
  createProvider: (...args: unknown[]) => createProviderMock(...args),
}));

// Import AFTER the mock is registered.
import { runInsight } from '../runInsight';
import type { InsightInput, RunBackendConfig, InsightEvent } from '../runInsight';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** A provider whose `generate` streams the given chunks of text. */
function streamingProvider(
  backend: LLMProvider['backend'],
  texts: readonly string[],
  hooks: {
    onGenerate?: (options: GenerateOptions) => void;
    progress?: { phase: 'downloading' | 'loading'; fraction: number | null; text: string }[];
  } = {},
): LLMProvider {
  return {
    backend,
    capabilities: () => ({ backend, egress: 'none', consent: 'none', streaming: true }),
    checkAvailability: () => Promise.resolve({ state: 'available', reason: null }),
    async *generate(options: GenerateOptions): AsyncIterable<StreamChunk> {
      hooks.onGenerate?.(options);
      if (hooks.progress) {
        for (const p of hooks.progress) options.onProgress?.(p);
      }
      for (let i = 0; i < texts.length; i += 1) {
        if (options.signal?.aborted) {
          throw new LLMError('aborted', 'aborted', { backend });
        }
        const text = texts[i] ?? '';
        yield { text, done: i === texts.length - 1 };
      }
    },
  };
}

/** Drain an async iterable of events into an array. */
async function collect(iter: AsyncIterable<InsightEvent>): Promise<InsightEvent[]> {
  const out: InsightEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

function terminal(events: InsightEvent[]): InsightEvent {
  const last = events[events.length - 1];
  if (last === undefined) throw new Error('no events');
  return last;
}

/** A baseline single-night input (always has enough to narrate). */
function singleNightInput(): InsightInput {
  return { kind: 'single-night', ...COMMON, aggregate: makeAggregate() };
}

const LOCAL_CONFIG: RunBackendConfig = {
  backend: 'webllm',
  enabled: true,
  consentAt: null,
  consentContractVersion: null,
  webllm: { modelId: 'M' },
  anthropic: { model: 'claude-opus-4-8' },
  openaiCompatible: { baseUrl: null, model: null },
  getApiKey: () => null,
};

const CLOUD_CONFIG_NO_CONSENT: RunBackendConfig = {
  ...LOCAL_CONFIG,
  backend: 'anthropic',
  consentAt: null,
  consentContractVersion: null,
  getApiKey: () => 'sk-test',
};

const CLOUD_CONFIG_FRESH_CONSENT: RunBackendConfig = {
  ...CLOUD_CONFIG_NO_CONSENT,
  consentAt: '2026-06-21T00:00:00.000Z',
  consentContractVersion: EGRESS_CONTRACT_VERSION,
};

beforeEach(() => {
  createProviderMock.mockReset();
});

// ─── 1. Consent gate ─────────────────────────────────────────────────────────

describe('runInsight — cloud egress consent gate', () => {
  it('emits needs-consent and NEVER builds context or calls the provider without consent', async () => {
    const events = await collect(
      runInsight({ input: singleNightInput(), config: CLOUD_CONFIG_NO_CONSENT }),
    );

    const last = terminal(events);
    expect(last.type).toBe('needs-consent');
    if (last.type === 'needs-consent') {
      expect(last.backend).toBe('anthropic');
      expect(last.stale).toBe(false);
    }
    // The privacy-critical assertion: no provider was ever created (so nothing
    // could egress), and no context/phase event was emitted.
    expect(createProviderMock).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'phase')).toBe(false);
  });

  it('marks stale=true when consent exists but for an older contract version', async () => {
    const events = await collect(
      runInsight({
        input: singleNightInput(),
        config: {
          ...CLOUD_CONFIG_NO_CONSENT,
          consentAt: '2026-01-01T00:00:00.000Z',
          consentContractVersion: EGRESS_CONTRACT_VERSION - 1,
        },
      }),
    );
    const last = terminal(events);
    expect(last.type).toBe('needs-consent');
    if (last.type === 'needs-consent') expect(last.stale).toBe(true);
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it('proceeds (creates a provider) for a cloud backend WITH fresh consent', async () => {
    createProviderMock.mockReturnValue(
      streamingProvider('anthropic', [
        'Your AHI was 4.2 events/h, a healthy figure; some values are estimates, so interpret with care.',
      ]),
    );
    const events = await collect(
      runInsight({ input: singleNightInput(), config: CLOUD_CONFIG_FRESH_CONSENT }),
    );
    expect(createProviderMock).toHaveBeenCalledTimes(1);
    expect(terminal(events).type).toBe('complete');
  });

  it('treats a loopback OpenAI-compatible URL as local (no consent required)', async () => {
    createProviderMock.mockReturnValue(
      streamingProvider('openai-compatible', ['Your AHI was 4.2 events/h.']),
    );
    const events = await collect(
      runInsight({
        input: singleNightInput(),
        config: {
          ...LOCAL_CONFIG,
          backend: 'openai-compatible',
          openaiCompatible: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
        },
      }),
    );
    expect(createProviderMock).toHaveBeenCalledTimes(1);
    expect(terminal(events).type).toBe('complete');
  });

  it('requires consent for a REMOTE OpenAI-compatible URL', async () => {
    const events = await collect(
      runInsight({
        input: singleNightInput(),
        config: {
          ...LOCAL_CONFIG,
          backend: 'openai-compatible',
          openaiCompatible: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        },
      }),
    );
    expect(terminal(events).type).toBe('needs-consent');
    expect(createProviderMock).not.toHaveBeenCalled();
  });
});

// ─── 2. needs-config (disabled / no backend) ─────────────────────────────────

describe('runInsight — configuration gate', () => {
  it('emits an error when the feature is disabled', async () => {
    const events = await collect(
      runInsight({ input: singleNightInput(), config: { ...LOCAL_CONFIG, enabled: false } }),
    );
    const last = terminal(events);
    expect(last.type).toBe('error');
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it('emits an error when no backend is chosen', async () => {
    const events = await collect(
      runInsight({ input: singleNightInput(), config: { ...LOCAL_CONFIG, backend: null } }),
    );
    expect(terminal(events).type).toBe('error');
    expect(createProviderMock).not.toHaveBeenCalled();
  });
});

// ─── 3. Validation failure → single regenerate → template fallback ───────────

describe('runInsight — validation, regenerate-once, fallback', () => {
  it('falls back to the deterministic template after two fabricated-number failures', async () => {
    // Both passes stream a fabricated number (999) not in the allow-list, so
    // validateNarrative rejects both → deterministic template fallback.
    const fabricated = 'Your AHI was 999 events/h, which is concerning.';
    const onGenerate = vi.fn();
    const provider = streamingProvider('webllm', [fabricated], { onGenerate });
    createProviderMock.mockReturnValue(provider);

    const events = await collect(runInsight({ input: singleNightInput(), config: LOCAL_CONFIG }));

    // generate() was called twice (initial + one strengthened retry).
    expect(onGenerate).toHaveBeenCalledTimes(2);
    // The retry prompt was strengthened with the offending token "999".
    const retryOptions = onGenerate.mock.calls[1]?.[0] as GenerateOptions;
    expect(retryOptions.userPrompt).toContain('999');

    const last = terminal(events);
    expect(last.type).toBe('complete');
    if (last.type === 'complete') {
      expect(last.usedFallback).toBe(true);
      // The fallback is the deterministic, allow-list-safe summary — it never
      // contains the fabricated number.
      expect(last.text).not.toContain('999');
      // The notice is NOT baked into the body anymore — the drawer renders it
      // from `usedFallback`. The body is the clean template prose only.
      expect(last.text).not.toContain('computed summary rather than AI-written text');
      expect(last.text).not.toContain('unavailable');
      // The validation summary describes the rejected model output.
      expect(last.validation.ok).toBe(false);
      // The source context is always present for "show your work".
      expect(last.context.insightType).toBe('single-night');
    }
  });

  it('regenerates ONCE and succeeds when the retry is clean', async () => {
    const bad = 'Your AHI was 999 events/h.';
    const good =
      'Your AHI was 4.2 events/h, within the normal range; some figures are estimates, so interpret with care.';
    let call = 0;
    const provider: LLMProvider = {
      backend: 'webllm',
      capabilities: () => ({ backend: 'webllm', egress: 'none', consent: 'none', streaming: true }),
      checkAvailability: () => Promise.resolve({ state: 'available', reason: null }),
      async *generate(): AsyncIterable<StreamChunk> {
        const text = call === 0 ? bad : good;
        call += 1;
        yield { text, done: true };
      },
    };
    createProviderMock.mockReturnValue(provider);

    const events = await collect(runInsight({ input: singleNightInput(), config: LOCAL_CONFIG }));
    const last = terminal(events);
    expect(call).toBe(2);
    expect(last.type).toBe('complete');
    if (last.type === 'complete') {
      expect(last.usedFallback).toBe(false);
      expect(last.text).toBe(good);
      expect(last.validation.ok).toBe(true);
    }
  });

  it('completes on first pass with no regenerate when the narrative validates', async () => {
    const onGenerate = vi.fn();
    createProviderMock.mockReturnValue(
      streamingProvider(
        'webllm',
        [
          'Your AHI was 4.2 events/h, within the normal range; this is an estimate, interpret with care.',
        ],
        { onGenerate },
      ),
    );
    const events = await collect(runInsight({ input: singleNightInput(), config: LOCAL_CONFIG }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(terminal(events).type).toBe('complete');
  });
});

// ─── 4. Abort path ───────────────────────────────────────────────────────────

describe('runInsight — abort', () => {
  it('emits an aborted error when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await collect(
      runInsight({ input: singleNightInput(), config: LOCAL_CONFIG, signal: controller.signal }),
    );
    const last = terminal(events);
    expect(last.type).toBe('error');
    if (last.type === 'error') expect(last.error.kind).toBe('aborted');
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it('aborts mid-stream and surfaces an aborted error', async () => {
    const controller = new AbortController();
    const provider: LLMProvider = {
      backend: 'webllm',
      capabilities: () => ({ backend: 'webllm', egress: 'none', consent: 'none', streaming: true }),
      checkAvailability: () => Promise.resolve({ state: 'available', reason: null }),
      async *generate(options: GenerateOptions): AsyncIterable<StreamChunk> {
        yield { text: 'partial ', done: false };
        controller.abort();
        if (options.signal?.aborted) {
          throw new LLMError('aborted', 'aborted', { backend: 'webllm' });
        }
        yield { text: 'more', done: true };
      },
    };
    createProviderMock.mockReturnValue(provider);

    const events = await collect(
      runInsight({ input: singleNightInput(), config: LOCAL_CONFIG, signal: controller.signal }),
    );
    const last = terminal(events);
    expect(last.type).toBe('error');
    if (last.type === 'error') expect(last.error.kind).toBe('aborted');
    // A partial delta was emitted before the abort (retained for the UI).
    expect(events.some((e) => e.type === 'delta')).toBe(true);
  });
});

// ─── 5. Empty / insufficient-data short-circuit ──────────────────────────────

describe('runInsight — empty short-circuit (no provider created)', () => {
  it('emits empty:no-data with a null context for an empty date range', async () => {
    const input: InsightInput = { kind: 'date-range', ...COMMON, aggregates: [], trends: [] };
    const events = await collect(runInsight({ input, config: LOCAL_CONFIG }));
    const last = terminal(events);
    expect(last.type).toBe('empty');
    if (last.type === 'empty') {
      expect(last.reason).toBe('no-data');
      expect(last.context).toBeNull();
    }
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it('emits empty:too-few-for-trend for a 1-night range', async () => {
    const input: InsightInput = {
      kind: 'date-range',
      ...COMMON,
      aggregates: [makeAggregate()],
      trends: [],
    };
    const events = await collect(runInsight({ input, config: LOCAL_CONFIG }));
    const last = terminal(events);
    expect(last.type).toBe('empty');
    if (last.type === 'empty') {
      expect(last.reason).toBe('too-few-for-trend');
      // A snapshot is still built for "show your work".
      expect(last.context).not.toBeNull();
    }
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it('emits empty:metric-unavailable for an explain input with no metric or chart', async () => {
    const input: InsightInput = {
      kind: 'explain',
      ...COMMON,
      scope: { startDate: '2026-06-20', endDate: '2026-06-20' },
    };
    const events = await collect(runInsight({ input, config: LOCAL_CONFIG }));
    expect(terminal(events).type).toBe('empty');
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it('does NOT short-circuit a sufficient date-range trend input', async () => {
    const trend: LinearTrend = {
      slope: -0.18,
      intercept: 5,
      r: -0.4,
      rSquared: 0.16,
      pValue: 0.04,
      trendDirection: 'decreasing',
      trendStrength: 'moderate',
    };
    const input: InsightInput = {
      kind: 'date-range',
      ...COMMON,
      aggregates: [makeAggregate(), makeAggregate(), makeAggregate()],
      trends: [{ metricId: 'ahi', label: 'AHI', slopeUnit: 'events/h per day', trend, n: 3 }],
    };
    createProviderMock.mockReturnValue(
      streamingProvider('webllm', [
        'AHI showed a moderate decreasing trend over 3 nights, statistically significant. This estimate may be worth discussing.',
      ]),
    );
    const events = await collect(runInsight({ input, config: LOCAL_CONFIG }));
    expect(createProviderMock).toHaveBeenCalledTimes(1);
    expect(terminal(events).type).not.toBe('empty');
  });
});

// ─── 6. Progress forwarding + phase events ───────────────────────────────────

describe('runInsight — progress + phases', () => {
  it('forwards WebLLM model-load progress and emits loading/generating phases', async () => {
    createProviderMock.mockReturnValue(
      streamingProvider('webllm', ['Your AHI was 4.2 events/h, within the normal range.'], {
        progress: [{ phase: 'downloading', fraction: 0.5, text: 'Downloading… 50%' }],
      }),
    );
    const events = await collect(runInsight({ input: singleNightInput(), config: LOCAL_CONFIG }));

    expect(events.some((e) => e.type === 'progress')).toBe(true);
    const phases = events
      .filter((e) => e.type === 'phase')
      .map((e) => (e.type === 'phase' ? e.phase : ''));
    expect(phases).toContain('preparing');
    expect(phases).toContain('loading');
    expect(phases).toContain('generating');
  });
});
