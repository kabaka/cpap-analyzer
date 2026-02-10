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

| Component | Radix Package | Purpose |
|-----------|---------------|---------|
| Modal/Dialog | `@radix-ui/react-dialog` | Import wizard, settings, confirmations |
| Dropdown Menu | `@radix-ui/react-dropdown-menu` | Date range presets, chart options |
| Tooltip | `@radix-ui/react-tooltip` | Metric definitions, help icons |
| Select | `@radix-ui/react-select` | Analysis method selection |
| Tabs | `@radix-ui/react-tabs` | Navigation, help content sections |
| Accordion | `@radix-ui/react-accordion` | Collapsible settings, help sections |
| Popover | `@radix-ui/react-popover` | Advanced chart controls |
| Switch | `@radix-ui/react-switch` | Theme toggle, settings toggles |
| Slider | `@radix-ui/react-slider` | Date range selection, zoom controls |

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
    llm: { enabled: boolean; provider: 'openai' | 'anthropic' | null; apiKey: string | null };
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
│   │   └── integrations/           # External service integrations
│   │       ├── FitbitService.ts
│   │       ├── WeatherService.ts
│   │       └── LLMService.ts
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
    private poolSize: number = navigator.hardwareConcurrency || 4
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
    await Promise.all(
      this.workers.map(worker => (worker as any)[Symbol.dispose]?.())
    );
    this.workers = [];
    this.availableWorkers = [];
  }
}

// Create global worker pool instance
export const edfParserPool = new WorkerPool<EDFParserWorker>(
  () => new Worker(new URL('./edfParser.worker.ts', import.meta.url), { type: 'module' })
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
    const parsedSession = await edfParserPool.execute(worker =>
      worker.parseEDFFile(arrayBuffer)
    );
    
    // Store parsed session
    await this.storeSession(parsedSession);
  }
}
```

**Dependencies**:
- `comlink`: ~2KB, type-safe worker communication
- Built-in Web Workers (no additional library needed)

---

## 9. Service Worker (PWA)

### 9.1 Service Worker Strategy

**Caching Strategy**:

1. **App Shell** (cache-first): HTML, CSS, JS, fonts, icons
2. **Data APIs** (network-first with cache fallback): IndexedDB/OPFS access
3. **External APIs** (network-only): Fitbit, Weather, LLM (user must be online)

**Offline Capabilities**:
- Full app functionality without network (since everything is client-side)
- External integrations gracefully degrade when offline
- Show offline indicator in UI when network unavailable

**Implementation with Workbox** (via Vite PWA plugin):

```typescript
// vite.config.ts (PWA configuration from Section 5.1)
VitePWA({
  registerType: 'autoUpdate',
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    
    // Cache app shell
    runtimeCaching: [
      {
        urlPattern: /\.(?:js|css|html)$/,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'app-shell',
          expiration: {
            maxEntries: 50,
            maxAgeSeconds: 60 * 60 * 24 * 7, // 1 week
          },
        },
      },
    ],
  },
})
```

**Update Notification**:

```typescript
// src/hooks/usePWAUpdate.ts
import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function usePWAUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      console.log('SW registered:', registration);
    },
    onRegisterError(error) {
      console.error('SW registration error:', error);
    },
  });
  
  useEffect(() => {
    if (needRefresh) {
      setUpdateAvailable(true);
    }
  }, [needRefresh]);
  
  const applyUpdate = () => {
    updateServiceWorker(true);
  };
  
  return { updateAvailable, applyUpdate };
}

// Usage in App.tsx
function App() {
  const { updateAvailable, applyUpdate } = usePWAUpdate();
  
  return (
    <>
      {updateAvailable && (
        <UpdateBanner onUpdate={applyUpdate} />
      )}
      {/* Rest of app */}
    </>
  );
}
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
import './styles/tokens.css';       // Design tokens
import './styles/reset.css';        // CSS reset
import './styles/base.css';         // Base styles (body, headings, etc.)
import './styles/utilities.css';    // Utility classes (if needed)
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

// Lazy-load LLM service when user enables it
const LLMService = React.lazy(() => import('@/services/integrations/LLMService'));
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
export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const lastRun = useRef(Date.now());
  
  return useCallback((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastRun.current >= delay) {
      callback(...args);
      lastRun.current = now;
    }
  }, [callback, delay]) as T;
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
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
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

**Total Bundle Size Estimate** (production, gzipped):
- React + React-DOM: ~45KB
- React Router: ~12KB
- Zustand: ~3KB
- Radix UI (all primitives): ~20KB
- Comlink: ~2KB
- React Hook Form + Zod: ~15KB
- Recharts (lazy-loaded): ~80KB
- **Total Core**: ~100KB
- **With Charts**: ~180KB

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

## 17. Summary & Recommendations

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

**Technology Stack Summary**:
- **Framework**: React 18+ (concurrent features, most mature ecosystem)
- **State**: Zustand (minimal boilerplate, excellent DX)
- **UI**: Custom components on Radix primitives (accessible, themeable)
- **CSS**: CSS Modules + design tokens (scoped, themeable, no runtime cost)
- **Build**: Vite (fast, modern, optimized)
- **Workers**: Comlink (type-safe worker communication)
- **PWA**: Workbox via Vite PWA plugin (offline support, app-like experience)

This architecture balances **performance**, **developer experience**, and **AI agent simplicity** while maintaining strict adherence to the project's privacy-first, client-side-only design philosophy.

---

**End of Document**
