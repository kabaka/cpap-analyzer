/**
 * Data validation for EDF files and parsed sessions.
 *
 * Performs:
 * - EDF header integrity checks
 * - Physiological range validation per channel
 * - AASM event duration compliance
 * - AHI sanity checks
 * - Session duration minimum checks
 */

import type { EventType } from '@/types/events';
import type { EDFFile } from '../edf/types';
import type { BuildResult } from '../resmed/SessionBuilder';

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

/** A single validation issue (error or warning). */
export interface ValidationIssue {
  /** Machine-readable issue code. */
  readonly code: string;
  /** Human-readable description. */
  readonly message: string;
  /** Optional debugging context. */
  readonly context?: Readonly<Record<string, string | number | boolean>>;
}

/** Result of validation. */
export interface ValidationResult {
  /** Whether the data is structurally valid (no hard errors). */
  readonly isValid: boolean;
  /** Hard errors that indicate corrupt or unusable data. */
  readonly errors: readonly ValidationIssue[];
  /** Soft warnings that indicate anomalies without blocking use. */
  readonly warnings: readonly ValidationIssue[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Acceptable physiological ranges per channel [min, max]. */
const PHYSIOLOGICAL_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  flow: [-300, 300],
  maskPressure: [0, 30],
  pressure: [0, 40],
  eprPressure: [0, 30],
  leak: [0, 200],
  tidalVolume: [0, 3000],
  minuteVent: [0, 50],
  respRate: [0, 60],
  epap: [4, 25],
  ipap: [4, 30],
  spo2: [50, 100],
  pulse: [30, 250],
  snore: [0, 100],
  flowLimitation: [0, 1],
};

/** Minimum AASM apnea duration in seconds. */
const MIN_APNEA_DURATION = 10;

/** Maximum sane AHI value. */
const MAX_SANE_AHI = 200;

/** Minimum session duration in minutes (30 minutes). */
const MIN_SESSION_DURATION_MINUTES = 30;

/** Apnea event types subject to duration checks. */
const APNEA_EVENT_TYPES: ReadonlySet<EventType> = new Set([
  'ObstructiveApnea',
  'CentralApnea',
  'MixedApnea',
]);

// ---------------------------------------------------------------------------
// Validator class
// ---------------------------------------------------------------------------

/**
 * Validates EDF file structure and parsed session data quality.
 *
 * Usage:
 * ```ts
 * const validator = new Validator();
 * const edfResult = validator.validateEDF(edfFile);
 * const sessionResult = validator.validateSession(buildResult);
 * ```
 */
export class Validator {
  /**
   * Validate a parsed EDF file for structural integrity.
   *
   * Checks header field consistency, signal metadata ranges,
   * and basic data record integrity.
   *
   * @param edfFile - Parsed EDF file structure.
   * @returns Validation result.
   */
  validateEDF(edfFile: EDFFile): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // Version check
    if (edfFile.header.version !== '0') {
      errors.push({
        code: 'INVALID_VERSION',
        message: `Unexpected EDF version: "${edfFile.header.version}"`,
      });
    }

    // Header byte count consistency
    const expectedHeaderBytes = 256 + 256 * edfFile.header.numSignals;
    if (edfFile.header.headerBytes !== expectedHeaderBytes) {
      errors.push({
        code: 'HEADER_SIZE_MISMATCH',
        message: `Header byte count ${edfFile.header.headerBytes} != expected ${expectedHeaderBytes}`,
        context: {
          actual: edfFile.header.headerBytes,
          expected: expectedHeaderBytes,
        },
      });
    }

    // Number of data records
    if (edfFile.header.numDataRecords < 0 && edfFile.header.numDataRecords !== -1) {
      errors.push({
        code: 'INVALID_NUM_RECORDS',
        message: `Invalid number of data records: ${edfFile.header.numDataRecords}`,
      });
    }

    // Data record duration (0 is valid for EDF+ annotation-only files)
    if (edfFile.header.dataRecordDuration < 0) {
      errors.push({
        code: 'INVALID_RECORD_DURATION',
        message: `Data record duration must be non-negative: ${edfFile.header.dataRecordDuration}`,
      });
    }

    // Signal count
    if (edfFile.signals.length !== edfFile.header.numSignals) {
      errors.push({
        code: 'SIGNAL_COUNT_MISMATCH',
        message: `Expected ${edfFile.header.numSignals} signals, got ${edfFile.signals.length}`,
      });
    }

    // Per-signal checks
    for (const signal of edfFile.signals) {
      // Digital range
      if (signal.digitalMin >= signal.digitalMax) {
        errors.push({
          code: 'INVALID_DIGITAL_RANGE',
          message: `Signal "${signal.label}": digitalMin (${signal.digitalMin}) >= digitalMax (${signal.digitalMax})`,
        });
      }

      // Physical range sanity (allow equal for annotation signals)
      if (signal.label !== 'EDF Annotations' && signal.physicalMin > signal.physicalMax) {
        warnings.push({
          code: 'INVALID_PHYSICAL_RANGE',
          message: `Signal "${signal.label}": physicalMin (${signal.physicalMin}) > physicalMax (${signal.physicalMax})`,
        });
      }

      // Samples per record
      if (signal.samplesPerRecord <= 0) {
        errors.push({
          code: 'INVALID_SAMPLES_PER_RECORD',
          message: `Signal "${signal.label}": samplesPerRecord must be positive: ${signal.samplesPerRecord}`,
        });
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate a built session for physiological plausibility.
   *
   * Checks channel value ranges, event durations, AHI sanity,
   * and session duration minimums.
   *
   * @param buildResult - Result from `SessionBuilder`.
   * @returns Validation result.
   */
  validateSession(buildResult: BuildResult): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const { session, aggregate, events } = buildResult;

    // Physiological range validation per channel
    for (const channel of session.channels) {
      const range = PHYSIOLOGICAL_RANGES[channel.name];
      if (!range) continue;

      const [min, max] = range;
      // We don't have sample data on the Session type,
      // so range checks are done at the EDF/interpretation level.
      // Check that declared physical range is within physiological limits.
      if (channel.physicalMin < min || channel.physicalMax > max) {
        warnings.push({
          code: 'DECLARED_RANGE_EXCEEDS_PHYSIOLOGICAL',
          message: `Channel "${channel.name}" declared range [${channel.physicalMin}, ${channel.physicalMax}] exceeds physiological [${min}, ${max}]`,
          context: {
            channel: channel.name,
            declaredMin: channel.physicalMin,
            declaredMax: channel.physicalMax,
          },
        });
      }
    }

    // AASM event duration compliance
    for (const event of events) {
      if (APNEA_EVENT_TYPES.has(event.type) && event.duration < MIN_APNEA_DURATION) {
        warnings.push({
          code: 'SHORT_APNEA',
          message: `${event.type} event duration ${event.duration}s < ${MIN_APNEA_DURATION}s (AASM minimum)`,
          context: { eventType: event.type, duration: event.duration },
        });
      }
    }

    // AHI sanity check
    if (aggregate.ahi > MAX_SANE_AHI) {
      warnings.push({
        code: 'HIGH_AHI',
        message: `Computed AHI ${aggregate.ahi.toFixed(1)} exceeds ${MAX_SANE_AHI}, possible data error`,
        context: { ahi: aggregate.ahi },
      });
    }

    // Session duration minimum
    if (session.durationMinutes < MIN_SESSION_DURATION_MINUTES) {
      warnings.push({
        code: 'SHORT_SESSION',
        message: `Session duration ${session.durationMinutes.toFixed(1)} min < ${MIN_SESSION_DURATION_MINUTES} min minimum`,
        context: { durationMinutes: session.durationMinutes },
      });
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate signal sample data against physiological ranges.
   *
   * This is a heavier check that scans actual sample values.
   * Use when you have access to the raw Float32Array data.
   *
   * @param channelName - Standard channel name.
   * @param samples - Signal sample data in physical units.
   * @returns Validation result.
   */
  validateSignalData(channelName: string, samples: Float32Array): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const range = PHYSIOLOGICAL_RANGES[channelName];
    if (!range) {
      return { isValid: true, errors, warnings };
    }

    const [min, max] = range;
    let outOfRangeCount = 0;
    let firstOutOfRange: number | undefined;

    for (let i = 0; i < samples.length; i++) {
      const value = samples[i] ?? 0;
      if (value < min || value > max) {
        outOfRangeCount++;
        if (firstOutOfRange === undefined) {
          firstOutOfRange = i;
        }
      }
    }

    if (outOfRangeCount > 0) {
      const percentage = ((outOfRangeCount / samples.length) * 100).toFixed(2);
      warnings.push({
        code: 'OUT_OF_RANGE',
        message: `${channelName}: ${outOfRangeCount} samples (${percentage}%) out of physiological range [${min}, ${max}]`,
        context: {
          channel: channelName,
          outOfRangeCount,
          firstIndex: firstOutOfRange ?? 0,
          totalSamples: samples.length,
        },
      });
    }

    return { isValid: true, errors, warnings };
  }
}
