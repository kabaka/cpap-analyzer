/**
 * Persistent-storage (eviction-protection) service.
 *
 * Browsers place IndexedDB and OPFS data in one of two storage buckets:
 *
 * - **best-effort** (the default): the user agent may silently evict the
 *   origin's data under storage pressure, on "clear site data on exit", or via
 *   OS-level disk cleanup. Mid-session eviction force-closes any open IDB
 *   connection (surfacing as "The database connection is closing"); between
 *   sessions it presents as an empty database on the next load.
 * - **persistent**: the user agent will not evict the origin's data without the
 *   user explicitly clearing it. This is what protects a lifetime of CPAP data.
 *
 * Calling {@link requestPersistentStorage} asks the browser to move this origin
 * into the persistent bucket. In Chromium the decision is *heuristic-based*
 * (driven by engagement / bookmark / installed-PWA signals) and does NOT show a
 * permission prompt or require a user gesture, so it is safe to call at startup.
 * In Firefox it may prompt; either way this module never throws and never
 * performs any network or telemetry I/O — `persist()` only protects data that
 * already lives locally, in line with the project's privacy-first principle.
 *
 * @module services/storage/persistentStorage
 */

/**
 * Outcome of a persistence request.
 *
 * - `'persisted'`  — storage is (now or already) in the durable bucket.
 * - `'denied'`     — the API is available but the browser declined to persist.
 * - `'unsupported'`— the Storage persistence API is unavailable, or a call to
 *                    it threw (treated as unsupported rather than surfaced).
 */
export type PersistenceStatus = 'persisted' | 'denied' | 'unsupported';

/**
 * Whether the StorageManager persistence API is available in this environment.
 *
 * Feature-detects both `navigator.storage.persist` and
 * `navigator.storage.persisted`, since a useful flow needs both. Returns
 * `false` in non-secure contexts and environments without the API (e.g. older
 * browsers, some test runners) rather than throwing.
 */
export function isPersistenceApiAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.persist === 'function' &&
    typeof navigator.storage.persisted === 'function'
  );
}

/**
 * Whether this origin's storage is already in the durable (persistent) bucket.
 *
 * Wraps `navigator.storage.persisted()`. Returns `false` if the API is
 * unsupported or the call throws — callers can safely treat a `false` result as
 * "not known to be persisted" without needing to handle exceptions.
 */
export async function isStoragePersisted(): Promise<boolean> {
  if (!isPersistenceApiAvailable()) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

/**
 * Request that this origin's storage be moved to the durable (persistent)
 * bucket, protecting IndexedDB + OPFS data from automatic eviction.
 *
 * Behaviour:
 * - If storage is already persisted, returns `'persisted'` immediately WITHOUT
 *   re-requesting (a no-op call still resolves `true`, but skipping it avoids
 *   any redundant heuristic re-evaluation).
 * - Otherwise calls `navigator.storage.persist()` and maps the boolean result
 *   to `'persisted'` (granted) or `'denied'` (declined).
 * - If the API is unsupported, or any call throws, returns `'unsupported'`.
 *
 * This function NEVER throws and has no side effects beyond the single
 * `navigator.storage.*` calls — making it safe to fire-and-forget at startup.
 */
export async function requestPersistentStorage(): Promise<PersistenceStatus> {
  if (!isPersistenceApiAvailable()) return 'unsupported';
  try {
    // Already durable: nothing to request.
    if (await navigator.storage.persisted()) return 'persisted';
    const granted = await navigator.storage.persist();
    return granted ? 'persisted' : 'denied';
  } catch {
    // Map any unexpected failure to 'unsupported' so callers never have to
    // handle exceptions from a best-effort, optional protection step.
    return 'unsupported';
  }
}
