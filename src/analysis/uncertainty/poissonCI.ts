/**
 * Poisson rate confidence interval for per-night CPAP event indices.
 *
 * The dominant uncertainty in a per-night index (AHI = N / T) is the Poisson
 * counting noise of the event count N; the duration T (mask-on hours) is
 * comparatively well known. This module returns a rate interval in events/hr.
 *
 * IMPORTANT — this is a LOWER BOUND on the true uncertainty, not "the 95 % CI".
 * Respiratory events are strongly clustered (REM-locked, supine-locked,
 * arousal cascades), i.e. **over-dispersed**: the true Var(N) exceeds the
 * Poisson mean λT, so √N and the Garwood interval are too narrow. Callers must
 * label this as a "Poisson sampling interval (lower bound on uncertainty)",
 * never as the definitive 95 % CI (consensus D4, stats-review §1). We do NOT
 * apply an over-dispersion multiplier — it is not identifiable from a single
 * night and would be a fabricated constant.
 *
 * @module analysis/uncertainty/poissonCI
 */

import { inverseChiSquare, inverseNormalCDF } from '../math';
import { POISSON_NORMAL_APPROX_MIN_COUNT } from './constants';

/** Result of a Poisson rate CI computation, all in events per hour. */
export interface PoissonRateCI {
  /** Point estimate of the rate: count / hours (events/hr). */
  readonly point: number;
  /** Lower confidence bound (events/hr). */
  readonly lower: number;
  /** Upper confidence bound (events/hr). */
  readonly upper: number;
  /** Which method produced the bounds. */
  readonly method: 'exact' | 'normal';
}

/**
 * Z-multiplier for a two-sided interval at confidence `conf`. Centralised so
 * both the exact and normal paths agree on it.
 */
function zFor(conf: number): number {
  return inverseNormalCDF(1 - (1 - conf) / 2);
}

/**
 * Normal-approximation Poisson rate CI: `(N ± z·√N) / hours`, lower clamped at
 * 0. Exposed as the explicit "fast / teaching path" — `poissonRateCI` selects
 * exact vs normal per consensus D4. Same validation contract as
 * {@link poissonRateCI}.
 *
 * @param count integer event count N (≥ 0).
 * @param hours mask-on duration T in hours (> 0).
 * @param conf  confidence level in (0, 1); defaults to 0.95.
 */
export function poissonRateCINormal(count: number, hours: number, conf = 0.95): PoissonRateCI {
  if (!Number.isFinite(count) || !Number.isFinite(hours) || !Number.isFinite(conf)) return INVALID;
  if (count < 0 || !Number.isInteger(count)) return INVALID;
  if (hours <= 0) return INVALID;
  if (conf <= 0 || conf >= 1) return INVALID;

  const point = count / hours;
  const halfWidth = (zFor(conf) * Math.sqrt(count)) / hours;
  const lower = point - halfWidth;
  return {
    point,
    lower: lower < 0 ? 0 : lower,
    upper: point + halfWidth,
    method: 'normal',
  };
}

const INVALID: PoissonRateCI = {
  point: NaN,
  lower: NaN,
  upper: NaN,
  method: 'exact',
};

/**
 * Two-sided Poisson rate confidence interval for a per-night index.
 *
 * Method selection (consensus D4):
 * - **Exact Garwood chi-square** for `count < 20` (the normal lower bound can
 *   go negative at low counts):
 *     λ_lo = ½·χ²(α/2 ; 2N),   λ_hi = ½·χ²(1−α/2 ; 2N+2),   rate = λ / hours.
 *   For N = 0 the lower bound is 0 and the two-sided upper count is
 *   ½·χ²(0.975 ; 2) = 3.689 (≈0.615 /h at 6 h) — never the one-sided 3.0.
 * - **Normal approximation** `(N ± z·√N) / hours` for `count ≥ 20`, with the
 *   lower bound clamped at 0.
 *
 * @param count integer event count N (≥ 0). Non-integer or negative → NaN.
 * @param hours mask-on duration T in hours (> 0). `hours ≤ 0` → NaN.
 * @param conf  confidence level in (0, 1); defaults to 0.95.
 * @returns a {@link PoissonRateCI} in events/hr.
 */
export function poissonRateCI(count: number, hours: number, conf = 0.95): PoissonRateCI {
  // --- Input validation ---------------------------------------------------
  if (!Number.isFinite(count) || !Number.isFinite(hours) || !Number.isFinite(conf)) {
    return INVALID;
  }
  if (count < 0 || !Number.isInteger(count)) return INVALID;
  if (hours <= 0) return INVALID;
  if (conf <= 0 || conf >= 1) return INVALID;

  // --- Exact Garwood chi-square (count < 20) ------------------------------
  if (count < POISSON_NORMAL_APPROX_MIN_COUNT) {
    return poissonRateCIExact(count, hours, conf);
  }

  // --- Normal approximation (count ≥ 20) ----------------------------------
  return poissonRateCINormal(count, hours, conf);
}

/**
 * Exact Garwood chi-square rate CI for ANY count (events/hr). `poissonRateCI`
 * uses this only for `count < 20`, but it is exposed because (a) the consensus
 * D4 reference vectors are exact-Garwood values verifiable at all N and (b) it
 * is safe at every N (the normal approximation merely converges to it).
 *
 * Same validation contract as {@link poissonRateCI}.
 */
export function poissonRateCIExact(count: number, hours: number, conf = 0.95): PoissonRateCI {
  if (!Number.isFinite(count) || !Number.isFinite(hours) || !Number.isFinite(conf)) return INVALID;
  if (count < 0 || !Number.isInteger(count)) return INVALID;
  if (hours <= 0) return INVALID;
  if (conf <= 0 || conf >= 1) return INVALID;

  const alpha = 1 - conf;
  const lowerCount = count === 0 ? 0 : 0.5 * inverseChiSquare(alpha / 2, 2 * count);
  const upperCount = 0.5 * inverseChiSquare(1 - alpha / 2, 2 * count + 2);
  return {
    point: count / hours,
    lower: lowerCount / hours,
    upper: upperCount / hours,
    method: 'exact',
  };
}
