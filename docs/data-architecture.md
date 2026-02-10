# Data Architecture

This document specifies the data sources, import pipeline, storage architecture, and processing model for the CPAP Analyzer. It is the authoritative reference for the Database, ResMed Specialist, Performance, and Frontend agents.

## 1. Data Sources

### 1.1 ResMed SD Card (Primary)

ResMed machines store therapy data on an SD card in EDF/EDF+ (European Data Format) files. The SD card has a structured directory layout.

#### Directory Structure

```
DATALOG/
├── STR.edf          # Session metadata and summary statistics
├── BRP.edf          # Breathing parameters (flow, pressure)
├── EVE.edf          # Event markers (apneas, hypopneas, etc.)
├── SAD.edf          # SpO2 data (if oximeter attached)
├── CSL.edf          # Cough/sneeze/large leak events
├── PLD.edf          # Pulse/plethysmography data
└── [date-based subdirectories]
    ├── ...edf files per session
    └── ...
Identification.tgt    # Machine identification
STR.edf               # Device settings and configuration
```

The exact structure varies by machine model and firmware version. ResMed AirSense 10 and 11 have different layouts.

#### EDF/EDF+ Format

EDF (European Data Format) is a standard for time-series biomedical data storage.

**Header (256 bytes + 256 × n_signals bytes)**:
- Version, patient info, recording info, start date/time, header size
- Number of data records, duration of each data record
- For each signal: label, transducer type, physical dimension (unit), physical min/max, digital min/max, number of samples per data record

**Data Records**:
- Fixed-duration blocks (typically 1–30 seconds)
- Each signal's samples packed as 16-bit signed integers
- Samples per record × sample rate determines signal frequency

**Signal Channels (ResMed typical)**:

| Channel Label | Sample Rate | Unit | Description |
| ---- | ---- | ---- | ---- |
| Flow | 25 Hz | L/min | Mask airflow |
| MaskPress | 25 Hz | cmH₂O | Mask pressure |
| Leak | 2 Hz | L/min | Total leak rate |
| TidVol | ~0.1 Hz | mL | Tidal volume |
| MinVent | ~0.1 Hz | L/min | Minute ventilation |
| RespRate | ~0.1 Hz | breaths/min | Respiratory rate |
| EPAP | ~0.1 Hz | cmH₂O | Expiratory pressure |
| IPAP | ~0.1 Hz | cmH₂O | Inspiratory pressure (bilevel) |
| SpO2 | 1 Hz | % | Oxygen saturation (if oximeter) |
| Pulse | 1 Hz | bpm | Pulse rate (if oximeter) |

**Event Channels**:
Events are encoded in EDF+ as annotations with timestamps and text labels:
- `Obstructive Apnea` — Duration ≥ 10s, caused by airway collapse
- `Central Apnea` — Duration ≥ 10s, caused by absent respiratory drive
- `Mixed Apnea` — Begins central, becomes obstructive
- `Hypopnea` — Partial airflow reduction
- `RERA` — Respiratory Effort-Related Arousal
- `Flow Limitation` — Inspiratory flow limitation (graded 0–1)
- `Large Leak` — Excessive mask leak
- `Periodic Breathing` — Cheyne-Stokes or oscillatory pattern

#### Machine Model Differences

| Model | Therapy Mode | Data Differences |
| ---- | ---- | ---- |
| AirSense 10 CPAP | Fixed pressure | No IPAP channel, no pressure support |
| AirSense 10 AutoSet | Auto-adjusting | EPAP varies, wider pressure range |
| AirSense 10 VPAP | Bilevel | IPAP and EPAP channels, pressure support |
| AirSense 11 CPAP | Fixed pressure | Updated EDF structure, same channels |
| AirSense 11 AutoSet | Auto-adjusting | Enhanced event detection algorithms |
| AirCurve 10 VAuto | Bilevel auto | Pressure support channel |
| AirCurve 10 ASV | Adaptive servo-ventilation | Additional servo gain and backup rate parameters |

The data import pipeline must handle all models gracefully, extracting whatever channels are available without failing on missing channels.

### 1.2 Fitbit API (Integration Plugin)

OAuth 2.0 with PKCE flow. User authorizes access to their Fitbit data.

**Endpoints used**:
- Intraday Heart Rate (1-minute resolution)
- Intraday SpO2 (5-minute resolution)
- Sleep Stages (per-stage duration)
- Daily Activity Summary (resting HR)

**Rate limits**: 150 requests per hour per user. The integration must be rate-limit-aware and cache responses.

### 1.3 Environmental APIs (Integration Plugin)

Weather and air quality data correlated with therapy dates.

**Potential sources**:
- OpenWeatherMap API (temperature, humidity, pressure)
- AirNow API or AQICN (air quality index, PM2.5)
- Pollen.com or Ambee (pollen counts)

Location-based. User provides their location (city/zip) or uses browser geolocation.

### 1.4 Future Machine Manufacturers (Plugin Architecture)

The machine plugin interface must accommodate:
- **Philips Respironics**: Different EDF conventions, different channel labels
- **Fisher & Paykel**: Proprietary data format
- **Löwenstein**: Different directory structure
- **DeVilbiss**: Different event encoding

Each manufacturer plugin encapsulates all format-specific knowledge.

## 2. Data Import Pipeline

### 2.1 User Flow

1. User inserts their ResMed SD card into their computer.
2. The application may detect the card automatically (via File System Access API, if available) or the user selects the SD card location via a directory picker.
3. The application scans the directory structure to identify machine model, data range, and estimated import size.
4. A confirmation dialog shows what will be imported (date range, estimated sessions, estimated storage).
5. Import proceeds with a progress indicator showing: files processed, sessions imported, time remaining.
6. On completion, the user is directed to the dashboard.

### 2.2 Incremental Import

After the initial import, subsequent imports should detect and import only new data:
- Track the last imported session date per machine.
- Scan the SD card for sessions after that date.
- Import only the new sessions.
- Handle the case where the user replays an already-imported session (deduplicate).

### 2.3 Processing Pipeline

```
SD Card Files (EDF)
    │
    ▼
┌─────────────────────────┐
│ Web Worker: EDF Parser   │
│ - Read EDF header        │
│ - Validate structure     │
│ - Extract signal data    │
│ - Extract event markers  │
│ - Extract session metadata│
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ Web Worker: Converter    │
│ - Convert 16-bit int →   │
│   physical units          │
│ - Compute derived channels│
│ - Split into time-aligned │
│   chunks                  │
│ - Compute session summary │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ Storage Writer           │
│ - Write chunks to OPFS   │
│ - Write session metadata │
│   to IndexedDB           │
│ - Write summary metrics  │
│   to IndexedDB           │
│ - Update import history  │
└─────────────────────────┘
```

### 2.4 EDF Parsing Details

The EDF parser must:

- **Validate the header**: Check magic number, verify field lengths, validate date/time format.
- **Handle malformed files**: Truncated files, incorrect sample counts, invalid physical ranges. Log issues but continue with valid data.
- **Convert digital to physical**: `physical = (digital - digital_min) / (digital_max - digital_min) × (physical_max - physical_min) + physical_min`
- **Handle multi-record sessions**: Sessions may span multiple EDF files or directory structures.
- **Detect session boundaries**: A "night" may span midnight. Sessions less than a configurable minimum (default: 30 minutes) may be filtered.
- **Parse EDF+ annotations**: Extract event markers with timestamps from the EDF+ annotation signal.

### 2.5 Validation and Integrity

- Reject files that are not valid EDF (wrong header, corrupt data).
- Warn on values outside physiological ranges (e.g., AHI > 200, pressure > 30 cmH₂O, flow > 300 L/min).
- Verify session continuity — detect data gaps within sessions.
- Checksum or hash imported files to prevent reimporting identical data.

## 3. Storage Architecture

### 3.1 Technology Selection

| Store | Technology | Purpose |
| ---- | ---- | ---- |
| **Metadata Store** | IndexedDB | Session metadata, nightly aggregates, settings, analysis results, import history |
| **Signal Store** | OPFS (Origin Private File System) | High-resolution time-series data in chunked binary format |

**Rationale**: IndexedDB is well-suited for structured, queryable data with complex indices. OPFS provides direct file system access with better performance for large binary blobs, avoiding the overhead of IndexedDB transactions for high-throughput signal data.

### 3.2 Schema: Metadata Store (IndexedDB)

#### Sessions Table
```
{
  id: string (UUID),
  machineId: string,
  machineModel: string,
  firmwareVersion: string,
  date: string (YYYY-MM-DD),
  startTime: string (ISO 8601),
  endTime: string (ISO 8601),
  durationMinutes: number,
  importedAt: string (ISO 8601),
  sourceHash: string (SHA-256 of source EDF),
  channels: string[] (available signal channels),
  signalChunkIds: string[] (references to OPFS chunks)
}
```

#### Nightly Aggregates Table
```
{
  sessionId: string (FK → Sessions),
  date: string (YYYY-MM-DD),
  ahi: number,
  ahiObstructive: number,
  ahiCentral: number,
  ahiHypopnea: number,
  leakMedian: number,
  leakP95: number,
  pressureMean: number,
  pressureMax: number,
  epapMedian: number,
  ipapMedian: number | null,
  tidalVolumeMean: number | null,
  minuteVentMean: number | null,
  respRateMean: number | null,
  usageHours: number,
  eventCount: number,
  eventsByType: { obstructive: number, central: number, mixed: number, hypopnea: number, rera: number },
  spo2Mean: number | null,
  spo2Min: number | null,
  notes: string
}
```

#### Events Table
```
{
  id: string (UUID),
  sessionId: string (FK → Sessions),
  type: string (event type enum),
  timestamp: number (epoch ms),
  duration: number (seconds),
  severity: number | null (0-1 for FLG),
  pressure: number | null (cmH₂O),
  epap: number | null (cmH₂O)
}
```

#### Analysis Results Table
```
{
  id: string (UUID),
  analysisType: string,
  dateRange: { start: string, end: string },
  parameters: object (analysis configuration),
  results: object (structured results),
  computedAt: string (ISO 8601)
}
```

#### Settings Table
```
{
  key: string (setting name),
  value: any (setting value)
}
```

#### Import History Table
```
{
  id: string (UUID),
  machineId: string,
  importedAt: string (ISO 8601),
  dateRangeStart: string,
  dateRangeEnd: string,
  sessionsImported: number,
  sourceHash: string
}
```

### 3.3 Schema: Signal Store (OPFS)

High-resolution signal data is stored in OPFS as binary files organized by session and time window.

#### Directory Structure

```
cpap-analyzer/
└── signals/
    └── {sessionId}/
        ├── manifest.json
        ├── chunk-000.bin
        ├── chunk-001.bin
        └── ...
```

#### Manifest Format
```json
{
  "sessionId": "uuid",
  "channels": [
    { "name": "Flow", "sampleRate": 25, "unit": "L/min", "dtype": "float32" },
    { "name": "MaskPress", "sampleRate": 25, "unit": "cmH2O", "dtype": "float32" },
    { "name": "Leak", "sampleRate": 2, "unit": "L/min", "dtype": "float32" }
  ],
  "chunkDurationSeconds": 300,
  "chunks": [
    { "index": 0, "startTime": 1709251200000, "samples": { "Flow": 7500, "MaskPress": 7500, "Leak": 600 } },
    { "index": 1, "startTime": 1709251500000, "samples": { "Flow": 7500, "MaskPress": 7500, "Leak": 600 } }
  ]
}
```

#### Binary Chunk Format

Each chunk file contains interleaved channel data in Float32 format:
- All samples for channel 0, then all samples for channel 1, etc.
- Float32 (4 bytes per sample) for numerical precision and JavaScript Float64 compatibility.
- Fixed chunk duration (5 minutes = 300 seconds) for predictable sizing.

#### Chunk Sizing Calculation

For a 5-minute chunk with typical ResMed channels:
- Flow: 25 Hz × 300s × 4 bytes = 30,000 bytes
- MaskPress: 25 Hz × 300s × 4 bytes = 30,000 bytes
- Leak: 2 Hz × 300s × 4 bytes = 2,400 bytes
- TidVol, MinVent, RespRate: ~0.1 Hz × 300s × 4 bytes ≈ 120 bytes each
- **Total per chunk**: ~63 KB

For an 8-hour night: ~96 chunks → ~6 MB per night.

### 3.4 Storage Estimation

| Timeframe | Nights | Signal Data | Metadata | Total |
| ---- | ---- | ---- | ---- | ---- |
| 1 month | ~30 | ~180 MB | ~50 KB | ~180 MB |
| 1 year | ~365 | ~2.2 GB | ~600 KB | ~2.2 GB |
| 5 years | ~1,825 | ~11 GB | ~3 MB | ~11 GB |
| 10 years | ~3,650 | ~22 GB | ~6 MB | ~22 GB |

Browser storage quotas vary but modern browsers typically allow up to ~60% of available disk space for OPFS. On a device with 256 GB storage, this allows ~150 GB — sufficient for decades of data.

The application must:
- Display current storage usage.
- Warn when approaching quota limits.
- Allow users to delete old data or reduce retention.
- Handle `QuotaExceededError` gracefully without data corruption.

### 3.5 Schema Versioning

The schema version is tracked in IndexedDB settings. When the application detects a schema version mismatch:

1. Read the current schema version from settings.
2. Apply migrations sequentially from (current + 1) to target.
3. Each migration is a function that transforms the store contents.
4. Migrations are transactional — if a migration fails, it is rolled back.
5. After successful migration, update the schema version.

**Rule**: Schema migrations must be backward-compatible or provide export/reimport capability. Never break access to existing data.

## 4. Data Access Patterns

### 4.1 Summary Queries (IndexedDB)

The most common queries are over nightly aggregate data:

- **Date range query**: Get all nightly aggregates for a date range (e.g., last 30 days, last year, all time). This is the foundation for dashboard, trend analysis, and comparison views.
- **Single session lookup**: Get all data for one specific session (metadata, aggregates, events).
- **Machine filter**: Filter by machine model or machine ID (for multi-machine users).

These queries must complete in < 100 ms for any date range.

### 4.2 Signal Queries (OPFS)

Signal data is accessed in response to user interaction (zooming into a specific time range):

- **Time range request**: Given a session and time range, return the signal data for all channels in that range.
- **Downsampled request**: Given a session, time range, and target sample count, return a downsampled representation.

The access pattern is viewport-based:
1. The visualization layer requests data for the currently visible time range.
2. The data access layer identifies which chunks overlap the requested range.
3. Only those chunks are loaded from OPFS.
4. If the requested resolution is lower than the native resolution, data is downsampled before returning.

This ensures that memory usage is proportional to the visible time range, not the total dataset size.

### 4.3 Downsampling Strategies

| Algorithm | When Used | Properties |
| ---- | ---- | ---- |
| **Min-Max** | Intermediate zoom levels | Preserves peaks and valleys. Each downsampled point is (min, max) of the original window. |
| **LTTB** (Largest Triangle Three Buckets) | Moderate zoom levels | Perceptually optimized — preserves the general shape of the data with fewer points. |
| **Average** | Low zoom levels (year view) | Simple mean per time window. Suitable when individual events are not visible. |
| **None** (native resolution) | Highest zoom levels | Full 25–50 Hz data when zoomed in enough. |

The downsampling level is chosen automatically based on the ratio of requested time range to available pixels.

## 5. Processing Architecture

### 5.1 Web Worker Structure

```
Main Thread (UI)
    │
    ├── Worker: EDF Parser
    │   - Reads EDF files from File System Access API
    │   - Parses headers and data records
    │   - Transfers ArrayBuffers to main thread
    │
    ├── Worker: Analysis Engine
    │   - Runs statistical computations
    │   - Receives data via Transferable ArrayBuffers
    │   - Returns structured results
    │
    ├── Worker: Downsampler
    │   - Fetches signal chunks from OPFS
    │   - Applies downsampling algorithm
    │   - Transfers downsampled ArrayBuffers
    │
    └── Worker: Integration
        - Fitbit API communication
        - Weather API communication
        - Correlation computation
```

### 5.2 Data Transfer Strategy

- **Transferable objects**: Use `postMessage(data, [transferList])` to transfer `ArrayBuffer` ownership between threads. This is a zero-copy operation and critical for performance with large signal buffers.
- **SharedArrayBuffer**: Consider for read-heavy workloads where multiple workers need to read the same data simultaneously (e.g., multiple chart views requesting overlapping signal ranges). Requires COOP/COEP security headers.
- **Structured clone**: For small structured data (metadata, analysis parameters, results). Acceptable for objects < 1 MB.

### 5.3 Back-Pressure Mechanism

During large imports, the processing pipeline must not overwhelm the browser:

- Process EDF files one at a time (sequential file parsing).
- Use `requestIdleCallback` or chunked processing to yield to the main thread periodically.
- Monitor memory usage and pause import if approaching available heap limits.
- Report progress to the UI after each session is processed, not after each file byte.

### 5.4 Memory Budget

Target memory budget for the main thread: **< 512 MB**.

- Signal data is never fully loaded into main thread memory. Chunks are loaded on-demand by Workers and transferred.
- Analysis results are cached in IndexedDB, not held in memory.
- Visualization data (downsampled points) is bounded by pixel count — typically < 10,000 points per chart regardless of the underlying data size.
- Dispose of ArrayBuffers after transfer (they are neutered after transfer and GC-eligible).

## 6. Data Lifecycle

### 6.1 Import
User selects SD card → EDF parsed → converted to binary chunks → stored in OPFS + IndexedDB.

### 6.2 Process
On-demand analysis as user navigates. Results cached in IndexedDB for future access. Cache invalidated when new data is imported for the affected date range.

### 6.3 Store
Data persists in browser storage across sessions. The application checks storage integrity on startup.

### 6.4 Query
Viewport-based signal access, indexed metadata queries, cached analysis results.

### 6.5 Export
Users can export:
- Session data as JSON (with optional AES-256-GCM encryption)
- Analysis results as CSV
- Reports as PDF
- Raw signal data as EDF or CSV

### 6.6 Delete
Users can delete individual sessions, date ranges, or all data. Deletion removes data from both OPFS and IndexedDB. The operation is confirmed by the user and is irreversible.
