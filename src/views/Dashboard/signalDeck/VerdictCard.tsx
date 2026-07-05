/**
 * Verdict card — the Signal Deck's left anchor.
 *
 * Renders the heuristic **Therapy Index** as a radial ring gauge with the score,
 * a colour-coded qualitative label, four sub-score mini-bars, and a range-summary
 * block that hosts the opt-in AI narrative affordance.
 *
 * ## Honesty rules honoured here
 * - The Therapy Index is a **non-diagnostic heuristic** — a small caption says so
 *   explicitly (this tool does not diagnose).
 * - Empty state is branched on `therapyIndex.nightsUsed === 0`, NOT `score === 0`
 *   (a genuinely poor window can legitimately score 0).
 * - Null sub-scores render as `—`, never as `0`.
 * - The always-visible summary text is **deterministic** (built from real stats);
 *   the ✦ AI affordance is the existing opt-in {@link InsightTrigger}, which is
 *   absent entirely when AI Insights is disabled. No generated text is fabricated.
 *
 * @module views/Dashboard/signalDeck/VerdictCard
 */

import type { AhiSeverity } from '@/analysis/clinical';
import { useChartColors } from '@/components/charts/useChartColors';
import { InsightTrigger } from '@/components/insights';
import type { InsightRequest } from '@/components/insights';

import RingGauge from './RingGauge';
import type { TherapyIndexResult } from './metrics';
import { severityColor, severityVar, useSeverityColors } from './severityTokens';
import styles from './VerdictCard.module.css';

export interface VerdictCardProps {
  /** Composite Therapy Index result for the active window. */
  readonly therapyIndex: TherapyIndexResult;
  /** Clinical severity of the window's pooled AHI (colours the AHI sub-bar). */
  readonly ahiSeverity: AhiSeverity | null;
  /** Deterministic, non-fabricated range summary sentence. */
  readonly narrative: string;
  /** Builds the opt-in AI insight request (lazy; called on trigger click). */
  readonly buildRequest: () => InsightRequest;
}

interface SubBar {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  readonly color: string;
}

export function VerdictCard({
  therapyIndex,
  ahiSeverity,
  narrative,
  buildRequest,
}: VerdictCardProps): JSX.Element {
  const colors = useChartColors();
  const severityColors = useSeverityColors();
  const { score, label, severityForLabel, subscores, nightsUsed } = therapyIndex;

  const hasData = nightsUsed > 0;
  const verdictColor = severityVar(severityForLabel);
  const gaugeColor = hasData ? severityColor(severityColors, severityForLabel) : colors.axis;

  const subBars: SubBar[] = [
    {
      key: 'ahi',
      label: 'AHI',
      value: subscores.ahi,
      color: ahiSeverity ? severityVar(ahiSeverity) : 'var(--color-text-muted)',
    },
    { key: 'adhere', label: 'Adhere', value: subscores.adherence, color: 'var(--color-chart-1)' },
    { key: 'usage', label: 'Usage', value: subscores.usage, color: 'var(--color-chart-6)' },
    { key: 'leak', label: 'Leak', value: subscores.leak, color: 'var(--color-chart-5)' },
  ];

  return (
    <section className={styles.card} aria-label="Therapy Index verdict">
      <div className={styles.top}>
        <div className={styles.gaugeWrap}>
          <RingGauge
            score={score}
            color={gaugeColor}
            trackColor={colors.grid}
            size={150}
            strokeWidth={11}
          />
          <div className={styles.gaugeCenter}>
            <span className={styles.score}>{hasData ? score : '—'}</span>
            <span className={styles.scoreOutOf}>/ 100</span>
          </div>
        </div>

        <div className={styles.verdictText}>
          <div className={styles.eyebrow}>Therapy index</div>
          <div
            className={styles.label}
            style={{ color: hasData ? verdictColor : 'var(--color-text-secondary)' }}
          >
            {hasData ? label : 'No data in range'}
          </div>

          <div className={styles.subBars}>
            {subBars.map((bar) => {
              const pct = bar.value === null ? 0 : Math.max(0, Math.min(100, bar.value));
              return (
                <div key={bar.key} className={styles.subRow}>
                  <span className={styles.subLabel}>{bar.label}</span>
                  <span className={styles.subTrack}>
                    <span
                      className={styles.subFill}
                      style={{ width: `${pct}%`, background: bar.color }}
                    />
                  </span>
                  <span className={styles.subValue}>
                    {bar.value === null ? '—' : Math.round(bar.value)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className={styles.disclaimer}>
        Heuristic at-a-glance summary — not a diagnosis. Read the underlying metrics below.
      </p>

      <div className={styles.narrative}>
        <div className={styles.narrativeHeader}>
          <span className={styles.narrativeEyebrow}>Range summary</span>
          <InsightTrigger
            label="Summarize range"
            ariaLabel="Summarize the selected date range with AI"
            appearance="subtle"
            buildRequest={buildRequest}
          />
        </div>
        <p className={styles.narrativeText}>{narrative}</p>
      </div>
    </section>
  );
}

export default VerdictCard;
