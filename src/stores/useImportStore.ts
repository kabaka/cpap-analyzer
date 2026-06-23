/**
 * Import job store (ADR 0026).
 *
 * The single source of truth for import lifecycle state, keyed by job id. The
 * {@link importController} (a module-level singleton living OUTSIDE the React
 * tree) is the only writer; React components and hooks subscribe to it.
 *
 * Because the controller owns the job lifecycle, an import survives navigation:
 * unmounting the importing component no longer aborts the work or loses its
 * progress — the store keeps publishing until the job reaches a terminal state
 * and is explicitly dismissed.
 *
 * Everything stored here is structured-clone-safe (see {@link ImportJobProgress}):
 * no `Date`s, functions, or class instances. The legacy per-service progress
 * snapshots are also retained verbatim so the existing import wizard can render
 * unchanged while the dedicated UI lands.
 *
 * @module stores/useImportStore
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import type {
  GoogleHealthImportProgress,
  ImportJobProgress,
  ImportProgress,
} from '@/services/import/types';
import type { ImportRecord, IntegrationImportRecord } from '@/types/storage';

// ---------------------------------------------------------------------------
// Per-job record
// ---------------------------------------------------------------------------

/** Final result of a completed job (kind-tagged union). */
export type ImportJobResult =
  | { readonly kind: 'cpap'; readonly record: ImportRecord }
  | { readonly kind: 'fitbit'; readonly record: IntegrationImportRecord };

/**
 * The legacy progress snapshot a job's originating service still emits.
 *
 * Retained so {@link useImport} / {@link useGoogleHealthImport} can keep
 * returning the exact shape the import wizard consumes today, without the hooks
 * having to reconstruct it from {@link ImportJobProgress}.
 */
export type LegacyImportProgress =
  | { readonly kind: 'cpap'; readonly progress: ImportProgress }
  | { readonly kind: 'fitbit'; readonly progress: GoogleHealthImportProgress };

/** Everything the store tracks for a single import job. */
export interface ImportJobEntry {
  /** Unified, serializable progress snapshot. */
  readonly progress: ImportJobProgress;
  /** Verbatim legacy progress snapshot for the existing wizard. */
  readonly legacy: LegacyImportProgress;
  /** Final result once the job completes (null until then). */
  readonly result: ImportJobResult | null;
  /** Fatal error message if the job failed (null otherwise). */
  readonly error: string | null;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface ImportStoreState {
  /** All known jobs, keyed by job id. */
  jobs: Record<string, ImportJobEntry>;
  /** The most recently started/updated job id, or null. */
  activeJobId: string | null;

  // --- Actions (called by the controller) --------------------------------

  /**
   * Insert or update a job's progress snapshots. Sets `activeJobId` to this job
   * and clears any previous terminal result/error when a NEW job starts.
   */
  upsertJobProgress: (
    jobId: string,
    progress: ImportJobProgress,
    legacy: LegacyImportProgress,
  ) => void;

  /** Record a job's successful result (terminal). */
  setJobResult: (jobId: string, result: ImportJobResult) => void;

  /** Record a job's fatal error (terminal). */
  setJobError: (jobId: string, error: string) => void;

  /** Remove a job from the store (after its summary has been consumed). */
  dismissJob: (jobId: string) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useImportStore = create<ImportStoreState>()(
  devtools(
    (set) => ({
      jobs: {},
      activeJobId: null,

      upsertJobProgress: (jobId, progress, legacy) =>
        set(
          (state) => {
            const existing = state.jobs[jobId];
            return {
              jobs: {
                ...state.jobs,
                [jobId]: {
                  progress,
                  legacy,
                  // Preserve any already-recorded terminal result/error; a fresh
                  // job has none.
                  result: existing?.result ?? null,
                  error: existing?.error ?? null,
                },
              },
              activeJobId: jobId,
            };
          },
          undefined,
          'upsertJobProgress',
        ),

      setJobResult: (jobId, result) =>
        set(
          (state) => {
            const existing = state.jobs[jobId];
            if (!existing) return state;
            return {
              jobs: {
                ...state.jobs,
                [jobId]: { ...existing, result, error: null },
              },
            };
          },
          undefined,
          'setJobResult',
        ),

      setJobError: (jobId, error) =>
        set(
          (state) => {
            const existing = state.jobs[jobId];
            if (!existing) return state;
            return {
              jobs: {
                ...state.jobs,
                [jobId]: { ...existing, error },
              },
            };
          },
          undefined,
          'setJobError',
        ),

      dismissJob: (jobId) =>
        set(
          (state) => {
            if (!(jobId in state.jobs)) return state;
            // Rebuild without the dismissed key (avoids `delete` on a computed key).
            const next = Object.fromEntries(
              Object.entries(state.jobs).filter(([id]) => id !== jobId),
            );
            return {
              jobs: next,
              activeJobId: state.activeJobId === jobId ? null : state.activeJobId,
            };
          },
          undefined,
          'dismissJob',
        ),
    }),
    { name: 'ImportStore', enabled: import.meta.env.DEV },
  ),
);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** The currently active job entry, or null. */
export function selectActiveJob(state: ImportStoreState): ImportJobEntry | null {
  return state.activeJobId ? (state.jobs[state.activeJobId] ?? null) : null;
}

/** The active job's unified progress, or null. */
export function selectActiveJobProgress(state: ImportStoreState): ImportJobProgress | null {
  return selectActiveJob(state)?.progress ?? null;
}

/** The most recent job of a given kind, or null. */
export function selectLatestJobOfKind(
  state: ImportStoreState,
  kind: 'cpap' | 'fitbit',
): ImportJobEntry | null {
  // The active job is the freshest; fall back to scanning if it is a different
  // kind (e.g. a cpap job is active while a fitbit job is being read).
  const active = selectActiveJob(state);
  if (active && active.progress.kind === kind) return active;
  let latest: ImportJobEntry | null = null;
  for (const entry of Object.values(state.jobs)) {
    if (entry.progress.kind !== kind) continue;
    if (!latest || entry.progress.startedAtMs >= latest.progress.startedAtMs) {
      latest = entry;
    }
  }
  return latest;
}

/** Whether ANY import job is currently in a non-terminal (active) state. */
export function selectIsAnyImportActive(state: ImportStoreState): boolean {
  for (const entry of Object.values(state.jobs)) {
    const s = entry.progress.status;
    if (s === 'scanning' || s === 'running') return true;
  }
  return false;
}
