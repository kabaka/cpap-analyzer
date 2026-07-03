/**
 * Regression test for the {@link withTimeout} Comlink-proxy bug.
 *
 * `withTimeout` wraps the Comlink remote in a `Proxy` and, for each method
 * call, has to forward the FLAT argument list back through Comlink so that any
 * `Comlink.proxy(callback)` argument is detected (via its `proxyMarker`) and
 * turned into a `MessagePort`/handler. A previous implementation invoked the
 * method via `value.apply(obj, args)` — but `value` is itself a Comlink proxy,
 * so `value.apply` resolved to ANOTHER Comlink proxy rather than
 * `Function.prototype.apply`. That nested the real argument list as a single
 * element, hiding the top-level `proxyMarker`, so Comlink tried to
 * `structuredClone` the callback and threw `DataCloneError`. In production this
 * made every heavy Fitbit intraday import (heart_rate_intraday, spo2_intraday,
 * hrv_detail, snoring) store ZERO records while reporting success.
 *
 * CRITICAL: this file uses the REAL `comlink` module. Both `src/test/setup.ts`
 * and the sibling `createWorker.test.ts` mock comlink (which is precisely why
 * the bug slipped through — a mocked `proxy()`/`wrap()` never exercises the
 * structured-clone wire path). `vi.unmock` below restores the real module for
 * this file only.
 *
 * @module services/workers/__tests__/createWorker.proxyCallback
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// Use the REAL comlink, overriding the global mock from src/test/setup.ts.
vi.unmock('comlink');

import * as Comlink from 'comlink';

import { withTimeout } from '../createWorker';

/** The tiny API the "worker" side exposes over the channel. */
interface CallbackAPI {
  /** Invokes the proxied callback with `value`, then resolves to `result`. */
  run(value: string, cb: (received: string) => void): Promise<string>;
}

/**
 * Stand up a real Comlink endpoint over a `MessageChannel`, exposing
 * {@link CallbackAPI} on `port1` and wrapping `port2` for the caller.
 *
 * Returns the wrapped remote plus a teardown that releases the proxy and closes
 * the ports, so each test is isolated.
 */
function makeEndpoint(): {
  remote: Comlink.Remote<CallbackAPI>;
  channel: MessageChannel;
  release: () => void;
} {
  const channel = new MessageChannel();

  const api: CallbackAPI = {
    async run(value, cb) {
      // Invoke the proxied callback across the boundary, then return a value.
      await cb(value);
      return `done:${value}`;
    },
  };

  Comlink.expose(api, channel.port1);
  const remote = Comlink.wrap<CallbackAPI>(channel.port2);

  return {
    remote,
    channel,
    release: () => {
      remote[Comlink.releaseProxy]();
      channel.port1.close();
      channel.port2.close();
    },
  };
}

describe('withTimeout — real Comlink proxied-callback forwarding', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards a Comlink.proxy(callback) argument WITHOUT a DataCloneError and invokes it across the boundary', async () => {
    const { remote, release } = makeEndpoint();
    try {
      // Wrap exactly as createWorker does in production.
      const wrapped = withTimeout(remote, 5_000);

      const spy = vi.fn();
      const result = await wrapped.run('progress', Comlink.proxy(spy));

      // (1) Resolves with no DataCloneError.
      expect(result).toBe('done:progress');
      // (2) The proxied callback actually fired across the boundary.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('progress');
    } finally {
      release();
    }
  });

  it('matches a direct (un-wrapped) Comlink call as a control', async () => {
    const { remote, release } = makeEndpoint();
    try {
      // Control: same call WITHOUT the withTimeout wrapper. Must behave the same.
      const spy = vi.fn();
      const result = await remote.run('control', Comlink.proxy(spy));

      expect(result).toBe('done:control');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('control');
    } finally {
      release();
    }
  });

  it('still enforces the timeout when the remote call hangs', async () => {
    const channel = new MessageChannel();
    const api = {
      // Never resolves — exercises the timeout race.
      hang: () => new Promise<void>(() => {}),
    };
    Comlink.expose(api, channel.port1);
    const remote = Comlink.wrap<typeof api>(channel.port2);

    const wrapped = withTimeout(remote, 20);
    try {
      await expect(wrapped.hang()).rejects.toMatchObject({ id: 'WORKER_TIMEOUT' });
    } finally {
      remote[Comlink.releaseProxy]();
      channel.port1.close();
      channel.port2.close();
    }
  });
});
