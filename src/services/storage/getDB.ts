/**
 * Singleton accessor for the IndexedDB service.
 *
 * Ensures only one database connection is opened across the application,
 * avoiding redundant connections and transaction conflicts.
 *
 * @module services/storage/getDB
 */

import { IndexedDBService } from './IndexedDBService';
import {
  MigrationService,
  MIGRATION_001_INITIAL_SCHEMA,
  MIGRATION_002_NONUNIQUE_MACHINE_DATE,
  MIGRATION_003_INTEGRATION_STORES,
} from './MigrationService';

/** Current target schema version. Must match `DB_VERSION` in IndexedDBService. */
const TARGET_SCHEMA_VERSION = 3;

let instance: IndexedDBService | null = null;
let openPromise: Promise<IndexedDBService> | null = null;

/**
 * Build a MigrationService with all known migrations registered.
 *
 * The actual schema/index changes are performed by IndexedDBService's
 * `onupgradeneeded` handler (the only place IndexedDB permits them). The
 * MigrationService run that follows maintains the migration ledger
 * (`schema_version` in the settings store) and verifies each version landed
 * correctly, giving us an auditable, ordered history of applied schema versions.
 */
function buildMigrationService(): MigrationService {
  const service = new MigrationService();
  service.registerAll([
    MIGRATION_001_INITIAL_SCHEMA,
    MIGRATION_002_NONUNIQUE_MACHINE_DATE,
    MIGRATION_003_INTEGRATION_STORES,
  ]);
  return service;
}

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
      // Maintain the migration ledger. Schema/index changes already happened in
      // onupgradeneeded; this records the version history and verifies it.
      await buildMigrationService().run(db.getRawDatabase(), TARGET_SCHEMA_VERSION);
      instance = db;
      return db;
    })();

    // If the open/migration fails, clear the cached promise so subsequent
    // calls can retry instead of returning a permanently-rejected promise.
    openPromise.catch(() => {
      openPromise = null;
    });
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
