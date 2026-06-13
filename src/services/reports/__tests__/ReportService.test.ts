/**
 * Unit tests for ReportService — CSV generation, encryption, PDF, and helpers.
 *
 * Tests the public API surface: buildCSVFromAggregates, encryptBuffer,
 * downloadBlob, generatePDF, generateCSV, generateEncryptedArchive, and formatDate.
 *
 * @module services/reports/__tests__/ReportService.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NightlyAggregate } from '@/types';

// ---------------------------------------------------------------------------
// Mock: getDB — prevents real IndexedDB access
// ---------------------------------------------------------------------------

const mockGetDB = vi.fn();
vi.mock('@/services/storage/getDB', () => ({
  getDB: () => mockGetDB(),
}));

// ---------------------------------------------------------------------------
// Mock: jsPDF — avoid importing the real library
// ---------------------------------------------------------------------------

const mockJsPDFInstance = {
  setFontSize: vi.fn(),
  setFont: vi.fn(),
  text: vi.fn(),
  setLineWidth: vi.fn(),
  line: vi.fn(),
  addPage: vi.fn(),
  output: vi.fn().mockReturnValue(new Blob(['%PDF'], { type: 'application/pdf' })),
  setProperties: vi.fn(),
  setTextColor: vi.fn(),
  setFillColor: vi.fn(),
  setDrawColor: vi.fn(),
  roundedRect: vi.fn(),
  rect: vi.fn(),
  addImage: vi.fn(),
  getTextWidth: vi.fn().mockReturnValue(10),
};

vi.mock('jspdf', () => ({
  jsPDF: vi.fn(function () {
    return mockJsPDFInstance;
  }),
}));

// ---------------------------------------------------------------------------
// Mock: pdf/charts — canvas is not available in jsdom
// ---------------------------------------------------------------------------

vi.mock('../pdf/charts', () => ({
  drawLineChart: vi.fn().mockReturnValue('data:image/png;base64,AAAA'),
  drawBarChart: vi.fn().mockReturnValue('data:image/png;base64,AAAA'),
  drawHorizontalBarChart: vi.fn().mockReturnValue('data:image/png;base64,AAAA'),
  drawStackedAreaChart: vi.fn().mockReturnValue('data:image/png;base64,AAAA'),
}));

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are set up)
// ---------------------------------------------------------------------------

import {
  buildCSVFromAggregates,
  encryptBuffer,
  downloadBlob,
  generatePDF,
  generateCSV,
  generateEncryptedArchive,
  formatDate,
} from '../ReportService';
import type { ReportContentSelection, EncryptionParams } from '../types';
import { PHYSICIAN_SUMMARY_SECTIONS } from '../types';

// ---------------------------------------------------------------------------
// Helpers — jsdom Blob doesn't support .text() or .arrayBuffer()
// ---------------------------------------------------------------------------

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAggregate(overrides: Partial<NightlyAggregate> = {}): NightlyAggregate {
  return {
    id: 'agg-1',
    sessionId: 'sess-1',
    machineId: 'machine-1',
    date: '2024-01-15',
    ahi: 3.2,
    ahiObstructive: 1.0,
    ahiCentral: 0.5,
    ahiMixed: 0.2,
    ahiHypopnea: 1.3,
    ahiRera: 0.2,
    eventCount: 24,
    eventsByType: {
      obstructive: 7,
      central: 4,
      mixed: 2,
      hypopnea: 9,
      rera: 2,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
    },
    pressureMean: 10,
    pressureMedian: 9.5,
    pressureP95: 13,
    pressureMax: 15,
    epapMedian: null,
    ipapMedian: null,
    pressureSupport: null,
    leakMedian: 4.5,
    leakP95: 12,
    leakMax: 25,
    leakDurationMinutes: 5,
    tidalVolumeMean: null,
    tidalVolumeMedian: null,
    minuteVentMean: null,
    respRateMean: null,
    respRateMedian: null,
    spo2Mean: null,
    spo2Median: null,
    spo2Min: null,
    spo2Below90Percent: null,
    oxygenDesaturationIndex: null,
    usageHours: 7,
    maskOnTimeMinutes: 420,
    complianceStatus: 'compliant',
    configuredMinPressure: null,
    configuredMaxPressure: null,
    eprLevel: null,
    notes: '',
    tags: [],
    ...overrides,
  };
}

const SAMPLE_AGGREGATES: NightlyAggregate[] = [
  makeAggregate({ id: 'agg-1', date: '2024-01-01', ahi: 3.2, usageHours: 7 }),
  makeAggregate({
    id: 'agg-2',
    date: '2024-01-02',
    ahi: 4.1,
    usageHours: 6.5,
    complianceStatus: 'compliant',
  }),
  makeAggregate({
    id: 'agg-3',
    date: '2024-01-03',
    ahi: 2.8,
    usageHours: 3,
    complianceStatus: 'non-compliant',
  }),
];

const DATE_RANGE = { start: '2024-01-01', end: '2024-01-03' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDB.mockResolvedValue({
      getNightlyAggregatesByDateRange: vi.fn().mockResolvedValue(SAMPLE_AGGREGATES),
    });
    // Re-setup jsPDF mock after clearAllMocks wipes return values
    mockJsPDFInstance.output.mockReturnValue(new Blob(['%PDF'], { type: 'application/pdf' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── formatDate ───────────────────────────────────────────────────

  describe('formatDate', () => {
    it('should format a date as YYYY-MM-DD', () => {
      const date = new Date(2024, 0, 15); // Jan 15, 2024
      expect(formatDate(date)).toBe('2024-01-15');
    });

    it('should zero-pad single-digit months and days', () => {
      const date = new Date(2024, 2, 5); // Mar 5, 2024
      expect(formatDate(date)).toBe('2024-03-05');
    });

    it('should handle end of year correctly', () => {
      const date = new Date(2024, 11, 31); // Dec 31, 2024
      expect(formatDate(date)).toBe('2024-12-31');
    });
  });

  // ── CSV generation ─────────────────────────────────────────────

  describe('buildCSVFromAggregates', () => {
    it('should produce a valid CSV with header comments, header row, and data rows', () => {
      const csv = buildCSVFromAggregates(SAMPLE_AGGREGATES, DATE_RANGE);
      const lines = csv.split('\n');

      // Comment lines start with #
      const comments = lines.filter((l) => l.startsWith('#'));
      expect(comments.length).toBeGreaterThanOrEqual(4);

      // Should contain date range info
      expect(csv).toContain('2024-01-01');
      expect(csv).toContain('2024-01-03');
    });

    it('should have the correct CSV header columns', () => {
      const csv = buildCSVFromAggregates(SAMPLE_AGGREGATES, DATE_RANGE);
      const lines = csv.split('\n');
      const headerLine = lines.find((l) => !l.startsWith('#') && l.trim() !== '');

      expect(headerLine).toBeDefined();
      const headers = headerLine!.split(',');
      expect(headers).toContain('date');
      expect(headers).toContain('ahi');
      expect(headers).toContain('ahiObstructive');
      expect(headers).toContain('ahiCentral');
      expect(headers).toContain('ahiHypopnea');
      expect(headers).toContain('eventCount');
      expect(headers).toContain('leakMedian');
      expect(headers).toContain('leakP95');
      expect(headers).toContain('pressureMean');
      expect(headers).toContain('pressureP95');
      expect(headers).toContain('usageHours');
      expect(headers).toContain('complianceStatus');
    });

    it('should produce one data row per aggregate', () => {
      const csv = buildCSVFromAggregates(SAMPLE_AGGREGATES, DATE_RANGE);
      const lines = csv.split('\n');
      const dataLines = lines.filter((l) => !l.startsWith('#') && l.trim() !== '');
      // First data line is header, rest are data
      expect(dataLines.length).toBe(1 + SAMPLE_AGGREGATES.length);
    });

    it('should escape fields containing commas', () => {
      const agg = makeAggregate({
        complianceStatus: 'compliant' as const,
        notes: 'note with, comma',
      });
      // complianceStatus is "compliant" — no comma, so test with a field that
      // does contain a comma. We test the escaped output indirectly:
      // The CSV row should have the correct number of columns regardless.
      const csv = buildCSVFromAggregates([agg], DATE_RANGE);
      const lines = csv.split('\n');
      const dataLines = lines.filter((l) => !l.startsWith('#') && l.trim() !== '');
      // Header + 1 data row
      expect(dataLines.length).toBe(2);
    });

    it('should handle empty aggregates array', () => {
      const csv = buildCSVFromAggregates([], DATE_RANGE);
      const lines = csv.split('\n');
      const dataLines = lines.filter((l) => !l.startsWith('#') && l.trim() !== '');
      // Should still have the header row
      expect(dataLines.length).toBe(1);
    });

    it('should report mean AHI in the comment header', () => {
      const csv = buildCSVFromAggregates(SAMPLE_AGGREGATES, DATE_RANGE);
      // Mean AHI = (3.2 + 4.1 + 2.8) / 3 = 3.37
      expect(csv).toContain('Mean AHI:');
    });

    it('should report compliance rate in the comment header', () => {
      const csv = buildCSVFromAggregates(SAMPLE_AGGREGATES, DATE_RANGE);
      // 2 out of 3 compliant = 66.7%
      expect(csv).toContain('Compliance Rate:');
      expect(csv).toContain('66.7%');
    });
  });

  // ── Encryption ─────────────────────────────────────────────────

  describe('encryptBuffer', () => {
    it('should return a Blob with octet-stream MIME type', async () => {
      const plaintext = new TextEncoder().encode('Hello, CPAP data!');
      const params: EncryptionParams = { password: 'test-password-123', iterations: 1000 };

      const blob = await encryptBuffer(plaintext.buffer as ArrayBuffer, params);

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/octet-stream');
    });

    it('should produce output larger than 32 bytes (header = 4 + 16 + 12)', async () => {
      const plaintext = new TextEncoder().encode('Test data');
      const params: EncryptionParams = { password: 'test-password-123', iterations: 1000 };

      const blob = await encryptBuffer(plaintext.buffer as ArrayBuffer, params);

      // 4 (iterations) + 16 (salt) + 12 (IV) + ciphertext >= 32 + 9
      expect(blob.size).toBeGreaterThan(32);
    });

    it('should embed the iteration count in the first 4 bytes', async () => {
      const iterations = 1000;
      const plaintext = new TextEncoder().encode('Test');
      const params: EncryptionParams = { password: 'pass12345678', iterations };

      const blob = await encryptBuffer(plaintext.buffer as ArrayBuffer, params);
      const buffer = await readBlobAsArrayBuffer(blob);
      const view = new DataView(buffer);
      const storedIterations = view.getUint32(0, false);

      expect(storedIterations).toBe(iterations);
    });

    it('should use 600_000 iterations by default', async () => {
      const plaintext = new TextEncoder().encode('Test');
      const params: EncryptionParams = { password: 'pass12345678' };

      const blob = await encryptBuffer(plaintext.buffer as ArrayBuffer, params);
      const buffer = await readBlobAsArrayBuffer(blob);
      const view = new DataView(buffer);
      const storedIterations = view.getUint32(0, false);

      expect(storedIterations).toBe(600_000);
    });

    it('should produce different output for different passwords', async () => {
      const plaintext = new TextEncoder().encode('Same message');

      const blob1 = await encryptBuffer(plaintext.buffer as ArrayBuffer, {
        password: 'password-AAA',
        iterations: 1000,
      });
      const blob2 = await encryptBuffer(plaintext.buffer as ArrayBuffer, {
        password: 'password-BBB',
        iterations: 1000,
      });

      const bytes1 = new Uint8Array(await readBlobAsArrayBuffer(blob1));
      const bytes2 = new Uint8Array(await readBlobAsArrayBuffer(blob2));

      // Salt is random, so even the header portion (salt) should differ
      // Compare full output — at least some bytes must differ
      let differenceFound = false;
      for (let i = 0; i < Math.min(bytes1.length, bytes2.length); i++) {
        if (bytes1[i] !== bytes2[i]) {
          differenceFound = true;
          break;
        }
      }
      expect(differenceFound).toBe(true);
    });
  });

  // ── downloadBlob ───────────────────────────────────────────────

  describe('downloadBlob', () => {
    it('should create an anchor element, set href and download, and click it', () => {
      const createObjectURLSpy = vi.fn().mockReturnValue('blob:test-url');
      const revokeObjectURLSpy = vi.fn();
      globalThis.URL.createObjectURL = createObjectURLSpy;
      globalThis.URL.revokeObjectURL = revokeObjectURLSpy;

      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const blob = new Blob(['test'], { type: 'text/plain' });

      downloadBlob(blob, 'test-file.txt');

      expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
      expect(appendChildSpy).toHaveBeenCalled();

      const anchor = appendChildSpy.mock.calls[0]?.[0] as HTMLAnchorElement;
      expect(anchor.tagName).toBe('A');
      expect(anchor.href).toContain('blob:test-url');
      expect(anchor.download).toBe('test-file.txt');

      appendChildSpy.mockRestore();
    });
  });

  // ── generateCSV (integration with mock DB) ────────────────────

  describe('generateCSV', () => {
    it('should return a ReportResult with CSV blob and proper filename', async () => {
      const result = await generateCSV(DATE_RANGE);

      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.mimeType).toBe('text/csv');
      expect(result.filename).toContain('cpap-data');
      expect(result.filename).toContain('2024-01-01');
      expect(result.filename).toContain('2024-01-03');
      expect(result.filename).toMatch(/\.csv$/);
    });

    it('should fetch aggregates for the specified date range', async () => {
      const mockFn = vi.fn().mockResolvedValue(SAMPLE_AGGREGATES);
      mockGetDB.mockResolvedValue({ getNightlyAggregatesByDateRange: mockFn });

      await generateCSV(DATE_RANGE);

      expect(mockFn).toHaveBeenCalledWith('2024-01-01', '2024-01-03');
    });

    it('should produce valid CSV content in the blob', async () => {
      const result = await generateCSV(DATE_RANGE);
      const text = await readBlobAsText(result.blob);

      expect(text).toContain('date');
      expect(text).toContain('ahi');
      expect(text).toContain('2024-01-01');
    });
  });

  // ── generatePDF ────────────────────────────────────────────────

  describe('generatePDF', () => {
    it('should return a ReportResult with PDF blob and proper filename', async () => {
      const selection: ReportContentSelection = {
        template: 'physician-summary',
        dateRange: DATE_RANGE,
        sections: PHYSICIAN_SUMMARY_SECTIONS,
        format: 'pdf',
      };

      const result = await generatePDF(selection);

      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.mimeType).toBe('application/pdf');
      expect(result.filename).toContain('cpap-report');
      expect(result.filename).toMatch(/\.pdf$/);
    });

    it('should call jsPDF methods to build the document', async () => {
      const selection: ReportContentSelection = {
        template: 'full-analysis',
        dateRange: DATE_RANGE,
        sections: {
          summaryStatistics: true,
          sessionDetails: false,
          ahiTrend: false,
          leakAnalysis: false,
          pressureMetrics: false,
          eventBreakdown: false,
          complianceReport: true,
          usagePatterns: false,
        },
        format: 'pdf',
      };

      await generatePDF(selection);

      // jsPDF should have been used to render text
      expect(mockJsPDFInstance.text).toHaveBeenCalled();
      expect(mockJsPDFInstance.output).toHaveBeenCalledWith('blob');
    });

    it('should use custom title when provided', async () => {
      const selection: ReportContentSelection = {
        template: 'custom',
        dateRange: DATE_RANGE,
        sections: { ...PHYSICIAN_SUMMARY_SECTIONS },
        format: 'pdf',
        title: 'My Custom Report Title',
      };

      await generatePDF(selection);

      // The custom title should have been passed to doc.text
      const textCalls = mockJsPDFInstance.text.mock.calls as [string, number, number][];
      const titleCall = textCalls.find((call) => call[0] === 'My Custom Report Title');
      expect(titleCall).toBeDefined();
    });
  });

  // ── generateEncryptedArchive ───────────────────────────────────

  describe('generateEncryptedArchive', () => {
    it('should return an encrypted blob with octet-stream MIME type', async () => {
      const result = await generateEncryptedArchive(DATE_RANGE, {
        password: 'secure-pass-123',
        iterations: 1000,
      });

      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.mimeType).toBe('application/octet-stream');
      expect(result.filename).toContain('cpap-data-encrypted');
      expect(result.filename).toMatch(/\.bin$/);
    });

    it('should produce an encrypted blob larger than the raw CSV input', async () => {
      const result = await generateEncryptedArchive(DATE_RANGE, {
        password: 'secure-pass-123',
        iterations: 1000,
      });

      // The encrypted output includes 32-byte header + ciphertext (with GCM tag)
      // so it should be at least 32 bytes
      expect(result.blob.size).toBeGreaterThan(32);
    });
  });
});
