/**
 * EDF/EDF+ binary file parser.
 *
 * Parses European Data Format (EDF) and EDF+ files from raw `ArrayBuffer` data.
 * Handles the fixed 256-byte header, per-signal headers, interleaved data records
 * with 16-bit little-endian signed integers, and EDF+ TAL annotations.
 *
 * @see https://www.edfplus.info/specs/edf.html
 * @see https://www.edfplus.info/specs/edfplus.html
 */

import { EDFParseError } from './errors';
import type { EDFAnnotation, EDFFile, EDFHeader, EDFSignal } from './types';

/** Result of EDF header validation. */
export interface ValidationResult {
  /** Whether the file is structurally valid. */
  readonly isValid: boolean;
  /** Hard errors that prevent parsing. */
  readonly errors: readonly ValidationIssue[];
  /** Soft warnings that do not prevent parsing. */
  readonly warnings: readonly ValidationIssue[];
}

/** A single validation issue (error or warning). */
export interface ValidationIssue {
  /** Machine-readable issue code. */
  readonly code: string;
  /** Human-readable description. */
  readonly message: string;
  /** Optional additional context. */
  readonly context?: Record<string, string | number | boolean>;
}

/** Minimum buffer size: the fixed 256-byte header. */
const MIN_HEADER_BYTES = 256;

/** EDF+ annotation signal label. */
const ANNOTATION_LABEL = 'EDF Annotations';

/** ASCII field separator in TAL annotations (0x15). */
const TAL_FIELD_SEP = '\x15';

/** ASCII annotation separator in TAL annotations (0x14). */
const TAL_ANNOTATION_SEP = '\x14';

/**
 * Parser for EDF and EDF+ binary files.
 *
 * Usage:
 * ```ts
 * const parser = new EDFParser();
 * const edf = parser.parse(buffer);
 * ```
 */
export class EDFParser {
  private readonly decoder = new TextDecoder('ascii');

  /**
   * Parse an EDF/EDF+ file from a raw ArrayBuffer.
   *
   * @param buffer - Raw file bytes.
   * @returns Parsed EDF file structure with all signals converted to physical units.
   * @throws {@link EDFParseError} on invalid or corrupted EDF data.
   */
  parse(buffer: ArrayBuffer): EDFFile {
    if (buffer.byteLength < MIN_HEADER_BYTES) {
      throw new EDFParseError(
        'HEADER_TOO_SHORT',
        `Buffer too short for EDF header: ${buffer.byteLength} bytes (need ≥ ${MIN_HEADER_BYTES})`,
        { bufferSize: buffer.byteLength },
      );
    }

    let header = this.parseHeader(buffer);

    if (buffer.byteLength < header.headerBytes) {
      throw new EDFParseError(
        'HEADER_TOO_SHORT',
        `Buffer too short for signal headers: ${buffer.byteLength} bytes (need ≥ ${header.headerBytes})`,
        { bufferSize: buffer.byteLength, headerBytes: header.headerBytes },
      );
    }

    const signalHeaders = this.parseSignalHeaders(
      buffer,
      header.numSignals,
      header.dataRecordDuration,
    );

    // Compute record size from signal headers
    const samplesPerRecordTotal = signalHeaders.reduce((sum, sig) => sum + sig.samplesPerRecord, 0);
    const recordBytes = samplesPerRecordTotal * 2;

    // Bug 1 fix: EDF spec allows numDataRecords = -1 ("unknown").
    // Compute actual count from file size when -1.
    if (header.numDataRecords === -1) {
      const availableDataBytes = buffer.byteLength - header.headerBytes;
      const actualRecords = recordBytes > 0 ? Math.floor(availableDataBytes / recordBytes) : 0;
      header = { ...header, numDataRecords: actualRecords };
    }

    // Validate total buffer size
    const expectedBytes = header.headerBytes + recordBytes * header.numDataRecords;
    if (buffer.byteLength < expectedBytes) {
      throw new EDFParseError(
        'DATA_TRUNCATED',
        `Buffer truncated: expected ${expectedBytes} bytes, got ${buffer.byteLength}`,
        { expected: expectedBytes, actual: buffer.byteLength },
      );
    }

    // Detect annotation signal index
    const annotationSignalIndex = signalHeaders.findIndex((sig) => sig.label === ANNOTATION_LABEL);

    const signals = this.parseDataRecords(buffer, header, signalHeaders, annotationSignalIndex);

    // Parse annotations if present
    let annotations: EDFAnnotation[] | undefined;
    if (annotationSignalIndex >= 0) {
      const annotationSignal = signals[annotationSignalIndex];
      if (annotationSignal) {
        annotations = this.parseAnnotations(buffer, header, signalHeaders, annotationSignalIndex);
      }
    }

    const duration =
      header.dataRecordDuration > 0 ? header.numDataRecords * header.dataRecordDuration : 0;

    return {
      header,
      signals,
      annotations,
      duration,
      startTime: header.startDate,
      rawAnnotationSignalIndex: annotationSignalIndex >= 0 ? annotationSignalIndex : undefined,
    };
  }

  /**
   * Validate an EDF header without parsing the full file.
   *
   * @param buffer - Raw file bytes (at least 256 bytes).
   * @returns Validation result with errors and warnings.
   */
  validate(buffer: ArrayBuffer): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    if (buffer.byteLength < MIN_HEADER_BYTES) {
      errors.push({
        code: 'HEADER_TOO_SHORT',
        message: `Buffer too short: ${buffer.byteLength} bytes (need ≥ ${MIN_HEADER_BYTES})`,
        context: { bufferSize: buffer.byteLength },
      });
      return { isValid: false, errors, warnings };
    }

    // Version check
    const version = this.readAscii(buffer, 0, 8).trim();
    if (version !== '0') {
      errors.push({
        code: 'INVALID_VERSION',
        message: `Invalid EDF version: "${version}" (expected "0")`,
      });
    }

    // Number of signals
    const numSignalsStr = this.readAscii(buffer, 252, 4).trim();
    const numSignals = parseInt(numSignalsStr, 10);
    if (isNaN(numSignals) || numSignals < 0) {
      errors.push({
        code: 'INVALID_NUM_SIGNALS',
        message: `Invalid number of signals: "${numSignalsStr}"`,
      });
      return { isValid: false, errors, warnings };
    }

    // Header bytes
    const headerBytesStr = this.readAscii(buffer, 184, 8).trim();
    const headerBytes = parseInt(headerBytesStr, 10);
    const expectedHeaderBytes = 256 + 256 * numSignals;
    if (isNaN(headerBytes)) {
      errors.push({
        code: 'HEADER_SIZE_MISMATCH',
        message: `Invalid header byte count: "${headerBytesStr}"`,
      });
    } else if (headerBytes !== expectedHeaderBytes) {
      errors.push({
        code: 'HEADER_SIZE_MISMATCH',
        message: `Header byte count mismatch: declared ${headerBytes}, expected ${expectedHeaderBytes}`,
        context: { declared: headerBytes, expected: expectedHeaderBytes },
      });
    }

    // Number of data records (-1 is valid per EDF spec: "unknown")
    const numRecordsStr = this.readAscii(buffer, 236, 8).trim();
    const numRecords = parseInt(numRecordsStr, 10);
    if (isNaN(numRecords)) {
      errors.push({
        code: 'INVALID_NUM_RECORDS',
        message: `Invalid number of data records: "${numRecordsStr}"`,
      });
    }

    // Data record duration (0 is valid for EDF+ annotation-only files)
    const durationStr = this.readAscii(buffer, 244, 8).trim();
    const duration = parseFloat(durationStr);
    if (isNaN(duration) || duration < 0) {
      errors.push({
        code: 'INVALID_RECORD_DURATION',
        message: `Invalid data record duration: "${durationStr}"`,
      });
    }

    // Date validation
    const dateStr = this.readAscii(buffer, 168, 8).trim();
    if (!/^\d{2}\.\d{2}\.\d{2}$/.test(dateStr)) {
      warnings.push({
        code: 'INVALID_DATE',
        message: `Unexpected date format: "${dateStr}" (expected dd.mm.yy)`,
      });
    }

    // Time validation
    const timeStr = this.readAscii(buffer, 176, 8).trim();
    if (!/^\d{2}\.\d{2}\.\d{2}$/.test(timeStr)) {
      warnings.push({
        code: 'INVALID_TIME',
        message: `Unexpected time format: "${timeStr}" (expected hh.mm.ss)`,
      });
    }

    // Buffer size check against expected total
    if (!isNaN(numRecords) && numRecords >= 0 && !isNaN(headerBytes) && numSignals > 0) {
      if (buffer.byteLength >= expectedHeaderBytes) {
        // We can check further if signal headers are parseable
        // but keep this lightweight
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Read an ASCII string slice from the buffer. */
  private readAscii(buffer: ArrayBuffer, offset: number, length: number): string {
    return this.decoder.decode(new Uint8Array(buffer, offset, length));
  }

  /**
   * Parse the fixed 256-byte EDF header.
   *
   * @throws {@link EDFParseError} on invalid header fields.
   */
  private parseHeader(buffer: ArrayBuffer): EDFHeader {
    const version = this.readAscii(buffer, 0, 8).trim();
    if (version !== '0') {
      throw new EDFParseError(
        'INVALID_VERSION',
        `Invalid EDF version: "${version}" (expected "0")`,
      );
    }

    const patientId = this.readAscii(buffer, 8, 80).trim();
    const recordingId = this.readAscii(buffer, 88, 80).trim();

    const dateStr = this.readAscii(buffer, 168, 8).trim();
    const timeStr = this.readAscii(buffer, 176, 8).trim();
    const startDate = this.parseEDFDateTime(dateStr, timeStr);

    const headerBytes = this.parseIntField(buffer, 184, 8, 'header byte count');
    const reserved = this.readAscii(buffer, 192, 44).trim();
    const numDataRecords = this.parseIntField(buffer, 236, 8, 'number of data records');
    const dataRecordDuration = this.parseFloatField(buffer, 244, 8, 'data record duration');
    const numSignals = this.parseIntField(buffer, 252, 4, 'number of signals');

    if (numSignals < 0) {
      throw new EDFParseError('INVALID_NUM_SIGNALS', `Invalid number of signals: ${numSignals}`, {
        numSignals,
      });
    }

    // Validate header byte count
    const expectedHeaderBytes = 256 + 256 * numSignals;
    if (headerBytes !== expectedHeaderBytes) {
      throw new EDFParseError(
        'HEADER_SIZE_MISMATCH',
        `Header size mismatch: declared ${headerBytes}, expected ${expectedHeaderBytes}`,
        { declared: headerBytes, expected: expectedHeaderBytes },
      );
    }

    // Bug 2 fix: EDF+ annotation-only files (EVE, CSL) use dataRecordDuration = 0.
    // Only reject negative durations.
    if (dataRecordDuration < 0) {
      throw new EDFParseError(
        'INVALID_RECORD_DURATION',
        `Data record duration must be non-negative: ${dataRecordDuration}`,
        { dataRecordDuration },
      );
    }

    return {
      version,
      patientId,
      recordingId,
      startDate,
      headerBytes,
      reserved,
      numDataRecords,
      dataRecordDuration,
      numSignals,
    };
  }

  /**
   * Parse per-signal headers.
   *
   * EDF stores each field sequentially across all signals:
   * all labels first, then all transducer types, etc.
   */
  private parseSignalHeaders(
    buffer: ArrayBuffer,
    numSignals: number,
    dataRecordDuration: number,
  ): EDFSignalHeader[] {
    const base = 256; // Signal headers start after fixed header

    // Field offsets: each field spans numSignals entries of the given width
    // label (16), transducerType (80), physicalDimension (8),
    // physicalMin (8), physicalMax (8), digitalMin (8), digitalMax (8),
    // prefiltering (80), samplesPerRecord (8), reserved (32)
    const widths = [16, 80, 8, 8, 8, 8, 8, 80, 8, 32];
    const offsets: number[] = [];
    let offset = base;
    for (const w of widths) {
      offsets.push(offset);
      offset += w * numSignals;
    }

    const headers: EDFSignalHeader[] = [];

    for (let i = 0; i < numSignals; i++) {
      const label = this.readAscii(buffer, (offsets[0] ?? 0) + i * 16, 16).trim();
      const transducerType = this.readAscii(buffer, (offsets[1] ?? 0) + i * 80, 80).trim();
      const physicalDimension = this.readAscii(buffer, (offsets[2] ?? 0) + i * 8, 8).trim();
      const physicalMin = this.parseFloatFromAscii(buffer, (offsets[3] ?? 0) + i * 8, 8);
      const physicalMax = this.parseFloatFromAscii(buffer, (offsets[4] ?? 0) + i * 8, 8);
      const digitalMin = this.parseIntFromAscii(buffer, (offsets[5] ?? 0) + i * 8, 8);
      const digitalMax = this.parseIntFromAscii(buffer, (offsets[6] ?? 0) + i * 8, 8);
      const prefiltering = this.readAscii(buffer, (offsets[7] ?? 0) + i * 80, 80).trim();
      const samplesPerRecord = this.parseIntFromAscii(buffer, (offsets[8] ?? 0) + i * 8, 8);

      if (samplesPerRecord < 0) {
        throw new EDFParseError(
          'INVALID_NUM_SIGNALS',
          `Signal "${label}": samplesPerRecord must be non-negative: ${samplesPerRecord}`,
          { signal: label, samplesPerRecord },
        );
      }

      if (digitalMax === digitalMin) {
        throw new EDFParseError(
          'DIGITAL_RANGE_ZERO',
          `Signal "${label}": digitalMin equals digitalMax (${digitalMin})`,
          { signal: label, digitalMin, digitalMax },
        );
      }

      // Guard against Infinity when dataRecordDuration is 0 (annotation-only files)
      const sampleRate = dataRecordDuration > 0 ? samplesPerRecord / dataRecordDuration : 0;

      headers.push({
        label,
        transducerType,
        physicalDimension,
        physicalMin,
        physicalMax,
        digitalMin,
        digitalMax,
        prefiltering,
        samplesPerRecord,
        sampleRate,
      });
    }

    return headers;
  }

  /**
   * Parse all data records and convert digital values to physical units.
   *
   * Each record contains interleaved samples for all signals as 16-bit
   * little-endian signed integers.
   */
  private parseDataRecords(
    buffer: ArrayBuffer,
    header: EDFHeader,
    signalHeaders: readonly EDFSignalHeader[],
    annotationSignalIndex: number,
  ): EDFSignal[] {
    const view = new DataView(buffer);
    const numRecords = header.numDataRecords;

    // Pre-allocate Float32Arrays for all signals
    const signals: EDFSignal[] = signalHeaders.map((sh) => ({
      label: sh.label,
      transducerType: sh.transducerType,
      physicalDimension: sh.physicalDimension,
      physicalMin: sh.physicalMin,
      physicalMax: sh.physicalMax,
      digitalMin: sh.digitalMin,
      digitalMax: sh.digitalMax,
      prefiltering: sh.prefiltering,
      samplesPerRecord: sh.samplesPerRecord,
      sampleRate: sh.sampleRate,
      samples: new Float32Array(sh.samplesPerRecord * numRecords),
    }));

    // Compute total samples per record for byte offset calculation
    const samplesPerRecordTotal = signalHeaders.reduce((sum, sh) => sum + sh.samplesPerRecord, 0);
    const recordBytes = samplesPerRecordTotal * 2;

    for (let rec = 0; rec < numRecords; rec++) {
      const recordStart = header.headerBytes + rec * recordBytes;
      let sampleByteOffset = 0;

      for (let sigIdx = 0; sigIdx < signalHeaders.length; sigIdx++) {
        const sh = signalHeaders[sigIdx];
        const signal = signals[sigIdx];
        if (!sh || !signal) continue;
        const destOffset = rec * sh.samplesPerRecord;

        if (sigIdx === annotationSignalIndex) {
          // Annotation signal: store raw digital values for later byte extraction
          for (let s = 0; s < sh.samplesPerRecord; s++) {
            const byteOffset = recordStart + sampleByteOffset + s * 2;
            signal.samples[destOffset + s] = view.getInt16(byteOffset, true);
          }
        } else {
          // Regular signal: convert to physical values
          const digitalRange = sh.digitalMax - sh.digitalMin;
          const physicalRange = sh.physicalMax - sh.physicalMin;
          const scale = physicalRange / digitalRange;

          for (let s = 0; s < sh.samplesPerRecord; s++) {
            const byteOffset = recordStart + sampleByteOffset + s * 2;
            const digital = view.getInt16(byteOffset, true);
            signal.samples[destOffset + s] = (digital - sh.digitalMin) * scale + sh.physicalMin;
          }
        }

        sampleByteOffset += sh.samplesPerRecord * 2;
      }
    }

    return signals;
  }

  /**
   * Parse EDF+ TAL (Time-stamped Annotation List) annotations.
   *
   * The annotation signal carries binary data that represents text.
   * Each 16-bit sample is split into 2 bytes (low byte, high byte in
   * little-endian) before text decoding.
   */
  private parseAnnotations(
    buffer: ArrayBuffer,
    header: EDFHeader,
    signalHeaders: readonly EDFSignalHeader[],
    annotationSignalIndex: number,
  ): EDFAnnotation[] {
    const view = new DataView(buffer);
    const annotations: EDFAnnotation[] = [];
    const numRecords = header.numDataRecords;
    const annSh = signalHeaders[annotationSignalIndex];
    if (!annSh) {
      return annotations;
    }

    // For each data record, extract the annotation signal's raw bytes
    const samplesPerRecordTotal = signalHeaders.reduce((sum, sh) => sum + sh.samplesPerRecord, 0);
    const recordBytes = samplesPerRecordTotal * 2;

    // Compute byte offset of the annotation signal within each record
    let annByteOffsetInRecord = 0;
    for (let i = 0; i < annotationSignalIndex; i++) {
      annByteOffsetInRecord += (signalHeaders[i]?.samplesPerRecord ?? 0) * 2;
    }

    for (let rec = 0; rec < numRecords; rec++) {
      const recordStart = header.headerBytes + rec * recordBytes;
      const annStart = recordStart + annByteOffsetInRecord;
      const annByteCount = annSh.samplesPerRecord * 2;

      // Read raw bytes from the annotation signal
      // Each 16-bit sample → 2 bytes (low, high) in little-endian
      const bytes = new Uint8Array(annByteCount);
      for (let i = 0; i < annSh.samplesPerRecord; i++) {
        const int16 = view.getInt16(annStart + i * 2, true);
        bytes[i * 2] = int16 & 0xff;
        bytes[i * 2 + 1] = (int16 >> 8) & 0xff;
      }

      const text = new TextDecoder('ascii').decode(bytes);
      const recordAnnotations = this.parseTAL(text);
      for (const ann of recordAnnotations) {
        annotations.push(ann);
      }
    }

    return annotations;
  }

  /**
   * Parse a TAL (Time-stamped Annotation List) text block.
   *
   * EDF+ TAL format per spec:
   * - `+onset\x14\x14\x00` — timekeeping TAL (no annotation)
   * - `+onset\x14text\x14\x00` — annotation without duration
   * - `+onset\x15duration\x14text\x14\x00` — annotation with duration
   *
   * Key: `\x15` appears at most once (before duration), `\x14` separates
   * duration from annotation text and terminates each annotation.
   *
   * @see https://www.edfplus.info/specs/edfplus.html#tal
   */
  private parseTAL(text: string): EDFAnnotation[] {
    const annotations: EDFAnnotation[] = [];

    // Split on null terminators to get individual TAL entries
    const entries = text.split('\x00').filter((s) => s.length > 0);

    for (const entry of entries) {
      // Each TAL entry starts with an onset: +nnn.nnn or -nnn.nnn
      const onsetMatch = entry.match(/^([+-]\d+\.?\d*)/);
      if (!onsetMatch?.[1]) continue;

      const onset = parseFloat(onsetMatch[1]);
      if (isNaN(onset)) continue;

      const rest = entry.slice(onsetMatch[0].length);

      let duration = 0;
      let labelText = '';

      if (rest.startsWith(TAL_FIELD_SEP)) {
        // Format: \x15duration\x14text\x14...
        // After \x15, everything up to the first \x14 is the duration.
        // Everything from the first \x14 onward is the annotation text.
        const afterDurationMarker = rest.slice(1); // skip \x15
        const firstAnnotSep = afterDurationMarker.indexOf(TAL_ANNOTATION_SEP);

        if (firstAnnotSep >= 0) {
          const durationStr = afterDurationMarker.slice(0, firstAnnotSep);
          duration = durationStr.length > 0 ? parseFloat(durationStr) : 0;
          labelText = afterDurationMarker.slice(firstAnnotSep);
        } else {
          // No \x14 found — treat entire rest as duration (rare edge case)
          const durationStr = afterDurationMarker;
          duration = durationStr.length > 0 ? parseFloat(durationStr) : 0;
        }
      } else if (rest.startsWith(TAL_ANNOTATION_SEP)) {
        // Format: \x14text\x14... (no duration)
        labelText = rest;
      }

      if (isNaN(duration)) duration = 0;

      // Extract labels from annotation text (split on \x14, skip empty)
      const labels = labelText
        .split(TAL_ANNOTATION_SEP)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Skip entries with no labels (timekeeping TALs)
      if (labels.length === 0) continue;

      annotations.push({ onset, duration, labels });
    }

    return annotations;
  }

  /**
   * Parse EDF date and time strings to a Date object.
   *
   * Date format: `dd.mm.yy` with Y2K pivot (00–79 → 2000+, 80–99 → 1900+).
   * Time format: `hh.mm.ss` (24-hour).
   */
  private parseEDFDateTime(dateStr: string, timeStr: string): Date {
    const dateParts = dateStr.split('.');
    if (dateParts.length !== 3) {
      throw new EDFParseError(
        'INVALID_DATE',
        `Invalid EDF date format: "${dateStr}" (expected dd.mm.yy)`,
      );
    }

    const day = parseInt(dateParts[0] ?? '', 10);
    const month = parseInt(dateParts[1] ?? '', 10);
    const yearShort = parseInt(dateParts[2] ?? '', 10);

    if (isNaN(day) || isNaN(month) || isNaN(yearShort)) {
      throw new EDFParseError('INVALID_DATE', `Non-numeric date components in "${dateStr}"`);
    }

    // Y2K pivot: 00–79 → 2000–2079, 80–99 → 1980–1999
    const fullYear = yearShort < 80 ? 2000 + yearShort : 1900 + yearShort;

    const timeParts = timeStr.split('.');
    if (timeParts.length !== 3) {
      throw new EDFParseError(
        'INVALID_TIME',
        `Invalid EDF time format: "${timeStr}" (expected hh.mm.ss)`,
      );
    }

    const hour = parseInt(timeParts[0] ?? '', 10);
    const minute = parseInt(timeParts[1] ?? '', 10);
    const second = parseInt(timeParts[2] ?? '', 10);

    if (isNaN(hour) || isNaN(minute) || isNaN(second)) {
      throw new EDFParseError('INVALID_TIME', `Non-numeric time components in "${timeStr}"`);
    }

    return new Date(fullYear, month - 1, day, hour, minute, second);
  }

  /** Parse an ASCII integer field from the buffer. */
  private parseIntField(
    buffer: ArrayBuffer,
    offset: number,
    length: number,
    fieldName: string,
  ): number {
    const str = this.readAscii(buffer, offset, length).trim();
    const value = parseInt(str, 10);
    if (isNaN(value)) {
      throw new EDFParseError('HEADER_TOO_SHORT', `Invalid integer in ${fieldName}: "${str}"`);
    }
    return value;
  }

  /** Parse an ASCII float field from the buffer. */
  private parseFloatField(
    buffer: ArrayBuffer,
    offset: number,
    length: number,
    fieldName: string,
  ): number {
    const str = this.readAscii(buffer, offset, length).trim();
    const value = parseFloat(str);
    if (isNaN(value)) {
      throw new EDFParseError('HEADER_TOO_SHORT', `Invalid float in ${fieldName}: "${str}"`);
    }
    return value;
  }

  /** Parse an ASCII integer from a buffer region. */
  private parseIntFromAscii(buffer: ArrayBuffer, offset: number, length: number): number {
    const str = this.readAscii(buffer, offset, length).trim();
    return parseInt(str, 10);
  }

  /** Parse an ASCII float from a buffer region. */
  private parseFloatFromAscii(buffer: ArrayBuffer, offset: number, length: number): number {
    const str = this.readAscii(buffer, offset, length).trim();
    return parseFloat(str);
  }
}

/** Internal signal header type (used during parsing only). */
interface EDFSignalHeader {
  readonly label: string;
  readonly transducerType: string;
  readonly physicalDimension: string;
  readonly physicalMin: number;
  readonly physicalMax: number;
  readonly digitalMin: number;
  readonly digitalMax: number;
  readonly prefiltering: string;
  readonly samplesPerRecord: number;
  readonly sampleRate: number;
}
