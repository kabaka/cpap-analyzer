/**
 * Explore → Machine Configurations.
 *
 * Lets users compare therapy outcomes across machine-configuration periods —
 * runs of consecutive nights with the same min/max pressure and EPR. Answers
 * questions like "which max pressure gave me the best AHI?" by showing
 * outcome distributions side-by-side per configuration, plus a lightweight
 * outcome-vs-setting scatter ("Optimize" sub-mode).
 *
 * Periods are segmented by {@link buildConfigPeriods}. The persistent
 * {@link ConfoundingCaveat} reminds the user that observed differences are
 * associations, not proven effects of the setting change — periods also
 * differ in season, weight, illness, and adherence.
 *
 * @module views/Explore/Configurations/Configurations
 */

import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';

import { DateRangeSelector } from '@/components/domain/DateRangeSelector';
import { Badge, Button, Card, Select, Switch } from '@/components/ui';
import { BoxPlot, type BoxPlotGroup } from '@/components/charts/d3';
import { paletteColor, useChartColors } from '@/components/charts/useChartColors';
import { useNightlyAggregates } from '@/hooks/useNightlyAggregates';
import { useAppStore } from '@/stores/useAppStore';
import { classifyAhiSeverity, type AhiSeverity } from '@/analysis/clinical';
import type { NightlyAggregate } from '@/types';

import {
  buildConfigPeriods,
  formatConfigKey,
  type ConfigPeriod,
  type OutcomeSummary,
} from './configPeriods';
import ConfoundingCaveat from './ConfoundingCaveat';
import styles from './Configurations.module.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of configs comparable at once. UX-derived to avoid
 *  overwhelming the box-plot. */
const MAX_SELECTED = 6;

/** Per-period night minimum below which comparisons are flagged unreliable.
 *  Mirrors common clinical reporting practice (≥ 1 week of data). */
const MIN_NIGHTS_RELIABLE = 7;

/** Default-hidden short periods threshold (anything shorter is hidden until
 *  the "show short periods" switch is on). */
const SHORT_PERIOD_THRESHOLD = 3;

const SEVERITY_LABEL: Record<AhiSeverity, string> = {
  normal: 'Normal',
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
};

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

type MetricId = 'ahi' | 'centralIndex' | 'leakMedian' | 'usageHours';
type SettingAxis = 'minPressure' | 'maxPressure' | 'eprLevel';

interface MetricDef {
  readonly id: MetricId;
  readonly label: string;
  readonly axisLabel: string;
  readonly unit: string;
  readonly getNightValue: (a: NightlyAggregate) => number;
  readonly getSummary: (p: ConfigPeriod) => OutcomeSummary | null;
  /** Lower is better (the typical case for clinical outcomes). */
  readonly lowerIsBetter: boolean;
}

const METRICS: readonly MetricDef[] = [
  {
    id: 'ahi',
    label: 'AHI',
    axisLabel: 'AHI (events/h)',
    unit: 'events/h',
    getNightValue: (a) => a.ahi,
    getSummary: (p) => p.outcomes.ahi,
    lowerIsBetter: true,
  },
  {
    id: 'centralIndex',
    label: 'Central index',
    axisLabel: 'Central apneas (events/h)',
    unit: 'events/h',
    getNightValue: (a) => a.ahiCentral,
    getSummary: (p) => p.outcomes.centralIndex,
    lowerIsBetter: true,
  },
  {
    id: 'leakMedian',
    label: 'Leak (median)',
    axisLabel: 'Median leak (L/min)',
    unit: 'L/min',
    getNightValue: (a) => a.leakMedian,
    getSummary: (p) => p.outcomes.leakMedian,
    lowerIsBetter: true,
  },
  {
    id: 'usageHours',
    label: 'Usage hours',
    axisLabel: 'Usage (h/night)',
    unit: 'h',
    getNightValue: (a) => a.usageHours,
    getSummary: (p) => p.outcomes.usageHours,
    lowerIsBetter: false,
  },
];

const SETTING_AXES: readonly { id: SettingAxis; label: string; unit: string }[] = [
  { id: 'minPressure', label: 'Min pressure', unit: 'cmH₂O' },
  { id: 'maxPressure', label: 'Max pressure', unit: 'cmH₂O' },
  { id: 'eprLevel', label: 'EPR level', unit: '' },
];

function settingValue(p: ConfigPeriod, axis: SettingAxis): number | null {
  switch (axis) {
    case 'minPressure':
      return p.settings.minPressure;
    case 'maxPressure':
      return p.settings.maxPressure;
    case 'eprLevel':
      return p.settings.eprLevel;
  }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function Configurations(): JSX.Element {
  const dateRange = useAppStore((s) => s.dateRange);
  const { aggregates, loading, error } = useNightlyAggregates(dateRange);

  const periods = useMemo(() => buildConfigPeriods(aggregates), [aggregates]);
  const realPeriods = useMemo(() => periods.filter((p) => p.kind === 'config'), [periods]);

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [metric, setMetric] = useState<MetricId>('ahi');
  const [showShort, setShowShort] = useState(false);
  const [mode, setMode] = useState<'compare' | 'optimize'>('compare');
  const [optimizeOutcome, setOptimizeOutcome] = useState<MetricId>('ahi');
  const [optimizeAxis, setOptimizeAxis] = useState<SettingAxis>('maxPressure');

  // Auto-select the two largest real periods by default once data arrives, so
  // the comparison surface is never empty on first render when comparison is
  // possible.
  const initializedRef = useMemo(() => ({ done: false }), []);
  if (!initializedRef.done && realPeriods.length >= 2 && selectedIds.length === 0) {
    const top = [...realPeriods].sort((a, b) => b.nights - a.nights).slice(0, 2);
    initializedRef.done = true;
    // Defer state set until after render — React's setState during render
    // would warn. Use a microtask.
    queueMicrotask(() => setSelectedIds(top.map((p) => p.id)));
  }

  const visiblePeriods = useMemo(
    () => (showShort ? periods : periods.filter((p) => p.nights >= SHORT_PERIOD_THRESHOLD)),
    [periods, showShort],
  );

  const selectedPeriods = useMemo(
    () => periods.filter((p) => selectedIds.includes(p.id)),
    [periods, selectedIds],
  );

  const toggleSelected = (id: string): void => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECTED) return prev; // hit cap
      return [...prev, id];
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={styles.page} role="main" aria-labelledby="configs-heading">
      <header className={styles.pageHeader}>
        <div>
          <h1 id="configs-heading" className={styles.pageTitle}>
            Machine configurations
          </h1>
          <p className={styles.pageSubtitle}>
            Compare therapy outcomes across periods where your machine settings stayed the same.
            Select two or more configurations to see how your AHI, central index, leak, and usage
            differed — useful for understanding how a pressure or EPR change affected your therapy.
          </p>
        </div>
        <DateRangeSelector />
      </header>

      {loading && <p className={styles.muted}>Loading nightly data…</p>}
      {error && !loading && (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      )}

      {!loading && !error && periods.length === 0 && <EmptyNoData />}

      {!loading && !error && periods.length > 0 && realPeriods.length === 0 && <EmptyNoSettings />}

      {!loading && !error && realPeriods.length === 1 && (
        <SingleConfigNote period={realPeriods[0]} />
      )}

      {!loading && !error && realPeriods.length >= 1 && (
        <>
          <PeriodTable
            periods={visiblePeriods}
            selectedIds={selectedIds}
            onToggle={toggleSelected}
            showShort={showShort}
            onShowShortChange={setShowShort}
            totalShort={periods.filter((p) => p.nights < SHORT_PERIOD_THRESHOLD).length}
          />

          <Card className={styles.compareCard}>
            <header className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>Outcome comparison</h2>
                <p className={styles.sectionSubtitle}>
                  Side-by-side distributions for the configurations selected above.
                </p>
              </div>
              <div className={styles.modeToggle}>
                <ModeTabs mode={mode} onChange={setMode} />
              </div>
            </header>

            {mode === 'compare' ? (
              <CompareSection
                periods={selectedPeriods}
                metric={metric}
                onMetricChange={setMetric}
              />
            ) : (
              <OptimizeSection
                periods={realPeriods}
                outcome={optimizeOutcome}
                onOutcomeChange={setOptimizeOutcome}
                axis={optimizeAxis}
                onAxisChange={setOptimizeAxis}
              />
            )}
          </Card>

          <ConfoundingCaveat />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Period table
// ---------------------------------------------------------------------------

interface PeriodTableProps {
  readonly periods: readonly ConfigPeriod[];
  readonly selectedIds: readonly string[];
  readonly onToggle: (id: string) => void;
  readonly showShort: boolean;
  readonly onShowShortChange: (next: boolean) => void;
  readonly totalShort: number;
}

function PeriodTable({
  periods,
  selectedIds,
  onToggle,
  showShort,
  onShowShortChange,
  totalShort,
}: PeriodTableProps): JSX.Element {
  const colors = useChartColors();

  // Index a stable identity colour per selected id, based on the order it
  // was selected. We re-derive it from the selectedIds array passed in by the
  // parent so the colour is consistent everywhere the period appears.
  const colorFor = (id: string): string => {
    const idx = selectedIds.indexOf(id);
    if (idx < 0) return 'transparent';
    return paletteColor(colors, idx);
  };

  return (
    <Card className={styles.tableCard}>
      <header className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Configuration periods</h2>
          <p className={styles.sectionSubtitle}>
            Select two or more periods to compare. Up to {MAX_SELECTED} can be compared at once.
          </p>
        </div>
        {totalShort > 0 && (
          <label className={styles.shortToggle}>
            <Switch checked={showShort} onCheckedChange={onShowShortChange} />
            <span>
              Show short periods{' '}
              <span className={styles.muted}>
                (&lt; {SHORT_PERIOD_THRESHOLD} nights, {totalShort} hidden)
              </span>
            </span>
          </label>
        )}
      </header>

      <div className={styles.tableWrap} role="region" aria-label="Configuration periods">
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" aria-label="Select" className={styles.colSelect} />
              <th scope="col">Period</th>
              <th scope="col">Settings</th>
              <th scope="col" className={styles.numCol}>
                Nights
              </th>
              <th scope="col" className={styles.numCol}>
                AHI
              </th>
              <th scope="col" className={styles.numCol}>
                Central
              </th>
              <th scope="col" className={styles.numCol}>
                Leak (median)
              </th>
              <th scope="col" className={styles.numCol}>
                Usage
              </th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <PeriodRow
                key={p.id}
                period={p}
                selected={selectedIds.includes(p.id)}
                onToggle={() => onToggle(p.id)}
                identityColor={colorFor(p.id)}
                disabledCap={!selectedIds.includes(p.id) && selectedIds.length >= MAX_SELECTED}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

interface PeriodRowProps {
  readonly period: ConfigPeriod;
  readonly selected: boolean;
  readonly onToggle: () => void;
  readonly identityColor: string;
  readonly disabledCap: boolean;
}

function PeriodRow({
  period,
  selected,
  onToggle,
  identityColor,
  disabledCap,
}: PeriodRowProps): JSX.Element {
  const tooFew = period.kind === 'config' && period.nights < MIN_NIGHTS_RELIABLE;
  const settingsLabel = formatConfigKey(period.settings);
  const ahiSummary = period.outcomes.ahi;
  const severity = ahiSummary !== null ? classifyAhiSeverity(ahiSummary.mean) : null;
  const rowLabel = `${period.startDate} to ${period.endDate}, ${settingsLabel}, ${period.nights} nights`;

  const rowClass = [
    styles.row,
    selected ? styles.rowSelected : '',
    period.kind !== 'config' ? styles.rowDimmed : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleRowClick = (): void => {
    if (period.kind !== 'config') return;
    if (disabledCap) return;
    onToggle();
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTableRowElement>): void => {
    if (period.kind !== 'config') return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!disabledCap || selected) onToggle();
    }
  };

  return (
    <tr
      className={rowClass}
      onClick={handleRowClick}
      onKeyDown={handleKey}
      tabIndex={period.kind === 'config' ? 0 : -1}
      role="row"
      aria-selected={selected}
      aria-label={rowLabel}
    >
      <td className={styles.colSelect}>
        {period.kind === 'config' ? (
          <span
            className={styles.checkboxWrap}
            style={selected ? { color: identityColor } : undefined}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              onClick={(e) => e.stopPropagation()}
              disabled={disabledCap && !selected}
              aria-label={`Compare ${rowLabel}`}
            />
            {selected && (
              <span
                aria-hidden="true"
                className={styles.swatch}
                style={{ background: identityColor }}
              />
            )}
          </span>
        ) : (
          <span className={styles.kindMarker} aria-hidden="true">
            —
          </span>
        )}
      </td>
      <td>
        <div className={styles.dateRange}>
          <span className={styles.datePill}>
            {period.startDate} → {period.endDate}
          </span>
        </div>
      </td>
      <td>
        {period.kind === 'config' ? (
          <SettingChips period={period} />
        ) : period.kind === 'unknown' ? (
          <Badge variant="default">No settings recorded</Badge>
        ) : (
          <Badge variant="warning">Sentinel / unreliable</Badge>
        )}
      </td>
      <td className={styles.numCol}>
        <span className={styles.nights}>{period.nights}</span>
        {tooFew && (
          <Badge variant="warning" className={styles.smallBadge}>
            n &lt; {MIN_NIGHTS_RELIABLE}
          </Badge>
        )}
      </td>
      <td className={styles.numCol}>
        {ahiSummary !== null && severity !== null ? (
          <span className={styles.metricCell}>
            <SeverityDot severity={severity} />
            <span>{ahiSummary.mean.toFixed(1)}</span>
            <span className={styles.metricUnit} aria-label={SEVERITY_LABEL[severity]}>
              ({SEVERITY_LABEL[severity]})
            </span>
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </td>
      <td className={styles.numCol}>
        {period.outcomes.centralIndex !== null ? (
          period.outcomes.centralIndex.mean.toFixed(1)
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </td>
      <td className={styles.numCol}>
        {period.outcomes.leakMedian !== null ? (
          period.outcomes.leakMedian.mean.toFixed(1)
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </td>
      <td className={styles.numCol}>
        {period.outcomes.usageHours !== null ? (
          `${period.outcomes.usageHours.mean.toFixed(1)} h`
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </td>
    </tr>
  );
}

function SettingChips({ period }: { readonly period: ConfigPeriod }): JSX.Element {
  return (
    <div className={styles.chips}>
      {period.settings.minPressure !== null && (
        <span className={styles.chip}>min {period.settings.minPressure.toFixed(1)}</span>
      )}
      {period.settings.maxPressure !== null && (
        <span className={styles.chip}>max {period.settings.maxPressure.toFixed(1)}</span>
      )}
      {period.settings.eprLevel !== null && (
        <span className={styles.chip}>EPR {period.settings.eprLevel}</span>
      )}
    </div>
  );
}

function SeverityDot({
  severity,
}: {
  readonly severity: 'normal' | 'mild' | 'moderate' | 'severe';
}): JSX.Element {
  return (
    <span
      className={`${styles.dot} ${styles[`dot-${severity}`] ?? ''}`}
      aria-hidden="true"
      title={SEVERITY_LABEL[severity]}
    />
  );
}

// ---------------------------------------------------------------------------
// Compare section
// ---------------------------------------------------------------------------

interface CompareSectionProps {
  readonly periods: readonly ConfigPeriod[];
  readonly metric: MetricId;
  readonly onMetricChange: (m: MetricId) => void;
}

function CompareSection({ periods, metric, onMetricChange }: CompareSectionProps): JSX.Element {
  // METRICS is a non-empty literal so `metricDef` is always defined. We avoid
  // an early return between hooks (would break hook ordering) by keeping the
  // narrowing via `useMemo` rather than a conditional return.
  const metricDef = useMemo(
    () => METRICS.find((m) => m.id === metric) ?? METRICS[0] ?? null,
    [metric],
  );

  const groups: BoxPlotGroup[] = useMemo(
    () =>
      metricDef === null
        ? []
        : periods.map((p) => ({
            label: `${formatConfigKey(p.settings)} (n=${p.nights})`,
            values: p.aggregates.map((a) => metricDef.getNightValue(a)),
          })),
    [periods, metricDef],
  );

  if (!metricDef) {
    return <p className={styles.muted}>No metric available.</p>;
  }

  return (
    <div className={styles.compareBody}>
      <div className={styles.metricRow}>
        <label className={styles.metricLabel}>
          <span>Metric</span>
          <Select
            value={metric}
            onValueChange={(v) => onMetricChange(v as MetricId)}
            options={METRICS.map((m) => ({ value: m.id, label: m.label }))}
            aria-label="Outcome metric"
          />
        </label>
      </div>

      {periods.length === 0 && (
        <p className={styles.muted}>
          Select one or more configurations to see their distributions.
        </p>
      )}

      {periods.length === 1 && (
        <SinglePeriodStrip period={periods[0] as ConfigPeriod} metric={metricDef} />
      )}

      {periods.length >= 2 && (
        <>
          <BoxPlot data={groups} height={320} />
          <p className={styles.axisCaption}>{metricDef.axisLabel}</p>
        </>
      )}

      {periods.length === 2 && <DiffReadout periods={periods} metric={metricDef} />}
    </div>
  );
}

function SinglePeriodStrip({
  period,
  metric,
}: {
  readonly period: ConfigPeriod;
  readonly metric: MetricDef;
}): JSX.Element {
  const colors = useChartColors();
  const values = period.aggregates.map((a) => metric.getNightValue(a));
  const max = Math.max(1, ...values);
  const width = 600;
  const height = 80;
  const padding = 24;
  const inner = width - padding * 2;

  return (
    <figure className={styles.strip}>
      <figcaption className={styles.stripCaption}>
        {metric.label} per night across {formatConfigKey(period.settings)} (n={period.nights}).
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric.label} per night`}>
        <line
          x1={padding}
          x2={width - padding}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--color-chart-grid)"
        />
        {values.map((v, i) => {
          const x = padding + (inner * i) / Math.max(1, values.length - 1);
          const y = height / 2 - (v / max) * (height / 2 - 8);
          return <circle key={i} cx={x} cy={y} r={3} fill={paletteColor(colors, 0)} />;
        })}
      </svg>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Diff readout (n=2)
// ---------------------------------------------------------------------------

function DiffReadout({
  periods,
  metric,
}: {
  readonly periods: readonly ConfigPeriod[];
  readonly metric: MetricDef;
}): JSX.Element | null {
  const a = periods[0];
  const b = periods[1];
  if (!a || !b) return null;
  const aSum = metric.getSummary(a);
  const bSum = metric.getSummary(b);
  if (!aSum || !bSum) return null;

  const delta = bSum.mean - aSum.mean;
  const pct = aSum.mean !== 0 ? (delta / aSum.mean) * 100 : null;
  // Directionality glyph — favourable (improvement) vs unfavourable depends on
  // metric semantics. Render the literal arithmetic direction; the colour is
  // muted so favourability is signalled by the explicit "Δ ..." copy and the
  // accessible aria-label below.
  const glyph = delta < 0 ? '▼' : delta > 0 ? '▲' : '◇';
  const direction = delta < 0 ? 'decreased' : delta > 0 ? 'increased' : 'unchanged';
  const isFavourable = metric.lowerIsBetter ? delta < 0 : delta > 0;
  const aLabel = formatConfigKey(a.settings);
  const bLabel = formatConfigKey(b.settings);

  const tooFew = aSum.n < MIN_NIGHTS_RELIABLE || bSum.n < MIN_NIGHTS_RELIABLE;

  return (
    <div className={styles.diff} role="status">
      <div
        className={isFavourable ? styles.diffHeadlineFavourable : styles.diffHeadlineUnfavourable}
        aria-label={`${metric.label} ${direction} by ${Math.abs(delta).toFixed(1)} ${metric.unit}${
          pct !== null ? `, ${pct.toFixed(0)} percent` : ''
        } from ${aLabel} to ${bLabel}`}
      >
        <span className={styles.diffGlyph} aria-hidden="true">
          {glyph}
        </span>
        <span>
          {metric.label} Δ {delta >= 0 ? '+' : '−'}
          {Math.abs(delta).toFixed(1)} {metric.unit}
          {pct !== null && (
            <>
              {' '}
              <span className={styles.diffPct}>
                ({pct >= 0 ? '+' : '−'}
                {Math.abs(pct).toFixed(0)}%)
              </span>
            </>
          )}
        </span>
      </div>
      <p className={styles.diffSubtitle}>
        <strong>{bLabel}</strong> vs <strong>{aLabel}</strong> · n=
        {bSum.n}/{aSum.n}
      </p>
      {tooFew && (
        <Badge variant="warning" className={styles.diffBadge}>
          n too small for reliable comparison (&lt; {MIN_NIGHTS_RELIABLE} nights)
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Optimize section
// ---------------------------------------------------------------------------

interface OptimizeSectionProps {
  readonly periods: readonly ConfigPeriod[];
  readonly outcome: MetricId;
  readonly onOutcomeChange: (m: MetricId) => void;
  readonly axis: SettingAxis;
  readonly onAxisChange: (a: SettingAxis) => void;
}

function OptimizeSection({
  periods,
  outcome,
  onOutcomeChange,
  axis,
  onAxisChange,
}: OptimizeSectionProps): JSX.Element {
  const colors = useChartColors();
  const metric = METRICS.find((m) => m.id === outcome) ?? METRICS[0];
  if (!metric) return <p className={styles.muted}>No metric available.</p>;

  const axisDef = SETTING_AXES.find((a) => a.id === axis) ?? SETTING_AXES[0];
  if (!axisDef) return <p className={styles.muted}>No axis available.</p>;

  const points = periods
    .map((p) => ({
      period: p,
      x: settingValue(p, axis),
      summary: metric.getSummary(p),
    }))
    .filter(
      (pt): pt is { period: ConfigPeriod; x: number; summary: OutcomeSummary } =>
        pt.x !== null && pt.summary !== null,
    );

  const width = 640;
  const height = 320;
  const margin = { top: 16, right: 24, bottom: 48, left: 56 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  if (points.length === 0) {
    return (
      <div className={styles.compareBody}>
        <OptimizeControls
          outcome={outcome}
          onOutcomeChange={onOutcomeChange}
          axis={axis}
          onAxisChange={onAxisChange}
        />
        <p className={styles.muted}>
          No configurations recorded a value for {axisDef.label.toLowerCase()}.
        </p>
      </div>
    );
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.summary.mean);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.1 || 1;
  const yPad = (yMax - yMin) * 0.1 || 1;

  const xScale = (v: number): number =>
    margin.left + (innerW * (v - (xMin - xPad))) / (xMax + xPad - (xMin - xPad));
  const yScale = (v: number): number =>
    margin.top + innerH - (innerH * (v - (yMin - yPad))) / (yMax + yPad - (yMin - yPad));

  const nightsMin = Math.min(...points.map((p) => p.period.nights));
  const nightsMax = Math.max(...points.map((p) => p.period.nights));
  const radiusFor = (n: number): number => {
    if (nightsMax === nightsMin) return 6;
    return 4 + (10 * (n - nightsMin)) / (nightsMax - nightsMin);
  };

  return (
    <div className={styles.compareBody}>
      <OptimizeControls
        outcome={outcome}
        onOutcomeChange={onOutcomeChange}
        axis={axis}
        onAxisChange={onAxisChange}
      />
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={styles.optimizeSvg}
        role="img"
        aria-label={`${metric.label} versus ${axisDef.label} across configuration periods`}
      >
        {/* Axes */}
        <line
          x1={margin.left}
          x2={margin.left}
          y1={margin.top}
          y2={margin.top + innerH}
          stroke="var(--color-chart-axis)"
        />
        <line
          x1={margin.left}
          x2={margin.left + innerW}
          y1={margin.top + innerH}
          y2={margin.top + innerH}
          stroke="var(--color-chart-axis)"
        />
        {/* Axis labels */}
        <text
          x={margin.left + innerW / 2}
          y={height - 8}
          textAnchor="middle"
          fontSize={12}
          fill="var(--color-chart-axis)"
        >
          {axisDef.label}
          {axisDef.unit ? ` (${axisDef.unit})` : ''}
        </text>
        <text
          x={14}
          y={margin.top + innerH / 2}
          textAnchor="middle"
          fontSize={12}
          fill="var(--color-chart-axis)"
          transform={`rotate(-90, 14, ${margin.top + innerH / 2})`}
        >
          {metric.axisLabel}
        </text>
        {/* Points */}
        {points.map((p, i) => (
          <g key={p.period.id}>
            <circle
              cx={xScale(p.x)}
              cy={yScale(p.summary.mean)}
              r={radiusFor(p.period.nights)}
              fill={paletteColor(colors, i)}
              fillOpacity={0.5}
              stroke={paletteColor(colors, i)}
            />
            <title>
              {`${formatConfigKey(p.period.settings)} — ${metric.label} ${p.summary.mean.toFixed(1)} (n=${p.period.nights})`}
            </title>
          </g>
        ))}
      </svg>
      <p className={styles.axisCaption}>
        Each point is one configuration period — area is proportional to the number of nights.
      </p>
    </div>
  );
}

function OptimizeControls({
  outcome,
  onOutcomeChange,
  axis,
  onAxisChange,
}: {
  readonly outcome: MetricId;
  readonly onOutcomeChange: (m: MetricId) => void;
  readonly axis: SettingAxis;
  readonly onAxisChange: (a: SettingAxis) => void;
}): JSX.Element {
  return (
    <div className={styles.metricRow}>
      <label className={styles.metricLabel}>
        <span>Outcome</span>
        <Select
          value={outcome}
          onValueChange={(v) => onOutcomeChange(v as MetricId)}
          options={METRICS.map((m) => ({ value: m.id, label: m.label }))}
          aria-label="Outcome metric"
        />
      </label>
      <label className={styles.metricLabel}>
        <span>Setting axis</span>
        <Select
          value={axis}
          onValueChange={(v) => onAxisChange(v as SettingAxis)}
          options={SETTING_AXES.map((a) => ({ value: a.id, label: a.label }))}
          aria-label="Setting axis"
        />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode tabs
// ---------------------------------------------------------------------------

function ModeTabs({
  mode,
  onChange,
}: {
  readonly mode: 'compare' | 'optimize';
  readonly onChange: (m: 'compare' | 'optimize') => void;
}): JSX.Element {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Comparison mode">
      <Button
        variant={mode === 'compare' ? 'primary' : 'secondary'}
        size="sm"
        role="tab"
        aria-selected={mode === 'compare'}
        onClick={() => onChange('compare')}
      >
        Compare
      </Button>
      <Button
        variant={mode === 'optimize' ? 'primary' : 'secondary'}
        size="sm"
        role="tab"
        aria-selected={mode === 'optimize'}
        onClick={() => onChange('optimize')}
      >
        Optimize
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / single states
// ---------------------------------------------------------------------------

function EmptyNoData(): JSX.Element {
  return (
    <Card className={styles.emptyCard}>
      <h2 className={styles.sectionTitle}>No therapy data in this range</h2>
      <p className={styles.sectionSubtitle}>
        There are no nightly aggregates for the selected date range. Adjust the date range above or
        import data to begin.
      </p>
      <Link to="/data/import" className={styles.emptyLink}>
        Open the import wizard →
      </Link>
    </Card>
  );
}

function EmptyNoSettings(): JSX.Element {
  return (
    <Card className={styles.emptyCard}>
      <h2 className={styles.sectionTitle}>Machine settings unavailable</h2>
      <p className={styles.sectionSubtitle}>
        Machine settings (min/max pressure, EPR) aren&apos;t recorded for any night in this range.
        Settings are read from your STR summary file at import time — re-import your data to
        populate them, then return here to compare configurations.
      </p>
      <Link to="/data/import" className={styles.emptyLink}>
        Re-import data →
      </Link>
    </Card>
  );
}

function SingleConfigNote({ period }: { readonly period: ConfigPeriod | undefined }): JSX.Element {
  return (
    <Card className={styles.singleCard}>
      <h2 className={styles.sectionTitle}>All nights share one configuration</h2>
      <p className={styles.sectionSubtitle}>
        {period
          ? `Every night in this range used ${formatConfigKey(period.settings)}.`
          : 'Every night in this range used the same machine settings.'}{' '}
        Configuration comparison activates once your settings change — for example, after a min or
        max pressure adjustment.
      </p>
    </Card>
  );
}

export default Configurations;
