/**
 * Unit tests for the Fitbit parser worker API (ADR 0027).
 *
 * Exercises the worker's `parseDataType` directly (no real Worker spun up) to
 * verify: (1) it decodes `ArrayBuffer` input and routes each data type to the
 * correct worker-safe core, (2) its output equals the inline core output
 * (the equivalence guarantee), and (3) it emits determinate per-file/per-chunk
 * progress with the cross-file counters the orchestrator consumes.
 *
 * @module services/workers/__tests__/fitbitParser.worker.test
 */

import { describe, it, expect } from 'vitest';

import { fitbitParserAPI, type FitbitWorkerProgress } from '../fitbitParser.worker';
import {
  parseHeartRateIntradayCore,
  parseSpO2IntradayCore,
  parseHRVDetailCore,
  parseSnoringCore,
} from '@/services/import/googlehealth/parsers';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/** Encode a string into an ArrayBuffer (as the orchestrator transfers it in). */
function buf(text: string): ArrayBuffer {
  return encoder.encode(text).buffer as ArrayBuffer;
}

function hrFixture(): string {
  const entries: { dateTime: string; value: { bpm: number; confidence?: number } }[] = [];
  for (let s = 0; s < 120; s++) {
    const pad = (n: number): string => String(n).padStart(2, '0');
    const tot = 6 * 3600 + s * 5;
    entries.push({
      dateTime: `02/02/20 ${pad(Math.floor(tot / 3600))}:${pad(Math.floor((tot % 3600) / 60))}:${pad(
        tot % 60,
      )}`,
      value: { bpm: 60 + (s % 10), confidence: s % 4 },
    });
  }
  return JSON.stringify(entries);
}

function spo2Fixture(): string {
  const lines = ['timestamp,value'];
  for (let m = 0; m < 80; m++) {
    const d = new Date(Date.UTC(2024, 0, 15, 1, 0, 0) + m * 60_000);
    lines.push(`${d.toISOString().slice(0, 19)}Z,${String(m % 31 === 0 ? 50 : 93 + (m % 5))}`);
  }
  return lines.join('\n');
}

function snoringFixture(): string {
  const lines = ['timestamp,mean_dba,max_dba,sample_duration,snore_label'];
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.UTC(2024, 2, 3, 1, 0, 0) + i * 30_000);
    lines.push(`${d.toISOString().slice(0, 19)},${String(30 + i)},${String(40 + i)},30,${i % 2}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Equivalence: worker output === inline core output
// ---------------------------------------------------------------------------

describe('fitbitParserAPI.parseDataType: output equals inline cores', () => {
  it('routes heart_rate_intraday and matches the core', async () => {
    const text = hrFixture();
    const result = await fitbitParserAPI.parseDataType('heart_rate_intraday', [
      { name: 'hr.json', buffer: buf(text) },
    ]);
    expect(result.daily).toEqual([]);
    expect(JSON.stringify(result.timeseries)).toBe(
      JSON.stringify(parseHeartRateIntradayCore('hr.json', text, 0)),
    );
  });

  it('routes spo2_intraday and matches the core', async () => {
    const text = spo2Fixture();
    const result = await fitbitParserAPI.parseDataType('spo2_intraday', [
      { name: 'spo2.csv', buffer: buf(text) },
    ]);
    expect(JSON.stringify(result.timeseries)).toBe(
      JSON.stringify(parseSpO2IntradayCore('spo2.csv', text, 0)),
    );
  });

  it('routes hrv_detail and matches the core', async () => {
    const text = ['timestamp,rmssd,coverage', '2024-01-15T23:00:00,35,0.9'].join('\n');
    const result = await fitbitParserAPI.parseDataType('hrv_detail', [
      { name: 'hrv.csv', buffer: buf(text) },
    ]);
    expect(JSON.stringify(result.timeseries)).toBe(
      JSON.stringify(parseHRVDetailCore('hrv.csv', text, 0)),
    );
  });

  it('routes snoring_daily to daily + segments matching the core', async () => {
    const text = snoringFixture();
    const result = await fitbitParserAPI.parseDataType('snoring_daily', [
      { name: 'snore.csv', buffer: buf(text) },
    ]);
    const core = parseSnoringCore('snore.csv', text, 0);
    expect(JSON.stringify(result.daily)).toBe(JSON.stringify(core.daily));
    expect(JSON.stringify(result.timeseries)).toBe(JSON.stringify(core.segments));
  });

  it('aggregates output across multiple files in order', async () => {
    const a = spo2Fixture();
    const b = spo2Fixture().replace(/2024-01-15/g, '2024-02-15');
    const result = await fitbitParserAPI.parseDataType('spo2_intraday', [
      { name: 'a.csv', buffer: buf(a) },
      { name: 'b.csv', buffer: buf(b) },
    ]);
    const expected = [
      ...parseSpO2IntradayCore('a.csv', a, 0),
      ...parseSpO2IntradayCore('b.csv', b, 1),
    ];
    expect(JSON.stringify(result.timeseries)).toBe(JSON.stringify(expected));
  });
});

// ---------------------------------------------------------------------------
// Progress: determinate per-file + per-chunk, with cross-file counters
// ---------------------------------------------------------------------------

describe('fitbitParserAPI.parseDataType: progress reporting', () => {
  it('emits determinate within-file progress and per-file completion ticks', async () => {
    const text = hrFixture();
    const reports: FitbitWorkerProgress[] = [];
    await fitbitParserAPI.parseDataType(
      'heart_rate_intraday',
      [{ name: 'hr.json', buffer: buf(text) }],
      (p) => reports.push(p),
      20, // small chunk so multiple within-file reports fire
    );

    expect(reports.length).toBeGreaterThan(1);
    expect(reports.every((r) => r.filesTotal === 1)).toBe(true);
    // A final per-file completion tick reports filesDone === filesTotal.
    expect(reports[reports.length - 1]!.filesDone).toBe(1);
    // Within-file processed never exceeds the (fixed) total.
    const withinFile = reports.filter((r) => r.samplesTotal > 0);
    const total = withinFile[0]!.samplesTotal;
    expect(withinFile.every((r) => r.samplesProcessed <= total)).toBe(true);
  });

  it('advances filesDone across multiple files', async () => {
    const text = snoringFixture();
    const filesDoneSeen = new Set<number>();
    await fitbitParserAPI.parseDataType(
      'snoring_segments',
      [
        { name: 'a.csv', buffer: buf(text) },
        { name: 'b.csv', buffer: buf(text.replace(/2024-03-03/g, '2024-03-04')) },
      ],
      (p) => filesDoneSeen.add(p.filesDone),
      10,
    );
    // We should observe completion of both files.
    expect(filesDoneSeen.has(1)).toBe(true);
    expect(filesDoneSeen.has(2)).toBe(true);
  });
});
