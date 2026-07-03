/**
 * Shared helpers + fixtures for the AI Insights integration E2E suite
 * (`ai-insights.spec.ts`).
 *
 * Like the weather helper, the single most important guarantee here is
 * PRIVACY-PRESERVING OFFLINE TESTING: nothing in this suite is allowed to reach
 * a real LLM provider. Real model inference (WebLLM/WebGPU, Chrome built-in AI,
 * Anthropic, OpenAI-compatible) is NOT exercised — every test asserts the
 * UI / consent / privacy / accessibility behaviour that precedes and gates any
 * generation. {@link installLLMNetworkGuard} fails the test loudly if any
 * request ever escapes to a known cloud-LLM origin.
 *
 * The settings-seeding helper mirrors {@link seedWeatherSettings} in `weather.ts`:
 * it writes the persisted Zustand `cpap-settings` blob into `localStorage` via
 * `addInitScript` BEFORE the app hydrates, so a test can land on a fully-enabled
 * (or specifically-configured) AI Insights state without clicking through the
 * settings panel. The session/aggregate seeding reuses the same `cpap-analyzer`
 * IndexedDB schema as `dashboard.spec.ts` so the in-app InsightTrigger surfaces
 * render (they require a loaded aggregate).
 */

import { expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Cloud-LLM origins that MUST never be contacted in this suite.
// ---------------------------------------------------------------------------

/**
 * Glob patterns covering the cloud-LLM origins the app could reach. The network
 * guard aborts any request matching these — no test in this suite should ever
 * trigger real generation, so a hit is a bug worth failing on.
 */
export const LLM_CLOUD_GLOBS = [
  'https://api.anthropic.com/**',
  'https://api.openai.com/**',
] as const;

/**
 * Belt-and-suspenders guard: fail the test if ANY request reaches a real
 * cloud-LLM origin. Tests in this suite stop before generation (idle drawer,
 * consent gate, needs-config error), so nothing should egress; if something
 * does, abort and surface a clear console error.
 */
export async function installLLMNetworkGuard(page: Page): Promise<void> {
  for (const glob of LLM_CLOUD_GLOBS) {
    await page.route(glob, async (route) => {
      // eslint-disable-next-line no-console
      console.error(`[llm-network-guard] Un-expected cloud-LLM request: ${route.request().url()}`);
      await route.abort('blockedbyclient');
    });
  }
}

// ---------------------------------------------------------------------------
// Date helpers (deterministic, today-relative)
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` for N days before today (local time). */
export function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The civil date AFTER `date` (`YYYY-MM-DD`). */
export function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Settings (Zustand `persist`) seeding via localStorage
// ---------------------------------------------------------------------------

/**
 * The mutable slice of the persisted `integrations.llm` settings a test may want
 * to pin. Defaults mirror the store's off-by-default shape; only what a test
 * passes is overridden. Note: API keys are NOT persisted (they live in the
 * session-scoped credential store), so they cannot be seeded here — a test that
 * needs a "no key" cloud state simply enables a cloud backend without a key,
 * which is the real "needs config" scenario.
 */
export interface AiInsightsSettingsSeed {
  readonly enabled?: boolean;
  readonly backend?: 'webllm' | 'chrome-ai' | 'anthropic' | 'openai-compatible' | null;
  readonly consentAt?: string | null;
  readonly consentContractVersion?: number | null;
  readonly webllmModelId?: string | null;
  readonly anthropicModel?: string;
  readonly openaiBaseUrl?: string | null;
  readonly openaiModel?: string | null;
}

/**
 * Pre-seed the persisted settings store so AI Insights is in a chosen state
 * (typically `enabled` with an on-device backend) before the app hydrates.
 *
 * Written via `addInitScript` so it lands in `localStorage` BEFORE the app's
 * Zustand `persist` hydrates. Key + version mirror `useSettingsStore`
 * (`cpap-settings`, version 1). Because `persist` shallow-merges the persisted
 * `integrations` over the defaults (replacing the whole object), we carry the
 * sibling integrations (fitbit, weather) too or the Settings view crashes
 * reading them — exactly as {@link seedWeatherSettings} does.
 */
export async function seedAiInsightsSettings(
  page: Page,
  seed: AiInsightsSettingsSeed = {},
): Promise<void> {
  await page.addInitScript((s: AiInsightsSettingsSeed) => {
    const KEY = 'cpap-settings';
    let parsed: { state?: Record<string, unknown>; version?: number } = {};
    try {
      const existing = localStorage.getItem(KEY);
      if (existing) parsed = JSON.parse(existing) as typeof parsed;
    } catch {
      parsed = {};
    }
    const state = (parsed.state ?? {}) as Record<string, unknown>;
    const integrations = (state.integrations ?? {}) as Record<string, unknown>;

    // Carry siblings so the persisted blob is a complete `integrations` object.
    if (!integrations.fitbit) {
      integrations.fitbit = {
        enabled: false,
        visibleDataTypes: [],
        lastImportAt: null,
        recordCount: 0,
      };
    }
    if (!integrations.weather) {
      integrations.weather = {
        enabled: false,
        consentAt: null,
        location: { label: null, latitude: null, longitude: null },
        units: { temperature: 'C', pressure: 'hPa', wind: 'kmh', precip: 'mm' },
        domains: { core: true, airQuality: true },
        resolution: 'daily+hourly',
        autoSyncNewImports: false,
        lastSyncAt: null,
      };
    }

    const llm = (integrations.llm ?? {}) as Record<string, unknown>;
    integrations.llm = {
      // Full default shape so the store hydrates cleanly on a fresh DB.
      enabled: false,
      backend: null,
      consentAt: null,
      consentContractVersion: null,
      webllm: { modelId: null },
      anthropic: { model: 'claude-opus-4-8' },
      openaiCompatible: { baseUrl: null, model: null },
      ...llm,
      // Apply the seed overrides.
      ...(s.enabled !== undefined ? { enabled: s.enabled } : {}),
      ...(s.backend !== undefined ? { backend: s.backend } : {}),
      ...(s.consentAt !== undefined ? { consentAt: s.consentAt } : {}),
      ...(s.consentContractVersion !== undefined
        ? { consentContractVersion: s.consentContractVersion }
        : {}),
      ...(s.webllmModelId !== undefined ? { webllm: { modelId: s.webllmModelId } } : {}),
      ...(s.anthropicModel !== undefined ? { anthropic: { model: s.anthropicModel } } : {}),
      ...(s.openaiBaseUrl !== undefined || s.openaiModel !== undefined
        ? {
            openaiCompatible: {
              baseUrl: s.openaiBaseUrl ?? null,
              model: s.openaiModel ?? null,
            },
          }
        : {}),
    };

    state.integrations = integrations;
    // Pin the CURRENT persisted version (2). Writing an older version would make
    // the store run `migrateSettings`, whose v1 → v2 step force-resets the llm
    // integration to `enabled: false` (ADR 0024) — wiping the seeded state. We
    // write the already-current shape, so no migration must run.
    localStorage.setItem(KEY, JSON.stringify({ state, version: parsed.version ?? 2 }));
  }, seed);
}

// ---------------------------------------------------------------------------
// CPAP session seeding (so the in-app InsightTrigger surfaces render)
// ---------------------------------------------------------------------------

const DB_NAME = 'cpap-analyzer';
const MACHINE_ID = 'ai-machine';

/** Build a minimal Session record for `date` (id is stable + caller-supplied). */
function makeSession(id: string, date: string) {
  return {
    id,
    machineId: MACHINE_ID,
    machineModel: 'AirSense 11 AutoSet',
    machineType: 'cpap' as const,
    firmwareVersion: '3.0.2',
    date,
    startTime: `${date}T22:00:00`,
    endTime: `${nextDay(date)}T06:00:00`,
    durationMinutes: 480,
    usageMinutes: 420,
    importedAt: new Date().toISOString(),
    sourceHash: `ai-hash-${id}`,
    channels: [],
    signalChunkIds: [],
    hasOximetry: false,
    deleted: false,
    machineSettings: null,
  };
}

/** Build a minimal NightlyAggregate record for `sessionId`/`date`. */
function makeAggregate(id: string, sessionId: string, date: string) {
  return {
    id,
    sessionId,
    machineId: MACHINE_ID,
    date,
    ahi: 3.2,
    ahiObstructive: 1.0,
    ahiCentral: 0.5,
    ahiMixed: 0.2,
    ahiHypopnea: 1.5,
    ahiRera: 0,
    eventCount: 12,
    eventsByType: {
      obstructive: 4,
      central: 2,
      mixed: 1,
      hypopnea: 5,
      rera: 0,
      flowLimitation: 0,
      largeLeak: 0,
      periodicBreathing: 0,
    },
    pressureMean: 10.5,
    pressureMedian: 10.0,
    pressureP95: 12.5,
    pressureMax: 14.0,
    epapMedian: null,
    ipapMedian: null,
    pressureSupport: null,
    leakMedian: 4.5,
    leakP95: 12.0,
    leakMax: 25.0,
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
    usageHours: 7.0,
    maskOnTimeMinutes: 420,
    complianceStatus: 'compliant' as const,
    configuredMinPressure: null,
    configuredMaxPressure: null,
    eprLevel: null,
    notes: '',
    tags: [],
  };
}

/** A seeded session id a test can navigate to for the session-detail flow. */
export const SEEDED_SESSION_ID = 'ai-sess-0';

/**
 * Load the app (creating the DB schema), inject a small set of nights, then
 * reload so the dashboard/session hooks re-fetch and the InsightTrigger
 * surfaces render. Returns the seeded dates (most-recent first).
 */
export async function seedSessions(page: Page, count = 3): Promise<string[]> {
  const dates = Array.from({ length: count }, (_, i) => daysAgoStr(i + 1));
  const sessions = dates.map((date, i) => makeSession(`ai-sess-${i}`, date));
  const aggregates = dates.map((date, i) => makeAggregate(`ai-agg-${i}`, `ai-sess-${i}`, date));

  await page.evaluate(
    ({ dbName, sessions, aggregates }) => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(new Error('Failed to open database'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['sessions', 'nightly_aggregates'], 'readwrite');
          for (const session of sessions) tx.objectStore('sessions').put(session);
          for (const aggregate of aggregates) tx.objectStore('nightly_aggregates').put(aggregate);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Transaction failed'));
          };
        };
      });
    },
    { dbName: DB_NAME, sessions, aggregates },
  );

  return dates;
}

/**
 * Assert the privacy guarantee for this suite: NO cloud-LLM request was ever
 * recorded. Pair with {@link installLLMNetworkGuard}, which aborts any such
 * request; this is the positive assertion that the test stayed offline.
 */
export function assertNoLLMEgress(requestedUrls: readonly string[]): void {
  const offenders = requestedUrls.filter(
    (u) => u.includes('api.anthropic.com') || u.includes('api.openai.com'),
  );
  expect(offenders, `cloud-LLM egress occurred: ${offenders.join(', ')}`).toHaveLength(0);
}
