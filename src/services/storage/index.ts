/**
 * Storage layer barrel export.
 *
 * Re-exports all storage services and their public types from a single
 * entry point. Import from `@/services/storage` rather than individual files.
 */

// IndexedDB service + storage-specific types
export {
  IndexedDBService,
  StorageError,
  type StoredAnalysisResult,
  type StoredImportRecord,
  type StoredNightlyAggregate,
  type StoredSetting,
} from './IndexedDBService';

// OPFS service
export {
  OPFSError,
  OPFSService,
  type ChannelDescriptor,
  type ChannelInput,
  type ChunkDescriptor,
  type QuotaEstimate,
  type SignalManifest,
} from './OPFSService';

// In-memory LRU cache
export { CacheService } from './CacheService';

// Migration framework
export {
  BackgroundMigrationHandle,
  MigrationError,
  MigrationService,
  MIGRATION_001_INITIAL_SCHEMA,
  MIGRATION_002_NONUNIQUE_MACHINE_DATE,
  type Migration,
  type MigrationCheckpoint,
  type MigrationContext,
  type MigrationProgress,
  type MigrationProgressReporter,
  type MigrationRunResult,
  type MigrationVerificationResult,
  type Savepoint,
  type SavepointState,
} from './MigrationService';
