# Wearable & Pulse-Oximeter Measurement Accuracy

**Part of the [Measurement Accuracy & Uncertainty](./README.md) reference series.**
**Audience:** Patients with a data-science, mathematics, or bioinformatics background (and motivated laypersons) · **Last updated:** 2026-06-15

**Related:** [CPAP/PAP device accuracy](./cpap-devices.md) · [Measurement uncertainty & statistics](./measurement-uncertainty.md) · [ADR 0018](../decisions/0018-measurement-uncertainty-reliability-display.md)

> **Scope and intent.** This document records what is _actually known_ — from manufacturer specifications and from independent, peer-reviewed validation — about the accuracy of the consumer wearables and home pulse oximeters commonly used alongside CPAP therapy. The CPAP Analyzer can import and overlay these external signals, but it **does not diagnose**. Understanding each signal's measurement uncertainty is a prerequisite for interpreting any overlay or correlation responsibly.
>
> **A note on sourcing** (see [README §4](./README.md#4-sourcing-conventions)). Throughout, **manufacturer claims** (marketing pages, spec sheets, regulatory filings) are clearly separated from **independent peer-reviewed findings**. Literature citations were retrieved from PubMed and are attributed inline with DOI links. Where the published evidence for a specific device/metric is thin or absent, that is stated explicitly rather than extrapolated.

---

## 1. How to read accuracy metrics (preamble)

Before any numbers, fix the vocabulary. Different metrics answer different questions, and conflating them is the single most common interpretation error. (For the full statistical treatment, see [measurement-uncertainty.md §5](./measurement-uncertainty.md#5-agreement-statistics-primer).)

| Metric                                         | Definition                                                                                  | What it tells you                                                                                                                                    | What it hides                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **MAE** (Mean Absolute Error)                  | Mean of \|estimate − reference\|, in the unit of the signal (e.g., bpm).                    | Typical magnitude of error, sign-agnostic.                                                                                                           | Direction of bias; outlier tail.                                            |
| **MAPE** (Mean Absolute Percentage Error)      | Mean of \|estimate − reference\| / reference × 100%.                                        | Scale-free error; lets you compare across HR ranges.                                                                                                 | Inflates at small denominators (low HR); hides absolute size.               |
| **Bias** (mean difference / Bland–Altman bias) | Mean of (estimate − reference); signed.                                                     | Systematic over- or under-estimation.                                                                                                                | Random scatter; says nothing about an individual reading.                   |
| **Limits of Agreement (LoA)**                  | Bias ± 1.96 × SD of differences.                                                            | The interval containing ~95% of individual errors.                                                                                                   | Often _wide_ even when bias ≈ 0 — the key caveat for individual nights.     |
| **A_RMS / ARMS** ("accuracy root-mean-square") | √(mean of (SpO₂ − SaO₂)²) across paired data, combining bias and precision into one number. | The regulatory accuracy metric for pulse oximeters (vs. arterial co-oximetry).                                                                       | Pools across skin tones and saturation ranges unless explicitly stratified. |
| **Sensitivity / Specificity**                  | Per-class true-positive rate / true-negative rate.                                          | How well a sleep stage (or "asleep" vs. "awake") is detected.                                                                                        | Prevalence effects; both must be read together.                             |
| **Cohen's / Fleiss' κ (kappa)**                | Agreement corrected for chance: (p₀ − pₑ)/(1 − pₑ).                                         | Class-agreement beyond chance. Rough guide: < 0.20 slight, 0.21–0.40 fair, 0.41–0.60 **moderate**, 0.61–0.80 **substantial**, > 0.80 almost perfect. | Sensitive to number of classes and class imbalance (light sleep dominates). |

**Two structural cautions that recur throughout this document:**

1. **Bias ≠ usefulness for one night.** A device can have near-zero group bias yet wide limits of agreement, meaning any _single_ reading may be off substantially. Group-level validation justifies trend-watching, not single-point clinical decisions.
2. **Healthy-cohort validation does not transfer to disordered sleep.** Most sleep-stage validations enroll healthy young adults. Sleep apnea fragments sleep architecture and HRV — the very features these algorithms rely on — so accuracy in an untreated OSA population is typically _worse_ than the published figures and is, for most devices, **unmeasured**.

---

## 2. Measurement principles in brief

| Technique                                                 | Where used                                                                                  | Principle                                                                                                                                     | Primary error sources                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Reflectance PPG (green LED ~525 nm)**                   | Wrist HR (Fitbit, Apple, Garmin), ring HR (Oura)                                            | LED illuminates skin; photodiode reads light _reflected_ from pulsatile capillary blood. Green is favored at the wrist for motion robustness. | Motion artifact, poor fit/contact, perfusion, tattoos, skin pigmentation (green is strongly absorbed by melanin).                 |
| **Reflectance pulse oximetry (red ~660 nm + IR ~940 nm)** | Wrist/ring SpO₂ (Fitbit "EOV", Apple, Garmin Pulse Ox, Oura, Whoop)                         | Ratio of red/IR absorption in pulsatile blood estimates the ratio of oxy- to deoxy-hemoglobin.                                                | All of the above **plus** the much harder optical geometry of reflectance at the wrist; melanin bias; no co-oximetry calibration. |
| **Transmissive pulse oximetry (red + IR)**                | Fingertip/ring dedicated oximeters (Wellue O2Ring, Viatom/Checkme, Masimo MightySat, Nonin) | Light passes _through_ a thin tissue bed (finger); cleaner signal than reflectance.                                                           | Motion, low perfusion, nail polish, ambient light; melanin bias persists but is smaller and better-characterized.                 |
| **Accelerometer + PPG sleep staging**                     | All consumer sleep trackers                                                                 | Movement (actigraphy) plus HR / HR-variability features fed to a proprietary classifier mapping epochs to Wake/Light/Deep/REM.                | No EEG → fundamentally inferential; HRV-based features degrade with arrhythmia, medication, and fragmented sleep.                 |
| **Derived respiratory rate**                              | Fitbit, Apple, Garmin, Oura, Whoop                                                          | Extracted from respiratory sinus arrhythmia and/or PPG amplitude/baseline modulation, typically during stable sleep.                          | Only validated in stable conditions; not a flow signal and cannot detect apneas directly.                                         |

The crucial structural point: **a wrist or ring SpO₂ uses _reflectance_ oximetry without co-oximetry calibration, whereas cleared fingertip oximeters use _transmissive_ oximetry calibrated against arterial blood.** This is the single largest reason consumer wrist SpO₂ carries a "not for medical use" disclaimer while a Nonin or Masimo fingertip device is FDA-cleared.

---

## 3. Heart rate (PPG vs. ECG)

### 3.1 What the evidence shows

PPG heart rate is the **most trustworthy** consumer-wearable metric — but only at rest. The accuracy collapses predictably with motion.

According to PubMed:

- **Postoperative inpatients, n = 201 (Apple Watch 7, Garmin Fēnix 6 Pro, Withings ScanWatch, Fitbit Sense vs. ECG).** All four devices achieved correlation r ≥ 0.95, concordance ≥ 0.94, **MAPE < 5%**, and **MAE < 5 bpm**. Helmer et al., _J Med Internet Res_ 2022. [DOI](https://doi.org/10.2196/42359) (PMID 36583938). _Independent._
- **Overnight, healthy young adults (Fitbit Charge HR vs. portable PSG-derived HR).** Mean difference **−0.66 bpm**, overall Pearson r = 0.93; agreement was **much better during sleep** (r = 0.97–0.99 across N1–N3/REM) than wakefulness (r = 0.84), and degraded sharply above 100 bpm (r = 0.37). Benedetti et al., _J Sleep Res_ 2021. [DOI](https://doi.org/10.1111/jsr.13346) (PMID 33837981). _Independent._
- **Shift workers (Fitbit Charge 2 vs. home PSG).** HR underestimated by only ~0.9 bpm on average, but state-dependent: ~0.6–0.7 bpm in N2/N3/REM vs. 1.2 bpm in N1 and **1.9 bpm in wake**, with limited ability to track sudden HR changes due to coarse time resolution. Stucky et al., _J Med Internet Res_ 2021. [DOI](https://doi.org/10.2196/26476) (PMID 34609317). _Independent._
- **Multi-condition lab + ambulatory validation of four PPG devices (incl. a research-grade Empatica) vs. ECG.** Devices "captured HR more accurately than HRV," and **any movement degraded agreement**; even the research-grade device showed low agreement in ambulatory-like conditions. Sinichi et al., _Psychophysiology_ 2025. [DOI](https://doi.org/10.1111/psyp.70004) (PMID 39905563). _Independent._

### 3.2 Heart-rate variability (HRV) and arrhythmia

HRV is **substantially less reliable than HR** from the same device, because it depends on beat-to-beat interval precision that PPG resolves poorly under any motion (Sinichi et al. 2025, [DOI](https://doi.org/10.1111/psyp.70004)). For atrial-fibrillation _screening_ (a binary classification, not HRV quantification), PPG-derived models can reach ~95% accuracy/sensitivity/specificity on curated data (Ramesh et al., _Sensors_ 2021, [DOI](https://doi.org/10.3390/s21217233)) — but that is detection of an irregular pattern, not a precise HRV measurement.

### 3.3 Interpretation for a CPAP patient

- **Trust resting/sleeping HR trends** (tier `moderate`). Nightly resting HR and its night-to-night trend are among the most defensible wearable signals to overlay on CPAP data.
- **Distrust HR during arousals and movement.** Apnea-related arousals involve motion and rapid HR change — exactly where PPG is weakest. A wearable HR spike _near_ a scored event is suggestive, not confirmatory.
- **Treat HRV numbers as relative, not absolute.** Use HRV for personal baselining over weeks, not for cross-device comparison or single-night judgments.

---

## 4. SpO₂ — consumer wrist/ring vs. dedicated oximeters

### 4.1 The regulatory line: ±2–3% A_RMS vs. "not for medical use"

For a pulse oximeter to be **FDA-cleared for medical use**, it must demonstrate accuracy against arterial co-oximetry in a controlled desaturation study. The long-standing 510(k) bar is **A_RMS ≤ 3%** (transmissive) — typical cleared fingertip devices report 2–3%. The FDA's **January 2025 draft guidance** ("Pulse Oximeters for Medical Purposes…") proposes substantially stricter expectations: **A_RMS < 3%**, tightened bias limits (< 3.5% for 70–85% SaO₂, < 1.5% for 85–100%), and crucially a **far more diverse validation cohort** — raising participant counts from ~10 toward ~150 with at least ~25% dark-skinned subjects (FDA draft guidance, comment period closed March 10 2025). ([FDA Executive Summary](https://www.fda.gov/media/175828/download); [MedTech Dive summary](https://www.medtechdive.com/news/fda-draft-guidance-pulse-oximeter-accuracy/736555/)). _Regulatory._

**Consumer wrist/ring SpO₂ is a different category entirely.** Fitbit, Apple, Garmin, Oura, and Whoop wrist/ring SpO₂ are **wellness features, explicitly not cleared medical oximeters** (tier `low`). Fitbit's own help materials state the SpO₂ feature "is intended for general wellness purposes only and should not be used or relied on for any medical purposes," and acknowledge that anatomical differences and **darker skin can cause overestimation** ([Google/Fitbit Help](https://support.google.com/fitbit/answer/14226120)). A common independent summary: _no mass-market wrist-worn SpO₂ monitor currently meets the medical standard for pulse oximeters_ ([Wareable overview](https://www.wareable.com/wearable-tech/pulse-oximeter-explained-fitbit-garmin-wearables-340)).

> **Fitbit "Estimated Oxygen Variation" (EOV) is not SpO₂.** EOV is deliberately presented as a _relative_ variability graph, not an absolute saturation percentage. It is designed to surface _large swings_ potentially associated with breathing disturbances — it is a pattern indicator, not a calibrated oxygen value ([Fitbit Community](https://community.fitbit.com/t5/Fitbit-Community-Basics/SpO2-sensor-and-Estimated-Oxygen-Variation-EOV/td-p/4273794); [Wareable](https://www.wareable.com/fitbit/fitbit-estimated-oxygen-variation-explained-7878)).

### 4.2 Dedicated overnight oximeters (the CPAP-community standard)

These are the devices a CPAP patient should rely on for actual oxygen data (tier `moderate` — cleared, but residual skin-pigment bias remains).

| Device                      | Type                                                                 | Manufacturer SpO₂ accuracy claim                         | Independent finding                                                                                                                                                                                                           | Source class               |
| --------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Wellue O2Ring / Viatom**  | Reflectance _ring_, but co-oximetry-calibrated; FDA 510(k) (K191088) | **±2% (70–100%)**, pulse ±2 bpm                          | Widely used in CPAP community; manufacturer-cited clinical validation. Independent peer-reviewed desaturation data are **limited** — treat the ±2% as a manufacturer/regulatory claim, not an independently replicated A_RMS. | Manufacturer / regulatory  |
| **Masimo MightySat Rx**     | Transmissive fingertip; FDA 510(k)                                   | ~**2% A_RMS** (no motion); Masimo SET low-perfusion tech | In a controlled hypoxemia study, MightySat reported **1.30 A_RMS** (n = 39). In an 11-device skin-pigment study it performed well but was _outperformed by the Nonin Onyx Vantage 9590_ at the darkest skin / 80–90% SpO₂.    | Manufacturer + independent |
| **Nonin Onyx Vantage 9590** | Transmissive fingertip; FDA 510(k)                                   | **±2 digits A_RMS (70–100%)**                            | **Lowest bias of 11 devices** at darkest skin pigment and 80–90% SpO₂: bias **0.8% (95% CI 0.5–1.2)**. 5 of 11 tested devices _failed_ the < 3% A_RMS FDA criterion.                                                          | Manufacturer + independent |

Independent skin-pigment device comparison: _The performance of 11 fingertip pulse oximeters during hypoxemia in healthy human participants with varied, quantified skin pigment_ ([PMC10943300](https://pmc.ncbi.nlm.nih.gov/articles/PMC10943300/); [Nonin host copy](https://www.nonin.com/resource/the-performance-of-11-fingertip-pulse-oximeters-during-hypoxemia-in-healthy-human-participants-with-varied-quantified-skin-pigment/)). The clear takeaway: **even among cleared devices, accuracy varies, and low-cost/no-name fingertip oximeters frequently fail the A_RMS bar.**

### 4.3 The skin-pigmentation bias in pulse oximetry

This is the most clinically consequential measurement-bias finding in the entire pulse-oximetry literature, and it applies — to varying and largely _uncharacterized_ degrees — to consumer wrist SpO₂ as well.

According to PubMed:

- **Foundational signal (Sjoding et al., NEJM 2020).** In paired SpO₂/SaO₂ data, **Black patients had nearly 3× the rate of occult hypoxemia** (SaO₂ < 88% despite SpO₂ 92–96%) compared with White patients. Sjoding et al., _N Engl J Med_ 2020;383(25):2477–2478. [DOI](https://doi.org/10.1056/NEJMc2029240). _Independent._ ([NEJM](https://www.nejm.org/doi/10.1056/NEJMc2029240)).
- **Pre-ECMO respiratory-failure cohort (Sjoding group).** Occult hypoxemia in 21.5% of Black vs. 10.2% of White patients with SpO₂ 92–96%; adjusted OR **2.57 (95% CI 1.12–5.92)** for Black patients. Valbuena et al., _Chest_ 2022. [DOI](https://doi.org/10.1016/j.chest.2021.09.025) (PMID 34592317). _Independent._
- **Multi-center critical-care cohort (105,467 paired readings).** Occult hypoxemia **7.9% (Black) vs. 2.9% (White)**; intra-subject error was large and _bidirectional_ in 75% of encounters — precluding a simple per-patient correction. Chesley et al., _Respir Care_ 2022. [DOI](https://doi.org/10.4187/respcare.09769) (PMID 35679133). _Independent._
- **Systematic review + meta-analysis (732,505 paired readings, 207,464 patients).** Pooled prevalence ratio of occult hypoxemia **1.67 (95% CI 1.47–1.90)** for Black vs. White patients; **1.39 (1.19–1.64)** for other racialized groups. Parr et al., _J Gen Intern Med_ 2024. [DOI](https://doi.org/10.1007/s11606-024-08852-1) (PMID 39020232). _Independent (meta-analysis)._
- **Systematic review of 42 studies.** Consistent finding: oximeters **overestimate SaO₂ in darker skin, worst at low saturations**, delaying recognition of hypoxemia. Cotton et al., _Clin Nurs Res_ 2025. [DOI](https://doi.org/10.1177/10547738251374746) (PMID 41045137). _Independent._
- **Manufacturer counter-evidence (Masimo, SET technology).** In a controlled lab desaturation study (75 self-identified Black/White volunteers), bias/precision were **−0.20 ± 1.40% (Black)** and **−0.05 ± 1.35% (White)**, with occult hypoxemia rare and absent in Black subjects. Barker & Wilson, _J Clin Monit Comput_ 2022. [DOI](https://doi.org/10.1007/s10877-022-00927-w) (PMID 36370242). _Manufacturer (authors are Masimo officers) — interpret accordingly; lab volunteers ≠ clinical patients, as the authors note._
- **Bench-test caveat.** A melanin-filter bench study could **not** conclusively isolate melanin as the in-vivo cause and emphasized that calibration/theory need further development. Swamy et al., _Med Biol Eng Comput_ 2024. [DOI](https://doi.org/10.1007/s11517-024-03091-2) (PMID 38653879). _Independent._

**Synthesis.** The bias is real, robust across large clinical cohorts, **directional (overestimation in darker skin), worst at low SpO₂, and not individually correctable** because the error magnitude varies within and between people. Well-engineered cleared devices (Masimo SET, Nonin) substantially mitigate but do not provably eliminate it. For **consumer wrist SpO₂**, the bias is at least as concerning and far less studied — the underlying physics (green/red/IR reflectance through melanin-rich skin) is the same, with _less_ calibration.

### 4.4 Interpretation for a CPAP patient

- **For real oxygen data, use a cleared transmissive oximeter** (Nonin, Masimo) or a validated reflectance ring with co-oximetry calibration (Wellue O2Ring), not a smartwatch.
- **Wrist/ring SpO₂ is a screening/trend hint at best.** A persistently low or wildly variable reading warrants a _proper_ overnight oximetry recording, not reassurance from a normal one.
- **If you have darker skin, weight the asymmetry of error.** Both consumer and even cleared oximeters are biased toward **overestimation** — a "normal" reading is less reassuring than the number suggests; a low reading is more concerning. Prefer a cleared device with published dark-skin performance (Nonin Onyx Vantage 9590 performed best in independent testing). The application surfaces this as a descriptive measurement caveat, never as race-based clinical advice.

---

## 5. Sleep-stage estimation (vs. polysomnography)

Sleep staging is the **least trustworthy headline metric** these devices produce, because they infer EEG-defined stages without EEG (tier `low` for multi-stage). Two layers matter: (a) sleep vs. wake (good), and (b) multi-stage classification (Light/Deep/REM — moderate at best).

### 5.1 Sleep vs. wake

Devices are reliably good at detecting _that_ you are asleep, and poor at detecting _wake within sleep_: high sensitivity, low specificity. According to PubMed, in chronic-insomnia patients the Fitbit Charge 4 reached **86.5% accuracy and 89.9% sensitivity but only 62.2% specificity** (i.e., it misclassifies wake as sleep) — Dong et al., _PLoS One_ 2022. [DOI](https://doi.org/10.1371/journal.pone.0275287) (PMID 36256631). The same sensitivity ≫ specificity pattern recurs across the literature.

### 5.2 Multi-stage accuracy (Light / Deep / REM)

According to PubMed:

- **Head-to-head, healthy adults, n = 35 (Oura Ring Gen3, Fitbit Sense 2, Apple Watch Series 8 vs. PSG).** Sleep-vs-wake sensitivity ≥ 95% for all. Per-stage sensitivity 50–86%: **Oura 76.0–79.5%** (precision 77.0–79.5%, _not statistically different from PSG on any stage_), **Fitbit 61.7–78.0%** (overestimated Light by ~18 min, underestimated Deep by ~15 min), **Apple 50.5–86.1%** (underestimated Deep by ~43 min, overestimated Light by ~45 min). All showed "moderate to substantial" agreement. Robbins et al., _Sensors_ 2024. [DOI](https://doi.org/10.3390/s24206532) (PMID 39460013). _Independent._
- **Systematic review (Fitbit Charge 4, Garmin Vivosmart 4, Whoop vs. PSG).** Whoop had the least disagreement for total sleep time (−1.4 min) but the **largest REM error (+21 min)**; Fitbit Charge 4 had the smallest REM error (+4 min) and the highest sensitivities to Deep (75%) and REM (86.5%); all devices "can benefit from further improvement in the assessment of specific sleep stages." Schyvens et al., _JMIR Mhealth Uhealth_ 2024. [DOI](https://doi.org/10.2196/52192) (PMID 38557808). _Independent (systematic review)._
- **Shift workers (Fitbit Charge 2 vs. PSG), epoch-by-epoch.** Specificity > sensitivity; accuracy higher for WASO (0.82) and REM (0.86) than for N1+N2 (0.55) or N3 (0.78); proprietary algorithm **overestimated REM latency by 29 min and WASO by 37 min**, and produced non-biological discontinuities — wide LoA "hamper the precision of quantifying individual sleep episodes." Stucky et al., _J Med Internet Res_ 2021. [DOI](https://doi.org/10.2196/26476) (PMID 34609317). _Independent._
- **Insomnia patients (Fitbit Charge 4 vs. PSG).** **Underestimated Deep sleep by ~41 min** and overestimated Light by ~38 min — direct evidence that staging degrades in a _disordered_ population. Dong et al., _PLoS One_ 2022. [DOI](https://doi.org/10.1371/journal.pone.0275287) (PMID 36256631). _Independent._
- **Mechanistic ceiling.** Applying an ECG-trained HRV staging algorithm directly to PPG-derived inter-beat intervals **lowered κ from 0.60 to 0.56 and accuracy from 75.9% to 73.0%** (n = 389 with sleep disorders) — quantifying the penalty of PPG (vs. ECG) as the HRV source. van Gilst et al., _BMC Res Notes_ 2020. [DOI](https://doi.org/10.1186/s13104-020-05355-0) (PMID 33168051). Optimized HRV-based staging can reach κ ≈ 0.75–0.79 in research settings (Topalidis et al., _Sensors_ 2023, [DOI](https://doi.org/10.3390/s23229077), PMID 38005466), illustrating the realistic upper bound — **substantial, not near-perfect**, agreement. _Independent._

**Cohen's κ in practice:** the better consumer/research pipelines land around **κ ≈ 0.55–0.79** for 4-class staging in research conditions — "moderate to substantial." Expect the _lower_ end (or worse) in untreated OSA, which most studies do not measure.

### 5.3 Fitbit "Sleep Profile"

Sleep Profile is a _monthly aggregate_ clustering of long-run sleep metrics into descriptive "animal" chronotypes, not an epoch-level staging product. **There is no independent peer-reviewed validation of Sleep Profile as such**; its trustworthiness inherits the underlying nightly staging accuracy documented above and should be read as a descriptive summary, not a measurement.

### 5.4 Interpretation for a CPAP patient

- **"Time asleep" is broadly usable; the stage breakdown is soft.** Use total sleep time and sleep/wake trends; treat the Deep/Light/REM pie chart as indicative, not quantitative.
- **Do not infer therapy efficacy from stage percentages.** Stage estimates carry tens-of-minutes errors per night and are worse in disordered sleep — exactly your population. A change in "deep sleep %" between nights is often within device noise.
- **Stages cannot detect apneas.** No consumer staging algorithm scores respiratory events; that is what the CPAP flow data and (optionally) a real oximeter are for.

---

## 6. Derived respiratory rate

Respiratory rate is extracted from respiratory sinus arrhythmia and PPG modulation during **stable sleep**, and is reported by Fitbit, Apple, Garmin, Oura, and Whoop. In stable conditions it tracks reasonably and is useful as a **personal nightly baseline**, but:

- It is **not a flow signal** and **cannot detect apneas or hypopneas** — a normal average respiratory rate is fully compatible with severe, untreated OSA.
- Manufacturers present it as a relative/trend metric (e.g., Whoop establishes a ~2-week personal baseline before flagging deviations; [WHOOP](https://www.whoop.com/us/en/thelocker/metric-blood-oxygen-monitoring/)).
- **Device-specific, PSG-referenced respiratory-rate accuracy figures are sparse in the peer-reviewed literature** relative to HR and staging. We therefore decline to quote a single MAE/MAPE; the honest statement is that quantitative independent validation per device is **limited**.

**Interpretation:** use respiratory rate for personal trend deviations, never as apnea detection or as a substitute for CPAP-reported events.

---

## 7. Brief comparative device summary

| Device family                                      | HR (PPG)                                          | SpO₂                                                                                        | Sleep staging                                                                                          | Notes                                                                          |
| -------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Fitbit** (Charge 5/6, Sense 1/2, Versa, Inspire) | Good at rest/sleep (MAE < 5 bpm, bias ≈ −0.7 bpm) | **EOV = relative variability, not calibrated SpO₂; wellness-only**                          | Moderate; overestimates Light, underestimates Deep; insomnia data worse                                | Most-validated consumer ecosystem; staging algorithm is proprietary/opaque     |
| **Apple Watch**                                    | Excellent at rest (MAE < 5 bpm)                   | Wellness Blood Oxygen app; not a cleared oximeter (and subject to US sales/feature changes) | Wide per-stage range (50–86% sensitivity); large Deep/Light errors                                     | Strong HR; staging variable                                                    |
| **Garmin**                                         | Good at rest                                      | Pulse Ox, wellness-grade; biased at altitude and at SpO₂ < 95%                              | Moderate (Vivosmart 4 in reviews)                                                                      | Pulse Ox samples ~1/min overnight                                              |
| **Oura Ring** (Gen3/4)                             | Good (ring PPG)                                   | Reports _Average Blood Oxygen_ + breathing regularity, wellness-only                        | **Best consumer staging in head-to-head** (not stat-different from PSG on any stage in healthy adults) | Ring form factor; still not medical-grade                                      |
| **Whoop**                                          | Good                                              | Wellness-only, baseline-relative                                                            | Good TST; **largest REM error** in review                                                              | Subscription, baseline-driven                                                  |
| **Wellue O2Ring / Viatom**                         | ±2 bpm (claim)                                    | **±2% (claim), 510(k)-cleared**                                                             | N/A (oximeter, not stager)                                                                             | Community standard for overnight O₂; limited _independent_ peer-reviewed A_RMS |
| **Masimo MightySat**                               | Cleared                                           | **~1.3–2% A_RMS**, 510(k)                                                                   | N/A                                                                                                    | Cleared; strong but bested by Nonin at darkest skin / low SpO₂                 |
| **Nonin Onyx Vantage 9590**                        | Cleared                                           | **±2 digits A_RMS**, lowest dark-skin bias (0.8%)                                           | N/A                                                                                                    | Best independent dark-skin performance among 11 devices                        |

---

## 8. Summary: metrics ranked by trustworthiness

From **most** to **least** defensible for a CPAP patient overlaying external signals:

1. **Cleared fingertip/ring SpO₂ (transmissive: Nonin, Masimo; calibrated ring: Wellue O2Ring)** — ≤ 2–3% A*RMS, FDA-cleared; the only oxygen data suitable for anything beyond casual trend-watching. \_Caveat: residual skin-pigment bias remains, smallest for Nonin in independent testing.*
2. **Resting / sleeping heart rate (PPG)** — MAE < 5 bpm, bias near zero at rest; the strongest consumer-wearable signal. _Caveat: degrades with motion and above ~100 bpm._
3. **Total sleep time / sleep-vs-wake** — high sensitivity; useful trend. _Caveat: poor wake specificity (overestimates sleep)._
4. **Respiratory rate (consumer)** — reasonable personal baseline in stable sleep. _Caveat: thin per-device validation; cannot detect apneas._
5. **Multi-stage sleep (Light/Deep/REM)** — moderate-to-substantial only (κ ≈ 0.55–0.79 in research conditions; worse in disordered sleep); tens-of-minutes per-stage error. Tier `low`.
6. **HRV (consumer PPG)** — relative baselining only; unreliable for absolute values or any motion.
7. **Consumer wrist/ring SpO₂ (Fitbit EOV, Apple/Garmin/Oura/Whoop)** — **least trustworthy as an oxygen number**: reflectance, uncalibrated, wellness-only, and subject to skin-pigment overestimation that is real but largely unquantified at the wrist. Tier `low`.

---

## 9. Cross-cutting interpretation guidance for the CPAP Analyzer

- **Label provenance in the UI.** Any imported wearable signal should carry its accuracy class (cleared oximeter vs. wellness wrist SpO₂ vs. inferred sleep stage) so correlations are read with the right skepticism.
- **Prefer trends over single points.** Group-level validation supports trend overlays, not single-night clinical inference.
- **Never let a wearable override the flow data.** CPAP-reported respiratory events are the primary signal; wearables are context, not arbiters.
- **Surface the skin-pigment caveat for SpO₂.** Given directional overestimation, a "normal" consumer SpO₂ should never be presented as reassurance, particularly for darker-skinned users — framed descriptively and cited.
- **Confirm clinical thresholds with the `resmed-specialist`** before encoding any rule that combines wearable SpO₂ with CPAP events.

---

## Appendix: Key citations

**Peer-reviewed (via PubMed; DOI links per PubMed attribution requirement):**

- Helmer P, et al. Accuracy and systematic biases of HR by consumer fitness trackers in postoperative patients. _J Med Internet Res_ 2022. [DOI](https://doi.org/10.2196/42359) — PMID 36583938.
- Benedetti D, et al. HR detection by Fitbit Charge HR vs. portable PSG. _J Sleep Res_ 2021. [DOI](https://doi.org/10.1111/jsr.13346) — PMID 33837981.
- Stucky B, et al. Validation of Fitbit Charge 2 sleep & HR in shift workers. _J Med Internet Res_ 2021. [DOI](https://doi.org/10.2196/26476) — PMID 34609317.
- Sinichi M, et al. Accuracy of four HR wearables (PPG) vs. ECG. _Psychophysiology_ 2025. [DOI](https://doi.org/10.1111/psyp.70004) — PMID 39905563.
- Ramesh J, et al. AF classification from PPG/ECG HRV. _Sensors_ 2021. [DOI](https://doi.org/10.3390/s21217233) — PMID 34770543.
- Robbins R, et al. Oura Gen3 / Fitbit Sense 2 / Apple Watch 8 vs. PSG. _Sensors_ 2024. [DOI](https://doi.org/10.3390/s24206532) — PMID 39460013.
- Schyvens AM, et al. Fitbit Charge 4 / Garmin Vivosmart 4 / Whoop vs. PSG (systematic review). _JMIR Mhealth Uhealth_ 2024. [DOI](https://doi.org/10.2196/52192) — PMID 38557808.
- Dong X, et al. Fitbit Charge 4 in chronic insomnia vs. PSG/actigraphy. _PLoS One_ 2022. [DOI](https://doi.org/10.1371/journal.pone.0275287) — PMID 36256631.
- van Gilst MM, et al. ECG-trained staging algorithm applied to PPG IBIs. _BMC Res Notes_ 2020. [DOI](https://doi.org/10.1186/s13104-020-05355-0) — PMID 33168051.
- Topalidis PI, et al. Optimized HRV-based sleep classification. _Sensors_ 2023. [DOI](https://doi.org/10.3390/s23229077) — PMID 38005466.
- Sjoding MW, et al. Racial bias in pulse oximetry measurement. _N Engl J Med_ 2020;383:2477–2478. [DOI](https://doi.org/10.1056/NEJMc2029240).
- Valbuena VSM, et al. Racial bias in pulse oximetry pre-ECMO. _Chest_ 2022. [DOI](https://doi.org/10.1016/j.chest.2021.09.025) — PMID 34592317.
- Chesley CF, et al. Racial disparities in occult hypoxemia. _Respir Care_ 2022. [DOI](https://doi.org/10.4187/respcare.09769) — PMID 35679133.
- Parr NJ, et al. Occult hypoxemia disparities (systematic review/meta-analysis). _J Gen Intern Med_ 2024. [DOI](https://doi.org/10.1007/s11606-024-08852-1) — PMID 39020232.
- Cotton SA, et al. Skin pigmentation & pulse-oximetry accuracy (systematic review of 42 studies). _Clin Nurs Res_ 2025. [DOI](https://doi.org/10.1177/10547738251374746) — PMID 41045137.
- Barker SJ, Wilson WC. Racial effects on Masimo pulse oximetry (lab study; _authors are Masimo officers_). _J Clin Monit Comput_ 2022. [DOI](https://doi.org/10.1007/s10877-022-00927-w) — PMID 36370242.
- Swamy SKN, et al. Pulse-oximeter bench tests under simulated skin tones. _Med Biol Eng Comput_ 2024. [DOI](https://doi.org/10.1007/s11517-024-03091-2) — PMID 38653879.

**Manufacturer / regulatory / secondary (web):**

- FDA draft guidance, _Pulse Oximeters for Medical Purposes_ (Jan 2025): [FDA Executive Summary](https://www.fda.gov/media/175828/download); [MedTech Dive](https://www.medtechdive.com/news/fda-draft-guidance-pulse-oximeter-accuracy/736555/).
- Independent 11-device skin-pigment oximeter comparison: [PMC10943300](https://pmc.ncbi.nlm.nih.gov/articles/PMC10943300/).
- Fitbit SpO₂/EOV help & disclaimers: [Google/Fitbit Help](https://support.google.com/fitbit/answer/14226120); [Fitbit Community EOV](https://community.fitbit.com/t5/Fitbit-Community-Basics/SpO2-sensor-and-Estimated-Oxygen-Variation-EOV/td-p/4273794).
- Oura SpO₂ feature docs: [Oura Pulse Blog](https://ouraring.com/blog/blood-oxygen-sensing-spo2/).
- Whoop blood-oxygen/baseline docs: [WHOOP](https://www.whoop.com/us/en/thelocker/metric-blood-oxygen-monitoring/).
- Wellue O2Ring spec/FAQ: [Wellue FAQ](https://getwellue.com/pages/faqs-o2ring).
- General consumer-SpO₂ context: [Wareable](https://www.wareable.com/wearable-tech/pulse-oximeter-explained-fitbit-garmin-wearables-340).

> **Disclaimer.** This document is for informational and engineering-design purposes within the CPAP Analyzer project. It does not constitute medical advice and the CPAP Analyzer does not diagnose. Manufacturer claims and independent findings are distinguished above; where evidence is limited, that limitation is stated rather than filled with estimates.
