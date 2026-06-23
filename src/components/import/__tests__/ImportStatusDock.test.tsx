import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { ImportStatusDock } from '../ImportStatusDock';
import { ImportToastProvider } from '../ImportToastContext';
import { jobProgress, stage } from './fixtures';
import { useImportStore, type ImportJobEntry } from '@/stores/useImportStore';
import { importController } from '@/services/import/ImportController';
import type { ImportJobProgress } from '@/services/import/types';

/** Seed the store with one job entry keyed by its jobId, made active. */
function seedJob(progress: ImportJobProgress, result: ImportJobEntry['result'] = null): void {
  useImportStore.setState({
    jobs: {
      [progress.jobId]: {
        progress,
        legacy: { kind: 'cpap', progress: {} as never },
        result,
        error: null,
      },
    },
    activeJobId:
      progress.status === 'complete' || progress.status === 'error' ? null : progress.jobId,
  });
}

function renderDock(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ImportToastProvider>
        <ImportStatusDock />
      </ImportToastProvider>
    </MemoryRouter>,
  );
}

const runningJob = (): ImportJobProgress =>
  jobProgress({
    jobId: 'job-run',
    status: 'running',
    activeStageId: 'parse',
    itemsTotal: 100,
    itemsProcessed: 30,
    currentLabel: 'Parsing files',
    stages: [
      stage({ id: 'scan', state: 'done' }),
      stage({ id: 'parse', state: 'active', determinate: true, completed: 30, total: 100 }),
      stage({ id: 'build', state: 'pending' }),
      stage({ id: 'store', state: 'pending' }),
    ],
  });

describe('ImportStatusDock', () => {
  beforeEach(() => {
    useImportStore.setState({ jobs: {}, activeJobId: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useImportStore.setState({ jobs: {}, activeJobId: null });
  });

  it('renders nothing when there is no job', () => {
    const { container } = renderDock();
    // Only the toast viewport / portal-less wrapper remains; no dock pill.
    expect(container.querySelector('[aria-expanded]')).toBeNull();
  });

  it('renders a pill with overall percent when a job is active', () => {
    seedJob(runningJob());
    renderDock();
    // scan5 + 0.3*60 = 23% overall.
    expect(screen.getByText('23%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open details/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel cpap import/i })).toBeInTheDocument();
  });

  it('expands into a panel showing the stage list', () => {
    seedJob(runningJob());
    renderDock();
    fireEvent.click(screen.getByRole('button', { name: /open details/i }));
    const region = screen.getByRole('region', { name: /cpap import details/i });
    expect(within(region).getByText('23% complete')).toBeInTheDocument();
    expect(within(region).getByRole('list')).toBeInTheDocument();
  });

  it('confirms cancel via a dialog and calls the controller', () => {
    const cancelSpy = vi.spyOn(importController, 'cancel').mockImplementation(() => undefined);
    seedJob(runningJob());
    renderDock();

    fireEvent.click(screen.getByRole('button', { name: /cancel cpap import/i }));
    // The confirm dialog appears.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Cancel import?')).toBeInTheDocument();
    // Controller is NOT called until confirmed.
    expect(cancelSpy).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: /^cancel import$/i }));
    expect(cancelSpy).toHaveBeenCalledWith('job-run');
  });

  it('shows a terminal success pill and fires a toast when not on the import page', () => {
    const completed = jobProgress({
      jobId: 'job-done',
      status: 'complete',
      currentLabel: 'Import complete',
      startedAtMs: 1_000,
      stages: [stage({ id: 'scan', state: 'done' }), stage({ id: 'parse', state: 'done' })],
    });
    seedJob(completed, { kind: 'cpap', record: {} as never });
    renderDock('/dashboard');

    // The terminal toast title surfaces.
    expect(screen.getByText('CPAP import complete')).toBeInTheDocument();
    // Pill offers Dismiss for a terminal job.
    expect(screen.getByRole('button', { name: /dismiss cpap import/i })).toBeInTheDocument();
  });

  it('suppresses the terminal toast while the user is on the import page', () => {
    const completed = jobProgress({
      jobId: 'job-done2',
      status: 'complete',
      currentLabel: 'Import complete',
      stages: [stage({ id: 'scan', state: 'done' })],
    });
    seedJob(completed, { kind: 'cpap', record: {} as never });
    renderDock('/data/import');
    expect(screen.queryByText('CPAP import complete')).not.toBeInTheDocument();
  });

  it('toasts EACH of two concurrent terminal jobs exactly once (cpap + fitbit)', () => {
    // ADR 0026 allows a CPAP and a Fitbit import to run at once. When BOTH reach
    // a terminal state the dock surfaces only one of them, but each must still
    // raise its own completion toast — the regression the Set-based tracking
    // fixes (a single ref dropped the non-surfaced job's toast).
    const cpapDone = jobProgress({
      jobId: 'cpap-done',
      kind: 'cpap',
      status: 'complete',
      startedAtMs: 1_000,
      stages: [stage({ id: 'scan', state: 'done' })],
    });
    const fitbitDone = jobProgress({
      jobId: 'fitbit-done',
      kind: 'fitbit',
      status: 'complete',
      startedAtMs: 2_000,
      stages: [stage({ id: 'scan', state: 'done' })],
    });

    useImportStore.setState({
      jobs: {
        [cpapDone.jobId]: {
          progress: cpapDone,
          legacy: { kind: 'cpap', progress: {} as never },
          result: { kind: 'cpap', record: {} as never },
          error: null,
        },
        [fitbitDone.jobId]: {
          progress: fitbitDone,
          legacy: { kind: 'fitbit', progress: {} as never },
          result: { kind: 'fitbit', record: {} as never },
          error: null,
        },
      },
      activeJobId: null,
    });

    renderDock('/dashboard');

    // BOTH completion toasts surface, each exactly once.
    expect(screen.getAllByText('CPAP import complete')).toHaveLength(1);
    expect(screen.getAllByText('Fitbit import complete')).toHaveLength(1);
  });

  it('dismisses a terminal job via the controller', () => {
    const dismissSpy = vi.spyOn(importController, 'dismiss').mockImplementation(() => undefined);
    const completed = jobProgress({
      jobId: 'job-done3',
      status: 'complete',
      stages: [stage({ id: 'scan', state: 'done' })],
    });
    seedJob(completed, { kind: 'cpap', record: {} as never });
    renderDock('/data/import');
    fireEvent.click(screen.getByRole('button', { name: /dismiss cpap import/i }));
    expect(dismissSpy).toHaveBeenCalledWith('job-done3');
  });
});
