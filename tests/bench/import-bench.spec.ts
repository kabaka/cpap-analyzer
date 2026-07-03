/**
 * Import-parallelization MEASUREMENT harness (Playwright, real Chromium).
 *
 * Runs the THREE bench datasets through the REAL import pipeline in a real
 * browser — real Web Workers (CPAP), real OPFS, real IndexedDB — with the gated
 * profiler enabled, then reads back the published `ImportProfile` and prints a
 * per-dataset table plus the inputs for the decision-gate conclusions.
 *
 * Storage timing must be realistic, hence Playwright/Chromium (not jsdom /
 * fake-indexeddb). Each dataset runs `RUNS` times to gauge variance.
 *
 * The browser-side work lives in a Vite-served module
 * (`src/test/bench/importBenchHarness.ts`) which the spec imports in-page with a
 * single `import()`; this avoids Playwright's function-serialization limits with
 * generator-bearing closures.
 *
 * This is a MEASUREMENT spec, not a pass/fail gate: it asserts only that a
 * profile came back. It is NOT part of the normal e2e matrix (lives under
 * `tests/bench`, run explicitly).
 *
 * Invoke:
 *   npx playwright test --config tests/bench/playwright.bench.config.ts import-bench.spec.ts
 *
 * @module tests/bench/import-bench.spec
 */

import { test, expect } from '@playwright/test';
import { buildManySmallDays, buildFewLargeDays, type BenchDataset } from './datasets';

/** Repetitions per dataset (variance gauge). */
const RUNS = 2;

test.setTimeout(20 * 60 * 1000);

interface WireDataset {
  readonly name: string;
  readonly files: ReadonlyArray<{ readonly relativePath: string; readonly b64: string }>;
}

function toWire(ds: BenchDataset): WireDataset {
  return {
    name: ds.name,
    files: ds.files.map((f) => ({
      relativePath: f.relativePath,
      b64: Buffer.from(f.bytes).toString('base64'),
    })),
  };
}

interface ProfileResult {
  kind: string;
  totalMs: number;
  phases: Record<string, { totalMs: number; count: number }>;
  phasePercent: Record<string, number>;
  pool: {
    poolSize: number;
    samples: number;
    avgBusyFraction: number;
    peakBusy: number;
    timeWeightedBusyFraction: number;
    observedMs: number;
  } | null;
  cpapDayGroups: Array<{
    storeIdbMs: number;
    storeOpfsMs: number;
    opfsChunks: number;
  }>;
  fitbitTypes: Array<{
    dataType: string;
    files: number;
    parseMs: number;
    storeMs: number;
    parseIdleDuringStoreMs: number;
  }>;
  perDayParsedBytes: { max: number; mean: number; p95: number; total: number } | null;
  hardwareConcurrency: number;
}

function fmt(ms: number): string {
  return `${ms.toFixed(0)}ms`;
}

function report(label: string, totalBytes: number, p: ProfileResult): void {
  const phaseKeys = ['scan', 'str', 'parse', 'build', 'validate', 'store'];
  const out: string[] = [];
  out.push(`\n================ ${label} ================`);
  out.push(
    `hw=${p.hardwareConcurrency}  bytes=${(totalBytes / 1e6).toFixed(1)}MB  total=${fmt(p.totalMs)}`,
  );
  out.push('phase          ms          %');
  for (const k of phaseKeys) {
    const ph = p.phases[k];
    if (!ph) continue;
    out.push(
      `  ${k.padEnd(10)} ${fmt(ph.totalMs).padStart(10)}  ${(p.phasePercent[k] ?? 0).toFixed(1).padStart(5)}%`,
    );
  }
  if (p.cpapDayGroups.length > 0) {
    const idb = p.cpapDayGroups.reduce((s, d) => s + d.storeIdbMs, 0);
    const opfs = p.cpapDayGroups.reduce((s, d) => s + d.storeOpfsMs, 0);
    const chunks = p.cpapDayGroups.reduce((s, d) => s + d.opfsChunks, 0);
    out.push(
      `  store(IDB) ${fmt(idb).padStart(10)}  ${((idb / p.totalMs) * 100).toFixed(1).padStart(5)}%`,
    );
    out.push(
      `  store(OPFS)${fmt(opfs).padStart(10)}  ${((opfs / p.totalMs) * 100).toFixed(1).padStart(5)}%  chunks=${chunks}`,
    );
  }
  if (p.pool) {
    out.push(
      `pool: size=${p.pool.poolSize} peakBusy=${p.pool.peakBusy} avgBusy=${p.pool.avgBusyFraction.toFixed(3)} timeWeightedBusy=${p.pool.timeWeightedBusyFraction.toFixed(3)} (samples=${p.pool.samples}, observed=${fmt(p.pool.observedMs)})`,
    );
  }
  if (p.perDayParsedBytes) {
    const b = p.perDayParsedBytes;
    out.push(
      `perDayParsedBytes: max=${(b.max / 1e6).toFixed(2)}MB mean=${(b.mean / 1e6).toFixed(2)}MB p95=${(b.p95 / 1e6).toFixed(2)}MB`,
    );
  }
  for (const f of p.fitbitTypes) {
    out.push(
      `fitbit[${f.dataType}] files=${f.files} parse=${fmt(f.parseMs)} store=${fmt(f.storeMs)} parseIdleDuringStore=${fmt(f.parseIdleDuringStoreMs)}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(out.join('\n'));
}

// NOTE on scale: the CPAP datasets are sized to fit Playwright's CDP
// `page.evaluate` argument budget (~100MB) when their bytes are transferred into
// the page. Per-night (CPAP) and per-file (Fitbit) costs are linear in count, so
// the reduced counts extrapolate cleanly to multi-year imports — the report
// multiplies them out. The Fitbit dataset is generated IN-PAGE (no CDP transfer)
// so it can stay at full per-file resolution and a multi-month file count.
const cpapDatasets: Array<() => BenchDataset> = [
  () => buildManySmallDays(365),
  () => buildFewLargeDays(6, 8),
];

for (const make of cpapDatasets) {
  const ds = make();
  test(`bench: ${ds.name}`, async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const wire = toWire(ds);
    for (let run = 1; run <= RUNS; run++) {
      const profile: ProfileResult = await page.evaluate(async (wire) => {
        const mod = await import('/src/test/bench/importBenchHarness.ts');
        await mod.resetStorage();
        return mod.runImportBench(wire) as unknown as Promise<ProfileResult>;
      }, wire);

      report(`${ds.name} (run ${run}/${RUNS})`, ds.totalBytes, profile);
      expect(profile.totalMs).toBeGreaterThan(0);
    }
  });
}

// Fitbit: generated in-page to avoid the CDP transfer limit. 150 daily intraday
// files × ~17k samples (≈5 months); the serial per-file parse→store cost is
// linear in file count, so this extrapolates to multi-year.
const FITBIT_DAYS = 150;
const FITBIT_SAMPLES = 17280;
test('bench: fitbit-intraday-hr', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  for (let run = 1; run <= RUNS; run++) {
    const profile: ProfileResult = await page.evaluate(
      async ({ days, samples }) => {
        const mod = await import('/src/test/bench/importBenchHarness.ts');
        await mod.resetStorage();
        return mod.runFitbitBenchInPage(days, samples) as unknown as Promise<ProfileResult>;
      },
      { days: FITBIT_DAYS, samples: FITBIT_SAMPLES },
    );
    // Approx total bytes for the report header.
    const approxBytes = FITBIT_DAYS * FITBIT_SAMPLES * 56;
    report(`fitbit-intraday-hr (run ${run}/${RUNS})`, approxBytes, profile);
    expect(profile.totalMs).toBeGreaterThan(0);
  }
});
