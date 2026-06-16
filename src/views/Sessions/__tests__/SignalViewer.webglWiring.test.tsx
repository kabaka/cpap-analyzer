import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import type { SignalManifest } from '@/services/storage/OPFSService';

/**
 * Regression guard for the WebGL2-activation bug in the Signal Viewer.
 *
 * The bug (fixed on this branch): `tryInitRenderer` constructed the
 * {@link HybridSignalRenderer} as soon as the BASE chrome canvas mounted,
 * tolerating a null waveform canvas (`if (!base) return;`). Because the base
 * `<canvas>` precedes the transparent WebGL waveform `<canvas>` in the DOM, the
 * base ref-callback fires first, so the renderer was ALWAYS constructed as
 * `new HybridSignalRenderer(base, null, ...)` (waveform null) — pinning it to the
 * Canvas2D fallback for the lifetime of the view (the `rendererRef.current`
 * guard blocks reconstruction once the waveform canvas mounts later). Net
 * effect: WebGL2 never activated in the real Signal Viewer for anyone.
 *
 * The fidelity gate constructs the renderers directly via a harness, bypassing
 * SignalViewer, which is exactly why nothing caught this. This test mounts the
 * REAL `SignalViewer` and asserts the hybrid renderer is constructed with a
 * non-null waveform `HTMLCanvasElement` as its second argument — i.e. that the
 * WebGL layer is actually wired up.
 *
 * It is RED against the pre-fix `if (!base) return;` (waveform would be null/
 * undefined) and GREEN against the fixed `if (!base || !waveform) return;`.
 */

// ── Capture every HybridSignalRenderer constructor invocation ──────
//
// Replace the real (WebGL/Canvas2D-heavy) class with a spy that records its
// constructor arguments and exposes the methods SignalViewer calls as no-op
// `vi.fn()`s, so the component renders to completion in jsdom.
const constructorCalls: unknown[][] = [];

vi.mock('@/components/charts/HybridSignalRenderer', () => {
  class HybridSignalRendererSpy {
    constructor(...args: unknown[]) {
      constructorCalls.push(args);
    }
    setOverlayCanvas = vi.fn();
    resize = vi.fn();
    render = vi.fn();
    renderOverlay = vi.fn();
    renderDuringPan = vi.fn();
    beginPan = vi.fn();
    panBy = vi.fn();
    endPan = vi.fn();
    getValuesAtTime = vi.fn(() => []);
    dispose = vi.fn();
  }
  return { HybridSignalRenderer: HybridSignalRendererSpy };
});

// ── Minimal session data so the viewer reaches the canvas JSX ──────
//
// OPFSService must report support (else the viewer renders the "Browser Not
// Supported" branch and never mounts the canvases) and yield a one-channel
// manifest plus channel data.
const TEST_SESSION_ID = 'sess-webgl';
const SESSION_START_MS = Date.parse('2026-01-15T23:00:00Z');

const TEST_MANIFEST: SignalManifest = {
  version: 1,
  sessionId: TEST_SESSION_ID,
  startTime: SESSION_START_MS,
  endTime: SESSION_START_MS + 60_000,
  durationSeconds: 60,
  chunkDurationSeconds: 300,
  channels: [
    {
      index: 0,
      name: 'flow',
      sampleRate: 25,
      unit: 'L/s',
      dtype: 'float32',
      physicalMin: -1,
      physicalMax: 1,
    },
  ],
  chunks: [],
};

vi.mock('@/services/storage/OPFSService', () => {
  class OPFSServiceMock {
    static isSupported = vi.fn(() => true);
    initialize = vi.fn().mockResolvedValue(undefined);
    readManifest = vi.fn().mockResolvedValue(TEST_MANIFEST);
    readChannel = vi.fn().mockResolvedValue(
      // A few non-zero samples so the channel is not detected as "empty".
      Float32Array.from([0.1, 0.4, -0.3, 0.2, -0.1]),
    );
  }
  return { OPFSService: OPFSServiceMock };
});

// Session detail + events come from useSignalData; return a ready session with
// no events so the viewer is fully hydrated without touching IndexedDB.
vi.mock('@/hooks/useSignalData', () => ({
  useSessionDetail: () => ({
    session: {
      id: TEST_SESSION_ID,
      startTime: new Date(SESSION_START_MS).toISOString(),
      date: '2026-01-15',
    },
    aggregate: null,
    loading: false,
    error: null,
  }),
  useEventData: () => ({ events: [], loading: false, error: null }),
}));

// No wearable lanes and no breathing detection — keeps the render minimal and
// independent of those subsystems.
// Partial mock: keep the module's real exports (signalLanes.ts imports
// SLEEP_STAGE_CODES from here) and override only the hook.
vi.mock('@/hooks/useWearableLanes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useWearableLanes')>();
  return {
    ...actual,
    useWearableLanes: () => ({ series: {}, loading: false, error: null }),
  };
});

vi.mock('@/hooks/useBreathingEpisodes', () => ({
  useBreathingEpisodes: () => ({ episodes: [], loading: false, error: null }),
}));

// Import AFTER the mocks are registered.
import SignalViewer from '../SignalViewer';

function renderViewer() {
  return render(
    <MemoryRouter initialEntries={[`/sessions/${TEST_SESSION_ID}`]}>
      <Routes>
        <Route path="/sessions/:sessionId" element={<SignalViewer />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SignalViewer WebGL wiring', () => {
  beforeEach(() => {
    constructorCalls.length = 0;
    localStorage.clear();
  });

  it('constructs HybridSignalRenderer with a non-null waveform canvas (WebGL layer wired)', async () => {
    renderViewer();

    // The renderer is constructed by a canvas ref-callback once both the base
    // and waveform canvases have mounted (after the async OPFS manifest load).
    await waitFor(() => {
      expect(constructorCalls.length).toBeGreaterThan(0);
    });

    const [baseArg, waveformArg] = constructorCalls[0] as [unknown, unknown, unknown];

    // Pre-fix, the renderer was built the moment the BASE canvas mounted, with a
    // still-null waveform canvas. The whole point of the fix is that BOTH canvases
    // exist at construction time — so the second argument must be a real canvas.
    expect(waveformArg).not.toBeNull();
    expect(waveformArg).not.toBeUndefined();
    expect(waveformArg).toBeInstanceOf(HTMLCanvasElement);

    // The base canvas (first argument) must also be a real canvas, and the two
    // must be distinct elements (base chrome layer vs. transparent WebGL layer).
    expect(baseArg).toBeInstanceOf(HTMLCanvasElement);
    expect(waveformArg).not.toBe(baseArg);
  });
});
