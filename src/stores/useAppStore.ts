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

  // Sidebar collapsed/rail preference (persisted to localStorage). Desktop only;
  // the mobile off-canvas drawer ignores this. Default: expanded (false).
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;

  // ⌘K command palette open state. EPHEMERAL — deliberately excluded from
  // `partialize` so it never persists across reloads (the palette always boots
  // closed). Toggled by the ⌘K/Ctrl+K global shortcut and the header trigger.
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // Import wizard modal open state. EPHEMERAL — like `commandPaletteOpen`, kept
  // out of `partialize` so it never persists across reloads (the wizard always
  // boots closed). This is a pure UI/shell flag written by React affordances
  // (the header Import button + the Data-page buttons) — deliberately NOT in
  // `useImportStore`, whose invariant is "the ImportController is the only
  // writer". The wizard reads job progress from `useImportStore`; this flag only
  // governs whether the modal is mounted.
  importWizardOpen: boolean;
  setImportWizardOpen: (open: boolean) => void;

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
        setTheme: (theme) => {
          const resolvedTheme = resolveTheme(theme);
          // Apply `data-theme` to <html> SYNCHRONOUSLY here — before `set()` triggers the
          // subscriber re-render. Chart colours are read from `getComputedStyle` during
          // render (`useChartColors`); `useThemeEffect` applies the attribute in a passive
          // effect that runs AFTER that read, so on a theme TOGGLE the colour read would
          // otherwise resolve the OUTGOING theme's tokens and — since `resolvedTheme` does
          // not change again — stay stale (the Trends canvas charts repainted with the
          // previous theme's colours). Setting it here guarantees the toggle re-render
          // reads the incoming theme. `useThemeEffect` remains the source of truth for the
          // OS-preference listener and re-applies the same value harmlessly. No-op in SSR.
          if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-theme', resolvedTheme);
          }
          set({ theme, resolvedTheme }, undefined, 'setTheme');
        },

        // Sidebar collapsed/rail preference — default expanded
        sidebarCollapsed: false,
        setSidebarCollapsed: (collapsed) =>
          set({ sidebarCollapsed: collapsed }, undefined, 'setSidebarCollapsed'),
        toggleSidebarCollapsed: () =>
          set(
            (state) => ({ sidebarCollapsed: !state.sidebarCollapsed }),
            undefined,
            'toggleSidebarCollapsed',
          ),

        // Command palette — ephemeral, always boots closed.
        commandPaletteOpen: false,
        setCommandPaletteOpen: (open) =>
          set({ commandPaletteOpen: open }, undefined, 'setCommandPaletteOpen'),

        // Import wizard modal — ephemeral, always boots closed.
        importWizardOpen: false,
        setImportWizardOpen: (open) =>
          set({ importWizardOpen: open }, undefined, 'setImportWizardOpen'),

        // Import state
        importStatus: 'idle',
        importProgress: { current: 0, total: 0 },
        setImportStatus: (status) => set({ importStatus: status }, undefined, 'setImportStatus'),
        setImportProgress: (progress) =>
          set({ importProgress: progress }, undefined, 'setImportProgress'),
      }),
      {
        name: THEME_STORAGE_KEY,
        partialize: (state) => ({
          theme: state.theme,
          sidebarCollapsed: state.sidebarCollapsed,
        }),
        merge: (persisted, current) => {
          const stored = persisted as { theme?: Theme; sidebarCollapsed?: boolean } | undefined;
          const theme =
            stored?.theme === 'light' || stored?.theme === 'dark' || stored?.theme === 'system'
              ? stored.theme
              : current.theme;
          // Backward compatible: older payloads (theme-only) lack this key, so
          // default to expanded (false).
          const sidebarCollapsed =
            typeof stored?.sidebarCollapsed === 'boolean' ? stored.sidebarCollapsed : false;
          return {
            ...current,
            theme,
            resolvedTheme: resolveTheme(theme),
            sidebarCollapsed,
          };
        },
      },
    ),
    { name: 'AppStore', enabled: import.meta.env.DEV },
  ),
);

// Apply the resolved theme to <html> synchronously at module load — BEFORE React's
// first render. `useThemeEffect` (RootLayout) keeps `data-theme` in sync afterward,
// but it runs in a passive effect that lands AFTER the first paint. Chart colours are
// read via `getComputedStyle` during render (see `useChartColors`); on a cold boot
// straight into a non-default theme those reads would otherwise resolve the light
// `:root` tokens and — because `resolvedTheme` never changes on that path — stay stale
// (e.g. the Trends canvas charts painted with light colours until a resize). The store
// has already rehydrated synchronously here, so `getState().resolvedTheme` is the
// fully-resolved (persist-merged) theme; setting the attribute now guarantees the very
// first token read matches it. No-op without a document (SSR/tests); this also removes
// a first-paint theme flash.
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', useAppStore.getState().resolvedTheme);
}
