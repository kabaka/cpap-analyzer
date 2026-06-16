/**
 * Unit tests for the triangle-strip envelope geometry.
 *
 * Mirrors the Canvas2D `drawEnvelope` contract: two vertices per non-gap column
 * at the column centre (`c + 0.5`), the min-thickness clamp that makes a thin
 * band read as ~1.2 px, NaN columns breaking runs into separate strips via
 * primitive-restart sentinels, and — critically for health data — a 1-sample
 * spike column reaching its extreme value (extrema-preservation contract).
 *
 * @module components/charts/webgl/__tests__/envelopeGeometry.test
 */

import { describe, it, expect } from 'vitest';
import {
  buildEnvelopeGeometry,
  DENSE_LINE_WIDTH,
  PRIMITIVE_RESTART_INDEX,
  ENVELOPE_VERTEX_STRIDE,
  type ColumnEnvelopeInput,
  type EnvelopeGeometryParams,
} from '../envelopeGeometry';

function env(min: number[], max: number[]): ColumnEnvelopeInput {
  return {
    min: new Float32Array(min),
    max: new Float32Array(max),
    columns: min.length,
  };
}

const params: EnvelopeGeometryParams = {
  dataXStart: 0,
  dataXPerColumn: 10,
  valuePerPx: 0, // no clamp unless a test overrides; isolates raw extrema
};

/** Read a vertex `[x, y]` by vertex index from the interleaved buffer. */
function vertexAt(vertices: Float32Array, i: number): { x: number; y: number } {
  return {
    x: vertices[i * ENVELOPE_VERTEX_STRIDE] as number,
    y: vertices[i * ENVELOPE_VERTEX_STRIDE + 1] as number,
  };
}

describe('buildEnvelopeGeometry — vertex layout', () => {
  it('emits two vertices per non-gap column (upper=max, lower=min)', () => {
    const geo = buildEnvelopeGeometry(env([-1, -2, -3], [1, 2, 3]), params);
    expect(geo.vertexCount).toBe(6); // 3 cols × 2
    expect(geo.vertices.length).toBe(6 * ENVELOPE_VERTEX_STRIDE);
    // Column 0: upper then lower.
    expect(vertexAt(geo.vertices, 0).y).toBe(1); // max
    expect(vertexAt(geo.vertices, 1).y).toBe(-1); // min
  });

  it('places each column centre at dataXStart + (c + 0.5) * dataXPerColumn', () => {
    const geo = buildEnvelopeGeometry(env([0, 0, 0], [0, 0, 0]), {
      ...params,
      dataXStart: 100,
      dataXPerColumn: 4,
      valuePerPx: 0,
    });
    expect(vertexAt(geo.vertices, 0).x).toBeCloseTo(102, 6); // 100 + 0.5*4
    expect(vertexAt(geo.vertices, 2).x).toBeCloseTo(106, 6); // 100 + 1.5*4
    expect(vertexAt(geo.vertices, 4).x).toBeCloseTo(110, 6); // 100 + 2.5*4
  });

  it('index order walks upper,lower per column (band triangulation)', () => {
    const geo = buildEnvelopeGeometry(env([-1, -1], [1, 1]), params);
    expect([...geo.indices]).toEqual([0, 1, 2, 3]);
  });
});

describe('buildEnvelopeGeometry — min-thickness clamp', () => {
  it('widens a flat column to ~DENSE_LINE_WIDTH in value space', () => {
    const valuePerPx = 0.5; // 1 value unit per 2 px ⇒ minValueSpan = 1.2*0.5 = 0.6
    const geo = buildEnvelopeGeometry(env([10], [10]), { ...params, valuePerPx });
    const upper = vertexAt(geo.vertices, 0).y;
    const lower = vertexAt(geo.vertices, 1).y;
    expect(upper - lower).toBeCloseTo(DENSE_LINE_WIDTH * valuePerPx, 6);
    // Symmetric about the original midpoint.
    expect((upper + lower) / 2).toBeCloseTo(10, 6);
  });

  it('does NOT narrow a band already taller than the clamp (spike untouched)', () => {
    const valuePerPx = 0.5; // minValueSpan = 0.6
    const geo = buildEnvelopeGeometry(env([-50], [50]), { ...params, valuePerPx });
    expect(vertexAt(geo.vertices, 0).y).toBe(50); // max preserved exactly
    expect(vertexAt(geo.vertices, 1).y).toBe(-50); // min preserved exactly
  });

  it('with valuePerPx 0 the clamp is inert (raw extrema)', () => {
    const geo = buildEnvelopeGeometry(env([3], [3]), { ...params, valuePerPx: 0 });
    expect(vertexAt(geo.vertices, 0).y).toBe(3);
    expect(vertexAt(geo.vertices, 1).y).toBe(3);
  });
});

describe('buildEnvelopeGeometry — gap handling (primitive restart)', () => {
  it('breaks runs at a NaN column with a restart sentinel between strips', () => {
    // cols: real, real, GAP, real
    const geo = buildEnvelopeGeometry(env([0, 0, NaN, 0], [1, 1, NaN, 1]), params);
    expect(geo.runCount).toBe(2);
    expect(geo.vertexCount).toBe(6); // 3 real cols × 2
    // Expect: u0,l0,u1,l1, RESTART, u2,l2
    expect([...geo.indices]).toEqual([0, 1, 2, 3, PRIMITIVE_RESTART_INDEX, 4, 5]);
  });

  it('does not emit a sentinel before the first run', () => {
    const geo = buildEnvelopeGeometry(env([NaN, 0, 0], [NaN, 1, 1]), params);
    expect(geo.runCount).toBe(1);
    expect(geo.indices[0]).not.toBe(PRIMITIVE_RESTART_INDEX);
    expect([...geo.indices]).toEqual([0, 1, 2, 3]);
  });

  it('handles multiple consecutive gap columns as a single break', () => {
    const geo = buildEnvelopeGeometry(env([0, NaN, NaN, 0], [1, NaN, NaN, 1]), params);
    expect(geo.runCount).toBe(2);
    expect([...geo.indices]).toEqual([0, 1, PRIMITIVE_RESTART_INDEX, 2, 3]);
  });

  it('a single-NaN-component column is treated as a gap (min OR max NaN)', () => {
    const geo = buildEnvelopeGeometry(env([0, NaN, 0], [1, 5, 1]), params);
    expect(geo.runCount).toBe(2);
    expect(geo.vertexCount).toBe(4);
  });

  it('an all-gap input emits no geometry', () => {
    const geo = buildEnvelopeGeometry(env([NaN, NaN], [NaN, NaN]), params);
    expect(geo.vertexCount).toBe(0);
    expect(geo.runCount).toBe(0);
    expect(geo.indices.length).toBe(0);
  });

  it('an empty input emits no geometry', () => {
    const geo = buildEnvelopeGeometry(env([], []), params);
    expect(geo.vertexCount).toBe(0);
    expect(geo.indices.length).toBe(0);
  });
});

describe('buildEnvelopeGeometry — extrema-preservation contract', () => {
  it('a 1-sample spike column reaches its extreme as a vertex (survives the GPU path)', () => {
    // Flat baseline with a single spike column whose max is far above neighbours.
    const minArr = [0, 0, 0, 0, 0];
    const maxArr = [0.1, 0.1, 99, 0.1, 0.1]; // spike at column 2
    const valuePerPx = 0.5; // clamp active for the flat columns, NOT the spike
    const geo = buildEnvelopeGeometry(env(minArr, maxArr), { ...params, valuePerPx });

    // The spike is column index 2 ⇒ vertices 4 (upper) and 5 (lower).
    const spikeUpper = vertexAt(geo.vertices, 4).y;
    expect(spikeUpper).toBe(99); // the extreme reached a vertex, unmodified
  });

  it('a 1-sample notch column reaches its extreme minimum', () => {
    const minArr = [0, 0, -99, 0, 0]; // notch at column 2
    const maxArr = [0.1, 0.1, 0.1, 0.1, 0.1];
    const geo = buildEnvelopeGeometry(env(minArr, maxArr), { ...params, valuePerPx: 0.5 });
    const notchLower = vertexAt(geo.vertices, 5).y; // column 2 lower vertex
    expect(notchLower).toBe(-99);
  });
});

describe('buildEnvelopeGeometry — buffer sizing', () => {
  it('index buffer length = vertexCount + (runCount - 1) sentinels', () => {
    const geo = buildEnvelopeGeometry(env([0, 0, NaN, 0, NaN, 0], [1, 1, NaN, 1, NaN, 1]), params);
    // 4 real cols ⇒ 8 verts; 3 runs ⇒ 2 sentinels ⇒ 10 indices.
    expect(geo.vertexCount).toBe(8);
    expect(geo.runCount).toBe(3);
    expect(geo.indices.length).toBe(10);
  });
});
