/**
 * `SourcePanel` — the "Based on these numbers" show-your-work block (UX §4.4;
 * visual spec §3.6), rendered under every output and during streaming.
 *
 * This is the authoritative ACCESSIBLE representation of the data the narrative
 * was built from (UX §8.3) — plain semantic markup (a definition-list grid), so
 * a screen-reader user can navigate the exact source numbers regardless of the
 * streamed prose. The narrative must never assert a number not present here; if
 * it does, that is a correctness bug the validator catches upstream.
 *
 * Values are the app's already-computed display strings from the grounded
 * {@link GroundedContext} — the panel never formats or derives a value itself.
 * Severity/qualifier text is shown beside any color (1.4.1) via the snapshot's
 * own labels (e.g. a trend's `qualifier`).
 *
 * @module components/insights/SourcePanel
 */

import { Fragment } from 'react';

import type { GroundedContext } from '@/services/llm/context/types';

import styles from './InsightDrawer.module.css';

export interface SourcePanelProps {
  /** The grounded snapshot to render, or `null` before/without one. */
  readonly context: GroundedContext | null;
  /**
   * Whether to render expanded. Default-expanded on first view (UX §4.4); the
   * `<details>` element itself remains user-collapsible thereafter (HAX G10).
   */
  readonly defaultOpen?: boolean;
  /** The empty-state reason, when the panel should explain there is no data. */
  readonly emptyReason?: 'no-data' | 'too-few-for-trend' | 'metric-unavailable' | null;
}

/** A single value row's qualifier text (caveat / availability), or null. */
function metricQualifier(availability: string, caveat: string | null): string | null {
  if (availability === 'undefined-rate') return 'rate undefined (recording too short)';
  if (availability === 'unavailable') return 'not available';
  return caveat;
}

/**
 * The "Based on these numbers" collapsible source panel. Always rendered when a
 * context exists (or an empty reason needs explaining), so the accurate numbers
 * are present even while prose streams or after an error.
 */
export function SourcePanel({ context, defaultOpen = true, emptyReason = null }: SourcePanelProps) {
  const hasMetrics = context !== null && context.metrics.length > 0;
  const hasTrends = context !== null && context.trends.length > 0;
  const hasSeries = context?.series !== undefined && context.series.points.length > 0;
  const hasAnything = hasMetrics || hasTrends || hasSeries;

  return (
    <details className={styles.sourcePanel} open={defaultOpen}>
      <summary className={styles.sourceSummary}>Based on these numbers</summary>

      {!hasAnything && (
        <p className={styles.sourceEmpty}>
          {emptyReason === 'no-data'
            ? 'No nights in this range.'
            : 'No source metrics are available for this view.'}
        </p>
      )}

      {hasAnything && (
        <dl className={styles.sourceList}>
          {context?.metrics.map((m) => {
            const qualifier = metricQualifier(m.availability, m.caveat);
            return (
              <Fragment key={m.id}>
                <dt className={styles.sourceTerm}>{m.label}</dt>
                <dd className={styles.sourceValue}>
                  {m.availability === 'present' && m.displayValue !== null
                    ? `${m.displayValue}${m.unit ? ` ${m.unit}` : ''}`
                    : '—'}
                  {qualifier !== null && (
                    <span className={styles.sourceQualifier}> ({qualifier})</span>
                  )}
                </dd>
              </Fragment>
            );
          })}

          {context?.trends.map((t) => (
            <Fragment key={t.metricId}>
              <dt className={styles.sourceTerm}>{t.label} trend</dt>
              <dd className={styles.sourceValue}>
                {t.slopeDisplay !== null ? `${t.slopeDisplay} ${t.slopeUnit}` : '—'}
                <span className={styles.sourceQualifier}> ({t.qualifier})</span>
              </dd>
            </Fragment>
          ))}

          {hasSeries &&
            context?.series?.points.map((p) => (
              <Fragment key={p.date}>
                <dt className={styles.sourceTerm}>{p.date}</dt>
                <dd className={styles.sourceValue}>
                  {p.availability === 'present' && p.displayValue !== null ? p.displayValue : '—'}
                </dd>
              </Fragment>
            ))}
        </dl>
      )}
    </details>
  );
}
