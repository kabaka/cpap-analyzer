/**
 * Persistent, app-level import indicator.
 *
 * Mounted once at {@link import('../layouts/RootLayout').default} level, OUTSIDE
 * the import wizard, so an import remains visible while the user navigates. It
 * subscribes to {@link useImportStore} and renders ONLY when a job is active or
 * terminal-but-not-yet-dismissed.
 *
 * - Collapsed: a bottom-LEFT fixed pill (avoiding the bottom-right toast column)
 *   with a status icon, label, overall %, a `sm` micro-meter, a cancel control,
 *   and an expand chevron.
 * - Expanded: a non-modal panel containing the compact {@link ImportStageList},
 *   elapsed/throughput/ETA, Cancel, "Open import page", and (terminal) View
 *   results / Dismiss.
 * - Cancel is CONFIRMED via a modal {@link Dialog} before calling
 *   `importController.cancel`.
 * - On a terminal transition the pill updates AND a toast fires (suppressed while
 *   the user is already on `/data/import`).
 *
 * Accessibility: a single polite live region announces quantized milestones; an
 * assertive region announces terminal/error. Indeterminate meters omit
 * `aria-valuenow` (handled by {@link ProgressBar}). Reduced motion disables the
 * spinner rotation.
 *
 * @module components/import/ImportStatusDock
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from 'zustand';

import { Button, Dialog, Icon, ProgressBar } from '@/components/ui';
import { importController } from '@/services/import/ImportController';
import type { ImportJobProgress } from '@/services/import/types';
import { useAppStore } from '@/stores/useAppStore';
import {
  selectActiveJob,
  selectLatestJobOfKind,
  useImportStore,
  type ImportJobEntry,
} from '@/stores/useImportStore';

import { ImportStageList } from './ImportStageList';
import { overallPercent } from './overallProgress';
import { formatElapsed, formatThroughput, formatEta } from './importFormat';
import { useImportToast } from './ImportToastContext';
import { useReducedMotion } from './useReducedMotion';
import styles from './ImportStatusDock.module.css';

const IMPORT_ROUTE = '/data/import';
const DATA_ROUTE = '/data';

/** Whether a job status is terminal. */
function isTerminal(status: ImportJobProgress['status']): boolean {
  return status === 'complete' || status === 'error' || status === 'cancelled';
}

/** Pick the single job the dock should surface: the active one, else the most recent terminal-undismissed. */
function selectDockJob(
  active: ImportJobEntry | null,
  latestCpap: ImportJobEntry | null,
  latestFitbit: ImportJobEntry | null,
): ImportJobEntry | null {
  if (active) return active;
  // No active job: surface the freshest terminal job still in the store.
  const candidates = [latestCpap, latestFitbit].filter((e): e is ImportJobEntry => e !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.progress.startedAtMs >= a.progress.startedAtMs ? b : a));
}

/** Per-status pill presentation (icon shape + colour token + spin flag). */
function pillVisual(progress: ImportJobProgress): {
  icon: 'spinner' | 'circle-dot' | 'check-circle' | 'alert-triangle' | 'x-circle';
  colorVar: string;
  animated: boolean;
} {
  switch (progress.status) {
    case 'scanning':
    case 'running':
      return { icon: 'spinner', colorVar: 'var(--color-stage-active)', animated: true };
    case 'complete':
      return progress.warningCount + progress.errorCount > 0
        ? { icon: 'alert-triangle', colorVar: 'var(--color-stage-warning)', animated: false }
        : { icon: 'check-circle', colorVar: 'var(--color-stage-done)', animated: false };
    case 'error':
      return { icon: 'x-circle', colorVar: 'var(--color-stage-error)', animated: false };
    case 'cancelled':
      return { icon: 'alert-triangle', colorVar: 'var(--color-stage-warning)', animated: false };
    default:
      return { icon: 'circle-dot', colorVar: 'var(--color-stage-active)', animated: false };
  }
}

/** A short label for the kind of import. */
function kindLabel(kind: ImportJobProgress['kind']): string {
  return kind === 'cpap' ? 'CPAP import' : 'Fitbit import';
}

export function ImportStatusDock(): JSX.Element | null {
  const navigate = useNavigate();
  const location = useLocation();
  const reducedMotion = useReducedMotion();
  const raiseToast = useImportToast();

  const active = useStore(useImportStore, selectActiveJob);
  const latestCpap = useStore(useImportStore, (s) => selectLatestJobOfKind(s, 'cpap'));
  const latestFitbit = useStore(useImportStore, (s) => selectLatestJobOfKind(s, 'fitbit'));

  // The header-launched wizard modal shows the same job; suppress the dock pill
  // while it is open so only one live surface is visible at a time.
  const importWizardOpen = useAppStore((s) => s.importWizardOpen);

  const job = selectDockJob(active, latestCpap, latestFitbit);

  const [expanded, setExpanded] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [politeMessage, setPoliteMessage] = useState('');
  const [assertiveMessage, setAssertiveMessage] = useState('');

  const panelRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);

  const progress = job?.progress ?? null;
  const onImportRoute = location.pathname === IMPORT_ROUTE;
  const onDataRoute = location.pathname === DATA_ROUTE;
  // The wizard surface (the `/data/import` route OR the header-launched modal)
  // already shows a terminal summary, so a completion toast there is redundant.
  const importUiVisible = onImportRoute || importWizardOpen;

  // ── Terminal toast (once per job, across concurrent kinds) ──
  //
  // ADR 0026 permits a CPAP and a Fitbit import to run concurrently. The dock
  // only ever SURFACES one job, but a completion toast + assertive announcement
  // must fire for EVERY job's terminal transition — so we scan all jobs the
  // store knows about (the active one plus the latest of each kind), not just
  // the dock-surfaced one, and remember which job-ids have already toasted in a
  // Set. A dismissed-then-re-run import gets a fresh job-id, so it toasts again
  // as expected; a job already in the Set never toasts twice.
  const toastedJobsRef = useRef<Set<string>>(new Set());
  const announcedJobsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // De-duplicate the candidate jobs by id (active may equal a latest-of-kind).
    const candidates = new Map<string, ImportJobProgress>();
    for (const entry of [active, latestCpap, latestFitbit]) {
      if (entry) candidates.set(entry.progress.jobId, entry.progress);
    }

    for (const candidate of candidates.values()) {
      if (!isTerminal(candidate.status)) continue;
      const label = kindLabel(candidate.kind);

      // Assertive announcement: once per job, regardless of route (assistive tech
      // should always learn an import ended). Distinct phrasing from the visual
      // toast title so the two surfaces never collide for AT (or tests).
      if (!announcedJobsRef.current.has(candidate.jobId)) {
        announcedJobsRef.current.add(candidate.jobId);
        const msg =
          candidate.status === 'complete'
            ? `${label} finished`
            : candidate.status === 'error'
              ? `${label} failed: ${candidate.currentLabel}`
              : `${label} stopped`;
        setAssertiveMessage(msg);
      }

      // Visual toast: once per job. Suppressed (but still marked) while the user
      // is already looking at the import UI (the route OR the modal), so it never
      // re-fires later on navigation.
      if (toastedJobsRef.current.has(candidate.jobId)) continue;
      toastedJobsRef.current.add(candidate.jobId);
      if (importUiVisible) continue;

      if (candidate.status === 'complete') {
        const hasIssues = candidate.warningCount + candidate.errorCount > 0;
        raiseToast({
          title: hasIssues ? `${label} finished with issues` : `${label} complete`,
          description: hasIssues
            ? `${(candidate.warningCount + candidate.errorCount).toLocaleString()} issues — open the dock for details.`
            : undefined,
          variant: hasIssues ? 'warning' : 'success',
        });
      } else if (candidate.status === 'error') {
        raiseToast({
          title: `${label} failed`,
          description: candidate.currentLabel,
          variant: 'error',
        });
      } else {
        raiseToast({ title: `${label} cancelled`, variant: 'info' });
      }
    }
  }, [active, latestCpap, latestFitbit, importUiVisible, raiseToast]);

  // ── Quantized polite announcer: stage transitions + ~25% milestones ──
  // Terminal assertive announcements are handled in the multi-job effect above;
  // this effect only emits in-flight progress milestones for the surfaced job.
  const lastStageRef = useRef<string | null>(null);
  const lastBucketRef = useRef<number>(-1);
  useEffect(() => {
    if (!progress) return;
    if (isTerminal(progress.status)) return;

    // Announce on stage change.
    const activeStageId = progress.activeStageId;
    if (activeStageId && activeStageId !== lastStageRef.current) {
      lastStageRef.current = activeStageId;
      lastBucketRef.current = -1;
      const stage = progress.stages.find((s) => s.id === activeStageId);
      if (stage) setPoliteMessage(`${stage.label} started`);
      return;
    }

    // Otherwise announce only on crossing a coarse progress bucket (every ~25%).
    const pct = overallPercent(progress);
    const bucket = Math.floor(pct / 25);
    if (bucket !== lastBucketRef.current && pct > 0) {
      lastBucketRef.current = bucket;
      setPoliteMessage(`Import ${String(pct)} percent complete`);
    }
  }, [progress]);

  // ── Focus management for the expanded panel (non-modal; Esc returns to pill) ──
  useEffect(() => {
    if (!expanded) return;
    const panel = panelRef.current;
    if (!panel) return;
    const firstFocusable = panel.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setExpanded(false);
        pillRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  const handleRequestCancel = useCallback(() => setConfirmCancel(true), []);
  const handleConfirmCancel = useCallback(() => {
    if (job) importController.cancel(job.progress.jobId);
    setConfirmCancel(false);
  }, [job]);

  const handleOpenImportPage = useCallback(() => {
    setExpanded(false);
    void navigate(IMPORT_ROUTE);
  }, [navigate]);

  const handleDismiss = useCallback(() => {
    if (job) importController.dismiss(job.progress.jobId);
    setExpanded(false);
  }, [job]);

  // Nothing to show.
  if (!progress) return null;

  const visual = pillVisual(progress);
  const animate = visual.animated && !reducedMotion;
  const iconName = animate ? visual.icon : visual.animated ? 'circle-dot' : visual.icon;
  const pct = overallPercent(progress);
  const terminal = isTerminal(progress.status);
  const running = !terminal;
  // Suppress the pill/panel (but keep the live regions) while another surface
  // owns the import: the wizard modal is open, or the Data page is showing its
  // inline active-import panel. A terminal job on /data still surfaces the dock
  // (the inline panel only renders in-flight) so it can be viewed/dismissed.
  const suppressPill = importWizardOpen || (onDataRoute && running);
  const label = kindLabel(progress.kind);
  const elapsed = progress.startedAtMs > 0 ? formatElapsed(progress.startedAtMs, Date.now()) : null;
  const throughput = formatThroughput(progress.throughputPerSec, 'items');
  const eta = formatEta(progress.etaMs);
  const hasResult = job?.result != null;

  const pillIconClass = [styles.pillIcon, animate ? styles.spin : null].filter(Boolean).join(' ');

  return (
    <>
      {/* Live regions: one polite for milestones, one assertive for terminal. */}
      <div className={styles.srOnly} role="status" aria-live="polite">
        {politeMessage}
      </div>
      <div className={styles.srOnly} role="alert" aria-live="assertive">
        {assertiveMessage}
      </div>

      {suppressPill ? null : (
        <>
          <div className={styles.dock}>
            {!expanded ? (
              <div className={styles.pill}>
                <button
                  ref={pillRef}
                  type="button"
                  className={styles.pillBody}
                  aria-expanded={expanded}
                  aria-label={`${label}: ${String(pct)}% — open details`}
                  onClick={() => setExpanded(true)}
                >
                  <span className={styles.pillTopLine}>
                    <span
                      className={pillIconClass}
                      style={{ color: visual.colorVar }}
                      data-testid="import-dock-pill-icon"
                      data-animated={animate ? 'true' : 'false'}
                    >
                      <Icon name={iconName} size="sm" />
                    </span>
                    <span className={styles.pillLabel}>{progress.currentLabel || label}</span>
                    <span className={styles.pillPercent}>{pct}%</span>
                  </span>
                  <ProgressBar
                    className={styles.pillMeter}
                    size="sm"
                    indeterminate={running && progress.itemsTotal === null}
                    value={pct}
                    max={100}
                    tone={
                      progress.status === 'error'
                        ? 'error'
                        : progress.status === 'complete' &&
                            progress.warningCount + progress.errorCount === 0
                          ? 'success'
                          : progress.status === 'complete' || progress.status === 'cancelled'
                            ? 'warning'
                            : 'primary'
                    }
                    paused={progress.status === 'cancelled'}
                    label={`${label} progress`}
                    valueText={`${label}: ${String(pct)} percent`}
                  />
                </button>

                {running ? (
                  <button
                    type="button"
                    className={styles.pillCancel}
                    aria-label={`Cancel ${label}`}
                    onClick={handleRequestCancel}
                  >
                    <Icon name="x-circle" size="sm" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.pillCancel}
                    aria-label={`Dismiss ${label}`}
                    onClick={handleDismiss}
                  >
                    <Icon name="close" size="sm" />
                  </button>
                )}

                <span className={styles.pillChevron} aria-hidden="true">
                  <Icon name="chevron-up" size="sm" />
                </span>
              </div>
            ) : (
              <div
                ref={panelRef}
                className={styles.panel}
                role="region"
                aria-label={`${label} details`}
              >
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>{label}</h2>
                  <button
                    type="button"
                    className={styles.panelClose}
                    aria-label="Collapse import details"
                    onClick={() => {
                      setExpanded(false);
                      pillRef.current?.focus();
                    }}
                  >
                    <Icon name="chevron-down" size="sm" />
                  </button>
                </div>

                <div className={styles.panelMeta}>
                  <span>{pct}% complete</span>
                  {elapsed && <span>Elapsed {elapsed}</span>}
                  {running && throughput && <span>{throughput}</span>}
                  {running && eta && <span>{eta}</span>}
                </div>

                <div className={styles.scroller}>
                  <ImportStageList progress={progress} compact />
                </div>

                <div className={styles.panelActions}>
                  {running && (
                    <Button variant="danger" size="sm" onClick={handleRequestCancel}>
                      Cancel import
                    </Button>
                  )}
                  {terminal && hasResult && (
                    <Button variant="primary" size="sm" onClick={handleOpenImportPage}>
                      View results
                    </Button>
                  )}
                  {!onImportRoute && (
                    <Button variant="secondary" size="sm" onClick={handleOpenImportPage}>
                      Open import page
                    </Button>
                  )}
                  {terminal && (
                    <Button variant="ghost" size="sm" onClick={handleDismiss}>
                      Dismiss
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          <Dialog
            open={confirmCancel}
            onOpenChange={setConfirmCancel}
            title="Cancel import?"
            description="The import will stop. Data already saved is kept; the rest is discarded."
          >
            <div className={styles.panelActions}>
              <Button variant="danger" size="sm" onClick={handleConfirmCancel}>
                Cancel import
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmCancel(false)}>
                Keep importing
              </Button>
            </div>
          </Dialog>
        </>
      )}
    </>
  );
}

export default ImportStatusDock;
