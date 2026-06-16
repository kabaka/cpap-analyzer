/**
 * requestAnimationFrame-coalescing paint scheduler for the Signal Viewer's
 * direct-render interaction hot paths (drag-pan and wheel-zoom).
 *
 * PROBLEM
 * -------
 * High-rate pointing devices (120–1000 Hz trackpads/mice) fire many
 * `pointermove` / `wheel` events per displayed frame. Painting synchronously on
 * every event runs the full data + draw pipeline several times per visible
 * frame — wasted work that never reaches the screen (only the last paint before
 * the next vsync is shown).
 *
 * SOLUTION
 * --------
 * Both gestures funnel their newest viewport into a single coalescing scheduler:
 * each input event records the latest viewport and ensures AT MOST ONE
 * `requestAnimationFrame` callback is pending. When the frame fires, it paints
 * the most-recent viewport once. Additional events arriving before the frame
 * fires simply overwrite the pending viewport — they do not schedule extra
 * paints. This matches the trailing-coalesce pattern the wheel path already
 * used, factored here so the pan path can share it (DRY).
 *
 * The scheduler is deliberately tiny and pure (no React, no DOM beyond the
 * injected rAF/cancel callbacks) so it can be unit-tested at the lowest seam:
 * feed it N synthetic events within one "frame" and assert exactly one paint
 * occurs. The production host injects `window.requestAnimationFrame` /
 * `window.cancelAnimationFrame`; tests inject stubs that fire on demand.
 *
 * @module views/Sessions/framePaintScheduler
 */

/** A time window the viewer can paint (session-relative milliseconds). */
export interface FrameViewportRange {
  readonly startTime: number;
  readonly endTime: number;
}

/** Injectable rAF surface so the scheduler is testable without a real clock. */
export interface RafLike {
  /** Schedule `cb` for the next frame; returns a cancellable handle (non-zero). */
  readonly requestAnimationFrame: (cb: () => void) => number;
  /** Cancel a previously scheduled handle. */
  readonly cancelAnimationFrame: (handle: number) => void;
}

/**
 * A coalescing paint scheduler. One instance is shared by the pan and wheel
 * paths; each call to {@link FramePaintScheduler.schedule} records the latest
 * viewport and guarantees a single pending frame.
 */
export interface FramePaintScheduler {
  /**
   * Record `range` as the latest viewport to paint and ensure exactly one rAF
   * is pending. Calling this repeatedly within one frame coalesces to a single
   * paint of the most-recently-scheduled `range`.
   */
  schedule(range: FrameViewportRange): void;
  /**
   * Cancel any pending frame WITHOUT painting. Returns the viewport that was
   * pending (so a caller can paint it synchronously itself), or `null` if none.
   * Used on gesture-settle so the trailing commit can paint the final frame
   * exactly once and keep committed state == last painted frame.
   */
  flushPending(): FrameViewportRange | null;
  /** Whether a frame is currently scheduled but not yet painted. */
  readonly hasPending: boolean;
  /** Cancel any pending frame and drop its viewport (used on unmount/teardown). */
  cancel(): void;
}

/**
 * Create a {@link FramePaintScheduler}.
 *
 * @param paint - Called once per coalesced frame with the latest viewport.
 * @param raf   - Injectable rAF surface (defaults to `window`'s).
 */
export function createFramePaintScheduler(
  paint: (range: FrameViewportRange) => void,
  raf: RafLike = {
    requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  },
): FramePaintScheduler {
  let handle: number | null = null;
  let pending: FrameViewportRange | null = null;

  return {
    schedule(range: FrameViewportRange): void {
      // Always record the newest viewport; the frame paints whatever is latest.
      pending = range;
      if (handle !== null) return; // a frame is already queued → coalesce.
      handle = raf.requestAnimationFrame(() => {
        handle = null;
        const next = pending;
        pending = null;
        if (next) paint(next);
      });
    },

    flushPending(): FrameViewportRange | null {
      if (handle !== null) {
        raf.cancelAnimationFrame(handle);
        handle = null;
      }
      const next = pending;
      pending = null;
      return next;
    },

    get hasPending(): boolean {
      return handle !== null;
    },

    cancel(): void {
      if (handle !== null) {
        raf.cancelAnimationFrame(handle);
        handle = null;
      }
      pending = null;
    },
  };
}
