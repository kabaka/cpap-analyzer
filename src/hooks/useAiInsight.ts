/**
 * `useAiInsight` — the React hook the AI-Insights UI drives (ADR 0024; design
 * reference `docs/design/ai-insights-ux.md` §5 state machine, §6 error taxonomy).
 *
 * It wraps {@link file://src/services/llm/runInsight.ts} `runInsight` as the UX
 * §5 state machine — `idle → generating → complete | error | empty` — and
 * exposes everything a view needs to render the six insight states without
 * touching the service layer or any store itself:
 *
 * - `state`         — the current machine state.
 * - `text`          — the streamed (then final/validated) narrative.
 * - `error`         — a typed {@link LLMError} plus a plain-language, actionable
 *                     `message`/`primaryAction` mapped per UX §6 (`null` unless
 *                     `state === 'error'`). Raw provider strings never surface.
 * - `sourceContext` — the grounded {@link GroundedContext} for the "show your
 *                     work" panel (UX §4.4), available from the first event.
 * - `usedFallback`  — true when validation failed twice and the deterministic
 *                     template was substituted (UX §4.4 / design §5).
 * - `progress`      — the latest on-device model-load progress (WebLLM), or null.
 * - `phase`         — the coarse status-line phase (`preparing`/`loading`/
 *                     `generating`) for UX §5.2.
 * - `needsConsent`  — set when a cloud backend lacks fresh consent (UX §9.6); the
 *                     view routes the user to the consent gate. No egress occurred.
 * - `feedback`      — local-only thumbs (`'up' | 'down' | null`); **never
 *                     transmitted** (Privacy, Core Principle 1 — no telemetry).
 *
 * Actions: `run(input, brief?)`, `stop()`, `regenerate()`, `setFeedback()`.
 *
 * Privacy & correctness posture:
 * - Settings, the session API key, and the WebLLM worker factory are resolved
 *   from the stores HERE and injected into `runInsight`; the service layer stays
 *   store-free and auditable.
 * - The empty short-circuit (UX §5.5) is enforced inside `runInsight` BEFORE a
 *   provider is created — the hook simply renders the resulting `empty` state.
 * - Feedback lives in component state only; nothing about it ever leaves the tab.
 *
 * @module hooks/useAiInsight
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLLMCredentialStore } from '@/stores/useLLMCredentialStore';
import { useSettingsStore } from '@/stores/useSettingsStore';

import type { GroundedContext } from '@/services/llm/context/types';
import type { ValidationResult } from '@/services/llm/grounding';
import { runInsight } from '@/services/llm/runInsight';
import type {
  InsightInput,
  RunBackendConfig,
  EmptyEvent,
  PhaseEvent,
} from '@/services/llm/runInsight';
import { LLMError } from '@/services/llm/types';
import type { LLMErrorKind, ModelLoadProgress } from '@/services/llm/types';

// ─── Public state-machine + view-model types ─────────────────────────────────

/** The UX §5 state machine. */
export type InsightState = 'idle' | 'generating' | 'complete' | 'error' | 'empty';

/** Local-only thumbs feedback (UX §5.6). Never transmitted. */
export type InsightFeedback = 'up' | 'down' | null;

/** A concrete recovery affordance the view should render for an error (UX §6). */
export type ErrorPrimaryAction =
  | 'open-settings'
  | 'open-settings-key'
  | 'retry'
  | 'switch-on-device'
  | 'download-model'
  | 'pick-smaller-model'
  | 'regenerate';

/**
 * A view-ready error: the typed {@link LLMError} (for branching/logging) plus the
 * plain-language message and recommended action mapped from `error.kind` per the
 * UX §6 taxonomy. The raw `error.cause` is for console logging only and is never
 * rendered (UX §5.4).
 */
export interface InsightError {
  readonly kind: LLMErrorKind;
  readonly message: string;
  readonly primaryAction: ErrorPrimaryAction;
  /** Whether a `retry`/`regenerate` may plausibly succeed. */
  readonly retryable: boolean;
  /** The underlying typed error (for logging / advanced branching). */
  readonly cause: LLMError;
}

/** The hook's return value. */
export interface UseAiInsight {
  readonly state: InsightState;
  /** The streamed (then validated/final) narrative. Empty until generation. */
  readonly text: string;
  /** The view-ready error, or `null` unless `state === 'error'`. */
  readonly error: InsightError | null;
  /** The grounded snapshot (for "show your work"), or `null` before a run. */
  readonly sourceContext: GroundedContext | null;
  /** True when the deterministic template fallback was surfaced (design §5). */
  readonly usedFallback: boolean;
  /** Latest on-device model-load progress (WebLLM), or `null`. */
  readonly progress: ModelLoadProgress | null;
  /** Coarse status-line phase (UX §5.2), or `null` when idle/complete. */
  readonly phase: PhaseEvent['phase'] | null;
  /**
   * Set when a cloud backend lacks fresh consent (UX §9.6). The view sends the
   * user to the consent gate; no context was built and nothing egressed.
   */
  readonly needsConsent: { readonly stale: boolean } | null;
  /** Why an `empty` state was reached (UX §7.7), or `null`. */
  readonly emptyReason: EmptyEvent['reason'] | null;
  /** Local-only thumbs feedback (UX §5.6). */
  readonly feedback: InsightFeedback;
  /** The validation summary of the surfaced narrative, or `null`. */
  readonly validation: ValidationResult | null;
  /** Whether generation is currently in flight (for disabling re-entrant runs). */
  readonly isGenerating: boolean;

  /** Start a run for the given insight input (and optional narration brief). */
  run: (input: InsightInput, userBrief?: string) => void;
  /** Stop an in-flight generation; partial text is retained (UX §5.2). */
  stop: () => void;
  /** Re-run with the same input/brief as the last `run` (UX §5.3). */
  regenerate: () => void;
  /** Set (or clear, with `null`) the local-only thumbs feedback (UX §5.6). */
  setFeedback: (feedback: InsightFeedback) => void;
}

// ─── Error mapping (UX §6 taxonomy) ──────────────────────────────────────────

/**
 * Map an {@link LLMError} kind onto its plain-language message + recommended
 * recovery action (UX §6). `<Backend>` is substituted with a friendly name.
 * Messages are descriptive AND actionable, name the backend, and steer cloud
 * failures toward the on-device alternative (UX §6 common rules).
 */
function mapError(error: LLMError, backendLabel: string): InsightError {
  const make = (message: string, primaryAction: ErrorPrimaryAction): InsightError => ({
    kind: error.kind,
    message,
    primaryAction,
    retryable: error.retryable,
    cause: error,
  });

  switch (error.kind) {
    case 'missing-key':
      // Also the `needs-config` surrogate (feature off / no backend chosen).
      return make(`Add your ${backendLabel} API key in settings to use this.`, 'open-settings-key');
    case 'invalid-key':
      return make(
        `Your ${backendLabel} API key was rejected. Check it in settings.`,
        'open-settings-key',
      );
    case 'network-blocked':
      return make(
        `Couldn't reach ${backendLabel}. Your browser blocked the connection or you're offline. On-device backends don't need a connection.`,
        'switch-on-device',
      );
    case 'webgpu-unsupported':
      return make(
        "On-device AI (WebLLM) needs WebGPU, which this browser or device doesn't support. You can use Chrome's built-in AI if available, or a cloud option with your own API key.",
        'switch-on-device',
      );
    case 'model-not-downloaded':
      return make(
        "This on-device model isn't downloaded yet. Download it to continue.",
        'download-model',
      );
    case 'model-load-failed':
      return make(
        "The on-device model couldn't load on this device — it may need more memory. Try a smaller model.",
        'pick-smaller-model',
      );
    case 'rate-limited':
      return make(
        `${backendLabel} is rate-limiting requests. Wait a moment and try again.`,
        'retry',
      );
    case 'refusal':
      return make(
        'The model declined to answer this request. Try regenerating or rephrasing the question.',
        'regenerate',
      );
    case 'validation-failed':
      return make(
        "The summary couldn't be verified against your numbers. Regenerate to try again.",
        'regenerate',
      );
    case 'aborted':
      return make('Generation stopped.', 'regenerate');
    case 'unknown':
    default:
      return make('AI Insights ran into a problem. Try again.', 'retry');
  }
}

/** A friendly, presentable backend label for messages. */
function backendLabelFor(backend: string | null): string {
  switch (backend) {
    case 'anthropic':
      return 'Claude';
    case 'openai-compatible':
      return 'your AI endpoint';
    case 'webllm':
      return 'the on-device model';
    case 'chrome-ai':
      return "Chrome's built-in AI";
    default:
      return 'AI Insights';
  }
}

// ─── The hook ────────────────────────────────────────────────────────────────

/**
 * Build the resolved {@link RunBackendConfig} from the persisted settings and the
 * session credential store. Reading the stores HERE keeps the service layer
 * store-free; the returned object injects the API-key reader (cloud only) and the
 * WebLLM worker factory.
 */
function useResolvedBackendConfig(): () => RunBackendConfig {
  const llm = useSettingsStore((s) => s.integrations.llm);

  // The credential store's getState is read lazily at request time (not on every
  // render) so the key is fetched only when a generation actually runs.
  return useCallback((): RunBackendConfig => {
    const getApiKey = (): string | null => {
      const creds = useLLMCredentialStore.getState();
      if (llm.backend === 'anthropic') return creds.anthropicApiKey;
      if (llm.backend === 'openai-compatible') return creds.openaiApiKey;
      return null;
    };
    return {
      backend: llm.backend,
      enabled: llm.enabled,
      consentAt: llm.consentAt,
      consentContractVersion: llm.consentContractVersion,
      webllm: { modelId: llm.webllm.modelId, createWorker: createWebLLMWorker },
      anthropic: { model: llm.anthropic.model },
      openaiCompatible: {
        baseUrl: llm.openaiCompatible.baseUrl,
        model: llm.openaiCompatible.model,
      },
      getApiKey,
    };
  }, [llm]);
}

/**
 * WebLLM worker factory. The `new Worker(new URL(...))` pattern must appear at a
 * call site Vite can statically analyze so the worker chunk is emitted. Guarded
 * so it is a no-op in non-worker environments (tests/SSR) — providers that need
 * a real worker fail with a classified error there, not a crash.
 */
function createWebLLMWorker(): Worker {
  // NB: a RELATIVE specifier — Vite's worker plugin does NOT resolve the `@`
  // path alias inside `new Worker(new URL(...))`, so an aliased path produces an
  // unresolved worker entry and aborts the production build. Keep this path
  // relative (matching webllmProvider.ts's `'./webllm.worker.ts'`).
  return new Worker(new URL('../services/llm/providers/webllm.worker.ts', import.meta.url), {
    type: 'module',
  });
}

/**
 * The AI-Insights state-machine hook. See the module docblock for the contract.
 *
 * @param runner injectable orchestration entry point (defaults to `runInsight`);
 *   overridden in tests to assert state transitions without a provider.
 */
export function useAiInsight(runner: typeof runInsight = runInsight): UseAiInsight {
  const resolveConfig = useResolvedBackendConfig();

  const [state, setState] = useState<InsightState>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState<InsightError | null>(null);
  const [sourceContext, setSourceContext] = useState<GroundedContext | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [progress, setProgress] = useState<ModelLoadProgress | null>(null);
  const [phase, setPhase] = useState<PhaseEvent['phase'] | null>(null);
  const [needsConsent, setNeedsConsent] = useState<{ stale: boolean } | null>(null);
  const [emptyReason, setEmptyReason] = useState<EmptyEvent['reason'] | null>(null);
  const [feedback, setFeedbackState] = useState<InsightFeedback>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  // The active run's AbortController and the last request (for regenerate).
  const abortRef = useRef<AbortController | null>(null);
  const lastRequestRef = useRef<{ input: InsightInput; userBrief?: string } | null>(null);
  // Monotonic run id so a stale run that resolves late cannot mutate state.
  const runIdRef = useRef(0);
  // Track mount so async state updates after unmount are dropped.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const startRun = useCallback(
    (input: InsightInput, userBrief?: string): void => {
      // Cancel any in-flight run and take a fresh run id.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const myRunId = ++runIdRef.current;
      lastRequestRef.current = userBrief !== undefined ? { input, userBrief } : { input };

      // Reset the view-model for a new run.
      setState('generating');
      setText('');
      setError(null);
      setSourceContext(null);
      setUsedFallback(false);
      setProgress(null);
      setPhase('preparing');
      setNeedsConsent(null);
      setEmptyReason(null);
      setFeedbackState(null);
      setValidation(null);

      const config = resolveConfig();
      const backendLabel = backendLabelFor(config.backend);

      void (async () => {
        try {
          for await (const event of runner({
            input,
            config,
            ...(userBrief !== undefined ? { userBrief } : {}),
            signal: controller.signal,
          })) {
            // Drop events from a superseded run.
            if (runIdRef.current !== myRunId || !mountedRef.current) return;
            switch (event.type) {
              case 'phase':
                setPhase(event.phase);
                break;
              case 'progress':
                setProgress(event.progress);
                break;
              case 'delta':
                setText(event.accumulated);
                break;
              case 'complete':
                setText(event.text);
                setUsedFallback(event.usedFallback);
                setSourceContext(event.context);
                setValidation(event.validation);
                setPhase(null);
                setState('complete');
                break;
              case 'error':
                setError(mapError(event.error, backendLabel));
                setPhase(null);
                setState('error');
                break;
              case 'needs-consent':
                setNeedsConsent({ stale: event.stale });
                setPhase(null);
                // Surface as a config-style error so the panel routes to the gate.
                setError(
                  mapError(
                    new LLMError('missing-key', 'Cloud consent required.', {
                      backend: event.backend,
                      retryable: false,
                    }),
                    backendLabel,
                  ),
                );
                setState('error');
                break;
              case 'empty':
                setEmptyReason(event.reason);
                setSourceContext(event.context);
                setPhase(null);
                setState('empty');
                break;
            }
          }
        } catch (err) {
          if (runIdRef.current !== myRunId || !mountedRef.current) return;
          const llmError =
            err instanceof LLMError
              ? err
              : new LLMError('unknown', 'AI Insights generation failed.', {
                  backend: config.backend,
                  cause: err,
                });
          setError(mapError(llmError, backendLabel));
          setPhase(null);
          setState('error');
        }
      })();
    },
    [resolveConfig, runner],
  );

  const run = useCallback(
    (input: InsightInput, userBrief?: string): void => {
      startRun(input, userBrief);
    },
    [startRun],
  );

  const stop = useCallback((): void => {
    abortRef.current?.abort();
    // `runInsight` emits a terminal `aborted` error, which transitions to
    // `error`; partial text already in `text` is retained for the UI to label
    // "Stopped — partial result" (UX §5.2).
  }, []);

  const regenerate = useCallback((): void => {
    const last = lastRequestRef.current;
    if (last === null) return;
    startRun(last.input, last.userBrief);
  }, [startRun]);

  const setFeedback = useCallback((next: InsightFeedback): void => {
    // Local-only (Privacy, Core Principle 1). No network, ever.
    setFeedbackState(next);
  }, []);

  return {
    state,
    text,
    error,
    sourceContext,
    usedFallback,
    progress,
    phase,
    needsConsent,
    emptyReason,
    feedback,
    validation,
    isGenerating: state === 'generating',
    run,
    stop,
    regenerate,
    setFeedback,
  };
}
