/**
 * Schema migration service for the CPAP Analyzer storage layer.
 *
 * Supports versioned forward/rollback migrations with verification,
 * progress reporting, savepoints, and AbortSignal-based cancellation.
 * Migrations run sequentially on app start before any data access.
 *
 * Additional progressive migration strategies:
 * - **Lazy migration**: Migrate-on-access pattern for non-critical changes.
 * - **Background migration**: Worker-based for large data transformations.
 * - **Batch migration**: Checkpoint-based progress tracking with pause/resume.
 *
 * Design principles:
 * - Zero data loss: migrations never delete or corrupt user data.
 * - Fail-safe: failed migrations are detectable and recoverable.
 * - Transparent: progress is reported to the calling layer.
 * - Resumable: long-running migrations support pause/resume via checkpoints.
 */

import { ErrorCategory, ErrorSeverity } from '@/types';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Progress reporter supplied to each migration for UI feedback. */
export interface MigrationProgressReporter {
  /** Set the total number of items to process. */
  setTotal(items: number): void;
  /** Update the number of items processed so far. */
  setProgress(items: number): void;
  /** Update the human-readable status message. */
  setMessage(message: string): void;
}

/** Outcome of a post-migration verification check. */
export interface MigrationVerificationResult {
  readonly success: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** Runtime context passed to each migration's up/down/verify functions. */
export interface MigrationContext {
  /** Active IndexedDB connection. */
  readonly db: IDBDatabase;
  /** OPFS root directory handle (may be null where OPFS is unavailable). */
  readonly opfsRoot: FileSystemDirectoryHandle | null;
  /** Progress reporter for long-running migrations. */
  readonly progress: MigrationProgressReporter;
  /** Cancellation signal — migrations should check `signal.aborted` periodically. */
  readonly signal: AbortSignal;
  /** Shared key-value storage for passing data between consecutive migrations. */
  readonly storage: Map<string, unknown>;
}

/**
 * A single versioned schema migration.
 *
 * Migrations are registered with the MigrationService and run in
 * version order. Each migration must implement up, down, and verify.
 */
export interface Migration {
  /** Target schema version this migration produces. */
  readonly version: number;
  /** Human-readable description of what this migration does. */
  readonly description: string;
  /** Estimated wall-clock time in milliseconds (used for progress bars). */
  readonly estimatedDurationMs: number;
  /** Versions that must have completed before this migration runs. */
  readonly dependencies: readonly number[];
  /** Apply the migration (forward). */
  up(context: MigrationContext): Promise<void>;
  /** Rollback the migration (best-effort). */
  down(context: MigrationContext): Promise<void>;
  /** Verify the migration was applied correctly. */
  verify(context: MigrationContext): Promise<MigrationVerificationResult>;
}

/** Summary of a completed migration run. */
export interface MigrationRunResult {
  /** Schema version before the run. */
  readonly fromVersion: number;
  /** Schema version after the run. */
  readonly toVersion: number;
  /** Number of migrations executed. */
  readonly migrationsRun: number;
  /** Total elapsed time in milliseconds. */
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Savepoint types (design §3.3)
// ---------------------------------------------------------------------------

/** State of a logical savepoint — not a database-level savepoint. */
export type SavepointState = 'pending' | 'committed' | 'rolled-back';

/** A logical savepoint created before each migration for rollback support. */
export interface Savepoint {
  /** Unique savepoint identifier. */
  readonly id: string;
  /** Migration version this savepoint protects. */
  readonly migrationVersion: number;
  /** When the savepoint was created. */
  readonly createdAt: string;
  /** Current state of the savepoint. */
  state: SavepointState;
}

// ---------------------------------------------------------------------------
// Migration checkpoint types (design §3.5.3)
// ---------------------------------------------------------------------------

/** Checkpoint for resumable batch migrations. */
export interface MigrationCheckpoint {
  /** Migration version this checkpoint belongs to. */
  readonly migrationVersion: number;
  /** Last successfully processed item ID, or null if not started. */
  lastProcessedId: string | null;
  /** Number of items processed so far. */
  itemsProcessed: number;
  /** Total number of items to process. */
  itemsTotal: number;
  /** When the migration started. */
  readonly startedAt: string;
  /** Current state of the batch migration. */
  state: 'running' | 'paused' | 'failed' | 'complete';
}

// ---------------------------------------------------------------------------
// Background migration handle (design §3.5.2)
// ---------------------------------------------------------------------------

/** Progress snapshot from a background migration. */
export interface MigrationProgress {
  /** Items processed so far. */
  readonly itemsProcessed: number;
  /** Total items to process. */
  readonly itemsTotal: number;
  /** Percentage complete (0–100). */
  readonly percentComplete: number;
  /** Whether the migration is currently paused. */
  readonly isPaused: boolean;
  /** Human-readable status message. */
  readonly message: string;
}

/**
 * Handle for a migration running in a background Web Worker.
 *
 * This is a framework class — actual worker communication will be wired
 * when background migrations are implemented in a later phase.
 */
export class BackgroundMigrationHandle {
  private _isPaused = false;
  private _isCancelled = false;
  private _progress: MigrationProgress = {
    itemsProcessed: 0,
    itemsTotal: 0,
    percentComplete: 0,
    isPaused: false,
    message: 'Not started',
  };

  constructor(
    /** Migration version being run in the background. */
    readonly migrationVersion: number,
  ) {}

  /** Get the current progress snapshot. */
  async getProgress(): Promise<MigrationProgress> {
    return { ...this._progress };
  }

  /** Update progress (called internally by the migration runner). */
  updateProgress(progress: Partial<MigrationProgress>): void {
    this._progress = { ...this._progress, ...progress };
  }

  /** Pause the background migration. */
  async pause(): Promise<void> {
    this._isPaused = true;
    this._progress = { ...this._progress, isPaused: true, message: 'Paused' };
  }

  /** Resume the background migration. */
  async resume(): Promise<void> {
    this._isPaused = false;
    this._progress = { ...this._progress, isPaused: false, message: 'Running' };
  }

  /** Cancel the background migration. */
  async cancel(): Promise<void> {
    this._isCancelled = true;
    this._progress = { ...this._progress, message: 'Cancelled' };
  }

  /** Whether the migration is currently paused. */
  get isPaused(): boolean {
    return this._isPaused;
  }

  /** Whether the migration has been cancelled. */
  get isCancelled(): boolean {
    return this._isCancelled;
  }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/** Error thrown when a migration fails or an incompatibility is detected. */
export class MigrationError extends Error {
  readonly code: string;
  readonly category: ErrorCategory = ErrorCategory.SYSTEM;
  readonly severity: ErrorSeverity;
  readonly timestamp: Date;
  readonly recoverable: boolean;
  readonly context?: Record<string, unknown>;
  readonly originalCause?: Error;

  constructor(
    code: string,
    message: string,
    options: {
      cause?: unknown;
      recoverable?: boolean;
      severity?: ErrorSeverity;
      context?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.severity = options.severity ?? ErrorSeverity.ERROR;
    this.timestamp = new Date();
    this.recoverable = options.recoverable ?? false;
    this.context = options.context;
    if (options.cause instanceof Error) {
      this.originalCause = options.cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Default progress reporter (no-op)
// ---------------------------------------------------------------------------

const NOOP_PROGRESS: MigrationProgressReporter = {
  setTotal: () => {},
  setProgress: () => {},
  setMessage: () => {},
};

// ---------------------------------------------------------------------------
// MigrationService
// ---------------------------------------------------------------------------

/** Settings store key where the schema version is persisted. */
const SCHEMA_VERSION_KEY = 'schema_version';

export class MigrationService {
  private readonly migrations: Migration[] = [];

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register a migration.
   *
   * Migrations are stored internally and sorted by version on execution.
   * Duplicate versions are rejected.
   *
   * @param migration - The migration to register.
   */
  register(migration: Migration): void {
    if (this.migrations.some((m) => m.version === migration.version)) {
      throw new MigrationError(
        'MIGRATION_DUPLICATE',
        `Migration version ${String(migration.version)} is already registered.`,
        { context: { version: migration.version } },
      );
    }
    this.migrations.push(migration);
  }

  /**
   * Register multiple migrations at once.
   *
   * @param migrations - Migrations to register.
   */
  registerAll(migrations: readonly Migration[]): void {
    for (const m of migrations) {
      this.register(m);
    }
  }

  /** Get all registered migrations, sorted by version. */
  getRegistered(): readonly Migration[] {
    return [...this.migrations].sort((a, b) => a.version - b.version);
  }

  // -----------------------------------------------------------------------
  // Version detection
  // -----------------------------------------------------------------------

  /**
   * Read the current schema version from the settings store.
   *
   * Returns `0` if no version has been recorded yet (fresh database).
   *
   * @param db - An open IDBDatabase connection.
   */
  async getCurrentVersion(db: IDBDatabase): Promise<number> {
    // The settings store may not exist yet (pre-migration)
    if (!db.objectStoreNames.contains('settings')) {
      return 0;
    }

    return new Promise<number>((resolve, reject) => {
      try {
        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const request = store.get(SCHEMA_VERSION_KEY);
        request.onsuccess = () => {
          const record = request.result as { value?: unknown } | undefined;
          const version = record && typeof record.value === 'number' ? record.value : 0;
          resolve(version);
        };
        request.onerror = () => reject(request.error);
      } catch {
        // Transaction creation may fail if the store doesn't exist
        resolve(0);
      }
    });
  }

  // -----------------------------------------------------------------------
  // Savepoint management (design §3.3)
  // -----------------------------------------------------------------------

  /**
   * Create a logical savepoint before a migration.
   *
   * Savepoints are used to track whether a migration completed successfully.
   * On failure, the service can detect that a rollback is needed.
   *
   * @param migrationVersion - Version of the migration about to run.
   * @returns A new Savepoint instance.
   */
  createSavepoint(migrationVersion: number): Savepoint {
    return {
      id: `sp-${String(migrationVersion)}-${Date.now()}`,
      migrationVersion,
      createdAt: new Date().toISOString(),
      state: 'pending',
    };
  }

  /**
   * Mark a savepoint as committed (migration succeeded).
   *
   * @param savepoint - The savepoint to commit.
   */
  commitSavepoint(savepoint: Savepoint): void {
    savepoint.state = 'committed';
  }

  /**
   * Mark a savepoint as rolled back (migration failed).
   *
   * @param savepoint - The savepoint to roll back.
   */
  rollbackSavepoint(savepoint: Savepoint): void {
    savepoint.state = 'rolled-back';
  }

  // -----------------------------------------------------------------------
  // Checkpoint management (design §3.5.3)
  // -----------------------------------------------------------------------

  /**
   * Create an initial checkpoint for a batch migration.
   *
   * @param migrationVersion - Version of the migration.
   * @param itemsTotal       - Total items to process.
   * @returns A new checkpoint.
   */
  createCheckpoint(migrationVersion: number, itemsTotal: number): MigrationCheckpoint {
    return {
      migrationVersion,
      lastProcessedId: null,
      itemsProcessed: 0,
      itemsTotal,
      startedAt: new Date().toISOString(),
      state: 'running',
    };
  }

  /**
   * Update a checkpoint with batch progress.
   *
   * @param checkpoint      - The checkpoint to update.
   * @param lastProcessedId - ID of the last processed item.
   * @param itemsProcessed  - Total items processed so far.
   */
  updateCheckpoint(
    checkpoint: MigrationCheckpoint,
    lastProcessedId: string,
    itemsProcessed: number,
  ): void {
    checkpoint.lastProcessedId = lastProcessedId;
    checkpoint.itemsProcessed = itemsProcessed;
  }

  // -----------------------------------------------------------------------
  // Background migration (design §3.5.2)
  // -----------------------------------------------------------------------

  /**
   * Create a handle for a background migration.
   *
   * This is a framework stub — actual worker spawning will be implemented
   * when background migrations are needed in a later phase.
   *
   * @param migrationVersion - Version of the migration to run.
   * @returns A BackgroundMigrationHandle for status tracking.
   */
  createBackgroundMigrationHandle(migrationVersion: number): BackgroundMigrationHandle {
    return new BackgroundMigrationHandle(migrationVersion);
  }

  // -----------------------------------------------------------------------
  // Execution
  // -----------------------------------------------------------------------

  /**
   * Run all pending migrations to bring the schema to the target version.
   *
   * Each migration is protected by a savepoint. On failure, the migration's
   * `down` function is called and the savepoint is rolled back.
   *
   * @param db              - An open IDBDatabase connection.
   * @param targetVersion   - The desired schema version after migration.
   * @param options         - Optional cancellation signal, progress reporter, and OPFS root.
   * @returns Summary of the migration run.
   */
  async run(
    db: IDBDatabase,
    targetVersion: number,
    options?: {
      signal?: AbortSignal;
      progress?: MigrationProgressReporter;
      opfsRoot?: FileSystemDirectoryHandle | null;
    },
  ): Promise<MigrationRunResult> {
    const currentVersion = await this.getCurrentVersion(db);
    const startTime = Date.now();

    // Already at target — nothing to do
    if (currentVersion === targetVersion) {
      return {
        fromVersion: currentVersion,
        toVersion: targetVersion,
        migrationsRun: 0,
        durationMs: 0,
      };
    }

    // Data is from a newer version — incompatible
    if (currentVersion > targetVersion) {
      throw new MigrationError(
        'MIGRATION_VERSION_INCOMPATIBLE',
        `Schema version ${String(currentVersion)} is newer than target ${String(targetVersion)}. Please update the application.`,
        {
          severity: ErrorSeverity.FATAL,
          context: { currentVersion, targetVersion },
        },
      );
    }

    // Determine which migrations need to run
    const pending = this.getMigrationsToRun(currentVersion, targetVersion);

    if (pending.length === 0) {
      // No migrations registered for this range; just set the version
      await this.setSchemaVersion(db, targetVersion);
      return {
        fromVersion: currentVersion,
        toVersion: targetVersion,
        migrationsRun: 0,
        durationMs: Date.now() - startTime,
      };
    }

    const signal = options?.signal ?? new AbortController().signal;
    const progress = options?.progress ?? NOOP_PROGRESS;
    const opfsRoot = options?.opfsRoot ?? null;
    const sharedStorage = new Map<string, unknown>();

    progress.setTotal(pending.length);
    progress.setMessage('Starting migrations…');

    let migrationsRun = 0;

    for (const migration of pending) {
      // Check for cancellation
      if (signal.aborted) {
        throw new MigrationError(
          'MIGRATION_CANCELLED',
          `Migration cancelled at version ${String(migration.version)}.`,
          { context: { version: migration.version, migrationsRun } },
        );
      }

      const context: MigrationContext = {
        db,
        opfsRoot,
        progress,
        signal,
        storage: sharedStorage,
      };

      progress.setMessage(
        `Running migration v${String(migration.version)}: ${migration.description}`,
      );

      // Create savepoint before migration
      const savepoint = this.createSavepoint(migration.version);

      try {
        // Forward migration
        await migration.up(context);

        // Verify
        const verification = await migration.verify(context);
        if (!verification.success) {
          // Attempt rollback
          try {
            await migration.down(context);
          } catch {
            // Best-effort rollback
          }
          this.rollbackSavepoint(savepoint);
          throw new MigrationError(
            'MIGRATION_VERIFICATION_FAILED',
            `Migration v${String(migration.version)} verification failed: ${verification.errors.join(', ')}`,
            {
              context: {
                version: migration.version,
                errors: verification.errors,
                warnings: verification.warnings,
              },
            },
          );
        }

        // Persist the new schema version
        await this.setSchemaVersion(db, migration.version);
        this.commitSavepoint(savepoint);
        migrationsRun++;
        progress.setProgress(migrationsRun);
      } catch (error) {
        if (error instanceof MigrationError) throw error;

        // Attempt rollback
        try {
          await migration.down(context);
        } catch {
          // Best-effort rollback
        }
        this.rollbackSavepoint(savepoint);

        throw new MigrationError(
          'MIGRATION_FAILED',
          `Migration v${String(migration.version)} failed: ${error instanceof Error ? error.message : String(error)}`,
          {
            cause: error,
            context: { version: migration.version, migrationsRun },
          },
        );
      }
    }

    progress.setMessage('Migrations complete.');

    return {
      fromVersion: currentVersion,
      toVersion: targetVersion,
      migrationsRun,
      durationMs: Date.now() - startTime,
    };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Select and topologically sort the migrations needed to advance
   * from `fromVersion` to `toVersion`.
   */
  private getMigrationsToRun(fromVersion: number, toVersion: number): Migration[] {
    const candidates = this.migrations.filter(
      (m) => m.version > fromVersion && m.version <= toVersion,
    );

    return this.topologicalSort(candidates);
  }

  /**
   * Topological sort that respects explicit dependency declarations.
   *
   * Falls back to version-number ordering when no dependencies are declared.
   */
  private topologicalSort(migrations: Migration[]): Migration[] {
    const sorted: Migration[] = [];
    const visited = new Set<number>();
    const migrationMap = new Map<number, Migration>();

    for (const m of migrations) {
      migrationMap.set(m.version, m);
    }

    const visit = (migration: Migration): void => {
      if (visited.has(migration.version)) return;

      for (const depVersion of migration.dependencies) {
        const dep = migrationMap.get(depVersion);
        if (dep) visit(dep);
      }

      visited.add(migration.version);
      sorted.push(migration);
    };

    // Sort candidates by version first so deterministic ordering is guaranteed
    const byVersion = [...migrations].sort((a, b) => a.version - b.version);
    for (const m of byVersion) {
      visit(m);
    }

    return sorted;
  }

  /**
   * Persist the schema version in the settings store.
   */
  private async setSchemaVersion(db: IDBDatabase, version: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const record = {
        key: SCHEMA_VERSION_KEY,
        value: version,
        updatedAt: new Date().toISOString(),
      };
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }
}

// ---------------------------------------------------------------------------
// Built-in migrations
// ---------------------------------------------------------------------------

/**
 * Migration 1: Initial schema baseline.
 *
 * The IndexedDB schema (stores + indexes) is created by IndexedDBService's
 * `onupgradeneeded` handler. This migration simply records that version 1
 * is the starting point and verifies all expected stores exist.
 */
export const MIGRATION_001_INITIAL_SCHEMA: Migration = {
  version: 1,
  description: 'Initial schema baseline — 7 object stores with indexes',
  estimatedDurationMs: 100,
  dependencies: [],

  async up(context: MigrationContext): Promise<void> {
    context.progress.setMessage('Setting initial schema version…');
    // Schema is created by IndexedDBService.open() via onupgradeneeded.
    // This migration exists as a formal record of version 1.
  },

  async down(): Promise<void> {
    // Cannot roll back the initial schema — nothing to do.
  },

  async verify(context: MigrationContext): Promise<MigrationVerificationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const expectedStores = [
      'sessions',
      'nightly_aggregates',
      'events',
      'analysis_results',
      'settings',
      'import_history',
      'integration_data',
    ];

    for (const storeName of expectedStores) {
      if (!context.db.objectStoreNames.contains(storeName)) {
        errors.push(`Missing object store: ${storeName}`);
      }
    }

    return { success: errors.length === 0, errors, warnings };
  },
};
