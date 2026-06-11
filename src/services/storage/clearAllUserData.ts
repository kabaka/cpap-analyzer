/**
 * Total user-data wipe.
 *
 * Single source of truth for the application's "delete all data" action. Both
 * the Settings (Privacy & Storage) and Data Management views invoke this so the
 * delete-everything sequence can never drift between callers.
 *
 * This is a **privacy-critical** path (Core Principle #1): "delete everything"
 * must be total. It wipes every durable and in-memory store the app owns:
 *
 *  - IndexedDB — structured session/aggregate/analysis records.
 *  - OPFS — full-resolution signal data and the downsample cache.
 *  - localStorage — every app-owned key (zustand-persisted stores under the
 *    `cpap-` namespace, plus the dynamic per-session `signal-viewer-hidden-*`
 *    UI state written by the signal viewer).
 *  - In-memory analysis/session cache held in the data store.
 *  - The persisted settings store, reset to defaults.
 *
 * Failures are surfaced (the function rejects) rather than swallowed: a silent
 * failure here could leave therapy data on disk while telling the user it was
 * deleted, which would violate the privacy guarantee. Steps are ordered so that
 * a failure leaves the system in a fail-loud state — no step is wrapped in a
 * silent catch.
 *
 * @module services/storage/clearAllUserData
 */

import { useDataStore } from '@/stores/useDataStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { getDB, resetDB } from './getDB';
import { OPFSService } from './OPFSService';

/**
 * Prefixes for every localStorage key the application owns.
 *
 * A key is app-owned if it starts with one of these. Matching by prefix (rather
 * than a hardcoded key list) is what closes the residual-metadata gap: the
 * signal viewer writes one `signal-viewer-hidden-<sessionId>` key per session,
 * so the full set is only known at runtime.
 *
 * Derived from an exhaustive audit of every localStorage writer in `src/`:
 *  - `cpap-`                — zustand persist stores: `cpap-theme`
 *                            (useAppStore), `cpap-settings` (useSettingsStore).
 *  - `signal-viewer-hidden-` — per-session hidden-channel UI state
 *                            (SignalViewer.tsx).
 *
 * If a new localStorage writer is added, register its prefix here so the wipe
 * stays total.
 */
const APP_LOCAL_STORAGE_PREFIXES = ['cpap-', 'signal-viewer-hidden-'] as const;

/**
 * Remove every app-owned key from a Web Storage area, matched by prefix.
 *
 * The key list is snapshotted up front because `removeItem` mutates the live
 * key index — iterating the index while deleting from it would skip keys.
 *
 * @param storage - The storage area to clear (localStorage or sessionStorage).
 */
function clearAppKeys(storage: Storage): void {
  // Snapshot before removing: removeItem mutates the index and re-indexes
  // remaining keys, so iterating live would skip entries.
  const keys = Object.keys(storage);
  for (const key of keys) {
    if (APP_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      storage.removeItem(key);
    }
  }
}

/**
 * Permanently delete all user data from every store the app controls.
 *
 * Resolves only once every durable and in-memory store has been wiped. Rejects
 * if any step fails, leaving the caller responsible for surfacing the error —
 * never report success on a partial deletion.
 *
 * @throws If IndexedDB or OPFS deletion fails. The error propagates unchanged.
 */
export async function clearAllUserData(): Promise<void> {
  // 1. IndexedDB — structured records. Destroy the database, then drop the
  //    singleton so a subsequent access reopens a fresh, empty database.
  const db = await getDB();
  await db.destroy();
  resetDB();

  // 2. OPFS — full-resolution signal data and downsample cache. Self-initializes
  //    on demand; a failure here means therapy data may remain on disk, so it
  //    must propagate rather than be swallowed.
  await new OPFSService().deleteAll();

  // 3. localStorage — every app-owned key, including the dynamic per-session
  //    `signal-viewer-hidden-*` keys that leak session IDs and channel choices.
  clearAppKeys(localStorage);

  // 4. sessionStorage — no known app writers today, but clear app-owned keys
  //    defensively so a future writer can't leave residue behind this wipe.
  clearAppKeys(sessionStorage);

  // 5. In-memory analysis/session cache held in the data store.
  useDataStore.getState().clearCache();

  // 6. Persisted settings store — reset to defaults. (The `cpap-settings`
  //    localStorage entry was already removed in step 3; this resets the
  //    live in-memory store state.)
  useSettingsStore.getState().resetToDefaults();
}
