import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RootLayout from '@/components/layouts/RootLayout';
import { useAppStore } from '@/stores/useAppStore';
// Same CSS-module import the component uses, so the active-state assertions
// reference the SAME class token the component applies (an identity proxy under
// vitest, a hash under a real build) rather than a hardcoded literal that could
// silently drift from `RootLayout.module.css`.
import styles from '@/components/layouts/RootLayout.module.css';

// `noUncheckedIndexedAccess` types CSS-module members as `string | undefined`.
// Resolve the two tokens we assert on once, failing loudly if either is missing
// (which would itself be a meaningful regression in RootLayout.module.css),
// while giving `toHaveClass` a plain `string` argument under strict TS.
function requireClass(token: string | undefined, name: string): string {
  if (!token) throw new Error(`Expected styles.${name} to be defined`);
  return token;
}
const NAV_LINK = requireClass(styles.navLink, 'navLink');
const NAV_LINK_ACTIVE = requireClass(styles.navLinkActive, 'navLinkActive');

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

/**
 * Render RootLayout inside a router whose tree mirrors the real nesting in
 * src/router.tsx: a `sessions` parent with both an index child and a
 * `:sessionId` child (which itself nests a `signals` route). This exercises the
 * `useMatch({ path, end })` active-state path in NavItemLink on DEEP routes —
 * the trivial two-route `renderLayout` above never descends below the first
 * segment, so it cannot distinguish `end: true` (Dashboard) from a parent match
 * (Sessions on `/sessions/:id`). Children render no real view content; the
 * sidebar nav is the subject under test.
 */
function renderNestedLayout(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<RootLayout />}>
          <Route index element={<div>dashboard-content</div>} />
          <Route path="sessions">
            <Route index element={<div>session-list-content</div>} />
            <Route path=":sessionId" element={<div>session-detail-content</div>}>
              <Route path="signals" element={<div>signals-content</div>} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

/** The desktop rail toggle, identified by either of its two accessible names. */
function getRailToggle() {
  return screen.getByRole('button', { name: /(Collapse|Expand) sidebar/ });
}

/** The decorative collapse/expand glyph inside the rail toggle button. */
function toggleGlyph(): string | null {
  const glyph = getRailToggle().querySelector('span[aria-hidden="true"]');
  return glyph?.textContent ?? null;
}

// Guillemet glyphs from the rail toggle (spec B1): « invites collapsing when
// expanded, » invites expanding when in the rail.
const GLYPH_EXPANDED = '«';
const GLYPH_COLLAPSED = '»';

describe('RootLayout', () => {
  beforeEach(() => {
    // Desktop by default — the rail feature is desktop-only.
    setViewport(true);
    useAppStore.setState({ sidebarCollapsed: false, theme: 'system', resolvedTheme: 'light' });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      importWizardOpen: false,
    });
    // Restore the shared setup.ts stub shape (matches: false everywhere).
    setViewport(false);
    vi.clearAllMocks();
  });

  describe('rail toggle button', () => {
    it('renders expanded: aria-pressed=false, "Collapse sidebar", « glyph', () => {
      renderLayout();
      const toggle = getRailToggle();
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(toggle).toHaveAccessibleName('Collapse sidebar');
      expect(toggle).toHaveAttribute('type', 'button');
      expect(toggleGlyph()).toBe(GLYPH_EXPANDED);
    });

    it('renders collapsed: aria-pressed=true, "Expand sidebar", » glyph', () => {
      useAppStore.setState({ sidebarCollapsed: true });
      renderLayout();
      const toggle = getRailToggle();
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(toggle).toHaveAccessibleName('Expand sidebar');
      expect(toggleGlyph()).toBe(GLYPH_COLLAPSED);
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
      expect(toggleGlyph()).toBe(GLYPH_COLLAPSED);
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);

      await user.click(getRailToggle());
      await waitFor(() => {
        expect(getRailToggle()).toHaveAttribute('aria-pressed', 'false');
      });
      expect(getRailToggle()).toHaveAccessibleName('Collapse sidebar');
      expect(toggleGlyph()).toBe(GLYPH_EXPANDED);
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

  describe('nav active state (useMatch-driven)', () => {
    // NavItemLink derives active state from `useMatch({ path: item.to, end:
    // item.to === '/' })` and feeds NavLink a STATIC className string (so a
    // Radix Tooltip `Slot` can merge it in rail mode — a functional className
    // cannot be invoked by Slot). NavLink still emits `aria-current="page"` for
    // the active link. We assert `aria-current` as the primary, stable signal
    // and additionally assert `styles.navLinkActive` via the component's own
    // CSS-module import.

    it('marks Sessions active (not Dashboard) on a nested /sessions/:id route', () => {
      renderNestedLayout('/sessions/abc123');

      const sessions = screen.getByRole('link', { name: 'Sessions' });
      const dashboard = screen.getByRole('link', { name: 'Dashboard' });

      // Stable semantic signal: only the active link carries aria-current=page.
      expect(sessions).toHaveAttribute('aria-current', 'page');
      expect(dashboard).not.toHaveAttribute('aria-current');

      // Visual signal: the active class token the component applies.
      expect(sessions).toHaveClass(NAV_LINK_ACTIVE);
      expect(dashboard).not.toHaveClass(NAV_LINK_ACTIVE);
    });

    it('keeps Sessions active on an even deeper /sessions/:id/signals route', () => {
      renderNestedLayout('/sessions/abc123/signals');

      const sessions = screen.getByRole('link', { name: 'Sessions' });
      expect(sessions).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    });

    it('marks Dashboard active (not Sessions) only on exactly "/" — verifies end:true', () => {
      renderNestedLayout('/');

      const dashboard = screen.getByRole('link', { name: 'Dashboard' });
      const sessions = screen.getByRole('link', { name: 'Sessions' });

      expect(dashboard).toHaveAttribute('aria-current', 'page');
      expect(dashboard).toHaveClass(NAV_LINK_ACTIVE);

      expect(sessions).not.toHaveAttribute('aria-current');
      expect(sessions).not.toHaveClass(NAV_LINK_ACTIVE);
    });

    it('does NOT mark Dashboard active on a non-root route (end:true boundary)', () => {
      // The `end: item.to === '/'` flag is what stops Dashboard ("/") from
      // matching every route as a prefix. Guards against a regression that
      // dropped `end` and lit Dashboard everywhere.
      renderNestedLayout('/sessions/abc123');
      expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    });

    it('preserves active state in rail/collapsed mode (the Slot scenario the fix targets)', () => {
      // Rail mode wraps each NavLink in a Radix Tooltip Trigger `asChild`, which
      // clones via Slot and merges a STRING className. This is the exact path
      // that broke with a functional className. Assert the active link still
      // gets both aria-current and the active class through the Slot.
      useAppStore.setState({ sidebarCollapsed: true });
      renderNestedLayout('/sessions/abc123');

      const sessions = screen.getByRole('link', { name: 'Sessions' });
      expect(sessions).toHaveAttribute('aria-current', 'page');
      expect(sessions).toHaveClass(NAV_LINK_ACTIVE);
      // The base navLink class must survive the Slot string-merge too (losing it
      // is what stripped the rail icon geometry/colour in the original bug).
      expect(sessions).toHaveClass(NAV_LINK);

      expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
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

  describe('section title — prototype-chain safety', () => {
    // sectionTitleFor() looks the first path segment up in a plain-object title
    // map. A bare index would resolve INHERITED members for keys like
    // `__proto__`, `toString`, `constructor`, or `hasOwnProperty` (the prototype
    // object / a function). Those are non-nullish, so the `?? 'CPAP Analyzer'`
    // fallback would NOT catch them — and this header renders OUTSIDE the route
    // error boundary, so rendering a function/object as a React child would
    // throw and white-screen the whole app. An own-property guard must return
    // the "CPAP Analyzer" fallback for any such path.
    const SECTION_TITLE = requireClass(styles.sectionTitle, 'sectionTitle');

    // A splat child so the layout mounts for ANY path (the trivial renderLayout
    // route tree only knows `/` and `sessions`).
    function renderLayoutAt(initialPath: string) {
      return render(
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/" element={<RootLayout />}>
              <Route index element={<div>dashboard-content</div>} />
              <Route path="*" element={<div>fallback-content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    }

    it.each(['/__proto__', '/toString', '/constructor', '/hasOwnProperty'])(
      'renders the fallback title (not an inherited member) for %s',
      (path) => {
        // Reaching the assertion at all proves rendering no longer throws.
        const { container } = renderLayoutAt(path);
        const title = container.querySelector(`.${SECTION_TITLE}`);
        expect(title).not.toBeNull();
        expect(title).toHaveTextContent('CPAP Analyzer');
      },
    );

    it('still resolves a legitimate own-key segment to its title', () => {
      const { container } = renderLayoutAt('/sessions');
      expect(container.querySelector(`.${SECTION_TITLE}`)).toHaveTextContent('Sessions');
    });
  });

  describe('background inert while a modal overlay is open', () => {
    // The ⌘K palette and the import wizard are aria-modal with a focus trap, but
    // the chrome behind them must ALSO leave the a11y tree + tab order. RootLayout
    // toggles the `inert` attribute on <main> and the sidebar for the duration.
    // The <header> is intentionally left interactive (it hosts the modal invokers,
    // so focus can be captured on open and restored on close).

    it('marks <main> and the sidebar inert while the command palette is open', async () => {
      const { container } = renderLayout();
      const main = container.querySelector('main');
      const sidebar = container.querySelector('aside');
      expect(main).not.toBeNull();
      expect(sidebar).not.toBeNull();

      // Closed by default: no inert.
      expect(main).not.toHaveAttribute('inert');
      expect(sidebar).not.toHaveAttribute('inert');

      // Opening the palette (the ⌘K store path) inerts the background chrome.
      useAppStore.getState().setCommandPaletteOpen(true);
      await waitFor(() => expect(main).toHaveAttribute('inert'));
      expect(sidebar).toHaveAttribute('inert');

      // Closing clears it again so the chrome is operable.
      useAppStore.getState().setCommandPaletteOpen(false);
      await waitFor(() => expect(main).not.toHaveAttribute('inert'));
      expect(sidebar).not.toHaveAttribute('inert');
    });

    it('marks the chrome inert while the import wizard modal is open', async () => {
      const { container } = renderLayout();
      const main = container.querySelector('main');
      const sidebar = container.querySelector('aside');
      expect(main).not.toHaveAttribute('inert');

      useAppStore.getState().setImportWizardOpen(true);
      await waitFor(() => expect(main).toHaveAttribute('inert'));
      expect(sidebar).toHaveAttribute('inert');

      useAppStore.getState().setImportWizardOpen(false);
      await waitFor(() => expect(main).not.toHaveAttribute('inert'));
      expect(sidebar).not.toHaveAttribute('inert');
    });
  });
});
