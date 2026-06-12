/**
 * Render helpers for the Trends settings-change vertical markers.
 *
 * Given a {@link SettingsChange} (from {@link detectSettingsChanges}), emit a
 * compact, human-readable summary like `"max 12 → 15"` or `"EPR 1 → 2"` for
 * the marker label and SVG `<title>` hover text.
 *
 * Each marker is rendered by every synced Trends chart, so the label needs to
 * be terse — only the *differing* fields appear, and the values are formatted
 * with one decimal place for pressures, integers for EPR.
 *
 * @module views/Trends/utils/formatSettingsChange
 */

import type { SettingsChange, SettingsChangeDetail } from './detectSettingsChanges';

function fmtPressure(v: number | null): string {
  if (v === null) return '—';
  return v.toFixed(1);
}

function fmtEpr(v: number | null): string {
  if (v === null) return '—';
  return String(v);
}

/**
 * Build a short human-readable summary of a single settings change for the
 * marker label and tooltip. Only the fields that actually changed are
 * included.
 *
 * Example: `"min 6.0 → 7.0 · max 15.0 → 18.0"`.
 *
 * Returns the literal date when no field actually differs (defensive; the
 * detector should never emit a zero-diff entry).
 */
export function describeSettingsChange(change: SettingsChange): string {
  const { from, to } = change;
  const parts: string[] = [];
  if (from.minPressure !== to.minPressure) {
    parts.push(`min ${fmtPressure(from.minPressure)} → ${fmtPressure(to.minPressure)}`);
  }
  if (from.maxPressure !== to.maxPressure) {
    parts.push(`max ${fmtPressure(from.maxPressure)} → ${fmtPressure(to.maxPressure)}`);
  }
  if (from.eprLevel !== to.eprLevel) {
    parts.push(`EPR ${fmtEpr(from.eprLevel)} → ${fmtEpr(to.eprLevel)}`);
  }
  if (parts.length === 0) return change.date;
  return parts.join(' · ');
}

/** Marker label — same content as {@link describeSettingsChange} but typed for
 *  Recharts' label prop. Kept separate so the renderer's contract stays
 *  obvious to readers. */
export function settingsChangeLabel(change: SettingsChange): string {
  return describeSettingsChange(change);
}

export type { SettingsChange, SettingsChangeDetail };
