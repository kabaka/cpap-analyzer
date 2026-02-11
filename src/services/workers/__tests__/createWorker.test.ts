import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ErrorCategory, ErrorSeverity } from '@/types';

// vi.hoisted runs before vi.mock hoisting, so the symbol is available.
const { releaseProxySymbol } = vi.hoisted(() => ({
  releaseProxySymbol: Symbol('Comlink.releaseProxy'),
}));

// Override the global comlink mock to include releaseProxy.
vi.mock('comlink', () => ({
  wrap: vi.fn(
    () =>
      new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === releaseProxySymbol) return vi.fn();
            return vi.fn().mockResolvedValue({});
          },
        },
      ),
  ),
  expose: vi.fn(),
  transfer: vi.fn((value: unknown) => value),
  proxy: vi.fn((value: unknown) => value),
  releaseProxy: releaseProxySymbol,
}));

import * as Comlink from 'comlink';
import { createWorker, buildWorkerError } from '../createWorker';

// The global test setup (src/test/setup.ts) provides:
// - globalThis.Worker as a vi.fn() stub

describe('createWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('factory function overload', () => {
    it('should call the factory function exactly once', () => {
      const mockWorkerInstance = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      };
      const factory = vi.fn(() => mockWorkerInstance as unknown as Worker);

      createWorker<Record<string, never>>(factory);

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('should return an object with proxy and dispose methods', () => {
      const mockWorkerInstance = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      };
      const factory = vi.fn(() => mockWorkerInstance as unknown as Worker);

      const wrapped = createWorker<Record<string, never>>(factory);

      expect(wrapped).toHaveProperty('proxy');
      expect(wrapped).toHaveProperty('dispose');
      expect(typeof wrapped.dispose).toBe('function');
    });

    it('should terminate the worker on dispose', () => {
      // Comlink.wrap returns a Proxy in the mock. The dispose() path calls
      // rawProxy[Comlink.releaseProxy](), so the mock proxy must handle
      // that Symbol property access.  We configure Comlink.wrap to return
      // a proxy that exposes releaseProxy as a callable.
      const releaseProxySpy = vi.fn();
      vi.mocked(Comlink.wrap).mockReturnValueOnce(
        new Proxy(
          {},
          {
            get(_target, prop) {
              if (prop === Comlink.releaseProxy) return releaseProxySpy;
              return vi.fn().mockResolvedValue({});
            },
          },
        ) as Comlink.Remote<Record<string, never>>,
      );

      const mockWorkerInstance = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      };
      const factory = vi.fn(() => mockWorkerInstance as unknown as Worker);

      const wrapped = createWorker<Record<string, never>>(factory);
      wrapped.dispose();

      expect(mockWorkerInstance.terminate).toHaveBeenCalledTimes(1);
      expect(mockWorkerInstance.removeEventListener).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
      expect(releaseProxySpy).toHaveBeenCalledTimes(1);
    });

    it('should throw a CPAPError when the factory throws', () => {
      const factory = vi.fn(() => {
        throw new Error('Worker script not found');
      });

      expect(() => createWorker<Record<string, never>>(factory)).toThrow();

      try {
        createWorker<Record<string, never>>(factory);
      } catch (err: unknown) {
        const cpapErr = err as {
          id: string;
          category: string;
          severity: string;
          message: string;
          technicalDetails?: { originalError?: Error };
        };
        expect(cpapErr.id).toBe('WORKER_CREATION_FAILED');
        expect(cpapErr.category).toBe(ErrorCategory.WORKER);
        expect(cpapErr.severity).toBe(ErrorSeverity.FATAL);
        expect(cpapErr.message).toContain('worker factory');
        expect(cpapErr.technicalDetails?.originalError?.message).toBe('Worker script not found');
      }
    });

    it('should accept optional timeoutMs', () => {
      const mockWorkerInstance = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      };
      const factory = vi.fn(() => mockWorkerInstance as unknown as Worker);

      // Should not throw when given custom timeout
      const wrapped = createWorker<Record<string, never>>(factory, { timeoutMs: 5_000 });

      expect(wrapped.proxy).toBeDefined();
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe('URL overload (backward compatibility)', () => {
    it('should still work when given a URL', () => {
      const url = new URL('https://example.com/worker.js');

      const wrapped = createWorker<Record<string, never>>(url, { name: 'test-worker' });

      expect(wrapped).toHaveProperty('proxy');
      expect(wrapped).toHaveProperty('dispose');
      expect(globalThis.Worker).toHaveBeenCalledWith(url, {
        type: 'module',
        name: 'test-worker',
      });
    });
  });

  describe('buildWorkerError', () => {
    it('should produce a CPAPError with WORKER category', () => {
      const err = buildWorkerError(
        'TEST_ERROR',
        'Test Title',
        'Something went wrong',
        ErrorSeverity.WARNING,
      );

      expect(err.id).toBe('TEST_ERROR');
      expect(err.category).toBe(ErrorCategory.WORKER);
      expect(err.severity).toBe(ErrorSeverity.WARNING);
      expect(err.title).toBe('Test Title');
      expect(err.message).toBe('Something went wrong');
      expect(err.timestamp).toBeInstanceOf(Date);
    });

    it('should include technicalDetails when cause is provided', () => {
      const cause = new Error('root cause');
      const err = buildWorkerError(
        'TEST_ERROR',
        'Title',
        'msg',
        ErrorSeverity.ERROR,
        { extra: 'data' },
        cause,
      );

      expect(err.technicalDetails?.originalError).toBe(cause);
      expect(err.technicalDetails?.context).toEqual({ extra: 'data' });
    });
  });
});
