import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MigrationService,
  MigrationError,
  MIGRATION_001_INITIAL_SCHEMA,
  MIGRATION_002_NONUNIQUE_MACHINE_DATE,
} from '@/services/storage/MigrationService';
import type {
  Migration,
  MigrationContext,
  MigrationVerificationResult,
  MigrationProgressReporter,
} from '@/services/storage/MigrationService';
import { IndexedDBService } from '@/services/storage/IndexedDBService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMigration(version: number, overrides: Partial<Migration> = {}): Migration {
  return {
    version,
    description: `Migration v${version}`,
    estimatedDurationMs: 50,
    dependencies: [],
    up: vi.fn(async () => {}),
    down: vi.fn(async () => {}),
    verify: vi.fn(
      async (): Promise<MigrationVerificationResult> => ({
        success: true,
        errors: [],
        warnings: [],
      }),
    ),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MigrationService', () => {
  let service: MigrationService;
  let idb: IndexedDBService;

  beforeEach(async () => {
    service = new MigrationService();
    idb = new IndexedDBService(`mig-test-${crypto.randomUUID()}`);
    await idb.open();
  });

  afterEach(async () => {
    await idb.destroy();
  });

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  describe('registration', () => {
    it('should register a migration', () => {
      const m = makeMigration(1);
      service.register(m);
      expect(service.getRegistered()).toHaveLength(1);
    });

    it('should reject duplicate migration versions', () => {
      service.register(makeMigration(1));
      expect(() => service.register(makeMigration(1))).toThrow(MigrationError);
    });

    it('should register multiple migrations at once', () => {
      service.registerAll([makeMigration(1), makeMigration(2), makeMigration(3)]);
      expect(service.getRegistered()).toHaveLength(3);
    });

    it('should sort registered migrations by version', () => {
      service.register(makeMigration(3));
      service.register(makeMigration(1));
      service.register(makeMigration(2));
      const registered = service.getRegistered();
      expect(registered.map((m) => m.version)).toEqual([1, 2, 3]);
    });
  });

  // -----------------------------------------------------------------------
  // Version detection
  // -----------------------------------------------------------------------

  describe('version detection', () => {
    it('should return 0 for a fresh database', async () => {
      const raw = (idb as unknown as { db: IDBDatabase }).db;
      const version = await service.getCurrentVersion(raw);
      expect(version).toBe(0);
    });

    it('should return the version after a migration run', async () => {
      service.register(makeMigration(1));
      const raw = (idb as unknown as { db: IDBDatabase }).db;
      await service.run(raw, 1);
      const version = await service.getCurrentVersion(raw);
      expect(version).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Execution
  // -----------------------------------------------------------------------

  describe('execution', () => {
    it('should call the up function of each migration', async () => {
      const m1 = makeMigration(1);
      const m2 = makeMigration(2);
      service.registerAll([m1, m2]);
      const raw = (idb as unknown as { db: IDBDatabase }).db;
      await service.run(raw, 2);

      expect(m1.up).toHaveBeenCalledTimes(1);
      expect(m2.up).toHaveBeenCalledTimes(1);
    });

    it('should call verify after each migration', async () => {
      const m1 = makeMigration(1);
      service.register(m1);
      const raw = (idb as unknown as { db: IDBDatabase }).db;
      await service.run(raw, 1);

      expect(m1.verify).toHaveBeenCalledTimes(1);
    });

    it('should update schema version after successful migration', async () => {
      service.register(makeMigration(1));
      service.register(makeMigration(2));
      const raw = (idb as unknown as { db: IDBDatabase }).db;
      await service.run(raw, 2);

      const version = await service.getCurrentVersion(raw);
      expect(version).toBe(2);
    });

    it('should return correct MigrationRunResult', async () => {
      service.register(makeMigration(1));
      service.register(makeMigration(2));
      const raw = (idb as unknown as { db: IDBDatabase }).db;
      const result = await service.run(raw, 2);

      expect(result.fromVersion).toBe(0);
      expect(result.toVersion).toBe(2);
      expect(result.migrationsRun).toBe(2);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Skip if at target
  // -----------------------------------------------------------------------

  describe('skip when at target version', () => {
    it('should return immediately with 0 migrations run', async () => {
      service.register(makeMigration(1));
      const raw = (idb as unknown as { db: IDBDatabase }).db;
      await service.run(raw, 1);

      const result = await service.run(raw, 1);
      expect(result.migrationsRun).toBe(0);
      expect(result.durationMs).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Failed migration handling
  // -----------------------------------------------------------------------

  describe('failed migration handling', () => {
    it('should attempt rollback on up failure', async () => {
      const failing = makeMigration(1, {
        up: vi.fn(async () => {
          throw new Error('boom');
        }),
      });
      service.register(failing);
      const raw = (idb as unknown as { db: IDBDatabase }).db;

      await expect(service.run(raw, 1)).rejects.toThrow(MigrationError);
      expect(failing.down).toHaveBeenCalledTimes(1);
    });

    it('should attempt rollback on verification failure', async () => {
      const badVerify = makeMigration(1, {
        verify: vi.fn(
          async (): Promise<MigrationVerificationResult> => ({
            success: false,
            errors: ['Store missing'],
            warnings: [],
          }),
        ),
      });
      service.register(badVerify);
      const raw = (idb as unknown as { db: IDBDatabase }).db;

      await expect(service.run(raw, 1)).rejects.toThrow(MigrationError);
      expect(badVerify.down).toHaveBeenCalledTimes(1);
    });

    it('should throw MigrationError when current version > target', async () => {
      service.register(makeMigration(1));
      service.register(makeMigration(2));
      const raw = (idb as unknown as { db: IDBDatabase }).db;
      await service.run(raw, 2);

      await expect(service.run(raw, 1)).rejects.toThrow(/newer than target/);
    });
  });

  // -----------------------------------------------------------------------
  // AbortSignal cancellation
  // -----------------------------------------------------------------------

  describe('AbortSignal cancellation', () => {
    it('should abort when signal is already aborted', async () => {
      service.register(makeMigration(1));
      const raw = (idb as unknown as { db: IDBDatabase }).db;
      const controller = new AbortController();
      controller.abort();

      await expect(service.run(raw, 1, { signal: controller.signal })).rejects.toThrow(
        MigrationError,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Built-in MIGRATION_001
  // -----------------------------------------------------------------------

  describe('MIGRATION_001_INITIAL_SCHEMA', () => {
    it('should have version 1 with no dependencies', () => {
      expect(MIGRATION_001_INITIAL_SCHEMA.version).toBe(1);
      expect(MIGRATION_001_INITIAL_SCHEMA.dependencies).toEqual([]);
    });

    it('should verify that all 7 stores exist', async () => {
      const raw = (idb as unknown as { db: IDBDatabase }).db;
      const context: MigrationContext = {
        db: raw,
        opfsRoot: null,
        progress: { setTotal: vi.fn(), setProgress: vi.fn(), setMessage: vi.fn() },
        signal: new AbortController().signal,
        storage: new Map(),
      };

      const result = await MIGRATION_001_INITIAL_SCHEMA.verify(context);
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Built-in MIGRATION_002
  // -----------------------------------------------------------------------

  describe('MIGRATION_002_NONUNIQUE_MACHINE_DATE', () => {
    it('should have version 2 depending on version 1', () => {
      expect(MIGRATION_002_NONUNIQUE_MACHINE_DATE.version).toBe(2);
      expect(MIGRATION_002_NONUNIQUE_MACHINE_DATE.dependencies).toEqual([1]);
    });

    it('should verify the machineId_date indexes are non-unique', async () => {
      // `idb` is opened by IndexedDBService at the current DB_VERSION (>= 2),
      // so its machineId_date indexes are already non-unique.
      const raw = (idb as unknown as { db: IDBDatabase }).db;
      const context: MigrationContext = {
        db: raw,
        opfsRoot: null,
        progress: { setTotal: vi.fn(), setProgress: vi.fn(), setMessage: vi.fn() },
        signal: new AbortController().signal,
        storage: new Map(),
      };

      const result = await MIGRATION_002_NONUNIQUE_MACHINE_DATE.verify(context);
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Progress reporting
  // -----------------------------------------------------------------------

  describe('progress reporting', () => {
    it('should report progress during migration run', async () => {
      const progress: MigrationProgressReporter = {
        setTotal: vi.fn(),
        setProgress: vi.fn(),
        setMessage: vi.fn(),
      };
      service.register(makeMigration(1));
      service.register(makeMigration(2));
      const raw = (idb as unknown as { db: IDBDatabase }).db;

      await service.run(raw, 2, { progress });

      expect(progress.setTotal).toHaveBeenCalledWith(2);
      expect(progress.setProgress).toHaveBeenCalledWith(1);
      expect(progress.setProgress).toHaveBeenCalledWith(2);
      expect(progress.setMessage).toHaveBeenCalled();
    });
  });
});
