/**
 * Unit tests for the pure viewport→channel builder shared by the compact and
 * full Signal Viewers.
 *
 * The focus is the edge-case-heavy mapping that governs what the user sees:
 * viewport-time → base-sample-index math, the degenerate-input bail-outs, and
 * the envelope-vs-polyline fidelity gate (`ENVELOPE_SAMPLES_PER_PIXEL`). Inputs
 * are tiny synthetic Float32Arrays with known values so the assertions are
 * exact, and where a pyramid is needed a minimal real one is built with the
 * production `buildDecimationPyramid`.
 *
 * @module views/Sessions/__tests__/signalChannelBuild.test
 */

import { describe, it, expect } from 'vitest';

import { buildDecimationPyramid } from '@/components/charts/canvas/decimationPyramid';

import {
  CHANNEL_COLORS,
  DEFAULT_CHANNEL_COLOR,
  ENVELOPE_SAMPLES_PER_PIXEL,
  ENVELOPE_SOURCE_OVERSCAN,
  PADDING,
  buildCpapChannelForViewport,
  createLaneScratch,
  resolveColor,
  type BuildCpapChannelInput,
} from '../signalChannelBuild';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A ramp `[0, 1, 2, …, n-1]` — monotone so LTTB/envelope results are readable. */
function ramp(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

function makeInput(overrides: Partial<BuildCpapChannelInput> = {}): BuildCpapChannelInput {
  return {
    name: 'flow',
    data: ramp(4),
    color: '#abcdef',
    unit: 'L/min',
    physicalMin: -60,
    physicalMax: 60,
    totalDurationMs: 4,
    targetPoints: 100,
    plotWidth: 100,
    range: { startTime: 0, endTime: 4 },
    ...overrides,
  };
}

// ===========================================================================
// Shared constants — pin the values both viewers agree on
// ===========================================================================

describe('shared presentation constants', () => {
  it('exposes the palette and fallback colour', () => {
    expect(CHANNEL_COLORS['flow']).toBe('var(--color-chart-1)');
    expect(CHANNEL_COLORS['maskPressure']).toBe('var(--color-chart-2)');
    expect(DEFAULT_CHANNEL_COLOR).toBe('var(--color-chart-7)');
  });

  it('keeps the fidelity-gate constants stable', () => {
    expect(ENVELOPE_SAMPLES_PER_PIXEL).toBe(1);
    expect(ENVELOPE_SOURCE_OVERSCAN).toBe(4);
  });

  it('exposes the canvas padding', () => {
    expect(PADDING).toEqual({ top: 20, right: 24, bottom: 28, left: 56 });
  });
});

// ===========================================================================
// resolveColor
// ===========================================================================

describe('resolveColor', () => {
  it('returns the expression verbatim when no host element is given', () => {
    expect(resolveColor(null, 'var(--color-chart-1)')).toBe('var(--color-chart-1)');
  });

  it('passes an already-resolved colour through unchanged', () => {
    const el = document.createElement('div');
    expect(resolveColor(el, '#ff0000')).toBe('#ff0000');
    expect(resolveColor(el, 'rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
  });

  it('falls back to the var() expression when the custom property is unset', () => {
    const el = document.createElement('div');
    // No stylesheet defines the token, so getComputedStyle yields '' → fallback.
    expect(resolveColor(el, 'var(--totally-unset-token)')).toBe('var(--totally-unset-token)');
  });
});

// ===========================================================================
// createLaneScratch
// ===========================================================================

describe('createLaneScratch', () => {
  it('creates an empty per-lane scratch', () => {
    expect(createLaneScratch()).toEqual({ lttb: null, envelope: null });
  });
});

// ===========================================================================
// buildCpapChannelForViewport — degenerate-input bail-outs
// ===========================================================================

describe('buildCpapChannelForViewport (bail-outs)', () => {
  it('returns null for empty channel data', () => {
    expect(buildCpapChannelForViewport(makeInput({ data: new Float32Array(0) }))).toBeNull();
  });

  it('returns null for a non-positive total duration', () => {
    expect(buildCpapChannelForViewport(makeInput({ totalDurationMs: 0 }))).toBeNull();
    expect(buildCpapChannelForViewport(makeInput({ totalDurationMs: -5 }))).toBeNull();
  });

  it('returns null for a zero-length viewport', () => {
    expect(
      buildCpapChannelForViewport(makeInput({ range: { startTime: 2, endTime: 2 } })),
    ).toBeNull();
  });

  it('returns null for an inverted viewport (end before start)', () => {
    expect(
      buildCpapChannelForViewport(makeInput({ range: { startTime: 3, endTime: 1 } })),
    ).toBeNull();
  });

  it('returns null when the viewport maps to no samples (start beyond the signal)', () => {
    // range starts past the recording → startSample > totalSamples >= endSample.
    const result = buildCpapChannelForViewport(
      makeInput({ range: { startTime: 2000, endTime: 3000 }, totalDurationMs: 1000 }),
    );
    expect(result).toBeNull();
  });
});

// ===========================================================================
// buildCpapChannelForViewport — exact polyline path (no pyramid)
// ===========================================================================

describe('buildCpapChannelForViewport (polyline, no pyramid)', () => {
  it('returns the raw slice verbatim when it already fits the target, with a full channel shape', () => {
    const result = buildCpapChannelForViewport(makeInput());
    expect(result).not.toBeNull();
    // 4 samples, target 100 → no downsampling, exact passthrough.
    expect(Array.from(result!.data)).toEqual([0, 1, 2, 3]);
    expect(result!.envelope).toBeUndefined();
    expect(result!.name).toBe('flow');
    expect(result!.unit).toBe('L/min');
    expect(result!.color).toBe('#abcdef');
    expect(result!.physicalMin).toBe(-60);
    expect(result!.physicalMax).toBe(60);
    expect(result!.kind).toBe('cpap');
    expect(result!.render).toBe('line');
    // effectiveSampleRate = (points / viewDurationMs) * 1000 = (4 / 4) * 1000.
    expect(result!.sampleRate).toBeCloseTo(1000, 6);
  });

  it('maps a sub-window of the viewport to the correct base-sample slice', () => {
    // 8 samples over 8 ms; window [4, 8) → samples index 4..7.
    const result = buildCpapChannelForViewport(
      makeInput({
        data: ramp(8),
        totalDurationMs: 8,
        range: { startTime: 4, endTime: 8 },
      }),
    );
    expect(result).not.toBeNull();
    expect(Array.from(result!.data)).toEqual([4, 5, 6, 7]);
  });

  it('LTTB-downsamples to the target when the slice is larger, without an envelope', () => {
    // 1000 samples, target 20, no pyramid → envelope path is unreachable.
    const result = buildCpapChannelForViewport(
      makeInput({
        data: ramp(1000),
        totalDurationMs: 1000,
        targetPoints: 20,
        plotWidth: 500,
        range: { startTime: 0, endTime: 1000 },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.data.length).toBe(20); // lttbOutLength(1000, 20)
    expect(result!.envelope).toBeUndefined();
    // LTTB always keeps the first and last sample of the ramp.
    expect(result!.data[0]).toBe(0);
    expect(result!.data[result!.data.length - 1]).toBe(999);
  });
});

// ===========================================================================
// buildCpapChannelForViewport — envelope-vs-polyline fidelity gate
// ===========================================================================

describe('buildCpapChannelForViewport (fidelity gate)', () => {
  it('takes the polyline path (no envelope) when the raw span fits the columns', () => {
    // rawSpan (100) is NOT > columns (100) → gate stays closed even with a pyramid.
    const data = ramp(100);
    const pyramid = buildDecimationPyramid(data);
    const result = buildCpapChannelForViewport(
      makeInput({
        data,
        pyramid,
        totalDurationMs: 100,
        targetPoints: 200,
        plotWidth: 100,
        range: { startTime: 0, endTime: 100 },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.envelope).toBeUndefined();
  });

  it('takes the envelope path when the raw span exceeds the columns by one (gate = 1 sample/px)', () => {
    // rawSpan (100) > columns (99) → gate opens; a pyramid is present.
    const data = ramp(100);
    const pyramid = buildDecimationPyramid(data);
    const result = buildCpapChannelForViewport(
      makeInput({
        data,
        pyramid,
        totalDurationMs: 100,
        targetPoints: 200,
        plotWidth: 99,
        range: { startTime: 0, endTime: 100 },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.envelope).toBeDefined();
    expect(result!.envelope!.columns).toBe(99);
    expect(result!.envelope!.min.length).toBe(99);
    expect(result!.envelope!.max.length).toBe(99);
    // Per-column envelope of a ramp: min <= max in every populated column.
    for (let c = 0; c < result!.envelope!.columns; c++) {
      expect(result!.envelope!.min[c]).toBeLessThanOrEqual(result!.envelope!.max[c]!);
    }
  });

  it('does NOT build an envelope when zoomed out but no pyramid is supplied', () => {
    // Same zoomed-out geometry as above but pyramid omitted → gate cannot open.
    const result = buildCpapChannelForViewport(
      makeInput({
        data: ramp(1000),
        totalDurationMs: 1000,
        targetPoints: 20,
        plotWidth: 50,
        range: { startTime: 0, endTime: 1000 },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.envelope).toBeUndefined();
  });

  it('builds a column envelope and an LTTB polyline together on a multi-level pyramid', () => {
    const data = ramp(2000);
    const pyramid = buildDecimationPyramid(data);
    const result = buildCpapChannelForViewport(
      makeInput({
        data,
        pyramid,
        totalDurationMs: 2000,
        targetPoints: 100,
        plotWidth: 50,
        range: { startTime: 0, endTime: 2000 },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.data.length).toBe(100); // LTTB target
    expect(result!.envelope).toBeDefined();
    expect(result!.envelope!.columns).toBe(50); // == round(plotWidth)
    expect(result!.envelope!.min.length).toBe(50);
    // sampleRate = (100 points / 2000 ms) * 1000 = 50 Hz.
    expect(result!.sampleRate).toBeCloseTo(50, 6);
  });

  it('takes the polyline path when zoomed in on a pyramid-backed channel', () => {
    // Narrow window over a large channel → rawSpan < columns → no envelope, and
    // level selection returns raw (level 0) so the slice is exact.
    const data = ramp(2000);
    const pyramid = buildDecimationPyramid(data);
    const result = buildCpapChannelForViewport(
      makeInput({
        data,
        pyramid,
        totalDurationMs: 2000,
        targetPoints: 100,
        plotWidth: 50,
        range: { startTime: 0, endTime: 10 },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.envelope).toBeUndefined();
    expect(Array.from(result!.data)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

// ===========================================================================
// buildCpapChannelForViewport — scratch reuse
// ===========================================================================

describe('buildCpapChannelForViewport (scratch reuse)', () => {
  it('produces output identical to the allocating path when given reusable scratch', () => {
    const input = makeInput({
      data: ramp(1000),
      totalDurationMs: 1000,
      targetPoints: 20,
      plotWidth: 500,
      range: { startTime: 0, endTime: 1000 },
    });
    const withoutScratch = buildCpapChannelForViewport(input);
    const scratch = createLaneScratch();
    const withScratch = buildCpapChannelForViewport(input, scratch);
    expect(withScratch).not.toBeNull();
    expect(Array.from(withScratch!.data)).toEqual(Array.from(withoutScratch!.data));
    // Scratch is populated for reuse on the next frame.
    expect(scratch.lttb).not.toBeNull();
  });

  it('reuses envelope scratch and yields a matching envelope across two builds', () => {
    const data = ramp(2000);
    const pyramid = buildDecimationPyramid(data);
    const input = makeInput({
      data,
      pyramid,
      totalDurationMs: 2000,
      targetPoints: 100,
      plotWidth: 50,
      range: { startTime: 0, endTime: 2000 },
    });
    const reference = buildCpapChannelForViewport(input);
    const scratch = createLaneScratch();
    const first = buildCpapChannelForViewport(input, scratch);
    const second = buildCpapChannelForViewport(input, scratch);
    expect(scratch.envelope).not.toBeNull();
    expect(second).not.toBeNull();
    expect(Array.from(second!.envelope!.min)).toEqual(Array.from(reference!.envelope!.min));
    expect(Array.from(second!.envelope!.max)).toEqual(Array.from(reference!.envelope!.max));
    // The two scratch builds must not alias — double-buffering hands back the
    // OTHER buffer on the second call, so `first`'s view is still intact.
    expect(first!.data).not.toBe(second!.data);
  });
});
