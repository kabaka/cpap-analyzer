/**
 * Suggested-question chips for the idle Insight drawer (UX §7.6).
 *
 * Safe-by-construction: each chip scopes a request to something the analysis
 * pipeline already answers — descriptive prompts, never diagnostic questions.
 * The chip's `brief` is passed as the `userBrief` to `run(input, brief)`; the
 * orchestrator narrates the SAME grounded context regardless of brief, so a
 * chip can only re-frame, never widen, what the model sees.
 *
 * Which chips apply depends on the insight kind (a single-night view cannot
 * offer a "trend over this range" chip), so chips are filtered by kind.
 *
 * @module components/insights/chips
 */

import type { InsightInput } from '@/services/llm/runInsight';

/** A single suggested chip. */
export interface SuggestedChip {
  /** Stable id (for React keys / tests). */
  readonly id: string;
  /** The visible label (also the screen-reader signal). */
  readonly label: string;
  /** The narration brief handed to `run(input, brief)`. */
  readonly brief: string;
}

/** Chips that make sense for a single night (UX §7.6 items 1, 3, 6). */
const SINGLE_NIGHT_CHIPS: readonly SuggestedChip[] = [
  {
    id: 'summarize-night',
    label: 'Summarize this night in plain language',
    brief: 'Summarize this night in plain language.',
  },
  {
    id: 'explain-leak',
    label: 'Explain my leak numbers',
    brief: 'Explain the leak numbers for this night.',
  },
  {
    id: 'prepare-clinician',
    label: 'Help me prepare what to ask my clinician',
    brief:
      'Organize the visible metrics into neutral discussion points to prepare for a clinician conversation. Do not give advice.',
  },
];

/** Chips that make sense for a date range / trend (UX §7.6 items 2, 4, 5, 6). */
const DATE_RANGE_CHIPS: readonly SuggestedChip[] = [
  {
    id: 'ahi-trend',
    label: 'How did my AHI trend over this range?',
    brief: 'Describe how AHI trended over this range using the computed trend.',
  },
  {
    id: 'what-changed',
    label: 'What changed compared to the previous period?',
    brief: 'Summarize what changed over this range based on the computed trends.',
  },
  {
    id: 'usage-consistency',
    label: 'Summarize my usage and consistency',
    brief: 'Summarize usage and consistency over this range.',
  },
  {
    id: 'prepare-clinician',
    label: 'Help me prepare what to ask my clinician',
    brief:
      'Organize the visible metrics and trends into neutral discussion points to prepare for a clinician conversation. Do not give advice.',
  },
];

/** Chips for the "explain a metric/chart" insight (UX §7.6 items 3, 6). */
const EXPLAIN_CHIPS: readonly SuggestedChip[] = [
  {
    id: 'explain-this',
    label: 'Explain this in plain language',
    brief: 'Explain the metric or chart shown in plain language.',
  },
  {
    id: 'prepare-clinician',
    label: 'Help me prepare what to ask my clinician',
    brief:
      'Organize this metric into neutral discussion points to prepare for a clinician conversation. Do not give advice.',
  },
];

/** Chips for the clinical-context insight (UX §7.6 items 1, 6). */
const CLINICAL_CHIPS: readonly SuggestedChip[] = [
  {
    id: 'summarize-context',
    label: 'Summarize this night in plain language',
    brief: 'Summarize this night against the active severity bands and adherence floor.',
  },
  {
    id: 'prepare-clinician',
    label: 'Help me prepare what to ask my clinician',
    brief:
      'Organize the visible metrics into neutral discussion points to prepare for a clinician conversation. Do not give advice.',
  },
];

/** Resolve the suggested chips for the active insight kind. */
export function chipsForInsight(input: InsightInput): readonly SuggestedChip[] {
  switch (input.kind) {
    case 'single-night':
      return SINGLE_NIGHT_CHIPS;
    case 'date-range':
      return DATE_RANGE_CHIPS;
    case 'explain':
      return EXPLAIN_CHIPS;
    case 'clinical-context':
      return CLINICAL_CHIPS;
  }
}
