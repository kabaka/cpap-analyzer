/**
 * Unit tests for Google Health CSV utilities.
 *
 * Validates the RFC 4180 CSV parser, date/timestamp extractors, and numeric
 * field parser — the pure-function foundation of the import pipeline.
 *
 * @module services/import/googlehealth/__tests__/csv-utils.test
 */

import { describe, it, expect } from 'vitest';
import {
  parseCSV,
  extractDate,
  parseFitbitLegacyDate,
  parseTimestamp,
  parseNumericField,
  parseNumericFieldWithDefault,
} from '../csv-utils';

// ---------------------------------------------------------------------------
// parseCSV
// ---------------------------------------------------------------------------

describe('parseCSV', () => {
  it('should parse a basic CSV with header and two data rows', () => {
    const text = 'name,age,city\nAlice,30,NYC\nBob,25,LA';
    const result = parseCSV(text);

    expect(result.headers).toEqual(['name', 'age', 'city']);
    expect(result.rows).toEqual([
      ['Alice', '30', 'NYC'],
      ['Bob', '25', 'LA'],
    ]);
  });

  it('should handle quoted fields containing commas', () => {
    const text = 'name,address\nAlice,"123 Main St, Apt 4"\nBob,"456 Oak Ave, Suite 10"';
    const result = parseCSV(text);

    expect(result.headers).toEqual(['name', 'address']);
    expect(result.rows).toEqual([
      ['Alice', '123 Main St, Apt 4'],
      ['Bob', '456 Oak Ave, Suite 10'],
    ]);
  });

  it('should handle quoted fields containing embedded newlines', () => {
    const text = 'name,bio\nAlice,"Line one\nLine two"\nBob,simple';
    const result = parseCSV(text);

    expect(result.headers).toEqual(['name', 'bio']);
    expect(result.rows).toEqual([
      ['Alice', 'Line one\nLine two'],
      ['Bob', 'simple'],
    ]);
  });

  it('should handle escaped double-quotes inside quoted fields', () => {
    const text = 'name,quote\nAlice,"She said ""hello"""\nBob,"No quotes"';
    const result = parseCSV(text);

    expect(result.headers).toEqual(['name', 'quote']);
    expect(result.rows).toEqual([
      ['Alice', 'She said "hello"'],
      ['Bob', 'No quotes'],
    ]);
  });

  it('should handle empty fields', () => {
    const text = 'a,b,c\n1,,3\n,,';
    const result = parseCSV(text);

    expect(result.headers).toEqual(['a', 'b', 'c']);
    // The all-empty row is filtered out by parseCSV
    expect(result.rows).toEqual([['1', '', '3']]);
  });

  it('should strip UTF-8 BOM from the beginning of text', () => {
    const bom = '﻿';
    const text = `${bom}name,value\nAlice,42`;
    const result = parseCSV(text);

    expect(result.headers).toEqual(['name', 'value']);
    expect(result.rows).toEqual([['Alice', '42']]);
  });

  it('should return empty headers and no rows for empty input', () => {
    const result = parseCSV('');

    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it('should return the header row and no data rows for a single-row CSV', () => {
    const text = 'timestamp,overall_score,composition_score';
    const result = parseCSV(text);

    expect(result.headers).toEqual(['timestamp', 'overall_score', 'composition_score']);
    expect(result.rows).toEqual([]);
  });

  it('should handle Windows CRLF line endings', () => {
    const text = 'a,b\r\n1,2\r\n3,4';
    const result = parseCSV(text);

    expect(result.headers).toEqual(['a', 'b']);
    expect(result.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('should handle legacy Mac CR-only line endings', () => {
    const text = 'a,b\r1,2\r3,4';
    const result = parseCSV(text);

    expect(result.headers).toEqual(['a', 'b']);
    expect(result.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('should filter out rows where all fields are empty or whitespace', () => {
    const text = 'a,b\n1,2\n  , \n3,4';
    const result = parseCSV(text);

    expect(result.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// extractDate
// ---------------------------------------------------------------------------

describe('extractDate', () => {
  it('should extract date from a full ISO 8601 UTC timestamp', () => {
    expect(extractDate('2024-01-15T22:30:00Z')).toBe('2024-01-15');
  });

  it('should extract date from an ISO timestamp without timezone', () => {
    expect(extractDate('2024-01-15T07:00:00')).toBe('2024-01-15');
  });

  it('should extract date from a plain YYYY-MM-DD string', () => {
    expect(extractDate('2024-01-15')).toBe('2024-01-15');
  });

  it('should extract date from a timestamp with milliseconds', () => {
    expect(extractDate('2024-01-15T22:30:00.000Z')).toBe('2024-01-15');
  });

  it('should handle leading/trailing whitespace', () => {
    expect(extractDate('  2024-06-01T12:00:00Z  ')).toBe('2024-06-01');
  });

  it('should throw for a string that is not a parseable date', () => {
    expect(() => extractDate('no-date-here')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseFitbitLegacyDate
// ---------------------------------------------------------------------------

describe('parseFitbitLegacyDate', () => {
  it('should parse MM/DD/YY format (2-digit year) to YYYY-MM-DD', () => {
    expect(parseFitbitLegacyDate('01/15/24')).toBe('2024-01-15');
  });

  it('should parse MM/DD/YYYY format (4-digit year) to YYYY-MM-DD', () => {
    expect(parseFitbitLegacyDate('01/15/2024')).toBe('2024-01-15');
  });

  it('should parse M/D/YY format without leading zeros', () => {
    expect(parseFitbitLegacyDate('1/5/24')).toBe('2024-01-05');
  });

  it('should parse MM/DD/YY HH:MM:SS format (ignoring time portion)', () => {
    expect(parseFitbitLegacyDate('03/20/24 14:30:00')).toBe('2024-03-20');
  });

  it('should assume 21st century for 2-digit years', () => {
    expect(parseFitbitLegacyDate('12/31/99')).toBe('2099-12-31');
  });

  it('should handle leading/trailing whitespace', () => {
    expect(parseFitbitLegacyDate('  06/10/2025  ')).toBe('2025-06-10');
  });

  it('should throw for an empty string', () => {
    expect(() => parseFitbitLegacyDate('')).toThrow();
  });

  it('should throw for a non-date string', () => {
    expect(() => parseFitbitLegacyDate('not-a-date')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseTimestamp
// ---------------------------------------------------------------------------

describe('parseTimestamp', () => {
  it('should parse an ISO 8601 UTC timestamp', () => {
    const d = parseTimestamp('2024-01-15T22:30:00Z');
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2024-01-15T22:30:00.000Z');
  });

  it('should parse an ISO timestamp with milliseconds', () => {
    const d = parseTimestamp('2024-01-15T22:30:00.000Z');
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).not.toBeNaN();
  });

  it('should parse a date-only ISO string', () => {
    const d = parseTimestamp('2024-01-15');
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).not.toBeNaN();
  });

  it('should throw for an invalid date string', () => {
    expect(() => parseTimestamp('not-a-date')).toThrow('Invalid timestamp');
  });

  it('should throw for a completely empty string', () => {
    expect(() => parseTimestamp('')).toThrow('Invalid timestamp');
  });
});

// ---------------------------------------------------------------------------
// parseNumericField
// ---------------------------------------------------------------------------

describe('parseNumericField', () => {
  it('should parse a valid decimal number', () => {
    expect(parseNumericField('123.45')).toBe(123.45);
  });

  it('should parse an integer string', () => {
    expect(parseNumericField('42')).toBe(42);
  });

  it('should parse zero', () => {
    expect(parseNumericField('0')).toBe(0);
  });

  it('should parse a negative number', () => {
    expect(parseNumericField('-3.14')).toBe(-3.14);
  });

  it('should return null for an empty string', () => {
    expect(parseNumericField('')).toBeNull();
  });

  it('should return null for a whitespace-only string', () => {
    expect(parseNumericField('   ')).toBeNull();
  });

  it('should return null for a non-numeric string', () => {
    expect(parseNumericField('abc')).toBeNull();
  });

  it('should return null for undefined', () => {
    expect(parseNumericField(undefined)).toBeNull();
  });

  it('should return null for NaN-producing inputs like "NaN"', () => {
    expect(parseNumericField('NaN')).toBeNull();
  });

  it('should return null for Infinity', () => {
    expect(parseNumericField('Infinity')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseNumericFieldWithDefault
// ---------------------------------------------------------------------------

describe('parseNumericFieldWithDefault', () => {
  it('should return the parsed number when valid', () => {
    expect(parseNumericFieldWithDefault('55.5', 0)).toBe(55.5);
  });

  it('should return the default when the field is empty', () => {
    expect(parseNumericFieldWithDefault('', 99)).toBe(99);
  });

  it('should return the default when the field is undefined', () => {
    expect(parseNumericFieldWithDefault(undefined, -1)).toBe(-1);
  });

  it('should return the default when the field is non-numeric', () => {
    expect(parseNumericFieldWithDefault('abc', 0)).toBe(0);
  });
});
