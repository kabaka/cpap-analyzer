# 0022 — Sleep-Stage- and Sleep-Cycle-Aware Respiratory-Event Analysis

## Status

Accepted

- **Date:** 2026-06-20
- **Deciders:** `data-science` (lead), with `ux`, `frontend`, and `orchestrator` coordination.

## Context

The app already lets users explore individual respiratory events in the **Event
Explorer** (`src/views/Explore/EventExplorer/`), which carries a mature query,
loading, and export stack: `queryEngine.ts`, `querySerialization.ts`,
`savedQueries.ts`, `useExplorerEvents.ts`, `exportEvents.ts`, and a set of
result "lenses" (`ResultsViews.tsx`, `histogram.ts`). Separately, the app can
import **consumer-wearable sleep data** — Fitbit and Google Health — strictly
opt-in per [0015](0015-zero-telemetry-analytics.md), surfaced today through
`useWearableData.ts` / `useWearableLanes.ts` as **sleep-stage hypnograms**
(wake / light / deep / REM) and **intraday heart rate**.

These two data streams are currently siloed. A user can see _that_ an apnea
occurred and _that_ they were (per the wearable) in REM, but the app does no
**stage- or cycle-resolved** analysis: it cannot answer "are my events
concentrated in REM?", "is my OSA REM-predominant?", "does my AHI differ between
REM and NREM across nights?", or "what does my heart rate do in the seconds
after an event?" This is exactly the analysis a clinically literate patient
expects, and the constituent inputs are already in the browser.

There is strong domain precedent for what the **right** computation is, and what
the **wrong** computation would be. Sleep is organized into **ultradian
NREM–REM cycles** (Feinberg & Floyd 1979); REM-predominant obstructive sleep
apnea is a recognized phenotype defined by an **AHI_REM/AHI_NREM ratio ≥ 2**
(with non-trivial NREM disease); and obstructive events provoke a characteristic
**post-event cyclical-variation-of-heart-rate (CVHR) / autonomic surge**
(Guilleminault 1984; Stein & Pu 2012). Crucially, however, **consumer wearables
do not perform polysomnography-grade staging** — they infer stages from
actigraphy and photoplethysmography with materially lower agreement against PSG
than EEG-based scoring. Any output built on these stages is therefore
**approximate**, and the project's Correctness principle requires that the
approximation be made visible rather than laundered into apparent precision.

The codebase establishes two patterns this decision must follow:

- **Analysis/hook split** — pure, IO-free statistics live under `src/analysis/*`
  (e.g. `breathing`, `correlation`, `hypothesis`, `math`) and are reached through
  hooks that do the IndexedDB loading (the `useBreathingEpisodes.ts` ↔
  `src/analysis/breathing/` split established in
  [0017](0017-app-computed-breathing-pattern-detection.md)). Statistics modules
  never touch storage.
- **Shared statistical primitives** — `src/analysis/hypothesis` already exports
  **Wilcoxon signed-rank** (with effect size), Mann-Whitney U, and paired
  comparisons; `src/analysis/math` provides `normalCDF`, `lnGamma`, and related
  special functions. New tests must **reuse** these, not re-implement them.

A foundational data convention also applies: events and wearable samples are
aligned on the established **wall-clock-as-UTC** time base shared across the
import pipeline. Stage/event/HR correlation depends entirely on that single
convention holding; this ADR adopts it rather than inventing a second clock.

This decision concerns algorithm selection and the placement of clinical
computation. It builds on [0001](0001-client-side-architecture.md) (client-side
only), [0015](0015-zero-telemetry-analytics.md) (no egress; integrations
opt-in), [0017](0017-app-computed-breathing-pattern-detection.md) (the
analysis/hook split and "candidate, never diagnosis" framing), and
[0018](0018-measurement-uncertainty-reliability-display.md) (the
measurement-uncertainty / reliability-display posture it inherits).

## Decision Drivers

Resolved against the project priority order (Privacy > Correctness > Performance >
UX > Features):

- **Privacy.** Wearable data is already opt-in and local; all stage/cycle
  computation runs in-browser over already-imported samples. No egress is
  introduced. Satisfied trivially by keeping statistics in a pure module.
- **Correctness (the dominant driver here).** Two distinct correctness risks:
  (a) the **statistics** must be the right tests for the question — concentration
  vs. uniform expectation, paired across nights, ratio thresholds matched to the
  literature; and (b) the **provenance** must be honest — consumer staging is not
  PSG, and every output must carry that uncertainty and avoid any diagnostic
  claim.
- **Performance.** Inputs are coarse (stage segments and ~per-minute/per-5-s HR),
  not 25 Hz envelopes, so cost is modest; but the module must still be cheap
  enough to recompute on filter changes within the Explorer.
- **UX.** The capability should appear **where users already analyse events**,
  reusing the query/filter/export they know, rather than forcing them to learn a
  new top-level tool.
- **Features.** A pure, well-typed analysis module that future views (trends,
  reports) can also consume — without binding the math to one screen.

## Considered Options

### A. Placement: new top-level tool vs. a lens inside the Event Explorer

- **A dedicated top-level "Sleep Stages" view.** Pro: maximum visual real estate;
  clean mental separation. Con: **proliferates tools**, duplicates the Explorer's
  query/loading/export infrastructure, and splits "analysing my events" across
  two places the user must keep in sync. Runs against the product principle of
  integrating into existing UI rather than multiplying surfaces.
- **A new "Sleep stages & cycles" lens inside the Event Explorer (chosen).** The
  lens slots alongside the existing result views (`ResultsViews.tsx`), consuming
  the **same filtered event set** the user already built via `queryEngine.ts` /
  `useExplorerEvents.ts`, and inheriting saved queries, serialization, and CSV
  export for free. Pro: zero infra duplication; the stage analysis automatically
  respects whatever event filter is active; one coherent place to reason about
  events. Con: constrained to the Explorer's layout and lifecycle, and couples a
  new analysis to that view's evolution.

### B. Layering: where the statistics live

- **Compute inline in the lens component / hook.** Fastest to ship; makes the
  math untestable in isolation, entangles it with React lifecycle and IndexedDB,
  and prevents reuse by trends/reports. **Rejected** — violates the established
  analysis/hook split.
- **Pure IO-free analysis module + a thin loading hook (chosen).** All statistics
  live in **`src/analysis/sleepStages/`** as pure functions over plain inputs
  (`StageSegment[]`, `HrSample[]`, and the filtered events); a **separate React
  hook** performs the IndexedDB reads and assembles those plain inputs. This
  mirrors `useBreathingEpisodes.ts` ↔ `src/analysis/breathing/` exactly and makes
  the math **fully unit-testable** against known fixtures with no mocking of
  storage.

### C. Sleep-cycle derivation: how to define a "cycle" without EEG

- **PSG-grade cycle scoring.** The clinically rigorous option. **Rejected** — it
  requires EEG-based epoch scoring we fundamentally do not have; applying PSG
  cycle rules to consumer stages would imply a precision the inputs cannot
  support.
- **Fixed ~90-minute windows.** Simple and deterministic. **Rejected** — it
  ignores individual sleep architecture (cycle length varies within and between
  people and lengthens across the night), so it would mislabel REM episodes and
  cycle boundaries for most users.
- **Hypnogram-driven heuristic from REM episodes (chosen).** Derive cycles from
  the wearable hypnogram via a **documented heuristic** grounded in the Feinberg
  & Floyd (1979) NREM–REM cycle definition: a **REM episode** is a maximal run of
  REM **merged across gaps ≤ 15 min**; **cycle boundaries** fall at successive
  REM-episode ends; the **trailing NREM** after the last REM episode is treated
  as an **incomplete final cycle**. This adapts to the individual's actual
  architecture while staying explicitly a heuristic, not a scoring claim.

### D. Statistical methods for the stage/event questions

- **Ad-hoc proportions / eyeballing.** Cheap but unprincipled; gives no
  significance or effect size and is easy to over-read. **Rejected.**
- **Literature-matched tests reusing existing primitives (chosen).** Each
  question gets the test it warrants, and all of them build on
  `src/analysis/math` and `src/analysis/hypothesis` rather than new statistics
  code — see Decision Outcome.

## Decision Outcome

**1. Ship as a new "Sleep stages & cycles" lens inside the Event Explorer**
(`src/views/Explore/EventExplorer/`), not a dedicated top-level view. The lens
consumes the **already-filtered event set** from the Explorer's query stack
(`queryEngine.ts`, `useExplorerEvents.ts`) and inherits its saved-query,
serialization, and export infrastructure. This keeps event analysis in one place
and avoids tool proliferation.

**2. Put all statistics in a pure, IO-free module `src/analysis/sleepStages/`,
fed by a separate loading hook.** The module operates on plain inputs —
**`StageSegment[]`** (stage, start, end from the wearable hypnogram),
**`HrSample[]`** (timestamp, bpm from intraday HR), and the filtered events — and
returns plain results. A **dedicated React hook** does the IndexedDB loading
(via the existing wearable access patterns behind `useWearableData.ts`) and
builds those inputs. The module is **fully unit-tested** against fixtures; it
imports no storage, no React, and no worker plumbing. This mirrors the
[0017](0017-app-computed-breathing-pattern-detection.md) analysis/hook split.

**3. Derive sleep cycles from the hypnogram via a documented heuristic
(Feinberg & Floyd 1979).** A **REM episode** = a maximal run of REM stage,
**merging gaps ≤ 15 min** into one episode; **cycle boundaries** are placed at
successive REM-episode ends; the **trailing NREM** after the final REM episode is
an **incomplete final cycle**. The heuristic is explicitly labelled as such in
both code documentation and user-facing help — it is a structural approximation
from coarse consumer stages, **not** PSG cycle scoring (Option C).

**4. Use literature-matched statistics, reusing existing primitives.** Across the
filtered events and the stage/HR series:

- **Chi-square goodness-of-fit** for **event concentration across stages**, with
  expected counts **proportional to time-in-stage** (the null = events
  distributed uniformly over the time the user actually spent in each stage). The
  test reuses `src/analysis/math` (`lnGamma` / the gamma–based χ² tail) rather
  than a new implementation.
- **REM-predominant OSA ratio** — `AHI_REM / AHI_NREM`, flagged
  **REM-predominant at ratio ≥ 2** per the phenotype literature, with the
  standard guard that NREM disease be non-trivial so the ratio is meaningful.
- **Wilcoxon signed-rank** for **REM-vs-NREM AHI across nights** (paired by
  night), reusing the **existing `wilcoxon` export in
  `src/analysis/hypothesis`**, which already reports an effect size alongside the
  p-value per the module's AASM-aware convention.
- **Event-triggered HR averaging** for the **autonomic / CVHR response**
  (Guilleminault 1984): align intraday HR to each event onset and average across
  events to expose the post-event heart-rate surge/cyclical variation.

**5. All output is presented with explicit staging uncertainty and is never
diagnostic.** Consumer-wearable staging is approximate relative to PSG; every
result the lens shows carries that caveat (inheriting the
[0018](0018-measurement-uncertainty-reliability-display.md) reliability-display
posture and the [0017](0017-app-computed-breathing-pattern-detection.md)
"candidate, never diagnosis" framing). The clinical interpretation of
REM-predominant OSA and CVHR belongs in **help content** (`documentation` owns
it), referenced here so the linkage is on the record.

**6. Time alignment uses the established wall-clock-as-UTC convention** shared by
events and wearable samples. The module assumes both streams are already on that
single time base and does no second clock reconciliation; correctness of every
stage/event/HR join rests on that convention, which this ADR adopts rather than
re-derives.

## Consequences

### Positive

- **Capability lands where users already work.** The lens reuses the Explorer's
  query, saved-query, serialization, and export stack and automatically respects
  the active event filter — no duplicated infrastructure, no second place to keep
  in sync.
- **The math is pure and testable.** `src/analysis/sleepStages/` has no IO,
  React, or worker dependency, so it is unit-tested against fixtures with known
  expected values, and is reusable by future trends/reports views.
- **Right tests for the questions.** χ²-against-time-in-stage, the literature
  REM-predominance ratio (≥ 2), paired Wilcoxon across nights, and event-
  triggered HR averaging each match an established method, and the statistics
  reuse `math`/`hypothesis` rather than forking new implementations.
- **Cycles adapt to the individual.** The hypnogram-driven heuristic follows each
  user's actual REM architecture instead of imposing a fixed window.
- **No privacy or egress cost.** Pure in-browser computation over already-opt-in,
  already-local wearable data.

### Negative

- **Outputs are only as good as consumer staging.** REM/NREM labels from Fitbit /
  Google Health diverge from PSG, so the AHI_REM/AHI_NREM ratio, the χ² result,
  and the cycle boundaries all inherit that error. Mitigated by mandatory
  uncertainty framing and the no-diagnosis stance, but the residual risk is real
  and is why Correctness is the dominant driver.
- **The cycle definition is a heuristic, not a standard.** The ≤ 15-min merge and
  REM-end boundary rule are defensible and documented, but a different reasonable
  heuristic would draw different boundaries; results are sensitive to this choice
  and must be presented as such.
- **The lens degrades when wearable coverage is thin.** Nights without imported
  stage/HR data, or with sparse stages, yield low-power or unavailable results
  (especially the paired Wilcoxon and event-triggered HR average, which need
  enough nights/events). This must be communicated honestly, not guessed.
- **Coupling to the Event Explorer's lifecycle.** Living inside the Explorer ties
  the new analysis to that view's layout and evolution; a future need for more
  room or a standalone entry point would require revisiting placement.

### Neutral

- **Time alignment is inherited, not solved here.** The module trusts the shared
  wall-clock-as-UTC convention; any future change to that convention would affect
  this analysis along with everything else that joins events to wearable samples.
- **Caveat ownership is split intentionally.** The module computes; the
  `documentation` agent owns the REM-predominant-OSA and CVHR clinical caveats in
  help content. This ADR records the linkage without embedding clinical guidance
  in code.
- **`StageSegment` / `HrSample` are plain analysis inputs, not new persisted
  types.** They are assembled by the loading hook from already-imported wearable
  data for consumption by the pure module; they add no new storage schema.

## Implementation References

- `src/analysis/sleepStages/` — pure, IO-free statistics: cycle derivation
  (Feinberg & Floyd heuristic), χ² goodness-of-fit vs. time-in-stage,
  REM-predominance ratio, REM-vs-NREM paired comparison, event-triggered HR
  averaging. Fully unit-tested.
- `src/views/Explore/EventExplorer/` — the new "Sleep stages & cycles" lens
  added alongside `ResultsViews.tsx`, consuming the filtered events from
  `queryEngine.ts` / `useExplorerEvents.ts` and reusing `exportEvents.ts`.
- The new loading hook (alongside `src/hooks/useWearableData.ts` /
  `useWearableLanes.ts`) — IndexedDB reads that assemble `StageSegment[]` and
  `HrSample[]` for the pure module.
- `src/analysis/hypothesis/` — reuse the existing `wilcoxon` signed-rank export
  (effect size included).
- `src/analysis/math/` — reuse `lnGamma` / gamma-based machinery for the χ²
  tail; do not re-implement.

## Key Literature

- **Feinberg I. & Floyd T. C. (1979)** — systematic trends in the NREM–REM cycle;
  the ultradian cycle definition underpinning the cycle-derivation heuristic.
- **REM-predominant OSA phenotype** — defined by AHI_REM/AHI_NREM ≥ 2 with
  non-trivial NREM disease (e.g. Mokhlesi et al.; Punjabi et al. literature).
- **Guilleminault C. et al. (1984)** — cyclical variation of heart rate with
  obstructive events; basis for event-triggered HR averaging (see also
  Stein P. K. & Pu Y., 2012, CVHR review).

## Related Decisions

- [0001 — Client-Side Architecture](0001-client-side-architecture.md) — all computation in-browser.
- [0015 — Zero Telemetry and Analytics](0015-zero-telemetry-analytics.md) — wearable integrations are strictly opt-in; no egress.
- [0017 — App-Computed Breathing-Pattern Detection](0017-app-computed-breathing-pattern-detection.md) — the analysis/hook split this mirrors and the "candidate, never diagnosis" framing.
- [0018 — Measurement-Uncertainty / Reliability-Display Framework](0018-measurement-uncertainty-reliability-display.md) — the uncertainty-display posture every output here inherits.
