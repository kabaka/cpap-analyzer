import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

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
globalThis.Worker = vi.fn().mockImplementation(() => ({
  postMessage: vi.fn(),
  terminate: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(() => false),
  onmessage: null,
  onerror: null,
  onmessageerror: null,
})) as unknown as typeof Worker;

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
