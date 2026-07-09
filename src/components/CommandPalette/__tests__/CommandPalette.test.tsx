import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { CommandPalette } from '@/components/CommandPalette';
import { useAppStore } from '@/stores/useAppStore';

// Control the date-jump lookup. `getSessionsByDateRange` is the only DB method
// the palette touches — mock the singleton so tests stay fast and deterministic
// and never open a (fake) IndexedDB. `vi.hoisted` lets the hoisted `vi.mock`
// factory reference the spy safely.
const { mockGetSessionsByDateRange } = vi.hoisted(() => ({
  mockGetSessionsByDateRange: vi.fn(),
}));

vi.mock('@/services/storage/getDB', () => ({
  getDB: vi.fn(async () => ({ getSessionsByDateRange: mockGetSessionsByDateRange })),
}));

/** Surfaces the current route so navigation can be asserted. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPalette(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <CommandPalette />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** The combobox input the palette exposes (spec Part E). */
function getInput() {
  return screen.getByRole('combobox');
}

describe('CommandPalette', () => {
  beforeEach(() => {
    mockGetSessionsByDateRange.mockResolvedValue([]);
    useAppStore.setState({ commandPaletteOpen: true, theme: 'system' });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ commandPaletteOpen: false });
    vi.clearAllMocks();
  });

  describe('open state (driven by the store flag)', () => {
    it('renders nothing when the store flag is false', () => {
      useAppStore.setState({ commandPaletteOpen: false });
      renderPalette();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders the modal dialog when the store flag is true', () => {
      renderPalette();
      const dialog = screen.getByRole('dialog', { name: 'Command palette' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });
  });

  describe('ARIA roles + relationships', () => {
    it('wires combobox → listbox and exposes options with a tracked active descendant', () => {
      renderPalette();

      const input = getInput();
      const listbox = screen.getByRole('listbox');

      // combobox controls the listbox.
      expect(input).toHaveAttribute('aria-controls', listbox.id);
      expect(input).toHaveAttribute('aria-expanded', 'true');

      // Default view exposes options.
      const options = screen.getAllByRole('option');
      expect(options.length).toBeGreaterThan(0);

      // aria-activedescendant points at an option that is itself aria-selected.
      const activeId = input.getAttribute('aria-activedescendant');
      expect(activeId).toBeTruthy();
      const activeOption = activeId ? document.getElementById(activeId) : null;
      expect(activeOption).not.toBeNull();
      expect(activeOption).toHaveAttribute('role', 'option');
      expect(activeOption).toHaveAttribute('aria-selected', 'true');
    });

    it('shows the default SECTIONS and ACTIONS groups on an empty query', () => {
      renderPalette();
      expect(screen.getByText('Sections')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Dashboard' })).toBeInTheDocument();
    });
  });

  describe('fuzzy filtering', () => {
    it('narrows options to those matching the query', () => {
      renderPalette();
      expect(screen.getByRole('option', { name: 'Dashboard' })).toBeInTheDocument();

      fireEvent.change(getInput(), { target: { value: 'trends' } });

      expect(screen.getByRole('option', { name: 'Trends' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Dashboard' })).not.toBeInTheDocument();
    });

    it('shows the empty state for a non-date query with no matches', () => {
      renderPalette();
      fireEvent.change(getInput(), { target: { value: 'zzzznomatch' } });

      expect(screen.queryAllByRole('option')).toHaveLength(0);
      expect(screen.getByText(/No matches for/)).toBeInTheDocument();
    });
  });

  describe('keyboard navigation', () => {
    it('moves the active option with ArrowDown and updates aria-activedescendant', () => {
      renderPalette();
      const input = getInput();

      const firstActive = input.getAttribute('aria-activedescendant');
      expect(firstActive).toBeTruthy();
      expect(document.getElementById(firstActive ?? '')).toHaveAttribute('aria-selected', 'true');

      fireEvent.keyDown(input, { key: 'ArrowDown' });

      const secondActive = input.getAttribute('aria-activedescendant');
      expect(secondActive).toBeTruthy();
      expect(secondActive).not.toBe(firstActive);
      expect(document.getElementById(secondActive ?? '')).toHaveAttribute('aria-selected', 'true');
      // The previously-active option is no longer selected.
      expect(document.getElementById(firstActive ?? '')).toHaveAttribute('aria-selected', 'false');
    });

    it('wraps from the first option to the last with ArrowUp', () => {
      renderPalette();
      const input = getInput();
      const options = screen.getAllByRole('option');
      const lastId = options[options.length - 1]?.id;

      fireEvent.keyDown(input, { key: 'ArrowUp' });

      expect(input.getAttribute('aria-activedescendant')).toBe(lastId);
    });
  });

  describe('activation', () => {
    it('navigates to the active section and closes on Enter', () => {
      renderPalette('/');
      fireEvent.change(getInput(), { target: { value: 'trends' } });

      fireEvent.keyDown(getInput(), { key: 'Enter' });

      expect(screen.getByTestId('location')).toHaveTextContent('/trends');
      expect(useAppStore.getState().commandPaletteOpen).toBe(false);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('activates a section by mouse click', () => {
      renderPalette('/');
      fireEvent.click(screen.getByRole('option', { name: 'Reports' }));

      expect(screen.getByTestId('location')).toHaveTextContent('/reports');
      expect(useAppStore.getState().commandPaletteOpen).toBe(false);
    });
  });

  describe('dismissal', () => {
    it('closes on Escape', () => {
      renderPalette();
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      fireEvent.keyDown(getInput(), { key: 'Escape' });

      expect(useAppStore.getState().commandPaletteOpen).toBe(false);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes on a backdrop click', () => {
      const { container } = renderPalette();
      // The overlay is the dialog's parent; clicking it (not the panel) dismisses.
      const overlay = container.querySelector('div');
      expect(overlay).not.toBeNull();
      if (overlay) fireEvent.click(overlay);

      expect(useAppStore.getState().commandPaletteOpen).toBe(false);
    });
  });

  describe('session date-jump', () => {
    it('resolves a YYYY-MM-DD query to a session and navigates on activation', async () => {
      mockGetSessionsByDateRange.mockResolvedValue([
        { id: 'sess-1', date: '2026-07-04', machineModel: 'AirSense 10 AutoSet', deleted: false },
      ]);

      renderPalette('/');
      fireEvent.change(getInput(), { target: { value: '2026-07-04' } });

      // The date-indexed lookup ran for exactly that day (start === end), metadata only.
      await waitFor(() => {
        expect(mockGetSessionsByDateRange).toHaveBeenCalledWith('2026-07-04', '2026-07-04');
      });

      // The SESSIONS row renders (sub-text = machine model), and is the sole match.
      const sessionOption = await screen.findByRole('option', { name: /AirSense 10 AutoSet/ });
      expect(sessionOption).toBeInTheDocument();

      fireEvent.keyDown(getInput(), { key: 'Enter' });

      expect(screen.getByTestId('location')).toHaveTextContent('/sessions/sess-1');
      expect(useAppStore.getState().commandPaletteOpen).toBe(false);
    });

    it('shows a no-result message when no session exists on the parsed date', async () => {
      mockGetSessionsByDateRange.mockResolvedValue([]);

      renderPalette('/');
      fireEvent.change(getInput(), { target: { value: '2026-01-01' } });

      expect(await screen.findByText(/No session recorded on 2026-01-01/)).toBeInTheDocument();
      expect(screen.queryAllByRole('option')).toHaveLength(0);
    });
  });
});
