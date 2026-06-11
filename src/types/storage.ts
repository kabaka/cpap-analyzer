/**
 * Storage and data access types.
 *
 * These types define the records used to track import operations,
 * store external integration data, and abstract over the dual
 * storage backends (IndexedDB + OPFS).
 */

import type { NightlyAggregate, Session } from './session';
import type { Event } from './events';
import type {
  FitbitDailyPayloadMap,
  FitbitDailyType,
  FitbitTimeseriesPayloadMap,
  FitbitTimeseriesType,
} from './fitbit';

/**
 * An error encountered while processing a single file during import.
 */
export interface ImportError {
  /** Name of the file that failed. */
  readonly fileName: string;
  /** Human-readable error description. */
  readonly error: string;
  /** ISO 8601 timestamp when the error occurred. */
  readonly timestamp: string;
}

/**
 * Record of a single data import operation.
 *
 * Tracks what was imported, how many sessions were created or skipped,
 * and any errors encountered during processing.
 */
export interface ImportRecord {
  /** UUID v4 identifier. */
  readonly id: string;
  /** Machine serial number. */
  readonly machineId: string;
  /** Machine model name (e.g., "AirSense 10 AutoSet"). */
  readonly machineModel: string;
  /** ISO 8601 timestamp when the import was performed. */
  readonly importedAt: string;
  /** Start of the imported date range (YYYY-MM-DD). */
  readonly dateRangeStart: string;
  /** End of the imported date range (YYYY-MM-DD). */
  readonly dateRangeEnd: string;
  /** Number of sessions successfully imported. */
  readonly sessionsImported: number;
  /** Number of sessions skipped (duplicate detection). */
  readonly sessionsSkipped: number;
  /** Number of sessions that failed to import. */
  readonly sessionsErrored: number;
  /** Hash of the import source (SD card identifier). */
  readonly sourceHash: string;
  /** Total import duration in seconds. */
  readonly durationSeconds: number;
  /** Errors encountered during import. */
  readonly errors: ImportError[];
}

/**
 * External data linked to therapy sessions.
 *
 * Stores data fetched from integration services (Fitbit, weather, etc.)
 * keyed by date for correlation with CPAP sessions.
 */
export interface IntegrationData {
  /** UUID v4 identifier. */
  readonly id: string;
  /** Integration source identifier. */
  readonly source: 'fitbit' | 'weather' | 'pollen' | 'user';
  /** ISO date string (YYYY-MM-DD) this data corresponds to. */
  readonly date: string;
  /** Source-specific data structure. */
  readonly data: unknown;
  /** ISO 8601 timestamp when this data was imported. */
  readonly importedAt: string;
}

/** Extended integration source type. */
export type IntegrationSource = 'fitbit' | 'weather' | 'pollen' | 'user';

/**
 * Daily summary record for integration data.
 *
 * Discriminated by dataType for type-safe payload access.
 */
export interface IntegrationDailySummary<T extends FitbitDailyType = FitbitDailyType> {
  readonly id: string;
  readonly source: IntegrationSource;
  readonly dataType: T;
  /** YYYY-MM-DD */
  readonly date: string;
  readonly data: T extends keyof FitbitDailyPayloadMap ? FitbitDailyPayloadMap[T] : unknown;
  readonly importedAt: string;
}

/**
 * Intra-night timeseries record. One record per date per data type.
 */
export interface IntegrationTimeseries<T extends FitbitTimeseriesType = FitbitTimeseriesType> {
  readonly id: string;
  readonly source: IntegrationSource;
  readonly dataType: T;
  /** YYYY-MM-DD */
  readonly date: string;
  readonly data: T extends keyof FitbitTimeseriesPayloadMap
    ? FitbitTimeseriesPayloadMap[T]
    : unknown;
  readonly importedAt: string;
}

/**
 * Record of a Google Health import operation.
 */
export interface IntegrationImportRecord {
  readonly id: string;
  readonly source: IntegrationSource;
  readonly importedAt: string;
  readonly dateRangeStart: string;
  readonly dateRangeEnd: string;
  readonly dataTypes: readonly string[];
  readonly recordsImported: number;
  readonly recordsSkipped: number;
  readonly recordsErrored: number;
  readonly errors: readonly ImportError[];
  readonly durationSeconds: number;
  readonly fileHashes: readonly string[];
}

/** Date range for data queries (ISO date strings). */
interface StorageDateRange {
  readonly start: string;
  readonly end: string;
}

/**
 * Abstraction over the dual storage backends (IndexedDB + OPFS).
 *
 * Provides a unified interface for reading therapy data regardless
 * of the underlying storage mechanism. Metadata and aggregates live
 * in IndexedDB; high-frequency signal data lives in OPFS.
 */
export interface DataProvider {
  /** Retrieve all sessions within the given date range. */
  getSessions(range: StorageDateRange): Promise<Session[]>;
  /** Retrieve a single session by ID, or null if not found. */
  getSession(id: string): Promise<Session | null>;
  /** Retrieve nightly aggregates within the given date range. */
  getNightlyAggregates(range: StorageDateRange): Promise<NightlyAggregate[]>;
  /** Retrieve all events for a session. */
  getEvents(sessionId: string): Promise<Event[]>;
  /** Retrieve raw signal data for a specific channel as a Float32Array. */
  getSignalData(sessionId: string, channel: string): Promise<Float32Array>;
}
