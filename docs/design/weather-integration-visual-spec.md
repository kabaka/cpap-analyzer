# Weather Integration — Visual Design Specification (v1)

> Companion to [`weather-integration.md`](./weather-integration.md). Authored by
> ui-design; the source of truth for tokens, colors, component visuals, and the
> required non-color encodings. Scope: core weather + air quality (pollen
> deferred). All values resolve through existing CSS custom properties in
> `src/styles/tokens.css` unless flagged **NEW TOKEN**. WCAG AA: color is never
> the sole signal anywhere below.

## 1. AQI color scale + required non-color encoding

AQI gets its **own 6-step ramp**, deliberately distinct from the clinical
`--color-status-*` scale (which means _AHI severity_ and must not be confused
with air quality). US AQI and European AQI both map onto six ranked bins; the
**rank (1–6)** drives color + pattern identically, the **word** is provider-aware.

**NEW TOKEN set `--color-aqi-1`…`--color-aqi-6`** (+ `-bg` at 0.12 light / 0.18
dark, + `-fg` on-fill text color), defined in `:root` and `[data-theme='dark']`:

| Rank | US label                       | EAQI label     | Light     | Dark      |
| ---- | ------------------------------ | -------------- | --------- | --------- |
| 1    | Good                           | Good           | `#2e8b57` | `#34d399` |
| 2    | Moderate                       | Fair           | `#9aa520` | `#bfd13a` |
| 3    | Unhealthy for Sensitive Groups | Moderate       | `#d97706` | `#fbbf24` |
| 4    | Unhealthy                      | Poor           | `#dc2626` | `#f87171` |
| 5    | Very Unhealthy                 | Very Poor      | `#8b1a8b` | `#d946ef` |
| 6    | Hazardous                      | Extremely Poor | `#6b1f3a` | `#fb7185` |

Hue path green→olive→amber→red→purple→maroon (EPA mental model), shifted off the
exact clinical green/yellow to avoid cross-scale confusion. **frontend must verify
each `-fg` on its fill ≥ 4.5:1, and each fill as text on `--color-surface-primary`
≥ 4.5:1; where a fill can't meet 4.5:1 as text, render the word in
`--color-text-primary` and use the color only as swatch/band.**

**Required non-color encoding — escalating hatch density (the one primitive the
canvas renderer has, `fillDiagonalHatch`):**

| Rank | Band pattern                  | Glyph | Always shown |
| ---- | ----------------------------- | ----- | ------------ |
| 1    | solid, no hatch               | ●     | word + value |
| 2    | sparse hatch (10px pitch)     | ◐     | word + value |
| 3    | medium hatch (7px)            | ◑     | word + value |
| 4    | dense hatch (5px)             | ▲     | word + value |
| 5    | dense cross-hatch (±45°, 5px) | ▲▲    | word + value |
| 6    | cross-hatch + 1px outline     | ◆     | word + value |

The rank→{word, color token, pattern, glyph} table is **one shared source of
truth** in `src/analysis/weather/` (data-science owns it) so tile, inline readout,
and ribbon never disagree.

**Renderer extension (with data-visualization):** extend `RibbonBand` with
`pattern?: 'solid'|'hatch-sparse'|'hatch-med'|'hatch-dense'|'crosshatch'|'crosshatch-outline'`
and `patternColor?: string`; keep `hatch?: boolean` working (`true` → `hatch-med`)
so the hypnogram is unaffected. Cross-hatch = two `fillDiagonalHatch` passes,
opposite slopes.

**Shared AQI swatch atom** (tiles, coverage rows, tooltips, legend):
`[12×12 swatch: fill --color-aqi-N + rank pattern, 1px --color-border-default
outline] + word (--font-size-xs, semibold, --color-text-primary) + value
(--font-family-mono, tabular-nums)`. `role="img"`, `aria-label="Air quality:
Moderate, US AQI 78"`. Never emit the swatch without the trailing word+number.

## 2. WeatherOverview dashboard panel

Parallels `WearableOverview.tsx` (Card + `.statsGrid` + stat tiles + footer +
loading/error/null states; reuse its CSS module). Grid `repeat(3,1fr)` desktop →
2-col ≤1199px → 2-col ≤639px, gap `--space-3`.

| #   | Tile                               | Format              | Unit (unit-aware) | Trend polarity       |
| --- | ---------------------------------- | ------------------- | ----------------- | -------------------- |
| 1   | Overnight Low Temp                 | 1 dp                | °C / °F           | neutral              |
| 2   | Humidity                           | int                 | %                 | neutral              |
| 3   | **Barometric Pressure** (headline) | 1 dp                | hPa / inHg        | neutral              |
| 4   | Air Quality (AQI)                  | int + word (swatch) | US/EU AQI         | polar — lower better |
| 5   | Dew Point                          | 1 dp                | °C / °F           | neutral              |
| 6   | Wind                               | int                 | km/h · mph · m/s  | neutral              |

Numeric values: `--font-family-mono` + `tabular-nums`. Tile 3 gets a 2px left
accent bar in `--color-chart-6` (cyan) via `data-headline="true"` — accent only,
not a severity signal. Tile 4 renders the §1 swatch inside `.statValueRow`.

**`.asOfCaption`** under the title (weather lags ~5 days, so a date stamp is
mandatory — never imply "today"): `As of {date}` in `--font-size-xs`
`--color-text-muted`; when synced night > 5 days stale append
`· provider data lags ~5 days` (muted, not a warning color).

**TrendIndicator extension — `polarity: 'neutral' | 'favorable-low' |
'favorable-high'`:**

- **Neutral** (temp/humidity/pressure/dewpoint/wind): arrow `↑/↓/—` in
  `--color-text-secondary`, bg `--color-surface-tertiary`; `aria-label`
  `Rising/Falling/Steady` — **no favorable/unfavorable wording**. **NEW TOKEN
  (optional alias):** `--color-trend-neutral` = `--color-text-secondary`,
  `--color-trend-neutral-bg` = `--color-surface-tertiary`.
- **Polar lower-better (AQI):** falling → green (`--color-status-normal` /
  `-bg`), rising → red (`--color-error` / `-bg`). Arrow direction always reflects
  raw numeric direction (so a **down arrow is green** for AQI); the swatch carries
  the real meaning, trend chip is secondary. `ux` to validate this semantic.
- Trend window 7 days (mirror `TREND_WINDOW_DAYS`/`TREND_THRESHOLD`).

**States:** loading → 6 `.skeletonCard`; error → inline `--color-error`; **enabled
but unsynced → CTA card** (info-accent, primary "Sync now" → Settings); disabled →
`null`; footer → `{n} nights of weather data` + `Explore correlations →`
(`/explore/correlations?tab=cross-source`).

## 3. Settings controls (Integrations accordion — de-stub the weather item)

**Accordion trigger:** prepend a globe/cloud-network icon (16px) in `--color-info`
(distinct from Fitbit's local-folder icon in `--color-text-secondary`); when
enabled, a right-aligned **"Connects online" pill** (`--color-info` on
`--color-info-bg`, `--radius-full`). Fitbit gets no pill — the absence is itself a
signal.

**Consent dialog** (modal, 600px, focus-trap, Esc-cancels-and-reverts) — the
privacy contract, designed for scannability:

1. Title `Enable Weather & Air Quality`.
2. One-line purpose (`--color-text-secondary`).
3. **"What leaves your device"** block — `--color-info-bg`, 3px `--color-info` left
   accent, each row an **outbound-arrow glyph** + text: approximate location
   (rounded ~1.1 km) · calendar dates you sync · (only if you use Find) a typed
   city name.
4. **"What never leaves"** block — `--color-success-bg`, 3px `--color-success` left
   accent, **lock glyph** per row: any therapy/health data · any identifier (no
   account/key) · precise GPS.
5. Footnote (`--color-text-muted`): requests go only to Open-Meteo; a `consentAt`
   timestamp is saved to re-ask if this changes.
6. Actions: secondary **Cancel** + primary **Enable** (persist `consentAt`).

**Convention to reuse for future networked integrations (LLM):** blue = leaves,
green = stays.

**Units & resolution → recommend a NEW shared Segmented Control** (`@/components/ui`,
design-system §4.2.7) for the short binary/ternary enums (C/F, hPa/inHg,
km/h·mph·m/s, mm/in, Daily/Daily+Hourly): `role="radiogroup"` + `role="radio"`
segments, arrow-key nav, `aria-checked`, per-segment `aria-label` with full unit
name; selected segment carries a **2px `--color-primary` bottom border** as the
non-color selected cue (survives grayscale) + `--color-surface-elevated` +
`--shadow-sm`. Track `--color-surface-secondary`, height 36px, min-segment 44px.
**Fallback:** existing `Select` styled as in Settings. Domain checkboxes
(Core / Air quality) use the existing `Checkbox`.

**Action weights:** **Sync now** = the only primary/filled button (`--color-primary`,
44px), right-aligned anchor. **Use current location** = secondary/ghost with a
location-pin icon, inside the location group (one-time geolocation convenience,
subordinate). **Find** (city search) = ghost, trailing the city input (discloses
an extra call). Geolocation errors → `role="alert"` in `--color-error` within the
location group + move focus to the manual lat/lon Input.

Enabled-panel layout:

```
[Location] Lat [ ] Lon [ ]   |  [City…][Find]  |  [⌖ Use current location]
[Units]    segmented controls
[Data]     ☑ Core weather  ☑ Air quality
[Resolution] [ Daily | Daily+Hourly ]
Last synced: {date} · {n} nights         [ Sync now ]   (PRIMARY)
☐ Auto-sync newly imported nights (off)
```

## 4. Signal Viewer weather lanes

New `'weather'` `LaneGroup`, pill `'WX'`, `WEATHER_LANE_SPECS` paralleling the
wearable lanes; auto-hide when no data; new **"Environment focus"** preset
(`l.id === 'cpap:flow' || l.group === 'weather'`).

**NEW TOKENS — weather lane colors** (must not clash with chart/wearable/hypno
hues; frontend/data-viz to verify ≥3:1 large-stroke and mutual distinguishability):
`--color-weather-pressure` light `#0e7490` / dark `#22d3ee` (cyan); `--color-weather-temp`
light `#92400e` / dark `#fdba74` (warm brown-orange). Cool-vs-warm = pressure-vs-temp.
**NEW TOKEN `--signal-lane-height-ribbon: 44px`** (compact single-row ribbon).

- **Lane A — Conditions ribbon** (existing `RibbonBand`/ribbon renderer, 44px):
  one segment per condition run, neutral sky palette (clear=low-chroma amber,
  cloud/overcast greys, precip=cyan, storm darker), **weather glyph** per segment
  (sun/cloud/rain/snow/fog/bolt) drawn when `segW ≥ 16px`; collapsed → dominant
  glyph + count.
- **Lane B — Pressure/Temperature dual line** (`render: 'line'`, 150px, dual
  y-domain): pressure `--color-weather-pressure` **solid, heavier** (1.6px,
  headline); temperature `--color-weather-temp` **dashed** (1.2px, 4px dash — the
  grayscale distinguisher). Header lists both swatch+name+unit; cursor readout
  announces both. **Fallback if multi-series-per-lane unsupported:** two stacked
  single-line lanes.
- **Lane C — AQI ribbon** (extended `RibbonBand` with `pattern`, 44px): fill
  `--color-aqi-{rank}` + rank pattern (§1); glyph at ≥28px, value at ≥48px; band
  `role="img"` `aria-label="Air quality {word}, AQI {value}"`. The word is carried
  by legend/tooltip/readout, never relied on inside a narrow band.

**Keyboard data-cursor readout (required non-visual path):** extend `cursorReadout`
so over a weather lane it announces temp, pressure, dew point, wind, condition word,
and "Air quality: {word}, AQI {value}" (word + number, never a bare value).

## 5. Coverage view (Synced / Missing / No-provider-data / Failed)

Every status pairs a **distinct icon shape + word + color** (color reinforcement
only). The Missing vs No-provider-data distinction is a **correctness** requirement
(the "queried but empty" state stores distinctly from "not fetched"; show "—",
never a fabricated zero):

| Status                            | Icon                   | Color                    | bg                         | Label               | Actionable |
| --------------------------------- | ---------------------- | ------------------------ | -------------------------- | ------------------- | ---------- |
| Synced                            | ✓ filled circle        | `--color-success`        | `--color-success-bg`       | "Synced"            | —          |
| Missing (not fetched)             | ◷ hollow/dotted circle | `--color-text-muted`     | `--color-surface-tertiary` | "Not synced"        | Sync       |
| No provider data (queried, empty) | ⊘ circle-slash         | `--color-text-secondary` | `--color-caveat-bg`        | "No data available" | terminal   |
| Failed                            | ⚠ triangle             | `--color-error`          | `--color-error-bg`         | "Sync failed"       | Retry      |

Date column `--font-family-mono`/tabular-nums; status badge = icon+word atom
(`--font-size-xs`, `--radius-full`); trailing Sync/Retry ghost button on actionable
rows; failed rows show an inline reason (offline / 429 / HTTP). Summary header =
count chips, each carrying its status icon+color+count.

## 6. Consolidated new tokens / system additions

1. `--color-aqi-1`…`-6` (+ `-bg`, `-fg`, light & dark) — **AA-verify**. _(most
   important)_
2. `--color-weather-pressure`, `--color-weather-temp` (light & dark).
3. `--signal-lane-height-ribbon: 44px`.
4. `--color-trend-neutral` / `-bg` (aliases; optional).
5. `RibbonBand.pattern` enum + `patternColor` (renderer extension, back-compat with
   `hatch?`) — coordinate with data-visualization.
6. **Segmented Control** new shared `@/components/ui` component + design-system
   §4.2.7.
7. Bundled icons (Lucide/Heroicons, MIT): globe/cloud-network, location-pin/
   crosshair, outbound-arrow, lock/shield, circle-slash, hollow/dotted-circle,
   weather glyphs, AQI rank glyphs.
8. Document the blue-egress / green-retained-local consent convention.

## 7. Cross-agent handoffs

- **ux**: validate the §2 "down-arrow-is-green for AQI" semantic and §3 consent
  hierarchy/focus order before frontend builds.
- **data-visualization**: owns the `RibbonBand.pattern`/cross-hatch renderer
  extension and the dual-line-per-lane question.
- **frontend**: contrast-verify the new AQI ramp + weather lane colors; add the
  Segmented Control to `@/components/ui`.
