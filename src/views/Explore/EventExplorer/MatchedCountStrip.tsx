/**
 * Matched-count "trust strip" for the Event Explorer.
 *
 * Shows how many events match out of the total, the number of active filters,
 * and a proportional bar. Announced via `aria-live` so screen-reader users
 * hear the count update as filters change.
 *
 * @module views/Explore/EventExplorer/MatchedCountStrip
 */

import styles from './MatchedCountStrip.module.css';

export interface MatchedCountStripProps {
  matched: number;
  total: number;
  activeFilters: number;
}

export function MatchedCountStrip({ matched, total, activeFilters }: MatchedCountStripProps) {
  const pct = total > 0 ? (matched / total) * 100 : 0;
  const filterText =
    activeFilters === 0 ? 'no filters' : `${activeFilters} filter${activeFilters === 1 ? '' : 's'}`;

  return (
    <div className={styles.strip}>
      <p className={styles.count} aria-live="polite">
        <strong>{matched.toLocaleString()}</strong> of {total.toLocaleString()} events match{' '}
        {filterText}
      </p>
      <div
        className={styles.bar}
        role="img"
        aria-label={`${pct.toFixed(1)}% of events match the current filters`}
      >
        <div className={styles.barFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
