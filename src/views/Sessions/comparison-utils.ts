/**
 * Pure helper functions for the SessionComparison view.
 *
 * Extracted from the component to avoid react-refresh/only-export-components
 * warnings and keep pure logic separate from the React component.
 *
 * @module views/Sessions/comparison-utils
 */

import type { NightlyAggregate } from '@/types';

import styles from './SessionComparison.module.css';

/**
 * Direction describing when a metric value IMPROVES.
 * - `'lower'` — lower is better (AHI, leak metrics)
 * - `'higher'` — higher is better (usage hours)
 */
export type ImprovementDirection = 'lower' | 'higher';

/** Format a number with a fixed number of decimal places. */
export function fmt(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/** Calculate percentage change from A to B. Returns NaN when A is 0. */
export function percentChange(a: number, b: number): number {
  if (a === 0) return b === 0 ? 0 : NaN;
  return ((b - a) / Math.abs(a)) * 100;
}

/**
 * Determine the CSS class for a delta value based on improvement direction.
 * - Improved → green
 * - Worsened → red
 * - No change → muted
 */
export function deltaClass(delta: number, direction: ImprovementDirection): string {
  if (delta === 0) return styles.deltaNeutral ?? '';
  if (direction === 'lower') {
    return delta < 0 ? (styles.deltaNegative ?? '') : (styles.deltaPositive ?? '');
  }
  // direction === 'higher'
  return delta > 0 ? (styles.deltaImprovedUp ?? '') : (styles.deltaWorsenedUp ?? '');
}

/** Read a numeric metric value from an aggregate, coalescing null to 0. */
export function readMetric(agg: NightlyAggregate, key: keyof NightlyAggregate): number {
  const val = agg[key];
  if (typeof val === 'number') return val;
  return 0;
}
