import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@test/test-utils';
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { WeatherTimeseriesResult, WeatherDailyResult } from '@/hooks/useWeatherData';

// Mockable hook returns.
const timeseriesState: { value: WeatherTimeseriesResult } = {
  value: { data: [], loading: false, error: null },
};
const dailyState: { value: WeatherDailyResult } = {
  value: {
    weatherDaily: [],
    airQualityDaily: [],
    availability: { weatherDaily: 0, airQualityDaily: 0, total: 0 },
    loading: false,
    error: null,
  },
};

vi.mock('@/hooks/useWeatherData', () => ({
  useWeatherTimeseries: () => timeseriesState.value,
  useWeatherDailySummaries: () => dailyState.value,
}));

import WeatherOverview from './WeatherOverview';

function enableWeather(enabled: boolean) {
  useSettingsStore.getState().updateIntegration('weather', { enabled });
}

/** Build an hourly weather record whose samples fall in the overnight window. */
function hourlyRecord(date: string) {
  const prev = new Date(`${date}T00:00:00`);
  prev.setDate(prev.getDate() - 1);
  const prevDate = prev.toISOString().slice(0, 10);
  return {
    id: `w-${date}`,
    source: 'weather' as const,
    dataType: 'weather_hourly',
    date,
    importedAt: '2026-01-01T00:00:00Z',
    data: {
      location: null,
      samples: [
        {
          time: `${prevDate}T23:00`,
          temperature2m: 5,
          relativeHumidity2m: 80,
          dewpoint2m: 2,
          surfacePressure: 1010,
          pressureMsl: 1012,
          precipitation: 0,
          windspeed10m: 10,
          cloudcover: 50,
          weathercode: 1,
        },
        {
          time: `${date}T05:00`,
          temperature2m: 3,
          relativeHumidity2m: 85,
          dewpoint2m: 1,
          surfacePressure: 1009,
          pressureMsl: 1011,
          precipitation: 0,
          windspeed10m: 12,
          cloudcover: 60,
          weathercode: 2,
        },
      ],
    },
  };
}

describe('WeatherOverview', () => {
  beforeEach(() => {
    timeseriesState.value = { data: [], loading: false, error: null };
    dailyState.value = {
      weatherDaily: [],
      airQualityDaily: [],
      availability: { weatherDaily: 0, airQualityDaily: 0, total: 0 },
      loading: false,
      error: null,
    };
    enableWeather(true);
  });

  it('renders nothing when the integration is disabled', () => {
    enableWeather(false);
    const { container } = render(<WeatherOverview />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a loading skeleton while data loads', () => {
    timeseriesState.value = { data: [], loading: true, error: null };
    render(<WeatherOverview />);
    expect(screen.getByLabelText('Weather data loading')).toBeInTheDocument();
  });

  it('shows an error state on failure', () => {
    timeseriesState.value = { data: [], loading: false, error: 'boom' };
    render(<WeatherOverview />);
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to load/i);
  });

  it('shows the unsynced CTA when enabled but no data', () => {
    render(<WeatherOverview />);
    expect(screen.getByText(/no weather data yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeInTheDocument();
  });

  it('renders tiles with an "As of" caption when synced', () => {
    const today = new Date().toISOString().slice(0, 10);
    timeseriesState.value = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: [hourlyRecord(today)] as any,
      loading: false,
      error: null,
    };
    render(<WeatherOverview />);

    expect(screen.getByText(/^As of /)).toBeInTheDocument();
    // The overnight low temperature tile is present.
    expect(screen.getByText('Overnight Low')).toBeInTheDocument();
    expect(screen.getByText('Pressure')).toBeInTheDocument();
    expect(screen.getByText('Air Quality')).toBeInTheDocument();
    // Footer link to the cross-source correlations.
    expect(screen.getByRole('link', { name: /Explore correlations/i })).toBeInTheDocument();
  });
});
