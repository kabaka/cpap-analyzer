# 0031 — Per-Night Therapy Assessment Uses a Two-Gate Verdict, Not a Composite Score

## Status

Accepted — 2026-07-06

## Context

The **Session Detail** page (`src/views/Sessions/SessionDetail.tsx`) is the
canonical surface for reviewing a single night of therapy (see
[0024](0024-per-event-clock-time-on-session-detail.md)). A redesign prototype for
that page proposed a per-night **"Therapy Effectiveness 0–100"** composite gauge as
the hero element — one headline number meant to summarise how the night went.

That proposal collides with a deliberate, already-established pattern in this
codebase: **we do not present single composite quality scores.** The home
dashboard's good-night summary is built precisely to avoid one. `goodNightRate`
(`src/views/Dashboard/signalDeck/metrics.ts`) computes the fraction of nights that
clear **two independent, canonically-sourced clinical gates** — _effective_
(`ahi != null && ahi < GOOD_NIGHT_AHI_MAX`) and _adherent_
(`usageHours >= GOOD_NIGHT_MIN_HOURS`) — and its `VerdictCard`
(`src/views/Dashboard/signalDeck/VerdictCard.tsx`) renders those two gates as
separate pass-rate bars under an explicit comment: _"These are NOT a composite —
they explain the headline without re-introducing one."_ The module's own JSDoc
stresses that the qualitative band word is _"an explicitly heuristic presentation
layer,"_ that `null` is _"a gap, never a zero,"_ and that _"nothing in this module
diagnoses."_

The forces in tension:

- **Correctness / clinical honesty (priority 2, decisive).** Core principle #2
  requires the tool to _"never mislead."_ A hero "0–100" therapy score would:
  1. **imply false precision** — a two-decimal-looking scalar suggests a measured
     quantity where none exists;
  2. **conflate independent clinical dimensions** — residual AHI, adherence, mask
     leak, and oxygenation are distinct axes with distinct clinical meanings;
     collapsing them into one number **hides which dimension drove the result**, so
     a "72" could equally mean "great control but under-used" or "well-used but
     leaking badly"; and
  3. **contradict the established dashboard pattern**, splitting the product's
     clinical voice between "transparent gates" at window scope and "opaque
     composite" at night scope.
- **Consistency / information architecture.** Night-scope review should mirror the
  window-scope grounded-gates philosophy, not diverge from it, so a user reads the
  same clinical logic at both scales.
- **User experience (priority 4).** The redesign's motivation — a legible, at-a-glance
  hero — is legitimate. A verdict must still be immediately scannable and beautiful;
  honesty must not cost clarity.

The relevant clinical constants already exist and are canonical:
`AHI_SEVERITY_THRESHOLDS.mild` (= 5, the AASM normal/mild residual-AHI boundary,
`src/analysis/clinical/ahiSeverity.ts`) and `CMS_COMPLIANCE_HOURS` (= 4, the U.S. CMS
per-night usage floor, `src/analysis/clinical/compliance.ts`). The dashboard derives
its gates from these rather than re-hardcoding them, and any night-scope assessment
must do the same.

This ADR records **how the Session Detail hero assesses a single night**, and does so
in a new helper module, `src/views/Sessions/sessionAssessment.ts`, kept as a pure,
deterministic presentation-layer selector in the same spirit as
`signalDeck/metrics.ts`.

## Decision Drivers

Resolved against the project priority order
(Privacy > Correctness > Performance > UX > Features):

- **Privacy.** No effect — all night data is already on the device; this is a
  presentation change only. Satisfied by construction.
- **Correctness (decisive).** The hero must not imply precision it does not have, must
  not compose independent clinical dimensions into an undecomposable number, and must
  track the canonical thresholds rather than inventing new ones. Nulls must read as
  gaps (`—`), never as `0`. Nothing may diagnose.
- **UX.** The hero must stay glanceable and beautiful; a verdict word plus a component
  strip must communicate at least as fast as a gauge would.
- **Consistency.** Night-scope logic should be recognisably the same as the
  window-scope `goodNightRate` / `VerdictCard` pattern.

## Considered Options

### A. Per-night "Therapy Effectiveness 0–100" composite gauge (the prototype)

A single scalar hero combining AHI, adherence, leak, and oxygenation.

- **Pro:** One number; immediately legible; matches the redesign mock exactly.
- **Con:** Implies false precision, conflates independent clinical axes into a figure
  that hides which one drove it, and contradicts the dashboard's explicit "NOT a
  composite" stance. Fails Correctness/clinical honesty. **Rejected.**

### B. Transparent, decomposed 0–100 index with a visible formula and caption

Keep a 0–100 hero, but publish the weighting and show a caption explaining the
components, so the number is at least reproducible.

- **Pro:** More honest than Option A; the arithmetic is inspectable.
- **Con:** A visible formula does not remove the core defect — the weights across
  clinically incommensurable axes (an AHI-hour vs. a usage-hour vs. an LPM of leak)
  are **arbitrary and unvalidated**, and a published arbitrary weighting still reads as
  a clinical instrument. It also still diverges from the dashboard, which deliberately
  refuses even a transparent composite. **Rejected.**

### C. Keep the gauge, but drive it purely from the AHI severity band

Map the AHI severity classification onto the 0–100 gauge so the number is at least
grounded in one canonical scale.

- **Pro:** Grounded in a single canonical threshold set; no arbitrary cross-axis
  weighting.
- **Con:** Silently redefines "therapy effectiveness" as "AHI alone," dropping
  adherence, leak, and oxygenation from a hero that _looks_ holistic — misleading by
  omission. The 0–100 rendering also re-implies a continuous precision the discrete
  severity bands do not carry. **Rejected.**

### D. Per-night two-gate verdict plus an independent component strip (chosen)

A verdict word derived from the **same two gates** the dashboard uses, at single-night
scope, with a component strip that shows each clinical dimension **on its own**.

- **Pro:** Honest (no invented scalar), transparent, decomposable (each axis reads
  independently), and consistent with `goodNightRate` / `VerdictCard`. Tracks the
  canonical thresholds. Stays glanceable — a verdict word plus four coloured segments
  reads at a glance. **Chosen.**
- **Con:** Diverges from the prototype's exact gauge; a verdict word is coarser than a
  number and discards ordering _within_ a band (see Consequences).

## Decision Outcome

Adopt **Option D**. The Session Detail hero shows a **per-night two-gate verdict**,
implemented as a pure selector in `src/views/Sessions/sessionAssessment.ts`:

1. **Two gates, both canonical, both required for the top verdict.**
   - **Effective** — `ahi != null && ahi < AHI_SEVERITY_THRESHOLDS.mild` (AHI strictly
     below 5, i.e. in the AASM _normal_ band). A `null` AHI (recording below the
     rate-validity floor) is **not** effective — residual control cannot be confirmed —
     and is never treated as a pass.
   - **Adherent** — `usageHours >= CMS_COMPLIANCE_HOURS` (≥ 4 h). Thresholds are
     re-derived from the clinical modules, never re-hardcoded, exactly as
     `metrics.ts` does.

2. **A qualitative verdict word**, not a number: **Good** (effective **and**
   adherent), **Fair** / **Partial** (one gate passed), **Rough night** (neither). The
   word — and its colour band — is an **explicitly heuristic presentation layer**, in
   the same spirit as `classifyGoodNightRate`, and must be presented as a rough summary,
   **not** a medical assessment.

3. **A 4-segment component strip — AHI / Leak / Usage / SpO₂ — with no compositing.**
   Each segment reflects **that one metric's own clinical status independently** (via
   its own canonical classifier/threshold); segments are **never combined** into a
   blended figure. The strip is what lets a reviewer see _why_ the verdict is what it
   is, mirroring how `VerdictCard`'s separate gate bars _"explain the headline without
   re-introducing"_ a composite.

4. **Nulls render as `—`, never as `0`.** A missing metric (no SpO₂ that night, an AHI
   below the validity floor) shows an explicit gap, consistent with the _"null is a
   gap, never a zero"_ rule in `metrics.ts`.

5. **Nothing diagnoses.** The verdict is a therapy-review affordance; the tool does not
   diagnose (CLAUDE.md).

The exact visual design of the hero (verdict typography, strip layout, colour bands,
empty/gap states) is delegated to `ux` / `ui-design` and implemented by `frontend`,
gated by `qa` and reviewed by `security` where it renders imported night data. This ADR
fixes the _what_ (a two-gate verdict word plus an independent, non-composited component
strip), the non-negotiable _how_ (canonical thresholds; `—` for nulls; heuristic
label; no diagnosis), and its _home_ (`sessionAssessment.ts`).

## Consequences

### Positive

- **Clinically honest.** No invented scalar and no false precision; the hero says only
  what the two grounded gates and each independent metric actually support.
- **Decomposable.** The component strip shows _which_ dimension drove the verdict, so a
  "Fair" night is never ambiguous about whether AHI or usage let it down — the exact
  failure Option A hides.
- **Consistent with the dashboard.** Night-scope review now mirrors the window-scope
  `goodNightRate` / `VerdictCard` grounded-gates philosophy, giving the product one
  clinical voice across scales.
- **Tracks canonical thresholds.** `AHI_SEVERITY_THRESHOLDS.mild` and
  `CMS_COMPLIANCE_HOURS` are re-derived, so a future change to a clinical boundary
  updates both the dashboard and Session Detail together, with no drift.
- **Robust null handling.** Gaps render as `—`, so a below-floor AHI or a missing SpO₂
  night can never masquerade as a perfect or a failing metric.

### Negative

- **Diverges from the redesign prototype.** The proposed 0–100 gauge hero is not built;
  the redesign mock must be reconciled to a verdict-plus-strip hero.
- **Coarser than a number.** A verdict word discards ordering _within_ a band — an AHI
  of 4.9 and 0.5 both read "effective," and two "Good" nights are not ranked against
  each other by the hero. Fine-grained comparison lives in the metrics and charts
  below the hero, not in the headline. This coarseness is the accepted price of not
  implying precision the data does not carry.

### Neutral

- **The verdict word is a heuristic presentation layer**, exactly like
  `classifyGoodNightRate`'s bands — its label/colour cut points are a UX affordance,
  tunable without touching the grounded gates, and are explicitly non-clinical.
- **`sessionAssessment.ts` is a new pure selector module**, parallel to
  `signalDeck/metrics.ts`: deterministic, side-effect-free, and the single place the
  Session Detail UI reads its verdict from, so no threshold or classification is
  re-implemented in a component.
- **No storage, schema, parsing, or external-integration changes;** Privacy is
  unaffected.

## Related Decisions

- [0018](0018-measurement-uncertainty-reliability-display.md) — honest display of
  clinical data under uncertainty; the correctness ethos this decision extends to the
  night-scope hero.
- [0023](0023-persisted-per-night-breathing-detection-cache.md) — per-night
  app-computed detections that feed a night's metrics.
- [0024](0024-per-event-clock-time-on-session-detail.md) — the Session Detail redesign
  context in which this hero decision was made.
