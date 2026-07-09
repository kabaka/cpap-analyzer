/**
 * Correlations view.
 *
 * Composes two existing analyses under one route as tabs:
 *
 *  - **Statistical** — descriptive statistics, trends, distribution tests,
 *    correlation matrices, Granger causality, and hypothesis testing
 *    ({@link StatisticalAnalysis}).
 *  - **Cross-source** — correlation of CPAP therapy metrics with wearable and
 *    lifestyle data ({@link IntegrationAnalysis}).
 *
 * This view is purely compositional: it reuses both analysis components
 * verbatim and does not reimplement any analytics. The active tab is synced to
 * the `?tab=` query parameter so individual tabs are deep-linkable
 * (e.g. `/explore/correlations?tab=cross-source`).
 *
 * @module views/Explore/Correlations
 */

import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Tabs } from '@/components/ui';
import { StatisticalAnalysis } from './StatisticalAnalysis';
import IntegrationAnalysis from './IntegrationAnalysis';
import styles from './Correlations.module.css';

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const STATISTICAL_TAB = 'statistical';
const CROSS_SOURCE_TAB = 'cross-source';

type TabValue = typeof STATISTICAL_TAB | typeof CROSS_SOURCE_TAB;

function isTabValue(value: string | null): value is TabValue {
  return value === STATISTICAL_TAB || value === CROSS_SOURCE_TAB;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Correlations() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  const activeTab: TabValue = isTabValue(tabParam) ? tabParam : STATISTICAL_TAB;

  const handleTabChange = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === STATISTICAL_TAB) {
            // Keep URLs clean: the default tab needs no query parameter.
            next.delete('tab');
          } else {
            next.set('tab', value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const tabs = [
    {
      value: STATISTICAL_TAB,
      label: 'Statistical',
      content: <StatisticalAnalysis />,
    },
    {
      value: CROSS_SOURCE_TAB,
      label: 'Cross-source',
      content: <IntegrationAnalysis />,
    },
  ];

  return (
    <div className={styles.page} role="main" aria-labelledby="correlations-heading">
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link to="/explore" className={styles.breadcrumbLink}>
          Explore
        </Link>
        <span className={styles.breadcrumbSep} aria-hidden="true">
          /
        </span>
        <span className={styles.breadcrumbCurrent}>Correlations</span>
      </nav>
      <h1 id="correlations-heading" className={styles.heading}>
        Correlations
      </h1>
      <p className={styles.subtitle}>
        Examine relationships within your therapy metrics and across external data sources.
      </p>

      <Tabs tabs={tabs} value={activeTab} onValueChange={handleTabChange} />
    </div>
  );
}

export default Correlations;
