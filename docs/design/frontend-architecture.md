# Frontend Architecture — CPAP Analyzer

**Version**: 1.0  
**Last Updated**: February 10, 2026  
**Status**: Architecture Decision Record  
**Audience**: Frontend Agent, Implementation Specialists, Architecture Review

## Executive Summary

This document defines the complete frontend architecture for CPAP Analyzer, a client-side clinical data analysis application. The architecture prioritizes **performance with large datasets**, **privacy by design**, **developer simplicity for AI agents**, and **type safety** while adhering to the project's zero-server constraint.

### Key Architectural Decisions

- **Framework**: React 18+ with TypeScript strict mode
- **State Management**: Zustand for global state, React Context for component trees
- **Routing**: React Router v6
- **Build Tool**: Vite with optimized chunking strategy
- **Component Strategy**: Custom components built on Radix UI primitives
- **CSS Strategy**: CSS Modules with design tokens as CSS custom properties
- **Web Workers**: Comlink for typed worker communication
- **Service Worker**: Workbox for PWA capabilities and offline support
- **Testing**: Vitest for unit tests, Playwright for E2E tests

---

## 1. Framework Selection

### 1.1 Recommendation: React 18+

**Rationale**:

1. **Performance with Large Datasets**:
   - React 18's concurrent features enable time-slicing for expensive renders
   - `useDeferredValue` and `useTransition` for non-blocking updates during data exploration
   - Stable, well-understood performance optimization patterns (memo, useMemo, useCallback)

2. **TypeScript Support**:
   - Excellent type inference for props, hooks, and context
   - Mature ecosystem with comprehensive type definitions
   - AI agents can leverage well-documented patterns

3. **Bundle Size**:
   - React + React-DOM: ~45KB gzipped (acceptable for a data-heavy application)
   - Tree-shaking support via ES modules
   - No unnecessary features we won't use

4. **State Management Options**:
   - Multiple proven solutions (Context, Zustand, Jotai) that work seamlessly with React
   - Easy to reason about data flow for AI agent development

5. **Community/Ecosystem**:
   - Largest ecosystem for charting libraries (Recharts, Victory, D3 + React)
   - Extensive documentation and examples
   - AI training data heavily weighted toward React patterns

6. **AI Agent Development**:
   - Predictable component patterns
   - Clear separation of concerns (props in, events out)
   - Well-documented best practices
   - Strong conventions reduce decision paralysis

**Alternatives Considered**:

- **Vue 3**: Excellent performance, but smaller ecosystem for data visualization libraries. AI training data less comprehensive.
- **Svelte**: Smallest bundle size and fastest runtime, but immature TypeScript support and limited charting ecosystem. More magical compilation step adds complexity for AI agents.
- **Solid.js**: Excellent performance, but very small ecosystem and limited AI training data. High risk for AI agent development.
- **Vanilla TypeScript**: Maximum control, but requires building all UI primitives from scratch. Prohibitive development time.

**Decision**: React 18+ strikes the optimal balance of performance, ecosystem maturity, TypeScript support, and AI agent familiarity.

---

## 2. UI Component Library

### 2.1 Recommendation: Custom Components on Radix UI Primitives

**Architecture**:

```
┌──────────────────────────────────────────────┐
│ Application Components                       │
│ (Dashboard, SessionDetail, SignalViewer)     │
└──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│ Design System Components                     │
│ (Button, Input, Modal, Card, Table)          │
│ Custom styled to match ui-design-system.md   │
└──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│ Radix UI Primitives (Headless)               │
│ (@radix-ui/react-dialog, dropdown-menu, etc.)│
│ Provides accessibility, keyboard nav, ARIA   │
└──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│ React 18 + DOM                               │
└──────────────────────────────────────────────┘
```

**Radix UI Primitives to Use**:

| Component     | Radix Package                   | Purpose                                |
| ------------- | ------------------------------- | -------------------------------------- |
| Modal/Dialog  | `@radix-ui/react-dialog`        | Import wizard, settings, confirmations |
| Dropdown Menu | `@radix-ui/react-dropdown-menu` | Date range presets, chart options      |
| Tooltip       | `@radix-ui/react-tooltip`       | Metric definitions, help icons         |
| Select        | `@radix-ui/react-select`        | Analysis method selection              |
| Tabs          | `@radix-ui/react-tabs`          | Navigation, help content sections      |
| Accordion     | `@radix-ui/react-accordion`     | Collapsible settings, help sections    |
| Popover       | `@radix-ui/react-popover`       | Advanced chart controls                |
| Switch        | `@radix-ui/react-switch`        | Theme toggle, settings toggles         |
| Slider        | `@radix-ui/react-slider`        | Date range selection, zoom controls    |

**Rationale**:

1. **Accessibility Built-In**:
   - Radix handles ARIA attributes, keyboard navigation, focus management
   - Meets WCAG AA requirements out of the box
   - Reduces accessibility bugs from AI-generated code

2. **Full Design Control**:
   - Unstyled primitives allow exact implementation of ui-design-system.md
   - No CSS framework to fight against
   - Complete control over theming

3. **Small Bundle Size**:
   - Tree-shakeable (only import what you use)
   - Each primitive is 2-5KB gzipped
   - Total for all primitives: ~20KB

4. **TypeScript First**:
   - Excellent type definitions
   - Type-safe props and callbacks
   - Strong inference for AI agents

5. **Testing-Friendly**:
   - Standard component testing patterns work
   - No magic or framework-specific testing utilities needed

**Alternatives Considered**:

- **shadcn/ui**: Pre-built components with Radix + Tailwind. Rejected because Tailwind adds unnecessary complexity (see CSS strategy).
- **Material UI / Ant Design**: Full component libraries. Rejected because they enforce their own design language and are difficult to fully customize. Large bundle size.
- **Headless UI**: Similar to Radix. Rejected because Radix has better TypeScript support and more comprehensive primitive set.
- **Pure custom components**: Maximum control but requires implementing all accessibility from scratch. High bug risk.

**Decision**: Radix UI primitives provide the optimal foundation for accessible, custom-styled components.

---

## 3. State Management

### 3.1 Recommendation: Zustand + React Context

**Strategy**:

- **Zustand**: Global application state (date range, selected session, settings, import status)
- **React Context**: Component tree state (modal open/close, form state, local UI state)
- **URL State**: Deep-linkable state (current view, date range, selected session)

**Zustand Stores**:

```typescript
// src/stores/useAppStore.ts
interface AppState {
  // Date range selection (persisted to URL)
  dateRange: { start: Date; end: Date };
  setDateRange: (range: { start: Date; end: Date }) => void;

  // Currently selected session (persisted to URL)
  selectedSessionId: string | null;
  setSelectedSession: (id: string | null) => void;

  // Theme preference (persisted to localStorage)
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;

  // Import state
  importStatus: 'idle' | 'scanning' | 'importing' | 'complete' | 'error';
  importProgress: { current: number; total: number };
  setImportStatus: (status: AppState['importStatus']) => void;
  setImportProgress: (progress: { current: number; total: number }) => void;
}

// src/stores/useSettingsStore.ts
interface SettingsState {
  // Analysis parameters
  analysisParams: {
    ahi: { mildThreshold: number; moderateThreshold: number; severeThreshold: number };
    clustering: { method: 'flg' | 'kmeans' | 'single-link'; minClusterSize: number };
    // ... more parameters
  };
  updateAnalysisParam: (path: string, value: unknown) => void;

  // Display preferences
  display: {
    dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
    timeFormat: '12h' | '24h';
    chartAnimations: boolean;
  };
  updateDisplayPref: (key: string, value: unknown) => void;

  // Integration config
  integrations: {
    fitbit: { enabled: boolean; accessToken: string | null };
    weather: { enabled: boolean; apiKey: string | null; location: string };
    // AI Insights (opt-in, off by default). See `src/types/settings.ts` for the
    // authoritative `LLMIntegrationConfig`; ADR 0024 is the source of truth.
    // A single backend selector (`webllm` | `chrome-ai` | `anthropic` |
    // `openai-compatible`) plus two-gate consent fields (`consentAt`,
    // `consentContractVersion`) for the cloud backends. Backend-specific
    // sub-configs (`webllm`, `anthropic`, `openaiCompatible`) carry model
    // choice and endpoint. API keys are NOT stored here — they live in the
    // session-scoped `useLLMCredentialStore` and never persist to disk.
    llm: LLMIntegrationConfig;
  };
  updateIntegration: (key: string, config: Partial<unknown>) => void;
}

// src/stores/useDataStore.ts
interface DataState {
  // Session metadata cache (loaded from IndexedDB on app start)
  sessions: Map<string, SessionMetadata>;
  loadSessions: (range: { start: Date; end: Date }) => Promise<void>;

  // Summary statistics cache
  summaryStats: {
    range: { start: Date; end: Date };
    stats: SummaryStatistics;
  } | null;
  loadSummaryStats: (range: { start: Date; end: Date }) => Promise<void>;
}
```

**Context Usage**:

```typescript
// For component-local state (modals, forms, etc.)
// src/components/ImportWizard/ImportWizardContext.tsx
interface ImportWizardState {
  step: number;
  selectedPath: string | null;
  detectedSessions: SessionInfo[];
  errors: string[];
}

const ImportWizardContext = createContext<{
  state: ImportWizardState;
  dispatch: React.Dispatch<ImportWizardAction>;
} | null>(null);
```

**URL State Sync**:

```typescript
// src/hooks/useURLState.ts
// Syncs Zustand state to URL search params for deep linking
export function useURLStateSync() {
  const { dateRange, selectedSessionId } = useAppStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Sync URL -> Zustand on mount
  useEffect(() => {
    const rangeStart = searchParams.get('start');
    const rangeEnd = searchParams.get('end');
    const sessionId = searchParams.get('session');

    if (rangeStart && rangeEnd) {
      useAppStore.getState().setDateRange({
        start: new Date(rangeStart),
        end: new Date(rangeEnd),
      });
    }

    if (sessionId) {
      useAppStore.getState().setSelectedSession(sessionId);
    }
  }, []);

  // Sync Zustand -> URL on change (debounced)
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('start', dateRange.start.toISOString());
    params.set('end', dateRange.end.toISOString());
    if (selectedSessionId) {
      params.set('session', selectedSessionId);
    }

    navigate({ search: params.toString() }, { replace: true });
  }, [dateRange, selectedSessionId]);
}
```

**Rationale**:

1. **Zustand Benefits**:
   - Minimal boilerplate (no providers, actions, reducers)
   - Excellent TypeScript inference
   - Built-in middleware for persistence (localStorage)
   - No Context performance issues (direct store access)
   - Simple mental model for AI agents (just hooks)

2. **Context for Local State**:
   - Keeps component trees self-contained
   - Avoids polluting global store with transient UI state
   - Standard React pattern, easy for AI agents

3. **URL State for Deep Linking**:
   - Allows bookmarking specific views
   - Shareable links (though no backend, still useful for user's own bookmarks)
   - Preserves state on page refresh

**Alternatives Considered**:

- **Redux Toolkit**: Too much boilerplate for this application's needs. Overkill.
- **Jotai**: Atomic model adds complexity. Not as well-known to AI agents.
- **MobX**: Requires understanding observables and reactions. More complex mental model.
- **Context-only**: Performance issues with frequent updates (date range changes, chart interactions).

**Decision**: Zustand for global state, Context for local state, URL for deep-linkable state.

---

## 4. Routing

### 4.1 Recommendation: React Router v6

**Route Structure**:

```typescript
// src/router.tsx
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <Dashboard />,
      },
      {
        path: 'sessions',
        children: [
          {
            index: true,
            element: <SessionList />,
          },
          {
            path: ':sessionId',
            element: <SessionDetail />,
            children: [
              {
                path: 'signals',
                element: <SignalViewer />,
              },
            ],
          },
          {
            path: 'compare',
            element: <SessionComparison />,
          },
        ],
      },
      {
        path: 'analysis',
        children: [
          {
            index: true,
            element: <AnalysisHome />,
          },
          {
            path: 'statistical',
            element: <StatisticalAnalysis />,
          },
          {
            path: 'events',
            element: <EventAnalysis />,
          },
          {
            path: 'pressure',
            element: <PressureOptimization />,
          },
          {
            path: 'integrations',
            element: <Integrations />,
          },
        ],
      },
      {
        path: 'reports',
        element: <Reports />,
      },
      {
        path: 'data',
        children: [
          {
            index: true,
            element: <DataManagement />,
          },
          {
            path: 'import',
            element: <ImportWizard />,
          },
        ],
      },
      {
        path: 'settings',
        element: <Settings />,
      },
      {
        path: 'help',
        children: [
          {
            index: true,
            element: <HelpHome />,
          },
          {
            path: ':topic',
            element: <HelpArticle />,
          },
        ],
      },
    ],
  },
]);
```

**Layout Component**:

```typescript
// src/layouts/RootLayout.tsx
export function RootLayout() {
  useURLStateSync(); // Sync URL params to Zustand

  return (
    <div className="app-root" data-theme={theme}>
      <Header />
      <nav className="primary-nav">
        <NavLink to="/">Dashboard</NavLink>
        <NavLink to="/sessions">Sessions</NavLink>
        <NavLink to="/analysis">Analysis</NavLink>
        <NavLink to="/reports">Reports</NavLink>
        <NavLink to="/data">Data</NavLink>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
      <StatusBar />
    </div>
  );
}
```

**Rationale**:

- Standard React routing solution (most AI training data)
- Data router API enables future loader/action patterns if needed
- Nested routes match the application's hierarchical structure
- Type-safe route params with TypeScript

**Alternatives Considered**:

- **TanStack Router**: More type-safe but newer, less AI training data
- **Wouter**: Smaller bundle but less feature-complete
- **No router (manual state)**: Too much complexity for multi-page app

**Decision**: React Router v6 for its maturity and AI agent familiarity.

---

## 5. Build Tooling (Vite Configuration)

### 5.1 Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths(), // Resolve @ imports from tsconfig paths
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst', // Note: We don't use external fonts, but example pattern
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
        ],
      },
      manifest: {
        name: 'CPAP Analyzer',
        short_name: 'CPAP Analyzer',
        description: 'Comprehensive CPAP therapy analysis',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],

  build: {
    target: 'esnext',

    rollupOptions: {
      output: {
        manualChunks: {
          // Core framework
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],

          // State management
          'vendor-state': ['zustand'],

          // UI primitives
          'vendor-ui': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
          ],

          // Data visualization (lazy-loaded)
          'vendor-charts': ['recharts', 'd3-scale', 'd3-shape'],

          // Data processing (loaded in worker)
          // Not bundled with main app
        },
      },
    },

    // Enable source maps for production debugging (can be disabled later)
    sourcemap: true,

    // Increase chunk size warning limit (we have large datasets)
    chunkSizeWarningLimit: 1000,
  },

  // Optimize dependency pre-bundling
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'zustand'],
  },

  // Web Worker support
  worker: {
    format: 'es',
    plugins: [],
  },

  // Development server config
  server: {
    port: 3000,
    open: true,
  },
});
```

### 5.2 Code Splitting Strategy

**Splitting Points**:

1. **Route-based splitting** (automatic with React.lazy):

   ```typescript
   const SessionDetail = React.lazy(() => import('./views/SessionDetail'));
   const Analysis = React.lazy(() => import('./views/Analysis'));
   ```

2. **Feature-based splitting**:
   - Data visualization library only loaded when rendering charts
   - Report generator only loaded when creating reports
   - LLM integration only loaded when user enables it

3. **Worker-based splitting**:
   - EDF parser runs in worker (separate bundle)
   - Analysis algorithms run in worker (separate bundle)
   - Signal processing run in worker (separate bundle)

**Lazy Loading Pattern**:

```typescript
// src/components/LazyChart.tsx
const Chart = React.lazy(() => import('./Chart'));

export function LazyChart(props: ChartProps) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <Chart {...props} />
    </Suspense>
  );
}
```

---

## 6. Project Structure

```
cpap-analyzer/
├── public/
│   ├── icons/                      # PWA icons
│   ├── manifest.json               # PWA manifest
│   └── robots.txt
│
├── src/
│   ├── assets/                     # Static assets bundled with app
│   │   ├── fonts/                  # None (use system fonts)
│   │   └── images/                 # Logo, illustrations
│   │
│   ├── components/                 # Reusable components
│   │   ├── ui/                     # Design system components
│   │   │   ├── Button/
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Button.module.css
│   │   │   │   ├── Button.test.tsx
│   │   │   │   └── index.ts
│   │   │   ├── Input/
│   │   │   ├── Modal/
│   │   │   ├── Card/
│   │   │   ├── Table/
│   │   │   └── ...
│   │   │
│   │   ├── charts/                 # Chart components
│   │   │   ├── LineChart/
│   │   │   ├── BarChart/
│   │   │   ├── ScatterPlot/
│   │   │   ├── Heatmap/
│   │   │   └── ...
│   │   │
│   │   ├── domain/                 # Domain-specific components
│   │   │   ├── SessionCard/
│   │   │   ├── MetricCard/
│   │   │   ├── EventTimeline/
│   │   │   ├── SignalViewer/
│   │   │   └── ...
│   │   │
│   │   └── layouts/                # Layout components
│   │       ├── RootLayout/
│   │       ├── DashboardLayout/
│   │       └── ...
│   │
│   ├── views/                      # Page-level components
│   │   ├── Dashboard/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Dashboard.module.css
│   │   │   ├── Dashboard.test.tsx
│   │   │   └── components/         # View-specific components
│   │   │       ├── SummaryCards.tsx
│   │   │       ├── TrendCharts.tsx
│   │   │       └── SessionTable.tsx
│   │   ├── SessionDetail/
│   │   ├── Analysis/
│   │   ├── Reports/
│   │   ├── DataManagement/
│   │   ├── Settings/
│   │   └── Help/
│   │
│   ├── services/                   # Business logic & API layer
│   │   ├── storage/                # Storage abstraction
│   │   │   ├── IndexedDBService.ts # Session metadata, settings
│   │   │   ├── OPFSService.ts      # Signal data
│   │   │   └── CacheService.ts     # In-memory cache
│   │   │
│   │   ├── workers/                # Web Worker management
│   │   │   ├── edfParser.worker.ts
│   │   │   ├── analysis.worker.ts
│   │   │   ├── signalProcessor.worker.ts
│   │   │   └── WorkerPool.ts       # Worker thread pool
│   │   │
│   │   ├── plugins/                # Plugin system
│   │   │   ├── PluginRegistry.ts
│   │   │   ├── machines/           # Machine plugins
│   │   │   │   ├── ResMedPlugin.ts
│   │   │   │   └── ...
│   │   │   ├── analysis/           # Analysis plugins
│   │   │   ├── visualization/      # Viz plugins
│   │   │   ├── integration/        # External integrations
│   │   │   └── export/             # Export plugins
│   │   │
│   │   ├── import/                 # Data import pipeline
│   │   │   ├── ImportService.ts
│   │   │   ├── EDFParser.ts
│   │   │   ├── SessionDetector.ts
│   │   │   └── ChunkWriter.ts
│   │   │
│   │   ├── analysis/               # Analysis algorithms
│   │   │   ├── descriptive.ts
│   │   │   ├── timeSeries.ts
│   │   │   ├── correlation.ts
│   │   │   ├── clustering.ts
│   │   │   └── ...
│   │   │
│   │   ├── integrations/           # External service integrations
│   │   │   ├── FitbitService.ts
│   │   │   └── WeatherService.ts
│   │   │
│   │   └── llm/                     # AI Insights (compute-then-narrate; ADR 0024)
│   │       ├── types.ts            # Backend-agnostic LLMProvider interface
│   │       ├── runInsight.ts       # Orchestrates build → prompt → generate → validate
│   │       ├── context/            # buildGroundedContext + redaction serializer
│   │       ├── grounding/          # Prompt assembler + numeral-extraction validator
│   │       └── providers/          # webllm, chrome-ai, anthropic, openai-compatible
│   │
│   ├── stores/                     # Zustand stores
│   │   ├── useAppStore.ts
│   │   ├── useSettingsStore.ts
│   │   ├── useDataStore.ts
│   │   └── index.ts
│   │
│   ├── hooks/                      # Custom React hooks
│   │   ├── useURLState.ts
│   │   ├── useSession.ts
│   │   ├── useSummaryStats.ts
│   │   ├── useSignalData.ts
│   │   ├── useAnalysis.ts
│   │   └── ...
│   │
│   ├── utils/                      # Utility functions
│   │   ├── date.ts                 # Date formatting, parsing
│   │   ├── number.ts               # Number formatting, precision
│   │   ├── clinical.ts             # Clinical calculations (AHI, etc.)
│   │   ├── validation.ts           # Input validation
│   │   └── ...
│   │
│   ├── types/                      # TypeScript type definitions
│   │   ├── session.ts              # Session metadata types
│   │   ├── signal.ts               # Signal data types
│   │   ├── analysis.ts             # Analysis result types
│   │   ├── settings.ts             # Settings types
│   │   ├── plugin.ts               # Plugin interface types
│   │   └── ...
│   │
│   ├── styles/                     # Global styles
│   │   ├── tokens.css              # Design tokens (from ui-design-system.md)
│   │   ├── reset.css               # CSS reset
│   │   ├── base.css                # Base styles
│   │   ├── theme-light.css         # Light theme overrides
│   │   ├── theme-dark.css          # Dark theme overrides
│   │   └── utilities.css           # Utility classes
│   │
│   ├── router.tsx                  # Route configuration
│   ├── App.tsx                     # Root component
│   ├── main.tsx                    # Entry point
│   └── vite-env.d.ts               # Vite type definitions
│
├── tests/                          # Test files
│   ├── unit/                       # Vitest unit tests
│   ├── integration/                # Vitest integration tests
│   └── e2e/                        # Playwright E2E tests
│       ├── specs/
│       └── fixtures/
│
├── .github/                        # GitHub configuration
│   ├── agents/                     # Agent instructions
│   ├── skills/                     # Agent skills
│   └── workflows/                  # CI/CD workflows
│
├── docs/                           # Documentation
├── vite.config.ts                  # Vite configuration
├── tsconfig.json                   # TypeScript configuration
├── tsconfig.node.json              # TypeScript for build tools
├── vitest.config.ts                # Vitest configuration
├── playwright.config.ts            # Playwright configuration
├── package.json                    # Dependencies
├── .prettierrc                     # Prettier config
├── .eslintrc.json                  # ESLint config
└── README.md                       # Project README
```

---

## 7. Component Architecture

### 7.1 Component Composition Pattern

**Principle**: Components should be small, focused, and composable. Follow the "container/presentational" pattern where appropriate.

**Example: SessionCard**

```typescript
// src/components/domain/SessionCard/SessionCard.tsx
import { Card } from '@/components/ui/Card';
import { format } from '@/utils/date';
import { formatNumber } from '@/utils/number';
import type { SessionMetadata } from '@/types/session';
import styles from './SessionCard.module.css';

interface SessionCardProps {
  session: SessionMetadata;
  selected?: boolean;
  onClick?: (sessionId: string) => void;
}

export function SessionCard({ session, selected, onClick }: SessionCardProps) {
  const handleClick = () => {
    onClick?.(session.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.(session.id);
    }
  };

  return (
    <Card
      className={cn(styles.sessionCard, selected && styles.selected)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
    >
      <div className={styles.header}>
        <time className={styles.date}>
          {format(session.startTime, 'MMMM d, yyyy')}
        </time>
        <StatusBadge severity={getAHISeverity(session.ahi)} />
      </div>

      <div className={styles.metrics}>
        <Metric label="AHI" value={formatNumber(session.ahi, 1)} />
        <Metric label="Usage" value={formatDuration(session.usage)} />
        <Metric label="Leak" value={`${formatNumber(session.leak95, 0)} L/min`} />
      </div>

      {session.notes && (
        <div className={styles.notes} aria-label="Session notes">
          {session.notes}
        </div>
      )}
    </Card>
  );
}

// Sub-components

interface MetricProps {
  label: string;
  value: string;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className={styles.metric}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  );
}
```

### 7.2 Prop Handling and Typing

**Principles**:

- Always use explicit interfaces for props (no inline types)
- Use TypeScript's utility types (Partial, Pick, Omit) for prop composition
- Prefer composition over configuration (many focused props over one config object)
- Use discriminated unions for conditional props

**Example: Conditional Props with Discriminated Union**

```typescript
// Either provide data OR a loading state, but not both
type ChartProps =
  | {
      status: 'loading';
      data?: never;
    }
  | {
      status: 'success';
      data: ChartDataPoint[];
    }
  | {
      status: 'error';
      error: string;
    };

function Chart(props: ChartProps) {
  if (props.status === 'loading') {
    return <ChartSkeleton />;
  }

  if (props.status === 'error') {
    return <ErrorMessage message={props.error} />;
  }

  return <ChartRenderer data={props.data} />;
}
```

### 7.3 Event Handling

**Principles**:

- Event handlers are always optional props (suffix with `?`)
- Name event handlers with `on` prefix (`onClick`, `onSubmit`, `onChange`)
- Pass minimal data in event callbacks (IDs, not full objects)
- Use keyboard event handlers for accessibility

**Example**:

```typescript
interface TableRowProps {
  session: SessionMetadata;
  onSelect?: (sessionId: string) => void;
  onEdit?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
}

function TableRow({ session, onSelect, onEdit, onDelete }: TableRowProps) {
  const handleClick = () => {
    onSelect?.(session.id);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click
    onEdit?.(session.id);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(session.id);
  };

  return (
    <tr onClick={handleClick} className={styles.row}>
      <td>{format(session.date)}</td>
      <td>{session.ahi}</td>
      <td>
        <IconButton icon="edit" onClick={handleEditClick} aria-label="Edit session" />
        <IconButton icon="delete" onClick={handleDeleteClick} aria-label="Delete session" />
      </td>
    </tr>
  );
}
```

### 7.4 Form Management

**Strategy**: Use controlled components with React Hook Form for complex forms, plain React state for simple forms.

**Example: Settings Form with React Hook Form**

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  dateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']),
  analysisParams: z.object({
    mildThreshold: z.number().min(0).max(100),
    moderateThreshold: z.number().min(0).max(100),
    severeThreshold: z.number().min(0).max(100),
  }),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

export function SettingsForm() {
  const { settings, updateSettings } = useSettingsStore();

  const { register, handleSubmit, formState: { errors } } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: settings,
  });

  const onSubmit = (data: SettingsFormData) => {
    updateSettings(data);
    // Show success toast
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Select
        label="Theme"
        {...register('theme')}
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
          { value: 'system', label: 'System' },
        ]}
        error={errors.theme?.message}
      />

      <Input
        label="Mild AHI Threshold"
        type="number"
        {...register('analysisParams.mildThreshold', { valueAsNumber: true })}
        error={errors.analysisParams?.mildThreshold?.message}
      />

      {/* More fields... */}

      <Button type="submit">Save Settings</Button>
    </form>
  );
}
```

**Dependencies**:

- `react-hook-form`: Form state management, validation
- `zod`: Schema validation with TypeScript inference

### 7.5 Error Boundaries

**Strategy**: Wrap each major view in an error boundary. Provide fallback UI with error details and recovery action.

```typescript
// src/components/ErrorBoundary/ErrorBoundary.tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, resetError: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
    // Could send to error tracking service here (if user opts in)
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.resetError);
      }

      return (
        <div className={styles.errorBoundary}>
          <h2>Something went wrong</h2>
          <details>
            <summary>Error details</summary>
            <pre>{this.state.error.message}</pre>
            <pre>{this.state.error.stack}</pre>
          </details>
          <Button onClick={this.resetError}>Try Again</Button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

**Usage**:

```typescript
// src/router.tsx
{
  path: 'analysis',
  element: (
    <ErrorBoundary>
      <Analysis />
    </ErrorBoundary>
  ),
}
```

---

## 8. Web Workers

### 8.1 Worker Architecture

**Strategy**: Use Comlink for type-safe worker communication. Create a worker pool for parallel processing.

**Worker Types**:

1. **EDF Parser Worker**: Parses EDF files, converts to internal format
2. **Analysis Worker**: Runs statistical analyses, clustering algorithms
3. **Signal Processor Worker**: Downsampling, signal smoothing, FFT

**Example: EDF Parser Worker with Comlink**

```typescript
// src/services/workers/edfParser.worker.ts
import { expose } from 'comlink';
import { parseEDF } from '../import/EDFParser';
import type { EDFFile, ParsedSession } from '@/types/session';

const edfParserWorker = {
  async parseEDFFile(fileBuffer: ArrayBuffer): Promise<ParsedSession> {
    const edf = await parseEDF(fileBuffer);

    return {
      header: edf.header,
      signals: edf.signals,
      events: edf.events,
      metadata: edf.metadata,
    };
  },

  async validateEDFHeader(headerBuffer: ArrayBuffer): Promise<{
    valid: boolean;
    error?: string;
  }> {
    try {
      // Validate header structure
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  },
};

expose(edfParkerWorker;

export type EDFParserWorker = typeof edfParserWorker;
```

**Worker Pool Manager**:

```typescript
// src/services/workers/WorkerPool.ts
import { wrap, type Remote } from 'comlink';
import type { EDFParserWorker } from './edfParser.worker';

export class WorkerPool<T> {
  private workers: Remote<T>[] = [];
  private availableWorkers: Remote<T>[] = [];
  private queue: Array<{
    task: (worker: Remote<T>) => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }> = [];

  constructor(
    private WorkerClass: new () => Worker,
    private poolSize: number = navigator.hardwareConcurrency || 4,
  ) {
    this.initializeWorkers();
  }

  private initializeWorkers() {
    for (let i = 0; i < this.poolSize; i++) {
      const worker = wrap<T>(new this.WorkerClass());
      this.workers.push(worker);
      this.availableWorkers.push(worker);
    }
  }

  async execute<R>(task: (worker: Remote<T>) => Promise<R>): Promise<R> {
    const worker = this.availableWorkers.pop();

    if (worker) {
      try {
        return await task(worker);
      } finally {
        this.availableWorkers.push(worker);
        this.processQueue();
      }
    }

    // No workers available, add to queue
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
    });
  }

  private processQueue() {
    if (this.queue.length === 0 || this.availableWorkers.length === 0) {
      return;
    }

    const { task, resolve, reject } = this.queue.shift()!;
    const worker = this.availableWorkers.pop()!;

    task(worker)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.availableWorkers.push(worker);
        this.processQueue();
      });
  }

  async terminate() {
    await Promise.all(this.workers.map((worker) => (worker as any)[Symbol.dispose]?.()));
    this.workers = [];
    this.availableWorkers = [];
  }
}

// Create global worker pool instance
export const edfParserPool = new WorkerPool<EDFParserWorker>(
  () => new Worker(new URL('./edfParser.worker.ts', import.meta.url), { type: 'module' }),
);
```

**Usage in Import Service**:

```typescript
// src/services/import/ImportService.ts
import { edfParserPool } from '../workers/WorkerPool';

export class ImportService {
  async importSession(file: File): Promise<void> {
    const arrayBuffer = await file.arrayBuffer();

    // Parse in worker (automatically queued if all workers busy)
    const parsedSession = await edfParserPool.execute((worker) => worker.parseEDFFile(arrayBuffer));

    // Store parsed session
    await this.storeSession(parsedSession);
  }
}
```

**Dependencies**:

- `comlink`: ~2KB, type-safe worker communication
- Built-in Web Workers (no additional library needed)

---

## 9. Service Worker & Offline Strategy

### 9.1 Offline-First Requirements

**Why Service Worker is Critical for CPAP Analyzer**:

1. **Medical Data Reliability**: Patient data analysis cannot depend on network connectivity. Users must be able to analyze therapy data offline, especially during travel or in areas with poor connectivity.

2. **Alignment with Client-Side Architecture**: Service Worker reinforces ADR-0001's client-side-only principle. The app shell and all analysis tools are cached locally, ensuring complete independence from server infrastructure.

3. **Progressive Enhancement**: GitHub Pages serves static assets over HTTPS, meeting Service Worker's secure context requirement. No additional infrastructure needed.

4. **User Experience**: Instant loading on repeat visits eliminates the "loading spinner" experience common in web apps. Analysis sessions resume immediately.

5. **Data Privacy**: Service Worker caches only public assets (HTML, JS, CSS). User data remains exclusively in IndexedDB/OPFS, never in Service Worker caches.

**Architectural Principle**: The Service Worker caches the **application shell** but never touches **user data**. This separation ensures offline functionality while maintaining the privacy-first architecture.

---

### 9.2 Service Worker Responsibilities

The Service Worker manages application assets and offline availability. It does **not** manage user data.

**Core Responsibilities**:

1. **Cache Static Assets**: HTML entry point, JavaScript bundles, CSS stylesheets, fonts, icons
2. **Implement Cache Strategy**: Cache-first for app shell, network-first for index.html
3. **Enable Offline Access**: Serve cached assets when network unavailable
4. **Manage Updates**: Detect new application versions and prompt user to reload
5. **Runtime Caching**: Cache dynamically imported chunks on first use
6. **Cache Invalidation**: Remove old cache versions on activation
7. **Error Handling**: Graceful fallback when caches fail or network unavailable

**Out of Scope** (handled by other layers):

- User data storage (IndexedDB/OPFS via Database Agent)
- Data processing (Web Workers via Performance Agent)
- External API calls (application code manages, Service Worker passes through)

---

### 9.3 Caching Strategy

The caching strategy balances instant loading, update immediacy, and storage efficiency.

#### 9.3.1 Cache Buckets

**1. App Shell** (cache-first, long-lived):

```typescript
// Cached assets (managed by Workbox precaching)
- index.html (initial version, superseded by runtime cache)
- /assets/*.js (Vite-generated bundles with content hash)
- /assets/*.css (Vite-generated stylesheets with content hash)
- Radix UI assets (UI components)
- Design system assets (icons, fonts)
```

**Strategy**: Cache-first with automatic versioning by build hash. These assets never change between releases due to content-based hashing. Safe to cache aggressively.

**2. Index.html** (network-first with fallback):

```typescript
// Always try network first to detect updates
// Fallback to cache if offline
```

**Strategy**: Network-first ensures users get update notifications quickly. Fallback to cached version maintains offline functionality.

**3. Dynamic Imports** (stale-while-revalidate):

```typescript
// Route-based code splitting
/assets/SessionView.*.js
/assets/SignalAnalysis.*.js
/assets/plugins/*.js
```

**Strategy**: Serve from cache immediately, update in background. Ensures instant navigation while keeping chunks fresh.

**4. Assets** (cache-first with expiration):

```typescript
// Static media assets
/fonts/*.woff2
/icons/*.svg
/images/*.{png,jpg,webp}
```

**Strategy**: Cache-first with 30-day expiration. These rarely change and are not critical for updates.

#### 9.3.2 Cache Implementation

```typescript
// vite.config.ts - Workbox configuration
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'prompt', // User confirms updates
      includeAssets: ['fonts/*.woff2', 'icons/*.svg'],

      workbox: {
        // Precache: App shell assets
        globPatterns: ['**/*.{js,css,woff2,svg}'],

        // Runtime caching strategies
        runtimeCaching: [
          // Strategy 1: index.html (network-first)
          {
            urlPattern: ({ request, url }) => {
              return request.destination === 'document';
            },
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
              networkTimeoutSeconds: 5, // Fast fallback to cache
            },
          },

          // Strategy 2: JS/CSS (cache-first, content-hashed)
          {
            urlPattern: /\.(?:js|css)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'asset-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year (content-hashed)
              },
            },
          },

          // Strategy 3: Dynamic imports (stale-while-revalidate)
          {
            urlPattern: /\/assets\/.*\.js$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'chunk-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 1 week
              },
            },
          },

          // Strategy 4: Fonts & icons (cache-first, long-lived)
          {
            urlPattern: /\.(?:woff2|svg)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-asset-cache',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
        ],

        // Cache versioning by build
        cleanupOutdatedCaches: true,
      },

      manifest: {
        name: 'CPAP Analyzer',
        short_name: 'CPAP Analyzer',
        description: 'Client-side CPAP therapy data analysis',
        theme_color: '#1e40af',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
});
```

#### 9.3.3 No User Data in Service Worker Caches

**Critical Privacy Constraint**: Service Worker caches contain **only public application assets**. User data is **never cached** by the Service Worker.

**Rationale**:

1. **Cache Inspection**: Service Worker caches can be inspected via DevTools. User data must not be visible there.
2. **Cache Invalidation**: Service Worker caches are tied to app versions and can be cleared automatically. User data requires explicit user control.
3. **Separation of Concerns**: Application code (IndexedDB/OPFS) owns user data lifecycle. Service Worker owns application code lifecycle.

**User Data Storage** (handled separately):

```typescript
// User data storage (NOT in Service Worker cache)
IndexedDB:
  - cpapdatabase.sessions
  - cpapdatabase.signals
  - cpapdatabase.analyses

OPFS:
  - /raw_data/*.edf (original EDF files)
  - /exports/*.csv (generated exports)
```

---

### 9.4 Update Mechanism

The update mechanism ensures users receive new versions promptly while avoiding disruptive auto-reloads.

#### 9.4.1 Update Detection

```typescript
// src/services/pwa-update.service.ts
import { useRegisterSW } from 'virtual:pwa-register/react';

export function usePWAUpdate() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,

    onRegistered(registration) {
      console.log('[PWA] Service Worker registered:', registration);

      // Check for updates every hour
      setInterval(
        () => {
          console.log('[PWA] Checking for updates...');
          registration?.update();
        },
        60 * 60 * 1000,
      );
    },

    onRegisterError(error) {
      console.error('[PWA] Service Worker registration failed:', error);
    },

    onNeedRefresh() {
      console.log('[PWA] New version available');
    },

    onOfflineReady() {
      console.log('[PWA] App ready to work offline');
    },
  });

  return {
    updateAvailable: needRefresh,
    applyUpdate: () => updateServiceWorker(true),
    dismissUpdate: () => setNeedRefresh(false),
  };
}
```

#### 9.4.2 Update UI Component

```typescript
// src/components/UpdateBanner/UpdateBanner.tsx
import { usePWAUpdate } from '@/services/pwa-update.service';
import { Button } from '@/components/ui/Button';
import { X } from 'lucide-react';
import styles from './UpdateBanner.module.css';

export function UpdateBanner() {
  const { updateAvailable, applyUpdate, dismissUpdate } = usePWAUpdate();

  if (!updateAvailable) return null;

  return (
    <div className={styles.banner} role="alert" aria-live="polite">
      <div className={styles.content}>
        <p className={styles.message}>
          A new version of CPAP Analyzer is available.
        </p>

        <div className={styles.actions}>
          <Button
            onClick={applyUpdate}
            variant="primary"
            size="small"
          >
            Reload to Update
          </Button>

          <Button
            onClick={dismissUpdate}
            variant="ghost"
            size="small"
            aria-label="Dismiss update notification"
          >
            <X size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}
```

#### 9.4.3 Skip Waiting Implementation

```typescript
// src/sw-custom.ts (custom Service Worker code if needed)
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

// Claim clients immediately on activation
self.skipWaiting();
clientsClaim();

// Cleanup old caches
cleanupOutdatedCaches();

// Precache assets
precacheAndRoute(self.__WB_MANIFEST);

// Listen for skip waiting message from client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
```

#### 9.4.4 Graceful Update Failure

```typescript
// src/hooks/usePWAUpdate.ts - Enhanced with error handling
export function usePWAUpdate() {
  const [updateError, setUpdateError] = useState<string | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      console.log('[PWA] Service Worker registered');
    },

    onRegisterError(error) {
      console.error('[PWA] Registration failed:', error);
      setUpdateError('Failed to install app updates. Try refreshing the page.');
    },
  });

  const applyUpdate = async () => {
    try {
      await updateServiceWorker(true);
    } catch (error) {
      console.error('[PWA] Update failed:', error);
      setUpdateError('Failed to apply update. Please refresh the page manually.');
    }
  };

  return {
    updateAvailable: needRefresh,
    updateError,
    applyUpdate,
    dismissUpdate: () => setNeedRefresh(false),
    clearError: () => setUpdateError(null),
  };
}
```

---

### 9.5 Cache Versioning & Invalidation

#### 9.5.1 Automatic Cache Versioning

Workbox automatically versions caches using precache manifests:

```typescript
// Generated by Workbox during build
// precache-manifest.json (example)
{
  "version": "2026.02.001",
  "assets": [
    { "url": "/index.html", "revision": "a1b2c3d4" },
    { "url": "/assets/index.js", "revision": "e5f6g7h8" },
    { "url": "/assets/index.css", "revision": "i9j0k1l2" }
  ]
}
```

Cache names include the precache manifest hash:

```text
workbox-precache-v2-https://cpap-analyzer.github.io/
workbox-runtime-https://cpap-analyzer.github.io/
```

#### 9.5.2 Automatic Cleanup on Activation

```typescript
// Handled by Workbox (configured in vite.config.ts)
workbox: {
  cleanupOutdatedCaches: true, // Automatically delete old caches
}
```

**Cleanup Process**:

1. New Service Worker activates
2. Workbox compares cached manifest with new manifest
3. Assets not in new manifest are deleted
4. Old cache versions are removed
5. Only current version caches remain

#### 9.5.3 User-Triggered Cache Clear

```typescript
// src/services/cache-manager.service.ts
export class CacheManager {
  /**
   * Clear all Service Worker caches.
   * User data in IndexedDB/OPFS is NOT affected.
   */
  static async clearAppCache(): Promise<void> {
    if (!('caches' in window)) {
      throw new Error('Cache API not supported');
    }

    const cacheNames = await caches.keys();

    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));

    console.log('[Cache] Cleared all app caches:', cacheNames);
  }

  /**
   * Get total size of all Service Worker caches.
   */
  static async getCacheSize(): Promise<number> {
    if (!('caches' in window)) return 0;

    const cacheNames = await caches.keys();
    let totalSize = 0;

    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();

      for (const request of keys) {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.blob();
          totalSize += blob.size;
        }
      }
    }

    return totalSize;
  }

  /**
   * List all cached resources.
   */
  static async listCachedResources(): Promise<string[]> {
    if (!('caches' in window)) return [];

    const cacheNames = await caches.keys();
    const allUrls: string[] = [];

    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      allUrls.push(...keys.map((req) => req.url));
    }

    return allUrls;
  }
}
```

#### 9.5.4 Settings UI Integration

```typescript
// src/views/Settings/CacheSettings.tsx
import { useState } from 'react';
import { CacheManager } from '@/services/cache-manager.service';
import { Button } from '@/components/ui/Button';

export function CacheSettings() {
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  const loadCacheSize = async () => {
    const size = await CacheManager.getCacheSize();
    setCacheSize(size);
  };

  const clearCache = async () => {
    setIsClearing(true);
    try {
      await CacheManager.clearAppCache();
      setCacheSize(0);
      // Show success toast
    } catch (error) {
      console.error('Failed to clear cache:', error);
      // Show error toast
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div>
      <h3>Application Cache</h3>

      <p>
        The app caches static assets (HTML, JS, CSS) for offline access.
        User data is stored separately and is not affected by clearing the cache.
      </p>

      <Button onClick={loadCacheSize}>Check Cache Size</Button>

      {cacheSize !== null && (
        <p>Current cache size: {(cacheSize / 1024 / 1024).toFixed(2)} MB</p>
      )}

      <Button
        onClick={clearCache}
        disabled={isClearing}
        variant="destructive"
      >
        {isClearing ? 'Clearing...' : 'Clear App Cache'}
      </Button>

      <p>
        <small>
          This clears the application code cache. Your CPAP data,
          settings, and analyses are not affected.
        </small>
      </p>
    </div>
  );
}
```

---

### 9.6 Offline Behavior

#### 9.6.1 Full Offline Functionality

After the first visit, the application is fully functional offline:

- ✅ View all imported sessions
- ✅ Run all analyses (Time-in-Range, AHI, Leak Rate, etc.)
- ✅ Generate visualizations and charts
- ✅ Export data to CSV/JSON
- ✅ Modify settings and preferences
- ✅ Navigate between all views

**Network-Dependent Features** (graceful degradation):

- ❌ Loading external plugins from CDN (local plugins work offline)
- ❌ Integrations with external APIs (Fitbit, weather, LLM)
- ❌ Fetching documentation updates from GitHub

#### 9.6.2 Offline Indicator

```typescript
// src/hooks/useOnlineStatus.ts
import { useState, useEffect } from 'react';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
```

```typescript
// src/components/OfflineBanner/OfflineBanner.tsx
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';
import styles from './OfflineBanner.module.css';

export function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <WifiOff size={16} />
      <span>
        You're offline. The app continues to work, but some features
        may be unavailable.
      </span>
    </div>
  );
}
```

#### 9.6.3 Graceful Degradation for Network Features

```typescript
// src/services/external-api.service.ts
export class ExternalAPIService {
  async fetchWeatherData(location: string): Promise<WeatherData | null> {
    if (!navigator.onLine) {
      console.warn('[ExternalAPI] Offline: Cannot fetch weather data');
      return null; // Graceful return, not an error
    }

    try {
      const response = await fetch(`/api/weather?location=${location}`);
      return await response.json();
    } catch (error) {
      console.error('[ExternalAPI] Weather fetch failed:', error);
      return null;
    }
  }
}
```

```typescript
// UI handles null gracefully
function WeatherWidget() {
  const weather = useWeather(userLocation);

  if (weather === null) {
    return (
      <div>
        <p>Weather data unavailable offline.</p>
        <Button onClick={retry} disabled={!navigator.onLine}>
          Retry
        </Button>
      </div>
    );
  }

  return <WeatherDisplay data={weather} />;
}
```

---

### 9.7 Service Worker Lifecycle Management

#### 9.7.1 Registration

```typescript
// src/main.tsx - Service Worker registration
import { registerSW } from 'virtual:pwa-register';

// Register Service Worker
if ('serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,

    onRegistered(registration) {
      console.log('[PWA] Service Worker registered');

      // Poll for updates every hour
      setInterval(
        () => {
          registration?.update();
        },
        60 * 60 * 1000,
      );
    },

    onRegisterError(error) {
      console.error('[PWA] Service Worker registration failed:', error);
    },

    onNeedRefresh() {
      console.log('[PWA] New version available');
      // Trigger update UI (handled by usePWAUpdate hook)
    },

    onOfflineReady() {
      console.log('[PWA] App ready to work offline');
      // Optional: Show "Ready for offline use" toast
    },
  });
}
```

#### 9.7.2 Update Detection

```typescript
// Service Worker update lifecycle
Service Worker States:
  - parsed: Service Worker script parsed, not yet installed
  - installing: Service Worker installing (precaching assets)
  - installed: Service Worker installed, waiting to activate
  - activating: Service Worker activating (cleaning old caches)
  - activated: Service Worker active and controlling pages
  - redundant: Service Worker replaced by newer version
```

**Update Detection Flow**:

1. User visits app
2. Current Service Worker checks for new version (every hour + on page load)
3. New Service Worker found → downloads and installs in background
4. New Service Worker enters "waiting" state (doesn't activate yet)
5. `onNeedRefresh` callback fires → app displays update banner
6. User clicks "Reload to Update" → `skipWaiting()` called
7. New Service Worker activates → page reloads
8. New version now active

#### 9.7.3 Skip Waiting Implementation

```typescript
// Custom Service Worker (src/sw.ts) - if needed beyond Workbox
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Skip waiting requested');
    self.skipWaiting();
  }
});

// Client-side trigger (in React hook)
const applyUpdate = () => {
  if (registration?.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  // Reload page after new SW activates
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
};
```

#### 9.7.4 Error Handling for Registration Failures

```typescript
// src/services/pwa-registration.service.ts
export async function registerServiceWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[PWA] Service Workers not supported');
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });

    console.log('[PWA] Service Worker registered:', registration);
    return true;
  } catch (error) {
    console.error('[PWA] Service Worker registration failed:', error);

    // App still works, just without offline support
    // Show non-blocking notification to user
    return false;
  }
}
```

#### 9.7.5 Browser Without Service Worker Support

```typescript
// Fallback for browsers without Service Worker support
if (!('serviceWorker' in navigator)) {
  console.warn('[PWA] Service Worker not supported - app runs online-only');

  // Optional: Show one-time banner
  showOneTimeBanner(
    'Your browser does not support offline mode. The app will work, ' +
      'but requires an internet connection.',
  );
}
```

---

### 9.8 Development Experience

#### 9.8.1 Bypass Service Worker in Development

```typescript
// vite.config.ts - Disable Service Worker in development
export default defineConfig(({ mode }) => ({
  plugins: [
    VitePWA({
      // Only register Service Worker in production
      disable: mode === 'development',

      // Alternative: Use 'injectManifest' for more control
      strategies: mode === 'development' ? 'injectManifest' : 'generateSW',
    }),
  ],
}));
```

**Rationale**: Service Workers cache assets aggressively, which conflicts with Vite's Hot Module Replacement (HMR) in development. Disabling in dev mode allows instant updates.

#### 9.8.2 Testing Service Worker Locally

##### Option 1: Preview Build

```bash
# Build production bundle
npm run build

# Serve with Service Worker
npm run preview

# Open http://localhost:4173
# Service Worker will register and cache assets
```

##### Option 2: Workbox Testing Utilities

```typescript
// vitest.config.ts - Mock Service Worker for tests
export default defineConfig({
  test: {
    setupFiles: ['./src/test/setup-sw.ts'],
  },
});
```

```typescript
// src/test/setup-sw.ts
import { setupServer } from 'msw/node';
import { rest } from 'msw';

// Mock Service Worker for testing
export const server = setupServer(
  rest.get('/sw.js', (req, res, ctx) => {
    return res(ctx.status(200), ctx.text('// Mock Service Worker'));
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

#### 9.8.3 Debugging Service Worker Issues

**Chrome DevTools**:

1. Open DevTools → Application → Service Workers
2. Check Service Worker status (activated, waiting, redundant)
3. Force update: Click "Update" button
4. Skip waiting: Check "Update on reload"
5. Unregister: Click "Unregister" to start fresh

**Cache Inspection**:

1. DevTools → Application → Cache Storage
2. Expand cache names to see cached resources
3. Delete individual caches for testing

**Console Logging**:

```typescript
// Verbose logging in development
const DEBUG_SW = import.meta.env.DEV;

if (DEBUG_SW) {
  console.log('[PWA] Registration started');
  console.log('[PWA] Current SW state:', registration.active?.state);
  console.log('[PWA] Waiting SW:', registration.waiting);
}
```

**Common Issues**:

- **Service Worker stuck in "waiting"**: User didn't click update banner. Close all tabs and reopen.
- **Cached assets not updating**: Clear caches via DevTools → Application → Clear Storage.
- **Service Worker registration fails**: Check HTTPS requirement (localhost is exempt).

---

### 9.9 Security Considerations

#### 9.9.1 HTTPS Requirement

Service Workers require a **secure context** (HTTPS or localhost):

- ✅ **GitHub Pages**: Serves over HTTPS by default
- ✅ **Localhost**: Exempt from HTTPS requirement during development
- ❌ **HTTP in production**: Service Worker will not register

**No additional configuration needed** for CPAP Analyzer (GitHub Pages provides HTTPS).

#### 9.9.2 Service Worker Scope

```typescript
// Service Worker registration scope
navigator.serviceWorker.register('/sw.js', {
  scope: '/', // Controls entire origin
});
```

**Scope Principle**: The Service Worker controls all pages under its scope. CPAP Analyzer uses root scope (`/`) to control the entire app.

**Security Implication**: A compromised Service Worker could intercept all network requests. Mitigation:

- Service Worker source is integrity-checked (content hash)
- Workbox-generated Service Workers follow security best practices
- Custom Service Worker code must be reviewed by Security Agent

#### 9.9.3 No Sensitive Data in Caches

**Critical Security Rule**: Service Worker caches contain **only public assets**. No user data, no API keys, no tokens.

**Verification**:

```typescript
// Security audit: List all cached resources
const cachedResources = await CacheManager.listCachedResources();

// Verify no user data paths
const userDataPaths = ['/api/sessions', '/api/data', 'indexeddb', 'opfs'];

const violations = cachedResources.filter((url) =>
  userDataPaths.some((path) => url.includes(path)),
);

if (violations.length > 0) {
  console.error('[Security] User data found in caches:', violations);
  throw new Error('Security violation: User data in Service Worker cache');
}
```

#### 9.9.4 Content Security Policy Integration

```html
<!-- index.html - CSP meta tag -->
<meta
  http-equiv="Content-Security-Policy"
  content="
    default-src 'self';
    script-src 'self' 'unsafe-inline';
    worker-src 'self' blob:;
    connect-src 'self' https://api.example.com;
  "
/>
```

**Service Worker CSP**:

- `worker-src 'self'`: Allows Service Worker from same origin
- `script-src 'self'`: Service Worker can only load scripts from app origin
- `connect-src`: Limits Service Worker network requests to allowed domains

**GitHub Pages Default CSP**: Permissive, no restrictions by default. CPAP Analyzer can add stricter CSP via meta tag.

---

### 9.10 Tooling & Implementation

#### 9.10.1 Recommended: vite-plugin-pwa

**Installation**:

```bash
npm install -D vite-plugin-pwa workbox-window
```

**Configuration** (see Section 9.3.2 for full config):

```typescript
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['fonts/*.woff2', 'icons/*.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg}'],
        runtimeCaching: [
          /* see Section 9.3.2 */
        ],
        cleanupOutdatedCaches: true,
      },
      manifest: {
        /* PWA manifest */
      },
    }),
  ],
});
```

**Advantages**:

- ✅ Workbox integration (battle-tested caching strategies)
- ✅ Automatic precache manifest generation
- ✅ Vite dev server integration
- ✅ TypeScript support
- ✅ React hooks (`virtual:pwa-register/react`)

#### 9.10.2 Alternative: Custom Service Worker

For advanced use cases, implement a custom Service Worker:

```typescript
// public/sw.js - Custom Service Worker
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// Precache assets
precacheAndRoute(self.__WB_MANIFEST);

// Custom route: index.html (network-first)
registerRoute(
  ({ request }) => request.destination === 'document',
  new NetworkFirst({
    cacheName: 'html-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 5,
        maxAgeSeconds: 60 * 60 * 24, // 24 hours
      }),
    ],
  }),
);

// Custom route: Assets (cache-first)
registerRoute(
  ({ request }) => request.destination === 'script' || request.destination === 'style',
  new CacheFirst({
    cacheName: 'asset-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
      }),
    ],
  }),
);
```

**Registration**:

```typescript
// src/main.tsx
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
```

**When to Use Custom Service Worker**:

- Need full control over caching logic
- Implementing advanced features (background sync, push notifications)
- Debugging caching issues not solvable with Workbox config

#### 9.10.3 Cache Size Limits

**Browser Cache Quotas**:

- Chrome: ~6% of available disk space (min 1GB)
- Firefox: ~10% of available disk space
- Safari: ~50MB initially, can request more

**CPAP Analyzer Estimate**:

```text
App Shell:
  - HTML: ~5KB
  - JS bundles: ~500KB (with code splitting)
  - CSS: ~50KB
  - Fonts: ~200KB
  - Icons: ~50KB
  Total: ~800KB (well under quota)
```

**Monitoring Cache Size**:

```typescript
// Check cache quota usage
if (navigator.storage && navigator.storage.estimate) {
  const { usage, quota } = await navigator.storage.estimate();

  console.log(`Cache usage: ${(usage / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Cache quota: ${(quota / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Cache % used: ${((usage / quota) * 100).toFixed(2)}%`);
}
```

---

### 9.11 Performance Impact

#### 9.11.1 Benefits

**Instant Loading on Repeat Visits**:

- First visit: Standard network load (~500-800ms)
- Repeat visits: Cache load (~50-100ms) — **5-10x faster**

**Reduced Bandwidth Usage**:

- First visit: Downloads all assets (~800KB)
- Repeat visits: Only downloads updated assets (typically 0-50KB for hot fixes)
- Savings: ~95% bandwidth reduction for repeat users

**Perceived Performance**:

- App shell renders immediately (cached HTML/CSS)
- Content may still be loading, but UI is interactive
- Eliminates "white screen" during network delays

#### 9.11.2 Cache Storage Quota Considerations

**Storage API** (same quota as IndexedDB/OPFS):

```typescript
// Total storage quota (shared across IndexedDB, OPFS, Cache API)
const { usage, quota } = await navigator.storage.estimate();
```

**CPAP Analyzer Storage Breakdown**:

```text
Service Worker Caches: ~1MB (app shell + assets)
IndexedDB: ~100MB-1GB (CPAP session data)
OPFS: ~1GB-10GB (raw EDF files)

Total: ~1-11GB (mostly user data, not caches)
```

**Quota Management**:

- Service Worker caches are **tiny** compared to user data
- Automatic cache cleanup prevents cache bloat
- User data is the primary storage consumer, not caches

---

### 9.12 Testing Strategy

#### 9.12.1 Playwright Tests for Offline Functionality

```typescript
// e2e/offline.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Offline Functionality', () => {
  test('app loads offline after first visit', async ({ page, context }) => {
    // First visit: Load app online
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('CPAP Analyzer');

    // Wait for Service Worker registration
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    // Go offline
    await context.setOffline(true);

    // Reload page
    await page.reload();

    // App should still load from cache
    await expect(page.locator('h1')).toContainText('CPAP Analyzer');
  });

  test('shows offline indicator when network unavailable', async ({ page, context }) => {
    await page.goto('/');

    // Go offline
    await context.setOffline(true);

    // Offline banner should appear
    await expect(page.locator('[role="status"]')).toContainText("You're offline");
  });

  test('analysis functions work offline', async ({ page, context }) => {
    // Import session data online
    await page.goto('/');
    await page.locator('button:has-text("Import Data")').click();
    // ... import session ...

    // Go offline
    await context.setOffline(true);

    // Navigate to session
    await page.locator('a:has-text("Session 1")').click();

    // Analysis should run offline
    await expect(page.locator('[data-testid="ahi-score"]')).toBeVisible();
  });
});
```

#### 9.12.2 Service Worker Lifecycle Tests

```typescript
// e2e/sw-lifecycle.spec.ts
test.describe('Service Worker Lifecycle', () => {
  test('registers Service Worker on first visit', async ({ page }) => {
    await page.goto('/');

    const swRegistered = await page.evaluate(() => {
      return navigator.serviceWorker.controller !== null;
    });

    expect(swRegistered).toBe(true);
  });

  test('detects updates and shows update banner', async ({ page }) => {
    await page.goto('/');

    // Simulate new Service Worker available
    await page.evaluate(() => {
      // Trigger update event
      const event = new CustomEvent('needRefresh');
      window.dispatchEvent(event);
    });

    // Update banner should appear
    await expect(page.locator('button:has-text("Reload to Update")')).toBeVisible();
  });
});
```

#### 9.12.3 Cache Invalidation Tests

```typescript
// e2e/cache-invalidation.spec.ts
test.describe('Cache Management', () => {
  test('clears app cache when user requests', async ({ page }) => {
    await page.goto('/settings');

    // Check cache size
    await page.locator('button:has-text("Check Cache Size")').click();
    await expect(page.locator('text=/Current cache size/')).toBeVisible();

    // Clear cache
    await page.locator('button:has-text("Clear App Cache")').click();

    // Verify cache cleared
    await expect(page.locator('text=/0.00 MB/')).toBeVisible();
  });
});
```

#### 9.12.4 Update Flow E2E Tests

```typescript
// e2e/update-flow.spec.ts
test.describe('Update Flow', () => {
  test('applies update when user clicks "Reload to Update"', async ({ page }) => {
    await page.goto('/');

    // Simulate update available
    await page.evaluate(() => {
      const event = new CustomEvent('needRefresh');
      window.dispatchEvent(event);
    });

    // Click update button
    await page.locator('button:has-text("Reload to Update")').click();

    // Page should reload
    await page.waitForLoadState('load');

    // Verify new version loaded (check version in footer or DevTools)
    const version = await page.locator('[data-testid="app-version"]').textContent();
    expect(version).toBeTruthy();
  });

  test('dismisses update notification', async ({ page }) => {
    await page.goto('/');

    // Simulate update available
    await page.evaluate(() => {
      const event = new CustomEvent('needRefresh');
      window.dispatchEvent(event);
    });

    // Click dismiss button
    await page.locator('button[aria-label="Dismiss update notification"]').click();

    // Update banner should disappear
    await expect(page.locator('button:has-text("Reload to Update")')).not.toBeVisible();
  });
});
```

---

## 10. Testing Integration

### 10.1 Vitest Unit Tests

**Testing Strategy**:

- Test all utility functions (pure functions are easy to test)
- Test component logic (not visual appearance)
- Test custom hooks
- Test Zustand stores
- Test service layer (mock storage APIs)

**Example: Component Test**

```typescript
// src/components/ui/Button/Button.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('renders with text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Click me</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
```

**Example: Store Test**

```typescript
// src/stores/useAppStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppStore } from './useAppStore';

describe('useAppStore', () => {
  beforeEach(() => {
    // Reset store state
    useAppStore.setState(useAppStore.getInitialState());
  });

  it('updates date range', () => {
    const { result } = renderHook(() => useAppStore());

    const newRange = {
      start: new Date('2026-01-01'),
      end: new Date('2026-01-31'),
    };

    act(() => {
      result.current.setDateRange(newRange);
    });

    expect(result.current.dateRange).toEqual(newRange);
  });
});
```

### 10.2 Playwright E2E Tests

**Testing Strategy**:

- Test critical user flows (import, dashboard, session detail)
- Test keyboard navigation
- Test accessibility (ARIA attributes, focus management)
- Test theme switching
- Test error states

**Example: Import Flow E2E Test**

```typescript
// tests/e2e/specs/import.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Data Import Flow', () => {
  test('imports ResMed SD card data successfully', async ({ page }) => {
    await page.goto('/');

    // Welcome screen should show
    await expect(page.getByRole('heading', { name: /CPAP Analyzer/i })).toBeVisible();

    // Click import button
    await page.getByRole('button', { name: /Import Your Data/i }).click();

    // Select directory (using test fixtures)
    // Note: Browser automation for file system access requires special setup
    // This is a simplified example

    // Progress should show
    await expect(page.getByText(/Importing CPAP Data/i)).toBeVisible();

    // Wait for completion
    await expect(page.getByText(/Import Successful/i)).toBeVisible({ timeout: 30000 });

    // Should navigate to dashboard
    await expect(page).toHaveURL('/');

    // Dashboard should show imported data
    await expect(page.getByText(/AHI/i)).toBeVisible();
  });
});
```

---

## 11. CSS Strategy

### 11.1 Recommendation: CSS Modules + Design Tokens

**Architecture**:

```
CSS Custom Properties (Design Tokens)
           │
           ├─> tokens.css (from ui-design-system.md)
           │
           ▼
CSS Modules (Component Styles)
           │
           ├─> Button.module.css
           ├─> Card.module.css
           └─> Dashboard.module.css
```

**Design Tokens** (from ui-design-system.md):

```css
/* src/styles/tokens.css */
:root {
  /* Colors */
  --color-surface-primary: #ffffff;
  --color-text-primary: #1a1a1a;
  --color-primary: #2563eb;
  /* ... all tokens from ui-design-system.md */
}

[data-theme='dark'] {
  --color-surface-primary: #0a0a0a;
  --color-text-primary: #fafafa;
  --color-primary: #3b82f6;
  /* ... dark theme overrides */
}
```

**CSS Modules** (component-scoped styles):

```css
/* src/components/ui/Button/Button.module.css */
.button {
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  padding: 12px 24px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  min-height: 44px;
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.button:hover {
  background-color: var(--color-primary-hover);
}

.button:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary {
  background-color: transparent;
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
}

.secondary:hover {
  background-color: var(--color-surface-secondary);
}
```

**Usage in Component**:

```typescript
// src/components/ui/Button/Button.tsx
import styles from './Button.module.css';
import { cn } from '@/utils/classnames';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost';
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

export function Button({ variant = 'primary', children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        styles.button,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost
      )}
      {...props}
    >
      {children}
    </button>
  );
}
```

**Utility: classnames helper**:

```typescript
// src/utils/classnames.ts
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
```

**Rationale**:

1. **CSS Modules**:
   - Scoped styles (no naming collisions)
   - Type-safe imports (TypeScript generates `.d.ts` files)
   - Standards-based (no runtime, just build-time transformation)
   - Explicit dependencies (import what you use)

2. **Design Tokens as CSS Custom Properties**:
   - Dynamic theming (change theme by changing `data-theme` attribute)
   - No JavaScript overhead for theme switching
   - Variables are computed at runtime (no re-bundle for theme changes)
   - Browser-native, no additional library

3. **No Tailwind**:
   - Tailwind adds 50KB+ to bundle (even with purging)
   - Utility-first CSS is harder for AI agents to reason about (long className strings)
   - Custom design system doesn't benefit from Tailwind's defaults
   - CSS Modules provide better component encapsulation

4. **No CSS-in-JS**:
   - Runtime overhead (Emotion, Styled Components parse styles at runtime)
   - Larger bundle size
   - Adds complexity to mental model
   - Not necessary for our use case (static themes)

**Global Styles**:

```typescript
// src/main.tsx
import './styles/tokens.css'; // Design tokens
import './styles/reset.css'; // CSS reset
import './styles/base.css'; // Base styles (body, headings, etc.)
import './styles/utilities.css'; // Utility classes (if needed)
```

---

## 12. Type Safety

### 12.1 TypeScript Configuration

```json
// tsconfig.json
{
  "compilerOptions": {
    // Strict mode (all strict checks enabled)
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,

    // Module resolution
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,

    // Type resolution
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"],
    "lib": ["ESNext", "DOM", "DOM.Iterable"],

    // Emit
    "noEmit": true, // Vite handles transpilation
    "isolatedModules": true,

    // Interop
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,

    // JSX
    "jsx": "react-jsx",
    "jsxImportSource": "react",

    // Path aliases
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@/components/*": ["src/components/*"],
      "@/services/*": ["src/services/*"],
      "@/stores/*": ["src/stores/*"],
      "@/utils/*": ["src/utils/*"],
      "@/types/*": ["src/types/*"]
    }
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 12.2 Type Generation Strategies

**1. Session Metadata Types** (from IndexedDB schema):

```typescript
// src/types/session.ts
export interface SessionMetadata {
  id: string; // UUID
  machineId: string;
  startTime: Date;
  endTime: Date;
  duration: number; // seconds

  // Summary metrics
  ahi: number;
  oahi: number; // Obstructive AHI
  cahi: number; // Central AHI
  hahi: number; // Hypopnea AHI

  usage: number; // seconds
  leak95: number; // 95th percentile leak (L/min)
  leakMedian: number;

  pressure: {
    mean: number;
    p95: number;
    min: number;
    max: number;
  };

  // Event counts
  events: {
    obstructive: number;
    central: number;
    mixed: number;
    hypopnea: number;
    rera: number;
    largeLeak: number;
  };

  // User annotations
  notes: string | null;
  tags: string[];

  // Import metadata
  importedAt: Date;
  sourceFiles: string[];
}
```

**2. Signal Data Types**:

```typescript
// src/types/signal.ts
export interface SignalChannel {
  label: string;
  sampleRate: number; // Hz
  unit: string;
  physicalMin: number;
  physicalMax: number;
  digitalMin: number;
  digitalMax: number;
}

export interface SignalChunk {
  sessionId: string;
  channel: string;
  startTime: number; // Unix timestamp (ms)
  endTime: number;
  sampleRate: number;
  data: Float32Array; // Physical values
}

export interface SignalQuery {
  sessionId: string;
  channels: string[];
  startTime: number;
  endTime: number;
  maxSamples?: number; // For downsampling
}

export interface SignalQueryResult {
  sessionId: string;
  channel: string;
  timestamps: Float64Array; // Unix timestamps (ms)
  values: Float32Array;
  sampleRate: number;
  downsampled: boolean;
}
```

**3. Analysis Result Types**:

```typescript
// src/types/analysis.ts
export type AnalysisMethod =
  | 'descriptive'
  | 'timeseries'
  | 'correlation'
  | 'hypothesis'
  | 'distribution'
  | 'clustering'
  | 'survival';

export interface AnalysisResult {
  id: string;
  method: AnalysisMethod;
  dateRange: { start: Date; end: Date };
  parameters: Record<string, unknown>;
  results: Record<string, unknown>;
  createdAt: Date;
}

// Specific analysis result types
export interface DescriptiveStatistics {
  metric: string;
  n: number;
  mean: number;
  median: number;
  stddev: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  iqr: number;
}

export interface CorrelationResult {
  metricA: string;
  metricB: string;
  coefficient: number; // Pearson or Spearman
  pValue: number;
  method: 'pearson' | 'spearman';
}

export interface HypothesisTestResult {
  metric: string;
  periodA: { start: Date; end: Date; n: number; mean: number; median: number };
  periodB: { start: Date; end: Date; n: number; mean: number; median: number };
  test: 'mannwhitneyu' | 'ttest' | 'wilcoxon';
  statistic: number;
  pValue: number;
  effectSize: number;
  interpretation: 'significant' | 'not-significant';
}
```

**4. Plugin Interface Types**:

```typescript
// src/types/plugin.ts
export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  category: 'machine' | 'analysis' | 'visualization' | 'integration' | 'export';
  description: string;
  author: string;
}

export interface MachinePlugin extends PluginMetadata {
  category: 'machine';
  detect: (files: File[]) => Promise<boolean>;
  parse: (files: File[]) => Promise<ParsedSession[]>;
}

export interface AnalysisPlugin extends PluginMetadata {
  category: 'analysis';
  configSchema: JSONSchema; // For UI generation
  run: (data: AnalysisInput, config: Record<string, unknown>) => Promise<AnalysisResult>;
}

// ... more plugin types
```

---

## 13. Performance Considerations

### 13.1 Code Splitting Points

**Route-Based Code Splitting** (automatic with `React.lazy`):

```typescript
// src/router.tsx
const Dashboard = React.lazy(() => import('./views/Dashboard/Dashboard'));
const SessionDetail = React.lazy(() => import('./views/SessionDetail/SessionDetail'));
const Analysis = React.lazy(() => import('./views/Analysis/Analysis'));
const Reports = React.lazy(() => import('./views/Reports/Reports'));
```

**Feature-Based Code Splitting**:

```typescript
// Lazy-load chart library when rendering first chart
const Chart = React.lazy(() => import('@/components/charts/LineChart'));

// Lazy-load PDF generator when creating report
const PDFGenerator = React.lazy(() => import('@/services/reports/PDFGenerator'));

// Lazy-load the AI Insights entry point and provider SDKs only when the user
// enables the feature and triggers a generation (ADR 0024). The runInsight
// orchestrator lives at `@/services/llm/runInsight`; each backend's SDK
// (WebLLM, Anthropic, etc.) is dynamically imported inside its provider so the
// weight is paid only for the chosen backend.
const runInsight = () => import('@/services/llm/runInsight');
```

### 13.2 Lazy Loading

**Image Lazy Loading** (native browser support):

```tsx
<img src="/assets/chart.png" loading="lazy" alt="Chart" />
```

**Component Lazy Loading with Fallback**:

```tsx
<Suspense fallback={<ChartSkeleton />}>
  <Chart data={chartData} />
</Suspense>
```

### 13.3 Virtual Scrolling

**For Large Tables** (use `react-virtual`):

```typescript
// src/components/SessionTable/SessionTable.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

export function SessionTable({ sessions }: { sessions: SessionMetadata[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60, // Row height in pixels
    overscan: 10, // Render 10 extra rows above/below viewport
  });

  return (
    <div ref={parentRef} className={styles.tableContainer}>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map(virtualRow => {
          const session = sessions[virtualRow.index];
          return (
            <div
              key={session.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <SessionRow session={session} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### 13.4 Memoization Patterns

**Component Memoization with `React.memo`**:

```typescript
// Prevent re-render if props haven't changed
export const SessionCard = React.memo(function SessionCard({ session }: SessionCardProps) {
  return (
    <Card>
      <h3>{format(session.date)}</h3>
      <p>AHI: {session.ahi}</p>
    </Card>
  );
});
```

**Value Memoization with `useMemo`**:

```typescript
// Expensive computation (downsampling, filtering)
const downsampledData = useMemo(() => {
  return downsampleSignalData(signalData, targetSampleCount);
}, [signalData, targetSampleCount]);
```

**Callback Memoization with `useCallback`**:

```typescript
// Prevent child re-renders when callback hasn't changed
const handleSessionSelect = useCallback((sessionId: string) => {
  navigate(`/sessions/${sessionId}`);
}, [navigate]);

return <SessionCard session={session} onSelect={handleSessionSelect} />;
```

**When to Memoize**:

- Components that render large lists
- Expensive computations (filtering, sorting, downsampling)
- Callbacks passed to memoized child components
- Context values that trigger many re-renders

**When NOT to Memoize**:

- Cheap computations (simple arithmetic, string concatenation)
- Components that always render with different props
- Premature optimization (measure first)

### 13.5 Debouncing and Throttling

**Debounce** (for user input, search, resize):

```typescript
// src/hooks/useDebounce.ts
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Usage
const [searchQuery, setSearchQuery] = useState('');
const debouncedQuery = useDebounce(searchQuery, 300);

useEffect(() => {
  // Only run search when user stops typing for 300ms
  performSearch(debouncedQuery);
}, [debouncedQuery]);
```

**Throttle** (for scroll, resize, chart interactions):

```typescript
// src/hooks/useThrottle.ts
export function useThrottle<T extends (...args: any[]) => any>(callback: T, delay: number): T {
  const lastRun = useRef(Date.now());

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastRun.current >= delay) {
        callback(...args);
        lastRun.current = now;
      }
    },
    [callback, delay],
  ) as T;
}

// Usage
const handleScroll = useThrottle(() => {
  // Update viewport, fetch more data, etc.
}, 16); // 60fps
```

---

## 14. Accessibility

### 14.1 WCAG AA Compliance Checklist

- [ ] **Color Contrast**: All text meets 4.5:1 contrast ratio (3:1 for large text)
- [ ] **Keyboard Navigation**: All interactive elements accessible via Tab, arrow keys
- [ ] **Focus Indicators**: Visible focus ring on all interactive elements
- [ ] **ARIA Attributes**: Proper roles, labels, and live regions
- [ ] **Semantic HTML**: Use semantic elements (`<button>`, `<nav>`, `<main>`, etc.)
- [ ] **Alt Text**: All images have descriptive alt text
- [ ] **Form Labels**: All inputs have associated labels
- [ ] **Error Messages**: Announced to screen readers
- [ ] **Skip Links**: "Skip to main content" link for keyboard users
- [ ] **Responsive Text**: Text resizes up to 200% without loss of content or functionality

### 14.2 Focus Management

**Focus Trap in Modals**:

```typescript
// src/hooks/useFocusTrap.ts
export function useFocusTrap(ref: RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;

    const focusableElements = ref.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );

    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey && document.activeElement === firstElement) {
        lastElement.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        firstElement.focus();
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleTabKey);
    firstElement?.focus();

    return () => {
      document.removeEventListener('keydown', handleTabKey);
    };
  }, [ref, active]);
}
```

### 14.3 Screen Reader Support

**Live Regions for Dynamic Content**:

```tsx
// Announce import progress to screen readers
<div role="status" aria-live="polite" aria-atomic="true">
  {importProgress.current} of {importProgress.total} sessions imported
</div>
```

**Accessible Charts**:

```tsx
// Provide data table alternative for charts
<div>
  <canvas ref={chartRef} role="img" aria-label={chartDescription} />
  <button onClick={() => setShowDataTable(!showDataTable)}>
    {showDataTable ? 'Hide' : 'Show'} Data Table
  </button>
  {showDataTable && <DataTable data={chartData} />}
</div>
```

---

## 15. Dependencies

### 15.1 Core Dependencies

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.21.0",
    "zustand": "^4.4.7",

    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-dropdown-menu": "^2.0.6",
    "@radix-ui/react-tooltip": "^1.0.7",
    "@radix-ui/react-select": "^2.0.0",
    "@radix-ui/react-tabs": "^1.0.4",

    "comlink": "^4.4.1",
    "react-hook-form": "^7.49.2",
    "zod": "^3.22.4",
    "@hookform/resolvers": "^3.3.3",

    "recharts": "^2.10.3",
    "@tanstack/react-virtual": "^3.0.1",

    "date-fns": "^3.0.6"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.0.8",
    "vite-plugin-pwa": "^0.17.4",
    "vite-tsconfig-paths": "^4.2.2",

    "@types/react": "^18.2.45",
    "@types/react-dom": "^18.2.18",
    "typescript": "^5.3.3",

    "vitest": "^1.1.0",
    "@testing-library/react": "^14.1.2",
    "@testing-library/user-event": "^14.5.1",
    "@testing-library/jest-dom": "^6.1.5",

    "@playwright/test": "^1.40.1",

    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.17.0",
    "@typescript-eslint/parser": "^6.17.0",
    "eslint-plugin-react": "^7.33.2",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-jsx-a11y": "^6.8.0",

    "prettier": "^3.1.1"
  }
}
```

**Bundle Size Targets** (production, gzipped):

The following targets are enforced in CI/CD:

| Bundle Type                 | Target  | Threshold (Fail CI) |
| --------------------------- | ------- | ------------------- |
| Initial (main entry)        | ≤150 KB | ≤200 KB             |
| Route bundles (per route)   | ≤75 KB  | ≤100 KB             |
| Worker bundles (per worker) | ≤50 KB  | ≤75 KB              |
| Vendor chunks               | ≤120 KB | ≤150 KB             |
| Total application           | ≤500 KB | ≤1 MB               |
| CSS (total)                 | ≤30 KB  | ≤50 KB              |
| Fonts                       | ≤40 KB  | ≤60 KB              |

**Estimated Component Breakdown**:

- React + React-DOM: ~45KB
- React Router: ~12KB
- Zustand: ~3KB
- Radix UI (all primitives): ~20KB
- Comlink: ~2KB
- React Hook Form + Zod: ~15KB
- Recharts (lazy-loaded): ~80KB
- **Total Core**: ~100KB
- **With Charts**: ~180KB

Bundle size targets are enforced in CI/CD. See [devops-architecture.md](./devops-architecture.md) for detailed target breakdown and monitoring strategy.

---

## 16. Migration Path

### 16.1 Phase 1: Foundation (Weeks 1-2)

**Goals**: Get the basic application shell running with navigation and theming.

**Tasks**:

1. Initialize Vite project with React + TypeScript
2. Configure TypeScript (strict mode, path aliases)
3. Set up ESLint, Prettier, pre-commit hooks
4. Implement design tokens (CSS custom properties)
5. Build core UI components (Button, Input, Card, Modal) with Radix primitives
6. Set up routing (React Router) with placeholder views
7. Implement theme switching (light/dark)
8. Set up Zustand stores (AppStore, SettingsStore)
9. Configure Vitest for unit testing

**Deliverables**:

- Empty app shell with navigation
- Theme switching works
- Core components built and tested

### 16.2 Phase 2: Data Layer (Weeks 3-4)

**Goals**: Implement storage and data import pipeline.

**Tasks**:

1. Implement IndexedDB service for session metadata
2. Implement OPFS service for signal data
3. Build EDF parser (in Web Worker with Comlink)
4. Implement import wizard UI
5. Build import progress tracking
6. Implement session list view (with virtual scrolling)
7. Add session metadata caching (DataStore)

**Deliverables**:

- Users can import ResMed SD card data
- Session list displays imported sessions
- Storage management UI works

### 16.3 Phase 3: Dashboard & Session Detail (Weeks 5-6)

**Goals**: Build core data exploration views.

**Tasks**:

1. Implement Dashboard with summary cards, trend charts, session table
2. Build date range selector component
3. Implement Session Detail view with metadata and event timeline
4. Build Signal Viewer component (Canvas-based rendering)
5. Implement zoom/pan interactions on charts
6. Add keyboard navigation to all views

**Deliverables**:

- Dashboard displays summary statistics
- Users can drill into individual sessions
- Signal viewer renders waveforms smoothly

### 16.4 Phase 4: Analysis & Reports (Weeks 7-8)

**Goals**: Implement statistical analysis and report generation.

**Tasks**:

1. Build analysis algorithms (in Web Workers)
2. Implement Analysis view with method selection UI
3. Build chart components (line, bar, scatter, heatmap) with Recharts
4. Implement report generator (PDF export)
5. Build help system (contextual help, glossary, search)

**Deliverables**:

- Users can run statistical analyses
- Users can generate PDF reports
- Help system provides guidance

### 16.5 Phase 5: Polish & Performance (Weeks 9-10)

**Goals**: Optimize performance, accessibility, and user experience.

**Tasks**:

1. Implement code splitting for all views
2. Add loading skeletons and progress indicators
3. Optimize chart rendering (level-of-detail, viewport culling)
4. Conduct accessibility audit (keyboard nav, screen readers, ARIA)
5. Write Playwright E2E tests for critical flows
6. Implement PWA features (service worker, offline support, install prompt)
7. Performance profiling and optimization

**Deliverables**:

- App loads in <2 seconds
- All interactions <200ms
- WCAG AA compliant
- Works offline as PWA

---

## 17. Browser Compatibility & Fallback Strategy

### 17.1 Minimum Browser Requirements

**Critical APIs Required**:

The CPAP Analyzer requires modern browser capabilities for core functionality. See [BROWSER_SUPPORT.md](../BROWSER_SUPPORT.md) for the canonical browser support matrix.

**Required Features**:

1. **Origin Private File System (OPFS)** — Primary storage for high-frequency signal data
2. **IndexedDB** — Fallback storage and metadata persistence
3. **Web Workers** — Non-blocking computation for signal processing
4. **ES2020+ Features** — Optional chaining, nullish coalescing, BigInt, Promise.allSettled
5. **Canvas 2D Context** — High-performance chart rendering
6. **File System Access API** — Import/export of EDF files (with polyfill fallback)
7. **Typed Arrays** — Efficient binary data handling (Float32Array, Int16Array)
8. **Comlink-compatible Workers** — Structured clone algorithm support

**Browser Version Targets** (See [BROWSER_SUPPORT.md](../BROWSER_SUPPORT.md) for authoritative list):

- Chrome/Edge 102+ (OPFS support)
- Firefox 111+ (OPFS support via dom.fs.enabled flag)
- Safari 15.2+ (Partial OPFS support; IndexedDB fallback recommended)
- Opera 88+

**Feature Detection Philosophy**:

- Detect capabilities at runtime, never assume based on user agent
- Fail gracefully with clear messaging
- Provide functional fallbacks where possible
- Degrade performance, not functionality (when feasible)

---

### 17.2 Feature Detection Implementation

#### 17.2.1 Startup Feature Detection

All critical feature detection occurs during app initialization, before any data operations.

**Detection Module** (`src/utils/feature-detection.ts`):

```typescript
/**
 * Browser capability detection results
 */
export interface BrowserCapabilities {
  opfs: boolean;
  indexedDB: boolean;
  webWorkers: boolean;
  es2020: boolean;
  canvas2d: boolean;
  fileSystemAccess: boolean;
  typedArrays: boolean;
  structuredClone: boolean;
}

/**
 * Feature availability with fallback recommendations
 */
export interface FeatureAvailability {
  capabilities: BrowserCapabilities;
  isFullySupported: boolean;
  blockers: string[]; // Features that prevent app from running
  warnings: string[]; // Features that degrade performance
  recommendations: string[]; // User-facing upgrade recommendations
}

/**
 * Detect OPFS (Origin Private File System) support
 */
async function detectOPFS(): Promise<boolean> {
  try {
    if (!navigator.storage?.getDirectory) {
      return false;
    }
    // Attempt to access OPFS root
    const root = await navigator.storage.getDirectory();
    // Verify write capability
    const testFile = await root.getFileHandle('__opfs_test', { create: true });
    await root.removeEntry('__opfs_test');
    return true;
  } catch (error) {
    console.warn('OPFS detection failed:', error);
    return false;
  }
}

/**
 * Detect IndexedDB support with required features
 */
async function detectIndexedDB(): Promise<boolean> {
  try {
    if (!window.indexedDB) {
      return false;
    }
    // Test DB creation and transaction support
    return new Promise<boolean>((resolve) => {
      const request = indexedDB.open('__idb_test', 1);
      request.onerror = () => resolve(false);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        db.close();
        indexedDB.deleteDatabase('__idb_test');
        resolve(true);
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('test')) {
          db.createObjectStore('test', { keyPath: 'id' });
        }
      };
    });
  } catch (error) {
    console.warn('IndexedDB detection failed:', error);
    return false;
  }
}

/**
 * Detect Web Worker support with Comlink compatibility
 */
function detectWebWorkers(): boolean {
  try {
    return typeof Worker !== 'undefined' && typeof MessageChannel !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Detect ES2020+ features
 */
function detectES2020(): boolean {
  try {
    // Optional chaining
    const obj: any = {};
    const _ = obj?.nested?.property;

    // Nullish coalescing
    const val = null ?? 'default';

    // BigInt
    const bigInt = BigInt(9007199254740991);

    // Promise.allSettled
    return typeof Promise.allSettled === 'function';
  } catch {
    return false;
  }
}

/**
 * Detect Canvas 2D context support
 */
function detectCanvas2D(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('2d');
  } catch {
    return false;
  }
}

/**
 * Detect File System Access API (for native file picker)
 */
function detectFileSystemAccess(): boolean {
  return 'showOpenFilePicker' in window;
}

/**
 * Detect Typed Array support
 */
function detectTypedArrays(): boolean {
  try {
    return (
      typeof Float32Array !== 'undefined' &&
      typeof Int16Array !== 'undefined' &&
      typeof Uint8Array !== 'undefined'
    );
  } catch {
    return false;
  }
}

/**
 * Detect structured clone support (required for Comlink)
 */
function detectStructuredClone(): boolean {
  try {
    // Test structured clone with complex object
    const test = { date: new Date(), array: new Uint8Array([1, 2, 3]) };
    const cloned = structuredClone(test);
    return cloned.date instanceof Date;
  } catch {
    return false;
  }
}

/**
 * Run all feature detection checks
 */
export async function detectBrowserCapabilities(): Promise<FeatureAvailability> {
  const capabilities: BrowserCapabilities = {
    opfs: await detectOPFS(),
    indexedDB: await detectIndexedDB(),
    webWorkers: detectWebWorkers(),
    es2020: detectES2020(),
    canvas2d: detectCanvas2D(),
    fileSystemAccess: detectFileSystemAccess(),
    typedArrays: detectTypedArrays(),
    structuredClone: detectStructuredClone(),
  };

  const blockers: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Critical blockers (app cannot function)
  if (!capabilities.indexedDB) {
    blockers.push('IndexedDB is not available');
    recommendations.push('Please use a modern browser (Chrome 102+, Firefox 111+, Safari 15.2+)');
  }

  if (!capabilities.typedArrays) {
    blockers.push('Typed Arrays are not supported');
    recommendations.push('Your browser is too old to run this application');
  }

  if (!capabilities.es2020) {
    blockers.push('ES2020 features are not supported');
    recommendations.push('Please update your browser to a recent version');
  }

  if (!capabilities.canvas2d) {
    blockers.push('Canvas 2D context is not available');
    recommendations.push('Chart rendering requires Canvas support');
  }

  // Performance warnings (degraded experience)
  if (!capabilities.opfs) {
    warnings.push('OPFS not available — using IndexedDB for signal storage (slower performance)');
    recommendations.push('For best performance, use Chrome 102+, Firefox 111+, or Edge 102+');
  }

  if (!capabilities.webWorkers) {
    warnings.push('Web Workers not available — computation will block UI');
    recommendations.push('Enable Web Workers for responsive performance');
  }

  if (!capabilities.structuredClone) {
    warnings.push('Structured clone not available — using JSON serialization (slower)');
  }

  // Feature degradation (optional features)
  if (!capabilities.fileSystemAccess) {
    warnings.push('File System Access API not available — using fallback file picker');
  }

  return {
    capabilities,
    isFullySupported: blockers.length === 0,
    blockers,
    warnings,
    recommendations,
  };
}
```

---

### 17.3 Fallback Strategy

#### 17.3.1 Storage Fallback Matrix

| Primary          | Fallback    | Performance Impact                 | Status                |
| ---------------- | ----------- | ---------------------------------- | --------------------- |
| OPFS             | IndexedDB   | 30-50% slower write/read           | ✅ Functional         |
| IndexedDB        | None        | N/A                                | ❌ Blocker            |
| OPFS + IndexedDB | Memory-only | Session-only, data loss on refresh | ⚠️ Emergency fallback |

#### 17.3.2 OPFS Unavailable → IndexedDB Fallback

When OPFS is not available, the storage layer transparently falls back to IndexedDB for signal data.

**Implementation** (`src/storage/signal-storage.ts`):

```typescript
import type { BrowserCapabilities } from '@/utils/feature-detection';

export interface SignalStorageAdapter {
  writeSignal(sessionId: string, channel: string, data: Float32Array): Promise<void>;
  readSignal(sessionId: string, channel: string, start: number, end: number): Promise<Float32Array>;
  deleteSession(sessionId: string): Promise<void>;
}

/**
 * OPFS implementation (preferred)
 */
class OPFSSignalStorage implements SignalStorageAdapter {
  private root: FileSystemDirectoryHandle | null = null;

  async initialize(): Promise<void> {
    this.root = await navigator.storage.getDirectory();
  }

  async writeSignal(sessionId: string, channel: string, data: Float32Array): Promise<void> {
    if (!this.root) throw new Error('OPFS not initialized');

    const sessionDir = await this.root.getDirectoryHandle(sessionId, { create: true });
    const fileHandle = await sessionDir.getFileHandle(`${channel}.bin`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data.buffer);
    await writable.close();
  }

  async readSignal(
    sessionId: string,
    channel: string,
    start: number,
    end: number,
  ): Promise<Float32Array> {
    if (!this.root) throw new Error('OPFS not initialized');

    const sessionDir = await this.root.getDirectoryHandle(sessionId);
    const fileHandle = await sessionDir.getFileHandle(`${channel}.bin`);
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();

    const fullArray = new Float32Array(buffer);
    return fullArray.slice(start, end);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.root) throw new Error('OPFS not initialized');
    await this.root.removeEntry(sessionId, { recursive: true });
  }
}

/**
 * IndexedDB fallback implementation
 */
class IndexedDBSignalStorage implements SignalStorageAdapter {
  private db: IDBDatabase | null = null;

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('cpap-analyzer-signals', 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('signals')) {
          db.createObjectStore('signals', { keyPath: 'key' });
        }
      };
    });
  }

  async writeSignal(sessionId: string, channel: string, data: Float32Array): Promise<void> {
    if (!this.db) throw new Error('IndexedDB not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(['signals'], 'readwrite');
      const store = tx.objectStore('signals');
      const key = `${sessionId}:${channel}`;

      store.put({ key, data: Array.from(data) }); // Convert to regular array for IDB

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async readSignal(
    sessionId: string,
    channel: string,
    start: number,
    end: number,
  ): Promise<Float32Array> {
    if (!this.db) throw new Error('IndexedDB not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(['signals'], 'readonly');
      const store = tx.objectStore('signals');
      const key = `${sessionId}:${channel}`;
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        if (!result) {
          reject(new Error('Signal not found'));
          return;
        }
        const fullArray = new Float32Array(result.data);
        resolve(fullArray.slice(start, end));
      };

      request.onerror = () => reject(request.error);
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.db) throw new Error('IndexedDB not initialized');

    // Delete all keys matching sessionId prefix
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(['signals'], 'readwrite');
      const store = tx.objectStore('signals');
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          if (cursor.key.toString().startsWith(sessionId + ':')) {
            cursor.delete();
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/**
 * Factory: selects storage adapter based on browser capabilities
 */
export async function createSignalStorage(
  capabilities: BrowserCapabilities,
): Promise<SignalStorageAdapter> {
  if (capabilities.opfs) {
    console.info('Using OPFS for signal storage (optimal performance)');
    const storage = new OPFSSignalStorage();
    await storage.initialize();
    return storage;
  }

  if (capabilities.indexedDB) {
    console.warn('OPFS not available, using IndexedDB fallback (reduced performance)');
    const storage = new IndexedDBSignalStorage();
    await storage.initialize();
    return storage;
  }

  throw new Error('No storage backend available — cannot proceed');
}
```

#### 17.3.3 Web Workers Unavailable → Main Thread Fallback

When Web Workers are not available, computation falls back to the main thread with explicit user warnings.

**Implementation** (`src/workers/worker-pool.ts`):

```typescript
import { wrap, type Remote } from 'comlink';
import type { BrowserCapabilities } from '@/utils/feature-detection';

export interface ComputeWorker {
  computeStatistics(data: Float32Array): Promise<Statistics>;
  detectEvents(data: Float32Array, threshold: number): Promise<Event[]>;
}

/**
 * Main-thread fallback implementation
 */
class MainThreadWorker implements ComputeWorker {
  async computeStatistics(data: Float32Array): Promise<Statistics> {
    console.warn('Computing statistics on main thread — UI may freeze');

    // Inline implementation (normally in worker)
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;

    return {
      mean,
      stdDev: Math.sqrt(variance),
      min: Math.min(...data),
      max: Math.max(...data),
    };
  }

  async detectEvents(data: Float32Array, threshold: number): Promise<Event[]> {
    console.warn('Detecting events on main thread — UI may freeze');

    const events: Event[] = [];
    // Event detection logic...
    return events;
  }
}

/**
 * Factory: creates worker pool or main-thread fallback
 */
export function createWorkerPool(capabilities: BrowserCapabilities, poolSize: number = 4) {
  if (capabilities.webWorkers && capabilities.structuredClone) {
    console.info(`Creating Web Worker pool (${poolSize} workers)`);

    const workers: Remote<ComputeWorker>[] = [];
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(new URL('../workers/compute.worker.ts', import.meta.url), {
        type: 'module',
      });
      workers.push(wrap<ComputeWorker>(worker));
    }

    return workers;
  }

  console.warn('Web Workers not available — using main thread fallback');
  return [new MainThreadWorker()];
}
```

#### 17.3.4 ES2020+ Missing → Upgrade Message

If ES2020 features are missing, the app shows an upgrade message and refuses to load.

**Implementation** (`src/App.tsx`):

```typescript
import { useEffect, useState } from 'react';
import { detectBrowserCapabilities, type FeatureAvailability } from '@/utils/feature-detection';
import { BrowserCompatibilityWarning } from '@/components/BrowserCompatibilityWarning';

export function App() {
  const [featureCheck, setFeatureCheck] = useState<FeatureAvailability | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    detectBrowserCapabilities().then((result) => {
      setFeatureCheck(result);
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return <div>Checking browser compatibility...</div>;
  }

  if (!featureCheck?.isFullySupported) {
    return (
      <BrowserCompatibilityWarning
        blockers={featureCheck?.blockers ?? []}
        warnings={featureCheck?.warnings ?? []}
        recommendations={featureCheck?.recommendations ?? []}
        capabilities={featureCheck?.capabilities}
      />
    );
  }

  // Normal app render
  return (
    <div>
      {featureCheck.warnings.length > 0 && (
        <PerformanceWarningBanner warnings={featureCheck.warnings} />
      )}
      {/* Main app content */}
    </div>
  );
}
```

---

### 17.4 Browser Compatibility Warning UI

#### 17.4.1 Blocker View (Cannot Proceed)

When critical features are missing, display a full-page blocker with upgrade instructions.

**Component** (`src/components/BrowserCompatibilityWarning.tsx`):

```typescript
import type { BrowserCapabilities } from '@/utils/feature-detection';
import styles from './BrowserCompatibilityWarning.module.css';

interface Props {
  blockers: string[];
  warnings: string[];
  recommendations: string[];
  capabilities?: BrowserCapabilities;
}

export function BrowserCompatibilityWarning({
  blockers,
  warnings,
  recommendations,
  capabilities,
}: Props) {
  const hasBlockers = blockers.length > 0;

  return (
    <div className={styles.container} role="alert" aria-live="assertive">
      <div className={styles.content}>
        <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>

        <h1 className={styles.title}>
          {hasBlockers ? 'Browser Not Supported' : 'Limited Browser Support'}
        </h1>

        {hasBlockers && (
          <>
            <p className={styles.description}>
              Your browser does not support the features required to run CPAP Analyzer.
            </p>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Missing Critical Features:</h2>
              <ul className={styles.list}>
                {blockers.map((blocker, index) => (
                  <li key={index} className={styles.listItem}>
                    ❌ {blocker}
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Recommended Actions:</h2>
              <ul className={styles.list}>
                {recommendations.map((rec, index) => (
                  <li key={index} className={styles.listItem}>
                    {rec}
                  </li>
                ))}
              </ul>
            </section>

            <div className={styles.browserList}>
              <h3 className={styles.sectionTitle}>Supported Browsers:</h3>
              <div className={styles.browsers}>
                <div className={styles.browser}>
                  <strong>Chrome</strong>
                  <span>102+</span>
                </div>
                <div className={styles.browser}>
                  <strong>Edge</strong>
                  <span>102+</span>
                </div>
                <div className={styles.browser}>
                  <strong>Firefox</strong>
                  <span>111+</span>
                </div>
                <div className={styles.browser}>
                  <strong>Safari</strong>
                  <span>15.2+</span>
                </div>
              </div>
            </div>
          </>
        )}

        {!hasBlockers && warnings.length > 0 && (
          <>
            <p className={styles.description}>
              CPAP Analyzer can run on your browser, but some features are unavailable or will perform slower than optimal.
            </p>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Performance Warnings:</h2>
              <ul className={styles.list}>
                {warnings.map((warning, index) => (
                  <li key={index} className={styles.listItem}>
                    ⚠️ {warning}
                  </li>
                ))}
              </ul>
            </section>

            <button
              className={styles.continueButton}
              onClick={() => {
                // Store user acknowledgment
                localStorage.setItem('cpap-compatibility-ack', 'true');
                window.location.reload();
              }}
            >
              Continue Anyway
            </button>

            <p className={styles.upgradeNote}>
              For the best experience, please upgrade to a fully supported browser.
            </p>
          </>
        )}

        {capabilities && (
          <details className={styles.technicalDetails}>
            <summary>Technical Details</summary>
            <table className={styles.capabilityTable}>
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Origin Private File System</td>
                  <td>{capabilities.opfs ? '✅' : '❌'}</td>
                </tr>
                <tr>
                  <td>IndexedDB</td>
                  <td>{capabilities.indexedDB ? '✅' : '❌'}</td>
                </tr>
                <tr>
                  <td>Web Workers</td>
                  <td>{capabilities.webWorkers ? '✅' : '❌'}</td>
                </tr>
                <tr>
                  <td>ES2020 Features</td>
                  <td>{capabilities.es2020 ? '✅' : '❌'}</td>
                </tr>
                <tr>
                  <td>Canvas 2D</td>
                  <td>{capabilities.canvas2d ? '✅' : '❌'}</td>
                </tr>
                <tr>
                  <td>File System Access API</td>
                  <td>{capabilities.fileSystemAccess ? '✅' : '❌'}</td>
                </tr>
                <tr>
                  <td>Typed Arrays</td>
                  <td>{capabilities.typedArrays ? '✅' : '❌'}</td>
                </tr>
                <tr>
                  <td>Structured Clone</td>
                  <td>{capabilities.structuredClone ? '✅' : '❌'}</td>
                </tr>
              </tbody>
            </table>
          </details>
        )}
      </div>
    </div>
  );
}
```

#### 17.4.2 Performance Warning Banner (Degraded Mode)

For non-blocking warnings, show a persistent banner with dismissal option.

**Component** (`src/components/PerformanceWarningBanner.tsx`):

```typescript
import { useState } from 'react';
import styles from './PerformanceWarningBanner.module.css';

interface Props {
  warnings: string[];
}

export function PerformanceWarningBanner({ warnings }: Props) {
  const [isDismissed, setIsDismissed] = useState(() => {
    return localStorage.getItem('cpap-perf-warning-dismissed') === 'true';
  });

  if (isDismissed || warnings.length === 0) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem('cpap-perf-warning-dismissed', 'true');
    setIsDismissed(true);
  };

  return (
    <div className={styles.banner} role="alert" aria-live="polite">
      <div className={styles.content}>
        <svg className={styles.icon} viewBox="0 0 24 24" aria-label="Warning">
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
        </svg>

        <div className={styles.text}>
          <strong>Performance Notice:</strong>
          <span>{warnings.join(' • ')}</span>
        </div>

        <button
          className={styles.dismissButton}
          onClick={handleDismiss}
          aria-label="Dismiss warning"
        >
          ×
        </button>
      </div>
    </div>
  );
}
```

---

### 17.5 Graceful Degradation Examples

#### 17.5.1 Example: OPFS → IndexedDB Fallback

**Scenario**: User's browser lacks OPFS support.

**Behavior**:

- Storage layer automatically uses IndexedDB
- User sees warning banner: "Using fallback storage — performance may be reduced"
- Large signal reads are 30-50% slower
- All functionality remains available

**User Experience**:

- No data loss
- Slight delays when loading long signal segments (e.g., 8 hours of 25Hz data)
- Chart rendering throttled to compensate

**Implementation Notes**:

- Storage adapter abstraction makes this transparent to the rest of the app
- Performance monitoring logs slower operations for telemetry (if enabled)

---

#### 17.5.2 Example: Web Workers → Main Thread Fallback

**Scenario**: User's browser doesn't support Web Workers (rare, but possible in restricted environments).

**Behavior**:

- Computation functions execute synchronously on main thread
- Progress indicators shown during long operations
- UI may freeze briefly during heavy computation
- Warning banner: "Limited performance — computation running on main thread"

**User Experience**:

- Statistical calculations take longer
- Event detection may block UI for 1-2 seconds
- Scrolling/interaction may stutter during processing

**Implementation Notes**:

- Use `requestIdleCallback` to batch work when possible
- Break long computations into chunks with yield points
- Show explicit progress bars during blocking operations

---

#### 17.5.3 Example: Canvas Performance Degradation

**Scenario**: Browser supports Canvas but has poor rendering performance (e.g., software rendering).

**Behavior**:

- Detect frame rate drops during chart rendering
- Automatically reduce data point density
- Simplify line rendering (disable antialiasing, reduce stroke width)
- Enable "Performance Mode" toggle in settings

**User Experience**:

- Charts render faster but with less visual fidelity
- Notification: "Performance mode enabled — chart quality reduced for responsiveness"

**Implementation**:

```typescript
export function detectCanvasPerformance(): boolean {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const start = performance.now();

  // Render test pattern
  for (let i = 0; i < 10000; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * 1920, Math.random() * 1080);
    ctx.lineTo(Math.random() * 1920, Math.random() * 1080);
    ctx.stroke();
  }

  const duration = performance.now() - start;

  // If render takes >500ms, consider it slow
  return duration < 500;
}
```

---

### 17.6 Testing Strategy for Fallbacks

#### 17.6.1 Simulating Unsupported Browsers

**Playwright Configuration** (`playwright.config.ts`):

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  projects: [
    // Modern browser baseline
    {
      name: 'chrome-modern',
      use: { ...devices['Desktop Chrome'] },
    },

    // OPFS disabled (simulate Safari or older browsers)
    {
      name: 'no-opfs',
      use: {
        ...devices['Desktop Chrome'],
        contextOptions: {
          permissions: [], // Deny storage access
        },
        // Mock navigator.storage to return undefined
        launchOptions: {
          args: ['--disable-features=FileSystemAccessAPI'],
        },
      },
    },

    // Web Workers disabled
    {
      name: 'no-workers',
      use: {
        ...devices['Desktop Chrome'],
        // Inject script to disable Worker constructor
        contextOptions: {
          storageState: undefined,
        },
      },
    },

    // IndexedDB disabled (blocker test)
    {
      name: 'no-indexeddb',
      use: {
        ...devices['Desktop Chrome'],
        // Use Chrome flag to disable IDB
        launchOptions: {
          args: ['--disable-databases'],
        },
      },
    },
  ],
});
```

#### 17.6.2 Unit Tests for Feature Detection

**Test Suite** (`src/utils/feature-detection.test.ts`):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectBrowserCapabilities } from './feature-detection';

describe('detectBrowserCapabilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects all features in modern browser', async () => {
    const result = await detectBrowserCapabilities();

    expect(result.isFullySupported).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it('detects OPFS missing and recommends fallback', async () => {
    // Mock navigator.storage to be undefined
    vi.stubGlobal('navigator', {
      ...navigator,
      storage: undefined,
    });

    const result = await detectBrowserCapabilities();

    expect(result.capabilities.opfs).toBe(false);
    expect(result.warnings).toContain(expect.stringMatching(/OPFS not available/));
  });

  it('blocks app when IndexedDB is unavailable', async () => {
    // Mock indexedDB to be undefined
    vi.stubGlobal('indexedDB', undefined);

    const result = await detectBrowserCapabilities();

    expect(result.isFullySupported).toBe(false);
    expect(result.blockers).toContain('IndexedDB is not available');
  });

  it('warns when Web Workers are unavailable', async () => {
    // Mock Worker constructor
    vi.stubGlobal('Worker', undefined);

    const result = await detectBrowserCapabilities();

    expect(result.capabilities.webWorkers).toBe(false);
    expect(result.warnings).toContain(expect.stringMatching(/Web Workers not available/));
  });
});
```

#### 17.6.3 E2E Tests for Fallback Paths

**Test Suite** (`e2e/browser-compatibility.spec.ts`):

```typescript
import { test, expect } from '@playwright/test';

test.describe('Browser Compatibility', () => {
  test('shows blocker when IndexedDB is disabled', async ({ page, context }) => {
    // Disable IndexedDB via context permission
    await context.grantPermissions([]);

    await page.goto('/');

    // Should show compatibility warning
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/Browser Not Supported/i)).toBeVisible();
    await expect(page.getByText(/IndexedDB is not available/i)).toBeVisible();

    // Should NOT allow continuing
    await expect(page.getByRole('button', { name: /continue anyway/i })).not.toBeVisible();
  });

  test('shows warning banner when OPFS is unavailable', async ({ page, context }) => {
    // Mock OPFS unavailability
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'storage', {
        value: undefined,
        writable: true,
      });
    });

    await page.goto('/');

    // Should show performance warning banner
    await expect(page.getByText(/Performance Notice/i)).toBeVisible();
    await expect(page.getByText(/fallback storage/i)).toBeVisible();

    // Should allow dismissal
    const dismissButton = page.getByLabel(/dismiss warning/i);
    await dismissButton.click();
    await expect(page.getByText(/Performance Notice/i)).not.toBeVisible();
  });

  test('allows continuing with warnings acknowledged', async ({ page }) => {
    await page.addInitScript(() => {
      // Simulate partial support
      Object.defineProperty(navigator, 'storage', {
        value: undefined,
        writable: true,
      });
    });

    await page.goto('/');

    // Should show "Continue Anyway" option
    const continueButton = page.getByRole('button', { name: /continue anyway/i });
    await expect(continueButton).toBeVisible();

    await continueButton.click();

    // Should proceed to app
    await expect(page.getByText(/CPAP Analyzer/i)).toBeVisible();
  });
});
```

#### 17.6.4 Browser Compatibility Test Matrix

| Browser | Version | OPFS | IndexedDB | Workers | Expected Behavior              |
| ------- | ------- | ---- | --------- | ------- | ------------------------------ |
| Chrome  | 102+    | ✅   | ✅        | ✅      | Full support                   |
| Chrome  | 90-101  | ❌   | ✅        | ✅      | IndexedDB fallback warning     |
| Firefox | 111+    | ✅   | ✅        | ✅      | Full support                   |
| Firefox | 100-110 | ❌   | ✅        | ✅      | IndexedDB fallback warning     |
| Safari  | 15.2+   | ⚠️   | ✅        | ✅      | IndexedDB fallback recommended |
| Safari  | 14.x    | ❌   | ✅        | ✅      | IndexedDB fallback warning     |
| Edge    | 102+    | ✅   | ✅        | ✅      | Full support                   |
| Edge    | 90-101  | ❌   | ✅        | ✅      | IndexedDB fallback warning     |
| Chrome  | <85     | ❌   | ❌        | ✅      | Blocker (no IDB)               |

---

### 17.7 User Notification System

#### 17.7.1 Notification Architecture

Compatibility notifications integrate with the global notification system but have special persistence and priority rules.

**Types** (`src/types/notifications.ts`):

```typescript
export type NotificationSeverity = 'info' | 'warning' | 'error' | 'blocker';

export interface CompatibilityNotification {
  id: string;
  severity: NotificationSeverity;
  message: string;
  isPersistent: boolean; // Cannot be dismissed
  isDismissible: boolean; // Can be minimized but persists
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}
```

#### 17.7.2 Persistent Compatibility Banner

Compatibility warnings persist across sessions until the user upgrades their browser.

**Implementation** (`src/components/CompatibilityNotificationManager.tsx`):

```typescript
import { useEffect, useState } from 'react';
import { detectBrowserCapabilities, type FeatureAvailability } from '@/utils/feature-detection';
import { PerformanceWarningBanner } from './PerformanceWarningBanner';

export function CompatibilityNotificationManager() {
  const [features, setFeatures] = useState<FeatureAvailability | null>(null);

  useEffect(() => {
    detectBrowserCapabilities().then(setFeatures);
  }, []);

  if (!features || features.warnings.length === 0) {
    return null;
  }

  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 1000 }}>
      <PerformanceWarningBanner warnings={features.warnings} />
    </div>
  );
}
```

#### 17.7.3 Upgrade Prompt Strategy

- **Frequency**: Show once per session initially
- **Dismissal**: User can dismiss but warning icon persists in header
- **Re-prompt**: After 7 days of usage in degraded mode
- **Non-blocking**: Never prevents access to existing functionality

---

### 17.8 Integration with Error Handling

Browser compatibility errors are categorized as **system errors** in the error handling architecture.

**Error Categories** (from `error-handling-architecture.md`):

1. **User Errors** — Invalid input, file format issues
2. **System Errors** — **Browser compatibility**, storage failures, worker crashes
3. **Data Errors** — Corrupted data, parsing failures
4. **Network Errors** — External API failures (if integrations enabled)

**Compatibility Error Mapping**:

```typescript
// src/errors/compatibility-errors.ts

export class BrowserCompatibilityError extends Error {
  constructor(
    public readonly feature: string,
    public readonly isCritical: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserCompatibilityError';
  }
}

export class OPFSUnavailableError extends BrowserCompatibilityError {
  constructor() {
    super('OPFS', false, 'Origin Private File System is not available');
  }
}

export class IndexedDBUnavailableError extends BrowserCompatibilityError {
  constructor() {
    super('IndexedDB', true, 'IndexedDB is not available — cannot proceed');
  }
}

export class WebWorkersUnavailableError extends BrowserCompatibilityError {
  constructor() {
    super('Web Workers', false, 'Web Workers are not available — performance degraded');
  }
}
```

**Error Boundary Integration**:

```typescript
// src/components/ErrorBoundary.tsx

import { Component, type ReactNode } from 'react';
import { BrowserCompatibilityError } from '@/errors/compatibility-errors';
import { BrowserCompatibilityWarning } from './BrowserCompatibilityWarning';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to error handling system
    console.error('Error caught by boundary:', error, errorInfo);

    // Report to analytics if enabled
    if (error instanceof BrowserCompatibilityError) {
      // Track compatibility issues
      console.warn(`Compatibility issue: ${error.feature} (critical: ${error.isCritical})`);
    }
  }

  render() {
    if (this.state.error instanceof BrowserCompatibilityError) {
      // Render compatibility-specific UI
      return (
        <BrowserCompatibilityWarning
          blockers={this.state.error.isCritical ? [this.state.error.message] : []}
          warnings={!this.state.error.isCritical ? [this.state.error.message] : []}
          recommendations={['Please upgrade your browser for full support']}
        />
      );
    }

    if (this.state.error) {
      // Generic error UI
      return <div>An error occurred. Please refresh the page.</div>;
    }

    return this.props.children;
  }
}
```

---

### 17.9 Implementation Checklist

#### Phase 1: Detection & Core Infrastructure

- [ ] Implement feature detection module (`src/utils/feature-detection.ts`)
- [ ] Create storage adapter abstraction with OPFS/IndexedDB fallback
- [ ] Implement worker pool with main-thread fallback
- [ ] Add unit tests for all detection functions

#### Phase 2: UI Components

- [ ] Build `BrowserCompatibilityWarning` component
- [ ] Build `PerformanceWarningBanner` component
- [ ] Create CSS modules for compatibility UI
- [ ] Ensure WCAG AA compliance for warning components

#### Phase 3: Integration

- [ ] Integrate feature detection into app initialization
- [ ] Add compatibility checks to error boundaries
- [ ] Implement user preference storage for dismissals
- [ ] Add telemetry for compatibility issues (if analytics enabled)

#### Phase 4: Testing

- [ ] Write unit tests for feature detection
- [ ] Write E2E tests for all fallback scenarios
- [ ] Manual testing on target browser matrix
- [ ] Performance testing of fallback paths (IndexedDB vs OPFS)

#### Phase 5: Documentation

- [ ] Create BROWSER_SUPPORT.md with canonical version list
- [ ] Update user documentation with browser requirements
- [ ] Document fallback behavior in user guides
- [ ] Add troubleshooting guide for common compatibility issues

---

### 17.10 Related Documentation

- **`BROWSER_SUPPORT.md`** — Canonical list of minimum browser versions
- **`docs/design/error-handling-architecture.md`** — System error categorization
- **`docs/design/storage-architecture.md`** — OPFS and IndexedDB implementation details
- **`docs/design/performance-strategy.md`** — Web Worker usage and optimization
- **`docs/ux-guidelines.md`** — User messaging and accessibility standards

---

## 18. Summary & Recommendations

This frontend architecture is designed to meet all project requirements:

✅ **Client-Side Only**: No server, all processing in browser  
✅ **High Performance**: Web Workers, virtual scrolling, code splitting, memoization  
✅ **Privacy First**: No external dependencies, no network requests  
✅ **Type Safety**: TypeScript strict mode, comprehensive type definitions  
✅ **WCAG AA Compliant**: Radix UI primitives, focus management, ARIA attributes  
✅ **AI Agent Friendly**: React (most training data), clear patterns, minimal magic  
✅ **Maintainable**: CSS Modules for scoping, Zustand for simple state, clean project structure  
✅ **Testable**: Vitest for units, Playwright for E2E, pure functions, dependency injection  
✅ **Extensible**: Plugin architecture, service layer abstractions
✅ **Browser Compatible**: Feature detection, graceful degradation, clear fallback strategy

**Technology Stack Summary**:

- **Framework**: React 18+ (concurrent features, most mature ecosystem)
- **State**: Zustand (minimal boilerplate, excellent DX)
- **UI**: Custom components on Radix primitives (accessible, themeable)
- **CSS**: CSS Modules + design tokens (scoped, themeable, no runtime cost)
- **Build**: Vite (fast, modern, optimized)
- **Workers**: Comlink (type-safe worker communication)
- **PWA**: Workbox via Vite PWA plugin (offline support, app-like experience)

This architecture balances **performance**, **developer experience**, and **AI agent simplicity** while maintaining strict adherence to the project's privacy-first, client-side-only design philosophy. The comprehensive browser compatibility strategy ensures users receive appropriate guidance and graceful degradation when modern features are unavailable.

---
