/**
 * Presentation-layer metric formatting (display precision).
 *
 * Implements the consensus D9 precision table. This is **presentation only**:
 * it never mutates inputs and stored values keep full precision for re-
 * aggregation. The exported {@link PRECISION_REGISTRY} is the single source of
 * truth so reports, exports, and components round identically (consensus D9
 * names `ReportService.ts`, `export.worker.ts`, `PressureOptimization.tsx` as
 * the offenders to fix against this table).
 *
 * Rounding uses round-half-to-even (banker's rounding) for stability, and
 * trailing significant zeros are preserved (e.g. "5.0", not "5", for a 1-dp
 * metric).
 *
 * @module analysis/uncertainty/formatMetric
 */

/** How a metric is rounded for display. */
export interface MetricPrecision {
  /** Number of decimal places to render. */
  readonly decimals: number;
}

/** Metric identifiers with a defined display precision. */
export type FormattableMetricId =
  | 'ahi'
  | 'rdi'
  | 'odi'
  | 'ai'
  | 'oai'
  | 'cai'
  | 'hypopneaIndex'
  | 'pressure'
  | 'leak'
  | 'leakMedian'
  | 'leakP95'
  | 'leakMax'
  | 'tidalVolume'
  | 'minuteVentilation'
  | 'respiratoryRate'
  | 'spo2'
  | 'spo2Min'
  | 't90'
  | 'usage'
  | 'compliance'
  | 'count';

/**
 * Display-precision registry per consensus D9.
 *
 * | Metric | Resolution |
 * |---|---|
 * | AHI / RDI / ODI / sub-indices (AI, oAI, cAI, hypopnea index) | 1 dp |
 * | Pressure (all stats) | 1 dp (ISO 80601-2-70 basis) |
 * | Leak median / P95 / max | integer L/min |
 * | Tidal volume | integer mL |
 * | Minute ventilation | 1 dp L/min |
 * | Respiratory rate | integer |
 * | SpO₂ mean / min | integer |
 * | T90 | integer minutes (stats correction) |
 * | Usage | 1 dp h |
 * | Compliance | integer % |
 * | Event counts | integer |
 */
export const PRECISION_REGISTRY: Readonly<Record<FormattableMetricId, MetricPrecision>> = {
  ahi: { decimals: 1 },
  rdi: { decimals: 1 },
  odi: { decimals: 1 },
  ai: { decimals: 1 },
  oai: { decimals: 1 },
  cai: { decimals: 1 },
  hypopneaIndex: { decimals: 1 },
  pressure: { decimals: 1 },
  leak: { decimals: 0 },
  leakMedian: { decimals: 0 },
  leakP95: { decimals: 0 },
  leakMax: { decimals: 0 },
  tidalVolume: { decimals: 0 },
  minuteVentilation: { decimals: 1 },
  respiratoryRate: { decimals: 0 },
  spo2: { decimals: 0 },
  spo2Min: { decimals: 0 },
  t90: { decimals: 0 },
  usage: { decimals: 1 },
  compliance: { decimals: 0 },
  count: { decimals: 0 },
};

/** Options for {@link formatMetric}. */
export interface FormatMetricOptions {
  /**
   * Decimals to use when `metricId` is unknown. Defaults to 1 (a conservative
   * choice that never invents precision beyond a single decimal).
   */
  readonly fallbackDecimals?: number;
}

/**
 * Round a value to `decimals` decimal places using round-half-to-even
 * (banker's rounding) for determinism and bias-free behaviour at the .5
 * midpoint.
 */
export function roundHalfToEven(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return NaN;
  const factor = Math.pow(10, decimals);
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let roundedScaled: number;
  if (diff > 0.5) {
    roundedScaled = floor + 1;
  } else if (diff < 0.5) {
    roundedScaled = floor;
  } else {
    // Exactly halfway — round to the nearest even integer.
    roundedScaled = floor % 2 === 0 ? floor : floor + 1;
  }
  // Normalise -0 to 0.
  const r = roundedScaled / factor;
  return r === 0 ? 0 : r;
}

/**
 * Format a metric value as a display string at the D9 precision, preserving
 * trailing significant zeros.
 *
 * Never mutates the input. Non-finite values render as an em-dash ("—").
 *
 * @param metricId the metric identifier (a {@link FormattableMetricId} or any
 *   string; unknown ids use `opts.fallbackDecimals`).
 * @param value    the full-precision stored value.
 * @param opts     optional formatting options.
 * @returns the rounded value as a string at the correct number of decimals.
 */
export function formatMetric(
  metricId: string,
  value: number,
  opts: FormatMetricOptions = {},
): string {
  if (!Number.isFinite(value)) return '—';
  const decimals = metricPrecision(metricId, opts.fallbackDecimals).decimals;
  const rounded = roundHalfToEven(value, decimals);
  return rounded.toFixed(decimals);
}

/**
 * Resolve the {@link MetricPrecision} for a metric id, falling back to
 * `fallbackDecimals` (default 1) for unknown ids.
 */
export function metricPrecision(metricId: string, fallbackDecimals = 1): MetricPrecision {
  const p = PRECISION_REGISTRY[metricId as FormattableMetricId];
  return p ?? { decimals: fallbackDecimals };
}
