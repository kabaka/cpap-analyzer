import { describe, it, expect } from 'vitest';
import {
  CHART_AXIS_HEADROOM,
  AHI_AXIS_FLOOR,
  LEAK_AXIS_FLOOR,
  USAGE_AXIS_FLOOR,
  computeAxisMax,
} from '../chartScale';

describe('chart axis scale', () => {
  describe('display constants', () => {
    it('pins the headroom multiplier to 1.1 (10% above the peak)', () => {
      expect(CHART_AXIS_HEADROOM).toBe(1.1);
    });

    it('pins the per-chart y-axis floors', () => {
      expect(AHI_AXIS_FLOOR).toBe(10);
      expect(LEAK_AXIS_FLOOR).toBe(30);
      expect(USAGE_AXIS_FLOOR).toBe(8);
    });
  });

  describe('computeAxisMax', () => {
    it('returns the floor when the scaled data max is below it', () => {
      // 5 * 1.1 = 5.5 < 30 → floor wins.
      expect(computeAxisMax(5, 30)).toBe(30);
    });

    it('returns the scaled data max when it exceeds the floor', () => {
      // 100 * 1.1 = 110 > 30 → headroom-scaled data wins.
      expect(computeAxisMax(100, 30)).toBeCloseTo(110);
    });

    it('uses the floor exactly when the scaled data max equals it', () => {
      // dataMax * 1.1 == floor (e.g. floor 11, dataMax 10 → 11).
      expect(computeAxisMax(10, 11)).toBeCloseTo(11);
    });

    it('respects a custom headroom multiplier', () => {
      // 100 * 1.5 = 150 > 10 → custom headroom applied.
      expect(computeAxisMax(100, 10, 1.5)).toBeCloseTo(150);
    });

    it('falls back to the floor when a custom headroom keeps data below it', () => {
      // 100 * 0.1 = 10 < 50 → floor wins despite a large data max.
      expect(computeAxisMax(100, 50, 0.1)).toBe(50);
    });

    it('returns the floor for a zero data max', () => {
      expect(computeAxisMax(0, 30)).toBe(30);
    });

    it('returns the floor for a negative data max', () => {
      // -10 * 1.1 = -11 < 30 → floor wins (axis never goes negative via this path).
      expect(computeAxisMax(-10, 30)).toBe(30);
    });
  });

  describe('computeAxisMax with the real chart floors', () => {
    it('lifts a quiet leak night to the leak floor of 30', () => {
      // 10 * 1.1 = 11 < 30 → floor.
      expect(computeAxisMax(10, LEAK_AXIS_FLOOR)).toBe(30);
    });

    it('scales a busy leak night above the leak floor', () => {
      // 50 * 1.1 = 55 > 30 → headroom-scaled.
      expect(computeAxisMax(50, LEAK_AXIS_FLOOR)).toBeCloseTo(55);
    });

    it('lifts a quiet AHI night to the AHI floor of 10', () => {
      // 4 * 1.1 = 4.4 < 10 → floor keeps severity zones visible.
      expect(computeAxisMax(4, AHI_AXIS_FLOOR)).toBe(10);
    });

    it('lifts a short usage night to the usage floor of 8', () => {
      // 5 * 1.1 = 5.5 < 8 → floor keeps the 4h/6h reference lines in view.
      expect(computeAxisMax(5, USAGE_AXIS_FLOOR)).toBe(8);
    });
  });
});
