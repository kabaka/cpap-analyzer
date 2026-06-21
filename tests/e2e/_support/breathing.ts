/**
 * Test support for the Breathing Patterns → Episode Catalog e2e suite
 * (docs/design/breathing-catalog-streaming-ux.md).
 *
 * The catalog resolves nights through a read-through cache:
 *
 *   L1 Map → L2 IndexedDB (`breathing_detections`) → compute (OPFS + WorkerPool).
 *
 * These helpers seed each layer so the suite can exercise every phase
 * **deterministically and without arbitrary sleeps**:
 *
 *  - {@link seedCachedNight} writes a `breathing_detections` record keyed by the
 *    app's own current composite cache id (algoVersion + paramHash, obtained by
 *    dynamically importing the app module in-page). A seeded night is an L2 hit,
 *    so it streams in during the **reading-cache** phase with NO OPFS I/O and NO
 *    worker compute — the run goes reading-cache → complete instantly. This is
 *    the deterministic backbone for the "warm cache", filters, drill-down,
 *    empty-state and accessibility scenarios.
 *
 *  - {@link seedOpfsMissNight} writes a session with a minimal OPFS manifest +
 *    Flow chunk but NO cache record. It is therefore a **miss** that enters the
 *    **computing** phase and reaches `pool.submit`. Combined with
 *    {@link installHeldWorkerPool}, the submitted compute is held pending on
 *    demand, so the run parks in `computing` with the Cancel control visible —
 *    long enough to drive Cancel / Resume deterministically (UX §5).
 *
 * Mirrors the version-less `indexedDB.open(name)` seeding convention used by the
 * other e2e specs (analysis-views.spec.ts, weather.ts) so it attaches to
 * whatever schema version the app has already migrated to.
 */

import { expect, type Locator, type Page } from '@playwright/test';

export const DB_NAME = 'cpap-analyzer';

/**
 * Whether the running browser exposes OPFS (`navigator.storage.getDirectory`).
 * The catalog needs OPFS to read full-resolution airflow; without it the hook
 * correctly renders the §8.2 "unavailable in this browser" error state and the
 * normal catalog scenarios cannot run. The Linux headless WebKit build
 * (MiniBrowser-WPE) ships WITHOUT `navigator.storage`, so the suite gates the
 * OPFS-dependent scenarios on this and asserts the unsupported state instead.
 * (Real desktop Safari supports OPFS.)
 */
export async function opfsSupported(page: Page): Promise<boolean> {
  await page.goto('/');
  return page.evaluate(
    () =>
      typeof navigator !== 'undefined' &&
      'storage' in navigator &&
      typeof navigator.storage?.getDirectory === 'function',
  );
}

/** A local-calendar date (YYYY-MM-DD) `n` days before today. */
export function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Epoch-ms session start for a YYYY-MM-DD date at 22:00 UTC. */
export function sessionStartMs(date: string): number {
  return new Date(`${date}T22:00:00Z`).getTime();
}

/**
 * Compute the app's current composite breathing-detection cache id for a
 * session, by dynamically importing the real app module in-page. This avoids
 * hard-coding the param hash (which is derived from the default detector params
 * and would silently rot if those defaults are tuned).
 *
 * Requires the page to already be on an app document (after `page.goto('/')`).
 */
export async function currentDetectionId(page: Page, sessionId: string): Promise<string> {
  return page.evaluate(async (sid) => {
    const m = await import('/src/analysis/breathing/index.ts');
    return m.makeBreathingDetectionId(
      sid,
      m.BREATHING_ALGO_VERSION,
      m.DEFAULT_BREATHING_PARAM_HASH,
    );
  }, sessionId);
}

/** Minimal valid `Session` row for the `sessions` store. */
function sessionRecord(sessionId: string, date: string): Record<string, unknown> {
  return {
    id: sessionId,
    machineId: 'TEST-MACHINE',
    machineModel: 'AirSense 11 AutoSet',
    machineType: 'cpap',
    firmwareVersion: '3.0.2',
    date,
    startTime: `${date}T22:00:00Z`,
    endTime: `${date}T06:00:00Z`,
    durationMinutes: 480,
    usageMinutes: 420,
    importedAt: new Date().toISOString(),
    sourceHash: `hash-${sessionId}`,
    channels: [],
    signalChunkIds: [],
    hasOximetry: false,
    deleted: false,
    machineSettings: null,
  };
}

/** Episode-shape options for a seeded cached night. */
export interface SeedEpisodeSpec {
  readonly id?: string;
  readonly type?: 'PeriodicBreathing' | 'CheyneStokes';
  readonly confidence?: number;
  readonly cycleLengthSec?: number;
  readonly durationSec?: number;
  readonly modulationDepth?: number;
  readonly cycleCount?: number;
  readonly belowDeviceThreshold?: boolean;
}

/** Options for {@link seedCachedNight}. */
export interface SeedCachedNightOptions {
  readonly sessionId: string;
  readonly date: string;
  /** Pre-computed composite cache id (see {@link currentDetectionId}). */
  readonly detectionId: string;
  /** Episodes to embed in the cached record (empty = analyzed, none found). */
  readonly episodes?: readonly SeedEpisodeSpec[];
}

/**
 * Seed a session AND its `breathing_detections` cache record so the catalog
 * resolves it as an L2 cache hit (reading-cache phase, no compute).
 */
export async function seedCachedNight(page: Page, opts: SeedCachedNightOptions): Promise<void> {
  const start = sessionStartMs(opts.date);
  const episodes = (opts.episodes ?? []).map((e, i) => {
    const durationSec = e.durationSec ?? 300;
    return {
      id: e.id ?? `ep-${opts.sessionId}-${i}`,
      type: e.type ?? 'PeriodicBreathing',
      startMs: start + 60_000 + i * 600_000,
      endMs: start + 60_000 + i * 600_000 + durationSec * 1000,
      durationSec,
      confidence: e.confidence ?? 0.8,
      cycleLengthSec: e.cycleLengthSec ?? 60,
      modulationDepth: e.modulationDepth ?? 0.5,
      cycleCount: e.cycleCount ?? 5,
      belowDeviceThreshold: e.belowDeviceThreshold ?? false,
    };
  });

  await page.evaluate(
    ({ dbName, session, record }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => reject(new Error('open failed'));
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['sessions', 'breathing_detections'], 'readwrite');
          tx.objectStore('sessions').put(session);
          tx.objectStore('breathing_detections').put(record);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('tx failed'));
          };
        };
      });
    },
    {
      dbName: DB_NAME,
      session: sessionRecord(opts.sessionId, opts.date),
      record: {
        id: opts.detectionId,
        sessionId: opts.sessionId,
        date: opts.date,
        algoVersion: 1,
        paramHash: opts.detectionId.split('::')[2],
        episodes,
        recordHours: 7,
        sessionCriterionMet: episodes.some((e) => e.type === 'CheyneStokes'),
        computedAt: new Date().toISOString(),
      },
    },
  );
}

/** Seed only a session row (no cache record, no OPFS) — used for empty/range tests. */
export async function seedSessionOnly(page: Page, sessionId: string, date: string): Promise<void> {
  await page.evaluate(
    ({ dbName, session }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => reject(new Error('open failed'));
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['sessions'], 'readwrite');
          tx.objectStore('sessions').put(session);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(new Error('tx failed'));
        };
      });
    },
    { dbName: DB_NAME, session: sessionRecord(sessionId, date) },
  );
}

/**
 * Seed a session with a minimal OPFS manifest + single Flow chunk but NO cache
 * record. It is a **miss** that enters the compute phase and reaches
 * `pool.submit` (so {@link installHeldWorkerPool} can park it).
 */
export async function seedOpfsMissNight(
  page: Page,
  sessionId: string,
  date: string,
): Promise<void> {
  await seedSessionOnly(page, sessionId, date);
  const start = sessionStartMs(date);
  await page.evaluate(
    async ({ sessionId, start }) => {
      const root = await navigator.storage.getDirectory();
      const app = await root.getDirectoryHandle('cpap-analyzer', { create: true });
      const signals = await app.getDirectoryHandle('signals', { create: true });
      const dir = await signals.getDirectoryHandle(sessionId, { create: true });

      const samples = 600; // 10 min @ 1 Hz envelope
      const flow = new Float32Array(samples);
      for (let i = 0; i < samples; i++) flow[i] = Math.sin((i / 30) * 2 * Math.PI) * 10;

      const chunkFile = 'chunk-000.bin';
      const fh = await dir.getFileHandle(chunkFile, { create: true });
      const ws = await fh.createWritable();
      await ws.write(flow.buffer);
      await ws.close();

      const manifest = {
        version: 1,
        sessionId,
        startTime: start,
        endTime: start + samples * 1000,
        durationSeconds: samples,
        chunkDurationSeconds: 300,
        channels: [
          {
            index: 0,
            name: 'Flow',
            sampleRate: 1,
            unit: 'L/min',
            dtype: 'float32',
            physicalMin: -60,
            physicalMax: 60,
          },
        ],
        chunks: [
          {
            index: 0,
            fileName: chunkFile,
            startTime: start,
            endTime: start + samples * 1000,
            samples: { Flow: samples },
            byteSize: samples * 4,
          },
        ],
      };
      const mh = await dir.getFileHandle('manifest.json', { create: true });
      const mws = await mh.createWritable();
      await mws.write(JSON.stringify(manifest));
      await mws.close();
    },
    { sessionId, start },
  );
}

/**
 * Install a controllable worker-pool stub via the catalog hook's testing seam
 * (`_setCatalogWorkerFactoryForTesting`). Every `pool.submit(...)` parks pending
 * until {@link releaseHeldCompute} is called, holding the run in the `computing`
 * phase deterministically (no sleeps) so Cancel/Resume can be driven.
 *
 * Installed via `addInitScript` so it survives navigation and is registered
 * before the hook module first loads.
 */
export async function installHeldWorkerPool(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __breathingResolvers: Array<() => void>;
      __breathingSeamReady?: boolean;
    };
    w.__breathingResolvers = [];
    w.__breathingSeamReady = false;
    void import('/src/hooks/useBreathingEpisodeCatalog.ts').then((hook) => {
      hook._setCatalogWorkerFactoryForTesting(() => ({
        submit: () =>
          new Promise((resolve) => {
            w.__breathingResolvers.push(() =>
              resolve({ episodes: [], recordHours: 5, sessionCriterionMet: false }),
            );
          }),
        shutdown: () => Promise.resolve(),
      }));
      w.__breathingSeamReady = true;
    });
  });
}

/**
 * Wait until the held worker-pool seam from {@link installHeldWorkerPool} has
 * actually been registered (the dynamic import resolved). Call after the page is
 * on an app document and BEFORE navigating to the catalog, so the hook never
 * falls back to the real WorkerPool. Removes the import-timing race that made
 * Firefox flaky.
 */
export async function waitForHeldWorkerPool(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __breathingSeamReady?: boolean }).__breathingSeamReady === true,
  );
}

/** Resolve every held `pool.submit(...)` promise installed by {@link installHeldWorkerPool}. */
export async function releaseHeldCompute(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __breathingResolvers?: Array<() => void> };
    (w.__breathingResolvers ?? []).forEach((r) => r());
  });
}

/**
 * Navigate to the catalog with the held worker-pool seam guaranteed active, then
 * park the run in `computing` with Cancel visible.
 *
 * Race handled: the seam is installed by an async dynamic import in an
 * `addInitScript`. On a cold module cache the import can lose the race to the
 * hook's first `poolFactory()` call, letting the REAL pool run the seeded OPFS
 * miss to completion before Cancel can be clicked. We detect that (the run
 * reaches a terminal phase with no Cancel) and reload — on the warm module cache
 * the seam install wins. Bounded retries; no arbitrary sleeps (each attempt uses
 * web-first race between the Cancel control and a terminal `[data-phase]`).
 */
export async function gotoCatalogHeld(page: Page, route: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(route);
    await waitForHeldWorkerPool(page);
    const cancel = page.getByRole('button', { name: 'Cancel breathing analysis' });
    try {
      await cancel.waitFor({ state: 'visible', timeout: 5000 });
      return; // Parked in a held computing phase — seam won the race.
    } catch {
      // Seam lost the race (real pool finished the miss) — reload and retry on
      // the now-warm module cache.
    }
  }
  throw new Error('gotoCatalogHeld: catalog never parked in a held computing phase');
}

/**
 * Click a control and assert the catalog status line reaches `expectedPhase`,
 * re-clicking up to a few times if the first click is dropped (Firefox can drop
 * a click that lands mid-React-render). Polls the `[data-phase]` attribute —
 * deterministic, no fixed sleeps.
 */
export async function clickUntilPhase(
  page: Page,
  control: Locator,
  expectedPhase: string,
): Promise<void> {
  const status = page.locator('[data-phase]');
  for (let attempt = 0; attempt < 4; attempt++) {
    await control.click();
    try {
      await expect(status).toHaveAttribute('data-phase', expectedPhase, { timeout: 3000 });
      return;
    } catch {
      if (!(await control.isVisible())) {
        // The control vanished (e.g. Cancel→Resume swap) — the transition may
        // already be in flight; give the phase one more poll before retrying.
        await expect(status).toHaveAttribute('data-phase', expectedPhase, { timeout: 3000 });
        return;
      }
    }
  }
  await expect(status).toHaveAttribute('data-phase', expectedPhase);
}
