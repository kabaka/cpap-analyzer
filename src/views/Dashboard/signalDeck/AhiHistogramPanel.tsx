/**
 * AHI distribution histogram.
 *
 * Bins nightly AHI via {@link ahiHistogram} (only non-null nights are counted —
 * null AHI is a gap, never `0`). Bars are coloured by the clinical severity of
 * their bin, and dashed separators mark the severity-band boundaries, so the
 * severity encoding is redundant with bar position (never colour-only). The
 * subtitle reports the median of the binned values.
 *
 * @module views/Dashboard/signalDeck/AhiHistogramPanel
 */

import { useChartColors } from '@/components/charts/useChartColors';
import type { NightlyAggregate } from '@/types';

import { ahiHistogram } from './metrics';
import { severityColor, useSeverityColors } from './severityTokens';
import styles from './DistributionsRow.module.css';

export interface AhiHistogramPanelProps {
  readonly aggregates: readonly NightlyAggregate[];
}

const VB_W = 300;
const VB_H = 160;
const PAD = { left: 8, right: 8, top: 8, bottom: 22 };

export function AhiHistogramPanel({ aggregates }: AhiHistogramPanelProps): JSX.Element {
  const colors = useChartColors();
  const severityColors = useSeverityColors();
  const { bins, median, n } = ahiHistogram(aggregates);

  const innerW = VB_W - PAD.left - PAD.right;
  const innerH = VB_H - PAD.top - PAD.bottom;
  const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 1);
  const barW = innerW / bins.length;
  const axisColor = colors.axis;

  const medianText = median === null ? '—' : median.toFixed(1);

  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>AHI distribution</h2>
      <p className={styles.subtitle}>nights per bin · median {medianText}</p>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`AHI distribution histogram over ${n} nights, median ${medianText} events per hour`}
        className={styles.chart}
      >
        {bins.map((bin, i) => {
          const barH = (bin.count / maxCount) * innerH;
          const x = PAD.left + i * barW;
          const y = PAD.top + innerH - barH;
          // Severity-band separator: dashed line where the class changes.
          const prev = bins[i - 1];
          const boundary = prev && prev.severity !== bin.severity;
          const edgeLabel = Number.isFinite(bin.hi) ? String(bin.lo) : `${bin.lo}+`;
          return (
            <g key={`${bin.lo}-${bin.hi}`}>
              {boundary && (
                <line
                  x1={x}
                  x2={x}
                  y1={PAD.top}
                  y2={PAD.top + innerH}
                  stroke={colors.grid}
                  strokeDasharray="2 3"
                  strokeWidth={1}
                />
              )}
              {bin.count > 0 && (
                <rect
                  x={x + 2}
                  y={y}
                  width={Math.max(0, barW - 4)}
                  height={barH}
                  rx={1}
                  fill={severityColor(severityColors, bin.severity)}
                />
              )}
              <text
                x={x + barW / 2}
                y={VB_H - 6}
                fill={axisColor}
                fontSize={8}
                textAnchor="middle"
                fontFamily="var(--font-family-mono)"
              >
                {edgeLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default AhiHistogramPanel;
