import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'cpap-theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

function getOsPreference(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? getOsPreference() : theme;
}

interface AppState {
  // Date range selection
  dateRange: { start: Date; end: Date };
  setDateRange: (range: { start: Date; end: Date }) => void;

  // Currently selected session
  selectedSessionId: string | null;
  setSelectedSession: (id: string | null) => void;

  // Theme preference (persisted to localStorage)
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;

  // Import state
  importStatus: 'idle' | 'scanning' | 'importing' | 'complete' | 'error';
  importProgress: { current: number; total: number };
  setImportStatus: (status: AppState['importStatus']) => void;
  setImportProgress: (progress: { current: number; total: number }) => void;
}

function defaultDateRange(): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { start, end };
}

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // localStorage may be unavailable
  }
  return 'system';
}

const initialTheme = getInitialTheme();

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set) => ({
        // Date range — last 30 days
        dateRange: defaultDateRange(),
        setDateRange: (range) => set({ dateRange: range }, undefined, 'setDateRange'),

        // Selected session
        selectedSessionId: null,
        setSelectedSession: (id) => set({ selectedSessionId: id }, undefined, 'setSelectedSession'),

        // Theme
        theme: initialTheme,
        resolvedTheme: resolveTheme(initialTheme),
        setTheme: (theme) =>
          set({ theme, resolvedTheme: resolveTheme(theme) }, undefined, 'setTheme'),

        // Import state
        importStatus: 'idle',
        importProgress: { current: 0, total: 0 },
        setImportStatus: (status) => set({ importStatus: status }, undefined, 'setImportStatus'),
        setImportProgress: (progress) =>
          set({ importProgress: progress }, undefined, 'setImportProgress'),
      }),
      {
        name: THEME_STORAGE_KEY,
        partialize: (state) => ({ theme: state.theme }),
        merge: (persisted, current) => {
          const stored = persisted as { theme?: Theme } | undefined;
          const theme =
            stored?.theme === 'light' || stored?.theme === 'dark' || stored?.theme === 'system'
              ? stored.theme
              : current.theme;
          return {
            ...current,
            theme,
            resolvedTheme: resolveTheme(theme),
          };
        },
      },
    ),
    { name: 'AppStore', enabled: import.meta.env.DEV },
  ),
);
