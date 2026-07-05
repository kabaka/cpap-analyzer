/**
 * Verdict card — the Signal Deck's left anchor.
 *
 * Renders the grounded **good-night rate** as a radial ring gauge with the
 * percentage, a colour-coded qualitative band word, a count line, two gate
 * mini-bars (the two conditions a good night must meet), and a range-summary
 * block that hosts the opt-in AI narrative affordance.
 *
 * ## Honesty rules honoured here
 * - The good-night rate is a **grounded, non-diagnostic** count (fraction of
 *   nights clearing two established clinical gates). Its qualitative band word /
 *   colour is an explicitly heuristic presentation layer — a small caption says
 *   the whole thing is a summary, not a diagnosis.
 * - Empty state is branched on `goodNight.assessedNights === 0` (equivalently
 *   `rate === null`), NOT on `rate === 0` — a genuinely poor window can
 *   legitimately score 0 % and must still show its "Low" band, not "No data".
 * - Null gate rates render as `—`, never as `0`.
 * - The always-visible summary text is **deterministic** (built from real stats);
 *   the ✦ AI affordance is the existing opt-in {@link InsightTrigger}, which is
 *   absent entirely when AI Insights is disabled. No generated text is fabricated.
 *
 * @module views/Dashboard/signalDeck/VerdictCard
 */

import { useChartColors } from '@/components/charts/useChartColors';
import { InsightTrigger } from '@/components/insights';
import type { InsightRequest } from '@/components/insights';

import RingGauge from './RingGauge';
import { GOOD_NIGHT_AHI_MAX, GOOD_NIGHT_MIN_HOURS } from './metrics';
import type { GoodNightRateResult } from './metrics';
import { severityColor, severityVar, useSeverityColors } from './severityTokens';
import styles from './VerdictCard.module.css';

export interface VerdictCardProps {
  /** Good-night-rate result for the active window. */
  readonly goodNight: GoodNightRateResult;
  /** Deterministic, non-fabricated range summary sentence. */
  readonly narrative: string;
  /** Builds the opt-in AI insight request (lazy; called on trigger click). */
  readonly buildRequest: () => InsightRequest;
}

interface GateBar {
  readonly key: string;
  readonly label: string;
  /** Pass-rate (%) for this gate over all recorded nights, or `null` (no data). */
  readonly value: number | null;
  readonly color: string;
}

export function VerdictCard({ goodNight, narrative, buildRequest }: VerdictCardProps): JSX.Element {
  const colors = useChartColors();
  const severityColors = useSeverityColors();
  const { rate, goodNights, assessedNights, effectiveRate, adherentRate, label, severityForLabel } =
    goodNight;

  const hasData = assessedNights > 0 && rate !== null;
  const verdictColor = severityForLabel
    ? severityVar(severityForLabel)
    : 'var(--color-text-secondary)';
  const gaugeColor = hasData ? severityColor(severityColors, severityForLabel) : colors.axis;

  // The two gates a good night must clear, each shown as its own pass-rate. These
  // are NOT a composite — they explain the headline without re-introducing one.
  const gateBars: GateBar[] = [
    {
      key: 'effective',
      label: `AHI < ${GOOD_NIGHT_AHI_MAX}`,
      value: effectiveRate,
      color: 'var(--color-chart-1)',
    },
    {
      key: 'adherent',
      label: `Used ≥ ${GOOD_NIGHT_MIN_HOURS}h`,
      value: adherentRate,
      color: 'var(--color-chart-6)',
    },
  ];

  return (
    <section className={styles.card} aria-label="Good-night rate verdict">
      <div className={styles.top}>
        <div className={styles.gaugeWrap}>
          <RingGauge
            score={rate ?? 0}
            color={gaugeColor}
            trackColor={colors.grid}
            size={150}
            strokeWidth={11}
          />
          <div className={styles.gaugeCenter}>
            <span className={styles.score}>{hasData ? `${rate}%` : '—'}</span>
            <span className={styles.scoreOutOf}>of nights</span>
          </div>
        </div>

        <div className={styles.verdictText}>
          <div className={styles.eyebrow}>Good-night rate</div>
          <div
            className={styles.label}
            style={{ color: hasData ? verdictColor : 'var(--color-text-secondary)' }}
          >
            {hasData ? label : 'No data in range'}
          </div>

          {hasData && (
            <div className={styles.count}>
              {goodNights} of {assessedNights} nights
            </div>
          )}

          <div className={styles.subBars}>
            {gateBars.map((bar) => {
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
                    {bar.value === null ? '—' : `${Math.round(bar.value)}%`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className={styles.disclaimer}>
        Nights that were both effective (AHI &lt; {GOOD_NIGHT_AHI_MAX}) and adherent (≥{' '}
        {GOOD_NIGHT_MIN_HOURS}&nbsp;h use). A summary, not a diagnosis.
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
