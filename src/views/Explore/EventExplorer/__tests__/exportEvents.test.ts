import { describe, it, expect } from 'vitest';
import type { Event } from '@/types/events';
import { eventsToCsv, eventsToJson, exportFilename } from '../exportEvents';

const event: Event = {
  id: 'evt-1',
  sessionId: 'sess-1',
  type: 'ObstructiveApnea',
  timestamp: Date.UTC(2025, 0, 1, 2, 30, 0),
  duration: 22.5,
  severity: null,
  pressure: 10,
  epap: null,
  ipap: null,
  leak: 5,
  spo2: null,
  clusterId: null,
};

describe('eventsToCsv', () => {
  it('includes a header row and a labeled type column', () => {
    const csv = eventsToCsv([event]);
    const [header, row] = csv.split('\n');
    expect(header).toContain('typeLabel');
    expect(header).toContain('isoTime');
    expect(row).toContain('Obstructive Apnea');
    expect(row).toContain('2025-01-01T02:30:00.000Z');
  });

  it('renders null fields as empty cells', () => {
    const csv = eventsToCsv([event]);
    const row = csv.split('\n')[1] ?? '';
    // spo2 is null → empty between commas, never the string "null"
    expect(row).not.toContain('null');
  });

  it('escapes cells containing commas or quotes', () => {
    const tricky: Event = { ...event, sessionId: 'a,b"c' };
    const csv = eventsToCsv([tricky]);
    expect(csv).toContain('"a,b""c"');
  });

  it('defangs CSV-injection sigils with a leading single quote (regression for m2)', () => {
    // Spreadsheets treat cells starting with =, +, -, @, TAB, or CR as formulas.
    // Prefixing with a single quote forces text mode and neutralizes any
    // downstream `=cmd|'/c calc'!A1` style attacks.
    for (const sigil of ['=cmd', '+evil', '-bad', '@formula', '\twebhook', '\rinject']) {
      const tricky: Event = { ...event, sessionId: sigil };
      const csv = eventsToCsv([tricky]);
      const row = csv.split('\n')[1] ?? '';
      // The cell value, possibly inside double-quotes if it also contains
      // commas or whitespace requiring quoting.
      expect(row).toContain(`'${sigil}`);
    }
  });
});

describe('eventsToJson', () => {
  it('emits enriched JSON with iso time and type label', () => {
    const json = JSON.parse(eventsToJson([event])) as Array<Record<string, unknown>>;
    expect(json[0]?.isoTime).toBe('2025-01-01T02:30:00.000Z');
    expect(json[0]?.typeLabel).toBe('Obstructive Apnea');
    expect(json[0]?.id).toBe('evt-1');
  });
});

describe('exportFilename', () => {
  it('builds a timestamped filename', () => {
    expect(exportFilename('csv', new Date(2026, 5, 12))).toBe('cpap-events-2026-06-12.csv');
    expect(exportFilename('json', new Date(2026, 5, 12))).toBe('cpap-events-2026-06-12.json');
  });
});
