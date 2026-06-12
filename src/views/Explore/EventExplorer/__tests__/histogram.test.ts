import { describe, it, expect } from 'vitest';
import type { Event } from '@/types/events';
import { binEvents, binValues } from '../histogram';

let id = 0;
function ev(duration: number, type: Event['type'] = 'ObstructiveApnea'): Event {
  id += 1;
  return {
    id: `e${id}`,
    sessionId: 's',
    type,
    timestamp: 0,
    duration,
    severity: null,
    pressure: null,
    epap: null,
    ipap: null,
    leak: null,
    spo2: null,
    clusterId: null,
  };
}

describe('binEvents', () => {
  it('bins durations into fixed-width aligned bins', () => {
    const events = [ev(2), ev(7), ev(8), ev(23)];
    const { bins } = binEvents(events, 10, (e) => e.duration);
    expect(bins).toHaveLength(3); // 0-10, 10-20, 20-30
    expect(bins[0]).toMatchObject({ start: 0, end: 10, count: 3 });
    expect(bins[1]).toMatchObject({ start: 10, end: 20, count: 0 });
    expect(bins[2]).toMatchObject({ start: 20, end: 30, count: 1 });
  });

  it('tracks per-type counts for stacking', () => {
    const events = [ev(5, 'ObstructiveApnea'), ev(6, 'Hypopnea'), ev(7, 'Hypopnea')];
    const { bins } = binEvents(events, 10, (e) => e.duration);
    expect(bins[0]?.byType).toEqual({ ObstructiveApnea: 1, Hypopnea: 2 });
  });

  it('skips null and negative values', () => {
    const events = [ev(5), { ...ev(0), duration: -1 }];
    const { bins } = binEvents(events, 10, (e) => (e.duration < 0 ? null : e.duration));
    expect(bins[0]?.count).toBe(1);
  });

  it('returns empty for non-positive bin width or empty input', () => {
    expect(binEvents([ev(5)], 0, (e) => e.duration)).toMatchObject({ bins: [] });
    expect(binEvents([], 10, (e) => e.duration)).toMatchObject({ bins: [] });
  });

  it('aggregates outliers into an explicit overflow bin (regression for M6)', () => {
    // 10 normal events at 5s + one outlier at 6000s. Without an overflow cap
    // this previously expanded to ~600 bins, blowing up the bar chart.
    const events: Event[] = Array.from({ length: 10 }, () => ev(5));
    events.push(ev(6000));
    const { bins, overflowCount, overflowThreshold } = binEvents(
      events,
      10,
      (e) => e.duration,
      's',
      5,
    );
    // 4 normal bins kept + 1 overflow bin = 5 total.
    expect(bins).toHaveLength(5);
    const overflowBin = bins[bins.length - 1];
    expect(overflowBin?.overflow).toBe(true);
    expect(overflowBin?.count).toBe(1);
    expect(overflowBin?.label).toMatch(/^≥40s\s*\(1 omitted\)$/);
    expect(overflowCount).toBe(1);
    expect(overflowThreshold).toBe(40);
  });

  it('does not emit an overflow bin when below maxBins', () => {
    const events = [ev(5), ev(15), ev(25)];
    const result = binEvents(events, 10, (e) => e.duration, 's', 60);
    expect(result.overflowCount).toBe(0);
    expect(result.overflowThreshold).toBeNull();
    expect(result.bins.every((b) => !b.overflow)).toBe(true);
  });
});

describe('binValues', () => {
  it('bins a raw numeric array', () => {
    const { bins } = binValues([5, 35, 65], 30, 40);
    expect(bins).toHaveLength(3);
    expect(bins[0]).toMatchObject({ start: 0, count: 1 });
    expect(bins[1]).toMatchObject({ start: 30, count: 1 });
  });

  it('aggregates beyond maxBins into a visible overflow bin (regression for M1)', () => {
    // The IntervalsView lens calls binValues(intervals, 30, 40, 's'). Before
    // this fix, intervals above 1200s were SILENTLY dropped from the chart.
    const values = Array.from({ length: 100 }, (_, i) => i * 30);
    const { bins, overflowCount, overflowThreshold } = binValues(values, 30, 5);
    // 4 normal bins kept + 1 overflow bin = 5 total.
    expect(bins).toHaveLength(5);
    const overflow = bins[bins.length - 1];
    expect(overflow?.overflow).toBe(true);
    expect(overflow?.label).toMatch(/^≥120s\s*\(96 omitted\)$/);
    expect(overflowCount).toBe(96);
    expect(overflowThreshold).toBe(120);
  });
});
