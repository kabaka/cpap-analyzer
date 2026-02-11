/**
 * ResMed Interpreter edge-case tests for Phase 4 features.
 *
 * Covers suffixed label normalization, structured recordingId parsing,
 * event mapping edge cases, and leak unit conversion.
 */

import { describe, it, expect } from 'vitest';
import { ResMedInterpreter } from '@/parsers/resmed/ResMedInterpreter';
import type { EDFFile, EDFSignal, EDFHeader } from '@/parsers/edf/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const interpreter = new ResMedInterpreter();

/** Build a minimal EDFFile for interpretation tests. */
function buildEDFFile(overrides: {
  patientId?: string;
  recordingId?: string;
  signals?: Partial<EDFSignal>[];
  annotations?: { onset: number; duration: number; labels: string[] }[];
}): EDFFile {
  const header: EDFHeader = {
    version: '0',
    patientId: overrides.patientId ?? 'X X X X',
    recordingId: overrides.recordingId ?? '',
    startDate: new Date(2024, 9, 15, 22, 30, 0),
    headerBytes: 256,
    reserved: '',
    numDataRecords: 1,
    dataRecordDuration: 1,
    numSignals: overrides.signals?.length ?? 0,
  };

  const signals: EDFSignal[] = (overrides.signals ?? []).map((s) => ({
    label: s.label ?? 'Unknown',
    transducerType: s.transducerType ?? '',
    physicalDimension: s.physicalDimension ?? '',
    physicalMin: s.physicalMin ?? 0,
    physicalMax: s.physicalMax ?? 100,
    digitalMin: s.digitalMin ?? -32768,
    digitalMax: s.digitalMax ?? 32767,
    prefiltering: s.prefiltering ?? '',
    samplesPerRecord: s.samplesPerRecord ?? 1,
    sampleRate: s.sampleRate ?? 1,
    samples: s.samples ?? new Float32Array(1),
  }));

  return {
    header,
    signals,
    annotations: overrides.annotations,
    duration: header.numDataRecords * header.dataRecordDuration,
    startTime: header.startDate,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResMedInterpreter edge cases', () => {
  // -----------------------------------------------------------------------
  // Suffixed label normalization
  // -----------------------------------------------------------------------

  describe('suffixed label normalization', () => {
    it('should normalize Flow.40ms → flow', () => {
      expect(interpreter.normalizeChannelLabel('Flow.40ms')).toBe('flow');
    });

    it('should normalize MaskPress.2s → maskPressure', () => {
      expect(interpreter.normalizeChannelLabel('MaskPress.2s')).toBe('maskPressure');
    });

    it('should normalize Leak.2s → leak', () => {
      expect(interpreter.normalizeChannelLabel('Leak.2s')).toBe('leak');
    });

    it('should normalize Press.40ms → pressure', () => {
      expect(interpreter.normalizeChannelLabel('Press.40ms')).toBe('pressure');
    });

    it('should normalize EprPress.2s → eprPressure', () => {
      expect(interpreter.normalizeChannelLabel('EprPress.2s')).toBe('eprPressure');
    });

    it('should normalize RespRate.2s → respRate', () => {
      expect(interpreter.normalizeChannelLabel('RespRate.2s')).toBe('respRate');
    });

    it('should normalize TidVol.2s → tidalVolume', () => {
      expect(interpreter.normalizeChannelLabel('TidVol.2s')).toBe('tidalVolume');
    });

    it('should normalize MinVent.2s → minuteVent', () => {
      expect(interpreter.normalizeChannelLabel('MinVent.2s')).toBe('minuteVent');
    });

    it('should normalize Snore.2s → snore', () => {
      expect(interpreter.normalizeChannelLabel('Snore.2s')).toBe('snore');
    });

    it('should normalize FlowLim.2s → flowLimitation', () => {
      expect(interpreter.normalizeChannelLabel('FlowLim.2s')).toBe('flowLimitation');
    });

    it('should normalize SpO2.1s → spo2', () => {
      expect(interpreter.normalizeChannelLabel('SpO2.1s')).toBe('spo2');
    });

    it('should normalize Pulse.1s → pulse', () => {
      expect(interpreter.normalizeChannelLabel('Pulse.1s')).toBe('pulse');
    });

    it('should return null for Crc16 (skipped)', () => {
      expect(interpreter.normalizeChannelLabel('Crc16')).toBeNull();
    });

    it('should strip arbitrary suffix and fall back to base lookup', () => {
      // "Leak.100ms" → strip suffix → "leak" → found in map
      expect(interpreter.normalizeChannelLabel('Leak.100ms')).toBe('leak');
    });

    it('should return null for completely unknown labels with suffix', () => {
      expect(interpreter.normalizeChannelLabel('Bogus.100ms')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Machine info from recordingId
  // -----------------------------------------------------------------------

  describe('machine info from recordingId', () => {
    it('should extract serial, series, and MID from structured recordingId', () => {
      const info = interpreter.extractMachineInfo(
        'X X X X 199E 54DC',
        'Startdate 15-OCT-2024 X X X SRN=23241654214  MID=36  VID=39',
      );
      expect(info.serialNumber).toBe('23241654214');
      expect(info.series).toBe('AirSense 11');
    });

    it('should detect AirSense 11 for MID in 30-39 range', () => {
      const info = interpreter.extractMachineInfo('X', 'SRN=111  MID=35  VID=10');
      expect(info.series).toBe('AirSense 11');
    });

    it('should detect AirSense 10 for MID in 20-29 range', () => {
      const info = interpreter.extractMachineInfo('X', 'SRN=222  MID=25  VID=10');
      expect(info.series).toBe('AirSense 10');
    });

    it('should detect AirCurve 10 for MID in 40-49 range', () => {
      const info = interpreter.extractMachineInfo('X', 'SRN=333  MID=45  VID=10');
      expect(info.series).toBe('AirCurve 10');
    });

    it('should fall back to patientId splitting when no SRN= in recordingId', () => {
      const info = interpreter.extractMachineInfo(
        '12345678 AirSense 10 AutoSet',
        'Startdate 15-OCT-2024',
      );
      expect(info.serialNumber).toBe('12345678');
      expect(info.model).toBe('AirSense 10 AutoSet');
      expect(info.series).toBe('AirSense 10');
    });

    it('should return Unknown series for MID outside known ranges', () => {
      const info = interpreter.extractMachineInfo('X', 'SRN=444  MID=99  VID=10');
      expect(info.series).toBe('Unknown');
    });

    it('should return Unknown series when no MID provided', () => {
      const info = interpreter.extractMachineInfo('X', 'SRN=555');
      expect(info.series).toBe('Unknown');
    });
  });

  // -----------------------------------------------------------------------
  // Event mapping edge cases
  // -----------------------------------------------------------------------

  describe('event mapping edge cases', () => {
    it('should map generic "Apnea" → MixedApnea', () => {
      expect(interpreter.mapEventLabel('Apnea')).toBe('MixedApnea');
    });

    it('should return null for unmapped "CSR Start"', () => {
      expect(interpreter.mapEventLabel('CSR Start')).toBeNull();
    });

    it('should return null for unmapped "CSR End"', () => {
      expect(interpreter.mapEventLabel('CSR End')).toBeNull();
    });

    it('should not report "Recording starts" as an unknown event', () => {
      const edf = buildEDFFile({
        annotations: [
          { onset: 0, duration: 0, labels: ['Recording starts'] },
          { onset: 10, duration: 15, labels: ['Obstructive Apnea'] },
        ],
      });

      const result = interpreter.interpret(edf);
      expect(result.unknownEvents).toHaveLength(0);
      // Only the Obstructive Apnea should appear
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.type).toBe('ObstructiveApnea');
    });

    it('should not report "Recording ends" as an unknown event', () => {
      const edf = buildEDFFile({
        annotations: [{ onset: 0, duration: 0, labels: ['Recording ends'] }],
      });

      const result = interpreter.interpret(edf);
      expect(result.unknownEvents).toHaveLength(0);
      expect(result.events).toHaveLength(0);
    });

    it('should map "Obstructive" (without "Apnea") → ObstructiveApnea', () => {
      expect(interpreter.mapEventLabel('Obstructive')).toBe('ObstructiveApnea');
    });

    it('should map "Central" (without "Apnea") → CentralApnea', () => {
      expect(interpreter.mapEventLabel('Central')).toBe('CentralApnea');
    });

    it('should map "Clear Airway" → CentralApnea', () => {
      expect(interpreter.mapEventLabel('Clear Airway')).toBe('CentralApnea');
    });
  });

  // -----------------------------------------------------------------------
  // Leak unit conversion
  // -----------------------------------------------------------------------

  describe('leak unit conversion', () => {
    it('should convert L/s to L/min (multiply by 60)', () => {
      const leakSamples = new Float32Array([0.2, 0.5, 1.0]);
      const edf = buildEDFFile({
        signals: [
          {
            label: 'Leak.2s',
            physicalDimension: 'L/s',
            sampleRate: 0.5,
            samples: leakSamples,
            samplesPerRecord: 3,
          },
        ],
      });

      const result = interpreter.interpret(edf);
      const leakChannel = result.channels.find((c) => c.name === 'leak');
      expect(leakChannel).toBeDefined();
      expect(leakChannel!.unit).toBe('L/min');
      expect(leakChannel!.samples[0]).toBeCloseTo(12, 1);
      expect(leakChannel!.samples[1]).toBeCloseTo(30, 1);
      expect(leakChannel!.samples[2]).toBeCloseTo(60, 1);
    });

    it('should not convert leak when unit is already L/min', () => {
      const leakSamples = new Float32Array([12, 24, 36]);
      const edf = buildEDFFile({
        signals: [
          {
            label: 'Leak',
            physicalDimension: 'L/min',
            sampleRate: 0.5,
            samples: leakSamples,
            samplesPerRecord: 3,
          },
        ],
      });

      const result = interpreter.interpret(edf);
      const leakChannel = result.channels.find((c) => c.name === 'leak');
      expect(leakChannel).toBeDefined();
      expect(leakChannel!.unit).toBe('L/min');
      // Values should remain unchanged
      expect(leakChannel!.samples[0]).toBeCloseTo(12, 1);
      expect(leakChannel!.samples[1]).toBeCloseTo(24, 1);
      expect(leakChannel!.samples[2]).toBeCloseTo(36, 1);
    });

    it('should handle case-insensitive L/s detection', () => {
      const leakSamples = new Float32Array([0.1]);
      const edf = buildEDFFile({
        signals: [
          {
            label: 'Leak.2s',
            physicalDimension: 'l/s',
            sampleRate: 0.5,
            samples: leakSamples,
            samplesPerRecord: 1,
          },
        ],
      });

      const result = interpreter.interpret(edf);
      const leakChannel = result.channels.find((c) => c.name === 'leak');
      expect(leakChannel).toBeDefined();
      expect(leakChannel!.unit).toBe('L/min');
      expect(leakChannel!.samples[0]).toBeCloseTo(6, 1);
    });
  });
});
