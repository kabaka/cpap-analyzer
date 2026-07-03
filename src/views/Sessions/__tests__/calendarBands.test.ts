import { describe, it, expect } from 'vitest';

import {
  AHI_SEVERITY_THRESHOLDS,
  CMS_COMPLIANCE_HOURS,
  RECOMMENDED_USAGE_HOURS,
} from '@/analysis/clinical';
import { LEAK_NOTICE_LPM } from '@/analysis/uncertainty';
import { selectBand, type CalendarBand } from '@/components/charts/d3/CalendarHeatmap';

import { CALENDAR_METRIC_CONFIG } from '../calendarBands';
import type { CalendarMetric } from '../viewParams';

/**
 * Clinical-correctness coverage for the Sessions calendar band tables.
 *
 * Two things matter here and both are asserted against the CANONICAL clinical
 * constants (imported, never re-typed), so a future edit that silently
 * hardcodes a different cutoff fails:
 *
 *   1. The band EDGES are derived from `AHI_SEVERITY_THRESHOLDS`,
 *      `CMS_COMPLIANCE_HOURS`, `RECOMMENDED_USAGE_HOURS`, and `LEAK_NOTICE_LPM`.
 *   2. The band SELECTION the consumer relies on (`selectBand`, exported from
 *      the CalendarHeatmap component) agrees with those edges at and around each
 *      boundary — i.e. the producer (this config) and the consumer (the chart)
 *      classify the same value the same way.
 */

/** Pull the ordered `min` edges out of a band table. */
function edges(bands: readonly CalendarBand[]): number[] {
  return bands.map((b) => b.min);
}

/** Pull the ordered fill colors out of a band table. */
function colors(bands: readonly CalendarBand[]): string[] {
  return bands.map((b) => b.color);
}

/** Pull the ordered short labels out of a band table. */
function labels(bands: readonly CalendarBand[]): string[] {
  return bands.map((b) => b.label);
}

describe('SessionList/calendarBands', () => {
  describe('config completeness', () => {
    const metrics: CalendarMetric[] = ['ahi', 'usage', 'leak'];

    it.each(metrics)('exposes a fully-populated config for %s', (metric) => {
      const cfg = CALENDAR_METRIC_CONFIG[metric];
      expect(cfg).toBeDefined();
      expect(cfg.bands.length).toBe(4);
      expect(cfg.metricLabel).toBeTruthy();
      expect(typeof cfg.metricFormatter).toBe('function');
      expect(cfg.partialLabel).toBeTruthy();
    });

    it.each(metrics)('orders %s bands by ascending min (selectBand precondition)', (metric) => {
      const e = edges(CALENDAR_METRIC_CONFIG[metric].bands);
      const sorted = [...e].sort((a, b) => a - b);
      expect(e).toEqual(sorted);
    });
  });

  describe('AHI bands', () => {
    const { bands } = CALENDAR_METRIC_CONFIG.ahi;

    it('has edges [0, 5, 15, 30]', () => {
      expect(edges(bands)).toEqual([0, 5, 15, 30]);
    });

    it('derives the upper three edges from AHI_SEVERITY_THRESHOLDS (not hardcoded)', () => {
      expect(bands[1]?.min).toBe(AHI_SEVERITY_THRESHOLDS.mild);
      expect(bands[2]?.min).toBe(AHI_SEVERITY_THRESHOLDS.moderate);
      expect(bands[3]?.min).toBe(AHI_SEVERITY_THRESHOLDS.severe);
    });

    it('labels the bands Normal / Mild / Moderate / Severe', () => {
      expect(labels(bands)).toEqual(['Normal', 'Mild', 'Moderate', 'Severe']);
    });

    it('ramps green → red as severity rises (higher AHI is worse)', () => {
      expect(colors(bands)).toEqual([
        'var(--color-status-normal)',
        'var(--color-status-mild)',
        'var(--color-status-moderate)',
        'var(--color-status-severe)',
      ]);
    });

    it('selectBand classifies values at and around each boundary correctly', () => {
      const mutable = [...bands];
      expect(selectBand(0, mutable)?.label).toBe('Normal');
      expect(selectBand(4.9, mutable)?.label).toBe('Normal');
      expect(selectBand(5, mutable)?.label).toBe('Mild');
      expect(selectBand(14.9, mutable)?.label).toBe('Mild');
      expect(selectBand(15, mutable)?.label).toBe('Moderate');
      expect(selectBand(29.9, mutable)?.label).toBe('Moderate');
      expect(selectBand(30, mutable)?.label).toBe('Severe');
      expect(selectBand(120, mutable)?.label).toBe('Severe');
    });
  });

  describe('Usage bands (inverted polarity — higher is better)', () => {
    const { bands } = CALENDAR_METRIC_CONFIG.usage;

    it('has edges [0, 2, 4, 6]', () => {
      expect(edges(bands)).toEqual([0, 2, 4, 6]);
    });

    it('anchors the 4h and 6h edges on the canonical compliance/recommended hours', () => {
      expect(bands[2]?.min).toBe(CMS_COMPLIANCE_HOURS);
      expect(bands[2]?.min).toBe(4);
      expect(bands[3]?.min).toBe(RECOMMENDED_USAGE_HOURS);
      expect(bands[3]?.min).toBe(6);
    });

    it('inverts the ramp: low usage is red (severe), high usage is green (normal)', () => {
      expect(colors(bands)).toEqual([
        'var(--color-status-severe)',
        'var(--color-status-moderate)',
        'var(--color-status-mild)',
        'var(--color-status-normal)',
      ]);
    });

    it('selectBand classifies usage hours at and around each boundary correctly', () => {
      const mutable = [...bands];
      // Lowest band (under 2h) is the worst tier (severe/red).
      expect(selectBand(0, mutable)?.color).toBe('var(--color-status-severe)');
      expect(selectBand(1.9, mutable)?.color).toBe('var(--color-status-severe)');
      expect(selectBand(2, mutable)?.color).toBe('var(--color-status-moderate)');
      expect(selectBand(4, mutable)?.color).toBe('var(--color-status-mild)');
      // At/above the recommended 6h target → best tier (normal/green).
      expect(selectBand(6, mutable)?.color).toBe('var(--color-status-normal)');
      expect(selectBand(8, mutable)?.color).toBe('var(--color-status-normal)');
    });
  });

  describe('Leak bands (lower is better)', () => {
    const { bands } = CALENDAR_METRIC_CONFIG.leak;

    it('has edges [0, 6, 12, 24]', () => {
      expect(edges(bands)).toEqual([0, 6, 12, 24]);
    });

    it('anchors the red edge on the canonical LEAK_NOTICE_LPM threshold', () => {
      expect(bands[3]?.min).toBe(LEAK_NOTICE_LPM);
      expect(bands[3]?.min).toBe(24);
    });

    it('ramps green → red as leak rises (higher leak is worse)', () => {
      expect(colors(bands)).toEqual([
        'var(--color-status-normal)',
        'var(--color-status-mild)',
        'var(--color-status-moderate)',
        'var(--color-status-severe)',
      ]);
    });

    it('selectBand classifies leak rates at and around each boundary correctly', () => {
      const mutable = [...bands];
      // Lowest band is the best tier (normal/green).
      expect(selectBand(0, mutable)?.color).toBe('var(--color-status-normal)');
      expect(selectBand(5.9, mutable)?.color).toBe('var(--color-status-normal)');
      expect(selectBand(6, mutable)?.color).toBe('var(--color-status-mild)');
      expect(selectBand(12, mutable)?.color).toBe('var(--color-status-moderate)');
      // At/above the 24 L/min notice threshold → worst tier (severe/red).
      expect(selectBand(24, mutable)?.color).toBe('var(--color-status-severe)');
      expect(selectBand(40, mutable)?.color).toBe('var(--color-status-severe)');
    });
  });

  describe('metric formatters and labels', () => {
    it('formats AHI as a one-decimal events/hour rate (12.4)', () => {
      expect(CALENDAR_METRIC_CONFIG.ahi.metricFormatter(12.4)).toBe('12.4');
      expect(CALENDAR_METRIC_CONFIG.ahi.metricFormatter(5)).toBe('5.0');
      expect(CALENDAR_METRIC_CONFIG.ahi.metricLabel).toBe('AHI (events/h)');
    });

    it('formats usage as one-decimal hours with an "h" suffix (6.2h)', () => {
      expect(CALENDAR_METRIC_CONFIG.usage.metricFormatter(6.2)).toBe('6.2h');
      expect(CALENDAR_METRIC_CONFIG.usage.metricFormatter(4)).toBe('4.0h');
      expect(CALENDAR_METRIC_CONFIG.usage.metricLabel).toBe('Usage (hours)');
    });

    it('formats leak as a one-decimal L/min rate (18.0)', () => {
      expect(CALENDAR_METRIC_CONFIG.leak.metricFormatter(18)).toBe('18.0');
      expect(CALENDAR_METRIC_CONFIG.leak.metricFormatter(12.34)).toBe('12.3');
      expect(CALENDAR_METRIC_CONFIG.leak.metricLabel).toBe('Leak median (L/min)');
    });

    it('provides a non-empty partial label for every metric (AHI especially)', () => {
      expect(CALENDAR_METRIC_CONFIG.ahi.partialLabel.length).toBeGreaterThan(0);
      expect(CALENDAR_METRIC_CONFIG.usage.partialLabel.length).toBeGreaterThan(0);
      expect(CALENDAR_METRIC_CONFIG.leak.partialLabel.length).toBeGreaterThan(0);
    });
  });
});
