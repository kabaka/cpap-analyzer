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

/**
 * Minimum recording time (hours) below which a per-hour RATE index (AHI, RDI,
 * the AHI sub-indices, and ODI) is **not defined** and must be represented as
 * `null` — never `0`, never a clamped number.
 *
 * ## Why this exists (the bug it fixes)
 * A per-hour index is `eventCount / usageHours`. As the denominator approaches
 * zero the quotient explodes: a single event over ~1 second of recording yields
 * `1 / (1/3600) = 3600` events/hour. That figure is not "imprecise" — it is
 * *mathematically meaningless*, an extrapolation of seconds of data to an hour.
 * A ~5-minute mask-fit clip with one unnoticed event must therefore report "no
 * defined rate" (`null`), not a poisoned 3600.
 *
 * ## Why 1 hour, and why it is its own constant
 * This is a **rate-validity floor**, deliberately distinct from the two other
 * thresholds it is easy to confuse it with:
 *
 * - It is NOT {@link SHORT_SESSION_HOURS} (4 h, the CMS compliance/adherence
 *   floor). Compliance accounting answers "did the patient use the machine
 *   long enough to count?"; this answers "is the recording long enough for a
 *   per-hour rate to mean anything?". A 2-hour night is non-compliant yet still
 *   yields a perfectly stable AHI — we must not discard its rate.
 * - It is NOT {@link POISSON_NORMAL_APPROX_MIN_COUNT} (an event-COUNT precision
 *   gate). That governs how wide the confidence interval is *given* a valid
 *   rate; this governs whether a rate exists at all. Count-precision and
 *   time-validity are orthogonal: 0 events over 1 second is still an undefined
 *   rate even though the count is precise.
 *
 * The 1-hour value follows established prior art in this codebase:
 * `MIN_CENTRAL_USAGE_HOURS = 1` in `views/Trends/utils/centralTrend.ts` already
 * excludes nights `< 1 h` from the central-index trend "for rate stability".
 * An hour also guarantees the denominator is `≥ 1`, so the quotient can never
 * exceed the raw event count — the runaway-amplification failure mode is
 * structurally impossible above the floor.
 *
 * @see SHORT_SESSION_HOURS — the distinct 4 h compliance/adherence floor.
 * @see POISSON_NORMAL_APPROX_MIN_COUNT — the distinct event-count precision gate.
 */
export const MIN_INDEX_USAGE_HOURS = 1;
