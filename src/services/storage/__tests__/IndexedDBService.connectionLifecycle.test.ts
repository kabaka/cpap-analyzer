import { describe, it, expect, vi, afterEach } from 'vitest';
import { IndexedDBService, StorageError } from '@/services/storage/IndexedDBService';

// ---------------------------------------------------------------------------
// Connection-lifecycle hardening (data-loss fix).
//
// open() registers two handlers on the underlying IDBDatabase:
//   - onversionchange: closes the db, nulls the handle, invokes onConnectionLost
//   - onclose:         nulls the handle, invokes onConnectionLost
//
// An explicit close() must NOT invoke onConnectionLost (it is reserved for
// OUT-OF-BAND losses). These tests drive the handlers two ways:
//   1. Naturally: opening a higher-version connection makes fake-indexeddb fire
//      a real `versionchange` event on the open connection.
//   2. Directly: invoking the attached `onclose`/`onversionchange` handler on the
//      raw handle (getRawDatabase()), since fake-indexeddb cannot synthesise a
//      browser eviction.
// ---------------------------------------------------------------------------

describe('IndexedDBService connection lifecycle', () => {
  const open: IndexedDBService[] = [];

  function track(svc: IndexedDBService): IndexedDBService {
    open.push(svc);
    return svc;
  }

  afterEach(async () => {
    // Best-effort teardown of every service created during the test.
    for (const svc of open.splice(0)) {
      try {
        await svc.destroy();
      } catch {
        /* already gone / never opened */
      }
    }
  });

  describe('onversionchange', () => {
    it('invokes onConnectionLost when a newer-version connection opens', async () => {
      const onLost = vi.fn();
      const name = `vc-natural-${crypto.randomUUID()}`;
      const svc = track(new IndexedDBService(name, 4, onLost));
      await svc.open();

      // A second connection at a higher version triggers `versionchange` on ours.
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(name, 5);
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
      // Let the dispatched event microtask settle.
      await Promise.resolve();

      expect(onLost).toHaveBeenCalledTimes(1);
    });

    it('nulls the handle so a subsequent operation reports the connection is gone', async () => {
      const onLost = vi.fn();
      const name = `vc-handle-${crypto.randomUUID()}`;
      const svc = track(new IndexedDBService(name, 4, onLost));
      await svc.open();
      const raw = svc.getRawDatabase();

      // Drive the attached handler directly (deterministic; no version bump).
      expect(typeof raw.onversionchange).toBe('function');
      (raw.onversionchange as () => void)();

      expect(onLost).toHaveBeenCalledTimes(1);

      // With the handle nulled, the next operation surfaces a StorageError whose
      // root cause is STORAGE_NOT_INITIALIZED ("Call open() first.").
      await expect(svc.getSession('x')).rejects.toBeInstanceOf(StorageError);
      await expect(svc.getSession('x')).rejects.toThrow(/not initialized/i);

      // getRawDatabase() also throws the STORAGE_NOT_INITIALIZED error directly.
      expect(() => svc.getRawDatabase()).toThrow(StorageError);
      try {
        svc.getRawDatabase();
      } catch (e) {
        expect((e as StorageError).code).toBe('STORAGE_NOT_INITIALIZED');
      }
    });

    it('is safe when no onConnectionLost listener was provided', async () => {
      const name = `vc-nolistener-${crypto.randomUUID()}`;
      const svc = track(new IndexedDBService(name, 4));
      await svc.open();
      const raw = svc.getRawDatabase();

      // Must not throw despite the optional callback being undefined.
      expect(() => (raw.onversionchange as () => void)()).not.toThrow();
      await expect(svc.getSession('x')).rejects.toBeInstanceOf(StorageError);
    });
  });

  describe('onclose', () => {
    it('invokes onConnectionLost and nulls the handle', async () => {
      const onLost = vi.fn();
      const name = `close-handler-${crypto.randomUUID()}`;
      const svc = track(new IndexedDBService(name, 4, onLost));
      await svc.open();
      const raw = svc.getRawDatabase();

      expect(typeof raw.onclose).toBe('function');
      (raw.onclose as () => void)();

      expect(onLost).toHaveBeenCalledTimes(1);
      await expect(svc.getSession('x')).rejects.toBeInstanceOf(StorageError);
    });
  });

  describe('explicit close()', () => {
    it('does NOT invoke onConnectionLost', async () => {
      const onLost = vi.fn();
      const name = `explicit-close-${crypto.randomUUID()}`;
      const svc = track(new IndexedDBService(name, 4, onLost));
      await svc.open();

      svc.close();

      expect(onLost).not.toHaveBeenCalled();
      // The handle is gone, so operations still throw — just without the callback.
      await expect(svc.getSession('x')).rejects.toBeInstanceOf(StorageError);
    });

    it('does NOT invoke onConnectionLost via destroy() either', async () => {
      const onLost = vi.fn();
      const name = `destroy-${crypto.randomUUID()}`;
      const svc = new IndexedDBService(name, 4, onLost);
      await svc.open();

      await svc.destroy();

      expect(onLost).not.toHaveBeenCalled();
    });
  });
});
