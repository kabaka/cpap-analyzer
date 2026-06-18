import { useEffect, useState } from 'react';
import { useDataStore } from '@/stores/useDataStore';
import { OPFSService } from '@/services/storage/OPFSService';
import { Icon } from '@/components/ui';
import { formatBytes } from '@/utils/formatBytes';
import styles from './StatusBar.module.css';

/** Month-year range formatting for the corpus coverage label. */
function formatMonthYear(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** Relative "x ago" phrasing for the last-import timestamp. */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(days / 365);
  return `${years}y ago`;
}

interface StorageInfo {
  usage: number;
  quota: number;
  percentUsed: number;
}

export function StatusBar() {
  const sessionCount = useDataStore((s) => s.sessions.size);
  const sessionsRange = useDataStore((s) => s.sessionsRange);
  const lastImportAt = useDataStore((s) => s.lastImportAt);

  // Storage estimate is async and unsupported in some environments. `undefined`
  // means "not yet loaded"; `null` means "unsupported — omit the item entirely".
  const [storage, setStorage] = useState<StorageInfo | null | undefined>(undefined);

  // Re-fetch the quota estimate on mount and whenever the corpus changes
  // (import completion mutates `sessions` / `lastImportAt`). No polling.
  useEffect(() => {
    if (!OPFSService.isSupported()) {
      setStorage(null);
      return;
    }
    let cancelled = false;
    const opfs = new OPFSService();
    opfs
      .getQuotaEstimate()
      .then((estimate) => {
        if (cancelled) return;
        if (estimate.quota <= 0) {
          setStorage(null);
          return;
        }
        setStorage({
          usage: estimate.usage,
          quota: estimate.quota,
          percentUsed: estimate.percentUsed,
        });
      })
      .catch(() => {
        if (!cancelled) setStorage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionCount, lastImportAt]);

  // ── Corpus label ──
  const sessionLabel =
    sessionCount === 0
      ? 'No sessions imported'
      : `${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}`;

  const coverageLabel = sessionsRange
    ? `${formatMonthYear(sessionsRange.start)} – ${formatMonthYear(sessionsRange.end)}`
    : null;

  const importRelative = lastImportAt ? formatRelativeTime(lastImportAt) : null;
  const importAbsolute = lastImportAt ? new Date(lastImportAt).toLocaleString() : undefined;

  // ── Storage meter ──
  const percent = storage ? Math.round(storage.percentUsed) : 0;
  const meterTone =
    percent >= 95 ? styles.meterError : percent >= 80 ? styles.meterWarning : styles.meterNormal;

  return (
    <footer className={styles.statusBar} aria-label="Application status">
      <div className={styles.cluster} aria-live="polite">
        <span className={styles.item}>
          <Icon name="sessions" size="sm" className={styles.icon} />
          <span className={styles.text}>{sessionLabel}</span>
        </span>
        {coverageLabel && (
          <span className={styles.item}>
            <Icon name="calendar" size="sm" className={styles.icon} />
            <span className={`${styles.text} ${styles.mono}`}>{coverageLabel}</span>
          </span>
        )}
        {importRelative && (
          <span className={styles.item} title={importAbsolute}>
            <Icon name="clock" size="sm" className={styles.icon} />
            <span className={styles.text}>Imported {importRelative}</span>
          </span>
        )}
      </div>

      <div className={styles.cluster} aria-live="polite">
        {storage === undefined && (
          <span className={styles.item}>
            <Icon name="storage" size="sm" className={styles.icon} />
            <span className={styles.text}>Loading…</span>
          </span>
        )}
        {storage && (
          <span className={styles.item}>
            <Icon name="storage" size="sm" className={styles.icon} />
            <span className={styles.meter} aria-hidden="true">
              <span
                className={`${styles.meterFill} ${meterTone}`}
                style={{ width: `${Math.min(100, percent)}%` }}
              />
            </span>
            <span className={`${styles.text} ${styles.mono}`}>
              {formatBytes(storage.usage)} of {formatBytes(storage.quota)} used ({percent}%)
            </span>
          </span>
        )}
      </div>
    </footer>
  );
}
