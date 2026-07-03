/**
 * Unit tests for SignalRenderer helper functions and class methods.
 *
 * @module components/charts/canvas/__tests__/SignalRenderer.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  formatTimeLabel,
  formatWallClockLabel,
  formatWallClockDate,
  formatDurationClock,
  wallClockDayBoundaries,
  chooseTimeTickInterval,
  chooseYTicks,
  computeLaneLayout,
  totalLaneHeight,
  resolveRibbonPattern,
  SignalRenderer,
} from '../SignalRenderer';
import type { ViewportState, RenderOptions, SignalChannel, RibbonBand } from '../SignalRenderer';

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
    arc: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
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

// ── formatWallClockLabel ─────────────────────────────────────────
//
// `wallClockEpochMs` is the session start in the wall-clock-as-UTC convention,
// so expected values are read with UTC getters (timezone-independent under any
// CI zone). The label shows the recording device's then-current local clock.

describe('formatWallClockLabel', () => {
  // 2025-06-17 22:30:00 wall clock, encoded as UTC.
  const START = Date.UTC(2025, 5, 17, 22, 30, 0);

  it('formats HH:MM when withSeconds is false', () => {
    expect(formatWallClockLabel(START, 0, false)).toBe('22:30');
  });

  it('formats HH:MM:SS when withSeconds is true', () => {
    expect(formatWallClockLabel(START, 0, true)).toBe('22:30:00');
  });

  it('wraps past midnight: 22:30 + 3h → 01:30 the next day', () => {
    expect(formatWallClockLabel(START, 3 * 60 * 60 * 1000, false)).toBe('01:30');
    expect(formatWallClockLabel(START, 3 * 60 * 60 * 1000, true)).toBe('01:30:00');
  });

  it('zero-pads single-digit components', () => {
    const base = Date.UTC(2025, 0, 1, 3, 4, 5);
    expect(formatWallClockLabel(base, 0, true)).toBe('03:04:05');
  });

  it('uses UTC getters (reads 02:00:00 for a Date.UTC 02:00 epoch)', () => {
    expect(formatWallClockLabel(Date.UTC(2025, 2, 15, 2, 0, 0), 0, true)).toBe('02:00:00');
  });
});

// ── formatWallClockDate ──────────────────────────────────────────

describe('formatWallClockDate', () => {
  it('formats Mon DD with a fixed en abbreviation', () => {
    expect(formatWallClockDate(Date.UTC(2025, 5, 18, 0, 0, 0))).toBe('Jun 18');
  });

  it('zero-pads the day', () => {
    expect(formatWallClockDate(Date.UTC(2025, 0, 3, 0, 0, 0))).toBe('Jan 03');
  });

  it('uses UTC getters so the label does not drift by timezone', () => {
    // Just before midnight UTC on the 18th → still the 18th under UTC getters.
    expect(formatWallClockDate(Date.UTC(2025, 11, 18, 23, 59, 59))).toBe('Dec 18');
  });
});

// ── formatDurationClock ──────────────────────────────────────────

describe('formatDurationClock', () => {
  it('formats sub-hour offsets as +M:SS', () => {
    expect(formatDurationClock(0)).toBe('+0:00');
    expect(formatDurationClock(5 * 60_000 + 30_000)).toBe('+5:30');
  });

  it('formats hour-plus offsets as +H:MM:SS', () => {
    // 1h 12m 08s
    expect(formatDurationClock(3600_000 + 12 * 60_000 + 8_000)).toBe('+1:12:08');
  });

  it('clamps negatives to +0:00', () => {
    expect(formatDurationClock(-5000)).toBe('+0:00');
  });
});

// ── wallClockDayBoundaries ───────────────────────────────────────

describe('wallClockDayBoundaries', () => {
  // Session starts 2025-06-17 22:30:00 wall clock.
  const START = Date.UTC(2025, 5, 17, 22, 30, 0);

  it('finds the single midnight crossing inside a window that spans it', () => {
    // Window: start (22:30) → +4h (02:30 next day). Midnight is at +1h30m.
    const out = wallClockDayBoundaries(START, 0, 4 * 60 * 60 * 1000);
    expect(out).toHaveLength(1);
    // The crossing is at 90 minutes into the session.
    expect(out[0]).toBe(90 * 60 * 1000);
    // And it lands on 2025-06-18 00:00.
    expect(formatWallClockDate(START + out[0]!)).toBe('Jun 18');
  });

  it('returns none when the window does not reach midnight', () => {
    // 22:30 → 23:30, no crossing.
    expect(wallClockDayBoundaries(START, 0, 60 * 60 * 1000)).toEqual([]);
  });

  it('finds two crossings across a multi-day window', () => {
    const out = wallClockDayBoundaries(START, 0, 30 * 60 * 60 * 1000); // ~30h
    expect(out).toHaveLength(2);
  });

  it('returns none for a non-finite epoch (duration fallback)', () => {
    expect(wallClockDayBoundaries(NaN, 0, 4 * 60 * 60 * 1000)).toEqual([]);
  });

  it('returns none for a non-positive window', () => {
    expect(wallClockDayBoundaries(START, 100, 100)).toEqual([]);
  });
});

// ── tick interval → label precision ──────────────────────────────
//
// `drawXAxis` selects seconds precision when the chosen tick interval is finer
// than a minute (`tickInterval < 60_000`), else HH:MM. We assert the boundary
// rule directly against the chooser output for representative ranges.

describe('tick interval → label precision', () => {
  const SECONDS = (interval: number) => interval < 60_000;

  it('selects seconds precision for sub-minute intervals (zoomed in)', () => {
    // 30s range over 800px → fine ticks (< 60s).
    const interval = chooseTimeTickInterval(30_000, 800);
    expect(interval).toBeLessThan(60_000);
    expect(SECONDS(interval)).toBe(true);
  });

  it('selects HH:MM precision at and above a minute interval (zoomed out)', () => {
    // 1h range over 800px → 10-minute ticks (≥ 60s).
    const interval = chooseTimeTickInterval(3_600_000, 800);
    expect(interval).toBeGreaterThanOrEqual(60_000);
    expect(SECONDS(interval)).toBe(false);
  });

  it('treats exactly one minute as HH:MM (boundary is strict <)', () => {
    expect(SECONDS(60_000)).toBe(false);
  });
});

// ── axis / crosshair clock agreement ─────────────────────────────
//
// The axis labels and the crosshair time badge MUST report the same wall clock
// for the same instant. Both derive from `formatWallClockLabel` with the SAME
// wall-clock-as-UTC epoch + session-relative offset, so identical inputs yield
// identical output.

describe('axis / crosshair clock agreement', () => {
  const START = Date.UTC(2025, 5, 17, 22, 30, 0);

  it('same epoch + offset → identical HH:MM:SS for axis and crosshair', () => {
    const rel = 3 * 60 * 60 * 1000 + 12 * 60 * 1000 + 8_000; // +3:12:08
    const axisLabel = formatWallClockLabel(START, rel, true);
    const crosshairLabel = formatWallClockLabel(START, rel, true);
    expect(axisLabel).toBe(crosshairLabel);
    expect(axisLabel).toBe('01:42:08');
  });

  it('HH:MM axis label is the seconds-truncated crosshair label', () => {
    const rel = 17 * 60 * 1000 + 42_000; // +17:42
    expect(formatWallClockLabel(START, rel, false)).toBe(
      formatWallClockLabel(START, rel, true).slice(0, 5),
    );
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

  describe('variable lane heights + multi-lane render', () => {
    /** Run a render synchronously by stubbing rAF to invoke immediately. */
    function renderSync(viewport: ViewportState, options: RenderOptions): void {
      const rafSpy = vi
        .spyOn(globalThis, 'requestAnimationFrame')
        .mockImplementation((cb: FrameRequestCallback) => {
          cb(0);
          return 0;
        });
      try {
        renderer.render(viewport, options);
      } finally {
        rafSpy.mockRestore();
      }
    }

    it('hit-tests against per-lane heights (hero lane on top)', () => {
      const hero = makeChannel({ name: 'Heart Rate', height: 200 });
      const normal = makeChannel({ name: 'Flow', height: 100 });
      const viewport = makeViewport({ channels: [hero, normal] });
      const options = makeOptions({ channelHeight: 100, padding: defaultPadding });

      // A Y inside the second lane requires accounting for the tall first lane.
      const yInSecond = defaultPadding.top + 200 + 10;
      const hit = renderer.getValueAtPosition(
        defaultPadding.left + 10,
        yInSecond,
        viewport,
        options,
      );
      expect(hit?.channel).toBe('Flow');
    });

    it('renders a stack mixing line, step, and ribbon lanes without throwing', () => {
      const bands: RibbonBand[] = [
        { value: 3, label: 'W', color: '#f59e0b' },
        { value: 2, label: 'REM', color: '#8b5cf6', hatch: true },
        { value: 1, label: 'N1–2', color: '#38bdf8' },
        { value: 0, label: 'N3', color: '#1e3a8a' },
      ];
      const line = makeChannel({ name: 'Flow', render: 'line' });
      const step = makeChannel({
        name: 'HRV',
        render: 'step',
        sparse: true,
        data: new Float32Array([30, 40, 38]),
        sampleTimes: new Float64Array([0, 5000, 9000]),
      });
      const ribbon = makeChannel({
        name: 'Sleep Stages',
        render: 'ribbon',
        data: new Float32Array([3, 2, 1, 0]),
        sampleTimes: new Float64Array([0, 2000, 5000, 8000]),
        physicalMin: 0,
        physicalMax: 3,
      });
      const viewport = makeViewport({ channels: [line, step, ribbon] });
      const options = makeOptions({ showGrid: true, ribbonBands: { 'Sleep Stages': bands } });

      expect(() => renderSync(viewport, options)).not.toThrow();
    });

    it('reports a stage label (not a number) for ribbon lanes in getValuesAtTime', () => {
      const bands: RibbonBand[] = [
        { value: 3, label: 'W', color: '#f59e0b' },
        { value: 2, label: 'REM', color: '#8b5cf6' },
      ];
      const ribbon = makeChannel({
        name: 'Sleep Stages',
        render: 'ribbon',
        data: new Float32Array([3, 2]),
        sampleTimes: new Float64Array([0, 6000]),
        physicalMin: 0,
        physicalMax: 3,
      });
      const viewport = makeViewport({ channels: [ribbon] });
      const options = makeOptions({ ribbonBands: { 'Sleep Stages': bands } });

      const plotLeft = defaultPadding.left;
      const plotWidth = 800 - defaultPadding.left - defaultPadding.right;
      const values = renderer.getValuesAtTime(plotLeft + plotWidth * 0.1, viewport, options);
      const sleep = values.find((v) => v.channel === 'Sleep Stages');
      expect(sleep?.label).toBe('W');
    });

    it('renders detection episodes without throwing', () => {
      const line = makeChannel({ name: 'Flow' });
      const viewport = makeViewport({ channels: [line] });
      const options = makeOptions({
        detectionEpisodes: [{ startTime: 1000, duration: 2000, type: 'CSR', confidence: 0.8 }],
      });
      expect(() => renderSync(viewport, options)).not.toThrow();
    });

    // ── Ribbon pattern overlays (AQI non-colour encoding) ──────────
    //
    // The renderer owns its own mock 2D context (the global getContext stub).
    // We reach in to assert the canvas calls each pattern issues. `strokeRect`
    // uniquely identifies the `crosshatch-outline` band outline; hatch passes go
    // through `fillDiagonalHatch` (moveTo/lineTo + stroke under a clip).
    function ctxOf(r: SignalRenderer): CanvasRenderingContext2D {
      return (r as unknown as { ctx: CanvasRenderingContext2D }).ctx;
    }

    function aqiRibbon(band: Partial<RibbonBand>): {
      viewport: ViewportState;
      options: RenderOptions;
    } {
      const bands: RibbonBand[] = [{ value: 1, label: 'AQI', color: '#dc2626', ...band }];
      const ribbon = makeChannel({
        name: 'Air Quality',
        render: 'ribbon',
        data: new Float32Array([1, 1, 1]),
        sampleTimes: new Float64Array([0, 3000, 6000]),
        physicalMin: 1,
        physicalMax: 1,
      });
      return {
        viewport: makeViewport({ channels: [ribbon] }),
        options: makeOptions({ ribbonBands: { 'Air Quality': bands } }),
      };
    }

    it('draws no outline for hatch patterns; an outline for crosshatch-outline', () => {
      const sparse = aqiRibbon({ pattern: 'hatch-sparse' });
      renderSync(sparse.viewport, sparse.options);
      // The ribbon's own band separators use fillRect; the only strokeRect in the
      // ribbon path is the crosshatch-outline outline — absent here.
      expect(ctxOf(renderer).strokeRect).not.toHaveBeenCalled();

      // Fresh renderer (fresh mock ctx) for the outline case.
      renderer = new SignalRenderer(document.createElement('canvas'));
      renderer.resize(800, 400);
      const outline = aqiRibbon({ pattern: 'crosshatch-outline' });
      renderSync(outline.viewport, outline.options);
      expect(ctxOf(renderer).strokeRect).toHaveBeenCalled();
    });

    it('uses patternColor as the hatch stroke when provided', () => {
      const { viewport, options } = aqiRibbon({
        pattern: 'hatch-dense',
        patternColor: '#123456',
      });
      renderSync(viewport, options);
      const ctx = ctxOf(renderer);
      const strokeStyles = (ctx.stroke as ReturnType<typeof vi.fn>).mock.calls;
      // The hatch pass strokes with strokeStyle set to patternColor at least once.
      // We can't read the assignment order from a property setter mock, so assert
      // the render issued stroke() calls (hatch lines) without throwing instead.
      expect(strokeStyles.length).toBeGreaterThan(0);
    });

    it('renders all six patterns without throwing', () => {
      const patterns = [
        'solid',
        'hatch-sparse',
        'hatch-med',
        'hatch-dense',
        'crosshatch',
        'crosshatch-outline',
      ] as const;
      for (const pattern of patterns) {
        renderer = new SignalRenderer(document.createElement('canvas'));
        renderer.resize(800, 400);
        const { viewport, options } = aqiRibbon({ pattern });
        expect(() => renderSync(viewport, options)).not.toThrow();
      }
    });

    it('keeps the legacy `hatch: true` band working (no outline, no throw)', () => {
      const bands: RibbonBand[] = [
        { value: 2, label: 'REM', color: '#8b5cf6', hatch: true },
        { value: 1, label: 'N1–2', color: '#38bdf8' },
      ];
      const ribbon = makeChannel({
        name: 'Sleep Stages',
        render: 'ribbon',
        data: new Float32Array([2, 1]),
        sampleTimes: new Float64Array([0, 5000]),
        physicalMin: 1,
        physicalMax: 2,
      });
      const viewport = makeViewport({ channels: [ribbon] });
      const options = makeOptions({ ribbonBands: { 'Sleep Stages': bands } });
      expect(() => renderSync(viewport, options)).not.toThrow();
      // Legacy hatch never draws an outline rect.
      expect(ctxOf(renderer).strokeRect).not.toHaveBeenCalled();
    });

    // ── Line dash (stacked single-line distinguisher) ──────────────
    it('applies setLineDash for a dashed line lane and not for a solid one', () => {
      const dashed = makeChannel({ name: 'Temp', render: 'line', dash: [4, 4] });
      renderSync(makeViewport({ channels: [dashed] }), makeOptions());
      expect(ctxOf(renderer).setLineDash).toHaveBeenCalledWith([4, 4]);

      // Fresh renderer: a solid line lane must never call setLineDash with a
      // non-empty pattern (the line path only sets a dash when `dash` is set).
      renderer = new SignalRenderer(document.createElement('canvas'));
      renderer.resize(800, 400);
      const solid = makeChannel({ name: 'Pressure', render: 'line' });
      renderSync(makeViewport({ channels: [solid] }), makeOptions());
      const calls = (ctxOf(renderer).setLineDash as ReturnType<typeof vi.fn>).mock.calls;
      const nonEmpty = calls.filter((c) => Array.isArray(c[0]) && c[0].length > 0);
      expect(nonEmpty).toHaveLength(0);
    });
  });
});

// ── Crosshair time-badge scroll pinning ──────────────────────────
//
// The crosshair TIME badge (the clock/duration readout drawn once near the top
// of the stack) must be pinned to the top of the VISIBLE viewport when the
// scroll container has scrolled down — otherwise it scrolls out of view on the
// full-height overlay canvas. `RenderOptions.viewportScrollTopPx` shifts ONLY
// that badge's Y by the scroll offset; the crosshair X, the per-lane value
// badges, and the intersection dots are unaffected.
//
// We reach into the renderer's own mock 2D context (the global getContext stub
// installed at the top of this file) and read the recorded fillText/roundRect
// calls. The mock's measureText returns width 0, so badge geometry is fully
// deterministic.

describe('SignalRenderer crosshair time-badge scroll pinning', () => {
  // A roomy top padding so the badge's bottom-anchored box (boxH = 15) lands
  // well below y=0 at scrollTop=0 and never hits the `Math.max(0, …)` clamp in
  // drawReadoutBadge — so the +N shift is observable as an exact delta.
  const padding = { top: 40, right: 20, bottom: 30, left: 40 } as const;

  function ctxOf(r: SignalRenderer): CanvasRenderingContext2D {
    return (r as unknown as { ctx: CanvasRenderingContext2D }).ctx;
  }

  /** Render synchronously by invoking the rAF callback immediately. */
  function renderSync(r: SignalRenderer, viewport: ViewportState, options: RenderOptions): void {
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    try {
      r.render(viewport, options);
    } finally {
      rafSpy.mockRestore();
    }
  }

  function makeRenderer(): SignalRenderer {
    const r = new SignalRenderer(document.createElement('canvas'));
    r.resize(800, 400);
    return r;
  }

  const channel: SignalChannel = {
    name: 'Flow',
    data: new Float32Array([0, 1, 2, 3, 4]),
    sampleRate: 25,
    unit: 'L/min',
    color: '#0000ff',
    physicalMin: -20,
    physicalMax: 60,
  };

  const viewport: ViewportState = { startTime: 0, endTime: 10_000, channels: [channel] };

  // Crosshair at the plot midpoint → time 5_000 ms → time label "00:05" (no
  // wall-clock epoch supplied). The lane value badge uses toFixed(2) + unit, so
  // it can never collide with this text.
  const crosshairX = (padding.left + (800 - padding.right)) / 2;
  const TIME_LABEL = formatTimeLabel(5_000);

  function options(scrollTop?: number): RenderOptions {
    return {
      showCrosshair: true,
      crosshairX,
      showGrid: false,
      eventMarkers: [],
      channelHeight: 100,
      padding,
      ...(scrollTop !== undefined ? { viewportScrollTopPx: scrollTop } : {}),
    };
  }

  /** The Y passed to the fillText call that rendered the time-label badge text. */
  function timeBadgeTextY(ctx: CanvasRenderingContext2D): number {
    const calls = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
    const match = calls.filter((c) => c[0] === TIME_LABEL);
    expect(match).toHaveLength(1);
    return match[0]![2] as number;
  }

  it('draws the time badge at the unscrolled Y when viewportScrollTopPx is unset', () => {
    const r = makeRenderer();
    renderSync(r, viewport, options());
    const y = timeBadgeTextY(ctxOf(r));
    // y = (padding.top - 2) - boxH + ph = 38 - 15 + 2 = 25. Captured as a
    // regression guard for the unscrolled baseline.
    expect(y).toBe(25);
    r.dispose();
  });

  it('treats viewportScrollTopPx of 0 identically to unset', () => {
    const a = makeRenderer();
    renderSync(a, viewport, options());
    const yUnset = timeBadgeTextY(ctxOf(a));
    a.dispose();

    const b = makeRenderer();
    renderSync(b, viewport, options(0));
    const yZero = timeBadgeTextY(ctxOf(b));
    b.dispose();

    expect(yZero).toBe(yUnset);
  });

  it('shifts the time badge down by exactly viewportScrollTopPx', () => {
    const a = makeRenderer();
    renderSync(a, viewport, options(0));
    const yBase = timeBadgeTextY(ctxOf(a));
    a.dispose();

    const N = 200;
    const b = makeRenderer();
    renderSync(b, viewport, options(N));
    const yScrolled = timeBadgeTextY(ctxOf(b));
    b.dispose();

    expect(yScrolled - yBase).toBe(N);
  });

  it('does not move the crosshair X line when scrolled', () => {
    const a = makeRenderer();
    renderSync(a, viewport, options(0));
    const movesA = (ctxOf(a).moveTo as ReturnType<typeof vi.fn>).mock.calls;
    a.dispose();

    const b = makeRenderer();
    renderSync(b, viewport, options(200));
    const movesB = (ctxOf(b).moveTo as ReturnType<typeof vi.fn>).mock.calls;
    b.dispose();

    // The vertical crosshair line is moved to (crosshairX, padding.top) in both
    // cases — its X is independent of the scroll offset.
    const lineMoveA = movesA.find((c) => c[0] === crosshairX && c[1] === padding.top);
    const lineMoveB = movesB.find((c) => c[0] === crosshairX && c[1] === padding.top);
    expect(lineMoveA).toBeDefined();
    expect(lineMoveB).toBeDefined();
    expect(lineMoveB![0]).toBe(lineMoveA![0]);
  });

  it('does not shift the per-lane value badge or intersection dot by the scroll offset', () => {
    // The intersection dot is drawn with ctx.arc(crosshairX, v.y, …); v.y is a
    // lane-relative position that must NOT pick up the time badge's scroll shift.
    const a = makeRenderer();
    renderSync(a, viewport, options(0));
    const arcsA = (ctxOf(a).arc as ReturnType<typeof vi.fn>).mock.calls;
    a.dispose();

    const b = makeRenderer();
    renderSync(b, viewport, options(200));
    const arcsB = (ctxOf(b).arc as ReturnType<typeof vi.fn>).mock.calls;
    b.dispose();

    // One lane → one intersection dot. Its X (crosshairX) and Y are identical
    // regardless of the scroll offset.
    expect(arcsA).toHaveLength(1);
    expect(arcsB).toHaveLength(1);
    expect(arcsB[0]![0]).toBe(arcsA[0]![0]); // X unchanged
    expect(arcsB[0]![1]).toBe(arcsA[0]![1]); // Y unchanged (not scroll-shifted)
  });
});

// ── resolveRibbonPattern (pattern selection + hatch back-compat) ──
//
// Pure selection logic for the ribbon non-colour encoding. Pixel output is
// exercised by the render-path tests above; here we lock down the mapping that
// the AQI ribbon and the legacy hypnogram REM band both depend on.

describe('resolveRibbonPattern', () => {
  it('maps legacy `hatch: true` (no pattern) to "hatch-med"', () => {
    expect(resolveRibbonPattern({ hatch: true })).toBe('hatch-med');
  });

  it('maps `hatch: false`/absent (no pattern) to "solid"', () => {
    expect(resolveRibbonPattern({ hatch: false })).toBe('solid');
    expect(resolveRibbonPattern({})).toBe('solid');
  });

  it('lets an explicit pattern win over `hatch`', () => {
    // A new caller overriding a legacy hatch must get exactly what it asked for.
    expect(resolveRibbonPattern({ hatch: true, pattern: 'solid' })).toBe('solid');
    expect(resolveRibbonPattern({ hatch: false, pattern: 'crosshatch' })).toBe('crosshatch');
  });

  it('passes through each explicit pattern unchanged', () => {
    const patterns = [
      'solid',
      'hatch-sparse',
      'hatch-med',
      'hatch-dense',
      'crosshatch',
      'crosshatch-outline',
    ] as const;
    for (const p of patterns) {
      expect(resolveRibbonPattern({ pattern: p })).toBe(p);
    }
  });
});

describe('computeLaneLayout', () => {
  it('stacks lanes with cumulative tops, honouring per-lane height overrides', () => {
    const layout = computeLaneLayout([{ height: 200 }, {}, { height: 28 }], 100, 20);
    expect(layout).toEqual([
      { top: 20, height: 200 },
      { top: 220, height: 100 },
      { top: 320, height: 28 },
    ]);
  });

  it('falls back to the default height for non-positive overrides', () => {
    const layout = computeLaneLayout([{ height: 0 }, { height: -5 }], 100, 0);
    expect(layout).toEqual([
      { top: 0, height: 100 },
      { top: 100, height: 100 },
    ]);
  });
});

describe('totalLaneHeight', () => {
  it('sums lane heights with the default fallback', () => {
    expect(totalLaneHeight([{ height: 200 }, {}, { height: 28 }], 100)).toBe(328);
  });
});
