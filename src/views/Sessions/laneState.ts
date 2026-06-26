/**
 * Pure lane-stack state helpers: ordering, visibility, collapse, and
 * localStorage (de)serialisation for the Signal Viewer. Separated from the React
 * component so the reducer-like operations are unit-testable without a DOM.
 *
 * @module views/Sessions/laneState
 */

/** Persisted, per-session lane preferences. */
export interface LanePrefs {
  /** Explicit lane order by lane id; ids absent here fall back to catalogue order. */
  readonly order: readonly string[];
  /** Lane ids that are hidden (toggled off). */
  readonly hidden: readonly string[];
  /** Lane ids collapsed to a stub. */
  readonly collapsed: readonly string[];
  /** Active drawer preset key, if any. */
  readonly preset?: string;
  /**
   * Whether to render the app-computed breathing-detection overlay
   * (PB / CSR candidate episodes). Defaults to `true` when undefined for
   * back-compat with prefs stored before the detection lane existed.
   */
  readonly showDetections?: boolean;
  /**
   * Whether the "Measure region" statistics overlay is stuck on. Persisted so
   * the toggle survives a reload, but the DRAWN region itself is transient and
   * never stored (see the Signal Viewer's region-stats wiring). Defaults to
   * `false`/`undefined` (off) for back-compat with prefs stored before the
   * feature existed.
   */
  readonly measureMode?: boolean;
}

export const EMPTY_LANE_PREFS: LanePrefs = { order: [], hidden: [], collapsed: [] };

const STORAGE_PREFIX = 'signal-viewer-lanes-';

/** localStorage key for a session's lane prefs. */
export function lanePrefsKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

/** Parse persisted prefs defensively; returns empty prefs on any problem. */
export function parseLanePrefs(raw: string | null): LanePrefs {
  if (!raw) return EMPTY_LANE_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<LanePrefs>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order.filter((x) => typeof x === 'string') : [],
      hidden: Array.isArray(parsed.hidden)
        ? parsed.hidden.filter((x) => typeof x === 'string')
        : [],
      collapsed: Array.isArray(parsed.collapsed)
        ? parsed.collapsed.filter((x) => typeof x === 'string')
        : [],
      preset: typeof parsed.preset === 'string' ? parsed.preset : undefined,
      showDetections:
        typeof parsed.showDetections === 'boolean' ? parsed.showDetections : undefined,
      measureMode: typeof parsed.measureMode === 'boolean' ? parsed.measureMode : undefined,
    };
  } catch {
    return EMPTY_LANE_PREFS;
  }
}

/**
 * Apply a persisted order to a catalogue of lane ids: known ids first (in stored
 * order), then any new ids in catalogue order so freshly-available lanes always
 * appear. Stored ids no longer in the catalogue are dropped.
 */
export function applyOrder(catalogue: readonly string[], order: readonly string[]): string[] {
  const known = new Set(catalogue);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of order) {
    if (known.has(id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  for (const id of catalogue) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  return result;
}

/** Move the lane at `from` to `to`, returning a new array (clamped, no-op safe). */
export function moveLane(order: readonly string[], from: number, to: number): string[] {
  const next = order.slice();
  if (from < 0 || from >= next.length) return next;
  const clampedTo = Math.max(0, Math.min(next.length - 1, to));
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return order.slice();
  next.splice(clampedTo, 0, moved);
  return next;
}

/** Toggle membership of `id` in a set-like string list, returning a new array. */
export function toggleId(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}
