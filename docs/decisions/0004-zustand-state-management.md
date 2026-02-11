# 0004 — Zustand for Global State Management

## Status

Accepted

## Context

CPAP Analyzer requires global state management for application-wide concerns like date range selection, selected session, theme preference, and import status. The state management solution must be simple, performant, and compatible with React's concurrent features.

State management needs:

- Global state accessible across component tree without prop drilling
- Persistent state (theme, date range) saved to localStorage/URL
- Minimal boilerplate for AI agent code generation
- TypeScript-first with strong inference
- Performance optimizations for selective re-renders
- DevTools support for debugging
- Small bundle size (< 10 KB gzipped)

State categories identified:

- **Global app state**: date range, selected session, theme, import progress (Zustand)
- **Component tree state**: modal open/close, form state, local UI state (React Context)
- **URL state**: deep-linkable state for current view, filters, session (React Router)
- **Server state**: N/A (client-side only application)

Alternatives considered:

- **Redux Toolkit**: Industry standard but verbose, requires reducers/actions/slices, ~15 KB gzipped, overkill for our needs
- **Jotai**: Atomic state approach, elegant but less intuitive for AI agents, atoms pattern adds cognitive overhead
- **Recoil**: Similar to Jotai, experimental status, larger bundle (25 KB gzipped), Facebook-backed but uncertain future
- **React Context + useReducer**: Built-in but verbose, causes re-renders for entire context consumers, no middleware support
- **MobX**: Mutable state approach conflicts with React best practices, requires understanding observables, 16 KB gzipped

## Decision

Use **Zustand** for global application state with React Context for component tree state.

Zustand characteristics:

- Minimal API: `create()` hook returns a hook to access state
- TypeScript-first: excellent type inference, no action types or reducers
- Small bundle: ~3 KB gzipped
- No provider wrapper required: stores are modules
- Selective subscription: only re-render components using changed state
- Middleware support: persistence, devtools, immer for immutability
- Zero boilerplate compared to Redux

Store structure:

```typescript
// Global app state
useAppStore: {
  (dateRange, selectedSessionId, theme, importStatus);
}

// Settings state
useSettingsStore: {
  (analysisParams, displayPrefs, integrations);
}

// Chart interaction state
useChartInteractionStore: {
  (zoomDomain, brushSelection, crosshairPosition);
}
```

React Context used for:

- Modal management (open/close state)
- Form state within component subtrees
- Localized UI state not needed globally

## Consequences

### Positive

- Minimal API reduces cognitive load for AI agents: `const value = useStore(state => state.value)`
- Strong TypeScript inference catches state access errors at compile time
- Selective subscription prevents unnecessary re-renders (performance critical for large datasets)
- No provider wrappers simplify component tree
- Persistence middleware easily saves state to localStorage automatically
- Small bundle size (3 KB) leaves budget for other features
- Middleware ecosystem supports devtools, persistence, immer
- Testing is straightforward: stores are just functions
- Can colocate related state and actions in single store

### Negative

- Less opinionated than Redux, requires architectural discipline to avoid state fragmentation
- No time-travel debugging by default (unlike Redux)
- Mutations must be carefully managed to avoid race conditions (though middleware like immer helps)
- No built-in action history or undo/redo (would need custom implementation)
- Smaller community than Redux, though still well-maintained

### Neutral

- State is mutable within setter functions (differs from Redux immutability), but immer middleware available
- No "actions" concept, state updates are direct functions (simpler but less traceable than Redux actions)
- Stores are modules, not context providers (different mental model from Context API)
