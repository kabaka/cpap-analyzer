/**
 * TECSA trajectory dumbbell.
 *
 * Reuses the app's existing `tecsa-classification` analysis (early vs late
 * central-apnea index) and the panel's canonical clinical copy
 * ({@link tecsaPresentation}) — this component invents NO new clinical claims.
 * It draws a dumbbell (early ● → late ●) on a CAI axis with a dashed referral
 * reference at the classifier's `caiThreshold`.
 *
 * Per ADR 0017 and the Breathing-stability visual spec, TECSA is a trajectory,
 * not an alarm: the register is the calm violet `--color-detection`, never
 * status-severe red. The referral reference is drawn neutral (muted), labelled
 * with its value so it is not colour-only.
 *
 * @module views/Dashboard/signalDeck/TecsaDumbbell
 */

import { Link } from 'react-router-dom';

import type { TecsaClassification } from '@/analysis/breathing';
import { tecsaPresentation } from '@/analysis/breathing';
import { useAnalysis } from '@/hooks/useAnalysis';
import { useChartColors } from '@/components/charts/useChartColors';

import styles from './TecsaDumbbell.module.css';

export interface TecsaDumbbellProps {
  /** External loading flag; when true the deck is still hydrating. */
  readonly loading?: boolean;
  /**
   * Window over which to classify the trajectory. TECSA is an inherently
   * long-horizon comparison (early window vs a late window ≥13 weeks later), so
   * the deck passes the WIDENED trailing-12-month range here rather than the
   * 30/90D toggle window — scoping to the toggle would artificially suppress
   * classification and leave the dumbbell empty.
   */
  readonly dateRange?: { start: Date; end: Date };
}

const LINK = '/explore/breathing';
const VB_W = 300;
const VB_H = 70;
const AXIS_MAX = 6;
const LEFT = 44;
const RIGHT = 36;

export function TecsaDumbbell({
  loading: externalLoading = false,
  dateRange,
}: TecsaDumbbellProps): JSX.Element {
  const colors = useChartColors();
  const { data, loading, error } = useAnalysis<TecsaClassification>({
    type: 'tecsa-classification',
    dateRange,
    enabled: !externalLoading,
  });

  const isLoading = externalLoading || loading;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>TECSA trajectory</h2>
        {data?.available && data.class && <span className={styles.candidate}>candidate</span>}
      </div>
      <p className={styles.subtitle}>central index · early → late · up to 12 mo</p>

      {isLoading ? (
        <p className={styles.copy}>Computing trajectory classification…</p>
      ) : error ? (
        <p className={styles.copy}>{error}</p>
      ) : !data || !data.available || !data.class ? (
        <>
          <p className={styles.copy}>
            Insufficient history to classify the TECSA trajectory ({data?.earlyNights ?? 0} early /{' '}
            {data?.lateNights ?? 0} usable late nights in range).
          </p>
          <Link to={LINK} className={styles.link}>
            Open Breathing patterns →
          </Link>
        </>
      ) : (
        <Dumbbell data={data} colors={colors} />
      )}
    </div>
  );
}

interface DumbbellProps {
  readonly data: TecsaClassification;
  readonly colors: ReturnType<typeof useChartColors>;
}

function Dumbbell({ data, colors }: DumbbellProps): JSX.Element {
  const presentation = tecsaPresentation(data.class as NonNullable<TecsaClassification['class']>);
  const innerW = VB_W - LEFT - RIGHT;
  const xAt = (v: number): number => LEFT + (Math.min(v, AXIS_MAX) / AXIS_MAX) * innerW;
  const cy = 36;

  return (
    <>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Central apnea index moved from ${data.earlyCai.toFixed(1)} early to ${data.lateCai.toFixed(1)} late events per hour; referral reference ${data.caiThreshold.toFixed(1)}.`}
        className={styles.chart}
      >
        {/* Axis track */}
        <line
          x1={LEFT}
          x2={VB_W - RIGHT}
          y1={cy}
          y2={cy}
          stroke={colors.grid}
          strokeWidth={8}
          strokeLinecap="round"
        />
        {[0, 2, 4, 6].map((t) => (
          <text
            key={t}
            x={xAt(t)}
            y={cy + 24}
            fill={colors.axis}
            fontSize={8}
            textAnchor="middle"
            fontFamily="var(--font-family-mono)"
          >
            {t}
          </text>
        ))}
        <text
          x={LEFT}
          y={14}
          fill={colors.textSecondary}
          fontSize={8.5}
          fontFamily="var(--font-family-mono)"
        >
          CAI
        </text>

        {/* Referral reference (neutral, not an alarm colour) */}
        <line
          x1={xAt(data.caiThreshold)}
          x2={xAt(data.caiThreshold)}
          y1={cy - 20}
          y2={cy + 12}
          stroke={colors.axis}
          strokeDasharray="3 3"
          strokeWidth={1.2}
        />
        <text
          x={xAt(data.caiThreshold)}
          y={cy - 24}
          fill={colors.axis}
          fontSize={8}
          textAnchor="middle"
          fontFamily="var(--font-family-mono)"
        >
          referral {data.caiThreshold.toFixed(0)}/h
        </text>

        {/* Dumbbell early → late */}
        <line
          x1={xAt(data.earlyCai)}
          x2={xAt(data.lateCai)}
          y1={cy}
          y2={cy}
          stroke={colors.detection}
          strokeWidth={8}
          strokeLinecap="round"
        />
        <circle cx={xAt(data.earlyCai)} cy={cy} r={7} fill={colors.axis} />
        <circle
          cx={xAt(data.lateCai)}
          cy={cy}
          r={8}
          fill={colors.detection}
          stroke={colors.surfaceElevated}
          strokeWidth={1.5}
        />
      </svg>
      <div className={styles.marks}>
        <span>early {data.earlyCai.toFixed(1)}/h</span>
        <span className={styles.markLate}>late {data.lateCai.toFixed(1)}/h</span>
      </div>
      <p className={styles.copy}>{presentation.explainer}</p>
      <Link to={LINK} className={styles.link}>
        Open Breathing patterns →
      </Link>
    </>
  );
}

export default TecsaDumbbell;
