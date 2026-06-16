/**
 * Named constants for the measurement-uncertainty / reliability feature.
 *
 * Centralises the device-convention thresholds and rare-class gates so that
 * (a) the ~8 scattered `24` leak literals are consolidated (consensus D7) and
 * (b) any `[?]`-flagged figure stays out of logic until `resmed-specialist`
 * verifies it (consensus D10).
 *
 * IMPORTANT — provenance discipline:
 * The leak figures below are **device-reporting conventions** (what the ResMed
 * AirSense indicator shows the user), NOT AASM clinical standards. They are
 * deliberately *not* the unverified `[?]` figures (FOT amplitude, ±0.5+4 %
 * pressure tolerance, 0.2 cmH₂O resolution, the S9-era 42 L/min figure), none
 * of which appear here.
 *
 * @module analysis/uncertainty/constants
 */

/**
 * Unintentional-leak level (L/min) at which a user-facing **data-quality
 * notice** appears. Matches the ResMed AirSense "red zone" reporting
 * convention the user already sees on the device — chosen as the lower, more
 * conservative gate (consensus D7).
 *
 * Convention, not an AASM standard. ResMed-specific (unintentional leak);
 * never reuse for Philips, which reports *total* leak. Pending
 * `resmed-specialist` confirmation.
 */
export const LEAK_NOTICE_LPM = 24;

/**
 * Unintentional-leak level (L/min) at which flow-derived metrics (tidal
 * volume, minute ventilation, respiratory rate, flow-limitation) are actually
 * **flagged/suppressed** as unreliable (consensus D7). Graduated, not a hard
 * cliff: the 24–30 L/min band gets a notice but the values remain usable.
 *
 * Convention, not an AASM standard. ResMed-specific. Pending
 * `resmed-specialist` confirmation.
 */
export const LEAK_SUPPRESS_LPM = 30;

/**
 * Minimum total event count required before a central-vs-obstructive split
 * (or central-fraction ratio) is considered reportable (consensus D8).
 *
 * Documented convention — a round floor, not a validated cutoff.
 */
export const MIN_SPLIT_TOTAL_EVENTS = 20;

/**
 * Minimum number of events in the *rarer* sub-class (typically central)
 * required before the split is considered reportable (consensus D8). Below
 * this, false-positive leakage from the abundant class dominates the rare-
 * class count.
 *
 * Documented convention — a round floor, not a validated cutoff.
 */
export const MIN_RARE_CLASS_EVENTS = 5;

/**
 * Event-count threshold below which the exact Garwood chi-square Poisson CI
 * is used; at or above it the normal approximation `(N ± z√N)/T` is adequate
 * (consensus D4). Standard statistical practice for the Poisson normal
 * approximation.
 */
export const POISSON_NORMAL_APPROX_MIN_COUNT = 20;

/**
 * Minimum fraction of a recording (0–1) that must have valid SpO₂ samples
 * before oximetry-derived metrics (mean/min/T90/ODI) are reported rather than
 * suppressed.
 *
 * Engineering convention — no specific clinical citation. Pending `ux` /
 * `resmed-specialist` sign-off on strictness.
 */
export const SPO2_COVERAGE_MIN = 0.5;

/**
 * Minimum mask-on session length (hours) below which a single-session value
 * is flagged as a short session (a `short-session` data-quality flag).
 *
 * Borrows the 4-hour compliance convention purely as a UX proxy; AHI
 * *precision* is properly gated on event count N (consensus D8), so this only
 * raises a data-quality flag — it does not by itself set the reliability tier.
 */
export const SHORT_SESSION_HOURS = 4;
