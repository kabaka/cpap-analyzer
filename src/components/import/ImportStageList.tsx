/**
 * Vertical multi-stage progress list for an import job.
 *
 * Renders ALL stages of a job from t=0, each in one of five states
 * (pending / active / done / warning / error) — every state reinforced by a
 * distinct icon SHAPE + a status WORD + a colour token, so meaning is never
 * carried by colour alone (WCAG 1.4.1).
 *
 * - Active stages show a {@link ProgressBar}; determinate when a total is known
 *   ("{done} of {total}" + percent), indeterminate otherwise ("{n} found", no
 *   fake 0%/denominator).
 * - A stage with nested {@link SubItemProgress} (the Fitbit `import` stage)
 *   renders an expandable list of {@link SubstageRow}s; it auto-expands on error.
 * - Throughput / ETA are shown when present.
 *
 * The component is presentational: it takes an {@link ImportJobProgress} and
 * renders. Lifecycle (start/cancel/dismiss) is the caller's concern.
 *
 * @module components/import/ImportStageList
 */

import { useEffect, useState } from 'react';

import { Icon, ProgressBar } from '@/components/ui';
import type { ImportJobProgress, StageProgress, SubItemProgress } from '@/services/import/types';

import { formatCount, formatThroughput, formatEta } from './importFormat';
import { stageVisual } from './stageVisuals';
import { useReducedMotion } from './useReducedMotion';
import styles from './ImportStageList.module.css';

/** Props for {@link ImportStageList}. */
export interface ImportStageListProps {
  /** The job whose stages to render. */
  readonly progress: ImportJobProgress;
  /** Denser spacing for the dock popover. */
  readonly compact?: boolean;
}

/** A vertical list of every stage in an import job. */
export function ImportStageList({ progress, compact = false }: ImportStageListProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const listClass = [styles.list, compact ? styles.compact : null].filter(Boolean).join(' ');

  return (
    <ul className={listClass}>
      {progress.stages.map((stage) => (
        <li key={stage.id}>
          <StageRow
            stage={stage}
            kind={progress.kind}
            throughputPerSec={
              progress.activeStageId === stage.id ? progress.throughputPerSec : null
            }
            etaMs={progress.activeStageId === stage.id ? progress.etaMs : null}
            reducedMotion={reducedMotion}
          />
        </li>
      ))}
    </ul>
  );
}

/** Props for a single stage row. */
interface StageRowProps {
  readonly stage: StageProgress;
  readonly kind: ImportJobProgress['kind'];
  readonly throughputPerSec: number | null;
  readonly etaMs: number | null;
  readonly reducedMotion: boolean;
}

/** One top-level stage row: icon + word + label + counts + (active) progress bar. */
function StageRow({ stage, kind, throughputPerSec, etaMs, reducedMotion }: StageRowProps) {
  const visual = stageVisual(stage.state);
  const isActive = stage.state === 'active';
  const iconName = reducedMotion ? visual.reducedMotionIcon : visual.icon;
  const animate = visual.animated && !reducedMotion;

  const hasSubItems = (stage.subItems?.length ?? 0) > 0;
  const subHasError = stage.subItems?.some((s) => s.state === 'error') ?? false;

  // Sub-items auto-expand on error; otherwise default to expanded for the active
  // stage so progress is visible, collapsed once done to reduce clutter.
  const [expanded, setExpanded] = useState<boolean>(isActive);
  useEffect(() => {
    if (subHasError) setExpanded(true);
  }, [subHasError]);

  const counts = stageCounts(stage);

  const rowClass = [styles.row, isActive ? styles.rowActive : null].filter(Boolean).join(' ');
  const iconClass = [styles.statusIcon, animate ? styles.spin : null].filter(Boolean).join(' ');

  const subListId = `stage-subitems-${kind}-${stage.id}`;

  return (
    <div className={rowClass}>
      <span className={iconClass} style={{ color: visual.colorVar }}>
        <Icon name={iconName} size="sm" />
      </span>
      <div className={styles.body}>
        <div className={styles.labelRow}>
          <span className={styles.label}>{stage.label}</span>
          <span className={styles.statusWord}>{visual.word}</span>
        </div>

        {counts && (
          <div className={styles.counts}>
            <span>{counts.text}</span>
            {counts.percent !== null && <span className={styles.percent}>{counts.percent}%</span>}
            {throughputPerSec !== null && (
              <span className={styles.rate}>{formatThroughput(throughputPerSec, stage.unit)}</span>
            )}
            {etaMs !== null && <span className={styles.rate}>{formatEta(etaMs)}</span>}
          </div>
        )}

        {isActive && (
          <div className={styles.barWrap}>
            {stage.determinate && stage.total !== null && stage.total > 0 ? (
              <ProgressBar
                size="sm"
                value={stage.completed}
                max={stage.total}
                label={stage.label}
                valueText={`${stage.label}: ${formatCount(stage.completed)} of ${formatCount(
                  stage.total,
                )} ${stage.unit}`}
              />
            ) : (
              <ProgressBar
                size="sm"
                indeterminate
                label={stage.label}
                valueText={`${stage.label}: ${formatCount(stage.completed)} ${stage.unit} found`}
              />
            )}
          </div>
        )}

        {hasSubItems && (
          <>
            <button
              type="button"
              className={styles.disclosure}
              aria-expanded={expanded}
              aria-controls={subListId}
              onClick={() => setExpanded((v) => !v)}
            >
              <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size="sm" />
              <span>
                {expanded ? 'Hide' : 'Show'} {stage.subItems?.length} data{' '}
                {stage.subItems?.length === 1 ? 'type' : 'types'}
              </span>
            </button>
            {expanded && (
              <ul id={subListId} className={styles.subList}>
                {stage.subItems?.map((sub) => (
                  <li key={sub.id}>
                    <SubstageRow sub={sub} reducedMotion={reducedMotion} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Props for a nested sub-item row. */
interface SubstageRowProps {
  readonly sub: SubItemProgress;
  readonly reducedMotion: boolean;
}

/** One nested data-type row within a stage. */
function SubstageRow({ sub, reducedMotion }: SubstageRowProps) {
  const visual = stageVisual(sub.state);
  const iconName = reducedMotion ? visual.reducedMotionIcon : visual.icon;
  const animate = visual.animated && !reducedMotion;
  const iconClass = [styles.statusIcon, animate ? styles.spin : null].filter(Boolean).join(' ');

  const countText =
    sub.total !== null && sub.total > 0
      ? `${formatCount(sub.completed)} / ${formatCount(sub.total)}`
      : sub.completed > 0
        ? formatCount(sub.completed)
        : null;

  return (
    <div className={styles.subRow}>
      <span className={iconClass} style={{ color: visual.colorVar }}>
        <Icon name={iconName} size="sm" />
        <span className={styles.srOnly}>{visual.word}</span>
      </span>
      <div className={styles.subLabelRow}>
        <span className={styles.subLabel}>{sub.label}</span>
        {countText && <span className={styles.subCount}>{countText}</span>}
      </div>
    </div>
  );
}

/** Derive the count line + percent for a stage, or null when there's nothing useful. */
function stageCounts(stage: StageProgress): { text: string; percent: number | null } | null {
  // Pending stages with no progress show no counts.
  if (stage.state === 'pending') return null;

  if (stage.determinate && stage.total !== null && stage.total > 0) {
    const percent = Math.round((Math.min(stage.completed, stage.total) / stage.total) * 100);
    return {
      text: `${formatCount(stage.completed)} of ${formatCount(stage.total)} ${stage.unit}`,
      percent,
    };
  }

  // Indeterminate: show a bare count "N found" without a denominator/percent.
  if (stage.completed > 0) {
    return { text: `${formatCount(stage.completed)} ${stage.unit} found`, percent: null };
  }
  return null;
}

export default ImportStageList;
