import { describe, it, expect } from 'vitest';
import { ResMedInterpreter } from '@/parsers/resmed/ResMedInterpreter';
import { EDFParser } from '@/parsers/edf/EDFParser';
import { generateBRPFile, generateEDFFile, generateEVEFile } from '@/test/generators/edf-generator';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResMedInterpreter', () => {
  const interpreter = new ResMedInterpreter();

  // -----------------------------------------------------------------------
  // Channel label normalization
  // -----------------------------------------------------------------------

  describe('normalizeChannelLabel', () => {
    const cases: Array<[string, string]> = [
      ['Flow', 'flow'],
      ['MaskPressure', 'maskPressure'],
      ['Mask Pressure', 'maskPressure'],
      ['PMask', 'maskPressure'],
      ['Leak', 'leak'],
      ['Tidal Volume', 'tidalVolume'],
      ['Minute Vent', 'minuteVent'],
      ['MinuteVent', 'minuteVent'],
      ['Resp. Rate', 'respRate'],
      ['Resp Rate', 'respRate'],
      ['Respiratory Rate', 'respRate'],
      ['RespRate', 'respRate'],
      ['EPAP', 'epap'],
      ['IPAP', 'ipap'],
      ['SpO2', 'spo2'],
      ['Pulse', 'pulse'],
      ['Snore', 'snore'],
    ];

    for (const [input, expected] of cases) {
      it(`should map "${input}" → "${expected}"`, () => {
        expect(interpreter.normalizeChannelLabel(input)).toBe(expected);
      });
    }
  });

  // -----------------------------------------------------------------------
  // Case-insensitive matching
  // -----------------------------------------------------------------------

  describe('case-insensitive channel matching', () => {
    it('should match "FLOW" → flow', () => {
      expect(interpreter.normalizeChannelLabel('FLOW')).toBe('flow');
    });

    it('should match "flow" → flow', () => {
      expect(interpreter.normalizeChannelLabel('flow')).toBe('flow');
    });

    it('should match "mask pressure" → maskPressure', () => {
      expect(interpreter.normalizeChannelLabel('mask pressure')).toBe('maskPressure');
    });
  });

  // -----------------------------------------------------------------------
  // Unknown labels
  // -----------------------------------------------------------------------

  describe('unknown labels', () => {
    it('should return null for unrecognized channel label', () => {
      expect(interpreter.normalizeChannelLabel('UnknownChannel')).toBeNull();
    });

    it('should not throw on unknown labels', () => {
      expect(() => interpreter.normalizeChannelLabel('???')).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Event label mapping
  // -----------------------------------------------------------------------

  describe('mapEventLabel', () => {
    const cases: Array<[string, string]> = [
      ['Obstructive Apnea', 'ObstructiveApnea'],
      ['Central Apnea', 'CentralApnea'],
      ['Clear Airway', 'CentralApnea'],
      ['Hypopnea', 'Hypopnea'],
      ['Flow Limitation', 'FlowLimitation'],
      ['RERA', 'RERA'],
      ['Large Leak', 'LargeLeak'],
      ['Periodic Breathing', 'PeriodicBreathing'],
      ['Vibratory Snore', 'Vibratory'],
      ['Mixed Apnea', 'MixedApnea'],
    ];

    for (const [input, expected] of cases) {
      it(`should map "${input}" → "${expected}"`, () => {
        expect(interpreter.mapEventLabel(input)).toBe(expected);
      });
    }

    it('should return null for unrecognized event label', () => {
      expect(interpreter.mapEventLabel('Unknown Event Type')).toBeNull();
    });

    it('should be case-insensitive for events', () => {
      expect(interpreter.mapEventLabel('OBSTRUCTIVE APNEA')).toBe('ObstructiveApnea');
      expect(interpreter.mapEventLabel('hypopnea')).toBe('Hypopnea');
    });
  });

  // -----------------------------------------------------------------------
  // Machine info extraction
  // -----------------------------------------------------------------------

  describe('extractMachineInfo', () => {
    it('should extract serial number and model from patient ID', () => {
      const info = interpreter.extractMachineInfo('12345678 AirSense 10 AutoSet');
      expect(info.serialNumber).toBe('12345678');
      expect(info.model).toBe('AirSense 10 AutoSet');
    });

    it('should detect AirSense 10 series', () => {
      const info = interpreter.extractMachineInfo('12345678 AirSense 10 AutoSet');
      expect(info.series).toBe('AirSense 10');
    });

    it('should detect AirSense 11 series', () => {
      const info = interpreter.extractMachineInfo('99999999 AirSense 11 AutoSet');
      expect(info.series).toBe('AirSense 11');
    });

    it('should detect AirCurve series', () => {
      const info = interpreter.extractMachineInfo('11111111 AirCurve 10 VAuto');
      expect(info.series).toBe('AirCurve 10');
    });

    it('should handle unknown series', () => {
      const info = interpreter.extractMachineInfo('99999999 SomeBrand Device');
      expect(info.series).toBe('Unknown');
    });

    it('should handle patient ID with serial only', () => {
      const info = interpreter.extractMachineInfo('12345678');
      expect(info.serialNumber).toBe('12345678');
      expect(info.model).toBe('Unknown');
    });

    it('should extract firmware version from recording ID', () => {
      const info = interpreter.extractMachineInfo('12345678 AirSense 10 AutoSet', 'FW: 3.14.2');
      expect(info.firmwareVersion).toBe('3.14.2');
    });

    it('should return Unknown firmware when not in recording ID', () => {
      const info = interpreter.extractMachineInfo('12345678 AirSense 10 AutoSet', '');
      expect(info.firmwareVersion).toBe('Unknown');
    });
  });

  // -----------------------------------------------------------------------
  // Machine type detection
  // -----------------------------------------------------------------------

  describe('machine type detection', () => {
    it('should detect AutoSet → apap', () => {
      const info = interpreter.extractMachineInfo('SN AirSense 10 AutoSet');
      expect(info.machineType).toBe('apap');
    });

    it('should detect Elite → cpap', () => {
      const info = interpreter.extractMachineInfo('SN AirSense 10 Elite');
      expect(info.machineType).toBe('cpap');
    });

    it('should detect VPAP → vpap', () => {
      const info = interpreter.extractMachineInfo('SN VPAP ST');
      expect(info.machineType).toBe('vpap');
    });

    it('should detect ASV → asv', () => {
      const info = interpreter.extractMachineInfo('SN AirCurve 10 ASV');
      expect(info.machineType).toBe('asv');
    });

    it('should detect VAuto → bipap', () => {
      const info = interpreter.extractMachineInfo('SN AirCurve 10 VAuto');
      expect(info.machineType).toBe('bipap');
    });

    it('should default to cpap for unknown models', () => {
      const info = interpreter.extractMachineInfo('SN Generic Device');
      expect(info.machineType).toBe('cpap');
    });
  });

  // -----------------------------------------------------------------------
  // Machine capabilities
  // -----------------------------------------------------------------------

  describe('getMachineCapabilities', () => {
    it('should set hasAutoCPAP for AutoSet models', () => {
      const caps = interpreter.getMachineCapabilities('AirSense 10 AutoSet');
      expect(caps.hasAutoCPAP).toBe(true);
    });

    it('should set hasBilevel for VPAP models', () => {
      const caps = interpreter.getMachineCapabilities('VPAP ST');
      expect(caps.hasBilevel).toBe(true);
    });

    it('should set hasServoControl for ASV models', () => {
      const caps = interpreter.getMachineCapabilities('AirCurve 10 ASV');
      expect(caps.hasServoControl).toBe(true);
      expect(caps.hasBilevel).toBe(true);
    });

    it('should not set hasBilevel for CPAP models', () => {
      const caps = interpreter.getMachineCapabilities('AirSense 10 Elite');
      expect(caps.hasBilevel).toBe(false);
      expect(caps.hasServoControl).toBe(false);
    });

    it('should always set hasFlowLimitation to true', () => {
      const caps = interpreter.getMachineCapabilities('AirSense 10 Elite');
      expect(caps.hasFlowLimitation).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Full interpretation
  // -----------------------------------------------------------------------

  describe('interpret', () => {
    it('should interpret a BRP EDF file with normalized channels', () => {
      const edfParser = new EDFParser();
      const buffer = generateBRPFile();
      const edf = edfParser.parse(buffer);
      const result = interpreter.interpret(edf);

      expect(result.machineInfo.serialNumber).toBe('12345678');
      expect(result.machineInfo.model).toBe('AirSense 10 AutoSet');
      expect(result.channels.length).toBe(3);

      const channelNames = result.channels.map((c) => c.name);
      expect(channelNames).toContain('flow');
      expect(channelNames).toContain('maskPressure');
      expect(channelNames).toContain('leak');
    });

    it('should interpret EVE file with events', () => {
      const edfParser = new EDFParser();
      const buffer = generateEVEFile([
        { onset: 10, duration: 15, label: 'Obstructive Apnea' },
        { onset: 30, duration: 12, label: 'Hypopnea' },
      ]);
      const edf = edfParser.parse(buffer);
      const result = interpreter.interpret(edf);

      const obstructs = result.events.filter((e) => e.type === 'ObstructiveApnea');
      const hypos = result.events.filter((e) => e.type === 'Hypopnea');
      expect(obstructs.length).toBeGreaterThanOrEqual(1);
      expect(hypos.length).toBeGreaterThanOrEqual(1);
    });

    it('should collect unknown channel labels', () => {
      const edfParser = new EDFParser();
      const buffer = generateEDFFile({
        numDataRecords: 10,
        signals: [
          {
            label: 'WeirdChannel',
            physicalDimension: 'u',
            physicalMin: 0,
            physicalMax: 100,
            samplesPerRecord: 1,
            generator: () => 50,
          },
        ],
      });
      const edf = edfParser.parse(buffer);
      const result = interpreter.interpret(edf);

      expect(result.unknownLabels).toContain('WeirdChannel');
      expect(result.channels).toHaveLength(0);
    });
  });
});
