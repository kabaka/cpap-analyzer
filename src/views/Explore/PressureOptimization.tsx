/**
 * Pressure Optimization view.
 *
 * Provides pressure-response analysis, variability assessment,
 * titration recommendations, and BiPAP effectiveness metrics.
 *
 * @module views/Explore/PressureOptimization
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChartContainer, ThemedScatterPlot, BoxPlot } from '@/components/charts';
import type { BoxPlotGroup, ScatterDataPoint } from '@/components/charts';
import { useAppStore } from '@/stores/useAppStore';
import { getDB } from '@/services/storage/getDB';
import type { NightlyAggregate } from '@/types';
import {
  pressureResponseCurve,
  pressureVariability,
  titrationHelper,
  bipapEffectiveness,
} from '@/analysis/pressure';
import { formatMetric } from '@/analysis/uncertainty';
import type {
  PressureResponseResult,
  PressureVariabilityResult,
  TitrationResult,
  BiPAPEffectivenessResult,
} from '@/analysis/pressure';
import { formatDate } from '@/utils/formatDate';
import styles from './PressureOptimization.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TimeGrouping = 'weekly' | 'monthly';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get week-of-year key for grouping. */
function weekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Get YYYY-MM key for monthly grouping. */
function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** Arithmetic mean of a numeric array; 0 for an empty array. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stabilityBadgeClass(
  interpretation: PressureVariabilityResult['interpretation'],
): string | undefined {
  switch (interpretation) {
    case 'very stable':
      return styles.stabilityVeryStable;
    case 'stable':
      return styles.stabilityStable;
    case 'moderate':
      return styles.stabilityModerate;
    case 'variable':
      return styles.stabilityVariable;
    case 'highly variable':
      return styles.stabilityHighlyVariable;
  }
}

// ---------------------------------------------------------------------------
// Data fetching hook
// ---------------------------------------------------------------------------

interface PressureData {
  aggregates: NightlyAggregate[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function usePressureData(): PressureData {
  const dateRange = useAppStore((s) => s.dateRange);
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
        const aggs = await db.getNightlyAggregatesByDateRange(startStr, endStr);

        if (!cancelled) {
          setAggregates(aggs.sort((a, b) => a.date.localeCompare(b.date)));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load pressure data');
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

  return { aggregates, loading, error, refetch };
}

// ---------------------------------------------------------------------------
// Sub-component: Pressure-Response Scatter
// ---------------------------------------------------------------------------

const PressureResponseSection = React.memo(function PressureResponseSection({
  aggregates,
}: {
  aggregates: NightlyAggregate[];
}) {
  const result = useMemo<PressureResponseResult | null>(() => {
    const pressures = aggregates.map((a) => a.pressureMean);
    const ahiValues = aggregates.map((a) => a.ahi);
    if (pressures.length < 3) return null;
    return pressureResponseCurve(pressures, ahiValues);
  }, [aggregates]);

  const scatterData = useMemo<ScatterDataPoint[]>(() => {
    return aggregates.map((a) => ({
      x: a.pressureMean,
      y: a.ahi,
    }));
  }, [aggregates]);

  if (scatterData.length === 0) return null;

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Pressure-Response Relationship</h2>
      <ChartContainer title="AHI vs. Pressure" height={400}>
        <ThemedScatterPlot
          data={scatterData}
          xLabel="Pressure (cmH₂O)"
          yLabel="AHI (events/hr)"
          showRegression
          height={350}
        />
      </ChartContainer>
      {result && (
        <div className={styles.interpretation}>
          <strong>Regression: </strong>
          AHI = {result.regressionSlope.toFixed(3)} × Pressure +{' '}
          {result.regressionIntercept.toFixed(3)} (R² = {result.rSquared.toFixed(3)}, p ={' '}
          {result.pValue.toFixed(4)}).
          {result.regressionSlope < 0
            ? ' Higher pressures are associated with lower AHI — the expected therapeutic pattern.'
            : ' No clear inverse relationship detected between pressure and AHI.'}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Pressure Variability
// ---------------------------------------------------------------------------

const VariabilitySection = React.memo(function VariabilitySection({
  aggregates,
  grouping,
}: {
  aggregates: NightlyAggregate[];
  grouping: TimeGrouping;
}) {
  const variabilityResult = useMemo<PressureVariabilityResult | null>(() => {
    const pressures = aggregates.map((a) => a.pressureMean);
    if (pressures.length < 2) return null;
    return pressureVariability(pressures);
  }, [aggregates]);

  const boxPlotData = useMemo<BoxPlotGroup[]>(() => {
    const groups = new Map<string, number[]>();
    const keyFn = grouping === 'weekly' ? weekKey : monthKey;

    for (const agg of aggregates) {
      const key = keyFn(agg.date);
      const existing = groups.get(key);
      if (existing) {
        existing.push(agg.pressureMean);
      } else {
        groups.set(key, [agg.pressureMean]);
      }
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, values]) => ({ label, values }));
  }, [aggregates, grouping]);

  if (!variabilityResult) return null;

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Pressure Variability</h2>
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <p className={styles.summaryCardLabel}>Mean Pressure</p>
          <p className={styles.summaryCardValue}>{variabilityResult.mean.toFixed(1)} cmH₂O</p>
        </div>
        <div className={styles.summaryCard}>
          <p className={styles.summaryCardLabel}>Range (P5–P95)</p>
          <p className={styles.summaryCardValue}>
            {variabilityResult.p5.toFixed(1)} – {variabilityResult.p95.toFixed(1)} cmH₂O
          </p>
        </div>
        <div className={styles.summaryCard}>
          <p className={styles.summaryCardLabel}>CV</p>
          <p className={styles.summaryCardValue}>{(variabilityResult.cv * 100).toFixed(1)}%</p>
        </div>
        <div className={styles.summaryCard}>
          <p className={styles.summaryCardLabel}>Stability</p>
          <p className={styles.summaryCardValue}>
            <span className={stabilityBadgeClass(variabilityResult.interpretation)}>
              {variabilityResult.interpretation}
            </span>
          </p>
        </div>
      </div>
      {boxPlotData.length > 0 && (
        <ChartContainer
          title={`Pressure Distribution (${grouping === 'weekly' ? 'Weekly' : 'Monthly'})`}
          height={400}
        >
          <BoxPlot data={boxPlotData} height={350} />
        </ChartContainer>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: Titration Recommendations
// ---------------------------------------------------------------------------

const TitrationSection = React.memo(function TitrationSection({
  aggregates,
}: {
  aggregates: NightlyAggregate[];
}) {
  const result = useMemo<TitrationResult | null>(() => {
    const pressures = aggregates.map((a) => a.pressureMean);
    const ahiValues = aggregates.map((a) => a.ahi);
    if (pressures.length < 3) return null;
    return titrationHelper(pressures, ahiValues);
  }, [aggregates]);

  if (!result) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Titration Recommendations</h2>
        <div className={styles.emptyState}>
          <p>Not enough data for titration analysis (minimum 3 nights required).</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Titration Recommendations</h2>
      <div className={styles.recommendationPanel}>
        <div className={styles.recommendationRow}>
          <span className={styles.recommendationLabel}>Optimal Pressure Range</span>
          <span className={styles.recommendationValue}>
            {result.optimalPressureMin.toFixed(1)} – {result.optimalPressureMax.toFixed(1)} cmH₂O
          </span>
        </div>
        <div className={styles.recommendationRow}>
          <span className={styles.recommendationLabel}>AHI at Optimal Pressure</span>
          <span className={styles.recommendationValue}>
            {formatMetric('ahi', result.ahiAtOptimal)} events/hr
          </span>
        </div>
        <div className={styles.recommendationRow}>
          <span className={styles.recommendationLabel}>Regression R</span>
          <span className={styles.recommendationValue}>{result.regressionR.toFixed(3)}</span>
        </div>
        <div className={styles.recommendationRow}>
          <span className={styles.recommendationLabel}>Slope</span>
          <span className={styles.recommendationValue}>
            {result.regressionSlope.toFixed(4)} events/hr per cmH₂O
          </span>
        </div>
      </div>
      <div className={styles.recommendationText}>{result.recommendation}</div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-component: BiPAP Effectiveness
// ---------------------------------------------------------------------------

const BiPAPSection = React.memo(function BiPAPSection({
  aggregates,
}: {
  aggregates: NightlyAggregate[];
}) {
  // Only show if BiPAP data is available
  const hasBiPAP = aggregates.some((a) => a.epapMedian !== null && a.ipapMedian !== null);

  const result = useMemo<BiPAPEffectivenessResult | null>(() => {
    if (!hasBiPAP) return null;

    const epapValues: number[] = [];
    const ipapValues: number[] = [];
    const ahiValues: number[] = [];

    for (const agg of aggregates) {
      if (agg.epapMedian !== null && agg.ipapMedian !== null) {
        epapValues.push(agg.epapMedian);
        ipapValues.push(agg.ipapMedian);
        ahiValues.push(agg.ahi);
      }
    }

    if (epapValues.length < 3) return null;
    return bipapEffectiveness(epapValues, ipapValues, ahiValues);
  }, [aggregates, hasBiPAP]);

  // Mean of the nightly EPAP/IPAP medians across nights that report them.
  // These are arithmetic means (matching the neighbouring "Mean Pressure" and
  // "Mean Pressure Support" cards), not medians-of-medians.
  const meanEPAP = useMemo(
    () => mean(aggregates.map((a) => a.epapMedian).filter((v): v is number => v !== null)),
    [aggregates],
  );

  const meanIPAP = useMemo(
    () => mean(aggregates.map((a) => a.ipapMedian).filter((v): v is number => v !== null)),
    [aggregates],
  );

  if (!hasBiPAP) return null;

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>EPAP/IPAP Effectiveness</h2>
      <div className={styles.bipapSection}>
        <h3 className={styles.bipapTitle}>BiPAP Pressure Support Analysis</h3>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryCard}>
            <p className={styles.summaryCardLabel}>Mean EPAP</p>
            <p className={styles.summaryCardValue}>{meanEPAP.toFixed(1)} cmH₂O</p>
          </div>
          <div className={styles.summaryCard}>
            <p className={styles.summaryCardLabel}>Mean IPAP</p>
            <p className={styles.summaryCardValue}>{meanIPAP.toFixed(1)} cmH₂O</p>
          </div>
        </div>
        {result && (
          <>
            <div className={styles.recommendationPanel}>
              <div className={styles.recommendationRow}>
                <span className={styles.recommendationLabel}>Mean Pressure Support</span>
                <span className={styles.recommendationValue}>
                  {result.meanPressureSupport.toFixed(1)} cmH₂O
                </span>
              </div>
              <div className={styles.recommendationRow}>
                <span className={styles.recommendationLabel}>Correlation (R)</span>
                <span className={styles.recommendationValue}>{result.regressionR.toFixed(3)}</span>
              </div>
              <div className={styles.recommendationRow}>
                <span className={styles.recommendationLabel}>P-value</span>
                <span className={styles.recommendationValue}>{result.pValue.toFixed(4)}</span>
              </div>
            </div>
            <div className={styles.recommendationText}>{result.recommendation}</div>
          </>
        )}
        {!result && hasBiPAP && (
          <div className={styles.emptyState}>
            <p>Not enough BiPAP sessions with pressure support data for effectiveness analysis.</p>
          </div>
        )}
      </div>
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
      <p>
        Import CPAP data to see pressure optimisation results. Use the Data Management page to get
        started.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PressureOptimization() {
  const [grouping, setGrouping] = useState<TimeGrouping>('weekly');

  const { aggregates, loading, error, refetch } = usePressureData();

  if (loading) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>Pressure Optimization</h1>
        <div className={styles.spinner} role="status" aria-label="Loading pressure data">
          Loading pressure data…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>Pressure Optimization</h1>
        <div className={styles.errorBox}>
          <p>{error}</p>
          <button className={styles.retryButton} onClick={refetch} type="button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (aggregates.length === 0) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>Pressure Optimization</h1>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className={styles.page} role="main" aria-labelledby="pressure-heading">
      <h1 id="pressure-heading" className={styles.heading}>
        Pressure Optimization
      </h1>

      {/* Controls */}
      <div className={styles.controls} role="toolbar" aria-label="Pressure analysis controls">
        <div className={styles.controlGroup}>
          <label className={styles.controlLabel} htmlFor="grouping-select">
            Time Grouping
          </label>
          <select
            id="grouping-select"
            className={styles.select}
            value={grouping}
            onChange={(e) => setGrouping(e.target.value as TimeGrouping)}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>

      {/* Sections */}
      <PressureResponseSection aggregates={aggregates} />
      <VariabilitySection aggregates={aggregates} grouping={grouping} />
      <TitrationSection aggregates={aggregates} />
      <BiPAPSection aggregates={aggregates} />
    </div>
  );
}

export default PressureOptimization;
