/**
 * requestAnimationFrame-coalescing width applier for the Signal Viewer's
 * chart-wrapper {@link ResizeObserver}.
 *
 * PROBLEM
 * -------
 * The collapsible sidebar animates the content area's width over
 * ~200ms (`var(--transition-base)`). While it animates, the wrapper width
 * changes every frame, so the Signal Viewer's `ResizeObserver` fires on EVERY
 * animation frame. Each tick previously called `setWrapperWidth(width)`, which
 * cascades into an expensive full-resolution WebGL2/Canvas2D re-render
 * (`renderer.resize` + draw) of 25–50 Hz CPAP time-series plus several
 * `getComputedStyle`-reading memos — roughly one full re-render per frame
 * (~12 per transition at 60fps). We must NOT re-render mid-transition, yet must
 * still settle to the correct FINAL width exactly once.
 *
 * SOLUTION
 * --------
 * Two layers of coalescing, both flowing through one tiny object:
 *
 *  1. rAF-coalesce ALL resize handling (good hygiene, also helps ordinary
 *     window resizes): every observed width merely records the latest value and
 *     ensures AT MOST ONE pending `requestAnimationFrame`. When the frame fires,
 *     it applies the latest width once. N observer entries within one frame →
 *     one apply.
 *
 *  2. While `isAnimating()` is true (the sidebar transition is in flight), the
 *     coalesced frame does NOT apply — it skips the expensive `setWrapperWidth`
 *     entirely and instead arms a lightweight rAF poll that watches for the flag
 *     to clear. The moment animation ends, the poll performs exactly ONE
 *     trailing apply of the LATEST recorded width. This cannot miss the final
 *     width because the width is always read fresh from the latest recorded
 *     value at apply time (never a stale snapshot captured when the skip
 *     happened), and the poll terminates as soon as the flag clears.
 *
 * Both paths are idempotent at the value level: applying the same final width
 * twice is harmless (the host's resize effect/memos are keyed on the width
 * value). The object guarantees no leaked rAF handles: {@link
 * ResizeCoalescer.cancel} cancels both the apply frame and the animation poll.
 *
 * The coalescer is deliberately tiny and pure (no React, no direct DOM beyond
 * the injected rAF/predicate callbacks) so it can be unit-tested at the lowest
 * seam: drive it with a stub rAF and a controllable `isAnimating` predicate,
 * then assert that zero applies occur while animating and exactly one trailing
 * apply with the final width occurs once the flag clears. The production host
 * (SignalViewer) injects `window.requestAnimationFrame` /
 * `window.cancelAnimationFrame` and an `isAnimating` predicate reading
 * `document.body.dataset.sidebarAnimating === 'true'`.
 *
 * @module views/Sessions/resizeCoalescer
 */

/** Injectable rAF surface so the coalescer is testable without a real clock. */
export interface RafLike {
  /** Schedule `cb` for the next frame; returns a cancellable handle (non-zero). */
  readonly requestAnimationFrame: (cb: () => void) => number;
  /** Cancel a previously scheduled handle. */
  readonly cancelAnimationFrame: (handle: number) => void;
}

/**
 * A coalescing width applier. One instance is owned by the Signal Viewer's
 * renderer lifecycle; each observed resize calls {@link ResizeCoalescer.record}
 * and the object decides when (and whether) to apply.
 */
export interface ResizeCoalescer {
  /**
   * Record `width` as the latest observed wrapper width and ensure exactly one
   * pending frame. Widths ≤ 0 are ignored (a detached/zero-size wrapper). When
   * the frame fires it applies the latest width — UNLESS animation is in flight,
   * in which case it skips the apply and arms the post-animation trailing apply.
   */
  record(width: number): void;
  /** Whether an apply frame is currently scheduled but not yet run. */
  readonly hasPendingFrame: boolean;
  /** Whether the post-animation trailing-apply poll is currently armed. */
  readonly isWatchingAnimation: boolean;
  /** The latest recorded width (the value a trailing apply would use). */
  readonly latestWidth: number;
  /**
   * Cancel any pending apply frame AND the animation poll, dropping pending
   * work without applying. Used on renderer teardown / component unmount so
   * nothing leaks and no apply fires after dispose.
   */
  cancel(): void;
}

/**
 * Create a {@link ResizeCoalescer}.
 *
 * @param apply       - Called (at most once per frame) with the latest width.
 *                      In the host this is `setWrapperWidth`.
 * @param isAnimating - Returns whether the sidebar transition is in flight. In
 *                      the host: `document.body.dataset.sidebarAnimating === 'true'`.
 * @param raf         - Injectable rAF surface (defaults to `window`'s).
 */
export function createResizeCoalescer(
  apply: (width: number) => void,
  isAnimating: () => boolean,
  raf: RafLike = {
    requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  },
): ResizeCoalescer {
  /** Latest observed width; the single source of truth for any apply. */
  let latestWidth = 0;
  /** Handle of the coalescing apply frame, or null when none is pending. */
  let frameHandle: number | null = null;
  /** Handle of the post-animation poll frame, or null when not watching. */
  let pollHandle: number | null = null;

  /** Apply the freshest recorded width (never a stale snapshot). */
  function applyLatest(): void {
    if (latestWidth > 0) apply(latestWidth);
  }

  /**
   * rAF poll that fires the trailing apply once animation ends. Re-arms itself
   * each frame while animation is still in flight, and terminates (applying the
   * latest width exactly once) the first frame the flag is clear. Idempotent to
   * arm: a second `arm` while already watching is a no-op.
   */
  function armAnimationPoll(): void {
    if (pollHandle !== null) return; // already watching → don't stack polls.
    pollHandle = raf.requestAnimationFrame(function poll() {
      if (isAnimating()) {
        // Still animating: keep watching WITHOUT applying (no mid-transition
        // re-render). Re-arm for the next frame.
        pollHandle = raf.requestAnimationFrame(poll);
        return;
      }
      // Animation ended: perform the single authoritative trailing apply of the
      // latest recorded width, then stop watching.
      pollHandle = null;
      applyLatest();
    });
  }

  return {
    record(width: number): void {
      if (width <= 0) return; // ignore detached / zero-size wrapper.
      // Always record the newest width; any apply uses whatever is latest.
      latestWidth = width;
      if (frameHandle !== null) return; // a frame is already queued → coalesce.
      frameHandle = raf.requestAnimationFrame(() => {
        frameHandle = null;
        if (isAnimating()) {
          // Mid-transition: skip the expensive apply and ensure the trailing
          // apply will run once the flag clears.
          armAnimationPoll();
          return;
        }
        applyLatest();
      });
    },

    get hasPendingFrame(): boolean {
      return frameHandle !== null;
    },

    get isWatchingAnimation(): boolean {
      return pollHandle !== null;
    },

    get latestWidth(): number {
      return latestWidth;
    },

    cancel(): void {
      if (frameHandle !== null) {
        raf.cancelAnimationFrame(frameHandle);
        frameHandle = null;
      }
      if (pollHandle !== null) {
        raf.cancelAnimationFrame(pollHandle);
        pollHandle = null;
      }
    },
  };
}
