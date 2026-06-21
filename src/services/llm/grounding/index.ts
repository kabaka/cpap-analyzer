/**
 * Grounding layer — barrel export (design reference §4, §5).
 *
 * The narration-safety layer that sits between the grounded-context builders
 * ({@link file://src/services/llm/context}) and a provider: it assembles the
 * closed-world prompt, deterministically validates the model's output against the
 * snapshot's `numericAllowList`, and provides the non-generative template
 * fallback used when validation fails or no model is available.
 *
 * @module services/llm/grounding
 */

export * from './buildPrompt';
export * from './validateNarrative';
export * from './templateFallback';
