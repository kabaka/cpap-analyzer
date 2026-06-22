/**
 * AI Insights orchestration — the integration layer that ties the grounded
 * context builders, the grounding/prompt layer, the provider factory, and the
 * settings/consent gates into a single, streamable run (ADR 0024; design
 * references `docs/design/ai-insights-ux.md`, `docs/design/ai-insights-grounded-context.md`).
 *
 * `runInsight` is the one place where a generation is assembled end-to-end:
 *
 *  1. **Resolve the active backend** from settings. If the feature is disabled or
 *     no backend is chosen, it emits a terminal `error` event of kind
 *     `needs-config` and never touches the provider layer.
 *  2. **Cloud egress gate (Privacy, Core Principle 1).** For the cloud backends
 *     (`anthropic`, and `openai-compatible` with a remote URL) it requires a
 *     fresh consent (`consentAt != null` AND `consentContractVersion ===
 *     EGRESS_CONTRACT_VERSION`). If consent is missing or stale it emits a
 *     terminal `needs-consent` event and STOPS — **no context is built and
 *     nothing egresses.** Local backends (`webllm`, `chrome-ai`) skip this gate.
 *  3. **Empty short-circuit (Correctness, Core Principle 2).** If the supplied
 *     insight input has insufficient data to narrate, it emits a terminal
 *     `empty` event WITHOUT creating a provider — we never ask the model to
 *     narrate a night/range the analysis pipeline produced nothing for.
 *  4. **Build the grounded context** from the insight input. The redaction guard
 *     runs inside the builders, so a forbidden field can never be serialized.
 *  5. **Assemble the prompt** with the `structured` variant for capable cloud
 *     backends and `plain` for small local models.
 *  6. **Stream** the provider's chunks out as `delta` events, forwarding WebLLM's
 *     one-time model-load `onProgress` as `progress` events, accumulating the
 *     full narrative.
 *  7. **Validate** the accumulated narrative with `validateNarrative`. On
 *     failure, regenerate ONCE with the offending tokens fed back into the
 *     prompt; if it fails again, emit the deterministic `renderTemplateFallback`
 *     text with `usedFallback: true` (the drawer renders the canonical fallback
 *     notice; it is NOT baked into the body). Unvalidated text is never surfaced
 *     as the final narrative.
 *  8. The terminal `complete` event always carries the source `GroundedContext`
 *     (for the "show your work" panel — UX §4.4) and a `validation` summary.
 *
 * An {@link AbortSignal} is honored throughout: aborting before/while streaming
 * ends the run with a terminal `error` event of kind `aborted`.
 *
 * This module performs NO store access itself — the caller (the
 * {@link file://src/hooks/useAiInsight.ts} hook) resolves settings, the API-key
 * reader, and the worker factory and injects them, so the privacy surface stays
 * auditable and the orchestration is testable with plain mocks.
 *
 * @module services/llm/runInsight
 */

import type { LLMBackendId } from '@/types/settings';
import { EGRESS_CONTRACT_VERSION } from '@/types/settings';

import {
  buildSingleNightContext,
  buildDateRangeContext,
  buildExplainContext,
  buildClinicalContext,
} from './context';
import type {
  SingleNightInput,
  DateRangeInput,
  ExplainInput,
  ClinicalContextInput,
} from './context/buildGroundedContext';
import type { GroundedContext } from './context/types';
import { buildPrompt, validateNarrative, renderTemplateFallback } from './grounding';
import type { AssembledPrompt, ValidationResult } from './grounding';
import { createProvider } from './providers';
import type { ProviderConfig } from './providers';
import { isLoopbackHost, parseBaseUrl } from './providers/openaiCompatibleProvider';
import { LLMError } from './types';
import type { LLMProvider, ModelLoadProgress } from './types';

// ─── Insight request input (a discriminated union over the four insight types) ─

/**
 * The data the caller supplies to scope a run. One variant per insight type; the
 * `kind` discriminates which grounded-context builder runs. These mirror the
 * builder `*Input` types exactly so the hook passes already-resolved app data
 * straight through (the builders never read a store).
 */
export type InsightInput =
  | ({ readonly kind: 'single-night' } & SingleNightInput)
  | ({ readonly kind: 'date-range' } & DateRangeInput)
  | ({ readonly kind: 'explain' } & ExplainInput)
  | ({ readonly kind: 'clinical-context' } & ClinicalContextInput);

// ─── Run request ─────────────────────────────────────────────────────────────

/**
 * Resolved backend configuration for a run. This is the subset of the persisted
 * `llm` integration settings the orchestration needs, plus the injected API-key
 * reader and (for WebLLM) the worker factory — assembled by the hook so the
 * orchestrator never reads a store directly.
 */
export interface RunBackendConfig {
  /** The active backend; `null` ⇒ a `needs-config` error. */
  readonly backend: LLMBackendId | null;
  /** Whether the feature is enabled; `false` ⇒ a `needs-config` error. */
  readonly enabled: boolean;
  /** ISO timestamp of cloud-egress consent, or `null` (never consented). */
  readonly consentAt: string | null;
  /** EGRESS_CONTRACT_VERSION in force when consent was granted, or `null`. */
  readonly consentContractVersion: number | null;
  /** WebLLM sub-config. */
  readonly webllm: {
    readonly modelId: string | null;
    /** Worker factory (Vite `new Worker(new URL(...))`), injected by the hook. */
    readonly createWorker?: () => Worker;
  };
  /** Anthropic (Claude) sub-config. */
  readonly anthropic: {
    readonly model: 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
  };
  /** OpenAI-compatible sub-config. */
  readonly openaiCompatible: { readonly baseUrl: string | null; readonly model: string | null };
  /**
   * Reader for the active backend's session API key (cloud backends only).
   * Injected from the session-scoped credential store; never read here directly.
   */
  readonly getApiKey: () => string | null;
}

/** A single orchestration run request. */
export interface RunInsightRequest {
  /** What to narrate (drives the grounded-context builder + prompt brief). */
  readonly input: InsightInput;
  /** The resolved backend configuration. */
  readonly config: RunBackendConfig;
  /** The user's chosen narration chip / brief (UX §7.6), or undefined for the default. */
  readonly userBrief?: string;
  /** Cancellation signal — a "Stop" button wires here (honored throughout). */
  readonly signal?: AbortSignal;
}

// ─── Events ──────────────────────────────────────────────────────────────────

/** A streamed text delta (one provider chunk of generated narration). */
export interface DeltaEvent {
  readonly type: 'delta';
  /** Incremental narration text. */
  readonly text: string;
  /**
   * The cumulative narration so far. Convenience for consumers that render the
   * accumulated text directly rather than concatenating deltas themselves.
   */
  readonly accumulated: string;
}

/** A one-time on-device model-load progress update (WebLLM). */
export interface ProgressEvent {
  readonly type: 'progress';
  readonly progress: ModelLoadProgress;
}

/**
 * A coarse phase transition the UX status line branches on (UX §5.2):
 * `preparing` → (local first run) `loading` → `generating`. Emitted before any
 * `delta`/`progress` so the status line can update without waiting for a token.
 */
export interface PhaseEvent {
  readonly type: 'phase';
  readonly phase: 'preparing' | 'loading' | 'generating';
}

/** A successful terminal event carrying the validated narrative + provenance. */
export interface CompleteEvent {
  readonly type: 'complete';
  /** The final, validated narrative (or the deterministic fallback). */
  readonly text: string;
  /**
   * True when validation failed twice and the deterministic template fallback
   * was substituted. The `text` is the clean template prose only; the drawer
   * renders the canonical notice ({@link FALLBACK_NOTICE}) above it.
   */
  readonly usedFallback: boolean;
  /** The source snapshot (for the "show your work" panel — UX §4.4). */
  readonly context: GroundedContext;
  /** The validation summary for the narrative that was surfaced. */
  readonly validation: ValidationResult;
  /** The backend that produced this run. */
  readonly backend: LLMBackendId;
}

/** A terminal error event. `error.kind` drives the UX error taxonomy (UX §6). */
export interface ErrorEvent {
  readonly type: 'error';
  readonly error: LLMError;
}

/**
 * A terminal "needs cloud consent" event (UX §9.6). Emitted instead of building
 * any context or contacting any provider when a cloud backend lacks fresh
 * consent — nothing egresses.
 */
export interface NeedsConsentEvent {
  readonly type: 'needs-consent';
  readonly backend: LLMBackendId;
  /** True when consent exists but for an older contract version (stale). */
  readonly stale: boolean;
}

/**
 * A terminal "insufficient data" event (UX §5.5). Emitted WITHOUT creating a
 * provider when the insight input has nothing meaningful to narrate. Carries the
 * grounded context when one could be built (so the "show your work" panel can
 * still show "No nights in this range"); `context` is `null` for a totally empty
 * input where no snapshot is warranted.
 */
export interface EmptyEvent {
  readonly type: 'empty';
  /** Why the input was judged insufficient (drives UX §7.7 microcopy). */
  readonly reason: 'no-data' | 'too-few-for-trend' | 'metric-unavailable';
  readonly context: GroundedContext | null;
}

/** The full discriminated union of orchestration events. */
export type InsightEvent =
  | PhaseEvent
  | ProgressEvent
  | DeltaEvent
  | CompleteEvent
  | ErrorEvent
  | NeedsConsentEvent
  | EmptyEvent;

// ─── Backend classification ──────────────────────────────────────────────────

/**
 * Whether this backend, as configured, egresses to the cloud and therefore
 * requires the two-gate consent. Local backends (`webllm`, `chrome-ai`) never
 * egress; `openai-compatible` egresses only when its base URL is a remote
 * (non-loopback) origin. A malformed/empty URL is treated as cloud (fail-safe:
 * require consent rather than risk an unconsented egress).
 */
export function backendRequiresConsent(config: RunBackendConfig): boolean {
  switch (config.backend) {
    case 'anthropic':
      return true;
    case 'openai-compatible': {
      const baseUrl = config.openaiCompatible.baseUrl;
      if (baseUrl === null || baseUrl.trim() === '') return true;
      const url = parseBaseUrl(baseUrl);
      if (url === null) return true;
      return !isLoopbackHost(url.hostname);
    }
    case 'webllm':
    case 'chrome-ai':
    case null:
      return false;
  }
}

/** Whether fresh, current-contract cloud consent has been granted. */
function hasFreshConsent(config: RunBackendConfig): boolean {
  return config.consentAt !== null && config.consentContractVersion === EGRESS_CONTRACT_VERSION;
}

/**
 * Select the prompt variant. Capable cloud backends get the `structured` variant
 * (the declared-citations channel makes validation a direct subset check); small
 * local models get `plain` prose (design §4). Chrome built-in (Gemini Nano) is a
 * small local model, so it uses `plain` too.
 */
function promptVariantFor(backend: LLMBackendId): 'structured' | 'plain' {
  switch (backend) {
    case 'anthropic':
    case 'openai-compatible':
      return 'structured';
    case 'webllm':
    case 'chrome-ai':
      return 'plain';
  }
}

// ─── Empty / insufficient-data detection ─────────────────────────────────────

/**
 * Decide whether an insight input is too thin to narrate, BEFORE any context is
 * built or any provider is created (UX §5.5; Correctness, Core Principle 2). The
 * checks are intentionally cheap structural ones on the already-resolved app
 * data the caller passed in.
 *
 * @returns the empty reason, or `null` if there is enough to narrate.
 */
export function emptyReasonFor(input: InsightInput): EmptyEvent['reason'] | null {
  switch (input.kind) {
    case 'single-night':
    case 'clinical-context':
      // A single aggregate is always enough to summarize (the builders handle
      // null metrics gracefully). Nothing to short-circuit.
      return null;
    case 'date-range': {
      if (input.aggregates.length === 0) return 'no-data';
      // A trend summary needs at least a few nights; with fewer there is no
      // trend the pipeline could have computed.
      if (input.aggregates.length < MIN_NIGHTS_FOR_TREND || input.trends.length === 0) {
        return 'too-few-for-trend';
      }
      return null;
    }
    case 'explain': {
      const hasMetric = input.metric !== undefined;
      const hasChart = input.chart !== undefined && input.chart.points.length > 0;
      if (!hasMetric && !hasChart) return 'metric-unavailable';
      return null;
    }
  }
}

/** A trend summary needs at least this many nights to be meaningful (UX §7.7). */
const MIN_NIGHTS_FOR_TREND = 3;

// ─── Context building ────────────────────────────────────────────────────────

/** Build the grounded context for the supplied insight input. */
function buildContextFor(input: InsightInput): GroundedContext {
  switch (input.kind) {
    case 'single-night':
      return buildSingleNightContext(input);
    case 'date-range':
      return buildDateRangeContext(input);
    case 'explain':
      return buildExplainContext(input);
    case 'clinical-context':
      return buildClinicalContext(input);
  }
}

/**
 * Build the {@link ProviderConfig} for the active backend from the resolved run
 * config. Keys/worker factories are injected; this never reads a store.
 */
function providerConfigFor(backend: LLMBackendId, config: RunBackendConfig): ProviderConfig {
  switch (backend) {
    case 'webllm':
      return {
        backend: 'webllm',
        modelId: config.webllm.modelId,
        ...(config.webllm.createWorker ? { createWorker: config.webllm.createWorker } : {}),
      };
    case 'chrome-ai':
      return { backend: 'chrome-ai' };
    case 'anthropic':
      return {
        backend: 'anthropic',
        model: config.anthropic.model,
        getApiKey: config.getApiKey,
      };
    case 'openai-compatible':
      return {
        backend: 'openai-compatible',
        baseUrl: config.openaiCompatible.baseUrl,
        model: config.openaiCompatible.model,
        getApiKey: config.getApiKey,
      };
  }
}

// ─── Streaming a single generation pass ──────────────────────────────────────

/** The result of one provider generation pass (before validation/fallback). */
interface GenerationPass {
  /** The accumulated narrative text. */
  readonly text: string;
}

/**
 * Run one full provider generation, yielding `delta`/`progress` events and
 * returning the accumulated text. The async generator's `return` value is the
 * accumulated narrative; deltas are yielded as they arrive.
 *
 * The provider may throw an {@link LLMError} (e.g. `aborted`, `network-blocked`)
 * — the caller maps any non-LLMError to a classified `unknown` error.
 */
async function* streamGeneration(
  provider: LLMProvider,
  prompt: AssembledPrompt,
  signal: AbortSignal | undefined,
  onProgress: (progress: ModelLoadProgress) => void,
  context: GroundedContext,
): AsyncGenerator<DeltaEvent | ProgressEvent, GenerationPass, void> {
  let accumulated = '';
  const generateOptions = {
    context,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    onProgress,
    ...(signal ? { signal } : {}),
  };
  for await (const chunk of provider.generate(generateOptions)) {
    if (signal?.aborted) {
      throw new LLMError('aborted', 'Generation aborted.', {
        backend: provider.backend,
      });
    }
    if (chunk.text.length > 0) {
      accumulated += chunk.text;
      yield { type: 'delta', text: chunk.text, accumulated };
    }
  }
  return { text: accumulated };
}

/**
 * Append a strengthened regeneration reminder to the user prompt, naming the
 * offending tokens the validator rejected so the model avoids them on the retry
 * (design §5: "regenerate once with the offending tokens fed back").
 */
function strengthenPrompt(prompt: AssembledPrompt, validation: ValidationResult): AssembledPrompt {
  const offenders = Array.from(new Set(validation.violations.map((v) => v.offending)));
  const reminder = [
    '',
    'IMPORTANT — your previous answer was rejected by an automatic check. Do not repeat these problems:',
    ...validation.violations.map((v) => `- ${v.detail}`),
    offenders.length > 0
      ? `Specifically, do NOT use any of these tokens/phrases: ${offenders.map((o) => `"${o}"`).join(', ')}.`
      : '',
    'Use ONLY numbers that appear verbatim in the context, attach each to the unit the context gives it, never assert a severity/compliance verdict the context does not state, include the required reliability hedging, and never use diagnosis/therapy-change language.',
  ]
    .filter((line) => line !== '')
    .join('\n');
  return { systemPrompt: prompt.systemPrompt, userPrompt: `${prompt.userPrompt}\n${reminder}` };
}

// ─── The orchestration ───────────────────────────────────────────────────────

/**
 * Run an AI Insight end-to-end, yielding {@link InsightEvent}s. The terminal
 * event is exactly one of `complete`, `error`, `needs-consent`, or `empty`.
 *
 * The generator NEVER throws for an expected failure — provider/validation
 * problems are emitted as terminal `error` events so a single `for await` loop
 * in the hook handles every outcome. A truly unexpected throw (a bug) is allowed
 * to propagate.
 */
export async function* runInsight(req: RunInsightRequest): AsyncIterable<InsightEvent> {
  const { input, config, userBrief, signal } = req;

  // ── 0. Abort fast-path. ─────────────────────────────────────────────────────
  if (signal?.aborted) {
    yield {
      type: 'error',
      error: new LLMError('aborted', 'Generation aborted.', { backend: config.backend }),
    };
    return;
  }

  // ── 1. Resolve the active backend. ──────────────────────────────────────────
  if (!config.enabled || config.backend === null) {
    yield {
      type: 'error',
      error: new LLMError('missing-key', 'AI Insights is not configured.', {
        backend: config.backend,
        retryable: false,
      }),
    };
    return;
  }
  const backend = config.backend;

  // ── 2. Cloud egress gate (Privacy). NO context is built before this passes. ──
  if (backendRequiresConsent(config) && !hasFreshConsent(config)) {
    const stale = config.consentAt !== null;
    yield { type: 'needs-consent', backend, stale };
    return;
  }

  // ── 3. Empty short-circuit (Correctness). NO provider is created here. ──────
  const emptyReason = emptyReasonFor(input);
  if (emptyReason !== null) {
    // Build a context when one is warranted (so "show your work" can render
    // "No nights in this range"); for a totally empty range, skip the snapshot.
    const context = emptyReason === 'no-data' ? null : safeBuildContext(input);
    yield { type: 'empty', reason: emptyReason, context };
    return;
  }

  // ── 4. Build the grounded context (redaction guard runs inside the builder). ─
  yield { type: 'phase', phase: 'preparing' };
  let context: GroundedContext;
  try {
    context = buildContextFor(input);
  } catch (err) {
    yield {
      type: 'error',
      error:
        err instanceof LLMError
          ? err
          : new LLMError('unknown', 'Failed to assemble the grounded context.', {
              backend,
              retryable: false,
              cause: err,
            }),
    };
    return;
  }

  // ── 5. Assemble the prompt (variant by backend capability). ─────────────────
  const variant = promptVariantFor(backend);
  let prompt = buildPrompt(context, variant, userBrief !== undefined ? { userBrief } : {});

  // ── 6/7. Stream, validate, and (on failure) regenerate-once then fall back. ─
  const provider = createProvider(backend, providerConfigFor(backend, config));

  let loadAnnounced = false;
  const emitLoadPhase = (): PhaseEvent | null => {
    if (loadAnnounced) return null;
    loadAnnounced = true;
    return { type: 'phase', phase: 'loading' };
  };

  // The progress callback buffers into a queue drained between awaits; the
  // generator forwards them as `progress` events from streamGeneration.
  try {
    let attempt = 0;
    let lastText = '';
    let lastValidation: ValidationResult = { ok: true, violations: [] };
    // Up to two passes: the initial generation, then one strengthened retry.
    while (attempt < 2) {
      attempt += 1;
      let generatingAnnounced = false;
      const pendingProgress: ModelLoadProgress[] = [];
      const onProgress = (progress: ModelLoadProgress): void => {
        pendingProgress.push(progress);
      };

      const gen = streamGeneration(provider, prompt, signal, onProgress, context);
      let next = await gen.next();
      // Flush any progress the provider reported during the first await (model
      // load happens before the first token); announce the `loading` phase.
      while (!next.done) {
        if (pendingProgress.length > 0) {
          const loadPhase = emitLoadPhase();
          if (loadPhase) yield loadPhase;
          while (pendingProgress.length > 0) {
            const progress = pendingProgress.shift();
            if (progress) yield { type: 'progress', progress };
          }
        }
        const event = next.value;
        if (event.type === 'delta' && !generatingAnnounced) {
          generatingAnnounced = true;
          yield { type: 'phase', phase: 'generating' };
        }
        yield event;
        next = await gen.next();
      }
      // Drain trailing progress events (rare; load that completed with no token).
      while (pendingProgress.length > 0) {
        const progress = pendingProgress.shift();
        if (progress) yield { type: 'progress', progress };
      }

      lastText = next.value.text;
      lastValidation = validateNarrative(lastText, context);
      if (lastValidation.ok) {
        yield {
          type: 'complete',
          text: lastText,
          usedFallback: false,
          context,
          validation: lastValidation,
          backend,
        };
        return;
      }
      // Validation failed: strengthen the prompt with the offending tokens and
      // retry exactly once (attempt 2). On a second failure, fall through.
      if (attempt < 2) {
        prompt = strengthenPrompt(prompt, lastValidation);
      }
    }

    // ── Both passes failed validation → deterministic template fallback. ──────
    // The fallback is allow-list-safe by construction (it only restates computed
    // displayValues), so it passes validateNarrative; we never surface the
    // unvalidated model text.
    // The body is the clean template prose ONLY — no lead-in line. The
    // `usedFallback: true` flag on this event tells the drawer to render the
    // canonical notice (FALLBACK_NOTICE) above the summary, so the notice is
    // never mistaken for model output.
    const fallbackText = renderTemplateFallback(context);
    yield {
      type: 'complete',
      text: fallbackText,
      usedFallback: true,
      context,
      // The validation summary describes the rejected model output (why we fell
      // back), not the fallback text itself.
      validation: lastValidation,
      backend,
    };
    return;
  } catch (err) {
    if (signal?.aborted || (err instanceof LLMError && err.kind === 'aborted')) {
      yield {
        type: 'error',
        error:
          err instanceof LLMError
            ? err
            : new LLMError('aborted', 'Generation stopped.', { backend }),
      };
      return;
    }
    yield {
      type: 'error',
      error:
        err instanceof LLMError
          ? err
          : new LLMError('unknown', 'AI Insights generation failed.', {
              backend,
              cause: err,
            }),
    };
    return;
  }
}

/** Build a context but swallow a builder failure (used for the empty path). */
function safeBuildContext(input: InsightInput): GroundedContext | null {
  try {
    return buildContextFor(input);
  } catch {
    return null;
  }
}
