import { describe, it, expect } from 'vitest';
import { buildSyncNights } from './syncNights';

describe('buildSyncNights', () => {
  it('builds one night per session with its wall-clock window', () => {
    const nights = buildSyncNights([
      { date: '2026-01-15', startTime: '2026-01-15T22:30:00', endTime: '2026-01-16T06:15:00' },
    ]);
    expect(nights).toHaveLength(1);
    const night = nights[0]!;
    expect(night.date).toBe('2026-01-15');
    expect(night.window.start).toBe('2026-01-15T22:30:00');
    expect(night.window.end).toBe('2026-01-16T06:15:00');
  });

  it('lists both civil dates for a midnight-spanning night, ascending', () => {
    const [night] = buildSyncNights([
      { date: '2026-01-15', startTime: '2026-01-15T23:00:00', endTime: '2026-01-16T07:00:00' },
    ]);
    expect(night!.civilDates).toEqual(['2026-01-15', '2026-01-16']);
  });

  it('lists a single civil date for a within-day night', () => {
    const [night] = buildSyncNights([
      { date: '2026-03-01', startTime: '2026-03-01T01:00:00', endTime: '2026-03-01T08:00:00' },
    ]);
    expect(night!.civilDates).toEqual(['2026-03-01']);
  });

  it('strips a timezone offset / Z from the wall-clock window', () => {
    const [night] = buildSyncNights([
      { date: '2026-01-15', startTime: '2026-01-15T22:00:00Z', endTime: '2026-01-16T06:00:00Z' },
    ]);
    expect(night!.window.start).toBe('2026-01-15T22:00:00');
    expect(night!.window.end).toBe('2026-01-16T06:00:00');
  });

  it('de-duplicates sessions that share a date', () => {
    const nights = buildSyncNights([
      { date: '2026-01-15', startTime: '2026-01-15T22:00:00', endTime: '2026-01-16T06:00:00' },
      { date: '2026-01-15', startTime: '2026-01-15T23:00:00', endTime: '2026-01-16T04:00:00' },
    ]);
    expect(nights).toHaveLength(1);
  });

  it('always includes the canonical date in civilDates', () => {
    const [night] = buildSyncNights([
      { date: '2026-01-15', startTime: '2026-01-15T20:00:00', endTime: '2026-01-15T23:00:00' },
    ]);
    expect(night!.civilDates).toContain('2026-01-15');
  });
});
