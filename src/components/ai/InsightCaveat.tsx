/**
 * `InsightCaveat` + `MedicalDisclaimer` — the always-on, inseparable AI caveat
 * and the full medical disclaimer (UX §4.5, §7.3, §7.8; visual spec §3.7).
 *
 * Every generated narrative is wrapped so the caveat is **inseparable** from the
 * prose — it is part of the same component, non-dismissible, and rendered at the
 * foot of the narrative so prose can never be surfaced without it (Google Health
 * pattern; UX §9.3 acceptance). It is a labelled region (`role="note"`,
 * `aria-label="AI disclaimer"`), AI-tinted via the `--color-ai*` tokens — and
 * deliberately **not** error/warning-colored: it is the AI's own disclaimer, not
 * a failure (visual spec §3.7).
 *
 * Two surfaces:
 * - {@link InsightCaveat} — the caveat banner (primary or compact variant). It
 *   leads with the {@link AiMarker} so the ✨/AI disclosure precedes the text.
 * - {@link MedicalDisclaimer} — the fuller, app-wide medical disclaimer (UX
 *   §7.8) for the panel footer and the help article. Quiet, muted, informational.
 *
 * @module components/ai/InsightCaveat
 */

import { AiMarker } from './AiMarker';
import styles from './InsightCaveat.module.css';

/** Exact caveat microcopy (UX §7.3). */
const CAVEAT_PRIMARY = 'AI-generated — may be inaccurate. Verify against the numbers above.';
const CAVEAT_COMPACT = 'AI-generated — verify against your data.';

/** Exact medical-disclaimer microcopy (UX §7.8). */
export const MEDICAL_DISCLAIMER_TEXT =
  'This is not medical advice, a diagnosis, or a treatment recommendation. AI Insights only ' +
  'rephrases metrics this app computed from your data and can be inaccurate. Always confirm ' +
  'against the numbers shown and consult your healthcare provider about your therapy.';

export interface InsightCaveatProps {
  /**
   * `primary` (default) for the panel summary; `compact` for inline KPI
   * explanations (UX §7.3). Both are non-dismissible.
   */
  readonly variant?: 'primary' | 'compact';
  /** Optional extra class for layout composition by the host. */
  readonly className?: string;
}

/**
 * The inseparable, non-dismissible AI caveat banner. `role="note"` +
 * `aria-label="AI disclaimer"`; AI-tinted, never error/warning-colored.
 */
export function InsightCaveat({ variant = 'primary', className }: InsightCaveatProps) {
  const classNames = [styles.caveat, className].filter(Boolean).join(' ');
  return (
    <div className={classNames} role="note" aria-label="AI disclaimer">
      <AiMarker variant="tag" className={styles.marker} />
      <span className={styles.text}>{variant === 'compact' ? CAVEAT_COMPACT : CAVEAT_PRIMARY}</span>
    </div>
  );
}

export interface MedicalDisclaimerProps {
  /** Optional extra class for layout composition by the host. */
  readonly className?: string;
}

/**
 * The full medical disclaimer (UX §7.8), for the panel footer and help article.
 * Quiet and informational — `role="note"`, muted text, no AI tint.
 */
export function MedicalDisclaimer({ className }: MedicalDisclaimerProps) {
  const classNames = [styles.disclaimer, className].filter(Boolean).join(' ');
  return (
    <p className={classNames} role="note" aria-label="Medical disclaimer">
      {MEDICAL_DISCLAIMER_TEXT}
    </p>
  );
}
