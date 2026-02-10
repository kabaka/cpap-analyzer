# Storage Architecture

This document specifies the complete client-side storage architecture for the CPAP Analyzer. It defines how multi-year, high-frequency CPAP therapy data is stored, indexed, queried, and managed entirely within the browser.

**Target audience**: Frontend, Database, Performance, and ResMed Specialist agents.

**Last updated**: 2026-02-10

---

## 1. Storage Technology Choices

### 1.1 Technology Split Rationale

| Store | Technology | Purpose | Rationale |
|-------|-----------|---------|-----------|
| **Metadata** | IndexedDB | Session metadata, nightly aggregates, settings, analysis results, import history | Structured queryable data with complex indices. Native transaction support. Cross-browser compatibility. |
| **Signals** | OPFS (Origin Private File System) | High-resolution time-series data (25–50 Hz) | High-throughput binary I/O. Direct file system access. Lower overhead than IndexedDB for large blobs. Better performance for streaming/chunked access. |

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
| 1 month   | ~180 MB     | ~50 KB   | ~180 MB |
| 1 year    | ~2.2 GB     | ~600 KB  | ~2.2 GB |
| 5 years   | ~11 GB      | ~3 MB    | ~11 GB |
| 10 years  | ~22 GB      | ~6 MB    | ~22 GB |

**Browser Quota**: Modern browsers typically allow ~60% of available disk space for OPFS. On a 256 GB device, this permits ~150 GB — sufficient for decades of data.

### 1.3 Browser Compatibility Matrix

| Feature | Chrome | Edge | Safari | Firefox | Notes |
|---------|--------|------|--------|---------|-------|
| IndexedDB | ✅ 24+ | ✅ All | ✅ 10+ | ✅ 16+ | Universal support, battle-tested |
| OPFS | ✅ 86+ | ✅ 86+ | ✅ 15.2+ | ✅ 111+ | Safari required workarounds pre-16 |
| Storage API | ✅ 55+ | ✅ 79+ | ✅ 15.2+ | ✅ 57+ | For quota queries |
| FileReader | ✅ All | ✅ All | ✅ All | ✅ All | For EDF file parsing |
| File System Access API | ✅ 86+ | ✅ 86+ | ❌ | ❌ | SD card access, fallback to file input |

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
  id: string;                    // UUID v4
  machineId: string;             // Machine serial number
  machineModel: string;          // e.g., "AirSense 10 AutoSet"
  firmwareVersion: string;       // e.g., "3.0.2"
  date: string;                  // YYYY-MM-DD (local date)
  startTime: string;             // ISO 8601 timestamp
  endTime: string;               // ISO 8601 timestamp
  durationMinutes: number;       // Total session duration
  usageMinutes: number;          // Actual usage time (may differ if mask-off)
  importedAt: string;            // ISO 8601 timestamp
  sourceHash: string;            // SHA-256 of source EDF files (concat)
  channels: ChannelMetadata[];   // Available signal channels
  signalChunkIds: string[];      // OPFS chunk file references
  hasOximetry: boolean;          // SpO2 data available
  deleted: boolean;              // Soft delete flag
}

interface ChannelMetadata {
  name: string;                  // "Flow", "MaskPress", etc.
  sampleRate: number;            // Hz
  unit: string;                  // "L/min", "cmH2O", etc.
  physicalMin: number;           // EDF physical minimum
  physicalMax: number;           // EDF physical maximum
  digitalMin: number;            // EDF digital minimum
  digitalMax: number;            // EDF digital maximum
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
  sessionId: string;             // FK → sessions.id
  machineId: string;             // Denormalized for efficient queries
  date: string;                  // YYYY-MM-DD
  
  // AHI metrics
  ahi: number;                   // Total AHI (events/hour)
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
  pressureMean: number;          // cmH2O
  pressureMedian: number;
  pressureP95: number;
  pressureMax: number;
  epapMedian: number | null;     // null for fixed-pressure CPAP
  ipapMedian: number | null;     // null for CPAP (BiPAP only)
  pressureSupport: number | null; // IPAP - EPAP
  
  // Leak metrics
  leakMedian: number;            // L/min
  leakP95: number;
  leakMax: number;
  leakDurationMinutes: number;   // Time with leak > 24 L/min
  
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
  sessionId: string;             // FK → sessions.id
  type: EventType;
  timestamp: number;             // Epoch milliseconds (UTC)
  duration: number;              // seconds
  severity: number | null;       // 0–1 for flow limitation
  pressure: number | null;       // cmH2O at event time
  epap: number | null;           // cmH2O at event time
  ipap: number | null;           // cmH2O at event time (BiPAP only)
  leak: number | null;           // L/min at event time
  spo2: number | null;           // % at event time (if oximetry)
  clusterId: string | null;      // FK → cluster ID (computed)
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
  | 'Vibratory'  // Snoring
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
  analysisType: string;          // e.g., "stl-decomposition", "correlation-matrix"
  dateRange: {
    start: string;               // YYYY-MM-DD
    end: string;                 // YYYY-MM-DD
  };
  dateRangeHash: string;         // MD5 of date range for efficient lookup
  parameters: Record<string, unknown>; // Analysis configuration
  results: unknown;              // Structured results (type varies by analysis)
  computedAt: string;            // ISO 8601 timestamp
  cacheVersion: number;          // Invalidate on algorithm changes
  machineIds: string[];          // Machines included in analysis
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
  value: unknown;                // JSON-serializable value
  updatedAt: string;             // ISO 8601 timestamp
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
  importedAt: string;            // ISO 8601 timestamp
  dateRangeStart: string;        // YYYY-MM-DD
  dateRangeEnd: string;          // YYYY-MM-DD
  sessionsImported: number;
  sessionsSkipped: number;       // Already imported (duplicate detection)
  sessionsErrored: number;
  sourceHash: string;            // Hash of import source (SD card identifier)
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
  date: string;                  // YYYY-MM-DD
  data: unknown;                 // Source-specific structure
  importedAt: string;            // ISO 8601 timestamp
}

// Example Fitbit data structure:
interface FitbitDayData {
  heartRate: { time: string; value: number }[]; // 1-minute intervals
  restingHeartRate: number;
  hrv: number | null;            // RMSSD
  spo2: { time: string; value: number }[];      // 5-minute intervals
  sleepStages: {
    deep: number;                // minutes
    light: number;
    rem: number;
    wake: number;
  };
  sleepEfficiency: number;       // percent
}

// Example weather data structure:
interface WeatherDayData {
  temperature: { time: string; value: number }[]; // hourly
  humidity: { time: string; value: number }[];    // hourly
  pressure: { time: string; value: number }[];    // hourly (hPa)
  aqi: { time: string; value: number }[];         // hourly
  pollenCount: number | null;                     // daily
}
```

---

## 3. OPFS Signal Storage

### 3.1 Directory Structure

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

### 3.2 Manifest File Format

Each session directory contains a `manifest.json` file:

```typescript
interface SignalManifest {
  version: 1;                    // Manifest format version
  sessionId: string;             // Matches IndexedDB session ID
  startTime: number;             // Epoch milliseconds
  endTime: number;               // Epoch milliseconds
  durationSeconds: number;
  chunkDurationSeconds: number;  // Fixed chunk duration (default: 300)
  channels: ChannelDescriptor[];
  chunks: ChunkDescriptor[];
}

interface ChannelDescriptor {
  index: number;                 // 0-based channel index in binary files
  name: string;                  // "Flow", "MaskPress", etc.
  sampleRate: number;            // Hz
  unit: string;                  // "L/min", "cmH2O", etc.
  dtype: 'float32';              // Data type (always float32)
  physicalMin: number;
  physicalMax: number;
}

interface ChunkDescriptor {
  index: number;                 // Chunk sequence number
  fileName: string;              // e.g., "chunk-000.bin"
  startTime: number;             // Epoch milliseconds
  endTime: number;               // Epoch milliseconds
  samples: Record<string, number>; // Channel name → sample count
  byteSize: number;              // Total file size in bytes
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
    },
    // ... 96 chunks for 8-hour session
  ]
}
```

### 3.3 Binary Chunk Format

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
  channelName: string
): Promise<Float32Array> {
  // 1. Load manifest
  const manifest = await readManifest(sessionId);
  const chunk = manifest.chunks[chunkIndex];
  const channel = manifest.channels.find(c => c.name === channelName);
  
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

### 3.4 Chunk Sizing Strategy

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

### 3.5 Chunk Index for Fast Lookup

The manifest provides O(1) lookup from time range to chunk IDs:

```typescript
function getChunksForTimeRange(
  manifest: SignalManifest,
  startTime: number,
  endTime: number
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

function binarySearchChunks(
  chunks: ChunkDescriptor[],
  time: number
): number {
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

## 4. Data Models (TypeScript Interfaces)

### 4.1 Core Data Models

All interfaces from Section 2 (IndexedDB Schema) serve as the canonical data models. Additional models for business logic:

```typescript
// ============================================
// Session Import Models
// ============================================

interface ImportRequest {
  directoryHandle: FileSystemDirectoryHandle; // SD card root
  machineId: string | null;     // Auto-detected or user-specified
  incrementalImport: boolean;   // Only import new sessions
  validateOnly: boolean;        // Dry-run mode
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
  importRecordId: string;        // FK → import_history.id
}

// ============================================
// Query Models
// ============================================

interface DateRange {
  start: string;                 // YYYY-MM-DD
  end: string;                   // YYYY-MM-DD
}

interface SessionQuery {
  dateRange?: DateRange;
  machineIds?: string[];
  hasOximetry?: boolean;
  minDurationMinutes?: number;
  deleted?: boolean;             // Include soft-deleted sessions
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
  channels: string[];            // Channel names to retrieve
  timeRange?: {
    startTime: number;           // Epoch milliseconds
    endTime: number;             // Epoch milliseconds
  };
  downsampleTo?: number;         // Target sample count (0 = no downsample)
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
  startTime: number;             // Epoch milliseconds
  timestamps: Float64Array;      // Epoch milliseconds per sample
  values: Float32Array;          // Signal values
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
  q1: number;                    // 25th percentile
  q3: number;                    // 75th percentile
  iqr: number;
  skewness: number;
  kurtosis: number;
  outliers: number[];            // Indices of outlier values
}

interface TimeSeriesDecomposition {
  trend: Float64Array;
  seasonal: Float64Array;
  residual: Float64Array;
  timestamps: string[];          // YYYY-MM-DD
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
  n: number;                     // Sample size
}

interface ClusterAnalysisResult {
  algorithm: 'flg-bridged' | 'kmeans' | 'single-link';
  parameters: Record<string, unknown>;
  clusters: Cluster[];
}

interface Cluster {
  id: string;
  sessionId: string;
  startTime: number;             // Epoch milliseconds
  endTime: number;
  durationSeconds: number;
  events: string[];              // Event IDs (FK → events.id)
  eventCount: number;
  density: number;               // Events per minute
  weightedDensity: number;       // "Choke Factor"
  severityScore: number;         // Composite severity
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
  blob: Blob | null;             // Otherwise
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
  accessToken: string;           // Encrypted in IndexedDB
  refreshToken: string;          // Encrypted
  expiresAt: string;             // ISO 8601
  lastSync: string | null;       // ISO 8601
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
  apiKey: string;                // Encrypted
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

## 5. Query Patterns

### 5.1 Common Query: Date Range Summary

**Use case**: Dashboard, trend analysis, date range comparisons

**Query**:
```typescript
async function getNightlyAggregates(
  dateRange: DateRange,
  machineIds?: string[]
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
    return results.filter(agg => machineIds.includes(agg.machineId));
  }
  
  return results;
}
```

**Performance**: O(log N + K) where N = total records, K = results in range. Typically < 100ms for any range.

### 5.2 Common Query: Single Session Detail

**Use case**: Session detail view, event drill-down

**Query**:
```typescript
async function getSessionDetail(
  sessionId: string
): Promise<{
  session: Session;
  aggregate: NightlyAggregate;
  events: Event[];
}> {
  const db = await openDatabase();
  const tx = db.transaction(
    ['sessions', 'nightly_aggregates', 'events'],
    'readonly'
  );
  
  // Parallel fetches
  const [session, aggregates, events] = await Promise.all([
    tx.objectStore('sessions').get(sessionId),
    tx.objectStore('nightly_aggregates').index('sessionId').getAll(sessionId),
    tx.objectStore('events').index('sessionId').getAll(sessionId)
  ]);
  
  return {
    session,
    aggregate: aggregates[0], // Should be exactly one
    events: events.sort((a, b) => a.timestamp - b.timestamp)
  };
}
```

**Performance**: < 50ms for typical session (< 100 events)

### 5.3 Common Query: Signal Data for Time Range

**Use case**: Signal explorer, chart rendering

**Query**:
```typescript
async function getSignalData(
  query: SignalQuery
): Promise<MultiChannelSignalData> {
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
        endTime
      );
      
      // 5. Downsample if requested
      if (query.downsampleTo && channelData.values.length > query.downsampleTo) {
        const downsampled = downsample(
          channelData,
          query.downsampleTo,
          query.downsampleMethod ?? 'lttb'
        );
        channelDataMap.set(channelName, downsampled);
      } else {
        channelDataMap.set(channelName, channelData);
      }
    })
  );
  
  return {
    sessionId: query.sessionId,
    startTime,
    endTime,
    channels: channelDataMap
  };
}
```

**Performance**: 
- Full-resolution 10-minute window: < 100ms
- Downsampled hour-level view: < 200ms
- Downsampled full-night view: < 300ms

### 5.4 Filtering and Aggregation

**Use case**: "Show all nights with AHI > 10", "Average AHI by month"

**Query with filtering**:
```typescript
async function queryAggregates(
  query: AggregateQuery & { filters?: Filter[] }
): Promise<NightlyAggregate[]> {
  // 1. Get base result set by date range
  let results = await getNightlyAggregates(query.dateRange, query.machineIds);
  
  // 2. Apply filters
  if (query.filters) {
    results = results.filter(agg => {
      return query.filters.every(filter => applyFilter(agg, filter));
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

### 5.5 Handling Data Gaps

**Challenge**: Users may have missing nights (didn't use CPAP, forgot to import, data corruption).

**Strategy**: 
- **Do not fill gaps** with synthetic data — preserve truth
- For time-series analysis, use gap-aware algorithms:
  - Rolling averages: Skip missing days, adjust window size
  - Autocorrelation: Use pairwise deletion (compute only for available pairs)
  - Change-point detection: Treat gaps as potential change points

**Implementation**:
```typescript
function rollingMean(
  values: (number | null)[],
  windowSize: number
): (number | null)[] {
  const result: (number | null)[] = [];
  
  for (let i = 0; i < values.length; i++) {
    const window = values.slice(
      Math.max(0, i - windowSize + 1),
      i + 1
    ).filter(v => v !== null) as number[];
    
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

## 6. Import Pipeline

### 6.1 Pipeline Architecture

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

### 6.2 Import Flow (Step-by-Step)

**Phase 1: Initiation**
1. User selects SD card directory via File System Access API (or file input fallback)
2. Main thread sends directory handle to Import Coordinator worker
3. Import Coordinator scans directory structure
4. Detects machine model from `Identification.tgt` or directory layout
5. Enumerates all EDF files with metadata (name, size, modified date)
6. Checks import history to identify already-imported files (by sourceHash)
7. Estimates import duration and storage requirements
8. Returns scan results to main thread for user confirmation

**Phase 2: Parsing** (per EDF file)
9. Import Coordinator dispatches EDF file to Parser worker
10. Parser reads file via FileReader (chunk by chunk to avoid memory spike)
11. Validates EDF header (magic number, field formats, date/time)
12. Extracts header metadata (patient info, recording info, signal descriptors)
13. Reads data records sequentially
14. Converts digital values to physical units per channel
15. Parses EDF+ annotations (if present) into event structures
16. Transfers signal ArrayBuffers to Converter worker (zero-copy)

**Phase 3: Conversion**
17. Converter receives multi-channel signal data + events
18. Aligns signals to a common time base (handle different sample rates)
19. Validates signal ranges (reject physiologically impossible values)
20. Splits each channel into 5-minute chunks
21. Generates chunk manifest (timestamps, sample counts, byte sizes)
22. Computes session-level aggregates (AHI, leak stats, pressure stats)
23. Transfers chunks + manifest + aggregates to Storage Writer

**Phase 4: Storage**
24. Storage Writer creates session directory in OPFS: `/signals/{sessionId}/`
25. Writes manifest.json
26. Writes each chunk as `chunk-{index}.bin`
27. Opens IndexedDB transaction (readwrite, all stores)
28. Writes Session record
29. Writes NightlyAggregate record
30. Writes Event records (batch insert for efficiency)
31. Commits transaction
32. Notifies Import Coordinator of completion
33. Import Coordinator updates progress, dispatches next file

**Phase 5: Finalization**
34. All files processed
35. Import Coordinator writes ImportRecord to import_history
36. Invalidates affected analysis result caches
37. Notifies main thread of completion
38. Main thread navigates to dashboard or session detail view

### 6.3 Error Handling

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

### 6.4 Incremental Import

**Goal**: On subsequent imports, skip already-imported sessions.

**Implementation**:
```typescript
async function shouldImportFile(
  file: FileSystemFileHandle,
  machineId: string
): Promise<boolean> {
  // 1. Compute file hash
  const fileObj = await file.getFile();
  const arrayBuffer = await fileObj.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const sourceHash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
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

## 7. Data Access Layer

### 7.1 API Design Principles

- **Async-first**: All data access returns Promises
- **Type-safe**: Full TypeScript typing across all operations
- **Transactional**: Use IndexedDB transactions correctly for consistency
- **Streaming-capable**: Signal data can be streamed to avoid loading entire sessions
- **Error-first**: All operations catch and handle errors gracefully

### 7.2 Database Connection Management

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

### 7.3 Repository Pattern

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
      const range = IDBKeyRange.bound(
        query.dateRange.start,
        query.dateRange.end
      );
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
  
  private applyFilters(
    sessions: Session[],
    query: SessionQuery
  ): Session[] {
    return sessions.filter(session => {
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
    return getSignalData(query).then(multi => {
      const data = multi.channels.get(query.channels[0]);
      if (!data) throw new Error(`Channel ${query.channels[0]} not found`);
      return data;
    });
  }
  
  async getMultiChannelData(query: SignalQuery): Promise<MultiChannelSignalData> {
    return getSignalData(query);
  }
  
  async* streamChannelData(
    query: SignalQuery
  ): AsyncGenerator<Float32Array, void, undefined> {
    const manifest = await readManifest(query.sessionId);
    const startTime = query.timeRange?.startTime ?? manifest.startTime;
    const endTime = query.timeRange?.endTime ?? manifest.endTime;
    const chunkIndices = getChunksForTimeRange(manifest, startTime, endTime);
    
    for (const chunkIdx of chunkIndices) {
      const chunkData = await readChunk(
        query.sessionId,
        chunkIdx,
        query.channels[0]
      );
      yield chunkData;
    }
  }
}
```

### 7.4 Query Builder

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

### 7.5 Transaction Handling

**Best practices**:
- Use `'readonly'` transactions when possible (allows concurrent access)
- Keep transactions short (complete within 100ms when possible)
- Batch writes in a single transaction (avoid many small transactions)
- Never perform I/O (OPFS, fetch) inside an IndexedDB transaction

```typescript
async function batchInsertEvents(
  sessionId: string,
  events: Event[]
): Promise<void> {
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

## 8. Performance Optimization

### 8.1 Caching Strategy

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
function downsampleMinMax(
  data: Float32Array,
  targetCount: number
): Float32Array {
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
function downsampleLTTB(
  data: Float32Array,
  targetCount: number
): Float32Array {
  // Implementation: https://github.com/sveinn-steinarsson/flot-downsample
  // Preserves visual shape by selecting points that form the largest triangles
  // ...
}
```

**Average (smooth)*:
```typescript
function downsampleAverage(
  data: Float32Array,
  targetCount: number
): Float32Array {
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

## 9. Storage Management

### 9.1 Quota Detection and Monitoring

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
  const tx = db.transaction(
    ['sessions', 'nightly_aggregates', 'events'],
    'readwrite'
  );
  
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
  "sessions": [ /* Session objects */ ],
  "nightlyAggregates": [ /* NightlyAggregate objects */ ],
  "events": [ /* Event objects */ ],
  "integrationData": [ /* IntegrationData objects */ ],
  "signalData": [ /* Optional: inline or external references */ ]
}
```

**Encrypted export** (AES-256-GCM):
```typescript
async function exportEncrypted(
  data: ExportData,
  password: string
): Promise<Blob> {
  // 1. Serialize data
  const json = JSON.stringify(data);
  const plaintext = new TextEncoder().encode(json);
  
  // 2. Derive key from password (PBKDF2)
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  
  // 3. Encrypt
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  
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
    'readwrite'
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

## 10. Browser Compatibility

### 10.1 Feature Detection

```typescript
function detectFeatureSupport(): FeatureSupport {
  return {
    indexedDB: typeof indexedDB !== 'undefined',
    opfs: typeof navigator.storage?.getDirectory !== 'undefined',
    storageAPI: typeof navigator.storage?.estimate !== 'undefined',
    fileSystemAccess: typeof window.showDirectoryPicker !== 'undefined',
    webWorkers: typeof Worker !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    cryptoSubtle: typeof crypto.subtle !== 'undefined'
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

| Feature | Fallback | Impact |
|---------|----------|--------|
| **OPFS** | IndexedDB blob storage | Lower performance for signal data access |
| **File System Access API** | `<input type="file" webkitdirectory>` | User must select folder manually |
| **Web Workers** | Main thread processing | UI may freeze during imports/analysis |
| **SharedArrayBuffer** | ArrayBuffer + postMessage | Higher memory usage, more copying |
| **Storage API** | Assume 500 MB quota | Cannot detect actual quota |

**OPFS fallback** (Safari < 15.2):
```typescript
class SignalStorage {
  private useOPFS: boolean;
  
  constructor() {
    this.useOPFS = typeof navigator.storage?.getDirectory !== 'undefined';
  }
  
  async writeChunk(
    sessionId: string,
    chunkIndex: number,
    data: Float32Array
  ): Promise<void> {
    if (this.useOPFS) {
      await this.writeChunkOPFS(sessionId, chunkIndex, data);
    } else {
      await this.writeChunkIndexedDB(sessionId, chunkIndex, data);
    }
  }
  
  private async writeChunkIndexedDB(
    sessionId: string,
    chunkIndex: number,
    data: Float32Array
  ): Promise<void> {
    const db = await DatabaseConnection.open();
    const tx = db.transaction('signal_chunks', 'readwrite');
    const blob = new Blob([data.buffer]);
    await tx.objectStore('signal_chunks').add({
      sessionId,
      chunkIndex,
      data: blob
    });
    await tx.complete;
  }
}
```

### 10.3 Safari-Specific Considerations

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

### 10.4 Firefox-Specific Considerations

**Issue**: Firefox 111+ supports OPFS, but older versions do not.

**Mitigation**: Use feature detection (Section 10.1) and fallback.

**Issue**: Firefox limits IndexedDB to 10% of disk space per origin.

**Mitigation**: Monitor quota actively, prompt user to clear data if needed.

### 10.5 Minimum Browser Versions

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

## Summary

The CPAP Analyzer storage architecture uses a **two-tier approach**: **IndexedDB** for structured metadata and analysis results, and **OPFS** for high-performance binary signal storage. Signal data is stored in **5-minute chunks** to enable efficient viewport-based access, with a **manifest-based index** for O(log N) time-range lookups. The system supports **years of full-resolution data** (~22 GB for 10 years) within typical browser storage quotas, with **responsive queries** (< 100ms for summaries, < 200ms for signal data) and **streaming access** to avoid memory exhaustion. **Incremental imports**, **soft/hard deletion**, and **encrypted export/import** provide a complete data lifecycle, while **fallback strategies** ensure compatibility across Chrome, Safari, Firefox, and Edge.
