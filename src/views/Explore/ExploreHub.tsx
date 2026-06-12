/**
 * Explore Hub — intent-oriented landing page for the analysis tools.
 *
 * Renders a grid of cards, one per "exploration" the user can perform. The
 * card list is data-driven via {@link EXPLORE_CARDS} so that future feature
 * views (e.g. Breathing Patterns, Machine Configurations) can be surfaced by
 * appending a single entry — no JSX changes required.
 *
 * ## Adding a new card (extension point)
 *
 * Append an {@link ExploreCard} to {@link EXPLORE_CARDS}:
 *
 * ```ts
 * {
 *   title: 'Breathing Patterns',
 *   description: 'Periodic breathing, flow limitation, and TECSA detection.',
 *   path: '/explore/breathing',
 *   iconClass: styles.iconBreathing, // add a matching class in the CSS module
 *   iconLabel: '🫁',
 * }
 * ```
 *
 * Also register the matching route under `/explore` in `src/router.tsx`. Cards
 * may set `disabled: true` (with an optional `badge`) to advertise a view that
 * is not yet navigable.
 *
 * @module views/Explore/ExploreHub
 */

import { Link } from 'react-router-dom';
import styles from './ExploreHub.module.css';

// ---------------------------------------------------------------------------
// Card data
// ---------------------------------------------------------------------------

interface ExploreCard {
  title: string;
  description: string;
  path: string;
  iconClass: string | undefined;
  iconLabel: string;
  disabled?: boolean;
  badge?: string;
}

/**
 * The hub's card list. This is the single extension point for the Explore
 * hub: add an entry here (and a corresponding route in `src/router.tsx`) to
 * surface a new exploration. Order here is the display order.
 */
const EXPLORE_CARDS: readonly ExploreCard[] = [
  {
    title: 'Event Explorer',
    description:
      'Event density, duration distributions, cluster detection, survival analysis, false-negative screening, and inter-event interval patterns.',
    path: '/explore/events',
    iconClass: styles.iconEvents,
    iconLabel: '⚡',
  },
  {
    title: 'Correlations',
    description:
      'Descriptive statistics, trends, distribution tests, and hypothesis testing for your therapy metrics — plus cross-source correlation with wearable and lifestyle data.',
    path: '/explore/correlations',
    iconClass: styles.iconStatistical,
    iconLabel: '📊',
  },
  {
    title: 'Pressure Optimization',
    description:
      'Pressure-response relationships, variability assessment, titration recommendations, and BiPAP effectiveness analysis.',
    path: '/explore/pressure',
    iconClass: styles.iconPressure,
    iconLabel: '🎯',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExploreHub() {
  return (
    <div className={styles.hub} role="main" aria-labelledby="explore-heading">
      <h1 id="explore-heading" className={styles.heading}>
        Explore
      </h1>
      <p className={styles.subtitle}>
        Dig into your CPAP therapy data with statistical methods, event clustering, cross-source
        correlation, and pressure optimisation tools.
      </p>

      <nav className={styles.grid} aria-label="Exploration types">
        {EXPLORE_CARDS.map((card) =>
          card.disabled ? (
            <div key={card.path} className={styles.disabledCard} aria-disabled="true">
              <div className={styles.cardHeader}>
                <span className={card.iconClass} aria-hidden="true">
                  {card.iconLabel}
                </span>
                <h2 className={styles.cardTitle}>{card.title}</h2>
              </div>
              <p className={styles.cardDescription}>{card.description}</p>
              {card.badge && <span className={styles.badge}>{card.badge}</span>}
            </div>
          ) : (
            <Link
              key={card.path}
              to={card.path}
              className={styles.card}
              aria-label={`${card.title}: ${card.description}`}
            >
              <div className={styles.cardHeader}>
                <span className={card.iconClass} aria-hidden="true">
                  {card.iconLabel}
                </span>
                <h2 className={styles.cardTitle}>{card.title}</h2>
              </div>
              <p className={styles.cardDescription}>{card.description}</p>
              <span className={styles.cardFooter}>
                Open <span className={styles.arrow}>→</span>
              </span>
            </Link>
          ),
        )}
      </nav>
    </div>
  );
}

export default ExploreHub;
