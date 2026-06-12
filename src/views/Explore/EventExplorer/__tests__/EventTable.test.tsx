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

function renderTable(events: Event[]) {
  return render(
    <MemoryRouter>
      <EventTable events={events} />
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
