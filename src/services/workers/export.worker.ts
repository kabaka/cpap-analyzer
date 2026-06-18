/**
 * Comlink-wrapped Web Worker for heavy export operations.
 *
 * Handles CSV generation and encryption off the main thread
 * to keep the UI responsive during large data exports.
 *
 * @module services/workers/export.worker
 */

import * as Comlink from 'comlink';
import { formatMetric, pooledRate } from '@/analysis/uncertainty';
import type { NightlyAggregate } from '@/types';
import type { EncryptionParams } from '@/services/reports/types';

/**
 * CSV/label indicator for a per-hour rate whose recording was too short for a
 * defined rate. Matches the ReportService convention — null rate cells render
 * as this marker, never blank or 0.
 */
const INSUFFICIENT_DATA = 'insufficient data';

/** Render a nullable per-hour rate cell: a number, or the insufficient marker. */
function rateCell(value: number | null): string | number {
  return value === null ? INSUFFICIENT_DATA : value;
}

// ── Helpers (duplicated to avoid main-thread module imports) ─────

/** Escape a CSV field value. */
function escapeCSV(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Compute median of a numeric array. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

// ── CSV column definition ────────────────────────────────────────

const CSV_HEADERS = [
  'date',
  'ahi',
  'ahiObstructive',
  'ahiCentral',
  'ahiHypopnea',
  'eventCount',
  'leakMedian',
  'leakP95',
  'pressureMean',
  'pressureP95',
  'usageHours',
  'complianceStatus',
] as const;

type CSVHeader = (typeof CSV_HEADERS)[number];

/** Extract a CSV field value from an aggregate row. */
function getField(a: NightlyAggregate, field: CSVHeader): string | number {
  switch (field) {
    case 'date':
      return a.date;
    case 'ahi':
      return rateCell(a.ahi);
    case 'ahiObstructive':
      return rateCell(a.ahiObstructive);
    case 'ahiCentral':
      return rateCell(a.ahiCentral);
    case 'ahiHypopnea':
      return rateCell(a.ahiHypopnea);
    case 'eventCount':
      return a.eventCount;
    case 'leakMedian':
      return a.leakMedian;
    case 'leakP95':
      return a.leakP95;
    case 'pressureMean':
      return a.pressureMean;
    case 'pressureP95':
      return a.pressureP95;
    case 'usageHours':
      return a.usageHours;
    case 'complianceStatus':
      return a.complianceStatus;
  }
}

// ── Worker API ───────────────────────────────────────────────────

/** Methods exposed by the export worker via Comlink. */
export interface ExportWorkerAPI {
  /**
   * Generate a CSV string from nightly aggregate data.
   *
   * @param aggregates - Pre-fetched nightly aggregate data.
   * @param dateRange - Date range for the report header comments.
   * @returns CSV string ready for download.
   */
  generateCSV(aggregates: NightlyAggregate[], dateRange: { start: string; end: string }): string;

  /**
   * Encrypt data with AES-256-GCM using PBKDF2 key derivation.
   *
   * @param data - Raw data as ArrayBuffer.
   * @param params - Password and optional iteration count.
   * @returns Encrypted data as ArrayBuffer (salt + IV + ciphertext).
   */
  encrypt(data: ArrayBuffer, params: EncryptionParams): Promise<ArrayBuffer>;
}

/** Generate CSV from aggregate data. */
function generateCSV(
  aggregates: NightlyAggregate[],
  dateRange: { start: string; end: string },
): string {
  const total = aggregates.length;
  // AHI is a per-hour RATE: nights with a null AHI had too little recording for
  // a defined rate and are EXCLUDED from every AHI statistic (never coerced to
  // 0). The summary mean is the duration-weighted POOLED rate
  // (Σ ahi·hours / Σ hours = Σ events / Σ hours); the median is over the
  // qualifying (non-null) nights only.
  const meanAHI = pooledRate(aggregates.map((a) => ({ rate: a.ahi, hours: a.usageHours }))) ?? 0;
  const qualifyingAhiValues = aggregates.map((a) => a.ahi).filter((v): v is number => v !== null);
  const compliantCount = aggregates.filter((a) => a.complianceStatus === 'compliant').length;
  const complianceRate = total > 0 ? compliantCount / total : 0;

  const lines: string[] = [];

  // Summary header comments
  lines.push('# CPAP Analyzer — Session Data Export');
  lines.push(`# Date Range: ${dateRange.start} to ${dateRange.end}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Total Sessions: ${total}`);
  // AHI is rendered at 1 dp (consensus D9 — no false precision).
  lines.push(`# Mean AHI: ${formatMetric('ahi', meanAHI)}`);
  lines.push(`# Median AHI: ${formatMetric('ahi', median(qualifyingAhiValues))}`);
  lines.push(`# Compliance Rate: ${(complianceRate * 100).toFixed(1)}%`);
  lines.push('');

  // Column headers
  lines.push(CSV_HEADERS.map(escapeCSV).join(','));

  // Data rows
  for (const a of aggregates) {
    const values = CSV_HEADERS.map((h) => escapeCSV(getField(a, h)));
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/** Derive AES-256-GCM key from password using PBKDF2. */
async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
}

/** Encrypt data with AES-256-GCM. */
async function encrypt(data: ArrayBuffer, params: EncryptionParams): Promise<ArrayBuffer> {
  const iterations = params.iterations ?? 600_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(params.password, salt, iterations);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    data,
  );

  // Packed format: [4 bytes iterations][16 bytes salt][12 bytes IV][ciphertext]
  const iterBytes = new Uint8Array(4);
  new DataView(iterBytes.buffer as ArrayBuffer).setUint32(0, iterations, false);

  const result = new Uint8Array(4 + 16 + 12 + ciphertext.byteLength);
  result.set(iterBytes, 0);
  result.set(salt, 4);
  result.set(iv, 20);
  result.set(new Uint8Array(ciphertext), 32);

  return result.buffer as ArrayBuffer;
}

const exportAPI: ExportWorkerAPI = {
  generateCSV,
  encrypt,
};

Comlink.expose(exportAPI);
