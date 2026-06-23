/**
 * Mapping from a {@link StageState} to its non-colour-redundant visual + textual
 * presentation. Each state pairs a distinct ICON SHAPE, a screen-reader / visible
 * status WORD, and a colour token — so meaning is never carried by colour alone
 * (WCAG 1.4.1).
 *
 * The `active` icon is the rotating `spinner`; under `prefers-reduced-motion` the
 * consumer swaps it for the static `circle-dot` (handled in the component, since
 * the media query is observed at render time).
 *
 * @module components/import/stageVisuals
 */

import type { IconName } from '@/components/ui';
import type { StageState } from '@/services/import/types';

/** The visual descriptor for one stage state. */
export interface StageVisual {
  /** Icon used in motion-OK environments. */
  readonly icon: IconName;
  /** Icon substituted under `prefers-reduced-motion` (no rotation). */
  readonly reducedMotionIcon: IconName;
  /** Whether this icon is animated (CSS-rotated) when motion is allowed. */
  readonly animated: boolean;
  /** Short status word announced + shown alongside the icon. */
  readonly word: string;
  /** CSS custom property supplying the icon colour. */
  readonly colorVar: string;
}

const VISUALS: Record<StageState, StageVisual> = {
  pending: {
    icon: 'circle-dashed',
    reducedMotionIcon: 'circle-dashed',
    animated: false,
    word: 'Pending',
    colorVar: 'var(--color-stage-pending)',
  },
  active: {
    icon: 'spinner',
    reducedMotionIcon: 'circle-dot',
    animated: true,
    word: 'In progress',
    colorVar: 'var(--color-stage-active)',
  },
  done: {
    icon: 'check-circle',
    reducedMotionIcon: 'check-circle',
    animated: false,
    word: 'Done',
    colorVar: 'var(--color-stage-done)',
  },
  warning: {
    icon: 'alert-triangle',
    reducedMotionIcon: 'alert-triangle',
    animated: false,
    word: 'Completed with warnings',
    colorVar: 'var(--color-stage-warning)',
  },
  error: {
    icon: 'x-circle',
    reducedMotionIcon: 'x-circle',
    animated: false,
    word: 'Failed',
    colorVar: 'var(--color-stage-error)',
  },
  skipped: {
    icon: 'circle-dashed',
    reducedMotionIcon: 'circle-dashed',
    animated: false,
    word: 'Skipped',
    colorVar: 'var(--color-stage-pending)',
  },
};

/** Look up the visual descriptor for a stage state. */
export function stageVisual(state: StageState): StageVisual {
  return VISUALS[state];
}
