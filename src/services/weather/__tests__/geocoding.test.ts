import { describe, it, expect, vi } from 'vitest';
import { geocode, MAX_GEOCODE_RESPONSE_BYTES } from '../geocoding';

function jsonResponse(
  body: unknown,
  ok = true,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const headerMap = new Headers(headers);
  return {
    ok,
    status,
    headers: headerMap,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('geocode', () => {
  it('returns 2-dp-rounded coordinates and a composed label', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            name: 'Berlin',
            admin1: 'Berlin',
            country: 'Germany',
            latitude: 52.524,
            longitude: 13.41,
          },
        ],
      }),
    );
    const results = await geocode('Berlin', 5, { fetchFn });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      label: 'Berlin, Berlin, Germany',
      latitude: 52.52,
      longitude: 13.41,
    });
  });

  it('sends NO identifiers (credentials omit, no-referrer) and only the typed query', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    await geocode('Paris', 5, { fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('geocoding-api.open-meteo.com');
    expect(url).toContain('name=Paris');
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.cache).toBe('no-store');
    // No auth/key params.
    expect(url).not.toMatch(/apikey|api_key|token/i);
  });

  it('returns [] for a blank query without hitting the network', async () => {
    const fetchFn = vi.fn();
    expect(await geocode('   ', 5, { fetchFn })).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws a user-facing error on HTTP failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    await expect(geocode('X', 5, { fetchFn })).rejects.toThrow(/HTTP 503/);
  });

  it('rejects an oversize Content-Length without parsing the body', async () => {
    let parsed = false;
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Length': String(MAX_GEOCODE_RESPONSE_BYTES + 1) }),
      json: () => {
        parsed = true;
        return Promise.resolve({ results: [] });
      },
    } as unknown as Response;
    const fetchFn = vi.fn().mockResolvedValue(response);

    await expect(geocode('Berlin', 5, { fetchFn })).rejects.toThrow(/large/i);
    expect(parsed).toBe(false);
  });

  it('parses normally when Content-Length is within the ceiling', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ results: [] }, true, 200, { 'Content-Length': String(1024) }),
      );
    expect(await geocode('Berlin', 5, { fetchFn })).toEqual([]);
  });

  it('parses normally when Content-Length is absent', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    expect(await geocode('Berlin', 5, { fetchFn })).toEqual([]);
  });
});
