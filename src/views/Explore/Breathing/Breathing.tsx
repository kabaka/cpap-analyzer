/**
 * Explore → Breathing Patterns view.
 *
 * Three sections, top to bottom:
 *
 * 1. **Longitudinal TECSA overview** — the trajectory class for the active date
 *    range with class badge (colour + shape + label per WCAG-AA "colour never
 *    the sole signal"), early-vs-late CAI numbers, usable-night fraction, a
 *    continuous confidence bar, the CAI threshold, a CAI-over-time sparkline,
 *    and a plain-language explainer keyed off the class. Honours
 *    `available === false` with an honest "insufficient history" state.
 *
 * 2. **Episode catalog** — per-night periodic-breathing / Cheyne-Stokes
 *    candidate episodes across the date range, filterable by type and
 *    confidence and sortable by confidence, time, or cycle length. Each row
 *    deep-links into the Signal Viewer centred on the episode start.
 *
 * 3. **Selected-episode detail** — features for the row the user clicked, with
 *    the standing "candidate, not diagnosis" disclaimer.
 *
 * Per ADR 0017 every surface here is **candidate detection, never diagnosis**.
 * The class palette is the calm cyan→indigo→violet ramp — never status-severe.
 *
 * @module views/Explore/Breathing/Breathing
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import type { TecsaClass, TecsaClassification, TecsaNightFlag } from '@/analysis/breathing';
import { tecsaPresentation, TECSA_PRESENTATION_ORDER } from '@/analysis/breathing';
import { ConfidenceBar, DetectionDisclaimer, TecsaClassBadge } from '@/components/domain/Breathing';
import { DateRangeSelector } from '@/components/domain/DateRangeSelector';
import { Button, Card, Popover, ProgressBar, Select, Skeleton, Slider } from '@/components/ui';
import { useAnalysis } from '@/hooks/useAnalysis';
import {
  useBreathingEpisodeCatalog,
  type CatalogEpisode,
  type CatalogFailure,
  type CatalogPhase,
} from '@/hooks/useBreathingEpisodeCatalog';
import { useNightlyAggregates } from '@/hooks/useNightlyAggregates';
import { LEAK_NOTICE_LPM } from '@/analysis/uncertainty/constants';
import { useAppStore } from '@/stores/useAppStore';

import styles from './Breathing.module.css';

// ---------------------------------------------------------------------------
// TECSA section
// ---------------------------------------------------------------------------

interface TecsaSectionProps {
  readonly classification: TecsaClassification | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly nightFlags: readonly TecsaNightFlag[];
}

function TecsaSection({
  classification,
  loading,
  error,
  nightFlags,
}: TecsaSectionProps): JSX.Element {
  return (
    <Card className={styles.tecsaCard} aria-labelledby="tecsa-heading">
      <header className={styles.sectionHeader}>
        <h2 id="tecsa-heading" className={styles.sectionTitle}>
          TECSA trajectory
        </h2>
        <p className={styles.sectionSubtitle}>
          Four-class longitudinal pattern across the selected date range (Liu et al. 2017).
        </p>
      </header>

      {loading && <p className={styles.muted}>Computing classification…</p>}
      {error && !loading && <p className={styles.errorText}>{error}</p>}

      {!loading && !error && classification && !classification.available && (
        <div className={styles.insufficient} role="status">
          <p>
            <strong>Insufficient history to classify.</strong>
          </p>
          <p className={styles.muted}>
            The classifier needs at least {3} usable (low-leak) nights in both an early-treatment
            window and a late-treatment window 13+ weeks later. Only {classification.earlyNights}{' '}
            early and {classification.lateNights} late usable nights were found in this range.
            Extend the date range or import more nights, then revisit.
          </p>
        </div>
      )}

      {!loading && !error && classification && classification.available && classification.class && (
        <TecsaResult classification={classification} nightFlags={nightFlags} />
      )}
    </Card>
  );
}

function TecsaResult({
  classification,
  nightFlags,
}: {
  classification: TecsaClassification;
  nightFlags: readonly TecsaNightFlag[];
}): JSX.Element {
  const cls = classification.class as TecsaClass;
  const presentation = tecsaPresentation(cls);

  return (
    <div className={styles.tecsaBody}>
      <div className={styles.tecsaBadgeRow}>
        <TecsaClassBadge tecsaClass={cls} showSubtitle />
      </div>

      <p className={styles.tecsaExplainer}>{presentation.explainer}</p>

      <dl className={styles.tecsaMetrics}>
        <div>
          <dt>Early CAI</dt>
          <dd>{classification.earlyCai.toFixed(1)}/h</dd>
        </div>
        <div>
          <dt>Late CAI</dt>
          <dd>{classification.lateCai.toFixed(1)}/h</dd>
        </div>
        <div>
          <dt>Threshold</dt>
          <dd>{classification.caiThreshold.toFixed(1)}/h</dd>
        </div>
        <div>
          <dt>Usable nights</dt>
          <dd>
            {classification.earlyNights} early · {classification.lateNights} late
          </dd>
        </div>
        <div>
          <dt>Usable fraction</dt>
          <dd>{Math.round(classification.usableNightFraction * 100)}%</dd>
        </div>
      </dl>

      <div className={styles.tecsaConfidence}>
        <span className={styles.tecsaConfidenceLabel}>Classifier confidence</span>
        <ConfidenceBar value={classification.confidence} label="TECSA classifier confidence" />
      </div>

      <CaiSparkline flags={nightFlags} threshold={classification.caiThreshold} />

      <DetectionDisclaimer />
    </div>
  );
}

/**
 * Inline SVG sparkline of per-night CAI with the threshold line and a marker
 * for candidate nights. Kept as a self-contained SVG so the Breathing view
 * pulls in no extra chart dependency.
 */
function CaiSparkline({
  flags,
  threshold,
}: {
  flags: readonly TecsaNightFlag[];
  threshold: number;
}): JSX.Element {
  const width = 480;
  const height = 100;
  const padding = { top: 10, right: 8, bottom: 22, left: 28 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  if (flags.length === 0) {
    return <p className={styles.muted}>No usable nights to chart in this range.</p>;
  }

  const maxCai = Math.max(threshold * 1.5, ...flags.map((f) => f.cai), 1);

  const xFor = (i: number): number =>
    padding.left + (plotWidth * i) / Math.max(1, flags.length - 1);
  const yFor = (v: number): number => padding.top + plotHeight * (1 - Math.min(1, v / maxCai));

  const pathD = flags.map((f, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(f.cai)}`).join(' ');

  return (
    <figure className={styles.sparklineFig}>
      <figcaption className={styles.sparklineCaption}>
        Per-night central apnea index (CAI). The dashed line marks the classifier threshold; squares
        mark TECSA-candidate nights.
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={styles.sparkline}
        role="img"
        aria-label="Per-night CAI sparkline"
      >
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={yFor(threshold)}
          y2={yFor(threshold)}
          className={styles.sparklineThreshold}
        />
        <text
          x={padding.left - 4}
          y={yFor(threshold) + 3}
          className={styles.sparklineThresholdLabel}
          textAnchor="end"
        >
          {threshold.toFixed(0)}
        </text>
        <path d={pathD} className={styles.sparklinePath} />
        {flags.map((f, i) => (
          <g key={f.date}>
            <circle
              cx={xFor(i)}
              cy={yFor(f.cai)}
              r={f.candidate ? 0 : 2.5}
              className={styles.sparklineDot}
            />
            {f.candidate && (
              <rect
                x={xFor(i) - 3}
                y={yFor(f.cai) - 3}
                width={6}
                height={6}
                className={styles.sparklineCandidate}
              />
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Episode catalog section
// ---------------------------------------------------------------------------

type EpisodeFilter = 'all' | 'PeriodicBreathing' | 'CheyneStokes';
type EpisodeSort = 'confidence' | 'date' | 'cycleLength' | 'duration';

/** Pluralisation helper — "" for 1, "s" otherwise (UX spec §9 `{plural}`). */
function plural(n: number): string {
  return n === 1 ? '' : 's';
}

/**
 * Canonical OPFS-unsupported copy (UX spec §9 copy table, verbatim). The hook
 * emits a terse technical string for this capability gate; the view presents the
 * richer, patient-facing message instead — matching how the rest of the app
 * surfaces capability-unsupported states (e.g. the Signal Viewer's "not available
 * in this browser" notice) and keeping the engineering detail out of the UI.
 */
const OPFS_UNSUPPORTED_COPY =
  "Breathing analysis isn't available in this browser. It needs the Origin Private File System " +
  '(OPFS) to read your full-resolution airflow signals. Try a recent Chrome, Edge, or Safari, or ' +
  'see the browser-support guide.';

/**
 * Map a fatal hook error to user-facing copy. The OPFS-unsupported gate is a
 * known capability failure with canonical §8.2/§9 copy; any other fatal error is
 * surfaced as-is (already plain-language from the hook, per §8.5).
 */
function friendlyCatalogError(error: string): string {
  return /OPFS is not supported/i.test(error) ? OPFS_UNSUPPORTED_COPY : error;
}

interface EpisodeCatalogProps {
  readonly rows: readonly CatalogEpisode[];
  readonly phase: CatalogPhase;
  readonly nightsTotal: number;
  readonly nightsCached: number;
  readonly nightsComputed: number;
  readonly nightsFailed: number;
  readonly failures: readonly CatalogFailure[];
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onResume: () => void;
  readonly onSelect: (row: CatalogEpisode) => void;
  readonly selectedKey: string | null;
}

/**
 * The catalog status copy (UX spec §9), `aria-valuetext` for the progress bar,
 * and the throttled live-region text are all derived from the same phase +
 * counts so the visible line and the screen-reader announcement agree.
 */
function buildProgressValueText(
  phase: CatalogPhase,
  nightsTotal: number,
  nightsCached: number,
  nightsDone: number,
): string {
  switch (phase) {
    case 'reading-cache':
      return `Reading saved analysis: ${nightsCached} of ${nightsTotal} nights.`;
    case 'cancelled':
      return `Analysis cancelled at ${nightsDone} of ${nightsTotal} nights.`;
    case 'complete':
      return `Analysis complete: ${nightsDone} of ${nightsTotal} nights.`;
    case 'computing':
    default:
      return `Analyzing: ${nightsDone} of ${nightsTotal} nights done, ${nightsCached} from cache.`;
  }
}

function EpisodeCatalog({
  rows,
  phase,
  nightsTotal,
  nightsCached,
  nightsComputed,
  nightsFailed,
  failures,
  error,
  onCancel,
  onResume,
  onSelect,
  selectedKey,
}: EpisodeCatalogProps): JSX.Element {
  const [typeFilter, setTypeFilter] = useState<EpisodeFilter>('all');
  const [confidenceMin, setConfidenceMin] = useState(0);
  const [sortBy, setSortBy] = useState<EpisodeSort>('confidence');

  const nightsDone = nightsCached + nightsComputed;
  const nightsAnalyzed = nightsDone - nightsFailed;
  const nightsRemaining = Math.max(0, nightsTotal - nightsDone - nightsFailed);
  const running = phase === 'reading-cache' || phase === 'computing';

  const filtered = useMemo(() => {
    const minPct = confidenceMin / 100;
    return rows.filter((r) => {
      if (typeFilter !== 'all' && r.episode.type !== typeFilter) return false;
      if (r.episode.confidence < minPct) return false;
      return true;
    });
  }, [rows, typeFilter, confidenceMin]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return b.nightStartMs - a.nightStartMs;
        case 'cycleLength':
          return b.episode.cycleLengthSec - a.episode.cycleLengthSec;
        case 'duration':
          return b.episode.durationSec - a.episode.durationSec;
        case 'confidence':
        default:
          return b.episode.confidence - a.episode.confidence;
      }
    });
    return copy;
  }, [filtered, sortBy]);

  // ── Throttled live-region text (UX §6.2) ──────────────────────────────
  // Update the announced text only on phase transitions and ~10% milestones,
  // never on every streamed night. The visible counts update every render.
  const [liveText, setLiveText] = useState('');
  const lastMilestoneRef = useRef(-1);
  const lastPhaseRef = useRef<CatalogPhase>('idle');

  useEffect(() => {
    const milestone = nightsTotal > 0 ? Math.floor((nightsDone / nightsTotal) * 10) : 0;
    const phaseChanged = lastPhaseRef.current !== phase;
    const milestoneChanged = milestone !== lastMilestoneRef.current;
    const terminal = phase === 'complete' || phase === 'cancelled' || phase === 'error';

    if (!phaseChanged && !milestoneChanged && !terminal) return;
    lastPhaseRef.current = phase;
    lastMilestoneRef.current = milestone;

    if (phase === 'reading-cache') {
      setLiveText(
        `Reading saved analysis. ${nightsCached} of ${nightsTotal} night${plural(nightsTotal)}.`,
      );
    } else if (phase === 'computing') {
      setLiveText(
        `Analyzing ${nightsRemaining} new night${plural(nightsRemaining)}. ${nightsDone} of ${nightsTotal} done, ${nightsCached} from cache.`,
      );
    } else if (phase === 'complete') {
      setLiveText(
        nightsFailed > 0
          ? `Analysis complete. ${sorted.length} episode${plural(
              sorted.length,
            )} from ${nightsAnalyzed} night${plural(nightsAnalyzed)}. ${nightsFailed} night${plural(
              nightsFailed,
            )} could not be analyzed.`
          : `Analysis complete. ${sorted.length} episode${plural(
              sorted.length,
            )} from ${nightsAnalyzed} of ${nightsTotal} night${plural(nightsTotal)}.`,
      );
    } else if (phase === 'cancelled') {
      setLiveText(
        `Analysis cancelled. Showing ${nightsDone} of ${nightsTotal} nights. ${nightsRemaining} night${plural(
          nightsRemaining,
        )} not yet analyzed.`,
      );
    } else if (phase === 'error') {
      setLiveText(error ? friendlyCatalogError(error) : 'Could not load the episode catalog.');
    }
  }, [
    phase,
    nightsTotal,
    nightsCached,
    nightsDone,
    nightsRemaining,
    nightsFailed,
    nightsAnalyzed,
    sorted.length,
    error,
  ]);

  // ── Focus management (UX §6.5): Cancel↔Resume↔status ──────────────────
  // We capture the user's focus *intent* at the moment they press Cancel/Resume,
  // rather than inferring it from `document.activeElement` after the transition.
  // The activating button unmounts as the phase flips, so by the time the effect
  // runs focus has already fallen to <body> — an `activeElement`-based guard then
  // wrongly concludes focus is outside the catalog and skips the move (the
  // reported WCAG defect). A one-shot intent ref, set only on a deliberate press,
  // is the cleanest fix: focus moves on user-driven transitions and never on an
  // unrelated re-render (the ref is null unless a button was just pressed).
  const cancelRef = useRef<HTMLButtonElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const prevPhaseRef = useRef<CatalogPhase>('idle');
  const focusIntentRef = useRef<'cancel' | 'resume' | null>(null);

  const handleCancel = useCallback(() => {
    // After cancel, Cancel is replaced by Resume in the same row → land on Resume.
    focusIntentRef.current = 'cancel';
    onCancel();
  }, [onCancel]);

  const handleResume = useCallback(() => {
    // After resume, Resume is replaced by Cancel again → land back on Cancel.
    focusIntentRef.current = 'resume';
    onResume();
  }, [onResume]);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (prev === phase) return;

    const intent = focusIntentRef.current;
    focusIntentRef.current = null;

    // Cancel pressed → run parks at `cancelled`; move focus to the new Resume.
    if (intent === 'cancel' && phase === 'cancelled' && resumeRef.current) {
      resumeRef.current.focus();
      return;
    }
    // Resume pressed → run re-enters reading-cache/computing; focus the new Cancel.
    if (
      intent === 'resume' &&
      (phase === 'computing' || phase === 'reading-cache') &&
      cancelRef.current
    ) {
      cancelRef.current.focus();
      return;
    }
    // Resume that immediately completes (nothing left to compute): Cancel never
    // reappears, so land on the table region if it exists, else the status line —
    // never drop the user on <body> (UX §6.5).
    if (intent === 'resume' && phase === 'complete') {
      (tableRef.current ?? statusRef.current)?.focus();
    }
  }, [phase]);

  const valueText = buildProgressValueText(phase, nightsTotal, nightsCached, nightsDone);

  return (
    <Card className={styles.catalogCard} aria-labelledby="catalog-heading">
      <header className={styles.sectionHeader}>
        <h2 id="catalog-heading" className={styles.sectionTitle}>
          Episode catalog
        </h2>
        <p className={styles.sectionSubtitle}>
          Per-session candidate periodic-breathing and Cheyne-Stokes episodes across the date range.
        </p>
      </header>

      <div className={styles.catalogControls}>
        <label className={styles.controlLabel}>
          <span>Pattern</span>
          <Select
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v as EpisodeFilter)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'PeriodicBreathing', label: 'Periodic breathing' },
              { value: 'CheyneStokes', label: 'Cheyne-Stokes' },
            ]}
          />
        </label>
        <label className={styles.controlLabel}>
          <span>Min confidence: {confidenceMin}%</span>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[confidenceMin]}
            onValueChange={(v) => setConfidenceMin(v[0] ?? 0)}
          />
        </label>
        <label className={styles.controlLabel}>
          <span>Sort</span>
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as EpisodeSort)}
            options={[
              { value: 'confidence', label: 'Confidence (high→low)' },
              { value: 'date', label: 'Date (newest first)' },
              { value: 'cycleLength', label: 'Cycle length' },
              { value: 'duration', label: 'Duration' },
            ]}
          />
        </label>
      </div>

      {/* Throttled polite live region — announces phase + milestones only. */}
      <div className={styles.visuallyHidden} aria-live="polite" role="status">
        {liveText}
      </div>

      {phase !== 'error' && nightsTotal > 0 && (
        <div className={styles.catalogProgress}>
          <div className={styles.catalogProgressRow}>
            <ProgressBar
              className={styles.catalogProgressBar}
              value={nightsDone}
              max={nightsTotal}
              paused={phase === 'cancelled'}
              label="Breathing analysis progress"
              valueText={valueText}
            />
            {running && (
              <Button
                ref={cancelRef}
                className={styles.catalogProgressAction}
                variant="secondary"
                size="sm"
                aria-label="Cancel breathing analysis"
                onClick={handleCancel}
              >
                Cancel
              </Button>
            )}
            {phase === 'cancelled' && (
              <Button
                ref={resumeRef}
                className={styles.catalogProgressAction}
                variant="secondary"
                size="sm"
                aria-label={`Resume breathing analysis for the remaining ${nightsRemaining} nights`}
                onClick={handleResume}
              >
                Resume analysis
              </Button>
            )}
          </div>
        </div>
      )}

      <div ref={statusRef} className={styles.catalogStatusLine} tabIndex={-1} data-phase={phase}>
        <CatalogStatusCopy
          phase={phase}
          filteredCount={sorted.length}
          totalEpisodes={rows.length}
          nightsTotal={nightsTotal}
          nightsCached={nightsCached}
          nightsDone={nightsDone}
          nightsRemaining={nightsRemaining}
          nightsAnalyzed={nightsAnalyzed}
        />
      </div>

      {nightsFailed > 0 && (phase === 'complete' || phase === 'cancelled') && (
        <FailureDisclosure failures={failures} nightsFailed={nightsFailed} />
      )}

      {error && (
        <p className={styles.errorText} role="alert">
          <span className={styles.errorIcon} aria-hidden="true">
            ⚠
          </span>{' '}
          {friendlyCatalogError(error)}
        </p>
      )}

      {phase === 'reading-cache' && rows.length === 0 && (
        <div className={styles.skeletonRows} aria-hidden="true">
          <Skeleton height={28} />
          <Skeleton height={28} />
          <Skeleton height={28} />
        </div>
      )}

      {!error && sorted.length > 0 && (
        <div
          ref={tableRef}
          className={styles.tableScroll}
          tabIndex={-1}
          role="region"
          aria-label="Episode catalog results"
        >
          <table className={styles.catalogTable}>
            <thead>
              <tr>
                <th scope="col">Night</th>
                <th scope="col">Pattern</th>
                <th scope="col">Confidence</th>
                <th scope="col">Cycle</th>
                <th scope="col">Modulation</th>
                <th scope="col">Duration</th>
                <th scope="col" className={styles.catalogActionsHead}>
                  Open
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const key = `${row.sessionId}-${row.episode.id}`;
                const isSelected = key === selectedKey;
                return (
                  <tr
                    key={key}
                    className={isSelected ? styles.rowSelected : undefined}
                    aria-selected={isSelected}
                  >
                    <td>
                      <button
                        type="button"
                        className={styles.linkLikeButton}
                        onClick={() => onSelect(row)}
                      >
                        {row.nightDate}
                      </button>
                    </td>
                    <td>
                      <span className={styles.patternTag} data-pattern={row.episode.type}>
                        {row.episode.type === 'CheyneStokes' ? 'CSR' : 'PB'}
                      </span>
                      {row.episode.belowDeviceThreshold && (
                        <span className={styles.subThresholdTag} title="Sub-threshold candidate">
                          sub-threshold
                        </span>
                      )}
                    </td>
                    <td>
                      <ConfidenceBar value={row.episode.confidence} compact />
                    </td>
                    <td>{row.episode.cycleLengthSec.toFixed(1)} s</td>
                    <td>{row.episode.modulationDepth.toFixed(2)}</td>
                    <td>{(row.episode.durationSec / 60).toFixed(1)} min</td>
                    <td className={styles.catalogActions}>
                      <Link
                        to={`/sessions/${row.sessionId}/signals?t=${row.episode.startMs}&te=${row.episode.endMs}`}
                        className={styles.openLink}
                      >
                        Open ↗
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Catalog status copy + failure disclosure
// ---------------------------------------------------------------------------

interface CatalogStatusCopyProps {
  readonly phase: CatalogPhase;
  readonly filteredCount: number;
  readonly totalEpisodes: number;
  readonly nightsTotal: number;
  readonly nightsCached: number;
  readonly nightsDone: number;
  readonly nightsRemaining: number;
  readonly nightsAnalyzed: number;
}

/**
 * The visible catalog status line — the canonical copy set from UX spec §9,
 * including the dual-count "showing X of Y · analyzing Z of N" phrasing during
 * a run and the four distinct empty states.
 */
function CatalogStatusCopy({
  phase,
  filteredCount,
  totalEpisodes,
  nightsTotal,
  nightsCached,
  nightsDone,
  nightsRemaining,
  nightsAnalyzed,
}: CatalogStatusCopyProps): JSX.Element {
  if (phase === 'idle') {
    return <span className={styles.muted}>Preparing the episode catalog…</span>;
  }

  if (nightsTotal === 0) {
    return (
      <span>
        No sessions in the selected date range. Adjust the date range to analyze your therapy
        nights.
      </span>
    );
  }

  if (phase === 'reading-cache') {
    return (
      <span className={styles.catalogCount}>
        Reading saved analysis… {nightsCached} of {nightsTotal} night{plural(nightsTotal)}.
      </span>
    );
  }

  if (phase === 'computing') {
    if (filteredCount === 0) {
      return (
        <span>
          No matching episodes yet — still analyzing {nightsRemaining} night
          {plural(nightsRemaining)}.
        </span>
      );
    }
    return (
      <span className={styles.catalogCount}>
        Showing {filteredCount} of {totalEpisodes} episode{plural(totalEpisodes)} · analyzing{' '}
        {nightsDone} of {nightsTotal} night{plural(nightsTotal)}.
      </span>
    );
  }

  if (phase === 'cancelled') {
    return (
      <span className={styles.catalogCount}>
        <span className={styles.cancelledTag}>
          <span aria-hidden="true">⏸</span> Analysis cancelled.
        </span>{' '}
        Showing {nightsDone} of {nightsTotal} nights ({totalEpisodes} episode
        {plural(totalEpisodes)}). {nightsRemaining} night{plural(nightsRemaining)} not yet analyzed.
      </span>
    );
  }

  // complete
  if (totalEpisodes === 0) {
    return (
      <span>
        No candidate periodic-breathing or Cheyne-Stokes episodes were detected across{' '}
        {nightsAnalyzed} analyzed night{plural(nightsAnalyzed)}.
      </span>
    );
  }
  if (filteredCount === 0) {
    return (
      <span>
        No episodes match the current filters. {totalEpisodes} episode{plural(totalEpisodes)}{' '}
        detected across the range — lower the minimum confidence or change the pattern filter to see
        them.
      </span>
    );
  }
  return (
    <span className={styles.catalogCount}>
      Showing {filteredCount} of {totalEpisodes} episode{plural(totalEpisodes)} from{' '}
      {nightsAnalyzed} of {nightsTotal} night{plural(nightsTotal)}.
    </span>
  );
}

/**
 * Per-night failure disclosure (UX §8.3): a calm icon+text clause with a
 * "Details" popover listing the failed nights and their short reasons. Icon +
 * text, never colour alone.
 */
function FailureDisclosure({
  failures,
  nightsFailed,
}: {
  readonly failures: readonly CatalogFailure[];
  readonly nightsFailed: number;
}): JSX.Element {
  return (
    <div className={styles.failureNotice}>
      <span className={styles.failureIcon} aria-hidden="true">
        ⚠
      </span>
      <span>
        {nightsFailed} night{plural(nightsFailed)} could not be analyzed.
      </span>
      <Popover
        trigger={
          <button type="button" className={styles.failureDetailsButton}>
            Details
          </button>
        }
        side="bottom"
        align="start"
      >
        <ul className={styles.failureList} aria-label="Nights that could not be analyzed">
          {failures.map((f, i) => (
            <li key={`${f.date}-${i}`} className={styles.failureListItem}>
              <span className={styles.failureListDate}>{f.date}</span>
              <span className={styles.failureListReason}>{f.reason}</span>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selected-episode detail
// ---------------------------------------------------------------------------

function EpisodeDetail({ row }: { row: CatalogEpisode | null }): JSX.Element {
  return (
    <Card className={styles.detailCard} aria-labelledby="detail-heading">
      <header className={styles.sectionHeader}>
        <h2 id="detail-heading" className={styles.sectionTitle}>
          Selected episode
        </h2>
      </header>

      {!row ? (
        <p className={styles.muted}>
          Pick an episode from the catalog to see its full feature breakdown.
        </p>
      ) : (
        <div className={styles.detailBody}>
          <EpisodeDetailBody row={row} />
        </div>
      )}

      <DetectionDisclaimer />
    </Card>
  );
}

function EpisodeDetailBody({ row }: { row: CatalogEpisode }): JSX.Element {
  const { episode } = row;
  const nadirLabel =
    episode.meanNadirType === 'apnea'
      ? 'Central apneas anchor the cycle nadirs'
      : episode.meanNadirType === 'hypopnea'
        ? 'Hypopneas anchor the cycle nadirs'
        : 'Nadir character could not be classified from device flags';
  return (
    <>
      <div className={styles.detailRow}>
        <span className={styles.detailHeadline}>
          {episode.type === 'CheyneStokes'
            ? 'Cheyne-Stokes (candidate)'
            : 'Periodic breathing (candidate)'}
        </span>
        <span className={styles.detailDate}>{row.nightDate}</span>
      </div>
      <dl className={styles.detailMetrics}>
        <div>
          <dt>Confidence</dt>
          <dd>
            <ConfidenceBar value={episode.confidence} />
          </dd>
        </div>
        <div>
          <dt>Cycle length</dt>
          <dd>{episode.cycleLengthSec.toFixed(1)} s</dd>
        </div>
        <div>
          <dt>Modulation depth</dt>
          <dd>{episode.modulationDepth.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Cycles</dt>
          <dd>{episode.cycleCount}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{(episode.durationSec / 60).toFixed(2)} min</dd>
        </div>
        <div>
          <dt>Sub-threshold</dt>
          <dd>{episode.belowDeviceThreshold ? 'Yes' : 'No'}</dd>
        </div>
      </dl>
      <p className={styles.detailNote}>{nadirLabel}.</p>
      <Link
        to={`/sessions/${row.sessionId}/signals?t=${episode.startMs}&te=${episode.endMs}`}
        className={styles.detailOpenLink}
      >
        Open in Signal Viewer ↗
      </Link>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Breathing(): JSX.Element {
  const dateRange = useAppStore((s) => s.dateRange);

  // Longitudinal TECSA via AnalysisEngine (the worker already wires this).
  const {
    data: classification,
    loading: classifLoading,
    error: classifError,
  } = useAnalysis<TecsaClassification>({ type: 'tecsa-classification' });

  // Per-night CAI sparkline data comes from nightly aggregates + an inline
  // candidate calc using the same threshold as the classifier (default = 5/h).
  const { aggregates } = useNightlyAggregates(dateRange);
  const nightFlags = useMemo<TecsaNightFlag[]>(() => {
    const threshold = classification?.caiThreshold ?? 5;
    const obstructiveControlled = 5;
    // Null-handling (skip-night): a night whose central or obstructive index is
    // null was below the rate-validity floor (MIN_INDEX_USAGE_HOURS), so its
    // per-hour rate is undefined — not zero. The TECSA candidate rule and the
    // CAI sparkline both require numeric indices, so such nights cannot be
    // candidates and carry no plottable CAI. We drop them entirely (listwise on
    // the central/obstructive pair) rather than coercing to 0, which would
    // fabricate a benign-looking night. These nights are already excluded by the
    // leak/usage gates in spirit; this makes the rate-validity exclusion explicit.
    return aggregates
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter(
        (a): a is typeof a & { ahiCentral: number; ahiObstructive: number } =>
          a.ahiCentral !== null && a.ahiObstructive !== null,
      )
      .map((a) => {
        const highLeak = a.leakMedian > LEAK_NOTICE_LPM || a.usageHours < 2;
        const candidate =
          !highLeak && a.ahiCentral >= threshold && a.ahiObstructive < obstructiveControlled;
        return {
          date: a.date,
          candidate,
          cai: a.ahiCentral,
          obstructiveIndex: a.ahiObstructive,
          highLeak,
        };
      });
  }, [aggregates, classification?.caiThreshold]);

  const catalog = useBreathingEpisodeCatalog({ dateRange });

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedRow = useMemo(
    () =>
      selectedKey === null
        ? null
        : (catalog.episodes.find((r) => `${r.sessionId}-${r.episode.id}` === selectedKey) ?? null),
    [selectedKey, catalog.episodes],
  );

  return (
    <div className={styles.page} role="main" aria-labelledby="breathing-heading">
      <header className={styles.pageHeader}>
        <div>
          <h1 id="breathing-heading" className={styles.pageTitle}>
            Breathing patterns
          </h1>
          <p className={styles.pageSubtitle}>
            App-computed candidate detections of periodic breathing, Cheyne-Stokes respiration, and
            the treatment-emergent (TECSA) trajectory across your therapy history.
          </p>
        </div>
        <DateRangeSelector />
      </header>

      <DetectionDisclaimer />

      <TecsaSection
        classification={classification}
        loading={classifLoading}
        error={classifError}
        nightFlags={nightFlags}
      />

      <EpisodeCatalog
        rows={catalog.episodes}
        phase={catalog.phase}
        nightsTotal={catalog.nightsTotal}
        nightsCached={catalog.nightsCached}
        nightsComputed={catalog.nightsComputed}
        nightsFailed={catalog.nightsFailed}
        failures={catalog.failures}
        error={catalog.error}
        onCancel={catalog.cancel}
        onResume={catalog.resume}
        onSelect={(row) => setSelectedKey(`${row.sessionId}-${row.episode.id}`)}
        selectedKey={selectedKey}
      />

      <EpisodeDetail row={selectedRow} />

      <Card className={styles.legendCard}>
        <h3 className={styles.legendTitle}>About these patterns</h3>
        <ul className={styles.legendList}>
          {TECSA_PRESENTATION_ORDER.map((cls) => {
            const p = tecsaPresentation(cls);
            return (
              <li key={cls} className={styles.legendItem}>
                <TecsaClassBadge tecsaClass={cls} />
                <span className={styles.legendCopy}>{p.explainer}</span>
              </li>
            );
          })}
        </ul>
        <p className={styles.legendFootnote}>
          Periodic-breathing and Cheyne-Stokes candidate episodes are detected directly from your
          airflow envelope using AASM morphology and a continuous modulation/periodicity score, then
          surfaced even when they fall below the device's own reporting gate (marked
          &quot;sub-threshold&quot;). They are <em>not</em> a diagnosis. See{' '}
          <Link to="/help/breathing-patterns" className={styles.helpLink}>
            the breathing-patterns help article
          </Link>{' '}
          for the algorithm details and clinical context.
        </p>
      </Card>
    </div>
  );
}

export default Breathing;
