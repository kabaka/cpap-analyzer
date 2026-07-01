/**
 * Known-value tests for the wearable timezone-offset estimator.
 *
 * All epochs are built with {@link Date.UTC} so the assertions are timezone-
 * independent: they encode the wall-clock-as-UTC frame the app uses and pass in
 * any process `TZ`. The synthetic data is anchored on the verified real export
 * (America/Los_Angeles, PDT = UTC−7 on 2026-05-30): a CPAP session at local
 * 02:00→11:30 and a UTC-sourced HR sleep block at 09:00Z→18:30Z, whose true
 * signed offset is −420 minutes.
 *
 * @module analysis/crossSource/wearableTimezone.test
 */

import { describe, it, expect } from 'vitest';
import {
  applyOffset,
  snapOffsetMinutes,
  estimateNightOffsetMinutes,
  buildOffsetTable,
  resolveOffsetTable,
  type LocalSessionWindow,
  type WearableNight,
  type UtcWearableSample,
  type NightOffsetEstimate,
  type NightWithSessions,
} from '../wearableTimezone';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Local-frame epoch for a wall-clock (Y, M0-based, D, h, m) via Date.UTC. */
function wall(y: number, m0: number, d: number, h: number, mi: number): number {
  return Date.UTC(y, m0, d, h, mi, 0, 0);
}

/**
 * Build value-bearing samples spanning [startMs, endMs] at `stepMin` cadence,
 * each carrying `value` (bpm). Used to synthesise HR traces.
 */
function ramp(startMs: number, endMs: number, stepMin: number, value: number): UtcWearableSample[] {
  const out: UtcWearableSample[] = [];
  const step = stepMin * 60_000;
  for (let t = startMs; t <= endMs; t += step) out.push({ timestampMs: t, value });
  return out;
}

/**
 * A full 24/7 HR day (07:00Z→07:00Z next day, matching the real file span) with
 * a low-HR sleep trough over [sleepStartMs, sleepEndMs] and higher waking HR
 * elsewhere. Values are the sleep discriminator.
 */
function hr247(dayStartMs: number, sleepStartMs: number, sleepEndMs: number): UtcWearableSample[] {
  const dayEndMs = dayStartMs + 24 * 3_600_000;
  const out: UtcWearableSample[] = [];
  const step = 5 * 60_000; // 5-minute cadence
  for (let t = dayStartMs; t <= dayEndMs; t += step) {
    const asleep = t >= sleepStartMs && t <= sleepEndMs;
    out.push({ timestampMs: t, value: asleep ? 52 : 78 });
  }
  return out;
}

// Anchor night: 2026-05-30, America/Los_Angeles PDT (UTC−7 → −420 min).
const CPAP_2026_05_30: LocalSessionWindow = {
  startMs: wall(2026, 4, 30, 2, 0), // 02:00 local
  endMs: wall(2026, 4, 30, 11, 30), // 11:30 local
};
// UTC HR sleep block for the same physical night, shifted +7h: 09:00Z→18:30Z.
const HR_SLEEP_START = wall(2026, 4, 30, 9, 0);
const HR_SLEEP_END = wall(2026, 4, 30, 18, 30);
// The 24/7 file spans local-midnight→midnight = 07:00Z→07:00Z.
const HR_DAY_START = wall(2026, 4, 30, 7, 0);

// ---------------------------------------------------------------------------
// applyOffset — sign convention
// ---------------------------------------------------------------------------

describe('applyOffset', () => {
  it('maps 09:00Z to 02:00 local for offset −420 (PDT)', () => {
    const utc0900 = wall(2026, 4, 30, 9, 0);
    const expectedLocal = wall(2026, 4, 30, 2, 0);
    expect(applyOffset(utc0900, -420)).toBe(expectedLocal);
  });

  it('maps 00:00Z to +02:00 local for offset +120 (CEST)', () => {
    const utc = wall(2026, 4, 30, 0, 0);
    expect(applyOffset(utc, 120)).toBe(wall(2026, 4, 30, 2, 0));
  });

  it('is the identity for offset 0', () => {
    const t = wall(2026, 4, 30, 12, 34);
    expect(applyOffset(t, 0)).toBe(t);
  });
});

// ---------------------------------------------------------------------------
// snapOffsetMinutes
// ---------------------------------------------------------------------------

describe('snapOffsetMinutes', () => {
  it('snaps a slightly-noisy value to the 15-min grid', () => {
    expect(snapOffsetMinutes(-418)).toBe(-420);
    expect(snapOffsetMinutes(-423)).toBe(-420);
    expect(snapOffsetMinutes(-412)).toBe(-405);
  });

  it('preserves a genuine 30-min-offset zone (−450 = UTC−7:30)', () => {
    expect(snapOffsetMinutes(-451)).toBe(-450);
    expect(snapOffsetMinutes(-449)).toBe(-450);
  });

  it('is exact on grid points', () => {
    expect(snapOffsetMinutes(-480)).toBe(-480);
    expect(snapOffsetMinutes(330)).toBe(330); // India UTC+5:30
  });
});

// ---------------------------------------------------------------------------
// estimateNightOffsetMinutes — the core
// ---------------------------------------------------------------------------

describe('estimateNightOffsetMinutes', () => {
  it('recovers −420 from a 24/7 HR trace with a UTC sleep trough', () => {
    const night: WearableNight = {
      date: '2026-05-30',
      samples: hr247(HR_DAY_START, HR_SLEEP_START, HR_SLEEP_END),
      sleepOnly: false,
    };
    expect(estimateNightOffsetMinutes([CPAP_2026_05_30], night)).toBe(-420);
  });

  it('recovers −420 from sleep-only SpO₂ coverage (09:00Z→18:00Z)', () => {
    // SpO₂ minute data, sleep-only, dense over the sleep block. No trough search.
    const spo2Start = wall(2026, 4, 30, 9, 0);
    const spo2End = wall(2026, 4, 30, 18, 0);
    const night: WearableNight = {
      date: '2026-05-30',
      samples: ramp(spo2Start, spo2End, 1, 96),
      sleepOnly: true,
    };
    expect(estimateNightOffsetMinutes([CPAP_2026_05_30], night)).toBe(-420);
  });

  it('snaps a noisy alignment near −420 to exactly −420', () => {
    // Shift the sleep block by +6 minutes so the raw alignment is ~−414.
    const night: WearableNight = {
      date: '2026-05-30',
      samples: hr247(
        HR_DAY_START + 6 * 60_000,
        HR_SLEEP_START + 6 * 60_000,
        HR_SLEEP_END + 6 * 60_000,
      ),
      sleepOnly: false,
    };
    expect(estimateNightOffsetMinutes([CPAP_2026_05_30], night)).toBe(-420);
  });

  it('recovers a genuine −450 (UTC−7:30) zone', () => {
    // CPAP session identical; wearable sleep block shifted +7:30 instead of +7.
    const start = wall(2026, 4, 30, 9, 30);
    const end = wall(2026, 4, 30, 19, 0);
    const night: WearableNight = {
      date: '2026-05-30',
      samples: ramp(start, end, 1, 95),
      sleepOnly: true,
    };
    expect(estimateNightOffsetMinutes([CPAP_2026_05_30], night)).toBe(-450);
  });

  it('recovers a positive offset (+120, CEST) — sign symmetry', () => {
    // Local CPAP 23:00→06:00 (crosses midnight in local frame is fine as epochs).
    const cpap: LocalSessionWindow = {
      startMs: wall(2026, 4, 30, 23, 0),
      endMs: wall(2026, 4, 31, 6, 0),
    };
    // UTC sleep block is local−2h: 21:00Z→04:00Z next day.
    const start = wall(2026, 4, 30, 21, 0);
    const end = wall(2026, 4, 31, 4, 0);
    const night: WearableNight = {
      date: '2026-05-30',
      samples: ramp(start, end, 1, 95),
      sleepOnly: true,
    };
    expect(estimateNightOffsetMinutes([cpap], night)).toBe(120);
  });

  it('returns null with no CPAP session (no local anchor)', () => {
    const night: WearableNight = {
      date: '2026-05-30',
      samples: ramp(HR_SLEEP_START, HR_SLEEP_END, 1, 95),
      sleepOnly: true,
    };
    expect(estimateNightOffsetMinutes([], night)).toBeNull();
  });

  it('returns null with too few samples', () => {
    const night: WearableNight = {
      date: '2026-05-30',
      samples: [{ timestampMs: HR_SLEEP_START, value: 52 }],
      sleepOnly: true,
    };
    expect(estimateNightOffsetMinutes([CPAP_2026_05_30], night)).toBeNull();
  });

  it('ignores a single stray early sample when locating sleep onset', () => {
    // Dense sleep block 09:00Z→18:00Z plus one detached stray at 04:00Z.
    const block = ramp(wall(2026, 4, 30, 9, 0), wall(2026, 4, 30, 18, 0), 1, 96);
    const stray: UtcWearableSample = { timestampMs: wall(2026, 4, 30, 4, 0), value: 96 };
    const night: WearableNight = {
      date: '2026-05-30',
      samples: [stray, ...block],
      sleepOnly: true,
    };
    // Onset is still 09:00Z → −420, not dragged to 04:00Z.
    expect(estimateNightOffsetMinutes([CPAP_2026_05_30], night)).toBe(-420);
  });

  it('rejects an implausible alignment (feature far from any session)', () => {
    // Sleep-only feature centered a full day away — offset outside civil band.
    const start = wall(2026, 4, 25, 9, 0);
    const end = wall(2026, 4, 25, 18, 0);
    const night: WearableNight = {
      date: '2026-05-30',
      samples: ramp(start, end, 1, 95),
      sleepOnly: true,
    };
    expect(estimateNightOffsetMinutes([CPAP_2026_05_30], night)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildOffsetTable — stabilisation + fill
// ---------------------------------------------------------------------------

describe('buildOffsetTable', () => {
  it('corrects a single outlier night to the surrounding mode', () => {
    const estimates: NightOffsetEstimate[] = [
      { date: '2026-05-28', offsetMinutes: -420 },
      { date: '2026-05-29', offsetMinutes: -420 },
      { date: '2026-05-30', offsetMinutes: -360 }, // outlier (one-hour error)
      { date: '2026-05-31', offsetMinutes: -420 },
      { date: '2026-06-01', offsetMinutes: -420 },
    ];
    const table = buildOffsetTable(estimates);
    expect(table.get('2026-05-30')).toBe(-420);
    expect(table.get('2026-05-28')).toBe(-420);
    expect(table.get('2026-06-01')).toBe(-420);
  });

  it('fills a date with no estimate from its nearest neighbour', () => {
    const estimates: NightOffsetEstimate[] = [
      { date: '2026-05-28', offsetMinutes: -420 },
      { date: '2026-05-29', offsetMinutes: null }, // no overlapping CPAP session
      { date: '2026-05-30', offsetMinutes: -420 },
    ];
    const table = buildOffsetTable(estimates);
    expect(table.get('2026-05-29')).toBe(-420);
  });

  it('preserves a DST-style step without smearing across the boundary', () => {
    // A long PST run (−480) then a long PDT run (−420); the boundary is sharp.
    const estimates: NightOffsetEstimate[] = [];
    for (let d = 1; d <= 8; d++) {
      estimates.push({ date: `2026-03-0${d}`, offsetMinutes: -480 });
    }
    for (let d = 8; d <= 15; d++) {
      const day = d < 10 ? `0${d}` : `${d}`;
      estimates.push({ date: `2026-03-${day}`, offsetMinutes: -420 });
    }
    const table = buildOffsetTable(estimates, { smoothingRadius: 3 });
    // Well before the boundary → PST.
    expect(table.get('2026-03-01')).toBe(-480);
    expect(table.get('2026-03-04')).toBe(-480);
    // Well after the boundary → PDT.
    expect(table.get('2026-03-14')).toBe(-420);
    expect(table.get('2026-03-15')).toBe(-420);
  });

  it('resolves every requested date (no gaps)', () => {
    const estimates: NightOffsetEstimate[] = [
      { date: '2026-05-28', offsetMinutes: null },
      { date: '2026-05-29', offsetMinutes: -420 },
      { date: '2026-05-30', offsetMinutes: null },
    ];
    const table = buildOffsetTable(estimates);
    expect(table.get('2026-05-28')).toBe(-420);
    expect(table.get('2026-05-29')).toBe(-420);
    expect(table.get('2026-05-30')).toBe(-420);
  });

  it('uses the fallback seed only when nothing else resolves', () => {
    const estimates: NightOffsetEstimate[] = [{ date: '2026-05-30', offsetMinutes: null }];
    const table = buildOffsetTable(estimates, {}, (date) => (date === '2026-05-30' ? -480 : null));
    expect(table.get('2026-05-30')).toBe(-480);
  });

  it('omits a date the fallback cannot resolve', () => {
    const estimates: NightOffsetEstimate[] = [{ date: '2026-05-30', offsetMinutes: null }];
    const table = buildOffsetTable(estimates, {}, () => null);
    expect(table.has('2026-05-30')).toBe(false);
  });

  it('does not consult the fallback when a real estimate exists', () => {
    const estimates: NightOffsetEstimate[] = [{ date: '2026-05-30', offsetMinutes: -420 }];
    let called = false;
    const table = buildOffsetTable(estimates, {}, () => {
      called = true;
      return -480;
    });
    expect(table.get('2026-05-30')).toBe(-420);
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveOffsetTable — end-to-end
// ---------------------------------------------------------------------------

describe('resolveOffsetTable', () => {
  it('estimates, stabilises, and fills end-to-end', () => {
    const nights: NightWithSessions[] = [
      {
        night: {
          date: '2026-05-30',
          samples: hr247(HR_DAY_START, HR_SLEEP_START, HR_SLEEP_END),
          sleepOnly: false,
        },
        sessions: [CPAP_2026_05_30],
      },
      {
        // No CPAP session this night → inherits neighbour's offset.
        night: {
          date: '2026-05-31',
          samples: hr247(
            HR_DAY_START + 86_400_000,
            HR_SLEEP_START + 86_400_000,
            HR_SLEEP_END + 86_400_000,
          ),
          sleepOnly: false,
        },
        sessions: [],
      },
    ];
    const table = resolveOffsetTable(nights);
    expect(table.get('2026-05-30')).toBe(-420);
    expect(table.get('2026-05-31')).toBe(-420);
  });
});

// ---------------------------------------------------------------------------
// Determinism / TZ-independence
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces identical results on repeated runs', () => {
    const night: WearableNight = {
      date: '2026-05-30',
      samples: hr247(HR_DAY_START, HR_SLEEP_START, HR_SLEEP_END),
      sleepOnly: false,
    };
    const a = estimateNightOffsetMinutes([CPAP_2026_05_30], night);
    const b = estimateNightOffsetMinutes([CPAP_2026_05_30], night);
    expect(a).toBe(b);
    expect(a).toBe(-420);
  });

  it('does not depend on Date parsing of TZ-less strings (epoch-only inputs)', () => {
    // Sanity: all inputs are numeric epochs; recompute the anchor with Date.UTC
    // and confirm the same answer, independent of any ambient timezone.
    const cpap: LocalSessionWindow = {
      startMs: Date.UTC(2026, 4, 30, 2, 0),
      endMs: Date.UTC(2026, 4, 30, 11, 30),
    };
    const night: WearableNight = {
      date: '2026-05-30',
      samples: ramp(Date.UTC(2026, 4, 30, 9, 0), Date.UTC(2026, 4, 30, 18, 0), 1, 96),
      sleepOnly: true,
    };
    expect(estimateNightOffsetMinutes([cpap], night)).toBe(-420);
  });
});
