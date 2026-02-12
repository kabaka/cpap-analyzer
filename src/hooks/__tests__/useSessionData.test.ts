import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSessionData } from '@/hooks/useSessionData';
import { resetDB, getDB } from '@/services/storage/getDB';
import type { Session } from '@/types';

/** Minimal valid Session fixture. */
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
    durationMinutes: 480,
    usageMinutes: 420,
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

describe('useSessionData', () => {
  beforeEach(async () => {
    // Destroy the database to clear data from previous tests, then reset the singleton
    try {
      const db = await getDB();
      await db.destroy();
    } catch {
      // Ignore if DB doesn't exist yet
    }
    resetDB();
  });

  it('should return empty array when no sessions exist', async () => {
    const dateRange = { start: new Date('2025-01-01'), end: new Date('2025-12-31') };
    const { result } = renderHook(() => useSessionData(dateRange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.sessions).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should fetch sessions within the date range from IndexedDB', async () => {
    const db = await getDB();
    const s1 = makeSession({ date: '2025-06-10' });
    const s2 = makeSession({ date: '2025-06-20' });
    const s3 = makeSession({ date: '2025-07-15' }); // outside range
    await db.addSession(s1);
    await db.addSession(s2);
    await db.addSession(s3);

    const dateRange = { start: new Date('2025-06-01'), end: new Date('2025-06-30') };
    const { result } = renderHook(() => useSessionData(dateRange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.sessions).toHaveLength(2);
    // Sorted newest first
    expect(result.current.sessions[0]!.date).toBe('2025-06-20');
    expect(result.current.sessions[1]!.date).toBe('2025-06-10');
    expect(result.current.error).toBeNull();
  });

  it('should re-fetch when the date range changes', async () => {
    const db = await getDB();
    await db.addSession(makeSession({ date: '2025-06-15' }));
    await db.addSession(makeSession({ date: '2025-07-15' }));

    const { result, rerender } = renderHook(({ dateRange }) => useSessionData(dateRange), {
      initialProps: {
        dateRange: { start: new Date('2025-06-01'), end: new Date('2025-06-30') },
      },
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0]!.date).toBe('2025-06-15');

    // Change date range to July
    rerender({
      dateRange: { start: new Date('2025-07-01'), end: new Date('2025-07-31') },
    });

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
      expect(result.current.sessions[0]!.date).toBe('2025-07-15');
    });
  });

  it('should handle errors gracefully', async () => {
    // Mock getDB to throw
    const mockGetDB = vi.spyOn(await import('@/services/storage/getDB'), 'getDB');
    mockGetDB.mockRejectedValueOnce(new Error('DB connection failed'));

    const dateRange = { start: new Date('2025-01-01'), end: new Date('2025-12-31') };
    const { result } = renderHook(() => useSessionData(dateRange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('DB connection failed');
    expect(result.current.sessions).toEqual([]);

    mockGetDB.mockRestore();
  });

  it('should re-fetch when refetch is called', async () => {
    const db = await getDB();
    const dateRange = { start: new Date('2025-06-01'), end: new Date('2025-06-30') };
    const { result } = renderHook(() => useSessionData(dateRange));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.sessions).toHaveLength(0);

    // Add a session while hook is mounted
    await db.addSession(makeSession({ date: '2025-06-15' }));

    // Trigger refetch
    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
    });
  });
});
