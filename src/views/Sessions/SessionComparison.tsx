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
import {
  Card,
  Select,
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';
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

/** Bar value label positioned via callback ref (avoids inline styles). */
function BarValueLabel({
  percent,
  value,
  inside,
}: {
  percent: number;
  value: string;
  inside: boolean;
}) {
  const ref = useCallback(
    (el: HTMLSpanElement | null) => {
      if (!el) return;
      if (inside) {
        el.style.right = 'auto';
        el.style.left = `${Math.min(percent - 1, 95)}%`;
        el.style.transform = 'translate(-100%, -50%)';
      }
    },
    [percent, inside],
  );
  const className = `${styles.barValue} ${inside ? styles.barValueInside : ''}`;
  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  );
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
      acc.push({
        label: def.label,
        unit: def.unit,
        valueA: readMetric(aggA, key),
        valueB: readMetric(aggB, key),
      });
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
        <div className={styles.headerLeft}>
          <nav className={styles.breadcrumb}>
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
      </div>

      {/* ── Session Pickers ─────────────────────────────────── */}
      <Card>
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
      </Card>

      {/* ── Prompt to select ────────────────────────────────── */}
      {!bothSelected && !sessionsLoading && !sessionsError && sessions.length >= 2 && (
        <Card>
          <div className={styles.prompt}>
            <span className={styles.promptIcon} aria-hidden="true">
              👆
            </span>
            <p className={styles.promptTitle}>Select two sessions</p>
            <p className={styles.promptDescription}>
              Choose a session in each dropdown above to see a side-by-side comparison.
            </p>
          </div>
        </Card>
      )}

      {/* ── Loading State ───────────────────────────────────── */}
      {bothSelected && detailLoading && (
        <Card>
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
        </Card>
      )}

      {/* ── Error State ─────────────────────────────────────── */}
      {bothSelected && !detailLoading && detailError && (
        <Card>
          <div className={styles.error}>
            <p className={styles.errorTitle}>Failed to load session details</p>
            <p className={styles.errorMessage}>{detailError}</p>
          </div>
        </Card>
      )}

      {/* ── Comparison Table ────────────────────────────────── */}
      {aggregatesReady && (
        <Card>
          <h2 className={styles.sectionTitle}>Metric Comparison</h2>
          <div className={styles.tableWrapper}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className={`${styles.numericCell} ${styles.sessionHeader}`}>
                    {labelA}
                  </TableHead>
                  <TableHead className={`${styles.numericCell} ${styles.sessionHeader}`}>
                    {labelB}
                  </TableHead>
                  <TableHead className={styles.numericCell}>Delta</TableHead>
                  <TableHead className={styles.numericCell}>Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {COMPARISON_METRICS.map((metric) => {
                  const aggA = detailA.aggregate;
                  const aggB = detailB.aggregate;
                  if (!aggA || !aggB) return null;
                  const valA = readMetric(aggA, metric.key);
                  const valB = readMetric(aggB, metric.key);
                  const delta = valB - valA;
                  const pct = percentChange(valA, valB);
                  const colorClass = deltaClass(delta, metric.direction);

                  return (
                    <TableRow key={metric.key}>
                      <TableCell className={styles.metricNameCell}>
                        {metric.label}
                        {metric.unit ? (
                          <span className={styles.metricUnit}> ({metric.unit})</span>
                        ) : null}
                      </TableCell>
                      <TableCell className={styles.numericCell}>
                        {fmt(valA, metric.decimals)}
                      </TableCell>
                      <TableCell className={styles.numericCell}>
                        {fmt(valB, metric.decimals)}
                      </TableCell>
                      <TableCell className={`${styles.numericCell} ${colorClass}`}>
                        {delta > 0 ? '+' : ''}
                        {fmt(delta, metric.decimals)}
                      </TableCell>
                      <TableCell className={`${styles.numericCell} ${colorClass}`}>
                        {Number.isNaN(pct) ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* ── Bar Chart ───────────────────────────────────────── */}
      {aggregatesReady && chartMetrics.length > 0 && (
        <Card>
          <div className={styles.chartSection}>
            <h2 className={styles.sectionTitle}>Visual Comparison</h2>

            <div className={styles.chartLegend}>
              <span className={styles.legendItem}>
                <span className={`${styles.legendSwatch} ${styles.legendSwatchA}`} />
                {labelA}
              </span>
              <span className={styles.legendItem}>
                <span className={`${styles.legendSwatch} ${styles.legendSwatchB}`} />
                {labelB}
              </span>
            </div>

            <div className={styles.chartGrid} role="img" aria-label="Session comparison bar chart">
              {chartMetrics.map((m) => {
                const max = Math.max(m.valueA, m.valueB, 0.01); // avoid division by zero
                const pctA = (m.valueA / max) * 100;
                const pctB = (m.valueB / max) * 100;
                const showInsideA = pctA > 40;
                const showInsideB = pctB > 40;

                return (
                  <div key={m.label} className={styles.chartRow}>
                    <span className={styles.chartLabel}>
                      {m.label} ({m.unit})
                    </span>
                    <div className={styles.barGroup}>
                      <div className={styles.barTrack}>
                        <BarFill percent={pctA} variant="A" />
                        <BarValueLabel
                          percent={pctA}
                          value={fmt(m.valueA, 2)}
                          inside={showInsideA}
                        />
                      </div>
                      <span className={styles.barLabel}>{labelA}</span>

                      <div className={styles.barTrack}>
                        <BarFill percent={pctB} variant="B" />
                        <BarValueLabel
                          percent={pctB}
                          value={fmt(m.valueB, 2)}
                          inside={showInsideB}
                        />
                      </div>
                      <span className={styles.barLabel}>{labelB}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
