/**
 * Small color/marker swatch for an event type.
 *
 * Renders a leading dot in the event type's theme color. "Detection" types
 * (sustained patterns such as Periodic Breathing) use a hatched fill so they
 * are distinguishable without relying on color alone — satisfying the
 * "color is never the sole signal" accessibility requirement.
 *
 * @module components/events/EventTypeSwatch
 */

import type { EventType } from '@/types/events';
import { EVENT_TYPE_META } from './eventTypeMeta';
import styles from './EventTypeSwatch.module.css';

export interface EventTypeSwatchProps {
  type: EventType;
  /** Diameter in px (default 10). */
  size?: number;
}

export function EventTypeSwatch({ type, size = 10 }: EventTypeSwatchProps) {
  const meta = EVENT_TYPE_META[type];
  const color = meta?.color ?? 'var(--color-chart-7)';
  const hatched = meta?.marker === 'hatched';

  return (
    <span
      className={`${styles.swatch} ${hatched ? styles.hatched : ''}`}
      style={{
        width: size,
        height: size,
        // Solid types fill with the color; hatched types use it as the stripe color.
        ['--swatch-color' as string]: color,
      }}
      aria-hidden="true"
    />
  );
}
