/**
 * Regression tests for the ResMed STR `Date`-channel epoch decode.
 *
 * THE BUG (fixed): the STR.edf `Date` channel was decoded with the Excel/Lotus
 * serial epoch (1899-12-30) instead of the Unix epoch (1970-01-01). The two
 * differ by 25569 days (~70 years), so every settings record was dated to
 * 1955–1956 instead of the real therapy date. Because `SessionBuilder` looks up
 * machine settings by an exact local calendar date, the mis-dated keys NEVER
 * matched a real session, and `Session.machineSettings` was always `null` — the
 * entire settings UI was silently dead.
 *
 * The fix lives in {@link STRParser}: a single `RESMED_STR_DAY_EPOCH_MS =
 * Date.UTC(1970, 0, 1)` constant feeds both date-decode paths, and the
 * `Date`-channel path formats with **UTC** calendar components (`formatDateUTC`)
 * so a non-zero UTC offset cannot shift the calendar day.
 *
 * These tests guard three things the bug broke:
 *   1. Direct decode — real hardware serials map to the correct ISO date.
 *   2. The settings-key invariant — a decoded STR date intersects a session's
 *      date so `machineSettings` populates (non-null), keyed in 2025/2026 NOT
 *      1955/1956.
 *   3. Timezone robustness — the decode is correct under BOTH UTC and a
 *      negative-offset TZ. QA noted the bug's day-shift component only manifests
 *      in negative-offset timezones, and CI running in UTC could pass spuriously.
 *
 * Real-world fixtures (confirmed from hardware): STR `Date` day value
 *   20216 → 2025-05-08  (also equals the EDF header startDate `08.05.25`)
 *   20614 → 2026-06-10
 *
 * `dayValueToDate` is private, so we drive it through the public
 * `parseFromRawChannels` API and assert on the resulting `settingsByDate` keys.
 *
 * Note on TZ pinning: in this Node/vitest setup, mutating `process.env.TZ` at
 * runtime DOES change `Date`'s behavior (V8 re-reads it per operation). The
 * `runInTimeZone` helper below verifies this with an assertion on the observed
 * offset before running the body, so the timezone-robustness tests cannot pass
 * spuriously if that assumption ever stops holding.
 */

import { describe, it, expect } from 'vitest';
import { STRParser } from '@/parsers/resmed/STRParser';

// ---------------------------------------------------------------------------
// Real-world hardware fixtures
// ---------------------------------------------------------------------------

/** STR `Date` serial → expected ISO date, confirmed from real hardware. */
const HARDWARE_DAY_VALUES: ReadonlyArray<{ serial: number; iso: string }> = [
  // 20216 also equals the EDF header startDate `08.05.25`.
  { serial: 20216, iso: '2025-05-08' },
  { serial: 20614, iso: '2026-06-10' },
];

/** The Excel/Lotus serial epoch the bug used — every record landed ~70y back. */
const BUGGY_EXCEL_ISO = new Set(['1955-05-07', '1955-05-06', '1956-06-09', '1956-06-08']);

// ---------------------------------------------------------------------------
// TZ pinning helper
// ---------------------------------------------------------------------------

/**
 * Run `body` with `process.env.TZ` pinned to `tz`, restoring the prior value
 * afterward. Asserts the pin actually took effect by checking the observed UTC
 * offset of a fixed instant matches `expectedOffsetMinutes` (as reported by
 * `Date.prototype.getTimezoneOffset`, i.e. minutes BEHIND UTC are positive).
 *
 * If the environment ever stops honoring runtime TZ mutation, this assertion
 * fails loudly rather than letting the timezone-robustness tests pass for the
 * wrong reason.
 */
function runInTimeZone(tz: string, expectedOffsetMinutes: number, body: () => void): void {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    // A summer instant so DST-observing zones report their daylight offset
    // (e.g. America/Los_Angeles = PDT = UTC-7 = 420 min in May).
    const observed = new Date(2025, 4, 8, 12, 0, 0).getTimezoneOffset();
    expect(
      observed,
      `runtime TZ pin to ${tz} did not take effect (observed offset ${observed}, expected ${expectedOffsetMinutes}); ` +
        `timezone-robustness assertions below would be meaningless`,
    ).toBe(expectedOffsetMinutes);
    body();
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

/**
 * Decode a single STR `Date` serial through the public parse API and return the
 * sole `settingsByDate` key (the decoded ISO date for that one record).
 */
function decodeSerialToIso(parser: STRParser, serial: number): string {
  const result = parser.parseFromRawChannels(
    [{ label: 'Date', samples: new Float32Array([serial]), samplesPerRecord: 1 }],
    // Fallback start date is intentionally NOT 2025/2026 so a regression that
    // ignored the Date channel and fell back to the EDF start would be visible.
    new Date(2030, 0, 1, 12, 0, 0),
    1,
  );
  const keys = [...result.settingsByDate.keys()];
  expect(keys).toHaveLength(1);
  return keys[0]!;
}

// ---------------------------------------------------------------------------
// 1. Direct decode assertion
// ---------------------------------------------------------------------------

describe('STRParser Date-channel epoch decode (Unix epoch, 1970-01-01)', () => {
  const parser = new STRParser();

  it.each(HARDWARE_DAY_VALUES)(
    'decodes hardware serial $serial to $iso (Unix epoch, not Excel epoch)',
    ({ serial, iso }) => {
      const decoded = decodeSerialToIso(parser, serial);
      expect(decoded).toBe(iso);
      // It must be a 2025/2026 date — NOT the 1955/1956 the Excel-epoch bug gave.
      expect(decoded.slice(0, 4)).not.toBe('1955');
      expect(decoded.slice(0, 4)).not.toBe('1956');
      expect(BUGGY_EXCEL_ISO.has(decoded)).toBe(false);
    },
  );

  it('keys settingsByDate in 2025/2026, never the 1955/1956 of the Excel-epoch bug', () => {
    const result = parser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([20216, 20614]), samplesPerRecord: 1 },
        // A real settings channel so the record carries actual settings, proving
        // the keyed entry is a usable MachineSettings, not an empty placeholder.
        { label: 'S.C.Press', samples: new Float32Array([10, 11]), samplesPerRecord: 1 },
      ],
      new Date(2030, 0, 1, 12, 0, 0),
      2,
    );

    expect([...result.settingsByDate.keys()].sort()).toEqual(['2025-05-08', '2026-06-10']);
    // The 2025-05-08 record carried fixed pressure 10 → min/max both 10.
    const may = result.settingsByDate.get('2025-05-08');
    expect(may).toBeDefined();
    expect(may!.minPressure).toBe(10);
    expect(may!.maxPressure).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 3. Timezone robustness (asserted FIRST so the helper is exercised broadly)
// ---------------------------------------------------------------------------

describe('STRParser Date-channel decode is timezone-robust', () => {
  const parser = new STRParser();

  it('decodes identically under UTC and a negative-offset TZ (America/Los_Angeles)', () => {
    // CI may run in UTC, where the day-shift half of the bug is invisible. Pin
    // BOTH zones and require the same correct result in each.
    runInTimeZone('UTC', 0, () => {
      for (const { serial, iso } of HARDWARE_DAY_VALUES) {
        expect(decodeSerialToIso(parser, serial)).toBe(iso);
      }
    });

    runInTimeZone('America/Los_Angeles', 420, () => {
      for (const { serial, iso } of HARDWARE_DAY_VALUES) {
        // Under the bug's local-getter formatting this would shift back a day in
        // a negative-offset zone (e.g. 1955-05-06 instead of 1955-05-07). The
        // UTC-component formatting must keep it pinned to the true date.
        expect(decodeSerialToIso(parser, serial)).toBe(iso);
      }
    });
  });

  it('also decodes correctly under a positive-offset TZ (Asia/Kolkata, +5:30)', () => {
    // A positive offset is the other side that naive local formatting can break.
    runInTimeZone('Asia/Kolkata', -330, () => {
      for (const { serial, iso } of HARDWARE_DAY_VALUES) {
        expect(decodeSerialToIso(parser, serial)).toBe(iso);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Settings-key invariant: machineSettings populates (non-null)
// ---------------------------------------------------------------------------

describe('STR settings key intersects the session date so machineSettings populates', () => {
  const parser = new STRParser();

  /**
   * End-to-end of the bug: STR settings decoded under the correct epoch land on
   * a date key that a real session (built from the EDF window for the SAME local
   * day) will look up — so `Session.machineSettings` is non-null. Under the
   * Excel-epoch bug the STR key was 1955-05-07 while the session date was
   * 2025-05-08, the lookup missed, and machineSettings was always null.
   *
   * Run under a negative-offset TZ — the condition that exposed the bug in the
   * field — so the STR (UTC-formatted) key and the session (local-formatted)
   * date must agree despite the offset.
   */
  function buildSessionWithStr(): void {
    const result = parser.parseFromRawChannels(
      [
        { label: 'Date', samples: new Float32Array([20216]), samplesPerRecord: 1 },
        { label: 'S.AS.MinPress', samples: new Float32Array([7]), samplesPerRecord: 1 },
        { label: 'S.AS.MaxPress', samples: new Float32Array([13]), samplesPerRecord: 1 },
      ],
      new Date(2030, 0, 1, 12, 0, 0),
      1,
    );

    // STR settings keyed under the real therapy date.
    expect([...result.settingsByDate.keys()]).toEqual(['2025-05-08']);

    // A session whose LOCAL start date is the same calendar day. Use local
    // noon so the local-formatted session date equals the day regardless of the
    // (negative) UTC offset.
    const sessionDate = formatLocalDate(new Date(2025, 4, 8, 12, 0, 0));
    expect(sessionDate).toBe('2025-05-08');

    // The lookup SessionBuilder performs: settingsByDate.get(sessionDate).
    const matched = result.settingsByDate.get(sessionDate);
    expect(
      matched,
      'STR settings must intersect the session date (machineSettings non-null)',
    ).toBeDefined();
    expect(matched).not.toBeNull();
    expect(matched!.minPressure).toBe(7);
    expect(matched!.maxPressure).toBe(13);

    // And the buggy 1955 key must NOT be what the session would look up.
    expect(result.settingsByDate.has('1955-05-07')).toBe(false);
  }

  /** Mirror of SessionBuilder.formatDate (LOCAL components) for the session date. */
  function formatLocalDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  it('STR settings key matches the session date under a negative-offset TZ', () => {
    runInTimeZone('America/Los_Angeles', 420, buildSessionWithStr);
  });

  it('STR settings key matches the session date under UTC', () => {
    runInTimeZone('UTC', 0, buildSessionWithStr);
  });
});
