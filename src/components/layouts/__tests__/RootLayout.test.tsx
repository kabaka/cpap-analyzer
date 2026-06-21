import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RootLayout from '@/components/layouts/RootLayout';
import { useAppStore } from '@/stores/useAppStore';

// ── matchMedia control ──────────────────────────────────────────────────────
// The default jsdom stub in src/test/setup.ts answers `matches: false` for every
// query. RootLayout gates the `[` rail shortcut behind `(min-width: 768px)` and
// the StatusBar / theme hooks also call matchMedia. We install a per-test
// implementation that lets us choose whether the desktop breakpoint matches,
// then restore the shared stub in afterEach so we don't mutate global state for
// other suites.
const DESKTOP_QUERY = '(min-width: 768px)';

/**
 * Replace window.matchMedia so `(min-width: 768px)` reports `desktop`. Any other
 * query (e.g. `(prefers-color-scheme: dark)`) keeps the benign `matches: false`
 * default so theme resolution stays deterministic.
 */
function setViewport(desktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === DESKTOP_QUERY ? desktop : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** Render RootLayout inside a router with a trivial Outlet child. */
function renderLayout(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<RootLayout />}>
          <Route index element={<div>dashboard-content</div>} />
          <Route path="sessions" element={<div>sessions-content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

/** The desktop rail toggle, identified by either of its two accessible names. */
function getRailToggle() {
  return screen.getByRole('button', { name: /(Collapse|Expand) sidebar/ });
}

/** The polyline `points` of the chevron icon inside the rail toggle button. */
function toggleIconPoints(): string | null {
  const polyline = getRailToggle().querySelector('polyline');
  return polyline?.getAttribute('points') ?? null;
}

// Chevron path data from the Icon component (Icon.tsx PATHS map).
const CHEVRON_LEFT = '15 5 8 12 15 19';
const CHEVRON_RIGHT = '9 5 16 12 9 19';

describe('RootLayout', () => {
  beforeEach(() => {
    // Desktop by default — the rail feature is desktop-only.
    setViewport(true);
    useAppStore.setState({ sidebarCollapsed: false, theme: 'system', resolvedTheme: 'light' });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ sidebarCollapsed: false });
    // Restore the shared setup.ts stub shape (matches: false everywhere).
    setViewport(false);
    vi.clearAllMocks();
  });

  describe('rail toggle button', () => {
    it('renders expanded: aria-pressed=false, "Collapse sidebar", chevron-left', () => {
      renderLayout();
      const toggle = getRailToggle();
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(toggle).toHaveAccessibleName('Collapse sidebar');
      expect(toggle).toHaveAttribute('type', 'button');
      expect(toggleIconPoints()).toBe(CHEVRON_LEFT);
    });

    it('renders collapsed: aria-pressed=true, "Expand sidebar", chevron-right', () => {
      useAppStore.setState({ sidebarCollapsed: true });
      renderLayout();
      const toggle = getRailToggle();
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(toggle).toHaveAccessibleName('Expand sidebar');
      expect(toggleIconPoints()).toBe(CHEVRON_RIGHT);
    });

    it('reflects external store changes in aria-pressed and label', async () => {
      renderLayout();
      expect(getRailToggle()).toHaveAttribute('aria-pressed', 'false');

      useAppStore.getState().setSidebarCollapsed(true);
      await waitFor(() => {
        expect(getRailToggle()).toHaveAttribute('aria-pressed', 'true');
      });
      expect(getRailToggle()).toHaveAccessibleName('Expand sidebar');
    });
  });

  describe('clicking the toggle', () => {
    it('collapses then expands, flipping aria-pressed, label and icon each time', async () => {
      const user = userEvent.setup();
      renderLayout();

      await user.click(getRailToggle());
      await waitFor(() => {
        expect(getRailToggle()).toHaveAttribute('aria-pressed', 'true');
      });
      expect(getRailToggle()).toHaveAccessibleName('Expand sidebar');
      expect(toggleIconPoints()).toBe(CHEVRON_RIGHT);
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);

      await user.click(getRailToggle());
      await waitFor(() => {
        expect(getRailToggle()).toHaveAttribute('aria-pressed', 'false');
      });
      expect(getRailToggle()).toHaveAccessibleName('Collapse sidebar');
      expect(toggleIconPoints()).toBe(CHEVRON_LEFT);
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  describe('the `[` keyboard shortcut (desktop)', () => {
    // The handler is a raw `document.addEventListener('keydown')`, so we dispatch
    // with fireEvent for precise control over the event target and modifiers.
    // `[` is a reserved character in userEvent.keyboard's parser, which is the
    // other reason fireEvent is the cleaner tool here.
    it('toggles the rail when fired on the document body', async () => {
      renderLayout();
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);

      fireEvent.keyDown(document.body, { key: '[' });
      await waitFor(() => {
        expect(useAppStore.getState().sidebarCollapsed).toBe(true);
      });

      fireEvent.keyDown(document.body, { key: '[' });
      await waitFor(() => {
        expect(useAppStore.getState().sidebarCollapsed).toBe(false);
      });
    });

    it('updates the toggle button accessible name after the shortcut fires', async () => {
      renderLayout();
      fireEvent.keyDown(document.body, { key: '[' });
      await waitFor(() => {
        expect(getRailToggle()).toHaveAccessibleName('Expand sidebar');
      });
    });

    it('does NOT toggle when the event originates from a text input', async () => {
      renderLayout();

      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);
      input.focus();

      fireEvent.keyDown(input, { key: '[' });
      await Promise.resolve();
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);

      input.remove();
    });

    it('does NOT toggle when the event originates from a textarea', async () => {
      renderLayout();
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      textarea.focus();

      fireEvent.keyDown(textarea, { key: '[' });
      await Promise.resolve();
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);

      textarea.remove();
    });

    it('does NOT toggle when a modifier is held (Ctrl+[)', async () => {
      renderLayout();
      fireEvent.keyDown(document.body, { key: '[', ctrlKey: true });
      await Promise.resolve();
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  describe('the `[` keyboard shortcut (mobile)', () => {
    it('is a no-op below the desktop breakpoint', async () => {
      setViewport(false); // < 768px
      renderLayout();
      fireEvent.keyDown(document.body, { key: '[' });
      await Promise.resolve();
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  describe('aria-live announcements', () => {
    it('announces "Sidebar collapsed" then "Sidebar expanded" on toggle', async () => {
      const user = userEvent.setup();
      const { container } = renderLayout();
      const status = container.querySelector('[role="status"]');
      expect(status).not.toBeNull();
      expect(status).toHaveAttribute('aria-live', 'polite');
      // Empty before any toggle.
      expect(status?.textContent).toBe('');

      await user.click(getRailToggle());
      await waitFor(() => {
        expect(status?.textContent).toBe('Sidebar collapsed');
      });

      await user.click(getRailToggle());
      await waitFor(() => {
        expect(status?.textContent).toBe('Sidebar expanded');
      });
    });
  });

  describe('rail mode accessibility', () => {
    it('keeps nav link accessible names even though the visible label is hidden', () => {
      useAppStore.setState({ sidebarCollapsed: true });
      renderLayout();
      // In rail mode each NavLink gets an explicit aria-label, so role+name still
      // resolves regardless of the `.navLabel` being display:none.
      expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Sessions' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Trends' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Help' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    });
  });

  describe('regression: existing landmarks and controls', () => {
    it('exposes the mobile hamburger button', () => {
      renderLayout();
      expect(screen.getByRole('button', { name: /navigation menu/i })).toBeInTheDocument();
    });

    it('exposes a single Primary navigation landmark', () => {
      renderLayout();
      const nav = screen.getByRole('navigation', { name: 'Primary' });
      expect(nav).toBeInTheDocument();
      // All section links live within the one nav landmark.
      expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    });

    it('renders the routed outlet content', () => {
      renderLayout();
      expect(screen.getByText('dashboard-content')).toBeInTheDocument();
    });
  });
});
