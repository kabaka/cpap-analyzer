import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OPFSService, OPFSError, type ChannelInput } from '@/services/storage/OPFSService';

// ---------------------------------------------------------------------------
// In-memory OPFS mock
//
// The global test setup (src/test/setup.ts) stubs
// `navigator.storage.getDirectory` with a `vi.fn()` that resolves to an empty
// object — enough for feature detection but NOT for real directory/file I/O.
// These tests need a working OPFS, so we install a self-contained in-memory
// implementation of the subset of the File System Access API that
// OPFSService exercises:
//
//   navigator.storage.getDirectory()
//   FileSystemDirectoryHandle.getDirectoryHandle / getFileHandle / removeEntry
//   FileSystemDirectoryHandle.values()  (async iterator)
//   FileSystemFileHandle.createWritable / getFile
//   writable.write / close, file.text / arrayBuffer
//
// removeEntry throws a DOMException('NotFoundError') for missing entries so the
// service's `isNotFoundError` branch and "may not exist" guards behave like a
// real browser.
// ---------------------------------------------------------------------------

class MockFile {
  constructor(private readonly bytes: Uint8Array) {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    // Return a standalone copy so callers can't mutate stored bytes.
    return this.bytes.slice().buffer;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.bytes);
  }
}

class MockWritable {
  private chunks: Uint8Array[] = [];

  constructor(private readonly onClose: (bytes: Uint8Array) => void) {}

  async write(data: ArrayBuffer | ArrayBufferView | string): Promise<void> {
    if (typeof data === 'string') {
      this.chunks.push(new TextEncoder().encode(data));
    } else if (data instanceof ArrayBuffer) {
      this.chunks.push(new Uint8Array(data.slice(0)));
    } else {
      const view = data as ArrayBufferView;
      this.chunks.push(
        new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)),
      );
    }
  }

  async close(): Promise<void> {
    const total = this.chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    this.onClose(merged);
  }
}

class MockFileHandle {
  readonly kind = 'file' as const;
  bytes: Uint8Array = new Uint8Array(0);

  constructor(readonly name: string) {}

  async createWritable(): Promise<MockWritable> {
    return new MockWritable((bytes) => {
      this.bytes = bytes;
    });
  }

  async getFile(): Promise<MockFile> {
    return new MockFile(this.bytes);
  }
}

function notFound(name: string): DOMException {
  return new DOMException(`"${name}" not found`, 'NotFoundError');
}

class MockDirectoryHandle {
  readonly kind = 'directory' as const;
  private dirs = new Map<string, MockDirectoryHandle>();
  private files = new Map<string, MockFileHandle>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<MockDirectoryHandle> {
    const existing = this.dirs.get(name);
    if (existing) return existing;
    if (!options?.create) throw notFound(name);
    const handle = new MockDirectoryHandle(name);
    this.dirs.set(name, handle);
    return handle;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFileHandle> {
    const existing = this.files.get(name);
    if (existing) return existing;
    if (!options?.create) throw notFound(name);
    const handle = new MockFileHandle(name);
    this.files.set(name, handle);
    return handle;
  }

  async removeEntry(name: string): Promise<void> {
    if (this.dirs.delete(name) || this.files.delete(name)) return;
    throw notFound(name);
  }

  async *values(): AsyncIterableIterator<MockDirectoryHandle | MockFileHandle> {
    for (const dir of this.dirs.values()) yield dir;
    for (const file of this.files.values()) yield file;
  }

  // Test-only introspection helpers.
  hasDir(name: string): boolean {
    return this.dirs.has(name);
  }

  childDir(name: string): MockDirectoryHandle | undefined {
    return this.dirs.get(name);
  }

  dirSize(): number {
    return this.dirs.size;
  }

  fileSize(): number {
    return this.files.size;
  }
}

/** Install a fresh in-memory OPFS and return the spy plus the root for asserting. */
function installOPFS(): {
  getDirectory: ReturnType<typeof vi.fn>;
  root: MockDirectoryHandle;
} {
  const root = new MockDirectoryHandle('');
  const getDirectory = vi.fn(async () => root as unknown as FileSystemDirectoryHandle);
  Object.defineProperty(navigator, 'storage', {
    value: { getDirectory },
    configurable: true,
    writable: true,
  });
  return { getDirectory, root };
}

function makeChannel(overrides: Partial<ChannelInput> = {}): ChannelInput {
  return {
    name: 'Flow',
    sampleRate: 25,
    unit: 'L/min',
    physicalMin: -60,
    physicalMax: 60,
    data: new Float32Array([1, 2, 3, 4, 5]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OPFSService', () => {
  let originalStorageDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalStorageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');
  });

  afterEach(() => {
    if (originalStorageDescriptor) {
      Object.defineProperty(navigator, 'storage', originalStorageDescriptor);
    }
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Scenario 1 + 2: self-initializing deletion on a fresh instance
  // -----------------------------------------------------------------------

  describe('self-initializing deletion (the reported bug)', () => {
    it('deleteAll() succeeds on a freshly constructed service without calling initialize()', async () => {
      installOPFS();
      const service = new OPFSService();

      // The bug: this threw OPFSError('OPFS_NOT_INITIALIZED').
      await expect(service.deleteAll()).resolves.toBeUndefined();
    });

    it('deleteAll() does not throw OPFS_NOT_INITIALIZED on a fresh instance', async () => {
      installOPFS();
      const service = new OPFSService();

      let caught: unknown;
      try {
        await service.deleteAll();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeUndefined();
      // Belt-and-suspenders: if it ever regresses, ensure it's not the old code.
      if (caught instanceof OPFSError) {
        expect(caught.code).not.toBe('OPFS_NOT_INITIALIZED');
      }
    });

    it('deleteSessionData() succeeds on a fresh, un-initialized instance', async () => {
      installOPFS();
      const service = new OPFSService();

      await expect(service.deleteSessionData('session-xyz')).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 3: idempotent initialize()
  // -----------------------------------------------------------------------

  describe('idempotent initialize()', () => {
    it('calling initialize() twice does not throw', async () => {
      installOPFS();
      const service = new OPFSService();

      await service.initialize();
      await expect(service.initialize()).resolves.toBeUndefined();
    });

    it('does not re-resolve the OPFS root on a second initialize()', async () => {
      const { getDirectory } = installOPFS();
      const service = new OPFSService();

      await service.initialize();
      await service.initialize();

      // The root handle is cached after the first successful init.
      expect(getDirectory).toHaveBeenCalledTimes(1);
    });

    it('keeps a stable root: later self-initializing calls do not re-fetch the root', async () => {
      const { getDirectory } = installOPFS();
      const service = new OPFSService();

      await service.initialize();
      await service.listSessions();
      await service.deleteSessionData('nope');

      expect(getDirectory).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 4: concurrent initialize()
  // -----------------------------------------------------------------------

  describe('concurrent initialize()', () => {
    it('two concurrent initialize() calls share a single directory setup', async () => {
      const { getDirectory } = installOPFS();
      const service = new OPFSService();

      await Promise.all([service.initialize(), service.initialize()]);

      // The in-flight initPromise is shared, so getDirectory runs once.
      expect(getDirectory).toHaveBeenCalledTimes(1);
    });

    it('concurrent self-initializing method calls do not race to create the root twice', async () => {
      const { getDirectory, root } = installOPFS();
      const service = new OPFSService();

      await Promise.all([
        service.listSessions(),
        service.deleteAll(),
        service.deleteSessionData('a'),
      ]);

      expect(getDirectory).toHaveBeenCalledTimes(1);
      // Exactly one app root directory, with the standard subtree.
      expect(root.dirSize()).toBe(1);
      const appRoot = root.childDir('cpap-analyzer');
      expect(appRoot).toBeDefined();
      expect(appRoot?.hasDir('signals')).toBe(true);
      expect(appRoot?.hasDir('cache')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 5: retry after a failed initialize()
  // -----------------------------------------------------------------------

  describe('retry after failure', () => {
    it('a failed initialize() clears the cached promise so a later call can succeed', async () => {
      const root = new MockDirectoryHandle('');
      const getDirectory = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient OPFS failure'))
        .mockResolvedValue(root as unknown as FileSystemDirectoryHandle);
      Object.defineProperty(navigator, 'storage', {
        value: { getDirectory },
        configurable: true,
        writable: true,
      });

      const service = new OPFSService();

      // First attempt fails and surfaces a structured init error.
      await expect(service.initialize()).rejects.toMatchObject({
        name: 'OPFSError',
        code: 'OPFS_INIT_FAILED',
      });

      // Second attempt retries from scratch and succeeds.
      await expect(service.initialize()).resolves.toBeUndefined();
      expect(getDirectory).toHaveBeenCalledTimes(2);
      expect(root.childDir('cpap-analyzer')).toBeDefined();
    });

    it('a self-initializing method retries after an earlier init failure', async () => {
      const root = new MockDirectoryHandle('');
      const getDirectory = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient OPFS failure'))
        .mockResolvedValue(root as unknown as FileSystemDirectoryHandle);
      Object.defineProperty(navigator, 'storage', {
        value: { getDirectory },
        configurable: true,
        writable: true,
      });

      const service = new OPFSService();

      // deleteAll wraps the init failure as OPFS_DELETE_FAILED on first try.
      await expect(service.deleteAll()).rejects.toBeInstanceOf(OPFSError);

      // A subsequent call retries the underlying init and succeeds.
      await expect(service.deleteAll()).resolves.toBeUndefined();
      expect(getDirectory).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 6: deleteAll clears/recreates signals and downsampled dirs
  // -----------------------------------------------------------------------

  describe('deleteAll() clears and recreates storage directories', () => {
    it('removes existing session + cache content and leaves empty signals/downsampled dirs', async () => {
      installOPFS();
      const service = new OPFSService();
      await service.initialize();

      // Seed signal data and a downsampled cache entry.
      await service.writeSession('session-1', 0, 1000, [makeChannel()]);
      await service.writeDownsampledCache('flow-lod0', new Float32Array([9, 8, 7]));

      expect(await service.listSessions()).toContain('session-1');
      expect(await service.readDownsampledCache('flow-lod0')).not.toBeNull();

      await service.deleteAll();

      // Signals directory is recreated empty.
      expect(await service.listSessions()).toEqual([]);
      // Downsampled cache entry is gone (directory recreated empty).
      expect(await service.readDownsampledCache('flow-lod0')).toBeNull();
    });

    it('recreates the cache/downsampled subdirectory after deletion', async () => {
      const { root } = installOPFS();
      const service = new OPFSService();

      await service.deleteAll();

      const appRoot = root.childDir('cpap-analyzer');
      expect(appRoot?.hasDir('signals')).toBe(true);
      const cacheDir = appRoot?.childDir('cache');
      expect(cacheDir?.hasDir('downsampled')).toBe(true);
    });

    it('removeEntry is invoked for both signals and cache directories', async () => {
      const { root } = installOPFS();
      const service = new OPFSService();
      await service.initialize();

      const appRoot = root.childDir('cpap-analyzer');
      expect(appRoot).toBeDefined();
      const removeSpy = vi.spyOn(
        appRoot as unknown as { removeEntry: MockDirectoryHandle['removeEntry'] },
        'removeEntry',
      );

      await service.deleteAll();

      const removed = removeSpy.mock.calls.map((call) => call[0]);
      expect(removed).toContain('signals');
      expect(removed).toContain('cache');
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 7: happy-path write/read round-trip (contract still intact)
  // -----------------------------------------------------------------------

  describe('write/read round-trip after explicit initialize()', () => {
    it('round-trips a single-channel session through writeSession + readChannel', async () => {
      installOPFS();
      const service = new OPFSService();
      await service.initialize();

      const data = new Float32Array([10, 20, 30, 40, 50]);
      const manifest = await service.writeSession('round-trip', 0, 200, [
        makeChannel({ name: 'Flow', sampleRate: 25, data }),
      ]);

      expect(manifest.sessionId).toBe('round-trip');
      expect(manifest.channels).toHaveLength(1);
      expect(manifest.channels[0]?.name).toBe('Flow');

      const readBack = await service.readChannel('round-trip', 'Flow');
      expect(Array.from(readBack)).toEqual(Array.from(data));

      const readManifest = await service.readManifest('round-trip');
      expect(readManifest.sessionId).toBe('round-trip');
      expect(await service.listSessions()).toEqual(['round-trip']);
    });

    it('round-trips a downsampled cache entry', async () => {
      installOPFS();
      const service = new OPFSService();
      await service.initialize();

      const values = new Float32Array([0.5, 1.5, 2.5]);
      await service.writeDownsampledCache('lod-key', values);

      const cached = await service.readDownsampledCache('lod-key');
      expect(cached).not.toBeNull();
      expect(Array.from(cached as Float32Array)).toEqual(Array.from(values));
    });
  });
});
