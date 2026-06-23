/**
 * Comlink-based typed worker factory.
 *
 * Creates Web Workers wrapped with Comlink for transparent RPC,
 * adding timeout support and structured error marshalling across
 * the thread boundary.
 *
 * @module services/workers/createWorker
 */

import * as Comlink from 'comlink';
import type { Remote } from 'comlink';

import { ErrorCategory, ErrorSeverity, type CPAPError } from '@/types';

// ── Public types ─────────────────────────────────────────────────

/** Options accepted by {@link createWorker}. */
export interface CreateWorkerOptions {
  /**
   * Maximum milliseconds a single method call may take before it is
   * rejected with a timeout error.
   *
   * @default 30_000
   */
  timeoutMs?: number;

  /** Forwarded to the `Worker` constructor. */
  name?: string;
}

/**
 * A Comlink {@link Remote} proxy augmented with explicit cleanup.
 *
 * Call {@link WrappedWorker.dispose | dispose()} to terminate the
 * underlying `Worker` and remove all listeners.
 */
export interface WrappedWorker<T> {
  /** The Comlink remote proxy. All method calls are subject to timeout. */
  readonly proxy: Remote<T>;

  /**
   * Terminate the underlying `Worker`, release the Comlink proxy, and
   * remove error event listeners.
   */
  dispose(): void;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Build a {@link CPAPError} with the `WORKER` category.
 *
 * @internal
 */
export function buildWorkerError(
  id: string,
  title: string,
  message: string,
  severity: ErrorSeverity = ErrorSeverity.ERROR,
  context?: Record<string, unknown>,
  cause?: Error,
): CPAPError {
  return {
    id,
    category: ErrorCategory.WORKER,
    severity,
    title,
    message,
    technicalDetails:
      context || cause
        ? {
            originalError: cause,
            stack: cause?.stack,
            context,
          }
        : undefined,
    timestamp: new Date(),
  };
}

/**
 * Serialise a {@link CPAPError} to a plain object that survives
 * `structuredClone` (which drops `Error.prototype` methods and `.cause`).
 *
 * @internal
 */
export function serialiseCPAPError(err: CPAPError): Record<string, unknown> {
  return {
    __cpapError: true,
    id: err.id,
    category: err.category,
    severity: err.severity,
    title: err.title,
    message: err.message,
    recoverySteps: err.recoverySteps,
    timestamp: err.timestamp.toISOString(),
    technicalContext: err.technicalDetails?.context,
    causeMessage: err.technicalDetails?.originalError?.message,
    causeStack: err.technicalDetails?.originalError?.stack ?? err.technicalDetails?.stack,
  };
}

/**
 * Reconstitute a plain object produced by {@link serialiseCPAPError}
 * back into a {@link CPAPError}.
 *
 * @internal
 */
export function deserialiseCPAPError(obj: Record<string, unknown>): CPAPError {
  const causeMessage = obj['causeMessage'];
  const originalError =
    typeof causeMessage === 'string'
      ? Object.assign(new Error(causeMessage), {
          stack: obj['causeStack'] as string | undefined,
        })
      : undefined;

  const technicalContext = obj['technicalContext'] as Record<string, unknown> | undefined;
  const causeStack = obj['causeStack'] as string | undefined;

  return {
    id: obj['id'] as string,
    category: obj['category'] as ErrorCategory,
    severity: obj['severity'] as ErrorSeverity,
    title: obj['title'] as string,
    message: obj['message'] as string,
    recoverySteps: obj['recoverySteps'] as string[] | undefined,
    technicalDetails:
      originalError || causeStack || technicalContext
        ? {
            originalError,
            stack: causeStack,
            context: technicalContext,
          }
        : undefined,
    timestamp: new Date(obj['timestamp'] as string),
  };
}

/**
 * Returns `true` when `value` looks like a serialised CPAPError
 * produced by {@link serialiseCPAPError}.
 *
 * @internal
 */
function isSerialised(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['__cpapError'] === true
  );
}

/**
 * Wrap every function-valued property on `target` so that calls are
 * bounded by `timeoutMs`.  Non-function properties are passed through
 * unchanged.
 *
 * Exported for regression testing against a real Comlink endpoint; not part of
 * the public API surface.
 *
 * @internal
 */
export function withTimeout<T>(target: Remote<T>, timeoutMs: number): Remote<T> {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);

      // Only intercept function calls — pass properties through as-is.
      if (typeof value !== 'function') {
        return value;
      }

      // Return a wrapper that races the original call against a timer.
      return (...args: unknown[]) => {
        // Invoke the method ON the Comlink proxy (`obj[prop](...args)`) rather
        // than reaching for `value.apply(...)`. `value` is itself a Comlink
        // proxy, not a real function, so `value.apply` resolves to ANOTHER
        // Comlink proxy (path `[prop, 'apply']`) instead of
        // `Function.prototype.apply`. Calling that proxy ships the real
        // argument list NESTED as a single element, so Comlink's
        // `processArguments`/`toWireValue` never sees a top-level
        // `proxyMarker` on a `Comlink.proxy(callback)` argument and tries to
        // structuredClone the callback (→ DataCloneError). Calling through the
        // proxy's own `apply` trap keeps the argument list FLAT so proxied
        // callbacks are turned into a MessagePort/handler as intended. For
        // clone-safe arguments (EDF etc.) the wire payload is byte-identical.
        const method = (obj as Record<PropertyKey, ((...a: unknown[]) => unknown) | undefined>)[
          prop
        ] as (...a: unknown[]) => unknown;
        const call = method(...args) as Promise<unknown>;

        // If the underlying call isn't thenable there's no point racing.
        if (typeof (call as { then?: unknown })?.then !== 'function') {
          return call;
        }

        return Promise.race([
          (call as Promise<unknown>).catch((err: unknown) => {
            // Re-throw after deserialising cross-boundary CPAPErrors.
            if (isSerialised(err)) {
              throw deserialiseCPAPError(err);
            }
            throw err;
          }),
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => {
              reject(
                buildWorkerError(
                  'WORKER_TIMEOUT',
                  'Worker Timeout',
                  `Worker method call timed out after ${timeoutMs} ms`,
                  ErrorSeverity.ERROR,
                  { timeoutMs, method: String(prop) },
                ),
              );
            }, timeoutMs);
          }),
        ]);
      };
    },
  }) as Remote<T>;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Create a Comlink-wrapped Web Worker with timeout and error handling.
 *
 * @typeParam T  The interface exposed by the worker via `Comlink.expose`.
 *
 * @param workerUrlOrFactory  Either a `URL` produced by
 *   `new URL('./myWorker.ts', import.meta.url)`, or a **factory function**
 *   that returns a `Worker`.  Prefer passing a factory when the call site
 *   needs Vite to statically detect the `new Worker(new URL(…))` pattern
 *   for production bundling.
 * @param options    Optional configuration.
 * @returns A {@link WrappedWorker} whose `proxy` supports typed RPC
 *   calls with automatic timeout.
 *
 * @example
 * ```ts
 * interface ParserAPI {
 *   parse(buf: ArrayBuffer): Promise<ParsedResult>;
 * }
 *
 * // Using a factory (preferred – Vite bundles the worker correctly):
 * const { proxy, dispose } = createWorker<ParserAPI>(
 *   () => new Worker(
 *     new URL('./parserWorker.ts', import.meta.url),
 *     { type: 'module', name: 'edf-parser' },
 *   ),
 *   { timeoutMs: 10_000 },
 * );
 *
 * // Using a URL (still supported for backward compatibility):
 * const w = createWorker<ParserAPI>(
 *   new URL('./parserWorker.ts', import.meta.url),
 *   { timeoutMs: 10_000, name: 'edf-parser' },
 * );
 * ```
 */
export function createWorker<T>(
  workerUrlOrFactory: URL | (() => Worker),
  options: CreateWorkerOptions = {},
): WrappedWorker<T> {
  const { timeoutMs = 30_000, name } = options;

  let worker: Worker;

  try {
    if (typeof workerUrlOrFactory === 'function') {
      worker = workerUrlOrFactory();
    } else {
      worker = new Worker(workerUrlOrFactory, {
        type: 'module',
        name: name ?? workerUrlOrFactory.pathname.split('/').pop() ?? 'cpap-worker',
      });
    }
  } catch (err) {
    const label =
      typeof workerUrlOrFactory === 'function' ? 'worker factory' : workerUrlOrFactory.href;
    throw buildWorkerError(
      'WORKER_CREATION_FAILED',
      'Worker Creation Failed',
      `Failed to create Worker from ${label}`,
      ErrorSeverity.FATAL,
      typeof workerUrlOrFactory === 'function' ? undefined : { workerUrl: workerUrlOrFactory.href },
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  // Comlink proxy for typed RPC.
  const rawProxy = Comlink.wrap<T>(worker);

  // Wrap with timeout + error deserialisation.
  const proxy = withTimeout(rawProxy, timeoutMs);

  // Surface unhandled worker errors as CPAPErrors.
  const onError = (event: ErrorEvent): void => {
    // ErrorEvent is already surfaced through Comlink rejections in most
    // cases. This handler acts as a safety net for uncaught exceptions
    // inside the worker that bypass Comlink.
    // eslint-disable-next-line no-console
    console.error(
      buildWorkerError(
        'WORKER_UNCAUGHT_ERROR',
        'Worker Error',
        event.message ?? 'Unknown worker error',
        ErrorSeverity.ERROR,
        {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      ),
    );
  };

  worker.addEventListener('error', onError);

  const dispose = (): void => {
    worker.removeEventListener('error', onError);
    rawProxy[Comlink.releaseProxy]();
    worker.terminate();
  };

  return { proxy, dispose };
}
