/**
 * Parser for ResMed STR.edf summary files.
 *
 * The top-level STR.edf on a ResMed SD card contains one EDF data record
 * per calendar day. Each record stores machine configuration settings
 * (channels prefixed with `S.`) and per-day session summary statistics
 * (AHI, usage hours, pressure percentiles, etc.).
 *
 * This parser extracts machine settings from STR data and indexes them
 * by date so the SessionBuilder can attach the correct configuration
 * to each therapy session.
 *
 * Key STR channel naming conventions (AirSense 10/11):
 * - `S.AS.MinPress`  / `S.AS.MaxPress` — APAP pressure range
 * - `S.C.Press`      — Fixed CPAP pressure
 * - `S.EPR.Level`    / `S.EPR.EPRType` — EPR settings
 * - `S.RampTime`     / `S.C.StartPress` / `S.AS.StartPress` — Ramp config
 * - `S.Mask`         — Mask type
 * - `S.SmartStart`   — Auto-start on breathing
 * - `S.ABFilter`     — Antibacterial filter
 * - `S.ClimateControl` — Auto climate control
 * - `S.HumLevel`     — Humidifier level
 * - `Mode`           — Therapy mode
 * - `Date`           — Day index (EDF days since a reference epoch)
 *
 * @module parsers/resmed/STRParser
 */

import type { MachineSettings } from '@/types/session';
import type { ResMedInterpretation, StandardChannel } from './ResMedInterpreter';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Machine settings for one day, indexed by ISO date string. */
export interface STRDayRecord {
  /** ISO date string YYYY-MM-DD. */
  readonly date: string;
  /** Extracted machine settings for this day. */
  readonly settings: MachineSettings;
}

/**
 * A single mask-on/mask-off interval recorded by the machine.
 *
 * Derived from the STR.edf `MaskOn` / `MaskOff` channels, which store up to 10
 * intervals per day as minutes-of-day (0–1440); unused slots are the sentinel
 * `-1`. `start`/`end` are absolute wall-clock times (local), with `end` always
 * ≥ `start`.
 */
export interface MaskInterval {
  /** Mask-on (therapy start) time. */
  readonly start: Date;
  /** Mask-off (therapy stop) time. */
  readonly end: Date;
}

/** Result of parsing an STR.edf interpretation. */
export interface STRParseResult {
  /** Map from ISO date string to machine settings. */
  readonly settingsByDate: ReadonlyMap<string, MachineSettings>;
  /**
   * Map from ISO date string (the STR day-record's calendar date) to the
   * machine-recorded mask-on/off intervals for that day. Empty array for days
   * with no usage. Empty map if the STR file lacks MaskOn/MaskOff channels
   * (older firmware) — callers must fall back to pressure-based detection.
   */
  readonly maskIntervalsByDate: ReadonlyMap<string, MaskInterval[]>;
}

/** Sentinel value for unused MaskOn/MaskOff slots. */
const MASK_SLOT_SENTINEL = -1;

/** Minutes in a day; MaskOn/MaskOff values are minutes-of-day in [0, 1440]. */
const MINUTES_PER_DAY = 1440;

// ---------------------------------------------------------------------------
// Channel name mapping for settings extraction
// ---------------------------------------------------------------------------

/**
 * Maps lowercase STR channel labels to the MachineSettings field they populate.
 *
 * Channels are grouped by the setting they configure. Multiple label
 * variants are supported to handle firmware differences between
 * AirSense 10 and AirSense 11.
 */
type SettingsFieldKey =
  | 'minPressure'
  | 'maxPressure'
  | 'fixedPressure'
  | 'eprLevel'
  | 'eprType'
  | 'rampTime'
  | 'rampPressure'
  | 'rampPressureCPAP'
  | 'therapyMode'
  | 'maskType'
  | 'humidifierLevel'
  | 'climateControl'
  | 'antibacterialFilter'
  | 'smartStart'
  | 'date';

const STR_CHANNEL_MAP: ReadonlyMap<string, SettingsFieldKey> = new Map([
  // Pressure settings — APAP
  ['s.as.minpress', 'minPressure'],
  ['s.as.maxpress', 'maxPressure'],
  // Pressure settings — fixed CPAP
  ['s.c.press', 'fixedPressure'],
  // EPR
  ['s.epr.level', 'eprLevel'],
  ['s.epr.eprlevel', 'eprLevel'],
  ['s.epr.eprtype', 'eprType'],
  // Ramp
  ['s.ramptime', 'rampTime'],
  ['s.rampenable', 'rampTime'], // Will need special handling
  ['s.as.startpress', 'rampPressure'],
  ['s.c.startpress', 'rampPressureCPAP'],
  // Mode
  ['mode', 'therapyMode'],
  // Mask
  ['s.mask', 'maskType'],
  // Humidifier
  ['s.humlevel', 'humidifierLevel'],
  // Climate control
  ['s.climatecontrol', 'climateControl'],
  // Antibacterial filter
  ['s.abfilter', 'antibacterialFilter'],
  // SmartStart
  ['s.smartstart', 'smartStart'],
  // Date (day index)
  ['date', 'date'],
]);

// ---------------------------------------------------------------------------
// Therapy mode decoding
// ---------------------------------------------------------------------------

/** Map Mode numeric values to human-readable strings. */
const THERAPY_MODE_MAP: ReadonlyMap<number, string> = new Map([
  [0, 'CPAP'],
  [1, 'APAP'],
  [2, 'BiPAP'],
  [3, 'ASV'],
  [4, 'VPAP'],
  [5, 'iVAPS'],
  [6, 'PAC'],
  [7, 'S'],
  [8, 'ST'],
  [9, 'T'],
]);

// ---------------------------------------------------------------------------
// EPR type decoding
// ---------------------------------------------------------------------------

/** Map EPRType numeric values to descriptive strings. */
const EPR_TYPE_MAP: ReadonlyMap<number, string> = new Map([
  [0, 'Off'],
  [1, 'Ramp Only'],
  [2, 'Full Time'],
  [3, 'Full Time'],
]);

// ---------------------------------------------------------------------------
// Mask type decoding
// ---------------------------------------------------------------------------

/** Map Mask numeric values to descriptive strings. */
const MASK_TYPE_MAP: ReadonlyMap<number, string> = new Map([
  [0, 'Pillows'],
  [1, 'Full Face'],
  [2, 'Nasal'],
]);

// ---------------------------------------------------------------------------
// STRParser class
// ---------------------------------------------------------------------------

/**
 * Parses ResMed STR.edf summary data into per-day machine settings.
 *
 * Usage:
 * ```ts
 * const parser = new STRParser();
 * const result = parser.parse(strInterpretation);
 * const settings = result.settingsByDate.get('2024-10-15');
 * ```
 */
export class STRParser {
  /**
   * Parse an STR.edf interpretation into per-day machine settings.
   *
   * Each data record in the STR.edf represents one calendar day.
   * The `Date` channel contains a day index that, combined with the
   * EDF start date, yields the actual calendar date.
   *
   * @param interpretation - ResMed interpretation of the STR.edf file.
   * @returns Map from ISO date string to machine settings.
   */
  parse(interpretation: ResMedInterpretation): STRParseResult {
    // Build lookup: channel name (lowercase) → StandardChannel
    const channelsByLabel = new Map<string, StandardChannel>();
    for (const ch of interpretation.channels) {
      channelsByLabel.set(ch.name, ch);
    }

    // Also index by original metadata name for STR channels that may not
    // have been normalized by the interpreter (they'll appear in unknownLabels).
    // We need to fall back to raw signal data for STR-specific channels.
    // However, since ResMedInterpreter normalizes known channels and puts
    // unknown labels in unknownLabels, we use the raw interpretation data
    // to extract STR channels by matching against the STR_CHANNEL_MAP.

    // Determine number of records from whichever channel has the most samples
    // (STR channels typically have 1 sample per record = 1 per day)
    let numRecords = 0;
    for (const ch of interpretation.channels) {
      if (ch.samples.length > numRecords) {
        numRecords = ch.samples.length;
      }
    }

    if (numRecords === 0) {
      return { settingsByDate: new Map(), maskIntervalsByDate: new Map() };
    }

    // Extract the start date from the interpretation
    const startDate = interpretation.startTime;

    // Map channels to their settings field keys
    const mappedChannels = new Map<SettingsFieldKey, StandardChannel>();
    for (const ch of interpretation.channels) {
      // Try matching against STR_CHANNEL_MAP using the metadata name
      const key = STR_CHANNEL_MAP.get(ch.metadata.name.toLowerCase());
      if (key) {
        mappedChannels.set(key, ch);
      }
    }

    // Build per-day settings
    const settingsByDate = new Map<string, MachineSettings>();

    for (let recordIdx = 0; recordIdx < numRecords; recordIdx++) {
      // Compute the date for this record
      const dateChannel = mappedChannels.get('date');
      let recordDate: string;

      if (dateChannel && recordIdx < dateChannel.samples.length) {
        // The Date channel contains days since some epoch.
        // ResMed uses a custom epoch: the value represents YYYYMMDD
        // as a number, or days since a reference. In practice,
        // we compute from the EDF start date + record index.
        const dayValue = dateChannel.samples[recordIdx] ?? 0;
        recordDate = this.dayValueToDate(dayValue, startDate);
      } else {
        // Fallback: offset from start date by record index
        const d = new Date(startDate);
        d.setDate(d.getDate() + recordIdx);
        recordDate = this.formatDate(d);
      }

      // Extract setting values for this record
      const getValue = (key: SettingsFieldKey): number | null => {
        const ch = mappedChannels.get(key);
        if (!ch || recordIdx >= ch.samples.length) return null;
        const val = ch.samples[recordIdx];
        if (val === undefined || val === -1) return null; // -1 is sentinel
        return val;
      };

      // Determine pressure settings
      const fixedPressure = getValue('fixedPressure');
      const minPressure = getValue('minPressure') ?? fixedPressure;
      const maxPressure = getValue('maxPressure') ?? fixedPressure;

      // EPR
      const eprLevel = getValue('eprLevel');
      const eprTypeRaw = getValue('eprType');
      const eprType = eprTypeRaw !== null ? (EPR_TYPE_MAP.get(eprTypeRaw) ?? null) : null;

      // Ramp
      const rampTime = getValue('rampTime');
      const rampPressure = getValue('rampPressure') ?? getValue('rampPressureCPAP');

      // Mode
      const modeRaw = getValue('therapyMode');
      const therapyMode = modeRaw !== null ? (THERAPY_MODE_MAP.get(modeRaw) ?? null) : null;

      // Mask
      const maskRaw = getValue('maskType');
      const maskType = maskRaw !== null ? (MASK_TYPE_MAP.get(maskRaw) ?? null) : null;

      // Humidifier
      const humidifierLevel = getValue('humidifierLevel');

      // Boolean settings
      const climateControlRaw = getValue('climateControl');
      const climateControl = climateControlRaw !== null ? climateControlRaw > 0 : null;

      const abFilterRaw = getValue('antibacterialFilter');
      const antibacterialFilter = abFilterRaw !== null ? abFilterRaw > 0 : null;

      const smartStartRaw = getValue('smartStart');
      const smartStart = smartStartRaw !== null ? smartStartRaw > 0 : null;

      const settings: MachineSettings = {
        minPressure,
        maxPressure,
        eprLevel,
        eprType,
        rampTime,
        rampPressure,
        therapyMode,
        maskType,
        humidifierLevel,
        climateControl,
        antibacterialFilter,
        smartStart,
      };

      settingsByDate.set(recordDate, settings);
    }

    // The interpreted-channel path does not retain the MaskOn/MaskOff signals
    // (the ResMedInterpreter drops unrecognized STR channels), so no mask
    // intervals are available here. Use parseFromRawChannels for those.
    return { settingsByDate, maskIntervalsByDate: new Map() };
  }

  /**
   * Parse STR settings (and machine-recorded mask-on/off intervals) from raw
   * (non-interpreted) channel data.
   *
   * This method is used when the STR.edf file has been parsed by the
   * EDF parser but its channels were not recognized by the standard
   * ResMedInterpreter (since STR channels have different names from
   * normal signal channels).
   *
   * @param channels - Raw channels from the EDF parse, with original labels.
   *   Pass `samplesPerRecord` for multi-sample-per-record channels such as
   *   `MaskOn` / `MaskOff` (10 slots/day); when omitted it defaults to 1.
   * @param startDate - EDF recording start date.
   * @param numRecords - Number of data records in the file.
   * @returns Per-day machine settings and per-day mask-on/off intervals.
   */
  parseFromRawChannels(
    channels: ReadonlyArray<{
      readonly label: string;
      readonly samples: Float32Array;
      /** Samples per data record. Defaults to 1 when omitted. */
      readonly samplesPerRecord?: number;
    }>,
    startDate: Date,
    numRecords: number,
  ): STRParseResult {
    // Map channels by their lowercase label to settings field keys
    const mappedChannels = new Map<SettingsFieldKey, { samples: Float32Array }>();
    for (const ch of channels) {
      const key = STR_CHANNEL_MAP.get(ch.label.toLowerCase().trim());
      if (key) {
        mappedChannels.set(key, ch);
      }
    }

    // Locate the MaskOn / MaskOff channels (10 slots per record) and the Date
    // channel for resolving each record's calendar day.
    let maskOnChannel: { samples: Float32Array; samplesPerRecord: number } | undefined;
    let maskOffChannel: { samples: Float32Array; samplesPerRecord: number } | undefined;
    let dateSamples: Float32Array | undefined;
    for (const ch of channels) {
      const label = ch.label.toLowerCase().trim();
      const spr = ch.samplesPerRecord ?? 1;
      if (label === 'maskon') maskOnChannel = { samples: ch.samples, samplesPerRecord: spr };
      else if (label === 'maskoff') maskOffChannel = { samples: ch.samples, samplesPerRecord: spr };
      else if (label === 'date') dateSamples = ch.samples;
    }

    const maskIntervalsByDate = this.extractMaskIntervals(
      maskOnChannel,
      maskOffChannel,
      dateSamples,
      startDate,
      numRecords,
    );

    const settingsByDate = new Map<string, MachineSettings>();

    for (let recordIdx = 0; recordIdx < numRecords; recordIdx++) {
      const dateChannel = mappedChannels.get('date');
      let recordDate: string;

      if (dateChannel && recordIdx < dateChannel.samples.length) {
        const dayValue = dateChannel.samples[recordIdx] ?? 0;
        recordDate = this.dayValueToDate(dayValue, startDate);
      } else {
        const d = new Date(startDate);
        d.setDate(d.getDate() + recordIdx);
        recordDate = this.formatDate(d);
      }

      const getValue = (key: SettingsFieldKey): number | null => {
        const ch = mappedChannels.get(key);
        if (!ch || recordIdx >= ch.samples.length) return null;
        const val = ch.samples[recordIdx];
        if (val === undefined || val === -1) return null;
        return val;
      };

      const fixedPressure = getValue('fixedPressure');
      const minPressure = getValue('minPressure') ?? fixedPressure;
      const maxPressure = getValue('maxPressure') ?? fixedPressure;

      const eprLevel = getValue('eprLevel');
      const eprTypeRaw = getValue('eprType');
      const eprType = eprTypeRaw !== null ? (EPR_TYPE_MAP.get(eprTypeRaw) ?? null) : null;

      const rampTime = getValue('rampTime');
      const rampPressure = getValue('rampPressure') ?? getValue('rampPressureCPAP');

      const modeRaw = getValue('therapyMode');
      const therapyMode = modeRaw !== null ? (THERAPY_MODE_MAP.get(modeRaw) ?? null) : null;

      const maskRaw = getValue('maskType');
      const maskType = maskRaw !== null ? (MASK_TYPE_MAP.get(maskRaw) ?? null) : null;

      const humidifierLevel = getValue('humidifierLevel');

      const climateControlRaw = getValue('climateControl');
      const climateControl = climateControlRaw !== null ? climateControlRaw > 0 : null;

      const abFilterRaw = getValue('antibacterialFilter');
      const antibacterialFilter = abFilterRaw !== null ? abFilterRaw > 0 : null;

      const smartStartRaw = getValue('smartStart');
      const smartStart = smartStartRaw !== null ? smartStartRaw > 0 : null;

      const settings: MachineSettings = {
        minPressure,
        maxPressure,
        eprLevel,
        eprType,
        rampTime,
        rampPressure,
        therapyMode,
        maskType,
        humidifierLevel,
        climateControl,
        antibacterialFilter,
        smartStart,
      };

      settingsByDate.set(recordDate, settings);
    }

    return { settingsByDate, maskIntervalsByDate };
  }

  // ---------------------------------------------------------------------------
  // Mask-on/off interval extraction
  // ---------------------------------------------------------------------------

  /**
   * Extract per-day mask-on/off intervals from the STR `MaskOn` / `MaskOff`
   * channels.
   *
   * Each STR data record is one calendar day and holds up to 10 interval slots
   * (`samplesPerRecord = 10`). `MaskOn[k]` and `MaskOff[k]` are minutes-of-day
   * in [0, 1440]; unused slots are the sentinel `-1`. A slot is a valid
   * interval when both endpoints are in range and `MaskOff >= MaskOn`.
   *
   * Returned `start`/`end` are absolute local wall-clock times = (the record's
   * calendar midnight) + the minutes-of-day offset. The map is keyed by the
   * same ISO date string used for `settingsByDate`, so a session's date looks
   * up its own day's intervals directly.
   *
   * @returns Empty map when MaskOn/MaskOff channels are absent (older firmware).
   */
  private extractMaskIntervals(
    maskOnChannel: { samples: Float32Array; samplesPerRecord: number } | undefined,
    maskOffChannel: { samples: Float32Array; samplesPerRecord: number } | undefined,
    dateSamples: Float32Array | undefined,
    startDate: Date,
    numRecords: number,
  ): ReadonlyMap<string, MaskInterval[]> {
    const byDate = new Map<string, MaskInterval[]>();
    if (!maskOnChannel || !maskOffChannel) return byDate;

    const slots = maskOnChannel.samplesPerRecord;
    // Guard against a malformed pairing where the two channels disagree on the
    // slot count; use the smaller to stay within both buffers.
    const slotCount = Math.min(slots, maskOffChannel.samplesPerRecord);
    if (slotCount <= 0) return byDate;

    for (let recordIdx = 0; recordIdx < numRecords; recordIdx++) {
      // Resolve this record's calendar day (local midnight).
      const dayValue = dateSamples?.[recordIdx] ?? 0;
      const dayStart = this.dayValueToLocalMidnight(dayValue, startDate, recordIdx);
      const isoDate = this.formatDate(dayStart);

      const intervals: MaskInterval[] = [];
      const base = recordIdx * slotCount;
      for (let s = 0; s < slotCount; s++) {
        const onMin = maskOnChannel.samples[base + s];
        const offMin = maskOffChannel.samples[base + s];
        if (onMin === undefined || offMin === undefined) continue;
        if (onMin === MASK_SLOT_SENTINEL || offMin === MASK_SLOT_SENTINEL) continue;
        if (onMin < 0 || offMin < 0 || onMin > MINUTES_PER_DAY || offMin > MINUTES_PER_DAY)
          continue;
        if (offMin < onMin) continue; // malformed slot; skip rather than invert

        const start = new Date(dayStart.getTime() + onMin * 60_000);
        const end = new Date(dayStart.getTime() + offMin * 60_000);
        intervals.push({ start, end });
      }

      if (intervals.length > 0) {
        // Records can repeat a calendar date in rare re-sync cases; merge.
        const existing = byDate.get(isoDate);
        if (existing) existing.push(...intervals);
        else byDate.set(isoDate, intervals);
      }
    }

    return byDate;
  }

  /**
   * Resolve a record's calendar day to a local-time midnight Date.
   *
   * Mirrors {@link dayValueToDate} (ResMed Excel-serial epoch) but returns a
   * Date at local 00:00 so minute-of-day offsets land on the correct local
   * wall-clock time. Falls back to (startDate + recordIdx days) when the day
   * value is absent or sentinel.
   */
  private dayValueToLocalMidnight(dayValue: number, startDate: Date, recordIdx: number): Date {
    if (dayValue > 0) {
      // Excel-serial epoch interpreted in UTC, then projected to local midnight
      // via its calendar Y/M/D so the result matches dayValueToDate's string.
      const epochMs = Date.UTC(1899, 11, 30);
      const utc = new Date(epochMs + dayValue * 86_400_000);
      return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    }
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    d.setDate(d.getDate() + recordIdx);
    return d;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Convert a ResMed day value to an ISO date string.
   *
   * The STR.edf `Date` channel stores dates as the number of days
   * since December 30, 1899 (the Excel/Lotus epoch used by ResMed).
   * A value of 0 means no session data for that record.
   */
  private dayValueToDate(dayValue: number, fallbackStartDate: Date): string {
    if (dayValue <= 0) {
      return this.formatDate(fallbackStartDate);
    }

    // ResMed epoch: 1899-12-30 (same as Excel serial date)
    // dayValue = number of days since this epoch
    const epochMs = Date.UTC(1899, 11, 30); // Dec 30, 1899
    const dateMs = epochMs + dayValue * 86_400_000;
    return this.formatDate(new Date(dateMs));
  }

  /** Format a Date to ISO YYYY-MM-DD. */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
