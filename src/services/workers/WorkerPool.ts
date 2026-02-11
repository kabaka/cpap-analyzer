/**
 * Priority-based worker pool with task queuing and lifecycle management.
 *
 * Dispatches typed tasks to a pool of Comlink-wrapped Web Workers,
 * supporting priority scheduling, idle timeout, crash recovery,
 * cancellation via `AbortSignal`, and progress callbacks.
 *
 * @module services/WorkerPool
 */

import type { Remote } from 'comlink';

import { ErrorSeverity, type CPAPError } from '@/types';
import { buildWorkerError, createWorker, type WrappedWorker } from './createWorker';

// ── Public types ─────────────────────────────────────────────────

/** Configuration for a {@link WorkerPool}. */
export interface WorkerPoolOptions {
  /** The `URL` of the worker script (Vite-style). */
  workerUrl: URL;

  /**
   * Minimum number of workers to keep alive while the pool is active.
   *
   * @default 2
   */
  minWorkers?: number;

  /**
   * Maximum number of workers the pool may spin up.
   *
   * @default `navigator.hardwareConcurrency || 4`
   */
  maxWorkers?: number;

  /**
   * Milliseconds a worker may remain idle before it is terminated.
   * It will be recreated on demand when the next task is dispatched.
   *
   * @default 30_000
   */
  idleTimeoutMs?: number;

  /**
   * Default timeout for a single task, in milliseconds.
   * Can be overridden per-task via {@link TaskOptions.timeoutMs}.
   *
   * @default 60_000
   */
  taskTimeoutMs?: number;
}

/** Per-task configuration. */
export interface TaskOptions {
  /**
   * Scheduling priority. Higher priority tasks are dequeued first.
   *
   * @default 'normal'
   */
  priority?: 'high' | 'normal' | 'low';

  /**
   * An `AbortSignal` that, when aborted, cancels the queued (not yet
   * running) task. Tasks already dispatched to a worker cannot be
   * aborted at the worker level, but the returned promise will reject
   * immediately.
   */
  signal?: AbortSignal;

  /**
   * Callback invoked by the task to report progress (0 → 1).
   * Only useful when the worker function accepts a progress callback
   * via Comlink proxy.
   */
  onProgress?: (progress: number) => void;

  /**
   * Override the pool-level task timeout for this task.
   * In milliseconds.
   */
  timeoutMs?: number;
}

/**
 * A function that receives a Comlink remote proxy and returns a
 * promise with the task result. This is the unit of work dispatched
 * to the pool.
 *
 * @typeParam T  The worker API surface exposed via `Comlink.expose`.
 * @typeParam R  The return type of the task.
 */
export type TaskFn<T, R> = (proxy: Remote<T>) => Promise<R>;

// ── Internals ────────────────────────────────────────────────────

/** @internal Priority ordering used for the task queue. */
const PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

/** @internal State of a single managed worker. */
interface ManagedWorker<T> {
  wrapped: WrappedWorker<T>;
  busy: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/** @internal A pending task sitting in the queue. */
interface QueuedTask<T> {
  fn: TaskFn<T, unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  options: Required<Pick<TaskOptions, 'priority' | 'timeoutMs'>> &
    Pick<TaskOptions, 'signal' | 'onProgress'>;
}

// ── WorkerPool ───────────────────────────────────────────────────

/**
 * A generic, priority-based pool of Comlink-wrapped Web Workers.
 *
 * Workers are created lazily and terminated when idle. Tasks are
 * enqueued with optional priority, cancellation, and progress
 * support and dispatched round-robin to idle workers.
 *
 * @typeParam T  The API interface exposed by the worker script
 *   via `Comlink.expose()`.
 *
 * @example
 * ```ts
 * interface AnalysisAPI {
 *   analyse(data: Float32Array): Promise<AnalysisResult>;
 * }
 *
 * const pool = new WorkerPool<AnalysisAPI>({
 *   workerUrl: new URL('./analysisWorker.ts', import.meta.url),
 * });
 *
 * const result = await pool.submit(
 *   (proxy) => proxy.analyse(data),
 *   { priority: 'high' },
 * );
 *
 * await pool.shutdown();
 * ```
 */
export class WorkerPool<T> {
  // ── Configuration ────────────────────────────────────────────
  private readonly workerUrl: URL;
  private readonly minWorkers: number;
  private readonly maxWorkers: number;
  private readonly idleTimeoutMs: number;
  private readonly taskTimeoutMs: number;

  // ── State ────────────────────────────────────────────────────
  private readonly workers: Map<number, ManagedWorker<T>> = new Map();
  private readonly queue: QueuedTask<T>[] = [];
  private nextWorkerId = 0;
  private destroyed = false;

  constructor(options: WorkerPoolOptions) {
    this.workerUrl = options.workerUrl;

    const hwConcurrency = this.getHardwareConcurrency();
    const defaultMax = hwConcurrency;

    this.minWorkers = Math.max(options.minWorkers ?? 2, 1);
    this.maxWorkers = Math.max(options.maxWorkers ?? defaultMax, this.minWorkers);
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30_000;
    this.taskTimeoutMs = options.taskTimeoutMs ?? 60_000;
  }

  // ── Public API ───────────────────────────────────────────────

  /**
   * Submit a task for execution on the pool.
   *
   * The `taskFn` receives a Comlink `Remote<T>` proxy and should
   * invoke one or more methods on it.  The returned promise resolves
   * (or rejects) with the task result.
   *
   * @typeParam R  The return type of the task.
   *
   * @param taskFn  A function that operates on the worker proxy.
   * @param options Per-task overrides for priority, timeout, etc.
   * @returns A promise that resolves with the task's return value.
   *
   * @throws {CPAPError} `POOL_DESTROYED` if the pool has been shut
   *   down.
   * @throws {CPAPError} `TASK_ABORTED` if `options.signal` is
   *   triggered before the task starts.
   * @throws {CPAPError} `TASK_TIMEOUT` if the task exceeds its
   *   timeout.
   */
  submit<R>(taskFn: TaskFn<T, R>, options: TaskOptions = {}): Promise<R> {
    if (this.destroyed) {
      return Promise.reject(
        buildWorkerError(
          'POOL_DESTROYED',
          'Pool Destroyed',
          'Cannot submit tasks to a destroyed worker pool',
          ErrorSeverity.ERROR,
        ),
      );
    }

    const priority = options.priority ?? 'normal';
    const timeoutMs = options.timeoutMs ?? this.taskTimeoutMs;

    // Fast-fail if already aborted.
    if (options.signal?.aborted) {
      return Promise.reject(
        buildWorkerError(
          'TASK_ABORTED',
          'Task Aborted',
          'Task was aborted before submission',
          ErrorSeverity.WARNING,
        ),
      );
    }

    return new Promise<R>((resolve, reject) => {
      const task: QueuedTask<T> = {
        fn: taskFn as TaskFn<T, unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
        options: {
          priority,
          timeoutMs,
          signal: options.signal,
          onProgress: options.onProgress,
        },
      };

      // Listen for abort while queued.
      if (options.signal) {
        const onAbort = (): void => {
          const idx = this.queue.indexOf(task);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            task.reject(
              buildWorkerError(
                'TASK_ABORTED',
                'Task Aborted',
                'Task was aborted while queued',
                ErrorSeverity.WARNING,
              ),
            );
          }
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      this.enqueue(task);
      this.dispatch();
    });
  }

  /**
   * Gracefully shut down the pool.
   *
   * Waits for all in-flight tasks to complete, rejects any queued
   * tasks, then terminates every worker.
   */
  async shutdown(): Promise<void> {
    this.destroyed = true;

    // Drain the queue — reject pending tasks.
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      task?.reject(
        buildWorkerError(
          'POOL_SHUTDOWN',
          'Pool Shutdown',
          'Worker pool is shutting down — task cancelled',
          ErrorSeverity.WARNING,
        ),
      );
    }

    // Wait for busy workers to finish.
    await this.waitForIdle();

    // Terminate every worker.
    for (const [id, managed] of this.workers) {
      this.terminateWorker(id, managed);
    }
    this.workers.clear();
  }

  /**
   * The current number of live workers (busy + idle).
   */
  get workerCount(): number {
    return this.workers.size;
  }

  /**
   * The number of tasks waiting in the queue.
   */
  get pendingTaskCount(): number {
    return this.queue.length;
  }

  // ── Queue management ─────────────────────────────────────────

  /**
   * Insert a task into the priority queue.
   *
   * @internal
   */
  private enqueue(task: QueuedTask<T>): void {
    const taskOrder = PRIORITY_ORDER[task.options.priority] ?? 1;

    // Binary-ish insertion keeping the queue sorted by priority.
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      const queuedTask = this.queue[i];
      if (!queuedTask) continue;
      const existingOrder = PRIORITY_ORDER[queuedTask.options.priority] ?? 1;
      if (taskOrder < existingOrder) {
        this.queue.splice(i, 0, task);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.queue.push(task);
    }
  }

  // ── Dispatch ─────────────────────────────────────────────────

  /**
   * Try to assign queued tasks to idle workers, creating new workers
   * if capacity allows.
   *
   * @internal
   */
  private dispatch(): void {
    if (this.destroyed) return;

    while (this.queue.length > 0) {
      const worker = this.findIdleWorker() ?? this.tryCreateWorker();
      if (!worker) break; // At capacity — wait.

      const task = this.queue.shift();
      if (!task) break;

      // If the task was aborted while sitting in the queue, skip it.
      if (task.options.signal?.aborted) {
        task.reject(
          buildWorkerError(
            'TASK_ABORTED',
            'Task Aborted',
            'Task was aborted while queued',
            ErrorSeverity.WARNING,
          ),
        );
        continue;
      }

      this.runTask(worker, task);
    }
  }

  /**
   * Execute a single task on a managed worker.
   *
   * @internal
   */
  private runTask(entry: { id: number; managed: ManagedWorker<T> }, task: QueuedTask<T>): void {
    const { id, managed } = entry;
    managed.busy = true;
    this.clearIdleTimer(managed);

    const { fn, resolve, reject, options } = task;

    // Abort race.
    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
      reject(
        buildWorkerError(
          'TASK_ABORTED',
          'Task Aborted',
          'Task was aborted during execution',
          ErrorSeverity.WARNING,
        ),
      );
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    // Timeout race.
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      reject(
        buildWorkerError(
          'TASK_TIMEOUT',
          'Task Timeout',
          `Task exceeded ${options.timeoutMs} ms timeout`,
          ErrorSeverity.ERROR,
          {
            timeoutMs: options.timeoutMs,
          },
        ),
      );

      // Terminate the hung worker and replace it.
      this.replaceWorker(id);
    }, options.timeoutMs);

    fn(managed.wrapped.proxy)
      .then((result) => {
        if (!aborted && !timedOut) resolve(result);
      })
      .catch((err: unknown) => {
        if (!aborted && !timedOut) {
          reject(err);
        }

        // If the worker itself errored, replace it.
        if (this.isWorkerCrash(err)) {
          this.replaceWorker(id);
          return; // Skip marking idle — worker is gone.
        }
      })
      .finally(() => {
        clearTimeout(timeoutHandle);
        options.signal?.removeEventListener('abort', onAbort);

        // The worker may have been replaced in crash/timeout paths.
        const current = this.workers.get(id);
        if (current && current === managed) {
          managed.busy = false;
          this.startIdleTimer(id, managed);
        }

        // Kick the dispatcher in case tasks are waiting.
        this.dispatch();
      });
  }

  // ── Worker lifecycle ─────────────────────────────────────────

  /**
   * Find the first idle worker and return its entry.
   *
   * @internal
   */
  private findIdleWorker(): { id: number; managed: ManagedWorker<T> } | null {
    for (const [id, managed] of this.workers) {
      if (!managed.busy) {
        return { id, managed };
      }
    }
    return null;
  }

  /**
   * Create a new worker if pool capacity allows.
   *
   * @returns The new worker entry, or `null` if at maximum capacity.
   * @internal
   */
  private tryCreateWorker(): { id: number; managed: ManagedWorker<T> } | null {
    if (this.workers.size >= this.maxWorkers) return null;

    try {
      const id = this.nextWorkerId++;
      const wrapped = createWorker<T>(this.workerUrl, {
        name: `pool-worker-${id}`,
        timeoutMs: this.taskTimeoutMs,
      });

      const managed: ManagedWorker<T> = {
        wrapped,
        busy: false,
        idleTimer: null,
      };

      this.workers.set(id, managed);
      return { id, managed };
    } catch (err) {
      // Worker creation failed — surface the error but don't crash
      // the pool.
      // eslint-disable-next-line no-console
      console.error(
        buildWorkerError(
          'WORKER_POOL_CREATION_FAILED',
          'Worker Pool Error',
          'Failed to create a new worker for the pool',
          ErrorSeverity.ERROR,
          { workerUrl: this.workerUrl.href },
          err instanceof Error ? err : new Error(String(err)),
        ),
      );
      return null;
    }
  }

  /**
   * Terminate a managed worker and remove it from the pool.  If the
   * pool has dropped below `minWorkers` and is not shutting down, a
   * replacement will be created on the next {@link dispatch} call.
   *
   * @internal
   */
  private replaceWorker(id: number): void {
    const managed = this.workers.get(id);
    if (managed) {
      this.terminateWorker(id, managed);
    }

    // Eagerly create a replacement so dispatch has capacity.
    if (!this.destroyed) {
      this.tryCreateWorker();
      this.dispatch();
    }
  }

  /**
   * Clean up a single worker: clear timers, dispose Comlink proxy,
   * terminate the browser Worker.
   *
   * @internal
   */
  private terminateWorker(id: number, managed: ManagedWorker<T>): void {
    this.clearIdleTimer(managed);

    try {
      managed.wrapped.dispose();
    } catch {
      // Best-effort cleanup — the worker may already be dead.
    }

    this.workers.delete(id);
  }

  // ── Idle management ──────────────────────────────────────────

  /**
   * Start the idle timer for a worker. When it fires the worker is
   * terminated (unless doing so would drop below `minWorkers`).
   *
   * @internal
   */
  private startIdleTimer(id: number, managed: ManagedWorker<T>): void {
    this.clearIdleTimer(managed);

    managed.idleTimer = setTimeout(() => {
      // Don't reap below minimum.
      if (this.workers.size <= this.minWorkers) return;

      if (!managed.busy) {
        this.terminateWorker(id, managed);
      }
    }, this.idleTimeoutMs);
  }

  /**
   * Cancel a pending idle timer.
   *
   * @internal
   */
  private clearIdleTimer(managed: ManagedWorker<T>): void {
    if (managed.idleTimer !== null) {
      clearTimeout(managed.idleTimer);
      managed.idleTimer = null;
    }
  }

  // ── Utilities ────────────────────────────────────────────────

  /**
   * Read `navigator.hardwareConcurrency`, falling back to `4` when
   * the API is unavailable (e.g. in some test environments).
   *
   * @internal
   */
  private getHardwareConcurrency(): number {
    try {
      return typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency
        : 4;
    } catch {
      return 4;
    }
  }

  /**
   * Heuristic: does this error look like a worker crash (as opposed
   * to a normal application-level rejection)?
   *
   * @internal
   */
  private isWorkerCrash(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return msg.includes('worker') || msg.includes('terminated') || msg.includes('disposed');
    }
    // CPAPError with fatal severity indicates the worker is gone.
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as CPAPError).severity === ErrorSeverity.FATAL
    ) {
      return true;
    }
    return false;
  }

  /**
   * Return a promise that resolves once every worker is idle.
   *
   * @internal
   */
  private waitForIdle(): Promise<void> {
    return new Promise<void>((resolve) => {
      const check = (): void => {
        const hasBusy = [...this.workers.values()].some((w) => w.busy);
        if (!hasBusy) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }
}
