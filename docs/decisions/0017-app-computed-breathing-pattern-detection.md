# 0017 — App-Computed Breathing-Pattern Detection (PB, CSR, TECSA): Architecture and Placement

## Status

Accepted

## Context

Until now, every respiratory "event" the CPAP Analyzer displays originates from
**ResMed's own annotations**. The EDF import pipeline reads the device's event
flags — `ClearAirway`, `Obstructive`, `Hypopnea`, `PeriodicBreathing`, `CSR` —
and materializes them as `Event` records (`src/types/events.ts`). The app does
**no breathing-pattern computation of its own**; there are no app-side detectors.
The `EventType` union already contains `PeriodicBreathing`, but it is populated
exclusively from device annotations, not from analysis.

This is a meaningful gap for the audience this tool serves. ResMed's on-device
detectors are conservative, fixed-threshold, and opaque: their periodic-breathing
and CSR flags fire only above device-internal thresholds, cannot be
re-parameterized, and surface no morphology (cycle length, modulation depth,
crescendo-decrescendo shape). Sub-threshold periodic breathing, short CSR runs,
and the *longitudinal* signature of **treatment-emergent central sleep apnea
(TECSA / "complex sleep apnea")** are invisible. For a patient with a
data-science, mathematics, or bioinformatics background, the raw airflow envelope
plainly contains this structure; the app should be able to compute it.

What the import pipeline already gives us to work with, per session:

- **Flow rate at 25 Hz**, mask pressure, minute ventilation, tidal volume,
  respiratory rate, leak, and snore channels.
- **Normalized device event flags**, including the per-apnea `ClearAirway`
  (central) markers that anchor cycle nadirs.
- Optionally, **external SpO2 / heart rate from Fitbit** (strictly opt-in,
  per [0015](0015-zero-telemetry-analytics.md) and the Privacy principle) — useful
  for corroboration but **not required**.

Critically, there are **no respiratory-effort belts** (no RIP, no esophageal
manometry). The domain-research report this ADR builds on establishes that this
does not block us: the CSR/PB literature shows that **airflow alone is
sufficient** to detect periodic breathing and Cheyne-Stokes respiration with
clinically useful agreement. Single-channel airflow methods — Weinreich et al.
2009 (ApneaLink, nasal airflow only), Javed et al. 2018 (ResCSRF, automated CSR
from flow), Midelet et al. 2023, and Guyot et al. 2019 (flow-modulation index) —
all operate without effort signals. The architecture therefore does not need, and
must not assume, an effort channel.

The relevant infrastructure already exists:

- Analysis modules live under `src/analysis/*` (e.g. `events`, `timeseries`,
  `distribution`, `correlation`, `survival`) and execute inside a **Comlink Web
  Worker** (`src/services/workers/analysis.worker.ts`), keeping heavy computation
  off the main thread per [0008](0008-web-workers-heavy-computation.md).
- `AnalysisEngine` (`src/services/analysis/AnalysisEngine.ts`) dispatches analyses
  with **date-range-keyed caching** and a `cacheVersion` for invalidation
  (`AnalysisInput` / `AnalysisOutput` in `src/types/analysis.ts`).
- A plugin type system (`src/types/plugins.ts`, `AnalysisPlugin`) exists, though
  its **registry is still a stub** ([0007](0007-plugin-architecture.md)).

We also carry a hard-won operational constraint, recorded in agent memory: **import-time
metrics require a full re-import to recompute.** The ResMed STR mask/metric work
showed that anything baked in at parse time is frozen until the user re-imports —
which is exactly wrong for detectors whose thresholds we expect users to tune.

A separate UX/visual decision has **already been made by `ui-design`** and is
referenced (not re-derived) here: **computed detections must be rendered
distinctly from device events, with the confidence score encoded visually.** This
ADR's job is the *computational architecture*; the rendering contract is owned by
the design system.

This decision concerns algorithm selection and the placement of clinical
computation. It builds on [0001](0001-client-side-architecture.md) (client-side
only), [0007](0007-plugin-architecture.md) (plugin architecture),
[0008](0008-web-workers-heavy-computation.md) (heavy compute in workers), and
[0015](0015-zero-telemetry-analytics.md) (no data egress; integrations opt-in).

## Decision Drivers

Resolved against the project priority order (Privacy > Correctness > Performance >
UX > Features):

- **Privacy.** All detection runs in-browser on local data. SpO2/HR corroboration
  is opt-in only; nothing leaves the device. This is non-negotiable and is
  satisfied trivially by keeping detectors in the existing worker pipeline.
- **Correctness (the dominant driver here).** This feature manufactures clinical
  signal that the device chose *not* to assert. It must be defensible: literature-backed
  methods, literature-backed default thresholds, an explicit confidence score, and
  framing as **candidate flags, never diagnoses**. CSR carries a heart-failure
  association and TECSA carries an ASV-contraindication caveat (SERVE-HF) and a
  high spontaneous-resolution rate — getting the *framing* wrong is as harmful as
  getting the *math* wrong.
- **Performance.** Detectors consume 25 Hz envelopes over potentially multi-hour
  sessions, and TECSA spans years of nights. They must run in the worker and be
  cacheable.
- **UX.** Users must be able to tune thresholds and immediately see the effect,
  and must never confuse a computed candidate with a device assertion.
- **Features.** Machine-agnostic, plugin-shaped detectors so non-ResMed support
  added later inherits this for free — but never at the expense of the above.

## Considered Options

### A. Where computation lives: import-time vs. on-demand analysis

- **Import-time (bake episodes into stored records at parse).** Pro: zero
  recompute cost on view; episodes are "just there." Con: **frozen** — any
  threshold change requires a full re-import (the documented STR-metric trap),
  which is fatal for a feature whose entire value is re-parameterization. Also
  couples clinical algorithms to the parser and forces every algorithm revision to
  invalidate all stored data.
- **On-demand analysis modules (chosen).** Detectors run as `src/analysis/*`
  modules invoked through `AnalysisEngine`, parameterized per call, cached by
  date-range + parameter hash. Pro: re-parameterizable without re-import; cache
  invalidates cleanly via `cacheVersion`; algorithms evolve independently of
  stored data. Con: first computation per range costs CPU (mitigated by worker +
  cache).
- **Optional import-time pre-population, on-demand canonical.** Allow a default-parameter
  pass at import to *pre-warm* episodes for instant first paint, while keeping
  on-demand as the source of truth. Accepted as a permitted optimization, not a
  requirement.

### B. Detection method: morphology/AASM rules vs. pure spectral vs. hybrid

- **Pure spectral / autocorrelation.** Detect the ~0.01–0.02 Hz modulation of the
  airflow envelope. Pro: elegant, threshold-light, naturally yields a modulation
  index. Con: blind to morphology (cannot distinguish CSR's crescendo-decrescendo
  from generic oscillation), poor at localizing discrete episode boundaries, and
  not aligned with how the clinical literature defines these patterns.
- **Pure AASM-style morphology rules.** Apply the scoring definitions directly
  (≥3 consecutive central events, crescendo-decrescendo, cycle length, event-rate
  and duration thresholds). Pro: clinically legible, episode boundaries fall out
  naturally, maps 1:1 to literature. Con: rule-only confidence is brittle and
  binary.
- **Hybrid: morphology rules + spectral/modulation confidence (chosen).** Use
  AASM-style morphology and the device `ClearAirway` nadirs to *find and bound*
  episodes; use autocorrelation/spectral analysis and a Guyot-style **flow-modulation
  index** to *score* them (continuous 0–1 confidence). Best of both: clinically
  defensible boundaries plus a graded, literature-grounded confidence.

### C. Type model: reuse `PeriodicBreathing` `EventType` vs. a distinct detection type

- **Reuse the existing `Event` / `EventType` records.** Pro: no new type. Con:
  **conflates device assertions with app computations** — the exact thing the
  design decision forbids — and `Event` has no field for confidence, cycle length,
  or modulation depth. It would make "is this from the machine or from us?"
  unanswerable downstream.
- **A distinct `Detection` model, separate from device `Event`s (chosen).**
  Detections carry `type`, time span, `confidence` (0–1) with discrete bands, and
  clinical features (cycle length, modulation depth, candidate/sub-threshold flag).
  Keeping them in a separate channel makes provenance unambiguous and gives the
  design system the confidence field it needs to render them distinctly.

### D. Machine coupling: ResMed-specific vs. normalized-channel detectors

- **ResMed-specific.** Faster to ship; permanently couples clinical algorithms to
  one vendor's parser.
- **Normalized channels + normalized event flags (chosen).** Detectors consume the
  app's normalized flow/ventilation envelope and normalized event flags, so a
  future machine plugin that emits the same normalized shape works unchanged.

## Decision Outcome

**1. PB and CSR are per-session episode detectors over the airflow / ventilation
envelope, using a hybrid morphology + spectral method.** The primary method is
AASM-style morphology scoring: a candidate episode requires **≥3 consecutive
central events**, a **crescendo-decrescendo** envelope, and a **cycle length ≥40 s
(typically 45–90 s)**; formal CSR additionally requires **≥5 events/h over ≥2 h**.
Device `ClearAirway` flags anchor the cycle nadirs. **Autocorrelation / spectral
confirmation** and a **Guyot-style flow-modulation index** produce the continuous
confidence score. Each detector emits **episodes** with `type`, time span,
`confidence` (0–1), and clinical features (cycle length, modulation depth).
**Sub-threshold periodic breathing** (hypopnea-nadir rather than central-apnea
nadir) and **short CSR runs** that fall below device thresholds are surfaced
explicitly as **"candidate / below device threshold,"** never silently dropped and
never promoted to a formal flag.

**2. TECSA is a longitudinal, cross-night classifier — not a per-session
detector.** It implements the **Liu et al. 2017 four-class trajectory model**
(obstructive / transient / persistent / treatment-emergent), classifying a user's
course from the **nightly central-apnea index (CAI)** using a **CAI threshold of
5/h** compared across **early vs. late treatment windows**. **High-leak nights are
down-weighted** because forced-oscillation-technique (FOT) central detection is
corrupted under large leak. TECSA therefore reads **stored per-night aggregates
across many nights**; it has no per-session output and lives strictly in the
longitudinal analysis layer.

**3. Computation lives in the on-demand analysis layer.** PB/CSR detectors are
`src/analysis/*` modules invoked through `AnalysisEngine`, parameterized per call
and cached by date range + parameter hash, so thresholds can be tuned and results
recomputed **without re-import** (avoiding the documented import-time-metric trap).
An **optional default-parameter pass at import** may pre-populate episodes for
instant first paint, but on-demand analysis remains the canonical source of truth.
**TECSA runs only in the analysis/longitudinal layer**, reading per-night CAI
aggregates — never at import.

**4. Detectors are plugin-oriented and machine-agnostic.** They consume
**normalized channels + normalized event flags**, so a future non-ResMed machine
plugin emitting the same normalized shape works without changes. The detectors are
organized as analysis modules under **`src/analysis/breathing/`** (PB, CSR, and the
TECSA longitudinal classifier), exposed through `analysis.worker.ts` and dispatched
by `AnalysisEngine`, conforming to the `AnalysisPlugin` shape
(`src/types/plugins.ts`) so they slot into the registry once it lands.

**5. All thresholds are configurable parameters with literature-backed defaults.**
Every numeric threshold above (consecutive-event count, cycle-length band,
events/h, duration, CAI cutoff, leak down-weighting, modulation-index bands) is a
tunable parameter carried in `AnalysisInput.parameters`, defaulted to the cited
literature values. Confidence is expressed **0–1 with discrete bands**. All output
is framed as **candidate flags, never diagnoses** (Correctness principle). The
clinical caveats — **CSR ↔ heart-failure** association, and the **TECSA / complex-apnea**
caveats (the **SERVE-HF** ASV-contraindication signal and the **~60–80%
spontaneous resolution** rate) — are **out of scope for the algorithm and belong in
help content** (`documentation` owns this), referenced here so the linkage is on
the record.

The **visual contract is owned by the prior `ui-design` decision**: computed
detections render **distinctly from device events** with **confidence encoded
visually**. This ADR does not re-derive it; the distinct `Detection` model (Option
C) exists precisely to supply the provenance and confidence fields that contract
needs.

## Consequences

### Positive

- **Surfaces structure the device hides.** Sub-threshold PB, short CSR, and the
  cross-night TECSA trajectory become visible and inspectable, with morphology
  (cycle length, modulation depth), not just a binary device flag.
- **Tunable without re-import.** Because detection is on-demand and cached by
  parameter hash, users can adjust thresholds and see results immediately —
  directly avoiding the documented import-time-metric trap.
- **Defensible by construction.** Literature-backed methods (Weinreich 2009, Javed
  2018, Midelet 2023, Guyot 2019, Liu 2017), literature-backed defaults, explicit
  0–1 confidence, and "candidate, never diagnosis" framing keep the feature on the
  right side of the Correctness principle.
- **Provenance is unambiguous.** The distinct `Detection` model means a computed
  candidate can never be mistaken for a ResMed assertion, satisfying the design
  contract and protecting clinical trust.
- **Machine-agnostic and registry-ready.** Normalized inputs + `AnalysisPlugin`
  shape mean future machine plugins inherit detection for free and the modules drop
  into the plugin registry once it exists.
- **No privacy cost.** Everything runs in the existing in-browser worker; SpO2/HR
  corroboration stays opt-in.

### Negative

- **We are asserting clinical signal the device declined to assert.** This raises
  the stakes on threshold defaults and on the "candidate, not diagnosis" framing; a
  poorly worded UI or a bad default could mislead. Mitigated by explicit confidence
  bands, help-content caveats, and QA/security review — but the residual risk is
  real and is the reason Correctness is the dominant driver.
- **First-computation cost.** On-demand detection over 25 Hz multi-hour envelopes
  is CPU-heavy on first run per range; only subsequent views are cache-fast. The
  optional import-time pre-warm partially offsets this at the cost of some
  duplicated computation.
- **TECSA depends on data the user may not have.** Robust trajectory
  classification needs many nights spanning early-vs-late windows; sparse or
  short histories yield low-confidence or unavailable TECSA output, which must be
  communicated honestly rather than guessed.
- **Leak sensitivity.** Both CSR central-nadir detection and TECSA CAI are
  degraded under high leak; down-weighting reduces but does not eliminate this, and
  high-leak users will see lower-confidence results.
- **A new persisted/visualized type.** The distinct `Detection` model adds surface
  area across types, worker output, caching, and rendering that must be carried and
  tested.

### Neutral

- **`AnalysisPlugin` integration precedes the registry.** Detectors conform to the
  plugin shape but are wired directly through `analysis.worker.ts` until the stub
  registry ([0007](0007-plugin-architecture.md)) is real; this is an accepted
  interim, not a deviation.
- **The existing `PeriodicBreathing` `EventType` is retained for device
  annotations only.** App-computed periodic breathing flows through `Detection`,
  not through that `EventType`; the two coexist by design and denote different
  provenance.
- **SpO2/HR corroboration is optional everywhere.** The architecture treats
  oximetry as a confidence-boosting input when present, never a dependency, so
  detection quality degrades gracefully without it.
- **Caveat ownership is split intentionally.** The algorithm computes; the
  `documentation` agent owns the CSR↔heart-failure and TECSA/SERVE-HF/ASV and
  spontaneous-resolution caveats in help content. This ADR records the linkage but
  does not embed clinical guidance in code.

## Implementation References

- `src/analysis/breathing/` — proposed home for the PB, CSR, and TECSA longitudinal
  modules.
- `src/services/workers/analysis.worker.ts` — Comlink worker exposing the detectors.
- `src/services/analysis/AnalysisEngine.ts` — date-range + parameter-keyed dispatch
  and caching.
- `src/types/analysis.ts` — `AnalysisInput.parameters` carries the configurable
  thresholds; `AnalysisOutput` / `cacheVersion` for invalidation.
- `src/types/events.ts` — existing device `Event` / `EventType` (including
  `PeriodicBreathing`, `ClearAirway`); the new `Detection` model is kept separate
  from these.
- `src/types/plugins.ts` — `AnalysisPlugin` shape the detectors conform to.

## Key Literature

- **Weinreich G. et al. (2009)** — single-channel nasal-airflow CSR detection
  (ApneaLink): airflow alone is sufficient.
- **Javed F. et al. (2018)** — ResCSRF, automated CSR detection from flow.
- **Midelet A. et al. (2023)** — airflow-based periodic-breathing / CSR detection.
- **Guyot N. et al. (2019)** — flow-modulation index as a continuous confidence
  measure for periodic breathing.
- **Liu D. et al. (2017)** — four-class TECSA trajectory model (obstructive /
  transient / persistent / treatment-emergent) from nightly CAI.
- **AASM scoring rules** — morphology definitions for periodic breathing and
  Cheyne-Stokes respiration (consecutive central events, crescendo-decrescendo,
  cycle length, event-rate/duration thresholds).
- **SERVE-HF trial** — ASV contraindication signal underpinning the TECSA caveat
  (help content).

## Related Decisions

- [0001 — Client-Side Architecture](0001-client-side-architecture.md)
- [0007 — Plugin Architecture](0007-plugin-architecture.md)
- [0008 — Web Workers for Heavy Computation](0008-web-workers-heavy-computation.md)
- [0015 — Zero Telemetry and Analytics](0015-zero-telemetry-analytics.md)
