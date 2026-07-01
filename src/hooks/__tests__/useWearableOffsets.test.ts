/**
 * Tests for useWearableOffsets — the shared per-date UTC→local offset provider.
 *
 * Two concerns are covered here, deliberately separated:
 *
 * 1. **Fallback-zone math** ({@link ianaZoneOffsetForDate}): the DST-aware,
 *    deterministic derivation of a signed civil offset from an IANA zone id for a
 *    specific date. This is pure and does NOT depend on the process `TZ` (it
 *    passes the zone explicitly), so it is asserted directly with known values.
 * 2. **End-to-end table build + shared cache** ({@link getWearableOffsetTable}):
 *    that the provider loads sessions + the UTC lanes, resolves an offset via
 *    CPAP overlap, memoizes it per `importToken`, and invalidates on change.
 *
 * @module hooks/__tests__/useWearableOffsets.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDB, resetDB } from '@/services/storage/getDB';
import type {
  FitbitSpO2Intraday,
  FitbitHeartRateIntraday,
  IntegrationTimeseries,
  Session,
} from '@/types';
import {
  ianaZoneOffsetForDate,
  getWearableOffsetTable,
  resetWearableOffsets,
  offsetForDate,
  buildFallbackOffsetForDate,
} from '@/hooks/useWearableOffsets';

// ---------------------------------------------------------------------------
// 1. Fallback-zone math (pure, TZ-independent because zone is explicit)
// ---------------------------------------------------------------------------

describe('ianaZoneOffsetForDate', () => {
  it('returns the standard-time offset in winter (PST = -480)', () => {
    // 2024-01-15 is in Pacific Standard Time.
    expect(ianaZoneOffsetForDate('2024-01-15', 'America/Los_Angeles')).toBe(-480);
  });

  it('returns the daylight-time offset in summer (PDT = -420), i.e. DST-aware', () => {
    // 2024-07-15 is in Pacific Daylight Time.
    expect(ianaZoneOffsetForDate('2024-07-15', 'America/Los_Angeles')).toBe(-420);
  });

  it('handles an eastern (positive) zone with DST (Berlin CET +60 / CEST +120)', () => {
    expect(ianaZoneOffsetForDate('2024-01-15', 'Europe/Berlin')).toBe(60);
    expect(ianaZoneOffsetForDate('2024-07-15', 'Europe/Berlin')).toBe(120);
  });

  it('handles UTC as zero', () => {
    expect(ianaZoneOffsetForDate('2024-03-10', 'UTC')).toBe(0);
  });

  it('handles a half-hour zone (India = +330)', () => {
    expect(ianaZoneOffsetForDate('2024-06-01', 'Asia/Kolkata')).toBe(330);
  });

  it('returns null for a malformed date', () => {
    expect(ianaZoneOffsetForDate('not-a-date', 'America/Los_Angeles')).toBeNull();
  });

  it('returns null for an unknown zone id', () => {
    expect(ianaZoneOffsetForDate('2024-01-15', 'Not/AZone')).toBeNull();
  });

  it('is deterministic regardless of how many times it is called', () => {
    const a = ianaZoneOffsetForDate('2024-07-15', 'America/Los_Angeles');
    const b = ianaZoneOffsetForDate('2024-07-15', 'America/Los_Angeles');
    expect(a).toBe(b);
    expect(a).toBe(-420);
  });
});

describe('buildFallbackOffsetForDate', () => {
  it('produces a function that resolves per-date offsets from the browser zone', () => {
    // The runtime TZ for the test process is pinned (see vitest config / TZ env);
    // whatever it is, the fallback must agree with the direct zone computation.
    const fn = buildFallbackOffsetForDate();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const winter = fn('2024-01-15');
    const summer = fn('2024-07-15');
    expect(winter).toBe(ianaZoneOffsetForDate('2024-01-15', zone));
    expect(summer).toBe(ianaZoneOffsetForDate('2024-07-15', zone));
  });
});

describe('offsetForDate', () => {
  it('returns the mapped value, or 0 (no shift) for an unknown date', () => {
    const table = new Map<string, number>([['2024-01-15', -420]]);
    expect(offsetForDate(table, '2024-01-15')).toBe(-420);
    expect(offsetForDate(table, '2024-01-16')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. End-to-end table build + shared cache (seeded fake-indexeddb)
// ---------------------------------------------------------------------------

/**
 * A CPAP session in the LOCAL frame. We construct `startTime`/`endTime` ISO
 * strings whose LOCAL wall-clock (as read by `sessionWallClockEpoch`) equals the
 * given clock, independent of the process TZ, by building a Date from local
 * components.
 */
function session(
  date: string,
  startClock: [number, number],
  endClock: [number, number],
  endDayOffset = 0,
): Session {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const start = new Date(y, mo - 1, d, startClock[0], startClock[1], 0, 0);
  const end = new Date(y, mo - 1, d + endDayOffset, endClock[0], endClock[1], 0, 0);
  return {
    id: crypto.randomUUID(),
    machineId: 'm1',
    machineModel: 'AirSense 10',
    machineType: 'cpap',
    firmwareVersion: '1.0',
    date,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    durationMinutes: 480,
    usageMinutes: 480,
    importedAt: '2024-01-01T00:00:00Z',
    sourceHash: crypto.randomUUID(),
    channels: [],
    signalChunkIds: [],
    hasOximetry: false,
    deleted: false,
    machineSettings: null,
  };
}

/**
 * A UTC SpO₂ record whose UTC sleep window is `offsetMinutes` ahead of the local
 * CPAP window (so the estimator should recover exactly `offsetMinutes`). E.g. for
 * a −480 offset (PST) a local 23:00 sleep onset is 07:00Z. We express the UTC
 * `sleepStartTime` directly as a wall-clock-as-UTC string.
 */
function spo2Utc(date: string, utcStart: string, minutes: number): IntegrationTimeseries {
  const samples = Array.from({ length: minutes }, (_, i) => ({
    minuteOffset: i,
    value: 96,
  }));
  const data: FitbitSpO2Intraday = { sleepStartTime: utcStart, samples, sampleCount: minutes };
  return {
    id: crypto.randomUUID(),
    source: 'fitbit',
    dataType: 'spo2_intraday',
    date,
    data: data as IntegrationTimeseries['data'],
    importedAt: '2024-01-01T00:00:00Z',
  };
}

function hrUtc(date: string, baseUtcMs: number, count: number): IntegrationTimeseries {
  // Low HR in the middle (the nocturnal trough), higher at the edges.
  const samples = Array.from({ length: count }, (_, i) => ({
    offsetSec: i * 60,
    bpm: i > count / 4 && i < (3 * count) / 4 ? 52 : 72,
    confidence: 3,
  }));
  const data: FitbitHeartRateIntraday = {
    baseTimestampMs: baseUtcMs,
    samples,
    sampleCount: count,
  };
  return {
    id: crypto.randomUUID(),
    source: 'fitbit',
    dataType: 'heart_rate_intraday',
    date,
    data: data as IntegrationTimeseries['data'],
    importedAt: '2024-01-01T00:00:00Z',
  };
}

async function seed(
  sessions: readonly Session[],
  ts: readonly IntegrationTimeseries[],
): Promise<void> {
  const db = await getDB();
  for (const s of sessions) await db.addSession(s);
  await db.bulkAddIntegrationTimeseries(ts);
}

async function teardown(): Promise<void> {
  const db = await getDB();
  await db.destroy();
  resetDB();
  resetWearableOffsets();
}

describe('getWearableOffsetTable (end-to-end, SpO₂-anchored)', () => {
  beforeEach(async () => {
    await teardown();
  });
  afterEach(async () => {
    await teardown();
  });

  it('recovers the UTC→local offset from CPAP overlap using SpO₂ as the anchor', async () => {
    // Local CPAP night: 23:00 → 07:00 on 2024-01-15 (wall clock).
    // UTC SpO₂ sleep onset at 07:00Z ⇒ local 23:00 requires offset −480 (PST).
    await seed(
      [session('2024-01-15', [23, 0], [7, 0], 1)], // 23:00 → next-day 07:00
      [spo2Utc('2024-01-15', '2024-01-16T07:00:00', 8 * 60)],
    );

    const table = await getWearableOffsetTable('fitbit', 'tok-1');
    expect(table.get('2024-01-15')).toBe(-480);
  });

  it('anchors on the HR nocturnal trough for a night with HR but no SpO₂', async () => {
    // Local CPAP night 23:00 → 07:00 (8 h). HR is UTC: base at 05:00Z with a low
    // trough in the middle; the estimator should recover a plausible offset that
    // aligns the trough to the CPAP window and snaps to the 15-min grid.
    const base = Date.UTC(2024, 2, 20, 5, 0, 0); // 05:00Z start of HR record
    await seed(
      [session('2024-03-20', [23, 0], [7, 0], 1)],
      [hrUtc('2024-03-20', base, 8 * 60)], // 8 h of minute-cadence HR, no SpO₂
    );

    const table = await getWearableOffsetTable('fitbit', 'tok-hr');
    // An offset must be resolved for the night (exact value depends on the trough
    // placement + snap; it must be a real 15-min-grid civil offset in band).
    const off = table.get('2024-03-20');
    expect(off).toBeDefined();
    expect(off! % 15).toBe(0);
    expect(off!).toBeGreaterThanOrEqual(-720);
    expect(off!).toBeLessThanOrEqual(840);
  });

  it('falls back to the browser zone for a date with no CPAP overlap', async () => {
    // No sessions at all ⇒ SpO₂ night has a null estimate ⇒ fallback seeds it.
    await seed([], [spo2Utc('2024-02-10', '2024-02-10T08:00:00', 60)]);

    const table = await getWearableOffsetTable('fitbit', 'tok-fb');
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const expected = ianaZoneOffsetForDate('2024-02-10', zone);
    expect(table.get('2024-02-10')).toBe(expected);
  });

  it('memoizes per importToken and invalidates when it changes', async () => {
    await seed([], [spo2Utc('2024-02-10', '2024-02-10T08:00:00', 60)]);

    const a = getWearableOffsetTable('fitbit', 'tok-A');
    const b = getWearableOffsetTable('fitbit', 'tok-A');
    // Same token ⇒ same in-flight/resolved promise (single computation).
    expect(a).toBe(b);

    const c = getWearableOffsetTable('fitbit', 'tok-B');
    expect(c).not.toBe(a);
    await expect(c).resolves.toBeInstanceOf(Map);
  });
});
