/**
 * ResMed-specific EDF interpreter.
 *
 * Transforms generic EDF parsed data into ResMed domain objects by:
 * - Normalizing channel labels to standard internal names
 * - Mapping event annotations to PascalCase `EventType` values
 * - Extracting machine identification from the patient ID field
 * - Detecting machine capabilities from the model name
 */

import type { EventType } from '@/types/events';
import type { MachineType, ChannelMetadata } from '@/types/session';
import type { EDFFile, EDFAnnotation } from '../edf/types';

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

/** Machine identification extracted from EDF patient ID. */
export interface MachineInfo {
  /** Machine serial number. */
  readonly serialNumber: string;
  /** Full model name (e.g., "AirSense 10 AutoSet"). */
  readonly model: string;
  /** Detected machine series. */
  readonly series: 'AirSense 10' | 'AirSense 11' | 'AirCurve 10' | 'Unknown';
  /** Firmware version (from recording ID, or "Unknown"). */
  readonly firmwareVersion: string;
  /** Detected therapy mode. */
  readonly machineType: MachineType;
}

/** Capability flags for a ResMed machine model. */
export interface MachineCapabilities {
  /** Whether the machine supports auto-adjusting CPAP. */
  readonly hasAutoCPAP: boolean;
  /** Whether the machine supports bilevel therapy. */
  readonly hasBilevel: boolean;
  /** Whether the machine has an IPAP channel. */
  readonly hasIPAPChannel: boolean;
  /** Whether the machine supports pressure support. */
  readonly hasPressureSupport: boolean;
  /** Whether the machine supports adaptive servo-ventilation. */
  readonly hasServoControl: boolean;
  /** Whether the machine tracks flow limitation. */
  readonly hasFlowLimitation: boolean;
}

/** A normalized channel with standard name and domain metadata. */
export interface StandardChannel {
  /** Standardized channel name (e.g., "flow", "maskPressure"). */
  readonly name: string;
  /** Physical unit of measurement. */
  readonly unit: string;
  /** Sample rate in Hz. */
  readonly sampleRate: number;
  /** All samples in physical units. */
  readonly samples: Float32Array;
  /** Domain-level channel metadata. */
  readonly metadata: ChannelMetadata;
}

/** A normalized therapy event mapped to the domain EventType. */
export interface StandardEvent {
  /** Domain event type (PascalCase). */
  readonly type: EventType;
  /** Onset time in seconds from the recording start. */
  readonly onset: number;
  /** Duration in seconds. */
  readonly duration: number;
  /** Raw annotation labels from the EDF file. */
  readonly rawLabels: readonly string[];
}

/** Result of interpreting an EDF file through the ResMed lens. */
export interface ResMedInterpretation {
  /** Machine identification. */
  readonly machineInfo: MachineInfo;
  /** Machine capability flags. */
  readonly capabilities: MachineCapabilities;
  /** Recording start time. */
  readonly startTime: Date;
  /** Total duration in seconds. */
  readonly duration: number;
  /** Normalized channels with standard names. */
  readonly channels: readonly StandardChannel[];
  /** Normalized therapy events. */
  readonly events: readonly StandardEvent[];
  /** Channel labels that were not recognized. */
  readonly unknownLabels: readonly string[];
  /** Event annotations that were not recognized. */
  readonly unknownEvents: readonly string[];
}

// ---------------------------------------------------------------------------
// Channel label normalization map
// ---------------------------------------------------------------------------

/** Maps lowercase/trimmed ResMed labels to standard internal names. */
const CHANNEL_MAP: ReadonlyMap<string, string> = new Map([
  ['flow', 'flow'],
  ['maskpressure', 'maskPressure'],
  ['mask pressure', 'maskPressure'],
  ['pmask', 'maskPressure'],
  ['leak', 'leak'],
  ['tidal volume', 'tidalVolume'],
  ['minute vent', 'minuteVent'],
  ['minutevent', 'minuteVent'],
  ['resp. rate', 'respRate'],
  ['resp rate', 'respRate'],
  ['respiratory rate', 'respRate'],
  ['resprate', 'respRate'],
  ['epap', 'epap'],
  ['ipap', 'ipap'],
  ['spo2', 'spo2'],
  ['pulse', 'pulse'],
  ['snore', 'snore'],
  // AirSense 11 suffixed labels (sampling interval appended)
  ['flow.40ms', 'flow'],
  ['press.40ms', 'pressure'],
  ['maskpress.2s', 'maskPressure'],
  ['press.2s', 'pressure'],
  ['eprpress.2s', 'eprPressure'],
  ['leak.2s', 'leak'],
  ['resprate.2s', 'respRate'],
  ['tidvol.2s', 'tidalVolume'],
  ['minvent.2s', 'minuteVent'],
  ['snore.2s', 'snore'],
  ['flowlim.2s', 'flowLimitation'],
  ['pulse.1s', 'pulse'],
  ['spo2.1s', 'spo2'],
  // Additional standard names
  ['pressure', 'pressure'],
  ['press', 'pressure'],
  ['eprpressure', 'eprPressure'],
  ['eprpress', 'eprPressure'],
  ['flowlimitation', 'flowLimitation'],
  ['flowlim', 'flowLimitation'],
  ['tidvol', 'tidalVolume'],
  ['minvent', 'minuteVent'],
]);

// ---------------------------------------------------------------------------
// Event annotation mapping
// ---------------------------------------------------------------------------

/**
 * Maps ResMed annotation text to PascalCase EventType values.
 * Order matters: more specific patterns are checked first.
 */
const EVENT_MAP: ReadonlyArray<readonly [RegExp, EventType]> = [
  [/obstructive apnea/i, 'ObstructiveApnea'],
  [/obstructive/i, 'ObstructiveApnea'],
  [/central apnea/i, 'CentralApnea'],
  [/clear airway/i, 'CentralApnea'],
  [/central/i, 'CentralApnea'],
  [/mixed apnea/i, 'MixedApnea'],
  // Generic "Apnea" with no qualifier — classified as mixed per AASM guidelines
  [/^apnea$/i, 'MixedApnea'],
  [/hypopnea/i, 'Hypopnea'],
  [/flow limitation/i, 'FlowLimitation'],
  [/rera/i, 'RERA'],
  [/large leak/i, 'LargeLeak'],
  [/periodic breathing/i, 'PeriodicBreathing'],
  [/vibratory snore/i, 'Vibratory'],
  [/snore/i, 'Vibratory'],
];

/** EDF+ annotation signal label. */
const ANNOTATION_LABEL = 'EDF Annotations';

/** Annotations to silently skip (EDF+ timekeeping / session markers). */
const SKIP_ANNOTATIONS: ReadonlyArray<RegExp> = [/^recording starts?$/i, /^recording ends?$/i];

// ---------------------------------------------------------------------------
// Interpreter class
// ---------------------------------------------------------------------------

/**
 * Interprets parsed EDF files in the context of ResMed CPAP machines.
 *
 * Usage:
 * ```ts
 * const interpreter = new ResMedInterpreter();
 * const result = interpreter.interpret(edfFile);
 * ```
 */
export class ResMedInterpreter {
  /**
   * Interpret a parsed EDF file as ResMed data.
   *
   * @param edfFile - Parsed EDF file from `EDFParser.parse()`.
   * @returns ResMed-specific interpretation with normalized channels and events.
   */
  interpret(edfFile: EDFFile): ResMedInterpretation {
    const machineInfo = this.extractMachineInfo(
      edfFile.header.patientId,
      edfFile.header.recordingId,
    );
    const capabilities = this.getMachineCapabilities(machineInfo.model);

    const channels: StandardChannel[] = [];
    const unknownLabels: string[] = [];

    for (const signal of edfFile.signals) {
      // Skip annotation signals
      if (signal.label === ANNOTATION_LABEL) continue;

      const standardName = this.normalizeChannelLabel(signal.label);
      if (standardName === null) {
        unknownLabels.push(signal.label);
        continue;
      }

      // Convert leak from L/s to L/min for downstream consistency
      let samples = signal.samples;
      let unit = signal.physicalDimension;
      if (standardName === 'leak' && /^l\/s$/i.test(signal.physicalDimension)) {
        const converted = new Float32Array(signal.samples.length);
        for (let i = 0; i < signal.samples.length; i++) {
          converted[i] = (signal.samples[i] ?? 0) * 60;
        }
        samples = converted;
        unit = 'L/min';
      }

      channels.push({
        name: standardName,
        unit,
        sampleRate: signal.sampleRate,
        samples,
        metadata: {
          name: standardName,
          sampleRate: signal.sampleRate,
          unit,
          physicalMin: signal.physicalMin,
          physicalMax: signal.physicalMax,
          digitalMin: signal.digitalMin,
          digitalMax: signal.digitalMax,
        },
      });
    }

    const events: StandardEvent[] = [];
    const unknownEvents: string[] = [];

    if (edfFile.annotations) {
      for (const ann of edfFile.annotations) {
        this.processAnnotation(ann, events, unknownEvents);
      }
    }

    const duration = edfFile.duration;

    return {
      machineInfo,
      capabilities,
      startTime: edfFile.startTime,
      duration,
      channels,
      events,
      unknownLabels,
      unknownEvents,
    };
  }

  /**
   * Extract machine identification from EDF header fields.
   *
   * Prefers structured key-value data from recordingId (SRN=, MID=, VID=).
   * Falls back to legacy format: patientId = "[SerialNumber] [ModelName]".
   *
   * @param patientId - EDF patient identification string.
   * @param recordingId - EDF recording identification string.
   * @returns Parsed machine info.
   */
  extractMachineInfo(patientId: string, recordingId: string = ''): MachineInfo {
    // Try to parse structured recordingId first (AirSense 11 format):
    // "Startdate 18-SEP-2024 X X X SRN=23241654214  MID=36  VID=39"
    const srnMatch = recordingId.match(/SRN=(\S+)/i);
    const midMatch = recordingId.match(/MID=(\d+)/i);
    const vidMatch = recordingId.match(/VID=(\d+)/i);

    let serialNumber: string;
    let model: string;
    let series: MachineInfo['series'] = 'Unknown';

    if (srnMatch?.[1]) {
      serialNumber = srnMatch[1];

      const mid = midMatch?.[1] ? parseInt(midMatch[1], 10) : undefined;
      const vid = vidMatch?.[1] ? parseInt(vidMatch[1], 10) : undefined;

      // Determine series and model from MID
      if (mid !== undefined) {
        if (mid >= 30 && mid <= 39) {
          series = 'AirSense 11';
        } else if (mid >= 20 && mid <= 29) {
          series = 'AirSense 10';
        } else if (mid >= 40 && mid <= 49) {
          series = 'AirCurve 10';
        }
        model = `ResMed MID=${mid}${vid !== undefined ? ` VID=${vid}` : ''}`;
      } else {
        model = 'Unknown';
      }
    } else {
      // Fallback: legacy format patientId = "[SerialNumber] [ModelName]"
      const tokens = patientId.trim().split(/\s+/);
      serialNumber = tokens[0] ?? 'Unknown';
      model = tokens.length > 1 ? tokens.slice(1).join(' ') : 'Unknown';
    }

    // Detect series from model string if not already detected via MID
    if (series === 'Unknown') {
      if (/AirSense\s*10/i.test(model)) {
        series = 'AirSense 10';
      } else if (/AirSense\s*11/i.test(model)) {
        series = 'AirSense 11';
      } else if (/AirCurve/i.test(model)) {
        series = 'AirCurve 10';
      }
    }

    const machineType = this.detectMachineType(model);
    const firmwareVersion = this.extractFirmwareVersion(recordingId);

    return { serialNumber, model, series, firmwareVersion, machineType };
  }

  /**
   * Determine machine capabilities from the model name.
   *
   * @param model - Machine model name string.
   * @returns Capability flags.
   */
  getMachineCapabilities(model: string): MachineCapabilities {
    const hasAutoCPAP = /AutoSet|Auto/i.test(model);
    const hasBilevel = /VPAP|VAuto|ST|ASV/i.test(model);
    const hasIPAPChannel = hasBilevel;
    const hasPressureSupport = hasBilevel;
    const hasServoControl = /ASV/i.test(model);
    const hasFlowLimitation = true; // All ResMed models track flow limitation

    return {
      hasAutoCPAP,
      hasBilevel,
      hasIPAPChannel,
      hasPressureSupport,
      hasServoControl,
      hasFlowLimitation,
    };
  }

  /**
   * Normalize a raw EDF channel label to a standard internal name.
   *
   * @param label - Raw label from the EDF signal header.
   * @returns Standard name or `null` if unrecognized (or explicitly skipped like Crc16).
   */
  normalizeChannelLabel(label: string): string | null {
    const normalized = label.toLowerCase().trim();

    // Explicitly skip CRC checksum signals
    if (/^crc16$/i.test(normalized)) {
      return null;
    }

    // Exact match first
    const exact = CHANNEL_MAP.get(normalized);
    if (exact !== undefined) {
      return exact;
    }

    // Fallback: strip sampling-interval suffix (e.g., ".40ms", ".2s", ".1s")
    const stripped = normalized.replace(/\.\d+m?s$/i, '');
    if (stripped !== normalized) {
      const fallback = CHANNEL_MAP.get(stripped);
      if (fallback !== undefined) {
        return fallback;
      }
    }

    return null;
  }

  /**
   * Map a raw annotation label to a domain EventType.
   *
   * @param label - Raw annotation text from the EDF file.
   * @returns Domain EventType or `null` if unrecognized.
   */
  mapEventLabel(label: string): EventType | null {
    for (const [pattern, type] of EVENT_MAP) {
      if (pattern.test(label)) {
        return type;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Detect the therapy mode (MachineType) from the model name.
   */
  private detectMachineType(model: string): MachineType {
    if (/ASV/i.test(model)) return 'asv';
    if (/VPAP/i.test(model)) return 'vpap';
    if (/VAuto|ST/i.test(model)) return 'bipap';
    if (/AutoSet|Auto/i.test(model)) return 'apap';
    if (/Elite|CPAP|for Her/i.test(model)) return 'cpap';
    // Default to CPAP for unknown models
    return 'cpap';
  }

  /**
   * Extract firmware version from the recording ID if present.
   */
  private extractFirmwareVersion(recordingId: string): string {
    // ResMed sometimes includes firmware info in the recording ID
    const match = recordingId.match(/(?:FW|Firmware)\s*[:=]?\s*([\d.]+)/i);
    if (match?.[1]) {
      return match[1];
    }
    return 'Unknown';
  }

  /**
   * Process a single EDF annotation, mapping labels to events.
   * Skips EDF+ timekeeping annotations (e.g., "Recording starts").
   */
  private processAnnotation(
    annotation: EDFAnnotation,
    events: StandardEvent[],
    unknownEvents: string[],
  ): void {
    for (const label of annotation.labels) {
      // Skip known non-event annotations
      if (SKIP_ANNOTATIONS.some((pattern) => pattern.test(label))) {
        continue;
      }

      const type = this.mapEventLabel(label);
      if (type !== null) {
        events.push({
          type,
          onset: annotation.onset,
          duration: annotation.duration,
          rawLabels: annotation.labels,
        });
      } else {
        unknownEvents.push(label);
      }
    }
  }
}
