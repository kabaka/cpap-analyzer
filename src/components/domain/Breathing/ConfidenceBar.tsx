/**
 * ConfidenceBar — a horizontal meter rendering a detection confidence in `[0, 1]`.
 *
 * Pairs the bar with a redundant numeric label (per WCAG-AA: colour and length
 * never the sole signal). Used by the per-session episode chip popovers, the
 * Explore → Breathing Patterns episode catalog, and the longitudinal TECSA
 * confidence display.
 *
 * @module components/domain/Breathing/ConfidenceBar
 */

import { useMemo } from 'react';

import { confidenceTier, confidenceTierLabel } from '@/analysis/breathing';

import styles from './ConfidenceBar.module.css';

export interface ConfidenceBarProps {
  /** Confidence value in `[0, 1]`. Out-of-range values are clamped. */
  readonly value: number;
  /**
   * Optional descriptive prefix for the screen-reader label
   * (e.g. "Episode confidence"). Defaults to "Confidence".
   */
  readonly label?: string;
  /** Optional override className. */
  readonly className?: string;
  /** When true, render in a compact form (suitable for table rows). */
  readonly compact?: boolean;
}

/**
 * Render a confidence value as a tier-coloured bar plus a redundant percentage.
 */
export function ConfidenceBar({
  value,
  label = 'Confidence',
  className,
  compact = false,
}: ConfidenceBarProps): JSX.Element {
  const clamped = useMemo(() => {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }, [value]);

  const tier = confidenceTier(clamped);
  const tierName = confidenceTierLabel(tier);
  const pct = Math.round(clamped * 100);

  const rootClass = [styles.root, compact ? styles.compact : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={rootClass}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={clamped}
      aria-valuetext={`${tierName}, ${pct} percent`}
      aria-label={label}
      data-tier={tier}
    >
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${pct}%` }} aria-hidden="true" />
      </div>
      <span className={styles.readout} aria-hidden="true">
        {pct}%
      </span>
    </div>
  );
}

export default ConfidenceBar;
