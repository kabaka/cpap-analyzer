/**
 * Results views (lenses) for the Event Explorer.
 *
 * Each lens renders the SAME matched event set through a different chart, with
 * a shared summary-stats strip beneath. Lenses:
 *   - histogram   Duration histogram (adjustable bins, optional split-by-type).
 *   - scatter     Duration vs {pressure | leak | spo2 | time-of-night}.
 *   - distributions  Per-type box/violin small-multiples for a chosen metric.
 *   - intervals   Inter-event interval histogram.
 *   - clusters    FLG-bridged clustering (strict/balanced/lenient) lens.
 *
 * @module views/Explore/EventExplorer/ResultsViews
 */

import { useMemo, useState } from 'react';
import {
  ChartContainer,
  ThemedBarChart,
  ThemedScatterPlot,
  BoxPlot,
  ViolinPlot,
  type ScatterDataPoint,
  type BoxPlotGroup,
} from '@/components/charts';
import { Select } from '@/components/ui';
import type { Event, EventType } from '@/types/events';
import { clusterEventsFLGBridged, interEventIntervals, type FLGPreset } from '@/analysis/events';
import { EVENT_TYPE_META, eventLabel } from '@/components/events/eventTypeMeta';
import { binEvents, binValues } from './histogram';
import { SleepStagesView } from './SleepStagesView';
import type { ViewId } from './viewOptions';
import styles from './ResultsViews.module.css';

// ── Summary strip ────────────────────────────────────────────────

function SummaryStrip({ events }: { events: readonly Event[] }) {
  const stats = useMemo(() => {
    if (events.length === 0) return null;
    const durations = events.map((e) => e.duration).sort((a, b) => a - b);
    const n = durations.length;
    const mean = durations.reduce((s, v) => s + v, 0) / n;
    const median =
      n % 2 === 1
        ? (durations[(n - 1) / 2] as number)
        : ((durations[n / 2 - 1] as number) + (durations[n / 2] as number)) / 2;
    return {
      count: n,
      mean,
      median,
      min: durations[0] as number,
      max: durations[n - 1] as number,
    };
  }, [events]);

  if (!stats) return null;

  return (
    <dl className={styles.summaryStrip} aria-label="Summary statistics for matched events">
      <div className={styles.summaryItem}>
        <dt>Events</dt>
        <dd>{stats.count.toLocaleString()}</dd>
      </div>
      <div className={styles.summaryItem}>
        <dt>Mean duration</dt>
        <dd>{stats.mean.toFixed(1)}s</dd>
      </div>
      <div className={styles.summaryItem}>
        <dt>Median duration</dt>
        <dd>{stats.median.toFixed(1)}s</dd>
      </div>
      <div className={styles.summaryItem}>
        <dt>Min / Max</dt>
        <dd>
          {stats.min.toFixed(0)}s / {stats.max.toFixed(0)}s
        </dd>
      </div>
    </dl>
  );
}

// ── Duration histogram lens ──────────────────────────────────────

const BIN_PRESETS: readonly number[] = [5, 10, 30];

function HistogramView({ events }: { events: readonly Event[] }) {
  const [binWidth, setBinWidth] = useState(10);
  const [splitByType, setSplitByType] = useState(false);

  const series = useMemo(
    () => binEvents(events, binWidth, (e) => e.duration, 's'),
    [events, binWidth],
  );
  const bins = series.bins;

  const presentTypes = useMemo(() => {
    const set = new Set<EventType>();
    for (const b of bins) {
      for (const t of Object.keys(b.byType)) set.add(t as EventType);
    }
    return [...set];
  }, [bins]);

  const data = useMemo(
    () =>
      bins.map((b) => {
        const row: Record<string, unknown> = { label: b.label, count: b.count };
        if (splitByType) {
          for (const t of presentTypes) row[t] = b.byType[t] ?? 0;
        }
        return row;
      }),
    [bins, splitByType, presentTypes],
  );

  const bars = splitByType
    ? presentTypes.map((t) => ({
        dataKey: t,
        name: eventLabel(t),
        color: undefined,
        stackId: 'dur',
      }))
    : [{ dataKey: 'count', name: 'Events' }];

  const tableData = useMemo(
    () => ({
      headers: ['Bin', 'Count'],
      rows: bins.map((b) => [b.label, b.count] as (string | number)[]),
    }),
    [bins],
  );

  return (
    <div>
      <div className={styles.viewControls}>
        <label className={styles.inlineControl}>
          <span>Bin width (s)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={binWidth}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 1) setBinWidth(v);
            }}
            className={styles.numInput}
          />
        </label>
        <div className={styles.presetRow} role="group" aria-label="Bin width presets">
          {BIN_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`${styles.presetBtn} ${binWidth === p ? styles.presetActive : ''}`}
              onClick={() => setBinWidth(p)}
              aria-pressed={binWidth === p}
            >
              {p}s
            </button>
          ))}
        </div>
        <label className={styles.inlineControl}>
          <input
            type="checkbox"
            checked={splitByType}
            onChange={(e) => setSplitByType(e.target.checked)}
          />
          <span>Split by type</span>
        </label>
      </div>
      <ChartContainer
        title="Duration distribution"
        height={400}
        tableData={tableData}
        exportFileName="event-duration-histogram"
      >
        <ThemedBarChart
          data={data}
          xKey="label"
          xLabel="Duration"
          yLabel="Event count"
          height={350}
          bars={bars}
        />
      </ChartContainer>
      {series.overflowCount > 0 && series.overflowThreshold !== null ? (
        <p className={styles.viewCaption} role="status">
          {series.overflowCount.toLocaleString()} event
          {series.overflowCount === 1 ? '' : 's'} ≥{series.overflowThreshold}s aggregated into the
          final overflow bin to keep the chart readable.
        </p>
      ) : null}
    </div>
  );
}

// ── Scatter lens ─────────────────────────────────────────────────

type ScatterMetric = 'pressure' | 'leak' | 'spo2' | 'timeOfNight';

const SCATTER_METRICS: readonly { value: ScatterMetric; label: string }[] = [
  { value: 'pressure', label: 'Pressure (cmH₂O)' },
  { value: 'leak', label: 'Leak (L/min)' },
  { value: 'spo2', label: 'SpO₂ (%)' },
  { value: 'timeOfNight', label: 'Time of night (hour)' },
];

/** Scatter rendering threshold beyond which we draw a uniform-stride sample. */
const SCATTER_MAX_POINTS = 5000;

function ScatterView({ events }: { events: readonly Event[] }) {
  const [metric, setMetric] = useState<ScatterMetric>('pressure');

  const allPoints = useMemo<ScatterDataPoint[]>(() => {
    const out: ScatterDataPoint[] = [];
    for (const e of events) {
      let x: number | null;
      if (metric === 'timeOfNight') {
        const d = new Date(e.timestamp);
        x = d.getHours() + d.getMinutes() / 60;
      } else {
        x = e[metric];
      }
      if (x === null || !Number.isFinite(x)) continue;
      // Use the human label as the category so the legend/tooltip read
      // naturally ("Obstructive Apnea", not "ObstructiveApnea"). Labels in
      // EVENT_TYPE_META are unique by construction; the colour map below is
      // keyed by the same label so the mapping stays stable.
      out.push({ x, y: e.duration, category: eventLabel(e.type) });
    }
    return out;
  }, [events, metric]);

  // Uniform-stride decimation keeps the sample deterministic (seeded by index,
  // not Math.random) so two renders of the same data show identical points.
  const sample = useMemo<{ points: ScatterDataPoint[]; sampled: boolean }>(() => {
    if (allPoints.length <= SCATTER_MAX_POINTS) {
      return { points: allPoints, sampled: false };
    }
    const stride = allPoints.length / SCATTER_MAX_POINTS;
    const out: ScatterDataPoint[] = [];
    for (let i = 0; i < SCATTER_MAX_POINTS; i++) {
      const p = allPoints[Math.floor(i * stride)];
      if (p) out.push(p);
    }
    return { points: out, sampled: true };
  }, [allPoints]);

  const categoryColors = useMemo(() => {
    const map: Record<string, string> = {};
    // Key by human label (matches the `category` set on each point above).
    for (const meta of Object.values(EVENT_TYPE_META)) map[meta.label] = meta.color;
    return map;
  }, []);

  const metricLabel = SCATTER_METRICS.find((m) => m.value === metric)?.label ?? metric;

  return (
    <div>
      <div className={styles.viewControls}>
        <Select
          label="X axis"
          options={SCATTER_METRICS.map((m) => ({ value: m.value, label: m.label }))}
          value={metric}
          onValueChange={(v) => setMetric(v as ScatterMetric)}
        />
      </div>
      {sample.points.length === 0 ? (
        <p className={styles.viewEmpty}>
          No matched events have a value for {metricLabel}. Pick a different X axis.
        </p>
      ) : (
        <>
          <ChartContainer
            title={`Duration vs ${metricLabel}`}
            height={420}
            exportFileName="event-scatter"
          >
            <ThemedScatterPlot
              data={sample.points}
              xLabel={metricLabel}
              yLabel="Duration (s)"
              categoryKey="category"
              categoryColors={categoryColors}
              height={370}
            />
          </ChartContainer>
          {sample.sampled ? (
            <p className={styles.viewCaption} role="status">
              Showing a {SCATTER_MAX_POINTS.toLocaleString()}-point uniform sample of{' '}
              {allPoints.length.toLocaleString()} matched events. Refine filters for the full point
              cloud, or use the histogram lens for a dense distribution view.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

// ── Per-type distributions lens ──────────────────────────────────

type DistMetric = 'duration' | 'pressure' | 'leak' | 'spo2';
type DistKind = 'box' | 'violin';

const DIST_METRICS: readonly { value: DistMetric; label: string }[] = [
  { value: 'duration', label: 'Duration (s)' },
  { value: 'pressure', label: 'Pressure (cmH₂O)' },
  { value: 'leak', label: 'Leak (L/min)' },
  { value: 'spo2', label: 'SpO₂ (%)' },
];

function DistributionsView({ events }: { events: readonly Event[] }) {
  const [metric, setMetric] = useState<DistMetric>('duration');
  const [kind, setKind] = useState<DistKind>('box');

  const groups = useMemo<BoxPlotGroup[]>(() => {
    const byType = new Map<EventType, number[]>();
    for (const e of events) {
      const v = metric === 'duration' ? e.duration : e[metric];
      if (v === null || !Number.isFinite(v)) continue;
      let arr = byType.get(e.type);
      if (!arr) {
        arr = [];
        byType.set(e.type, arr);
      }
      arr.push(v);
    }
    return [...byType.entries()]
      .filter(([, vals]) => vals.length >= 2)
      .map(([type, values]) => ({ label: eventLabel(type), values }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [events, metric]);

  const metricLabel = DIST_METRICS.find((m) => m.value === metric)?.label ?? metric;

  return (
    <div>
      <div className={styles.viewControls}>
        <Select
          label="Metric"
          options={DIST_METRICS.map((m) => ({ value: m.value, label: m.label }))}
          value={metric}
          onValueChange={(v) => setMetric(v as DistMetric)}
        />
        <div className={styles.presetRow} role="group" aria-label="Plot type">
          {(['box', 'violin'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`${styles.presetBtn} ${kind === k ? styles.presetActive : ''}`}
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
            >
              {k === 'box' ? 'Box' : 'Violin'}
            </button>
          ))}
        </div>
      </div>
      {groups.length === 0 ? (
        <p className={styles.viewEmpty}>
          Not enough matched events with {metricLabel} values to compare distributions (need ≥2 per
          type).
        </p>
      ) : (
        <ChartContainer
          title={`${metricLabel} by event type`}
          height={400}
          exportFileName="event-distributions"
        >
          {kind === 'box' ? (
            <BoxPlot data={groups} height={360} />
          ) : (
            <ViolinPlot data={groups} height={360} />
          )}
        </ChartContainer>
      )}
    </div>
  );
}

// ── Inter-event intervals lens ───────────────────────────────────

function IntervalsView({ events }: { events: readonly Event[] }) {
  const result = useMemo(
    () => (events.length >= 2 ? interEventIntervals([...events]) : null),
    [events],
  );

  const series = useMemo(
    () =>
      result
        ? binValues(result.intervals, 30, 40, 's')
        : { bins: [], overflowCount: 0, overflowThreshold: null as number | null },
    [result],
  );
  const histo = series.bins;

  if (!result || result.count === 0 || histo.length === 0) {
    return (
      <p className={styles.viewEmpty}>
        Not enough matched events for inter-event interval analysis.
      </p>
    );
  }

  return (
    <div>
      <dl className={styles.summaryStrip}>
        <div className={styles.summaryItem}>
          <dt>Mean interval</dt>
          <dd>{result.mean.toFixed(1)}s</dd>
        </div>
        <div className={styles.summaryItem}>
          <dt>Median interval</dt>
          <dd>{result.median.toFixed(1)}s</dd>
        </div>
        <div className={styles.summaryItem}>
          <dt>Min / Max</dt>
          <dd>
            {result.min.toFixed(0)}s / {result.max.toFixed(0)}s
          </dd>
        </div>
      </dl>
      <ChartContainer
        title="Inter-event intervals"
        height={360}
        exportFileName="event-intervals"
        tableData={{
          headers: ['Interval', 'Count'],
          rows: histo.map((b) => [b.label, b.count] as (string | number)[]),
        }}
      >
        <ThemedBarChart
          data={histo.map((b) => ({ label: b.label, count: b.count }))}
          xKey="label"
          xLabel="Interval between consecutive events"
          yLabel="Count"
          height={310}
          bars={[{ dataKey: 'count', name: 'Count' }]}
        />
      </ChartContainer>
      {series.overflowCount > 0 && series.overflowThreshold !== null ? (
        <p className={styles.viewCaption} role="status">
          {series.overflowCount.toLocaleString()} interval
          {series.overflowCount === 1 ? '' : 's'} ≥{series.overflowThreshold}s aggregated into the
          final overflow bin.
        </p>
      ) : null}
    </div>
  );
}

// ── Clusters lens ────────────────────────────────────────────────

const CLUSTER_PRESETS: readonly { value: FLGPreset; label: string }[] = [
  { value: 'strict', label: 'Strict' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'lenient', label: 'Lenient' },
];

function ClustersView({ events }: { events: readonly Event[] }) {
  const [preset, setPreset] = useState<FLGPreset>('balanced');

  const result = useMemo(
    () => (events.length >= 3 ? clusterEventsFLGBridged([...events], preset) : null),
    [events, preset],
  );

  const scatter = useMemo<ScatterDataPoint[]>(() => {
    if (!result) return [];
    let minT = Infinity;
    for (const c of result.clusters)
      for (const e of c.events) if (e.timestamp < minT) minT = e.timestamp;
    for (const e of result.unclustered) if (e.timestamp < minT) minT = e.timestamp;
    const pts: ScatterDataPoint[] = [];
    for (const c of result.clusters) {
      for (const e of c.events) {
        pts.push({ x: (e.timestamp - minT) / 3_600_000, y: e.duration, category: c.id });
      }
    }
    for (const e of result.unclustered) {
      pts.push({ x: (e.timestamp - minT) / 3_600_000, y: e.duration, category: 'unclustered' });
    }
    return pts;
  }, [result]);

  return (
    <div>
      <div className={styles.viewControls}>
        <div className={styles.presetRow} role="group" aria-label="Cluster sensitivity">
          {CLUSTER_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`${styles.presetBtn} ${preset === p.value ? styles.presetActive : ''}`}
              onClick={() => setPreset(p.value)}
              aria-pressed={preset === p.value}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {!result || scatter.length === 0 ? (
        <p className={styles.viewEmpty}>
          Not enough matched events for cluster analysis (minimum 3 required).
        </p>
      ) : (
        <>
          <dl className={styles.summaryStrip}>
            <div className={styles.summaryItem}>
              <dt>Clusters found</dt>
              <dd>{result.clusters.length}</dd>
            </div>
            <div className={styles.summaryItem}>
              <dt>Clustered events</dt>
              <dd>{result.clusters.reduce((s, c) => s + c.events.length, 0)}</dd>
            </div>
            <div className={styles.summaryItem}>
              <dt>Unclustered</dt>
              <dd>{result.unclustered.length}</dd>
            </div>
          </dl>
          <ChartContainer
            title="Event clusters (time vs duration)"
            height={420}
            exportFileName="event-clusters"
          >
            <ThemedScatterPlot
              data={scatter}
              xLabel="Hours into range"
              yLabel="Duration (s)"
              categoryKey="category"
              height={370}
            />
          </ChartContainer>
        </>
      )}
    </div>
  );
}

// ── Public dispatcher ────────────────────────────────────────────

export interface ResultsViewsProps {
  view: ViewId;
  events: readonly Event[];
}

export function ResultsViews({ view, events }: ResultsViewsProps) {
  return (
    <div className={styles.results}>
      {view === 'histogram' && <HistogramView events={events} />}
      {view === 'scatter' && <ScatterView events={events} />}
      {view === 'distributions' && <DistributionsView events={events} />}
      {view === 'intervals' && <IntervalsView events={events} />}
      {view === 'clusters' && <ClustersView events={events} />}
      {view === 'sleepStages' && <SleepStagesView events={events} />}
      <SummaryStrip events={events} />
    </div>
  );
}
