# 0033 — Adoption of React Router 7.x

## Status

Accepted

## Context

Dependabot opened a PR bumping `react-router-dom` (and its `react-router`
transitive dependency) from 6.30.4 to 7.0.0. The initial 7.0.0 pin fell
inside a version range affected by multiple high-severity advisories (XSS via
open redirect, SSR XSS in `ScrollRestoration`, DoS via unbounded path
expansion, among others), which failed CI's Security Audit gate. The fix was
to move further forward to 7.18.2, the latest 7.x release outside the
vulnerable `6.0.0`–`7.17.0` range — `npm audit --audit-level=high` now
reports zero vulnerabilities against the router package.

This is a major-version bump, not a mechanical patch. React Router 7 folds in
what was the Remix router and changes a default that this codebase depended
on. In v6, wrapping router state updates in `React.startTransition` was
opt-in via `future.v7_startTransition`; in v7, `RouterProvider`
unconditionally wraps every router state update in `startTransition`, and
there is no flag to opt back out — it is now permanent, load-bearing
behavior of the router, not a configuration choice we made.

The practical effect: `history.pushState` / `replaceState` (the visible
`window.location`) and the React re-render that reflects the new location in
`useLocation()` / `useSearchParams()` are no longer effectively synchronous.
The URL updates immediately; the React state reflecting it is deferred as a
low-priority, interruptible transition. Under React 18/19 concurrent
rendering, components can observe a window in which `window.location`
disagrees with what `useLocation()` / `useSearchParams()` currently report.

An RCA (parallel to this ADR) traced a real bug to exactly this window: in
`src/hooks/useURLState.ts`, the debounced store→URL sync closed over the
render-time value from `useSearchParams()` when scheduling a merge-write. A
navigation landing inside the ~300ms debounce window got its query params
silently clobbered when the stale closure fired and overwrote params that
had since changed underneath it. A related defensive fix was made to the
URL→state resync effect in
`src/views/Explore/EventExplorer/EventExplorer.tsx`, which also reads
`useSearchParams()` and needed hardening against the same class of
staleness. Both fixes are tracked and landed alongside this dependency bump,
not as part of this ADR.

Alternatives considered:

- **Stay on react-router-dom 6.30.4 and suppress/override the Dependabot
  PR.** Rejected — it would leave the high-severity CVEs in the `router`
  transitive dependency chain unpatched, failing our own CI Security Audit
  gate and violating the project's zero-known-high-severity-vuln bar.
- **Pin to an intermediate 7.x version.** Not viable — every 7.x release
  prior to 7.18.0 falls inside the disclosed vulnerable range; 7.18.2 is the
  first patched release in the 7.x line as of this writing.
- **Migrate off react-router entirely.** Out of scope — no defect in the
  library itself motivates a replacement, only a version-range vulnerability
  and an upstream default change; a full migration is a disproportionate
  response to a dependency bump. See ADR 0002 for the original
  React/TypeScript stack decision, which is unaffected.

## Decision

Adopt `react-router-dom` 7.18.2 (and its `react-router` peer) as the
project's router. This resolves the outstanding high-severity CVEs affecting
`react-router` 6.0.0–7.17.0 and keeps the app on a maintained, patched major
version rather than pinning back to an EOL-track 6.x line.

We accept the new unconditional-`startTransition` behavior as permanent
upstream default rather than working around it, and instead adopt a coding
rule (below) so the rest of the codebase is written to be correct under it.

## Consequences

### Positive

- Closes the high-severity `react-router` CVE range (`6.0.0`–`7.17.0`); `npm
audit --audit-level=high` is clean.
- Stays on a maintained major version instead of an increasingly outdated
  6.x line, and picks up remix-router's improvements (data APIs, lazy route
  modules) for future use.
- The `startTransition` wrapping is a genuine UX improvement for route
  transitions: it keeps the outgoing view mounted until the incoming route's
  data/lazy chunk is ready instead of flashing a loading fallback, which
  aligns with this project's UX bar (Core Principle 4).

### Negative

- **New invariant to guard in code review, project-wide.** Any code that
  reads router state (`useLocation()`, `useSearchParams()`, or params derived
  from them) and needs to correlate it with the actual current browser URL —
  most concretely, anything that debounces, memoizes, or otherwise
  schedules a deferred read/merge/write against "the current URL" — **must
  not** trust a closed-over or memoized router-state snapshot captured at an
  earlier point in time. It must re-read live state at the point of use
  (e.g. `window.location`, or a functional updater form like
  `setSearchParams(prev => ...)` that receives the freshest value rather
  than closing over a render-time variable), or otherwise be written so it
  is safe under an arbitrarily delayed transition. The bug found in
  `src/hooks/useURLState.ts`'s debounced sync (closing over
  `useSearchParams()`'s render-time value, silently clobbering params
  changed by a navigation that landed inside the debounce window) is the
  canonical example of this failure mode and should be used as the reference
  case in review of any new debounced/deferred URL-state code.
- Removes the ability to opt out of transition-wrapped router updates — v6's
  `future.v7_startTransition` flag no longer exists in v7 as an off switch.
  Any future code that genuinely needs a synchronous URL/state guarantee
  cannot get one from the router and must be designed around the async
  invariant instead.
- Major-version dependency churn carries some risk of undiscovered edge
  cases beyond the one already found and fixed; the existing Vitest and
  Playwright suites were the primary safety net for this bump and should be
  extended as further router-state-timing issues are found.

### Neutral

- **E2E test authors:** navigation assertions can no longer assume a
  synchronous, same-tick DOM swap once `page.url()` reflects a new route,
  particularly across `React.lazy()`-loaded route boundaries — v7
  intentionally keeps the old UI mounted (no fallback flash) until the new
  route tree is ready, which is correct, desired behavior, not a bug. Tests
  must wait on content-level signals (e.g. an element unique to the
  destination view) rather than on URL state alone when asserting
  post-navigation UI. See the `playwright-testing` skill and ADR 0010.
- No data-storage, plugin-API, or clinical-calculation surface is affected;
  this is a routing/rendering-layer dependency decision only.
