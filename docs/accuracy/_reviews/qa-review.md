# QA Adversarial Review — Measurement Uncertainty / Reliability Display Proposals

**Reviewer:** `qa` (gatekeeper) · **Date:** 2026-06-15 · **Mode:** adversarial peer review
**Inputs reviewed:** `_proposals/{ux,ui-design,dataviz,datascience}-proposal.md`, `_drafts/{cpap-device-accuracy,uncertainty-statistics,wearable-accuracy}.md`
**Codebase verification:** performed against `main` working tree.

> **Bottom line.** The four proposals are individually strong and unusually well-grounded, but they were written in parallel and **do not agree on the vocabulary, the token names, the tier cardinality, or which component owns the chip.** Coding cannot begin until the reconciliation list in §1 is decided. Scope is also inflated: the genuinely shippable, intent-satisfying slice is roughly one third of what is proposed.

---

## 0. Codebase claim verification (feasibility ground-truth)

Every file path I could check exists. Specific API claims:

| Claim (proposal) | Verified? | Notes |
|---|---|---|
| `confidenceTier.ts` exports `ConfidenceTier='low'\|'moderate'\|'high'` + `confidenceTierLabel` | ✅ | `src/analysis/breathing/confidenceTier.ts:15,40`. Labels are "Low/Moderate/High **confidence**", not "reliability". |
| `KaplanMeierCurve` has a `d3.area().y0/.y1` CI band + `confidenceBand` class | ✅ | `KaplanMeierCurve.tsx:96-109,150`. (dataviz line cite is accurate.) |
| `KPIRow` renders `meanAHI.toFixed(1)` | ✅ | `KPIRow.tsx:47`. Already **1 dp** — no 2-dp bug here. |
| `AHITrendChart` is a `ComposedChart` with severity `ReferenceArea`s + single AHI `Line` | ✅ | `AHITrendChart.tsx`. Tooltip already `toFixed(1)`. |
| `Badge` API | ⚠️ **PARTIAL** | `Badge.tsx` variants are `default\|success\|warning\|danger\|info`, sizes `sm\|md`. **There is no `reliability` variant** and Badge renders a `<span>`, **not a `<button>`** (UX §5 wants the chip to be a focusable `<button>`). Both wrapping approaches are viable but the proposals assume different things. |
| `EnhancedKPICard` has `reliability`/`reliabilityReason` props | ❌ **DOES NOT EXIST** | `EnhancedKPICard.tsx` has `severity`, `trend`, `trendPercent` etc. The severity Badge already occupies the header top-right (`:99-103`) and uses **loud green→red status variants** — exactly what UI §2.1 warns reliability must not collide with. Props must be added. |
| `NightlyAggregate` fields `ahi`, `eventCount`, `usageHours`, `eventsByType`, `leakP95/leakMedian` | ✅ | `types/session.ts:134,169,171,202-204,258`. `eventsByType` carries `central/obstructive/hypopnea/rera/flowLimitation`. Also has `leakDurationMinutes` = "Duration with leak > 24 L/min" — **24 is already baked into the pipeline** (see §6 risk). |
| `tokens.css` conventions: `--color-detection`/`--color-tecsa-*` violet, `--color-wearable-hrv` `#b45309`, `--color-status-mild`, `--radius-full` | ✅ | `tokens.css:80-92,69,25,177` (+ dark scope). UI's hue-reuse rationale is real. |
| `PDF_COLORS` in `pdf/layout.ts` with pre-multiplied-on-white fills | ✅ | `layout.ts:15`. No UNCERTAINTY/RELIABILITY entries yet (to be added). |
| `decimationPyramid.ts`, `SignalRenderer.ts`, `ChartContainer`/`ChartPanel` | ✅ | All present. |
| math: `lnGamma`, `inverseNormalCDF`, `studentTCDF`, `twoTailedPValue`, `regularizedIncompleteBeta`, `computeDescriptiveStats.stdErr` | ✅ | `math/index.ts:32,183,167,226,61`; `descriptive/index.ts:24,144`. |
| `inverseChiSquare`, `lowerGammaRegularized`, `tQuantile` do NOT exist | ✅ confirmed absent | datascience is correct that these are new. `tQuantile` can bisect on existing `studentTCDF`; `inverseChiSquare` needs new `lowerGammaRegularized`. |
| `MetricDefinition` has a `reliability` field | ❌ | `metrics.ts:7-14` has `tooltip/interpretation/glossaryId` only. Adding `reliability?` is trivial and safe. |
| Glossary has `quick/standard/detailed/formula/references` | ✅ | `glossary.ts:10-23`. But `detailed` is a **single string**, so UX's "add an `uncertainty` sub-section to `detailed`" is inline prose, not a structured field — fine, but say so. |

**False-precision bug is REAL but mislocated.** The dashboard headline (`KPIRow`, `AHITrendChart`) is already 1 dp. The actual 2-dp AHI offenders are: `services/workers/export.worker.ts:124-125` (Mean/Median AHI), `services/reports/ReportService.ts:1072` (Mean AHI), `analysis/pressure/index.ts:528-530` (slope copy), `views/Explore/PressureOptimization.tsx:304` (`ahiAtOptimal.toFixed(2)`). Any "fix false precision" PR must target **exports/reports/Explore**, not the dashboard. UX §3.1's claim "dashboard headline already 1dp — good" is accurate; the other three proposals imply the headline is broken — it is not.

---

## 1. CONSISTENCY — contradictions across the four proposals (DECIDE BEFORE CODING)

These are blockers-to-start. Each row is a decision the orchestrator must force.

1. **Tier cardinality.** datascience + ux + the existing code use a **3-state** tier (`high\|moderate\|low`). ui-design uses **5 states** (`high\|moderate\|low\|limited\|unavailable`) and tells `frontend` to model a 5-member discriminated union "extending `ConfidenceTier`". dataviz says "three-state good/limited/unreliable" — **a third, different naming** (`good\|limited\|unreliable`). **Pick one enum.** Recommendation: keep the data model 3-state (`high\|moderate\|low`) to match `confidenceTier.ts` and the datascience util; treat "unavailable" as a **separate orthogonal concern** (a `—` render / `insufficientData` boolean, which datascience §3.4 already anticipates) and "limited" as **not a tier** but a caveat. Forcing 5 tiers into the shared type will break reuse of `confidenceTier`.

2. **Chip label wording.** ux: `Estimate` / `Indicative` / `Leak-affected`. ui-design: `High` / `Moderate` / `Low` / `Limited` / `Unavailable`. These are **mutually exclusive copy.** `documentation` must own one canonical label set. (UX's verb-style labels are better for laypeople; UI's tier-word labels are more honest but drier — resolve, don't ship both.)

3. **Icon shapes.** ux: dot / triangle / triangle-with-slash. ui-design: check-ring / **triangle-outline (moderate)** / **hexagon (low)** / filled-warning / info-circle / dashed-circle. dataviz: hatch patterns only. **The triangle means different things** (ux uses it for `low`; ui-design uses it for `moderate`). Lock the icon→tier map once.

4. **Color hue for `low`.** ui-design makes `low` **violet** (reusing `--color-detection`), explicitly to avoid "alarm". ux says the chip is "non-color" and color is "decorative only". dataviz adds **neutral-slate** band tokens. Not strictly contradictory, but the violet choice is **load-bearing in UI and absent from UX/dataviz** — confirm `low`=violet is the project decision and that it never reads as severity.

5. **New token namespace.** ui-design defines `--color-reliability-*`, `--color-caveat-*`, `--color-uncertainty-band-*`. dataviz independently asks for a `confidenceBand` CSS class and `styles.confidenceBand` (already exists for KM). Ensure the band uses **one** token (`--color-uncertainty-band-fill`) and the existing KM `confidenceBand` class is **migrated** to it, not duplicated.

6. **Component ownership / responsibility.** ux names `ReliabilityChip` + `DataQualityNotice`. ui-design names `ReliabilityChip` (Badge wrapper) **+ `ReliabilityGlyph`** (bare inline). dataviz names `ConfidenceBandArea` + `useD3ConfidenceBand` + `DataQualityHatch`. datascience names `reliabilityTier()` util + `formatMetric()`. **No conflict in principle**, but nobody owns the end-to-end wiring of chip→KPI card. Assign: `data-science` = `reliabilityTier`/`poissonRateCI`/`rollingMeanCI`/`formatMetric`; `frontend` = `ReliabilityChip`/`ReliabilityGlyph` + KPI wiring + token blocks; `data-visualization` = `ConfidenceBandArea`/`DataQualityHatch`.

7. **Rolling-window center statistic & size.** dataviz/datascience disagree internally: datascience §2.2 headline = **mean ± t·SEM**; dataviz §3.1 default center = **rolling median**, band = `center ± 1.96·SEM`. A **median center with a mean-based SEM band is statistically incoherent** (the band is built for the mean). Decide: either mean+SEM (datascience, coherent) or median+bootstrap/IQR (needs new math). Recommend **mean ± t/z·SEM** for the first PR. Window default (7 vs 14) is still open in both — pick 14 (Lechat plateau).

8. **Leak display precision.** datascience §1 says **leak median = integer**. `KPIRow.tsx:65` renders `meanLeak.toFixed(1)`, and the metrics-help copy already says "< 24 L/min". UX/UI say "integer (median)/≤1dp (percentile)". The `formatMetric` contract must override the existing `.toFixed(1)` — flag this as an intended behavior change in the CHANGELOG.

9. **Leak threshold constant.** datascience §4 demands a **named constant** `RELIABILITY_THRESHOLDS` pending `resmed-specialist` confirmation; meanwhile `LeakRateChart.tsx:124` hardcodes `y={24}`, `NightlyAggregate.leakDurationMinutes` is **defined as ">24 L/min"**, and `metrics.ts` copy hardcodes "< 24". **24 is already a de-facto magic number in ≥3 places.** Decide whether this PR also de-duplicates it into the constant (recommended) or leaves the debt.

---

## 2. FEASIBILITY

- **datascience** is the most feasible and the most rigorous; it correctly enumerates what math exists vs. what is new, and it self-audited the drafts (the N=0 "rule of three" 3.0-vs-3.689 catch is correct and important — see §6). The new `inverseChiSquare`/`lowerGammaRegularized` is real work but bounded (Numerical Recipes `gammp`/`gcf`); `tQuantile` via bisection on `studentTCDF` is low-risk. **Feasible as written.**
- **dataviz** mostly feasible. Risk: it asserts recharts `Area` accepts a **2-tuple range datum** for a true floating band "no masking hack needed". The existing `LeakRateChart` uses the **two-area masking trick** (`:106-120`) precisely because that was the working pattern. The range-datum approach must be **spiked/proofed** before it is promised; if it fails, fall back to the masking trick. Do not let the proposal's confidence become a schedule assumption.
- **ui-design** feasible but **over-specs**. The 5-tier model fights the shared type (§1.1). The WCAG contrast numbers are self-described "design-time estimates" — they **must** be re-run by the automated a11y check on resolved tokens before any approval (UI itself says this; QA will enforce it as a gate, not a footnote).
- **ux** feasible; it is the best-calibrated on anti-clutter. Its assumption that `EnhancedKPICard` can take a `reliability` prop is correct *after* the prop is added (it is not there today).
- **Effort underestimate (all):** the "Explore wearable-provenance labeling" (ux §3.3) and "cross-manufacturer guard" require knowing the import source/manufacturer per signal — confirm that provenance is actually carried on imported records before promising the label. **Unverified data dependency.**

---

## 3. SCOPE — minimal shippable slice

The product owner's intent is "**admit uncertainty without error-bar clutter**." That is satisfied by a small core. Recommended **first PR (must-have):**

1. **`formatMetric(metricId, value)`** precision contract (datascience §1) + apply to the **actual offenders** (`export.worker.ts`, `ReportService.ts`, `PressureOptimization.tsx`). Highest correctness-per-line.
2. **`poissonRateCI` + `rollingMeanCI`** pure utils with locked reference vectors (datascience §3.2/§3.3).
3. **AHI trend = rolling mean + 95% SEM band as default**, raw nights de-emphasized (dataviz P0 / ux §3.2). One chart, one band, the single highest-value visual.
4. **`reliabilityTier` util (3-state)** + **`ReliabilityChip`** rendered **only when degraded**, wired into the AHI KPI card and the central/obstructive-split + RERA/flow-limitation labels with "surface-don't-diagnose" copy (ux §3.5).
5. **One `reliability` line** added to `MetricDefinition` + glossary copy for the soft metrics (`documentation`).

**Defer (gold-plating / follow-up):** 5-tier model, `limited`/`unavailable` states, `DataQualityNotice` banner, high-leak epoch hatch shading on the Signal Viewer, per-point exact-Poisson error bars, PDF hatch-fill bands, the trust-rail, the de-emphasized-trailing-decimal CSS treatment, cross-manufacturer guard (needs provenance verification), wearable-provenance labels. None of these are needed to "admit uncertainty"; several add exactly the clutter the owner warned against.

---

## 4. TESTABILITY

- **datascience utils are highly testable** and ship with reference vectors — good. BUT: **one locked vector is wrong** — the draft's "rule of three N=0 ⇒ 3.0" (uncertainty-statistics §7) is the *one-sided* bound; the two-sided method in the same doc yields **3.689 counts (0.6148/h at T=6)**. datascience already flagged this; `unit-tester` MUST lock **3.689**, not 3.0. (Blocker if the wrong value is encoded.)
- Required unit coverage: `poissonRateCI` (N=5, 30, 40, 0; exact vs normal crossover at N=20; `hours<=0`→NaN; non-integer/negative count→NaN), `rollingMeanCI` (n=8 t-mult, n=4 sem=0, n=1 sem=NaN, n<15 uses t not z), `inverseChiSquare` edge cases, `reliabilityTier` gate table (each gate fires; missing-context ≠ downgrade; unknown metricId→`moderate` no-throw), `formatMetric` per-row of the §1 table incl. banker's-rounding stability.
- **e2e (Playwright):** AHI trend renders band + table-behind-chart with Lower/Upper/window columns; chip appears on the split card and NOT on pressure/usage; tooltip shows `x (CI lo–hi)` one-decimal; PNG export keeps band distinguishable.
- **a11y (axe):** chip has icon **and** text (1.4.1), focusable, `aria-label` full sentence; KPI `<article aria-label>` appends reliability state; band exposed via table not color; resolved-token contrast in **both** themes (the UI estimates do not count).
- **Reference-vector sufficiency:** sufficient for `poissonRateCI`/`rollingMeanCI`. **Insufficient** for `reliabilityTier` boundary behavior (only 4 examples; need one per gate + combined-gate floor) and for `inverseChiSquare` (no isolated vectors — currently only tested transitively via `poissonRateCI`). Ask datascience to add those.

---

## 5. STANDARDS / GATES

- **TypeScript strict / no `any`:** the discriminated-union tier (resolve §1.1 first) is fine. Watch the recharts range-datum typing in `ConfidenceBandArea` — recharts types for 2-tuple `dataKey` are weak and a tempting place for `as`/`any`. **No unjustified `as` will pass review.**
- **Theming:** every new token must exist in **both** `:root` and `[data-theme='dark']` (UI provides both — good). The KM `confidenceBand` class must migrate to the shared token, not fork.
- **WCAG AA:** color-only reliability is an automatic **block** (all three of ux/ui/dataviz honor this; enforce in tests).
- **Conventional Commits:** split into `feat:`/`fix:`/`test:`/`docs:` per the slice in §3; the precision change is user-facing → **`CHANGELOG.md` entry required** (esp. the leak integer-rounding behavior change). Missing CHANGELOG = block.
- **Pre-commit:** `prettier --check`, `eslint`, `tsc --noEmit`, `vitest related` must pass; new math utils will pull their tests into `vitest related`.

---

## 6. RISKS

- **Correctness (blocker-class):**
  - **N=0 bound (3.0 vs 3.689)** — encoding 3.0 with a two-sided method mislabels the CI. Lock 3.689. (datascience already caught this; ensure it survives into code.)
  - **Median center + mean-SEM band** (§1.7) — a CI that doesn't match its estimator is itself a misleading uncertainty display, which violates the core thesis ("never imply more certainty/■different certainty than exists"). Must be reconciled.
  - **Double-counting variance** — datascience §2.2 is correct that the empirical window SD already contains Poisson noise; any later "improvement" that adds per-night Poisson SE on top of the SEM band would double-count. Guard this in review.
  - **`[?]`-flagged manufacturer numbers** — 24 L/min leak, 0.2 cmH₂O resolution, ±0.5+4% pressure, ~1 cmH₂O FOT, patent numbers are all `[?]`/`[C]`. **None may be hard-coded into logic or asserted as fact in help copy** until `resmed-specialist` confirms. 24 is the only one feeding logic and is already a magic number in 3 places — route through `resmed-specialist` before promoting it to a "confirmed" constant.
- **Performance:** low risk — all CI math is on per-night summaries (~1,800 pts/5yr), memoizable; the high-leak shading is correctly specced as run-length spans on the 0.5 Hz channel, not per-25 Hz-sample. The only watch item is the recharts band re-render on the dashboard sparkline path; keep `isAnimationActive={false}` as the existing charts do.
- **Accessibility:** band-as-color-only is the main trap; mitigated by hatch + table-behind-chart. Ensure the chip-as-`<button>` doesn't create a focus-order explosion on dense Explore tables (UX's "one chip max per card" rule must be enforced in code, not just prose).

---

## 7. VERDICT (per proposal)

| Proposal | Verdict | Required changes to clear |
|---|---|---|
| **datascience** | **APPROVE WITH CHANGES** | (a) Lock N=0 two-sided = **3.689 counts**, not 3.0. (b) Add isolated `inverseChiSquare` and per-gate `reliabilityTier` reference vectors. (c) Resolve the median-vs-mean center with dataviz (§1.7) — datascience's mean+SEM is the coherent choice; make it the agreed default. (d) Promote 24 L/min etc. to named constants gated on `resmed-specialist`, do not encode raw. |
| **dataviz** | **APPROVE WITH CHANGES** | (a) Spike/prove the recharts range-datum floating band before committing to "no masking hack"; document the fallback. (b) Drop the **median center** OR pair it with a proper (non-SEM) interval; align with datascience. (c) Migrate the existing KM `confidenceBand` to the shared uncertainty token rather than a parallel style. (d) Verify per-signal provenance exists before promising wearable/cross-manufacturer labels. |
| **ux** | **APPROVE WITH CHANGES** | (a) Reconcile chip labels & icon→tier map with ui-design (§1.2/1.3) — currently the triangle conflicts. (b) Note that `EnhancedKPICard.reliability` prop and `MetricDefinition.reliability` field do not yet exist (add them). (c) Re-scope to the §3 slice; move `DataQualityNotice`, epoch shading, Explore provenance to follow-up. |
| **ui-design** | **BLOCK** (until tier model reconciled) | (a) **Drop the 5-tier model** or stop calling it an extension of `ConfidenceTier`; the shared type is 3-state and `frontend` cannot honor two contradictory enums. Re-express `limited`/`unavailable` as orthogonal (caveat / `—`). (b) Re-run WCAG contrast on **resolved** tokens in both themes — the current figures are explicitly estimates and cannot gate sign-off. (c) Reconcile chip labels/icons with ux. (d) Confirm `low`=violet is a project decision (it is load-bearing here and absent elsewhere). The visual system is good; it is blocked only on the enum collision, which would otherwise propagate a type contradiction into `frontend`.|

**Gate summary:** No code starts until §1 decisions (esp. items 1, 2, 3, 7) are made by the orchestrator. datascience may begin its pure utils immediately *after* the N=0 fix is acknowledged, since they are independent of the visual reconciliation.
