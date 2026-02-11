# Storage Architecture

This document specifies the complete client-side storage architecture for the CPAP Analyzer. It defines how multi-year, high-frequency CPAP therapy data is stored, indexed, queried, and managed entirely within the browser.

**Target audience**: Frontend, Database, Performance, and ResMed Specialist agents.

**Last updated**: 2026-02-10

---

## 1. Storage Technology Choices

### 1.1 Technology Split Rationale

| Store        | Technology                        | Purpose                                                                          | Rationale                                                                                                                                              |
| ------------ | --------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Metadata** | IndexedDB                         | Session metadata, nightly aggregates, settings, analysis results, import history | Structured queryable data with complex indices. Native transaction support. Cross-browser compatibility.                                               |
| **Signals**  | OPFS (Origin Private File System) | High-resolution time-series data (25–50 Hz)                                      | High-throughput binary I/O. Direct file system access. Lower overhead than IndexedDB for large blobs. Better performance for streaming/chunked access. |

#### Why Not Alternatives?

**LocalStorage**: Synchronous API blocks main thread. 5–10 MB limit. Not suitable.

**IndexedDB for everything**: Good for structured data but inefficient for large binary blobs. Transaction overhead for signal data would degrade performance. Chunked streaming is cumbersome.

**OPFS for everything**: No built-in indexing. Query patterns for metadata would require custom index files. IndexedDB's native querying is superior for structured data.

**Cache API**: Designed for HTTP caching, not structured storage. No transaction support. Not intended for application data.

**File System Access API**: Requires user permission for each directory. User must manually select location. Not suitable for persistent app storage. (But used for reading SD card input.)

### 1.2 Storage Capacity Planning

**Per-Night Raw Data**:

- Flow: 25 Hz × 8 hrs × 3,600 s = 720,000 samples
- MaskPress: 25 Hz × 8 hrs × 3,600 s = 720,000 samples
- Leak: 2 Hz × 8 hrs × 3,600 s = 57,600 samples
- Low-frequency channels: ~3 × 2,880 samples
- **Total samples per night**: ~1.5 million
- **Storage (Float32)**: ~6 MB per night

**Long-Term Storage**:
| Timeframe | Signal Data | Metadata | Total |
|-----------|-------------|----------|-------|
| 1 month | ~180 MB | ~50 KB | ~180 MB |
| 1 year | ~2.2 GB | ~600 KB | ~2.2 GB |
| 5 years | ~11 GB | ~3 MB | ~11 GB |
| 10 years | ~22 GB | ~6 MB | ~22 GB |

**Browser Quota**: Modern browsers typically allow ~60% of available disk space for OPFS. On a 256 GB device, this permits ~150 GB — sufficient for decades of data.

### 1.3 Browser Compatibility Matrix

| Feature                | Chrome | Edge   | Safari   | Firefox | Notes                                  |
| ---------------------- | ------ | ------ | -------- | ------- | -------------------------------------- |
| IndexedDB              | ✅ 24+ | ✅ All | ✅ 10+   | ✅ 16+  | Universal support, battle-tested       |
| OPFS                   | ✅ 86+ | ✅ 86+ | ✅ 15.2+ | ✅ 111+ | Safari required workarounds pre-16     |
| Storage API            | ✅ 55+ | ✅ 79+ | ✅ 15.2+ | ✅ 57+  | For quota queries                      |
| FileReader             | ✅ All | ✅ All | ✅ All   | ✅ All  | For EDF file parsing                   |
| File System Access API | ✅ 86+ | ✅ 86+ | ❌       | ❌      | SD card access, fallback to file input |

**Minimum browser support**: Chrome/Edge 86+, Safari 15.2+, Firefox 111+ for full feature set. Fallback strategies for older browsers.

---

## 2. IndexedDB Schema

### 2.1 Database Structure

**Database name**: `cpap-analyzer`

**Schema version**: `1` (tracked in Settings store)

**Object Stores**:

1. `sessions` — Session metadata
2. `nightly_aggregates` — Pre-computed nightly metrics
3. `events` — Event-level data (apneas, hypopneas, etc.)
4. `analysis_results` — Cached analysis computations
5. `settings` — User preferences and app configuration
6. `import_history` — Import tracking for incremental imports
7. `integration_data` — Fitbit, weather, and other integration data

### 2.2 Object Store: `sessions`

**Key path**: `id` (UUID v4)

**Indexes**:

- `date` (non-unique) — For date range queries
- `machineId` (non-unique) — For multi-machine users
- `[machineId+date]` (unique, compound) — Deduplication

**Schema**:

```typescript
interface Session {
  id: string; // UUID v4
  machineId: string; // Machine serial number
  machineModel: string; // e.g., "AirSense 10 AutoSet"
  firmwareVersion: string; // e.g., "3.0.2"
  date: string; // YYYY-MM-DD (local date)
  startTime: string; // ISO 8601 timestamp
  endTime: string; // ISO 8601 timestamp
  durationMinutes: number; // Total session duration
  usageMinutes: number; // Actual usage time (may differ if mask-off)
  importedAt: string; // ISO 8601 timestamp
  sourceHash: string; // SHA-256 of source EDF files (concat)
  channels: ChannelMetadata[]; // Available signal channels
  signalChunkIds: string[]; // OPFS chunk file references
  hasOximetry: boolean; // SpO2 data available
  deleted: boolean; // Soft delete flag
}

interface ChannelMetadata {
  name: string; // "Flow", "MaskPress", etc.
  sampleRate: number; // Hz
  unit: string; // "L/min", "cmH2O", etc.
  physicalMin: number; // EDF physical minimum
  physicalMax: number; // EDF physical maximum
  digitalMin: number; // EDF digital minimum
  digitalMax: number; // EDF digital maximum
}
```

### 2.3 Object Store: `nightly_aggregates`

**Key path**: `id` (UUID v4)

**Indexes**:

- `sessionId` (non-unique) — For session lookups
- `date` (non-unique) — For date range queries
- `[machineId+date]` (unique, compound) — For machine-specific queries

**Schema**:

```typescript
interface NightlyAggregate {
  id: string;
  sessionId: string; // FK → sessions.id
  machineId: string; // Denormalized for efficient queries
  date: string; // YYYY-MM-DD

  // AHI metrics
  ahi: number; // Total AHI (events/hour)
  ahiObstructive: number;
  ahiCentral: number;
  ahiMixed: number;
  ahiHypopnea: number;
  ahiRera: number;

  // Event counts
  eventCount: number;
  eventsByType: {
    obstructive: number;
    central: number;
    mixed: number;
    hypopnea: number;
    rera: number;
    flowLimitation: number;
    largeLeak: number;
    periodicBreathing: number;
  };

  // Pressure metrics
  pressureMean: number; // cmH2O
  pressureMedian: number;
  pressureP95: number;
  pressureMax: number;
  epapMedian: number | null; // null for fixed-pressure CPAP
  ipapMedian: number | null; // null for CPAP (BiPAP only)
  pressureSupport: number | null; // IPAP - EPAP

  // Leak metrics
  leakMedian: number; // L/min
  leakP95: number;
  leakMax: number;
  leakDurationMinutes: number; // Time with leak > 24 L/min

  // Respiratory metrics
  tidalVolumeMean: number | null;
  tidalVolumeMedian: number | null;
  minuteVentMean: number | null;
  respRateMean: number | null;
  respRateMedian: number | null;

  // Oximetry (if available)
  spo2Mean: number | null;
  spo2Median: number | null;
  spo2Min: number | null;
  spo2Below90Percent: number | null; // % of time SpO2 < 90%
  oxygenDesaturationIndex: number | null; // ODI

  // Usage
  usageHours: number;
  maskOnTimeMinutes: number;
  complianceStatus: 'compliant' | 'non-compliant' | 'partial';

  // User notes
  notes: string;
  tags: string[];
}
```

### 2.4 Object Store: `events`

**Key path**: `id` (UUID v4)

**Indexes**:

- `sessionId` (non-unique) — For session lookups
- `[sessionId+timestamp]` (non-unique, compound) — For time-ordered retrieval
- `type` (non-unique) — For filtering by event type

**Schema**:

```typescript
interface Event {
  id: string;
  sessionId: string; // FK → sessions.id
  type: EventType;
  timestamp: number; // Epoch milliseconds (UTC)
  duration: number; // seconds
  severity: number | null; // 0–1 for flow limitation
  pressure: number | null; // cmH2O at event time
  epap: number | null; // cmH2O at event time
  ipap: number | null; // cmH2O at event time (BiPAP only)
  leak: number | null; // L/min at event time
  spo2: number | null; // % at event time (if oximetry)
  clusterId: string | null; // FK → cluster ID (computed)
}

type EventType =
  | 'ObstructiveApnea'
  | 'CentralApnea'
  | 'MixedApnea'
  | 'Hypopnea'
  | 'RERA'
  | 'FlowLimitation'
  | 'LargeLeak'
  | 'PeriodicBreathing'
  | 'ClearAirway'
  | 'Vibratory' // Snoring
  | 'ChecksumError';
```

### 2.5 Object Store: `analysis_results`

**Key path**: `id` (UUID v4)

**Indexes**:

- `analysisType` (non-unique) — For type-based lookups
- `[analysisType+dateRangeHash]` (unique, compound) — For cache hits
- `computedAt` (non-unique) — For cache expiration

**Schema**:

```typescript
interface AnalysisResult {
  id: string;
  analysisType: string; // e.g., "stl-decomposition", "correlation-matrix"
  dateRange: {
    start: string; // YYYY-MM-DD
    end: string; // YYYY-MM-DD
  };
  dateRangeHash: string; // MD5 of date range for efficient lookup
  parameters: Record<string, unknown>; // Analysis configuration
  results: unknown; // Structured results (type varies by analysis)
  computedAt: string; // ISO 8601 timestamp
  cacheVersion: number; // Invalidate on algorithm changes
  machineIds: string[]; // Machines included in analysis
}
```

**Cache invalidation**: When new data is imported for a date range that overlaps an existing analysis result, delete affected analysis results.

### 2.6 Object Store: `settings`

**Key path**: `key`

**No indexes** (small, scanned in full)

**Schema**:

```typescript
interface Setting {
  key: string;
  value: unknown; // JSON-serializable value
  updatedAt: string; // ISO 8601 timestamp
}

// Common settings:
// - "schema_version": number
// - "theme": "light" | "dark" | "auto"
// - "analysis_defaults": Record<string, unknown>
// - "quota_warning_threshold": number (bytes)
// - "retention_policy": { maxAgeMonths: number }
// - "fitbit_token": { ... } (encrypted)
```

### 2.7 Object Store: `import_history`

**Key path**: `id` (UUID v4)

**Indexes**:

- `machineId` (non-unique) — For machine-specific queries
- `importedAt` (non-unique) — For chronological sorting

**Schema**:

```typescript
interface ImportRecord {
  id: string;
  machineId: string;
  machineModel: string;
  importedAt: string; // ISO 8601 timestamp
  dateRangeStart: string; // YYYY-MM-DD
  dateRangeEnd: string; // YYYY-MM-DD
  sessionsImported: number;
  sessionsSkipped: number; // Already imported (duplicate detection)
  sessionsErrored: number;
  sourceHash: string; // Hash of import source (SD card identifier)
  durationSeconds: number;
  errors: ImportError[];
}

interface ImportError {
  fileName: string;
  error: string;
  timestamp: string;
}
```

### 2.8 Object Store: `integration_data`

**Key path**: `id` (UUID v4)

**Indexes**:

- `source` (non-unique) — "fitbit", "weather", etc.
- `date` (non-unique) — For date range queries
- `[source+date]` (unique, compound) — Deduplication

**Schema**:

```typescript
interface IntegrationData {
  id: string;
  source: 'fitbit' | 'weather' | 'pollen' | 'user';
  date: string; // YYYY-MM-DD
  data: unknown; // Source-specific structure
  importedAt: string; // ISO 8601 timestamp
}

// Example Fitbit data structure:
interface FitbitDayData {
  heartRate: { time: string; value: number }[]; // 1-minute intervals
  restingHeartRate: number;
  hrv: number | null; // RMSSD
  spo2: { time: string; value: number }[]; // 5-minute intervals
  sleepStages: {
    deep: number; // minutes
    light: number;
    rem: number;
    wake: number;
  };
  sleepEfficiency: number; // percent
}

// Example weather data structure:
interface WeatherDayData {
  temperature: { time: string; value: number }[]; // hourly
  humidity: { time: string; value: number }[]; // hourly
  pressure: { time: string; value: number }[]; // hourly (hPa)
  aqi: { time: string; value: number }[]; // hourly
  pollenCount: number | null; // daily
}
```

---

## 3. Schema Versioning and Migration Strategy

### 3.1 Overview

The CPAP Analyzer storage layer must support schema evolution as new features are added, data structures are optimized, and storage formats change. This section defines the complete migration strategy from version detection through execution, testing, and user communication.

**Design Principles**:

- **Zero data loss**: Migrations must never delete or corrupt user data
- **Fail-safe**: Failed migrations must be detectable and recoverable
- **Resumable**: Long-running migrations must support pause/resume
- **Transparent**: Users must understand what's happening and why
- **Performance-aware**: Migrations should not block app usage when possible

### 3.2 Version Detection and Startup Flow

**On Application Startup**:

```typescript
async function initializeStorage(): Promise<void> {
  // 1. Open IndexedDB to detect schema version
  const db = await openDatabase();
  const currentSchemaVersion = await getCurrentSchemaVersion(db);
  const appSchemaVersion = APP_SCHEMA_VERSION; // Current app version

  // 2. Determine if migration is required
  if (currentSchemaVersion === appSchemaVersion) {
    // No migration needed
    return;
  } else if (currentSchemaVersion > appSchemaVersion) {
    // Data is from newer app version - incompatible
    throw new IncompatibleVersionError(
      `Data schema version ${currentSchemaVersion} is newer than app version ${appSchemaVersion}. ` +
        `Please update the application.`,
    );
  } else {
    // Migration required
    await runMigrationPipeline(currentSchemaVersion, appSchemaVersion);
  }

  // 3. Verify post-migration integrity
  await verifyDataIntegrity();
}

async function getCurrentSchemaVersion(db: IDBDatabase): Promise<number> {
  const tx = db.transaction('settings', 'readonly');
  const settings = tx.objectStore('settings');
  const versionRecord = await settings.get('schema_version');
  return versionRecord?.value ?? 1; // Default to version 1
}
```

### 3.3 Migration Execution Framework

**Migration Runner Architecture**:

```typescript
interface Migration {
  version: number; // Target version this migration produces
  description: string; // Human-readable description
  estimatedDurationMs: number; // For progress calculation
  dependencies: number[]; // Must run after these versions
  up: MigrationFunction; // Forward migration
  down: MigrationFunction; // Rollback (optional, best-effort)
  verify: VerificationFunction; // Post-migration integrity check
}

type MigrationFunction = (context: MigrationContext) => Promise<void>;

type VerificationFunction = (context: MigrationContext) => Promise<MigrationVerificationResult>;

interface MigrationContext {
  db: IDBDatabase; // IndexedDB connection
  opfsRoot: FileSystemDirectoryHandle; // OPFS root directory
  progress: MigrationProgressReporter;
  signal: AbortSignal; // For cancellation
  storage: Map<string, unknown>; // Pass data between migrations
}

interface MigrationProgressReporter {
  setTotal(items: number): void;
  setProgress(items: number): void;
  setMessage(message: string): void;
}

interface MigrationVerificationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
}
```

**Migration Registry**:

```typescript
// src/storage/migrations/registry.ts
const MIGRATIONS: Migration[] = [
  migration_001_add_tags_to_sessions,
  migration_002_add_oximetry_indices,
  migration_003_compressed_signal_chunks,
  migration_004_add_integration_store,
  migration_005_expand_event_types,
  // ... future migrations
];

function getMigrationsToRun(fromVersion: number, toVersion: number): Migration[] {
  // Get all migrations between versions
  const migrations = MIGRATIONS.filter((m) => m.version > fromVersion && m.version <= toVersion);

  // Sort by version (and dependency order)
  return topologicalSort(migrations);
}

function topologicalSort(migrations: Migration[]): Migration[] {
  const sorted: Migration[] = [];
  const visited = new Set<number>();

  function visit(migration: Migration) {
    if (visited.has(migration.version)) return;

    // Visit dependencies first
    for (const depVersion of migration.dependencies) {
      const dep = migrations.find((m) => m.version === depVersion);
      if (dep) visit(dep);
    }

    visited.add(migration.version);
    sorted.push(migration);
  }

  migrations.forEach(visit);
  return sorted;
}
```

**Migration Execution Pipeline**:

```typescript
async function runMigrationPipeline(fromVersion: number, toVersion: number): Promise<void> {
  const migrations = getMigrationsToRun(fromVersion, toVersion);

  if (migrations.length === 0) {
    return; // No migrations needed
  }

  // Show migration UI
  const ui = await showMigrationUI(migrations);
  const abortController = new AbortController();

  try {
    // Create migration context
    const db = await openDatabase();
    const opfsRoot = await navigator.storage.getDirectory();
    const context: MigrationContext = {
      db,
      opfsRoot,
      progress: ui.progressReporter,
      signal: abortController.signal,
      storage: new Map(),
    };

    // Execute migrations in order
    for (const migration of migrations) {
      ui.setCurrentMigration(migration);

      // Create savepoint (logical, not database-level)
      const savepoint = await createSavepoint(context);

      try {
        // Run migration
        await migration.up(context);

        // Verify migration
        const verification = await migration.verify(context);
        if (!verification.success) {
          throw new MigrationError(
            `Migration ${migration.version} verification failed: ${verification.errors.join(', ')}`,
          );
        }

        // Update schema version
        await updateSchemaVersion(db, migration.version);

        // Commit savepoint
        await commitSavepoint(savepoint);
      } catch (error) {
        // Rollback to savepoint
        ui.showError(migration, error);
        if (migration.down) {
          await migration.down(context);
        }
        await rollbackToSavepoint(savepoint);
        throw new MigrationError(`Migration ${migration.version} failed: ${error.message}`, {
          cause: error,
        });
      }
    }

    ui.showSuccess();
  } finally {
    ui.close();
  }
}

async function updateSchemaVersion(db: IDBDatabase, version: number): Promise<void> {
  const tx = db.transaction('settings', 'readwrite');
  const settings = tx.objectStore('settings');
  await settings.put({
    key: 'schema_version',
    value: version,
    updatedAt: new Date().toISOString(),
  });
  await tx.complete;
}
```

### 3.4 Migration Types

#### 3.4.1 IndexedDB Schema Migrations

**Adding a New Object Store**:

```typescript
const migration_004_add_integration_store: Migration = {
  version: 4,
  description: 'Add integration_data store for external data sources',
  estimatedDurationMs: 100,
  dependencies: [],

  async up(context) {
    const { db } = context;

    // Note: IndexedDB schema changes require version upgrade
    // This is handled in the onupgradeneeded handler
    // Here we just ensure the store exists
    if (!db.objectStoreNames.contains('integration_data')) {
      // This should not happen if version upgrade is handled correctly
      throw new Error('integration_data store was not created during version upgrade');
    }

    context.progress.setMessage('Integration data store created');
  },

  async down(context) {
    // Cannot delete object stores after database is opened
    // Must be done in version upgrade handler
    throw new Error('Cannot rollback IndexedDB schema changes');
  },

  async verify(context) {
    const { db } = context;
    const exists = db.objectStoreNames.contains('integration_data');
    return {
      success: exists,
      errors: exists ? [] : ['integration_data store does not exist'],
      warnings: [],
    };
  },
};

// Companion onupgradeneeded handler:
function onUpgradeNeeded(event: IDBVersionChangeEvent) {
  const db = (event.target as IDBOpenDBRequest).result;
  const oldVersion = event.oldVersion;

  if (oldVersion < 4) {
    const store = db.createObjectStore('integration_data', { keyPath: 'id' });
    store.createIndex('source', 'source', { unique: false });
    store.createIndex('date', 'date', { unique: false });
    store.createIndex('source+date', ['source', 'date'], { unique: true });
  }
}
```

**Adding a New Index**:

```typescript
const migration_001_add_tags_to_sessions: Migration = {
  version: 2,
  description: 'Add tags array to sessions for user categorization',
  estimatedDurationMs: 5000,
  dependencies: [],

  async up(context) {
    const { db, progress } = context;

    // Add tags field to all existing sessions
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const sessions = await store.getAll();

    progress.setTotal(sessions.length);
    progress.setMessage('Adding tags field to sessions');

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      session.tags = session.tags || [];
      await store.put(session);
      progress.setProgress(i + 1);
    }

    await tx.complete;
  },

  async down(context) {
    const { db } = context;

    // Remove tags field from all sessions
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const sessions = await store.getAll();

    for (const session of sessions) {
      delete session.tags;
      await store.put(session);
    }

    await tx.complete;
  },

  async verify(context) {
    const { db } = context;

    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const sessions = await store.getAll();

    const errors: string[] = [];
    sessions.forEach((session, i) => {
      if (!Array.isArray(session.tags)) {
        errors.push(`Session ${i} missing tags array`);
      }
    });

    return {
      success: errors.length === 0,
      errors,
      warnings: [],
    };
  },
};
```

#### 3.4.2 OPFS File Format Migrations

**Changing Signal Chunk Format**:

```typescript
const migration_003_compressed_signal_chunks: Migration = {
  version: 3,
  description: 'Compress signal chunks using zstd for 60% storage reduction',
  estimatedDurationMs: 300000, // 5 minutes for typical dataset
  dependencies: [],

  async up(context) {
    const { db, opfsRoot, progress, signal } = context;

    // Get all sessions with signal data
    const tx = db.transaction('sessions', 'readonly');
    const sessions = await tx.objectStore('sessions').getAll();
    const sessionsWithSignals = sessions.filter((s) => s.signalChunkIds.length > 0);

    progress.setTotal(sessionsWithSignals.length);
    progress.setMessage('Compressing signal chunks');

    const signalsDir = await opfsRoot.getDirectoryHandle('signals');

    for (let i = 0; i < sessionsWithSignals.length; i++) {
      if (signal.aborted) throw new Error('Migration cancelled');

      const session = sessionsWithSignals[i];
      const sessionDir = await signalsDir.getDirectoryHandle(session.id);

      // Read manifest
      const manifestFile = await sessionDir.getFileHandle('manifest.json');
      const manifestData = await (await manifestFile.getFile()).text();
      const manifest = JSON.parse(manifestData);

      // Check if already compressed
      if (manifest.compression === 'zstd') {
        progress.setProgress(i + 1);
        continue;
      }

      // Compress each chunk
      for (const chunkFile of manifest.chunks) {
        const handle = await sessionDir.getFileHandle(chunkFile.filename);
        const file = await handle.getFile();
        const arrayBuffer = await file.arrayBuffer();

        // Compress using zstd
        const compressed = await compressZstd(arrayBuffer);

        // Write compressed version
        const writable = await handle.createWritable();
        await writable.write(compressed);
        await writable.close();

        // Update chunk metadata
        chunkFile.compressedSize = compressed.byteLength;
      }

      // Update manifest
      manifest.compression = 'zstd';
      manifest.version = 3;
      const manifestWritable = await manifestFile.createWritable();
      await manifestWritable.write(JSON.stringify(manifest, null, 2));
      await manifestWritable.close();

      progress.setProgress(i + 1);
    }
  },

  async down(context) {
    const { db, opfsRoot, progress } = context;

    // Decompress all chunks back to raw format
    const tx = db.transaction('sessions', 'readonly');
    const sessions = await tx.objectStore('sessions').getAll();
    const sessionsWithSignals = sessions.filter((s) => s.signalChunkIds.length > 0);

    progress.setTotal(sessionsWithSignals.length);
    const signalsDir = await opfsRoot.getDirectoryHandle('signals');

    for (const session of sessionsWithSignals) {
      const sessionDir = await signalsDir.getDirectoryHandle(session.id);
      const manifestFile = await sessionDir.getFileHandle('manifest.json');
      const manifestData = await (await manifestFile.getFile()).text();
      const manifest = JSON.parse(manifestData);

      if (manifest.compression !== 'zstd') continue;

      for (const chunkFile of manifest.chunks) {
        const handle = await sessionDir.getFileHandle(chunkFile.filename);
        const file = await handle.getFile();
        const compressed = await file.arrayBuffer();
        const decompressed = await decompressZstd(compressed);

        const writable = await handle.createWritable();
        await writable.write(decompressed);
        await writable.close();
      }

      manifest.compression = 'none';
      manifest.version = 2;
      const manifestWritable = await manifestFile.createWritable();
      await manifestWritable.write(JSON.stringify(manifest, null, 2));
      await manifestWritable.close();
    }
  },

  async verify(context) {
    const { db, opfsRoot } = context;

    const tx = db.transaction('sessions', 'readonly');
    const sessions = await tx.objectStore('sessions').getAll();
    const errors: string[] = [];
    const warnings: string[] = [];

    const signalsDir = await opfsRoot.getDirectoryHandle('signals');

    for (const session of sessions) {
      if (session.signalChunkIds.length === 0) continue;

      try {
        const sessionDir = await signalsDir.getDirectoryHandle(session.id);
        const manifestFile = await sessionDir.getFileHandle('manifest.json');
        const manifestData = await (await manifestFile.getFile()).text();
        const manifest = JSON.parse(manifestData);

        if (manifest.compression !== 'zstd') {
          warnings.push(`Session ${session.id} not compressed`);
        }

        if (manifest.version !== 3) {
          errors.push(`Session ${session.id} manifest version mismatch`);
        }
      } catch (error) {
        errors.push(`Session ${session.id} verification failed: ${error.message}`);
      }
    }

    return {
      success: errors.length === 0,
      errors,
      warnings,
    };
  },
};
```

#### 3.4.3 Metadata Structure Migrations

Handled similarly to IndexedDB migrations - update field structures, add/remove fields, transform data shapes.

#### 3.4.4 Backwards Compatibility Windows

**Policy**:

- **Current version (N)**: Reads data from versions N, N-1, N-2
- **Grace period**: 6 months (approximately 6 releases on monthly cadence)
- **After grace period**: Force migration on app startup

**Implementation**:

```typescript
const BACKWARDS_COMPATIBILITY_VERSIONS = 3;

function isDataCompatible(dataVersion: number, appVersion: number): boolean {
  return dataVersion >= appVersion - BACKWARDS_COMPATIBILITY_VERSIONS && dataVersion <= appVersion;
}

function shouldForceMigration(dataVersion: number, appVersion: number): boolean {
  return dataVersion < appVersion - BACKWARDS_COMPATIBILITY_VERSIONS;
}
```

### 3.5 Progressive Migration Strategies

#### 3.5.1 Lazy Migration (Migrate-on-Access)

For non-critical structure changes, migrate data only when accessed:

```typescript
async function getSession(id: string): Promise<Session> {
  const raw = await getRawSession(id);

  // Check if session needs migration
  if (raw._version < CURRENT_SESSION_VERSION) {
    const migrated = await migrateSession(raw);
    await saveSession(migrated);
    return migrated;
  }

  return raw;
}
```

**Use cases**:

- Adding optional fields
- Changing display formats
- Non-indexed field transformations

#### 3.5.2 Background Migration (Non-Blocking)

For large migrations that don't affect immediate app usage:

```typescript
async function startBackgroundMigration(
  migration: Migration,
  context: MigrationContext,
): Promise<BackgroundMigrationHandle> {
  const worker = new Worker('/workers/migrator.js');
  const handle = new BackgroundMigrationHandle(worker);

  worker.postMessage({
    type: 'START_MIGRATION',
    migration: migration,
    context: serializeContext(context),
  });

  // App continues running
  // Migration progresses in background
  // User can check status via handle

  return handle;
}

class BackgroundMigrationHandle {
  constructor(private worker: Worker) {}

  async getProgress(): Promise<MigrationProgress> {
    return new Promise((resolve) => {
      this.worker.postMessage({ type: 'GET_PROGRESS' });
      this.worker.addEventListener(
        'message',
        (event) => {
          if (event.data.type === 'PROGRESS') {
            resolve(event.data.progress);
          }
        },
        { once: true },
      );
    });
  }

  async pause(): Promise<void> {
    this.worker.postMessage({ type: 'PAUSE' });
  }

  async resume(): Promise<void> {
    this.worker.postMessage({ type: 'RESUME' });
  }

  async cancel(): Promise<void> {
    this.worker.postMessage({ type: 'CANCEL' });
    this.worker.terminate();
  }
}
```

**Use cases**:

- Signal format optimization (compression)
- Index rebuilding
- Cache regeneration

#### 3.5.3 Batch Migration with Pause/Resume

For migrations that process large numbers of items:

```typescript
interface MigrationCheckpoint {
  migrationVersion: number;
  lastProcessedId: string | null;
  itemsProcessed: number;
  itemsTotal: number;
  startedAt: string;
  state: 'running' | 'paused' | 'failed';
}

async function batchMigration(
  migration: Migration,
  context: MigrationContext,
  batchSize: number = 100,
): Promise<void> {
  // Load checkpoint if exists
  let checkpoint = await loadCheckpoint(migration.version);

  if (!checkpoint) {
    checkpoint = {
      migrationVersion: migration.version,
      lastProcessedId: null,
      itemsProcessed: 0,
      itemsTotal: await countItems(context),
      startedAt: new Date().toISOString(),
      state: 'running',
    };
  }

  // Process in batches
  while (checkpoint.itemsProcessed < checkpoint.itemsTotal) {
    if (context.signal.aborted) {
      checkpoint.state = 'paused';
      await saveCheckpoint(checkpoint);
      throw new Error('Migration paused');
    }

    // Process next batch
    const items = await getNextBatch(context, checkpoint.lastProcessedId, batchSize);

    for (const item of items) {
      await migration.up(context, item);
      checkpoint.lastProcessedId = item.id;
      checkpoint.itemsProcessed++;
    }

    // Save progress
    await saveCheckpoint(checkpoint);
    context.progress.setProgress(checkpoint.itemsProcessed);

    // Yield to prevent blocking
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // Complete
  await deleteCheckpoint(migration.version);
}
```

### 3.6 Version Compatibility Matrix

| App Version    | Can Read Data Versions | Must Migrate Versions | Grace Period Ends |
| -------------- | ---------------------- | --------------------- | ----------------- |
| 2026.02.1 (v1) | 1                      | —                     | —                 |
| 2026.03.1 (v2) | 1-2                    | —                     | 2026.09.1         |
| 2026.04.1 (v3) | 1-3                    | —                     | 2026.10.1         |
| 2026.05.1 (v4) | 2-4                    | 1                     | 2026.11.1         |
| 2026.06.1 (v5) | 3-5                    | 1-2                   | 2026.12.1         |

**Breaking Change Policy**:

- Breaking changes require major version increment
- Minimum 6 months notice via in-app warnings
- Clear migration path documented
- Export/import tool provided for manual migration

**Example Warning**:

```typescript
async function checkVersionDeprecation(): Promise<void> {
  const dataVersion = await getCurrentSchemaVersion();
  const appVersion = APP_SCHEMA_VERSION;

  if (dataVersion < appVersion - 2) {
    showWarning(
      'Your data will require migration soon',
      `You are using data version ${dataVersion}, but the app is on version ${appVersion}. ` +
        `Support for version ${dataVersion} will end on ${getGracePeriodEnd(dataVersion)}. ` +
        `Please run the migration tool in Settings > Storage > Migrate Data.`,
    );
  }
}
```

### 3.7 User Communication

#### 3.7.1 Migration UI Components

**Migration Dialog**:

```typescript
interface MigrationUIProps {
  migrations: Migration[];
  onStart: () => void;
  onCancel: () => void;
}

function MigrationDialog({ migrations, onStart, onCancel }: MigrationUIProps) {
  const totalEstimatedMs = migrations.reduce(
    (sum, m) => sum + m.estimatedDurationMs,
    0
  );
  const estimatedMinutes = Math.ceil(totalEstimatedMs / 60000);

  return (
    <Dialog>
      <DialogTitle>Data Migration Required</DialogTitle>
      <DialogContent>
        <Typography>
          The application needs to update your data storage format to support new features.
        </Typography>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2">Changes:</Typography>
          <List>
            {migrations.map(m => (
              <ListItem key={m.version}>
                <ListItemText primary={m.description} />
              </ListItem>
            ))}
          </List>
        </Box>

        <Alert severity="info">
          <Typography>
            Estimated time: {estimatedMinutes} minute{estimatedMinutes !== 1 ? 's' : ''}
          </Typography>
          <Typography variant="body2">
            Do not close the browser during migration. Your data will not be deleted.
          </Typography>
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={onStart} variant="contained">Start Migration</Button>
      </DialogActions>
    </Dialog>
  );
}
```

**Progress Indicator**:

```typescript
interface MigrationProgressProps {
  currentMigration: Migration;
  progress: number; // 0-1
  message: string;
  itemsProcessed: number;
  itemsTotal: number;
  timeElapsed: number; // seconds
  timeRemaining: number | null; // seconds
}

function MigrationProgress(props: MigrationProgressProps) {
  return (
    <Box>
      <Typography variant="h6">
        Migrating: {props.currentMigration.description}
      </Typography>

      <LinearProgress
        variant="determinate"
        value={props.progress * 100}
        sx={{ my: 2 }}
      />

      <Typography variant="body2" color="text.secondary">
        {props.message}
      </Typography>

      <Typography variant="body2" color="text.secondary">
        {props.itemsProcessed} / {props.itemsTotal} items
      </Typography>

      {props.timeRemaining !== null && (
        <Typography variant="body2" color="text.secondary">
          Time remaining: {formatDuration(props.timeRemaining)}
        </Typography>
      )}
    </Box>
  );
}
```

#### 3.7.2 App Usage During Migration

**Policy by Migration Type**:

| Migration Type          | App Blocking | Reason                                      |
| ----------------------- | ------------ | ------------------------------------------- |
| IndexedDB schema change | ✅ Block     | Cannot open database during version upgrade |
| Add field to sessions   | ✅ Block     | Ensure consistency across all records       |
| Signal compression      | ❌ Allow     | Background process, signals still readable  |
| Index rebuild           | ❌ Allow     | Queries still work (slower)                 |
| Cache regeneration      | ❌ Allow     | Optional performance optimization           |

**Implementation**:

```typescript
function shouldBlockApp(migration: Migration): boolean {
  return migration.blocking ?? true; // Default to blocking for safety
}

async function runMigrationWithAppState(
  migration: Migration,
  context: MigrationContext,
): Promise<void> {
  if (shouldBlockApp(migration)) {
    // Show full-screen migration overlay
    showMigrationOverlay(migration, context);
    await migration.up(context);
    hideMigrationOverlay();
  } else {
    // Show non-intrusive notification
    showMigrationNotification(migration);
    await startBackgroundMigration(migration, context);
  }
}
```

#### 3.7.3 Migration Failure Recovery

**User-Facing Error Message**:

```typescript
interface MigrationErrorDialogProps {
  migration: Migration;
  error: Error;
  canRetry: boolean;
  canRollback: boolean;
  onRetry: () => void;
  onRollback: () => void;
  onContactSupport: () => void;
}

function MigrationErrorDialog(props: MigrationErrorDialogProps) {
  return (
    <Dialog>
      <DialogTitle>Migration Failed</DialogTitle>
      <DialogContent>
        <Alert severity="error">
          <Typography>
            The data migration could not be completed.
          </Typography>
        </Alert>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2">
            Migration: {props.migration.description}
          </Typography>
          <Typography variant="body2" color="error">
            Error: {props.error.message}
          </Typography>
        </Box>

        <Alert severity="info" sx={{ mt: 2 }}>
          Your data has not been modified. You can:
          <ul>
            {props.canRetry && <li>Retry the migration</li>}
            {props.canRollback && <li>Rollback to the previous version</li>}
            <li>Export your data and report the issue</li>
          </ul>
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onContactSupport}>Export & Report</Button>
        {props.canRollback && (
          <Button onClick={props.onRollback}>Rollback</Button>
        )}
        {props.canRetry && (
          <Button onClick={props.onRetry} variant="contained">Retry</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
```

### 3.8 Migration Testing Strategy

#### 3.8.1 Test Data Generation

Generate realistic data sets for each schema version:

```typescript
// test/fixtures/migrations/generate-v1-data.ts
export async function generateV1TestData(): Promise<void> {
  const db = await openDatabase(); // Force version 1

  // Create sample sessions with v1 schema
  const sessions: SessionV1[] = [
    {
      id: uuid(),
      machineId: 'TEST-001',
      date: '2026-01-01',
      // ... v1 fields only
    },
    // ... more sessions
  ];

  const tx = db.transaction('sessions', 'readwrite');
  for (const session of sessions) {
    await tx.objectStore('sessions').add(session);
  }
  await tx.complete;

  // Set schema version to 1
  await setSchemaVersion(db, 1);
}
```

#### 3.8.2 Automated Migration Tests

```typescript
// test/storage/migrations/migration-001.test.ts
describe('Migration 001: Add tags to sessions', () => {
  beforeEach(async () => {
    await clearDatabase();
    await generateV1TestData();
  });

  it('should add empty tags array to all sessions', async () => {
    const db = await openDatabase();
    const context = createTestContext(db);

    await migration_001_add_tags_to_sessions.up(context);

    const tx = db.transaction('sessions', 'readonly');
    const sessions = await tx.objectStore('sessions').getAll();

    sessions.forEach((session) => {
      expect(session.tags).toBeDefined();
      expect(Array.isArray(session.tags)).toBe(true);
    });
  });

  it('should preserve existing session data', async () => {
    const db = await openDatabase();
    const context = createTestContext(db);

    // Get original data
    const originalSessions = await getAllSessions(db);

    await migration_001_add_tags_to_sessions.up(context);

    // Get migrated data
    const migratedSessions = await getAllSessions(db);

    // Verify all fields except tags are unchanged
    migratedSessions.forEach((migrated, i) => {
      const original = originalSessions[i];
      expect(migrated.id).toBe(original.id);
      expect(migrated.machineId).toBe(original.machineId);
      expect(migrated.date).toBe(original.date);
      // ... check all fields
    });
  });

  it('should pass verification after migration', async () => {
    const db = await openDatabase();
    const context = createTestContext(db);

    await migration_001_add_tags_to_sessions.up(context);

    const result = await migration_001_add_tags_to_sessions.verify(context);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should be idempotent', async () => {
    const db = await openDatabase();
    const context = createTestContext(db);

    // Run migration twice
    await migration_001_add_tags_to_sessions.up(context);
    const firstResult = await getAllSessions(db);

    await migration_001_add_tags_to_sessions.up(context);
    const secondResult = await getAllSessions(db);

    // Results should be identical
    expect(secondResult).toEqual(firstResult);
  });
});
```

#### 3.8.3 Rollback Testing

```typescript
describe('Migration 001: Rollback', () => {
  it('should successfully rollback migration', async () => {
    const db = await openDatabase();
    const context = createTestContext(db);

    // Run migration
    await migration_001_add_tags_to_sessions.up(context);

    // Verify tags exist
    let sessions = await getAllSessions(db);
    sessions.forEach((s) => expect(s.tags).toBeDefined());

    // Rollback
    await migration_001_add_tags_to_sessions.down(context);

    // Verify tags removed
    sessions = await getAllSessions(db);
    sessions.forEach((s) => expect(s.tags).toBeUndefined());
  });
});
```

#### 3.8.4 Data Integrity Verification

```typescript
describe('Migration Pipeline: Data Integrity', () => {
  it('should maintain referential integrity across migrations', async () => {
    await generateV1TestData();

    // Run all migrations from v1 to current
    await runMigrationPipeline(1, CURRENT_VERSION);

    const db = await openDatabase();

    // Verify all sessions have corresponding aggregates
    const sessions = await getAllSessions(db);
    const aggregates = await getAllAggregates(db);

    sessions.forEach((session) => {
      const aggregate = aggregates.find((a) => a.sessionId === session.id);
      expect(aggregate).toBeDefined();
    });

    // Verify all signal references are valid
    for (const session of sessions) {
      for (const chunkId of session.signalChunkIds) {
        const exists = await signalChunkExists(chunkId);
        expect(exists).toBe(true);
      }
    }
  });

  it('should preserve all user data through migration chain', async () => {
    await generateV1TestData();

    // Export all data before migration
    const exportBefore = await exportAllData();

    // Run migrations
    await runMigrationPipeline(1, CURRENT_VERSION);

    // Export all data after migration
    const exportAfter = await exportAllData();

    // Compare critical data (adjusted for schema changes)
    expect(exportAfter.sessions.length).toBe(exportBefore.sessions.length);
    expect(exportAfter.events.length).toBe(exportBefore.events.length);

    // Verify signal data integrity
    for (let i = 0; i < exportBefore.sessions.length; i++) {
      const beforeSignals = await loadSignals(exportBefore.sessions[i].id);
      const afterSignals = await loadSignals(exportAfter.sessions[i].id);

      // Signals should be identical (or losslessly transformed)
      expect(afterSignals.flow).toBeCloseTo(beforeSignals.flow, 5);
      expect(afterSignals.pressure).toBeCloseTo(beforeSignals.pressure, 5);
    }
  });
});
```

#### 3.8.5 Performance Testing

```typescript
describe('Migration Performance', () => {
  it('should complete large dataset migration within SLA', async () => {
    // Generate 5 years of data
    await generateLargeTestDataset({
      years: 5,
      nightsPerYear: 365,
      avgEventsPerNight: 30,
    });

    const startTime = performance.now();
    await runMigrationPipeline(1, CURRENT_VERSION);
    const duration = performance.now() - startTime;

    // Should complete in under 5 minutes for 5 years of data
    expect(duration).toBeLessThan(300000);
  });

  it('should provide accurate progress estimates', async () => {
    await generateV1TestData();

    const progressReports: MigrationProgress[] = [];
    const context = createTestContext(db, {
      onProgress: (progress) => progressReports.push(progress),
    });

    await migration_003_compressed_signal_chunks.up(context);

    // Verify progress goes from 0 to 100
    expect(progressReports[0].progress).toBe(0);
    expect(progressReports[progressReports.length - 1].progress).toBe(1);

    // Verify estimated time remaining decreases
    for (let i = 1; i < progressReports.length - 1; i++) {
      expect(progressReports[i].timeRemaining).toBeLessThan(progressReports[i - 1].timeRemaining);
    }
  });
});
```

### 3.9 Example Migrations (Complete)

#### 3.9.1 Example: Adding Index to Sessions Store

This example demonstrates adding a new index to support filtering sessions by tags.

**Migration Definition**:

```typescript
// src/storage/migrations/005-add-tags-index.ts
export const migration_005_add_tags_index: Migration = {
  version: 5,
  description: 'Add tags index for efficient tag-based queries',
  estimatedDurationMs: 100,
  dependencies: [2], // Requires v2 which added tags field
  blocking: true,

  async up(context) {
    // Note: Index creation must happen in onupgradeneeded
    // This migration verifies the index was created
    const { db, progress } = context;

    progress.setMessage('Verifying tags index creation');

    // Verify index exists
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');

    if (!store.indexNames.contains('tags')) {
      throw new Error('tags index was not created during version upgrade');
    }

    // Test index functionality
    const index = store.index('tags');
    const testResults = await index.getAll('test');

    progress.setMessage('Tags index verified');
  },

  async down(context) {
    throw new Error('Cannot drop index after database is opened');
  },

  async verify(context) {
    const { db } = context;

    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const hasIndex = store.indexNames.contains('tags');

    return {
      success: hasIndex,
      errors: hasIndex ? [] : ['tags index does not exist'],
      warnings: [],
    };
  },
};

// Companion IndexedDB upgrade handler
export function upgradeToVersion5(db: IDBDatabase): void {
  if (db.version >= 5) return;

  const tx = (db as any).transaction as IDBTransaction;
  const store = tx.objectStore('sessions');

  // Create multiEntry index for tags array
  store.createIndex('tags', 'tags', {
    unique: false,
    multiEntry: true, // Allows querying by individual tag values
  });
}
```

**Test Suite**:

```typescript
// test/storage/migrations/005-add-tags-index.test.ts
import { describe, it, expect, beforeEach } from 'vitest';

describe('Migration 005: Add tags index', () => {
  beforeEach(async () => {
    await clearDatabase();
    await generateV2TestData(); // v2 includes tags field
  });

  it('should create tags index during upgrade', async () => {
    // Open database with version 5
    const db = await openDatabase(5);

    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');

    expect(store.indexNames.contains('tags')).toBe(true);
  });

  it('should allow querying sessions by tag', async () => {
    // Create test sessions with tags
    const db = await openDatabase(5);

    const sessions: Session[] = [
      {
        id: uuid(),
        tags: ['vacation', 'poor-sleep'],
        // ... other fields
      },
      {
        id: uuid(),
        tags: ['vacation', 'good-sleep'],
        // ... other fields
      },
      {
        id: uuid(),
        tags: ['work-night'],
        // ... other fields
      },
    ];

    const tx = db.transaction('sessions', 'readwrite');
    for (const session of sessions) {
      await tx.objectStore('sessions').add(session);
    }
    await tx.complete;

    // Query by tag
    const vacationTx = db.transaction('sessions', 'readonly');
    const index = vacationTx.objectStore('sessions').index('tags');
    const vacationSessions = await index.getAll('vacation');

    expect(vacationSessions).toHaveLength(2);
    expect(vacationSessions.every((s) => s.tags.includes('vacation'))).toBe(true);
  });

  it('should support multiEntry index behavior', async () => {
    const db = await openDatabase(5);

    // Add session with multiple tags
    const session: Session = {
      id: uuid(),
      tags: ['tag1', 'tag2', 'tag3'],
      // ... other fields
    };

    const tx = db.transaction('sessions', 'readwrite');
    await tx.objectStore('sessions').add(session);
    await tx.complete;

    // Should find by any tag
    const index = db.transaction('sessions', 'readonly').objectStore('sessions').index('tags');

    for (const tag of session.tags) {
      const results = await index.getAll(tag);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(session.id);
    }
  });
});
```

#### 3.9.2 Example: Changing Signal Chunk Format (Compression)

This example shows a complete migration that transforms large binary data stored in OPFS.

**Migration Definition**:

```typescript
// src/storage/migrations/008-signal-compression.ts
import { compress, decompress } from '../compression/zstd';

export const migration_008_signal_compression: Migration = {
  version: 8,
  description: 'Enable zstd compression for signal chunks (60% storage reduction)',
  estimatedDurationMs: 180000, // 3 minutes for typical dataset
  dependencies: [],
  blocking: false, // Can run in background

  async up(context) {
    const { db, opfsRoot, progress, signal } = context;

    progress.setMessage('Scanning sessions with signal data');

    // Get all sessions
    const tx = db.transaction('sessions', 'readonly');
    const allSessions = await tx.objectStore('sessions').getAll();
    const sessionsWithSignals = allSessions.filter(
      (s) => !s.deleted && s.signalChunkIds.length > 0,
    );

    progress.setTotal(sessionsWithSignals.length);
    progress.setMessage(`Compressing ${sessionsWithSignals.length} sessions`);

    const signalsDir = await opfsRoot.getDirectoryHandle('signals');
    let processed = 0;

    for (const session of sessionsWithSignals) {
      if (signal.aborted) {
        throw new Error('Migration cancelled by user');
      }

      try {
        await compressSessionSignals(session.id, signalsDir, progress);
        processed++;
        progress.setProgress(processed);
      } catch (error) {
        console.error(`Failed to compress session ${session.id}:`, error);
        // Continue with other sessions
      }
    }

    progress.setMessage('Compression complete');
  },

  async down(context) {
    const { db, opfsRoot, progress } = context;

    progress.setMessage('Decompressing signal chunks');

    const tx = db.transaction('sessions', 'readonly');
    const allSessions = await tx.objectStore('sessions').getAll();
    const sessionsWithSignals = allSessions.filter(
      (s) => !s.deleted && s.signalChunkIds.length > 0,
    );

    progress.setTotal(sessionsWithSignals.length);

    const signalsDir = await opfsRoot.getDirectoryHandle('signals');
    let processed = 0;

    for (const session of sessionsWithSignals) {
      await decompressSessionSignals(session.id, signalsDir);
      processed++;
      progress.setProgress(processed);
    }
  },

  async verify(context) {
    const { db, opfsRoot } = context;

    const tx = db.transaction('sessions', 'readonly');
    const allSessions = await tx.objectStore('sessions').getAll();

    const errors: string[] = [];
    const warnings: string[] = [];

    const signalsDir = await opfsRoot.getDirectoryHandle('signals');

    for (const session of allSessions) {
      if (session.deleted || session.signalChunkIds.length === 0) {
        continue;
      }

      try {
        const sessionDir = await signalsDir.getDirectoryHandle(session.id);
        const manifestFile = await sessionDir.getFileHandle('manifest.json');
        const manifestBlob = await manifestFile.getFile();
        const manifestText = await manifestBlob.text();
        const manifest = JSON.parse(manifestText);

        // Verify compression is enabled
        if (manifest.compression !== 'zstd') {
          warnings.push(
            `Session ${session.id} manifest indicates no compression ` +
              `(expected "zstd", got "${manifest.compression}")`,
          );
        }

        // Verify all chunks are compressed
        for (const chunk of manifest.chunks) {
          if (!chunk.compressedSize || chunk.compressedSize === chunk.uncompressedSize) {
            warnings.push(`Session ${session.id} chunk ${chunk.filename} may not be compressed`);
          }
        }

        // Verify manifest version
        if (manifest.version < 8) {
          errors.push(`Session ${session.id} manifest version outdated`);
        }
      } catch (error) {
        errors.push(`Session ${session.id}: ${error.message}`);
      }
    }

    return {
      success: errors.length === 0,
      errors,
      warnings,
    };
  },
};

// Helper functions

async function compressSessionSignals(
  sessionId: string,
  signalsDir: FileSystemDirectoryHandle,
  progress: MigrationProgressReporter,
): Promise<void> {
  const sessionDir = await signalsDir.getDirectoryHandle(sessionId);

  // Read manifest
  const manifestHandle = await sessionDir.getFileHandle('manifest.json');
  const manifestFile = await manifestHandle.getFile();
  const manifestText = await manifestFile.text();
  const manifest = JSON.parse(manifestText);

  // Check if already compressed
  if (manifest.compression === 'zstd' && manifest.version >= 8) {
    return; // Already migrated
  }

  progress.setMessage(`Compressing ${sessionId}`);

  // Compress each chunk
  for (let i = 0; i < manifest.chunks.length; i++) {
    const chunkInfo = manifest.chunks[i];
    const chunkHandle = await sessionDir.getFileHandle(chunkInfo.filename);
    const chunkFile = await chunkHandle.getFile();
    const uncompressed = await chunkFile.arrayBuffer();

    // Compress with zstd (level 3 is good balance of compression/speed)
    const compressed = await compress(uncompressed, { level: 3 });

    // Write compressed data
    const writable = await chunkHandle.createWritable();
    await writable.write(compressed);
    await writable.close();

    // Update chunk info
    chunkInfo.compressedSize = compressed.byteLength;
    chunkInfo.uncompressedSize = uncompressed.byteLength;
    chunkInfo.compressionRatio = compressed.byteLength / uncompressed.byteLength;
  }

  // Update manifest
  manifest.compression = 'zstd';
  manifest.compressionLevel = 3;
  manifest.version = 8;

  const manifestWritable = await manifestHandle.createWritable();
  await manifestWritable.write(JSON.stringify(manifest, null, 2));
  await manifestWritable.close();
}

async function decompressSessionSignals(
  sessionId: string,
  signalsDir: FileSystemDirectoryHandle,
): Promise<void> {
  const sessionDir = await signalsDir.getDirectoryHandle(sessionId);

  const manifestHandle = await sessionDir.getFileHandle('manifest.json');
  const manifestFile = await manifestHandle.getFile();
  const manifestText = await manifestFile.text();
  const manifest = JSON.parse(manifestText);

  if (manifest.compression !== 'zstd') {
    return; // Already uncompressed
  }

  // Decompress each chunk
  for (const chunkInfo of manifest.chunks) {
    const chunkHandle = await sessionDir.getFileHandle(chunkInfo.filename);
    const chunkFile = await chunkHandle.getFile();
    const compressed = await chunkFile.arrayBuffer();

    const uncompressed = await decompress(compressed);

    const writable = await chunkHandle.createWritable();
    await writable.write(uncompressed);
    await writable.close();

    delete chunkInfo.compressedSize;
    delete chunkInfo.compressionRatio;
  }

  manifest.compression = 'none';
  delete manifest.compressionLevel;
  manifest.version = 7; // Revert to pre-compression version

  const manifestWritable = await manifestHandle.createWritable();
  await manifestWritable.write(JSON.stringify(manifest, null, 2));
  await manifestWritable.close();
}
```

**Test Suite**:

```typescript
// test/storage/migrations/008-signal-compression.test.ts
describe('Migration 008: Signal compression', () => {
  beforeEach(async () => {
    await clearDatabase();
    await clearOPFS();
    await generateV7TestDataWithSignals(); // Includes OPFS signal data
  });

  it('should compress all signal chunks', async () => {
    const context = await createTestContext();

    // Get sizes before compression
    const sizesBefore = await getSessionSignalSizes();

    await migration_008_signal_compression.up(context);

    // Get sizes after compression
    const sizesAfter = await getSessionSignalSizes();

    // Verify compression ratio
    sizesAfter.forEach((sizeAfter, sessionId) => {
      const sizeBefore = sizesBefore.get(sessionId)!;
      const ratio = sizeAfter / sizeBefore;

      // Expect at least 40% reduction (ratio <= 0.6)
      expect(ratio).toBeLessThanOrEqual(0.6);
    });
  });

  it('should maintain signal data integrity after compression', async () => {
    const context = await createTestContext();
    const { db, opfsRoot } = context;

    // Read original signal data
    const session = (await getAllSessions(db))[0];
    const signalsBefore = await readSessionSignals(session.id, opfsRoot);

    // Run migration
    await migration_008_signal_compression.up(context);

    // Read compressed signal data
    const signalsAfter = await readSessionSignals(session.id, opfsRoot);

    // Verify data is identical
    expect(signalsAfter.flow.length).toBe(signalsBefore.flow.length);
    expect(signalsAfter.pressure.length).toBe(signalsBefore.pressure.length);

    // Verify signal values (lossless compression)
    for (let i = 0; i < signalsAfter.flow.length; i++) {
      expect(signalsAfter.flow[i]).toBeCloseTo(signalsBefore.flow[i], 10);
    }
  });

  it('should update manifest with compression metadata', async () => {
    const context = await createTestContext();
    const { opfsRoot } = context;

    await migration_008_signal_compression.up(context);

    const signalsDir = await opfsRoot.getDirectoryHandle('signals');
    const sessions = await signalsDir.keys();

    for await (const sessionId of sessions) {
      const sessionDir = await signalsDir.getDirectoryHandle(sessionId);
      const manifestFile = await sessionDir.getFileHandle('manifest.json');
      const manifestBlob = await manifestFile.getFile();
      const manifest = JSON.parse(await manifestBlob.text());

      expect(manifest.compression).toBe('zstd');
      expect(manifest.compressionLevel).toBe(3);
      expect(manifest.version).toBe(8);

      manifest.chunks.forEach((chunk) => {
        expect(chunk.compressedSize).toBeDefined();
        expect(chunk.uncompressedSize).toBeDefined();
        expect(chunk.compressionRatio).toBeLessThan(1);
      });
    }
  });

  it('should be idempotent', async () => {
    const context = await createTestContext();

    // Run twice
    await migration_008_signal_compression.up(context);
    const sizesFirstRun = await getSessionSignalSizes();

    await migration_008_signal_compression.up(context);
    const sizesSecondRun = await getSessionSignalSizes();

    // Sizes should be identical
    expect(sizesSecondRun).toEqual(sizesFirstRun);
  });

  it('should support rollback', async () => {
    const context = await createTestContext();
    const { opfsRoot } = context;

    // Get original data
    const session = (await getAllSessions(context.db))[0];
    const signalsBefore = await readSessionSignals(session.id, opfsRoot);
    const sizesBefore = await getSessionSignalSizes();

    // Compress
    await migration_008_signal_compression.up(context);

    // Decompress
    await migration_008_signal_compression.down(context);

    // Verify back to original
    const signalsAfter = await readSessionSignals(session.id, opfsRoot);
    const sizesAfter = await getSessionSignalSizes();

    expect(sizesAfter).toEqual(sizesBefore);
    expect(signalsAfter).toEqual(signalsBefore);
  });

  it('should handle partial migration (some sessions fail)', async () => {
    const context = await createTestContext();

    // Corrupt one session's signal data
    await corruptSessionSignals('session-2', context.opfsRoot);

    // Migration should continue for other sessions
    await expect(migration_008_signal_compression.up(context)).resolves.not.toThrow();

    // Verify other sessions were compressed
    const sessions = await getAllSessions(context.db);
    const signalsDir = await context.opfsRoot.getDirectoryHandle('signals');

    for (const session of sessions) {
      if (session.id === 'session-2') continue;

      const sessionDir = await signalsDir.getDirectoryHandle(session.id);
      const manifestFile = await sessionDir.getFileHandle('manifest.json');
      const manifest = JSON.parse(await (await manifestFile.getFile()).text());

      expect(manifest.compression).toBe('zstd');
    }
  });
});
```

---

## 4. OPFS Signal Storage

### 4.1 Directory Structure

```
/cpap-analyzer/
├── signals/
│   ├── {sessionId}/
│   │   ├── manifest.json
│   │   ├── chunk-000.bin
│   │   ├── chunk-001.bin
│   │   ├── chunk-002.bin
│   │   └── ...
│   ├── {sessionId}/
│   │   └── ...
│   └── ...
└── cache/
    ├── downsampled/
    │   ├── {sessionId}-1h.bin
    │   ├── {sessionId}-1d.bin
    │   └── ...
    └── ...
```

**Root**: `/cpap-analyzer/` (OPFS root directory)

**Signal data**: `/cpap-analyzer/signals/{sessionId}/` (one directory per session)

**Cache**: `/cpap-analyzer/cache/` (optional downsampled data for faster rendering)

### 4.2 Manifest File Format

Each session directory contains a `manifest.json` file:

```typescript
interface SignalManifest {
  version: 1; // Manifest format version
  sessionId: string; // Matches IndexedDB session ID
  startTime: number; // Epoch milliseconds
  endTime: number; // Epoch milliseconds
  durationSeconds: number;
  chunkDurationSeconds: number; // Fixed chunk duration (default: 300)
  channels: ChannelDescriptor[];
  chunks: ChunkDescriptor[];
}

interface ChannelDescriptor {
  index: number; // 0-based channel index in binary files
  name: string; // "Flow", "MaskPress", etc.
  sampleRate: number; // Hz
  unit: string; // "L/min", "cmH2O", etc.
  dtype: 'float32'; // Data type (always float32)
  physicalMin: number;
  physicalMax: number;
}

interface ChunkDescriptor {
  index: number; // Chunk sequence number
  fileName: string; // e.g., "chunk-000.bin"
  startTime: number; // Epoch milliseconds
  endTime: number; // Epoch milliseconds
  samples: Record<string, number>; // Channel name → sample count
  byteSize: number; // Total file size in bytes
}
```

**Example manifest**:

```json
{
  "version": 1,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "startTime": 1709251200000,
  "endTime": 1709280000000,
  "durationSeconds": 28800,
  "chunkDurationSeconds": 300,
  "channels": [
    {
      "index": 0,
      "name": "Flow",
      "sampleRate": 25,
      "unit": "L/min",
      "dtype": "float32",
      "physicalMin": -150,
      "physicalMax": 150
    },
    {
      "index": 1,
      "name": "MaskPress",
      "sampleRate": 25,
      "unit": "cmH2O",
      "dtype": "float32",
      "physicalMin": 0,
      "physicalMax": 30
    },
    {
      "index": 2,
      "name": "Leak",
      "sampleRate": 2,
      "unit": "L/min",
      "dtype": "float32",
      "physicalMin": 0,
      "physicalMax": 200
    }
  ],
  "chunks": [
    {
      "index": 0,
      "fileName": "chunk-000.bin",
      "startTime": 1709251200000,
      "endTime": 1709251500000,
      "samples": { "Flow": 7500, "MaskPress": 7500, "Leak": 600 },
      "byteSize": 62400
    }
    // ... 96 chunks for 8-hour session
  ]
}
```

### 4.3 Binary Chunk Format

**File format**: Raw binary, no header

**Byte order**: Little-endian (native JavaScript TypedArray byte order)

**Data type**: IEEE 754 single-precision float (Float32, 4 bytes per sample)

**Layout**: Channel-wise contiguous (all samples for channel 0, then channel 1, etc.)

```
[Channel 0: n0 samples × 4 bytes]
[Channel 1: n1 samples × 4 bytes]
[Channel 2: n2 samples × 4 bytes]
...
```

**Reading algorithm**:

```typescript
async function readChunk(
  sessionId: string,
  chunkIndex: number,
  channelName: string,
): Promise<Float32Array> {
  // 1. Load manifest
  const manifest = await readManifest(sessionId);
  const chunk = manifest.chunks[chunkIndex];
  const channel = manifest.channels.find((c) => c.name === channelName);

  // 2. Calculate byte offset
  let byteOffset = 0;
  for (let i = 0; i < channel.index; i++) {
    const prevChannel = manifest.channels[i];
    byteOffset += chunk.samples[prevChannel.name] * 4;
  }

  // 3. Read chunk file
  const fileHandle = await getFileHandle(sessionId, chunk.fileName);
  const file = await fileHandle.getFile();
  const arrayBuffer = await file.arrayBuffer();

  // 4. Extract channel slice
  const sampleCount = chunk.samples[channelName];
  const byteLength = sampleCount * 4;
  const channelBuffer = arrayBuffer.slice(byteOffset, byteOffset + byteLength);

  return new Float32Array(channelBuffer);
}
```

### 4.4 Chunk Sizing Strategy

**Fixed duration**: 5 minutes (300 seconds)

**Rationale**:

- Balances file count (96 chunks per 8-hour night) vs. granularity
- Enables efficient time-range lookups (at most 2 partial chunks per query)
- Keeps individual files < 100 KB for fast I/O
- Predictable memory footprint per chunk

**Size calculation** (typical ResMed session):

```
Flow:      25 Hz × 300s × 4 bytes = 30,000 bytes
MaskPress: 25 Hz × 300s × 4 bytes = 30,000 bytes
Leak:       2 Hz × 300s × 4 bytes =  2,400 bytes
TidVol:   0.1 Hz × 300s × 4 bytes =    120 bytes
MinVent:  0.1 Hz × 300s × 4 bytes =    120 bytes
RespRate: 0.1 Hz × 300s × 4 bytes =    120 bytes
--------------------------------------------
Total:                            ≈ 62,760 bytes (~61 KB)
```

**With oximetry** (SpO2 + Pulse at 1 Hz):

```
Additional: 2 channels × 1 Hz × 300s × 4 bytes = 2,400 bytes
Total: ~65 KB per chunk
```

### 4.5 Chunk Index for Fast Lookup

The manifest provides O(1) lookup from time range to chunk IDs:

```typescript
function getChunksForTimeRange(
  manifest: SignalManifest,
  startTime: number,
  endTime: number,
): number[] {
  // Binary search for first overlapping chunk
  const startIdx = binarySearchChunks(manifest.chunks, startTime);
  const endIdx = binarySearchChunks(manifest.chunks, endTime);

  // Return array of chunk indices
  const chunkIndices: number[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    chunkIndices.push(i);
  }
  return chunkIndices;
}

function binarySearchChunks(chunks: ChunkDescriptor[], time: number): number {
  let left = 0;
  let right = chunks.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (chunks[mid].endTime < time) {
      left = mid + 1;
    } else if (chunks[mid].startTime > time) {
      right = mid - 1;
    } else {
      return mid; // time is within chunk[mid]
    }
  }

  return left; // Insertion point if not found
}
```

---

## 5. Data Models (TypeScript Interfaces)

### 5.1 Core Data Models

All interfaces from Section 2 (IndexedDB Schema) serve as the canonical data models. Additional models for business logic:

```typescript
// ============================================
// Session Import Models
// ============================================

interface ImportRequest {
  directoryHandle: FileSystemDirectoryHandle; // SD card root
  machineId: string | null; // Auto-detected or user-specified
  incrementalImport: boolean; // Only import new sessions
  validateOnly: boolean; // Dry-run mode
}

interface ImportProgress {
  status: 'scanning' | 'processing' | 'storing' | 'complete' | 'error';
  currentFile: string | null;
  filesProcessed: number;
  filesTotal: number;
  sessionsProcessed: number;
  sessionsTotal: number;
  bytesProcessed: number;
  bytesTotal: number;
  estimatedSecondsRemaining: number | null;
  errors: ImportError[];
}

interface ImportResult {
  success: boolean;
  sessionsImported: number;
  sessionsSkipped: number;
  sessionsErrored: number;
  durationSeconds: number;
  errors: ImportError[];
  importRecordId: string; // FK → import_history.id
}

// ============================================
// Query Models
// ============================================

interface DateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

interface SessionQuery {
  dateRange?: DateRange;
  machineIds?: string[];
  hasOximetry?: boolean;
  minDurationMinutes?: number;
  deleted?: boolean; // Include soft-deleted sessions
}

interface AggregateQuery {
  dateRange?: DateRange;
  machineIds?: string[];
  sortBy?: keyof NightlyAggregate;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

interface SignalQuery {
  sessionId: string;
  channels: string[]; // Channel names to retrieve
  timeRange?: {
    startTime: number; // Epoch milliseconds
    endTime: number; // Epoch milliseconds
  };
  downsampleTo?: number; // Target sample count (0 = no downsample)
  downsampleMethod?: 'min-max' | 'lttb' | 'average';
}

// ============================================
// Signal Data Models
// ============================================

interface SignalData {
  sessionId: string;
  channel: string;
  sampleRate: number;
  unit: string;
  startTime: number; // Epoch milliseconds
  timestamps: Float64Array; // Epoch milliseconds per sample
  values: Float32Array; // Signal values
  downsampled: boolean;
  downsampleMethod?: string;
}

interface MultiChannelSignalData {
  sessionId: string;
  startTime: number;
  endTime: number;
  channels: Map<string, SignalData>;
}

// ============================================
// Analysis Models
// ============================================

interface AnalysisRequest<T = unknown> {
  analysisType: string;
  dateRange: DateRange;
  machineIds?: string[];
  parameters: T;
}

interface DescriptiveStats {
  count: number;
  mean: number;
  median: number;
  stdDev: number;
  variance: number;
  min: number;
  max: number;
  q1: number; // 25th percentile
  q3: number; // 75th percentile
  iqr: number;
  skewness: number;
  kurtosis: number;
  outliers: number[]; // Indices of outlier values
}

interface TimeSeriesDecomposition {
  trend: Float64Array;
  seasonal: Float64Array;
  residual: Float64Array;
  timestamps: string[]; // YYYY-MM-DD
}

interface CorrelationResult {
  variable1: string;
  variable2: string;
  pearson: {
    r: number;
    pValue: number;
    confidenceInterval: [number, number];
  };
  spearman: {
    rho: number;
    pValue: number;
  };
  n: number; // Sample size
}

interface ClusterAnalysisResult {
  algorithm: 'flg-bridged' | 'kmeans' | 'single-link';
  parameters: Record<string, unknown>;
  clusters: Cluster[];
}

interface Cluster {
  id: string;
  sessionId: string;
  startTime: number; // Epoch milliseconds
  endTime: number;
  durationSeconds: number;
  events: string[]; // Event IDs (FK → events.id)
  eventCount: number;
  density: number; // Events per minute
  weightedDensity: number; // "Choke Factor"
  severityScore: number; // Composite severity
  avgFlowLimitation: number;
  avgPressure: number;
  avgEpap: number;
}

// ============================================
// Export Models
// ============================================

interface ExportRequest {
  format: 'json' | 'csv' | 'edf' | 'pdf';
  dateRange: DateRange;
  machineIds?: string[];
  includeSignals: boolean;
  includeEvents: boolean;
  includeAnalysisResults: boolean;
  encryption?: {
    enabled: boolean;
    password: string;
  };
}

interface ExportResult {
  success: boolean;
  format: string;
  fileHandle: FileSystemFileHandle | null; // If File System Access API used
  blob: Blob | null; // Otherwise
  fileName: string;
  sizeBytes: number;
  encrypted: boolean;
}
```

### 4.2 Integration Data Models

```typescript
// ============================================
// Fitbit Integration
// ============================================

interface FitbitConnection {
  enabled: boolean;
  accessToken: string; // Encrypted in IndexedDB
  refreshToken: string; // Encrypted
  expiresAt: string; // ISO 8601
  lastSync: string | null; // ISO 8601
  scopes: string[];
}

interface FitbitSyncRequest {
  dateRange: DateRange;
  dataTypes: ('heartRate' | 'hrv' | 'spo2' | 'sleepStages')[];
}

// ============================================
// Weather Integration
// ============================================

interface WeatherConnection {
  enabled: boolean;
  provider: 'openweathermap' | 'airvisual' | 'aqicn';
  apiKey: string; // Encrypted
  location: {
    latitude: number;
    longitude: number;
    city: string;
    country: string;
  };
  lastSync: string | null;
}

interface WeatherSyncRequest {
  dateRange: DateRange;
  dataTypes: ('temperature' | 'humidity' | 'pressure' | 'aqi' | 'pollen')[];
}
```

---

## 6. Query Patterns

### 6.1 Common Query: Date Range Summary

**Use case**: Dashboard, trend analysis, date range comparisons

**Query**:

```typescript
async function getNightlyAggregates(
  dateRange: DateRange,
  machineIds?: string[],
): Promise<NightlyAggregate[]> {
  const db = await openDatabase();
  const tx = db.transaction('nightly_aggregates', 'readonly');
  const store = tx.objectStore('nightly_aggregates');
  const index = store.index('date');

  // Range query on date index
  const range = IDBKeyRange.bound(dateRange.start, dateRange.end);
  const results = await index.getAll(range);

  // Filter by machineIds if specified
  if (machineIds && machineIds.length > 0) {
    return results.filter((agg) => machineIds.includes(agg.machineId));
  }

  return results;
}
```

**Performance**: O(log N + K) where N = total records, K = results in range. Typically < 100ms for any range.

### 6.2 Common Query: Single Session Detail

**Use case**: Session detail view, event drill-down

**Query**:

```typescript
async function getSessionDetail(sessionId: string): Promise<{
  session: Session;
  aggregate: NightlyAggregate;
  events: Event[];
}> {
  const db = await openDatabase();
  const tx = db.transaction(['sessions', 'nightly_aggregates', 'events'], 'readonly');

  // Parallel fetches
  const [session, aggregates, events] = await Promise.all([
    tx.objectStore('sessions').get(sessionId),
    tx.objectStore('nightly_aggregates').index('sessionId').getAll(sessionId),
    tx.objectStore('events').index('sessionId').getAll(sessionId),
  ]);

  return {
    session,
    aggregate: aggregates[0], // Should be exactly one
    events: events.sort((a, b) => a.timestamp - b.timestamp),
  };
}
```

**Performance**: < 50ms for typical session (< 100 events)

### 6.3 Common Query: Signal Data for Time Range

**Use case**: Signal explorer, chart rendering

**Query**:

```typescript
async function getSignalData(query: SignalQuery): Promise<MultiChannelSignalData> {
  // 1. Load manifest from OPFS
  const manifest = await readManifest(query.sessionId);

  // 2. Determine time range
  const startTime = query.timeRange?.startTime ?? manifest.startTime;
  const endTime = query.timeRange?.endTime ?? manifest.endTime;

  // 3. Find overlapping chunks
  const chunkIndices = getChunksForTimeRange(manifest, startTime, endTime);

  // 4. Load chunks for each requested channel (parallel)
  const channelDataMap = new Map<string, SignalData>();

  await Promise.all(
    query.channels.map(async (channelName) => {
      const channelData = await loadChannelDataFromChunks(
        query.sessionId,
        manifest,
        channelName,
        chunkIndices,
        startTime,
        endTime,
      );

      // 5. Downsample if requested
      if (query.downsampleTo && channelData.values.length > query.downsampleTo) {
        const downsampled = downsample(
          channelData,
          query.downsampleTo,
          query.downsampleMethod ?? 'lttb',
        );
        channelDataMap.set(channelName, downsampled);
      } else {
        channelDataMap.set(channelName, channelData);
      }
    }),
  );

  return {
    sessionId: query.sessionId,
    startTime,
    endTime,
    channels: channelDataMap,
  };
}
```

**Performance**:

- Full-resolution 10-minute window: < 100ms
- Downsampled hour-level view: < 200ms
- Downsampled full-night view: < 300ms

### 6.4 Filtering and Aggregation

**Use case**: "Show all nights with AHI > 10", "Average AHI by month"

**Query with filtering**:

```typescript
async function queryAggregates(
  query: AggregateQuery & { filters?: Filter[] },
): Promise<NightlyAggregate[]> {
  // 1. Get base result set by date range
  let results = await getNightlyAggregates(query.dateRange, query.machineIds);

  // 2. Apply filters
  if (query.filters) {
    results = results.filter((agg) => {
      return query.filters.every((filter) => applyFilter(agg, filter));
    });
  }

  // 3. Sort
  if (query.sortBy) {
    results.sort((a, b) => {
      const aVal = a[query.sortBy!];
      const bVal = b[query.sortBy!];
      const order = query.sortOrder === 'desc' ? -1 : 1;
      return (aVal < bVal ? -1 : aVal > bVal ? 1 : 0) * order;
    });
  }

  // 4. Paginate
  if (query.limit) {
    const offset = query.offset ?? 0;
    results = results.slice(offset, offset + query.limit);
  }

  return results;
}

type Filter = {
  field: keyof NightlyAggregate;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: number | string;
};
```

**Performance**: O(K) where K = records in date range. Typically < 200ms.

### 6.5 Handling Data Gaps

**Challenge**: Users may have missing nights (didn't use CPAP, forgot to import, data corruption).

**Strategy**:

- **Do not fill gaps** with synthetic data — preserve truth
- For time-series analysis, use gap-aware algorithms:
  - Rolling averages: Skip missing days, adjust window size
  - Autocorrelation: Use pairwise deletion (compute only for available pairs)
  - Change-point detection: Treat gaps as potential change points

**Implementation**:

```typescript
function rollingMean(values: (number | null)[], windowSize: number): (number | null)[] {
  const result: (number | null)[] = [];

  for (let i = 0; i < values.length; i++) {
    const window = values
      .slice(Math.max(0, i - windowSize + 1), i + 1)
      .filter((v) => v !== null) as number[];

    if (window.length > 0) {
      result.push(window.reduce((a, b) => a + b, 0) / window.length);
    } else {
      result.push(null);
    }
  }

  return result;
}
```

---

## 7. Import Pipeline

### 7.1 Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Thread (UI)                         │
│  - Manage file picker                                       │
│  - Display progress                                         │
│  - Handle user cancellation                                 │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│             Worker: Import Coordinator                      │
│  - Scan SD card directory structure                         │
│  - Detect machine model                                     │
│  - Identify EDF files                                       │
│  - Dispatch parse jobs                                      │
│  - Aggregate results                                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│               Worker: EDF Parser                            │
│  - Read EDF header                                          │
│  - Validate structure                                       │
│  - Extract signal data records                              │
│  - Extract EDF+ annotations                                 │
│  - Convert digital → physical units                         │
│  - Transfer ArrayBuffers to Converter                       │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│             Worker: Signal Converter                        │
│  - Align signals to common timebase                         │
│  - Compute derived channels (if needed)                     │
│  - Split into 5-minute chunks                               │
│  - Generate chunk manifest                                  │
│  - Transfer chunks to Storage Writer                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Worker: Storage Writer                         │
│  - Write chunks to OPFS                                     │
│  - Write manifest to OPFS                                   │
│  - Compute nightly aggregates                               │
│  - Write session metadata to IndexedDB                      │
│  - Write nightly aggregates to IndexedDB                    │
│  - Write events to IndexedDB                                │
│  - Update import history                                    │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Import Flow (Step-by-Step)

**Phase 1: Initiation**

1. User selects SD card directory via File System Access API (or file input fallback)
2. Main thread sends directory handle to Import Coordinator worker
3. Import Coordinator scans directory structure
4. Detects machine model from `Identification.tgt` or directory layout
5. Enumerates all EDF files with metadata (name, size, modified date)
6. Checks import history to identify already-imported files (by sourceHash)
7. Estimates import duration and storage requirements
8. Returns scan results to main thread for user confirmation

**Phase 2: Parsing** (per EDF file) 9. Import Coordinator dispatches EDF file to Parser worker 10. Parser reads file via FileReader (chunk by chunk to avoid memory spike) 11. Validates EDF header (magic number, field formats, date/time) 12. Extracts header metadata (patient info, recording info, signal descriptors) 13. Reads data records sequentially 14. Converts digital values to physical units per channel 15. Parses EDF+ annotations (if present) into event structures 16. Transfers signal ArrayBuffers to Converter worker (zero-copy)

**Phase 3: Conversion** 17. Converter receives multi-channel signal data + events 18. Aligns signals to a common time base (handle different sample rates) 19. Validates signal ranges (reject physiologically impossible values) 20. Splits each channel into 5-minute chunks 21. Generates chunk manifest (timestamps, sample counts, byte sizes) 22. Computes session-level aggregates (AHI, leak stats, pressure stats) 23. Transfers chunks + manifest + aggregates to Storage Writer

**Phase 4: Storage** 24. Storage Writer creates session directory in OPFS: `/signals/{sessionId}/` 25. Writes manifest.json 26. Writes each chunk as `chunk-{index}.bin` 27. Opens IndexedDB transaction (readwrite, all stores) 28. Writes Session record 29. Writes NightlyAggregate record 30. Writes Event records (batch insert for efficiency) 31. Commits transaction 32. Notifies Import Coordinator of completion 33. Import Coordinator updates progress, dispatches next file

**Phase 5: Finalization** 34. All files processed 35. Import Coordinator writes ImportRecord to import_history 36. Invalidates affected analysis result caches 37. Notifies main thread of completion 38. Main thread navigates to dashboard or session detail view

### 7.3 Error Handling

**Non-fatal errors** (log and continue):

- Malformed EDF file (skip file, log error)
- Missing optional channels (import available channels only)
- Out-of-range values (clamp to valid range, log warning)

**Fatal errors** (abort import):

- Quota exceeded (OPFS or IndexedDB full)
- IndexedDB transaction failure (write conflict, constraint violation)
- Directory access permission denied
- Out of memory

**Recovery**:

- On fatal error, roll back the current session (delete partial data)
- Mark import as failed in import_history
- Display error to user with actionable guidance (e.g., "Free up storage")

### 7.4 Incremental Import

**Goal**: On subsequent imports, skip already-imported sessions.

**Implementation**:

```typescript
async function shouldImportFile(file: FileSystemFileHandle, machineId: string): Promise<boolean> {
  // 1. Compute file hash
  const fileObj = await file.getFile();
  const arrayBuffer = await fileObj.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const sourceHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // 2. Check if hash exists in import_history or sessions
  const db = await openDatabase();
  const tx = db.transaction('sessions', 'readonly');
  const index = tx.objectStore('sessions').index('sourceHash');
  const existing = await index.get(sourceHash);

  return existing === undefined;
}
```

**Optimization**: Cache sourceHashes in memory at startup to avoid repeated IndexedDB queries.

---

## 8. Data Access Layer

### 8.1 API Design Principles

- **Async-first**: All data access returns Promises
- **Type-safe**: Full TypeScript typing across all operations
- **Transactional**: Use IndexedDB transactions correctly for consistency
- **Streaming-capable**: Signal data can be streamed to avoid loading entire sessions
- **Error-first**: All operations catch and handle errors gracefully

### 8.2 Database Connection Management

```typescript
class DatabaseConnection {
  private static instance: IDBDatabase | null = null;

  static async open(): Promise<IDBDatabase> {
    if (this.instance) return this.instance;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open('cpap-analyzer', SCHEMA_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.instance = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = event.oldVersion;
        migrateSchema(db, oldVersion, SCHEMA_VERSION);
      };
    });
  }

  static close(): void {
    if (this.instance) {
      this.instance.close();
      this.instance = null;
    }
  }
}
```

### 8.3 Repository Pattern

**Session Repository**:

```typescript
class SessionRepository {
  async create(session: Session): Promise<void> {
    const db = await DatabaseConnection.open();
    const tx = db.transaction('sessions', 'readwrite');
    await tx.objectStore('sessions').add(session);
    await tx.complete;
  }

  async getById(id: string): Promise<Session | undefined> {
    const db = await DatabaseConnection.open();
    const tx = db.transaction('sessions', 'readonly');
    return tx.objectStore('sessions').get(id);
  }

  async query(query: SessionQuery): Promise<Session[]> {
    const db = await DatabaseConnection.open();
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');

    if (query.dateRange) {
      const index = store.index('date');
      const range = IDBKeyRange.bound(query.dateRange.start, query.dateRange.end);
      const results = await index.getAll(range);
      return this.applyFilters(results, query);
    } else {
      const results = await store.getAll();
      return this.applyFilters(results, query);
    }
  }

  async update(id: string, updates: Partial<Session>): Promise<void> {
    const db = await DatabaseConnection.open();
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const existing = await store.get(id);
    if (!existing) throw new Error(`Session ${id} not found`);
    await store.put({ ...existing, ...updates });
    await tx.complete;
  }

  async delete(id: string): Promise<void> {
    // Soft delete (set deleted flag)
    await this.update(id, { deleted: true });
  }

  private applyFilters(sessions: Session[], query: SessionQuery): Session[] {
    return sessions.filter((session) => {
      if (query.machineIds && !query.machineIds.includes(session.machineId)) {
        return false;
      }
      if (query.hasOximetry !== undefined && session.hasOximetry !== query.hasOximetry) {
        return false;
      }
      if (query.minDurationMinutes && session.durationMinutes < query.minDurationMinutes) {
        return false;
      }
      if (query.deleted === false && session.deleted) {
        return false;
      }
      return true;
    });
  }
}
```

**Signal Repository**:

```typescript
class SignalRepository {
  async getChannelData(query: SignalQuery): Promise<SignalData> {
    // Implementation per Section 5.3
    return getSignalData(query).then((multi) => {
      const data = multi.channels.get(query.channels[0]);
      if (!data) throw new Error(`Channel ${query.channels[0]} not found`);
      return data;
    });
  }

  async getMultiChannelData(query: SignalQuery): Promise<MultiChannelSignalData> {
    return getSignalData(query);
  }

  async *streamChannelData(query: SignalQuery): AsyncGenerator<Float32Array, void, undefined> {
    const manifest = await readManifest(query.sessionId);
    const startTime = query.timeRange?.startTime ?? manifest.startTime;
    const endTime = query.timeRange?.endTime ?? manifest.endTime;
    const chunkIndices = getChunksForTimeRange(manifest, startTime, endTime);

    for (const chunkIdx of chunkIndices) {
      const chunkData = await readChunk(query.sessionId, chunkIdx, query.channels[0]);
      yield chunkData;
    }
  }
}
```

### 8.4 Query Builder

```typescript
class AggregateQueryBuilder {
  private query: Partial<AggregateQuery> = {};

  dateRange(start: string, end: string): this {
    this.query.dateRange = { start, end };
    return this;
  }

  machines(machineIds: string[]): this {
    this.query.machineIds = machineIds;
    return this;
  }

  sortBy(field: keyof NightlyAggregate, order: 'asc' | 'desc' = 'asc'): this {
    this.query.sortBy = field;
    this.query.sortOrder = order;
    return this;
  }

  limit(limit: number, offset: number = 0): this {
    this.query.limit = limit;
    this.query.offset = offset;
    return this;
  }

  async execute(): Promise<NightlyAggregate[]> {
    return queryAggregates(this.query as AggregateQuery);
  }
}

// Usage:
const aggregates = await new AggregateQueryBuilder()
  .dateRange('2025-01-01', '2025-12-31')
  .machines(['SN123456'])
  .sortBy('ahi', 'desc')
  .limit(30)
  .execute();
```

### 8.5 Transaction Handling

**Best practices**:

- Use `'readonly'` transactions when possible (allows concurrent access)
- Keep transactions short (complete within 100ms when possible)
- Batch writes in a single transaction (avoid many small transactions)
- Never perform I/O (OPFS, fetch) inside an IndexedDB transaction

```typescript
async function batchInsertEvents(sessionId: string, events: Event[]): Promise<void> {
  const db = await DatabaseConnection.open();
  const tx = db.transaction('events', 'readwrite');
  const store = tx.objectStore('events');

  // Add all events in one transaction
  for (const event of events) {
    store.add(event);
  }

  await tx.complete;
}
```

---

## 9. Performance Optimization

### 9.1 Caching Strategy

**Three-tier cache**:

1. **In-memory cache** (short-lived, main thread):
   - Recently accessed nightly aggregates (LRU, max 1000 records)
   - Current session metadata
   - Active analysis results

2. **IndexedDB cache** (persistent):
   - `analysis_results` store serves as L2 cache
   - Pre-computed rolling averages, correlations, decompositions
   - Cache invalidation on new data import

3. **OPFS cache** (persistent, optional):
   - `/cache/downsampled/` directory
   - Pre-downsampled signal data at common zoom levels (1h, 1d)
   - Generated lazily on first access, reused on subsequent renders

**Cache invalidation rules**:

```typescript
async function invalidateCaches(dateRange: DateRange): Promise<void> {
  // 1. Clear in-memory cache
  inMemoryCache.clear();

  // 2. Delete affected analysis results from IndexedDB
  const db = await DatabaseConnection.open();
  const tx = db.transaction('analysis_results', 'readwrite');
  const store = tx.objectStore('analysis_results');
  const index = store.index('dateRange');

  // Find all analysis results overlapping the date range
  const cursor = await index.openCursor();
  while (cursor) {
    const result = cursor.value;
    if (rangesOverlap(result.dateRange, dateRange)) {
      cursor.delete();
    }
    cursor.continue();
  }

  await tx.complete;

  // 3. Delete downsampled cache files (optional)
  // ... OPFS deletion logic
}
```

### 8.2 Preloading Heuristics

**Dashboard preload**:
When user opens the app, preload:

- Last 30 days of nightly aggregates
- Machine metadata
- User settings

**Session detail preload**:
When user selects a session, preload:

- Session metadata + aggregates + events (IndexedDB query)
- First 5 chunks of signal data for each channel (OPFS)
- Adjacent session IDs (for prev/next navigation)

**Viewport-based preload**:
When user scrolls/zooms a chart, preload:

- ±20% buffer beyond visible time range
- Next zoom level (up and down)

```typescript
class SignalPreloader {
  private preloadQueue: SignalQuery[] = [];
  private preloading = false;

  enqueue(query: SignalQuery): void {
    this.preloadQueue.push(query);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.preloading || this.preloadQueue.length === 0) return;

    this.preloading = true;
    while (this.preloadQueue.length > 0) {
      const query = this.preloadQueue.shift()!;
      try {
        await getSignalData(query); // Loads into cache
      } catch (error) {
        console.warn('Preload failed:', error);
      }
    }
    this.preloading = false;
  }
}
```

### 8.3 Lazy Loading

**Principle**: Load data only when needed, as late as possible.

**Apply to**:

- Session detail views (load on navigation, not at startup)
- Analysis results (compute on demand, cache after first computation)
- Signal data (viewport-based loading)
- Integration data (load only when integration view is opened)
- Older sessions (load most recent sessions first, paginate for older data)

### 8.4 Memory Management

**Memory budget**: < 512 MB main thread heap

**Strategies**:

1. **Transfer ArrayBuffers to Workers**:

```typescript
// Main thread
const buffer = new ArrayBuffer(1000000);
worker.postMessage({ buffer }, [buffer]);
// buffer is now neutered (empty) in main thread
```

2. **Dispose of large objects explicitly**:

```typescript
let signalData: Float32Array | null = new Float32Array(720000);
// ... use signalData ...
signalData = null; // Make GC-eligible immediately
```

3. **Use TypedArrays, not regular arrays**:

```typescript
// Bad: 8 bytes per number + object overhead
const values = [1.0, 2.0, 3.0, ...]; // ~16 bytes per number

// Good: 4 bytes per number, contiguous
const values = new Float32Array([1.0, 2.0, 3.0, ...]); // 4 bytes per number
```

4. **Limit chart point count**:

```typescript
const MAX_POINTS_PER_CHART = 10000;

function prepareChartData(signal: SignalData): Float32Array {
  if (signal.values.length <= MAX_POINTS_PER_CHART) {
    return signal.values;
  }
  return downsample(signal, MAX_POINTS_PER_CHART, 'lttb');
}
```

5. **Monitor memory usage**:

```typescript
if (performance.memory) {
  const usedMB = performance.memory.usedJSHeapSize / 1048576;
  const limitMB = performance.memory.jsHeapSizeLimit / 1048576;
  console.log(`Memory: ${usedMB.toFixed(0)} / ${limitMB.toFixed(0)} MB`);

  if (usedMB > limitMB * 0.8) {
    console.warn('Approaching memory limit, clearing caches');
    clearCaches();
  }
}
```

### 8.5 Downsampling Algorithms

**Min-Max (preserves extrema)**:

```typescript
function downsampleMinMax(data: Float32Array, targetCount: number): Float32Array {
  const bucketSize = Math.ceil(data.length / (targetCount / 2));
  const result: number[] = [];

  for (let i = 0; i < data.length; i += bucketSize) {
    const bucket = data.slice(i, i + bucketSize);
    result.push(Math.min(...bucket), Math.max(...bucket));
  }

  return new Float32Array(result.slice(0, targetCount));
}
```

**LTTB (Largest Triangle Three Buckets, perceptually optimized)**:

```typescript
function downsampleLTTB(data: Float32Array, targetCount: number): Float32Array {
  // Implementation: https://github.com/sveinn-steinarsson/flot-downsample
  // Preserves visual shape by selecting points that form the largest triangles
  // ...
}
```

\*_Average (smooth)_:

```typescript
function downsampleAverage(data: Float32Array, targetCount: number): Float32Array {
  const bucketSize = Math.ceil(data.length / targetCount);
  const result = new Float32Array(targetCount);

  for (let i = 0; i < targetCount; i++) {
    const start = i * bucketSize;
    const end = Math.min(start + bucketSize, data.length);
    const bucket = data.slice(start, end);
    const sum = bucket.reduce((a, b) => a + b, 0);
    result[i] = sum / bucket.length;
  }

  return result;
}
```

---

## 10. Storage Management

### 10.1 Quota Detection and Monitoring

```typescript
async function getStorageInfo(): Promise<{
  usage: number;
  quota: number;
  percentUsed: number;
}> {
  if (!navigator.storage || !navigator.storage.estimate) {
    throw new Error('Storage API not supported');
  }

  const estimate = await navigator.storage.estimate();
  const usage = estimate.usage ?? 0;
  const quota = estimate.quota ?? 0;
  const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;

  return { usage, quota, percentUsed };
}

async function checkQuotaWarning(): Promise<void> {
  const info = await getStorageInfo();

  if (info.percentUsed > 80) {
    console.warn(`Storage ${info.percentUsed.toFixed(1)}% full`);
    // Display user warning
  }
}

// Run on startup and after imports
checkQuotaWarning();
```

### 9.2 Data Deletion and Cleanup

**Soft delete** (default):

```typescript
async function softDeleteSession(sessionId: string): Promise<void> {
  const repo = new SessionRepository();
  await repo.update(sessionId, { deleted: true });
  // Signal files remain in OPFS, not visible in UI
}
```

**Hard delete**:

```typescript
async function hardDeleteSession(sessionId: string): Promise<void> {
  // 1. Delete from IndexedDB
  const db = await DatabaseConnection.open();
  const tx = db.transaction(['sessions', 'nightly_aggregates', 'events'], 'readwrite');

  await tx.objectStore('sessions').delete(sessionId);

  const aggIndex = tx.objectStore('nightly_aggregates').index('sessionId');
  const aggregates = await aggIndex.getAll(sessionId);
  for (const agg of aggregates) {
    await tx.objectStore('nightly_aggregates').delete(agg.id);
  }

  const eventIndex = tx.objectStore('events').index('sessionId');
  const events = await eventIndex.getAll(sessionId);
  for (const event of events) {
    await tx.objectStore('events').delete(event.id);
  }

  await tx.complete;

  // 2. Delete from OPFS
  const root = await navigator.storage.getDirectory();
  const signalsDir = await root.getDirectoryHandle('signals');
  await signalsDir.removeEntry(sessionId, { recursive: true });
}
```

**Bulk delete** (date range):

```typescript
async function deleteDateRange(dateRange: DateRange): Promise<void> {
  const repo = new SessionRepository();
  const sessions = await repo.query({ dateRange });

  for (const session of sessions) {
    await hardDeleteSession(session.id);
  }
}
```

### 9.3 Export/Backup Format

**JSON export** (unencrypted):

```json
{
  "version": "1.0",
  "exportedAt": "2026-02-10T12:34:56Z",
  "metadata": {
    "machineId": "SN123456",
    "machineModel": "AirSense 10 AutoSet",
    "dateRange": { "start": "2025-01-01", "end": "2025-12-31" }
  },
  "sessions": [
    /* Session objects */
  ],
  "nightlyAggregates": [
    /* NightlyAggregate objects */
  ],
  "events": [
    /* Event objects */
  ],
  "integrationData": [
    /* IntegrationData objects */
  ],
  "signalData": [
    /* Optional: inline or external references */
  ]
}
```

**Encrypted export** (AES-256-GCM):

```typescript
async function exportEncrypted(data: ExportData, password: string): Promise<Blob> {
  // 1. Serialize data
  const json = JSON.stringify(data);
  const plaintext = new TextEncoder().encode(json);

  // 2. Derive key from password (PBKDF2)
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  // 3. Encrypt
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  // 4. Package (salt + iv + ciphertext)
  const result = new Uint8Array(16 + 12 + ciphertext.byteLength);
  result.set(salt, 0);
  result.set(iv, 16);
  result.set(new Uint8Array(ciphertext), 28);

  return new Blob([result], { type: 'application/octet-stream' });
}
```

### 9.4 Import from Export

```typescript
async function importFromExport(file: File): Promise<void> {
  // 1. Detect format (JSON or encrypted)
  const isEncrypted = file.type === 'application/octet-stream';

  let data: ExportData;

  if (isEncrypted) {
    const password = await promptForPassword();
    data = await decryptExport(file, password);
  } else {
    const json = await file.text();
    data = JSON.parse(json);
  }

  // 2. Validate export format
  if (data.version !== '1.0') {
    throw new Error(`Unsupported export version: ${data.version}`);
  }

  // 3. Import to IndexedDB
  const db = await DatabaseConnection.open();
  const tx = db.transaction(
    ['sessions', 'nightly_aggregates', 'events', 'integration_data'],
    'readwrite',
  );

  for (const session of data.sessions) {
    await tx.objectStore('sessions').add(session);
  }
  for (const agg of data.nightlyAggregates) {
    await tx.objectStore('nightly_aggregates').add(agg);
  }
  for (const event of data.events) {
    await tx.objectStore('events').add(event);
  }
  for (const integration of data.integrationData) {
    await tx.objectStore('integration_data').add(integration);
  }

  await tx.complete;

  // 4. Import signal data (if included)
  if (data.signalData) {
    // ... reconstruct OPFS structure
  }
}
```

---

## 11. Browser Compatibility

### 11.1 Feature Detection

```typescript
function detectFeatureSupport(): FeatureSupport {
  return {
    indexedDB: typeof indexedDB !== 'undefined',
    opfs: typeof navigator.storage?.getDirectory !== 'undefined',
    storageAPI: typeof navigator.storage?.estimate !== 'undefined',
    fileSystemAccess: typeof window.showDirectoryPicker !== 'undefined',
    webWorkers: typeof Worker !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    cryptoSubtle: typeof crypto.subtle !== 'undefined',
  };
}

interface FeatureSupport {
  indexedDB: boolean;
  opfs: boolean;
  storageAPI: boolean;
  fileSystemAccess: boolean;
  webWorkers: boolean;
  sharedArrayBuffer: boolean;
  cryptoSubtle: boolean;
}
```

### 10.2 Fallback Strategies

| Feature                    | Fallback                              | Impact                                   |
| -------------------------- | ------------------------------------- | ---------------------------------------- |
| **OPFS**                   | IndexedDB blob storage                | Lower performance for signal data access |
| **File System Access API** | `<input type="file" webkitdirectory>` | User must select folder manually         |
| **Web Workers**            | Main thread processing                | UI may freeze during imports/analysis    |
| **SharedArrayBuffer**      | ArrayBuffer + postMessage             | Higher memory usage, more copying        |
| **Storage API**            | Assume 500 MB quota                   | Cannot detect actual quota               |

**OPFS fallback** (Safari < 15.2):

```typescript
class SignalStorage {
  private useOPFS: boolean;

  constructor() {
    this.useOPFS = typeof navigator.storage?.getDirectory !== 'undefined';
  }

  async writeChunk(sessionId: string, chunkIndex: number, data: Float32Array): Promise<void> {
    if (this.useOPFS) {
      await this.writeChunkOPFS(sessionId, chunkIndex, data);
    } else {
      await this.writeChunkIndexedDB(sessionId, chunkIndex, data);
    }
  }

  private async writeChunkIndexedDB(
    sessionId: string,
    chunkIndex: number,
    data: Float32Array,
  ): Promise<void> {
    const db = await DatabaseConnection.open();
    const tx = db.transaction('signal_chunks', 'readwrite');
    const blob = new Blob([data.buffer]);
    await tx.objectStore('signal_chunks').add({
      sessionId,
      chunkIndex,
      data: blob,
    });
    await tx.complete;
  }
}
```

### 11.3 Safari-Specific Considerations

**Issue**: Safari 15.2–16.0 had incomplete OPFS support (no `FileSystemSyncAccessHandle`).

**Workaround**: Use async file handles only:

```typescript
// Avoid (not supported in Safari 15.2–16.0):
const syncHandle = await fileHandle.createSyncAccessHandle();

// Use instead:
const file = await fileHandle.getFile();
const arrayBuffer = await file.arrayBuffer();
```

**Issue**: Safari limits IndexedDB to 50 MB by default (requires user permission for more).

**Mitigation**: Request persistent storage:

```typescript
async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage && navigator.storage.persist) {
    return await navigator.storage.persist();
  }
  return false;
}

// Call on first import:
const granted = await requestPersistentStorage();
if (granted) {
  console.log('Persistent storage granted');
} else {
  console.warn('Persistent storage denied, data may be evicted');
}
```

### 11.4 Firefox-Specific Considerations

**Issue**: Firefox 111+ supports OPFS, but older versions do not.

**Mitigation**: Use feature detection (Section 10.1) and fallback.

**Issue**: Firefox limits IndexedDB to 10% of disk space per origin.

**Mitigation**: Monitor quota actively, prompt user to clear data if needed.

### 11.5 Minimum Browser Versions

**Full feature support**:

- Chrome/Edge 86+
- Safari 15.2+
- Firefox 111+

**Degraded mode** (IndexedDB fallback, no File System Access API):

- Chrome/Edge 50+
- Safari 10+
- Firefox 16+

**Unsupported**: Internet Explorer, older mobile browsers.

---

## 12. Security and Data Integrity

### 12.1 Defense Against Quota Exhaustion

**Threat Model**: Malicious or corrupted data could exhaust browser storage quota, preventing legitimate data from being stored or causing application failure.

**Attack Vectors**:

1. **Malicious EDF Files**: Attacker crafts EDF files with inflated data records
2. **Corrupted Import**: Hardware failure or transmission error creates invalid/infinite data
3. **Accidental Overload**: User imports decades of data at once without understanding quota limits
4. **Duplicate Imports**: Same data imported repeatedly, consuming quota

#### 12.1.1 Validation and Limits

**Pre-Import Validation**:

```typescript
interface ImportValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  estimatedSize: number; // bytes
}

async function validateImport(files: File[]): Promise<ImportValidationResult> {
  const result: ImportValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    estimatedSize: 0,
  };

  // 1. Check file count
  if (files.length > 1000) {
    result.errors.push(`Too many files: ${files.length} (max: 1000)`);
    result.valid = false;
    return result;
  }

  // 2. Check individual file sizes
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB per file
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      result.errors.push(
        `File ${file.name} exceeds maximum size: ${file.size} bytes (max: ${MAX_FILE_SIZE})`,
      );
      result.valid = false;
    }
    result.estimatedSize += file.size;
  }

  // 3. Check total import size
  const MAX_IMPORT_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB per import batch
  if (result.estimatedSize > MAX_IMPORT_SIZE) {
    result.errors.push(
      `Total import size exceeds limit: ${result.estimatedSize} bytes (max: ${MAX_IMPORT_SIZE})`,
    );
    result.valid = false;
  }

  // 4. Check available quota
  const quota = await navigator.storage.estimate();
  const available = (quota.quota ?? 0) - (quota.usage ?? 0);
  const estimatedAfterImport = result.estimatedSize * 1.5; // 1.5x for overhead

  if (estimatedAfterImport > available) {
    result.errors.push(
      `Insufficient storage: need ${estimatedAfterImport} bytes, have ${available} bytes`,
    );
    result.valid = false;
  } else if (estimatedAfterImport > available * 0.8) {
    result.warnings.push(
      `Import will use >80% of available storage. Consider clearing old data first.`,
    );
  }

  return result;
}
```

**EDF Header Validation**:

```typescript
interface EDFValidationResult {
  valid: boolean;
  errors: string[];
  header: EDFHeader;
}

function validateEDFHeader(buffer: ArrayBuffer): EDFValidationResult {
  const result: EDFValidationResult = {
    valid: true,
    errors: [],
    header: {} as EDFHeader,
  };

  const view = new DataView(buffer);
  const decoder = new TextDecoder('ascii');

  // Parse header (first 256 bytes)
  const version = decoder.decode(buffer.slice(0, 8)).trim();
  if (version !== '0') {
    result.errors.push(`Unsupported EDF version: ${version}`);
    result.valid = false;
    return result;
  }

  // Number of data records
  const numDataRecords = parseInt(decoder.decode(buffer.slice(236, 244)).trim());
  if (isNaN(numDataRecords) || numDataRecords < 0) {
    result.errors.push(`Invalid number of data records: ${numDataRecords}`);
    result.valid = false;
  }

  // Sanity check: reject absurdly large record counts
  const MAX_DATA_RECORDS = 100000; // ~11 hours at 1-second epochs
  if (numDataRecords > MAX_DATA_RECORDS) {
    result.errors.push(
      `Data record count exceeds maximum: ${numDataRecords} (max: ${MAX_DATA_RECORDS})`,
    );
    result.valid = false;
  }

  // Duration of data record
  const recordDuration = parseFloat(decoder.decode(buffer.slice(244, 252)).trim());
  if (isNaN(recordDuration) || recordDuration <= 0 || recordDuration > 60) {
    result.errors.push(`Invalid data record duration: ${recordDuration} seconds (expected 0-60)`);
    result.valid = false;
  }

  // Number of signals
  const numSignals = parseInt(decoder.decode(buffer.slice(252, 256)).trim());
  if (isNaN(numSignals) || numSignals < 1 || numSignals > 256) {
    result.errors.push(`Invalid number of signals: ${numSignals} (expected 1-256)`);
    result.valid = false;
  }

  // ... additional header validation

  return result;
}
```

**Rate Limiting**:

Prevent rapid repeated imports that could be malicious or accidental:

```typescript
class ImportRateLimiter {
  private importTimestamps: number[] = [];
  private readonly MAX_IMPORTS_PER_HOUR = 50;
  private readonly MAX_IMPORTS_PER_MINUTE = 10;

  canImport(): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneMinuteAgo = now - 60 * 1000;

    // Clean old timestamps
    this.importTimestamps = this.importTimestamps.filter((ts) => ts > oneHourAgo);

    // Check hourly limit
    if (this.importTimestamps.length >= this.MAX_IMPORTS_PER_HOUR) {
      const oldestImport = Math.min(...this.importTimestamps);
      const retryAfter = oldestImport + 60 * 60 * 1000 - now;
      return { allowed: false, retryAfter };
    }

    // Check per-minute limit
    const recentImports = this.importTimestamps.filter((ts) => ts > oneMinuteAgo);
    if (recentImports.length >= this.MAX_IMPORTS_PER_MINUTE) {
      const oldestRecent = Math.min(...recentImports);
      const retryAfter = oldestRecent + 60 * 1000 - now;
      return { allowed: false, retryAfter };
    }

    return { allowed: true };
  }

  recordImport(): void {
    this.importTimestamps.push(Date.now());
  }
}
```

#### 12.1.2 Corruption Detection

**Integrity Checks**:

1. **Checksums**: Store SHA-256 hash of source EDF files

   ```typescript
   async function computeFileHash(file: File): Promise<string> {
     const buffer = await file.arrayBuffer();
     const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
     const hashArray = Array.from(new Uint8Array(hashBuffer));
     return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
   }

   // Store in session metadata
   session.sourceHash = await computeFileHash(edfFile);
   ```

2. **Signal Data Validation**: Verify physiological ranges

   ```typescript
   const PHYSIOLOGICAL_RANGES = {
     Flow: { min: -200, max: 200 }, // L/min
     MaskPress: { min: 0, max: 30 }, // cmH2O
     Leak: { min: 0, max: 200 }, // L/min
     SpO2: { min: 50, max: 100 }, // %
   };

   function validateSignalData(
     channelName: string,
     data: Float32Array,
   ): { valid: boolean; issues: string[] } {
     const range = PHYSIOLOGICAL_RANGES[channelName];
     if (!range) return { valid: true, issues: [] };

     const issues: string[] = [];
     let outlierCount = 0;

     for (let i = 0; i < data.length; i++) {
       if (data[i] < range.min || data[i] > range.max) {
         outlierCount++;
       }
     }

     const outlierPercent = (outlierCount / data.length) * 100;

     if (outlierPercent > 10) {
       issues.push(`${channelName}: ${outlierPercent.toFixed(1)}% of values out of range`);
       return { valid: false, issues };
     } else if (outlierPercent > 1) {
       issues.push(
         `${channelName}: ${outlierPercent.toFixed(1)}% of values out of range (warning)`,
       );
     }

     return { valid: true, issues };
   }
   ```

3. **Database Consistency Checks**: Periodic validation

   ```typescript
   async function validateDatabaseConsistency(): Promise<ValidationReport> {
     const db = await DatabaseConnection.open();
     const report: ValidationReport = {
       valid: true,
       errors: [],
       warnings: [],
     };

     // Check for orphaned records
     const sessions = await db.getAll('sessions');
     const sessionIds = new Set(sessions.map((s) => s.id));

     const nightlyAggs = await db.getAll('nightly_aggregates');
     for (const agg of nightlyAggs) {
       if (!sessionIds.has(agg.sessionId)) {
         report.warnings.push(
           `Orphaned aggregate: ${agg.id} references non-existent session ${agg.sessionId}`,
         );
       }
     }

     // Check for duplicate sessions
     const duplicates = findDuplicates(sessions, (s) => `${s.machineId}:${s.date}`);
     if (duplicates.length > 0) {
       report.errors.push(`Found ${duplicates.length} duplicate sessions`);
       report.valid = false;
     }

     return report;
   }
   ```

#### 12.1.3 Quota Monitoring and Alerts

**Real-Time Monitoring**:

```typescript
class QuotaMonitor {
  private readonly WARNING_THRESHOLD = 0.8; // 80%
  private readonly CRITICAL_THRESHOLD = 0.95; // 95%

  async checkQuota(): Promise<QuotaStatus> {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage ?? 0;
    const quota = estimate.quota ?? 0;
    const percentUsed = quota > 0 ? usage / quota : 0;

    return {
      usage,
      quota,
      percentUsed,
      status: this.getStatus(percentUsed),
    };
  }

  private getStatus(percentUsed: number): 'ok' | 'warning' | 'critical' {
    if (percentUsed >= this.CRITICAL_THRESHOLD) return 'critical';
    if (percentUsed >= this.WARNING_THRESHOLD) return 'warning';
    return 'ok';
  }

  async shouldBlockImport(): Promise<boolean> {
    const status = await this.checkQuota();
    return status.status === 'critical';
  }
}
```

**User Notifications**:

- **80% quota**: Show warning banner, suggest clearing old data
- **95% quota**: Block new imports, require user action
- **Provide tools**: One-click delete old sessions, selective deletion UI

#### 12.1.4 Recovery Mechanisms

**Automatic Cleanup**:

```typescript
async function emergencyCleanup(): Promise<void> {
  const db = await DatabaseConnection.open();

  // 1. Clear all cached analyses (safe to delete, can recompute)
  await db.clear('analysis_results');

  // 2. Clear import history (metadata only, not critical)
  await db.clear('import_history');

  // 3. If still critical, prompt user to delete old sessions
  const quotaStatus = await new QuotaMonitor().checkQuota();
  if (quotaStatus.status === 'critical') {
    // Show UI: "Delete sessions older than..." with date picker
  }
}
```

**Graceful Degradation**:

If quota is exhausted during import:

1. **Stop immediately**: Don't write partial data
2. **Rollback transaction**: Delete incomplete session
3. **Notify user**: Show error message with recovery options
4. **Offer solutions**: Delete old data, export and reimport, use different browser

---

## Summary

The CPAP Analyzer storage architecture uses a **two-tier approach**: **IndexedDB** for structured metadata and analysis results, and **OPFS** for high-performance binary signal storage. Signal data is stored in **5-minute chunks** to enable efficient viewport-based access, with a **manifest-based index** for O(log N) time-range lookups. The system supports **years of full-resolution data** (~22 GB for 10 years) within typical browser storage quotas, with **responsive queries** (< 100ms for summaries, < 200ms for signal data) and **streaming access** to avoid memory exhaustion. **Incremental imports**, **soft/hard deletion**, and **encrypted export/import** provide a complete data lifecycle, while **fallback strategies** ensure compatibility across Chrome, Safari, Firefox, and Edge.
