/**
 * Client-side export of a matched event set to CSV or JSON.
 *
 * Privacy: everything happens in-browser via a Blob + object URL download.
 * No network request is made. The serialization functions are pure and the
 * DOM-driving download helper is isolated for testability.
 *
 * @module views/Explore/EventExplorer/exportEvents
 */

import type { Event } from '@/types/events';
import { eventLabel } from '@/components/events/eventTypeMeta';

/** Above this many rows we warn the user before generating the file. */
export const LARGE_EXPORT_THRESHOLD = 50_000;

/** CSV column order. */
const CSV_COLUMNS: readonly (keyof Event | 'isoTime' | 'typeLabel')[] = [
  'id',
  'sessionId',
  'type',
  'typeLabel',
  'timestamp',
  'isoTime',
  'duration',
  'severity',
  'pressure',
  'epap',
  'ipap',
  'leak',
  'spo2',
  'clusterId',
];

/**
 * Characters that, when leading a cell, trigger formula evaluation in
 * spreadsheet apps (Excel, LibreOffice, Google Sheets). Prefixing such cells
 * with a single quote turns them into inert literals — the standard CSV
 * injection defense.
 */
const FORMULA_LEAD_CHARS = /^[=+\-@\t\r]/;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Defang spreadsheet formula triggers (=, +, -, @, TAB, CR). The single
  // quote is consumed by the spreadsheet as a "force-text" sigil and is
  // invisible to the user.
  if (FORMULA_LEAD_CHARS.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize events to a CSV string (with header row). */
export function eventsToCsv(events: readonly Event[]): string {
  const header = CSV_COLUMNS.join(',');
  const lines = events.map((e) => {
    const cells = CSV_COLUMNS.map((col) => {
      switch (col) {
        case 'isoTime':
          return csvCell(new Date(e.timestamp).toISOString());
        case 'typeLabel':
          return csvCell(eventLabel(e.type));
        default:
          return csvCell(e[col]);
      }
    });
    return cells.join(',');
  });
  return [header, ...lines].join('\n');
}

/** Serialize events to a pretty-printed JSON string with ISO timestamps added. */
export function eventsToJson(events: readonly Event[]): string {
  const enriched = events.map((e) => ({
    ...e,
    isoTime: new Date(e.timestamp).toISOString(),
    typeLabel: eventLabel(e.type),
  }));
  return JSON.stringify(enriched, null, 2);
}

/**
 * Trigger a client-side file download for the given text content.
 * Isolated so the rest of the module stays pure and unit-testable.
 */
export function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Build a timestamped filename, e.g. `cpap-events-2026-06-12.csv`. */
export function exportFilename(ext: 'csv' | 'json', now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `cpap-events-${y}-${m}-${d}.${ext}`;
}

/** Export a matched set to CSV and trigger a download. */
export function exportEventsCsv(events: readonly Event[]): void {
  downloadTextFile(eventsToCsv(events), exportFilename('csv'), 'text/csv;charset=utf-8');
}

/** Export a matched set to JSON and trigger a download. */
export function exportEventsJson(events: readonly Event[]): void {
  downloadTextFile(eventsToJson(events), exportFilename('json'), 'application/json');
}
