/**
 * Unit tests for the settings persist migration (v0 → v1 → v2).
 *
 * v0 → v1 reshaped the weather integration from
 * `{ enabled, apiKey, location: string }` to the richer keyless config.
 * v1 → v2 reshaped the llm stub from `{ enabled, provider, apiKey }` into the
 * AI Insights config (ADR 0024). Migrations apply cumulatively, so a v0 blob
 * runs both steps.
 *
 * The weather (v0 → v1) step must:
 * - DROP `apiKey` entirely (Open-Meteo is keyless; a stale key is a privacy hazard);
 * - wrap the old free-text `location` string into the structured location object
 *   with null coordinates;
 * - FORCE re-consent: reset `enabled` to false and `consentAt` to null regardless
 *   of the legacy value, so a migrated user re-passes the consent gate before any
 *   egress is possible;
 * - fill all new weather fields from defaults.
 *
 * The llm (v1 → v2) step must:
 * - map `provider:'anthropic' → backend:'anthropic'`, `'openai' → 'openai-compatible'`,
 *   and `null`/unknown → `backend:null` (never auto-select cloud);
 * - DROP the persisted `apiKey` (keys never enter persisted settings — ADR 0024 §4);
 * - FORCE the feature off: `enabled:false`, `consentAt:null`,
 *   `consentContractVersion:null`, regardless of the legacy value.
 *
 * In all cases the migration must preserve every other settings slice untouched
 * and never throw on a malformed blob.
 *
 * @module stores/__tests__/migrateSettings.test
 */

import { describe, it, expect } from 'vitest';
import { migrateSettings } from '../useSettingsStore';

describe('migrateSettings (v0 → v1 → v2)', () => {
  it('drops apiKey, wraps the old location string, and forces re-consent', () => {
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
    // Re-consent is forced: the legacy `enabled: true` is discarded so the user
    // must re-pass the consent gate before any egress is possible.
    expect(weather?.enabled).toBe(false);
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

  it('forces a previously enabled (and consented) legacy weather config back off', () => {
    const migrated = migrateSettings(
      {
        integrations: {
          weather: {
            enabled: true,
            consentAt: '2025-01-01T00:00:00.000Z',
            apiKey: 'k',
            location: 'Berlin',
          },
        },
      },
      0,
    );
    const weather = migrated.integrations?.weather;
    expect(weather?.enabled).toBe(false);
    expect(weather?.consentAt).toBeNull();
    // Location is still preserved so re-consent is low-friction.
    expect(weather?.location).toEqual({ label: 'Berlin', latitude: null, longitude: null });
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
    // llm.provider:'anthropic' maps to backend:'anthropic' under v1 → v2; the
    // legacy key is dropped and the feature is forced off.
    const llm = migrated.integrations?.llm;
    expect(llm?.backend).toBe('anthropic');
    expect(llm?.enabled).toBe(false);
    expect(llm && 'provider' in llm).toBe(false);
    expect(llm && 'apiKey' in llm).toBe(false);
  });

  it('migrates the llm stub: maps provider→backend, drops apiKey, forces off (v1 → v2)', () => {
    const v1State = {
      integrations: {
        weather: {
          enabled: true,
          consentAt: '2025-01-01T00:00:00.000Z',
          location: { label: 'Paris', latitude: 48.85, longitude: 2.35 },
          units: { temperature: 'C', pressure: 'hPa', wind: 'kmh', precip: 'mm' },
          domains: { core: true, airQuality: true },
          resolution: 'daily+hourly',
          autoSyncNewImports: false,
          lastSyncAt: null,
        },
        llm: { enabled: true, provider: 'openai', apiKey: 'sk-secret' },
      },
    };

    // Migrating from v1 leaves the (already-current) weather slice untouched and
    // only reshapes llm.
    const migrated = migrateSettings(v1State, 1);
    const llm = migrated.integrations?.llm;
    expect(llm?.backend).toBe('openai-compatible');
    expect(llm?.enabled).toBe(false);
    expect(llm?.consentAt).toBeNull();
    expect(llm?.consentContractVersion).toBeNull();
    expect(llm?.anthropic).toEqual({ model: 'claude-opus-4-8' });
    expect(llm?.webllm).toEqual({ modelId: null });
    expect(llm?.openaiCompatible).toEqual({ baseUrl: null, model: null });
    // The persisted key never survives migration.
    expect(llm && 'apiKey' in llm).toBe(false);
    expect(llm && 'provider' in llm).toBe(false);
    // The already-current weather slice is preserved.
    expect(migrated.integrations?.weather.enabled).toBe(true);
  });

  it('maps a null/absent legacy llm provider to backend:null (never auto-cloud)', () => {
    const migrated = migrateSettings(
      { integrations: { llm: { enabled: true, provider: null, apiKey: null } } },
      1,
    );
    expect(migrated.integrations?.llm.backend).toBeNull();
    expect(migrated.integrations?.llm.enabled).toBe(false);
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
    const migrated = migrateSettings(current, 2);
    expect(migrated).toBe(current);
  });
});
