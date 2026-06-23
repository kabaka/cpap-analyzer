import { describe, it, expect, beforeEach } from 'vitest';
import {
  useImportStore,
  selectActiveJob,
  selectActiveJobProgress,
  selectLatestJobOfKind,
  selectIsAnyImportActive,
  type ImportJobEntry,
} from '@/stores/useImportStore';
import type { ImportJobProgress } from '@/services/import/types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeProgress(overrides: Partial<ImportJobProgress> = {}): ImportJobProgress {
  return {
    jobId: 'job-1',
    kind: 'cpap',
    status: 'running',
    stages: [],
    activeStageId: 'parse',
    startedAtMs: 1000,
    bytesProcessed: 0,
    bytesTotal: null,
    itemsProcessed: 0,
    itemsTotal: null,
    throughputPerSec: null,
    etaMs: null,
    errorCount: 0,
    warningCount: 0,
    recentErrors: [],
    currentLabel: 'Importing…',
    ...overrides,
  };
}

function legacyCpap() {
  return {
    kind: 'cpap' as const,
    progress: {
      status: 'parsing' as const,
      totalFiles: 0,
      filesProcessed: 0,
      currentFileName: '',
      bytesRead: 0,
      totalBytes: 0,
      sessionsCreated: 0,
      errors: [],
      startTime: 0,
      warnings: [],
      currentStage: '',
      dayGroupsProcessed: 0,
      totalDayGroups: 0,
      sessionsValidated: 0,
      sessionsStored: 0,
      totalSessionsToStore: 0,
      filesSkippedEmpty: 0,
    },
  };
}

describe('useImportStore', () => {
  beforeEach(() => {
    useImportStore.setState({ jobs: {}, activeJobId: null });
  });

  describe('upsertJobProgress', () => {
    it('inserts a new job and sets it active', () => {
      useImportStore.getState().upsertJobProgress('job-1', makeProgress(), legacyCpap());
      const state = useImportStore.getState();
      expect(state.activeJobId).toBe('job-1');
      expect(state.jobs['job-1']?.progress.status).toBe('running');
      expect(state.jobs['job-1']?.result).toBeNull();
      expect(state.jobs['job-1']?.error).toBeNull();
    });

    it('updates an existing job while preserving its result', () => {
      const store = useImportStore.getState();
      store.upsertJobProgress('job-1', makeProgress(), legacyCpap());
      store.setJobResult('job-1', {
        kind: 'cpap',
        record: { id: 'rec' } as never,
      });
      // A later progress update must not clobber the recorded result.
      store.upsertJobProgress('job-1', makeProgress({ itemsProcessed: 5 }), legacyCpap());
      const entry = useImportStore.getState().jobs['job-1'];
      expect(entry?.result).not.toBeNull();
      expect(entry?.progress.itemsProcessed).toBe(5);
    });
  });

  describe('setJobResult / setJobError', () => {
    it('records a result and clears any error', () => {
      const store = useImportStore.getState();
      store.upsertJobProgress('job-1', makeProgress(), legacyCpap());
      store.setJobError('job-1', 'boom');
      store.setJobResult('job-1', { kind: 'cpap', record: { id: 'r' } as never });
      const entry = useImportStore.getState().jobs['job-1'];
      expect(entry?.error).toBeNull();
      expect(entry?.result?.kind).toBe('cpap');
    });

    it('is a no-op for an unknown job', () => {
      useImportStore.getState().setJobError('nope', 'err');
      expect(useImportStore.getState().jobs['nope']).toBeUndefined();
    });
  });

  describe('dismissJob', () => {
    it('removes the job and clears activeJobId when it was active', () => {
      const store = useImportStore.getState();
      store.upsertJobProgress('job-1', makeProgress(), legacyCpap());
      store.dismissJob('job-1');
      const state = useImportStore.getState();
      expect(state.jobs['job-1']).toBeUndefined();
      expect(state.activeJobId).toBeNull();
    });
  });

  describe('selectors', () => {
    it('selectActiveJob / selectActiveJobProgress reflect the active job', () => {
      useImportStore.getState().upsertJobProgress('job-1', makeProgress(), legacyCpap());
      const state = useImportStore.getState();
      const active: ImportJobEntry | null = selectActiveJob(state);
      expect(active?.progress.jobId).toBe('job-1');
      expect(selectActiveJobProgress(state)?.jobId).toBe('job-1');
    });

    it('selectLatestJobOfKind picks the freshest job of a kind', () => {
      const store = useImportStore.getState();
      store.upsertJobProgress(
        'cpap-old',
        makeProgress({ jobId: 'cpap-old', startedAtMs: 100 }),
        legacyCpap(),
      );
      store.upsertJobProgress(
        'cpap-new',
        makeProgress({ jobId: 'cpap-new', startedAtMs: 200, status: 'complete' }),
        legacyCpap(),
      );
      const latest = selectLatestJobOfKind(useImportStore.getState(), 'cpap');
      expect(latest?.progress.jobId).toBe('cpap-new');
      // No fitbit job present.
      expect(selectLatestJobOfKind(useImportStore.getState(), 'fitbit')).toBeNull();
    });

    it('selectIsAnyImportActive is true only for non-terminal jobs', () => {
      const store = useImportStore.getState();
      store.upsertJobProgress('job-1', makeProgress({ status: 'complete' }), legacyCpap());
      expect(selectIsAnyImportActive(useImportStore.getState())).toBe(false);
      store.upsertJobProgress('job-2', makeProgress({ status: 'running' }), legacyCpap());
      expect(selectIsAnyImportActive(useImportStore.getState())).toBe(true);
    });
  });
});
