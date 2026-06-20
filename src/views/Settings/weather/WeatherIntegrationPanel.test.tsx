import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@test/test-utils';
import { useSettingsStore } from '@/stores/useSettingsStore';

// Avoid IndexedDB/session dependencies in this UI-focused test.
vi.mock('@/hooks/useSessionData', () => ({
  useSessionData: () => ({ sessions: [], loading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/services/weather/weatherDataService', () => ({
  countWeatherNights: vi.fn().mockResolvedValue(0),
  deleteAllWeatherData: vi.fn().mockResolvedValue({ dailyRemoved: 0, timeseriesRemaining: 0 }),
}));

import { WeatherIntegrationPanel } from './WeatherIntegrationPanel';

/** Reset the weather integration slice to defaults (disabled) before each test. */
function resetWeather() {
  useSettingsStore.getState().updateIntegration('weather', {
    enabled: false,
    consentAt: null,
    location: { label: null, latitude: null, longitude: null },
  });
}

describe('WeatherIntegrationPanel', () => {
  beforeEach(() => {
    resetWeather();
  });

  it('two-gate consent: enabling opens the dialog and does NOT enable until confirmed', () => {
    render(<WeatherIntegrationPanel />);
    // Gate 1: flip the toggle.
    fireEvent.click(screen.getByRole('switch'));

    // Gate 2: the consent dialog appears (its Enable button + ack checkbox);
    // settings are still disabled until confirmed.
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(useSettingsStore.getState().integrations.weather.enabled).toBe(false);
  });

  it('cancelling consent reverts (stays disabled, no consentAt persisted)', () => {
    render(<WeatherIntegrationPanel />);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    const weather = useSettingsStore.getState().integrations.weather;
    expect(weather.enabled).toBe(false);
    expect(weather.consentAt).toBeNull();
  });

  it('acknowledging + Enable persists enabled and consentAt', () => {
    render(<WeatherIntegrationPanel />);
    fireEvent.click(screen.getByRole('switch'));

    // Acknowledge then Enable.
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));

    const weather = useSettingsStore.getState().integrations.weather;
    expect(weather.enabled).toBe(true);
    expect(weather.consentAt).not.toBeNull();
  });

  it('geolocation denial shows a role=alert and moves focus to the latitude input', async () => {
    // Stub a denying geolocation in a secure context.
    const getCurrentPosition = vi.fn(
      (_success: PositionCallback, error?: PositionErrorCallback) => {
        error?.({ code: 1, message: 'denied' } as GeolocationPositionError);
      },
    );
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

    // Enable the integration first so the config panel renders.
    useSettingsStore.getState().updateIntegration('weather', { enabled: true });
    render(<WeatherIntegrationPanel />);

    fireEvent.click(screen.getByRole('button', { name: /use current location/i }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/permission was denied/i)).toBeTruthy();

    await waitFor(() => {
      const lat = screen.getByLabelText('Latitude');
      expect(document.activeElement).toBe(lat);
    });
  });

  it('on disable, prompts to keep or delete stored data (Keep is the default)', async () => {
    useSettingsStore.getState().updateIntegration('weather', { enabled: true });
    render(<WeatherIntegrationPanel />);

    // Toggle off.
    fireEvent.click(screen.getByRole('switch'));

    // Disabled immediately; prompt appears.
    expect(useSettingsStore.getState().integrations.weather.enabled).toBe(false);
    await screen.findByText('Weather integration disabled');
  });
});
