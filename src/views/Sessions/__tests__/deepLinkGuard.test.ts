/**
 * Tests for the Signal Viewer's `?t=` / `?te=` deep-link decision logic.
 *
 * Covers:
 * - The QA M4 fixes:
 *   - `sessionStartMs === 0` is a valid epoch (regression for `!sessionStartMs`).
 *   - Out-of-range targets surface a status notice and DO NOT poison the
 *     applied-ref — so a later URL update with a now-valid target is retried.
 * - Event-framing math introduced with `?te=` (the event END): frame the whole
 *   event to ~90 % fill, floor the span, slide-clamp at session edges, and treat
 *   in-range as overlap (not containment).
 * - The aria-live `announcement` copy for both the framed and point-fallback
 *   paths.
 */

import { describe, it, expect } from 'vitest';
import { evaluateDeepLink, OUT_OF_RANGE_MESSAGE } from '../deepLinkGuard';

const SESSION = { startTime: '2025-03-15T02:00:00Z' };
const DURATION = 8 * 60 * 60 * 1000; // 8h
const SESSION_START = Date.UTC(2025, 2, 15, 2, 0, 0); // epoch ms for 02:00 UTC

/** Builds a fully-specified guard input with sane defaults, overridable per-test. */
function makeInput(
  overrides: Partial<Parameters<typeof evaluateDeepLink>[0]> = {},
): Parameters<typeof evaluateDeepLink>[0] {
  return {
    deepLinkTargetMs: SESSION_START + 5 * 60 * 1000,
    deepLinkEndMs: null,
    fullDataReady: true,
    totalDurationMs: DURATION,
    session: SESSION,
    sessionStartMs: SESSION_START,
    appliedTarget: null,
    ...overrides,
  };
}

describe('evaluateDeepLink — readiness + dedup', () => {
  it('is pending while the data is still loading', () => {
    expect(evaluateDeepLink(makeInput({ fullDataReady: false }))).toEqual({ kind: 'pending' });
  });

  it('is pending when no target is provided', () => {
    expect(evaluateDeepLink(makeInput({ deepLinkTargetMs: null }))).toEqual({ kind: 'pending' });
  });

  it('treats sessionStartMs === 0 as a valid epoch (regression for the M4 truthiness bug)', () => {
    // Previously `!sessionStartMs` rejected the literal Unix epoch as
    // "not ready", which the QA finding flagged. This must now apply.
    const decision = evaluateDeepLink(
      makeInput({
        deepLinkTargetMs: 60_000, // 1 minute after epoch
        totalDurationMs: 10 * 60_000,
        sessionStartMs: 0,
      }),
    );
    expect(decision.kind).toBe('apply');
  });

  it('dedups when the same target has already been applied', () => {
    const target = SESSION_START + 30_000;
    expect(
      evaluateDeepLink(makeInput({ deepLinkTargetMs: target, appliedTarget: target })),
    ).toEqual({ kind: 'already-applied' });
  });

  it('keys dedup on `t` only — adding `te` for an already-applied `t` does not re-trigger', () => {
    const target = SESSION_START + 30_000;
    expect(
      evaluateDeepLink(
        makeInput({
          deepLinkTargetMs: target,
          deepLinkEndMs: target + 120_000,
          appliedTarget: target,
        }),
      ),
    ).toEqual({ kind: 'already-applied' });
  });
});

describe('evaluateDeepLink — point fallback (no te)', () => {
  it('applies an in-range target with a ±1 minute window', () => {
    const target = SESSION_START + 5 * 60 * 1000; // 5 min in
    const decision = evaluateDeepLink(makeInput({ deepLinkTargetMs: target }));
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      expect(decision.start).toBe(4 * 60 * 1000);
      expect(decision.end).toBe(6 * 60 * 1000);
    }
  });

  it('(8) falls back to the ±60 s window when te is absent', () => {
    const target = SESSION_START + 10 * 60 * 1000; // 10 min in
    const decision = evaluateDeepLink(makeInput({ deepLinkTargetMs: target, deepLinkEndMs: null }));
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      expect(decision.end - decision.start).toBe(120_000);
      expect((decision.start + decision.end) / 2).toBe(10 * 60 * 1000);
    }
  });

  it('(9) falls back to the ±60 s window when te < t (malformed)', () => {
    const target = SESSION_START + 10 * 60 * 1000;
    const decision = evaluateDeepLink(
      makeInput({ deepLinkTargetMs: target, deepLinkEndMs: target - 60_000 }),
    );
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      expect(decision.end - decision.start).toBe(120_000);
      expect((decision.start + decision.end) / 2).toBe(10 * 60 * 1000);
    }
  });

  it('returns out-of-range when target precedes the session start', () => {
    const decision = evaluateDeepLink(makeInput({ deepLinkTargetMs: SESSION_START - 60_000 }));
    expect(decision).toEqual({ kind: 'out-of-range', message: OUT_OF_RANGE_MESSAGE });
  });

  it('returns out-of-range when target exceeds the session end', () => {
    const decision = evaluateDeepLink(
      makeInput({ deepLinkTargetMs: SESSION_START + DURATION + 60_000 }),
    );
    expect(decision.kind).toBe('out-of-range');
  });

  it('does NOT mark out-of-range targets as applied (regression: would poison retries)', () => {
    // After an out-of-range result, the caller must not stamp the applied-ref;
    // otherwise a later URL with a valid target gets short-circuited.
    const decision1 = evaluateDeepLink(makeInput({ deepLinkTargetMs: SESSION_START - 60_000 }));
    expect(decision1.kind).toBe('out-of-range');

    // Now a different, in-range target arrives. With appliedTarget still null
    // (because out-of-range didn't stamp) we should apply normally.
    const decision2 = evaluateDeepLink(makeInput({ deepLinkTargetMs: SESSION_START + 30_000 }));
    expect(decision2.kind).toBe('apply');
  });
});

describe('evaluateDeepLink — event framing (with te)', () => {
  it('(1) frames a multi-minute event to span ≈ eventSpan / 0.9, centered', () => {
    const start = SESSION_START + 60 * 60 * 1000; // 1h in
    const eventSpan = 6 * 60 * 1000; // 6 min
    const decision = evaluateDeepLink(
      makeInput({ deepLinkTargetMs: start, deepLinkEndMs: start + eventSpan }),
    );
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      const span = decision.end - decision.start;
      const expectedSpan = eventSpan / 0.9;
      expect(Math.abs(span - expectedSpan) / expectedSpan).toBeLessThan(0.005);
      // Centered on the event mid-point.
      const offsetStart = 60 * 60 * 1000;
      const offsetEnd = offsetStart + eventSpan;
      const expectedCenter = (offsetStart + offsetEnd) / 2;
      expect(Math.abs((decision.start + decision.end) / 2 - expectedCenter)).toBeLessThan(1);
    }
  });

  it('(2) when te === t, span is the 30 s floor, centered on the instant', () => {
    const t = SESSION_START + 60 * 60 * 1000;
    const decision = evaluateDeepLink(makeInput({ deepLinkTargetMs: t, deepLinkEndMs: t }));
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      expect(decision.end - decision.start).toBe(30_000);
      const offset = 60 * 60 * 1000;
      expect((decision.start + decision.end) / 2).toBe(offset);
    }
  });

  it('(3) floors a 10 s event up to a 30 s viewport', () => {
    const t = SESSION_START + 60 * 60 * 1000;
    const decision = evaluateDeepLink(
      makeInput({ deepLinkTargetMs: t, deepLinkEndMs: t + 10_000 }),
    );
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      expect(decision.end - decision.start).toBe(30_000);
    }
  });

  it('(4) near the session start, slides so start=0, end=span, event fully inside', () => {
    const t = SESSION_START + 5_000; // 5 s in — centering would push start < 0
    const eventSpan = 4 * 60 * 1000; // 4 min
    const decision = evaluateDeepLink(
      makeInput({ deepLinkTargetMs: t, deepLinkEndMs: t + eventSpan }),
    );
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      const expectedSpan = eventSpan / 0.9;
      expect(decision.start).toBe(0);
      expect(Math.abs(decision.end - expectedSpan) / expectedSpan).toBeLessThan(0.005);
      // Event [5_000, 5_000 + eventSpan] fully inside [0, end].
      expect(decision.end).toBeGreaterThanOrEqual(5_000 + eventSpan);
    }
  });

  it('(5) near the session end, slides so end=total with the span preserved', () => {
    const eventSpan = 4 * 60 * 1000;
    const start = SESSION_START + DURATION - 5_000; // event starts 5 s before end
    const decision = evaluateDeepLink(
      makeInput({ deepLinkTargetMs: start, deepLinkEndMs: start + eventSpan }),
    );
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      const expectedSpan = eventSpan / 0.9;
      expect(decision.end).toBe(DURATION);
      expect(Math.abs(decision.end - decision.start - expectedSpan) / expectedSpan).toBeLessThan(
        0.005,
      );
    }
  });

  it('(6) an event overlapping past the session end is in-range and framed', () => {
    const eventSpan = 4 * 60 * 1000;
    const start = SESSION_START + DURATION - 60_000; // starts 1 min before end
    const decision = evaluateDeepLink(
      makeInput({ deepLinkTargetMs: start, deepLinkEndMs: start + eventSpan }),
    );
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      expect(decision.end).toBe(DURATION);
      expect(decision.start).toBeGreaterThanOrEqual(0);
    }
  });

  it('(7) an event entirely before the session is out-of-range', () => {
    const start = SESSION_START - 10 * 60 * 1000;
    const decision = evaluateDeepLink(
      makeInput({ deepLinkTargetMs: start, deepLinkEndMs: start + 60_000 }),
    );
    expect(decision.kind).toBe('out-of-range');
  });

  it('(10) when the framed span exceeds the session, collapses to [0, total]', () => {
    const start = SESSION_START + 60_000;
    const eventSpan = DURATION; // event as long as the whole session
    const decision = evaluateDeepLink(
      makeInput({ deepLinkTargetMs: start, deepLinkEndMs: start + eventSpan }),
    );
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      expect(decision.start).toBe(0);
      expect(decision.end).toBe(DURATION);
    }
  });
});

describe('evaluateDeepLink — announcements', () => {
  it('(11a) framed events announce the from/to labels and the seconds shown', () => {
    const start = SESSION_START + 10 * 60 * 1000; // 10 min → "10m"
    const eventSpan = 6 * 60 * 1000; // 6 min → offsetEnd 16 min → "16m"
    const decision = evaluateDeepLink(
      makeInput({ deepLinkTargetMs: start, deepLinkEndMs: start + eventSpan }),
    );
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      // offsetStart = 10min → "10m"; offsetEnd = 16min → "16m";
      // desiredSpan = 360_000 / 0.9 = 400_000 → 400 seconds.
      expect(decision.announcement).toBe('Framed event from 10m to 16m, 400 seconds shown.');
    }
  });

  it('(11b) the point fallback announces a centered 120 s window', () => {
    const target = SESSION_START + 5 * 60 * 1000; // 5 min → "5m"
    const decision = evaluateDeepLink(makeInput({ deepLinkTargetMs: target, deepLinkEndMs: null }));
    expect(decision.kind).toBe('apply');
    if (decision.kind === 'apply') {
      expect(decision.announcement).toBe('Centered on event at 5m, 120 seconds shown.');
    }
  });
});
