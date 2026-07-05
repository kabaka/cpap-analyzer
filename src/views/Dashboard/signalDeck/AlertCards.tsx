/**
 * Alert cards row — surfaces up to three app-computed {@link Insight}s.
 *
 * These are the REAL insights from {@link generateInsights} (the same engine the
 * classic dashboard uses), not hardcoded copy. Severity maps to a tag + tone:
 * `warning → Watch (mild/amber)`, `neutral → Caveat (slate)`,
 * `positive → Good (normal/green)`. Each card pairs its tone with a text tag and
 * a glyph, so severity is never conveyed by colour alone (WCAG 1.4.1).
 *
 * @module views/Dashboard/signalDeck/AlertCards
 */

import type { Insight, InsightSeverity } from '../insights';
import styles from './AlertCards.module.css';

export interface AlertCardsProps {
  /** App-computed insights (already sorted warning → neutral → positive). */
  readonly insights: readonly Insight[];
}

interface SeverityPresentation {
  readonly tag: string;
  readonly glyph: string;
  readonly toneClass: string;
}

const SEVERITY_PRESENTATION: Record<InsightSeverity, SeverityPresentation> = {
  warning: { tag: 'Watch', glyph: '▲', toneClass: styles.warning ?? '' },
  neutral: { tag: 'Caveat', glyph: '◆', toneClass: styles.neutral ?? '' },
  positive: { tag: 'Good', glyph: '●', toneClass: styles.positive ?? '' },
};

export function AlertCards({ insights }: AlertCardsProps): JSX.Element | null {
  const visible = insights.slice(0, 3);
  if (visible.length === 0) return null;

  return (
    <ul className={styles.row} aria-label="Therapy alerts">
      {visible.map((insight) => {
        const pres = SEVERITY_PRESENTATION[insight.severity];
        return (
          <li key={insight.id} className={`${styles.card} ${pres.toneClass}`}>
            <div className={styles.cardHeader}>
              <span className={styles.glyph} aria-hidden="true">
                {pres.glyph}
              </span>
              <span className={styles.tag}>{pres.tag}</span>
            </div>
            <p className={styles.detail}>{insight.message}</p>
          </li>
        );
      })}
    </ul>
  );
}

export default AlertCards;
