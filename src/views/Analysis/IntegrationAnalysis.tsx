/**
 * Cross-Source Integration Analysis view.
 *
 * Correlates CPAP therapy data with wearable (Fitbit/Google Health) data
 * across three analysis tabs: Correlation Explorer, Correlation Matrix,
 * and Metric Comparison.
 *
 * @module views/Analysis/IntegrationAnalysis
 */

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Select, Skeleton, Tabs, Tooltip } from '@/components/ui';
import { DateRangeSelector } from '@/components/domain/DateRangeSelector';
import { useAppStore } from '@/stores/useAppStore';
import { useCorrelationData } from '@/hooks/useCorrelationData';
import type { JoinedDayRecord } from '@/hooks/useCorrelationData';
import { useWearableSummary } from '@/hooks/useWearableSummary';
import type { WearableSummary } from '@/hooks/useWearableSummary';
import {
  computeCorrelation,
  computeBlandAltman,
  computeLaggedCrossCorrelation,
  correlateDataSources,
} from '@/analysis/crossSource';
import type {
  CrossSourceCorrelationResult,
  CrossSourceCorrelationMatrix,
  BlandAltmanResult,
  LaggedCrossSourceCorrelationResult,
  CpapDailyRecord,
} from '@/analysis/crossSource';
import type { FitbitDailyType } from '@/types/fitbit';
import type { NightlyAggregate } from '@/types/session';
import styles from './IntegrationAnalysis.module.css';

// ---------------------------------------------------------------------------
// CPAP metric definitions
// ---------------------------------------------------------------------------

interface CpapMetricDef {
  readonly key: string;
  readonly label: string;
  readonly extract: (agg: NightlyAggregate) => number;
}

const CPAP_METRICS: readonly CpapMetricDef[] = [
  { key: 'ahi', label: 'AHI', extract: (a) => a.ahi },
  { key: 'ahiObstructive', label: 'Obstructive AI', extract: (a) => a.ahiObstructive },
  { key: 'ahiCentral', label: 'Central AI', extract: (a) => a.ahiCentral },
  { key: 'ahiHypopnea', label: 'Hypopnea Index', extract: (a) => a.ahiHypopnea },
  { key: 'pressureMean', label: 'Pressure Mean', extract: (a) => a.pressureMean },
  { key: 'pressureP95', label: 'Pressure 95th', extract: (a) => a.pressureP95 },
  { key: 'leakMedian', label: 'Leak Median', extract: (a) => a.leakMedian },
  { key: 'leakP95', label: 'Leak 95th', extract: (a) => a.leakP95 },
  { key: 'usageHours', label: 'Usage Hours', extract: (a) => a.usageHours },
];

// ---------------------------------------------------------------------------
// Wearable metric definitions
// ---------------------------------------------------------------------------

interface WearableMetricDef {
  readonly dataType: FitbitDailyType;
  readonly path: string;
  readonly label: string;
}

const WEARABLE_METRICS: readonly WearableMetricDef[] = [
  { dataType: 'sleep_score', path: 'overallScore', label: 'Sleep Score' },
  { dataType: 'sleep_score', path: 'compositionScore', label: 'Sleep Composition' },
  { dataType: 'sleep_score', path: 'durationScore', label: 'Sleep Duration Score' },
  { dataType: 'sleep_score', path: 'deepSleepMinutes', label: 'Deep Sleep (min)' },
  { dataType: 'hrv_daily', path: 'dailyRmssd', label: 'HRV (RMSSD)' },
  { dataType: 'hrv_daily', path: 'deepRmssd', label: 'HRV Deep Sleep' },
  { dataType: 'spo2_daily', path: 'avg', label: 'SpO₂ Average' },
  { dataType: 'spo2_daily', path: 'min', label: 'SpO₂ Minimum' },
  { dataType: 'respiratory_rate', path: 'fullSleepRate', label: 'Respiratory Rate' },
  { dataType: 'heart_rate_resting', path: 'restingHeartRate', label: 'Resting Heart Rate' },
  { dataType: 'readiness', path: 'score', label: 'Readiness Score' },
  { dataType: 'stress', path: 'score', label: 'Stress Score' },
  { dataType: 'temperature', path: 'nightlyDeviation', label: 'Skin Temp Deviation' },
  { dataType: 'activity_daily', path: 'steps', label: 'Steps' },
  { dataType: 'activity_daily', path: 'activeZoneMinutes', label: 'Active Zone Minutes' },
  { dataType: 'snoring_daily', path: 'totalDurationMinutes', label: 'Snoring Duration' },
] as const;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatPValue(p: number): string {
  if (!Number.isFinite(p)) return 'N/A';
  if (p < 0.001) return p.toExponential(2);
  return p.toFixed(4);
}

function formatR(r: number): string {
  if (!Number.isFinite(r)) return 'N/A';
  return r.toFixed(3);
}

function strengthLabel(strength: string): string {
  const map: Record<string, string> = {
    negligible: 'Negligible',
    weak: 'Weak',
    moderate: 'Moderate',
    strong: 'Strong',
    'very strong': 'Very Strong',
  };
  return map[strength] ?? strength;
}

function strengthBadgeVariant(
  strength: string,
): 'default' | 'success' | 'warning' | 'danger' | 'info' {
  switch (strength) {
    case 'strong':
    case 'very strong':
      return 'success';
    case 'moderate':
      return 'warning';
    case 'weak':
      return 'info';
    default:
      return 'default';
  }
}

function directionArrow(direction: string): string {
  if (direction === 'positive') return '↑';
  if (direction === 'negative') return '↓';
  return '↔';
}

function directionClassName(direction: string): string | undefined {
  if (direction === 'positive') return styles.directionPositive;
  if (direction === 'negative') return styles.directionNegative;
  return styles.directionNone;
}

function interpretCorrelation(
  cpapLabel: string,
  wearableLabel: string,
  result: CrossSourceCorrelationResult,
): string {
  if (!Number.isFinite(result.r) || result.n < 3) {
    return 'Insufficient data to compute a meaningful correlation.';
  }

  const strengthWord = strengthLabel(result.strength).toLowerCase();
  const dirWord = result.direction;
  const pSignificant = result.pValue < 0.05;

  if (result.strength === 'negligible') {
    return `No meaningful linear relationship detected between ${cpapLabel} and ${wearableLabel} (r = ${formatR(result.r)}, p = ${formatPValue(result.pValue)}).`;
  }

  const trendDesc =
    dirWord === 'positive'
      ? `as ${cpapLabel} increases, ${wearableLabel} tends to increase`
      : `as ${cpapLabel} increases, ${wearableLabel} tends to decrease`;

  const sigText = pSignificant
    ? 'This relationship is statistically significant (p < 0.05).'
    : 'This relationship does not reach statistical significance (p >= 0.05).';

  return `${strengthWord.charAt(0).toUpperCase() + strengthWord.slice(1)} ${dirWord} correlation: ${trendDesc} (r = ${formatR(result.r)}). ${sigText}`;
}

/**
 * Compute a background colour for a correlation matrix cell.
 * Positive r maps to blue, negative to red, intensity by |r|.
 */
function matrixCellColor(r: number): string {
  if (!Number.isFinite(r)) return 'transparent';
  const absR = Math.min(Math.abs(r), 1);
  const opacity = absR * 0.6;
  if (r > 0) return `rgba(37, 99, 235, ${opacity})`;
  if (r < 0) return `rgba(220, 38, 38, ${opacity})`;
  return 'transparent';
}

/**
 * Determine text colour for contrast against the matrix cell background.
 */
function matrixCellTextColor(r: number): string {
  if (!Number.isFinite(r)) return 'var(--color-text-muted)';
  const absR = Math.abs(r);
  return absR > 0.6 ? '#ffffff' : 'var(--color-text-primary)';
}

// ---------------------------------------------------------------------------
// Data extraction helpers
// ---------------------------------------------------------------------------

function toISODateRange(dateRange: { start: Date; end: Date }): {
  start: string;
  end: string;
} {
  return {
    start: dateRange.start.toISOString().slice(0, 10),
    end: dateRange.end.toISOString().slice(0, 10),
  };
}

/** Extract a numeric wearable metric from joined records. */
function extractWearableFromJoined(
  data: readonly JoinedDayRecord[],
  metric: WearableMetricDef,
): Array<{ date: string; value: number }> {
  const result: Array<{ date: string; value: number }> = [];
  for (const record of data) {
    const summary = record.wearable[metric.dataType];
    if (!summary) continue;
    const raw = getNestedValue(summary.data, metric.path);
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      result.push({ date: record.date, value: raw });
    }
  }
  return result;
}

/** Navigate into an object by a dot-separated path. */
function getNestedValue(obj: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Extract CPAP metric values aligned with dates from joined records. */
function extractCpapFromJoined(
  data: readonly JoinedDayRecord[],
  metric: CpapMetricDef,
): Array<{ date: string; value: number }> {
  const result: Array<{ date: string; value: number }> = [];
  for (const record of data) {
    const v = metric.extract(record.cpap);
    if (Number.isFinite(v)) {
      result.push({ date: record.date, value: v });
    }
  }
  return result;
}

/** Build aligned arrays from two metric series (inner join on date). */
function alignSeries(
  seriesA: ReadonlyArray<{ date: string; value: number }>,
  seriesB: ReadonlyArray<{ date: string; value: number }>,
): { x: number[]; y: number[]; dates: string[] } {
  const mapB = new Map(seriesB.map((s) => [s.date, s.value]));
  const x: number[] = [];
  const y: number[] = [];
  const dates: string[] = [];
  for (const a of seriesA) {
    const bVal = mapB.get(a.date);
    if (bVal !== undefined) {
      x.push(a.value);
      y.push(bVal);
      dates.push(a.date);
    }
  }
  return { x, y, dates };
}

// ---------------------------------------------------------------------------
// Available wearable metrics (filtered by imported data)
// ---------------------------------------------------------------------------

function filterAvailableWearableMetrics(
  summary: WearableSummary | null,
): readonly WearableMetricDef[] {
  if (!summary?.hasData) return [];
  const availableTypes = new Set<string>(summary.availableDataTypes);
  return WEARABLE_METRICS.filter((m) => availableTypes.has(m.dataType));
}

// ---------------------------------------------------------------------------
// Sub-component: Correlation Explorer
// ---------------------------------------------------------------------------

interface CorrelationExplorerProps {
  data: readonly JoinedDayRecord[];
  availableWearableMetrics: readonly WearableMetricDef[];
}

const CorrelationExplorer = React.memo(function CorrelationExplorer({
  data,
  availableWearableMetrics,
}: CorrelationExplorerProps) {
  const [cpapMetricKey, setCpapMetricKey] = useState<string>(CPAP_METRICS[0]?.key ?? 'ahi');
  const [wearableIdx, setWearableIdx] = useState<string>('0');
  const [method, setMethod] = useState<'pearson' | 'spearman'>('pearson');

  const cpapMetric = CPAP_METRICS.find((m) => m.key === cpapMetricKey) ?? CPAP_METRICS[0];
  const wearableMetric =
    availableWearableMetrics[Number(wearableIdx)] ?? availableWearableMetrics[0];

  const result = useMemo((): CrossSourceCorrelationResult | null => {
    if (!cpapMetric || !wearableMetric || data.length < 3) return null;

    const cpapSeries = extractCpapFromJoined(data, cpapMetric);
    const wearableSeries = extractWearableFromJoined(data, wearableMetric);
    const aligned = alignSeries(cpapSeries, wearableSeries);

    if (aligned.x.length < 3) return null;

    return computeCorrelation({
      x: aligned.x,
      y: aligned.y,
      dates: aligned.dates,
      method,
    });
  }, [data, cpapMetric, wearableMetric, method]);

  const cpapOptions = CPAP_METRICS.map((m) => ({ value: m.key, label: m.label }));
  const wearableOptions = availableWearableMetrics.map((m, i) => ({
    value: String(i),
    label: m.label,
  }));

  if (availableWearableMetrics.length === 0) {
    return (
      <div className={styles.noData}>
        No wearable metrics available. Import Google Health data to enable correlation analysis.
      </div>
    );
  }

  return (
    <div>
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <Select
            label="CPAP Metric"
            options={cpapOptions}
            value={cpapMetricKey}
            onValueChange={setCpapMetricKey}
          />
        </div>
        <div className={styles.controlGroup}>
          <Select
            label="Wearable Metric"
            options={wearableOptions}
            value={wearableIdx}
            onValueChange={setWearableIdx}
          />
        </div>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel} id="method-label">
            Method
          </span>
          <div className={styles.toggleGroup} role="radiogroup" aria-labelledby="method-label">
            <button
              type="button"
              role="radio"
              aria-checked={method === 'pearson'}
              className={`${styles.toggleButton} ${method === 'pearson' ? styles.toggleButtonActive : ''}`}
              onClick={() => setMethod('pearson')}
            >
              Pearson
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={method === 'spearman'}
              className={`${styles.toggleButton} ${method === 'spearman' ? styles.toggleButtonActive : ''}`}
              onClick={() => setMethod('spearman')}
            >
              Spearman
            </button>
          </div>
        </div>
      </div>

      {result === null ? (
        <div className={styles.noData}>
          Not enough overlapping data points (need at least 3) to compute a correlation.
        </div>
      ) : (
        <div className={styles.resultCard}>
          <div className={styles.resultGrid}>
            <div className={styles.resultItem}>
              <span className={styles.resultLabel}>Coefficient (r)</span>
              <span className={styles.resultValue}>{formatR(result.r)}</span>
            </div>
            <div className={styles.resultItem}>
              <span className={styles.resultLabel}>p-value</span>
              <span className={styles.resultValue}>{formatPValue(result.pValue)}</span>
            </div>
            <div className={styles.resultItem}>
              <span className={styles.resultLabel}>Sample Size (n)</span>
              <span className={styles.resultValue}>{result.n}</span>
            </div>
            <div className={styles.resultItem}>
              <span className={styles.resultLabel}>95% CI</span>
              <span className={styles.resultSmall}>
                [{formatR(result.ci95Lower)}, {formatR(result.ci95Upper)}]
              </span>
            </div>
            <div className={styles.resultItem}>
              <span className={styles.resultLabel}>Strength</span>
              <Badge variant={strengthBadgeVariant(result.strength)}>
                {strengthLabel(result.strength)}
              </Badge>
            </div>
            <div className={styles.resultItem}>
              <span className={styles.resultLabel}>Direction</span>
              <span className={`${styles.resultValue} ${directionClassName(result.direction)}`}>
                {directionArrow(result.direction)}{' '}
                {result.direction.charAt(0).toUpperCase() + result.direction.slice(1)}
              </span>
            </div>
          </div>

          <div className={styles.interpretation} role="status" aria-live="polite">
            {cpapMetric &&
              wearableMetric &&
              interpretCorrelation(cpapMetric.label, wearableMetric.label, result)}
          </div>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Correlation Matrix
// ---------------------------------------------------------------------------

interface CorrelationMatrixProps {
  data: readonly JoinedDayRecord[];
  availableWearableMetrics: readonly WearableMetricDef[];
}

const CorrelationMatrixTab = React.memo(function CorrelationMatrixTab({
  data,
  availableWearableMetrics,
}: CorrelationMatrixProps) {
  const [method, setMethod] = useState<'pearson' | 'spearman'>('pearson');

  const matrixResult = useMemo((): CrossSourceCorrelationMatrix | null => {
    if (data.length < 3 || availableWearableMetrics.length === 0) return null;

    // Build CpapDailyRecord array
    const cpapData: CpapDailyRecord[] = data.map((d) => ({
      date: d.date,
      ahi: d.cpap.ahi,
      pressureMean: d.cpap.pressureMean,
      pressure95th: d.cpap.pressureP95,
      leakMedian: d.cpap.leakMedian,
      leak95th: d.cpap.leakP95,
      usageHours: d.cpap.usageHours,
      ahiObstructive: d.cpap.ahiObstructive,
      ahiCentral: d.cpap.ahiCentral,
      respiratoryRateMedian: d.cpap.respRateMedian ?? undefined,
      tidalVolumeMedian: d.cpap.tidalVolumeMedian ?? undefined,
      minuteVentilationMedian: d.cpap.minuteVentMean ?? undefined,
    }));

    // Build wearable metric series
    const wearableData: Record<string, Array<{ date: string; value: number }>> = {};
    for (const metric of availableWearableMetrics) {
      const series = extractWearableFromJoined(data, metric);
      if (series.length > 0) {
        wearableData[metric.label] = series;
      }
    }

    return correlateDataSources({ cpapData, wearableData, method });
  }, [data, availableWearableMetrics, method]);

  if (availableWearableMetrics.length === 0) {
    return (
      <div className={styles.noData}>
        No wearable metrics available. Import Google Health data to enable the correlation matrix.
      </div>
    );
  }

  if (matrixResult === null || matrixResult.cpapMetrics.length === 0) {
    return (
      <div className={styles.noData}>
        Not enough overlapping data to compute the correlation matrix (need at least 3 days of
        overlap).
      </div>
    );
  }

  return (
    <div>
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel} id="matrix-method-label">
            Method
          </span>
          <div
            className={styles.toggleGroup}
            role="radiogroup"
            aria-labelledby="matrix-method-label"
          >
            <button
              type="button"
              role="radio"
              aria-checked={method === 'pearson'}
              className={`${styles.toggleButton} ${method === 'pearson' ? styles.toggleButtonActive : ''}`}
              onClick={() => setMethod('pearson')}
            >
              Pearson
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={method === 'spearman'}
              className={`${styles.toggleButton} ${method === 'spearman' ? styles.toggleButtonActive : ''}`}
              onClick={() => setMethod('spearman')}
            >
              Spearman
            </button>
          </div>
        </div>
      </div>

      <div className={styles.matrixWrapper}>
        <table
          className={styles.matrixTable}
          role="grid"
          aria-label="Cross-source correlation matrix"
        >
          <thead>
            <tr>
              <th scope="col">{/* Empty corner cell */}</th>
              {matrixResult.wearableMetrics.map((wm) => (
                <th key={wm} scope="col" className="columnHeader">
                  {wm}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrixResult.cpapMetrics.map((cm, ci) => (
              <tr key={cm}>
                <th scope="row" className={styles.matrixRowHeader}>
                  {cm}
                </th>
                {matrixResult.wearableMetrics.map((wm, wi) => {
                  const r = matrixResult.matrix[ci]?.[wi] ?? NaN;
                  const p = matrixResult.pValues[ci]?.[wi] ?? NaN;
                  const isSignificant = Number.isFinite(p) && p < 0.05;

                  return (
                    <td key={wm}>
                      <Tooltip
                        content={
                          <span>
                            {cm} vs {wm}
                            <br />r = {formatR(r)}
                            <br />p = {formatPValue(p)}
                            <br />
                            {isSignificant ? 'Statistically significant' : 'Not significant'}
                          </span>
                        }
                        side="top"
                      >
                        <div
                          className={`${styles.matrixCell} ${isSignificant ? styles.matrixCellSignificant : ''}`}
                          style={{
                            backgroundColor: matrixCellColor(r),
                            color: matrixCellTextColor(r),
                          }}
                          tabIndex={0}
                          role="gridcell"
                          aria-label={`${cm} vs ${wm}: r = ${formatR(r)}, p = ${formatPValue(p)}${isSignificant ? ', significant' : ''}`}
                        >
                          {Number.isFinite(r) ? r.toFixed(2) : '--'}
                        </div>
                      </Tooltip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className={styles.banner} role="note" aria-label="Matrix legend">
        <span>
          Blue = positive correlation, Red = negative correlation, intensity = strength of |r|
        </span>
        <span className={styles.bannerSeparator} aria-hidden="true" />
        <span>Bold border = statistically significant (p &lt; 0.05)</span>
      </div>

      {/* Significant pairs */}
      {matrixResult.significantPairs.length > 0 && (
        <div className={styles.significantSection}>
          <h3 className={styles.significantTitle}>
            Significant Correlations ({matrixResult.significantPairs.length})
          </h3>
          <div className={styles.significantList} role="list">
            {matrixResult.significantPairs.map((pair) => (
              <div
                key={`${pair.cpapMetric}-${pair.wearableMetric}`}
                className={styles.significantPair}
                role="listitem"
              >
                <span className={styles.significantMetric}>{pair.cpapMetric}</span>
                <span className={styles.significantConnector}>&harr;</span>
                <span className={styles.significantMetric}>{pair.wearableMetric}</span>
                <span className={`${styles.significantR} ${directionClassName(pair.direction)}`}>
                  r = {formatR(pair.r)}
                </span>
                <Badge variant={strengthBadgeVariant(pair.strength)} size="sm">
                  {strengthLabel(pair.strength)}
                </Badge>
                <span className={styles.significantP}>p = {formatPValue(pair.pValue)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Metric Comparison (Bland-Altman + Lagged CCF)
// ---------------------------------------------------------------------------

type ComparisonMode = 'bland-altman' | 'lagged-ccf';

interface MetricComparisonProps {
  data: readonly JoinedDayRecord[];
  availableWearableMetrics: readonly WearableMetricDef[];
}

const MAX_LAG_OPTIONS = [
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '10', label: '10 days' },
  { value: '14', label: '14 days' },
];

const MetricComparison = React.memo(function MetricComparison({
  data,
  availableWearableMetrics,
}: MetricComparisonProps) {
  const [mode, setMode] = useState<ComparisonMode>('bland-altman');
  const [cpapMetricKey, setCpapMetricKey] = useState<string>(CPAP_METRICS[0]?.key ?? 'ahi');
  const [wearableIdx, setWearableIdx] = useState<string>('0');
  const [maxLag, setMaxLag] = useState<string>('7');

  const cpapMetric = CPAP_METRICS.find((m) => m.key === cpapMetricKey) ?? CPAP_METRICS[0];
  const wearableMetric =
    availableWearableMetrics[Number(wearableIdx)] ?? availableWearableMetrics[0];

  const cpapOptions = CPAP_METRICS.map((m) => ({ value: m.key, label: m.label }));
  const wearableOptions = availableWearableMetrics.map((m, i) => ({
    value: String(i),
    label: m.label,
  }));

  const blandAltmanResult = useMemo((): BlandAltmanResult | null => {
    if (mode !== 'bland-altman' || !cpapMetric || !wearableMetric || data.length < 3) return null;

    const cpapSeries = extractCpapFromJoined(data, cpapMetric);
    const wearableSeries = extractWearableFromJoined(data, wearableMetric);
    const aligned = alignSeries(cpapSeries, wearableSeries);

    if (aligned.x.length < 3) return null;

    return computeBlandAltman({
      method1: aligned.x,
      method2: aligned.y,
      dates: aligned.dates,
      method1Label: cpapMetric.label,
      method2Label: wearableMetric.label,
    });
  }, [mode, data, cpapMetric, wearableMetric]);

  const laggedResult = useMemo((): LaggedCrossSourceCorrelationResult | null => {
    if (mode !== 'lagged-ccf' || !cpapMetric || !wearableMetric || data.length < 3) return null;

    const cpapSeries = extractCpapFromJoined(data, cpapMetric);
    const wearableSeries = extractWearableFromJoined(data, wearableMetric);
    const aligned = alignSeries(cpapSeries, wearableSeries);

    if (aligned.x.length < 3) return null;

    return computeLaggedCrossCorrelation({
      x: aligned.x,
      y: aligned.y,
      dates: aligned.dates,
      maxLag: Number(maxLag),
    });
  }, [mode, data, cpapMetric, wearableMetric, maxLag]);

  if (availableWearableMetrics.length === 0) {
    return (
      <div className={styles.noData}>
        No wearable metrics available. Import Google Health data to enable metric comparison.
      </div>
    );
  }

  return (
    <div>
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel} id="comparison-mode-label">
            Analysis
          </span>
          <div
            className={styles.toggleGroup}
            role="radiogroup"
            aria-labelledby="comparison-mode-label"
          >
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'bland-altman'}
              className={`${styles.toggleButton} ${mode === 'bland-altman' ? styles.toggleButtonActive : ''}`}
              onClick={() => setMode('bland-altman')}
            >
              Bland-Altman
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'lagged-ccf'}
              className={`${styles.toggleButton} ${mode === 'lagged-ccf' ? styles.toggleButtonActive : ''}`}
              onClick={() => setMode('lagged-ccf')}
            >
              Lagged CCF
            </button>
          </div>
        </div>
        <div className={styles.controlGroup}>
          <Select
            label={mode === 'bland-altman' ? 'Method 1 (CPAP)' : 'Leading Metric'}
            options={cpapOptions}
            value={cpapMetricKey}
            onValueChange={setCpapMetricKey}
          />
        </div>
        <div className={styles.controlGroup}>
          <Select
            label={mode === 'bland-altman' ? 'Method 2 (Wearable)' : 'Lagging Metric'}
            options={wearableOptions}
            value={wearableIdx}
            onValueChange={setWearableIdx}
          />
        </div>
        {mode === 'lagged-ccf' && (
          <div className={styles.controlGroup}>
            <Select
              label="Max Lag"
              options={MAX_LAG_OPTIONS}
              value={maxLag}
              onValueChange={setMaxLag}
            />
          </div>
        )}
      </div>

      {mode === 'bland-altman' && (
        <BlandAltmanResults
          result={blandAltmanResult}
          method1Label={cpapMetric?.label ?? ''}
          method2Label={wearableMetric?.label ?? ''}
        />
      )}

      {mode === 'lagged-ccf' && <LaggedCCFResults result={laggedResult} />}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Bland-Altman results display
// ---------------------------------------------------------------------------

interface BlandAltmanResultsProps {
  result: BlandAltmanResult | null;
  method1Label: string;
  method2Label: string;
}

const BlandAltmanResults = React.memo(function BlandAltmanResults({
  result,
  method1Label,
  method2Label,
}: BlandAltmanResultsProps) {
  if (result === null) {
    return (
      <div className={styles.noData}>
        Not enough overlapping data to compute Bland-Altman analysis (need at least 3 paired
        observations).
      </div>
    );
  }

  return (
    <div className={styles.resultCard}>
      <div className={styles.blandAltmanGrid}>
        <div className={styles.resultItem}>
          <span className={styles.resultLabel}>Bias (Mean Diff.)</span>
          <span className={styles.resultValue}>
            {Number.isFinite(result.meanDifference) ? result.meanDifference.toFixed(3) : 'N/A'}
          </span>
          <span className={styles.resultSmall}>
            {method1Label} - {method2Label}
          </span>
        </div>
        <div className={styles.resultItem}>
          <span className={styles.resultLabel}>SD of Differences</span>
          <span className={styles.resultValue}>
            {Number.isFinite(result.sdDifference) ? result.sdDifference.toFixed(3) : 'N/A'}
          </span>
        </div>
        <div className={styles.resultItem}>
          <span className={styles.resultLabel}>Upper Limit of Agreement</span>
          <span className={styles.resultValue}>
            {Number.isFinite(result.upperLimit) ? result.upperLimit.toFixed(3) : 'N/A'}
          </span>
          <span className={styles.resultSmall}>Bias + 1.96 SD</span>
        </div>
        <div className={styles.resultItem}>
          <span className={styles.resultLabel}>Lower Limit of Agreement</span>
          <span className={styles.resultValue}>
            {Number.isFinite(result.lowerLimit) ? result.lowerLimit.toFixed(3) : 'N/A'}
          </span>
          <span className={styles.resultSmall}>Bias - 1.96 SD</span>
        </div>
        <div className={styles.resultItem}>
          <span className={styles.resultLabel}>Sample Size</span>
          <span className={styles.resultValue}>{result.n}</span>
        </div>
        <div className={styles.resultItem}>
          <span className={styles.resultLabel}>Proportional Bias</span>
          <Badge variant={result.proportionalBias.isSignificant ? 'warning' : 'success'}>
            {result.proportionalBias.isSignificant ? 'Detected' : 'Not Detected'}
          </Badge>
          <span className={styles.resultSmall}>
            slope ={' '}
            {Number.isFinite(result.proportionalBias.slope)
              ? result.proportionalBias.slope.toFixed(4)
              : 'N/A'}
            , p = {formatPValue(result.proportionalBias.pValue)}
          </span>
        </div>
      </div>

      <div className={styles.interpretation}>
        {result.proportionalBias.isSignificant
          ? `Proportional bias detected: the disagreement between ${method1Label} and ${method2Label} varies systematically with the magnitude of the measurement (slope = ${result.proportionalBias.slope.toFixed(4)}, p = ${formatPValue(result.proportionalBias.pValue)}). The limits of agreement should be interpreted with caution.`
          : `No proportional bias detected: the disagreement between ${method1Label} and ${method2Label} is consistent across all measurement magnitudes. The bias is ${result.meanDifference.toFixed(3)} with limits of agreement from ${result.lowerLimit.toFixed(3)} to ${result.upperLimit.toFixed(3)}.`}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Lagged Cross-Correlation results display
// ---------------------------------------------------------------------------

interface LaggedCCFResultsProps {
  result: LaggedCrossSourceCorrelationResult | null;
}

const LaggedCCFResults = React.memo(function LaggedCCFResults({ result }: LaggedCCFResultsProps) {
  if (result === null) {
    return (
      <div className={styles.noData}>
        Not enough data to compute lagged cross-correlation (need at least 3 overlapping
        observations).
      </div>
    );
  }

  const maxAbsCCF = Math.max(...result.ccf.map((v) => Math.abs(v)), 0.01);

  return (
    <div className={styles.resultCard}>
      <div className={styles.lagGrid}>
        <div className={styles.resultItem}>
          <span className={styles.resultLabel}>Best Lag</span>
          <span className={styles.resultValue}>
            {result.bestLag} {result.bestLag === 1 || result.bestLag === -1 ? 'day' : 'days'}
          </span>
        </div>
        <div className={styles.resultItem}>
          <span className={styles.resultLabel}>CCF at Best Lag</span>
          <span className={styles.resultValue}>{formatR(result.bestCCF)}</span>
        </div>
        <div className={styles.resultItem}>
          <span className={styles.resultLabel}>Significance Bound</span>
          <span className={styles.resultSmall}>+/- {result.significanceBound.toFixed(3)}</span>
        </div>
      </div>

      {/* Mini CCF bar chart */}
      <div role="img" aria-label="Cross-correlation function bar chart">
        {result.lags.map((lag, i) => {
          const ccfVal = result.ccf[i] ?? 0;
          const isSignificant = Math.abs(ccfVal) > result.significanceBound;
          const widthPercent = (Math.abs(ccfVal) / maxAbsCCF) * 100;
          const isBestLag = lag === result.bestLag;

          return (
            <div
              key={lag}
              className={styles.lagBar}
              style={{ fontWeight: isBestLag ? 'bold' : 'normal' }}
            >
              <span className={styles.lagLabel}>
                {lag >= 0 ? '+' : ''}
                {lag}
              </span>
              <div
                className={`${styles.lagBarInner} ${ccfVal >= 0 ? styles.lagBarPositive : styles.lagBarNegative}`}
                style={{
                  width: `${widthPercent}%`,
                  opacity: isSignificant ? 1 : 0.4,
                }}
                role="presentation"
              />
              <span className={styles.lagValue}>
                {ccfVal.toFixed(3)}
                {isSignificant ? ' *' : ''}
              </span>
            </div>
          );
        })}
      </div>

      <div className={styles.interpretation} style={{ marginTop: 'var(--space-4)' }}>
        {result.interpretation}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function IntegrationAnalysis() {
  const dateRange = useAppStore((s) => s.dateRange);
  const isoRange = useMemo(() => toISODateRange(dateRange), [dateRange]);

  const { summary, loading: summaryLoading } = useWearableSummary();
  const {
    data,
    loading: dataLoading,
    cpapDays,
    wearableDays,
    overlapDays,
  } = useCorrelationData(isoRange);

  const availableWearableMetrics = useMemo(
    () => filterAvailableWearableMetrics(summary),
    [summary],
  );

  const loading = summaryLoading || dataLoading;

  // --- Empty state: no wearable data ---
  if (!summaryLoading && summary && !summary.hasData) {
    return (
      <div className={styles.page} role="main" aria-labelledby="integration-heading">
        <div className={styles.header}>
          <h1 id="integration-heading" className={styles.heading}>
            Cross-Source Analysis
          </h1>
        </div>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            &#x1F4CA;
          </span>
          <h2 className={styles.emptyTitle}>No Wearable Data Available</h2>
          <p className={styles.emptyDescription}>
            Import your Google Health (Fitbit) data to unlock cross-source analysis. Correlate your
            CPAP therapy metrics with sleep scores, heart rate variability, SpO&#x2082; readings,
            and more.
          </p>
          <Link to="/data/import" className={styles.emptyLink}>
            Go to Import &rarr;
          </Link>
        </div>
      </div>
    );
  }

  // --- Empty state: no date range overlap ---
  if (!loading && summary?.hasData && data.length === 0 && !summary.overlapDateRange) {
    return (
      <div className={styles.page} role="main" aria-labelledby="integration-heading">
        <div className={styles.header}>
          <h1 id="integration-heading" className={styles.heading}>
            Cross-Source Analysis
          </h1>
          <DateRangeSelector />
        </div>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            &#x1F4C5;
          </span>
          <h2 className={styles.emptyTitle}>No Overlapping Dates</h2>
          <p className={styles.emptyDescription}>
            Your CPAP data and wearable data do not overlap in the selected date range. Try
            expanding the date range to &ldquo;All time,&rdquo; or import additional data that
            covers a shared period.
          </p>
        </div>
      </div>
    );
  }

  const tabs = [
    {
      value: 'explorer',
      label: 'Correlation Explorer',
      content: (
        <div className={styles.tabContent}>
          {loading ? (
            <LoadingSkeleton />
          ) : (
            <CorrelationExplorer data={data} availableWearableMetrics={availableWearableMetrics} />
          )}
        </div>
      ),
    },
    {
      value: 'matrix',
      label: 'Correlation Matrix',
      content: (
        <div className={styles.tabContent}>
          {loading ? (
            <LoadingSkeleton />
          ) : (
            <CorrelationMatrixTab data={data} availableWearableMetrics={availableWearableMetrics} />
          )}
        </div>
      ),
    },
    {
      value: 'comparison',
      label: 'Metric Comparison',
      content: (
        <div className={styles.tabContent}>
          {loading ? (
            <LoadingSkeleton />
          ) : (
            <MetricComparison data={data} availableWearableMetrics={availableWearableMetrics} />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={styles.page} role="main" aria-labelledby="integration-heading">
      <div className={styles.header}>
        <h1 id="integration-heading" className={styles.heading}>
          Cross-Source Analysis
        </h1>
        <DateRangeSelector />
      </div>

      {/* Data availability banner */}
      <div className={styles.banner} role="status" aria-label="Data availability">
        <div className={styles.bannerStat}>
          <span className={styles.bannerValue}>{overlapDays}</span>
          <span>overlap days</span>
        </div>
        <span className={styles.bannerSeparator} aria-hidden="true" />
        <div className={styles.bannerStat}>
          <span className={styles.bannerValue}>{cpapDays}</span>
          <span>CPAP days</span>
        </div>
        <span className={styles.bannerSeparator} aria-hidden="true" />
        <div className={styles.bannerStat}>
          <span className={styles.bannerValue}>{wearableDays}</span>
          <span>wearable days</span>
        </div>
      </div>

      <Tabs tabs={tabs} defaultValue="explorer" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className={styles.skeletonRows}>
      <Skeleton width="100%" height={48} variant="rect" />
      <Skeleton width="100%" height={120} variant="rect" />
      <Skeleton width="80%" height={24} variant="text" />
      <Skeleton width="60%" height={24} variant="text" />
    </div>
  );
}
