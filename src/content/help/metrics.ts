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
    tooltip: 'Total mask-on time at therapeutic pressure during the session, excluding ramp time.',
    interpretation:
      'Compliance target: ≥ 4 hours/night. Optimal for cardiovascular benefit: ≥ 6 hours. More usage = greater clinical benefit.',
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
    tooltip: 'Oxygen Desaturation Index — the number of ≥ 3% oxygen desaturation events per hour.',
    interpretation:
      'Normal: < 5. ODI correlates with AHI but specifically captures the physiological impact. ODI > AHI may indicate prolonged or deep desaturations.',
    glossaryId: 'odi',
  },
  {
    id: 'central-ai',
    label: 'Central AI',
    unit: 'events/hr',
    tooltip: 'Central Apnea Index — the number of central apneas per hour of sleep.',
    interpretation:
      'Normal: < 5. Elevated central AI may indicate complex sleep apnea. Central AI > 5 with symptoms warrants evaluation for ASV therapy.',
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
