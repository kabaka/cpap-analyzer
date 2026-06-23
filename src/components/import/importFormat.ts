/**
 * Shared, locale-aware formatting helpers for the import UI.
 *
 * Pure & framework-agnostic so they are trivially unit-testable and reusable
 * across the dock, stage list, and summary surfaces.
 *
 * @module components/import/importFormat
 */

/** Format an integer count with locale grouping (e.g. `1,234,567`). */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString();
}

/**
 * Compact throughput phrasing, e.g. `~48k records/s`, `~1.2M records/s`,
 * `~320 records/s`. Returns `null` when the rate is unknown/non-positive so the
 * caller can omit it entirely (never render "0/s").
 */
export function formatThroughput(perSec: number | null, unit: string): string | null {
  if (perSec === null || perSec <= 0) return null;
  return `~${compactNumber(perSec)} ${unit}/s`;
}

/** Compact a positive number to a short magnitude string (320, 48k, 1.2M). */
export function compactNumber(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 10 ? round1(k) : String(Math.round(k))}k`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? round1(m) : String(Math.round(m))}M`;
}

/** Round to one decimal place, trimming a trailing `.0`. */
function round1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Human "time left" phrasing from a millisecond estimate, e.g. `~40s left`,
 * `~3m left`, `~1h 5m left`. Returns `null` when the estimate is unknown so the
 * caller hides the ETA rather than showing a placeholder.
 */
export function formatEta(etaMs: number | null): string | null {
  if (etaMs === null || etaMs < 0) return null;
  const totalSec = Math.round(etaMs / 1000);
  if (totalSec < 1) return '~1s left';
  if (totalSec < 60) return `~${totalSec}s left`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) {
    return seconds > 0 ? `~${minutes}m ${seconds}s left` : `~${minutes}m left`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `~${hours}h ${mins}m left` : `~${hours}h left`;
}

/**
 * Format an elapsed duration as `mm:ss` (or `h:mm:ss` past an hour) from a start
 * epoch-ms to an end epoch-ms.
 */
export function formatElapsed(startMs: number, endMs: number): string {
  const totalSec = Math.max(0, Math.round((endMs - startMs) / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${String(hours)}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}
