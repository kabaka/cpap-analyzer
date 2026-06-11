import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDB, resetDB } from '@/services/storage/getDB';
import { IndexedDBService } from '@/services/storage/IndexedDBService';

describe('getDB', () => {
  beforeEach(() => {
    resetDB();
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
});
