/**
 * Unit tests for the pure Signal Viewer **weather** lane helpers. These cover
 * the correctness-critical paths: lane construction + auto-hide, the AQI band
 * rank→pattern wiring (so the ribbon agrees with the dashboard tile), the
 * two-civil-date merge that a midnight-spanning night needs, and the keyboard
 * cursor-readout weather announcement (the required non-visual / WCAG path).
 *
 * No network is ever touched — every input is an in-memory fixture.
 */

import { describe, it, expect } from 'vitest';

import { AQI_RAMP } from '@/analysis/weather/aqiRamp';
import type {
  AirQualityHourly,
  AirQualityHourlySample,
  WeatherHourly,
  WeatherHourlySample,
} from '@/types/weather';

import {
  aqiBands,
  aqiRibbonArrays,
  aqiSeriesHasData,
  buildWeatherChannel,
  conditionsHaveData,
  conditionBands,
  mergeAirQualityPoints,
  mergeWeatherPoints,
  pickAqiScale,
  pressureHasData,
  temperatureHasData,
  weatherCodeLabel,
  weatherCodeToCategory,
  weatherCursorReadout,
  weatherLaneDescriptor,
  weatherSeriesHasData,
  WEATHER_LANE_SPECS,
  type WeatherReadoutUnits,
} from '../weatherLanes';

// ── Fixtures ──────────────────────────────────────────────────────

const METRIC_UNITS: WeatherReadoutUnits = { temperature: 'C', pressure: 'hPa', wind: 'kmh' };

function wSample(time: string, over: Partial<WeatherHourlySample> = {}): WeatherHourlySample {
  return {
    time,
    temperature2m: null,
    relativeHumidity2m: null,
    dewpoint2m: null,
    surfacePressure: null,
    pressureMsl: null,
    precipitation: null,
    windspeed10m: null,
    cloudcover: null,
    weathercode: null,
    ...over,
  };
}

function aqSample(
  time: string,
  over: Partial<AirQualityHourlySample> = {},
): AirQualityHourlySample {
  return {
    time,
    pm25: null,
    pm10: null,
    ozone: null,
    nitrogenDioxide: null,
    usAqi: null,
    europeanAqi: null,
    ...over,
  };
}

function weatherHourly(samples: WeatherHourlySample[]): WeatherHourly {
  return { location: null, samples };
}

function aqHourly(samples: AirQualityHourlySample[]): AirQualityHourly {
  return { location: null, samples };
}

// ── WEATHER_LANE_SPECS construction ───────────────────────────────

describe('WEATHER_LANE_SPECS', () => {
  it('defines the four weather lanes with the WX pill and weather group', () => {
    expect(WEATHER_LANE_SPECS.map((s) => s.key)).toEqual([
      'conditions',
      'pressure',
      'temperature',
      'aqi',
    ]);
    for (const spec of WEATHER_LANE_SPECS) {
      expect(spec.group).toBe('weather');
      expect(spec.pill).toBe('WX');
      expect(spec.id.startsWith('weather:')).toBe(true);
    }
  });

  it('renders conditions + AQI as compact ribbons and pressure/temp as lines', () => {
    const byKey = Object.fromEntries(WEATHER_LANE_SPECS.map((s) => [s.key, s]));
    expect(byKey.conditions!.render).toBe('ribbon');
    expect(byKey.aqi!.render).toBe('ribbon');
    expect(byKey.conditions!.heightVar).toBe('--signal-lane-height-ribbon');
    expect(byKey.aqi!.heightVar).toBe('--signal-lane-height-ribbon');
    expect(byKey.pressure!.render).toBe('line');
    expect(byKey.temperature!.render).toBe('line');
    expect(byKey.pressure!.colorVar).toBe('var(--color-weather-pressure)');
    expect(byKey.temperature!.colorVar).toBe('var(--color-weather-temp)');
  });
});

// ── Auto-hide (hasData) ───────────────────────────────────────────

describe('weather lane auto-hide (hasData)', () => {
  it('descriptor carries hasData=false so the lane auto-hides without data', () => {
    const d = weatherLaneDescriptor('pressure', false);
    expect(d.hasData).toBe(false);
    expect(d.id).toBe('weather:pressure');
    expect(d.group).toBe('weather');
  });

  it('reports no data for each metric when every hourly value is null', () => {
    const points = mergeWeatherPoints(
      weatherHourly([wSample('2026-01-15T23:00'), wSample('2026-01-16T00:00')]),
    );
    expect(weatherSeriesHasData(points)).toBe(false);
    expect(temperatureHasData(points)).toBe(false);
    expect(pressureHasData(points)).toBe(false);
    expect(conditionsHaveData(points)).toBe(false);
  });

  it('reports data per metric when at least one finite value is present', () => {
    const points = mergeWeatherPoints(
      weatherHourly([
        wSample('2026-01-15T23:00', { temperature2m: 4.2, weathercode: 3 }),
        wSample('2026-01-16T00:00', { pressureMsl: 1011 }),
      ]),
    );
    expect(temperatureHasData(points)).toBe(true);
    expect(pressureHasData(points)).toBe(true);
    expect(conditionsHaveData(points)).toBe(true);
    expect(weatherSeriesHasData(points)).toBe(true);
  });

  it('AQI hasData follows the active scale', () => {
    const usOnly = mergeAirQualityPoints(aqHourly([aqSample('2026-01-15T23:00', { usAqi: 42 })]));
    expect(aqiSeriesHasData(usOnly, 'us')).toBe(true);
    expect(aqiSeriesHasData(usOnly, 'european')).toBe(false);
  });

  it('buildWeatherChannel returns null when the lane has no data (auto-hide)', () => {
    const presentation = {
      resolveColor: (v: string) => v,
      resolveHeight: () => 44,
      pressureLineWidth: 1.6,
      temperatureLineWidth: 1.2,
    };
    const empty = {
      weatherPoints: [],
      aqiPoints: [],
      aqiScale: 'us' as const,
      wallClockEpoch: 0,
    };
    expect(buildWeatherChannel('pressure', empty, presentation)).toBeNull();
    expect(buildWeatherChannel('conditions', empty, presentation)).toBeNull();
    expect(buildWeatherChannel('aqi', empty, presentation)).toBeNull();
  });

  it('buildWeatherChannel builds the dashed temperature line and solid pressure line', () => {
    const presentation = {
      resolveColor: (v: string) => v,
      resolveHeight: () => 150,
      pressureLineWidth: 1.6,
      temperatureLineWidth: 1.2,
    };
    const points = mergeWeatherPoints(
      weatherHourly([
        wSample('2026-01-15T23:00', { temperature2m: 5, pressureMsl: 1010 }),
        wSample('2026-01-16T00:00', { temperature2m: 4, pressureMsl: 1009 }),
      ]),
    );
    const epoch = Date.UTC(2026, 0, 15, 23, 0, 0);
    const ctx = {
      weatherPoints: points,
      aqiPoints: [],
      aqiScale: 'us' as const,
      wallClockEpoch: epoch,
    };

    const temp = buildWeatherChannel('temperature', ctx, presentation);
    expect(temp).not.toBeNull();
    expect(temp!.render).toBe('line');
    expect(temp!.dash).toBeDefined();
    expect((temp!.dash ?? []).length).toBeGreaterThan(0);
    expect(Array.from(temp!.data)).toEqual([5, 4]);
    expect(Array.from(temp!.sampleTimes!)).toEqual([0, 3_600_000]);

    const pressure = buildWeatherChannel('pressure', ctx, presentation);
    expect(pressure!.dash).toBeUndefined(); // solid
    expect(pressure!.lineWidth).toBe(1.6);
  });
});

// ── WMO weathercode → category / label ────────────────────────────

describe('weatherCodeToCategory', () => {
  it('buckets the WMO table into coarse condition runs', () => {
    expect(weatherCodeToCategory(0)).toBe('clear');
    expect(weatherCodeToCategory(2)).toBe('partly');
    expect(weatherCodeToCategory(3)).toBe('cloudy');
    expect(weatherCodeToCategory(45)).toBe('fog');
    expect(weatherCodeToCategory(53)).toBe('drizzle');
    expect(weatherCodeToCategory(63)).toBe('rain');
    expect(weatherCodeToCategory(81)).toBe('rain');
    expect(weatherCodeToCategory(73)).toBe('snow');
    expect(weatherCodeToCategory(96)).toBe('storm');
  });

  it('returns null for null / unknown codes (a ribbon gap, not a fabricated condition)', () => {
    expect(weatherCodeToCategory(null)).toBeNull();
    expect(weatherCodeToCategory(NaN)).toBeNull();
    expect(weatherCodeToCategory(40)).toBeNull();
    expect(weatherCodeLabel(null)).toBeNull();
    expect(weatherCodeLabel(63)).toBe('Rain');
  });
});

// ── Two-civil-date merge ──────────────────────────────────────────

describe('two-civil-date merge', () => {
  it('merges both dates of a midnight-spanning night into one ascending series', () => {
    // Evening date record (ends 23:00) + morning date record (00:00, 01:00).
    const evening = weatherHourly([
      wSample('2026-01-15T22:00', { temperature2m: 6 }),
      wSample('2026-01-15T23:00', { temperature2m: 5 }),
    ]);
    const morning = weatherHourly([
      wSample('2026-01-16T00:00', { temperature2m: 4 }),
      wSample('2026-01-16T01:00', { temperature2m: 3 }),
    ]);

    const merged = mergeWeatherPoints(evening, morning);
    expect(merged.map((p) => p.temperature2m)).toEqual([6, 5, 4, 3]);
    // Strictly ascending in time across the midnight boundary.
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i]!.timeMs).toBeGreaterThan(merged[i - 1]!.timeMs);
    }
  });

  it('de-duplicates an overlapping boundary hour (first occurrence wins)', () => {
    const a = weatherHourly([wSample('2026-01-16T00:00', { temperature2m: 4 })]);
    const b = weatherHourly([wSample('2026-01-16T00:00', { temperature2m: 99 })]);
    const merged = mergeWeatherPoints(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.temperature2m).toBe(4);
  });

  it('drops samples with unparseable timestamps and tolerates null records', () => {
    const merged = mergeWeatherPoints(
      null,
      weatherHourly([
        wSample('not-a-time', { temperature2m: 1 }),
        wSample('2026-01-16T00:00', { temperature2m: 4 }),
      ]),
      undefined,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.temperature2m).toBe(4);
  });

  it('merges air-quality records across both civil dates', () => {
    const merged = mergeAirQualityPoints(
      aqHourly([aqSample('2026-01-15T23:00', { usAqi: 40 })]),
      aqHourly([aqSample('2026-01-16T00:00', { usAqi: 55 })]),
    );
    expect(merged.map((p) => p.usAqi)).toEqual([40, 55]);
  });
});

// ── AQI band rank → pattern wiring ────────────────────────────────

describe('aqiBands (rank → fill + pattern wiring)', () => {
  it('maps each present rank to the shared ramp colour + pattern + glyph', () => {
    // usAqi 40 → Good (rank 1); 75 → Moderate (rank 2); 130 → USG (rank 3).
    const points = mergeAirQualityPoints(
      aqHourly([
        aqSample('2026-01-15T22:00', { usAqi: 40 }),
        aqSample('2026-01-15T23:00', { usAqi: 75 }),
        aqSample('2026-01-16T00:00', { usAqi: 130 }),
      ]),
    );
    const bands = aqiBands(points, 'us', (v) => v); // identity resolver returns the var name

    expect(bands.map((b) => b.value)).toEqual([1, 2, 3]);
    // Each band's pattern/glyph/colorVar comes straight from AQI_RAMP[rank-1].
    for (const band of bands) {
      const ramp = AQI_RAMP[band.value - 1]!;
      expect(band.pattern).toBe(ramp.pattern);
      expect(band.label).toBe(ramp.glyph);
      expect(band.color).toBe(ramp.colorVar); // identity resolver → the var name
      expect(band.patternColor).toBe(ramp.fgVar);
    }
    // Sanity: rank 1 is solid, rank 3 escalates to a denser hatch.
    expect(bands[0]!.pattern).toBe('solid');
    expect(bands[2]!.pattern).toBe('hatch-med');
  });

  it('emits no band for a rank with no valid reading (never a fabricated rank)', () => {
    const points = mergeAirQualityPoints(aqHourly([aqSample('2026-01-15T22:00', { usAqi: null })]));
    expect(aqiBands(points, 'us', (v) => v)).toEqual([]);
  });

  it('aqiRibbonArrays carries each hour rank and NaN for missing readings', () => {
    const points = mergeAirQualityPoints(
      aqHourly([
        aqSample('2026-01-15T22:00', { usAqi: 40 }), // rank 1
        aqSample('2026-01-15T23:00', { usAqi: null }), // gap
      ]),
    );
    const epoch = Date.UTC(2026, 0, 15, 22, 0, 0);
    const { values, times } = aqiRibbonArrays(points, 'us', epoch);
    expect(values[0]).toBe(1);
    expect(Number.isNaN(values[1]!)).toBe(true);
    expect(Array.from(times)).toEqual([0, 3_600_000]);
  });
});

// ── conditionBands ────────────────────────────────────────────────

describe('conditionBands', () => {
  it('builds one band per condition category present, with its glyph', () => {
    const points = mergeWeatherPoints(
      weatherHourly([
        wSample('2026-01-15T22:00', { weathercode: 0 }), // clear
        wSample('2026-01-15T23:00', { weathercode: 3 }), // cloudy
        wSample('2026-01-16T00:00', { weathercode: 0 }), // clear again (dedup category)
      ]),
    );
    const bands = conditionBands(points, (v) => v);
    expect(bands.map((b) => b.value)).toEqual([0, 2]); // clear ordinal 0, cloudy ordinal 2
    expect(bands.every((b) => b.label.length > 0)).toBe(true);
  });
});

// ── pickAqiScale ──────────────────────────────────────────────────

describe('pickAqiScale', () => {
  it('prefers US, falls back to European, defaults to US when empty', () => {
    const us = mergeAirQualityPoints(aqHourly([aqSample('2026-01-15T22:00', { usAqi: 40 })]));
    const eu = mergeAirQualityPoints(aqHourly([aqSample('2026-01-15T22:00', { europeanAqi: 30 })]));
    expect(pickAqiScale(us)).toBe('us');
    expect(pickAqiScale(eu)).toBe('european');
    expect(pickAqiScale([])).toBe('us');
  });
});

// ── Cursor-readout weather announcement (non-visual / WCAG path) ───

describe('weatherCursorReadout', () => {
  const epoch = Date.UTC(2026, 0, 15, 22, 0, 0);

  it('announces temp, pressure, dew point, wind, condition word, and AQI word+value', () => {
    const weather = mergeWeatherPoints(
      weatherHourly([
        wSample('2026-01-15T22:00', {
          temperature2m: 4.2,
          pressureMsl: 1011,
          dewpoint2m: 1.5,
          windspeed10m: 12,
          weathercode: 3, // cloudy
        }),
      ]),
    );
    const aqi = mergeAirQualityPoints(aqHourly([aqSample('2026-01-15T22:00', { usAqi: 78 })]));

    const text = weatherCursorReadout(epoch, weather, aqi, 'us', METRIC_UNITS);

    expect(text).toContain('temperature 4.2 °C');
    expect(text).toContain('barometric pressure 1011 hectopascals');
    expect(text).toContain('dew point 1.5 °C');
    expect(text).toContain('wind 12 km/h');
    expect(text).toContain('Cloudy');
    // The required encoding: WORD + NUMBER together, never a bare value.
    expect(text).toContain('Air quality: Moderate, AQI 78');
  });

  it('never emits a bare AQI value without its word', () => {
    const aqi = mergeAirQualityPoints(aqHourly([aqSample('2026-01-15T22:00', { usAqi: 78 })]));
    const text = weatherCursorReadout(epoch, [], aqi, 'us', METRIC_UNITS);
    expect(text).toContain('Air quality: Moderate, AQI 78');
    // No clause that is just "AQI 78" detached from a word.
    expect(/(?<!Moderate, )AQI 78/.test(text.replace('Air quality: Moderate, AQI 78', ''))).toBe(
      false,
    );
  });

  it('omits missing fields and returns empty when no sample is near the cursor', () => {
    const weather = mergeWeatherPoints(
      weatherHourly([wSample('2026-01-15T22:00', { temperature2m: 4.2 })]),
    );
    // Only temperature is present → only that clause appears.
    const text = weatherCursorReadout(epoch, weather, [], 'us', METRIC_UNITS);
    expect(text).toBe('Weather: temperature 4.2 °C');

    // A cursor hours before the first sample reads nothing.
    const farBefore = weatherCursorReadout(epoch - 10 * 3_600_000, weather, [], 'us', METRIC_UNITS);
    expect(farBefore).toBe('');
  });

  it('converts to the requested display units', () => {
    const weather = mergeWeatherPoints(
      weatherHourly([
        wSample('2026-01-15T22:00', { temperature2m: 0, pressureMsl: 1013.25, windspeed10m: 36 }),
      ]),
    );
    const text = weatherCursorReadout(epoch, weather, [], 'us', {
      temperature: 'F',
      pressure: 'inHg',
      wind: 'ms',
    });
    expect(text).toContain('temperature 32.0 °F'); // 0 °C → 32 °F
    expect(text).toContain('barometric pressure 29.92 inches Hg'); // 1013.25 hPa
    expect(text).toContain('wind 10 m/s'); // 36 km/h → 10 m/s
  });
});
