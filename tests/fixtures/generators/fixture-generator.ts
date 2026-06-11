/**
 * Standalone EDF fixture generator for AirSense 11 test data.
 *
 * Generates synthetic EDF files mimicking real ResMed AirSense 11 output.
 * Does NOT depend on the main codebase — writes binary EDF directly.
 *
 * Run: npx tsx tests/fixtures/generators/fixture-generator.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(__dirname, '..', 'edf');

// ---------------------------------------------------------------------------
// Shared identifiers (AirSense 11 format)
// ---------------------------------------------------------------------------

const PATIENT_ID = 'X X X X 199E 54DC';
const RECORDING_ID = 'Startdate 15-OCT-2024 X X X SRN=23241654214  MID=36  VID=39';
const START_DATE = new Date(2024, 9, 15, 22, 30, 0); // 2024-10-15 22:30:00

// ---------------------------------------------------------------------------
// Binary EDF helpers
// ---------------------------------------------------------------------------

function writeAscii(buf: Uint8Array, offset: number, length: number, value: string): void {
  const padded = value.padEnd(length, ' ').slice(0, length);
  for (let i = 0; i < length; i++) {
    buf[offset + i] = padded.charCodeAt(i);
  }
}

function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear() % 100).padStart(2, '0');
  return `${day}.${month}.${year}`;
}

function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}.${m}.${s}`;
}

interface SignalDef {
  label: string;
  transducer: string;
  physDim: string;
  physMin: number;
  physMax: number;
  digMin: number;
  digMax: number;
  prefiltering: string;
  samplesPerRecord: number;
  generator: (sampleIndex: number, totalSamples: number) => number;
}

interface AnnotationEntry {
  onset: number;
  duration: number;
  label: string;
}

interface EDFOptions {
  patientId: string;
  recordingId: string;
  startDate: Date;
  reserved: string;
  dataRecordDuration: number;
  numDataRecords: number;
  signals: SignalDef[];
  annotations?: AnnotationEntry[];
}

function buildEDF(opts: EDFOptions): ArrayBuffer {
  const signals = [...opts.signals];
  const hasAnnotations = opts.annotations !== undefined && opts.annotations.length > 0;

  // Add annotation signal if needed
  if (hasAnnotations) {
    const maxBytes = 512;
    signals.push({
      label: 'EDF Annotations',
      transducer: '',
      physDim: '',
      physMin: -32768,
      physMax: 32767,
      digMin: -32768,
      digMax: 32767,
      prefiltering: '',
      samplesPerRecord: Math.ceil(maxBytes / 2),
      generator: () => 0,
    });
  }

  const numSignals = signals.length;
  const headerBytes = 256 + 256 * numSignals;

  // Fixed header (256 bytes)
  const fixedHeader = new Uint8Array(256);
  writeAscii(fixedHeader, 0, 8, '0');
  writeAscii(fixedHeader, 8, 80, opts.patientId);
  writeAscii(fixedHeader, 88, 80, opts.recordingId);
  writeAscii(fixedHeader, 168, 8, formatDate(opts.startDate));
  writeAscii(fixedHeader, 176, 8, formatTime(opts.startDate));
  writeAscii(fixedHeader, 184, 8, String(headerBytes));
  writeAscii(fixedHeader, 192, 44, opts.reserved);
  writeAscii(fixedHeader, 236, 8, String(opts.numDataRecords));
  writeAscii(fixedHeader, 244, 8, String(opts.dataRecordDuration));
  writeAscii(fixedHeader, 252, 4, String(numSignals));

  // Signal headers (ns * 256 bytes, fields stored sequentially across all signals)
  const sigHeader = new Uint8Array(256 * numSignals);
  const fieldWidths = [16, 80, 8, 8, 8, 8, 8, 80, 8, 32];
  const offsets: number[] = [];
  let off = 0;
  for (const w of fieldWidths) {
    offsets.push(off);
    off += w * numSignals;
  }

  for (let i = 0; i < numSignals; i++) {
    const sig = signals[i]!;
    writeAscii(sigHeader, offsets[0]! + i * 16, 16, sig.label);
    writeAscii(sigHeader, offsets[1]! + i * 80, 80, sig.transducer);
    writeAscii(sigHeader, offsets[2]! + i * 8, 8, sig.physDim);
    writeAscii(sigHeader, offsets[3]! + i * 8, 8, String(sig.physMin));
    writeAscii(sigHeader, offsets[4]! + i * 8, 8, String(sig.physMax));
    writeAscii(sigHeader, offsets[5]! + i * 8, 8, String(sig.digMin));
    writeAscii(sigHeader, offsets[6]! + i * 8, 8, String(sig.digMax));
    writeAscii(sigHeader, offsets[7]! + i * 80, 80, sig.prefiltering);
    writeAscii(sigHeader, offsets[8]! + i * 8, 8, String(sig.samplesPerRecord));
    // offsets[9] = reserved (32 bytes each), leave blank
  }

  // Data records
  const samplesPerRecord = signals.reduce((sum, s) => sum + s.samplesPerRecord, 0);
  const recordBytes = samplesPerRecord * 2;
  const numRecs = Math.max(0, opts.numDataRecords);
  const dataBuffer = new ArrayBuffer(recordBytes * numRecs);
  const dataView = new DataView(dataBuffer);

  const totalSamplesPerSignal = signals.map((s) => s.samplesPerRecord * numRecs);

  // Group annotations by record
  const annByRecord = new Map<number, AnnotationEntry[]>();
  if (hasAnnotations && opts.annotations) {
    for (const ann of opts.annotations) {
      const recIdx =
        opts.dataRecordDuration > 0
          ? Math.min(Math.floor(ann.onset / opts.dataRecordDuration), numRecs - 1)
          : 0;
      const existing = annByRecord.get(recIdx);
      if (existing) existing.push(ann);
      else annByRecord.set(recIdx, [ann]);
    }
  }

  const encoder = new TextEncoder();

  for (let rec = 0; rec < numRecs; rec++) {
    let byteOff = rec * recordBytes;

    for (let si = 0; si < signals.length; si++) {
      const sig = signals[si]!;
      const isAnnotation = hasAnnotations && si === signals.length - 1;

      if (isAnnotation) {
        const annBytes = new Uint8Array(sig.samplesPerRecord * 2);
        let cursor = 0;

        // Time-keeping TAL
        const recOnset = rec * opts.dataRecordDuration;
        const talPrefix = `+${recOnset}\x14\x14\x00`;
        const talBytes = encoder.encode(talPrefix);
        annBytes.set(talBytes, cursor);
        cursor += talBytes.length;

        const recAnns = annByRecord.get(rec);
        if (recAnns) {
          for (const ann of recAnns) {
            const durStr = ann.duration > 0 ? String(ann.duration) : '';
            const tal = `+${ann.onset}\x15${durStr}\x14${ann.label}\x14\x00`;
            const talEntry = encoder.encode(tal);
            if (cursor + talEntry.length <= annBytes.length) {
              annBytes.set(talEntry, cursor);
              cursor += talEntry.length;
            }
          }
        }

        for (let s = 0; s < sig.samplesPerRecord; s++) {
          const lo = annBytes[s * 2] ?? 0;
          const hi = annBytes[s * 2 + 1] ?? 0;
          let value = lo | (hi << 8);
          if (value >= 0x8000) value -= 0x10000;
          dataView.setInt16(byteOff + s * 2, value, true);
        }
      } else {
        const total = totalSamplesPerSignal[si]!;
        const digRange = sig.digMax - sig.digMin;
        const physRange = sig.physMax - sig.physMin;

        for (let s = 0; s < sig.samplesPerRecord; s++) {
          const globalIdx = rec * sig.samplesPerRecord + s;
          const physValue = sig.generator(globalIdx, total);
          const digital = Math.round(
            ((physValue - sig.physMin) / physRange) * digRange + sig.digMin,
          );
          const clamped = Math.max(-32768, Math.min(32767, digital));
          dataView.setInt16(byteOff + s * 2, clamped, true);
        }
      }

      byteOff += sig.samplesPerRecord * 2;
    }
  }

  // Combine
  const totalSize = headerBytes + recordBytes * numRecs;
  const result = new ArrayBuffer(totalSize);
  const resultArr = new Uint8Array(result);
  resultArr.set(fixedHeader, 0);
  resultArr.set(sigHeader, 256);
  resultArr.set(new Uint8Array(dataBuffer), headerBytes);

  return result;
}

// ---------------------------------------------------------------------------
// Value generators
// ---------------------------------------------------------------------------

function constant(value: number): (i: number, n: number) => number {
  return () => value;
}

function sineWave(
  amplitude: number,
  offset: number,
  cyclesPerSecond: number,
  sampleRate: number,
): (i: number, n: number) => number {
  return (i: number) => {
    const t = i / sampleRate;
    return offset + amplitude * Math.sin(2 * Math.PI * cyclesPerSecond * t);
  };
}

// ---------------------------------------------------------------------------
// Fixture definitions
// ---------------------------------------------------------------------------

function generateBRP(startDate: Date = START_DATE): ArrayBuffer {
  return buildEDF({
    patientId: PATIENT_ID,
    recordingId: RECORDING_ID,
    startDate,
    reserved: '',
    dataRecordDuration: 1,
    numDataRecords: 60,
    signals: [
      {
        label: 'Flow.40ms',
        transducer: '',
        physDim: 'L/s',
        physMin: -2,
        physMax: 2,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 25,
        // Sine wave ±1.5 L/s at ~0.25 Hz (15 breaths/min)
        generator: sineWave(1.5, 0, 0.25, 25),
      },
      {
        label: 'Press.40ms',
        transducer: '',
        physDim: 'cmH2O',
        physMin: 0,
        physMax: 25,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 25,
        generator: constant(10),
      },
      {
        label: 'Crc16',
        transducer: '',
        physDim: '',
        physMin: -32768,
        physMax: 32767,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 25,
        generator: constant(0),
      },
    ],
  });
}

function generatePLD(): ArrayBuffer {
  return buildEDF({
    patientId: PATIENT_ID,
    recordingId: RECORDING_ID,
    startDate: START_DATE,
    reserved: '',
    dataRecordDuration: 60,
    numDataRecords: 1,
    signals: [
      {
        label: 'MaskPress.2s',
        transducer: '',
        physDim: 'cmH2O',
        physMin: 0,
        physMax: 25,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 30,
        generator: constant(10),
      },
      {
        label: 'Press.2s',
        transducer: '',
        physDim: 'cmH2O',
        physMin: 0,
        physMax: 25,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 30,
        generator: constant(10),
      },
      {
        label: 'EprPress.2s',
        transducer: '',
        physDim: 'cmH2O',
        physMin: 0,
        physMax: 25,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 30,
        generator: constant(7),
      },
      {
        label: 'Leak.2s',
        transducer: '',
        physDim: 'L/s',
        physMin: 0,
        physMax: 10,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 30,
        generator: constant(0.2),
      },
      {
        label: 'RespRate.2s',
        transducer: '',
        physDim: '/min',
        physMin: 0,
        physMax: 60,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 30,
        generator: constant(15),
      },
      {
        label: 'TidVol.2s',
        transducer: '',
        physDim: 'ml',
        physMin: 0,
        physMax: 3000,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 30,
        generator: constant(500),
      },
      {
        label: 'MinVent.2s',
        transducer: '',
        physDim: 'L/min',
        physMin: 0,
        physMax: 60,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 30,
        generator: constant(7.5),
      },
      {
        label: 'Snore.2s',
        transducer: '',
        physDim: '',
        physMin: 0,
        physMax: 10,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 30,
        generator: constant(0),
      },
      {
        label: 'FlowLim.2s',
        transducer: '',
        physDim: '',
        physMin: 0,
        physMax: 1,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 30,
        generator: constant(0.1),
      },
      {
        label: 'Crc16',
        transducer: '',
        physDim: '',
        physMin: -32768,
        physMax: 32767,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 30,
        generator: constant(0),
      },
      {
        label: 'Crc16',
        transducer: '',
        physDim: '',
        physMin: -32768,
        physMax: 32767,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 30,
        generator: constant(0),
      },
    ],
  });
}

function generateEVE(startDate: Date = START_DATE): ArrayBuffer {
  return buildEDF({
    patientId: PATIENT_ID,
    recordingId: RECORDING_ID,
    startDate,
    reserved: 'EDF+C',
    dataRecordDuration: 0,
    numDataRecords: 1,
    signals: [],
    annotations: [
      { onset: 0, duration: 0, label: 'Recording starts' },
      { onset: 120, duration: 15, label: 'Obstructive Apnea' },
      { onset: 300, duration: 12, label: 'Central Apnea' },
      { onset: 500, duration: 11, label: 'Hypopnea' },
      { onset: 600, duration: 0, label: 'Arousal' },
      { onset: 800, duration: 14, label: 'Apnea' },
    ],
  });
}

/**
 * Build a 256-byte global-header-only EDF buffer (CSL-style stub).
 *
 * A valid fixed header that *declares* `numSignals` signals and 0 data records,
 * but the signal-header block and data records are ABSENT on disk (the file is
 * exactly 256 bytes). ResMed AirSense machines emit these CSL (Cheyne-Stokes)
 * stubs on nights with no periodic-breathing events. {@link EDFParser.parse}
 * returns an EMPTY EDFFile for these rather than throwing, so the import
 * pipeline counts them as `filesSkippedEmpty` instead of surfacing an error.
 *
 * Byte layout mirrors `makeCslStubBuffer` in ImportService.test.ts so the E2E
 * and unit fixtures stay in lock-step.
 */
function generateCslStub(numSignals = 2, startDate: Date = START_DATE): ArrayBuffer {
  const buffer = new ArrayBuffer(256);
  const bytes = new Uint8Array(buffer);
  const headerBytes = 256 + 256 * numSignals; // declared, but absent on disk

  writeAscii(bytes, 0, 8, '0'); // version
  writeAscii(bytes, 8, 80, PATIENT_ID); // patient id
  writeAscii(bytes, 88, 80, RECORDING_ID); // recording id
  writeAscii(bytes, 168, 8, formatDate(startDate)); // start date
  writeAscii(bytes, 176, 8, formatTime(startDate)); // start time
  writeAscii(bytes, 184, 8, String(headerBytes)); // header byte count
  writeAscii(bytes, 192, 44, 'EDF+C'); // reserved
  writeAscii(bytes, 236, 8, '0'); // numDataRecords
  writeAscii(bytes, 244, 8, '0'); // dataRecordDuration
  writeAscii(bytes, 252, 4, String(numSignals)); // numSignals

  return buffer;
}

function generateSAD(): ArrayBuffer {
  return buildEDF({
    patientId: PATIENT_ID,
    recordingId: RECORDING_ID,
    startDate: START_DATE,
    reserved: '',
    dataRecordDuration: 1,
    numDataRecords: 60,
    signals: [
      {
        label: 'SpO2.1s',
        transducer: '',
        physDim: '%',
        physMin: 0,
        physMax: 100,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 1,
        generator: constant(0),
      },
      {
        label: 'Pulse.1s',
        transducer: '',
        physDim: 'bpm',
        physMin: 0,
        physMax: 250,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 1,
        generator: constant(0),
      },
      {
        label: 'Crc16',
        transducer: '',
        physDim: '',
        physMin: -32768,
        physMax: 32767,
        digMin: -32768,
        digMax: 32767,
        prefiltering: '',
        samplesPerRecord: 1,
        generator: constant(0),
      },
    ],
  });
}

function generateBRPUnknownRecords(): ArrayBuffer {
  // Build a normal BRP but set numDataRecords to -1 in the header
  const buf = generateBRP();
  const arr = new Uint8Array(buf);
  // numDataRecords field is at offset 236, 8 bytes
  const encoder = new TextEncoder();
  const field = '-1'.padEnd(8, ' ');
  const bytes = encoder.encode(field);
  arr.set(bytes, 236);
  return buf;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const fixtures: Array<{ name: string; data: ArrayBuffer }> = [
    { name: 'brp-airsense11.edf', data: generateBRP() },
    { name: 'pld-airsense11.edf', data: generatePLD() },
    { name: 'eve-airsense11.edf', data: generateEVE() },
    { name: 'sad-airsense11.edf', data: generateSAD() },
    { name: 'brp-unknown-records.edf', data: generateBRPUnknownRecords() },
  ];

  for (const { name, data } of fixtures) {
    const filePath = path.join(OUTPUT_DIR, name);
    fs.writeFileSync(filePath, Buffer.from(data));
    console.log(`  ✓ ${name} (${data.byteLength} bytes)`);
  }

  // Empty EVE file (0 bytes)
  const emptyPath = path.join(OUTPUT_DIR, 'eve-empty.edf');
  fs.writeFileSync(emptyPath, Buffer.alloc(0));
  console.log('  ✓ eve-empty.edf (0 bytes)');

  // Standalone CSL stub fixture (256-byte header-only).
  const cslPath = path.join(OUTPUT_DIR, 'csl-stub.edf');
  fs.writeFileSync(cslPath, Buffer.from(generateCslStub(2)));
  console.log('  ✓ csl-stub.edf (256 bytes)');

  generateImportTree();

  console.log(`\nAll fixtures written to ${OUTPUT_DIR}`);
}

// ---------------------------------------------------------------------------
// Import directory tree (for the E2E Import Wizard "happy path" + regression)
// ---------------------------------------------------------------------------

/**
 * Write a complete SD-card-style import tree to `tests/fixtures/import-tree/`,
 * mirroring a ResMed DATALOG layout. This tree is uploaded *as a directory* by
 * the Playwright import E2E so the wizard's `webkitdirectory` file input
 * receives real `webkitRelativePath`s.
 *
 * The single day-folder (named `YYYYMMDD`) contains:
 *   - Session A:  22:00:00  BRP + EVE  (60-second recordings)
 *   - Session B:  23:30:00  BRP + EVE  (>30 min after A → SessionBuilder splits
 *                                       them into two distinct sessions on the
 *                                       SAME calendar date)
 *   - A 256-byte CSL header-only stub  (must be skipped quietly, NOT errored)
 *
 * Two same-day sessions exercise the multi-session-per-day regression fix
 * (previously the 2nd session failed on the machineId_date uniqueness
 * constraint); the CSL stub exercises the empty-skip summary count.
 *
 * The recording date is **7 days ago** (computed at generation time) so the
 * imported sessions fall inside the app's default 30-day date-range window and
 * are therefore visible in the Sessions / Dashboard views without the E2E
 * having to widen the range. The night is anchored at 22:00 local time so both
 * sessions land on the same calendar date regardless of the runner's timezone.
 */
/** Metadata describing the generated import tree, consumed by the E2E spec. */
export interface ImportTreeInfo {
  /** Absolute path to the tree root (the directory uploaded by the wizard). */
  readonly treeDir: string;
  /** `YYYYMMDD` day-folder name = the calendar date of both sessions. */
  readonly yyyymmdd: string;
  /** Number of distinct sessions the tree should produce (same calendar day). */
  readonly expectedSessions: number;
  /** Number of files that must be skipped as empty (the CSL stub). */
  readonly expectedSkippedEmpty: number;
}

export function generateImportTree(outDir?: string): ImportTreeInfo {
  // Anchor on a recent calendar date (7 days ago) at 22:00 local time.
  const anchor = new Date();
  anchor.setDate(anchor.getDate() - 7);
  const y = anchor.getFullYear();
  const mo = anchor.getMonth();
  const d = anchor.getDate();

  const yyyymmdd = `${y}${String(mo + 1).padStart(2, '0')}${String(d).padStart(2, '0')}`;

  // Default to a shared location for the CLI; callers (e.g. parallel Playwright
  // workers) pass a unique `outDir` to avoid racing on the same directory.
  const TREE_DIR = outDir ? path.resolve(outDir) : path.resolve(__dirname, '..', 'import-tree');
  const dayDir = path.join(TREE_DIR, 'DATALOG', yyyymmdd);
  // Clean any stale day-folders from a previous run (date changes daily).
  const datalogDir = path.join(TREE_DIR, 'DATALOG');
  if (fs.existsSync(datalogDir)) {
    fs.rmSync(datalogDir, { recursive: true, force: true });
  }
  fs.mkdirSync(dayDir, { recursive: true });

  // Session A — <date> 22:00:00
  const sessionA = new Date(y, mo, d, 22, 0, 0);
  // Session B — <date> 23:30:00 (90 min later → new session)
  const sessionB = new Date(y, mo, d, 23, 30, 0);

  const files: Array<{ name: string; data: ArrayBuffer }> = [
    { name: `${yyyymmdd}_220000_BRP.edf`, data: generateBRP(sessionA) },
    { name: `${yyyymmdd}_220000_EVE.edf`, data: generateEVE(sessionA) },
    { name: `${yyyymmdd}_233000_BRP.edf`, data: generateBRP(sessionB) },
    { name: `${yyyymmdd}_233000_EVE.edf`, data: generateEVE(sessionB) },
    // Header-only CSL stub on a night with no Cheyne-Stokes events.
    { name: `${yyyymmdd}_220000_CSL.edf`, data: generateCslStub(2, sessionA) },
  ];

  for (const { name, data } of files) {
    fs.writeFileSync(path.join(dayDir, name), Buffer.from(data));
  }

  console.log(
    `  ✓ import-tree/DATALOG/${yyyymmdd}/ (${files.length} files: 2 sessions + 1 CSL stub)`,
  );

  return { treeDir: TREE_DIR, yyyymmdd, expectedSessions: 2, expectedSkippedEmpty: 1 };
}

// Only run the full fixture write when executed directly as a script
// (`npx tsx fixture-generator.ts`), not when imported for `generateImportTree`.
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === __filename) {
  main();
}
