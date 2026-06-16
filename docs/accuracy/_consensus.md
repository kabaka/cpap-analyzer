# Consensus Decisions — Measurement Uncertainty / Reliability Display

Orchestrator-resolved decisions reconciling the four proposals
(`_proposals/`) with the four adversarial reviews (`_reviews/`). This is the
**single source of truth** for implementation. Where proposals conflicted,
the decision below wins. Priority order used to resolve ties:
**Privacy > Correctness > Performance > UX > Features.**

## D1 — Reliability tier is 3-state (not 5)

`ReliabilityTier = 'high' | 'moderate' | 'low'`, generalizing the existing
`src/analysis/breathing/confidenceTier.ts` vocabulary (low/moderate/high).
The UI-design 5-tier enum is **rejected** (QA block upheld). "Unavailable"
and "data-quality caveat" are **orthogonal** concerns, not tiers:

- `ReliabilityTier` — intrinsic reliability of a metric/estimate.
- `DataQualityFlag` — per-session condition that degrades a value
  (`'high-leak' | 'short-session' | 'low-coverage' | 'low-count'`). Separate
  affordance; may co-occur with any tier.
- "Unavailable" — a render state (no data / suppressed), not a tier.

Do **not** widen `ConfidenceTier`; add `ReliabilityTier` as a sibling type in
a new shared module and keep `confidenceTier.ts` working for its existing
consumers (`ConfidenceBar`, `SignalViewer`, breathing analysis).

## D2 — Canonical tier → label → icon map (resolves UX vs UI conflict)

| Tier              | Chip shown?                               | Label                | Non-color cue (icon shape)                                   |
| ----------------- | ----------------------------------------- | -------------------- | ------------------------------------------------------------ |
| `high`            | **No chip** — absence is the trust signal | —                    | —                                                            |
| `moderate`        | Only when decision-relevant (see D6)      | "Estimate"           | outline triangle                                             |
| `low`             | Yes, on soft metrics                      | "Modeled"            | hexagon (reuses the existing "inferred/detection" semantics) |
| data-quality flag | Yes, when the flag is active              | e.g. "Leak-affected" | filled warning `!`                                           |

Reliability/data-quality colours use the **violet/neutral** axis
(`--color-detection` / `-tecsa-*` family), never the red/orange severity
axis. Red/orange remain reserved exclusively for clinical severity so the two
axes never collide.

## D3 — AHI trend headline statistics (resolves the incoherent median+SEM band)

- **Center line:** rolling **median** over the window (robust to outlier
  nights and regime changes).
- **Band:** the empirical **inter-quartile band (P25–P75)** of the trailing
  window, labelled "typical nightly range" — **not** a "95% CI of the mean."
  This sidesteps the autocorrelation/non-stationarity problems the stats
  review raised with `x̄ ± z·s/√n` and is coherent with a median center.
- An optional lighter P10–P90 band is **deferred** (nice-to-have).
- Do **not** combine a median center with a mean SEM band (QA + stats both
  flagged this as incoherent).

## D4 — Locked statistical constants / fixes

- Two-sided rule-of-three for N=0, 95%: **3.689 counts** (≈0.615 /h at 6 h).
  Never 3.0 (that is the one-sided value).
- Corrected Poisson reference vector: N=40, T=6 h → lower **4.7628**, upper
  9.0781 events/h. Use these (Wolfram-verified) as unit-test vectors.
- Exact Garwood chi-square CI for **N < 20**, normal approx `(N ± z√N)/T`
  for N ≥ 20.
- The per-night Poisson CI is presented/labelled as a **lower bound on
  uncertainty** (apneas cluster/over-disperse; Poisson understates true
  spread). Do not invent an over-dispersion multiplier.

## D5 — Per-metric reliability tiers (clinical corrections applied)

**Reliable → `high`, no chip, show with precision:** delivered/measured
pressure; usage / mask-on time; unintentional leak **below** threshold.

**`moderate` (algorithmically detected; leak-gated):** apnea count
(corrected down from "high" — it is detected, undercounts vs PSG, uses a
mask-on not sleep denominator); aggregate AHI; hypopnea count (add to leak
gate); tidal volume / minute ventilation / respiratory rate.

**`low` ("surface, don't diagnose"):** central-vs-obstructive split;
flow-limitation index/%; RERA; all consumer-wearable SpO₂ and multi-stage
sleep.

## D6 — Quiet-by-default + central-apnea safety (clinical C2 / security S-1)

- A chip appears **only** when it changes a decision: low-tier soft metrics,
  or an active data-quality flag, or a single night near a category boundary.
  Never on high-tier metrics. No chip on a stable, well-sampled value.
- **A `low` tier lowers the _precision_ claim; it must NEVER silence or
  visually bury a rising trend.** Specifically: a rising central
  (Clear-Airway) index must still surface a visible
  "discuss with your clinician" prompt even though the split is `low`
  reliability. Under-reaction to treatment-emergent central apnea is the
  dangerous failure mode. This requires a dedicated **clinical-flag** copy
  tone, distinct from the reliability chip, and an **e2e acceptance test**
  asserting the prompt is present.

## D7 — Split leak gate (clinical C3 / stats #6)

- **24 L/min** → user-facing **data-quality notice** (matches the device's
  own red-zone convention).
- **30 L/min** → threshold at which flow-derived metrics (Vt, MV, RR,
  flow-limitation) are actually **flagged/suppressed**. Graduated, not a hard
  cliff — do not over-suppress usable 24–30 data.
- Both as **named constants** in one module; consolidate the ~8 scattered
  `24` literals. Keep the existing nuanced glossary copy (mask-dependent,
  ~36 L/min oronasal). These are **device conventions, cited as such**, not
  AASM standards.

## D8 — Gate reliability on event count N, not session hours

AHI reliability/precision is driven by event count, so the "stable AHI" gate
keys on **N (and N per rare class)**, not a borrowed 4 h compliance artifact.
Thresholds (conventions, documented): rare-class split needs **≥20 total and
≥5 rare-class** events; flag short windows by effective N.

## D9 — Display precision (false-precision fixes)

Presentation-layer only (`formatMetric`); never round stored values.

| Metric                          | Resolution                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------- | --------- |
| AHI / sub-indices / RDI / ODI   | 1 decimal /h                                                                              |
| Pressure (all stats)            | 1 decimal cmH₂O (rationale: ISO 80601-2-70, **not** the unverified 0.2 resolution figure) |
| Leak median/P95/max             | integer L/min                                                                             |
| Tidal volume                    | integer mL                                                                                |
| Minute ventilation              | 1 decimal L/min                                                                           |
| Respiratory rate, SpO₂ mean/min | integer                                                                                   |
| **T90**                         | **integer minutes** (stats correction; was 1 dp)                                          |
| Usage                           | 1 decimal h · Compliance                                                                  | integer % |
| Event counts                    | exact integer                                                                             |

Fix the real offenders: `ReportService.ts:1072`, `export.worker.ts:124-125`,
`PressureOptimization.tsx:304` (AHI at 2–3 dp). Correlation coefficients (r)
at 2 dp are acceptable and out of scope.

## D10 — Do NOT encode unverified `[?]` figures (security/clinical/datascience)

FOT amplitude (~1 cmH₂O), pressure ± tolerance (±0.5+4%), 0.2 cmH₂O
resolution, the 42 L/min S9-era leak figure, placeholder detection-error
numbers — must **not** be stated as fact in logic or user-facing copy.
Where used at all, mark as device convention with a citation, behind a named
constant flagged for `resmed-specialist` verification.

## D11 — First-PR scope (single PR on `claude/peaceful-mccarthy-takofw`)

**Must-have:**

1. `formatMetric` precision helper + fix the three real offenders + T90.
2. Shared `reliability` module: `ReliabilityTier`, `reliabilityTier(metricId, ctx)`, leak-gate constants, data-quality flags.
3. Stats utils: `poissonRateCI`, `inverseChiSquare`/`lowerGammaRegularized`, rolling **median + IQR** band util — with the D4 verified test vectors.
4. `ReliabilityChip` (focusable, non-color cue, ARIA) shown only per D2/D6.
5. KPI integration (soft metrics only) + AHI trend median+IQR band (reusing the KM `d3.area`/recharts band approach).
6. Split leak-gate constants + data-quality notice on flow-derived metrics.
7. Central-apnea: keep trend flag visible (clinical-flag tone), never silenced.
8. In-app help: `reliability` field on `MetricDefinition`, `uncertainty`
   framing on soft glossary entries, one "Understanding measurement
   uncertainty" article.
9. Finalize `docs/accuracy/` reference docs (corrections applied) + ADR + CHANGELOG.
10. Tests: unit (utils vs verified vectors), component (chip a11y), **e2e
    central-apnea safety test** (D6), precision regression.

**Deferred (later):** 5-tier system, full DataQualityNotice framework,
PDF hatch confidence bands, per-point error bars, P10–P90 outer band,
cross-mode (ASV/AirMini) caveat expansion.
