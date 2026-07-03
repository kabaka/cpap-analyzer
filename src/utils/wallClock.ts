/**
 * Wall-clock-as-UTC parsing for timezone-less local timestamps.
 *
 * Wearable exports (Fitbit / Google Health) record local wall-clock times with
 * NO timezone offset (`YYYY-MM-DDTHH:MM:SS[.sss]`). CPAP session timestamps use
 * the same wall-clock convention. To align the two without any timezone math —
 * so a record imported on one machine renders identically on another (and in
 * CI) — every such timestamp is interpreted as wall-clock-as-UTC: the local
 * calendar/clock components are fed directly to {@link Date.UTC}.
 *
 * This is intentionally timezone-independent. The resulting epoch ms is directly
 * comparable to event timestamps and other wall-clock-as-UTC values.
 *
 * @module utils/wallClock
 */

/**
 * Parse a local-time ISO-like timestamp (`YYYY-MM-DDTHH:MM:SS[.sss]`, no TZ)
 * into a wall-clock-as-UTC epoch in milliseconds.
 *
 * The separator between date and time may be `T` or a space. Fractional seconds
 * (1–3 digits) are optional. Any trailing content after the seconds (or
 * fractional seconds) is ignored, so a stray timezone suffix does not throw —
 * it is simply not applied (consistent with the wall-clock-as-UTC convention).
 *
 * @param iso - The timestamp string to parse.
 * @returns Epoch milliseconds, or `NaN` for unparseable input.
 */
export function localIsoToWallClockEpoch(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(iso.trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s, ms] = m;
  return Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
    ms ? Number(ms.padEnd(3, '0')) : 0,
  );
}

/**
 * Reduce a session start ISO timestamp to the wall-clock-as-UTC epoch used by
 * wearable samples: parse in the runtime zone, then re-stamp the LOCAL calendar
 * and clock components through {@link Date.UTC}. This round-trips the literal
 * wall-clock numbers of a timezone-less string, so the result is
 * timezone-independent (a session recorded at 22:00 local yields the same epoch
 * on any machine).
 *
 * Lives here (a dependency-free util) rather than in the Sessions view so the
 * wearable-timezone layer can consume it without importing the view layer.
 *
 * @param sessionStartIso - The session's `startTime` ISO 8601 string.
 * @returns Epoch ms in the wall-clock-as-UTC convention, or `NaN` if unparseable.
 */
export function sessionWallClockEpoch(sessionStartIso: string): number {
  const d = new Date(sessionStartIso);
  if (Number.isNaN(d.getTime())) return NaN;
  return Date.UTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  );
}

/**
 * Derive the calendar date (YYYY-MM-DD) of a session start ISO string using the
 * same local-wall-clock interpretation as {@link sessionWallClockEpoch}.
 */
export function sessionDateKey(sessionStartIso: string): string | null {
  const d = new Date(sessionStartIso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
