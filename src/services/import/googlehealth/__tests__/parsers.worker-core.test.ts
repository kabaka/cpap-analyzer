/**
 * Golden-fixture equivalence tests for the worker-safe parse cores (ADR 0027).
 *
 * THE CORRECTNESS GATE for moving Fitbit parsing into a Web Worker: these tests
 * assert that the new `(name, text)` cores produce output BYTE-IDENTICAL to the
 * existing `File[]`-based main-thread parsers (the equivalence baseline), and
 * that chunked processing is invariant to chunk size (chunk=1 vs chunk=2000 vs
 * all-at-once). They protect the timezone-load-bearing `parseFitbitLegacyDateTime`
 * and all grouping/sort/map semantics from silent drift during the move.
 *
 * @module services/import/googlehealth/__tests__/parsers.worker-core.test
 */

import { describe, it, expect } from 'vitest';

import {
  parseHeartRateIntradayFiles,
  parseHeartRateIntradayCore,
  parseSpO2IntradayFiles,
  parseSpO2IntradayCore,
  parseHRVDetailFiles,
  parseHRVDetailCore,
  parseSnoringFiles,
  parseSnoringCore,
  type CoreProgressReport,
} from '../parsers';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

/** A File whose `.text()` resolves to `content` (jsdom File lacks `.text()`). */
function makeFile(name: string, content: string): File {
  const file = new File([content], name, { type: 'text/plain' });
  file.text = () => Promise.resolve(content);
  return file;
}

/** Build a representative intraday HR JSON fixture spanning the midnight boundary. */
function hrIntradayFixture(): string {
  const entries: { dateTime: string; value: { bpm: number; confidence?: number } }[] = [];
  // 08/24 evening, 5s cadence.
  for (let s = 0; s < 600; s++) {
    const total = 23 * 3600 + 50 * 60 + s * 5;
    const hh = Math.floor(total / 3600) % 24;
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    const day = total >= 24 * 3600 ? 25 : 24;
    const pad = (n: number): string => String(n).padStart(2, '0');
    entries.push({
      dateTime: `08/${pad(day)}/16 ${pad(hh % 24)}:${pad(mm)}:${pad(ss)}`,
      value: { bpm: 60 + (s % 30), confidence: s % 4 },
    });
  }
  // Inject malformed/edge entries to exercise skip paths identically.
  entries.push({ dateTime: 'not-a-date', value: { bpm: 99, confidence: 1 } });
  entries.push({ dateTime: '08/24/16 22:00:00', value: { bpm: 55 } }); // missing confidence
  return JSON.stringify(entries);
}

/** Build an SpO2 intraday CSV fixture. */
function spo2IntradayFixture(): string {
  const lines = ['timestamp,value'];
  for (let m = 0; m < 300; m++) {
    const d = new Date(Date.UTC(2024, 0, 15, 1, 0, 0) + m * 60_000);
    // Sprinkle in sentinel 50s (filtered) and a couple of bad rows.
    const value = m % 37 === 0 ? 50 : 92 + (m % 6);
    lines.push(`${d.toISOString().replace('.000', '')},${String(value)}`);
  }
  lines.push('bad-timestamp,95');
  lines.push(',93');
  return lines.join('\n');
}

/** Build an HRV detail CSV fixture (local-time timestamps, 5-min intervals). */
function hrvDetailFixture(): string {
  const lines = ['timestamp,rmssd,coverage,high_frequency,low_frequency'];
  for (let i = 0; i < 200; i++) {
    const total = 60 + i * 5;
    const hh = 23 + Math.floor(total / 60 / 60);
    const mm = Math.floor(total / 60) % 60;
    const pad = (n: number): string => String(n).padStart(2, '0');
    const day = hh >= 24 ? 16 : 15;
    lines.push(
      `2024-01-${pad(day)}T${pad(hh % 24)}:${pad(mm)}:00,${String(30 + (i % 20))},${String(
        0.5 + (i % 5) / 10,
      )},${String(100 + i)},${String(200 + i)}`,
    );
  }
  lines.push('not-a-ts,40,0.9,1,2'); // skipped
  lines.push('2024-01-15T23:30:00,,0.9,1,2'); // missing rmssd -> skipped
  return lines.join('\n');
}

/** Build a snoring CSV fixture. */
function snoringFixture(): string {
  const lines = ['timestamp,mean_dba,max_dba,sample_duration,snore_label'];
  for (let i = 0; i < 250; i++) {
    const d = new Date(Date.UTC(2024, 2, 3, 1, 0, 0) + i * 30_000);
    lines.push(
      `${d.toISOString().slice(0, 19)},${String(30 + (i % 15))},${String(40 + (i % 20))},30,${
        i % 2 === 0 ? '1' : '0'
      }`,
    );
  }
  lines.push(',0,0,30,0'); // no timestamp -> skipped
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Equivalence: core output === File[] path output (byte-identical via JSON)
// ---------------------------------------------------------------------------

describe('worker-safe cores: byte-identical to the File[] baseline', () => {
  it('heart_rate_intraday core matches parseHeartRateIntradayFiles', async () => {
    const text = hrIntradayFixture();
    const name = 'heart_rate-2016-08-24.json';

    const baseline = await parseHeartRateIntradayFiles([makeFile(name, text)]);
    const core = parseHeartRateIntradayCore(name, text, 0);

    expect(JSON.stringify(core)).toBe(JSON.stringify(baseline));
    // Sanity: midnight straddle produced two date records.
    expect(core.map((r) => r.date).sort()).toEqual(['2016-08-24', '2016-08-25']);
  });

  it('spo2_intraday core matches parseSpO2IntradayFiles', async () => {
    const text = spo2IntradayFixture();
    const name = 'Minute SpO2 - 2024-01-15.csv';

    const baseline = await parseSpO2IntradayFiles([makeFile(name, text)]);
    const core = parseSpO2IntradayCore(name, text, 0);

    expect(JSON.stringify(core)).toBe(JSON.stringify(baseline));
    expect(core.length).toBeGreaterThan(0);
  });

  it('hrv_detail core matches parseHRVDetailFiles', async () => {
    const text = hrvDetailFixture();
    const name = 'Heart Rate Variability Details - 2024-01-15.csv';

    const baseline = await parseHRVDetailFiles([makeFile(name, text)]);
    const core = parseHRVDetailCore(name, text, 0);

    expect(JSON.stringify(core)).toBe(JSON.stringify(baseline));
    expect(core.length).toBeGreaterThan(0);
  });

  it('snoring core matches parseSnoringFiles (both daily and segments)', async () => {
    const text = snoringFixture();
    const name = 'Snore Details - 2024-03-03.csv';

    const baseline = await parseSnoringFiles([makeFile(name, text)]);
    const core = parseSnoringCore(name, text, 0);

    expect(JSON.stringify(core.daily)).toBe(JSON.stringify(baseline.daily));
    expect(JSON.stringify(core.segments)).toBe(JSON.stringify(baseline.segments));
    expect(core.segments.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Chunk-size invariance: output independent of chunk size
// ---------------------------------------------------------------------------

describe('worker-safe cores: chunked output is invariant to chunk size', () => {
  const chunkSizes = [1, 7, 2000, 1_000_000];

  it('heart_rate_intraday is chunk-size invariant', () => {
    const text = hrIntradayFixture();
    const outputs = chunkSizes.map((cs) =>
      JSON.stringify(parseHeartRateIntradayCore('hr.json', text, 0, undefined, cs)),
    );
    for (const out of outputs) expect(out).toBe(outputs[0]);
  });

  it('spo2_intraday is chunk-size invariant', () => {
    const text = spo2IntradayFixture();
    const outputs = chunkSizes.map((cs) =>
      JSON.stringify(parseSpO2IntradayCore('spo2.csv', text, 0, undefined, cs)),
    );
    for (const out of outputs) expect(out).toBe(outputs[0]);
  });

  it('hrv_detail is chunk-size invariant', () => {
    const text = hrvDetailFixture();
    const outputs = chunkSizes.map((cs) =>
      JSON.stringify(parseHRVDetailCore('hrv.csv', text, 0, undefined, cs)),
    );
    for (const out of outputs) expect(out).toBe(outputs[0]);
  });

  it('snoring is chunk-size invariant', () => {
    const text = snoringFixture();
    const outputs = chunkSizes.map((cs) =>
      JSON.stringify(parseSnoringCore('snore.csv', text, 0, undefined, cs)),
    );
    for (const out of outputs) expect(out).toBe(outputs[0]);
  });
});

// ---------------------------------------------------------------------------
// Progress reporting: determinate and monotonic
// ---------------------------------------------------------------------------

describe('worker-safe cores: determinate progress reporting', () => {
  it('reports monotonic samplesProcessed with a fixed samplesTotal', () => {
    const text = hrIntradayFixture();
    const reports: CoreProgressReport[] = [];
    parseHeartRateIntradayCore('hr.json', text, 3, (r) => reports.push(r), 50);

    expect(reports.length).toBeGreaterThan(1);
    // Total is fixed (known up-front) across all reports.
    const total = reports[0]!.samplesTotal;
    expect(reports.every((r) => r.samplesTotal === total)).toBe(true);
    // fileIndex is threaded through.
    expect(reports.every((r) => r.fileIndex === 3)).toBe(true);
    // Processed is non-decreasing and bounded by total.
    for (let i = 1; i < reports.length; i++) {
      expect(reports[i]!.samplesProcessed).toBeGreaterThanOrEqual(reports[i - 1]!.samplesProcessed);
      expect(reports[i]!.samplesProcessed).toBeLessThanOrEqual(total);
    }
    // The final report exactly equals the total.
    expect(reports[reports.length - 1]!.samplesProcessed).toBe(total);
  });

  it('emits no progress callbacks when none is supplied (no throw)', () => {
    expect(() => parseSnoringCore('s.csv', snoringFixture(), 0)).not.toThrow();
  });
});
