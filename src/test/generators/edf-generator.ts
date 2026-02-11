/**
 * Synthetic EDF binary file generator for deterministic testing.
 *
 * Generates valid EDF/EDF+ binary files with configurable headers,
 * signal channels, known sample values, and annotations. All functions
 * return `ArrayBuffer` that can be directly passed to `EDFParser.parse()`.
 */

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/** Configuration for a single signal channel. */
export interface SignalConfig {
  /** Signal label (e.g., "Flow", "MaskPressure"). */
  readonly label: string;
  /** Physical dimension / unit (e.g., "L/min"). */
  readonly physicalDimension: string;
  /** Physical minimum value. */
  readonly physicalMin: number;
  /** Physical maximum value. */
  readonly physicalMax: number;
  /** Digital minimum value (default: -32768). */
  readonly digitalMin?: number;
  /** Digital maximum value (default: 32767). */
  readonly digitalMax?: number;
  /** Number of samples per data record (determines sample rate). */
  readonly samplesPerRecord: number;
  /** Transducer type (default: empty). */
  readonly transducerType?: string;
  /** Pre-filtering string (default: empty). */
  readonly prefiltering?: string;
  /**
   * Sample value generator function.
   * Receives the sample index and total sample count.
   * Should return a value in the physical range.
   * Default: generates a sine wave between physicalMin and physicalMax.
   */
  readonly generator?: (sampleIndex: number, totalSamples: number) => number;
}

/** Configuration for an EDF annotation event. */
export interface AnnotationConfig {
  /** Onset time in seconds from recording start. */
  readonly onset: number;
  /** Duration in seconds (0 for instantaneous). */
  readonly duration: number;
  /** Annotation label text. */
  readonly label: string;
}

/** Full configuration for EDF file generation. */
export interface EDFGeneratorOptions {
  /** EDF version (default: "0"). */
  readonly version?: string;
  /** Patient identification string (default: "12345678 AirSense 10 AutoSet"). */
  readonly patientId?: string;
  /** Recording identification string (default: empty). */
  readonly recordingId?: string;
  /** Start date (default: 2026-01-15 22:30:00). */
  readonly startDate?: Date;
  /** Duration of each data record in seconds (default: 1). */
  readonly dataRecordDuration?: number;
  /** Number of data records (default: 60). */
  readonly numDataRecords?: number;
  /** Reserved field (default: empty for EDF, "EDF+C" for EDF+ with annotations). */
  readonly reserved?: string;
  /** Signal channel configurations. */
  readonly signals: readonly SignalConfig[];
  /** EDF+ annotations to embed (optional). Adds an annotation signal automatically. */
  readonly annotations?: readonly AnnotationConfig[];
}

/** Options for the BRP (breathing parameters) file generator. */
export interface BRPFileOptions {
  /** Patient identification string. */
  readonly patientId?: string;
  /** Start date. */
  readonly startDate?: Date;
  /** Number of data records (seconds of data at 1s record duration). */
  readonly numDataRecords?: number;
  /** Flow sample rate (samples per record, default: 25). */
  readonly flowSampleRate?: number;
  /** Mask pressure sample rate (samples per record, default: 25). */
  readonly pressureSampleRate?: number;
  /** Leak sample rate (samples per record, default: 2). */
  readonly leakSampleRate?: number;
}

/** Options for the SAD (SpO2/pulse) file generator. */
export interface SADFileOptions {
  /** Patient identification string. */
  readonly patientId?: string;
  /** Start date. */
  readonly startDate?: Date;
  /** Number of data records. */
  readonly numDataRecords?: number;
  /** Base SpO2 value (default: 96). */
  readonly baseSpO2?: number;
  /** Base pulse value (default: 72). */
  readonly basePulse?: number;
}

// ---------------------------------------------------------------------------
// Signal value generators
// ---------------------------------------------------------------------------

/**
 * Generate a sine wave between min and max.
 *
 * @param sampleIndex - Current sample index.
 * @param totalSamples - Total number of samples.
 * @param min - Minimum value.
 * @param max - Maximum value.
 * @param cycles - Number of complete cycles (default: 10).
 * @returns Physical value.
 */
export function sineWaveGenerator(
  sampleIndex: number,
  totalSamples: number,
  min: number,
  max: number,
  cycles: number = 10,
): number {
  const t = sampleIndex / totalSamples;
  const amplitude = (max - min) / 2;
  const offset = (max + min) / 2;
  return offset + amplitude * Math.sin(2 * Math.PI * cycles * t);
}

/**
 * Generate a constant value.
 *
 * @param value - The constant physical value.
 * @returns Generator function.
 */
export function constantGenerator(
  value: number,
): (sampleIndex: number, totalSamples: number) => number {
  return () => value;
}

/**
 * Generate a linear ramp from start to end.
 *
 * @param start - Starting physical value.
 * @param end - Ending physical value.
 * @returns Generator function.
 */
export function rampGenerator(
  start: number,
  end: number,
): (sampleIndex: number, totalSamples: number) => number {
  return (sampleIndex: number, totalSamples: number) => {
    if (totalSamples <= 1) return start;
    return start + ((end - start) * sampleIndex) / (totalSamples - 1);
  };
}

/**
 * Generate a step function that alternates between two values.
 *
 * @param low - Low value.
 * @param high - High value.
 * @param stepsPerCycle - Samples per half-cycle (default: 50).
 * @returns Generator function.
 */
export function stepGenerator(
  low: number,
  high: number,
  stepsPerCycle: number = 50,
): (sampleIndex: number, totalSamples: number) => number {
  return (sampleIndex: number) => {
    const phase = Math.floor(sampleIndex / stepsPerCycle) % 2;
    return phase === 0 ? low : high;
  };
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate a complete valid EDF binary file.
 *
 * @param options - Full EDF file configuration.
 * @returns ArrayBuffer containing the binary EDF data.
 */
export function generateEDFFile(options: EDFGeneratorOptions): ArrayBuffer {
  const version = options.version ?? '0';
  const patientId = options.patientId ?? '12345678 AirSense 10 AutoSet';
  const recordingId = options.recordingId ?? '';
  const startDate = options.startDate ?? new Date(2026, 0, 15, 22, 30, 0);
  const dataRecordDuration = options.dataRecordDuration ?? 1;
  const numDataRecords = options.numDataRecords ?? 60;
  const annotations = options.annotations ?? [];

  // Build signal list (possibly adding annotation signal)
  const signals = [...options.signals];
  let hasAnnotations = false;

  if (annotations.length > 0) {
    hasAnnotations = true;
    // Add an annotation signal with enough bytes per record
    // Each annotation entry: "+onset\x15duration\x15label\x14\x00"
    // Estimate max bytes needed per record
    const maxAnnotationBytes = 256; // generous allocation
    const samplesPerRecord = Math.ceil(maxAnnotationBytes / 2); // 2 bytes per sample
    signals.push({
      label: 'EDF Annotations',
      physicalDimension: '',
      physicalMin: -32768,
      physicalMax: 32767,
      digitalMin: -32768,
      digitalMax: 32767,
      samplesPerRecord,
    });
  }

  const numSignals = signals.length;
  const reserved = options.reserved ?? (hasAnnotations ? 'EDF+C' : '');

  // Compute header size
  const headerBytes = 256 + 256 * numSignals;

  // Build the fixed header (256 bytes)
  const dateStr = formatEDFDate(startDate);
  const timeStr = formatEDFTime(startDate);

  const fixedHeader = new Uint8Array(256);
  const encoder = new TextEncoder();

  writeField(fixedHeader, 0, 8, version, encoder);
  writeField(fixedHeader, 8, 80, patientId, encoder);
  writeField(fixedHeader, 88, 80, recordingId, encoder);
  writeField(fixedHeader, 168, 8, dateStr, encoder);
  writeField(fixedHeader, 176, 8, timeStr, encoder);
  writeField(fixedHeader, 184, 8, String(headerBytes), encoder);
  writeField(fixedHeader, 192, 44, reserved, encoder);
  writeField(fixedHeader, 236, 8, String(numDataRecords), encoder);
  writeField(fixedHeader, 244, 8, String(dataRecordDuration), encoder);
  writeField(fixedHeader, 252, 4, String(numSignals), encoder);

  // Build per-signal headers
  // Fields are stored sequentially: all labels, then all transducers, etc.
  const signalHeaderBytes = 256 * numSignals;
  const signalHeader = new Uint8Array(signalHeaderBytes);

  const fieldWidths = [16, 80, 8, 8, 8, 8, 8, 80, 8, 32];
  const fieldOffsets: number[] = [];
  let offset = 0;
  for (const w of fieldWidths) {
    fieldOffsets.push(offset);
    offset += w * numSignals;
  }

  for (let i = 0; i < numSignals; i++) {
    const sig = signals[i];
    if (!sig) continue;
    const dMin = sig.digitalMin ?? -32768;
    const dMax = sig.digitalMax ?? 32767;

    writeField(signalHeader, (fieldOffsets[0] ?? 0) + i * 16, 16, sig.label, encoder);
    writeField(
      signalHeader,
      (fieldOffsets[1] ?? 0) + i * 80,
      80,
      sig.transducerType ?? '',
      encoder,
    );
    writeField(signalHeader, (fieldOffsets[2] ?? 0) + i * 8, 8, sig.physicalDimension, encoder);
    writeField(signalHeader, (fieldOffsets[3] ?? 0) + i * 8, 8, String(sig.physicalMin), encoder);
    writeField(signalHeader, (fieldOffsets[4] ?? 0) + i * 8, 8, String(sig.physicalMax), encoder);
    writeField(signalHeader, (fieldOffsets[5] ?? 0) + i * 8, 8, String(dMin), encoder);
    writeField(signalHeader, (fieldOffsets[6] ?? 0) + i * 8, 8, String(dMax), encoder);
    writeField(signalHeader, (fieldOffsets[7] ?? 0) + i * 80, 80, sig.prefiltering ?? '', encoder);
    writeField(
      signalHeader,
      (fieldOffsets[8] ?? 0) + i * 8,
      8,
      String(sig.samplesPerRecord),
      encoder,
    );
    // fieldOffsets[9] is the reserved field for signals (32 bytes each) — leave blank
  }

  // Build data records
  const samplesPerRecordTotal = signals.reduce((sum, sig) => sum + sig.samplesPerRecord, 0);
  const recordBytes = samplesPerRecordTotal * 2;
  const dataBytes = recordBytes * numDataRecords;
  const dataBuffer = new ArrayBuffer(dataBytes);
  const dataView = new DataView(dataBuffer);

  // Pre-compute total samples per signal for generators
  const totalSamplesPerSignal = signals.map((sig) => sig.samplesPerRecord * numDataRecords);

  // Group annotations by record for EDF+ annotation signal
  const annotationsByRecord = new Map<number, AnnotationConfig[]>();
  if (hasAnnotations) {
    for (const ann of annotations) {
      const recordIndex = Math.floor(ann.onset / dataRecordDuration);
      const clamped = Math.min(recordIndex, numDataRecords - 1);
      const existing = annotationsByRecord.get(clamped);
      if (existing) {
        existing.push(ann);
      } else {
        annotationsByRecord.set(clamped, [ann]);
      }
    }
  }

  for (let rec = 0; rec < numDataRecords; rec++) {
    let byteOffset = rec * recordBytes;

    for (let sigIdx = 0; sigIdx < signals.length; sigIdx++) {
      const sig = signals[sigIdx];
      if (!sig) continue;
      const dMin = sig.digitalMin ?? -32768;
      const dMax = sig.digitalMax ?? 32767;
      const totalSamples = totalSamplesPerSignal[sigIdx] ?? 0;
      const isAnnotationSignal = hasAnnotations && sigIdx === signals.length - 1;

      if (isAnnotationSignal) {
        // Write annotation bytes as Int16 samples
        const annBytes = new Uint8Array(sig.samplesPerRecord * 2);
        const recordAnns = annotationsByRecord.get(rec);

        let annByteCursor = 0;

        // Timekeeping TAL (onset of this record)
        const recordOnset = rec * dataRecordDuration;
        const talPrefix = `+${recordOnset}\x14\x14\x00`;
        const talBytes = encoder.encode(talPrefix);
        annBytes.set(talBytes, annByteCursor);
        annByteCursor += talBytes.length;

        if (recordAnns) {
          for (const ann of recordAnns) {
            const durationStr = ann.duration > 0 ? String(ann.duration) : '';
            // EDF+ TAL format: +onset\x15duration\x14label\x14\x00
            // \x15 marks the start of duration, \x14 separates duration from annotation text
            const talStr = `+${ann.onset}\x15${durationStr}\x14${ann.label}\x14\x00`;
            const talEntryBytes = encoder.encode(talStr);
            if (annByteCursor + talEntryBytes.length <= annBytes.length) {
              annBytes.set(talEntryBytes, annByteCursor);
              annByteCursor += talEntryBytes.length;
            }
          }
        }

        // Write as Int16 little-endian samples (pack 2 bytes per sample)
        for (let s = 0; s < sig.samplesPerRecord; s++) {
          const lo = annBytes[s * 2] ?? 0;
          const hi = annBytes[s * 2 + 1] ?? 0;
          // Combine as signed Int16 little-endian
          let value = lo | (hi << 8);
          if (value >= 0x8000) value -= 0x10000;
          dataView.setInt16(byteOffset + s * 2, value, true);
        }
      } else {
        // Regular signal: generate physical values and convert to digital
        const digitalRange = dMax - dMin;
        const physicalRange = sig.physicalMax - sig.physicalMin;
        const generator =
          sig.generator ??
          ((idx: number, total: number) =>
            sineWaveGenerator(idx, total, sig.physicalMin, sig.physicalMax));

        for (let s = 0; s < sig.samplesPerRecord; s++) {
          const globalIndex = rec * sig.samplesPerRecord + s;
          const physValue = generator(globalIndex, totalSamples);

          // Convert physical → digital
          const digital = Math.round(
            ((physValue - sig.physicalMin) / physicalRange) * digitalRange + dMin,
          );

          // Clamp to 16-bit signed range
          const clamped = Math.max(-32768, Math.min(32767, digital));
          dataView.setInt16(byteOffset + s * 2, clamped, true);
        }
      }

      byteOffset += sig.samplesPerRecord * 2;
    }
  }

  // Combine header + signal headers + data into one buffer
  const totalSize = headerBytes + dataBytes;
  const result = new ArrayBuffer(totalSize);
  const resultArray = new Uint8Array(result);
  resultArray.set(fixedHeader, 0);
  resultArray.set(signalHeader, 256);
  resultArray.set(new Uint8Array(dataBuffer), headerBytes);

  return result;
}

// ---------------------------------------------------------------------------
// Convenience generators
// ---------------------------------------------------------------------------

/**
 * Generate a typical BRP (Breathing Parameters) EDF file.
 *
 * Contains Flow (25 Hz), MaskPressure (25 Hz), and Leak (2 Hz) channels.
 *
 * @param options - Optional overrides.
 * @returns ArrayBuffer of a valid EDF file.
 */
export function generateBRPFile(options?: BRPFileOptions): ArrayBuffer {
  const patientId = options?.patientId ?? '12345678 AirSense 10 AutoSet';
  const startDate = options?.startDate ?? new Date(2026, 0, 15, 22, 30, 0);
  const numDataRecords = options?.numDataRecords ?? 60;
  const flowSPR = options?.flowSampleRate ?? 25;
  const pressureSPR = options?.pressureSampleRate ?? 25;
  const leakSPR = options?.leakSampleRate ?? 2;

  return generateEDFFile({
    patientId,
    startDate,
    numDataRecords,
    dataRecordDuration: 1,
    signals: [
      {
        label: 'Flow',
        physicalDimension: 'L/min',
        physicalMin: -200,
        physicalMax: 200,
        samplesPerRecord: flowSPR,
        generator: (idx, total) => sineWaveGenerator(idx, total, -100, 100, 15),
      },
      {
        label: 'MaskPressure',
        physicalDimension: 'cmH2O',
        physicalMin: 0,
        physicalMax: 25,
        samplesPerRecord: pressureSPR,
        generator: constantGenerator(10),
      },
      {
        label: 'Leak',
        physicalDimension: 'L/min',
        physicalMin: 0,
        physicalMax: 100,
        samplesPerRecord: leakSPR,
        generator: constantGenerator(5),
      },
    ],
  });
}

/**
 * Generate an EVE (Events) EDF+ file with annotations.
 *
 * @param events - Array of event annotations to embed.
 * @param options - Optional overrides for patient ID and start date.
 * @returns ArrayBuffer of a valid EDF+ file.
 */
export function generateEVEFile(
  events: readonly AnnotationConfig[],
  options?: {
    readonly patientId?: string;
    readonly startDate?: Date;
    readonly numDataRecords?: number;
  },
): ArrayBuffer {
  const patientId = options?.patientId ?? '12345678 AirSense 10 AutoSet';
  const startDate = options?.startDate ?? new Date(2026, 0, 15, 22, 30, 0);

  // Compute minimum records needed to hold all events
  const maxOnset = events.reduce((max, e) => Math.max(max, e.onset + e.duration), 0);
  const numDataRecords = options?.numDataRecords ?? Math.max(Math.ceil(maxOnset) + 1, 60);

  return generateEDFFile({
    patientId,
    startDate,
    numDataRecords,
    dataRecordDuration: 1,
    reserved: 'EDF+C',
    signals: [], // Only annotation signal (added automatically)
    annotations: events,
  });
}

/**
 * Generate a SAD (SpO2 + Pulse) EDF file.
 *
 * Contains SpO2 (1 Hz) and Pulse (1 Hz) channels.
 *
 * @param options - Optional overrides.
 * @returns ArrayBuffer of a valid EDF file.
 */
export function generateSADFile(options?: SADFileOptions): ArrayBuffer {
  const patientId = options?.patientId ?? '12345678 AirSense 10 AutoSet';
  const startDate = options?.startDate ?? new Date(2026, 0, 15, 22, 30, 0);
  const numDataRecords = options?.numDataRecords ?? 60;
  const baseSpO2 = options?.baseSpO2 ?? 96;
  const basePulse = options?.basePulse ?? 72;

  return generateEDFFile({
    patientId,
    startDate,
    numDataRecords,
    dataRecordDuration: 1,
    signals: [
      {
        label: 'SpO2',
        physicalDimension: '%',
        physicalMin: 50,
        physicalMax: 100,
        samplesPerRecord: 1,
        generator: constantGenerator(baseSpO2),
      },
      {
        label: 'Pulse',
        physicalDimension: 'bpm',
        physicalMin: 30,
        physicalMax: 250,
        samplesPerRecord: 1,
        generator: constantGenerator(basePulse),
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Write a space-padded ASCII field into a Uint8Array. */
function writeField(
  target: Uint8Array,
  offset: number,
  length: number,
  value: string,
  encoder: TextEncoder,
): void {
  // Space-pad the value to the field length
  const padded = value.padEnd(length, ' ').slice(0, length);
  const bytes = encoder.encode(padded);
  target.set(bytes, offset);
}

/** Format a Date as EDF date string "dd.mm.yy". */
function formatEDFDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear() % 100).padStart(2, '0');
  return `${day}.${month}.${year}`;
}

/** Format a Date as EDF time string "hh.mm.ss". */
function formatEDFTime(date: Date): string {
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${hour}.${minute}.${second}`;
}
