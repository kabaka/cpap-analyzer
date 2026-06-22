/**
 * Tests for the {@link useAiInsight} state-machine hook (UX §5).
 *
 * Drives the hook with an injected, fully-mocked `runInsight` so we assert the
 * idle → generating → complete | error | empty transitions, the streamed text,
 * the typed-error → user-message mapping (UX §6), source-context exposure,
 * fallback flagging, consent surfacing, and the local-only feedback — all
 * without a provider, network, or model.
 *
 * @module hooks/__tests__/useAiInsight.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useSettingsStore } from '@/stores/useSettingsStore';
import { LLMError } from '@/services/llm/types';
import type { runInsight, InsightEvent, InsightInput } from '@/services/llm/runInsight';
import { useAiInsight } from '@/hooks/useAiInsight';
import { COMMON, makeAggregate } from '@/services/llm/context/__tests__/fixtures';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build an injectable runner that yields a fixed event script. */
function scriptedRunner(events: readonly InsightEvent[]): typeof runInsight {
  return async function* mockRun(): AsyncIterable<InsightEvent> {
    for (const event of events) yield event;
  } as typeof runInsight;
}

function singleNightInput(): InsightInput {
  return { kind: 'single-night', ...COMMON, aggregate: makeAggregate() };
}

/** A minimal grounded context stub good enough for the hook's pass-through. */
function contextStub() {
  return { insightType: 'single-night' } as unknown as Extract<
    InsightEvent,
    { type: 'complete' }
  >['context'];
}

beforeEach(() => {
  // Configure a usable local backend so the hook resolves a config without
  // tripping the disabled/no-backend guards (the mocked runner ignores it, but
  // the resolver still runs).
  act(() => {
    useSettingsStore.getState().updateIntegration('llm', {
      enabled: true,
      backend: 'webllm',
      consentAt: null,
      consentContractVersion: null,
    });
  });
});

// ─── Transitions ─────────────────────────────────────────────────────────────

describe('useAiInsight — state machine', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useAiInsight(scriptedRunner([])));
    expect(result.current.state).toBe('idle');
    expect(result.current.text).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('streams deltas and reaches complete with source context', async () => {
    const ctx = contextStub();
    const runner = scriptedRunner([
      { type: 'phase', phase: 'preparing' },
      { type: 'delta', text: 'Your AHI ', accumulated: 'Your AHI ' },
      { type: 'delta', text: 'was 4.2.', accumulated: 'Your AHI was 4.2.' },
      {
        type: 'complete',
        text: 'Your AHI was 4.2.',
        usedFallback: false,
        context: ctx,
        validation: { ok: true, violations: [] },
        backend: 'webllm',
      },
    ]);
    const { result } = renderHook(() => useAiInsight(runner));

    act(() => {
      result.current.run(singleNightInput());
    });

    await waitFor(() => expect(result.current.state).toBe('complete'));
    expect(result.current.text).toBe('Your AHI was 4.2.');
    expect(result.current.usedFallback).toBe(false);
    expect(result.current.sourceContext).toBe(ctx);
    expect(result.current.validation?.ok).toBe(true);
    expect(result.current.phase).toBeNull();
  });

  it('surfaces usedFallback on a fallback complete', async () => {
    const runner = scriptedRunner([
      {
        type: 'complete',
        text: 'Summary for 2024-01-01: AHI: 4.2 events/h.',
        usedFallback: true,
        context: contextStub(),
        validation: { ok: false, violations: [] },
        backend: 'webllm',
      },
    ]);
    const { result } = renderHook(() => useAiInsight(runner));
    act(() => result.current.run(singleNightInput()));
    await waitFor(() => expect(result.current.state).toBe('complete'));
    expect(result.current.usedFallback).toBe(true);
  });

  it('maps a typed LLMError to a plain-language message (UX §6)', async () => {
    const runner = scriptedRunner([
      {
        type: 'error',
        error: new LLMError('network-blocked', 'fetch failed', { backend: 'anthropic' }),
      },
    ]);
    const { result } = renderHook(() => useAiInsight(runner));
    act(() => result.current.run(singleNightInput()));
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error?.kind).toBe('network-blocked');
    expect(result.current.error?.message).toMatch(/blocked the connection|offline/i);
    expect(result.current.error?.primaryAction).toBe('switch-on-device');
    // The raw cause is never exposed as the message.
    expect(result.current.error?.message).not.toContain('fetch failed');
  });

  it('routes a needs-consent event to a config-style error and flags consent', async () => {
    const runner = scriptedRunner([{ type: 'needs-consent', backend: 'anthropic', stale: false }]);
    const { result } = renderHook(() => useAiInsight(runner));
    act(() => result.current.run(singleNightInput()));
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.needsConsent).toEqual({ stale: false });
    expect(result.current.error?.primaryAction).toBe('open-settings-key');
  });

  it('reaches empty with the reason and any available context', async () => {
    const runner = scriptedRunner([{ type: 'empty', reason: 'too-few-for-trend', context: null }]);
    const { result } = renderHook(() => useAiInsight(runner));
    act(() => result.current.run(singleNightInput()));
    await waitFor(() => expect(result.current.state).toBe('empty'));
    expect(result.current.emptyReason).toBe('too-few-for-trend');
  });

  it('forwards model-load progress', async () => {
    const runner = scriptedRunner([
      { type: 'progress', progress: { phase: 'downloading', fraction: 0.3, text: '30%' } },
      {
        type: 'complete',
        text: 'done',
        usedFallback: false,
        context: contextStub(),
        validation: { ok: true, violations: [] },
        backend: 'webllm',
      },
    ]);
    const { result } = renderHook(() => useAiInsight(runner));
    act(() => result.current.run(singleNightInput()));
    await waitFor(() => expect(result.current.state).toBe('complete'));
    expect(result.current.progress).toEqual({ phase: 'downloading', fraction: 0.3, text: '30%' });
  });
});

// ─── Feedback (local-only) ───────────────────────────────────────────────────

describe('useAiInsight — feedback', () => {
  it('keeps thumbs feedback in local state only', async () => {
    const runner = scriptedRunner([
      {
        type: 'complete',
        text: 'done',
        usedFallback: false,
        context: contextStub(),
        validation: { ok: true, violations: [] },
        backend: 'webllm',
      },
    ]);
    const { result } = renderHook(() => useAiInsight(runner));
    act(() => result.current.run(singleNightInput()));
    await waitFor(() => expect(result.current.state).toBe('complete'));

    act(() => result.current.setFeedback('up'));
    expect(result.current.feedback).toBe('up');
    act(() => result.current.setFeedback('down'));
    expect(result.current.feedback).toBe('down');
    act(() => result.current.setFeedback(null));
    expect(result.current.feedback).toBeNull();
  });

  it('resets feedback on a new run', async () => {
    const runner = scriptedRunner([
      {
        type: 'complete',
        text: 'done',
        usedFallback: false,
        context: contextStub(),
        validation: { ok: true, violations: [] },
        backend: 'webllm',
      },
    ]);
    const { result } = renderHook(() => useAiInsight(runner));
    act(() => result.current.run(singleNightInput()));
    await waitFor(() => expect(result.current.state).toBe('complete'));
    act(() => result.current.setFeedback('up'));
    expect(result.current.feedback).toBe('up');

    act(() => result.current.run(singleNightInput()));
    expect(result.current.feedback).toBeNull();
  });
});
