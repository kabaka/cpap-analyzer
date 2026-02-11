/**
 * Singleton accessor for the IndexedDB service.
 *
 * Ensures only one database connection is opened across the application,
 * avoiding redundant connections and transaction conflicts.
 *
 * @module services/storage/getDB
 */

import { IndexedDBService } from './IndexedDBService';

let instance: IndexedDBService | null = null;
let openPromise: Promise<IndexedDBService> | null = null;

/**
 * Return the shared IndexedDBService instance, opening the database
 * on the first call. Subsequent calls return the same instance.
 */
export async function getDB(): Promise<IndexedDBService> {
  if (instance) return instance;

  // Avoid racing multiple callers that arrive before the first open resolves.
  if (!openPromise) {
    openPromise = (async () => {
      const db = new IndexedDBService();
      await db.open();
      instance = db;
      return db;
    })();
  }

  return openPromise;
}

/**
 * Reset the singleton (for testing only).
 * @internal
 */
export function resetDB(): void {
  if (instance) {
    instance.close();
  }
  instance = null;
  openPromise = null;
}
