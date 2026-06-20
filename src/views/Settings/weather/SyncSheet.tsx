/**
 * Weather sync sheet — a dialog that reuses the import-progress chrome to drive
 * a {@link WeatherSyncService} run.
 *
 * Stages:
 * 1. **Scope** — shows the exact night count and an egress reminder ("sends N
 *    dates + your approximate location to Open-Meteo") BEFORE any request, with
 *    Start / Cancel. Nothing leaves the device until Start.
 * 2. **Progress** — a `role="progressbar"` with a throttled `aria-live` region
 *    (announces on stage change / ~10% only, never per night), plus offline /
 *    rate-limited / partial states. Cancel aborts via an `AbortSignal`.
 * 3. **Coverage** — on completion, a {@link CoverageView} distinguishing
 *    Synced / Not synced / No data available / Failed.
 *
 * The service and "now" are injectable for testing; the default service writes
 * to IndexedDB.
 *
 * @module views/Settings/weather/SyncSheet
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog } from '@/components/ui';
import { getDB } from '@/services/storage/getDB';
import {
  WeatherSyncService,
  type WeatherSyncNight,
  type WeatherSyncOptions,
  type WeatherSyncProgress,
} from '@/services/weather/WeatherSyncService';
import type { WeatherLocation } from '@/types/weather';
import { CoverageView, type CoverageRow } from './CoverageView';
import styles from './WeatherIntegrationPanel.module.css';

export interface SyncSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly nights: readonly WeatherSyncNight[];
  readonly location: WeatherLocation;
  readonly timezone: string;
  /** Reference "today", `YYYY-MM-DD`. Injectable for tests. */
  readonly today: string;
  readonly fetchCore: boolean;
  readonly fetchAirQuality: boolean;
  readonly storeHourly: boolean;
  /** Called when a run finishes (so the panel can refresh status counts). */
  readonly onSynced?: () => void;
  /** Injectable service factory (tests pass a fake). */
  readonly createService?: () => Promise<{
    sync: (options: WeatherSyncOptions) => Promise<unknown>;
  }>;
}

type Phase = 'scope' | 'running' | 'done';

/** Map a sync error reason onto a short user-facing string. */
function reasonText(reason: string | undefined, message: string): string {
  switch (reason) {
    case 'offline':
      return 'Offline';
    case 'rate-limited':
      return 'Rate limited (429)';
    case 'timeout':
      return 'Timed out';
    case 'http':
      return 'Server error';
    case 'parse':
      return 'Bad response';
    case 'too-large':
      return 'The weather service returned an unexpectedly large response. Please try again later.';
    default:
      return message;
  }
}

/** Build coverage rows from the final progress + which nights stored data. */
function buildCoverage(
  nights: readonly WeatherSyncNight[],
  progress: WeatherSyncProgress,
  syncedDates: ReadonlySet<string>,
): CoverageRow[] {
  const errorByDate = new Map<string, { reason?: string; message: string }>();
  for (const e of progress.errors) {
    if (e.date) errorByDate.set(e.date, { reason: e.reason, message: e.error });
  }

  return nights.map((night): CoverageRow => {
    if (progress.status === 'cancelled' && !syncedDates.has(night.date)) {
      return { date: night.date, status: 'missing' };
    }
    const err = night.civilDates.map((d) => errorByDate.get(d)).find(Boolean);
    if (err) {
      return { date: night.date, status: 'failed', reason: reasonText(err.reason, err.message) };
    }
    if (syncedDates.has(night.date)) {
      return { date: night.date, status: 'synced' };
    }
    // Queried but empty: distinct from "not fetched".
    return { date: night.date, status: 'no-data' };
  });
}

export function SyncSheet({
  open,
  onClose,
  nights,
  location,
  timezone,
  today,
  fetchCore,
  fetchAirQuality,
  storeHourly,
  onSynced,
  createService,
}: SyncSheetProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('scope');
  const [progress, setProgress] = useState<WeatherSyncProgress | null>(null);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Throttled live-region text: only updates on stage change / ~10% steps.
  const [liveText, setLiveText] = useState('');
  const lastAnnouncedRef = useRef<{ stage: string; bucket: number }>({ stage: '', bucket: -1 });

  // Reset to the scope step whenever the sheet (re)opens.
  useEffect(() => {
    if (open) {
      setPhase('scope');
      setProgress(null);
      setCoverage([]);
      setLiveText('');
      lastAnnouncedRef.current = { stage: '', bucket: -1 };
    }
  }, [open]);

  const percent = useMemo(() => {
    if (!progress || progress.datesTotal === 0) return 0;
    return Math.min(100, Math.round((progress.datesProcessed / progress.datesTotal) * 100));
  }, [progress]);

  const handleProgress = useCallback((p: WeatherSyncProgress) => {
    setProgress(p);
    const bucket = p.datesTotal > 0 ? Math.floor((p.datesProcessed / p.datesTotal) * 10) : 0;
    const last = lastAnnouncedRef.current;
    if (p.currentStage !== last.stage || bucket !== last.bucket) {
      lastAnnouncedRef.current = { stage: p.currentStage, bucket };
      const pct = p.datesTotal > 0 ? Math.round((p.datesProcessed / p.datesTotal) * 100) : 0;
      setLiveText(`${p.currentStage} ${pct}%`);
    }
  }, []);

  const handleStart = useCallback(async () => {
    setPhase('running');
    const controller = new AbortController();
    abortRef.current = controller;

    const service = createService ? await createService() : new WeatherSyncService(await getDB());

    let finalProgress: WeatherSyncProgress | null = null;
    await service.sync({
      nights,
      location,
      timezone,
      today,
      fetchCore,
      fetchAirQuality,
      storeHourly,
      signal: controller.signal,
      onProgress: (p) => {
        finalProgress = p;
        handleProgress(p);
      },
    });

    // Determine which nights actually have a daily summary now.
    const syncedDates = new Set<string>();
    try {
      const db = await getDB();
      const start = nights.reduce((min, n) => (n.date < min ? n.date : min), nights[0]?.date ?? '');
      const end = nights.reduce((max, n) => (n.date > max ? n.date : max), nights[0]?.date ?? '');
      if (start && end) {
        const stored = await db.getIntegrationDailySummariesByDateRange(start, end);
        for (const r of stored) {
          if (r.source === 'weather') syncedDates.add(r.date);
        }
      }
    } catch {
      // If the verification read fails, fall back to "no-data" rows below.
    }

    const resolved = finalProgress ?? progress;
    if (resolved) {
      setCoverage(buildCoverage(nights, resolved, syncedDates));
    }
    setPhase('done');
    abortRef.current = null;
    onSynced?.();
  }, [
    createService,
    nights,
    location,
    timezone,
    today,
    fetchCore,
    fetchAirQuality,
    storeHourly,
    handleProgress,
    progress,
    onSynced,
  ]);

  const handleCancelRun = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const offline = progress?.errors.some((e) => e.reason === 'offline') ?? false;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          abortRef.current?.abort();
          onClose();
        }
      }}
      title="Sync weather data"
      description="Fetch weather and air quality for your therapy nights from Open-Meteo."
    >
      <div className={styles.syncBody}>
        {phase === 'scope' && (
          <div className={styles.syncScope}>
            <p className={styles.syncEgressReminder} role="note">
              <span className={styles.egressGlyph} aria-hidden="true">
                ↗
              </span>{' '}
              This sends <strong>{nights.length}</strong> {nights.length === 1 ? 'date' : 'dates'}{' '}
              plus your approximate location (rounded to ~1.1 km) to Open-Meteo. No therapy data and
              no identifier are sent.
            </p>
            {nights.length === 0 ? (
              <p className={styles.syncEmpty}>
                There are no therapy nights in the current range to sync.
              </p>
            ) : null}
            <div className={styles.dialogActions}>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleStart()}
                disabled={nights.length === 0}
              >
                Start sync
              </Button>
            </div>
          </div>
        )}

        {phase === 'running' && (
          <div className={styles.syncProgress}>
            <div
              className={styles.progressBar}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label="Weather sync progress"
            >
              <div className={styles.progressFill} style={{ width: `${percent}%` }} />
            </div>
            <p className={styles.srLive} aria-live="polite">
              {liveText}
            </p>
            <div className={styles.syncStats}>
              <span>{progress?.currentStage ?? 'Starting…'}</span>
              <span>{percent}%</span>
            </div>
            {progress?.rateLimited && (
              <p className={styles.syncWarn} role="status">
                Rate limited by Open-Meteo — pausing and retrying…
              </p>
            )}
            {offline && (
              <p className={styles.syncWarn} role="alert">
                You appear to be offline. Reconnect to continue.
              </p>
            )}
            <div className={styles.dialogActions}>
              <Button variant="secondary" onClick={handleCancelRun}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className={styles.syncDone}>
            <CoverageView rows={coverage} />
            <div className={styles.dialogActions}>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
