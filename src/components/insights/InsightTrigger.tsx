/**
 * `InsightTrigger` — the reusable "✨ Explain" / "✨ Summarize" affordance that
 * opens the {@link InsightDrawer} for a specific {@link InsightRequest}
 * (UX §4.1, §4.2; visual spec §1.2 `action`).
 *
 * Two hard requirements from the UX spec:
 *
 *  1. **Opt-in, out of the way.** When AI Insights is disabled in settings
 *     (`integrations.llm.enabled === false`), this renders **nothing at all** —
 *     no greyed-out tease, no tooltip, no upsell (UX §2.2, §9.1; Apple HIG
 *     off-switch). Discovery happens only via Settings. Because the trigger is
 *     absent, none of the affordances it gates appear either.
 *  2. **Reserved AI marker.** Its content is the {@link AiMarker} `action`
 *     variant — the ✨ sparkle + literal verb ("Explain" / "Summarize") that
 *     discloses this opens generated content — never reused on deterministic
 *     `(?)` glossary help (visual spec §1.4). The ✨ glyph is `aria-hidden`; the
 *     verb text carries the signal (WCAG 1.4.1).
 *
 * The trigger is store-aware only for the enabled flag; the caller supplies the
 * already-built {@link InsightRequest} lazily (via `buildRequest`), so the
 * potentially non-trivial input is assembled only on click, not on every render
 * of a view full of triggers.
 *
 * @module components/insights/InsightTrigger
 */

import { useCallback } from 'react';

import { AiMarker } from '@/components/ai';
import { useSettingsStore } from '@/stores/useSettingsStore';

import type { InsightRequest } from './useInsightDrawerStore';
import { useInsightDrawerStore } from './useInsightDrawerStore';
import styles from './InsightTrigger.module.css';

export interface InsightTriggerProps {
  /**
   * The label verb shown after the ✨ glyph, e.g. "Summarize range",
   * "Summarize this night", "Explain". Always rendered as text (color is never
   * the sole signal).
   */
  readonly label: string;
  /**
   * Builds the {@link InsightRequest} to open. Called lazily on activation so a
   * view rendering many triggers does not assemble every input up front.
   */
  readonly buildRequest: () => InsightRequest;
  /**
   * A descriptive accessible label for the button (UX §4.2), e.g.
   * "Explain my AHI for the selected range". Falls back to `label`.
   */
  readonly ariaLabel?: string;
  /**
   * `default` (a bordered button) or `subtle` (chrome-light, for co-located
   * "Explain" affordances inside a card's secondary area — UX §4.2).
   */
  readonly appearance?: 'default' | 'subtle';
  /** Optional extra class for layout composition by the host. */
  readonly className?: string;
}

/**
 * The "✨ Explain" / "✨ Summarize" trigger. Renders `null` when AI Insights is
 * disabled (the feature is opt-in and absent when off — UX §2.2).
 */
export function InsightTrigger({
  label,
  buildRequest,
  ariaLabel,
  appearance = 'default',
  className,
}: InsightTriggerProps) {
  const enabled = useSettingsStore((s) => s.integrations.llm.enabled);
  const openInsight = useInsightDrawerStore((s) => s.openInsight);

  const handleClick = useCallback(() => {
    openInsight(buildRequest());
  }, [openInsight, buildRequest]);

  // Opt-in, out of the way: absent entirely when disabled (not greyed out).
  if (!enabled) return null;

  const classNames = [styles.trigger, appearance === 'subtle' ? styles.subtle : null, className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classNames}
      onClick={handleClick}
      aria-label={ariaLabel ?? label}
    >
      <AiMarker variant="action" label={label} />
    </button>
  );
}
