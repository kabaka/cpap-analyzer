# 0022 — Weather & Environmental Data Integration via Open-Meteo (First Live External Fetch)

## Status

Accepted

## Context

CPAP therapy outcomes are influenced by the patient's environment. Barometric
pressure swings, humidity, dewpoint, ambient temperature, air quality (PM2.5/PM10,
ozone, NO₂), and pollen are all clinically plausible modifiers of respiratory events,
nasal congestion, mask leak, and sleep quality. Of these, **barometric pressure is the
most clinically interesting**: pressure transitions correlate with shifts in apnea and
central-event frequency, and this is the kind of cross-source signal the app is meant to
surface. Today the app has rich nightly and intra-night CPAP data but no environmental
context to correlate it against.

This feature introduces that context. It also crosses a line the project has never
crossed before, which is what makes it architecturally significant rather than a routine
feature.

**The privacy line.** Privacy is the #1 core principle: "No data leaves the user's
browser." Until now the app has honored this absolutely — there are **zero external
network calls**. The build-injected Content-Security-Policy (`src/buildtime/csp.ts`) pins
`connect-src 'self'`, so the browser itself blocks any outbound request. The existing
"integrations" (Fitbit / Google Health) are **local file imports** (Google Takeout
exports parsed in-browser, e.g. `GoogleHealthImportService.ts`); they never touch the
network. Weather data, by contrast, is not something the user has on disk — it must be
fetched from a remote service. **This is therefore the first feature that makes a live
external network request**, and the first time `connect-src` must be relaxed beyond
`'self'`. The decision must confront that tension directly rather than treat it as an
incidental config change.

**What an external fetch leaks.** To retrieve historical weather for a night, the request
must carry the user's **location (lat/lon) and the dates** of interest. Location + dates
is sensitive: it reveals where the user was sleeping on specific nights. There is no way
to fetch location-specific weather without disclosing location to *someone*. The design
goal is to minimize that disclosure — both what is sent and who receives it — and to make
the whole thing opt-in, transparent, and off by default.

**Constraints shaping the choice:**

- Client-side only ([0001](0001-client-side-architecture.md)); no backend to proxy or
  anonymize requests, so the third party sees the browser's IP directly.
- Zero telemetry ([0015](0015-zero-telemetry-analytics.md)) established the precedent that
  network access is allowed *only* for explicit, user-permitted integrations, with a
  whitelisted domain policy. This feature is the first concrete exercise of that carve-out.
- CPAP analysis is **retrospective**: users import months or years of past data, so the
  weather provider must expose a real **historical archive**, not just a current-conditions
  / short-forecast API.
- The app currently has **no concept of location or timezone**. This feature must introduce
  one without painting future location work (travel, per-night location) into a migration
  corner.
- Correctness is the #2 principle: units must be unambiguous and historical data must align
  to the correct local calendar night.

**Provider alternatives considered:**

- **Open-Meteo (chosen).** Keyless, no account, free, privacy-friendly. Requests carry only
  lat/lon + date — nothing identifying the user, no API key tying requests to an account.
  Provides a dedicated **historical archive API** (`archive-api.open-meteo.com`) covering
  past decades, plus a keyless **Air Quality API** (`air-quality-api.open-meteo.com`) and a
  keyless **pollen** endpoint, all in one provider family. Returns both daily aggregates and
  hourly series in a single request.
- **OpenWeatherMap / WeatherAPI (rejected).** Require an API key and an account. The key is a
  per-user credential that ties every request to an identity, and creating it requires
  handing personal details to the provider — a strictly heavier privacy footprint. Historical
  data is frequently paywalled or rate-restricted on free tiers.
- **NOAA / NWS (rejected).** Good, free, authoritative — but US-only. The audience is global.
- **Offline file-import only (deferred, not rejected outright).** Maximum privacy: the user
  downloads weather data themselves and imports a file, exactly like Fitbit/Google Health,
  with **no** network call and **no** CSP change. Rejected for v1 because no consumer-friendly
  per-location historical weather export exists; it would be tedious and error-prone for users.
  Retained as a **possible future extension** for the privacy-maximalist user, and as a
  fallback if Open-Meteo's terms or availability change.

This decision relates to [0007](0007-plugin-architecture.md) (which named "weather APIs" as a
future *integration plugin*), [0015](0015-zero-telemetry-analytics.md) (network policy and the
opt-in carve-out), and [0005](0005-dual-storage-indexeddb-opfs.md) /
[0016](0016-session-identity-non-unique-machine-date-index.md) (the integration storage schema).

## Decision

Integrate **Open-Meteo** as the v1 weather and environmental data provider, via a **live,
opt-in, off-by-default** fetch, stored and correlated through the existing integration
schema. Five sub-decisions:

**1. Provider: Open-Meteo, live API, keyless.**
Use three Open-Meteo endpoints: the **historical archive** (`archive-api.open-meteo.com`) for
past nights, the **Air Quality API** (`air-quality-api.open-meteo.com`) for AQI/PM/ozone/NO₂,
and the keyless **pollen** endpoint. No API key, no account, no per-user credential. Requests
carry only coordinates and a date range. This is the minimal-disclosure option among providers
that meet the retrospective requirement.

**2. Live fetch, opt-in, off by default; CSP relaxed minimally.**
The integration ships **disabled**. Enabling it requires explicit user action through a consent
flow that discloses, in plain language, **exactly what is sent** (the configured coordinates and
the date ranges being looked up) and **to whom** (Open-Meteo, named, with its hosts shown). Only
on enablement may requests go out. The build-injected CSP (`src/buildtime/csp.ts`) is extended
to add **only** the three Open-Meteo hosts to `connect-src`:

```
connect-src 'self'
  https://archive-api.open-meteo.com
  https://air-quality-api.open-meteo.com
  https://air-quality-api.open-meteo.com;   # pollen shares the air-quality host family
```

(The exact host list is whitelisted to the specific Open-Meteo subdomains used — never a
wildcard.) Responses are **cached in IndexedDB** keyed by location + date so a given night is
fetched at most once, which both respects Open-Meteo's rate limits and means re-opening the app
makes no new requests for already-seen nights.

**3. Location model: single configurable location for v1, schema forward-compatible with
per-night / travel-aware location.**
Introduce a single, user-configurable location: manual **lat/lon or city** entry, with an
**optional one-time browser Geolocation button** to populate it (the Geolocation prompt is
itself opt-in and used only to fill the field — coordinates are never auto-sent anywhere).
Crucially, the stored weather records carry a **nullable per-record location field that falls
back to the global location when absent**. v1 only ever writes the global location, but encoding
the field now means a future "travel-aware" / per-night location feature can populate it
**without a schema migration**. This deliberately front-loads one nullable field to avoid a
later migration on the integration stores.

The privacy implication is recorded explicitly: location + dates discloses *where the user slept
on which nights*. The single-location model keeps disclosure coarse (one home location) for v1;
per-night location, when added, would increase resolution of that disclosure and must ship with
its own consent review.

**4. Scope: core weather + air quality + pollen.**
Core weather — temperature, relative humidity, **dewpoint**, **barometric pressure**,
precipitation, wind, cloud cover, UV. Air quality — AQI, PM2.5, PM10, ozone, NO₂. Pollen.
Barometric pressure is treated as the headline variable for correlation against apnea / central
events.

**5. Resolution: daily aggregates + hourly series (one request returns both).**
**Daily** aggregates drive a dashboard panel and date-keyed cross-source correlation. **Hourly**
series enable a weather-ribbon overlay in the Signal Viewer aligned to actual recording hours.
Open-Meteo returns both in a single response, so no extra request cost.

**Implementation approach — first-party service module, not the runtime plugin registry.**
Although [0007](0007-plugin-architecture.md) named weather as a future *integration plugin*, the
runtime plugin registry remains **deferred** (the Phase-11 plugin evaluation; cf. the
ADR-0007 follow-up). This feature is therefore built as a **first-party service module**, mirroring
`src/services/import/googlehealth/GoogleHealthImportService.ts`: a framework-agnostic class with
the IndexedDB service injected for testability, that fetches, normalizes, caches, and stores
weather. This keeps the feature shippable now and avoids prematurely committing to a plugin API
surface; it can be repackaged as an integration plugin later when the registry lands.

**Storage — reuse the existing integration stores; no migration.**
The integration schema already models exactly this. The real IndexedDB store names (per
`IndexedDBService.ts`) are:

- **`integration_data`** — typed daily summaries (`IntegrationDailySummary`).
- **`integration_timeseries`** — intra-night hourly series (`IntegrationTimeseries`).
- **`integration_import_history`** — fetch/import audit records (`IntegrationImportRecord`).

The `IntegrationSource` union in `src/types/storage.ts` already includes `'weather'` and
`'pollen'`. Daily weather and air-quality data are written to `integration_data` with
`source: 'weather'`; pollen uses `source: 'pollen'`; hourly weather goes to
`integration_timeseries`. Records are keyed by `YYYY-MM-DD` local date, exactly like Fitbit data,
so cross-source correlation is a date-keyed join already supported by the stores' indexes.
**No schema migration is expected** — only the addition of the nullable location field inside the
source-specific `data` payload (which is typed `unknown` per source and needs no DDL change).

**Timezone handling.**
Open-Meteo can return data in the **location's local time**. Request it that way and align both
daily and hourly weather to the **session's local calendar date** — sessions are keyed
`YYYY-MM-DD` in local time ([0016](0016-session-identity-non-unique-machine-date-index.md)), so a
weather night must use the same local-day bucket to line up with the right CPAP night. This is the
first place the app reasons about timezones, and it must do so consistently with session keying.

**Units.**
Store **SI / metric internally** (°C, hPa, m/s, µg/m³) as the single canonical representation;
**convert for display** per the user's unit preferences. Never store display-converted values, so
that correlation math and re-export are unambiguous.

## Consequences

### Positive

- **First real environmental context for therapy data**, with barometric pressure available to
  correlate against apnea/central events — a genuinely novel analysis axis.
- **Minimal privacy footprint for a network feature.** Open-Meteo needs no account and no API key,
  so requests carry no user-identifying credential — only coordinates and dates. Among providers
  that meet the historical requirement, this is the least-disclosing option.
- **Opt-in, off by default, with explicit disclosure.** The default posture preserves the
  zero-external-call guarantee for every user who does nothing. Those who enable it see exactly
  what is sent and to whom.
- **Tightly scoped CSP change.** `connect-src` gains only the specific Open-Meteo hosts, never a
  wildcard; the same-origin lockdown is otherwise intact and remains regression-testable.
- **No schema migration.** Reuses `integration_data` / `integration_timeseries` /
  `integration_import_history` with existing `'weather'` / `'pollen'` sources; date-keyed
  correlation works out of the box.
- **Forward-compatible location model.** The nullable per-record location field means travel-aware
  / per-night location can ship later with no migration.
- **Caching respects the provider and the user.** IndexedDB caching means each night is fetched at
  most once; re-opening the app issues no new requests for known nights.
- **Shippable without the plugin registry**, by following the proven first-party-service pattern;
  re-pluginizable later.

### Negative

- **It crosses the never-crossed line.** This is the first feature that sends *any* data off the
  device. Even minimized to coordinates + dates, location + dates is sensitive (it reveals where
  the user slept on given nights), and Open-Meteo necessarily sees the request's source IP. The
  zero-external-call invariant is now conditional on a user setting rather than absolute.
- **CSP is no longer `connect-src 'self'`.** The strongest possible network lockdown is relaxed
  (only when the feature exists in the build), enlarging the policy surface that must be audited
  and kept from drifting toward wildcards.
- **New failure modes the app never had.** Offline use, Open-Meteo outages/5xx, rate-limiting,
  schema/endpoint changes on the provider's side, and partial/missing historical coverage for some
  locations or dates. The UI must degrade gracefully (missing weather is normal, not an error) and
  never block CPAP analysis on weather availability.
- **Third-party dependency and trust.** Correctness now partly depends on Open-Meteo's data quality
  and on their continued keyless/free terms; a terms change could force the deferred file-import
  fallback.
- **Timezone and unit complexity introduced for the first time.** Misaligning a weather night to
  the wrong local day, or mishandling unit conversion, would silently corrupt correlations — a
  correctness risk in a tool that informs health decisions.

### Neutral

- **This sets the precedent for every future live integration** (LLM insights, others). The opt-in
  + explicit-disclosure + minimal-CSP-whitelist + IndexedDB-cache pattern established here is the
  template those features should follow; future ADRs should reference this one when relaxing
  `connect-src` further.
- **Geolocation is opt-in twice over** — once to enable weather, once to grant the browser
  permission to fill the location field — and is used only to populate a field, never to auto-send.
- **The first-party-service vs. integration-plugin choice is revisitable.** When the plugin registry
  (ADR-0007 follow-up) lands, this module is a natural candidate to repackage; nothing here forecloses
  that.
- **Single-location v1 keeps disclosure coarse**; raising location resolution (per-night/travel) is a
  future feature that must carry its own privacy review, not an automatic extension.

## Related Decisions

- [0001 — Client-Side Architecture](0001-client-side-architecture.md)
- [0005 — Dual Storage Strategy with IndexedDB and OPFS](0005-dual-storage-indexeddb-opfs.md)
- [0007 — Plugin Architecture for Extensibility](0007-plugin-architecture.md)
- [0015 — Zero Telemetry and Analytics](0015-zero-telemetry-analytics.md)
- [0016 — Session Identity and the `machineId_date` Index](0016-session-identity-non-unique-machine-date-index.md)
