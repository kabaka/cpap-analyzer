/**
 * Unit tests for the settings persist migration (v0 → v1).
 *
 * The weather integration was reshaped from `{ enabled, apiKey, location: string }`
 * to the richer keyless config. The migration must:
 * - DROP `apiKey` entirely (Open-Meteo is keyless; a stale key is a privacy hazard);
 * - wrap the old free-text `location` string into the structured location object
 *   with null coordinates;
 * - fill all new weather fields from defaults;
 * - preserve every other settings slice untouched;
 * - never throw on a malformed blob.
 *
 * @module stores/__tests__/migrateSettings.test
 */

import { describe, it, expect } from 'vitest';
import { migrateSettings } from '../useSettingsStore';

describe('migrateSettings (v0 → v1)', () => {
  it('drops apiKey and wraps the old location string into the structured shape', () => {
    const legacy = {
      integrations: {
        fitbit: {
          enabled: true,
          visibleDataTypes: ['x'],
          lastImportAt: '2026-01-01',
          recordCount: 5,
        },
        weather: { enabled: true, apiKey: 'secret-key-123', location: 'London, UK' },
        llm: { enabled: false, provider: null, apiKey: null },
      },
    };

    const migrated = migrateSettings(legacy, 0);
    const weather = migrated.integrations?.weather;

    expect(weather).toBeDefined();
    // apiKey must be gone.
    expect(weather && 'apiKey' in weather).toBe(false);
    // The string location is wrapped; coordinates are null (cannot be inferred).
    expect(weather?.location).toEqual({ label: 'London, UK', latitude: null, longitude: null });
    // enabled is carried over.
    expect(weather?.enabled).toBe(true);
    // New fields fall back to defaults.
    expect(weather?.consentAt).toBeNull();
    expect(weather?.domains).toEqual({ core: true, airQuality: true });
    expect(weather?.units).toEqual({
      temperature: 'C',
      pressure: 'hPa',
      wind: 'kmh',
      precip: 'mm',
    });
    expect(weather?.resolution).toBe('daily+hourly');
    expect(weather?.autoSyncNewImports).toBe(false);
    expect(weather?.lastSyncAt).toBeNull();
  });

  it('maps an empty/blank legacy location string to a null label', () => {
    const migrated = migrateSettings(
      { integrations: { weather: { enabled: false, apiKey: null, location: '' } } },
      0,
    );
    expect(migrated.integrations?.weather?.location).toEqual({
      label: null,
      latitude: null,
      longitude: null,
    });
  });

  it('preserves other settings slices untouched', () => {
    const legacy = {
      analysisParams: { ahi: { mildThreshold: 7, moderateThreshold: 15, severeThreshold: 30 } },
      display: { dateFormat: 'DD/MM/YYYY', timeFormat: '12h', chartAnimations: false },
      integrations: {
        fitbit: { enabled: true, visibleDataTypes: ['a'], lastImportAt: null, recordCount: 9 },
        weather: { enabled: false, apiKey: 'k', location: 'X' },
        llm: { enabled: true, provider: 'anthropic', apiKey: 'sk' },
      },
    };

    const migrated = migrateSettings(legacy, 0);
    expect(migrated.analysisParams?.ahi.mildThreshold).toBe(7);
    expect(migrated.display?.dateFormat).toBe('DD/MM/YYYY');
    expect(migrated.integrations?.fitbit.recordCount).toBe(9);
    expect(migrated.integrations?.llm.provider).toBe('anthropic');
  });

  it('falls back to full defaults on a non-object blob (never throws)', () => {
    expect(() => migrateSettings(null, 0)).not.toThrow();
    const migrated = migrateSettings(null, 0);
    expect(migrated.integrations?.weather.enabled).toBe(false);
    expect(migrated.integrations?.weather.location).toEqual({
      label: null,
      latitude: null,
      longitude: null,
    });
  });

  it('tolerates a legacy state missing the weather slice entirely', () => {
    const migrated = migrateSettings({ integrations: {} }, 0);
    expect(migrated.integrations?.weather.location).toEqual({
      label: null,
      latitude: null,
      longitude: null,
    });
    expect(migrated.integrations?.weather.enabled).toBe(false);
  });

  it('returns the state unchanged when already at the current version', () => {
    const current = { integrations: { weather: { enabled: true } } };
    const migrated = migrateSettings(current, 1);
    expect(migrated).toBe(current);
  });
});
