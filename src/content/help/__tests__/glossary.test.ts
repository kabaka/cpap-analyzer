/**
 * Unit tests for glossary content — structure and completeness validation.
 *
 * Ensures every glossary entry has the required fields, no empty strings,
 * and that the collection meets minimum size requirements.
 *
 * @module content/help/__tests__/glossary.test
 */

import { describe, it, expect } from 'vitest';
import {
  glossaryEntries,
  glossaryMap,
  glossaryCategoryOrder,
  GLOSSARY_CATEGORIES,
} from '../glossary';
import type { GlossaryEntry, GlossaryCategory } from '../glossary';

describe('Glossary content', () => {
  describe('glossaryEntries', () => {
    it('should contain at least 50 entries', () => {
      expect(glossaryEntries.length).toBeGreaterThanOrEqual(50);
    });

    it('should have unique ids across all entries', () => {
      const ids = glossaryEntries.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should have unique terms across all entries', () => {
      const terms = glossaryEntries.map((e) => e.term);
      expect(new Set(terms).size).toBe(terms.length);
    });

    it.each(glossaryEntries.map((e) => [e.id, e] as const))(
      'entry "%s" should have all required fields',
      (_id, entry: GlossaryEntry) => {
        expect(entry.id).toBeTruthy();
        expect(entry.term).toBeTruthy();
        expect(entry.category).toBeTruthy();
        expect(entry.quick).toBeTruthy();
        expect(entry.standard).toBeTruthy();
        expect(entry.detailed).toBeTruthy();
      },
    );

    it.each(glossaryEntries.map((e) => [e.id, e] as const))(
      'entry "%s" should have non-empty explanation fields',
      (_id, entry: GlossaryEntry) => {
        expect(entry.quick.length).toBeGreaterThan(10);
        expect(entry.standard.length).toBeGreaterThan(20);
        expect(entry.detailed.length).toBeGreaterThan(50);
      },
    );

    it.each(glossaryEntries.map((e) => [e.id, e] as const))(
      'entry "%s" should have a valid category',
      (_id, entry: GlossaryEntry) => {
        const validCategories: GlossaryCategory[] = [
          'cpap-therapy',
          'sleep-medicine',
          'statistics',
          'data',
        ];
        expect(validCategories).toContain(entry.category);
      },
    );

    it('should cover all four categories', () => {
      const usedCategories = new Set(glossaryEntries.map((e) => e.category));
      expect(usedCategories.has('cpap-therapy')).toBe(true);
      expect(usedCategories.has('sleep-medicine')).toBe(true);
      expect(usedCategories.has('statistics')).toBe(true);
      expect(usedCategories.has('data')).toBe(true);
    });

    it('should have valid relatedTerms references when present', () => {
      const allIds = new Set(glossaryEntries.map((e) => e.id));

      for (const entry of glossaryEntries) {
        if (entry.relatedTerms) {
          for (const ref of entry.relatedTerms) {
            expect(allIds.has(ref), `Entry "${entry.id}" references unknown term "${ref}"`).toBe(
              true,
            );
          }
        }
      }
    });

    it('should have aliases as arrays of non-empty strings when present', () => {
      for (const entry of glossaryEntries) {
        if (entry.aliases) {
          expect(Array.isArray(entry.aliases)).toBe(true);
          for (const alias of entry.aliases) {
            expect(typeof alias).toBe('string');
            expect(alias.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('should have references as arrays of non-empty citation strings when present', () => {
      for (const entry of glossaryEntries) {
        if (entry.references) {
          expect(Array.isArray(entry.references)).toBe(true);
          expect(entry.references.length).toBeGreaterThan(0);
          for (const reference of entry.references) {
            expect(typeof reference).toBe('string');
            // Full citations carry an author/year and substantive text.
            expect(reference.length).toBeGreaterThan(30);
          }
        }
      }
    });

    it('should not contain duplicate citation strings within a single entry', () => {
      for (const entry of glossaryEntries) {
        if (entry.references) {
          expect(
            new Set(entry.references).size,
            `Entry "${entry.id}" has duplicate references`,
          ).toBe(entry.references.length);
        }
      }
    });

    it('should attach references to the core clinical and statistical entries', () => {
      const mustHaveReferences = [
        'ahi',
        'mask-leak',
        'residual-ahi',
        'odi',
        'cheyne-stokes',
        'kaplan-meier',
        'correlation',
        'trend',
        'loess',
      ];
      for (const id of mustHaveReferences) {
        const entry = glossaryMap.get(id);
        expect(entry, `Missing glossary entry "${id}"`).toBeDefined();
        expect(entry?.references?.length, `Entry "${id}" should have references`).toBeGreaterThan(
          0,
        );
      }
    });

    it('should not present the 4% ODI variant as selectable in the ODI entry', () => {
      const odi = glossaryMap.get('odi');
      expect(odi).toBeDefined();
      // The app computes only the 3% ODI; the 4% variant must not be described as configurable.
      expect(odi?.detailed).not.toMatch(/configurable/i);
      expect(odi?.detailed).toContain('computes only the 3% ODI');
    });

    it('should describe the 24 L/min leak threshold as a device convention, not an AASM standard', () => {
      const leak = glossaryMap.get('mask-leak');
      expect(leak).toBeDefined();
      expect(leak?.detailed).toMatch(/not an AASM clinical standard/i);
    });

    it('should not claim a fixed 10–30% device-vs-PSG AHI difference', () => {
      const residual = glossaryMap.get('residual-ahi');
      expect(residual).toBeDefined();
      expect(residual?.detailed).not.toContain('10–30%');
    });

    it('should not present the log-rank test as an app feature in the Kaplan–Meier entry', () => {
      const km = glossaryMap.get('kaplan-meier');
      expect(km).toBeDefined();
      expect(km?.detailed).toMatch(/not currently computed by CPAP Analyzer/i);
    });
  });

  describe('glossaryMap', () => {
    it('should be a Map with the same size as glossaryEntries', () => {
      expect(glossaryMap).toBeInstanceOf(Map);
      expect(glossaryMap.size).toBe(glossaryEntries.length);
    });

    it('should map every entry id to the correct entry', () => {
      for (const entry of glossaryEntries) {
        expect(glossaryMap.get(entry.id)).toBe(entry);
      }
    });

    it('should return undefined for non-existent ids', () => {
      expect(glossaryMap.get('non-existent-id')).toBeUndefined();
    });
  });

  describe('GLOSSARY_CATEGORIES', () => {
    it('should have display names for all four categories', () => {
      expect(GLOSSARY_CATEGORIES['cpap-therapy']).toBe('CPAP Therapy');
      expect(GLOSSARY_CATEGORIES['sleep-medicine']).toBe('Sleep Medicine');
      expect(GLOSSARY_CATEGORIES.statistics).toBe('Statistics');
      expect(GLOSSARY_CATEGORIES.data).toBe('Data & Formats');
    });
  });

  describe('glossaryCategoryOrder', () => {
    it('should list all four categories', () => {
      expect(glossaryCategoryOrder).toHaveLength(4);
      expect(glossaryCategoryOrder).toContain('cpap-therapy');
      expect(glossaryCategoryOrder).toContain('sleep-medicine');
      expect(glossaryCategoryOrder).toContain('statistics');
      expect(glossaryCategoryOrder).toContain('data');
    });
  });
});
