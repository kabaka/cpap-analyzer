/**
 * Centralized event-type presentation metadata.
 *
 * Single source of truth for the color, human-readable label, and marker
 * style used to represent each {@link EventType} across the app (Signal
 * Viewer, Session Detail, Event Explorer, …). Colors are expressed as CSS
 * custom-property references so they adapt to the active theme.
 *
 * Accessibility: color is never the sole signal. "Detection" events
 * (those representing a sustained pattern rather than a discrete respiratory
 * event — e.g. Periodic Breathing) carry a distinct hatched marker so they
 * are distinguishable without relying on hue alone.
 *
 * @module components/events/eventTypeMeta
 */

import type { EventType } from '@/types/events';

/** Visual marker treatment for an event-type swatch. */
export type EventMarkerStyle = 'solid' | 'hatched';

/** Presentation metadata for a single event type. */
export interface EventTypeMeta {
  /** Human-readable label (i18n key candidate). */
  readonly label: string;
  /** CSS custom-property reference for the type's color. */
  readonly color: string;
  /**
   * Marker treatment. `hatched` distinguishes sustained "detection" patterns
   * (periodic breathing) from discrete respiratory events.
   */
  readonly marker: EventMarkerStyle;
  /**
   * Whether this is a sustained pattern detection rather than a discrete
   * respiratory event. Detection types are visually set apart.
   */
  readonly detection: boolean;
}

/**
 * Event-type → presentation metadata.
 *
 * Colors mirror the long-standing Signal Viewer / Session Detail mapping so
 * the Event Explorer is visually consistent with the rest of the app.
 */
export const EVENT_TYPE_META: Readonly<Record<EventType, EventTypeMeta>> = {
  ObstructiveApnea: {
    label: 'Obstructive Apnea',
    color: 'var(--color-status-severe)',
    marker: 'solid',
    detection: false,
  },
  CentralApnea: {
    label: 'Central Apnea',
    color: 'var(--color-status-moderate)',
    marker: 'solid',
    detection: false,
  },
  MixedApnea: {
    label: 'Mixed Apnea',
    color: 'var(--color-status-moderate)',
    marker: 'solid',
    detection: false,
  },
  Hypopnea: {
    label: 'Hypopnea',
    color: 'var(--color-status-mild)',
    marker: 'solid',
    detection: false,
  },
  RERA: {
    label: 'RERA',
    color: 'var(--color-chart-4)',
    marker: 'solid',
    detection: false,
  },
  FlowLimitation: {
    label: 'Flow Limitation',
    color: 'var(--color-chart-6)',
    marker: 'solid',
    detection: false,
  },
  LargeLeak: {
    label: 'Large Leak',
    color: 'var(--color-chart-5)',
    marker: 'solid',
    detection: true,
  },
  PeriodicBreathing: {
    label: 'Periodic Breathing',
    color: 'var(--color-chart-7)',
    marker: 'hatched',
    detection: true,
  },
  ClearAirway: {
    label: 'Clear Airway',
    color: 'var(--color-chart-3)',
    marker: 'solid',
    detection: false,
  },
  Vibratory: {
    label: 'Vibratory Snore',
    color: 'var(--color-text-muted)',
    marker: 'solid',
    detection: true,
  },
  ChecksumError: {
    label: 'Checksum Error',
    color: 'var(--color-text-muted)',
    marker: 'solid',
    detection: false,
  },
};

/** All event types in a stable display order. */
export const EVENT_TYPE_ORDER: readonly EventType[] = [
  'ObstructiveApnea',
  'ClearAirway',
  'CentralApnea',
  'MixedApnea',
  'Hypopnea',
  'RERA',
  'FlowLimitation',
  'PeriodicBreathing',
  'LargeLeak',
  'Vibratory',
  'ChecksumError',
];

/** Resolve an event type's color, falling back to a neutral chart hue. */
export function eventColor(type: string): string {
  return EVENT_TYPE_META[type as EventType]?.color ?? 'var(--color-chart-7)';
}

/** Resolve an event type's human-readable label, falling back to the raw key. */
export function eventLabel(type: string): string {
  return EVENT_TYPE_META[type as EventType]?.label ?? type;
}
