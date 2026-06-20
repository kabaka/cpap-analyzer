/**
 * "Sleep stages & cycles" lens for the Event Explorer.
 *
 * Cross-references the matched device event set against the wearable hypnogram
 * (and, in the autonomic sub-view, intraday heart rate) to answer: do events
 * concentrate in particular sleep stages? Is the pattern REM-predominant? Which
 * ultradian cycle do events fall in? And what is the autonomic (heart-rate)
 * response around an event? All statistics come from the pure
 * `@/analysis/sleepStages` module; this component is purely presentational +
 * the IO hook ({@link useSleepStageEventContext}).
 *
 * Four sub-views, selected by a preset-button group (default `stage`):
 *   - stage       Events by sleep stage: per-stage AHI bar chart, χ²
 *                 concentration test, REM-predominance card, across-nights
 *                 paired REM-vs-NREM test.
 *   - cycle       Pooled per-cycle event load + early-vs-late trend.
 *   - autonomic   Event-triggered average heart-rate profile (CVHR surge).
 *   - desat       SpO₂-at-event distributions grouped by sleep stage.
 *
 * This tool is descriptive and does NOT diagnose. Wearable staging is
 * approximate vs polysomnography; every sub-view surfaces that caveat.
 *
 * @module views/Explore/EventExplorer/SleepStagesView
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChartContainer, ThemedBarChart, ThemedLineChart, BoxPlot } from '@/components/charts';
import type { ReferenceLineConfig, BoxPlotGroup } from '@/components/charts';
import type { Event } from '@/types/events';
import {
  tagEventsByStage,
  stageDurations,
  eventRatesByStage,
  eventStageConcentrationTest,
  remOsaPattern,
  remVsNremAcrossNights,
  deriveSleepCycles,
  eventLoadByCycle,
  cyclePositionTrend,
  eventTriggeredHr,
  isAhiEvent,
  type SleepStage,
  type StageDurations,
  type StageSegment,
  type TaggedEvent,
  type CycleEventLoad,
  type ConcentrationStage,
  type RemOsaClassification,
} from '@/analysis/sleepStages';
import { useSleepStageEventContext, type SleepNight } from '@/hooks/useSleepStageEventContext';
import shared from './ResultsViews.module.css';
import styles from './SleepStagesView.module.css';

// ── Sub-view identifiers ──────────────────────────────────────────

type SubView = 'stage' | 'cycle' | 'autonomic' | 'desat';

const SUB_VIEWS: readonly { value: SubView; label: string }[] = [
  { value: 'stage', label: 'Events by sleep stage' },
  { value: 'cycle', label: 'Sleep cycles' },
  { value: 'autonomic', label: 'Heart-rate response' },
  { value: 'desat', label: 'Desaturation by stage' },
];

// ── Stage labelling (consistent with hypnogramBands) ──────────────

const STAGE_ORDER: readonly SleepStage[] = ['deep', 'light', 'rem', 'wake'];

const STAGE_LABEL: Record<SleepStage, string> = {
  deep: 'Deep (N3)',
  light: 'Light (N1–2)',
  rem: 'REM',
  wake: 'Wake',
};

/** Sleep stages tested by the concentration test, in clinical order. */
const CONCENTRATION_STAGE_ORDER: readonly ConcentrationStage[] = ['deep', 'light', 'rem'];

// ── Formatting helpers ────────────────────────────────────────────

function formatPValue(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p < 0.001) return '< 0.001';
  return p.toFixed(3);
}

function formatRate(rate: number | null): string {
  return rate === null || !Number.isFinite(rate) ? '—' : `${rate.toFixed(1)}/h`;
}

function formatNum(n: number | null, digits = 1, suffix = ''): string {
  return n === null || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)}${suffix}`;
}

const CLASSIFICATION_LABEL: Record<RemOsaClassification, string> = {
  'rem-predominant': 'REM-predominant',
  'rem-related': 'REM-related',
  'not-rem-predominant': 'Not REM-predominant',
  'insufficient-data': 'Insufficient data',
};

/** Assign matched events to a night by timestamp ∈ [startMs, endMs). */
function eventsForNight(events: readonly Event[], night: SleepNight): Event[] {
  return events.filter((e) => e.timestamp >= night.startMs && e.timestamp < night.endMs);
}

// ── Help affordance ───────────────────────────────────────────────

function HelpRow() {
  return (
    <div className={styles.helpRow}>
      <Link className={styles.helpLink} to="/help/events-by-sleep-stage">
        How to read this: Events by sleep stage →
      </Link>
    </div>
  );
}

// ── Sub-view selector ─────────────────────────────────────────────

function SubViewControls({ value, onChange }: { value: SubView; onChange: (v: SubView) => void }) {
  return (
    <div className={shared.viewControls}>
      <div className={shared.presetRow} role="group" aria-label="Sleep-stage sub-view">
        {SUB_VIEWS.map((sv) => (
          <button
            key={sv.value}
            type="button"
            className={`${shared.presetBtn} ${value === sv.value ? shared.presetActive : ''}`}
            onClick={() => onChange(sv.value)}
            aria-pressed={value === sv.value}
          >
            {sv.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Stage sub-view ────────────────────────────────────────────────

function StageSubView({
  events,
  allSegments,
  nights,
}: {
  events: readonly Event[];
  allSegments: readonly StageSegment[];
  nights: readonly SleepNight[];
}) {
  const tagged = useMemo<readonly TaggedEvent[]>(
    () => tagEventsByStage([...events], [...allSegments]),
    [events, allSegments],
  );
  const durations = useMemo<StageDurations>(() => stageDurations([...allSegments]), [allSegments]);

  const rates = useMemo(
    () => eventRatesByStage(tagged, durations, { ahiOnly: true }),
    [tagged, durations],
  );

  // Per-stage rows in clinical stage order (deep→light→rem→wake). `ratePerHour`
  // is kept as `number | null` so the table/value display can distinguish a true
  // zero rate from "no time-in-stage denominator" (rendered as —); the bar chart
  // separately coerces null → 0 to keep a plottable numeric value.
  const rateByStage = useMemo(() => {
    const map = new Map(rates.map((r) => [r.stage, r]));
    return STAGE_ORDER.map((stage) => {
      const r = map.get(stage);
      const ratePerHour = r ? r.ratePerHour : null;
      return {
        label: STAGE_LABEL[stage],
        // Bar chart value: null (no denominator) plots as 0; finite plots as-is.
        rate: ratePerHour !== null ? Number(ratePerHour.toFixed(2)) : 0,
        ratePerHour,
        count: r ? r.count : 0,
      };
    });
  }, [rates]);

  const tableData = useMemo(
    () => ({
      headers: ['Stage', 'AHI-type events', 'Rate (events/h)'],
      rows: rateByStage.map(
        (r) => [r.label, r.count, formatRate(r.ratePerHour)] as (string | number)[],
      ),
    }),
    [rateByStage],
  );

  const concentration = useMemo(
    () => eventStageConcentrationTest(tagged, durations),
    [tagged, durations],
  );

  const remOsa = useMemo(() => remOsaPattern(tagged, durations), [tagged, durations]);

  const acrossNights = useMemo(() => {
    if (nights.length === 0) return null;
    return remVsNremAcrossNights(
      nights.map((n) => {
        const nightTagged = tagEventsByStage(eventsForNight(events, n), [...n.segments]);
        return {
          date: n.date,
          taggedEvents: nightTagged,
          durations: stageDurations([...n.segments]),
        };
      }),
    );
  }, [nights, events]);

  return (
    <div>
      <ChartContainer
        title="AHI-type event rate by sleep stage"
        height={360}
        tableData={tableData}
        exportFileName="events-by-sleep-stage"
      >
        <ThemedBarChart
          data={rateByStage}
          xKey="label"
          xLabel="Sleep stage"
          yLabel="Events per hour"
          height={310}
          bars={[{ dataKey: 'rate', name: 'Events/hour' }]}
        />
      </ChartContainer>
      <p className={shared.viewCaption} role="note">
        Events are tagged with the wearable-reported stage active at their marker time; rates use
        time spent in each stage as the denominator. Wearable staging is approximate and is not
        polysomnography.
      </p>

      {/* Concentration test */}
      <section className={styles.panel} aria-labelledby="concentration-title">
        <h3 id="concentration-title" className={styles.panelTitle}>
          Stage-concentration test (χ² goodness-of-fit)
        </h3>
        <div className={styles.statRow}>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>χ²</span>
            <span className={styles.statValue}>{formatNum(concentration.chiSquare, 2)}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>df</span>
            <span className={styles.statValue}>
              {Number.isFinite(concentration.df) ? concentration.df : '—'}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>p-value</span>
            <span className={styles.statValue}>{formatPValue(concentration.pValue)}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Events tested</span>
            <span className={styles.statValue}>{concentration.totalEvents.toLocaleString()}</span>
          </div>
        </div>
        {concentration.stagesUsed.length > 0 ? (
          <table className={styles.obsExpTable}>
            <caption className={styles.srOnly}>
              Observed vs expected AHI-type events per sleep stage
            </caption>
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col">Observed</th>
                <th scope="col">Expected</th>
              </tr>
            </thead>
            <tbody>
              {CONCENTRATION_STAGE_ORDER.filter((s) => concentration.stagesUsed.includes(s)).map(
                (stage) => (
                  <tr key={stage}>
                    <th scope="row">{STAGE_LABEL[stage]}</th>
                    <td>{concentration.observed[stage]}</td>
                    <td>{concentration.expected[stage].toFixed(1)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        ) : null}
        <p className={styles.panelBody}>
          {concentration.sufficientData ? (
            concentration.pValue < 0.05 ? (
              <>
                Events are distributed across sleep stages differently than time-in-stage alone
                would predict (p&nbsp;=&nbsp;{formatPValue(concentration.pValue)}). Compare observed
                vs expected above to see which stages carry the excess.
              </>
            ) : (
              <>
                No significant deviation from a stage-independent event rate (p&nbsp;=&nbsp;
                {formatPValue(concentration.pValue)}): events appear roughly proportional to time
                spent in each stage.
              </>
            )
          ) : (
            <>
              <strong>Sample size too small for a reliable test.</strong> Fewer than the required
              events, or an expected count below 5 in a used cell (Cochran&rsquo;s rule), so the
              p-value above is <strong>not reliable</strong>. The observed and expected counts
              remain descriptive.
            </>
          )}
        </p>
      </section>

      {/* REM-predominance card */}
      <section className={styles.panel} aria-labelledby="rem-osa-title">
        <h3 id="rem-osa-title" className={styles.panelTitle}>
          REM-predominance pattern (this range)
        </h3>
        <div className={styles.statRow}>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>AHI (REM)</span>
            <span className={styles.statValue}>{formatNum(remOsa.ahiRem)}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>AHI (NREM)</span>
            <span className={styles.statValue}>{formatNum(remOsa.ahiNrem)}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Ratio</span>
            <span className={styles.statValue}>{formatNum(remOsa.ratio, 2)}</span>
          </div>
        </div>
        <p className={styles.panelBody}>
          Pattern:{' '}
          <span
            className={`${styles.badge} ${
              remOsa.classification === 'rem-predominant' || remOsa.classification === 'rem-related'
                ? styles.badgeStrong
                : styles.badgeNeutral
            }`}
          >
            {CLASSIFICATION_LABEL[remOsa.classification]}
          </span>
        </p>
        {remOsa.caveat ? <p className={styles.caveat}>{remOsa.caveat}</p> : null}
      </section>

      {/* Across-nights paired test */}
      <section className={styles.panel} aria-labelledby="across-nights-title">
        <h3 id="across-nights-title" className={styles.panelTitle}>
          REM vs NREM across nights (paired)
        </h3>
        {acrossNights && acrossNights.sufficientData && acrossNights.wilcoxon ? (
          <>
            <div className={styles.statRow}>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Nights included</span>
                <span className={styles.statValue}>{acrossNights.nIncludedNights}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Median AHI (REM)</span>
                <span className={styles.statValue}>{formatNum(acrossNights.medianAhiRem)}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Median AHI (NREM)</span>
                <span className={styles.statValue}>{formatNum(acrossNights.medianAhiNrem)}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Wilcoxon p</span>
                <span className={styles.statValue}>
                  {formatPValue(acrossNights.wilcoxon.pValue)}
                </span>
              </div>
            </div>
            <p className={styles.panelBody}>
              {acrossNights.wilcoxon.pValue < 0.05 ? (
                <>
                  Per-night REM and NREM AHI differ significantly across the{' '}
                  {acrossNights.nIncludedNights} included nights (effect size{' '}
                  {acrossNights.wilcoxon.effectSizeInterpretation}). This paired test is more robust
                  than the single-range card above.
                </>
              ) : (
                <>
                  No significant per-night difference between REM and NREM AHI across the{' '}
                  {acrossNights.nIncludedNights} included nights.
                </>
              )}
            </p>
          </>
        ) : (
          <p className={styles.panelBody}>
            Need at least 5 nights with sufficient REM and NREM time for a paired REM-vs-NREM
            comparison
            {acrossNights ? ` (currently ${acrossNights.nIncludedNights} usable).` : '.'}
          </p>
        )}
      </section>
    </div>
  );
}

// ── Cycle sub-view ────────────────────────────────────────────────

function CycleSubView({
  events,
  nights,
}: {
  events: readonly Event[];
  nights: readonly SleepNight[];
}) {
  // Pool per-cycle load across nights by cycle index.
  const pooled = useMemo<CycleEventLoad[]>(() => {
    const byIndex = new Map<number, { count: number; durationHours: number; hasRem: boolean }>();
    for (const night of nights) {
      const cycles = deriveSleepCycles([...night.segments]);
      if (cycles.length === 0) continue;
      const load = eventLoadByCycle(eventsForNight(events, night), cycles, { ahiOnly: true });
      for (const c of load) {
        const agg = byIndex.get(c.index) ?? { count: 0, durationHours: 0, hasRem: false };
        agg.count += c.count;
        agg.durationHours += c.durationHours;
        agg.hasRem = agg.hasRem || c.hasRem;
        byIndex.set(c.index, agg);
      }
    }
    return [...byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, agg]) => ({
        index,
        count: agg.count,
        durationHours: agg.durationHours,
        ratePerHour: agg.durationHours > 0 ? agg.count / agg.durationHours : null,
        hasRem: agg.hasRem,
      }));
  }, [events, nights]);

  const trend = useMemo(() => cyclePositionTrend(pooled), [pooled]);

  const chartData = useMemo(
    () =>
      pooled.map((c) => ({
        label: `Cycle ${c.index}${c.hasRem ? '' : ' (incomplete)'}`,
        rate: c.ratePerHour !== null ? Number(c.ratePerHour.toFixed(2)) : 0,
        count: c.count,
      })),
    [pooled],
  );

  const tableData = useMemo(
    () => ({
      headers: ['Cycle', 'AHI-type events', 'Rate (events/h)'],
      rows: pooled.map(
        (c) => [`Cycle ${c.index}`, c.count, formatRate(c.ratePerHour)] as (string | number)[],
      ),
    }),
    [pooled],
  );

  if (pooled.length === 0) {
    return (
      <p className={shared.viewEmpty}>
        No NREM–REM cycles could be derived from the wearable hypnogram for the matched nights.
      </p>
    );
  }

  return (
    <div>
      <ChartContainer
        title="Pooled AHI-type event rate by sleep cycle"
        height={360}
        tableData={tableData}
        exportFileName="events-by-sleep-cycle"
      >
        <ThemedBarChart
          data={chartData}
          xKey="label"
          xLabel="NREM–REM cycle (pooled across nights)"
          yLabel="Events per hour"
          height={310}
          bars={[{ dataKey: 'rate', name: 'Events/hour' }]}
        />
      </ChartContainer>
      <section className={styles.panel} aria-labelledby="cycle-trend-title">
        <h3 id="cycle-trend-title" className={styles.panelTitle}>
          Early vs late cycles
        </h3>
        <div className={styles.statRow}>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>First-half rate</span>
            <span className={styles.statValue}>{formatRate(trend.firstHalfRate)}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Second-half rate</span>
            <span className={styles.statValue}>{formatRate(trend.secondHalfRate)}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Difference</span>
            <span className={styles.statValue}>{formatNum(trend.slope, 1, '/h')}</span>
          </div>
        </div>
        <p className={styles.panelBody}>{trend.note}</p>
      </section>
      <p className={shared.viewCaption} role="note">
        Cycles are derived heuristically from the wearable hypnogram (NREM–REM episodes); boundaries
        and counts are best-effort descriptive structure, not clinically scored sleep architecture.
      </p>
    </div>
  );
}

// ── Autonomic sub-view ────────────────────────────────────────────

function AutonomicSubView({ events }: { events: readonly Event[] }) {
  const { hrSamples, hasHrData, hrRangeTooLarge, loading, error } = useSleepStageEventContext(true);

  const result = useMemo(() => {
    const ahi = events.filter((e) => isAhiEvent(e.type));
    if (ahi.length === 0 || hrSamples.length === 0) return null;
    return eventTriggeredHr([...ahi], [...hrSamples]);
  }, [events, hrSamples]);

  const profileData = useMemo(
    () =>
      result
        ? result.averageProfile
            .filter((p) => Number.isFinite(p.meanBpm))
            .map((p) => ({ relSec: p.relSec, meanBpm: Number(p.meanBpm.toFixed(1)), n: p.n }))
        : [],
    [result],
  );

  const referenceLines = useMemo<ReferenceLineConfig[]>(
    () => [{ value: 0, axis: 'x', label: 'Event' }],
    [],
  );

  const tableData = useMemo(
    () => ({
      headers: ['Time (s)', 'Mean HR (bpm)', 'Events'],
      rows: profileData.map((p) => [p.relSec, p.meanBpm, p.n] as (string | number)[]),
    }),
    [profileData],
  );

  if (loading) {
    return (
      <p className={shared.viewEmpty} role="status">
        Loading heart-rate data…
      </p>
    );
  }
  if (error) {
    return (
      <p className={shared.viewEmpty} role="alert">
        Could not load heart-rate data: {error}
      </p>
    );
  }
  if (hrRangeTooLarge) {
    return (
      <p className={shared.viewEmpty} role="note">
        The selected date range is too wide to compute the heart-rate response without loading
        millions of samples on the main thread. Loading only part of the range would bias the
        event-triggered average, so it is not loaded. Narrow the global date range (to about two
        months or fewer) to see the heart-rate response.
      </p>
    );
  }
  if (!hasHrData || !result || !result.sufficientData || profileData.length === 0) {
    return (
      <p className={shared.viewEmpty}>
        No intraday heart-rate data overlaps the matched events for this range. Import wearable
        heart-rate (Fitbit / Google Health) covering these nights to see the event-triggered
        heart-rate response.
      </p>
    );
  }

  return (
    <div>
      <ChartContainer
        title="Event-triggered average heart rate"
        height={380}
        tableData={tableData}
        exportFileName="event-triggered-heart-rate"
      >
        <ThemedLineChart
          data={profileData}
          xKey="relSec"
          xLabel="Seconds relative to event marker"
          yLabel="Mean heart rate (bpm)"
          height={330}
          lines={[{ dataKey: 'meanBpm', name: 'Mean HR' }]}
          referenceLines={referenceLines}
        />
      </ChartContainer>
      <div className={styles.statRow}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Events analysed</span>
          <span className={styles.statValue}>{result.nEventsAnalyzed.toLocaleString()}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Mean surge</span>
          <span className={styles.statValue}>{formatNum(result.meanSurgeBpm, 1, ' bpm')}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Median surge</span>
          <span className={styles.statValue}>{formatNum(result.medianSurgeBpm, 1, ' bpm')}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>With surge ≥ {result.surgeThresholdBpm} bpm</span>
          <span className={styles.statValue}>
            {result.fractionWithSurge === null
              ? '—'
              : `${(result.fractionWithSurge * 100).toFixed(0)}%`}
          </span>
        </div>
      </div>
      <p className={shared.viewCaption} role="note">
        A post-event heart-rate surge (cyclical variation of heart rate, CVHR) is a known autonomic
        signature of apnea/hypopnea arousals. Optical (wrist) heart rate is noisier than ECG and can
        miss or blur short surges; read magnitudes as approximate.
      </p>
    </div>
  );
}

// ── Desaturation-by-stage sub-view ────────────────────────────────

function DesatSubView({
  events,
  allSegments,
}: {
  events: readonly Event[];
  allSegments: readonly StageSegment[];
}) {
  const groups = useMemo<BoxPlotGroup[]>(() => {
    const tagged = tagEventsByStage([...events], [...allSegments]);
    const byStage = new Map<SleepStage, number[]>();
    for (const { event, stage } of tagged) {
      if (stage === null) continue;
      if (event.spo2 === null || !Number.isFinite(event.spo2)) continue;
      let arr = byStage.get(stage);
      if (!arr) {
        arr = [];
        byStage.set(stage, arr);
      }
      arr.push(event.spo2);
    }
    return STAGE_ORDER.filter((stage) => (byStage.get(stage)?.length ?? 0) >= 2).map((stage) => ({
      label: STAGE_LABEL[stage],
      values: byStage.get(stage) as number[],
    }));
  }, [events, allSegments]);

  if (groups.length === 0) {
    return (
      <p className={shared.viewEmpty}>
        Not enough matched events with an SpO₂ reading to compare desaturation by sleep stage (need
        ≥2 per stage). SpO₂ at event time requires CPAP-attached oximetry.
      </p>
    );
  }

  return (
    <div>
      <ChartContainer
        title="SpO₂ at event time by sleep stage"
        height={380}
        exportFileName="desaturation-by-sleep-stage"
      >
        <BoxPlot data={groups} height={330} />
      </ChartContainer>
      <p className={shared.viewCaption} role="note">
        SpO₂ at event time is taken from CPAP-attached oximetry where available; the sleep stage is
        from the wearable hypnogram. The two sources are aligned by wall-clock time.
      </p>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────

export interface SleepStagesViewProps {
  events: readonly Event[];
}

export function SleepStagesView({ events }: SleepStagesViewProps) {
  const [subView, setSubView] = useState<SubView>('stage');
  // The stage/cycle/desat sub-views never need HR; the autonomic sub-view loads
  // its own context with includeHr=true, so this shared load stays light.
  const { nights, allSegments, hasStageData, loading, error } = useSleepStageEventContext(false);

  if (loading) {
    return (
      <div>
        <HelpRow />
        <p className={shared.viewEmpty} role="status">
          Loading sleep-stage data…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <HelpRow />
        <p className={shared.viewEmpty} role="alert">
          Could not load sleep-stage data: {error}
        </p>
      </div>
    );
  }

  if (!hasStageData) {
    return (
      <div>
        <HelpRow />
        <p className={shared.viewEmpty}>
          Import wearable sleep-stage data (Fitbit / Google Health) and ensure it overlaps this date
          range to analyse events by sleep stage.
        </p>
      </div>
    );
  }

  return (
    <div>
      <HelpRow />
      <SubViewControls value={subView} onChange={setSubView} />
      {subView === 'stage' && (
        <StageSubView events={events} allSegments={allSegments} nights={nights} />
      )}
      {subView === 'cycle' && <CycleSubView events={events} nights={nights} />}
      {subView === 'autonomic' && <AutonomicSubView events={events} />}
      {subView === 'desat' && <DesatSubView events={events} allSegments={allSegments} />}
    </div>
  );
}
