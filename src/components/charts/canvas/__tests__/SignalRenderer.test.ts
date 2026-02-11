/**
 * Unit tests for SignalRenderer helper functions and class methods.
 *
 * @module components/charts/canvas/__tests__/SignalRenderer.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  formatTimeLabel,
  chooseTimeTickInterval,
  chooseYTicks,
  SignalRenderer,
} from '../SignalRenderer';
import type { ViewportState, RenderOptions, SignalChannel } from '../SignalRenderer';

// ── Canvas mock for jsdom ────────────────────────────────────────

/** Minimal CanvasRenderingContext2D stub for unit tests. */
function createMockContext2D(): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    roundRect: vi.fn(),
    fill: vi.fn(),
    clearRect: vi.fn(),
    canvas: document.createElement('canvas'),
    getContextAttributes: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

// Patch HTMLCanvasElement.getContext so jsdom returns our mock
const originalGetContext = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
    return createMockContext2D();
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  return () => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  };
});

// ── formatTimeLabel ──────────────────────────────────────────────

describe('formatTimeLabel', () => {
  it('should format 0 ms as 00:00', () => {
    expect(formatTimeLabel(0)).toBe('00:00');
  });

  it('should format seconds-only as MM:SS', () => {
    // 45 seconds = 45_000 ms
    expect(formatTimeLabel(45_000)).toBe('00:45');
  });

  it('should format minutes and seconds as MM:SS', () => {
    // 5 minutes 30 seconds = 330_000 ms
    expect(formatTimeLabel(330_000)).toBe('05:30');
  });

  it('should format hours as HH:MM:SS', () => {
    // 1 hour 23 minutes 45 seconds
    expect(formatTimeLabel(5_025_000)).toBe('01:23:45');
  });

  it('should pad single-digit values with leading zeros', () => {
    // 1 hour 2 minutes 3 seconds
    expect(formatTimeLabel(3_723_000)).toBe('01:02:03');
  });

  it('should format exactly one hour', () => {
    expect(formatTimeLabel(3_600_000)).toBe('01:00:00');
  });

  it('should handle sub-second values (floored to 0)', () => {
    expect(formatTimeLabel(500)).toBe('00:00');
  });

  it('should handle 59 minutes 59 seconds without hour prefix', () => {
    expect(formatTimeLabel(3_599_000)).toBe('59:59');
  });
});

// ── chooseTimeTickInterval ───────────────────────────────────────

describe('chooseTimeTickInterval', () => {
  it('should return 1s interval for small ranges at wide widths', () => {
    // 5 seconds range, 800px → maxTicks=10, rawInterval=500ms → snaps to 1000
    expect(chooseTimeTickInterval(5_000, 800)).toBe(1_000);
  });

  it('should return larger interval for wider time ranges', () => {
    // 1 hour range, 800px → maxTicks=10, rawInterval=360_000ms → snaps to 600_000 (10min)
    const interval = chooseTimeTickInterval(3_600_000, 800);
    expect(interval).toBeGreaterThanOrEqual(300_000);
    expect(interval).toBeLessThanOrEqual(900_000);
  });

  it('should return 1min for a 10-minute range with moderate width', () => {
    // 10 min range, 800px → maxTicks=10, rawInterval=60_000 → snaps to 60_000
    expect(chooseTimeTickInterval(600_000, 800)).toBe(60_000);
  });

  it('should return a value from the nice intervals list', () => {
    const niceIntervals = [
      1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000,
      1_800_000, 3_600_000, 7_200_000, 14_400_000, 28_800_000,
    ];
    const result = chooseTimeTickInterval(30_000, 400);
    expect(niceIntervals).toContain(result);
  });

  it('should handle very small available width (few ticks)', () => {
    // Very narrow: 160px → maxTicks=2, rawInterval=30_000 → snaps to 30_000
    const result = chooseTimeTickInterval(60_000, 160);
    expect(result).toBeGreaterThanOrEqual(30_000);
  });

  it('should return the largest nice interval for very large ranges', () => {
    const result = chooseTimeTickInterval(86_400_000 * 365, 800);
    expect(result).toBe(28_800_000);
  });
});

// ── chooseYTicks ─────────────────────────────────────────────────

describe('chooseYTicks', () => {
  it('should return at least physMin and physMax for degenerate input', () => {
    const result = chooseYTicks(0, 0, 5);
    expect(result).toEqual([0, 0]);
  });

  it('should handle maxTicks < 2', () => {
    expect(chooseYTicks(0, 10, 1)).toEqual([0, 10]);
  });

  it('should produce evenly spaced ticks', () => {
    const ticks = chooseYTicks(0, 100, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    // Check spacing is consistent
    const diffs = ticks.slice(1).map((v, i) => v - ticks[i]!);
    const step = diffs[0]!;
    for (const d of diffs) {
      expect(d).toBeCloseTo(step);
    }
  });

  it('should produce ticks within the physical range', () => {
    const ticks = chooseYTicks(-50, 50, 10);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(-50);
      expect(t).toBeLessThanOrEqual(50);
    }
  });

  it('should use nice step sizes (multiples of 1, 2, 5, 10)', () => {
    const ticks = chooseYTicks(0, 100, 5);
    if (ticks.length >= 2) {
      const step = ticks[1]! - ticks[0]!;
      // Normalize step to [1, 10) range
      const magnitude = Math.pow(10, Math.floor(Math.log10(step)));
      const normalized = step / magnitude;
      expect([1, 2, 5, 10]).toContain(normalized);
    }
  });

  it('should handle small fractional ranges', () => {
    const ticks = chooseYTicks(0.1, 0.5, 4);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(0.1);
      expect(t).toBeLessThanOrEqual(0.5);
    }
  });

  it('should handle negative ranges', () => {
    const ticks = chooseYTicks(-100, -10, 5);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(-100);
      expect(t).toBeLessThanOrEqual(-10);
    }
  });
});

// ── SignalRenderer class ─────────────────────────────────────────

describe('SignalRenderer', () => {
  let canvas: HTMLCanvasElement;
  let renderer: SignalRenderer;

  const defaultPadding = { top: 10, right: 20, bottom: 30, left: 40 };

  function makeViewport(overrides?: Partial<ViewportState>): ViewportState {
    return {
      startTime: 0,
      endTime: 10_000,
      channels: [],
      ...overrides,
    };
  }

  function makeOptions(overrides?: Partial<RenderOptions>): RenderOptions {
    return {
      showCrosshair: false,
      crosshairX: null,

      showGrid: false,
      eventMarkers: [],
      channelHeight: 100,
      padding: defaultPadding,
      ...overrides,
    };
  }

  function makeChannel(overrides?: Partial<SignalChannel>): SignalChannel {
    return {
      name: 'Flow',
      data: new Float32Array([0, 1, 2, 3, 4]),
      sampleRate: 25,
      unit: 'L/min',
      color: '#0000ff',
      physicalMin: -20,
      physicalMax: 60,
      ...overrides,
    };
  }

  beforeEach(() => {
    canvas = document.createElement('canvas');
    renderer = new SignalRenderer(canvas);
    renderer.resize(800, 400);
  });

  describe('getTimeAtX', () => {
    it('should return startTime at the left padding edge', () => {
      const viewport = makeViewport({ startTime: 1000, endTime: 11_000 });
      const options = makeOptions();

      const time = renderer.getTimeAtX(defaultPadding.left, viewport, options);
      expect(time).toBeCloseTo(1000);
    });

    it('should return endTime at the right edge of the plot area', () => {
      const viewport = makeViewport({ startTime: 0, endTime: 10_000 });
      const options = makeOptions();

      const plotRight = 800 - defaultPadding.right;
      const time = renderer.getTimeAtX(plotRight, viewport, options);
      expect(time).toBeCloseTo(10_000);
    });

    it('should return midpoint time at the center of the plot area', () => {
      const viewport = makeViewport({ startTime: 0, endTime: 10_000 });
      const options = makeOptions();

      const plotLeft = defaultPadding.left;
      const plotRight = 800 - defaultPadding.right;
      const center = (plotLeft + plotRight) / 2;
      const time = renderer.getTimeAtX(center, viewport, options);
      expect(time).toBeCloseTo(5_000);
    });

    it('should extrapolate beyond plot boundaries', () => {
      const viewport = makeViewport({ startTime: 0, endTime: 10_000 });
      const options = makeOptions();

      // X = 0 is before the plot area
      const time = renderer.getTimeAtX(0, viewport, options);
      expect(time).toBeLessThan(0);
    });

    it('should return startTime when plot width is zero', () => {
      const viewport = makeViewport({ startTime: 5000, endTime: 10_000 });
      // Padding that consumes all width
      const options = makeOptions({ padding: { top: 0, right: 400, bottom: 0, left: 400 } });
      const time = renderer.getTimeAtX(400, viewport, options);
      expect(time).toBe(5000);
    });
  });

  describe('getValueAtPosition', () => {
    it('should return null when position is outside all channel strips', () => {
      const ch = makeChannel();
      const viewport = makeViewport({ channels: [ch] });
      const options = makeOptions();

      // Y way below the only channel strip
      const result = renderer.getValueAtPosition(100, 500, viewport, options);
      expect(result).toBeNull();
    });

    it('should return the correct channel name when in a channel strip', () => {
      const ch = makeChannel({ name: 'MaskPressure' });
      const viewport = makeViewport({ channels: [ch] });
      const options = makeOptions();

      // Y within the first channel strip: padding.top (10) to padding.top + channelHeight (110)
      const result = renderer.getValueAtPosition(
        defaultPadding.left + 100,
        defaultPadding.top + 50,
        viewport,
        options,
      );
      expect(result).not.toBeNull();
      expect(result!.channel).toBe('MaskPressure');
    });

    it('should return a time value within the viewport range', () => {
      const ch = makeChannel();
      const viewport = makeViewport({ startTime: 0, endTime: 10_000, channels: [ch] });
      const options = makeOptions();

      const result = renderer.getValueAtPosition(
        defaultPadding.left + 200,
        defaultPadding.top + 50,
        viewport,
        options,
      );
      expect(result).not.toBeNull();
      expect(result!.time).toBeGreaterThanOrEqual(0);
      expect(result!.time).toBeLessThanOrEqual(10_000);
    });

    it('should return correct value for second channel in multi-channel viewport', () => {
      const ch1 = makeChannel({ name: 'Flow' });
      const ch2 = makeChannel({ name: 'Leak', physicalMin: 0, physicalMax: 100 });
      const viewport = makeViewport({ channels: [ch1, ch2] });
      const options = makeOptions();

      // Second channel strip starts at padding.top + channelHeight = 110
      const result = renderer.getValueAtPosition(
        defaultPadding.left + 200,
        defaultPadding.top + options.channelHeight + 50,
        viewport,
        options,
      );
      expect(result).not.toBeNull();
      expect(result!.channel).toBe('Leak');
    });

    it('should return null when plot width is zero', () => {
      const ch = makeChannel();
      const viewport = makeViewport({ channels: [ch] });
      const options = makeOptions({ padding: { top: 0, right: 400, bottom: 0, left: 400 } });
      const result = renderer.getValueAtPosition(400, 50, viewport, options);
      expect(result).toBeNull();
    });

    it('should return null when time is outside viewport', () => {
      const ch = makeChannel();
      const viewport = makeViewport({ startTime: 1000, endTime: 5000, channels: [ch] });
      const options = makeOptions();

      // X far to the left => time before startTime
      const result = renderer.getValueAtPosition(-100, defaultPadding.top + 50, viewport, options);
      expect(result).toBeNull();
    });
  });

  describe('getValuesAtTime', () => {
    it('should return values for all channels at a given X position', () => {
      const ch1 = makeChannel({ name: 'Flow', unit: 'L/min', color: '#ff0000' });
      const ch2 = makeChannel({
        name: 'Leak',
        unit: 'L/min',
        color: '#00ff00',
        physicalMin: 0,
        physicalMax: 100,
        data: new Float32Array([10, 20, 30, 40, 50]),
      });
      const viewport = makeViewport({ channels: [ch1, ch2] });
      const options = makeOptions();

      // Pick an X in the middle of the plot area
      const plotLeft = defaultPadding.left;
      const plotRight = 800 - defaultPadding.right;
      const midX = (plotLeft + plotRight) / 2;

      const results = renderer.getValuesAtTime(midX, viewport, options);
      expect(results).toHaveLength(2);
      expect(results[0]!.channel).toBe('Flow');
      expect(results[0]!.unit).toBe('L/min');
      expect(results[0]!.color).toBe('#ff0000');
      expect(typeof results[0]!.value).toBe('number');
      expect(typeof results[0]!.y).toBe('number');
      expect(results[1]!.channel).toBe('Leak');
      expect(results[1]!.unit).toBe('L/min');
      expect(results[1]!.color).toBe('#00ff00');
    });

    it('should return empty array for empty viewport / no channels', () => {
      const viewport = makeViewport({ channels: [] });
      const options = makeOptions();

      const results = renderer.getValuesAtTime(400, viewport, options);
      expect(results).toEqual([]);
    });

    it('should return empty array when durationMs <= 0', () => {
      const ch = makeChannel();
      const viewport = makeViewport({ startTime: 5000, endTime: 5000, channels: [ch] });
      const options = makeOptions();

      const results = renderer.getValuesAtTime(400, viewport, options);
      expect(results).toEqual([]);
    });

    it('should skip channels with empty data', () => {
      const ch1 = makeChannel({ name: 'Flow' });
      const ch2 = makeChannel({
        name: 'EmptyChannel',
        data: new Float32Array(0),
      });
      const ch3 = makeChannel({ name: 'Leak', physicalMin: 0, physicalMax: 100 });
      const viewport = makeViewport({ channels: [ch1, ch2, ch3] });
      const options = makeOptions();

      const plotLeft = defaultPadding.left;
      const plotRight = 800 - defaultPadding.right;
      const midX = (plotLeft + plotRight) / 2;

      const results = renderer.getValuesAtTime(midX, viewport, options);
      // ch2 has empty data, so should be skipped
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.channel)).toEqual(['Flow', 'Leak']);
    });

    it('should return empty results for out-of-range X position', () => {
      const ch = makeChannel();
      const viewport = makeViewport({ startTime: 1000, endTime: 5000, channels: [ch] });
      const options = makeOptions();

      // X far to the left — maps to time well before startTime; sampleIdx will be negative
      const results = renderer.getValuesAtTime(-500, viewport, options);
      expect(results).toEqual([]);
    });

    it('should return correct Y position within the channel strip', () => {
      // A channel with data at the midpoint of its physical range
      const midValue = 20; // midpoint of -20..60
      const ch = makeChannel({
        data: new Float32Array([midValue, midValue, midValue, midValue, midValue]),
      });
      const viewport = makeViewport({ channels: [ch] });
      const options = makeOptions();

      const plotLeft = defaultPadding.left;
      const plotRight = 800 - defaultPadding.right;
      const midX = (plotLeft + plotRight) / 2;

      const results = renderer.getValuesAtTime(midX, viewport, options);
      expect(results).toHaveLength(1);

      // Y should be within the channel strip area
      const stripTop = defaultPadding.top;
      const stripBottom = stripTop + options.channelHeight;
      expect(results[0]!.y).toBeGreaterThanOrEqual(stripTop);
      expect(results[0]!.y).toBeLessThanOrEqual(stripBottom);
    });
  });

  describe('resize', () => {
    it('should set canvas dimensions accounting for devicePixelRatio', () => {
      // jsdom has devicePixelRatio = 1 by default
      renderer.resize(600, 300);
      expect(canvas.width).toBe(600);
      expect(canvas.height).toBe(300);
      expect(canvas.style.width).toBe('600px');
      expect(canvas.style.height).toBe('300px');
    });
  });

  describe('dispose', () => {
    it('should not throw when called multiple times', () => {
      expect(() => {
        renderer.dispose();
        renderer.dispose();
      }).not.toThrow();
    });
  });
});
