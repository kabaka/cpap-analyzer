import { useState, useCallback } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAppStore } from '@/stores/useAppStore';
import { useThemeEffect } from '@/hooks/useTheme';
import { useURLStateSync } from '@/hooks/useURLState';
import { RouteErrorBoundary } from '@/components/errors';
import { TooltipProvider } from '@/components/ui';
import { StatusBar } from './StatusBar';
import styles from './RootLayout.module.css';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/sessions', label: 'Sessions', icon: '📋' },
  { to: '/trends', label: 'Trends', icon: '📈' },
  { to: '/analysis', label: 'Analysis', icon: '🔬' },
  { to: '/reports', label: 'Reports', icon: '📄' },
  { to: '/data', label: 'Data', icon: '💾' },
];

export default function RootLayout() {
  useURLStateSync();
  useThemeEffect();

  const theme = useAppStore((s) => s.theme);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const setTheme = useAppStore((s) => s.setTheme);
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const cycleTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
  }, [theme, setTheme]);

  return (
    <TooltipProvider>
      <div className={styles.layout}>
        {/* Mobile overlay */}
        <div
          className={`${styles.overlay} ${sidebarOpen ? styles.overlayVisible : ''}`}
          onClick={closeSidebar}
          aria-hidden="true"
        />

        {/* Sidebar */}
        <aside
          className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}
          aria-label="Main navigation"
        >
          <div className={styles.sidebarHeader}>
            <span className={styles.logo}>CPAP Analyzer</span>
          </div>
          <nav className={styles.nav}>
            <ul className={styles.navList}>
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                    }
                    onClick={closeSidebar}
                  >
                    <span className={styles.navIcon} aria-hidden="true">
                      {item.icon}
                    </span>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* Content area */}
        <div className={styles.content}>
          <header className={styles.header}>
            <div className={styles.headerActions}>
              <button
                className={styles.menuToggle}
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={sidebarOpen}
              >
                ☰
              </button>
              <span className={styles.headerTitle}>CPAP Analyzer</span>
            </div>
            <nav className={styles.utilityNav} aria-label="Utility navigation">
              <NavLink to="/help" className={styles.utilityButton} aria-label="Help">
                ?
              </NavLink>
              <NavLink to="/settings" className={styles.utilityButton} aria-label="Settings">
                ⚙
              </NavLink>
              <button
                className={styles.themeToggle}
                onClick={cycleTheme}
                aria-label={`Switch theme (current: ${theme})`}
              >
                {resolvedTheme === 'dark' ? '☀️' : '🌙'}
              </button>
            </nav>
          </header>
          <main className={styles.main}>
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
