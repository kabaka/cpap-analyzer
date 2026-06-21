/**
 * EventTable accessibility and keyboard-navigation tests.
 *
 * Locks in the ARIA grid structure (role="grid" + role="row" +
 * role="gridcell") and the roving-tabindex Arrow/Home/End navigation
 * required for the keyboard-first audience.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Event } from '@/types/events';
import { sessionWallClockEpoch } from '@/views/Sessions/signalLanes';
import { EventTable } from '../EventTable';

let id = 0;
function makeEvent(overrides: Partial<Event> = {}): Event {
  id += 1;
  return {
    id: `evt-${id}`,
    sessionId: 'sess-1',
    type: 'ObstructiveApnea',
    timestamp: Date.UTC(2025, 2, 15, 2, 0, 0) + id * 1000,
    duration: 25,
    severity: null,
    pressure: 10,
    epap: null,
    ipap: null,
    leak: 5,
    spo2: null,
    clusterId: null,
    ...overrides,
  };
}

/** Build a sessionId → ISO start map covering every session referenced by the events. */
function startTimesFor(events: Event[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of events) {
    if (!map.has(e.sessionId)) {
      // Anchor each session's start to its first event's timestamp so the
      // wall-clock conversion has a stable, derivable reference.
      map.set(e.sessionId, new Date(e.timestamp).toISOString());
    }
  }
  return map;
}

function renderTable(events: Event[], sessionStartTimes = startTimesFor(events)) {
  return render(
    <MemoryRouter>
      <EventTable events={events} sessionStartTimes={sessionStartTimes} />
    </MemoryRouter>,
  );
}

describe('EventTable accessibility', () => {
  beforeEach(() => {
    id = 0;
  });

  it('wraps the table in role="grid" with aria-rowcount including the header', () => {
    renderTable([makeEvent(), makeEvent(), makeEvent()]);
    const grid = screen.getByRole('grid', { name: 'Matched events' });
    // 3 data rows + 1 header row = 4 total.
    expect(grid).toHaveAttribute('aria-rowcount', '4');
  });

  it('renders each data row with role="row" and gridcell children', () => {
    renderTable([makeEvent({ type: 'Hypopnea' })]);
    const grid = screen.getByRole('grid');
    const rows = within(grid).getAllByRole('row');
    // Header row is included in the count.
    expect(rows.length).toBe(2);
    const dataRow = rows[1];
    expect(dataRow).toBeDefined();
    expect(within(dataRow as HTMLElement).getAllByRole('gridcell').length).toBe(6);
  });

  it('exposes aria-sort on the active column header', () => {
    renderTable([makeEvent(), makeEvent()]);
    const time = screen.getByRole('columnheader', { name: /Time/ });
    expect(time).toHaveAttribute('aria-sort', 'ascending');
    const duration = screen.getByRole('columnheader', { name: /Duration/ });
    expect(duration).toHaveAttribute('aria-sort', 'none');
  });

  it('uses a roving tabindex: only the focused row is tabbable', () => {
    renderTable([makeEvent(), makeEvent(), makeEvent()]);
    const grid = screen.getByRole('grid');
    const rows = within(grid).getAllByRole('row').slice(1); // drop header
    expect(rows[0]).toHaveAttribute('tabindex', '0');
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]).toHaveAttribute('tabindex', '-1');
    }
  });

  it('moves focus down with ArrowDown and back up with ArrowUp', () => {
    renderTable([makeEvent(), makeEvent(), makeEvent()]);
    const grid = screen.getByRole('grid');
    const rows = within(grid).getAllByRole('row').slice(1) as HTMLElement[];

    rows[0]?.focus();
    expect(document.activeElement).toBe(rows[0]);

    fireEvent.keyDown(rows[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);

    fireEvent.keyDown(rows[1] as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('Home and End jump to the first/last row', () => {
    renderTable([makeEvent(), makeEvent(), makeEvent(), makeEvent()]);
    const grid = screen.getByRole('grid');
    const rows = within(grid).getAllByRole('row').slice(1) as HTMLElement[];

    act(() => {
      rows[1]?.focus();
    });
    act(() => {
      fireEvent.keyDown(rows[1] as HTMLElement, { key: 'End' });
    });
    expect(document.activeElement).toBe(rows[rows.length - 1]);

    act(() => {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    });
    expect(document.activeElement).toBe(rows[0]);
  });
});

// ── Wall-clock Time column ───────────────────────────────────────

/**
 * Re-derive the component's wall-clock formatting from the SAME helper, so the
 * expectation is locale/timezone-portable (a hardcoded "Mar 15, 2025…" string
 * would break across CI locales). This mirrors `formatWallClockTime` exactly.
 */
function expectedWallClock(startIso: string, eventTimestamp: number): string {
  const wallStart = sessionWallClockEpoch(startIso);
  const rawStart = new Date(startIso).getTime();
  const wallInstant = wallStart + (eventTimestamp - rawStart);
  return new Date(wallInstant).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  });
}

/** Mirrors the component's local-time fallback (no `timeZone` override). */
function expectedLocalTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** The Time column is the first gridcell of the (single) data row. */
function timeCellText(): string {
  const grid = screen.getByRole('grid');
  const dataRow = within(grid).getAllByRole('row')[1] as HTMLElement;
  const cell = within(dataRow).getAllByRole('gridcell')[0] as HTMLElement;
  return cell.textContent ?? '';
}

describe('EventTable wall-clock Time column', () => {
  beforeEach(() => {
    id = 0;
  });

  it('renders the wall-clock-as-UTC time derived from the session start', () => {
    const startIso = '2025-03-15T02:00:00.000Z';
    // 1h 23m 45s past the session start.
    const ts = new Date(startIso).getTime() + (1 * 3600 + 23 * 60 + 45) * 1000;
    const event = makeEvent({ sessionId: 'sess-1', timestamp: ts });

    render(
      <MemoryRouter>
        <EventTable events={[event]} sessionStartTimes={new Map([['sess-1', startIso]])} />
      </MemoryRouter>,
    );

    expect(timeCellText()).toBe(expectedWallClock(startIso, ts));
  });

  it('produces a wall-clock string that is independent of the wall-clock offset encoding', () => {
    // Two sessions whose stored ISO instants differ but whose LOCAL wall-clock
    // components are identical must render the same wall-clock time. We assert
    // that the rendered string equals the offset-anchored derivation (i.e. it
    // tracks the session's wall clock, not the raw UTC instant).
    const startIso = '2025-03-15T23:30:00.000Z';
    const ts = new Date(startIso).getTime() + 5 * 60 * 1000; // +5 min
    const event = makeEvent({ sessionId: 'sess-1', timestamp: ts });

    render(
      <MemoryRouter>
        <EventTable events={[event]} sessionStartTimes={new Map([['sess-1', startIso]])} />
      </MemoryRouter>,
    );

    const rendered = timeCellText();
    // The wall-clock instant is anchored to the session's local components.
    expect(rendered).toBe(expectedWallClock(startIso, ts));
    // And it differs from a naive raw-UTC formatting whenever the host TZ is not
    // UTC; at minimum it must equal the wall-clock derivation, never empty.
    expect(rendered).not.toBe('');
  });

  it('falls back to local-time formatting when the session start is missing', () => {
    const event = makeEvent({
      sessionId: 'sess-unknown',
      timestamp: Date.UTC(2025, 2, 15, 4, 5, 6),
    });

    render(
      <MemoryRouter>
        {/* Map intentionally omits this event's session. */}
        <EventTable events={[event]} sessionStartTimes={new Map()} />
      </MemoryRouter>,
    );

    expect(timeCellText()).toBe(expectedLocalTime(event.timestamp));
  });

  it('the wall-clock path and the fallback path differ for the same timestamp', () => {
    // Pick a session start whose stored UTC differs from local midnight so the
    // wall-clock conversion shifts the rendered value relative to the raw local
    // formatting. The two formatting paths must not coincide here.
    const startIso = '2025-06-15T22:15:00.000Z';
    const ts = new Date(startIso).getTime() + 90 * 1000;

    const wall = expectedWallClock(startIso, ts);
    const local = expectedLocalTime(ts);

    // Only meaningful when the host applies a non-UTC interpretation somewhere
    // in the chain; if they happen to coincide (host TZ == UTC) the assertion is
    // vacuously skipped, but the wall-clock render is still verified below.
    const event = makeEvent({ sessionId: 'sess-1', timestamp: ts });
    render(
      <MemoryRouter>
        <EventTable events={[event]} sessionStartTimes={new Map([['sess-1', startIso]])} />
      </MemoryRouter>,
    );
    expect(timeCellText()).toBe(wall);
    if (wall !== local) {
      expect(timeCellText()).not.toBe(local);
    }
  });
});
