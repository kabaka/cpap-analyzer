/**
 * Derive {@link WeatherSyncNight} descriptors from CPAP sessions for a weather
 * sync. Pure and unit-testable.
 *
 * Each session becomes one night:
 * - `date` = the session's local date (`YYYY-MM-DD`).
 * - `civilDates` = the distinct civil dates the recording touches (one, or two
 *   when the recording crosses local midnight), ascending, always including
 *   `date`. {@link WeatherSyncService} fetches every listed civil date so the
 *   overnight aggregation can merge a midnight-spanning night.
 * - `window` = the session's `[start, end)` local wall-clock window, taken from
 *   `startTime` / `endTime` with any timezone offset stripped (the project's
 *   wall-clock-as-UTC convention used by the aggregation layer).
 *
 * Sessions sharing a `date` are de-duplicated (first wins) so a night is only
 * synced once.
 *
 * @module views/Settings/weather/syncNights
 */

import type { WeatherSyncNight } from '@/services/weather/WeatherSyncService';

/** Minimal session shape needed to build a night (a subset of `Session`). */
export interface SyncNightSession {
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
}

/** Strip any trailing `Z` / `±HH:MM` offset, keeping the local wall-clock part. */
function toWallClock(iso: string): string {
  // Keep up to seconds; drop the zone designator.
  const m = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)/.exec(iso.trim());
  return m ? (m[1] as string).replace(' ', 'T') : iso;
}

/** Extract the `YYYY-MM-DD` civil date from a wall-clock timestamp. */
function civilDateOf(iso: string): string {
  return toWallClock(iso).slice(0, 10);
}

/**
 * Build the sync-night list from sessions (already filtered to the desired
 * range). De-duplicates by `date`; preserves input order otherwise.
 */
export function buildSyncNights(sessions: readonly SyncNightSession[]): WeatherSyncNight[] {
  const seen = new Set<string>();
  const nights: WeatherSyncNight[] = [];

  for (const session of sessions) {
    if (seen.has(session.date)) continue;
    seen.add(session.date);

    const startCivil = civilDateOf(session.startTime);
    const endCivil = civilDateOf(session.endTime);

    const civilDates = startCivil === endCivil ? [startCivil] : [startCivil, endCivil].sort();
    // Guarantee the canonical date is present.
    if (!civilDates.includes(session.date)) civilDates.push(session.date);
    civilDates.sort();

    nights.push({
      date: session.date,
      civilDates: [...new Set(civilDates)],
      window: {
        start: toWallClock(session.startTime),
        end: toWallClock(session.endTime),
      },
    });
  }

  return nights;
}
