/**
 * Fixture-based parsing tests for Phase 4 synthetic EDF files.
 *
 * Loads pre-generated binary EDF fixtures from `tests/fixtures/edf/`
 * and validates parsing, interpretation, and session building against
 * the expected values in the fixture manifest.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { EDFParser } from '@/parsers/edf/EDFParser';
import { EDFParseError } from '@/parsers/edf/errors';
import { ResMedInterpreter } from '@/parsers/resmed/ResMedInterpreter';
import { SessionBuilder } from '@/parsers/resmed/SessionBuilder';
import type { ResMedInterpretation } from '@/parsers/resmed/ResMedInterpreter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.resolve(__dirname, '../../../tests/fixtures/edf');

function loadFixture(name: string): ArrayBuffer {
  const filepath = path.join(FIXTURE_DIR, name);
  const buf = fs.readFileSync(filepath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function parseAndInterpret(name: string): ResMedInterpretation {
  const buffer = loadFixture(name);
  const parser = new EDFParser();
  const interpreter = new ResMedInterpreter();
  const edf = parser.parse(buffer);
  return interpreter.interpret(edf);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Fixture parsing', () => {
  const parser = new EDFParser();

  // -----------------------------------------------------------------------
  // BRP AirSense 11
  // -----------------------------------------------------------------------

  describe('brp-airsense11.edf', () => {
    it('should parse without errors', () => {
      const buffer = loadFixture('brp-airsense11.edf');
      expect(() => parser.parse(buffer)).not.toThrow();
    });

    it('should have correct header fields', () => {
      const edf = parser.parse(loadFixture('brp-airsense11.edf'));
      expect(edf.header.numSignals).toBe(3);
      expect(edf.header.numDataRecords).toBe(60);
      expect(edf.header.dataRecordDuration).toBe(1);
    });

    it('should have correct signal labels', () => {
      const edf = parser.parse(loadFixture('brp-airsense11.edf'));
      const labels = edf.signals.map((s) => s.label);
      expect(labels).toEqual(['Flow.40ms', 'Press.40ms', 'Crc16']);
    });

    it('should map 2 channels (flow, pressure) and skip Crc16', () => {
      const result = parseAndInterpret('brp-airsense11.edf');
      const channelNames = result.channels.map((c) => c.name);
      expect(channelNames).toHaveLength(2);
      expect(channelNames).toContain('flow');
      expect(channelNames).toContain('pressure');
    });

    it('should report Crc16 as unknown (not mapped to a channel)', () => {
      const result = parseAndInterpret('brp-airsense11.edf');
      // Crc16 is skipped by normalizeChannelLabel (returns null),
      // but the interpreter still collects it in unknownLabels.
      expect(result.unknownLabels).toContain('Crc16');
    });

    it('should extract correct machine info from recordingId', () => {
      const result = parseAndInterpret('brp-airsense11.edf');
      expect(result.machineInfo.serialNumber).toBe('23241654214');
      expect(result.machineInfo.series).toBe('AirSense 11');
    });

    it('should have correct total samples per signal', () => {
      const edf = parser.parse(loadFixture('brp-airsense11.edf'));
      // 60 records × 25 samples/record = 1500
      for (const sig of edf.signals) {
        expect(sig.samples.length).toBe(1500);
      }
    });
  });

  // -----------------------------------------------------------------------
  // PLD AirSense 11
  // -----------------------------------------------------------------------

  describe('pld-airsense11.edf', () => {
    it('should parse without errors', () => {
      const buffer = loadFixture('pld-airsense11.edf');
      expect(() => parser.parse(buffer)).not.toThrow();
    });

    it('should have 11 signals', () => {
      const edf = parser.parse(loadFixture('pld-airsense11.edf'));
      expect(edf.header.numSignals).toBe(11);
    });

    it('should have correct signal labels', () => {
      const edf = parser.parse(loadFixture('pld-airsense11.edf'));
      const labels = edf.signals.map((s) => s.label);
      expect(labels).toEqual([
        'MaskPress.2s',
        'Press.2s',
        'EprPress.2s',
        'Leak.2s',
        'RespRate.2s',
        'TidVol.2s',
        'MinVent.2s',
        'Snore.2s',
        'FlowLim.2s',
        'Crc16',
        'Crc16',
      ]);
    });

    it('should map all labels except Crc16', () => {
      const result = parseAndInterpret('pld-airsense11.edf');
      const channelNames = result.channels.map((c) => c.name);
      expect(channelNames).toContain('maskPressure');
      expect(channelNames).toContain('pressure');
      expect(channelNames).toContain('eprPressure');
      expect(channelNames).toContain('leak');
      expect(channelNames).toContain('respRate');
      expect(channelNames).toContain('tidalVolume');
      expect(channelNames).toContain('minuteVent');
      expect(channelNames).toContain('snore');
      expect(channelNames).toContain('flowLimitation');
      // 9 mapped channels (Crc16 ×2 skipped)
      expect(channelNames).toHaveLength(9);
    });

    it('should only report Crc16 signals as unknown labels', () => {
      const result = parseAndInterpret('pld-airsense11.edf');
      // PLD has 2 Crc16 signals that aren't mapped to channels
      expect(result.unknownLabels).toEqual(['Crc16', 'Crc16']);
    });
  });

  // -----------------------------------------------------------------------
  // EVE AirSense 11
  // -----------------------------------------------------------------------

  describe('eve-airsense11.edf', () => {
    it('should parse without errors (dataRecordDuration=0 allowed)', () => {
      const buffer = loadFixture('eve-airsense11.edf');
      expect(() => parser.parse(buffer)).not.toThrow();
    });

    it('should extract 4 therapy events (Recording starts and Arousal filtered)', () => {
      const result = parseAndInterpret('eve-airsense11.edf');
      expect(result.events).toHaveLength(4);
    });

    it('should map event types correctly', () => {
      const result = parseAndInterpret('eve-airsense11.edf');
      const types = result.events.map((e) => e.type);
      // The bare "Apnea" annotation maps to UnclassifiedApnea (an apnea the
      // device could not resolve as obstructive or central), not MixedApnea.
      expect(types).toEqual(['ObstructiveApnea', 'CentralApnea', 'Hypopnea', 'UnclassifiedApnea']);
    });

    it('should have correct event durations', () => {
      const result = parseAndInterpret('eve-airsense11.edf');
      const durations = result.events.map((e) => e.duration);
      expect(durations).toEqual([15, 12, 11, 14]);
    });

    it('should have correct event onsets', () => {
      const result = parseAndInterpret('eve-airsense11.edf');
      const onsets = result.events.map((e) => e.onset);
      expect(onsets).toEqual([120, 300, 500, 800]);
    });

    it('should report Arousal as unknown event', () => {
      const result = parseAndInterpret('eve-airsense11.edf');
      expect(result.unknownEvents).toHaveLength(1);
      expect(result.unknownEvents).toContain('Arousal');
    });
  });

  // -----------------------------------------------------------------------
  // SAD AirSense 11
  // -----------------------------------------------------------------------

  describe('sad-airsense11.edf', () => {
    it('should parse without errors', () => {
      const buffer = loadFixture('sad-airsense11.edf');
      expect(() => parser.parse(buffer)).not.toThrow();
    });

    it('should map SpO2 and Pulse channels', () => {
      const result = parseAndInterpret('sad-airsense11.edf');
      const channelNames = result.channels.map((c) => c.name);
      expect(channelNames).toContain('spo2');
      expect(channelNames).toContain('pulse');
    });

    it('should detect all-zero sentinel values in SpO2 via SessionBuilder', () => {
      const result = parseAndInterpret('sad-airsense11.edf');
      const builder = new SessionBuilder();
      const sessions = builder.buildSessions([result]);

      expect(sessions).toHaveLength(1);
      const aggregate = sessions[0]!.aggregate;
      // All-zero SpO2 should yield null spo2 stats
      expect(aggregate.spo2Mean).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Empty EVE (0-byte file)
  // -----------------------------------------------------------------------

  describe('eve-empty.edf', () => {
    it('should throw HEADER_TOO_SHORT for 0-byte file', () => {
      const buffer = loadFixture('eve-empty.edf');
      expect(() => parser.parse(buffer)).toThrow(EDFParseError);
    });

    it('should have the correct error code', () => {
      const buffer = loadFixture('eve-empty.edf');
      try {
        parser.parse(buffer);
        expect.fail('Expected EDFParseError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(EDFParseError);
        expect((err as EDFParseError).code).toBe('HEADER_TOO_SHORT');
      }
    });
  });

  // -----------------------------------------------------------------------
  // BRP with unknown records (numDataRecords = -1)
  // -----------------------------------------------------------------------

  describe('brp-unknown-records.edf', () => {
    it('should parse despite numDataRecords=-1 in header', () => {
      const buffer = loadFixture('brp-unknown-records.edf');
      expect(() => parser.parse(buffer)).not.toThrow();
    });

    it('should infer correct record count from file size', () => {
      const edf = parser.parse(loadFixture('brp-unknown-records.edf'));
      // Same binary data as brp-airsense11.edf → 60 records
      expect(edf.header.numDataRecords).toBe(60);
    });

    it('should produce valid signal data', () => {
      const edf = parser.parse(loadFixture('brp-unknown-records.edf'));
      for (const sig of edf.signals) {
        expect(sig.samples.length).toBe(1500);
        // Verify no NaN values
        for (let i = 0; i < sig.samples.length; i++) {
          expect(isNaN(sig.samples[i]!)).toBe(false);
        }
      }
    });

    it('should interpret the same as the standard BRP fixture', () => {
      const standardResult = parseAndInterpret('brp-airsense11.edf');
      const unknownResult = parseAndInterpret('brp-unknown-records.edf');

      expect(unknownResult.channels.length).toBe(standardResult.channels.length);
      expect(unknownResult.machineInfo.serialNumber).toBe(standardResult.machineInfo.serialNumber);
    });
  });

  // -----------------------------------------------------------------------
  // Combined session building (BRP + PLD + EVE + SAD)
  // -----------------------------------------------------------------------

  describe('session building from combined fixtures', () => {
    it('should build a single session from all four fixture types', () => {
      const brp = parseAndInterpret('brp-airsense11.edf');
      const pld = parseAndInterpret('pld-airsense11.edf');
      const eve = parseAndInterpret('eve-airsense11.edf');
      const sad = parseAndInterpret('sad-airsense11.edf');

      const builder = new SessionBuilder();
      const results = builder.buildSessions([brp, pld, eve, sad]);

      expect(results).toHaveLength(1);
    });

    it('should include channels from BRP and PLD', () => {
      const brp = parseAndInterpret('brp-airsense11.edf');
      const pld = parseAndInterpret('pld-airsense11.edf');
      const eve = parseAndInterpret('eve-airsense11.edf');
      const sad = parseAndInterpret('sad-airsense11.edf');

      const builder = new SessionBuilder();
      const results = builder.buildSessions([brp, pld, eve, sad]);
      const session = results[0]!.session;

      const channelNames = session.channels.map((c) => c.name);
      expect(channelNames).toContain('flow');
      expect(channelNames).toContain('pressure');
      expect(channelNames).toContain('maskPressure');
      expect(channelNames).toContain('leak');
      expect(channelNames).toContain('spo2');
      expect(channelNames).toContain('pulse');
    });

    it('should include all therapy events from the EVE file', () => {
      const brp = parseAndInterpret('brp-airsense11.edf');
      const pld = parseAndInterpret('pld-airsense11.edf');
      const eve = parseAndInterpret('eve-airsense11.edf');
      const sad = parseAndInterpret('sad-airsense11.edf');

      const builder = new SessionBuilder();
      const results = builder.buildSessions([brp, pld, eve, sad]);
      const events = results[0]!.events;

      expect(events).toHaveLength(4);
      const types = events.map((e) => e.type);
      expect(types).toContain('ObstructiveApnea');
      expect(types).toContain('CentralApnea');
      expect(types).toContain('Hypopnea');
      // The EVE fixture's bare "Apnea" annotation (no obstructive/central
      // qualifier) is an unclassified apnea — not a mixed apnea, which AASM
      // defines specifically as central onset followed by obstructive effort.
      expect(types).toContain('UnclassifiedApnea');
      expect(types).not.toContain('MixedApnea');
    });

    it('should compute AHI correctly from known events', () => {
      const brp = parseAndInterpret('brp-airsense11.edf');
      const pld = parseAndInterpret('pld-airsense11.edf');
      const eve = parseAndInterpret('eve-airsense11.edf');
      const sad = parseAndInterpret('sad-airsense11.edf');

      const builder = new SessionBuilder();
      const results = builder.buildSessions([brp, pld, eve, sad]);
      const aggregate = results[0]!.aggregate;

      // AHI buckets: ObstructiveApnea, CentralApnea, MixedApnea,
      // UnclassifiedApnea, and Hypopnea each have their own index. RERA is NOT
      // part of AHI (it belongs to RDI); it is added here only because this
      // fixture scores no RERAs, so it contributes 0.
      const totalAHIEvents =
        aggregate.ahiObstructive +
        aggregate.ahiCentral +
        aggregate.ahiMixed +
        (aggregate.ahiUnclassified ?? 0) +
        aggregate.ahiHypopnea +
        aggregate.ahiRera;
      // Should be the AHI per hour; total depends on usage hours
      // All fixture files have same startTime; session duration = 60 seconds max
      // The AHI counts are per-hour rates, verify they're consistent:
      // If usage=0 (maskPressure from PLD is ~10 cmH2O, so usage > 0)
      expect(aggregate.ahi).toBeGreaterThan(0);
      expect(totalAHIEvents).toBe(aggregate.ahi);
    });

    it('should return undefined SpO2 stats (all-zero sentinel)', () => {
      const brp = parseAndInterpret('brp-airsense11.edf');
      const pld = parseAndInterpret('pld-airsense11.edf');
      const eve = parseAndInterpret('eve-airsense11.edf');
      const sad = parseAndInterpret('sad-airsense11.edf');

      const builder = new SessionBuilder();
      const results = builder.buildSessions([brp, pld, eve, sad]);
      const aggregate = results[0]!.aggregate;

      expect(aggregate.spo2Mean).toBeNull();
    });

    it('should compute leak stats from PLD data', () => {
      const brp = parseAndInterpret('brp-airsense11.edf');
      const pld = parseAndInterpret('pld-airsense11.edf');
      const eve = parseAndInterpret('eve-airsense11.edf');
      const sad = parseAndInterpret('sad-airsense11.edf');

      const builder = new SessionBuilder();
      const results = builder.buildSessions([brp, pld, eve, sad]);
      const aggregate = results[0]!.aggregate;

      // PLD leak is constant at 0.2 L/s, converted to L/min → 12 L/min
      expect(aggregate.leakMedian).toBeCloseTo(12, 0);
      expect(aggregate.leakMax).toBeCloseTo(12, 0);
    });

    it('should set correct machine info on the session', () => {
      const brp = parseAndInterpret('brp-airsense11.edf');
      const pld = parseAndInterpret('pld-airsense11.edf');
      const eve = parseAndInterpret('eve-airsense11.edf');
      const sad = parseAndInterpret('sad-airsense11.edf');

      const builder = new SessionBuilder();
      const results = builder.buildSessions([brp, pld, eve, sad]);
      const session = results[0]!.session;

      expect(session.machineId).toBe('23241654214');
    });
  });
});
