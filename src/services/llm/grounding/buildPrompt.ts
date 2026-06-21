/**
 * Prompt assembly for grounded AI-Insights narration (design reference §4).
 *
 * Builds the system + user prompt for each insight type, implementing the
 * closed-world invariants: the model may reference only values that appear
 * literally in the provided `context`; it must never compute, derive, or round a
 * number; it must honour each metric's `availability`; it must hedge whenever a
 * reliability tier is non-high or a data-quality flag is present; it must use the
 * thresholds in `context.clinical` (not its own training-data cutoffs); and it
 * must never diagnose (wellness framing only).
 *
 * Two output variants are provided:
 * - {@link buildStructuredPrompt} — for capable cloud backends, instructing the
 *   model to return a typed object `{ narrative, citedMetricIds, citedNumbers }`
 *   so the validator can compare `citedNumbers ⊆ numericAllowList` directly.
 * - {@link buildPlainPrompt} — for small / local models that do not honour
 *   JSON-mode; asks for prose only and relies on the deterministic numeral
 *   validator on the raw narrative.
 *
 * Structured output is a *convenience*, not the safety mechanism — the
 * closed-world system prompt plus the post-generation validator are the guard
 * (design §4 close).
 *
 * Pure and deterministic. No I/O.
 *
 * @module services/llm/grounding/buildPrompt
 */

import type { GroundedContext, InsightType } from '../context/types';

/** The assembled prompt pair handed to a provider via `GenerateOptions`. */
export interface AssembledPrompt {
  /** The guardrailed system prompt (closed-world, no-diagnosis, hedging). */
  readonly systemPrompt: string;
  /** The user-facing narration brief for the chosen insight. */
  readonly userPrompt: string;
}

/** Options for prompt assembly. */
export interface BuildPromptOptions {
  /**
   * The user's chosen narration chip / brief, e.g. "Summarize this night in
   * plain language". When omitted, a per-insight default brief is used.
   */
  readonly userBrief?: string;
}

// ─── Shared closed-world invariants (design §4) ─────────────────────────────

const CLOSED_WORLD_RULES = [
  'CLOSED-WORLD NUMBERS: You may reference only values that appear literally in the provided context object. Never compute, sum, average, ratio, convert, or round any number. If a figure you want is not in the context, do not state one — say the information is not available.',
  'QUOTE, DO NOT RECOMPUTE: When you mention a metric, quote its displayValue and unit exactly as given. Do not change its precision or its unit.',
  "HONOUR AVAILABILITY: If a metric's availability is 'undefined-rate', describe it as 'the recording was too short to compute a reliable per-hour rate' — never as zero or low. If 'unavailable', say the data was not recorded. Never read displayValue when availability is not 'present'.",
  "MANDATORY HEDGING: If a metric's reliabilityTier is 'moderate' or 'low', or it has any dataQualityFlags, you must surface its caveat and phrase the figure as an estimate, not a fact. A low-reliability metric may be mentioned but never used to assert a conclusion.",
  'USE THE PROVIDED THRESHOLDS: Use only the AHI thresholds and the compliance definition in context.clinical. Never use a cutoff from your own knowledge — the user may have configured custom thresholds.',
  'NO DIAGNOSIS: Describe and explain; never diagnose, never imply a diagnosis, never recommend changing therapy settings, and never contradict the user\'s clinician. Where the context carries a "discuss with your clinician" flag, surface it. Use wellness framing, not clinical-verdict framing.',
  "TRENDS CARRY THEIR QUALIFIER: Never state a trend's direction without its qualifier (strength + significance). A negligible or non-significant trend must be described as 'no clear trend'.",
] as const;

const ROLE_PREAMBLE =
  'You are a careful explainer of already-computed CPAP therapy summaries. The application has performed every calculation; your job is only to phrase and explain the provided figures in clear, plain language for a patient. You are not a clinician and you do not diagnose.';

/** Per-insight narration brief (the default user prompt). */
function defaultBrief(insightType: InsightType): string {
  switch (insightType) {
    case 'single-night':
      return 'Summarize this night of CPAP therapy in plain language, mentioning the most relevant provided metrics with their reliability caveats.';
    case 'date-range':
      return 'Summarize how therapy has tracked across this date range, describing only the provided trends with their statistical qualifiers.';
    case 'explain':
      return 'Explain what this view shows and how to read it, using only the provided figures. Do not evaluate the patient.';
    case 'clinical-context':
      return 'Explain where the provided value sits relative to the configured reference thresholds, using wellness framing and surfacing any clinician-discussion flag.';
  }
}

function rulesBlock(): string {
  return CLOSED_WORLD_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n');
}

function contextBlock(context: GroundedContext): string {
  return `Here is the grounded context (the ONLY data you may reference):\n\n${JSON.stringify(
    context,
    null,
    2,
  )}`;
}

// ─── Structured-output variant (capable cloud backends) ─────────────────────

/**
 * Build a structured-output prompt. Instructs the model to return a single JSON
 * object `{ narrative: string, citedMetricIds: string[], citedNumbers:
 * string[] }`. The declared `citedNumbers` channel makes validation a direct
 * subset check (`citedNumbers ⊆ context.numericAllowList`); the prose lives in
 * `narrative`. The closed-world rules remain the primary guard.
 */
export function buildStructuredPrompt(
  context: GroundedContext,
  options: BuildPromptOptions = {},
): AssembledPrompt {
  const systemPrompt = [
    ROLE_PREAMBLE,
    '',
    'You MUST follow every rule below without exception:',
    rulesBlock(),
    '',
    'OUTPUT FORMAT: Return exactly one JSON object and nothing else, with this shape:',
    '{',
    '  "narrative": string,        // the plain-language explanation',
    '  "citedMetricIds": string[], // the context metric ids you referred to',
    '  "citedNumbers": string[]    // every numeric token you used, copied verbatim from the context',
    '}',
    'Every entry in citedNumbers MUST be copied character-for-character from context.numericAllowList. Do not invent, reformat, or re-round any number.',
  ].join('\n');

  const userPrompt = [
    options.userBrief ?? defaultBrief(context.insightType),
    '',
    contextBlock(context),
  ].join('\n');

  return { systemPrompt, userPrompt };
}

// ─── Plain variant (small / local models) ───────────────────────────────────

/**
 * Build a plain prose prompt for small / local models that do not honour
 * JSON-mode. Asks for prose only; the deterministic numeral validator runs on
 * the raw narrative instead of a declared-citations channel. The system prompt's
 * closed-world rules are identical — only the output-shape requirement is
 * dropped.
 */
export function buildPlainPrompt(
  context: GroundedContext,
  options: BuildPromptOptions = {},
): AssembledPrompt {
  const systemPrompt = [
    ROLE_PREAMBLE,
    '',
    'You MUST follow every rule below without exception:',
    rulesBlock(),
    '',
    'OUTPUT FORMAT: Reply with a short plain-language explanation only — no JSON, no headings, no lists of raw numbers. Use only numbers that appear in the context exactly as written.',
  ].join('\n');

  const userPrompt = [
    options.userBrief ?? defaultBrief(context.insightType),
    '',
    contextBlock(context),
  ].join('\n');

  return { systemPrompt, userPrompt };
}

/**
 * Select the prompt variant by backend capability. `structured` is preferred for
 * capable cloud backends; `plain` for small/local models (design §4).
 */
export function buildPrompt(
  context: GroundedContext,
  variant: 'structured' | 'plain',
  options: BuildPromptOptions = {},
): AssembledPrompt {
  return variant === 'structured'
    ? buildStructuredPrompt(context, options)
    : buildPlainPrompt(context, options);
}
