/**
 * Tests for STR.edf mask-on/off interval extraction.
 *
 * The real STR.edf `MaskOn` / `MaskOff` channels store up to 10 intervals per
 * day as minutes-of-day (0–1440), with the sentinel -1 for unused slots, and a
 * `Date` channel holding the ResMed Excel-serial day value. These structural
 * facts were confirmed against a real device file; tests use synthetic data.
 */

import { describe, it, expect } from 'vitest';
import { STRParser } from '@/parsers/resmed/STRParser';

/** ResMed Excel-serial day value for a given local calendar date. */
function dayValue(year: number, month1: number, day: number): number {
  const epoch = Date.UTC(1899, 11, 30);
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

describe('STRParser — mask interval extraction', () => {
  const parser = new STRParser();
  const startDate = new Date(2024, 8, 17, 12, 0, 0); // 2024-09-17 local

  it('extracts a single mask interval as absolute local times', () => {
    const dv = dayValue(2024, 9, 17);
    const result = parser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([dv]), samplesPerRecord: 1 },
        // 735 min = 12:15, 1145 min = 19:05 (minutes-of-day)
        { label: 'MaskOn', samples: slotChannel([FILL(735)]), samplesPerRecord: 10 },
        { label: 'MaskOff', samples: slotChannel([FILL(1145)]), samplesPerRecord: 10 },
      ],
      startDate,
      1,
    );

    const intervals = result.maskIntervalsByDate.get('2024-09-17');
    expect(intervals).toBeDefined();
    expect(intervals).toHaveLength(1);
    const iv = intervals![0]!;
    expect(iv.start).toEqual(new Date(2024, 8, 17, 12, 15, 0));
    expect(iv.end).toEqual(new Date(2024, 8, 17, 19, 5, 0));
    // Duration 410 min matches the device's per-day Duration field.
    expect((iv.end.getTime() - iv.start.getTime()) / 60000).toBe(410);
  });

  it('extracts multiple intervals per day and ignores -1 sentinel slots', () => {
    const dv = dayValue(2024, 9, 18);
    // Real example: 5 intervals totalling 553 minutes, 5 unused slots.
    const on = [114, 115, 119, 769, 771, -1, -1, -1, -1, -1];
    const off = [114, 116, 120, 770, 1321, -1, -1, -1, -1, -1];
    const result = parser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([dv]), samplesPerRecord: 1 },
        { label: 'MaskOn', samples: slotChannel([on]), samplesPerRecord: 10 },
        { label: 'MaskOff', samples: slotChannel([off]), samplesPerRecord: 10 },
      ],
      startDate,
      1,
    );

    const intervals = result.maskIntervalsByDate.get('2024-09-18');
    expect(intervals).toHaveLength(5);
    const totalMin = intervals!.reduce(
      (sum, iv) => sum + (iv.end.getTime() - iv.start.getTime()) / 60000,
      0,
    );
    expect(totalMin).toBe(553);
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
