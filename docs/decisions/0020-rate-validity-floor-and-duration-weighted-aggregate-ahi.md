# 0020 — Rate-Validity Recording-Time Floor and Duration-Weighted Aggregate AHI

## Status

Accepted

- **Date:** 2026-06-18
- **Deciders:** `data-science` (lead), with `orchestrator` coordination.

## Context

AHI, RDI, ODI, and the central/obstructive/mixed/hypopnea/RERA/unclassified
sub-indices are all **per-hour rates**: an event count divided by a duration
(`count / usageHours`, or for ODI `count / validOximetryHours`). A rate is only
meaningful when its denominator is large enough that dividing by it interpolates
rather than extrapolates.

A confirmed bug made this concrete. A **~5-minute mask-fit session** (usage
hours ≈ 0.083 h) containing **one** unnoticed event produced an
**AHI of 3600**: a single event divided by `1/3600` of an hour. That figure is
not a noisy estimate of the patient's AHI — it is **mathematically meaningless**,
an extrapolation of a per-second observation onto an hour the recording never
covered. Because per-night metrics are computed at import time and then consumed
everywhere, this one value **poisoned downstream consumers**: it dominated the
nightly trend chart's y-axis, distorted the aggregate AHI (an unweighted mean
that gave this 5-minute night the same weight as an 8-hour night), and appeared
verbatim in exported CSV and PDF reports. It is a Correctness failure of the kind
this project ranks second only to Privacy.

The codebase already contained **prior art for the underlying principle but
applied inconsistently**. `MIN_CENTRAL_USAGE_HOURS = 1` in
`src/views/Trends/utils/centralTrend.ts` already excludes nights shorter than
one hour from the central-index trend, explicitly "for rate stability" — but
nothing enforced the same discipline for AHI itself, for the aggregate, or at
the point where the per-hour quotient is formed. There was also **no single
choke point** for per-hour index computation: `count / hours` was open-coded in
several places, so any new index could silently reintroduce the same unguarded
division.

Two **adjacent thresholds already in `src/analysis/uncertainty/constants.ts`**
are easy to confuse with the floor this ADR introduces, and conflating any of
them would be a correctness error in its own right:

- `SHORT_SESSION_HOURS = 4` — the CMS **compliance/adherence** floor.
- `POISSON_NORMAL_APPROX_MIN_COUNT = 20` — the event-**count precision** gate
  governing confidence-interval width (per [0018](0018-measurement-uncertainty-reliability-display.md)).

This decision is analysis- and type-layer architecture. It builds directly on
[0018](0018-measurement-uncertainty-reliability-display.md) (the
measurement-uncertainty framework and its `uncertainty` module) and shares its
Correctness-dominant posture; it relates to
[0016](0016-session-identity-non-unique-machine-date-index.md) (multiple short
sessions per day are a domain invariant, so sub-floor recordings are common, not
anomalous).

## Decision Drivers

Resolved against the project priority order (Privacy > Correctness > Performance >
UX > Features):

- **Correctness (the dominant driver).** A per-hour rate with a near-zero
  denominator is undefined, not imprecise; presenting it as a number — any
  number, including a clamped one — is a lie about the data. The aggregate must
  also be the statistically correct combination of unequal-duration rates.
- **Privacy / Performance.** Untouched: pure in-browser arithmetic over
  already-imported aggregates; no egress, negligible cost.
- **UX.** An undefined rate must read as "insufficient recording time," visually
  distinct from a genuine zero (a real, fully-recorded night with no events) and
  never silently dropped without trace in tables, cards, CSV, and PDF.
- **Features.** A single enforced choke point so future indices inherit the
  guarantee for free.

## Considered Options

### A. What to do with a sub-floor per-hour index

- **Clamp / cap the value** (e.g. ceil AHI at some maximum). Hides the symptom,
  keeps a fabricated number in the data, and picks an arbitrary cap. **Rejected.**
- **Coerce to 0.** Actively wrong: a 5-minute night with an event did _not_ have
  zero events. Collides a "no defined rate" state with a real, clinically
  meaningful zero. **Rejected.**
- **Represent as `null` ("no defined rate") below a recording-time floor
  (chosen).** Honest, distinguishable from a true zero, and forces every
  consumer to make an explicit decision about missing data.

### B. Where to set the floor

- **Reuse `SHORT_SESSION_HOURS = 4`.** Wrong axis. Compliance asks "did the
  patient use the machine long enough _to count_?"; rate-validity asks "is the
  recording long enough for a per-hour rate _to mean anything_?" A 2-hour night
  is non-compliant yet yields a perfectly stable AHI — discarding its rate would
  destroy valid clinical signal. **Rejected.**
- **Derive from event count (reuse `POISSON_NORMAL_APPROX_MIN_COUNT`).**
  Orthogonal concern. Count-precision governs how _wide_ the interval is _given_
  a valid rate; it says nothing about whether a rate _exists_. 0 events over
  1 second is a perfectly precise count and still an undefined rate. **Rejected.**
- **One hour, `MIN_INDEX_USAGE_HOURS = 1` (chosen).** Matches the existing
  `MIN_CENTRAL_USAGE_HOURS = 1` precedent, giving one coherent rate-stability
  rule across the app. Crucially, a denominator ≥ 1 h guarantees the quotient can
  **never exceed the raw event count** — the runaway-amplification failure mode
  (1 event → 3600) becomes **structurally impossible** above the floor, not merely
  unlikely.

### C. ODI floor (oximetry is often a partial-night probe)

- **A lower, ODI-specific floor.** Tempting because oximetry may only cover part
  of the night, so valid-oximetry hours are systematically smaller. **Rejected**
  in favor of a single, uniform rate-validity contract: the runaway-amplification
  argument applies to ODI's denominator identically, and one floor is far easier
  to reason about and test than two. Documented here as a genuinely considered
  alternative; existing ODI tests were updated to use ≥ 1 h windows accordingly.

### D. Combining per-night rates into an aggregate

- **Unweighted `mean(nightly_ahi)` (status quo).** Over-weights short nights: a
  20-minute night counts as much as an 8-hour night. Statistically wrong for
  rates of unequal duration, _independently_ of the sub-floor bug. **Rejected.**
- **Duration-weighted pooled rate (chosen).**
  `Σ(ahi_i × usageHours_i) / Σ(usageHours_i)`, which is algebraically the pooled
  `Σevents / Σhours` — the correct way to combine per-hour rates of unequal
  duration.

## Decision Outcome

Three coordinated decisions, all gated on the same import-time computation.

### Decision 1 — Rate-validity recording-time floor (`MIN_INDEX_USAGE_HOURS = 1`)

We add `MIN_INDEX_USAGE_HOURS = 1` (hour) to
`src/analysis/uncertainty/constants.ts`. When a per-hour index's denominator —
usage hours for AHI/RDI/sub-indices, valid-oximetry hours for ODI — is **below
the floor**, the index is represented as **`null` ("no defined rate")**, never 0
and never a clamped number.

The floor is **distinct** from, and must not be conflated with, two adjacent
thresholds:

- **It is NOT `SHORT_SESSION_HOURS = 4` (the CMS compliance/adherence floor).**
  Compliance answers "did the patient use the machine long enough to count?"; the
  rate floor answers "is the recording long enough for a per-hour rate to mean
  anything?" A 2-hour night is non-compliant yet has a perfectly stable AHI — its
  rate is kept.
- **It is NOT `POISSON_NORMAL_APPROX_MIN_COUNT` (the event-count precision
  gate).** That governs how _wide_ a confidence interval is _given_ a valid rate;
  the floor governs whether a rate _exists at all_. Count-precision and
  time-validity are orthogonal — 0 events over 1 second is a precise count and an
  undefined rate.

**Why one hour.** It matches the existing `MIN_CENTRAL_USAGE_HOURS = 1`
precedent in `src/views/Trends/utils/centralTrend.ts` ("for rate stability"),
unifying the app on one rate-stability rule. And a denominator ≥ 1 h guarantees
`count / hours ≤ count`, so the quotient can never amplify a small count into a
runaway figure — the bug's mechanism is eliminated structurally.

**ODI.** The same principle applies to ODI, whose denominator is valid-oximetry
hours. ODI is nulled when valid-oximetry hours are below the floor **and** when
SpO₂ coverage is below `SPO2_COVERAGE_MIN`. We considered a lower ODI-specific
floor (oximetry is often a partial-night probe) but chose the uniform 1-hour
floor for a single coherent rate-validity contract and because the
runaway-amplification argument applies identically (see Option C).

### Decision 2 — Duration-weighted pooled aggregate AHI

The aggregate AHI changes from the unweighted `mean(nightly_ahi)` to the
**duration-weighted pooled rate**:

```
meanAHI = Σ(ahi_i × usageHours_i) / Σ(usageHours_i)
```

which is algebraically the pooled `Σevents / Σhours`, the statistically correct
combination of per-hour rates of unequal duration. **This correctness holds
independently of the short-session bug** — the old unweighted mean over-weighted
short nights regardless. The helper **`pooledRate()` in
`src/analysis/uncertainty/rateIndex.ts`** enforces it and **excludes null-rate
nights** (a null night contributes neither events nor hours). Median, trend %,
and the sparkline/trend series likewise **exclude null nights**, which are
**rendered as gaps**. This replaces the unweighted mean wherever it was computed:
`src/hooks/useSummaryStats.ts`, `src/services/reports/ReportService.ts`,
`src/stores/useDataStore.ts`, and `src/services/workers/export.worker.ts`.

### Decision 3 — Per-session index nullability contract (breaking type change)

In `src/types/session.ts`, `NightlyAggregate.ahi`, `.rdi`, and the six `.ahi*`
sub-index fields change from `number` to **`number | null`** (ODI was already
nullable). The **consumer contract** (~25 sites updated) is:

- **Skip nulls in reductions** — means, min/max, trend, correlation. Use listwise
  or pairwise deletion; for paired analyses (correlation, scatter) **drop the
  whole pair** when either member is null.
- **Render null as an explicit "insufficient recording time" indicator** — "—" in
  tables and cards; the literal **"insufficient data"** in CSV and PDF.
- **Never coerce null to 0.**

**Centralization.** All per-hour index computation now flows through a single
helper — **`rateIndex()` in `src/analysis/uncertainty/rateIndex.ts`** — that
enforces the floor. Future indices cannot reintroduce an unguarded
`count / hours`; the guarantee is structural, not a convention.

## Consequences

### Positive

- **The runaway-amplification bug is structurally impossible.** Above a 1-hour
  denominator, a per-hour index can never exceed its event count; the
  `1 event → 3600` mechanism cannot recur.
- **No fabricated numbers.** An undefined rate is `null`, honestly distinguished
  from a real zero and from a precise-but-imprecise estimate — neither clamped
  nor coerced.
- **Statistically correct aggregate.** The duration-weighted pooled mean is the
  right combination of unequal-duration rates and stops short nights from
  dominating — a fix that stands on its own, independent of the bug.
- **One enforced choke point.** `rateIndex()` makes the floor unavoidable for any
  present or future per-hour index; `pooledRate()` does the same for aggregation.
- **One coherent rule.** The app now applies a single rate-stability floor,
  consistent with the pre-existing `MIN_CENTRAL_USAGE_HOURS` precedent, instead
  of guarding rate validity in one trend and nowhere else.
- **No privacy or performance cost.** Pure in-browser arithmetic over existing
  aggregates.

### Negative

- **Re-import is required to heal already-imported short nights.** Per-night
  metrics are computed at import time, so previously-imported sub-floor nights
  keep their inflated numbers until the user re-imports, at which point they
  switch to `null`. This must be communicated; it cannot be back-filled without
  recomputation.
- **A breaking type change with broad reach.** Widening eight fields to
  `number | null` forced updates at ~25 consumer sites; any missed site that
  coerces or fails to skip null is a latent correctness defect, so the change
  leans hard on type-checking and tests.
- **Sample size `n` legitimately shrinks.** Statistics that exclude sub-floor
  nights now report a smaller denominator than before. This is correct but means
  some figures will differ from historical values for reasons unrelated to
  therapy.
- **The pooled mean differs from the old unweighted mean** whenever nights have
  unequal usage — a visible, intentional change in a headline number that must be
  explained rather than presented as a silent drift.

### Neutral

- **The 1-hour floor is a deliberate, defensible threshold, not a derived
  constant.** It is justified by the structural `count / hours ≤ count`
  guarantee and the existing precedent; it can be revisited, but it is a single
  documented choice rather than a tunable.
- **`MIN_INDEX_USAGE_HOURS` and `MIN_CENTRAL_USAGE_HOURS` coexist at the same
  value by design.** The former is the app-wide rate-validity floor at the
  computation choke point; the latter remains scoped to the central-trend view.
  Equal value, distinct scope.
- **The floor and the [0018](0018-measurement-uncertainty-reliability-display.md)
  count-precision machinery are complementary.** The floor decides whether a rate
  exists; the uncertainty framework decides how precisely a rate that _does_
  exist is known. They operate on orthogonal axes and both remain in force.

## Implementation References

- `src/analysis/uncertainty/constants.ts` — `MIN_INDEX_USAGE_HOURS = 1`, alongside
  the distinct `SHORT_SESSION_HOURS`, `POISSON_NORMAL_APPROX_MIN_COUNT`, and
  `SPO2_COVERAGE_MIN`.
- `src/analysis/uncertainty/rateIndex.ts` — `rateIndex()` (single floor-enforcing
  choke point) and `pooledRate()` (duration-weighted aggregate, null-excluding).
- `src/views/Trends/utils/centralTrend.ts` — pre-existing `MIN_CENTRAL_USAGE_HOURS = 1`
  precedent this floor generalizes.
- `src/types/session.ts` — `NightlyAggregate.ahi`, `.rdi`, and the six `.ahi*`
  fields widened to `number | null` (ODI already nullable); the consumer contract
  documented inline.
- `src/hooks/useSummaryStats.ts`, `src/services/reports/ReportService.ts`,
  `src/stores/useDataStore.ts`, `src/services/workers/export.worker.ts` — aggregate
  AHI switched from unweighted mean to `pooledRate()`.

## Related Decisions

- [0016 — Sessions Identified by `id`, Not `(machineId, date)`](0016-session-identity-non-unique-machine-date-index.md) — multiple short sessions per day are a domain invariant, so sub-floor recordings are expected, not anomalous.
- [0018 — Measurement-Uncertainty / Reliability-Display Framework](0018-measurement-uncertainty-reliability-display.md) — the `uncertainty` module this floor lives in; the count-precision gate this floor is orthogonal to; the shared Correctness-dominant posture.
