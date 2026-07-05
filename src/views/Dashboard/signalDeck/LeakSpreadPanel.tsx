/**
 * Leak-spread box plot (custom SVG).
 *
 * Summarises the distribution of nightly median leak via {@link leakDistribution}
 * (P25 / P50 / P75 box, 2nd–98th-percentile whiskers). A dashed reference line
 * marks the canonical large-leak notice level ({@link LEAK_NOTICE_LPM}), labelled
 * "notice" so the threshold is not colour-only.
 *
 * A small custom SVG (rather than the generic `BoxPlot`) is used to match the
 * mock's dense horizontal single-box layout and the notice annotation.
 *
 * @module views/Dashboard/signalDeck/LeakSpreadPanel
 */

import { useChartColors } from '@/components/charts/useChartColors';
import { LEAK_NOTICE_LPM } from '@/analysis/uncertainty/constants';
import type { NightlyAggregate } from '@/types';

import { leakDistribution } from './metrics';
import { useSeverityColors } from './severityTokens';
import styles from './DistributionsRow.module.css';

export interface LeakSpreadPanelProps {
  readonly aggregates: readonly NightlyAggregate[];
}

const VB_W = 300;
const VB_H = 160;
const CY = 78;
const PAD_X = 12;

export function LeakSpreadPanel({ aggregates }: LeakSpreadPanelProps): JSX.Element {
  const colors = useChartColors();
  const severityColors = useSeverityColors();
  const dist = leakDistribution(aggregates);
  const innerW = VB_W - PAD_X * 2;

  const hasData =
    dist.n > 0 &&
    dist.p25 !== null &&
    dist.p50 !== null &&
    dist.p75 !== null &&
    dist.whiskerLow !== null &&
    dist.whiskerHigh !== null;

  const axisMax = Math.max(30, LEAK_NOTICE_LPM * 1.15, (dist.whiskerHigh ?? 0) * 1.1);
  const xAt = (v: number): number => PAD_X + (v / axisMax) * innerW;

  const ticks = [0, 10, 20, 30].filter((t) => t <= axisMax);
  const medianText = dist.p50 === null ? '—' : dist.p50.toFixed(1);

  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>Leak spread</h2>
      <p className={styles.subtitle}>L/min · box = P25–P75</p>
      {!hasData ? (
        <p className={styles.empty}>No leak data in range.</p>
      ) : (
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Nightly median leak: P25 ${dist.p25?.toFixed(1)}, median ${medianText}, P75 ${dist.p75?.toFixed(1)} litres per minute over ${dist.n} nights. Large-leak notice level ${LEAK_NOTICE_LPM}.`}
          className={styles.chart}
        >
          {/* Axis ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={xAt(t)}
                x2={xAt(t)}
                y1={CY - 42}
                y2={CY + 42}
                stroke={colors.grid}
                strokeWidth={1}
              />
              <text
                x={xAt(t)}
                y={CY + 58}
                fill={colors.axis}
                fontSize={8}
                textAnchor="middle"
                fontFamily="var(--font-family-mono)"
              >
                {t}
              </text>
            </g>
          ))}

          {/* Notice threshold */}
          <line
            x1={xAt(LEAK_NOTICE_LPM)}
            x2={xAt(LEAK_NOTICE_LPM)}
            y1={CY - 46}
            y2={CY + 46}
            stroke={severityColors.moderate}
            strokeDasharray="3 3"
            strokeWidth={1.2}
          />
          <text
            x={xAt(LEAK_NOTICE_LPM)}
            y={CY - 50}
            fill={severityColors.moderate}
            fontSize={8}
            textAnchor="middle"
            fontFamily="var(--font-family-mono)"
          >
            notice
          </text>

          {/* Whisker */}
          <line
            x1={xAt(dist.whiskerLow as number)}
            x2={xAt(dist.whiskerHigh as number)}
            y1={CY}
            y2={CY}
            stroke={colors.axis}
            strokeWidth={1.4}
          />
          <line
            x1={xAt(dist.whiskerLow as number)}
            x2={xAt(dist.whiskerLow as number)}
            y1={CY - 8}
            y2={CY + 8}
            stroke={colors.axis}
            strokeWidth={1.4}
          />
          <line
            x1={xAt(dist.whiskerHigh as number)}
            x2={xAt(dist.whiskerHigh as number)}
            y1={CY - 8}
            y2={CY + 8}
            stroke={colors.axis}
            strokeWidth={1.4}
          />

          {/* Box */}
          <rect
            x={xAt(dist.p25 as number)}
            y={CY - 18}
            width={xAt(dist.p75 as number) - xAt(dist.p25 as number)}
            height={36}
            rx={2}
            fill={colors.chart5}
            fillOpacity={0.22}
            stroke={colors.chart5}
            strokeWidth={1.4}
          />
          <line
            x1={xAt(dist.p50 as number)}
            x2={xAt(dist.p50 as number)}
            y1={CY - 18}
            y2={CY + 18}
            stroke={colors.chart5}
            strokeWidth={2}
          />
          <text
            x={xAt(dist.p50 as number)}
            y={CY - 24}
            fill={colors.textPrimary}
            fontSize={8.5}
            textAnchor="middle"
            fontFamily="var(--font-family-mono)"
          >
            med {medianText}
          </text>
        </svg>
      )}
    </div>
  );
}

export default LeakSpreadPanel;
