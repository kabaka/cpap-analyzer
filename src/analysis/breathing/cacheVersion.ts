/**
 * Cache-identity constants and helpers for the persisted per-night
 * breathing-detection cache (ADR 0023 / IndexedDB v4).
 *
 * Co-located with the detector so a contributor changing the algorithm sees the
 * version constant right next to the math it guards. Every symbol here is pure,
 * synchronous, deterministic, and free of any DOM / IndexedDB / I/O dependency,
 * so it is safe to call from inside a Web Worker (the detector runs in one).
 *
 * See docs/analysis/breathing-detection-cache-storage.md §4 (invalidation) and
 * ADR docs/decisions/0023-persisted-per-night-breathing-detection-cache.md.
 *
 * @module analysis/breathing/cacheVersion
 */

import { DEFAULT_PERIODIC_BREATHING_PARAMS, type PeriodicBreathingParams } from './types';

/**
 * Detector algorithm version. BUMP THIS (and only this) whenever
 * {@link import('./detectPeriodicBreathing').detectPeriodicBreathing} changes in
 * a way that can change its output for the same input + params — a new morphology
 * rule, a changed confidence formula, an envelope-builder change, a
 * classification-threshold change, etc.
 *
 * A bump auto-invalidates every persisted breathing-detection record at the old
 * version: those records are keyed by an `id` that embeds this version, so a
 * read for the current `id` simply misses and the consumer recomputes. The stale
 * rows are then reclaimed by the version-eviction sweep (storage spec §4.3/§6).
 *
 * A MISSED bump serves stale clinical candidates — this is the load-bearing
 * correctness invariant of ADR 0023. Guard it with the tests in
 * `__tests__/cacheVersion.test.ts` (storage spec §4.4).
 */
export const BREATHING_ALGO_VERSION = 1 as const;

/**
 * Stable, order-independent hash of the EFFECTIVE parameter set actually applied
 * by the detector (defaults merged with any overrides). Pure, deterministic, no
 * I/O, safe to call in a worker.
 *
 * Stability requirements (so an equivalent param set never produces two hashes):
 *  - Keys are serialized in SORTED order, so property-insertion order does not
 *    affect the digest.
 *  - {@link PeriodicBreathingParams} is a flat object whose only non-primitive
 *    field is the `cycleLenTypicalRange` tuple; arrays/tuples serialize
 *    positionally via `JSON.stringify`, which is itself stable for arrays, so a
 *    single sorted-key `JSON.stringify` pass over the shallow object is
 *    sufficient. Numbers serialize canonically.
 *  - EVERY field of {@link PeriodicBreathingParams} is included (we iterate the
 *    object's own keys), so any tuning change to any field is caught.
 *
 * NOTE: changing this hash *function* silently invalidates the entire cache.
 * That is acceptable (a cold cache only recomputes) but wasteful; treat any
 * change to the function as equivalent to a {@link BREATHING_ALGO_VERSION} bump.
 *
 * @param params - The effective {@link PeriodicBreathingParams} to fingerprint.
 * @returns A short hex digest uniquely identifying the parameter set.
 */
export function hashBreathingParams(params: PeriodicBreathingParams): string {
  // PeriodicBreathingParams has no index signature, so widen via `unknown` to a
  // string-indexed record for key iteration. This is a read-only structural view
  // of the same object (no `any`); the cast cannot lose type safety here.
  const record = params as unknown as Record<string, unknown>;
  const sorted = Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = record[key];
      return acc;
    }, {});
  return djb2Hex(JSON.stringify(sorted));
}

/**
 * Hash of the app's default {@link PeriodicBreathingParams} — the only parameter
 * set used by the v1 surfaces (the app applies defaults only today). This is the
 * `paramHash` folded into the cache key on every current read/write.
 *
 * Guarded by an explicit-value test: if this value changes, the defaults were
 * tuned and a conscious decision is required (accept the new hash, or bump
 * {@link BREATHING_ALGO_VERSION}). See `__tests__/cacheVersion.test.ts`.
 */
export const DEFAULT_BREATHING_PARAM_HASH = hashBreathingParams(DEFAULT_PERIODIC_BREATHING_PARAMS);

/**
 * Build the composite primary key for a breathing-detection record:
 * `` `${sessionId}::${algoVersion}::${paramHash}` ``.
 *
 * `::` is a safe separator — `sessionId` is a UUID v4, `algoVersion` an integer,
 * and `paramHash` a hex digest, none of which contain `::`. Folding the full
 * cache identity into the key means a `get(id)` is an exact validity check and a
 * re-detect under the same version overwrites in place (idempotent put).
 *
 * @param sessionId - Foreign key to `sessions.id`.
 * @param algoVersion - Detector algorithm version (see {@link BREATHING_ALGO_VERSION}).
 * @param paramHash - Effective-param digest (see {@link hashBreathingParams}).
 * @returns The composite record id.
 */
export function makeBreathingDetectionId(
  sessionId: string,
  algoVersion: number,
  paramHash: string,
): string {
  return `${sessionId}::${String(algoVersion)}::${paramHash}`;
}

/**
 * Small dependency-free string hash (djb2) rendered as unsigned 32-bit hex.
 * Deterministic and synchronous. Collision risk is irrelevant for correctness
 * here: the only hazard is a false *match* between two genuinely different param
 * sets, and djb2 over a tiny sorted-key JSON string is more than adequate to
 * avoid that for the small, structured {@link PeriodicBreathingParams} space.
 */
function djb2Hex(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}
