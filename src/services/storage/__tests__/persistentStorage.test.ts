import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isPersistenceApiAvailable,
  isStoragePersisted,
  requestPersistentStorage,
} from '@/services/storage/persistentStorage';

// ---------------------------------------------------------------------------
// Test scaffolding: install/restore a controllable navigator.storage shim.
//
// The shared test setup (src/test/setup.ts) defines navigator.storage with only
// `getDirectory` (no `persist`/`persisted`), so by default the persistence API
// is reported as unavailable. Each test installs its own storage object exposing
// `persist`/`persisted` as vi.fn()s, then restores the original afterwards so no
// state leaks between tests.
// ---------------------------------------------------------------------------

type StorageShim = Partial<{
  persist: ReturnType<typeof vi.fn>;
  persisted: ReturnType<typeof vi.fn>;
  getDirectory: unknown;
}>;

const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');

/** Replace `navigator.storage` with `shim` (or remove it entirely if undefined). */
function setNavigatorStorage(shim: StorageShim | undefined): void {
  Object.defineProperty(navigator, 'storage', {
    value: shim,
    configurable: true,
    writable: true,
  });
}

function restoreNavigatorStorage(): void {
  if (originalDescriptor) {
    Object.defineProperty(navigator, 'storage', originalDescriptor);
  } else {
    // Original environment had no navigator.storage at all.
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'storage');
  }
}

describe('persistentStorage', () => {
  afterEach(() => {
    restoreNavigatorStorage();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // isPersistenceApiAvailable — feature detection of BOTH methods
  // -------------------------------------------------------------------------

  describe('isPersistenceApiAvailable', () => {
    it('returns true when both persist() and persisted() are functions', () => {
      setNavigatorStorage({ persist: vi.fn(), persisted: vi.fn() });
      expect(isPersistenceApiAvailable()).toBe(true);
    });

    it('returns false when navigator.storage is absent entirely', () => {
      setNavigatorStorage(undefined);
      expect(isPersistenceApiAvailable()).toBe(false);
    });

    it('returns false when persist() is missing', () => {
      setNavigatorStorage({ persisted: vi.fn() });
      expect(isPersistenceApiAvailable()).toBe(false);
    });

    it('returns false when persisted() is missing', () => {
      setNavigatorStorage({ persist: vi.fn() });
      expect(isPersistenceApiAvailable()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isStoragePersisted — wraps navigator.storage.persisted()
  // -------------------------------------------------------------------------

  describe('isStoragePersisted', () => {
    it('returns false when the persistence API is unavailable', async () => {
      setNavigatorStorage({ getDirectory: vi.fn() });
      await expect(isStoragePersisted()).resolves.toBe(false);
    });

    it('returns true when persisted() resolves true', async () => {
      setNavigatorStorage({ persist: vi.fn(), persisted: vi.fn().mockResolvedValue(true) });
      await expect(isStoragePersisted()).resolves.toBe(true);
    });

    it('returns false when persisted() resolves false', async () => {
      setNavigatorStorage({ persist: vi.fn(), persisted: vi.fn().mockResolvedValue(false) });
      await expect(isStoragePersisted()).resolves.toBe(false);
    });

    it('returns false (never throws) when persisted() rejects', async () => {
      setNavigatorStorage({
        persist: vi.fn(),
        persisted: vi.fn().mockRejectedValue(new Error('boom')),
      });
      await expect(isStoragePersisted()).resolves.toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // requestPersistentStorage — the eviction-protection request
  // -------------------------------------------------------------------------

  describe('requestPersistentStorage', () => {
    it("returns 'unsupported' when the persistence API is unavailable", async () => {
      const persist = vi.fn();
      setNavigatorStorage({ getDirectory: vi.fn() });
      await expect(requestPersistentStorage()).resolves.toBe('unsupported');
      expect(persist).not.toHaveBeenCalled();
    });

    it("returns 'persisted' WITHOUT calling persist() when already persisted", async () => {
      const persist = vi.fn().mockResolvedValue(true);
      const persisted = vi.fn().mockResolvedValue(true);
      setNavigatorStorage({ persist, persisted });

      await expect(requestPersistentStorage()).resolves.toBe('persisted');

      // The early-return path must not re-request persistence.
      expect(persisted).toHaveBeenCalledTimes(1);
      expect(persist).not.toHaveBeenCalled();
    });

    it("returns 'persisted' when not yet persisted and persist() grants it", async () => {
      const persist = vi.fn().mockResolvedValue(true);
      const persisted = vi.fn().mockResolvedValue(false);
      setNavigatorStorage({ persist, persisted });

      await expect(requestPersistentStorage()).resolves.toBe('persisted');
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it("returns 'denied' when not yet persisted and persist() declines", async () => {
      const persist = vi.fn().mockResolvedValue(false);
      const persisted = vi.fn().mockResolvedValue(false);
      setNavigatorStorage({ persist, persisted });

      await expect(requestPersistentStorage()).resolves.toBe('denied');
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it("maps a persisted() throw to 'unsupported' (never throws)", async () => {
      const persist = vi.fn();
      const persisted = vi.fn().mockRejectedValue(new Error('persisted failed'));
      setNavigatorStorage({ persist, persisted });

      await expect(requestPersistentStorage()).resolves.toBe('unsupported');
      // We failed before ever requesting.
      expect(persist).not.toHaveBeenCalled();
    });

    it("maps a persist() throw to 'unsupported' (never throws)", async () => {
      const persist = vi.fn().mockRejectedValue(new Error('persist failed'));
      const persisted = vi.fn().mockResolvedValue(false);
      setNavigatorStorage({ persist, persisted });

      await expect(requestPersistentStorage()).resolves.toBe('unsupported');
      expect(persist).toHaveBeenCalledTimes(1);
    });
  });
});
