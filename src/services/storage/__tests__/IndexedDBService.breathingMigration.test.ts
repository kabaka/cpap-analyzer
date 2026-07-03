/**
 * Migration coverage for IndexedDB v3 → v4 — adding the `breathing_detections`
 * per-night PB/CSR detection cache store (ADR 0023, storage spec §3).
 *
 * Verifies:
 *  - the v3→v4 upgrade is additive (creates the store + four indexes, preserves
 *    existing rows from older stores);
 *  - fresh-install (`createSchema`) and upgrade paths converge on an identical
 *    store + index set (storage spec §3.1 "both paths must create the store
 *    identically");
 *  - MIGRATION_004's `verify()` passes when the store is present and fails when
 *    it is absent;
 *  - a full reset (`destroy` → `deleteDatabase`) leaves no store behind (the
 *    reopened DB only has it because the schema recreates it, and it is empty).
 *
 * @module services/storage/__tests__/IndexedDBService.breathingMigration
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IndexedDBService } from '@/services/storage/IndexedDBService';
import {
  MIGRATION_004_BREATHING_DETECTIONS,
  type MigrationContext,
} from '@/services/storage/MigrationService';

const BREATHING_INDEXES = ['sessionId', 'date', 'algoVersion', 'computedAt'] as const;

/**
 * Open a database at version 3 with the pre-v4 schema (every store EXCEPT
 * `breathing_detections`), simulating an existing v3 user's database on disk so
 * the real `migrateV3ToV4` upgrade path can run when reopened at v4.
 */
function openLegacyV3(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 3);
    request.onupgradeneeded = () => {
      const db = request.result;

      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('date', 'date', { unique: false });
      sessions.createIndex('machineId', 'machineId', { unique: false });
      sessions.createIndex('machineId_date', ['machineId', 'date'], { unique: false });

      const aggregates = db.createObjectStore('nightly_aggregates', { keyPath: 'id' });
      aggregates.createIndex('sessionId', 'sessionId', { unique: false });
      aggregates.createIndex('date', 'date', { unique: false });
      aggregates.createIndex('machineId_date', ['machineId', 'date'], { unique: false });

      const events = db.createObjectStore('events', { keyPath: 'id' });
      events.createIndex('sessionId', 'sessionId', { unique: false });
      events.createIndex('sessionId_startTime', ['sessionId', 'timestamp'], { unique: false });
      events.createIndex('type', 'type', { unique: false });

      const analysis = db.createObjectStore('analysis_results', { keyPath: 'id' });
      analysis.createIndex('type', 'analysisType', { unique: false });
      analysis.createIndex('type_dateRangeHash', ['analysisType', 'dateRangeHash'], {
        unique: true,
      });
      analysis.createIndex('computedAt', 'computedAt', { unique: false });

      db.createObjectStore('settings', { keyPath: 'key' });

      const imports = db.createObjectStore('import_history', { keyPath: 'id' });
      imports.createIndex('machineId', 'machineId', { unique: false });
      imports.createIndex('importedAt', 'importedAt', { unique: false });

      const integration = db.createObjectStore('integration_data', { keyPath: 'id' });
      integration.createIndex('source', 'source', { unique: false });
      integration.createIndex('date', 'date', { unique: false });
      integration.createIndex('dataType', 'dataType', { unique: false });
      integration.createIndex('source_dataType_date', ['source', 'dataType', 'date'], {
        unique: true,
      });

      const timeseries = db.createObjectStore('integration_timeseries', { keyPath: 'id' });
      timeseries.createIndex('source_dataType_date', ['source', 'dataType', 'date'], {
        unique: true,
      });
      timeseries.createIndex('date', 'date', { unique: false });
      timeseries.createIndex('dataType', 'dataType', { unique: false });

      const integrationImports = db.createObjectStore('integration_import_history', {
        keyPath: 'id',
      });
      integrationImports.createIndex('source', 'source', { unique: false });
      integrationImports.createIndex('importedAt', 'importedAt', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putRaw(db: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).add(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function makeContext(db: IDBDatabase): MigrationContext {
  return {
    db,
    opfsRoot: null,
    progress: { setTotal: vi.fn(), setProgress: vi.fn(), setMessage: vi.fn() },
    signal: new AbortController().signal,
    storage: new Map(),
  };
}

describe('IndexedDBService v3 -> v4 migration (breathing_detections)', () => {
  it('adds breathing_detections with its four indexes, preserving existing rows', async () => {
    const dbName = `mig-v3v4-${crypto.randomUUID()}`;

    // 1. Seed a v3 database (no breathing_detections store).
    const legacy = await openLegacyV3(dbName);
    expect(Array.from(legacy.objectStoreNames)).not.toContain('breathing_detections');
    const s1 = {
      id: 's1',
      date: '2026-04-01',
      startTime: '2026-04-01T22:00:00.000Z',
      machineId: 'M1',
    };
    await putRaw(legacy, 'sessions', s1);
    legacy.close();

    // 2. Reopen at v4 through IndexedDBService — triggers migrateV3ToV4.
    const svc = new IndexedDBService(dbName, 4);
    await svc.open();
    try {
      const raw = svc.getRawDatabase();
      expect(Array.from(raw.objectStoreNames)).toContain('breathing_detections');

      const tx = raw.transaction('breathing_detections', 'readonly');
      const store = tx.objectStore('breathing_detections');
      expect(store.keyPath).toBe('id');
      for (const idx of BREATHING_INDEXES) {
        expect(store.indexNames.contains(idx)).toBe(true);
      }

      // Additive only: the pre-existing session row is preserved untouched.
      const existing = await svc.getSession('s1');
      expect(existing).not.toBeNull();
      expect(existing?.id).toBe('s1');

      // The new store starts empty.
      expect(await svc.getBreathingDetectionsBySessionId('s1')).toEqual([]);
    } finally {
      await svc.destroy();
    }
  });

  it('fresh-install (createSchema) and v3->v4 upgrade produce an identical store + indexes', async () => {
    // Fresh install: open at the current version directly (createSchema path).
    const fresh = new IndexedDBService(`fresh-${crypto.randomUUID()}`);
    await fresh.open();

    // Upgrade: v3 legacy DB reopened at v4 (migrateV3ToV4 path).
    const upgradeName = `upgrade-${crypto.randomUUID()}`;
    (await openLegacyV3(upgradeName)).close();
    const upgraded = new IndexedDBService(upgradeName, 4);
    await upgraded.open();

    try {
      const readIndexes = (svc: IndexedDBService): string[] => {
        const store = svc
          .getRawDatabase()
          .transaction('breathing_detections', 'readonly')
          .objectStore('breathing_detections');
        return Array.from(store.indexNames).sort();
      };

      const freshStore = fresh
        .getRawDatabase()
        .transaction('breathing_detections', 'readonly')
        .objectStore('breathing_detections');
      const upgradedStore = upgraded
        .getRawDatabase()
        .transaction('breathing_detections', 'readonly')
        .objectStore('breathing_detections');

      expect(readIndexes(fresh)).toEqual(readIndexes(upgraded));
      expect(freshStore.keyPath).toBe(upgradedStore.keyPath);
      // Same expected set on both paths.
      expect(readIndexes(fresh)).toEqual([...BREATHING_INDEXES].sort());
    } finally {
      await fresh.destroy();
      await upgraded.destroy();
    }
  });

  it('full reset (destroy/deleteDatabase) leaves the store empty when reopened', async () => {
    const dbName = `reset-${crypto.randomUUID()}`;
    const svc = new IndexedDBService(dbName);
    await svc.open();
    await svc.putBreathingDetection({
      id: 's::1::h',
      sessionId: 's',
      date: '2026-01-01',
      algoVersion: 1,
      paramHash: 'h',
      episodes: [],
      recordHours: 0,
      sessionCriterionMet: false,
      computedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(await svc.getBreathingDetectionById('s::1::h')).not.toBeNull();

    // Destroy deletes the whole database (including breathing_detections).
    await svc.destroy();

    // Reopening recreates the schema fresh — the row is gone.
    const reopened = new IndexedDBService(dbName);
    await reopened.open();
    try {
      expect(Array.from(reopened.getRawDatabase().objectStoreNames)).toContain(
        'breathing_detections',
      );
      expect(await reopened.getBreathingDetectionById('s::1::h')).toBeNull();
    } finally {
      await reopened.destroy();
    }
  });
});

describe('MIGRATION_004_BREATHING_DETECTIONS', () => {
  let idb: IndexedDBService;

  beforeEach(async () => {
    idb = new IndexedDBService(`mig004-${crypto.randomUUID()}`);
    await idb.open();
  });

  afterEach(async () => {
    await idb.destroy();
  });

  it('is version 4 depending on version 3', () => {
    expect(MIGRATION_004_BREATHING_DETECTIONS.version).toBe(4);
    expect(MIGRATION_004_BREATHING_DETECTIONS.dependencies).toEqual([3]);
  });

  it('verify() succeeds when the store and all indexes are present', async () => {
    const result = await MIGRATION_004_BREATHING_DETECTIONS.verify(
      makeContext(idb.getRawDatabase()),
    );
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('verify() fails with a clear error when the store is absent', async () => {
    // A bare v3-shaped DB without breathing_detections.
    const dbName = `mig004-absent-${crypto.randomUUID()}`;
    const legacy = await openLegacyV3(dbName);
    try {
      const result = await MIGRATION_004_BREATHING_DETECTIONS.verify(makeContext(legacy));
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Missing object store: breathing_detections');
    } finally {
      legacy.close();
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  });
});
