/**
 * Backend-agnostic `LLMProvider` contract for AI Insights (ADR 0024).
 *
 * Every backend — WebLLM (on-device, WebGPU), Chrome built-in AI (on-device),
 * Claude browser-direct (cloud, BYO key), and OpenAI-compatible (cloud or
 * loopback, BYO key + base URL) — implements this single interface, so the rest
 * of the app is agnostic to which one is active.
 *
 * This is a **first-party contract**, not a public plugin API (the runtime
 * plugin registry was abandoned — ADR 0024 §2, Phase 11). It can be refactored
 * freely; nothing outside `src/services/llm/` should depend on its exact shape.
 *
 * Design notes:
 * - **Streaming via async iterable.** {@link LLMProvider.generate} returns an
 *   `AsyncIterable<StreamChunk>`. Async iteration was chosen over a
 *   callback/`EventEmitter` style because it composes with `for await`, supports
 *   natural back-pressure, and maps cleanly onto both the cloud SDKs' streaming
 *   responses and WebLLM's chunked generator. Cancellation is via an
 *   `AbortSignal` passed in the request (the same primitive `fetch` uses), so a
 *   "Stop" button aborts uniformly across backends.
 * - **Grounding is enforced upstream.** The provider receives an
 *   already-built {@link GroundedContext} (and an app-assembled system prompt);
 *   it never computes a clinical value. The post-generation numeral validator
 *   (design reference §5) runs on the provider's output, outside this contract.
 * - **No SDK imports here.** Provider SDKs are added later and dynamically
 *   imported by each backend implementation; this types module stays dependency-
 *   free so it compiles standalone.
 *
 * @module services/llm/types
 */

import type { LLMBackendId } from '@/types/settings';
import type { GroundedContext } from './context/types';

// ─── Capability / availability ──────────────────────────────────────────────

/**
 * Egress class of a backend instance.
 *
 * Note `openai-compatible` is `none` for a loopback base URL and `cloud` for a
 * remote one, so egress class is an instance property, not fixed per backend id.
 */
export type EgressClass = 'none' | 'cloud';

/** Whether this backend, as configured, requires the two-gate cloud consent. */
export type ConsentRequirement = 'none' | 'cloud-egress';

/** Static descriptor of what a configured backend instance can do. */
export interface BackendCapabilities {
  readonly backend: LLMBackendId;
  /** Whether anything leaves the device for a generation request. */
  readonly egress: EgressClass;
  /** Whether a generation requires prior cloud-egress consent. */
  readonly consent: ConsentRequirement;
  /** Whether the backend streams tokens (all current backends do). */
  readonly streaming: boolean;
}

/** Coarse availability state of a backend in the current environment. */
export type BackendAvailabilityState =
  /** Ready to generate now. */
  | 'available'
  /** Supported, but a one-time on-device model download/provision is needed. */
  | 'needs-download'
  /** Supported, but missing configuration (API key, base URL, model choice). */
  | 'needs-config'
  /** Not usable in this environment (no WebGPU, browser lacks the API, etc.). */
  | 'unsupported';

/**
 * Result of {@link LLMProvider.checkAvailability}. The `reason` is an
 * app-authored, user-presentable phrase; raw SDK/API error strings must not
 * appear here (UX §3.4–§3.7, §6).
 */
export interface BackendAvailability {
  readonly state: BackendAvailabilityState;
  /**
   * Plain-language reason, e.g. "WebGPU isn't supported in this browser",
   * "Model not downloaded (~1.9 GB)", "Add your Claude API key". `null` when
   * `state === 'available'`.
   */
  readonly reason: string | null;
}

// ─── Request / response / streaming ─────────────────────────────────────────

/** Options for a single generation request. */
export interface GenerateOptions {
  /**
   * The frozen, already-computed snapshot to narrate. This is the ONLY data the
   * model sees and (for cloud backends) the ONLY thing that egresses.
   */
  readonly context: GroundedContext;
  /**
   * The app-assembled, guardrailed system prompt (closed-world numerics,
   * no-diagnosis, mandatory hedging — design reference §4). Provided by the
   * prompt-assembler wave; the provider passes it through unchanged.
   */
  readonly systemPrompt: string;
  /**
   * The user-facing narration brief / chosen chip, e.g.
   * "Summarize this night in plain language" (UX §7.6).
   */
  readonly userPrompt: string;
  /**
   * Cancellation signal. Aborting rejects/ends the stream with an
   * {@link LLMError} of kind `aborted`. A "Stop" button wires here.
   */
  readonly signal?: AbortSignal;
  /**
   * Optional cap on generated tokens. Backends that cannot honour it may ignore
   * it; it is advisory, not a correctness control.
   */
  readonly maxOutputTokens?: number;
  /**
   * Optional coarse progress callback for on-device backends (WebLLM) that must
   * perform a one-time, multi-hundred-MB model-weights download/warm-up before
   * the first generation. Cloud and already-provisioned backends never invoke
   * it. Added minimally for the provider wave (ADR 0024 provider layer): the
   * stream's {@link StreamChunk}s carry only generated narration, so a
   * download/warm-up phase that precedes any token has no other channel to
   * report through. The callback is best-effort and may be omitted by the
   * caller; providers must not depend on it being present.
   */
  readonly onProgress?: (progress: ModelLoadProgress) => void;
}

/**
 * Coarse progress for a one-time on-device model load (download + warm-up),
 * surfaced via {@link GenerateOptions.onProgress}. Phases are deliberately
 * minimal — the UX (design reference §3.4) announces coarse milestones, not
 * every frame.
 */
export interface ModelLoadProgress {
  /** Which phase of the one-time provision this update describes. */
  readonly phase: 'downloading' | 'loading';
  /** Fractional completion in `[0, 1]`, or `null` when not determinable. */
  readonly fraction: number | null;
  /** App-presentable status text (e.g. "Downloading model… 42%"). */
  readonly text: string;
}

/** One streamed chunk of generated output. */
export interface StreamChunk {
  /** The incremental text delta for this chunk. */
  readonly text: string;
  /**
   * True on the final chunk. After a `done` chunk the iterable completes; no
   * further chunks follow.
   */
  readonly done: boolean;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/**
 * The discriminated `kind` of an {@link LLMError}.
 *
 * Maps 1:1 onto the UX error taxonomy (design reference §6) so the UI can branch
 * on `kind` to pick the right plain-language message and recovery action.
 */
export type LLMErrorKind =
  /** Cloud backend selected but no API key is configured. */
  | 'missing-key'
  /** Provider rejected the key (401/403). */
  | 'invalid-key'
  /** Network failure or the request was blocked by `connect-src` CSP. */
  | 'network-blocked'
  /** WebLLM selected but WebGPU is unavailable. */
  | 'webgpu-unsupported'
  /** WebLLM model weights not downloaded / Chrome model not provisioned. */
  | 'model-not-downloaded'
  /** On-device model failed to load (e.g. OOM). */
  | 'model-load-failed'
  /** Provider rate-limited the request (429). */
  | 'rate-limited'
  /** The model refused or returned a safety/policy refusal. */
  | 'refusal'
  /** Post-generation validation failed (fabricated numeral, banned phrase, etc.). */
  | 'validation-failed'
  /** The request was aborted (user "Stop", or timeout). */
  | 'aborted'
  /** Anything not otherwise classified; carries the raw message for logs only. */
  | 'unknown';

/**
 * A classified, backend-agnostic error. `kind` drives the UI; `cause` is kept
 * for console logging only and must never be rendered to the user (UX §5.4).
 */
export class LLMError extends Error {
  readonly kind: LLMErrorKind;
  readonly backend: LLMBackendId | null;
  /** True if a `retry`/`regenerate` may plausibly succeed (network, rate-limit, etc.). */
  readonly retryable: boolean;
  /** Underlying cause, for console logging only — never rendered to the user. */
  readonly cause?: unknown;

  constructor(
    kind: LLMErrorKind,
    message: string,
    options?: { backend?: LLMBackendId | null; retryable?: boolean; cause?: unknown },
  ) {
    super(message);
    this.name = 'LLMError';
    this.kind = kind;
    this.backend = options?.backend ?? null;
    this.retryable = options?.retryable ?? RETRYABLE_KINDS.has(kind);
    // Assigned manually (not via the ES2022 `Error(message, { cause })` option)
    // because the app's tsconfig targets ES2020, whose Error type is single-arg.
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/** Error kinds for which an automatic or user-initiated retry is sensible. */
const RETRYABLE_KINDS: ReadonlySet<LLMErrorKind> = new Set<LLMErrorKind>([
  'network-blocked',
  'rate-limited',
  'validation-failed',
  'unknown',
]);

// ─── The provider contract ──────────────────────────────────────────────────

/**
 * The single contract every AI-Insights backend implements.
 *
 * Implementations are constructed with their resolved config + (for cloud) the
 * session API key injected from {@link file://src/stores/useLLMCredentialStore.ts};
 * a provider instance never reads persisted settings or storage directly
 * (dependency injection, for testability).
 */
export interface LLMProvider {
  /** Which backend this instance is. */
  readonly backend: LLMBackendId;

  /** Static capability descriptor for this configured instance. */
  capabilities(): BackendCapabilities;

  /**
   * Detect whether this backend can generate in the current environment and
   * configuration. Must NOT egress (no silent key-validation calls — UX §3.6,
   * §9.6); availability is determined by feature detection and local config only.
   */
  checkAvailability(): Promise<BackendAvailability>;

  /**
   * Stream a grounded narration. Yields {@link StreamChunk}s until a `done`
   * chunk, then completes. On failure throws / rejects with an {@link LLMError}.
   * Cancellation is via `options.signal`.
   */
  generate(options: GenerateOptions): AsyncIterable<StreamChunk>;

  /**
   * OPTIONAL — proactively download + cache this backend's model weights without
   * running a generation, then release any GPU/VRAM held (the weights stay
   * cached). Only on-device backends that have a one-time weights download
   * implement it (currently WebLLM); call sites MUST guard on its presence.
   *
   * It powers the Settings "Download model" affordance and the Stop-during-
   * download fix: the `signal` is honoured *during the weights download*, so
   * aborting it actually stops the in-flight fetch. On abort it rejects with an
   * {@link LLMError} of kind `aborted`. Progress is reported via `onProgress`,
   * the same {@link ModelLoadProgress} channel `generate` uses for its load.
   */
  prefetch?(options: PrefetchOptions): Promise<void>;
}

/** Options for {@link LLMProvider.prefetch}. */
export interface PrefetchOptions {
  /**
   * Cancellation signal. Aborting terminates the in-flight weights download and
   * rejects with an {@link LLMError} of kind `aborted` (a "Cancel" button wires
   * here).
   */
  readonly signal?: AbortSignal;
  /**
   * Optional coarse progress callback — the same {@link ModelLoadProgress}
   * channel `generate` uses. Best-effort; the provider must not depend on it.
   */
  readonly onProgress?: (progress: ModelLoadProgress) => void;
}
