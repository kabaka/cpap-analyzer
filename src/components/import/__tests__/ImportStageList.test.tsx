import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';

import { ImportStageList } from '../ImportStageList';
import { jobProgress, stage, subItem } from './fixtures';

describe('ImportStageList', () => {
  it('renders every stage from t=0 with a status word (not colour alone)', () => {
    const progress = jobProgress({
      kind: 'cpap',
      activeStageId: 'parse',
      stages: [
        stage({ id: 'scan', label: 'Scanning files', state: 'done' }),
        stage({
          id: 'parse',
          label: 'Parsing files',
          state: 'active',
          determinate: true,
          completed: 3,
          total: 10,
        }),
        stage({ id: 'build', label: 'Building days', state: 'pending' }),
        stage({ id: 'store', label: 'Storing sessions', state: 'pending' }),
      ],
    });
    render(<ImportStageList progress={progress} />);

    expect(screen.getByText('Scanning files')).toBeInTheDocument();
    expect(screen.getByText('Parsing files')).toBeInTheDocument();
    expect(screen.getByText('Building days')).toBeInTheDocument();
    expect(screen.getByText('Storing sessions')).toBeInTheDocument();

    // Status words convey state without colour.
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getAllByText('Pending')).toHaveLength(2);
  });

  it('shows "{done} of {total}" + percent for a determinate active stage', () => {
    const progress = jobProgress({
      activeStageId: 'parse',
      stages: [
        stage({
          id: 'parse',
          label: 'Parsing files',
          state: 'active',
          determinate: true,
          completed: 1234,
          total: 5000,
          unit: 'files',
        }),
      ],
    });
    render(<ImportStageList progress={progress} />);
    // Locale-formatted counts.
    expect(screen.getByText('1,234 of 5,000 files')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();

    // Determinate active stage exposes a progressbar with aria-valuenow.
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('1234');
    expect(bar.getAttribute('aria-valuemax')).toBe('5000');
  });

  it('renders an indeterminate bar with "{n} found" and NO aria-valuenow', () => {
    const progress = jobProgress({
      activeStageId: 'scan',
      stages: [
        stage({
          id: 'scan',
          label: 'Scanning files',
          state: 'active',
          determinate: false,
          completed: 42,
          total: null,
          unit: 'files',
        }),
      ],
    });
    render(<ImportStageList progress={progress} />);
    expect(screen.getByText('42 files found')).toBeInTheDocument();
    // No fabricated 0% / denominator.
    expect(screen.queryByText('0%')).not.toBeInTheDocument();

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
  });

  it('renders nested substages, collapsible, auto-expanded on error', () => {
    const progress = jobProgress({
      kind: 'fitbit',
      activeStageId: 'import',
      stages: [
        stage({ id: 'scan', state: 'done' }),
        stage({
          id: 'import',
          label: 'Importing records',
          state: 'active',
          determinate: true,
          completed: 5,
          total: 10,
          subItems: [
            subItem({ id: 'hr', label: 'Heart rate', state: 'done', completed: 1, total: 1 }),
            subItem({ id: 'sleep', label: 'Sleep', state: 'error', completed: 0, total: 1 }),
          ],
        }),
      ],
    });
    render(<ImportStageList progress={progress} />);

    // An error in a sub-item auto-expands the list, so both labels are visible.
    expect(screen.getByText('Heart rate')).toBeInTheDocument();
    expect(screen.getByText('Sleep')).toBeInTheDocument();

    // The disclosure can collapse the list.
    const toggle = screen.getByRole('button', { name: /data types/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Heart rate')).not.toBeInTheDocument();
  });

  it('shows throughput/ETA on the active stage when present, hides ETA when null', () => {
    const progress = jobProgress({
      activeStageId: 'parse',
      throughputPerSec: 48_000,
      etaMs: 40_000,
      stages: [
        stage({
          id: 'parse',
          label: 'Parsing files',
          state: 'active',
          determinate: true,
          completed: 1,
          total: 10,
          unit: 'records',
        }),
      ],
    });
    const { rerender } = render(<ImportStageList progress={progress} />);
    expect(screen.getByText('~48k records/s')).toBeInTheDocument();
    expect(screen.getByText('~40s left')).toBeInTheDocument();

    rerender(<ImportStageList progress={{ ...progress, etaMs: null }} />);
    expect(screen.queryByText(/left/)).not.toBeInTheDocument();
  });

  it('marks an error stage with the failed word', () => {
    const progress = jobProgress({
      stages: [stage({ id: 'parse', label: 'Parsing files', state: 'error' })],
    });
    render(<ImportStageList progress={progress} />);
    const list = screen.getByRole('list');
    expect(within(list).getByText('Failed')).toBeInTheDocument();
  });
});
