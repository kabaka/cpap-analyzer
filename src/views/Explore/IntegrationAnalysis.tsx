/**
 * Cross-Source Integration Analysis view.
 *
 * Correlates CPAP therapy data with wearable (Fitbit/Google Health) data
 * across three analysis tabs: Correlation Explorer, Correlation Matrix,
 * and Metric Comparison.
 *
 * @module views/Explore/IntegrationAnalysis
 */

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Select, Skeleton, Tabs, Tooltip } from '@/components/ui';
import { useAppStore } from '@/stores/useAppStore';
import { useCorrelationData } from '@/hooks/useCorrelationData';
import type { JoinedDayRecord, JoinedWeatherRecord } from '@/hooks/useCorrelationData';
import { useWearableSummary } from '@/hooks/useWearableSummary';
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
import type { NightlyAggregate } from '@/types/session';
import {
  CPAP_METRICS,
  buildComparisonMetrics,
  comparisonGroups,
  filterAvailableWearableMetrics,
  filterAvailableWeatherMetrics,
  extractCpapFromJoined,
  alignSeries,
  type ComparisonMetricDef,
} from './integrationMetrics';
import styles from './IntegrationAnalysis.module.css';

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
 *
 * Positive r maps to blue (`--color-chart-1`), negative to red
 * (`--color-chart-2`), intensity by |r|. Both hues are theme tokens, so the
 * diverging scale reads correctly in light AND dark; the fill is a translucent
 * `color-mix` wash over the cell's theme surface, preserving the original
 * intensity mapping exactly (|r| → 0–60%, unchanged from the prior `opacity =
 * |r| * 0.6`) and staying transparent at r = 0.
 */
function matrixCellColor(r: number): string {
  if (!Number.isFinite(r)) return 'transparent';
  const absR = Math.min(Math.abs(r), 1);
  const pct = (absR * 60).toFixed(2); // identical intensity: |r| * 0.6 opacity → % mix
  if (r > 0) return `color-mix(in srgb, var(--color-chart-1) ${pct}%, transparent)`;
  if (r < 0) return `color-mix(in srgb, var(--color-chart-2) ${pct}%, transparent)`;
  return 'transparent';
}

/**
 * Determine text colour for a matrix cell.
 *
 * The fill is a translucent wash over the theme surface, so it never crosses to
 * the far luminance side: in light mode cells only darken toward the hue, in dark
 * mode they only lighten. `--color-text-primary` (theme-aware ink) therefore holds
 * ≥ 5.5:1 on every cell in both themes — the earlier hardcoded white flip at
 * |r| > 0.6 failed on light-theme cells (white on a pale blue/red wash).
 */
function matrixCellTextColor(r: number): string {
  if (!Number.isFinite(r)) return 'var(--color-text-muted)';
  return 'var(--color-text-primary)';
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

// Metric definitions, extraction/join helpers, availability filters, and the
// grouped-options builder live in `./integrationMetrics` (pure + unit-tested).

// ---------------------------------------------------------------------------
// Sub-component: Correlation Explorer
// ---------------------------------------------------------------------------

interface CorrelationExplorerProps {
  data: readonly JoinedDayRecord[];
  weatherData: readonly JoinedWeatherRecord[];
  comparisonMetrics: readonly ComparisonMetricDef[];
}

const CorrelationExplorer = React.memo(function CorrelationExplorer({
  data,
  weatherData,
  comparisonMetrics,
}: CorrelationExplorerProps) {
  const [cpapMetricKey, setCpapMetricKey] = useState<string>(CPAP_METRICS[0]?.key ?? 'ahi');
  const [comparisonId, setComparisonId] = useState<string>(comparisonMetrics[0]?.id ?? '');
  const [method, setMethod] = useState<'pearson' | 'spearman'>('pearson');

  const cpapMetric = CPAP_METRICS.find((m) => m.key === cpapMetricKey) ?? CPAP_METRICS[0];
  const comparisonMetric =
    comparisonMetrics.find((m) => m.id === comparisonId) ?? comparisonMetrics[0];

  const result = useMemo((): CrossSourceCorrelationResult | null => {
    if (!cpapMetric || !comparisonMetric) return null;

    // The CPAP series is drawn from whichever join the comparison metric lives
    // in (wearable join for wearable metrics, weather join for weather metrics)
    // so CPAP nights without the other source are not silently dropped.
    const cpapSource = comparisonMetric.group === 'weather' ? weatherData : data;
    const cpapSeries = extractCpapFromJoined(cpapSource, cpapMetric);
    const comparisonSeries = comparisonMetric.extract(data, weatherData);
    const aligned = alignSeries(cpapSeries, comparisonSeries);

    if (aligned.x.length < 3) return null;

    return computeCorrelation({
      x: aligned.x,
      y: aligned.y,
      dates: aligned.dates,
      method,
    });
  }, [data, weatherData, cpapMetric, comparisonMetric, method]);

  const cpapOptions = CPAP_METRICS.map((m) => ({ value: m.key, label: m.label }));
  const groups = comparisonGroups(comparisonMetrics);

  if (comparisonMetrics.length === 0) {
    return <NoComparisonData context="correlation analysis" />;
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
            label="Compare against"
            groups={groups}
            value={comparisonId}
            onValueChange={setComparisonId}
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
              comparisonMetric &&
              interpretCorrelation(cpapMetric.label, comparisonMetric.label, result)}
          </div>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Shared empty state for the "Compare against" tabs
// ---------------------------------------------------------------------------

function NoComparisonData({ context }: { context: string }) {
  return (
    <div className={styles.noData}>
      No comparison metrics available. Import Google Health data or enable the weather integration
      in Settings &rarr; Integrations to enable {context}.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Correlation Matrix
// ---------------------------------------------------------------------------

interface CorrelationMatrixProps {
  data: readonly JoinedDayRecord[];
  weatherData: readonly JoinedWeatherRecord[];
  comparisonMetrics: readonly ComparisonMetricDef[];
}

const CorrelationMatrixTab = React.memo(function CorrelationMatrixTab({
  data,
  weatherData,
  comparisonMetrics,
}: CorrelationMatrixProps) {
  const [method, setMethod] = useState<'pearson' | 'spearman'>('pearson');

  const matrixResult = useMemo((): CrossSourceCorrelationMatrix | null => {
    if (comparisonMetrics.length === 0) return null;

    // Build the CPAP record set from the UNION of both joins (a CPAP night may
    // appear with weather, with wearable, or both). `correlateDataSources`
    // inner-joins each comparison column by date, so listing every CPAP night
    // here lets weather columns pair with weather-only nights and wearable
    // columns with wearable-only nights.
    //
    // Null-handling (listwise deletion): CpapDailyRecord requires numeric `ahi`
    // and sub-indices, but those are `number | null` on a NightlyAggregate —
    // `null` is an UNDEFINED rate (recording below MIN_INDEX_USAGE_HOURS), never
    // zero. Rather than widen the analysis module's record contract, we drop the
    // whole night when `ahi` is null. Because every AHI component shares the same
    // rate-validity floor and usage-hours denominator, `ahi !== null` guarantees
    // `ahiObstructive`/`ahiCentral` are also non-null on the kept rows, so the
    // matrix never sees a fabricated 0.
    const cpapByDate = new Map<string, NightlyAggregate>();
    for (const d of data) cpapByDate.set(d.date, d.cpap);
    for (const d of weatherData) if (!cpapByDate.has(d.date)) cpapByDate.set(d.date, d.cpap);

    const cpapData: CpapDailyRecord[] = [];
    for (const [date, cpap] of cpapByDate) {
      if (cpap.ahi === null || cpap.ahiObstructive === null || cpap.ahiCentral === null) continue;
      cpapData.push({
        date,
        ahi: cpap.ahi,
        pressureMean: cpap.pressureMean,
        pressure95th: cpap.pressureP95,
        leakMedian: cpap.leakMedian,
        leak95th: cpap.leakP95,
        usageHours: cpap.usageHours,
        ahiObstructive: cpap.ahiObstructive,
        ahiCentral: cpap.ahiCentral,
        respiratoryRateMedian: cpap.respRateMedian ?? undefined,
        tidalVolumeMedian: cpap.tidalVolumeMedian ?? undefined,
        minuteVentilationMedian: cpap.minuteVentMean ?? undefined,
      });
    }
    cpapData.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    if (cpapData.length < 3) return null;

    // Build comparison metric series (wearable ∪ weather) as matrix columns.
    const comparisonColumns: Record<string, Array<{ date: string; value: number }>> = {};
    for (const metric of comparisonMetrics) {
      const series = metric.extract(data, weatherData);
      if (series.length > 0) {
        comparisonColumns[metric.label] = series;
      }
    }

    return correlateDataSources({ cpapData, wearableData: comparisonColumns, method });
  }, [data, weatherData, comparisonMetrics, method]);

  if (comparisonMetrics.length === 0) {
    return <NoComparisonData context="the correlation matrix" />;
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
  weatherData: readonly JoinedWeatherRecord[];
  comparisonMetrics: readonly ComparisonMetricDef[];
}

const MAX_LAG_OPTIONS = [
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '10', label: '10 days' },
  { value: '14', label: '14 days' },
];

const MetricComparison = React.memo(function MetricComparison({
  data,
  weatherData,
  comparisonMetrics,
}: MetricComparisonProps) {
  const [mode, setMode] = useState<ComparisonMode>('bland-altman');
  const [cpapMetricKey, setCpapMetricKey] = useState<string>(CPAP_METRICS[0]?.key ?? 'ahi');
  const [comparisonId, setComparisonId] = useState<string>(comparisonMetrics[0]?.id ?? '');
  const [maxLag, setMaxLag] = useState<string>('7');

  const cpapMetric = CPAP_METRICS.find((m) => m.key === cpapMetricKey) ?? CPAP_METRICS[0];
  const comparisonMetric =
    comparisonMetrics.find((m) => m.id === comparisonId) ?? comparisonMetrics[0];

  const cpapOptions = CPAP_METRICS.map((m) => ({ value: m.key, label: m.label }));
  const groups = comparisonGroups(comparisonMetrics);

  /** Aligned CPAP × comparison series, drawing CPAP from the matching join. */
  const aligned = useMemo(() => {
    if (!cpapMetric || !comparisonMetric) return null;
    const cpapSource = comparisonMetric.group === 'weather' ? weatherData : data;
    const cpapSeries = extractCpapFromJoined(cpapSource, cpapMetric);
    const comparisonSeries = comparisonMetric.extract(data, weatherData);
    const result = alignSeries(cpapSeries, comparisonSeries);
    return result.x.length < 3 ? null : result;
  }, [data, weatherData, cpapMetric, comparisonMetric]);

  const blandAltmanResult = useMemo((): BlandAltmanResult | null => {
    if (mode !== 'bland-altman' || !aligned || !cpapMetric || !comparisonMetric) return null;
    return computeBlandAltman({
      method1: aligned.x,
      method2: aligned.y,
      dates: aligned.dates,
      method1Label: cpapMetric.label,
      method2Label: comparisonMetric.label,
    });
  }, [mode, aligned, cpapMetric, comparisonMetric]);

  const laggedResult = useMemo((): LaggedCrossSourceCorrelationResult | null => {
    if (mode !== 'lagged-ccf' || !aligned) return null;
    return computeLaggedCrossCorrelation({
      x: aligned.x,
      y: aligned.y,
      dates: aligned.dates,
      maxLag: Number(maxLag),
    });
  }, [mode, aligned, maxLag]);

  if (comparisonMetrics.length === 0) {
    return <NoComparisonData context="metric comparison" />;
  }

  const isWeatherSelected = comparisonMetric?.group === 'weather';

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
            label={mode === 'bland-altman' ? 'Method 2 (Compare against)' : 'Lagging Metric'}
            groups={groups}
            value={comparisonId}
            onValueChange={setComparisonId}
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

      {isWeatherSelected && (
        <p className={styles.laggedHint} role="note">
          Environmental effects may precede therapy changes by a day or more — try lagged analysis.
        </p>
      )}

      {mode === 'bland-altman' && (
        <BlandAltmanResults
          result={blandAltmanResult}
          method1Label={cpapMetric?.label ?? ''}
          method2Label={comparisonMetric?.label ?? ''}
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
    weatherData,
    loading: dataLoading,
    cpapDays,
    wearableDays,
    overlapDays,
    weatherDays,
  } = useCorrelationData(isoRange);

  const availableWearableMetrics = useMemo(
    () => filterAvailableWearableMetrics(summary),
    [summary],
  );
  const availableWeatherMetrics = useMemo(
    () => filterAvailableWeatherMetrics(weatherData),
    [weatherData],
  );
  const comparisonMetrics = useMemo(
    () => buildComparisonMetrics(availableWearableMetrics, availableWeatherMetrics),
    [availableWearableMetrics, availableWeatherMetrics],
  );

  const loading = summaryLoading || dataLoading;
  const hasWeather = weatherData.length > 0;

  // --- Empty state: neither wearable nor weather data ---
  // Weather metrics are derived from synced weather data; if any weather night
  // exists we fall through to the tabs (weather-only correlation is valid).
  if (!loading && summary && !summary.hasData && !hasWeather) {
    return (
      <div className={styles.page} aria-labelledby="integration-heading">
        <div className={styles.header}>
          <h2 id="integration-heading" className={styles.heading}>
            Cross-Source Analysis
          </h2>
        </div>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            &#x1F4CA;
          </span>
          <h2 className={styles.emptyTitle}>No Comparison Data Available</h2>
          <p className={styles.emptyDescription}>
            Import your Google Health (Fitbit) data to correlate CPAP therapy metrics with sleep
            scores, heart rate variability, SpO&#x2082; readings, and more — or enable the weather
            &amp; air-quality integration to correlate against overnight barometric pressure,
            humidity, and AQI.
          </p>
          <div className={styles.emptyActions}>
            <Link to="/data/import" className={styles.emptyLink}>
              Go to Import &rarr;
            </Link>
            <Link to="/settings" className={styles.emptyLink}>
              Settings &rarr; Integrations (weather) &rarr;
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // --- Empty state: no date range overlap ---
  if (
    !loading &&
    summary?.hasData &&
    !hasWeather &&
    data.length === 0 &&
    !summary.overlapDateRange
  ) {
    return (
      <div className={styles.page} aria-labelledby="integration-heading">
        <div className={styles.header}>
          <h2 id="integration-heading" className={styles.heading}>
            Cross-Source Analysis
          </h2>
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
            <CorrelationExplorer
              data={data}
              weatherData={weatherData}
              comparisonMetrics={comparisonMetrics}
            />
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
            <CorrelationMatrixTab
              data={data}
              weatherData={weatherData}
              comparisonMetrics={comparisonMetrics}
            />
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
            <MetricComparison
              data={data}
              weatherData={weatherData}
              comparisonMetrics={comparisonMetrics}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={styles.page} aria-labelledby="integration-heading">
      <div className={styles.header}>
        <h2 id="integration-heading" className={styles.heading}>
          Cross-Source Analysis
        </h2>
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
        <span className={styles.bannerSeparator} aria-hidden="true" />
        <div className={styles.bannerStat}>
          <span className={styles.bannerValue}>{weatherDays}</span>
          <span>weather days</span>
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
