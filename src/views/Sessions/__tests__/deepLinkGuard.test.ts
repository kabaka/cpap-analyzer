/**
 * Tests for the Signal Viewer's `?t=` deep-link decision logic.
 *
 * Covers the fix for QA M4:
 * - `sessionStartMs === 0` is a valid epoch (regression for `!sessionStartMs`).
 * - Out-of-range targets surface a status notice and DO NOT poison the
 *   applied-ref — so a later URL update with a now-valid target is retried.
 */

import { describe, it, expect } from 'vitest';
import { evaluateDeepLink, OUT_OF_RANGE_MESSAGE } from '../deepLinkGuard';

const SESSION = { startTime: '2025-03-15T02:00:00Z' };
const DURATION = 8 * 60 * 60 * 1000; // 8h
const SESSION_START = Date.UTC(2025, 2, 15, 2, 0, 0); // epoch ms for 02:00 UTC

describe('evaluateDeepLink', () => {
  it('is pending while the data is still loading', () => {
    expect(
      evaluateDeepLink({
        deepLinkTargetMs: SESSION_START + 60_000,
        fullDataReady: false,
        totalDurationMs: DURATION,
        session: SESSION,
        sessionStartMs: SESSION_START,
        appliedTarget: null,
      }),
    ).toEqual({ kind: 'pending' });
  });

  it('is pending when no target is provided', () => {
    expect(
      evaluateDeepLink({
        deepLinkTargetMs: null,
        fullDataReady: true,
        totalDurationMs: DURATION,
        session: SESSION,
        sessionStartMs: SESSION_START,
        appliedTarget: null,
      }),
    ).toEqual({ kind: 'pending' });
  });

  it('applies an in-range target with a ±1 minute window', () => {
    const target = SESSION_START + 5 * 60 * 1000; // 5 min in
    const decision = evaluateDeepLink({
      deepLinkTargetMs: target,
      fullDataReady: true,
      totalDurationMs: DURATION,
      session: SESSION,
      sessionStartMs: SESSION_START,
      appliedTarget: null,
    });
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      expect(decision.start).toBe(4 * 60 * 1000);
      expect(decision.end).toBe(6 * 60 * 1000);
    }
  });

  it('treats sessionStartMs === 0 as a valid epoch (regression for the M4 truthiness bug)', () => {
    // Previously `!sessionStartMs` rejected the literal Unix epoch as
    // "not ready", which the QA finding flagged. This must now apply.
    const target = 60_000; // 1 minute after epoch
    const decision = evaluateDeepLink({
      deepLinkTargetMs: target,
      fullDataReady: true,
      totalDurationMs: 10 * 60_000,
      session: SESSION,
      sessionStartMs: 0,
      appliedTarget: null,
    });
    expect(decision.kind).toBe('apply');
  });

  it('returns out-of-range when target precedes the session start', () => {
    const decision = evaluateDeepLink({
      deepLinkTargetMs: SESSION_START - 60_000, // 1 min BEFORE the session
      fullDataReady: true,
      totalDurationMs: DURATION,
      session: SESSION,
      sessionStartMs: SESSION_START,
      appliedTarget: null,
    });
    expect(decision).toEqual({ kind: 'out-of-range', message: OUT_OF_RANGE_MESSAGE });
  });

  it('returns out-of-range when target exceeds the session end', () => {
    const decision = evaluateDeepLink({
      deepLinkTargetMs: SESSION_START + DURATION + 60_000,
      fullDataReady: true,
      totalDurationMs: DURATION,
      session: SESSION,
      sessionStartMs: SESSION_START,
      appliedTarget: null,
    });
    expect(decision.kind).toBe('out-of-range');
  });

  it('does NOT mark out-of-range targets as applied (regression: would poison retries)', () => {
    // After an out-of-range result, the caller must not stamp the applied-ref;
    // otherwise a later URL with a valid target gets short-circuited.
    const decision1 = evaluateDeepLink({
      deepLinkTargetMs: SESSION_START - 60_000,
      fullDataReady: true,
      totalDurationMs: DURATION,
      session: SESSION,
      sessionStartMs: SESSION_START,
      appliedTarget: null,
    });
    expect(decision1.kind).toBe('out-of-range');

    // Now a different, in-range target arrives. With appliedTarget still null
    // (because out-of-range didn't stamp) we should apply normally.
    const decision2 = evaluateDeepLink({
      deepLinkTargetMs: SESSION_START + 30_000,
      fullDataReady: true,
      totalDurationMs: DURATION,
      session: SESSION,
      sessionStartMs: SESSION_START,
      appliedTarget: null,
    });
    expect(decision2.kind).toBe('apply');
  });

  it('dedups when the same target has already been applied', () => {
    const target = SESSION_START + 30_000;
    expect(
      evaluateDeepLink({
        deepLinkTargetMs: target,
        fullDataReady: true,
        totalDurationMs: DURATION,
        session: SESSION,
        sessionStartMs: SESSION_START,
        appliedTarget: target,
      }),
    ).toEqual({ kind: 'already-applied' });
  });
});
