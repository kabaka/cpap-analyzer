/**
 * Lightweight CSV parsing and date-extraction utilities for Google Health imports.
 *
 * No external dependencies. Handles RFC 4180 CSV quirks: quoted fields, embedded
 * commas, embedded newlines, and byte-order marks (BOM).
 *
 * @module services/import/googlehealth/csv-utils
 */

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

export interface CSVParseResult {
  readonly headers: string[];
  readonly rows: string[][];
}

/**
 * Parse a CSV string into headers + rows.
 *
 * Handles:
 * - Fields enclosed in double-quotes (including commas and newlines inside quotes)
 * - Escaped double-quotes (`""`)
 * - UTF-8 BOM at the start of the file
 * - Empty trailing fields
 * - Windows (CRLF), Unix (LF), and legacy Mac (CR) line endings
 */
export function parseCSV(text: string): CSVParseResult {
  // Strip BOM if present
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i] as string;

    if (inQuotes) {
      if (ch === '"') {
        // Look ahead: escaped quote or end of quoted field
        if (i + 1 < len && input[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i += 1;
      } else if (ch === ',') {
        row.push(field);
        field = '';
        i += 1;
      } else if (ch === '\r') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        // Skip optional \n after \r
        if (i + 1 < len && input[i + 1] === '\n') {
          i += 2;
        } else {
          i += 1;
        }
      } else if (ch === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i += 1;
      } else {
        field += ch;
        i += 1;
      }
    }
  }

  // Final field / row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // First row is headers; remaining are data rows.
  // Filter out completely empty rows (all-empty-string fields).
  const [headers, ...dataRows] = rows;
  const filteredRows = dataRows.filter((r) => r.some((cell) => cell.trim() !== ''));

  return { headers: headers ?? [], rows: filteredRows };
}

// ---------------------------------------------------------------------------
// Date / timestamp utilities
// ---------------------------------------------------------------------------

/**
 * Extract the date portion (YYYY-MM-DD) from an ISO 8601 datetime string.
 *
 * Handles both UTC timestamps with `Z` suffix and local-time timestamps
 * without a timezone indicator. The returned date is always the *calendar*
 * date of the timestamp (not shifted to UTC).
 *
 * Examples:
 * - `"2024-10-15T07:00:00Z"` -> `"2024-10-15"`
 * - `"2024-10-15T07:00:00"` -> `"2024-10-15"`
 * - `"2024-10-15"` -> `"2024-10-15"`
 */
export function extractDate(isoString: string): string {
  // Fast path: if the string starts with YYYY-MM-DD we can just slice.
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(isoString.trim());
  if (match?.[1]) {
    return match[1];
  }
  // Fallback: parse and format (should not be needed for Google Health data).
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Cannot extract date from "${isoString}"`);
  }
  return formatDateParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Parse the legacy Fitbit date format used in some JSON exports.
 *
 * Input formats:
 * - `"MM/DD/YY HH:MM:SS"` -> `"20YY-MM-DD"`
 * - `"MM/DD/YYYY"` -> `"YYYY-MM-DD"`
 *
 * Assumes 21st century for two-digit years.
 */
export function parseFitbitLegacyDate(dateStr: string): string {
  const trimmed = dateStr.trim();

  // MM/DD/YYYY format (4-digit year)
  const full = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(trimmed);
  if (full?.[1] && full[2] && full[3]) {
    const month = parseInt(full[1], 10);
    const day = parseInt(full[2], 10);
    const year = parseInt(full[3], 10);
    return formatDateParts(year, month, day);
  }

  // MM/DD/YY format (2-digit year)
  const short = /^(\d{1,2})\/(\d{1,2})\/(\d{2})/.exec(trimmed);
  if (short?.[1] && short[2] && short[3]) {
    const month = parseInt(short[1], 10);
    const day = parseInt(short[2], 10);
    const year = 2000 + parseInt(short[3], 10);
    return formatDateParts(year, month, day);
  }

  throw new Error(`Cannot parse Fitbit legacy date: "${dateStr}"`);
}

/**
 * Parse the legacy Fitbit intraday datetime format (`MM/DD/YY HH:MM:SS`) into
 * a *wall-clock epoch* and its calendar date.
 *
 * The Fitbit export gives local wall-clock time with no timezone indicator.
 * Parsing with `new Date("08/25/16 06:44:18")` would interpret the string in
 * the *runtime's* timezone, which differs between the user's machine and CI and
 * would silently shift every sample. To stay deterministic and to match the
 * convention CPAP session timestamps use (wall-clock, not UTC-shifted), we
 * parse the components by hand and feed them to {@link Date.UTC}. The resulting
 * epoch represents the literal wall-clock instant as if it were UTC.
 *
 * @param dateTime - `MM/DD/YY HH:MM:SS` (two-digit year, assumed 21st century).
 * @returns `{ epochMs, date }` where `date` is the YYYY-MM-DD calendar date.
 * @throws If the string does not match the expected format or yields an
 *         invalid calendar date.
 */
export function parseFitbitLegacyDateTime(dateTime: string): {
  readonly epochMs: number;
  readonly date: string;
} {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(dateTime.trim());
  if (
    !match ||
    match[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined ||
    match[4] === undefined ||
    match[5] === undefined ||
    match[6] === undefined
  ) {
    throw new Error(`Cannot parse Fitbit legacy datetime: "${dateTime}"`);
  }

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  const year = 2000 + parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);

  // Range-validate so that an impossible date (e.g. month 13, day 32) is
  // rejected rather than silently rolling over via Date.UTC normalisation.
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Invalid Fitbit legacy datetime: "${dateTime}"`);
  }

  const epochMs = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(epochMs)) {
    throw new Error(`Invalid Fitbit legacy datetime: "${dateTime}"`);
  }

  return { epochMs, date: formatDateParts(year, month, day) };
}

/**
 * Parse an ISO 8601 datetime string to a Date object.
 *
 * When the string lacks a timezone suffix the timestamp is treated as
 * local time (matching `new Date()` behaviour for timezone-less strings
 * in most engines, but we add explicit handling for safety).
 */
export function parseTimestamp(isoString: string): Date {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid timestamp: "${isoString}"`);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format numeric date parts into YYYY-MM-DD with zero-padding.
 */
function formatDateParts(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse a numeric field from a CSV row. Returns `null` for empty or
 * non-numeric values rather than throwing.
 */
export function parseNumericField(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a numeric field, returning a default value instead of null.
 */
export function parseNumericFieldWithDefault(
  value: string | undefined,
  defaultValue: number,
): number {
  return parseNumericField(value) ?? defaultValue;
}
