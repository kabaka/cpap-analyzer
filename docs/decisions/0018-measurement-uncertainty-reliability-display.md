# 0018 — Measurement-Uncertainty / Reliability-Display Framework

## Status

Accepted

## Context

Every number and chart the CPAP Analyzer renders today is presented as if it
were exact. Aggregate AHI, the central-vs-obstructive split, tidal volume,
SpO₂ from a wearable — all appear as confident point values and smooth lines,
with no visual or textual admission that they carry measurement error. For the
audience this tool serves (patients with data-science, mathematics, or
bioinformatics backgrounds, and the clinicians they take this to), that silent
over-confidence is itself a correctness failure: a number presented without its
uncertainty systematically reassures, and reassurance about a health metric is
exactly the wrong default when the metric is noisy.

The domain-research drafts under `docs/accuracy/_drafts/` quantify how large that
error actually is. The headline figures:

- **Device-reported AHI is a poor per-night estimate of "true" AHI.** Across the
  device-accuracy and statistics drafts, single-night agreement against PSG and
  manual scoring is weak (reported per-night percentage errors on the order of
  **59–112%**), driven by auto-scoring undercounting residual events, a mask-on
  (not sleep-time) denominator, and the strong over-dispersion of respiratory
  events (REM-locked, supine-locked, arousal-cascaded clustering).
- **The central-vs-obstructive event split is barely reproducible.** Event-level
  type classification sits around **ICC ≈ 0.16**; the machine also tends to
  *under*-classify closed-airway centrals as obstructive, so the true central
  burden may be higher than shown — the type split is unreliable, but a sustained
  rise in the central index is not.
- **Consumer-wearable SpO₂ is uncalibrated** and multi-stage sleep from
  wrist wearables is weakly accurate; both are surrogates, not measurements.

This is the same honesty problem [0017](0017-app-computed-breathing-pattern-detection.md)
faced for app-computed detections (it answered it with an explicit 0–1
confidence and "candidate, never diagnosis" framing). The present decision
extends that posture from *one feature* to *the whole presentation layer*.

The tension is real and was raised directly by the product owner: **data-science
honesty pulls toward showing error on everything; usability pulls hard the other
way.** Error bars on every KPI, a CI band on every line, and a caveat chip on
every tile would bury the signal, train users to ignore the chrome, and make a
clean, well-sampled value look as suspect as a junk one — defeating the purpose.
"Error-bars-everywhere" was explicitly ruled out.

Four specialist proposals (`docs/accuracy/_proposals/`: data-science, dataviz,
ui-design, ux) and four adversarial reviews (`docs/accuracy/_reviews/`: stats,
clinical/ResMed, QA, security) were produced and reconciled. The reconciliation —
the single source of truth this ADR records — lives in
[`docs/accuracy/_consensus.md`](../accuracy/_consensus.md) as eleven numbered
decisions (D1–D11). Notable conflicts the reviews surfaced and consensus resolved:
a proposed 5-tier reliability enum (QA blocked it), an incoherent
**median-center-with-mean-SEM-band** statistic (stats + QA both flagged), a
**wrong Poisson reference vector** that would have corrupted unit tests
(stats caught it), an apnea **count** quietly promoted to the `high` tier
(clinical caught it), and a single leak threshold doing two different jobs
(clinical split it). Each is locked below.

This decision is presentation- and analysis-layer architecture. It builds on
[0007](0007-plugin-architecture.md) (plugin/metric shape), [0008](0008-web-workers-heavy-computation.md)
(stats utilities run alongside analysis in workers), [0006](0006-recharts-d3-visualization.md)
(the confidence band reuses the existing recharts/`d3.area` approach), and the
confidence-band precedent set in [0017](0017-app-computed-breathing-pattern-detection.md).

## Decision Drivers

Resolved against the project priority order (Privacy > Correctness > Performance >
UX > Features):

- **Privacy.** No new data egress. Everything here is client-side rendering and
  in-browser statistics over already-imported data; trivially satisfied.
- **Correctness (the dominant driver).** This feature exists *because* the
  current display is misleadingly confident. Every statistic shown must be
  defensible: verified constants, statistically coherent center-and-band pairing,
  intervals labelled as what they actually are (a Poisson interval is a *lower
  bound* on uncertainty, not "the 95% CI"), and **no unverified figures encoded
  as fact**. A reliability label must lower a *precision claim* without ever
  silencing a clinically actionable trend.
- **Performance.** Stats utilities (Poisson/Garwood CI, rolling median + IQR)
  run over years of nightly aggregates; they belong in the worker pipeline and
  must be cheap. Display-precision formatting is presentation-only and must never
  touch stored values.
- **UX — the *quiet-by-default* principle.** A reliability or data-quality cue
  appears **only when it changes a decision**. The absence of a chip on a clean,
  well-sampled metric *is* the trust signal. WCAG AA throughout: every cue is
  keyboard-focusable, ARIA-labelled, and carries a non-color shape — color is
  never the sole signal, and the reliability axis (violet/neutral) never collides
  with the clinical-severity axis (red/orange).
- **Features.** The framework is generic (a `reliability` field on
  `MetricDefinition`, a reusable chip, a reusable band) so future metrics and
  machine plugins inherit it; never at the expense of the above.

## Considered Options

### A. Do nothing — keep displaying confident point values

- **Pro.** Zero work; maximally uncluttered; no risk of the chrome itself
  confusing users.
- **Con.** Directly violates Correctness. The research drafts show the displayed
  numbers carry large, quantified error; presenting them bare systematically
  over-reassures about a health metric. **Rejected.**

### B. Error bars / confidence intervals everywhere

- **Pro.** Maximally honest in the naive sense; every value carries its
  uncertainty.
- **Con.** Buries signal under chrome; trains users to ignore caveats; makes a
  clean value indistinguishable from a junk one; and — per the stats review — a
  naively-computed per-night CI or rolling-mean SEM band is *itself* wrong under
  the data's real structure (over-dispersion, autocorrelation, non-stationarity),
  so it would be confidently-wrong honesty. Explicitly ruled out by the product
  owner. **Rejected.**

### C. Quiet-by-default reliability framework (chosen)

A small, composable set of affordances that surface uncertainty only where it
changes a decision:

1. a **3-state reliability tier** (`high | moderate | low`) generalizing the
   existing breathing-analysis `confidenceTier` vocabulary, with **orthogonal
   per-session data-quality flags** rather than extra tiers;
2. **selective confidence bands** — a median + inter-quartile band on the AHI
   trend (not a band on everything, and not an incoherent mean-SEM band);
3. **precision discipline** — a presentation-layer formatting table that stops
   reporting false precision (e.g. AHI at 2–3 decimals);
4. **help-layer disclosure** — uncertainty framing lives in glossary/help and a
   dedicated article, not as permanent on-screen noise.

- **Pro.** Honest where it matters, quiet where it doesn't; statistically
  coherent; satisfies WCAG AA via non-color cues; reuses existing primitives
  (`confidenceTier`, the recharts band, `MetricDefinition`); extensible.
- **Con.** "Only when it changes a decision" is a judgement call that must be
  encoded as explicit rules and tested; introduces a new shared module and new
  copy tone to maintain; the quiet default risks *under*-warning if the
  decision-relevance rules are mis-tuned (mitigated by the central-apnea safety
  rule and its e2e test, below).
- **Chosen.** It is the only option that honors Correctness *and* the
  quiet-by-default UX constraint simultaneously.

## Decision Outcome

We adopt **Option C**, exactly as reconciled in
[`docs/accuracy/_consensus.md`](../accuracy/_consensus.md). The consensus
decisions D1–D11 are binding; the load-bearing ones:

- **D1 — Reliability tier is 3-state, not 5.**
  `ReliabilityTier = 'high' | 'moderate' | 'low'`, generalizing the existing
  `src/analysis/breathing/confidenceTier.ts` vocabulary. The proposed 5-tier
  enum is rejected (QA block upheld). `ReliabilityTier` (intrinsic reliability)
  and `DataQualityFlag` (`'high-leak' | 'short-session' | 'low-coverage' |
  'low-count'`, a per-session degrading condition) are **orthogonal** and may
  co-occur; "unavailable" is a render state, not a tier. Add `ReliabilityTier`
  as a sibling type in a new shared `reliability` module; **do not widen
  `ConfidenceTier`** — `confidenceTier.ts` keeps working for its existing
  consumers (`ConfidenceBar`, `SignalViewer`, breathing analysis).

- **D2 — Canonical tier → label → icon map.** `high` shows **no chip** (absence
  is the trust signal); `moderate` shows "Estimate" (outline triangle) only when
  decision-relevant; `low` shows "Modeled" (hexagon, reusing the existing
  inferred/detection semantics) on soft metrics; an active data-quality flag
  shows e.g. "Leak-affected" (filled `!`). Reliability/data-quality colours use
  the **violet/neutral** axis (`--color-detection` / `-tecsa-*` family); red/orange
  stay reserved for clinical severity so the two axes never collide.

- **D3 — AHI trend headline statistic: median + IQR band.** Center line is the
  rolling **median** over the window (robust to outlier nights and regime
  changes); the band is the empirical **inter-quartile band (P25–P75)** labelled
  **"typical nightly range"** — *not* a "95% CI of the mean." This sidesteps the
  autocorrelation/non-stationarity problems the stats review raised with
  `x̄ ± z·s/√n`. A median center is **never** combined with a mean SEM band
  (QA + stats both flagged that as incoherent). The optional outer P10–P90 band
  is deferred.

- **D4 — Locked statistical constants (verified unit-test vectors).**
  Two-sided rule-of-three for N=0 at 95% is **3.689 counts** (≈0.615 /h at 6 h),
  never the one-sided 3.0. The corrected Poisson reference vector is
  **N=40, T=6 h → lower 4.7628, upper 9.0781 events/h** (the proposal's 4.2932
  lower was a transcription error; Wolfram-verified). Use exact **Garwood**
  chi-square CI for **N < 20**, normal approx `(N ± z√N)/T` for N ≥ 20. The
  per-night Poisson CI is presented and ARIA-labelled as a **lower bound on
  uncertainty** (events over-disperse; Poisson understates true spread) — and we
  do **not** invent an over-dispersion multiplier (it is not identifiable from a
  single night and would be a fabricated constant).

- **D5 — Per-metric tiers (clinical corrections applied).**
  `high` (no chip, shown with precision): delivered/measured pressure; usage /
  mask-on time; unintentional leak below threshold.
  `moderate` (algorithmically detected, leak-gated): apnea **count** (corrected
  *down* from the proposals' `high` — it is detected, undercounts vs PSG, and
  uses a mask-on denominator), aggregate AHI, hypopnea count, tidal volume /
  minute ventilation / respiratory rate.
  `low` ("surface, don't diagnose"): central-vs-obstructive split,
  flow-limitation index/%, RERA, all consumer-wearable SpO₂ and multi-stage
  sleep.

- **D6 — Quiet-by-default + central-apnea safety.** A chip appears **only** when
  it changes a decision (low-tier soft metric, active data-quality flag, or a
  single night near a category boundary) — never on a stable, well-sampled
  `high`-tier value. Critically: **a `low` tier lowers the *precision* claim; it
  must NEVER silence or visually bury a rising trend.** A rising central
  (Clear-Airway) index must still surface a visible "discuss with your clinician"
  prompt despite the split being `low` reliability — under-reaction to
  treatment-emergent central apnea is the dangerous failure mode. This uses a
  dedicated **clinical-flag** copy tone, distinct from the reliability chip, and
  is guarded by a mandatory **e2e acceptance test**.

- **D7 — Split leak gate.** **24 L/min** drives a user-facing **data-quality
  notice** (matches the device's own red-zone convention); **30 L/min** is the
  threshold at which flow-derived metrics (Vt, MV, RR, flow-limitation) are
  actually flagged/suppressed — graduated, not a cliff, so usable 24–30 data is
  not over-suppressed. Both are **named constants in one module**, consolidating
  the ~8 scattered `24` literals; both are documented as **device conventions,
  cited as such**, not AASM standards.

- **D8 — Gate reliability on event count N, not session hours.** AHI precision is
  driven by event count, so the "stable AHI" gate keys on **N (and N per rare
  class)**, not the borrowed 4 h compliance artifact: a rare-class split needs
  **≥20 total and ≥5 rare-class** events; short windows are flagged by effective N.

- **D9 — Display precision (presentation-layer only; never round stored values).**
  A `formatMetric` table sets resolution per metric (AHI/sub-indices/RDI/ODI →
  1 dp /h; pressure → 1 dp cmH₂O per ISO 80601-2-70; leak → integer L/min;
  tidal volume → integer mL; **T90 → integer minutes**, corrected from 1 dp;
  event counts → exact integer). Fix the real offenders rendering AHI at 2–3 dp:
  `ReportService.ts:1072`, `export.worker.ts:124-125`, `PressureOptimization.tsx:304`.

- **D10 — Do NOT encode unverified `[?]` figures.** FOT amplitude (~1 cmH₂O),
  pressure ± tolerance (±0.5+4%), the 0.2 cmH₂O resolution figure, the 42 L/min
  S9-era leak figure, and placeholder detection-error numbers must **not** be
  stated as fact in logic or copy. Where used at all, mark as device convention
  with a citation, behind a named constant flagged for `resmed-specialist`
  verification.

- **D11 — First-PR scope** (single PR on `claude/peaceful-mccarthy-takofw`):
  the `formatMetric` precision helper + the three offenders + T90; the shared
  `reliability` module (`ReliabilityTier`, `reliabilityTier(metricId, ctx)`,
  leak-gate constants, data-quality flags); stats utils (`poissonRateCI`,
  `inverseChiSquare`/`lowerGammaRegularized`, rolling median + IQR) with the D4
  vectors; a focusable, non-color, ARIA `ReliabilityChip` shown only per D2/D6;
  KPI integration (soft metrics only) + the AHI median+IQR band; split leak-gate
  constants + data-quality notice; the always-visible central-apnea clinical
  flag; in-app help (a `reliability` field on `MetricDefinition`, `uncertainty`
  framing on soft glossary entries, one "Understanding measurement uncertainty"
  article); and the full test set. The **5-tier system, full DataQualityNotice
  framework, PDF hatch bands, per-point error bars, P10–P90 outer band, and
  cross-mode (ASV/AirMini) caveat expansion are deferred.**

## Consequences

### Positive

- **Honest where it matters, quiet where it doesn't.** Users see uncertainty
  exactly when it changes a decision and a clean metric stays uncluttered — the
  Correctness win without the error-bars-everywhere cost the product owner ruled out.
- **Statistically coherent.** Median center with an IQR "typical nightly range"
  band, exact Garwood for small N, a Poisson interval honestly labelled as a
  *lower bound*, and Wolfram-verified test vectors — no double-counting, no
  incoherent median+SEM pairing, no fabricated over-dispersion multiplier.
- **Clinically safe by construction.** A `low` tier never silences a rising
  central-apnea trend; the dangerous failure mode (under-reaction to TECSA) is
  guarded by a dedicated clinical-flag tone *and* an e2e test.
- **No false precision.** AHI stops rendering at 2–3 decimals; T90 stops
  rendering sub-minute; precision is fixed at the presentation layer without
  touching stored values.
- **Accessible.** Every cue is focusable, ARIA-labelled, and carries a non-color
  shape; the reliability axis (violet/neutral) is visually disjoint from the
  clinical-severity axis (red/orange).
- **Reuses and generalizes.** Builds on `confidenceTier.ts`, the recharts/`d3.area`
  band, and `MetricDefinition`; future metrics and machine plugins inherit the
  framework.
- **No privacy cost.** Pure client-side rendering and in-browser statistics.

### Negative

- **"Only when it changes a decision" is a judgement encoded as rules.** The
  decision-relevance and gating thresholds (D6, D8) must be explicit and tested;
  mis-tuning them risks under-warning. This is the cost of the quiet default and
  is the reason the central-apnea safety rule is non-negotiable and e2e-guarded.
- **The per-night Poisson interval is, and must stay labelled as, a lower
  bound.** It is narrower than true uncertainty; if the "lower bound" labelling
  is ever lost in copy or ARIA, the display becomes over-confident again.
- **New surface area.** A shared `reliability` module, a new chip component, a new
  clinical-flag copy tone, and stats utilities all add code, tests, and theming
  to maintain.
- **The window band can still hide a regime change.** A trailing median/IQR over
  a pressure or mask change blends two distributions; change-point-aware window
  splitting is acknowledged but largely deferred, so non-stationarity within a
  window remains a known sharp edge.

### Neutral

- **The 5-tier system is deferred, not deleted.** Should richer differentiation
  prove necessary, `ReliabilityTier` can widen later; the orthogonal
  data-quality-flag split means much of what the 5-tier proposal wanted is
  already expressible without more tiers.
- **`ConfidenceTier` and `ReliabilityTier` coexist deliberately.** The former
  stays scoped to its existing breathing-analysis consumers; the latter is the
  app-wide presentation concept. Two types, two scopes, by design.
- **Several device figures stay behind `[?]` constants pending verification.**
  Their `resmed-specialist`-verification flags are an accepted interim state, not
  a deviation — D10 forbids stating them as fact until verified.
- **Help-content ownership is split.** The framework supplies the `reliability`
  field and tone slots; the `documentation` agent owns the glossary `uncertainty`
  framing and the "Understanding measurement uncertainty" article.

## Confirmation

How adherence to this decision is verified:

- **Unit tests against verified vectors.** `poissonRateCI` /
  `inverseChiSquare` / `lowerGammaRegularized` and the rolling median + IQR util
  are tested against the D4 Wolfram-verified constants (notably N=40, T=6 →
  4.7628 / 9.0781, and N=0 two-sided → 3.689 counts), with the Garwood-vs-normal
  switch at N=20 exercised on both sides.
- **Precision regression tests.** Assertions that `formatMetric` renders each
  metric at its D9 resolution and that the three offenders no longer emit 2–3-dp
  AHI; a guard that formatting never mutates stored values.
- **Component a11y tests.** `ReliabilityChip` is keyboard-focusable, exposes its
  ARIA label, carries the correct non-color shape per D2, and is suppressed on
  `high`-tier values per D6.
- **e2e central-apnea safety test (mandatory, per D6).** A Playwright test
  asserting that a rising Clear-Airway index surfaces a visible
  "discuss with your clinician" clinical-flag prompt **even when** the
  central/obstructive split is `low` reliability — i.e. the `low` tier lowers
  precision without silencing the safety flag.
- **QA gate.** No code merges until `qa` signs off that D1–D11 are honored
  (3-state tier, no widened `ConfidenceTier`, coherent median+IQR pairing, no
  false precision); QA can block.
- **Security/privacy gate.** `security` confirms no new data egress, no
  unverified figures encoded as fact (D10), and no PII in copy or logs.

## References

- [`docs/accuracy/_consensus.md`](../accuracy/_consensus.md) — **source of
  truth**; the reconciled decisions D1–D11.
- Proposals — [`docs/accuracy/_proposals/datascience-proposal.md`](../accuracy/_proposals/datascience-proposal.md),
  [`dataviz-proposal.md`](../accuracy/_proposals/dataviz-proposal.md),
  [`ui-design-proposal.md`](../accuracy/_proposals/ui-design-proposal.md),
  [`ux-proposal.md`](../accuracy/_proposals/ux-proposal.md).
- Reviews — [`docs/accuracy/_reviews/stats-review.md`](../accuracy/_reviews/stats-review.md),
  [`clinical-review.md`](../accuracy/_reviews/clinical-review.md),
  [`qa-review.md`](../accuracy/_reviews/qa-review.md),
  [`security-review.md`](../accuracy/_reviews/security-review.md).
- Reference drafts — [`docs/accuracy/_drafts/cpap-device-accuracy.md`](../accuracy/_drafts/cpap-device-accuracy.md),
  [`uncertainty-statistics.md`](../accuracy/_drafts/uncertainty-statistics.md),
  [`wearable-accuracy.md`](../accuracy/_drafts/wearable-accuracy.md).

## Related Decisions

- [0006 — Recharts + D3 for Visualization](0006-recharts-d3-visualization.md) — the confidence band reuses the existing band approach.
- [0007 — Plugin Architecture](0007-plugin-architecture.md) — `MetricDefinition` gains a `reliability` field.
- [0008 — Web Workers for Heavy Computation](0008-web-workers-heavy-computation.md) — stats utilities run in the worker pipeline.
- [0015 — Zero Telemetry and Analytics](0015-zero-telemetry-analytics.md) — no new data egress.
- [0017 — App-Computed Breathing-Pattern Detection](0017-app-computed-breathing-pattern-detection.md) — establishes the explicit-confidence / "candidate, never diagnosis" precedent this framework generalizes.
