import { describe, it, expect } from 'vitest';

import {
  categorizeUsAqi,
  categorizeEuropeanAqi,
  US_AQI_SEVERITY_COUNT,
  EUROPEAN_AQI_SEVERITY_COUNT,
} from './aqi';

describe('weather/aqi — US AQI', () => {
  it('maps representative mid-band values to labels and severities', () => {
    expect(categorizeUsAqi(25)).toEqual({ label: 'Good', severity: 0 });
    expect(categorizeUsAqi(75)).toEqual({ label: 'Moderate', severity: 1 });
    expect(categorizeUsAqi(125)).toEqual({
      label: 'Unhealthy for Sensitive Groups',
      severity: 2,
    });
    expect(categorizeUsAqi(175)).toEqual({ label: 'Unhealthy', severity: 3 });
    expect(categorizeUsAqi(250)).toEqual({ label: 'Very Unhealthy', severity: 4 });
    expect(categorizeUsAqi(400)).toEqual({ label: 'Hazardous', severity: 5 });
  });

  it('handles inclusive lower-bound breakpoints exactly', () => {
    // Upper edge of each band stays in that band; lower edge of next switches.
    expect(categorizeUsAqi(50).label).toBe('Good');
    expect(categorizeUsAqi(51).label).toBe('Moderate');
    expect(categorizeUsAqi(100).label).toBe('Moderate');
    expect(categorizeUsAqi(101).label).toBe('Unhealthy for Sensitive Groups');
    expect(categorizeUsAqi(150).label).toBe('Unhealthy for Sensitive Groups');
    expect(categorizeUsAqi(151).label).toBe('Unhealthy');
    expect(categorizeUsAqi(200).label).toBe('Unhealthy');
    expect(categorizeUsAqi(201).label).toBe('Very Unhealthy');
    expect(categorizeUsAqi(300).label).toBe('Very Unhealthy');
    expect(categorizeUsAqi(301).label).toBe('Hazardous');
  });

  it('reports Hazardous beyond the AQI (>500) and clamps Good at 0', () => {
    expect(categorizeUsAqi(750).label).toBe('Hazardous');
    expect(categorizeUsAqi(0).label).toBe('Good');
    // Negative (not physical) clamps to the cleanest band.
    expect(categorizeUsAqi(-5)).toEqual({ label: 'Good', severity: 0 });
  });

  it('returns null label/severity for null and non-finite input', () => {
    expect(categorizeUsAqi(null)).toEqual({ label: null, severity: null });
    expect(categorizeUsAqi(Number.NaN)).toEqual({ label: null, severity: null });
    expect(categorizeUsAqi(Number.POSITIVE_INFINITY).label).toBe(null);
  });

  it('exposes a stable severity count', () => {
    expect(US_AQI_SEVERITY_COUNT).toBe(6);
  });
});

describe('weather/aqi — European AQI', () => {
  it('maps representative mid-band values to labels and severities', () => {
    expect(categorizeEuropeanAqi(10)).toEqual({ label: 'Good', severity: 0 });
    expect(categorizeEuropeanAqi(30)).toEqual({ label: 'Fair', severity: 1 });
    expect(categorizeEuropeanAqi(50)).toEqual({ label: 'Moderate', severity: 2 });
    expect(categorizeEuropeanAqi(70)).toEqual({ label: 'Poor', severity: 3 });
    expect(categorizeEuropeanAqi(90)).toEqual({ label: 'Very Poor', severity: 4 });
    expect(categorizeEuropeanAqi(120)).toEqual({ label: 'Extremely Poor', severity: 5 });
  });

  it('handles inclusive lower-bound breakpoints exactly', () => {
    expect(categorizeEuropeanAqi(0).label).toBe('Good');
    expect(categorizeEuropeanAqi(20).label).toBe('Fair');
    expect(categorizeEuropeanAqi(40).label).toBe('Moderate');
    expect(categorizeEuropeanAqi(60).label).toBe('Poor');
    expect(categorizeEuropeanAqi(80).label).toBe('Very Poor');
    expect(categorizeEuropeanAqi(100).label).toBe('Extremely Poor');
    // Just-below boundaries stay in the lower band.
    expect(categorizeEuropeanAqi(19.999).label).toBe('Good');
    expect(categorizeEuropeanAqi(99.999).label).toBe('Very Poor');
  });

  it('returns null label/severity for null and non-finite input', () => {
    expect(categorizeEuropeanAqi(null)).toEqual({ label: null, severity: null });
    expect(categorizeEuropeanAqi(Number.NaN)).toEqual({ label: null, severity: null });
  });

  it('exposes a stable severity count', () => {
    expect(EUROPEAN_AQI_SEVERITY_COUNT).toBe(6);
  });
});
