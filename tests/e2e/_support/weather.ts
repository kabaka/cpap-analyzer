/**
 * Shared helpers + fixtures for the Weather & Environmental Data integration
 * E2E suite (`weather-integration.spec.ts`).
 *
 * The single most important guarantee of this file is PRIVACY-PRESERVING
 * OFFLINE TESTING: nothing here ever touches the real network. Every Open-Meteo
 * host the app can reach is intercepted with `page.route()` and answered from
 * the canned fixtures below. {@link installOpenMeteoMocks} also records every
 * intercepted request URL so a test can assert on egress (≤2-dp coordinates, no
 * api-key / identifier), and {@link installNetworkGuard} fails the test loudly
 * if ANY request escapes to a real Open-Meteo origin.
 *
 * The fixture JSON shapes mirror exactly what `src/services/weather/parsers.ts`
 * consumes (top-level `hourly`/`daily` objects of parallel arrays, wall-clock
 * `time` strings with no zone offset). The IndexedDB seeding helpers mirror the
 * `cpap-analyzer` schema used by `dashboard.spec.ts`.
 */

import { expect, type Page, type Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Open-Meteo host origins (MUST mirror src/services/weather/OpenMeteoClient.ts)
// ---------------------------------------------------------------------------

export const OPEN_METEO_ORIGINS = {
  archive: 'https://archive-api.open-meteo.com',
  forecast: 'https://api.open-meteo.com',
  airQuality: 'https://air-quality-api.open-meteo.com',
  geocoding: 'https://geocoding-api.open-meteo.com',
} as const;

/** Glob patterns Playwright uses to intercept every Open-Meteo host. */
export const OPEN_METEO_GLOBS = [
  'https://archive-api.open-meteo.com/**',
  'https://api.open-meteo.com/**',
  'https://air-quality-api.open-meteo.com/**',
  'https://geocoding-api.open-meteo.com/**',
] as const;

// ---------------------------------------------------------------------------
// Date helpers (deterministic, today-relative)
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` for N days before today (local time). */
export function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

/** `YYYY-MM-DD` for a Date (local fields). */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The civil date AFTER `date` (`YYYY-MM-DD`). */
export function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return isoDate(d);
}

// ---------------------------------------------------------------------------
// Fixture builders — shapes that src/services/weather/parsers.ts expects.
// ---------------------------------------------------------------------------

/**
 * Build a minimal-but-valid hourly weather payload spanning a single civil
 * `date` (24 hourly samples). Pressure (`pressure_msl`) is the headline clinical
 * variable, so we give it realistic values.
 */
export function makeWeatherResponse(date: string): unknown {
  const times: string[] = [];
  const temp: number[] = [];
  const rh: number[] = [];
  const dew: number[] = [];
  const surf: number[] = [];
  const msl: number[] = [];
  const precip: number[] = [];
  const wind: number[] = [];
  const cloud: number[] = [];
  const code: number[] = [];
  for (let h = 0; h < 24; h++) {
    times.push(`${date}T${String(h).padStart(2, '0')}:00`);
    temp.push(8 + Math.sin(h / 4)); // ~7–9 °C
    rh.push(70 + (h % 5));
    dew.push(3 + Math.cos(h / 4));
    surf.push(1011 + (h % 3));
    msl.push(1013 + (h % 3)); // ~1013–1015 hPa
    precip.push(0);
    wind.push(10 + (h % 4));
    cloud.push(40 + (h % 10));
    code.push(h % 6 === 0 ? 3 : 0);
  }
  return {
    latitude: 40.71,
    longitude: -74.01,
    timezone: 'America/New_York',
    hourly: {
      time: times,
      temperature_2m: temp,
      relative_humidity_2m: rh,
      dewpoint_2m: dew,
      surface_pressure: surf,
      pressure_msl: msl,
      precipitation: precip,
      windspeed_10m: wind,
      cloudcover: cloud,
      weathercode: code,
    },
    daily: {
      time: [date],
      temperature_2m_max: [9.5],
      temperature_2m_min: [6.5],
      temperature_2m_mean: [8.0],
      precipitation_sum: [0],
      windspeed_10m_max: [16],
      weathercode: [3],
    },
  };
}

/**
 * Build a minimal-but-valid hourly air-quality payload for a civil `date`.
 * `usAqi` is pinned in the 51–100 band so the AQI category word resolves to
 * "Moderate" (US AQI bands: 51–100 = Moderate).
 */
export function makeAirQualityResponse(date: string, usAqi = 78): unknown {
  const times: string[] = [];
  const pm25: number[] = [];
  const pm10: number[] = [];
  const ozone: number[] = [];
  const no2: number[] = [];
  const us: number[] = [];
  const eu: number[] = [];
  for (let h = 0; h < 24; h++) {
    times.push(`${date}T${String(h).padStart(2, '0')}:00`);
    pm25.push(12 + (h % 4));
    pm10.push(28 + (h % 5));
    ozone.push(45 + (h % 6));
    no2.push(28 + (h % 4));
    us.push(usAqi);
    eu.push(35 + (h % 5));
  }
  return {
    latitude: 40.71,
    longitude: -74.01,
    timezone: 'America/New_York',
    hourly: {
      time: times,
      pm2_5: pm25,
      pm10,
      ozone,
      nitrogen_dioxide: no2,
      us_aqi: us,
      european_aqi: eu,
    },
  };
}

/** An "empty" weather payload: the provider returned no rows (queried-but-empty). */
export function makeEmptyWeatherResponse(): unknown {
  return {
    latitude: 40.71,
    longitude: -74.01,
    timezone: 'America/New_York',
    hourly: {
      time: [],
      temperature_2m: [],
      relative_humidity_2m: [],
      dewpoint_2m: [],
      surface_pressure: [],
      pressure_msl: [],
      precipitation: [],
      windspeed_10m: [],
      cloudcover: [],
      weathercode: [],
    },
    daily: {
      time: [],
      temperature_2m_max: [],
      temperature_2m_min: [],
      temperature_2m_mean: [],
      precipitation_sum: [],
      windspeed_10m_max: [],
      weathercode: [],
    },
  };
}

/** An "empty" air-quality payload (queried-but-empty). */
export function makeEmptyAirQualityResponse(): unknown {
  return {
    latitude: 40.71,
    longitude: -74.01,
    timezone: 'America/New_York',
    hourly: {
      time: [],
      pm2_5: [],
      pm10: [],
      ozone: [],
      nitrogen_dioxide: [],
      us_aqi: [],
      european_aqi: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Network mocking + egress recording
// ---------------------------------------------------------------------------

export interface OpenMeteoMockOptions {
  /**
   * When true, every weather + air-quality request is answered with the EMPTY
   * payloads (the "no provider data" scenario). Defaults to false (rich data).
   */
  readonly empty?: boolean;
  /** US AQI value to embed in air-quality responses. @default 78 (Moderate). */
  readonly usAqi?: number;
}

export interface OpenMeteoMockHandle {
  /** Every Open-Meteo URL intercepted, in order (for egress assertions). */
  readonly urls: string[];
}

/**
 * Intercept ALL FOUR Open-Meteo hosts and fulfil them from canned fixtures.
 *
 * The request's civil date is parsed out of `start_date` / `end_date` / the
 * forecast `past_days` window so the fixture's `time` arrays line up with the
 * dates the sync service asked for (the parser keys hourly samples by date).
 */
export async function installOpenMeteoMocks(
  page: Page,
  options: OpenMeteoMockOptions = {},
): Promise<OpenMeteoMockHandle> {
  const handle: OpenMeteoMockHandle = { urls: [] };
  const usAqi = options.usAqi ?? 78;

  // Register the broad network GUARD FIRST. Playwright evaluates routes in
  // reverse registration order (most-recently-added wins), so the specific host
  // mocks registered below take precedence, and this catch-all only fires for an
  // Open-Meteo origin/path that no specific mock covered — failing loudly rather
  // than letting a real request escape.
  await installNetworkGuard(page);

  const fulfilWeather = async (route: Route, url: URL) => {
    const dates = datesFromUrl(url);
    const body = options.empty
      ? makeEmptyWeatherResponse()
      : mergeWeather(dates.map(makeWeatherResponse));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  };

  const fulfilAir = async (route: Route, url: URL) => {
    const dates = datesFromUrl(url);
    const body = options.empty
      ? makeEmptyAirQualityResponse()
      : mergeAir(dates.map((d) => makeAirQualityResponse(d, usAqi)));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  };

  // Archive + forecast weather hosts.
  for (const origin of [OPEN_METEO_ORIGINS.archive, OPEN_METEO_ORIGINS.forecast]) {
    await page.route(`${origin}/**`, async (route) => {
      const url = new URL(route.request().url());
      handle.urls.push(url.toString());
      await fulfilWeather(route, url);
    });
  }

  // Air-quality host.
  await page.route(`${OPEN_METEO_ORIGINS.airQuality}/**`, async (route) => {
    const url = new URL(route.request().url());
    handle.urls.push(url.toString());
    await fulfilAir(route, url);
  });

  // Geocoding host (only hit on explicit "Find").
  await page.route(`${OPEN_METEO_ORIGINS.geocoding}/**`, async (route) => {
    const url = new URL(route.request().url());
    handle.urls.push(url.toString());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            name: 'Berlin',
            admin1: 'Berlin',
            country: 'Germany',
            latitude: 52.52,
            longitude: 13.405,
          },
        ],
      }),
    });
  });

  return handle;
}

/**
 * A belt-and-suspenders guard: fail the test if ANY request reaches a real
 * Open-Meteo origin that was somehow not intercepted by a more specific route.
 * Registered AFTER the mocks so the mocks win (Playwright matches the most
 * recently registered route first).
 */
export async function installNetworkGuard(page: Page): Promise<void> {
  await page.route('**://*.open-meteo.com/**', async (route) => {
    // If we get here, a host glob was missed — abort and surface a clear error.
    // eslint-disable-next-line no-console
    console.error(`[network-guard] Un-mocked Open-Meteo request: ${route.request().url()}`);
    await route.abort('blockedbyclient');
  });
}

/** Extract the civil dates a weather/AQ request covers from its query params. */
function datesFromUrl(url: URL): string[] {
  const start = url.searchParams.get('start_date');
  const end = url.searchParams.get('end_date');
  if (start && end) return expandDates(start, end);
  // Forecast endpoint: past_days + forecast_days. We can't know "today" from the
  // URL alone, so fall back to a single placeholder date keyed off the request;
  // the sync service only needs the hourly `time` to be self-consistent. We use
  // today-relative dates so the parser still keys samples sensibly.
  const pastDays = Number(url.searchParams.get('past_days') ?? '1');
  const dates: string[] = [];
  for (let i = pastDays; i >= 0; i--) dates.push(daysAgoStr(i));
  return dates;
}

/** Inclusive list of `YYYY-MM-DD` dates between start and end. */
function expandDates(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  // Guard against runaway loops with a hard cap.
  for (let i = 0; i < 400 && cur <= end; i++) {
    out.push(cur);
    cur = nextDay(cur);
  }
  return out.length > 0 ? out : [start];
}

/** Concatenate several single-date weather payloads into one multi-date payload. */
function mergeWeather(parts: unknown[]): unknown {
  const base = makeEmptyWeatherResponse() as {
    hourly: Record<string, unknown[]>;
    daily: Record<string, unknown[]>;
    [k: string]: unknown;
  };
  for (const p of parts as Array<{
    hourly: Record<string, unknown[]>;
    daily: Record<string, unknown[]>;
  }>) {
    for (const key of Object.keys(p.hourly)) {
      base.hourly[key] = [...(base.hourly[key] ?? []), ...p.hourly[key]];
    }
    for (const key of Object.keys(p.daily)) {
      base.daily[key] = [...(base.daily[key] ?? []), ...p.daily[key]];
    }
  }
  return base;
}

/** Concatenate several single-date air-quality payloads into one payload. */
function mergeAir(parts: unknown[]): unknown {
  const base = makeEmptyAirQualityResponse() as {
    hourly: Record<string, unknown[]>;
    [k: string]: unknown;
  };
  for (const p of parts as Array<{ hourly: Record<string, unknown[]> }>) {
    for (const key of Object.keys(p.hourly)) {
      base.hourly[key] = [...(base.hourly[key] ?? []), ...p.hourly[key]];
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// Settings (Zustand `persist`) seeding via localStorage
// ---------------------------------------------------------------------------

export interface WeatherSettingsSeed {
  readonly enabled?: boolean;
  readonly consentAt?: string | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly label?: string | null;
}

/**
 * Pre-seed the persisted settings store so the weather integration is already
 * enabled + consented + located, letting a test skip the consent gate. Written
 * via `addInitScript` so it lands in `localStorage` BEFORE the app's Zustand
 * `persist` hydrates. Key + version mirror `useSettingsStore` (`cpap-settings`,
 * version 1).
 */
export async function seedWeatherSettings(page: Page, seed: WeatherSettingsSeed): Promise<void> {
  await page.addInitScript((s: WeatherSettingsSeed) => {
    const KEY = 'cpap-settings';
    let parsed: { state?: Record<string, unknown>; version?: number } = {};
    try {
      const existing = localStorage.getItem(KEY);
      if (existing) parsed = JSON.parse(existing) as typeof parsed;
    } catch {
      parsed = {};
    }
    const state = (parsed.state ?? {}) as Record<string, unknown>;
    // Zustand `persist` shallow-merges the persisted `integrations` over the
    // store defaults, REPLACING the whole object — so we must carry the sibling
    // integrations (fitbit, llm) or the Settings view crashes reading them.
    const integrations = (state.integrations ?? {}) as Record<string, unknown>;
    if (!integrations.fitbit) {
      integrations.fitbit = {
        enabled: false,
        visibleDataTypes: [],
        lastImportAt: null,
        recordCount: 0,
      };
    }
    if (!integrations.llm) {
      integrations.llm = {
        enabled: false,
        backend: null,
        consentAt: null,
        consentContractVersion: null,
        webllm: { modelId: null },
        anthropic: { model: 'claude-opus-4-8' },
        openaiCompatible: { baseUrl: null, model: null },
      };
    }
    const weather = (integrations.weather ?? {}) as Record<string, unknown>;

    integrations.weather = {
      // Full default shape so the store hydrates cleanly even on a fresh DB.
      consentAt: null,
      location: { label: null, latitude: null, longitude: null },
      units: { temperature: 'C', pressure: 'hPa', wind: 'kmh', precip: 'mm' },
      domains: { core: true, airQuality: true },
      resolution: 'daily+hourly',
      autoSyncNewImports: false,
      lastSyncAt: null,
      ...weather,
      enabled: s.enabled ?? true,
      ...(s.consentAt !== undefined
        ? { consentAt: s.consentAt }
        : { consentAt: new Date().toISOString() }),
      location: {
        label: s.label ?? null,
        latitude: s.latitude ?? null,
        longitude: s.longitude ?? null,
      },
    };
    state.integrations = integrations;
    localStorage.setItem(KEY, JSON.stringify({ state, version: parsed.version ?? 1 }));
  }, seed);
}

// ---------------------------------------------------------------------------
// CPAP session seeding (so buildSyncNights produces nights to sync)
// ---------------------------------------------------------------------------

const DB_NAME = 'cpap-analyzer';
const MACHINE_ID = 'wx-machine';

/** A midnight-spanning night on `date` (22:00 → 06:00 next civil day). */
export interface SeedSession {
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
}

export function makeNightSession(date: string): SeedSession {
  return {
    date,
    startTime: `${date}T22:00:00`,
    endTime: `${nextDay(date)}T06:00:00`,
  };
}

/** Seed minimal Session + NightlyAggregate records for each date. */
export async function seedSessions(page: Page, dates: readonly string[]): Promise<void> {
  const sessions = dates.map((date, i) => {
    const s = makeNightSession(date);
    return {
      id: `wx-sess-${i}-${date}`,
      machineId: MACHINE_ID,
      machineModel: 'AirSense 11 AutoSet',
      machineType: 'cpap' as const,
      firmwareVersion: '3.0.2',
      date,
      startTime: s.startTime,
      endTime: s.endTime,
      durationMinutes: 480,
      usageMinutes: 420,
      importedAt: new Date().toISOString(),
      sourceHash: `wx-hash-${i}`,
      channels: [],
      signalChunkIds: [],
      hasOximetry: false,
      deleted: false,
      machineSettings: null,
    };
  });

  const aggregates = dates.map((date, i) => ({
    id: `wx-agg-${i}-${date}`,
    sessionId: `wx-sess-${i}-${date}`,
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
  }));

  await page.evaluate(
    ({ dbName, sessions, aggregates }) => {
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(new Error('Failed to open database'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['sessions', 'nightly_aggregates'], 'readwrite');
          for (const s of sessions) tx.objectStore('sessions').put(s);
          for (const a of aggregates) tx.objectStore('nightly_aggregates').put(a);
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
}

/**
 * Assert that every recorded Open-Meteo request URL satisfies the privacy
 * contract: latitude/longitude carry at most 2 decimal places, and no api-key /
 * identifier query parameter is present.
 */
export function assertEgressPrivacy(urls: readonly string[]): void {
  const FORBIDDEN_PARAMS = [
    'apikey',
    'api_key',
    'key',
    'token',
    'client_id',
    'clientid',
    'uid',
    'user',
  ];
  let checkedACoordinate = false;
  for (const raw of urls) {
    const url = new URL(raw);
    for (const param of ['latitude', 'longitude']) {
      const value = url.searchParams.get(param);
      if (value === null) continue;
      checkedACoordinate = true;
      const decimals = value.includes('.') ? value.split('.')[1]!.length : 0;
      expect(decimals, `${param}=${value} in ${raw} exceeds 2 dp`).toBeLessThanOrEqual(2);
    }
    const lowerKeys = [...url.searchParams.keys()].map((k) => k.toLowerCase());
    for (const forbidden of FORBIDDEN_PARAMS) {
      expect(lowerKeys, `forbidden identifier "${forbidden}" present in ${raw}`).not.toContain(
        forbidden,
      );
    }
  }
  expect(checkedACoordinate, 'no coordinate-bearing Open-Meteo request was recorded').toBe(true);
}
