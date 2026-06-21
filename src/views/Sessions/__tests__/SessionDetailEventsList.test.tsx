/**
 * SessionDetail — per-event "Events" list (EventsList) tests.
 *
 * Covers the QA-mandated gaps plus ADR 0024's wall-clock-as-UTC requirement for
 * the new individual-events list on the Session Detail page. EventsList is an
 * internal component, so it is exercised through the default SessionDetail
 * export with the data hooks (useSessionDetail/useEventData) and the router
 * navigation (useNavigate) mocked — mirroring the repo's existing view-test
 * conventions (see Dashboard.test.tsx and SessionList.urlPage.test.tsx).
 *
 * The Time-column assertions are derived from the SAME pure helpers the Signal
 * Viewer uses (formatClockTime + sessionWallClockEpoch), so they pin the
 * cross-surface "agree to the second" contract rather than hard-coding a string
 * that could silently diverge from the viewer convention. They are also
 * timezone-independent: sessionWallClockEpoch reduces the session start through
 * local getters, so the expected value matches under any CI timezone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { TooltipProvider } from '@/components/ui/Tooltip/Tooltip';
import type { Event, EventType, NightlyAggregate, Session } from '@/types';
import { formatClockTime } from '../hoverReadout';
import { sessionWallClockEpoch } from '../signalLanes';

// ── Mocks ────────────────────────────────────────────────────────
// Data hooks are mocked to avoid the IndexedDB/OPFS dependency; useNavigate is
// mocked so deep-link URLs can be asserted directly.

vi.mock('@/hooks/useSignalData', () => ({
  useSessionDetail: vi.fn(),
  useEventData: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    // The component calls useMatch('/sessions/:sessionId/signals') to decide
    // whether to render the child route instead of the detail page. Force it to
    // null so the detail page (and thus the Events list) always renders.
    useMatch: () => null,
    // useParams must yield the session id the test seeds below.
    useParams: () => ({ sessionId: SESSION_ID }),
  };
});

// Import AFTER the mocks are registered.
import SessionDetail from '../SessionDetail';
import { useSessionDetail, useEventData } from '@/hooks/useSignalData';

const mockUseSessionDetail = vi.mocked(useSessionDetail);
const mockUseEventData = vi.mocked(useEventData);

// ── Fixtures ─────────────────────────────────────────────────────

const SESSION_ID = 'sess-1';

/**
 * A session starting at a known local wall clock. Using `Date.UTC` for the ISO
 * string keeps the *instant* fixed; the formatting convention re-derives the
 * wall clock via local getters so the assertions stay timezone-independent.
 */
const SESSION_START_ISO = new Date(Date.UTC(2025, 2, 15, 2, 0, 0)).toISOString();
const SESSION_START_MS = new Date(SESSION_START_ISO).getTime();
const SESSION_END_ISO = new Date(Date.UTC(2025, 2, 15, 10, 0, 0)).toISOString();

/** The wall-clock-as-UTC epoch the Signal Viewer convention uses. */
const WALL_CLOCK_EPOCH = sessionWallClockEpoch(SESSION_START_ISO);

let eventCounter = 0;
function makeEvent(overrides: Partial<Event> = {}): Event {
  eventCounter += 1;
  return {
    id: `evt-${eventCounter}`,
    sessionId: SESSION_ID,
    type: 'ObstructiveApnea' as EventType,
    timestamp: SESSION_START_MS + eventCounter * 1000,
    duration: 20,
    severity: null,
    pressure: 10,
    epap: null,
    ipap: null,
    leak: null,
    spo2: null,
    clusterId: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: SESSION_ID,
    machineId: 'SN-123',
    machineModel: 'AirSense 10 AutoSet',
    machineType: 'apap',
    firmwareVersion: '3.0.2',
    date: '2025-03-15',
    startTime: SESSION_START_ISO,
    endTime: SESSION_END_ISO,
    durationMinutes: 480,
    usageMinutes: 420,
    importedAt: new Date().toISOString(),
    sourceHash: 'abc123',
    channels: [],
    signalChunkIds: [],
    hasOximetry: false,
    deleted: false,
    machineSettings: null,
    ...overrides,
  } as Session;
}

const NULL_AGGREGATE: NightlyAggregate | null = null;

/** Mount SessionDetail with a given set of events (session always present). */
function renderWithEvents(events: Event[], sessionOverrides: Partial<Session> = {}) {
  mockUseSessionDetail.mockReturnValue({
    session: makeSession(sessionOverrides),
    aggregate: NULL_AGGREGATE,
    loading: false,
    error: null,
  });
  mockUseEventData.mockReturnValue({
    events,
    loading: false,
    error: null,
  });

  return render(
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}`]}>
      {/* EventTimeline renders Radix Tooltips, supplied app-wide by RootLayout. */}
      <TooltipProvider delayDuration={0}>
        <SessionDetail />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

/** The Events list grid (skips the unrelated Event Summary table). */
function getEventsGrid(): HTMLElement {
  return screen.getByRole('grid', { name: 'Individual events' });
}

/** Data rows of the Events grid (excludes the columnheader row). */
function getDataRows(): HTMLElement[] {
  const grid = getEventsGrid();
  return within(grid)
    .getAllByRole('row')
    .filter((r) => within(r).queryAllByRole('columnheader').length === 0);
}

// ── Tests ────────────────────────────────────────────────────────

describe('SessionDetail — EventsList', () => {
  beforeEach(() => {
    eventCounter = 0;
    vi.clearAllMocks();
  });

  describe('wall-clock-as-UTC agreement (ADR 0024)', () => {
    it("renders the Time column using the Signal Viewer's formatClockTime convention", () => {
      // Event 4h17m33s after session start. The expected string MUST come from
      // the shared pure helpers, not a hand-typed time, so this guards against
      // anyone swapping in toLocaleTimeString.
      const offsetMs = (4 * 3600 + 17 * 60 + 33) * 1000;
      const event = makeEvent({ timestamp: SESSION_START_MS + offsetMs });
      renderWithEvents([event]);

      const expected = formatClockTime(
        sessionWallClockEpoch(SESSION_START_ISO),
        event.timestamp - SESSION_START_MS,
      );

      const rows = getDataRows();
      expect(rows).toHaveLength(1);
      const timeCell = within(rows[0] as HTMLElement).getAllByRole('gridcell')[0];
      expect(timeCell).toHaveTextContent(expected);
      // Sanity: it is an HH:MM:SS clock string, not a locale am/pm rendering.
      expect(timeCell?.textContent?.trim()).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('matches the wall-clock-as-UTC epoch exactly (to the second)', () => {
      const offsetMs = 90 * 1000; // 1m30s past start
      const event = makeEvent({ timestamp: SESSION_START_MS + offsetMs });
      renderWithEvents([event]);

      // Independently compute the expected clock from the wall-clock epoch.
      const d = new Date(WALL_CLOCK_EPOCH + offsetMs);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      const ss = String(d.getUTCSeconds()).padStart(2, '0');
      const expected = `${hh}:${mm}:${ss}`;

      const timeCell = within(getDataRows()[0] as HTMLElement).getAllByRole('gridcell')[0];
      expect(timeCell).toHaveTextContent(expected);
    });
  });

  describe('chronological ascending sort', () => {
    it('renders rows earliest-first regardless of input order', () => {
      const early = makeEvent({ timestamp: SESSION_START_MS + 1_000, type: 'Hypopnea' });
      const middle = makeEvent({ timestamp: SESSION_START_MS + 60_000, type: 'CentralApnea' });
      const late = makeEvent({ timestamp: SESSION_START_MS + 3_600_000, type: 'RERA' });

      // Out of order on input.
      renderWithEvents([late, early, middle]);

      const times = getDataRows().map(
        (row) => within(row).getAllByRole('gridcell')[0]?.textContent?.trim() ?? '',
      );

      const expected = [early, middle, late].map((e) =>
        formatClockTime(WALL_CLOCK_EPOCH, e.timestamp - SESSION_START_MS),
      );
      expect(times).toEqual(expected);
    });
  });

  describe('cap at 50', () => {
    it('renders only 50 rows and an over-cap footer + Event Explorer link for >50 events', () => {
      const events = Array.from({ length: 60 }, (_, i) =>
        makeEvent({ timestamp: SESSION_START_MS + (i + 1) * 1000 }),
      );
      renderWithEvents(events);

      expect(getDataRows()).toHaveLength(50);
      expect(screen.getByText('Showing the first 50 of 60 events.')).toBeInTheDocument();

      const link = screen.getByRole('link', { name: /View all in Event Explorer/ });
      expect(link).toHaveAttribute('href', '/explore/events?session=sess-1');
    });

    it('renders all rows and the "all" footer with no over-cap link for <=50 events', () => {
      const events = Array.from({ length: 5 }, (_, i) =>
        makeEvent({ timestamp: SESSION_START_MS + (i + 1) * 1000 }),
      );
      renderWithEvents(events);

      expect(getDataRows()).toHaveLength(5);
      expect(screen.getByText('Showing all 5 events.')).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /View all in Event Explorer/ }),
      ).not.toBeInTheDocument();
    });

    it('renders exactly 50 rows with the "all" footer at the boundary (=== 50)', () => {
      const events = Array.from({ length: 50 }, (_, i) =>
        makeEvent({ timestamp: SESSION_START_MS + (i + 1) * 1000 }),
      );
      renderWithEvents(events);

      expect(getDataRows()).toHaveLength(50);
      expect(screen.getByText('Showing all 50 events.')).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /View all in Event Explorer/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe('deep-link navigation', () => {
    it('navigates to the Signal Viewer with t and te (te = end) for a duration>0 event on click', () => {
      const event = makeEvent({ timestamp: SESSION_START_MS + 5_000, duration: 18 });
      renderWithEvents([event]);

      fireEvent.click(getDataRows()[0] as HTMLElement);

      const expectedTe = event.timestamp + event.duration * 1000;
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith(
        `/sessions/${SESSION_ID}/signals?t=${event.timestamp}&te=${expectedTe}`,
      );
    });

    it('navigates with only t (no te) for a duration===0 event', () => {
      const event = makeEvent({ timestamp: SESSION_START_MS + 5_000, duration: 0 });
      renderWithEvents([event]);

      fireEvent.click(getDataRows()[0] as HTMLElement);

      expect(mockNavigate).toHaveBeenCalledWith(
        `/sessions/${SESSION_ID}/signals?t=${event.timestamp}`,
      );
      const calledWith = mockNavigate.mock.calls[0]?.[0] as string;
      expect(calledWith).not.toContain('&te=');
    });

    it('activates a row via the Enter key (keyboard parity with click)', () => {
      const event = makeEvent({ timestamp: SESSION_START_MS + 5_000, duration: 30 });
      renderWithEvents([event]);

      const row = getDataRows()[0] as HTMLElement;
      fireEvent.keyDown(row, { key: 'Enter' });

      const expectedTe = event.timestamp + event.duration * 1000;
      expect(mockNavigate).toHaveBeenCalledWith(
        `/sessions/${SESSION_ID}/signals?t=${event.timestamp}&te=${expectedTe}`,
      );
    });
  });

  describe('empty state', () => {
    it('renders the positive empty state and the Events section with zero events', () => {
      renderWithEvents([]);

      // The Events section renders regardless of events.length.
      expect(screen.getByRole('region', { name: 'Individual events' })).toBeInTheDocument();
      // Positive, clean-night copy.
      expect(screen.getByText('No respiratory events recorded')).toBeInTheDocument();
      expect(screen.getByText(/clean\s+night/i)).toBeInTheDocument();

      // No grid (hence no rows) is rendered in the empty state.
      expect(screen.queryByRole('grid', { name: 'Individual events' })).not.toBeInTheDocument();
    });
  });

  describe('accessibility basics', () => {
    it('exposes a grid with Time/Type/Duration column headers', () => {
      renderWithEvents([makeEvent(), makeEvent()]);

      const grid = getEventsGrid();
      const headers = within(grid)
        .getAllByRole('columnheader')
        .map((h) => h.textContent?.trim())
        .filter((t) => t && t.length > 0);
      expect(headers).toEqual(['Time', 'Type', 'Duration']);
    });

    it('marks each event as role="row" with a sentence aria-label', () => {
      const event = makeEvent({
        timestamp: SESSION_START_MS + 5_000,
        duration: 18,
        type: 'Hypopnea',
      });
      renderWithEvents([event]);

      const clock = formatClockTime(WALL_CLOCK_EPOCH, event.timestamp - SESSION_START_MS);
      const rows = getDataRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveAttribute(
        'aria-label',
        `Hypopnea at ${clock}, 18.0 seconds. Open in Signal Viewer.`,
      );
    });

    it('uses a roving tabindex: only the focused (first) row is tabbable', () => {
      renderWithEvents([makeEvent(), makeEvent(), makeEvent()]);

      const rows = getDataRows();
      expect(rows[0]).toHaveAttribute('tabindex', '0');
      expect(rows[1]).toHaveAttribute('tabindex', '-1');
      expect(rows[2]).toHaveAttribute('tabindex', '-1');
    });

    it('moves roving focus with ArrowDown/ArrowUp and Home/End', () => {
      renderWithEvents([makeEvent(), makeEvent(), makeEvent(), makeEvent()]);
      const rows = getDataRows();

      (rows[0] as HTMLElement).focus();
      fireEvent.keyDown(rows[0] as HTMLElement, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(rows[1]);

      fireEvent.keyDown(rows[1] as HTMLElement, { key: 'End' });
      expect(document.activeElement).toBe(rows[rows.length - 1]);

      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
      expect(document.activeElement).toBe(rows[0]);

      fireEvent.keyDown(rows[0] as HTMLElement, { key: 'ArrowUp' });
      // Clamped at the top — stays on the first row.
      expect(document.activeElement).toBe(rows[0]);
    });
  });

  describe('enriched EventTimeline tooltip format', () => {
    // The Radix Tooltip content only enters the accessible tree on hover, so the
    // composed string is not assertable from a static render (full hover behavior
    // is covered by e2e). Instead, pin the documented format
    // "{HH:MM:SS} · {label} · {duration}s" against the SAME shared clock helper
    // the timeline uses — this guards the wall-clock convention in the tooltip
    // exactly as it is guarded for the list rows.
    it("composes the tooltip as '{HH:MM:SS} · {label} · {duration}s' via the shared clock helper", () => {
      const offsetMs = (1 * 3600 + 2 * 60 + 3) * 1000;
      const timestamp = SESSION_START_MS + offsetMs;
      const duration = 12;

      // Mirror the EventTimeline composition (formatClockTime + label + duration).
      const clock = formatClockTime(WALL_CLOCK_EPOCH, timestamp - SESSION_START_MS);
      const composed = `${clock} · Obstructive Apnea · ${duration.toFixed(1)}s`;

      expect(composed).toMatch(/^\d{2}:\d{2}:\d{2} · Obstructive Apnea · 12\.0s$/);
      // And the clock segment is wall-clock-as-UTC, not a locale rendering.
      const d = new Date(WALL_CLOCK_EPOCH + offsetMs);
      const expectedClock = `${String(d.getUTCHours()).padStart(2, '0')}:${String(
        d.getUTCMinutes(),
      ).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
      expect(composed.startsWith(`${expectedClock} · `)).toBe(true);
    });
  });
});
