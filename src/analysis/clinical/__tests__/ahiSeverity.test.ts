import { describe, it, expect } from 'vitest';
import {
  AHI_SEVERITY_THRESHOLDS,
  classifyAhiSeverity,
  type AhiSeverity,
  type AhiSeverityThresholds,
} from '../ahiSeverity';

describe('AHI severity', () => {
  describe('AHI_SEVERITY_THRESHOLDS', () => {
    it('pins the AASM / ICSD-3 adult band lower bounds to 5 / 15 / 30', () => {
      expect(AHI_SEVERITY_THRESHOLDS).toEqual({
        mild: 5,
        moderate: 15,
        severe: 30,
      });
    });
  });

  describe('classifyAhiSeverity (default thresholds)', () => {
    it('classifies AHI below 5 as normal', () => {
      expect(classifyAhiSeverity(0)).toBe<AhiSeverity>('normal');
      expect(classifyAhiSeverity(4.999)).toBe<AhiSeverity>('normal');
    });

    it('treats the mild lower bound (5) as inclusive', () => {
      // 5 is NOT normal — the boundary value enters the next band.
      expect(classifyAhiSeverity(5)).toBe<AhiSeverity>('mild');
    });

    it('classifies the open interval [5, 15) as mild', () => {
      expect(classifyAhiSeverity(5)).toBe<AhiSeverity>('mild');
      expect(classifyAhiSeverity(14.999)).toBe<AhiSeverity>('mild');
    });

    it('treats the moderate lower bound (15) as inclusive', () => {
      expect(classifyAhiSeverity(15)).toBe<AhiSeverity>('moderate');
    });

    it('classifies the open interval [15, 30) as moderate', () => {
      expect(classifyAhiSeverity(15)).toBe<AhiSeverity>('moderate');
      expect(classifyAhiSeverity(29.999)).toBe<AhiSeverity>('moderate');
    });

    it('treats the severe lower bound (30) as inclusive', () => {
      expect(classifyAhiSeverity(30)).toBe<AhiSeverity>('severe');
    });

    it('classifies values at or above 30 as severe', () => {
      expect(classifyAhiSeverity(30)).toBe<AhiSeverity>('severe');
      expect(classifyAhiSeverity(50)).toBe<AhiSeverity>('severe');
    });

    // Full boundary sweep documenting the exact "< next threshold" semantics.
    it.each<[number, AhiSeverity]>([
      [0, 'normal'],
      [4.999, 'normal'],
      [5, 'mild'],
      [14.999, 'mild'],
      [15, 'moderate'],
      [29.999, 'moderate'],
      [30, 'severe'],
      [50, 'severe'],
    ])('classifies AHI %d as %s', (ahi, expected) => {
      expect(classifyAhiSeverity(ahi)).toBe(expected);
    });
  });

  describe('classifyAhiSeverity (custom thresholds override)', () => {
    const custom: AhiSeverityThresholds = { mild: 1, moderate: 2, severe: 3 };

    it('reclassifies values using the supplied thresholds, not the defaults', () => {
      // Under default thresholds all of these would be 'normal'; the override
      // must take precedence.
      expect(classifyAhiSeverity(0.5, custom)).toBe<AhiSeverity>('normal');
      expect(classifyAhiSeverity(1, custom)).toBe<AhiSeverity>('mild');
      expect(classifyAhiSeverity(2, custom)).toBe<AhiSeverity>('moderate');
      expect(classifyAhiSeverity(3, custom)).toBe<AhiSeverity>('severe');
      expect(classifyAhiSeverity(100, custom)).toBe<AhiSeverity>('severe');
    });

    it('preserves inclusive-lower-bound semantics for custom thresholds', () => {
      expect(classifyAhiSeverity(0.999, custom)).toBe<AhiSeverity>('normal');
      expect(classifyAhiSeverity(1.999, custom)).toBe<AhiSeverity>('mild');
      expect(classifyAhiSeverity(2.999, custom)).toBe<AhiSeverity>('moderate');
    });

    it('does not mutate AHI_SEVERITY_THRESHOLDS when an override is used', () => {
      classifyAhiSeverity(2, custom);
      expect(AHI_SEVERITY_THRESHOLDS).toEqual({
        mild: 5,
        moderate: 15,
        severe: 30,
      });
    });
  });

  describe('classifyAhiSeverity (edge / non-finite inputs)', () => {
    it('classifies an exact zero as normal', () => {
      expect(classifyAhiSeverity(0)).toBe<AhiSeverity>('normal');
    });

    it('classifies negative inputs as normal (no clamping; below all bounds)', () => {
      // Documents current behavior: -5 < mild, so it falls into the lowest band
      // rather than being rejected.
      expect(classifyAhiSeverity(-1)).toBe<AhiSeverity>('normal');
      expect(classifyAhiSeverity(-1000)).toBe<AhiSeverity>('normal');
    });

    it('classifies NaN as severe because every `<` comparison is false', () => {
      // SURPRISE worth flagging: NaN is not handled explicitly. Each
      // `NaN < threshold` is false, so the function falls through every guard
      // and returns the highest band. A malformed/NaN AHI silently presents as
      // the worst severity.
      expect(classifyAhiSeverity(Number.NaN)).toBe<AhiSeverity>('severe');
    });

    it('classifies +Infinity as severe and -Infinity as normal', () => {
      expect(classifyAhiSeverity(Number.POSITIVE_INFINITY)).toBe<AhiSeverity>('severe');
      expect(classifyAhiSeverity(Number.NEGATIVE_INFINITY)).toBe<AhiSeverity>('normal');
    });
  });
});
