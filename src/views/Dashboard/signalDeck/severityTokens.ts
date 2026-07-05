/**
 * Shared severity → design-token mapping for the Signal Deck.
 *
 * Every panel colours clinical severity from the SAME canonical
 * `--color-status-*` tokens so the deck reads as one system in both light and
 * dark themes. Severity is always paired with a text label or numeric value in
 * the UI — colour is never the sole signal (WCAG 1.4.1).
 *
 * For CSS (`className`/`style`) use {@link severityVar}. For raw `<svg>` fills
 * (which need literal colour strings) resolve the palette once with
 * {@link useSeverityColors} and pass it to {@link severityColor}; the resolved
 * strings re-compute on theme change, mirroring `useChartColors`.
 *
 * @module views/Dashboard/signalDeck/severityTokens
 */

import { useMemo } from 'react';

import type { AhiSeverity } from '@/analysis/clinical';
import { useAppStore } from '@/stores/useAppStore';

/** Resolved literal colours for the four clinical severity bands. */
export interface SeverityColors {
  readonly normal: string;
  readonly mild: string;
  readonly moderate: string;
  readonly severe: string;
  /** Muted colour used for an undefined (null) severity. */
  readonly muted: string;
}

/** CSS `var(--…)` reference for a severity's solid fill. */
export function severityVar(severity: AhiSeverity): string {
  return `var(--color-status-${severity})`;
}

/** CSS `var(--…)` reference for a severity's translucent background. */
export function severityBgVar(severity: AhiSeverity): string {
  return `var(--color-status-${severity}-bg)`;
}

/** Human-readable severity label (never rely on colour alone). */
export function severityLabel(severity: AhiSeverity): string {
  switch (severity) {
    case 'normal':
      return 'Normal';
    case 'mild':
      return 'Mild';
    case 'moderate':
      return 'Moderate';
    case 'severe':
      return 'Severe';
  }
}

function readVar(prop: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
}

/**
 * Resolve the severity palette to literal strings, re-computing on theme change.
 */
export function useSeverityColors(): SeverityColors {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  return useMemo(
    () => ({
      normal: readVar('--color-status-normal'),
      mild: readVar('--color-status-mild'),
      moderate: readVar('--color-status-moderate'),
      severe: readVar('--color-status-severe'),
      muted: readVar('--color-text-muted'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedTheme],
  );
}

/**
 * Resolve a severity to a literal colour string for raw `<svg>` fills. `null`
 * (undefined rate) → the muted colour.
 */
export function severityColor(colors: SeverityColors, severity: AhiSeverity | null): string {
  if (severity === null) return colors.muted;
  return colors[severity];
}
