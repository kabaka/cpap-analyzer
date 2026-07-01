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
 * ## Fallback zone (DST-aware)
 *
 * For any date the CPAP-overlap path cannot resolve, the fallback derives the
 * signed offset from the browser's IANA zone
 * (`Intl.DateTimeFormat().resolvedOptions().timeZone`) FOR THAT DATE, so DST
 * transitions are respected. See {@link ianaZoneOffsetForDate}.
 *
 * TODO(profile-zone): a `Profile.csv` IANA zone, when present, should OVERRIDE
 * the browser zone (a user may view data recorded in another zone). The seam is
 * {@link buildFallbackOffsetForDate}: swap the zone it reads from browser →
 * profile once Profile parsing exists. Deliberately NOT built here.
 *
 * @module hooks/useWearableOffsets
 */

import { useEffect, useState } from 'react';
import { useDataStore } from '@/stores/useDataStore';
import { getDB } from '@/services/storage/getDB';
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
 * yields nothing for a date. Resolves the offset from the browser IANA zone,
 * per date, DST-aware.
 *
 * TODO(profile-zone): prefer a Profile.csv IANA zone over the browser zone here
 * once Profile parsing lands. This function is the single seam to change.
 */
export function buildFallbackOffsetForDate(): FallbackOffsetForDate {
  const zone = resolveBrowserTimeZone();
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
 * Load sessions + the UTC wearable lanes and resolve the per-date offset table.
 *
 * SpO₂ is the preferred anchor (sleep-only, small); HR nights are loaded as an
 * anchor only where SpO₂ is absent. Nights that resolve neither are still
 * present as null estimates and get filled by neighbour / fallback inside
 * {@link resolveOffsetTable}.
 */
async function computeOffsetTable(source: string): Promise<Map<string, number>> {
  const db = await getDB();

  const [sessions, allTimeseries] = await Promise.all([
    db.getAllSessions(),
    // Bounded date range = every record. The offset table is a per-date map, so
    // we must consider every wearable date, but only the compact SpO₂ (and the
    // HR-only fallback dates) are actually materialised into nights below.
    db.getIntegrationTimeseriesByDateRange('0000-01-01', '9999-12-31'),
  ]);

  const byNight = groupSessionsByNight(sessions.filter((s) => !s.deleted));

  // Index the UTC lanes by date. SpO₂ is the anchor; HR is the fallback anchor.
  const spo2ByDate = new Map<string, IntegrationTimeseries>();
  const hrByDate = new Map<string, IntegrationTimeseries>();
  for (const record of allTimeseries) {
    if (record.source !== source) continue;
    if (record.dataType === 'spo2_intraday') spo2ByDate.set(record.date, record);
    else if (record.dataType === 'heart_rate_intraday') hrByDate.set(record.date, record);
  }

  const nights: NightWithSessions[] = [];
  const seen = new Set<string>();

  // 1. SpO₂-anchored nights (cheap, sleep-only) — covers most dates.
  for (const [date, record] of spo2ByDate) {
    const night = spo2Night(record);
    if (night === null) continue;
    nights.push({ night, sessions: sessionsForNight(byNight, date) });
    seen.add(date);
  }

  // 2. HR-anchored nights ONLY for dates SpO₂ did not cover. Avoids loading giant
  //    HR arrays into the estimator where the compact SpO₂ already resolved the
  //    night (principle #3).
  for (const [date, record] of hrByDate) {
    if (seen.has(date)) continue;
    const night = hrNight(record);
    if (night === null) continue;
    nights.push({ night, sessions: sessionsForNight(byNight, date) });
    seen.add(date);
  }

  return resolveOffsetTable(nights, {}, buildFallbackOffsetForDate());
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
