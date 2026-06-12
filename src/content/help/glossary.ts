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
    relatedTerms: ['apnea', 'hypopnea', 'residual-ahi', 'rdi', 'odi'],
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
    relatedTerms: ['ahi', 'apnea', 'desaturation', 'flow-limitation'],
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
    relatedTerms: ['ahi', 'rdi', 'flow-limitation', 'uars'],
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
    relatedTerms: ['apnea', 'cheyne-stokes', 'asv'],
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
      'Mask leak is the unintentional loss of air around the mask seal, measured in L/min. All masks have some intentional leak through exhalation ports (typically 20–30 L/min), but additional leak indicates a poor seal. High leak (>24 L/min above intentional vent) can cause the machine to under-detect events, deliver inadequate pressure, cause dry mouth, and disrupt sleep.',
    detailed:
      'CPAP machines measure total leak and subtract estimated intentional leak (from mask vent ports) to report unintentional leak. ResMed devices report the 95th percentile leak rate as a primary quality indicator. Leak thresholds: < 24 L/min is generally acceptable; sustained leak > 24 L/min degrades device algorithms. Effects of high leak: reduced event detection accuracy (machine may miss apneas), pressure delivery instability (APAP algorithms may over-compensate), aerophagia risk, mask/eye irritation, noise. Common causes: incorrect mask size, worn cushions, mouth opening (chin strap or full-face mask may help), sleeping position.',
    relatedTerms: ['cpap', 'ahi'],
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
      'Residual AHI is calculated from device data as total machine-scored events divided by mask-on time. Important caveats: (1) Machine-scored AHI uses different algorithmic criteria than PSG-scored AHI and may differ by 10–30%; (2) Residual AHI during subtherapeutic ramp periods should be excluded; (3) Leak-affected periods may have unreliable event scoring; (4) A sudden increase in residual AHI may indicate weight gain, positional changes, medication effects, or mask issues rather than failed therapy. Target: < 5.0 events/hr; optimal: < 2.0 events/hr.',
    formula:
      '\\text{Residual AHI} = \\frac{\\text{Machine-Scored Events}}{\\text{Mask-On Time (hours)}}',
    relatedTerms: ['ahi', 'cpap', 'compliance'],
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
      'Operationally, TECSA is defined when the central apnea index (CAI) exceeds a threshold (commonly 5/h) on therapy, with prior obstructive disease. CPAP Analyzer implements the Liu et al. 2017 (Chest, DOI 10.1016/j.chest.2017.06.010) trajectory classifier longitudinally over nightly CAI: early-window CAI is compared to late-window CAI, both at the 5/h threshold, to assign one of four classes (obstructive stable, transient TECSA, persistent central, emergent central). High-leak nights are excluded because FOT-derived CAI is degraded under leak. The single most important clinical caveat: TECSA does not by itself justify a switch to adaptive servo-ventilation (ASV). The SERVE-HF randomized trial (Cowie et al. 2015) found increased mortality with ASV in symptomatic chronic heart failure with reduced ejection fraction (LVEF ≤ 45%) with predominantly central sleep apnea; subsequent AHA/ACC scientific statements formalized the contraindication (Somers et al. 2018). Therapy-mode changes are clinician decisions informed by echocardiography and the full clinical picture, not by a software flag. CPAP Analyzer reports TECSA trajectory as a candidate finding for discussion; it does not diagnose.',
    relatedTerms: ['central-apnea', 'csa', 'cai', 'asv', 'loop-gain'],
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
      'PB arises from instability of the chemoreflex-driven control of ventilation — high loop gain combined with a long circulation delay produces oscillatory feedback that overshoots in both directions, with central apneas at the troughs when PaCO₂ falls below the apneic threshold. Single-channel airflow methods (Weinreich 2009, Javed 2018, Midelet 2023, Guyot 2019) can detect PB from the flow envelope alone; CPAP Analyzer combines AASM-style morphology rules with an autocorrelation-based periodicity check, a Guyot-style modulation index (0–1) for confidence, and a harmonic-ratio crescendo-decrescendo morphology score. Sub-threshold PB and short CSR runs that fall below the ResMed 15-minute device floor are surfaced as "candidate / below device threshold" rather than silently dropped or promoted to formal CSR flags. See the help article "Breathing Patterns: Periodic Breathing, Cheyne-Stokes & TECSA" for the full method.',
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
  },
  {
    id: 'modulation-index',
    term: 'Modulation Index',
    category: 'statistics',
    quick:
      'A 0–1 score for how strongly a signal oscillates relative to its mean — used to score periodic breathing confidence from the airflow envelope.',
    standard:
      'The modulation index quantifies the amplitude of an oscillation relative to the baseline level of the signal it modulates. Values near 0 indicate an essentially flat envelope; values near 1 indicate a deeply modulated cyclic envelope. CPAP Analyzer uses a Guyot-style modulation index on the airflow / minute-ventilation envelope as the continuous confidence basis for periodic breathing detection (Guyot et al. 2019).',
    detailed:
      'For a periodic envelope with peaks $p_i$ and troughs $t_i$, a common form is $\\text{MI} = \\frac{p - t}{p + t}$, evaluated on the smoothed envelope of the airflow signal. Values near 0 indicate a steady envelope; values approaching 1 indicate near-complete modulation (deep troughs, often coinciding with central apneas). The modulation index is robust to slow drift in baseline ventilation and is dimensionless, which is why it is preferred over raw amplitude for cross-night and cross-subject comparison. In CPAP Analyzer, MI is one of three inputs to the periodic-breathing confidence score; the others are the autocorrelation-based periodicity peak in the 40–120 s band and the harmonic-ratio crescendo-decrescendo morphology score. Higher MI indicates a more confidently periodic envelope, not a more severe disease — interpret confidence and severity separately.',
    relatedTerms: ['periodic-breathing', 'cheyne-stokes', 'harmonic-ratio', 'correlation'],
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
  },
  {
    id: 'odi',
    term: 'ODI (Oxygen Desaturation Index)',
    category: 'sleep-medicine',
    aliases: ['Oxygen Desaturation Index'],
    quick:
      'The number of times per hour that blood oxygen drops by ≥3% (or ≥4%) from baseline during sleep.',
    standard:
      'ODI measures how frequently oxygen levels dip during sleep. CPAP Analyzer scores a desaturation as a discrete event — a fall of ≥3% in SpO₂ below a rolling baseline, sustained for at least 10 seconds — and counts each event once, then divides by the hours of valid oximetry. A 3% ODI counts ≥3% drops; a 4% ODI counts ≥4% drops. ODI correlates with AHI but specifically captures the physiological impact of breathing events — events that cause significant desaturation are more clinically concerning than those without.',
    detailed:
      'ODI is the number of discrete desaturation events per hour of valid oximetry. CPAP Analyzer detects an event when SpO₂ falls ≥3% (or ≥4%, configurable) below a rolling baseline — the recent local maximum / running reference saturation — for ≥10 seconds, and counts that excursion exactly once (a single prolonged dip is one event, not many). The denominator excludes periods with no oximetry signal, so dropouts do not deflate the rate. (Earlier versions counted per-sample drops, which inflated ODI and is not clinically valid; the event-based definition here is the correct one.) Two thresholds are common: 3% ODI (more sensitive, aligns with the AASM hypopnea definition) and 4% ODI (more specific, aligns with the Medicare hypopnea definition). ODI may diverge from AHI when: (1) many events cause arousal without desaturation (ODI < AHI); (2) oxygen stores are depleted in REM/supine position causing desaturations from minor events (ODI > AHI). ODI is a stronger predictor of cardiovascular outcomes than AHI in some studies (Wisconsin Cohort, SHHS). Requires integrated or paired pulse oximetry; without oximetry data, ODI is not reported.',
    formula:
      '\\text{ODI} = \\frac{\\text{Desaturation Events } (\\geq 3\\%,\\, \\geq 10\\text{s})}{\\text{Hours of Valid Oximetry}}',
    relatedTerms: ['spo2', 'desaturation', 'ahi', 'spo2-coverage', 't90'],
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
    relatedTerms: ['odi', 'desaturation', 't90', 'spo2-coverage'],
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
    relatedTerms: ['sleep-fragmentation', 'rera'],
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
    relatedTerms: ['arousal', 'sleep-apnea'],
  },
  {
    id: 'cheyne-stokes',
    term: 'Cheyne-Stokes Respiration',
    category: 'sleep-medicine',
    aliases: ['CSR', 'Cheyne-Stokes Breathing'],
    quick:
      'A crescendo-decrescendo breathing pattern with central apneas, commonly associated with heart failure.',
    standard:
      'Cheyne-Stokes respiration is a distinctive breathing pattern where breath depth and rate gradually increase (crescendo), then decrease (decrescendo), followed by a central apnea. This cycle repeats every 60–90 seconds. It is most commonly caused by congestive heart failure but can occur with stroke or other neurological conditions. Treatment involves addressing the underlying cardiac condition and potentially using ASV.',
    detailed:
      'CSR results from high loop gain in the ventilatory control system. In heart failure, prolonged circulation time delays CO₂ feedback to chemoreceptors, causing oscillatory ventilatory control. Cycle length = 2 × circulation time (typically 60–90 seconds). PaCO₂ oscillates around the apneic threshold. Diagnosis: ≥3 consecutive cycles of crescendo-decrescendo tidal volume with cycle length ≥ 40 seconds, and central AHI ≥ 5/hr. Prevalence in systolic heart failure: 30–50%. Treatment: optimize cardiac function (diuretics, ACE inhibitors, CRT); supplemental oxygen; ASV (CONTRAINDICATED if LVEF ≤ 45% per SERVE-HF trial). CPAP may partially treat CSR but is less effective than ASV.',
    relatedTerms: ['central-apnea', 'csa', 'asv'],
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
      'Pearson correlation r = Σ(xᵢ − x̄)(yᵢ − ȳ) / √(Σ(xᵢ − x̄)² × Σ(yᵢ − ȳ)²). Assumptions: linearity, bivariate normality, no significant outliers. For non-normal data (common in CPAP data), use Spearman rank correlation ρ (monotonic relationships) or Kendall τ (ordinal). Effect size interpretation (Cohen): |r| < 0.1 negligible, 0.1–0.3 small, 0.3–0.5 medium, > 0.5 large. Correlation does NOT imply causation — a correlation between mask type and AHI may reflect selection bias (patients with severe OSA may use specific masks). Always visualize the relationship alongside the correlation coefficient.',
    formula:
      'r = \\frac{\\sum_{i=1}^{n}(x_i - \\bar{x})(y_i - \\bar{y})}{\\sqrt{\\sum_{i=1}^{n}(x_i - \\bar{x})^2 \\cdot \\sum_{i=1}^{n}(y_i - \\bar{y})^2}}',
    relatedTerms: ['regression', 'p-value'],
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
      'Trend detection methods: (1) Linear regression (fits a straight line; slope indicates direction and rate); (2) Mann-Kendall test (non-parametric trend test suitable for non-normal data); (3) Sen slope estimator (robust slope estimate); (4) Change point detection (identifies where trend shifts occur). LOESS smoothing can visualize non-linear trends. Statistical significance of a trend should be assessed (is the slope significantly different from zero?) while considering autocorrelation (consecutive nights are not independent). Clinically meaningful trends: AHI increasing > 2/hr over a month warrants investigation; usage declining > 30 min/night over a month suggests adherence intervention needed.',
    relatedTerms: ['rolling-average', 'regression', 'change-point', 'loess'],
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
      'KM estimator: Ŝ(t) = Π_{tᵢ≤t} (nᵢ − dᵢ) / nᵢ, where nᵢ = number at risk at time tᵢ, dᵢ = number of events at tᵢ. Handles censored observations (e.g., nights where the patient removed the mask before an event would have occurred). Log-rank test compares survival curves between groups (e.g., different mask types, pressure settings). In CPAP data: time-to-first-event analysis characterizes event clustering and therapy effectiveness during different sleep periods. Hazard rates can identify when during the night events are most likely (e.g., supine REM periods).',
    formula: '\\hat{S}(t) = \\prod_{t_i \\leq t} \\frac{n_i - d_i}{n_i}',
    relatedTerms: ['trend', 'p-value'],
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
      'LOESS fits weighted least-squares regressions to local subsets of data. Each point x₀ uses a neighborhood of the nearest fraction (span) of data points, weighted by a tricube function. Key parameter: span (bandwidth) controls smoothness — typical range 0.2–0.8; smaller span = more flexible (may overfit), larger span = smoother (may underfit). Degree: 1 (local linear) or 2 (local quadratic). LOESS does not produce a global model equation — prediction requires the original data. Computational cost: O(n²) for n points. For CPAP data, LOESS with span 0.3–0.5 effectively reveals seasonal or medium-term trends in AHI and usage hours that a linear model would miss.',
    relatedTerms: ['regression', 'trend', 'rolling-average'],
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
