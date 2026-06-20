/**
 * Settings → Integrations weather panel (de-stubs the accordion item).
 *
 * Owns the full opt-in lifecycle:
 * - **Two-gate consent**: the toggle opens {@link ConsentDialog}; only on an
 *   acknowledged Enable do we set `enabled: true` and persist `consentAt`.
 *   Cancelling reverts the toggle.
 * - **Config** (shown when enabled): manual latitude/longitude (canonical) +
 *   city Find + a one-time "Use current location" geolocation convenience with
 *   full error mapping; unit SegmentedControls; Core / Air quality domain
 *   checkboxes (no pollen); resolution SegmentedControl; a primary "Sync now";
 *   an auto-sync toggle (default off); and a "Last synced / N days" status.
 * - **On disable**: a prompt offering to also delete stored weather data, with
 *   Keep as the default/focused action (the locked decision).
 *
 * Coordinates are the canonical stored value (always rounded to 2 dp by the
 * network layer and the geocoder); the label is cosmetic.
 *
 * @module views/Settings/weather/WeatherIntegrationPanel
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, Input, SegmentedControl, Switch } from '@/components/ui';
import { useAppStore } from '@/stores/useAppStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useSessionData } from '@/hooks/useSessionData';
import { roundCoordinate } from '@/analysis/weather/coordinates';
import { geocode } from '@/services/weather/geocoding';
import { countWeatherDays, deleteAllWeatherData } from '@/services/weather/weatherDataService';
import type { WeatherLocation } from '@/types/weather';
import { ConsentDialog } from './ConsentDialog';
import { SyncSheet } from './SyncSheet';
import { buildSyncNights } from './syncNights';
import styles from './WeatherIntegrationPanel.module.css';

// ─── Unit option tables ────────────────────────────────────────────────────

const TEMPERATURE_OPTIONS = [
  { value: 'C' as const, label: '°C', ariaLabel: 'Celsius' },
  { value: 'F' as const, label: '°F', ariaLabel: 'Fahrenheit' },
];
const PRESSURE_OPTIONS = [
  { value: 'hPa' as const, label: 'hPa', ariaLabel: 'Hectopascals' },
  { value: 'inHg' as const, label: 'inHg', ariaLabel: 'Inches of mercury' },
];
const WIND_OPTIONS = [
  { value: 'kmh' as const, label: 'km/h', ariaLabel: 'Kilometres per hour' },
  { value: 'mph' as const, label: 'mph', ariaLabel: 'Miles per hour' },
  { value: 'ms' as const, label: 'm/s', ariaLabel: 'Metres per second' },
];
const RESOLUTION_OPTIONS = [
  { value: 'daily' as const, label: 'Daily', ariaLabel: 'Daily summaries only' },
  {
    value: 'daily+hourly' as const,
    label: 'Daily + Hourly',
    ariaLabel: 'Daily summaries plus hourly series',
  },
];

/** Map a GeolocationPositionError code to a user-facing message. */
function geolocationErrorMessage(code: number): string {
  switch (code) {
    case 1:
      return 'Location permission was denied. Enter coordinates manually below.';
    case 2:
      return 'Your location is unavailable right now. Enter coordinates manually below.';
    case 3:
      return 'Getting your location timed out. Enter coordinates manually below.';
    default:
      return 'Could not get your location. Enter coordinates manually below.';
  }
}

/** Whether the geolocation API is usable (present + secure context). */
function geolocationAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'geolocation' in navigator &&
    (typeof window === 'undefined' || window.isSecureContext !== false)
  );
}

export function WeatherIntegrationPanel(): JSX.Element {
  const weather = useSettingsStore((s) => s.integrations.weather);
  const updateIntegration = useSettingsStore((s) => s.updateIntegration);
  const dateRange = useAppStore((s) => s.dateRange);
  const { sessions } = useSessionData(dateRange);

  // Dialog visibility.
  const [consentOpen, setConsentOpen] = useState(false);
  const [disablePromptOpen, setDisablePromptOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  // Location entry working state.
  const [latInput, setLatInput] = useState(
    weather.location.latitude !== null ? String(weather.location.latitude) : '',
  );
  const [lonInput, setLonInput] = useState(
    weather.location.longitude !== null ? String(weather.location.longitude) : '',
  );
  const [cityInput, setCityInput] = useState(weather.location.label ?? '');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const latRef = useRef<HTMLInputElement>(null);

  // Status: distinct civil days of stored weather data. Counted as days (not
  // nights) because a midnight-spanning night stores a summary for two civil
  // dates; see countWeatherDays for why this helper cannot collapse to nights.
  const [dayCount, setDayCount] = useState<number | null>(null);
  const refreshDayCount = useCallback(() => {
    void countWeatherDays()
      .then(setDayCount)
      .catch(() => setDayCount(null));
  }, []);

  // Initial / on-enable count.
  useEffect(() => {
    if (weather.enabled) refreshDayCount();
  }, [weather.enabled, refreshDayCount]);

  // ── Two-gate consent ──

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (checked) {
        // Gate 2: open the consent dialog instead of enabling immediately.
        setConsentOpen(true);
      } else {
        // Disabling: stop requests immediately, then offer to delete data.
        updateIntegration('weather', { enabled: false });
        setDisablePromptOpen(true);
      }
    },
    [updateIntegration],
  );

  const handleConsentEnable = useCallback(() => {
    updateIntegration('weather', { enabled: true, consentAt: new Date().toISOString() });
    setConsentOpen(false);
    refreshDayCount();
  }, [updateIntegration, refreshDayCount]);

  const handleConsentCancel = useCallback(() => {
    // Revert: the switch was visually on; ensure settings stay disabled.
    setConsentOpen(false);
  }, []);

  // ── Location handlers ──

  const commitCoordinates = useCallback(
    (lat: number, lon: number, label: string | null) => {
      const rLat = roundCoordinate(lat);
      const rLon = roundCoordinate(lon);
      const next: WeatherLocation = { label, latitude: rLat, longitude: rLon };
      updateIntegration('weather', { location: next });
      setLatInput(String(rLat));
      setLonInput(String(rLon));
      if (label !== null) setCityInput(label);
    },
    [updateIntegration],
  );

  const handleManualBlur = useCallback(() => {
    const lat = Number.parseFloat(latInput);
    const lon = Number.parseFloat(lonInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    // Manual entry keeps the existing label (coordinates are canonical).
    commitCoordinates(lat, lon, weather.location.label);
  }, [latInput, lonInput, commitCoordinates, weather.location.label]);

  const handleFind = useCallback(async () => {
    setFindError(null);
    setFinding(true);
    try {
      const results = await geocode(cityInput);
      const best = results[0];
      if (!best) {
        setFindError('No matching place found.');
        return;
      }
      commitCoordinates(best.latitude, best.longitude, best.label);
    } catch (err) {
      setFindError(err instanceof Error ? err.message : 'Location search failed.');
    } finally {
      setFinding(false);
    }
  }, [cityInput, commitCoordinates]);

  const handleUseCurrentLocation = useCallback(() => {
    setGeoError(null);
    if (!geolocationAvailable()) {
      setGeoError('Location is not available in this browser. Enter coordinates manually below.');
      latRef.current?.focus();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Coordinates are rounded on commit; the label stays as-is (no reverse
        // geocode — Open-Meteo geocoding is forward-only and an extra call).
        commitCoordinates(
          position.coords.latitude,
          position.coords.longitude,
          weather.location.label,
        );
      },
      (error) => {
        setGeoError(geolocationErrorMessage(error.code));
        latRef.current?.focus();
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 },
    );
  }, [commitCoordinates, weather.location.label]);

  // ── On-disable deletion prompt ──

  const handleKeepData = useCallback(() => {
    setDisablePromptOpen(false);
  }, []);

  const handleDeleteData = useCallback(() => {
    void deleteAllWeatherData()
      .then(() => {
        setDayCount(0);
      })
      .catch(() => {
        /* best-effort; the prompt closes regardless */
      })
      .finally(() => setDisablePromptOpen(false));
  }, []);

  // ── Sync nights + location for the sheet ──

  const syncLocation: WeatherLocation = useMemo(
    () => ({
      label: weather.location.label,
      latitude: weather.location.latitude,
      longitude: weather.location.longitude,
    }),
    [weather.location.label, weather.location.latitude, weather.location.longitude],
  );

  const nights = useMemo(() => buildSyncNights(sessions), [sessions]);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto', []);

  const hasLocation = weather.location.latitude !== null && weather.location.longitude !== null;

  const lastSyncedText = weather.lastSyncAt
    ? new Date(weather.lastSyncAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'Never';

  return (
    <div className={styles.panel}>
      <div className={styles.switchRow}>
        <div className={styles.switchInfo}>
          <span className={styles.switchLabel}>Enable Weather &amp; Air Quality</span>
          <span className={styles.switchDescription}>
            Correlate therapy with local weather and air quality from Open-Meteo. This integration
            makes outbound network requests; enabling requires explicit consent.
          </span>
        </div>
        <Switch checked={weather.enabled} onCheckedChange={handleToggle} />
      </div>

      {weather.enabled && (
        <div className={styles.config}>
          {/* Location group */}
          <fieldset className={styles.group}>
            <legend className={styles.groupLegend}>Location</legend>
            <div className={styles.coordRow}>
              <Input
                ref={latRef}
                label="Latitude"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={latInput}
                onChange={(e) => setLatInput(e.target.value)}
                onBlur={handleManualBlur}
                hint="decimal degrees (rounded to ~1.1 km)"
              />
              <Input
                label="Longitude"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={lonInput}
                onChange={(e) => setLonInput(e.target.value)}
                onBlur={handleManualBlur}
                hint="decimal degrees"
              />
            </div>

            <div className={styles.cityRow}>
              <Input
                label="City (optional)"
                placeholder="e.g. Berlin"
                value={cityInput}
                onChange={(e) => setCityInput(e.target.value)}
                hint="Find sends this name to Open-Meteo"
              />
              <Button
                variant="ghost"
                onClick={() => void handleFind()}
                loading={finding}
                disabled={cityInput.trim().length === 0}
              >
                Find
              </Button>
            </div>
            {findError && (
              <p className={styles.fieldError} role="alert">
                {findError}
              </p>
            )}

            {geolocationAvailable() && (
              <Button variant="secondary" onClick={handleUseCurrentLocation}>
                <span aria-hidden="true">⌖</span> Use current location
              </Button>
            )}
            {geoError && (
              <p className={styles.fieldError} role="alert">
                {geoError}
              </p>
            )}
          </fieldset>

          {/* Units */}
          <fieldset className={styles.group}>
            <legend className={styles.groupLegend}>Units</legend>
            <div className={styles.unitRow}>
              <span className={styles.unitLabel}>Temperature</span>
              <SegmentedControl
                label="Temperature unit"
                options={TEMPERATURE_OPTIONS}
                value={weather.units.temperature}
                onChange={(v) =>
                  updateIntegration('weather', { units: { ...weather.units, temperature: v } })
                }
              />
            </div>
            <div className={styles.unitRow}>
              <span className={styles.unitLabel}>Pressure</span>
              <SegmentedControl
                label="Pressure unit"
                options={PRESSURE_OPTIONS}
                value={weather.units.pressure}
                onChange={(v) =>
                  updateIntegration('weather', { units: { ...weather.units, pressure: v } })
                }
              />
            </div>
            <div className={styles.unitRow}>
              <span className={styles.unitLabel}>Wind</span>
              <SegmentedControl
                label="Wind speed unit"
                options={WIND_OPTIONS}
                value={weather.units.wind}
                onChange={(v) =>
                  updateIntegration('weather', { units: { ...weather.units, wind: v } })
                }
              />
            </div>
          </fieldset>

          {/* Data domains */}
          <fieldset className={styles.group}>
            <legend className={styles.groupLegend}>Data</legend>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={weather.domains.core}
                onChange={(e) =>
                  updateIntegration('weather', {
                    domains: { ...weather.domains, core: e.target.checked },
                  })
                }
              />
              <span>Core weather (temperature, humidity, pressure, wind…)</span>
            </label>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={weather.domains.airQuality}
                onChange={(e) =>
                  updateIntegration('weather', {
                    domains: { ...weather.domains, airQuality: e.target.checked },
                  })
                }
              />
              <span>Air quality (PM2.5, PM10, ozone, AQI)</span>
            </label>
          </fieldset>

          {/* Resolution */}
          <fieldset className={styles.group}>
            <legend className={styles.groupLegend}>Resolution</legend>
            <SegmentedControl
              label="Data resolution"
              options={RESOLUTION_OPTIONS}
              value={weather.resolution}
              onChange={(v) => updateIntegration('weather', { resolution: v })}
            />
          </fieldset>

          {/* Status + Sync */}
          <div className={styles.statusRow}>
            <span className={styles.statusText}>
              Last synced: {lastSyncedText}
              {dayCount !== null && (
                <>
                  {' · '}
                  {dayCount} {dayCount === 1 ? 'day' : 'days'} of weather data
                </>
              )}
            </span>
            <Button
              variant="primary"
              onClick={() => setSyncOpen(true)}
              disabled={!hasLocation}
              title={hasLocation ? undefined : 'Set a location first'}
            >
              Sync now
            </Button>
          </div>

          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={weather.autoSyncNewImports}
              onChange={(e) =>
                updateIntegration('weather', { autoSyncNewImports: e.target.checked })
              }
            />
            <span>Auto-sync newly imported nights</span>
          </label>
        </div>
      )}

      {/* Two-gate consent dialog */}
      <ConsentDialog
        open={consentOpen}
        onCancel={handleConsentCancel}
        onEnable={handleConsentEnable}
      />

      {/* On-disable deletion prompt (Keep is the default action) */}
      <Dialog
        open={disablePromptOpen}
        onOpenChange={(next) => {
          if (!next) setDisablePromptOpen(false);
        }}
        title="Weather integration disabled"
        description={
          dayCount && dayCount > 0
            ? `Also delete the ${dayCount} ${dayCount === 1 ? 'day' : 'days'} of stored weather data?`
            : 'No stored weather data to delete.'
        }
      >
        <div className={styles.dialogActions}>
          {dayCount && dayCount > 0 ? (
            <>
              {/* Keep is the default/focused action per the locked decision. */}
              <Button variant="primary" onClick={handleKeepData} autoFocus>
                Keep data
              </Button>
              <Button variant="secondary" onClick={handleDeleteData}>
                Delete data
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={handleKeepData} autoFocus>
              Close
            </Button>
          )}
        </div>
      </Dialog>

      {/* Sync sheet */}
      <SyncSheet
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        nights={nights}
        location={syncLocation}
        timezone={timezone}
        today={today}
        fetchCore={weather.domains.core}
        fetchAirQuality={weather.domains.airQuality}
        storeHourly={weather.resolution === 'daily+hourly'}
        onSynced={() => {
          updateIntegration('weather', { lastSyncAt: new Date().toISOString() });
          refreshDayCount();
        }}
      />
    </div>
  );
}
