# Clinical / ResMed Adversarial Review — Measurement-Uncertainty Feature

**Reviewer:** `resmed-specialist` (clinical + device domain) · **Date:** 2026-06-15 · **Status:** Fresh adversarial review (I did not author the proposals)
**Reviewed:** `_proposals/{ux,ui-design,dataviz,datascience}-proposal.md` against `_drafts/cpap-device-accuracy.md` (+ skim of `uncertainty-statistics.md`, `wearable-accuracy.md`)

**Verdict: APPROVE WITH REQUIRED CORRECTIONS.** The overall posture — quiet by default, surface-don't-diagnose, trends over single nights, leak as a data-quality gate — is clinically sound and well-calibrated. But there are **three clinical-safety corrections that must land before implementation** (treatment-emergent central apnea framing, the apnea-count tier claim, and the leak-gate threshold rationale), plus several tiering and device-fact fixes. Details below, numbered to the brief.

---

## 1. Reliability ranking — mostly correct, three mis-tierings

The §10 ranking the proposals inherit is clinically defensible. Specific corrections:

**1a. "Apnea count is robust at low leak" — overstated; do not tier apnea count as `high`.** The UX proposal (§1.1, §3.4, §4 high-leak row) and dataviz repeatedly let "clean apnea count" sit in the silent/`high` bucket alongside pressure and usage. This conflates *count* with *index*. The device's apnea **detection** is robust, but (i) Reiter 2016 showed auto-scoring **undercounts** residual events (auto AHI_flow 4.4 vs manual 7.3), and (ii) any apnea **index** still divides by mask-on time (not sleep time) and still carries Poisson noise. Pressure and usage are *directly sensed*; apnea count is *algorithmically detected from a leak-corrected estimate*. Correct tiering: pressure/usage = `high` (truly silent); **apnea count = `moderate` (medium-high), never `high`.** It can render silent by default for anti-clutter reasons, but it must not be *labeled* ground-truth-equivalent, and it must still be subject to the leak gate. The cpap-device draft itself ranks it "Medium-high" (rank 3), not "High" — the proposals quietly promoted it. Fix the promotion.

**1b. Labeling all hypopnea counts "moderate" — fair, with one caveat.** `moderate` is the right tier. But hypopnea is *more* definition-fragile than aggregate AHI (flow-only, no desat/arousal, threshold-sensitive — draft §5, Nigro ICC 0.15). It should never tier *above* AHI, and at high leak it should drop to `low` like the other flow-derived metrics (the data-science gate table §2.4 handles flow-derived metrics but does not explicitly list hypopnea — **add hypopnea index to the large-leak gate**). Net: `moderate` baseline, `low` under leak. Acceptable as proposed once the leak gate covers it.

**1c. "Leak-below-threshold is reliable" — correct, endorse.** Tiering unintentional leak below the red-zone as `moderate`/medium-high is right (well-characterised vent-subtraction model). One nuance the proposals should encode: leak reliability is *itself* leak-dependent — the vent model degrades as leak rises, so the leak number near/above threshold is less trustworthy than leak at 5 L/min. That is already captured by "leak is a gate, not a CI'd metric" (data-science §2.4) — good. No change required, but do not show a CI band on leak (dataviz §2 correctly keeps the existing percentile band; endorse).

**1d. Central/obstructive split tiered `low` — correct, but see §2 for a safety caveat on the *consequence* of that tier.**

---

## 2. Central/obstructive & RERA framing — RIGHT POSTURE, but a real safety gap

"Surface, don't diagnose / discuss with clinician" is the correct posture and matches the draft (§4.4, §10). The proposals execute it well: `low` chip, "Indicative", rising-CA annotation, no diagnostic language. **Endorse the posture.**

**However, the brief's concern is valid and the proposals under-address it.** There is an asymmetry the current copy gets wrong:

- A `low`-reliability label on the **central/Clear-Airway index** risks a user *dismissing* a genuinely rising CA index as "just an unreliable number." Treatment-emergent central apnea (complex sleep apnea) is a **real, clinically actionable** phenomenon (draft §4.4) — under-reaction here is the dangerous failure mode, not over-reaction.
- The *type split being unreliable* (is this event central or obstructive?) is a different claim from *the trend in CA count being uninformative*. The classification of an individual event is ICC 0.16-bad; but a **sustained upward trend in CA index** is exactly the signal that warrants clinical attention, precisely because the device tends to *under*-classify closed-airway centrals as obstructive (draft §4.4) — i.e., the true central burden may be *higher* than shown.

**Required correction:** the `low` tier on CA must be paired with copy that says **"low precision, but a rising trend still matters — discuss with your clinician."** The reliability framing must not read as "ignore this." Concretely:
- The aleatoric/epistemic copy split (ux §5, ui-design §5) needs a **third tone for CA specifically**: not "naturally varies" (aleatoric, implies benign) and not only "needs more data" (epistemic) — but **"directional flag"**: low precision on *type*, but a persistent rise is worth raising. Reserve a `tone="clinical-flag"` slot.
- The rising-CA annotation (dataviz §1-P1, ux §3.5) should fire on a **sustained multi-night trend**, not a single night (consistent with the rest of the proposal's "trends not nights" thesis), and must never be suppressed merely because the metric is `low`-tier. A `low` tier must **lower the precision claim, not silence the safety flag.**

RERA/flow-limitation framing as a **surrogate** (no EEG) is correct and well-handled — endorse. RERA carries no comparable safety asymmetry (it is not a treatment-emergent-danger signal), so `low` + "surrogate" is fully adequate there.

---

## 3. Thresholds — confirm/correct each

**3a. Leak gate: which threshold should suppress flow-derived metrics — 24 vs ~30 L/min?**

The data-science proposal picks **24 L/min** (the ResMed reporting/"red zone" figure) over the ~30 L/min algorithmic de-weighting figure, reasoning it is the more conservative, lower, user-visible gate. **Clinically I partially disagree on the rationale, and the threshold needs splitting by purpose:**

- For **suppressing/de-weighting flow-derived metrics** (Vt/MV/RR, type split, hypopnea), the relevant physical event is when the **vent-subtraction model and the FOT/pulse patency probe actually break down** — that is the higher (~30 L/min order) regime, not the reporting cosmetic threshold. Gating flow-metric suppression at 24 risks **over-suppressing** metrics that are still usable in the 24–30 band, which trains users to distrust data that is actually fine (the same anti-pattern the whole proposal is trying to avoid).
- For **the user-facing data-quality *notice*** ("high leak tonight"), aligning with the device's own 24 L/min red-zone indicator is correct — the user already sees that flag in myAir/clinical software, so consistency aids trust.

**Recommendation:** use **two named constants**, not one. `LEAK_NOTICE_THRESHOLD = 24 L/min` (drives the `DataQualityNotice`, matches device UX) and a separate `LEAK_METRIC_SUPPRESSION_THRESHOLD` (higher, ~30 L/min order, drives actual de-weighting of flow-derived metrics). Both are **`[?]` and must not be stated as device facts** — see §5. Do not collapse them; the clinical purposes differ. Also: gate on **duration-weighted leak across the night**, not just median — a short leak spike should not condemn the whole night's metrics, but sustained leak should (the draft's "meaningful fraction of the night" language, ux §4, is right).

**3b. Min session length (≥ 4.0 h):** **Confirm with a caveat.** 4 h is a reasonable engineering convention and aligns with the CMS/compliance norm, but flag clearly that it is *not* a clinical reliability cutoff — it is a compliance artifact being borrowed for a statistical purpose. The real driver of AHI noise is **event count N**, not hours (a 2 h night with 40 events is less noisy than a 6 h night with 4 events). The data-science proposal already gates on `N<20` for CIs — good. **Make the session-length gate secondary to the count gate**, and word the copy around "few events / short night → noisy rate," not "short night is bad." Endorse 4 h as a *named convention constant*, not a clinical rule.

**3c. Clinically meaningful AHI change (≤1–2 events/h = noise):** **Confirm.** This is well-supported (Poisson √N + Punjabi ~20% single-night misclassification + the worked example: a 5-event night swings >1.0 on 2–3 events). Suppressing the trend badge inside ±1–2 and showing "≈ stable" is clinically correct and is one of the strongest changes in the proposal. One refinement: at **low absolute AHI** (sub-5, the therapeutic target), a delta of 1–2 is proportionally large but still clinically irrelevant — so anchor "meaningful" on the **absolute** event-rate band-crossing, not a percentage (the data-viz "gate the trend arrow when delta inside the band" approach handles this correctly; the percent-based `trendPercent` badge does not — ux §3.1 correctly flags demoting it). Endorse.

---

## 4. Cross-manufacturer guidance — correctly scoped, strengthen one point

"Never compare AHI/leak across manufacturers without a caveat (prefer to prevent)" is **clinically correct and important** (draft §9). The two named mechanisms are accurate:
- **ResMed reports unintentional leak; many Philips devices report total leak** (intentional + unintentional) — a raw leak-number comparison is meaningless without the mask vent curve. Correct.
- **Flow-only hypopnea definitions differ across manufacturers** (ResMed ~50–70% reduction; Philips Auto-Trak threshold differs) — correct, and AHI is therefore non-interchangeable (Iftikhar 2023, percentage errors 59–112%).

**Strengthen:** the guard should also cover **within-ResMed, cross-mode** comparisons that the proposals don't mention — e.g., **ASV/AirCurve devices actively suppress central events**, so a CA index from an ASV machine is not comparable to a CA index from an AutoSet APAP. And the **AirMini** uses a different (HumidX, tube) circuit model. The cross-manufacturer guard is necessary but **not sufficient**; relabel it conceptually as a "cross-*device-model/mode* comparison guard." Scope is otherwise right.

---

## 5. Device-fact errors and `[?]` figures that must not be stated as fact

These appear in the proposals and must be corrected or quarantined behind the `[?]` convention before any user-facing copy ships:

1. **FOT "~4 Hz" and "~1 cmH₂O amplitude."** The 4 Hz figure is independently corroborated (Alamdari 2022, `[M]/[P]`) and may be stated. The **~1 cmH₂O amplitude is `[?]`** (draft §11) and **must not** appear in user copy as fact. The proposals don't surface the amplitude — good — but `documentation` must keep it out of the deep-dive glossary unless verified.

2. **ResMed pressure accuracy "±0.5 cmH₂O + 4%" and "0.2 cmH₂O set resolution."** Both `[?]` (draft §2, §11). The data-science §1 table ties AHI/pressure display precision to "0.2 cmH₂O resolution `[?]`." **Do not hard-code 0.2 as the justification** in shipped logic or copy. 1-decimal pressure display is independently defensible (ISO 80601-2-70 dynamic stability + "near ground truth"); justify it that way, not via the unverified 0.2 figure. Correct the data-science table's justification column.

3. **Leak thresholds 24 / 30 / 42 L/min.** All `[?/C]` (community/red-zone, draft §6). The 42 L/min figure is **S9-era**, not AirSense 10/11 — do not present it for current devices. None may be stated as a manufacturer spec in copy; present as "the value the device flags as high leak" with provenance, and keep as named constants (§3a).

4. **Sampling rates (25 Hz flow/pressure, 0.5 Hz leak/Vt/MV/FLG).** `[C]` community-derived but reliable in practice. Fine to use in logic; label provenance in developer docs. The dataviz proposal's perf design (deriving high-leak spans from the ~0.5 Hz leak channel) correctly uses the 0.5 Hz figure — endorse.

5. **Vt/MV disclaimer thresholds (Vt < 100 mL, MV < 3 L/min).** These ARE `[M]` (ResMed clinical guide, draft §3) — correctly stated. The dataviz proposal cites them accurately. Good. One precision note: these are *accuracy-degradation* disclaimers, not "suppress below" cutoffs — the proposals treat them correctly as trend-only flags.

6. **No device-definition errors found** in the event-definition usage (apnea ≥75% reduction ≥10 s, hypopnea ~50–70% flow-only, CA = open airway via FOT, both CA+OA count toward AHI). The proposals' clinical claims trace correctly to the draft. AASM 10-second minimum is respected implicitly. Good.

---

## 6. Clinical safety — overall posture and remaining risks

The posture is correct: descriptive not diagnostic, no severity category from one night, calm `role="status"` notices (not alarms), no diagnostic language on type split/RERA, no imputation of missing data. These all align with "this tool does not diagnose" and are clinically responsible. **Endorse.**

Residual safety items, in priority order:
1. **(Highest) The CA under-reaction risk (§2).** A `low` tier must lower the *precision* claim without silencing the *trend* flag for treatment-emergent central apnea. This is the one place the humility could become *clinically harmful* if mis-worded. Required fix.
2. **Apnea-count over-trust (§1a).** Do not present apnea count as ground-truth-equivalent; it is detected, undercounts residuals, and is still leak-gated. Required fix.
3. **Leak-gate over-suppression (§3a).** Splitting notice vs suppression thresholds avoids training distrust of usable 24–30 L/min data. Required fix.
4. **"AHI 5.0" boundary copy.** When a single-night or trend value sits on the 5/15/30 boundary, the boundary-straddle annotation (ux §3.2, §4) is essential — a user must never read "AHI 5.0" as a clean category assignment. The proposals handle this; ensure it is in the first PR, not deferred.
5. **Do not let "leak-affected" or `low` chips imply the *therapy* is failing.** A high-leak night degrades *measurement*, not necessarily *treatment*. The ui-design "violet = inferred, not alarming" choice and the calm-notice rule both help; confirm copy says "this metric is less reliable tonight," never "your therapy was worse."

---

## Summary of required corrections (for the orchestrator to route)

| # | Correction | Owner |
|---|---|---|
| C1 | CA/central: `low` tier must lower precision, **not** silence the rising-trend clinical flag; add a `clinical-flag` copy tone; fire annotation on sustained trend | `ux`, `documentation`, `data-viz` |
| C2 | Apnea **count** = `moderate` (medium-high), not `high`; keep it leak-gated; never label ground-truth-equivalent | `data-science`, `ux` |
| C3 | Split the leak gate: `LEAK_NOTICE_THRESHOLD ≈24` (notice) vs higher `LEAK_METRIC_SUPPRESSION_THRESHOLD ≈30` (de-weighting); duration-weighted | `data-science`, `resmed-specialist` to confirm |
| C4 | Add hypopnea index to the large-leak gate (drops `moderate`→`low` at high leak) | `data-science` |
| C5 | Don't justify pressure display precision via unverified 0.2 cmH₂O; cite ISO 80601-2-70 / near-ground-truth instead | `data-science`, `documentation` |
| C6 | Keep all `[?]` device figures (FOT amplitude, ±0.5+4%, 24/30/42 leak, patents) out of user-facing copy as facts | `documentation` |
| C7 | Broaden cross-manufacturer guard to cross-model/mode (ASV suppresses centrals; AirMini circuit differs) | `ux`, `data-science` |

Everything else (precision formatters, trend+band as headline, surface-don't-diagnose, anti-clutter contract, WCAG non-color cues, calm notices) is clinically endorsed as written.
