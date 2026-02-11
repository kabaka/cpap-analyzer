import { describe, it, expect } from 'vitest';
import { Validator } from '@/parsers/validation/Validator';
import { EDFParser } from '@/parsers/edf/EDFParser';
import { ResMedInterpreter } from '@/parsers/resmed/ResMedInterpreter';
import { SessionBuilder } from '@/parsers/resmed/SessionBuilder';
import { generateBRPFile, generateEVEFile } from '@/test/generators/edf-generator';
import type { BuildResult } from '@/parsers/resmed/SessionBuilder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSession(options?: {
  numDataRecords?: number;
  events?: Array<{ onset: number; duration: number; label: string }>;
}): BuildResult {
  const parser = new EDFParser();
  const interpreter = new ResMedInterpreter();
  const sessionBuilder = new SessionBuilder();

  const startDate = new Date(2026, 0, 15, 22, 0, 0);
  const numRecords = options?.numDataRecords ?? 3600;
  const patientId = '12345678 AirSense 10 AutoSet';

  const brp = interpreter.interpret(
    parser.parse(generateBRPFile({ patientId, startDate, numDataRecords: numRecords })),
  );

  const interpretations = [brp];

  if (options?.events && options.events.length > 0) {
    const eve = interpreter.interpret(
      parser.parse(
        generateEVEFile(options.events, { patientId, startDate, numDataRecords: numRecords }),
      ),
    );
    interpretations.push(eve);
  }

  const results = sessionBuilder.buildSessions(interpretations);
  const first = results[0];
  if (!first) throw new Error('expected at least one build result');
  return first;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Validator', () => {
  const validator = new Validator();

  // -----------------------------------------------------------------------
  // EDF validation
  // -----------------------------------------------------------------------

  describe('validateEDF', () => {
    it('should pass a valid EDF file', () => {
      const parser = new EDFParser();
      const edf = parser.parse(generateBRPFile());
      const result = validator.validateEDF(edf);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should flag mismatched signal count', () => {
      const parser = new EDFParser();
      const edf = parser.parse(generateBRPFile());
      // Tamper with signals array to create mismatch
      const tampered = {
        ...edf,
        signals: edf.signals.slice(0, 1),
      };
      const result = validator.validateEDF(tampered);
      expect(result.errors.some((e) => e.code === 'SIGNAL_COUNT_MISMATCH')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Session validation — valid session passes
  // -----------------------------------------------------------------------

  describe('validateSession', () => {
    it('should pass a valid session', () => {
      const build = buildSession();
      const result = validator.validateSession(build);
      expect(result.isValid).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Physiological range validation
  // -----------------------------------------------------------------------

  describe('signal data validation', () => {
    it('should flag out-of-range flow values', () => {
      // Flow expected range: [-300, 300]
      const samples = new Float32Array([0, 50, -50, 301, -301]);
      const result = validator.validateSignalData('flow', samples);
      expect(result.warnings.some((w) => w.code === 'OUT_OF_RANGE')).toBe(true);
    });

    it('should flag out-of-range pressure values', () => {
      // maskPressure expected range: [0, 30]
      const samples = new Float32Array([10, 15, 31, -1]);
      const result = validator.validateSignalData('maskPressure', samples);
      expect(result.warnings.some((w) => w.code === 'OUT_OF_RANGE')).toBe(true);
    });

    it('should flag out-of-range SpO2 values', () => {
      // spo2 expected range: [50, 100]
      const samples = new Float32Array([96, 95, 49, 101]);
      const result = validator.validateSignalData('spo2', samples);
      expect(result.warnings.some((w) => w.code === 'OUT_OF_RANGE')).toBe(true);
    });

    it('should pass all-in-range flow values', () => {
      const samples = new Float32Array([0, 100, -100, 299, -299]);
      const result = validator.validateSignalData('flow', samples);
      expect(result.warnings).toHaveLength(0);
    });

    it('should pass unknown channel names without flagging', () => {
      const samples = new Float32Array([999, -999]);
      const result = validator.validateSignalData('unknownChannel', samples);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Short apnea events
  // -----------------------------------------------------------------------

  describe('short apnea events', () => {
    it('should flag apnea events shorter than 10s', () => {
      const build = buildSession({
        numDataRecords: 3600,
        events: [
          { onset: 100, duration: 5, label: 'Obstructive Apnea' }, // too short
          { onset: 200, duration: 15, label: 'Obstructive Apnea' }, // ok
        ],
      });

      const result = validator.validateSession(build);
      const shortWarnings = result.warnings.filter((w) => w.code === 'SHORT_APNEA');
      expect(shortWarnings.length).toBeGreaterThanOrEqual(1);
    });

    it('should not flag hypopnea events for short duration', () => {
      const build = buildSession({
        numDataRecords: 3600,
        events: [
          { onset: 100, duration: 5, label: 'Hypopnea' }, // not an apnea type
        ],
      });

      const result = validator.validateSession(build);
      const shortWarnings = result.warnings.filter((w) => w.code === 'SHORT_APNEA');
      expect(shortWarnings).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // High AHI
  // -----------------------------------------------------------------------

  describe('high AHI', () => {
    it('should flag AHI > 200', () => {
      const build = buildSession({ numDataRecords: 3600 });
      // Tamper aggregate to simulate impossibly high AHI
      const tamperedBuild: BuildResult = {
        ...build,
        aggregate: { ...build.aggregate, ahi: 250 },
      };

      const result = validator.validateSession(tamperedBuild);
      expect(result.warnings.some((w) => w.code === 'HIGH_AHI')).toBe(true);
    });

    it('should not flag AHI ≤ 200', () => {
      const build = buildSession({ numDataRecords: 3600 });
      // The default build has low AHI
      const result = validator.validateSession(build);
      expect(result.warnings.some((w) => w.code === 'HIGH_AHI')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Short session
  // -----------------------------------------------------------------------

  describe('short session', () => {
    it('should flag sessions shorter than 30 minutes', () => {
      // 60 seconds — way below 30 min
      const build = buildSession({ numDataRecords: 60 });
      const result = validator.validateSession(build);
      expect(result.warnings.some((w) => w.code === 'SHORT_SESSION')).toBe(true);
    });

    it('should not flag sessions ≥ 30 minutes', () => {
      // 3600 seconds = 1 hour
      const build = buildSession({ numDataRecords: 3600 });
      const result = validator.validateSession(build);
      expect(result.warnings.some((w) => w.code === 'SHORT_SESSION')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple warnings combined
  // -----------------------------------------------------------------------

  describe('multiple warnings combined', () => {
    it('should include multiple warnings in a single result', () => {
      // Short session + tampered high AHI
      const build = buildSession({ numDataRecords: 60 });
      const tamperedBuild: BuildResult = {
        ...build,
        aggregate: { ...build.aggregate, ahi: 300 },
      };

      const result = validator.validateSession(tamperedBuild);
      const codes = result.warnings.map((w) => w.code);
      expect(codes).toContain('SHORT_SESSION');
      expect(codes).toContain('HIGH_AHI');
    });

    it('should set isValid = true even with warnings', () => {
      const build = buildSession({ numDataRecords: 60 }); // short session
      const result = validator.validateSession(build);
      // Warnings don't affect isValid — only hard errors do
      expect(result.isValid).toBe(true);
    });
  });
});
