/**
 * Fitbit account `Profile.csv` parsing — IANA timezone extraction.
 *
 * A Fitbit / Google Takeout account export includes a two-row `Profile.csv`
 * (header row + one value row) whose `timezone` column holds an IANA zone id
 * (e.g. `America/Los_Angeles`). That zone is used as the DST-aware FALLBACK for
 * the two UTC-sourced wearable lanes (`heart_rate_intraday`, `spo2_intraday`) on
 * dates the CPAP-overlap offset estimator cannot resolve — it OVERRIDES the
 * browser's runtime zone, which may differ from the zone the data was recorded
 * in (see `src/hooks/useWearableOffsets.ts`).
 *
 * ## Privacy (Core Principle #1)
 *
 * The parsed zone is derived location PII. It is persisted LOCALLY ONLY (an
 * IndexedDB settings record), is never transmitted anywhere, and is wiped by the
 * whole-database destroy in `clearAllUserData`. This module only parses text; it
 * does no I/O and no storage itself.
 *
 * ## Scope / caveat
 *
 * The export carries a single, CURRENT account zone — not a per-date travel
 * history. It therefore refines fallback dates uniformly and does not attempt to
 * reconstruct historical timezone changes; CPAP-anchored nights are unaffected
 * because they derive their offset from session overlap directly.
 *
 * @module services/import/googlehealth/profile
 */

import { parseCSV, buildColumnIndex, getColumn } from './csv-utils';

/**
 * Matches the account profile file by exact name, case-insensitively. Anchored
 * so `Sleep Profile.csv` (a different, unrelated file) is NOT matched.
 */
const PROFILE_FILE_PATTERN = /^profile\.csv$/i;

/** IndexedDB `settings`-store key prefix under which each source's profile zone lives. */
export const PROFILE_TIMEZONE_SETTING_PREFIX = 'integration.profileTimeZone.';

/**
 * The IndexedDB `settings`-store key under which `source`'s Profile.csv IANA
 * zone is persisted (e.g. `integration.profileTimeZone.fitbit`).
 */
export function profileTimeZoneSettingKey(source: string): string {
  return `${PROFILE_TIMEZONE_SETTING_PREFIX}${source}`;
}

/**
 * Whether `zone` is a plausible, resolvable IANA time-zone id.
 *
 * Non-empty AND accepted by `Intl.DateTimeFormat` (which throws `RangeError` for
 * an unknown/invalid `timeZone`). This is the same resolvability guard used by
 * the offset fallback in `useWearableOffsets.ts`.
 */
export function isPlausibleIanaTimeZone(zone: string): boolean {
  const z = zone.trim();
  if (z === '') return false;
  try {
    // Constructing a formatter with an unknown/invalid IANA zone throws RangeError;
    // reaching the next line means the zone resolved.
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse the `timezone` column from a `Profile.csv` file's text.
 *
 * @param text - Raw CSV text (header row + one value row).
 * @returns The validated IANA zone id, or `null` when the column is absent,
 *   empty, or not a resolvable IANA zone.
 */
export function parseProfileTimeZone(text: string): string | null {
  const { headers, rows } = parseCSV(text);
  const idx = buildColumnIndex(headers);
  const firstRow = rows[0];
  if (!firstRow) return null;
  const raw = getColumn(firstRow, idx, 'timezone');
  if (raw === undefined) return null;
  const zone = raw.trim();
  return isPlausibleIanaTimeZone(zone) ? zone : null;
}

/**
 * Locate the account `Profile.csv` within a Google Health / Fitbit export,
 * returning its `File` (or `null` when absent/unreadable).
 *
 * The exact location of `Profile.csv` varies across export layouts (it may sit at
 * the export root or one level down, e.g. under a `Fitbit/` folder), so this does
 * a **breadth-first** scan bounded to {@link maxDepth} levels rather than
 * assuming a fixed path: a root-level file is found first, and the walk descends
 * only if needed. First match wins. Bounded depth keeps a large export tree from
 * causing an unbounded traversal. The match is by exact name, case-insensitive;
 * `Sleep Profile.csv` is deliberately excluded. An unreadable directory is
 * skipped rather than aborting the scan.
 */
export async function findProfileCsvFile(
  root: FileSystemDirectoryHandle,
  maxDepth = 4,
): Promise<File | null> {
  let level: FileSystemDirectoryHandle[] = [root];
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
    const next: FileSystemDirectoryHandle[] = [];
    for (const dir of level) {
      try {
        for await (const entry of dir.values()) {
          if (entry.kind === 'file' && PROFILE_FILE_PATTERN.test(entry.name)) {
            try {
              return await entry.getFile();
            } catch {
              return null;
            }
          } else if (entry.kind === 'directory') {
            next.push(entry);
          }
        }
      } catch {
        // Unreadable directory — skip it and keep scanning siblings.
      }
    }
    level = next;
  }
  return null;
}
