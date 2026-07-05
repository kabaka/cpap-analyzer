/**
 * Radial arc gauge for the Signal Deck Therapy Index verdict.
 *
 * Draws a 280°-sweep track (−140° → +140°) with a coloured progress arc from
 * `0` to `score/100`. The gauge itself is purely decorative
 * (`aria-hidden`) — {@link VerdictCard} renders the numeric score and its
 * qualitative label as real, screen-reader-visible text, so severity is never
 * conveyed by the arc colour alone (WCAG 1.4.1).
 *
 * Colours are passed in already-resolved (via {@link useChartColors}) so the
 * gauge is theme-correct without hardcoding hex.
 *
 * @module views/Dashboard/signalDeck/RingGauge
 */

export interface RingGaugeProps {
  /** Composite score, 0–100. Clamped for the arc sweep. */
  readonly score: number;
  /** Resolved progress-arc colour. */
  readonly color: string;
  /** Resolved track (unfilled) colour. */
  readonly trackColor: string;
  /** SVG size (square) in viewBox units. */
  readonly size?: number;
  /** Arc stroke width. */
  readonly strokeWidth?: number;
}

const START_ANGLE = -140;
const END_ANGLE = 140;

/** Polar → cartesian (degrees, 0° = top, clockwise). */
function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** SVG arc path from `a0` to `a1` (degrees), swept clockwise. */
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [sx, sy] = polar(cx, cy, r, a1);
  const [ex, ey] = polar(cx, cy, r, a0);
  const large = a1 - a0 <= 180 ? 0 : 1;
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${large} 0 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

export function RingGauge({
  score,
  color,
  trackColor,
  size = 150,
  strokeWidth = 11,
}: RingGaugeProps): JSX.Element {
  const c = size / 2;
  const r = c - strokeWidth / 2 - 1;
  const clamped = Math.max(0, Math.min(100, score));
  const valueAngle = START_ANGLE + (END_ANGLE - START_ANGLE) * (clamped / 100);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path
        d={arcPath(c, c, r, START_ANGLE, END_ANGLE)}
        fill="none"
        stroke={trackColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {clamped > 0 && (
        <path
          d={arcPath(c, c, r, START_ANGLE, valueAngle)}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export default RingGauge;
