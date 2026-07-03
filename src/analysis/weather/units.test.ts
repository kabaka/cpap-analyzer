import { describe, it, expect } from 'vitest';

import {
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  convertTemperature,
  hpaToInHg,
  inHgToHpa,
  convertPressure,
  kmhToMs,
  kmhToMph,
  msToKmh,
  mphToKmh,
  convertWind,
  mmToInches,
  inchesToMm,
  convertPrecip,
} from './units';

describe('weather/units — temperature', () => {
  it('converts °C to °F against reference values', () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
    expect(celsiusToFahrenheit(-40)).toBe(-40);
    expect(celsiusToFahrenheit(37)).toBeCloseTo(98.6, 10);
  });

  it('converts °F to °C against reference values', () => {
    expect(fahrenheitToCelsius(32)).toBe(0);
    expect(fahrenheitToCelsius(212)).toBe(100);
    expect(fahrenheitToCelsius(-40)).toBe(-40);
  });

  it('round-trips °C -> °F -> °C', () => {
    for (const c of [-12.3, 0, 5.5, 21.7, 36.6]) {
      expect(fahrenheitToCelsius(celsiusToFahrenheit(c))).toBeCloseTo(c, 10);
    }
  });

  it('convertTemperature passes through C and converts to F', () => {
    expect(convertTemperature(20, 'C')).toBe(20);
    expect(convertTemperature(20, 'F')).toBe(68);
  });

  it('preserves null and maps non-finite to NaN', () => {
    expect(celsiusToFahrenheit(null)).toBeNull();
    expect(fahrenheitToCelsius(null)).toBeNull();
    expect(celsiusToFahrenheit(Number.POSITIVE_INFINITY)).toBeNaN();
    expect(celsiusToFahrenheit(Number.NaN)).toBeNaN();
  });
});

describe('weather/units — pressure', () => {
  it('converts hPa to inHg (1 atm = 1013.25 hPa ≈ 29.9213 inHg)', () => {
    expect(hpaToInHg(1013.25)).toBeCloseTo(29.9213, 3);
    expect(hpaToInHg(1000)).toBeCloseTo(29.53, 2);
  });

  it('converts inHg to hPa', () => {
    expect(inHgToHpa(29.92126)).toBeCloseTo(1013.25, 2);
  });

  it('round-trips hPa -> inHg -> hPa', () => {
    for (const h of [980, 1000, 1013.25, 1040]) {
      expect(inHgToHpa(hpaToInHg(h))).toBeCloseTo(h, 8);
    }
  });

  it('convertPressure passes through hPa and converts to inHg', () => {
    expect(convertPressure(1013.25, 'hPa')).toBe(1013.25);
    expect(convertPressure(1013.25, 'inHg')).toBeCloseTo(29.9213, 3);
  });

  it('preserves null and maps non-finite to NaN', () => {
    expect(hpaToInHg(null)).toBeNull();
    expect(inHgToHpa(null)).toBeNull();
    expect(hpaToInHg(Number.NaN)).toBeNaN();
  });
});

describe('weather/units — wind', () => {
  it('converts km/h to m/s and mph against reference (100 km/h)', () => {
    expect(kmhToMs(100)).toBeCloseTo(27.77778, 4);
    expect(kmhToMph(100)).toBeCloseTo(62.13712, 4);
  });

  it('converts m/s and mph back to km/h', () => {
    expect(msToKmh(10)).toBeCloseTo(36, 10); // 10 m/s = 36 km/h exactly
    expect(mphToKmh(60)).toBeCloseTo(96.56064, 5); // 60 mph = 96.56064 km/h exactly
  });

  it('round-trips km/h -> m/s -> km/h and km/h -> mph -> km/h', () => {
    for (const k of [0, 3.6, 25, 100, 137.2]) {
      expect(msToKmh(kmhToMs(k))).toBeCloseTo(k, 8);
      expect(mphToKmh(kmhToMph(k))).toBeCloseTo(k, 8);
    }
  });

  it('convertWind selects the correct unit', () => {
    expect(convertWind(100, 'kmh')).toBe(100);
    expect(convertWind(100, 'ms')).toBeCloseTo(27.77778, 4);
    expect(convertWind(100, 'mph')).toBeCloseTo(62.13712, 4);
  });

  it('preserves null and maps non-finite to NaN', () => {
    expect(kmhToMs(null)).toBeNull();
    expect(convertWind(null, 'mph')).toBeNull();
    expect(kmhToMph(Number.POSITIVE_INFINITY)).toBeNaN();
  });
});

describe('weather/units — precipitation', () => {
  it('converts mm to inches against reference values', () => {
    expect(mmToInches(25.4)).toBeCloseTo(1, 10);
    expect(mmToInches(12.7)).toBeCloseTo(0.5, 10);
    expect(mmToInches(0)).toBe(0);
  });

  it('converts inches to mm', () => {
    expect(inchesToMm(1)).toBeCloseTo(25.4, 10);
    expect(inchesToMm(0.5)).toBeCloseTo(12.7, 10);
  });

  it('round-trips mm -> in -> mm', () => {
    for (const mm of [0, 0.2, 5, 25.4, 100.6]) {
      expect(inchesToMm(mmToInches(mm))).toBeCloseTo(mm, 8);
    }
  });

  it('convertPrecip passes through mm and converts to in', () => {
    expect(convertPrecip(25.4, 'mm')).toBe(25.4);
    expect(convertPrecip(25.4, 'in')).toBeCloseTo(1, 10);
  });

  it('preserves null and maps non-finite to NaN', () => {
    expect(mmToInches(null)).toBeNull();
    expect(inchesToMm(null)).toBeNull();
    expect(mmToInches(Number.NaN)).toBeNaN();
  });
});
