/**
 * Request-sequencing tests for useDataStore.
 *
 * These verify that when two `loadSessions` (or `loadSummaryStats`) calls are
 * in flight and the EARLIER one resolves AFTER the later one, the stale earlier
 * result does not overwrite the newer state.
 *
 * `getDB` is fully mocked here so we can control resolution order precisely,
 * which is why this lives in its own file (vi.mock is hoisted per-module).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Yield several times so chained microtasks (awaits) settle. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

/** A manually-resolvable deferred. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface SessionRow {
  id: string;
  date: string;
  machineModel: string;
  durationMinutes: number;
  usageMinutes: number;
}

// Queues of deferreds that the mock DB pulls from, FIFO, per call.
const sessionsQueue: Array<ReturnType<typeof deferred<SessionRow[]>>> = [];
const aggregatesQueue: Array<ReturnType<typeof deferred<unknown[]>>> = [];

const fakeDB = {
  getSessionsByDateRange: vi.fn(() => {
    const d = deferred<SessionRow[]>();
    sessionsQueue.push(d);
    return d.promise;
  }),
  getNightlyAggregatesByDateRange: vi.fn(() => {
    const d = deferred<unknown[]>();
    aggregatesQueue.push(d);
    return d.promise;
  }),
};

vi.mock('@/services/storage/getDB', () => ({
  getDB: vi.fn(() => Promise.resolve(fakeDB)),
}));

// Imported after the mock is registered.
const { useDataStore } = await import('@/stores/useDataStore');

function makeSession(id: string, date: string): SessionRow {
  return {
    id,
    date,
    machineModel: 'AirSense 11',
    durationMinutes: 480,
    usageMinutes: 420,
  };
}

beforeEach(() => {
  sessionsQueue.length = 0;
  aggregatesQueue.length = 0;
  fakeDB.getSessionsByDateRange.mockClear();
  fakeDB.getNightlyAggregatesByDateRange.mockClear();
  useDataStore.getState().clearCache();
});

describe('useDataStore request sequencing', () => {
  it('loadSessions: a stale earlier response does not overwrite the newer one', async () => {
    const oldRange = { start: new Date(2025, 0, 1), end: new Date(2025, 0, 30) };
    const newRange = { start: new Date(2025, 1, 1), end: new Date(2025, 1, 28) };

    // Fire the old (slow) request, then the new (fast) request.
    const oldPromise = useDataStore.getState().loadSessions(oldRange);
    const newPromise = useDataStore.getState().loadSessions(newRange);

    // Both actions `await getDB()` first; let those microtasks settle so the
    // getSessionsByDateRange calls (and their deferreds) have been created.
    await flushMicrotasks();

    // Queue order: [old.sessions, new.sessions]; aggregates follow once
    // sessions resolve. Resolve the NEW request first (out of order).
    const oldSessionsDeferred = sessionsQueue[0];
    const newSessionsDeferred = sessionsQueue[1];
    expect(oldSessionsDeferred).toBeDefined();
    expect(newSessionsDeferred).toBeDefined();

    newSessionsDeferred?.resolve([makeSession('new-1', '2025-02-10')]);
    // Allow the new request to proceed to its aggregates await.
    await flushMicrotasks();
    // Resolve the new aggregates (next in the aggregates queue).
    aggregatesQueue[0]?.resolve([]);
    await newPromise;

    // The newer result is committed.
    expect(useDataStore.getState().sessions.has('new-1')).toBe(true);
    expect(useDataStore.getState().sessionsRange).toEqual(newRange);

    // Now the OLD request finally resolves (stale).
    oldSessionsDeferred?.resolve([makeSession('old-1', '2025-01-15')]);
    await flushMicrotasks();
    aggregatesQueue[1]?.resolve([]);
    await oldPromise;

    // Stale result must NOT have overwritten the newer state.
    expect(useDataStore.getState().sessions.has('old-1')).toBe(false);
    expect(useDataStore.getState().sessions.has('new-1')).toBe(true);
    expect(useDataStore.getState().sessionsRange).toEqual(newRange);
    expect(useDataStore.getState().sessionsLoading).toBe(false);
  });

  it('loadSummaryStats: a stale earlier response does not overwrite the newer one', async () => {
    const oldRange = { start: new Date(2025, 0, 1), end: new Date(2025, 0, 30) };
    const newRange = { start: new Date(2025, 1, 1), end: new Date(2025, 1, 28) };

    const oldPromise = useDataStore.getState().loadSummaryStats(oldRange);
    const newPromise = useDataStore.getState().loadSummaryStats(newRange);

    // Let both `await getDB()` microtasks settle so the aggregates calls exist.
    await flushMicrotasks();

    // summaryStats only awaits aggregates. Queue order: [old, new].
    const oldAgg = aggregatesQueue[0];
    const newAgg = aggregatesQueue[1];
    expect(oldAgg).toBeDefined();
    expect(newAgg).toBeDefined();

    // Resolve NEW first (out of order) with a recognizable count.
    newAgg?.resolve([
      { ahi: 2, leakMedian: 5, usageHours: 7, complianceStatus: 'compliant' },
      { ahi: 4, leakMedian: 6, usageHours: 8, complianceStatus: 'compliant' },
    ]);
    await newPromise;

    expect(useDataStore.getState().summaryStats?.stats.totalSessions).toBe(2);
    expect(useDataStore.getState().summaryStats?.range).toEqual(newRange);

    // Old resolves late with a different count.
    oldAgg?.resolve([{ ahi: 9, leakMedian: 1, usageHours: 3, complianceStatus: 'non-compliant' }]);
    await oldPromise;

    // Stale result discarded.
    expect(useDataStore.getState().summaryStats?.stats.totalSessions).toBe(2);
    expect(useDataStore.getState().summaryStats?.range).toEqual(newRange);
    expect(useDataStore.getState().summaryStatsLoading).toBe(false);
  });
});
