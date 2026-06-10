import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

/**
 * Lightweight verification of the audit fix that keys SignalViewer by the
 * active `:sessionId` (the `key={sessionId}` in KeyedSignalViewer).
 *
 * The concern: SignalViewer seeds per-session state (the hidden-channel set)
 * from localStorage in a lazy `useState` initializer that runs ONCE per mount.
 * If the component were reused across `:sessionId` route changes, that state
 * would leak from one session into the next. Keying on `sessionId` forces a
 * fresh mount per session, re-running the initializer.
 *
 * Rather than mount the real (canvas/OPFS-heavy) SignalViewer, we stub it with
 * a probe that records mount events and reads its per-session seed in a lazy
 * initializer — mirroring the real seeding contract — and assert the probe
 * remounts (and re-seeds) when only the sessionId changes.
 */

const mountLog: string[] = [];
const seedLog: Array<{ sessionId: string | undefined; seed: string | null }> = [];

// Stub SignalViewer: a probe that reads its hidden-channel seed once per mount.
vi.mock('../SignalViewer', async () => {
  const { useParams } =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  const { useState, useEffect: useEffectActual } =
    await vi.importActual<typeof import('react')>('react');
  return {
    default: function SignalViewerProbe() {
      const { sessionId } = useParams<{ sessionId: string }>();
      // Lazy initializer — runs once per mount, mirroring the real component's
      // localStorage-seeded hidden-channel state.
      const [seed] = useState<string | null>(() => {
        const value = sessionId ? localStorage.getItem(`signal-viewer-hidden-${sessionId}`) : null;
        seedLog.push({ sessionId, seed: value });
        return value;
      });
      useEffectActual(() => {
        mountLog.push(sessionId ?? 'undefined');
      }, []);
      return (
        <div data-testid="probe" data-session={sessionId} data-seed={seed ?? ''}>
          probe
        </div>
      );
    },
  };
});

import KeyedSignalViewer from '../KeyedSignalViewer';

/** Navigates to a target route once on mount. */
function NavigateOnce({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to);
  }, [navigate, to]);
  return null;
}

describe('KeyedSignalViewer', () => {
  beforeEach(() => {
    mountLog.length = 0;
    seedLog.length = 0;
    localStorage.clear();
  });

  it('mounts SignalViewer for the active sessionId', () => {
    render(
      <MemoryRouter initialEntries={['/sessions/sess-a']}>
        <Routes>
          <Route path="/sessions/:sessionId" element={<KeyedSignalViewer />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('probe').getAttribute('data-session')).toBe('sess-a');
    expect(mountLog).toEqual(['sess-a']);
  });

  it('remounts (fresh mount) when navigating to a different sessionId so per-session state cannot leak', () => {
    // Seed distinct hidden-channel sets for the two sessions in localStorage.
    localStorage.setItem('signal-viewer-hidden-sess-a', JSON.stringify(['Flow']));
    localStorage.setItem('signal-viewer-hidden-sess-b', JSON.stringify(['Pressure']));

    render(
      <MemoryRouter initialEntries={['/sessions/sess-a']}>
        <Routes>
          <Route path="/sessions/:sessionId" element={<KeyedSignalViewer />} />
        </Routes>
        <NavigateOnce to="/sessions/sess-b" />
      </MemoryRouter>,
    );

    // The probe must have mounted twice — once per session — proving a fresh
    // mount (not a reuse) on the sessionId change.
    expect(mountLog).toEqual(['sess-a', 'sess-b']);

    // Each mount re-ran the lazy seed initializer against its OWN session's
    // localStorage key — the seeds differ, confirming state did not leak.
    expect(seedLog).toEqual([
      { sessionId: 'sess-a', seed: JSON.stringify(['Flow']) },
      { sessionId: 'sess-b', seed: JSON.stringify(['Pressure']) },
    ]);

    // Final render reflects sess-b's seed, not sess-a's.
    expect(screen.getByTestId('probe').getAttribute('data-seed')).toBe(
      JSON.stringify(['Pressure']),
    );
  });
});
