/**
 * Browser-side import benchmark harness (served by Vite, called from Playwright).
 *
 * This module lives under `src/` ONLY so the Vite dev server includes it in the
 * served module graph; it is never imported by the production app (no app code
 * references it) and is excluded from the build's reachable graph. The bench
 * Playwright spec does a single `import('/src/test/bench/importBenchHarness.ts')`
 * in-page and calls {@link runImportBench}, avoiding Playwright's
 * function-serialization limits with generator-bearing closures.
 *
 * It wires the REAL import services with a REAL worker pool + real OPFS/IDB,
 * enables the gated profiler, runs the import, and returns the published
 * {@link ImportProfile}.
 *
 * @module test/bench/importBenchHarness
 */

import { ImportService } from '@/services/import/ImportService';
import { GoogleHealthImportService } from '@/services/import/googlehealth/GoogleHealthImportService';
import { WorkerPool } from '@/services/workers/WorkerPool';
import { createWorker } from '@/services/workers/createWorker';
import type { EDFParserWorkerAPI } from '@/services/workers/edfParser.worker';
import { getDB, resetDB } from '@/services/storage/getDB';
import { OPFSService } from '@/services/storage/OPFSService';
import {
  type ImportProfile,
  IMPORT_PROFILE_FLAG_KEY,
  IMPORT_PROFILE_RESULT_KEY,
} from '@/services/import/profiling/ImportProfiler';

/** Wire form of a dataset transferred from the Node test process. */
export interface WireDataset {
  readonly name: string;
  readonly files: ReadonlyArray<{ readonly relativePath: string; readonly b64: string }>;
}

// ---------------------------------------------------------------------------
// In-page Fitbit dataset generation
// ---------------------------------------------------------------------------
//
// The Fitbit intraday dataset is multi-hundred-MB at full scale, which exceeds
// Playwright's CDP `page.evaluate` argument limit (~100MB). So it is generated
// IN THE PAGE rather than transferred. The JSON shape is identical to the Node
// generator (`tests/bench/datasets.ts`) and matches `RawHeartRateIntradayEntry`.

/** Build the Fitbit intraday dataset directly in the browser (no CDP transfer). */
export function generateFitbitInPage(
  days: number,
  samplesPerDay: number,
): { name: string; files: Array<{ relativePath: string; bytes: Uint8Array }>; totalBytes: number } {
  const enc = new TextEncoder();
  const files: Array<{ relativePath: string; bytes: Uint8Array }> = [];
  let totalBytes = 0;
  const base = new Date(2022, 0, 1);
  const cadenceSec = Math.max(1, Math.floor(86400 / samplesPerDay));

  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear() % 100).padStart(2, '0');
    const fileDate = `${d.getFullYear()}-${mm}-${dd}`;

    const entries: string[] = [];
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
    const bytes = enc.encode(`[${entries.join(',')}]`);
    files.push({
      relativePath: `Takeout/Fitbit/Global Export Data/heart_rate-${fileDate}.json`,
      bytes,
    });
    totalBytes += bytes.byteLength;
  }

  // Second known subdir so the scanner accepts the export root (needs >= 2).
  {
    const rows = ['timestamp,daily_respiratory_rate'];
    for (let i = 0; i < Math.min(days, 30); i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T02:00:00`;
      rows.push(`${iso},${(14 + (i % 3)).toFixed(1)}`);
    }
    const bytes = enc.encode(rows.join('\n'));
    files.push({
      relativePath: `Takeout/Fitbit/Heart Rate Variability/Daily Respiratory Rate Summary - 2022-01-01.csv`,
      bytes,
    });
    totalBytes += bytes.byteLength;
  }

  return { name: 'fitbit-intraday-hr', files, totalBytes };
}

/**
 * Generate the Fitbit dataset in-page and run the import benchmark on it. Used by
 * the spec for the Fitbit case so the large dataset never crosses the CDP
 * boundary.
 */
export async function runFitbitBenchInPage(
  days: number,
  samplesPerDay: number,
): Promise<ImportProfile> {
  (globalThis as Record<string, unknown>)[IMPORT_PROFILE_FLAG_KEY] = true;
  (globalThis as Record<string, unknown>)[IMPORT_PROFILE_RESULT_KEY] = undefined;

  const ds = generateFitbitInPage(days, samplesPerDay);
  const db = await getDB();

  const root: DirNode = { dirs: new Map(), files: new Map() };
  for (const f of ds.files) {
    const segs = f.relativePath.split('/');
    const fileName = segs.pop() ?? f.relativePath;
    let cur = root;
    for (const seg of segs) cur = ensureDir(cur, seg);
    cur.files.set(fileName, new File([f.bytes.buffer as ArrayBuffer], fileName));
  }
  const dirHandle = makeDirHandle(root, 'root');

  // Inline (no pool) — see the rationale in runImportBench's Fitbit branch.
  const service = new GoogleHealthImportService(db);
  const scanResult = await service.scan(dirHandle);
  const selected = scanResult.dataTypes.map((d) => d.dataType);
  await service.import(dirHandle, scanResult, {
    selectedDataTypes: selected,
    skipDuplicates: false,
  });

  const profile = (globalThis as Record<string, unknown>)[IMPORT_PROFILE_RESULT_KEY];
  if (!profile) throw new Error('No import profile produced');
  return profile as ImportProfile;
}

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function poolSize(): number {
  const hw = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(hw, 8));
}

// ---------------------------------------------------------------------------
// In-memory FileSystemDirectoryHandle shim (Fitbit path)
// ---------------------------------------------------------------------------

interface DirNode {
  readonly dirs: Map<string, DirNode>;
  readonly files: Map<string, File>;
}

function ensureDir(node: DirNode, name: string): DirNode {
  let d = node.dirs.get(name);
  if (!d) {
    d = { dirs: new Map(), files: new Map() };
    node.dirs.set(name, d);
  }
  return d;
}

function makeFileHandle(name: string, file: File): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: () => Promise.resolve(file),
  } as unknown as FileSystemFileHandle;
}

function makeDirHandle(node: DirNode, name: string): FileSystemDirectoryHandle {
  const handle = {
    kind: 'directory' as const,
    name,
    getDirectoryHandle(n: string): Promise<FileSystemDirectoryHandle> {
      const d = node.dirs.get(n);
      if (!d) return Promise.reject(new DOMException('NotFound', 'NotFoundError'));
      return Promise.resolve(makeDirHandle(d, n));
    },
    getFileHandle(n: string): Promise<FileSystemFileHandle> {
      const file = node.files.get(n);
      if (!file) return Promise.reject(new DOMException('NotFound', 'NotFoundError'));
      return Promise.resolve(makeFileHandle(n, file));
    },
    async *values(): AsyncGenerator<FileSystemDirectoryHandle | FileSystemFileHandle> {
      for (const [n, d] of node.dirs) yield makeDirHandle(d, n);
      for (const [n, file] of node.files) yield makeFileHandle(n, file);
    },
    async *entries(): AsyncGenerator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]> {
      for (const [n, d] of node.dirs) yield [n, makeDirHandle(d, n)];
      for (const [n, file] of node.files) yield [n, makeFileHandle(n, file)];
    },
  };
  return handle as unknown as FileSystemDirectoryHandle;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run one import of `wire` through the real pipeline with profiling enabled, and
 * return the resulting profile.
 */
export async function runImportBench(wire: WireDataset): Promise<ImportProfile> {
  (globalThis as Record<string, unknown>)[IMPORT_PROFILE_FLAG_KEY] = true;
  (globalThis as Record<string, unknown>)[IMPORT_PROFILE_RESULT_KEY] = undefined;

  const hw = poolSize();
  const db = await getDB();

  if (!wire.name.startsWith('fitbit')) {
    const opfs = OPFSService.isSupported() ? new OPFSService() : null;
    if (opfs) await opfs.initialize();

    const workerFactory = () =>
      createWorker<EDFParserWorkerAPI>(
        () =>
          new Worker(new URL('../../services/workers/edfParser.worker.ts', import.meta.url), {
            type: 'module',
            name: 'edf-parser',
          }),
        { timeoutMs: 120_000 },
      );
    const poolFactory = () =>
      new WorkerPool<EDFParserWorkerAPI>({
        workerFactory: (name?: string) =>
          new Worker(new URL('../../services/workers/edfParser.worker.ts', import.meta.url), {
            type: 'module',
            name: name ?? 'edf-parser',
          }),
        minWorkers: 1,
        maxWorkers: hw,
        taskTimeoutMs: 120_000,
      });

    const service = new ImportService(db, opfs, workerFactory, poolFactory);
    const files = wire.files.map((f) => {
      const buf = b64ToBuffer(f.b64);
      const name = f.relativePath.split('/').pop() ?? f.relativePath;
      const file = new File([buf], name, { type: 'application/octet-stream' });
      Object.defineProperty(file, 'webkitRelativePath', { value: f.relativePath });
      return file;
    });
    await service.importFiles(files, { sourceType: 'sd-card', skipDuplicates: false });
  } else {
    const root: DirNode = { dirs: new Map(), files: new Map() };
    for (const f of wire.files) {
      const segs = f.relativePath.split('/');
      const fileName = segs.pop() ?? f.relativePath;
      let cur = root;
      for (const seg of segs) cur = ensureDir(cur, seg);
      cur.files.set(fileName, new File([b64ToBuffer(f.b64)], fileName));
    }
    const dirHandle = makeDirHandle(root, 'root');

    // Run the Fitbit import INLINE (no worker pool injected). The heavy parsers
    // then execute on the main thread via the SAME worker-safe cores the pool
    // path uses, so parse output is identical and the parse→store INTERLEAVE
    // being measured (parse-all-then-store per type) is preserved. We avoid the
    // worker pool here because `WorkerPool.submit` cannot transfer a
    // `Comlink.proxy(progressCallback)` argument in the Vite environment
    // (DataCloneError — see findings; raw `Comlink.wrap` works, the pool's
    // `createWorker`/`withTimeout` wrapping does not). The parse-vs-store split
    // and the parse-idle-during-store RATIO — the decision inputs — are
    // unaffected by whether parse runs on a worker or the main thread; only the
    // absolute parse-ms attribution differs (main-thread here), which the report
    // flags in its machine caveat.
    const service = new GoogleHealthImportService(db);
    const scanResult = await service.scan(dirHandle);
    const selected = scanResult.dataTypes.map((d) => d.dataType);
    await service.import(dirHandle, scanResult, {
      selectedDataTypes: selected,
      skipDuplicates: false,
    });
  }

  // The service's internal `finish()` already published the profile to the
  // result global; read it back (calling finish() again would return null since
  // the profiler disables itself after finishing).
  const profile = (globalThis as Record<string, unknown>)[IMPORT_PROFILE_RESULT_KEY];
  if (!profile) throw new Error('No import profile produced');
  return profile as ImportProfile;
}

/**
 * Wipe IndexedDB + OPFS so each run starts from a clean slate (store work stays
 * constant across runs, undistorted by dedup hits or accumulated quota).
 */
export async function resetStorage(): Promise<void> {
  // Drop the cached IndexedDBService singleton + close its connection so the
  // deleteDatabase below is not blocked by an open connection, and the next
  // getDB() re-opens a fresh DB.
  resetDB();
  try {
    const factory = indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> };
    const dbs = await factory.databases?.();
    if (dbs) {
      await Promise.all(
        dbs.map(
          (d) =>
            new Promise<void>((res) => {
              if (!d.name) return res();
              const req = indexedDB.deleteDatabase(d.name);
              req.onsuccess = req.onerror = req.onblocked = (): void => res();
            }),
        ),
      );
    }
  } catch {
    /* ignore */
  }
  try {
    const r = await navigator.storage.getDirectory();
    for await (const name of (r as unknown as { keys(): AsyncIterable<string> }).keys()) {
      await r.removeEntry(name, { recursive: true }).catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}
