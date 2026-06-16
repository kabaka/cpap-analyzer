# Statistical Methods & Display-Precision Proposal

**Author:** data-science · **Status:** Proposal (for orchestrator → qa/resmed-specialist/unit-tester review) · **Date:** 2026-06-15

**Purpose.** Define exactly _what_ the app computes for measurement uncertainty and _at what precision_ it displays each metric. This is the quantitative backbone for UI/viz/help. It fixes the false-precision bugs (e.g. two-decimal AHI) and specifies a small set of pure, testable TS utilities with reference vectors.

**Sources.** `docs/accuracy/_drafts/uncertainty-statistics.md` (Report B), `docs/accuracy/_drafts/cpap-device-accuracy.md` (device accuracy). Existing math is in `src/analysis/math/index.ts` and `src/analysis/descriptive/index.ts`; reliability-tier precedent in `src/analysis/breathing/confidenceTier.ts`.

**Guiding rules (project priority order: Privacy > Correctness > Performance > UX).** Never display more precision than the metric carries (GUM §7.2). Distinguish _descriptive_ from _diagnostic_ — this tool does not diagnose. Every formula here is a standard textbook result or cited; no fabricated numbers. Manufacturer figures flagged `[?]` in the drafts MUST NOT be hard-coded into logic until verified.

---

## 1. Per-metric display-precision table

"Resolution" = the smallest place value to render. Counts are exact integers; rates/derived quantities carry the uncertainty. Trailing zeros are significant and must be kept (render "5.0", not "5").

| Metric                                                          | Unit                    | Display resolution                                 | Justification (tied to real uncertainty)                                                                                                                                     |
| --------------------------------------------------------------- | ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AHI** (and AHI delta)                                         | /h                      | **1 decimal**                                      | Typical single-night AHI uncertainty ≈ 1 event/h (Poisson √N, Report B §3.5). Two decimals imply ~100× false precision. Matches AASM convention.                             |
| **oAI / cAI / hypopnea index** (AHI sub-indices)                | /h                      | **1 decimal**                                      | Same Poisson basis. Sub-indices have _fewer_ events than total AHI, so are noisier, never more precise — 1 dp is already generous for low central counts.                    |
| **RDI**                                                         | /h                      | **1 decimal**                                      | Same rate basis as AHI; the RERA component is a surrogate (no EEG), so precision must not exceed AHI's.                                                                      |
| **Pressure** (median, mean, P95, EPAP, IPAP, min/max, CPAP set) | cmH₂O                   | **1 decimal**                                      | Pressure is near ground truth; device set resolution is 0.2 cmH₂O on ResMed `[?]` (cpap-device-accuracy §2, line 350 of Report B). 1 dp matches resolution; 2 dp exceeds it. |
| **Pressure delta (titration)**                                  | cmH₂O                   | **1 decimal**                                      | Same basis.                                                                                                                                                                  |
| **Leak — median**                                               | L/min                   | **integer**                                        | Leak is a noisy 0.5 Hz signal summarised by quantiles; sub-L/min digits are noise (Report B §6.1).                                                                           |
| **Leak — P95**                                                  | L/min                   | **integer** (1 dp acceptable)                      | Percentile of a noisy signal; integer preferred.                                                                                                                             |
| **Leak — max**                                                  | L/min                   | **integer**                                        | Single-sample extreme of a noisy signal; decimals meaningless.                                                                                                               |
| **Tidal volume (Vt)**                                           | mL                      | **integer** (round to nearest 5–10 mL for display) | Second-order integration of leak-corrected flow; disclaimed below 100 mL (cpap-device-accuracy §3). Per-mL precision is false. Trend metric only.                            |
| **Minute ventilation (MV)**                                     | L/min                   | **1 decimal**                                      | Vt×RR; inherits Vt error + correlated RR error. 1 dp is the floor of meaningfulness. Trend only.                                                                             |
| **Respiratory rate (RR)**                                       | breaths/min             | **integer** (1 dp for averaged trend)              | Breath-segmentation derived; per-breath integer; a windowed mean may show 1 dp.                                                                                              |
| **SpO₂ mean**                                                   | %                       | **integer** (1 dp for a trailing mean)             | Pulse oximetry accuracy ≈ ±2% (ARMS); sub-percent single-value precision is false. A multi-night mean may show 1 dp.                                                         |
| **SpO₂ min (nadir)**                                            | %                       | **integer**                                        | Single extreme sample; decimals meaningless and artifact-prone.                                                                                                              |
| **T90 (time < 90% SpO₂)**                                       | min (or % of recording) | **1 decimal min**, or **integer %**                | Derived from thresholded samples; depends on coverage — gate on SpO₂ coverage (§4).                                                                                          |
| **ODI**                                                         | /h                      | **1 decimal**                                      | Rate metric, same Poisson basis as AHI.                                                                                                                                      |
| **Usage / mask-on time** (per session)                          | h                       | **1 decimal** (h:mm acceptable)                    | Simple timer, high accuracy; but it is the AHI _denominator_, not sleep time. 1 dp is plenty for any averaged value.                                                         |
| **Average nightly usage**                                       | h                       | **1 decimal**                                      | Mean over few nights; minute precision overstates.                                                                                                                           |
| **Compliance %** (e.g. % nights ≥ 4 h)                          | %                       | **integer**                                        | Underlying nights are few; decimals overstate precision (Report B §6.1).                                                                                                     |
| **Event counts** (any)                                          | count                   | **integer (exact)**                                | Counts are exact; the _rate_ derived from them carries uncertainty.                                                                                                          |
| **Central fraction** cAI/(cAI+oAI)                              | %                       | **integer**, with reliability caveat               | Rare-class ratio; low PPV at low central counts (Report B §2.6, §5.4). Show qualitative caveat, not extra digits.                                                            |
| **Cluster severity score**                                      | unitless                | **1 decimal**                                      | Heuristic composite; not a measured quantity.                                                                                                                                |

**Implementation note.** Display rounding must be a _presentation-layer_ concern (a `formatMetric(metricId, value)` helper for `frontend`), never applied to stored values (which keep full precision for re-aggregation). Use round-half-to-even (banker's rounding) for stability.

---

## 2. Which metrics get a quantitative uncertainty interval

### 2.1 Per-night AHI — exact/normal Poisson CI

AHI = N/T (events ÷ hours of mask-on use). T is comparatively well known, so the dominant uncertainty is the Poisson counting of N (Report B §3).

- **Normal approximation (N ≳ 20):**
  `AHI ∈ ( N ± z·√N ) / T`, z = 1.95996 for 95%. Equivalently u(AHI) = √N / T.
- **Exact chi-square (Garwood, all N, required for N < 20):**
  `λ_lo = ½·χ²(α/2; 2N)`, `λ_hi = ½·χ²(1−α/2; 2N+2)`, with `λ_lo = 0` when N = 0. Divide both by T for the rate interval.

**Rule:** use the **exact** interval whenever N < 20 (the normal lower bound can go negative); the two agree for large N so exact is safe to use always (use normal only as a fast path / explanatory text). The chi-square quantile needs a new inverse-chi-square (equivalently inverse-regularised-lower-gamma) helper — none exists in `math/`.

Caveat to encode in copy, not in the number: Poisson is an **optimistic lower bound** because real events are over-dispersed (cluster in REM/supine), so the true interval is _at least_ this wide.

### 2.2 Aggregate / rolling AHI mean CI over a window

For a trailing window of n nightly AHI values with sample mean x̄ and sample SD s:

`x̄ ± z · s/√n` (SEM band; s/√n already available as `stdErr` in `computeDescriptiveStats`).

This is the **headline** uncertainty the app should show (Report B §4, §6.3: multinight means are far more reliable; reliability stabilises after ~14 nights, Lechat 2022). For small n (< ~15) use the Student-t multiplier `t(1−α/2; n−1)` instead of z — `studentTCDF`/`twoTailedPValue` already exist; we need the inverse (a `tQuantile`), or approximate via `inverseNormalCDF` for n ≥ 15 and document the small-n caveat.

**Combining the two noise sources.** The window SD `s` already _contains_ both per-night Poisson counting noise and night-to-night biological variability (it is the empirical scatter of the realised AHIs). Therefore:

- For the **aggregate headline**, use the empirical SEM band **alone** — do **not** also add per-night Poisson terms; that would double-count the counting noise already present in s. (This is the correct default.)
- Per-night Poisson CIs are for the **per-night detail view only**, where each night is shown in isolation.
- Only if a window has very few nights _and_ you want a variance floor would you take `max(empirical SEM, mean per-night Poisson SE)`; flag this as a secondary refinement, not the default.

### 2.3 Where RSS error propagation applies — and where it must NOT

RSS (root-sum-of-squares / quadrature) is valid only for **independent** inputs (Report B §2.2–2.4).

- **Applies:** AHI = N/T as a ratio of (largely) independent count and duration uncertainties → relative uncertainties add in quadrature. Duration term is negligible (Report B §2.5).
- **Does NOT apply (shared common cause → correlated errors):**
  - **Vt and MV** share the same leak-corrupted flow trace → positively correlated errors that _reinforce_, not cancel. Use the covariance form or a worst-case linear bound; never naive RSS.
  - **cAI and oAI** come from one classifier on one flow signal and are _negatively_ correlated (a mislabel moves both). The central fraction cAI/(cAI+oAI) must use the covariance form, not RSS.
  - Any pair of **flow-derived metrics in a high-leak epoch** — leak is a shared bias (common cause), so treat them as correlated-and-biased, down-weight, do not combine independently.

**Decision:** the app does not currently need to _compute_ covariance-form propagation for these; instead it applies a **reliability tier / down-weight** (§2.4) for the correlated cases and reserves numeric CIs for AHI only. This is the conservative, defensible choice.

### 2.4 Metrics that get only a qualitative reliability tier (no numeric CI)

Per cpap-device-accuracy §10 ranking, these are too modeled / correlated / definition-dependent for an honest numeric CI; assign a **three-state tier** (high / moderate / low) instead, mirroring `confidenceTier`:

| Metric                                      | Why tier not CI                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Central/obstructive split, central fraction | Active-probe inference, leak-sensitive, known misclassification mode, ICC ~0.16 obstructive (Nigro 2014) |
| Hypopnea index                              | Flow-only definition, no desat/arousal; not PSG-equivalent                                               |
| Tidal volume / MV / RR                      | Second-order, leak-correlated; disclaimed at low Vt/MV                                                   |
| Flow-limitation %, RERA/surrogate           | Proprietary, unvalidated, no ground truth                                                                |
| Leak stats                                  | A _gate_ on other metrics rather than a metric with a clean CI                                           |

**Tier assignment rule (data-quality gating).** Start at `high`, downgrade one step per failed gate (floor `low`):

1. **Large-leak gate** — if median/duration-weighted unintentional leak exceeds the large-leak threshold (§4), downgrade all flow-derived metrics. (Leak itself does not get a CI.)
2. **Session-length gate** — if mask-on time < the stable-AHI minimum (§4), downgrade AHI/index reliability.
3. **Low event-count gate** — if total N < 20, AHI CI is wide → tier ≤ `moderate`; if the _sub-count_ (central or obstructive) < the split minimum (§4), central fraction tier = `low`.
4. **SpO₂ coverage gate** — if oximetry coverage < the coverage minimum (§4), SpO₂ mean/min/T90/ODI tier = `low` (or suppress).

---

## 3. Pure, testable TS utilities to add

New module: `src/analysis/uncertainty/index.ts` (barrel-exported from `src/analysis/index.ts`). All functions pure, deterministic, no I/O. Reuse `at`, `lnGamma`, `inverseNormalCDF`, `computeDescriptiveStats` — do **not** duplicate.

### 3.1 `inverseChiSquare(p, df)` — new low-level helper (math/)

Inverse chi-square CDF via the regularised lower incomplete gamma `P(df/2, x/2)` inverted (Newton/bisection on a `lowerGammaRegularized` built from `lnGamma`). Add `lowerGammaRegularized(s, x)` to `math/index.ts` (series for x < s+1, continued fraction otherwise — Numerical Recipes `gammp`/`gcf`). Needed by §3.2.

- Edge cases: df ≥ 1; p ∈ (0,1); return NaN otherwise.

### 3.2 `poissonRateCI(count, hours, conf = 0.95)`

```
interface RateCI { point: number; lower: number; upper: number; method: 'exact' | 'normal'; }
poissonRateCI(count: number, hours: number, conf?: number): RateCI
```

- `point = count / hours`.
- Exact: `lower = (count===0 ? 0 : 0.5*inverseChiSquare(α/2, 2*count)) / hours`, `upper = 0.5*inverseChiSquare(1−α/2, 2*count+2) / hours`, α = 1−conf.
- Edge cases: `hours <= 0` → all NaN; `count < 0` or non-integer → NaN (reject); `count === 0` → lower = 0.
- `method` is `'exact'` always for the value; expose a separate `poissonRateCINormal` for the fast/teaching path: `(count ± z√count)/hours`, lower clamped to 0.

**Reference vectors (verified here against scipy `chi2.ppf`; 95%):**
| count | hours | point /h | exact lower /h | exact upper /h |
|---|---|---|---|---|
| 5 | 1.0 | 5.0 | **1.6235** | **11.6683** |
| 30 | 6.0 | 5.0 | **3.3735** | **7.1378** |
| 40 | 6.0 | 6.6667 | **4.2932** | **9.0781** _(=28.5766/6, 54.4686/6)_ |
| 0 | 6.0 | 0.0 | **0.0** | **0.6148** _(=3.6889/6; two-sided 97.5% χ² upper for N=0 = 3.6889 counts)_ |

Normal-approx check: count=30, hours=6 → **[3.211, 6.789]** /h.
Count integer-count CI (no ÷T): N=5 → [1.6235, 11.6683]; N=30 → [20.2409, 42.8269]; N=40 → [28.5766, 54.4686].

### 3.3 `rollingMeanCI(values, conf = 0.95)`

```
interface MeanCI { mean: number; lower: number; upper: number; sem: number; n: number; }
rollingMeanCI(values: number[], conf?: number): MeanCI
```

- Filter non-finite (`filterFinite`); n = clean length.
- `mean`, `sem = s/√n` from `computeDescriptiveStats` (s = Bessel-corrected SD).
- Multiplier: `inverseNormalCDF(1−α/2)` for n ≥ 15; `tQuantile(1−α/2, n−1)` for n < 15 (add `tQuantile` via bisection on `studentTCDF`). `lower/upper = mean ± mult·sem`.
- Edge cases: n = 0 → all NaN; n = 1 → mean defined, sem = NaN, CI = [mean, mean] with a `degenerate` note (document); identical values → sem = 0, CI collapses to mean.

**Reference vectors (compute & lock in unit-tester):**

- `[4,5,6,5,4,6,5,5]` (n=8): mean = **5.0**, s = **0.7559**, sem = **0.2673**; t(0.975,7)=2.3646 → CI ≈ **[4.368, 5.632]**.
- `[5,5,5,5]`: mean 5, sem 0, CI [5,5].
- `[5]`: mean 5, sem NaN.

### 3.4 `reliabilityTier(metricId, context)`

```
type ReliabilityTier = 'high' | 'moderate' | 'low';
interface ReliabilityContext {
  medianLeak?: number;        // L/min, unintentional
  maskOnHours?: number;       // session length
  eventCount?: number;        // N for the index
  subEventCount?: number;     // central or obstructive sub-count
  spo2Coverage?: number;      // fraction [0,1] of recording with valid SpO2
}
reliabilityTier(metricId: string, ctx: ReliabilityContext): ReliabilityTier
```

- Start `high`; apply the §2.4 gates relevant to `metricId`; downgrade one step per failed gate (clamp at `low`). Deterministic, table-driven (which gates apply to which metricId). Mirror `confidenceTier` style and return a paired label helper `reliabilityTierLabel`.
- Edge cases: undefined context fields = gate not evaluated (do not downgrade on missing data, but a separate `insufficientData` boolean may be returned by the caller); unknown metricId → `moderate` with a console-free fallback (no throw).

**Reference vectors:** AHI with N=40, maskOnHours=7, leak=10 → `high`; AHI with N=8 (<20) → `moderate`; central-fraction with subEventCount=2 → `low`; Vt with medianLeak above threshold → downgraded.

---

## 4. Concrete thresholds (with citations / provenance)

| Threshold                                         | Proposed value                                                                      | Basis / citation                                                                                                                                                                                                                                                                                                                                   | Status                                                                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Large-leak gate** (ResMed, unintentional)       | **24 L/min**                                                                        | ResMed AirSense "red zone" widely referenced (cpap-device-accuracy §6, line 143). Pick 24 (the _reporting_ threshold) over the ~30 L/min algorithmic de-weighting figure because it is the published red-zone the user already sees, is the more conservative (lower) gate, and aligns the app's reliability flag with the device's own indicator. | **`[?/C]` — confirm with `resmed-specialist` before hard-coding.** Make it a named constant, not a literal. Philips reports _total_ leak → different threshold; never reuse 24 cross-brand. |
| **Min session length for "stable" AHI**           | **≥ 4.0 h mask-on**                                                                 | Aligns with the 4-h compliance convention and gives N large enough that √N relative error is tolerable; below this, widen/flag CI (Report B §3.5; cpap-device-accuracy §7.1).                                                                                                                                                                      | Proposed convention (not a hard clinical rule). Below 4 h → downgrade tier, always show CI.                                                                                                 |
| **SpO₂ coverage minimum**                         | **≥ 0.50 of recording with valid samples** (suppress below; full confidence ≥ 0.80) | T90/ODI/mean are meaningless on sparse coverage; threshold is a defensible engineering convention.                                                                                                                                                                                                                                                 | Proposed; no specific citation — label as app convention, confirm desired strictness with `ux`/`resmed-specialist`.                                                                         |
| **Min event count for central/obstructive split** | **≥ 20 total events AND ≥ 5 in the rarer sub-class**                                | Below ~5 central events, false-positive leakage from the abundant obstructive pool dominates bias & variance (Report B §2.6 worked example); low PPV for rare class (§5.4).                                                                                                                                                                        | Derived/illustrative — the "5" is a reasonable floor, not a validated cutoff. Mark as convention.                                                                                           |
| **Min N for normal-approx Poisson CI**            | **N ≥ 20** (else exact)                                                             | Standard √N normal approximation validity (Report B §3.2).                                                                                                                                                                                                                                                                                         | Standard statistical practice.                                                                                                                                                              |
| **Nights for reliable trailing mean**             | informational: **~14 nights** to plateau                                            | Lechat 2022 F1 0.77→0.94 plateau ~14 nights (Report B §4.2).                                                                                                                                                                                                                                                                                       | Cited; use in copy/empty-states, not as a hard gate.                                                                                                                                        |

All thresholds MUST be named constants in one config object (e.g. `RELIABILITY_THRESHOLDS`) with inline citation comments, so `resmed-specialist` can correct the `[?]` ones without code archaeology.

---

## 5. Correctness review of the three research drafts

I reviewed Report B (uncertainty-statistics) and cpap-device-accuracy. Findings:

**Errors / inconsistencies to fix:**

1. **Rule-of-three inconsistency (Report B §3.4 line 227 and §7 line 394).** The text says "for N=0 the exact upper 95% bound is μ ≤ 3.0 (rule of three)" and lists "Rule of three: N=0 ⇒ upper 95% bound μ=3.0" as a reference value. But the **two-sided** exact formula given in the same section (`½·χ²(1−α/2; 2N+2)` with α/2 = 0.025) yields **3.689**, not 3.0. I verified: one-sided 95% χ²(0.95,2)/2 = **2.996 ≈ 3.0**; two-sided 97.5% χ²(0.975,2)/2 = **3.689**. So "3.0" is the _one-sided_ bound and is inconsistent with the draft's own _two-sided_ method. **Action for unit-tester: do NOT lock 3.0 as the two-sided reference.** The correct two-sided 95% upper for N=0 is **3.689 counts** (0.6148 /h at T=6). Pick one convention (recommend two-sided to match all other CIs) and make the draft internally consistent.

2. **Worked-AHI rounding (Report B §2.5 / §7 line 390).** Section 2.5 reports u(AHI)=1.25 and "6.7 ± 1.3"; the reference-values block says u(AHI)=1.254. Minor, but the 10% `u_detect` term feeding it is explicitly a **placeholder** — see below. Lock only the √N and exact-Poisson vectors, not the 1.254 figure.

**Overstated / placeholder numbers that MUST NOT be encoded into logic:**

3. **`u_detect` = 10% scoring imprecision (Report B §2.5, §2.6 classifier s=0.9, f=0.05).** Explicitly illustrative placeholders. Correctly flagged in §7 as needing an agreement study. Do not encode any of these (10%, s, f, the 1.254 result) as constants.

4. **ResMed pressure accuracy "±0.5 cmH₂O + 4%" (cpap-device-accuracy §2 line 42, `[?]`).** Community/service-manual figure, unconfirmed. Do not encode. The 0.2 cmH₂O display resolution (Report B line 350) is also `[?]` — confirm with `resmed-specialist` before tying display logic to it (the §1 table flags this).

5. **ResMed FOT ~1 cmH₂O amplitude and patent numbers (cpap-device-accuracy §4, §11, `[?]`).** Unconfirmed; not load-bearing for statistics, but do not assert in help copy as fact.

6. **Large-leak 24 L/min (`[?/C]`) and the S9-era ~42 L/min figure (cpap-device-accuracy §6 line 143).** This is the one `[?]` figure that _does_ feed logic (the leak gate). Treat as a provisional named constant pending `resmed-specialist` confirmation.

7. **Sampling rates (25 Hz flow, 0.5 Hz leak/Vt/MV) — `[C]` community-derived.** Reliable in practice; fine to use, but label provenance in docs.

**Numbers I judge sound (verified or standard):** all Poisson/chi-square reference vectors in Report B §7 (N=5 → [1.6235, 11.6683], N=30/T6 → [3.374, 7.138], normal N=30 → [3.211, 6.789], √40 = 6.3246) — I reproduced these independently. The cited PubMed figures (Lechat ICC/F1, Prasad ICC 0.73, Iftikhar 59–112% error, Nigro ICC central 0.69/obstructive 0.16) are properly attributed and internally consistent; I did not re-verify against the primary articles (recommend a citation spot-check by `documentation`). No fabricated numbers detected beyond the labelled placeholders.

---

## Handoffs

- **unit-tester:** lock §3.2/§3.3 reference vectors; use the corrected N=0 two-sided value (3.689 counts), not 3.0.
- **resmed-specialist (via orchestrator):** confirm 24 L/min leak gate, 0.2 cmH₂O pressure resolution, and the `[?]` device figures in §5 before any are hard-coded.
- **frontend / data-visualization:** §1 table is the presentation-layer rounding contract; build `formatMetric` and render AHI/usage with a SEM band per §2.2.
- **ux / documentation:** §4 SpO₂-coverage and split thresholds are app conventions needing sign-off and clear in-app explanation.
