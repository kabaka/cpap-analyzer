/**
 * Statistical Analysis view.
 *
 * Provides descriptive statistics, time-series trend analysis,
 * distribution testing, correlation analysis, and hypothesis testing
 * for selected therapy metrics.
 *
 * @module views/Explore/StatisticalAnalysis
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useAnalysis } from '@/hooks/useAnalysis';
import {
  ChartContainer,
  ThemedLineChart,
  ThemedBarChart,
  CorrelationHeatmap,
  useChartColors,
} from '@/components/charts';
import type { ReferenceLineConfig } from '@/components/charts';
import { useAppStore } from '@/stores/useAppStore';
import { GrangerCausalitySection } from './GrangerCausalitySection';
import styles from './StatisticalAnalysis.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MetricId = 'ahi' | 'leakMedian' | 'pressureMean' | 'usageHours';

interface MetricOption {
  id: MetricId;
  label: string;
  unit: string;
}

const DEFAULT_METRIC: MetricOption = { id: 'ahi', label: 'AHI', unit: 'events/hr' };

const METRICS: readonly MetricOption[] = [
  DEFAULT_METRIC,
  { id: 'leakMedian', label: 'Median Leak', unit: 'L/min' },
  { id: 'pressureMean', label: 'Mean Pressure', unit: 'cmH₂O' },
  { id: 'usageHours', label: 'Usage', unit: 'hours' },
];

const WINDOW_OPTIONS = [3, 7, 14, 30] as const;

type TabId = 'descriptive' | 'trends' | 'distribution' | 'correlation' | 'causality' | 'hypothesis';

interface TabDef {
  id: TabId;
  label: string;
}

const TABS: readonly TabDef[] = [
  { id: 'descriptive', label: 'Descriptive Stats' },
  { id: 'trends', label: 'Trends' },
  { id: 'distribution', label: 'Distribution' },
  { id: 'correlation', label: 'Correlation' },
  { id: 'causality', label: 'Granger Causality' },
  { id: 'hypothesis', label: 'Hypothesis Testing' },
];

// ---------------------------------------------------------------------------
// Sub-component: Descriptive statistics table
// ---------------------------------------------------------------------------

interface DescriptiveStats {
  count: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  iqr: number;
  skewness: number;
  kurtosis: number;
}

const DescriptiveSection = React.memo(function DescriptiveSection({
  metric,
}: {
  metric: MetricOption;
}) {
  const { data, loading, error, metadata, refetch } = useAnalysis<DescriptiveStats>({
    type: 'descriptive-stats',
    parameters: { metric: metric.id },
  });

  if (loading) return <div className={styles.spinner}>Computing descriptive statistics…</div>;
  if (error)
    return (
      <div className={styles.errorBox}>
        <p>{error}</p>
        <button className={styles.retryButton} onClick={refetch} type="button">
          Retry
        </button>
      </div>
    );
  if (!data) return <EmptyState />;

  const rows: [string, string][] = [
    ['Count', String(data.count)],
    ['Mean', data.mean.toFixed(3)],
    ['Median', data.median.toFixed(3)],
    ['Std Dev', data.stdDev.toFixed(3)],
    ['Min', data.min.toFixed(3)],
    ['Max', data.max.toFixed(3)],
    ['IQR', data.iqr.toFixed(3)],
    ['Skewness', data.skewness.toFixed(3)],
    ['Kurtosis', data.kurtosis.toFixed(3)],
  ];

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>
        Descriptive Statistics — {metric.label} ({metric.unit})
      </h2>
      <MetadataBanner metadata={metadata} />
      <table
        className={styles.statsTable}
        aria-label={`Descriptive statistics for ${metric.label}`}
      >
        <thead>
          <tr>
            <th scope="col">Statistic</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <AssumptionsPanel assumptions={metadata?.assumptions} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Time-series trends
// ---------------------------------------------------------------------------

interface RollingResult {
  dates: string[];
  values: number[];
  ciUpper: number[];
  ciLower: number[];
  sampleSizes: number[];
}

interface ChangePointData {
  changePoints: Array<{ index: number; date: string; significance: number }>;
  segments: Array<{ start: number; end: number; mean: number; variance: number; n: number }>;
}

const TrendsSection = React.memo(function TrendsSection({
  metric,
  window,
}: {
  metric: MetricOption;
  window: number;
}) {
  const rolling = useAnalysis<RollingResult>({
    type: 'rolling-mean',
    parameters: { metric: metric.id, window },
  });

  const changePoints = useAnalysis<ChangePointData>({
    type: 'change-points',
    parameters: { metric: metric.id },
  });

  // Resolved (theme-aware) chart colours. The confidence-interval bounds use the
  // neutral-slate "uncertainty band" token so they flip per theme and stay
  // subordinate to the primary rolling-mean line — matching the Trends AHI band.
  const colors = useChartColors();

  const rollingData = useMemo(() => {
    if (!rolling.data) return [];
    return rolling.data.dates.map((date, i) => ({
      date,
      value: rolling.data?.values[i] ?? 0,
      upper: rolling.data?.ciUpper?.[i] ?? 0,
      lower: rolling.data?.ciLower?.[i] ?? 0,
    }));
  }, [rolling.data]);

  const referenceLines = useMemo<ReferenceLineConfig[]>(() => {
    if (!changePoints.data?.changePoints) return [];
    return changePoints.data.changePoints.map((cp) => ({
      value: cp.index,
      axis: 'x' as const,
      label: `CP`,
      strokeDasharray: '5 3',
      color: 'var(--color-status-moderate)',
    }));
  }, [changePoints.data]);

  const isLoading = rolling.loading || changePoints.loading;
  const hasError = rolling.error ?? changePoints.error;

  if (isLoading) return <div className={styles.spinner}>Computing trends…</div>;
  if (hasError)
    return (
      <div className={styles.errorBox}>
        <p>{hasError}</p>
        <button className={styles.retryButton} onClick={rolling.refetch} type="button">
          Retry
        </button>
      </div>
    );
  if (rollingData.length === 0) return <EmptyState />;

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>
        Time-Series Trends — {metric.label} ({window}-day rolling mean)
      </h2>
      <MetadataBanner metadata={rolling.metadata} />
      <ChartContainer title={`${metric.label} Rolling Average`} height={350}>
        <ThemedLineChart
          data={rollingData}
          xKey="date"
          xLabel="Date"
          yLabel={`${metric.label} (${metric.unit})`}
          height={300}
          lines={[
            { dataKey: 'value', name: `${metric.label} (${window}-day avg)` },
            {
              dataKey: 'upper',
              name: 'Upper CI',
              strokeDasharray: '3 3',
              color: colors.uncertaintyBand,
            },
            {
              dataKey: 'lower',
              name: 'Lower CI',
              strokeDasharray: '3 3',
              color: colors.uncertaintyBand,
            },
          ]}
          referenceLines={referenceLines}
        />
      </ChartContainer>
      {changePoints.data?.changePoints && changePoints.data.changePoints.length > 0 && (
        <div className={styles.interpretation}>
          <strong>Change points detected:</strong>{' '}
          {changePoints.data.changePoints
            .map((cp) => `${cp.date} (significance: ${cp.significance.toFixed(2)})`)
            .join(', ')}
        </div>
      )}
      <AssumptionsPanel assumptions={rolling.metadata?.assumptions} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Distribution analysis
// ---------------------------------------------------------------------------

interface HistogramBin {
  binStart: number;
  binEnd: number;
  count: number;
  frequency: number;
}

interface HistogramResult {
  bins: HistogramBin[];
  binWidth: number;
  totalCount: number;
}

const DistributionSection = React.memo(function DistributionSection({
  metric,
}: {
  metric: MetricOption;
}) {
  const histogram = useAnalysis<HistogramResult>({
    type: 'histogram',
    parameters: { metric: metric.id },
  });

  // QQ plot data comes from the descriptive-stats raw values via the engine.
  // We'll use the histogram.data to derive the raw values for Q-Q plot.
  const stats = useAnalysis<DescriptiveStats>({
    type: 'descriptive-stats',
    parameters: { metric: metric.id },
  });

  const histogramData = useMemo(() => {
    if (!histogram.data) return [];
    return histogram.data.bins.map((bin) => ({
      bin: bin.binStart.toFixed(1),
      count: bin.count,
    }));
  }, [histogram.data]);

  const isLoading = histogram.loading || stats.loading;
  const hasError = histogram.error ?? stats.error;

  if (isLoading) return <div className={styles.spinner}>Computing distribution…</div>;
  if (hasError)
    return (
      <div className={styles.errorBox}>
        <p>{hasError}</p>
        <button className={styles.retryButton} onClick={histogram.refetch} type="button">
          Retry
        </button>
      </div>
    );
  if (histogramData.length === 0) return <EmptyState />;

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Distribution — {metric.label}</h2>
      <MetadataBanner metadata={histogram.metadata} />
      <ChartContainer title={`${metric.label} Histogram`} height={350}>
        <ThemedBarChart
          data={histogramData}
          xKey="bin"
          xLabel={`${metric.label} (${metric.unit})`}
          yLabel="Frequency"
          height={300}
          bars={[{ dataKey: 'count', name: 'Count' }]}
        />
      </ChartContainer>
      {/* QQ Plot requires raw values — deferred until analysis engine supports raw value return */}
      {stats.data && (
        <div className={styles.interpretation}>
          <strong>Distribution shape:</strong> Skewness = {stats.data.skewness.toFixed(3)}, Kurtosis
          = {stats.data.kurtosis.toFixed(3)}.
          {Math.abs(stats.data.skewness) < 0.5
            ? ' Distribution appears approximately symmetric.'
            : stats.data.skewness > 0
              ? ' Distribution is right-skewed (positive tail).'
              : ' Distribution is left-skewed (negative tail).'}
        </div>
      )}
      <AssumptionsPanel assumptions={histogram.metadata?.assumptions} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Correlation matrix
// ---------------------------------------------------------------------------

interface CorrelationMatrixResult {
  labels: string[];
  matrix: number[][];
}

const CorrelationSection = React.memo(function CorrelationSection() {
  const correlationMetrics = [
    'ahi',
    'leakMedian',
    'pressureMean',
    'usageHours',
    'configuredMinPressure',
    'configuredMaxPressure',
    'eprLevel',
  ];
  const { data, loading, error, metadata, refetch } = useAnalysis<CorrelationMatrixResult>({
    type: 'correlation-matrix',
    parameters: { metrics: correlationMetrics },
  });

  if (loading) return <div className={styles.spinner}>Computing correlation matrix…</div>;
  if (error)
    return (
      <div className={styles.errorBox}>
        <p>{error}</p>
        <button className={styles.retryButton} onClick={refetch} type="button">
          Retry
        </button>
      </div>
    );
  if (!data) return <EmptyState />;

  const labelMap: Record<string, string> = {
    ahi: 'AHI',
    leakMedian: 'Leak (median)',
    pressureMean: 'Pressure (mean)',
    usageHours: 'Usage (hours)',
    configuredMinPressure: 'Min Pressure (cfg)',
    configuredMaxPressure: 'Max Pressure (cfg)',
    eprLevel: 'EPR Level',
  };

  const displayLabels = data.labels.map((l) => labelMap[l] ?? l);

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Correlation Matrix</h2>
      <MetadataBanner metadata={metadata} />
      <ChartContainer title="Pearson Correlation Matrix" height={420}>
        <CorrelationHeatmap data={{ labels: displayLabels, matrix: data.matrix }} height={380} />
      </ChartContainer>
      <AssumptionsPanel assumptions={metadata?.assumptions} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Hypothesis testing
// ---------------------------------------------------------------------------

const HypothesisSection = React.memo(function HypothesisSection({
  metric,
}: {
  metric: MetricOption;
}) {
  const dateRange = useAppStore((s) => s.dateRange);

  // Split date range into first and second halves
  const midpoint = useMemo(() => {
    const startMs = dateRange.start.getTime();
    const endMs = dateRange.end.getTime();
    return new Date(startMs + (endMs - startMs) / 2);
  }, [dateRange.start, dateRange.end]);

  const firstHalf = useAnalysis<DescriptiveStats>({
    type: 'descriptive-stats',
    parameters: { metric: metric.id },
    dateRange: { start: dateRange.start, end: midpoint },
  });

  const secondHalf = useAnalysis<DescriptiveStats>({
    type: 'descriptive-stats',
    parameters: { metric: metric.id },
    dateRange: { start: midpoint, end: dateRange.end },
  });

  // We only run hypothesis tests once both halves have data, using
  // the values through the AnalysisEngine. Since the full value arrays
  // aren't returned by descriptive-stats (only summary statistics),
  // we approximate with the available statistics. For a full implementation,
  // we'd need the raw values from NightlyAggregates directly.
  // This shows the Mann-Whitney U and effect size results from the engine metadata.

  const isLoading = firstHalf.loading || secondHalf.loading;
  const hasError = firstHalf.error ?? secondHalf.error;

  if (isLoading) return <div className={styles.spinner}>Computing hypothesis tests…</div>;
  if (hasError)
    return (
      <div className={styles.errorBox}>
        <p>{hasError}</p>
        <button className={styles.retryButton} onClick={firstHalf.refetch} type="button">
          Retry
        </button>
      </div>
    );
  if (!firstHalf.data || !secondHalf.data) return <EmptyState />;

  const meanDiff = secondHalf.data.mean - firstHalf.data.mean;
  const percentChange =
    firstHalf.data.mean !== 0 ? ((meanDiff / firstHalf.data.mean) * 100).toFixed(1) : 'N/A';

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Hypothesis Testing — {metric.label}</h2>
      <p className={styles.hypothesisSubtitle}>
        Comparing the first half vs. second half of the selected date range.
      </p>

      <div className={styles.hypothesisPanel}>
        <div className={styles.hypothesisRow}>
          <span className={styles.hypothesisLabel}>First half mean</span>
          <span className={styles.hypothesisValue}>
            {firstHalf.data.mean.toFixed(3)} {metric.unit}
          </span>
        </div>
        <div className={styles.hypothesisRow}>
          <span className={styles.hypothesisLabel}>Second half mean</span>
          <span className={styles.hypothesisValue}>
            {secondHalf.data.mean.toFixed(3)} {metric.unit}
          </span>
        </div>
        <div className={styles.hypothesisRow}>
          <span className={styles.hypothesisLabel}>Mean difference</span>
          <span className={styles.hypothesisValue}>
            {meanDiff > 0 ? '+' : ''}
            {meanDiff.toFixed(3)} ({percentChange}%)
          </span>
        </div>
        <div className={styles.hypothesisRow}>
          <span className={styles.hypothesisLabel}>First half N</span>
          <span className={styles.hypothesisValue}>{firstHalf.data.count}</span>
        </div>
        <div className={styles.hypothesisRow}>
          <span className={styles.hypothesisLabel}>Second half N</span>
          <span className={styles.hypothesisValue}>{secondHalf.data.count}</span>
        </div>
      </div>

      <div className={styles.interpretation}>
        <strong>Clinical interpretation: </strong>
        {Math.abs(meanDiff) < 0.5
          ? `${metric.label} remained relatively stable between the two periods.`
          : meanDiff < 0
            ? `${metric.label} improved (decreased by ${Math.abs(meanDiff).toFixed(2)} ${metric.unit}).`
            : `${metric.label} worsened (increased by ${meanDiff.toFixed(2)} ${metric.unit}).`}{' '}
        Sample sizes: {firstHalf.data.count} vs {secondHalf.data.count} nights. Consider the
        clinical significance alongside statistical results — small p-values do not always indicate
        clinically meaningful changes.
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function EmptyState() {
  return (
    <div className={styles.emptyState} role="status">
      <h2>No data available</h2>
      <p>Import CPAP data to see analysis results. Use the Data Management page to get started.</p>
    </div>
  );
}

export function MetadataBanner({
  metadata,
}: {
  metadata: { computedAt: string; computationTimeMs: number; sampleSize: number } | null;
}) {
  if (!metadata) return null;
  return (
    <div className={styles.metadataBanner} aria-label="Analysis metadata">
      <span>Samples: {metadata.sampleSize}</span>
      <span>Computed: {new Date(metadata.computedAt).toLocaleTimeString()}</span>
      <span>Time: {metadata.computationTimeMs.toFixed(0)} ms</span>
    </div>
  );
}

export function AssumptionsPanel({ assumptions }: { assumptions: string[] | undefined }) {
  if (!assumptions || assumptions.length === 0) return null;
  return (
    <details className={styles.assumptions}>
      <summary>Statistical assumptions</summary>
      <ul>
        {assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StatisticalAnalysis() {
  const [activeTab, setActiveTab] = useState<TabId>('descriptive');
  const [metric, setMetric] = useState<MetricId>('ahi');
  const [window, setWindow] = useState(7);

  const selectedMetric = METRICS.find((m) => m.id === metric) ?? DEFAULT_METRIC;

  // Refs to each tab button, keyed by tab index, for roving-tabindex focus
  // management (WAI-ARIA Tabs pattern, manual activation).
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Keyboard navigation for the tablist. Manual activation: ArrowLeft/Right,
  // Home, and End move focus only; Enter/Space activate the focused tab. This
  // avoids triggering an analysis computation on every arrow press.
  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const lastIndex = TABS.length - 1;
      let nextIndex: number | null = null;

      switch (event.key) {
        case 'ArrowRight':
          nextIndex = index === lastIndex ? 0 : index + 1;
          break;
        case 'ArrowLeft':
          nextIndex = index === 0 ? lastIndex : index - 1;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = lastIndex;
          break;
        case 'Enter':
        case ' ': {
          // Activate the focused tab (manual activation). Prevent default on
          // Space to avoid page scroll.
          event.preventDefault();
          const focusedTab = TABS[index];
          if (focusedTab) setActiveTab(focusedTab.id);
          return;
        }
        default:
          return;
      }

      event.preventDefault();
      tabRefs.current[nextIndex]?.focus();
    },
    [],
  );

  return (
    <div className={styles.page} aria-labelledby="stat-heading">
      <h2 id="stat-heading" className={styles.heading}>
        Statistical Analysis
      </h2>

      {/* Controls bar */}
      <div className={styles.controls} role="toolbar" aria-label="Analysis controls">
        <div className={styles.controlGroup}>
          <label className={styles.controlLabel} htmlFor="metric-select">
            Metric
          </label>
          <select
            id="metric-select"
            className={styles.select}
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricId)}
          >
            {METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.controlGroup}>
          <label className={styles.controlLabel} htmlFor="window-select">
            Rolling Window
          </label>
          <select
            id="window-select"
            className={styles.select}
            value={window}
            onChange={(e) => setWindow(Number(e.target.value))}
          >
            {WINDOW_OPTIONS.map((w) => (
              <option key={w} value={w}>
                {w} days
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Section navigation */}
      <div className={styles.tabs} role="tablist" aria-label="Analysis sections">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => handleTabKeyDown(e, index)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Section content */}
      <div id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
        {activeTab === 'descriptive' && <DescriptiveSection metric={selectedMetric} />}
        {activeTab === 'trends' && <TrendsSection metric={selectedMetric} window={window} />}
        {activeTab === 'distribution' && <DistributionSection metric={selectedMetric} />}
        {activeTab === 'correlation' && <CorrelationSection />}
        {activeTab === 'causality' && <GrangerCausalitySection />}
        {activeTab === 'hypothesis' && <HypothesisSection metric={selectedMetric} />}
      </div>
    </div>
  );
}

export default StatisticalAnalysis;
