/**
 * Metric tooltip definitions for contextual help on numeric metrics.
 *
 * Each metric has a short tooltip and a source reference for the definition.
 */

import type { ReliabilityTier } from '@/analysis/uncertainty';

export interface MetricDefinition {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly tooltip: string;
  readonly interpretation: string;
  readonly glossaryId?: string;
  /**
   * Optional measurement-reliability annotation (consensus D5). The `tier`
   * mirrors the intrinsic reliability of the metric and the `note` explains,
   * in one or two sentences, *why* — so a tooltip can surface how much trust
   * the number deserves. Omitted on directly-measured `high`-tier metrics
   * where the absence of a caveat is itself the trust signal (D6: quiet by
   * default). The note is plain prose; it carries no diagnostic or
   * therapy-specific advice.
   */
  readonly reliability?: {
    readonly tier: ReliabilityTier;
    readonly note: string;
  };
}

export const metricDefinitions: readonly MetricDefinition[] = [
  {
    id: 'ahi',
    label: 'AHI',
    unit: 'events/hr',
    tooltip:
      'Apnea-Hypopnea Index — the number of breathing interruptions (apneas + hypopneas) per hour of sleep.',
    interpretation:
      'Normal: < 5 · Mild: 5–14 · Moderate: 15–29 · Severe: ≥ 30. Lower is better. Target on therapy: < 5.',
    glossaryId: 'ahi',
    reliability: {
      tier: 'moderate',
      note: 'An algorithmically detected estimate: the device scores events from flow alone (no EEG arousals), tends to undercount versus a sleep study, and divides by mask-on rather than true sleep time. A multi-night trend is far more reliable than any single night.',
    },
  },
  {
    id: 'leak-median',
    label: 'Leak Rate (Median)',
    unit: 'L/min',
    tooltip: 'The median (50th percentile) unintentional mask leak rate during the session.',
    interpretation:
      'Acceptable: < 24 L/min. Median is less affected by brief spikes than mean. Consistently high values suggest mask fit issues.',
    glossaryId: 'mask-leak',
    reliability: {
      tier: 'moderate',
      note: 'A modeled estimate (total flow minus an estimated intentional-vent flow), reliable below the device large-leak threshold but increasingly uncertain above it. High leak also degrades the flow-derived metrics measured from the same signal.',
    },
  },
  {
    id: 'leak-p95',
    label: 'Leak Rate (P95)',
    unit: 'L/min',
    tooltip: 'The 95th percentile leak rate — only 5% of the session had leak above this value.',
    interpretation:
      'Acceptable: < 24 L/min. P95 captures worst-case leaks without being dominated by extreme outliers. Review if chronically elevated.',
    glossaryId: 'mask-leak',
    reliability: {
      tier: 'moderate',
      note: 'A modeled estimate from the same vent-subtraction as the median leak. A high P95 means flow-derived metrics from those worst-case epochs (tidal volume, the central/obstructive split) should be read with extra caution.',
    },
  },
  {
    id: 'usage-hours',
    label: 'Usage Hours',
    unit: 'hours',
    tooltip:
      "Mask-on time during the session, from the machine's recorded mask-on/off intervals (STR.edf) when available, otherwise a hysteresis detector; subtherapeutic ramp excluded for compliance.",
    interpretation:
      'Compliance target: ≥ 4 hours/night. Benefit increases with use: in the Weaver et al. (2007) dose-response study, subjective sleepiness normalized near 4 h, objective sleepiness near 6 h, and daily functioning near 7.5 h of nightly use. This is the denominator for AHI, ODI, and leak-duration metrics.',
    glossaryId: 'usage-hours',
    reliability: {
      tier: 'high',
      note: 'Directly measured mask-on time. Note it is the AHI/ODI denominator and is not the same as true sleep time.',
    },
  },
  {
    id: 'compliance-rate',
    label: 'Compliance Rate',
    unit: '%',
    tooltip:
      'Percentage of nights meeting the minimum usage threshold (≥ 4 hours) over a rolling 30-day window.',
    interpretation:
      'Insurance/Medicare threshold: ≥ 70% (21/30 nights). Higher is better. Consistent use yields the best outcomes.',
    glossaryId: 'compliance',
    reliability: {
      tier: 'high',
      note: 'A direct count of nights that met the usage threshold — no modeling involved.',
    },
  },
  {
    id: 'pressure-mean',
    label: 'Pressure (Mean)',
    unit: 'cmH₂O',
    tooltip: 'The average delivered CPAP pressure during the session.',
    interpretation:
      'Typical range: 6–14 cmH₂O. In APAP mode, mean pressure reflects overall airway demand. Increasing mean may indicate weight gain or positional changes.',
    glossaryId: 'cpap',
    reliability: {
      tier: 'high',
      note: 'Directly sensed pressure that the device actively regulates to — the closest thing to a ground-truth value in the dataset.',
    },
  },
  {
    id: 'pressure-p95',
    label: 'Pressure (P95)',
    unit: 'cmH₂O',
    tooltip: 'The 95th percentile pressure — the machine was below this level 95% of the night.',
    interpretation:
      'P95 from APAP data is commonly used to set a fixed CPAP prescription. If P95 is near Pmax, the pressure range may be insufficient.',
    glossaryId: 'cpap',
    reliability: {
      tier: 'high',
      note: 'A percentile of directly sensed, device-regulated pressure — high reliability.',
    },
  },
  {
    id: 'spo2-mean',
    label: 'SpO₂ (Mean)',
    unit: '%',
    tooltip: 'Average blood oxygen saturation during the session, measured via pulse oximetry.',
    interpretation:
      'Normal: 95–100%. Values below 92% during sleep require attention. Well-treated patients typically maintain mean SpO₂ > 94%.',
    glossaryId: 'spo2',
    reliability: {
      tier: 'moderate',
      note: 'Reliability depends on the source: a calibrated/cleared pulse oximeter is moderate (≈2% measurement spread), while a consumer wrist or ring sensor is a lower-precision wellness estimate. Read it alongside the oximetry coverage %.',
    },
  },
  {
    id: 'spo2-min',
    label: 'SpO₂ (Min)',
    unit: '%',
    tooltip: 'The lowest blood oxygen saturation recorded during the session.',
    interpretation:
      'Desaturations below 90% are clinically significant. Below 80% is severe. Nadir SpO₂ correlates with cardiovascular risk.',
    glossaryId: 'spo2',
    reliability: {
      tier: 'moderate',
      note: 'A single-sample minimum is the most artifact-prone oximetry statistic — a motion spike or poor perfusion can produce a spurious low. Confirm against the trace and the coverage % before reading it as a true nadir.',
    },
  },
  {
    id: 'event-count',
    label: 'Event Count',
    unit: 'events',
    tooltip: 'Total number of scored respiratory events (apneas + hypopneas) during the session.',
    interpretation:
      'Calculated as AHI × usage hours. A session with AHI 3 and 7 hours of usage had ~21 events. Event distribution across the night matters as much as count.',
    glossaryId: 'ahi',
    reliability: {
      tier: 'moderate',
      note: 'The count itself is exact, but it is a detected count that under-represents a sleep study, and the rate derived from it (AHI) carries Poisson sampling noise — low-count nights are especially noisy.',
    },
  },
  {
    id: 'odi',
    label: 'ODI',
    unit: 'events/hr',
    tooltip:
      'Oxygen Desaturation Index — discrete desaturation events (≥ 3% below a rolling baseline, lasting ≥ 10 s, counted once each) per hour of valid oximetry.',
    interpretation:
      'Normal: < 5. ODI correlates with AHI but specifically captures the physiological impact. ODI > AHI may indicate prolonged or deep desaturations. Read alongside oximetry coverage %.',
    glossaryId: 'odi',
    reliability: {
      tier: 'moderate',
      note: 'A detected event rate that is only as trustworthy as the oximetry it rests on — near-90% saturations flip in and out of the desaturation criterion within the sensor error. Read it together with the coverage %.',
    },
  },
  {
    id: 'rdi',
    label: 'RDI',
    unit: 'events/hr',
    tooltip:
      'Respiratory Disturbance Index — apneas + hypopneas + RERAs per hour (AHI plus the RERA index). Always ≥ AHI.',
    interpretation:
      'Captures sleep-disordered breathing that AHI misses. A normal AHI with a notably higher RDI may suggest upper airway resistance syndrome (UARS). Device RERA counts are proxy estimates, so RDI is approximate.',
    glossaryId: 'rdi',
    reliability: {
      tier: 'low',
      note: 'A modeled estimate: it adds device RERA counts, which are flow-shape surrogates for EEG-scored arousals the machine cannot see. Treat the RDI as a screening trend to discuss with your clinician, not a polysomnography-grade number.',
    },
  },
  {
    id: 't90',
    label: 'T90',
    unit: '%',
    tooltip:
      'Percentage of analyzed time with SpO₂ below 90% (time-based; oximetry dropouts excluded).',
    interpretation:
      'Lower is better. Elevated T90 reflects nocturnal hypoxic burden. Interpret together with oximetry coverage % — a low T90 over little valid signal is not reassuring.',
    glossaryId: 't90',
    reliability: {
      tier: 'moderate',
      note: 'Driven by oximeter error near the 90% threshold (samples flip in and out within the ±2% sensor spread) and by coverage. A low T90 computed over little valid signal is not reassuring.',
    },
  },
  {
    id: 'spo2-coverage',
    label: 'SpO₂ Coverage',
    unit: '%',
    tooltip:
      'Fraction of analyzed time with a valid pulse-oximetry signal — a data-quality denominator for all SpO₂ metrics.',
    interpretation:
      'Higher is better for confidence. Mean/min SpO₂, T90, and ODI are computed over valid-oximetry time only, so low coverage means those numbers rest on little data.',
    glossaryId: 'spo2-coverage',
    reliability: {
      tier: 'high',
      note: 'A directly measured fraction of valid-signal time — this is the data-quality denominator you should read first to gauge how much the other SpO₂ numbers can be trusted.',
    },
  },
  {
    id: 'central-ai',
    label: 'Central AI',
    unit: 'events/hr',
    tooltip: 'Central Apnea Index — the number of central apneas per hour of sleep.',
    interpretation:
      'Normal: < 5. Elevated central AI may indicate complex or central sleep apnea and warrants clinical evaluation. Note: adaptive servo-ventilation (ASV) is contraindicated in symptomatic heart failure with reduced ejection fraction (LVEF ≤ 45%) per the SERVE-HF trial — any therapy-mode change is a clinician decision, not a software recommendation.',
    glossaryId: 'central-apnea',
    reliability: {
      tier: 'low',
      note: 'The central-versus-obstructive label is the least precise number here — a low-confidence classification (degraded by leak; the device tends to under-call closed-airway centrals). The precise count is uncertain, but a sustained upward trend still matters: discuss it with your clinician.',
    },
  },
  {
    id: 'obstructive-ai',
    label: 'Obstructive AI',
    unit: 'events/hr',
    tooltip: 'Obstructive Apnea Index — the number of obstructive apneas per hour of sleep.',
    interpretation:
      'Should be near zero on well-titrated CPAP. Elevated values suggest subtherapeutic pressure, positional issues, or mask leak.',
    glossaryId: 'obstructive-apnea',
    reliability: {
      tier: 'moderate',
      note: 'A detected, leak-sensitive count carrying the same flow-only and Poisson-noise caveats as the AHI; the obstructive/central split that produced it is itself uncertain under high leak.',
    },
  },
] as const;

/** Map of metric id → definition for O(1) lookup */
export const metricMap: ReadonlyMap<string, MetricDefinition> = new Map(
  metricDefinitions.map((m) => [m.id, m]),
);
