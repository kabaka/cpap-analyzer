/**
 * Session builder that merges multiple interpreted EDF files into sessions.
 *
 * Handles:
 * - Merging BRP, EVE, SAD, CSL, and PLD files into a single session
 * - Time alignment across files
 * - Session boundary detection (>30 min gap = new session)
 * - Usage / mask-on time computation (STR mask intervals when available;
 *   otherwise a hysteresis detector on mask pressure)
 * - AHI / RDI / ODI computation from events, signals, and usage time
 * - Production of domain `Session`, `NightlyAggregate`, and `Event[]`
 *
 * ## Sentinel / gap policy
 * A missing/undefined sample is SKIPPED, never folded in as a real `0`. ResMed
 * channels also use specific physiologic sentinels: SpO₂ uses `0` (no probe).
 * Skipping (rather than `?? 0`) keeps means/medians/percentiles from being
 * biased toward zero by padding or dropout. See {@link collectValidSamples}.
 */

import { LEAK_NOTICE_LPM } from '@/analysis/uncertainty/constants';
import type { Event } from '@/types/events';
import type { Session, NightlyAggregate, ChannelMetadata, MachineSettings } from '@/types/session';
import type { ResMedInterpretation, StandardChannel } from './ResMedInterpreter';
import type { MaskInterval } from './STRParser';

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

/** Result of building a session from interpreted EDF files. */
export interface BuildResult {
  /** The merged session record. */
  readonly session: Session;
  /** Nightly aggregate statistics. */
  readonly aggregate: NightlyAggregate;
  /** All therapy events for this session. */
  readonly events: readonly Event[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Gap threshold in milliseconds: >30 minutes means a new session. */
const SESSION_GAP_MS = 30 * 60 * 1000;

/** CMS compliance threshold: 4 hours. */
const CMS_COMPLIANCE_HOURS = 4;

/** Large leak threshold in L/min (ResMed device convention; see uncertainty constants). */
const LARGE_LEAK_THRESHOLD = LEAK_NOTICE_LPM;

// --- Usage hysteresis detector thresholds (mask-pressure fallback) ----------
//
// The instantaneous mask-pressure waveform oscillates per breath (and dips
// further with EPR/EPAP), so a single fixed threshold miscounts: a naive
// "> 2 cmH₂O" rule both rejects exhalation troughs at low CPAP and accepts the
// sub-therapeutic start of a ramp. Instead we use Schmitt-trigger hysteresis:
// treat the mask as ON once pressure rises above an UPPER threshold and as OFF
// only after pressure stays below a LOWER threshold for a sustained dwell. The
// band absorbs per-breath oscillation; the dwell absorbs brief signal dropouts.

/** Pressure (cmH₂O) above which the mask is considered ON (rising edge). */
const USAGE_ON_THRESHOLD = 2.0;

/**
 * Pressure (cmH₂O) below which the mask may be considered OFF (falling edge).
 * Set well under therapeutic ramp-start (typically 4 cmH₂O) so the trough of a
 * low-CPAP breath with EPR never crosses it. The machine vents to near-ambient
 * (~0–1 cmH₂O) when the mask is actually removed.
 */
const USAGE_OFF_THRESHOLD = 1.0;

/**
 * Sustained time (seconds) pressure must remain below {@link USAGE_OFF_THRESHOLD}
 * before the mask is declared OFF. Bridges momentary dropouts and the brief
 * near-zero excursions of a deep exhalation without ending usage prematurely.
 */
const USAGE_OFF_DWELL_SECONDS = 10;

// --- ODI (oxygen desaturation index) parameters -----------------------------
//
// AASM SpO₂ desaturation scoring: a desaturation event is a fall in SpO₂ of at
// least a threshold amount (default 3%) from a local baseline, lasting a
// minimum duration, counted once per physiologic dip. We use a trailing
// rolling-mean baseline and require the nadir to persist, with a refractory
// gap so one dip = one event.

/** Minimum SpO₂ fall (percentage points) from baseline to score a desaturation. */
const ODI_DROP_THRESHOLD = 3;

/** Trailing window (seconds) used to compute the rolling SpO₂ baseline. */
const ODI_BASELINE_WINDOW_SECONDS = 120;

/** Minimum event duration (seconds): SpO₂ must stay ≥ threshold below baseline this long. */
const ODI_MIN_EVENT_SECONDS = 10;

/**
 * Refractory gap (seconds) after an event's nadir before a new event may be
 * scored, so one physiologic dip is not double-counted as it recovers.
 */
const ODI_REFRACTORY_SECONDS = 10;

/** SpO₂ sentinel value: 0 = no oximeter / probe off. */
const SPO2_SENTINEL = 0;

/** T90 threshold: SpO₂ strictly below this (%) counts toward time-below-90. */
const SPO2_T90_THRESHOLD = 90;

// ---------------------------------------------------------------------------
// SessionBuilder class
// ---------------------------------------------------------------------------

/**
 * Builds complete sessions from multiple interpreted ResMed EDF files.
 *
 * Usage:
 * ```ts
 * const builder = new SessionBuilder();
 * const results = builder.buildSessions(interpretations);
 * ```
 */
export class SessionBuilder {
  /**
   * Build sessions from one or more interpreted EDF files.
   *
   * Performs session boundary detection, merging files into sessions,
   * and computing aggregates and therapy events.
   *
   * @param interpretations - Interpreted EDF files from `ResMedInterpreter`.
   * @param strSettingsByDate - Optional map from ISO date to machine settings from STR.edf.
   * @param strMaskIntervalsByDate - Optional map from ISO date to the machine-
   *   recorded mask-on/off intervals (from {@link STRParser.parseFromRawChannels}).
   *   When supplied, usage time is computed from the overlap of these intervals
   *   with each session window — but only when that overlap is strictly
   *   positive. If the STR intervals do not overlap a given session (no data
   *   for the night, or a decode/keying mismatch), usage for THAT session falls
   *   back to a hysteresis detector on mask pressure. When the map is omitted
   *   entirely, all sessions use the pressure detector (backward compatible).
   * @returns Array of build results, one per detected session.
   */
  buildSessions(
    interpretations: readonly ResMedInterpretation[],
    strSettingsByDate?: ReadonlyMap<string, MachineSettings>,
    strMaskIntervalsByDate?: ReadonlyMap<string, readonly MaskInterval[]>,
  ): BuildResult[] {
    if (interpretations.length === 0) return [];

    const groups = this.detectSessionBoundaries(interpretations);
    return groups.map((group) =>
      this.buildFromGroup(group, strSettingsByDate, strMaskIntervalsByDate),
    );
  }

  /**
   * Detect session boundaries by grouping files with gaps ≤ 30 minutes.
   *
   * @param interpretations - Array of interpreted EDF files.
   * @returns Groups of interpretations, each representing one session.
   */
  detectSessionBoundaries(
    interpretations: readonly ResMedInterpretation[],
  ): ResMedInterpretation[][] {
    if (interpretations.length === 0) return [];

    const sorted = [...interpretations].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    );

    const groups: ResMedInterpretation[][] = [];
    let currentGroup: ResMedInterpretation[] = [];

    for (const interp of sorted) {
      if (currentGroup.length === 0) {
        currentGroup.push(interp);
        continue;
      }

      const lastInterp = currentGroup[currentGroup.length - 1];
      if (!lastInterp) continue;
      const lastEnd = lastInterp.startTime.getTime() + lastInterp.duration * 1000;
      const gap = interp.startTime.getTime() - lastEnd;

      if (gap > SESSION_GAP_MS) {
        groups.push(currentGroup);
        currentGroup = [interp];
      } else {
        currentGroup.push(interp);
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  // ---------------------------------------------------------------------------
  // Private: Build a session from a group of interpretations
  // ---------------------------------------------------------------------------

  private buildFromGroup(
    group: readonly ResMedInterpretation[],
    strSettingsByDate?: ReadonlyMap<string, MachineSettings>,
    strMaskIntervalsByDate?: ReadonlyMap<string, readonly MaskInterval[]>,
  ): BuildResult {
    const sessionId = crypto.randomUUID();
    const aggregateId = crypto.randomUUID();

    // Determine time range
    const startTimes = group.map((g) => g.startTime.getTime());
    const endTimes = group.map((g) => g.startTime.getTime() + g.duration * 1000);
    const startMs = Math.min(...startTimes);
    const endMs = Math.max(...endTimes);
    const startTime = new Date(startMs);
    const endTime = new Date(endMs);
    const durationSeconds = (endMs - startMs) / 1000;

    // Merge channels (prefer more samples; use higher sample rate as tiebreaker)
    const channelMap = new Map<string, StandardChannel>();
    for (const interp of group) {
      for (const ch of interp.channels) {
        const existing = channelMap.get(ch.name);
        if (
          !existing ||
          ch.samples.length > existing.samples.length ||
          (ch.samples.length === existing.samples.length && ch.sampleRate > existing.sampleRate)
        ) {
          channelMap.set(ch.name, ch);
        }
      }
    }

    // Compute usage time. Prefer the machine's own recorded mask-on/off
    // intervals from STR, but ONLY where they actually overlap this session's
    // window and yield positive usage. If STR yields zero overlap for this
    // night (no intervals, or a decoding/keying mismatch that lands the
    // intervals on the wrong wall-clock time) we fall back to the proven
    // pressure-hysteresis detector whenever a mask-pressure channel exists.
    //
    // Rationale: a genuinely-unworn night still measures ~0 from the pressure
    // detector, so legitimately-zero nights stay zero — but an STR decode/
    // overlap miss can no longer silently destroy a real night of therapy.
    // The decision is per-session, never per-import: one night's STR miss
    // does not affect any other night, and a night with good STR overlap
    // still uses the authoritative machine-recorded intervals.
    const sessionDateForUsage = this.formatDate(startTime);
    const maskIntervals = this.maskIntervalsForWindow(
      strMaskIntervalsByDate,
      startTime,
      endTime,
      sessionDateForUsage,
    );
    const strUsageSeconds =
      maskIntervals !== null ? this.computeUsageFromIntervals(maskIntervals, startMs, endMs) : 0;
    const usageSeconds =
      strUsageSeconds > 0 ? strUsageSeconds : this.computeUsageSeconds(channelMap);

    // Build machine info from first interpretation
    const firstInterp = group[0];
    if (!firstInterp) {
      throw new Error('Empty interpretation group');
    }
    const machineInfo = firstInterp.machineInfo;

    // Convert standard events to domain Events
    // Each event's onset is relative to its source file's startTime, not startMs.
    // Build events with correct absolute timestamps per-file.
    const domainEvents: Event[] = [];
    for (const interp of group) {
      const interpStartMs = interp.startTime.getTime();
      for (const evt of interp.events) {
        domainEvents.push({
          id: crypto.randomUUID(),
          sessionId,
          type: evt.type,
          timestamp: interpStartMs + evt.onset * 1000,
          duration: evt.duration,
          severity: null,
          pressure: null,
          epap: null,
          ipap: null,
          leak: null,
          spo2: null,
          clusterId: null,
        });
      }
    }
    domainEvents.sort((a, b) => a.timestamp - b.timestamp);

    // Build channel metadata
    const channelMetadata: ChannelMetadata[] = Array.from(channelMap.values()).map(
      (ch) => ch.metadata,
    );

    // Compute source hash placeholder (SHA-256 of combined data not available here;
    // the import pipeline should compute this from raw file bytes)
    const sourceHash = sessionId; // Placeholder; real hash computed at import time

    // Look up machine settings from STR data by session date
    const sessionDate = sessionDateForUsage;
    const machineSettings = strSettingsByDate?.get(sessionDate) ?? null;

    const session: Session = {
      id: sessionId,
      date: this.formatDate(startTime),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMinutes: durationSeconds / 60,
      usageMinutes: usageSeconds / 60,
      machineId: machineInfo.serialNumber,
      machineModel: machineInfo.model,
      machineType: machineInfo.machineType,
      firmwareVersion: machineInfo.firmwareVersion,
      sourceHash,
      channels: channelMetadata,
      signalChunkIds: [],
      hasOximetry: channelMap.has('spo2'),
      deleted: false,
      importedAt: new Date().toISOString(),
      machineSettings,
    };

    // Compute metrics
    const usageHours = usageSeconds / 3600;
    const ahiResult = this.computeAHIBreakdown(domainEvents, usageHours);
    // AHI = (obstructive + central + mixed + unclassified apneas + hypopneas) /
    // usage hours. An unclassified apnea (bare ResMed "Apnea", e.g. flagged
    // during high leak when the device cannot resolve obstructive vs. central)
    // is still an apnea and MUST count toward the AHI; it is simply not bucketed
    // as mixed. Per AASM 2012 / ICSD-3 RERAs are EXCLUDED from AHI — they belong
    // to RDI.
    const ahi =
      ahiResult.obstructive +
      ahiResult.central +
      ahiResult.mixed +
      ahiResult.unclassified +
      ahiResult.hypopnea;
    // RDI = AHI + RERA index. Equals AHI when no RERAs are scored.
    const rdi = ahi + ahiResult.rera;

    const leakResult = this.computeLeakStats(channelMap);
    const pressureResult = this.computePressureStats(channelMap);
    const spo2Result = this.computeSpO2Stats(channelMap, durationSeconds);
    const respiratoryResult = this.computeRespiratoryMetrics(channelMap);

    // Determine compliance status
    let complianceStatus: 'compliant' | 'non-compliant' | 'partial';
    if (usageHours >= CMS_COMPLIANCE_HOURS) {
      complianceStatus = 'compliant';
    } else if (usageHours >= 1) {
      complianceStatus = 'partial';
    } else {
      complianceStatus = 'non-compliant';
    }

    const aggregate: NightlyAggregate = {
      id: aggregateId,
      sessionId,
      machineId: machineInfo.serialNumber,
      date: this.formatDate(startTime),
      ahi,
      rdi,
      ahiObstructive: ahiResult.obstructive,
      ahiCentral: ahiResult.central,
      ahiMixed: ahiResult.mixed,
      ahiUnclassified: ahiResult.unclassified,
      ahiHypopnea: ahiResult.hypopnea,
      ahiRera: ahiResult.rera,
      eventCount: domainEvents.length,
      eventsByType: this.countEventsByType(domainEvents),
      pressureMean: pressureResult.mean,
      pressureMedian: pressureResult.median,
      pressureP95: pressureResult.p95,
      pressureMax: pressureResult.max,
      epapMedian: pressureResult.epap,
      ipapMedian: pressureResult.ipap,
      pressureSupport:
        pressureResult.epap != null && pressureResult.ipap != null
          ? pressureResult.ipap - pressureResult.epap
          : null,
      leakMedian: leakResult.median,
      leakP95: leakResult.p95,
      leakMax: leakResult.max,
      leakDurationMinutes: leakResult.largeLeakSeconds / 60,
      tidalVolumeMean: respiratoryResult.tidalVolumeMean,
      tidalVolumeMedian: respiratoryResult.tidalVolumeMedian,
      minuteVentMean: respiratoryResult.minuteVentMean,
      respRateMean: respiratoryResult.respRateMean,
      respRateMedian: respiratoryResult.respRateMedian,
      spo2Mean: spo2Result?.mean ?? null,
      spo2Median: spo2Result?.median ?? null,
      spo2Min: spo2Result?.min ?? null,
      spo2Below90Percent: spo2Result?.below90Percent ?? null,
      spo2CoveragePercent: spo2Result?.coveragePercent ?? null,
      oxygenDesaturationIndex: spo2Result?.odi ?? null,
      usageHours,
      maskOnTimeMinutes: usageSeconds / 60,
      complianceStatus,
      configuredMinPressure: machineSettings?.minPressure ?? null,
      configuredMaxPressure: machineSettings?.maxPressure ?? null,
      eprLevel: machineSettings?.eprLevel ?? null,
      notes: '',
      tags: [],
    };

    return { session, aggregate, events: domainEvents };
  }

  // ---------------------------------------------------------------------------
  // Usage time
  // ---------------------------------------------------------------------------

  /**
   * Select the mask intervals relevant to a session window.
   *
   * Looks up the session's own date plus the day before and after (a night
   * commonly spans midnight, and STR keys intervals by calendar day), then
   * returns only those intervals that overlap the [start, end] window at all.
   *
   * @returns The overlapping intervals (possibly empty) when an STR map was
   *   supplied, or `null` when no STR map was provided. Note: unlike earlier
   *   revisions, an empty array is NOT treated as "authoritative zero usage".
   *   The caller uses STR usage only when the clipped overlap is strictly
   *   positive; an empty/zero overlap (whether a genuinely-unworn night or an
   *   STR decode/keying mismatch) falls back to the pressure-hysteresis
   *   detector, which itself measures ~0 for a truly-unworn night. This keeps
   *   STR authoritative where it overlaps without letting a decoding miss zero
   *   out a real night of therapy.
   */
  private maskIntervalsForWindow(
    byDate: ReadonlyMap<string, readonly MaskInterval[]> | undefined,
    start: Date,
    end: Date,
    sessionDate: string,
  ): MaskInterval[] | null {
    if (!byDate) return null;

    const candidateDates = new Set<string>([sessionDate]);
    const dayBefore = new Date(start);
    dayBefore.setDate(dayBefore.getDate() - 1);
    candidateDates.add(this.formatDate(dayBefore));
    const dayAfter = new Date(end);
    dayAfter.setDate(dayAfter.getDate() + 1);
    candidateDates.add(this.formatDate(dayAfter));

    const startMs = start.getTime();
    const endMs = end.getTime();
    const overlapping: MaskInterval[] = [];
    for (const date of candidateDates) {
      const intervals = byDate.get(date);
      if (!intervals) continue;
      for (const iv of intervals) {
        // Overlap if interval start precedes window end and interval end
        // follows window start.
        if (iv.start.getTime() < endMs && iv.end.getTime() > startMs) {
          overlapping.push(iv);
        }
      }
    }
    return overlapping;
  }

  /**
   * Compute usage seconds from mask intervals clipped to the session window.
   *
   * Sums the per-interval overlap with [startMs, endMs] and merges any
   * overlapping intervals first so concurrent slots are not double-counted.
   */
  private computeUsageFromIntervals(
    intervals: readonly MaskInterval[],
    startMs: number,
    endMs: number,
  ): number {
    if (intervals.length === 0) return 0;

    // Clip to window, drop empties.
    const clipped: Array<[number, number]> = [];
    for (const iv of intervals) {
      const s = Math.max(iv.start.getTime(), startMs);
      const e = Math.min(iv.end.getTime(), endMs);
      if (e > s) clipped.push([s, e]);
    }
    if (clipped.length === 0) return 0;

    // Merge overlapping/adjacent ranges, then sum durations.
    clipped.sort((a, b) => a[0] - b[0]);
    let totalMs = 0;
    let [curStart, curEnd] = clipped[0] as [number, number];
    for (let i = 1; i < clipped.length; i++) {
      const [s, e] = clipped[i] as [number, number];
      if (s <= curEnd) {
        if (e > curEnd) curEnd = e;
      } else {
        totalMs += curEnd - curStart;
        curStart = s;
        curEnd = e;
      }
    }
    totalMs += curEnd - curStart;

    return totalMs / 1000;
  }

  /**
   * Fallback usage detection: a Schmitt-trigger hysteresis on mask pressure.
   *
   * Used only when STR mask intervals are unavailable. The mask is declared ON
   * when pressure rises above {@link USAGE_ON_THRESHOLD}, and OFF only after it
   * stays below {@link USAGE_OFF_THRESHOLD} for {@link USAGE_OFF_DWELL_SECONDS}.
   * This counts the full mask-on span (including the low-pressure ramp from 4
   * cmH₂O, which is genuine usage) and is immune to per-breath exhalation /
   * EPR troughs at low CPAP — those briefly dip below the OFF threshold but
   * recover well within the dwell, so usage is not split.
   *
   * Undefined samples are treated as continuation of the current state (a gap),
   * never as a real 0 pressure that would force the mask off.
   */
  private computeUsageSeconds(channels: ReadonlyMap<string, StandardChannel>): number {
    const pressureChannel = channels.get('maskPressure');
    if (!pressureChannel || pressureChannel.sampleRate <= 0) return 0;

    const rate = pressureChannel.sampleRate;
    const dwellSamples = Math.max(1, Math.round(USAGE_OFF_DWELL_SECONDS * rate));
    const samples = pressureChannel.samples;

    let maskOn = false;
    let belowRun = 0; // consecutive samples below the OFF threshold
    let usageSamples = 0;

    for (let i = 0; i < samples.length; i++) {
      const val = samples[i];
      if (val === undefined) {
        // Treat a missing sample as a gap: hold current state, count it as
        // usage if currently on (the machine was running), and do not advance
        // the off-dwell counter toward an off transition.
        if (maskOn) usageSamples++;
        continue;
      }

      if (!maskOn) {
        if (val >= USAGE_ON_THRESHOLD) {
          maskOn = true;
          belowRun = 0;
          usageSamples++;
        }
        continue;
      }

      // Currently on.
      usageSamples++;
      if (val < USAGE_OFF_THRESHOLD) {
        belowRun++;
        if (belowRun >= dwellSamples) {
          // The dwell window we just counted as usage was actually mask-off;
          // reclaim it so a long off-period is not counted as therapy.
          usageSamples -= belowRun;
          maskOn = false;
          belowRun = 0;
        }
      } else {
        belowRun = 0;
      }
    }

    return usageSamples / rate;
  }

  // ---------------------------------------------------------------------------
  // AHI computation
  // ---------------------------------------------------------------------------

  /** Compute AHI breakdown by event type. */
  private computeAHIBreakdown(
    events: readonly Event[],
    usageHours: number,
  ): {
    obstructive: number;
    central: number;
    mixed: number;
    unclassified: number;
    hypopnea: number;
    rera: number;
  } {
    if (usageHours <= 0) {
      return { obstructive: 0, central: 0, mixed: 0, unclassified: 0, hypopnea: 0, rera: 0 };
    }

    let obstructiveCount = 0;
    let centralCount = 0;
    let mixedCount = 0;
    let unclassifiedCount = 0;
    let hypopneaCount = 0;
    let reraCount = 0;

    for (const evt of events) {
      switch (evt.type) {
        case 'ObstructiveApnea':
          obstructiveCount++;
          break;
        case 'CentralApnea':
          centralCount++;
          break;
        case 'MixedApnea':
          mixedCount++;
          break;
        // An unclassified apnea is a true apnea the device could not resolve
        // into obstructive/central. It counts toward AHI but is kept distinct
        // from the mixed bucket so the event-type breakdown stays honest.
        case 'UnclassifiedApnea':
          unclassifiedCount++;
          break;
        case 'Hypopnea':
          hypopneaCount++;
          break;
        case 'RERA':
          reraCount++;
          break;
      }
    }

    return {
      obstructive: obstructiveCount / usageHours,
      central: centralCount / usageHours,
      mixed: mixedCount / usageHours,
      unclassified: unclassifiedCount / usageHours,
      hypopnea: hypopneaCount / usageHours,
      rera: reraCount / usageHours,
    };
  }

  // ---------------------------------------------------------------------------
  // Leak stats
  // ---------------------------------------------------------------------------

  /** Compute leak rate statistics. */
  private computeLeakStats(channels: ReadonlyMap<string, StandardChannel>): {
    median: number;
    p95: number;
    max: number;
    largeLeakSeconds: number;
  } {
    const leakChannel = channels.get('leak');
    if (!leakChannel || leakChannel.samples.length === 0) {
      return { median: 0, p95: 0, max: 0, largeLeakSeconds: 0 };
    }

    // Single pass: collect valid samples (skip undefined gaps), track max and
    // the large-leak count. Then sort ONCE for percentiles.
    const valid = new Float32Array(leakChannel.samples.length);
    let n = 0;
    let max = -Infinity;
    let largeLeakSamples = 0;
    for (let i = 0; i < leakChannel.samples.length; i++) {
      const val = leakChannel.samples[i];
      if (val === undefined) continue;
      valid[n++] = val;
      if (val > max) max = val;
      if (val > LARGE_LEAK_THRESHOLD) largeLeakSamples++;
    }

    if (n === 0) return { median: 0, p95: 0, max: 0, largeLeakSeconds: 0 };

    const sorted = valid.subarray(0, n).slice().sort();
    const median = this.percentile(sorted, 50);
    const p95 = this.percentile(sorted, 95);
    const largeLeakSeconds =
      leakChannel.sampleRate > 0 ? largeLeakSamples / leakChannel.sampleRate : 0;

    return { median, p95, max, largeLeakSeconds };
  }

  // ---------------------------------------------------------------------------
  // Pressure stats
  // ---------------------------------------------------------------------------

  /** Compute pressure statistics. */
  private computePressureStats(channels: ReadonlyMap<string, StandardChannel>): {
    mean: number;
    median: number;
    p95: number;
    max: number;
    epap: number | null;
    ipap: number | null;
  } {
    const pressureChannel = channels.get('maskPressure');
    if (!pressureChannel || pressureChannel.samples.length === 0) {
      return { mean: 0, median: 0, p95: 0, max: 0, epap: null, ipap: null };
    }

    // Sort the pressure channel's valid samples ONCE; derive mean, max,
    // median and p95 from that single pass + single sort.
    const stats = this.sortedScalarStats(pressureChannel.samples);
    if (stats === null) {
      return { mean: 0, median: 0, p95: 0, max: 0, epap: null, ipap: null };
    }

    // EPAP/IPAP medians from dedicated channels (each sorted once internally).
    const epap = this.medianOf(channels.get('epap'));
    const ipap = this.medianOf(channels.get('ipap'));

    return {
      mean: stats.mean,
      median: this.percentile(stats.sorted, 50),
      p95: this.percentile(stats.sorted, 95),
      max: stats.max,
      epap,
      ipap,
    };
  }

  // ---------------------------------------------------------------------------
  // SpO2 stats
  // ---------------------------------------------------------------------------

  /**
   * Compute SpO₂ statistics, or null if no oximetry data.
   *
   * - Sentinel `0` (no probe / finger off) is excluded from every statistic.
   * - **T90** (`below90Percent`) is TIME-based: (valid samples < 90% ÷ all
   *   valid samples) × 100. Because every valid sample represents an equal
   *   1/sampleRate slice, this sample fraction equals the time fraction over
   *   analyzed (non-dropout) oximetry time.
   * - **Coverage** is valid oximetry time ÷ total session time × 100.
   * - **ODI** is discrete desaturation EVENTS per hour of valid oximetry time,
   *   per {@link detectDesaturations}.
   *
   * @param channels - Merged session channels.
   * @param sessionDurationSeconds - Total session window length (for coverage).
   */
  private computeSpO2Stats(
    channels: ReadonlyMap<string, StandardChannel>,
    sessionDurationSeconds: number,
  ): {
    mean: number;
    median: number;
    min: number;
    below90Percent: number;
    coveragePercent: number;
    odi: number;
  } | null {
    const spo2Channel = channels.get('spo2');
    if (!spo2Channel || spo2Channel.samples.length === 0) return null;

    const rate = spo2Channel.sampleRate > 0 ? spo2Channel.sampleRate : 1;

    // Collect valid (non-sentinel) samples in original order (needed for ODI).
    const validOrdered: number[] = [];
    let sum = 0;
    let min = Infinity;
    let timeBelow90Count = 0;
    for (let i = 0; i < spo2Channel.samples.length; i++) {
      const val = spo2Channel.samples[i];
      if (val === undefined || val === SPO2_SENTINEL || val < 0) continue;
      validOrdered.push(val);
      sum += val;
      if (val < min) min = val;
      if (val < SPO2_T90_THRESHOLD) timeBelow90Count++;
    }

    const validCount = validOrdered.length;
    if (validCount === 0) return null;

    const mean = sum / validCount;
    const sortedValid = Float32Array.from(validOrdered).sort();
    const median = this.percentile(sortedValid, 50);

    // T90: fraction of valid oximetry TIME below 90% (each sample = 1/rate s).
    const below90Percent = (timeBelow90Count / validCount) * 100;

    // Coverage: valid oximetry time as a fraction of the session window.
    const validSeconds = validCount / rate;
    const coveragePercent =
      sessionDurationSeconds > 0 ? Math.min(100, (validSeconds / sessionDurationSeconds) * 100) : 0;

    // ODI: events per hour of analyzed (valid) oximetry time.
    const eventCount = this.detectDesaturations(validOrdered, rate);
    const validHours = validSeconds / 3600;
    const odi = validHours > 0 ? eventCount / validHours : 0;

    return { mean, median, min, below90Percent, coveragePercent, odi };
  }

  /**
   * Detect discrete SpO₂ desaturation events (AASM SpO₂ desaturation scoring).
   *
   * Algorithm (parameters are module constants):
   * 1. Maintain a trailing rolling-mean baseline over the last
   *    {@link ODI_BASELINE_WINDOW_SECONDS} of valid SpO₂.
   * 2. A candidate event begins when SpO₂ falls ≥ {@link ODI_DROP_THRESHOLD}
   *    percentage points below that baseline.
   * 3. The candidate is confirmed only if it stays ≥ threshold below baseline
   *    for at least {@link ODI_MIN_EVENT_SECONDS} (continuously), reaching a
   *    nadir — so a single brief 1-sample dip or slow noise does not score.
   * 4. After the nadir, a {@link ODI_REFRACTORY_SECONDS} gap must pass (SpO₂
   *    back near baseline) before another event can score, so one physiologic
   *    dip counts exactly once.
   *
   * Operating on contiguous valid samples (sentinels already removed) means a
   * gradual non-recovering drift re-baselines and does not produce spurious
   * repeated events; ±1% jitter never reaches the 3% threshold.
   *
   * @param spo2 - Valid SpO₂ samples in time order (no sentinels).
   * @param rate - Sample rate in Hz.
   * @returns Number of distinct desaturation events.
   */
  private detectDesaturations(spo2: readonly number[], rate: number): number {
    const n = spo2.length;
    if (n === 0) return 0;

    const baselineWindow = Math.max(1, Math.round(ODI_BASELINE_WINDOW_SECONDS * rate));
    const minEventSamples = Math.max(1, Math.round(ODI_MIN_EVENT_SECONDS * rate));
    const refractorySamples = Math.max(1, Math.round(ODI_REFRACTORY_SECONDS * rate));

    let events = 0;
    let inEvent = false;
    let belowRun = 0; // consecutive samples ≥ threshold below baseline
    let counted = false; // whether the current event has already been scored
    let refractory = 0; // samples remaining before a new event may start

    // Running sum for the trailing baseline window.
    let windowSum = 0;
    let windowStart = 0;

    for (let i = 0; i < n; i++) {
      const val = spo2[i] as number;

      // Update trailing window [windowStart, i].
      windowSum += val;
      while (i - windowStart + 1 > baselineWindow) {
        windowSum -= spo2[windowStart] as number;
        windowStart++;
      }
      const baseline = windowSum / (i - windowStart + 1);

      if (refractory > 0) {
        refractory--;
      }

      const drop = baseline - val;
      if (drop >= ODI_DROP_THRESHOLD) {
        if (!inEvent && refractory === 0) {
          inEvent = true;
          belowRun = 0;
          counted = false;
        }
        if (inEvent) {
          belowRun++;
          if (!counted && belowRun >= minEventSamples) {
            events++;
            counted = true;
          }
        }
      } else if (inEvent) {
        // Recovered toward baseline: close the event, start the refractory gap.
        inEvent = false;
        belowRun = 0;
        refractory = refractorySamples;
      }
    }

    return events;
  }

  // ---------------------------------------------------------------------------
  // Event severity classification
  // ---------------------------------------------------------------------------

  /** Count events grouped by type for the NightlyAggregate eventsByType field. */
  private countEventsByType(events: readonly Event[]): NightlyAggregate['eventsByType'] {
    const counts = {
      obstructive: 0,
      central: 0,
      mixed: 0,
      unclassified: 0,
      hypopnea: 0,
      rera: 0,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
    };

    for (const evt of events) {
      switch (evt.type) {
        case 'ObstructiveApnea':
          counts.obstructive++;
          break;
        case 'CentralApnea':
          counts.central++;
          break;
        case 'MixedApnea':
          counts.mixed++;
          break;
        case 'UnclassifiedApnea':
          counts.unclassified++;
          break;
        case 'Hypopnea':
          counts.hypopnea++;
          break;
        case 'RERA':
          counts.rera++;
          break;
        case 'FlowLimitation':
          counts.flowLimitation++;
          break;
        case 'LargeLeak':
          counts.largeLeak++;
          break;
        case 'PeriodicBreathing':
          counts.periodicBreathing++;
          break;
      }
    }

    return counts;
  }

  /** Compute respiratory metrics from tidal volume, minute ventilation, and respiratory rate channels. */
  private computeRespiratoryMetrics(channels: ReadonlyMap<string, StandardChannel>): {
    tidalVolumeMean: number | null;
    tidalVolumeMedian: number | null;
    minuteVentMean: number | null;
    respRateMean: number | null;
    respRateMedian: number | null;
  } {
    const computeChannelStats = (
      ch: StandardChannel | undefined,
    ): { mean: number | null; median: number | null } => {
      if (!ch || ch.samples.length === 0) return { mean: null, median: null };
      // Single pass for mean + one sort for median; skip undefined gaps so
      // padding does not bias the mean/median toward zero.
      const stats = this.sortedScalarStats(ch.samples);
      if (stats === null) return { mean: null, median: null };
      return { mean: stats.mean, median: this.percentile(stats.sorted, 50) };
    };

    const tv = computeChannelStats(channels.get('tidalVolume'));
    const mv = computeChannelStats(channels.get('minuteVent'));
    const rr = computeChannelStats(channels.get('respRate'));

    return {
      tidalVolumeMean: tv.mean,
      tidalVolumeMedian: tv.median,
      minuteVentMean: mv.mean,
      respRateMean: rr.mean,
      respRateMedian: rr.median,
    };
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /**
   * Collect a channel's valid samples, computing mean and max in one pass and
   * returning them alongside a single sorted copy for percentile queries.
   *
   * "Valid" = not `undefined` (a padding/gap sample). This is the one place the
   * sentinel policy is applied for pressure/leak/respiratory channels: gaps are
   * SKIPPED, never folded in as a real `0` that would drag stats down.
   *
   * @returns `{ sorted, mean, max }` over valid samples, or `null` if none.
   */
  private sortedScalarStats(
    samples: Float32Array,
  ): { sorted: Float32Array; mean: number; max: number } | null {
    const valid = new Float32Array(samples.length);
    let n = 0;
    let sum = 0;
    let max = -Infinity;
    for (let i = 0; i < samples.length; i++) {
      const val = samples[i];
      if (val === undefined) continue;
      valid[n++] = val;
      sum += val;
      if (val > max) max = val;
    }
    if (n === 0) return null;
    const sorted = valid.subarray(0, n).slice().sort();
    return { sorted, mean: sum / n, max };
  }

  /** Median of a channel's valid samples (sorted once), or null if empty. */
  private medianOf(ch: StandardChannel | undefined): number | null {
    if (!ch || ch.samples.length === 0) return null;
    const stats = this.sortedScalarStats(ch.samples);
    if (stats === null) return null;
    return this.percentile(stats.sorted, 50);
  }

  /** Compute a percentile from a sorted Float32Array. */
  private percentile(sorted: Float32Array, p: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0] ?? 0;

    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    const lowerVal = sorted[lower] ?? 0;
    const upperVal = sorted[upper] ?? 0;

    return lowerVal * (1 - weight) + upperVal * weight;
  }

  /** Format a Date to YYYY-MM-DD. */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
