import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
  type TransitionEvent,
} from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useThemeEffect } from '@/hooks/useTheme';
import { useURLStateSync } from '@/hooks/useURLState';
import { RouteErrorBoundary } from '@/components/errors';
import { Tooltip, TooltipProvider, Icon, type IconName } from '@/components/ui';
import { useAppStore } from '@/stores/useAppStore';
import { StatusBar } from './StatusBar';
import { ThemeMenu } from './ThemeMenu';
import styles from './RootLayout.module.css';

/** Desktop breakpoint at which the rail (collapse) behaviour is available. */
const DESKTOP_MEDIA_QUERY = '(min-width: 768px)';

/**
 * Conditionally wraps a sidebar item in a right-anchored tooltip. In rail mode
 * the visible label is hidden, so the tooltip surfaces the item's name on hover
 * AND keyboard focus. When expanded the label is visible, so we render no
 * tooltip (the wrapper is simply not mounted) to avoid redundant popups.
 *
 * The accessible name does NOT depend on this tooltip — see `.navLabel` /
 * `aria-label` on the wrapped element, which persist in rail mode.
 */
function RailTooltip({
  active,
  label,
  children,
}: {
  active: boolean;
  label: string;
  children: ReactNode;
}) {
  if (!active) return <>{children}</>;
  return (
    <Tooltip content={label} side="right">
      {children}
    </Tooltip>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const ANALYSIS_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/sessions', label: 'Sessions', icon: 'sessions' },
  { to: '/trends', label: 'Trends', icon: 'trends' },
  { to: '/explore', label: 'Explore', icon: 'explore' },
  { to: '/reports', label: 'Reports', icon: 'reports' },
];

const DATA_ITEMS: NavItem[] = [{ to: '/data', label: 'Data', icon: 'data' }];

const FOOTER_ITEMS: NavItem[] = [
  { to: '/help', label: 'Help', icon: 'help' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

/**
 * Maps a route path's first segment to its section title. Derived from the
 * nav metadata so the header title stays in sync with one source of truth and
 * is resilient to nested routes (e.g. `/explore/correlations` → "Explore",
 * `/sessions/:id` → "Sessions").
 */
const SECTION_TITLES: Record<string, string> = {
  '': 'Dashboard',
  sessions: 'Sessions',
  trends: 'Trends',
  explore: 'Explore',
  reports: 'Reports',
  data: 'Data',
  settings: 'Settings',
  help: 'Help',
};

function sectionTitleFor(pathname: string): string {
  const firstSegment = pathname.replace(/^\/+/, '').split('/')[0] ?? '';
  return SECTION_TITLES[firstSegment] ?? 'CPAP Analyzer';
}

function NavItemLink({
  item,
  isRail,
  onNavigate,
}: {
  item: NavItem;
  isRail: boolean;
  onNavigate: () => void;
}) {
  return (
    <RailTooltip active={isRail} label={item.label}>
      <NavLink
        to={item.to}
        end={item.to === '/'}
        className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
        onClick={onNavigate}
        // In rail mode the visible label is hidden (display:none removes it from
        // the a11y tree), so attach an explicit accessible name here. Expanded
        // mode relies on the visible `.navLabel` text instead.
        aria-label={isRail ? item.label : undefined}
      >
        <Icon name={item.icon} size="lg" className={styles.navIcon} />
        <span className={styles.navLabel}>{item.label}</span>
      </NavLink>
    </RailTooltip>
  );
}

function NavGroup({
  label,
  items,
  isRail,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  isRail: boolean;
  onNavigate: () => void;
}) {
  return (
    <div className={styles.navGroup}>
      <p className={styles.navGroupLabel} aria-hidden="true">
        {label}
      </p>
      <ul className={styles.navList}>
        {items.map((item) => (
          <li key={item.to}>
            <NavItemLink item={item} isRail={isRail} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RootLayout() {
  useURLStateSync();
  useThemeEffect();

  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Desktop rail (collapsed) preference — persisted in the app store. On <768px
  // this preference is inert (all rail CSS is gated behind a desktop media
  // query); the mobile off-canvas drawer is driven by `sidebarOpen` instead.
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const toggleSidebarCollapsed = useAppStore((state) => state.toggleSidebarCollapsed);

  const sidebarRef = useRef<HTMLElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Polite announcement for the collapse/expand state change. Needed because the
  // `[` shortcut can toggle without the toggle button focused, so the button's
  // own aria-pressed/label flip is not always announced.
  const [railAnnouncement, setRailAnnouncement] = useState('');

  // Skip-to-content: move DOM focus to <main> programmatically. We cannot rely
  // on the `#main-content` hash because `useURLStateSync` rewrites the URL right
  // after navigation, stripping the fragment (so `:target` is transient). The
  // href is kept for non-JS/standard semantics; this handler does the real work.
  const handleSkipToContent = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    mainRef.current?.focus();
  }, []);

  const sectionTitle = sectionTitleFor(location.pathname);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  // ── Rail (collapse/expand) toggle ──
  // Toggling animates the sidebar width and the content's margin-left. The
  // content area hosts the SignalViewer, whose ResizeObserver fires on every
  // animation frame and would otherwise drive an expensive full-resolution
  // re-render per frame.
  //
  // SHARED TRANSITION MARKER: we set `document.body.dataset.sidebarAnimating`
  // for the duration of the transition so cross-cutting consumers (notably the
  // SignalViewer's resize handling) can coalesce/skip mid-transition work and
  // do a single render once it clears. It is cleared on the sidebar's `width`
  // `transitionend`, with a timeout fallback in case transitionend never fires
  // (e.g. reduced-motion = 0ms, or an interrupted/competing transition).
  const animatingTimeoutRef = useRef<number | null>(null);
  const handleRailToggle = useCallback(() => {
    document.body.dataset.sidebarAnimating = 'true';
    if (animatingTimeoutRef.current !== null) {
      window.clearTimeout(animatingTimeoutRef.current);
    }
    // --transition-base is 200ms (0ms under reduced motion); 320ms covers it
    // plus buffer if transitionend is missed.
    animatingTimeoutRef.current = window.setTimeout(() => {
      delete document.body.dataset.sidebarAnimating;
      animatingTimeoutRef.current = null;
    }, 320);

    toggleSidebarCollapsed();
    // getState() reflects the NEW value already (set is synchronous).
    const isNowCollapsed = useAppStore.getState().sidebarCollapsed;
    setRailAnnouncement(isNowCollapsed ? 'Sidebar collapsed' : 'Sidebar expanded');
  }, [toggleSidebarCollapsed]);

  // Clear the animating marker as soon as the sidebar width transition ends.
  const handleSidebarTransitionEnd = useCallback((event: TransitionEvent<HTMLElement>) => {
    if (event.target !== sidebarRef.current || event.propertyName !== 'width') return;
    if (animatingTimeoutRef.current !== null) {
      window.clearTimeout(animatingTimeoutRef.current);
      animatingTimeoutRef.current = null;
    }
    delete document.body.dataset.sidebarAnimating;
  }, []);

  // Clear any pending marker timeout on unmount.
  useEffect(() => {
    return () => {
      if (animatingTimeoutRef.current !== null) {
        window.clearTimeout(animatingTimeoutRef.current);
      }
      delete document.body.dataset.sidebarAnimating;
    };
  }, []);

  // Keyboard shortcut: `[` toggles the rail. Ignored when focus is in a text
  // entry surface, and a no-op below the desktop breakpoint.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== '[' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!window.matchMedia(DESKTOP_MEDIA_QUERY).matches) return;

      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const role = target.getAttribute('role');
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          target.isContentEditable ||
          role === 'textbox' ||
          role === 'combobox'
        ) {
          return;
        }
      }

      event.preventDefault();
      handleRailToggle();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleRailToggle]);

  // Desktop rail is active only when the preference is set; mobile drawer state
  // is independent. The CSS gates rail styling to ≥768px, so applying the class
  // unconditionally is safe (it is inert on mobile).
  const isRail = sidebarCollapsed;

  // ── Mobile drawer focus management ──
  // When the off-canvas drawer opens, move focus into it, trap Tab within it,
  // close on Escape, and restore focus to the hamburger on close. This only
  // engages while the drawer is open (mobile); desktop is unaffected.
  useEffect(() => {
    if (!sidebarOpen) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    const focusables = () =>
      Array.from(
        sidebar.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);

    focusables()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSidebarOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  // Restore focus to the hamburger after the drawer closes (mobile only).
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !sidebarOpen) {
      hamburgerRef.current?.focus();
    }
    wasOpenRef.current = sidebarOpen;
  }, [sidebarOpen]);

  return (
    <TooltipProvider>
      <a href="#main-content" className={styles.skipLink} onClick={handleSkipToContent}>
        Skip to main content
      </a>
      <div className={styles.layout}>
        {/* Mobile overlay */}
        <div
          className={`${styles.overlay} ${sidebarOpen ? styles.overlayVisible : ''}`}
          onClick={closeSidebar}
          aria-hidden="true"
        />

        {/* Polite live region announcing rail collapse/expand. Covers the `[`
            shortcut path where the toggle button is not focused. */}
        <div className={styles.srOnly} role="status" aria-live="polite">
          {railAnnouncement}
        </div>

        {/* Sidebar */}
        <aside
          ref={sidebarRef}
          className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''} ${
            isRail ? styles.sidebarRail : ''
          }`}
          aria-label="Main navigation"
          onTransitionEnd={handleSidebarTransitionEnd}
        >
          <div className={styles.brandArea}>
            <RailTooltip active={isRail} label="CPAP Analyzer">
              <NavLink
                to="/"
                end
                className={styles.brand}
                aria-label="CPAP Analyzer — go to Dashboard"
                onClick={closeSidebar}
              >
                <Icon name="brand" size="lg" className={styles.brandMark} />
                <span className={styles.wordmark} aria-hidden="true">
                  <span className={styles.wordmarkPrimary}>CPAP</span>
                  <span className={styles.wordmarkSecondary}>Analyzer</span>
                </span>
                {/* Contiguous text for screen readers and text-based selectors;
                    the visible wordmark above is split for two-tone styling and
                    is aria-hidden, so this provides one clean "CPAP Analyzer"
                    node. */}
                <span className={styles.srOnly}>CPAP Analyzer</span>
              </NavLink>
            </RailTooltip>
          </div>

          {/* Single navigation landmark: scrollable groups plus a pinned
              footer region (Help / Settings). Keeping one <nav> means e2e
              `getByRole('navigation')` resolves unambiguously and all six
              section links plus Help/Settings live inside it. */}
          <nav className={styles.nav} aria-label="Primary">
            <div className={styles.navGroups}>
              <NavGroup
                label="Analysis"
                items={ANALYSIS_ITEMS}
                isRail={isRail}
                onNavigate={closeSidebar}
              />
              <NavGroup label="Data" items={DATA_ITEMS} isRail={isRail} onNavigate={closeSidebar} />
            </div>

            <div className={styles.sidebarFooter}>
              <ul className={styles.navList}>
                {FOOTER_ITEMS.map((item) => (
                  <li key={item.to}>
                    <NavItemLink item={item} isRail={isRail} onNavigate={closeSidebar} />
                  </li>
                ))}
              </ul>

              {/* Dedicated desktop-only rail toggle, pinned below Help/Settings.
                  Distinct from the mobile hamburger (which is hidden ≥768px), so
                  the two never coexist. */}
              <RailTooltip active={isRail} label={isRail ? 'Expand sidebar' : 'Collapse sidebar'}>
                <button
                  type="button"
                  className={styles.railToggle}
                  onClick={handleRailToggle}
                  aria-pressed={isRail}
                  aria-label={isRail ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                  {/* Swap the icon by state (no CSS rotation): chevron points
                      left when expanded (collapse-ward) and right when in rail
                      (expand-ward). */}
                  <Icon
                    name={isRail ? 'chevron-right' : 'chevron-left'}
                    size="md"
                    className={styles.railToggleIcon}
                  />
                  <span className={styles.railToggleLabel}>Collapse</span>
                </button>
              </RailTooltip>
            </div>
          </nav>
        </aside>

        {/* Content area */}
        <div className={`${styles.content} ${isRail ? styles.contentRail : ''}`}>
          <header className={styles.header}>
            <div className={styles.headerLeft}>
              <button
                ref={hamburgerRef}
                type="button"
                className={styles.menuToggle}
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={sidebarOpen}
              >
                <Icon name={sidebarOpen ? 'close' : 'menu'} size="md" />
              </button>
              {/* Non-heading element: avoids competing with view <h1>s for the
                  heading role (e2e selectors target view headings). */}
              <span className={styles.sectionTitle} aria-live="polite">
                {sectionTitle}
              </span>
            </div>
            <div className={styles.headerRight}>
              <ThemeMenu />
            </div>
          </header>
          <main id="main-content" className={styles.main} ref={mainRef} tabIndex={-1}>
            <RouteErrorBoundary resetKeys={[location.pathname]}>
              <Outlet />
            </RouteErrorBoundary>
          </main>
          <StatusBar />
        </div>
      </div>
    </TooltipProvider>
  );
}
