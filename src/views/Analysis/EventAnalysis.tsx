/**
 * Event Analysis view.
 *
 * Provides event density over time, duration distributions, clustering,
 * Kaplan-Meier survival analysis, false-negative screening, and
 * inter-event interval analysis.
 *
 * Event analysis functions operate on Event[] directly (not through
 * the AnalysisEngine worker), so data is fetched from IndexedDB and
 * analysis runs in the main thread with memoisation.
 *
 * @module views/Analysis/EventAnalysis
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChartContainer,
  ThemedBarChart,
  ThemedScatterPlot,
  KaplanMeierCurve,
} from '@/components/charts';
import type { ScatterDataPoint, SurvivalPoint } from '@/components/charts';
import { useAppStore } from '@/stores/useAppStore';
import { getDB } from '@/services/storage/getDB';
import type { Event, NightlyAggregate } from '@/types';
import {
  clusterEventsFLGBridged,
  eventDurationDistribution,
  interEventIntervals,
} from '@/analysis/events';
import { kaplanMeier } from '@/analysis/survival';
import type {
  ClusterResult,
  EventDurationStats,
  InterEventIntervalResult,
} from '@/analysis/events';
import type { KaplanMeierResult } from '@/analysis/survival';
import styles from './EventAnalysis.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventFilter = 'all' | 'ObstructiveApnea' | 'CentralApnea' | 'Hypopnea';
type ClusterPreset = 'strict' | 'balanced' | 'lenient';

interface EventFilterOption {
  id: EventFilter;
  label: string;
}

const EVENT_FILTERS: readonly EventFilterOption[] = [
  { id: 'all', label: 'All Events' },
  { id: 'ObstructiveApnea', label: 'Obstructive Apnea' },
  { id: 'CentralApnea', label: 'Central Apnea' },
  { id: 'Hypopnea', label: 'Hypopnea' },
];

const CLUSTER_PRESETS: readonly { id: ClusterPreset; label: string }[] = [
  { id: 'strict', label: 'Strict' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'lenient', label: 'Lenient' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function filterEvents(events: Event[], filter: EventFilter): Event[] {
  if (filter === 'all') return events;
  return events.filter((e) => e.type === filter);
}

// ---------------------------------------------------------------------------
// Data fetching hook
// ---------------------------------------------------------------------------

interface EventData {
  events: Event[];
  aggregates: NightlyAggregate[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function useEventData(): EventData {
  const dateRange = useAppStore((s) => s.dateRange);
  const [events, setEvents] = useState<Event[]>([]);
  const [aggregates, setAggregates] = useState<NightlyAggregate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const startStr = formatDate(dateRange.start);
  const endStr = formatDate(dateRange.end);

  const refetch = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const db = await getDB();
        const sessions = await db.getSessionsByDateRange(startStr, endStr);
        const aggs = await db.getNightlyAggregatesByDateRange(startStr, endStr);

        // Fetch events for all sessions in the range
        const allEvents: Event[] = [];
        for (const session of sessions) {
          const sessionEvents = await db.getEventsBySessionId(session.id);
          allEvents.push(...sessionEvents);
        }

        if (!cancelled) {
          setEvents(allEvents);
          setAggregates(aggs);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load event data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [startStr, endStr, refreshKey]);

  return { events, aggregates, loading, error, refetch };
}

// ---------------------------------------------------------------------------
// Sub-component: Event density over time
// ---------------------------------------------------------------------------

const EventDensitySection = React.memo(function EventDensitySection({
  aggregates,
}: {
  aggregates: NightlyAggregate[];
}) {
  const chartData = useMemo(() => {
    return aggregates
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((agg) => ({
        date: agg.date,
        obstructive: agg.eventsByType.obstructive,
        central: agg.eventsByType.central,
        hypopnea: agg.eventsByType.hypopnea,
        mixed: agg.eventsByType.mixed,
        rera: agg.eventsByType.rera,
      }));
  }, [aggregates]);

  if (chartData.length === 0) return null;

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Event Density Over Time</h2>
      <ChartContainer title="Events Per Night (Stacked)" height={400}>
        <ThemedBarChart
          data={chartData}
          xKey="date"
          xLabel="Date"
          yLabel="Events"
          height={350}
          bars={[
            { dataKey: 'obstructive', name: 'Obstructive', stackId: 'events' },
            { dataKey: 'central', name: 'Central', stackId: 'events' },
            { dataKey: 'hypopnea', name: 'Hypopnea', stackId: 'events' },
            { dataKey: 'mixed', name: 'Mixed', stackId: 'events' },
            { dataKey: 'rera', name: 'RERA', stackId: 'events' },
          ]}
        />
      </ChartContainer>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Event duration distribution
// ---------------------------------------------------------------------------

const DurationDistributionSection = React.memo(function DurationDistributionSection({
  events,
  filter,
}: {
  events: Event[];
  filter: EventFilter;
}) {
  const filtered = useMemo(() => filterEvents(events, filter), [events, filter]);

  const durationStats = useMemo<readonly EventDurationStats[]>(() => {
    if (filtered.length === 0) return [];
    return eventDurationDistribution(filtered);
  }, [filtered]);

  const chartData = useMemo(() => {
    return durationStats.map((stat) => ({
      type: stat.type,
      mean: Number(stat.mean.toFixed(1)),
      median: Number(stat.median.toFixed(1)),
      count: stat.count,
    }));
  }, [durationStats]);

  if (chartData.length === 0) return null;

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Event Duration Distribution</h2>
      <div className={styles.summaryGrid}>
        {durationStats.map((stat) => (
          <div key={stat.type} className={styles.summaryCard}>
            <p className={styles.summaryCardLabel}>{stat.type}</p>
            <p className={styles.summaryCardValue}>{stat.count}</p>
            <p className={styles.summaryCardLabel}>
              Mean: {stat.mean.toFixed(1)}s | Median: {stat.median.toFixed(1)}s
            </p>
          </div>
        ))}
      </div>
      <ChartContainer title="Mean Duration by Event Type" height={350}>
        <ThemedBarChart
          data={chartData}
          xKey="type"
          xLabel="Event Type"
          yLabel="Duration (seconds)"
          height={300}
          bars={[
            { dataKey: 'mean', name: 'Mean Duration' },
            { dataKey: 'median', name: 'Median Duration' },
          ]}
        />
      </ChartContainer>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Event clusters
// ---------------------------------------------------------------------------

const ClusterSection = React.memo(function ClusterSection({
  events,
  preset,
}: {
  events: Event[];
  preset: ClusterPreset;
}) {
  const clusterResult = useMemo<ClusterResult | null>(() => {
    if (events.length < 3) return null;
    return clusterEventsFLGBridged(events, preset);
  }, [events, preset]);

  const scatterData = useMemo<ScatterDataPoint[]>(() => {
    if (!clusterResult) return [];
    const points: ScatterDataPoint[] = [];
    for (const cluster of clusterResult.clusters) {
      for (const evt of cluster.events) {
        points.push({
          x: evt.timestamp / 1000, // seconds
          y: evt.duration,
          category: cluster.id,
        });
      }
    }
    // Add unclustered events
    for (const evt of clusterResult.unclustered) {
      points.push({
        x: evt.timestamp / 1000,
        y: evt.duration,
        category: 'unclustered',
      });
    }
    return points;
  }, [clusterResult]);

  if (!clusterResult || scatterData.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Event Clusters</h2>
        <div className={styles.emptyState}>
          <p>Not enough events for cluster analysis (minimum 3 required).</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Event Clusters ({preset})</h2>
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <p className={styles.summaryCardLabel}>Clusters Found</p>
          <p className={styles.summaryCardValue}>{clusterResult.clusters.length}</p>
        </div>
        <div className={styles.summaryCard}>
          <p className={styles.summaryCardLabel}>Clustered Events</p>
          <p className={styles.summaryCardValue}>
            {clusterResult.clusters.reduce((sum, c) => sum + c.events.length, 0)}
          </p>
        </div>
        <div className={styles.summaryCard}>
          <p className={styles.summaryCardLabel}>Unclustered Events</p>
          <p className={styles.summaryCardValue}>{clusterResult.unclustered.length}</p>
        </div>
      </div>
      <ChartContainer title="Event Clusters (time vs. duration)" height={400}>
        <ThemedScatterPlot
          data={scatterData}
          xLabel="Time (epoch seconds)"
          yLabel="Duration (seconds)"
          categoryKey="category"
          height={350}
        />
      </ChartContainer>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Kaplan-Meier survival
// ---------------------------------------------------------------------------

const SurvivalSection = React.memo(function SurvivalSection({
  aggregates,
}: {
  aggregates: NightlyAggregate[];
}) {
  const AHI_SEVERE_THRESHOLD = 15;

  const survivalResult = useMemo<KaplanMeierResult | null>(() => {
    if (aggregates.length < 3) return null;

    // Compute days between severe nights (AHI >= 15)
    const sorted = aggregates.slice().sort((a, b) => a.date.localeCompare(b.date));
    const durations: number[] = [];
    const eventFlags: boolean[] = [];

    let lastSevereIdx = -1;
    for (let i = 0; i < sorted.length; i++) {
      const agg = sorted[i];
      if (agg && agg.ahi >= AHI_SEVERE_THRESHOLD) {
        if (lastSevereIdx >= 0) {
          durations.push(i - lastSevereIdx);
          eventFlags.push(true);
        }
        lastSevereIdx = i;
      }
    }

    // If last event didn't end at the end, mark censored
    if (lastSevereIdx >= 0 && lastSevereIdx < sorted.length - 1) {
      durations.push(sorted.length - 1 - lastSevereIdx);
      eventFlags.push(false); // censored
    }

    if (durations.length < 2) return null;
    return kaplanMeier(durations, eventFlags);
  }, [aggregates]);

  if (!survivalResult) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Kaplan-Meier Survival Curve</h2>
        <div className={styles.emptyState}>
          <p>
            Not enough severe nights (AHI ≥ {AHI_SEVERE_THRESHOLD}) in the date range for survival
            analysis.
          </p>
        </div>
      </div>
    );
  }

  const survivalData: SurvivalPoint[] = survivalResult.times.map((t, i) => ({
    time: t,
    survival: survivalResult.survivors[i] ?? 0,
  }));

  const ciData = survivalResult.times.map((t, i) => ({
    time: t,
    lower: survivalResult.ciLower[i] ?? 0,
    upper: survivalResult.ciUpper[i] ?? 0,
  }));

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Kaplan-Meier Survival Curve</h2>
      <p className={styles.interpretation}>
        Time-to-recurrence of severe nights (AHI ≥ {AHI_SEVERE_THRESHOLD}).
        {survivalResult.medianSurvivalTime !== null
          ? ` Median time between severe nights: ${survivalResult.medianSurvivalTime.toFixed(0)} days.`
          : ' Median survival time not reached — severe nights are rare.'}
      </p>
      <ChartContainer title="Days Between Severe Nights" height={400}>
        <KaplanMeierCurve
          data={survivalData}
          confidenceInterval={ciData}
          xLabel="Days"
          yLabel="Survival probability"
          height={350}
        />
      </ChartContainer>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Inter-event intervals
// ---------------------------------------------------------------------------

const IntervalSection = React.memo(function IntervalSection({
  events,
  filter,
}: {
  events: Event[];
  filter: EventFilter;
}) {
  const filtered = useMemo(() => filterEvents(events, filter), [events, filter]);

  const intervalResult = useMemo<InterEventIntervalResult | null>(() => {
    if (filtered.length < 2) return null;
    return interEventIntervals(filtered);
  }, [filtered]);

  const histogramData = useMemo(() => {
    if (!intervalResult) return [];
    // Bin intervals into 30-second buckets
    const bucketSize = 30;
    const buckets = new Map<number, number>();
    for (const interval of intervalResult.intervals) {
      const bucket = Math.floor(interval / bucketSize) * bucketSize;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .slice(0, 30) // Limit to first 30 buckets for readability
      .map(([bucket, count]) => ({
        interval: `${bucket}–${bucket + bucketSize}s`,
        count,
      }));
  }, [intervalResult]);

  if (!intervalResult || histogramData.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Inter-Event Intervals</h2>
        <div className={styles.emptyState}>
          <p>Not enough events for inter-event interval analysis.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Inter-Event Intervals</h2>
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <p className={styles.summaryCardLabel}>Mean Interval</p>
          <p className={styles.summaryCardValue}>{intervalResult.mean.toFixed(1)}s</p>
        </div>
        <div className={styles.summaryCard}>
          <p className={styles.summaryCardLabel}>Median Interval</p>
          <p className={styles.summaryCardValue}>{intervalResult.median.toFixed(1)}s</p>
        </div>
        <div className={styles.summaryCard}>
          <p className={styles.summaryCardLabel}>Min / Max</p>
          <p className={styles.summaryCardValue}>
            {intervalResult.min.toFixed(0)}s / {intervalResult.max.toFixed(0)}s
          </p>
        </div>
      </div>
      <ChartContainer title="Distribution of Inter-Event Intervals" height={350}>
        <ThemedBarChart
          data={histogramData}
          xKey="interval"
          xLabel="Interval (seconds)"
          yLabel="Count"
          height={300}
          bars={[{ dataKey: 'count', name: 'Count' }]}
        />
      </ChartContainer>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className={styles.emptyState} role="status">
      <h2>No data available</h2>
      <p>Import CPAP data to see event analysis. Use the Data Management page to get started.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EventAnalysis() {
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const [clusterPreset, setClusterPreset] = useState<ClusterPreset>('balanced');

  const { events, aggregates, loading, error, refetch } = useEventData();

  const filteredEvents = useMemo(() => filterEvents(events, eventFilter), [events, eventFilter]);

  if (loading) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>Event Analysis</h1>
        <div className={styles.spinner} role="status" aria-label="Loading event data">
          Loading event data…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>Event Analysis</h1>
        <div className={styles.errorBox}>
          <p>{error}</p>
          <button className={styles.retryButton} onClick={refetch} type="button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (events.length === 0 && aggregates.length === 0) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>Event Analysis</h1>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className={styles.page} role="main" aria-labelledby="event-heading">
      <h1 id="event-heading" className={styles.heading}>
        Event Analysis
      </h1>

      {/* Controls */}
      <div className={styles.controls} role="toolbar" aria-label="Event analysis controls">
        <div className={styles.controlGroup}>
          <label className={styles.controlLabel} htmlFor="event-filter">
            Event Type
          </label>
          <select
            id="event-filter"
            className={styles.select}
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value as EventFilter)}
          >
            {EVENT_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.controlGroup}>
          <label className={styles.controlLabel} htmlFor="cluster-preset">
            Cluster Sensitivity
          </label>
          <select
            id="cluster-preset"
            className={styles.select}
            value={clusterPreset}
            onChange={(e) => setClusterPreset(e.target.value as ClusterPreset)}
          >
            {CLUSTER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary */}
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <p className={styles.summaryCardLabel}>Total Events</p>
          <p className={styles.summaryCardValue}>{events.length}</p>
        </div>
        <div className={styles.summaryCard}>
          <p className={styles.summaryCardLabel}>Filtered Events</p>
          <p className={styles.summaryCardValue}>{filteredEvents.length}</p>
        </div>
        <div className={styles.summaryCard}>
          <p className={styles.summaryCardLabel}>Nights Analyzed</p>
          <p className={styles.summaryCardValue}>{aggregates.length}</p>
        </div>
      </div>

      {/* Sections */}
      <EventDensitySection aggregates={aggregates} />
      <DurationDistributionSection events={events} filter={eventFilter} />
      <ClusterSection events={filteredEvents} preset={clusterPreset} />
      <SurvivalSection aggregates={aggregates} />
      <IntervalSection events={events} filter={eventFilter} />
    </div>
  );
}

export default EventAnalysis;
