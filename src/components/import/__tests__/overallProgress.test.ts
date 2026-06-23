import { describe, it, expect } from 'vitest';

import { overallPercent, stageFraction } from '../overallProgress';
import { jobProgress, stage } from './fixtures';

describe('stageFraction', () => {
  it('credits done/skipped fully and pending nothing', () => {
    expect(stageFraction(stage({ id: 'a', state: 'done' }))).toBe(1);
    expect(stageFraction(stage({ id: 'a', state: 'skipped' }))).toBe(1);
    expect(stageFraction(stage({ id: 'a', state: 'pending' }))).toBe(0);
  });

  it('uses completed/total for a determinate active stage', () => {
    const s = stage({ id: 'a', state: 'active', determinate: true, completed: 25, total: 100 });
    expect(stageFraction(s)).toBeCloseTo(0.25);
  });

  it('holds an indeterminate active stage at the floor (0)', () => {
    const s = stage({ id: 'a', state: 'active', determinate: false, completed: 999, total: null });
    expect(stageFraction(s)).toBe(0);
  });

  it('clamps over-complete fractions to 1', () => {
    const s = stage({ id: 'a', state: 'active', determinate: true, completed: 150, total: 100 });
    expect(stageFraction(s)).toBe(1);
  });
});

describe('overallPercent (cpap weighting: scan5 parse60 build20 store15)', () => {
  it('is 5 when only scan is done (everything else pending)', () => {
    const p = jobProgress({
      kind: 'cpap',
      stages: [
        stage({ id: 'scan', state: 'done' }),
        stage({ id: 'parse', state: 'pending' }),
        stage({ id: 'build', state: 'pending' }),
        stage({ id: 'store', state: 'pending' }),
      ],
    });
    expect(overallPercent(p)).toBe(5);
  });

  it('credits half of parse: scan5 + 0.5*60 = 35', () => {
    const p = jobProgress({
      kind: 'cpap',
      stages: [
        stage({ id: 'scan', state: 'done' }),
        stage({ id: 'parse', state: 'active', determinate: true, completed: 50, total: 100 }),
        stage({ id: 'build', state: 'pending' }),
        stage({ id: 'store', state: 'pending' }),
      ],
    });
    expect(overallPercent(p)).toBe(35);
  });

  it('holds parse at the floor while it is indeterminate (scan5 only)', () => {
    const p = jobProgress({
      kind: 'cpap',
      stages: [
        stage({ id: 'scan', state: 'done' }),
        stage({ id: 'parse', state: 'active', determinate: false, completed: 10, total: null }),
        stage({ id: 'build', state: 'pending' }),
        stage({ id: 'store', state: 'pending' }),
      ],
    });
    expect(overallPercent(p)).toBe(5);
  });

  it('reaches 100 when all stages are done', () => {
    const p = jobProgress({
      kind: 'cpap',
      stages: [
        stage({ id: 'scan', state: 'done' }),
        stage({ id: 'parse', state: 'done' }),
        stage({ id: 'build', state: 'done' }),
        stage({ id: 'store', state: 'done' }),
      ],
    });
    expect(overallPercent(p)).toBe(100);
  });
});

describe('overallPercent (fitbit weighting: scan5 import95)', () => {
  it('credits a partially-complete import stage', () => {
    const p = jobProgress({
      kind: 'fitbit',
      stages: [
        stage({ id: 'scan', state: 'done' }),
        stage({ id: 'import', state: 'active', determinate: true, completed: 1, total: 2 }),
      ],
    });
    // scan 5 + 0.5*95 = 52.5 → rounds to 53
    expect(overallPercent(p)).toBe(53);
  });
});

describe('overallPercent (terminal states)', () => {
  it('always reports 100 for a complete job', () => {
    const p = jobProgress({
      status: 'complete',
      stages: [stage({ id: 'scan', state: 'pending' })],
    });
    expect(overallPercent(p)).toBe(100);
  });

  it('reports partial progress for an error job (never snapped to 100)', () => {
    const p = jobProgress({
      kind: 'cpap',
      status: 'error',
      stages: [
        stage({ id: 'scan', state: 'done' }),
        stage({ id: 'parse', state: 'error', determinate: true, completed: 30, total: 100 }),
        stage({ id: 'build', state: 'pending' }),
        stage({ id: 'store', state: 'pending' }),
      ],
    });
    // scan5 + 0.3*60 = 23
    expect(overallPercent(p)).toBe(23);
  });
});
