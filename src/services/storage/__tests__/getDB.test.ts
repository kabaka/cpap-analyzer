import { describe, it, expect, beforeEach } from 'vitest';
import { getDB, resetDB } from '@/services/storage/getDB';

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
});
