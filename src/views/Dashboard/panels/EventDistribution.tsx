/**
 * Event Distribution panel — stacked area chart showing event type breakdown.
 *
 * @module views/Dashboard/panels/EventDistribution
 */

import React, { useMemo } from 'react';
import { Card } from '@/components/ui';
import { ThemedAreaChart } from '@/components/charts/recharts';
import type { AreaConfig } from '@/components/charts/recharts';
import type { TrendDataPoint } from '@/hooks/useSummaryStats';
import styles from './EventDistribution.module.css';

interface EventDistributionProps {
  trendData: TrendDataPoint[];
  loading: boolean;
}

/** Format ISO date to short "Mon DD" format. */
function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const AREA_CONFIG: AreaConfig[] = [
  { dataKey: 'obstructive', name: 'Obstructive', stackId: 'events', fillOpacity: 0.6 },
  { dataKey: 'central', name: 'Central', stackId: 'events', fillOpacity: 0.6 },
  { dataKey: 'hypopnea', name: 'Hypopnea', stackId: 'events', fillOpacity: 0.6 },
  { dataKey: 'mixed', name: 'Mixed', stackId: 'events', fillOpacity: 0.6 },
  { dataKey: 'rera', name: 'RERA', stackId: 'events', fillOpacity: 0.6 },
];

const EventDistribution = React.memo(function EventDistribution({
  trendData,
  loading,
}: EventDistributionProps) {
  const chartData = useMemo(
    () =>
      trendData.map((d) => ({
        label: formatShortDate(d.date),
        obstructive: d.eventsByType.obstructive,
        central: d.eventsByType.central,
        hypopnea: d.eventsByType.hypopnea,
        mixed: d.eventsByType.mixed,
        rera: d.eventsByType.rera,
      })),
    [trendData],
  );

  const meanObstructive = useMemo(() => {
    if (trendData.length === 0) return 0;
    return trendData.reduce((sum, d) => sum + d.eventsByType.obstructive, 0) / trendData.length;
  }, [trendData]);

  if (loading) {
    return (
      <Card className={styles.card}>
        <h3 className={styles.title}>Event Distribution</h3>
        <div className={styles.chartSkeleton} />
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card className={styles.card}>
        <h3 className={styles.title}>Event Distribution</h3>
        <p className={styles.empty}>No event data available for this date range.</p>
      </Card>
    );
  }

  return (
    <Card className={styles.card}>
      <h3 className={styles.title}>Event Distribution</h3>
      <div aria-label="Event type distribution over the selected period">
        <span className={styles.srOnly}>
          Event distribution across 5 event types over {trendData.length} days. Obstructive events
          are the most frequent at an average of {meanObstructive.toFixed(1)} per night.
        </span>
        <ThemedAreaChart data={chartData} areas={AREA_CONFIG} xKey="label" height={280} />
      </div>
    </Card>
  );
});

export default EventDistribution;
