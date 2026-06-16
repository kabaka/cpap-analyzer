/**
 * Unit tests for the pure hybrid-waveform planning logic (ADR 0019, Stage 2).
 *
 * These cover the chrome/waveform split predicate, envelope-vs-line selection,
 * the LOD-change (re-upload) detection, the whole-level → column-envelope
 * reinterpretation, and the absolute-ms X-step helpers — i.e. all the Stage-2
 * decisions that can be proven WITHOUT a GL context (the GL draw itself is
 * validated by the CI pixel-diff gate).
 */

import { describe, expect, it } from 'vitest';

import type { SignalChannel } from '../canvas/SignalRenderer';
import {
  envelopeDataXPerColumnMs,
  isDenseCpapWaveform,
  laneUploadSignature,
  laneValuePerPx,
  levelDataXPerElementMs,
  levelToColumnEnvelope,
  needsReupload,
  uploadSignaturesDiffer,
  waveformModeForChannel,
  type LaneUploadSignature,
} from '../hybridWaveformPlan';

function makeChannel(over: Partial<SignalChannel> = {}): SignalChannel {
  return {
    name: 'Flow',
    data: new Float32Array([1, 2, 3]),
    sampleRate: 25,
    unit: 'L/min',
    color: '#abcdef',
    physicalMin: -60,
    physicalMax: 60,
    kind: 'cpap',
    render: 'line',
    ...over,
  };
}

describe('isDenseCpapWaveform', () => {
  it('is true for a default cpap line lane (defaults applied)', () => {
    expect(isDenseCpapWaveform({})).toBe(true);
    expect(isDenseCpapWaveform({ kind: 'cpap', render: 'line' })).toBe(true);
  });

  it('is false for wearable lanes', () => {
    expect(isDenseCpapWaveform({ kind: 'wearable', render: 'line' })).toBe(false);
  });

  it('is false for step / ribbon / sparse lanes', () => {
    expect(isDenseCpapWaveform({ render: 'step' })).toBe(false);
    expect(isDenseCpapWaveform({ render: 'ribbon' })).toBe(false);
    expect(isDenseCpapWaveform({ render: 'line', sparse: true })).toBe(false);
  });
});

describe('waveformModeForChannel', () => {
  it('returns none for null / non-dense lanes', () => {
    expect(waveformModeForChannel(null)).toBe('none');
    expect(waveformModeForChannel(makeChannel({ kind: 'wearable' }))).toBe('none');
  });

  it('prefers the host-supplied webglLane.mode when present (authoritative)', () => {
    const ch = makeChannel({
      webglLane: {
        mode: 'envelope',
        levelData: new Float32Array([0, 1, 2, 3]),
        levelIndex: 2,
        dataXPerElementMs: 4,
        dataXStartMs: 0,
        plotWidthColumns: 800,
        physRange: 120,
      },
    });
    expect(waveformModeForChannel(ch)).toBe('envelope');
  });

  it('falls back to envelope/line inference when no webglLane (back-compat)', () => {
    const env = makeChannel({
      envelope: { min: new Float32Array([0]), max: new Float32Array([1]), columns: 1 },
    });
    expect(waveformModeForChannel(env)).toBe('envelope');
    expect(waveformModeForChannel(makeChannel())).toBe('line');
    expect(waveformModeForChannel(makeChannel({ data: new Float32Array(0) }))).toBe('none');
  });
});

describe('laneUploadSignature / needsReupload (LOD-change detection)', () => {
  const geom = (over: Partial<NonNullable<SignalChannel['webglLane']>> = {}) =>
    makeChannel({
      webglLane: {
        mode: 'line',
        levelData: new Float32Array([1, 2, 3, 4]),
        levelIndex: 1,
        dataXPerElementMs: 2,
        dataXStartMs: 0,
        plotWidthColumns: 800,
        physRange: 120,
        ...over,
      },
    });

  it('signature is none when no webglLane', () => {
    expect(laneUploadSignature(makeChannel()).mode).toBe('none');
  });

  it('identical geometry → no re-upload (pan/zoom within a level is uniform-only)', () => {
    const a = laneUploadSignature(geom());
    const b = laneUploadSignature(geom());
    expect(uploadSignaturesDiffer(a, b)).toBe(false);
    const prev = new Map([['Flow', a]]);
    const next = new Map([['Flow', b]]);
    expect(needsReupload(prev, next)).toBe(false);
  });

  it('a level change triggers re-upload', () => {
    const a = laneUploadSignature(geom({ levelIndex: 1 }));
    const b = laneUploadSignature(geom({ levelIndex: 2 }));
    expect(uploadSignaturesDiffer(a, b)).toBe(true);
  });

  it('an envelope↔line mode switch triggers re-upload', () => {
    const a = laneUploadSignature(geom({ mode: 'line' }));
    const b = laneUploadSignature(geom({ mode: 'envelope' }));
    expect(uploadSignaturesDiffer(a, b)).toBe(true);
  });

  it('a plot-width (resize) change triggers re-upload', () => {
    const a = laneUploadSignature(geom({ plotWidthColumns: 800 }));
    const b = laneUploadSignature(geom({ plotWidthColumns: 1200 }));
    expect(uploadSignaturesDiffer(a, b)).toBe(true);
  });

  it('a physRange change triggers re-upload in ENVELOPE mode only', () => {
    const envA = laneUploadSignature(geom({ mode: 'envelope', physRange: 120 }));
    const envB = laneUploadSignature(geom({ mode: 'envelope', physRange: 140 }));
    expect(uploadSignaturesDiffer(envA, envB)).toBe(true);

    // Line mode folds physRange to 0 (width is a shader uniform) → no re-upload.
    const lineA = laneUploadSignature(geom({ mode: 'line', physRange: 120 }));
    const lineB = laneUploadSignature(geom({ mode: 'line', physRange: 140 }));
    expect(uploadSignaturesDiffer(lineA, lineB)).toBe(false);
  });

  it('a lane-set change (add/remove) triggers re-upload', () => {
    const sig: LaneUploadSignature = laneUploadSignature(geom());
    const prev = new Map([['Flow', sig]]);
    const next = new Map([
      ['Flow', sig],
      ['Pressure', sig],
    ]);
    expect(needsReupload(prev, next)).toBe(true);
    expect(needsReupload(next, prev)).toBe(true);
  });
});

describe('levelToColumnEnvelope (whole-level → per-pixel-column band)', () => {
  it('reduces a level to exactly the target column count via per-column min/max', () => {
    // 6 elements → 3 columns: each column folds 2 consecutive elements.
    const level = new Float32Array([-2, 5, 1, 3, -7, -1]);
    const env = levelToColumnEnvelope(level, 3);
    expect(env.columns).toBe(3);
    expect(Array.from(env.min)).toEqual([-2, 1, -7]);
    expect(Array.from(env.max)).toEqual([5, 3, -1]);
  });

  it('honours the requested column count regardless of level length', () => {
    // 8 elements → 4 columns: each column folds 2 elements (min/max of the pair).
    const level = new Float32Array([0, 10, -3, 4, 6, 6, -9, -1]);
    const env = levelToColumnEnvelope(level, 4);
    expect(env.columns).toBe(4);
    expect(Array.from(env.max)).toEqual([10, 4, 6, -1]);
    expect(Array.from(env.min)).toEqual([0, -3, 6, -9]);
  });

  it('folds MANY level elements into FEWER columns, keeping each column extreme', () => {
    // 12 elements → 3 columns: each column folds 4 consecutive elements. The
    // per-pixel-column reduction (not 1:2 pairing) is what preserves a spike that
    // would otherwise become a sub-pixel triangle peak at "all" zoom.
    const level = new Float32Array([0, 1, 2, 99, -1, 0, 1, 2, 3, 4, 5, -50]);
    const env = levelToColumnEnvelope(level, 3);
    expect(env.columns).toBe(3);
    // Column 0 = elements 0..3 → max 99 (the spike survives the reduction).
    expect(env.max[0]).toBe(99);
    // Column 2 = elements 8..11 → min -50 (the notch survives too).
    expect(env.min[2]).toBe(-50);
  });

  it('orders each column so min ≤ max regardless of temporal order', () => {
    // decimateMinMax emits in temporal order, which can be [max, min].
    const env = levelToColumnEnvelope(new Float32Array([9, -9]), 1);
    expect(env.min[0]).toBe(-9);
    expect(env.max[0]).toBe(9);
  });

  it('a wholly-NaN column yields a gap column (breaks the band)', () => {
    // 6 elements → 3 columns; column 1 = elements [NaN, NaN] → gap.
    const level = new Float32Array([1, 2, NaN, NaN, 5, 6]);
    const env = levelToColumnEnvelope(level, 3);
    expect(env.columns).toBe(3);
    expect(Number.isNaN(env.min[1] as number)).toBe(true);
    expect(Number.isNaN(env.max[1] as number)).toBe(true);
    // Surrounding columns are intact.
    expect(env.max[0]).toBe(2);
    expect(env.min[2]).toBe(5);
  });

  it('a column straddling a gap edge keeps its real extrema', () => {
    // 4 elements → 2 columns; column 0 = [10, NaN] keeps the real 10.
    const env = levelToColumnEnvelope(new Float32Array([10, NaN, 3, 4]), 2);
    expect(env.min[0]).toBe(10);
    expect(env.max[0]).toBe(10);
  });

  it('returns no columns for a zero target and a NaN-filled band for an empty level', () => {
    expect(levelToColumnEnvelope(new Float32Array([1, 2]), 0).columns).toBe(0);
    const empty = levelToColumnEnvelope(new Float32Array([]), 3);
    expect(empty.columns).toBe(3);
    expect(empty.min.every((v) => Number.isNaN(v))).toBe(true);
  });
});

describe('absolute-ms X-step helpers', () => {
  it('per-element ms is factor * msPerSampleBase', () => {
    expect(levelDataXPerElementMs(4, 40)).toBe(160);
    expect(levelDataXPerElementMs(1, 40)).toBe(40);
  });

  it('an envelope column spans the whole level evenly (wholeLevelSpanMs / columns)', () => {
    // factor 4, msPerSampleBase 40, level of 100 elements → span 16000 ms.
    // Reduced to 50 columns → 320 ms per column.
    expect(envelopeDataXPerColumnMs(4, 40, 100, 50)).toBe((100 * 4 * 40) / 50);
  });

  it('is 0 for a degenerate (zero-column) reduction', () => {
    expect(envelopeDataXPerColumnMs(4, 40, 100, 0)).toBe(0);
  });
});

describe('laneValuePerPx', () => {
  it('is |physRange| / innerHeight', () => {
    const v = laneValuePerPx({
      physicalMin: -60,
      physicalMax: 60,
      stripHeight: 150,
      topInset: 16,
      bottomInset: 8,
    });
    // innerHeight = 150 - 16 - 8 = 126; physRange = 120 → 120/126
    expect(v).toBeCloseTo(120 / 126, 10);
  });

  it('is 0 for a degenerate lane (no Y extent or no inner height)', () => {
    expect(
      laneValuePerPx({
        physicalMin: 5,
        physicalMax: 5,
        stripHeight: 150,
        topInset: 16,
        bottomInset: 8,
      }),
    ).toBe(0);
    expect(
      laneValuePerPx({
        physicalMin: 0,
        physicalMax: 10,
        stripHeight: 20,
        topInset: 16,
        bottomInset: 8,
      }),
    ).toBe(0);
  });
});
