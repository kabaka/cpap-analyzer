import { describe, it, expect } from 'vitest';
import {
  formatMetric,
  metricPrecision,
  roundHalfToEven,
  PRECISION_REGISTRY,
} from '../formatMetric';

describe('formatMetric — D9 precision table', () => {
  it('AHI / RDI / ODI / sub-indices → 1 decimal', () => {
    expect(formatMetric('ahi', 5.04)).toBe('5.0');
    expect(formatMetric('ahi', 5.06)).toBe('5.1');
    expect(formatMetric('rdi', 12.34)).toBe('12.3');
    expect(formatMetric('odi', 3.99)).toBe('4.0');
    expect(formatMetric('ai', 1.25)).toBe('1.2'); // 1.25 is exactly representable → banker's → 1.2
    expect(formatMetric('cai', 2.0)).toBe('2.0');
  });

  it('pressure → 1 decimal', () => {
    expect(formatMetric('pressure', 9.87)).toBe('9.9');
    expect(formatMetric('pressure', 10)).toBe('10.0');
  });

  it('leak median/P95/max → integer', () => {
    expect(formatMetric('leak', 23.7)).toBe('24');
    expect(formatMetric('leakMedian', 12.2)).toBe('12');
    expect(formatMetric('leakP95', 35.9)).toBe('36');
    expect(formatMetric('leakMax', 41.4)).toBe('41');
  });

  it('tidal volume → integer mL', () => {
    expect(formatMetric('tidalVolume', 487.6)).toBe('488');
  });

  it('minute ventilation → 1 decimal', () => {
    expect(formatMetric('minuteVentilation', 6.78)).toBe('6.8');
  });

  it('respiratory rate / SpO2 → integer', () => {
    expect(formatMetric('respiratoryRate', 14.6)).toBe('15');
    expect(formatMetric('spo2', 94.4)).toBe('94');
    expect(formatMetric('spo2Min', 88.9)).toBe('89');
  });

  it('T90 → integer minutes (stats correction)', () => {
    expect(formatMetric('t90', 12.7)).toBe('13');
    expect(PRECISION_REGISTRY.t90.decimals).toBe(0);
  });

  it('usage → 1 decimal, compliance → integer', () => {
    expect(formatMetric('usage', 6.75)).toBe('6.8'); // banker's: 6.75 → 6.8
    expect(formatMetric('compliance', 86.5)).toBe('86'); // banker's at .5 → even
  });

  it('event counts → integer', () => {
    expect(formatMetric('count', 42)).toBe('42');
  });

  it('preserves trailing significant zeros', () => {
    expect(formatMetric('ahi', 5)).toBe('5.0');
    expect(formatMetric('pressure', 8)).toBe('8.0');
    expect(formatMetric('count', 5)).toBe('5');
  });

  it('renders non-finite as em-dash', () => {
    expect(formatMetric('ahi', NaN)).toBe('—');
    expect(formatMetric('ahi', Infinity)).toBe('—');
  });

  it('uses fallback decimals (default 1) for unknown metrics', () => {
    expect(formatMetric('mystery', 3.14159)).toBe('3.1');
    expect(formatMetric('mystery', 3.14159, { fallbackDecimals: 3 })).toBe('3.142');
  });

  it('does not mutate or depend on input identity', () => {
    const v = 5.04;
    formatMetric('ahi', v);
    expect(v).toBe(5.04);
  });
});

describe('roundHalfToEven — banker’s rounding', () => {
  it('rounds the exact .5 midpoint to the nearest even (integer place)', () => {
    expect(roundHalfToEven(0.5, 0)).toBe(0);
    expect(roundHalfToEven(1.5, 0)).toBe(2);
    expect(roundHalfToEven(2.5, 0)).toBe(2);
    expect(roundHalfToEven(3.5, 0)).toBe(4);
    expect(roundHalfToEven(4.5, 0)).toBe(4);
  });

  it('rounds exactly-representable 1-dp midpoints to nearest even', () => {
    // 0.25, 1.25, 2.75 are exactly representable in binary; the .5-at-the-
    // rounding-digit is true, so banker's applies deterministically.
    expect(roundHalfToEven(0.25, 1)).toBe(0.2);
    expect(roundHalfToEven(1.25, 1)).toBe(1.2);
    expect(roundHalfToEven(2.75, 1)).toBeCloseTo(2.8, 10);
  });

  it('rounds non-midpoints normally', () => {
    expect(roundHalfToEven(2.4, 0)).toBe(2);
    expect(roundHalfToEven(2.6, 0)).toBe(3);
  });

  it('normalises negative zero to zero', () => {
    expect(Object.is(roundHalfToEven(-0.04, 1), 0)).toBe(true);
  });

  it('returns NaN for non-finite input', () => {
    expect(roundHalfToEven(NaN, 1)).toBeNaN();
    expect(roundHalfToEven(Infinity, 1)).toBeNaN();
  });
});

describe('metricPrecision', () => {
  it('returns the registered precision', () => {
    expect(metricPrecision('ahi').decimals).toBe(1);
    expect(metricPrecision('leak').decimals).toBe(0);
  });
  it('returns the fallback for unknown ids', () => {
    expect(metricPrecision('unknown').decimals).toBe(1);
    expect(metricPrecision('unknown', 2).decimals).toBe(2);
  });
});
