/**
 * Tests for graceful handling of header-only / empty EDF stubs.
 *
 * ResMed writes a 256-byte `*_CSL.edf` (Cheyne-Stokes) file on nights with
 * zero periodic-breathing events: a valid 256-byte global header that declares
 * numSignals ≥ 1 (so the declared headerBytes exceeds 256) but with NO
 * signal-header block and NO data. This must parse to an EMPTY EDFFile, not
 * throw. Genuine truncation (declared data records, cut off mid-data) must
 * still throw.
 */

import { describe, it, expect } from 'vitest';
import { EDFParser } from '@/parsers/edf/EDFParser';
import { EDFParseError } from '@/parsers/edf/errors';
import { generateBRPFile } from '@/test/generators/edf-generator';

/**
 * Build a 256-byte global-header-only EDF buffer (CSL-style stub): a valid
 * fixed header declaring `numSignals` signals and 0 data records, with no
 * signal-header block following.
 */
function makeCslStub(numSignals: number): ArrayBuffer {
  const buffer = new ArrayBuffer(256);
  const bytes = new Uint8Array(buffer);
  const encoder = new TextEncoder();
  const write = (offset: number, length: number, value: string): void => {
    const padded = value.padEnd(length, ' ').slice(0, length);
    bytes.set(encoder.encode(padded), offset);
  };

  const headerBytes = 256 + 256 * numSignals; // declared, but absent on disk
  write(0, 8, '0'); // version
  write(8, 80, '23241654214 AirSense 11'); // patient id
  write(88, 80, 'Startdate 17-SEP-2024 X X X SRN=23241654214  MID=36  VID=39');
  write(168, 8, '17.09.24'); // date
  write(176, 8, '12.00.00'); // time
  write(184, 8, String(headerBytes)); // header byte count (768 for 2 signals)
  write(192, 44, 'EDF+C'); // reserved
  write(236, 8, '0'); // numDataRecords
  write(244, 8, '0'); // dataRecordDuration (annotation-only / empty)
  write(252, 4, String(numSignals)); // numSignals

  return buffer;
}

describe('EDFParser — empty CSL-style stub handling', () => {
  const parser = new EDFParser();

  it('parses a 256-byte CSL stub (numSignals=2) to an empty EDFFile without throwing', () => {
    const buffer = makeCslStub(2);
    expect(buffer.byteLength).toBe(256);

    const edf = parser.parse(buffer);

    expect(edf.signals).toHaveLength(0);
    expect(edf.annotations).toBeUndefined();
    expect(edf.duration).toBe(0);
    // Header is preserved but normalized to an empty record/signal count.
    expect(edf.header.numSignals).toBe(0);
    expect(edf.header.numDataRecords).toBe(0);
    expect(edf.header.version).toBe('0');
  });

  it('parses a 256-byte stub with numSignals=1 to an empty EDFFile', () => {
    const edf = parser.parse(makeCslStub(1));
    expect(edf.signals).toHaveLength(0);
    expect(edf.duration).toBe(0);
  });

  it('validate() reports a 256-byte CSL stub as structurally valid', () => {
    const result = parser.validate(makeCslStub(2));
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('still throws DATA_TRUNCATED for a genuinely truncated data file', () => {
    // A real BRP file (3 signals, 60 records) cut off partway through the data
    // block — declared records but missing bytes — is genuine corruption.
    const full = generateBRPFile({ numDataRecords: 60 });
    // Keep the full header + signal headers but drop most of the data.
    const headerBytes = 256 + 256 * 3;
    const truncated = full.slice(0, headerBytes + 100); // 100 bytes of data only

    expect(() => parser.parse(truncated)).toThrowError(EDFParseError);
    try {
      parser.parse(truncated);
    } catch (err) {
      expect(err).toBeInstanceOf(EDFParseError);
      expect((err as EDFParseError).code).toBe('DATA_TRUNCATED');
    }
  });

  it('still throws when a multi-signal header block is partially present (corruption)', () => {
    // 256-byte fixed header + a partial signal-header block (not exactly 256,
    // and short of the declared headerBytes) is NOT the benign empty pattern.
    const stub = makeCslStub(3); // declares headerBytes = 1024
    const partial = new ArrayBuffer(256 + 300); // 300 bytes into the 768-byte sig block
    new Uint8Array(partial).set(new Uint8Array(stub), 0);

    expect(() => parser.parse(partial)).toThrowError(EDFParseError);
    try {
      parser.parse(partial);
    } catch (err) {
      expect((err as EDFParseError).code).toBe('HEADER_TOO_SHORT');
    }
  });
});
