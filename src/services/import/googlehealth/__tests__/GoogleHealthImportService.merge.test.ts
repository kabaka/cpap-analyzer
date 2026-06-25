/**
 * Regression test for the Fitbit heart-rate-timing data-loss bug at the
 * `processTimeseriesRecords` level (driven through the public `import()` API).
 *
 * ## The bug
 *
 * Real `heart_rate-YYYY-MM-DD.json` files span a 24h window OFFSET from local
 * midnight (the offset is the user's UTC offset, so it is DST-dependent — e.g.
 * `07:00:01` local in California PDT). Confirmed from a real export:
 *
 *   - `heart_rate-2026-06-01.json`: `06/01 07:00:01` → `06/02 06:59:59`
 *   - `heart_rate-2026-06-02.json`: `06/02 07:00:01` → `06/03 06:59:58`
 *
 * The parser groups samples by each sample's own LOCAL calendar date, so local
 * date `2026-06-02` is produced by TWO files: the `00:00 → 06:59:59` morning
 * chunk from `…-06-01` and the `07:00 → 23:59` chunk from `…-06-02`. The
 * streaming pipeline calls `processTimeseriesRecords` per file, so the morning
 * chunk is stored first under `heart_rate_intraday:2026-06-02`; when the day
 * chunk for the same date arrives, the unique `source_dataType_date` index (or
 * the prior skip-if-existing de-dupe) DROPPED it — truncating every day to
 * `00:00 → ~07:00`.
 *
 * ## The fix under test
 *
 * `processTimeseriesRecords` now MERGES an incoming same-key payload into the
 * existing record and updates it in place by `id` (a `put` upsert), rather than
 * skipping. This test reproduces the exact two-file boundary and asserts that
 * after both per-file imports there is exactly ONE stored record for
 * `2026-06-02` containing BOTH chunks (full-day span, no 07:00 cliff).
 *
 * The mock DB models the production unique index by keying on `(dataType,date)`
 * and supports the merge upsert via `putIntegrationTimeseries` (replace in place
 * by id). It mirrors the dedup.test.ts mock style.
 *
 * @module services/import/googlehealth/__tests__/GoogleHealthImportService.merge
 */

import { describe, it, expect, vi } from 'vitest';

import { GoogleHealthImportService } from '../GoogleHealthImportService';
import type { IndexedDBService } from '@/services/storage/IndexedDBService';
import type { GoogleHealthScanResult, GoogleHealthDataTypeInfo } from '@/types/fitbit';
import type { FitbitHeartRateIntraday } from '@/types/fitbit';
import type { IntegrationTimeseries, IntegrationImportRecord } from '@/types/storage';

vi.mock('../scanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scanner')>();
  return {
    ...actual,
    resolveRoot: (h: FileSystemDirectoryHandle) => Promise.resolve(h),
  };
});

// ---------------------------------------------------------------------------
// Fixtures: real-shaped heart_rate JSON files, offset from local midnight
// ---------------------------------------------------------------------------

interface RawHrEntry {
  readonly dateTime: string;
  readonly value: { readonly bpm: number; readonly confidence: number };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Build a `heart_rate-*.json` file spanning `startIso → endIso` (inclusive) at a
 * fixed cadence, emitting entries in the legacy `MM/DD/YY HH:MM:SS` wall-clock
 * format the parser expects. `mmddyy` formats a Date's wall-clock components.
 */
function hrFileSpanning(startIso: string, endIso: string, stepMs: number): string {
  const start = Date.parse(startIso + 'Z');
  const end = Date.parse(endIso + 'Z');
  const entries: RawHrEntry[] = [];
  let i = 0;
  for (let t = start; t <= end; t += stepMs) {
    const d = new Date(t);
    const dateTime = `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${pad(
      d.getUTCFullYear() % 100,
    )} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    entries.push({ dateTime, value: { bpm: 60 + (i % 25), confidence: i % 4 } });
    i++;
  }
  return JSON.stringify(entries);
}

function makeFile(name: string, content: string): File {
  const bytes = new TextEncoder().encode(content);
  const buffer = bytes.buffer.slice(0) as ArrayBuffer;
  return {
    name,
    size: bytes.byteLength,
    type: 'application/json',
    text: () => Promise.resolve(content),
    arrayBuffer: () => Promise.resolve(buffer.slice(0)),
  } as unknown as File;
}

function makeDirHandle(files: Map<string, File>): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: 'root',
    getFileHandle: (name: string) => {
      const file = files.get(name);
      if (!file) return Promise.reject(new Error(`no file ${name}`));
      return Promise.resolve({
        kind: 'file',
        name,
        getFile: () => Promise.resolve(file),
      } as unknown as FileSystemFileHandle);
    },
    getDirectoryHandle: () => Promise.reject(new Error('no subdirs')),
  } as unknown as FileSystemDirectoryHandle;
}

function hrScanResult(fileNames: string[], recordCount: number): GoogleHealthScanResult {
  const info: GoogleHealthDataTypeInfo = {
    dataType: 'heart_rate_intraday',
    tier: 2,
    label: 'Heart Rate (Intraday)',
    recordCount,
    dateRange: null,
    estimatedSizeBytes: 1000,
    files: fileNames,
  };
  return {
    dataTypes: [info],
    dateRange: null,
    deviceInfo: null,
    totalFileCount: fileNames.length,
    estimatedSizeBytes: 1000,
  };
}

// ---------------------------------------------------------------------------
// Mock IndexedDB that models the unique (dataType,date) index AND the merge
// upsert (put-by-id) the fix relies on.
// ---------------------------------------------------------------------------

interface MockDB {
  db: IndexedDBService;
  timeseries: Map<string, IntegrationTimeseries>; // keyed by `(dataType,date)`
  importRecords: IntegrationImportRecord[];
}

function createMockDB(): MockDB {
  // Two views of the same store: by compound key (the unique index) and by id
  // (the keyPath), so `put`-by-id replaces the same logical record.
  const byKey = new Map<string, IntegrationTimeseries>();
  const idToKey = new Map<string, string>();
  const importRecords: IntegrationImportRecord[] = [];
  const compoundKey = (dataType: string, date: string): string => `fitbit|${dataType}|${date}`;

  const db = {
    getIntegrationTimeseriesByKey: (_s: string, dataType: string, date: string) =>
      Promise.resolve(byKey.get(compoundKey(dataType, date)) ?? null),
    bulkAddIntegrationTimeseries: (records: IntegrationTimeseries[]) => {
      // Mirror `add`: a duplicate compound key violates the unique index.
      for (const r of records) {
        const k = compoundKey(r.dataType, r.date);
        if (byKey.has(k)) {
          const e = new Error('uniqueness requirements');
          e.name = 'ConstraintError';
          return Promise.reject(e);
        }
      }
      for (const r of records) {
        const k = compoundKey(r.dataType, r.date);
        byKey.set(k, r);
        idToKey.set(r.id, k);
      }
      return Promise.resolve();
    },
    addIntegrationTimeseries: (record: IntegrationTimeseries) => {
      const k = compoundKey(record.dataType, record.date);
      if (byKey.has(k)) {
        const e = new Error('uniqueness requirements');
        e.name = 'ConstraintError';
        return Promise.reject(e);
      }
      byKey.set(k, record);
      idToKey.set(record.id, k);
      return Promise.resolve();
    },
    putIntegrationTimeseries: (record: IntegrationTimeseries) => {
      // Replace in place by id (the keyPath). The compound key is unchanged
      // because the merge keeps the same (source,dataType,date).
      const k = compoundKey(record.dataType, record.date);
      byKey.set(k, record);
      idToKey.set(record.id, k);
      return Promise.resolve();
    },
    addIntegrationImportRecord: (record: IntegrationImportRecord) => {
      importRecords.push(record);
      return Promise.resolve();
    },
    // Daily-summary methods are unused for this HR-only scenario but referenced
    // by the generic store path; provide inert stubs.
    getIntegrationDailySummaryByKey: () => Promise.resolve(null),
    bulkAddIntegrationDailySummaries: () => Promise.resolve(),
    addIntegrationDailySummary: () => Promise.resolve(),
  } as unknown as IndexedDBService;

  return { db, timeseries: byKey, importRecords };
}

/** Reconstruct a HR record's absolute wall-clock epochs, sorted ascending. */
function recordEpochs(rec: IntegrationTimeseries): number[] {
  const data = rec.data as FitbitHeartRateIntraday;
  return data.samples.map((s) => data.baseTimestampMs + s.offsetSec * 1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoogleHealthImportService — intraday timeseries merge-on-conflict (HR timing bug)', () => {
  // Wall-clock-as-UTC epoch for an ISO local timestamp, mirroring the parser.
  const wc = (iso: string): number => Date.parse(iso + 'Z');

  it('merges the two partial-day chunks for 2026-06-02 into ONE full-day record', async () => {
    // Two real-shaped files, each offset from local midnight by +7h (PDT).
    // File -06-01 spans 06/01 07:00:01 → 06/02 06:59:59 (so it OWNS 2026-06-02's
    // morning 00:00→06:59:59). File -06-02 spans 06/02 07:00:01 → 06/03 06:59:59
    // (so it owns 2026-06-02's 07:00→23:59 day chunk). Use a coarse 60s cadence
    // to keep the fixture light while still crossing every boundary.
    const STEP = 60_000;
    const file1 = hrFileSpanning('2026-06-01T07:00:01', '2026-06-02T06:59:59', STEP);
    const file2 = hrFileSpanning('2026-06-02T07:00:01', '2026-06-03T06:59:59', STEP);

    const files = new Map<string, File>([
      ['heart_rate-2026-06-01.json', makeFile('heart_rate-2026-06-01.json', file1)],
      ['heart_rate-2026-06-02.json', makeFile('heart_rate-2026-06-02.json', file2)],
    ]);
    const fileNames = [...files.keys()];

    const mock = createMockDB();
    const service = new GoogleHealthImportService(mock.db);

    const record = await service.import(makeDirHandle(files), hrScanResult(fileNames, 2880), {
      selectedDataTypes: ['heart_rate_intraday'],
      skipDuplicates: true,
    });

    // EXACTLY ONE record for 2026-06-02 (the unique index holds), containing BOTH
    // chunks — the regression: before the fix the day chunk was dropped.
    const day = mock.timeseries.get('fitbit|heart_rate_intraday|2026-06-02');
    expect(day).toBeDefined();
    const data = day!.data as FitbitHeartRateIntraday;

    const epochs = recordEpochs(day!);
    // Full-day span: first sample at 00:00:01, last at 23:59:01 (last <= 23:59:59).
    expect(epochs[0]).toBe(wc('2026-06-02T00:00:01'));
    expect(epochs[epochs.length - 1]).toBe(wc('2026-06-02T23:59:01'));

    // No ~7h cliff at the 07:00 file boundary: every consecutive gap is one
    // cadence step (the boundary 06:59:01 → 07:00:01 is exactly one STEP).
    let maxGap = 0;
    for (let i = 1; i < epochs.length; i++) maxGap = Math.max(maxGap, epochs[i]! - epochs[i - 1]!);
    expect(maxGap).toBe(STEP);

    // Sample count = full day's worth (~1440 at 60s cadence), not ~420 (07:00).
    expect(data.sampleCount).toBe(epochs.length);
    expect(data.sampleCount).toBeGreaterThan(1400);

    // baseTimestampMs is the day's first sample; offsets monotonic from 0.
    expect(data.baseTimestampMs).toBe(wc('2026-06-02T00:00:01'));
    expect(data.samples[0]?.offsetSec).toBe(0);

    // The merge counts as a store (a write that changed state), not a skip.
    expect(record.recordsSkipped).toBe(0);
    expect(record.recordsErrored).toBe(0);
    expect(record.errors).toEqual([]);
  });

  it('is idempotent: re-importing the same two files does not grow the record', async () => {
    const STEP = 60_000;
    const file1 = hrFileSpanning('2026-06-01T07:00:01', '2026-06-02T06:59:59', STEP);
    const file2 = hrFileSpanning('2026-06-02T07:00:01', '2026-06-03T06:59:59', STEP);
    const files = new Map<string, File>([
      ['heart_rate-2026-06-01.json', makeFile('heart_rate-2026-06-01.json', file1)],
      ['heart_rate-2026-06-02.json', makeFile('heart_rate-2026-06-02.json', file2)],
    ]);
    const fileNames = [...files.keys()];

    const mock = createMockDB();
    const service = new GoogleHealthImportService(mock.db);
    const opts = { selectedDataTypes: ['heart_rate_intraday'] as const, skipDuplicates: true };

    await service.import(makeDirHandle(files), hrScanResult(fileNames, 2880), opts);
    const before = (
      mock.timeseries.get('fitbit|heart_rate_intraday|2026-06-02')!.data as FitbitHeartRateIntraday
    ).sampleCount;

    // Re-import the identical files into the same DB.
    await service.import(makeDirHandle(files), hrScanResult(fileNames, 2880), opts);
    const after = (
      mock.timeseries.get('fitbit|heart_rate_intraday|2026-06-02')!.data as FitbitHeartRateIntraday
    ).sampleCount;

    // Timestamp de-dupe guarantees no growth and no error.
    expect(after).toBe(before);
  });
});
