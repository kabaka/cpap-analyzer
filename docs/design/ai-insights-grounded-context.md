# AI Insights — Grounded-Context Data Contract (compute-then-narrate)

> **Status:** Design proposal (data-science). Defines the data contract only —
> the structured, already-computed snapshot the app hands to an LLM so the model
> may **phrase and explain** existing figures. It does **not** specify the
> network/transport layer, prompt-engineering UI, or provider SDK wiring.
>
> **Audience for review:** `security` (egress + redaction), `resmed-specialist`
> (clinical-rule confirmation), `qa` (gate), `ux`/`documentation` (consent
> dialog "what is sent" copy), `frontend` (assembly of the snapshot from
> existing analyses).

## 0. Premise and non-negotiables

This feature is **compute-then-narrate**. The application performs every
numerical and clinical computation locally using the existing analysis modules
under `src/analysis/`. The LLM receives a **frozen snapshot of already-computed
results** and may only:

1. select which of those results to mention,
2. phrase them in fluent prose at the appropriate reading level, and
3. attach the interpretation/caveat text the app has already attached to them.

The LLM **must never**:

- compute, derive, re-derive, average, sum, ratio, extrapolate, or round any
  numeric value;
- introduce any number, date, threshold, or rate not literally present in the
  context object;
- assert a severity band, compliance verdict, or trend direction the context
  did not already state;
- diagnose, or imply diagnosis (the app does not diagnose — CLAUDE.md, ADR 0017,
  ADR 0018).

This posture is the direct extension of ADR 0018's "honest where it matters"
principle to a generative surface: a model that invents a figure is the
generative analogue of a chart that displays false precision, and is a
**Correctness** (priority 2) failure, which outranks the feature itself
(priority 5).

Privacy (priority 1) governs §3: the snapshot is the *only* thing that can
leave the browser, and only when the user has explicitly enabled the opt-in LLM
integration (`IntegrationConfig.llm.enabled`) and consented to egress. The
redaction rules in §3 are therefore a hard contract, not a guideline.

### Provenance discipline (every value carries its source + reliability)

Per ADR 0018, no figure may be presented as more certain than it is. The
snapshot therefore attaches, to **every** metric: its unit, its display
precision (already-rounded string), its `ReliabilityTier`
(`high | moderate | low`), and any active `DataQualityFlag[]`
(`high-leak | short-session | low-coverage | low-count`). The narration layer is
contractually required to hedge whenever the tier is not `high` or a flag is
present (§4). Nulls are first-class: a per-hour index can be `null` ("recording
too short for a defined rate" — `MIN_INDEX_USAGE_HOURS`, ADR 0020), and `null`
is **not** zero. The snapshot carries an explicit `availability` discriminator
so the model never reads a null as a number.

---

## 1. Insight types and their exact computed inputs

Four insight types are defined. Each lists the precise fields, with their source
module, that populate the context. All numeric fields are pre-formatted to their
D9 display precision (`analysis/uncertainty/formatMetric`) **and** carried in
full precision is *forbidden* — the snapshot ships the rounded display value
only (see §3, R8), so the model cannot "find" extra digits.

### (a) Single-night summary

Narrates one night. Source: the `NightlyAggregate` for that `sessionId`
(`src/types/session.ts`) plus the reliability assessment per metric
(`reliabilityTier(metricId, ctx)`).

| Field (context) | Source | Unit | Reliability metricId |
| --- | --- | --- | --- |
| `date` | `NightlyAggregate.date` | ISO `YYYY-MM-DD` | — |
| `ahi` | `ahi` | events/h | `ahi` |
| `ahiObstructive` / `ahiCentral` / `ahiHypopnea` / `ahiUnclassified` | `ahi*` | events/h | `apneaCount` / `centralFraction` / `hypopneaIndex` |
| `rdi` | `rdi` | events/h | `ahi` |
| `ahiRera` | `ahiRera` | events/h | `rera` |
| `severityBand` | `classifyAhiSeverity(ahi, userThresholds)` | enum | — |
| `eventCounts` | `eventsByType.*` | count | `apneaCount` |
| `usageHours` | `usageHours` | h | `usage` |
| `maskOnMinutes` | `maskOnTimeMinutes` | min | `maskOnTime` |
| `complianceStatus` | `complianceStatus` | enum | `compliance` |
| `pressureMedian` / `pressureP95` / `pressureMax` | `pressure*` | cmH₂O | `pressureMedian` / `pressureP95` |
| `epapMedian` / `ipapMedian` / `pressureSupport` | `epapMedian` etc. | cmH₂O | `epap` / `ipap` |
| `leakMedian` / `leakP95` / `leakMax` | `leak*` | L/min | `leakBelow` |
| `leakMinutesOver24` | `leakDurationMinutes` | min | `leakBelow` |
| `spo2Mean` / `spo2Median` / `spo2Min` | `spo2*` | % | `wearableSpo2` |
| `t90Percent` | `spo2Below90Percent` | % of valid SpO₂ time | `wearableSpo2` |
| `spo2CoveragePercent` | `spo2CoveragePercent` | % of session | `wearableSpo2` |
| `odi` | `oxygenDesaturationIndex` | events/h | `wearableSpo2` |
| `tidalVolumeMedian` / `minuteVentMean` / `respRateMedian` | resp. fields | mL / L/min / breaths/min | `tidalVolume` / `minuteVentilation` / `respiratoryRate` |

Reliability context (`ReliabilityContext`) for the per-night assessment is built
from this same aggregate: `medianLeak = leakMedian`, `maskOnHours =
maskOnTimeMinutes/60`, `eventCount = eventCount`, `rareClassCount =
eventsByType.central`, `spo2Coverage = spo2CoveragePercent/100`.

### (b) Date-range / trend summary

Narrates a span of nights. Source: the **already-computed** outputs of the
time-series and descriptive modules over the selected aggregates — the LLM
receives the computed trend objects, never the raw nightly arrays to "trend"
itself.

| Field (context) | Source (`src/analysis/...`) | What it carries |
| --- | --- | --- |
| `rangeStart` / `rangeEnd` | aggregate dates | ISO dates |
| `nightCount` / `nightsAnalyzed` | count (excludes null-rate nights) | int |
| `ahiTrend` | `timeseries.linearTrend(dates, ahiValues)` | `slope` (events/h per day), `trendDirection`, `trendStrength`, `pValue`, `rSquared` |
| `ahiRollingMedian` | `timeseries.rollingMedian` (window = user `rollingWindow`) | last median + IQR band P25–P75 ("typical nightly range", ADR 0018 D3) |
| `ahiChangePoints` | `timeseries.detectChangePoints` | date + magnitude of each detected regime shift |
| `usageTrend` | `linearTrend(dates, usageHours)` | slope (h/day) + qualifiers |
| `leakTrend` | `linearTrend(dates, leakMedian)` | slope (L/min/day) + qualifiers |
| `complianceRate` | fraction of nights `compliant` | % + numerator/denominator |
| `compliancePercentOfDays` | nights ≥ `CMS_COMPLIANCE_HOURS` / total | % |
| `descriptive` (per metric) | `descriptive` module | median, IQR, P5/P95, n, outlier count |
| `centralTrendFlag` | rising central index (ADR 0018 D6 safety rule) | boolean + "discuss with clinician" copy slot |

Every trend object ships its **statistical qualifiers** alongside the headline
number (§2): a slope with no `pValue`/`trendStrength` is forbidden in the
contract, because a bare slope invites the model to narrate noise as a finding.

### (c) "Explain this metric / chart"

Narrates **one** metric or one chart the user is looking at. Source: whatever
the chart/tile already rendered, plus its glossary entry. This is the most
constrained type: the context contains *only* the data backing that one view.

- For a single KPI: the `MetricSnapshot` (§2) for that metric id, plus its
  glossary definition text and the `uncertainty` framing string already attached
  to soft metrics (ADR 0018 D11).
- For a chart: the **series the chart plotted** as `{ date, value, availability,
  reliabilityTier }[]` at display precision, the axis units, any reference lines
  the chart drew (e.g. the `CMS_COMPLIANCE_HOURS` line, the AHI severity band
  cutoffs), and the chart's own caption/legend text. No higher-resolution data
  than the chart itself showed may be included (§3, R2).

The narration brief for this type is "explain what this view shows and how to
read it," not "evaluate the patient."

### (d) Clinical-context note

Narrates where a value sits relative to a **named, app-configured** reference —
e.g. "usage vs the CMS 4-hour adherence floor," or "AHI band per your configured
thresholds." Source: the clinical module (`analysis/clinical`) and the user's
configured thresholds.

| Field (context) | Source | Notes |
| --- | --- | --- |
| `ahiThresholds` | `AnalysisParams.ahi` (user) → falls back to `AHI_SEVERITY_THRESHOLDS` | the **active** mild/moderate/severe cutoffs |
| `severityBand` | `classifyAhiSeverity(value, ahiThresholds)` | computed app-side |
| `cmsComplianceHours` | `CMS_COMPLIANCE_HOURS` (4) | labelled "CMS / US Medicare adherence floor" |
| `recommendedUsageHours` | `RECOMMENDED_USAGE_HOURS` (6) | labelled "common good-adherence target, not a regulatory floor" |
| `complianceDefinition` | text | "compliant = mask-on ≥ {cmsComplianceHours} h" |
| `referenceProvenance` | text | which numbers are AASM/ICSD-3 vs device convention vs CMS policy |

The clinical-context note exists so the model uses **the user's configured
thresholds**, not whatever cutoffs are in its training data. If the user has
overridden the AHI bands, the narration must reflect the overridden bands; the
context makes that unambiguous by shipping the active thresholds inline and a
pre-computed `severityBand`.

---

## 2. The grounded-context JSON schema (TypeScript-interface form)

This is the object literally serialized and sent. It is the **only** payload the
narration layer may reference. Every numeric value is a *string* at display
precision (so the model cannot read extra digits), paired with a machine field
for the unit, reliability, and availability. Raw numbers are deliberately not
sent (§3, R8).

```ts
/** A single metric, fully self-describing for narration. */
interface MetricSnapshot {
  /** Canonical metric id (matches reliability & precision registries). */
  readonly id: string;
  /** Human label as shown in the UI, e.g. "Median leak". */
  readonly label: string;
  /**
   * Availability discriminator — the model MUST branch on this and never read
   * `displayValue` when not 'present'.
   *  - 'present'        → a real, finite value is available
   *  - 'undefined-rate' → per-hour rate below MIN_INDEX_USAGE_HOURS (null, NOT 0)
   *  - 'unavailable'    → channel/data absent (e.g. no oximeter)
   */
  readonly availability: 'present' | 'undefined-rate' | 'unavailable';
  /** Pre-rounded display string at D9 precision, e.g. "12.4". Null unless present. */
  readonly displayValue: string | null;
  /** Unit token, e.g. "events/h", "cmH2O", "L/min", "%", "h", "min", "mL". */
  readonly unit: string;
  /** Intrinsic reliability (ADR 0018 D1). */
  readonly reliabilityTier: 'high' | 'moderate' | 'low';
  /** Per-session degrading conditions (orthogonal to tier). */
  readonly dataQualityFlags: ReadonlyArray<
    'high-leak' | 'short-session' | 'low-coverage' | 'low-count'
  >;
  /**
   * App-authored caveat the model MUST surface verbatim-in-meaning when the
   * tier is not 'high' or a flag is present, e.g. "Estimate; leak-affected".
   * Null when no caveat applies.
   */
  readonly caveat: string | null;
}

/** A trend, with its statistical qualifiers inseparable from its headline. */
interface TrendSnapshot {
  readonly metricId: string;
  readonly label: string;
  /** "increasing" | "decreasing" | "flat" — already classified app-side. */
  readonly direction: 'increasing' | 'decreasing' | 'flat';
  /** Slope display string, e.g. "-0.18". Null if not estimable. */
  readonly slopeDisplay: string | null;
  /** Unit of the slope, e.g. "events/h per day". */
  readonly slopeUnit: string;
  /** Effect-size / strength label (linearTrend.trendStrength). */
  readonly strength: 'negligible' | 'weak' | 'moderate' | 'strong';
  /** p-value display string, e.g. "0.04". Null if undefined. */
  readonly pValueDisplay: string | null;
  /** r² display string, e.g. "0.11". */
  readonly rSquaredDisplay: string | null;
  /** Nights contributing (post null-exclusion). */
  readonly n: number;
  /**
   * App-authored statistical caveat the model MUST attach, e.g.
   * "Weak trend; not statistically significant (p = 0.34)." Never omit.
   */
  readonly qualifier: string;
}

/** A chart series, for the "explain this chart" insight. Display precision only. */
interface SeriesPoint {
  readonly date: string; // ISO YYYY-MM-DD
  readonly displayValue: string | null;
  readonly availability: 'present' | 'undefined-rate' | 'unavailable';
  readonly reliabilityTier: 'high' | 'moderate' | 'low';
}

/** The active, user-configured clinical references. */
interface ClinicalReferences {
  /** The ACTIVE AHI severity cutoffs (user override or AASM/ICSD-3 default). */
  readonly ahiThresholds: { readonly mild: number; readonly moderate: number; readonly severe: number };
  readonly ahiThresholdsSource: 'user-configured' | 'aasm-icsd3-default';
  /** CMS adherence floor in hours (4). */
  readonly cmsComplianceHours: number;
  /** Recommended good-adherence target in hours (6); NOT a regulatory floor. */
  readonly recommendedUsageHours: number;
  /** Plain-language compliance definition string. */
  readonly complianceDefinition: string;
  /** Provenance note: which references are AASM vs CMS vs device convention. */
  readonly referenceProvenance: string;
}

/** The user's display-unit & locale preferences, so narration matches the UI. */
interface DisplayUnitPreferences {
  /** "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY". */
  readonly dateFormat: string;
  /** "12h" | "24h". */
  readonly timeFormat: string;
  /** CPAP physiological units are fixed SI (cmH2O, L/min, mL); stated for clarity. */
  readonly pressureUnit: 'cmH2O';
  readonly leakUnit: 'L/min';
  readonly tidalVolumeUnit: 'mL';
  /** Only present when weather context is included; mirrors WeatherUnitsSetting. */
  readonly temperatureUnit?: 'C' | 'F';
  readonly weatherPressureUnit?: 'hPa' | 'inHg';
}

/** Top-level snapshot. The ONLY object sent to the model. */
interface GroundedContext {
  /** Schema version, for prompt/contract compatibility. */
  readonly schemaVersion: 1;
  /** Which insight is being requested (drives the narration brief). */
  readonly insightType: 'single-night' | 'date-range' | 'explain' | 'clinical-context';
  /** Generation timestamp (date only — no within-night clock time; see §3). */
  readonly generatedOnDate: string; // ISO YYYY-MM-DD

  /** Device class only — NEVER serial/firmware (see §3, R4). */
  readonly machineClass: 'CPAP' | 'APAP' | 'BiPAP' | 'VPAP' | 'ASV' | 'unknown';

  /** Date scope. Calendar dates only — no clock times. */
  readonly scope: {
    readonly startDate: string;      // ISO YYYY-MM-DD
    readonly endDate: string;        // ISO YYYY-MM-DD
    readonly nightCount: number;
    readonly nightsWithDefinedRate: number; // excludes undefined-rate nights
  };

  /** Per-metric snapshots relevant to this insight. */
  readonly metrics: ReadonlyArray<MetricSnapshot>;

  /** Trends (date-range insight). Empty for single-night. */
  readonly trends: ReadonlyArray<TrendSnapshot>;

  /** Chart series (explain-chart insight only). Empty otherwise. */
  readonly series?: {
    readonly chartTitle: string;
    readonly yUnit: string;
    readonly points: ReadonlyArray<SeriesPoint>;
    /** Reference lines the chart drew, e.g. CMS 4h, AHI band cutoffs. */
    readonly referenceLines: ReadonlyArray<{ readonly label: string; readonly value: string; readonly unit: string }>;
    readonly caption: string;
  };

  /** Active clinical references (always present). */
  readonly clinical: ClinicalReferences;

  /** User display preferences so prose matches the on-screen UI. */
  readonly display: DisplayUnitPreferences;

  /**
   * A flat allow-list of every numeric token that appears anywhere above,
   * built mechanically from the object. The post-generation validator (§5)
   * checks the narration's numerals against THIS set. Including it in the
   * payload is optional for the model but mandatory for the validator; if sent,
   * it doubles as an explicit "these are the only numbers that exist" signal.
   */
  readonly numericAllowList: ReadonlyArray<string>;
}
```

### Why strings, not numbers

Shipping `"12.4"` rather than `12.4` does three things: (1) it removes any
residual precision the model could surface ("12.43…"), (2) it forces the model
to treat values as quotable tokens rather than operands, and (3) it makes the §5
numeral-extraction check a pure string-membership test. Units, reliability, and
availability travel as siblings so a value is never quotable without its
qualifiers.

---

## 3. Redaction / privacy rules (the egress blocklist)

These rules are a hard contract. They feed (a) the `security` review, (b) the
consent dialog's "what is sent" text, and (c) a unit-tested `buildGroundedContext`
serializer whose output is asserted to contain none of the forbidden classes.
The consent model mirrors the weather integration's two-gate pattern
(`IntegrationConfig.weather.consentAt`) and ADR 0015's zero-telemetry posture:
nothing here is sent unless `llm.enabled` **and** an egress consent timestamp
exist.

**MUST NEVER be sent (blocklist):**

- **R1 — Raw / high-frequency signal arrays.** No 25–50 Hz flow, pressure, leak,
  or SpO₂ sample arrays; no per-breath waveforms; no OPFS chunk contents or
  `signalChunkIds`. The snapshot is aggregate-only.
- **R2 — Within-night event timestamps and sub-night resolution.** No
  `Event.timestamp` (epoch ms), no event-level start/end clock times, no
  per-event `pressure`/`leak`/`spo2` context samples, no intraday series beyond
  what a *currently displayed* chart already shows at its own (coarse)
  resolution. Counts and per-night indices only. Clustering positions and
  cluster member timestamps are out.
- **R3 — Exact clock times of any kind.** Recording `startTime`/`endTime`,
  import timestamps, last-sync times. Only **calendar dates** (`YYYY-MM-DD`)
  leave. (A bedtime clock time is quasi-identifying and clinically unnecessary
  for narration.)
- **R4 — Device identifiers.** `machineId` (serial number), `firmwareVersion`,
  `sourceHash`, session/aggregate `id` (UUID), `sessionId`. Only the coarse
  `machineClass` enum (CPAP/APAP/BiPAP/VPAP/ASV) may be sent, and only because
  it changes valid narration (e.g. EPAP/IPAP only exist on bilevel).
- **R5 — Free-text and tags.** `NightlyAggregate.notes` and `tags` are
  user-authored and may contain names, locations, or medical detail. **Never
  sent.** (If a future feature wants note-aware narration, it requires its own
  separate consent gate and is out of scope here.)
- **R6 — Location / environment identifiers.** Weather latitude/longitude (even
  the 2-dp values), location label, and any geocoded place name. If weather
  context is narrated at all, only **derived nightly weather aggregates** at
  display precision and bucketed values may appear — never coordinates.
- **R7 — Any external-integration identifiers.** Fitbit tokens/user ids, the LLM
  `apiKey` itself (it goes in the auth header, never the payload), Open-Meteo
  request parameters.
- **R8 — Full-precision numerics.** Stored full-precision values never leave;
  only the D9 display string. This both prevents false-precision narration and
  shrinks the fingerprint surface.

**Round / bucket where sensible (de-identification):**

- Dates may be sent as exact `YYYY-MM-DD` (needed to narrate "your worst night
  was Tuesday the 4th"); they are the finest temporal grain permitted. Consider
  offering a stricter mode that ships only relative offsets ("night 3 of 14")
  for users who want maximal de-identification — recommended as a follow-up
  toggle, not v1-blocking.
- SpO₂, pressure, leak, AHI: already bucketed by D9 display precision (integer %,
  1-dp cmH₂O, integer L/min, 1-dp events/h).
- `machineClass` is the device-model field reduced to a 5-way enum — model name,
  variant, and firmware are dropped.

**"What is sent" summary for the consent dialog (plain language):**

> When you ask for an AI insight, the app sends a small summary of
> **already-calculated numbers** — your nightly AHI, usage hours, leak,
> pressure, and similar metrics, at the same precision shown on screen, labelled
> with calendar dates and your machine *type* (CPAP/BiPAP/etc.). It does **not**
> send your raw breathing signals, exact event times, bedtime clock times, your
> machine's serial number, your notes or tags, your location, or any account
> identifier. You can review the exact payload before it is sent.

A "preview the exact payload" affordance (showing the serialized
`GroundedContext`) is **recommended and should be built**, satisfying ADR 0015's
transparency posture and giving `security` a concrete artifact to audit.

---

## 4. Anti-fabrication rules for the prompt layer

The contract the *prompt layer* must enforce on top of the data contract.

### System-prompt invariants (must all be present)

1. **Closed-world numerics.** "Only reference values that appear literally in the
   provided `context`. Never compute, sum, average, ratio, convert, or round any
   number. If you need a figure that is not in `context`, do not state one — say
   the information is not available."
2. **Quote, don't recompute.** "When you mention a metric, quote its
   `displayValue` and `unit` exactly as given. Do not change its precision."
3. **Honour availability.** "If a metric's `availability` is `undefined-rate`,
   describe it as 'the recording was too short to compute a reliable per-hour
   rate' — never as zero or low. If `unavailable`, say the data was not
   recorded."
4. **Mandatory hedging.** "If a metric's `reliabilityTier` is `moderate` or
   `low`, or it has any `dataQualityFlags`, you must include its `caveat` and
   phrase the figure as an estimate, not a fact. Low-reliability metrics may be
   mentioned but never used to assert a conclusion."
5. **Use the provided thresholds.** "Use only the AHI thresholds and compliance
   definition in `context.clinical`. Do not use any cutoff from your own
   knowledge; the user may have configured custom thresholds."
6. **No diagnosis.** "Describe and explain; never diagnose, never recommend
   changing therapy settings, never contradict the user's clinician. Where the
   context carries a 'discuss with your clinician' flag, surface it."
7. **Trends carry their qualifier.** "Never state a trend's direction without its
   `qualifier` (strength + significance). A `negligible`/non-significant trend
   must be described as 'no clear trend'."

### Structured output / JSON-mode strategy by backend

- **Cloud backends (the configured `anthropic` / `openai` providers).** Use the
  provider's structured-output / tool-use mode and require the model to return a
  typed object: `{ narrative: string, citedMetricIds: string[],
  citedNumbers: string[] }`. Constraining `citedNumbers` to a returned array
  (a) makes the §5 validation trivial (compare `citedNumbers` ⊆
  `numericAllowList`) and (b) discourages free-floating figures because the model
  must declare what it cited. The prose still lives in `narrative`, but the
  declared-citations channel is the contract surface.
  - *Anthropic note:* prefer a tool-use / structured-output schema over relying
    on prose-only JSON; keep the system prompt's closed-world rule as the primary
    guard since structured output constrains *shape*, not *factuality*.
- **Small / local models (future, privacy-maximal path).** Many local models do
  not honour JSON-mode reliably. Degrade as follows: (1) keep the same system
  prompt invariants; (2) drop the requirement for a structured citations object
  and instead run the §5 numeral-extraction check on the raw narrative; (3) lower
  ambition — prefer template-assisted narration (the model fills slots in an
  app-authored sentence skeleton whose numbers are pre-substituted by the app)
  over free generation. Template-with-slots makes fabrication structurally
  difficult and is the recommended fallback when structured output is
  unavailable.

In all cases, **structured output is a convenience, not the safety mechanism**.
The safety mechanism is the closed-world prompt plus the §5 post-validation.

---

## 5. Correctness checks (post-generation validation)

A deterministic, app-side validator runs on the model's output before it is ever
shown to the user. This is the backstop that catches hallucinated figures
regardless of backend.

### Numeral-extraction check (primary)

1. Build `numericAllowList` mechanically while serializing `GroundedContext`:
   every `displayValue`, threshold, `cmsComplianceHours`,
   `recommendedUsageHours`, slope, p-value, r², reference-line value, and `n`,
   as their exact display strings. Also admit a small **safe-literal allow-set**:
   integers `0`–`10` and small ordinals/counts the model may legitimately use in
   prose ("the first night", "all 14 nights" — where 14 is `nightCount`, already
   in the list). Keep this safe set deliberately tiny and documented.
2. Extract every numeral from the narrative with a tolerant numeric regex
   (handles decimals, ranges like "5–15", percentages, and unit-suffixed forms
   like "4.2 events/h").
3. For each extracted numeral, require an exact string match against
   `numericAllowList` (or the safe-literal set). Normalise trivially (strip
   thousands separators; compare the bare number, then re-check the unit token
   the model attached matches the source unit).
4. **On failure** (a numeral not in the allow-list, or a value quoted with the
   wrong unit): do **not** display the narrative. Behaviour, in order of
   preference: (a) one automatic regeneration with a strengthened reminder
   listing the offending token; (b) if it fails again, fall back to a
   non-generative, app-rendered summary (template substitution from the same
   `GroundedContext`) and show a quiet "AI narration unavailable, showing the
   computed summary" notice. Never silently show fabricated text.

### Secondary checks

- **Severity/compliance consistency.** If the narrative asserts a severity band
  or compliance verdict, it must equal `context.clinical`-derived
  `severityBand` / `complianceStatus`. A mismatch is a hard failure (same
  remediation as above).
- **Reliability-hedge presence.** If any cited metric has tier `moderate`/`low`
  or a flag, assert that the narrative contains hedging language / the caveat.
  Missing hedge → regenerate.
- **No-diagnosis lint.** A small banned-phrase lint (e.g. "you have", "this means
  you are diagnosed", imperative therapy-change phrases). A hit triggers
  regeneration, then template fallback.

### Determinism & testing

The serializer (`buildGroundedContext`) and the validator are pure and
deterministic and must be unit-tested (`unit-tester`) with reference fixtures:
(1) a known aggregate → asserted `GroundedContext` (redaction asserted: no
serial, no timestamps, no notes); (2) a narrative containing a fabricated "6.1"
not in the allow-list → validator rejects; (3) a narrative quoting AHI with the
wrong unit → rejected; (4) a null-rate night → `availability:'undefined-rate'`
and the prompt/validator never treat it as `0`. Provide these vectors to
`unit-tester` with the expected pass/fail outcomes.

---

## 6. Open questions for the orchestrator to route

- **`resmed-specialist`:** confirm the compliance definition wording and that
  `machineClass` is the correct coarse granularity (ASV/AirMini narration
  differences). Confirm that the leak thresholds remain *device conventions*
  in any clinical-context copy (ADR 0018 D7/D10).
- **`security`:** audit the `buildGroundedContext` serializer against the §3
  blocklist; confirm the API key never enters the payload; sign off the
  "preview exact payload" affordance.
- **`ux` / `documentation`:** own the consent-dialog "what is sent" copy (§3) and
  the fallback "AI narration unavailable" notice (§5).
- **Stricter de-identification toggle** (relative date offsets instead of
  calendar dates) — recommended as a fast-follow, flagged here for the product
  owner.

## References

- `src/types/session.ts` — `NightlyAggregate`, `Session`, `MachineSettings`.
- `src/types/events.ts` — `Event`, `EventType`.
- `src/types/settings.ts` — `AnalysisParams.ahi`, `DisplayPreferences`,
  `IntegrationConfig.llm`, weather consent pattern.
- `src/analysis/clinical/ahiSeverity.ts` — `classifyAhiSeverity`,
  `AHI_SEVERITY_THRESHOLDS`.
- `src/analysis/clinical/compliance.ts` — `CMS_COMPLIANCE_HOURS`,
  `RECOMMENDED_USAGE_HOURS`.
- `src/analysis/uncertainty/{reliabilityTier,formatMetric,constants}.ts` —
  `ReliabilityTier`, `DataQualityFlag`, `reliabilityTier()`, `formatMetric()`,
  `MIN_INDEX_USAGE_HOURS`.
- `src/analysis/{timeseries,correlation,survival,pressure,descriptive}/index.ts`
  — computed trend/correlation/survival/descriptive outputs.
- ADR 0015 (zero telemetry), ADR 0017 (candidate-not-diagnosis), ADR 0018
  (measurement-uncertainty/reliability), ADR 0020 (rate-validity floor),
  ADR 0022 (weather egress + two-gate consent precedent).
