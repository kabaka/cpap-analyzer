import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

import type { SignalManifest } from '@/services/storage/OPFSService';

/**
 * Focused tests for the compact embedded signal viewer.
 *
 * jsdom provides no real Canvas 2D context, so the (real) `SignalRenderer` is
 * replaced with a spy that records the channel names it is asked to render —
 * enough to assert lane construction and chip toggling — while keeping the
 * module's pure helper exports (e.g. `formatWallClockLabel`) intact. OPFS and
 * the session/event hooks are mocked so the component reaches its ready state
 * deterministically without IndexedDB/OPFS.
 */

const SESSION_ID = 'sess-compact';
const SESSION_START_MS = Date.parse('2026-01-15T23:00:00Z');

// Mutable harness state, assigned per test before render.
const h = vi.hoisted(() => ({
  supported: true,
  manifest: null as SignalManifest | null,
}));

// Records the channel-name arrays passed to render(), per frame.
const rlog = vi.hoisted(() => ({ frames: [] as string[][] }));

const FULL_MANIFEST: SignalManifest = {
  version: 1,
  sessionId: SESSION_ID,
  startTime: SESSION_START_MS,
  endTime: SESSION_START_MS + 3_600_000,
  durationSeconds: 3600,
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
    {
      index: 1,
      name: 'maskPressure',
      sampleRate: 25,
      unit: 'cmH2O',
      dtype: 'float32',
      physicalMin: 0,
      physicalMax: 25,
    },
    {
      index: 2,
      name: 'leak',
      sampleRate: 25,
      unit: 'L/min',
      dtype: 'float32',
      physicalMin: 0,
      physicalMax: 60,
    },
    {
      index: 3,
      name: 'spo2',
      sampleRate: 1,
      unit: '%',
      dtype: 'float32',
      physicalMin: 85,
      physicalMax: 100,
    },
  ],
  chunks: [],
};

vi.mock('@/services/storage/OPFSService', () => {
  class OPFSServiceMock {
    static isSupported = vi.fn(() => h.supported);
    initialize = vi.fn().mockResolvedValue(undefined);
    readManifest = vi.fn(async () => {
      if (!h.manifest) throw new Error('no manifest');
      return h.manifest;
    });
    readChannel = vi.fn(async (_sid: string, name: string) => {
      // A handful of non-zero, physiologically-plausible samples per channel.
      if (name === 'spo2') return Float32Array.from([96, 95, 97, 96, 94]);
      if (name === 'leak') return Float32Array.from([2, 5, 12, 4, 3]);
      if (name === 'maskPressure') return Float32Array.from([8, 9, 8.5, 9.2, 8.1]);
      return Float32Array.from([0.1, 0.4, -0.3, 0.2, -0.1]);
    });
  }
  return { OPFSService: OPFSServiceMock };
});

vi.mock('@/components/charts/canvas/SignalRenderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts/canvas/SignalRenderer')>();
  class SignalRendererSpy {
    setOverlayCanvas = vi.fn();
    resize = vi.fn();
    render = vi.fn((vp: { channels: { name: string }[] }) => {
      rlog.frames.push(vp.channels.map((c) => c.name));
    });
    renderSync = vi.fn();
    renderOverlay = vi.fn();
    getValuesAtTime = vi.fn(() => []);
    getTimeAtX = vi.fn(() => 0);
    dispose = vi.fn();
  }
  return { ...actual, SignalRenderer: SignalRendererSpy };
});

vi.mock('@/hooks/useSignalData', () => ({
  useSessionDetail: () => ({
    session: {
      id: SESSION_ID,
      startTime: new Date(SESSION_START_MS).toISOString(),
      date: '2026-01-15',
    },
    aggregate: null,
    loading: false,
    error: null,
  }),
  useEventData: () => ({
    events: [
      {
        id: 'e1',
        sessionId: SESSION_ID,
        type: 'ObstructiveApnea',
        timestamp: SESSION_START_MS + 60_000,
        duration: 15,
        severity: null,
        pressure: null,
        epap: null,
        ipap: null,
        leak: null,
        spo2: null,
        clusterId: null,
      },
    ],
    loading: false,
    error: null,
  }),
}));

import CompactSignalViewer from '../CompactSignalViewer';

let lastLocation = '';
function LocationProbe() {
  lastLocation = useLocation().pathname;
  return null;
}

function renderViewer() {
  return render(
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}`]}>
      <Routes>
        <Route
          path="/sessions/:sessionId"
          element={<CompactSignalViewer sessionId={SESSION_ID} />}
        />
        <Route path="/sessions/:sessionId/signals" element={<div>Full explorer page</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** Minimal Canvas 2D context stub — jsdom throws on getContext without it. */
function makeFakeContext(): CanvasRenderingContext2D {
  const noop = vi.fn();
  return {
    setTransform: noop,
    clearRect: noop,
    fillRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    strokeRect: noop,
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

describe('CompactSignalViewer', () => {
  beforeEach(() => {
    h.supported = true;
    h.manifest = FULL_MANIFEST;
    rlog.frames.length = 0;
    lastLocation = '';
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(makeFakeContext());
  });

  it('renders a loading state then the ready card with channel chips', async () => {
    renderViewer();

    // Loading skeleton is shown first.
    expect(screen.getByTestId('compact-signal-loading')).toBeInTheDocument();

    // Then the four lane chips appear once OPFS resolves.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Flow/ })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Pressure/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Leak/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SpO₂/ })).toBeInTheDocument();

    // The renderer was asked to draw all four lanes.
    await waitFor(() => {
      expect(rlog.frames.some((f) => f.includes('Flow') && f.length === 4)).toBe(true);
    });
  });

  it('toggling a channel chip removes that lane from the rendered stack', async () => {
    renderViewer();
    const flowChip = await screen.findByRole('button', { name: /Flow/ });

    // Wait for at least one full-stack frame, then clear the log.
    await waitFor(() => expect(rlog.frames.length).toBeGreaterThan(0));
    rlog.frames.length = 0;

    fireEvent.click(flowChip);

    // A subsequent frame must omit the Flow lane.
    await waitFor(() => {
      expect(rlog.frames.length).toBeGreaterThan(0);
      expect(rlog.frames.every((f) => !f.includes('Flow'))).toBe(true);
    });
    // The chip reflects the off state for assistive tech.
    expect(flowChip).toHaveAttribute('aria-pressed', 'false');
  });

  it('navigates to the full explorer when the button is clicked', async () => {
    renderViewer();
    const button = await screen.findByRole('button', { name: /Full explorer/ });
    fireEvent.click(button);
    await waitFor(() => {
      expect(lastLocation).toBe(`/sessions/${SESSION_ID}/signals`);
    });
  });

  it('shows a graceful message when OPFS is unsupported', async () => {
    h.supported = false;
    renderViewer();
    await waitFor(() => {
      expect(
        screen.getByText(/does not support the Origin Private File System/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Flow/ })).not.toBeInTheDocument();
  });

  it('shows an empty-state message when no matching signal channels exist', async () => {
    h.manifest = { ...FULL_MANIFEST, channels: [] };
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText(/No signal waveforms are stored/i)).toBeInTheDocument();
    });
  });
});
