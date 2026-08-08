/**
 * Tracks the app's data router's LIVE `location.search`, synchronously and
 * independent of React's render/commit timing.
 *
 * ## Why this exists
 *
 * React Router 7's `RouterProvider` unconditionally wraps the state update
 * that flows into `useLocation()` / `useSearchParams()` in
 * `React.startTransition` (this was opt-in pre-v7 via the since-removed
 * `future.v7_startTransition` flag). A `navigate()` call updates the
 * router's internal state — and the real browser URL, via
 * `history.pushState`/`replaceState` — synchronously, but the React
 * re-render that reflects the new location in `useLocation()` /
 * `useSearchParams()` is a deferred, low-priority transition. That deferral
 * can be substantial: transitions intentionally keep the previous UI
 * mounted while a `React.lazy()`-loaded destination route's chunk loads
 * ("no fallback flash" is deliberate v7 behavior), so the gap between "URL
 * changed" and "React knows the URL changed" can exceed hundreds of
 * milliseconds.
 *
 * Code that runs OUTSIDE the render cycle — e.g. a debounced effect that
 * needs to merge onto "whatever the URL currently is" — cannot safely use
 * `useLocation()`/`useSearchParams()` for that purpose: a value closed over
 * at schedule time (or even freshly read via a `setSearchParams(prev => …)`
 * functional update, which is *also* just the last React-committed
 * location under the hood) can be stale relative to the real address bar.
 *
 * `router.subscribe()` fires synchronously the instant the router's
 * internal state changes — i.e. right after the URL itself changes — before
 * the transitioned React re-render is even scheduled. Tracking
 * `location.search` through it gives such code a way to read the TRUE
 * current URL.
 *
 * ## Decoupling
 *
 * This module has no import-time dependency on `src/router.tsx` (or
 * `react-router-dom`) — it only needs the narrow duck-typed shape below.
 * `src/router.tsx` registers itself by calling `registerLiveRouter(router)`
 * once, right after creating the singleton router. Keeping the dependency
 * direction this way (hooks/components → this module ← router.tsx) avoids a
 * circular import: `router.tsx` renders `RootLayout`, which calls
 * `useURLStateSync()`, which would otherwise need to import back from
 * `router.tsx`.
 *
 * In contexts where no router has registered — notably unit tests that
 * mount a hook under a plain `<MemoryRouter>` rather than the app's data
 * router — `getLiveSearch()` returns `null`. Callers MUST treat `null` as
 * "no live source available, fall back to your prior behavior" rather than
 * as an empty query string.
 */

/** Minimal shape of the piece of the data router this module depends on. */
export interface LiveLocationSource {
  subscribe(fn: (state: { location: { search: string } }) => void): () => void;
  state: { location: { search: string } };
}

let currentSearch: string | null = null;
let unsubscribe: (() => void) | null = null;

/**
 * Registers the app's singleton data router as the source of truth for the
 * live `location.search`. Call once, right after `createBrowserRouter(...)`.
 * Calling again (e.g. hot-reload) replaces the previous registration.
 */
export function registerLiveRouter(router: LiveLocationSource): void {
  unsubscribe?.();
  currentSearch = router.state.location.search;
  unsubscribe = router.subscribe((state) => {
    currentSearch = state.location.search;
  });
}

/**
 * Returns the live `location.search` string (e.g. `"?start=2025-01-01"`),
 * or `null` if no router has registered via {@link registerLiveRouter}.
 */
export function getLiveSearch(): string | null {
  return currentSearch;
}

/** Test-only: clears registration state between tests. */
export function __resetLiveRouterForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  currentSearch = null;
}
