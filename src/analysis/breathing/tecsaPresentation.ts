/**
 * Presentation helpers for the four-class TECSA trajectory classifier.
 *
 * Maps each {@link TecsaClass} to its visual specification (token-driven colour
 * + a redundant non-colour shape symbol per the WCAG-AA "colour never the sole
 * signal" rule), short and long plain-language explainers, and a copy register
 * that defaults to *measured* / non-alarming wording. TECSA is a trajectory,
 * not an alarm — these helpers must never reach for status-severe red.
 *
 * Per ADR 0017 the result is always **candidate detection, never diagnosis**.
 *
 * @module analysis/breathing/tecsaPresentation
 */

import type { TecsaClass } from './types';

/** Visual + copy descriptor for a single TECSA class. */
export interface TecsaPresentation {
  /** Display label (Title Case). */
  readonly label: string;
  /** Short non-alarming subtitle suitable for a chip / KPI. */
  readonly subtitle: string;
  /** Plain-language explainer body text (one or two sentences). */
  readonly explainer: string;
  /**
   * Single Unicode glyph used as a redundant non-colour cue. The four shapes
   * (circle, diamond, triangle, square) are chosen so each class is
   * distinguishable in grayscale.
   */
  readonly shape: string;
  /** Aria description of the shape, for screen readers. */
  readonly shapeLabel: string;
  /** CSS custom-property name for the class's foreground colour. */
  readonly colorVar: string;
  /** CSS custom-property name for the class's surface / wash colour. */
  readonly bgVar: string;
}

const PRESENTATION: Readonly<Record<TecsaClass, TecsaPresentation>> = {
  obstructive: {
    label: 'Obstructive',
    subtitle: 'No central pattern detected',
    explainer:
      'Central apnea index stayed below the threshold in both the early- and late-treatment windows. No treatment-emergent central pattern was detected on usable nights.',
    shape: '●',
    shapeLabel: 'circle',
    colorVar: '--color-tecsa-obstructive',
    bgVar: '--color-tecsa-obstructive-bg',
  },
  transient: {
    label: 'Transient',
    subtitle: 'Central events early, then resolved',
    explainer:
      'Central apneas were present early in treatment but resolved on their own by the later window. This is a common adaptation pattern; consider mentioning it to your clinician if symptoms persist.',
    shape: '◆',
    shapeLabel: 'diamond',
    colorVar: '--color-tecsa-transient',
    bgVar: '--color-tecsa-transient-bg',
  },
  persistent: {
    label: 'Persistent',
    subtitle: 'Central events present in both windows',
    explainer:
      'Central apnea index was at or above threshold in both the early and later windows. This is a candidate pattern worth discussing with your clinician — it is not a diagnosis.',
    shape: '▲',
    shapeLabel: 'triangle',
    colorVar: '--color-tecsa-persistent',
    bgVar: '--color-tecsa-persistent-bg',
  },
  emergent: {
    label: 'Emergent',
    subtitle: 'Central events appeared after treatment started',
    explainer:
      'Central apnea index was low early in treatment and rose above threshold by the later window — the candidate pattern for treatment-emergent central sleep apnea. This is not a diagnosis. Discuss with your clinician.',
    shape: '■',
    shapeLabel: 'square',
    colorVar: '--color-tecsa-emergent',
    bgVar: '--color-tecsa-emergent-bg',
  },
};

/** Look up the presentation descriptor for a {@link TecsaClass}. */
export function tecsaPresentation(cls: TecsaClass): TecsaPresentation {
  return PRESENTATION[cls];
}

/** Iterate every class's presentation in canonical order. */
export const TECSA_PRESENTATION_ORDER: readonly TecsaClass[] = [
  'obstructive',
  'transient',
  'persistent',
  'emergent',
];
