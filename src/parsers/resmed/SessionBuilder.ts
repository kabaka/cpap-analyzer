/**
 * Session builder that merges multiple interpreted EDF files into sessions.
 *
 * Handles:
 * - Merging BRP, EVE, SAD, CSL, and PLD files into a single session
 * - Time alignment across files
 * - Session boundary detection (>30 min gap = new session)
 * - Usage time computation (mask pressure > 2 cmH₂O)
 * - AHI computation from events and usage time
 * - Production of domain `Session`, `NightlyAggregate`, and `Event[]`
 */

import type { Event } from '@/types/events';
import type { Session, NightlyAggregate, ChannelMetadata, MachineSettings } from '@/types/session';
import type { ResMedInterpretation, StandardChannel } from './ResMedInterpreter';

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

/** Mask pressure threshold (cmH₂O) for usage time computation. */
const USAGE_PRESSURE_THRESHOLD = 2.0;

/** CMS compliance threshold: 4 hours. */
const CMS_COMPLIANCE_HOURS = 4;

/** Large leak threshold in L/min. */
const LARGE_LEAK_THRESHOLD = 24;

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
   * @returns Array of build results, one per detected session.
   */
  buildSessions(
    interpretations: readonly ResMedInterpretation[],
    strSettingsByDate?: ReadonlyMap<string, MachineSettings>,
  ): BuildResult[] {
    if (interpretations.length === 0) return [];

    const groups = this.detectSessionBoundaries(interpretations);
    return groups.map((group) => this.buildFromGroup(group, strSettingsByDate));
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

    // Compute usage time from mask pressure
    const usageSeconds = this.computeUsageSeconds(channelMap);

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
    const sessionDate = this.formatDate(startTime);
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
    const totalAHI =
      ahiResult.obstructive +
      ahiResult.central +
      ahiResult.mixed +
      ahiResult.hypopnea +
      ahiResult.rera;

    const leakResult = this.computeLeakStats(channelMap);
    const pressureResult = this.computePressureStats(channelMap);
    const spo2Result = this.computeSpO2Stats(channelMap, usageHours);
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
      ahi: totalAHI,
      ahiObstructive: ahiResult.obstructive,
      ahiCentral: ahiResult.central,
      ahiMixed: ahiResult.mixed,
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

  /** Compute usage time in seconds from mask pressure channel. */
  private computeUsageSeconds(channels: ReadonlyMap<string, StandardChannel>): number {
    const pressureChannel = channels.get('maskPressure');
    if (!pressureChannel) return 0;

    let usageSamples = 0;
    for (let i = 0; i < pressureChannel.samples.length; i++) {
      if ((pressureChannel.samples[i] ?? 0) > USAGE_PRESSURE_THRESHOLD) {
        usageSamples++;
      }
    }

    return usageSamples / pressureChannel.sampleRate;
  }

  // ---------------------------------------------------------------------------
  // AHI computation
  // ---------------------------------------------------------------------------

  /** Compute AHI breakdown by event type. */
  private computeAHIBreakdown(
    events: readonly Event[],
    usageHours: number,
  ): { obstructive: number; central: number; mixed: number; hypopnea: number; rera: number } {
    if (usageHours <= 0) {
      return { obstructive: 0, central: 0, mixed: 0, hypopnea: 0, rera: 0 };
    }

    let obstructiveCount = 0;
    let centralCount = 0;
    let mixedCount = 0;
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

    const sorted = Float32Array.from(leakChannel.samples).sort();
    const median = this.percentile(sorted, 50);
    const p95 = this.percentile(sorted, 95);

    let max = -Infinity;
    let largeLeakSamples = 0;
    for (let i = 0; i < leakChannel.samples.length; i++) {
      const val = leakChannel.samples[i] ?? 0;
      if (val > max) max = val;
      if (val > LARGE_LEAK_THRESHOLD) largeLeakSamples++;
    }

    const largeLeakSeconds = largeLeakSamples / leakChannel.sampleRate;

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

    let sum = 0;
    let max = -Infinity;
    for (let i = 0; i < pressureChannel.samples.length; i++) {
      const val = pressureChannel.samples[i] ?? 0;
      sum += val;
      if (val > max) max = val;
    }

    const mean = sum / pressureChannel.samples.length;
    const sorted = Float32Array.from(pressureChannel.samples).sort();
    const median = this.percentile(sorted, 50);
    const p95 = this.percentile(sorted, 95);

    // EPAP/IPAP from dedicated channels
    const epapChannel = channels.get('epap');
    const ipapChannel = channels.get('ipap');

    const epap =
      epapChannel && epapChannel.samples.length > 0
        ? this.percentile(Float32Array.from(epapChannel.samples).sort(), 50)
        : null;
    const ipap =
      ipapChannel && ipapChannel.samples.length > 0
        ? this.percentile(Float32Array.from(ipapChannel.samples).sort(), 50)
        : null;

    return { mean, median, p95, max, epap, ipap };
  }

  // ---------------------------------------------------------------------------
  // SpO2 stats
  // ---------------------------------------------------------------------------

  /** Compute SpO2 statistics, or null if no oximetry data. */
  private computeSpO2Stats(
    channels: ReadonlyMap<string, StandardChannel>,
    usageHours: number,
  ): { mean: number; median: number; min: number; below90Percent: number; odi: number } | null {
    const spo2Channel = channels.get('spo2');
    if (!spo2Channel || spo2Channel.samples.length === 0) return null;

    // Filter out sentinel values (0 = no oximeter data)
    const validSamples: number[] = [];
    for (let i = 0; i < spo2Channel.samples.length; i++) {
      const val = spo2Channel.samples[i] ?? 0;
      if (val > 0) {
        validSamples.push(val);
      }
    }

    // If all values are sentinel, no real oximetry data
    if (validSamples.length === 0) return null;

    let sum = 0;
    let min = Infinity;
    let timeBelow90Count = 0;
    let desatCount = 0;
    let previousSpo2 = validSamples[0] ?? 100;

    for (let i = 0; i < validSamples.length; i++) {
      const val = validSamples[i] ?? 0;
      sum += val;
      if (val < min) min = val;
      if (val < 90) timeBelow90Count++;

      // Simple desaturation detection: drop ≥ 3% from previous sample
      if (i > 0 && previousSpo2 - val >= 3) {
        desatCount++;
      }
      previousSpo2 = val;
    }

    const mean = sum / validSamples.length;
    const sortedValid = Float32Array.from(validSamples).sort();
    const median = this.percentile(sortedValid, 50);
    const below90Percent = (timeBelow90Count / validSamples.length) * 100;
    const odi = usageHours > 0 ? desatCount / usageHours : 0;

    return { mean, median, min, below90Percent, odi };
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
      let sum = 0;
      for (let i = 0; i < ch.samples.length; i++) {
        sum += ch.samples[i] ?? 0;
      }
      const mean = sum / ch.samples.length;
      const sorted = Float32Array.from(ch.samples).sort();
      const median = this.percentile(sorted, 50);
      return { mean, median };
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
