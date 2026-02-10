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
      colno: event.colno
    }
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
  await db.transaction('feedback', 'readwrite')
    .objectStore('feedback')
    .add({ ...feedback, timestamp: new Date().toISOString() });
  
  // Tell user how to share if they want to
  showNotification(
    'Feedback saved locally. To share with developers, use Settings → Export Feedback.'
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
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
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
  const hasIndexedDB = databases.some(db => db.name === 'cpap-analyzer');
  
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
      'FILE_TOO_LARGE'
    );
  }
}

function validateBatchSize(files: File[]): void {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_TOTAL_IMPORT_SIZE) {
    throw new ValidationError(
      `Import batch exceeds maximum size (${MAX_TOTAL_IMPORT_SIZE / 1024 / 1024 / 1024} GB)`,
      'BATCH_TOO_LARGE'
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
  version: string;        // Must be "0       " (8 bytes, space-padded)
  patientId: string;      // 80 bytes, ASCII
  recordingId: string;    // 80 bytes, ASCII
  startDate: string;      // 8 bytes, "dd.mm.yy" format
  startTime: string;      // 8 bytes, "hh.mm.ss" format
  headerBytes: number;    // Must equal 256 + (256 * numSignals)
  reserved: string;       // 44 bytes, should contain "EDF+C" or "EDF+D"
  numRecords: number;     // -1 or positive integer
  recordDuration: number; // Positive integer (seconds)
  numSignals: number;     // Positive integer (typically 1-64)
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
  const expectedHeaderBytes = 256 + (256 * numSignals);
  
  if (headerBytes !== expectedHeaderBytes) {
    throw new ValidationError(
      `Header byte count mismatch: expected ${expectedHeaderBytes}, got ${headerBytes}`,
      'INVALID_HEADER'
    );
  }
  
  // Signal count sanity check
  if (numSignals < 1 || numSignals > 256) {
    throw new ValidationError(
      `Invalid signal count: ${numSignals} (must be 1-256)`,
      'INVALID_HEADER'
    );
  }
  
  // Record duration sanity check
  const recordDuration = parseInt(readString(buffer, 244, 8).trim(), 10);
  if (recordDuration < 1 || recordDuration > 3600) {
    throw new ValidationError(
      `Invalid record duration: ${recordDuration}s (must be 1-3600)`,
      'INVALID_HEADER'
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
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
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
  respRate: { min: 0, max: 60, unit: 'breaths/min' }
};

function validateSignalData(
  channelName: string,
  data: Float32Array
): ValidationWarnings {
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
      'CORRUPT_SIGNAL_DATA'
    );
  }
  
  // Warn if >5% of values are out of physiological range
  if (outOfRangePercent > 5) {
    warnings.push(
      `Signal ${channelName}: ${outOfRangePercent.toFixed(1)}% of values outside ` +
      `physiological range [${range.min}, ${range.max}] ${range.unit}`
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
      setTimeout(
        () => reject(new Error('Parse timeout exceeded')),
        PARSE_TIMEOUT_MS
      )
    )
  ]);
}
```

**Memory Limits**:
```typescript
const MAX_SIGNAL_SAMPLES = 100_000_000; // 100M samples = ~400 MB Float32Array

function enforceMemoryLimits(header: EDFHeader): void {
  const samplesPerRecord = header.signals.reduce(
    (sum, sig) => sum + sig.samplesPerRecord,
    0
  );
  const totalSamples = samplesPerRecord * header.numRecords;
  
  if (totalSamples > MAX_SIGNAL_SAMPLES) {
    throw new ValidationError(
      `File exceeds maximum sample count: ${totalSamples} > ${MAX_SIGNAL_SAMPLES}`,
      'TOO_MANY_SAMPLES'
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
    type: 'module'
  })
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
      `String read out of bounds: offset=${offset}, length=${length}, bufferSize=${buffer.byteLength}`
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
    text: sanitizeHTML(annotationText) // HTML encode for display
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
  MIN_IMPORT_INTERVAL_MS: 5000 // 5 seconds between imports
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
  const tx = db.transaction(
    ['sessions', 'nightly_aggregates', 'events'],
    'readwrite'
  );
  
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
  return allSessions.filter(session =>
    session.notes?.toLowerCase().includes(sanitized.toLowerCase()) ||
    session.tags?.some(tag => tag.toLowerCase().includes(sanitized.toLowerCase()))
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
      'PATH_TRAVERSAL'
    );
  }
  
  // Enforce path format
  if (!/^signals\/[a-f0-9-]{36}\/[\w.-]+$/.test(path)) {
    throw new SecurityError(
      `Invalid OPFS path format: ${path}`,
      'INVALID_PATH'
    );
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
      `have ${(available / 1024 / 1024).toFixed(1)} MB available`
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
    "react": "18.2.0",           // Exact version, no ^ or ~
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

| Directive | Value | Rationale |
|-----------|-------|-----------|
| `default-src` | `'self'` | Only load resources from same origin |
| `script-src` | `'self' 'wasm-unsafe-eval'` | Allow bundled scripts and WebAssembly (if used for SIMD) |
| `style-src` | `'self' 'unsafe-inline'` | Allow CSS Modules (inline styles in React components) |
| `img-src` | `'self' data: blob:` | Allow images from origin, data URLs (icons), blob URLs (charts) |
| `font-src` | `'self' data:` | Allow fonts from origin and data URLs |
| `connect-src` | `'self' https://api.fitbit.com https://api.openweathermap.org` | Allow fetch to same origin and user-configured integrations |
| `worker-src` | `'self' blob:` | Allow Web Workers from same origin and blob URLs (Comlink) |
| `object-src` | `'none'` | Disallow plugins (Flash, Java applets) |
| `base-uri` | `'self'` | Prevent <base> tag injection |
| `form-action` | `'self'` | Forms can only submit to same origin (no forms in app, but defense in depth) |
| `frame-ancestors` | `'none'` | Prevent embedding in iframes (clickjacking protection) |
| `block-all-mixed-content` | — | Block HTTP resources on HTTPS page |
| `upgrade-insecure-requests` | — | Upgrade HTTP requests to HTTPS |

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
    lineNumber: event.lineNumber
  });
  
  // Store violation in IndexedDB for user review
  logSecurityEvent({
    type: 'csp-violation',
    timestamp: new Date().toISOString(),
    details: {
      blockedURI: event.blockedURI,
      violatedDirective: event.violatedDirective
    }
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
  type: 'module'
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
      machineModel: data.metadata.machineModel // Clinical relevance, not identifying
    },
    sessions: data.sessions.map(session => ({
      ...session,
      machineId: data.includeDeviceInfo ? session.machineId : '[REDACTED]',
      importedAt: data.includeTimestamps ? session.importedAt : '[REDACTED]'
    }))
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
        note: 'Large file size (may be >1 GB)'
      },
      includeDeviceInfo: {
        label: 'Include machine serial number',
        default: false,
        note: 'Device serial may be identifying information'
      },
      includeTimestamps: {
        label: 'Include exact import timestamps',
        default: false,
        note: 'Timestamps may reveal usage patterns'
      },
      encrypt: {
        label: 'Encrypt export with password',
        default: true,
        note: 'Recommended for sharing or backup'
      }
    }
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
  if (size > 10_000_000_000) { // 10 GB
    throw new Error('Export exceeds maximum size (10 GB)');
  }
}
```

---

## 8. Plugin Security Model

### 8.1 Sandboxing Strategy

**Isolation Boundaries**:
```
┌──────────────────────────────────────────────────┐
│  Application Core (Trusted)                     │
│  ┌────────────────────────────────────────────┐ │
│  │  Plugin Manager                            │ │
│  │  - Loads plugins                           │ │
│  │  - Validates plugin manifests              │ │
│  │  - Enforces permissions                    │ │
│  └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────┐
│  Plugin Sandbox (Untrusted)                     │
│  ┌────────────────────────────────────────────┐ │
│  │  Third-Party Plugin Code                   │ │
│  │  - Receives DataProvider interface only   │ │
│  │  - No direct access to IndexedDB/OPFS     │ │
│  │  - No direct access to fetch/network      │ │
│  │  - No access to user credentials          │ │
│  └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

**Plugin Execution in Worker**:
```typescript
// src/core/plugin-manager.ts
async function executePlugin(
  plugin: AnalysisPlugin,
  input: AnalysisInput
): Promise<AnalysisOutput> {
  // Load plugin in dedicated worker
  const worker = new Worker(new URL('./plugin-sandbox.worker.ts', import.meta.url), {
    type: 'module'
  });
  
  // Create sandboxed DataProvider
  const dataProvider = createSandboxedDataProvider(plugin.dataRequirements);
  
  // Execute with timeout
  const result = await Promise.race([
    executePluginInWorker(worker, plugin, input, dataProvider),
    timeout(plugin.metadata.timeout ?? 60_000)
  ]);
  
  // Terminate worker
  worker.terminate();
  
  return result;
}
```

### 8.2 Permission Model

**Plugin Manifest**:
```typescript
interface PluginManifest {
  id: string;
  name: string;
  version: string;
  permissions: Permission[];
  dataRequirements: DataRequirements;
}

type Permission =
  | 'read:sessions'
  | 'read:aggregates'
  | 'read:events'
  | 'read:signals'
  | 'read:integration:fitbit'
  | 'read:integration:weather'
  | 'network:fetch'
  | 'storage:cache';

interface DataRequirements {
  stores: StoreName[];
  signals?: string[];
  minSampleSize: number;
}
```

**Permission Enforcement**:
```typescript
function createSandboxedDataProvider(
  plugin: PluginManifest
): DataProvider {
  return {
    async getNightlyAggregates(dateRange, metrics, machineIds) {
      // Check permission
      if (!plugin.permissions.includes('read:aggregates')) {
        throw new SecurityError(
          `Plugin ${plugin.id} does not have permission read:aggregates`,
          'PERMISSION_DENIED'
        );
      }
      
      // Fetch data
      return await fetchNightlyAggregates(dateRange, metrics, machineIds);
    },
    
    async getSignalData(sessionId, channelName) {
      // Check permission
      if (!plugin.permissions.includes('read:signals')) {
        throw new SecurityError(
          `Plugin ${plugin.id} does not have permission read:signals`,
          'PERMISSION_DENIED'
        );
      }
      
      // Check channel name against manifest
      if (
        plugin.dataRequirements.signals &&
        !plugin.dataRequirements.signals.includes(channelName)
      ) {
        throw new SecurityError(
          `Plugin ${plugin.id} did not declare access to signal ${channelName}`,
          'UNDECLARED_DATA_ACCESS'
        );
      }
      
      // Fetch data
      return await fetchSignalData(sessionId, channelName);
    }
  };
}
```

**User Consent**:
```typescript
async function installPlugin(plugin: PluginManifest): Promise<void> {
  // Show permission consent dialog
  const granted = await showPermissionDialog({
    pluginName: plugin.name,
    permissions: plugin.permissions,
    dataRequirements: plugin.dataRequirements
  });
  
  if (!granted) {
    throw new Error('User denied plugin permissions');
  }
  
  // Store plugin with granted permissions
  await storePlugin(plugin);
}

function showPermissionDialog(options: {
  pluginName: string;
  permissions: Permission[];
  dataRequirements: DataRequirements;
}): Promise<boolean> {
  return showDialog({
    title: `Install ${options.pluginName}?`,
    message: 'This plugin requests the following permissions:',
    permissions: options.permissions.map(perm => ({
      permission: perm,
      description: PERMISSION_DESCRIPTIONS[perm]
    })),
    buttons: ['Deny', 'Allow']
  });
}

const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'read:sessions': 'Access to your session metadata (dates, durations, machine info)',
  'read:aggregates': 'Access to nightly summary statistics (AHI, pressure, leak)',
  'read:events': 'Access to detailed event data (apneas, hypopneas)',
  'read:signals': 'Access to high-resolution signal data (flow, pressure waveforms)',
  'read:integration:fitbit': 'Access to your Fitbit data',
  'read:integration:weather': 'Access to your weather data',
  'network:fetch': 'Make network requests to external services',
  'storage:cache': 'Store cached results in browser storage'
};
```

### 8.3 Plugin Code Review

**Pre-Installation Review Checklist**:
1. ✅ Plugin manifest is valid JSON
2. ✅ Requested permissions match functionality
3. ✅ Plugin code passes ESLint security rules
4. ✅ No obfuscated code (minification allowed, but must be reversible)
5. ✅ No `eval()`, `Function()`, or dynamic code execution
6. ✅ No direct DOM access (plugins operate on data only)
7. ✅ No network requests unless `network:fetch` permission granted
8. ✅ Plugin source code available for audit (GitHub, npm, etc.)

**Automated Checks**:
```typescript
async function validatePluginCode(pluginCode: string): Promise<ValidationResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  
  // Check for eval/Function
  if (/\beval\s*\(/.test(pluginCode) || /\bFunction\s*\(/.test(pluginCode)) {
    errors.push('Plugin contains eval() or Function() (prohibited)');
  }
  
  // Check for fetch/XMLHttpRequest
  if (/\b(fetch|XMLHttpRequest)\b/.test(pluginCode)) {
    warnings.push('Plugin makes network requests (requires network:fetch permission)');
  }
  
  // Check for direct storage access
  if (/\b(indexedDB|localStorage|sessionStorage)\b/.test(pluginCode)) {
    errors.push('Plugin accesses browser storage directly (prohibited, use DataProvider)');
  }
  
  // Lint with security rules
  const lintResults = await eslint.lintText(pluginCode);
  for (const result of lintResults) {
    for (const message of result.messages) {
      if (message.severity === 2) {
        errors.push(`ESLint error: ${message.message}`);
      } else {
        warnings.push(`ESLint warning: ${message.message}`);
      }
    }
  }
  
  return { valid: errors.length === 0, errors, warnings };
}
```

### 8.4 Plugin Update Strategy

**Update Notifications**:
```typescript
async function checkPluginUpdates(): Promise<PluginUpdate[]> {
  const installedPlugins = await getInstalledPlugins();
  const updates: PluginUpdate[] = [];
  
  for (const plugin of installedPlugins) {
    // Check plugin registry for updates
    const latestVersion = await fetchLatestPluginVersion(plugin.id);
    
    if (semverGt(latestVersion.version, plugin.version)) {
      updates.push({
        pluginId: plugin.id,
        currentVersion: plugin.version,
        latestVersion: latestVersion.version,
        changelog: latestVersion.changelog,
        permissionChanges: diffPermissions(plugin.permissions, latestVersion.permissions)
      });
    }
  }
  
  return updates;
}

// User must explicitly approve updates
async function updatePlugin(pluginId: string): Promise<void> {
  const update = await fetchPluginUpdate(pluginId);
  
  // If permissions changed, require re-consent
  if (update.permissionChanges.length > 0) {
    const granted = await showPermissionDialog({
      pluginName: update.name,
      permissions: update.newPermissions,
      message: 'This update requests new permissions:'
    });
    
    if (!granted) {
      throw new Error('User denied new permissions');
    }
  }
  
  // Validate new plugin code
  const validation = await validatePluginCode(update.code);
  if (!validation.valid) {
    throw new Error(`Plugin validation failed: ${validation.errors.join(', ')}`);
  }
  
  // Install update
  await installPlugin(update);
}
```

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
    notifyUser('storage-persistence-denied', 
      'Your browser may delete data if storage is low. Save regular backups.');
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
      startIn: 'downloads' // Suggest starting directory
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
    subtree: true
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
  "extends": [
    "plugin:security/recommended"
  ],
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

| Level | Description | Response Time | Example |
|-------|-------------|---------------|---------|
| **Critical** | Active data exfiltration, RCE exploit | Immediate | Compromised dependency transmitting PHI |
| **High** | Potential data breach, XSS vulnerability | 24 hours | Unescaped user input in chart labels |
| **Medium** | DoS, client-side crash, logic error | 7 days | Malformed EDF crashes parser |
| **Low** | UI bug, performance issue | 30 days | Slow query on large datasets |

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

| Right | Implementation |
|-------|----------------|
| **Right to Access** | Users have full access to all their data via UI and export function |
| **Right to Rectification** | Users can edit session notes, tags, and metadata |
| **Right to Erasure** | Users can delete individual sessions or all data ("Complete Wipe") |
| **Right to Data Portability** | JSON export format (unencrypted or encrypted) allows data transfer |
| **Right to Object** | No automated decision-making; all analysis is user-initiated |

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
    buttons: ['I Understand']
  });
}
```

### 11.3 Data Retention Policy

**User-Controlled**:
```typescript
interface RetentionPolicy {
  enabled: boolean;
  maxAgeMonths: number; // 0 = indefinite
  autoDelete: boolean;  // Auto-delete data older than maxAgeMonths
}

// Default: indefinite retention
const DEFAULT_RETENTION: RetentionPolicy = {
  enabled: false,
  maxAgeMonths: 0,
  autoDelete: false
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
    console.log(`[Retention] Auto-deleted ${oldSessions.length} sessions older than ${policy.maxAgeMonths} months`);
  } else {
    // Notify user
    notifyUser('retention-policy-triggered', 
      `${oldSessions.length} sessions are older than your retention policy (${policy.maxAgeMonths} months). ` +
      `Consider deleting them or exporting for backup.`
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

| Threat | Mitigation |
|--------|------------|
| **Spoofing** | N/A (no authentication, single-user app) |
| **Tampering** | IndexedDB transactions, OPFS write validation, CSP |
| **Repudiation** | N/A (no multi-user actions to repudiate) |
| **Information Disclosure** | Client-side only, no network transmission, encrypted exports |
| **Denial of Service** | File size limits, timeout enforcement, resource limits |
| **Elevation of Privilege** | Plugin sandboxing, permission model, CSP |

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
  await db.transaction('security_log', 'readwrite')
    .objectStore('security_log')
    .add({
      ...event,
      id: crypto.randomUUID()
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
  const events = await db.transaction('security_log')
    .objectStore('security_log')
    .getAll();
  
  return events.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
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
    timestamp: new Date().toISOString()
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

| Control | Purpose | Status |
|---------|---------|--------|
| **Input Validation** | Prevent buffer overflows, code injection | ✅ Implemented |
| **CSP** | Prevent XSS, code injection | ✅ Implemented |
| **Worker Isolation** | Contain parser bugs, prevent DoS | ✅ Implemented |
| **Plugin Sandboxing** | Prevent malicious plugins from accessing storage/network | ✅ Implemented |
| **Dependency Auditing** | Detect vulnerable dependencies | ✅ Implemented |
| **Network Policy** | Prevent unauthorized data exfiltration | ✅ Implemented |
| **Export Encryption** | Protect exported data | ✅ Implemented |
| **Secure Deletion** | Ensure data is removed when requested | ✅ Implemented |

### 14.3 Residual Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Browser vulnerability** | Low | Critical | Trust browser vendor, keep browser updated |
| **Malicious extension** | Medium | High | User responsibility to vet extensions |
| **Device compromise** | Low | Critical | User responsibility to secure device |
| **Supply chain attack** | Low | High | Dependency auditing, version pinning |
| **Zero-day in parser** | Low | Medium | Worker isolation limits impact |

### 14.4 Future Enhancements

| Enhancement | Priority | Timeframe |
|-------------|----------|-----------|
| **Security audit by third-party firm** | High | Before 1.0 release |
| **Automated fuzzing of EDF parser** | High | Q2 2026 |
| **Bug bounty program** | Medium | Post-1.0 |
| **Formal security certification** | Low | Long-term |
| **Hardware security module (HSM) integration** | Low | Not planned |

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
- [plugin-architecture.md](.github/skills/plugin-architecture/SKILL.md) — Plugin system design
- [data-analysis.md](data-analysis.md) — Analysis pipeline architecture

---

**End of Security Architecture Document**

**Last Updated**: 2026-02-10  
**Version**: 1.0  
**Authors**: Security Agent, with input from all implementation agents  
**Review Cadence**: Quarterly security audit, update after any security incident
