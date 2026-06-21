/**
 * Grounded-context builders + redaction guard — barrel export.
 *
 * The compute-then-narrate data layer for AI Insights (design reference
 * `docs/design/ai-insights-grounded-context.md`). Re-exports the shared snapshot
 * types, the per-insight builders, and the egress redaction guard. The snapshot
 * built here is the ONLY object that may be handed to a provider / leave the
 * browser; the redaction guard enforces that contract mechanically.
 *
 * @module services/llm/context
 */

export * from './types';
export * from './redaction';
export * from './buildGroundedContext';
