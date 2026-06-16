/**
 * Unit tests for the rAF-coalescing {@link createFramePaintScheduler}.
 *
 * This is the LOWEST, cleanest seam for proving the gesture-coalescing win
 * (Task 1): the scheduler is a tiny pure object whose only side effects flow
 * through an injectable {@link RafLike}. By feeding it a STUB rAF that defers
 * callbacks until we fire them manually, we can schedule N synthetic input
 * events "within one frame" and assert that exactly ONE paint occurs with the
 * most-recent viewport — independent of React, the DOM, or a real clock.
 *
 * The production host (SignalViewer) shares ONE scheduler between the drag-pan
 * and wheel-zoom hot paths; these tests cover the contract both rely on:
 *   - coalescing (many schedules → one paint),
 *   - trailing-value semantics (the paint uses the LAST scheduled viewport),
 *   - re-arming across frames,
 *   - flushPending (gesture-settle), and
 *   - cancel (unmount/teardown) dropping pending frames without painting.
 *
 * @module views/Sessions/__tests__/framePaintScheduler.test
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createFramePaintScheduler,
  type FrameViewportRange,
  type RafLike,
} from '../framePaintScheduler';

// ── Manual rAF stub ──────────────────────────────────────────────
//
// Records scheduled callbacks instead of running them, so the test controls
// exactly when a "frame" fires. `flushFrame` runs every callback queued so far
// (mirroring the browser draining its rAF queue once per vsync); `pending`
// exposes how many are queued; the cancel count proves teardown cancels.

interface ManualRaf extends RafLike {
  /** Run all callbacks queued since the last flush (one simulated vsync). */
  flushFrame(): void;
  /** Number of callbacks currently queued (not yet flushed/cancelled). */
  readonly queued: number;
  /** How many distinct handles requestAnimationFrame has issued. */
  readonly requestCount: number;
  /** How many times cancelAnimationFrame was invoked with a live handle. */
  readonly cancelCount: number;
}

function createManualRaf(): ManualRaf {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1; // non-zero handles (0 can read as "no handle")
  let requestCount = 0;
  let cancelCount = 0;

  return {
    requestAnimationFrame(cb: () => void): number {
      const handle = nextHandle++;
      requestCount++;
      callbacks.set(handle, cb);
      return handle;
    },
    cancelAnimationFrame(handle: number): void {
      if (callbacks.delete(handle)) cancelCount++;
    },
    flushFrame(): void {
      // Snapshot then clear, so a callback that re-schedules queues for the NEXT
      // flush (exactly how the browser behaves — a rAF cb's rAF runs next frame).
      const snapshot = [...callbacks.values()];
      callbacks.clear();
      for (const cb of snapshot) cb();
    },
    get queued() {
      return callbacks.size;
    },
    get requestCount() {
      return requestCount;
    },
    get cancelCount() {
      return cancelCount;
    },
  };
}

const range = (startTime: number, endTime: number): FrameViewportRange => ({ startTime, endTime });

describe('createFramePaintScheduler', () => {
  it('coalesces N schedules within one frame into exactly ONE paint of the latest viewport', () => {
    const raf = createManualRaf();
    const paint = vi.fn<(r: FrameViewportRange) => void>();
    const scheduler = createFramePaintScheduler(paint, raf);

    // Simulate a high-rate pointer/wheel burst: many events before any vsync.
    const N = 120; // ~one frame of 120 Hz trackpad moves
    for (let i = 0; i < N; i++) scheduler.schedule(range(i, i + 1000));

    // No paint yet (no frame has fired) and only ONE rAF was ever requested.
    expect(paint).not.toHaveBeenCalled();
    expect(raf.requestCount).toBe(1);
    expect(raf.queued).toBe(1);
    expect(scheduler.hasPending).toBe(true);

    // The frame fires once → exactly one paint, with the LAST scheduled range.
    raf.flushFrame();
    expect(paint).toHaveBeenCalledTimes(1);
    expect(paint).toHaveBeenCalledWith(range(N - 1, N - 1 + 1000));
    expect(scheduler.hasPending).toBe(false);
  });

  it('re-arms across frames: one paint per frame, not one per schedule', () => {
    const raf = createManualRaf();
    const paint = vi.fn<(r: FrameViewportRange) => void>();
    const scheduler = createFramePaintScheduler(paint, raf);

    // Frame 1: 3 schedules → 1 paint.
    scheduler.schedule(range(0, 10));
    scheduler.schedule(range(1, 11));
    scheduler.schedule(range(2, 12));
    raf.flushFrame();

    // Frame 2: 2 more schedules → 1 more paint.
    scheduler.schedule(range(3, 13));
    scheduler.schedule(range(4, 14));
    raf.flushFrame();

    expect(paint).toHaveBeenCalledTimes(2);
    expect(paint).toHaveBeenNthCalledWith(1, range(2, 12));
    expect(paint).toHaveBeenNthCalledWith(2, range(4, 14));
    // 5 schedules across 2 frames requested only 2 animation frames total.
    expect(raf.requestCount).toBe(2);
  });

  it('does not paint when a flushed frame has no pending viewport', () => {
    const raf = createManualRaf();
    const paint = vi.fn();
    createFramePaintScheduler(paint, raf);

    // Flushing with nothing scheduled is a no-op (no frame was ever requested).
    raf.flushFrame();
    expect(paint).not.toHaveBeenCalled();
  });

  it('flushPending returns the pending viewport and cancels the frame WITHOUT painting', () => {
    const raf = createManualRaf();
    const paint = vi.fn();
    const scheduler = createFramePaintScheduler(paint, raf);

    scheduler.schedule(range(5, 25));
    scheduler.schedule(range(6, 26)); // latest wins
    expect(scheduler.hasPending).toBe(true);

    const pending = scheduler.flushPending();
    expect(pending).toEqual(range(6, 26));
    // The queued frame was cancelled and no paint ran (caller paints it itself).
    expect(scheduler.hasPending).toBe(false);
    expect(raf.cancelCount).toBe(1);
    expect(paint).not.toHaveBeenCalled();

    // A subsequent flush returns null (nothing left), and a stray vsync is inert.
    expect(scheduler.flushPending()).toBeNull();
    raf.flushFrame();
    expect(paint).not.toHaveBeenCalled();
  });

  it('cancel() drops a pending frame so unmount/teardown never paints after dispose', () => {
    const raf = createManualRaf();
    const paint = vi.fn();
    const scheduler = createFramePaintScheduler(paint, raf);

    scheduler.schedule(range(7, 70));
    expect(scheduler.hasPending).toBe(true);

    // Mirror the SignalViewer unmount path: scheduler.cancel() on teardown.
    scheduler.cancel();
    expect(scheduler.hasPending).toBe(false);
    expect(raf.cancelCount).toBe(1);

    // Even if a stray frame fires after teardown, no paint occurs.
    raf.flushFrame();
    expect(paint).not.toHaveBeenCalled();

    // cancel() is idempotent.
    expect(() => scheduler.cancel()).not.toThrow();
    expect(raf.cancelCount).toBe(1);
  });

  it('defaults to window rAF when no RafLike is injected (smoke)', async () => {
    // No stub: exercises the default branch so the production wiring is covered.
    const paint = vi.fn();
    const scheduler = createFramePaintScheduler(paint);
    scheduler.schedule(range(0, 1));
    expect(scheduler.hasPending).toBe(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    // After a real frame the default-backed scheduler painted exactly once.
    expect(paint).toHaveBeenCalledTimes(1);
    expect(paint).toHaveBeenCalledWith(range(0, 1));
  });
});
