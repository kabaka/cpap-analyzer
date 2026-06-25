/**
 * Upsert-merge of Fitbit intraday timeseries payloads sharing one storage key.
 *
 * ## Why this exists
 *
 * Each `integration_timeseries` record is keyed by `(source, dataType, date)`
 * under a UNIQUE index, so at most one record can exist per local calendar date
 * per data type. But a single local date's intraday data is NOT confined to a
 * single export file: real Fitbit `heart_rate-YYYY-MM-DD.json` files span a 24h
 * window OFFSET from local midnight (the offset is the user's UTC offset, so it
 * is DST-dependent — e.g. `07:00:01` local in California PDT). Concretely, the
 * file `heart_rate-2026-06-01.json` runs `06/01 07:00:01 → 06/02 06:59:59`, so
 * local date `2026-06-02` is produced by TWO files:
 *
 *   - the `00:00 → 06:59:59` morning chunk from file `…-06-01`, and
 *   - the `07:00 → 23:59` chunk from file `…-06-02`.
 *
 * The parser groups samples by each sample's own local calendar date, so it
 * emits these as two separate {@link ParsedRecord}s for the same date. Because
 * the import pipeline runs per-file (streaming), the second chunk arrives after
 * the first has already been stored. A first-occurrence-wins de-dupe (or the
 * unique-index `ConstraintError`) therefore DROPPED the second chunk, truncating
 * every day's heart rate to `00:00 → ~07:00`. (See the Fitbit heart-rate-timing
 * regression.)
 *
 * The fix is to MERGE the two partial-day chunks into a single record rather
 * than skipping the later one. This module owns that merge.
 *
 * ## Semantics
 *
 * Merge = UNION of samples keyed by ABSOLUTE wall-clock epoch (the
 * timezone-independent wall-clock-as-UTC epoch used throughout the wearable
 * pipeline — see {@link module:utils/wallClock}), de-duplicated so an identical
 * absolute timestamp collapses to ONE sample, sorted ascending, with every
 * derived field (base timestamp, per-sample offsets, sample counts) recomputed
 * from the merged set. On a timestamp collision the EXISTING sample is kept
 * (deterministic, order-independent), which makes re-importing identical files
 * idempotent: a record merged with itself yields the same sample set, so records
 * never grow on re-import.
 *
 * ## Worker-safety
 *
 * Pure functions, no DOM / `File` / IndexedDB dependencies, so this is safe to
 * call from the `fitbitParser.worker` as well as the main-thread import service.
 *
 * @module services/import/googlehealth/mergeTimeseries
 */

import type {
  FitbitTimeseriesType,
  FitbitTimeseriesPayloadMap,
  FitbitHeartRateIntraday,
  FitbitHeartRateIntradaySample,
  FitbitSpO2Intraday,
  FitbitHRVDetail,
  FitbitHRVDetailInterval,
  FitbitSnoringSegments,
  FitbitSnoringSegment,
  FitbitSleepStages,
  FitbitSleepStageTransition,
} from '@/types/fitbit';
import { localIsoToWallClockEpoch } from '@/utils/wallClock';

import { warnParseIssue } from './logging';

/**
 * Merge two stored timeseries payloads of the SAME data type into one.
 *
 * Dispatches by `dataType` to the per-shape merge below. `existing` is the
 * payload already stored (or accumulated earlier in this import run);
 * `incoming` is the payload that would otherwise have been skipped as a
 * duplicate key. The result is a fresh payload representing the union of both,
 * suitable to write back under the same record `id`.
 *
 * The return type is the typed payload for the given `dataType` (the same shape
 * `IntegrationTimeseries<T>['data']` carries), so the caller can store it
 * without an unchecked cast.
 *
 * Unknown / future data types fall back to keeping `existing` unchanged and emit
 * a PHI-safe warning rather than throwing, so an import is never aborted by a
 * shape this function has not been taught to merge.
 *
 * @param dataType - Discriminator selecting the payload shape.
 * @param existing - The payload already present for this key.
 * @param incoming - The payload to fold into `existing`.
 * @returns The merged payload for `dataType`.
 */
export function mergeTimeseriesPayload<T extends FitbitTimeseriesType>(
  dataType: T,
  existing: FitbitTimeseriesPayloadMap[T],
  incoming: FitbitTimeseriesPayloadMap[T],
): FitbitTimeseriesPayloadMap[T] {
  switch (dataType) {
    case 'heart_rate_intraday':
      return mergeHeartRateIntraday(
        existing as FitbitHeartRateIntraday,
        incoming as FitbitHeartRateIntraday,
      ) as FitbitTimeseriesPayloadMap[T];
    case 'spo2_intraday':
      return mergeSpO2Intraday(
        existing as FitbitSpO2Intraday,
        incoming as FitbitSpO2Intraday,
      ) as FitbitTimeseriesPayloadMap[T];
    case 'hrv_detail':
      return mergeHRVDetail(
        existing as FitbitHRVDetail,
        incoming as FitbitHRVDetail,
      ) as FitbitTimeseriesPayloadMap[T];
    case 'snoring_segments':
      return mergeSnoringSegments(
        existing as FitbitSnoringSegments,
        incoming as FitbitSnoringSegments,
      ) as FitbitTimeseriesPayloadMap[T];
    case 'sleep_stages':
      return mergeSleepStages(
        existing as FitbitSleepStages,
        incoming as FitbitSleepStages,
      ) as FitbitTimeseriesPayloadMap[T];
    default:
      // Future/unknown timeseries shape: keep existing (last-wins would also be
      // safe, but keeping existing is consistent with the collision rule above)
      // and log PHI-safely. dataType is a stable discriminator, not PHI.
      warnParseIssue('Unknown timeseries dataType in merge; keeping existing', String(dataType), {
        name: 'MergeFallback',
      });
      return existing;
  }
}

// ---------------------------------------------------------------------------
// heart_rate_intraday — the primary, offset-encoded case
// ---------------------------------------------------------------------------

/**
 * Merge two {@link FitbitHeartRateIntraday} payloads.
 *
 * Each payload stores samples as `offsetSec` relative to its own
 * `baseTimestampMs`, so the two payloads do NOT share a time origin. We
 * therefore reconstruct every sample's ABSOLUTE wall-clock epoch
 * (`baseTimestampMs + offsetSec * 1000`), union them de-duped by epoch (existing
 * wins on collision), sort ascending, then re-encode against a new base = the
 * earliest epoch in the merged set. `offsetSec` is recomputed as
 * `round((epoch - base) / 1000)` and `sampleCount` is set to the merged length.
 *
 * This is the case that fixes the truncated-at-07:00 bug: feeding a `00:00 →
 * 06:59:59` chunk and a `07:00 → 23:59` chunk yields one full-day record with a
 * continuous offset sequence and no gap at the 07:00 file boundary.
 */
function mergeHeartRateIntraday(
  existing: FitbitHeartRateIntraday,
  incoming: FitbitHeartRateIntraday,
): FitbitHeartRateIntraday {
  // epoch -> sample, existing inserted first so it wins on collision.
  const byEpoch = new Map<number, FitbitHeartRateIntradaySample>();

  for (const s of existing.samples) {
    const epoch = existing.baseTimestampMs + s.offsetSec * 1000;
    if (!byEpoch.has(epoch)) byEpoch.set(epoch, s);
  }
  for (const s of incoming.samples) {
    const epoch = incoming.baseTimestampMs + s.offsetSec * 1000;
    if (!byEpoch.has(epoch)) byEpoch.set(epoch, s);
  }

  const epochs = [...byEpoch.keys()].sort((a, b) => a - b);
  const firstEpoch = epochs[0];
  if (firstEpoch === undefined) {
    // Both payloads empty: preserve a coherent empty record.
    return { baseTimestampMs: existing.baseTimestampMs, samples: [], sampleCount: 0 };
  }

  const baseTimestampMs = firstEpoch;
  const samples: FitbitHeartRateIntradaySample[] = epochs.map((epoch) => {
    const sample = byEpoch.get(epoch);
    // `sample` is always defined: every epoch came from the map's own keys.
    const bpm = sample?.bpm ?? 0;
    const confidence = sample?.confidence ?? 0;
    return {
      offsetSec: Math.round((epoch - baseTimestampMs) / 1000),
      bpm,
      confidence,
    };
  });

  return { baseTimestampMs, samples, sampleCount: samples.length };
}

// ---------------------------------------------------------------------------
// spo2_intraday — minute-offset encoded against an ISO sleepStartTime
// ---------------------------------------------------------------------------

/**
 * Merge two {@link FitbitSpO2Intraday} payloads.
 *
 * Samples are `minuteOffset` relative to `sleepStartTime` (a wall-clock ISO
 * string). We reconstruct absolute epochs via
 * `localIsoToWallClockEpoch(sleepStartTime) + minuteOffset * 60_000`, union
 * de-duped by epoch (existing wins), sort, then re-encode against the earliest
 * epoch. `sleepStartTime` is rewritten to that new base as an ISO string in the
 * SAME way the parser produces it (`new Date(baseEpoch).toISOString()`), and
 * `minuteOffset = round((epoch - base) / 60_000)`.
 */
function mergeSpO2Intraday(
  existing: FitbitSpO2Intraday,
  incoming: FitbitSpO2Intraday,
): FitbitSpO2Intraday {
  const existingBase = localIsoToWallClockEpoch(existing.sleepStartTime);
  const incomingBase = localIsoToWallClockEpoch(incoming.sleepStartTime);

  // epoch -> value, existing first so it wins on collision.
  const byEpoch = new Map<number, number>();

  if (Number.isFinite(existingBase)) {
    for (const s of existing.samples) {
      const epoch = existingBase + s.minuteOffset * 60_000;
      if (!byEpoch.has(epoch)) byEpoch.set(epoch, s.value);
    }
  }
  if (Number.isFinite(incomingBase)) {
    for (const s of incoming.samples) {
      const epoch = incomingBase + s.minuteOffset * 60_000;
      if (!byEpoch.has(epoch)) byEpoch.set(epoch, s.value);
    }
  }

  const epochs = [...byEpoch.keys()].sort((a, b) => a - b);
  const firstEpoch = epochs[0];
  if (firstEpoch === undefined) {
    // Nothing reconstructable: keep existing unchanged.
    return existing;
  }

  const baseEpoch = firstEpoch;
  const samples = epochs.map((epoch) => ({
    minuteOffset: Math.round((epoch - baseEpoch) / 60_000),
    value: byEpoch.get(epoch) ?? 0,
  }));

  return {
    samples,
    sleepStartTime: new Date(baseEpoch).toISOString(),
    sampleCount: samples.length,
  };
}

// ---------------------------------------------------------------------------
// Absolute-ISO-keyed shapes: hrv_detail, snoring_segments, sleep_stages
// ---------------------------------------------------------------------------

/**
 * Merge two {@link FitbitHRVDetail} payloads.
 *
 * `intervals[].timestamp` is an absolute (local-time) ISO string, so merging is
 * a concat de-duped by `timestamp` string (existing wins) and sorted ascending
 * by the wall-clock-as-UTC epoch of the timestamp.
 */
function mergeHRVDetail(existing: FitbitHRVDetail, incoming: FitbitHRVDetail): FitbitHRVDetail {
  const intervals = dedupeByTimestampIso<FitbitHRVDetailInterval>(
    existing.intervals,
    incoming.intervals,
  );
  return { intervals };
}

/**
 * Merge two {@link FitbitSnoringSegments} payloads. Same absolute-ISO pattern as
 * {@link mergeHRVDetail}, keyed on `segments[].timestamp`.
 */
function mergeSnoringSegments(
  existing: FitbitSnoringSegments,
  incoming: FitbitSnoringSegments,
): FitbitSnoringSegments {
  const segments = dedupeByTimestampIso<FitbitSnoringSegment>(existing.segments, incoming.segments);
  return { segments };
}

/**
 * Merge two {@link FitbitSleepStages} payloads. Same absolute-ISO pattern as
 * {@link mergeHRVDetail}, keyed on `transitions[].timestamp`.
 */
function mergeSleepStages(
  existing: FitbitSleepStages,
  incoming: FitbitSleepStages,
): FitbitSleepStages {
  const transitions = dedupeByTimestampIso<FitbitSleepStageTransition>(
    existing.transitions,
    incoming.transitions,
  );
  return { transitions };
}

/**
 * Concatenate two arrays of `{ timestamp: string, ... }` items, de-duplicating
 * by the exact `timestamp` STRING (existing wins on collision) and returning
 * them sorted ascending by wall-clock-as-UTC epoch.
 *
 * Used by the three absolute-ISO-keyed timeseries shapes. The dedupe key is the
 * raw string (not the parsed epoch) so two byte-identical timestamps collapse
 * deterministically even if one were unparseable; sorting uses the parsed epoch,
 * with unparseable timestamps (NaN) ordered last but stably preserved.
 */
function dedupeByTimestampIso<I extends { readonly timestamp: string }>(
  existing: readonly I[],
  incoming: readonly I[],
): I[] {
  const byTimestamp = new Map<string, I>();
  for (const item of existing) {
    if (!byTimestamp.has(item.timestamp)) byTimestamp.set(item.timestamp, item);
  }
  for (const item of incoming) {
    if (!byTimestamp.has(item.timestamp)) byTimestamp.set(item.timestamp, item);
  }

  return [...byTimestamp.values()].sort((a, b) => {
    const ea = localIsoToWallClockEpoch(a.timestamp);
    const eb = localIsoToWallClockEpoch(b.timestamp);
    // Order NaN (unparseable) last, deterministically.
    if (Number.isNaN(ea) && Number.isNaN(eb)) return 0;
    if (Number.isNaN(ea)) return 1;
    if (Number.isNaN(eb)) return -1;
    return ea - eb;
  });
}
