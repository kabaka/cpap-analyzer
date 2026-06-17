/**
 * Tests for the Signal Viewer's pure hovered-region readout helpers
 * (`src/views/Sessions/hoverReadout.ts`).
 *
 * These strings and the device-event / detection-episode hit-test feed
 * health-adjacent readouts, so assertions are on EXACT output, not loose
 * matches. Clock-time tests are timezone-independent: the expected wall-clock
 * value is derived from `new Date(...)` getters, mirroring the module's
 * local-time convention, so they pass under any CI timezone.
 */

import { describe, it, expect } from 'vitest';
import type { Event as TherapyEvent, EventType } from '@/types';
import type { BreathingEpisode, BreathingEpisodeType } from '@/analysis/breathing';
import {
  formatDuration,
  formatClockTime,
  formatEventType,
  eventReadoutText,
  detectionReadoutText,
  findHoveredRegion,
  hoveredRegionKey,
  EMPTY_HOVERED_REGION,
} from '../hoverReadout';

/** A fixed, arbitrary session start (epoch ms). Value is irrelevant to logic. */
const SESSION_START = Date.UTC(2025, 2, 15, 2, 0, 0);

/**
 * Build a minimal therapy event with only the fields the readout/hit-test
 * read (`id`, `type`, `timestamp`, `duration`, `leak`). The rest are filled
 * with inert defaults to satisfy the type.
 */
function makeEvent(overrides: Partial<TherapyEvent> = {}): TherapyEvent {
  return {
    id: 'evt-1',
    sessionId: 'sess-1',
    type: 'ObstructiveApnea' as EventType,
    timestamp: SESSION_START,
    duration: 0,
    severity: null,
    pressure: null,
    epap: null,
    ipap: null,
    leak: null,
    spo2: null,
    clusterId: null,
    ...overrides,
  };
}

/**
 * Build a minimal breathing episode with only the fields the
 * readout/hit-test read. Remaining required fields get inert defaults.
 */
function makeEpisode(overrides: Partial<BreathingEpisode> = {}): BreathingEpisode {
  return {
    id: 'ep-1',
    type: 'PeriodicBreathing' as BreathingEpisodeType,
    startMs: SESSION_START,
    endMs: SESSION_START,
    durationSec: 0,
    confidence: 0,
    cycleLengthSec: 0,
    modulationDepth: 0,
    cycleCount: 0,
    belowDeviceThreshold: false,
    ...(overrides as Partial<BreathingEpisode>),
  } as BreathingEpisode;
}

describe('formatDuration', () => {
  it('renders sub-minute durations as "Ns"', () => {
    expect(formatDuration(18)).toBe('18s');
  });

  it('renders 0 seconds as "0s"', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('rounds fractional seconds to the nearest whole second', () => {
    expect(formatDuration(17.6)).toBe('18s');
    expect(formatDuration(17.4)).toBe('17s');
  });

  it('clamps negative durations to "0s"', () => {
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(-0.4)).toBe('0s');
  });

  it('renders exactly 60 seconds as "1:00" with zero-padded seconds', () => {
    expect(formatDuration(60)).toBe('1:00');
  });

  it('renders 90 seconds as "1:30"', () => {
    expect(formatDuration(90)).toBe('1:30');
  });

  it('zero-pads the seconds component below ten (605s → "10:05")', () => {
    expect(formatDuration(605)).toBe('10:05');
  });

  it('rounds before formatting at the minute boundary (59.6s → "1:00")', () => {
    expect(formatDuration(59.6)).toBe('1:00');
  });
});

describe('formatClockTime', () => {
  // `sessionStartMs` is the wall-clock-as-UTC epoch, so the expected wall-clock
  // value is read with UTC getters (timezone-independent under any CI zone).
  it('returns the wall-clock HH:MM:SS for sessionStartMs + relMs', () => {
    const relMs = 14 * 60 * 1000 + 7 * 1000; // 14m07s into the session
    const d = new Date(SESSION_START + relMs);
    const expected = `${String(d.getUTCHours()).padStart(2, '0')}:${String(
      d.getUTCMinutes(),
    ).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
    expect(formatClockTime(SESSION_START, relMs)).toBe(expected);
  });

  it('reads UTC getters off the wall-clock-as-UTC epoch (e.g. 02:00:00)', () => {
    // SESSION_START = Date.UTC(2025, 2, 15, 2, 0, 0) → wall clock 02:00:00.
    expect(formatClockTime(SESSION_START, 0)).toBe('02:00:00');
  });

  it('wraps past midnight: 22:30 + 3h → 01:30:00 the next day', () => {
    const base = Date.UTC(2025, 5, 17, 22, 30, 0); // wall clock 22:30:00
    expect(formatClockTime(base, 3 * 60 * 60 * 1000)).toBe('01:30:00');
  });

  it('zero-pads hours, minutes, and seconds below ten', () => {
    const base = Date.UTC(2025, 0, 1, 3, 4, 5, 0); // wall clock 03:04:05
    const result = formatClockTime(base, 0);
    expect(result).toBe('03:04:05');
    // Each component is exactly two characters.
    const [hh, mm, ss] = result.split(':');
    expect(hh).toHaveLength(2);
    expect(mm).toHaveLength(2);
    expect(ss).toHaveLength(2);
  });
});

describe('formatEventType', () => {
  it('inserts a space before each interior capital in PascalCase', () => {
    expect(formatEventType('ObstructiveApnea')).toBe('Obstructive Apnea');
    expect(formatEventType('LargeLeak')).toBe('Large Leak');
  });

  it('keeps all-caps acronyms intact', () => {
    // Splitting only at lowercase→uppercase boundaries leaves an all-caps
    // acronym like "RERA" unspaced (it has no such boundary).
    expect(formatEventType('RERA')).toBe('RERA');
  });

  it('spaces the remaining PascalCase event types', () => {
    expect(formatEventType('FlowLimitation')).toBe('Flow Limitation');
    expect(formatEventType('ClearAirway')).toBe('Clear Airway');
    expect(formatEventType('PeriodicBreathing')).toBe('Periodic Breathing');
  });
});

describe('eventReadoutText', () => {
  it('builds "{Type} · {clock} · {duration}" without a metric by default', () => {
    const event = makeEvent({
      type: 'ObstructiveApnea',
      timestamp: SESSION_START + 60_000,
      duration: 18,
    });
    const clock = formatClockTime(SESSION_START, 60_000);
    expect(eventReadoutText(event, SESSION_START, false)).toBe(
      `Obstructive Apnea · ${clock} · 18s`,
    );
  });

  it('appends the leak metric for a LargeLeak when withMetric=true and leak is present', () => {
    const event = makeEvent({
      type: 'LargeLeak',
      timestamp: SESSION_START + 60_000,
      duration: 90,
      leak: 36.4,
    });
    const clock = formatClockTime(SESSION_START, 60_000);
    expect(eventReadoutText(event, SESSION_START, true)).toBe(
      `Large Leak · ${clock} · 1:30 · leak 36 L/min`,
    );
  });

  it('rounds the leak metric to the nearest L/min', () => {
    const event = makeEvent({ type: 'LargeLeak', duration: 5, leak: 35.5 });
    expect(eventReadoutText(event, SESSION_START, true)).toContain('· leak 36 L/min');
  });

  it('omits the metric when withMetric=false even for a LargeLeak with leak', () => {
    const event = makeEvent({ type: 'LargeLeak', duration: 5, leak: 40 });
    expect(eventReadoutText(event, SESSION_START, false)).not.toContain('leak');
  });

  it('omits the metric when the type is not LargeLeak even with leak present', () => {
    const event = makeEvent({ type: 'Hypopnea', duration: 5, leak: 40 });
    expect(eventReadoutText(event, SESSION_START, true)).not.toContain('leak');
  });

  it('omits the metric when leak is null for a LargeLeak', () => {
    const event = makeEvent({ type: 'LargeLeak', duration: 5, leak: null });
    expect(eventReadoutText(event, SESSION_START, true)).not.toContain('leak');
  });

  it('computes the clock from the event timestamp relative to sessionStartMs', () => {
    const relMs = 2 * 60 * 60 * 1000 + 14 * 60 * 1000 + 7 * 1000;
    const event = makeEvent({
      type: 'CentralApnea',
      timestamp: SESSION_START + relMs,
      duration: 12,
    });
    const clock = formatClockTime(SESSION_START, relMs);
    expect(eventReadoutText(event, SESSION_START, false)).toBe(`Central Apnea · ${clock} · 12s`);
  });

  it('uses the wall-clock epoch (4th arg) for the clock, raw epoch for the offset', () => {
    // Raw session-start epoch (could differ from the wall-clock-as-UTC epoch by a
    // timezone offset in the real app). Here we make them differ by +5h so the
    // distinction is observable.
    const rawStart = Date.UTC(2025, 5, 17, 22, 0, 0);
    const wallClock = rawStart + 5 * 60 * 60 * 1000; // pretend wall clock is 03:00
    const relMs = 30 * 60 * 1000; // 30 minutes into the session
    const event = makeEvent({
      type: 'Hypopnea',
      timestamp: rawStart + relMs, // offset computed against rawStart
      duration: 8,
    });
    // Clock is formatted against the wall-clock epoch (03:30:00), NOT rawStart.
    const expectedClock = formatClockTime(wallClock, relMs);
    expect(expectedClock).toBe('03:30:00');
    expect(eventReadoutText(event, rawStart, false, wallClock)).toBe(`Hypopnea · 03:30:00 · 8s`);
  });
});

describe('detectionReadoutText', () => {
  it('uses "CSR" for CheyneStokes and "PB" otherwise', () => {
    const csr = makeEpisode({ type: 'CheyneStokes', confidence: 0.72 });
    const pb = makeEpisode({ type: 'PeriodicBreathing', confidence: 0.72 });
    expect(detectionReadoutText(csr, false)).toBe('CSR candidate · 72%');
    expect(detectionReadoutText(pb, false)).toBe('PB candidate · 72%');
  });

  it('rounds confidence*100 to a whole percent', () => {
    const ep = makeEpisode({ type: 'PeriodicBreathing', confidence: 0.725 });
    expect(detectionReadoutText(ep, false)).toBe('PB candidate · 73%');
  });

  it('appends the cycle/duration tail when withTail=true', () => {
    const ep = makeEpisode({
      type: 'PeriodicBreathing',
      confidence: 0.72,
      cycleLengthSec: 38,
      durationSec: 240, // 4 min
    });
    expect(detectionReadoutText(ep, true)).toBe('PB candidate · 72% · cycle 38s · 4 min');
  });

  it('rounds cycle length and duration-minutes in the tail', () => {
    const ep = makeEpisode({
      type: 'CheyneStokes',
      confidence: 0.9,
      cycleLengthSec: 37.6, // → 38
      durationSec: 269, // 4.483 min → 4
    });
    expect(detectionReadoutText(ep, true)).toBe('CSR candidate · 90% · cycle 38s · 4 min');
  });

  it('omits the tail when withTail=false', () => {
    const ep = makeEpisode({
      type: 'PeriodicBreathing',
      confidence: 0.6,
      cycleLengthSec: 40,
      durationSec: 300,
    });
    const text = detectionReadoutText(ep, false);
    expect(text).toBe('PB candidate · 60%');
    expect(text).not.toContain('cycle');
    expect(text).not.toContain('min');
  });

  it('appends " · sub-threshold" when belowDeviceThreshold, with the tail', () => {
    const ep = makeEpisode({
      type: 'PeriodicBreathing',
      confidence: 0.5,
      cycleLengthSec: 30,
      durationSec: 120,
      belowDeviceThreshold: true,
    });
    expect(detectionReadoutText(ep, true)).toBe(
      'PB candidate · 50% · cycle 30s · 2 min · sub-threshold',
    );
  });

  it('appends " · sub-threshold" when belowDeviceThreshold, without the tail', () => {
    const ep = makeEpisode({
      type: 'PeriodicBreathing',
      confidence: 0.5,
      belowDeviceThreshold: true,
    });
    expect(detectionReadoutText(ep, false)).toBe('PB candidate · 50% · sub-threshold');
  });
});

describe('findHoveredRegion', () => {
  it('returns EMPTY_HOVERED_REGION when nothing contains the time', () => {
    const event = makeEvent({ timestamp: SESSION_START + 10_000, duration: 5 }); // [10s, 15s]
    const region = findHoveredRegion(SESSION_START + 0, [event], null, SESSION_START, true);
    expect(region).toBe(EMPTY_HOVERED_REGION);
    expect(region.event).toBeNull();
    expect(region.episode).toBeNull();
  });

  it('matches a device event when start <= timeMs <= end', () => {
    const event = makeEvent({ timestamp: SESSION_START + 10_000, duration: 5 }); // start=10000, end=15000
    const region = findHoveredRegion(12_000, [event], null, SESSION_START, true);
    expect(region.event).toBe(event);
  });

  it('treats the start and end boundaries as inclusive', () => {
    const event = makeEvent({ timestamp: SESSION_START + 10_000, duration: 5 }); // [10000, 15000]
    expect(findHoveredRegion(10_000, [event], null, SESSION_START, true).event).toBe(event);
    expect(findHoveredRegion(15_000, [event], null, SESSION_START, true).event).toBe(event);
    expect(findHoveredRegion(9_999, [event], null, SESSION_START, true).event).toBeNull();
    expect(findHoveredRegion(15_001, [event], null, SESSION_START, true).event).toBeNull();
  });

  it('selects the narrowest-span event when several overlap the cursor', () => {
    const wide = makeEvent({ id: 'wide', timestamp: SESSION_START + 0, duration: 100 }); // [0, 100000]
    const narrow = makeEvent({ id: 'narrow', timestamp: SESSION_START + 40_000, duration: 5 }); // [40000, 45000]
    const region = findHoveredRegion(42_000, [wide, narrow], null, SESSION_START, true);
    expect(region.event).toBe(narrow);
  });

  it('matches a detection episode via startMs/endMs relative to sessionStartMs', () => {
    const ep = makeEpisode({
      startMs: SESSION_START + 20_000,
      endMs: SESSION_START + 80_000,
    });
    const region = findHoveredRegion(50_000, [], [ep], SESSION_START, true);
    expect(region.episode).toBe(ep);
  });

  it('selects the narrowest episode among overlapping ones', () => {
    const wide = makeEpisode({
      id: 'ep-wide',
      startMs: SESSION_START + 0,
      endMs: SESSION_START + 100_000,
    });
    const narrow = makeEpisode({
      id: 'ep-narrow',
      startMs: SESSION_START + 30_000,
      endMs: SESSION_START + 60_000,
    });
    const region = findHoveredRegion(45_000, [], [wide, narrow], SESSION_START, true);
    expect(region.episode).toBe(narrow);
  });

  it('omits the episode when showDetections=false, but still matches events', () => {
    const event = makeEvent({ timestamp: SESSION_START + 10_000, duration: 60 }); // [10000, 70000]
    const ep = makeEpisode({ startMs: SESSION_START + 20_000, endMs: SESSION_START + 80_000 });
    const region = findHoveredRegion(50_000, [event], [ep], SESSION_START, false);
    expect(region.episode).toBeNull();
    expect(region.event).toBe(event);
  });

  it('omits the episode when detectionEpisodes is null', () => {
    const ep = makeEpisode({ startMs: SESSION_START + 20_000, endMs: SESSION_START + 80_000 });
    void ep; // not passed; documents intent
    const region = findHoveredRegion(50_000, [], null, SESSION_START, true);
    expect(region).toBe(EMPTY_HOVERED_REGION);
  });

  it('returns both an event and an episode when both contain the time', () => {
    const event = makeEvent({ timestamp: SESSION_START + 10_000, duration: 60 }); // [10000, 70000]
    const ep = makeEpisode({ startMs: SESSION_START + 20_000, endMs: SESSION_START + 80_000 }); // [20000, 80000]
    const region = findHoveredRegion(50_000, [event], [ep], SESSION_START, true);
    expect(region.event).toBe(event);
    expect(region.episode).toBe(ep);
  });
});

describe('hoveredRegionKey', () => {
  it('returns "{eventId}|{episodeId}" for a fully populated region', () => {
    const region = {
      event: makeEvent({ id: 'evt-A' }),
      episode: makeEpisode({ id: 'ep-B' }),
    };
    expect(hoveredRegionKey(region)).toBe('evt-A|ep-B');
  });

  it('uses empty strings for null event and/or null episode', () => {
    expect(hoveredRegionKey({ event: null, episode: null })).toBe('|');
    expect(hoveredRegionKey({ event: makeEvent({ id: 'evt-A' }), episode: null })).toBe('evt-A|');
    expect(hoveredRegionKey({ event: null, episode: makeEpisode({ id: 'ep-B' }) })).toBe('|ep-B');
  });

  it('produces the same key for the same identities', () => {
    const a = { event: makeEvent({ id: 'evt-A' }), episode: makeEpisode({ id: 'ep-B' }) };
    const b = { event: makeEvent({ id: 'evt-A' }), episode: makeEpisode({ id: 'ep-B' }) };
    expect(hoveredRegionKey(a)).toBe(hoveredRegionKey(b));
  });

  it('produces a different key when an identity changes', () => {
    const base = { event: makeEvent({ id: 'evt-A' }), episode: makeEpisode({ id: 'ep-B' }) };
    const changedEvent = {
      event: makeEvent({ id: 'evt-C' }),
      episode: makeEpisode({ id: 'ep-B' }),
    };
    const changedEpisode = {
      event: makeEvent({ id: 'evt-A' }),
      episode: makeEpisode({ id: 'ep-D' }),
    };
    expect(hoveredRegionKey(base)).not.toBe(hoveredRegionKey(changedEvent));
    expect(hoveredRegionKey(base)).not.toBe(hoveredRegionKey(changedEpisode));
  });
});
