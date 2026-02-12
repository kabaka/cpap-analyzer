/**
 * Unit tests for guided tour definitions — structure and completeness validation.
 *
 * Ensures every tour has the required fields, all steps are well-formed,
 * and the tourMap provides correct lookups.
 *
 * @module content/help/__tests__/tours.test
 */

import { describe, it, expect } from 'vitest';
import { guidedTours, tourMap } from '../tours';
import type { GuidedTourDefinition, TourStep } from '../tours';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_POSITIONS: TourStep['position'][] = ['top', 'right', 'bottom', 'left'];

describe('Guided tours', () => {
  describe('guidedTours', () => {
    it('should contain at least 2 tours', () => {
      expect(guidedTours.length).toBeGreaterThanOrEqual(2);
    });

    it('should have unique ids across all tours', () => {
      const ids = guidedTours.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it.each(guidedTours.map((t) => [t.id, t] as const))(
      'tour "%s" should have all required top-level fields',
      (_id, tour: GuidedTourDefinition) => {
        expect(tour.id).toBeTruthy();
        expect(tour.title).toBeTruthy();
        expect(tour.description).toBeTruthy();
        expect(tour.description.length).toBeGreaterThan(10);
      },
    );

    it.each(guidedTours.map((t) => [t.id, t] as const))(
      'tour "%s" should have at least 2 steps',
      (_id, tour: GuidedTourDefinition) => {
        expect(tour.steps.length).toBeGreaterThanOrEqual(2);
      },
    );

    it.each(guidedTours.map((t) => [t.id, t] as const))(
      'tour "%s" should have steps with all required fields',
      (_id, tour: GuidedTourDefinition) => {
        for (const step of tour.steps) {
          expect(step.targetSelector).toBeTruthy();
          expect(step.targetSelector.length).toBeGreaterThan(0);
          expect(step.title).toBeTruthy();
          expect(step.description).toBeTruthy();
          expect(step.description.length).toBeGreaterThan(10);
          expect(VALID_POSITIONS).toContain(step.position);
        }
      },
    );

    it('should have target selectors that look like valid CSS selectors', () => {
      for (const tour of guidedTours) {
        for (const step of tour.steps) {
          // CSS selectors typically start with . # [ or a letter
          expect(step.targetSelector).toMatch(/^[.[#a-zA-Z]/);
        }
      }
    });

    it('should include a getting-started tour', () => {
      const ids = new Set(guidedTours.map((t) => t.id));
      expect(ids.has('getting-started')).toBe(true);
    });
  });

  describe('tourMap', () => {
    it('should be a Map with the same size as guidedTours', () => {
      expect(tourMap).toBeInstanceOf(Map);
      expect(tourMap.size).toBe(guidedTours.length);
    });

    it('should map every tour id to the correct tour', () => {
      for (const tour of guidedTours) {
        expect(tourMap.get(tour.id)).toBe(tour);
      }
    });

    it('should return undefined for non-existent ids', () => {
      expect(tourMap.get('non-existent-tour')).toBeUndefined();
    });

    it('should provide lookup for getting-started tour', () => {
      const tour = tourMap.get('getting-started');
      expect(tour).toBeDefined();
      expect(tour!.title).toBe('Getting Started');
      expect(tour!.steps.length).toBeGreaterThan(0);
    });
  });
});
