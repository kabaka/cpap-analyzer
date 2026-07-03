/**
 * Terminal import summary in three variants — success, partial-success, error —
 * derived from a job's {@link ImportJobProgress} plus optional headline stats.
 *
 * Status is conveyed by a distinct icon SHAPE + heading TEXT (never colour
 * alone). Partial success surfaces the warning/error count and an expandable,
 * per-file error list sourced from `recentErrors`. The numeric stat grid and the
 * action buttons are supplied by the caller as children so the wizard and the
 * dock can reuse this body with their own CTAs.
 *
 * @module components/import/ImportSummary
 */

import { useState, type ReactNode } from 'react';

import { Badge, Icon } from '@/components/ui';
import type { ImportJobProgress } from '@/services/import/types';

import { formatElapsed } from './importFormat';
import styles from './ImportSummary.module.css';

/** A single labelled headline statistic. */
export interface SummaryStat {
  readonly label: string;
  readonly value: string;
}

/** Props for {@link ImportSummary}. */
export interface ImportSummaryProps {
  /** The terminal job snapshot (status `complete` / `error` / `cancelled`). */
  readonly progress: ImportJobProgress;
  /** Headline statistics rendered in the grid. */
  readonly stats?: readonly SummaryStat[];
  /**
   * A fatal error message, when the whole job failed (no partial result). When
   * present the error variant is rendered.
   */
  readonly fatalError?: string | null;
  /** Epoch-ms the job finished, for the elapsed-time line. Defaults to now. */
  readonly finishedAtMs?: number;
  /** Action buttons (caller-supplied CTAs). */
  readonly children?: ReactNode;
}

/** The resolved presentation of a terminal job. */
type Variant = 'success' | 'partial' | 'error';

function resolveVariant(progress: ImportJobProgress, fatalError: string | null): Variant {
  if (fatalError !== null || progress.status === 'error') return 'error';
  if (progress.status === 'cancelled' || progress.errorCount > 0 || progress.warningCount > 0) {
    return 'partial';
  }
  return 'success';
}

const VARIANT_META: Record<
  Variant,
  { icon: 'check-circle' | 'alert-triangle' | 'x-circle'; colorVar: string; title: string }
> = {
  success: {
    icon: 'check-circle',
    colorVar: 'var(--color-stage-done)',
    title: 'Import complete',
  },
  partial: {
    icon: 'alert-triangle',
    colorVar: 'var(--color-stage-warning)',
    title: 'Import finished with issues',
  },
  error: {
    icon: 'x-circle',
    colorVar: 'var(--color-stage-error)',
    title: 'Import failed',
  },
};

/** A terminal summary card body (success / partial / error). */
export function ImportSummary({
  progress,
  stats = [],
  fatalError = null,
  finishedAtMs,
  children,
}: ImportSummaryProps): JSX.Element {
  const variant = resolveVariant(progress, fatalError);
  const meta = VARIANT_META[variant];
  const [errorsExpanded, setErrorsExpanded] = useState(false);

  const issueCount = progress.warningCount + progress.errorCount;
  const elapsed =
    progress.startedAtMs > 0
      ? formatElapsed(progress.startedAtMs, finishedAtMs ?? Date.now())
      : null;

  const cancelled = progress.status === 'cancelled';

  return (
    <div className={styles.summary}>
      <span className={styles.statusIcon} style={{ color: meta.colorVar }}>
        <Icon name={meta.icon} size="lg" title={meta.title} />
      </span>
      <h2 className={styles.title}>{cancelled ? 'Import cancelled' : meta.title}</h2>

      {variant === 'error' && fatalError && <p className={styles.errorMessage}>{fatalError}</p>}

      {variant === 'partial' && issueCount > 0 && (
        <p className={styles.subtitle}>
          {issueCount.toLocaleString()} {issueCount === 1 ? 'issue' : 'issues'} during import
          {elapsed ? ` · Completed in ${elapsed}` : ''}
        </p>
      )}

      {variant === 'success' && elapsed && (
        <p className={styles.subtitle}>Completed in {elapsed}</p>
      )}

      {stats.length > 0 && (
        <div className={styles.grid}>
          {stats.map((stat) => (
            <div key={stat.label} className={styles.item}>
              <span className={styles.value}>{stat.value}</span>
              <span className={styles.label}>{stat.label}</span>
            </div>
          ))}
        </div>
      )}

      {progress.recentErrors.length > 0 && (
        <div className={styles.errorsSection}>
          <button
            type="button"
            className={styles.errorsToggle}
            aria-expanded={errorsExpanded}
            aria-controls="import-summary-errors"
            onClick={() => setErrorsExpanded((v) => !v)}
          >
            <Icon name={errorsExpanded ? 'chevron-up' : 'chevron-down'} size="sm" />
            <span>
              {progress.recentErrors.length.toLocaleString()} file{' '}
              {progress.recentErrors.length === 1 ? 'error' : 'errors'}
            </span>
          </button>
          {errorsExpanded && (
            <ul id="import-summary-errors" className={styles.errorsList}>
              {progress.recentErrors.map((err, i) => (
                <li key={`${err.fileName}-${String(i)}`} className={styles.errorItem}>
                  <code className={styles.errorFileName}>{err.fileName}</code>
                  <span className={styles.errorText}>{err.error}</span>
                </li>
              ))}
            </ul>
          )}
          {progress.errorCount > progress.recentErrors.length && (
            <Badge variant="warning" size="sm">
              + {(progress.errorCount - progress.recentErrors.length).toLocaleString()} more
            </Badge>
          )}
        </div>
      )}

      {children}
    </div>
  );
}

export default ImportSummary;
