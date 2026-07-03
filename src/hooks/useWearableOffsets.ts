/**
 * Shared, memoized per-date timezone-offset provider for UTC-sourced wearable
 * lanes (heart rate + SpO₂).
 *
 * ## Why this exists (single source of truth)
 *
 * Two Fitbit intraday lanes — `heart_rate_intraday` and `spo2_intraday` — are
 * exported in **UTC**, while the rest of the app renders everything in the
 * "wall-clock-as-UTC" frame (a local clock fed literally to {@link Date.UTC};
 * see `src/utils/wallClock.ts`). Under that convention a UTC-sourced sample
 * lands at its UTC clock face, so a 1:00 AM PDT event renders at 8:00 AM — a
 * 7–8 h displacement for a US-Pacific user. To render those two lanes in LOCAL
 * time we add a per-night signed UTC offset (minutes to ADD to a UTC clock to
 * get the local clock; PDT = −420).
 *
 * The offset is derived from data by {@link resolveOffsetTable} (the CPAP
 * session is the local-time ground truth). Because MULTIPLE consumers need the
 * same offsets — the per-session Signal Viewer ({@link useWearableLanes}) and
 * the Event-Explorer autonomic view ({@link useSleepStageEventContext}) — this
 * module computes the `date → offsetMinutes` table exactly ONCE per integration
 * source and hands the same {@link Map} to every consumer. Per-hook
 * recomputation would risk divergence (two lanes shifted by different amounts)
 * and redundant full-session scans on every render.
 *
 * ## Performance (principle #3 — years of 25–50 Hz data)
 *
 * Building the offset table must not force-load every heart-rate night (each is
 * ~17k samples). We therefore anchor the estimate on **SpO₂**, which is UTC AND
 * inherently sleep-only AND small (minute cadence): a night's SpO₂ span already
 * IS the sleep feature, so it aligns to the overlapping CPAP session directly.
 * Heart rate — 24/7, so a nocturnal low-HR trough must be extracted — is loaded
 * as an anchor ONLY for nights that have no SpO₂ record. HRV / sleep-stages /
 * snoring are LOCAL and are never used as UTC anchors (nor shifted).
 *
 * The load path enforces this: SpO₂ records are fetched in full (small), HR
 * record DATES are enumerated with a keys-only cursor (no value blobs), and the
 * single HR record for a date is fetched by key ONLY when SpO₂ did not cover it.
 * Full HR sample blobs are therefore never bulk-materialised to build the table.
 *
 * The full-resolution HR arrays that the lanes render still pass through
 * {@link applyOffset} at read time in the consuming hooks; this module only ever
 * loads the compact SpO₂ minute data (plus HR fallback nights) to BUILD the
 * table.
 *
 * ## Caching & invalidation
 *
 * The resolved table is cached at module scope keyed by source. It is
 * invalidated (recomputed on next request) whenever the data changes — signalled
 * by `useDataStore.lastImportAt` (bumped on every CPAP/wearable import) and by
 * {@link resetWearableOffsets} (used by cache clears / tests). Recompute happens
 * on data change, never on every render.
 *
 * ## Fallback zone (DST-aware, Profile.csv-preferred)
 *
 * For any date the CPAP-overlap path cannot resolve, the fallback derives the
 * signed offset from an IANA zone FOR THAT DATE, so DST transitions are
 * respected (see {@link ianaZoneOffsetForDate}). The zone is the account's
 * `Profile.csv` IANA zone when one was captured at import (persisted per source
 * in the IndexedDB `settings` store; see
 * {@link module:services/import/googlehealth/profile}), OVERRIDING the browser's
 * runtime zone — because a user may view data recorded in a different zone. When
 * no Profile zone is stored, the browser's zone
 * (`Intl.DateTimeFormat().resolvedOptions().timeZone`) is used. Note the Profile
 * zone reflects the CURRENT account zone, not a per-date travel history; it only
 * affects dates the CPAP-anchored path did not already resolve.
 *
 * @module hooks/useWearableOffsets
 */

import { useEffect, useState } from 'react';
import { useDataStore } from '@/stores/useDataStore';
import { getDB } from '@/services/storage/getDB';
import type { IndexedDBService } from '@/services/storage/IndexedDBService';
import { profileTimeZoneSettingKey } from '@/services/import/googlehealth/profile';
import { sessionWallClockEpoch, sessionDateKey } from '@/utils/wallClock';
import {
  resolveOffsetTable,
  type LocalSessionWindow,
  type NightWithSessions,
  type WearableNight,
  type UtcWearableSample,
  type FallbackOffsetForDate,
} from '@/analysis/crossSource/wearableTimezone';
import { localIsoToWallClockEpoch } from '@/utils/wallClock';
import type { IntegrationTimeseries, FitbitSpO2Intraday, FitbitHeartRateIntraday } from '@/types';

const MS_PER_MINUTE = 60_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Fallback: browser IANA-zone offset for a given date (DST-aware)
// ---------------------------------------------------------------------------

/**
 * Signed civil UTC offset, in minutes, of the given IANA `timeZone` on the given
 * `YYYY-MM-DD` date (evaluated at local noon to stay clear of DST-transition
 * midnights). Positive = east of Greenwich. Returns `null` if the zone/date
 * cannot be resolved.
 *
 * ## Method (DST-aware, deterministic under a pinned `TZ`)
 *
 * We format a fixed UTC instant (that date at 12:00Z) into the target zone with
 * `Intl.DateTimeFormat` and read back the zone's wall-clock parts. The signed
 * difference between the zone wall-clock and the UTC wall-clock IS the offset.
 * This uses the platform's IANA/tz database, so it honours the correct DST rule
 * for that specific date rather than a single fixed offset. It depends only on
 * the passed `timeZone` (not on the process `TZ`), so it is deterministic.
 *
 * @param date     - Target calendar date, `YYYY-MM-DD`.
 * @param timeZone - IANA zone id (e.g. `America/Los_Angeles`).
 * @returns Signed offset minutes to ADD to UTC to obtain local, or `null`.
 */
export function ianaZoneOffsetForDate(date: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [, y, mo, d] = m;
  // A concrete UTC instant on that date, at noon UTC to avoid landing inside a
  // DST-transition window that could straddle the calendar boundary.
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0);
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const get = (type: Intl.DateTimeFormatPartTypes): number => {
      const p = parts.find((x) => x.type === type);
      return p ? Number(p.value) : NaN;
    };
    const zoneWallMs = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    if (Number.isNaN(zoneWallMs)) return null;
    // zoneWall − utcWall = signed offset. Round to the nearest minute (whole
    // civil offsets are integer minutes; guards float noise).
    return Math.round((zoneWallMs - utcMs) / MS_PER_MINUTE);
  } catch {
    // Unknown/invalid zone id.
    return null;
  }
}

/** The runtime browser IANA zone, or `null` if the platform cannot report one. */
export function resolveBrowserTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : null;
  } catch {
    return null;
  }
}

/**
 * Build the {@link FallbackOffsetForDate} seed used when the CPAP-overlap path
 * yields nothing for a date. Resolves the offset per date, DST-aware.
 *
 * Prefers the account's `Profile.csv` IANA zone (`profileZone`) when present and
 * resolvable, OVERRIDING the browser zone — a user may view data recorded in a
 * different zone. Falls back to the browser's runtime zone when no Profile zone
 * is available (or the stored value is not a resolvable IANA id).
 *
 * @param profileZone - The stored Profile.csv IANA zone, or `null`/`undefined`.
 */
export function buildFallbackOffsetForDate(profileZone?: string | null): FallbackOffsetForDate {
  // A stored Profile zone is validated at import time; guard here too by probing
  // resolvability via ianaZoneOffsetForDate (returns null for an invalid zone).
  const preferred =
    profileZone && ianaZoneOffsetForDate('2000-01-01', profileZone) !== null ? profileZone : null;
  const zone = preferred ?? resolveBrowserTimeZone();
  if (zone === null) return () => null;
  return (date: string) => ianaZoneOffsetForDate(date, zone);
}

// ---------------------------------------------------------------------------
// Session grouping
// ---------------------------------------------------------------------------

/**
 * Group CPAP sessions into LOCAL-frame windows keyed by night date. A session is
 * attached to a night both under its own start date AND the previous date, so a
 * wearable night keyed on either side of the midnight the session straddles can
 * find it. Sessions are converted to the wall-clock-as-UTC frame via
 * {@link sessionWallClockEpoch} — the same frame the wearable samples live in.
 */
function groupSessionsByNight(
  sessions: readonly { startTime: string; endTime: string }[],
): Map<string, LocalSessionWindow[]> {
  const byNight = new Map<string, LocalSessionWindow[]>();
  for (const s of sessions) {
    const startMs = sessionWallClockEpoch(s.startTime);
    const endMs = sessionWallClockEpoch(s.endTime);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const window: LocalSessionWindow = { startMs, endMs };
    const startKey = sessionDateKey(s.startTime);
    if (startKey === null) continue;
    push(byNight, startKey, window);
    // Also index under the previous date so a wearable record keyed the evening
    // before (a night that began before midnight) can still find this session.
    push(byNight, shiftDateKey(startKey, -1), window);
  }
  return byNight;
}

function push(map: Map<string, LocalSessionWindow[]>, key: string, w: LocalSessionWindow): void {
  const list = map.get(key);
  if (list) list.push(w);
  else map.set(key, [w]);
}

/** Shift a `YYYY-MM-DD` key by whole days via {@link Date.UTC} (TZ-independent). */
function shiftDateKey(date: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d)) + deltaDays * DAY_MS;
  const dt = new Date(ms);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Sessions overlapping a wearable night keyed on `date` (its own + prev-day index). */
function sessionsForNight(
  byNight: Map<string, LocalSessionWindow[]>,
  date: string,
): LocalSessionWindow[] {
  return byNight.get(date) ?? [];
}

// ---------------------------------------------------------------------------
// Wearable-night construction (SpO₂-first anchoring)
// ---------------------------------------------------------------------------

/** Convert a stored SpO₂ record into a sleep-only UTC wearable night. */
function spo2Night(record: IntegrationTimeseries): WearableNight | null {
  const data = record.data as FitbitSpO2Intraday;
  const base = localIsoToWallClockEpoch(data.sleepStartTime);
  if (Number.isNaN(base)) return null;
  const samples: UtcWearableSample[] = [];
  for (const s of data.samples) {
    const timestampMs = base + s.minuteOffset * MS_PER_MINUTE;
    if (!Number.isFinite(timestampMs)) continue;
    samples.push({ timestampMs });
  }
  if (samples.length < 2) return null;
  return { date: record.date, samples, sleepOnly: true };
}

/** Convert a stored heart-rate record into a 24/7 UTC wearable night (value-bearing). */
function hrNight(record: IntegrationTimeseries): WearableNight | null {
  const data = record.data as FitbitHeartRateIntraday;
  const base = data.baseTimestampMs;
  if (!Number.isFinite(base)) return null;
  const samples: UtcWearableSample[] = [];
  for (const s of data.samples) {
    const timestampMs = base + s.offsetSec * 1000;
    if (!Number.isFinite(timestampMs) || !Number.isFinite(s.bpm)) continue;
    samples.push({ timestampMs, value: s.bpm });
  }
  if (samples.length < 2) return null;
  return { date: record.date, samples, sleepOnly: false };
}

// ---------------------------------------------------------------------------
// Table build (the async worker behind the cache)
// ---------------------------------------------------------------------------

/**
 * Read the stored Profile.csv fallback zone for `source` from the IndexedDB
 * `settings` store, or `null` when none is stored / on any read error.
 */
async function loadProfileZone(db: IndexedDBService, source: string): Promise<string | null> {
  try {
    const setting = await db.getSetting(profileTimeZoneSettingKey(source));
    const value = setting?.value;
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Load sessions + the UTC wearable lanes and resolve the per-date offset table.
 *
 * SpO₂ is the preferred anchor (sleep-only, small); HR nights are loaded as an
 * anchor only where SpO₂ is absent. Nights that resolve neither are still
 * present as null estimates and get filled by neighbour / fallback inside
 * {@link resolveOffsetTable}.
 *
 * ## Cheap load path (principle #3)
 *
 * The output is identical to loading every record, but HR sample blobs are never
 * bulk-materialised: SpO₂ records (small, sleep-only) are loaded in full; the
 * DATES of HR records are enumerated keys-only (no value blobs); and the single
 * HR record for a date is fetched by key ONLY when SpO₂ did not already cover it.
 */
async function computeOffsetTable(source: string): Promise<Map<string, number>> {
  const db = await getDB();

  const [sessions, spo2Records, hrDates, profileZone] = await Promise.all([
    db.getAllSessions(),
    // SpO₂ is small (minute cadence, sleep-only). The compound-index range visits
    // ONLY spo₂ records — HR blobs are never touched by this query.
    db.getIntegrationTimeseriesBySourceAndType(source, 'spo2_intraday'),
    // HR is 24/7 and huge (~17k samples/night). Enumerate only its DATES via a
    // keys-only cursor so no HR value blob is deserialised here; the few nights
    // that actually need an HR anchor are fetched one-by-one by key below.
    db.getIntegrationTimeseriesDatesBySourceAndType(source, 'heart_rate_intraday'),
    // The account's Profile.csv IANA zone (preferred fallback), if captured.
    loadProfileZone(db, source),
  ]);

  const byNight = groupSessionsByNight(sessions.filter((s) => !s.deleted));

  const nights: NightWithSessions[] = [];
  const seen = new Set<string>();

  // 1. SpO₂-anchored nights (cheap, sleep-only) — covers most dates.
  for (const record of spo2Records) {
    const night = spo2Night(record);
    if (night === null) continue;
    nights.push({ night, sessions: sessionsForNight(byNight, record.date) });
    seen.add(record.date);
  }

  // 2. HR-anchored nights ONLY for dates SpO₂ did not cover. The full HR sample
  //    blob is fetched (by key) for these dates ALONE, never for SpO₂-covered
  //    dates — the compact SpO₂ already resolved those nights (principle #3).
  //    NOTE(perf follow-up): for a device with NO SpO₂ at all, every HR night is
  //    fetched here in a separate keyed transaction. Correct and off the render
  //    path (memoized per import), but a future optimisation could bulk-load HR
  //    via getIntegrationTimeseriesBySourceAndType in that all-HR case.
  for (const date of hrDates) {
    if (seen.has(date)) continue;
    seen.add(date); // idempotent guard (the compound key is unique anyway)
    const record = await db.getIntegrationTimeseriesByKey(source, 'heart_rate_intraday', date);
    if (record === null) continue;
    const night = hrNight(record);
    if (night === null) continue;
    nights.push({ night, sessions: sessionsForNight(byNight, date) });
  }

  return resolveOffsetTable(nights, {}, buildFallbackOffsetForDate(profileZone));
}

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  /** The `lastImportAt` value the table was computed under (invalidation key). */
  readonly importToken: string | null;
  readonly promise: Promise<Map<string, number>>;
}

const cache = new Map<string, CacheEntry>();

/**
 * Get the shared per-date offset table for `source`, computing (and caching) it
 * on first use or after a data change. All consumers receive the SAME resolved
 * {@link Map}, guaranteeing identical offsets across every UTC lane.
 *
 * @param source      - Integration source (e.g. `'fitbit'`).
 * @param importToken - Current `useDataStore.lastImportAt`; a change invalidates.
 */
export function getWearableOffsetTable(
  source: string,
  importToken: string | null,
): Promise<Map<string, number>> {
  const existing = cache.get(source);
  if (existing && existing.importToken === importToken) {
    return existing.promise;
  }
  const promise = computeOffsetTable(source).catch((err: unknown) => {
    // On failure, drop the cache entry so a later call retries, and degrade to
    // an empty table (UTC lanes render unshifted rather than the app crashing).
    if (cache.get(source)?.promise === promise) cache.delete(source);
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console -- DEV-only diagnostic, no PII.
      console.warn('[useWearableOffsets] failed to compute offset table', err);
    }
    return new Map<string, number>();
  });
  cache.set(source, { importToken, promise });
  return promise;
}

/** Clear the cached offset tables (used by data-clear flows and tests). */
export function resetWearableOffsets(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/** Result of {@link useWearableOffsets}. */
export interface WearableOffsetsResult {
  /** date → signed offset minutes (to ADD to a UTC clock to get local). */
  readonly table: ReadonlyMap<string, number>;
  /** True while the table is being computed. */
  readonly loading: boolean;
}

const EMPTY_TABLE: ReadonlyMap<string, number> = new Map<string, number>();

/**
 * Subscribe to the shared per-date offset table for `source`. Recomputes only
 * when the data changes (via `useDataStore.lastImportAt`), never per render.
 */
export function useWearableOffsets(source = 'fitbit'): WearableOffsetsResult {
  const importToken = useDataStore((s) => s.lastImportAt);
  const [table, setTable] = useState<ReadonlyMap<string, number>>(EMPTY_TABLE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getWearableOffsetTable(source, importToken).then((resolved) => {
      if (cancelled) return;
      setTable(resolved);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [source, importToken]);

  return { table, loading };
}

/**
 * Look up the offset (minutes) for a `YYYY-MM-DD` date, defaulting to 0 (no
 * shift) when the table has no entry. Centralised so every consumer applies the
 * same "unknown date ⇒ leave in place" rule.
 */
export function offsetForDate(table: ReadonlyMap<string, number>, date: string): number {
  return table.get(date) ?? 0;
}
