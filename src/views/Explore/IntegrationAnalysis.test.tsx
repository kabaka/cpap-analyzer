/**
 * Cross-Source Analysis weather-correlation unit tests.
 *
 * Covers the weather extensions to the cross-source view:
 * - weather metric availability filtering (appears when synced, absent when not);
 * - the grouped "Compare against" options (Wearable / Weather & Environment);
 * - a weather × CPAP correlation computing through the EXISTING analysis math;
 * - the "{k} weather days" availability banner stat.
 *
 * The pure helpers are exercised directly; the banner is exercised through a
 * render with both data hooks mocked (never hits IndexedDB or the network).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@test/test-utils';
import { computeCorrelation } from '@/analysis/crossSource';
import type { WeatherNightly } from '@/analysis/weather';
import type { NightlyAggregate } from '@/types/session';
import type { JoinedWeatherRecord } from '@/hooks/useCorrelationData';

import IntegrationAnalysis from './IntegrationAnalysis';
import {
  WEATHER_METRICS,
  filterAvailableWeatherMetrics,
  buildComparisonMetrics,
  comparisonGroups,
  extractWeatherFromJoined,
} from './integrationMetrics';

// ---------------------------------------------------------------------------
// Hoisted mock state (referenced inside hoisted vi.mock factories)
// ---------------------------------------------------------------------------

const { summaryState, correlationState } = vi.hoisted(() => ({
  summaryState: {
    value: {
      summary: { hasData: true, availableDataTypes: [], overlapDateRange: null } as unknown,
      loading: false,
      error: null,
    },
  },
  correlationState: {
    value: {
      data: [] as unknown[],
      weatherData: [] as JoinedWeatherRecord[],
      loading: false,
      error: null,
      cpapDays: 0,
      wearableDays: 0,
      overlapDays: 0,
      weatherDays: 0,
    },
  },
}));

vi.mock('@/hooks/useWearableSummary', () => ({
  useWearableSummary: () => summaryState.value,
}));
vi.mock('@/hooks/useCorrelationData', () => ({
  useCorrelationData: () => correlationState.value,
}));
vi.mock('@/components/domain/DateRangeSelector', () => ({
  DateRangeSelector: () => null,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal CPAP nightly aggregate for correlation tests. Only the fields the
 * extractors read are meaningful; the rest are filled with finite placeholders.
 * Cast is justified: building the full ~40-field record is unnecessary noise and
 * the view only reads the metric accessors under test.
 */
function cpap(date: string, ahi: number): NightlyAggregate {
  return {
    date,
    ahi,
    ahiObstructive: ahi * 0.6,
    ahiCentral: ahi * 0.2,
    ahiHypopnea: ahi * 0.2,
    pressureMean: 9,
    pressureP95: 11,
    leakMedian: 5,
    leakP95: 15,
    usageHours: 7,
  } as unknown as NightlyAggregate;
}

function nightly(date: string, overrides: Partial<WeatherNightly> = {}): WeatherNightly {
  return {
    date,
    window: { start: `${date}T20:00`, end: `${date}T08:00` },
    windowSource: 'session',
    temperatureLow: 3,
    temperatureMean: 5,
    temperatureSource: 'hourly',
    humidityMean: 80,
    dewpointMean: 1,
    pressureMslMean: 1010,
    surfacePressureMean: 1008,
    pressureChange: -1,
    precipitationSum: 0,
    precipitationSource: 'hourly',
    windMean: 10,
    windMax: 16,
    cloudcoverMean: 50,
    pm25Mean: 8,
    pm25Max: 12,
    pm10Mean: 14,
    pm10Max: 20,
    ozoneMean: 60,
    nitrogenDioxideMean: 12,
    usAqiMean: 40,
    usAqiMax: 55,
    europeanAqiMean: 28,
    europeanAqiMax: 38,
    weatherHourCount: 8,
    airHourCount: 8,
    ...overrides,
  };
}

function weatherRecord(
  date: string,
  ahi: number,
  weatherOverrides: Partial<WeatherNightly> = {},
): JoinedWeatherRecord {
  return { date, cpap: cpap(date, ahi), weather: nightly(date, weatherOverrides) };
}

// ---------------------------------------------------------------------------
// Availability filtering
// ---------------------------------------------------------------------------

describe('filterAvailableWeatherMetrics', () => {
  it('returns no metrics when there is no synced weather data', () => {
    expect(filterAvailableWeatherMetrics([])).toEqual([]);
  });

  it('includes a metric only when at least one finite value exists', () => {
    // Air quality fully null → AQI/PM/O3/NO2 metrics must be absent, but the
    // core meteorological metrics (which have values) must be present.
    const data: JoinedWeatherRecord[] = [
      weatherRecord('2026-01-01', 5, {
        usAqiMean: null,
        europeanAqiMean: null,
        pm25Mean: null,
        pm10Mean: null,
        ozoneMean: null,
        nitrogenDioxideMean: null,
      }),
    ];
    const keys = filterAvailableWeatherMetrics(data).map((m) => m.key);
    expect(keys).toContain('pressureMslMean');
    expect(keys).toContain('humidityMean');
    expect(keys).not.toContain('usAqiMean');
    expect(keys).not.toContain('pm25Mean');
  });

  it('headlines barometric pressure as the first metric', () => {
    expect(WEATHER_METRICS[0]?.key).toBe('pressureMslMean');
    expect(WEATHER_METRICS[0]?.label).toBe('Barometric Pressure');
  });
});

// ---------------------------------------------------------------------------
// Grouped "Compare against" selector
// ---------------------------------------------------------------------------

describe('buildComparisonMetrics / comparisonGroups', () => {
  it('places weather metrics under a "Weather & Environment" optgroup when available', () => {
    const data: JoinedWeatherRecord[] = [
      weatherRecord('2026-01-01', 5),
      weatherRecord('2026-01-02', 6),
      weatherRecord('2026-01-03', 7),
    ];
    const weatherMetrics = filterAvailableWeatherMetrics(data);
    const metrics = buildComparisonMetrics([], weatherMetrics);
    const groups = comparisonGroups(metrics);

    const weatherGroup = groups.find((g) => g.label === 'Weather & Environment');
    expect(weatherGroup).toBeDefined();
    expect(weatherGroup?.options.some((o) => o.label === 'Barometric Pressure')).toBe(true);
    // No wearable metrics → no Wearable optgroup.
    expect(groups.find((g) => g.label === 'Wearable')).toBeUndefined();
  });

  it('omits the weather optgroup entirely when weather is not synced', () => {
    const metrics = buildComparisonMetrics([], filterAvailableWeatherMetrics([]));
    const groups = comparisonGroups(metrics);
    expect(groups.find((g) => g.label === 'Weather & Environment')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Weather × CPAP correlation via the existing math
// ---------------------------------------------------------------------------

describe('weather × CPAP correlation', () => {
  it('computes a correlation from a weather metric series via computeCorrelation', () => {
    // Pressure falling as AHI rises → expect a negative correlation.
    const data: JoinedWeatherRecord[] = [
      weatherRecord('2026-01-01', 2, { pressureMslMean: 1020 }),
      weatherRecord('2026-01-02', 4, { pressureMslMean: 1015 }),
      weatherRecord('2026-01-03', 6, { pressureMslMean: 1010 }),
      weatherRecord('2026-01-04', 8, { pressureMslMean: 1005 }),
      weatherRecord('2026-01-05', 10, { pressureMslMean: 1000 }),
    ];
    const pressure = WEATHER_METRICS.find((m) => m.key === 'pressureMslMean')!;
    const series = extractWeatherFromJoined(data, pressure);
    expect(series).toHaveLength(5);

    const x = data.map((d) => d.cpap.ahi as number);
    const y = series.map((s) => s.value);
    const result = computeCorrelation({
      x,
      y,
      dates: data.map((d) => d.date),
      method: 'pearson',
    });

    expect(result.n).toBe(5);
    expect(result.direction).toBe('negative');
    expect(result.r).toBeLessThan(0);
  });

  it('drops nights with a null reading pairwise (never a fabricated 0)', () => {
    const data: JoinedWeatherRecord[] = [
      weatherRecord('2026-01-01', 5, { humidityMean: 70 }),
      weatherRecord('2026-01-02', 6, { humidityMean: null }),
      weatherRecord('2026-01-03', 7, { humidityMean: 90 }),
    ];
    const humidity = WEATHER_METRICS.find((m) => m.key === 'humidityMean')!;
    const series = extractWeatherFromJoined(data, humidity);
    expect(series.map((s) => s.date)).toEqual(['2026-01-01', '2026-01-03']);
  });
});

// ---------------------------------------------------------------------------
// Availability banner — weather days stat (render-level)
// ---------------------------------------------------------------------------

describe('IntegrationAnalysis availability banner', () => {
  beforeEach(() => {
    correlationState.value = {
      data: [],
      weatherData: [],
      loading: false,
      error: null,
      cpapDays: 0,
      wearableDays: 0,
      overlapDays: 0,
      weatherDays: 0,
    };
  });

  it('shows a "{k} weather days" stat in the data-availability banner', () => {
    correlationState.value = {
      ...correlationState.value,
      weatherData: [weatherRecord('2026-01-01', 5), weatherRecord('2026-01-02', 6)],
      cpapDays: 2,
      weatherDays: 2,
    };
    render(<IntegrationAnalysis />);

    const banner = screen.getByLabelText('Data availability');
    expect(banner).toHaveTextContent('weather days');
    expect(banner).toHaveTextContent('2');
  });
});
