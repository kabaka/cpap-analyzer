/**
 * Data Management view.
 *
 * Provides storage overview, import history, data cleanup, session export,
 * and full backup/restore functionality. All operations are client-side.
 *
 * @module views/DataManagement/DataManagement
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Badge,
  Tabs,
  Dialog,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';
import { getDB } from '@/services/storage/getDB';
import { resetDB } from '@/services/storage/getDB';
import { OPFSService } from '@/services/storage/OPFSService';
import { downloadBlob, encryptBuffer } from '@/services/reports';
import { useDataStore } from '@/stores/useDataStore';
import type { ImportRecord, Session } from '@/types';
import { formatBytes } from '@/utils/formatBytes';
import styles from './DataManagement.module.css';

// ── Helpers ──────────────────────────────────────────────────────

/** Format an ISO timestamp to a locale date string. */
function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Format a YYYY-MM-DD date string for display. */
function formatDate(date: string): string {
  if (!date) return '';
  try {
    return new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return date;
  }
}

/** Get today's date as YYYY-MM-DD. */
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Derive an AES-256-GCM key for decryption. */
async function deriveDecryptKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

// ── Storage Info ─────────────────────────────────────────────────

interface StorageInfo {
  usage: number;
  quota: number;
  sessionCount: number;
  importCount: number;
}

async function fetchStorageInfo(): Promise<StorageInfo> {
  let usage = 0;
  let quota = 0;
  try {
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      const estimate = await navigator.storage.estimate();
      usage = estimate.usage ?? 0;
      quota = estimate.quota ?? 0;
    }
  } catch {
    // Storage API not available (e.g. WebKit in some environments)
  }
  const db = await getDB();
  const sessions = await db.getAllSessions();
  const imports = await db.getAllImportRecords();
  return {
    usage,
    quota,
    sessionCount: sessions.length,
    importCount: imports.length,
  };
}

// ── Overview Tab ─────────────────────────────────────────────────

function OverviewTab() {
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchStorageInfo()
      .then((info) => {
        if (!cancelled) {
          setStorageInfo(info);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load storage info');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className={styles.loading}>Loading storage information…</div>;
  }

  if (error) {
    return (
      <div className={`${styles.statusMessage} ${styles.statusError}`} role="alert">
        {error}
      </div>
    );
  }

  if (!storageInfo) return null;

  const usagePercent = storageInfo.quota > 0 ? (storageInfo.usage / storageInfo.quota) * 100 : 0;
  const remaining = storageInfo.quota - storageInfo.usage;

  return (
    <div className={styles.storageSection}>
      <div className={styles.storageHeader}>
        <h2 className={styles.sectionTitle}>Storage Overview</h2>
        <Button variant="primary" size="sm" onClick={() => navigate('/data/import')}>
          Import Data
        </Button>
      </div>

      <div className={styles.storageCards}>
        <Card className={styles.storageCard}>
          <span className={styles.storageLabel}>Total Used</span>
          <span className={styles.storageValue}>{formatBytes(storageInfo.usage)}</span>
          <span className={styles.storageSubtext}>of {formatBytes(storageInfo.quota)} quota</span>
        </Card>
        <Card className={styles.storageCard}>
          <span className={styles.storageLabel}>Available</span>
          <span className={styles.storageValue}>{formatBytes(remaining)}</span>
          <span className={styles.storageSubtext}>{usagePercent.toFixed(1)}% used</span>
        </Card>
        <Card className={styles.storageCard}>
          <span className={styles.storageLabel}>Sessions</span>
          <span className={styles.storageValue}>{storageInfo.sessionCount}</span>
          <span className={styles.storageSubtext}>stored sessions</span>
        </Card>
        <Card className={styles.storageCard}>
          <span className={styles.storageLabel}>Imports</span>
          <span className={styles.storageValue}>{storageInfo.importCount}</span>
          <span className={styles.storageSubtext}>completed imports</span>
        </Card>
      </div>

      <div className={styles.progressBarContainer}>
        <div className={styles.progressBarLabel}>
          <span>Storage Usage</span>
          <span>{usagePercent.toFixed(1)}%</span>
        </div>
        <progress
          className={styles.progressBarTrack}
          value={usagePercent}
          max={100}
          aria-label={`Storage usage: ${usagePercent.toFixed(1)} percent`}
        >
          {usagePercent.toFixed(1)}%
        </progress>
      </div>
    </div>
  );
}

// ── Import History Tab ───────────────────────────────────────────

function ImportHistoryTab() {
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDB()
      .then((db) => db.getAllImportRecords())
      .then((recs) => {
        if (!cancelled) {
          // Sort newest first
          recs.sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime());
          setRecords(recs);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load import history');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className={styles.loading}>Loading import history…</div>;
  }

  if (error) {
    return (
      <div className={`${styles.statusMessage} ${styles.statusError}`} role="alert">
        {error}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon} aria-hidden="true">
          📋
        </span>
        <h3 className={styles.emptyTitle}>No Import History</h3>
        <p className={styles.emptyDescription}>
          Import data using the Import Wizard to see your import history here.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.importHistorySection}>
      <h2 className={styles.sectionTitle}>Import History</h2>
      <div className={styles.tableContainer}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Machine</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead>Date Range</TableHead>
              <TableHead>Errors</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((rec) => {
              const hasErrors = rec.errors.length > 0;
              const totalSessions =
                rec.sessionsImported + rec.sessionsSkipped + rec.sessionsErrored;
              const status =
                rec.sessionsErrored > 0
                  ? 'partial'
                  : rec.sessionsImported > 0
                    ? 'success'
                    : 'skipped';

              return (
                <TableRow key={rec.id}>
                  <TableCell>{formatTimestamp(rec.importedAt)}</TableCell>
                  <TableCell>{rec.machineModel}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        status === 'success'
                          ? 'success'
                          : status === 'partial'
                            ? 'warning'
                            : 'default'
                      }
                      size="sm"
                    >
                      {status === 'success'
                        ? 'Success'
                        : status === 'partial'
                          ? 'Partial'
                          : 'Skipped'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {rec.sessionsImported} imported
                    {rec.sessionsSkipped > 0 && `, ${rec.sessionsSkipped} skipped`}
                    {totalSessions > 0 && ` (${totalSessions} total)`}
                  </TableCell>
                  <TableCell>
                    {formatDate(rec.dateRangeStart)} – {formatDate(rec.dateRangeEnd)}
                  </TableCell>
                  <TableCell>
                    {hasErrors ? (
                      <Badge variant="danger" size="sm">
                        {rec.errors.length} error{rec.errors.length !== 1 ? 's' : ''}
                      </Badge>
                    ) : (
                      <span className={styles.noErrors}>—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Cleanup Tab ──────────────────────────────────────────────────

function CleanupTab() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState(todayISO());
  const [deleteRangeOpen, setDeleteRangeOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const clearCache = useDataStore((s) => s.clearCache);

  const handleDeleteByRange = useCallback(async () => {
    if (!startDate || !endDate) return;
    setDeleting(true);
    setStatus(null);
    try {
      const db = await getDB();
      const sessions = await db.getSessionsByDateRange(startDate, endDate);
      const aggregates = await db.getNightlyAggregatesByDateRange(startDate, endDate);
      const opfs = new OPFSService();

      for (const session of sessions) {
        // Atomically remove the session, its nightly aggregate, and its events
        // (single IDB transaction — no orphaned aggregate left behind). OPFS
        // signal chunks live outside IndexedDB and are deleted separately.
        await opfs.deleteSessionData(session.id);
        await db.deleteSessionCascade(session.id);
      }

      // Defensive sweep: remove any aggregates in the range that were NOT linked
      // to a session we just cascaded (e.g. pre-existing orphans from before the
      // cascade fix). Aggregates tied to a deleted session are already gone, so
      // this only catches genuine orphans.
      for (const agg of aggregates) {
        await db.deleteNightlyAggregate(agg.id);
      }

      clearCache();
      setDeleteRangeOpen(false);
      setStatus({
        type: 'success',
        message: `Deleted ${sessions.length} session${sessions.length !== 1 ? 's' : ''} from ${formatDate(startDate)} to ${formatDate(endDate)}.`,
      });
    } catch (err: unknown) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete sessions',
      });
    } finally {
      setDeleting(false);
    }
  }, [startDate, endDate, clearCache]);

  const handleDeleteAll = useCallback(async () => {
    setDeleting(true);
    setStatus(null);
    try {
      const db = await getDB();
      await db.destroy();
      resetDB();
      const opfs = new OPFSService();
      await opfs.deleteAll();
      localStorage.removeItem('cpap-theme');
      localStorage.removeItem('cpap-settings');
      clearCache();
      setDeleteAllOpen(false);
      setDeleteConfirmText('');
      setStatus({
        type: 'success',
        message: 'All data has been permanently deleted.',
      });
    } catch (err: unknown) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete all data',
      });
    } finally {
      setDeleting(false);
    }
  }, [clearCache]);

  return (
    <div className={styles.cleanupSection}>
      {status && (
        <div
          className={`${styles.statusMessage} ${status.type === 'success' ? styles.statusSuccess : styles.statusError}`}
          role="alert"
        >
          {status.message}
        </div>
      )}

      {/* Delete by date range */}
      <Card>
        <div className={styles.cleanupGroup}>
          <h3 className={styles.cleanupGroupTitle}>Delete by Date Range</h3>
          <p className={styles.cleanupGroupDescription}>
            Remove sessions, aggregates, events, and signal data within a specific date range.
          </p>
          <div className={styles.dateRangeForm}>
            <div className={styles.dateField}>
              <label htmlFor="cleanup-start-date" className={styles.dateLabel}>
                Start Date
              </label>
              <input
                id="cleanup-start-date"
                type="date"
                className={styles.dateInput}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={endDate || todayISO()}
                aria-label="Start date for deletion"
              />
            </div>
            <div className={styles.dateField}>
              <label htmlFor="cleanup-end-date" className={styles.dateLabel}>
                End Date
              </label>
              <input
                id="cleanup-end-date"
                type="date"
                className={styles.dateInput}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                max={todayISO()}
                aria-label="End date for deletion"
              />
            </div>
            <Button
              variant="danger"
              size="sm"
              disabled={!startDate || !endDate}
              onClick={() => setDeleteRangeOpen(true)}
            >
              Delete Range
            </Button>
          </div>
        </div>
      </Card>

      {/* Delete all data */}
      <Card className={styles.deleteAllSection}>
        <div className={`${styles.cleanupGroup} ${styles.dangerZone}`}>
          <h3 className={styles.dangerTitle}>Danger Zone</h3>
          <p className={styles.dangerDescription}>
            Permanently delete all imported data, including sessions, aggregates, events, signal
            data, import history, and settings. This action cannot be undone.
          </p>
          <Button variant="danger" onClick={() => setDeleteAllOpen(true)}>
            Delete All Data
          </Button>
        </div>
      </Card>

      {/* Confirm delete range dialog */}
      <Dialog
        open={deleteRangeOpen}
        onOpenChange={setDeleteRangeOpen}
        title="Confirm Delete by Date Range"
        description={`This will permanently delete all sessions and related data from ${formatDate(startDate)} to ${formatDate(endDate)}.`}
      >
        <p className={styles.dialogWarning}>This action cannot be undone.</p>
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={() => setDeleteRangeOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeleteByRange} loading={deleting}>
            Delete Sessions
          </Button>
        </div>
      </Dialog>

      {/* Confirm delete all dialog */}
      <Dialog
        open={deleteAllOpen}
        onOpenChange={(open) => {
          setDeleteAllOpen(open);
          if (!open) setDeleteConfirmText('');
        }}
        title="Delete All Data"
        description="This will permanently erase all data from the application. This cannot be undone."
      >
        <p className={styles.dialogWarning}>
          Type <strong>DELETE</strong> to confirm.
        </p>
        <div className={styles.confirmInput}>
          <Input
            label="Confirmation"
            placeholder="Type DELETE to confirm"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            aria-label="Type DELETE to confirm deletion"
          />
        </div>
        <div className={styles.dialogActions}>
          <Button
            variant="secondary"
            onClick={() => {
              setDeleteAllOpen(false);
              setDeleteConfirmText('');
            }}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDeleteAll}
            loading={deleting}
            disabled={deleteConfirmText !== 'DELETE'}
          >
            Delete Everything
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

// ── Session Export (within Backup Tab) ───────────────────────────

function SessionExportSection() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDB()
      .then((db) => db.getAllSessions())
      .then((all) => {
        if (!cancelled) {
          all.sort((a, b) => b.date.localeCompare(a.date));
          setSessions(all);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load sessions');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleExport = useCallback(async (session: Session) => {
    setExportingId(session.id);
    setExportError(null);
    try {
      const db = await getDB();
      const events = await db.getEventsBySessionId(session.id);
      const exportData = { session, events };
      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      downloadBlob(blob, `cpap-session-${session.date}.json`);
    } catch (err) {
      setExportError(
        `Failed to export session from ${session.date}: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      );
    } finally {
      setExportingId(null);
    }
  }, []);

  if (loading) {
    return <div className={styles.loading}>Loading sessions…</div>;
  }

  if (error) {
    return (
      <div className={`${styles.statusMessage} ${styles.statusError}`} role="alert">
        {error}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon} aria-hidden="true">
          📄
        </span>
        <h3 className={styles.emptyTitle}>No Sessions</h3>
        <p className={styles.emptyDescription}>Import data to export individual sessions.</p>
      </div>
    );
  }

  return (
    <div className={styles.backupGroup}>
      <h3 className={styles.backupGroupTitle}>Export Individual Sessions</h3>
      <p className={styles.backupGroupDescription}>
        Download individual session data as JSON files.
      </p>
      {exportError && (
        <div className={`${styles.statusMessage} ${styles.statusError}`} role="alert">
          {exportError}
        </div>
      )}
      <div className={styles.sessionList}>
        {sessions.slice(0, 50).map((session) => (
          <div key={session.id} className={styles.sessionRow}>
            <div className={styles.sessionInfo}>
              <span className={styles.sessionDate}>{formatDate(session.date)}</span>
              <span className={styles.sessionMeta}>
                {session.machineModel} · {Math.round((session.usageMinutes / 60) * 10) / 10} hrs
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleExport(session)}
              loading={exportingId === session.id}
              aria-label={`Export session from ${session.date}`}
            >
              Export
            </Button>
          </div>
        ))}
        {sessions.length > 50 && (
          <p className={styles.storageSubtext}>
            Showing 50 of {sessions.length} sessions. Use full backup for complete export.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Backup & Restore Tab ─────────────────────────────────────────

function BackupRestoreTab() {
  const [backupPassword, setBackupPassword] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const clearCache = useDataStore((s) => s.clearCache);

  const handleBackup = useCallback(async () => {
    if (!backupPassword) return;
    setBackupLoading(true);
    setStatus(null);
    try {
      const db = await getDB();
      const sessions = await db.getAllSessions();
      const imports = await db.getAllImportRecords();
      const settings = await db.getAllSettings();

      // Collect events for all sessions
      const events: unknown[] = [];
      for (const session of sessions) {
        const sessionEvents = await db.getEventsBySessionId(session.id);
        events.push(...sessionEvents);
      }

      // Fetch all aggregates by querying earliest to latest date
      const aggregates: unknown[] = [];
      if (sessions.length > 0) {
        const dates = sessions.map((s) => s.date).sort();
        const earliest = dates[0];
        const latest = dates[dates.length - 1];
        if (earliest && latest) {
          const allAggs = await db.getNightlyAggregatesByDateRange(earliest, latest);
          aggregates.push(...allAggs);
        }
      }

      const backupData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions,
        aggregates,
        events,
        imports,
        settings,
      };

      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(backupData)).buffer as ArrayBuffer;
      const blob = await encryptBuffer(data, { password: backupPassword });
      const dateStr = todayISO();
      downloadBlob(blob, `cpap-backup-${dateStr}.bin`);
      setBackupPassword('');
      setStatus({ type: 'success', message: 'Backup created and downloaded successfully.' });
    } catch (err: unknown) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to create backup',
      });
    } finally {
      setBackupLoading(false);
    }
  }, [backupPassword]);

  const handleRestore = useCallback(async () => {
    if (!restoreFile || !restorePassword) return;
    setRestoreLoading(true);
    setStatus(null);
    try {
      const arrayBuffer = await restoreFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // Parse encrypted archive format:
      // [4 bytes iterations][16 bytes salt][12 bytes IV][ciphertext]
      if (bytes.length < 32) {
        throw new Error('Invalid backup file: too small');
      }

      const iterations = new DataView(bytes.buffer as ArrayBuffer, bytes.byteOffset, 4).getUint32(
        0,
        false,
      );
      const salt = bytes.slice(4, 20);
      const iv = bytes.slice(20, 32);
      const ciphertext = bytes.slice(32);

      const key = await deriveDecryptKey(restorePassword, salt, iterations);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        key,
        ciphertext.buffer as ArrayBuffer,
      );

      const decoder = new TextDecoder();
      const json = decoder.decode(decrypted);
      const backupData = JSON.parse(json) as {
        version: number;
        sessions: Session[];
        aggregates: Array<{ id: string; date: string; sessionId: string }>;
        events: Array<{ id: string; sessionId: string }>;
        imports: ImportRecord[];
        settings: Array<{ key: string; value: unknown; updatedAt: string }>;
      };

      if (!backupData.version || !backupData.sessions) {
        throw new Error('Invalid backup file format');
      }

      // Wipe existing data first
      const db = await getDB();
      await db.destroy();
      resetDB();

      // Re-open database (fresh schema)
      const freshDb = await getDB();

      // Re-populate stores
      for (const session of backupData.sessions) {
        await freshDb.addSession(session);
      }

      if (backupData.aggregates) {
        for (const agg of backupData.aggregates) {
          await freshDb.addNightlyAggregate(
            agg as Parameters<typeof freshDb.addNightlyAggregate>[0],
          );
        }
      }

      if (backupData.events) {
        for (const event of backupData.events) {
          await freshDb.addEvent(event as Parameters<typeof freshDb.addEvent>[0]);
        }
      }

      if (backupData.imports) {
        for (const rec of backupData.imports) {
          await freshDb.addImportRecord(rec);
        }
      }

      if (backupData.settings) {
        for (const setting of backupData.settings) {
          await freshDb.putSetting(setting.key, setting.value);
        }
      }

      clearCache();
      setRestoreFile(null);
      setRestorePassword('');
      setStatus({ type: 'success', message: 'Backup restored successfully.' });
    } catch (err: unknown) {
      const message =
        err instanceof DOMException && err.name === 'OperationError'
          ? 'Incorrect password or corrupted backup file'
          : err instanceof Error
            ? err.message
            : 'Failed to restore backup';
      setStatus({ type: 'error', message });
    } finally {
      setRestoreLoading(false);
    }
  }, [restoreFile, restorePassword, clearCache]);

  return (
    <div className={styles.backupSection}>
      {status && (
        <div
          className={`${styles.statusMessage} ${status.type === 'success' ? styles.statusSuccess : styles.statusError}`}
          role="alert"
        >
          {status.message}
        </div>
      )}

      {/* Full Backup */}
      <Card>
        <div className={styles.backupGroup}>
          <h3 className={styles.backupGroupTitle}>Create Encrypted Backup</h3>
          <p className={styles.backupGroupDescription}>
            Export all data (sessions, aggregates, events, settings) as an AES-256-GCM encrypted
            archive. You will need this password to restore the backup.
          </p>
          <div className={styles.passwordField}>
            <Input
              label="Encryption Password"
              type="password"
              value={backupPassword}
              onChange={(e) => setBackupPassword(e.target.value)}
              placeholder="Enter a strong password"
              aria-label="Encryption password for backup"
            />
          </div>
          <div>
            <Button
              variant="primary"
              onClick={handleBackup}
              loading={backupLoading}
              disabled={!backupPassword}
            >
              Create Backup
            </Button>
          </div>
        </div>
      </Card>

      {/* Restore */}
      <Card>
        <div className={styles.backupGroup}>
          <h3 className={styles.backupGroupTitle}>Restore from Backup</h3>
          <p className={styles.backupGroupDescription}>
            Import a previously created encrypted backup. This will replace all existing data.
          </p>
          <div className={styles.restoreForm}>
            <input
              type="file"
              accept=".bin"
              className={styles.fileInput}
              onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
              aria-label="Select backup file to restore"
            />
            <div className={styles.passwordField}>
              <Input
                label="Decryption Password"
                type="password"
                value={restorePassword}
                onChange={(e) => setRestorePassword(e.target.value)}
                placeholder="Enter backup password"
                aria-label="Decryption password for restore"
              />
            </div>
            <div>
              <Button
                variant="primary"
                onClick={handleRestore}
                loading={restoreLoading}
                disabled={!restoreFile || !restorePassword}
              >
                Restore Backup
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Session Export */}
      <Card>
        <SessionExportSection />
      </Card>
    </div>
  );
}

// ── Main View ────────────────────────────────────────────────────

export default function DataManagement() {
  const navigate = useNavigate();

  const tabs = [
    { value: 'overview', label: 'Overview', content: <OverviewTab /> },
    { value: 'history', label: 'Import History', content: <ImportHistoryTab /> },
    { value: 'cleanup', label: 'Cleanup', content: <CleanupTab /> },
    { value: 'backup', label: 'Backup & Restore', content: <BackupRestoreTab /> },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Data Management</h1>
        <Button variant="primary" onClick={() => navigate('/data/import')}>
          Import Wizard
        </Button>
      </div>
      <Tabs tabs={tabs} defaultValue="overview" />
    </div>
  );
}
