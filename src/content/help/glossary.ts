/**
 * Glossary of CPAP therapy, sleep medicine, statistics, and data terms.
 *
 * Each entry provides three levels of progressive disclosure:
 * - quick: One sentence for tooltips and hover cards
 * - standard: One paragraph for inline help and popovers
 * - detailed: Full explanation with formulas, clinical context, and references
 */

export interface GlossaryEntry {
  readonly id: string;
  readonly term: string;
  readonly category: GlossaryCategory;
  readonly quick: string;
  readonly standard: string;
  readonly detailed: string;
  /** Optional LaTeX formula for mathematical terms. Rendered with KaTeX. */
  readonly formula?: string;
  readonly aliases?: readonly string[];
  readonly relatedTerms?: readonly string[];
  /** Optional formal references (full citations), rendered in the detailed view. */
  readonly references?: readonly string[];
  /**
   * Optional measurement-uncertainty framing for the most error-prone terms
   * (consensus D5/D6). One short paragraph naming the dominant error source
   * and how to interpret the number — trends over single nights, device data
   * versus a sleep study, and (for the low-precision central split) that a
   * rising trend still warrants a clinician conversation. Plain prose with no
   * diagnostic or therapy-specific advice; any citation is inert text.
   */
  readonly uncertainty?: string;
}

export type GlossaryCategory = 'cpap-therapy' | 'sleep-medicine' | 'statistics' | 'data';

export const GLOSSARY_CATEGORIES: Record<GlossaryCategory, string> = {
  'cpap-therapy': 'CPAP Therapy',
  'sleep-medicine': 'Sleep Medicine',
  statistics: 'Statistics',
  data: 'Data & Formats',
};

export const glossaryEntries: readonly GlossaryEntry[] = [
  // ─── CPAP THERAPY ───────────────────────────────────────────────────

  {
    id: 'ahi',
    term: 'AHI (Apnea-Hypopnea Index)',
    category: 'cpap-therapy',
    aliases: ['Apnea-Hypopnea Index'],
    quick:
      'The number of apnea and hypopnea events per hour of sleep — the primary metric for sleep apnea severity.',
    standard:
      'AHI counts the total number of breathing interruptions (apneas and hypopneas) per hour of sleep. It is the standard clinical measure for diagnosing and monitoring obstructive sleep apnea. An AHI below 5 is considered normal; 5–14 is mild, 15–29 is moderate, and 30 or above is severe.',
    detailed:
      'AHI = (Total Apnea Events + Total Hypopnea Events) / Total Sleep Time (hours). Per AASM 2012 guidelines (ICSD-3), an apnea is a ≥90% reduction in airflow lasting ≥10 seconds, while a hypopnea is a ≥30% reduction in airflow for ≥10 seconds accompanied by ≥3% oxygen desaturation or an arousal. AHI counts apneas and hypopneas only — respiratory effort-related arousals (RERAs) are deliberately excluded. When RERAs are added, the result is the Respiratory Disturbance Index (RDI), a distinct and always-greater-or-equal metric reported separately. CPAP machines report "residual AHI," which reflects events that persist despite therapy. Severity classification: Normal (< 5), Mild (5–14), Moderate (15–29), Severe (≥ 30). Important: AHI does not capture event severity, desaturation depth, or sleep fragmentation — always review alongside SpO₂, RDI, and event clustering data.',
    formula:
      '\\text{AHI} = \\frac{\\text{Total Apneas} + \\text{Total Hypopneas}}{\\text{Total Sleep Time (hours)}}',
    uncertainty:
      'Three things dominate AHI uncertainty, in roughly this order. (1) Real night-to-night biology: your airway behaves differently with body position, sleep stage, alcohol, congestion, and overnight fluid shift — a single night misclassifies roughly 20% of people (Lechat et al. 2022), and reliability stabilises only after about two weeks of data. (2) Counting (Poisson) noise: relative precision improves only as 1/√N, so a short or low-event night gives a noisy rate. (3) Detection differences: the device scores from flow alone and divides by mask-on (not sleep) time, so device-AHI is not interchangeable with a polysomnography AHI. Read the multi-night trend, not last night, and treat a value sitting on a severity boundary (e.g. ≈ 5 or ≈ 15) as "could fall either side." This is descriptive, not a diagnosis — discuss patterns with your clinician.',
    relatedTerms: ['apnea', 'hypopnea', 'residual-ahi', 'rdi', 'odi', 'rem-predominant-osa'],
    references: [
      'Epstein, L. J., Kristo, D., Strollo, P. J., et al. (2009). Clinical guideline for the evaluation, management and long-term care of obstructive sleep apnea in adults. Journal of Clinical Sleep Medicine, 5(3), 263–276. — AASM severity classification, diagnostic thresholds, and treatment goals.',
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
    ],
  },
  {
    id: 'apnea',
    term: 'Apnea',
    category: 'cpap-therapy',
    quick: 'A complete or near-complete cessation of airflow for at least 10 seconds during sleep.',
    standard:
      'An apnea is defined as a ≥90% reduction in airflow lasting at least 10 seconds. There are three subtypes: obstructive (airway physically blocked), central (brain fails to signal breathing muscles), and mixed (starts as central, ends as obstructive). Apneas are the more severe component of the AHI.',
    detailed:
      'Per AASM scoring rules, an apnea requires ≥90% drop in peak signal excursion of the nasal pressure or oronasal thermal sensor for ≥10 seconds. Classification: Obstructive apnea — continued respiratory effort with absent airflow (airway collapse). Central apnea — absent airflow with absent respiratory effort (neurological origin). Mixed apnea — begins without respiratory effort, then effort resumes against an occluded airway. The type distribution matters clinically: predominantly central events may indicate complex sleep apnea or Cheyne-Stokes respiration, requiring different therapy (ASV vs. CPAP).',
    relatedTerms: ['obstructive-apnea', 'central-apnea', 'mixed-apnea', 'ahi'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
    ],
  },
  {
    id: 'hypopnea',
    term: 'Hypopnea',
    category: 'cpap-therapy',
    quick:
      'A partial reduction in airflow (≥30%) for at least 10 seconds, causing desaturation or arousal.',
    standard:
      'A hypopnea is a ≥30% reduction in airflow for at least 10 seconds, accompanied by either a ≥3% oxygen desaturation or an electroencephalographic arousal. Unlike apneas, breathing does not stop completely. Hypopneas are often more frequent than apneas and contribute significantly to sleep fragmentation.',
    detailed:
      'AASM recommended definition (2012): ≥30% reduction in nasal pressure signal excursion for ≥10 seconds, associated with ≥3% oxygen desaturation or arousal. An alternative "acceptable" criterion uses ≥4% desaturation without arousal (Medicare definition). CPAP machines typically cannot distinguish arousal-associated hypopneas, so they rely on flow-based algorithms. The scoring criterion used affects the AHI value — always note which definition applies when comparing measurements.',
    uncertainty:
      'Hypopnea is the more uncertain half of the AHI. The device applies a flow-only threshold with no desaturation or EEG-arousal confirmation, so the count is sensitive to the exact threshold and to mask leak (large leak both smears the flow shape and can mimic reductions). The same scoring rule applied to a flow signal versus a full sleep study can give materially different hypopnea counts. Interpret hypopnea-driven AHI as a screening trend, and weight nights with low leak more heavily.',
    relatedTerms: ['ahi', 'apnea', 'desaturation', 'flow-limitation'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
    ],
  },
  {
    id: 'rera',
    term: 'RERA (Respiratory Effort-Related Arousal)',
    category: 'cpap-therapy',
    aliases: ['Respiratory Effort-Related Arousal'],
    quick:
      'A breathing event that causes arousal but does not meet the criteria for apnea or hypopnea.',
    standard:
      'RERAs are subtle breathing disturbances — a sequence of breaths with increasing respiratory effort or flow limitation lasting ≥10 seconds that leads to an arousal from sleep, but does not qualify as an apnea or hypopnea. RERAs contribute to sleep fragmentation and daytime sleepiness, and are included in the Respiratory Disturbance Index (RDI) but not in AHI.',
    detailed:
      'AASM definition: a sequence of breaths lasting ≥10 seconds characterized by increasing respiratory effort or flattening of the nasal pressure waveform leading to an arousal that does not meet criteria for apnea or hypopnea. When RERAs are added to AHI, the result is the Respiratory Disturbance Index (RDI) — RERAs are part of RDI, never AHI. RERA detection on CPAP machines is limited because they cannot detect EEG arousals. Flow limitation patterns may serve as a proxy. Upper airway resistance syndrome (UARS) is characterized by elevated RERAs with normal AHI.',
    uncertainty:
      'A device RERA is a modeled surrogate, not a scored RERA: the defining feature of a true RERA is an EEG arousal, which a CPAP machine cannot measure, so the device infers RERAs from flow-limitation morphology alone. Treat the RERA count and any RDI built from it as a low-precision screening signal — a persistent pattern (for example a normal AHI alongside a consistently elevated RDI) is worth raising with your clinician, but the absolute number should not be read as a polysomnography RERA index.',
    relatedTerms: ['ahi', 'rdi', 'flow-limitation', 'uars'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
    ],
  },
  {
    id: 'rdi',
    term: 'RDI (Respiratory Disturbance Index)',
    category: 'cpap-therapy',
    aliases: ['Respiratory Disturbance Index'],
    quick:
      'The number of apneas, hypopneas, and RERAs per hour of sleep — equal to AHI plus the RERA index.',
    standard:
      'RDI extends the AHI by also counting respiratory effort-related arousals (RERAs): RDI = AHI + RERA index. Because it adds a non-negative term, RDI is always greater than or equal to the AHI for the same night. RDI captures subtler sleep-disordered breathing that the AHI misses, and is the metric that flags upper airway resistance syndrome (UARS), where AHI can be normal while RDI is elevated.',
    detailed:
      'RDI = (Total Apneas + Total Hypopneas + Total RERAs) / Total Sleep Time (hours), equivalently AHI + RERA index (per AASM / ICSD-3). The distinction matters: AHI and RDI are different indices and must not be conflated — summing RERAs into a value labelled "AHI" overstates the AHI and is clinically incorrect. CPAP Analyzer reports AHI and RDI as separate values so the two are never confused. Caveat: RERA scoring relies on EEG arousals, which CPAP machines cannot measure directly; device-derived RERA counts are therefore proxy estimates (typically from flow-limitation patterns) and the resulting RDI is an approximation, not a polysomnography-grade measurement. Interpret RDI as a screening signal — a normal AHI with a notably higher RDI may warrant discussion of UARS with a clinician.',
    formula:
      '\\text{RDI} = \\text{AHI} + \\text{RERA Index} = \\frac{\\text{Apneas} + \\text{Hypopneas} + \\text{RERAs}}{\\text{Total Sleep Time (hours)}}',
    relatedTerms: ['ahi', 'rera', 'uars', 'flow-limitation'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
      'Epstein, L. J., Kristo, D., Strollo, P. J., et al. (2009). Clinical guideline for the evaluation, management and long-term care of obstructive sleep apnea in adults. Journal of Clinical Sleep Medicine, 5(3), 263–276. — AASM severity classification, diagnostic thresholds, and treatment goals.',
    ],
  },
  {
    id: 'central-apnea',
    term: 'Central Apnea',
    category: 'cpap-therapy',
    aliases: ['CA'],
    quick:
      'An apnea caused by the brain failing to send breathing signals, not by physical airway obstruction.',
    standard:
      'Central apneas occur when the brain temporarily stops sending signals to the muscles that control breathing. Unlike obstructive apneas, the airway is open — there is simply no effort to breathe. A small number of central events is normal, but frequent central apneas may indicate central sleep apnea (CSA) or treatment-emergent central apnea (complex sleep apnea).',
    detailed:
      'Central apneas are scored when airflow cessation (≥90% reduction for ≥10 seconds) occurs without respiratory effort. They are distinguished from obstructive events by the absence of thoracoabdominal movement. CPAP machines estimate central vs. obstructive classification using forced oscillation technique (FOT) or flow waveform analysis. Common causes include heart failure (often with Cheyne-Stokes pattern), opioid use, high-altitude, and idiopathic CSA. Treatment-emergent central apnea (CompSA) occurs in ~5–15% of patients starting CPAP. If central AI > 5/hr, adaptive servo-ventilation (ASV) should be considered.',
    uncertainty:
      'The central-versus-obstructive label is the least reliable headline number this tool reports, for two compounding reasons. First, the classification rests on the airway response to a brief forced-oscillation probe, which is degraded by mask leak (the probe dissipates through the leak path) and tends to under-call closed-airway central events. Second, when true central events are rare, even a small false-positive rate on the abundant obstructive pool inflates the central count (a low positive-predictive-value problem). So the precise central count or fraction on any one night is uncertain. Crucially, low precision lowers the confidence in the number — it does not mean "ignore it": a sustained upward trend in central events still warrants a conversation with your clinician, because treatment-emergent central apnea is real and actionable. This tool does not diagnose and never recommends a therapy change.',
    relatedTerms: ['apnea', 'cheyne-stokes', 'asv'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
    ],
  },
  {
    id: 'obstructive-apnea',
    term: 'Obstructive Apnea',
    category: 'cpap-therapy',
    aliases: ['OA'],
    quick: 'An apnea caused by physical collapse of the upper airway during sleep.',
    standard:
      'Obstructive apneas occur when the muscles of the upper airway relax during sleep, causing the airway to collapse and block airflow. The person continues to make breathing efforts, but no air moves. This is the most common type of apnea in obstructive sleep apnea (OSA) and is the primary target of CPAP therapy.',
    detailed:
      'Obstructive apneas are scored when airflow ceases (≥90% reduction for ≥10 seconds) while respiratory effort continues, as evidenced by thoracoabdominal movement. The airway collapses at the level of the soft palate, tongue base, or epiglottis. Risk factors include obesity, retrognathia, macroglossia, and age. CPAP therapy works by pneumatically splinting the airway open. Optimal CPAP pressure is the minimum pressure that eliminates obstructive events without causing discomfort or central events.',
    relatedTerms: ['apnea', 'osa', 'cpap'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
    ],
  },
  {
    id: 'mixed-apnea',
    term: 'Mixed Apnea',
    category: 'cpap-therapy',
    aliases: ['MA'],
    quick:
      'An apnea that begins as central (no effort) and transitions to obstructive (effort against a closed airway).',
    standard:
      'Mixed apneas start without respiratory effort (central component) and then transition to continued effort against a blocked airway (obstructive component). They share features of both central and obstructive apneas. Mixed events are typically classified alongside obstructive apneas for treatment purposes, as the obstructive component generally responds to CPAP.',
    detailed:
      'A mixed apnea is scored when a ≥10-second event begins without respiratory effort (central portion) and ends with resumed effort against an occluded airway (obstructive portion). AASM guidelines require the central portion to be the initial component. Mixed apneas are grouped with obstructive apneas in AHI calculations for treatment decisions. Clinically, their presence may suggest a component of ventilatory control instability alongside anatomical airway vulnerability.',
    relatedTerms: ['apnea', 'central-apnea', 'obstructive-apnea'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
    ],
  },
  {
    id: 'cpap',
    term: 'CPAP (Continuous Positive Airway Pressure)',
    category: 'cpap-therapy',
    aliases: ['Continuous Positive Airway Pressure'],
    quick:
      'A fixed-pressure breathing device that keeps the airway open during sleep by blowing a continuous stream of air.',
    standard:
      'CPAP delivers a single, constant air pressure through a mask to prevent the airway from collapsing during sleep. It is the first-line treatment for obstructive sleep apnea. The pressure is set during a titration study and remains fixed throughout the night. CPAP is effective but some patients prefer APAP, which auto-adjusts pressure.',
    detailed:
      'CPAP delivers a pneumatic splint to the upper airway at a prescribed pressure, typically 4–20 cmH₂O. Pressure is determined through in-lab titration, home auto-titration, or empirical prediction formulas. The key advantage is simplicity and reliability; the disadvantage is that a single pressure must handle all body positions and sleep stages. CPAP is effective for >95% of OSA patients when used consistently. Compliance threshold per Medicare/insurance: ≥4 hours/night for ≥70% of nights (21/30 days). Modern CPAP machines include data logging, ramp functions, and expiratory pressure relief.',
    relatedTerms: ['apap', 'bipap', 'compliance', 'titration'],
    references: [
      'Epstein, L. J., Kristo, D., Strollo, P. J., et al. (2009). Clinical guideline for the evaluation, management and long-term care of obstructive sleep apnea in adults. Journal of Clinical Sleep Medicine, 5(3), 263–276. — AASM severity classification, diagnostic thresholds, and treatment goals.',
    ],
  },
  {
    id: 'apap',
    term: 'APAP (Automatic Positive Airway Pressure)',
    category: 'cpap-therapy',
    aliases: ['Automatic Positive Airway Pressure', 'AutoCPAP', 'Auto-CPAP'],
    quick:
      'A CPAP variant that automatically adjusts pressure throughout the night based on detected events.',
    standard:
      'APAP machines continuously monitor for apneas, hypopneas, flow limitation, and snoring, then automatically adjust the delivered pressure within a set range (e.g., 6–14 cmH₂O). This means the machine uses lower pressure when the airway is stable and increases pressure only when events are detected. Most modern ResMed machines operate in APAP mode by default.',
    detailed:
      'APAP algorithms detect flow limitation (inspiratory flattening), snoring (vibration in the flow signal), apneas, and hypopneas. When events are detected, pressure is incrementally increased; when the airway is stable, pressure slowly decreases. Response algorithms vary by manufacturer—ResMed uses a fuzzy-logic controller that responds to flow limitation before full events occur. Key settings: minimum pressure (Pmin, typically 4–6), maximum pressure (Pmax, typically 12–20). The 90th or 95th percentile pressure from APAP data is often used to set fixed CPAP prescriptions. APAP is not recommended for central sleep apnea, Cheyne-Stokes, or hypoventilation syndromes.',
    relatedTerms: ['cpap', 'bipap', 'epr'],
    references: [
      'Epstein, L. J., Kristo, D., Strollo, P. J., et al. (2009). Clinical guideline for the evaluation, management and long-term care of obstructive sleep apnea in adults. Journal of Clinical Sleep Medicine, 5(3), 263–276. — AASM severity classification, diagnostic thresholds, and treatment goals.',
    ],
  },
  {
    id: 'bipap',
    term: 'BiPAP (Bilevel Positive Airway Pressure)',
    category: 'cpap-therapy',
    aliases: ['Bilevel', 'BPAP', 'Bilevel Positive Airway Pressure'],
    quick:
      'A device that delivers two different pressures: higher on inhalation (IPAP) and lower on exhalation (EPAP).',
    standard:
      'BiPAP provides two pressure levels — a higher Inspiratory Positive Airway Pressure (IPAP) during inhalation and a lower Expiratory Positive Airway Pressure (EPAP) during exhalation. The pressure difference (pressure support) makes breathing easier and can treat both obstructive and central events. BiPAP is typically prescribed when CPAP alone is insufficient or uncomfortable.',
    detailed:
      'BiPAP delivers independent IPAP and EPAP settings. Pressure support (PS) = IPAP − EPAP. Higher PS increases tidal volume and can treat hypoventilation. Modes include S (spontaneous — triggered by patient breathing), T (timed — machine delivers breaths at set rate), and S/T (spontaneous with backup rate). ResMed VPAP devices include auto-adjusting bilevel (VAuto). BiPAP is indicated for: CPAP intolerance, obesity hypoventilation syndrome (OHS), neuromuscular disease, COPD-OSA overlap syndrome, and complex sleep apnea not responsive to CPAP. Typical IPAP range: 8–25 cmH₂O; EPAP: 4–20 cmH₂O.',
    relatedTerms: ['cpap', 'ipap', 'epap', 'asv'],
  },
  {
    id: 'asv',
    term: 'ASV (Adaptive Servo-Ventilation)',
    category: 'cpap-therapy',
    aliases: ['Adaptive Servo-Ventilation'],
    quick:
      'An advanced bilevel device that adapts pressure support breath-by-breath to treat central and complex sleep apnea.',
    standard:
      'ASV dynamically adjusts the amount of pressure support on each breath to stabilize breathing patterns. It targets central apneas and Cheyne-Stokes respiration by providing more support when breathing weakens and less when breathing is normal. ASV maintains an EPAP to treat obstructive events and anti-cyclically modulates IPAP to prevent/treat central events.',
    detailed:
      "ASV devices learn the patient's recent average ventilation over a ~3-minute window and set target ventilation at ~90% of this value. During central apneas or hypopneas, the device increases pressure support (IPAP − EPAP) to maintain ventilation. During hyperventilation, support is reduced to prevent further ventilatory overshoot. ResMed ASV (AirCurve ASV) uses an expiratory positive airway pressure of 4–15 cmH₂O and variable pressure support of 0–15 cmH₂O. CONTRAINDICATED in patients with symptomatic chronic heart failure with reduced ejection fraction (LVEF ≤ 45%) per the SERVE-HF trial, which showed increased cardiovascular mortality.",
    relatedTerms: ['bipap', 'central-apnea', 'cheyne-stokes'],
    references: [
      'Cowie, M. R., Woehrle, H., Wegscheider, K., et al. (2015). Adaptive servo-ventilation for central sleep apnea in systolic heart failure (SERVE-HF). New England Journal of Medicine, 373(12), 1095–1105. DOI: 10.1056/NEJMoa1506459.',
      'Somers, V. K., White, D. P., Amin, R., et al. (2008). Sleep apnea and cardiovascular disease: an American Heart Association/American College of Cardiology Foundation Scientific Statement. Circulation, 118(10), 1080–1111. DOI: 10.1161/CIRCULATIONAHA.107.189375. — On the cardiovascular consequences of sleep-disordered breathing.',
    ],
  },
  {
    id: 'compliance',
    term: 'Compliance',
    category: 'cpap-therapy',
    aliases: ['Adherence'],
    quick:
      'Whether a patient meets the minimum CPAP usage requirements — typically ≥4 hours/night for ≥70% of nights.',
    standard:
      'CPAP compliance is measured as usage hours per night and the percentage of nights meeting minimum criteria. The standard threshold (per Medicare and most insurers) is ≥4 hours/night for ≥70% of nights (21 out of 30 days) during a consecutive 30-day window. Falling below this threshold can result in loss of insurance coverage for equipment.',
    detailed:
      'The 4-hour/70% threshold was established for Medicare reimbursement (CMS LCD). However, clinical benefits are dose-dependent — more usage yields greater improvement in sleepiness, blood pressure, and cardiovascular outcomes. Research suggests ≥6 hours/night is optimal for cardiovascular benefit. CPAP Analyzer calculates compliance from actual mask-on time, derived from the mask-on/mask-off intervals the machine records in STR.edf (with a hysteresis-based fallback when those are unavailable) and excluding subtherapeutic ramp time — see the Usage Hours entry for the full method. Usage patterns (early-night dropoff, intermittent removal) are clinically informative. Compliance rates in clinical practice range from 30–60% at 1 year, making it one of the most significant challenges in sleep apnea treatment.',
    formula:
      '\\text{Compliance Rate} = \\frac{\\text{Nights} \\geq 4\\text{h}}{N_{\\text{total}}} \\times 100\\%',
    relatedTerms: ['usage-hours', 'cpap'],
    references: [
      'Centers for Medicare & Medicaid Services. Local Coverage Determination L33718: Positive Airway Pressure (PAP) Devices for the Treatment of Obstructive Sleep Apnea. — Adherence defined as ≥4 h/night on ≥70% of nights over a consecutive 30-day period within the first 90 days.',
      'Weaver, T. E., Maislin, G., Dinges, D. F., et al. (2007). Relationship between hours of CPAP use and achieving normal levels of sleepiness and daily functioning. Sleep, 30(6), 711–719. DOI: 10.1093/sleep/30.6.711.',
    ],
  },
  {
    id: 'titration',
    term: 'Titration',
    category: 'cpap-therapy',
    quick:
      'The process of determining the optimal CPAP pressure that eliminates breathing events without causing discomfort.',
    standard:
      'Titration is the process of finding the right CPAP pressure for a patient. It can be done during an in-lab sleep study (attended titration), at home using an APAP machine (auto-titration), or through empirical formulas. The goal is the lowest pressure that eliminates apneas, hypopneas, flow limitation, and snoring in all sleep positions and stages.',
    detailed:
      'In-lab titration follows AASM protocols: starting at 4 cmH₂O and increasing in 1 cmH₂O increments to eliminate events. The optimal pressure should control events in supine REM sleep (when the airway is most collapsible). Home auto-titration uses APAP data (typically 1–2 weeks) to determine the 90th or 95th percentile pressure as a fixed CPAP setting. Empirical formulas (e.g., Hoffstein: P = 0.16 × BMI + 0.13 × neck circumference + 0.04 × AHI − 5.12) provide initial estimates. Split-night studies combine diagnostic and titration in one night but may underestimate optimal pressure if insufficient REM sleep occurs.',
    relatedTerms: ['cpap', 'apap'],
    references: [
      'Epstein, L. J., Kristo, D., Strollo, P. J., et al. (2009). Clinical guideline for the evaluation, management and long-term care of obstructive sleep apnea in adults. Journal of Clinical Sleep Medicine, 5(3), 263–276. — AASM severity classification, diagnostic thresholds, and treatment goals.',
    ],
  },
  {
    id: 'ramp-time',
    term: 'Ramp Time',
    category: 'cpap-therapy',
    aliases: ['Ramp'],
    quick:
      'A comfort feature that gradually increases pressure from a low starting point to the prescribed level over a set period.',
    standard:
      'Ramp allows the CPAP to start at a low, comfortable pressure (typically 4 cmH₂O) and gradually increase to the therapeutic pressure over 5–45 minutes. This makes it easier to fall asleep with the mask on. ResMed devices also offer AutoRamp, which stays at a low pressure until the machine detects you have fallen asleep, then ramps to therapeutic pressure.',
    detailed:
      'Ramp duration is configurable (0–45 minutes, typically in 5-minute increments). Starting ramp pressure can be adjusted independently (4–therapeutic pressure). AutoRamp (ResMed) monitors flow signal for sleep onset indicators (regular breathing pattern, reduced tidal volume) before transitioning to full therapy. Usage time reported during the ramp period is typically excluded from compliance calculations because the pressure is subtherapeutic. When analyzing data, ramp periods may artificially inflate AHI if events occur before therapeutic pressure is reached.',
    relatedTerms: ['cpap', 'usage-hours'],
  },
  {
    id: 'epr',
    term: 'EPR (Expiratory Pressure Relief)',
    category: 'cpap-therapy',
    aliases: ['Expiratory Pressure Relief'],
    quick:
      'A ResMed comfort feature that reduces pressure during exhalation by 1–3 cmH₂O to make breathing out feel more natural.',
    standard:
      'EPR lowers the delivered pressure during the exhalation phase of each breath. Settings range from 1 to 3 cmH₂O of relief. At EPR 3, if your prescribed pressure is 12 cmH₂O, you inhale at 12 but exhale at 9. This makes therapy feel less like breathing against resistance. EPR can be set to full-time or ramp-only.',
    detailed:
      'EPR is ResMed\'s implementation of expiratory pressure relief (Philips uses "C-Flex" or "A-Flex"). It operates by reducing delivered pressure during the expiratory phase based on detected respiratory cycle. EPR settings: Off, 1 cmH₂O, 2 cmH₂O, or 3 cmH₂O. With APAP, EPR reduces pressure relative to the current auto-adjusted pressure. Setting EPR to 3 effectively creates a bilevel-like therapy with 3 cmH₂O of pressure support. Considerations: High EPR settings may reduce treatment efficacy in some patients if the expiratory pressure drops below the critical closing pressure. EPR is reflected in the pressure data as a cyclic variation in delivered pressure.',
    relatedTerms: ['cpap', 'epap', 'ipap'],
  },
  {
    id: 'epap',
    term: 'EPAP (Expiratory Positive Airway Pressure)',
    category: 'cpap-therapy',
    aliases: ['Expiratory Positive Airway Pressure'],
    quick: 'The lower pressure delivered during exhalation in bilevel (BiPAP) devices.',
    standard:
      'EPAP is the pressure delivered during exhalation when using a bilevel device. It serves the same function as CPAP — keeping the airway open — but at a lower, more comfortable pressure than during inhalation. EPAP must be high enough to prevent obstructive events during exhalation.',
    detailed:
      'EPAP is the primary therapeutic pressure for treating obstructive events in bilevel therapy. It must exceed the critical closing pressure (Pcrit) of the airway. Typical range: 4–20 cmH₂O. In ASV devices, EPAP may auto-adjust to maintain airway patency. The difference between IPAP and EPAP (pressure support) determines the degree of ventilatory augmentation. Higher EPAP may be needed in patients with higher BMI or positional dependence.',
    relatedTerms: ['ipap', 'bipap', 'epr'],
  },
  {
    id: 'ipap',
    term: 'IPAP (Inspiratory Positive Airway Pressure)',
    category: 'cpap-therapy',
    aliases: ['Inspiratory Positive Airway Pressure'],
    quick: 'The higher pressure delivered during inhalation in bilevel (BiPAP) devices.',
    standard:
      'IPAP is the pressure delivered during inhalation when using a bilevel device. It is higher than EPAP and provides additional breathing support by augmenting tidal volume. The difference between IPAP and EPAP (pressure support) determines how much extra breathing assistance the machine provides.',
    detailed:
      'IPAP provides airway patency plus ventilatory support. Pressure support (PS = IPAP − EPAP) augments tidal volume by an amount proportional to lung compliance. In spontaneous (S) mode, IPAP is triggered by patient inspiratory effort. In timed (T) mode, IPAP is delivered at a fixed rate. Typical IPAP range: 8–25 cmH₂O (max 30 in some devices). Higher IPAP is needed for patients with obesity hypoventilation, neuromuscular disease, or significant restrictive lung disease.',
    relatedTerms: ['epap', 'bipap'],
  },
  {
    id: 'mask-leak',
    term: 'Mask Leak',
    category: 'cpap-therapy',
    aliases: ['Leak Rate', 'Leak'],
    quick:
      'Air escaping around the mask seal, measured in liters per minute — high leak degrades therapy effectiveness.',
    standard:
      'Mask leak is the unintentional loss of air around the mask seal, measured in L/min. All masks have some intentional leak through exhalation ports (typically 20–30 L/min), which is by design and not counted as a problem; only leak beyond that intentional vent indicates a poor seal. ResMed flags sustained unintentional leak as a "large leak" at 24 L/min — a device/manufacturer red line, not an AASM clinical standard. High leak can cause the machine to under-detect events, deliver inadequate pressure, cause dry mouth, and disrupt sleep.',
    detailed:
      'CPAP machines measure total leak and subtract estimated intentional leak (from mask vent ports) to report unintentional leak. ResMed devices report the 95th percentile leak rate as a primary quality indicator. The 24 L/min "large leak" threshold is a ResMed device/manufacturer convention, not an AASM clinical standard, and it is mask-dependent: ResMed cites a higher figure (~36 L/min) for some full-face/oronasal masks whose intentional vent flow is larger. Within these limits, sustained unintentional leak above the device threshold degrades the scoring and pressure-control algorithms. Effects of high leak: reduced event detection accuracy (machine may miss apneas), pressure delivery instability (APAP algorithms may over-compensate), aerophagia risk, mask/eye irritation, noise. Common causes: incorrect mask size, worn cushions, mouth opening (chin strap or full-face mask may help), sleeping position.',
    uncertainty:
      'Leak below the threshold is well-characterised and reliable. Above it, leak is the single most insidious bias source in the dataset because it is systematic and shared: the device estimates patient flow by subtracting a modelled leak, so a leak-model error propagates into every flow-derived metric at once (tidal volume, minute ventilation, respiratory rate, the central/obstructive split, hypopnea detection) — those errors reinforce rather than cancel. The application uses a graduated, device-convention gate: a data-quality notice at the device large-leak red line (24 L/min) and a higher threshold (30 L/min) above which flow-derived metrics are flagged or suppressed, while the more leak-tolerant aggregate AHI count is kept usable. These figures are ResMed device/reporting conventions, not AASM clinical standards. Practically: when a night shows high leak, trust its pressure and usage but discount its flow-derived numbers.',
    relatedTerms: ['cpap', 'ahi'],
    references: [
      'ResMed. Unintentional leak is flagged as a large leak at 24 L/min (device/manufacturer convention; some oronasal masks use ~36 L/min). This is a device threshold, not an AASM clinical standard.',
    ],
  },
  {
    id: 'residual-ahi',
    term: 'Residual AHI',
    category: 'cpap-therapy',
    aliases: ['Treatment AHI', 'On-Therapy AHI'],
    quick:
      'The AHI while using CPAP therapy — represents how many events still occur despite treatment.',
    standard:
      'Residual AHI is the number of apneas and hypopneas per hour that persist while using CPAP. A well-treated patient typically has a residual AHI below 5. The residual AHI is the primary metric for assessing therapy effectiveness. It is lower than the diagnostic AHI because the CPAP is preventing most events.',
    detailed:
      'Residual AHI is calculated from device data as total machine-scored events divided by mask-on time. Important caveats: (1) Device algorithms score events from flow and pressure alone and cannot detect EEG arousals, so device-reported AHI may differ from manually scored polysomnography — sometimes substantially, and in either direction — depending on the device, its scoring algorithm, and the hypopnea rule applied; treat device events as a monitoring/screening signal, not a diagnostic substitute for PSG; (2) Residual AHI during subtherapeutic ramp periods should be excluded; (3) Leak-affected periods may have unreliable event scoring; (4) A sudden increase in residual AHI may indicate weight gain, positional changes, medication effects, or mask issues rather than failed therapy. Target: < 5.0 events/hr; optimal: < 2.0 events/hr.',
    formula:
      '\\text{Residual AHI} = \\frac{\\text{Machine-Scored Events}}{\\text{Mask-On Time (hours)}}',
    relatedTerms: ['ahi', 'cpap', 'compliance'],
    references: [
      'Kapur, V. K., Auckley, D. H., Chowdhuri, S., et al. (2017). Clinical Practice Guideline for Diagnostic Testing for Adult Obstructive Sleep Apnea: An AASM Clinical Practice Guideline. Journal of Clinical Sleep Medicine, 13(3), 479–504. DOI: 10.5664/jcsm.6506.',
      'Epstein, L. J., Kristo, D., Strollo, P. J., et al. (2009). Clinical guideline for the evaluation, management and long-term care of obstructive sleep apnea in adults. Journal of Clinical Sleep Medicine, 5(3), 263–276. — AASM severity classification, diagnostic thresholds, and treatment goals.',
    ],
  },
  {
    id: 'usage-hours',
    term: 'Usage Hours',
    category: 'cpap-therapy',
    aliases: ['Mask-On Time', 'Therapy Hours'],
    quick:
      'The total time the CPAP mask was worn during a sleep session, typically excluding ramp time.',
    standard:
      'Usage hours represent how long you actually wore the mask during a night. This is the primary measure of therapy adherence and is the denominator for AHI, ODI, and leak-duration metrics. CPAP Analyzer prefers the mask-on/mask-off intervals ResMed records in STR.edf; when those are unavailable it falls back to a hysteresis-based detector. The compliance target is ≥4 hours per night, though clinical benefits increase with longer use.',
    detailed:
      'How usage / mask-on time is determined: CPAP Analyzer uses, in order of preference, (1) the explicit mask-on and mask-off interval markers recorded by the machine in STR.edf, which most faithfully reflect what the device itself counted; and (2) when those markers are absent, an improved hysteresis detector that requires flow/pressure to cross an "on" threshold to start a usage interval and fall below a separate, lower "off" threshold to end it. Hysteresis (two thresholds rather than one) prevents a single instantaneous reading near the boundary from rapidly toggling mask-on/off and fragmenting the session — a limitation of the previous fixed 2 cmH₂O instantaneous threshold. Subtherapeutic ramp handling: time spent below therapeutic pressure during ramp is identified so it can be treated appropriately for compliance, which counts time at therapeutic pressure. Because usage time is the denominator for AHI, ODI, leak-duration, and the CMS 4-hour compliance test, these more accurate intervals can shift usage hours and dependent metrics slightly relative to older versions. Dose-response relationship: 4 hours/night provides ESS improvement; ≥6 hours provides cardiovascular benefit; ≥7 hours provides maximal neurocognitive improvement. Mean nightly usage in published studies: 4.5–5.5 hours for adherent patients.',
    relatedTerms: ['compliance', 'ramp-time'],
    references: [
      'Centers for Medicare & Medicaid Services. Local Coverage Determination L33718: Positive Airway Pressure (PAP) Devices for the Treatment of Obstructive Sleep Apnea. — Adherence defined as ≥4 h/night on ≥70% of nights over a consecutive 30-day period within the first 90 days.',
      'Weaver, T. E., Maislin, G., Dinges, D. F., et al. (2007). Relationship between hours of CPAP use and achieving normal levels of sleepiness and daily functioning. Sleep, 30(6), 711–719. DOI: 10.1093/sleep/30.6.711.',
    ],
  },

  {
    id: 'cai',
    term: 'CAI (Central Apnea Index)',
    category: 'cpap-therapy',
    aliases: ['Central Apnea Index'],
    quick:
      'The number of central apneas per hour of analyzed sleep — the central-event analog of AHI.',
    standard:
      'CAI counts only central apneas (events with absent airflow and absent respiratory effort) per hour of mask-on / analyzed time. It is the central-event subset of AHI. A CAI above 5/h is the conventional threshold for clinically meaningful central sleep apnea, and is the cutoff used in the Liu et al. (2017) TECSA trajectory classifier. On ResMed devices the central/obstructive distinction is made by forced oscillation technique (FOT) during apneas.',
    detailed:
      'CAI = total central apneas / hours of analyzed sleep. Central apneas are scored when ≥10 s of airflow cessation occurs without respiratory effort; on CPAP machines the classification rests on the airway response to a brief forced-oscillation perturbation during the apnea (open airway → central, closed airway → obstructive). Caveats: CAI computed from FOT is degraded under high mask leak, because the perturbation signal dissipates through the leak path; CPAP Analyzer down-weights or excludes high-leak nights from CAI-driven longitudinal analyses (notably TECSA classification). A persistent CAI > 5/h on therapy is the operational definition of treatment-emergent central sleep apnea in Liu et al. 2017 (Chest, DOI 10.1016/j.chest.2017.06.010).',
    formula: '\\text{CAI} = \\frac{\\text{Central Apneas}}{\\text{Hours of Analyzed Sleep}}',
    relatedTerms: ['central-apnea', 'csa', 'tecsa', 'ahi', 'fot'],
    references: [
      'Liu, D., Armitstead, J., Benjafield, A., et al. (2017). Trajectories of emergent central sleep apnea during continuous positive airway pressure therapy. Chest, 152(4), 751–760. DOI: 10.1016/j.chest.2017.06.010.',
    ],
  },
  {
    id: 'fot',
    term: 'FOT (Forced Oscillation Technique)',
    category: 'cpap-therapy',
    aliases: ['Forced Oscillation Technique'],
    quick:
      'A brief pressure oscillation applied during an apnea to test whether the airway is open (central) or closed (obstructive).',
    standard:
      "Forced oscillation technique applies a small, brief pressure perturbation through the mask during a scored apnea and measures the airway's response. An open airway transmits the oscillation freely (low impedance), implying a central apnea — the brain is not driving inspiration, but nothing is blocking it. A closed airway reflects the oscillation (high impedance), implying an obstructive apnea — the airway has collapsed. ResMed CPAP and APAP machines use FOT to label apneas as ClearAirway (central) vs. obstructive.",
    detailed:
      "ResMed's implementation emits a 4 Hz pressure oscillation during a scored apnea and measures the resulting flow response; the impedance ratio classifies the airway state. FOT is well established in respiratory mechanics and is what gives consumer CPAP machines a way to distinguish central from obstructive events without thoracoabdominal effort belts. Important limitations: FOT classification is degraded under high mask leak (the perturbation signal dissipates through the leak path before reaching the airway), so high-leak nights produce unreliable ClearAirway counts. CPAP Analyzer down-weights or excludes high-leak nights from CAI-driven longitudinal analyses (notably TECSA) for this reason. FOT does not detect partial obstruction (hypopneas); it is used only during full apneas.",
    relatedTerms: ['central-apnea', 'obstructive-apnea', 'cai', 'mask-leak'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
    ],
  },
  {
    id: 'hypoxic-burden',
    term: 'Hypoxic Burden',
    category: 'cpap-therapy',
    aliases: ['Sleep Apnea-Specific Hypoxic Burden'],
    quick:
      'The total area "under the curve" of event-related desaturations during sleep — combines frequency, depth, and duration of nocturnal hypoxemia in a single number.',
    standard:
      'Hypoxic burden integrates the area under each desaturation curve (depth × duration), summed across the night and normalized by sleep time. Unlike AHI or ODI, which count events, hypoxic burden captures how much oxygen exposure was actually lost. It is an emerging metric for sleep-apnea-related cardiovascular risk, with evidence that it predicts mortality more strongly than AHI in some cohorts (Azarbarzin et al. 2019, European Heart Journal).',
    detailed:
      'The sleep apnea-specific hypoxic burden is defined as the total area under the SpO₂ desaturation curve associated with respiratory events, expressed in %·min/h of sleep. Methodology: for each scored respiratory event, the event-related desaturation is identified and its area below baseline SpO₂ is integrated; the per-night sum is divided by sleep hours. Higher hypoxic burden indicates that events tend to be deeper or longer in their oxygen impact, not merely more frequent. Like other oximetry-derived metrics, hypoxic burden requires adequate SpO₂ coverage to be meaningful — interpret alongside the coverage % (see SpO₂ Coverage). CPAP Analyzer reports hypoxic burden for information; it does not diagnose.',
    relatedTerms: ['odi', 'spo2', 't90', 'desaturation', 'spo2-coverage'],
    references: [
      'Azarbarzin, A., Sands, S. A., Stone, K. L., et al. (2019). The hypoxic burden of sleep apnoea predicts cardiovascular disease-related mortality: the MrOS and Sleep Heart Health Study. European Heart Journal, 40(14), 1149–1157. DOI: 10.1093/eurheartj/ehy624.',
    ],
  },
  {
    id: 'tecsa',
    term: 'TECSA (Treatment-Emergent Central Sleep Apnea)',
    category: 'cpap-therapy',
    aliases: ['Treatment-Emergent Central Sleep Apnea', 'CompSA', 'Complex Sleep Apnea'],
    quick:
      'Central apneas that emerge once CPAP is started in a patient whose untreated disease was predominantly obstructive; often resolves on its own.',
    standard:
      'Treatment-emergent central sleep apnea (TECSA, also called complex sleep apnea or CompSA) describes the appearance of central apneas after CPAP initiation in a patient whose pre-treatment study was predominantly obstructive. The prevailing literature finds roughly 60–80% spontaneous resolution within ~3 months of continued CPAP as the respiratory control loop re-adapts (Nigam et al. 2016 systematic review; Kwok et al. 2022). The Liu et al. (2017) four-class trajectory model (obstructive / transient / persistent / emergent) distinguishes self-limiting TECSA from persistent or late-emerging central patterns.',
    detailed:
      'Operationally, TECSA is defined when the central apnea index (CAI) exceeds a threshold (commonly 5/h) on therapy, with prior obstructive disease. CPAP Analyzer implements the Liu et al. 2017 (Chest, DOI 10.1016/j.chest.2017.06.010) trajectory classifier longitudinally over nightly CAI: early-window CAI is compared to late-window CAI, both at the 5/h threshold, to assign one of four classes (obstructive stable, transient TECSA, persistent central, emergent central). High-leak nights are excluded because FOT-derived CAI is degraded under leak. The single most important clinical caveat: TECSA does not by itself justify a switch to adaptive servo-ventilation (ASV). The SERVE-HF randomized trial (Cowie et al. 2015) found increased mortality with ASV in symptomatic chronic heart failure with reduced ejection fraction (LVEF ≤ 45%) with predominantly central sleep apnea; on the strength of that trial, ASV is contraindicated in this group. Therapy-mode changes are clinician decisions informed by echocardiography and the full clinical picture, not by a software flag. CPAP Analyzer reports TECSA trajectory as a candidate finding for discussion; it does not diagnose.',
    relatedTerms: ['central-apnea', 'csa', 'cai', 'asv', 'loop-gain'],
    references: [
      'Liu, D., Armitstead, J., Benjafield, A., et al. (2017). Trajectories of emergent central sleep apnea during continuous positive airway pressure therapy. Chest, 152(4), 751–760. DOI: 10.1016/j.chest.2017.06.010.',
      'Nigam, G., Pathak, C., & Riaz, M. (2016). A systematic review on prevalence and risk factors associated with treatment-emergent central sleep apnea. Annals of Thoracic Medicine, 11(3), 202–210. DOI: 10.4103/1817-1737.185761.',
      'Cowie, M. R., Woehrle, H., Wegscheider, K., et al. (2015). Adaptive servo-ventilation for central sleep apnea in systolic heart failure (SERVE-HF). New England Journal of Medicine, 373(12), 1095–1105. DOI: 10.1056/NEJMoa1506459.',
    ],
  },
  {
    id: 'periodic-breathing',
    term: 'Periodic Breathing',
    category: 'cpap-therapy',
    aliases: ['PB'],
    quick:
      'A repeating cycle of waxing and waning ventilation during sleep, with or without central apneas at the cycle nadirs.',
    standard:
      'Periodic breathing (PB) is a repeating oscillation in tidal volume / minute ventilation during sleep — breath depth grows, then falls, then grows again, typically with a cycle length of 40–120 seconds. When the nadirs are deep enough to include central apneas and the envelope is clearly crescendo-decrescendo, the pattern qualifies as Cheyne-Stokes respiration (CSR). PB without those criteria is the broader category, common at altitude, in heart failure, on opioids, and in some neurological conditions. ResMed devices flag formal CSR but not sub-threshold PB; CPAP Analyzer surfaces both.',
    detailed:
      'PB arises from instability of the chemoreflex-driven control of ventilation — high loop gain combined with a long circulation delay produces oscillatory feedback that overshoots in both directions, with central apneas at the troughs when PaCO₂ falls below the apneic threshold. Single-channel airflow methods (Weinreich 2009, Javed 2018, Midelet 2023, Guyot 2020) can detect PB from the flow envelope alone; CPAP Analyzer combines AASM-style morphology rules with an autocorrelation-based periodicity check, a Guyot-style modulation index (0–1) for confidence, and a harmonic-ratio crescendo-decrescendo morphology score. Sub-threshold PB and short CSR runs that fall below the ResMed 15-minute device floor are surfaced as "candidate / below device threshold" rather than silently dropped or promoted to formal CSR flags. See the help article "Breathing Patterns: Periodic Breathing, Cheyne-Stokes & TECSA" for the full method.',
    relatedTerms: [
      'cheyne-stokes',
      'central-apnea',
      'csa',
      'tecsa',
      'loop-gain',
      'apneic-threshold',
      'modulation-index',
      'harmonic-ratio',
    ],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
      'Midelet, A., et al. (2023). Features of Cheyne-Stokes respiration automatically extracted from CPAP airflow signal raw data: identification of discriminating features to detect heart failure. Biomedical Signal Processing and Control. — Airflow-based CSR feature extraction; longer cycle length tracks reduced cardiac output.',
      'Guyot, P., Djermoune, E.-H., Chenuel, B., & Bastogne, T. (2020). A signal demodulation-based method for the early detection of Cheyne-Stokes respiration. PLoS ONE, 15(3), e0221191. DOI: 10.1371/journal.pone.0221191. — Continuous flow-modulation index as a confidence measure for periodic breathing.',
    ],
  },
  {
    id: 'loop-gain',
    term: 'Loop Gain',
    category: 'sleep-medicine',
    quick:
      'A measure of how strongly the respiratory control system responds to disturbances — high loop gain causes oscillatory, unstable breathing.',
    standard:
      'Loop gain is a control-systems quantity describing how strongly ventilation responds to a perturbation in blood-gas (typically CO₂). High loop gain means a small rise in CO₂ provokes a large ventilatory response, which overshoots, drops CO₂ below the apneic threshold, and produces a central apnea. The cycle repeats, producing periodic breathing or Cheyne-Stokes respiration. Heart failure, long circulation times, and chemoreflex hypersensitivity all raise loop gain.',
    detailed:
      'Loop gain is the product of plant gain (how strongly ventilation changes CO₂), feedback gain (chemoreflex sensitivity to CO₂ change), and mixing gain (efficiency of CO₂ transport from lung to chemoreceptor). Mathematically, $\\text{LG} = \\frac{\\text{ventilatory response}}{\\text{disturbance}}$; values above ~1 sustain oscillation. In heart failure, prolonged circulation time delays CO₂ feedback to central chemoreceptors, raising mixing gain and producing the characteristic long Cheyne-Stokes cycle length (60–90 s, roughly twice the lung-to-brain circulation time). CPAP Analyzer does not compute loop gain directly (no PSG signals), but the cycle length and modulation depth of detected periodic breathing episodes are observable proxies — longer cycles are consistent with higher mixing gain and reduced cardiac output (Midelet et al. 2023).',
    relatedTerms: [
      'periodic-breathing',
      'cheyne-stokes',
      'central-apnea',
      'apneic-threshold',
      'tecsa',
    ],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
      'Midelet, A., et al. (2023). Features of Cheyne-Stokes respiration automatically extracted from CPAP airflow signal raw data: identification of discriminating features to detect heart failure. Biomedical Signal Processing and Control. — Airflow-based CSR feature extraction; longer cycle length tracks reduced cardiac output.',
    ],
  },
  {
    id: 'apneic-threshold',
    term: 'Apneic Threshold',
    category: 'sleep-medicine',
    quick:
      'The level of arterial CO₂ below which the brainstem stops issuing inspiratory drive, producing a central apnea.',
    standard:
      'The apneic threshold is the PaCO₂ value below which respiratory drive ceases during sleep, producing a central apnea. It sits just below the eupneic (normal) PaCO₂. A ventilatory overshoot that drives PaCO₂ below this threshold is the immediate cause of central apneas in periodic breathing and Cheyne-Stokes respiration. Narrow CO₂ reserve (apneic threshold close to eupneic PaCO₂) makes a person more prone to unstable breathing.',
    detailed:
      'The CO₂ reserve = eupneic PaCO₂ − apneic threshold PaCO₂. A small reserve (a few mmHg) means a modest hyperventilation can cross the threshold and silence breathing; a large reserve is protective. The apneic threshold is lower in NREM sleep than wake and is one reason central apneas tend to appear at sleep onset and at sleep-stage transitions. It interacts with loop gain: high loop gain plus a narrow CO₂ reserve is the classic high-altitude / heart-failure / opioid pattern that generates periodic breathing. This concept underlies why hyperventilation (anxiety, sleep-onset transitions) can trigger a central apnea, and why hypercapnic drugs / supplemental CO₂ have been studied for high-loop-gain CSA.',
    relatedTerms: ['loop-gain', 'central-apnea', 'periodic-breathing', 'cheyne-stokes'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
    ],
  },
  {
    id: 'modulation-index',
    term: 'Modulation Index',
    category: 'statistics',
    quick:
      'A 0–1 score for how strongly a signal oscillates relative to its mean — used to score periodic breathing confidence from the airflow envelope.',
    standard:
      'The modulation index quantifies the amplitude of an oscillation relative to the baseline level of the signal it modulates. Values near 0 indicate an essentially flat envelope; values near 1 indicate a deeply modulated cyclic envelope. CPAP Analyzer uses a Guyot-style modulation index on the airflow / minute-ventilation envelope as the continuous confidence basis for periodic breathing detection (Guyot et al. 2020).',
    detailed:
      'For a periodic envelope with peaks $p_i$ and troughs $t_i$, a common form is $\\text{MI} = \\frac{p - t}{p + t}$, evaluated on the smoothed envelope of the airflow signal. Values near 0 indicate a steady envelope; values approaching 1 indicate near-complete modulation (deep troughs, often coinciding with central apneas). The modulation index is robust to slow drift in baseline ventilation and is dimensionless, which is why it is preferred over raw amplitude for cross-night and cross-subject comparison. In CPAP Analyzer, MI is one of three inputs to the periodic-breathing confidence score; the others are the autocorrelation-based periodicity peak in the 40–120 s band and the harmonic-ratio crescendo-decrescendo morphology score. Higher MI indicates a more confidently periodic envelope, not a more severe disease — interpret confidence and severity separately.',
    relatedTerms: ['periodic-breathing', 'cheyne-stokes', 'harmonic-ratio', 'correlation'],
    references: [
      'Guyot, P., Djermoune, E.-H., Chenuel, B., & Bastogne, T. (2020). A signal demodulation-based method for the early detection of Cheyne-Stokes respiration. PLoS ONE, 15(3), e0221191. DOI: 10.1371/journal.pone.0221191. — Continuous flow-modulation index as a confidence measure for periodic breathing.',
    ],
  },
  {
    id: 'harmonic-ratio',
    term: 'Harmonic Ratio',
    category: 'statistics',
    quick:
      'The fraction of in-band spectral energy concentrated at the fundamental cycle frequency — a measure of how "shape-like" a sinusoid an oscillation is.',
    standard:
      'The harmonic ratio is the fraction of in-band spectral energy concentrated at the fundamental frequency of a periodic signal, $\\text{HR} = E_{\\text{fundamental}} / E_{\\text{in-band total}}$. A pure sinusoid scores near 1; a noisy or non-sinusoidal cyclic signal scores lower. CPAP Analyzer uses it as a crescendo-decrescendo morphology score on the airflow envelope: CSR-shaped cycles are nearly sinusoidal at their fundamental and score high, separating CSR from generic oscillations.',
    detailed:
      'After estimating the dominant cycle frequency $f_0$ in the 40–120 s band by autocorrelation, the harmonic ratio is computed as the ratio of spectral energy in a narrow band around $f_0$ to the total spectral energy across the in-band region. It complements the modulation index: MI measures how *deep* the modulation is; HR measures how *clean* the modulation shape is. A high MI with a low HR indicates a strongly modulated but irregular envelope (could be arousal, leak, or noise); a high MI with a high HR is consistent with crescendo-decrescendo CSR morphology. The combined score is what drives the CPAP Analyzer CSR-vs-PB distinction and the per-episode confidence.',
    formula: '\\text{HR} = \\frac{E_{\\text{fundamental}}}{E_{\\text{in-band total}}}',
    relatedTerms: ['modulation-index', 'periodic-breathing', 'cheyne-stokes'],
    references: [
      'Javed, F., Fox, N., & Armitstead, J. (2018). ResCSRF: algorithm to automatically extract Cheyne-Stokes respiration features from respiratory signals. IEEE Transactions on Biomedical Engineering, 65(3), 669–677. DOI: 10.1109/TBME.2017.2712102.',
    ],
  },

  // ─── SLEEP MEDICINE ─────────────────────────────────────────────────

  {
    id: 'sleep-apnea',
    term: 'Sleep Apnea',
    category: 'sleep-medicine',
    aliases: ['Sleep Apnoea'],
    quick: 'A disorder in which breathing repeatedly stops and starts during sleep.',
    standard:
      'Sleep apnea is a sleep disorder characterized by repeated interruptions in breathing during sleep. The most common form is obstructive sleep apnea (OSA), where the airway physically collapses. Central sleep apnea (CSA) involves a failure of respiratory drive. Diagnosis requires a sleep study, and treatment typically involves CPAP therapy.',
    detailed:
      'Sleep apnea is diagnosed via polysomnography (PSG) or home sleep testing (HST). Prevalence estimates: 10–30% of adults have OSA (higher with obesity). The Wisconsin Sleep Cohort study found moderate-severe OSA in 13% of men and 6% of women (30–70 years). Untreated OSA is associated with increased risk of hypertension, atrial fibrillation, stroke, coronary artery disease, type 2 diabetes, motor vehicle accidents, and all-cause mortality. The Apnea-Hypopnea Index (AHI) is the primary diagnostic metric. Treatment modalities include CPAP, oral appliances, positional therapy, surgery (UPPP, MMA, hypoglossal nerve stimulation), and weight loss.',
    relatedTerms: ['osa', 'csa', 'ahi', 'cpap'],
    references: [
      'Epstein, L. J., Kristo, D., Strollo, P. J., et al. (2009). Clinical guideline for the evaluation, management and long-term care of obstructive sleep apnea in adults. Journal of Clinical Sleep Medicine, 5(3), 263–276. — AASM severity classification, diagnostic thresholds, and treatment goals.',
    ],
  },
  {
    id: 'osa',
    term: 'OSA (Obstructive Sleep Apnea)',
    category: 'sleep-medicine',
    aliases: ['Obstructive Sleep Apnea', 'Obstructive Sleep Apnoea'],
    quick:
      'The most common form of sleep apnea, caused by physical collapse of the upper airway during sleep.',
    standard:
      'Obstructive sleep apnea (OSA) occurs when the muscles of the upper airway relax during sleep, causing repeated airway collapses. Symptoms include snoring, witnessed apneas, gasping/choking during sleep, excessive daytime sleepiness, and morning headaches. OSA is diagnosed when AHI ≥ 5 with symptoms or AHI ≥ 15 regardless of symptoms.',
    detailed:
      'OSA pathophysiology involves the balance between anatomical airway size, negative intraluminal pressure during inspiration, and neuromuscular compensation during wakefulness. During sleep, reduced muscle tone tips the balance toward collapse. Risk factors: obesity (strongest modifiable factor), male sex, age > 50, neck circumference > 17 inches (men) / > 16 inches (women), retrognathia, macroglossia, nasal obstruction, alcohol, sedatives. Diagnosis per AASM (ICSD-3): AHI ≥ 5 + symptoms OR AHI ≥ 15 regardless of symptoms. Severity: Mild (5–14), Moderate (15–29), Severe (≥ 30).',
    relatedTerms: ['sleep-apnea', 'ahi', 'cpap', 'obstructive-apnea'],
    references: [
      'Epstein, L. J., Kristo, D., Strollo, P. J., et al. (2009). Clinical guideline for the evaluation, management and long-term care of obstructive sleep apnea in adults. Journal of Clinical Sleep Medicine, 5(3), 263–276. — AASM severity classification, diagnostic thresholds, and treatment goals.',
    ],
  },
  {
    id: 'csa',
    term: 'CSA (Central Sleep Apnea)',
    category: 'sleep-medicine',
    aliases: ['Central Sleep Apnea', 'Central Sleep Apnoea'],
    quick:
      'A form of sleep apnea caused by the brain failing to signal breathing muscles, rather than airway obstruction.',
    standard:
      'Central sleep apnea (CSA) is characterized by repeated cessation of airflow during sleep due to absent or diminished respiratory effort. Unlike OSA, the airway remains open — the brain simply does not send the signal to breathe. CSA may be idiopathic, related to heart failure, opioid use, or emerge during CPAP therapy (treatment-emergent central apnea).',
    detailed:
      'CSA types (ICSD-3): (1) CSA with Cheyne-Stokes breathing (most common, typically with heart failure); (2) CSA due to medical disorder; (3) CSA due to high-altitude periodic breathing; (4) CSA due to medication or substance (opioids); (5) Primary/idiopathic CSA; (6) Treatment-emergent CSA (CompSA — central events that appear on CPAP). Pathophysiology involves ventilatory control instability — the loop gain is high, meaning small changes in PaCO₂ cause large ventilatory responses. Diagnosis: Central apnea index > 5/hr with > 50% of events being central. Treatment: Address underlying cause; ASV for idiopathic/treatment-emergent CSA (contraindicated in HFrEF).',
    relatedTerms: ['sleep-apnea', 'central-apnea', 'cheyne-stokes', 'asv'],
    references: [
      'Liu, D., Armitstead, J., Benjafield, A., et al. (2017). Trajectories of emergent central sleep apnea during continuous positive airway pressure therapy. Chest, 152(4), 751–760. DOI: 10.1016/j.chest.2017.06.010.',
    ],
  },
  {
    id: 'odi',
    term: 'ODI (Oxygen Desaturation Index)',
    category: 'sleep-medicine',
    aliases: ['Oxygen Desaturation Index'],
    quick:
      'The number of times per hour that blood oxygen falls ≥3% below a rolling baseline during sleep.',
    standard:
      'ODI measures how frequently oxygen levels dip during sleep. CPAP Analyzer scores a desaturation as a discrete event — a fall of ≥3% in SpO₂ below a rolling baseline, sustained for at least 10 seconds (the AASM 3% desaturation rule) — counts each event once, then divides by the hours of valid oximetry. A 4% ODI is an alternative convention used elsewhere (for example, the Medicare hypopnea/desaturation rule), but CPAP Analyzer computes the 3% ODI. ODI correlates with AHI but specifically captures the physiological impact of breathing events — events that cause significant desaturation are more clinically concerning than those without.',
    detailed:
      'ODI is the number of discrete desaturation events per hour of valid oximetry. CPAP Analyzer detects an event when SpO₂ falls ≥3% below a rolling baseline — the recent local maximum / running reference saturation — for ≥10 seconds, and counts that excursion exactly once (a single prolonged dip is one event, not many). This is the AASM 3% desaturation rule. The denominator excludes periods with no oximetry signal, so dropouts do not deflate the rate. (Earlier versions counted per-sample drops, which inflated ODI and is not clinically valid; the event-based definition here is the correct one.) Two desaturation thresholds are seen in the literature: the 3% rule (more sensitive, aligns with the AASM hypopnea definition) and a 4% rule (more specific, aligns with the Medicare hypopnea/desaturation rule). CPAP Analyzer computes only the 3% ODI; the 4% variant is noted for context and is not a selectable option. ODI may diverge from AHI when: (1) many events cause arousal without desaturation (ODI < AHI); (2) oxygen stores are depleted in REM/supine position causing desaturations from minor events (ODI > AHI). ODI is a stronger predictor of cardiovascular outcomes than AHI in some studies (Wisconsin Cohort, SHHS). Requires integrated or paired pulse oximetry; without oximetry data, ODI is not reported.',
    formula:
      '\\text{ODI} = \\frac{\\text{Desaturation Events } (\\geq 3\\%,\\, \\geq 10\\text{s})}{\\text{Hours of Valid Oximetry}}',
    uncertainty:
      'ODI inherits the uncertainty of the oximeter it is computed from. A consumer wrist or ring sensor (uncalibrated reflectance, wellness-grade) is much less precise than a dedicated/cleared pulse oximeter, and the ≈3% measurement spread of any pulse oximeter sits right at the size of the 3% desaturation criterion — so borderline dips flip in and out of being counted. ODI is also only meaningful over the time the sensor actually had a valid signal: always read it next to the oximetry coverage %, since a low ODI computed over a few minutes of signal is not reassuring. Read the multi-night pattern rather than a single night, and discuss persistent findings with your clinician.',
    relatedTerms: ['spo2', 'desaturation', 'ahi', 'spo2-coverage', 't90'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
      'Azarbarzin, A., Sands, S. A., Stone, K. L., et al. (2019). The hypoxic burden of sleep apnoea predicts cardiovascular disease-related mortality: the MrOS and Sleep Heart Health Study. European Heart Journal, 40(14), 1149–1157. DOI: 10.1093/eurheartj/ehy624.',
    ],
  },
  {
    id: 'spo2',
    term: 'SpO₂ (Peripheral Oxygen Saturation)',
    category: 'sleep-medicine',
    aliases: ['SpO2', 'Oxygen Saturation', 'Pulse Oximetry'],
    quick:
      'A measurement of blood oxygen levels (percentage), typically 95–100% in healthy individuals.',
    standard:
      'SpO₂ measures the percentage of hemoglobin in your blood that is carrying oxygen, measured non-invasively by pulse oximetry. Normal resting SpO₂ is 95–100%. During sleep apnea events, SpO₂ drops (desaturates) as oxygen is consumed without being replenished. Significant desaturation is generally defined as SpO₂ < 90%.',
    detailed:
      'SpO₂ is measured by pulse oximetry using differential light absorption at two wavelengths (660nm red, 940nm infrared). Normal: 95–100%. Mild desaturation: 90–94%. Moderate desaturation: 80–89%. Severe desaturation: < 80%. In sleep apnea, the pattern of cyclic desaturation-reoxygenation (intermittent hypoxia) causes oxidative stress and is implicated in cardiovascular, metabolic, and neurocognitive morbidity. Key metrics: mean SpO₂, minimum SpO₂, time below 90% (T90, time-based with oximetry dropouts excluded), oxygen desaturation index (ODI), and oximetry coverage % (the fraction of analyzed time with a valid SpO₂ signal). Coverage should be reviewed first: low coverage means the other SpO₂ statistics rest on little data. Measurement artifacts: motion, poor perfusion, dark nail polish, skin pigmentation may cause inaccurate readings. Some CPAP machines include integrated oximetry; external oximeters can be paired via Bluetooth.',
    uncertainty:
      'How much to trust an SpO₂ reading depends heavily on the device. A dedicated/cleared pulse oximeter (finger transmissive, e.g. Nonin/Masimo, or a calibrated ring) is a moderate-reliability measurement with an accuracy of roughly 2% (A_RMS) — so sub-percent digits are noise, and a residual bias related to skin pigmentation is documented. A consumer wrist or ring SpO₂ is an uncalibrated, wellness-only estimate (reflectance optics, motion- and perfusion-sensitive, with pigment-related overestimation) and should be read as a trend, not a clinical value. Either way, interpret SpO₂ statistics alongside the oximetry coverage %: a striking minimum or T90 computed over only a few minutes of valid signal is unreliable. This tool reports oxygen statistics descriptively and does not diagnose.',
    relatedTerms: ['odi', 'desaturation', 't90', 'spo2-coverage'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
    ],
  },
  {
    id: 't90',
    term: 'T90 (Time Below 90% SpO₂)',
    category: 'sleep-medicine',
    aliases: ['Time Below 90%', 'TST90', 'T90%'],
    quick:
      'The percentage of analyzed time spent with blood oxygen saturation below 90%, excluding oximetry dropouts.',
    standard:
      'T90 is the proportion of analyzed time during which SpO₂ is below 90%. CPAP Analyzer computes it on a time basis — integrating the duration spent below the 90% threshold and dividing by the total valid-oximetry time — rather than as a count of samples. Periods with no oximetry signal are excluded from both the numerator and the denominator, so dropouts neither inflate nor deflate the figure. Elevated T90 indicates a substantial nocturnal hypoxic burden and warrants attention.',
    detailed:
      'T90 (also written TST90, "time below 90% as a percentage of sleep/analyzed time") = (time with SpO₂ < 90%) / (total valid-oximetry time) × 100%. Reporting it as a percentage of *valid* time, with oximetry-dropout intervals removed, avoids the bias that arises when a sensor disconnect is silently treated as either 0% or as normal saturation. T90 is one component of the nocturnal hypoxemia profile alongside mean SpO₂, minimum (nadir) SpO₂, ODI, and the emerging "hypoxic burden" (area under the desaturation curve). Higher T90 has been associated in cohort studies with hypertension, atrial fibrillation, and adverse cardiovascular outcomes. Always interpret T90 together with the oximetry coverage % — a low T90 computed over only a few minutes of valid signal is not reassuring. This tool reports T90 for information and does not diagnose.',
    formula:
      'T90 = \\frac{t_{\\,\\text{SpO}_2 < 90\\%}}{t_{\\,\\text{valid oximetry}}} \\times 100\\%',
    relatedTerms: ['spo2', 'desaturation', 'odi', 'spo2-coverage'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
      'Azarbarzin, A., Sands, S. A., Stone, K. L., et al. (2019). The hypoxic burden of sleep apnoea predicts cardiovascular disease-related mortality: the MrOS and Sleep Heart Health Study. European Heart Journal, 40(14), 1149–1157. DOI: 10.1093/eurheartj/ehy624.',
    ],
  },
  {
    id: 'spo2-coverage',
    term: 'SpO₂ Coverage (Oximetry Coverage %)',
    category: 'sleep-medicine',
    aliases: ['Oximetry Coverage', 'SpO2 Coverage'],
    quick:
      'The fraction of analyzed time that has a valid pulse-oximetry signal — a data-quality denominator for all SpO₂ statistics.',
    standard:
      'SpO₂ coverage is the percentage of the analyzed period during which a usable oximetry reading was present (sensor attached, adequate perfusion, no dropout). It is a data-quality indicator, not a clinical measure of breathing: it tells you how much of the night the oxygen statistics are actually based on. Mean SpO₂, minimum SpO₂, T90, and ODI are all computed over valid-oximetry time only, so low coverage means those numbers summarize a small, possibly unrepresentative slice of the night.',
    detailed:
      'Coverage % = (duration with a valid SpO₂ sample) / (total analyzed duration) × 100%. Causes of low coverage include the oximeter not being worn, sensor disconnection, motion artifact, poor peripheral perfusion, and Bluetooth pairing gaps for external oximeters. CPAP Analyzer surfaces coverage explicitly so derived SpO₂ metrics can be read in context: a nadir of 84% over 95% coverage is far more informative than the same nadir over 8% coverage. As a rough rule of thumb, treat oxygen statistics with caution when coverage is low (e.g., well under ~50–70% of the session), and prefer nights with high coverage when comparing trends. Coverage is a transparency metric — it does not by itself indicate any clinical condition.',
    formula:
      '\\text{Coverage} = \\frac{t_{\\,\\text{valid oximetry}}}{t_{\\,\\text{analyzed}}} \\times 100\\%',
    relatedTerms: ['spo2', 't90', 'odi'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
    ],
  },
  {
    id: 'desaturation',
    term: 'Desaturation',
    category: 'sleep-medicine',
    aliases: ['Oxygen Desaturation', 'Desat'],
    quick:
      'A drop in blood oxygen level, typically by ≥3% from baseline, during or after a breathing event.',
    standard:
      'Desaturation refers to a decrease in blood oxygen saturation (SpO₂). In sleep medicine, a desaturation event is a drop of ≥3% (AASM standard) or ≥4% (Medicare/alternative definition) from baseline. Desaturations are caused by apneas and hypopneas — when breathing stops or decreases, oxygen in the blood falls until breathing resumes.',
    detailed:
      'Desaturation kinetics depend on: baseline SpO₂ (patients starting at 95% reach 90% faster than those at 98%), FRC (functional residual capacity — lung oxygen reservoir), metabolic rate, cardiac output, and body position. The delay between event onset and SpO₂ nadir is typically 15–30 seconds due to circulation time. Depth and duration of desaturation correlate with cardiovascular morbidity more strongly than event count alone. Nadir SpO₂ during the study is a predictor of incident atrial fibrillation and hypertension. Hypoxic burden (area under the desaturation curve) is an emerging metric that captures both frequency and depth of desaturations.',
    relatedTerms: ['spo2', 'odi', 'hypopnea'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
    ],
  },
  {
    id: 'arousal',
    term: 'Arousal',
    category: 'sleep-medicine',
    quick:
      'A brief awakening (≥3 seconds) from sleep, often caused by a breathing event, that fragments sleep quality.',
    standard:
      'An arousal is a brief shift from deeper to lighter sleep or to wakefulness, lasting at least 3 seconds, preceded by at least 10 seconds of stable sleep. Arousals caused by breathing events (respiratory arousals) fragment sleep and prevent the restorative deep sleep stages. The arousal index (arousals per hour) correlates with daytime sleepiness.',
    detailed:
      "AASM definition: an abrupt shift in EEG frequency lasting ≥3 seconds, preceded by ≥10 seconds of stable sleep. In REM sleep, a concurrent increase in chin EMG is required. Arousals are the brain's defense mechanism against hypoxia — they restore airway muscle tone and terminate events. However, frequent arousals prevent progression through normal sleep architecture (N1→N2→N3→REM). Arousal index > 25/hr is associated with significant sleepiness. CPAP machines cannot directly measure arousals (requires EEG), but indirect markers include pressure oscillations from movement and sudden changes in flow pattern.",
    relatedTerms: ['sleep-fragmentation', 'rera', 'sleep-stage', 'cvhr'],
  },
  {
    id: 'sleep-fragmentation',
    term: 'Sleep Fragmentation',
    category: 'sleep-medicine',
    quick:
      'Disruption of normal sleep architecture by frequent arousals, leading to non-restorative sleep.',
    standard:
      'Sleep fragmentation describes the breakdown of the normal sleep cycle — repeated arousals interrupt the progression through light sleep, deep sleep, and REM sleep. Even if total sleep time is adequate, fragmented sleep is less restorative. Sleep fragmentation is a major consequence of untreated sleep apnea and a primary cause of excessive daytime sleepiness.',
    detailed:
      'Normal sleep progresses through 90-minute cycles: N1 (light) → N2 (intermediate) → N3 (deep/slow-wave) → REM. Fragmentation prevents adequate time in N3 (restorative, growth hormone release) and REM (memory consolidation). Metrics: arousal index, sleep efficiency (time asleep / time in bed), number of stage transitions, WASO (wake after sleep onset). CPAP treatment reduces fragmentation by eliminating event-related arousals. Persistent fragmentation despite CPAP may indicate: suboptimal pressure, mask discomfort, nocturia, periodic limb movements, or primary insomnia.',
    relatedTerms: ['arousal', 'sleep-apnea', 'sleep-cycle', 'sleep-stage'],
  },
  {
    id: 'cheyne-stokes',
    term: 'Cheyne-Stokes Respiration',
    category: 'sleep-medicine',
    aliases: ['CSR', 'Cheyne-Stokes Breathing'],
    quick:
      'A crescendo-decrescendo breathing pattern with central apneas, commonly associated with heart failure.',
    standard:
      'Cheyne-Stokes respiration is a distinctive breathing pattern where breath depth and rate gradually increase (crescendo), then decrease (decrescendo), followed by a central apnea. This cycle repeats with a period of 40–120 seconds (typically 45–90 seconds). It is most commonly caused by congestive heart failure but can occur with stroke or other neurological conditions. Treatment involves addressing the underlying cardiac condition and potentially using ASV.',
    detailed:
      'CSR results from high loop gain in the ventilatory control system. In heart failure, prolonged circulation time delays CO₂ feedback to chemoreceptors, causing oscillatory ventilatory control. Cycle length = 2 × circulation time, typically 40–120 seconds (most often 45–90 seconds), so longer cycles track reduced cardiac output. PaCO₂ oscillates around the apneic threshold. Diagnosis: ≥3 consecutive cycles of crescendo-decrescendo tidal volume with cycle length ≥ 40 seconds, and central AHI ≥ 5/hr. Prevalence in systolic heart failure: 30–50%. Treatment: optimize cardiac function (diuretics, ACE inhibitors, CRT); supplemental oxygen; ASV (CONTRAINDICATED if LVEF ≤ 45% per SERVE-HF trial). CPAP may partially treat CSR but is less effective than ASV.',
    relatedTerms: ['central-apnea', 'csa', 'asv'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
      'Javed, F., Fox, N., & Armitstead, J. (2018). ResCSRF: algorithm to automatically extract Cheyne-Stokes respiration features from respiratory signals. IEEE Transactions on Biomedical Engineering, 65(3), 669–677. DOI: 10.1109/TBME.2017.2712102.',
      'Cowie, M. R., Woehrle, H., Wegscheider, K., et al. (2015). Adaptive servo-ventilation for central sleep apnea in systolic heart failure (SERVE-HF). New England Journal of Medicine, 373(12), 1095–1105. DOI: 10.1056/NEJMoa1506459.',
    ],
  },
  {
    id: 'flow-limitation',
    term: 'Flow Limitation',
    category: 'sleep-medicine',
    quick:
      'Flattening of the inspiratory airflow waveform indicating partial airway narrowing without complete obstruction.',
    standard:
      'Flow limitation occurs when the airway partially narrows, restricting airflow even with increasing respiratory effort. It appears as a flattened or "plateau" shape on the inspiratory flow waveform. Flow limitation precedes obstructive events and is used by APAP machines to preemptively increase pressure before full obstruction occurs.',
    detailed:
      'Flow limitation is detected by analyzing the shape of the inspiratory flow-time curve. Normal breathing shows a sinusoidal pattern; flow limitation shows characteristic flattening. Quantified by the flattening index (ratio of peak inspiratory flow to flow at mid-inspiration). Starling resistor model: the collapsible segment of the upper airway limits flow once intraluminal pressure falls below the critical closing pressure (Pcrit). Progressive flow limitation → snoring → hypopnea → apnea represents a continuum. APAP algorithms use flow limitation as an early indicator to increase pressure proactively, preventing events before they occur.',
    uncertainty:
      'The flow-limitation index is a shape-derived, proprietary metric with no public ground-truth validation, which makes it a low-precision estimate: there is no agreed scale, the algorithm is manufacturer-specific, and leak distorts the very waveform morphology it reads (leak transients can mimic flattening). Use it as a relative, within-your-own-data trend — for example "more flattening since I changed masks" — rather than an absolute or cross-device number, and bring a persistent pattern to your clinician.',
    relatedTerms: ['rera', 'uars', 'apap'],
  },
  {
    id: 'uars',
    term: 'UARS (Upper Airway Resistance Syndrome)',
    category: 'sleep-medicine',
    aliases: ['Upper Airway Resistance Syndrome'],
    quick:
      'A condition characterized by flow limitation and arousals without frank apneas or hypopneas, causing unrefreshing sleep.',
    standard:
      'UARS is a form of sleep-disordered breathing where increased airway resistance causes respiratory effort-related arousals (RERAs) and sleep fragmentation, but without enough airflow reduction to score as apneas or hypopneas. Patients have a normal AHI but elevated RDI and report significant daytime sleepiness. UARS responds to CPAP therapy.',
    detailed:
      'UARS was first described by Guilleminault et al. (1993). It exists on the spectrum between primary snoring and OSA. Patients typically are younger, leaner, and more often female than classic OSA patients. Diagnosis requires esophageal pressure monitoring or pneumotachographic flow measurement to detect increasing inspiratory effort. Standard PSG may miss UARS if only scoring AHI. Respiratory Disturbance Index (RDI = AHI + RERA index) captures UARS. Some authors consider UARS a mild variant of OSA; others view it as a distinct entity. Treatment: CPAP (low pressures usually sufficient), oral appliances, nasal surgery for anatomical obstruction.',
    relatedTerms: ['rera', 'flow-limitation', 'osa'],
    references: [
      'Guilleminault, C., Stoohs, R., Clerk, A., Cetel, M., & Maistros, P. (1993). A cause of excessive daytime sleepiness: the upper airway resistance syndrome. Chest, 104(3), 781–787. DOI: 10.1378/chest.104.3.781.',
    ],
  },

  {
    id: 'sleep-stage',
    term: 'Sleep Stage',
    category: 'sleep-medicine',
    aliases: ['Sleep Stages', 'Sleep Architecture', 'Hypnogram'],
    quick:
      'A category of sleep — Wake, REM, or non-REM (light N1/N2, deep N3) — assigned to each epoch of the night.',
    standard:
      'Sleep is not uniform: across the night the brain cycles through distinct stages, conventionally Wake, REM (rapid eye movement) sleep, and non-REM sleep, the latter split into light sleep (stages N1 and N2) and deep / slow-wave sleep (stage N3). The sequence of stages over the night, plotted as a step graph, is called a hypnogram. Stages differ physiologically in ways that matter for sleep apnea — REM sleep relaxes the airway-dilating muscles (REM atonia), so obstructive events are often longer and more frequent in REM, while deep N3 sleep tends to be the most stable. CPAP machines cannot stage sleep; the stages CPAP Analyzer displays come from an imported wearable (Fitbit / Google Health), which infers them from heart rate, movement, and respiration rather than from the EEG a sleep study uses.',
    detailed:
      "In the gold-standard polysomnography (PSG) staging of the AASM Manual (Berry et al. 2012), sleep is scored in 30-second epochs from the electroencephalogram (EEG), electrooculogram (EOG), and chin electromyogram (EMG) into Wake, N1, N2, N3, and REM. N1 is the lightest transitional sleep; N2 is the bulk of a normal night and is marked by sleep spindles and K-complexes; N3 (slow-wave / deep sleep) is dominated by high-amplitude delta activity and is the most restorative and arousal-resistant stage; REM is characterized by EEG desynchronization, rapid eye movements, dreaming, and near-complete skeletal-muscle atonia. CPAP Analyzer maps the wearable's categories onto a four-level ribbon — Wake, REM, Light (= N1 + N2 combined, because consumer wearables rarely separate N1 from N2), and Deep (= N3). Crucially, a consumer wearable does not measure the EEG: it estimates stages from photoplethysmographic heart rate, heart-rate variability, accelerometry, and sometimes respiration. Independent validation finds that such devices classify sleep-versus-wake reasonably but stage classification only moderately, with the largest errors in N1/N3 discrimination and degraded performance in people with sleep-disordered breathing. Treat the wearable hypnogram as an approximate context layer for locating events in the night, not as a clinical-grade staging. CPAP Analyzer reports stage-aligned analyses for information only and does not diagnose.",
    uncertainty:
      'Wearable sleep staging is a modeled inference, not a measurement. Without EEG/EOG/EMG the device cannot truly score N1/N2/N3/REM; it predicts them from heart rate, its variability, and motion. Epoch-by-epoch agreement with polysomnography is moderate at best and is worse for the deep (N3) and light-transition (N1) boundaries and in patients with OSA — the exact minutes in each stage, and the precise placement of stage boundaries, should be read loosely. The pattern (for example, "events cluster in the REM-labelled stretches near morning") is more trustworthy than any single epoch\'s label. Read stage-aligned numbers as hypothesis-generating and discuss findings with your clinician.',
    relatedTerms: [
      'rem-sleep',
      'sleep-cycle',
      'arousal',
      'sleep-fragmentation',
      'rem-predominant-osa',
    ],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172. — AASM epoch-based stage definitions (Wake, N1, N2, N3, REM).',
    ],
  },
  {
    id: 'rem-sleep',
    term: 'REM Sleep',
    category: 'sleep-medicine',
    aliases: ['Rapid Eye Movement Sleep', 'REM'],
    quick:
      'The dreaming stage of sleep, marked by rapid eye movements and muscle atonia, during which obstructive apneas are often worse.',
    standard:
      'REM (rapid eye movement) sleep is the stage of vivid dreaming, characterized by a desynchronized EEG, darting eye movements, and a near-complete loss of skeletal-muscle tone (REM atonia). That atonia extends to the muscles that hold the upper airway open, so obstructive apneas and hypopneas in REM tend to be longer and to cause deeper desaturations than in non-REM sleep. REM periods are short early in the night and lengthen toward morning, which is why a person whose events concentrate in REM often has the worst breathing in the second half of the night. When the apnea–hypopnea index is much higher in REM than in non-REM, the pattern is called REM-predominant (or REM-related) OSA.',
    detailed:
      'REM sleep recurs roughly every 90 minutes in the normal ultradian rhythm, with each successive REM episode generally longer than the last — so total REM is back-loaded into the final third of the night (Feinberg & Floyd 1979). Physiologically, REM combines suppressed upper-airway dilator-muscle activity, blunted ventilatory responses to hypoxia and hypercapnia, and irregular breathing; the supine posture common in late sleep compounds airway collapsibility (supine-REM is the classic "worst case" for OSA). REM-related event worsening is the basis for the AHI_REM / AHI_NREM comparison and for the literature definitions of REM-predominant OSA (Conwell 2012; Koo 2008; Mokhlesi & Punjabi 2012). In CPAP Analyzer, REM is one of the four wearable hypnogram levels (Wake / REM / Light / Deep); because the stage labels come from a consumer wearable rather than EEG, the REM boundaries are approximate — read the REM-vs-NREM contrast as a trend across nights, not a single-night verdict. CPAP Analyzer reports these analyses descriptively and does not diagnose.',
    relatedTerms: ['sleep-stage', 'sleep-cycle', 'rem-predominant-osa', 'cvhr', 'ahi'],
    references: [
      'Berry, R. B., Budhiraja, R., Gottlieb, D. J., et al. (2012). Rules for scoring respiratory events in sleep: update of the 2007 AASM Manual for the Scoring of Sleep and Associated Events. Journal of Clinical Sleep Medicine, 8(5), 597–619. DOI: 10.5664/jcsm.2172.',
      'Feinberg, I., & Floyd, T. C. (1979). Systematic trends across the night in human sleep cycles. Psychophysiology, 16(3), 283–291. DOI: 10.1111/j.1469-8986.1979.tb02991.x. — REM episodes lengthen across the night.',
    ],
  },
  {
    id: 'sleep-cycle',
    term: 'Sleep Cycle (NREM–REM Ultradian Cycle)',
    category: 'sleep-medicine',
    aliases: ['NREM-REM Cycle', 'Ultradian Sleep Cycle'],
    quick:
      'One repetition of the non-REM → REM progression during sleep, lasting roughly 90 minutes, repeated four to six times per night.',
    standard:
      'A sleep cycle is one pass through the recurring non-REM → REM sequence: the night descends from light into deep non-REM sleep and then rises into a REM episode, after which the cycle repeats. The cycle length is an ultradian rhythm of roughly 90 minutes (commonly cited as 90–120 minutes), so a full night contains about four to six cycles. The structure changes across the night — deep N3 sleep dominates the early cycles, while REM episodes lengthen in the later ones (Feinberg & Floyd 1979). Because consumer wearables do not score true PSG cycles, CPAP Analyzer derives cycle boundaries heuristically from the imported hypnogram, using the ends of successive REM episodes as the cycle markers.',
    detailed:
      'How CPAP Analyzer derives cycles (heuristic, not PSG cycle scoring): from the wearable hypnogram it first identifies REM episodes as maximal runs of REM, merging runs separated by gaps of ≤ 15 minutes so that a brief interruption does not split one physiological REM period into two. A sleep cycle is then defined as the span from the end of one REM episode to the end of the next, following the classical convention that a cycle ends when a REM period ends; any non-REM sleep that trails after the final REM episode is reported as an incomplete final cycle rather than discarded. This reproduces the textbook ~90-minute NREM–REM cadence and the across-night trends (more deep sleep early, longer REM late) when the wearable staging is reasonable, but it is explicitly a heuristic over modeled stages: it inherits all the uncertainty of consumer-wearable staging, and a missed or spurious REM episode shifts the cycle boundaries. It is not a substitute for the cycle structure a sleep technologist would derive from polysomnography. CPAP Analyzer uses the derived cycles to show per-cycle event load and early- versus late-night distribution; it reports them for information and does not diagnose.',
    relatedTerms: ['rem-sleep', 'sleep-stage', 'sleep-fragmentation', 'sleep-apnea'],
    references: [
      'Feinberg, I., & Floyd, T. C. (1979). Systematic trends across the night in human sleep cycles. Psychophysiology, 16(3), 283–291. DOI: 10.1111/j.1469-8986.1979.tb02991.x. — The ~90-minute NREM–REM cycle and its systematic across-night trends.',
    ],
  },
  {
    id: 'rem-predominant-osa',
    term: 'REM-Predominant / REM-Related OSA',
    category: 'sleep-medicine',
    aliases: ['REM-Related OSA', 'REM-Predominant Obstructive Sleep Apnea', 'REM OSA'],
    quick:
      'Obstructive sleep apnea in which events are concentrated in REM sleep — formally, the REM apnea–hypopnea index is at least twice the non-REM index.',
    standard:
      'REM-related OSA describes obstructive sleep apnea whose events cluster in REM sleep, where airway-muscle atonia makes the airway most collapsible. The common literature definition is a ratio AHI_REM / AHI_NREM ≥ 2 with AHI_NREM > 0, where AHI_REM and AHI_NREM are the apnea–hypopnea indices computed within REM and within non-REM time respectively. A stricter "REM-predominant" definition adds floors to avoid labelling people on the strength of a tiny amount of REM: AHI_NREM < 15, at least 30 minutes of REM sleep, and at least 15 minutes of NREM sleep. The pattern matters because REM events are often longer and cause deeper desaturations, and REM lengthens toward morning, so the worst breathing can fall in the hours before waking.',
    detailed:
      'Definitions vary across the literature, which is itself a caveat. The widely used criterion is AHI_REM / AHI_NREM ≥ 2 (with AHI_NREM > 0); Conwell et al. (2012) and Koo et al. (2008) add the more conservative requirements AHI_NREM < 15/h, REM duration ≥ 30 min, and NREM duration ≥ 15 min so the ratio is not driven by a sliver of REM or by near-zero NREM denominators (Mokhlesi & Punjabi 2012 discuss why the denominator floors matter). CPAP Analyzer computes AHI_REM and AHI_NREM by partitioning machine-scored events into REM and non-REM time using the imported wearable hypnogram, reports the ratio, and flags whether the literature floors are met. It also offers an across-nights Wilcoxon signed-rank test of paired AHI_REM versus AHI_NREM to ask whether the REM excess is consistent rather than a one-night artifact. Two strong caveats apply: (1) the diagnostic literature is built on EEG-staged PSG, whereas these stages come from a consumer wearable, so the REM/NREM split is approximate; and (2) device AHI is flow-only and leak-sensitive. Read a REM-predominant pattern as a candidate finding to discuss with a clinician, not a diagnosis. CPAP Analyzer does not diagnose.',
    uncertainty:
      'The REM/NREM apnea split is doubly uncertain here: it multiplies the approximate nature of wearable sleep staging (no EEG; REM boundaries are inferred and worse in OSA patients) by the flow-only, leak-sensitive nature of device event scoring. A small misplacement of REM boundaries can move events between the REM and NREM buckets and swing the ratio across the 2.0 line, and short REM time makes AHI_REM noisy. Treat the ratio as a trend across several nights with adequate REM, weight low-leak nights, and confirm the literature floors before reading the label; bring a persistent pattern to your clinician.',
    relatedTerms: ['rem-sleep', 'sleep-stage', 'ahi', 'osa', 'cvhr', 'wilcoxon-signed-rank'],
    references: [
      'Conwell, W., Patel, B., Doeing, D., et al. (2012). Prevalence, clinical features, and CPAP adherence in REM-related sleep-disordered breathing: a cross-sectional analysis of a large clinical population. Sleep and Breathing, 16(2), 519–526. DOI: 10.1007/s11325-011-0537-6.',
      'Koo, B. B., Patel, S. R., Strohl, K., & Hoffstein, V. (2008). Rapid eye movement-related sleep-disordered breathing: influence of age and gender. Chest, 134(6), 1156–1161. DOI: 10.1378/chest.08-1311.',
      'Mokhlesi, B., & Punjabi, N. M. (2012). "REM-related" obstructive sleep apnea: an epiphenomenon or a clinically important entity? Sleep, 35(1), 5–7. DOI: 10.5665/sleep.1570. — On denominator floors and the clinical significance of the REM/NREM ratio.',
    ],
  },
  {
    id: 'cvhr',
    term: 'CVHR (Cyclic Variation of Heart Rate)',
    category: 'sleep-medicine',
    aliases: ['Cyclic Variation of Heart Rate'],
    quick:
      'The repetitive bradycardia-then-tachycardia swing in heart rate that accompanies each apnea/hypopnea cycle, driven by autonomic arousal.',
    standard:
      'Cyclic variation of heart rate (CVHR) is the characteristic heart-rate signature of sleep-disordered breathing first described by Guilleminault et al. (1984): during an apnea the heart rate tends to slow (bradycardia), then surges upward (tachycardia) at event termination as the arousal and resumption of breathing trigger a burst of sympathetic activity. Averaging the heart rate around many events (an event-triggered average) reveals this dip-then-surge pattern even when individual events are noisy. The size of the post-event tachycardia surge reflects the strength of the autonomic (sympathetic) arousal that each event provokes — larger surges indicate more cardiovascular stress per event.',
    detailed:
      'CVHR arises from the autonomic response to repetitive apneas: apnea-related hypoxia and the cessation of the inhibitory lung-stretch reflex favor vagal (parasympathetic) bradycardia during the event, and arousal with breathing resumption produces a sympathetic surge and tachycardia at termination. CPAP Analyzer estimates CVHR by computing an event-triggered average of the imported wearable intraday heart rate, aligning each respiratory event to a common time origin and averaging the heart-rate trace in a window around it; the resulting curve shows the typical peri-event bradycardia–tachycardia excursion and the magnitude of the surge. Because the heart rate comes from a wrist or ring photoplethysmographic (PPG) sensor sampled at roughly a 5-second cadence with smoothing and latency, the timing and amplitude of the surge are approximate — the pattern is informative, the exact beat-to-beat dynamics are not resolved as they would be from an ECG. CVHR has been studied as a screening signal for sleep apnea from heart rate alone; here it is a descriptive overlay on event analysis, reported for information. CPAP Analyzer does not diagnose.',
    relatedTerms: ['arousal', 'rem-sleep', 'sleep-stage', 'ahi', 'desaturation'],
    references: [
      'Guilleminault, C., Connolly, S., Winkle, R., Melvin, K., & Tilkian, A. (1984). Cyclical variation of the heart rate in sleep apnoea syndrome. The Lancet, 1(8369), 126–131. DOI: 10.1016/S0140-6736(84)90062-X. — Original description of cyclic heart-rate variation in sleep apnea.',
    ],
  },

  // ─── STATISTICS ─────────────────────────────────────────────────────

  {
    id: 'mean',
    term: 'Mean',
    category: 'statistics',
    aliases: ['Average', 'Arithmetic Mean'],
    quick: 'The arithmetic average of a set of values — sum of all values divided by the count.',
    standard:
      'The mean is calculated by adding all values and dividing by the number of values. It is the most common measure of central tendency. In CPAP analysis, mean values are used for AHI, pressure, leak rate, and SpO₂. The mean is sensitive to outliers — a single extremely high or low value can shift the mean significantly.',
    detailed:
      'Mean = Σxᵢ / n, where xᵢ are the individual values and n is the count. Properties: uniquely minimizes the sum of squared deviations (least squares). Limitations: sensitive to outliers and skewed distributions (common in CPAP data, as AHI and leak distributions are typically right-skewed). For skewed CPAP data, the median or trimmed mean may better represent "typical" values. The mean is appropriate for approximately normal distributions (e.g., SpO₂ in well-treated patients, pressure in fixed CPAP). Always consider the mean alongside the standard deviation and the shape of the distribution.',
    formula: '\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i',
    relatedTerms: ['median', 'standard-deviation'],
  },
  {
    id: 'median',
    term: 'Median',
    category: 'statistics',
    quick: 'The middle value when data is sorted — 50% of values are above it, 50% below.',
    standard:
      'The median is the middle value when all observations are arranged in order. Unlike the mean, the median is robust to outliers and skewed distributions. For leak rate and AHI data (which tend to be right-skewed), the median often better represents the "typical" value than the mean. The median is the 50th percentile.',
    detailed:
      'For n values sorted in ascending order: Median = x₍₍ₙ₊₁₎/₂₎ if n is odd; average of x₍ₙ/₂₎ and x₍ₙ/₂₊₁₎ if n is even. Properties: uniquely minimizes the sum of absolute deviations; breakdown point of 0.5 (50% of data can be corrupted without affecting the median). In CPAP data, median leak rate is preferred over mean because large spikes (e.g., mask removal) would disproportionately inflate the mean. ResMed reports use median leak rate as the primary leak metric. The median is a special case of a quantile (the 0.5 quantile or P50).',
    formula:
      '\\tilde{x} = \\begin{cases} x_{(n+1)/2} & \\text{if } n \\text{ is odd} \\\\ \\frac{x_{n/2} + x_{n/2+1}}{2} & \\text{if } n \\text{ is even} \\end{cases}',
    relatedTerms: ['mean', 'percentile'],
  },
  {
    id: 'standard-deviation',
    term: 'Standard Deviation',
    category: 'statistics',
    aliases: ['SD', 'Std Dev'],
    quick: 'A measure of how spread out values are from the mean — higher means more variability.',
    standard:
      'Standard deviation quantifies the dispersion of a dataset. A small standard deviation means values are clustered near the mean; a large one means they are spread out. In CPAP analysis, high AHI standard deviation across nights suggests inconsistent therapy, while low standard deviation suggests stable control.',
    detailed:
      "SD = √(Σ(xᵢ − x̄)² / (n − 1)) for sample standard deviation (Bessel's correction). Properties: same units as the data; for normal distributions, ~68% of values fall within ±1 SD, ~95% within ±2 SD, ~99.7% within ±3 SD. Coefficient of variation (CV = SD/mean × 100%) enables comparison of variability between metrics with different scales. In CPAP data: AHI SD < 2 across nights indicates stable therapy; pressure SD in APAP mode indicates how much the machine adjusts (high SD = variable airway). SD assumes a symmetric distribution — for skewed CPAP data, consider interquartile range (IQR) instead.",
    formula: 's = \\sqrt{\\frac{1}{n-1}\\sum_{i=1}^{n}(x_i - \\bar{x})^2}',
    relatedTerms: ['mean', 'normal-distribution', 'percentile'],
  },
  {
    id: 'percentile',
    term: 'Percentile',
    category: 'statistics',
    aliases: ['Quantile'],
    quick:
      'The value below which a given percentage of observations fall — P95 means 95% of values are below it.',
    standard:
      'A percentile indicates the relative standing of a value within a dataset. The 95th percentile (P95) means 95% of values are at or below that point. In CPAP data, P95 leak rate indicates the leak level that is exceeded only 5% of the time — useful for identifying the worst-case leak without being skewed by brief spikes. ResMed devices commonly report 90th and 95th percentile values.',
    detailed:
      'The p-th percentile Pₚ is the value such that p% of observations fall at or below it. Calculation methods vary (linear interpolation, nearest rank, etc.). Common CPAP percentiles: P50 (median) for typical values; P90 for upper range; P95 for worst-case assessment; P5 for lower range. Interpretation example: An APAP P95 pressure of 14 cmH₂O means the machine was above 14 for only 5% of the night, suggesting 14 cmH₂O would be an appropriate fixed CPAP setting. Percentile-based statistics are robust to outliers and do not assume any distributional form, making them ideal for the skewed distributions common in sleep data.',
    formula:
      'h = (n - 1) \\cdot \\frac{p}{100}, \\quad P_p = x_{\\lfloor h \\rfloor} + (h - \\lfloor h \\rfloor)(x_{\\lceil h \\rceil} - x_{\\lfloor h \\rfloor})',
    relatedTerms: ['median', 'standard-deviation'],
  },
  {
    id: 'p-value',
    term: 'P-value',
    category: 'statistics',
    quick:
      'The probability of seeing results at least as extreme as observed, assuming no real effect exists.',
    standard:
      'A p-value measures the strength of evidence against a null hypothesis. A small p-value (typically < 0.05) suggests the observed result is unlikely due to chance alone. In CPAP analysis, p-values appear in trend analysis (is AHI truly improving over time?) and comparison tests (is there a significant difference between weekday and weekend usage?).',
    detailed:
      'The p-value is P(data as or more extreme | H₀ is true). It is NOT the probability that H₀ is true. Common thresholds: < 0.05 (significant), < 0.01 (highly significant), < 0.001 (very highly significant). Important caveats: p-values depend on sample size (large datasets can produce small p-values for clinically trivial effects); multiple comparisons inflate false positive rates (apply Bonferroni or FDR correction); p-values say nothing about effect size or clinical significance. Always report effect size alongside p-values. For CPAP trend analysis, consider whether a statistically significant 0.3 AHI reduction is clinically meaningful.',
    relatedTerms: ['statistical-significance', 'effect-size', 'confidence-interval'],
  },
  {
    id: 'correlation',
    term: 'Correlation',
    category: 'statistics',
    aliases: ['Correlation Coefficient'],
    quick: 'A measure of the linear relationship between two variables, ranging from -1 to +1.',
    standard:
      'Correlation quantifies the strength and direction of the linear relationship between two variables. Values range from -1 (perfect negative) to +1 (perfect positive); 0 indicates no linear relationship. In CPAP analysis, you might examine the correlation between leak rate and AHI, or between usage hours and daytime sleepiness scores.',
    detailed:
      "Pearson correlation r = Σ(xᵢ − x̄)(yᵢ − ȳ) / √(Σ(xᵢ − x̄)² × Σ(yᵢ − ȳ)²). Assumptions: linearity, bivariate normality, no significant outliers. For non-normal data (common in CPAP data), use Spearman rank correlation ρ (monotonic relationships) or Kendall τ (ordinal). CPAP Analyzer labels the magnitude of |r| using five rule-of-thumb bands: |r| < 0.1 negligible, 0.1–0.3 weak, 0.3–0.5 moderate, 0.5–0.7 strong, > 0.7 very strong. These are convenience labels, not a standard: correlation-strength cutoffs are inherently arbitrary (Schober et al. 2018), and they differ from Cohen's (1988) effect-size benchmarks for r, which are .1 (small), .3 (medium), and .5 (large). Correlation does NOT imply causation — a correlation between mask type and AHI may reflect selection bias (patients with severe OSA may use specific masks). Always visualize the relationship alongside the correlation coefficient.",
    formula:
      'r = \\frac{\\sum_{i=1}^{n}(x_i - \\bar{x})(y_i - \\bar{y})}{\\sqrt{\\sum_{i=1}^{n}(x_i - \\bar{x})^2 \\cdot \\sum_{i=1}^{n}(y_i - \\bar{y})^2}}',
    relatedTerms: ['regression', 'p-value'],
    references: [
      'Pearson, K. (1895). Note on regression and inheritance in the case of two parents. Proceedings of the Royal Society of London, 58, 240–242. DOI: 10.1098/rspl.1895.0041.',
      'Spearman, C. (1904). The proof and measurement of association between two things. American Journal of Psychology, 15(1), 72–101. DOI: 10.2307/1412159.',
      'Cohen, J. (1988). Statistical Power Analysis for the Behavioral Sciences (2nd ed.). Hillsdale, NJ: Lawrence Erlbaum. — Effect-size benchmarks (r: .1/.3/.5 = small/medium/large).',
      'Schober, P., Boer, C., & Schwarte, L. A. (2018). Correlation coefficients: appropriate use and interpretation. Anesthesia & Analgesia, 126(5), 1763–1768. DOI: 10.1213/ANE.0000000000002864. — Notes that correlation-strength cutoffs are inherently arbitrary.',
    ],
  },
  {
    id: 'chi-square-gof',
    term: 'Chi-Square Goodness-of-Fit Test',
    category: 'statistics',
    aliases: ['Chi-Squared Goodness-of-Fit', 'χ² Goodness-of-Fit', 'Pearson Chi-Square'],
    quick:
      'A test of whether observed category counts differ from the counts expected under a baseline model — used to ask if events are unevenly distributed across sleep stages.',
    standard:
      'The chi-square (χ²) goodness-of-fit test compares a set of observed counts across categories with the counts you would expect if a null model were true. In sleep-stage analysis the categories are the sleep stages, the observed counts are the respiratory events scored in each stage, and the expected counts are proportional to the time spent in each stage — so the null hypothesis is "events occur at the same rate per hour in every stage." A large χ² statistic, and a correspondingly small p-value, indicates the event rate differs across stages by more than time-in-stage alone would predict (for example, an excess of events in REM). The test answers whether a difference exists; it does not say which stage drives it or how large the effect is.',
    detailed:
      "The statistic is χ² = Σ (Oᵢ − Eᵢ)² / Eᵢ, summed over the k categories, where Oᵢ is the observed count in category i and Eᵢ is its expected count under the null. For stage analysis, Eᵢ = N_total × (time in stage i / total staged time), so events are expected in proportion to time in each stage. Under the null the statistic follows a χ² distribution with df = k − 1 degrees of freedom (one fewer than the number of categories, because the totals are fixed). Reading the result: a larger χ² means observed counts depart further from expectation; the p-value is the probability of a χ² at least that large under the null, so p < 0.05 is the usual flag that the per-stage event rates genuinely differ. Cochran's rule is the key validity caveat: the χ² approximation is unreliable when expected counts are small — the common guideline is that all expected counts should be ≥ 5 (or at least no more than ~20% of cells below 5). A short night, or a stage with very little time, can therefore produce too few expected events for the test to be trustworthy; CPAP Analyzer flags this rather than reporting a spurious p-value. The test is also an omnibus test — it detects that some stage differs but not which one — and, like all the analyses here, it rests on wearable-derived stage labels, so a significant result is a lead to interpret with the hypnogram, not a diagnosis.",
    formula: '\\chi^2 = \\sum_{i=1}^{k} \\frac{(O_i - E_i)^2}{E_i}, \\quad \\mathrm{df} = k - 1',
    relatedTerms: ['p-value', 'sleep-stage', 'rem-predominant-osa', 'statistical-significance'],
    references: [
      'Pearson, K. (1900). On the criterion that a given system of deviations from the probable in the case of a correlated system of variables is such that it can be reasonably supposed to have arisen from random sampling. Philosophical Magazine, Series 5, 50(302), 157–175. DOI: 10.1080/14786440009463897. — Original chi-square goodness-of-fit statistic.',
      'Cochran, W. G. (1954). Some methods for strengthening the common χ² tests. Biometrics, 10(4), 417–451. DOI: 10.2307/3001616. — The expected-count (≥ 5) rule for χ² validity.',
    ],
  },
  {
    id: 'wilcoxon-signed-rank',
    term: 'Wilcoxon Signed-Rank Test',
    category: 'statistics',
    aliases: ['Wilcoxon Signed-Rank', 'Signed-Rank Test'],
    quick:
      'A non-parametric paired test of whether two matched measurements differ — used here to compare REM and non-REM AHI across nights.',
    standard:
      "The Wilcoxon signed-rank test is the rank-based (non-parametric) counterpart of the paired t-test. It asks whether the differences between two paired measurements are systematically positive or negative, without assuming the differences are normally distributed — which suits skewed quantities like AHI. In sleep-stage analysis it compares each night's AHI_REM with the same night's AHI_NREM (a natural pairing), testing whether the REM excess is consistent across nights rather than a one-night fluke. A small p-value indicates a reliable paired difference in the direction observed.",
    detailed:
      "The test ranks the absolute values of the paired differences dᵢ = xᵢ − yᵢ (dropping zeros), attaches the sign of each difference to its rank, and sums the positive-signed ranks to form the statistic W; under the null hypothesis of no systematic difference, positive and negative ranks balance and W has a known sampling distribution (a normal approximation with a continuity correction is used for larger n). It assumes only that the paired differences are symmetric about their median, making it robust to the right-skew and outliers common in nightly AHI data, where a paired t-test's normality assumption would be questionable. CPAP Analyzer uses it for the across-nights comparison of AHI_REM versus AHI_NREM that underpins the REM-predominant-OSA view; it requires enough paired nights (nights with both REM and NREM events scored) to be meaningful, and it reports a difference in central tendency, not its magnitude or clinical importance. As with every analysis built on wearable staging, a significant result is a candidate pattern to discuss with a clinician, not a diagnosis.",
    relatedTerms: ['p-value', 'rem-predominant-osa', 'median', 'statistical-significance'],
    references: [
      'Wilcoxon, F. (1945). Individual comparisons by ranking methods. Biometrics Bulletin, 1(6), 80–83. DOI: 10.2307/3001968. — The signed-rank test for paired samples.',
    ],
  },
  {
    id: 'confidence-interval',
    term: 'Confidence Interval',
    category: 'statistics',
    aliases: ['CI'],
    quick:
      'A range of values that likely contains the true population parameter — the wider the interval, the more uncertainty.',
    standard:
      'A 95% confidence interval means that if we were to collect data and compute the interval many times, 95% of those intervals would contain the true value. CI width reflects precision — narrow intervals indicate a precise estimate, wide intervals indicate uncertainty. In CPAP analysis, confidence intervals around trend slopes help assess whether changes in AHI over time are reliable.',
    detailed:
      'For a mean: CI = x̄ ± t₍α/2, n−1₎ × (s/√n). Width depends on: sample size (larger n → narrower CI), variability (lower s → narrower CI), and confidence level (99% CI > 95% CI). For proportions (e.g., compliance rate): CI = p̂ ± z × √(p̂(1−p̂)/n). Bootstrap confidence intervals are non-parametric alternatives that make no distributional assumptions — appropriate for the skewed distributions common in CPAP data. Report: "Mean AHI was 3.2 (95% CI: 2.8–3.6)" rather than just "Mean AHI was 3.2" to communicate precision.',
    formula: '\\text{CI} = \\bar{x} \\pm t_{\\alpha/2,\\, n-1} \\cdot \\frac{s}{\\sqrt{n}}',
    relatedTerms: ['p-value', 'standard-deviation', 'statistical-significance'],
    references: [
      'Fisher, R. A. (1915). Frequency distribution of the values of the correlation coefficient in samples from an indefinitely large population. Biometrika, 10(4), 507–521. DOI: 10.2307/2331838. — z-transformation for correlation confidence intervals.',
    ],
  },
  {
    id: 'rolling-average',
    term: 'Rolling Average',
    category: 'statistics',
    aliases: ['Moving Average', 'Running Average'],
    quick:
      'An average computed over a sliding window of consecutive data points, smoothing out short-term fluctuations.',
    standard:
      'A rolling (or moving) average calculates the mean over a fixed-size window that "slides" through the data over time. For example, a 7-day rolling average of AHI averages each night with the 6 preceding nights. This smooths out night-to-night variability and reveals underlying trends more clearly than raw daily values.',
    detailed:
      'Simple Moving Average (SMA): MA_t = (1/k) × Σ x_{t-i} for i = 0 to k−1. Exponential Moving Average (EMA/EWMA) gives exponentially decreasing weights to older observations: EMA_t = α × x_t + (1−α) × EMA_{t−1}, where α = 2/(k+1). EMA responds faster to recent changes. Common windows in CPAP analysis: 7-day (weekly pattern smoothing), 14-day (two-week trend), 30-day (monthly average). Considerations: window size trades off smoothness vs. responsiveness; missing nights should be handled (skip or interpolate); edge effects at the start of the time series where full window is unavailable.',
    formula: '\\text{MA}_t = \\frac{1}{k}\\sum_{i=0}^{k-1} x_{t-i}',
    relatedTerms: ['trend', 'loess', 'mean'],
  },
  {
    id: 'trend',
    term: 'Trend',
    category: 'statistics',
    quick:
      'The long-term direction of a time series — whether values are generally increasing, decreasing, or stable over time.',
    standard:
      'A trend is the overall direction of change in data over time. In CPAP analysis, identifying trends in AHI, leak rate, and usage helps detect gradual improvement or deterioration. A downward AHI trend suggests improving therapy control; an upward trend may indicate weight gain, mask degradation, or changing sleep conditions.',
    detailed:
      "CPAP Analyzer's trend analysis fits an ordinary-least-squares (OLS) linear regression to the nightly series — the slope gives direction and rate, and a Student-t test on the slope assesses whether it differs significantly from zero — and overlays LOESS smoothing to reveal non-linear shape. Other trend methods exist and are listed here for completeness, but they are NOT what the app currently computes: the Mann–Kendall test (a non-parametric trend test suitable for non-normal data), the Sen (Theil–Sen) slope estimator (a robust median-of-pairwise-slopes estimate), and change-point detection (which locates where a trend shifts rather than fitting one). When judging significance, remember that consecutive nights are autocorrelated and not independent, which can make a naive t-test overstate confidence. Clinically meaningful trends: AHI increasing > 2/hr over a month warrants investigation; usage declining > 30 min/night over a month suggests adherence intervention needed.",
    relatedTerms: ['rolling-average', 'regression', 'change-point', 'loess'],
    references: [
      'Mann, H. B. (1945). Nonparametric tests against trend. Econometrica, 13(3), 245–259. DOI: 10.2307/1907187.',
      "Sen, P. K. (1968). Estimates of the regression coefficient based on Kendall's tau. Journal of the American Statistical Association, 63(324), 1379–1389. DOI: 10.1080/01621459.1968.10480934.",
    ],
  },
  {
    id: 'outlier',
    term: 'Outlier',
    category: 'statistics',
    quick:
      'A data point that falls far outside the normal range and may represent unusual conditions or measurement error.',
    standard:
      'An outlier is an observation that is significantly different from other observations in a dataset. In CPAP data, outliers might represent nights with mask removal, equipment malfunction, illness, alcohol consumption, or sleeping without the mask. Identifying outliers is important because they can skew statistical calculations and mask true trends.',
    detailed:
      'Common outlier detection methods: (1) IQR method: values below Q1 − 1.5×IQR or above Q3 + 1.5×IQR; (2) Z-score: |z| > 3; (3) Modified Z-score using median and MAD (more robust); (4) Grubbs test (assumes normality); (5) Isolation Forest (machine learning approach for multivariate data). In CPAP analysis, important to distinguish: clinical outliers (genuinely unusual night — illness, alcohol, positional) from data quality outliers (mask removal, battery failure, corrupt data). Clinical outliers should be analyzed, not removed. Data quality outliers should be flagged and optionally excluded from aggregate statistics.',
    relatedTerms: ['standard-deviation', 'percentile'],
    references: [
      'Tukey, J. W. (1977). Exploratory Data Analysis. Reading, MA: Addison-Wesley. — Interquartile-range fences for outlier detection.',
    ],
  },
  {
    id: 'normal-distribution',
    term: 'Normal Distribution',
    category: 'statistics',
    aliases: ['Gaussian Distribution', 'Bell Curve'],
    quick:
      'A symmetric, bell-shaped probability distribution where most values cluster around the mean.',
    standard:
      'The normal (Gaussian) distribution is the most common probability distribution in statistics — the familiar bell curve. Many statistical tests assume normality. In CPAP data, variables like SpO₂ and pressure in fixed-CPAP mode often approximate normality, while AHI and leak rate are typically right-skewed and are NOT normally distributed.',
    detailed:
      'PDF: f(x) = (1/(σ√(2π))) × e^(-(x-μ)²/(2σ²)). Characterized by mean (μ) and standard deviation (σ). Properties: symmetric about the mean; 68-95-99.7 rule; mean = median = mode. Central Limit Theorem: the mean of sufficiently large random samples will be approximately normal regardless of the underlying distribution. This is why confidence intervals and hypothesis tests often work well even for non-normal data when sample sizes are adequate (n ≥ 30 as a rough guideline). For CPAP data: test normality with the Shapiro–Francia test (the correlation-based variant of Shapiro–Wilk, which CPAP Analyzer computes); use non-parametric methods (Mann-Whitney, Kruskal-Wallis) when normality is violated.',
    formula: 'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}}\\, e^{-\\frac{(x - \\mu)^2}{2\\sigma^2}}',
    relatedTerms: ['mean', 'standard-deviation'],
    references: [
      'Shapiro, S. S., & Francia, R. S. (1972). An approximate analysis of variance test for normality. Journal of the American Statistical Association, 67(337), 215–216. DOI: 10.1080/01621459.1972.10481232.',
      'Royston, P. (1993). A toolkit for testing for non-normality in complete and censored samples. The Statistician (Journal of the Royal Statistical Society, Series D), 42(1), 37–43. DOI: 10.2307/2348109.',
    ],
  },
  {
    id: 'effect-size',
    term: 'Effect Size',
    category: 'statistics',
    aliases: ["Cohen's d"],
    quick:
      'A standardized measure of the magnitude of a difference or relationship — tells you how large an effect is, not just whether it exists.',
    standard:
      "Effect size quantifies the practical significance of a finding, independent of sample size. While a p-value tells you IF an effect exists, effect size tells you HOW BIG it is. Cohen's d (for differences between means) is interpreted as: small (0.2), medium (0.5), large (0.8). In CPAP analysis, a statistically significant AHI improvement might be clinically trivial if the effect size is small.",
    detailed:
      "Cohen's d = (M₁ - M₂) / SD_pooled, where SD_pooled = √((SD₁² + SD₂²) / 2). Other measures: r (correlation), η² (eta-squared, proportion of variance explained), Odds Ratio (for categorical outcomes). For paired data (same patients before/after): d_z = mean_diff / SD_diff. Clinical significance thresholds for CPAP data are domain-specific: AHI reduction > 50% or to < 5 is clinically significant regardless of statistical effect size. Always report effect sizes alongside p-values to prevent overinterpretation of statistically significant but clinically meaningless differences.",
    formula:
      'd = \\frac{M_1 - M_2}{s_{\\text{pooled}}}, \\quad s_{\\text{pooled}} = \\sqrt{\\frac{s_1^2 + s_2^2}{2}}',
    relatedTerms: ['p-value', 'statistical-significance'],
    references: [
      'Cohen, J. (1988). Statistical Power Analysis for the Behavioral Sciences (2nd ed.). Hillsdale, NJ: Lawrence Erlbaum. — Effect-size benchmarks (r: .1/.3/.5 = small/medium/large).',
    ],
  },
  {
    id: 'statistical-significance',
    term: 'Statistical Significance',
    category: 'statistics',
    quick:
      'A result is statistically significant if it is unlikely to have occurred by chance alone (typically p < 0.05).',
    standard:
      'Statistical significance indicates that the observed result is unlikely to be due to random chance. By convention, a result is significant if the p-value is less than 0.05 (5% chance of a false positive). However, statistical significance does not necessarily mean clinical or practical significance — always consider the effect size and context.',
    detailed:
      'The significance level α is the threshold for rejecting the null hypothesis. Conventional α = 0.05 (Fisher), though 0.01 or 0.001 may be appropriate for stricter control. Type I error (false positive): rejecting H₀ when true (rate = α). Type II error (false negative): failing to reject H₀ when false (rate = β; power = 1 − β). Multiple comparisons problem: testing k hypotheses at α = 0.05 gives 1−(0.95)^k probability of at least one false positive. Corrections: Bonferroni (α/k, conservative), Benjamini-Hochberg (FDR control, less conservative). For CPAP data analysis: distinguish between exploratory (hypothesis-generating) and confirmatory (hypothesis-testing) analyses.',
    relatedTerms: ['p-value', 'effect-size', 'confidence-interval'],
  },
  {
    id: 'kaplan-meier',
    term: 'Kaplan-Meier Estimator',
    category: 'statistics',
    aliases: ['Survival Curve', 'KM Curve'],
    quick:
      'A method to estimate the probability of an event not occurring over time, commonly displayed as a step-down curve.',
    standard:
      'The Kaplan-Meier estimator creates a "survival curve" showing the probability of remaining event-free over time. In CPAP analysis, it can be used to visualize time-to-first-event analysis: how long into the night before the first apnea occurs, or what percentage of nights remain above a compliance threshold. The step-down curve shows when events happen.',
    detailed:
      'KM estimator: Ŝ(t) = Π_{tᵢ≤t} (nᵢ − dᵢ) / nᵢ, where nᵢ = number at risk at time tᵢ, dᵢ = number of events at tᵢ. It handles censored observations (e.g., nights where the patient removed the mask before an event would have occurred). CPAP Analyzer computes the Kaplan–Meier survival estimate, Greenwood-variance confidence intervals around it, and the median survival time. Two related survival-analysis concepts appear in textbooks but are NOT computed here: the log-rank test (not currently computed by CPAP Analyzer) compares survival curves between groups, e.g., different mask types or pressure settings; and hazard-rate estimation describes the instantaneous event rate over time, e.g., to identify when during the night events are most likely (such as supine REM periods). In CPAP data, the time-to-first-event view characterizes event clustering and therapy effectiveness across the night.',
    formula: '\\hat{S}(t) = \\prod_{t_i \\leq t} \\frac{n_i - d_i}{n_i}',
    relatedTerms: ['trend', 'p-value'],
    references: [
      'Kaplan, E. L., & Meier, P. (1958). Nonparametric estimation from incomplete observations. Journal of the American Statistical Association, 53(282), 457–481. DOI: 10.1080/01621459.1958.10501452.',
      'Greenwood, M. (1926). The natural duration of cancer. Reports on Public Health and Medical Subjects, 33, 1–26. London: HMSO. — Greenwood variance for survival confidence intervals.',
    ],
  },
  {
    id: 'change-point',
    term: 'Change Point',
    category: 'statistics',
    aliases: ['Change Point Detection', 'Breakpoint'],
    quick:
      'A point in a time series where the statistical properties (mean, variance, trend) shift abruptly.',
    standard:
      'Change point detection identifies moments when the behavior of data fundamentally changes. In CPAP analysis, change points could indicate when a mask was changed, when weight was gained or lost, when pressure settings were adjusted, or when a medication was started. Detecting these shifts helps correlate therapy changes with outcomes.',
    detailed:
      'Methods: (1) CUSUM (Cumulative Sum) — detects shifts in mean by tracking cumulative deviations; (2) PELT (Pruned Exact Linear Time) — optimal segmentation with penalty for overfitting; (3) Binary segmentation — recursive splitting; (4) Bayesian change point detection — probabilistic framework with prior on number of changes. For CPAP data, change point analysis on nightly AHI can detect: pressure setting changes, mask changes, weight changes, seasonal effects, medication effects. Configuration: minimum segment length (avoid spurious detections from night-to-night variability); penalty parameter (controls number of detected changes).',
    relatedTerms: ['trend', 'regression'],
    references: [
      'Killick, R., Fearnhead, P., & Eckley, I. A. (2012). Optimal detection of changepoints with a linear computational cost. Journal of the American Statistical Association, 107(500), 1590–1598. DOI: 10.1080/01621459.2012.737745. — PELT change-in-mean detection.',
    ],
  },
  {
    id: 'loess',
    term: 'LOESS (Locally Estimated Scatterplot Smoothing)',
    category: 'statistics',
    aliases: ['LOWESS', 'Local Regression'],
    quick:
      'A flexible smoothing method that fits local regressions to reveal non-linear trends in data.',
    standard:
      'LOESS (also called LOWESS) is a non-parametric regression method that fits a smooth curve through scattered data. Unlike a straight-line trend, LOESS can capture curved, non-linear patterns. It is useful in CPAP analysis for visualizing how AHI or other metrics change over time when the trend is not simply up or down.',
    detailed:
      'LOESS fits weighted least-squares regressions to local subsets of data. Each point x₀ uses a neighborhood of the nearest fraction (span) of data points, weighted by a tricube function. Key parameter: span (bandwidth) controls smoothness — typical range 0.2–0.8; smaller span = more flexible (may overfit), larger span = smoother (may underfit). The local-polynomial degree can in principle be 0 (local mean), 1 (local linear), or 2 (local quadratic); CPAP Analyzer uses local linear (degree-1) fits with tricube weights, not local quadratic fitting. LOESS does not produce a global model equation — prediction requires the original data. Computational cost: O(n²) for n points. For CPAP data, LOESS with span 0.3–0.5 effectively reveals seasonal or medium-term trends in AHI and usage hours that a linear model would miss.',
    relatedTerms: ['regression', 'trend', 'rolling-average'],
    references: [
      'Cleveland, W. S. (1979). Robust locally weighted regression and smoothing scatterplots. Journal of the American Statistical Association, 74(368), 829–836. DOI: 10.1080/01621459.1979.10481038.',
    ],
  },
  {
    id: 'regression',
    term: 'Regression',
    category: 'statistics',
    aliases: ['Linear Regression'],
    quick:
      'A statistical method for modeling the relationship between a dependent variable and one or more independent variables.',
    standard:
      'Regression fits a model (often a straight line) to data, quantifying the relationship between variables. Linear regression produces a slope (rate of change) and intercept. In CPAP analysis, regression can model AHI trend over time (slope = AHI change per day/week/month), or how pressure relates to AHI.',
    detailed:
      'Simple linear regression: y = β₀ + β₁x + ε. β₁ (slope) estimated by least squares: β̂₁ = Σ(xᵢ − x̄)(yᵢ − ȳ) / Σ(xᵢ − x̄)². Assumptions: linearity, independence, normality of residuals, homoscedasticity. R² (coefficient of determination) = proportion of variance explained (0 to 1). Multiple regression extends to multiple predictors: y = β₀ + β₁x₁ + β₂x₂ + ... + ε. For time series CPAP data, autocorrelation violates the independence assumption — consider ARIMA models or GEE (Generalized Estimating Equations). Robust regression (M-estimators, quantile regression) is less sensitive to outliers common in CPAP data.',
    formula:
      'y = \\beta_0 + \\beta_1 x + \\varepsilon, \\quad \\hat{\\beta}_1 = \\frac{\\sum(x_i - \\bar{x})(y_i - \\bar{y})}{\\sum(x_i - \\bar{x})^2}',
    relatedTerms: ['correlation', 'trend', 'loess'],
  },
  {
    id: 'granger-causality',
    term: 'Granger Causality',
    category: 'statistics',
    aliases: ['Granger Test', 'Predictive Causality'],
    quick:
      'A test of whether the past of one series helps predict another beyond that series’ own past — predictive precedence, not proof of true causation.',
    standard:
      'Granger causality asks a forecasting question: do past values of X improve the prediction of Y beyond what Y’s own past already provides? It fits two nested vector-autoregression (VAR) models — one using only Y’s lagged history, one adding X’s lagged history — and compares them with an F-test. A significant result means X has predictive precedence over Y. Crucially it is NOT proof of physical causation: a lurking third variable that drives both series can produce the same pattern. X→Y and Y→X are separate tests, and the two directions can disagree.',
    detailed:
      'For a chosen lag p, the test compares a restricted AR model y_t = Σ αᵢ y_{t−i} + ε against an unrestricted VAR model y_t = Σ αᵢ y_{t−i} + Σ βᵢ x_{t−i} + ε, and tests H₀: all βᵢ = 0 with an F-statistic on the residual sum of squares. Rejecting H₀ means X’s lagged values carry information about Y not already in Y’s past. In CPAP Analyzer the unit of observation is one value per night, so a "lag" is a number of nights. Interpretation guidance: (1) Read it as predictive precedence, never as a mechanism — confounding by a common driver (a behavior, illness, or seasonal factor affecting both metrics) yields the same signal. (2) The reported F-statistic, p-value, and lag describe the X→Y direction only; the verdict and confidence consider both directions, and X→Y ≠ Y→X in general. (3) If the lag was chosen by minimizing AIC on the same nights used for the test, the p-value is selection-affected (exploratory / anti-conservative) and understates the true false-positive rate — treat it as hypothesis-generating and confirm with a fixed lag chosen from prior knowledge or a separate time period. (4) The VAR F-test assumes (trend-)stationary inputs; a shared deterministic trend can manufacture spurious Granger causality, so a significant linear trend in either series triggers a non-stationarity caution and first-differencing is advised. Requirements: at least 2·maxLag + 2 paired nights, roughly equal time spacing, and a non-constant metric (a constant series carries no information to test). This tool reports Granger results for exploration and does not diagnose.',
    relatedTerms: ['f-test', 'aic', 'stationarity', 'correlation', 'p-value'],
    references: [
      'Granger, C. W. J. (1969). Investigating causal relations by econometric models and cross-spectral methods. Econometrica, 37(3), 424–438. DOI: 10.2307/1912791.',
      'Granger, C. W. J., & Newbold, P. (1974). Spurious regressions in econometrics. Journal of Econometrics, 2(2), 111–120. DOI: 10.1016/0304-4076(74)90034-7.',
      'Leeb, H., & Pötscher, B. M. (2005). Model selection and inference: facts and fiction. Econometric Theory, 21(1), 21–59. DOI: 10.1017/S0266466605050036.',
    ],
  },
  {
    id: 'f-test',
    term: 'F-test',
    category: 'statistics',
    aliases: ['F-statistic', 'F-ratio'],
    quick:
      'A test comparing two nested models (or two variances) via a ratio that follows the F-distribution under the null.',
    standard:
      'An F-test compares the fit of two nested models by forming a ratio of explained to unexplained variance. In a nested-model setting, it asks whether the extra parameters in the larger model reduce the residual sum of squares (RSS) by more than chance would predict. A large F-statistic — and the small p-value it implies — is evidence that the added terms matter. The Granger causality test is an F-test of whether adding another series’ lagged history improves the prediction of the target.',
    detailed:
      'For nested models with the larger (unrestricted) model adding q parameters, F = [(RSS_restricted − RSS_unrestricted)/q] / [RSS_unrestricted/(n − k)], where n is the sample size and k is the number of parameters in the unrestricted model. Under H₀ (the added parameters are jointly zero) and the usual linear-model assumptions, F follows an F-distribution with (q, n − k) degrees of freedom; the p-value is the upper-tail probability. Assumptions include linearity, independent and (approximately) normally distributed errors with constant variance. CPAP Analyzer derives the p-value from the F-distribution using the regularized incomplete beta function. Caveat for the Granger setting: when the model (here, the lag) is chosen from the same data the F-test is then run on, the nominal F p-value no longer has its advertised false-positive rate — it becomes selection-affected.',
    formula:
      'F = \\frac{(\\text{RSS}_{\\text{restricted}} - \\text{RSS}_{\\text{unrestricted}})/q}{\\text{RSS}_{\\text{unrestricted}}/(n - k)}',
    relatedTerms: ['granger-causality', 'p-value', 'regression', 'aic'],
  },
  {
    id: 'aic',
    term: 'AIC (Akaike Information Criterion)',
    category: 'statistics',
    aliases: ['Akaike Information Criterion'],
    quick:
      'A model-selection score balancing goodness of fit against complexity — lower AIC indicates a better-fitting, less-overfit model.',
    standard:
      'The Akaike Information Criterion (AIC) scores a fitted model by trading off how well it fits the data against how many parameters it uses. Lower AIC is better: it rewards reducing residual error but penalizes each extra parameter, discouraging overfitting. AIC is used to pick a lag order in Granger causality — the candidate lag with the lowest AIC is the one tested. Because that lag is chosen from the same data, the subsequent p-value is selection-affected, which is exactly why the AIC-selected (Exploratory) result is flagged as anti-conservative.',
    detailed:
      'AIC = 2k − 2 ln(L̂), where k is the number of estimated parameters and L̂ is the maximized likelihood. For Gaussian errors this reduces to AIC = n·ln(RSS/n) + 2k (up to an additive constant), the form CPAP Analyzer uses per candidate lag for the unrestricted X→Y model. AIC estimates relative out-of-sample predictive loss (Kullback–Leibler divergence from the true process), so it is a tool for comparison, not an absolute measure of fit; only differences in AIC between models are meaningful. In the Granger AIC-by-lag chart, each point is the AIC for that lag’s model and the lowest point is the lag selected in Exploratory mode; infeasible lags (too few paired nights to fit the model) appear as gaps. Choosing the lag by minimizing AIC and then testing at that lag on the same data makes the F p-value post-selection — anti-conservative — so a clean inferential p-value requires fixing the lag in advance (Confirmatory mode). Related criteria: BIC (2k replaced by k·ln n) penalizes complexity more heavily.',
    formula:
      '\\text{AIC} = 2k - 2\\ln(\\hat{L}) = n\\ln\\!\\left(\\frac{\\text{RSS}}{n}\\right) + 2k',
    relatedTerms: ['granger-causality', 'f-test', 'regression'],
    references: [
      'Akaike, H. (1974). A new look at the statistical model identification. IEEE Transactions on Automatic Control, 19(6), 716–723. DOI: 10.1109/TAC.1974.1100705.',
    ],
  },
  {
    id: 'stationarity',
    term: 'Stationarity',
    category: 'statistics',
    aliases: ['Stationary Series', 'Non-stationarity'],
    quick:
      'A time series is stationary when its statistical properties (notably the mean) do not change over time; a trend violates this.',
    standard:
      'A time series is (weakly) stationary when its mean, variance, and autocovariance structure are constant over time. Many time-series tests, including the Granger causality F-test, assume their inputs are at least trend-stationary. A series with a persistent upward or downward drift is non-stationary. This matters because two unrelated series that happen to share a trend can appear strongly related — a shared deterministic trend can manufacture spurious Granger causality. The usual remedy is first-differencing: analyze night-to-night changes rather than levels.',
    detailed:
      'Weak (covariance) stationarity requires a constant mean E[x_t] = μ, a constant finite variance, and an autocovariance Cov(x_t, x_{t+h}) that depends only on the lag h, not on t. CPAP nightly series frequently violate this — acclimatization, weight change, seasonal leak, or equipment changes induce trends. The classic hazard is spurious regression (Granger & Newbold 1974): regressing one trending series on another independent trending series yields significant-looking coefficients and high R² driven entirely by the shared trend, not any real relationship; the same mechanism inflates Granger causality. CPAP Analyzer runs a lightweight test for a significant deterministic linear trend in each input and raises a non-stationarity caution when one is found. Remedies: first-differencing (Δx_t = x_t − x_{t−1}) removes a linear trend and often restores stationarity; detrending by regression, or differencing again for stronger trends, are alternatives. Formal unit-root tests (ADF, KPSS) characterize stationarity more rigorously than the linear-trend screen used here.',
    relatedTerms: ['granger-causality', 'trend', 'regression'],
    references: [
      'Granger, C. W. J., & Newbold, P. (1974). Spurious regressions in econometrics. Journal of Econometrics, 2(2), 111–120. DOI: 10.1016/0304-4076(74)90034-7.',
    ],
  },

  // ─── DATA & FORMATS ────────────────────────────────────────────────

  {
    id: 'edf',
    term: 'EDF (European Data Format)',
    category: 'data',
    aliases: ['European Data Format', 'EDF+'],
    quick:
      'A standard file format for storing physiological time-series signals like those from CPAP machines.',
    standard:
      'EDF is the standard file format used by CPAP machines (including ResMed) to store detailed time-series data. Each EDF file contains one or more signal channels (e.g., flow, pressure, leak) sampled at specific rates (typically 25 Hz for flow/pressure). The format was originally designed for EEG data and has been widely adopted in sleep medicine.',
    detailed:
      'EDF specification (Kemp et al., 1992): Fixed-size header (256 bytes + 256 bytes per signal) containing patient info, recording info, number of signals, labels, units, sample rates, and physical/digital ranges. Data records contain interleaved signal samples in 16-bit integers, scaled to physical units using: physical = (digital - digital_min) × (physical_max - physical_min) / (digital_max - digital_min) + physical_min. EDF+ (Kemp & Olivan, 2003) adds annotations, discontinuous recordings, and fractional sample rates. ResMed stores detailed flow/pressure data in DATALOG EDF files organized by date directory.',
    relatedTerms: ['session', 'signal', 'channel', 'sample-rate'],
    references: [
      'Kemp, B., Värri, A., Rosa, A. C., Nielsen, K. D., & Gade, J. (1992). A simple format for exchange of digitized polygraphic recordings. Electroencephalography and Clinical Neurophysiology, 82(5), 391–393. DOI: 10.1016/0013-4694(92)90009-7.',
      'Kemp, B., & Olivan, J. (2003). European data format "plus" (EDF+). Clinical Neurophysiology, 114(9), 1755–1761. DOI: 10.1016/S1388-2457(03)00123-8.',
    ],
  },
  {
    id: 'session',
    term: 'Session',
    category: 'data',
    aliases: ['Sleep Session', 'Therapy Session'],
    quick:
      'A single continuous period of CPAP usage, typically corresponding to one night of sleep.',
    standard:
      'A session represents one continuous period of CPAP therapy, from when the mask is put on to when it is removed. Most patients have one session per night, but some may have multiple (e.g., removing the mask and reapplying later). Session data includes usage duration, AHI, leak statistics, pressure data, and detailed signal recordings.',
    detailed:
      'Session boundaries are defined by mask-on/mask-off events detected via pressure-flow feedback. Minimum session duration is typically 1–2 minutes to avoid counting brief mask trials. ResMed devices store session summaries in the STR.edf file and detailed signals in per-date DATALOG directories. A single date directory may contain multiple sessions if the mask was removed and reapplied. Session aggregation: nightly statistics combine all sessions in a calendar night (defined by "day starts at" setting, typically noon). Multiple short sessions may indicate mask discomfort, claustrophobia, or nocturia interrupting therapy.',
    relatedTerms: ['edf', 'usage-hours'],
  },
  {
    id: 'background-import',
    term: 'Background Import',
    category: 'data',
    aliases: ['Background Import Indicator', 'Import Progress Pill'],
    quick:
      'An import that keeps running while you use the rest of the app, shown by a persistent progress indicator.',
    standard:
      'A background import runs without holding you on the import screen. After you start it, you can navigate anywhere in CPAP Analyzer while the import continues, tracked by a small progress pill at the bottom-left of every screen. Expanding the pill shows each stage of the import and its state, lets you cancel, and a toast announces completion. All work remains client-side; nothing is uploaded.',
    detailed:
      "Because CPAP Analyzer is entirely client-side, an import is driven inside the browser tab rather than by a server-side job. The background-import design moves the import's control loop off any single view so it survives navigation between views, and surfaces a single, app-wide progress indicator (the bottom-left pill, expandable to a detail panel with per-stage state and a Cancel button, plus a completion toast). Progress is multi-stage: a CPAP SD-card import reports scanning → parsing → building sessions → storing, and a Google Health (Fitbit) import reports scanning → a determinate sub-progress row per discovered data type. Results are written durably and incrementally, so cancelling, or closing the tab mid-import, never corrupts data — already-stored nights and records remain valid, and re-importing resumes by skipping duplicates. The indicator is keyboard-accessible and announces progress to assistive technology through a polite ARIA live region.",
    relatedTerms: ['session', 'intraday', 'edf'],
  },
  {
    id: 'intraday',
    term: 'Intraday',
    category: 'data',
    aliases: ['Intraday Data', 'Intraday Series'],
    quick:
      'High-resolution, within-day samples (e.g. heart rate every few seconds) rather than a single daily summary value.',
    standard:
      'Intraday data is recorded many times across a single day, preserving how a value changes through the day and night, rather than collapsing it to one daily number. In a Google Health (Fitbit) export, intraday heart rate is sampled roughly every 5 seconds, and SpO\\u2082, HRV, and snoring also carry intraday detail. CPAP Analyzer imports these full-resolution series so wearable signals can be overlaid against your CPAP airflow within the same night.',
    detailed:
      '"Intraday" distinguishes a within-day time series from a daily summary: a daily resting heart rate is one number per day, whereas intraday heart rate is a dense series (~5-second cadence) showing the shape of your heart rate across the night. These series are large — intraday heart rate alone is on the order of 0.4–0.6 MB per day — which is why their import runs off the main thread (in Web Workers) with granular, determinate progress, so the interface stays responsive during a big wearable import. Full resolution is retained on purpose: it preserves short-timescale features (for example, the cyclic variation of heart rate around respiratory events) that a daily summary would erase. All parsing and storage are client-side; nothing leaves your browser.',
    relatedTerms: ['background-import', 'sample-rate', 'signal'],
  },
  {
    id: 'signal',
    term: 'Signal',
    category: 'data',
    aliases: ['Time Series', 'Waveform'],
    quick:
      'A continuous stream of measurements over time, such as airflow or pressure readings from a CPAP machine.',
    standard:
      'A signal is a sequence of data points measured at regular intervals (the sample rate). CPAP machines record multiple signals simultaneously: flow rate (in L/min), mask pressure (cmH₂O), leak rate, and sometimes SpO₂. These signals enable detailed analysis of breathing patterns, event detection, and therapy effectiveness.',
    detailed:
      'Key CPAP signals: (1) Flow — respiratory airflow measured by pressure transducer, typically 25 Hz, shows inspiratory/expiratory pattern; (2) Mask Pressure — delivered pressure, 25 Hz, reveals APAP adjustments and EPR modulation; (3) Leak — calculated from flow/pressure relationship, typically 2 Hz; (4) Tidal Volume — derived from flow signal integration per breath; (5) Minute Ventilation — derived from tidal volume × respiratory rate; (6) SpO₂ — if oximetry connected, typically 1 Hz. Signal processing considerations: anti-aliasing filters, digital resolution (16-bit), baseline drift correction, artifact rejection.',
    relatedTerms: ['channel', 'sample-rate', 'edf'],
  },
  {
    id: 'channel',
    term: 'Channel',
    category: 'data',
    quick:
      'A single signal type within a recording — each channel records one measurement (e.g., flow, pressure, leak).',
    standard:
      'A channel is one specific measurement stream within a multi-channel recording. An EDF file contains multiple channels, each with its own label, physical unit, sample rate, and calibration. For example, a ResMed CPAP recording might include channels for Flow, Pressure, Leak, and SpO₂, all recorded simultaneously.',
    detailed:
      'EDF channel header fields: label (e.g., "Flow"), transducer type, physical dimension (unit), physical minimum/maximum, digital minimum/maximum, prefiltering, number of samples per data record. ResMed channel labels: "Flow" (L/min), "Mask Pressure" (cmH₂O), "Leak" (L/min), "Resp Rate" (/min), "Ti" (inspiratory time, s), "Te" (expiratory time, s), "Vt" (tidal volume, mL), "MV" (minute ventilation, L/min). Different channels may have different sample rates within the same file.',
    relatedTerms: ['signal', 'edf', 'sample-rate'],
  },
  {
    id: 'sample-rate',
    term: 'Sample Rate',
    category: 'data',
    aliases: ['Sampling Rate', 'Sampling Frequency'],
    quick: 'How many measurements per second a signal records — higher rates capture more detail.',
    standard:
      'Sample rate is the number of data points recorded per second, measured in Hertz (Hz). ResMed CPAP devices typically record flow and pressure at 25 Hz (25 samples per second) and summary metrics like leak rate at 2 Hz. Higher sample rates capture more detail but create larger files. For respiratory signals, 25 Hz is sufficient to characterize breathing patterns.',
    detailed:
      'Nyquist theorem: to accurately capture a signal, the sample rate must be at least 2× the highest frequency component. Normal respiratory rate is 0.2–0.5 Hz; snoring is 30–300 Hz; the 25 Hz CPAP sample rate captures respiratory patterns well but aliases snoring. ResMed data record sizes: 2-second data records with 50 samples per record for 25 Hz channels. Total signal data per night (8 hours): ~720,000 samples per channel at 25 Hz, ~57,600 at 2 Hz. Storage: 16 bits/sample × 50 samples/record × 4 channels × 14,400 records ≈ 20–30 MB per night for detailed data.',
    relatedTerms: ['signal', 'downsampling', 'edf'],
  },
  {
    id: 'downsampling',
    term: 'Downsampling',
    category: 'data',
    aliases: ['Decimation'],
    quick:
      'Reducing the number of data points by keeping only every Nth sample, used to make large datasets manageable.',
    standard:
      'Downsampling reduces the resolution of a signal by keeping fewer data points. This is necessary for visualization — a display that is 1920 pixels wide cannot meaningfully render 720,000 data points. Downsampling algorithms like LTTB (Largest Triangle Three Buckets) preserve visual shape while dramatically reducing point count.',
    detailed:
      'Methods: (1) Simple decimation — keep every Nth sample (fast but may alias); (2) Low-pass filter then decimate (anti-aliased, preserves frequency content below new Nyquist); (3) Min-max decimation — keep local min and max in each bucket (preserves envelope); (4) LTTB — keeps the point that forms the largest triangle with neighbors (best visual preservation). For CPAP signal visualization: LTTB or min-max downsampling to 2×screen width in pixels. Progressive loading: display overview at heavy downsampling, increase resolution on zoom. Always process statistical calculations on full-resolution data, not downsampled data.',
    relatedTerms: ['lttb', 'sample-rate', 'signal'],
  },
  {
    id: 'lttb',
    term: 'LTTB (Largest Triangle Three Buckets)',
    category: 'data',
    aliases: ['Largest Triangle Three Buckets'],
    quick:
      'A downsampling algorithm that preserves visual shape by selecting the most visually significant points.',
    standard:
      'LTTB is a downsampling algorithm specifically designed for time-series visualization. It divides data into equal-sized buckets and selects the point in each bucket that, together with the selected points in adjacent buckets, forms the largest triangle (maximizes visual area). The result closely resembles the original signal shape with far fewer points.',
    detailed:
      'LTTB algorithm (Sveinn Steinarsson, 2013): (1) First and last points are always kept. (2) Remaining data is split into n−2 equal buckets. (3) For each bucket, select the point that maximizes the triangle area formed with the previously selected point and the average of the next bucket. Time complexity: O(n) — single pass. Space complexity: O(1) additional beyond input/output. LTTB outperforms other methods (min-max, mode-median, random) in preserving visual similarity as measured by SSE (Sum of Squared Errors). For 8-hour CPAP recordings at 25 Hz (720K points), LTTB to 2000 points provides excellent visual fidelity for screen display.',
    relatedTerms: ['downsampling', 'sample-rate'],
    references: [
      'Steinarsson, S. (2013). Downsampling time series for visual representation (MSc thesis). University of Iceland.',
    ],
  },

  // ─── WEATHER & ENVIRONMENT ──────────────────────────────────────────

  {
    id: 'barometric-pressure',
    term: 'Barometric Pressure (Atmospheric Pressure)',
    category: 'data',
    aliases: ['Atmospheric Pressure', 'Air Pressure', 'Mean Sea-Level Pressure', 'MSLP'],
    quick:
      'The weight of the atmosphere pressing on a location, reported in hectopascals (hPa) or inches of mercury (inHg); its swings are the headline weather variable correlated against apnea and central events.',
    standard:
      'Barometric (atmospheric) pressure is the force per unit area exerted by the column of air above a point. The Weather & Environment integration reports it as mean sea-level pressure so values are comparable across elevations, in hectopascals (hPa; 1 hPa = 1 millibar) or inches of mercury (inHg) per your unit preference, with a typical sea-level value near 1013 hPa (29.92 inHg). For a recorded night it is summarized as the overnight mean over the [sleep start, sleep end) window. Pressure is treated as the headline environmental variable because changes in ambient pressure can plausibly modify sleep-disordered breathing — a passing weather system (a falling barometer) is a candidate driver of a worse night.',
    detailed:
      'Standard atmosphere is 1013.25 hPa = 29.92 inHg = 760 mmHg. Open-Meteo reports both surface pressure (at the station altitude) and mean sea-level pressure (MSLP, altitude-normalized); the integration uses MSLP as the headline series so day-to-day swings are not confounded by elevation. Conversion: 1 hPa = 0.02953 inHg; 1 inHg = 33.864 hPa. Why pressure may matter for sleep-disordered breathing: ambient pressure sets the partial pressures of the gases already in the lungs, and the respiratory control system regulates breathing against CO₂ and O₂ chemoreflexes whose behaviour (loop gain) is sensitive to those partial pressures and to how quickly they change. A drop in ambient pressure, like a passing low-pressure weather system or a gain in altitude, can shift the balance between obstructive and central events — most relevantly by raising loop gain and thereby the tendency toward central / periodic breathing. Because a weather system can change pressure a day before it changes your night, the effect is often best examined with lagged cross-correlation (comparing pressure on day t against events on day t or t+1) rather than a same-day correlation. This is an association to explore, not an established mechanism in any individual; CPAP Analyzer does not diagnose.',
    relatedTerms: [
      'dewpoint',
      'relative-humidity',
      'overnight-window',
      'loop-gain',
      'central-apnea',
    ],
    references: [
      'World Meteorological Organization (2018). Guide to Instruments and Methods of Observation (WMO-No. 8), Volume I: Measurement of Meteorological Variables. — Definitions of station and mean-sea-level pressure and standard units.',
      'White, D. P. (2005). Pathogenesis of obstructive and central sleep apnea. American Journal of Respiratory and Critical Care Medicine, 172(11), 1363–1370. DOI: 10.1164/rccm.200412-1631SO. — Loop gain and the chemoreflex control of breathing underlying the obstructive/central balance.',
    ],
  },
  {
    id: 'relative-humidity',
    term: 'Relative Humidity',
    category: 'data',
    aliases: ['Humidity', 'RH'],
    quick:
      'The amount of water vapour in the air expressed as a percentage of the maximum the air can hold at its current temperature (0–100%).',
    standard:
      'Relative humidity (RH) is the ratio of the actual water-vapour content of the air to the saturation content at the same temperature, reported as a percentage from 0% (bone dry) to 100% (saturated, where dew or fog forms). Because the saturation capacity rises steeply with temperature, the same absolute amount of moisture gives a high RH on a cold night and a lower RH on a warm one — so RH alone can be misleading about how "moist" the air feels (see Dewpoint for a temperature-independent measure). The Weather & Environment integration reports RH as the overnight mean over the [sleep start, sleep end) window. Ambient humidity is offered as secondary context for nasal congestion and comfort; it is not a headline therapy driver.',
    detailed:
      "RH = (e / e_s(T)) × 100%, where e is the actual vapour pressure and e_s(T) is the saturation vapour pressure at air temperature T. Saturation vapour pressure follows the Clausius–Clapeyron relation, roughly doubling for every ~10 °C rise, which is why RH and dewpoint diverge: dewpoint tracks the absolute moisture content directly, whereas RH is that content normalized by a temperature-dependent ceiling. For interpreting therapy, dewpoint is usually the more stable companion variable because it is not confounded by overnight temperature swings. Note that ambient (room) humidity is distinct from the humidity your CPAP delivers, which is set by the machine's heated humidifier; the integration measures outdoor ambient conditions at your rounded coordinates, not the air at the mask. Read RH as comfort/context, not as a measured property of your delivered therapy.",
    relatedTerms: ['dewpoint', 'barometric-pressure', 'overnight-window'],
    references: [
      'World Meteorological Organization (2018). Guide to Instruments and Methods of Observation (WMO-No. 8), Volume I. — Definitions of relative humidity and dewpoint.',
      'Lawrence, M. G. (2005). The relationship between relative humidity and the dewpoint temperature in moist air: A simple conversion and applications. Bulletin of the American Meteorological Society, 86(2), 225–233. DOI: 10.1175/BAMS-86-2-225.',
    ],
  },
  {
    id: 'dewpoint',
    term: 'Dewpoint',
    category: 'data',
    aliases: ['Dew Point', 'Dew-Point Temperature'],
    quick:
      'The temperature to which air must be cooled (at constant pressure) for its water vapour to saturate and condense; a temperature-independent measure of how moist the air actually is.',
    standard:
      'Dewpoint is the temperature at which the air, cooled at constant pressure, would reach 100% relative humidity and begin to condense. Unlike relative humidity, dewpoint reflects the absolute moisture content of the air directly and does not change as the air warms or cools through the night, which makes it a more stable companion variable for correlation. It is reported in °C or °F per your unit preference and, for a recorded night, summarized as the overnight mean over the [sleep start, sleep end) window. A higher dewpoint means muggier, more moisture-laden air; a low dewpoint means dry air. As a rule of thumb, dewpoints below ~10 °C feel dry, ~10–16 °C comfortable, and above ~18 °C distinctly humid.',
    detailed:
      'Dewpoint T_d is defined implicitly by e_s(T_d) = e, where e is the actual vapour pressure and e_s is the saturation vapour pressure; equivalently it is the temperature at which RH would equal 100%. Because e is a property of the air mass and changes only when moisture is added or removed, dewpoint is conserved as the air is heated or cooled — the reason it is preferred over RH when you want a single number for "how much water is in the air" across a night with swinging temperature. Dewpoint is always less than or equal to the air temperature; the gap between them (the dewpoint depression) is small when the air is near saturation and large when it is dry. The integration provides dewpoint as secondary, non-judgemental context (its dashboard trend is neutral — there is no universally "better" direction); it is offered for comfort and congestion correlation, not as a clinical metric.',
    relatedTerms: ['relative-humidity', 'barometric-pressure', 'overnight-window'],
    references: [
      'Lawrence, M. G. (2005). The relationship between relative humidity and the dewpoint temperature in moist air: A simple conversion and applications. Bulletin of the American Meteorological Society, 86(2), 225–233. DOI: 10.1175/BAMS-86-2-225.',
      'World Meteorological Organization (2018). Guide to Instruments and Methods of Observation (WMO-No. 8), Volume I. — Dewpoint definition and measurement.',
    ],
  },
  {
    id: 'aqi',
    term: 'AQI (Air Quality Index)',
    category: 'data',
    aliases: ['Air Quality Index', 'US AQI', 'European AQI', 'EAQI'],
    quick:
      'A unitless 0-up index that compresses several pollutant concentrations into one ranked, plain-language air-quality category (e.g. Good, Moderate, Unhealthy); the app shows both the US and the European scheme.',
    standard:
      'The Air Quality Index (AQI) translates measured pollutant concentrations — PM2.5, PM10, ozone (O₃), nitrogen dioxide (NO₂) and others — into a single dimensionless number and a ranked category word, so that "the air today" can be read at a glance. The Weather & Environment integration surfaces two parallel schemes because they differ in scale and labels: the US AQI (a 0–500 scale with six categories, where the overall value is driven by whichever pollutant is worst) and the European AQI (EAQI, a six-band scheme from Good to Extremely Poor). Lower is better in both. Because AQI is the one environmental metric with a clear "good" direction, it is the only weather tile whose trend is shown as favourable/unfavourable rather than neutral, and its severity is always conveyed by the category word and the number and a hatch pattern — never colour alone.',
    detailed:
      'US AQI is a piecewise-linear transform: for each pollutant, the measured concentration is mapped onto a 0–500 index via published breakpoint tables, and the reported AQI is the maximum across pollutants (the "dominant pollutant" sets the value). Its six categories are Good (0–50), Moderate (51–100), Unhealthy for Sensitive Groups (101–150), Unhealthy (151–200), Very Unhealthy (201–300), and Hazardous (301–500). The European AQI is computed differently — each pollutant is binned into one of six bands (Good, Fair, Moderate, Poor, Very Poor, Extremely Poor) and the overall index is the worst band among the pollutants — so the same air can read as a different word under each scheme; that is expected, and the app labels which scheme a value belongs to. AQI is unitless by construction (it is an index, not a concentration). The integration computes the overnight AQI statistic from the provider\'s hourly values over the [sleep start, sleep end) window, and stores air quality only where the provider has data — air-quality history is shallow and region-dependent, so older or non-European nights may legitimately show "No data available" (a dash), distinct from an error. AQI is environmental context for exploration, not a clinical measurement of your airway or your therapy.',
    relatedTerms: ['pm2-5', 'pm10', 'ozone', 'nitrogen-dioxide', 'overnight-window'],
    references: [
      'United States Environmental Protection Agency (2024). Technical Assistance Document for the Reporting of Daily Air Quality — the Air Quality Index (AQI). EPA-454/B-24-002. — US AQI breakpoints and categories.',
      'European Environment Agency. European Air Quality Index. https://www.eea.europa.eu/themes/air/air-quality-index — EAQI bands and method.',
    ],
  },
  {
    id: 'pm2-5',
    term: 'PM2.5 (Fine Particulate Matter)',
    category: 'data',
    aliases: ['PM2.5', 'Fine Particulate Matter', 'Fine Particles'],
    quick:
      'Airborne particles 2.5 micrometres in diameter or smaller, reported in micrograms per cubic metre (µg/m³); small enough to reach deep into the lungs.',
    standard:
      'PM2.5 is the mass concentration of airborne particulate matter with an aerodynamic diameter of 2.5 micrometres (µm) or less, reported in micrograms per cubic metre of air (µg/m³). These fine particles — from combustion, traffic, wildfire smoke, and secondary chemistry — are small enough to penetrate deep into the respiratory tract and are the pollutant most consistently linked to respiratory and cardiovascular health effects. PM2.5 is one of the primary inputs to the AQI. The integration summarizes it as the overnight statistic over the [sleep start, sleep end) window and offers it as environmental context to correlate against your therapy.',
    detailed:
      'PM2.5 is defined by a size-selective sampling convention (particles with a 50% cut-point at 2.5 µm aerodynamic diameter), reported as a mass concentration in µg/m³. For orientation, the WHO 2021 air-quality guideline sets the 24-hour PM2.5 limit at 15 µg/m³ and the annual limit at 5 µg/m³; values during wildfire smoke episodes can reach hundreds of µg/m³. Because PM2.5 deposits in the small airways and alveoli, it is the dominant driver of the health-protective AQI on many days. Within this tool PM2.5 is descriptive context drawn from a third-party model at your rounded coordinates — a regional estimate, not a measurement at your bedside — and is provided to support exploratory correlation, not clinical assessment. Its history in the air-quality archive is shallow and region-dependent, so older nights may have no value.',
    relatedTerms: ['pm10', 'aqi', 'ozone', 'nitrogen-dioxide', 'overnight-window'],
    references: [
      'World Health Organization (2021). WHO global air quality guidelines: particulate matter (PM2.5 and PM10), ozone, nitrogen dioxide, sulfur dioxide and carbon monoxide. Geneva: WHO. — PM2.5 definition and guideline limits.',
    ],
  },
  {
    id: 'pm10',
    term: 'PM10 (Coarse Particulate Matter)',
    category: 'data',
    aliases: ['PM10', 'Coarse Particulate Matter', 'Inhalable Particles'],
    quick:
      'Airborne particles 10 micrometres in diameter or smaller, reported in micrograms per cubic metre (µg/m³); inhalable, and includes dust and pollen fragments as well as the finer PM2.5.',
    standard:
      'PM10 is the mass concentration of airborne particulate matter with an aerodynamic diameter of 10 micrometres or less, in micrograms per cubic metre (µg/m³). It is the broader "inhalable" fraction: by definition it includes all of PM2.5 plus the coarser particles between 2.5 and 10 µm, such as wind-blown dust, road dust, and fragments of pollen and mould. PM10 is an AQI input and is summarized over the overnight [sleep start, sleep end) window. Like the other pollutants it is provided as environmental context, not a clinical measurement.',
    detailed:
      'PM10 uses a size-selective convention with a 50% cut-point at 10 µm aerodynamic diameter and is reported in µg/m³; it is a superset of PM2.5, so PM10 ≥ PM2.5 always. The coarse fraction (PM10 minus PM2.5, sometimes written PM10–2.5) deposits higher in the airways than fine particles. WHO 2021 guideline limits are 45 µg/m³ over 24 hours and 15 µg/m³ annually. Note that the coarse fraction can include pollen fragments, but PM10 is not a pollen count and the app does not surface pollen as a separate metric (pollen has no historical archive and is deferred). As with all air-quality variables here, PM10 is a regional model estimate at your rounded coordinates intended for exploratory correlation, with shallow, region-dependent history that may legitimately read "No data available" for older or non-European nights.',
    relatedTerms: ['pm2-5', 'aqi', 'ozone', 'nitrogen-dioxide', 'overnight-window'],
    references: [
      'World Health Organization (2021). WHO global air quality guidelines: particulate matter (PM2.5 and PM10), ozone, nitrogen dioxide, sulfur dioxide and carbon monoxide. Geneva: WHO. — PM10 definition and guideline limits.',
    ],
  },
  {
    id: 'ozone',
    term: 'Ozone (O₃)',
    category: 'data',
    aliases: ['O3', 'O₃', 'Ground-Level Ozone', 'Tropospheric Ozone'],
    quick:
      'A reactive gas (O₃) formed near the ground by sunlight acting on traffic and industrial emissions; a respiratory irritant, reported in micrograms per cubic metre (µg/m³).',
    standard:
      'Ozone (O₃) at ground level is a secondary pollutant: it is not emitted directly but forms when sunlight drives chemical reactions among nitrogen oxides and volatile organic compounds from traffic, industry, and solvents. (This tropospheric ozone is distinct from the protective stratospheric ozone layer high above.) It is a strong respiratory irritant that peaks on hot, sunny afternoons and is one of the pollutants feeding the AQI. The integration reports it in micrograms per cubic metre (µg/m³), summarized over the overnight [sleep start, sleep end) window, as environmental context.',
    detailed:
      'Ground-level O₃ is produced photochemically (NOₓ + VOCs + sunlight), so its concentration has a strong diurnal and seasonal cycle, typically highest in the afternoon and in warm months, and lowest overnight — which is worth bearing in mind when reading an overnight ozone summary, since the nocturnal window often captures ozone near its daily minimum. Open-Meteo reports O₃ as a mass concentration in µg/m³ (regulatory limits are sometimes expressed instead as a maximum daily 8-hour mean; the WHO 2021 guideline peak-season limit is 60 µg/m³ and the short-term 8-hour limit 100 µg/m³). As a respiratory irritant ozone is biologically plausible context for airway symptoms, but within this tool it is a regional model estimate for exploratory correlation only, not a clinical measurement, with shallow and region-dependent history.',
    relatedTerms: ['nitrogen-dioxide', 'pm2-5', 'pm10', 'aqi', 'overnight-window'],
    references: [
      'World Health Organization (2021). WHO global air quality guidelines: particulate matter, ozone, nitrogen dioxide, sulfur dioxide and carbon monoxide. Geneva: WHO. — Ozone definition, formation, and guideline limits.',
    ],
  },
  {
    id: 'nitrogen-dioxide',
    term: 'Nitrogen Dioxide (NO₂)',
    category: 'data',
    aliases: ['NO2', 'NO₂'],
    quick:
      'A reddish-brown gas (NO₂) from combustion — chiefly traffic — that irritates the airways and is a marker of urban/traffic pollution, reported in micrograms per cubic metre (µg/m³).',
    standard:
      'Nitrogen dioxide (NO₂) is a combustion by-product, emitted mainly by motor vehicles and other fuel burning, and is a useful marker of traffic-related air pollution. It is a respiratory irritant in its own right and also a precursor in the chemistry that forms ground-level ozone and fine particles. The integration reports NO₂ in micrograms per cubic metre (µg/m³), summarized over the overnight [sleep start, sleep end) window, and includes it as one of the AQI-driving pollutants offered as environmental context.',
    detailed:
      'NO₂ is one of the nitrogen oxides (NOₓ) produced when fuel burns at high temperature; concentrations are highest near busy roads and during traffic peaks, giving it a pronounced spatial gradient that a coarse, ~1.1 km-rounded coordinate can only partly resolve. It is reported here as a mass concentration in µg/m³; the WHO 2021 guideline sets a 24-hour limit of 25 µg/m³ and an annual limit of 10 µg/m³. NO₂ both irritates the airways directly and participates in the photochemistry that generates ozone and secondary particulate, so it tends to co-vary with those pollutants. As with every air-quality variable here, NO₂ is a third-party regional model estimate at your rounded coordinates, provided for exploratory correlation rather than clinical assessment, with shallow and region-dependent historical coverage.',
    relatedTerms: ['ozone', 'pm2-5', 'pm10', 'aqi', 'overnight-window'],
    references: [
      'World Health Organization (2021). WHO global air quality guidelines: particulate matter, ozone, nitrogen dioxide, sulfur dioxide and carbon monoxide. Geneva: WHO. — NO₂ definition, sources, and guideline limits.',
    ],
  },
  {
    id: 'overnight-window',
    term: 'Overnight Aggregation Window',
    category: 'data',
    aliases: ['Overnight Window', 'Overnight Aggregation', 'Sleep Window'],
    quick:
      'The half-open wall-clock interval [sleep start, sleep end) over which each environmental metric is reduced to one nightly number, shared identically across every weather surface.',
    standard:
      'The overnight aggregation window is the single, canonical time interval the Weather & Environment integration uses to turn a stream of hourly weather into one number per night. It runs from the start of the recorded night up to — but not including — its end: in interval notation [sleep start, sleep end). The interval is half-open so that the closing instant belongs to the next night\'s bucket and adjacent nights never double-count the boundary hour. The same window is used by the dashboard panel, the Signal-Viewer lanes, and the correlation surface, so a given night\'s weather reads identically everywhere rather than showing three different "last-night" values.',
    detailed:
      'Within the [sleep start, sleep end) window each metric is reduced by a per-metric statistic chosen to be the meaningful one for that variable, and the displayed tile names which statistic it shows: temperature is the overnight low (the minimum across the window); barometric pressure, relative humidity, and dewpoint are the overnight mean (the average across the window); wind is a representative overnight value; and air quality / AQI is the overnight statistic of the hourly index. "Wall-clock" means the interval is defined in the local civil time of the recorded night, aligned to the same local-date keying the app uses for CPAP sessions, so a weather night lines up with the correct CPAP night. A night that crosses midnight (two civil dates) is fetched for both dates and merged into one window. Knowing the exact window and statistic matters for interpretation: when you correlate "overnight pressure" against AHI, you are comparing two summaries computed over the same interval, and a value such as "temperature" is specifically the night\'s coldest point, not its average.',
    relatedTerms: ['barometric-pressure', 'relative-humidity', 'dewpoint', 'aqi'],
  },

  // ─── AI INSIGHTS ───────────────────────────────────────────────────

  {
    id: 'ai-insights',
    term: 'AI Insights',
    category: 'data',
    aliases: ['AI Summaries', 'AI narration'],
    quick:
      "The opt-in, off-by-default feature that uses a language model to phrase the app's already-computed metrics into plain-language summaries — it never computes or diagnoses.",
    standard:
      'AI Insights is an optional CPAP Analyzer feature that turns metrics the app has already calculated into a few sentences of plain-language context (a night summary, a range/trend summary, or an explanation of one metric or chart). It is built on compute-then-narrate: the deterministic analysis pipeline does all the math, and the model only puts the finished numbers into words. It is off by default, runs on one of four user-chosen backends (two fully on-device, two bring-your-own-key cloud), and never diagnoses or recommends changing therapy.',
    detailed:
      'AI Insights is the realisation of ADR 0024. Its load-bearing constraint is that the language model is a narrator, not a calculator: it receives a frozen, aggregate snapshot of already-computed figures and may only select among them, phrase them, and attach the app-authored caveats — it may not compute, average, re-derive, round, extrapolate, classify a severity band, or introduce any number, date, or threshold not present in the snapshot. The feature ships disabled and, while disabled, renders no UI anywhere. When enabled, the user picks a backend along a privacy/quality curve: in-browser WebLLM and Chrome built-in AI run entirely on-device (zero egress), while Claude (Anthropic) browser-direct and any OpenAI-compatible endpoint are bring-your-own-key cloud backends gated by an explicit two-gate egress consent. Correctness is protected by grounding plus a deterministic numeral-validation backstop that rejects any output containing a number the app did not compute, falling back to a templated summary. Every output carries an inseparable "AI-generated — verify against the numbers" caveat and is framed as descriptive, non-diagnostic wellness context. CPAP Analyzer is not a medical device and AI Insights does not diagnose or give medical advice.',
    relatedTerms: [
      'grounding',
      'llm',
      'on-device-llm',
      'hallucination',
      'webllm',
      'chrome-built-in-ai',
      'ai-cloud-backend',
    ],
    references: [
      'CPAP Analyzer ADR 0024 — Grounded, Opt-In AI Insights via a Multi-Backend Provider Abstraction. — Defines compute-then-narrate grounding, the four-backend provider abstraction, two-gate cloud consent, and the non-diagnostic framing.',
    ],
  },
  {
    id: 'grounding',
    term: 'Grounding (compute-then-narrate)',
    category: 'data',
    aliases: ['Compute-then-narrate', 'Grounded generation'],
    quick:
      'The design rule that the app computes every number deterministically and the language model is only allowed to phrase those finished numbers — never to calculate or invent one.',
    standard:
      'Grounding is the practice of constraining a language model to a fixed, already-computed set of facts rather than letting it produce numbers from its own reasoning. In CPAP Analyzer this takes the compute-then-narrate form: the deterministic analysis pipeline calculates all clinical and statistical values, hands the model a structured snapshot of those finished figures, and instructs it to reference only what is in the snapshot — quoting each value and unit exactly and never computing, converting, or introducing a number. Grounding is the accepted mitigation for two well-established weaknesses of language models: weak numeric reasoning (especially in small models) and the tendency of all models to hallucinate.',
    detailed:
      "Grounding works on two layers. First, the input is structured and closed-world: numeric values are sent as their rounded display strings paired with their unit, reliability tier, and availability, and the system prompt forbids the model from computing, summing, averaging, ratioing, rounding, or introducing any figure not literally present — if a needed number is absent, the model must say the information is unavailable rather than fabricate one. Second, a deterministic post-generation validator extracts every numeral from the model's prose and requires each to match an allow-list assembled mechanically from the snapshot; any unmatched number (or a value quoted with the wrong unit, or a severity/compliance verdict that disagrees with the app's own) causes a regeneration and, failing that, a fall back to a plain templated summary. The result is that fabricated figures are designed out: every number a user reads in an AI summary is, by construction, a number the app itself computed. Grounding is what lets a generative surface satisfy the project's non-negotiable Correctness principle.",
    relatedTerms: ['ai-insights', 'llm', 'hallucination'],
    references: [
      'CPAP Analyzer ADR 0024 — Grounded, Opt-In AI Insights via a Multi-Backend Provider Abstraction. — The compute-then-narrate grounding decision and its rationale (LLM numeric weakness and hallucination).',
    ],
  },
  {
    id: 'llm',
    term: 'Large Language Model (LLM)',
    category: 'data',
    aliases: ['LLM', 'Language model'],
    quick:
      'A neural-network model trained on large text corpora to generate fluent natural language; in CPAP Analyzer it only phrases your already-computed numbers, never calculates them.',
    standard:
      'A large language model (LLM) is a machine-learning model — typically a transformer neural network with millions to hundreds of billions of parameters — trained to predict and generate natural-language text. LLMs are good at fluent phrasing and summarisation but are not reliable calculators: they have weak numeric reasoning (more so the smaller they are) and can produce confident but false statements (hallucinations). CPAP Analyzer therefore uses an LLM strictly as a narrator of metrics the app has already computed, behind the grounding and validation guardrails that prevent it from being the source of any number.',
    detailed:
      "LLMs generate text by repeatedly predicting the next token given the preceding context, having learned statistical patterns of language from large corpora. Their fluency makes them well suited to turning a table of numbers into readable prose, but two properties make them unsafe as a source of clinical figures: (1) numeric/arithmetic reasoning is unreliable and degrades in smaller models, and (2) all LLMs hallucinate — they can state plausible-sounding but unfounded facts. CPAP Analyzer mitigates both by never asking the model to compute anything: the model receives finished, rounded values and is constrained — by a closed-world system prompt and a deterministic numeral-validation backstop — to restate only those values. The app can run the model in four ways: two on-device (in-browser WebLLM via WebGPU, and Chrome's built-in Gemini Nano) and two bring-your-own-key cloud APIs (Anthropic's Claude, and any OpenAI-compatible endpoint). The choice of backend trades privacy against phrasing quality; the grounding guarantee is identical across all of them.",
    relatedTerms: ['ai-insights', 'grounding', 'on-device-llm', 'hallucination'],
    references: [
      'Vaswani, A., Shazeer, N., Parmar, N., et al. (2017). Attention Is All You Need. Advances in Neural Information Processing Systems 30 (NeurIPS). — The transformer architecture underlying modern large language models.',
    ],
  },
  {
    id: 'on-device-llm',
    term: 'On-device LLM / WebGPU',
    category: 'data',
    aliases: ['On-device inference', 'WebGPU', 'Local LLM'],
    quick:
      'Running a language model entirely inside your own browser/device (often on the GPU via WebGPU) so that no data — and not even the request — leaves the device.',
    standard:
      "An on-device LLM runs the model on your own hardware rather than on a remote server, so generating a summary involves no network request and zero data egress. In the browser this is commonly done with WebGPU, a modern web API that gives JavaScript access to the GPU for the heavy matrix computation an LLM needs. CPAP Analyzer offers two on-device backends: in-browser WebLLM (which downloads model weights once and runs them on the GPU via WebGPU) and Chrome's built-in AI (which uses a small model that ships with the browser). Both keep everything — your metrics and the request itself — on your device, which is the strongest privacy posture in the app.",
    detailed:
      "WebGPU is the successor to WebGL for general-purpose GPU compute in the browser; it is what makes practical in-browser LLM inference possible, because transformer inference is dominated by large matrix multiplications that are far faster on a GPU than on the CPU. The WebLLM backend downloads a quantised open model once (a multi-gigabyte file, stored in the browser and counted against the app's storage budget) and then runs it locally; after that one-time, data-free download, inference is zero-egress. The Chrome built-in backend instead uses Gemini Nano, a small model provisioned by the browser, so there is no app-side download. The privacy advantage is categorical: unlike a cloud backend, an on-device backend sends nothing off the device, so there is no consent dialog and no per-request egress reminder — there is genuinely nothing to disclose. The tradeoffs are capability (small local models phrase less fluently than frontier cloud models), hardware requirements (WebGPU support and adequate GPU memory), and, for WebLLM, the large initial download. A local server such as Ollama or LM Studio addressed over a loopback URL is treated the same way — on-device, no egress — even though it is technically a separate process rather than in-page inference.",
    relatedTerms: ['ai-insights', 'llm', 'webllm', 'chrome-built-in-ai'],
    references: [
      'W3C. WebGPU. https://www.w3.org/TR/webgpu/ — The browser API providing GPU access used for in-browser model inference.',
    ],
  },
  {
    id: 'hallucination',
    term: 'Hallucination',
    category: 'data',
    aliases: ['LLM hallucination', 'Confabulation'],
    quick:
      'When a language model states plausible-sounding but false or unfounded information — including invented numbers — as if it were fact.',
    standard:
      "A hallucination is output from a language model that is fluent and confident but not actually supported by the input or by reality — for example, inventing a number, misstating a threshold, or asserting a relationship that does not exist. All language models hallucinate to some degree; it is an inherent property of how they generate text, not a fixable bug in a particular model. In a health tool a hallucinated clinical value is the worst possible failure, which is why CPAP Analyzer never lets the model compute or originate a figure and validates every number in its output against the app's own computations before showing it.",
    detailed:
      'Because an LLM generates text by predicting likely continuations rather than by retrieving verified facts, it can produce statements that are syntactically and stylistically convincing yet factually wrong — including fabricated figures and spurious precision. The risk is highest exactly where it is most dangerous for a clinical tool: numbers. CPAP Analyzer addresses hallucination structurally rather than hoping the model behaves. Grounding (compute-then-narrate) removes any need for the model to produce a number — it is handed the finished, rounded values and told to restate only those. A deterministic numeral-extraction validator then checks the generated prose against an allow-list of the exact tokens the app computed and rejects any output containing a number that is not on it (or a value carrying the wrong unit, or a severity verdict that conflicts with the app\'s own), regenerating once and otherwise falling back to a non-generative templated summary. The inseparable "AI-generated — may be inaccurate; verify against the numbers" caveat and the "Based on these numbers" source panel let the reader check the prose against the data regardless. Even fully grounded, generated text can still mislead by implying causation or sounding overconfident, which is why the framing stays descriptive and non-diagnostic and defers to a clinician.',
    relatedTerms: ['ai-insights', 'llm', 'grounding'],
    references: [
      'Ji, Z., Lee, N., Frieske, R., et al. (2023). Survey of Hallucination in Natural Language Generation. ACM Computing Surveys, 55(12), 1–38. DOI: 10.1145/3571730. — A survey of why language models hallucinate and how grounding mitigates it.',
    ],
  },
  {
    id: 'webllm',
    term: 'WebLLM (in-browser backend)',
    category: 'data',
    aliases: ['WebLLM'],
    quick:
      'The on-device AI Insights backend that downloads an open model once and runs it entirely in your browser on the GPU (WebGPU), with zero data egress afterwards.',
    standard:
      "WebLLM is CPAP Analyzer's privacy-default AI Insights backend. It downloads a quantised open language model once (a multi-gigabyte file stored in your browser) and then runs it locally on your GPU through WebGPU, so generating a summary involves no network request. After the one-time, data-free model download, it is fully zero-egress: none of your data — and not even the inference request — leaves your device. It requires WebGPU support and adequate GPU memory, and the on-disk model size is disclosed before download and can be removed at any time.",
    detailed:
      'WebLLM brings transformer inference into the browser by compiling and running a quantised open model against WebGPU. The first time you select a model, its weights are fetched from a model host — a download that carries none of your data, just the model — and cached locally (in OPFS/browser cache, counting against the same storage budget shown in Privacy & Storage). Every subsequent generation runs entirely on-device with zero egress, which is why this backend needs no consent dialog. The first generation after a download may include a one-time model load/warm-up, shown as a "Loading model…" state. Practical considerations: it needs a browser and device with WebGPU and enough GPU memory (a larger model gives richer prose but downloads more and may not fit on low-memory devices, surfaced as a graceful "couldn\'t load — try a smaller model" error), and small local models phrase less fluently than frontier cloud models. The grounding and numeral-validation guarantees are identical to every other backend, so the prose is just as constrained to the app\'s computed numbers.',
    relatedTerms: ['ai-insights', 'on-device-llm', 'llm', 'chrome-built-in-ai'],
  },
  {
    id: 'chrome-built-in-ai',
    term: 'Chrome built-in AI (Gemini Nano)',
    category: 'data',
    aliases: ['Chrome built-in AI', 'Gemini Nano', 'Prompt API', 'Summarizer API'],
    quick:
      'The on-device AI Insights backend that uses the small Gemini Nano model bundled with recent Chrome browsers, with no app-side download and zero data egress.',
    standard:
      "Chrome built-in AI is an on-device AI Insights backend that uses Gemini Nano, a small language model that ships inside recent versions of Chrome and is exposed through the browser's Summarizer and Prompt APIs. Because the model is provided by the browser, there is nothing for the app to download, and inference runs entirely on your device with zero data egress. It is available only on supporting browsers, and some states require a one-time on-device model provisioning that the browser handles; when it is unavailable, the app steers you to WebLLM or a cloud backend.",
    detailed:
      "Chrome built-in AI is a progressive-enhancement backend: where the browser exposes an on-device model API (the Summarizer / Prompt APIs backed by Gemini Nano), CPAP Analyzer can generate insights with the lightest possible footprint — no multi-gigabyte download, since the model ships with the browser — and zero egress, since inference is local. Availability is gated on browser support and, in some states, a one-time on-device model provisioning that the browser performs (surfaced with the same progress affordance as a WebLLM download). The capability is still maturing and browser coverage is growing, so the app feature-detects it on selection and renders a clear inline explanation rather than a raw API error when it is unavailable, pointing the user to the in-browser WebLLM option or a cloud option. As with every backend, the compute-then-narrate grounding and the numeral-validation backstop apply unchanged, so the model only ever restates the app's own computed numbers.",
    relatedTerms: ['ai-insights', 'on-device-llm', 'llm', 'webllm'],
  },
  {
    id: 'ai-cloud-backend',
    term: 'Cloud AI backend (Claude / OpenAI-compatible)',
    category: 'data',
    aliases: ['BYO-key cloud backend', 'Claude browser-direct', 'OpenAI-compatible endpoint'],
    quick:
      'A bring-your-own-key AI Insights backend that sends a small, aggregate metric snapshot to a remote provider (Anthropic Claude or any OpenAI-compatible endpoint) for higher-quality wording, gated by explicit consent.',
    standard:
      "A cloud AI backend produces summaries by calling a remote provider's API directly from your browser using your own API key. CPAP Analyzer offers two: Claude (Anthropic) browser-direct, and any OpenAI-compatible endpoint (OpenAI, OpenRouter, Together, or a local Ollama/LM Studio server via a base URL). Cloud backends send a small, aggregate metric snapshot off the device, so they are gated by an explicit two-gate consent that names exactly what is and is not sent. They trade some privacy for more fluent prose; there is no shared key and no app account — each request uses your own key, on your own provider account, and incurs that provider's cost.",
    detailed:
      "Because CPAP Analyzer has no backend server, a cloud AI request originates from your browser with your own API key and is sent directly to the provider — which means the provider necessarily sees the request and your network IP, exactly as any website you visit does; the app cannot proxy or hide that, which is why cloud backends are opt-in and consent-gated. The only thing that egresses is the grounded metric snapshot: aggregate, already-computed numbers at display precision (AHI, leak, usage, pressure, event counts, trend direction), the calendar dates you asked about, and your machine type — never the raw signals, exact times, serial number, notes, location, or any identifier. The Claude backend uses Anthropic's SDK browser-direct access with a model you choose (Opus / Sonnet / Haiku, trading quality, speed, and cost); the OpenAI-compatible backend targets any endpoint speaking the OpenAI API shape and, via a user-supplied base URL, spans both remote providers (treated as cloud, consent required) and local loopback servers like Ollama (treated as on-device, no egress). Cloud origins must be in the app's strict CSP allowlist — the curated presets (Anthropic, OpenAI, and similar) and loopback are permitted, but an arbitrary user-typed remote host is not supported in this phase, because allowing it would require a wildcard that would re-open the network-exfiltration surface the policy exists to close. API keys are held in session-scoped memory, never persisted to disk by default, never placed in the snapshot, and never logged.",
    relatedTerms: ['ai-insights', 'llm', 'grounding', 'on-device-llm'],
    references: [
      'CPAP Analyzer ADR 0024 — Grounded, Opt-In AI Insights via a Multi-Backend Provider Abstraction. — The cloud-backend egress contract, two-gate consent, CSP allowlist, and the no-arbitrary-remote-host limitation.',
    ],
  },
] as const;

/** Map of glossary entry id → entry for O(1) lookup */
export const glossaryMap: ReadonlyMap<string, GlossaryEntry> = new Map(
  glossaryEntries.map((entry) => [entry.id, entry]),
);

/** All unique glossary categories in display order */
export const glossaryCategoryOrder: readonly GlossaryCategory[] = [
  'cpap-therapy',
  'sleep-medicine',
  'statistics',
  'data',
];
