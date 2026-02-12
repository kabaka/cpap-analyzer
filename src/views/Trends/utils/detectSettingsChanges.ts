/**
 * Detects machine settings changes between consecutive nightly aggregates.
 *
 * Compares configuredMinPressure, configuredMaxPressure, and eprLevel
 * between consecutive nights to find dates where settings were adjusted.
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

    if (
      prev.configuredMinPressure !== curr.configuredMinPressure ||
      prev.configuredMaxPressure !== curr.configuredMaxPressure ||
      prev.eprLevel !== curr.eprLevel
    ) {
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
