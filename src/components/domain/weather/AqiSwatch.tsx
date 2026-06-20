/**
 * Shared AQI swatch atom: `[12×12 swatch + rank pattern] word value`.
 *
 * The single inline AQI readout used by the dashboard tile, the sync coverage
 * view, tooltips, and legends (visual spec §1.4). Air-quality severity is
 * encoded redundantly — colour (swatch fill) + pattern (rank hatch) + WORD +
 * NUMBER — so it is never conveyed by colour alone (WCAG 1.4.1). The word is
 * always rendered in `--color-text-primary` (not the ramp colour), so the
 * low-rank ramp fills that fall below 4.5:1 as text never carry the label.
 *
 * The whole atom is a single `role="img"` with an `aria-label` such as
 * "Air quality: Moderate, US AQI 78"; the swatch SVG is decorative. The atom is
 * NEVER emitted without its trailing word + number.
 *
 * @module components/domain/weather/AqiSwatch
 */

import { useId } from 'react';
import { resolveAqi, type AqiPattern, type AqiScale } from '@/analysis/weather';
import styles from './AqiSwatch.module.css';

export interface AqiSwatchProps {
  /** Raw AQI value on `scale`; `null` renders an em dash (no fabricated zero). */
  readonly value: number | null;
  /** Which AQI scale `value` is on. @default 'us' */
  readonly scale?: AqiScale;
  /** Hide the numeric value (e.g. very tight legends). The word always shows. */
  readonly hideValue?: boolean;
}

const SCALE_NAME: Record<AqiScale, string> = { us: 'US AQI', european: 'European AQI' };

/** Diagonal hatch pitch (px) per pattern; `null` = no hatch. */
const HATCH_PITCH: Record<AqiPattern, number | null> = {
  solid: null,
  'hatch-sparse': 10,
  'hatch-med': 7,
  'hatch-dense': 5,
  crosshatch: 5,
  'crosshatch-outline': 5,
};

export function AqiSwatch({ value, scale = 'us', hideValue = false }: AqiSwatchProps): JSX.Element {
  const resolved = resolveAqi(value, scale);
  const patternId = useId().replace(/:/g, '');

  if (resolved.rank === null || resolved.ramp === null || resolved.label === null) {
    // No reading — show a neutral em dash, never a fabricated 0.
    return (
      <span className={styles.swatchRow} role="img" aria-label="Air quality: no data">
        <span className={styles.noData} aria-hidden="true">
          &mdash;
        </span>
      </span>
    );
  }

  const { ramp, label, value: displayValue } = resolved;
  const pitch = HATCH_PITCH[ramp.pattern];
  const crosshatch = ramp.pattern === 'crosshatch' || ramp.pattern === 'crosshatch-outline';
  const outline = ramp.pattern === 'crosshatch-outline';

  const ariaLabel =
    displayValue === null
      ? `Air quality: ${label}`
      : `Air quality: ${label}, ${SCALE_NAME[scale]} ${displayValue}`;

  return (
    <span className={styles.swatchRow} role="img" aria-label={ariaLabel}>
      <svg
        className={styles.swatch}
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
        focusable="false"
      >
        {pitch !== null && (
          <defs>
            <pattern
              id={`aqi-hatch-${patternId}`}
              patternUnits="userSpaceOnUse"
              width={pitch}
              height={pitch}
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2={pitch} stroke={`var(${ramp.fgVar})`} strokeWidth="1" />
            </pattern>
            {crosshatch && (
              <pattern
                id={`aqi-hatch2-${patternId}`}
                patternUnits="userSpaceOnUse"
                width={pitch}
                height={pitch}
                patternTransform="rotate(-45)"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2={pitch}
                  stroke={`var(${ramp.fgVar})`}
                  strokeWidth="1"
                />
              </pattern>
            )}
          </defs>
        )}
        <rect x="0" y="0" width="12" height="12" rx="2" fill={`var(${ramp.colorVar})`} />
        {pitch !== null && (
          <rect x="0" y="0" width="12" height="12" rx="2" fill={`url(#aqi-hatch-${patternId})`} />
        )}
        {crosshatch && (
          <rect x="0" y="0" width="12" height="12" rx="2" fill={`url(#aqi-hatch2-${patternId})`} />
        )}
        <rect
          x="0.5"
          y="0.5"
          width="11"
          height="11"
          rx="1.5"
          fill="none"
          stroke="var(--color-border-default)"
          strokeWidth={outline ? 1.5 : 1}
        />
      </svg>
      <span className={styles.word}>{label}</span>
      {!hideValue && displayValue !== null && <span className={styles.value}>{displayValue}</span>}
    </span>
  );
}
