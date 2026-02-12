/**
 * Analysis Hub — landing page for all analysis views.
 *
 * Displays cards linking to the statistical, event, and pressure
 * analysis views. Provides brief descriptions and navigation.
 *
 * @module views/Analysis/AnalysisHub
 */

import { Link } from 'react-router-dom';
import styles from './AnalysisHub.module.css';

// ---------------------------------------------------------------------------
// Card data
// ---------------------------------------------------------------------------

interface AnalysisCard {
  title: string;
  description: string;
  path: string;
  iconClass: string | undefined;
  iconLabel: string;
  disabled?: boolean;
  badge?: string;
}

const CARDS: readonly AnalysisCard[] = [
  {
    title: 'Statistical Analysis',
    description:
      'Descriptive statistics, time-series trends, distribution tests, correlation matrices, and hypothesis testing for your therapy metrics.',
    path: '/analysis/statistical',
    iconClass: styles.iconStatistical,
    iconLabel: '📊',
  },
  {
    title: 'Event Analysis',
    description:
      'Event density, duration distributions, cluster detection, survival analysis, false-negative screening, and inter-event interval patterns.',
    path: '/analysis/events',
    iconClass: styles.iconEvents,
    iconLabel: '⚡',
  },
  {
    title: 'Pressure Optimization',
    description:
      'Pressure-response relationships, variability assessment, titration recommendations, and BiPAP effectiveness analysis.',
    path: '/analysis/pressure',
    iconClass: styles.iconPressure,
    iconLabel: '🎯',
  },
  {
    title: 'Integration Analysis',
    description:
      'Correlate therapy data with external sources such as sleep trackers, weather, and lifestyle metrics.',
    path: '/analysis/integrations',
    iconClass: styles.iconIntegration,
    iconLabel: '🔗',
    disabled: true,
    badge: 'Coming soon',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnalysisHub() {
  return (
    <div className={styles.hub} role="main" aria-labelledby="analysis-heading">
      <h1 id="analysis-heading" className={styles.heading}>
        Analysis
      </h1>
      <p className={styles.subtitle}>
        Explore your CPAP therapy data with statistical methods, event clustering, and pressure
        optimisation tools.
      </p>

      <nav className={styles.grid} aria-label="Analysis types">
        {CARDS.map((card) =>
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

export default AnalysisHub;
