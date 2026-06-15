# UX Proposal — Communicating Measurement Uncertainty

**Author:** `ux` · **Status:** Proposal for orchestrator review · **Date:** 2026-06-15
**Pairs with:** `ui-design` (visual specs) and the research dossiers in `docs/accuracy/_drafts/`.

> **Design thesis.** Uncertainty is communicated through a *small, consistent, mostly-quiet* vocabulary that activates only when it changes a decision. The default app stays clean. We surface uncertainty where the research says the number is genuinely soft (type split, flow-limitation, RERA, wearable SpO₂/stages, single-night AHI, high-leak nights) and stay silent where the number is solid (pressure, usage, apnea count, leak-below-threshold). This honours the product owner's warning that error bars everywhere reduce usability for little gain, while satisfying the Correctness principle.

The unifying principle, drawn from `confidenceTier.ts` and §6 of `uncertainty-statistics.md`: **a metric's display should never imply more certainty than it carries, but absence of a warning is itself a (correct) signal of trust.** Most metrics show no chrome at all.

---

## 1. Vocabulary & affordance set

Four affordances, in increasing weight. They reuse the existing tier concept rather than inventing new ones. The three-state tier mirrors `ConfidenceTier` (`src/analysis/breathing/confidenceTier.ts`) — generalize that file's `ConfidenceTier`/`confidenceTierLabel` into a shared `reliabilityTier` module so breathing detection and metric reliability share one vocabulary.

### 1.1 Reliability tier (the conceptual backbone — usually invisible)

A per-metric, per-context rating: **`high` | `moderate` | `low`** (plus an internal `na` when not applicable). It is *computed*, not always *rendered*. Inputs (per `cpap-device-accuracy.md` §10 ranking + `uncertainty-statistics.md` §6.2):

- **Intrinsic metric reliability** (static, from the §10 ranking): pressure/usage/apnea = `high`; aggregate AHI/hypopnea/leak = `moderate`; type-split/flow-limitation/RERA/wearable-SpO₂/multi-stage-sleep = `low`.
- **Contextual degraders** (dynamic, can only lower a tier): high unintentional leak (data-quality gate, §6 of device doc), short/fragmented session (low `T`, §3), rare-class small counts (few central events, §2.6), single-night-near-threshold.

The tier is the *input* to the affordances below; it is not itself a permanent badge on every card.

### 1.2 Reliability chip (`ReliabilityChip`) — selective badge

A compact, non-color, icon+label chip. **Three visual states**, always paired (WCAG: color is never the sole signal):

| State | Icon (shape, not just color) | Label text | Screen-reader text |
|---|---|---|---|
| `moderate` | hollow circle / dot | "Estimate" | "Moderate reliability: shown as a trend, not a precise value." |
| `low` | open triangle | "Indicative" | "Low reliability: directional signal only, not a measurement." |
| `low` + high-leak | open triangle + slash | "Leak-affected" | "Reduced reliability: high leak this night degrades this metric." |

**When it APPEARS:**
- On `low`-tier metrics that are nonetheless displayed as headline numbers (central/obstructive split, flow-limitation %, RERA count) — *always*.
- On any `moderate`/`high` metric whose **context** has dragged it down (a high-leak night's Vt/MV, a 1.5 h nap's AHI).
- On imported **wearable** metrics flagged `low` by provenance (consumer wrist SpO₂, multi-stage sleep, HRV).

**When it does NOT appear (critical for avoiding clutter):**
- On `high`-tier metrics in normal conditions: **pressure, usage/mask-on time, apnea count, leak below threshold.** These never carry a chip. A bare clean number *is* the trust signal.
- On `moderate` metrics shown in a **trend/aggregate** surface where the band already carries the uncertainty (don't double-encode — a chip *and* a CI band is redundant noise).
- More than once per card. One chip max; the worst applicable state wins.

### 1.3 Info affordance (the existing `MetricTooltip` / `HelpPopover`)

The existing `(i)` trigger on a metric label. **No new component** — we extend content (§2). Every metric keeps its info affordance; this is where the *why* of a chip lives, so the chip itself stays terse.

### 1.4 Data-quality notice (`DataQualityNotice`) — per-session banner

A single, dismissible, session-level inline notice (not a toast) shown at the top of a session/night detail when the *whole night* is compromised. **Appears only for:** high-leak night (≥ threshold for a meaningful fraction of the night), very short session, or no usable data. **One notice per session, never stacked.** It explains once, at the top, so individual cards below need fewer chips. Includes a "What does this mean?" link into help.

> **Anti-clutter rule (governs all four):** at most **one** uncertainty affordance is the *primary* signal for a given number in a given view. Tier → drives chip; chip → explained by info affordance; whole-night problems → one notice. Never a chip *and* a band *and* a notice for the same value.

---

## 2. Progressive disclosure (mapped to existing help layers)

Four depths, mapped to existing components — we add a `reliability` content field, we do not add new surfaces.

| Depth | Surface (existing component) | What it shows about uncertainty |
|---|---|---|
| **At a glance** | The number itself + (selective) `ReliabilityChip` | Correct precision (§2.3 below); chip only when soft. No band on a plain KPI. |
| **On hover/focus** | `MetricTooltip` (`src/components/help/MetricTooltip.tsx`) | One added line: the reliability sentence (e.g., "Single-night AHI is noisy; watch the 7-day trend."). Pull from a new `reliability` field on `MetricDefinition` (`src/content/help/metrics.ts`). |
| **On click (term)** | `HelpPopover` (`src/components/help/HelpPopover.tsx`) → glossary `standard` | Paragraph: why this metric is soft, what to trust instead. |
| **Deep dive** | Glossary `detailed` + `references` (`src/content/help/glossary.ts`) | Full treatment: ICCs, LoA, Poisson reasoning, citations. Already structured (`quick`/`standard`/`detailed`/`formula`/`references`) — add an `uncertainty` sub-section to `detailed` for the soft metrics. |

**Display-precision rules to encode at the "at a glance" layer** (from `uncertainty-statistics.md` §6.1):
- AHI: **1 decimal max** (never 2). Pressure: 1 decimal cmH₂O. Leak: integer (median) / ≤1 decimal (percentile). Usage: 1 decimal h. Counts: integers. Compliance: integer %. These are formatter rules, not chrome — the cheapest, highest-value uncertainty fix in the whole proposal.

---

## 3. Per-surface IA (prioritized)

### 3.1 Dashboard KPI cards (`KPIRow.tsx`, `EnhancedKPICard.tsx`, `KPICard.tsx`)

The dashboard headline is already a **mean over the window** (`stats.meanAHI`) — good, this is the multinight aggregate the literature recommends. Keep that.

- **MUST-HAVE:** Enforce precision rules in the formatters (AHI/leak/pressure/usage). Add an optional `reliability?: ReliabilityTier` + `reliabilityReason?: string` prop to `EnhancedKPICard`; render a `ReliabilityChip` in the header **only** when tier is degraded. The five default KPIs (AHI-mean, leak, compliance, usage, pressure-P95) are all `high`/`moderate`-as-trend → **render no chip by default.** The sparkline already conveys "this is a trend."
- **MUST-HAVE:** Demote single-night drama. The `trendPercent` badge on `EnhancedKPICard` invites over-reading night-to-night deltas. For AHI specifically, suppress/soften the percent badge when the underlying delta is within noise (≤1–2 events/h, §10 cross-cutting rule) — show "≈ stable" rather than a precise percent.
- **NICE-TO-HAVE:** A dashboard-level type-split card (CA vs OA) carries a permanent `low` "Indicative" chip and routes to the "discuss with clinician" framing.

### 3.2 Trends (`src/views/Trends/`)

This is the *right* home for uncertainty per §6.2 — it is already aggregate.

- **MUST-HAVE:** Replace/augment the raw nightly AHI line with a **rolling median (or mean) + 95% band** as the default emphasis; raw nightly points are secondary (lighter, optional toggle). This single change does more for correct interpretation than any chip.
- **MUST-HAVE:** A persistent, quiet legend note: "Bands show statistical uncertainty; single-night points vary for biological reasons too." (links to glossary `night-to-night-variability`).
- **NICE-TO-HAVE:** Severity-band shading with an explicit "trend straddles a boundary" annotation when the band crosses 5/15/30, never a hard category flip from one night.

### 3.3 Explore / advanced stats (`src/views/Explore/`)

Power-user surface — uncertainty here is *welcome and expected*, not clutter.

- **MUST-HAVE:** In `Correlations.tsx` / `StatisticalAnalysis.tsx`, label every imported-signal correlation with its provenance/reliability class (cleared oximeter vs wellness wrist SpO₂ vs inferred stage) per `wearable-accuracy.md` §9. A correlation against a `low` wearable signal must visibly say so.
- **MUST-HAVE:** Cross-manufacturer guard. Any view that could compare AHI/leak across machines (`Configurations`, comparisons) shows a blocking caveat — device AHI is **not interchangeable across manufacturers** (§10). Prefer to *prevent* the naive comparison over caveating it.
- **NICE-TO-HAVE:** Optional exact-Poisson CI display for per-night AHI when `N<20` (the math is already specified in `uncertainty-statistics.md` §7 with locked reference values for `unit-tester`).

### 3.4 Reports / PDF (`src/views/Reports/`)

A report may be shown to a clinician — correctness pressure is highest, but it must stay readable.

- **MUST-HAVE:** A single, fixed **"How to read this report" methodology footnote**: device-AHI ≠ PSG-AHI, flow-only hypopneas, mask-on (not sleep) denominator, type-split is a modeled inference. One block, not per-metric.
- **MUST-HAVE:** Same precision rules; aggregate (trend + band) framing, not a table of false-precision single nights.
- **NICE-TO-HAVE:** Per-row reliability marker (a quiet superscript keyed to the footnote) only on soft rows.

### 3.5 Per-event / signal views (`src/views/Explore/EventExplorer/`, `Breathing/`, `Sessions/`)

- **MUST-HAVE:** Central/obstructive event labels carry the `low` "Indicative" chip with the "discuss with clinician, not a diagnosis" copy (ICC ~0.16 obstructive subtype; closed-airway centrals misclassified). Surface a *rising* Clear-Airway index as a clinician-conversation flag — never as a diagnosis.
- **MUST-HAVE:** RERA / flow-limitation explicitly labeled a **surrogate** (no EEG arousal exists), not a PSG metric.
- **NICE-TO-HAVE:** On the flow waveform, shade high-leak epochs (a visual data-quality gate) so users see *where* derived metrics are untrustworthy, leveraging the existing breathing confidence-tier overlay.

---

## 4. Empty / edge states

| State | Detection | Treatment |
|---|---|---|
| **Short / fragmented session** | low mask-on `T` / few events | `DataQualityNotice`: "Short session ({n} min). Rates like AHI are statistically noisy here." AHI card gets `moderate→low` chip. No hard severity badge from this night alone. |
| **High-leak night** | unintentional leak ≥ threshold for a meaningful fraction | One `DataQualityNotice` at top; flow-derived metrics (Vt/MV/RR, type split) get the "Leak-affected" chip; pressure/usage/apnea **stay clean** (they survive leak better — be precise, don't blanket-warn). |
| **Single-night near threshold** | AHI CI straddles 5/15/30 | Show band/CI on demand; copy: "This night sits near the {mild} boundary; one night can't place you in a category." Defer to the trend. |
| **Missing wearable coverage** | gaps in imported signal | Don't impute; show an explicit gap in overlays with "No wearable data for this span." Never silently interpolate (Correctness). |
| **No / unparseable data** | import empty | Standard empty state with import CTA; no uncertainty chrome (nothing to qualify). |

---

## 5. Accessibility spec (WCAG AA)

- **Non-color cues:** every `ReliabilityChip` state has a distinct **icon shape** (dot / triangle / triangle-with-slash) *and* a text label — color is decorative only. Mirrors the existing non-color tier cue intent in `confidenceTier.ts`.
- **ARIA:** chip is a `<button>` (it opens the info affordance) with `aria-label` = the full screen-reader sentence from §1.2 (e.g., `aria-label="Low reliability: directional signal only, not a measurement. Activate for details."`). The KPI `<article aria-label>` in `EnhancedKPICard` must append the reliability state so SR users hear it without reaching the chip: `"Central apnea index: 3.2 events/hour, low reliability estimate."`
- **Confidence band on charts:** the band is decorative; the *value* is exposed via an accessible data table / `aria` summary stating "7-day mean AHI 4.8, 95% interval 3.9 to 5.7." Never rely on the shaded region alone.
- **Focus:** chip and info trigger are keyboard-focusable with a visible focus ring; tooltip opens on focus (not hover-only); `DataQualityNotice` is reachable in tab order and its dismiss control is labeled.
- **Notice semantics:** `DataQualityNotice` uses `role="status"` (polite) when it appears after load, so SR users are informed without an interruption; it is **not** `role="alert"` (this is informational, not an error).
- **Copy is actionable & non-alarming:** distinguish aleatoric ("your AHI naturally varies night to night") from epistemic ("not enough nights yet to be confident") per §6.2 — they imply different user actions.

---

## 6. Do NOT do this (tempting-but-bad)

1. **Error bars on every bar/point.** Trains users to ignore them; the product owner flagged exactly this. Bands belong on *aggregate trends*, not on solid single values (pressure, usage).
2. **A reliability chip on every KPI.** A permanent "high reliability" badge on pressure/usage is visual noise that dilutes the `low` chips that matter. Trust is the silent default.
3. **Two-decimal AHI** (e.g., "4.97"). Implies ~100× the real precision (§6.1). One decimal, always.
4. **Color-only reliability** (e.g., a green/amber/red dot with no icon/text). Fails WCAG and is meaningless to ~8% of users.
5. **Chip + band + notice on the same number.** Triple-encoding the same uncertainty. One primary signal per value.
6. **Cross-manufacturer AHI/leak comparison** without a caveat — better, prevent it outright. Definitions and leak conventions differ.
7. **Hard severity category from one night** (a bold "MODERATE" badge on a single noisy night). Use trend + band; annotate boundary-straddling.
8. **Imputing/interpolating missing wearable or signal data** to make charts look continuous. Violates Correctness; show the gap.
9. **Diagnostic language on the type split / RERA** ("you have central apnea"). Surface-don't-diagnose: "rising clear-airway index — worth discussing with your clinician."
10. **Alarming red banners for high-leak/short nights.** Use a calm `role="status"` notice, not an alert.

---

## 7. Prioritization for the first PR

### Must-have (scope the first PR around these — high value, low clutter)

1. **Precision formatters** (AHI 1dp, no 2dp anywhere; leak/pressure/usage rules). *Cheapest, biggest correctness win; touches `KPIRow.tsx`, Reports, Trends.*
2. **Generalize `confidenceTier.ts` → shared `reliabilityTier`** module (tier type + label + chip). One source of truth.
3. **`ReliabilityChip` component** (3 non-color states) + optional `reliability` props on `EnhancedKPICard`, rendered **only when degraded.**
4. **`low`-tier chips + "surface-don't-diagnose" copy** on central/obstructive split, flow-limitation, RERA (event/signal views).
5. **Trends: rolling median/mean + 95% band as the default emphasis** with the explanatory legend note.
6. **`reliability` content field** on `MetricDefinition` + glossary `uncertainty` sub-section for the soft metrics (`documentation` agent).
7. **Cross-manufacturer comparison guard** (prevent or hard-caveat).

### Nice-to-have (follow-up PRs)

- `DataQualityNotice` for high-leak / short-session nights.
- Exact-Poisson CI on demand for `N<20` nights (math + reference values already locked in `uncertainty-statistics.md` §7).
- High-leak epoch shading on the flow waveform.
- Reports per-row reliability superscripts; Explore wearable-provenance labels.
- Severity-band boundary-straddle annotation on Trends.

**Handoffs:** `ui-design` for chip/band/notice visuals (icon shapes, band styling in light/dark); `frontend` for the shared module + components; `data-science`/`data-visualization` for the rolling band + Poisson CI; `documentation` for `reliability`/`uncertainty` copy; `e2e-tester` for the §4 edge-state flows; `qa`/`security` as gates (security for the wearable-provenance labeling).
