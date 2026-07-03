/**
 * Static backend + model metadata for the AI Insights settings panel.
 *
 * This module is pure data + small pure helpers (no React, no I/O) so it can be
 * unit-tested in isolation and imported cheaply. It owns:
 *
 * - the privacy-first ordering and per-backend descriptive copy for the radio
 *   group (UX §3.3),
 * - the curated WebLLM model list with disclosed on-disk download sizes
 *   (UX §3.4 — a small set of MLC prebuilt small models),
 * - the Claude model list with the cost/speed note (UX §3.6 / §7.5),
 * - the loopback detection used to decide whether the OpenAI-compatible backend
 *   needs cloud consent (UX §3.7).
 *
 * @module views/Settings/ai/backends
 */

import type { LLMAnthropicModel, LLMBackendId } from '@/types/settings';

/** A backend's privacy posture, used to pick the green/blue badge + divider. */
export type BackendEgress = 'local' | 'cloud';

/** Static, display-time descriptor for one of the four backends (UX §3.3). */
export interface BackendOption {
  readonly id: LLMBackendId;
  /** Human label shown as the radio option title. */
  readonly label: string;
  /** One-line description under the label. */
  readonly description: string;
  /**
   * Whether this backend egresses *as configured by default*. `openai-compatible`
   * is listed as `cloud` here (its consent requirement is re-derived at runtime
   * from the base URL — a loopback URL downgrades it to local); see
   * {@link isLoopbackUrl}.
   */
  readonly egress: BackendEgress;
}

/**
 * The two on-device backends (UX §3.3, group "Stays on your device"). These are
 * the default group; cloud is never auto-selected.
 */
export const LOCAL_BACKENDS: readonly BackendOption[] = [
  {
    id: 'webllm',
    label: 'In-browser (WebLLM)',
    description: 'Runs a small model on your GPU via WebGPU. Nothing leaves your device.',
    egress: 'local',
  },
  {
    id: 'chrome-ai',
    label: 'Chrome built-in AI',
    description: "Uses Chrome's on-device model when available. Nothing leaves your device.",
    egress: 'local',
  },
];

/**
 * The two cloud backends (UX §3.3, group "Sends a metric snapshot online").
 * Cloud is always an explicit, consent-gated user choice.
 */
export const CLOUD_BACKENDS: readonly BackendOption[] = [
  {
    id: 'anthropic',
    label: 'Claude (your API key)',
    description: 'Higher-quality wording via Anthropic, using your own API key.',
    egress: 'cloud',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible / Ollama (your key + URL)',
    description: 'Any OpenAI-style endpoint. A localhost URL (Ollama) keeps data on-device.',
    egress: 'cloud',
  },
];

/** All four backends, privacy-first order. */
export const ALL_BACKENDS: readonly BackendOption[] = [...LOCAL_BACKENDS, ...CLOUD_BACKENDS];

/** Look up a backend descriptor by id. */
export function backendById(id: LLMBackendId): BackendOption {
  const found = ALL_BACKENDS.find((b) => b.id === id);
  // ALL_BACKENDS is exhaustive over LLMBackendId, so this is always defined.
  if (!found) throw new Error(`Unknown backend id: ${String(id)}`);
  return found;
}

// ─── Curated WebLLM model list (UX §3.4) ────────────────────────────────────

/** A curated WebLLM prebuilt model, with its disclosed on-disk size. */
export interface WebLLMModelOption {
  /** MLC model id (matches `@mlc-ai/web-llm` prebuilt config). */
  readonly id: string;
  /** Display name. */
  readonly label: string;
  /** Approximate on-disk download size (human string, UX §3.4). */
  readonly sizeLabel: string;
  /** One-line "best for / speed vs quality" note. */
  readonly note: string;
}

/**
 * A small curated set of WebLLM prebuilt **small** models (q4f16), chosen to keep
 * the on-disk footprint modest while still producing readable prose. Sizes are
 * approximate compressed weights as cached by WebLLM; the exact figure is also
 * disclosed inline before any download (UX §3.4). Final tuning is shared with
 * `performance`; these ids match the MLC prebuilt config.
 */
export const WEBLLM_MODELS: readonly WebLLMModelOption[] = [
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B Instruct (q4f16)',
    sizeLabel: '~0.9 GB',
    note: 'Smallest & fastest — lighter prose.',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 1.5B Instruct (q4f16)',
    sizeLabel: '~1.1 GB',
    note: 'Small & fast — good balance for short summaries.',
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 3B Instruct (q4f16)',
    sizeLabel: '~1.9 GB',
    note: 'Balanced — richer prose, still on-device.',
  },
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 3B Instruct (q4f16)',
    sizeLabel: '~2.0 GB',
    note: 'Highest quality of this set — slowest.',
  },
];

/** Default suggested WebLLM model: the 3B balance point. */
export const DEFAULT_WEBLLM_MODEL_ID = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

/** Look up a curated WebLLM model by id (or `null` if not curated / unset). */
export function webllmModelById(id: string | null): WebLLMModelOption | null {
  if (id === null) return null;
  return WEBLLM_MODELS.find((m) => m.id === id) ?? null;
}

// ─── Claude (Anthropic) models (UX §3.6) ────────────────────────────────────

/** A Claude model option with its cost/speed positioning (UX §3.6 / §7.5). */
export interface AnthropicModelOption {
  readonly id: LLMAnthropicModel;
  readonly label: string;
  /** Short positioning note (no fabricated dollar figures — UX §3.6). */
  readonly note: string;
}

/**
 * The exactly-three allowed Claude models (UX §3.6). The persisted default is
 * `claude-opus-4-8` (per the settings shape); the UI surfaces Sonnet as the
 * *recommended balance* in its note, but never silently changes the stored
 * default.
 */
export const ANTHROPIC_MODELS: readonly AnthropicModelOption[] = [
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    note: 'Highest quality, slowest, highest cost per request.',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    note: 'Balanced quality and cost — a good default.',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    note: 'Fastest and cheapest per request.',
  },
];

// ─── Loopback detection for OpenAI-compatible consent gating (UX §3.7) ───────

/**
 * Whether a base URL points at a loopback / on-device endpoint and therefore
 * needs **no** cloud consent (UX §3.7): `localhost`, `127.0.0.0/8`, `[::1]`, or
 * a `*.local` host. Anything else (including an empty/invalid URL, which we
 * treat as not-yet-loopback) is cloud.
 *
 * Note: the security-audited allowlist is the source of truth for what
 * `connect-src` permits; this helper only governs the consent prompt. A URL we
 * cannot parse is treated as non-loopback (fail safe → consent required).
 */
export function isLoopbackUrl(rawUrl: string | null): boolean {
  if (rawUrl === null) return false;
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) return false;

  let host: string;
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch {
    return false;
  }

  // Strip IPv6 brackets if a consumer passed a bare bracketed host.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  if (bare === 'localhost' || bare === '::1') return true;
  if (bare.endsWith('.local') || bare.endsWith('.localhost')) return true;
  // 127.0.0.0/8 loopback range.
  if (/^127(?:\.\d{1,3}){3}$/.test(bare)) return true;

  return false;
}

/**
 * Whether the OpenAI-compatible backend, configured with `baseUrl`, requires the
 * cloud-egress consent gate. A loopback URL does not; everything else does.
 */
export function openAICompatibleNeedsConsent(baseUrl: string | null): boolean {
  return !isLoopbackUrl(baseUrl);
}

/**
 * Whether a backend, as currently configured, egresses and therefore needs the
 * two-gate cloud consent before use.
 *
 * - `webllm`, `chrome-ai` → never (local).
 * - `anthropic` → always (cloud).
 * - `openai-compatible` → only when the base URL is non-loopback.
 */
export function backendNeedsConsent(
  backend: LLMBackendId | null,
  openAiBaseUrl: string | null,
): boolean {
  switch (backend) {
    case 'anthropic':
      return true;
    case 'openai-compatible':
      return openAICompatibleNeedsConsent(openAiBaseUrl);
    case 'webllm':
    case 'chrome-ai':
    case null:
      return false;
    default: {
      const exhaustive: never = backend;
      return exhaustive;
    }
  }
}
