# 0028 — Request Persistent Storage

## Status

Accepted

## Context

CPAP Analyzer is a privacy-first, client-side-only health application. All user data lives in IndexedDB (structured metadata, aggregates, events) and OPFS (high-frequency signal data), per [0005](0005-dual-storage-indexeddb-opfs.md). Because the data informs health decisions and there is no backend, durability of locally stored data is a correctness concern, not merely a convenience.

Until now the app never called `navigator.storage.persist()`. As a result, all data was stored in the browser's default **best-effort (evictable)** storage bucket. The eviction semantics of best-effort storage differ by engine:

- **Chromium (notably Chrome on Windows)** evicts best-effort origin storage automatically under disk pressure, when the user enables "clear cookies and site data when you close all windows," and during OS-level disk cleanup. Eviction can occur _mid-session_ as well as between sessions.
- **WebKit (Safari, and Chrome/Edge on macOS via the platform storage layer)** uses a different, time-based eviction model and did not exhibit the failure during testing.

This caused real, intermittent, total data loss for a Windows Chrome user:

- **Mid-session eviction** force-closes the active IndexedDB connection. The app surfaced the error `The database connection is closing`, and subsequent operations failed because the connection was never re-established.
- **Between-session eviction** left a blank database on the next load, with no surviving signals or metadata.

The bug did not reproduce on WebKit, which obscured root cause and delayed diagnosis.

[0005](0005-dual-storage-indexeddb-opfs.md) already noted (Neutral consequences) that the browser may evict storage under pressure and that the persistent-storage API can request persistence; this ADR records the decision to actually do so, and to harden the connection lifecycle against force-closure.

Considered options:

- **(a) Do nothing — rely on best-effort storage.** Rejected: this is the status quo that produced the data-loss bug.
- **(b) Request persistent storage via `navigator.storage.persist()`.** Chosen. Persistent storage is exempt from automatic eviction; the browser only clears it on explicit user action. Chrome grants persistence _heuristically_ (e.g., based on site engagement, bookmarking, or PWA installation) without a user-facing prompt or a user-gesture requirement, so the request can be made at startup. `persist()` is a local-only operation: it transmits nothing, contacts no server, and introduces no telemetry, fully consistent with [0015](0015-zero-telemetry-analytics.md).
- **(c) Periodic export/backup reminders as the sole mitigation.** Rejected as a substitute, retained as a complement. Reminders depend on user action and cannot prevent the eviction itself; they are a useful belt-and-suspenders measure but do not address the root cause.

## Decision

Request persistent storage and harden the IndexedDB connection lifecycle.

1. **Request persistence at startup.** Call `navigator.storage.persist()` once during app initialization, fire-and-forget and non-blocking, so it never delays first paint or import. Feature-detect the Storage API and treat its absence as "not persisted."

2. **Surface persistence status in Settings.** Display whether storage is currently persisted (via `navigator.storage.persisted()`) and provide an explicit affordance to re-request persistence. When persistence is denied, guide the user toward actions that increase Chrome's likelihood of granting it (e.g., bookmarking the app, returning to it regularly, or installing it as a PWA).

3. **Harden the IndexedDB connection lifecycle.** Register `onversionchange` and `onclose` handlers on the database connection so that a force-closed connection (such as one closed by eviction) is detected and reconnected, rather than leaving the app throwing `The database connection is closing` indefinitely.

Rationale, in core-principle priority order: this protects **correctness** (durable health data), preserves **privacy** (`persist()` is entirely local and silent), and improves **UX** by making storage state visible and recoverable. Persistence is requested rather than assumed because Chrome's grant is heuristic and not guaranteed.

## Consequences

### Positive

- Once granted, data is exempt from the browser's automatic eviction, eliminating both the mid-session and between-session data-loss modes on Chrome/Windows.
- The connection-lifecycle hardening makes the app resilient to any force-closed connection, not just eviction (e.g., a concurrent tab triggering a version change).
- Persistence status is visible to the user, turning a previously silent failure into an observable, actionable state.
- No privacy cost: the request is local-only and sends nothing, consistent with the zero-telemetry stance.

### Negative

- Persistence may still be **denied** if Chrome's heuristics are not met; in that case data remains evictable and the app must fall back on surfacing status and guiding the user (and on the complementary export/backup workflow).
- Behavior is engine-dependent, so the grant outcome and user guidance differ across browsers, adding nuance to support and documentation.
- The reconnection logic adds complexity to the storage layer and requires test coverage for the force-close-and-reconnect path.

### Neutral

- Granting persistence does not increase the storage quota; it only changes eviction eligibility.
- Explicit "Clear all data" in the app and user-initiated browser clearing (clearing site data, deleting the profile) still remove the data as before — persistence prevents only _automatic_ eviction.
- Periodic export/backup reminders remain a valid complementary safeguard and are unaffected by this decision.
