/**
 * Backend factory for AI Insights providers (ADR 0024 §3).
 *
 * `createProvider(backend, config)` selects the concrete {@link LLMProvider}
 * implementation for a backend id. The rest of the app stays backend-agnostic:
 * it asks the factory for a provider and talks to the {@link LLMProvider}
 * contract only.
 *
 * Importing this factory is cheap. The provider classes themselves carry no
 * heavy dependencies at import time — each backend's SDK / engine
 * (`@anthropic-ai/sdk`, `@mlc-ai/web-llm`, the WebLLM worker) is **dynamically
 * imported inside the provider's methods**, so it lands in a separate async
 * chunk and never enters the main bundle.
 *
 * Configs hold injected accessors (API-key readers, feature-detection hooks)
 * rather than persisted settings — the caller wires the session credential
 * store ({@link file://src/stores/useLLMCredentialStore.ts}) and settings into
 * the appropriate config; a provider never reads persisted state directly.
 *
 * @module services/llm/providers/createProvider
 */

import type { LLMBackendId } from '@/types/settings';

import type { LLMProvider } from '../types';

import { AnthropicProvider } from './anthropicProvider';
import type { AnthropicProviderConfig } from './anthropicProvider';
import { ChromeAIProvider } from './chromeAiProvider';
import type { ChromeAIProviderConfig } from './chromeAiProvider';
import { OpenAICompatibleProvider } from './openaiCompatibleProvider';
import type { OpenAICompatibleProviderConfig } from './openaiCompatibleProvider';
import { WebLLMProvider } from './webllmProvider';
import type { WebLLMProviderConfig } from './webllmProvider';

/**
 * Discriminated config union — the shape required to construct each backend.
 * The discriminant matches the {@link LLMBackendId} so the factory is
 * exhaustively type-checked.
 */
export type ProviderConfig =
  | ({ readonly backend: 'webllm' } & WebLLMProviderConfig)
  | ({ readonly backend: 'chrome-ai' } & ChromeAIProviderConfig)
  | ({ readonly backend: 'anthropic' } & AnthropicProviderConfig)
  | ({ readonly backend: 'openai-compatible' } & OpenAICompatibleProviderConfig);

/**
 * Construct the provider for a backend id.
 *
 * `config.backend` must match `backend`; the union ensures the config carries
 * exactly the fields that backend needs.
 *
 * @throws never — selection is total over {@link LLMBackendId}.
 */
export function createProvider(backend: LLMBackendId, config: ProviderConfig): LLMProvider {
  if (config.backend !== backend) {
    // Programmer error: mismatched discriminant. Surfacing it loudly beats a
    // silently wrong backend.
    throw new Error(
      `createProvider: config.backend "${config.backend}" does not match requested backend "${backend}"`,
    );
  }

  switch (config.backend) {
    case 'webllm':
      return new WebLLMProvider(config);
    case 'chrome-ai':
      return new ChromeAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai-compatible':
      return new OpenAICompatibleProvider(config);
    default: {
      // Exhaustiveness guard — a new backend id must extend the union above.
      const exhaustive: never = config;
      return exhaustive;
    }
  }
}
