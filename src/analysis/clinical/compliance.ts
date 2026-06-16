/**
 * Canonical CPAP usage / adherence hour thresholds.
 *
 * Single source of truth for the two usage-hour cutoffs that were previously
 * written inline as bare `4` and `6` literals across the session builder, the
 * Trends usage chart, the stats sidebar, and the dashboard therapy overview.
 *
 * These are adherence thresholds, distinct from the `short-session`
 * data-quality flag in `analysis/uncertainty/constants.ts`
 * ({@link SHORT_SESSION_HOURS}), which happens to share the value 4 but carries
 * a different semantic (a data-reliability flag, not a compliance verdict).
 *
 * @module analysis/clinical/compliance
 */

/**
 * CMS (US Medicare) compliance threshold in hours.
 *
 * A night counts as "compliant" when mask-on usage is at least this many
 * hours. Used for the compliant/partial/non-compliant verdict and the lower
 * usage reference line.
 */
export const CMS_COMPLIANCE_HOURS = 4;

/**
 * Recommended nightly usage target in hours.
 *
 * Not a regulatory floor — the commonly cited "good adherence" target above
 * the CMS minimum. Used for the upper usage reference line and the green
 * usage-bar colour band.
 */
export const RECOMMENDED_USAGE_HOURS = 6;
