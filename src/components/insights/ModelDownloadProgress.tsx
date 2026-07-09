/**
 * `ModelDownloadProgress` — the single presentational block for an on-device
 * (WebLLM) model download / warm-up, used by BOTH the Settings `WebLLMConfig`
 * download affordance and the in-drawer first-use state.
 *
 * Built against `docs/design/ai-insights-model-download-ux.md` (the authoritative
 * spec for states, microcopy, and accessibility). Centralising it guarantees the
 * two surfaces stay consistent and keeps the milestone-announcement logic in one
 * place (spec §2, §5).
 *
 * It owns *presentation only*; the callers (`WebLLMConfig`, `InsightDrawer`) own
 * the trigger and the download lifecycle state. It composes the shared
 * {@link ProgressBar} primitive (never a hand-rolled bar — spec §2/§6) plus the
 * exact phase/context copy and a throttled `aria-live` region.
 *
 * Accessibility (WCAG AA — spec §6):
 *  - `ProgressBar` carries `role="progressbar"` + `aria-valuemin/max/now` and an
 *    `aria-valuetext` human sentence; when `fraction === null` it is
 *    `indeterminate` (ARIA omits `aria-valuenow`).
 *  - A single `role="status"`/`aria-live="polite"` region announces MILESTONES
 *    only — on phase change and at ~10% buckets — never every percent (the
 *    `Math.floor(fraction * 10)` bucketing pattern shared with `SyncSheet`).
 *  - Colour is never the sole signal: the phase line carries meaning as text; the
 *    ⏳ glyph is `aria-hidden`.
 *  - The model's own `progress.text` is rendered as PLAIN TEXT (no HTML) in a
 *    muted line — it is model-authored, so it must never be interpreted as markup.
 *
 * @module components/insights/ModelDownloadProgress
 */

import { useEffect, useRef, useState } from 'react';

import { Button, ProgressBar } from '@/components/ui';

import styles from './ModelDownloadProgress.module.css';

/** Which phase of the one-time provision this block is presenting. */
export type ModelDownloadPhase = 'downloading' | 'loading';

/** Which surface is hosting the block (drives surface/heading treatment). */
export type ModelDownloadVariant = 'settings' | 'drawer';

/** Props for {@link ModelDownloadProgress}. */
export interface ModelDownloadProgressProps {
  /** Download vs warm-up phase (spec §5.2). */
  readonly phase: ModelDownloadPhase;
  /** Fractional completion in `[0, 1]`, or `null` for the indeterminate window. */
  readonly fraction: number | null;
  /** The model's own status text (`progress.text`), rendered muted as plain text. */
  readonly statusText: string;
  /** Disclosed download size, e.g. `~1.9 GB` (spec §5.3). */
  readonly sizeLabel: string;
  /** Optional model display name (provenance; not required by the copy). */
  readonly modelLabel?: string;
  /** Cancel handler. When omitted, no Cancel button renders. */
  readonly onCancel?: () => void;
  /** Hosting surface (spec §3 vs §4). */
  readonly variant: ModelDownloadVariant;
}

/** Round a `[0,1]` fraction to a whole percent. */
function toPercent(fraction: number): number {
  return Math.round(fraction * 100);
}

/**
 * The phase line (spec §5.2). Determinate downloading shows the percent; the
 * null-fraction window and warm-up use their own fixed copy.
 */
function phaseLine(phase: ModelDownloadPhase, fraction: number | null): string {
  if (phase === 'loading') return 'Preparing the model on your device…';
  if (fraction === null) return 'Starting download…';
  return `Downloading model — ${toPercent(fraction)}%`;
}

/**
 * The context line (spec §5.3). The drawer gets the fuller first-use copy since
 * it is the surprise surface; Settings gets the compact lines.
 */
function contextLine(
  phase: ModelDownloadPhase,
  fraction: number | null,
  sizeLabel: string,
  variant: ModelDownloadVariant,
): string {
  if (phase === 'loading') {
    return 'Almost ready — warming up the model. No more downloading.';
  }
  if (fraction === null) {
    return 'Setting up — this can take a few minutes the first time.';
  }
  if (variant === 'drawer') {
    return `First-time, one-time download (${sizeLabel}). It runs on your device — nothing is uploaded — and can take a few minutes. The model stays cached for next time.`;
  }
  return `One-time download, ${sizeLabel}. Runs on your device — nothing is uploaded.`;
}

/** The `aria-valuetext` human sentence (spec §6) — read instead of "42 / 100". */
function valueText(phase: ModelDownloadPhase, fraction: number | null): string {
  if (phase === 'loading') return 'Warming up the on-device model.';
  if (fraction === null) return 'Starting the on-device model download.';
  return `Downloading the on-device model, ${toPercent(fraction)} percent.`;
}

/**
 * Compute the milestone string to announce (spec §6): on phase change, at ~10%
 * buckets, and for the start/warm-up. Returns `null` when nothing new should be
 * announced for this update.
 */
function milestoneAnnouncement(
  phase: ModelDownloadPhase,
  fraction: number | null,
  lastPhase: ModelDownloadPhase | null,
  lastBucket: number,
): { text: string; bucket: number } | null {
  if (phase === 'loading') {
    if (lastPhase !== 'loading') {
      return { text: 'Warming up the on-device model. No more downloading.', bucket: lastBucket };
    }
    return null;
  }
  if (fraction === null) {
    if (lastPhase === null) {
      return { text: 'Starting the on-device model download.', bucket: -1 };
    }
    return null;
  }
  const bucket = Math.floor(fraction * 10);
  if (phase !== lastPhase || bucket > lastBucket) {
    return { text: `Downloading the on-device model, ${bucket * 10} percent.`, bucket };
  }
  return null;
}

/**
 * The throttled milestone live region (spec §6). Announces only on phase change
 * and ~10% buckets — never every percent.
 */
function MilestoneAnnouncer({
  phase,
  fraction,
}: {
  readonly phase: ModelDownloadPhase;
  readonly fraction: number | null;
}): JSX.Element {
  const [message, setMessage] = useState('');
  const lastPhase = useRef<ModelDownloadPhase | null>(null);
  const lastBucket = useRef(-1);

  useEffect(() => {
    const next = milestoneAnnouncement(phase, fraction, lastPhase.current, lastBucket.current);
    lastPhase.current = phase;
    if (next !== null) {
      lastBucket.current = next.bucket;
      setMessage(next.text);
    }
  }, [phase, fraction]);

  return (
    <div className={styles.visuallyHidden} role="status" aria-live="polite">
      {message}
    </div>
  );
}

/**
 * The shared model-download / warm-up block. See the module docblock for the
 * accessibility contract and the spec for the verbatim copy.
 */
export function ModelDownloadProgress({
  phase,
  fraction,
  statusText,
  sizeLabel,
  modelLabel,
  onCancel,
  variant,
}: ModelDownloadProgressProps): JSX.Element {
  const isDrawer = variant === 'drawer';
  const indeterminate = fraction === null;
  // The model's own status text is shown muted only when it adds something
  // beyond the phase line (spec §5.3). Rendered as plain text (React-escaped).
  const showStatusText = statusText.trim().length > 0;

  const containerClassName = [styles.container, isDrawer ? styles.drawer : styles.settings]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClassName} aria-busy={true}>
      {isDrawer && (
        <p className={styles.heading}>
          <span className={styles.glyph} aria-hidden="true">
            ⏳
          </span>
          Preparing the on-device model
        </p>
      )}

      <div className={styles.row}>
        <span className={styles.phaseLine}>{phaseLine(phase, fraction)}</span>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      <ProgressBar
        value={indeterminate ? 0 : toPercent(fraction)}
        max={100}
        indeterminate={indeterminate}
        valueText={valueText(phase, fraction)}
        label={modelLabel ? `${modelLabel} download progress` : 'On-device model download progress'}
        // In the AI drawer the bar wears the fuchsia AI accent (spec B8); the
        // Settings surface keeps the neutral primary fill.
        tone={isDrawer ? 'ai' : 'primary'}
        className={styles.bar}
      />

      <p className={styles.context}>{contextLine(phase, fraction, sizeLabel, variant)}</p>

      {showStatusText && (
        <p className={styles.statusText}>
          <span aria-hidden="true">· </span>
          {statusText}
        </p>
      )}

      <MilestoneAnnouncer phase={phase} fraction={fraction} />
    </div>
  );
}

export default ModelDownloadProgress;
