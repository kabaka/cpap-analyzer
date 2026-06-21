/**
 * AI Insights provider layer — barrel export (ADR 0024 §3).
 *
 * The four interchangeable {@link LLMProvider} backends plus the
 * {@link createProvider} factory. Importing this barrel is cheap: each backend's
 * heavy SDK / engine is dynamically imported inside the provider's methods, so
 * it never enters the main bundle.
 *
 * @module services/llm/providers
 */

export { createProvider } from './createProvider';
export type { ProviderConfig } from './createProvider';

export { AnthropicProvider } from './anthropicProvider';
export type { AnthropicProviderConfig } from './anthropicProvider';

export { OpenAICompatibleProvider } from './openaiCompatibleProvider';
export type { OpenAICompatibleProviderConfig } from './openaiCompatibleProvider';

export { WebLLMProvider } from './webllmProvider';
export type { WebLLMProviderConfig } from './webllmProvider';

export { ChromeAIProvider } from './chromeAiProvider';
export type { ChromeAIProviderConfig } from './chromeAiProvider';
