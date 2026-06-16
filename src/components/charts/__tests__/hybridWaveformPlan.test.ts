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

describe('levelToColumnEnvelope (whole-level → band)', () => {
  it('pairs consecutive level elements into per-column min/max', () => {
    // Interleaved extrema sequence: [min0,max0, min1,max1, ...]
    const level = new Float32Array([-2, 5, 1, 3, -7, -1]);
    const env = levelToColumnEnvelope(level);
    expect(env.columns).toBe(3);
    expect(Array.from(env.min)).toEqual([-2, 1, -7]);
    expect(Array.from(env.max)).toEqual([5, 3, -1]);
  });

  it('orders each pair so min ≤ max regardless of temporal order', () => {
    // decimateMinMax emits in temporal order, which can be [max, min].
    const level = new Float32Array([9, -9]);
    const env = levelToColumnEnvelope(level);
    expect(env.min[0]).toBe(-9);
    expect(env.max[0]).toBe(9);
  });

  it('a NaN in a pair yields a gap column (breaks the band)', () => {
    const level = new Float32Array([1, 2, NaN, 4, 5, 6]);
    const env = levelToColumnEnvelope(level);
    expect(env.columns).toBe(3);
    expect(Number.isNaN(env.min[1] as number)).toBe(true);
    expect(Number.isNaN(env.max[1] as number)).toBe(true);
    // Surrounding columns are intact.
    expect(env.max[0]).toBe(2);
    expect(env.min[2]).toBe(5);
  });

  it('drops a lone trailing element (only whole pairs become columns)', () => {
    const env = levelToColumnEnvelope(new Float32Array([1, 2, 3]));
    expect(env.columns).toBe(1);
  });
});

describe('absolute-ms X-step helpers', () => {
  it('per-element ms is factor * msPerSampleBase', () => {
    expect(levelDataXPerElementMs(4, 40)).toBe(160);
    expect(levelDataXPerElementMs(1, 40)).toBe(40);
  });

  it('an envelope column spans two elements (2× per-element ms)', () => {
    expect(envelopeDataXPerColumnMs(4, 40)).toBe(2 * 4 * 40);
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
