/**
 * Detects machine settings changes between nightly aggregates.
 *
 * Compares configuredMinPressure, configuredMaxPressure, and eprLevel
 * between nights to find dates where settings were adjusted. This module is
 * the single source of truth for "settings changed" detection across the app
 * (Trends markers, Dashboard banner, and Dashboard auto-insights).
 *
 * @module views/Trends/utils/detectSettingsChanges
 */

import type { NightlyAggregate } from '@/types';

export interface SettingsChangeDetail {
  minPressure: number | null;
  maxPressure: number | null;
  eprLevel: number | null;
}

export interface SettingsChange {
  date: string;
  from: SettingsChangeDetail;
  to: SettingsChangeDetail;
}

/**
 * Whether two aggregates have different configured machine settings.
 *
 * Compares configured min/max pressure and EPR level. This is the shared
 * predicate behind every "settings changed" feature; keep it the only place
 * the comparison fields are enumerated so the three call sites stay in sync.
 */
export function settingsDiffer(a: NightlyAggregate, b: NightlyAggregate): boolean {
  return (
    a.configuredMinPressure !== b.configuredMinPressure ||
    a.configuredMaxPressure !== b.configuredMaxPressure ||
    a.eprLevel !== b.eprLevel
  );
}

/**
 * Find the date of the first night on which machine settings changed,
 * scanning oldest-to-newest.
 *
 * Returns the date of the first night whose configuration DIFFERS FROM ITS
 * IMMEDIATE PREDECESSOR — i.e. the first night the new settings took effect —
 * or `null` when there are fewer than two nights or no change is found. This is
 * exactly the date {@link detectSettingsChanges} assigns to its first change
 * entry, so the Dashboard settings banner and the auto-insights generator (which
 * both report a single change date) stay consistent with the Trends change list.
 */
export function findFirstSettingsChangeDate(aggregates: NightlyAggregate[]): string | null {
  if (aggregates.length < 2) return null;

  const sorted = [...aggregates].sort((a, b) => a.date.localeCompare(b.date));

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr) continue;
    if (settingsDiffer(prev, curr)) {
      // First night under the new settings.
      return curr.date;
    }
  }

  return null;
}

/**
 * Scan sorted aggregates for settings changes between consecutive nights.
 */
export function detectSettingsChanges(aggregates: NightlyAggregate[]): SettingsChange[] {
  if (aggregates.length < 2) return [];

  const sorted = [...aggregates].sort((a, b) => a.date.localeCompare(b.date));
  const changes: SettingsChange[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr) continue;

    if (settingsDiffer(prev, curr)) {
      changes.push({
        date: curr.date,
        from: {
          minPressure: prev.configuredMinPressure,
          maxPressure: prev.configuredMaxPressure,
          eprLevel: prev.eprLevel,
        },
        to: {
          minPressure: curr.configuredMinPressure,
          maxPressure: curr.configuredMaxPressure,
          eprLevel: curr.eprLevel,
        },
      });
    }
  }
  return changes;
}
