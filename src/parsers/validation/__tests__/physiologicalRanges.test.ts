import { describe, it, expect } from 'vitest';
import {
  PHYSIOLOGICAL_RANGES,
  MEANINGFUL_SAMPLE_RANGES,
  isMeaningfulSample,
  channelHasMeaningfulData,
} from '@/parsers/validation/physiologicalRanges';

describe('isMeaningfulSample', () => {
  it('rejects non-finite values regardless of channel', () => {
    expect(isMeaningfulSample('spo2', NaN)).toBe(false);
    expect(isMeaningfulSample('spo2', Infinity)).toBe(false);
    expect(isMeaningfulSample('spo2', -Infinity)).toBe(false);
    expect(isMeaningfulSample('flow', NaN)).toBe(false);
  });

  it('rejects zero for all channels (preserves all-zero ⇒ empty)', () => {
    expect(isMeaningfulSample('flow', 0)).toBe(false);
    expect(isMeaningfulSample('spo2', 0)).toBe(false);
    expect(isMeaningfulSample('pulse', 0)).toBe(false);
    expect(isMeaningfulSample('unknownChannel', 0)).toBe(false);
  });

  it('treats the -1 probe-off sentinel as out of range for oximetry', () => {
    // spo2 meaningful range [30, 100], pulse range [30, 250]: -1 is below the floor.
    expect(isMeaningfulSample('spo2', -1)).toBe(false);
    expect(isMeaningfulSample('pulse', -1)).toBe(false);
  });

  it('accepts in-range oximetry readings', () => {
    expect(isMeaningfulSample('spo2', 95)).toBe(true);
    expect(isMeaningfulSample('pulse', 60)).toBe(true);
  });

  it('keeps a profoundly-hypoxic spo2 reading meaningful (never hide a real desaturation)', () => {
    // A genuinely critical desaturation of 45% sits below the validation floor
    // (PHYSIOLOGICAL_RANGES.spo2 = [50, 100]) but above the meaningful floor of
    // 30, so it must NOT be hidden as a sentinel.
    expect(isMeaningfulSample('spo2', 45)).toBe(true);
  });

  it('rejects spo2 readings below the meaningful floor as artifact/sentinel', () => {
    // 25% is below the 30 hardware reporting floor ⇒ implausible/sentinel.
    expect(isMeaningfulSample('spo2', 25)).toBe(false);
  });

  it('rejects byte sentinels above the spo2 ceiling', () => {
    // 127 / 128 / 255 are common one-byte sentinels and exceed the 100 ceiling.
    expect(isMeaningfulSample('spo2', 127)).toBe(false);
    expect(isMeaningfulSample('spo2', 128)).toBe(false);
    expect(isMeaningfulSample('spo2', 255)).toBe(false);
  });

  it('keeps a -1 flow sample meaningful (in flow range and non-zero)', () => {
    // flow range [-300, 300]: -1 is in range and non-zero.
    expect(isMeaningfulSample('flow', -1)).toBe(true);
  });

  it('applies the meaningful range bounds inclusively', () => {
    const spo2Range = MEANINGFUL_SAMPLE_RANGES.spo2;
    expect(spo2Range).toBeDefined();
    const [min, max] = spo2Range as readonly [number, number];
    expect(min).toBe(30);
    expect(max).toBe(100);
    expect(isMeaningfulSample('spo2', min)).toBe(true);
    expect(isMeaningfulSample('spo2', max)).toBe(true);
    expect(isMeaningfulSample('spo2', min - 0.01)).toBe(false);
    expect(isMeaningfulSample('spo2', max + 0.01)).toBe(false);
  });

  it('falls back to the non-zero rule for channels without a defined range', () => {
    expect(isMeaningfulSample('unknownChannel', 0)).toBe(false);
    expect(isMeaningfulSample('unknownChannel', 7)).toBe(true);
    expect(isMeaningfulSample('unknownChannel', -1)).toBe(true);
  });

  it('does not resolve inherited Object.prototype keys as ranges', () => {
    // Bracket access on a plain object can reach inherited keys; the Object.hasOwn
    // guard must prevent '__proto__'/'constructor' from being treated as a range.
    // These must not throw, and must fall back to the non-zero rule (no inherited
    // value is used as [min, max]).
    expect(() => isMeaningfulSample('__proto__', 7)).not.toThrow();
    expect(() => isMeaningfulSample('constructor', 7)).not.toThrow();
    expect(() => isMeaningfulSample('toString', 7)).not.toThrow();

    // Non-zero finite values pass via the fallback rule (range clause skipped).
    expect(isMeaningfulSample('__proto__', 7)).toBe(true);
    expect(isMeaningfulSample('constructor', 7)).toBe(true);
    expect(isMeaningfulSample('toString', 7)).toBe(true);

    // Zero and non-finite still rejected for these names.
    expect(isMeaningfulSample('__proto__', 0)).toBe(false);
    expect(isMeaningfulSample('constructor', NaN)).toBe(false);
  });
});

describe('MEANINGFUL_SAMPLE_RANGES', () => {
  it('lowers only the spo2 floor and inherits every other channel from PHYSIOLOGICAL_RANGES', () => {
    // spo2 is deliberately looser on the floor for visibility/plausibility.
    expect(MEANINGFUL_SAMPLE_RANGES.spo2).toEqual([30, 100]);

    // Every other channel is unchanged from the validation source of truth.
    for (const key of Object.keys(PHYSIOLOGICAL_RANGES)) {
      if (key === 'spo2') continue;
      expect(MEANINGFUL_SAMPLE_RANGES[key]).toEqual(PHYSIOLOGICAL_RANGES[key]);
    }
  });

  it('keeps PHYSIOLOGICAL_RANGES.spo2 at the validation floor of [50, 100]', () => {
    // The validation source of truth must remain decoupled and unchanged.
    expect(PHYSIOLOGICAL_RANGES.spo2).toEqual([50, 100]);
    expect(PHYSIOLOGICAL_RANGES.pulse).toEqual([30, 250]);
  });
});

describe('channelHasMeaningfulData', () => {
  it('returns false for an empty buffer', () => {
    expect(channelHasMeaningfulData('spo2', new Float32Array(0))).toBe(false);
    expect(channelHasMeaningfulData('flow', [])).toBe(false);
  });

  it('hides an all-(-1) spo2 channel (probe-off sentinel)', () => {
    expect(channelHasMeaningfulData('spo2', new Float32Array([-1, -1, -1, -1]))).toBe(false);
  });

  it('hides an all-zero spo2 channel', () => {
    expect(channelHasMeaningfulData('spo2', new Float32Array([0, 0, 0]))).toBe(false);
  });

  it('shows a spo2 channel with at least one in-range reading', () => {
    expect(channelHasMeaningfulData('spo2', new Float32Array([-1, -1, 95, -1]))).toBe(true);
  });

  it('shows a profoundly-hypoxic spo2 channel whose only real samples are below 50%', () => {
    // [-1, -1, 45, -1]: the single 45% reading is a real, clinically critical
    // desaturation and must keep the lane visible (no false-negative hide).
    expect(channelHasMeaningfulData('spo2', new Float32Array([-1, -1, 45, -1]))).toBe(true);
  });

  it('hides a spo2 channel whose only non-sentinel samples are below the meaningful floor', () => {
    // 25% sits below the 30 hardware floor ⇒ treated as implausible/sentinel.
    expect(channelHasMeaningfulData('spo2', new Float32Array([-1, 25, 0, -1]))).toBe(false);
  });

  it('hides an all-(-1) pulse channel and shows valid pulse data', () => {
    expect(channelHasMeaningfulData('pulse', new Float32Array([-1, -1, -1]))).toBe(false);
    expect(channelHasMeaningfulData('pulse', new Float32Array([60, 61, 62]))).toBe(true);
  });

  it('hides an all-zero flow channel but shows flow with a non-zero in-range sample', () => {
    expect(channelHasMeaningfulData('flow', new Float32Array([0, 0, 0, 0]))).toBe(false);
    // -1 is in flow range and non-zero ⇒ meaningful.
    expect(channelHasMeaningfulData('flow', new Float32Array([0, -1, 5, 0]))).toBe(true);
  });

  it('handles unknown channels by the non-zero rule', () => {
    expect(channelHasMeaningfulData('unknownChannel', new Float32Array([0, 0, 0]))).toBe(false);
    expect(channelHasMeaningfulData('unknownChannel', new Float32Array([0, 0, 3]))).toBe(true);
  });

  it('accepts a readonly number[] as input', () => {
    expect(channelHasMeaningfulData('spo2', [-1, -1, 90] as readonly number[])).toBe(true);
  });
});
