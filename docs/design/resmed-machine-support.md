# ResMed Machine Support & EDF Parsing Design

This document specifies the implementation of ResMed CPAP machine data import, EDF/EDF+ file parsing, and the machine plugin interface for the CPAP Analyzer. It serves as the authoritative technical design for the ResMed Specialist, Database, and Frontend agents.

**Last updated**: 2026-02-10

---

## 1. Overview

### 1.1 Scope

This design covers:
- EDF/EDF+ file format parsing (header, signals, annotations)
- ResMed-specific SD card data extraction
- Machine model identification and capability detection
- Channel mapping and standardization across machine variants
- Event parsing and clinical metric computation (AHI, leak rates, etc.)
- Session boundary detection and multi-session handling
- Data validation and quality assurance
- Machine plugin interface for extensibility to other manufacturers

### 1.2 Supported Machine Models

| Model Series | Therapy Mode | Specific Models | Status |
|-------------|--------------|-----------------|--------|
| AirSense 10 | CPAP | AutoSet, Elite, for Her | ✅ Primary |
| AirSense 10 | BiPAP | VPAP S, VPAP ST | ✅ Primary |
| AirSense 11 | CPAP | AutoSet, Elite, for Her | ✅ Primary |
| AirSense 11 | BiPAP | — | ✅ Primary |
| AirCurve 10 | BiPAP | VAuto, S, ST, ST-A | ✅ Primary |
| AirCurve 10 | ASV | ASV, ASVAuto | ✅ Advanced |

### 1.3 Design Principles

1. **Robustness**: Parse malformed files gracefully; log errors but continue with valid data.
2. **Modularity**: Separate EDF parsing (generic) from ResMed-specific interpretation.
3. **Extensibility**: Machine plugin interface must support future manufacturers (Philips Respironics, Fisher & Paykel, etc.).
4. **Performance**: Stream-parse large files; use Web Workers to avoid blocking the UI.
5. **Validation**: Strict header validation; physiological range checking for signals; session continuity verification.
6. **Privacy**: All processing happens client-side; no data transmission.

---

## 2. EDF/EDF+ File Format

### 2.1 EDF Format Structure

EDF (European Data Format) is a simple, robust format for time-series biomedical data. It consists of a fixed-length header followed by data records.

#### 2.1.1 Header Structure

The EDF header is fixed at **256 bytes + (256 × number of signals) bytes**.

**Fixed Header (256 bytes)**:
| Offset | Length | Field | Notes |
|--------|--------|-------|-------|
| 0 | 8 | Version | `"0       "` (ASCII, space-padded) |
| 8 | 80 | Local Patient Identification | ResMed uses: `"[serial] [model]"` |
| 88 | 80 | Local Recording Identification | Firmware version, session ID |
| 168 | 8 | Start Date | `"dd.mm.yy"` format |
| 176 | 8 | Start Time | `"hh.mm.ss"` format (24-hour) |
| 184 | 8 | Header Byte Count | ASCII integer, = 256 + (256 × ns) |
| 192 | 44 | Reserved | `"EDF+C"` for continuous, `"EDF+D"` for discontinuous |
| 236 | 8 | Number of Data Records | ASCII integer, `-1` if unknown |
| 244 | 8 | Duration of Data Record | ASCII integer (seconds), typically 1–30 |
| 252 | 4 | Number of Signals | ASCII integer |

**Per-Signal Header (256 bytes per signal)**:

Each field is repeated `ns` times (once per signal):
| Length | Field | Example |
|--------|-------|---------|
| 16 | Label | `"Flow           "` |
| 80 | Transducer Type | `"                "` (usually empty) |
| 8 | Physical Dimension | `"L/min  "` |
| 8 | Physical Minimum | `"-200   "` (ASCII number) |
| 8 | Physical Maximum | `"200    "` |
| 8 | Digital Minimum | `"-32768 "` (16-bit signed int min) |
| 8 | Digital Maximum | `"32767  "` |
| 80 | Prefiltering | `"HP:0.1Hz LP:30Hz"` (or empty) |
| 8 | Number of Samples per Record | `"25     "` (for 25 Hz with 1s records) |
| 32 | Reserved | (empty) |

#### 2.1.2 Data Records

Data records follow the header. Each record is a fixed-duration time slice (typically 1–30 seconds).

**Structure**:
- Record contains samples for all signals, concatenated in signal order.
- Each signal contributes `nr` samples (specified in header) as 16-bit signed integers (little-endian).
- Total record size (bytes): `Σ(nr_i × 2)` for all signals `i`.

**Conversion to Physical Units**:
```
physical_value = (digital_value - digital_min) / (digital_max - digital_min) 
                 × (physical_max - physical_min) + physical_min
```

**Example**: Flow signal with:
- Physical range: [-200, 200] L/min
- Digital range: [-32768, 32767]
- Digital value: 16384
- Physical value: `(16384 - (-32768)) / (32767 - (-32768)) × (200 - (-200)) + (-200)` = `100 L/min`

#### 2.1.3 EDF+ Annotations

EDF+ extends EDF with an **annotations signal** (also called TAL: Time-stamped Annotations List).

**Annotations Signal Header**:
- Label: `"EDF Annotations"` (exact match, case-sensitive)
- Physical Dimension: empty
- Digital Min/Max: `-32768` / `32767` (unused)
- Samples per Record: typically `60` (enough for text annotations)

**Annotation Format** (within data record):
Each annotation is a text string:
```
+<onset>\x15<duration>\x15<annotation1>\x14<annotation2>\x14...\x00
```
- `<onset>`: Seconds from recording start (ASCII float, e.g., `"+123.456"`)
- `<duration>`: Duration in seconds (ASCII float, e.g., `"10.25"`, or empty for instantaneous events)
- `<annotation>`: Event label text (e.g., `"Obstructive Apnea"`)
- `\x15`: Field separator (ASCII 21)
- `\x14`: Annotation separator (ASCII 20)
- `\x00`: Null terminator

**Example Annotation**:
```
+1234.5\x1510.0\x15Obstructive Apnea\x14Pressure=9.2\x00
```
Represents an obstructive apnea event starting at 1234.5 seconds, lasting 10.0 seconds, with associated pressure metadata.

### 2.2 ResMed-Specific Conventions

#### 2.2.1 File Organization

ResMed machines write multiple EDF files per night, organized by data type:

| File | Content | Update Frequency |
|------|---------|------------------|
| `STR.edf` | Summary statistics, device settings | End of session |
| `BRP.edf` | Breathing parameters (Flow, MaskPress, Leak, etc.) | Continuous |
| `EVE.edf` | Event markers (apneas, hypopneas, flow limitation) | Per event |
| `SAD.edf` | SpO2 and pulse data (if oximeter attached) | Continuous |
| `CSL.edf` | Cough, sneeze, large leak events | Per event |
| `PLD.edf` | Plethysmography waveform (oximeter pulse) | Continuous |

**Import Strategy**: Parse all files for a given session date and merge by timestamp.

#### 2.2.2 Channel Label Mapping

ResMed uses specific label conventions. These must be normalized to standard internal names.

| ResMed Label | Standard Name | Unit | Sample Rate |
|-------------|---------------|------|-------------|
| `Flow` | `flow` | L/min | 25 Hz |
| `MaskPressure` | `maskPressure` | cmH₂O | 25 Hz |
| `Leak` | `leak` | L/min | 2 Hz |
| `Tidal Volume` | `tidalVolume` | mL | ~0.1 Hz |
| `Minute Vent` | `minuteVent` | L/min | ~0.1 Hz |
| `Resp. Rate` | `respRate` | breaths/min | ~0.1 Hz |
| `EPAP` | `epap` | cmH₂O | ~0.1 Hz |
| `IPAP` | `ipap` | cmH₂O | ~0.1 Hz |
| `SpO2` | `spo2` | % | 1 Hz |
| `Pulse` | `pulse` | bpm | 1 Hz |
| `Snore` | `snore` | — | 1 Hz |

**Label Parsing Rules**:
- Trim whitespace
- Case-insensitive comparison
- Handle common variations: `"MaskPressure"` vs `"Mask Pressure"` vs `"Pmask"`
- Reject unknown labels with a warning (log to console, but continue)

#### 2.2.3 Event Label Mapping

ResMed event annotations use specific text labels:

| ResMed Annotation | Standard EventType | AASM Classification |
|-------------------|-------------------|---------------------|
| `Obstructive Apnea` | `ObstructiveApnea` | OA |
| `Central Apnea` | `CentralApnea` | CA |
| `Mixed Apnea` | `MixedApnea` | MA |
| `Hypopnea` | `Hypopnea` | H |
| `Flow Limitation` | `FlowLimitation` | FLG (not scored in AHI) |
| `RERA` | `RERA` | RERA (scored per AASM 1B) |
| `Large Leak` | `LargeLeak` | — (not respiratory) |
| `Periodic Breathing` | `PeriodicBreathing` | — (pattern) |
| `Obstructive` | `ObstructiveApnea` | OA (older firmware) |
| `Central` | `CentralApnea` | CA (older firmware) |
| `Clear Airway` | `CentralApnea` | CA (alternate label) |
| `Vibratory Snore` | `Vibratory` | Snoring event |

**Parsing Rules**:
- Case-insensitive substring matching
- Prioritize exact matches, fall back to substring (e.g., `"Obstructive"` matches both `"Obstructive Apnea"` and `"Obstructive"`)
- Unknown event types logged as warnings; stored with `type: "Unknown"` for user review

#### 2.2.4 Machine Model Identification

Machine model is extracted from the **Local Patient Identification** field:

**Format**: `"[SerialNumber] [ModelName]"`

**Examples**:
- `"12345678 AirSense 10 AutoSet"`
- `"87654321 AirCurve 10 VAuto"`
- `"11223344 AirSense 11 Elite"`

**Parsing**:
1. Split on whitespace
2. First token: serial number (store as `machineId`)
3. Remaining tokens: model name (store as `machineModel`)
4. If model name contains `"AirSense 10"`: flag as AirSense 10 series
5. If model name contains `"AirSense 11"`: flag as AirSense 11 series
6. If model name contains `"AirCurve"`: flag as AirCurve series
7. Detect therapy mode:
   - `"CPAP"` / `"Elite"`: Fixed CPAP
   - `"AutoSet"` / `"Auto"`: Auto-adjusting CPAP
   - `"VPAP"` / `"VAuto"` / `"ST"`: BiPAP
   - `"ASV"`: Adaptive Servo-Ventilation

**Machine Capabilities**:
| Capability | AirSense 10 CPAP | AirSense 10 AutoSet | AirSense 10 VPAP | AirCurve ASV |
|-----------|------------------|---------------------|------------------|--------------|
| `hasAutoCPAP` | ❌ | ✅ | ❌ | ❌ |
| `hasBilevel` | ❌ | ❌ | ✅ | ✅ |
| `hasIPAPChannel` | ❌ | ❌ | ✅ | ✅ |
| `hasPressureSupport` | ❌ | ❌ | ✅ | ✅ |
| `hasServoControl` | ❌ | ❌ | ❌ | ✅ |
| `hasFlowLimitation` | ✅ | ✅ | ✅ | ✅ |

---

## 3. Parser Implementation

### 3.1 Architecture

**Components**:
1. **EDFParser**: Generic EDF/EDF+ parser (format-agnostic)
2. **ResMedInterpreter**: ResMed-specific channel/event mapping
3. **SessionBuilder**: Merges multiple files into sessions
4. **Validator**: Data quality checks and physiological range validation
5. **StorageWriter**: Converts parsed data to storage format

**Execution Context**: Web Workers (non-blocking)

### 3.2 EDFParser Class

**Responsibilities**:
- Read and validate EDF header
- Parse per-signal metadata
- Extract data records
- Convert digital values to physical values
- Parse EDF+ annotations

**Interface**:
```typescript
class EDFParser {
  /**
   * Parse an EDF/EDF+ file from an ArrayBuffer.
   * @param buffer - Raw file bytes
   * @returns Parsed EDF data structure
   * @throws EDFParseError on invalid format
   */
  parse(buffer: ArrayBuffer): EDFFile;
  
  /**
   * Validate EDF header without parsing full file.
   * @param buffer - Raw file bytes
   * @returns Validation result with errors/warnings
   */
  validate(buffer: ArrayBuffer): ValidationResult;
}

interface EDFFile {
  header: EDFHeader;
  signals: Signal[];
  annotations?: Annotation[];
  duration: number; // seconds
  startTime: Date;
}

interface EDFHeader {
  version: string;
  patientId: string;
  recordingId: string;
  startDate: Date;
  headerBytes: number;
  numDataRecords: number;
  dataRecordDuration: number; // seconds
  numSignals: number;
}

interface Signal {
  label: string;
  transducerType: string;
  physicalDimension: string;
  physicalMin: number;
  physicalMax: number;
  digitalMin: number;
  digitalMax: number;
  prefiltering: string;
  samplesPerRecord: number;
  sampleRate: number; // Hz (computed)
  samples: Float32Array; // All samples, converted to physical units
}

interface Annotation {
  onset: number; // seconds from recording start
  duration: number; // seconds (0 for instantaneous)
  labels: string[]; // Event labels
}
```

**Implementation Details**:

**Header Parsing**:
```typescript
parseHeader(buffer: ArrayBuffer): EDFHeader {
  const view = new DataView(buffer);
  const decoder = new TextDecoder('ascii');
  
  // Read fixed header fields
  const version = decoder.decode(buffer.slice(0, 8)).trim();
  if (version !== '0') {
    throw new EDFParseError('Invalid EDF version');
  }
  
  const patientId = decoder.decode(buffer.slice(8, 88)).trim();
  const recordingId = decoder.decode(buffer.slice(88, 168)).trim();
  
  // Parse date/time
  const dateStr = decoder.decode(buffer.slice(168, 176)).trim(); // dd.mm.yy
  const timeStr = decoder.decode(buffer.slice(176, 184)).trim(); // hh.mm.ss
  const startDate = this.parseEDFDateTime(dateStr, timeStr);
  
  // Parse numeric fields
  const headerBytes = parseInt(decoder.decode(buffer.slice(184, 192)).trim());
  const numDataRecords = parseInt(decoder.decode(buffer.slice(236, 244)).trim());
  const dataRecordDuration = parseFloat(decoder.decode(buffer.slice(244, 252)).trim());
  const numSignals = parseInt(decoder.decode(buffer.slice(252, 256)).trim());
  
  // Validate header size
  const expectedHeaderBytes = 256 + (256 * numSignals);
  if (headerBytes !== expectedHeaderBytes) {
    throw new EDFParseError(`Header size mismatch: expected ${expectedHeaderBytes}, got ${headerBytes}`);
  }
  
  return {
    version,
    patientId,
    recordingId,
    startDate,
    headerBytes,
    numDataRecords,
    dataRecordDuration,
    numSignals,
  };
}
```

**Date/Time Parsing**:
```typescript
parseEDFDateTime(dateStr: string, timeStr: string): Date {
  // dateStr: "dd.mm.yy" (2-digit year)
  // timeStr: "hh.mm.ss" (24-hour time)
  
  const [day, month, year] = dateStr.split('.').map(Number);
  const [hour, minute, second] = timeStr.split('.').map(Number);
  
  // Y2K pivot: 00-79 → 2000-2079, 80-99 → 1980-1999
  const fullYear = year < 80 ? 2000 + year : 1900 + year;
  
  return new Date(fullYear, month - 1, day, hour, minute, second);
}
```

**Signal Metadata Parsing**:
```typescript
parseSignalHeaders(buffer: ArrayBuffer, numSignals: number): SignalMetadata[] {
  const decoder = new TextDecoder('ascii');
  const signals: SignalMetadata[] = [];
  
  for (let i = 0; i < numSignals; i++) {
    const offset = 256 + (i * numSignals); // Each field spans all signals
    
    const label = decoder.decode(buffer.slice(256 + i * 16, 256 + (i + 1) * 16)).trim();
    const transducerType = decoder.decode(buffer.slice(256 + numSignals * 16 + i * 80, 256 + numSignals * 16 + (i + 1) * 80)).trim();
    const physicalDimension = decoder.decode(buffer.slice(256 + numSignals * 96 + i * 8, 256 + numSignals * 96 + (i + 1) * 8)).trim();
    // ... (continue for all fields)
    
    signals.push({ label, transducerType, physicalDimension, ... });
  }
  
  return signals;
}
```

**Data Record Parsing**:
```typescript
parseDataRecords(buffer: ArrayBuffer, header: EDFHeader, signals: SignalMetadata[]): Signal[] {
  const headerBytes = header.headerBytes;
  const numRecords = header.numDataRecords;
  const recordDuration = header.dataRecordDuration;
  
  // Pre-allocate sample arrays
  const signalData: Signal[] = signals.map(sig => ({
    ...sig,
    sampleRate: sig.samplesPerRecord / recordDuration,
    samples: new Float32Array(sig.samplesPerRecord * numRecords),
  }));
  
  let recordOffset = headerBytes;
  const samplesPerRecordTotal = signals.reduce((sum, sig) => sum + sig.samplesPerRecord, 0);
  const recordBytes = samplesPerRecordTotal * 2; // 16-bit samples
  
  for (let rec = 0; rec < numRecords; rec++) {
    let sampleOffset = 0;
    
    for (let sig = 0; sig < signals.length; sig++) {
      const metadata = signals[sig];
      const samplesInRecord = metadata.samplesPerRecord;
      
      for (let samp = 0; samp < samplesInRecord; samp++) {
        const byteOffset = recordOffset + ((sampleOffset + samp) * 2);
        const digitalValue = new DataView(buffer).getInt16(byteOffset, true); // Little-endian
        
        // Convert to physical value
        const physicalValue = this.digitalToPhysical(
          digitalValue,
          metadata.digitalMin,
          metadata.digitalMax,
          metadata.physicalMin,
          metadata.physicalMax
        );
        
        signalData[sig].samples[rec * samplesInRecord + samp] = physicalValue;
      }
      
      sampleOffset += samplesInRecord;
    }
    
    recordOffset += recordBytes;
  }
  
  return signalData;
}

digitalToPhysical(
  digital: number,
  digitalMin: number,
  digitalMax: number,
  physicalMin: number,
  physicalMax: number
): number {
  const scale = (physicalMax - physicalMin) / (digitalMax - digitalMin);
  return (digital - digitalMin) * scale + physicalMin;
}
```

**Annotation Parsing**:
```typescript
parseAnnotations(annotationSignal: Signal): Annotation[] {
  // Annotations are encoded as ASCII text in the samples
  const bytes = new Uint8Array(annotationSignal.samples.length);
  for (let i = 0; i < annotationSignal.samples.length; i++) {
    bytes[i] = Math.round(annotationSignal.samples[i]) & 0xFF;
  }
  
  const text = new TextDecoder('ascii').decode(bytes);
  const annotations: Annotation[] = [];
  
  // Split on null terminators
  const entries = text.split('\x00').filter(s => s.length > 0);
  
  for (const entry of entries) {
    const match = entry.match(/^([+-]\d+\.?\d*)\x15(\d*\.?\d*)\x15(.+)/);
    if (!match) continue;
    
    const onset = parseFloat(match[1]);
    const duration = match[2] ? parseFloat(match[2]) : 0;
    const labels = match[3].split('\x14').filter(s => s.length > 0);
    
    annotations.push({ onset, duration, labels });
  }
  
  return annotations;
}
```

### 3.3 ResMedInterpreter Class

**Responsibilities**:
- Map ResMed channel labels to standard names
- Map ResMed event labels to standard event types
- Extract machine model and capabilities
- Handle firmware version differences

**Interface**:
```typescript
class ResMedInterpreter {
  /**
   * Interpret a parsed EDF file as ResMed data.
   * @param edfFile - Parsed EDF file
   * @returns ResMed-specific interpretation
   */
  interpret(edfFile: EDFFile): ResMedSession;
  
  /**
   * Extract machine identification from EDF header.
   * @param patientId - EDF patient identification field
   * @returns Machine model and serial number
   */
  extractMachineInfo(patientId: string): MachineInfo;
  
  /**
   * Determine machine capabilities from model name.
   * @param model - Machine model name
   * @returns Capability flags
   */
  getMachineCapabilities(model: string): MachineCapabilities;
}

interface ResMedSession {
  machineInfo: MachineInfo;
  capabilities: MachineCapabilities;
  startTime: Date;
  duration: number; // seconds
  channels: StandardChannel[];
  events: StandardEvent[];
}

interface MachineInfo {
  serialNumber: string;
  model: string;
  series: 'AirSense 10' | 'AirSense 11' | 'AirCurve 10' | 'Unknown';
  firmwareVersion: string;
}

interface MachineCapabilities {
  hasAutoCPAP: boolean;
  hasBilevel: boolean;
  hasIPAPChannel: boolean;
  hasPressureSupport: boolean;
  hasServoControl: boolean;
  hasFlowLimitation: boolean;
}

interface StandardChannel {
  name: string; // Standardized name: "flow", "maskPressure", etc.
  unit: string;
  sampleRate: number;
  samples: Float32Array;
}

interface StandardEvent {
  type: EventType;
  timestamp: Date;
  duration: number; // seconds
  severity?: number; // 0-1 for flow limitation
  metadata: Record<string, unknown>; // Additional context
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
  | 'Vibratory';
```

**Implementation Details**:

**Channel Label Mapping**:
```typescript
private readonly CHANNEL_MAP: Record<string, string> = {
  'flow': 'flow',
  'maskpressure': 'maskPressure',
  'mask pressure': 'maskPressure',
  'pmask': 'maskPressure',
  'leak': 'leak',
  'tidal volume': 'tidalVolume',
  'minute vent': 'minuteVent',
  'resp. rate': 'respRate',
  'resp rate': 'respRate',
  'respiratory rate': 'respRate',
  'epap': 'epap',
  'ipap': 'ipap',
  'spo2': 'spo2',
  'pulse': 'pulse',
  'snore': 'snore',
};

mapChannelLabel(label: string): string | null {
  const normalized = label.toLowerCase().trim();
  return this.CHANNEL_MAP[normalized] || null;
}
```

**Event Label Mapping**:
```typescript
private readonly EVENT_MAP: Array<[RegExp, EventType]> = [
  [/obstructive apnea/i, 'ObstructiveApnea'],
  [/obstructive/i, 'ObstructiveApnea'],
  [/central apnea/i, 'CentralApnea'],
  [/central/i, 'CentralApnea'],
  [/clear airway/i, 'CentralApnea'],
  [/mixed apnea/i, 'MixedApnea'],
  [/hypopnea/i, 'Hypopnea'],
  [/flow limitation/i, 'FlowLimitation'],
  [/rera/i, 'RERA'],
  [/large leak/i, 'LargeLeak'],
  [/periodic breathing/i, 'PeriodicBreathing'],
  [/vibratory/i, 'Vibratory'],
];

mapEventLabel(label: string): EventType | null {
  for (const [pattern, type] of this.EVENT_MAP) {
    if (pattern.test(label)) {
      return type;
    }
  }
  return null;
}
```

**Machine Info Extraction**:
```typescript
extractMachineInfo(patientId: string): MachineInfo {
  // Format: "[SerialNumber] [ModelName]"
  const tokens = patientId.split(/\s+/);
  const serialNumber = tokens[0] || 'Unknown';
  const model = tokens.slice(1).join(' ') || 'Unknown';
  
  let series: MachineInfo['series'] = 'Unknown';
  if (/AirSense 10/i.test(model)) {
    series = 'AirSense 10';
  } else if (/AirSense 11/i.test(model)) {
    series = 'AirSense 11';
  } else if (/AirCurve/i.test(model)) {
    series = 'AirCurve 10';
  }
  
  return { serialNumber, model, series, firmwareVersion: 'Unknown' };
}

getMachineCapabilities(model: string): MachineCapabilities {
  const hasAutoCPAP = /AutoSet|Auto/i.test(model);
  const hasBilevel = /VPAP|VAuto|ST|ASV/i.test(model);
  const hasIPAPChannel = hasBilevel;
  const hasPressureSupport = hasBilevel;
  const hasServoControl = /ASV/i.test(model);
  const hasFlowLimitation = true; // All ResMed models track FLG
  
  return {
    hasAutoCPAP,
    hasBilevel,
    hasIPAPChannel,
    hasPressureSupport,
    hasServoControl,
    hasFlowLimitation,
  };
}
```

### 3.4 SessionBuilder Class

**Responsibilities**:
- Merge multiple EDF files (BRP, EVE, SAD, etc.) into a single session
- Detect session boundaries (when multiple sessions span the same night)
- Handle time alignment across files
- Compute session metadata (duration, usage time)

**Interface**:
```typescript
class SessionBuilder {
  /**
   * Build a session from multiple EDF files.
   * @param files - Array of parsed ResMed sessions (from different files)
   * @returns Merged session with aligned time-series data
   */
  buildSession(files: ResMedSession[]): MergedSession;
  
  /**
   * Detect session boundaries within a date range.
   * @param files - All EDF files for a date range
   * @returns Sessions grouped by continuous usage periods
   */
  detectSessionBoundaries(files: ResMedSession[]): MergedSession[];
}

interface MergedSession {
  machineInfo: MachineInfo;
  date: string; // YYYY-MM-DD (local date)
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  usageMinutes: number;
  channels: Map<string, StandardChannel>; // Name → channel data
  events: StandardEvent[];
  hasOximetry: boolean;
}
```

**Implementation Details**:

**Time Alignment**:
```typescript
buildSession(files: ResMedSession[]): MergedSession {
  if (files.length === 0) {
    throw new Error('Cannot build session from zero files');
  }
  
  // Determine session time range
  const startTimes = files.map(f => f.startTime);
  const startTime = new Date(Math.min(...startTimes.map(t => t.getTime())));
  const endTime = new Date(Math.max(...files.map(f => 
    f.startTime.getTime() + f.duration * 1000
  )));
  
  // Merge channels
  const channels = new Map<string, StandardChannel>();
  for (const file of files) {
    for (const channel of file.channels) {
      if (!channels.has(channel.name)) {
        channels.set(channel.name, channel);
      } else {
        // Merge overlapping channels (e.g., Flow from BRP.edf)
        // Use the channel with higher sample rate or later timestamp
        const existing = channels.get(channel.name)!;
        if (channel.sampleRate > existing.sampleRate) {
          channels.set(channel.name, channel);
        }
      }
    }
  }
  
  // Merge events (sorted by timestamp)
  const events = files.flatMap(f => f.events).sort((a, b) => 
    a.timestamp.getTime() - b.timestamp.getTime()
  );
  
  // Machine info (should be consistent across files)
  const machineInfo = files[0].machineInfo;
  
  return {
    machineInfo,
    date: this.formatDate(startTime),
    startTime,
    endTime,
    durationMinutes: (endTime.getTime() - startTime.getTime()) / 60000,
    usageMinutes: this.computeUsageMinutes(channels),
    channels,
    events,
    hasOximetry: channels.has('spo2'),
  };
}

computeUsageMinutes(channels: Map<string, StandardChannel>): number {
  // Usage time = duration where mask pressure > threshold (typically 2 cmH2O)
  const pressureChannel = channels.get('maskPressure');
  if (!pressureChannel) {
    return 0; // Fallback: can't determine without pressure data
  }
  
  const threshold = 2.0; // cmH2O
  let usageSamples = 0;
  for (let i = 0; i < pressureChannel.samples.length; i++) {
    if (pressureChannel.samples[i] > threshold) {
      usageSamples++;
    }
  }
  
  const usageSeconds = usageSamples / pressureChannel.sampleRate;
  return usageSeconds / 60;
}

formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

**Session Boundary Detection**:
```typescript
detectSessionBoundaries(files: ResMedSession[]): MergedSession[] {
  // Sort files by start time
  const sorted = [...files].sort((a, b) => 
    a.startTime.getTime() - b.startTime.getTime()
  );
  
  const sessions: MergedSession[] = [];
  let currentGroup: ResMedSession[] = [];
  
  for (const file of sorted) {
    if (currentGroup.length === 0) {
      currentGroup.push(file);
      continue;
    }
    
    const lastFile = currentGroup[currentGroup.length - 1];
    const gap = file.startTime.getTime() - 
      (lastFile.startTime.getTime() + lastFile.duration * 1000);
    
    // If gap > 30 minutes, start a new session
    if (gap > 30 * 60 * 1000) {
      sessions.push(this.buildSession(currentGroup));
      currentGroup = [file];
    } else {
      currentGroup.push(file);
    }
  }
  
  if (currentGroup.length > 0) {
    sessions.push(this.buildSession(currentGroup));
  }
  
  return sessions;
}
```

### 3.5 Validator Class

**Responsibilities**:
- Validate physiological ranges for all channels
- Detect data corruption or gaps
- Flag anomalous sessions (e.g., AHI > 200)
- Ensure AASM compliance for event durations

**Interface**:
```typescript
class Validator {
  /**
   * Validate a merged session.
   * @param session - Session to validate
   * @returns Validation result with errors and warnings
   */
  validate(session: MergedSession): ValidationResult;
}

interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

interface ValidationWarning {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}
```

**Implementation Details**:

**Physiological Range Validation**:
```typescript
private readonly PHYSIOLOGICAL_RANGES: Record<string, [number, number]> = {
  flow: [-300, 300], // L/min
  maskPressure: [0, 30], // cmH2O
  leak: [0, 200], // L/min
  tidalVolume: [0, 3000], // mL
  minuteVent: [0, 50], // L/min
  respRate: [0, 60], // breaths/min
  epap: [4, 25], // cmH2O
  ipap: [4, 30], // cmH2O
  spo2: [50, 100], // %
  pulse: [30, 250], // bpm
};

validate(session: MergedSession): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  
  // Validate channel ranges
  for (const [name, channel] of session.channels.entries()) {
    const range = this.PHYSIOLOGICAL_RANGES[name];
    if (!range) continue;
    
    const [min, max] = range;
    for (let i = 0; i < channel.samples.length; i++) {
      const value = channel.samples[i];
      if (value < min || value > max) {
        warnings.push({
          code: 'OUT_OF_RANGE',
          message: `${name} value ${value} out of physiological range [${min}, ${max}]`,
          context: { channel: name, value, sampleIndex: i },
        });
        break; // Only report first occurrence per channel
      }
    }
  }
  
  // Validate event durations (AASM requires ≥ 10 seconds for apnea)
  for (const event of session.events) {
    if (event.type.includes('Apnea') && event.duration < 10) {
      warnings.push({
        code: 'SHORT_APNEA',
        message: `Apnea event duration ${event.duration}s < 10s (AASM minimum)`,
        context: { event },
      });
    }
  }
  
  // Validate session duration (minimum 30 minutes)
  if (session.durationMinutes < 30) {
    warnings.push({
      code: 'SHORT_SESSION',
      message: `Session duration ${session.durationMinutes} min < 30 min minimum`,
      context: { duration: session.durationMinutes },
    });
  }
  
  // Validate AHI computation (if > 200, likely an error)
  const ahi = this.computeAHI(session);
  if (ahi > 200) {
    warnings.push({
      code: 'HIGH_AHI',
      message: `Computed AHI ${ahi} exceeds 200, possible data error`,
      context: { ahi },
    });
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

computeAHI(session: MergedSession): number {
  const apneaEvents = session.events.filter(e => 
    e.type === 'ObstructiveApnea' || 
    e.type === 'CentralApnea' || 
    e.type === 'MixedApnea' || 
    e.type === 'Hypopnea'
  ).length;
  
  const usageHours = session.usageMinutes / 60;
  return usageHours > 0 ? apneaEvents / usageHours : 0;
}
```

---

## 4. Clinical Metrics Computation

### 4.1 AHI (Apnea-Hypopnea Index)

**Definition**: Number of apnea and hypopnea events per hour of sleep (usage time).

**Formula**:
$$
\text{AHI} = \frac{\text{Apnea Events} + \text{Hypopnea Events}}{\text{Usage Hours}}
$$

**AASM Criteria** (American Academy of Sleep Medicine):
- **Apnea**: Complete or near-complete cessation of airflow ≥ 10 seconds
- **Hypopnea**: ≥ 30% reduction in airflow with ≥ 3% oxygen desaturation or arousal, lasting ≥ 10 seconds

**Component AHI**:
- **Obstructive AHI**: Obstructive apnea events only
- **Central AHI**: Central apnea events only
- **Mixed AHI**: Mixed apnea events (counted separately or added to obstructive)
- **Hypopnea AHI**: Hypopnea events only

**Severity Classification**:
| AHI Range | Severity |
|-----------|----------|
| < 5 | Normal |
| 5–14.9 | Mild |
| 15–29.9 | Moderate |
| ≥ 30 | Severe |

**Implementation**:
```typescript
interface AHIResult {
  total: number;
  obstructive: number;
  central: number;
  mixed: number;
  hypopnea: number;
  severity: 'Normal' | 'Mild' | 'Moderate' | 'Severe';
}

computeAHI(session: MergedSession): AHIResult {
  const usageHours = session.usageMinutes / 60;
  
  const obstructiveCount = session.events.filter(e => e.type === 'ObstructiveApnea').length;
  const centralCount = session.events.filter(e => e.type === 'CentralApnea').length;
  const mixedCount = session.events.filter(e => e.type === 'MixedApnea').length;
  const hypopneaCount = session.events.filter(e => e.type === 'Hypopnea').length;
  
  const obstructive = obstructiveCount / usageHours;
  const central = centralCount / usageHours;
  const mixed = mixedCount / usageHours;
  const hypopnea = hypopneaCount / usageHours;
  const total = obstructive + central + mixed + hypopnea;
  
  let severity: AHIResult['severity'] = 'Normal';
  if (total >= 30) severity = 'Severe';
  else if (total >= 15) severity = 'Moderate';
  else if (total >= 5) severity = 'Mild';
  
  return { total, obstructive, central, mixed, hypopnea, severity };
}
```

### 4.2 Leak Rate Metrics

**Leak Types**:
1. **Intentional Leak**: Designed vent holes in the mask (constant, ~20–30 L/min)
2. **Unintentional Leak**: Mask fit issues (variable, reduces therapy effectiveness)

ResMed reports **total leak**, which includes both. High unintentional leak (total leak > 24 L/min) triggers "Large Leak" events.

**Metrics**:
- **Median Leak**: 50th percentile of leak rate
- **95th Percentile Leak**: Near-peak leak
- **Leak Duration**: Time with leak > 24 L/min (large leak threshold)

**Implementation**:
```typescript
interface LeakMetrics {
  median: number; // L/min
  p95: number; // L/min
  max: number; // L/min
  largLeakDurationMinutes: number;
}

computeLeakMetrics(session: MergedSession): LeakMetrics {
  const leakChannel = session.channels.get('leak');
  if (!leakChannel) {
    return { median: 0, p95: 0, max: 0, largLeakDurationMinutes: 0 };
  }
  
  const samples = Array.from(leakChannel.samples).sort((a, b) => a - b);
  const median = this.percentile(samples, 50);
  const p95 = this.percentile(samples, 95);
  const max = Math.max(...samples);
  
  // Count samples > 24 L/min
  const largeLeakSamples = leakChannel.samples.filter(v => v > 24).length;
  const largeLeakDurationMinutes = (largeLeakSamples / leakChannel.sampleRate) / 60;
  
  return { median, p95, max, largLeakDurationMinutes };
}

percentile(sortedArray: number[], p: number): number {
  const index = (p / 100) * (sortedArray.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
}
```

### 4.3 Pressure Metrics

**Metrics**:
- **Mean Pressure**: Average delivered pressure
- **Median EPAP**: Median expiratory pressure
- **Median IPAP**: Median inspiratory pressure (BiPAP only)
- **Pressure Support**: IPAP − EPAP (BiPAP only)
- **95th Percentile Pressure**: Near-peak pressure (for auto-adjusting machines)
- **Max Pressure**: Maximum delivered pressure

**Implementation**:
```typescript
interface PressureMetrics {
  mean: number;
  median: number;
  p95: number;
  max: number;
  epapMedian: number | null;
  ipapMedian: number | null;
  pressureSupport: number | null;
}

computePressureMetrics(session: MergedSession): PressureMetrics {
  const pressureChannel = session.channels.get('maskPressure');
  if (!pressureChannel) {
    throw new Error('Pressure channel not found');
  }
  
  const samples = Array.from(pressureChannel.samples);
  const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  const sorted = samples.sort((a, b) => a - b);
  const median = this.percentile(sorted, 50);
  const p95 = this.percentile(sorted, 95);
  const max = Math.max(...samples);
  
  // EPAP and IPAP (BiPAP only)
  const epapChannel = session.channels.get('epap');
  const ipapChannel = session.channels.get('ipap');
  
  const epapMedian = epapChannel ? this.percentile(Array.from(epapChannel.samples).sort((a, b) => a - b), 50) : null;
  const ipapMedian = ipapChannel ? this.percentile(Array.from(ipapChannel.samples).sort((a, b) => a - b), 50) : null;
  
  const pressureSupport = (epapMedian !== null && ipapMedian !== null) 
    ? ipapMedian - epapMedian 
    : null;
  
  return { mean, median, p95, max, epapMedian, ipapMedian, pressureSupport };
}
```

### 4.4 Respiratory Metrics

**Metrics**:
- **Tidal Volume**: Volume of air per breath (mL)
- **Minute Ventilation**: Total volume per minute (L/min)
- **Respiratory Rate**: Breaths per minute

These are computed by the machine and stored as low-frequency channels (~0.1 Hz, updated per breath).

**Implementation**:
```typescript
interface RespiratoryMetrics {
  tidalVolumeMean: number | null; // mL
  minuteVentMean: number | null; // L/min
  respRateMean: number | null; // breaths/min
}

computeRespiratoryMetrics(session: MergedSession): RespiratoryMetrics {
  const tvChannel = session.channels.get('tidalVolume');
  const mvChannel = session.channels.get('minuteVent');
  const rrChannel = session.channels.get('respRate');
  
  const tidalVolumeMean = tvChannel ? this.mean(tvChannel.samples) : null;
  const minuteVentMean = mvChannel ? this.mean(mvChannel.samples) : null;
  const respRateMean = rrChannel ? this.mean(rrChannel.samples) : null;
  
  return { tidalVolumeMean, minuteVentMean, respRateMean };
}

mean(samples: Float32Array): number {
  return samples.reduce((sum, v) => sum + v, 0) / samples.length;
}
```

---

## 5. Session Detection & Validation

### 5.1 Session Boundary Detection

**Criteria**:
- A "session" is a continuous period of usage without gaps > 30 minutes.
- A "night" may contain multiple sessions (e.g., user removed mask for bathroom break exceeding 30 minutes).
- Sessions spanning midnight are assigned to the date of the majority of the usage.

**Implementation**:
```typescript
detectSessionBoundaries(files: ResMedSession[]): MergedSession[] {
  // (Already implemented in SessionBuilder, see section 3.4)
}
```

### 5.2 Multi-Session Nights

**Handling**:
- Store each session separately in the `sessions` table.
- Aggregate metrics across all sessions for a given date in the `nightly_aggregates` table.
- In visualizations, allow users to toggle between "per-session" and "per-night" views.

**Implementation**:
```typescript
aggregateNightlySessions(sessions: MergedSession[]): NightlyAggregate {
  const date = sessions[0].date;
  const machineId = sessions[0].machineInfo.serialNumber;
  
  // Sum event counts
  const allEvents = sessions.flatMap(s => s.events);
  const totalUsageMinutes = sessions.reduce((sum, s) => sum + s.usageMinutes, 0);
  
  const ahi = this.computeAHI({ ...sessions[0], events: allEvents, usageMinutes: totalUsageMinutes });
  // ... (compute other aggregates)
  
  return {
    date,
    machineId,
    ahi: ahi.total,
    usageHours: totalUsageMinutes / 60,
    // ... (other fields)
  };
}
```

### 5.3 Data Gaps

**Detection**:
- Check for gaps in timestamps within a session.
- If gap > data record duration (typically 1–30 seconds), flag as a data gap.

**Handling**:
- Store gap information in session metadata.
- Interpolate or mark as missing in visualizations.
- Do not include gap time in AHI computation (usage time excludes gaps).

**Implementation**:
```typescript
detectGaps(channel: StandardChannel, recordDuration: number): Gap[] {
  const gaps: Gap[] = [];
  const samples = channel.samples;
  const sampleRate = channel.sampleRate;
  const expectedDelta = 1 / sampleRate;
  
  for (let i = 1; i < samples.length; i++) {
    const timeDelta = i / sampleRate;
    const expectedTime = i * expectedDelta;
    const gap = Math.abs(timeDelta - expectedTime);
    
    if (gap > recordDuration * 2) {
      gaps.push({
        startSample: i - 1,
        endSample: i,
        durationSeconds: gap,
      });
    }
  }
  
  return gaps;
}

interface Gap {
  startSample: number;
  endSample: number;
  durationSeconds: number;
}
```

---

## 6. Machine Plugin Interface

### 6.1 Plugin Architecture

The machine plugin interface enables support for multiple CPAP manufacturers. Each manufacturer implements the `MachinePlugin` interface.

**Interface**:
```typescript
interface MachinePlugin {
  /**
   * Plugin metadata.
   */
  readonly metadata: PluginMetadata;
  
  /**
   * Detect if a file or directory belongs to this machine type.
   * @param files - Array of file metadata (name, size, etc.)
   * @returns True if this plugin can handle the files
   */
  detect(files: FileMetadata[]): boolean;
  
  /**
   * Parse files from the machine's SD card.
   * @param files - Array of file contents (ArrayBuffer)
   * @returns Parsed sessions
   */
  parse(files: File[]): Promise<MergedSession[]>;
  
  /**
   * Get machine-specific capabilities.
   * @param model - Machine model name
   * @returns Capability flags
   */
  getCapabilities(model: string): MachineCapabilities;
}

interface PluginMetadata {
  name: string; // "ResMed"
  version: string; // "1.0.0"
  manufacturer: string; // "ResMed Corp."
  supportedModels: string[]; // ["AirSense 10", "AirSense 11", ...]
}

interface FileMetadata {
  name: string;
  size: number;
  lastModified: Date;
}
```

### 6.2 ResMed Plugin Implementation

**Structure**:
```typescript
class ResMedPlugin implements MachinePlugin {
  readonly metadata: PluginMetadata = {
    name: 'ResMed',
    version: '1.0.0',
    manufacturer: 'ResMed Corp.',
    supportedModels: [
      'AirSense 10 AutoSet',
      'AirSense 10 Elite',
      'AirSense 10 for Her',
      'AirSense 10 VPAP S',
      'AirSense 10 VPAP ST',
      'AirSense 11 AutoSet',
      'AirSense 11 Elite',
      'AirCurve 10 VAuto',
      'AirCurve 10 S',
      'AirCurve 10 ST',
      'AirCurve 10 ST-A',
      'AirCurve 10 ASV',
      'AirCurve 10 ASVAuto',
    ],
  };
  
  detect(files: FileMetadata[]): boolean {
    // ResMed SD cards have a DATALOG directory with specific EDF files
    const hasDatalog = files.some(f => f.name.includes('DATALOG'));
    const hasResMedFiles = files.some(f => 
      /STR\.edf|BRP\.edf|EVE\.edf/i.test(f.name)
    );
    return hasDatalog || hasResMedFiles;
  }
  
  async parse(files: File[]): Promise<MergedSession[]> {
    // Parse all EDF files
    const parser = new EDFParser();
    const interpreter = new ResMedInterpreter();
    const builder = new SessionBuilder();
    
    const edfFiles = files.filter(f => f.name.endsWith('.edf'));
    const parsed: ResMedSession[] = [];
    
    for (const file of edfFiles) {
      const buffer = await file.arrayBuffer();
      try {
        const edfFile = parser.parse(buffer);
        const session = interpreter.interpret(edfFile);
        parsed.push(session);
      } catch (error) {
        console.error(`Failed to parse ${file.name}:`, error);
      }
    }
    
    // Merge into sessions
    return builder.detectSessionBoundaries(parsed);
  }
  
  getCapabilities(model: string): MachineCapabilities {
    return new ResMedInterpreter().getMachineCapabilities(model);
  }
}
```

### 6.3 Plugin Registry

**Interface**:
```typescript
class PluginRegistry {
  private plugins: MachinePlugin[] = [];
  
  register(plugin: MachinePlugin): void {
    this.plugins.push(plugin);
  }
  
  detectPlugin(files: FileMetadata[]): MachinePlugin | null {
    for (const plugin of this.plugins) {
      if (plugin.detect(files)) {
        return plugin;
      }
    }
    return null;
  }
  
  getAllPlugins(): MachinePlugin[] {
    return this.plugins;
  }
}

// Global registry
const pluginRegistry = new PluginRegistry();
pluginRegistry.register(new ResMedPlugin());
// Future: pluginRegistry.register(new PhilipsPlugin());
```

---

## 7. Processing Pipeline

### 7.1 End-to-End Flow

```
┌─────────────────────────┐
│ User: Select SD Card    │
│ (File System Access API │
│  or File Input)         │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Scan Directory          │
│ - Enumerate files       │
│ - Detect machine type   │
│ - Estimate import size  │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ User Confirmation       │
│ - Show date range       │
│ - Show estimated size   │
│ - Show sessions count   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Web Worker: Parse Files │
│ - EDFParser             │
│ - ResMedInterpreter     │
│ - SessionBuilder        │
│ - Validator             │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Compute Metrics         │
│ - AHI                   │
│ - Leak rates            │
│ - Pressure stats        │
│ - Respiratory stats     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Storage Writer          │
│ - Chunk signals (OPFS)  │
│ - Write metadata (IDB)  │
│ - Write aggregates (IDB)│
│ - Update import history │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Dashboard Redirect      │
│ - Show newly imported   │
│   sessions              │
│ - Display summary stats │
└─────────────────────────┘
```

### 7.2 Web Worker Implementation

**Worker Script** (`edf-parser.worker.ts`):
```typescript
import { EDFParser, ResMedInterpreter, SessionBuilder, Validator } from './parsers';
import { StorageWriter } from './storage';

self.addEventListener('message', async (event) => {
  const { type, files } = event.data;
  
  if (type === 'PARSE_FILES') {
    try {
      const parser = new EDFParser();
      const interpreter = new ResMedInterpreter();
      const builder = new SessionBuilder();
      const validator = new Validator();
      const writer = new StorageWriter();
      
      const parsed: ResMedSession[] = [];
      let progress = 0;
      
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const edfFile = parser.parse(buffer);
        const session = interpreter.interpret(edfFile);
        parsed.push(session);
        
        progress++;
        self.postMessage({ type: 'PROGRESS', progress, total: files.length });
      }
      
      const sessions = builder.detectSessionBoundaries(parsed);
      
      for (const session of sessions) {
        const validation = validator.validate(session);
        if (validation.warnings.length > 0) {
          self.postMessage({ type: 'WARNINGS', warnings: validation.warnings });
        }
        
        await writer.writeSession(session);
      }
      
      self.postMessage({ type: 'COMPLETE', sessions });
    } catch (error) {
      self.postMessage({ type: 'ERROR', error: error.message });
    }
  }
});
```

**Main Thread**:
```typescript
const worker = new Worker(new URL('./edf-parser.worker.ts', import.meta.url), { type: 'module' });

worker.addEventListener('message', (event) => {
  const { type, progress, total, warnings, sessions, error } = event.data;
  
  switch (type) {
    case 'PROGRESS':
      updateProgressBar(progress, total);
      break;
    case 'WARNINGS':
      displayWarnings(warnings);
      break;
    case 'COMPLETE':
      navigateToDashboard(sessions);
      break;
    case 'ERROR':
      displayError(error);
      break;
  }
});

worker.postMessage({ type: 'PARSE_FILES', files: selectedFiles });
```

### 7.3 Incremental Import

**Strategy**:
- Track last imported session date per machine in `import_history` table.
- On subsequent imports, scan SD card for sessions after that date.
- Use source file hash (SHA-256) to detect duplicate imports.

**Implementation**:
```typescript
async function incrementalImport(files: File[], machineId: string): Promise<MergedSession[]> {
  const history = await getImportHistory(machineId);
  const lastImportDate = history ? new Date(history.dateRangeEnd) : null;
  
  // Filter files modified after last import
  const newFiles = files.filter(file => {
    if (!lastImportDate) return true;
    return file.lastModified > lastImportDate.getTime();
  });
  
  if (newFiles.length === 0) {
    console.log('No new files to import');
    return [];
  }
  
  // Parse new files
  const parser = new EDFParser();
  const interpreter = new ResMedInterpreter();
  const builder = new SessionBuilder();
  
  const parsed: ResMedSession[] = [];
  for (const file of newFiles) {
    const buffer = await file.arrayBuffer();
    const hash = await sha256(buffer);
    
    // Check if already imported
    if (await isAlreadyImported(hash)) {
      console.log(`Skipping duplicate file: ${file.name}`);
      continue;
    }
    
    const edfFile = parser.parse(buffer);
    const session = interpreter.interpret(edfFile);
    parsed.push(session);
  }
  
  return builder.detectSessionBoundaries(parsed);
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function isAlreadyImported(hash: string): Promise<boolean> {
  const db = await openDatabase();
  const tx = db.transaction('sessions', 'readonly');
  const store = tx.objectStore('sessions');
  const index = store.index('sourceHash');
  const result = await index.get(hash);
  return result !== undefined;
}
```

---

## 8. Error Handling & Edge Cases

### 8.1 Malformed EDF Files

**Scenarios**:
- Truncated files (incomplete data records)
- Invalid header fields (non-numeric where numeric expected)
- Corrupt data (random bytes due to SD card error)

**Handling**:
- Validate header before parsing data records.
- Catch exceptions during parsing; log error and skip file.
- Partial data: If N records are valid but record N+1 is corrupt, accept records 1..N.

### 8.2 Missing Channels

**Scenarios**:
- Older firmware versions may not record certain channels (e.g., tidal volume).
- Non-bilevel machines do not have IPAP channel.

**Handling**:
- Store `null` for missing channels in nightly aggregates.
- In visualizations, hide unavailable metrics.
- Document which models/firmware versions have which channels.

### 8.3 Firmware Version Differences

**Known Issues**:
- AirSense 10 firmware < 3.0 uses different event labels.
- AirSense 11 has enhanced event detection (more sensitive flow limitation).

**Handling**:
- Extract firmware version from EDF `Local Recording Identification` field.
- Apply version-specific parsing rules in `ResMedInterpreter`.
- Document firmware-specific quirks in code comments.

### 8.4 Time Zone Handling

**Issue**: EDF timestamps are local time (no time zone info). If user travels across time zones, timestamps may be ambiguous.

**Handling**:
- Store timestamps as recorded (local time).
- Allow user to manually adjust time zone for specific sessions (future feature).
- For analysis, assume all sessions are in the user's current time zone.

---

## 9. Testing Strategy

### 9.1 Unit Tests (Vitest)

**Coverage**:
- EDF header parsing (valid and invalid headers)
- Digital-to-physical conversion
- Annotation parsing
- Channel label mapping
- Event label mapping
- Machine model identification
- AHI computation
- Leak metrics computation
- Physiological range validation

**Example Test**:
```typescript
import { describe, it, expect } from 'vitest';
import { EDFParser } from './edf-parser';

describe('EDFParser', () => {
  it('should parse a valid EDF header', () => {
    const buffer = createMockEDFBuffer(); // Utility to create test data
    const parser = new EDFParser();
    const header = parser.parseHeader(buffer);
    
    expect(header.version).toBe('0');
    expect(header.numSignals).toBe(10);
  });
  
  it('should reject an invalid EDF version', () => {
    const buffer = createInvalidEDFBuffer();
    const parser = new EDFParser();
    
    expect(() => parser.parseHeader(buffer)).toThrow('Invalid EDF version');
  });
});
```

### 9.2 Integration Tests

**Coverage**:
- End-to-end parsing of real ResMed EDF files (anonymized samples)
- Multi-file session merging
- Incremental import (detect new files, skip duplicates)
- Storage round-trip (parse → store → retrieve → validate)

**Example Test**:
```typescript
import { describe, it, expect } from 'vitest';
import { ResMedPlugin } from './resmed-plugin';

describe('ResMedPlugin Integration', () => {
  it('should parse a complete session from multiple EDF files', async () => {
    const files = [
      await loadTestFile('BRP.edf'),
      await loadTestFile('EVE.edf'),
      await loadTestFile('SAD.edf'),
    ];
    
    const plugin = new ResMedPlugin();
    const sessions = await plugin.parse(files);
    
    expect(sessions).toHaveLength(1);
    expect(sessions[0].channels.size).toBeGreaterThan(0);
    expect(sessions[0].events.length).toBeGreaterThan(0);
  });
});
```

### 9.3 E2E Tests (Playwright)

**Coverage**:
- User imports SD card data via file picker
- Progress indicator displays during import
- Warnings are shown for anomalous data
- Dashboard displays imported sessions

**Example Test**:
```typescript
import { test, expect } from '@playwright/test';

test('import ResMed SD card data', async ({ page }) => {
  await page.goto('/import');
  
  // Simulate file selection
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles([
    './test-data/DATALOG/BRP.edf',
    './test-data/DATALOG/EVE.edf',
  ]);
  
  // Wait for import to complete
  await expect(page.locator('.progress-bar')).toHaveAttribute('aria-valuenow', '100');
  
  // Verify redirect to dashboard
  await expect(page).toHaveURL('/dashboard');
  
  // Verify session appears in UI
  await expect(page.locator('.session-card')).toBeVisible();
});
```

---

## 10. Performance Considerations

### 10.1 Large File Handling

**Challenge**: A single night's EDF data can be 6–10 MB. Parsing all files for a year (365 nights) is ~2–3 GB.

**Optimizations**:
- Stream-parse files in chunks (avoid loading entire file into memory).
- Use Web Workers (parallel parsing on multi-core CPUs).
- Parse and store incrementally (write to OPFS after each session).
- Chunked storage in OPFS (5-minute chunks, ~500 KB each).

### 10.2 Memory Management

**Challenge**: Holding 10 years of data (22 GB) in memory is infeasible.

**Strategy**:
- Only load metadata into memory (IndexedDB, ~6 MB for 10 years).
- Stream signal data from OPFS on-demand (virtualized time-series viewer).
- Cache recently accessed chunks in memory (LRU cache, max 50 MB).

### 10.3 Import Time Estimation

**Benchmarks** (on mid-range laptop, 2022 M1 MacBook Air):
- Parse single EDF file (6 MB, 8 hours of data): ~500 ms
- Merge 3 files into session: ~200 ms
- Write session to storage: ~1 second (including chunking)
- **Total per night**: ~2 seconds
- **1 year import**: ~12 minutes
- **10 year import**: ~2 hours

**User Experience**:
- Show estimated time remaining based on files remaining.
- Allow import to run in background (Service Worker, if supported).
- Provide "pause/resume" controls for long imports.

---

## 11. Future Enhancements

### 11.1 Additional Manufacturer Support

- **Philips Respironics** (DreamStation, System One): Different EDF conventions, proprietary summary files
- **Fisher & Paykel** (SleepStyle): Proprietary XML format
- **Löwenstein Medical** (prisma): Different directory structure
- **DeVilbiss** (IntelliPAP): CSV export format

Each requires a new `MachinePlugin` implementation.

### 11.2 Real-Time Data Sync

For newer machines with Wi-Fi/Bluetooth:
- ResMed myAir API (OAuth integration)
- Philips DreamMapper API
- Continuous background sync (Service Worker)
- Conflict resolution (local vs. cloud data)

### 11.3 Advanced Event Detection

- **Breath-by-breath analysis**: Segment flow signal into individual breaths
- **Custom event scoring**: User-defined event criteria (e.g., stricter hypopnea threshold)
- **Machine learning**: Train model to detect events not flagged by machine

### 11.4 Multi-Machine Support

For users with multiple machines (e.g., home + travel CPAP):
- Unified dashboard across machines
- Machine comparison view
- Automatic machine detection (by serial number)

---

## 12. Appendix

### 12.1 References

- [EDF/EDF+ Specification](https://www.edfplus.info/specs/edf.html)
- [AASM Scoring Manual](https://aasm.org/clinical-resources/scoring-manual/)
- ResMed AirSense 10 Clinician's Manual
- ResMed AirSense 11 Clinician's Manual

### 12.2 Glossary

| Term | Definition |
|------|------------|
| **AHI** | Apnea-Hypopnea Index: respiratory events per hour |
| **CPAP** | Continuous Positive Airway Pressure: fixed pressure therapy |
| **APAP** | Auto-adjusting PAP: pressure varies based on need |
| **BiPAP** | Bilevel PAP: different inspiratory and expiratory pressures |
| **EPAP** | Expiratory Positive Airway Pressure |
| **IPAP** | Inspiratory Positive Airway Pressure |
| **FLG** | Flow Limitation Grade: 0–1 severity of inspiratory flow limitation |
| **RERA** | Respiratory Effort-Related Arousal: increased effort without apnea |
| **AASM** | American Academy of Sleep Medicine: clinical standards body |

### 12.3 SD Card Directory Examples

**AirSense 10**:
```
DATALOG/
├── Identification.tgt
├── STR.edf
└── 20260209/
    ├── 20260209_094523_BRP.edf
    ├── 20260209_094523_EVE.edf
    └── 20260209_094523_STR.edf
```

**AirSense 11**:
```
DATALOG/
├── Settings.json
├── Logs/
│   └── SessionLog_20260209.edf
└── Data/
    ├── Flow_20260209.edf
    ├── Pressure_20260209.edf
    └── Events_20260209.edf
```

(Note: AirSense 11 structure may vary by firmware version; requires validation with actual devices.)

---

**End of Document**
