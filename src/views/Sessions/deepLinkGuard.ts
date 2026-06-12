/**
 * Pure decision logic for the Signal Viewer's `?t=` deep-link guard.
 *
 * Extracted out of the (otherwise canvas/OPFS-heavy) viewer so the readiness
 * check and out-of-session-range handling can be unit-tested without mounting
 * the full component.
 *
 * @module views/Sessions/deepLinkGuard
 */

export interface DeepLinkGuardInput {
  /** Parsed `?t=<epochMs>` target, or `null` when absent/invalid. */
  readonly deepLinkTargetMs: number | null;
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
  /** Apply: set the viewport to [start, end] (session-relative ms) and mark applied. */
  | { kind: 'apply'; start: number; end: number };

const FOCUS_HALF_WINDOW_MS = 60_000;

/** Out-of-session-range status message — exported so tests can assert it. */
export const OUT_OF_RANGE_MESSAGE = 'Target time is outside this session.';

/**
 * Decide what to do with the current deep-link target.
 *
 * Readiness uses `Number.isFinite(sessionStartMs)` rather than `!sessionStartMs`
 * — `sessionStartMs === 0` is a valid epoch (the Unix epoch itself) and was
 * previously rejected by truthiness. Out-of-range targets are reported but NOT
 * marked as applied; that way a later URL update that becomes in-range is
 * still tried, instead of being silently short-circuited by the dedup ref.
 */
export function evaluateDeepLink(input: DeepLinkGuardInput): DeepLinkDecision {
  const {
    deepLinkTargetMs,
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

  const offset = deepLinkTargetMs - sessionStartMs;
  if (offset < 0 || offset > totalDurationMs) {
    return { kind: 'out-of-range', message: OUT_OF_RANGE_MESSAGE };
  }
  const start = Math.max(0, offset - FOCUS_HALF_WINDOW_MS);
  const end = Math.min(totalDurationMs, offset + FOCUS_HALF_WINDOW_MS);
  return { kind: 'apply', start, end };
}
