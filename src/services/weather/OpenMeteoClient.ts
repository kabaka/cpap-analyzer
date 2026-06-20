/**
 * Typed fetch wrapper for the keyless Open-Meteo API.
 *
 * This is the SOLE network egress point of the weather integration and the
 * first outbound request the application ever makes. Every privacy and
 * resilience guarantee of the integration is enforced here:
 *
 * - **Coordinate coarsening (privacy):** every latitude/longitude is rounded to
 *   2 decimal places via {@link roundCoordinate} immediately before the request
 *   URL is constructed. GPS-precise coordinates can never leave the device. The
 *   rounding is applied in {@link buildRequestUrl}, which is the only function
 *   that writes coordinates into a URL.
 * - **No identifiers:** Open-Meteo is keyless and account-less. No API key, no
 *   token, no client id, no user agent override, no cookies — only the rounded
 *   coordinates, the calendar date(s), the requested variables, and a timezone
 *   leave the device.
 * - **Archive vs forecast routing:** historical dates (≤ today − {@link
 *   ARCHIVE_LAG_DAYS}) use the ERA5 archive host; recent dates use the forecast
 *   host with `past_days`. Decided by {@link selectWeatherEndpoint}.
 * - **Resilience:** per-request timeout (AbortController), exponential backoff
 *   retry on transient network/5xx failures, explicit HTTP-429 rate-limit
 *   handling, and offline detection. All failures surface as a typed
 *   {@link WeatherFetchError} with a discriminated {@link WeatherFetchErrorReason}.
 *
 * The client is framework-agnostic (no React, no storage). It returns the RAW
 * Open-Meteo JSON; {@link parsers} maps it to the typed records.
 *
 * @module services/weather/OpenMeteoClient
 */

import {
  ARCHIVE_LAG_DAYS,
  roundCoordinate,
  selectWeatherEndpoint,
  subtractDaysIso,
} from '@/analysis/weather/coordinates';

// ---------------------------------------------------------------------------
// Hosts and endpoints (must mirror the CSP connect-src allow-list)
// ---------------------------------------------------------------------------

/** Open-Meteo host origins. MUST match the CSP `connect-src` allow-list. */
export const OPEN_METEO_HOSTS = {
  archive: 'https://archive-api.open-meteo.com',
  forecast: 'https://api.open-meteo.com',
  airQuality: 'https://air-quality-api.open-meteo.com',
  geocoding: 'https://geocoding-api.open-meteo.com',
} as const;

/** Hourly weather variables requested (design reference §4.2). SI/metric. */
export const WEATHER_HOURLY_VARIABLES = [
  'temperature_2m',
  'relative_humidity_2m',
  'dewpoint_2m',
  'surface_pressure',
  'pressure_msl',
  'precipitation',
  'windspeed_10m',
  'cloudcover',
  'weathercode',
] as const;

/** Daily weather variables requested (design reference §4.2). SI/metric. */
export const WEATHER_DAILY_VARIABLES = [
  'temperature_2m_max',
  'temperature_2m_min',
  'temperature_2m_mean',
  'precipitation_sum',
  'windspeed_10m_max',
  'weathercode',
] as const;

/** Hourly air-quality variables requested (design reference §4.2). */
export const AIR_QUALITY_HOURLY_VARIABLES = [
  'pm2_5',
  'pm10',
  'ozone',
  'nitrogen_dioxide',
  'us_aqi',
  'european_aqi',
] as const;

// ---------------------------------------------------------------------------
// Defensive response-size ceiling (availability hardening)
// ---------------------------------------------------------------------------

/**
 * Upper bound (bytes) on a weather / air-quality response body we are willing to
 * parse. Multi-year hourly payloads are legitimately large, so this is generous;
 * its purpose is to stop a buggy or compromised (but allow-listed) host from
 * forcing an unbounded allocation in `response.json()`. 8 MiB.
 */
export const MAX_WEATHER_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * Parse a `Content-Length` header into a non-negative integer byte count, or
 * `undefined` when the header is absent or not a clean non-negative integer.
 * Side-effect-free.
 */
export function parseContentLength(header: string | null): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * Validate an IANA timezone string against the runtime's supported set and fall
 * back to `'auto'` (accepted by Open-Meteo) for anything empty or unrecognized.
 *
 * `Intl.supportedValuesOf('timeZone')` is not exposed by every runtime, so the
 * lookup is guarded; when it is unavailable we conservatively pass a non-empty
 * value through unchanged (it is already `URLSearchParams`-encoded, so there is
 * no injection risk) and only coerce empty/whitespace input to `'auto'`.
 * Side-effect-free.
 */
export function sanitizeTimezone(timezone: string): string {
  const trimmed = timezone.trim();
  if (trimmed.length === 0) return 'auto';
  if (trimmed === 'auto') return 'auto';

  let supported: readonly string[] | undefined;
  try {
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf;
    if (typeof supportedValuesOf === 'function') {
      supported = supportedValuesOf('timeZone');
    }
  } catch {
    // Runtime does not expose supportedValuesOf, or rejected the key — treat the
    // supported set as unknown and fall through to the permissive branch.
    supported = undefined;
  }

  if (supported === undefined) {
    // Cannot enumerate zones on this runtime; keep the (already-encoded) value.
    return trimmed;
  }
  return supported.includes(trimmed) ? trimmed : 'auto';
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Discriminated failure reasons for a weather fetch.
 *
 * - `offline`     — the device is offline (or a network-level error occurred and
 *                   `navigator.onLine` is false); no request reached the network.
 * - `rate-limited`— the provider returned HTTP 429; the caller should pause and
 *                   back off (see {@link WeatherFetchError.retryAfterMs}).
 * - `http`        — a non-2xx, non-429 HTTP status (after retries for 5xx).
 * - `timeout`     — the request exceeded the configured timeout and was aborted.
 * - `parse`       — the response body was not valid JSON.
 * - `too-large`   — the response advertised a `Content-Length` above
 *                   {@link MAX_WEATHER_RESPONSE_BYTES}; the body was NOT parsed.
 */
export type WeatherFetchErrorReason =
  | 'offline'
  | 'rate-limited'
  | 'http'
  | 'timeout'
  | 'parse'
  | 'too-large';

/** A typed, discriminated error for every weather network failure mode. */
export class WeatherFetchError extends Error {
  readonly reason: WeatherFetchErrorReason;
  /** HTTP status code, when the failure carried one (`http` / `rate-limited`). */
  readonly status?: number;
  /**
   * Suggested backoff before retrying, milliseconds. Populated for
   * `rate-limited` (from `Retry-After` when present), otherwise undefined.
   */
  readonly retryAfterMs?: number;

  constructor(
    reason: WeatherFetchErrorReason,
    message: string,
    options: { status?: number; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'WeatherFetchError';
    this.reason = reason;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Request shapes
// ---------------------------------------------------------------------------

/**
 * Parameters for a weather fetch covering one or more local calendar dates.
 *
 * `dates` are `YYYY-MM-DD` local dates (a midnight-spanning night supplies BOTH
 * civil dates). The client picks the archive vs forecast host from the EARLIEST
 * date so a span straddling the archive cutover still resolves to one endpoint;
 * the caller is responsible for splitting spans that cross the cutover if it
 * needs the freshest possible data for the recent side.
 */
export interface WeatherRequest {
  readonly latitude: number;
  readonly longitude: number;
  /** Local calendar dates to fetch, `YYYY-MM-DD`, ascending. */
  readonly dates: readonly string[];
  /** Reference "today" in the same calendar frame, `YYYY-MM-DD`. */
  readonly today: string;
  /** IANA timezone, or `'auto'`. Sent as the `timezone` query param. */
  readonly timezone: string;
}

/** Result of a successful weather fetch: the raw Open-Meteo JSON payload. */
export interface OpenMeteoWeatherResponse {
  readonly latitude?: number;
  readonly longitude?: number;
  readonly timezone?: string;
  readonly hourly?: Record<string, ReadonlyArray<number | null> | readonly string[]>;
  readonly daily?: Record<string, ReadonlyArray<number | null> | readonly string[]>;
  readonly [key: string]: unknown;
}

/** Result of a successful air-quality fetch: the raw Open-Meteo JSON payload. */
export interface OpenMeteoAirQualityResponse {
  readonly latitude?: number;
  readonly longitude?: number;
  readonly timezone?: string;
  readonly hourly?: Record<string, ReadonlyArray<number | null> | readonly string[]>;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

/** Tunable client behaviour (timeout, retries, backoff). */
export interface OpenMeteoClientConfig {
  /** Per-request timeout in ms before the request is aborted. @default 15000 */
  readonly timeoutMs: number;
  /** Maximum retry attempts for transient (network/5xx) failures. @default 3 */
  readonly maxRetries: number;
  /** Base backoff delay in ms (doubled each attempt). @default 500 */
  readonly baseBackoffMs: number;
  /** Upper bound on a single backoff delay in ms. @default 8000 */
  readonly maxBackoffMs: number;
}

const DEFAULT_CONFIG: OpenMeteoClientConfig = {
  timeoutMs: 15_000,
  maxRetries: 3,
  baseBackoffMs: 500,
  maxBackoffMs: 8_000,
};

/** Injectable dependencies (for testability — no globals reached directly). */
export interface OpenMeteoClientDeps {
  /** Fetch implementation. @default globalThis.fetch */
  readonly fetchFn?: typeof fetch;
  /** Returns whether the device is currently online. @default navigator.onLine */
  readonly isOnline?: () => boolean;
  /** Sleep helper (ms). Injectable so tests need not wait real time. */
  readonly sleep?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OpenMeteoClient {
  private readonly config: OpenMeteoClientConfig;
  private readonly fetchFn: typeof fetch;
  private readonly isOnline: () => boolean;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: Partial<OpenMeteoClientConfig> = {}, deps: OpenMeteoClientDeps = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.isOnline =
      deps.isOnline ??
      (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    this.sleep =
      deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Fetch core weather (hourly + daily) for the request's dates.
   *
   * Routes to the archive or forecast host based on the earliest requested
   * date. Coordinates are rounded to 2 dp inside {@link buildRequestUrl}.
   */
  async fetchWeather(request: WeatherRequest): Promise<OpenMeteoWeatherResponse> {
    const url = this.buildWeatherUrl(request);
    return this.fetchJson<OpenMeteoWeatherResponse>(url);
  }

  /**
   * Fetch hourly air quality for the request's dates.
   *
   * The air-quality host serves both recent and historical (CAMS reanalysis)
   * data from a single endpoint via `start_date`/`end_date`.
   */
  async fetchAirQuality(request: WeatherRequest): Promise<OpenMeteoAirQualityResponse> {
    const url = this.buildAirQualityUrl(request);
    return this.fetchJson<OpenMeteoAirQualityResponse>(url);
  }

  // -----------------------------------------------------------------------
  // URL construction (the ONLY place coordinates enter a request)
  // -----------------------------------------------------------------------

  /**
   * Build the core-weather request URL, rounding coordinates to 2 dp and
   * selecting the archive vs forecast host/endpoint.
   *
   * Exposed (not private) so tests can assert that the egress URL never carries
   * more than 2 decimal places of coordinate precision.
   */
  buildWeatherUrl(request: WeatherRequest): string {
    const { dates } = request;
    if (dates.length === 0) {
      throw new WeatherFetchError('http', 'No dates supplied for weather request');
    }
    const sorted = [...dates].sort();
    const start = sorted[0] as string;
    const end = sorted[sorted.length - 1] as string;
    const route = selectWeatherEndpoint(start, request.today);

    if (route === 'archive') {
      const base = `${OPEN_METEO_HOSTS.archive}/v1/archive`;
      return this.buildRequestUrl(base, request, {
        start_date: start,
        end_date: end,
        hourly: WEATHER_HOURLY_VARIABLES.join(','),
        daily: WEATHER_DAILY_VARIABLES.join(','),
      });
    }

    // Forecast host with past_days covering the requested span.
    const base = `${OPEN_METEO_HOSTS.forecast}/v1/forecast`;
    const pastDays = this.computePastDays(start, request.today);
    return this.buildRequestUrl(base, request, {
      past_days: String(pastDays),
      forecast_days: '1',
      hourly: WEATHER_HOURLY_VARIABLES.join(','),
      daily: WEATHER_DAILY_VARIABLES.join(','),
    });
  }

  /**
   * Build the air-quality request URL. The AQ endpoint accepts explicit
   * `start_date`/`end_date` for both recent and historical ranges.
   */
  buildAirQualityUrl(request: WeatherRequest): string {
    const { dates } = request;
    if (dates.length === 0) {
      throw new WeatherFetchError('http', 'No dates supplied for air-quality request');
    }
    const sorted = [...dates].sort();
    const start = sorted[0] as string;
    const end = sorted[sorted.length - 1] as string;
    const base = `${OPEN_METEO_HOSTS.airQuality}/v1/air-quality`;
    return this.buildRequestUrl(base, request, {
      start_date: start,
      end_date: end,
      hourly: AIR_QUALITY_HOURLY_VARIABLES.join(','),
    });
  }

  /**
   * Assemble a request URL with the coordinates ROUNDED to 2 dp.
   *
   * This is the single chokepoint where latitude/longitude are written into a
   * URL; {@link roundCoordinate} is applied here so no caller can bypass the
   * privacy coarsening. The rounded numbers are stringified by `URLSearchParams`
   * (`String(number)`), which never re-introduces extra precision.
   */
  private buildRequestUrl(
    base: string,
    request: WeatherRequest,
    extra: Record<string, string>,
  ): string {
    const lat = roundCoordinate(request.latitude);
    const lon = roundCoordinate(request.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new WeatherFetchError(
        'http',
        `Refusing to request weather for non-finite coordinates (${String(request.latitude)}, ${String(request.longitude)})`,
      );
    }

    const params = new URLSearchParams();
    // Rounded coordinates ONLY — never the raw inputs.
    params.set('latitude', String(lat));
    params.set('longitude', String(lon));
    // Validate the timezone at the egress boundary, falling back to 'auto'
    // (which Open-Meteo accepts) for anything not a recognized IANA name.
    params.set('timezone', sanitizeTimezone(request.timezone));
    for (const [key, value] of Object.entries(extra)) {
      params.set(key, value);
    }
    return `${base}?${params.toString()}`;
  }

  /**
   * Number of `past_days` the forecast endpoint must look back to include the
   * earliest requested date, clamped to Open-Meteo's 92-day maximum. We use the
   * shared {@link ARCHIVE_LAG_DAYS} window logic via {@link subtractDaysIso} so
   * the boundary stays in one place.
   */
  private computePastDays(earliestDate: string, today: string): number {
    // Walk back day by day from today until we reach (or pass) earliestDate.
    // Bounded by the provider's documented past_days max (92) and the archive
    // lag window (recent dates are only ever a handful of days back).
    const MAX_PAST_DAYS = 92;
    for (let d = 0; d <= MAX_PAST_DAYS; d++) {
      if (subtractDaysIso(today, d) <= earliestDate) {
        // Add a small safety margin (1 day) so the window fully covers the date,
        // then re-clamp. Forecast `past_days` is inclusive of the day count.
        return Math.min(d + 1, MAX_PAST_DAYS);
      }
    }
    // Earliest date is older than the forecast window can reach; this should
    // have routed to the archive. Clamp defensively.
    return Math.min(ARCHIVE_LAG_DAYS + 2, MAX_PAST_DAYS);
  }

  // -----------------------------------------------------------------------
  // Networking with timeout, retry/backoff, 429 + offline handling
  // -----------------------------------------------------------------------

  /**
   * Fetch a URL and parse JSON, applying timeout, exponential-backoff retry
   * (transient network errors and 5xx), explicit 429 handling, and offline
   * detection. All failures surface as {@link WeatherFetchError}.
   */
  private async fetchJson<T>(url: string): Promise<T> {
    // Offline short-circuit: do not even attempt a request when offline.
    if (!this.isOnline()) {
      throw new WeatherFetchError('offline', 'Device is offline; weather request not attempted');
    }

    let lastError: WeatherFetchError | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.attemptFetch<T>(url);
      } catch (err) {
        const fetchError = err instanceof WeatherFetchError ? err : this.classifyError(err);

        // Non-retryable reasons surface immediately. A retry would just re-pull
        // the same oversize / unparseable body, so `too-large` joins them.
        if (
          fetchError.reason === 'offline' ||
          fetchError.reason === 'parse' ||
          fetchError.reason === 'too-large'
        ) {
          throw fetchError;
        }
        // 4xx other than 429 are not retryable (request is malformed/invalid).
        if (
          fetchError.reason === 'http' &&
          fetchError.status !== undefined &&
          fetchError.status >= 400 &&
          fetchError.status < 500
        ) {
          throw fetchError;
        }

        lastError = fetchError;

        // Out of attempts -> surface the last error.
        if (attempt === this.config.maxRetries) break;

        // Re-check connectivity before sleeping so an offline drop is reported
        // as offline rather than as a generic transient failure.
        if (!this.isOnline()) {
          throw new WeatherFetchError('offline', 'Device went offline during weather request', {
            cause: fetchError,
          });
        }

        await this.sleep(this.backoffDelay(attempt, fetchError));
      }
    }

    throw lastError ?? new WeatherFetchError('http', 'Weather request failed after retries');
  }

  /** Perform a single fetch attempt with an abort-on-timeout guard. */
  private async attemptFetch<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'GET',
        signal: controller.signal,
        // No credentials, no custom headers, no identifiers.
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
    } catch (err) {
      clearTimeout(timer);
      throw this.classifyError(err);
    }
    clearTimeout(timer);

    if (response.status === 429) {
      throw new WeatherFetchError('rate-limited', 'Open-Meteo rate limit reached (HTTP 429)', {
        status: 429,
        retryAfterMs: this.parseRetryAfter(response.headers.get('Retry-After')),
      });
    }

    if (!response.ok) {
      throw new WeatherFetchError(
        'http',
        `Open-Meteo request failed (HTTP ${String(response.status)})`,
        {
          status: response.status,
        },
      );
    }

    // Availability hardening: reject an over-large body BEFORE buffering it into
    // memory via response.json(). We trust the advertised Content-Length only as
    // a cheap pre-check. NOTE: a (buggy/compromised) host that omits or lies
    // about Content-Length can still stream a large body — we do not stream-count
    // here to avoid over-engineering; that residual gap is accepted for a keyless
    // GET against an allow-listed origin.
    const advertised = parseContentLength(response.headers.get('Content-Length'));
    if (advertised !== undefined && advertised > MAX_WEATHER_RESPONSE_BYTES) {
      throw new WeatherFetchError(
        'too-large',
        `Open-Meteo response too large (${String(advertised)} bytes > ${String(MAX_WEATHER_RESPONSE_BYTES)} limit)`,
        { status: response.status },
      );
    }

    try {
      return (await response.json()) as T;
    } catch (err) {
      throw new WeatherFetchError('parse', 'Failed to parse Open-Meteo JSON response', {
        cause: err,
      });
    }
  }

  /** Map a thrown fetch error onto a typed reason (timeout vs offline vs http). */
  private classifyError(err: unknown): WeatherFetchError {
    // AbortController abort -> timeout.
    if (err instanceof DOMException && err.name === 'AbortError') {
      return new WeatherFetchError('timeout', 'Open-Meteo request timed out', { cause: err });
    }
    if (err instanceof Error && err.name === 'AbortError') {
      return new WeatherFetchError('timeout', 'Open-Meteo request timed out', { cause: err });
    }
    // A network-level TypeError while offline -> offline; otherwise treat as a
    // transient HTTP-class failure that backoff can retry.
    if (!this.isOnline()) {
      return new WeatherFetchError('offline', 'Network request failed while offline', {
        cause: err,
      });
    }
    return new WeatherFetchError('http', 'Network error contacting Open-Meteo', { cause: err });
  }

  /**
   * Compute the backoff delay for a given attempt. For rate-limit errors, honour
   * the server's `Retry-After` when it is longer than the computed backoff.
   */
  private backoffDelay(attempt: number, error: WeatherFetchError): number {
    const exp = this.config.baseBackoffMs * 2 ** attempt;
    const capped = Math.min(exp, this.config.maxBackoffMs);
    if (error.reason === 'rate-limited' && error.retryAfterMs !== undefined) {
      return Math.max(capped, error.retryAfterMs);
    }
    return capped;
  }

  /** Parse an HTTP `Retry-After` header (seconds, or an HTTP date) into ms. */
  private parseRetryAfter(header: string | null): number | undefined {
    if (!header) return undefined;
    const seconds = Number.parseInt(header, 10);
    if (Number.isFinite(seconds) && String(seconds) === header.trim()) {
      return seconds * 1000;
    }
    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) {
      const delta = dateMs - Date.now();
      return delta > 0 ? delta : 0;
    }
    return undefined;
  }
}
