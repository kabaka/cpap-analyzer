import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@test/test-utils';
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { UseWeatherNightlyResult } from '@/hooks/useWeatherNightly';
import type { WeatherNightly } from '@/analysis/weather';

// Mockable hook return — the panel sources its nightly metrics from the single
// shared canonical hook, so the overnight numbers are identical to the
// correlation surface (no panel-local overnight window).
const nightlyState: { value: UseWeatherNightlyResult } = {
  value: { data: [], latest: null, loading: false, error: null },
};

vi.mock('@/hooks/useWeatherNightly', () => ({
  useWeatherNightly: () => nightlyState.value,
}));

import WeatherPanel from './WeatherPanel';

function enableWeather(enabled: boolean) {
  useSettingsStore.getState().updateIntegration('weather', { enabled });
}

/** Build a canonical nightly record for `date` with all metrics present. */
function nightly(date: string, overrides: Partial<WeatherNightly> = {}): WeatherNightly {
  return {
    date,
    window: { start: `${date}T20:00`, end: `${date}T08:00` },
    windowSource: 'session',
    temperatureLow: 3,
    temperatureMean: 5,
    temperatureSource: 'hourly',
    humidityMean: 82,
    dewpointMean: 1,
    pressureMslMean: 1011,
    surfacePressureMean: 1009,
    pressureChange: -2,
    precipitationSum: 0,
    precipitationSource: 'hourly',
    windMean: 11,
    windMax: 18,
    cloudcoverMean: 55,
    pm25Mean: 8,
    pm25Max: 12,
    pm10Mean: 14,
    pm10Max: 20,
    ozoneMean: 60,
    nitrogenDioxideMean: 12,
    usAqiMean: 42,
    usAqiMax: 55,
    europeanAqiMean: 30,
    europeanAqiMax: 40,
    weatherHourCount: 8,
    airHourCount: 8,
    ...overrides,
  };
}

describe('WeatherPanel', () => {
  beforeEach(() => {
    nightlyState.value = { data: [], latest: null, loading: false, error: null };
    enableWeather(true);
  });

  it('renders nothing when the integration is disabled', () => {
    enableWeather(false);
    const { container } = render(<WeatherPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a loading skeleton while data loads', () => {
    nightlyState.value = { data: [], latest: null, loading: true, error: null };
    render(<WeatherPanel />);
    expect(screen.getByLabelText('Weather data loading')).toBeInTheDocument();
  });

  it('shows an error state on failure', () => {
    nightlyState.value = { data: [], latest: null, loading: false, error: 'boom' };
    render(<WeatherPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to load/i);
  });

  it('shows the unsynced CTA when enabled but no data', () => {
    render(<WeatherPanel />);
    expect(screen.getByText(/no weather data yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeInTheDocument();
  });

  it('renders tiles from the shared nightly hook with an "As of" caption when synced', () => {
    const today = new Date().toISOString().slice(0, 10);
    const latest = nightly(today);
    nightlyState.value = { data: [latest], latest, loading: false, error: null };
    render(<WeatherPanel />);

    // Accessible name preserved (asserted by the e2e too).
    expect(screen.getByLabelText('Weather and air quality overview')).toBeInTheDocument();

    expect(screen.getByText(/^As of /)).toBeInTheDocument();
    // The headline tiles are present and driven by the nightly record.
    expect(screen.getByText('Overnight Low')).toBeInTheDocument();
    expect(screen.getByText('Pressure')).toBeInTheDocument();
    expect(screen.getByText('Air Quality')).toBeInTheDocument();
    // Pressure value from the nightly record (hPa default unit).
    expect(screen.getByText('1011.0')).toBeInTheDocument();
    // Footer night count reflects the hook's data length.
    expect(screen.getByText(/1 night of weather data/i)).toBeInTheDocument();
    // Footer link to the cross-source correlations.
    expect(screen.getByRole('link', { name: /Explore correlations/i })).toBeInTheDocument();
  });
});
