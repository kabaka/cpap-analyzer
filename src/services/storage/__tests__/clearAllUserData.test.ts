import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocked dependencies
//
// clearAllUserData orchestrates six durable/in-memory wipes. We unit-test the
// orchestration contract — that every store is wiped, that app-prefixed Web
// Storage keys (and only those) are removed, and that failures propagate — so
// every collaborator is mocked. The real durable behaviour of each collaborator
// is covered by its own suite (OPFSService.test.ts, IndexedDBService.test.ts,
// getDB.test.ts).
// ---------------------------------------------------------------------------

const destroy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const getDB = vi.fn<() => Promise<{ destroy: typeof destroy }>>();
const resetDB = vi.fn<() => void>();

vi.mock('@/services/storage/getDB', () => ({
  getDB: () => getDB(),
  resetDB: () => resetDB(),
}));

const deleteAll = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

// Tracks every `new OPFSService()` so construction-count assertions still work.
// Kept separate from the instance shape so a mock-state reset can never strip
// `deleteAll` off an instance (the cold-start flake this mock was rewritten to
// fix). `clearAllMocks` resets this spy's call count for per-test isolation,
// which is exactly what we want.
const constructOPFSService = vi.fn<() => void>();

// A plain class — NOT a `vi.fn()` factory — so instances ALWAYS carry a
// `deleteAll` method regardless of any `clearAllMocks`/`resetAllMocks` that runs
// between module load and the test. `deleteAll` delegates to the spy above so
// per-test behaviour (resolve / reject / call counts) is still controllable.
vi.mock('@/services/storage/OPFSService', () => ({
  OPFSService: class {
    constructor() {
      constructOPFSService();
    }
    deleteAll = () => deleteAll();
  },
}));

const clearCache = vi.fn<() => void>();

vi.mock('@/stores/useDataStore', () => ({
  useDataStore: {
    getState: () => ({ clearCache }),
  },
}));

const resetToDefaults = vi.fn<() => void>();

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ resetToDefaults }),
  },
}));

import { clearAllUserData } from '@/services/storage/clearAllUserData';

// ---------------------------------------------------------------------------
// In-memory Web Storage with real `Object.keys` semantics
//
// The global test setup (src/test/setup.ts) installs a Map-backed localStorage
// whose `Object.keys()` returns its METHOD names, not the stored keys — but
// clearAppKeys() snapshots keys via `Object.keys(storage)` and relies on real
// Storage semantics (own enumerable properties == stored keys). We install a
// Proxy-backed Storage that behaves like the browser's so the prefix sweep is
// exercised faithfully, then restore the original descriptors afterwards.
// ---------------------------------------------------------------------------

function createStorage(): Storage {
  const store = new Map<string, string>();
  const api = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };

  // A Proxy whose own enumerable keys are the stored keys, mirroring how a real
  // Storage exposes entries as own properties to Object.keys / for..in.
  return new Proxy(api, {
    get(target, prop: string, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      return store.has(prop) ? store.get(prop) : undefined;
    },
    has(target, prop: string) {
      return prop in target || store.has(prop);
    },
    ownKeys() {
      return Array.from(store.keys());
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (store.has(prop)) {
        return {
          enumerable: true,
          configurable: true,
          writable: true,
          value: store.get(prop),
        };
      }
      return undefined;
    },
  }) as unknown as Storage;
}

describe('clearAllUserData', () => {
  let localDescriptor: PropertyDescriptor | undefined;
  let sessionDescriptor: PropertyDescriptor | undefined;
  let localStore: Storage;
  let sessionStore: Storage;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default happy path: getDB resolves a db whose destroy() succeeds.
    getDB.mockResolvedValue({ destroy });
    destroy.mockResolvedValue(undefined);
    deleteAll.mockResolvedValue(undefined);
    // No OPFSService re-init needed: it's a plain class whose instances always
    // carry `deleteAll`, so no mock-state reset can strip the method.

    localDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    sessionDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');

    localStore = createStorage();
    sessionStore = createStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStore,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStore,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (localDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', localDescriptor);
    }
    if (sessionDescriptor) {
      Object.defineProperty(globalThis, 'sessionStorage', sessionDescriptor);
    } else {
      // jsdom has no sessionStorage by default; remove our stub cleanly.
      Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'sessionStorage');
    }
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Case 1: the HIGH-finding privacy regression guard (localStorage)
  // -----------------------------------------------------------------------

  describe('localStorage prefix sweep (privacy regression guard)', () => {
    it('removes every app-prefixed key — including all signal-viewer-lanes-* and legacy signal-viewer-hidden-* — and leaves non-app keys untouched', async () => {
      localStorage.setItem('cpap-theme', 'dark');
      localStorage.setItem('cpap-settings', '{"foo":1}');
      // Current per-session lane UI state.
      localStorage.setItem('signal-viewer-lanes-session-1', '{"order":["cpap:flow"]}');
      localStorage.setItem('signal-viewer-lanes-session-2', '{"hidden":["cpap:leak"]}');
      // Legacy per-session hidden-channel keys from earlier builds.
      localStorage.setItem('signal-viewer-hidden-session-1', '["Flow"]');
      localStorage.setItem('signal-viewer-hidden-abc-def-ghi', '["SpO2"]');
      localStorage.setItem('unrelated-thing', 'keep-me');

      await clearAllUserData();

      // Every app-owned key is gone.
      expect(localStorage.getItem('cpap-theme')).toBeNull();
      expect(localStorage.getItem('cpap-settings')).toBeNull();
      expect(localStorage.getItem('signal-viewer-lanes-session-1')).toBeNull();
      expect(localStorage.getItem('signal-viewer-lanes-session-2')).toBeNull();
      expect(localStorage.getItem('signal-viewer-hidden-session-1')).toBeNull();
      expect(localStorage.getItem('signal-viewer-hidden-abc-def-ghi')).toBeNull();

      // No signal-viewer-* residue of any kind survives.
      const survivors = Object.keys(localStorage);
      expect(survivors.filter((k) => k.startsWith('signal-viewer-lanes-'))).toEqual([]);
      expect(survivors.filter((k) => k.startsWith('signal-viewer-hidden-'))).toEqual([]);
      expect(survivors.filter((k) => k.startsWith('cpap-'))).toEqual([]);

      // The unrelated third-party key is preserved — the sweep is scoped.
      expect(localStorage.getItem('unrelated-thing')).toBe('keep-me');
      expect(survivors).toEqual(['unrelated-thing']);
    });
  });

  // -----------------------------------------------------------------------
  // Case 2: the same prefix sweep for sessionStorage
  // -----------------------------------------------------------------------

  describe('sessionStorage prefix sweep', () => {
    it('removes app-prefixed keys and preserves unrelated keys', async () => {
      sessionStorage.setItem('cpap-draft', 'x');
      sessionStorage.setItem('signal-viewer-hidden-s9', '["Flow"]');
      sessionStorage.setItem('analytics-opt-in', 'keep');

      await clearAllUserData();

      expect(sessionStorage.getItem('cpap-draft')).toBeNull();
      expect(sessionStorage.getItem('signal-viewer-hidden-s9')).toBeNull();
      expect(sessionStorage.getItem('analytics-opt-in')).toBe('keep');
      expect(Object.keys(sessionStorage)).toEqual(['analytics-opt-in']);
    });
  });

  // -----------------------------------------------------------------------
  // Case 3: durable + in-memory wipes are all invoked
  // -----------------------------------------------------------------------

  describe('invokes every durable and in-memory wipe', () => {
    it('destroys IndexedDB then resets the singleton, deletes OPFS, clears cache, and resets settings', async () => {
      await clearAllUserData();

      // IndexedDB destroy path: getDB() -> db.destroy() -> resetDB().
      expect(getDB).toHaveBeenCalledTimes(1);
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(resetDB).toHaveBeenCalledTimes(1);

      // OPFS: a service is constructed and deleteAll() is called.
      expect(constructOPFSService).toHaveBeenCalledTimes(1);
      expect(deleteAll).toHaveBeenCalledTimes(1);

      // In-memory cache + persisted settings.
      expect(clearCache).toHaveBeenCalledTimes(1);
      expect(resetToDefaults).toHaveBeenCalledTimes(1);
    });

    it('destroys the database before dropping the singleton (resetDB after destroy)', async () => {
      const order: string[] = [];
      destroy.mockImplementation(async () => {
        order.push('destroy');
      });
      resetDB.mockImplementation(() => {
        order.push('resetDB');
      });

      await clearAllUserData();

      expect(order).toEqual(['destroy', 'resetDB']);
    });
  });

  // -----------------------------------------------------------------------
  // Case 4: fail-loud — failures propagate, are not swallowed
  // -----------------------------------------------------------------------

  describe('fail-loud propagation', () => {
    it('rejects when OPFS deleteAll() rejects', async () => {
      deleteAll.mockRejectedValue(new Error('OPFS gone wrong'));

      await expect(clearAllUserData()).rejects.toThrow('OPFS gone wrong');
    });

    it('rejects when IndexedDB destroy() rejects', async () => {
      destroy.mockRejectedValue(new Error('IndexedDB destroy failed'));

      await expect(clearAllUserData()).rejects.toThrow('IndexedDB destroy failed');
    });

    it('does not reach later steps when an earlier durable wipe rejects', async () => {
      destroy.mockRejectedValue(new Error('IndexedDB destroy failed'));

      await expect(clearAllUserData()).rejects.toThrow();

      // OPFS, cache, and settings steps run after IndexedDB and must not fire.
      expect(deleteAll).not.toHaveBeenCalled();
      expect(clearCache).not.toHaveBeenCalled();
      expect(resetToDefaults).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Case 5: snapshot-before-remove correctness (no key skipped)
  // -----------------------------------------------------------------------

  describe('snapshot-before-remove correctness', () => {
    it('removes all app keys even when many are present (no live-index skip)', async () => {
      // Interleave app and non-app keys so a naive live-index iteration that
      // re-indexes on removeItem would skip some app keys.
      const appKeys: string[] = [];
      for (let i = 0; i < 12; i++) {
        const key = `signal-viewer-hidden-session-${i}`;
        appKeys.push(key);
        localStorage.setItem(key, `["c${i}"]`);
        localStorage.setItem(`cpap-store-${i}`, `v${i}`);
        appKeys.push(`cpap-store-${i}`);
        localStorage.setItem(`keep-${i}`, `n${i}`);
      }

      await clearAllUserData();

      // Not a single app key survives.
      for (const key of appKeys) {
        expect(localStorage.getItem(key)).toBeNull();
      }
      const survivors = Object.keys(localStorage);
      expect(survivors).toHaveLength(12);
      expect(survivors.every((k) => k.startsWith('keep-'))).toBe(true);
    });
  });
});
