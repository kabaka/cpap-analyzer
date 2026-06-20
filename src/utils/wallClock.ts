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
