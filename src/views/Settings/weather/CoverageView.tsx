/**
 * Post-sync coverage view (visual spec §5).
 *
 * Distinguishes four states per night with a DISTINCT ICON SHAPE + WORD +
 * colour (colour reinforces, never the sole signal):
 *
 * | Status   | Shape            | Word              | Actionable |
 * | -------- | ---------------- | ----------------- | ---------- |
 * | synced   | ✓ filled circle  | Synced            | —          |
 * | missing  | ◷ dotted circle  | Not synced        | Sync       |
 * | no-data  | ⊘ circle-slash   | No data available | terminal   |
 * | failed   | ⚠ triangle       | Sync failed       | Retry      |
 *
 * The "no data available" (queried-but-empty) state is correctness-critical: it
 * shows "—", never a fabricated zero, and is distinct from "not fetched". A
 * summary header carries per-status count chips; actionable rows get a trailing
 * Sync/Retry ghost button; failed rows show an inline reason.
 *
 * @module views/Settings/weather/CoverageView
 */

import { Button } from '@/components/ui';
import styles from './WeatherIntegrationPanel.module.css';

export type CoverageStatus = 'synced' | 'missing' | 'no-data' | 'failed';

export interface CoverageRow {
  /** Night local date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly status: CoverageStatus;
  /** Inline reason for a failed row (offline / 429 / HTTP …). */
  readonly reason?: string;
}

interface StatusMeta {
  readonly glyph: string;
  readonly label: string;
  readonly className: string;
  readonly action: 'sync' | 'retry' | null;
}

const STATUS_META: Record<CoverageStatus, StatusMeta> = {
  synced: { glyph: '✓', label: 'Synced', className: 'badgeSynced', action: null },
  missing: { glyph: '◷', label: 'Not synced', className: 'badgeMissing', action: 'sync' },
  'no-data': { glyph: '⊘', label: 'No data available', className: 'badgeNoData', action: null },
  failed: { glyph: '⚠', label: 'Sync failed', className: 'badgeFailed', action: 'retry' },
};

const STATUS_ORDER: readonly CoverageStatus[] = ['synced', 'missing', 'no-data', 'failed'];

export interface CoverageViewProps {
  readonly rows: readonly CoverageRow[];
  /** Re-run the sync for a single night (Sync / Retry on actionable rows). */
  readonly onRetryNight?: (date: string) => void;
}

export function CoverageView({ rows, onRetryNight }: CoverageViewProps): JSX.Element {
  const counts = STATUS_ORDER.map((status) => ({
    status,
    count: rows.filter((r) => r.status === status).length,
  })).filter((c) => c.count > 0);

  return (
    <div className={styles.coverage}>
      <div className={styles.coverageSummary} aria-label="Coverage summary">
        {counts.map(({ status, count }) => {
          const meta = STATUS_META[status];
          return (
            <span key={status} className={`${styles.countChip} ${styles[meta.className] ?? ''}`}>
              <span aria-hidden="true">{meta.glyph}</span>
              <span>
                {count} {meta.label}
              </span>
            </span>
          );
        })}
      </div>

      <ul className={styles.coverageList}>
        {rows.map((row) => {
          const meta = STATUS_META[row.status];
          const actionable = meta.action !== null;
          return (
            <li key={row.date} className={styles.coverageRow}>
              <span className={styles.coverageDate}>{row.date}</span>
              <span
                className={`${styles.statusBadge} ${styles[meta.className] ?? ''}`}
                role="img"
                aria-label={meta.label}
              >
                <span aria-hidden="true">{meta.glyph}</span>
                <span>{meta.label}</span>
              </span>
              {row.status === 'failed' && row.reason && (
                <span className={styles.coverageReason}>{row.reason}</span>
              )}
              {row.status === 'no-data' && (
                <span className={styles.coverageDash} aria-hidden="true">
                  &mdash;
                </span>
              )}
              {actionable && onRetryNight && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRetryNight(row.date)}
                  aria-label={`${meta.action === 'retry' ? 'Retry' : 'Sync'} ${row.date}`}
                >
                  {meta.action === 'retry' ? 'Retry' : 'Sync'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
