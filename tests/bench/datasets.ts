/**
 * Benchmark dataset generators for the import-parallelization measurement.
 *
 * Produces three at-scale, in-memory CPAP/Fitbit datasets as plain
 * `{ relativePath, bytes }` descriptors that a Playwright harness transfers into
 * a real browser and feeds to the import services. Built on the existing,
 * test-proven EDF binary builder (`src/test/generators/edf-generator.ts`) so the
 * synthetic files parse through the real pipeline unchanged.
 *
 * Datasets (sizes justified inline at each generator):
 *  1. many-small-days  — ~365 day-folders × 4 small files  (pool under-fill)
 *  2. few-large-days   — ~12 days × long multi-segment nights (parse CPU + OPFS chunks)
 *  3. fitbit-intraday  — ~365 daily intraday-HR JSON files (~17k samples each)
 *
 * NOTE: this module runs in Node (Playwright test process). It returns raw bytes;
 * the harness base64-transfers them and reconstructs `File`s in-browser.
 *
 * @module tests/bench/datasets
 */

import {
  generateBRPFile,
  generateEVEFile,
  generateSADFile,
  generateEDFFile,
  constantGenerator,
  sineWaveGenerator,
  type AnnotationConfig,
} from '../../src/test/generators/edf-generator';

/** One synthetic file as a path + bytes pair (transferred to the browser). */
export interface BenchFile {
  /** SD-card-relative path including the `YYYYMMDD` day-folder. */
  readonly relativePath: string;
  /** Raw file bytes. */
  readonly bytes: Uint8Array;
}

export interface BenchDataset {
  readonly name: string;
  readonly files: readonly BenchFile[];
  /** Total bytes across all files (for the report's machine caveat / throughput). */
  readonly totalBytes: number;
  /** Human-readable rationale for the chosen scale. */
  readonly rationale: string;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** `YYYYMMDD` for a day offset from a base date (local-time anchored at 22:00). */
function dayFolder(base: Date, offsetDays: number): { folder: string; start: Date } {
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const mo = d.getMonth();
  const day = d.getDate();
  const folder = `${y}${String(mo + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  // Anchor each night at 22:00 local so a single calendar date holds the session.
  return { folder, start: new Date(y, mo, day, 22, 0, 0) };
}

function ts(start: Date): string {
  const h = String(start.getHours()).padStart(2, '0');
  const m = String(start.getMinutes()).padStart(2, '0');
  const s = String(start.getSeconds()).padStart(2, '0');
  const y = start.getFullYear();
  const mo = String(start.getMonth() + 1).padStart(2, '0');
  const day = String(start.getDate()).padStart(2, '0');
  return `${y}${mo}${day}_${h}${m}${s}`;
}

const EVENTS: AnnotationConfig[] = [
  { onset: 120, duration: 15, label: 'Obstructive Apnea' },
  { onset: 300, duration: 12, label: 'Central Apnea' },
  { onset: 500, duration: 11, label: 'Hypopnea' },
];

// ---------------------------------------------------------------------------
// Dataset 1 — many small days
// ---------------------------------------------------------------------------

/**
 * ~365 day-folders, each with 4 SMALL files (BRP + EVE + PLD-like SAD + a 2nd
 * short BRP segment). Each night is only ~60–120 s of data, so per-file parse
 * cost is tiny and the dominant cost is the PER-DAY pipeline overhead: 365
 * sequential build→validate→store cycles, each preceded by a parse of only ~4
 * files (well under the 4-worker pool's width). This is the configuration where
 * the pool is most starved — exactly what CPAP pipelining opportunity #1
 * targets. 365 days keeps total bytes modest (~tens of MB) so the run completes
 * in a couple of minutes while still exercising 365 store cycles.
 */
export function buildManySmallDays(days = 365): BenchDataset {
  const base = new Date(2023, 0, 1, 22, 0, 0);
  const files: BenchFile[] = [];
  let totalBytes = 0;

  for (let i = 0; i < days; i++) {
    const { folder, start } = dayFolder(base, i);
    const dir = `DATALOG/${folder}`;
    // Short night: 90 s BRP + matching EVE, plus a small SAD oximetry file.
    const brp = new Uint8Array(generateBRPFile({ startDate: start, numDataRecords: 90 }));
    const eve = new Uint8Array(generateEVEFile(EVENTS, { startDate: start, numDataRecords: 90 }));
    const sad = new Uint8Array(generateSADFile({ startDate: start, numDataRecords: 90 }));
    // A second short segment 40 min later → still the same calendar night/session.
    const seg2Start = new Date(start.getTime() + 40 * 60 * 1000);
    const brp2 = new Uint8Array(generateBRPFile({ startDate: seg2Start, numDataRecords: 60 }));

    const entries: Array<[string, Uint8Array]> = [
      [`${ts(start)}_BRP.edf`, brp],
      [`${ts(start)}_EVE.edf`, eve],
      [`${ts(start)}_SAD.edf`, sad],
      [`${ts(seg2Start)}_BRP.edf`, brp2],
    ];
    for (const [name, bytes] of entries) {
      files.push({ relativePath: `${dir}/${name}`, bytes });
      totalBytes += bytes.byteLength;
    }
  }

  return {
    name: 'many-small-days',
    files,
    totalBytes,
    rationale: `${days} day-folders × 4 small files (~90s nights). Stresses per-day pipeline overhead and pool under-fill: 4-file parses cannot saturate a 4+ worker pool, and ${days} serial build→validate→store cycles dominate.`,
  };
}

// ---------------------------------------------------------------------------
// Dataset 2 — few large days
// ---------------------------------------------------------------------------

/**
 * ~12 days, each a LONG (~8 h) single-night recording. At 1 s data-record
 * duration, 8 h = 28 800 records; BRP carries Flow + MaskPressure at 25 Hz +
 * Leak at 2 Hz, so each BRP is multi-MB and parse CPU dominates. An 8 h session
 * also produces ~96 OPFS chunks (5-min chunks), so the per-session OPFS
 * chunk-write loop is exercised at realistic depth (decision input for parallel
 * chunk writes #2). 12 days keeps total bytes bounded (~hundreds of MB) and the
 * run within a few minutes while making parse + OPFS the clear hotspots.
 */
export function buildFewLargeDays(days = 12, hoursPerNight = 8): BenchDataset {
  const base = new Date(2023, 2, 1, 22, 0, 0);
  const files: BenchFile[] = [];
  let totalBytes = 0;
  const records = hoursPerNight * 3600; // 1 s data-record duration

  for (let i = 0; i < days; i++) {
    const { folder, start } = dayFolder(base, i);
    const dir = `DATALOG/${folder}`;

    // Full-resolution BRP: Flow 25 Hz, MaskPressure 25 Hz, Leak 2 Hz.
    const brp = new Uint8Array(
      generateEDFFile({
        startDate: start,
        numDataRecords: records,
        dataRecordDuration: 1,
        signals: [
          {
            label: 'Flow',
            physicalDimension: 'L/min',
            physicalMin: -200,
            physicalMax: 200,
            samplesPerRecord: 25,
            generator: (idx, total) => sineWaveGenerator(idx, total, -100, 100, 1500),
          },
          {
            label: 'MaskPressure',
            physicalDimension: 'cmH2O',
            physicalMin: 0,
            physicalMax: 25,
            samplesPerRecord: 25,
            generator: constantGenerator(10),
          },
          {
            label: 'Leak',
            physicalDimension: 'L/min',
            physicalMin: 0,
            physicalMax: 100,
            samplesPerRecord: 2,
            generator: constantGenerator(5),
          },
        ],
      }),
    );

    // EVE spanning the whole night with a smattering of events.
    const longEvents: AnnotationConfig[] = [];
    for (let t = 120; t < records - 60; t += 600) {
      longEvents.push({ onset: t, duration: 12, label: 'Obstructive Apnea' });
    }
    const eve = new Uint8Array(
      generateEVEFile(longEvents, { startDate: start, numDataRecords: records }),
    );

    const sad = new Uint8Array(generateSADFile({ startDate: start, numDataRecords: records }));

    for (const [name, bytes] of [
      [`${ts(start)}_BRP.edf`, brp] as [string, Uint8Array],
      [`${ts(start)}_EVE.edf`, eve] as [string, Uint8Array],
      [`${ts(start)}_SAD.edf`, sad] as [string, Uint8Array],
    ]) {
      files.push({ relativePath: `${dir}/${name}`, bytes });
      totalBytes += bytes.byteLength;
    }
  }

  return {
    name: 'few-large-days',
    files,
    totalBytes,
    rationale: `${days} days × ~${hoursPerNight}h nights (25 Hz Flow/Pressure). Stresses parse CPU (multi-MB BRP per night) and OPFS chunk count (~${Math.ceil((hoursPerNight * 3600) / 300)} 5-min chunks/session).`,
  };
}

// ---------------------------------------------------------------------------
// Dataset 3 — Fitbit multi-year intraday heart rate
// ---------------------------------------------------------------------------

/**
 * ~365 daily intraday heart-rate JSON files, each ~17k samples (5 s cadence over
 * a day). This is the heaviest Fitbit parser: a synchronous `JSON.parse` of ~17k
 * entries plus a full sort/map per file, processed ONE FILE AT A TIME
 * (parse→store→parse...). 365 files makes the serial parse→store cost
 * measurable while keeping the run within a few minutes. The intraday-HR JSON
 * shape matches `RawHeartRateIntradayEntry` (`dateTime` MM/DD/YY HH:MM:SS,
 * `value.bpm`, `value.confidence`) consumed by `parseHeartRateIntradayCore`.
 */
export function buildFitbitIntraday(days = 365, samplesPerDay = 17280): BenchDataset {
  const files: BenchFile[] = [];
  let totalBytes = 0;
  const encoder = new TextEncoder();
  const base = new Date(2022, 0, 1);

  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear() % 100).padStart(2, '0');
    const yyyy = d.getFullYear();
    const fileDate = `${yyyy}-${mm}-${dd}`;

    // Build ~17k entries at ~5 s cadence across the day.
    const entries: string[] = [];
    const cadenceSec = Math.max(1, Math.floor(86400 / samplesPerDay));
    for (let s = 0; s < samplesPerDay; s++) {
      const secOfDay = s * cadenceSec;
      const hh = String(Math.floor(secOfDay / 3600) % 24).padStart(2, '0');
      const mi = String(Math.floor((secOfDay % 3600) / 60)).padStart(2, '0');
      const ss = String(secOfDay % 60).padStart(2, '0');
      const bpm = 55 + Math.round(15 * Math.sin(s / 200) + (s % 7));
      const confidence = s % 25 === 0 ? 0 : 2;
      entries.push(
        `{"dateTime":"${mm}/${dd}/${yy} ${hh}:${mi}:${ss}","value":{"bpm":${bpm},"confidence":${confidence}}}`,
      );
    }
    const json = `[${entries.join(',')}]`;
    const bytes = encoder.encode(json);
    // Path mirrors the Google Takeout layout the scanner/import walks.
    files.push({
      relativePath: `Takeout/Fitbit/Global Export Data/heart_rate-${fileDate}.json`,
      bytes,
    });
    totalBytes += bytes.byteLength;
  }

  // The scanner requires >= 2 known subdirs under the root to accept it as a
  // Google Health export root. Add a tiny second known data type (a single
  // daily respiratory-rate CSV under "Heart Rate Variability") so root
  // resolution succeeds. It is negligible vs. the intraday-HR bulk and lets the
  // measurement focus on the heavy heart_rate_intraday path.
  {
    const header = 'timestamp,daily_respiratory_rate';
    const rows: string[] = [header];
    for (let i = 0; i < Math.min(days, 30); i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T02:00:00`;
      rows.push(`${iso},${(14 + (i % 3)).toFixed(1)}`);
    }
    const csv = rows.join('\n');
    const bytes = encoder.encode(csv);
    files.push({
      relativePath: `Takeout/Fitbit/Heart Rate Variability/Daily Respiratory Rate Summary - ${base.getFullYear()}-01-01.csv`,
      bytes,
    });
    totalBytes += bytes.byteLength;
  }

  return {
    name: 'fitbit-intraday-hr',
    files,
    totalBytes,
    rationale: `${days} daily intraday-HR JSON files × ~${samplesPerDay} samples. Stresses the serial per-file parse→store path (heaviest Fitbit parser; one JSON.parse + sort/map per file).`,
  };
}
