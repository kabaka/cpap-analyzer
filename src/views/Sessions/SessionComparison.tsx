/**
 * Session Comparison view — side-by-side comparison of two therapy sessions.
 *
 * Provides session pickers, a delta-annotated metric table, and a CSS bar
 * chart for visual comparison. All processing is client-side.
 *
 * @module views/Sessions/SessionComparison
 */

import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Select, Skeleton } from '@/components/ui';
import { useAppStore } from '@/stores/useAppStore';
import { useSessionData } from '@/hooks/useSessionData';
import { useSessionDetail } from '@/hooks/useSignalData';
import type { NightlyAggregate } from '@/types';
import styles from './SessionComparison.module.css';
import { fmt, percentChange, deltaClass, readMetric } from './comparison-utils';
import type { ImprovementDirection } from './comparison-utils';

// ── Types ────────────────────────────────────────────────────────

interface MetricDefinition {
  key: keyof NightlyAggregate;
  label: string;
  unit: string;
  decimals: number;
  direction: ImprovementDirection;
}

interface ChartMetric {
  label: string;
  unit: string;
  valueA: number;
  valueB: number;
}

// ── Constants ────────────────────────────────────────────────────

/** Metric rows displayed in the comparison table. */
const COMPARISON_METRICS: MetricDefinition[] = [
  { key: 'ahi', label: 'AHI', unit: 'events/hr', decimals: 2, direction: 'lower' },
  {
    key: 'ahiObstructive',
    label: 'Obstructive AI',
    unit: 'events/hr',
    decimals: 2,
    direction: 'lower',
  },
  { key: 'ahiCentral', label: 'Central AI', unit: 'events/hr', decimals: 2, direction: 'lower' },
  {
    key: 'ahiHypopnea',
    label: 'Hypopnea Index',
    unit: 'events/hr',
    decimals: 2,
    direction: 'lower',
  },
  { key: 'leakMedian', label: 'Leak Median', unit: 'L/min', decimals: 1, direction: 'lower' },
  { key: 'leakP95', label: 'Leak P95', unit: 'L/min', decimals: 1, direction: 'lower' },
  { key: 'leakMax', label: 'Leak Max', unit: 'L/min', decimals: 1, direction: 'lower' },
  { key: 'pressureMean', label: 'Pressure Mean', unit: 'cmH₂O', decimals: 2, direction: 'lower' },
  { key: 'pressureP95', label: 'Pressure P95', unit: 'cmH₂O', decimals: 2, direction: 'lower' },
  { key: 'usageHours', label: 'Usage Hours', unit: 'hrs', decimals: 2, direction: 'higher' },
  { key: 'eventCount', label: 'Event Count', unit: '', decimals: 0, direction: 'lower' },
];

/** Subset of metrics shown in the bar chart. */
const CHART_METRIC_KEYS: (keyof NightlyAggregate)[] = [
  'ahi',
  'leakMedian',
  'usageHours',
  'pressureMean',
];

// ── Helpers ──────────────────────────────────────────────────────

/** Format a YYYY-MM-DD string as a human-readable date. */
function formatSessionDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// ── Sub-Components ───────────────────────────────────────────────

/** Bar fill that sets its width via a callback ref (avoids inline styles). */
function BarFill({ percent, variant }: { percent: number; variant: 'A' | 'B' }) {
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) el.style.width = `${percent}%`;
    },
    [percent],
  );
  const className = `${styles.barFill} ${variant === 'A' ? styles.barFillA : styles.barFillB}`;
  return <div ref={ref} className={className} />;
}

// ── Component ────────────────────────────────────────────────────

export default function SessionComparison() {
  const dateRange = useAppStore((s) => s.dateRange);
  const { sessions, loading: sessionsLoading, error: sessionsError } = useSessionData(dateRange);

  const [sessionAId, setSessionAId] = useState<string | null>(null);
  const [sessionBId, setSessionBId] = useState<string | null>(null);

  const detailA = useSessionDetail(sessionAId ?? undefined);
  const detailB = useSessionDetail(sessionBId ?? undefined);

  // Build select options from sessions list
  const sessionOptions = useMemo(
    () =>
      sessions.map((s) => ({
        value: s.id,
        label: formatSessionDate(s.date),
      })),
    [sessions],
  );

  // Options for picker A exclude the session selected in B and vice-versa
  const optionsA = useMemo(
    () => sessionOptions.filter((o) => o.value !== sessionBId),
    [sessionOptions, sessionBId],
  );

  const optionsB = useMemo(
    () => sessionOptions.filter((o) => o.value !== sessionAId),
    [sessionOptions, sessionAId],
  );

  const bothSelected = sessionAId !== null && sessionBId !== null;
  const detailLoading = detailA.loading || detailB.loading;
  const detailError = detailA.error ?? detailB.error;
  const aggregatesReady =
    bothSelected && !detailLoading && detailA.aggregate !== null && detailB.aggregate !== null;

  // Chart data computation
  const chartMetrics = useMemo<ChartMetric[]>(() => {
    const aggA = detailA.aggregate;
    const aggB = detailB.aggregate;
    if (!aggA || !aggB) return [];
    return CHART_METRIC_KEYS.reduce<ChartMetric[]>((acc, key) => {
      const def = COMPARISON_METRICS.find((m) => m.key === key);
      if (!def) return acc;
      const valueA = readMetric(aggA, key);
      const valueB = readMetric(aggB, key);
      // Skip metrics where either session lacks a value (per-hour rate
      // undefined on a too-short night) — a bar can't express a gap without
      // implying 0.
      if (valueA == null || valueB == null) return acc;
      acc.push({ label: def.label, unit: def.unit, valueA, valueB });
      return acc;
    }, []);
  }, [detailA.aggregate, detailB.aggregate]);

  // Labels for the selected sessions (for column headers)
  const labelA = detailA.session ? formatSessionDate(detailA.session.date) : 'Session A';
  const labelB = detailB.session ? formatSessionDate(detailB.session.date) : 'Session B';

  return (
    <div className={styles.container}>
      {/* ── Header ──────────────────────────────────────────── */}
      <div className={styles.header}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <Link to="/sessions" className={styles.breadcrumbLink}>
            Sessions
          </Link>
          <span className={styles.breadcrumbSep} aria-hidden="true">
            /
          </span>
          <span>Compare</span>
        </nav>
        <h1 className={styles.title}>Session Comparison</h1>
      </div>

      {/* ── Session Pickers ─────────────────────────────────── */}
      <div className={styles.panel}>
        {sessionsLoading ? (
          <div className={styles.skeletonTable}>
            <Skeleton width="100%" height={40} variant="rect" />
            <Skeleton width="100%" height={40} variant="rect" />
          </div>
        ) : sessionsError ? (
          <div className={styles.error}>
            <p className={styles.errorTitle}>Failed to load sessions</p>
            <p className={styles.errorMessage}>{sessionsError}</p>
          </div>
        ) : sessions.length < 2 ? (
          <div className={styles.prompt}>
            <span className={styles.promptIcon} aria-hidden="true">
              ⚖️
            </span>
            <p className={styles.promptTitle}>Not enough sessions</p>
            <p className={styles.promptDescription}>
              Import at least two therapy sessions to use the comparison tool.
            </p>
          </div>
        ) : (
          <div className={styles.pickerRow}>
            <div className={styles.pickerGroup}>
              <span className={styles.pickerLabel}>Session A</span>
              <Select
                label="Session A"
                placeholder="Select a session…"
                options={optionsA}
                value={sessionAId ?? undefined}
                onValueChange={(v) => setSessionAId(v)}
              />
            </div>
            <div className={styles.pickerGroup}>
              <span className={styles.pickerLabel}>Session B</span>
              <Select
                label="Session B"
                placeholder="Select a session…"
                options={optionsB}
                value={sessionBId ?? undefined}
                onValueChange={(v) => setSessionBId(v)}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Prompt to select ────────────────────────────────── */}
      {!bothSelected && !sessionsLoading && !sessionsError && sessions.length >= 2 && (
        <div className={styles.panel}>
          <div className={styles.prompt}>
            <span className={styles.promptIcon} aria-hidden="true">
              👆
            </span>
            <p className={styles.promptTitle}>Select two sessions</p>
            <p className={styles.promptDescription}>
              Choose a session in each dropdown above to see a side-by-side comparison.
            </p>
          </div>
        </div>
      )}

      {/* ── Loading State ───────────────────────────────────── */}
      {bothSelected && detailLoading && (
        <div className={styles.panel}>
          <div className={styles.skeletonTable}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className={styles.skeletonRow}>
                <Skeleton width="30%" height={20} variant="rect" />
                <Skeleton width="15%" height={20} variant="rect" />
                <Skeleton width="15%" height={20} variant="rect" />
                <Skeleton width="15%" height={20} variant="rect" />
                <Skeleton width="15%" height={20} variant="rect" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Error State ─────────────────────────────────────── */}
      {bothSelected && !detailLoading && detailError && (
        <div className={styles.panel}>
          <div className={styles.error}>
            <p className={styles.errorTitle}>Failed to load session details</p>
            <p className={styles.errorMessage}>{detailError}</p>
          </div>
        </div>
      )}

      {/* ── Comparison Table ────────────────────────────────── */}
      {aggregatesReady && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Metric Comparison</h2>
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.compareTable}>
              <thead>
                <tr>
                  <th scope="col" className={styles.th}>
                    Metric
                  </th>
                  <th
                    scope="col"
                    className={`${styles.th} ${styles.thNum} ${styles.sessionHeader}`}
                  >
                    {labelA}
                  </th>
                  <th
                    scope="col"
                    className={`${styles.th} ${styles.thNum} ${styles.sessionHeader}`}
                  >
                    {labelB}
                  </th>
                  <th scope="col" className={`${styles.th} ${styles.thNum}`}>
                    Delta
                  </th>
                  <th scope="col" className={`${styles.th} ${styles.thNum}`}>
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_METRICS.map((metric) => {
                  const aggA = detailA.aggregate;
                  const aggB = detailB.aggregate;
                  if (!aggA || !aggB) return null;
                  const valA = readMetric(aggA, metric.key);
                  const valB = readMetric(aggB, metric.key);
                  // A metric is null when its per-hour rate is undefined on a
                  // too-short night. Only compute delta/percent when BOTH
                  // sessions have a value; otherwise show em-dashes and skip
                  // the comparison (never treat a missing rate as 0).
                  const comparable = valA != null && valB != null;
                  const delta = comparable ? valB - valA : null;
                  const pct = comparable ? percentChange(valA, valB) : NaN;
                  const colorClass = delta != null ? deltaClass(delta, metric.direction) : '';

                  return (
                    <tr key={metric.key}>
                      <td className={styles.metricNameCell}>
                        {metric.label}
                        {metric.unit ? (
                          <span className={styles.metricUnit}> ({metric.unit})</span>
                        ) : null}
                      </td>
                      <td className={styles.numericCell}>{fmt(valA, metric.decimals)}</td>
                      <td className={styles.numericCell}>{fmt(valB, metric.decimals)}</td>
                      <td
                        className={`${styles.numericCell} ${colorClass}`}
                        title={delta == null ? 'Insufficient recording time' : undefined}
                      >
                        {delta == null
                          ? '—'
                          : `${delta > 0 ? '+' : ''}${fmt(delta, metric.decimals)}`}
                      </td>
                      <td
                        className={`${styles.numericCell} ${colorClass}`}
                        title={delta == null ? 'Insufficient recording time' : undefined}
                      >
                        {Number.isNaN(pct) ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Bar Chart ───────────────────────────────────────── */}
      {aggregatesReady && chartMetrics.length > 0 && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Visual Comparison</h2>
            <div className={styles.chartLegend}>
              <span className={styles.legendItem}>
                <span
                  className={`${styles.legendSwatch} ${styles.legendSwatchA}`}
                  aria-hidden="true"
                />
                {labelA}
              </span>
              <span className={styles.legendItem}>
                <span
                  className={`${styles.legendSwatch} ${styles.legendSwatchB}`}
                  aria-hidden="true"
                />
                {labelB}
              </span>
            </div>
          </div>

          <div className={styles.chartGrid} role="img" aria-label="Session comparison bar chart">
            {chartMetrics.map((m) => {
              const max = Math.max(m.valueA, m.valueB, 0.01); // avoid division by zero
              const pctA = (m.valueA / max) * 100;
              const pctB = (m.valueB / max) * 100;

              return (
                <div key={m.label} className={styles.barMetric}>
                  <span className={styles.barMetricLabel}>
                    {m.label} ({m.unit})
                  </span>
                  <div className={styles.barRow}>
                    <div className={styles.barTrack}>
                      <BarFill percent={pctA} variant="A" />
                    </div>
                    <span className={styles.barValueOut}>{fmt(m.valueA, 2)}</span>
                  </div>
                  <div className={styles.barRow}>
                    <div className={styles.barTrack}>
                      <BarFill percent={pctB} variant="B" />
                    </div>
                    <span className={styles.barValueOut}>{fmt(m.valueB, 2)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
