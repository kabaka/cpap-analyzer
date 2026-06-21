/**
 * Human scope-label formatters for the Insight drawer header (UX §4.1 — the
 * panel header states the scope explicitly, e.g. "the night of 20 Jun 2026" or
 * "14–20 Jun 2026").
 *
 * These produce the friendly label the view passes into the drawer; the drawer
 * renders it verbatim in its "Summary of …" subhead. Dates are formatted for
 * display only — they are not part of the egress contract here (the snapshot
 * carries its own dates).
 *
 * @module components/insights/scopeLabel
 */

/** Format a `YYYY-MM-DD` string as e.g. "20 Jun 2026". */
export function formatScopeDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "the night of 20 Jun 2026". */
export function nightScopeLabel(isoDate: string): string {
  return `the night of ${formatScopeDate(isoDate)}`;
}

/** "14 Jun 2026 – 20 Jun 2026" (or a single date when start === end). */
export function rangeScopeLabel(startIso: string, endIso: string): string {
  if (startIso === endIso) return formatScopeDate(startIso);
  return `${formatScopeDate(startIso)} – ${formatScopeDate(endIso)}`;
}
