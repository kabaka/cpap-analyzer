import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeMenu } from '@/components/layouts/ThemeMenu';
import { useAppStore } from '@/stores/useAppStore';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

// Anchored matcher for the System item. Its accessible name is "System (Light)"
// or "System (Dark)", so a loose `/System/` (or `/Light/`) regex can latch onto
// the wrong item — or a stray item left in a lingering portal from a prior test.
// Requiring the resolved-theme suffix makes the match unambiguous.
const SYSTEM_NAME = /^System \((?:Light|Dark)\)$/;

/** Reset the app store to a known baseline so no theme state leaks between tests. */
function resetAppStore() {
  useAppStore.setState({ theme: 'system', resolvedTheme: 'light', setTheme: vi.fn() });
}

/** Seed the real app store with a theme/resolvedTheme pair and a spyable setTheme. */
function seedTheme(
  theme: Theme,
  resolvedTheme: ResolvedTheme = theme === 'dark' ? 'dark' : 'light',
) {
  const setTheme = vi.fn();
  useAppStore.setState({ theme, resolvedTheme, setTheme });
  return setTheme;
}

/** Open the dropdown and return its menu element (Radix renders into a portal). */
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Theme:/ }));
  return screen.findByRole('menu');
}

describe('ThemeMenu', () => {
  beforeEach(() => {
    resetAppStore();
    seedTheme('system', 'light');
  });

  // Unmount any rendered component (and its Radix portal in document.body) and
  // restore the store, so a prior test's menu items can never linger and be
  // matched by a later query.
  afterEach(() => {
    cleanup();
    resetAppStore();
    vi.clearAllMocks();
  });

  describe('trigger', () => {
    it('exposes an accessible name reflecting the active setting', () => {
      seedTheme('dark', 'dark');
      render(<ThemeMenu />);
      expect(screen.getByRole('button', { name: 'Theme: Dark' })).toBeInTheDocument();
    });

    it('labels the trigger from the setting, not the resolved theme', () => {
      // System (resolving to dark) should still read "System", not "Dark".
      seedTheme('system', 'dark');
      render(<ThemeMenu />);
      expect(screen.getByRole('button', { name: 'Theme: System' })).toBeInTheDocument();
    });
  });

  describe('menu contents', () => {
    it('reveals exactly three radio items: Light, Dark and System', async () => {
      const user = userEvent.setup();
      render(<ThemeMenu />);
      const menu = await openMenu(user);

      const items = within(menu).getAllByRole('menuitemradio');
      expect(items).toHaveLength(3);
      // Exact-string names avoid the "System (Light)" item also matching /Light/.
      expect(within(menu).getByRole('menuitemradio', { name: 'Light' })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitemradio', { name: 'Dark' })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitemradio', { name: SYSTEM_NAME })).toBeInTheDocument();
    });

    it('annotates the System item with the currently resolved theme', async () => {
      seedTheme('system', 'dark');
      const user = userEvent.setup();
      render(<ThemeMenu />);
      const menu = await openMenu(user);

      const systemItem = within(menu).getByRole('menuitemradio', { name: SYSTEM_NAME });
      expect(systemItem.textContent).toContain('System');
      expect(systemItem.textContent).toMatch(/\(Dark\)/);
    });

    it('shows the System suffix as (Light) when resolving to light', async () => {
      seedTheme('system', 'light');
      const user = userEvent.setup();
      render(<ThemeMenu />);
      const menu = await openMenu(user);

      const systemItem = within(menu).getByRole('menuitemradio', { name: SYSTEM_NAME });
      expect(systemItem.textContent).toMatch(/\(Light\)/);
    });
  });

  describe('aria-checked reflects the active theme', () => {
    it('checks the System item when theme is system', async () => {
      seedTheme('system', 'light');
      const user = userEvent.setup();
      render(<ThemeMenu />);
      const menu = await openMenu(user);

      expect(within(menu).getByRole('menuitemradio', { name: SYSTEM_NAME })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(within(menu).getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      expect(within(menu).getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });

    it('checks the Light item when theme is light', async () => {
      seedTheme('light', 'light');
      const user = userEvent.setup();
      render(<ThemeMenu />);
      const menu = await openMenu(user);

      expect(within(menu).getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });
  });

  describe('selection', () => {
    it('calls setTheme("dark") when the Dark item is chosen', async () => {
      const setTheme = seedTheme('system', 'light');
      const user = userEvent.setup();
      render(<ThemeMenu />);
      const menu = await openMenu(user);

      await user.click(within(menu).getByRole('menuitemradio', { name: 'Dark' }));
      expect(setTheme).toHaveBeenCalledWith('dark');
    });

    it('calls setTheme("light") when the Light item is chosen', async () => {
      const setTheme = seedTheme('dark', 'dark');
      const user = userEvent.setup();
      render(<ThemeMenu />);
      const menu = await openMenu(user);

      await user.click(within(menu).getByRole('menuitemradio', { name: 'Light' }));
      expect(setTheme).toHaveBeenCalledWith('light');
    });

    it('calls setTheme("system") when the System item is chosen', async () => {
      const setTheme = seedTheme('light', 'light');
      const user = userEvent.setup();
      render(<ThemeMenu />);
      const menu = await openMenu(user);

      await user.click(within(menu).getByRole('menuitemradio', { name: SYSTEM_NAME }));
      expect(setTheme).toHaveBeenCalledWith('system');
    });
  });
});
