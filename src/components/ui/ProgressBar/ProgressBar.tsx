/**
 * Reusable determinate (or indeterminate) progress bar.
 *
 * Extracted from the inline `role="progressbar"` pattern previously duplicated in
 * {@link import('../../../views/DataManagement/ImportWizard').default} so every
 * surface that reports progress shares one accessible, themed primitive
 * (docs/design/breathing-catalog-streaming-ux.md §2).
 *
 * Accessibility (WCAG AA):
 *  - Carries `role="progressbar"` with `aria-valuemin` / `aria-valuemax` /
 *    `aria-valuenow` in the caller's own units (e.g. raw night counts), so
 *    `aria-valuetext` and `aria-valuenow` agree.
 *  - `aria-valuetext` is a human sentence; screen readers announce it rather
 *    than a bare "37 / 1825".
 *  - `aria-label` (or `aria-labelledby`) names the bar.
 *  - The fill animation is gated behind `prefers-reduced-motion` in CSS.
 *  - A `paused` flag adds a non-colour hatch cue so a stopped bar never reads as
 *    complete by colour alone.
 *
 * The fill width is applied via a ref (not a React-controlled style object) to
 * avoid a re-render per progress tick on a high-frequency stream.
 *
 * @module components/ui/ProgressBar
 */

import { useEffect, useRef } from 'react';

import styles from './ProgressBar.module.css';

/** Props for {@link ProgressBar}. */
export interface ProgressBarProps {
  /** Current value, in the same units as {@link max}. Ignored when indeterminate. */
  readonly value?: number;
  /** Maximum value (the "100%" point). Required for determinate bars. */
  readonly max?: number;
  /**
   * When `true`, renders an indeterminate sweeping bar (unknown total). `value`
   * / `max` are then ignored for the fill but ARIA omits `aria-valuenow`.
   */
  readonly indeterminate?: boolean;
  /**
   * When `true`, marks the bar visually paused (a hatch overlay) — used for a
   * cancelled run so it never looks complete. Purely presentational; the ARIA
   * value is supplied by the caller via {@link valueText}.
   */
  readonly paused?: boolean;
  /** Accessible name. Provide this OR {@link labelledBy}. */
  readonly label?: string;
  /** ID of an element naming the bar. Provide this OR {@link label}. */
  readonly labelledBy?: string;
  /**
   * Human-readable progress sentence read by assistive tech (e.g.
   * "Analyzing: 37 of 1825 nights done, 11 from cache."). Strongly recommended.
   */
  readonly valueText?: string;
  /** Optional extra class on the outer wrapper. */
  readonly className?: string;
}

/**
 * A determinate progress bar driven by raw `value` / `max` counts, or an
 * indeterminate sweep when `indeterminate` is set.
 */
export function ProgressBar({
  value = 0,
  max = 100,
  indeterminate = false,
  paused = false,
  label,
  labelledBy,
  valueText,
  className,
}: ProgressBarProps): JSX.Element {
  const fillRef = useRef<HTMLDivElement>(null);

  const safeMax = max > 0 ? max : 1;
  const clamped = Math.max(0, Math.min(value, safeMax));
  const percent = indeterminate ? 0 : Math.round((clamped / safeMax) * 100);

  useEffect(() => {
    const el = fillRef.current;
    if (!el || indeterminate) return;
    el.style.width = `${percent}%`;
  }, [percent, indeterminate]);

  const barClassName = [styles.bar, paused ? styles.paused : null].filter(Boolean).join(' ');
  const fillClassName = [styles.fill, indeterminate ? styles.indeterminate : null]
    .filter(Boolean)
    .join(' ');
  const wrapperClassName = [styles.wrapper, className].filter(Boolean).join(' ');

  return (
    <div className={wrapperClassName}>
      <div
        className={barClassName}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={indeterminate ? undefined : safeMax}
        aria-valuenow={indeterminate ? undefined : clamped}
        aria-valuetext={valueText}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
      >
        <div ref={fillRef} className={fillClassName} />
      </div>
    </div>
  );
}

export default ProgressBar;
