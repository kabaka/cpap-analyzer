/**
 * Tests for the breathing-detection cache-identity module.
 *
 * Guards the "load-bearing" version/param discipline of ADR 0023: a cached
 * per-night detection must never be served once it no longer matches what the
 * current detector + params would produce. See storage spec §4.4.
 *
 * @module analysis/breathing/__tests__/cacheVersion.test
 */

import { describe, expect, it } from 'vitest';

import {
  BREATHING_ALGO_VERSION,
  DEFAULT_BREATHING_PARAM_HASH,
  hashBreathingParams,
  makeBreathingDetectionId,
} from '@/analysis/breathing/cacheVersion';
import {
  DEFAULT_PERIODIC_BREATHING_PARAMS,
  type PeriodicBreathingParams,
} from '@/analysis/breathing/types';

describe('BREATHING_ALGO_VERSION', () => {
  it('is the integer 1 for the v1 detector', () => {
    expect(BREATHING_ALGO_VERSION).toBe(1);
    expect(Number.isInteger(BREATHING_ALGO_VERSION)).toBe(true);
  });
});

describe('hashBreathingParams', () => {
  it('is deterministic for two structurally identical default clones', () => {
    const a: PeriodicBreathingParams = { ...DEFAULT_PERIODIC_BREATHING_PARAMS };
    const b: PeriodicBreathingParams = { ...DEFAULT_PERIODIC_BREATHING_PARAMS };
    expect(hashBreathingParams(a)).toBe(hashBreathingParams(b));
    expect(hashBreathingParams(a)).toBe(DEFAULT_BREATHING_PARAM_HASH);
  });

  it('is order-independent (key-insertion order does not change the hash)', () => {
    // Reconstruct the same params with keys inserted in reverse order. A stable,
    // sorted-key hash must produce the identical digest.
    const reversed = Object.fromEntries(
      Object.entries(DEFAULT_PERIODIC_BREATHING_PARAMS).reverse(),
    ) as unknown as PeriodicBreathingParams;

    expect(hashBreathingParams(reversed)).toBe(
      hashBreathingParams(DEFAULT_PERIODIC_BREATHING_PARAMS),
    );
  });

  it('produces a different hash when any scalar field changes', () => {
    const tweaked: PeriodicBreathingParams = {
      ...DEFAULT_PERIODIC_BREATHING_PARAMS,
      modulationDepthMin: DEFAULT_PERIODIC_BREATHING_PARAMS.modulationDepthMin + 0.05,
    };
    expect(hashBreathingParams(tweaked)).not.toBe(DEFAULT_BREATHING_PARAM_HASH);
  });

  it('produces a different hash when the cycle-length tuple changes', () => {
    const tweaked: PeriodicBreathingParams = {
      ...DEFAULT_PERIODIC_BREATHING_PARAMS,
      cycleLenTypicalRange: [50, 90],
    };
    expect(hashBreathingParams(tweaked)).not.toBe(DEFAULT_BREATHING_PARAM_HASH);
  });

  it('distinguishes tuple element order (positional serialization)', () => {
    const swapped: PeriodicBreathingParams = {
      ...DEFAULT_PERIODIC_BREATHING_PARAMS,
      cycleLenTypicalRange: [90, 45],
    };
    expect(hashBreathingParams(swapped)).not.toBe(DEFAULT_BREATHING_PARAM_HASH);
  });
});

describe('DEFAULT_BREATHING_PARAM_HASH', () => {
  // LOAD-BEARING SNAPSHOT (ADR 0023, storage spec §4.4).
  //
  // This explicit value pins the hash of DEFAULT_PERIODIC_BREATHING_PARAMS. If
  // this assertion FAILS, the defaults (or the hash function) changed. Do NOT
  // blindly update the literal. A failure means you must make a CONSCIOUS choice:
  //
  //   1. The defaults were re-tuned WITHOUT changing detector behavior for the
  //      same effective params (rare) → accept the new hash by updating the
  //      literal below. This intentionally invalidates the persisted cache.
  //   2. The detector ALGORITHM changed (most default changes accompany an algo
  //      change) → ALSO bump BREATHING_ALGO_VERSION in cacheVersion.ts, then
  //      update the literal.
  //
  // Either way the change must be deliberate — that is the whole point of this
  // guard. A silent default change would otherwise serve stale clinical
  // candidates from the cache.
  it('matches the pinned default-parameter hash', () => {
    expect(DEFAULT_BREATHING_PARAM_HASH).toBe('493879ba');
  });
});

describe('makeBreathingDetectionId', () => {
  it('formats the composite key as `sessionId::algoVersion::paramHash`', () => {
    expect(
      makeBreathingDetectionId('session-abc', BREATHING_ALGO_VERSION, DEFAULT_BREATHING_PARAM_HASH),
    ).toBe(`session-abc::1::${DEFAULT_BREATHING_PARAM_HASH}`);
  });

  it('serializes a numeric algoVersion as its decimal string', () => {
    expect(makeBreathingDetectionId('s', 12, 'deadbeef')).toBe('s::12::deadbeef');
  });

  it('is injective across differing sessionId / version / paramHash', () => {
    const ids = [
      makeBreathingDetectionId('s1', 1, 'aaaa'),
      makeBreathingDetectionId('s2', 1, 'aaaa'),
      makeBreathingDetectionId('s1', 2, 'aaaa'),
      makeBreathingDetectionId('s1', 1, 'bbbb'),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('round-trips uniqueness: same inputs yield the same id', () => {
    const a = makeBreathingDetectionId('s1', 1, 'aaaa');
    const b = makeBreathingDetectionId('s1', 1, 'aaaa');
    expect(a).toBe(b);
  });
});
