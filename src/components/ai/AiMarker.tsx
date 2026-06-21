/**
 * `AiMarker` — the canonical "✨ AI" content marker (AI Insights visual spec §1).
 *
 * The single, instantly-recognizable marker that appears **only** on
 * LLM-generated content and the affordances that produce it — never on
 * deterministic UI (the `(?)` glossary help keeps its own tokens; visual spec
 * §1.4). It is the visual counterpart to the UX hard rule that the ✨ sparkle +
 * "AI" wording is reserved for generated content (UX §4.2, §8.5; Apple HIG
 * disclosure).
 *
 * Accessibility (WCAG 1.4.1 — color is never the sole signal): the ✨ glyph is
 * decorative (`aria-hidden`); the literal text ("AI", or a caller-supplied
 * longer label like "AI-generated") always carries the meaning. The fuchsia
 * `--color-ai*` tint is reinforcement only.
 *
 * Variants:
 * - `pill` (default) — `[✨] AI` filled pill, for prose/region headers.
 * - `tag` — glyph + text, no fill, for tight inline contexts (e.g. an accordion
 *   trigger reading `✨ AI Insights`).
 * - `action` — glyph + text styled to read as actionable (the marker for
 *   `✨ Explain` / `✨ Summarize` affordances). Render this INSIDE a real
 *   `<button>` — `AiMarker` itself is always a non-interactive `<span>`.
 *
 * @module components/ai/AiMarker
 */

import type { ReactNode } from 'react';

import styles from './AiMarker.module.css';

/** The marker's visual variant (visual spec §1.2). */
export type AiMarkerVariant = 'pill' | 'tag' | 'action';

export interface AiMarkerProps {
  /** Visual variant. Defaults to `pill`. */
  readonly variant?: AiMarkerVariant;
  /**
   * The text label that carries the accessible signal. Defaults to `AI`. Use a
   * longer label ("AI-generated", "Explain", "Summarize") where the context
   * needs it; the label is always rendered as text, never implied by color.
   */
  readonly label?: ReactNode;
  /** Optional extra class for layout composition by the host. */
  readonly className?: string;
}

/**
 * The ✨ generative-AI marker. Always a non-interactive `<span>`; the `action`
 * variant only styles its contents to read as actionable — wrap it in a real
 * `<button>` for behavior.
 */
export function AiMarker({ variant = 'pill', label = 'AI', className }: AiMarkerProps) {
  const classNames = [styles.marker, styles[variant], className].filter(Boolean).join(' ');
  return (
    <span className={classNames}>
      <span className={styles.glyph} aria-hidden="true">
        ✨
      </span>
      <span className={styles.label}>{label}</span>
    </span>
  );
}
