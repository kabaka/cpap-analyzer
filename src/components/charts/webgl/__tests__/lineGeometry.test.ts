/**
 * Unit tests for the instanced-line geometry.
 *
 * Mirrors the Canvas2D `drawLine` contract: one segment instance per consecutive
 * finite sample pair, NaN endpoints breaking the line (no instance), the uniform
 * sample→X mapping, and the explicit timestamped sampleX override. Width
 * expansion happens in the shader (validated by the CI gate), so these tests
 * cover the per-instance endpoint attributes only.
 *
 * @module components/charts/webgl/__tests__/lineGeometry.test
 */

import { describe, it, expect } from 'vitest';
import {
  buildLineGeometry,
  LINE_INSTANCE_STRIDE,
  LINE_QUAD_UNIT,
  LINE_QUAD_VERTEX_COUNT,
  type LineGeometryParams,
} from '../lineGeometry';

const uniform: LineGeometryParams = { dataXStart: 0, dataXPerSample: 10 };

/** Read instance `[xCur, yCur, xNext, yNext]` by index. */
function instanceAt(
  instances: Float32Array,
  i: number,
): { xCur: number; yCur: number; xNext: number; yNext: number } {
  const o = i * LINE_INSTANCE_STRIDE;
  return {
    xCur: instances[o] as number,
    yCur: instances[o + 1] as number,
    xNext: instances[o + 2] as number,
    yNext: instances[o + 3] as number,
  };
}

describe('buildLineGeometry — instance count', () => {
  it('emits N-1 instances for N finite samples', () => {
    const geo = buildLineGeometry(new Float32Array([1, 2, 3, 4]), uniform);
    expect(geo.instanceCount).toBe(3);
    expect(geo.instances.length).toBe(3 * LINE_INSTANCE_STRIDE);
  });

  it('returns no instances for fewer than 2 samples', () => {
    expect(buildLineGeometry(new Float32Array([]), uniform).instanceCount).toBe(0);
    expect(buildLineGeometry(new Float32Array([5]), uniform).instanceCount).toBe(0);
  });
});

describe('buildLineGeometry — uniform sample→X mapping', () => {
  it('maps sample s to dataXStart + s * dataXPerSample', () => {
    const geo = buildLineGeometry(new Float32Array([10, 20, 30]), {
      dataXStart: 100,
      dataXPerSample: 5,
    });
    const i0 = instanceAt(geo.instances, 0);
    expect(i0.xCur).toBe(100); // s=0 → 100
    expect(i0.xNext).toBe(105); // s=1 → 105
    expect(i0.yCur).toBe(10);
    expect(i0.yNext).toBe(20);
    const i1 = instanceAt(geo.instances, 1);
    expect(i1.xCur).toBe(105);
    expect(i1.xNext).toBe(110);
  });
});

describe('buildLineGeometry — explicit timestamped X', () => {
  it('uses sampleX when its length matches the data', () => {
    const sampleX = new Float64Array([1000, 2500, 9000]);
    const geo = buildLineGeometry(new Float32Array([1, 2, 3]), { ...uniform, sampleX });
    expect(instanceAt(geo.instances, 0).xCur).toBe(1000);
    expect(instanceAt(geo.instances, 0).xNext).toBe(2500);
    expect(instanceAt(geo.instances, 1).xNext).toBe(9000);
  });

  it('ignores sampleX when the length does not match (falls back to uniform)', () => {
    const sampleX = new Float64Array([1000, 2500]); // wrong length for 3 samples
    const geo = buildLineGeometry(new Float32Array([1, 2, 3]), { ...uniform, sampleX });
    expect(instanceAt(geo.instances, 0).xCur).toBe(0); // uniform dataXStart
  });
});

describe('buildLineGeometry — NaN gap breaks (mirrors firstPoint reset)', () => {
  it('omits the instance whose current OR next endpoint is NaN', () => {
    // samples: 1, 2, NaN, 4, 5
    // segments: (1,2)✓ (2,NaN)✗ (NaN,4)✗ (4,5)✓  → 2 instances
    const geo = buildLineGeometry(new Float32Array([1, 2, NaN, 4, 5]), uniform);
    expect(geo.instanceCount).toBe(2);
    expect(instanceAt(geo.instances, 0).yCur).toBe(1);
    expect(instanceAt(geo.instances, 0).yNext).toBe(2);
    expect(instanceAt(geo.instances, 1).yCur).toBe(4);
    expect(instanceAt(geo.instances, 1).yNext).toBe(5);
  });

  it('a leading and trailing NaN drop their adjacent segments', () => {
    const geo = buildLineGeometry(new Float32Array([NaN, 1, 2, NaN]), uniform);
    // segments: (NaN,1)✗ (1,2)✓ (2,NaN)✗ → 1 instance
    expect(geo.instanceCount).toBe(1);
    expect(instanceAt(geo.instances, 0).yCur).toBe(1);
    expect(instanceAt(geo.instances, 0).yNext).toBe(2);
  });

  it('multiple consecutive NaNs leave only fully-finite segments', () => {
    const geo = buildLineGeometry(new Float32Array([1, NaN, NaN, NaN, 5, 6]), uniform);
    // only (5,6) is fully finite → 1 instance
    expect(geo.instanceCount).toBe(1);
    expect(instanceAt(geo.instances, 0).yCur).toBe(5);
  });

  it('an all-NaN series yields no instances', () => {
    const geo = buildLineGeometry(new Float32Array([NaN, NaN, NaN]), uniform);
    expect(geo.instanceCount).toBe(0);
  });
});

describe('LINE_QUAD_UNIT', () => {
  it('is a 6-vertex two-triangle unit quad of (along, side) pairs', () => {
    expect(LINE_QUAD_VERTEX_COUNT).toBe(6);
    expect(LINE_QUAD_UNIT.length).toBe(LINE_QUAD_VERTEX_COUNT * 2);
    // along ∈ {0,1}, side ∈ {-1,+1} for every vertex.
    for (let i = 0; i < LINE_QUAD_VERTEX_COUNT; i++) {
      const along = LINE_QUAD_UNIT[i * 2] as number;
      const side = LINE_QUAD_UNIT[i * 2 + 1] as number;
      expect(along === 0 || along === 1).toBe(true);
      expect(side === -1 || side === 1).toBe(true);
    }
  });
});
