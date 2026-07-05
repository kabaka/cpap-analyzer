/**
 * Shared respiratory-event-type → colour mapping for the Signal Deck.
 *
 * One source of truth for the event-mix stacked bars (distributions row) and the
 * per-session event-mix bar (session log), so the two always agree. Colours are
 * resolved literals from {@link ChartColors} (theme-aware, no hardcoded hex).
 *
 * @module views/Dashboard/signalDeck/eventColors
 */

import type { ChartColors } from '@/components/charts/useChartColors';

/** The five stacked event categories, in draw order (bottom → top). */
export type EventKey = 'obstructive' | 'hypopnea' | 'central' | 'mixed' | 'rera';

/** Ordered event keys (bottom of the stack first). */
export const EVENT_KEYS: readonly EventKey[] = [
  'obstructive',
  'hypopnea',
  'central',
  'mixed',
  'rera',
];

/** Resolve the per-type colours from the theme palette. */
export function eventTypeColors(colors: ChartColors): Record<EventKey, string> {
  return {
    obstructive: colors.chart1,
    hypopnea: colors.chart6,
    central: colors.detection,
    mixed: colors.chart5,
    rera: colors.axis,
  };
}

/** Human-readable labels for the legend (order matches {@link EVENT_KEYS}). */
export const EVENT_LABELS: Record<EventKey, string> = {
  obstructive: 'Obstructive',
  hypopnea: 'Hypopnea',
  central: 'Central',
  mixed: 'Mixed',
  rera: 'RERA',
};
