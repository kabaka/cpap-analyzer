import { useState, useCallback, useEffect, useRef, type MouseEvent } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useThemeEffect } from '@/hooks/useTheme';
import { useURLStateSync } from '@/hooks/useURLState';
import { RouteErrorBoundary } from '@/components/errors';
import { TooltipProvider, Icon, type IconName } from '@/components/ui';
import { StatusBar } from './StatusBar';
import { ThemeMenu } from './ThemeMenu';
import styles from './RootLayout.module.css';

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

function NavGroup({
  label,
  items,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
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
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
              }
              onClick={onNavigate}
            >
              <Icon name={item.icon} size="lg" className={styles.navIcon} />
              <span className={styles.navLabel}>{item.label}</span>
            </NavLink>
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

  const sidebarRef = useRef<HTMLElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

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

        {/* Sidebar */}
        <aside
          ref={sidebarRef}
          className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}
          aria-label="Main navigation"
        >
          <div className={styles.brandArea}>
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
                  the visible wordmark above is split for two-tone styling and is
                  aria-hidden, so this provides one clean "CPAP Analyzer" node. */}
              <span className={styles.srOnly}>CPAP Analyzer</span>
            </NavLink>
          </div>

          {/* Single navigation landmark: scrollable groups plus a pinned
              footer region (Help / Settings). Keeping one <nav> means e2e
              `getByRole('navigation')` resolves unambiguously and all six
              section links plus Help/Settings live inside it. */}
          <nav className={styles.nav} aria-label="Primary">
            <div className={styles.navGroups}>
              <NavGroup label="Analysis" items={ANALYSIS_ITEMS} onNavigate={closeSidebar} />
              <NavGroup label="Data" items={DATA_ITEMS} onNavigate={closeSidebar} />
            </div>

            <div className={styles.sidebarFooter}>
              <ul className={styles.navList}>
                {FOOTER_ITEMS.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                      }
                      onClick={closeSidebar}
                    >
                      <Icon name={item.icon} size="lg" className={styles.navIcon} />
                      <span className={styles.navLabel}>{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </aside>

        {/* Content area */}
        <div className={styles.content}>
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
