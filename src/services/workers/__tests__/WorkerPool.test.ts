import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted runs before vi.mock hoisting, so the symbol is available.
const { releaseProxySymbol } = vi.hoisted(() => ({
  releaseProxySymbol: Symbol('Comlink.releaseProxy'),
}));

// Override the global comlink mock so wrapped proxies resolve to {} and
// support releaseProxy (used by createWorker's dispose path).
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

import { WorkerPool } from '../WorkerPool';

interface StubAPI {
  ping(): Promise<void>;
}

/** Build a minimal Worker-like stub (an EventTarget with the bits createWorker touches). */
function makeStubWorker(): Worker {
  return {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  } as unknown as Worker;
}

describe('WorkerPool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not invoke the workerFactory until the first submit (lazy creation)', () => {
    const workerFactory = vi.fn(() => makeStubWorker());

    new WorkerPool<StubAPI>({ workerFactory, minWorkers: 1, maxWorkers: 1 });

    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('invokes the workerFactory on first submit with a pool-worker-* name', async () => {
    const workerFactory = vi.fn(() => makeStubWorker());

    const pool = new WorkerPool<StubAPI>({ workerFactory, minWorkers: 1, maxWorkers: 1 });

    await pool.submit((proxy) => proxy.ping());

    expect(workerFactory).toHaveBeenCalledTimes(1);
    expect(workerFactory).toHaveBeenCalledWith(expect.stringMatching(/^pool-worker-\d+$/));

    await pool.shutdown();
  });
});
