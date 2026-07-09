import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { WindowToggle } from '@/components/layouts/WindowToggle';
import { useAppStore } from '@/stores/useAppStore';
import { formatDate } from '@/utils/formatDate';

// useCorpusStart() fetches the earliest imported night via getDB().getAllSessions()
// once the popover is first opened. Mock the singleton so the "All data" quick
// range and the custom-range `min` clamp are deterministic and no (fake)
// IndexedDB is ever opened. `vi.hoisted` lets the hoisted factory see the spy.
const { mockGetAllSessions } = vi.hoisted(() => ({ mockGetAllSessions: vi.fn() }));

vi.mock('@/services/storage/getDB', () => ({
  getDB: vi.fn(async () => ({ getAllSessions: mockGetAllSessions })),
}));

const MS_PER_DAY = 86_400_000;

/**
 * A date range whose `end - start` is EXACTLY `days` (noon-anchored so the ms
 * span is exact regardless of DST). This is the inverse of `derivePreset`, which
 * classifies the stored range by its rounded day-span.
 */
function spanDays(days: number): { start: Date; end: Date } {
  const end = new Date(2026, 6, 8, 12, 0, 0, 0);
  return { start: new Date(end.getTime() - days * MS_PER_DAY), end };
}

function setRange(range: { start: Date; end: Date }): void {
  useAppStore.setState({ dateRange: range });
}

describe('WindowToggle', () => {
  beforeEach(() => {
    mockGetAllSessions.mockResolvedValue([]);
    useAppStore.setState({ resolvedTheme: 'light', dateRange: spanDays(30) });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // The active preset is DERIVED from the stored range's day-span (mirroring
  // SignalDeck), so the toggle reflects whatever set the range — a preset click,
  // a custom pick, or a URL restore.
  describe('active preset derived from the stored range', () => {
    it.each([
      { days: 7, name: 'Last 7 days' },
      { days: 30, name: 'Last 30 days' },
      { days: 90, name: 'Last 90 days' },
      { days: 182, name: 'Last 6 months' },
      { days: 365, name: 'Last 12 months' },
    ])('a $days-day span selects the "$name" segment', ({ days, name }) => {
      setRange(spanDays(days));
      render(<WindowToggle />);
      expect(screen.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true');
    });

    it('an off-preset span selects no segment and marks Custom active', () => {
      setRange(spanDays(45)); // 45 days matches no preset → 'custom'
      render(<WindowToggle />);

      // "No selection" state: not one preset segment reads as checked.
      for (const radio of screen.getAllByRole('radio')) {
        expect(radio).toHaveAttribute('aria-checked', 'false');
      }
      // The roving tab-stop falls back to the first segment so the group stays
      // keyboard-reachable even with nothing selected.
      expect(screen.getByRole('radio', { name: 'Last 7 days' })).toHaveAttribute('tabindex', '0');

      // The Custom trigger reflects the active custom range.
      const custom = screen.getByRole('button', { name: 'Custom date range' });
      expect(custom.className).toContain('customBtnActive');
    });
  });

  describe('custom range popover', () => {
    /** Open the Custom popover (Radix toggles on the trigger's click). */
    function openPopover(): void {
      fireEvent.click(screen.getByRole('button', { name: 'Custom date range' }));
    }

    it('applies a valid (start ≤ end) range and writes it to the store', async () => {
      setRange(spanDays(30));
      render(<WindowToggle />);
      openPopover();

      const start = await screen.findByLabelText('Start');
      const end = screen.getByLabelText('End');
      fireEvent.change(start, { target: { value: '2026-03-01' } });
      fireEvent.change(end, { target: { value: '2026-03-20' } });

      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const { dateRange } = useAppStore.getState();
      expect(formatDate(dateRange.start)).toBe('2026-03-01');
      expect(formatDate(dateRange.end)).toBe('2026-03-20');

      // Applying a valid range closes the popover.
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
      });
    });

    it('does NOT write the store for an inverted (start > end) range', async () => {
      const initial = spanDays(30);
      setRange(initial);
      render(<WindowToggle />);
      openPopover();

      const start = await screen.findByLabelText('Start');
      const end = screen.getByLabelText('End');
      fireEvent.change(start, { target: { value: '2026-03-20' } });
      fireEvent.change(end, { target: { value: '2026-03-01' } });

      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

      // The store is untouched (still the pre-render 30-day range) …
      const { dateRange } = useAppStore.getState();
      expect(formatDate(dateRange.start)).toBe(formatDate(initial.start));
      expect(formatDate(dateRange.end)).toBe(formatDate(initial.end));
      // … and the popover stays open so the range can be corrected.
      expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    });

    it('the "All data" quick range uses the corpus start', async () => {
      mockGetAllSessions.mockResolvedValue([
        { date: '2024-02-15', deleted: false },
        { date: '2024-05-01', deleted: false },
        { date: '2023-12-31', deleted: true }, // deleted → excluded from the extent
      ]);
      setRange(spanDays(30));
      render(<WindowToggle />);
      openPopover();

      // Wait until the corpus extent has resolved — it clamps the inputs' `min`,
      // which is the observable signal that `corpusStart` is now populated.
      const start = await screen.findByLabelText('Start');
      await waitFor(() => expect(start).toHaveAttribute('min', '2024-02-15'));

      fireEvent.click(screen.getByRole('button', { name: 'All data' }));

      expect(formatDate(useAppStore.getState().dateRange.start)).toBe('2024-02-15');
    });
  });

  // Below 768px the horizontal segment is CSS-hidden and a compact command-surface
  // menu takes over (spec B3). jsdom applies no media query, so both controls are
  // in the DOM; the menu's trigger is the only role=button named "Time window",
  // and its contents (scoped via the unique "Custom range…" entry) are distinct
  // from the always-rendered desktop segment.
  describe('mobile menu (compact <768px control)', () => {
    /** The mobile menu, scoped so its radios don't collide with the desktop segment. */
    function openMobileMenu(): HTMLElement {
      fireEvent.click(screen.getByRole('button', { name: 'Time window' }));
      const menu = screen.getByText('Custom range…').closest('div');
      if (!menu) throw new Error('mobile menu container not found');
      return menu;
    }

    it('reflects the active preset and switches to another from the menu', () => {
      setRange(spanDays(30));
      render(<WindowToggle />);
      const menu = within(openMobileMenu());

      // The stored 30-day span is reflected as the checked radio.
      expect(menu.getByRole('radio', { name: 'Last 30 days' })).toHaveAttribute(
        'aria-checked',
        'true',
      );

      // Picking a different preset writes the matching span to the store.
      fireEvent.click(menu.getByRole('radio', { name: 'Last 7 days' }));
      const { dateRange } = useAppStore.getState();
      const spanned = Math.round(
        (dateRange.end.getTime() - dateRange.start.getTime()) / MS_PER_DAY,
      );
      expect(spanned).toBe(7);
    });

    it('opens the custom-range fields from the menu and applies a range', async () => {
      setRange(spanDays(30));
      render(<WindowToggle />);
      openMobileMenu();

      // "Custom range…" reveals the shared date fields inside the same menu.
      fireEvent.click(screen.getByText('Custom range…'));
      const start = await screen.findByLabelText('Start');
      const end = screen.getByLabelText('End');
      fireEvent.change(start, { target: { value: '2026-03-01' } });
      fireEvent.change(end, { target: { value: '2026-03-20' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const { dateRange } = useAppStore.getState();
      expect(formatDate(dateRange.start)).toBe('2026-03-01');
      expect(formatDate(dateRange.end)).toBe('2026-03-20');
    });
  });
});
