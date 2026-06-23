import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDB, resetDB } from '@/services/storage/getDB';
import { IndexedDBService } from '@/services/storage/IndexedDBService';
import { requestPersistentStorage } from '@/services/storage/persistentStorage';

// getDB fires requestPersistentStorage() fire-and-forget after open. Mock it so
// these tests never touch a real navigator and the call is observable + inert.
vi.mock('@/services/storage/persistentStorage', () => ({
  requestPersistentStorage: vi.fn().mockResolvedValue('unsupported'),
  isPersistenceApiAvailable: vi.fn().mockReturnValue(false),
  isStoragePersisted: vi.fn().mockResolvedValue(false),
}));

const mockedRequestPersistentStorage = vi.mocked(requestPersistentStorage);

describe('getDB', () => {
  beforeEach(() => {
    resetDB();
    mockedRequestPersistentStorage.mockClear();
  });

  it('should return an IndexedDBService instance', async () => {
    const db = await getDB();
    expect(db).toBeDefined();
    expect(typeof db.addSession).toBe('function');
    expect(typeof db.getSessionsByDateRange).toBe('function');
  });

  it('should return the same instance on multiple calls', async () => {
    const db1 = await getDB();
    const db2 = await getDB();
    expect(db1).toBe(db2);
  });

  it('should return the same instance when called concurrently', async () => {
    const [db1, db2, db3] = await Promise.all([getDB(), getDB(), getDB()]);
    expect(db1).toBe(db2);
    expect(db2).toBe(db3);
  });

  it('should return a new instance after resetDB is called', async () => {
    const db1 = await getDB();
    resetDB();
    const db2 = await getDB();
    expect(db1).not.toBe(db2);
  });

  it('should return an instance that can read/write sessions', async () => {
    const db = await getDB();
    const sessions = await db.getSessionsByDateRange('2025-01-01', '2025-12-31');
    expect(sessions).toEqual([]);
  });

  it('should retry after a failed open attempt', async () => {
    const openError = new Error('IndexedDB open failed');
    const openSpy = vi.spyOn(IndexedDBService.prototype, 'open').mockRejectedValueOnce(openError);

    await expect(getDB()).rejects.toThrow('IndexedDB open failed');

    // The .catch() handler in getDB should have cleared openPromise,
    // so a subsequent call retries with a fresh open attempt without
    // needing resetDB().
    openSpy.mockRestore();
    const db = await getDB();
    expect(db).toBeDefined();
    expect(typeof db.addSession).toBe('function');
  });

  it('should reject all concurrent callers on failure, then allow retry', async () => {
    const openError = new Error('IndexedDB unavailable');
    const openSpy = vi.spyOn(IndexedDBService.prototype, 'open').mockRejectedValueOnce(openError);

    // Three concurrent calls should all see the same rejection.
    const results = await Promise.allSettled([getDB(), getDB(), getDB()]);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toBe(openError);
      }
    }

    // After all rejections settle, the .catch() handler should have cleared
    // the cached promise. A fresh call should succeed without resetDB().
    openSpy.mockRestore();
    const db = await getDB();
    expect(db).toBeDefined();
    expect(typeof db.addSession).toBe('function');
  });

  // -------------------------------------------------------------------------
  // Persistent-storage request (fire-and-forget after open)
  // -------------------------------------------------------------------------

  describe('persistent storage request', () => {
    it('requests persistent storage after a successful open', async () => {
      const db = await getDB();
      // Let the fire-and-forget .then()/.catch() chain settle.
      await Promise.resolve();
      expect(db).toBeDefined();
      expect(mockedRequestPersistentStorage).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Connection-loss recovery + race guard
  //
  // getDB wires onConnectionLost -> handleConnectionLost, which clears the
  // cached instance ONLY if the lost instance is still the current one. The
  // lost connection is simulated by invoking the `onclose` handler that
  // IndexedDBService attaches to the raw db handle in open(). `onclose` (unlike
  // a versionchange bump) leaves the on-disk schema version unchanged, so the
  // next getDB() can reopen at the same target version.
  // -------------------------------------------------------------------------

  describe('connection-loss recovery', () => {
    /** Trigger the implementation's out-of-band loss handler on a live instance. */
    function simulateConnectionLost(instance: IndexedDBService): void {
      const raw = instance.getRawDatabase();
      const onclose = raw.onclose as (() => void) | null;
      if (typeof onclose !== 'function') {
        throw new Error('expected onclose handler to be attached by open()');
      }
      onclose();
    }

    it('reopens a fresh, working connection after a connection loss', async () => {
      const db1 = await getDB();

      simulateConnectionLost(db1);

      const db2 = await getDB();
      // A brand-new instance was opened, not the dead one.
      expect(db2).not.toBe(db1);
      // And it actually works.
      await expect(db2.getSessionsByDateRange('2025-01-01', '2025-12-31')).resolves.toEqual([]);
    });

    it('caches the reopened instance for subsequent calls', async () => {
      const db1 = await getDB();
      simulateConnectionLost(db1);

      const db2 = await getDB();
      const db3 = await getDB();
      expect(db3).toBe(db2);
      expect(db3).not.toBe(db1);
    });

    it('a loss from a stale/superseded instance does NOT clobber the current one', async () => {
      // db1 is current; losing it clears the cache.
      const db1 = await getDB();
      const raw1 = db1.getRawDatabase();
      const stalenLoss1 = raw1.onclose as () => void;
      stalenLoss1(); // db1 was current -> cache cleared

      // db2 becomes the new current instance.
      const db2 = await getDB();
      expect(db2).not.toBe(db1);

      // Now the STALE db1 fires its loss callback again. The race guard
      // (instance === lost) must leave the newer db2 untouched.
      stalenLoss1();

      const db3 = await getDB();
      expect(db3).toBe(db2);
    });
  });
});
