import { describe, it, expect } from 'vitest';
import { EDFParser } from '@/parsers/edf/EDFParser';
import { EDFParseError } from '@/parsers/edf/errors';
import {
  generateEDFFile,
  generateBRPFile,
  constantGenerator,
  rampGenerator,
} from '@/test/generators/edf-generator';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EDFParser', () => {
  const parser = new EDFParser();

  // -----------------------------------------------------------------------
  // Header parsing
  // -----------------------------------------------------------------------

  describe('parseHeader', () => {
    it('should parse header fields from valid EDF binary', () => {
      const buffer = generateBRPFile();
      const edf = parser.parse(buffer);

      expect(edf.header.version).toBe('0');
      expect(edf.header.patientId).toBe('12345678 AirSense 10 AutoSet');
      expect(edf.header.numDataRecords).toBe(60);
      expect(edf.header.dataRecordDuration).toBe(1);
      expect(edf.header.numSignals).toBe(3);
    });

    it('should parse custom patient ID', () => {
      const buffer = generateBRPFile({ patientId: 'CUSTOM_PATIENT_42' });
      const edf = parser.parse(buffer);
      expect(edf.header.patientId).toBe('CUSTOM_PATIENT_42');
    });

    it('should compute headerBytes as 256 + 256*numSignals', () => {
      const buffer = generateBRPFile();
      const edf = parser.parse(buffer);
      expect(edf.header.headerBytes).toBe(256 + 256 * 3);
    });

    it('should parse start date correctly', () => {
      const startDate = new Date(2026, 0, 15, 22, 30, 0);
      const buffer = generateBRPFile({ startDate });
      const edf = parser.parse(buffer);
      expect(edf.header.startDate.getFullYear()).toBe(2026);
      expect(edf.header.startDate.getMonth()).toBe(0); // January
      expect(edf.header.startDate.getDate()).toBe(15);
      expect(edf.header.startDate.getHours()).toBe(22);
      expect(edf.header.startDate.getMinutes()).toBe(30);
    });
  });

  // -----------------------------------------------------------------------
  // Signal header parsing
  // -----------------------------------------------------------------------

  describe('parseSignalHeaders', () => {
    it('should parse signal labels, units, and ranges', () => {
      const buffer = generateBRPFile();
      const edf = parser.parse(buffer);

      expect(edf.signals).toHaveLength(3);
      const [sig0, sig1, sig2] = edf.signals;
      if (!sig0 || !sig1 || !sig2) throw new Error('expected 3 signals');
      expect(sig0.label).toBe('Flow');
      expect(sig0.physicalDimension).toBe('L/min');
      expect(sig1.label).toBe('MaskPressure');
      expect(sig2.label).toBe('Leak');
    });

    it('should parse digitalMin and digitalMax', () => {
      const buffer = generateBRPFile();
      const edf = parser.parse(buffer);
      const sig0 = edf.signals[0];
      if (!sig0) throw new Error('expected signal at index 0');

      expect(sig0.digitalMin).toBe(-32768);
      expect(sig0.digitalMax).toBe(32767);
    });

    it('should parse physicalMin and physicalMax', () => {
      const buffer = generateBRPFile();
      const edf = parser.parse(buffer);
      const sig0 = edf.signals[0];
      if (!sig0) throw new Error('expected signal at index 0');

      expect(sig0.physicalMin).toBe(-200);
      expect(sig0.physicalMax).toBe(200);
    });

    it('should parse samplesPerRecord and sampleRate', () => {
      const buffer = generateBRPFile({ flowSampleRate: 25 });
      const edf = parser.parse(buffer);
      const sig0 = edf.signals[0];
      if (!sig0) throw new Error('expected signal at index 0');

      expect(sig0.samplesPerRecord).toBe(25);
      expect(sig0.sampleRate).toBe(25); // 25 samples / 1s record
    });
  });

  // -----------------------------------------------------------------------
  // Data parsing — digital-to-physical conversion
  // -----------------------------------------------------------------------

  describe('parseDataRecords', () => {
    it('should convert constant digital values to correct physical values', () => {
      const buffer = generateEDFFile({
        numDataRecords: 10,
        signals: [
          {
            label: 'Test',
            physicalDimension: 'units',
            physicalMin: 0,
            physicalMax: 100,
            digitalMin: -32768,
            digitalMax: 32767,
            samplesPerRecord: 1,
            generator: constantGenerator(50),
          },
        ],
      });

      const edf = parser.parse(buffer);
      const sig0 = edf.signals[0];
      if (!sig0) throw new Error('expected signal at index 0');
      const samples = sig0.samples;

      // Due to 16-bit quantization, expect close but not exact
      for (let i = 0; i < samples.length; i++) {
        expect(samples[i]).toBeCloseTo(50, 1);
      }
    });

    it('should map digital 0 to midpoint of physical range', () => {
      // Physical range [-100, 100], digital range [-32768, 32767]
      // Digital 0 → physical = (0 - (-32768)) / (32767 - (-32768)) * 200 + (-100)
      //   = 32768 / 65535 * 200 - 100 ≈ 0.0015... ≈ 0
      const buffer = generateEDFFile({
        numDataRecords: 1,
        signals: [
          {
            label: 'Test',
            physicalDimension: 'units',
            physicalMin: -100,
            physicalMax: 100,
            digitalMin: -32768,
            digitalMax: 32767,
            samplesPerRecord: 1,
            generator: constantGenerator(0),
          },
        ],
      });

      const edf = parser.parse(buffer);
      const sig0 = edf.signals[0];
      if (!sig0) throw new Error('expected signal at index 0');
      expect(sig0.samples[0]).toBeCloseTo(0, 1);
    });

    it('should map digital max to physical max', () => {
      const buffer = generateEDFFile({
        numDataRecords: 1,
        signals: [
          {
            label: 'Test',
            physicalDimension: 'units',
            physicalMin: 0,
            physicalMax: 100,
            digitalMin: -32768,
            digitalMax: 32767,
            samplesPerRecord: 1,
            generator: constantGenerator(100),
          },
        ],
      });

      const edf = parser.parse(buffer);
      const sig0 = edf.signals[0];
      if (!sig0) throw new Error('expected signal at index 0');
      // Generator outputs 100 → digital 32767 → physical ≈ 100
      expect(sig0.samples[0]).toBeCloseTo(100, 1);
    });

    it('should map digital min to physical min', () => {
      const buffer = generateEDFFile({
        numDataRecords: 1,
        signals: [
          {
            label: 'Test',
            physicalDimension: 'units',
            physicalMin: 0,
            physicalMax: 100,
            digitalMin: -32768,
            digitalMax: 32767,
            samplesPerRecord: 1,
            generator: constantGenerator(0),
          },
        ],
      });

      const edf = parser.parse(buffer);
      const sig0 = edf.signals[0];
      if (!sig0) throw new Error('expected signal at index 0');
      expect(sig0.samples[0]).toBeCloseTo(0, 1);
    });

    it('should produce correct ramp values (linear conversion check)', () => {
      const numRecords = 100;
      const buffer = generateEDFFile({
        numDataRecords: numRecords,
        signals: [
          {
            label: 'Ramp',
            physicalDimension: 'units',
            physicalMin: 0,
            physicalMax: 100,
            digitalMin: -32768,
            digitalMax: 32767,
            samplesPerRecord: 1,
            generator: rampGenerator(0, 100),
          },
        ],
      });

      const edf = parser.parse(buffer);
      const sig0 = edf.signals[0];
      if (!sig0) throw new Error('expected signal at index 0');
      const samples = sig0.samples;
      expect(samples.length).toBe(numRecords);

      // First sample ≈ 0, last sample ≈ 100
      expect(samples[0]).toBeCloseTo(0, 0);
      expect(samples[numRecords - 1]).toBeCloseTo(100, 0);
    });
  });

  // -----------------------------------------------------------------------
  // Multi-signal interleaving
  // -----------------------------------------------------------------------

  describe('multi-signal files', () => {
    it('should correctly deinterleave samples across signals', () => {
      const buffer = generateEDFFile({
        numDataRecords: 10,
        signals: [
          {
            label: 'Sig1',
            physicalDimension: 'u',
            physicalMin: 0,
            physicalMax: 10,
            samplesPerRecord: 2,
            generator: constantGenerator(5),
          },
          {
            label: 'Sig2',
            physicalDimension: 'u',
            physicalMin: 0,
            physicalMax: 200,
            samplesPerRecord: 4,
            generator: constantGenerator(100),
          },
        ],
      });

      const edf = parser.parse(buffer);
      expect(edf.signals).toHaveLength(2);
      const [sig0, sig1] = edf.signals;
      if (!sig0 || !sig1) throw new Error('expected 2 signals');
      expect(sig0.samples.length).toBe(20); // 2 * 10
      expect(sig1.samples.length).toBe(40); // 4 * 10

      for (let i = 0; i < sig0.samples.length; i++) {
        expect(sig0.samples[i]).toBeCloseTo(5, 1);
      }
      for (let i = 0; i < sig1.samples.length; i++) {
        expect(sig1.samples[i]).toBeCloseTo(100, 0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Annotations
  // -----------------------------------------------------------------------

  describe('annotations', () => {
    it('should parse TAL annotations with onset, duration, and labels', () => {
      const buffer = generateEDFFile({
        numDataRecords: 60,
        signals: [],
        annotations: [
          { onset: 10, duration: 15, label: 'Obstructive Apnea' },
          { onset: 30, duration: 12, label: 'Hypopnea' },
        ],
      });

      const edf = parser.parse(buffer);
      const annotations = edf.annotations;
      if (!annotations) throw new Error('expected annotations');
      expect(annotations.length).toBeGreaterThanOrEqual(2);

      // Find the event annotations (exclude timekeeping TALs)
      const eventAnns = annotations.filter((a) =>
        a.labels.some((l) => l === 'Obstructive Apnea' || l === 'Hypopnea'),
      );
      expect(eventAnns.length).toBe(2);

      const oa = eventAnns.find((a) => a.labels.includes('Obstructive Apnea'));
      if (!oa) throw new Error('expected Obstructive Apnea annotation');
      expect(oa.onset).toBeCloseTo(10, 0);
      expect(oa.duration).toBe(15);

      const hyp = eventAnns.find((a) => a.labels.includes('Hypopnea'));
      if (!hyp) throw new Error('expected Hypopnea annotation');
      expect(hyp.onset).toBeCloseTo(30, 0);
    });
  });

  // -----------------------------------------------------------------------
  // Date parsing — Y2K pivot
  // -----------------------------------------------------------------------

  describe('date parsing Y2K pivot', () => {
    it('should treat year 26 as 2026', () => {
      const startDate = new Date(2026, 5, 15, 10, 0, 0);
      const buffer = generateBRPFile({ startDate });
      const edf = parser.parse(buffer);
      expect(edf.header.startDate.getFullYear()).toBe(2026);
    });

    it('should treat year 79 as 2079', () => {
      const startDate = new Date(2079, 0, 1, 0, 0, 0);
      const buffer = generateBRPFile({ startDate });
      const edf = parser.parse(buffer);
      expect(edf.header.startDate.getFullYear()).toBe(2079);
    });

    it('should treat year 80 as 1980', () => {
      // EDF format stores 2-digit year; year 80 in EDF → 1980
      // We need to craft a buffer manually for this since Date(1980,...) → yy=80
      const startDate = new Date(1980, 6, 20, 14, 0, 0);
      const buffer = generateBRPFile({ startDate });
      const edf = parser.parse(buffer);
      expect(edf.header.startDate.getFullYear()).toBe(1980);
    });

    it('should treat year 99 as 1999', () => {
      const startDate = new Date(1999, 11, 31, 23, 59, 0);
      const buffer = generateBRPFile({ startDate });
      const edf = parser.parse(buffer);
      expect(edf.header.startDate.getFullYear()).toBe(1999);
    });
  });

  // -----------------------------------------------------------------------
  // Header validation
  // -----------------------------------------------------------------------

  describe('header validation', () => {
    it('should reject buffer shorter than 256 bytes', () => {
      const buffer = new ArrayBuffer(100);
      expect(() => parser.parse(buffer)).toThrow(EDFParseError);
    });

    it('should reject invalid EDF version', () => {
      const buffer = generateEDFFile({
        version: '1',
        signals: [
          {
            label: 'Test',
            physicalDimension: 'u',
            physicalMin: 0,
            physicalMax: 100,
            samplesPerRecord: 1,
          },
        ],
      });
      expect(() => parser.parse(buffer)).toThrow(EDFParseError);
    });

    it('should validate header via validate method', () => {
      const buffer = generateBRPFile();
      const result = parser.validate(buffer);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should report invalid version in validate', () => {
      const buffer = new ArrayBuffer(256);
      const view = new Uint8Array(buffer);
      // Write "1" at version field (offset 0)
      view[0] = 0x31; // '1'
      const result = parser.validate(buffer);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_VERSION')).toBe(true);
    });

    it('should report too-short buffer in validate', () => {
      const buffer = new ArrayBuffer(100);
      const result = parser.validate(buffer);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'HEADER_TOO_SHORT')).toBe(true);
    });

    // Security regression (memory-exhaustion DoS): a tiny file whose header
    // declares an implausibly large per-record duration must be rejected, not
    // used to derive an astronomical recording duration downstream.
    it('should reject an implausibly large data record duration', () => {
      const buffer = generateEDFFile({
        dataRecordDuration: 100000, // 1e5 s/record — far above the 60 s ceiling
        numDataRecords: 1,
        signals: [
          {
            label: 'Flow',
            physicalDimension: 'L/min',
            physicalMin: -60,
            physicalMax: 60,
            samplesPerRecord: 1,
          },
        ],
      });
      // Buffer is tiny (one 1-sample record) yet would imply a 1e5 s recording.
      expect(buffer.byteLength).toBeLessThan(1024);
      let thrown: unknown;
      try {
        parser.parse(buffer);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(EDFParseError);
      expect((thrown as EDFParseError).code).toBe('INVALID_RECORD_DURATION');
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle a single signal file', () => {
      const buffer = generateEDFFile({
        numDataRecords: 5,
        signals: [
          {
            label: 'Mono',
            physicalDimension: 'uV',
            physicalMin: -500,
            physicalMax: 500,
            samplesPerRecord: 10,
            generator: constantGenerator(0),
          },
        ],
      });

      const edf = parser.parse(buffer);
      expect(edf.signals).toHaveLength(1);
      const sig0 = edf.signals[0];
      if (!sig0) throw new Error('expected signal at index 0');
      expect(sig0.samples.length).toBe(50);
    });

    it('should handle numDataRecords = 0', () => {
      const buffer = generateEDFFile({
        numDataRecords: 0,
        signals: [
          {
            label: 'Empty',
            physicalDimension: 'u',
            physicalMin: 0,
            physicalMax: 1,
            samplesPerRecord: 1,
          },
        ],
      });

      const edf = parser.parse(buffer);
      const sig0 = edf.signals[0];
      if (!sig0) throw new Error('expected signal at index 0');
      expect(sig0.samples.length).toBe(0);
    });

    it('should handle maximum-length label (16 chars)', () => {
      const buffer = generateEDFFile({
        numDataRecords: 1,
        signals: [
          {
            label: 'ABCDEFGHIJKLMNOP', // 16 chars
            physicalDimension: 'u',
            physicalMin: 0,
            physicalMax: 1,
            samplesPerRecord: 1,
          },
        ],
      });

      const edf = parser.parse(buffer);
      const sig0 = edf.signals[0];
      if (!sig0) throw new Error('expected signal at index 0');
      expect(sig0.label).toBe('ABCDEFGHIJKLMNOP');
    });

    it('should throw on truncated data records', () => {
      const fullBuffer = generateBRPFile({ numDataRecords: 10 });
      // Truncate the buffer to remove some data records
      const truncated = fullBuffer.slice(0, fullBuffer.byteLength - 200);
      expect(() => parser.parse(truncated)).toThrow(EDFParseError);
    });
  });
});
