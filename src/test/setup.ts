import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// localStorage stub — Node 25+ provides a broken native localStorage that
// interferes with jsdom's implementation. Replace it with an in-memory mock.
const localStorageStore = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (key: string) => localStorageStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    localStorageStore.set(key, String(value));
  },
  removeItem: (key: string) => {
    localStorageStore.delete(key);
  },
  clear: () => {
    localStorageStore.clear();
  },
  get length() {
    return localStorageStore.size;
  },
  key: (index: number) => {
    const keys = Array.from(localStorageStore.keys());
    return keys[index] ?? null;
  },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

// matchMedia stub — jsdom doesn't implement matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ResizeObserver stub — jsdom doesn't implement it, but several Radix UI
// primitives (Slider, Popover, …) construct one on mount.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// OPFS stub — jsdom doesn't implement the File System Access API
const mockDirectoryHandle = {} as FileSystemDirectoryHandle;

if (!navigator.storage) {
  Object.defineProperty(navigator, 'storage', {
    value: {
      getDirectory: vi.fn().mockResolvedValue(mockDirectoryHandle),
    },
    configurable: true,
  });
} else if (!navigator.storage.getDirectory) {
  Object.defineProperty(navigator.storage, 'getDirectory', {
    value: vi.fn().mockResolvedValue(mockDirectoryHandle),
    configurable: true,
    writable: true,
  });
}

// Web Worker stub — jsdom doesn't support Workers
globalThis.Worker = vi.fn().mockImplementation(function () {
  return {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };
}) as unknown as typeof Worker;

// Comlink stub
vi.mock('comlink', () => ({
  wrap: vi.fn(() => new Proxy({}, { get: () => vi.fn().mockResolvedValue({}) })),
  expose: vi.fn(),
  transfer: vi.fn((value: unknown) => value),
  proxy: vi.fn((value: unknown) => value),
}));

// crypto.subtle stub — jsdom provides getRandomValues but not always subtle
if (globalThis.crypto && !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: {
      digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    },
    configurable: true,
  });
}
