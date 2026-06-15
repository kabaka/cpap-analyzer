/**
 * Session and related types for CPAP therapy data.
 *
 * A Session represents one night of CPAP data, including metadata
 * about the machine, timing, and available signal channels.
 */

/** Supported CPAP machine therapy modes. */
export type MachineType = 'cpap' | 'apap' | 'bipap' | 'vpap' | 'asv';

/**
 * Machine configuration settings extracted from the STR.edf summary file.
 *
 * Each field is nullable because settings may not be present in all
 * firmware versions or machine models.
 */
export interface MachineSettings {
  /** Configured minimum pressure in cmH2O (APAP lower bound). */
  readonly minPressure: number | null;
  /** Configured maximum pressure in cmH2O (APAP upper bound). */
  readonly maxPressure: number | null;
  /** EPR (Expiratory Pressure Relief) level, 0–3. */
  readonly eprLevel: number | null;
  /** EPR application type. */
  readonly eprType: string | null;
  /** Ramp time in minutes (0 = auto, -1 = off). */
  readonly rampTime: number | null;
  /** Ramp start pressure in cmH2O. */
  readonly rampPressure: number | null;
  /** Therapy mode string (e.g., 'CPAP', 'APAP', 'BiPAP'). */
  readonly therapyMode: string | null;
  /** Mask type setting. */
  readonly maskType: string | null;
  /** Humidifier level, 0–8. */
  readonly humidifierLevel: number | null;
  /** Whether automatic climate control is enabled. */
  readonly climateControl: boolean | null;
  /** Whether an antibacterial filter is installed. */
  readonly antibacterialFilter: boolean | null;
  /** Whether SmartStart (auto-start on breathing) is enabled. */
  readonly smartStart: boolean | null;
}

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
  /** Machine configuration settings from STR.edf; null if STR data unavailable. */
  readonly machineSettings: MachineSettings | null;
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
  /**
   * Apnea-Hypopnea Index: (obstructive + central + mixed apneas + hypopneas)
   * per hour of usage. Per AASM 2012 / ICSD-3, AHI EXCLUDES RERAs — those
   * belong to the RDI (see {@link rdi}). Computed over usage hours (mask-on
   * time), matching the residual-AHI convention CPAP machines report.
   */
  readonly ahi: number;
  /**
   * Respiratory Disturbance Index: AHI + RERA index (events/hour). RDI =
   * (apneas + hypopneas + RERAs) / usage hours. Always ≥ {@link ahi}. RERA
   * detection on CPAP is flow-based and approximate (no EEG arousal), so RDI
   * is a lower bound on the polysomnographic RDI. Equals `ahi` when no RERAs
   * are scored.
   *
   * Optional ONLY for backward compatibility with aggregates persisted before
   * this field existed (and hand-built test fixtures). `SessionBuilder` always
   * populates it; consumers that may read legacy records should fall back to
   * `ahi + ahiRera`.
   */
  readonly rdi?: number;
  /** Obstructive apnea index. */
  readonly ahiObstructive: number;
  /** Central apnea index. */
  readonly ahiCentral: number;
  /** Mixed apnea index. */
  readonly ahiMixed: number;
  /**
   * Unclassified apnea index (events/hour) — apneas the device confirmed but
   * could not resolve as obstructive or central (most often under high leak,
   * when the forced-oscillation measurement is unreliable). Counts toward AHI.
   * Optional for backward compatibility with aggregates persisted before this
   * field existed; treat a missing value as 0.
   */
  readonly ahiUnclassified?: number;
  /** Hypopnea index. */
  readonly ahiHypopnea: number;
  /** RERA index (events/hour). Part of RDI, NOT part of AHI. */
  readonly ahiRera: number;

  // Event counts
  /** Total event count. */
  readonly eventCount: number;
  /** Event counts broken down by type. */
  readonly eventsByType: {
    readonly obstructive: number;
    readonly central: number;
    readonly mixed: number;
    /** Unclassified apnea count (optional; treat missing as 0). */
    readonly unclassified?: number;
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
  /**
   * T90: percentage of analyzed oximetry TIME (not samples) with SpO₂ < 90%.
   * Computed as (time below 90% / valid-SpO₂ time) × 100 using the channel
   * sample rate. Dropout periods (sentinel 0 = no finger/probe) are excluded
   * from both numerator and denominator. See {@link spo2CoveragePercent} for
   * how much of the session actually had valid oximetry.
   */
  readonly spo2Below90Percent: number | null;
  /**
   * SpO₂ coverage: percentage of the session duration that had valid (non-
   * sentinel) oximetry samples. Low coverage means T90/ODI are based on a
   * small slice of the night and should be interpreted with caution. Null if
   * no oximetry channel is present.
   *
   * Optional ONLY for backward compatibility with aggregates persisted before
   * this field existed (and hand-built test fixtures). `SessionBuilder` always
   * sets it (to a number or null).
   */
  readonly spo2CoveragePercent?: number | null;
  /**
   * Oxygen Desaturation Index: discrete desaturation EVENTS per hour of valid
   * oximetry time. A desaturation event is a ≥3% SpO₂ fall from a rolling
   * baseline reaching a nadir and lasting ≥10 s, counted once per event
   * (AASM SpO₂ desaturation scoring). NOT a per-sample drop count.
   */
  readonly oxygenDesaturationIndex: number | null;

  // Usage
  /** Total usage in hours. */
  readonly usageHours: number;
  /** Total mask-on time in minutes. */
  readonly maskOnTimeMinutes: number;
  /** CMS compliance status. */
  readonly complianceStatus: 'compliant' | 'non-compliant' | 'partial';

  // Configured machine settings (from STR.edf)
  /** Configured minimum pressure (cmH2O); null if STR data unavailable. */
  readonly configuredMinPressure: number | null;
  /** Configured maximum pressure (cmH2O); null if STR data unavailable. */
  readonly configuredMaxPressure: number | null;
  /** EPR level (0–3); null if STR data unavailable. */
  readonly eprLevel: number | null;

  // User notes
  /** Free-text notes for this night. */
  readonly notes: string;
  /** User-defined tags. */
  readonly tags: string[];
}
