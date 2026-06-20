# Weather & Environmental Data Integration — Design Reference

> **Status:** Approved for implementation (v1). This is the single source of
> truth for the weather integration. Decisions here were made by the product
> owner. See ADR
> [0022](../decisions/0022-weather-environmental-data-integration.md) for the
> architectural record and the UX specification (Section 6) for interaction
> detail.

## 1. Summary

Add an **opt-in** integration that fetches local **weather** and **air-quality**
data from **Open-Meteo** and correlates it with CPAP therapy metrics. This is the
**first feature in the application that makes an outbound network request** — every
design choice is biased toward making that egress explicit, minimal, auditable, and
revocable, in service of Core Principle #1 (Privacy).

## 2. Product decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Provider | **Open-Meteo**, live API, **keyless / no account** |
| 2 | Enablement | **Opt-in, off by default**; two-gate consent (toggle → disclosure) |
| 3 | Location model | **Single configurable location** for v1; schema **forward-compatible** with per-night/travel-aware later (nullable per-record location field falling back to the global one) |
| 4 | Data domains | **Core weather + air quality.** Pollen **deferred** (see §3) |
| 5 | Resolution | **Daily summaries + hourly series** (hourly powers the Signal-Viewer ribbon) |
| 6 | Coordinate precision | Round to **2 decimal places (~1.1 km)** *before every request*; never send GPS-precise coordinates |
| 7 | On disable | **Keep** stored weather data; prompt with "Keep" defaulted (offer Delete) |
| 8 | City names | **Allowed** via Open-Meteo geocoding, **explicitly disclosed** as an extra network call; coordinates remain the canonical stored value |

## 3. Pollen is deferred (correctness, not an oversight)

Open-Meteo pollen is **forecast-only (≈4 days ahead), Europe-only, with no
historical archive**. CPAP analysis is retrospective (often years), so pollen
could not be backfilled for any past night and would render as permanent "no
data." Surfacing it would risk **misleading** a user into concluding pollen does
not affect their therapy when the truth is the data never existed (Correctness >
Features). **v1 ships without pollen**, but the `pollen` storage `source` and the
data model remain reserved so a future historical-capable (keyed) provider can add
it without migration.

## 4. Open-Meteo API facts (verified against live docs, 2026-06)

All endpoints are **keyless** and accept `latitude`, `longitude`, and a `timezone`
parameter (use the session's IANA zone, or `auto`). Coordinates MUST be rounded to
2 dp before the request.

### 4.1 Hosts to whitelist in CSP (`connect-src`) — and ONLY these
- `https://archive-api.open-meteo.com` — historical weather (ERA5 reanalysis, back to **1940**). Endpoint `/v1/archive`. **Lags ~5 days** behind today.
- `https://api.open-meteo.com` — forecast API with `past_days` (up to 92) for **recent** nights the archive has not yet covered. Endpoint `/v1/forecast`.
- `https://air-quality-api.open-meteo.com` — air quality. Endpoint `/v1/air-quality`. Historical via CAMS reanalysis (Europe back to ~2013; global more recent, ~2022–23). Supports `start_date`/`end_date` and `past_days` (≤92).
- `https://geocoding-api.open-meteo.com` — city search / labeling. Endpoint `/v1/search`. Used **only** on an explicit user "Find" / reverse-label action (disclosed).

> **Archive-vs-forecast routing rule:** for a requested night's date, use
> `archive-api` when `date ≤ today − 5 days`, otherwise use `api.open-meteo.com`
> `/v1/forecast` with `past_days`. The boundary must be a single shared constant.
> A night spanning two civil dates fetches **both** dates and merges (mirror the
> wearable lanes' neighbour-day merge).

### 4.2 Variables to request (store SI/metric internally; convert at display)

**Weather — hourly** (`temperature_2m`, `relative_humidity_2m`, `dewpoint_2m`,
`surface_pressure`, `pressure_msl`, `precipitation`, `windspeed_10m`,
`cloudcover`, `weathercode`). **Weather — daily** (`temperature_2m_max`,
`temperature_2m_min`, `temperature_2m_mean`, `precipitation_sum`,
`windspeed_10m_max`, `weathercode`). Barometric pressure (`pressure_msl`) is the
**headline clinical variable** (pressure swings vs. apnea/central events).

**Air quality — hourly** (`pm2_5`, `pm10`, `ozone`, `nitrogen_dioxide`,
`us_aqi`, `european_aqi`). Daily aggregates are derived locally (we compute the
overnight statistic; the AQ endpoint is hourly).

## 5. Privacy & consent contract

**What leaves the device, per sync:** rounded coordinates (≤2 dp) + the chosen
calendar dates + (only on explicit Find) a typed city string. **What never
leaves:** any therapy/health data, any identifier (there is none — no account, no
key), precise GPS. Enabling requires an explicit consent dialog stating exactly
this; a `consentAt` timestamp is persisted so a future change to *what is sent*
can re-prompt. CSP is relaxed from `connect-src 'self'` to additionally allow the
four hosts in §4.1 — never wildcards. Responses are cached in IndexedDB; "queried
but empty" is stored distinctly from "not fetched" so surfaces show "—", never a
fabricated zero. Disabling stops all requests; auto-sync of newly imported nights
is a separate opt-in, off by default.

## 6. Data model & storage

Reuse existing IndexedDB integration stores (no migration):
`integration_data` (daily, `source: 'weather'`), `integration_timeseries`
(hourly), `integration_import_history`. Confirm the exact store names and access
methods in `src/services/storage/IndexedDBService.ts` before writing.

- `src/types/weather.ts` (new): `WeatherDaily`, `WeatherHourly`, `AirQualityDaily`,
  `AirQualityHourly`. Each record carries a nullable `location` object
  (`{ label, latitude, longitude }`) for forward-compat; absence falls back to the
  global configured location.
- Aggregation must define **one canonical "overnight" window** shared by the
  dashboard panel, the ribbon, and the correlation surface, so a metric never
  shows three different "last-night humidity" numbers.

### Settings shape (`src/types/settings.ts` → `IntegrationConfig.weather`)
Replace the current `{ enabled, apiKey, location: string }` (drop `apiKey` — there
is no key) with:

```ts
weather: {
  enabled: boolean;
  consentAt: string | null;            // ISO; two-gate consent acknowledgement
  location: { label: string | null; latitude: number | null; longitude: number | null };
  units: { temperature: 'C' | 'F'; pressure: 'hPa' | 'inHg'; wind: 'kmh' | 'mph' | 'ms'; precip: 'mm' | 'in' };
  domains: { core: boolean; airQuality: boolean };  // pollen deferred
  resolution: 'daily' | 'daily+hourly';
  autoSyncNewImports: boolean;         // default false
  lastSyncAt: string | null;
}
```

Removing `apiKey` touches the Zustand `persist` migration — include a lightweight
settings migration.

## 7. Implementation approach

A **first-party service module** (mirroring
`src/services/import/googlehealth/GoogleHealthImportService.ts`), **not** the
deferred runtime plugin registry (per ADR 0007 / Phase-11). Suggested layout:

- `src/types/weather.ts` — record & payload types.
- `src/services/weather/OpenMeteoClient.ts` — fetch with coordinate rounding,
  archive/forecast routing, timeout, retry with exponential backoff, HTTP-429
  rate-limit pause/resume, offline detection.
- `src/services/weather/WeatherSyncService.ts` — orchestrates scope → fetch →
  parse → dedupe → batched IndexedDB store, emitting import-style progress.
- `src/services/weather/parsers.ts` — Open-Meteo JSON → typed records.
- `src/analysis/weather/` — overnight aggregation, unit conversions, AQI category
  mapping (US/European bands → label words). Pure, unit-tested.
- `src/hooks/useWeatherData.ts` — date-range daily fetch (parallels
  `useWearableData`); join extension for correlations.
- UI: `src/views/Dashboard/panels/WeatherOverview.tsx`; Settings → Integrations
  (de-stub the weather accordion, consent dialog, config, geolocation, sync sheet);
  `WEATHER_LANE_SPECS` in the Signal Viewer; grouped "Compare against" selector in
  `src/views/Explore/IntegrationAnalysis.tsx`.

## 8. Surfaces (from the UX spec)

1. **Settings → Integrations:** de-stub the weather accordion; two-gate consent
   dialog; location entry (manual lat/lon + city Find + one-time "use current
   location" geolocation with full error mapping); unit prefs; domain checkboxes;
   resolution; **Sync now** + coverage details; auto-sync toggle (off).
2. **Sync flow:** lightweight dialog reusing the import-progress chrome
   (`role="progressbar"`, `aria-live`, staged labels); scope step shows the exact
   night count + egress reminder before any request; offline/429/partial states;
   a coverage view distinguishing Synced / Missing / No-provider-data / Failed.
3. **Dashboard `WeatherOverview` panel:** 6 headline tiles (overnight-low temp,
   humidity, **barometric pressure**, AQI with category word, dewpoint/wind, +1)
   with 7-day trends. **Neutral** trend polarity for non-judgmental metrics
   (temp/humidity/pressure/dewpoint/wind); **favourable/unfavourable** only for AQI
   (lower better). Requires extending `TrendIndicator` with a neutral mode. Not
   rendered when disabled; CTA card when enabled-but-unsynced.
4. **Signal Viewer:** a `'weather'` lane group with toggleable lanes — a conditions
   ribbon, a pressure/temperature line lane, and an AQI ribbon — aligned to
   wall-clock recording hours via the existing `sessionWallClockEpoch` mechanism;
   auto-hidden when no data. Keyboard data-cursor announces weather values
   (required non-visual path); AQI severity conveyed by **label + value + pattern**,
   never colour alone. New "Environment focus" lane preset.
5. **Cross-Source Analysis:** extend the join to carry weather daily summaries; add
   a `WEATHER_METRICS` array; generalize the right selector to a grouped "Compare
   against" (Wearable / Weather & Environment). Existing correlation, Bland-Altman,
   and **lagged cross-correlation** math is reused unchanged (lagged CCF is
   especially apt: a pressure drop may precede a bad-AHI night). Add a "weather
   days" availability stat.

## 9. Accessibility (WCAG AA, non-negotiable)

Consent dialog focus-trap with Esc-cancels-and-reverts; geolocation errors as
`role="alert"` with focus moved to manual entry; progress live-region throttled
(announce on stage change / ~10%, not per night); ribbon exposed via real HTML
lane headers, `role="img"` band labels, and the keyboard-cursor readout; AQI
severity encoded redundantly (word + number + pattern), never colour alone.

## 10. Out of scope for v1

Pollen (§3); per-night/travel-aware location (schema is ready, UI is not); keyed
providers; auto-fetch on load or navigation (all fetching is user-initiated or an
explicit auto-sync-on-import opt-in).
