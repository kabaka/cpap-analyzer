/**
 * IndexedDB storage service for CPAP Analyzer structured data.
 *
 * Manages all structured data persistence using the native IDBDatabase API:
 * sessions, nightly aggregates, therapy events, analysis results, settings,
 * import history, and integration data.
 *
 * Database: `cpap-analyzer`, schema version 2.
 */

import {
  ErrorCategory,
  ErrorSeverity,
  type AnalysisResult,
  type CPAPError,
  type Event,
  type ImportRecord,
  type IntegrationDailySummary,
  type IntegrationData,
  type IntegrationImportRecord,
  type IntegrationSource,
  type IntegrationTimeseries,
  type NightlyAggregate,
  type Session,
} from '@/types';

// ---------------------------------------------------------------------------
// Storage-specific extended types (add indexed fields not in domain types)
// ---------------------------------------------------------------------------

/** NightlyAggregate stored in IndexedDB with compound index support. */
export type StoredNightlyAggregate = NightlyAggregate;

/** AnalysisResult stored in IndexedDB with cache-hit compound index. */
export type StoredAnalysisResult = AnalysisResult;

/** ImportRecord stored in IndexedDB with storage indexes. */
export type StoredImportRecord = ImportRecord;

/** A settings entry as persisted in IndexedDB (includes updatedAt). */
export interface StoredSetting {
  readonly key: string;
  readonly value: unknown;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Store names (literal union for type-safe transaction creation)
// ---------------------------------------------------------------------------

type StoreName =
  | 'sessions'
  | 'nightly_aggregates'
  | 'events'
  | 'analysis_results'
  | 'settings'
  | 'import_history'
  | 'integration_data'
  | 'integration_timeseries'
  | 'integration_import_history';

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

/**
 * Structured storage error that carries CPAPError metadata.
 *
 * Thrown by all IndexedDBService methods when an operation fails.
 */
export class StorageError extends Error {
  readonly code: string;
  readonly category: ErrorCategory = ErrorCategory.SYSTEM;
  readonly severity: ErrorSeverity;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown>;
  readonly recoverable: boolean;
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
    this.name = 'StorageError';
    this.code = code;
    this.severity = options.severity ?? ErrorSeverity.ERROR;
    this.timestamp = new Date();
    this.context = options.context;
    this.recoverable = options.recoverable ?? true;
    if (options.cause instanceof Error) {
      this.originalCause = options.cause;
    }
  }

  /** Convert to a plain CPAPError object. */
  toCPAPError(): CPAPError {
    return {
      id: this.code,
      category: this.category,
      severity: this.severity,
      title: this.name,
      message: this.message,
      technicalDetails: {
        originalError: this.originalCause,
        stack: this.stack,
        context: this.context,
      },
      timestamp: this.timestamp,
    };
  }
}

// ---------------------------------------------------------------------------
// IndexedDBService
// ---------------------------------------------------------------------------

/** Database name used for the CPAP Analyzer IndexedDB instance. */
const DB_NAME = 'cpap-analyzer';

/**
 * Current schema version. Incremented on each migration.
 *
 * - v1: initial 7-store schema.
 * - v2: change `sessions.machineId_date` and `nightly_aggregates.machineId_date`
 *   from UNIQUE to non-unique (multiple sessions per machine per calendar day
 *   are legitimate). See `upgradeSchema()` and `MIGRATION_002_NONUNIQUE_MACHINE_DATE`.
 * - v3: add `integration_timeseries` and `integration_import_history` stores;
 *   add `dataType` and `source_dataType_date` indexes to `integration_data`;
 *   remove legacy `source_date` unique index from `integration_data`.
 */
const DB_VERSION = 3;

export class IndexedDBService {
  private db: IDBDatabase | null = null;
  private readonly dbName: string;
  private readonly dbVersion: number;

  constructor(dbName: string = DB_NAME, dbVersion: number = DB_VERSION) {
    this.dbName = dbName;
    this.dbVersion = dbVersion;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Open the database, creating/upgrading the schema as needed. */
  async open(): Promise<void> {
    if (this.db) return;

    try {
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(this.dbName, this.dbVersion);

        request.onupgradeneeded = (event) => {
          const target = event.target as IDBOpenDBRequest;
          const db = target.result;
          // `target.transaction` is the versionchange transaction; it is the
          // only way to obtain existing object stores during an upgrade so we
          // can alter their indexes in place without dropping data.
          this.upgradeSchema(db, target.transaction, event.oldVersion);
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      throw new StorageError(
        'STORAGE_OPEN_FAILED',
        `Failed to open database "${this.dbName}": ${String(error)}`,
        { cause: error, recoverable: false, severity: ErrorSeverity.FATAL },
      );
    }
  }

  /** Close the database connection. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /** Delete the entire database. Use with caution. */
  async destroy(): Promise<void> {
    this.close();
    try {
      await this.wrapRequest(indexedDB.deleteDatabase(this.dbName));
    } catch (error) {
      throw new StorageError(
        'STORAGE_DELETE_FAILED',
        `Failed to delete database "${this.dbName}": ${String(error)}`,
        { cause: error },
      );
    }
  }

  // -----------------------------------------------------------------------
  // Sessions
  // -----------------------------------------------------------------------

  /** Insert a new session record. Throws if a session with the same ID already exists. */
  async addSession(session: Session): Promise<void> {
    try {
      const store = this.writeStore('sessions');
      await this.wrapRequest(store.add(session));
    } catch (error) {
      throw this.wrapError('STORAGE_WRITE_FAILED', 'add session', 'sessions', session.id, error);
    }
  }

  /**
   * Atomically persist a session together with its nightly aggregate and
   * therapy events in a SINGLE read-write transaction.
   *
   * All three writes share one `('sessions', 'nightly_aggregates', 'events')`
   * transaction, so any failure (e.g. a ConstraintError on a duplicate ID)
   * aborts the whole transaction and rolls back every write — preventing the
   * orphaned-row scenario that arises when the records are written in separate
   * transactions.
   *
   * Intended to replace the sequential `addSession` + `addNightlyAggregate` +
   * `addEvents` calls in the import pipeline.
   *
   * @param session   - The session record (uses `add`, so a duplicate ID throws).
   * @param aggregate - The nightly aggregate for this session (uses `add`).
   * @param events    - Therapy events for this session (may be empty).
   */
  async addSessionWithRelated(
    session: Session,
    aggregate: StoredNightlyAggregate,
    events: readonly Event[],
  ): Promise<void> {
    try {
      const tx = this.createWriteTransaction('sessions', 'nightly_aggregates', 'events');
      tx.objectStore('sessions').add(session);
      tx.objectStore('nightly_aggregates').add(aggregate);
      if (events.length > 0) {
        const eventStore = tx.objectStore('events');
        for (const event of events) {
          eventStore.add(event);
        }
      }
      // Await transaction completion so any failed write rolls back the batch.
      await this.awaitTransaction(tx);
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        'add session with related records',
        'sessions',
        session.id,
        error,
      );
    }
  }

  /** Retrieve a session by ID, or `null` if not found. */
  async getSession(id: string): Promise<Session | null> {
    try {
      const store = this.readStore('sessions');
      const result: Session | undefined = await this.wrapRequest(store.get(id));
      return result ?? null;
    } catch (error) {
      throw this.wrapError('STORAGE_READ_FAILED', 'get session', 'sessions', id, error);
    }
  }

  /** Retrieve all sessions. */
  async getAllSessions(): Promise<Session[]> {
    try {
      const store = this.readStore('sessions');
      return await this.wrapRequest(store.getAll());
    } catch (error) {
      throw this.wrapError('STORAGE_READ_FAILED', 'get all sessions', 'sessions', undefined, error);
    }
  }

  /** Retrieve sessions within a date range (inclusive, YYYY-MM-DD). */
  async getSessionsByDateRange(start: string, end: string): Promise<Session[]> {
    try {
      return await this.cursorQuery<Session>('sessions', 'date', IDBKeyRange.bound(start, end));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get sessions by date range',
        'sessions',
        undefined,
        error,
      );
    }
  }

  /** Retrieve sessions for a specific machine. */
  async getSessionsByMachineId(machineId: string): Promise<Session[]> {
    try {
      return await this.cursorQuery<Session>('sessions', 'machineId', IDBKeyRange.only(machineId));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get sessions by machineId',
        'sessions',
        machineId,
        error,
      );
    }
  }

  /** Update an existing session (upsert semantics). */
  async updateSession(session: Session): Promise<void> {
    try {
      const store = this.writeStore('sessions');
      await this.wrapRequest(store.put(session));
    } catch (error) {
      throw this.wrapError('STORAGE_WRITE_FAILED', 'update session', 'sessions', session.id, error);
    }
  }

  /** Delete a session by ID. */
  async deleteSession(id: string): Promise<void> {
    try {
      const store = this.writeStore('sessions');
      await this.wrapRequest(store.delete(id));
    } catch (error) {
      throw this.wrapError('STORAGE_DELETE_FAILED', 'delete session', 'sessions', id, error);
    }
  }

  /**
   * Atomically delete a session and ALL of its related metadata: the session
   * row, its nightly aggregate(s) (matched via the `sessionId` index), and its
   * therapy events (matched via the `sessionId` index).
   *
   * All three stores are mutated inside a SINGLE multi-store readwrite
   * transaction, so the delete either fully succeeds or fully rolls back. This
   * prevents orphaned `nightly_aggregates` rows — which Dashboard/Trends/
   * SummaryStats read by date range WITHOUT joining on session existence and
   * would otherwise surface as phantom nights with wrong AHI/usage/compliance.
   *
   * Note: high-resolution signal chunks live in OPFS, not IndexedDB, and are
   * deleted separately (see {@link OPFSService.deleteSessionData}).
   */
  async deleteSessionCascade(sessionId: string): Promise<void> {
    try {
      const tx = this.createWriteTransaction('sessions', 'nightly_aggregates', 'events');

      // Session row (keyed by id).
      tx.objectStore('sessions').delete(sessionId);

      // Nightly aggregate(s) for this session — looked up via the sessionId index.
      await this.deleteByIndexCursor(tx.objectStore('nightly_aggregates'), 'sessionId', sessionId);

      // Therapy events for this session — looked up via the sessionId index.
      await this.deleteByIndexCursor(tx.objectStore('events'), 'sessionId', sessionId);

      // Await transaction completion so any failed delete rolls back the batch.
      await this.awaitTransaction(tx);
    } catch (error) {
      throw this.wrapError(
        'STORAGE_DELETE_FAILED',
        'cascade-delete session',
        'sessions',
        sessionId,
        error,
      );
    }
  }

  /** Count sessions within a date range (inclusive). */
  async countSessionsByDateRange(start: string, end: string): Promise<number> {
    try {
      const store = this.readStore('sessions');
      const index = store.index('date');
      return await this.wrapRequest(index.count(IDBKeyRange.bound(start, end)));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'count sessions by date range',
        'sessions',
        undefined,
        error,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Nightly Aggregates
  // -----------------------------------------------------------------------

  /** Insert a new nightly aggregate record. */
  async addNightlyAggregate(aggregate: StoredNightlyAggregate): Promise<void> {
    try {
      const store = this.writeStore('nightly_aggregates');
      await this.wrapRequest(store.add(aggregate));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        'add nightly aggregate',
        'nightly_aggregates',
        aggregate.id,
        error,
      );
    }
  }

  /** Retrieve a nightly aggregate by ID, or `null` if not found. */
  async getNightlyAggregate(id: string): Promise<StoredNightlyAggregate | null> {
    try {
      const store = this.readStore('nightly_aggregates');
      const result: StoredNightlyAggregate | undefined = await this.wrapRequest(store.get(id));
      return result ?? null;
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get nightly aggregate',
        'nightly_aggregates',
        id,
        error,
      );
    }
  }

  /** Retrieve the nightly aggregate linked to a specific session. */
  async getNightlyAggregateBySessionId(sessionId: string): Promise<StoredNightlyAggregate | null> {
    try {
      const results = await this.cursorQuery<StoredNightlyAggregate>(
        'nightly_aggregates',
        'sessionId',
        IDBKeyRange.only(sessionId),
      );
      return results[0] ?? null;
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get nightly aggregate by sessionId',
        'nightly_aggregates',
        sessionId,
        error,
      );
    }
  }

  /** Retrieve nightly aggregates within a date range (inclusive, YYYY-MM-DD). */
  async getNightlyAggregatesByDateRange(
    start: string,
    end: string,
  ): Promise<StoredNightlyAggregate[]> {
    try {
      return await this.cursorQuery<StoredNightlyAggregate>(
        'nightly_aggregates',
        'date',
        IDBKeyRange.bound(start, end),
      );
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get nightly aggregates by date range',
        'nightly_aggregates',
        undefined,
        error,
      );
    }
  }

  /** Update an existing nightly aggregate (upsert semantics). */
  async updateNightlyAggregate(aggregate: StoredNightlyAggregate): Promise<void> {
    try {
      const store = this.writeStore('nightly_aggregates');
      await this.wrapRequest(store.put(aggregate));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        'update nightly aggregate',
        'nightly_aggregates',
        aggregate.id,
        error,
      );
    }
  }

  /** Delete a nightly aggregate by ID. */
  async deleteNightlyAggregate(id: string): Promise<void> {
    try {
      const store = this.writeStore('nightly_aggregates');
      await this.wrapRequest(store.delete(id));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_DELETE_FAILED',
        'delete nightly aggregate',
        'nightly_aggregates',
        id,
        error,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Therapy Events
  // -----------------------------------------------------------------------

  /** Insert a single therapy event. */
  async addEvent(event: Event): Promise<void> {
    try {
      const store = this.writeStore('events');
      await this.wrapRequest(store.add(event));
    } catch (error) {
      throw this.wrapError('STORAGE_WRITE_FAILED', 'add event', 'events', event.id, error);
    }
  }

  /** Insert multiple therapy events in a single transaction. */
  async addEvents(events: readonly Event[]): Promise<void> {
    if (events.length === 0) return;
    try {
      const db = this.getDB();
      const tx = db.transaction('events', 'readwrite');
      const store = tx.objectStore('events');
      for (const event of events) {
        store.add(event);
      }
      await this.wrapTransaction(tx);
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        `add ${String(events.length)} events`,
        'events',
        undefined,
        error,
      );
    }
  }

  /** Retrieve a therapy event by ID, or `null` if not found. */
  async getEvent(id: string): Promise<Event | null> {
    try {
      const store = this.readStore('events');
      const result: Event | undefined = await this.wrapRequest(store.get(id));
      return result ?? null;
    } catch (error) {
      throw this.wrapError('STORAGE_READ_FAILED', 'get event', 'events', id, error);
    }
  }

  /** Retrieve all therapy events for a session, ordered by startTime. */
  async getEventsBySessionId(sessionId: string): Promise<Event[]> {
    try {
      return await this.cursorQuery<Event>('events', 'sessionId', IDBKeyRange.only(sessionId));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get events by sessionId',
        'events',
        sessionId,
        error,
      );
    }
  }

  /**
   * Retrieve therapy events for a session within a startTime range.
   *
   * Uses the compound `[sessionId, startTime]` index for efficient lookup.
   *
   * @param sessionId - Session to query.
   * @param fromTime  - Start of the time range (seconds from session start, inclusive).
   * @param toTime    - End of the time range (seconds from session start, inclusive).
   */
  async getEventsBySessionIdAndTimeRange(
    sessionId: string,
    fromTime: number,
    toTime: number,
  ): Promise<Event[]> {
    try {
      const range = IDBKeyRange.bound([sessionId, fromTime], [sessionId, toTime]);
      return await this.cursorQuery<Event>('events', 'sessionId_startTime', range);
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get events by sessionId and time range',
        'events',
        sessionId,
        error,
      );
    }
  }

  /** Retrieve all therapy events of a given type. */
  async getEventsByType(type: string): Promise<Event[]> {
    try {
      return await this.cursorQuery<Event>('events', 'type', IDBKeyRange.only(type));
    } catch (error) {
      throw this.wrapError('STORAGE_READ_FAILED', 'get events by type', 'events', type, error);
    }
  }

  /** Delete all therapy events for a session. */
  async deleteEventsBySessionId(sessionId: string): Promise<void> {
    try {
      const db = this.getDB();
      const tx = db.transaction('events', 'readwrite');
      const store = tx.objectStore('events');
      const index = store.index('sessionId');
      const request = index.openCursor(IDBKeyRange.only(sessionId));

      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });

      await this.wrapTransaction(tx);
    } catch (error) {
      throw this.wrapError(
        'STORAGE_DELETE_FAILED',
        'delete events by sessionId',
        'events',
        sessionId,
        error,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Analysis Results
  // -----------------------------------------------------------------------

  /** Insert a new analysis result. */
  async addAnalysisResult(result: StoredAnalysisResult): Promise<void> {
    try {
      const store = this.writeStore('analysis_results');
      await this.wrapRequest(store.add(result));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        'add analysis result',
        'analysis_results',
        result.id,
        error,
      );
    }
  }

  /** Retrieve an analysis result by ID, or `null` if not found. */
  async getAnalysisResult(id: string): Promise<StoredAnalysisResult | null> {
    try {
      const store = this.readStore('analysis_results');
      const result: StoredAnalysisResult | undefined = await this.wrapRequest(store.get(id));
      return result ?? null;
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get analysis result',
        'analysis_results',
        id,
        error,
      );
    }
  }

  /** Retrieve all analysis results of a given type. */
  async getAnalysisResultsByType(type: string): Promise<StoredAnalysisResult[]> {
    try {
      return await this.cursorQuery<StoredAnalysisResult>(
        'analysis_results',
        'type',
        IDBKeyRange.only(type),
      );
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get analysis results by type',
        'analysis_results',
        type,
        error,
      );
    }
  }

  /**
   * Look up an analysis result by its type and date-range hash.
   *
   * Uses the compound unique `[type, dateRangeHash]` index for O(1) cache-hit lookup.
   */
  async getAnalysisResultByTypeAndHash(
    type: string,
    dateRangeHash: string,
  ): Promise<StoredAnalysisResult | null> {
    try {
      const store = this.readStore('analysis_results');
      const index = store.index('type_dateRangeHash');
      const result: StoredAnalysisResult | undefined = await this.wrapRequest(
        index.get([type, dateRangeHash]),
      );
      return result ?? null;
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get analysis result by type and hash',
        'analysis_results',
        `${type}:${dateRangeHash}`,
        error,
      );
    }
  }

  /** Update an existing analysis result (upsert semantics). */
  async updateAnalysisResult(result: StoredAnalysisResult): Promise<void> {
    try {
      const store = this.writeStore('analysis_results');
      await this.wrapRequest(store.put(result));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        'update analysis result',
        'analysis_results',
        result.id,
        error,
      );
    }
  }

  /** Delete an analysis result by ID. */
  async deleteAnalysisResult(id: string): Promise<void> {
    try {
      const store = this.writeStore('analysis_results');
      await this.wrapRequest(store.delete(id));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_DELETE_FAILED',
        'delete analysis result',
        'analysis_results',
        id,
        error,
      );
    }
  }

  /**
   * Delete all analysis results computed before the given ISO datetime.
   *
   * Uses the `computedAt` index to find and remove stale entries.
   */
  async deleteAnalysisResultsBefore(beforeDate: string): Promise<number> {
    try {
      const db = this.getDB();
      const tx = db.transaction('analysis_results', 'readwrite');
      const store = tx.objectStore('analysis_results');
      const index = store.index('computedAt');
      const range = IDBKeyRange.upperBound(beforeDate, true);
      let deleted = 0;

      await new Promise<void>((resolve, reject) => {
        const request = index.openCursor(range);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            deleted++;
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });

      await this.wrapTransaction(tx);
      return deleted;
    } catch (error) {
      throw this.wrapError(
        'STORAGE_DELETE_FAILED',
        'delete analysis results before date',
        'analysis_results',
        beforeDate,
        error,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Settings
  // -----------------------------------------------------------------------

  /** Retrieve a setting by key, or `null` if not found. */
  async getSetting(key: string): Promise<StoredSetting | null> {
    try {
      const store = this.readStore('settings');
      const result: StoredSetting | undefined = await this.wrapRequest(store.get(key));
      return result ?? null;
    } catch (error) {
      throw this.wrapError('STORAGE_READ_FAILED', 'get setting', 'settings', key, error);
    }
  }

  /** Insert or update a setting. The `updatedAt` timestamp is set automatically. */
  async putSetting(key: string, value: unknown): Promise<void> {
    try {
      const store = this.writeStore('settings');
      const record: StoredSetting = { key, value, updatedAt: new Date().toISOString() };
      await this.wrapRequest(store.put(record));
    } catch (error) {
      throw this.wrapError('STORAGE_WRITE_FAILED', 'put setting', 'settings', key, error);
    }
  }

  /** Delete a setting by key. */
  async deleteSetting(key: string): Promise<void> {
    try {
      const store = this.writeStore('settings');
      await this.wrapRequest(store.delete(key));
    } catch (error) {
      throw this.wrapError('STORAGE_DELETE_FAILED', 'delete setting', 'settings', key, error);
    }
  }

  /** Retrieve all settings. */
  async getAllSettings(): Promise<StoredSetting[]> {
    try {
      const store = this.readStore('settings');
      return await this.wrapRequest(store.getAll());
    } catch (error) {
      throw this.wrapError('STORAGE_READ_FAILED', 'get all settings', 'settings', undefined, error);
    }
  }

  // -----------------------------------------------------------------------
  // Import History
  // -----------------------------------------------------------------------

  /** Insert a new import record. */
  async addImportRecord(record: StoredImportRecord): Promise<void> {
    try {
      const store = this.writeStore('import_history');
      await this.wrapRequest(store.add(record));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        'add import record',
        'import_history',
        record.id,
        error,
      );
    }
  }

  /** Retrieve an import record by ID, or `null` if not found. */
  async getImportRecord(id: string): Promise<StoredImportRecord | null> {
    try {
      const store = this.readStore('import_history');
      const result: StoredImportRecord | undefined = await this.wrapRequest(store.get(id));
      return result ?? null;
    } catch (error) {
      throw this.wrapError('STORAGE_READ_FAILED', 'get import record', 'import_history', id, error);
    }
  }

  /** Retrieve all import records for a specific machine. */
  async getImportRecordsByMachineId(machineId: string): Promise<StoredImportRecord[]> {
    try {
      return await this.cursorQuery<StoredImportRecord>(
        'import_history',
        'machineId',
        IDBKeyRange.only(machineId),
      );
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get import records by machineId',
        'import_history',
        machineId,
        error,
      );
    }
  }

  /** Retrieve all import records ordered by importedAt. */
  async getAllImportRecords(): Promise<StoredImportRecord[]> {
    try {
      const store = this.readStore('import_history');
      return await this.wrapRequest(store.getAll());
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get all import records',
        'import_history',
        undefined,
        error,
      );
    }
  }

  /** Delete an import record by ID. */
  async deleteImportRecord(id: string): Promise<void> {
    try {
      const store = this.writeStore('import_history');
      await this.wrapRequest(store.delete(id));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_DELETE_FAILED',
        'delete import record',
        'import_history',
        id,
        error,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Integration Data
  // -----------------------------------------------------------------------

  /** Insert a new integration data record. */
  async addIntegrationData(data: IntegrationData): Promise<void> {
    try {
      const store = this.writeStore('integration_data');
      await this.wrapRequest(store.add(data));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        'add integration data',
        'integration_data',
        data.id,
        error,
      );
    }
  }

  /** Retrieve integration data by ID, or `null` if not found. */
  async getIntegrationData(id: string): Promise<IntegrationData | null> {
    try {
      const store = this.readStore('integration_data');
      const result: IntegrationData | undefined = await this.wrapRequest(store.get(id));
      return result ?? null;
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get integration data',
        'integration_data',
        id,
        error,
      );
    }
  }

  /** Retrieve all integration data from a specific source. */
  async getIntegrationDataBySource(source: string): Promise<IntegrationData[]> {
    try {
      return await this.cursorQuery<IntegrationData>(
        'integration_data',
        'source',
        IDBKeyRange.only(source),
      );
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get integration data by source',
        'integration_data',
        source,
        error,
      );
    }
  }

  /**
   * Look up a single integration data entry by source and date.
   *
   * Queries the `date` index and filters by source in memory. Prior to v3,
   * this used the (now removed) `source_date` compound index.
   */
  async getIntegrationDataBySourceAndDate(
    source: string,
    date: string,
  ): Promise<IntegrationData | null> {
    try {
      const results = await this.cursorQuery<IntegrationData>(
        'integration_data',
        'date',
        IDBKeyRange.only(date),
      );
      return results.find((r) => r.source === source) ?? null;
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get integration data by source and date',
        'integration_data',
        `${source}:${date}`,
        error,
      );
    }
  }

  /** Retrieve all integration data within a date range (inclusive, YYYY-MM-DD). */
  async getIntegrationDataByDateRange(start: string, end: string): Promise<IntegrationData[]> {
    try {
      return await this.cursorQuery<IntegrationData>(
        'integration_data',
        'date',
        IDBKeyRange.bound(start, end),
      );
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get integration data by date range',
        'integration_data',
        undefined,
        error,
      );
    }
  }

  /** Update an existing integration data record (upsert semantics). */
  async updateIntegrationData(data: IntegrationData): Promise<void> {
    try {
      const store = this.writeStore('integration_data');
      await this.wrapRequest(store.put(data));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        'update integration data',
        'integration_data',
        data.id,
        error,
      );
    }
  }

  /** Delete an integration data record by ID. */
  async deleteIntegrationData(id: string): Promise<void> {
    try {
      const store = this.writeStore('integration_data');
      await this.wrapRequest(store.delete(id));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_DELETE_FAILED',
        'delete integration data',
        'integration_data',
        id,
        error,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Integration Daily Summaries (integration_data store, typed)
  // -----------------------------------------------------------------------

  /** Insert a new integration daily summary record. */
  async addIntegrationDailySummary(data: IntegrationDailySummary): Promise<void> {
    try {
      const store = this.writeStore('integration_data');
      await this.wrapRequest(store.add(data));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        'add integration daily summary',
        'integration_data',
        data.id,
        error,
      );
    }
  }

  /** Retrieve integration daily summaries within a date range (inclusive, YYYY-MM-DD). */
  async getIntegrationDailySummariesByDateRange(
    start: string,
    end: string,
  ): Promise<IntegrationDailySummary[]> {
    try {
      return await this.cursorQuery<IntegrationDailySummary>(
        'integration_data',
        'date',
        IDBKeyRange.bound(start, end),
      );
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get integration daily summaries by date range',
        'integration_data',
        undefined,
        error,
      );
    }
  }

  /**
   * Retrieve integration daily summaries for a specific source and data type.
   *
   * Queries the `source` index and filters by `dataType` in memory.
   */
  async getIntegrationDailySummariesBySourceAndType(
    source: string,
    dataType: string,
  ): Promise<IntegrationDailySummary[]> {
    try {
      const all = await this.cursorQuery<IntegrationDailySummary>(
        'integration_data',
        'source',
        IDBKeyRange.only(source),
      );
      return all.filter((r) => r.dataType === dataType);
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get integration daily summaries by source and type',
        'integration_data',
        `${source}:${dataType}`,
        error,
      );
    }
  }

  /**
   * Look up a single integration daily summary by its unique compound key.
   *
   * Uses the `source_dataType_date` unique index for O(1) lookup.
   */
  async getIntegrationDailySummaryByKey(
    source: string,
    dataType: string,
    date: string,
  ): Promise<IntegrationDailySummary | null> {
    try {
      const store = this.readStore('integration_data');
      const index = store.index('source_dataType_date');
      const result: IntegrationDailySummary | undefined = await this.wrapRequest(
        index.get([source, dataType, date]),
      );
      return result ?? null;
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get integration daily summary by key',
        'integration_data',
        `${source}:${dataType}:${date}`,
        error,
      );
    }
  }

  /**
   * Atomically insert multiple integration daily summary records in a single transaction.
   *
   * @param records - Records to insert. Uses `add`, so duplicates throw ConstraintError.
   */
  async bulkAddIntegrationDailySummaries(
    records: readonly IntegrationDailySummary[],
  ): Promise<void> {
    if (records.length === 0) return;
    try {
      const db = this.getDB();
      const tx = db.transaction('integration_data', 'readwrite');
      const store = tx.objectStore('integration_data');
      for (const record of records) {
        store.add(record);
      }
      await this.wrapTransaction(tx);
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        `bulk add ${String(records.length)} integration daily summaries`,
        'integration_data',
        undefined,
        error,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Integration Timeseries
  // -----------------------------------------------------------------------

  /** Insert a new integration timeseries record. */
  async addIntegrationTimeseries(data: IntegrationTimeseries): Promise<void> {
    try {
      const store = this.writeStore('integration_timeseries');
      await this.wrapRequest(store.add(data));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        'add integration timeseries',
        'integration_timeseries',
        data.id,
        error,
      );
    }
  }

  /** Retrieve integration timeseries records within a date range (inclusive, YYYY-MM-DD). */
  async getIntegrationTimeseriesByDateRange(
    start: string,
    end: string,
  ): Promise<IntegrationTimeseries[]> {
    try {
      return await this.cursorQuery<IntegrationTimeseries>(
        'integration_timeseries',
        'date',
        IDBKeyRange.bound(start, end),
      );
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get integration timeseries by date range',
        'integration_timeseries',
        undefined,
        error,
      );
    }
  }

  /**
   * Look up a single integration timeseries record by its unique compound key.
   *
   * Uses the `source_dataType_date` unique index for O(1) lookup.
   */
  async getIntegrationTimeseriesByKey(
    source: string,
    dataType: string,
    date: string,
  ): Promise<IntegrationTimeseries | null> {
    try {
      const store = this.readStore('integration_timeseries');
      const index = store.index('source_dataType_date');
      const result: IntegrationTimeseries | undefined = await this.wrapRequest(
        index.get([source, dataType, date]),
      );
      return result ?? null;
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get integration timeseries by key',
        'integration_timeseries',
        `${source}:${dataType}:${date}`,
        error,
      );
    }
  }

  /**
   * Atomically insert multiple integration timeseries records in a single transaction.
   *
   * @param records - Records to insert. Uses `add`, so duplicates throw ConstraintError.
   */
  async bulkAddIntegrationTimeseries(records: readonly IntegrationTimeseries[]): Promise<void> {
    if (records.length === 0) return;
    try {
      const db = this.getDB();
      const tx = db.transaction('integration_timeseries', 'readwrite');
      const store = tx.objectStore('integration_timeseries');
      for (const record of records) {
        store.add(record);
      }
      await this.wrapTransaction(tx);
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        `bulk add ${String(records.length)} integration timeseries`,
        'integration_timeseries',
        undefined,
        error,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Integration Import History
  // -----------------------------------------------------------------------

  /** Insert a new integration import record. */
  async addIntegrationImportRecord(record: IntegrationImportRecord): Promise<void> {
    try {
      const store = this.writeStore('integration_import_history');
      await this.wrapRequest(store.add(record));
    } catch (error) {
      throw this.wrapError(
        'STORAGE_WRITE_FAILED',
        'add integration import record',
        'integration_import_history',
        record.id,
        error,
      );
    }
  }

  /**
   * Retrieve integration import records, optionally filtered by source.
   *
   * @param source - If provided, only records for this source are returned.
   *                 If omitted, all integration import records are returned.
   */
  async getIntegrationImportRecords(source?: string): Promise<IntegrationImportRecord[]> {
    try {
      if (source) {
        return await this.cursorQuery<IntegrationImportRecord>(
          'integration_import_history',
          'source',
          IDBKeyRange.only(source),
        );
      }
      const store = this.readStore('integration_import_history');
      return await this.wrapRequest(store.getAll());
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get integration import records',
        'integration_import_history',
        source,
        error,
      );
    }
  }

  /**
   * Retrieve the most recent integration import record for a source.
   *
   * Opens a reverse cursor on the `importedAt` index and returns the first
   * record matching the given source. Efficient: reads at most a handful of
   * records (the most-recent entries until one matches the source).
   */
  async getLatestIntegrationImportRecord(source: string): Promise<IntegrationImportRecord | null> {
    try {
      const store = this.readStore('integration_import_history');
      const index = store.index('importedAt');

      return await new Promise<IntegrationImportRecord | null>((resolve, reject) => {
        const request = index.openCursor(null, 'prev');
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(null);
            return;
          }
          const record = cursor.value as IntegrationImportRecord;
          if (record.source === source) {
            resolve(record);
          } else {
            cursor.continue();
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'get latest integration import record',
        'integration_import_history',
        source,
        error,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Integration Utility
  // -----------------------------------------------------------------------

  /**
   * Atomically delete EVERY record for a given integration `source` across all
   * three integration stores: daily summaries (`integration_data`), intra-night
   * timeseries (`integration_timeseries`), and import history
   * (`integration_import_history`). All three stores expose a non-unique
   * `source` index, so each deletion is a cursor sweep over `source = source`.
   *
   * The three sweeps share ONE multi-store readwrite transaction, so the purge
   * either fully succeeds or fully rolls back — a disconnect→Delete can never
   * leave a partial residue (e.g. orphaned hourly series or import provenance)
   * for a source the user asked to forget. This is the total-wipe primitive that
   * {@link import('@/services/weather/weatherDataService') deleteAllWeatherData}
   * builds on.
   *
   * @param source - Integration source to purge (e.g. `'weather'`, `'fitbit'`).
   * @returns Per-store counts of records actually removed.
   */
  async deleteIntegrationDataBySource(
    source: IntegrationSource,
  ): Promise<{ dailyDeleted: number; timeseriesDeleted: number; importRecordsDeleted: number }> {
    try {
      const tx = this.createWriteTransaction(
        'integration_data',
        'integration_timeseries',
        'integration_import_history',
      );

      // Resolve all three store handles synchronously up front. The three
      // cursor sweeps below run back-to-back on this one transaction; grabbing
      // the handles before the first `await` keeps the transaction continuously
      // active so it cannot auto-commit at a microtask boundary between sweeps.
      const dailyStore = tx.objectStore('integration_data');
      const timeseriesStore = tx.objectStore('integration_timeseries');
      const importStore = tx.objectStore('integration_import_history');

      // Kick off all three cursor sweeps without awaiting between them: each
      // opens a request immediately, so the transaction stays continuously busy
      // and cannot auto-commit before every sweep has been issued. Then await
      // their counts together and finally the transaction itself.
      //
      // `integration_data` and `integration_import_history` carry a dedicated
      // non-unique `source` index. `integration_timeseries` has no standalone
      // `source` index — only the compound `source_dataType_date` index — so we
      // sweep it via a prefix-bounded range on that index, which selects every
      // entry whose first key component is `source` regardless of dataType/date.
      const dailyPromise = this.deleteByIndexRangeCounting(
        dailyStore.index('source'),
        IDBKeyRange.only(source),
      );
      const timeseriesPromise = this.deleteByIndexRangeCounting(
        timeseriesStore.index('source_dataType_date'),
        IDBKeyRange.bound([source], [source, []], false, false),
      );
      const importPromise = this.deleteByIndexRangeCounting(
        importStore.index('source'),
        IDBKeyRange.only(source),
      );

      const [dailyDeleted, timeseriesDeleted, importRecordsDeleted] = await Promise.all([
        dailyPromise,
        timeseriesPromise,
        importPromise,
      ]);

      // Await transaction completion so any failed delete rolls back the batch.
      await this.awaitTransaction(tx);

      return { dailyDeleted, timeseriesDeleted, importRecordsDeleted };
    } catch (error) {
      throw this.wrapError(
        'STORAGE_DELETE_FAILED',
        'delete integration data by source',
        'integration_data',
        source,
        error,
      );
    }
  }

  /**
   * Check whether any integration data exists for a given source.
   *
   * Opens a cursor on the `source` index of `integration_data` and returns
   * `true` if at least one record is found. Efficient: reads at most 1 record.
   */
  async hasIntegrationData(source: string): Promise<boolean> {
    try {
      const store = this.readStore('integration_data');
      const index = store.index('source');

      return await new Promise<boolean>((resolve, reject) => {
        const request = index.openCursor(IDBKeyRange.only(source));
        request.onsuccess = () => {
          resolve(request.result !== null);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      throw this.wrapError(
        'STORAGE_READ_FAILED',
        'check integration data existence',
        'integration_data',
        source,
        error,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Transaction helpers (public for advanced use-cases)
  // -----------------------------------------------------------------------

  /**
   * Create a read-only transaction spanning one or more stores.
   *
   * Useful for coordinated reads across stores.
   */
  createReadTransaction(...stores: StoreName[]): IDBTransaction {
    return this.getDB().transaction(stores, 'readonly');
  }

  /**
   * Create a read-write transaction spanning one or more stores.
   *
   * Useful for atomic writes across multiple stores (e.g., session + events).
   */
  createWriteTransaction(...stores: StoreName[]): IDBTransaction {
    return this.getDB().transaction(stores, 'readwrite');
  }

  /** Wait for a transaction to complete. */
  async awaitTransaction(tx: IDBTransaction): Promise<void> {
    await this.wrapTransaction(tx);
  }

  /**
   * Return the underlying open `IDBDatabase` connection.
   *
   * Exposed for the migration ledger (MigrationService needs the raw handle to
   * read/write the `schema_version` setting and inspect indexes). Throws if the
   * database has not been opened yet.
   */
  getRawDatabase(): IDBDatabase {
    return this.getDB();
  }

  // -----------------------------------------------------------------------
  // Schema creation / upgrade (runs inside onupgradeneeded)
  // -----------------------------------------------------------------------

  /**
   * Dispatch schema work based on the version we are upgrading from.
   *
   * IndexedDB invokes `onupgradeneeded` once with `event.oldVersion` set to the
   * version currently on disk (0 for a brand-new database). Each numbered step
   * below is applied in order so a user on any prior version is brought fully
   * up to date in a single upgrade transaction.
   *
   * @param db          - The database being created/upgraded.
   * @param tx          - The active versionchange transaction (used to reach
   *                      existing object stores). Null only in pathological
   *                      environments; guarded defensively.
   * @param oldVersion  - The on-disk schema version prior to this upgrade.
   */
  private upgradeSchema(db: IDBDatabase, tx: IDBTransaction | null, oldVersion: number): void {
    // Fresh database: build the full schema with the corrected (non-unique)
    // compound indexes. No further steps needed.
    if (oldVersion < 1) {
      this.createSchema(db);
      return;
    }

    // v1 -> v2: existing databases were created with UNIQUE machineId_date
    // indexes (index options are immutable, so they survived in place). Drop
    // and recreate those two indexes as non-unique. Recreating only the index
    // preserves all existing rows — IndexedDB rebuilds the index from the data
    // already in the store.
    if (oldVersion < 2 && tx) {
      this.migrateV1ToV2(db, tx);
    }

    // v2 -> v3: add integration_timeseries and integration_import_history
    // stores; add dataType-aware indexes to integration_data and remove the
    // legacy source_date unique index.
    if (oldVersion < 3) {
      this.migrateV2ToV3(db, tx);
    }
  }

  /**
   * v1 -> v2 migration: convert the two `machineId_date` compound indexes from
   * UNIQUE to non-unique. Idempotent and data-preserving.
   */
  private migrateV1ToV2(db: IDBDatabase, tx: IDBTransaction): void {
    const fixIndex = (storeName: 'sessions' | 'nightly_aggregates'): void => {
      if (!db.objectStoreNames.contains(storeName)) return;
      const store = tx.objectStore(storeName);
      if (store.indexNames.contains('machineId_date')) {
        store.deleteIndex('machineId_date');
      }
      store.createIndex('machineId_date', ['machineId', 'date'], { unique: false });
    };

    fixIndex('sessions');
    fixIndex('nightly_aggregates');
  }

  /**
   * v2 -> v3 migration: add integration stores and dataType-aware indexes.
   *
   * Creates two new object stores (`integration_timeseries`,
   * `integration_import_history`) and updates the existing `integration_data`
   * store by replacing the `source_date` unique index with the more granular
   * `source_dataType_date` compound index and adding a `dataType` index.
   */
  private migrateV2ToV3(db: IDBDatabase, tx: IDBTransaction | null): void {
    // Create new stores
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

    // Update integration_data store indexes
    if (tx && db.objectStoreNames.contains('integration_data')) {
      const store = tx.objectStore('integration_data');
      if (store.indexNames.contains('source_date')) {
        store.deleteIndex('source_date');
      }
      store.createIndex('dataType', 'dataType', { unique: false });
      store.createIndex('source_dataType_date', ['source', 'dataType', 'date'], { unique: true });
    }
  }

  private createSchema(db: IDBDatabase): void {
    // sessions
    const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
    sessions.createIndex('date', 'date', { unique: false });
    sessions.createIndex('machineId', 'machineId', { unique: false });
    // NOTE: must be non-unique. A machine legitimately has multiple sessions
    // per calendar day (SessionBuilder splits on >30-min gaps), so a unique
    // [machineId, date] index would reject every 2nd+ session of a day with a
    // ConstraintError. Used only for per-machine/day range/cursor queries.
    sessions.createIndex('machineId_date', ['machineId', 'date'], { unique: false });

    // nightly_aggregates
    const aggregates = db.createObjectStore('nightly_aggregates', { keyPath: 'id' });
    aggregates.createIndex('sessionId', 'sessionId', { unique: false });
    aggregates.createIndex('date', 'date', { unique: false });
    // NOTE: non-unique for the same reason as sessions.machineId_date above —
    // multiple aggregates can share a [machineId, date] when a day has multiple
    // sessions.
    aggregates.createIndex('machineId_date', ['machineId', 'date'], { unique: false });

    // events
    const events = db.createObjectStore('events', { keyPath: 'id' });
    events.createIndex('sessionId', 'sessionId', { unique: false });
    events.createIndex('sessionId_startTime', ['sessionId', 'timestamp'], { unique: false });
    events.createIndex('type', 'type', { unique: false });

    // analysis_results
    const analysis = db.createObjectStore('analysis_results', { keyPath: 'id' });
    analysis.createIndex('type', 'analysisType', { unique: false });
    analysis.createIndex('type_dateRangeHash', ['analysisType', 'dateRangeHash'], { unique: true });
    analysis.createIndex('computedAt', 'computedAt', { unique: false });

    // settings
    db.createObjectStore('settings', { keyPath: 'key' });

    // import_history
    const imports = db.createObjectStore('import_history', { keyPath: 'id' });
    imports.createIndex('machineId', 'machineId', { unique: false });
    imports.createIndex('importedAt', 'importedAt', { unique: false });

    // integration_data (v3: dataType-aware indexes replace legacy source_date)
    const integration = db.createObjectStore('integration_data', { keyPath: 'id' });
    integration.createIndex('source', 'source', { unique: false });
    integration.createIndex('date', 'date', { unique: false });
    integration.createIndex('dataType', 'dataType', { unique: false });
    integration.createIndex('source_dataType_date', ['source', 'dataType', 'date'], {
      unique: true,
    });

    // integration_timeseries
    const timeseries = db.createObjectStore('integration_timeseries', { keyPath: 'id' });
    timeseries.createIndex('source_dataType_date', ['source', 'dataType', 'date'], {
      unique: true,
    });
    timeseries.createIndex('date', 'date', { unique: false });
    timeseries.createIndex('dataType', 'dataType', { unique: false });

    // integration_import_history
    const integrationImports = db.createObjectStore('integration_import_history', {
      keyPath: 'id',
    });
    integrationImports.createIndex('source', 'source', { unique: false });
    integrationImports.createIndex('importedAt', 'importedAt', { unique: false });
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private getDB(): IDBDatabase {
    if (!this.db) {
      throw new StorageError(
        'STORAGE_NOT_INITIALIZED',
        'Database not initialized. Call open() first.',
        { recoverable: true },
      );
    }
    return this.db;
  }

  /** Open a read-only object store in a single-store transaction. */
  private readStore(name: StoreName): IDBObjectStore {
    return this.getDB().transaction(name, 'readonly').objectStore(name);
  }

  /** Open a read-write object store in a single-store transaction. */
  private writeStore(name: StoreName): IDBObjectStore {
    return this.getDB().transaction(name, 'readwrite').objectStore(name);
  }

  /** Wrap an IDBRequest in a Promise. */
  private wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** Wrap an IDBTransaction completion in a Promise. */
  private wrapTransaction(tx: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted'));
    });
  }

  /**
   * Iterate over an index range using a cursor and collect results.
   *
   * This is the foundation for all date-range and key-range queries.
   */
  private cursorQuery<T>(
    storeName: StoreName,
    indexName: string,
    range: IDBKeyRange,
  ): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      const store = this.readStore(storeName);
      const index = store.index(indexName);
      const results: T[] = [];
      const request = index.openCursor(range);

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          results.push(cursor.value as T);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete every record in `store` whose `indexName` value equals `key`, using
   * a cursor on the given index. The provided `store` MUST already belong to an
   * active readwrite transaction; deletions are enqueued on that transaction and
   * are not committed until the caller awaits the transaction itself.
   */
  private deleteByIndexCursor(
    store: IDBObjectStore,
    indexName: string,
    key: IDBValidKey,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const request = store.index(indexName).openCursor(IDBKeyRange.only(key));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete every record reachable through `index` within `range`, returning the
   * number of records deleted. The index MUST belong to a store in an active
   * readwrite transaction; deletions are enqueued on that transaction and are
   * not committed until the caller awaits the transaction itself.
   *
   * Accepting an already-resolved index (rather than a store + index name) lets
   * callers select the index synchronously up front, keeping a multi-store
   * transaction continuously busy across concurrent sweeps.
   */
  private deleteByIndexRangeCounting(index: IDBIndex, range: IDBKeyRange): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      let deleted = 0;
      const request = index.openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          resolve(deleted);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /** Create a StorageError with consistent formatting. */
  private wrapError(
    code: string,
    operation: string,
    store: string,
    key: string | undefined,
    cause: unknown,
  ): StorageError {
    const keyInfo = key ? ` (key: ${key})` : '';
    return new StorageError(
      code,
      `Failed to ${operation} in "${store}"${keyInfo}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause, context: { store, key } },
    );
  }
}
