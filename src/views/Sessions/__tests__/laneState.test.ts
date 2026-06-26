/** Unit tests for the pure lane-stack state helpers. */

import { describe, it, expect } from 'vitest';

import {
  applyOrder,
  EMPTY_LANE_PREFS,
  lanePrefsKey,
  moveLane,
  parseLanePrefs,
  toggleId,
  type LanePrefs,
} from '../laneState';

describe('parseLanePrefs', () => {
  it('returns empty prefs for null', () => {
    expect(parseLanePrefs(null)).toEqual(EMPTY_LANE_PREFS);
  });

  it('returns empty prefs for malformed JSON', () => {
    expect(parseLanePrefs('{not json')).toEqual(EMPTY_LANE_PREFS);
  });

  it('filters non-string array members defensively', () => {
    const raw = JSON.stringify({ order: ['a', 1, 'b'], hidden: ['x'], collapsed: [], preset: 5 });
    const prefs = parseLanePrefs(raw);
    expect(prefs.order).toEqual(['a', 'b']);
    expect(prefs.hidden).toEqual(['x']);
    expect(prefs.preset).toBeUndefined();
  });

  it('round-trips a valid prefs object', () => {
    const raw = JSON.stringify({
      order: ['cpap:flow', 'wear:heart_rate_intraday'],
      hidden: ['cpap:leak'],
      collapsed: ['wear:hrv_detail'],
      preset: 'cardio',
    });
    expect(parseLanePrefs(raw)).toEqual({
      order: ['cpap:flow', 'wear:heart_rate_intraday'],
      hidden: ['cpap:leak'],
      collapsed: ['wear:hrv_detail'],
      preset: 'cardio',
    });
  });

  it('round-trips measureMode: true through serialize → parse', () => {
    const raw = JSON.stringify({ order: [], hidden: [], collapsed: [], measureMode: true });
    expect(parseLanePrefs(raw).measureMode).toBe(true);
  });

  it('round-trips measureMode: false through serialize → parse', () => {
    const raw = JSON.stringify({ order: [], hidden: [], collapsed: [], measureMode: false });
    expect(parseLanePrefs(raw).measureMode).toBe(false);
  });

  it('leaves measureMode undefined when the field is absent (back-compat)', () => {
    // Prefs stored before the Measure-region feature existed have no field.
    const raw = JSON.stringify({ order: ['cpap:flow'], hidden: [], collapsed: [] });
    expect(parseLanePrefs(raw).measureMode).toBeUndefined();
  });

  it('ignores a non-boolean stored measureMode defensively', () => {
    // Matches how the parser type-guards every other field: anything not a
    // boolean (a string, a number, null) is dropped to undefined rather than
    // trusted, so corrupt/legacy storage cannot force the overlay on.
    for (const bad of ['yes', 1, 0, null, [], {}]) {
      const raw = JSON.stringify({ order: [], hidden: [], collapsed: [], measureMode: bad });
      expect(parseLanePrefs(raw).measureMode).toBeUndefined();
    }
  });
});

describe('lanePrefsKey', () => {
  it('namespaces by session id', () => {
    expect(lanePrefsKey('abc')).toBe('signal-viewer-lanes-abc');
  });
});

describe('applyOrder', () => {
  it('keeps known stored ids first, then appends new catalogue ids', () => {
    const catalogue = ['a', 'b', 'c', 'd'];
    const stored = ['c', 'a'];
    expect(applyOrder(catalogue, stored)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('drops stored ids no longer in the catalogue', () => {
    expect(applyOrder(['a', 'b'], ['x', 'b', 'a'])).toEqual(['b', 'a']);
  });

  it('falls back to catalogue order when no stored order', () => {
    expect(applyOrder(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
  });

  it('ignores duplicate stored ids', () => {
    expect(applyOrder(['a', 'b'], ['a', 'a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('moveLane', () => {
  it('moves an item down', () => {
    expect(moveLane(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });

  it('moves an item up', () => {
    expect(moveLane(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
  });

  it('clamps the destination to the bounds', () => {
    expect(moveLane(['a', 'b', 'c'], 0, -5)).toEqual(['a', 'b', 'c']);
    expect(moveLane(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
  });

  it('is a no-op for an out-of-range source', () => {
    expect(moveLane(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('toggleId', () => {
  it('adds an absent id', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('removes a present id', () => {
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('preset + collapse persistence round-trip', () => {
  // The full lane catalogue for a session with CPAP + wearable lanes.
  const catalogue = [
    'cpap:flow',
    'cpap:maskPressure',
    'cpap:leak',
    'wear:heart_rate_intraday',
    'wear:spo2_intraday',
    'wear:hrv_detail',
  ];

  /**
   * Mirror the component's effective-visibility derivation: apply the persisted
   * order, then drop hidden ids. Returns the visible ids in render order plus the
   * collapsed set, so a round-trip can be compared on EFFECTIVE state.
   */
  function effective(prefs: LanePrefs): { visible: string[]; collapsed: string[] } {
    const ordered = applyOrder(catalogue, prefs.order);
    const hidden = new Set(prefs.hidden);
    const visible = ordered.filter((id) => !hidden.has(id));
    const collapsed = ordered.filter((id) => prefs.collapsed.includes(id));
    return { visible, collapsed };
  }

  it('round-trips applied-preset visibility and collapse state through serialize → parse', () => {
    // Simulate applying the "Cardio focus" preset (hide everything except flow +
    // wearable HR/SpO₂), then collapsing one of the visible lanes — exactly what
    // the component persists.
    const preset = 'cardio';
    const keep = new Set(['cpap:flow', 'wear:heart_rate_intraday', 'wear:spo2_intraday']);
    const hidden = catalogue.filter((id) => !keep.has(id));
    const applied: LanePrefs = {
      order: applyOrder(catalogue, []), // explicit catalogue order after apply
      hidden,
      collapsed: ['wear:spo2_intraday'],
      preset,
    };

    // Serialize as SignalViewer does, then parse back.
    const restored = parseLanePrefs(JSON.stringify(applied));

    // The parsed prefs equal the applied prefs (structural round-trip).
    expect(restored).toEqual(applied);
    expect(restored.preset).toBe('cardio');

    // And the EFFECTIVE visibility + collapse derivation is identical before and
    // after persistence — the user sees the same lanes shown and collapsed.
    expect(effective(restored)).toEqual(effective(applied));
    expect(effective(restored)).toEqual({
      visible: ['cpap:flow', 'wear:heart_rate_intraday', 'wear:spo2_intraday'],
      collapsed: ['wear:spo2_intraday'],
    });
  });

  it('preserves a custom reorder + collapse across serialize → parse', () => {
    // A user-reordered, partially-collapsed stack with no active preset.
    const prefs: LanePrefs = {
      order: ['wear:heart_rate_intraday', 'cpap:flow', 'cpap:leak'],
      hidden: ['cpap:maskPressure'],
      collapsed: ['cpap:flow', 'wear:hrv_detail'],
    };

    const restored = parseLanePrefs(JSON.stringify(prefs));

    expect(restored.preset).toBeUndefined();
    expect(effective(restored)).toEqual(effective(prefs));
    // HR pinned to the top by the stored order; maskPressure hidden.
    expect(effective(restored).visible[0]).toBe('wear:heart_rate_intraday');
    expect(effective(restored).visible).not.toContain('cpap:maskPressure');
    expect(effective(restored).collapsed).toContain('cpap:flow');
  });
});
