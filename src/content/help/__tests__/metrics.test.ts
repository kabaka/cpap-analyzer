/**
 * Unit tests for metric definitions — structure and completeness validation.
 *
 * Ensures every metric has the required fields, non-empty content,
 * and that the metricMap provides correct O(1) lookups.
 *
 * @module content/help/__tests__/metrics.test
 */

import { describe, it, expect } from 'vitest';
import { metricDefinitions, metricMap } from '../metrics';
import type { MetricDefinition } from '../metrics';

describe('Metric definitions', () => {
  describe('metricDefinitions', () => {
    it('should contain at least 10 metric definitions', () => {
      expect(metricDefinitions.length).toBeGreaterThanOrEqual(10);
    });

    it('should have unique ids across all definitions', () => {
      const ids = metricDefinitions.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it.each(metricDefinitions.map((m) => [m.id, m] as const))(
      'metric "%s" should have all required fields',
      (_id, metric: MetricDefinition) => {
        expect(metric.id).toBeTruthy();
        expect(metric.label).toBeTruthy();
        expect(metric.unit).toBeTruthy();
        expect(metric.tooltip).toBeTruthy();
        expect(metric.interpretation).toBeTruthy();
      },
    );

    it.each(metricDefinitions.map((m) => [m.id, m] as const))(
      'metric "%s" should have meaningful tooltip and interpretation',
      (_id, metric: MetricDefinition) => {
        expect(metric.tooltip.length).toBeGreaterThan(10);
        expect(metric.interpretation.length).toBeGreaterThan(10);
      },
    );

    it('should include core CPAP metrics', () => {
      const ids = new Set(metricDefinitions.map((m) => m.id));
      expect(ids.has('ahi')).toBe(true);
      expect(ids.has('usage-hours')).toBe(true);
      expect(ids.has('compliance-rate')).toBe(true);
      expect(ids.has('leak-median')).toBe(true);
      expect(ids.has('pressure-mean')).toBe(true);
    });

    it('should have valid units (non-empty strings)', () => {
      for (const metric of metricDefinitions) {
        expect(typeof metric.unit).toBe('string');
        expect(metric.unit.length).toBeGreaterThan(0);
      }
    });

    it('should reference valid glossary ids when glossaryId is present', () => {
      for (const metric of metricDefinitions) {
        if (metric.glossaryId) {
          expect(typeof metric.glossaryId).toBe('string');
          expect(metric.glossaryId.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('metricMap', () => {
    it('should be a Map with the same size as metricDefinitions', () => {
      expect(metricMap).toBeInstanceOf(Map);
      expect(metricMap.size).toBe(metricDefinitions.length);
    });

    it('should map every id to the correct definition', () => {
      for (const metric of metricDefinitions) {
        expect(metricMap.get(metric.id)).toBe(metric);
      }
    });

    it('should return undefined for non-existent ids', () => {
      expect(metricMap.get('non-existent-metric')).toBeUndefined();
    });

    it('should provide O(1) lookup for known metrics', () => {
      const ahi = metricMap.get('ahi');
      expect(ahi).toBeDefined();
      expect(ahi!.label).toBe('AHI');
      expect(ahi!.unit).toBe('events/hr');
    });
  });

  describe('reliability annotations (consensus D5)', () => {
    const validTiers = ['high', 'moderate', 'low'];

    it('should use a valid tier and a non-empty note whenever reliability is present', () => {
      for (const metric of metricDefinitions) {
        if (metric.reliability) {
          expect(validTiers).toContain(metric.reliability.tier);
          expect(typeof metric.reliability.note).toBe('string');
          expect(metric.reliability.note.length).toBeGreaterThan(10);
        }
      }
    });

    it('should tier AHI and leak as moderate (algorithmically detected / leak-sensitive)', () => {
      expect(metricMap.get('ahi')?.reliability?.tier).toBe('moderate');
      expect(metricMap.get('leak-median')?.reliability?.tier).toBe('moderate');
    });

    it('should tier directly-measured metrics as high', () => {
      expect(metricMap.get('usage-hours')?.reliability?.tier).toBe('high');
      expect(metricMap.get('pressure-mean')?.reliability?.tier).toBe('high');
    });

    it('should tier the central split and RERA-derived RDI as low (modeled)', () => {
      expect(metricMap.get('central-ai')?.reliability?.tier).toBe('low');
      expect(metricMap.get('rdi')?.reliability?.tier).toBe('low');
    });

    it('should keep the central-split note safety-aware (trend still matters)', () => {
      const note = metricMap.get('central-ai')?.reliability?.note ?? '';
      expect(note.toLowerCase()).toContain('trend');
      expect(note.toLowerCase()).toContain('clinician');
    });

    it('should carry no diagnostic or therapy-prescriptive language in reliability notes', () => {
      // Surface, don't diagnose: notes must not assert a diagnosis or prescribe a mode change.
      for (const metric of metricDefinitions) {
        const note = metric.reliability?.note.toLowerCase();
        if (note) {
          expect(note).not.toMatch(/you (have|need)\b/);
          expect(note).not.toMatch(/switch to (asv|bipap)/);
        }
      }
    });
  });
});
