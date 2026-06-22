/**
 * Tests for the AI Insights in-app surfaces — {@link InsightTrigger} and
 * {@link InsightDrawer} (UX §4, §5; visual spec §3).
 *
 * The {@link useAiInsight} hook is MOCKED throughout: these tests drive the
 * drawer's state machine directly (idle → generating → complete → error/empty)
 * without ever instantiating a real provider, so they assert the UI contract,
 * not the orchestration (which is tested at the hook/service layer).
 *
 * Coverage:
 * - the trigger is absent when `integrations.llm.enabled === false` (opt-in);
 * - opening the drawer renders the idle state with suggested chips;
 * - a streaming → complete run renders the caveat + source panel;
 * - the empty state renders for an insufficient-data input;
 * - a needs-consent run renders the "Finish setup in Settings" affordance.
 *
 * @module components/insights/__tests__/InsightDrawer.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Spy on router navigation so error-recovery deep-links can be asserted without
// a real route tree. `useNavigate` is the only export the drawer needs mocked;
// everything else (MemoryRouter) is preserved via the actual module.
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

import { useSettingsStore } from '@/stores/useSettingsStore';
import type { GroundedContext } from '@/services/llm/context/types';
import type { InsightInput } from '@/services/llm/runInsight';
import type { UseAiInsight } from '@/hooks/useAiInsight';

import { InsightDrawer } from '../InsightDrawer';
import { InsightTrigger } from '../InsightTrigger';
import { useInsightDrawerStore } from '../useInsightDrawerStore';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A minimal grounded context for the "show your work" panel assertions. */
const FAKE_CONTEXT: GroundedContext = {
  schemaVersion: 1,
  insightType: 'single-night',
  generatedOnDate: '2026-06-20',
  machineClass: 'APAP',
  scope: {
    startDate: '2026-06-20',
    endDate: '2026-06-20',
    nightCount: 1,
    nightsWithDefinedRate: 1,
  },
  metrics: [
    {
      id: 'ahi',
      label: 'AHI',
      availability: 'present',
      displayValue: '4.2',
      unit: 'events/h',
      reliabilityTier: 'high',
      dataQualityFlags: [],
      caveat: null,
    },
  ],
  trends: [],
  clinical: {
    ahiThresholds: { mild: 5, moderate: 15, severe: 30 },
    ahiThresholdsSource: 'aasm-icsd3-default',
    cmsComplianceHours: 4,
    recommendedUsageHours: 6,
    complianceDefinition: 'compliant ≥ 4h',
    referenceProvenance: 'AASM',
  },
  display: {
    dateFormat: 'YYYY-MM-DD',
    timeFormat: '24h',
    pressureUnit: 'cmH2O',
    leakUnit: 'L/min',
    tidalVolumeUnit: 'mL',
  },
  numericAllowList: ['4.2'],
};

/** A throwaway single-night input (its contents are irrelevant to the mock). */
const FAKE_INPUT: InsightInput = {
  kind: 'single-night',
  // The hook is mocked, so the aggregate is never read; a minimal cast keeps the
  // fixture small. Justified: the orchestration that consumes it is mocked out.
  aggregate: { date: '2026-06-20' } as never,
  ahiThresholds: { mild: 5, moderate: 15, severe: 30 },
  ahiThresholdsSource: 'aasm-icsd3-default',
  machineClass: 'APAP',
  display: FAKE_CONTEXT.display,
  generatedOnDate: '2026-06-20',
};

/** Build a mock `useAiInsight` return value from partial overrides. */
function makeInsight(overrides: Partial<UseAiInsight> = {}): UseAiInsight {
  return {
    state: 'idle',
    text: '',
    error: null,
    sourceContext: null,
    usedFallback: false,
    progress: null,
    phase: null,
    needsConsent: null,
    emptyReason: null,
    feedback: null,
    validation: null,
    isGenerating: false,
    run: vi.fn(),
    stop: vi.fn(),
    regenerate: vi.fn(),
    setFeedback: vi.fn(),
    ...overrides,
  };
}

/** A `typeof useAiInsight` stand-in that always returns `value`. */
function mockHook(value: UseAiInsight): () => UseAiInsight {
  return () => value;
}

function renderDrawer(value: UseAiInsight) {
  return render(
    <MemoryRouter>
      <InsightDrawer insightHook={mockHook(value) as never} />
    </MemoryRouter>,
  );
}

function openDrawer(): void {
  useInsightDrawerStore
    .getState()
    .openInsight({ input: FAKE_INPUT, scopeLabel: 'the night of 20 Jun 2026' });
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

/**
 * Stub `navigator.clipboard.writeText` so the Copy path can be asserted without a
 * real clipboard (jsdom has none). Resolves so the drawer flips to its "Copied"
 * affordance — exercising the success branch of `handleCopy`.
 */
const writeTextSpy = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());

beforeEach(() => {
  navigateSpy.mockReset();
  writeTextSpy.mockReset();
  writeTextSpy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writeTextSpy },
  });
  useInsightDrawerStore.getState().close();
  useSettingsStore.setState((s) => ({
    integrations: {
      ...s.integrations,
      llm: { ...s.integrations.llm, enabled: false, backend: null },
    },
  }));
});

afterEach(() => {
  cleanup();
  useInsightDrawerStore.getState().close();
});

// ─── InsightTrigger ──────────────────────────────────────────────────────────

describe('InsightTrigger', () => {
  it('renders nothing when AI Insights is disabled (opt-in, out of the way)', () => {
    render(
      <MemoryRouter>
        <InsightTrigger
          label="Summarize this night"
          buildRequest={() => ({ input: FAKE_INPUT, scopeLabel: 'tonight' })}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /summarize this night/i })).toBeNull();
  });

  it('renders and opens the drawer with a request when enabled', () => {
    useSettingsStore.setState((s) => ({
      integrations: { ...s.integrations, llm: { ...s.integrations.llm, enabled: true } },
    }));
    const buildRequest = vi.fn(() => ({
      input: FAKE_INPUT,
      scopeLabel: 'the night of 20 Jun 2026',
    }));

    render(
      <MemoryRouter>
        <InsightTrigger label="Summarize this night" buildRequest={buildRequest} />
      </MemoryRouter>,
    );

    const button = screen.getByRole('button', { name: /summarize this night/i });
    fireEvent.click(button);

    expect(buildRequest).toHaveBeenCalledTimes(1);
    expect(useInsightDrawerStore.getState().open).toBe(true);
    expect(useInsightDrawerStore.getState().request?.scopeLabel).toBe('the night of 20 Jun 2026');
  });
});

// ─── InsightDrawer — idle ────────────────────────────────────────────────────

describe('InsightDrawer idle state', () => {
  it('renders the scope header, AI marker, and suggested chips', () => {
    openDrawer();
    renderDrawer(makeInsight({ state: 'idle' }));

    // Scope subhead names the night (HAX G1).
    expect(screen.getByText(/Summary of the night of 20 Jun 2026/i)).toBeInTheDocument();
    // The reserved ✨ AI marker is present (the "AI" text carries the signal).
    expect(screen.getAllByText('AI').length).toBeGreaterThan(0);
    // Suggested chips for a single-night insight (UX §7.6).
    expect(
      screen.getByRole('button', { name: /summarize this night in plain language/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /suggested questions/i })).toBeInTheDocument();
  });

  it('calls run with the chip brief when a chip is activated', () => {
    openDrawer();
    const insight = makeInsight({ state: 'idle' });
    renderDrawer(insight);

    fireEvent.click(screen.getByRole('button', { name: /explain my leak numbers/i }));
    expect(insight.run).toHaveBeenCalledWith(
      FAKE_INPUT,
      'Explain the leak numbers for this night.',
    );
  });
});

// ─── InsightDrawer — generating → complete ───────────────────────────────────

describe('InsightDrawer streaming and complete', () => {
  it('renders streamed text, the caveat, and the source panel while generating', () => {
    openDrawer();
    renderDrawer(
      makeInsight({
        state: 'generating',
        isGenerating: true,
        phase: 'generating',
        text: 'Your AHI was 4.2',
        sourceContext: FAKE_CONTEXT,
      }),
    );

    expect(screen.getByText(/Your AHI was 4.2/)).toBeInTheDocument();
    // The inseparable caveat is present from the first token (UX §4.5).
    expect(screen.getByRole('note', { name: /AI disclaimer/i })).toBeInTheDocument();
    // The "show your work" panel renders the source metric immediately (UX §4.4).
    expect(screen.getByText('Based on these numbers')).toBeInTheDocument();
    expect(screen.getByText('AHI')).toBeInTheDocument();
    // A Stop affordance is offered during streaming (UX §5.2).
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('renders the complete narrative wrapped in the caveat with the source panel', () => {
    openDrawer();
    renderDrawer(
      makeInsight({
        state: 'complete',
        text: 'Your AHI was 4.2 events/h, within the normal range.',
        sourceContext: FAKE_CONTEXT,
      }),
    );

    expect(screen.getByText(/within the normal range/i)).toBeInTheDocument();
    expect(screen.getByRole('note', { name: /AI disclaimer/i })).toBeInTheDocument();
    expect(screen.getByText('Based on these numbers')).toBeInTheDocument();
    // The 4.2 value from the grounded context appears in the source panel.
    expect(screen.getAllByText(/4\.2 events\/h/).length).toBeGreaterThan(0);
    // Complete-state action row (UX §5.3).
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeInTheDocument();
  });

  it('records local-only thumbs feedback without any network call', () => {
    openDrawer();
    const insight = makeInsight({
      state: 'complete',
      text: 'done',
      sourceContext: FAKE_CONTEXT,
    });
    renderDrawer(insight);

    fireEvent.click(screen.getByRole('button', { name: /mark this summary helpful/i }));
    expect(insight.setFeedback).toHaveBeenCalledWith('up');
  });
});

// ─── InsightDrawer — empty ───────────────────────────────────────────────────

describe('InsightDrawer empty state', () => {
  it('shows the insufficient-data message and the source panel', () => {
    openDrawer();
    renderDrawer(
      makeInsight({
        state: 'empty',
        emptyReason: 'no-data',
        sourceContext: null,
      }),
    );

    expect(screen.getByText(/no data in this range to summarize/i)).toBeInTheDocument();
    // The source panel still renders, explaining there are no nights.
    expect(screen.getByText('Based on these numbers')).toBeInTheDocument();
    expect(screen.getByText(/No nights in this range/i)).toBeInTheDocument();
  });
});

// ─── InsightDrawer — needs-consent error ─────────────────────────────────────

describe('InsightDrawer needs-consent', () => {
  it('renders the "Finish setup in Settings" affordance instead of a consent dialog', () => {
    useSettingsStore.setState((s) => ({
      integrations: {
        ...s.integrations,
        llm: { ...s.integrations.llm, enabled: true, backend: 'anthropic' },
      },
    }));
    openDrawer();
    renderDrawer(
      makeInsight({
        state: 'error',
        needsConsent: { stale: false },
        error: {
          kind: 'missing-key',
          message: 'Cloud consent required.',
          primaryAction: 'open-settings-key',
          retryable: false,
          cause: { kind: 'missing-key' } as never,
        },
      }),
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish setup in settings/i })).toBeInTheDocument();
  });
});

// ─── InsightDrawer — non-consent error states (UX §6 taxonomy) ───────────────

describe('InsightDrawer non-consent error states', () => {
  it('renders the mapped message and routes a missing-key error to AI Insights settings', () => {
    useSettingsStore.setState((s) => ({
      integrations: {
        ...s.integrations,
        llm: { ...s.integrations.llm, enabled: true, backend: 'anthropic' },
      },
    }));
    openDrawer();
    const insight = makeInsight({
      state: 'error',
      // needsConsent is null: this is a true config error, not the consent gate.
      needsConsent: null,
      error: {
        kind: 'missing-key',
        message: 'Add your Claude API key in settings to use this.',
        primaryAction: 'open-settings-key',
        retryable: false,
        cause: { kind: 'missing-key' } as never,
      },
    });
    renderDrawer(insight);

    // The generic error heading (not the consent-specific one) is shown.
    expect(screen.getByText(/AI Insights couldn’t run/i)).toBeInTheDocument();
    // The mapped, plain-language message is rendered verbatim (no raw provider text).
    expect(
      screen.getByText(/Add your Claude API key in settings to use this\./i),
    ).toBeInTheDocument();

    // The primary recovery action deep-links to the AI Insights settings panel.
    const action = screen.getByRole('button', { name: /finish setup in settings/i });
    fireEvent.click(action);
    expect(navigateSpy).toHaveBeenCalledWith('/settings#ai-insights');
    // A config error must NOT silently regenerate.
    expect(insight.regenerate).not.toHaveBeenCalled();
  });

  it('renders a retry action for a retryable network-blocked error and calls regenerate', () => {
    useSettingsStore.setState((s) => ({
      integrations: {
        ...s.integrations,
        llm: { ...s.integrations.llm, enabled: true, backend: 'anthropic' },
      },
    }));
    openDrawer();
    const insight = makeInsight({
      state: 'error',
      needsConsent: null,
      error: {
        kind: 'network-blocked',
        message:
          "Couldn't reach Claude. Your browser blocked the connection or you're offline. On-device backends don't need a connection.",
        // A retryable kind maps to 'switch-on-device', whose button label is "Retry".
        primaryAction: 'switch-on-device',
        retryable: true,
        cause: { kind: 'network-blocked' } as never,
      },
    });
    renderDrawer(insight);

    expect(screen.getByText(/Couldn't reach Claude/i)).toBeInTheDocument();

    // The recovery action is a retry, NOT a settings deep-link.
    const action = screen.getByRole('button', { name: /^retry$/i });
    fireEvent.click(action);
    expect(insight.regenerate).toHaveBeenCalledTimes(1);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

// ─── InsightDrawer — deterministic fallback notice (UX §4.4 / design §5) ─────

describe('InsightDrawer fallback notice', () => {
  it('shows the plain-template notice on a usedFallback complete result, with prose + caveat', () => {
    openDrawer();
    renderDrawer(
      makeInsight({
        state: 'complete',
        usedFallback: true,
        text: 'Your AHI was 4.2 events/h, within the normal range.',
        sourceContext: FAKE_CONTEXT,
      }),
    );

    // The fallback banner explains the app's own computed summary was used.
    expect(
      screen.getByText(/this is the app's own computed summary rather than AI-written text/i),
    ).toBeInTheDocument();
    // The normal narrative still renders.
    expect(screen.getByText(/within the normal range/i)).toBeInTheDocument();
    // The inseparable caveat is still present (never naked prose).
    expect(screen.getByRole('note', { name: /AI disclaimer/i })).toBeInTheDocument();
  });

  it('does not show the fallback notice when usedFallback is false', () => {
    openDrawer();
    renderDrawer(
      makeInsight({
        state: 'complete',
        usedFallback: false,
        text: 'Your AHI was 4.2 events/h, within the normal range.',
        sourceContext: FAKE_CONTEXT,
      }),
    );

    expect(
      screen.queryByText(/this is the app's own computed summary rather than AI-written text/i),
    ).toBeNull();
  });
});

// ─── InsightDrawer — Stop during generation (UX §5.2) ────────────────────────

describe('InsightDrawer stop control', () => {
  it('calls the hook stop() when the Stop button is clicked while generating', () => {
    openDrawer();
    const insight = makeInsight({
      state: 'generating',
      isGenerating: true,
      phase: 'generating',
      text: 'Your AHI was 4.2',
      sourceContext: FAKE_CONTEXT,
    });
    renderDrawer(insight);

    const stop = screen.getByRole('button', { name: /^stop$/i });
    fireEvent.click(stop);
    expect(insight.stop).toHaveBeenCalledTimes(1);
  });
});

// ─── InsightDrawer — Copy carries the caveat footer (UX §7.3) ────────────────

describe('InsightDrawer copy carries the caveat', () => {
  it('writes the narrative WITH the not-medical-advice caveat footer to the clipboard', async () => {
    openDrawer();
    const narrative = 'Your AHI was 4.2 events/h, within the normal range.';
    renderDrawer(
      makeInsight({
        state: 'complete',
        text: narrative,
        sourceContext: FAKE_CONTEXT,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));

    // The clipboard payload is never naked prose: it must carry the caveat footer.
    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    const payload = writeTextSpy.mock.calls[0]?.[0] as string;
    expect(payload).toContain(narrative);
    // Key guarantee (UX §7.3): the safety caveat travels with copied text.
    expect(payload).toContain('May be inaccurate; verify against your data.');
    expect(payload).toContain('Not medical advice.');
    // The generated-on date from the grounded context is stamped in.
    expect(payload).toContain('2026-06-20');

    // The button flips to its copied affordance once the write resolves.
    expect(await screen.findByRole('button', { name: /^copied$/i })).toBeInTheDocument();
  });
});
