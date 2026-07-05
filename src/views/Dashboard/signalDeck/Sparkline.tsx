/**
 * Tiny pure-SVG sparkline for the Signal Deck small-multiples and wearable lanes.
 *
 * Deliberately dependency-free (no Recharts): the deck renders dozens of these,
 * so a lightweight inline `<svg>` keeps render cost and bundle weight down and
 * reproduces the design mock's dense terminal aesthetic exactly.
 *
 * ## Null is a gap, never a zero
 * The input series is `(number | null)[]`. A `null` is a missing/undefined night
 * (e.g. an AHI below the rate-validity floor, or a night with no wearable
 * sample). The line is **broken** across nulls — they are never plotted as `0`,
 * which would draw a misleading dip to the baseline.
 *
 * The colour is passed in as an already-resolved literal string (via
 * {@link useChartColors}) so the sparkline is theme-correct without hardcoding
 * hex. The element is decorative by default (`aria-hidden`) because every
 * sparkline in the deck sits beside a real numeric value and label; pass
 * `ariaLabel` to promote it to an `img` with an accessible name.
 *
 * @module views/Dashboard/signalDeck/Sparkline
 */

import { useId } from 'react';

export interface SparklineProps {
  /** Series to plot, oldest → newest. `null` entries are gaps (not zeros). */
  readonly values: readonly (number | null)[];
  /** Resolved stroke/fill colour (literal string, e.g. from useChartColors). */
  readonly color: string;
  /** SVG viewBox width (unitless; the element scales to its container). */
  readonly width?: number;
  /** SVG viewBox height. */
  readonly height?: number;
  /** Draw a faint area fill under the line. */
  readonly fill?: boolean;
  /** Stroke width in viewBox units. */
  readonly strokeWidth?: number;
  /** Radius of the trailing end dot; `0` hides it. */
  readonly dotRadius?: number;
  /** When set, the sparkline becomes an `img` with this accessible name. */
  readonly ariaLabel?: string;
  /** Optional class for sizing/layout by the host. */
  readonly className?: string;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Build an `M…L…` poly-line path from a run of points. */
function polyline(points: readonly Point[]): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
}

/**
 * A minimal null-gap-aware sparkline.
 */
export function Sparkline({
  values,
  color,
  width = 120,
  height = 28,
  fill = false,
  strokeWidth = 1.4,
  dotRadius = 1.6,
  ariaLabel,
  className,
}: SparklineProps): JSX.Element {
  const clipId = useId();
  const pad = 2;

  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));

  // No data at all → render an empty, correctly-sized box so layout is stable.
  if (finite.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        className={className}
        aria-hidden={ariaLabel ? undefined : true}
        role={ariaLabel ? 'img' : undefined}
        aria-label={ariaLabel}
        style={{ display: 'block', overflow: 'visible' }}
      />
    );
  }

  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    // Flat series — pad so the line sits centred rather than at an edge.
    min -= 1;
    max += 1;
  }

  const n = values.length;
  const xAt = (i: number): number => (n <= 1 ? pad : pad + (i * (width - 2 * pad)) / (n - 1));
  const yAt = (v: number): number => height - pad - ((v - min) / (max - min)) * (height - 2 * pad);

  // Split into contiguous runs separated by nulls so the stroke breaks on gaps.
  const runs: Point[][] = [];
  let current: Point[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (current.length > 0) runs.push(current);
      current = [];
    } else {
      current.push({ x: xAt(i), y: yAt(v as number) });
    }
  });
  if (current.length > 0) runs.push(current);

  // Trailing end-dot on the last real point.
  let lastPoint: Point | null = null;
  for (const run of runs) {
    const tail = run[run.length - 1];
    if (tail) lastPoint = tail;
  }

  // Area fill: only over contiguous runs (each closed down to the baseline).
  const baseline = height - pad;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      className={className}
      aria-hidden={ariaLabel ? undefined : true}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {fill &&
        runs.map((run, i) => {
          const first = run[0];
          const last = run[run.length - 1];
          if (!first || !last || run.length < 2) return null;
          const d = `${polyline(run)} L ${last.x.toFixed(1)} ${baseline} L ${first.x.toFixed(1)} ${baseline} Z`;
          return (
            <path key={`fill-${clipId}-${i}`} d={d} fill={color} opacity={0.14} stroke="none" />
          );
        })}
      {runs.map((run, i) =>
        run.length > 1 ? (
          <path
            key={`line-${clipId}-${i}`}
            d={polyline(run)}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null,
      )}
      {dotRadius > 0 && lastPoint && (
        <circle cx={lastPoint.x} cy={lastPoint.y} r={dotRadius} fill={color} />
      )}
    </svg>
  );
}

export default Sparkline;
