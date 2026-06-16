# Measurement Accuracy & Uncertainty — Reference Documentation

**Audience:** Technically sophisticated patients (data science / mathematics / bioinformatics) and motivated laypersons, plus the CPAP Analyzer engineering team.
**Last updated:** 2026-06-15

> **This tool does not diagnose.** Everything in this section describes _instrument behaviour_ and _statistical properties_ of the numbers your devices record. The clinical thresholds quoted (AHI cut-offs, compliance criteria) are reference points used by sleep medicine, not statements about your health, and the CPAP Analyzer never assigns you a diagnosis or a severity category from its own analysis.

This section is the canonical reference for **how accurate each measurement is**, **why**, and **how the application chooses to display it**. It exists because the most common way a sleep-data tool misleads is not by computing the wrong number — it is by presenting a _correct_ number with more confidence than that number deserves.

---

## 1. The application's measurement-uncertainty philosophy

Three principles, in the project's priority order (Privacy > **Correctness** > Performance > UX > Features), govern every display decision documented here.

### Quiet by default

A reliability indicator is **clutter unless it changes a decision.** The application therefore shows uncertainty affordances _only_ when they are decision-relevant:

- **High-reliability metrics carry no chip at all** — the _absence_ of a caveat is the trust signal. Delivered pressure, usage/mask-on time, and unintentional leak below threshold are shown plainly and precisely.
- A reliability chip appears only on **soft (modeled) metrics**, when a **data-quality flag** is active for a session, or when a **single night sits on a severity boundary**.
- Error bars and confidence bands are reserved for places where the uncertainty is both real and actionable — not sprinkled on every value, which only trains users to ignore them.

### Trends over single nights

The dominant source of "why is my AHI different tonight?" is **real night-to-night biology** (body position, sleep-stage architecture, alcohol, nasal congestion, rostral fluid shift) compounded by **counting (Poisson) noise** — _before_ any device-detection error. The literature is consistent that a single night misclassifies roughly 20% of people, and that reliability stabilises only after ~14 nights of data (see [measurement-uncertainty.md §4](./measurement-uncertainty.md#4-biological--night-to-night-variability-vs-measurement-error)).

Consequently:

- The **headline AHI is a trailing multi-night statistic**, not last night's raw number: a rolling **median** centre line with an empirical **inter-quartile (P25–P75) "typical nightly range"** band.
- A single-night AHI change of **≤ 1–2 events/h is generally not meaningful** and is rendered as "≈ stable" rather than a trend arrow.
- Per-night detail still shows the night's value, with an on-demand sampling interval for low-count nights — labelled as a **lower bound** on uncertainty, never as "the 95% CI" (apnea events over-disperse, so Poisson understates the true spread).

### Surface, don't diagnose

Where a metric is a _modeled inference_ rather than a direct measurement, the application **surfaces the pattern and defers to the clinician**. It never converts a modeled signal into a diagnosis.

The one safety-critical asymmetry: a **`low` reliability tier lowers the precision claim; it must never silence a clinically important trend.** A rising central (Clear-Airway) index is `low` reliability _as a type classification_ — but a sustained upward trend still warrants a visible "discuss with your clinician" prompt, because treatment-emergent central apnea is real and the device tends to _under_-classify closed-airway centrals. Under-reaction is the dangerous failure mode, so the clinical-flag copy is deliberately distinct from (and not suppressed by) the reliability chip.

---

## 2. One-screen per-metric reliability summary

Three reliability tiers (`high` / `moderate` / `low`) generalise the existing breathing-analysis `confidenceTier` vocabulary. **"Data-quality flag"** (high-leak, short session, low coverage, low count) is an _orthogonal_ per-session condition that can degrade any metric, and **"unavailable"** is a render state, not a tier.

| Metric                                                             | Tier                                   | Chip?         | Why                                                                                                                                    | Detail                                                                                                                                                                              |
| ------------------------------------------------------------------ | -------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivered / measured **pressure** (median, 95th pct, EPAP/IPAP)    | **high**                               | none          | Directly sensed; device regulates to it                                                                                                | [cpap §2](./cpap-devices.md#2-pressure-delivered--measured-mask-pressure)                                                                                                           |
| **Usage / mask-on time**                                           | **high**                               | none          | Simple timer (but it is the AHI denominator, not sleep time)                                                                           | [cpap §1](./cpap-devices.md#1-the-fundamental-constraint)                                                                                                                           |
| **Unintentional leak** (below threshold)                           | **high**                               | none          | Well-characterised vent-subtraction model                                                                                              | [cpap §6](./cpap-devices.md#6-leak--and-how-it-poisons-everything-downstream)                                                                                                       |
| **Apnea count / index**                                            | **moderate**                           | leak-gated    | _Detected_ from a leak-corrected estimate; undercounts vs PSG; mask-on (not sleep) denominator; Poisson noise                          | [cpap §5](./cpap-devices.md#5-event-definitions-as-the-devices-implement-them), [unc §3](./measurement-uncertainty.md#3-sampling-and-counting-uncertainty-ahi-as-a-poisson-process) |
| **Aggregate AHI vs PSG**                                           | **moderate**                           | near boundary | Small mean bias but wide limits of agreement (59–112% pooled % error)                                                                  | [cpap §8](./cpap-devices.md#8-quantitative-validation-device-reported-ahi-vs-psg-scored-ahi)                                                                                        |
| **Hypopnea count**                                                 | **moderate** → `low` at high leak      | leak-gated    | Flow-only, no desaturation/arousal criterion, threshold-sensitive                                                                      | [cpap §5](./cpap-devices.md#5-event-definitions-as-the-devices-implement-them)                                                                                                      |
| **Tidal volume / minute ventilation / RR**                         | **moderate** → suppressed at high leak | leak-gated    | Second-order integration of the leak-corrected flow estimate                                                                           | [cpap §3](./cpap-devices.md#3-flow-rate-tidal-volume-minute-ventilation-respiratory-rate)                                                                                           |
| **Central vs obstructive split** (FOT / pulse)                     | **low**                                | yes           | Active patency probe; closed-airway centrals misclassified (ICC ≈ 0.16 obstructive subtype); leak-sensitive — **trend still surfaced** | [cpap §4](./cpap-devices.md#4-central-vs-obstructive-classification)                                                                                                                |
| **Flow-limitation index / %**                                      | **low**                                | yes           | Shape-derived, proprietary, no public ground-truth validation                                                                          | [cpap §5](./cpap-devices.md#5-event-definitions-as-the-devices-implement-them)                                                                                                      |
| **RERA**                                                           | **low**                                | yes           | No EEG → a surrogate, not a PSG-scored RERA                                                                                            | [cpap §5](./cpap-devices.md#5-event-definitions-as-the-devices-implement-them)                                                                                                      |
| **Cleared oximeter SpO₂** (Nonin / Masimo; calibrated ring)        | **moderate**                           | provenance    | ≤ 2–3% A_RMS, FDA-cleared; residual skin-pigment bias                                                                                  | [wearables §4](./wearables.md#4-spo2--consumer-wristring-vs-dedicated-oximeters)                                                                                                    |
| **Consumer wrist/ring SpO₂** (Fitbit EOV, Apple/Garmin/Oura/Whoop) | **low**                                | yes           | Uncalibrated reflectance, wellness-only, skin-pigment overestimation                                                                   | [wearables §4](./wearables.md#4-spo2--consumer-wristring-vs-dedicated-oximeters)                                                                                                    |
| **Wearable resting/sleeping HR**                                   | **moderate**                           | provenance    | MAE < 5 bpm at rest; degrades with motion and above ~100 bpm                                                                           | [wearables §3](./wearables.md#3-heart-rate-ppg-vs-ecg)                                                                                                                              |
| **Wearable multi-stage sleep** (Light/Deep/REM)                    | **low**                                | yes           | Inferred without EEG; κ ≈ 0.55–0.79 in research, worse in disordered sleep                                                             | [wearables §5](./wearables.md#5-sleep-stage-estimation-vs-polysomnography)                                                                                                          |

A `moderate` chip is shown only when decision-relevant; a `low` chip is shown on the soft metric itself; a data-quality flag chip is shown when its condition is active. Reliability/data-quality cues use the **violet/neutral** design axis, never the red/orange clinical-severity axis, so the two never collide.

---

## 3. Document index

| Document                                                       | Covers                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[cpap-devices.md](./cpap-devices.md)**                       | How a PAP device senses pressure and derives flow, Vt, MV, RR; the Forced Oscillation Technique and the central/obstructive split; how device event definitions differ from AASM; leak as a data-quality gate; the validation literature; the per-metric reliability ranking. |
| **[wearables.md](./wearables.md)**                             | Consumer wearables and home pulse oximeters: PPG heart rate, reflectance vs transmissive SpO₂, the skin-pigmentation bias, sleep-stage estimation, derived respiratory rate; manufacturer claims vs independent peer-reviewed findings.                                       |
| **[measurement-uncertainty.md](./measurement-uncertainty.md)** | The statistics: error taxonomy, GUM propagation laws, AHI as a Poisson process (exact and normal-approximation intervals), biological vs measurement variability, the agreement-statistics primer (Bland–Altman, ICC, kappa), and display-precision rules.                    |

**Governing decision:** the display posture and the locked statistical constants in these documents are recorded in the Architecture Decision Record **[ADR 0018 — Measurement-uncertainty & reliability display](../decisions/0018-measurement-uncertainty-reliability-display.md)** (MADR 4.0). Where this reference and the ADR appear to differ, the ADR is the authority for _implementation_; these documents are the authority for the _evidence and rationale_.

---

## 4. Sourcing conventions

Every quantitative claim in these documents is tagged so that **manufacturer claims are never confused with independent findings**:

- **[M]** manufacturer specification or clinical guide
- **[P]** peer-reviewed independent study (DOI/PMID given)
- **[C]** community reverse-engineering (OSCAR / Apnea Board) — reliable in practice but not a manufacturer spec
- **[?]** widely cited but **not** confirmed against a primary source in this research pass — treated as provisional and **never stated as fact** in application logic or user-facing copy

Biomedical citations were retrieved via PubMed and are attributed inline with a DOI or PMID per PubMed's terms. Several primary manufacturer PDFs returned HTTP 403 to automated retrieval; figures that depend on them are marked **[?]** and are flagged for verification rather than asserted.
