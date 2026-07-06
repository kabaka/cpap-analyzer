/**
 * Session Detail view — comprehensive single-night analysis (redesigned).
 *
 * Layout (top → bottom):
 *  - Header bar: breadcrumb, date title, mono time range, machine meta, and the
 *    Prev/Next-night + Export-report actions.
 *  - Hero: a 300px "Night assessment" verdict card (two-gate, NON-composite —
 *    see ADR 0031) hosting the two opt-in AI insight triggers in its narrative
 *    header, beside a 3-column KPI grid with trailing-baseline deltas + sparklines.
 *  - Signals: the embedded {@link CompactSignalViewer}.
 *  - Events row: respiratory-event breakdown + expandable event clusters.
 *  - Session statistics: pressure / ventilation / leak / oxygenation groups.
 *  - Physiology row (gated): Fitbit sleep stages, Fitbit physiology, weather.
 *  - Footer: non-diagnostic disclaimer + "Raw data →".
 *
 * ## Honest gaps, never fabricated zeros
 * Every value is mapped to REAL data. A `null` metric renders as an em dash
 * ("—"), NEVER as `0`. Cards that depend on absent integrations (Fitbit /
 * weather) are omitted or shown as a subtle CTA — they never invent numbers.
 *
 * The nested Signal Viewer child route is preserved via `<Outlet />`.
 *
 * @module views/Sessions/SessionDetail
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useMatch, useNavigate, useParams } from 'react-router-dom';

import { Badge, Button, Skeleton } from '@/components/ui';
import { AqiSwatch } from '@/components/domain/weather';
import { EventTypeSwatch } from '@/components/events/EventTypeSwatch';
import { EVENT_TYPE_META, eventLabel } from '@/components/events/eventTypeMeta';
import { useChartColors } from '@/components/charts/useChartColors';
import {
  InsightTrigger,
  buildClinicalContextInput,
  buildGroundingCommon,
  buildSingleNightInput,
  machineClassOf,
  nightScopeLabel,
} from '@/components/insights';
import type { InsightRequest } from '@/components/insights';

import {
  AHI_SEVERITY_THRESHOLDS,
  RECOMMENDED_USAGE_HOURS,
  classifyAhiSeverity,
  type AhiSeverity,
} from '@/analysis/clinical';
import { formatMetric } from '@/analysis/uncertainty';
import { convertTemperature } from '@/analysis/weather/units';

import { useSessionDetail, useEventData } from '@/hooks/useSignalData';
import { useNightlyAggregates } from '@/hooks/useNightlyAggregates';
import { useSessionData } from '@/hooks/useSessionData';
import { useWearableSummary } from '@/hooks/useWearableSummary';
import { useWearableDayData } from '@/hooks/useWearableData';
import { useWeatherNightly } from '@/hooks/useWeatherNightly';
import { useSettingsStore } from '@/stores/useSettingsStore';

import { parseLocalDate } from '@/utils/formatDate';
import type { Event, MachineType, NightlyAggregate, Session } from '@/types';
import type {
  FitbitHRVDaily,
  FitbitRestingHeartRate,
  FitbitSleepSession,
  FitbitSpO2Daily,
} from '@/types/fitbit';

import Sparkline from '@/views/Dashboard/signalDeck/Sparkline';
import { severityLabel, severityVar } from '@/views/Dashboard/signalDeck/severityTokens';

import CompactSignalViewer from './CompactSignalViewer';
import { formatClockTime } from './hoverReadout';
import { sessionDateKey, sessionWallClockEpoch } from './signalLanes';
import {
  assessNight,
  baselineDelta,
  centralFraction,
  componentStatuses,
  longestApnea,
  respiratoryBreakdown,
  sessionClusters,
  type ClusterSummary,
  type ComponentStatus,
  type SessionClustersResult,
} from './sessionAssessment';
import styles from './SessionDetail.module.css';

// ── Constants ────────────────────────────────────────────────────

/** Trailing window (nights) for the "vs 30-night" baseline + KPI sparklines. */
const BASELINE_WINDOW_DAYS = 35;

/** Minimum prior nights required before we render a baseline delta (never a fake 0). */
const MIN_PRIOR_NIGHTS = 3;

/** Human-readable labels for machine therapy modes. */
const MACHINE_TYPE_LABELS: Record<MachineType, string> = {
  cpap: 'CPAP',
  apap: 'APAP',
  bipap: 'BiPAP',
  vpap: 'VPAP',
  asv: 'ASV',
};

// ── Formatting helpers ───────────────────────────────────────────

/** Format a `YYYY-MM-DD` date to a long, human-friendly form. */
function formatDateLong(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format a number to a fixed decimal string, honouring the honesty rule:
 * `null`/`undefined`/`NaN` render as an em dash, never as `0`.
 */
function fmt(value: number | null | undefined, decimals = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(decimals);
}

/** Format minutes to `Xh Ym` (or `Ym` under an hour). */
function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

/** Whether this machine type carries bilevel (EPAP/IPAP/PS) pressure data. */
function isBilevel(type: MachineType): boolean {
  return type === 'bipap' || type === 'vpap' || type === 'asv';
}

/** AHI severity → Badge variant. */
function ahiBadgeVariant(severity: AhiSeverity): 'success' | 'warning' | 'danger' {
  switch (severity) {
    case 'normal':
      return 'success';
    case 'mild':
    case 'moderate':
      return 'warning';
    default:
      return 'danger';
  }
}

// ── Deterministic narrative (factual, non-diagnostic) ────────────

/**
 * Build a short, deterministic one-line narrative from real numbers only.
 * Factual and non-diagnostic (mirrors `SignalDeck.buildNarrative`): it restates
 * already-computed metrics and names no condition. Null clauses are dropped.
 */
function buildSessionNarrative(aggregate: NightlyAggregate): string {
  const clauses: string[] = [];
  clauses.push(
    aggregate.ahi != null
      ? `AHI ${aggregate.ahi.toFixed(1)}/h over ${aggregate.usageHours.toFixed(1)} h of use`
      : `${aggregate.usageHours.toFixed(1)} h of use (AHI undefined — recording too short for a rate)`,
  );
  if (Number.isFinite(aggregate.leakMedian)) {
    clauses.push(`median leak ${aggregate.leakMedian.toFixed(1)} L/min`);
  }
  if (Number.isFinite(aggregate.pressureP95)) {
    clauses.push(`95th-percentile pressure ${aggregate.pressureP95.toFixed(1)} cmH₂O`);
  }
  return `${clauses.join('; ')}.`;
}

// ── Night assessment (verdict) card ──────────────────────────────

/**
 * Pass/fail state of a single good-night gate. `unknown` is used only for the
 * Effective gate when AHI is `null` (cannot confirm), and is treated as NOT
 * passing — never as a pass.
 */
type GateState = 'pass' | 'fail' | 'unknown';

/** Map a gate state to its glyph (paired with sr-only text — never colour-only). */
function gateGlyph(state: GateState): string {
  if (state === 'pass') return '✓';
  if (state === 'unknown') return '?';
  return '✗';
}

/** Human-readable gate outcome for the accessible name (WCAG 1.4.1). */
function gateStateText(state: GateState): string {
  if (state === 'pass') return 'passed';
  if (state === 'unknown') return 'cannot confirm';
  return 'not passing';
}

interface NightAssessmentCardProps {
  readonly aggregate: NightlyAggregate;
  readonly buildNightRequest: () => InsightRequest;
  readonly buildClinicalRequest: () => InsightRequest;
}

function ComponentStrip({ statuses }: { statuses: readonly ComponentStatus[] }): JSX.Element {
  return (
    <div className={styles.componentStrip}>
      {statuses.map((c) => (
        <div key={c.key} className={styles.componentSegmentWrap}>
          <span
            className={styles.componentSegment}
            style={{
              background: c.severity ? severityVar(c.severity) : 'var(--color-border-emphasis)',
            }}
            aria-hidden="true"
          />
          <span className={styles.componentLabel}>{c.label}</span>
          <span className={styles.componentSeverity}>
            {c.severity ? severityLabel(c.severity) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

function NightAssessmentCard({
  aggregate,
  buildNightRequest,
  buildClinicalRequest,
}: NightAssessmentCardProps): JSX.Element {
  const verdict = assessNight(aggregate);
  const statuses = componentStatuses(aggregate);

  // Two independent, discrete gates — NOT a 0–100 composite score (ADR 0031).
  const effectiveState: GateState =
    verdict.effective === null ? 'unknown' : verdict.effective ? 'pass' : 'fail';
  const adherentState: GateState = verdict.adherent ? 'pass' : 'fail';
  const gatesPassed = (verdict.effective === true ? 1 : 0) + (verdict.adherent ? 1 : 0);
  const verdictVar = severityVar(verdict.severityForVerdict);

  return (
    <section className={styles.verdictCard} aria-label="Night assessment">
      <div className={styles.verdictHead}>
        {/* Discrete two-gate hero: one pip per gate (pass/fail/cannot-confirm),
            NOT a continuous ring implying a composite score (ADR 0031). */}
        <div
          className={styles.gateHero}
          role="img"
          aria-label={
            `Verdict: ${verdict.verdictWord}. ${gatesPassed} of 2 gates passed. ` +
            `Effective gate ${gateStateText(effectiveState)}. ` +
            `Adherent gate ${gateStateText(adherentState)}.`
          }
        >
          <span className={styles.verdictWord} style={{ color: verdictVar }}>
            {verdict.verdictWord}
          </span>
          <div className={styles.gatePips} aria-hidden="true">
            <span className={styles.gatePip} data-state={effectiveState}>
              <span className={styles.gatePipGlyph}>{gateGlyph(effectiveState)}</span>
              <span className={styles.gatePipLabel}>Effective</span>
            </span>
            <span className={styles.gatePip} data-state={adherentState}>
              <span className={styles.gatePipGlyph}>{gateGlyph(adherentState)}</span>
              <span className={styles.gatePipLabel}>Adherent</span>
            </span>
          </div>
          <span className={styles.verdictGates}>{gatesPassed} of 2 gates</span>
        </div>
        <div className={styles.verdictText}>
          <div className={styles.verdictEyebrow}>Night assessment</div>
          <ul className={styles.gateList}>
            <li className={styles.gateRow}>
              <span className={styles.gateIcon} data-state={effectiveState} aria-hidden="true">
                {gateGlyph(effectiveState)}
              </span>
              <span className={styles.gateText}>
                <span className={styles.gateName}>
                  Effective
                  <span className={styles.srOnly}> — {gateStateText(effectiveState)}</span>
                </span>
                <span className={styles.gateDetail}>AHI {fmt(verdict.ahi)} (target &lt;5)</span>
              </span>
            </li>
            <li className={styles.gateRow}>
              <span className={styles.gateIcon} data-state={adherentState} aria-hidden="true">
                {gateGlyph(adherentState)}
              </span>
              <span className={styles.gateText}>
                <span className={styles.gateName}>
                  Adherent
                  <span className={styles.srOnly}> — {gateStateText(adherentState)}</span>
                </span>
                <span className={styles.gateDetail}>
                  {verdict.usageHours.toFixed(1)} h used (≥4 h)
                </span>
                <span className={styles.gateNote}>
                  ≥4 h is the CMS compliance minimum, not a clinical optimum (
                  {RECOMMENDED_USAGE_HOURS}
                  {' h+ recommended).'}
                </span>
              </span>
            </li>
          </ul>
        </div>
      </div>

      <p className={styles.verdictNarrativeText}>{buildSessionNarrative(aggregate)}</p>

      <ComponentStrip statuses={statuses} />

      <p className={styles.verdictCaption}>A summary, not a diagnosis.</p>

      <div className={styles.verdictAiRow}>
        <span className={styles.verdictAiLabel}>Explain</span>
        <div className={styles.verdictAiTriggers}>
          <InsightTrigger
            label="Summarize night"
            ariaLabel="Summarize this night with AI"
            appearance="subtle"
            buildRequest={buildNightRequest}
          />
          <InsightTrigger
            label="Clinical context"
            ariaLabel="Explain this night's compliance and severity context with AI"
            appearance="subtle"
            buildRequest={buildClinicalRequest}
          />
        </div>
      </div>
    </section>
  );
}

// ── KPI grid ─────────────────────────────────────────────────────

type KpiPolarity = 'lower' | 'higher' | 'neutral';

interface KpiCardProps {
  readonly label: string;
  readonly value: number | null;
  readonly decimals: number;
  readonly unit: string;
  readonly polarity: KpiPolarity;
  /** Trailing series (oldest → newest, incl. current) for the sparkline. */
  readonly series: readonly (number | null)[];
  /** Count of finite prior nights (delta suppressed below MIN_PRIOR_NIGHTS). */
  readonly priorCount: number;
  readonly delta: number | null;
  readonly direction: 'up' | 'down' | 'unchanged';
  readonly sparkColor: string;
  readonly badge?:
    | {
        readonly text: string;
        readonly variant: 'success' | 'warning' | 'danger' | 'info' | 'default';
      }
    | undefined;
}

function KpiCard(props: KpiCardProps): JSX.Element {
  const {
    label,
    value,
    decimals,
    unit,
    polarity,
    series,
    priorCount,
    delta,
    direction,
    sparkColor,
    badge,
  } = props;

  const showDelta = delta != null && direction !== 'unchanged' && priorCount >= MIN_PRIOR_NIGHTS;

  // Judge favourability for colour + the accessible label; never colour-only.
  let deltaColor = 'var(--color-text-muted)';
  let judgement: 'favorable' | 'unfavorable' | 'neutral' = 'neutral';
  if (showDelta && polarity !== 'neutral') {
    const good = (direction === 'down') === (polarity === 'lower');
    judgement = good ? 'favorable' : 'unfavorable';
    deltaColor = good ? 'var(--color-status-normal)' : 'var(--color-status-severe)';
  }
  const arrow = direction === 'up' ? '▲' : '▼';
  const directionWord = direction === 'up' ? 'increased' : 'decreased';
  // Carry BOTH direction and favourability into the accessible name so an AT
  // user learns which way the metric moved and whether that is good/bad — colour
  // and the ▲/▼ glyph are never the sole signal (WCAG 1.4.1).
  const deltaSrText =
    judgement === 'neutral' ? `${directionWord} — ` : `${directionWord}, ${judgement} — `;

  return (
    <div className={styles.kpiCard}>
      <div className={styles.kpiHead}>
        <span className={styles.kpiLabel}>{label}</span>
        {badge ? (
          <Badge variant={badge.variant} size="sm">
            {badge.text}
          </Badge>
        ) : null}
      </div>
      <div className={styles.kpiValueRow}>
        <span className={styles.kpiValue}>{fmt(value, decimals)}</span>
        <span className={styles.kpiUnit}>{unit}</span>
      </div>
      <div className={styles.kpiFoot}>
        {showDelta ? (
          <span
            className={styles.kpiDelta}
            style={{ color: deltaColor }}
            title={`${judgement === 'neutral' ? 'Changed' : judgement} versus the trailing 30-night baseline`}
          >
            <span className={styles.srOnly}>{deltaSrText}</span>
            <span aria-hidden="true">{arrow}</span> {Math.abs(delta as number).toFixed(decimals)}{' '}
            <span className={styles.kpiDeltaMuted}>vs 30-night</span>
          </span>
        ) : (
          <span className={styles.kpiDeltaMuted}>
            {priorCount > 0 ? 'baseline building' : 'no baseline yet'}
          </span>
        )}
        <span className={styles.kpiSpark}>
          <Sparkline values={series} color={sparkColor} width={96} height={26} fill />
        </span>
      </div>
    </div>
  );
}

// ── Respiratory events card ──────────────────────────────────────

interface RespiratoryEventsCardProps {
  readonly aggregate: NightlyAggregate;
  readonly events: readonly Event[];
  readonly wallClockEpoch: number;
  readonly sessionStart: number;
}

function RespiratoryEventsCard({
  aggregate,
  events,
  wallClockEpoch,
  sessionStart,
}: RespiratoryEventsCardProps): JSX.Element {
  const components = respiratoryBreakdown(aggregate);
  const maxCount = components.reduce((m, c) => Math.max(m, c.count), 0);
  const la = longestApnea(events);
  const central = centralFraction(aggregate);
  const reraCount = aggregate.eventsByType.rera;
  const flgCount = aggregate.eventsByType.flowLimitation;
  // Non-diagnostic call-out on the canonical CAI convention (central AHI ≥ 5/h,
  // the mild boundary) — elevated central activity, not an arbitrary fraction cut.
  const centralElevated =
    aggregate.ahiCentral != null && aggregate.ahiCentral >= AHI_SEVERITY_THRESHOLDS.mild;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Respiratory events</h2>
        <span className={styles.panelCount}>{aggregate.eventCount} total</span>
      </div>

      <div className={styles.respBars}>
        {components.map((c) => {
          const widthPct = maxCount > 0 ? (c.count / maxCount) * 100 : 0;
          const color = EVENT_TYPE_META[c.type]?.color ?? 'var(--color-text-muted)';
          return (
            <div key={c.type} className={styles.respRow}>
              <span className={styles.respLabel}>
                <EventTypeSwatch type={c.type} />
                <span className={styles.respLabelText}>{c.label}</span>
              </span>
              <span className={styles.respTrack}>
                <span
                  className={styles.respFill}
                  style={{ width: `${widthPct}%`, background: color }}
                  aria-hidden="true"
                />
              </span>
              <span className={styles.respStat}>
                <span className={styles.respRate}>
                  {c.ratePerHour != null ? `${c.ratePerHour.toFixed(1)}/h` : '—'}
                </span>
                <span className={styles.respCount}>{c.count} events</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className={styles.miniGrid}>
        <div className={styles.miniStat}>
          <span className={styles.miniLabel}>Longest apnea</span>
          <span className={styles.miniValue}>{la ? `${la.durationSec.toFixed(0)}s` : '—'}</span>
          <span className={styles.miniSub}>
            {la
              ? `${eventLabel(la.type)} · ${formatClockTime(wallClockEpoch, la.timestamp - sessionStart)}`
              : 'No apneas scored'}
          </span>
        </div>
        <div className={styles.miniStat}>
          <span className={styles.miniLabel}>Central fraction</span>
          <span className={styles.miniValue}>
            {central != null ? `${(central * 100).toFixed(0)}%` : '—'}
          </span>
          <span className={styles.miniSub}>
            {central == null ? (
              'Needs ≥20 apneas to report'
            ) : centralElevated ? (
              <>
                Elevated central activity (CAI ≥ 5/h) —{' '}
                <Link to="/explore/breathing" className={styles.miniLink}>
                  Breathing patterns
                </Link>
              </>
            ) : (
              'Share of apneas that were central'
            )}
          </span>
        </div>
        <div className={styles.miniStat}>
          <span className={styles.miniLabel}>RERA</span>
          <span className={styles.miniValue}>{reraCount}</span>
          <span className={styles.miniSub}>Respiratory-effort arousals</span>
        </div>
        <div className={styles.miniStat}>
          <span className={styles.miniLabel}>Flow limitation</span>
          <span className={styles.miniValue}>{flgCount}</span>
          <span className={styles.miniSub}>Flagged FLG events</span>
        </div>
      </div>
    </div>
  );
}

// ── Event clusters card ──────────────────────────────────────────

/**
 * Relative intensity band for a cluster's severity score, scaled WITHIN this
 * night (densest cluster = highest). This is an explicitly relative, heuristic
 * presentation cue — NOT a clinical severity — always paired with the numeric
 * score and a word label so colour is never the sole signal.
 */
function relativeBand(score: number, maxScore: number): { severity: AhiSeverity; word: string } {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.66) return { severity: 'severe', word: 'High' };
  if (ratio >= 0.33) return { severity: 'moderate', word: 'Medium' };
  return { severity: 'mild', word: 'Low' };
}

interface EventClustersCardProps {
  /** Shared, memoized clustering result (computed once in the parent). */
  readonly clusters: SessionClustersResult;
  readonly wallClockEpoch: number;
  readonly sessionStart: number;
  readonly onFocusCluster: (offsetMs: number) => void;
}

function EventClustersCard({
  clusters: clustersResult,
  wallClockEpoch,
  sessionStart,
  onFocusCluster,
}: EventClustersCardProps): JSX.Element {
  const { clusters, summaries } = clustersResult;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const maxScore = summaries.reduce((m, s) => Math.max(m, s.severityScore), 0);

  const clusterEvents = useMemo(() => {
    const map = new Map<string, readonly Event[]>();
    for (const c of clusters) map.set(c.id, c.events);
    return map;
  }, [clusters]);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Event clusters</h2>
        <span className={styles.panelCount}>{summaries.length} clusters</span>
      </div>

      {summaries.length === 0 ? (
        <p className={styles.panelEmpty}>
          No clustered runs of events — events were isolated across the night.
        </p>
      ) : (
        <ul className={styles.clusterList}>
          {summaries.map((s: ClusterSummary) => {
            const band = relativeBand(s.severityScore, maxScore);
            const expanded = expandedId === s.id;
            const startClock = formatClockTime(wallClockEpoch, s.startTime - sessionStart);
            const endClock = formatClockTime(wallClockEpoch, s.endTime - sessionStart);
            const evs = clusterEvents.get(s.id) ?? [];
            return (
              <li key={s.id} className={styles.clusterItem}>
                <button
                  type="button"
                  className={styles.clusterHeader}
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : s.id)}
                >
                  <span className={styles.clusterChevron} aria-hidden="true">
                    {expanded ? '▾' : '▸'}
                  </span>
                  <span className={styles.clusterWindow}>
                    {startClock} – {endClock}
                  </span>
                  <span className={styles.clusterMeta}>
                    {s.eventCount} events · {s.density.toFixed(1)}/min
                  </span>
                  <span
                    className={styles.clusterBadge}
                    style={{ color: severityVar(band.severity) }}
                  >
                    <span
                      className={styles.clusterDot}
                      style={{ background: severityVar(band.severity) }}
                      aria-hidden="true"
                    />
                    {band.word} · {s.severityScore.toFixed(0)}
                  </span>
                </button>
                {expanded && (
                  <div className={styles.clusterBody}>
                    <ul className={styles.clusterEvents}>
                      {evs.map((e) => (
                        <li key={e.id} className={styles.clusterEventRow}>
                          <span className={styles.clusterEventTime}>
                            {formatClockTime(wallClockEpoch, e.timestamp - sessionStart)}
                          </span>
                          <span className={styles.clusterEventType}>
                            <EventTypeSwatch type={e.type} />
                            <span>{eventLabel(e.type)}</span>
                          </span>
                          <span className={styles.clusterEventDuration}>
                            {e.duration.toFixed(1)}s
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onFocusCluster(s.startTime - sessionStart)}
                    >
                      View in signal viewer
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.panelCaption}>
        Severity = cluster duration × event density. Intensity bands are relative to this night.
      </p>
    </div>
  );
}

// ── Session statistics card ──────────────────────────────────────

interface StatRow {
  readonly label: string;
  readonly value: string;
}

function StatGroup({ title, rows }: { title: string; rows: readonly StatRow[] }): JSX.Element {
  return (
    <div className={styles.statGroup}>
      <h3 className={styles.statGroupTitle}>{title}</h3>
      <dl className={styles.statList}>
        {rows.map((r) => (
          <div key={r.label} className={styles.statRow}>
            <dt className={styles.statLabel}>{r.label}</dt>
            <dd className={styles.statValue}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * A few aggregate metrics are deliberately NOT surfaced here. These are honest
 * PRESENTATION choices, not ResMed data limitations:
 *  - Flow-limitation median — omitted because it has no validated absolute scale
 *    (the flag count is shown instead).
 *  - T90 in minutes — not currently computed (it is bounded by SpO₂ coverage);
 *    "% of night <90%" is shown instead.
 *  - Largest-leak timestamp — a single instantaneous maximum is noise-prone, so
 *    it is not shown (leak 95th-percentile / max magnitudes are shown instead).
 */
function StatisticsCard({
  aggregate,
  session,
  sleepEfficiency,
}: {
  aggregate: NightlyAggregate;
  session: Session;
  sleepEfficiency: number | null;
}): JSX.Element {
  const bilevel = isBilevel(session.machineType);

  const pressureRows: StatRow[] = [
    { label: 'Mean', value: fmt(aggregate.pressureMean) },
    { label: 'Median', value: fmt(aggregate.pressureMedian) },
    { label: '95th %ile', value: fmt(aggregate.pressureP95) },
    { label: 'Max', value: fmt(aggregate.pressureMax) },
  ];
  if (aggregate.epapMedian != null) {
    pressureRows.push({ label: 'Median EPAP', value: fmt(aggregate.epapMedian) });
  }
  if (bilevel && aggregate.ipapMedian != null) {
    pressureRows.push({ label: 'Median IPAP', value: fmt(aggregate.ipapMedian) });
  }
  if (bilevel && aggregate.pressureSupport != null) {
    pressureRows.push({ label: 'Pressure support', value: fmt(aggregate.pressureSupport) });
  }

  const ventilationRows: StatRow[] = [
    {
      label: 'Tidal volume',
      value:
        aggregate.tidalVolumeMedian != null ? `${fmt(aggregate.tidalVolumeMedian, 0)} mL` : '—',
    },
    {
      label: 'Minute vent.',
      value: aggregate.minuteVentMean != null ? `${fmt(aggregate.minuteVentMean)} L/m` : '—',
    },
    {
      label: 'Resp. rate',
      value: aggregate.respRateMedian != null ? `${fmt(aggregate.respRateMedian, 0)} br/m` : '—',
    },
    { label: 'Flow limitation', value: `${aggregate.eventsByType.flowLimitation} events` },
  ];

  const leakRows: StatRow[] = [
    { label: 'Median', value: `${fmt(aggregate.leakMedian)} L/m` },
    { label: '95th %ile', value: `${fmt(aggregate.leakP95)} L/m` },
    { label: 'Max', value: `${fmt(aggregate.leakMax)} L/m` },
    { label: 'Time >24 L/m', value: formatDuration(aggregate.leakDurationMinutes) },
    { label: 'Episodes', value: `${aggregate.eventsByType.largeLeak}` },
  ];

  const oxyRows: StatRow[] = [];
  if (session.hasOximetry) {
    oxyRows.push(
      {
        label: 'SpO₂ mean',
        value: aggregate.spo2Mean != null ? `${fmt(aggregate.spo2Mean)}%` : '—',
      },
      {
        label: 'SpO₂ nadir',
        value: aggregate.spo2Min != null ? `${fmt(aggregate.spo2Min, 0)}%` : '—',
      },
      { label: 'ODI', value: fmt(aggregate.oxygenDesaturationIndex) },
      {
        label: '% of night <90%',
        value:
          aggregate.spo2Below90Percent != null
            ? `${formatMetric('spo2', aggregate.spo2Below90Percent)}%`
            : '—',
      },
      {
        label: 'Coverage',
        value:
          aggregate.spo2CoveragePercent != null
            ? `${aggregate.spo2CoveragePercent.toFixed(0)}%`
            : '—',
      },
    );
  }
  if (sleepEfficiency != null) {
    oxyRows.push({ label: 'Sleep efficiency', value: `${sleepEfficiency.toFixed(0)}%` });
  }
  if (oxyRows.length === 0) {
    oxyRows.push({ label: 'Oximetry', value: '— (none recorded)' });
  }

  return (
    <div className={styles.statsCard}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Session statistics</h2>
        <Badge variant="info" size="sm">
          {session.machineSettings?.therapyMode ?? MACHINE_TYPE_LABELS[session.machineType]}
        </Badge>
      </div>
      <div className={styles.statsGrid}>
        <StatGroup title="Pressure (cmH₂O)" rows={pressureRows} />
        <StatGroup title="Ventilation" rows={ventilationRows} />
        <StatGroup title="Leak" rows={leakRows} />
        <StatGroup title="Oxygenation & sleep" rows={oxyRows} />
      </div>
    </div>
  );
}

// ── Physiology row cards (gated) ─────────────────────────────────

const SLEEP_STAGE_META: readonly {
  readonly key: keyof FitbitSleepSession['stages'];
  readonly label: string;
  readonly colorVar: string;
}[] = [
  { key: 'deep', label: 'Deep', colorVar: 'var(--color-hypno-deep)' },
  { key: 'light', label: 'Light', colorVar: 'var(--color-hypno-light)' },
  { key: 'rem', label: 'REM', colorVar: 'var(--color-hypno-rem)' },
  { key: 'wake', label: 'Awake', colorVar: 'var(--color-hypno-wake)' },
];

function SleepStagesCard({ sleep }: { sleep: FitbitSleepSession }): JSX.Element {
  const { deep, light, rem, wake } = sleep.stages;
  const total = deep + light + rem + wake;
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Sleep stages</h2>
        <Badge variant="info" size="sm">
          Fitbit
        </Badge>
      </div>
      <div className={styles.stageBar} aria-hidden="true">
        {SLEEP_STAGE_META.map((s) => {
          const minutes = sleep.stages[s.key];
          const pct = total > 0 ? (minutes / total) * 100 : 0;
          return (
            <span
              key={s.key}
              className={styles.stageSeg}
              style={{ width: `${pct}%`, background: s.colorVar }}
            />
          );
        })}
      </div>
      <dl className={styles.statList}>
        {SLEEP_STAGE_META.map((s) => {
          const minutes = sleep.stages[s.key];
          const pct = total > 0 ? (minutes / total) * 100 : null;
          return (
            <div key={s.key} className={styles.statRow}>
              <dt className={styles.statLabel}>
                <span
                  className={styles.stageDot}
                  style={{ background: s.colorVar }}
                  aria-hidden="true"
                />
                {s.label}
              </dt>
              <dd className={styles.statValue}>
                {formatDuration(minutes)}
                {pct != null ? <span className={styles.statPct}> · {pct.toFixed(0)}%</span> : null}
              </dd>
            </div>
          );
        })}
        <div className={styles.statRow}>
          <dt className={styles.statLabel}>Sleep efficiency</dt>
          <dd className={styles.statValue}>
            {Number.isFinite(sleep.efficiency) ? `${sleep.efficiency.toFixed(0)}%` : '—'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

interface PhysiologyCardProps {
  readonly restingHr: number | null;
  readonly hrv: number | null;
  readonly spo2Avg: number | null;
  readonly spo2Min: number | null;
  readonly sleepEfficiency: number | null;
}

function PhysiologyCard({
  restingHr,
  hrv,
  spo2Avg,
  spo2Min,
  sleepEfficiency,
}: PhysiologyCardProps): JSX.Element {
  const rows: StatRow[] = [
    { label: 'Resting HR', value: restingHr != null ? `${restingHr.toFixed(0)} bpm` : '—' },
    { label: 'HRV (RMSSD)', value: hrv != null ? `${hrv.toFixed(0)} ms` : '—' },
    {
      label: 'SpO₂ (wearable)',
      value: spo2Avg != null ? `${spo2Avg.toFixed(0)}% avg` : '—',
    },
    { label: 'SpO₂ nadir', value: spo2Min != null ? `${spo2Min.toFixed(0)}%` : '—' },
    {
      label: 'Sleep efficiency',
      value: sleepEfficiency != null ? `${sleepEfficiency.toFixed(0)}%` : '—',
    },
  ];
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Physiology tonight</h2>
        <Badge variant="info" size="sm">
          Fitbit
        </Badge>
      </div>
      <dl className={styles.statList}>
        {rows.map((r) => (
          <div key={r.label} className={styles.statRow}>
            <dt className={styles.statLabel}>{r.label}</dt>
            <dd className={styles.statValue}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

interface EnvironmentCardProps {
  readonly tempLow: number | null;
  readonly tempMean: number | null;
  readonly tempUnit: 'C' | 'F';
  readonly humidity: number | null;
  readonly pressure: number | null;
  readonly aqi: number | null;
  readonly synced: boolean;
}

function EnvironmentCard(props: EnvironmentCardProps): JSX.Element {
  const { tempLow, tempMean, tempUnit, humidity, pressure, aqi, synced } = props;
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Environment</h2>
        <Badge variant="info" size="sm">
          Weather
        </Badge>
      </div>
      {!synced ? (
        <p className={styles.panelEmpty}>
          Weather is enabled but this night has not been synced yet. Sync weather in Settings to see
          overnight conditions.
        </p>
      ) : (
        <dl className={styles.statList}>
          <div className={styles.statRow}>
            <dt className={styles.statLabel}>Temp (low / mean)</dt>
            <dd className={styles.statValue}>
              {tempLow != null ? `${tempLow.toFixed(0)}°` : '—'} /{' '}
              {tempMean != null ? `${tempMean.toFixed(0)}°${tempUnit}` : '—'}
            </dd>
          </div>
          <div className={styles.statRow}>
            <dt className={styles.statLabel}>Humidity</dt>
            <dd className={styles.statValue}>
              {humidity != null ? `${humidity.toFixed(0)}%` : '—'}
            </dd>
          </div>
          <div className={styles.statRow}>
            <dt className={styles.statLabel}>Barometric</dt>
            <dd className={styles.statValue}>
              {pressure != null ? `${pressure.toFixed(0)} hPa` : '—'}
            </dd>
          </div>
          <div className={styles.statRow}>
            <dt className={styles.statLabel}>Air quality</dt>
            <dd className={styles.statValue}>
              <AqiSwatch value={aqi} scale="us" />
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

// ── Loading / error states (preserved) ───────────────────────────

function LoadingSkeleton(): JSX.Element {
  return (
    <div className={styles.loadingContainer} aria-busy="true">
      <div className={styles.skeletonHeader}>
        <Skeleton width="30%" height={16} variant="text" />
        <Skeleton width="50%" height={32} variant="text" />
        <Skeleton width="40%" height={16} variant="text" />
      </div>
      <div className={styles.skeletonHero}>
        <Skeleton width="100%" height={280} variant="rect" />
        <Skeleton width="100%" height={280} variant="rect" />
      </div>
      <Skeleton width="100%" height={220} variant="rect" />
    </div>
  );
}

function ErrorState({ message }: { message: string }): JSX.Element {
  return (
    <div className={styles.errorState} role="alert">
      <span className={styles.errorIcon} aria-hidden="true">
        ⚠
      </span>
      <h2 className={styles.errorTitle}>Failed to load session</h2>
      <p className={styles.errorMessage}>{message}</p>
      <Button variant="secondary" onClick={() => window.history.back()}>
        Go back
      </Button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

export default function SessionDetail(): JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>();
  const isChildRouteActive = useMatch('/sessions/:sessionId/signals');
  const navigate = useNavigate();
  const colors = useChartColors();

  const {
    session,
    aggregate,
    loading: sessionLoading,
    error: sessionError,
  } = useSessionDetail(sessionId);
  const { events, loading: eventsLoading, error: eventsError } = useEventData(sessionId);

  const ahiThresholds = useSettingsStore((s) => s.analysisParams.ahi);
  const displayPrefs = useSettingsStore((s) => s.display);
  const weatherEnabled = useSettingsStore((s) => s.integrations.weather.enabled);
  const weatherUnits = useSettingsStore((s) => s.integrations.weather.units);

  // ── AI insight requests (preserved) ────────────────────────────
  const buildNightRequest = useCallback(() => {
    if (aggregate === null || session === null) {
      throw new Error('No aggregate to summarize');
    }
    const common = buildGroundingCommon(
      { ahi: ahiThresholds, display: displayPrefs },
      machineClassOf(session.machineType),
    );
    return {
      input: buildSingleNightInput(aggregate, common),
      scopeLabel: nightScopeLabel(aggregate.date),
    };
  }, [aggregate, session, ahiThresholds, displayPrefs]);

  const buildClinicalRequest = useCallback(() => {
    if (aggregate === null || session === null) {
      throw new Error('No aggregate for clinical context');
    }
    const common = buildGroundingCommon(
      { ahi: ahiThresholds, display: displayPrefs },
      machineClassOf(session.machineType),
    );
    return {
      input: buildClinicalContextInput(aggregate, common),
      scopeLabel: nightScopeLabel(aggregate.date),
    };
  }, [aggregate, session, ahiThresholds, displayPrefs]);

  // ── Derived time bases ─────────────────────────────────────────
  const sessionStartMs = useMemo(
    () => (session ? new Date(session.startTime).getTime() : 0),
    [session],
  );
  const sessionEndMs = useMemo(
    () => (session ? new Date(session.endTime).getTime() : 0),
    [session],
  );
  const wallClockEpochMs = useMemo(
    () => (session ? sessionWallClockEpoch(session.startTime) : 0),
    [session],
  );
  const dateKey = useMemo(() => (session ? sessionDateKey(session.startTime) : null), [session]);

  // ── Trailing baseline aggregates (~30–35 nights ending at this night) ──
  const sessionDate = session?.date;
  const baselineRange = useMemo(() => {
    const end = sessionDate ? (parseLocalDate(sessionDate) ?? new Date()) : new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - BASELINE_WINDOW_DAYS);
    return { start, end };
  }, [sessionDate]);
  const { aggregates: trailing } = useNightlyAggregates(baselineRange);
  const priorNights = useMemo(
    () =>
      [...trailing]
        .filter((a) => (sessionDate ? a.date < sessionDate : false))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [trailing, sessionDate],
  );

  // ── Prev / next night navigation ───────────────────────────────
  const allSessionsRange = useMemo(
    () => ({ start: new Date('2000-01-01T00:00:00'), end: new Date(Date.now() + 86_400_000) }),
    [],
  );
  const { sessions: allSessions } = useSessionData(allSessionsRange);
  const ordered = useMemo(
    () => [...allSessions].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [allSessions],
  );
  const currentIdx = useMemo(
    () => ordered.findIndex((s) => s.id === sessionId),
    [ordered, sessionId],
  );
  const prevSession = currentIdx > 0 ? ordered[currentIdx - 1] : null;
  const nextSession =
    currentIdx >= 0 && currentIdx < ordered.length - 1 ? ordered[currentIdx + 1] : null;

  // ── Wearable (Fitbit) — gated ──────────────────────────────────
  const { summary: wearableSummary } = useWearableSummary();
  const wearableAvailable = wearableSummary?.hasData ?? false;
  const gatedDate = wearableAvailable ? dateKey : null;
  const { data: sleepDay } = useWearableDayData('sleep_session', gatedDate);
  const { data: restingHrDay } = useWearableDayData('heart_rate_resting', gatedDate);
  const { data: hrvDay } = useWearableDayData('hrv_daily', gatedDate);
  const { data: spo2Day } = useWearableDayData('spo2_daily', gatedDate);

  // `dataType` guarantees the payload shape; narrow the daily union accordingly.
  const sleep = (sleepDay?.data as FitbitSleepSession | undefined) ?? null;
  const restingHr = restingHrDay
    ? ((restingHrDay.data as FitbitRestingHeartRate).restingHeartRate ?? null)
    : null;
  const hrv = hrvDay ? ((hrvDay.data as FitbitHRVDaily).dailyRmssd ?? null) : null;
  const spo2Avg = spo2Day ? ((spo2Day.data as FitbitSpO2Daily).avg ?? null) : null;
  const spo2WearMin = spo2Day ? ((spo2Day.data as FitbitSpO2Daily).min ?? null) : null;
  const sleepEfficiency = sleep && Number.isFinite(sleep.efficiency) ? sleep.efficiency : null;

  // ── Weather — gated ────────────────────────────────────────────
  const weatherRange = useMemo(
    () => (dateKey ? { start: dateKey, end: dateKey } : null),
    [dateKey],
  );
  const { latest: weatherNight } = useWeatherNightly(
    weatherEnabled && weatherRange ? weatherRange : null,
  );

  // ── Cluster focus (lifted state for the compact signal viewer) ──
  const [focusTime, setFocusTime] = useState<number | undefined>(undefined);
  const signalsRef = useRef<HTMLDivElement>(null);

  // Cluster the night's events ONCE and share the result with both the events
  // panel and the default signal-viewer focus (avoids clustering twice).
  const clustersResult = useMemo(() => sessionClusters(events), [events]);
  const defaultFocus = useMemo(() => {
    if (!session) return undefined;
    const top = clustersResult.summaries[0];
    if (top) return top.startTime - sessionStartMs;
    const la = longestApnea(events);
    if (la) return la.timestamp - sessionStartMs;
    return undefined;
  }, [clustersResult, events, session, sessionStartMs]);

  const focusCluster = useCallback((offsetMs: number) => {
    setFocusTime(offsetMs);
    signalsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, []);

  // ── Child route (Signal Viewer) ────────────────────────────────
  if (isChildRouteActive) {
    return <Outlet />;
  }

  // ── Loading / error / not-found ────────────────────────────────
  if (sessionLoading || eventsLoading) {
    return <LoadingSkeleton />;
  }
  const error = sessionError ?? eventsError;
  if (error) {
    return <ErrorState message={error} />;
  }
  if (!session) {
    return <ErrorState message="Session not found." />;
  }

  // ── KPI series/deltas (aggregate-based metrics only) ───────────
  const buildKpi = (
    selector: (a: NightlyAggregate) => number | null,
  ): {
    series: (number | null)[];
    priorCount: number;
    delta: number | null;
    direction: 'up' | 'down' | 'unchanged';
  } => {
    const current = aggregate ? selector(aggregate) : null;
    const prior = priorNights.map(selector);
    const priorCount = prior.filter((v): v is number => v != null && Number.isFinite(v)).length;
    const bd = baselineDelta(current, prior);
    return { series: [...prior, current], priorCount, delta: bd.delta, direction: bd.direction };
  };

  const ahiKpi = buildKpi((a) => a.ahi);
  const usageKpi = buildKpi((a) => a.usageHours);
  const leakKpi = buildKpi((a) => a.leakMedian);
  const pressureKpi = buildKpi((a) => a.pressureP95);
  const spo2Kpi = buildKpi((a) => a.spo2Min);

  const ahiSeverity = aggregate?.ahi != null ? classifyAhiSeverity(aggregate.ahi) : null;

  // SpO₂ KPI: prefer onboard oximetry, else wearable min (Fitbit). The headline
  // value, the badge, and the trend (sparkline + delta) must all reflect the SAME
  // source — the onboard trend series only applies when the headline is onboard,
  // so a Fitbit fallback suppresses the delta/sparkline rather than mixing sources.
  const spo2FromOnboard = session.hasOximetry && aggregate?.spo2Min != null;
  const spo2Value = spo2FromOnboard ? (aggregate?.spo2Min ?? null) : spo2WearMin;
  const spo2Badge = spo2FromOnboard
    ? ({ text: 'Onboard', variant: 'default' } as const)
    : spo2WearMin != null
      ? ({ text: 'Fitbit', variant: 'info' } as const)
      : undefined;

  const showSleepCard = wearableAvailable && sleep != null;
  const showPhysiologyCard =
    wearableAvailable &&
    (restingHr != null || hrv != null || spo2Avg != null || spo2WearMin != null);
  const weatherSynced = weatherNight != null;
  const showEnvironmentCard = weatherEnabled;
  const showPhysiologyRow = showSleepCard || showPhysiologyCard || showEnvironmentCard;

  const tempLow = weatherNight
    ? convertTemperature(weatherNight.temperatureLow, weatherUnits.temperature)
    : null;
  const tempMean = weatherNight
    ? convertTemperature(weatherNight.temperatureMean, weatherUnits.temperature)
    : null;

  const startClock = formatClockTime(wallClockEpochMs, 0).slice(0, 5);
  const endClock = formatClockTime(wallClockEpochMs, sessionEndMs - sessionStartMs).slice(0, 5);
  const maskType = session.machineSettings?.maskType ?? null;

  return (
    <div className={styles.container}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            <Link to="/sessions" className={styles.breadcrumbLink}>
              Sessions
            </Link>
            <span className={styles.breadcrumbSep} aria-hidden="true">
              /
            </span>
            <span>{session.date}</span>
          </nav>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{formatDateLong(session.date)}</h1>
            <span className={styles.timeRange}>
              {startClock} → {endClock}
            </span>
          </div>
          <div className={styles.headerMeta}>
            <span>{session.machineModel}</span>
            {maskType ? (
              <>
                <span className={styles.metaDivider} aria-hidden="true" />
                <span>Mask: {maskType}</span>
              </>
            ) : null}
            <span className={styles.metaDivider} aria-hidden="true" />
            <span>Firmware {session.firmwareVersion}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            disabled={!prevSession}
            onClick={() => prevSession && navigate(`/sessions/${prevSession.id}`)}
          >
            <span aria-hidden="true">◀</span> Prev night
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!nextSession}
            onClick={() => nextSession && navigate(`/sessions/${nextSession.id}`)}
          >
            Next night <span aria-hidden="true">▶</span>
          </Button>
          <Button variant="primary" size="sm" onClick={() => navigate('/reports')}>
            Export report
          </Button>
        </div>
      </header>

      {/* ── Hero: verdict + KPI grid ────────────────────────────── */}
      {aggregate && (
        <section className={styles.hero} aria-label="Night overview">
          <NightAssessmentCard
            aggregate={aggregate}
            buildNightRequest={buildNightRequest}
            buildClinicalRequest={buildClinicalRequest}
          />
          <div className={styles.kpiGrid}>
            <KpiCard
              label="AHI"
              value={aggregate.ahi}
              decimals={1}
              unit="/h"
              polarity="lower"
              series={ahiKpi.series}
              priorCount={ahiKpi.priorCount}
              delta={ahiKpi.delta}
              direction={ahiKpi.direction}
              sparkColor={colors.chart1}
              badge={
                ahiSeverity
                  ? {
                      text: ahiSeverity.charAt(0).toUpperCase() + ahiSeverity.slice(1),
                      variant: ahiBadgeVariant(ahiSeverity),
                    }
                  : undefined
              }
            />
            <KpiCard
              label="Usage"
              value={aggregate.usageHours}
              decimals={1}
              unit="h"
              polarity="higher"
              series={usageKpi.series}
              priorCount={usageKpi.priorCount}
              delta={usageKpi.delta}
              direction={usageKpi.direction}
              sparkColor={colors.chart6}
            />
            <KpiCard
              label="Leak"
              value={aggregate.leakMedian}
              decimals={1}
              unit="L/m"
              polarity="lower"
              series={leakKpi.series}
              priorCount={leakKpi.priorCount}
              delta={leakKpi.delta}
              direction={leakKpi.direction}
              sparkColor={colors.chart5}
            />
            <KpiCard
              label="Pressure 95%"
              value={aggregate.pressureP95}
              decimals={1}
              unit="cmH₂O"
              polarity="neutral"
              series={pressureKpi.series}
              priorCount={pressureKpi.priorCount}
              delta={pressureKpi.delta}
              direction={pressureKpi.direction}
              sparkColor={colors.chart2}
            />
            <KpiCard
              label="SpO₂ min"
              value={spo2Value}
              decimals={0}
              unit="%"
              polarity="higher"
              series={spo2FromOnboard ? spo2Kpi.series : []}
              priorCount={spo2FromOnboard ? spo2Kpi.priorCount : 0}
              delta={spo2FromOnboard ? spo2Kpi.delta : null}
              direction={spo2FromOnboard ? spo2Kpi.direction : 'unchanged'}
              sparkColor={colors.chart3}
              badge={spo2Badge}
            />
            <KpiCard
              label="Resting HR"
              value={restingHr}
              decimals={0}
              unit="bpm"
              polarity="lower"
              series={[]}
              priorCount={0}
              delta={null}
              direction="unchanged"
              sparkColor={colors.chart4}
              badge={restingHr != null ? { text: 'Fitbit', variant: 'info' } : undefined}
            />
          </div>
        </section>
      )}

      {/* ── Signals ─────────────────────────────────────────────── */}
      <div ref={signalsRef} className={styles.signalsSection}>
        <CompactSignalViewer sessionId={session.id} focusTime={focusTime ?? defaultFocus} />
      </div>

      {/* ── Events row ──────────────────────────────────────────── */}
      {aggregate && (
        <section className={styles.eventsRow} aria-label="Events">
          <RespiratoryEventsCard
            aggregate={aggregate}
            events={events}
            wallClockEpoch={wallClockEpochMs}
            sessionStart={sessionStartMs}
          />
          <EventClustersCard
            clusters={clustersResult}
            wallClockEpoch={wallClockEpochMs}
            sessionStart={sessionStartMs}
            onFocusCluster={focusCluster}
          />
        </section>
      )}

      {/* ── Session statistics ──────────────────────────────────── */}
      {aggregate && (
        <StatisticsCard aggregate={aggregate} session={session} sleepEfficiency={sleepEfficiency} />
      )}

      {/* ── Physiology row (gated) ──────────────────────────────── */}
      {showPhysiologyRow && (
        <section className={styles.physiologyRow} aria-label="Physiology and environment">
          {showSleepCard && sleep && <SleepStagesCard sleep={sleep} />}
          {showPhysiologyCard && (
            <PhysiologyCard
              restingHr={restingHr}
              hrv={hrv}
              spo2Avg={spo2Avg}
              spo2Min={spo2WearMin}
              sleepEfficiency={sleepEfficiency}
            />
          )}
          {showEnvironmentCard && (
            <EnvironmentCard
              tempLow={tempLow}
              tempMean={tempMean}
              tempUnit={weatherUnits.temperature}
              humidity={weatherNight?.humidityMean ?? null}
              pressure={weatherNight?.pressureMslMean ?? null}
              aqi={weatherNight?.usAqiMean ?? null}
              synced={weatherSynced}
            />
          )}
        </section>
      )}

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <p className={styles.footerDisclaimer}>
          Informational only — not a medical device and not a diagnosis. All processing happens
          locally in your browser.
        </p>
        <div className={styles.footerActions}>
          <Link to={`/sessions/${session.id}/signals`} className={styles.footerLink}>
            Raw data →
          </Link>
        </div>
      </footer>
    </div>
  );
}
