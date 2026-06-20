/**
 * Trend chip — a small directional arrow (↑ / ↓ / —) with a polarity-aware
 * colour and an accessible label.
 *
 * Three polarities encode whether a numeric direction carries a value judgment:
 *
 * - `neutral` — temperature, humidity, pressure, dew point, wind. The arrow is
 *   slate (`--color-trend-neutral`); the label is purely "Rising / Falling /
 *   Steady" with NO favourable/unfavourable wording. Higher pressure is not
 *   "better" than lower, so the chip must not imply it.
 * - `favorable-high` — a metric where rising is good (sleep score, HRV…). Rising
 *   → green, falling → red. This is the DEFAULT and reproduces the original
 *   `WearableOverview` behaviour for back-compat.
 * - `favorable-low` — a metric where falling is good (AQI, resting HR…). Falling
 *   → green, rising → red. The arrow always reflects the RAW numeric direction
 *   (so a down arrow is green for AQI); the accompanying word/value carries the
 *   real meaning.
 *
 * Colour is never the sole signal: the arrow glyph (direction) plus the label
 * always convey the trend independently of hue.
 *
 * @module components/ui/TrendIndicator
 */

import styles from './TrendIndicator.module.css';

/** Numeric trend direction. */
export type TrendDirection = 'up' | 'down' | 'unchanged';

/** How a direction maps onto favourable/unfavourable (or neither). */
export type TrendPolarity = 'neutral' | 'favorable-low' | 'favorable-high';

export interface TrendIndicatorProps {
  /** The raw numeric direction of the trend. */
  readonly direction: TrendDirection;
  /**
   * Polarity governing colour + wording.
   * @default 'favorable-high'
   */
  readonly polarity?: TrendPolarity;
  /**
   * Back-compat escape hatch: when `polarity` is omitted and `favorable` is
   * provided, it overrides the colour directly (preserving the original
   * `WearableOverview` API where the parent precomputed favourability).
   */
  readonly favorable?: boolean;
}

type Tone = 'good' | 'bad' | 'neutral';

/** Resolve the colour tone for a direction under a polarity. */
function resolveTone(
  direction: Exclude<TrendDirection, 'unchanged'>,
  polarity: TrendPolarity,
  favorableOverride: boolean | undefined,
): Tone {
  if (polarity === 'neutral') return 'neutral';
  if (favorableOverride !== undefined) return favorableOverride ? 'good' : 'bad';
  const risingIsGood = polarity === 'favorable-high';
  const isRising = direction === 'up';
  return isRising === risingIsGood ? 'good' : 'bad';
}

export function TrendIndicator({
  direction,
  polarity = 'favorable-high',
  favorable,
}: TrendIndicatorProps): JSX.Element {
  if (direction === 'unchanged') {
    return (
      <span className={`${styles.trend} ${styles.neutral}`} aria-label="Steady">
        &mdash;
      </span>
    );
  }

  const tone = resolveTone(direction, polarity, favorable);
  const arrow = direction === 'up' ? '↑' : '↓';
  const toneClass = tone === 'good' ? styles.good : tone === 'bad' ? styles.bad : styles.neutral;

  // The label states the plain direction; for polar metrics it appends the
  // judgment so non-visual users get the same information the colour conveys.
  const directionWord = direction === 'up' ? 'Rising' : 'Falling';
  const label =
    polarity === 'neutral' || tone === 'neutral'
      ? directionWord
      : `${directionWord} (${tone === 'good' ? 'favorable' : 'unfavorable'})`;

  return (
    <span className={`${styles.trend} ${toneClass}`} aria-label={label}>
      {arrow}
    </span>
  );
}
