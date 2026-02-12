/**
 * Unit tests for report types — template definitions and section presets.
 *
 * Validates the structure and completeness of REPORT_TEMPLATES,
 * PHYSICIAN_SUMMARY_SECTIONS, FULL_ANALYSIS_SECTIONS, and CUSTOM_DEFAULT_SECTIONS.
 *
 * @module services/reports/__tests__/types.test
 */

import { describe, it, expect } from 'vitest';
import {
  REPORT_TEMPLATES,
  PHYSICIAN_SUMMARY_SECTIONS,
  FULL_ANALYSIS_SECTIONS,
  CUSTOM_DEFAULT_SECTIONS,
} from '../types';
import type { ReportSections, TemplateInfo } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All section keys that a ReportSections object must have. */
const ALL_SECTION_KEYS: (keyof ReportSections)[] = [
  'summaryStatistics',
  'sessionDetails',
  'ahiTrend',
  'leakAnalysis',
  'pressureMetrics',
  'eventBreakdown',
  'complianceReport',
  'usagePatterns',
];

function assertValidSections(sections: ReportSections): void {
  for (const key of ALL_SECTION_KEYS) {
    expect(typeof sections[key]).toBe('boolean');
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Report types', () => {
  describe('REPORT_TEMPLATES', () => {
    it('should contain exactly 3 templates', () => {
      expect(REPORT_TEMPLATES).toHaveLength(3);
    });

    it('should include physician-summary, full-analysis, and custom', () => {
      const ids = REPORT_TEMPLATES.map((t) => t.id);
      expect(ids).toContain('physician-summary');
      expect(ids).toContain('full-analysis');
      expect(ids).toContain('custom');
    });

    it.each(REPORT_TEMPLATES)('template "$name" should have all required fields', (template) => {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.description.length).toBeGreaterThan(10);
      assertValidSections(template.defaultSections);
    });

    it('each template should have a unique id', () => {
      const ids = REPORT_TEMPLATES.map((t: TemplateInfo) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('PHYSICIAN_SUMMARY_SECTIONS', () => {
    it('should have all section keys as booleans', () => {
      assertValidSections(PHYSICIAN_SUMMARY_SECTIONS);
    });

    it('should include summaryStatistics and complianceReport', () => {
      expect(PHYSICIAN_SUMMARY_SECTIONS.summaryStatistics).toBe(true);
      expect(PHYSICIAN_SUMMARY_SECTIONS.complianceReport).toBe(true);
    });

    it('should include ahiTrend and pressureMetrics', () => {
      expect(PHYSICIAN_SUMMARY_SECTIONS.ahiTrend).toBe(true);
      expect(PHYSICIAN_SUMMARY_SECTIONS.pressureMetrics).toBe(true);
    });

    it('should exclude sessionDetails and leakAnalysis', () => {
      expect(PHYSICIAN_SUMMARY_SECTIONS.sessionDetails).toBe(false);
      expect(PHYSICIAN_SUMMARY_SECTIONS.leakAnalysis).toBe(false);
    });
  });

  describe('FULL_ANALYSIS_SECTIONS', () => {
    it('should have all section keys as booleans', () => {
      assertValidSections(FULL_ANALYSIS_SECTIONS);
    });

    it('should enable ALL sections', () => {
      for (const key of ALL_SECTION_KEYS) {
        expect(FULL_ANALYSIS_SECTIONS[key]).toBe(true);
      }
    });
  });

  describe('CUSTOM_DEFAULT_SECTIONS', () => {
    it('should have all section keys as booleans', () => {
      assertValidSections(CUSTOM_DEFAULT_SECTIONS);
    });

    it('should enable only summaryStatistics by default', () => {
      expect(CUSTOM_DEFAULT_SECTIONS.summaryStatistics).toBe(true);

      const otherKeys = ALL_SECTION_KEYS.filter((k) => k !== 'summaryStatistics');
      for (const key of otherKeys) {
        expect(CUSTOM_DEFAULT_SECTIONS[key]).toBe(false);
      }
    });
  });
});
