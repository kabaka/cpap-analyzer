# Measurement Accuracy of CPAP/PAP Machine Data

**Part of the [Measurement Accuracy & Uncertainty](./README.md) reference series.**
**Audience:** Technically sophisticated patients (data science / mathematics / bioinformatics) and the CPAP Analyzer engineering team · **Last updated:** 2026-06-15

**Related:** [Wearable & oximeter accuracy](./wearables.md) · [Measurement uncertainty & statistics](./measurement-uncertainty.md) · [ADR 0018](../decisions/0018-measurement-uncertainty-reliability-display.md)

> **Scope.** This document characterises, for each measurement a positive-airway-pressure (PAP) device reports: (1) _how it is physically sensed or algorithmically derived_; (2) its _quantitative accuracy_ (manufacturer claims vs. independent peer-reviewed validation); (3) how _error stacks and propagates_ into derived metrics; and (4) _how the numbers should and should not be interpreted_ when displayed. It covers current devices (ResMed AirSense 10/11, AirCurve 10/11, AirMini; Philips DreamStation 2) and aging devices still in widespread use (Philips DreamStation 1, System One/REMstar; Fisher & Paykel SleepStyle/Icon).
>
> **This tool does not diagnose.** All figures below describe instrument behaviour, not clinical recommendations.

> **Source-quality convention** (see [README §4](./README.md#4-sourcing-conventions)). Every quantitative claim is tagged **[M]** manufacturer · **[P]** peer-reviewed independent · **[C]** community reverse-engineering · **[?]** widely cited but unconfirmed against a primary source this pass (provisional; never stated as fact in logic or copy). PubMed-derived citations are attributed with DOI/PMID per PubMed's terms.

---

## 1. The fundamental constraint: a PAP device is a 1–2 channel flow instrument, not a polysomnograph

A clinical polysomnogram (PSG) scores respiratory events from **multiple independent signals**: oronasal airflow (thermistor + nasal pressure), thoracic and abdominal **respiratory effort** (respiratory inductance plethysmography, RIP), **pulse oximetry (SpO₂)**, and **EEG/EOG/EMG** for sleep staging and arousal detection. The AASM scoring rules are built on these.

A PAP device sees essentially **one signal in real time — the flow and pressure at the blower outlet** — from which everything else is _derived_. It has:

- **No respiratory-effort sensor.** Central vs. obstructive classification cannot be done the PSG way (effort present vs. absent). The device instead infers airway _patency_ by an active probing method (forced oscillation / pressure-pulse — §4).
- **No oximeter** (unless an optional accessory is attached, e.g. ResMed's pulse-oximetry module). Therefore device hypopneas are **flow-reduction-only**; there is no desaturation criterion and no 3%/4% choice (§3, §5).
- **No EEG.** There is no true arousal detection, so device "RERA"/flow-limitation reporting is a _surrogate_, not the PSG-scored RERA (§5).
- **No sleep/wake discrimination.** The device denominator is **hours of use (mask-on time)**, not **hours of sleep**. PSG AHI is per hour of _sleep_. This denominator mismatch alone biases the device index downward whenever the patient is awake with the mask on (a systematic, often-overlooked error source).

This single architectural fact explains most of the systematic differences documented below. The device's strongest numbers are the ones it _measures directly_ (pressure, and to a lesser extent flow/leak); its weakest are the ones requiring physiological inference it lacks the sensors for (central/obstructive split, RERA, flow-limitation %).

---

## 2. Pressure (delivered / measured mask pressure)

### How it is measured

PAP devices contain an internal pressure transducer in the flow path; mask pressure is estimated from the measured device-outlet pressure corrected for the modeled pressure drop along the tube and (in some modes) the flow. Closed-loop motor control regulates the blower (a high-speed centrifugal impeller) to hold the target pressure. This is the **most direct, least-modeled** quantity a PAP device produces — it is regulating to a setpoint it also measures.

### Quantitative accuracy

| Device family                            | Pressure range               | Stated accuracy                                                                                                                                                                         | Source                                                       |
| ---------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| ResMed AirSense 10 / 11 (CPAP/APAP)      | 4–20 cmH₂O                   | Single ± tolerance **not published** in the consumer clinical guide; guide states accuracy is degraded by leak, supplemental O₂, tidal volume < 100 mL, or minute ventilation < 3 L/min | **[M]** ResMed AirSense 10 Clinical Guide                    |
| ResMed AirCurve 10/11 (bilevel/ASV)      | ~3/4–25 cmH₂O (IPAP max 25)  | Same framing                                                                                                                                                                            | **[M]** ResMed AirCurve Clinical Guide                       |
| ResMed AirMini                           | 4–20 cmH₂O                   | Same framing                                                                                                                                                                            | **[M]** ResMed AirMini docs                                  |
| ResMed 10-series (service-manual figure) | —                            | **±0.5 cmH₂O + 4% of set pressure** is widely cited but **unconfirmed** against a primary ResMed document this pass — **do not treat as fact**                                          | **[?]** community/service-manual figure                      |
| Philips DreamStation 1 / 2, System One   | 4–20 cmH₂O                   | Conforms to **ISO 80601-2-70** dynamic-pressure-stability limits; exact ± figure not extracted from a primary spec this pass                                                            | **[M]/[?]** DreamStation 2 user manual / technical reference |
| Fisher & Paykel SleepStyle               | 4–20 cmH₂O (0.5 cmH₂O steps) | ± figure not located                                                                                                                                                                    | **[M]** F&P SleepStyle spec sheet                            |

All current devices are regulated to the **ISO 80601-2-70** standard for sleep-apnoea breathing-therapy equipment, which constrains dynamic pressure stability. A realistic engineering interpretation is that **set-point pressure is accurate to roughly ±0.5 cmH₂O plus a few percent under normal conditions**, degrading with leak and high flow — but the specific ResMed ±-figure remains **[?]** and is not asserted as a manufacturer spec.

### Error propagation & interpretation

- Pressure is **near ground truth**. It is the one channel where 95th-percentile pressure, median pressure, and pressure-vs-time are trustworthy for fine night-to-night comparison.
- The caveat: **reported pressure is mask-referenced via a tube model.** Heated-tube vs. standard-tube, tube length, and altitude affect the correction. Within a single device/tube configuration the relative accuracy is excellent.
- **Display guidance.** Pressure is the safest metric to show with precision. The application displays pressure statistics to **one decimal place in cmH₂O**, justified by the **ISO 80601-2-70 dynamic-stability requirement and pressure's near-ground-truth status — not** by the commonly-cited but unverified "0.2 cmH₂O resolution" figure (which is **[?]** and is deliberately _not_ used as the rationale; see [measurement-uncertainty.md §6.1](./measurement-uncertainty.md#61-significant-figures-should-reflect-uncertainty-not-floating-point)).

---

## 3. Flow rate, tidal volume, minute ventilation, respiratory rate

### How they are measured / derived

PAP devices do **not** use a clinical pneumotachograph. Flow is derived from a **pressure-based flow estimate combined with blower/motor characterisation**: the device knows the blower's pressure–flow–speed map and the modeled vent (intentional leak) flow, and solves for **patient flow = total flow − vent flow − circuit dynamics** **[M]/[C]**. From the reconstructed patient-flow waveform it integrates per breath to estimate **tidal volume (Vt)**, and combines with breath timing for **minute ventilation (MV)** and **respiratory rate (RR)**. Inspiratory/expiratory time come from zero-crossing detection on the flow signal.

### Sampling rates (stored data)

| Channel                       | Typical stored rate  | Source                      |
| ----------------------------- | -------------------- | --------------------------- |
| Flow rate (ResMed BRP)        | **25 Hz**            | **[C]** OSCAR / Apnea Board |
| Mask pressure                 | **25 Hz**            | **[C]**                     |
| Leak (unintentional)          | ~0.5 Hz (every 2 s)  | **[C]**                     |
| RR, Vt, MV                    | ~0.5 Hz              | **[C]**                     |
| Snore / flow-limitation index | ~0.5 Hz              | **[C]**                     |
| Events                        | per-event timestamps | **[C]**                     |

All sampling-rate figures are **community reverse-engineering** (OSCAR is widely cross-validated and reliable in practice) and are **not manufacturer-published**. They are acceptable for use in application logic with provenance labelled in developer docs. ResMed clinical guides explicitly warn that derived measurements lose accuracy at **Vt < 100 mL or MV < 3 L/min** **[M]** — these are _accuracy-degradation_ disclaimers, not "suppress below" cutoffs.

### Accuracy & propagation

- The **raw flow waveform shape** is generally faithful and is the substrate for _all_ event detection — but it is a **derived, leak-corrected estimate**, not a metered flow. Its fidelity is the single biggest determinant of every downstream metric.
- **Vt, MV, RR are second-order derivations** (integration + breath segmentation of the flow estimate). They inherit flow error and add integration/segmentation error. They are useful for _trends and waveform inspection_ but should **not** be presented as calibrated spirometry. ResMed itself disclaims accuracy at low Vt/MV **[M]**.
- **Leak is the dominant corruptor** (§6): once unintentional leak is significant, the vent-subtraction model breaks down and Vt/MV become unreliable. Independent work confirms leak degrades device-derived event accuracy (Ni & Thomas 2022, §8).

**Display guidance.** Show flow waveforms for inspection; present Vt/MV/RR as **trend indicators** carrying a `moderate` reliability tier, suppressed or flagged during high-leak periods (the suppression gate, §6).

---

## 4. Central vs. obstructive classification — the Forced Oscillation Technique (FOT) and the pressure-pulse test

This is the **most technically interesting and most heavily modeled** classification a PAP device performs, and the one users most often over-trust. Because the device has no effort belts, it cannot use the PSG definition (central = no respiratory effort). Instead it actively **probes upper-airway patency** during a detected apnoea.

### 4.1 The physical principle

During an apnoea (airflow already near zero), the device superimposes a small pressure perturbation and measures the **flow response**:

- **Open ("clear") airway →** the perturbation drives measurable oscillatory flow → **low respiratory impedance** → labelled **Clear Airway Apnea (CA)** ≈ central.
- **Collapsed airway →** the same perturbation produces little/no flow → **high impedance** → labelled **Obstructive Apnea (OA)**.

The physiological validity of using forced-oscillation impedance to read pharyngeal patency is well established in the peer-reviewed literature: Navajas et al. showed respiratory impedance can be recovered from the pressure/flow at the CPAP device itself, reaching very high values (> 60 cmH₂O·s·L⁻¹ at 5–10 Hz) during total occlusion (Eur Respir J 2000); Vanderveken et al. demonstrated FOT detects complete pharyngeal occlusion during obstructive apnoea (ORL 2005); Reisch et al. modeled the impedance phase angle as an early occlusion index (Biol Cybern 1999). See References.

### 4.2 ResMed's implementation (continuous-style FOT)

ResMed's AutoSet family superimposes a **low-frequency forced oscillation (≈ 4 Hz)** of small amplitude and computes the impedance response to decide patency **[M]/[P]**. The **4 Hz** figure is corroborated independently: Alamdari et al. (IEEE TBME 2022) state explicitly that commercial PAP machines use **low-frequency (< 8 Hz, specifically ~4 Hz) oscillometry applied intermittently after a breathing pause** to distinguish airway patency, and that breathing noise is why PAP machines use it only intermittently rather than continuously (DOI in References). The oscillation **amplitude** is sometimes quoted as "~1 cmH₂O peak-to-peak", but that figure is **[?]** — unconfirmed against a primary source — and is **not stated as fact** here or in user-facing copy.

**Signal chain (ResMed):**

1. Apnoea detected (≥ 10 s, flow ≤ ~25% of recent baseline — §5).
2. ~4 Hz, low-amplitude pressure oscillation superimposed on mask pressure.
3. Flow and pressure response measured at the oscillation frequency → respiratory impedance estimate at the mask.
4. Patency decision: high impedance → Obstructive; low impedance → Clear Airway.
5. Event tagged CA or OA; **both count toward AHI**.

ResMed holds patents covering airway-patency determination by forced oscillation during PAP; **specific patent numbers were not confirmed** in this pass **[?]** and should be added only when verified on a primary patent database.

### 4.3 Philips' implementation (discrete pressure-pulse test)

Philips' **Digital Auto-Trak** uses an analogous but typically **discrete** approach: during an apnoea it delivers one or more **test pressure pulses** and assesses the resulting flow. "The airway is determined to be clear if the pressure test pulse generates a significant amount of flow," classifying the event as **Clear Airway** vs. **Obstructive** **[M]** (Philips device documentation / DreamMapper FAQ). Mechanistically this is the single-pulse limit of the same impedance-probing idea ResMed implements as a continuous oscillation.

### 4.4 Why the central/obstructive split is the least reliable headline number

- **Physiological confound (intrinsic to the method, not the brand):** _some central apneas occur with a closed airway_ — the pharynx can collapse passively in the absence of respiratory drive. A patency-only probe will then read "closed" and **misclassify a central event as obstructive**. Vanderveken et al. explicitly observed central apnoea associated with pharyngeal closure (ORL 2005). This is a documented, fundamental limitation of any patency-based classifier, and it implies the **true central burden may be _higher_ than the device shows.**
- **Leak sensitivity:** the oscillation/pulse flow response is corrupted by unintentional leak; above threshold, the patency discrimination degrades (§6).
- **No external validation of the on-device CA/OA split against simultaneous PSG with effort belts** was found for the AS10/AS11 specifically; the strongest validation evidence concerns the _aggregate_ residual AHI, not the split (§8).
- **Treatment-emergent central apnea** ("complex sleep apnea") is real and clinically important. A rising on-device Clear-Airway index is a legitimate _flag to seek clinical evaluation_ — but the on-device classification is **not a substitute for attended PSG**.

**Display guidance — the safety asymmetry.** Present the central/obstructive split with strong epistemic humility: it is a _modeled inference from an active probe_, leak-sensitive, and subject to a known misclassification mode (tier **`low`**). **However, a `low` tier must lower the _precision_ claim, not silence the _trend_.** Because under-classification means the true central burden may be higher than displayed, a sustained, multi-night rise in the Clear-Airway index must still surface a visible **"discuss with your clinician"** prompt — in a dedicated clinical-flag tone, distinct from the reliability chip, and _never_ suppressed merely because the split is `low` reliability. Under-reaction to treatment-emergent central apnea is the dangerous failure mode. The application also distinguishes two claims that are often conflated: _"this individual event's type is uncertain"_ (true — ICC ≈ 0.16, §8) versus _"the CA trend is uninformative"_ (false — a sustained rise is exactly the signal worth raising).

RERA and flow-limitation carry no comparable safety asymmetry; `low` + "surrogate, not a PSG RERA" is fully adequate framing there.

---

## 5. Event definitions as the devices implement them (and why they ≠ AASM)

| Event                      | ResMed (AutoSet)                                            | Philips (Auto-Trak)                                         | AASM PSG reference                                                              | Source      |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------- |
| **Apnea**                  | Flow ≤ ~25% of baseline (≥ 75% reduction) for ≥ 10 s        | ≥ ~80% flow reduction for ≥ 10 s                            | ≥ 90% airflow reduction ≥ 10 s                                                  | **[M]**     |
| **Hypopnea**               | Flow reduced to ~50–70% of baseline ≥ 10 s — **flow-only**  | Flow reduction (Auto-Trak threshold) ≥ 10 s — **flow-only** | ≥ 30% flow reduction ≥ 10 s **plus** ≥ 3% (or ≥ 4%) desaturation **or** arousal | **[M]/[P]** |
| **Clear Airway / Central** | Apnea + open airway (FOT, §4)                               | Apnea + clear airway (pressure pulse, §4)                   | Apnea + absent respiratory effort (RIP)                                         | **[M]**     |
| **Flow limitation**        | Inspiratory-flow **flattening index** (proprietary)         | Flow-contour analysis                                       | (Not a standalone AASM index)                                                   | **[M]**     |
| **RERA / arousal**         | **No EEG → no true RERA**; flow limitation is the surrogate | No true RERA                                                | EEG arousal terminating ≥ 10 s of increasing effort/flow limitation             | **[M]/[P]** |
| **Snore**                  | High-frequency pressure/flow oscillation band               | Vibratory snore detection                                   | (Acoustic, separate)                                                            | **[M]**     |
| **Periodic breathing**     | Reported on some devices                                    | Reported                                                    | Cheyne–Stokes pattern on PSG                                                    | **[M]**     |

### The two structural reasons device AHI ≠ PSG AHI

1. **Hypopnea definition.** Device hypopneas are **flow-reduction-only** — _no desaturation and no arousal criterion_ (no oximeter, no EEG). The AASM offers two PSG rules (the "3% desat or arousal" recommended rule vs. the "4% desat" rule); switching between them alone changes scored AHI substantially in the population. A flow-only device rule is yet a third, non-equivalent definition. **There is no fixed conversion factor between device AHI and PSG AHI.**
2. **Denominator.** Device index = events ÷ **hours of mask-on use**; PSG AHI = events ÷ **hours of sleep**. Mask-on-but-awake time dilutes the device index downward.

The meta-analysis by Iftikhar et al. (Sleep Breath 2023) found, across studies, **lack of uniformity in both the manufacturers' event-scoring criteria and the PSG criteria** — a core reason device and PSG indices are not interchangeable (§8).

### A note on the apnea _count_ tier

The application tiers the **apnea count/index** as **`moderate`, not `high`** — and gates it on leak. Although the device's apnea _detection_ is a robust, gross flow-drop rule, the _count_ is still (i) derived from a leak-corrected flow _estimate_, not directly sensed like pressure; (ii) prone to **undercount** residual events relative to careful manual scoring (Reiter 2016, §8); and (iii) divided by mask-on (not sleep) time and subject to Poisson sampling noise. It may render _silently_ by default for anti-clutter reasons, but it is **never labelled ground-truth-equivalent.**

---

## 6. Leak — and how it poisons everything downstream

### How leak is modeled

PAP masks have a deliberate **intentional vent** (continuous wash-out of CO₂). The device must distinguish this designed flow from **unintentional leak** (mouth leak, poor seal). It models the intentional vent flow as a function of **mask type (vent characteristic curve) and instantaneous mask pressure**, subtracts it, and reports the remainder.

- **ResMed reports UNINTENTIONAL leak** (total measured leak − modeled vent flow), in L/min **[M]/[C]**.
- **Many Philips devices report TOTAL leak** (intentional + unintentional combined) via Encore **[M]** — so a "leak" number from a Philips device is **not comparable** to a ResMed "leak" number without knowing the mask's vent curve. This is a critical cross-device pitfall for any analyzer.

### The split leak gate (device conventions, not AASM standards)

The application uses **two distinct leak thresholds for two distinct purposes.** Both are **device-reporting conventions, cited as such — not AASM standards** — and both are **[?/C]** community/red-zone figures held behind named constants pending `resmed-specialist` verification; neither is asserted as a manufacturer spec.

| Threshold                   | Value        | Purpose                                                                                                                                                                                                                                     |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Leak notice**             | **24 L/min** | Drives a user-facing **data-quality notice** ("high leak tonight"), aligned with ResMed's own red-zone indicator so it is consistent with what the user already sees in myAir/clinical software.                                            |
| **Flow-metric suppression** | **30 L/min** | Threshold above which **flow-derived metrics (Vt, MV, RR, flow-limitation, and the central/obstructive split) are actually flagged/suppressed** — i.e. roughly where the vent-subtraction model and the FOT/pulse patency probe break down. |

The two are kept separate deliberately: gating _suppression_ at 24 would **over-suppress** metrics that are still usable in the 24–30 L/min band, training users to distrust data that is actually fine — the same anti-pattern the quiet-by-default posture avoids. The gate is **graduated, not a hard cliff**, and is evaluated on **duration-weighted leak across the night** (a meaningful fraction of the night, not a single transient spike).

**Mask dependence.** These thresholds are not universal physiological constants; the leak level at which flow metrics degrade depends on the **mask vent design**. For example, an **oronasal (full-face) mask** is often cited with a higher effective large-leak boundary (on the order of **~36 L/min**) than a nasal mask. The historical **42 L/min** figure (≈ 0.7 L/s) belongs to the **S9 era and must not be presented for current AirSense 10/11 devices** **[?]**.

### Error propagation

Leak is the master corruptor because every derived quantity flows from the leak-corrected flow estimate:

- Above threshold, **Vt/MV** are mis-estimated (vent-subtraction model breaks down).
- **Event detection** degrades — baseline-flow estimation drifts, so apnea/hypopnea thresholds shift; **hypopnea** (already flow-only and threshold-sensitive) drops from `moderate` to `low` under large leak.
- **FOT/pressure-pulse patency** (§4) is corrupted, degrading the central/obstructive split.
- **APAP pressure response** may stop reacting to flow limitation during large-leak periods.

The robust **aggregate apnea/AHI count** is far more tolerant of moderate leak than Vt is, so the gate is **graded**: large leak downgrades Vt/MV/flow-limitation/the CA-OA split strongly, but downgrades the aggregate apnea/AHI only one step and only above the higher (suppression) leak level — it does not slap "low reliability" on a usable aggregate AHI in the moderate-leak band.

Independent confirmation: **Ni & Thomas 2022** found **large leak (≥ 1.5% of the night) associated with a larger machine-vs-manual event discrepancy** (§8). Leak is not just its own metric — it is a **data-quality gate** on the trustworthiness of the whole night.

**Display guidance.** Treat leak as a first-class data-quality indicator. Show it without a confidence band (it is a noisy percentile-summarised signal, not a CI'd estimate). Flag/segment high-leak periods and visibly down-weight (or annotate) derived metrics during them. Never compare a ResMed unintentional-leak number to a Philips total-leak number, and never present "leak-affected" as evidence the _therapy_ failed — a high-leak night degrades _measurement_, not necessarily _treatment_.

---

## 7. AHI as a statistic: Poisson sampling error, short sessions, and night-to-night biology

Even with perfect detection, **AHI is a rate** (events per hour) estimated from a finite observation window. The full statistical treatment is in [measurement-uncertainty.md §3–§4](./measurement-uncertainty.md#3-sampling-and-counting-uncertainty-ahi-as-a-poisson-process); the essentials:

- **Counting (Poisson) noise within a night.** If events arrive roughly as a Poisson process at rate λ over T hours, the standard error of the estimated rate ≈ √(λ/T). A short session (a 2-hour nap) gives a far noisier AHI than an 8-hour night, and reporting AHI to two decimals implies a precision the statistic does not have. Because real events **over-disperse** (they cluster in REM and supine periods), the Poisson interval is a **lower bound** on the true per-night uncertainty.
- **Night-to-night biology usually dominates.** Punjabi et al. (Chest 2020), across 10,340 adults tested 3 consecutive nights, found ~20% of mild/moderate patients misclassified in severity from any single night despite strong correlation (r = 0.87–0.89). Sforza et al. (Front Physiol 2019) and Fietze et al. (Eur Respir J 2004) corroborate large internight variability, worst in mild OSA.

**Implication for the app.** The dominant source of "why is my AHI different tonight?" is usually **real biology** (position, sleep stage, alcohol, congestion), compounded by **rate sampling error**, _before_ any device-detection error. A single-night AHI change of **0.5 — or even 1–2 — is generally not meaningful.** Trends over weeks (rolling medians, distributions) are far more informative than night-to-night deltas.

---

## 8. Quantitative validation: device-reported AHI vs. PSG-scored AHI

According to PubMed, the strongest independent evidence is:

| Study                                                              | Device(s)                            | n   | Headline accuracy result                                                                                                                                                                                                            | Citation                                                            |
| ------------------------------------------------------------------ | ------------------------------------ | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Iftikhar et al., Sleep Breath 2023** (meta-analysis, 13 studies) | ResMed (6), Respironics (6), F&P (1) | —   | Pooled mean AHI bias: **ResMed −1.01** (LoA −3.55 to +1.54); **Respironics −0.59** (LoA −3.22 to +2.05). But **pooled percentage errors 73% (ResMed), 59% (Respironics), 112% (F&P)** → small mean bias **masks large imprecision** | [DOI](https://doi.org/10.1007/s11325-023-02780-w) (PMID 36715836)   |
| **Ni & Thomas, JCSM 2022** (longitudinal)                          | Philips (EncoreAnywhere)             | 179 | Machine-detected vs manual REI differed by **10.72 ± 8.43 events/h** at month 1, **stable to 12 months**; worse with male sex, large leak ≥ 1.5%, unstable breathing                                                                | [DOI](https://doi.org/10.5664/jcsm.9814) (PMID 34886948)            |
| **Reiter et al., JCSM 2016**                                       | CPAP (waveform vs auto)              | 217 | Auto scoring **undercounts** residual events: auto AHI_flow **4.4 ± 3.8** vs manual **7.3 ± 5.1**; high baseline central apnea index predicts missed residual events                                                                | [DOI](https://doi.org/10.5664/jcsm.6056) (PMID 27166303)            |
| **Nigro et al., Sleep Breath 2014**                                | ResMed S9 AutoSet                    | 114 | Mean AHI*auto − RDI = **−3.5 ± 3.9**; ICC for classifying \_types*: **central 0.69, obstructive 0.16, hypopneas 0.15**; sensitivity/specificity for residual OSA 84%/82%                                                            | [DOI](https://doi.org/10.1007/s11325-014-1048-z) (PMID 25115886)    |
| **Cilli et al., Sleep Breath 2012**                                | auto-CPAP                            | 137 | Bland–Altman: **bias 0.05, LoA −4.8 to +4.9** (selected population excluding central apnea/comorbidity)                                                                                                                             | [DOI](https://doi.org/10.1007/s11325-012-0670-x) (PMID 22371206)    |
| **Desai et al., Sleep Breath 2009**                                | auto-CPAP smart card                 | 99  | Good Bland–Altman agreement; auto-AHI cutoff ~6/h to flag residual OSA, sensitivity 0.92 / specificity 0.90                                                                                                                         | [DOI](https://doi.org/10.1007/s11325-009-0258-2) (PMID 19408029)    |
| **Brajer-Luftmann et al., Life 2022**                              | auto-CPAP                            | 100 | No significant AHI difference vs polygraph; accuracy ~3.94/h; AUC 0.633, sensitivity/specificity at cutpoint 55%/82%                                                                                                                | [DOI](https://doi.org/10.3390/life12091357) (PMID 36143393)         |
| **Agrawal et al., PLoS One 2017** (real-world)                     | PAP smart card                       | 280 | Same AHI category (≤ 5 vs > 5) in **77.3%**; of PSG AHI > 5, **61.5%** showed device AHI < 5 at home                                                                                                                                | [DOI](https://doi.org/10.1371/journal.pone.0174458) (PMID 28379985) |

### How to read this evidence

- **The mean bias is small but the limits of agreement / percentage error are large.** Iftikhar's percentage errors (59–112%) are the headline: on _average_ device and PSG AHI agree, but for an _individual night/patient_ the device AHI can be off by a large fraction. Small bias ≠ precise per-patient.
- **Classification (the type split) is far worse than the aggregate.** Nigro's ICCs — **central 0.69 but obstructive 0.16 and hypopneas 0.15** — quantify exactly the §4 warning: the device counts _that_ an event happened more reliably than _what kind_ it was.
- **Direction of error depends on regime.** Devices tend to **undercount residual events** relative to careful manual flow scoring (Reiter), yet a high _machine_ REI can exceed manual scoring in unstable-breathing/high-leak patients (Ni & Thomas). The error is **not a fixed offset**.
- **Validation is concentrated on the aggregate residual AHI of the AutoSet/Auto-Trak families**, often in _selected_ populations (central apnea and comorbidity excluded). Generalisation to unselected real-world nights, and to the on-device CA/OA split specifically, is weak.

---

## 9. Device-specific notes

### ResMed AirSense 10 / 11, AirCurve 10/11, AirMini

- Flow derived from pressure-based sensor + blower characterisation; **25 Hz** flow/pressure waveform stored **[C]**.
- FOT central/obstructive classification at **~4 Hz** **[M]/[P]**; reports **Clear Airway Apnea** = central.
- Reports **unintentional** leak **[M]**.
- Hypopnea = flow-only, ~50–70% reduction ≥ 10 s **[M]**.
- AirSense 11 shares the AS10 architecture; community EDF parsing confirms equivalent channels **[C]**.

### Philips DreamStation 1 & 2, System One / REMstar

- **Digital Auto-Trak** flow tracking; **discrete pressure-pulse** test for clear-airway vs obstructive **[M]**.
- Many models report **TOTAL leak** (not directly comparable to ResMed) **[M]**.
- **2021 PE-PUR foam recall** (14 June 2021): millions of first-generation DreamStation, System One/REMstar, DreamStation Go, Dorma, and several BiPAP/ventilator models recalled for sound-abatement foam degradation; **DreamStation 2 was not part of the original foam recall**. Recalled devices remain widely in use, so an analyzer must still support their data formats. See AASM guidance and the Philips recall notice (References). This is a _safety/regulatory_ note, not a data-accuracy claim.

### Fisher & Paykel SleepStyle / Icon

- 4–20 cmH₂O, 0.5 cmH₂O steps; flow-based auto-adjusting algorithm responding to flow limitation, apnea, hypopnea; reports AHI, leak, pressure **[M]**.
- **SensAwake** detects wake and reduces pressure **[M]**.
- **Evidence is thin:** only **one** F&P device appeared in the Iftikhar meta-analysis, with the **highest percentage error (112%)** of the three manufacturers — i.e., the **least independently validated** and apparently least precise of the three for residual-AHI estimation [DOI](https://doi.org/10.1007/s11325-023-02780-w). Treat F&P-reported indices with extra caution.

### Cross-device-model/mode interchangeability

Device-reported AHI and leak are **not interchangeable** across manufacturers — algorithms, event definitions, and leak conventions differ (Iftikhar 2023). The guard is necessary but **not sufficient**: it also applies **within ResMed, across modes**.

- **ResMed reports unintentional leak; many Philips devices report total leak** → a raw leak-number comparison is meaningless without the mask vent curve.
- **Flow-only hypopnea definitions differ** (ResMed ~50–70% reduction; Philips Auto-Trak threshold differs) → AHI is non-interchangeable.
- **ASV / AirCurve devices actively suppress central events**, so a CA index from an ASV machine is **not comparable** to a CA index from an AutoSet APAP.
- The **AirMini** uses a different (HumidX, tube) circuit model.

**An analyzer must never pool or directly compare AHI/leak across manufacturers, device models, or therapy modes without explicit normalisation and a prominent caveat.**

---

## 10. Reliability ranking — what to trust, what to caveat (drives UI)

From **near ground truth** to **heavily modeled / least reliable** (tiers per [ADR 0018](../decisions/0018-measurement-uncertainty-reliability-display.md)):

| Rank | Metric                                                        | Tier                                                | Why                                                                                                        | Display recommendation                                                                     |
| ---- | ------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1    | **Delivered/measured pressure** (median, 95th pct, EPAP/IPAP) | **high**                                            | Directly sensed; device regulates to it                                                                    | Show with precision (1 dp, ISO rationale); never band                                      |
| 2    | **Usage / mask-on time**                                      | **high**                                            | Simple timer                                                                                               | Show precisely (but remember it is the AHI denominator, not sleep time)                    |
| 3    | **Apnea count / index** (clean signal, low leak)              | **moderate**                                        | _Detected_ from a leak-corrected estimate; undercounts vs PSG; mask-on denominator; Poisson noise          | Trust the aggregate; round sensibly; leak-gated; never label ground-truth-equivalent       |
| 4    | **Unintentional leak** (below threshold)                      | **high**                                            | Well-characterised vent subtraction                                                                        | Show; use as data-quality gate; never compare ResMed ↔ Philips raw                         |
| 5    | **Aggregate AHI vs PSG**                                      | **moderate** (small bias, wide LoA / 59–112% error) | Different definitions + denominator; large per-night imprecision                                           | Trend headline; 1 dp; band as typical-range when near a boundary                           |
| 6    | **Hypopnea count**                                            | **moderate** → `low` at high leak                   | Flow-only, no desat/arousal, threshold-sensitive                                                           | Caveat that it ≠ PSG hypopnea; leak-gated                                                  |
| 7    | **Tidal volume / minute ventilation / RR**                    | **moderate** → suppressed at high leak              | Second-order integration of leak-corrected flow; disclaimed below Vt 100 mL / MV 3 L/min                   | Trends only; suppress above the suppression leak gate                                      |
| 8    | **Central vs obstructive split** (FOT / pulse)                | **low**                                             | Active patency probe; closed-airway centrals misclassified; ICC ≈ 0.16 obstructive subtype; leak-sensitive | Strong humility on _type_; **still surface a rising CA trend** as "discuss with clinician" |
| 9    | **Flow-limitation index / %**                                 | **low**                                             | Shape-derived, proprietary, unvalidated                                                                    | Relative/trend only; never an absolute clinical number                                     |
| 10   | **RERA**                                                      | **low** (lowest; not PSG-equivalent)                | No EEG arousal available                                                                                   | Label explicitly as a surrogate, not a PSG RERA                                            |

### Cross-cutting precision rules for the UI

- **Don't over-display precision.** AHI to one decimal at most; flow-limitation as a trend, not an absolute. Two-decimal AHI implies false precision.
- **Single-night AHI deltas of ≤ 1–2 are usually noise** (Poisson rate error + night-to-night biology). Emphasise rolling medians and distributions over night-to-night deltas, and drive "stable vs changing" off the trend/change-point, not the single-night delta (see [measurement-uncertainty.md §7](./measurement-uncertainty.md#7-open-items--verification-to-dos)).
- **Leak is a data-quality gate**, not just a metric: down-weight/annotate derived metrics during high-leak segments, using the split notice (24) / suppression (30) thresholds.
- **Short sessions are noisy** — but precision is driven by **event count N**, not hours; widen displayed uncertainty (or warn) when the effective event count is small.
- **Never compare across manufacturers, models, or modes** without explicit normalisation and a visible caveat.
- **Surface, don't diagnose:** a rising Clear-Airway/central index is a flag to seek clinical advice (treatment-emergent central apnea), framed accordingly and never silenced by its `low` tier.

---

## 11. Evidence gaps (be explicit)

- **No primary-source confirmation** this pass of the exact ResMed (±0.5 cmH₂O + 4%) or Philips/F&P pressure-accuracy ± figures — confirm against manufacturer service/technical manuals **[?]**. The application's 1-dp pressure display rests on ISO 80601-2-70 + near-ground-truth, **not** on the unverified 0.2 cmH₂O resolution figure.
- **ResMed FOT amplitude (~1 cmH₂O)** and **specific patent numbers** are widely cited but unconfirmed against primary sources here **[?]** — kept out of user-facing copy as fact.
- **Leak thresholds (24 / 30 / 42 L/min)** are device-reporting/community conventions **[?/C]**, mask-dependent, held behind named constants pending `resmed-specialist` verification; the 42 L/min figure is S9-era and not for current devices.
- **Sampling-rate figures are community-derived** (OSCAR/Apnea Board), reliable in practice but not manufacturer-published **[C]**.
- **No independent validation of the on-device CA/OA split vs simultaneous PSG with effort belts** for AS10/AS11 was located; the §8 evidence validates aggregate residual AHI, not the type split.
- **Fisher & Paykel evidence is very thin** (single device in one meta-analysis).

---

## References

**Peer-reviewed (PubMed; attributed per PubMed terms):**

1. Iftikhar IH, BaHammam A, Jahrami H, Ioachimescu O. _Accuracy of residual respiratory event detection by CPAPs: a meta-analysis._ Sleep Breath. 2023;27(5):1759–1768. [DOI](https://doi.org/10.1007/s11325-023-02780-w) (PMID 36715836)
2. Ni Y-N, Thomas RJ. _A longitudinal study of the accuracy of positive airway pressure therapy machine-detected apnea-hypopnea events._ J Clin Sleep Med. 2022;18(4):1121–1134. [DOI](https://doi.org/10.5664/jcsm.9814) (PMID 34886948)
3. Reiter J, Zleik B, Bazalakova M, Mehta P, Thomas RJ. _Residual events during use of CPAP: prevalence, predictors, and detection accuracy._ J Clin Sleep Med. 2016;12(8):1153–1158. [DOI](https://doi.org/10.5664/jcsm.6056) (PMID 27166303)
4. Nigro CA, González S, Arce A, Aragone MR, Nigro L. _Accuracy of a novel auto-CPAP device to evaluate the residual apnea-hypopnea index in patients with OSA._ Sleep Breath. 2014;19(2):569–578. [DOI](https://doi.org/10.1007/s11325-014-1048-z) (PMID 25115886)
5. Cilli A, Uzun R, Bilge U. _The accuracy of autotitrating CPAP-determined residual apnea-hypopnea index._ Sleep Breath. 2013;17(1):189–193. [DOI](https://doi.org/10.1007/s11325-012-0670-x) (PMID 22371206)
6. Desai H, Patel A, Patel P, Grant BJB, Mador MJ. _Accuracy of autotitrating CPAP to estimate the residual AHI…_ Sleep Breath. 2009;13(4):383–390. [DOI](https://doi.org/10.1007/s11325-009-0258-2) (PMID 19408029)
7. Brajer-Luftmann B, et al. _The automatic algorithm of the auto-CPAP device as a tool for the assessment of treatment efficacy…_ Life (Basel). 2022;12(9):1357. [DOI](https://doi.org/10.3390/life12091357) (PMID 36143393)
8. Agrawal R, Wang JA, Ko AG, Getsy JE. _A real-world comparison of apnea-hypopnea indices of positive airway pressure device and polysomnography._ PLoS One. 2017;12(4):e0174458. [DOI](https://doi.org/10.1371/journal.pone.0174458) (PMID 28379985)
9. Punjabi NM, Patil S, Crainiceanu C, Aurora RN. _Variability and misclassification of sleep apnea severity based on multi-night testing._ Chest. 2020;158(1):365–373. [DOI](https://doi.org/10.1016/j.chest.2020.01.039) (PMID 32081650)
10. Sforza E, Roche F, Chapelle C, Pichot V. _Internight variability of apnea-hypopnea index in OSA using ambulatory polysomnography._ Front Physiol. 2019;10:849. [DOI](https://doi.org/10.3389/fphys.2019.00849) (PMID 31354515)
11. Fietze I, et al. _Night-to-night variation of the oxygen desaturation index in sleep apnoea syndrome._ Eur Respir J. 2004;24(6):987–993. [DOI](https://doi.org/10.1183/09031936.04.00100203) (PMID 15572543)
12. Alamdari HH, et al. _High frequency–low amplitude oscillometry: continuous unobtrusive monitoring of respiratory function on PAP machines._ IEEE Trans Biomed Eng. 2022;69(7):2202–2211. [DOI](https://doi.org/10.1109/TBME.2021.3138965) (PMID 34962859) — confirms PAP machines use ~4 Hz intermittent FOT for patency.
13. Navajas D, Duvivier C, Farré R, Peslin R. _A simplified method for monitoring respiratory impedance during CPAP._ Eur Respir J. 2000;15(1):185–191. [DOI](https://doi.org/10.1183/09031936.00.15118500) (PMID 10678644)
14. Vanderveken OM, et al. _Quantification of pharyngeal patency in patients with sleep-disordered breathing._ ORL J Otorhinolaryngol Relat Spec. 2005;67(3):168–179. [DOI](https://doi.org/10.1159/000086572) (PMID 15990465)
15. Reisch S, Steltner H, Timmer J, Renotte C, Guttmann J. _Early detection of upper airway obstructions by analysis of acoustical respiratory input impedance._ Biol Cybern. 1999;81(1):25–37. [DOI](https://doi.org/10.1007/s004220050542) (PMID 10434389)
16. Montserrat JM, Farré R, Navajas D. _New technologies to detect static and dynamic upper airway obstruction during sleep._ Sleep Breath. 2001;5(4):193–206. [DOI](https://doi.org/10.1007/s11325-001-0193-3) (PMID 11868159)

**Manufacturer / regulatory / community:**

17. ResMed AirSense 10 AutoSet Clinical Guide (pressure range, accuracy caveats, event definitions, leak). <https://ap.resmed.com> (clinical guide PDF) — **[M]**
18. Philips DreamStation 2 user manual & technical reference (pressure range, ISO 80601-2-70). <https://www.documents.philips.com> — **[M]**
19. Philips Respironics Auto-Trak / clear-airway pressure-pulse description (DreamMapper FAQ; device documentation). <https://www.mysleepmapper.com/Help/Faq> — **[M]**
20. Philips Respironics PE-PUR foam recall notification, 14 June 2021. <https://www.usa.philips.com/a-w/about/news/archive/standard/news/press/2021/20210614-philips-issues-recall-notification-to-mitigate-potential-health-risks-related-to-the-sound-abatement-foam-component-in-certain-sleep-and-respiratory-care-devices.html> — **[M]/regulatory**
21. AASM guidance in response to the Philips recall of PAP devices. <https://aasm.org/clinical-resources/guidance-philips-recall-pap-devices/> — regulatory
22. Fisher & Paykel SleepStyle specification sheet (pressure range, SensAwake, AHI reporting). <https://pdf.medicalexpo.com/pdf/fisher-paykel-healthcare/> — **[M]**
23. OSCAR / Apnea Board EDF reverse-engineering documentation (channel set, sampling rates, leak conventions). <https://www.apneaboard.com/wiki/> — **[C]**

> **Note on ResMed/Philips PDF accessibility.** Several primary manufacturer PDFs returned HTTP 403 to automated retrieval during this research pass; figures marked **[?]** should be confirmed by manually opening the manufacturer service/technical manuals before being treated as fact.
