/**
 * Session and related types for CPAP therapy data.
 *
 * A Session represents one night of CPAP data, including metadata
 * about the machine, timing, and available signal channels.
 */

/** Supported CPAP machine therapy modes. */
export type MachineType = 'cpap' | 'apap' | 'bipap' | 'vpap' | 'asv';

/**
 * Describes one signal channel within an EDF recording.
 *
 * Each channel contains the metadata needed to interpret the
 * corresponding time-series signal data stored in OPFS.
 */
export interface ChannelMetadata {
  /** Channel name (e.g., "Flow", "MaskPress"). */
  readonly name: string;
  /** Sample rate in Hz. */
  readonly sampleRate: number;
  /** Physical unit of measurement (e.g., "cmH2O", "L/min"). */
  readonly unit: string;
  /** Minimum value in physical units. */
  readonly physicalMin: number;
  /** Maximum value in physical units. */
  readonly physicalMax: number;
  /** EDF digital minimum. */
  readonly digitalMin: number;
  /** EDF digital maximum. */
  readonly digitalMax: number;
}

/**
 * Represents one night of CPAP therapy data.
 *
 * Each session corresponds to a single recording period (typically one night)
 * and includes metadata about the machine, timing, and available channels.
 */
export interface Session {
  /** UUID v4 identifier. */
  readonly id: string;
  /** Machine serial number. */
  readonly machineId: string;
  /** Machine model name (e.g., "AirSense 10 AutoSet"). */
  readonly machineModel: string;
  /** Machine therapy mode. */
  readonly machineType: MachineType;
  /** Firmware version string (e.g., "3.0.2"). */
  readonly firmwareVersion: string;
  /** ISO date string in YYYY-MM-DD format (local date). */
  readonly date: string;
  /** ISO 8601 timestamp marking the start of the recording. */
  readonly startTime: string;
  /** ISO 8601 timestamp marking the end of the recording. */
  readonly endTime: string;
  /** Total session duration in minutes. */
  readonly durationMinutes: number;
  /** Actual usage time in minutes (may differ if mask removed). */
  readonly usageMinutes: number;
  /** ISO 8601 timestamp when this session was imported. */
  readonly importedAt: string;
  /** SHA-256 hash of source EDF files (concatenated), used for deduplication. */
  readonly sourceHash: string;
  /** Available signal channels in this session's recording. */
  readonly channels: ChannelMetadata[];
  /** OPFS chunk file references for raw signal data. */
  readonly signalChunkIds: string[];
  /** Whether SpO2 oximetry data is available. */
  readonly hasOximetry: boolean;
  /** Soft delete flag. */
  readonly deleted: boolean;
}

/**
 * Computed summary statistics for one therapy session.
 *
 * All metrics are stored flat (not nested) for efficient IndexedDB
 * indexing and direct query access.
 */
export interface NightlyAggregate {
  /** UUID v4 identifier. */
  readonly id: string;
  /** Foreign key to sessions.id. */
  readonly sessionId: string;
  /** Machine serial number, denormalized for efficient queries. */
  readonly machineId: string;
  /** ISO date string in YYYY-MM-DD format. */
  readonly date: string;

  // AHI metrics (events/hour)
  /** Total Apnea-Hypopnea Index. */
  readonly ahi: number;
  /** Obstructive apnea index. */
  readonly ahiObstructive: number;
  /** Central apnea index. */
  readonly ahiCentral: number;
  /** Mixed apnea index. */
  readonly ahiMixed: number;
  /** Hypopnea index. */
  readonly ahiHypopnea: number;
  /** RERA index. */
  readonly ahiRera: number;

  // Event counts
  /** Total event count. */
  readonly eventCount: number;
  /** Event counts broken down by type. */
  readonly eventsByType: {
    readonly obstructive: number;
    readonly central: number;
    readonly mixed: number;
    readonly hypopnea: number;
    readonly rera: number;
    readonly flowLimitation: number;
    readonly largeLeak: number;
    readonly periodicBreathing: number;
  };

  // Pressure metrics (cmH2O)
  /** Mean therapy pressure. */
  readonly pressureMean: number;
  /** Median therapy pressure. */
  readonly pressureMedian: number;
  /** 95th percentile therapy pressure. */
  readonly pressureP95: number;
  /** Maximum therapy pressure. */
  readonly pressureMax: number;
  /** Median EPAP; null for fixed-pressure CPAP. */
  readonly epapMedian: number | null;
  /** Median IPAP; null for CPAP (BiPAP only). */
  readonly ipapMedian: number | null;
  /** Pressure support (IPAP - EPAP); null for CPAP. */
  readonly pressureSupport: number | null;

  // Leak metrics (L/min)
  /** Median leak rate. */
  readonly leakMedian: number;
  /** 95th percentile leak rate. */
  readonly leakP95: number;
  /** Maximum leak rate. */
  readonly leakMax: number;
  /** Duration with leak > 24 L/min, in minutes. */
  readonly leakDurationMinutes: number;

  // Respiratory metrics
  /** Mean tidal volume; null if unavailable. */
  readonly tidalVolumeMean: number | null;
  /** Median tidal volume; null if unavailable. */
  readonly tidalVolumeMedian: number | null;
  /** Mean minute ventilation; null if unavailable. */
  readonly minuteVentMean: number | null;
  /** Mean respiratory rate; null if unavailable. */
  readonly respRateMean: number | null;
  /** Median respiratory rate; null if unavailable. */
  readonly respRateMedian: number | null;

  // Oximetry (null if no oximeter data)
  /** Mean SpO2 percentage. */
  readonly spo2Mean: number | null;
  /** Median SpO2 percentage. */
  readonly spo2Median: number | null;
  /** Minimum SpO2 percentage. */
  readonly spo2Min: number | null;
  /** Percentage of time SpO2 was below 90%. */
  readonly spo2Below90Percent: number | null;
  /** Oxygen Desaturation Index. */
  readonly oxygenDesaturationIndex: number | null;

  // Usage
  /** Total usage in hours. */
  readonly usageHours: number;
  /** Total mask-on time in minutes. */
  readonly maskOnTimeMinutes: number;
  /** CMS compliance status. */
  readonly complianceStatus: 'compliant' | 'non-compliant' | 'partial';

  // User notes
  /** Free-text notes for this night. */
  readonly notes: string;
  /** User-defined tags. */
  readonly tags: string[];
}
