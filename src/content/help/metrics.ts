/**
 * Metric tooltip definitions for contextual help on numeric metrics.
 *
 * Each metric has a short tooltip and a source reference for the definition.
 */

export interface MetricDefinition {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly tooltip: string;
  readonly interpretation: string;
  readonly glossaryId?: string;
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
  },
  {
    id: 'leak-median',
    label: 'Leak Rate (Median)',
    unit: 'L/min',
    tooltip: 'The median (50th percentile) unintentional mask leak rate during the session.',
    interpretation:
      'Acceptable: < 24 L/min. Median is less affected by brief spikes than mean. Consistently high values suggest mask fit issues.',
    glossaryId: 'mask-leak',
  },
  {
    id: 'leak-p95',
    label: 'Leak Rate (P95)',
    unit: 'L/min',
    tooltip: 'The 95th percentile leak rate — only 5% of the session had leak above this value.',
    interpretation:
      'Acceptable: < 24 L/min. P95 captures worst-case leaks without being dominated by extreme outliers. Review if chronically elevated.',
    glossaryId: 'mask-leak',
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
  },
  {
    id: 'pressure-mean',
    label: 'Pressure (Mean)',
    unit: 'cmH₂O',
    tooltip: 'The average delivered CPAP pressure during the session.',
    interpretation:
      'Typical range: 6–14 cmH₂O. In APAP mode, mean pressure reflects overall airway demand. Increasing mean may indicate weight gain or positional changes.',
    glossaryId: 'cpap',
  },
  {
    id: 'pressure-p95',
    label: 'Pressure (P95)',
    unit: 'cmH₂O',
    tooltip: 'The 95th percentile pressure — the machine was below this level 95% of the night.',
    interpretation:
      'P95 from APAP data is commonly used to set a fixed CPAP prescription. If P95 is near Pmax, the pressure range may be insufficient.',
    glossaryId: 'cpap',
  },
  {
    id: 'spo2-mean',
    label: 'SpO₂ (Mean)',
    unit: '%',
    tooltip: 'Average blood oxygen saturation during the session, measured via pulse oximetry.',
    interpretation:
      'Normal: 95–100%. Values below 92% during sleep require attention. Well-treated patients typically maintain mean SpO₂ > 94%.',
    glossaryId: 'spo2',
  },
  {
    id: 'spo2-min',
    label: 'SpO₂ (Min)',
    unit: '%',
    tooltip: 'The lowest blood oxygen saturation recorded during the session.',
    interpretation:
      'Desaturations below 90% are clinically significant. Below 80% is severe. Nadir SpO₂ correlates with cardiovascular risk.',
    glossaryId: 'spo2',
  },
  {
    id: 'event-count',
    label: 'Event Count',
    unit: 'events',
    tooltip: 'Total number of scored respiratory events (apneas + hypopneas) during the session.',
    interpretation:
      'Calculated as AHI × usage hours. A session with AHI 3 and 7 hours of usage had ~21 events. Event distribution across the night matters as much as count.',
    glossaryId: 'ahi',
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
  },
  {
    id: 'central-ai',
    label: 'Central AI',
    unit: 'events/hr',
    tooltip: 'Central Apnea Index — the number of central apneas per hour of sleep.',
    interpretation:
      'Normal: < 5. Elevated central AI may indicate complex or central sleep apnea and warrants clinical evaluation. Note: adaptive servo-ventilation (ASV) is contraindicated in symptomatic heart failure with reduced ejection fraction (LVEF ≤ 45%) per the SERVE-HF trial — any therapy-mode change is a clinician decision, not a software recommendation.',
    glossaryId: 'central-apnea',
  },
  {
    id: 'obstructive-ai',
    label: 'Obstructive AI',
    unit: 'events/hr',
    tooltip: 'Obstructive Apnea Index — the number of obstructive apneas per hour of sleep.',
    interpretation:
      'Should be near zero on well-titrated CPAP. Elevated values suggest subtherapeutic pressure, positional issues, or mask leak.',
    glossaryId: 'obstructive-apnea',
  },
] as const;

/** Map of metric id → definition for O(1) lookup */
export const metricMap: ReadonlyMap<string, MetricDefinition> = new Map(
  metricDefinitions.map((m) => [m.id, m]),
);
