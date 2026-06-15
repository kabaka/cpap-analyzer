# Report B — Statistics of Measurement Uncertainty and Error Stacking

**Project:** CPAP Analyzer (client-side CPAP therapy data analysis)
**Audience:** Patients with data-science, mathematics, or bioinformatics backgrounds
**Status:** Draft (for internal review)
**Scope:** A rigorous-but-accessible treatment of how measurement error arises, how it propagates through CPAP-derived metrics, how to quantify the noise in event-rate estimates such as AHI, how biological night-to-night variability differs from instrument error, the statistics used to assess agreement between methods, and practical guidance on display precision and uncertainty indicators.

> **Important framing.** This application does **not** diagnose. Everything below is descriptive analysis of the data your machine records. The clinical thresholds quoted (AHI cut-offs, compliance criteria) are reference points used by sleep medicine, not statements about your health. Where this report derives a formula or worked number itself, it is labelled **[derivation]**; where a claim rests on the literature, the citation is given inline with a DOI/PMID link.

---

## 0. Notation and conventions

| Symbol | Meaning |
| --- | --- |
| $x$ | a measured or derived quantity (point estimate) |
| $u(x)$ | the **standard uncertainty** of $x$ (an estimated standard deviation, in the same units as $x$) |
| $u_r(x) = u(x)/|x|$ | the **relative** standard uncertainty (dimensionless) |
| $\sigma$ | a population/process standard deviation |
| $N$ | a count of events |
| $T$ | an exposure duration (here, hours of sleep/recording) |
| $\lambda$ | a rate (events per hour) |
| $z$ | a standard-normal quantile ($z_{0.975}\approx 1.96$ for 95%) |
| $\rho$ | a correlation coefficient |

We follow the vocabulary of the international metrology standard, the **Guide to the Expression of Uncertainty in Measurement (GUM)**, JCGM 100:2008, published by the Joint Committee for Guides in Metrology / BIPM ([JCGM 100:2008 PDF, BIPM](https://www.bipm.org/documents/20126/2071204/JCGM_100_2008_E.pdf)). The GUM is the established cross-disciplinary reference for combining uncertainties; we cite it for definitions and the propagation law, and label our CPAP-specific applications as derivations.

---

## 1. Measurement-error taxonomy

Four distinctions matter. They are often conflated, so we define each precisely.

### 1.1 Systematic error (bias) vs random error (precision)

For a quantity with true value $x_\text{true}$, a single measurement can be written

$$
x_\text{meas} = x_\text{true} + \underbrace{b}_{\text{systematic}} + \underbrace{\varepsilon}_{\text{random}},\qquad \mathbb{E}[\varepsilon]=0,\ \operatorname{Var}(\varepsilon)=\sigma^2 .
$$

- **Systematic error (bias)** $b$ is the component that does **not** average out on repetition. It shifts every measurement in the same direction. Example: a flow sensor whose zero-point has drifted, so every reported tidal volume is 8% high. Averaging 100 nights does not remove it.
- **Random error** $\varepsilon$ is the zero-mean fluctuation that **does** average out: the mean of $n$ independent measurements has variance $\sigma^2/n$. Example: turbulence-induced noise in the pneumotach flow signal.

The GUM groups these by *evaluation method* rather than by nature: **Type A** uncertainties are evaluated statistically (from the scatter of repeated observations), **Type B** from other information (calibration certificates, manufacturer specs, physical limits) — see GUM §2.3, §4.2–4.3 ([JCGM 100:2008](https://www.bipm.org/documents/20126/2071204/JCGM_100_2008_E.pdf)).

### 1.2 Accuracy vs precision

- **Accuracy** = closeness to the true value; degraded by **bias**.
- **Precision** = closeness of repeated measurements to *each other*; degraded by **random error**.

The classic mental model: a tight cluster far from the bullseye is *precise but inaccurate* (bias dominates); a loose scatter centred on the bullseye is *accurate on average but imprecise* (random error dominates). A metric can be one without the other. For CPAP this matters because manufacturer-derived metrics (e.g. ResMed AHI) can be very *precise* (reproducible to the same input) yet carry a *bias* relative to attended polysomnography scoring conventions.

### 1.3 Aleatoric vs epistemic uncertainty

- **Aleatoric** uncertainty is irreducible randomness intrinsic to the process — true night-to-night biological variation in your airway physiology. More data lets you *estimate* it but cannot make it go away.
- **Epistemic** uncertainty is *lack of knowledge* — limited number of nights, an unknown sensor bias, an algorithm whose scoring rules you cannot inspect. It **can** be reduced with more/better data or better models.

This split drives display decisions (Section 6): you can shrink an epistemic confidence interval by collecting more nights, but a wide aleatoric spread is a real feature of the patient that the app should *show*, not hide.

---

## 2. Error propagation: combining uncertainties

### 2.1 The general first-order (Taylor) propagation law

Let $y = f(x_1,\dots,x_n)$ be a derived metric computed from inputs $x_i$ with standard uncertainties $u(x_i)$ and pairwise covariances $\operatorname{cov}(x_i,x_j)$. The GUM "law of propagation of uncertainty" (GUM §5.1–5.2, Eqs. 10–13; [JCGM 100:2008](https://www.bipm.org/documents/20126/2071204/JCGM_100_2008_E.pdf)) gives, to first order in a Taylor expansion:

$$
u_c^2(y) \;=\; \sum_{i=1}^{n}\left(\frac{\partial f}{\partial x_i}\right)^2 u^2(x_i)
\;+\; 2\sum_{i=1}^{n-1}\sum_{j=i+1}^{n}\frac{\partial f}{\partial x_i}\frac{\partial f}{\partial x_j}\,\operatorname{cov}(x_i,x_j).
$$

The partial derivatives $c_i = \partial f/\partial x_i$ are the **sensitivity coefficients**. This is the master formula; everything below is a special case.

### 2.2 Independent inputs → root-sum-of-squares (RSS / quadrature)

If the inputs are uncorrelated, all covariances vanish and the cross-terms drop:

$$
\boxed{\,u_c(y) = \sqrt{\sum_i c_i^2\, u^2(x_i)}\,}\qquad\text{(quadrature / RSS).}
$$

Two important corollaries **[derivation, standard results]**:

- **Sum or difference**, $y = x_1 \pm x_2$: sensitivities are $\pm 1$, so absolute uncertainties add in quadrature:
  $$u_c(y)=\sqrt{u^2(x_1)+u^2(x_2)}.$$
- **Product or ratio**, $y = x_1 x_2$ or $y = x_1/x_2$: **relative** uncertainties add in quadrature:
  $$\frac{u_c(y)}{|y|}=\sqrt{\left(\frac{u(x_1)}{x_1}\right)^2+\left(\frac{u(x_2)}{x_2}\right)^2}.$$
  This ratio rule is the workhorse for AHI (Section 2.5).

### 2.3 Worst-case linear addition (the "interval" bound)

If you want a guaranteed bound rather than a statistical one — i.e. you assume the errors could all conspire in the same direction — you add absolute contributions linearly:

$$
\Delta y_\text{max} = \sum_i |c_i|\,\Delta x_i .
$$

Linear addition is always $\ge$ RSS (triangle inequality). It is the right choice when (a) errors are perfectly correlated, (b) you genuinely need a hard envelope (e.g. a safety bound), or (c) you have only a handful of dominant terms and refuse to assume independence. It is **pessimistic** when terms are independent: for $n$ equal independent terms RSS grows like $\sqrt{n}$ while linear grows like $n$.

### 2.4 When correlation breaks RSS

RSS is only valid when the cross-covariance terms are negligible. They are **not** negligible, and RSS will mislead, whenever the inputs share a common cause. The covariance term can be written with the correlation coefficient $\rho_{ij}=\operatorname{cov}(x_i,x_j)/[u(x_i)u(x_j)]$:

$$
u_c^2(y)=\sum_i c_i^2 u^2(x_i) + 2\sum_{i<j} c_i c_j\,\rho_{ij}\,u(x_i)u(x_j).
$$

- $\rho>0$ with same-sign sensitivities **inflates** uncertainty beyond RSS.
- $\rho<0$ (or opposite-sign sensitivities) can **cancel** — sometimes below either input's uncertainty.

CPAP examples where correlation is real and RSS is wrong:
1. **A shared leak artefact** biases *both* tidal volume and minute ventilation in the same direction (positive $\rho$) — their errors do not partially cancel; they reinforce (Section 2.7).
2. **Obstructive and central event counts** are derived from the *same* flow signal by a single classifier; a noisy night that inflates total detections affects both sub-counts, inducing correlation in their errors (Section 2.6).

> **Rule of thumb.** Use RSS only after arguing that the inputs are physically independent. If they are computed from the same upstream signal or share a calibration, write down the covariance term or fall back to the worst-case bound.

### 2.5 Worked example — AHI as a ratio

$$
\text{AHI} = \frac{N}{T},\qquad N=\text{respiratory events},\ T=\text{hours of sleep (or flagged usage)}.
$$

This is a ratio, so relative uncertainties combine in quadrature **[derivation]**:

$$
\frac{u(\text{AHI})}{\text{AHI}}=\sqrt{\left(\frac{u(N)}{N}\right)^2+\left(\frac{u(T)}{T}\right)^2}.
$$

Two distinct uncertainty sources feed $u(N)$: (i) **counting/sampling** noise — even a perfect detector sees a finite, random number of events on a given night (Section 3); and (ii) **detection** noise — the classifier mislabels or misses some events. They themselves combine in quadrature if independent:
$u^2(N) = u^2_\text{count}(N) + u^2_\text{detect}(N).$

*Numbers.* Suppose a night yields $N=40$ events over $T=6.0\ \text{h}$, so $\text{AHI}=6.67/\text{h}$. Take the Poisson counting term $u_\text{count}(N)=\sqrt{40}=6.32$ (Section 3.2), a detection term of, say, $u_\text{detect}(N)=0.1N=4.0$ (a 10% scoring imprecision — illustrative), and a duration uncertainty of $u(T)=0.1\ \text{h}$ (6 minutes of sleep/wake-edge ambiguity):

$$
u(N)=\sqrt{6.32^2+4.0^2}=7.48,\quad \frac{u(N)}{N}=0.187,\quad \frac{u(T)}{T}=0.0167.
$$
$$
\frac{u(\text{AHI})}{\text{AHI}}=\sqrt{0.187^2+0.0167^2}=0.188\ \Rightarrow\ u(\text{AHI})=0.188\times 6.67=1.25/\text{h}.
$$

So AHI $\approx 6.7 \pm 1.3$/h (1$\sigma$). **The duration term is negligible; counting noise dominates.** This is the key qualitative lesson: for typical nights, AHI uncertainty is driven by the *number of events*, not by how precisely you measured sleep time. (The 10% detection term is an illustrative placeholder; a verified value would require an agreement study against scored PSG — see Section 5 and the data-science/`resmed-specialist` to-do in Section 7.)

### 2.6 Worked example — central/obstructive split (classification error stacked on detection error)

The pipeline is two-stage: detect $N$ events, then classify each as obstructive (O), central (C), hypopnea (H), etc. Errors stack across stages.

Model the classifier as assigning the central label with per-event sensitivity $s$ (true central correctly called central) and mislabelling obstructive-as-central at rate $f$ (false central). Then the **expected** central count is

$$
\mathbb{E}[\hat N_C] = s\,N_C + f\,N_O,
$$

a biased estimator unless $s=1, f=0$. Beyond the bias, the *variance* of $\hat N_C$ has three contributions **[derivation]**:

$$
u^2(\hat N_C)\;=\;\underbrace{u^2_\text{count}(N_C)}_{\text{how many central events truly occurred}}\;+\;\underbrace{N_C\,s(1-s)}_{\text{binomial classification of true central}}\;+\;\underbrace{N_O\,f(1-f)}_{\text{binomial leakage from obstructive}}.
$$

The first term is the Poisson sampling of the underlying central rate; the second and third are binomial classification noise. Critically, $\hat N_C$ and $\hat N_O$ are **negatively correlated** (a true central event mislabelled as obstructive simultaneously lowers $\hat N_C$ and raises $\hat N_O$), so their errors do **not** combine by naive RSS when you later compute, e.g., a central fraction $\hat N_C/(\hat N_C+\hat N_O)$ — use the covariance form of Section 2.4.

*Numbers (illustrative).* $N_C=5$ true central, $N_O=35$ true obstructive, classifier $s=0.9$, $f=0.05$.
- Bias: $\mathbb{E}[\hat N_C]=0.9(5)+0.05(35)=4.5+1.75=6.25$ — a true central count of 5 is reported as $\sim 6.25$, a $+25\%$ inflation driven almost entirely by leakage from the large obstructive pool.
- Variance: $u^2(\hat N_C)=\underbrace{5}_{\text{Poisson}}+\underbrace{5(0.9)(0.1)}_{0.45}+\underbrace{35(0.05)(0.95)}_{1.66}=7.11$, so $u(\hat N_C)=2.67$.

**Lesson:** when one class is rare (central events) and the other is abundant (obstructive/hypopnea), even a *small* false-positive rate on the abundant class can dominate the bias and variance of the rare class. The reported central-apnea fraction is the least reliable of the AHI sub-components, and the app should treat low central counts with explicit caution.

### 2.7 Worked example — leak-corrupted flow metrics

Unintentional **leak** is the single most insidious bias source for flow-derived metrics, because it is *systematic, signal-dependent, and shared* across every metric computed from the flow trace.

The device estimates patient flow by subtracting a modelled leak from total flow:
$$
\hat Q_\text{patient}(t) = Q_\text{total}(t) - \hat Q_\text{leak}(t).
$$
Any error in the leak model, $\delta(t) = \hat Q_\text{leak}(t)-Q_\text{leak}(t)$, propagates with **sensitivity $-1$** directly into patient flow and therefore into *every* downstream metric:

- **Tidal volume** $V_T=\int_\text{inspiration} \hat Q_\text{patient}\,dt$ inherits the integral of the leak error; a slowly varying leak bias integrates into a sustained $V_T$ bias.
- **Minute ventilation** $\dot V_E = V_T\times f_R$ inherits the same bias (and, because $V_T$ and $f_R$ are both estimated from the corrupted flow, their errors are **correlated** — use Section 2.4, not RSS).
- **Flow-derived event detection.** Large or rapidly fluctuating leak flattens and distorts the flow morphology the apnea/hypopnea detector relies on. This can cause both **false negatives** (a leak-smeared reduction masks a real hypopnea) and **false positives** (leak transients mimic flow limitation). The error here is not zero-mean: it is conditional on leak state.

Because the leak error is a *common cause*, the right composite picture is: define a leak-severity flag, and treat all flow-derived metrics from high-leak epochs as **correlated and potentially biased**, not as independent noisy estimates. Practically, the AASM and device guidance treat large-leak periods as unreliable; the app should down-weight or annotate flow-derived metrics when leak exceeds the device's reliable-detection threshold, and propagate that into a reduced-reliability indicator (Section 6). Confirm the exact ResMed leak threshold and its effect on event scoring with the `resmed-specialist` (this report does not assert a specific numeric threshold without that confirmation — evidence in our hands is currently thin on the precise cut-off).

---

## 3. Sampling and counting uncertainty: AHI as a Poisson process

### 3.1 Why Poisson

Over a single night, respiratory events occur at some underlying rate $\lambda$ (events/hour). If events were independent and the rate were locally constant, the count $N$ in time $T$ would follow a **Poisson distribution**, $N\sim\text{Poisson}(\lambda T)$, with the defining property

$$
\mathbb{E}[N]=\operatorname{Var}(N)=\lambda T .
$$

Reality is more clustered than pure Poisson (events bunch in REM and supine periods — *overdispersion*), so Poisson is best read as an **optimistic lower bound** on counting noise: the true sampling variability is at least this large. We state Poisson formulas because they are exact, transparent, and conservative-in-the-right-direction (they do not *understate* by as much as ignoring sampling noise entirely).

### 3.2 Normal approximation: the $\sqrt{N}$ rule

For $N\gtrsim 20$, $\text{Poisson}(\mu)\approx\mathcal N(\mu,\mu)$, giving the famous result that the standard uncertainty of a count is its square root:

$$
\boxed{\,u(N)\approx\sqrt{N}\,}\qquad\Rightarrow\qquad \frac{u(N)}{N}=\frac{1}{\sqrt N}.
$$

The **relative** precision of a count improves only as $1/\sqrt N$. This is why short nights with few events give wildly noisy AHI.

### 3.3 Confidence interval for an event rate

Since $\text{AHI}=N/T$ and $T$ is comparatively well known, propagate the count CI through division by $T$ **[derivation from the $\sqrt N$ rule]**:

$$
\boxed{\ \text{AHI} \in \frac{N \pm z\,\sqrt{N}}{T}\ }\qquad(\text{normal approximation, }z=1.96\text{ for }95\%).
$$

Equivalently, $u(\text{AHI})=\sqrt{N}/T=\sqrt{\text{AHI}/T}$ — uncertainty falls with longer recordings.

### 3.4 Exact Poisson CI (small counts)

The normal approximation breaks down for small $N$ (and gives a nonsensical negative lower bound when $N$ is tiny). The **exact** two-sided $100(1-\alpha)\%$ Poisson interval for the mean count uses the chi-square quantile relationship (Garwood 1936; standard result):

$$
\frac{1}{2}\chi^2_{\alpha/2,\,2N}\ \le\ \mu\ \le\ \frac{1}{2}\chi^2_{1-\alpha/2,\,2N+2},
$$

with the lower limit defined as $0$ when $N=0$. Divide both limits by $T$ to get an exact AHI rate interval. For $N=0$ the exact upper 95% bound is $\mu \le 3.0$ (the well-known "rule of three": with zero events observed, the rate could still be as high as $\approx 3/T$).

### 3.5 Worked numeric example — long vs short night

| | Night A | Night B |
| --- | --- | --- |
| Events $N$ | 30 | 5 |
| Duration $T$ | 6.0 h | 1.0 h |
| Point AHI | **5.0**/h | **5.0**/h |
| $u(N)=\sqrt N$ | 5.48 | 2.24 |
| $u(\text{AHI})=\sqrt N/T$ | 0.91/h | 2.24/h |
| Normal 95% CI (§3.3) | $(30\pm 10.7)/6 = $ **3.2 – 6.8**/h | $(5\pm 4.4)/1 = $ **0.6 – 9.4**/h |
| Exact Poisson 95% CI (§3.4), ÷T | **3.37 – 7.14**/h | **1.62 – 11.67**/h |

Both nights report **AHI = 5.0**, the canonical OSA/normal boundary. But Night A's interval sits mostly above 5 while Night B's exact interval spans 1.6–11.7 — straddling the "mild" and "moderate" reference bands. **[derivation]** *Same number, completely different confidence.* The exact and normal intervals agree well at $N=30$ but diverge at $N=5$, where the normal lower bound (0.6) is too low and the exact bound (1.62) is more trustworthy — at small $N$, prefer the exact interval. The practical upshot: AHI from a short or fragmented night is a noisy estimate, and the app should signal that (Section 6).

---

## 4. Biological / night-to-night variability vs measurement error

A reported AHI varies across nights for two fundamentally different reasons:

1. **Measurement error** — the same physiological night would be scored differently by the device on a re-run (this is small for a deterministic algorithm on identical input, but nonzero across calibration/leak states).
2. **Biological (within-subject) variability** — your *actual* airway behaviour differs night to night with body position, sleep stage architecture, alcohol, nasal congestion, and overnight rostral fluid shift.

### 4.1 Decomposing the variance

A standard variance-components model writes a person's observed nightly AHI as

$$
\text{AHI}_{ij} = \mu_i + b_{ij} + e_{ij},
$$

where $\mu_i$ is subject $i$'s true mean, $b_{ij}\sim(0,\sigma_\text{bio}^2)$ is biological night variation, and $e_{ij}\sim(0,\sigma_\text{meas}^2)$ is measurement error. The **intraclass correlation coefficient** (Section 5.2) estimates the share of total variance that is *stable between subjects*:

$$
\text{ICC}=\frac{\sigma^2_\text{subject}}{\sigma^2_\text{subject}+\sigma^2_\text{bio}+\sigma^2_\text{meas}}.
$$

A high ICC means a single night reliably ranks people; a moderate ICC means single-night AHI is an unreliable estimate of the person's typical state.

### 4.2 What the literature says (cited)

According to PubMed:

- **Magnitude of misclassification.** In the largest study to date, Lechat et al. (2022) analysed >11.6 million nights from 67,278 people using a validated under-mattress sensor and found that diagnosing OSA from a **single night** misclassifies roughly **20% of people**, with the per-individual single-night misdiagnosis likelihood ranging **~20–50%**; classification reliability (F1) rose from **0.77 (1 night) to 0.94 (14 nights)** and plateaued after ~14 nights. Lechat B, et al. *Am J Respir Crit Care Med.* 2022;205(5):563–569. [DOI](https://doi.org/10.1164/rccm.202107-1761OC) · PMID 34904935.
- **Consequences for outcome studies.** Lechat et al. (2023) showed single-night AHI failed to detect an OSA–hypertension association in **42%** of simulated trials, whereas ≥28 nights detected it in **100%**; multinight point estimates were 50% higher and uncertainty ~5× lower. Lechat B, et al. *Chest.* 2023;164(1):231–240. [DOI](https://doi.org/10.1016/j.chest.2023.01.027) · PMID 36716954.
- **Reliability coefficient (ICC).** Prasad et al. (2016), 84 patients with 2–8 consecutive home nights, reported an **ICC for home AHI of 0.73 (95% CI 0.66–0.80)** — i.e. ~**27% of AHI variance was intra-individual** — and that night-to-night variability was **higher in mild OSA** (AHI 5–15). Prasad B, et al. *J Clin Sleep Med.* 2016;12(6):855–863. [DOI](https://doi.org/10.5664/jcsm.5886) · PMID 26857059.
- **Category switching.** Ørntoft et al. (2020), 30 children/adolescents over two consecutive home nights, found **27% changed diagnostic category** (OSA vs not) and **50% changed severity category** between two nights; 40% of those normal on night 1 had OSA on night 2. Ørntoft M, et al. *Int J Pediatr Otorhinolaryngol.* 2020;137:110206. [DOI](https://doi.org/10.1016/j.ijporl.2020.110206) · PMID 32896337.
- **A reusable summary statistic.** Anitua et al. (2019), 99 patients over 3 home nights, computed a **standard error of measurement (SEM) for AHI of 4.64 events/h**, and showed that an AHI ± SEM band from a single night predicted the most-frequent 3-night severity category in >96% of cases. Anitua E, et al. *Sleep Sci.* 2019;12(2):72–78. [DOI](https://doi.org/10.5935/1984-0063.20190063) · PMID 31879538.
- **Physiological mechanism.** White et al. (2015) linked night-to-night AHI changes to overnight **rostral fluid shift** (correlated with evening leg fluid volume in NREM/supine), evidence that a substantial part of NNV is genuinely *biological/aleatoric*, not instrument noise. White LH, et al. *J Clin Sleep Med.* 2015;11(2):149–156. [DOI](https://doi.org/10.5664/jcsm.4462) · PMID 25406274.

**Synthesis.** Converging evidence (one very large consumer-device cohort, several smaller PSG/home studies, plus a mechanistic study) supports: (a) within-subject AHI variability is large, especially in the mild range; (b) a useful aggregate is an SEM/CI band of order a few events/h; (c) reliability stabilises after roughly two weeks of nightly data. The exact CoV is heterogeneous across studies and populations — we therefore report the *direction and order of magnitude* as well-supported, and treat any single point CoV as study-specific rather than universal (evidence for one canonical CoV number is thin).

**Why this is good news for a CPAP app specifically.** Unlike a one-night diagnostic study, a CPAP machine records *every* night. The app is in the rare position of being able to estimate a user's *personal* $\sigma_\text{bio}$ directly and show a trailing mean with a shrinking confidence band — exactly the multinight aggregation the literature recommends.

---

## 5. Agreement-statistics primer

When comparing two measurement methods (e.g. device-reported AHI vs PSG-scored AHI) or two scorings, correlation is the wrong tool — it measures *association*, not *agreement* (two methods can correlate perfectly while one is double the other). Use the following.

### 5.1 Bland–Altman limits of agreement

The foundational reference is Bland JM, Altman DG. "Statistical methods for assessing agreement between two methods of clinical measurement." *Lancet.* 1986;1(8476):307–310. [DOI](https://doi.org/10.1016/S0140-6736(86)90837-8) · PMID 2868172 (according to PubMed).

For paired measurements $(a_k,b_k)$, plot the **difference** $d_k=a_k-b_k$ against the **mean** $\bar m_k=(a_k+b_k)/2$. Report:

$$
\text{bias} = \bar d,\qquad \text{SD of differences} = s_d,\qquad \text{Limits of Agreement} = \bar d \pm 1.96\,s_d .
$$

Interpretation: $\bar d$ is the **systematic** difference (mean bias); the LoA give the range within which 95% of differences between the two methods are expected to fall. Read the plot for (i) nonzero bias, (ii) wide LoA relative to clinical tolerance, and (iii) **proportional bias** (differences trending with magnitude — e.g. the device under-reports more at high AHI), which signals the need for log-transformation or regression-based LoA.

### 5.2 Intraclass correlation coefficient (ICC)

The recommended selection-and-reporting guide is Koo TK, Li MY. "A Guideline of Selecting and Reporting Intraclass Correlation Coefficients for Reliability Research." *J Chiropr Med.* 2016;15(2):155–163. [DOI](https://doi.org/10.1016/j.jcm.2016.02.012) · PMID 27330520 (according to PubMed).

ICC estimates the proportion of total variance attributable to true between-subject differences (Section 4.1). Koo & Li stress there are **10 forms**, and you must specify three choices:

- **Model:** one-way random, two-way random (raters are a random sample → generalisable), or two-way mixed (raters/methods are fixed).
- **Type:** single rater/measurement vs the mean of $k$ raters/measurements.
- **Definition:** *consistency* (ignores systematic between-rater differences) vs *absolute agreement* (penalises them). For comparing measurement methods, **absolute agreement** is usually correct.

Their interpretive bands, **judged on the lower bound of the 95% CI**: $<0.5$ poor, $0.5–0.75$ moderate, $0.75–0.9$ good, $>0.9$ excellent. (Note: Prasad's home-AHI ICC of 0.73 → "moderate".)

### 5.3 Cohen's kappa (categorical agreement)

For agreement on *categories* (e.g. severity bands: normal/mild/moderate/severe, or event-label O/C/H), Cohen's kappa corrects observed agreement $p_o$ for chance agreement $p_e$:

$$
\kappa=\frac{p_o-p_e}{1-p_e}.
$$

$\kappa=1$ perfect, $0$ chance-level, $<0$ worse than chance. For **ordered** categories (severity bands), use **weighted kappa**, which penalises far-apart disagreements more than adjacent ones (linear or quadratic weights). Severity-band agreement between two nights or two methods is naturally a weighted-kappa problem.

### 5.4 Sensitivity, specificity, PPV, NPV (binary classification)

For a binary call (e.g. "is this epoch a central apnea?" or "does this night exceed AHI 15?") against a reference, with counts TP, FP, FN, TN:

$$
\text{Sensitivity (recall)}=\frac{TP}{TP+FN},\quad \text{Specificity}=\frac{TN}{TN+FP},
$$
$$
\text{PPV (precision)}=\frac{TP}{TP+FP},\quad \text{NPV}=\frac{TN}{TN+FN}.
$$

**Crucial caveat:** sensitivity/specificity are properties of the test; **PPV/NPV depend on prevalence**. By Bayes' theorem,
$$
\text{PPV}=\frac{\text{sens}\cdot p}{\text{sens}\cdot p + (1-\text{spec})(1-p)},
$$
so a detector with excellent sensitivity/specificity can still have poor PPV for a **rare** class. This is exactly the central-apnea problem from Section 2.6: when true central events are rare, even a low false-positive rate yields many false centrals, so a "central apnea" flag has low PPV. The app should phrase rare-event detections accordingly.

---

## 6. Practical guidance: display precision and uncertainty indicators

### 6.1 Significant figures should reflect uncertainty, not floating-point

The cardinal rule: **do not display more precision than the metric carries.** A general principle (consistent with GUM §7.2 on reporting; [JCGM 100:2008](https://www.bipm.org/documents/20126/2071204/JCGM_100_2008_E.pdf)) is to round so that the displayed resolution is comparable to the uncertainty.

- **AHI: 1 decimal place.** From Section 3, a typical night's AHI uncertainty is $\sim$1 event/h. Displaying "AHI 6.67" implies precision of 0.01/h — about 100× finer than the real uncertainty, which is false confidence. Show **6.7**. (This matches AASM/clinical convention of one decimal.) Two decimals are never justified for a single night.
- **Leak rate: integer or 1 decimal L/min.** Leak is a noisy, rapidly varying signal usually summarised by median/95th percentile; sub-L/min digits are noise. Display median leak as an integer (e.g. **24 L/min**); a single decimal at most for percentiles.
- **Pressure: 1 decimal cm H₂O** (matches device resolution of 0.2 cm H₂O on ResMed devices — confirm with `resmed-specialist`).
- **Usage hours: 1 decimal h** (e.g. 7.3 h); minutes-level precision is fine for a single session but not for averaged compliance.
- **Counts are exact** — show event counts as integers; the *rate* derived from them carries the uncertainty.
- **Compliance %:** integer percent; the underlying nights are few, so decimals overstate precision.

### 6.2 When to show an error bar / confidence band vs nothing

Show uncertainty when it changes the interpretation; suppress it when it is visual noise.

| Situation | Recommended treatment |
| --- | --- |
| **Trend of a metric over many nights** (e.g. 90-day AHI) | **Rolling mean with a confidence band** ($\bar x \pm z\,\text{SEM}$, $\text{SEM}=s/\sqrt n$). This is where uncertainty is both real and decision-relevant. |
| **Single-night AHI near a threshold** (e.g. 4.5–5.5, or 14–16) | Show a **CI** (Section 3) or a qualitative reliability badge; the point estimate alone is misleading. |
| **Short / fragmented night** (low $T$ or few events) | **Reliability indicator** (e.g. "limited data — wide uncertainty"); per Section 3.5 the CI can span two severity bands. |
| **High-leak night** | **Flag flow-derived metrics as reduced-reliability** (Section 2.7); do not present them with the same visual weight as clean nights. |
| **Rare-class metric** (central fraction with few central events) | Annotate low PPV / wide CI; avoid bold single numbers (Section 2.6 / 5.4). |
| **A precise, stable, well-sampled value** | A plain number is fine — an error bar here is clutter that trains users to ignore error bars. |

Design principles, in priority order consistent with the project's Correctness-over-UX rule:

1. **Never imply more certainty than exists.** A bare "AHI 5.0" at a threshold is the worst case.
2. **Prefer aggregation to per-night drama.** The literature (Section 4) is unanimous that multinight means are far more reliable; the app's default headline metric should be a trailing multinight mean with a band, not last night's raw number.
3. **Make uncertainty legible, not alarming.** A subtle band or a three-state reliability chip (good / limited / unreliable) communicates without panicking the user. Per WCAG AA, reliability state must **not** be conveyed by colour alone — pair with an icon/label.
4. **Distinguish aleatoric from epistemic in copy.** "Your AHI naturally varies night to night" (aleatoric, expected) reads very differently from "not enough data yet to be confident" (epistemic, fixable by waiting) — and they call for different user actions.

### 6.3 A concrete recommendation for the app's AHI display

- Headline: **trailing mean AHI over the available window, one decimal, with a 95% band** ($\bar x \pm 1.96\,s/\sqrt n$).
- Per-night detail: AHI to one decimal, plus an exact-Poisson CI (Section 3.4) shown on demand for nights with $N<20$.
- A per-night **reliability chip** driven by: total sleep time, event count, and leak severity.
- Severity-band assignment should be reported as a band with a note when the CI straddles a boundary, never as a hard category from one noisy night.

---

## 7. Open items / verification to-dos

- **Detection-error magnitude** ($u_\text{detect}$, sensitivity/specificity of the ResMed on-device scorer vs AASM-scored PSG): the 10% figure used in Section 2.5 is a *placeholder*. A defensible number needs an agreement study; route to `resmed-specialist` + `data-science`, and have `unit-tester` lock reference values for the Poisson/RSS routines below.
- **Leak reliability threshold** (Section 2.7): confirm the exact ResMed large-leak cut-off and its documented effect on event scoring before the app asserts one.
- **Reference values for `unit-tester`** (computed here, ready to encode):
  - $\sqrt N$ rule: $N=40\Rightarrow u(N)=6.3246$; relative $=0.15811$.
  - AHI ratio example (§2.5): AHI $=6.6\overline{6}$, $u(\text{AHI})=1.254$/h.
  - Exact Poisson 95% CI, $N=5$: $[1.6235, 11.6683]$ counts; ÷ $T=1$ h → same in /h.
  - Exact Poisson 95% CI, $N=30$: $[20.242, 42.832]$ counts; ÷ $6$ h → $[3.374, 7.139]$/h.
  - Normal-approx 95% CI, $N=30,T=6$: $[3.211, 6.789]$/h.
  - Rule of three: $N=0\Rightarrow$ upper 95% bound $\mu=3.0$.

---

## References

All biomedical references retrieved via **PubMed**; DOIs linked as required.

1. Bland JM, Altman DG. Statistical methods for assessing agreement between two methods of clinical measurement. *Lancet.* 1986;1(8476):307–310. [DOI](https://doi.org/10.1016/S0140-6736(86)90837-8) · PMID 2868172.
2. Koo TK, Li MY. A Guideline of Selecting and Reporting Intraclass Correlation Coefficients for Reliability Research. *J Chiropr Med.* 2016;15(2):155–163. [DOI](https://doi.org/10.1016/j.jcm.2016.02.012) · PMID 27330520.
3. Lechat B, Naik G, Reynolds A, et al. Multinight Prevalence, Variability, and Diagnostic Misclassification of Obstructive Sleep Apnea. *Am J Respir Crit Care Med.* 2022;205(5):563–569. [DOI](https://doi.org/10.1164/rccm.202107-1761OC) · PMID 34904935.
4. Lechat B, Nguyen DP, Reynolds A, et al. Single-Night Diagnosis of Sleep Apnea Contributes to Inconsistent Cardiovascular Outcome Findings. *Chest.* 2023;164(1):231–240. [DOI](https://doi.org/10.1016/j.chest.2023.01.027) · PMID 36716954.
5. Prasad B, Usmani S, Steffen AD, et al. Short-Term Variability in Apnea-Hypopnea Index during Extended Home Portable Monitoring. *J Clin Sleep Med.* 2016;12(6):855–863. [DOI](https://doi.org/10.5664/jcsm.5886) · PMID 26857059.
6. Ørntoft M, Andersen IG, Homøe P. Night-to-night variability in respiratory parameters in children and adolescents examined for obstructive sleep apnea. *Int J Pediatr Otorhinolaryngol.* 2020;137:110206. [DOI](https://doi.org/10.1016/j.ijporl.2020.110206) · PMID 32896337.
7. Anitua E, Duran-Cantolla J, Almeida GZ, Alkhraisat MH. Predicting the night-to-night variability in the severity of obstructive sleep apnea: the case of the standard error of measurement. *Sleep Sci.* 2019;12(2):72–78. [DOI](https://doi.org/10.5935/1984-0063.20190063) · PMID 31879538.
8. White LH, Lyons OD, Yadollahi A, Ryan CM, Bradley TD. Night-to-night variability in obstructive sleep apnea severity: relationship to overnight rostral fluid shift. *J Clin Sleep Med.* 2015;11(2):149–156. [DOI](https://doi.org/10.5664/jcsm.4462) · PMID 25406274.

**Metrology / statistical references (non-PubMed):**

9. JCGM 100:2008. *Evaluation of measurement data — Guide to the expression of uncertainty in measurement (GUM 1995 with minor corrections).* Joint Committee for Guides in Metrology / BIPM. [PDF](https://www.bipm.org/documents/20126/2071204/JCGM_100_2008_E.pdf). — Source for the uncertainty vocabulary (Type A/B), the law of propagation of uncertainty (§5), and reporting/rounding guidance (§7).
10. Garwood F. (1936) Fiducial limits for the Poisson distribution. *Biometrika* 28:437–442. — Origin of the exact chi-square Poisson interval (Section 3.4); cited here as the established source for the exact CI formula. (Classical result; not independently re-verified for this draft.)

**Provenance note.** Items 1–8 were retrieved and their figures quoted from PubMed metadata/abstracts; numeric claims attributed to them are taken from those abstracts. Items 9–10 are standard statistical/metrology references. All formulas labelled **[derivation]** are standard textbook propagation/Poisson results applied by the author to CPAP metrics, not novel methodology. No numbers or citations in this report were fabricated; where evidence is thin (single canonical CoV, exact leak threshold, on-device scorer accuracy) the text says so explicitly.
