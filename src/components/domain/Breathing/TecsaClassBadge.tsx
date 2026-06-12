/**
 * TecsaClassBadge — non-alarming badge for a TECSA trajectory class.
 *
 * Renders a shape + label + colour combo (per WCAG-AA: colour never the sole
 * signal) drawn from {@link tecsaPresentation}. The colour ramp is the calm
 * cyan→indigo→violet line; never status-severe red.
 *
 * @module components/domain/Breathing/TecsaClassBadge
 */

import type { CSSProperties } from 'react';

import { tecsaPresentation } from '@/analysis/breathing';
import type { TecsaClass } from '@/analysis/breathing';

import styles from './TecsaClassBadge.module.css';

export interface TecsaClassBadgeProps {
  /** The classifier output. */
  readonly tecsaClass: TecsaClass;
  /** Show the subtitle line below the label. */
  readonly showSubtitle?: boolean;
  /** Optional override className. */
  readonly className?: string;
  /** Render a compact (table-cell) variant. */
  readonly compact?: boolean;
}

export function TecsaClassBadge({
  tecsaClass,
  showSubtitle = false,
  className,
  compact = false,
}: TecsaClassBadgeProps): JSX.Element {
  const p = tecsaPresentation(tecsaClass);

  const style = {
    '--tecsa-color': `var(${p.colorVar})`,
    '--tecsa-bg': `var(${p.bgVar})`,
  } as CSSProperties;

  const rootClass = [styles.root, compact ? styles.compact : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={rootClass}
      style={style}
      data-tecsa-class={tecsaClass}
      role="img"
      aria-label={`${p.label} TECSA pattern (${p.shapeLabel} marker)`}
    >
      <span className={styles.shape} aria-hidden="true">
        {p.shape}
      </span>
      <span className={styles.text}>
        <span className={styles.label}>{p.label}</span>
        {showSubtitle && <span className={styles.subtitle}>{p.subtitle}</span>}
      </span>
    </span>
  );
}

export default TecsaClassBadge;
