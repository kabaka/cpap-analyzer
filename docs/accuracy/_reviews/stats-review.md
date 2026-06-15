# Adversarial Statistical Review — Measurement-Uncertainty Feature

**Reviewer:** data-science (fresh, adversarial) · **Date:** 2026-06-15
**Targets:** `_proposals/datascience-proposal.md`, `_proposals/dataviz-proposal.md`
**Drafts referenced:** `_drafts/uncertainty-statistics.md` (Report B), `_drafts/cpap-device-accuracy.md`
**Verification:** chi-square/t quantiles recomputed independently in a Wolfram Language kernel (`ChiSquareDistribution`, `StudentTDistribution`, `NormalDistribution`). All recomputed values are reported below.

I did not author these proposals. Verdicts are blunt by design. The headline finding is one **wrong reference vector** that would corrupt unit tests, plus several places where the framing risks misleading users — in **both** directions (over- and under-confidence).

---

## 1. Per-night AHI Poisson model — **NEEDS CHANGE (caveat + relabel, keep as a floor)**

The Poisson model treats per-night events as iid with `Var(N)=E[N]=λT`. This is **wrong as a generative model**: respiratory events are strongly clustered (REM-locked, supine-locked, arousal cascades), i.e. **over-dispersed**. For an over-dispersed count process the true `Var(N) > λT`, so the Poisson SE `√N` and the Garwood interval are **too narrow** — they **understate** per-night uncertainty, sometimes badly (a night dominated by two long REM clusters has effective sample size far below N).

The proposal (§2.1) and Report B (§3.1) both already say this — "optimistic lower bound." Good. But the consequence is under-emphasised in the **product**: a numeric "95% CI" rendered on a per-night chart (dataviz P2) reads to users as *the* uncertainty, not a lower bound on it. A lower bound presented as a CI is a correctness failure (Principle 2), because it systematically reassures.

**Verdict / actions:**
- **Keep** Garwood for the per-night detail view (it is exact, transparent, deterministic, and conservative-in-direction relative to *ignoring* sampling noise).
- **Relabel** it. Do not call it "the 95% CI." Call it the **"Poisson sampling interval (lower bound on uncertainty)"** in tooltips, table headers, and ARIA names. This is a one-line copy change with real correctness value.
- Do **not** attempt a per-night over-dispersion correction (e.g. negative-binomial or a quasi-Poisson inflation factor `φ`). Estimating `φ` from a single night is not identifiable; any chosen multiplier would be a fabricated constant, which violates the project's own "no fabricated numbers" rule.
- The honest accounting of over-dispersion lives at the **window** level, where the empirical SD captures it directly (see §2). That is the right place to spend the uncertainty budget — reinforce that the *window band*, not the per-night interval, is the headline (both proposals already do; keep it).

---

## 2. Rolling-mean CI `x̄ ± z·s/√n` — **NEEDS CHANGE (band can be misleadingly narrow)**

**The "don't double-count Poisson + empirical SD" argument is CORRECT and should be kept.** The window SD `s` is the empirical scatter of realised nightly AHIs; that scatter already contains (a) per-night Poisson counting noise, (b) detection noise, and (c) biological night-to-night variation. Adding a separate Poisson term on top would double-count (a). Verdict on that specific point: **statistically sound.** The `max(empirical SEM, mean per-night Poisson SE)` variance floor for tiny windows is a reasonable, clearly-flagged secondary refinement — fine.

**But the SEM band itself is not valid under the data's real structure**, and the proposal does not caveat this enough:

1. **Autocorrelation.** Consecutive nights are positively autocorrelated (a congested week, a new mask, a stretch of alcohol). With lag-1 autocorrelation `ρ₁>0`, the effective sample size is `n_eff = n·(1−ρ₁)/(1+ρ₁) < n`. The naive `s/√n` therefore **understates** the SEM — the band is **too narrow**. For ρ₁≈0.3 (plausible), `n_eff ≈ 0.54n`: the true SEM is ~36% larger than reported. This is the dataviz "limited data → wide band" promise failing silently in exactly the autocorrelated regime where users most want trust.
2. **Non-stationarity.** A trailing window that straddles a pressure change, a mask change, or onset of treatment-emergent central apnea is sampling **two different distributions**. `x̄` is then a meaningless blend and `s` is inflated by the step change, not by sampling noise — the CI is simultaneously **biased** (wrong center) and **mis-shaped**. A rolling mean over a regime change is the classic way to hide a real, clinically relevant shift.

**Verdict / corrections:**
- **Prefer a rolling *median* center** (dataviz already offers this — make it the default, not "if ux prefers"). The median is robust to outlier nights and to the leading edge of a regime change.
- **Widen the band for autocorrelation.** Either (i) inflate to `n_eff` using a lag-1 estimate when `n ≥ ~10`, or (ii) if that is deemed too clever, **drop the parametric `±z·SEM` entirely and show empirical window quantiles** (e.g. 10th–90th percentile of the nightly AHIs as the band). Empirical quantiles make no iid/normality assumption, naturally widen with real spread, and are honest about aleatoric variation. This is my recommended primary band; reserve `±z·SEM` for the *center estimate's* uncertainty only, clearly distinguished from the spread band.
- **Detect non-stationarity before averaging.** Reuse the existing change-point capability (CLAUDE.md lists change-point detection in scope). If a change point falls inside the window, **split the window at it** and/or annotate ("therapy changed — trend reset"). Do not silently average across it. This is a correctness gate, not a nicety.
- Small-n Student-t multiplier (n<15) is correct and the inverse-t helper is the right addition. Keep.

---

## 3. Garwood exact vs normal-approx switch at N=20 — **SOUND (switch); one REFERENCE VECTOR IS WRONG**

The N=20 switch threshold is standard practice (normal approx for Poisson is adequate around μ≳20; below it the lower bound can go negative and coverage degrades). Using **exact always** for the displayed value and reserving normal as a teaching/fast path is the right call. **Verdict on the rule: sound.**

I recomputed every reference vector. Results (95%, `lower = ½χ²(0.025;2N)/T`, `upper = ½χ²(0.975;2N+2)/T`):

| Case | Proposal claims | Recomputed | Verdict |
|---|---|---|---|
| N=5, T=1 | 1.6235 / 11.6683 | **1.62349 / 11.66833** | correct |
| N=30, T=6 | 3.3735 / 7.1378 | **3.37348 / 7.13781** | correct |
| N=30 counts | 20.2409 / 42.8269 | **20.24087 / 42.82687** | correct |
| N=40 counts | 28.5766 / 54.4686 | **28.57659 / 54.46865** | correct |
| **N=40, T=6 /h** | **4.2932 / 9.0781** | **4.76276 / 9.07811** | **WRONG (lower)** |
| N=0 two-sided upper, counts | 3.689 | **3.68888** | correct |
| N=0 two-sided upper, T=6 | 0.6148 | **0.61481** | correct |
| Normal N=30,T=6 | 3.211 / 6.789 | **3.21081 / 6.78919** | correct |

**The N=40 lower rate is wrong.** The proposal's own parenthetical says `(=28.5766/6, 54.4686/6)`. 28.5766/6 = **4.7628**, not 4.2932. The upper (9.0781) is right; the lower digit-string is internally inconsistent with the count it cites — a transcription/arithmetic error.

**Action (unit-tester):** lock **N=40, T=6 → [4.7628, 9.0781] /h**. Do **not** encode 4.2932. (4.2932 ≈ 28.5766/6.658, i.e. it looks like a wrong T was used; reject it.)

---

## 4. Rule-of-three inconsistency — **ADJUDICATED**

The proposal correctly flags Report B's contradiction. Definitive ruling, verified:

- **One-sided** 95% upper for N=0: `½·χ²(0.95; 2) = `**2.99573 ≈ 3.0** counts. This is the textbook "rule of three" (3/T).
- **Two-sided** 95% upper (the `½·χ²(0.975; 2N+2)` formula the drafts actually use everywhere else): `½·χ²(0.975; 2) = `**3.68888** counts (0.61481 /h at T=6).

These are different numbers for different intervals. The "3.0" in Report B §3.4/§7 is the **one-sided** value pasted into a **two-sided** method — a genuine inconsistency.

**Ruling:** use the **two-sided** convention everywhere for consistency with all other CIs in the feature. The correct N=0 two-sided 95% upper is **3.68888 counts** (≈3.689). Lock that, not 3.0. Report B must be corrected so its prose ("μ ≤ 3.0") and its method agree; either drop the rule-of-three mention or explicitly label it as the *one-sided* alternative and explain the distinction. The proposal's handoff already says this — endorse it without reservation.

---

## 5. Display-precision table — **MOSTLY SOUND; two items to tighten**

- **AHI 1 dp: defensible and correct.** Typical per-night u(AHI) ≈ 1 /h ≫ 0.1, so 1 dp under-states precision slightly (i.e. is safely conservative) without being absurdly coarse. Two dp would be ~100× false precision. Matches AASM convention. Keep. (Note: 1 dp is arguably *too precise* for very short/noisy nights where u > 1 — but rounding to integer there would lose the threshold-straddling information the CI is meant to show, so 1 dp + the interval is the right combination. No change.)
- **SpO₂ as integer: correct given ±2% A_RMS.** A_RMS of 2% means the RMS error is 2 percentage points; sub-percent digits are pure noise. Integer for single values, 1 dp for a multi-night mean is fine. Sound.
- **T90: NEEDS CHANGE — currently risks *over*-precision.** "1 decimal min" is too fine. T90 is a sum over thresholded oximetry samples; near the 90% threshold, the ±2% oximeter error flips samples in and out, so T90 carries large uncertainty driven by both oximeter error *and* coverage. Recommend **integer minutes** (or integer % of recording), and **suppress below the coverage gate** (§6). 1 dp implies a stability T90 does not have.
- **ODI 1 dp: sound** (it is a Poisson-type rate, same basis as AHI) — *provided* the same "this is a sampling floor" framing applies, since desaturation events also cluster.
- **Central fraction as integer % with caveat: sound** — and the refusal to add decimals to a low-PPV rare-class ratio is exactly right.
- **Leak median/max integer: sound.** Vt rounded to 5–10 mL: sound and appropriately humble.

Banker's rounding at the presentation layer only, full precision in storage: correct architecture. No change.

---

## 6. Thresholds — **MIXED: some justified, several are conventions wearing a number's clothes**

| Threshold | Verdict |
|---|---|
| **Leak gate 24 vs 30 L/min** | **Sound *choice*, correctly flagged `[?]`.** 24 (ResMed red-zone) over ~30 is defended on three valid grounds: it is the lower (more conservative) gate, it is brand-correct (unintentional leak), and it matches the indicator the user already sees. Neither number is statistically *derived* — both are device-reporting conventions. The proposal is honest about this. Keep as a **named constant pending `resmed-specialist`**, and the cross-brand warning (never reuse 24 for Philips total leak) is essential — endorse. |
| **Min session ≥4.0 h** | **Arbitrary-but-defensible convention, correctly labelled.** It borrows the compliance 4-h number, which has **no statistical bearing on AHI precision** — AHI precision depends on **event count N**, not hours. A 3-h night at AHI 30 (N=90) is more precise than a 7-h night at AHI 1 (N=7). **Recommend the gate be on N (or a joint N-and-hours rule), not hours alone.** Using 4 h as a *proxy* is acceptable for UX simplicity if and only if the CI is always shown so the real precision is visible. Flag this mismatch to ux. |
| **SpO₂ coverage ≥0.50 (full ≥0.80)** | **Arbitrary engineering convention; correctly labelled as such.** No statistical justification, and none is claimed. 0.50 is generous (half the night missing still "counts" with a downgrade). Acceptable as a convention; I would lean stricter (suppress < 0.5 is fine, but consider full-confidence ≥ 0.9 for T90/nadir, which are extreme-sensitive). Defer to ux/resmed-specialist as the proposal says. |
| **Split: ≥20 total AND ≥5 in rarer class** | **Partially justified; the "5" is illustrative, correctly flagged.** The §2.6 worked example shows small false-positive leakage from the abundant class dominates a rare-class count — that *mechanism* is sound. But "5" is not derived from a target precision or PPV; it is a round floor. Acceptable as a labelled convention. Better would be to gate on the **estimated PPV** given an assumed false-central rate, but that requires the unverified `s`/`f` constants, which must NOT be encoded — so the round floor is the pragmatic, honest choice. Keep, labelled. |
| **N≥20 normal-approx** | **Sound** (see §3). |
| **~14 nights to plateau** | **Sound and correctly scoped** to copy/empty-states, not a hard gate. Cited (Lechat 2022). |

Net: the thresholds are **honestly labelled** throughout — the proposal does not dress conventions as derived constants. The one substantive statistical error is **gating AHI reliability on hours instead of N** (min-session gate). Fix or justify.

---

## 7. Suppressing single-night AHI deltas ≤ band — **NEEDS CHANGE (false-reassurance risk)**

Rendering a delta inside the band as "stable" (dataviz KPI P0) is **directionally right** — most single-night deltas of 0.5–2 /h are noise (Report B §4, accuracy §7). But "suppress if ≤ band" has two failure modes:

1. **It hides the *start* of real change.** A genuine upward trend begins as a sequence of small deltas, each individually inside the band. Per-step suppression guarantees the trend is invisible until it is large — the opposite of early warning. This is the same non-stationarity blind spot as §2.
2. **It conflates "not individually significant" with "no change."** A run of same-sign sub-band deltas is collectively significant even when none is individually. Suppressing each one is a multiple-comparisons error in reverse.

**Verdict / fix:**
- Suppress the **per-night arrow** (fine — single deltas are noise).
- But **do not let suppression be the only signal.** Drive "stable vs changing" off the **trend/window** statistic (slope of rolling median, or a change-point test), not off the single-night delta vs band. A consistent drift should surface as "rising over N nights" even while each night's delta is sub-band.
- Never render "stable" when a change point is detected inside the window (ties to §2). "Stable" must mean *the trend is flat*, not *last night ≈ previous night*.

The cutoff rule as written **will produce false reassurance** for slow drifts. Tie the reassurance to the trend, not the delta.

---

## 8. Places the proposals OVERSTATE uncertainty — **two, both worth fixing**

Over-correction is also a correctness failure (it trains distrust of good metrics and buries signal):

1. **Pressure precision is handled correctly — flag the *temptation*, not an error.** Both proposals correctly leave pressure un-banded (accuracy rank 1, near ground truth) and at 1 dp. **Endorse — do not let any later iteration add a CI band to pressure.** Banding the most trustworthy metric is the canonical over-correction; the dataviz "explicitly NOT change" list (§2) is exactly right and should be treated as binding.
2. **The blanket "downgrade ALL flow-derived metrics on large leak" is too coarse.** Leak corrupts Vt/MV/flow-morphology metrics, yes. But **apnea *count*** (a gross flow-drop rule, accuracy rank 3, medium-high) is far more robust to moderate leak than Vt is. Downgrading the apnea index identically to Vt over-states AHI uncertainty in the moderate-leak band and may slap "low reliability" on a perfectly usable aggregate AHI. **Recommend a graded gate:** large-leak downgrades Vt/MV/flow-limitation/the CA-OA split strongly, but downgrades the **aggregate apnea/AHI** only one step and only above a higher leak level. The accuracy draft's own reliability ranking supports differentiating these — the proposal's single uniform leak gate flattens that distinction.
3. **Minor:** rendering a Garwood interval as a "95% CI" on long, clean nights (large N) slightly *overstates* uncertainty in the other direction only if users read the lower bound as plausible — but here it is fine because at large N the interval is genuinely tight. No change; just the §1 relabel.

---

## Summary

The proposals are statistically careful and unusually honest about provenance — placeholders (`u_detect`, `s`, `f`, ±0.5+4%, FOT amplitude) are correctly fenced off from logic, and the "don't double-count Poisson + empirical SD" reasoning (§2.2) is **correct**. Verdicts:

- **One hard error:** the **N=40, T=6 lower rate 4.2932 is wrong → 4.7628** (the cited count 28.5766/6 proves it). Independently recomputed; all *other* reference vectors verify exactly. Unit-tester must not lock 4.2932.
- **Rule of three adjudicated:** two-sided N=0 upper = **3.68888 counts** (not 3.0, which is the one-sided value). Use two-sided everywhere; fix Report B.
- **Per-night Poisson:** keep but **relabel as a lower bound on uncertainty** ("Poisson sampling interval"), never "the 95% CI" — events are over-dispersed, so it under-states. Do not invent an over-dispersion multiplier.
- **Rolling SEM band:** the no-double-count logic is sound, but `x̄±z·s/√n` is **too narrow** under positive autocorrelation (use `n_eff` or, preferably, empirical window quantiles) and **invalid across regime changes** (split at change points; default to a rolling *median*). Biggest substantive statistical gap.
- **Delta suppression** risks **false reassurance** for slow drifts — drive "stable/changing" off the trend/change-point, not the single-night delta-vs-band.
- **Min-session gate should key on event count N, not hours** (AHI precision is N-driven). Other thresholds are honestly labelled conventions — acceptable.
- **Over-correction:** keep pressure un-banded (endorsed); **graduate the leak gate** so the robust aggregate AHI is not downgraded as hard as Vt.
- **Display precision:** sound, except **T90 should be integer minutes**, not 1 dp.

**File:** `/home/user/cpap-analyzer/docs/accuracy/_reviews/stats-review.md`
