import { describe, it, expect } from 'vitest';
import { EDFParser } from '@/parsers/edf/EDFParser';
import {
  generateEDFFile,
  generateBRPFile,
  generateEVEFile,
  generateSADFile,
  sineWaveGenerator,
  constantGenerator,
  rampGenerator,
} from '@/test/generators/edf-generator';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('edf-generator', () => {
  const parser = new EDFParser();

  // -----------------------------------------------------------------------
  // Round-trip
  // -----------------------------------------------------------------------

  describe('round-trip through EDFParser', () => {
    it('should generate a valid EDF that round-trips through the parser', () => {
      const buffer = generateEDFFile({
        numDataRecords: 30,
        signals: [
          {
            label: 'TestSignal',
            physicalDimension: 'mV',
            physicalMin: -500,
            physicalMax: 500,
            samplesPerRecord: 10,
            generator: constantGenerator(100),
          },
        ],
      });

      const edf = parser.parse(buffer);
      expect(edf.header.version).toBe('0');
      expect(edf.header.numSignals).toBe(1);
      expect(edf.header.numDataRecords).toBe(30);
      expect(edf.signals).toHaveLength(1);
      const sig0 = edf.signals[0];
      if (!sig0) throw new Error('expected signal at index 0');
      expect(sig0.label).toBe('TestSignal');
      expect(sig0.samples.length).toBe(300); // 10 * 30
    });

    it('should generate multi-signal EDF that round-trips', () => {
      const buffer = generateEDFFile({
        numDataRecords: 10,
        signals: [
          {
            label: 'Chan1',
            physicalDimension: 'u',
            physicalMin: 0,
            physicalMax: 100,
            samplesPerRecord: 5,
            generator: constantGenerator(50),
          },
          {
            label: 'Chan2',
            physicalDimension: 'u',
            physicalMin: -10,
            physicalMax: 10,
            samplesPerRecord: 20,
            generator: constantGenerator(0),
          },
        ],
      });

      const edf = parser.parse(buffer);
      expect(edf.signals).toHaveLength(2);
      const [sig0, sig1] = edf.signals;
      if (!sig0 || !sig1) throw new Error('expected 2 signals');
      expect(sig0.samples.length).toBe(50); // 5 * 10
      expect(sig1.samples.length).toBe(200); // 20 * 10
    });
  });

  // -----------------------------------------------------------------------
  // BRP file
  // -----------------------------------------------------------------------

  describe('generateBRPFile', () => {
    it('should have Flow, MaskPressure, and Leak channels', () => {
      const buffer = generateBRPFile();
      const edf = parser.parse(buffer);
      const labels = edf.signals.map((s) => s.label);
      expect(labels).toContain('Flow');
      expect(labels).toContain('MaskPressure');
      expect(labels).toContain('Leak');
    });

    it('should have correct default sample rates', () => {
      const buffer = generateBRPFile();
      const edf = parser.parse(buffer);
      const flow = edf.signals.find((s) => s.label === 'Flow');
      const pressure = edf.signals.find((s) => s.label === 'MaskPressure');
      const leak = edf.signals.find((s) => s.label === 'Leak');
      if (!flow || !pressure || !leak)
        throw new Error('expected Flow, MaskPressure, and Leak signals');
      expect(flow.sampleRate).toBe(25);
      expect(pressure.sampleRate).toBe(25);
      expect(leak.sampleRate).toBe(2);
    });

    it('should use custom patient ID', () => {
      const buffer = generateBRPFile({ patientId: 'CUSTOM_UNIT_TEST' });
      const edf = parser.parse(buffer);
      expect(edf.header.patientId).toBe('CUSTOM_UNIT_TEST');
    });
  });

  // -----------------------------------------------------------------------
  // EVE file
  // -----------------------------------------------------------------------

  describe('generateEVEFile', () => {
    it('should have annotations at correct timestamps', () => {
      const buffer = generateEVEFile([
        { onset: 5, duration: 10, label: 'Event A' },
        { onset: 20, duration: 0, label: 'Event B' },
      ]);

      const edf = parser.parse(buffer);
      const annotations = edf.annotations;
      if (!annotations) throw new Error('expected annotations');

      const eventA = annotations.find((a) => a.labels.some((l) => l === 'Event A'));
      if (!eventA) throw new Error('expected Event A annotation');
      expect(eventA.onset).toBeCloseTo(5, 0);
      expect(eventA.duration).toBe(10);

      const eventB = annotations.find((a) => a.labels.some((l) => l === 'Event B'));
      if (!eventB) throw new Error('expected Event B annotation');
      expect(eventB.onset).toBeCloseTo(20, 0);
    });

    it('should set reserved field to EDF+C', () => {
      const buffer = generateEVEFile([{ onset: 1, duration: 5, label: 'Test' }]);
      const edf = parser.parse(buffer);
      expect(edf.header.reserved).toBe('EDF+C');
    });
  });

  // -----------------------------------------------------------------------
  // SAD file
  // -----------------------------------------------------------------------

  describe('generateSADFile', () => {
    it('should have SpO2 and Pulse channels', () => {
      const buffer = generateSADFile();
      const edf = parser.parse(buffer);
      const labels = edf.signals.map((s) => s.label);
      expect(labels).toContain('SpO2');
      expect(labels).toContain('Pulse');
    });

    it('should use custom base SpO2 value', () => {
      const buffer = generateSADFile({ baseSpO2: 98 });
      const edf = parser.parse(buffer);
      const spo2 = edf.signals.find((s) => s.label === 'SpO2');
      if (!spo2) throw new Error('expected SpO2 signal');
      // All values should be close to 98
      for (let i = 0; i < spo2.samples.length; i++) {
        expect(spo2.samples[i]).toBeCloseTo(98, 0);
      }
    });

    it('should use custom base pulse value', () => {
      const buffer = generateSADFile({ basePulse: 80 });
      const edf = parser.parse(buffer);
      const pulse = edf.signals.find((s) => s.label === 'Pulse');
      if (!pulse) throw new Error('expected Pulse signal');
      for (let i = 0; i < pulse.samples.length; i++) {
        expect(pulse.samples[i]).toBeCloseTo(80, 0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Signal value generators
  // -----------------------------------------------------------------------

  describe('signal value generators', () => {
    it('should produce sine wave values between min and max', () => {
      const total = 100;
      for (let i = 0; i < total; i++) {
        const val = sineWaveGenerator(i, total, -10, 10);
        expect(val).toBeGreaterThanOrEqual(-10);
        expect(val).toBeLessThanOrEqual(10);
      }
    });

    it('should produce constant values', () => {
      const gen = constantGenerator(42);
      expect(gen(0, 100)).toBe(42);
      expect(gen(50, 100)).toBe(42);
      expect(gen(99, 100)).toBe(42);
    });

    it('should produce ramp values from start to end', () => {
      const gen = rampGenerator(0, 100);
      expect(gen(0, 101)).toBe(0);
      expect(gen(50, 101)).toBeCloseTo(50, 5);
      expect(gen(100, 101)).toBeCloseTo(100, 5);
    });

    it('should handle ramp with single sample', () => {
      const gen = rampGenerator(5, 10);
      expect(gen(0, 1)).toBe(5);
    });
  });
});
