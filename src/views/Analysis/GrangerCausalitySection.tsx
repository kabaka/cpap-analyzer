/**
 * Granger Causality section for the Statistical Analysis view.
 *
 * Tests whether the lagged history of one nightly metric (X, the potential
 * cause) helps predict another (Y, the potential effect) beyond Y's own past —
 * and vice-versa. The section is deliberately honest about inference: when the
 * lag is auto-selected by AIC the reported p-value is selection-affected
 * (exploratory), and a shared linear trend can manufacture spurious causality.
 *
 * Tab-scoped controls (Metric X / Y, max lag, inference mode) live inside this
 * panel rather than the global toolbar, because the global Metric / Rolling
 * Window controls are not meaningful for a bivariate causality test.
 *
 * @module views/Analysis/GrangerCausalitySection
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAnalysis } from '@/hooks/useAnalysis';
import { ChartContainer, ThemedLineChart } from '@/components/charts';
import type { ReferenceLineConfig } from '@/components/charts';
import { Badge } from '@/components/ui/Badge';
import { HelpPopover } from '@/components/help';
import type { GrangerCausalityResult } from '@/analysis/correlation/granger';
import { EmptyState, MetadataBanner, AssumptionsPanel } from './StatisticalAnalysis';
import {
  CONFIDENCE_META,
  CONFIDENCE_TITLE,
  DEFAULT_MAX_LAG,
  DEFAULT_X,
  DEFAULT_Y,
  MAX_LAG_OPTIONS,
  METRIC_OPTIONS,
  formatPValue,
  interpretationClause,
  largestFeasibleMaxLag,
  metricById,
  rewriteStationarityWarning,
  unavailableMessage,
  verdictText,
  type InferenceMode,
  type MetricOption,
} from './grangerHelpers';
import shared from './StatisticalAnalysis.module.css';
import styles from './GrangerCausality.module.css';

// ---------------------------------------------------------------------------
// Inline icons (inline SVG, no library — matches Toast/Accordion convention)
// ---------------------------------------------------------------------------

function InfoCircleIcon() {
  return (
    <svg
      className={styles.icon}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <line x1="8" y1="7.25" x2="8" y2="11.25" />
      <line x1="8" y1="4.75" x2="8" y2="5" />
    </svg>
  );
}

function WarningTriangleIcon() {
  return (
    <svg
      className={styles.icon}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.75 14.75 13.5H1.25L8 1.75Z" />
      <line x1="8" y1="6.25" x2="8" y2="9.75" />
      <line x1="8" y1="11.5" x2="8" y2="11.75" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Interpretation guide (contextual "how to read this" help)
// ---------------------------------------------------------------------------

/**
 * Expandable explainer that complements — and does not duplicate — the inline
 * honesty copy already in the result body (the selection-badge disclosure, the
 * predictive-not-causal interpretation note, and the AssumptionsPanel). It
 * gives a single "how to interpret this tab" entry point and links to the full
 * Interpreting Granger Causality help article. Built on a native <details>
 * element, so it is keyboard-operable with a visible focus ring out of the box.
 */
function InterpretationGuide() {
  return (
    <details className={styles.interpretGuide}>
      <summary>How to interpret these results</summary>
      <dl className={styles.interpretGuideBody}>
        <dt>Predictive precedence, not proof of cause</dt>
        <dd>
          A Granger result means the past of one metric helps forecast the other beyond that
          other&rsquo;s own past. It is not proof of physical causation — a lurking third factor
          driving both metrics can produce the same pattern.
        </dd>

        <dt>Directionality is one-way</dt>
        <dd>
          The F-statistic, p-value, and lag in the Directional detail panel are for the
          X&nbsp;&rarr; Y direction only. The verdict and confidence consider both directions;
          X&nbsp;&rarr;&nbsp;Y and Y&nbsp;&rarr;&nbsp;X are separate tests that can disagree.
        </dd>

        <dt>Exploratory vs. Confirmatory</dt>
        <dd>
          In Exploratory mode the lag is auto-selected by minimizing AIC on the same nights the test
          uses, so the p-value is selection-affected (anti-conservative) and understates the
          false-positive rate — treat it as hypothesis-generating. For a clean inferential p-value,
          use Confirmatory mode with a lag fixed from prior knowledge or a separate time period.
        </dd>

        <dt>Watch for non-stationarity</dt>
        <dd>
          A significant linear trend in an input violates the test&rsquo;s stationarity assumption;
          a shared trend can manufacture spurious causality. When that is detected the tab shows a
          caution — consider first-differencing (analyzing night-to-night changes) and re-running.
        </dd>

        <dt>Confidence reflects statistics only</dt>
        <dd>
          High (p&nbsp;&lt;&nbsp;0.01), moderate (p&nbsp;&lt;&nbsp;0.05), or low, based on the more
          significant of the two directions. It does not override the exploratory or
          non-stationarity flags, and high confidence still means predictive precedence, not
          causation.
        </dd>

        <dt>Reading the AIC-by-lag chart</dt>
        <dd>
          AIC scores each lag&rsquo;s model by fit minus complexity (lower is better). In
          Exploratory mode the lag with the lowest AIC is the one tested — which is exactly why that
          p-value is selection-affected. Lags with too few paired nights to fit appear as gaps.
        </dd>
      </dl>
      <Link className={styles.interpretGuideLink} to="/help/interpreting-granger-causality">
        Read the full guide: Interpreting Granger Causality &rarr;
      </Link>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const GrangerCausalitySection = React.memo(function GrangerCausalitySection() {
  // -- Control state --
  const [metricX, setMetricX] = useState<string>(DEFAULT_X);
  const [metricY, setMetricY] = useState<string>(DEFAULT_Y);
  const [maxLag, setMaxLag] = useState<number>(DEFAULT_MAX_LAG);
  const [mode, setMode] = useState<InferenceMode>('exploratory');
  const [fixedLag, setFixedLag] = useState<number>(1);

  // -- Stable element ids --
  const baseId = useId();
  const selectionBadgeId = `${baseId}-selection-badge`;

  // -- Focus management refs --
  const fixedLagRef = useRef<HTMLSelectElement>(null);
  const modeGroupRef = useRef<HTMLFieldSetElement>(null);
  const pendingFocus = useRef<null | 'fixedLag' | 'mode'>(null);

  const xMeta = metricById(metricX);
  const yMeta = metricById(metricY);

  // X ≠ Y invariant: if they collide, shift Y to the first non-X option.
  useEffect(() => {
    if (metricX === metricY) {
      const fallback = METRIC_OPTIONS.find((m) => m.id !== metricX);
      if (fallback) setMetricY(fallback.id);
    }
  }, [metricX, metricY]);

  // Clamp the confirmatory fixed lag to the current max lag.
  useEffect(() => {
    if (fixedLag > maxLag) setFixedLag(maxLag);
  }, [fixedLag, maxLag]);

  // Move focus deterministically when the inference mode toggles.
  useEffect(() => {
    if (pendingFocus.current === 'fixedLag') {
      fixedLagRef.current?.focus();
    } else if (pendingFocus.current === 'mode') {
      modeGroupRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
    }
    pendingFocus.current = null;
  }, [mode]);

  const lagParam = mode === 'confirmatory' ? fixedLag : undefined;

  const parameters = useMemo(
    () => ({
      metric: metricX,
      metric2: metricY,
      maxLag,
      ...(lagParam !== undefined ? { lag: lagParam } : {}),
    }),
    [metricX, metricY, maxLag, lagParam],
  );

  const { data, loading, error, metadata, refetch } = useAnalysis<GrangerCausalityResult>({
    type: 'granger-causality',
    parameters,
  });

  // Remember the last AIC-selected optimal lag to seed the fixed-lag default.
  const lastOptimalLag = useRef<number | null>(null);
  useEffect(() => {
    if (data && Number.isFinite(data.fStatistic)) {
      lastOptimalLag.current = data.optimalLag;
    }
  }, [data]);

  const handleModeChange = useCallback(
    (next: InferenceMode) => {
      if (next === mode) return;
      if (next === 'confirmatory') {
        const seed = lastOptimalLag.current ?? 1;
        setFixedLag(Math.min(Math.max(seed, 1), maxLag));
        pendingFocus.current = 'fixedLag';
      } else {
        pendingFocus.current = 'mode';
      }
      setMode(next);
    },
    [mode, maxLag],
  );

  const handleReduceMaxLag = useCallback(() => {
    // Feasibility is computed against the finite-paired sample actually used by
    // the test (nPaired), not the raw row count, so the suggested max lag fits
    // the data that survived pairwise finite filtering.
    const nPaired = data?.nPaired ?? 0;
    const feasible = largestFeasibleMaxLag(nPaired);
    if (feasible !== null) setMaxLag(feasible);
  }, [data?.nPaired]);

  // -- AIC chart data: keep NaN as gaps (null), preserve x positions. --
  const aicChartData = useMemo(() => {
    if (!data) return [];
    return data.aicValues.map((aic, i) => ({
      lag: i + 1,
      aic: Number.isFinite(aic) ? aic : null,
    }));
  }, [data]);

  const aicReferenceLines = useMemo<ReferenceLineConfig[]>(() => {
    if (!data || !Number.isFinite(data.fStatistic)) return [];
    return [
      {
        value: data.optimalLag,
        axis: 'x',
        label: 'reported lag',
        color: 'var(--color-status-moderate)',
        strokeDasharray: '5 3',
      },
    ];
  }, [data]);

  // -- Tab-scoped controls (rendered in every state) --
  const controls = (
    <div className={styles.controlCluster} role="toolbar" aria-label="Granger causality controls">
      <div className={shared.controlGroup}>
        <label className={shared.controlLabel} htmlFor="granger-x">
          Metric X (potential cause)
        </label>
        <select
          id="granger-x"
          className={shared.select}
          value={metricX}
          onChange={(e) => setMetricX(e.target.value)}
        >
          {METRIC_OPTIONS.map((m) => (
            <option key={m.id} value={m.id} disabled={m.id === metricY}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className={shared.controlGroup}>
        <label className={shared.controlLabel} htmlFor="granger-y">
          Metric Y (potential effect)
        </label>
        <select
          id="granger-y"
          className={shared.select}
          value={metricY}
          onChange={(e) => setMetricY(e.target.value)}
        >
          {METRIC_OPTIONS.map((m) => (
            <option key={m.id} value={m.id} disabled={m.id === metricX}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className={shared.controlGroup}>
        <label className={shared.controlLabel} htmlFor="granger-maxlag">
          Max lag (nights)
        </label>
        <select
          id="granger-maxlag"
          className={shared.select}
          value={maxLag}
          onChange={(e) => setMaxLag(Number(e.target.value))}
        >
          {MAX_LAG_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <fieldset className={styles.modeFieldset} ref={modeGroupRef}>
        <legend className={styles.modeLegend}>Inference mode</legend>
        <div className={styles.modeOptions}>
          <label className={styles.modeOption}>
            <input
              type="radio"
              name="granger-mode"
              value="exploratory"
              checked={mode === 'exploratory'}
              onChange={() => handleModeChange('exploratory')}
            />
            Exploratory — auto-select lag by AIC
          </label>
          <label className={styles.modeOption}>
            <input
              type="radio"
              name="granger-mode"
              value="confirmatory"
              checked={mode === 'confirmatory'}
              onChange={() => handleModeChange('confirmatory')}
            />
            Confirmatory — fixed lag
          </label>
        </div>

        {mode === 'confirmatory' && (
          <div className={shared.controlGroup}>
            <label className={shared.controlLabel} htmlFor="granger-fixed-lag">
              Fixed lag (nights)
            </label>
            <select
              id="granger-fixed-lag"
              ref={fixedLagRef}
              className={shared.select}
              value={fixedLag}
              onChange={(e) => setFixedLag(Number(e.target.value))}
            >
              {Array.from({ length: maxLag }, (_, i) => i + 1).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        )}

        <p className={styles.modeHelp}>
          {mode === 'exploratory'
            ? 'The lag is chosen from the data, so the p-value is exploratory (anti-conservative). Use it to generate hypotheses, not to confirm them.'
            : 'You fixed the lag, so the p-value is a clean inferential result. For honest confirmation, choose this lag from prior knowledge or a separate time period — not from the AIC chart below on this same data.'}
        </p>
      </fieldset>
    </div>
  );

  const sampleSize = metadata?.sampleSize ?? 0;
  // Feasibility of a smaller max lag is judged against the finite-paired sample
  // (nPaired), the same basis the test itself uses, so the offered max lag fits.
  const feasibleMaxLag = largestFeasibleMaxLag(data?.nPaired ?? 0);

  return (
    <div className={shared.section}>
      <div className={styles.titleRow}>
        <h2 className={shared.sectionTitle} style={{ marginBottom: 0 }}>
          Granger Causality — {xMeta.label} vs. {yMeta.label}
        </h2>
        <HelpPopover termId="granger-causality" side="bottom">
          What is this?
        </HelpPopover>
      </div>

      {controls}

      <InterpretationGuide />

      {metadata && <MetadataBanner metadata={metadata} />}

      <div aria-live="polite" aria-atomic="false" aria-busy={loading}>
        {loading && (
          <div className={shared.spinner} role="status" aria-live="polite">
            Computing Granger causality…
          </div>
        )}

        {!loading && error && (
          <div className={shared.errorBox}>
            <p>{error}</p>
            <button className={shared.retryButton} onClick={refetch} type="button">
              Retry
            </button>
          </div>
        )}

        {!loading && !error && data && sampleSize === 0 && <EmptyState />}

        {!loading && !error && data && sampleSize > 0 && (
          <GrangerResult
            data={data}
            xMeta={xMeta}
            yMeta={yMeta}
            maxLag={maxLag}
            mode={mode}
            feasibleMaxLag={feasibleMaxLag}
            onReduceMaxLag={handleReduceMaxLag}
            selectionBadgeId={selectionBadgeId}
            aicChartData={aicChartData}
            aicReferenceLines={aicReferenceLines}
          />
        )}
      </div>

      <AssumptionsPanel assumptions={metadata?.assumptions} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Result body (regions C–G)
// ---------------------------------------------------------------------------

interface GrangerResultProps {
  data: GrangerCausalityResult;
  xMeta: MetricOption;
  yMeta: MetricOption;
  maxLag: number;
  mode: InferenceMode;
  feasibleMaxLag: number | null;
  onReduceMaxLag: () => void;
  selectionBadgeId: string;
  aicChartData: Array<{ lag: number; aic: number | null }>;
  aicReferenceLines: ReferenceLineConfig[];
}

function GrangerResult({
  data,
  xMeta,
  yMeta,
  maxLag,
  mode,
  feasibleMaxLag,
  onReduceMaxLag,
  selectionBadgeId,
  aicChartData,
  aicReferenceLines,
}: GrangerResultProps) {
  // Branch on the explicit contract discriminant — never on NaN/array-shape
  // heuristics. A constant metric with ample data must NOT read as "not enough
  // nights" (Correctness, core principle #2).
  if (data.unavailableReason !== null) {
    const { heading, body } = unavailableMessage(data.unavailableReason, {
      xLabel: xMeta.label,
      yLabel: yMeta.label,
      maxLag,
      nPaired: data.nPaired,
    });
    const showReduce =
      data.unavailableReason === 'insufficient-data' &&
      feasibleMaxLag !== null &&
      feasibleMaxLag < maxLag;
    return (
      <div className={shared.errorBox} role="status">
        <p>
          <strong>{heading}</strong> — {body}
        </p>
        {showReduce && (
          <button className={shared.retryButton} onClick={onReduceMaxLag} type="button">
            Reduce max lag
          </button>
        )}
      </div>
    );
  }

  const conf = CONFIDENCE_META[data.confidenceLevel];

  return (
    <>
      {/* (C) Result summary */}
      <div className={styles.verdictBlock}>
        <div className={styles.verdict}>
          <span>{verdictText(data.causality, xMeta.label, yMeta.label)}</span>
          <span
            className={`${styles.confidenceChip} ${styles[conf.className]}`}
            title={CONFIDENCE_TITLE}
          >
            <span className={styles.confidenceDots} aria-hidden="true">
              {conf.dots}
            </span>
            <span>{conf.label}</span>
          </span>
        </div>
        <p className={styles.scopeNote}>
          Verdict considers both directions; the statistics below are for the {xMeta.label} →{' '}
          {yMeta.label} direction only.
        </p>
      </div>

      {/* (D) Honesty flags — selection badge first, then stationarity caution */}
      {data.selectionAffected && (
        <div role="note" aria-label="Exploratory p-value, lag auto-selected">
          <Badge variant="warning" size="sm">
            <span
              id={selectionBadgeId}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
            >
              <InfoCircleIcon />
              Exploratory p-value — lag auto-selected
            </span>
          </Badge>
          <details className={styles.disclosure}>
            <summary>Why is this exploratory?</summary>
            <p className={styles.disclosureBody}>
              The lag for this test was chosen by minimizing AIC on the same nights used to compute
              the F-test. When the data both chooses and tests the model, the p-value is
              selection-affected (anti-conservative) — it understates the true false-positive rate,
              so causality is declared too readily. Treat this result as a hypothesis to
              investigate, not a confirmed finding. To obtain a clean inferential p-value, switch to
              Confirmatory mode above and fix the lag (ideally chosen from prior knowledge or a
              separate stretch of nights).
            </p>
          </details>
        </div>
      )}

      {data.stationarityWarning !== null && (
        <div className={styles.callout} role="note">
          <span className={styles.calloutIcon}>
            <WarningTriangleIcon />
          </span>
          <h3 className={styles.calloutHeading}>Non-stationarity caution</h3>
          <p className={styles.calloutBody}>
            {rewriteStationarityWarning(data.stationarityWarning, xMeta.label, yMeta.label)}
          </p>
        </div>
      )}

      {/* (E) Directional detail */}
      <div className={styles.panelHeader}>
        <h3 className={shared.sectionTitle} style={{ marginBottom: 'var(--space-1)' }}>
          Directional detail —{' '}
          <span className={styles.directionLabel}>
            {xMeta.label} → {yMeta.label}
          </span>
        </h3>
        <p className={shared.hypothesisSubtitle}>
          These three statistics describe the {xMeta.label} → {yMeta.label} direction only. The
          reverse direction is summarized in the verdict above but its F-statistic is not shown
          here.
        </p>
      </div>

      <div className={shared.hypothesisPanel}>
        <div className={shared.hypothesisRow}>
          <span className={shared.hypothesisLabel}>F-statistic</span>
          <span className={shared.hypothesisValue}>{data.fStatistic.toFixed(3)}</span>
        </div>
        <div className={shared.hypothesisRow}>
          <span className={shared.hypothesisLabel}>p-value</span>
          <span className={shared.hypothesisValue}>
            {formatPValue(data.pValue)}
            {data.selectionAffected && (
              <span className={styles.pQualifier} aria-describedby={selectionBadgeId}>
                (exploratory)
              </span>
            )}
          </span>
        </div>
        <div className={shared.hypothesisRow}>
          <span className={shared.hypothesisLabel}>Reported lag</span>
          <span className={shared.hypothesisValue}>
            {data.optimalLag} nights {mode === 'exploratory' ? '(AIC-selected)' : '(fixed)'}
          </span>
        </div>
      </div>

      {/* (F) AIC-by-lag chart */}
      <ChartContainer
        title={`AIC by lag — ${xMeta.label} → ${yMeta.label} unrestricted model`}
        height={360}
      >
        <ThemedLineChart
          data={aicChartData}
          xKey="lag"
          xLabel="Lag (nights)"
          yLabel="AIC"
          height={300}
          lines={[{ dataKey: 'aic', name: 'AIC', dot: true }]}
          referenceLines={aicReferenceLines}
        />
      </ChartContainer>
      <div className={styles.markerLegend} aria-hidden="true">
        <span className={styles.markerLegendItem}>
          <span className={styles.swatchSelected} />
          reported lag
        </span>
        <span className={styles.markerLegendItem}>
          <span className={styles.swatchInfeasible} />
          infeasible lag (gap)
        </span>
      </div>
      <details className={styles.disclosure}>
        <summary>View AIC values as a table</summary>
        <table className={shared.statsTable} aria-label="AIC values by lag">
          <thead>
            <tr>
              <th scope="col">Lag</th>
              <th scope="col">AIC</th>
            </tr>
          </thead>
          <tbody>
            {data.aicValues.map((aic, i) => (
              <tr key={i + 1}>
                <td>{i + 1}</td>
                <td>{Number.isFinite(aic) ? aic.toFixed(3) : 'infeasible'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className={shared.hypothesisSubtitle} style={{ marginTop: 'var(--space-2)' }}>
        In Exploratory mode the lag with the lowest AIC is the one tested — which is exactly why
        that p-value is selection-affected.
      </p>

      {/* (G) Interpretation */}
      <div className={shared.interpretation}>
        Granger causality is predictive, not proof of true causation: it means past values of one
        metric help forecast the other beyond the other&rsquo;s own past. A lurking third factor
        (e.g. a behavior or condition driving both) can produce the same pattern.{' '}
        {interpretationClause(data.causality, xMeta.label, yMeta.label, data.optimalLag)}
      </div>
    </>
  );
}

export default GrangerCausalitySection;
