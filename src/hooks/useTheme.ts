import { useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';

const MEDIA_QUERY = '(prefers-color-scheme: dark)';

/**
 * Side-effect hook that keeps `data-theme` and `resolvedTheme` in sync.
 *
 * - Listens for OS color-scheme preference changes via `matchMedia`
 * - Updates the store's `resolvedTheme` when the OS preference changes and theme is 'system'
 * - Sets `data-theme` attribute on `document.documentElement`
 *
 * Call once in RootLayout.
 */
export function useThemeEffect(): void {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const setTheme = useAppStore((s) => s.setTheme);

  // Listen for OS color-scheme changes and re-resolve when theme is 'system'
  useEffect(() => {
    const mql = window.matchMedia(MEDIA_QUERY);

    function handleChange() {
      // Re-trigger resolution by re-setting the current theme value
      const currentTheme = useAppStore.getState().theme;
      if (currentTheme === 'system') {
        setTheme('system');
      }
    }

    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [setTheme]);

  // Apply data-theme attribute to the document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);
}
