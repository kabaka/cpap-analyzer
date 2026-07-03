/**
 * useExplorerEvents loading-strategy tests.
 *
 * Locks in the two branches of the Explorer's event loader:
 *
 * - **Session-scoped** (`sessionIds` non-null/non-empty): events load by
 *   resolving each id DIRECTLY (`getSession` + `getEventsBySessionId`), ignoring
 *   the global date range — so a session OUTSIDE the current range still loads.
 * - **Unscoped** (`sessionIds` null): events load via the date-range path
 *   (`getSessionsByDateRange`).
 *
 * Both paths must populate the `sessionStartTimes` map (sessionId → ISO start)
 * so the table can render wall-clock times.
 *
 * `getDB` is mocked the same way as the sibling EventExplorer view test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAppStore } from '@/stores/useAppStore';
import type { Event } from '@/types/events';
import type { Session } from '@/types/session';

const mockGetDB = vi.fn();
vi.mock('@/services/storage/getDB', () => ({
  getDB: () => mockGetDB(),
}));

import { useExplorerEvents } from '../useExplorerEvents';

let id = 0;
function makeEvent(overrides: Partial<Event> = {}): Event {
  id += 1;
  return {
    id: `evt-${id}`,
    sessionId: 'sess-1',
    type: 'ObstructiveApnea',
    timestamp: Date.UTC(2025, 2, 15, 2, 0, 0),
    duration: 25,
    severity: null,
    pressure: 10,
    epap: null,
    ipap: null,
    leak: 5,
    spo2: null,
    clusterId: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  // Only the fields the hook reads (`id`, `startTime`) need to be realistic;
  // the rest are filled minimally to satisfy the type.
  return {
    id: 'sess-1',
    startTime: '2025-03-15T02:00:00.000Z',
    ...overrides,
  } as Session;
}

/**
 * Wire up a mock DB and return spies so each test can assert which loading
 * path the hook took.
 */
function setupDb(opts: {
  sessions?: Session[];
  rangeSessions?: Session[];
  eventsBySession: Record<string, Event[]>;
}) {
  const getSession = vi.fn(async (sid: string) => {
    return opts.sessions?.find((s) => s.id === sid) ?? null;
  });
  const getSessionsByDateRange = vi.fn(async () => opts.rangeSessions ?? []);
  const getEventsBySessionId = vi.fn(async (sid: string) => opts.eventsBySession[sid] ?? []);

  mockGetDB.mockResolvedValue({
    getSession,
    getSessionsByDateRange,
    getEventsBySessionId,
  });

  return { getSession, getSessionsByDateRange, getEventsBySessionId };
}

describe('useExplorerEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    id = 0;
    useAppStore.setState({
      dateRange: { start: new Date('2025-01-01'), end: new Date('2025-06-01') },
    });
  });

  describe('session-scoped loading', () => {
    it('resolves a scoped id directly and ignores the date-range path', async () => {
      // The scoped session deliberately starts OUTSIDE the global date range
      // (2024), proving the date range is bypassed.
      const session = makeSession({ id: 'sess-X', startTime: '2024-09-01T23:30:00.000Z' });
      const scopedEvents = [makeEvent({ sessionId: 'sess-X' }), makeEvent({ sessionId: 'sess-X' })];
      const spies = setupDb({
        sessions: [session],
        eventsBySession: { 'sess-X': scopedEvents },
      });

      const { result } = renderHook(() => useExplorerEvents(new Set(['sess-X'])));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(spies.getSession).toHaveBeenCalledWith('sess-X');
      expect(spies.getEventsBySessionId).toHaveBeenCalledWith('sess-X');
      // The unscoped date-range path must NOT have been used.
      expect(spies.getSessionsByDateRange).not.toHaveBeenCalled();

      expect(result.current.events).toHaveLength(2);
      expect(result.current.sessionStartTimes.get('sess-X')).toBe('2024-09-01T23:30:00.000Z');
      expect(result.current.error).toBeNull();
    });

    it('skips ids that resolve to no session without erroring', async () => {
      const spies = setupDb({
        sessions: [], // every getSession returns null
        eventsBySession: {},
      });

      const { result } = renderHook(() => useExplorerEvents(new Set(['missing'])));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(spies.getSession).toHaveBeenCalledWith('missing');
      // No session ⇒ never read its events, never touched the date-range path.
      expect(spies.getEventsBySessionId).not.toHaveBeenCalled();
      expect(spies.getSessionsByDateRange).not.toHaveBeenCalled();
      expect(result.current.events).toHaveLength(0);
      expect(result.current.sessionStartTimes.size).toBe(0);
      expect(result.current.error).toBeNull();
    });
  });

  describe('unscoped loading', () => {
    it('loads via the date-range path when the scope is null', async () => {
      const session = makeSession({ id: 'sess-1', startTime: '2025-03-15T02:00:00.000Z' });
      const events = [makeEvent({ sessionId: 'sess-1' })];
      const spies = setupDb({
        rangeSessions: [session],
        eventsBySession: { 'sess-1': events },
      });

      const { result } = renderHook(() => useExplorerEvents(null));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(spies.getSessionsByDateRange).toHaveBeenCalledTimes(1);
      // The direct-by-id path must NOT have been used.
      expect(spies.getSession).not.toHaveBeenCalled();
      expect(spies.getEventsBySessionId).toHaveBeenCalledWith('sess-1');

      expect(result.current.events).toHaveLength(1);
      expect(result.current.sessionStartTimes.get('sess-1')).toBe('2025-03-15T02:00:00.000Z');
    });

    it('treats an empty scope set like null (date-range path)', async () => {
      const spies = setupDb({
        rangeSessions: [makeSession()],
        eventsBySession: { 'sess-1': [makeEvent()] },
      });

      const { result } = renderHook(() => useExplorerEvents(new Set<string>()));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(spies.getSessionsByDateRange).toHaveBeenCalledTimes(1);
      expect(spies.getSession).not.toHaveBeenCalled();
      expect(result.current.sessionStartTimes.get('sess-1')).toBe('2025-03-15T02:00:00.000Z');
    });
  });

  it('surfaces an error message when loading fails', async () => {
    mockGetDB.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useExplorerEvents(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.events).toHaveLength(0);
  });
});
