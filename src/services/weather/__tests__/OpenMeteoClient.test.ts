/**
 * Unit tests for {@link OpenMeteoClient}.
 *
 * Network is fully mocked — these tests NEVER contact the real Open-Meteo API.
 * They assert the privacy- and resilience-critical behaviours:
 * - coordinate rounding is provably applied to the egress URL (≤2 dp);
 * - archive vs forecast host routing;
 * - no identifier/key/credential leaves the device;
 * - HTTP 429 → a `rate-limited` typed error;
 * - offline → an `offline` typed error (no request attempted);
 * - timeout → a `timeout` typed error;
 * - exponential backoff retries transient (5xx / network) failures.
 *
 * @module services/weather/__tests__/OpenMeteoClient.test
 */

import { describe, it, expect, vi } from 'vitest';
import { OpenMeteoClient, WeatherFetchError, type WeatherRequest } from '../OpenMeteoClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const BASE_REQUEST: WeatherRequest = {
  // Deliberately GPS-precise to prove the client coarsens before egress.
  latitude: 51.123456,
  longitude: -0.987654,
  dates: ['2026-01-10'],
  today: '2026-06-20',
  timezone: 'Europe/London',
};

/** A client whose sleep() resolves immediately so backoff does not stall tests. */
function makeClient(fetchFn: typeof fetch, isOnline = (): boolean => true): OpenMeteoClient {
  return new OpenMeteoClient(
    { baseBackoffMs: 1, maxBackoffMs: 2, maxRetries: 2, timeoutMs: 50 },
    { fetchFn, isOnline, sleep: () => Promise.resolve() },
  );
}

// ---------------------------------------------------------------------------
// Coordinate rounding (privacy contract)
// ---------------------------------------------------------------------------

describe('OpenMeteoClient — coordinate rounding', () => {
  it('rounds latitude/longitude to 2 dp in the request URL (never raw precision)', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ hourly: {} }));
    const client = makeClient(fetchFn);

    await client.fetchWeather(BASE_REQUEST);

    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.searchParams.get('latitude')).toBe('51.12');
    expect(url.searchParams.get('longitude')).toBe('-0.99');
    // The raw, GPS-precise digits must NOT appear anywhere in the URL.
    expect(url.toString()).not.toContain('51.123456');
    expect(url.toString()).not.toContain('0.987654');
  });

  it('buildWeatherUrl is the chokepoint and only emits 2-dp coordinates', () => {
    const client = makeClient(vi.fn<typeof fetch>());
    const url = new URL(
      client.buildWeatherUrl({ ...BASE_REQUEST, latitude: 12.999, longitude: 12.345 }),
    );
    expect(url.searchParams.get('latitude')).toBe('13');
    expect(url.searchParams.get('longitude')).toBe('12.35');
  });

  it('refuses non-finite coordinates rather than sending garbage', () => {
    const client = makeClient(vi.fn<typeof fetch>());
    expect(() => client.buildWeatherUrl({ ...BASE_REQUEST, latitude: NaN })).toThrow(
      WeatherFetchError,
    );
  });
});

// ---------------------------------------------------------------------------
// No identifiers leave the device
// ---------------------------------------------------------------------------

describe('OpenMeteoClient — no identifiers in requests', () => {
  it('sends no api key / token / credentials and omits credentials', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ hourly: {} }));
    const client = makeClient(fetchFn);

    await client.fetchWeather(BASE_REQUEST);

    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    for (const forbidden of ['apikey', 'api_key', 'key', 'token', 'appid', 'client_id']) {
      expect(url.searchParams.has(forbidden)).toBe(false);
    }
    const init = fetchFn.mock.calls[0]![1];
    expect(init?.credentials).toBe('omit');
  });
});

// ---------------------------------------------------------------------------
// Archive vs forecast routing
// ---------------------------------------------------------------------------

describe('OpenMeteoClient — archive/forecast routing', () => {
  it('routes old dates to the archive host', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ hourly: {} }));
    const client = makeClient(fetchFn);

    await client.fetchWeather({ ...BASE_REQUEST, dates: ['2026-01-10'], today: '2026-06-20' });

    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.host).toBe('archive-api.open-meteo.com');
    expect(url.pathname).toBe('/v1/archive');
    expect(url.searchParams.get('start_date')).toBe('2026-01-10');
  });

  it('routes recent dates (within the archive lag) to the forecast host with past_days', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ hourly: {} }));
    const client = makeClient(fetchFn);

    // today − 2 days is inside the 5-day archive lag → forecast endpoint.
    await client.fetchWeather({ ...BASE_REQUEST, dates: ['2026-06-18'], today: '2026-06-20' });

    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.host).toBe('api.open-meteo.com');
    expect(url.pathname).toBe('/v1/forecast');
    expect(url.searchParams.has('past_days')).toBe(true);
  });

  it('routes air quality to the air-quality host with explicit date range', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ hourly: {} }));
    const client = makeClient(fetchFn);

    await client.fetchAirQuality(BASE_REQUEST);

    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.host).toBe('air-quality-api.open-meteo.com');
    expect(url.pathname).toBe('/v1/air-quality');
    expect(url.searchParams.get('hourly')).toContain('us_aqi');
  });
});

// ---------------------------------------------------------------------------
// Error handling: 429, offline, timeout, backoff
// ---------------------------------------------------------------------------

describe('OpenMeteoClient — error handling', () => {
  it('maps HTTP 429 to a rate-limited error carrying Retry-After', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, 429, { 'Retry-After': '3' }));
    const client = makeClient(fetchFn);

    await expect(client.fetchWeather(BASE_REQUEST)).rejects.toMatchObject({
      reason: 'rate-limited',
      status: 429,
      retryAfterMs: 3000,
    });
  });

  it('does not attempt a request when offline (offline error)', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const client = makeClient(fetchFn, () => false);

    await expect(client.fetchWeather(BASE_REQUEST)).rejects.toMatchObject({ reason: 'offline' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps an AbortError (timeout) to a timeout error', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const client = makeClient(fetchFn);

    await expect(client.fetchWeather(BASE_REQUEST)).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('retries transient 5xx failures with backoff, then succeeds', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 502))
      .mockResolvedValueOnce(jsonResponse({ hourly: { time: [] } }));
    const client = makeClient(fetchFn);

    const result = await client.fetchWeather(BASE_REQUEST);
    expect(result).toEqual({ hourly: { time: [] } });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('surfaces a 5xx http error after exhausting retries', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 500));
    const client = makeClient(fetchFn);

    await expect(client.fetchWeather(BASE_REQUEST)).rejects.toMatchObject({
      reason: 'http',
      status: 500,
    });
    // 1 initial + 2 retries = 3 attempts.
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-429 4xx (request invalid)', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 400));
    const client = makeClient(fetchFn);

    await expect(client.fetchWeather(BASE_REQUEST)).rejects.toMatchObject({
      reason: 'http',
      status: 400,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports an unparseable body as a parse error', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('not json', { status: 200 }));
    const client = makeClient(fetchFn);

    await expect(client.fetchWeather(BASE_REQUEST)).rejects.toMatchObject({ reason: 'parse' });
  });
});
