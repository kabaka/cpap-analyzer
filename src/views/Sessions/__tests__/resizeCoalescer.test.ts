/**
 * Unit tests for the rAF-coalescing {@link createResizeCoalescer}.
 *
 * This is the LOWEST, cleanest seam for proving the sidebar-transition fix: the
 * coalescer is a tiny pure object whose only side effects flow through an
 * injectable {@link RafLike} and an injectable `isAnimating` predicate. By
 * feeding it a STUB rAF (callbacks fire only when we flush) and a controllable
 * predicate, we can:
 *   - schedule N resize ticks "within one frame" and assert ONE apply with the
 *     latest width;
 *   - flip on `isAnimating`, drive many frames of ticks, and assert ZERO applies
 *     occur mid-transition (only a single, non-stacking poll chain);
 *   - flip off `isAnimating` and assert exactly ONE trailing apply with the
 *     FRESHEST width (including a width recorded WHILE animating);
 *   - assert teardown cancels both the apply frame and the animation poll so
 *     nothing leaks and nothing applies after dispose.
 *
 * The manual rAF stub models real frame semantics: `flushFrame` snapshots the
 * currently-queued callbacks, clears the queue, then runs them — so a callback
 * that re-arms via `requestAnimationFrame` (the poll) schedules into the NEXT
 * batch, never the current one. `isAnimating` is a mutable boolean flipped
 * between flushes; NO real timers/rAF are used.
 *
 * The production host (SignalViewer) injects `window.requestAnimationFrame` /
 * `window.cancelAnimationFrame` and an `isAnimating` reading
 * `document.body.dataset.sidebarAnimating === 'true'`.
 *
 * @module views/Sessions/__tests__/resizeCoalescer.test
 */

import { describe, it, expect, vi } from 'vitest';

import { createResizeCoalescer, type RafLike } from '../resizeCoalescer';

// ── Manual rAF stub ──────────────────────────────────────────────
//
// Records scheduled callbacks instead of running them, so the test controls
// exactly when a "frame" fires. `flushFrame` runs every callback queued so far
// (mirroring the browser draining its rAF queue once per vsync); a callback that
// re-schedules (the animation poll) queues for the NEXT flush. Handles are
// non-zero and strictly increasing so the coalescer's `!== null` checks behave.

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

describe('createResizeCoalescer', () => {
  // ── 1 & 2: coalescing and the ordinary (non-animating) apply path ──────────
  describe('ordinary (non-animating) resizes', () => {
    it('coalesces N records within one frame into exactly ONE apply of the LATEST width', () => {
      const raf = createManualRaf();
      const apply = vi.fn<(w: number) => void>();
      const coalescer = createResizeCoalescer(apply, () => false, raf);

      // The documented example: record 100, 200, 300 → flush → apply once w/ 300.
      coalescer.record(100);
      coalescer.record(200);
      coalescer.record(300);

      // Nothing applied yet, only ONE frame scheduled (the rest coalesced into it).
      expect(apply).not.toHaveBeenCalled();
      expect(raf.requestCount).toBe(1);
      expect(raf.queued).toBe(1);
      expect(coalescer.hasPendingFrame).toBe(true);
      expect(coalescer.latestWidth).toBe(300);

      raf.flushFrame();

      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(300);
      expect(coalescer.hasPendingFrame).toBe(false);
    });

    it('applies the latest width exactly once when a single flush fires (no animation)', () => {
      const raf = createManualRaf();
      const apply = vi.fn<(w: number) => void>();
      const coalescer = createResizeCoalescer(apply, () => false, raf);

      coalescer.record(640);
      raf.flushFrame();

      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(640);
      expect(coalescer.isWatchingAnimation).toBe(false);
    });

    it('re-arms across frames: one apply per frame, not one per record', () => {
      const raf = createManualRaf();
      const apply = vi.fn<(w: number) => void>();
      const coalescer = createResizeCoalescer(apply, () => false, raf);

      coalescer.record(200);
      coalescer.record(201);
      raf.flushFrame(); // → apply(201)

      coalescer.record(202);
      raf.flushFrame(); // → apply(202)

      expect(apply).toHaveBeenCalledTimes(2);
      expect(apply).toHaveBeenNthCalledWith(1, 201);
      expect(apply).toHaveBeenNthCalledWith(2, 202);
      expect(raf.requestCount).toBe(2);
    });
  });

  // ── 3: non-positive widths are ignored (early return, no state mutation) ────
  describe('non-positive widths', () => {
    it('ignores record(0) and record(<0) from a fresh coalescer: no frame, no apply', () => {
      const raf = createManualRaf();
      const apply = vi.fn();
      const coalescer = createResizeCoalescer(apply, () => false, raf);

      coalescer.record(0);
      coalescer.record(-5);

      // record() returns early before scheduling, so no frame exists and latest
      // stays at its initial 0.
      expect(coalescer.hasPendingFrame).toBe(false);
      expect(coalescer.latestWidth).toBe(0);
      expect(raf.requestCount).toBe(0);

      raf.flushFrame();
      expect(apply).not.toHaveBeenCalled();
    });

    it('a record(0) AFTER a positive value does NOT overwrite latestWidth (early return)', () => {
      const raf = createManualRaf();
      const apply = vi.fn<(w: number) => void>();
      const coalescer = createResizeCoalescer(apply, () => false, raf);

      coalescer.record(480);
      expect(coalescer.latestWidth).toBe(480);
      expect(raf.requestCount).toBe(1);

      // record(0) hits the `if (width <= 0) return` guard BEFORE touching
      // latestWidth or scheduling, so the prior positive value survives and no
      // additional frame is requested.
      coalescer.record(0);
      expect(coalescer.latestWidth).toBe(480);
      expect(raf.requestCount).toBe(1);

      raf.flushFrame();
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(480);
    });
  });

  // ── 4 & 5: behavior while the sidebar transition is in flight ──────────────
  describe('during the sidebar transition', () => {
    it('skips the apply mid-transition and arms the animation poll instead', () => {
      const raf = createManualRaf();
      const apply = vi.fn();
      const animating = true;
      const coalescer = createResizeCoalescer(apply, () => animating, raf);

      coalescer.record(400);
      expect(coalescer.hasPendingFrame).toBe(true);
      expect(coalescer.isWatchingAnimation).toBe(false);

      // The apply frame fires while animating → it must NOT apply; instead it
      // arms the poll.
      raf.flushFrame();
      expect(apply).not.toHaveBeenCalled();
      expect(coalescer.hasPendingFrame).toBe(false);
      expect(coalescer.isWatchingAnimation).toBe(true);
    });

    it('keeps polling without applying while animating, then applies ONCE with the latest width after it clears', () => {
      const raf = createManualRaf();
      const apply = vi.fn<(w: number) => void>();
      let animating = true;
      const coalescer = createResizeCoalescer(apply, () => animating, raf);

      // The sidebar animates: the observer fires every frame with a changing
      // width. We record-then-flush, draining the apply frame, then flush again
      // to drain the re-armed poll. NOTHING expensive must apply.
      const widths = [320, 360, 400, 440, 480, 520, 560, 600];
      for (const w of widths) {
        coalescer.record(w);
        raf.flushFrame(); // drains the apply frame (skips) → arms/keeps the poll
        raf.flushFrame(); // drains the re-armed poll frame (still animating)
      }
      expect(apply).not.toHaveBeenCalled();
      expect(coalescer.isWatchingAnimation).toBe(true);
      expect(coalescer.latestWidth).toBe(600);

      // Animation ends. The next poll frame detects the cleared flag and applies
      // the LATEST recorded width exactly once.
      animating = false;
      raf.flushFrame();
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(600);
      expect(coalescer.isWatchingAnimation).toBe(false);

      // No further applies on subsequent stray frames.
      raf.flushFrame();
      expect(apply).toHaveBeenCalledTimes(1);
    });

    it('the trailing apply uses a width recorded WHILE animating (freshest value, not a stale snapshot)', () => {
      const raf = createManualRaf();
      const apply = vi.fn<(w: number) => void>();
      let animating = true;
      const coalescer = createResizeCoalescer(apply, () => animating, raf);

      // First mid-transition tick arms the poll (apply skipped).
      coalescer.record(400);
      raf.flushFrame(); // apply frame → skip + arm poll
      expect(coalescer.isWatchingAnimation).toBe(true);
      expect(apply).not.toHaveBeenCalled();

      // The TRUE final width is recorded later, still WHILE animating and with no
      // further observer tick after the flag clears. applyLatest reads latestWidth
      // fresh, so the poll must pick up 742 — proving no stale snapshot was taken
      // at the moment the skip happened.
      coalescer.record(742);
      expect(coalescer.latestWidth).toBe(742);

      // Drain any frames queued while still animating: no apply must occur.
      raf.flushFrame();
      raf.flushFrame();
      expect(apply).not.toHaveBeenCalled();

      // Flag clears with NO further record. The trailing apply uses 742.
      animating = false;
      raf.flushFrame();
      raf.flushFrame();
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(742);
    });

    it('does not stack polls: many mid-transition records keep a single poll chain and one trailing apply', () => {
      const raf = createManualRaf();
      const apply = vi.fn<(w: number) => void>();
      let animating = true;
      const coalescer = createResizeCoalescer(apply, () => animating, raf);

      // Many records + flushes while animating must keep AT MOST one queued
      // callback alive (queued callbacks never balloon → no stacked polls).
      for (let i = 0; i < 20; i++) {
        coalescer.record(300 + i);
        raf.flushFrame();
        expect(raf.queued).toBeLessThanOrEqual(1);
      }
      expect(coalescer.isWatchingAnimation).toBe(true);

      animating = false;
      raf.flushFrame();
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(319);
      expect(coalescer.isWatchingAnimation).toBe(false);
    });
  });

  // ── 6: teardown cancels both the apply frame and the animation poll ────────
  describe('teardown via cancel()', () => {
    it('cancels a pending apply frame so a later flush never applies', () => {
      const raf = createManualRaf();
      const apply = vi.fn();
      const coalescer = createResizeCoalescer(apply, () => false, raf);

      coalescer.record(500);
      expect(coalescer.hasPendingFrame).toBe(true);

      coalescer.cancel();
      expect(coalescer.hasPendingFrame).toBe(false);
      expect(raf.cancelCount).toBe(1); // the apply frame handle was cancelled
      expect(raf.queued).toBe(0);

      raf.flushFrame(); // stray frame after teardown
      expect(apply).not.toHaveBeenCalled();
    });

    it('cancels the animation poll so no trailing apply fires even once the flag clears', () => {
      const raf = createManualRaf();
      const apply = vi.fn();
      let animating = true;
      const coalescer = createResizeCoalescer(apply, () => animating, raf);

      coalescer.record(500);
      raf.flushFrame(); // apply frame → skip + arm poll
      expect(coalescer.isWatchingAnimation).toBe(true);
      expect(raf.queued).toBe(1); // the live poll callback

      coalescer.cancel();
      expect(coalescer.isWatchingAnimation).toBe(false);
      expect(raf.cancelCount).toBe(1); // the poll handle was cancelled
      expect(raf.queued).toBe(0); // queue drained, nothing left to fire

      // Even after the flag clears, the cancelled poll must never apply.
      animating = false;
      raf.flushFrame();
      raf.flushFrame();
      expect(apply).not.toHaveBeenCalled();
    });

    it('is idempotent: a second cancel() does nothing and does not throw', () => {
      const raf = createManualRaf();
      const apply = vi.fn();
      const coalescer = createResizeCoalescer(apply, () => false, raf);

      coalescer.record(500);
      coalescer.cancel();
      expect(raf.cancelCount).toBe(1);

      expect(() => coalescer.cancel()).not.toThrow();
      expect(raf.cancelCount).toBe(1); // nothing live to cancel the second time
    });
  });

  // ── 7: getters reflect state at the right moments ──────────────────────────
  describe('readonly getters', () => {
    it('latestWidth starts at 0 and tracks the most recent positive record', () => {
      const raf = createManualRaf();
      const coalescer = createResizeCoalescer(vi.fn(), () => false, raf);

      expect(coalescer.latestWidth).toBe(0);
      coalescer.record(123);
      expect(coalescer.latestWidth).toBe(123);
      coalescer.record(456);
      expect(coalescer.latestWidth).toBe(456);
    });

    it('hasPendingFrame is true only between scheduling and the frame firing', () => {
      const raf = createManualRaf();
      const coalescer = createResizeCoalescer(vi.fn(), () => false, raf);

      expect(coalescer.hasPendingFrame).toBe(false);
      coalescer.record(200);
      expect(coalescer.hasPendingFrame).toBe(true);
      raf.flushFrame();
      expect(coalescer.hasPendingFrame).toBe(false);
    });

    it('isWatchingAnimation is true only between arming and the trailing apply', () => {
      const raf = createManualRaf();
      let animating = true;
      const coalescer = createResizeCoalescer(vi.fn(), () => animating, raf);

      expect(coalescer.isWatchingAnimation).toBe(false);
      coalescer.record(200);
      expect(coalescer.isWatchingAnimation).toBe(false); // apply frame, not poll, yet
      raf.flushFrame(); // apply frame fires → arms poll
      expect(coalescer.isWatchingAnimation).toBe(true);

      animating = false;
      raf.flushFrame(); // poll fires the trailing apply and stops watching
      expect(coalescer.isWatchingAnimation).toBe(false);
    });
  });

  // ── Default wiring smoke test (covers the window-backed branch) ─────────────
  it('defaults to window rAF when no RafLike is injected (smoke)', async () => {
    const apply = vi.fn();
    const coalescer = createResizeCoalescer(apply, () => false);
    coalescer.record(640);
    expect(coalescer.hasPendingFrame).toBe(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(640);
  });
});
