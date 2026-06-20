/**
 * Open-Meteo geocoding helper (city search / labelling).
 *
 * This is a SECONDARY egress point of the weather integration, used ONLY on an
 * explicit user action: pressing "Find" after typing a city name. It is
 * disclosed in the consent dialog as an extra network call (the user opted into
 * sending a typed city string when they choose to search by name).
 *
 * It follows the SAME no-identifier discipline as {@link OpenMeteoClient}:
 * `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `cache: 'no-store'`,
 * no API key, no custom headers. The only thing that leaves the device is the
 * typed query string (plus a result count / language). Coordinates returned by
 * a successful search are ROUNDED to 2 dp via {@link roundCoordinate} before
 * they are handed back, so the canonical stored location is already coarsened —
 * the privacy contract holds even for city-searched locations.
 *
 * Host: `https://geocoding-api.open-meteo.com` — already in the CSP
 * `connect-src` allow-list.
 *
 * @module services/weather/geocoding
 */

import { roundCoordinate } from '@/analysis/weather/coordinates';
import { OPEN_METEO_HOSTS, parseContentLength } from './OpenMeteoClient';

/**
 * Upper bound (bytes) on a geocoding response body we will parse. A city search
 * returns at most ~10 compact matches, so this is small; its purpose is to stop
 * a buggy or compromised (but allow-listed) host from forcing an unbounded
 * allocation in `response.json()`. 1 MiB.
 */
export const MAX_GEOCODE_RESPONSE_BYTES = 1 * 1024 * 1024;

/** One geocoding match (rounded coordinates; a human-readable label). */
export interface GeocodeResult {
  /** Display label, e.g. "Berlin, Germany". */
  readonly label: string;
  /** Latitude, decimal degrees, rounded to 2 dp. */
  readonly latitude: number;
  /** Longitude, decimal degrees, rounded to 2 dp. */
  readonly longitude: number;
}

/** Raw Open-Meteo geocoding response item (only the fields we use). */
interface RawGeocodeItem {
  readonly name?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly admin1?: string;
  readonly country?: string;
}

interface RawGeocodeResponse {
  readonly results?: readonly RawGeocodeItem[];
}

/** Injectable fetch (for tests). Defaults to the global `fetch`. */
export interface GeocodeDeps {
  readonly fetchFn?: typeof fetch;
  /** Per-request timeout (ms). @default 10000 */
  readonly timeoutMs?: number;
}

/** Build a human label from a result item, omitting empty parts. */
function buildLabel(item: RawGeocodeItem): string {
  return [item.name, item.admin1, item.country].filter((p): p is string => Boolean(p)).join(', ');
}

/**
 * Forward-geocode a city name to up to `count` matches.
 *
 * @param query - The typed city string (this is what leaves the device).
 * @param count - Max results to request (1–10). @default 5
 * @returns Matches with 2-dp-rounded coordinates, best match first. Empty array
 *          when the query is blank or no match is found.
 * @throws Error with a user-facing message on network/HTTP/parse failure.
 */
export async function geocode(
  query: string,
  count = 5,
  deps: GeocodeDeps = {},
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = deps.timeoutMs ?? 10_000;

  const params = new URLSearchParams({
    name: trimmed,
    count: String(Math.min(Math.max(count, 1), 10)),
    language: 'en',
    format: 'json',
  });
  const url = `${OPEN_METEO_HOSTS.geocoding}/v1/search?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'GET',
      signal: controller.signal,
      // No identifiers — same discipline as the weather client.
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('City search timed out. Check your connection and try again.');
    }
    throw new Error('Could not reach the location search service.');
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new Error(`Location search failed (HTTP ${String(response.status)}).`);
  }

  // Availability hardening: reject an over-large body BEFORE buffering it into
  // memory via response.json(). We trust the advertised Content-Length only as a
  // cheap pre-check. NOTE: a host that omits or lies about Content-Length can
  // still stream a large body — we do not stream-count here to avoid
  // over-engineering; that residual gap is accepted for a keyless GET against an
  // allow-listed origin.
  const advertised = parseContentLength(response.headers.get('Content-Length'));
  if (advertised !== undefined && advertised > MAX_GEOCODE_RESPONSE_BYTES) {
    throw new Error('Location search returned an unexpectedly large response.');
  }

  let body: RawGeocodeResponse;
  try {
    body = (await response.json()) as RawGeocodeResponse;
  } catch {
    throw new Error('Location search returned an unreadable response.');
  }

  const results = body.results ?? [];
  return results
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map((r) => ({
      label: buildLabel(r),
      latitude: roundCoordinate(r.latitude as number),
      longitude: roundCoordinate(r.longitude as number),
    }));
}
