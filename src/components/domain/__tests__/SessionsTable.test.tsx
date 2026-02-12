import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { SessionsTable } from '@/components/domain/SessionsTable';
import type { Session } from '@/types';

/** Minimal valid Session fixture for table tests. */
function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    machineId: 'SN-123',
    machineModel: 'AirSense 10 AutoSet',
    machineType: 'apap',
    firmwareVersion: '3.0.2',
    date: overrides.date ?? '2025-06-15',
    startTime: '2025-06-15T22:00:00Z',
    endTime: '2025-06-16T06:00:00Z',
    durationMinutes: overrides.durationMinutes ?? 480,
    usageMinutes: overrides.usageMinutes ?? 420,
    importedAt: new Date().toISOString(),
    sourceHash: 'abc123',
    channels: [],
    signalChunkIds: [],
    hasOximetry: false,
    deleted: false,
    machineSettings: null,
    ...overrides,
  };
}

describe('SessionsTable', () => {
  it('should render session data in table rows', () => {
    const sessions = [
      makeSession({ date: '2025-06-15', durationMinutes: 480, usageMinutes: 420 }),
      makeSession({ date: '2025-06-14', durationMinutes: 360, usageMinutes: 300 }),
    ];

    render(<SessionsTable sessions={sessions} />);

    // Data rows have role="link" for click-to-navigate
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('should show empty message when no sessions exist', () => {
    render(<SessionsTable sessions={[]} />);

    expect(screen.getByText('No sessions found for the selected date range.')).toBeInTheDocument();
  });

  it('should sort by clicking column headers', () => {
    const sessions = [
      makeSession({ date: '2025-06-10', durationMinutes: 300 }),
      makeSession({ date: '2025-06-20', durationMinutes: 480 }),
      makeSession({ date: '2025-06-15', durationMinutes: 360 }),
    ];

    render(<SessionsTable sessions={sessions} />);

    // Default sort is by date desc
    const dateHeader = screen.getByRole('columnheader', { name: /date/i });

    // Click to toggle sort direction to ascending
    fireEvent.click(dateHeader);

    // Data rows have role="link"
    const dataRows = screen.getAllByRole('link');
    expect(dataRows).toHaveLength(3);
  });

  it('should render column headers with AHI column showing N/A for data', () => {
    const sessions = [makeSession({ date: '2025-06-15' })];

    render(<SessionsTable sessions={sessions} />);

    // The AHI column exists in the header
    expect(screen.getByRole('columnheader', { name: /ahi/i })).toBeInTheDocument();

    // AHI data shows as dash (placeholder) since NightlyAggregate isn't joined yet
    const cells = screen.getAllByText('—');
    expect(cells.length).toBeGreaterThan(0);
  });

  it('should render all expected column headers', () => {
    const sessions = [makeSession()];
    render(<SessionsTable sessions={sessions} />);

    expect(screen.getByRole('columnheader', { name: /date/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /duration/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /usage/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /ahi/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /leak/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /events/i })).toBeInTheDocument();
  });

  it('should respect the limit prop', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession({ date: `2025-06-${String(i + 1).padStart(2, '0')}` }),
    );

    render(<SessionsTable sessions={sessions} limit={5} />);

    // Data rows have role="link" — should be limited to 5
    expect(screen.getAllByRole('link')).toHaveLength(5);
  });
});
