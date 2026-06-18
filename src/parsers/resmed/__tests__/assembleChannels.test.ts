/**
 * Tests for {@link assembleChannels} — window-aligned, gap-padded assembly of
 * multi-segment ResMed nights.
 *
 * Regression coverage for the multi-segment truncation bug: a night split into
 * two contiguous EDF segments must be CONCATENATED into one series spanning the
 * full window, with inter-segment gaps as NaN — not reduced to the longest
 * single segment (which truncated the night and shifted samples to the origin).
 *
 * Synthetic data only.
 */

import { describe, it, expect, vi } from 'vitest';
import { assembleChannels, assembleOneChannel, GAP_SENTINEL } from '../assembleChannels';
import type { ResMedInterpretation, StandardChannel } from '../ResMedInterpreter';

const BASE = new Date(2026, 5, 14, 2, 51, 42); // 02:51:42 local

function channel(name: string, samples: Float32Array, sampleRate: number): StandardChannel {
  return {
    name,
    unit: 'cmH2O',
    sampleRate,
    samples,
    metadata: {
      name,
      sampleRate,
      unit: 'cmH2O',
      physicalMin: 0,
      physicalMax: 100,
      digitalMin: 0,
      digitalMax: 100,
    },
  };
}

function segment(
  startMs: number,
  durationSeconds: number,
  channels: StandardChannel[],
): ResMedInterpretation {
  return {
    machineInfo: {
      serialNumber: 'TEST',
      model: 'AirSense 10 AutoSet',
      series: 'AirSense 10',
      firmwareVersion: 'Unknown',
      machineType: 'apap',
    },
    capabilities: {
      hasAutoCPAP: true,
      hasBilevel: false,
      hasIPAPChannel: false,
      hasPressureSupport: false,
      hasServoControl: false,
      hasFlowLimitation: true,
    },
    startTime: new Date(startMs),
    duration: durationSeconds,
    channels,
    events: [],
    unknownLabels: [],
    unknownEvents: [],
  };
}

describe('assembleChannels — single-segment fast path', () => {
  it('returns the original samples unchanged (no copy) when one segment starts at the window origin', () => {
    const samples = new Float32Array([1, 2, 3, 4, 5]);
    const seg = segment(BASE.getTime(), 5, [channel('flow', samples, 1)]);
    const [out] = assembleChannels([seg], BASE.getTime(), BASE.getTime() + 5000);

    expect(out).toBeDefined();
    // Same backing array — byte-identical to the pre-fix output, zero copies.
    expect(out!.samples).toBe(samples);
    expect(out!.sampleRate).toBe(1);
  });
});

describe('assembleChannels — two contiguous segments', () => {
  it('concatenates both segments into one full-window series with a NaN inter-segment gap', () => {
    const rate = 1; // 1 Hz for easy index↔second mapping
    const startMs = BASE.getTime();

    // Segment 1: 0..10s (10 samples), all 10.0
    const seg1Samples = new Float32Array(10).fill(10);
    const seg1 = segment(startMs, 10, [channel('maskPressure', seg1Samples, rate)]);

    // 5-second gap (file roll), then Segment 2: 15..40s (25 samples), all 20.0
    const seg2StartMs = startMs + 15_000;
    const seg2Samples = new Float32Array(25).fill(20);
    const seg2 = segment(seg2StartMs, 25, [channel('maskPressure', seg2Samples, rate)]);

    const endMs = seg2StartMs + 25_000; // full window = 40s
    const [out] = assembleChannels([seg1, seg2], startMs, endMs);
    expect(out).toBeDefined();
    const s = out!.samples;

    // Length spans the WHOLE window: 40s × 1Hz = 40 samples.
    expect(s.length).toBe(40);

    // Segment 1 at the window start (indices 0..9).
    for (let i = 0; i < 10; i++) expect(s[i]).toBe(10);

    // Inter-segment gap (indices 10..14) is NaN — no data, not zeros.
    for (let i = 10; i < 15; i++) expect(Number.isNaN(s[i]!)).toBe(true);

    // Segment 2 placed at its window offset (indices 15..39).
    for (let i = 15; i < 40; i++) expect(s[i]).toBe(20);

    // Last real sample reaches the window end (no truncation).
    expect(s[39]).toBe(20);
  });

  it('places the shorter segment first even when the longer segment dominates rate/metadata', () => {
    const startMs = BASE.getTime();
    // Longer segment 2 (would have "won" under longest-segment-wins).
    const seg1 = segment(startMs, 5, [channel('flow', new Float32Array(5).fill(1), 1)]);
    const seg2 = segment(startMs + 5_000, 20, [channel('flow', new Float32Array(20).fill(2), 1)]);
    const [out] = assembleChannels([seg1, seg2], startMs, startMs + 25_000);

    const s = out!.samples;
    expect(s.length).toBe(25);
    // Shorter segment-1 region is PRESENT at the window start (the bug dropped it).
    expect(s[0]).toBe(1);
    expect(s[4]).toBe(1);
    expect(s[5]).toBe(2);
    expect(s[24]).toBe(2);
  });
});

describe('assembleChannels — lead-in gap', () => {
  it('pads NaN before a single segment that starts after the window origin', () => {
    const startMs = BASE.getTime();
    // Window starts at BASE but the only segment begins 10s later.
    const seg = segment(startMs + 10_000, 10, [channel('flow', new Float32Array(10).fill(7), 1)]);
    const [out] = assembleChannels([seg], startMs, startMs + 20_000);
    const s = out!.samples;
    expect(s.length).toBe(20);
    for (let i = 0; i < 10; i++) expect(Number.isNaN(s[i]!)).toBe(true);
    for (let i = 10; i < 20; i++) expect(s[i]).toBe(7);
  });
});

describe('assembleChannels — segment starts before the window origin (negative offset)', () => {
  it('clamps the source head and lands the first in-window sample at index 0', () => {
    const rate = 1; // 1 Hz: 1 sample === 1 second
    const startMs = BASE.getTime();

    // The session window is [startMs, startMs + 20s].
    // The segment, however, begins 5s BEFORE the window origin and runs 30s:
    //   segment samples 0..4   → wall-clock -5s..-1s  (BEFORE the window) → skipped
    //   segment samples 5..24  → wall-clock  0s..19s  (in window)        → indices 0..19
    //   segment samples 25..29 → wall-clock 20s..24s  (past window end)  → dropped
    // We tag each sample with its index value so we can verify exactly which
    // source samples survived and where they landed.
    const segSamples = new Float32Array(30);
    for (let i = 0; i < 30; i++) segSamples[i] = i; // 0,1,2,...,29

    const seg = segment(startMs - 5_000, 30, [channel('flow', segSamples, rate)]);
    const endMs = startMs + 20_000; // 20s window
    const [out] = assembleChannels([seg], startMs, endMs);

    expect(out).toBeDefined();
    const s = out!.samples;

    // Length still equals round(windowDurationSeconds * rate) = 20s × 1Hz = 20.
    expect(s.length).toBe(20);

    // The 5 pre-window source samples (values 0..4) were skipped (source head
    // clamped). Index 0 of the window is the FIRST in-window sample = source[5] = 5.
    expect(s[0]).toBe(5);
    expect(s[1]).toBe(6);

    // Each in-window index i holds source[i + 5] (the srcSkip offset).
    for (let i = 0; i < 20; i++) expect(s[i]).toBe(i + 5);

    // The last in-window sample is source[24] = 24 (source[25..29] fell past the
    // window end and were dropped — no out-of-bounds write).
    expect(s[19]).toBe(24);

    // No NaN anywhere: real data covers the entire window.
    for (let i = 0; i < 20; i++) expect(Number.isNaN(s[i]!)).toBe(false);
  });
});

describe('assembleChannels — three segments with two interior gaps', () => {
  it('places all three segments at their offsets with both inter-segment gaps as NaN', () => {
    const rate = 1; // 1 Hz for direct index↔second mapping
    const startMs = BASE.getTime();

    // Seg A: 0..4s   (5 samples)  value 1
    const segA = segment(startMs, 5, [channel('flow', new Float32Array(5).fill(1), rate)]);
    // gap 5..9s (5 samples) → NaN
    // Seg B: 10..14s (5 samples)  value 2
    const segB = segment(startMs + 10_000, 5, [channel('flow', new Float32Array(5).fill(2), rate)]);
    // gap 15..19s (5 samples) → NaN
    // Seg C: 20..24s (5 samples)  value 3
    const segC = segment(startMs + 20_000, 5, [channel('flow', new Float32Array(5).fill(3), rate)]);

    const endMs = startMs + 25_000; // 25s window

    // Supply the segments OUT of chronological order to prove ordering is by
    // start time, not input order.
    const [out] = assembleChannels([segC, segA, segB], startMs, endMs);

    expect(out).toBeDefined();
    const s = out!.samples;

    // Total length matches the window: 25s × 1Hz = 25.
    expect(s.length).toBe(25);

    // Seg A region (0..4).
    for (let i = 0; i < 5; i++) expect(s[i]).toBe(1);
    // First interior gap (5..9) is NaN.
    for (let i = 5; i < 10; i++) expect(Number.isNaN(s[i]!)).toBe(true);
    // Seg B region (10..14).
    for (let i = 10; i < 15; i++) expect(s[i]).toBe(2);
    // Second interior gap (15..19) is NaN.
    for (let i = 15; i < 20; i++) expect(Number.isNaN(s[i]!)).toBe(true);
    // Seg C region (20..24).
    for (let i = 20; i < 25; i++) expect(s[i]).toBe(3);
  });

  it('produces an identical series regardless of input segment ordering', () => {
    const rate = 1;
    const startMs = BASE.getTime();
    const segA = segment(startMs, 5, [channel('flow', new Float32Array(5).fill(1), rate)]);
    const segB = segment(startMs + 10_000, 5, [channel('flow', new Float32Array(5).fill(2), rate)]);
    const segC = segment(startMs + 20_000, 5, [channel('flow', new Float32Array(5).fill(3), rate)]);
    const endMs = startMs + 25_000;

    const [inOrder] = assembleChannels([segA, segB, segC], startMs, endMs);
    const [shuffled] = assembleChannels([segB, segC, segA], startMs, endMs);

    expect(inOrder).toBeDefined();
    expect(shuffled).toBeDefined();
    const a = inOrder!.samples;
    const b = shuffled!.samples;
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      // NaN !== NaN, so compare the no-data sentinel positionally.
      if (Number.isNaN(a[i]!)) {
        expect(Number.isNaN(b[i]!)).toBe(true);
      } else {
        expect(b[i]).toBe(a[i]);
      }
    }
  });
});

describe('assembleChannels — differing sample rates', () => {
  it('chooses the dominant rate and resamples a differing-rate segment to keep counts consistent', () => {
    const startMs = BASE.getTime();
    // Segment 1: 4 Hz, 40 samples = 10s (dominant: most samples).
    const seg1 = segment(startMs, 10, [channel('flow', new Float32Array(40).fill(3), 4)]);
    // Segment 2: 2 Hz, 20 samples = 10s, contiguous at +10s.
    const seg2 = segment(startMs + 10_000, 10, [channel('flow', new Float32Array(20).fill(9), 2)]);

    const endMs = startMs + 20_000;
    const [out] = assembleChannels([seg1, seg2], startMs, endMs);
    expect(out!.sampleRate).toBe(4); // dominant rate
    // Length matches chosen rate × window: 4 Hz × 20s = 80.
    expect(out!.samples.length).toBe(80);
    // Segment 1 region (0..39) at native rate.
    expect(out!.samples[0]).toBe(3);
    expect(out!.samples[39]).toBe(3);
    // Segment 2 region resampled onto the 4 Hz grid (40..79).
    expect(out!.samples[40]).toBe(9);
    expect(out!.samples[79]).toBe(9);
  });
});

describe('GAP_SENTINEL', () => {
  it('is NaN', () => {
    expect(Number.isNaN(GAP_SENTINEL)).toBe(true);
  });
});

describe('assembleChannels — memory-exhaustion DoS guard', () => {
  // Regression: a crafted multi-segment input with an absurd window and/or rate
  // (derived from corrupt EDF headers) must NOT allocate a multi-GB Float32Array.
  // The assembler must bail to an empty series quickly, without throwing.

  it('bails to an empty series for an absurd session window (no giant allocation)', () => {
    const startMs = BASE.getTime();
    // Two real-rate segments, but the declared window spans ~136 years
    // (4.29e9 s). At 25 Hz that is ~1.07e11 samples ≈ 430 GB if allocated.
    const seg1 = segment(startMs, 10, [channel('flow', new Float32Array(10).fill(1), 25)]);
    const seg2 = segment(startMs + 5_000, 10, [channel('flow', new Float32Array(10).fill(2), 25)]);
    const absurdEndMs = startMs + 4_294_967_296 * 1000;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t0 = performance.now();
    const [out] = assembleChannels([seg1, seg2], startMs, absurdEndMs);
    const elapsed = performance.now() - t0;
    warn.mockRestore();

    expect(out).toBeDefined();
    // Empty series — nothing close to a multi-GB buffer was allocated.
    expect(out!.samples.length).toBe(0);
    // And it returned essentially instantly (no RangeError, no fill of billions).
    expect(elapsed).toBeLessThan(1000);
  });

  it('bails to an empty series for an absurd sample rate (no giant allocation)', () => {
    const startMs = BASE.getTime();
    // Plausible ~8 h window, but a crafted rate of 1e6 Hz → ~2.9e10 samples.
    const eightHoursMs = 8 * 3600 * 1000;
    const seg1 = segment(startMs, 10, [channel('flow', new Float32Array(10).fill(1), 1_000_000)]);
    const seg2 = segment(startMs + 5_000, 10, [
      channel('flow', new Float32Array(10).fill(2), 1_000_000),
    ]);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const [out] = assembleChannels([seg1, seg2], startMs, startMs + eightHoursMs);
    warn.mockRestore();

    expect(out).toBeDefined();
    expect(out!.samples.length).toBe(0);
  });

  it('still assembles a legitimate full-night window within bounds', () => {
    const startMs = BASE.getTime();
    // ~8 h at 25 Hz = 720000 samples — well within MAX_TOTAL_SAMPLES.
    const rate = 25;
    const eightHoursMs = 8 * 3600 * 1000;
    const seg1Samples = new Float32Array(rate * 3600).fill(5); // 1 h of data
    const seg1 = segment(startMs, 3600, [channel('flow', seg1Samples, rate)]);
    const seg2 = segment(startMs + 3600_000, 3600, [
      channel('flow', new Float32Array(rate * 3600).fill(6), rate),
    ]);

    const [out] = assembleChannels([seg1, seg2], startMs, startMs + eightHoursMs);
    expect(out).toBeDefined();
    expect(out!.samples.length).toBe(rate * 8 * 3600); // 720000
    expect(out!.samples[0]).toBe(5);
  });
});

describe('assembleOneChannel — direct', () => {
  it('spans the full declared window even when segments fall short of it', () => {
    const startMs = BASE.getTime();
    const seg1 = { channel: channel('flow', new Float32Array(5).fill(1), 1), startMs };
    // Declared window is 20s but data only covers 5s → rest is NaN, length still 20.
    const out = assembleOneChannel(
      'flow',
      [
        seg1,
        { channel: channel('flow', new Float32Array(5).fill(1), 1), startMs: startMs + 10_000 },
      ],
      startMs,
      startMs + 20_000,
    );
    expect(out.samples.length).toBe(20);
    expect(out.samples[19] !== undefined && Number.isNaN(out.samples[19])).toBe(true);
  });
});
