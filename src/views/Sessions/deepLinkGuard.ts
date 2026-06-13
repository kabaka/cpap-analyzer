/**
 * Pure decision logic for the Signal Viewer's `?t=` / `?te=` deep-link guard.
 *
 * Extracted out of the (otherwise canvas/OPFS-heavy) viewer so the readiness
 * check, viewport-framing math, and out-of-session-range handling can be
 * unit-tested without mounting the full component.
 *
 * Framing model
 * -------------
 * A deep link carries `?t=<epochMs>` (the event START) and, when the event has
 * a meaningful duration, `?te=<epochMs>` (the event END). Rather than centering
 * a fixed ±60 s window on the start — which lets multi-minute CSR / periodic-
 * breathing episodes run off the right edge — we frame the WHOLE event so it
 * fills ~90 % of the viewport, leaving a little context on either side. When no
 * end is supplied we fall back to the historical ±60 s point window.
 *
 * @module views/Sessions/deepLinkGuard
 */

export interface DeepLinkGuardInput {
  /** Parsed `?t=<epochMs>` target (event start), or `null` when absent/invalid. */
  readonly deepLinkTargetMs: number | null;
  /** Parsed `?te=<epochMs>` event end, or `null` when absent/invalid. */
  readonly deepLinkEndMs: number | null;
  /** Whether the full CPAP signal data has finished loading. */
  readonly fullDataReady: boolean;
  /** Total session signal duration in ms. */
  readonly totalDurationMs: number;
  /** Loaded session metadata, or `null` while still loading. */
  readonly session: { startTime: string | Date } | null;
  /** Epoch ms of the session start. May be `0`, which IS a valid epoch. */
  readonly sessionStartMs: number;
  /** The previously-applied deep-link target, used to deduplicate. */
  readonly appliedTarget: number | null;
}

export type DeepLinkDecision =
  /** Inputs not yet ready — try again on the next render. */
  | { kind: 'pending' }
  /** Same target already applied — do nothing. */
  | { kind: 'already-applied' }
  /** Target outside session bounds — announce, but DO NOT mark as applied. */
  | { kind: 'out-of-range'; message: string }
  /**
   * Apply: set the viewport to [start, end] (session-relative ms), mark applied,
   * and surface `announcement` on the aria-live region.
   */
  | { kind: 'apply'; start: number; end: number; announcement: string };

/** Half-width of the legacy point-focus window (no `te`). */
const FOCUS_HALF_WINDOW_MS = 60_000;

/** Fraction of the viewport a framed event should fill (the rest is context). */
const TARGET_FILL_FRACTION = 0.9;

/** Floor on the framed viewport span, so very short events still get context. */
const MIN_VIEWPORT_SPAN_MS = 30_000;

/** Out-of-session-range status message — exported so tests can assert it. */
export const OUT_OF_RANGE_MESSAGE = 'Target time is outside this session.';

/**
 * Format a session-relative offset (ms) as a compact duration label.
 *
 * Mirrors the Signal Viewer's viewport label exactly so the deep-link
 * announcement reads consistently with the on-screen "Showing …" readout:
 * `<60 s → "Ns"`, `<1 h → "Mm"`, otherwise `"Hh"` / `"Hh Mm"`.
 *
 * Shared with {@link module:views/Sessions/SignalViewer} (imported there for the
 * viewport label) so the two never drift.
 */
export function formatOffsetLabel(durMs: number): string {
  if (durMs <= 0) return '0s';
  const totalSec = Math.round(durMs / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.round(totalSec / 60)}m`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.round((totalSec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Decide what to do with the current deep-link target.
 *
 * Readiness uses `Number.isFinite(sessionStartMs)` rather than `!sessionStartMs`
 * — `sessionStartMs === 0` is a valid epoch (the Unix epoch itself) and was
 * previously rejected by truthiness. Out-of-range targets are reported but NOT
 * marked as applied; that way a later URL update that becomes in-range is
 * still tried, instead of being silently short-circuited by the dedup ref.
 *
 * Dedup is keyed on `t` ONLY (the start) — `te` never participates, so a URL
 * that adds/removes `te` for the same `t` does not re-trigger framing.
 */
export function evaluateDeepLink(input: DeepLinkGuardInput): DeepLinkDecision {
  const {
    deepLinkTargetMs,
    deepLinkEndMs,
    fullDataReady,
    totalDurationMs,
    session,
    sessionStartMs,
    appliedTarget,
  } = input;
  if (deepLinkTargetMs === null) return { kind: 'pending' };
  if (!fullDataReady || totalDurationMs <= 0) return { kind: 'pending' };
  if (session === null || !Number.isFinite(sessionStartMs)) return { kind: 'pending' };
  if (appliedTarget === deepLinkTargetMs) return { kind: 'already-applied' };

  const offsetStart = deepLinkTargetMs - sessionStartMs;
  const hasEnd =
    deepLinkEndMs !== null && Number.isFinite(deepLinkEndMs) && deepLinkEndMs >= deepLinkTargetMs;
  const offsetEnd = hasEnd ? (deepLinkEndMs as number) - sessionStartMs : offsetStart;

  // In-range = OVERLAP with [0, total], not containment. With an end, the event
  // is visible as long as any part of it intersects the session. Without an end
  // we keep the historical point semantics (the start itself must be in range).
  const inRange = hasEnd
    ? offsetEnd >= 0 && offsetStart <= totalDurationMs
    : offsetStart >= 0 && offsetStart <= totalDurationMs;
  if (!inRange) {
    return { kind: 'out-of-range', message: OUT_OF_RANGE_MESSAGE };
  }

  let start: number;
  let end: number;
  let announcement: string;

  if (hasEnd) {
    const eventSpan = offsetEnd - offsetStart;
    let desiredSpan = Math.max(eventSpan / TARGET_FILL_FRACTION, MIN_VIEWPORT_SPAN_MS);
    desiredSpan = Math.min(desiredSpan, totalDurationMs);
    const center = (offsetStart + offsetEnd) / 2;
    start = center - desiredSpan / 2;
    end = center + desiredSpan / 2;
    announcement = `Framed event from ${formatOffsetLabel(offsetStart)} to ${formatOffsetLabel(
      offsetEnd,
    )}, ${Math.round(desiredSpan / 1000)} seconds shown.`;
  } else {
    // Legacy point fallback — exact historical ±60 s window behaviour.
    start = offsetStart - FOCUS_HALF_WINDOW_MS;
    end = offsetStart + FOCUS_HALF_WINDOW_MS;
    announcement = `Centered on event at ${formatOffsetLabel(offsetStart)}, 120 seconds shown.`;
  }

  // Clamp to [0, total] by SLIDING the window (preserving span), not shrinking.
  // Order matters: handle the left edge first, then the right. When the span is
  // larger than the session this collapses to start=0, end=total.
  const span = end - start;
  if (start < 0) {
    start = 0;
    end = Math.min(totalDurationMs, span);
  }
  if (end > totalDurationMs) {
    end = totalDurationMs;
    start = Math.max(0, end - span);
  }

  return { kind: 'apply', start, end, announcement };
}
