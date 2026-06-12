/**
 * Unit tests for Google Health data-type parsers.
 *
 * Each parser reads File objects via `.text()` and returns typed ParsedRecord
 * arrays. Tests use in-memory File objects to validate correct parsing,
 * field mapping, sentinel filtering, and error resilience.
 *
 * @module services/import/googlehealth/__tests__/parsers.test
 */

import { describe, it, expect } from 'vitest';
import {
  parseSleepScoreFile,
  parseSpO2DailyFiles,
  parseRestingHeartRateFiles,
  parseRespiratoryRateFiles,
  parseHRVDailyFiles,
  parseHeartRateIntradayFiles,
} from '../parsers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock File with a working `.text()` method.
 *
 * jsdom's File does not implement `.text()`, so we extend the native File
 * with an explicit implementation backed by the raw content string.
 */
function makeFile(name: string, content: string): File {
  const file = new File([content], name, { type: 'text/plain' });
  file.text = () => Promise.resolve(content);
  return file;
}

function makeJsonFile(name: string, data: unknown): File {
  const json = JSON.stringify(data);
  const file = new File([json], name, { type: 'application/json' });
  file.text = () => Promise.resolve(json);
  return file;
}

// ---------------------------------------------------------------------------
// parseSleepScoreFile
// ---------------------------------------------------------------------------

describe('parseSleepScoreFile', () => {
  it('should parse a valid CSV with header and two data rows', async () => {
    const csv = [
      'timestamp,overall_score,composition_score,revitalization_score,duration_score,deep_sleep_in_minutes,resting_heart_rate,restlessness',
      '2024-01-15T07:00:00Z,82,35,20,18,90,58,12',
      '2024-01-16T07:00:00Z,75,30,22,15,80,60,15',
    ].join('\n');

    const results = await parseSleepScoreFile(makeFile('sleep_score.csv', csv));

    expect(results).toHaveLength(2);

    expect(results[0]!.date).toBe('2024-01-15');
    expect(results[0]!.data.overallScore).toBe(82);
    expect(results[0]!.data.compositionScore).toBe(35);
    expect(results[0]!.data.revitalizationScore).toBe(20);
    expect(results[0]!.data.durationScore).toBe(18);
    expect(results[0]!.data.deepSleepMinutes).toBe(90);
    expect(results[0]!.data.restingHeartRate).toBe(58);
    expect(results[0]!.data.restlessnessScore).toBe(12);

    expect(results[1]!.date).toBe('2024-01-16');
    expect(results[1]!.data.overallScore).toBe(75);
  });

  it('should return an empty array for an empty file', async () => {
    const results = await parseSleepScoreFile(makeFile('sleep_score.csv', ''));
    expect(results).toEqual([]);
  });

  it('should return an empty array for header-only CSV', async () => {
    const csv =
      'timestamp,overall_score,composition_score,revitalization_score,duration_score,deep_sleep_in_minutes,resting_heart_rate,restlessness';
    const results = await parseSleepScoreFile(makeFile('sleep_score.csv', csv));
    expect(results).toEqual([]);
  });

  it('should skip rows with missing timestamp', async () => {
    const csv = [
      'timestamp,overall_score,composition_score,revitalization_score,duration_score,deep_sleep_in_minutes,resting_heart_rate,restlessness',
      ',82,35,20,18,90,58,12',
      '2024-01-16T07:00:00Z,75,30,22,15,80,60,15',
    ].join('\n');

    const results = await parseSleepScoreFile(makeFile('sleep_score.csv', csv));

    expect(results).toHaveLength(1);
    expect(results[0]!.date).toBe('2024-01-16');
  });

  it('should skip rows where overall_score is 0 (no score)', async () => {
    const csv = [
      'timestamp,overall_score,composition_score,revitalization_score,duration_score,deep_sleep_in_minutes,resting_heart_rate,restlessness',
      '2024-01-15T07:00:00Z,0,0,0,0,0,0,0',
      '2024-01-16T07:00:00Z,75,30,22,15,80,60,15',
    ].join('\n');

    const results = await parseSleepScoreFile(makeFile('sleep_score.csv', csv));

    expect(results).toHaveLength(1);
    expect(results[0]!.date).toBe('2024-01-16');
  });

  it('should default missing numeric columns to 0 when overall_score is present', async () => {
    const csv = ['timestamp,overall_score', '2024-01-15T07:00:00Z,82'].join('\n');

    const results = await parseSleepScoreFile(makeFile('sleep_score.csv', csv));

    expect(results).toHaveLength(1);
    expect(results[0]!.data.overallScore).toBe(82);
    expect(results[0]!.data.compositionScore).toBe(0);
    expect(results[0]!.data.revitalizationScore).toBe(0);
    expect(results[0]!.data.durationScore).toBe(0);
    expect(results[0]!.data.deepSleepMinutes).toBe(0);
    expect(results[0]!.data.restingHeartRate).toBe(0);
    expect(results[0]!.data.restlessnessScore).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseSpO2DailyFiles
// ---------------------------------------------------------------------------

describe('parseSpO2DailyFiles', () => {
  it('should parse valid CSV with avg/lower/upper values', async () => {
    const csv = [
      'timestamp,average_value,lower_bound,upper_bound',
      '2024-01-15T07:00:00Z,96.5,94.0,98.0',
      '2024-01-16T07:00:00Z,97.0,95.5,98.5',
    ].join('\n');

    const results = await parseSpO2DailyFiles([makeFile('spo2.csv', csv)]);

    expect(results).toHaveLength(2);

    expect(results[0]!.date).toBe('2024-01-15');
    expect(results[0]!.data.avg).toBe(96.5);
    expect(results[0]!.data.min).toBe(94.0);
    expect(results[0]!.data.max).toBe(98.0);
    expect(results[0]!.data.lowerBound).toBe(94.0);
    expect(results[0]!.data.upperBound).toBe(98.0);

    expect(results[1]!.date).toBe('2024-01-16');
    expect(results[1]!.data.avg).toBe(97.0);
  });

  it('should compute standardDeviation as (upper - lower) / 2', async () => {
    const csv = [
      'timestamp,average_value,lower_bound,upper_bound',
      '2024-01-15T07:00:00Z,96.0,92.0,100.0',
    ].join('\n');

    const results = await parseSpO2DailyFiles([makeFile('spo2.csv', csv)]);

    expect(results).toHaveLength(1);
    expect(results[0]!.data.standardDeviation).toBe(4.0);
  });

  it('should set standardDeviation to 0 when bounds are missing', async () => {
    const csv = ['timestamp,average_value', '2024-01-15T07:00:00Z,96.5'].join('\n');

    const results = await parseSpO2DailyFiles([makeFile('spo2.csv', csv)]);

    expect(results).toHaveLength(1);
    expect(results[0]!.data.standardDeviation).toBe(0);
    expect(results[0]!.data.lowerBound).toBe(0);
    expect(results[0]!.data.upperBound).toBe(0);
  });

  it('should return empty array for an empty file', async () => {
    const results = await parseSpO2DailyFiles([makeFile('spo2.csv', '')]);
    expect(results).toEqual([]);
  });

  it('should skip rows with missing average_value', async () => {
    const csv = [
      'timestamp,average_value,lower_bound,upper_bound',
      '2024-01-15T07:00:00Z,,94.0,98.0',
      '2024-01-16T07:00:00Z,97.0,95.5,98.5',
    ].join('\n');

    const results = await parseSpO2DailyFiles([makeFile('spo2.csv', csv)]);

    expect(results).toHaveLength(1);
    expect(results[0]!.date).toBe('2024-01-16');
  });

  it('should aggregate results from multiple files', async () => {
    const csv1 = [
      'timestamp,average_value,lower_bound,upper_bound',
      '2024-01-15T07:00:00Z,96.5,94.0,98.0',
    ].join('\n');
    const csv2 = [
      'timestamp,average_value,lower_bound,upper_bound',
      '2024-02-15T07:00:00Z,95.0,93.0,97.0',
    ].join('\n');

    const results = await parseSpO2DailyFiles([
      makeFile('spo2-jan.csv', csv1),
      makeFile('spo2-feb.csv', csv2),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.date).toBe('2024-01-15');
    expect(results[1]!.date).toBe('2024-02-15');
  });
});

// ---------------------------------------------------------------------------
// parseRestingHeartRateFiles
// ---------------------------------------------------------------------------

describe('parseRestingHeartRateFiles', () => {
  it('should parse valid JSON with dateTime and value.value fields', async () => {
    const data = [
      {
        dateTime: '01/15/24 00:00:00',
        value: { date: '01/15/2024', value: 58, error: 2.5 },
      },
      {
        dateTime: '01/16/24 00:00:00',
        value: { date: '01/16/2024', value: 60, error: 1.8 },
      },
    ];

    const results = await parseRestingHeartRateFiles([
      makeJsonFile('resting_heart_rate-2024-01-15.json', data),
    ]);

    expect(results).toHaveLength(2);

    expect(results[0]!.date).toBe('2024-01-15');
    expect(results[0]!.data.restingHeartRate).toBe(58);
    expect(results[0]!.data.error).toBe(2.5);

    expect(results[1]!.date).toBe('2024-01-16');
    expect(results[1]!.data.restingHeartRate).toBe(60);
    expect(results[1]!.data.error).toBe(1.8);
  });

  it('should prefer value.date over dateTime for the date key', async () => {
    const data = [
      {
        dateTime: '01/20/24 00:00:00',
        value: { date: '01/15/2024', value: 62 },
      },
    ];

    const results = await parseRestingHeartRateFiles([makeJsonFile('rhr.json', data)]);

    expect(results).toHaveLength(1);
    // Should use value.date (01/15/2024), not dateTime (01/20/24)
    expect(results[0]!.date).toBe('2024-01-15');
  });

  it('should fall back to dateTime when value.date is missing', async () => {
    const data = [
      {
        dateTime: '03/20/24 00:00:00',
        value: { value: 55 },
      },
    ];

    const results = await parseRestingHeartRateFiles([makeJsonFile('rhr.json', data)]);

    expect(results).toHaveLength(1);
    expect(results[0]!.date).toBe('2024-03-20');
  });

  it('should skip entries with no value.value', async () => {
    const data = [
      { dateTime: '01/15/24 00:00:00', value: {} },
      { dateTime: '01/16/24 00:00:00', value: { value: 58 } },
    ];

    const results = await parseRestingHeartRateFiles([makeJsonFile('rhr.json', data)]);

    expect(results).toHaveLength(1);
    expect(results[0]!.data.restingHeartRate).toBe(58);
  });

  it('should return empty array for a file with no valid entries', async () => {
    const data = [{ dateTime: '01/15/24 00:00:00' }, { value: {} }];

    const results = await parseRestingHeartRateFiles([makeJsonFile('rhr.json', data)]);

    expect(results).toEqual([]);
  });

  it('should set error to null when not present in the entry', async () => {
    const data = [{ dateTime: '01/15/24 00:00:00', value: { date: '01/15/2024', value: 58 } }];

    const results = await parseRestingHeartRateFiles([makeJsonFile('rhr.json', data)]);

    expect(results).toHaveLength(1);
    expect(results[0]!.data.error).toBeNull();
  });

  it('should not throw on malformed JSON, returning empty results', async () => {
    const file = makeFile('rhr.json', 'not valid json');

    const results = await parseRestingHeartRateFiles([file]);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseRespiratoryRateFiles
// ---------------------------------------------------------------------------

describe('parseRespiratoryRateFiles', () => {
  it('should parse simple format with a single daily_respiratory_rate column', async () => {
    const csv = [
      'timestamp,daily_respiratory_rate',
      '2024-01-15T07:00:00,15.2',
      '2024-01-16T07:00:00,14.8',
    ].join('\n');

    const results = await parseRespiratoryRateFiles([makeFile('rr.csv', csv)]);

    expect(results).toHaveLength(2);

    expect(results[0]!.date).toBe('2024-01-15');
    expect(results[0]!.data.fullSleepRate).toBe(15.2);
    expect(results[0]!.data.fullSleepStdDev).toBe(0);
    expect(results[0]!.data.deepRate).toBeNull();
    expect(results[0]!.data.lightRate).toBeNull();
    expect(results[0]!.data.remRate).toBeNull();

    expect(results[1]!.date).toBe('2024-01-16');
    expect(results[1]!.data.fullSleepRate).toBe(14.8);
  });

  it('should parse detailed format with per-stage breakdown', async () => {
    const csv = [
      'timestamp,full_sleep_breathing_rate,full_sleep_standard_deviation,deep_sleep_breathing_rate,deep_sleep_standard_deviation,light_sleep_breathing_rate,light_sleep_standard_deviation,rem_sleep_breathing_rate,rem_sleep_standard_deviation',
      '2024-01-15T07:00:00,15.2,1.1,14.0,0.8,15.5,1.2,16.0,1.5',
    ].join('\n');

    const results = await parseRespiratoryRateFiles([makeFile('rr.csv', csv)]);

    expect(results).toHaveLength(1);

    const data = results[0]!.data;
    expect(data.fullSleepRate).toBe(15.2);
    expect(data.fullSleepStdDev).toBe(1.1);
    expect(data.deepRate).toBe(14.0);
    expect(data.deepStdDev).toBe(0.8);
    expect(data.lightRate).toBe(15.5);
    expect(data.lightStdDev).toBe(1.2);
    expect(data.remRate).toBe(16.0);
    expect(data.remStdDev).toBe(1.5);
  });

  it('should skip rows with missing rate value in simple format', async () => {
    const csv = [
      'timestamp,daily_respiratory_rate',
      '2024-01-15T07:00:00,',
      '2024-01-16T07:00:00,14.8',
    ].join('\n');

    const results = await parseRespiratoryRateFiles([makeFile('rr.csv', csv)]);

    expect(results).toHaveLength(1);
    expect(results[0]!.date).toBe('2024-01-16');
  });

  it('should skip rows with missing full_sleep_breathing_rate in detailed format', async () => {
    const csv = [
      'timestamp,full_sleep_breathing_rate,full_sleep_standard_deviation',
      '2024-01-15T07:00:00,,1.1',
      '2024-01-16T07:00:00,15.0,1.2',
    ].join('\n');

    const results = await parseRespiratoryRateFiles([makeFile('rr.csv', csv)]);

    expect(results).toHaveLength(1);
    expect(results[0]!.date).toBe('2024-01-16');
  });

  it('should return empty for a file with no parseable rows', async () => {
    const results = await parseRespiratoryRateFiles([makeFile('rr.csv', '')]);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseHRVDailyFiles
// ---------------------------------------------------------------------------

describe('parseHRVDailyFiles', () => {
  it('should parse valid CSV with rmssd values', async () => {
    const csv = [
      'timestamp,rmssd,nremhr,entropy',
      '2024-01-15T07:00:00,35.2,55,1.82',
      '2024-01-16T07:00:00,42.1,52,1.95',
    ].join('\n');

    const results = await parseHRVDailyFiles([makeFile('hrv.csv', csv)]);

    expect(results).toHaveLength(2);

    expect(results[0]!.date).toBe('2024-01-15');
    expect(results[0]!.data.dailyRmssd).toBe(35.2);
    expect(results[0]!.data.deepRmssd).toBe(35.2); // mirrored from dailyRmssd
    expect(results[0]!.data.nremHeartRate).toBe(55);
    expect(results[0]!.data.entropy).toBe(1.82);

    expect(results[1]!.date).toBe('2024-01-16');
    expect(results[1]!.data.dailyRmssd).toBe(42.1);
    expect(results[1]!.data.nremHeartRate).toBe(52);
    expect(results[1]!.data.entropy).toBe(1.95);
  });

  it('should set deepRmssd equal to dailyRmssd (daily summary has one value)', async () => {
    const csv = ['timestamp,rmssd', '2024-01-15T07:00:00,30.0'].join('\n');

    const results = await parseHRVDailyFiles([makeFile('hrv.csv', csv)]);

    expect(results).toHaveLength(1);
    expect(results[0]!.data.dailyRmssd).toBe(30.0);
    expect(results[0]!.data.deepRmssd).toBe(30.0);
  });

  it('should skip rows where rmssd is missing', async () => {
    const csv = [
      'timestamp,rmssd,nremhr',
      '2024-01-15T07:00:00,,55',
      '2024-01-16T07:00:00,42.1,52',
    ].join('\n');

    const results = await parseHRVDailyFiles([makeFile('hrv.csv', csv)]);

    expect(results).toHaveLength(1);
    expect(results[0]!.date).toBe('2024-01-16');
  });

  it('should default nremHeartRate to 0 and entropy to null when columns are absent', async () => {
    const csv = ['timestamp,rmssd', '2024-01-15T07:00:00,38.5'].join('\n');

    const results = await parseHRVDailyFiles([makeFile('hrv.csv', csv)]);

    expect(results).toHaveLength(1);
    expect(results[0]!.data.nremHeartRate).toBe(0);
    expect(results[0]!.data.entropy).toBeNull();
  });

  it('should return empty for an empty file', async () => {
    const results = await parseHRVDailyFiles([makeFile('hrv.csv', '')]);
    expect(results).toEqual([]);
  });

  it('should aggregate results from multiple files', async () => {
    const csv1 = ['timestamp,rmssd', '2024-01-15T07:00:00,35.0'].join('\n');
    const csv2 = ['timestamp,rmssd', '2024-02-15T07:00:00,40.0'].join('\n');

    const results = await parseHRVDailyFiles([
      makeFile('hrv-jan.csv', csv1),
      makeFile('hrv-feb.csv', csv2),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.date).toBe('2024-01-15');
    expect(results[1]!.date).toBe('2024-02-15');
  });

  it('should not throw on malformed file content, returning empty results', async () => {
    // A file that triggers a parse error in parseCSV's extractDate call
    // because there is no valid timestamp
    const csv = ['timestamp,rmssd', 'not-a-timestamp,35.0'].join('\n');

    // The parser catches internal errors and skips rows; it should not throw
    const results = await parseHRVDailyFiles([makeFile('hrv.csv', csv)]);

    // The row with the invalid timestamp will be skipped (extractDate throws
    // inside the try/catch)
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseHeartRateIntradayFiles
// ---------------------------------------------------------------------------

interface RawHREntry {
  dateTime: string;
  value: { bpm: number; confidence: number };
}

function hrEntry(dateTime: string, bpm: number, confidence = 2): RawHREntry {
  return { dateTime, value: { bpm, confidence } };
}

describe('parseHeartRateIntradayFiles', () => {
  it('should parse samples and compute offsets from the first sample', async () => {
    const file = makeJsonFile('heart_rate-2016-08-24.json', [
      hrEntry('08/24/16 23:59:54', 70, 3),
      hrEntry('08/24/16 23:59:59', 72, 2),
    ]);

    const results = await parseHeartRateIntradayFiles([file]);

    expect(results).toHaveLength(1);
    const rec = results[0]!;
    expect(rec.date).toBe('2016-08-24');
    expect(rec.data.baseTimestampMs).toBe(Date.UTC(2016, 7, 24, 23, 59, 54));
    expect(rec.data.sampleCount).toBe(2);
    expect(rec.data.samples).toEqual([
      { offsetSec: 0, bpm: 70, confidence: 3 },
      { offsetSec: 5, bpm: 72, confidence: 2 },
    ]);
  });

  it('should handle the 2-digit-year / local-time base deterministically', async () => {
    // 2-digit year -> 21st century; local wall-clock -> UTC (no TZ shift).
    const file = makeJsonFile('heart_rate-2017-01-15.json', [hrEntry('01/15/17 06:00:00', 60, 1)]);

    const { data } = (await parseHeartRateIntradayFiles([file]))[0]!;
    expect(data.baseTimestampMs).toBe(Date.UTC(2017, 0, 15, 6, 0, 0));
    expect(new Date(data.baseTimestampMs).getUTCFullYear()).toBe(2017);
    expect(new Date(data.baseTimestampMs).getUTCHours()).toBe(6);
  });

  it('should split a midnight-straddling file into one record per calendar date', async () => {
    // Real exports: heart_rate-2016-08-24.json can begin on 08/25/16, and a
    // night straddles midnight. Date key comes from each sample, not the file.
    const file = makeJsonFile('heart_rate-2016-08-24.json', [
      hrEntry('08/24/16 23:59:50', 65),
      hrEntry('08/25/16 00:00:05', 66),
      hrEntry('08/25/16 00:00:10', 67),
    ]);

    const results = await parseHeartRateIntradayFiles([file]);
    const byDate = Object.fromEntries(results.map((r) => [r.date, r]));

    expect(Object.keys(byDate).sort()).toEqual(['2016-08-24', '2016-08-25']);
    expect(byDate['2016-08-24']!.data.sampleCount).toBe(1);
    expect(byDate['2016-08-25']!.data.sampleCount).toBe(2);
    // Each record's base is its own first sample.
    expect(byDate['2016-08-25']!.data.baseTimestampMs).toBe(Date.UTC(2016, 7, 25, 0, 0, 5));
    expect(byDate['2016-08-25']!.data.samples[1]!.offsetSec).toBe(5);
  });

  it('should sort out-of-order samples chronologically before computing offsets', async () => {
    const file = makeJsonFile('heart_rate-2020-02-02.json', [
      hrEntry('02/02/20 08:00:10', 80),
      hrEntry('02/02/20 08:00:00', 78),
      hrEntry('02/02/20 08:00:05', 79),
    ]);

    const { data } = (await parseHeartRateIntradayFiles([file]))[0]!;
    expect(data.baseTimestampMs).toBe(Date.UTC(2020, 1, 2, 8, 0, 0));
    expect(data.samples.map((s) => s.offsetSec)).toEqual([0, 5, 10]);
    expect(data.samples.map((s) => s.bpm)).toEqual([78, 79, 80]);
  });

  it('should skip malformed rows (bad date, missing/non-numeric bpm) without throwing', async () => {
    const file = makeJsonFile('heart_rate-2020-03-03.json', [
      hrEntry('03/03/20 10:00:00', 90),
      { dateTime: 'not-a-date', value: { bpm: 91, confidence: 2 } },
      { dateTime: '03/03/20 10:00:10', value: { confidence: 2 } } as unknown as RawHREntry,
      { value: { bpm: 92, confidence: 1 } } as unknown as RawHREntry,
      hrEntry('03/03/20 10:00:20', 93),
    ]);

    const results = await parseHeartRateIntradayFiles([file]);
    expect(results).toHaveLength(1);
    expect(results[0]!.data.sampleCount).toBe(2);
    expect(results[0]!.data.samples.map((s) => s.bpm)).toEqual([90, 93]);
  });

  it('should default missing confidence to 0', async () => {
    const file = makeJsonFile('heart_rate-2020-04-04.json', [
      { dateTime: '04/04/20 09:00:00', value: { bpm: 55 } } as unknown as RawHREntry,
    ]);

    const { data } = (await parseHeartRateIntradayFiles([file]))[0]!;
    expect(data.samples[0]!.confidence).toBe(0);
  });

  it('should return an empty array for an empty file', async () => {
    const file = makeJsonFile('heart_rate-2020-05-05.json', []);
    expect(await parseHeartRateIntradayFiles([file])).toEqual([]);
  });

  it('should not throw on invalid JSON, returning empty results', async () => {
    const file = makeFile('heart_rate-2020-06-06.json', '{ this is not json');
    expect(await parseHeartRateIntradayFiles([file])).toEqual([]);
  });
});
