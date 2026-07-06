/**
 * SessionDetail (redesigned) — hero verdict, honest gaps, and event-cluster
 * wall-clock tests.
 *
 * The Session Details page was rebuilt around a two-gate night verdict, a KPI
 * grid, an embedded compact signal viewer, a respiratory-events panel, and an
 * expandable event-clusters panel (replacing the old flat "Events" list). This
 * spec covers the redesigned structure:
 *
 *  - the hero "Night assessment" verdict word + the two pass/fail gate rows;
 *  - HONEST GAPS: a `null` AHI renders "—" (never `0`) in both the gate row and
 *    the AHI KPI, and its Effective gate fails;
 *  - MISSING WEARABLE hides the Fitbit sleep + physiology cards entirely;
 *  - the event-clusters panel formats per-event Time using the SAME shared
 *    wall-clock helpers the Signal Viewer uses (ADR 0024), preserving the
 *    cross-surface "agree to the second" contract that the old EventsList test
 *    guarded; and
 *  - the cluster "View in signal viewer" affordance refocuses the embedded
 *    viewer on the cluster's start offset.
 *
 * All data hooks are mocked to avoid IndexedDB/OPFS; the heavy CompactSignalViewer
 * is replaced with a light stub that echoes its `focusTime` prop so the focus
 * wiring is assertable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { TooltipProvider } from '@/components/ui/Tooltip/Tooltip';
import type { Event, EventType, NightlyAggregate, Session } from '@/types';
import { makeAggregate } from '@/services/llm/context/__tests__/fixtures';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { formatClockTime } from '../hoverReadout';
import { sessionWallClockEpoch } from '../signalLanes';

// ── Mocks ────────────────────────────────────────────────────────

const SESSION_ID = 'sess-1';

vi.mock('@/hooks/useSignalData', () => ({
  useSessionDetail: vi.fn(),
  useEventData: vi.fn(),
}));

// Trailing-baseline aggregates, neighbour sessions, wearable + weather hooks are
// all mocked to their empty/idle shapes so the page renders without IndexedDB.
const mockNightlyAggregates = vi.fn();
vi.mock('@/hooks/useNightlyAggregates', () => ({
  useNightlyAggregates: () => mockNightlyAggregates(),
}));
vi.mock('@/hooks/useSessionData', () => ({
  useSessionData: () => ({ sessions: [], loading: false, error: null, refetch: vi.fn() }),
}));

const mockWearableSummary = vi.fn();
vi.mock('@/hooks/useWearableSummary', () => ({
  useWearableSummary: () => mockWearableSummary(),
}));

const mockWearableDayData = vi.fn();
vi.mock('@/hooks/useWearableData', () => ({
  useWearableDayData: (dataType: string, date: string | null) =>
    mockWearableDayData(dataType, date),
}));

vi.mock('@/hooks/useWeatherNightly', () => ({
  useWeatherNightly: () => ({ data: [], latest: null, loading: false, error: null }),
}));

// Replace the heavy embedded viewer with a stub that echoes focusTime.
vi.mock('../CompactSignalViewer', () => ({
  default: ({ focusTime }: { sessionId: string; focusTime?: number }) => (
    <div data-testid="compact-signal-viewer" data-focus-time={focusTime ?? ''} />
  ),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useMatch: () => null,
    useParams: () => ({ sessionId: SESSION_ID }),
  };
});

// Import AFTER the mocks are registered.
import SessionDetail from '../SessionDetail';
import { useSessionDetail, useEventData } from '@/hooks/useSignalData';

const mockUseSessionDetail = vi.mocked(useSessionDetail);
const mockUseEventData = vi.mocked(useEventData);

// ── Fixtures ─────────────────────────────────────────────────────

const SESSION_START_ISO = new Date(Date.UTC(2025, 2, 15, 2, 0, 0)).toISOString();
const SESSION_START_MS = new Date(SESSION_START_ISO).getTime();
const SESSION_END_ISO = new Date(Date.UTC(2025, 2, 15, 10, 0, 0)).toISOString();
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

interface RenderOptions {
  readonly aggregate?: NightlyAggregate | null;
  readonly events?: Event[];
  readonly sessionOverrides?: Partial<Session>;
}

function renderDetail(opts: RenderOptions = {}) {
  const {
    aggregate = makeAggregate({ ahi: 3.0, usageHours: 7 }),
    events = [],
    sessionOverrides,
  } = opts;

  mockUseSessionDetail.mockReturnValue({
    session: makeSession(sessionOverrides),
    aggregate,
    loading: false,
    error: null,
  });
  mockUseEventData.mockReturnValue({ events, loading: false, error: null });

  return render(
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}`]}>
      <TooltipProvider delayDuration={0}>
        <SessionDetail />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

// Default: no wearable data present.
function noWearable() {
  mockWearableSummary.mockReturnValue({ summary: { hasData: false }, loading: false, error: null });
  mockWearableDayData.mockReturnValue({ data: null, loading: false, error: null });
}

// Default: empty trailing baseline (no prior nights → KPI deltas are suppressed).
function emptyBaseline() {
  mockNightlyAggregates.mockReturnValue({
    aggregates: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
}

// ── Tests ────────────────────────────────────────────────────────

describe('SessionDetail — hero verdict', () => {
  beforeEach(() => {
    eventCounter = 0;
    vi.clearAllMocks();
    noWearable();
    emptyBaseline();
  });

  it('renders the two-gate verdict word and both pass/fail gate rows with real values', () => {
    renderDetail({ aggregate: makeAggregate({ ahi: 3.0, usageHours: 7 }) });

    const card = screen.getByRole('region', { name: 'Night assessment' });
    // Both gates pass → "Good night".
    expect(within(card).getByText('Good night')).toBeInTheDocument();
    // Effective gate shows the real AHI value.
    expect(within(card).getByText('AHI 3.0 (target <5)')).toBeInTheDocument();
    // Adherent gate shows the real usage hours.
    expect(within(card).getByText('7.0 h used (≥4 h)')).toBeInTheDocument();
    // Mandatory non-diagnostic caption.
    expect(within(card).getByText('A summary, not a diagnosis.')).toBeInTheDocument();
  });

  it('hosts both opt-in AI insight triggers in the verdict card', () => {
    // AI Insights are opt-in; enable them so the triggers render.
    useSettingsStore.getState().updateIntegration('llm', { enabled: true });
    renderDetail();
    const card = screen.getByRole('region', { name: 'Night assessment' });
    expect(
      within(card).getByRole('button', { name: /Summarize this night with AI/i }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: /compliance and severity context/i }),
    ).toBeInTheDocument();
  });
});

describe('SessionDetail — honest gaps (null is never 0)', () => {
  beforeEach(() => {
    eventCounter = 0;
    vi.clearAllMocks();
    noWearable();
    emptyBaseline();
  });

  it('renders a null AHI as "—" in the gate row and fails the Effective gate', () => {
    renderDetail({ aggregate: makeAggregate({ ahi: null, usageHours: 7 }) });

    const card = screen.getByRole('region', { name: 'Night assessment' });
    // AHI undefined → em dash, never 0.
    expect(within(card).getByText('AHI — (target <5)')).toBeInTheDocument();
    // Adherent (usage 7h) passes, but not effective → "Fair night".
    expect(within(card).getByText('Fair night')).toBeInTheDocument();
  });

  it('renders "—" (not 0) for a null AHI KPI value', () => {
    renderDetail({ aggregate: makeAggregate({ ahi: null, usageHours: 7 }) });
    const heroSection = screen.getByRole('region', { name: 'Night overview' });
    // The AHI KPI card shows an em dash rather than 0.
    const dashes = within(heroSection).getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('hides the Fitbit sleep + physiology cards when no wearable data exists', () => {
    renderDetail({ aggregate: makeAggregate({ ahi: 3, usageHours: 7 }) });
    expect(screen.queryByText('Sleep stages')).not.toBeInTheDocument();
    expect(screen.queryByText('Physiology tonight')).not.toBeInTheDocument();
  });
});

describe('SessionDetail — event clusters', () => {
  beforeEach(() => {
    eventCounter = 0;
    vi.clearAllMocks();
    noWearable();
    emptyBaseline();
  });

  it('formats expanded cluster event times via the shared wall-clock helper (ADR 0024)', () => {
    // Three events 30s apart → one balanced cluster.
    const events = [
      makeEvent({ timestamp: SESSION_START_MS + 60_000 }),
      makeEvent({ timestamp: SESSION_START_MS + 90_000 }),
      makeEvent({ timestamp: SESSION_START_MS + 120_000 }),
    ];
    renderDetail({ aggregate: makeAggregate({ ahi: 5, usageHours: 7 }), events });

    // Expand the (single) cluster — the only button carrying aria-expanded.
    const toggle = screen.getByRole('button', { expanded: false });
    fireEvent.click(toggle);

    const expected = formatClockTime(WALL_CLOCK_EPOCH, events[1]!.timestamp - SESSION_START_MS);
    // The middle event's Time cell must match the Signal Viewer convention.
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
    // And it is an HH:MM:SS clock, not a locale am/pm rendering.
    expect(expected).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('refocuses the embedded signal viewer on the cluster start when "View in signal viewer" is clicked', () => {
    const events = [
      makeEvent({ timestamp: SESSION_START_MS + 60_000 }),
      makeEvent({ timestamp: SESSION_START_MS + 90_000 }),
      makeEvent({ timestamp: SESSION_START_MS + 120_000 }),
    ];
    renderDetail({ aggregate: makeAggregate({ ahi: 5, usageHours: 7 }), events });

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'View in signal viewer' }));

    const viewer = screen.getByTestId('compact-signal-viewer');
    // Cluster starts 60s after session start → focus offset 60000ms.
    expect(viewer).toHaveAttribute('data-focus-time', '60000');
  });

  it('shows a positive empty state when there are no clustered events', () => {
    renderDetail({ aggregate: makeAggregate({ ahi: 1, usageHours: 7 }), events: [] });
    expect(screen.getByText(/No clustered runs of events/i)).toBeInTheDocument();
  });
});

describe('SessionDetail — discrete gates + accessible deltas (QA / ADR 0031)', () => {
  beforeEach(() => {
    eventCounter = 0;
    vi.clearAllMocks();
    noWearable();
    emptyBaseline();
  });

  it('renders the hero as a DISCRETE two-gate visual carrying both outcomes as text (not a composite ring)', () => {
    renderDetail({ aggregate: makeAggregate({ ahi: 3.0, usageHours: 7 }) });
    // The hero is an image whose accessible name states each gate's outcome —
    // pass/fail is conveyed as text, never colour alone (WCAG 1.4.1).
    const hero = screen.getByRole('img', { name: /2 of 2 gates passed/i });
    expect(hero).toHaveAccessibleName(/Effective gate passed/i);
    expect(hero).toHaveAccessibleName(/Adherent gate passed/i);
    // The discrete "n of 2 gates" text replaces the old percentage ring.
    expect(screen.getByText('2 of 2 gates')).toBeInTheDocument();
  });

  it('announces the Effective gate as "cannot confirm" (text, not colour) for a null AHI', () => {
    renderDetail({ aggregate: makeAggregate({ ahi: null, usageHours: 7 }) });
    const hero = screen.getByRole('img', { name: /1 of 2 gates passed/i });
    expect(hero).toHaveAccessibleName(/Effective gate cannot confirm/i);
    expect(hero).toHaveAccessibleName(/Adherent gate passed/i);
    // The gate row also exposes the outcome as visually-hidden text.
    const card = screen.getByRole('region', { name: 'Night assessment' });
    expect(within(card).getByText(/cannot confirm/i)).toBeInTheDocument();
  });

  it('carries BOTH delta direction and favourability into the accessible name', () => {
    // Four prior nights (all AHI 10) → a real trailing baseline. Tonight AHI 3.0
    // → the AHI KPI fell, which is FAVOURABLE (lower AHI is better).
    const priors = ['2025-03-10', '2025-03-11', '2025-03-12', '2025-03-13'].map((date) =>
      makeAggregate({ date, ahi: 10, usageHours: 7.3 }),
    );
    mockNightlyAggregates.mockReturnValue({
      aggregates: priors,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDetail({ aggregate: makeAggregate({ ahi: 3.0, usageHours: 7 }) });
    // The AHI delta's accessible name spells out direction + judgement as text.
    expect(screen.getByText(/decreased, favorable/i)).toBeInTheDocument();
  });
});

describe('SessionDetail — central fraction (gated, non-diagnostic)', () => {
  beforeEach(() => {
    eventCounter = 0;
    vi.clearAllMocks();
    noWearable();
    emptyBaseline();
  });

  it('renders "—" with a reporting-floor note when the central fraction is not reportable', () => {
    // No apneas at all → centralFraction() returns null (below the reportable floor).
    renderDetail({
      aggregate: makeAggregate({
        ahi: 2,
        usageHours: 7,
        ahiCentral: 0,
        eventsByType: {
          obstructive: 0,
          central: 0,
          mixed: 0,
          unclassified: 0,
          hypopnea: 4,
          rera: 1,
          flowLimitation: 0,
          largeLeak: 0,
          periodicBreathing: 0,
        },
      }),
    });
    expect(screen.getByText('Needs ≥20 apneas to report')).toBeInTheDocument();
  });

  it('cross-links Breathing patterns when central activity is elevated (CAI ≥ 5/h)', () => {
    renderDetail({ aggregate: makeAggregate({ ahi: 12, usageHours: 7, ahiCentral: 6 }) });
    const link = screen.getByRole('link', { name: /Breathing patterns/i });
    expect(link).toHaveAttribute('href', '/explore/breathing');
  });
});

describe('SessionDetail — loading / error / not-found (preserved)', () => {
  beforeEach(() => {
    eventCounter = 0;
    vi.clearAllMocks();
    noWearable();
    emptyBaseline();
  });

  it('renders the loading skeleton while data is loading', () => {
    mockUseSessionDetail.mockReturnValue({
      session: null,
      aggregate: null,
      loading: true,
      error: null,
    });
    mockUseEventData.mockReturnValue({ events: [], loading: true, error: null });
    const { container } = render(
      <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}`]}>
        <TooltipProvider delayDuration={0}>
          <SessionDetail />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('renders the error state on load failure', () => {
    mockUseSessionDetail.mockReturnValue({
      session: null,
      aggregate: null,
      loading: false,
      error: 'boom',
    });
    mockUseEventData.mockReturnValue({ events: [], loading: false, error: null });
    render(
      <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}`]}>
        <TooltipProvider delayDuration={0}>
          <SessionDetail />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });
});
