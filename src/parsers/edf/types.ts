/**
 * Internal types for the EDF/EDF+ parser.
 *
 * These types represent the raw EDF file structure and are used internally
 * by the parser. They include fields like digitalMin/digitalMax that are
 * needed during parsing but are NOT part of the domain `ChannelMetadata` type.
 */

/** Parsed EDF/EDF+ file structure. */
export interface EDFFile {
  /** EDF header metadata. */
  readonly header: EDFHeader;
  /** Parsed signal data with physical values. */
  readonly signals: readonly EDFSignal[];
  /** Parsed EDF+ annotations (if present). */
  readonly annotations?: readonly EDFAnnotation[];
  /** Total file duration in seconds (header.numDataRecords × header.dataRecordDuration). */
  readonly duration: number;
  /** Recording start time (mirrors header.startDate for convenience). */
  readonly startTime: Date;
  /** Raw annotation signal index (if present), for debugging. */
  readonly rawAnnotationSignalIndex?: number;
}

/** EDF fixed header (256 bytes). */
export interface EDFHeader {
  /** EDF version string (should be "0"). */
  readonly version: string;
  /** Local patient identification. ResMed uses "[serial] [model]". */
  readonly patientId: string;
  /** Local recording identification. */
  readonly recordingId: string;
  /** Recording start date/time. */
  readonly startDate: Date;
  /** Total header size in bytes (256 + 256 × numSignals). */
  readonly headerBytes: number;
  /** Reserved field (e.g., "EDF+C" for continuous EDF+). */
  readonly reserved: string;
  /** Number of data records in the file. -1 if unknown. */
  readonly numDataRecords: number;
  /** Duration of each data record in seconds. */
  readonly dataRecordDuration: number;
  /** Number of signals in the file. */
  readonly numSignals: number;
}

/** Parsed signal data from an EDF file. */
export interface EDFSignal {
  /** Signal label (trimmed from header). */
  readonly label: string;
  /** Transducer type. */
  readonly transducerType: string;
  /** Physical dimension / unit (e.g., "L/min", "cmH2O"). */
  readonly physicalDimension: string;
  /** Minimum value in physical units. */
  readonly physicalMin: number;
  /** Maximum value in physical units. */
  readonly physicalMax: number;
  /** Minimum value in digital (raw integer) units. */
  readonly digitalMin: number;
  /** Maximum value in digital (raw integer) units. */
  readonly digitalMax: number;
  /** Pre-filtering description. */
  readonly prefiltering: string;
  /** Number of samples in each data record. */
  readonly samplesPerRecord: number;
  /** Computed sample rate in Hz (samplesPerRecord / dataRecordDuration). */
  readonly sampleRate: number;
  /** All samples converted to physical units. */
  readonly samples: Float32Array;
}

/** Parsed EDF+ annotation (TAL format). */
export interface EDFAnnotation {
  /** Onset time in seconds from recording start. */
  readonly onset: number;
  /** Duration in seconds (0 for instantaneous events). */
  readonly duration: number;
  /** Annotation label strings. */
  readonly labels: readonly string[];
}
