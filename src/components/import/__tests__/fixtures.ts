/**
 * Test fixtures for the import UI: builders for {@link ImportJobProgress} and
 * {@link StageProgress} so tests stay terse and intent-revealing.
 */

import type { ImportJobProgress, StageProgress, SubItemProgress } from '@/services/import/types';

/** Build a stage with sensible defaults. */
export function stage(
  overrides: Partial<StageProgress> & Pick<StageProgress, 'id'>,
): StageProgress {
  return {
    label: overrides.label ?? overrides.id,
    state: 'pending',
    determinate: false,
    completed: 0,
    total: null,
    unit: 'files',
    ...overrides,
  };
}

/** Build a sub-item with sensible defaults. */
export function subItem(
  overrides: Partial<SubItemProgress> & Pick<SubItemProgress, 'id'>,
): SubItemProgress {
  return {
    label: overrides.label ?? overrides.id,
    state: 'pending',
    completed: 0,
    total: null,
    ...overrides,
  };
}

/** Build a job-progress snapshot with sensible defaults. */
export function jobProgress(overrides: Partial<ImportJobProgress> = {}): ImportJobProgress {
  return {
    jobId: 'job-1',
    kind: 'cpap',
    status: 'running',
    stages: [],
    activeStageId: null,
    startedAtMs: 1_000,
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
