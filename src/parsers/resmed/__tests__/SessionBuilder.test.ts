import { describe, it, expect } from 'vitest';
import { SessionBuilder } from '@/parsers/resmed/SessionBuilder';
import { ResMedInterpreter } from '@/parsers/resmed/ResMedInterpreter';
import { EDFParser } from '@/parsers/edf/EDFParser';
import { generateBRPFile, generateEVEFile, generateSADFile } from '@/test/generators/edf-generator';
import type { ResMedInterpretation } from '@/parsers/resmed/ResMedInterpreter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function interpretFile(buffer: ArrayBuffer): ResMedInterpretation {
  const parser = new EDFParser();
  const interpreter = new ResMedInterpreter();
  const edf = parser.parse(buffer);
  return interpreter.interpret(edf);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionBuilder', () => {
  const builder = new SessionBuilder();

  // -----------------------------------------------------------------------
  // Single file session
  // -----------------------------------------------------------------------

  describe('single file session', () => {
    it('should build a session from a single BRP file', () => {
      const brp = interpretFile(generateBRPFile({ numDataRecords: 60 }));
      const results = builder.buildSessions([brp]);

      expect(results).toHaveLength(1);
      const first = results[0];
      if (!first) throw new Error('expected first result');
      const { session, aggregate } = first;
      expect(session.date).toBe('2026-01-15');
      expect(session.machineId).toBe('12345678');
      expect(session.machineType).toBe('apap');
      expect(aggregate.sessionId).toBe(session.id);
    });
  });

  // -----------------------------------------------------------------------
  // Multi-file merge
  // -----------------------------------------------------------------------

  describe('multi-file merge', () => {
    it('should merge BRP + EVE + SAD into a single session', () => {
      const startDate = new Date(2026, 0, 15, 22, 30, 0);
      const patientId = '12345678 AirSense 10 AutoSet';

      const brp = interpretFile(generateBRPFile({ patientId, startDate, numDataRecords: 120 }));
      const eve = interpretFile(
        generateEVEFile(
          [
            { onset: 10, duration: 15, label: 'Obstructive Apnea' },
            { onset: 40, duration: 12, label: 'Hypopnea' },
          ],
          { patientId, startDate, numDataRecords: 120 },
        ),
      );
      const sad = interpretFile(generateSADFile({ patientId, startDate, numDataRecords: 120 }));

      const results = builder.buildSessions([brp, eve, sad]);
      expect(results).toHaveLength(1);

      const first = results[0];
      if (!first) throw new Error('expected first result');
      const { session } = first;
      expect(session.channels.length).toBeGreaterThanOrEqual(3); // flow, maskPressure, leak from BRP
    });
  });

  // -----------------------------------------------------------------------
  // Session boundary detection
  // -----------------------------------------------------------------------

  describe('session boundary detection', () => {
    it('should group files <30 min apart into the same session', () => {
      const t1 = new Date(2026, 0, 15, 22, 30, 0);
      // 10 minutes later (well within 30 min threshold)
      const t2 = new Date(2026, 0, 15, 22, 40, 0);

      const f1 = interpretFile(generateBRPFile({ startDate: t1, numDataRecords: 60 }));
      const f2 = interpretFile(generateSADFile({ startDate: t2, numDataRecords: 60 }));

      const results = builder.buildSessions([f1, f2]);
      expect(results).toHaveLength(1);
    });

    it('should split files >30 min apart into separate sessions', () => {
      const t1 = new Date(2026, 0, 15, 22, 0, 0);
      // 2 hours later — well beyond 30 min
      const t2 = new Date(2026, 0, 16, 0, 0, 0);

      const f1 = interpretFile(generateBRPFile({ startDate: t1, numDataRecords: 60 }));
      const f2 = interpretFile(generateBRPFile({ startDate: t2, numDataRecords: 60 }));

      const results = builder.buildSessions([f1, f2]);
      expect(results).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Usage time computation
  // -----------------------------------------------------------------------

  describe('usage time computation', () => {
    it('should count samples where mask pressure > 2 cmH₂O', () => {
      // BRP with constant mask pressure of 10 cmH₂O for 60 seconds
      const brp = interpretFile(generateBRPFile({ numDataRecords: 60 }));
      const results = builder.buildSessions([brp]);
      const first = results[0];
      if (!first) throw new Error('expected first result');
      const session = first.session;

      // All pressure samples are at 10 cmH₂O (>2), so usage ≈ recording duration
      expect(session.usageMinutes).toBeGreaterThan(0);
      // 60 records * 1s each = 60s total signal, all above threshold
      expect(session.usageMinutes).toBeCloseTo(1, 0);
    });
  });

  // -----------------------------------------------------------------------
  // AHI computation
  // -----------------------------------------------------------------------

  describe('AHI computation', () => {
    it('should compute correct AHI from events and usage time', () => {
      const startDate = new Date(2026, 0, 15, 22, 0, 0);
      // 3600 seconds = 1 hour of data
      const brp = interpretFile(generateBRPFile({ startDate, numDataRecords: 3600 }));
      const eve = interpretFile(
        generateEVEFile(
          [
            { onset: 100, duration: 15, label: 'Obstructive Apnea' },
            { onset: 200, duration: 12, label: 'Hypopnea' },
            { onset: 300, duration: 20, label: 'Central Apnea' },
            { onset: 400, duration: 10, label: 'Obstructive Apnea' },
            { onset: 500, duration: 15, label: 'Hypopnea' },
          ],
          { startDate, numDataRecords: 3600 },
        ),
      );

      const results = builder.buildSessions([brp, eve]);
      expect(results).toHaveLength(1);

      const first = results[0];
      if (!first) throw new Error('expected first result');
      const { aggregate } = first;
      // 5 AHI-counted events / 1 hour ≈ 5
      expect(aggregate.ahi).toBeCloseTo(5, 0);
    });

    it('should return AHI = 0 with empty events list', () => {
      const brp = interpretFile(generateBRPFile({ numDataRecords: 3600 }));
      const results = builder.buildSessions([brp]);
      const first = results[0];
      if (!first) throw new Error('expected first result');
      expect(first.aggregate.ahi).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Compliance check
  // -----------------------------------------------------------------------

  describe('compliance check', () => {
    it('should flag ≥4 hours usage as compliant', () => {
      // 5 hours = 18000 seconds
      const brp = interpretFile(generateBRPFile({ numDataRecords: 18000 }));
      const results = builder.buildSessions([brp]);
      const first = results[0];
      if (!first) throw new Error('expected first result');
      expect(first.aggregate.complianceStatus).toBe('compliant');
    });

    it('should flag <4 hours usage as non-compliant', () => {
      // 60 seconds — far below 4 hours
      const brp = interpretFile(generateBRPFile({ numDataRecords: 60 }));
      const results = builder.buildSessions([brp]);
      const first = results[0];
      if (!first) throw new Error('expected first result');
      expect(first.aggregate.complianceStatus).toBe('non-compliant');
    });
  });

  // -----------------------------------------------------------------------
  // Channel merging
  // -----------------------------------------------------------------------

  describe('channel merging', () => {
    it('should prefer higher sample rate for duplicate channels', () => {
      const startDate = new Date(2026, 0, 15, 22, 30, 0);
      // First file: flow at 25 Hz
      const f1 = interpretFile(
        generateBRPFile({ startDate, numDataRecords: 60, flowSampleRate: 25 }),
      );
      // Second file: flow at 50 Hz — same start time so they merge
      // We simulate this by creating another BRP at a nearby time
      const f2 = interpretFile(
        generateBRPFile({
          startDate: new Date(startDate.getTime() + 10_000), // 10s later
          numDataRecords: 60,
          flowSampleRate: 50,
        }),
      );

      const results = builder.buildSessions([f1, f2]);
      const first = results[0];
      if (!first) throw new Error('expected first result');
      const flowChannel = first.session.channels.find((c) => c.name === 'flow');
      if (!flowChannel) throw new Error('expected flow channel');
      // The higher sample rate (50) should win
      expect(flowChannel.sampleRate).toBe(50);
    });
  });

  // -----------------------------------------------------------------------
  // Date formatting
  // -----------------------------------------------------------------------

  describe('date formatting', () => {
    it('should format session date as YYYY-MM-DD', () => {
      const brp = interpretFile(generateBRPFile({ startDate: new Date(2026, 0, 15, 22, 30, 0) }));
      const results = builder.buildSessions([brp]);
      const first = results[0];
      if (!first) throw new Error('expected first result');
      expect(first.session.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(first.session.date).toBe('2026-01-15');
    });
  });

  // -----------------------------------------------------------------------
  // Empty input
  // -----------------------------------------------------------------------

  describe('empty input', () => {
    it('should return empty array for no interpretations', () => {
      const results = builder.buildSessions([]);
      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Boundary detection utility
  // -----------------------------------------------------------------------

  describe('detectSessionBoundaries', () => {
    it('should return empty for empty input', () => {
      const groups = builder.detectSessionBoundaries([]);
      expect(groups).toEqual([]);
    });

    it('should put a single interpretation in one group', () => {
      const brp = interpretFile(generateBRPFile());
      const groups = builder.detectSessionBoundaries([brp]);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(1);
    });
  });
});
