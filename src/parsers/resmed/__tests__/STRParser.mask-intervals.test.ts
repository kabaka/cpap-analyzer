/**
 * Tests for STR.edf mask-on/off interval extraction.
 *
 * The real STR.edf `MaskOn` / `MaskOff` channels store up to 10 intervals per
 * day. Per the OSCAR ResmedLoader reference decoder, the stored values are
 * **minutes since NOON** of the record's calendar date — ResMed splits days at
 * noon. A value `> 720` therefore crosses midnight into the next calendar day
 * and must NOT be discarded. A non-positive value (`0` or `-1`) marks an unused
 * slot. The `Date` channel holds the ResMed day value: days since the Unix
 * epoch (1970-01-01 UTC), NOT an Excel/Lotus serial value.
 *
 * (An earlier revision of this parser treated the values as minutes-of-day from
 * midnight with a hard `> 1440` reject. That was wrong: it conflicted with
 * OSCAR and silently destroyed real late/cross-midnight sessions. These tests
 * assert the corrected noon-anchored semantics.)
 */

import { describe, it, expect } from 'vitest';
import { STRParser } from '@/parsers/resmed/STRParser';

/**
 * ResMed STR `Date` day value for a given local calendar date: whole days
 * since the Unix epoch (1970-01-01 UTC). Mirrors the real hardware convention
 * decoded by STRParser (see RESMED_STR_DAY_EPOCH_MS), not the Excel/Lotus epoch.
 */
function dayValue(year: number, month1: number, day: number): number {
  const epoch = Date.UTC(1970, 0, 1);
  const target = Date.UTC(year, month1 - 1, day);
  return Math.round((target - epoch) / 86_400_000);
}

/** Build a flat Float32Array for a multi-slot channel: rows × slots. */
function slotChannel(rows: number[][]): Float32Array {
  const slots = rows[0]?.length ?? 0;
  const out = new Float32Array(rows.length * slots);
  rows.forEach((row, r) => row.forEach((v, s) => (out[r * slots + s] = v)));
  return out;
}

const SENTINEL = -1;
const FILL = (v: number): number[] => [v, ...Array<number>(9).fill(SENTINEL)];

/** Local NOON of the record's calendar date — the anchor for minutes-since-noon. */
function localNoon(year: number, month1: number, day: number): Date {
  return new Date(year, month1 - 1, day, 12, 0, 0, 0);
}

/** Absolute wall-clock time for a minutes-since-noon slot value. */
function noonPlus(noon: Date, minutes: number): Date {
  return new Date(noon.getTime() + minutes * 60_000);
}

describe('STRParser — mask interval extraction', () => {
  const parser = new STRParser();
  const startDate = new Date(2024, 8, 17, 12, 0, 0); // 2024-09-17 local

  it('decodes a slot as minutes since noon and keys it under the record date', () => {
    const dv = dayValue(2024, 9, 17);
    // 120 min since noon = noon + 2h = 14:00 (same calendar day as the record).
    const result = parser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([dv]), samplesPerRecord: 1 },
        { label: 'MaskOn', samples: slotChannel([FILL(120)]), samplesPerRecord: 10 },
        { label: 'MaskOff', samples: slotChannel([FILL(360)]), samplesPerRecord: 10 },
      ],
      startDate,
      1,
    );

    const noon = localNoon(2024, 9, 17);
    const intervals = result.maskIntervalsByDate.get('2024-09-17');
    expect(intervals).toBeDefined();
    expect(intervals).toHaveLength(1);
    const iv = intervals![0]!;
    // 120 → 14:00, 360 → 18:00, both same calendar day.
    expect(iv.start).toEqual(noonPlus(noon, 120));
    expect(iv.end).toEqual(noonPlus(noon, 360));
    expect(iv.start).toEqual(new Date(2024, 8, 17, 14, 0, 0));
    expect(iv.end).toEqual(new Date(2024, 8, 17, 18, 0, 0));
    expect((iv.end.getTime() - iv.start.getTime()) / 60000).toBe(240);
  });

  it('rolls a slot past midnight when minutes-since-noon exceed 720, keying it under the following date', () => {
    const dv = dayValue(2024, 9, 17);
    // 735 min since noon = noon + 12h15m = next-day 00:15.
    // 1145 min since noon = noon + 19h05m = next-day 07:05.
    const result = parser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([dv]), samplesPerRecord: 1 },
        { label: 'MaskOn', samples: slotChannel([FILL(735)]), samplesPerRecord: 10 },
        { label: 'MaskOff', samples: slotChannel([FILL(1145)]), samplesPerRecord: 10 },
      ],
      startDate,
      1,
    );

    // The interval's start wall-clock falls on the NEXT calendar day, so it is
    // keyed there — NOT under the record date 2024-09-17.
    expect(result.maskIntervalsByDate.has('2024-09-17')).toBe(false);
    const intervals = result.maskIntervalsByDate.get('2024-09-18');
    expect(intervals).toBeDefined();
    expect(intervals).toHaveLength(1);
    const iv = intervals![0]!;
    expect(iv.start).toEqual(new Date(2024, 8, 18, 0, 15, 0));
    expect(iv.end).toEqual(new Date(2024, 8, 18, 7, 5, 0));
    // Duration 410 min (1145 − 735), unchanged by the noon anchoring.
    expect((iv.end.getTime() - iv.start.getTime()) / 60000).toBe(410);
  });

  it('extracts multiple intervals per record, ignoring -1 sentinel slots and routing each to its start-date key', () => {
    const dv = dayValue(2024, 9, 18);
    // 5 used slots, 5 unused. Mix of same-afternoon and cross-midnight values.
    //   114→115 : noon+1h54m → noon+1h55m  (same day, 1 min)
    //   119→120 : noon+1h59m → noon+2h00m  (same day, 1 min)
    //   769→1322: next-day 00:49 → next-day 10:02 (cross-midnight, 553 min)
    const on = [114, 119, 769, -1, -1, -1, -1, -1, -1, -1];
    const off = [115, 120, 1322, -1, -1, -1, -1, -1, -1, -1];
    const result = parser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([dv]), samplesPerRecord: 1 },
        { label: 'MaskOn', samples: slotChannel([on]), samplesPerRecord: 10 },
        { label: 'MaskOff', samples: slotChannel([off]), samplesPerRecord: 10 },
      ],
      startDate,
      1,
    );

    // Same-day intervals (114, 119) key under the record date 2024-09-18.
    const sameDay = result.maskIntervalsByDate.get('2024-09-18');
    expect(sameDay).toHaveLength(2);
    // Cross-midnight interval (769) keys under the following date 2024-09-19.
    const nextDay = result.maskIntervalsByDate.get('2024-09-19');
    expect(nextDay).toHaveLength(1);

    const allMinutes = [...(sameDay ?? []), ...(nextDay ?? [])].reduce(
      (sum, iv) => sum + (iv.end.getTime() - iv.start.getTime()) / 60000,
      0,
    );
    // 1 + 1 + 553 = 555 minutes of recorded mask-on time across the day.
    expect(allMinutes).toBe(555);

    const cross = nextDay![0]!;
    expect(cross.start).toEqual(new Date(2024, 8, 19, 0, 49, 0));
    expect(cross.end).toEqual(new Date(2024, 8, 19, 10, 2, 0));
  });

  it('does NOT discard values above 1440 (minutes-since-noon noon-boundary spill)', () => {
    const dv = dayValue(2024, 9, 17);
    // 1500 min since noon = noon + 25h = next-day 13:00. Under the OLD midnight
    // semantics this was > 1440 and hard-rejected; under noon anchoring it is a
    // legitimate late-morning session that must survive.
    const result = parser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([dv]), samplesPerRecord: 1 },
        { label: 'MaskOn', samples: slotChannel([FILL(1500)]), samplesPerRecord: 10 },
        { label: 'MaskOff', samples: slotChannel([FILL(1700)]), samplesPerRecord: 10 },
      ],
      startDate,
      1,
    );

    const intervals = result.maskIntervalsByDate.get('2024-09-18');
    expect(intervals).toHaveLength(1);
    const iv = intervals![0]!;
    expect(iv.start).toEqual(new Date(2024, 8, 18, 13, 0, 0));
    expect(iv.end).toEqual(new Date(2024, 8, 18, 16, 20, 0)); // 1700 min → next-day 16:20
    expect((iv.end.getTime() - iv.start.getTime()) / 60000).toBe(200);
  });

  it('rejects gross out-of-range garbage above the 2880-minute sanity max', () => {
    const dv = dayValue(2024, 9, 17);
    // 5000 min is well past two days of minutes-since-noon → decode garbage.
    const result = parser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([dv]), samplesPerRecord: 1 },
        { label: 'MaskOn', samples: slotChannel([FILL(5000)]), samplesPerRecord: 10 },
        { label: 'MaskOff', samples: slotChannel([FILL(5100)]), samplesPerRecord: 10 },
      ],
      startDate,
      1,
    );
    expect(result.maskIntervalsByDate.size).toBe(0);
  });

  it('treats both 0 and -1 as empty slots', () => {
    const dv = dayValue(2024, 9, 17);
    // Slot 0: on=0 (sentinel zero). Slot 1: on=-1 (legacy sentinel). Slot 2: real.
    const on = [0, -1, 200, -1, -1, -1, -1, -1, -1, -1];
    const off = [600, -1, 400, -1, -1, -1, -1, -1, -1, -1];
    const result = parser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([dv]), samplesPerRecord: 1 },
        { label: 'MaskOn', samples: slotChannel([on]), samplesPerRecord: 10 },
        { label: 'MaskOff', samples: slotChannel([off]), samplesPerRecord: 10 },
      ],
      startDate,
      1,
    );
    // Only the real slot (200→400) survives; the 0 and -1 slots are dropped even
    // though their MaskOff values are positive.
    const intervals = result.maskIntervalsByDate.get('2024-09-17');
    expect(intervals).toHaveLength(1);
    const iv = intervals![0]!;
    expect((iv.end.getTime() - iv.start.getTime()) / 60000).toBe(200);
    expect(iv.start).toEqual(new Date(2024, 8, 17, 12 + 3, 20, 0)); // noon + 200 min = 15:20
  });

  it('skips malformed slots where MaskOff < MaskOn', () => {
    const dv = dayValue(2024, 9, 19);
    const result = parser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([dv]), samplesPerRecord: 1 },
        {
          label: 'MaskOn',
          samples: slotChannel([[600, 900, ...Array<number>(8).fill(-1)]]),
          samplesPerRecord: 10,
        },
        // second slot inverted (800 < 900) → dropped
        {
          label: 'MaskOff',
          samples: slotChannel([[700, 800, ...Array<number>(8).fill(-1)]]),
          samplesPerRecord: 10,
        },
      ],
      startDate,
      1,
    );
    // 600→700 = 100 min, same day (both < 720, key under record date).
    const intervals = result.maskIntervalsByDate.get('2024-09-19');
    expect(intervals).toHaveLength(1);
    expect((intervals![0]!.end.getTime() - intervals![0]!.start.getTime()) / 60000).toBe(100);
  });

  it('returns an empty mask map when MaskOn/MaskOff channels are absent (older firmware)', () => {
    const result = parser.parseFromRawChannels(
      [{ label: 'S.C.Press', samples: new Float32Array([10]), samplesPerRecord: 1 }],
      startDate,
      1,
    );
    expect(result.maskIntervalsByDate.size).toBe(0);
    // settings extraction still works
    expect(result.settingsByDate.size).toBe(1);
  });

  it('handles a day with no usage (all sentinel) by omitting the date key', () => {
    const dv = dayValue(2024, 9, 20);
    const result = parser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([dv]), samplesPerRecord: 1 },
        {
          label: 'MaskOn',
          samples: slotChannel([Array<number>(10).fill(-1)]),
          samplesPerRecord: 10,
        },
        {
          label: 'MaskOff',
          samples: slotChannel([Array<number>(10).fill(-1)]),
          samplesPerRecord: 10,
        },
      ],
      startDate,
      1,
    );
    expect(result.maskIntervalsByDate.has('2024-09-20')).toBe(false);
  });
});
